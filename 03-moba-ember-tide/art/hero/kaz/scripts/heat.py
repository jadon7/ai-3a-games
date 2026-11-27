#!/usr/bin/env python3
"""某几根骨骼的权重热图（红 = 权重高），叠着金属度（亮 = 金属），侧、正、顶三视图，只画指定范围。
用法: python heat.py weights.npz vtex.npz out.jpg 骨骼1,骨骼2 [x0,x1,z0]"""
import sys
import numpy as np
from PIL import Image, ImageDraw
d = np.load(sys.argv[1], allow_pickle=True); t = np.load(sys.argv[2])
V, W, names = d["V"], d["W"], [str(n).replace("tripo::", "") for n in d["names"]]
bones = sys.argv[4].split(","); w = W[:, [names.index(b) for b in bones]].sum(1)
x0, x1, z0 = map(float, sys.argv[5].split(",")) if len(sys.argv) > 5 else (-0.6, 0.6, -1)
met = t["orm"][:, 2]
sel = (V[:, 0] >= x0) & (V[:, 0] <= x1) & (V[:, 2] >= z0)
S = 800; lo, hi = V[sel].min(0), V[sel].max(0); size = (hi - lo).max() * 1.08; c = (lo + hi) / 2
def view(a, b, depth, flip=False):
    im = Image.new("RGB", (S, S), (25, 25, 25)); dr = ImageDraw.Draw(im)
    idx = np.where(sel)[0]; idx = idx[np.argsort(V[idx, depth])]
    for i in idx:
        x = (V[i, a] - c[a]) / size * S + S / 2; y = S / 2 - (V[i, b] - c[b]) / size * S * (-1 if flip else 1)
        g = int(60 + 150 * met[i]); col = (int(60 + 195 * w[i]), g if w[i] < 0.3 else int(g * 0.4), int(200 * (1 - w[i])))
        dr.rectangle([x, y, x + 2, y + 2], fill=col)
    return im
sh = Image.new("RGB", (S * 3, S)); sh.paste(view(0, 2, 1), (0, 0)); sh.paste(view(1, 2, 0), (S, 0)); sh.paste(view(0, 1, 2, True), (2 * S, 0))
sh.save(sys.argv[3], quality=88); print("写好了", sys.argv[3], "选中顶点", int(sel.sum()))
