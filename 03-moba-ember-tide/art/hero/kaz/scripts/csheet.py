#!/usr/bin/env python3
"""把若干组 <前缀>_<tag>_{front,side}.png 拼成一张联系表（每行一组：正面 + 侧面，左上角写 tag）。
用法: python3 csheet.py <目录/前缀> <tag1,tag2,...> <输出.jpg> [每格宽=320]"""
import sys
from PIL import Image, ImageDraw, ImageFont
pre, tags, out = sys.argv[1], sys.argv[2].split(","), sys.argv[3]; cw = int(sys.argv[4]) if len(sys.argv) > 4 else 320
try: font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 18)
except Exception: font = None
cols = 2; per_row = 2  # 每行两组
ims = []
for t in tags:
    a = Image.open(f"{pre}_{t}_front.png").convert("RGB"); b = Image.open(f"{pre}_{t}_side.png").convert("RGB")
    h = int(a.height * cw / a.width); a = a.resize((cw, h)); b = b.resize((cw, h))
    c = Image.new("RGB", (cw * 2, h), (255, 255, 255)); c.paste(a, (0, 0)); c.paste(b, (cw, 0))
    ImageDraw.Draw(c).text((6, 4), t, fill=(200, 0, 0), font=font); ims.append(c)
W = ims[0].width; H = ims[0].height; rows = (len(ims) + per_row - 1) // per_row
sh = Image.new("RGB", (W * per_row, H * rows), (255, 255, 255))
for i, c in enumerate(ims): sh.paste(c, ((i % per_row) * W, (i // per_row) * H))
sh.save(out, quality=88); print("写好了", out, sh.size)
