"""后期：把线性 EXR 序列做成"随身记录仪"质感并编码。
  .venv/bin/python scripts/post.py <exr_dir> --stills 30,97,100 --out renders/post_test      # 导出静帧检查
  .venv/bin/python scripts/post.py <exr_dir> --video out/gunfight_raw.mp4 [--audio out/audio.wav] [--range 1-420]
流程：卷帘快门闪光条带 → 暗角 → 泛光 → 色差 → 自动曝光(有滞后) → 传感器噪点 → 色调曲线 → 降噪+锐化 → 时间戳 → H.264
"""
import os, sys, argparse, subprocess, math, json
import numpy as np
import cv2
import OpenEXR
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import timeline as TL

W, H = 1920, 1080
LUMA = np.array([0.2126, 0.7152, 0.0722], np.float32)


def read_exr(path):
    with OpenEXR.File(path) as f:
        ch = f.channels()
        im = ch["RGB"].pixels if "RGB" in ch else np.dstack([ch[c].pixels for c in "RGB"])
    return np.ascontiguousarray(im[..., :3], dtype=np.float32)


def frame_path(d, f, nf=False):
    return os.path.join(d, f"f_{f:04d}{'_nf' if nf else ''}.exr")


# ---------- 预计算
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
cx, cy = (W - 1) / 2, (H - 1) / 2
rr = np.sqrt(((xx - cx) / cx) ** 2 + ((yy - cy) / cx) ** 2)          # 以半宽归一
VIGNETTE = (1.0 - 0.30 * np.clip(rr / 1.15, 0, 1) ** 2.6).astype(np.float32)[..., None]
# 中央重点测光权重（缩略图上）
TH, TW = 90, 160
ty, tx = np.mgrid[0:TH, 0:TW].astype(np.float32)
MW = np.exp(-(((tx - TW / 2) / (TW * 0.38)) ** 2 + ((ty - TH * 0.52) / (TH * 0.42)) ** 2)).astype(np.float32)
MW /= MW.sum()


def ca_maps(scale):
    mx = ((xx - cx) / scale + cx).astype(np.float32); my = ((yy - cy) / scale + cy).astype(np.float32)
    return mx, my


CA_R = ca_maps(1.0022); CA_B = ca_maps(0.9980)


