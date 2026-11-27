"""把几张图横着拼成一张（高度对齐到第一张）。用法: python3 strip.py <输出.jpg> <图1> <图2> ... [--h 高度]"""
import sys
from PIL import Image
args = sys.argv[1:]; h = None
if "--h" in args: i = args.index("--h"); h = int(args[i + 1]); del args[i:i + 2]
out, files = args[0], args[1:]
ims = [Image.open(f).convert("RGB") for f in files]
h = h or ims[0].height
ims = [im.resize((round(im.width * h / im.height), h)) for im in ims]
c = Image.new("RGB", (sum(im.width for im in ims), h), (0, 0, 0)); x = 0
for im in ims: c.paste(im, (x, 0)); x += im.width
c.save(out, quality=88); print(out, c.size)
