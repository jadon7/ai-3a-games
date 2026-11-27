#!/usr/bin/env python3
# 把 fx2_cap.mjs 截的帧拼成连续帧对比（fx2b）：一行一个版本，按对局时间在 [t0, t1] 里均匀取 n 帧，每格左上角写这一帧的时间。
# 用法: python3 tools/fx2_sheet.py <输出.jpg> "<标题>" <裁剪 x0,y0,x1,y1 或 ->  <每格宽> "改前=<帧目录>@0.4:1.6:10" "改后=<帧目录>@0.4:1.6:10" ...
#   单帧模式：行写成 "名字=<帧目录>@t"（只取一帧），配合 --grid 列数 拼成总表
import sys, os, json, glob
from PIL import Image, ImageDraw, ImageFont
args = sys.argv[1:]
grid = 0
if "--grid" in args: i = args.index("--grid"); grid = int(args[i + 1]); del args[i:i + 2]
out, title, crop, cw = args[0], args[1], args[2], int(args[3]); rows = args[4:]
crop = None if crop == "-" else tuple(map(int, crop.split(",")))
def font(sz):
    for f in ["/System/Library/Fonts/PingFang.ttc", "/System/Library/Fonts/STHeiti Medium.ttc", "/System/Library/Fonts/Hiragino Sans GB.ttc"]:
        if os.path.exists(f): return ImageFont.truetype(f, sz)
    return ImageFont.load_default()
F, FS, FT = font(24), font(17), font(30)
def pick(spec):
    d, rng = spec.rsplit("@", 1); times = json.load(open(os.path.join(d, "times.json"))); files = sorted(glob.glob(os.path.join(d, "f_*.jpg")))
    if "," in rng: want = list(map(float, rng.split(",")))      # 也可以直接列出要哪几个时刻：@0.5,0.62,0.8
    else:
        parts = list(map(float, rng.split(":")))
        want = [parts[0]] if len(parts) == 1 else [parts[0] + (parts[1] - parts[0]) * k / (int(parts[2]) - 1) for k in range(int(parts[2]))]
    return [(files[min(range(len(times)), key=lambda i: abs(times[i] - t))], times[min(range(len(times)), key=lambda i: abs(times[i] - t))]) for t in want]
items = []
for r in rows:
    label, spec = r.split("=", 1); items.append((label, pick(spec)))
im0 = Image.open(items[0][1][0][0]); box = crop or (0, 0, im0.width, im0.height)
ch = round(cw * (box[3] - box[1]) / (box[2] - box[0])); TH = 50 if title else 0
if grid:      # 总表：每格一张，下面写名字
    cells = [(l, f[0]) for l, f in items]; rowsN = (len(cells) + grid - 1) // grid; LH = 40
    sheet = Image.new("RGB", (grid * (cw + 6) + 6, TH + rowsN * (ch + LH + 6) + 6), (14, 16, 18)); dr = ImageDraw.Draw(sheet)
    if title: dr.text((12, 10), title, fill=(230, 236, 232), font=FT)
    for k, (l, (f, t)) in enumerate(cells):
        x = 6 + (k % grid) * (cw + 6); y = TH + 6 + (k // grid) * (ch + LH + 6)
        sheet.paste(Image.open(f).crop(box).resize((cw, ch), Image.LANCZOS), (x, y)); dr.text((x + 4, y + ch + 6), l, fill=(225, 232, 228), font=F)
else:
    LW = 120; cols = max(len(f) for _, f in items)
    sheet = Image.new("RGB", (LW + cols * (cw + 4), TH + len(items) * (ch + 4)), (14, 16, 18)); dr = ImageDraw.Draw(sheet)
    if title: dr.text((12, 10), title, fill=(230, 236, 232), font=FT)
    for r, (label, fs) in enumerate(items):
        y = TH + r * (ch + 4); dr.text((10, y + ch // 2 - 14), label, fill=(225, 232, 228), font=F)
        for c, (f, t) in enumerate(fs):
            x = LW + c * (cw + 4); sheet.paste(Image.open(f).crop(box).resize((cw, ch), Image.LANCZOS), (x, y))
            dr.rectangle((x, y, x + 62, y + 24), fill=(0, 0, 0)); dr.text((x + 5, y + 2), f"{t:.2f}s", fill=(255, 255, 255), font=FS)
sheet.save(out, quality=88); print(out, sheet.size)
