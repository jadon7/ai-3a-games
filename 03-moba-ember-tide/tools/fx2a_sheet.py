#!/usr/bin/env python3
# 把 fx2a_clip.mjs 录下来的逐帧拼成连续帧对比表（第九轮 fx2a）：一行一条录像，左边写名字，每格左上角写这一帧离放技能过了几秒。
# 用法: python3 tools/fx2a_sheet.py <输出.jpg> "<标题>" <每格宽> "<裁剪 x0,y0,x1,y1 或空>" "名字=目录@帧号,帧号,…" …
#   帧号写成 a:b:s 就是从 a 到 b（不含）每隔 s 帧取一帧。目录里是 f_000.jpg …（30 帧一秒，前 lead 帧是放之前的）
import sys, os
from PIL import Image, ImageDraw, ImageFont
out, title, cw, crop = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
rows = sys.argv[5:]
def font(sz):
    for f in ["/System/Library/Fonts/PingFang.ttc", "/System/Library/Fonts/STHeiti Medium.ttc", "/System/Library/Fonts/Hiragino Sans GB.ttc"]:
        if os.path.exists(f): return ImageFont.truetype(f, sz)
    return ImageFont.load_default()
F, FS, FT = font(24), font(17), font(30)
parsed = []
for r in rows:
    label, rest = r.split("=", 1); d, idx = rest.rsplit("@", 1)
    if ":" in idx: a, b, s = map(int, idx.split(":")); ids = list(range(a, b, s))
    else: ids = [int(x) for x in idx.split(",")]
    fs = [os.path.join(d, f"f_{i:03d}.jpg") for i in ids if os.path.exists(os.path.join(d, f"f_{i:03d}.jpg"))]
    parsed.append((label, fs, ids))
im0 = Image.open(parsed[0][1][0]); box = tuple(map(int, crop.split(","))) if crop else (0, 0, im0.width, im0.height)
ch = round(cw * (box[3] - box[1]) / (box[2] - box[0])); LW = 120; TH = 50 if title else 0
cols = max(len(fs) for _, fs, _ in parsed)
sheet = Image.new("RGB", (LW + cols * (cw + 4), TH + len(parsed) * (ch + 4)), (14, 16, 18)); dr = ImageDraw.Draw(sheet)
if title: dr.text((12, 9), title, fill=(230, 236, 232), font=FT)
for r, (label, fs, ids) in enumerate(parsed):
    y = TH + r * (ch + 4)
    dr.text((10, y + ch // 2 - 14), label, fill=(225, 232, 228), font=F)
    for c, f in enumerate(fs):
        t = Image.open(f).crop(box).resize((cw, ch), Image.LANCZOS); x = LW + c * (cw + 4); sheet.paste(t, (x, y))
        dr.rectangle((x, y, x + 64, y + 24), fill=(0, 0, 0)); dr.text((x + 6, y + 2), f"{os.path.basename(f)[2:5]}", fill=(255, 255, 255), font=FS)
sheet.save(out, quality=90); print(out, sheet.size)
