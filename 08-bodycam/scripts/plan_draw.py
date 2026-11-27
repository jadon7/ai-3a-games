"""画平面图：不同高度的截线用不同颜色。 plan_draw.py <npz> <out.png> <floor_z> [ppm] [scale]"""
import sys, numpy as np
from PIL import Image, ImageDraw
d = np.load(sys.argv[1]); V = d["V"].astype(np.float64); T = d["T"]
fz = float(sys.argv[3]); ppm = float(sys.argv[4]) if len(sys.argv) > 4 else 80
sc = float(sys.argv[5]) if len(sys.argv) > 5 else 1.0
V = V * sc
mn = V.min(0); mx = V.max(0)
W = int((mx[0] - mn[0]) * ppm) + 80; H = int((mx[1] - mn[1]) * ppm) + 80
im = Image.new("RGB", (W, H), (18, 18, 18)); dr = ImageDraw.Draw(im)
def px(x, y): return (40 + (x - mn[0]) * ppm, H - 40 - (y - mn[1]) * ppm)
# 网格线
import math
for gx in range(math.floor(mn[0]), math.ceil(mx[0]) + 1):
    dr.line([px(gx, mn[1]), px(gx, mx[1])], fill=(45, 45, 45)); dr.text((px(gx, mn[1])[0] + 2, H - 14), str(gx), fill=(150, 150, 150))
for gy in range(math.floor(mn[1]), math.ceil(mx[1]) + 1):
    dr.line([px(mn[0], gy), px(mx[0], gy)], fill=(45, 45, 45)); dr.text((2, px(mn[0], gy)[1] - 6), str(gy), fill=(150, 150, 150))
P = V[T]
def slice_at(z, col, w=1):
    zz = P[:, :, 2]; lo = zz.min(1); hi = zz.max(1)
    sel = P[(lo < z) & (hi > z)]
    for tri in sel:
        pts = []
        for a, b in ((0, 1), (1, 2), (2, 0)):
            za, zb = tri[a, 2], tri[b, 2]
            if (za - z) * (zb - z) < 0:
                t = (z - za) / (zb - za); p = tri[a] + t * (tri[b] - tri[a]); pts.append(px(p[0], p[1]))
        if len(pts) == 2: dr.line(pts, fill=col, width=w)
for dz, col in ((2.3, (70, 70, 200)), (1.7, (60, 170, 60)), (1.0, (230, 230, 230)), (0.3, (230, 120, 40))):
    slice_at(fz + dz, col)
im.save(sys.argv[2]); print("saved", sys.argv[2], W, H, "bbox", mn.round(2), mx.round(2))
