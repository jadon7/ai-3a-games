#!/usr/bin/env python3
"""换画风 B · b-art 的总表：每类图“现在（style-b 分支上第九轮的暗调写实版）/ B（这个工作区 public/assets/ui/ 里的新图）”上下两排并排。
用法: python3.14 tools/style_b/art_sheet.py <输出目录> [旧版所在的分支，默认 style-b]
出：splash.jpg wide.jpg face.jpg skill.jpg skill_48px.jpg item.jpg item_48px.jpg misc.jpg
"""
import io, os, subprocess, sys
from PIL import Image, ImageDraw, ImageFont
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))); UI = "public/assets/ui"
out = sys.argv[1]; base = sys.argv[2] if len(sys.argv) > 2 else "style-b"; os.makedirs(out, exist_ok=True)
FONT = ImageFont.truetype("/System/Library/Fonts/Hiragino Sans GB.ttc", 22); SMALL = ImageFont.truetype("/System/Library/Fonts/Hiragino Sans GB.ttc", 16)
BG = (13, 37, 82)   # 新界面的深海蓝
HEROES = ["gorran", "torg", "lan", "kaz", "osen", "ugo", "vero", "seren", "moko", "hedda"]
NAME = {"gorran": "葛隆", "torg": "托尔格", "lan": "岚", "kaz": "卡兹", "osen": "奥森", "ugo": "乌戈", "vero": "薇萝", "seren": "塞伦", "moko": "摩珂", "hedda": "赫达"}
def old(rel):
    b = subprocess.run(["git", "-C", ROOT, "show", f"{base}:{UI}/{rel}"], capture_output=True).stdout
    return Image.open(io.BytesIO(b)).convert("RGB") if b else None
def new(rel):
    p = os.path.join(ROOT, UI, rel); return Image.open(p).convert("RGB") if os.path.exists(p) else None
def rows(rels, size, labels=None, gap=8, cols=None):
    """两排（现在、B），每排 rels 一格；cols 给了就折行（每组现在一排、B 一排）。"""
    cols = cols or len(rels); w, h = size; groups = [rels[i:i + cols] for i in range(0, len(rels), cols)]
    lw = 90; W = lw + cols * (w + gap); H = sum(2 * (h + gap) + (30 if labels else 0) for _ in groups) + gap
    c = Image.new("RGB", (W, H), BG); d = ImageDraw.Draw(c); y = gap
    for g in groups:
        if labels:
            for i, r in enumerate(g): d.text((lw + i * (w + gap), y), labels[r], font=SMALL, fill=(233, 220, 180))
            y += 30
        for tag, get in (("现在", old), ("B", new)):
            d.text((10, y + h // 2 - 12), tag, font=FONT, fill=(255, 255, 255))
            for i, r in enumerate(g):
                im = get(r)
                if im: c.paste(im.resize((w, h), Image.LANCZOS), (lw + i * (w + gap), y))
            y += h + gap
    return c
H = [h for h in HEROES]
rows([f"splash/{h}.webp" for h in H], (240, 320), {f"splash/{h}.webp": NAME[h] for h in H}).save(f"{out}/splash.jpg", quality=88)
rows([f"wide/{h}.webp" for h in H], (480, 270), {f"wide/{h}.webp": NAME[h] for h in H}, cols=5).save(f"{out}/wide.jpg", quality=88)
rows([f"face/{h}.webp" for h in H], (128, 128), {f"face/{h}.webp": NAME[h] for h in H}).save(f"{out}/face.jpg", quality=90)
sk = sorted(f for f in os.listdir(os.path.join(ROOT, UI, "skill")) if f.endswith(".webp"))
sk = sorted(sk, key=lambda f: (HEROES.index(f.split("_")[0]), "pqwer".index(f[-6])))
rows([f"skill/{f}" for f in sk], (96, 96), {f"skill/{f}": NAME[f.split('_')[0]] + f[-6].upper() for f in sk}, cols=11).save(f"{out}/skill.jpg", quality=90)
rows([f"skill/{f}" for f in sk], (48, 48), None, gap=6, cols=22).save(f"{out}/skill_48px.jpg", quality=92)
it = sorted(f for f in os.listdir(os.path.join(ROOT, UI, "item")) if f.endswith(".webp"))
rows([f"item/{f}" for f in it], (96, 96), {f"item/{f}": f[:-5] for f in it}, cols=11).save(f"{out}/item.jpg", quality=90)
rows([f"item/{f}" for f in it], (48, 48), None, gap=6, cols=22).save(f"{out}/item_48px.jpg", quality=92)
mi = ["buff/blue.webp", "buff/red.webp", "buff/beast.webp", "buff/troll.webp", "recall.webp", "gold.webp", "emblem.webp"]
rows(mi, (128, 128), {m: m.split("/")[-1][:-5] for m in mi}).save(f"{out}/misc.jpg", quality=90)
print("ok", out)
