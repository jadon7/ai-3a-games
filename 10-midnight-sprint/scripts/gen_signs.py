#!/usr/bin/env python3
"""生成霓虹招牌 / 灯箱 / LED 广告牌 / 路牌 / 导向箭头贴图 → assets/signs/*.png + manifest.json
全部是虚构的店名和品牌。运行：uv run --with pillow --with numpy python gen_signs.py"""
import json, os, random, math
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "signs")
os.makedirs(OUT, exist_ok=True)
F = lambda n: os.path.join(ROOT, "assets", "fonts", n)
FONT_CN = [F("ZCOOLQingKeHuangYou-Regular.ttf"), F("ZCOOLKuaiLe-Regular.ttf"), F("MaShanZheng-Regular.ttf")]
FONT_EN = [F("BebasNeue-Regular.ttf"), F("BarlowCondensed-ExtraBoldItalic.ttf"), F("Monoton-Regular.ttf"), F("BarlowCondensed-BoldItalic.ttf")]

PINK = (255, 45, 120); CYAN = (25, 240, 224); YELLOW = (255, 210, 30); RED = (255, 59, 48)
ORANGE = (255, 122, 26); PURPLE = (155, 92, 255); GREEN = (61, 255, 122); WHITE = (244, 244, 255); BLUE = (45, 140, 255)
NEON = [PINK, CYAN, YELLOW, RED, ORANGE, PURPLE, GREEN, WHITE, BLUE]
BG = (6, 6, 10)
rng = random.Random(7)
manifest = []


def font(path, size):
    return ImageFont.truetype(path, size)


def fit_font(path, text, max_w, max_h, start=400):
    size = start
    while size > 8:
        f = font(path, size)
        l, t, r, b = f.getbbox(text)
        if r - l <= max_w and b - t <= max_h:
            return f
        size -= 4
    return font(path, 8)


def glow(layer, radius, gain=1.0):
    """layer: RGB 黑底亮字。返回带辉光的图。"""
    g1 = layer.filter(ImageFilter.GaussianBlur(radius))
    g2 = layer.filter(ImageFilter.GaussianBlur(radius * 3))
    out = ImageChops.add(layer, g1)
    out = ImageChops.add(out, Image.eval(g2, lambda v: int(v * 0.6 * gain)))
    return out


def text_center(d, box, text, f, fill):
    l, t, r, b = d.textbbox((0, 0), text, font=f)
    x = box[0] + (box[2] - box[0] - (r - l)) / 2 - l
    y = box[1] + (box[3] - box[1] - (b - t)) / 2 - t
    d.text((x, y), text, font=f, fill=fill)


def save(im, name, kind, color, **extra):
    im.save(os.path.join(OUT, name + ".png"))
    manifest.append(dict(file=name + ".png", kind=kind, w=im.width, h=im.height, color=[c / 255 for c in color], **extra))


def tube_border(d, w, h, col, inset=14, width=7, radius=26):
    d.rounded_rectangle((inset, inset, w - inset, h - inset), radius=radius, outline=col, width=width)


# ---------- 竖招牌（中文竖排） ----------
BLADES = ["夜猫拉面", "极速改装", "霓虹酒吧", "龙记茶餐厅", "星河电玩城", "不夜城", "老街烧烤", "午夜咖啡", "风驰车行", "云顶酒店",
          "金辉珠宝", "港湾海鲜", "半夜面馆", "极光网咖", "红灯笼火锅", "飞轮轮胎", "大排档", "足浴按摩", "台球俱乐部", "麻辣烫"]
