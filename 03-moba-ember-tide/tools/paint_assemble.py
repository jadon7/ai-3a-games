#!/usr/bin/env python3
"""把逐块手绘重绘的地表拼成整张地图，再切成引擎用的贴图。

输入：art/paint/raw/p_i_j.png（重绘结果）和 art/paint/guide/g_i_j.jpg（布局图），6×6 块，
      每块 64 米、中心在 (-135 + 54i, -135 + 54j)，相邻重叠 10 米。
做的事：
  1. 校色：重绘结果的大尺度颜色（几米以上）拉回布局图，保证相邻两块、路和地面的明度关系都受控；细节用重绘的。
  2. 拼接：重叠带羽化混合。
  3. 输出 public/assets/paint/：
       c_i_j.webp   6×6 块，每块 55 米（正好 100 个地形格），1760 像素加四周 8 像素的出血边
       ground.webp  整张图的缩小版（2048 像素），物件接地混合时取地面颜色用
用法：python3 tools/paint_assemble.py [--preview 输出.jpg]
"""
import os, sys
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PPM, TILE_M, STRIDE, N = 32, 64, 54, 6
TP = TILE_M * PPM                                   # 一块 2048 像素
ORIGIN = -135 - TILE_M / 2                          # 拼图左上角的世界坐标：-167
SIZE = int((STRIDE * (N - 1) + TILE_M) * PPM)       # 10688
CHUNK_M, CHUNK0, GUT = 55, -165, 8                  # 引擎分块：6×6，每块 55 米，从 -165 开始
OUT = os.path.join(ROOT, "public/assets/paint")

def blur(a, r):
    # 大半径模糊：先缩小再模糊再放大，省时间
    h, w = a.shape[:2]; k = 8
    im = Image.fromarray(np.clip(a * 255, 0, 255).astype(np.uint8)).resize((w // k, h // k), Image.BILINEAR).filter(ImageFilter.GaussianBlur(r / k))
    return np.asarray(im.resize((w, h), Image.BILINEAR)).astype(np.float32) / 255.0

def box(a, r):
    """方形均值模糊（窗口边长 2r+1），a 是 HxWxC 的 0..1 浮点。用积分图算，和半径无关地快。"""
    k = 2 * r + 1
    p = np.pad(a.astype(np.float64), ((r + 1, r), (r + 1, r), (0, 0)), mode="edge").cumsum(0).cumsum(1)
    return ((p[k:, k:] - p[:-k, k:] - p[k:, :-k] + p[:-k, :-k]) / (k * k)).astype(np.float32)

def kuwahara(a, r=5):
    """笔触化：每个像素看它左上、右上、左下、右下四个小窗，取最“平”的那个窗的平均色。
    结果是一块块平的颜色、块与块之间的边是清楚的，像用平头笔画出来的，杂斑和糊边都没了。"""
    h = r // 2 + 1
    lum = (a @ np.array([0.3, 0.59, 0.11], np.float32))[..., None]
    m = box(a, h); m1 = box(lum, h); m2 = box(lum * lum, h)
    var = np.maximum(m2 - m1 * m1, 0)[..., 0]
    best = None; bestv = None
    for dy in (-h, h):
        for dx in (-h, h):
            mm = np.roll(m, (dy, dx), (0, 1)); vv = np.roll(var, (dy, dx), (0, 1))
            if best is None: best, bestv = mm.copy(), vv.copy()
            else:
                k = vv < bestv; best[k] = mm[k]; bestv[k] = vv[k]
    return best

def unsharp(a, r=1.2, amount=0.9):
    im = Image.fromarray(np.clip(a * 255, 0, 255).astype(np.uint8))
    b = np.asarray(im.filter(ImageFilter.GaussianBlur(r))).astype(np.float32) / 255.0
    return np.clip(a + (a - b) * amount, 0, 1)

def feather(n, edge):
    x = np.arange(n, dtype=np.float32)
    d = np.clip(np.minimum(x, n - 1 - x) / edge, 0, 1)
    return d * d * (3 - 2 * d)

def main():
    acc = np.zeros((SIZE, SIZE, 3), np.float32); wsum = np.zeros((SIZE, SIZE, 1), np.float32)
    w1 = feather(TP, (TILE_M - STRIDE) * PPM); w2 = (w1[:, None] * w1[None, :])[..., None] + 1e-4
    missing = []
    for i in range(N):
        for j in range(N):
            rp = os.path.join(ROOT, f"art/paint/raw/p_{i}_{j}.png"); gp = os.path.join(ROOT, f"art/paint/guide/g_{i}_{j}.jpg")
            g = np.asarray(Image.open(gp).convert("RGB").resize((TP, TP), Image.LANCZOS)).astype(np.float32) / 255.0
            if os.path.exists(rp):
                r = np.asarray(Image.open(rp).convert("RGB").resize((TP, TP), Image.LANCZOS)).astype(np.float32) / 255.0
                ratio = np.clip((blur(g, 110) + 0.02) / (blur(r, 110) + 0.02), 0.6, 1.9)
                t = np.clip(r * ratio, 0, 1)
                # 轻微去噪：重绘出来的图有一层细碎的杂斑，放到游戏里会和细节贴图打架。只抹掉 5 厘米以下的起伏。
                # （试过 kuwahara 笔触化：色块边缘会变成锯齿，画出来的石头和裂纹也被抹平，效果更差，所以没用。）
                t = np.asarray(Image.fromarray(np.clip(t * 255, 0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.6))).astype(np.float32) / 255.0
            else:
                missing.append((i, j)); t = g                                  # 没重绘出来的块先用布局图顶着
            x0, y0 = i * STRIDE * PPM, j * STRIDE * PPM
            acc[y0:y0 + TP, x0:x0 + TP] += t * w2; wsum[y0:y0 + TP, x0:x0 + TP] += w2
        print("row", i, flush=True)
    mosaic = np.clip(acc / wsum, 0, 1); del acc, wsum
    os.makedirs(OUT, exist_ok=True)
    cp = CHUNK_M * PPM                                                          # 1760
    off = int((CHUNK0 - ORIGIN) * PPM)                                          # 64
    for i in range(N):
        for j in range(N):
            x0, y0 = off + i * cp - GUT, off + j * cp - GUT
            c = mosaic[y0:y0 + cp + 2 * GUT, x0:x0 + cp + 2 * GUT]
            Image.fromarray((c * 255).astype(np.uint8)).save(os.path.join(OUT, f"c_{i}_{j}.webp"), quality=86, method=4)
    whole = mosaic[off:off + N * cp, off:off + N * cp]
    small = Image.fromarray((whole * 255).astype(np.uint8)).resize((2048, 2048), Image.LANCZOS)
    small.save(os.path.join(OUT, "ground.webp"), quality=88, method=4)
    if "--preview" in sys.argv: small.convert("RGB").save(sys.argv[sys.argv.index("--preview") + 1], quality=85)
    total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT) if f.startswith("c_"))
    print("done. missing tiles:", missing, "chunks total MB:", round(total / 1e6, 1))

if __name__ == "__main__":
    main()
