#!/usr/bin/env python3
"""把样板间逐块重绘的地面拼成一整张，输出引擎用的贴图。

输入：art/slice/raw/p_i_j.png（重绘结果）和 art/slice/guide/g_i_j.jpg（布局图），3×3 块，每块 24 米、相邻重叠 6 米，正中那块以防御塔为中心。
做的事：
  1. 校色：重绘结果一米多以上的大色块拉回布局图（重绘偶尔会把土路画成河床的颜色），细节用重绘的。
  2. 拼接：重叠带中间一条窄窄的羽化带，避免两块的细节叠成重影。
  3. 输出 public/assets/slice/ground.webp（4096 像素，约 68 像素/米）和 ground_n.webp（由明度推出来的细微起伏，让石板缝、草叶在斜光下有一点立体感）。
用法：python3 tools/slice_assemble.py [预览.jpg]
"""
import os, sys
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TP, TILE_M, STRIDE_M, N = 2048, 24.0, 18.0, 3
PPM = TP / TILE_M
STRIDE = STRIDE_M * PPM
SIZE = int(round(STRIDE * (N - 1) + TP))
OUT = os.path.join(ROOT, "public/assets/slice")

def blur(a, r):
    h, w = a.shape[:2]; k = 8
    im = Image.fromarray(np.clip(a * 255, 0, 255).astype(np.uint8)).resize((w // k, h // k), Image.BILINEAR).filter(ImageFilter.GaussianBlur(r / k))
    return np.asarray(im.resize((w, h), Image.BILINEAR)).astype(np.float32) / 255.0

acc = np.zeros((SIZE, SIZE, 3), np.float32); wsum = np.zeros((SIZE, SIZE, 1), np.float32)
# 每块的权重：离边缘越近越小。只在重叠带正中一条 FE 像素宽的带子里过渡
OV = TP - STRIDE; FE = 150.0
ramp = np.clip((np.minimum(np.arange(TP), TP - 1 - np.arange(TP)) - (OV - FE) / 2) / FE, 0, 1).astype(np.float32)
ramp = ramp * ramp * (3 - 2 * ramp)
for j in range(N):
    for i in range(N):
        raw = np.asarray(Image.open(os.path.join(ROOT, f"art/slice/raw/p_{i}_{j}.png")).convert("RGB").resize((TP, TP), Image.LANCZOS)).astype(np.float32) / 255.0
        gd = np.asarray(Image.open(os.path.join(ROOT, f"art/slice/guide/g_{i}_{j}.jpg")).convert("RGB").resize((TP, TP), Image.LANCZOS)).astype(np.float32) / 255.0
        R = 1.3 * PPM
        ratio = np.clip((blur(gd, R) + 0.02) / (blur(raw, R) + 0.02), 0.55, 1.9)
        rl = ratio.mean(axis=2, keepdims=True); ratio = rl + (ratio - rl) * 0.5
        fixed = np.clip(raw * ratio, 0, 1)
        wx = ramp.copy(); wy = ramp.copy()
        if i == 0: wx[:TP // 2] = 1
        if i == N - 1: wx[TP // 2:] = 1
        if j == 0: wy[:TP // 2] = 1
        if j == N - 1: wy[TP // 2:] = 1
        w = (wy[:, None] * wx[None, :])[..., None] + 1e-4
        x0, y0 = int(round(i * STRIDE)), int(round(j * STRIDE))
        acc[y0:y0 + TP, x0:x0 + TP] += fixed * w; wsum[y0:y0 + TP, x0:x0 + TP] += w
full = acc / wsum

# 修补：重绘有时会在草地上凭空画出一小片圆形铺地（布局图里那里是纯草地）。
# 试过按颜色自动找，会认错地方，所以这里明确列出来：每一处给出位置、半径，和用来盖它的那块干净草地相对它的偏移。
# 单位是整张图边长的比例（0 到 1），看拼好的预览图量出来的。重画地面以后要重新看一遍、重新列。
PATCHES = [
    (0.16, 0.17, 0.20, 0.04, 0.39),      # 左上角：一条石子路和两块褐斑
    (0.33, 0.31, 0.045, 0.0, 0.12),      # 左上：一小摊碎石
    (0.955, 0.82, 0.13, -0.20, 0.0),     # 右下角：一条小溪
]
for (px, py, pr, dx, dy) in PATCHES:
    X, Y, R, SX, SY = int(px * SIZE), int(py * SIZE), int(pr * SIZE), int((px + dx) * SIZE), int((py + dy) * SIZE)
    y0, y1, x0, x1 = max(Y - R, 0), min(Y + R, SIZE), max(X - R, 0), min(X + R, SIZE)
    yy, xx = np.mgrid[y0:y1, x0:x1]
    m = np.clip((R - np.hypot(yy - Y, xx - X)) / (R * 0.35), 0, 1)[..., None]
    src = full[np.clip(yy - Y + SY, 0, SIZE - 1), np.clip(xx - X + SX, 0, SIZE - 1)]
    full[y0:y1, x0:x1] = full[y0:y1, x0:x1] * (1 - m) + src * m
print("修补了", len(PATCHES), "处")
os.makedirs(OUT, exist_ok=True)
img = Image.fromarray((np.clip(full, 0, 1) * 255).astype(np.uint8))
g = img.resize((4096, 4096), Image.LANCZOS)
g.save(os.path.join(OUT, "ground.webp"), quality=90, method=6)
# 细微起伏：明度当高度（亮的石板面高、暗的缝低），求梯度得法线
lum = np.asarray(g.convert("L").filter(ImageFilter.GaussianBlur(0.8))).astype(np.float32) / 255.0
gx = np.roll(lum, -1, 1) - np.roll(lum, 1, 1); gy = np.roll(lum, -1, 0) - np.roll(lum, 1, 0)
S = 2.6
nx, ny, nz = -gx * S, gy * S, np.ones_like(lum)
inv = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz)
nrm = np.dstack([nx * inv * 0.5 + 0.5, ny * inv * 0.5 + 0.5, nz * inv * 0.5 + 0.5])
Image.fromarray((np.clip(nrm, 0, 1) * 255).astype(np.uint8)).save(os.path.join(OUT, "ground_n.webp"), quality=92, method=6)
print("ground", SIZE, "->", g.size, os.path.getsize(os.path.join(OUT, "ground.webp")) // 1024, "KB;", "normal", os.path.getsize(os.path.join(OUT, "ground_n.webp")) // 1024, "KB")
if len(sys.argv) > 1: g.resize((1400, 1400), Image.LANCZOS).save(sys.argv[1], quality=88)
