#!/usr/bin/env python3
"""把几张检查图拼成一张（每个姿势一列：上正面、下侧面），省得一张张看。
用法: python sheet.py <输出.jpg> <目录> <前缀，如 turtle> <姿势名,姿势名…> [每格宽=480]
"""
import sys
from PIL import Image, ImageDraw, ImageFont

out, d, pre, tags = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4].split(","); w = int(sys.argv[5]) if len(sys.argv) > 5 else 480
try: font = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 18)
except Exception: font = ImageFont.load_default()
cells = []
for t in tags:
    col = []
    for v in ("front", "side"):
        im = Image.open(f"{d}/{pre}_{t}_{v}.png").convert("RGB"); im = im.resize((w, int(im.size[1] * w / im.size[0])))
        ImageDraw.Draw(im).text((8, 6), f"{t} {v}", fill=(255, 255, 0), font=font, stroke_width=2, stroke_fill=(0, 0, 0)); col.append(im)
    cells.append(col)
h = cells[0][0].size[1]; sh = Image.new("RGB", (w * len(tags), h * 2))
for i, col in enumerate(cells):
    for j, im in enumerate(col): sh.paste(im, (i * w, j * h))
sh.save(out, quality=88); print("写好了", out, sh.size)
