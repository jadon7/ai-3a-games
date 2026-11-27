#!/usr/bin/env python3
"""把 check.py 渲染的几张图拼成一张。用法: python sheet.py <前缀> <张数> <输出.jpg> [每行几张=3]"""
import sys
from PIL import Image
prefix, n, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]; cols = int(sys.argv[4]) if len(sys.argv) > 4 else 3
ims = [Image.open(f"{prefix}_{i}.png").convert("RGB") for i in range(n)]
w, h = ims[0].size; rows = (n + cols - 1) // cols
r = Image.new("RGB", (w * cols, h * rows), (40, 40, 40))
for i, im in enumerate(ims): r.paste(im, ((i % cols) * w, (i // cols) * h))
r.save(out, quality=90); print("写好了", out, r.size)
