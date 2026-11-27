"""设定图 / 游戏里的颜色对一对（w-quad）：英雄身上几类颜色的中位数。
设定图：灰底从四边漫水抠掉；游戏里：tools/style_b/pop.mjs 拍的“只有英雄 / 没有英雄”两张，差出来的像素当英雄。
分类（够粗，只为横向比）：亮部 = 亮度最高的 12%（卡兹是白颊毛、托尔格是钟口和头盔窗、奥森是白身子和蜡烛）；暗部 = 亮度最低的 30%（毛、甲）；
中间 = 其余；红/暖 = 色相 330–40° 且饱和度 > 0.45（耳簇、眼缝、烛火）；青绿 = 色相 150–200° 且饱和度 > 0.3（铜绿、发光）。
用法: python3.14 colors.py <输出.jpg> 设定图.png 游戏_hero.jpg[:游戏_none.jpg] …（每个一列，拼一张并排图，打印每列的数）
"""
import sys, colorsys
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from collections import deque

def lum(a): a = a / 255.0; return 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]

def cut_sheet(path):
    im = np.asarray(Image.open(path).convert("RGB")).astype(float); H, W, _ = im.shape
    bg = np.median(np.concatenate([im[0], im[-1], im[:, 0], im[:, -1]]), 0); d = np.abs(im - bg).max(-1)
    mask = np.zeros((H, W), bool); seen = np.zeros((H, W), bool); q = deque()
    for x in range(W): q.append((0, x)); q.append((H - 1, x))
    for y in range(H): q.append((y, 0)); q.append((y, W - 1))
    # 漫水：和底色差 < 14 的连通区域是背景（底是渐变灰，用相邻像素的差）
    while q:
        y, x = q.popleft()
        if seen[y, x]: continue
        seen[y, x] = True
        if d[y, x] > 40: continue
        mask[y, x] = True
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            yy, xx = y + dy, x + dx
            if 0 <= yy < H and 0 <= xx < W and not seen[yy, xx] and abs(im[yy, xx] - im[y, x]).max() < 10: q.append((yy, xx))
    return im, ~mask

def cut_game(path):
    a, b = path.split(":") if ":" in path else (path, path.replace("_hero", "_none"))
    A = np.asarray(Image.open(a).convert("RGB")).astype(float); B = np.asarray(Image.open(b).convert("RGB")).astype(float)
    return A, np.abs(A - B).max(-1) > 18

def stats(im, m):
    px = im[m]; L = lum(px); hsv = np.array([colorsys.rgb_to_hsv(*(p / 255.0)) for p in px[:: max(1, len(px) // 40000)]]); pxs = px[:: max(1, len(px) // 40000)]
    o = {"像素": int(m.sum())}
    lo, hi = np.percentile(L, 30), np.percentile(L, 88)
    o["暗部"] = np.median(px[L <= lo], 0); o["中间"] = np.median(px[(L > lo) & (L < hi)], 0); o["亮部"] = np.median(px[L >= hi], 0)
    h = hsv[:, 0] * 360; s = hsv[:, 1]
    red = ((h > 330) | (h < 40)) & (s > 0.45) & (hsv[:, 2] > 0.25); teal = (h > 150) & (h < 200) & (s > 0.3)
    o["红/暖"] = np.median(pxs[red], 0) if red.sum() > 30 else None; o["青绿"] = np.median(pxs[teal], 0) if teal.sum() > 30 else None
    o["亮度p10/p50/p90"] = np.percentile(L, [10, 50, 90]).round(2).tolist(); o["饱和度p90"] = round(float(np.percentile(s, 90)), 2)
    return o

out = sys.argv[1]; cols = []
F = ImageFont.truetype("/System/Library/Fonts/Hiragino Sans GB.ttc", 22)
for p in sys.argv[2:]:
    label = None
    if "=" in p: label, p = p.split("=", 1)
    im, m = cut_sheet(p) if p.endswith(".png") else cut_game(p)
    st = stats(im, m); ys, xs = np.where(m); y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max(); pad = int(0.06 * max(y1 - y0, x1 - x0))
    crop = Image.fromarray(im.astype(np.uint8)).crop((max(0, x0 - pad), max(0, y0 - pad), min(im.shape[1], x1 + pad), min(im.shape[0], y1 + pad)))
    crop = crop.resize((520, int(crop.size[1] * 520 / crop.size[0])))
    txt = [label or p.split("/")[-1]] + [f"{k} {tuple(int(x) for x in v) if isinstance(v, np.ndarray) else v}" for k, v in st.items() if k != "像素"]
    print(" | ".join(txt))
    cols.append((crop, txt))
H = max(c.size[1] for c, _ in cols) + 30 * 9
W = Image.new("RGB", (540 * len(cols), H), (24, 24, 28)); d = ImageDraw.Draw(W)
for i, (c, txt) in enumerate(cols):
    W.paste(c, (i * 540 + 10, 10))
    for j, t in enumerate(txt): d.text((i * 540 + 14, c.size[1] + 18 + j * 30), t, fill=(235, 235, 235), font=F)
W.save(out, quality=88); print("SAVED", out)
