#!/usr/bin/env python3
# 连续帧图：从 rec.mjs 录的逐帧里取几帧排成一张（每格左上角标“演示开始后第几秒”）。
# 用法：python3.14 tools/sheet.py <逐帧目录> <输出.jpg> [从第几秒] [到第几秒] [取几帧=12] [每行几格=6] [裁剪=x0,y0,x1,y1（0~1 的比例，默认整张）] [每格宽=480]
#   例：/opt/homebrew/opt/python@3.14/bin/python3.14 tools/sheet.py out/r1/r_top out/r1/r_top_sheet.jpg 0 1.6 12 6 0.2,0.1,0.8,0.9
# 并排：python3.14 tools/sheet.py --pair <左.jpg> <右.jpg> <输出.jpg> [左标题] [右标题]
import json, sys, os
from PIL import Image, ImageDraw, ImageFont

def font(sz):
    for p in ["/System/Library/Fonts/Hiragino Sans GB.ttc", "/System/Library/Fonts/STHeiti Medium.ttc"]:
        if os.path.exists(p):
            try: return ImageFont.truetype(p, sz)
            except Exception: pass
    return ImageFont.load_default()

if sys.argv[1] == "--pair":
    a, b, out = sys.argv[2:5]; la = sys.argv[5] if len(sys.argv) > 5 else ""; lb = sys.argv[6] if len(sys.argv) > 6 else ""
    A, B = Image.open(a).convert("RGB"), Image.open(b).convert("RGB"); H = max(A.height, B.height)
    A = A.resize((int(A.width * H / A.height), H)); B = B.resize((int(B.width * H / B.height), H))
    img = Image.new("RGB", (A.width + B.width + 12, H + 44), (16, 18, 22)); img.paste(A, (0, 44)); img.paste(B, (A.width + 12, 44))
    d = ImageDraw.Draw(img); f = font(26); d.text((10, 8), la, fill=(255, 230, 150), font=f); d.text((A.width + 22, 8), lb, fill=(255, 230, 150), font=f)
    img.save(out, quality=88); sys.exit(0)

src, out = sys.argv[1], sys.argv[2]
t0 = float(sys.argv[3]) if len(sys.argv) > 3 else 0.0
st = json.load(open(os.path.join(src, "stats.json")))
frames = st["frames"]
t1 = float(sys.argv[4]) if len(sys.argv) > 4 else frames[-1]["t"]
n = int(sys.argv[5]) if len(sys.argv) > 5 else 12
cols = int(sys.argv[6]) if len(sys.argv) > 6 else 6
crop = [float(v) for v in sys.argv[7].split(",")] if len(sys.argv) > 7 and sys.argv[7] else [0, 0, 1, 1]
cw = int(sys.argv[8]) if len(sys.argv) > 8 else 480
title = sys.argv[9] if len(sys.argv) > 9 else ""
idx = [i for i, f in enumerate(frames) if t0 - 1e-6 <= f["t"] <= t1 + 1e-6]
pick = [idx[round(k * (len(idx) - 1) / max(1, n - 1))] for k in range(n)] if len(idx) >= n else idx
cells = []
for i in pick:
    im = Image.open(os.path.join(src, f"f_{i:03d}.jpg")).convert("RGB"); W, H = im.size
    im = im.crop((int(crop[0] * W), int(crop[1] * H), int(crop[2] * W), int(crop[3] * H)))
    im = im.resize((cw, int(im.height * cw / im.width)), Image.LANCZOS)
    d = ImageDraw.Draw(im); f = font(max(14, cw // 22)); txt = f'{frames[i]["t"]:.2f}s'
    d.rectangle((0, 0, len(txt) * cw // 40 + 10, cw // 16 + 4), fill=(0, 0, 0)); d.text((5, 1), txt, fill=(255, 235, 120), font=f)
    cells.append(im)
ch = cells[0].height; rows = (len(cells) + cols - 1) // cols
TH = 48 if title else 0
img = Image.new("RGB", (cols * cw + (cols - 1) * 4, TH + rows * ch + (rows - 1) * 4), (16, 18, 22))
if title: ImageDraw.Draw(img).text((10, 8), title, fill=(255, 235, 150), font=font(28))
for k, im in enumerate(cells): img.paste(im, ((k % cols) * (cw + 4), TH + (k // cols) * (ch + 4)))
img.save(out, quality=88)
print(out, img.size, len(cells), "帧")
