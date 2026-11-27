#!/usr/bin/env python3
"""art4：把四个新英雄的即梦原图（art/ui/raw/）切成游戏里用的图，做法照 tools/ui_cut.py 和上一批海报。
  海报原图 poster_<id>_<选中>.png（1728×2304）→ splash/<id>.webp 1200×1600、face/<id>.webp 256×256（从原图裁脸）
  横版原图 poster_<id>_w*.png（2560×1440）→ wide/<id>.webp 1920×1080
  图标合集 skill_<id>_<选中>.png（3×2，2496×1664）→ skill/<id>_<p|q|w|e|r>.webp 160×160
用法: python3 art/ui/art4_cut.py
"""
import os
import numpy as np
from PIL import Image, ImageFilter
ROOT = "/Users/jadon7/Documents/SynologyDrive/code/moba"; RAW = ROOT + "/art/ui/raw"; OUT = ROOT + "/public/assets/ui"

# 选中的竖版原图；splash 的裁切框（左、上、宽，占原图宽的比例，高按 3:4 推），None 表示整张
SPLASH = {"kaz": ("poster_kaz_e1.png", None), "hedda": ("poster_hedda_r2.png", None), "ugo": ("poster_ugo_e1.png", None), "seren": ("poster_seren_e3.png", None)}
# 脸：中心（占宽、占高的比例）和裁多宽（占宽的比例），同 ui_cut.py 的 FACE。乌戈要把额前的灯球裁进来（缩到 40 像素时认他就靠那点光）
FACE = {"kaz": (0.30, 0.36, 0.40), "hedda": (0.58, 0.21, 0.36), "ugo": (0.55, 0.22, 0.68), "seren": (0.56, 0.24, 0.36)}
# 选中的横版原图；裁切框同上（按 16:9），None 表示整张
WIDE = {"kaz": ("poster_kaz_w1.png", None), "hedda": ("poster_hedda_w2.png", None), "ugo": ("poster_ugo_w1.png", None), "seren": ("poster_seren_w2.png", None)}
# 每个技能图标取自哪张合集的哪一格（格子从左到右、从上到下编 0..5）。第一轮赫达的烙印上冒出了 Dota 2 的标志、乌戈 E 缩小了只剩一片黑点、
# 塞伦 W 看不出是雷，这三个换成第二轮 skill_mix_b 里的备选。第三轮 skill_mix_c：塞伦 E 原来和摩珂 E（海螺号喷水）几乎一样，换成“铳往后震”；
# 卡兹 Q 原来是正脸、和 E 的吼头撞，换成侧身扑；乌戈被动原来是一只眼、和卡兹 R 的猫眼撞，换成“目标头顶悬一只眼”
ICONS = {
    "kaz": {"p": ("skill_kaz_a.png", 0), "q": ("skill_mix_c.png", 3), "w": ("skill_kaz_a.png", 2), "e": ("skill_kaz_a.png", 3), "r": ("skill_kaz_a.png", 4)},
    "hedda": {"p": ("skill_mix_b.png", 0), "q": ("skill_hedda_a.png", 1), "w": ("skill_hedda_a.png", 2), "e": ("skill_hedda_a.png", 3), "r": ("skill_hedda_a.png", 4)},
    "ugo": {"p": ("skill_mix_c.png", 4), "q": ("skill_ugo_a.png", 1), "w": ("skill_ugo_a.png", 2), "e": ("skill_mix_b.png", 2), "r": ("skill_ugo_a.png", 4)},
    "seren": {"p": ("skill_seren_a.png", 0), "q": ("skill_seren_a.png", 1), "w": ("skill_mix_b.png", 4), "e": ("skill_mix_c.png", 0), "r": ("skill_seren_a.png", 4)},
}

