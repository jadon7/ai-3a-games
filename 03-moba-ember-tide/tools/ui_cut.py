#!/usr/bin/env python3
"""把即梦出的界面素材（art/ui/raw/）切成游戏里用的图标、头像、立绘，放到 public/assets/ui/。
  skill_<英雄>.png  2×2 的技能图标合集 → skill/<图标名>.webp（160 像素）
  item_a.png item_b.png  3×2 的装备图标合集 → item/<装备 id>.webp
  misc.png  3×2：蓝增益、红增益、兽鳞、巨魔之怒、回城、金币 → buff/<id>.webp、recall.webp、gold.webp
  splash_<英雄>.png  立绘 → splash/<英雄>.webp（600×800）和 face/<英雄>.webp（从立绘里裁出脸，256 像素见方）
用法: python3 tools/ui_cut.py [总览图输出路径]
"""
import os, sys
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); RAW = os.path.join(ROOT, "art/ui/raw"); OUT = os.path.join(ROOT, "public/assets/ui")
SKILLS = {"lan": ["lan_p", "lan_q", "lan_w", "lan_r"], "torg": ["torg_p", "torg_q", "torg_w", "torg_r"], "moko": ["moko_q", "moko_w", "moko_e", "moko_r"], "gorran": ["gorran_q", "gorran_w", "gorran_e", "gorran_r"], "vero": ["vero_q", "vero_w", "vero_e", "vero_r"], "osen": ["osen_q", "osen_w", "osen_e", "osen_r"]}
ITEMS = {"item_a": ["blade", "bow", "edge", "great", "tome", "orb"], "item_b": ["staff", "plate", "cloak", "heart", "boots", "charm"]}
MISC = ["buff/blue", "buff/red", "buff/beast", "buff/troll", "recall", "gold"]
# 每张立绘里脸在哪：中心（占宽、占高的比例）和裁多宽（占宽的比例）
FACE = {"lan": (0.52, 0.17, 0.42), "torg": (0.34, 0.27, 0.56), "moko": (0.50, 0.23, 0.46), "gorran": (0.55, 0.19, 0.42), "vero": (0.47, 0.27, 0.50), "osen": (0.43, 0.25, 0.52)}
made = []
def save(im, rel, size):
    p = os.path.join(OUT, rel + ".webp"); os.makedirs(os.path.dirname(p), exist_ok=True); im.convert("RGB").resize(size, Image.LANCZOS).save(p, quality=88, method=6); made.append(p)
def cells(path, cols, rows, pad=0.035):
    im = Image.open(path).convert("RGB"); w, h = im.width / cols, im.height / rows
    for r in range(rows):
        for c in range(cols):
            s = min(w, h) * (1 - pad * 2); cx, cy = (c + 0.5) * w, (r + 0.5) * h; yield im.crop((int(cx - s / 2), int(cy - s / 2), int(cx + s / 2), int(cy + s / 2)))
for hero, names in SKILLS.items():
    for name, im in zip(names, cells(f"{RAW}/skill_{hero}.png", 2, 2)): save(im, "skill/" + name, (160, 160))
for sheet, names in ITEMS.items():
    for name, im in zip(names, cells(f"{RAW}/{sheet}.png", 3, 2)): save(im, "item/" + name, (128, 128))
for name, im in zip(MISC, cells(f"{RAW}/misc.png", 3, 2)): save(im, name, (128, 128))
for hero, (cx, cy, k) in FACE.items():
    im = Image.open(f"{RAW}/splash_{hero}.png").convert("RGB"); save(im, "splash/" + hero, (600, 800))
    s = im.width * k; x0 = max(0, min(im.width - s, im.width * cx - s / 2)); y0 = max(0, min(im.height - s, im.height * cy - s / 2)); save(im.crop((int(x0), int(y0), int(x0 + s), int(y0 + s))), "face/" + hero, (256, 256))
print(len(made), "张，合计", round(sum(os.path.getsize(p) for p in made) / 1e6, 2), "MB")
if len(sys.argv) > 1:      # 总览：头像一排、技能四排、装备两排
    faces = [Image.open(f"{OUT}/face/{h}.webp").resize((160, 160)) for h in FACE]; sk = [Image.open(f"{OUT}/skill/{n}.webp").resize((96, 96)) for ns in SKILLS.values() for n in ns]; it = [Image.open(f"{OUT}/item/{n}.webp").resize((96, 96)) for ns in ITEMS.values() for n in ns] + [Image.open(f"{OUT}/{n}.webp").resize((96, 96)) for n in MISC]
    sh = Image.new("RGB", (160 * 6, 160 + 96 * 3 + 16), (20, 24, 26))
    for i, f in enumerate(faces): sh.paste(f, (i * 160, 0))
    for i, s_ in enumerate(sk): sh.paste(s_, (i % 10 * 96, 168 + i // 10 * 96))
    for i, s_ in enumerate(it): sh.paste(s_, ((4 + i) % 10 * 96 if i < 6 else (i - 6) % 10 * 96, 168 + (2 if i < 6 else 2) * 96 if False else 168 + 96 * 2 + 0)) if False else None
    y = 168 + 96 * 2 + 0
    sh2 = Image.new("RGB", (96 * 9, 96 * 2), (20, 24, 26))
    for i, s_ in enumerate(it): sh2.paste(s_, (i % 9 * 96, i // 9 * 96))
    full = Image.new("RGB", (960, 168 + 96 * 3 + 96 * 2 + 8), (20, 24, 26)); full.paste(sh.crop((0, 0, 960, 168 + 96 * 3)), (0, 0)); full.paste(sh2, (0, 168 + 96 * 3 + 8)); full.save(sys.argv[1], quality=88)
