"""把 anim_shots.py 的图按动作拼成一张：上排斜看、下排侧看，每格左上角写成品动作的帧号（30 帧每秒）。用法: python shots_sheet.py <目录> <动作> <帧号列表,逗号分隔>"""
import sys, glob
from PIL import Image, ImageDraw
d, name, frames = sys.argv[1], sys.argv[2], sys.argv[3].split(",")
rows = []
for vi in (0, 1):
    fs = sorted(glob.glob(f"{d}/shot_{name}_{vi}_*.png")); ims = [Image.open(f).convert("RGB") for f in fs]; w, h = ims[0].size; r = Image.new("RGB", (w * len(ims), h))
    for i, im in enumerate(ims):
        r.paste(im, (i * w, 0)); ImageDraw.Draw(r).text((i * w + 6, 4), f"{frames[i]} ({int(frames[i]) / 30:.2f}s)", fill=(255, 40, 40))
    rows.append(r)
s = Image.new("RGB", (rows[0].size[0], rows[0].size[1] * 2)); s.paste(rows[0], (0, 0)); s.paste(rows[1], (0, rows[0].size[1])); s.save(f"{d}/shots_{name}.jpg", quality=88); print(s.size)
