#!/usr/bin/env python3
"""最终合成：EXR → 调色（氮气径向模糊/闪白/色散）→ 速度线 → 点火冲击环 → HUD → PNG。
uv run --with opencv-python-headless --with openexr --with numpy --with pillow python finish.py <exr_dir> <out_dir> [帧范围 a-b] [--force] [--jobs N]"""
import os, sys, math, json
import numpy as np
import cv2

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import post
from hud import Hud

TELE = json.load(open(os.path.join(ROOT, "out", "telemetry.json")))
META, FR = TELE["meta"], TELE["frames"]
NITRO_F = [e["f"] for e in META["events"] if e["type"] == "nitro"]
_hud = None
_gfx = None


def params_for(f):
    t = FR[f - 1]
    chase = t["cam"] == "cam_chase"
    vn = min(1.0, t["v"] / 94.0)
    nit = t["nitro_env"] if chase else 0.0
    flash = 0.0
    for nf in NITRO_F:
        if 0 <= f - nf < 8:
            flash = max(flash, 0.22 * math.exp(-(f - nf) / 2.5))
    return dict(zoom=(0.022 * vn ** 2 + 0.050 * nit) if chase else 0.0, flash=flash, seed=f,
                ca=0.0010 + 0.0012 * nit, vignette=0.55 if chase else 0.62)


def do_frame(args):
    global _hud, _gfx
    f, src, dst = args
    if _hud is None:
        from gfx import Gfx
        _hud = Hud(); _gfx = Gfx()
    rgb, mist = post.read_exr(src)
    h, w = rgb.shape[:2]
    # 主角车处在暗处时，对车身区域做一个柔和的局部提亮，保证主角始终看得清
    box = _gfx.car_box(f - 1, _gfx.cam(f))
    if box is not None:
        sx, sy = w / _gfx.W, h / _gfx.H
        x0, y0, x1, y1 = box[0] * sx, box[1] * sy, box[2] * sx, box[3] * sy
        xa, xb, ya, yb = int(max(0, x0)), int(min(w, x1)), int(max(0, y0)), int(min(h, y1))
        if xb - xa > 8 and yb - ya > 8 and (xb - xa) < w * 0.9:
            lum = float((rgb[ya:yb, xa:xb] * np.float32([0.2126, 0.7152, 0.0722])).sum(-1).mean())
            gain = float(np.clip(0.075 / (lum + 1e-4), 1.0, 1.9))
            if gain > 1.02:
                yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
                cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
                rx, ry = (x1 - x0) * 0.78, (y1 - y0) * 0.85
                m = np.exp(-(((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2) * 1.1)
                rgb = rgb * (1 + (gain - 1) * m[..., None])
    img = post.grade(rgb, mist, center=(w / 2, h * 0.47), **params_for(f)).astype(np.float32) / 255.0
    if (w, h) != (1920, 1080):                       # 预览用的小图：先放大再叠图形层
        img = cv2.resize(img, (1920, 1080), interpolation=cv2.INTER_CUBIC)
        h, w = 1080, 1920
    g = _gfx.render(f).astype(np.float32) / 255.0   # 预乘 alpha
    if g[..., 3].any():
        fxglow = cv2.GaussianBlur(g[..., :3], (0, 0), 11.0)
        img = 1.0 - (1.0 - img) * (1.0 - np.clip(fxglow * 0.30, 0, 1))      # 涂鸦的颜色往周围环境里洇一点光
    img = img * (1 - g[..., 3:4]) + g[..., :3]
    hud = _hud.render(f)
    a = hud[..., 3:4].astype(np.float32) / 255.0
    hc = hud[..., :3].astype(np.float32) / 255.0
    glow = cv2.GaussianBlur(hc * a, (0, 0), 6.0)
    img = img * (1 - a) + hc * a
    img = 1.0 - (1.0 - img) * (1.0 - np.clip(glow * 0.25, 0, 1) * (1 - a))
    out = (np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)
    cv2.imwrite(dst, cv2.cvtColor(out, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_PNG_COMPRESSION, 1])
    return f


if __name__ == "__main__":
    argv = [a for a in sys.argv[1:] if not a.startswith("--")]
    force = "--force" in sys.argv
    jobs = 8
    if "--jobs" in sys.argv:
        jobs = int(sys.argv[sys.argv.index("--jobs") + 1]); argv = [a for a in argv if a != str(jobs)]
    src_dir, out_dir = argv[0], argv[1]
    a, b = (1, META["F_END"])
    if len(argv) > 2:
        a, b = (int(x) for x in argv[2].split("-"))
    os.makedirs(out_dir, exist_ok=True)
    todo = []
    for f in range(a, b + 1):
        src = os.path.join(src_dir, f"f{f:04d}.exr"); dst = os.path.join(out_dir, f"{f:04d}.png")
        if os.path.exists(src) and (force or not os.path.exists(dst)):
            todo.append((f, src, dst))
    print("frames to do:", len(todo))
    if jobs <= 1 or len(todo) < 4:
        for x in todo:
            do_frame(x)
    else:
        import multiprocessing as mp
        with mp.Pool(jobs) as pool:
            for i, f in enumerate(pool.imap_unordered(do_frame, todo, chunksize=4)):
                if i % 100 == 0:
                    print("done", i, flush=True)
    print("finished", len(todo))
