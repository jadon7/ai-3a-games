#!/usr/bin/env python3
"""iti-art 的总表：伊缇的新图和现有十个英雄的海报、横版、头像、技能图标放在一起（读这个 worktree 的 public/assets/ui/）。
样子照 tools/style_b/art_sheet.py（深海蓝底、名字在上），伊缇那一格加一道金边好找。
用法: python3.14 art/hero_iti/ui/sheet.py <输出目录>
出：splash_all11.jpg wide_all11.jpg face_all11.jpg skill_all.jpg skill_48px.jpg skill_bar.jpg
"""
import os, sys
from PIL import Image, ImageDraw, ImageFont
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE))); UI = os.path.join(ROOT, "public/assets/ui")
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
F = "/System/Library/Fonts/Hiragino Sans GB.ttc"; FONT = ImageFont.truetype(F, 22); SMALL = ImageFont.truetype(F, 16)
BG = (13, 37, 82); GOLD = (240, 200, 110); TXT = (233, 220, 180)
HEROES = ["iti", "gorran", "torg", "lan", "kaz", "osen", "ugo", "vero", "seren", "moko", "hedda"]
NAME = {"iti": "伊缇", "gorran": "葛隆", "torg": "托尔格", "lan": "岚", "kaz": "卡兹", "osen": "奥森", "ugo": "乌戈", "vero": "薇萝", "seren": "塞伦", "moko": "摩珂", "hedda": "赫达"}
def get(rel):
    p = os.path.join(UI, rel); return Image.open(p).convert("RGB") if os.path.exists(p) else None
def grid(rels, size, labels, cols, gap=10, hl=lambda r: r.startswith("iti") or "/iti" in r):
    w, h = size; rowsN = (len(rels) + cols - 1) // cols; lh = 28 if labels else 0
    c = Image.new("RGB", (gap + cols * (w + gap), gap + rowsN * (h + lh + gap)), BG); d = ImageDraw.Draw(c)
    for i, r in enumerate(rels):
        x = gap + (i % cols) * (w + gap); y = gap + (i // cols) * (h + lh + gap)
        if labels: d.text((x, y), labels[i], font=SMALL, fill=GOLD if hl(r) else TXT)
        im = get(r)
        if im: c.paste(im.resize((w, h), Image.LANCZOS), (x, y + lh))
        if hl(r): d.rectangle((x - 4, y + lh - 4, x + w + 3, y + lh + h + 3), outline=GOLD, width=3)
    return c
grid([f"splash/{h}.webp" for h in HEROES], (240, 320), [NAME[h] for h in HEROES], 11).save(f"{out}/splash_all11.jpg", quality=88)
grid([f"wide/{h}.webp" for h in HEROES], (480, 270), [NAME[h] for h in HEROES], 4).save(f"{out}/wide_all11.jpg", quality=86)
# 头像：128 一排、48 一排（顶栏、计分板上差不多这么大）
a = grid([f"face/{h}.webp" for h in HEROES], (128, 128), [NAME[h] for h in HEROES], 11); b = grid([f"face/{h}.webp" for h in HEROES], (48, 48), None, 11, gap=8)
c = Image.new("RGB", (max(a.width, b.width), a.height + b.height), BG); c.paste(a, (0, 0)); c.paste(b, (0, a.height)); c.save(f"{out}/face_all11.jpg", quality=90)
sk = [f for f in os.listdir(os.path.join(UI, "skill")) if f.endswith(".webp")]
sk = sorted(sk, key=lambda f: (HEROES.index(f.split("_")[0]), "pqwer".index(f[-6])))
lab = [NAME[f.split("_")[0]] + f[-6].upper() for f in sk]
grid([f"skill/{f}" for f in sk], (96, 96), lab, 10).save(f"{out}/skill_all.jpg", quality=90)
grid([f"skill/{f}" for f in sk], (48, 48), None, 20, gap=6).save(f"{out}/skill_48px.jpg", quality=92)
# 技能栏样子：每个英雄一行、五格 64 像素（对局底栏电脑上约 56–64），伊缇在第一行
rows = [[f for f in sk if f.startswith(h + "_")] for h in HEROES]
W = 110 + 5 * 74; H = 10 + len(rows) * 74; c = Image.new("RGB", (W, H), BG); d = ImageDraw.Draw(c)
for i, fs in enumerate(rows):
    y = 10 + i * 74; d.text((10, y + 20), NAME[HEROES[i]], font=FONT, fill=GOLD if HEROES[i] == "iti" else TXT)
    for f in fs:
        x = 110 + "pqwer".index(f[-6]) * 74; d.rounded_rectangle((x - 2, y - 2, x + 65, y + 65), 8, outline=(210, 170, 90), width=2)
        c.paste(get(f"skill/{f}").resize((64, 64), Image.LANCZOS), (x, y))
c.save(f"{out}/skill_bar.jpg", quality=92)
print("ok", out)
