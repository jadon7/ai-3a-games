"""把几张 640x720 的检查渲染图裁掉上面的空白再拼成一张大图（看蒙皮细节用）。
用法: python3 crop_sheet.py <输出.jpg> <列数> <图1> <图2> ...   每张裁 y∈[300,720]"""
import sys, os
from PIL import Image, ImageDraw
out, cols = sys.argv[1], int(sys.argv[2]); files = sys.argv[3:]
ims = []
for f in files:
    im = Image.open(f).convert("RGB"); W, H = im.size; im = im.crop((0, int(H * 0.38), W, H))
    ImageDraw.Draw(im).text((6, 4), os.path.basename(f).rsplit(".", 1)[0], fill=(255, 0, 0)); ims.append(im)
w, h = ims[0].size; rows = (len(ims) + cols - 1) // cols
sh = Image.new("RGB", (cols * w, rows * h), (40, 40, 40))
for k, im in enumerate(ims): sh.paste(im, ((k % cols) * w, (k // cols) * h))
sh.save(out, quality=90); print(sh.size)