for i, txt in enumerate(BLADES):
    w, h = 256, 1024
    col = NEON[i % len(NEON)]
    col2 = NEON[(i * 3 + 4) % len(NEON)]
    lightbox = i % 3 == 1
    bg = tuple(int(c * 0.85) for c in col) if lightbox else BG
    im = Image.new("RGB", (w, h), bg)
    layer = Image.new("RGB", (w, h), (0, 0, 0))
    d = ImageDraw.Draw(layer)
    n = len(txt)
    cell = (h - 80) / n
    fp = FONT_CN[i % len(FONT_CN)]
    f = fit_font(fp, "国", w - 70, cell - 14, 220)
    for k, ch in enumerate(txt):
        text_center(d, (0, 40 + k * cell, w, 40 + (k + 1) * cell), ch, f, (255, 255, 255) if lightbox else col)
    if lightbox:
        im = ImageChops.add(im, Image.eval(layer, lambda v: v))
        d2 = ImageDraw.Draw(im)
        d2.rectangle((6, 6, w - 6, h - 6), outline=(255, 255, 255), width=6)
    else:
        tube_border(d, w, h, col2)
        im = ImageChops.add(im, glow(layer, 9))
    save(im, f"blade_{i:02d}", "blade", col, lightbox=lightbox)

# ---------- 横招牌 ----------
HORIZ = [("NOVA CLUB", None), ("TURBO GARAGE", None), ("24H MART", "便利店"), ("RAMEN BAR", "拉面"), ("ARCADE ZONE", "电玩"),
         ("HOTEL ORBIT", "酒店"), ("MIDNIGHT DINER", None), ("NEON LOUNGE", None), ("APEX TUNING", "改装"), ("KARAOKE", "KTV"),
         ("PIXEL CAFE", "网咖"), ("SLIDEWAYS", None), ("NIGHT MARKET", "夜市"), ("NOODLE HOUSE", "面馆"), ("BAR 88", "酒吧"),
         ("LUCKY DRAGON", "龙记"), ("TIRE WORKS", "轮胎"), ("HOT POT", "火锅"), ("TEA & CO", "茶"), ("OPEN 24/7", None)]
for i, (en, cn) in enumerate(HORIZ):
    w, h = 1024, 256
    col = NEON[(i * 2 + 1) % len(NEON)]
    col2 = NEON[(i * 5 + 3) % len(NEON)]
    lightbox = i % 4 == 2
    bg = tuple(int(c * 0.8) for c in col) if lightbox else BG
    im = Image.new("RGB", (w, h), bg)
    layer = Image.new("RGB", (w, h), (0, 0, 0))
    d = ImageDraw.Draw(layer)
    fe = FONT_EN[i % len(FONT_EN)]
    if cn:
        fc = fit_font(FONT_CN[i % 2], cn, 300, 170, 200)
        text_center(d, (20, 20, 330, h - 20), cn, fc, (255, 255, 255) if lightbox else col2)
        f = fit_font(fe, en, 620, 150, 220)
        text_center(d, (350, 20, w - 30, h - 20), en, f, (255, 255, 255) if lightbox else col)
    else:
        f = fit_font(fe, en, w - 110, 160, 240)
        text_center(d, (0, 0, w, h), en, f, (255, 255, 255) if lightbox else col)
    if lightbox:
        im = ImageChops.add(im, layer)
    else:
        tube_border(d, w, h, col2)
        im = ImageChops.add(im, glow(layer, 8))
    save(im, f"horiz_{i:02d}", "horiz", col, lightbox=lightbox)

# ---------- 方形标志 ----------
SQUARE = ["酒", "面", "茶", "P", "24", "N", "夜", "龙", "88", "X", "电", "烤"]
for i, txt in enumerate(SQUARE):
    w = h = 512
    col = NEON[(i * 4 + 2) % len(NEON)]
    col2 = NEON[(i + 5) % len(NEON)]
    im = Image.new("RGB", (w, h), BG)
    layer = Image.new("RGB", (w, h), (0, 0, 0))
    d = ImageDraw.Draw(layer)
    if i % 2 == 0:
        d.ellipse((30, 30, w - 30, h - 30), outline=col2, width=14)
    else:
        d.rounded_rectangle((30, 30, w - 30, h - 30), radius=60, outline=col2, width=14)
    fp = FONT_CN[0] if ord(txt[0]) > 255 else FONT_EN[0]
    f = fit_font(fp, txt, 300, 300, 380)
    text_center(d, (0, 0, w, h), txt, f, col)
    im = ImageChops.add(im, glow(layer, 12))
    save(im, f"square_{i:02d}", "square", col)

