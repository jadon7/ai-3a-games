"""把 compare.mjs 的两组连拍拼成“现在 / 卡通版”上下对照，一个动作一张（换画风 B · b-lan 写的）。
用法: python3.14 tools/style_b/pairs.py <旧的目录> <新的目录> <输出目录> [英雄名=岚] [裁剪 x0,y0,x1,y1]"""
import sys, os
from PIL import Image, ImageDraw, ImageFont
old, new, out = sys.argv[1:4]; who = sys.argv[4] if len(sys.argv) > 4 else "岚"; crop = tuple(map(int, sys.argv[5].split(","))) if len(sys.argv) > 5 else (380, 110, 1180, 750)
os.makedirs(out, exist_ok=True)
NAMES = {"idle": "站", "run": "跑", "A": "普攻", "Q": "Q", "W": "W", "E": "E", "R": "R", "B": "回城", "D": "死亡"}
F = lambda n: ImageFont.truetype("/System/Library/Fonts/Hiragino Sans GB.ttc", n); font = F(30)
for key, label in NAMES.items():
    rows = []
    for d, tag in ((old, "现在（厚涂写实）"), (new, "卡通版（路子一）")):
        fs = sorted(f for f in os.listdir(d) if f.startswith(key + "_") and f.endswith(".jpg"))
        if not fs: continue
        rows.append((tag, [Image.open(os.path.join(d, f)).convert("RGB").crop(crop) for f in fs]))
    if len(rows) < 2: continue
    n = len(rows[0][1]); per = 5 if n > 5 else n; cw, ch = 400, int(400 * (crop[3] - crop[1]) / (crop[2] - crop[0])); lines = (n + per - 1) // per
    W = 150 + per * cw + (per - 1) * 4; H = 50 + 2 * (lines * ch + (lines - 1) * 4) + 14
    sh = Image.new("RGB", (W, H), (16, 18, 22)); dr = ImageDraw.Draw(sh); dr.text((12, 8), f"{who} · {label}　上：现在　下：卡通版（同一套动作、同一个测试场、同样的镜头）", fill=(230, 230, 230), font=font)
    y = 50
    for tag, ims in rows:
        a_, b_ = tag.split("（"); dr.text((10, y + 10), a_, fill=(240, 220, 160), font=F(26)); dr.text((10, y + 50), "（" + b_, fill=(170, 170, 170), font=F(18))
        for i, im in enumerate(ims):
            sh.paste(im.resize((cw, ch), Image.LANCZOS), (150 + (i % per) * (cw + 4), y + (i // per) * (ch + 4)))
        y += lines * ch + (lines - 1) * 4 + 14
    sh.save(os.path.join(out, f"{key}.jpg"), quality=86)
    print("OK", key)
