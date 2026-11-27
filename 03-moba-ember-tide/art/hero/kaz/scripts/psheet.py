#!/usr/bin/env python3
"""姿势检查图的联系表：每组 <前缀>_<tag>_{front,side}.png 裁到角色周围（按和背景色差得多的像素），每行放三组（正面 + 侧面），左上角写 tag。
用法: python3 psheet.py <目录/前缀> <tag1,tag2,...> <输出.jpg> [格高=300]"""
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont
pre, tags, out = sys.argv[1], sys.argv[2].split(","), sys.argv[3]; ch = int(sys.argv[4]) if len(sys.argv) > 4 else 300
try: font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 18)
except Exception: font = None


def crop(im):
    a = np.asarray(im).astype(int); bg = a[2, 2]; m = np.abs(a - bg).sum(-1) > 30
    ys, xs = np.where(m); pad = 12
    return im.crop((max(xs.min() - pad, 0), max(ys.min() - pad, 0), min(xs.max() + pad, im.width), min(ys.max() + pad, im.height)))


cells = []
for t in tags:
    pair = []
    for v in ("front", "side"):
        c = crop(Image.open(f"{pre}_{t}_{v}.png").convert("RGB")); c = c.resize((int(c.width * ch / c.height), ch)); pair.append(c)
    w = sum(p.width for p in pair) + 6; cell = Image.new("RGB", (w, ch), (255, 255, 255)); x = 0
    for p in pair: cell.paste(p, (x, 0)); x += p.width + 6
    ImageDraw.Draw(cell).text((6, 4), t, fill=(200, 0, 0), font=font); cells.append(cell)
per = 3; rows = [cells[i:i + per] for i in range(0, len(cells), per)]
W = max(sum(c.width for c in r) + 10 * (len(r) - 1) for r in rows); sh = Image.new("RGB", (W, (ch + 10) * len(rows)), (255, 255, 255))
for ri, r in enumerate(rows):
    x = 0
    for c in r: sh.paste(c, (x, ri * (ch + 10))); x += c.width + 10
sh.save(out, quality=88); print("写好了", out, sh.size)
