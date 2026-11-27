"""把 views.py 出的几张检查图横着拼成一张。用法: python montage.py <前缀> <张数> <输出.png> [每行几张]"""
import sys
from PIL import Image
prefix, n, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
cols = int(sys.argv[4]) if len(sys.argv) > 4 else n
ims = [Image.open(f"{prefix}_{i}.png").convert("RGB") for i in range(n)]
w, h = ims[0].size; rows = (n + cols - 1) // cols
sh = Image.new("RGB", (w * cols, h * rows), (0, 0, 0))
for i, im in enumerate(ims): sh.paste(im, ((i % cols) * w, (i // cols) * h))
sh.save(out); print("OK", out, sh.size)
