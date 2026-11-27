"""把 tools/anim_sheet.mjs 截的单帧拼成大一点的图（tools/asheet.py 一行 12 格时每格只有 160 像素，看不清手和杖）。
用法: python art/hero/osen/asheet_big.py <截图目录> <动作名> <输出.jpg> [视角,视角=close,side] [每行几格=6]"""
import sys, glob
from PIL import Image, ImageDraw
d, act, out = sys.argv[1:4]; views = (sys.argv[4] if len(sys.argv) > 4 else "close,side").split(","); cols = int(sys.argv[5]) if len(sys.argv) > 5 else 6
rows = []
for v in views:
    fs = sorted(glob.glob(f"{d}/{act}_{v}_*.jpg")); ims = []
    for k, f in enumerate(fs):
        im = Image.open(f).convert("RGB").crop((50, 20, 370, 400)); ImageDraw.Draw(im).text((6, 4), f"{v} {k}", fill=(255, 80, 80)); ims.append(im)
    for s in range(0, len(ims), cols):
        part = ims[s:s + cols]; r = Image.new("RGB", (cols * part[0].size[0], part[0].size[1]), (20, 20, 20)); x = 0
        for im in part: r.paste(im, (x, 0)); x += im.size[0]
        rows.append(r)
sh = Image.new("RGB", (rows[0].size[0], sum(r.size[1] for r in rows))); y = 0
for r in rows: sh.paste(r, (0, y)); y += r.size[1]
sh.save(out, quality=86); print(out, sh.size)