def make_lens_dirt():
    """镜头上的指纹/灰尘：只在强光散射（泛光）里隐约显形。"""
    rng = np.random.default_rng(42)
    d = np.zeros((H // 4, W // 4), np.float32)
    hh, ww = d.shape
    for _ in range(46):
        x, y = rng.uniform(0, ww), rng.uniform(0, hh); r = rng.uniform(3, 16); a = rng.uniform(0.25, 1.0)
        cv2.circle(d, (int(x), int(y)), int(r), float(a), -1, cv2.LINE_AA)
    for _ in range(7):   # 擦拭留下的弧形拖痕
        x, y = rng.uniform(0, ww), rng.uniform(0, hh)
        cv2.ellipse(d, (int(x), int(y)), (int(rng.uniform(40, 130)), int(rng.uniform(6, 20))), rng.uniform(0, 180), 0, 360, float(rng.uniform(0.15, 0.4)), -1, cv2.LINE_AA)
    d = cv2.GaussianBlur(d, (0, 0), 3.5)
    return np.clip(d, 0, 1)[..., None]


LENS_DIRT = make_lens_dirt()


def band_mask(f, seed=0):
    """卷帘快门：闪光只曝在一段扫描行里。返回 H×1 的 0..1 掩码。"""
    rng = np.random.default_rng(1000 + f * 7 + seed)
    hgt = rng.uniform(0.34, 0.62) * H
    y0 = rng.uniform(-0.15 * H, H - hgt * 0.75)
    y = np.arange(H, dtype=np.float32)
    soft = 26.0
    m = np.clip((y - y0) / soft, 0, 1) * np.clip((y0 + hgt - y) / soft, 0, 1)
    return m[:, None, None]


def thumb_lum(lin):
    t = cv2.resize(lin, (TW, TH), interpolation=cv2.INTER_AREA)
    return t @ LUMA


def load_linear(d, f):
    lin = read_exr(frame_path(d, f))
    nfp = frame_path(d, f, nf=True)
    if os.path.exists(nfp):
        nfl = read_exr(nfp)
        m = band_mask(f)
        lin = nfl * (1 - m) + lin * m
    return lin


MAX_GAIN = 24.0
AE_TARGET = 0.215


def auto_exposure(d, frames, target=None, k_down=0.22, k_up=0.07):
    """逐帧模拟自动曝光环路：变亮时收得快，变暗时放得慢。返回 {frame: gain}"""
    target = AE_TARGET if target is None else target
    gains = {}
    g = None
    for f in frames:
        lum = thumb_lum(load_linear(d, f) * VIGNETTE)
        if g is None:
            g = 1.5
            for _ in range(60):
                m = float((np.minimum(lum * g, 1.0) * MW).sum())
                g *= (target / max(m, 1e-4)) ** 0.5
            g = float(np.clip(g, 0.25, MAX_GAIN))
        gains[f] = g
        m = float((np.minimum(lum * g, 1.0) * MW).sum())
        ratio = target / max(m, 1e-4)
        k = k_down if ratio < 1 else k_up
        g *= ratio ** k
        g = float(np.clip(g, 0.25, MAX_GAIN))
    return gains


def srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)


FONT = None


def overlay(img_u8, f):
    global FONT
    if FONT is None:
        FONT = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 30)
    im = Image.fromarray(img_u8)
    d = ImageDraw.Draw(im)
    t = (f - 1) / TL.FPS
    base = 16 * 3600 + 42 * 60 + 7
    sec = base + int(t)
    txt = f"2026-11-24 {sec // 3600:02d}:{(sec % 3600) // 60:02d}:{sec % 60:02d}"
    txt2 = "CAM 02  REC"
    for dx, dy in ((2, 2), (-1, -1), (2, -1), (-1, 2)):
        d.text((W - 470 + dx, 34 + dy), txt, font=FONT, fill=(0, 0, 0))
        d.text((W - 470 + dx, 72 + dy), txt2, font=FONT, fill=(0, 0, 0))
    d.text((W - 470, 34), txt, font=FONT, fill=(238, 238, 238))
    d.text((W - 470, 72), txt2, font=FONT, fill=(238, 238, 238))
    if int(t * 2) % 2 == 0:
        d.ellipse((W - 258, 80, W - 238, 100), fill=(225, 30, 30))
    return np.asarray(im)


NO_OSD = False


