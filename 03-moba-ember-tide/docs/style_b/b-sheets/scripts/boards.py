"""b-sheets 的两张总表：现在 / 卡通版并排（compare.jpg），缩到游戏大小站在 B 地面上（readability.jpg），外加亮度量数（measure.json）。"""
import sys, json, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cut import cutout, lum_stats
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import numpy as np

R = "/Users/jadon7/Documents/SynologyDrive/code/moba/"
C = R + "art/style_b/concept/"
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig/assets/ref/"
OUTD = R + "docs/style_b/b-sheets/"
cfg = json.load(open(sys.argv[1]))      # 用法：python3.14 boards.py boards_cfg.json（在主目录跑；读 art/style_b/concept 的图，写 compare.jpg、readability.jpg、measure.json）
FONT = "/System/Library/Fonts/Hiragino Sans GB.ttc"
f_big = ImageFont.truetype(FONT, 30); f_mid = ImageFont.truetype(FONT, 22); f_small = ImageFont.truetype(FONT, 17)
TMP = "/private/tmp/b-sheets-cut-cache/"; os.makedirs(TMP, exist_ok=True)      # 抠图缓存，几百 MB，用完可以删

def load_cut(path, half=None):
    key = TMP + path.replace("/", "_") + (half or "") + ".png"
    if os.path.exists(key): return Image.open(key)
    src = path
    if half:      # video2rig 的参考图是“正面 | 侧面”两格拼在一起的，只取一格
        im = Image.open(path).convert("RGB"); w = im.width // 2
        im = im.crop((0, 0, w, im.height) if half == "L" else (w, 0, im.width, im.height))
        src = TMP + "half_" + os.path.basename(path) + half + ".png"; im.save(src)
    c = cutout(src); c.save(key); return c

def fit(im, h, wmax):
    s = min(h / im.height, wmax / im.width); return im.resize((max(1, int(im.width * s)), max(1, int(im.height * s))), Image.LANCZOS)

# ---------- 1. 现在 / 卡通版 ----------
items = cfg["items"]
CH, CW = 440, 500          # 每张图的格子
cols = 3; pairw = CW * 2 + 40
rows = (len(items) + cols - 1) // cols
board = Image.new("RGB", (cols * pairw + 40, rows * (CH + 90) + 90), (128, 128, 130))
d = ImageDraw.Draw(board)
d.text((24, 22), "b-sheets · 路子一（王者式卡通厚涂）建模设定图：每格左边是现在的设定图，右边是卡通版", font=f_big, fill=(255, 255, 255))
meas = {}
for i, it in enumerate(items):
    x0 = 20 + (i % cols) * pairw; y0 = 80 + (i // cols) * (CH + 90)
    d.rounded_rectangle((x0, y0, x0 + pairw - 20, y0 + CH + 76), 10, fill=(150, 150, 152))
    d.text((x0 + 12, y0 + 8), it["label"], font=f_mid, fill=(20, 20, 20))
    for k, (p, half) in enumerate(((it["now"], it.get("now_half")), (it["new"], None))):
        c = load_cut(p, half); t = fit(c, CH - 20, CW - 20)
        cx = x0 + k * CW + (CW - t.width) // 2; cy = y0 + 44 + (CH - 20 - t.height)
        board.paste(t, (cx, cy), t)
        d.text((x0 + k * CW + 12, y0 + CH + 44), ("现在  " if k == 0 else "卡通版  ") + os.path.basename(p), font=f_small, fill=(30, 30, 30))
        meas.setdefault(it["id"], {})["now" if k == 0 else "new"] = {kk: round(v, 3) for kk, v in lum_stats(c).items()}
board.save(OUTD + "compare.jpg", quality=86)
print("compare", board.size)

# ---------- 2. 缩到游戏大小站在 B 地面上 ----------
PXM = 45.0                 # 1080p 的游戏镜头下英雄 3.3 米约 150 像素（b-concept 量的），每米约 45 像素
grounds = []
for g in cfg["grounds"]:
    im = Image.open(R + g["file"]).convert("RGB").crop(tuple(g["box"]))
    grounds.append((g["name"], im))
    a = np.asarray(im).astype(np.float32) / 255
    lin = np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4) @ np.array([0.2126, 0.7152, 0.0722])
    Ls = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * lin ** (1 / 2.4) - 0.055)
    meas.setdefault("_ground", {})[g["name"]] = {"p10": round(float(np.percentile(Ls, 10)), 3), "p50": round(float(np.percentile(Ls, 50)), 3), "p90": round(float(np.percentile(Ls, 90)), 3)}
roster = cfg["roster"]
H = 330; GAP = 26
def strip(gim, which):
    cuts = []
    for r in roster:
        p = r["new"] if which == "new" else r["now"]
        c = load_cut(p, None if which == "new" else r.get("now_half"))
        h = int(r["h"] * PXM); t = c.resize((max(1, int(c.width * h / c.height)), h), Image.LANCZOS); cuts.append(t)
    W = sum(t.width for t in cuts) + GAP * (len(cuts) + 1)
    bg = Image.new("RGB", (W, H))           # 地面块按原大小（不缩放，石板和草的尺度和游戏里一样）上下左右镜像平铺
    for iy, y in enumerate(range(0, H, gim.height)):
        for ix, x in enumerate(range(0, W, gim.width)):
            t = gim
            if ix % 2: t = t.transpose(Image.FLIP_LEFT_RIGHT)
            if iy % 2: t = t.transpose(Image.FLIP_TOP_BOTTOM)
            bg.paste(t, (x, y))
    bg = bg.convert("RGBA"); x = GAP
    for t in cuts:
        foot = H - 22
        sh = Image.new("RGBA", bg.size, (0, 0, 0, 0)); ImageDraw.Draw(sh).ellipse((x + t.width * 0.12, foot - 9, x + t.width * 0.88, foot + 9), fill=(20, 30, 20, 95))
        bg.alpha_composite(sh.filter(ImageFilter.GaussianBlur(4)))
        bg.alpha_composite(t, (x, foot - t.height + 4)); x += t.width + GAP
    return bg.convert("RGB")
rows_img = []
for name, gim in grounds:
    rows_img.append((name + " · 卡通版", strip(gim, "new")))
    rows_img.append((name + " · 现在的设定图（同样缩放，对照）", strip(gim, "now")))
W = max(im.width for _, im in rows_img) + 40
out = Image.new("RGB", (W, sum(im.height + 40 for _, im in rows_img) + 120), (40, 40, 42))
d = ImageDraw.Draw(out)
d.text((20, 16), "缩到游戏里的大小（1080p，每米约 45 像素，英雄 3.3 米约 150 像素）站在 B 的地面上。地面是 b-toon 改后的游戏截图。", font=f_mid, fill=(255, 255, 255))
d.text((20, 50), "顺序：" + "、".join(r["label"] for r in roster), font=f_small, fill=(220, 220, 220))
y = 90
for name, im in rows_img:
    d.text((20, y), name, font=f_mid, fill=(255, 230, 160)); out.paste(im, (20, y + 34)); y += im.height + 40
out.save(OUTD + "readability.jpg", quality=86)
print("readability", out.size)
json.dump(meas, open(OUTD + "measure.json", "w"), ensure_ascii=False, indent=1)
