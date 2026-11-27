#!/usr/bin/env python3
# 塞伦技能证据（第九轮 k-seren）：把 fx2a_clip.mjs 录的逐帧拼成每个技能一张连续帧、一张全部技能的代表帧总表，录像拷过去。
# 用法: python3 tools/seren_evidence.py <录像目录> <证据目录>
#   录像目录里是 <技能>/f_000.jpg … 和 <技能>.mp4（30 帧一秒，前 3 帧是放之前的）
import sys, os, shutil
from PIL import Image, ImageDraw, ImageFont
src, dst = sys.argv[1], sys.argv[2]; os.makedirs(dst, exist_ok=True)
def font(sz):
    for f in ["/System/Library/Fonts/Hiragino Sans GB.ttc", "/System/Library/Fonts/STHeiti Medium.ttc", "/System/Library/Fonts/Supplemental/Arial Unicode.ttf"]:
        if os.path.exists(f): return ImageFont.truetype(f, sz)
    return ImageFont.load_default()
F, FS = font(26), font(18)
# 技能：名字、连续帧取哪几帧、代表帧、裁剪（x0,y0,x1,y1；1280×720 的原图）
JOBS = [
    ("A", "普攻", list(range(4, 52, 5)), 12, (140, 60, 1140, 620)),
    ("P", "被动 满潮弹（第四发）", list(range(5, 32, 3)), 11, (140, 40, 1140, 600)),
    ("Q", "Q 压满", [2, 5, 8, 11, 16, 22, 30, 38, 46, 54], 8, (140, 60, 1140, 620)),
    ("W2", "W 珍珠雷（滚出、埋下、生效）", [3, 7, 11, 15, 20, 26, 32, 40, 48, 60], 40, (200, 80, 1100, 586)),
    ("W", "W 珍珠雷（踩响、定身、碎壳）", [36, 40, 43, 46, 50, 55, 60, 66, 72, 78], 47, (300, 40, 1100, 490)),
    ("E", "E 反冲", [3, 5, 7, 9, 11, 13, 16, 20, 26, 34], 9, (140, 40, 1140, 600)),
    ("R", "R 沉月弹", [6, 14, 22, 28, 30, 32, 34, 37, 42, 52], 33, (100, 0, 1180, 608)),
]
picks = []
for key, name, frames, best, box in JOBS:
    d = os.path.join(src, key)
    if not os.path.isdir(d): print("没有", key); continue
    fs = [os.path.join(d, f"f_{i:03d}.jpg") for i in frames if os.path.exists(os.path.join(d, f"f_{i:03d}.jpg"))]
    cw = 520; ch = round(cw * (box[3] - box[1]) / (box[2] - box[0])); cols = 5; rows = (len(fs) + cols - 1) // cols
    S = Image.new("RGB", (cols * (cw + 4), 48 + rows * (ch + 4)), (14, 16, 18)); dr = ImageDraw.Draw(S); dr.text((12, 9), f"塞伦 · {name}（30 帧一秒；格子左上角是离放技能过了几秒）", fill=(232, 236, 232), font=F)
    for i, f in enumerate(fs):
        im = Image.open(f).crop(box).resize((cw, ch), Image.LANCZOS); x, y = (i % cols) * (cw + 4), 48 + (i // cols) * (ch + 4); S.paste(im, (x, y))
        n = int(os.path.basename(f)[2:5]); dr.rectangle((x, y, x + 74, y + 26), fill=(0, 0, 0)); dr.text((x + 6, y + 3), f"{(n - 3) / 30:+.2f}s", fill=(255, 255, 255), font=FS)
    S.save(os.path.join(dst, f"连续帧_{key}.jpg"), quality=88)
    mp4 = os.path.join(src, f"{key}.mp4")
    if os.path.exists(mp4): shutil.copy(mp4, os.path.join(dst, f"录像_{key}.mp4"))
    bf = os.path.join(d, f"f_{best:03d}.jpg")
    if os.path.exists(bf): picks.append((name, Image.open(bf).crop(box)))
if picks:
    cw = 620; cols = 4; rows = (len(picks) + cols - 1) // cols; ch = 400
    S = Image.new("RGB", (cols * (cw + 6), 50 + rows * (ch + 40)), (14, 16, 18)); dr = ImageDraw.Draw(S); dr.text((12, 10), "塞伦 · 珠铳：全部技能的代表帧（测试场固定机位）", fill=(232, 236, 232), font=F)
    for i, (name, im) in enumerate(picks):
        r = min(cw / im.width, ch / im.height); t = im.resize((round(im.width * r), round(im.height * r)), Image.LANCZOS)
        x, y = (i % cols) * (cw + 6), 50 + (i // cols) * (ch + 40); S.paste(t, (x + (cw - t.width) // 2, y + 34)); dr.text((x + 8, y + 4), name, fill=(240, 200, 180), font=FS)
    S.save(os.path.join(dst, "总表.jpg"), quality=88)
print("ok", len(picks))
