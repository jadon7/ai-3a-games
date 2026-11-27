#!/usr/bin/env python3
"""把“纯色背景上摆着一排排物件”的图集抠成带透明通道的贴图图集。

  1. 抠掉品红背景：按“品红程度”（红蓝都高、绿低）算透明度，并把边缘沾到的品红色去掉。
  2. 找出每个物件（连通块），按从上到下、从左到右排序。
  3. 每个物件等比缩放后放进一个方格，重新排成规整的网格。植物类靠下对齐（根在格子底边），其余居中。
  4. 透明区域里填上邻近的颜色，避免缩小和过滤时边缘发黑。
输出 public/assets/atlas/<名字>.webp 和 <名字>.json（每格里物件占的宽高比例，运行时按它定大小）。

用法: python tools/atlas_key.py <名字> <列数> <行数> [bottom|center] [格子像素=512]
      python tools/atlas_key.py veins 2 2 glow      # 黑底发光图：不抠图，只重新排格子
要用装了 scipy 的 Python（video2rig 的 .venv）。
"""
import sys, os, json
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
name, cols, rows = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
anchor = sys.argv[4] if len(sys.argv) > 4 else "center"
CELL = int(sys.argv[5]) if len(sys.argv) > 5 else 512
src = np.asarray(Image.open(os.path.join(ROOT, f"art/atlas_src/{name}.png")).convert("RGB")).astype(np.float32) / 255.0
H, W = src.shape[:2]
glow = anchor == "glow"

if glow:
    alpha = np.clip((src.max(axis=2) - 0.05) / 0.2, 0, 1)
    rgb = src
else:
    r, g, b = src[..., 0], src[..., 1], src[..., 2]
    mag = np.minimum(r, b) - g                                   # 品红程度：背景接近 1，物件接近 0 或负
    strict = os.environ.get("KEY_STRICT") == "1"                 # 没有深色描边的写实贴图：边缘更容易沾品红，抠得更狠一些
    alpha = 1.0 - (np.clip((mag - 0.10) / 0.24, 0, 1) if strict else np.clip((mag - 0.22) / 0.34, 0, 1))
    alpha = alpha * alpha * (3 - 2 * alpha)
    rgb = src.copy()
    if strict:
        # 品红会同时抬高红和蓝：把“红蓝同时高出绿”的那部分整个减掉
        m = np.maximum(mag, 0)
        rgb[..., 0] = r - m * 0.95; rgb[..., 2] = b - m * 0.95
        # 透明度往里收两个像素再柔化，去掉最外一圈混色的边
        alpha = ndimage.minimum_filter(alpha, 5)
        alpha = ndimage.gaussian_filter(alpha, 1.2)
    else:
        # 去掉沾上的品红：红蓝不许比绿高出太多
        lim = g + np.maximum(mag, 0) * 0.15
        spill = np.clip(mag / 0.3, 0, 1)
        rgb[..., 0] = r * (1 - spill) + np.minimum(r, lim + 0.08) * spill
        rgb[..., 2] = b * (1 - spill) + np.minimum(b, lim) * spill

if not glow:
    # 发光植物外面那圈光晕是“背景品红 + 青色光”混出来的粉紫色：按“最少要多少不透明度才能从品红底上混出这个颜色”收掉
    bluish = np.clip((src[..., 2] - src[..., 0]) / 0.12, 0, 1)
    amin = np.maximum(src[..., 1], np.maximum(1 - src[..., 0], 1 - src[..., 2]))
    cut = np.clip((amin - 0.42) / 0.26, 0, 1)
    alpha = alpha * (1 - bluish * (1 - cut))

