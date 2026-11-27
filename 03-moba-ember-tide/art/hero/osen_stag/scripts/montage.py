"""把几张图拼成一张带标题的总览。用法: python3 montage.py <输出.jpg> <列数> <单格宽> <图1> <图2> ..."""
import sys, os
from PIL import Image, ImageDraw
out, cols, cw = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]); files = sys.argv[4:]
ims = []
for f in files:
    im = Image.open(f).convert("RGB"); im = im.resize((cw, int(im.size[1] * cw / im.size[0])))
    ImageDraw.Draw(im).text((6, 4), os.path.basename(f).rsplit(".", 1)[0], fill=(255, 0, 0)); ims.append(im)
h = max(i.size[1] for i in ims); rows = (len(ims) + cols - 1) // cols
sh = Image.new("RGB", (cols * cw, rows * h), (40, 40, 40))
for k, im in enumerate(ims): sh.paste(im, ((k % cols) * cw, (k // cols) * h))
sh.save(out, quality=88); print(sh.size)
