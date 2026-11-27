#!/usr/bin/env python3
"""宣传片的平面部分：英雄立绘卡（逐帧，立绘匀速推近）、标题和字幕的透明叠层、落版。
用法: python3 tools/trailer/cards.py [phone]（只出手机外框）  输出到 docs/trailer/raw/cards/
只用本机字体（宋体 Songti SC、苹方 PingFang SC）和项目里的立绘、徽记。颜色只用 烬橙 #ff9a5a、米白 #f2ede0、潮青 #7fe9e4、金 #e8c66a。
"""
import os
import sys
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "docs/trailer/raw/cards")
os.makedirs(OUT, exist_ok=True)
W, H = 1920, 1080
SONG = "/System/Library/Fonts/Supplemental/Songti.ttc"
PING = "/System/Library/AssetsV2/com_apple_MobileAsset_Font8/86ba2c91f017a3749571a82f2c6d890ac7ffb2fb.asset/AssetData/PingFang.ttc"
EMBER, CREAM, TIDE, GOLD = (255, 154, 90), (242, 237, 224), (127, 233, 228), (232, 198, 106)
BG = (7, 9, 11)


def song(size, black=True):
    return ImageFont.truetype(SONG, size, index=0 if black else 1)


def ping(size, weight="Medium"):
    for i in range(30):
        try:
            f = ImageFont.truetype(PING, size, index=i)
        except OSError:
            break
        if f.getname() == ("PingFang SC", weight):
            return f
    return ImageFont.truetype(PING, size)


def spaced(draw, xy, text, font, fill, spacing=0.0, anchor="ls"):
    """逐字画，字距 = spacing × 字号。anchor 只管第一个字的基线；返回画完的宽度"""
    x, y = xy
    size = font.size
    total = sum(draw.textlength(c, font=font) for c in text) + spacing * size * (len(text) - 1)
    if anchor[0] == "m":
        x -= total / 2
    elif anchor[0] == "r":
        x -= total
    for c in text:
        draw.text((x, y), c, font=font, fill=fill, anchor="l" + anchor[1])
        x += draw.textlength(c, font=font) + spacing * size
    return total