# ---------- LED 广告牌 ----------
BOARDS = [("VOLT", "ENERGY DRINK", PINK, PURPLE), ("AERO X1", "ALL-ELECTRIC. ALL-NIGHT.", CYAN, BLUE), ("NITRO+", "HIGH OCTANE FUEL", ORANGE, RED),
          ("城市之夜", "CITY NIGHT GRAND PRIX", YELLOW, ORANGE), ("新世界", "NEW WORLD MALL", PURPLE, PINK), ("KAIZO", "FORGED WHEELS", WHITE, BLUE),
          ("极速", "TOP SPEED TONIGHT", RED, ORANGE), ("ORBIT", "MOBILE 6G", GREEN, CYAN), ("HALO", "SOUND SYSTEMS", BLUE, PURPLE), ("午夜车会", "MIDNIGHT CAR MEET", CYAN, PINK),
          ("ZENITH", "WATCHES", YELLOW, WHITE), ("LIVE", "TONIGHT 23:00 · PIER 9", PINK, YELLOW)]
for i, (big, small, c1, c2) in enumerate(BOARDS):
    w, h = 1024, 576
    im = Image.new("RGB", (w, h))
    px = im.load()
    for y in range(h):
        for x in range(0, w):
            t = (x / w * 0.6 + y / h * 0.4)
            px[x, y] = tuple(int((c1[k] * (1 - t) + c2[k] * t) * 0.42) for k in range(3))
    d = ImageDraw.Draw(im)
    # 斜条纹装饰
    for k in range(-4, 14):
        x0 = k * 110 + (i * 37) % 110
        d.polygon([(x0, h), (x0 + 40, h), (x0 + 240, 0), (x0 + 200, 0)], fill=tuple(min(255, int(c * 0.55)) for c in c1))
    d.rectangle((0, h - 150, w, h), fill=(10, 10, 16))
    fb = fit_font(FONT_CN[0] if ord(big[0]) > 255 else FONT_EN[i % 2], big, w - 160, 300, 400)
    text_center(d, (0, 20, w, h - 150), big, fb, (255, 255, 255))
    fs = fit_font(FONT_CN[0] if any(ord(ch) > 255 for ch in small) else FONT_EN[3], small, w - 120, 84, 120)
    text_center(d, (0, h - 150, w, h), small, fs, c1)
    im = ImageChops.add(im, im.filter(ImageFilter.GaussianBlur(10)).point(lambda v: int(v * 0.35)))
    save(im, f"board_{i:02d}", "board", c1)

# ---------- 导向箭头（封路挡板上的流动箭头） ----------
for name, col in (("chevron_r", ORANGE), ("chevron_c", CYAN)):
    w, h = 512, 256
    im = Image.new("RGB", (w, h), (4, 4, 6))
    layer = Image.new("RGB", (w, h), (0, 0, 0))
    d = ImageDraw.Draw(layer)
    for k in range(4):
        x0 = k * 128 + 14
        d.polygon([(x0, 28), (x0 + 44, 28), (x0 + 108, 128), (x0 + 44, 228), (x0, 228), (x0 + 64, 128)], fill=col)
    im = ImageChops.add(im, glow(layer, 6))
    save(im, name, "chevron", col)

