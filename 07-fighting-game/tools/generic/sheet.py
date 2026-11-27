#!/usr/bin/env python3
"""把 bl_sheet.py 渲出来的小图拼成联系表：每行一个（来源 × 视角），每列一个时刻，左边写行名、上面写时刻。

  python tools/generic/sheet.py <job.json> <out.png> [起:止 行号范围]
"""
import glob, json, os, sys
from PIL import Image, ImageDraw, ImageFont

job = json.load(open(sys.argv[1])); out = sys.argv[2]
S = job.get("size", 220); pad = 150
try: font = ImageFont.load_default(size=16)
except Exception: font = ImageFont.load_default()
lines = []
rng = range(len(job["rows"]))
if len(sys.argv) > 3: a_, b_ = sys.argv[3].split(":"); rng = range(int(a_), min(int(b_), len(job["rows"])))
for ri in rng:
    row = job["rows"][ri]
    for v in row.get("views", ["front", "side"]):
        lines.append((ri, v, row))
ncol = max(len(job["rows"][i]["times"]) for i in rng)
W = pad + ncol * S; H = 24 + len(lines) * S
img = Image.new("RGB", (W, H), (30, 30, 34)); dr = ImageDraw.Draw(img)
for li, (ri, v, row) in enumerate(lines):
    y = 24 + li * S
    dr.text((6, y + 8), f"{row['label']}\n{row['clip']}\n{v}", fill=(230, 230, 230), font=font)
    for ci, t in enumerate(row["times"]):
        p = os.path.join(job["out_dir"], f"r{ri:02d}_{v}_{ci:02d}.png")
        if os.path.exists(p): img.paste(Image.open(p).convert("RGB").resize((S, S)), (pad + ci * S, y))
        if li == 0 or row["times"] != lines[li - 1][2]["times"]:
            dr.text((pad + ci * S + 4, y - 20 if li == 0 else y + 2), f"{t:.2f}s", fill=(255, 220, 120), font=font)
img.save(out); print("SHEET", out, img.size)