# 调亮度（gamma，<1 提亮，>1 压暗），让四张新图和六张旧图的平均亮度落在同一个范围（旧的六张 30～51）：
# 乌戈原图平均 26，比最暗的葛隆还暗，脸只剩灯球照到的一块；塞伦原图 72，左上角的天光让他在一排里最亮最跳
TONE = {"splash": {"ugo": 0.88, "seren": 1.25}, "wide": {"ugo": 0.85, "seren": 1.12}}
def tone(im, g):
    if g == 1: return im
    lut = [round(255 * (i / 255) ** g) for i in range(256)]
    return im.point(lut * 3)

made = []
def save(im, rel, size, q=88):
    p = f"{OUT}/{rel}.webp"; os.makedirs(os.path.dirname(p), exist_ok=True)
    im.convert("RGB").resize(size, Image.LANCZOS).save(p, quality=q, method=6); made.append(p)

def box(im, b, aspect):
    if not b: return im
    l, t, w = b; W = im.width * w; H = W / aspect
    return im.crop((int(im.width * l), int(im.height * t), int(im.width * l + W), int(im.height * t + H)))

def bands(frac, n):
    """frac：每一列（行）里纯黑像素的比例。分隔线和外框是纯黑（亮度 0），图标的深色底不是纯黑——
    用“均值很暗”去找会把深色的图标也当成分隔线（第一版就切歪了）。返回 n 段图标的 (起, 止)，找不到就均分。"""
    L = len(frac); runs = []; s = None
    for i, v in enumerate(list(frac) + [0]):
        if v > 0.9 and s is None: s = i
        if v <= 0.9 and s is not None:
            if i - s >= 3: runs.append((s, i - 1))
            s = None
    lo = runs[0][1] + 1 if runs and runs[0][0] == 0 else 0
    hi = runs[-1][0] - 1 if runs and runs[-1][1] == L - 1 else L - 1
    edges = [lo]
    for k in range(1, n):
        c = L * k / n; near = [r for r in runs if abs((r[0] + r[1]) / 2 - c) < L / n / 4]
        r = min(near, key=lambda r: abs((r[0] + r[1]) / 2 - c)) if near else (int(c), int(c))
        edges += [r[0] - 1, r[1] + 1]
    edges.append(hi)
    return [(edges[2 * i], edges[2 * i + 1]) for i in range(n)]

def cells(path, cols, rows, inset=0.02):
    im = Image.open(path).convert("RGB"); black = np.asarray(im.convert("L")) < 6
    xs = bands(black.mean(0), cols); ys = bands(black.mean(1), rows)
    for r in range(rows):
        for c in range(cols):
            x0, x1 = xs[c]; y0, y1 = ys[r]; s = min(x1 - x0, y1 - y0) * (1 - inset * 2); cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
            yield im.crop((int(cx - s / 2), int(cy - s / 2), int(cx + s / 2), int(cy + s / 2)))

for hid, (src, b) in SPLASH.items():
    im = tone(Image.open(f"{RAW}/{src}").convert("RGB"), TONE["splash"].get(hid, 1)); save(box(im, b, 3 / 4), "splash/" + hid, (1200, 1600))
    cx, cy, k = FACE[hid]; s = im.width * k
    x0 = max(0, min(im.width - s, im.width * cx - s / 2)); y0 = max(0, min(im.height - s, im.height * cy - s / 2))
    f = im.crop((int(x0), int(y0), int(x0 + s), int(y0 + s))).resize((256, 256), Image.LANCZOS).filter(ImageFilter.UnsharpMask(1.2, 40, 2))
    save(f, "face/" + hid, (256, 256))
for hid, (src, b) in WIDE.items():
    save(box(tone(Image.open(f"{RAW}/{src}").convert("RGB"), TONE["wide"].get(hid, 1)), b, 16 / 9), "wide/" + hid, (1920, 1080))
_cells = {}
for hid, order in ICONS.items():
    for key, (src, i) in order.items():
        if src not in _cells: _cells[src] = list(cells(f"{RAW}/{src}", 3, 2))
        save(_cells[src][i], f"skill/{hid}_{key}", (160, 160))
print(len(made), "张，合计", round(sum(os.path.getsize(p) for p in made) / 1e6, 2), "MB")
