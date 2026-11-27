#!/usr/bin/env python3
"""摩珂自己用：把 kit_test 的原图裁到英雄附近、放大拼成一张，看动作和特效对不对得上。
用法: python3 kit_zoom.py <目录> <键> <张数> <输出.jpg> [cx=760] [cy=430] [宽=560] [高=440] [每行=6]"""
import sys
from PIL import Image, ImageDraw
d, key, n, out = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
cx, cy, w, h, cols = [int(v) for v in (sys.argv[5:10] + ["760", "430", "560", "440", "6"][len(sys.argv) - 5:])]
ims = [Image.open(f"{d}/{key}_{i:02d}.jpg").convert("RGB").crop((cx - w // 2, cy - h // 2, cx + w // 2, cy + h // 2)) for i in range(n)]
rows = (n + cols - 1) // cols; sh = Image.new("RGB", (w * cols, h * rows), (8, 9, 11)); dr = ImageDraw.Draw(sh)
for k, im in enumerate(ims): sh.paste(im, ((k % cols) * w, (k // cols) * h)); dr.text(((k % cols) * w + 6, (k // cols) * h + 4), f"{key} {k}", fill=(255, 60, 60))
if sh.size[0] > 2400: sh = sh.resize((2400, int(sh.size[1] * 2400 / sh.size[0])))
sh.save(out, quality=88); print(out, sh.size)
