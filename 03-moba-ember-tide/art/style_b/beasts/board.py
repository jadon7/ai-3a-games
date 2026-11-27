"""拼一只野怪的对照图：上排 设定图 / 游戏里卡通版近镜头 / 游戏里旧版近镜头；下排 游戏镜头（27 米）旧版 / 卡通版。每格左上角写字。
用法: python3.14 board.py <怪> <证据目录（主目录 docs/style_b/w-beast）> [近镜头的距离=8] [裁掉画面四周的比例=0.12]
读: art/style_b/<怪>/ref.png、<证据>/<怪>/close/<怪>_d<距离>.jpg、<证据>/before/close/<怪>_d<距离>.jpg、<证据>/before/camp/<怪>_d27.jpg、<证据>/<怪>/after/<怪>_d27.jpg
写: <证据>/<怪>/compare.jpg
"""
import sys, os
from PIL import Image, ImageDraw, ImageFont
mob, E = sys.argv[1], sys.argv[2]; d = sys.argv[3] if len(sys.argv) > 3 else "8"; cut = float(sys.argv[4]) if len(sys.argv) > 4 else 0.12
font = ImageFont.truetype("/System/Library/Fonts/PingFang.ttc", 30) if os.path.exists("/System/Library/Fonts/PingFang.ttc") else ImageFont.truetype("/System/Library/Fonts/Hiragino Sans GB.ttc", 30)
W, H = 800, 520


def cell(path, label, crop=True):
    im = Image.open(path).convert("RGB")
    if crop: w, h = im.size; im = im.crop((int(w * cut), int(h * cut), int(w * (1 - cut)), int(h * (1 - cut))))
    im.thumbnail((W, H)); c = Image.new("RGB", (W, H), (60, 60, 60)); c.paste(im, ((W - im.width) // 2, (H - im.height) // 2))
    dr = ImageDraw.Draw(c); dr.rectangle([0, 0, 18 + 16 * len(label) * 1.9, 44], fill=(20, 22, 26)); dr.text((10, 4), label, fill=(255, 255, 255), font=font); return c


rows = [[(f"art/style_b/{mob}/ref.png", "设定图（路子一）", False), (f"{E}/{mob}/close/{mob}_d{d}.jpg", "游戏里 · 卡通版（近镜头）", True), (f"{E}/before/close/{mob}_d{d}.jpg", "游戏里 · 旧版（同一机位）", True)],
        [(f"{E}/before/camp/{mob}_d27.jpg", "游戏镜头 27 米 · 旧版", True), (f"{E}/{mob}/after/{mob}_d27.jpg", "游戏镜头 27 米 · 卡通版", True)]]
sheet = Image.new("RGB", (W * 3, H * 2), (40, 40, 40))
for r, row in enumerate(rows):
    for c, (p, lab, cr) in enumerate(row):
        if os.path.exists(p): sheet.paste(cell(p, lab, cr), (c * W, r * H))
sheet.save(f"{E}/{mob}/compare.jpg", quality=88); print("写好了", f"{E}/{mob}/compare.jpg")
