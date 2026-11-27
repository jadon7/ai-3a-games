# 把一个目录里的几帧拼成一张小联系表看（自己看用）。用法: python grid.py <输出.jpg> <列数> <缩放> <帧1.jpg> <帧2.jpg> ...
import sys
from PIL import Image, ImageDraw, ImageFont
out, cols, sc = sys.argv[1], int(sys.argv[2]), float(sys.argv[3]); files = sys.argv[4:]
ims = [Image.open(f) for f in files]; w, h = int(ims[0].width * sc), int(ims[0].height * sc)
rows = (len(ims) + cols - 1) // cols; G = Image.new("RGB", (cols * w, rows * h), (16, 16, 18)); d = ImageDraw.Draw(G)
try: font = ImageFont.truetype("/System/Library/Fonts/PingFang.ttc", 22)
except Exception: font = None
for i, (im, f) in enumerate(zip(ims, files)):
    x, y = (i % cols) * w, (i // cols) * h; G.paste(im.resize((w, h)), (x, y)); d.text((x + 8, y + 6), f.split("/")[-2] + "/" + f.split("/")[-1].replace("f_", "").replace(".jpg", ""), fill=(255, 255, 255), font=font)
G.save(out, quality=88)