# ---------- 路牌（龙门架上的蓝色指路牌） ----------
ROADSIGNS = [("市中心", "Downtown", "↑"), ("滨江大桥", "Riverside Bridge", "↑"), ("不夜街", "Neon St", "→"), ("下穿隧道", "Underpass", "↑"), ("码头", "Pier 9", "↗")]
for i, (cn, en, arrow) in enumerate(ROADSIGNS):
    w, h = 768, 384
    im = Image.new("RGB", (w, h), (8, 52, 140))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((8, 8, w - 8, h - 8), radius=24, outline=(235, 235, 235), width=8)
    # 箭头手绘（字体里没有箭头字形）
    ang = {"↑": 0, "↗": -45, "→": -90}[arrow]
    arr = Image.new("L", (220, 220), 0)
    da = ImageDraw.Draw(arr)
    da.polygon([(110, 14), (190, 110), (138, 110), (138, 206), (82, 206), (82, 110), (30, 110)], fill=255)
    arr = arr.rotate(ang, resample=Image.BICUBIC)
    im.paste((245, 245, 245), (30, (h - 220) // 2), arr)
    fc = fit_font(F("ZCOOLQingKeHuangYou-Regular.ttf"), cn, 470, 170, 200)
    text_center(d, (260, 30, w - 30, 220), cn, fc, (245, 245, 245))
    fe2 = fit_font(F("BarlowCondensed-BoldItalic.ttf"), en, 470, 90, 120)
    text_center(d, (260, 230, w - 30, h - 30), en, fe2, (245, 245, 245))
    save(im, f"roadsign_{i:02d}", "roadsign", (30, 80, 200))

# ---------- 起点 / 终点横幅 ----------
for name, txt, c1 in (("banner_start", "START", CYAN), ("banner_finish", "FINISH", PINK)):
    w, h = 2048, 256
    im = Image.new("RGB", (w, h), (5, 5, 8))
    layer = Image.new("RGB", (w, h), (0, 0, 0))
    d = ImageDraw.Draw(layer)
    sq = 32
    for seg in ((0, 420), (w - 420, w)):
        for yy in range(0, h, sq):
            for xx in range(seg[0], seg[1], sq):
                if ((xx - seg[0]) // sq + yy // sq) % 2 == 0:
                    d.rectangle((xx, yy, xx + sq - 1, yy + sq - 1), fill=(235, 235, 235))
    f = fit_font(F("BarlowCondensed-ExtraBoldItalic.ttf"), txt, 1000, 200, 300)
    text_center(d, (420, 0, w - 420, h), txt, f, c1)
    d.rectangle((430, 14, w - 430, 24), fill=c1); d.rectangle((430, h - 24, w - 430, h - 14), fill=c1)
    im = ImageChops.add(im, glow(layer, 7))
    save(im, name, "banner", c1)

# ---------- 隧道入口牌 ----------
w, h = 1536, 192
im = Image.new("RGB", (w, h), (5, 5, 8))
layer = Image.new("RGB", (w, h), (0, 0, 0))
d = ImageDraw.Draw(layer)
f = fit_font(F("ZCOOLQingKeHuangYou-Regular.ttf"), "滨江隧道  RIVERSIDE TUNNEL", w - 120, 120, 200)
text_center(d, (0, 0, w, h), "滨江隧道  RIVERSIDE TUNNEL", f, ORANGE)
im = ImageChops.add(im, glow(layer, 6))
save(im, "tunnel_name", "banner", ORANGE)

json.dump(manifest, open(os.path.join(OUT, "manifest.json"), "w"), ensure_ascii=False, indent=1)
print("signs:", len(manifest))

# 拼一张总览图方便检查
thumbs = []
for m in manifest:
    im = Image.open(os.path.join(OUT, m["file"]))
    im.thumbnail((200, 200))
    thumbs.append(im)
cols = 10
sheet = Image.new("RGB", (cols * 204, (len(thumbs) // cols + 1) * 204), (30, 30, 30))
for i, t in enumerate(thumbs):
    sheet.paste(t, ((i % cols) * 204 + 2, (i // cols) * 204 + 2))
sheet.save(os.path.join(OUT, "_sheet.jpg"), quality=85)
