#!/usr/bin/env python3
"""把 tools/anim_sheet.mjs 截的大图（边长 840）裁出中间有猪的那块再拼，比 tools/asheet.py 看得清。
用法: python3 asheet_big.py <截图目录> <动作> <机位> <输出.jpg> [列数=5] [裁剪比例 x0,y0,x1,y1=0.14,0.18,0.86,0.82]"""
import sys, glob
from PIL import Image, ImageDraw
d, act, view, out = sys.argv[1:5]; cols = int(sys.argv[5]) if len(sys.argv) > 5 else 5
x0, y0, x1, y1 = [float(v) for v in (sys.argv[6] if len(sys.argv) > 6 else "0.14,0.18,0.86,0.82").split(",")]
fs = sorted(glob.glob(f"{d}/{act}_{view}_*.jpg")); ims = []
for i, f in enumerate(fs):
    im = Image.open(f).convert("RGB"); W, H = im.size; im = im.crop((int(W * x0), int(H * y0), int(W * x1), int(H * y1))); ImageDraw.Draw(im).text((6, 4), f"{act} {i}/{len(fs) - 1}", fill=(255, 255, 0)); ims.append(im)
w, h = ims[0].size; rows = (len(ims) + cols - 1) // cols; sh = Image.new("RGB", (cols * w, rows * h))
for i, im in enumerate(ims): sh.paste(im, ((i % cols) * w, (i // cols) * h))
if sh.size[0] > 2000: sh = sh.resize((2000, int(sh.size[1] * 2000 / sh.size[0])))
sh.save(out, quality=88); print(out, sh.size)