def grade(lin, gain, f, clean=False):
    rng = np.random.default_rng(f)
    lin = lin * VIGNETTE
    # 泛光 / 眩光
    hi = np.clip(lin * gain - 1.1, 0, 40)
    if hi.max() > 0:
        small = cv2.resize(hi, (W // 4, H // 4), interpolation=cv2.INTER_AREA)
        b1 = cv2.GaussianBlur(small, (0, 0), 3.0); b2 = cv2.GaussianBlur(small, (0, 0), 11.0); b3 = cv2.GaussianBlur(small, (0, 0), 32.0)
        bl = b1 * 0.10 + b2 * 0.07 + b3 * 0.05 + (b2 * 0.10 + b3 * 0.16) * LENS_DIRT
        bloom = cv2.resize(bl, (W, H), interpolation=cv2.INTER_LINEAR)
        lin = lin + bloom / gain
    # 色差
    r = cv2.remap(lin[..., 0], CA_R[0], CA_R[1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    b = cv2.remap(lin[..., 2], CA_B[0], CA_B[1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    lin = np.dstack([r, lin[..., 1], b])
    x = lin * gain
    # 传感器噪点（线性域，暗部更明显，增益越高越脏）
    if not clean:
        ns = 0.012 + 0.006 * min(gain, 4.0)
        n_l = rng.standard_normal((H, W, 1)).astype(np.float32)
        n_c = cv2.GaussianBlur(rng.standard_normal((H, W, 3)).astype(np.float32), (0, 0), 1.1)
        x = x + (n_l * ns + n_c * ns * 0.9) * np.sqrt(np.clip(x, 0.002, 1.0) + 0.01)
    x = np.clip(x, 0, None)
    # 色调曲线：动态范围有限，高光硬一点
    wp = 2.1
    y = x * (1 + x / (wp * wp)) / (1 + x)
    y = np.clip(y * 1.06, 0, 1)
    y = srgb(y)
    # 反差、黑位、饱和度、偏色
    y = np.clip((y - 0.5) * 1.10 + 0.5 + 0.012, 0, 1)
    l = (y @ LUMA)[..., None]
    y = l + (y - l) * 0.84
    y = y * np.array([0.975, 1.0, 0.975], np.float32) + np.array([0.0, 0.004, 0.006], np.float32)
    y = np.clip(y, 0, 1).astype(np.float32)
    # 机内降噪 + 过锐化
    den = cv2.GaussianBlur(y, (0, 0), 0.8)
    blur = cv2.GaussianBlur(den, (0, 0), 1.6)
    y = np.clip(den + (den - blur) * 0.85, 0, 1)
    if not clean:
        y = y + rng.standard_normal((H, W, 1)).astype(np.float32) * 0.010
    out = (np.clip(y, 0, 1) * 255 + 0.5).astype(np.uint8)
    return out if NO_OSD else overlay(out, f)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("exr_dir")
    ap.add_argument("--stills", default="")
    ap.add_argument("--out", default=os.path.join(ROOT, "renders", "post_test"))
    ap.add_argument("--video", default="")
    ap.add_argument("--audio", default="")
    ap.add_argument("--range", default=f"1-{TL.F_END}")
    ap.add_argument("--bitrate", default="7M")
    ap.add_argument("--clean", action="store_true")
    ap.add_argument("--no-osd", action="store_true")
    ap.add_argument("--max-gain", type=float, default=24.0)
    ap.add_argument("--ae-target", type=float, default=0.215)
    a = ap.parse_args()
    global NO_OSD, MAX_GAIN, AE_TARGET
    NO_OSD = a.no_osd; MAX_GAIN = a.max_gain; AE_TARGET = a.ae_target
    d = a.exr_dir
    if a.stills:
        frames = [int(v) for v in a.stills.split(",")]
        os.makedirs(a.out, exist_ok=True)
        # 静帧模式：各帧独立收敛曝光
        for f in frames:
            lin = load_linear(d, f)
            g = auto_exposure(d, [f])[f]
            img = grade(lin, g, f, clean=a.clean)
            Image.fromarray(img).save(os.path.join(a.out, f"g_{f:04d}.jpg"), quality=92)
            print("still", f, "gain", round(g, 2))
        return
    s, e = [int(v) for v in a.range.split("-")]
    frames = [f for f in range(s, e + 1) if os.path.exists(frame_path(d, f))]
    print("frames", len(frames), flush=True)
    gains = auto_exposure(d, frames)
    json.dump(gains, open(os.path.join(ROOT, "out", "gains.json"), "w"))
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(TL.FPS), "-i", "-"]
    if a.audio:
        cmd += ["-i", a.audio]
    cmd += ["-c:v", "libx264", "-preset", "medium", "-pix_fmt", "yuv420p", "-b:v", a.bitrate, "-maxrate", a.bitrate, "-bufsize", "10M",
            "-profile:v", "high", "-g", "30", "-bf", "0", "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709"]
    if a.audio:
        cmd += ["-c:a", "aac", "-b:a", "128k", "-shortest"]
    cmd += ["-movflags", "+faststart", a.video]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for i, f in enumerate(frames):
        img = grade(load_linear(d, f), gains[f], f, clean=a.clean)
        p.stdin.write(img.tobytes())
        if i % 60 == 0:
            print("post", f, flush=True)
    p.stdin.close(); p.wait()
    print("VIDEO DONE", a.video, flush=True)


if __name__ == "__main__":
    main()
