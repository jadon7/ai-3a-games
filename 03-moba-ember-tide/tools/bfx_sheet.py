#!/usr/bin/env python3
# 换画风 B · b-fx 的拼图。用 /opt/homebrew/opt/python@3.14/bin/python3.14 跑（要 Pillow）。
#   看一条：      bfx_sheet.py look <帧目录> <输出.jpg> [起帧,止帧] [张数=8] [裁剪 x0,y0,x1,y1] [每格宽=480]
#   改前改后：    bfx_sheet.py pair <改前帧目录> <改后帧目录> <输出.jpg> <标题> [起帧,止帧] [张数=8] [裁剪] [每格宽=400]
#                 上一行改前、下一行改后，同一帧号（30 帧一秒，录像工具按对局时间推钟，帧号对得上），每格左上角写第几秒
#   总表：        bfx_sheet.py table <输出.jpg> <列数> <每格宽> 标题=帧文件[@裁剪] …
import sys, os
from PIL import Image, ImageDraw, ImageFont

FONT = "/System/Library/Fonts/Hiragino Sans GB.ttc"
def font(s):
    try: return ImageFont.truetype(FONT, s)
    except Exception: return ImageFont.load_default()

def frames(d):
    return sorted(f for f in os.listdir(d) if f.startswith("f_") and f.endswith(".jpg"))

def pick(d, rng, n):
    fs = frames(d)
    if not fs: return []
    a, b = (0, len(fs) - 1) if not rng else [min(int(x), len(fs) - 1) for x in rng.split(",")]
    if n <= 1: return [fs[a]]
    return [fs[round(a + (b - a) * i / (n - 1))] for i in range(n)]

def crop(im, c):
    if not c: return im
    x0, y0, x1, y1 = [int(v) for v in c.split(",")]
    return im.crop((x0, y0, x1, y1))

def cellimg(path, c, w):
    im = crop(Image.open(path).convert("RGB"), c)
    h = round(im.height * w / im.width)
    return im.resize((w, h), Image.LANCZOS)

def label(dr, xy, s, size=18):
    f = font(size); x, y = xy
    bb = dr.textbbox((x, y), s, font=f)
    dr.rectangle((bb[0] - 4, bb[1] - 3, bb[2] + 4, bb[3] + 3), fill=(12, 16, 18))
    dr.text((x, y), s, font=f, fill=(240, 240, 232))

def look(d, out, rng=None, n=8, c=None, w=480):
    fs = pick(d, rng, int(n)); cells = [cellimg(os.path.join(d, f), c, int(w)) for f in fs]
    cols = 4; rows = (len(cells) + cols - 1) // cols; cw, ch = cells[0].size
    sheet = Image.new("RGB", (cols * cw + (cols - 1) * 4, rows * ch + (rows - 1) * 4), (20, 22, 24)); dr = ImageDraw.Draw(sheet)
    for i, (f, im) in enumerate(zip(fs, cells)):
        x, y = (i % cols) * (cw + 4), (i // cols) * (ch + 4); sheet.paste(im, (x, y)); label(dr, (x + 6, y + 4), f"{int(f[2:5]) / 30:.2f}s", 16)
    sheet.save(out, quality=88)

def pair(db, da, out, title, rng=None, n=8, c=None, w=400):
    fs = pick(da, rng, int(n)); n = len(fs); w = int(w)
    top = [cellimg(os.path.join(db, f), c, w) if os.path.exists(os.path.join(db, f)) else Image.new("RGB", (w, 10)) for f in fs]
    bot = [cellimg(os.path.join(da, f), c, w) for f in fs]
    ch = bot[0].height; head = 40; side = 64
    sheet = Image.new("RGB", (side + n * w + (n - 1) * 3, head + 2 * ch + 6), (16, 18, 20)); dr = ImageDraw.Draw(sheet)
    dr.text((10, 8), title, font=font(22), fill=(240, 240, 232))
    for r, (row, name) in enumerate([(top, "改前"), (bot, "改后")]):
        y = head + r * (ch + 6); dr.text((10, y + ch // 2 - 12), name, font=font(20), fill=(240, 240, 232))
        for i, im in enumerate(row):
            x = side + i * (w + 3); sheet.paste(im.resize((w, ch)) if im.height != ch else im, (x, y))
            if r == 0: label(dr, (x + 5, y + 4), f"{int(fs[i][2:5]) / 30:.2f}s", 15)
    sheet.save(out, quality=88)

def table(out, cols, w, items):
    cols, w = int(cols), int(w); cells = []
    for it in items:
        t, p = it.split("=", 1); c = None
        if "@" in p: p, c = p.split("@", 1)
        cells.append((t, cellimg(p, c, w)))
    ch = max(im.height for _, im in cells); rows = (len(cells) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * w + (cols - 1) * 4, rows * (ch + 30) + (rows - 1) * 4), (16, 18, 20)); dr = ImageDraw.Draw(sheet)
    for i, (t, im) in enumerate(cells):
        x, y = (i % cols) * (w + 4), (i // cols) * (ch + 34)
        dr.text((x + 6, y + 4), t, font=font(18), fill=(240, 240, 232)); sheet.paste(im, (x, y + 30))
    sheet.save(out, quality=88)

if __name__ == "__main__":
    a = sys.argv[1:]
    if a[0] == "look": look(*a[1:])
    elif a[0] == "pair": pair(*a[1:])
    elif a[0] == "table": table(a[1], a[2], a[3], a[4:])