if anchor == "bottom":
    # 有的图会在每排植物脚下画一条横贯的黑色地平线，把一整排连成一个物件：
    # 深色像素里凡是能连成一长段水平线的（植物的茎不会），连同上下几个像素一起擦掉
    dark = src.max(axis=2) < 0.3
    line = ndimage.binary_opening(dark, structure=np.ones((1, W // 5), bool))
    line = ndimage.binary_dilation(line, structure=np.ones((9, 5), bool))
    alpha[line & (src.max(axis=2) < 0.45)] = 0

# 连通块：先把很近的碎片并在一起（一堆小石子算一个物件）
solid = ndimage.binary_dilation(alpha > 0.5, iterations=max(4, W // 250))
lab, n = ndimage.label(solid)
objs = ndimage.find_objects(lab)
areas = ndimage.sum(alpha > 0.5, lab, range(1, n + 1))
items = [(areas[i], objs[i]) for i in range(n) if areas[i] > W * H * 0.0012]
items.sort(key=lambda t: -t[0]); items = items[:cols * rows]
# 按行排序：先按中心 y 分行，再行内按 x
cy = (lambda sl: sl[0].stop) if anchor == "bottom" else (lambda sl: (sl[0].start + sl[0].stop) / 2)
cx = lambda sl: (sl[1].start + sl[1].stop) / 2
items.sort(key=lambda t: cy(t[1]))
ordered = []
for rr in range(rows):
    row = items[rr * cols:(rr + 1) * cols]; row.sort(key=lambda t: cx(t[1])); ordered += row
print(name, "found", n, "kept", len(ordered))

atlas = np.zeros((rows * CELL, cols * CELL, 4), np.float32)
meta = []
PAD = 10
for k, (_, sl) in enumerate(ordered):
    y0, y1, x0, x1 = max(sl[0].start - 4, 0), min(sl[0].stop + 4, H), max(sl[1].start - 4, 0), min(sl[1].stop + 4, W)
    crop = np.dstack([rgb[y0:y1, x0:x1], alpha[y0:y1, x0:x1]])
    h, w = crop.shape[:2]; s = (CELL - 2 * PAD) / max(h, w)
    nw, nh = max(1, round(w * s)), max(1, round(h * s))
    im = Image.fromarray((np.clip(crop, 0, 1) * 255).astype(np.uint8), "RGBA").resize((nw, nh), Image.LANCZOS)
    c = np.asarray(im).astype(np.float32) / 255.0
    gx, gy = k % cols, k // cols
    ox = gx * CELL + (CELL - nw) // 2
    oy = gy * CELL + ((CELL - PAD - nh) if anchor == "bottom" else (CELL - nh) // 2)
    atlas[oy:oy + nh, ox:ox + nw] = c
    meta.append({"cell": k, "w": round(nw / CELL, 4), "h": round(nh / CELL, 4)})

a = atlas[..., 3:4]
if not glow:
    # 颜色往透明区域里“渗”几圈
    col = atlas[..., :3] * a; wsum = a.copy()
    for _ in range(6):
        cb = np.stack([ndimage.uniform_filter(col[..., i], 9) for i in range(3)], -1); wb = ndimage.uniform_filter(wsum[..., 0], 9)[..., None]
        fill = cb / np.maximum(wb, 1e-5)
        m = (wsum < 1e-3).astype(np.float32)
        col = col * (1 - m) + fill * m * np.minimum(wb * 50, 1); wsum = np.maximum(wsum, np.minimum(wb * 50, 1) * m)
    rgb_out = np.where(a > 1e-3, atlas[..., :3], col / np.maximum(wsum, 1e-5))
else:
    rgb_out = atlas[..., :3] * a
out = np.dstack([rgb_out, a if not glow else np.ones_like(a)])
os.makedirs(os.path.join(ROOT, "public/assets/atlas"), exist_ok=True)
img = Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8), "RGBA")
if glow: img.convert("RGB").save(os.path.join(ROOT, f"public/assets/atlas/{name}.jpg"), quality=90)
else: img.save(os.path.join(ROOT, f"public/assets/atlas/{name}.webp"), quality=90, method=6, exact=True)   # exact：保留透明区域里的颜色，缩小时边缘才不会发黑
json.dump({"cols": cols, "rows": rows, "items": meta}, open(os.path.join(ROOT, f"public/assets/atlas/{name}.json"), "w"))
# 预览：棋盘格背景上看抠得干不干净
if len(sys.argv) > 6:
    yy, xx = np.mgrid[0:out.shape[0], 0:out.shape[1]]
    chk = (((yy // 32) + (xx // 32)) % 2 * 0.25 + 0.35)[..., None]
    pv = out[..., :3] * out[..., 3:4] + chk * (1 - out[..., 3:4]) if not glow else out[..., :3]
    Image.fromarray((np.clip(pv, 0, 1) * 255).astype(np.uint8)).resize((out.shape[1] // 2, out.shape[0] // 2), Image.LANCZOS).save(sys.argv[6], quality=85)
