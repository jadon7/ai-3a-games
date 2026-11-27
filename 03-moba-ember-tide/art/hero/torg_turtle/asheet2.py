#!/usr/bin/env python3
"""把 tools/anim_sheet.mjs 截的图拼成一张，每格裁掉四周的空地（共用的 asheet.py 对拉远的机位不裁，龟在格子里太小看不清）。
用法: python3 asheet2.py <截图目录> <动作,动作…> <输出.jpg> <视角,视角> [裁剪 左,上,右,下（占边长的比例）=0.2,0.25,0.8,0.8] [最大宽=2000] [每行几格=全部]
"""
import glob, sys
from PIL import Image, ImageDraw

d, acts, out, views = sys.argv[1], sys.argv[2].split(","), sys.argv[3], sys.argv[4].split(",")
box = [float(x) for x in (sys.argv[5] if len(sys.argv) > 5 else "0.2,0.25,0.8,0.8").split(",")]; maxw = int(sys.argv[6]) if len(sys.argv) > 6 else 2000; cols = int(sys.argv[7]) if len(sys.argv) > 7 else 0
rows = []
for a in acts:
    for v in views:
        fs = sorted(glob.glob(f"{d}/{a}_{v}_*.jpg")); ims = []
        for k, f in enumerate(fs):
            im = Image.open(f).convert("RGB"); W, H = im.size; im = im.crop((int(box[0] * W), int(box[1] * H), int(box[2] * W), int(box[3] * H)))
            ImageDraw.Draw(im).text((4, 2), f"{a} {k}", fill=(255, 255, 0)); ims.append(im)
        for c0 in range(0, len(ims), cols or len(ims)):
            part = ims[c0:c0 + (cols or len(ims))]; r = Image.new("RGB", (sum(i.size[0] for i in part), part[0].size[1])); x = 0
            for i in part: r.paste(i, (x, 0)); x += i.size[0]
            rows.append(r)
sh = Image.new("RGB", (max(r.size[0] for r in rows), sum(r.size[1] for r in rows))); y = 0
for r in rows: sh.paste(r, (0, y)); y += r.size[1]
sh.thumbnail((maxw, 4000)); sh.save(out, quality=88); print(sh.size)
