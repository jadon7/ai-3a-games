#!/usr/bin/env python3
"""把姿势检查图拼成一张（每个姿势一列：上正面、下侧面），每格先裁掉四周的空地再放大。
用法: python3 sheet.py <输出.jpg> <目录> <前缀> <姿势名,姿势名…> [每格宽=480] [裁剪 左,上,右,下（比例）=0.1,0.45,0.9,1.0]
"""
import sys
from PIL import Image, ImageDraw, ImageFont

out, d, pre, tags = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4].split(","); w = int(sys.argv[5]) if len(sys.argv) > 5 else 480
box = [float(x) for x in (sys.argv[6] if len(sys.argv) > 6 else "0.1,0.45,0.9,1.0").split(",")]
try: font = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 18)
except Exception: font = ImageFont.load_default()
cells = []
for t in tags:
    col = []
    for v in ("front", "side"):
        im = Image.open(f"{d}/{pre}_{t}_{v}.png").convert("RGB"); W, H = im.size; im = im.crop((int(box[0] * W), int(box[1] * H), int(box[2] * W), int(box[3] * H)))
        im = im.resize((w, int(im.size[1] * w / im.size[0]))); ImageDraw.Draw(im).text((8, 6), f"{t} {v}", fill=(255, 255, 0), font=font, stroke_width=2, stroke_fill=(0, 0, 0)); col.append(im)
    cells.append(col)
h = cells[0][0].size[1]; sh = Image.new("RGB", (w * len(tags), h * 2))
for i, col in enumerate(cells):
    for j, im in enumerate(col): sh.paste(im, (i * w, j * h))
sh.save(out, quality=88); print("写好了", out, sh.size)
