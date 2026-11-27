"""把 game/_shots/ 里某个前缀的截图拼成一张联系表。 .venv/bin/python scripts/sheet.py <前缀> [列数] [单格宽] [起] [止]"""
import sys, os, glob
from PIL import Image, ImageDraw
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
pre = sys.argv[1]; cols = int(sys.argv[2]) if len(sys.argv) > 2 else 4; w = int(sys.argv[3]) if len(sys.argv) > 3 else 640
files = sorted(glob.glob(os.path.join(ROOT, "game", "_shots", pre + "_[0-9]*.png")) + glob.glob(os.path.join(ROOT, "game", "_shots", pre + "_[0-9]*.jpg")))
a = int(sys.argv[4]) if len(sys.argv) > 4 else 0; b = int(sys.argv[5]) if len(sys.argv) > 5 else len(files)
files = files[a:b]
h = w * 9 // 16; rows = (len(files) + cols - 1) // cols
sheet = Image.new("RGB", (cols * w, rows * h), (0, 0, 0)); d = ImageDraw.Draw(sheet)
for i, f in enumerate(files):
    im = Image.open(f).convert("RGB").resize((w, h), Image.LANCZOS)
    sheet.paste(im, ((i % cols) * w, (i // cols) * h)); d.text(((i % cols) * w + 6, (i // cols) * h + 4), os.path.basename(f)[len(pre) + 1:-4], fill=(255, 255, 0))
out = os.path.join(ROOT, "renders", "test", f"sheet_{pre}.jpg"); sheet.save(out, quality=88); print(out, len(files))