def shadowed(layer_fn, blur=18, alpha=150):
    """先画一层模糊的黑影再画字：字压在游戏画面上也看得清，不用描边"""
    txt = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    layer_fn(ImageDraw.Draw(txt))
    a = txt.split()[3]
    sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sh.putalpha(a.point(lambda v: v * alpha // 255).filter(ImageFilter.GaussianBlur(blur)))
    return Image.alpha_composite(sh, txt)


# ---------- 英雄立绘卡 ----------
HEROES = [
    ("lan", "岚", "汐刃", "刺客", 0), ("torg", "托尔格", "沉钟", "斗士", 0), ("moko", "摩珂", "引潮人", "辅助", 0),
    ("gorran", "葛隆", "砧卫", "坦克", 1), ("vero", "薇萝", "烬弩", "射手", 1), ("osen", "奥森", "烛语者", "法师", 1),
]
FRAMES = 42          # 1.4 秒，剪的时候再截
ZOOM = 0.035         # 这段时间里立绘匀速放大 3.5%


def hero_card(hid, name, title, role, side, idx):
    col = TIDE if side == 0 else EMBER
    sp = Image.open(os.path.join(ROOT, f"public/assets/ui/splash/{hid}.webp")).convert("RGB")
    # 背景：同一张立绘放大、糊掉、压暗，铺满整屏，和立绘本身的底色接得上
    bgw = W
    bg = sp.resize((bgw, int(sp.height * bgw / sp.width)), Image.LANCZOS).crop((0, 300, W, 300 + H)).filter(ImageFilter.GaussianBlur(40))
    bg = Image.blend(Image.new("RGB", (W, H), BG), bg, 0.22)
    # 立绘放在右半边，高度 1080 再留一点推近的余量；左右两边羽化进背景
    sh = H + 40
    swid = int(sp.width * sh / sp.height)
    big = sp.resize((swid * 2, sh * 2), Image.LANCZOS)        # 两倍大的底图，逐帧缩放时有亚像素精度
    mask = Image.new("L", (swid, sh), 255)
    md = ImageDraw.Draw(mask)
    feather = 270
    for i in range(feather):
        v = int(255 * (i / feather) ** 1.6)
        md.line([(i, 0), (i, sh)], fill=v)
        md.line([(swid - 1 - i, 0), (swid - 1 - i, sh)], fill=v)
    bm = Image.new("L", (swid, sh), 255)
    bd = ImageDraw.Draw(bm)
    for i in range(240):
        bd.line([(0, sh - 1 - i), (swid, sh - 1 - i)], fill=int(255 * (i / 240) ** 1.5))
    mask = ImageChops.multiply(mask, bm)
    cx = 1250
    # 字（静止）
    def text(d):
        y0 = 470
        spaced(d, (250, y0), ("沉月会" if side == 0 else "烬誓庭") + " · " + role, ping(30), col + (255,), 0.32)
        d.line([(252, y0 + 30), (252 + 64, y0 + 30)], fill=col + (200,), width=2)
        spaced(d, (244, y0 + 205), name, song(170), CREAM + (255,), 0.08)
        spaced(d, (252, y0 + 300), title, song(64, black=False), col + (255,), 0.25)
    txt = shadowed(text, 22, 170)
    d = os.path.join(OUT, f"hero_{idx}_{hid}")
    os.makedirs(d, exist_ok=True)
    for f in range(FRAMES):
        k = 1 + ZOOM * f / (FRAMES - 1)
        fw, fh = swid * k, sh * k
        frame = bg.copy()
        ox, oy = cx - fw / 2, H - fh + 30 * k        # 立绘脚底贴着画面下沿，往中间推近
        # 两倍底图按 k 缩放，用仿射变换做亚像素的缩放（不会一跳一跳）；粘贴要整数位置，小数部分放进仿射里
        ix, iy = int(ox // 1), int(oy // 1)
        fx, fy = ox - ix, oy - iy
        im = big.transform((int(fw) + 2, int(fh) + 2), Image.AFFINE, (2 / k, 0, -fx * 2 / k, 0, 2 / k, -fy * 2 / k), resample=Image.BICUBIC)
        mk = mask.transform((int(fw) + 2, int(fh) + 2), Image.AFFINE, (1 / k, 0, -fx / k, 0, 1 / k, -fy / k), resample=Image.BILINEAR)
        frame.paste(im, (ix, iy), mk)
        # 左边压暗一点给字让位
        frame = Image.alpha_composite(frame.convert("RGBA"), LEFT_SHADE)
        frame = Image.alpha_composite(frame, txt).convert("RGB")
        frame.save(os.path.join(d, f"{f:03d}.png"))


def left_shade():
    g = Image.new("L", (W, 1))
    for x in range(W):
        g.putpixel((x, 0), int(170 * max(0, 1 - x / 1100) ** 1.5))
    a = g.resize((W, H))
    s = Image.new("RGBA", (W, H), BG + (0,))
    s.putalpha(a)
    return s


LEFT_SHADE = left_shade()


# ---------- 透明叠层：标题、字幕、落版 ----------
def save_overlay(name, fn, blur=24, alpha=170):
    shadowed(fn, blur, alpha).save(os.path.join(OUT, name + ".png"))


def title_chars(d, cx, base, size, spacing=0.16):
    f = song(size)
    chars = [("烬", EMBER), ("与", CREAM), ("潮", TIDE)]
    widths = [d.textlength(c, font=f) for c, _ in chars]
    total = sum(widths) + spacing * size * 2
    x = cx - total / 2
    for (c, col), wdt in zip(chars, widths):
        d.text((x, base), c, font=f, fill=col + (255,), anchor="ls")
        x += wdt + spacing * size


def caption(name, text, col, x=None, y=972, size=40, spacing=0.3, anchor="ls", rule=True):
    def fn(d):
        xx = 140 if x is None else x
        wdt = spaced(d, (xx, y), text, ping(size), col + (255,), spacing, anchor)
        if rule:
            lx = xx if anchor[0] == "l" else xx - wdt / 2
            d.line([(lx, y + 22), (lx + 56, y + 22)], fill=GOLD + (230,), width=2)
    save_overlay(name, fn, 20, 160)


def lower_third(name, who, what, col):
    """技能镜头的小字：英雄名（宋体）+ 技能名（苹方），左下角"""
    def fn(d):
        w1 = spaced(d, (140, 975), who, song(50), CREAM + (255,), 0.1)
        d.line([(140 + w1 + 26, 945), (140 + w1 + 26, 985)], fill=GOLD + (220,), width=2)
        spaced(d, (140 + w1 + 52, 973), what, ping(34), col + (255,), 0.24)
    save_overlay(name, fn, 18, 165)


if __name__ == "__main__" and "phone" not in sys.argv[1:]:
    for i, h in enumerate(HEROES):
        hero_card(*h, i)
        print("立绘卡", h[0])
    # 片头标题：只有三个字
    save_overlay("title", lambda d: title_chars(d, W / 2, 610, 230), 40, 200)
    # 落版：标题 + 副标题
    def end(d):
        title_chars(d, W / 2, 560, 200)
        spaced(d, (W / 2, 690), "三对三 · 三条线 · 一条河", ping(38), CREAM + (235,), 0.42, "ms")
    save_overlay("end", end, 40, 200)
    caption("cap_tide", "沉月会", TIDE)
    caption("cap_ember", "烬誓庭", EMBER)
    caption("cap_heroes", "六位英雄", GOLD)
    caption("cap_beast", "岩甲巨兽", GOLD)
    caption("cap_troll", "岩石巨魔", GOLD)
    caption("cap_mobile", "手机横屏，也能玩", CREAM, x=W / 2, y=1000, size=44, anchor="ms", rule=False)
    for hid, who, what, col in [("lan", "岚", "涨潮", TIDE), ("torg", "托尔格", "沉没", TIDE), ("moko", "摩珂", "月潮", TIDE),
                                ("gorran", "葛隆", "开闸", EMBER), ("vero", "薇萝", "火油罐", EMBER), ("osen", "奥森", "千烛祷", EMBER)]:
        lower_third("lt_" + hid, who, what, col)
    print("叠层好了", OUT)


# ---------- 手机外框（透明屏幕区，盖在录好的手机画面上） ----------
PHONE_SCREEN = (1500, 694)          # 手机画面（844×390 两倍录）缩到这个大小放进屏幕
def phone_frame():
    sw, sh = PHONE_SCREEN
    bez, r = 26, 96
    fw, fh = sw + bez * 2, sh + bez * 2
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    x0, y0 = (W - fw) // 2, 120
    # 阴影
    sh_l = Image.new("L", (W, H), 0)
    ImageDraw.Draw(sh_l).rounded_rectangle([x0 + 10, y0 + 30, x0 + fw - 10, y0 + fh + 30], r, fill=200)
    shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    shadow.putalpha(sh_l.filter(ImageFilter.GaussianBlur(40)))
    im = Image.alpha_composite(im, shadow)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([x0, y0, x0 + fw, y0 + fh], r, fill=(22, 24, 27, 255), outline=(70, 74, 78, 255), width=3)
    d.rounded_rectangle([x0 + 6, y0 + 6, x0 + fw - 6, y0 + fh - 6], r - 6, outline=(40, 43, 47, 255), width=2)
    # 挖出屏幕（圆角）
    hole = Image.new("L", (W, H), 0)
    ImageDraw.Draw(hole).rounded_rectangle([x0 + bez, y0 + bez, x0 + bez + sw, y0 + bez + sh], r - bez + 6, fill=255)
    a = ImageChops.subtract(im.split()[3], hole)
    im.putalpha(a)
    # 侧面的灵动岛（横屏在左边）
    ImageDraw.Draw(im).rounded_rectangle([x0 + bez + 14, y0 + fh / 2 - 60, x0 + bez + 38, y0 + fh / 2 + 60], 12, fill=(0, 0, 0, 255))
    im.save(os.path.join(OUT, "phone.png"))
    hole.save(os.path.join(OUT, "phone_mask.png"))
    print("手机外框", x0 + bez, y0 + bez, sw, sh)


if __name__ == "__main__":
    phone_frame()
