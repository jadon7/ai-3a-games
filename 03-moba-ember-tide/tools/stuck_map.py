#!/usr/bin/env python3
"""把 stuck_watch.mjs 记下的卡住位置画在正俯视的地图上。
用法: python3 tools/stuck_map.py <底图.jpg> <输出.jpg> <结果.json> [结果.json …]
底图用 tools/shot.mjs 截："top=1&span=96&nohud=1&play=0"，宽高一样（例如 1400 1400）：画面正中是世界原点，左右上下各 96 米（画面往下是 +z）。
红点是小兵、黄点是英雄、紫点是野怪；点的大小按卡了多久（秒）开方。"""
import sys, json, math
from PIL import Image, ImageDraw
base, out, files = sys.argv[1], sys.argv[2], sys.argv[3:]
im = Image.open(base).convert("RGB"); W, H = im.size; dr = ImageDraw.Draw(im, "RGBA")
S = 96.0
n = 0
for f in files:
    d = json.load(open(f))
    for r in d["stuck"]:
        x, y = (r["x"] + S) / (2 * S) * W, (r["z"] + S) / (2 * S) * H
        w = r["who"]
        col = (255, 60, 50, 200) if w.startswith(("melee", "ranged")) else (160, 90, 255, 220) if w in ("wolf", "mandrill", "toad", "boar", "beast", "troll") else (255, 220, 40, 220)
        rad = 4 + 2.2 * math.sqrt(min(r["dur"], 200))
        dr.ellipse([x - rad, y - rad, x + rad, y + rad], outline=col, width=3); dr.ellipse([x - 3, y - 3, x + 3, y + 3], fill=col); n += 1
dr.text((16, 16), f"{n} stuck events  red=minion  yellow=hero  purple=monster  size~sqrt(seconds)", fill=(255, 255, 255, 255))
im.save(out, quality=88); print(out, n)
