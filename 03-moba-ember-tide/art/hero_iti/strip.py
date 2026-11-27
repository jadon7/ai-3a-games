"""把 clip_shots.mjs 的连拍拼成一张：每段一行，左边写动作名。用法: python3.14 art/hero_iti/strip.py <目录> <输出.jpg> [动作,…] [每段张数=8] [格子边长=260]"""
import sys, os
from PIL import Image, ImageDraw, ImageFont
d, out = sys.argv[1], sys.argv[2]; acts = (sys.argv[3] if len(sys.argv) > 3 else "idle,run,attack1,attack2,q,q3,w,e,r,death").split(","); n = int(sys.argv[4]) if len(sys.argv) > 4 else 8; s = int(sys.argv[5]) if len(sys.argv) > 5 else 260
acts = [a for a in acts if os.path.exists(f"{d}/{a}_00.jpg")]
W = 110 + s * n; o = Image.new("RGB", (W, s * len(acts)), (24, 24, 28)); dr = ImageDraw.Draw(o)
try: font = ImageFont.load_default(size=30)
except Exception: font = ImageFont.load_default()
for r, a in enumerate(acts):
    dr.text((10, r * s + s // 2 - 18), a, fill=(240, 240, 240), font=font)
    for i in range(n):
        p = f"{d}/{a}_{i:02d}.jpg"
        if os.path.exists(p): o.paste(Image.open(p).convert("RGB").resize((s, s)), (110 + i * s, r * s))
o.save(out, quality=86); print(out, o.size)
