#!/usr/bin/env python3
# 把 fx_frames.mjs 截的连续帧拼成联系表（第九轮）：一行一个技能，左边写名字，每格右上角写第几帧。
# 用法: python3 tools/fx_sheet.py <输出.jpg> <帧目录> <名字1,名字2,...> [裁剪 x0,y0,x1,y1] [每格宽=360] [每行最多几格=10] [标题]
#   名字可以写成 "目录:前缀" 从别的目录取（改前、改后拼在同一张里）；写成 "前缀=显示的名字" 改左边的字
import sys, os, glob
from PIL import Image, ImageDraw, ImageFont
out, d, names = sys.argv[1], sys.argv[2], sys.argv[3].split(",")
crop = tuple(map(int, sys.argv[4].split(","))) if len(sys.argv) > 4 and sys.argv[4] else None
cw = int(sys.argv[5]) if len(sys.argv) > 5 else 360
maxc = int(sys.argv[6]) if len(sys.argv) > 6 else 10
title = sys.argv[7] if len(sys.argv) > 7 else ""
def font(sz):
    for f in ["/System/Library/Fonts/PingFang.ttc", "/System/Library/Fonts/STHeiti Medium.ttc", "/System/Library/Fonts/Hiragino Sans GB.ttc"]:
        if os.path.exists(f): return ImageFont.truetype(f, sz)
    return ImageFont.load_default()
F, FS, FT = font(22), font(15), font(28)
rows = []
for n in names:
    label = n
    if "=" in n: n, label = n.split("=", 1)
    dd, pre = (n.split(":", 1) if ":" in n else (d, n))
    fs = sorted(glob.glob(os.path.join(dd, pre + "_[0-9][0-9].jpg")))[:maxc]
    if fs: rows.append((label, fs))
if not rows: sys.exit("没有帧")
im0 = Image.open(rows[0][1][0]); box = crop or (0, 0, im0.width, im0.height)
ch = round(cw * (box[3] - box[1]) / (box[2] - box[0])); LW = 150; TH = 44 if title else 0
cols = max(len(fs) for _, fs in rows)
sheet = Image.new("RGB", (LW + cols * (cw + 4), TH + len(rows) * (ch + 4)), (14, 16, 18)); dr = ImageDraw.Draw(sheet)
if title: dr.text((12, 8), title, fill=(230, 236, 232), font=FT)
for r, (label, fs) in enumerate(rows):
    y = TH + r * (ch + 4)
    dr.text((10, y + ch // 2 - 14), label, fill=(225, 232, 228), font=F)
    for c, f in enumerate(fs):
        t = Image.open(f).crop(box).resize((cw, ch), Image.LANCZOS); x = LW + c * (cw + 4); sheet.paste(t, (x, y))
        dr.text((x + 6, y + 4), str(c), fill=(255, 255, 255), font=FS)
sheet.save(out, quality=88); print(out, sheet.size)
