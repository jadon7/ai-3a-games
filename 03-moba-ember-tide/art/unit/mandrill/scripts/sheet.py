#!/usr/bin/env python3
"""把 <目录>/<前缀><名字>_{front,side}.png 拼成一张对照图（每个姿势正面+侧面并排，裁掉上面的空白）。
用法: python3 sheet.py <目录> <输出.jpg> <名字,名字,…> [每行几个=4] [前缀=p_] [裁剪 上,下 占画面的比例=0.25,1.0]"""
import sys
from PIL import Image, ImageDraw
d, out, names = sys.argv[1], sys.argv[2], sys.argv[3].split(","); cols = int(sys.argv[4]) if len(sys.argv) > 4 else 4; pre = sys.argv[5] if len(sys.argv) > 5 else "p_"
top, bot = [float(v) for v in (sys.argv[6] if len(sys.argv) > 6 else "0.25,1.0").split(",")]
cells = []
for n in names:
    a, b = [Image.open(f"{d}/{pre}{n}_{v}.png").convert("RGB") for v in ("front", "side")]; W, H = a.size
    a, b = [im.crop((0, int(H * top), W, int(H * bot))) for im in (a, b)]; c = Image.new("RGB", (W * 2, a.size[1])); c.paste(a, (0, 0)); c.paste(b, (W, 0))
    ImageDraw.Draw(c).text((10, 8), n, fill=(255, 0, 0)); cells.append(c)
w, h = cells[0].size; rows = (len(cells) + cols - 1) // cols; sh = Image.new("RGB", (w * cols, h * rows), (30, 30, 30))
for k, c in enumerate(cells): sh.paste(c, ((k % cols) * w, (k // cols) * h))
s = min(1.0, 2000 / sh.size[0]); sh = sh.resize((int(sh.size[0] * s), int(sh.size[1] * s))); sh.save(out, quality=88); print(sh.size)
