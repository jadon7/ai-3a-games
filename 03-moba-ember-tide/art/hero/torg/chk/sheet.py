"""把 check.py 的图拼成两张：整身六个角度一张、两只手的近景一张。用法: python sheet.py <前缀> <输出前缀>"""
import sys
from PIL import Image
p, out = sys.argv[1], sys.argv[2]
for tag, n, cols in (("v", 6, 3), ("h", 8, 4)):
    ims = [Image.open(f"{p}_{tag}{i}.png").convert("RGB") for i in range(n)]; w, h = ims[0].size
    s = Image.new("RGB", (w * cols, h * 2))
    for i, im in enumerate(ims): s.paste(im, ((i % cols) * w, (i // cols) * h))
    s.save(f"{out}_{'body' if tag == 'v' else 'hands'}.jpg", quality=90)
print("ok")
