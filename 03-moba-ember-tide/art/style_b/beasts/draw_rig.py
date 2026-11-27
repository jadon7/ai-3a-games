"""把 dump_rig.py 读出来的骨架画成三视图（侧面、正面、顶面）：网格顶点按“主管骨骼”上色，骨骼画成线段加名字。
给四足写映射用：Tripo 的四足绑骨骨骼名每次不一样，要先看清哪根是哪条腿的哪一节。
用法: python3.14 art/style_b/beasts/draw_rig.py <rig.npz> <输出.jpg> [只标这些骨骼名里含的字，逗号分开]
"""
import sys, colorsys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

d = np.load(sys.argv[1]); out = sys.argv[2]
names = [str(x) for x in d["names"]]; head = d["head"]; tail = d["tail"]; parent = d["parent"]; V = d["verts"]; wi = d["widx"]; wv = d["wval"]
dom = wi[np.arange(len(wi)), wv.argmax(1)]
B = len(names); cols = [tuple(int(c * 255) for c in colorsys.hsv_to_rgb((i * 0.618) % 1, 0.75, 0.95)) for i in range(B)]
try: font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 13)
except Exception: font = None
views = [("side (+X 看过去，左边是前)", (1, 2), (1, -1)), ("front (从前面看，-Y)", (0, 2), (1, -1)), ("top (从上往下)", (1, 0), (1, 1))]
W = 900; ims = []
lo = V.min(0); hi = V.max(0); span = (hi - lo).max() * 1.08; ctr = (lo + hi) / 2
for title, (a, b), (sa, sb) in views:
    im = Image.new("RGB", (W, W), (245, 245, 245)); dr = ImageDraw.Draw(im)
    def P(p): return (W / 2 + sa * (p[a] - ctr[a]) / span * W * (-1 if a == 1 else 1), W / 2 + sb * (p[b] - ctr[b]) / span * W)
    order = np.argsort(V[:, 0] if a != 0 else V[:, 1])
    for i in order[::3]:
        x, y = P(V[i]); c = cols[dom[i]]; dr.point((x, y), fill=tuple(int(cc * 0.55 + 245 * 0.45) for cc in c))
    for i in range(B):
        h = P(head[i]); t = P(tail[i]); dr.line([h, t], fill=cols[i], width=3); dr.ellipse([h[0] - 3, h[1] - 3, h[0] + 3, h[1] + 3], fill=(0, 0, 0))
    for i in range(B):
        h = P(head[i]); dr.text((h[0] + 4, h[1] - 6), names[i].replace("tripo::", "").replace("_Limb_", "L"), fill=(0, 0, 0), font=font)
    dr.text((10, 10), title, fill=(0, 0, 0), font=font); ims.append(im)
sheet = Image.new("RGB", (W * 3, W), (255, 255, 255))
for k, im in enumerate(ims): sheet.paste(im, (k * W, 0))
sheet.save(out, quality=88)
# 文字：每根骨骼的父、头尾位置、方向、管多少顶点
cnt = np.bincount(dom, minlength=B)
for i in range(B):
    dv = tail[i] - head[i]; dv = dv / (np.linalg.norm(dv) + 1e-12)
    print(f"{i:2d} {names[i]:26s} parent={names[parent[i]] if parent[i] >= 0 else '-':24s} head=({head[i][0]:+.3f},{head[i][1]:+.3f},{head[i][2]:+.3f}) dir=({dv[0]:+.2f},{dv[1]:+.2f},{dv[2]:+.2f}) verts={cnt[i]}")
