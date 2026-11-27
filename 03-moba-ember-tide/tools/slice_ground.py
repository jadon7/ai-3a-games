#!/usr/bin/env python3
"""样板间的地面贴图（第二版的做法）。

第一版是把地面切成 3×3 块分别重绘再拼，接缝处石板对不上，每块还会各自乱加东西。
第二版改成两步：
  1. 整块 60 米的地面一次重绘成一张图（art/slice/raw_v7/all_a.png，约 48 像素/米）：布局、颜色、石板和草地的融合都在这一张里定下来，没有接缝。
  2. 把这张图切成 2×2 块（每块 36 米，相邻重叠 12 米），每块放大后再重绘一遍“只加细节、不改内容”，得到约 80 像素/米的细节，再拼回去。
     四块都来自同一张底图，石板的位置是一致的，接缝处只需要窄窄地羽化。

用法：
  python3 tools/slice_ground.py split            切出四块放大的输入图 art/slice/refine/in_i_j.jpg
  python3 tools/slice_ground.py build [预览.jpg]  拼出 public/assets/slice/ground.webp 和 ground_n.webp
                                                 （art/slice/refine/out_i_j.png 四块齐了就用细化后的，否则直接放大底图）
"""
import os, sys
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MASTER = os.path.join(ROOT, "art/slice/raw_v7/all_a.png")
RDIR = os.path.join(ROOT, "art/slice/refine")
OUT = os.path.join(ROOT, "public/assets/slice")
SIZE_M, TILE_M, STRIDE_M, N = 60.0, 36.0, 24.0, 2
FINAL = 4096
REFINE_STONE, REFINE_GRASS = 0.5, 0.12

def blur(a, r):
    h, w = a.shape[:2]; k = 8
    im = Image.fromarray(np.clip(a * 255, 0, 255).astype(np.uint8)).resize((w // k, h // k), Image.BILINEAR).filter(ImageFilter.GaussianBlur(r / k))
    return np.asarray(im.resize((w, h), Image.BILINEAR)).astype(np.float32) / 255.0

def split():
    m = Image.open(MASTER).convert("RGB"); ppm = m.size[0] / SIZE_M
    os.makedirs(RDIR, exist_ok=True)
    for j in range(N):
        for i in range(N):
            x0, y0 = int(round(i * STRIDE_M * ppm)), int(round(j * STRIDE_M * ppm)); t = int(round(TILE_M * ppm))
            m.crop((x0, y0, x0 + t, y0 + t)).resize((2048, 2048), Image.LANCZOS).save(os.path.join(RDIR, f"in_{i}_{j}.jpg"), quality=95)
    print("切好了", N * N, "块，每块", TILE_M, "米")

def build(preview=None):
    master = Image.open(MASTER).convert("RGB").resize((FINAL, FINAL), Image.LANCZOS)
    full = np.asarray(master).astype(np.float32) / 255.0
    # 哪里是草：草是鲜艳的，石头是灰的。边缘抹软一点
    mx, mn = full.max(axis=2), full.min(axis=2)
    grass = np.clip(((mx - mn) / np.maximum(mx, 1e-3) - 0.3) / 0.14, 0, 1)
    grass = blur(np.dstack([grass] * 3), 6)[..., 0]
    tiles = [(i, j, os.path.join(RDIR, f"out_{i}_{j}.png")) for j in range(N) for i in range(N)]
    if all(os.path.exists(p) for _, _, p in tiles):
        ppm = FINAL / SIZE_M; T = int(round(TILE_M * ppm)); OV = (TILE_M - STRIDE_M) * ppm; FE = 220.0
        ramp = np.clip((np.minimum(np.arange(T), T - 1 - np.arange(T)) - (OV - FE) / 2) / FE, 0, 1).astype(np.float32); ramp = ramp * ramp * (3 - 2 * ramp)
        acc = np.zeros_like(full); wsum = np.zeros((FINAL, FINAL, 1), np.float32)
        for i, j, p in tiles:
            x0, y0 = int(round(i * STRIDE_M * ppm)), int(round(j * STRIDE_M * ppm))
            t = np.asarray(Image.open(p).convert("RGB").resize((T, T), Image.LANCZOS)).astype(np.float32) / 255.0
            ref = full[y0:y0 + T, x0:x0 + T]
            # 细化以后大色块可能漂一点：一米以上的颜色拉回底图，细节用细化的
            R = 1.0 * ppm; t = np.clip(t * np.clip((blur(ref, R) + 0.02) / (blur(t, R) + 0.02), 0.7, 1.4), 0, 1)
            wx, wy = ramp.copy(), ramp.copy()
            if i == 0: wx[:T // 2] = 1
            if i == N - 1: wx[T // 2:] = 1
            if j == 0: wy[:T // 2] = 1
            if j == N - 1: wy[T // 2:] = 1
            w = (wy[:, None] * wx[None, :])[..., None] + 1e-4
            acc[y0:y0 + T, x0:x0 + T] += t * w; wsum[y0:y0 + T, x0:x0 + T] += w
        # 细化的那一遍把石板表面画得太碎（像水刷石），不如底图干净。两者各取一部分：边缘和草叶更清楚，石板面还是整的
        # 草地上尤其明显（一地弯弯曲曲的亮笔触），所以草地几乎只用底图，石板多用一些细化的
        mix = (REFINE_STONE * (1 - grass) + REFINE_GRASS * grass)[..., None]
        full = full * (1 - mix) + (acc / np.maximum(wsum, 1e-4)) * mix; print("用了细化后的四块：石板占比", REFINE_STONE, "草地占比", REFINE_GRASS)
    else:
        print("细化的四块还没齐，先直接放大底图")
    os.makedirs(OUT, exist_ok=True)
    g = Image.fromarray((np.clip(full, 0, 1) * 255).astype(np.uint8))
    g.save(os.path.join(OUT, "ground.webp"), quality=90, method=6)
    # 细微起伏：明度当高度（亮的石板面高、暗的缝低），求梯度得法线
    lum = np.asarray(g.convert("L").filter(ImageFilter.GaussianBlur(1.5))).astype(np.float32) / 255.0
    gx = np.roll(lum, -1, 1) - np.roll(lum, 1, 1); gy = np.roll(lum, -1, 0) - np.roll(lum, 1, 0)
    S = 2.4 * (1 - 0.6 * grass)      # 草地上的起伏弱一些，不然斜光下一地碎影
    nx, ny, nz = -gx * S, gy * S, np.ones_like(lum); inv = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz)
    Image.fromarray((np.clip(np.dstack([nx * inv * 0.5 + 0.5, ny * inv * 0.5 + 0.5, nz * inv * 0.5 + 0.5]), 0, 1) * 255).astype(np.uint8)).save(os.path.join(OUT, "ground_n.webp"), quality=92, method=6)
    print("ground", g.size, os.path.getsize(os.path.join(OUT, "ground.webp")) // 1024, "KB; normal", os.path.getsize(os.path.join(OUT, "ground_n.webp")) // 1024, "KB")
    if preview: g.resize((1400, 1400), Image.LANCZOS).save(preview, quality=88)

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "build"
    if cmd == "split": split()
    else: build(sys.argv[2] if len(sys.argv) > 2 else None)
