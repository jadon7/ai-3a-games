import sys, glob, os
from PIL import Image, ImageDraw
d, out, cols = sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 3
fs = sorted(glob.glob(os.path.join(d, "p_*.jpg")))
ims = [Image.open(f) for f in fs]; w, h = ims[0].size
W = 640; H = int(h * W / w); rows = (len(ims) + cols - 1) // cols
c = Image.new("RGB", (W * cols, H * rows)); dr = ImageDraw.Draw(c)
for i, (f, im) in enumerate(zip(fs, ims)):
    x, y = (i % cols) * W, (i // cols) * H
    c.paste(im.resize((W, H)), (x, y)); dr.text((x + 6, y + 4), os.path.basename(f), fill=(255, 255, 0))
c.save(out, quality=90)
