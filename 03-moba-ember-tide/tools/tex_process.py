#!/usr/bin/env python3
"""把 art/tex_src 里的手绘贴图处理成引擎用的平铺贴图。

每张输出两个文件到 public/assets/tex/：
  <name>_a.jpg   颜色（已做成四方连续）
  <name>_nh.png  R,G = 法线 xy（由明度推出的高度求梯度），B = 高度（混合用），A 不用
用法: python3 tools/tex_process.py [名字 ...]   不给名字就处理全部
"""
import sys, os, glob
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC, OUT, SIZE = os.path.join(ROOT, "art/tex_src"), os.path.join(ROOT, "public/assets/tex"), 1024
# 每张贴图的调整：band 接缝过渡带宽度，nstr 法线强度，gain/sat 明度和饱和度微调
# contrast 是围绕整张图平均色的对比度；tint 是三个通道各自的倍数
TWEAK = {
    "c_earth": dict(nstr=2.0, contrast=1.0, gain=0.86), "c_ash": dict(nstr=2.2, contrast=1.0, gain=1.22),
    "c_path": dict(nstr=3.0, contrast=0.9, gain=0.84), "c_ember": dict(nstr=2.4, gain=1.12),
    "m_rock": dict(nstr=2.4, contrast=0.9, gain=1.3, tint=(0.94, 0.98, 1.1)), "m_moss": dict(nstr=2.0, gain=1.22, sat=0.72, tint=(0.92, 1.0, 1.22)),
    "m_path": dict(nstr=3.0, gain=1.0, sat=0.85),
    "river_bed": dict(nstr=2.4), "mud_bank": dict(nstr=1.6, gain=1.1), "cliff_c": dict(nstr=3.4, gain=1.28), "cliff_m": dict(nstr=3.0, contrast=0.75, gain=0.92),
}

def seamless_1d(a, axis, band):
    n = a.shape[axis]; half = n // 2
    s = np.roll(a, half, axis=axis)
    x = np.arange(n) / (n - 1)
    d = np.minimum(x, 1 - x) / band            # 0 在边上，>=1 在过渡带以内
    w = np.clip(d, 0, 1); w = w * w * (3 - 2 * w)
    shape = [1, 1, 1]; shape[axis] = n
    w = w.reshape(shape)
    return a * w + s * (1 - w)

def process(name):
    t = dict(band=0.10, nstr=2.0, gain=1.0, sat=1.0, contrast=1.0, tint=(1.0, 1.0, 1.0)); t.update(TWEAK.get(name, {}))
    im = Image.open(os.path.join(SRC, name + ".png")).convert("RGB")
    a = np.asarray(im).astype(np.float32) / 255.0
    a = seamless_1d(a, 1, t["band"]); a = seamless_1d(a, 0, t["band"])
    im = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).resize((SIZE, SIZE), Image.LANCZOS)
    a = np.asarray(im).astype(np.float32) / 255.0
    lum = a @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    mean = a.reshape(-1, 3).mean(0)
    a = mean + (a - mean) * t["contrast"]
    l2 = (a @ np.array([0.299, 0.587, 0.114], dtype=np.float32))[..., None]
    a = np.clip((l2 + (a - l2) * t["sat"]) * t["gain"] * np.array(t["tint"], dtype=np.float32), 0, 1)
    # 高度：明度去掉大尺度起伏，只留石缝、裂纹这类中小尺度
    def blur(arr, r):
        pad = int(r * 3)
        p = np.pad(arr, pad, mode="wrap")
        b = np.asarray(Image.fromarray((p * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(r))).astype(np.float32) / 255.0
        return b[pad:-pad, pad:-pad]
    h = lum - blur(lum, 48) + 0.5
    h = blur(np.clip(h, 0, 1), 1.2)
    lo, hi = np.percentile(h, 1), np.percentile(h, 99)
    h = np.clip((h - lo) / max(hi - lo, 1e-4), 0, 1)
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * t["nstr"]
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * t["nstr"]
    nz = 1.0 / np.sqrt(gx * gx + gy * gy + 1.0)
    nh = np.stack([(-gx * nz) * 0.5 + 0.5, (-gy * nz) * 0.5 + 0.5, h, np.ones_like(h)], axis=-1)
    Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).save(os.path.join(OUT, name + "_a.jpg"), quality=92, subsampling=0)
    Image.fromarray((np.clip(nh, 0, 1) * 255).astype(np.uint8)).convert("RGBA").save(os.path.join(OUT, name + "_nh.png"), optimize=True)
    print(name, "mean rgb", [round(float(v), 3) for v in a.reshape(-1, 3).mean(0)], "lum", round(float(lum.mean()), 3))

os.makedirs(OUT, exist_ok=True)
names = sys.argv[1:] or sorted(os.path.splitext(os.path.basename(p))[0] for p in glob.glob(SRC + "/*.png"))
for n in names: process(n)
