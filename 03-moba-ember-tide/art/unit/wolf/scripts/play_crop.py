"""把测试场连拍的原图（1500×844）裁出屏幕中间那一块放大拼起来看。用法: python play_crop.py <目录> <前缀，如 A_> <输出.jpg> [列数=3] [裁剪框 x0,y0,x1,y1=520,250,1040,560] [放大=1.6]"""
import sys, glob
from PIL import Image, ImageDraw
d, pre, out = sys.argv[1:4]; cols = int(sys.argv[4]) if len(sys.argv) > 4 else 3
box = tuple(int(v) for v in sys.argv[5].split(",")) if len(sys.argv) > 5 else (520, 250, 1040, 560); k = float(sys.argv[6]) if len(sys.argv) > 6 else 1.6
fs = sorted(glob.glob(f"{d}/{pre}[0-9][0-9].jpg")); ims = []
for f in fs:
    im = Image.open(f).convert("RGB").crop(box); im = im.resize((int(im.size[0] * k), int(im.size[1] * k)), Image.LANCZOS); ImageDraw.Draw(im).text((6, 4), f.split("/")[-1][:-4], fill=(255, 255, 0)); ims.append(im)
w, h = ims[0].size; rows = (len(ims) + cols - 1) // cols; sh = Image.new("RGB", (cols * w, rows * h), (20, 20, 20))
for i, im in enumerate(ims): sh.paste(im, ((i % cols) * w, (i // cols) * h))
sh.save(out, quality=90); print(sh.size)
