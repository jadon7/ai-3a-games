#!/usr/bin/env python3
"""art4 的总览图：十张竖版海报并排、十张横版、十个头像（256 和 40 像素）、新旧技能图标，写到 docs/round9/art4/。
用法: python3 art/ui/art4_overview.py"""
import os
from PIL import Image, ImageDraw, ImageFont
ROOT = "/Users/jadon7/Documents/SynologyDrive/code/moba"; UI = ROOT + "/public/assets/ui"; DOC = ROOT + "/docs/round9/art4"
os.makedirs(DOC, exist_ok=True)
OLD = ["gorran", "torg", "lan", "osen", "vero", "moko"]; NEW = ["kaz", "hedda", "ugo", "seren"]
ALL = ["gorran", "torg", "lan", "kaz", "osen", "ugo", "vero", "seren", "moko", "hedda"]     # 按位置排：上单、打野、法师、射手、辅助
NAME = {"gorran": "葛隆", "torg": "托尔格", "lan": "岚", "kaz": "卡兹*", "osen": "奥森", "ugo": "乌戈*", "vero": "薇萝", "seren": "塞伦*", "moko": "摩珂", "hedda": "赫达*"}
BG = (16, 17, 19)
def op(p, size):
    """没有的图（还没出）画一块灰。"""
    return Image.open(p).convert("RGB").resize(size, Image.LANCZOS) if os.path.exists(p) else Image.new("RGB", size, (60, 60, 60))
try: FONT = ImageFont.truetype("/System/Library/Fonts/Hiragino Sans GB.ttc", 22)
except Exception: FONT = ImageFont.load_default()
def label(d, xy, s): d.text(xy, s, fill=(220, 220, 220), font=FONT)

# 1. 十张竖版海报
W, H = 360, 480
sh = Image.new("RGB", (len(ALL) * (W + 8) + 8, H + 48), BG); d = ImageDraw.Draw(sh)
for i, h in enumerate(ALL):
    sh.paste(op(f"{UI}/splash/{h}.webp", (W, H)), (8 + i * (W + 8), 8)); label(d, (8 + i * (W + 8), H + 14), NAME[h])
sh.save(f"{DOC}/splash_all10.jpg", quality=88)
# 2. 十张横版
W, H = 640, 360
sh = Image.new("RGB", (5 * (W + 8) + 8, 2 * (H + 40) + 8), BG); d = ImageDraw.Draw(sh)
for i, h in enumerate(ALL):
    x, y = 8 + i % 5 * (W + 8), 8 + i // 5 * (H + 40)
    sh.paste(op(f"{UI}/wide/{h}.webp", (W, H)), (x, y)); label(d, (x, y + H + 6), NAME[h])
sh.save(f"{DOC}/wide_all10.jpg", quality=88)
# 3. 头像：256、64、40 像素
sh = Image.new("RGB", (len(ALL) * 264 + 8, 256 + 40 + 64 + 16 + 40 + 40), BG); d = ImageDraw.Draw(sh)
for i, h in enumerate(ALL):
    f = op(f"{UI}/face/{h}.webp", (256, 256)); x = 8 + i * 264
    sh.paste(f, (x, 8)); label(d, (x, 270), NAME[h]); sh.paste(f.resize((64, 64), Image.LANCZOS), (x, 304)); sh.paste(f.resize((40, 40), Image.LANCZOS), (x + 80, 316))
sh.save(f"{DOC}/face_all10.png")
# 4. 技能图标：一行一个英雄，被动 Q W E R 对齐，没有的格子空着
S = 120
sh = Image.new("RGB", (130 + 5 * (S + 8), len(ALL) * (S + 8) + 48), BG); d = ImageDraw.Draw(sh)
for k, key in enumerate("PQWER"): label(d, (130 + k * (S + 8) + S // 2 - 6, 10), key)
for i, h in enumerate(ALL):
    y = 44 + i * (S + 8); label(d, (10, y + S // 2 - 12), NAME[h])
    for k, key in enumerate("pqwer"):
        p = f"{UI}/skill/{h}_{key}.webp"
        if os.path.exists(p): sh.paste(Image.open(p).convert("RGB").resize((S, S), Image.LANCZOS), (130 + k * (S + 8), y))
sh.save(f"{DOC}/skill_all10.png")
# 5. 图标缩到对局里的大小（48 像素）一排排看
S = 48
sh = Image.new("RGB", (130 + 5 * (S + 6), len(ALL) * (S + 6) + 12), BG); d = ImageDraw.Draw(sh)
for i, h in enumerate(ALL):
    y = 6 + i * (S + 6); label(d, (10, y + 10), NAME[h])
    for k, key in enumerate("pqwer"):
        p = f"{UI}/skill/{h}_{key}.webp"
        if os.path.exists(p): sh.paste(Image.open(p).convert("RGB").resize((S, S), Image.LANCZOS), (130 + k * (S + 6), y))
sh.save(f"{DOC}/skill_all10_48px.png")
print("ok", DOC)
