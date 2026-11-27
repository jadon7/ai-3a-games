#!/usr/bin/env python3
# 乌戈（第九轮 k-ugo）的代表帧总表：每格一张裁好的帧，左上角写技能名和离放技能过了几秒。
# 用法: python3 tools/kugo_sheet.py <输出.jpg> "<标题>" <列数> <每格宽> "名字|帧路径|裁剪 x0,y0,x1,y1|秒" …
import sys, os
from PIL import Image, ImageDraw, ImageFont
out, title, cols, cw = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
cells = [c.split("|") for c in sys.argv[5:]]
def font(sz):
    for f in ["/System/Library/Fonts/PingFang.ttc", "/System/Library/Fonts/STHeiti Medium.ttc", "/System/Library/Fonts/Hiragino Sans GB.ttc"]:
        if os.path.exists(f): return ImageFont.truetype(f, sz)
    return ImageFont.load_default()
F, FT = font(26), font(32)
ims = []
for name, path, crop, sec in cells:
    im = Image.open(path); box = tuple(map(int, crop.split(","))) if crop else (0, 0, im.width, im.height); ims.append((name, im.crop(box), sec))
ch = round(cw * ims[0][1].height / ims[0][1].width); TH = 56; rows = (len(ims) + cols - 1) // cols; G = 6
sheet = Image.new("RGB", (cols * (cw + G) + G, TH + rows * (ch + G) + G), (14, 16, 20)); dr = ImageDraw.Draw(sheet)
dr.text((14, 10), title, fill=(232, 236, 244), font=FT)
for k, (name, im, sec) in enumerate(ims):
    x, y = G + (k % cols) * (cw + G), TH + (k // cols) * (ch + G); sheet.paste(im.resize((cw, round(cw * im.height / im.width)), Image.LANCZOS), (x, y))
    label = f"{name}（{sec}s）" if sec else name; tw = dr.textlength(label, font=F); dr.rectangle((x, y, x + tw + 20, y + 40), fill=(12, 14, 20)); dr.text((x + 10, y + 5), label, fill=(226, 230, 246), font=F)
sheet.save(out, quality=90); print(out, sheet.size)
