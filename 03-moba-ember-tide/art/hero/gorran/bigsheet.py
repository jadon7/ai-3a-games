"""把 tools/anim_sheet.mjs 截的单帧拼成大一点的图：一段动作一张，每个视角一行（tools/asheet.py 把八段动作挤在一张 2000 像素高的图里，一格只有 100 像素，看不清）。
用法: python3 art/hero/gorran/bigsheet.py <截图目录> <动作名> <输出.jpg> [视角,视角=close,side]
"""
import sys, glob
from PIL import Image
d, act, out = sys.argv[1:4]; views = sys.argv[4].split(",") if len(sys.argv) > 4 else ["close", "side"]
rows = []
for v in views:
    ims = [Image.open(f).convert("RGB").crop((50, 30, 370, 400)) for f in sorted(glob.glob(f"{d}/{act}_{v}_*.jpg"))]
    r = Image.new("RGB", (sum(i.size[0] for i in ims), ims[0].size[1])); x = 0
    for i in ims: r.paste(i, (x, 0)); x += i.size[0]
    rows.append(r)
sh = Image.new("RGB", (max(r.size[0] for r in rows), sum(r.size[1] for r in rows))); y = 0
for r in rows: sh.paste(r, (0, y)); y += r.size[1]
sh.save(out, quality=88); print(out, sh.size)
