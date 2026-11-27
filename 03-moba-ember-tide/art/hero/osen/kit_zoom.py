"""把 tools/kit_test.mjs 的连拍原图（1500×844）裁出英雄周围一块放大拼起来，看动作和特效对不对得上（tools/kit_sheet.py 的图里英雄只有几十像素）。
用法: python art/hero/osen/kit_zoom.py <目录> <键> [张数=10] [裁切框 x0,y0,x1,y1=520,230,1100,600] [每行几张=5] [起始序号=0] [步长=1]"""
import sys, os
from PIL import Image, ImageDraw
d, key = sys.argv[1], sys.argv[2]; n = int(sys.argv[3]) if len(sys.argv) > 3 else 10
box = tuple(int(v) for v in (sys.argv[4] if len(sys.argv) > 4 else "520,230,1100,600").split(",")); cols = int(sys.argv[5]) if len(sys.argv) > 5 else 5
i0 = int(sys.argv[6]) if len(sys.argv) > 6 else 0; step = int(sys.argv[7]) if len(sys.argv) > 7 else 1
ims = []
for i in range(i0, n, step):
    p = f"{d}/{key}_{i:02d}.jpg"
    if not os.path.exists(p): break
    im = Image.open(p).convert("RGB").crop(box); ImageDraw.Draw(im).text((6, 4), str(i), fill=(255, 90, 90)); ims.append(im)
w, h = ims[0].size; rows = (len(ims) + cols - 1) // cols; sh = Image.new("RGB", (w * cols, h * rows), (10, 10, 10))
for k, im in enumerate(ims): sh.paste(im, ((k % cols) * w, (k // cols) * h))
out = f"{d}/{key}_zoom.jpg"; sh.save(out, quality=88); print(out, sh.size)
