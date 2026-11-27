"""把标签画到渲染图上，拼成一张检查图。用法: python scripts/viz_labels.py <dataset_dir> <out.jpg> [数量]"""
import glob, os, sys
import numpy as np
from PIL import Image, ImageDraw

d, out = sys.argv[1], sys.argv[2]
count = int(sys.argv[3]) if len(sys.argv) > 3 else 12
COL = {"L": (255, 150, 30), "R": (40, 140, 255), "M": (255, 255, 255)}
lab = [np.load(p, allow_pickle=True) for p in sorted(glob.glob(os.path.join(d, "labels_*.npz")))]
idx = np.concatenate([l["index"] for l in lab]); proj = np.concatenate([l["proj"] for l in lab])
speed = np.concatenate([l["speed"] for l in lab]); grp = lab[0]["joint_group"]
tiles = []
for i in range(min(count, len(idx))):
    row = []
    for vi, v in enumerate(("front", "side")):
        im = Image.open(os.path.join(d, v, f"{idx[i]:05d}.jpg")).convert("RGB")
        dr = ImageDraw.Draw(im)
        for k in range(proj.shape[2]):
            x, y = proj[i, vi, k, 0] * im.width, proj[i, vi, k, 1] * im.height
            dr.ellipse([x - 4, y - 4, x + 4, y + 4], fill=COL[str(grp[k])], outline=(0, 0, 0))
        dr.text((6, 6), f"#{idx[i]} {v} v={speed[i]:.1f}", fill=(0, 0, 0))
        row.append(im)
    tiles.append(row)
w, h = tiles[0][0].size
cols = 3
rows = (len(tiles) + cols - 1) // cols
sheet = Image.new("RGB", (cols * 2 * w, rows * h), (30, 30, 30))
for n, row in enumerate(tiles):
    for j, im in enumerate(row):
        sheet.paste(im, ((n % cols) * 2 * w + j * w, (n // cols) * h))
sheet.thumbnail((2000, 2000))
sheet.save(out, quality=85)
print(sheet.size)
