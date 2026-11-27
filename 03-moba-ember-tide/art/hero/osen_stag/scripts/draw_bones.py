"""把 inspect_weights.py 写的 bones2d.json 画到三视图上（共用脚本只写了 json，没有画图）。
用法: python3 draw_bones.py <out_prefix，如 V2R/out/inspect/stag_w>"""
import json, sys
from PIL import Image, ImageDraw, ImageFont
pre = sys.argv[1]
lines = json.load(open(pre + "_bones2d.json"))
cols = [(255, 60, 60), (60, 200, 60), (60, 120, 255), (255, 200, 0), (255, 0, 255), (0, 220, 220), (255, 128, 0), (160, 80, 255)]
for view, segs in lines.items():
    im = Image.open(f"{pre}_{view}.png").convert("RGB"); W, H = im.size; d = ImageDraw.Draw(im)
    try: font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 15)
    except Exception: font = None
    for k, (name, hx, hy, tx, ty) in enumerate(segs):
        c = cols[k % len(cols)]
        d.line([(hx * W, hy * H), (tx * W, ty * H)], fill=c, width=3)
        d.ellipse([hx * W - 5, hy * H - 5, hx * W + 5, hy * H + 5], fill=c, outline=(0, 0, 0))
        d.text((hx * W + 7, hy * H - 8), name.replace("tripo::", "").replace("_Limb_", "L"), fill=(0, 0, 0), font=font)
    im.save(f"{pre}_{view}_bones.jpg", quality=88); print("写好了", f"{pre}_{view}_bones.jpg")
