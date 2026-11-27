"""把 ?views 截出来的几张图加上中文标注拼成一张"场地一览"。
  .venv/bin/python scripts/areas_sheet.py <前缀> <输出文件> <列数> 标注1|标注2|...
"""
import sys, os, glob
from PIL import Image, ImageDraw, ImageFont
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
pre, out, cols, labels = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4].split("|")
fs = sorted(glob.glob(os.path.join(ROOT, "game", "_shots", pre + "_[0-9]*.jpg")))[:len(labels)]
W = 960; H = 540
font = ImageFont.truetype("/System/Library/Fonts/Hiragino Sans GB.ttc", 30)
rows = (len(fs) + cols - 1) // cols
sh = Image.new("RGB", (cols * W, rows * H), (0, 0, 0))
for i, f in enumerate(fs):
    im = Image.open(f).convert("RGB").resize((W, H), Image.LANCZOS); d = ImageDraw.Draw(im)
    tw = d.textlength(labels[i], font=font)
    d.rectangle([14, H - 58, 14 + tw + 24, H - 14], fill=(0, 0, 0)); d.text((26, H - 54), labels[i], font=font, fill=(255, 214, 90))
    sh.paste(im, ((i % cols) * W, (i // cols) * H))
p = os.path.join(ROOT, out); sh.save(p, quality=90); print(p, sh.size)
