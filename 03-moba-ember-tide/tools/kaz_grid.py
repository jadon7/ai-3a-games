#!/usr/bin/env python3.14
# 看帧用：从 fxclip 录的一个技能的帧里，按帧号均匀取几张拼成一格一格的图。
# 用法: python3 grid.py <输出.jpg> <帧目录> <起始帧> <结束帧> <取几张> [每行几张=4] [每格宽=640] [裁剪 x0,y0,x1,y1]
import sys, os
from PIL import Image, ImageDraw, ImageFont
out, d, a, b, n = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])
cols = int(sys.argv[6]) if len(sys.argv) > 6 else 4; cw = int(sys.argv[7]) if len(sys.argv) > 7 else 640
crop = tuple(map(int, sys.argv[8].split(","))) if len(sys.argv) > 8 and sys.argv[8] else None
idx = [round(a + (b - a) * i / max(1, n - 1)) for i in range(n)]
ims = [Image.open(os.path.join(d, f"f_{i:03d}.jpg")) for i in idx]
if crop: ims = [im.crop(crop) for im in ims]
ch = round(cw * ims[0].height / ims[0].width); rows = (len(ims) + cols - 1) // cols
sheet = Image.new("RGB", (cols * cw, rows * ch), (14, 16, 18)); dr = ImageDraw.Draw(sheet)
F = ImageFont.truetype("/System/Library/Fonts/Hiragino Sans GB.ttc", 20)
for k, (i, im) in enumerate(zip(idx, ims)):
    x, y = (k % cols) * cw, (k // cols) * ch; sheet.paste(im.resize((cw, ch), Image.LANCZOS), (x, y)); dr.text((x + 8, y + 6), f"{i / 30:.2f}s", fill=(255, 255, 255), font=F)
sheet.save(out, quality=86); print(out, sheet.size)
