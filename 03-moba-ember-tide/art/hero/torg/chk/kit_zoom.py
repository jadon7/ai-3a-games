"""把 kit_test.mjs 连拍的单张图裁出英雄周围一块拼起来细看。用法: python kit_zoom.py <目录> <键> <输出.jpg> [张数=10] [列数=5] [裁多宽=560]"""
import sys
from PIL import Image, ImageDraw
d, key, out = sys.argv[1], sys.argv[2], sys.argv[3]; n = int(sys.argv[4]) if len(sys.argv) > 4 else 10; cols = int(sys.argv[5]) if len(sys.argv) > 5 else 5; cw = int(sys.argv[6]) if len(sys.argv) > 6 else 560
ims = []
for i in range(n):
    im = Image.open(f"{d}/{key}_{i:02d}.jpg").convert("RGB"); w, h = im.size; cx, cy = int(w * 0.5), int(h * 0.47); c = im.crop((cx - cw // 2, cy - int(cw * 0.42), cx + cw // 2, cy + int(cw * 0.42))); ImageDraw.Draw(c).text((6, 4), f"{key} {i}", fill=(255, 60, 60)); ims.append(c)
w, h = ims[0].size; rows = (n + cols - 1) // cols; sh = Image.new("RGB", (w * cols, h * rows))
for k, im in enumerate(ims): sh.paste(im, ((k % cols) * w, (k // cols) * h))
sh.save(out, quality=88); print(sh.size)
