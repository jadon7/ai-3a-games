#!/usr/bin/env python3
"""把 shots.py 的图拼成一张：每列一个“动作:帧”，每行一个视角，左上角写标签。
用法: python sheet2.py <前缀> "q:16,e:24,…" <视角数> <输出.jpg>"""
import sys
from PIL import Image, ImageDraw
prefix, items, nv, out = sys.argv[1], sys.argv[2].split(","), int(sys.argv[3]), sys.argv[4]
ims = [[Image.open(f"{prefix}_{k:02d}_{i}.png").convert("RGB") for i in range(nv)] for k in range(len(items))]
w, h = ims[0][0].size; r = Image.new("RGB", (w * len(items), h * nv)); d = ImageDraw.Draw(r)
for k, col in enumerate(ims):
    for i, im in enumerate(col): r.paste(im, (k * w, i * h))
    d.text((k * w + 6, 4), items[k], fill=(255, 40, 40))
if r.size[0] > 2400: r = r.resize((2400, int(r.size[1] * 2400 / r.size[0])))
r.save(out, quality=88); print("写好了", out, r.size)
