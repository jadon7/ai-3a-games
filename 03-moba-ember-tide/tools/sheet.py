#!/usr/bin/env python3
"""把若干图片拼成一张带文件名标签的总览图，方便一次看完。
用法: python3 tools/sheet.py out.jpg 单格高度 每行个数 图1 图2 ...
"""
import sys, os
from PIL import Image, ImageDraw, ImageFont
out, ch, cols, files = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4:]
font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 16)
thumbs = []
for f in files:
    im = Image.open(f).convert("RGB"); w, h = im.size
    thumbs.append((os.path.basename(f), im.resize((round(w * ch / h), ch), Image.LANCZOS), (w, h)))
rows = [thumbs[i:i + cols] for i in range(0, len(thumbs), cols)]
W = max(sum(t[1].size[0] for t in r) for r in rows)
sheet = Image.new("RGB", (W, ch * len(rows)), (16, 16, 16)); dr = ImageDraw.Draw(sheet)
for ri, r in enumerate(rows):
    x = 0
    for name, im, orig in r:
        sheet.paste(im, (x, ri * ch)); lab = f"{name} {orig[0]}x{orig[1]}"
        dr.rectangle([x, ri * ch, x + dr.textlength(lab, font=font) + 6, ri * ch + 20], fill=(0, 0, 0)); dr.text((x + 3, ri * ch + 2), lab, fill=(255, 230, 0), font=font)
        x += im.size[0]
if W > 2400: sheet = sheet.resize((2400, round(sheet.size[1] * 2400 / W)), Image.LANCZOS)
sheet.save(out, quality=84); print(out, sheet.size)
