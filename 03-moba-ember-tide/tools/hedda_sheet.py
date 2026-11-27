#!/usr/bin/env python3
# 赫达（k-hedda）：全部技能的代表帧总表。每格一张（某个技能录像里最好看的那一帧，裁一块），左上角写名字。
# 用法: python3 tools/hedda_sheet.py <输出.jpg> <标题> <每行几格> <每格宽> "名字|帧图路径|x0,y0,x1,y1" …
import sys
from PIL import Image, ImageDraw, ImageFont
out, title, cols, cw = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]); cells = [a.split("|") for a in sys.argv[5:]]
F = lambda s: ImageFont.truetype("/System/Library/Fonts/Hiragino Sans GB.ttc", s)
ims = []
for name, path, crop in cells:
    im = Image.open(path)
    if crop: im = im.crop(tuple(map(int, crop.split(","))))
    ims.append((name, im))
ch = round(cw * ims[0][1].height / ims[0][1].width); rows = (len(ims) + cols - 1) // cols; TH = 56
sheet = Image.new("RGB", (cols * cw + (cols - 1) * 4, TH + rows * (ch + 4)), (14, 16, 18)); dr = ImageDraw.Draw(sheet)
dr.text((14, 12), title, fill=(236, 232, 224), font=F(28))
for k, (name, im) in enumerate(ims):
    x, y = (k % cols) * (cw + 4), TH + (k // cols) * (ch + 4); sheet.paste(im.resize((cw, ch), Image.LANCZOS), (x, y))
    tw = dr.textlength(name, font=F(24)); dr.rectangle((x, y, x + tw + 24, y + 38), fill=(10, 10, 12)); dr.text((x + 12, y + 6), name, fill=(255, 236, 200), font=F(24))
sheet.save(out, quality=88); print(out, sheet.size)
