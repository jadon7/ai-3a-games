"""把 game/_shots/<前缀>_NN.jpg 拼成一张图。 vsheet.py <前缀> [列数] [单格宽]"""
import sys, glob, os
from PIL import Image, ImageDraw
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
pre = sys.argv[1]; cols = int(sys.argv[2]) if len(sys.argv) > 2 else 3; w = int(sys.argv[3]) if len(sys.argv) > 3 else 960
fs = sorted(glob.glob(os.path.join(ROOT, "game", "_shots", pre + "_[0-9]*.jpg")) + glob.glob(os.path.join(ROOT, "game", "_shots", pre + "_[0-9]*.png")))
a = int(sys.argv[4]) if len(sys.argv) > 4 else 0; b = int(sys.argv[5]) if len(sys.argv) > 5 else len(fs); st = int(sys.argv[6]) if len(sys.argv) > 6 else 1
fs = fs[a:b:st]
h = w * 9 // 16; rows = (len(fs) + cols - 1) // cols
sh = Image.new("RGB", (cols * w, rows * h))
for i, f in enumerate(fs):
    im = Image.open(f).convert("RGB").resize((w, h), Image.LANCZOS); ImageDraw.Draw(im).text((8, 8), os.path.basename(f)[len(pre) + 1:-4], fill=(255, 255, 0)); sh.paste(im, ((i % cols) * w, (i // cols) * h))
out = os.path.join(ROOT, "game", "_shots", pre + "_sheet.jpg"); sh.save(out, quality=86); print(out, len(fs))
