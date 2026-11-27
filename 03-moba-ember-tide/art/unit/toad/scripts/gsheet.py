#!/usr/bin/env python3
"""把 game_check.mjs 连拍的图按前缀和序号挑出来，裁一块拼成一张。用法: python3 gsheet.py <目录> <输出.jpg> <前缀> <起> <止> [步长=1] [裁剪 左,上,右,下（比例）=0.2,0.1,0.8,0.85] [每行几格=6]"""
import glob, sys
from PIL import Image, ImageDraw
d, out, pre, a, b = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5]); st = int(sys.argv[6]) if len(sys.argv) > 6 else 1
box = [float(x) for x in (sys.argv[7] if len(sys.argv) > 7 else "0.2,0.1,0.8,0.85").split(",")]; cols = int(sys.argv[8]) if len(sys.argv) > 8 else 6
ims = []
for i in range(a, b + 1, st):
    fs = glob.glob(f"{d}/{pre}_{i:02d}_*.jpg")
    if not fs: continue
    im = Image.open(fs[0]).convert("RGB"); W, H = im.size; im = im.crop((int(box[0] * W), int(box[1] * H), int(box[2] * W), int(box[3] * H)))
    ImageDraw.Draw(im).text((6, 4), fs[0].split("/")[-1][:-4], fill=(255, 255, 0)); ims.append(im)
w, h = ims[0].size; rows = (len(ims) + cols - 1) // cols; sh = Image.new("RGB", (w * cols, h * rows))
for k, im in enumerate(ims): sh.paste(im, ((k % cols) * w, (k // cols) * h))
sh.thumbnail((2700, 2700)); sh.save(out, quality=86); print(sh.size, len(ims))
