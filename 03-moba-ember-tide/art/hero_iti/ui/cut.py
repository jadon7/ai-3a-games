#!/usr/bin/env python3
"""iti-art：把即梦出的伊缇原图（worktree 的 art/hero_iti/ui/raw/，不进 git）切成游戏里用的图，写进这个 worktree 的 public/assets/ui/。
尺寸、命名、切法照卡通版换图那次（tools/style_b/art_cut.py）：竖版 splash/iti.webp 1200×1600；头像 face/iti.webp 256×256（从竖版原图裁脸）；
横版 wide/iti.webp 1920×1080；技能图标 skill/iti_<p|q|w|e|r>.webp 160×160（3 列 2 行的合集按纯黑隔线找格子）。
用法: python3.14 art/hero_iti/ui/cut.py   （在 worktree 根目录跑；选哪张原图、哪一格写在下面）
"""
import os
import numpy as np
from PIL import Image, ImageFilter
HERE = os.path.dirname(os.path.abspath(__file__)); RAW = os.path.join(HERE, "raw")
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(HERE))), "public/assets/ui")

# 竖版用 p2f1：x-e2（第一轮 x 构图改成反握的那张）放进总表比另外十张近一倍，往后拉远成 p2（满月正衬在头后、身后 X 形新月刀光、屋檐），再修掉身后多出的半透明腿
SPLASH = ("splash_x-p2f1.png", None)                # 原图、裁切框（左、上、宽，占原图宽的比例，高按 3:4 推；None 是整张）
FACE = (0.505, 0.255, 0.40, "splash_x-e2.png")     # 头像从近景的 x-e2 裁（p2f1 里头太小，裁出来糊）；银白短发、绯红眼、面具都要进来，缩到四五十像素时靠这三样认人：中心（占宽、占高）、裁多宽（占宽）、从哪张原图裁（None 是竖版那张）
WIDE = ("wide_l1.png", None)                       # 从 x-e2 出的 l1。l2 头发顶到上边；从 p2f1 出的 l3、l4 把 X 刀光画到了左半边（那里要放标题，要干净）
# 每个技能取哪张合集的第几格（0..5，从左到右、从上到下）。被动不用“三道刻痕刻在铁板上”（a0、b0、c0）：和卡兹被动的三道爪痕烧进黑铁板太像，
# 用 a5“三颗火苗记号 + 绽开的尖瓣花”；Q 用 c1 三道新月斜切；W 用 c3 火焰残影和本体之间一条双头弧线（换位）；E 用 a3 反握下刺；R 用 a4 绯月 + X 新月 + 刀网
SKILL = {"p": ("skill_a.png", 5), "q": ("skill_c.png", 1), "w": ("skill_c.png", 3), "e": ("skill_a.png", 3), "r": ("skill_a.png", 4)}

made = []
def save(im, rel, size, q=88):
    p = f"{OUT}/{rel}.webp"; os.makedirs(os.path.dirname(p), exist_ok=True)
    im.convert("RGB").resize(size, Image.LANCZOS).save(p, quality=q, method=6); made.append(p)

def box(im, b, aspect):
    if not b: return im
    l, t, w = b; W = im.width * w; H = W / aspect
    return im.crop((int(im.width * l), int(im.height * t), int(im.width * l + W), int(im.height * t + H)))

def bands(frac, n):
    """和 tools/style_b/art_cut.py 一样：frac 是每一列（行）里纯黑像素的比例，返回 n 段图标的 (起, 止)，找不到黑线就均分。"""
    L = len(frac); runs = []; s = None
    for i, v in enumerate(list(frac) + [0]):
        if v > 0.85 and s is None: s = i
        if v <= 0.85 and s is not None:
            if i - s >= 3: runs.append((s, i - 1))
            s = None
    lo = runs[0][1] + 1 if runs and runs[0][0] == 0 else 0
    hi = runs[-1][0] - 1 if runs and runs[-1][1] == L - 1 else L - 1
    edges = [lo]
    for k in range(1, n):
        c = lo + (hi - lo) * k / n; near = [r for r in runs if abs((r[0] + r[1]) / 2 - c) < L / n / 4]
        r = min(near, key=lambda r: abs((r[0] + r[1]) / 2 - c)) if near else (int(c), int(c))
        edges += [r[0] - 1, r[1] + 1]
    edges.append(hi)
    return [(edges[2 * i], edges[2 * i + 1]) for i in range(n)]

_cells = {}
def cells(name, cols=3, rows=2, inset=0.03):
    if name in _cells: return _cells[name]
    im = Image.open(f"{RAW}/{name}").convert("RGB"); black = np.asarray(im.convert("L")) < 8
    xs = bands(black.mean(0), cols); ys = bands(black.mean(1), rows); out = []
    for r in range(rows):
        for c in range(cols):
            x0, x1 = xs[c]; y0, y1 = ys[r]; s = min(x1 - x0, y1 - y0) * (1 - inset * 2); cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
            out.append(im.crop((int(cx - s / 2), int(cy - s / 2), int(cx + s / 2), int(cy + s / 2))))
    _cells[name] = out; return out

if __name__ == "__main__":
    im = Image.open(f"{RAW}/{SPLASH[0]}").convert("RGB")
    save(box(im, SPLASH[1], 3 / 4), "splash/iti", (1200, 1600))
    cx, cy, k, src = FACE; fim = Image.open(f"{RAW}/{src}").convert("RGB") if src else im; s = fim.width * k
    x0 = max(0, min(fim.width - s, fim.width * cx - s / 2)); y0 = max(0, min(fim.height - s, fim.height * cy - s / 2))
    save(fim.crop((int(x0), int(y0), int(x0 + s), int(y0 + s))).resize((256, 256), Image.LANCZOS).filter(ImageFilter.UnsharpMask(1.2, 40, 2)), "face/iti", (256, 256))
    if os.path.exists(f"{RAW}/{WIDE[0]}"): save(box(Image.open(f"{RAW}/{WIDE[0]}").convert("RGB"), WIDE[1], 16 / 9), "wide/iti", (1920, 1080), q=82)
    for key, (src, i) in SKILL.items(): save(cells(src)[i], f"skill/iti_{key}", (160, 160))
    print(len(made), "张，合计", round(sum(os.path.getsize(p) for p in made) / 1e6, 2), "MB")
