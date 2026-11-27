#!/usr/bin/env python3
# 改后的代表帧总表（第九轮 fx2c）：每个技能挑最好看的一帧，裁到技能发生的地方，2 行 × 4 格。
# 用法: python3 summary.py <输出.jpg> "<目录>:<帧号>:<裁剪 x0,y0,x1,y1>:<名字>" ...（8 个）
import sys
from PIL import Image, ImageDraw, ImageFont
out, items = sys.argv[1], sys.argv[2:]
F = lambda s: ImageFont.truetype("/System/Library/Fonts/Hiragino Sans GB.ttc", s)
CW, CH, PAD, TH = 640, 400, 6, 56
cols = 4; rows = (len(items) + cols - 1) // cols
sheet = Image.new("RGB", (cols * (CW + PAD) + PAD, TH + rows * (CH + PAD) + PAD), (14, 16, 18)); dr = ImageDraw.Draw(sheet)
dr.text((14, 12), "葛隆、薇萝：改后每个技能的代表帧（第九轮 fx2c）", fill=(232, 236, 232), font=F(30))
for i, it in enumerate(items):
    d, f, crop, name = it.split(":", 3); x0, y0, x1, y1 = map(int, crop.split(","))
    im = Image.open(f"{d}/f_{int(f):03d}.jpg").crop((x0, y0, x1, y1))
    s = max(CW / im.width, CH / im.height); im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    l, t = (im.width - CW) // 2, (im.height - CH) // 2; im = im.crop((l, t, l + CW, t + CH))
    x, y = PAD + (i % cols) * (CW + PAD), TH + PAD + (i // cols) * (CH + PAD); sheet.paste(im, (x, y))
    dr.rectangle((x, y, x + 12 + 26 * len(name), y + 40), fill=(0, 0, 0)); dr.text((x + 8, y + 5), name, fill=(240, 236, 226), font=F(26))
sheet.save(out, quality=90); print(out, sheet.size)
