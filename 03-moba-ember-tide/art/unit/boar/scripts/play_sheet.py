#!/usr/bin/env python3
"""把 play_boar.mjs 的连拍（1500×844）裁出野猪附近那块拼成一张。用法: python3 play_sheet.py <目录> <前缀 P 或 D> <输出.jpg> [列数=8] [x0,y0,x1,y1=480,170,1080,620] [起,止]"""
import sys, glob
from PIL import Image, ImageDraw
d, pre, out = sys.argv[1:4]; cols = int(sys.argv[4]) if len(sys.argv) > 4 else 8
box = tuple(int(v) for v in (sys.argv[5] if len(sys.argv) > 5 else "480,170,1080,620").split(","))
fs = sorted(glob.glob(f"{d}/{pre}_*.jpg"))
if len(sys.argv) > 6: a, b = map(int, sys.argv[6].split(",")); fs = fs[a:b + 1]
ims = []
for f in fs:
    im = Image.open(f).convert("RGB").crop(box); ImageDraw.Draw(im).text((6, 4), f.rsplit("_", 1)[1][:2], fill=(255, 255, 0)); ims.append(im)
w, h = ims[0].size; rows = (len(ims) + cols - 1) // cols; sh = Image.new("RGB", (cols * w, rows * h))
for i, im in enumerate(ims): sh.paste(im, ((i % cols) * w, (i // cols) * h))
if sh.size[0] > 2000: sh = sh.resize((2000, int(sh.size[1] * 2000 / sh.size[0])))
sh.save(out, quality=88); print(out, sh.size, len(ims))
