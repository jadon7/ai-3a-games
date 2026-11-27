#!/usr/bin/env python3
"""（卡兹版：模型原始坐标面朝 +X、左侧 +Y）按“权重最大的骨骼”给顶点上色，画侧 / 正 / 顶三视图，看每根骨骼到底管哪块。
用法: python plot_weights.py weights.npz out.jpg [只画这几根骨骼,逗号分隔]
"""
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

d = np.load(sys.argv[1], allow_pickle=True); V, W, names = d["V"], d["W"], [str(n) for n in d["names"]]
only = sys.argv[3].split(",") if len(sys.argv) > 3 else None
dom = W.argmax(1)
rng = np.random.default_rng(4); pal = (rng.uniform(60, 255, (len(names), 3))).astype(int)
pal[names.index("tripo::Root")] = (110, 110, 110)
S = 900; lo, hi = V.min(0), V.max(0); size = (hi - lo).max() * 1.1; c = (lo + hi) / 2
try: font = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 14)
except Exception: font = ImageFont.load_default()
views = {"side(从+Y看左侧,头在右)": (0, 2, 1, 1), "front(从+X看脸,右=+Y左侧)": (1, 2, 1, 0), "top(头在右,下=+Y左侧)": (0, 1, 1, 2)}
sheet = Image.new("RGB", (S * 3, S), (30, 30, 30))
for k, (title, (a, b, sa, depth)) in enumerate(views.items()):
    im = Image.new("RGB", (S, S), (30, 30, 30)); dr = ImageDraw.Draw(im)
    order = np.argsort(V[:, depth])
    for i in order:
        n = names[dom[i]]
        if only and n not in only: col = (70, 70, 70)
        else: col = tuple(pal[dom[i]])
        x = (sa * (V[i, a] - c[a]) / size + 0.5) * S; y = (0.5 - (V[i, b] - c[b]) / size * (1 if b == 2 else -1)) * S
        dr.point((x, y), fill=col)
    for j, n in enumerate(names):
        h, t = d["heads"][j], d["tails"][j]
        p = lambda q: ((sa * (q[a] - c[a]) / size + 0.5) * S, (0.5 - (q[b] - c[b]) / size * (1 if b == 2 else -1)) * S)
        dr.line([p(h), p(t)], fill=tuple(pal[j]), width=2); dr.text(p(h), n.replace("tripo::", ""), fill=(255, 255, 255), font=font, stroke_width=2, stroke_fill=(0, 0, 0))
    dr.text((8, 8), title, fill=(255, 255, 0), font=font)
    sheet.paste(im, (k * S, 0))
sheet.save(sys.argv[2], quality=90); print("写好了", sys.argv[2])
