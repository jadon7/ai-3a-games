#!/usr/bin/env python3
"""后期：读 Cycles 的线性 EXR（含雾通道），做雾气、辉光、拉丝光、径向模糊、色散、调色、暗角、颗粒 → PNG。
uv run --with opencv-python-headless --with openexr --with numpy python post.py <out_dir> <exr>...
也可以 import 后调用 grade()。"""
import os, sys, math
import numpy as np
import cv2

try:
    import OpenEXR
except Exception:  # noqa
    OpenEXR = None


def read_exr(path):
    """返回 (rgb float32 HxWx3, mist float32 HxW 或 None)。"""
    with OpenEXR.File(path, separate_channels=True) as f:
        ch = f.channels()
        names = list(ch.keys())

        def find(suffix):
            for n in names:
                if n.endswith(suffix):
                    return np.asarray(ch[n].pixels, dtype=np.float32)
            return None

        r, g, b = ch["R"].pixels, ch["G"].pixels, ch["B"].pixels
        r, g, b = (np.asarray(x, dtype=np.float32) for x in (r, g, b))
        mist = np.asarray(ch["A"].pixels, dtype=np.float32) if "A" in ch else None
    return np.dstack([r, g, b]), mist


DEFAULT = dict(
    exposure=1.35,
    haze_density=0.0026, haze_color=(0.024, 0.038, 0.056), haze_absorb=0.6,
    bloom_thr=1.5, bloom=0.20,
    streak=0.022, streak_tint=(0.6, 0.75, 1.0),
    glow=0.010,
    zoom=0.0,            # 径向模糊强度 0..0.1
    ca=0.0010,           # 色散
    contrast=1.08, saturation=1.02,
    shadow_tint=(-0.012, 0.006, 0.026), high_tint=(0.014, 0.004, -0.008),
    vignette=0.55, grain=0.010, seed=0,
    flash=0.0,
)


def _blur(img, sigma):
    if sigma < 12:
        return cv2.GaussianBlur(img, (0, 0), sigma)
    f = 4 if sigma < 60 else 8
    small = cv2.resize(img, (max(1, img.shape[1] // f), max(1, img.shape[0] // f)), interpolation=cv2.INTER_AREA)
    small = cv2.GaussianBlur(small, (0, 0), sigma / f)
    return cv2.resize(small, (img.shape[1], img.shape[0]), interpolation=cv2.INTER_LINEAR)


def _hable(x):
    A_, B_, C_, D_, E_, F_ = 0.22, 0.30, 0.10, 0.20, 0.01, 0.30
    return (x * (A_ * x + C_ * B_) + D_ * E_) / (x * (A_ * x + B_) + D_ * F_) - E_ / F_


def _tonemap(img):
    """按亮度做胶片曲线（保色相），高光逐渐褪色发白——亮的灯是白芯带色晕，而不是一坨纯色。"""
    lum = np.maximum((img * np.float32([0.2126, 0.7152, 0.0722])).sum(-1, keepdims=True), 1e-6)
    lt = _hable(lum * 2.0) / _hable(np.float32(11.2))
    out = img * (lt / lum)
    k = np.clip((lt - 0.55) / 0.45, 0, 1)
    k = k * k * (3 - 2 * k) * 0.8
    out = out * (1 - k) + lt * k
    over = np.maximum(out.max(-1, keepdims=True), 1.0)
    out = lt + (out - lt) / over
    return np.clip(out, 0, 1)


def _scale_about(img, s, cx, cy):
    M = np.float32([[s, 0, cx * (1 - s)], [0, s, cy * (1 - s)]])
    return cv2.warpAffine(img, M, (img.shape[1], img.shape[0]), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)


def grade(rgb, mist=None, center=None, **kw):
    P = dict(DEFAULT); P.update(kw)
    h, w = rgb.shape[:2]
    k = h / 1080.0
    img = np.nan_to_num(rgb.astype(np.float32), nan=0.0, posinf=50.0, neginf=0.0) * P["exposure"]
    img = np.clip(img, 0, 400)
    if mist is not None and P["haze_density"] > 0:
        f = 1.0 - np.exp(-(mist * 1000.0) * P["haze_density"])
        f = np.clip(f, 0, 1)[..., None]
        img = img * (1 - f * P["haze_absorb"]) + np.float32(P["haze_color"]) * f
    bright = np.maximum(img - P["bloom_thr"], 0)
    bright = np.minimum(bright, 60.0)
    acc = np.zeros_like(img)
    for sigma, wgt in ((2.5, 0.34), (8, 0.30), (24, 0.22), (64, 0.14)):
        acc += wgt * _blur(bright, sigma * k)
    img = img + acc * P["bloom"]
    if P["streak"] > 0:
        st = cv2.resize(bright, (w // 4, h // 2), interpolation=cv2.INTER_AREA)
        st = cv2.GaussianBlur(st, (0, 0), sigmaX=34 * k, sigmaY=0.9 * k)
        st = cv2.resize(st, (w, h), interpolation=cv2.INTER_LINEAR)
        img = img + st * np.float32(P["streak_tint"]) * P["streak"]
    if P["glow"] > 0:
        img = img + _blur(img, 48 * k) * P["glow"]
    cx, cy = (w / 2, h * 0.52) if center is None else center
    if P["zoom"] > 1e-4:
        n = 14
        zb = np.zeros_like(img)
        for i in range(n):
            zb += _scale_about(img, 1.0 + P["zoom"] * i / (n - 1), cx, cy)
        zb /= n
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        r = np.sqrt(((xx - cx) / (w * 0.5)) ** 2 + ((yy - cy) / (h * 0.62)) ** 2)
        m = np.clip((r - 0.28) / 0.6, 0, 1)[..., None]
        img = img * (1 - m) + zb * m
    ca = P["ca"] + P["zoom"] * 0.05
    if ca > 0:
        img[..., 0] = _scale_about(img[..., 0], 1 + ca, cx, cy)
        img[..., 2] = _scale_about(img[..., 2], 1 - ca, cx, cy)
    img = img * (1.0 + P["flash"])
    out = _tonemap(img)
    lum = (out * np.float32([0.2126, 0.7152, 0.0722])).sum(-1, keepdims=True)
    out = lum + (out - lum) * P["saturation"]
    out = (out - 0.5) * P["contrast"] + 0.5
    out = out + (1 - lum) ** 3 * np.float32(P["shadow_tint"]) + lum ** 2 * np.float32(P["high_tint"])
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    r2 = ((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2
    out = out * (1 - P["vignette"] * np.clip(r2 * 0.5, 0, 1) ** 1.3)[..., None]
    if P["grain"] > 0:
        rng = np.random.default_rng(P["seed"])
        g = rng.normal(0, P["grain"], (h, w, 1)).astype(np.float32)
        out = out + g * (0.35 + 0.65 * (1 - lum))
    out = np.clip(out, 0, 1)
    out = np.where(out <= 0.0031308, out * 12.92, 1.055 * np.power(out, 1 / 2.4) - 0.055)
    return (np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8)


if __name__ == "__main__":
    outdir = sys.argv[1]
    os.makedirs(outdir, exist_ok=True)
    for p in sys.argv[2:]:
        rgb, mist = read_exr(p)
        im = grade(rgb, mist)
        dst = os.path.join(outdir, os.path.splitext(os.path.basename(p))[0] + ".png")
        cv2.imwrite(dst, cv2.cvtColor(im, cv2.COLOR_RGB2BGR))
        print("ok", dst, rgb.shape, "mist" if mist is not None else "no-mist", "max", float(rgb.max()))
