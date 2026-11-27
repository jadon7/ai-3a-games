#!/usr/bin/env python3
# 改前、改后的代表帧总表（第九轮 polish-old，照 fx2c 的 summary.py 改）：每个技能一行两格（左改前、右改后，同一帧、同一裁剪）。
# 用法: python3 summary.py <输出.jpg> <标题> "<改前目录>|<改后目录>|<帧号>|<裁剪 x0,y0,x1,y1>|<名字>" ...
import sys
from PIL import Image, ImageDraw, ImageFont
out, title, items = sys.argv[1], sys.argv[2], sys.argv[3:]
F = lambda s: ImageFont.truetype("/System/Library/Fonts/Hiragino Sans GB.ttc", s)
CW, CH, PAD, TH, LW = 560, 350, 6, 60, 0
cols = 4; n = len(items) * 2; rows = (n + cols - 1) // cols
sheet = Image.new("RGB", (cols * (CW + PAD) + PAD, TH + rows * (CH + PAD) + PAD), (14, 16, 18)); dr = ImageDraw.Draw(sheet)
dr.text((14, 14), title, fill=(232, 236, 232), font=F(30))
def cell(d, f, crop):
    x0, y0, x1, y1 = map(int, crop.split(",")); im = Image.open(f"{d}/f_{int(f):03d}.jpg").crop((x0, y0, x1, y1))
    s = max(CW / im.width, CH / im.height); im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    l, t = (im.width - CW) // 2, (im.height - CH) // 2; return im.crop((l, t, l + CW, t + CH))
for i, it in enumerate(items):
    bd, ad, f, crop, name = it.split("|")
    for j, (d, lab) in enumerate(((bd, "改前"), (ad, "改后"))):
        k = i * 2 + j; x, y = PAD + (k % cols) * (CW + PAD), TH + PAD + (k // cols) * (CH + PAD); sheet.paste(cell(d, f, crop), (x, y))
        txt = f"{name} · {lab}"; dr.rectangle((x, y, x + 14 + 23 * len(txt), y + 36), fill=(0, 0, 0) if j else (40, 40, 44)); dr.text((x + 8, y + 5), txt, fill=(240, 236, 226) if j else (190, 190, 190), font=F(23))
sheet.save(out, quality=90); print(out, sheet.size)
