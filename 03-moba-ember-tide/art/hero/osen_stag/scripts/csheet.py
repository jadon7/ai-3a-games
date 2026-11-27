"""把 anim_sheet.mjs 截的图裁掉四周空白后拼成大一点的总览。用法: python3 csheet.py <目录> <动作> <输出.jpg> <视角,视角> [每行几张=6] [裁剪 左,上,右,下 比例=0.2,0.22,0.8,0.72]"""
import sys, glob
from PIL import Image, ImageDraw
d, act, out, views = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4].split(",")
cols = int(sys.argv[5]) if len(sys.argv) > 5 else 6
box = [float(x) for x in (sys.argv[6] if len(sys.argv) > 6 else "0.2,0.22,0.8,0.72").split(",")]
tiles = []
for v in views:
    for f in sorted(glob.glob(f"{d}/{act}_{v}_*.jpg")):
        im = Image.open(f).convert("RGB"); W, H = im.size; im = im.crop((int(box[0] * W), int(box[1] * H), int(box[2] * W), int(box[3] * H)))
        ImageDraw.Draw(im).text((4, 2), f.rsplit("_", 1)[1][:2] + " " + v, fill=(255, 255, 0)); tiles.append(im)
w, h = tiles[0].size; rows = (len(tiles) + cols - 1) // cols; sh = Image.new("RGB", (cols * w, rows * h))
for k, im in enumerate(tiles): sh.paste(im, ((k % cols) * w, (k // cols) * h))
sh.thumbnail((2000, 2000)); sh.save(out, quality=88); print(sh.size)
