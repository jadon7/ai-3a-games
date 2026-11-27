"""把 anim_sheet.py 的图块拼成联系表（每段动作两行：正面、侧面），左上角标帧号和秒数，拼完删图块。
用法: <V2R>/.venv/bin/python sheet.py <图块目录> <输出.jpg> [每行最多几张=12]"""
import json, os, sys
from PIL import Image, ImageDraw
d, out = sys.argv[1], sys.argv[2]; per = int(sys.argv[3]) if len(sys.argv) > 3 else 12
idx = json.load(open(os.path.join(d, "index.json"))); rows = {}
for a, cv, i, f, p in idx: rows.setdefault((a, cv), []).append((f, p))
tiles = []
for key, lst in rows.items():
    for k in range(0, len(lst), per): tiles.append((key, lst[k:k + per]))
w = h = Image.open(idx[0][4]).size[0]; W = per * w; H = len(tiles) * h
sh = Image.new("RGB", (W, H), (30, 30, 30)); dr = ImageDraw.Draw(sh)
for r, ((a, cv), lst) in enumerate(tiles):
    for c, (f, p) in enumerate(lst):
        im = Image.open(p).convert("RGB"); sh.paste(im, (c * w, r * h)); dr.text((c * w + 4, r * h + 3), f"{a} {cv} f{f} {f/30:.2f}s", fill=(255, 255, 0))
for a, cv, i, f, p in idx: os.remove(p)
os.remove(os.path.join(d, "index.json"))
sh.save(out, quality=87); print("SHEET", out, sh.size)
