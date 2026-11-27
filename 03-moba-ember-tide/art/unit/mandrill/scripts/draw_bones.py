#!/usr/bin/env python3
"""把 inspect_weights.py 存的骨骼二维坐标画到它渲染的三视图上（山魈：Mixamo 命名，手指不标名字）。
用法: python3 draw_bones.py <前缀，如 V2R/out/inspect/mandrill_w> [输出目录]
产出: <输出目录或前缀>_{side,top,front}_bones.jpg
注意 inspect_weights.py 的三个机位名字是按四足起的：side=沿 +Y 看（画面右=+X），top=俯视，front=沿 -X 看。
"""
import json, os, sys
from PIL import Image, ImageDraw, ImageFont

pre = sys.argv[1]; out = sys.argv[2] if len(sys.argv) > 2 else None
lines = json.load(open(pre + "_bones2d.json"))
try: font = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 15)
except Exception: font = ImageFont.load_default()
for view, segs in lines.items():
    im = Image.open(f"{pre}_{view}.png").convert("RGB"); W, H = im.size; d = ImageDraw.Draw(im)
    for k, (name, hx, hy, tx, ty) in enumerate(segs):
        short = name.split(":")[-1]
        finger = any(s in short for s in ("Index", "Middle", "Ring", "Pinky", "Thumb"))
        col = (255, 60, 60) if "Right" in short else (60, 140, 255) if "Left" in short else (255, 220, 0)
        d.line([hx * W, hy * H, tx * W, ty * H], fill=col, width=2 if finger else 4)
        r = 3 if finger else 6
        d.ellipse([hx * W - r, hy * H - r, hx * W + r, hy * H + r], outline=(0, 0, 0), fill=col)
        if not finger:
            d.text((hx * W + 7, hy * H - 16 + (k % 3) * 9), short.replace("Left", "L").replace("Right", "R"), fill=(255, 255, 255), font=font, stroke_width=2, stroke_fill=(0, 0, 0))
    dst = (os.path.join(out, os.path.basename(pre)) if out else pre) + f"_{view}_bones.jpg"
    im.save(dst, quality=88); print("写好了", dst)
