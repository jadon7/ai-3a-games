# 生成 PWA 图标（assets/icons/）：python3 tools/make_icons.py
#   icon-192.png / icon-512.png     圆角方形，四角透明（浏览器标签、安卓「任意」用途）
#   icon-maskable-512.png           满版不透明，图形收在中间 80% 的安全区里（安卓自适应图标会裁成圆 / 圆角方）
#   apple-touch-icon.png (180)      满版不透明（iOS 自己加圆角）
import math, os
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'assets', 'icons')
FONT = '/System/Library/Fonts/Supplemental/DIN Alternate Bold.ttf'
S = 1024


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def background():
    # 和载入界面同一套底色：左上偏暖的径向渐变
    im = Image.new('RGB', (S, S)); px = im.load()
    cx, cy, R = S * 0.32, S * 0.36, S * 0.95
    for y in range(S):
        for x in range(S):
            t = min(1.0, math.hypot(x - cx, y - cy) / R)
            px[x, y] = lerp((44, 30, 20), (5, 5, 6), t ** 0.8)
    return im


def art(scale):
    """scale：图形相对画布的大小（满版图标 1.0，maskable 0.78）"""
    im = background().convert('RGBA')
    # 热风：几道向右上倾斜、两头渐隐的琥珀色气流
    wind = Image.new('RGBA', (S, S), (0, 0, 0, 0)); d = ImageDraw.Draw(wind)
    for i, (y, w, a, x0, x1) in enumerate([(0.30, 10, 150, 0.10, 0.86), (0.385, 5, 110, 0.02, 0.70), (0.47, 16, 200, 0.16, 0.96), (0.56, 6, 120, 0.06, 0.78), (0.645, 11, 170, 0.22, 0.92), (0.73, 4, 90, 0.12, 0.62)]):
        yy = S * (0.5 + (y - 0.5) * scale)
        for k in range(120):
            t0, t1 = k / 120, (k + 1) / 120; fade = math.sin(math.pi * (t0 + t1) / 2) ** 1.6
            xa = S * (0.5 + (x0 + (x1 - x0) * t0 - 0.5) * scale); xb = S * (0.5 + (x0 + (x1 - x0) * t1 - 0.5) * scale)
            d.line([(xa, yy - (xa - S / 2) * 0.16), (xb, yy - (xb - S / 2) * 0.16)], fill=(255, 179, 71, int(a * fade)), width=max(2, int(w * scale)))
    im.alpha_composite(wind.filter(ImageFilter.GaussianBlur(2.2)))
    # 字母 K：白 → 暖金的竖向渐变，和游戏标题同款
    font = ImageFont.truetype(FONT, int(S * 0.74 * scale))
    mask = Image.new('L', (S, S), 0); md = ImageDraw.Draw(mask)
    box = md.textbbox((0, 0), 'K', font=font); tw, th = box[2] - box[0], box[3] - box[1]
    ox, oy = (S - tw) / 2 - box[0] + S * 0.012 * scale, (S - th) / 2 - box[1] - S * 0.02 * scale
    md.text((ox, oy), 'K', font=font, fill=255)
    grad = Image.new('RGB', (S, S)); gp = grad.load(); top, bot = oy + box[1], oy + box[3]
    for y in range(S):
        t = min(1.0, max(0.0, (y - top) / max(1, bot - top))); c = lerp((255, 255, 255), (255, 200, 120), max(0.0, (t - 0.25) / 0.75))
        for x in range(S):
            gp[x, y] = c
    shadow = Image.new('RGBA', (S, S), (0, 0, 0, 0)); shadow.putalpha(mask.filter(ImageFilter.GaussianBlur(S * 0.02))); sh = Image.new('RGBA', (S, S), (0, 0, 0, 255)); sh.putalpha(ImageChops.offset(shadow.getchannel('A'), int(S * 0.012), int(S * 0.016)))
    im.alpha_composite(sh)
    glyph = grad.convert('RGBA'); glyph.putalpha(mask); im.alpha_composite(glyph)
    # 底部一道琥珀色短横 + 右上角青色小菱形（己方机甲在小地图上的标记）
    d = ImageDraw.Draw(im)
    bw, by = S * 0.30 * scale, S * (0.5 + 0.37 * scale)
    d.rectangle([S / 2 - bw / 2, by, S / 2 + bw / 2, by + S * 0.012 * scale], fill=(255, 179, 71, 255))
    cx, cy, r = S * (0.5 + 0.30 * scale), S * (0.5 - 0.30 * scale), S * 0.034 * scale
    d.polygon([(cx, cy - r), (cx + r, cy), (cx, cy + r), (cx - r, cy)], fill=(88, 224, 255, 255))
    return im


def rounded(im, radius):
    m = Image.new('L', im.size, 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, im.size[0] - 1, im.size[1] - 1], radius=radius, fill=255)
    out = im.copy(); out.putalpha(m); return out


os.makedirs(OUT, exist_ok=True)
full = art(1.0); safe = art(0.78)
rnd = rounded(full, int(S * 0.2))
rnd.resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, 'icon-512.png'), optimize=True)
rnd.resize((192, 192), Image.LANCZOS).save(os.path.join(OUT, 'icon-192.png'), optimize=True)
safe.convert('RGB').resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, 'icon-maskable-512.png'), optimize=True)
full.convert('RGB').resize((180, 180), Image.LANCZOS).save(os.path.join(OUT, 'apple-touch-icon.png'), optimize=True)
for f in sorted(os.listdir(OUT)):
    print(f, os.path.getsize(os.path.join(OUT, f)))
