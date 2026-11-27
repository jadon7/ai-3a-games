# 换画风 B · b-walls：拼对比图。每张是一行，几张图裁成 16:9 并排，上面写标题。
# 用法: /opt/homebrew/opt/python@3.14/bin/python3.14 tools/bwalls_compare.py <输出.jpg> <单格宽> 图@标题 [图@标题 …]
#   图后面可以跟 #x0,y0,x1,y1 先裁一块（像素），例: art/concepts22/env_me_b.png#300,40,1600,1000@设计稿B
import sys
from PIL import Image, ImageDraw, ImageFont

out, cw = sys.argv[1], int(sys.argv[2])
font = ImageFont.truetype("/System/Library/Fonts/Hiragino Sans GB.ttc", 26)
cells = []
for it in sys.argv[3:]:
    p, _, title = it.partition("@")
    p, _, box = p.partition("#")
    im = Image.open(p).convert("RGB")
    if box:
        im = im.crop(tuple(int(v) for v in box.split(",")))
    W, H = im.size
    tw = min(W, round(H * 16 / 9)); th = round(tw * 9 / 16)
    im = im.crop(((W - tw) // 2, (H - th) // 2, (W - tw) // 2 + tw, (H - th) // 2 + th)).resize((cw, round(cw * 9 / 16)), Image.LANCZOS)
    cells.append((im, title))
bar, gap = 44, 6
S = Image.new("RGB", (cw * len(cells) + gap * (len(cells) - 1), cells[0][0].height + bar), (18, 18, 22))
d = ImageDraw.Draw(S)
for k, (im, t) in enumerate(cells):
    x = k * (cw + gap); S.paste(im, (x, bar)); d.text((x + 12, 7), t, fill=(240, 240, 240), font=font)
S.save(out, quality=90)
