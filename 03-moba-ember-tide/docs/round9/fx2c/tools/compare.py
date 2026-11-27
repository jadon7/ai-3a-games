#!/usr/bin/env python3
# 改前、改后的连续帧对比（第九轮 fx2c）：改前一行、改后一行，同一组帧号（录像是 30 帧每秒的对局时间，两边同一时刻）。
# 用法: python3 compare.py <输出.jpg> <改前帧目录> <改后帧目录> <起始帧> <结束帧> <取几张> [裁剪 x0,y0,x1,y1] [每格宽=420] [标题]
#   起始帧写成 "12,18,25,..."（逗号隔开的帧号）就按这几帧取，结束帧和张数不看
import sys, os
from PIL import Image, ImageDraw, ImageFont
out, bd, ad = sys.argv[1], sys.argv[2], sys.argv[3]
crop = tuple(map(int, sys.argv[7].split(","))) if len(sys.argv) > 7 and sys.argv[7] else None
cw = int(sys.argv[8]) if len(sys.argv) > 8 else 420; title = sys.argv[9] if len(sys.argv) > 9 else ""
F = lambda s: ImageFont.truetype("/System/Library/Fonts/Hiragino Sans GB.ttc", s)
if "," in sys.argv[4]: idx = [int(v) for v in sys.argv[4].split(",")]; n = len(idx)
else: a, b, n = int(sys.argv[4]), int(sys.argv[5]), int(sys.argv[6]); idx = [round(a + (b - a) * i / max(1, n - 1)) for i in range(n)]
def load(d, i):
    im = Image.open(os.path.join(d, f"f_{i:03d}.jpg")); return im.crop(crop) if crop else im
im0 = load(bd, idx[0]); ch = round(cw * im0.height / im0.width); LW, TH = 90, 52 if title else 6
sheet = Image.new("RGB", (LW + n * (cw + 4), TH + 2 * (ch + 4)), (14, 16, 18)); dr = ImageDraw.Draw(sheet)
if title: dr.text((12, 10), title, fill=(232, 236, 232), font=F(28))
for r, (lab, d) in enumerate((("改前", bd), ("改后", ad))):
    y = TH + r * (ch + 4); dr.text((14, y + ch // 2 - 16), lab, fill=(232, 236, 232) if r else (170, 176, 172), font=F(26))
    for c, i in enumerate(idx):
        x = LW + c * (cw + 4); sheet.paste(load(d, i).resize((cw, ch), Image.LANCZOS), (x, y)); dr.text((x + 6, y + 4), f"{i / 30:.2f}s", fill=(255, 255, 255), font=F(17))
sheet.save(out, quality=88); print(out, sheet.size)
