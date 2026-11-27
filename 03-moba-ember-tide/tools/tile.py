import sys
from PIL import Image
out, cols, files = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
ims = [Image.open(f).convert("RGB") for f in files]
w = min(i.size[0] for i in ims); ims = [i.resize((w, round(i.size[1] * w / i.size[0]))) for i in ims]
h = max(i.size[1] for i in ims); rows = (len(ims) + cols - 1) // cols
sh = Image.new("RGB", (w * cols + 8 * (cols - 1), h * rows + 8 * (rows - 1)), (20, 22, 26))
for k, im in enumerate(ims): sh.paste(im, ((k % cols) * (w + 8), (k // cols) * (h + 8)))
sh.thumbnail((int(sys.argv[0] and 2000), 2000)); sh.save(out, quality=86)
