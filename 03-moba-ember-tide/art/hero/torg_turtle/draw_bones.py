#!/usr/bin/env python3
"""把 inspect_weights.py 存的骨骼二维坐标画到它渲染的三视图上（手册说脚本会自己画，实际只存了 PNG 和 bones2d.json）。
用法: python3 draw_bones.py <前缀，如 V2R/out/inspect/turtle_w>
产出: <前缀>_{side,top,front}_bones.jpg
"""
import json, sys
from PIL import Image, ImageDraw, ImageFont

pre = sys.argv[1]
lines = json.load(open(pre + "_bones2d.json"))
try: font = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 15)
except Exception: font = ImageFont.load_default()
for view, segs in lines.items():
    im = Image.open(f"{pre}_{view}.png").convert("RGB"); W, H = im.size; d = ImageDraw.Draw(im)
    for k, (name, hx, hy, tx, ty) in enumerate(segs):
        short = name.replace("tripo::", "")
        col = (255, 60, 60) if "Right" in name else (60, 120, 255) if "Left" in name else (255, 220, 0) if "Head" in name or "Spine" in name or "Root" in name else (0, 255, 120)
        d.line([hx * W, hy * H, tx * W, ty * H], fill=col, width=3)
        d.ellipse([hx * W - 5, hy * H - 5, hx * W + 5, hy * H + 5], outline=(0, 0, 0), fill=col)
        d.text((hx * W + 6, hy * H - 16 + (k % 3) * 9), short, fill=(255, 255, 255), font=font, stroke_width=2, stroke_fill=(0, 0, 0))
    im.save(f"{pre}_{view}_bones.jpg", quality=88); print("写好了", f"{pre}_{view}_bones.jpg")
