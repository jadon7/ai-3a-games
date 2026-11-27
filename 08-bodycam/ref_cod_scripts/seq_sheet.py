import sys, os
from PIL import Image, ImageDraw
d, out, f0, f1, step = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])
fs = [f for f in range(f0, f1 + 1, step) if os.path.exists(os.path.join(d, f"f_{f:04d}.jpg"))]
ims = [Image.open(os.path.join(d, f"f_{f:04d}.jpg")) for f in fs]
w, h = ims[0].size; cols = 6; rows = (len(ims) + cols - 1) // cols
c = Image.new("RGB", (w * cols, h * rows)); dr = ImageDraw.Draw(c)
for i, (f, im) in enumerate(zip(fs, ims)):
    c.paste(im, ((i % cols) * w, (i // cols) * h)); dr.text(((i % cols) * w + 4, (i // cols) * h + 2), str(f), fill=(255, 255, 0))
c.save(out, quality=88)
