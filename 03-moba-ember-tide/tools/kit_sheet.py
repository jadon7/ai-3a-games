#!/usr/bin/env python3
"""把 kit_test.mjs 连拍的一组图裁掉界面、缩小、按时间排成一张。用法: python3 tools/kit_sheet.py <目录> <键> <张数>"""
import sys
from PIL import Image
d, key, n = sys.argv[1], sys.argv[2], int(sys.argv[3])
ims = []
for i in range(n):
    im = Image.open(f"{d}/{key}_{i:02d}.jpg").convert("RGB"); w, h = im.size
    ims.append(im.crop((int(w * 0.2), int(h * 0.1), int(w * 0.84), int(h * 0.8))))
w, h = ims[0].size; cols = 5 if n > 6 else 3; rows = (n + cols - 1) // cols
sh = Image.new("RGB", (w * cols + 4 * (cols - 1), h * rows + 4 * (rows - 1)), (8, 9, 11))
for k, im in enumerate(ims): sh.paste(im, ((k % cols) * (w + 4), (k // cols) * (h + 4)))
sh.thumbnail((2000, 2000)); sh.save(f"{d}/{key}.jpg", quality=85)
