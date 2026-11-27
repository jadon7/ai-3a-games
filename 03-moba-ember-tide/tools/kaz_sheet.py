#!/usr/bin/env python3.14
# 卡兹的证据图（第九轮 k-kaz）：每个技能一张连续帧（取技能发生那一段里均匀的几帧，带时间和标题），再拼一张全部技能代表帧的总表。
# 用法: python3 tools/kaz_sheet.py <录像目录（kaz_rec.sh 的输出）> <输出目录>
import sys, os
from PIL import Image, ImageDraw, ImageFont
src, out = sys.argv[1], sys.argv[2]; os.makedirs(out, exist_ok=True)
F = ImageFont.truetype("/System/Library/Fonts/Hiragino Sans GB.ttc", 22); FB = ImageFont.truetype("/System/Library/Fonts/Hiragino Sans GB.ttc", 30)
# 名字: (标题, 起始帧, 结束帧, 取几张, 裁剪框, 总表里用哪一帧)；起始帧写成列表就是直接用这几帧（普攻的爪痕只亮 0.2 秒，均匀取会漏掉）
JOBS = {
  "A": ("普攻 + 灼痕（第三下点燃）", [6, 7, 9, 27, 28, 49, 69, 70, 75, 84], 0, 10, (300, 110, 1060, 600), 7),
  "Q": ("Q 扑杀", 4, 40, 10, (260, 110, 1100, 640), 19),
  "W": ("W 裂爪（两爪）", 4, 26, 10, (260, 90, 1060, 640), 9),
  "E": ("E 炉吼", 4, 30, 10, (240, 90, 1080, 640), 10),
  "R": ("R 焚猎：起手 → 扑 → 锁定", 4, 100, 12, (240, 110, 1100, 650), 64),
  "Rkill": ("R 锁定中击杀：Q W 转好、回血", 30, 70, 8, (300, 110, 1060, 620), 40),
}
cells = []
for name, (title, a, b, n, crop, best) in JOBS.items():
    d = os.path.join(src, name)
    if not os.path.isdir(d): continue
    have = len([f for f in os.listdir(d) if f.startswith("f_")]); b = min(b, have - 1) if not isinstance(a, list) else b
    idx = [i for i in a if i < have] if isinstance(a, list) else [round(a + (b - a) * i / max(1, n - 1)) for i in range(n)]; n = len(idx)
    ims = [Image.open(os.path.join(d, f"f_{i:03d}.jpg")).crop(crop) for i in idx]
    cw = 480; ch = round(cw * ims[0].height / ims[0].width); cols = 5 if n % 5 == 0 else 4 if n % 4 == 0 else 5; rows = (n + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cw, rows * ch + 50), (14, 16, 18)); dr = ImageDraw.Draw(sheet); dr.text((12, 8), f"卡兹 {title}（测试场，固定机位，对局时间）", fill=(240, 240, 240), font=FB)
    for k, (i, im) in enumerate(zip(idx, ims)):
        x, y = (k % cols) * cw, (k // cols) * ch + 50; sheet.paste(im.resize((cw, ch), Image.LANCZOS), (x, y)); dr.text((x + 8, y + 6), f"{i / 30:.2f}s", fill=(255, 255, 255), font=F)
    sheet.save(os.path.join(out, f"连续帧_{name}.jpg"), quality=86); print("连续帧", name, sheet.size)
    cells.append((title, Image.open(os.path.join(d, f"f_{min(best, have - 1):03d}.jpg")).crop(crop)))
if cells:
    cw = 720; ch = round(cw * cells[0][1].height / cells[0][1].width); cols = 3; rows = (len(cells) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cw, rows * ch + 56), (14, 16, 18)); dr = ImageDraw.Draw(sheet); dr.text((14, 10), "卡兹 · 焚爪：每个技能的代表帧（第九轮 k-kaz）", fill=(240, 240, 240), font=FB)
    for k, (title, im) in enumerate(cells):
        x, y = (k % cols) * cw, (k // cols) * ch + 56; sheet.paste(im.resize((cw, ch), Image.LANCZOS), (x, y)); dr.rectangle((x, y, x + 12 + 26 * len(title) // 1, y + 36), fill=(10, 10, 12)); dr.text((x + 8, y + 4), title, fill=(255, 255, 255), font=F)
    sheet.save(os.path.join(out, "总表.jpg"), quality=86); print("总表", sheet.size)
