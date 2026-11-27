"""iti-concept 的总表：两个方向并排（board.jpg）、和现在十个英雄放在一起（lineup.jpg）、海报一排（posters.jpg），外加亮度量数（measure.json）。
用法（在哪跑都行）：/opt/homebrew/opt/python@3.14/bin/python3.14 docs/hero_iti/concept/scripts/boards.py
抠图沿用 b-sheets 的 cut.py（从四边漫水抠灰底）；缓存写在 /private/tmp/iti-concept-cut-cache/，用完删。"""
import sys, os, json
R = "/Users/jadon7/Documents/SynologyDrive/code/moba/"
sys.path.insert(0, R + "docs/style_b/b-sheets/scripts")
from cut import cutout, lum_stats
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import numpy as np

C = R + "art/style_b/concept/"
I = R + "art/hero_iti/concept/"
OUTD = R + "docs/hero_iti/concept/"
FONT = "/System/Library/Fonts/Hiragino Sans GB.ttc"
f_big = ImageFont.truetype(FONT, 34); f_mid = ImageFont.truetype(FONT, 24); f_small = ImageFont.truetype(FONT, 18)
TMP = "/private/tmp/iti-concept-cut-cache/"; os.makedirs(TMP, exist_ok=True)
CFG = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "boards_cfg.json")))

def load_cut(path):
    key = TMP + path.replace("/", "_") + ".png"
    if os.path.exists(key) and os.path.getmtime(key) > os.path.getmtime(path): return Image.open(key)
    c = cutout(path); c.save(key); return c

def fit(im, w, h):
    s = min(w / im.width, h / im.height); return im.resize((max(1, int(im.width * s)), max(1, int(im.height * s))), Image.LANCZOS)

def ex(p): return p and os.path.exists(p)

dirs = CFG["dirs"]          # 两个方向：label、sheet、game、poster
meas = {}

# ---------- 1. 两个方向并排 ----------
COLW = 1320; PAD = 30
colh = 60 + 900 + 20 + int(COLW * 9 / 16) + 60
W = PAD + len(dirs) * (COLW + PAD) + 760 + PAD
board = Image.new("RGB", (W, colh + 110), (118, 118, 122)); d = ImageDraw.Draw(board)
d.text((PAD, 22), "伊缇 · 绯刃  第二阶段设定图：两个方向（左 A、中 B），右边是武器", font=f_big, fill=(255, 255, 255))
for k, dr in enumerate(dirs):
    x0 = PAD + k * (COLW + PAD); y0 = 90
    d.rounded_rectangle((x0, y0, x0 + COLW, y0 + colh), 12, fill=(140, 140, 144))
    d.text((x0 + 16, y0 + 12), dr["label"], font=f_mid, fill=(20, 20, 20))
    # 上排：建模图（抠出来放在灰底上）+ 海报
    cell_w = (COLW - 3 * 16) // 2
    if ex(dr.get("sheet")):
        sh = Image.open(dr["sheet"]).convert("RGB"); t = fit(sh, cell_w, 900)
        board.paste(t, (x0 + 16 + (cell_w - t.width) // 2, y0 + 56))
        meas.setdefault(dr["id"], {})["sheet"] = {kk: round(v, 3) for kk, v in lum_stats(load_cut(dr["sheet"])).items()}
    if ex(dr.get("poster")):
        po = Image.open(dr["poster"]).convert("RGB"); t = fit(po, cell_w, 900)
        board.paste(t, (x0 + 32 + cell_w + (cell_w - t.width) // 2, y0 + 56))
    # 下排：游戏镜头
    if ex(dr.get("game")):
        g = Image.open(dr["game"]).convert("RGB"); t = fit(g, COLW - 32, int((COLW - 32) * 9 / 16))
        board.paste(t, (x0 + 16, y0 + 56 + 900 + 20))
    d.text((x0 + 16, y0 + colh - 40), "  ·  ".join(os.path.basename(dr[k]) for k in ("sheet", "poster", "game") if ex(dr.get(k))), font=f_small, fill=(30, 30, 30))
xw = PAD + len(dirs) * (COLW + PAD)
d.rounded_rectangle((xw, 90, xw + 760, 90 + colh), 12, fill=(140, 140, 144))
d.text((xw + 16, 102), "武器：双持反握短刃（两个方向共用）", font=f_mid, fill=(20, 20, 20))
if ex(CFG.get("weapon")):
    t = fit(Image.open(CFG["weapon"]).convert("RGB"), 728, 728); board.paste(t, (xw + 16, 146))
    d.text((xw + 16, 146 + t.height + 10), os.path.basename(CFG["weapon"]), font=f_small, fill=(30, 30, 30))
y = 146 + 740 + 40
for line in CFG.get("notes", []):
    d.text((xw + 16, y), line, font=f_small, fill=(20, 20, 20)); y += 30
board.save(OUTD + "board.jpg", quality=88); print("board", board.size)

# ---------- 2. 和现在的十个英雄放在一起 ----------
roster = CFG["roster"] + [{"label": dr["short"], "h": dr["h"], "file": dr["sheet"], "new": True} for dr in dirs if ex(dr.get("sheet"))]
PXM = 110                   # 设定图并排：每米 110 像素（3.3 米的英雄约 360 像素）
cuts = []
for r in roster:
    c = load_cut(r["file"]); h = int(r["h"] * PXM); cuts.append((r, c.resize((max(1, int(c.width * h / c.height)), h), Image.LANCZOS)))
    meas.setdefault("_roster", {})[r["label"]] = {kk: round(v, 3) for kk, v in lum_stats(c).items()}
GAP = 30; maxh = max(t.height for _, t in cuts)
W1 = sum(t.width for _, t in cuts) + GAP * (len(cuts) + 1)
top = Image.new("RGB", (W1, maxh + 90), (128, 128, 132)); d = ImageDraw.Draw(top); x = GAP
for r, t in cuts:
    if r.get("new"): d.rounded_rectangle((x - 12, 8, x + t.width + 12, maxh + 80), 10, outline=(255, 214, 120), width=4)
    top.paste(t, (x, maxh + 30 - t.height), t)
    d.text((x, maxh + 44), r["label"], font=f_mid, fill=(255, 240, 200) if r.get("new") else (20, 20, 20)); x += t.width + GAP

# 缩到游戏大小（1080p，每米约 45 像素，b-sheets 的量法）站在 B 的三种地面上
PXG = 45.0; HG = 300
grounds = []
for g in CFG["grounds"]:
    im = Image.open(R + g["file"]).convert("RGB").crop(tuple(g["box"])); grounds.append((g["name"], im))
    a = np.asarray(im).astype(np.float32) / 255
    lin = np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4) @ np.array([0.2126, 0.7152, 0.0722])
    Ls = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * lin ** (1 / 2.4) - 0.055)
    meas.setdefault("_ground", {})[g["name"]] = {"p10": round(float(np.percentile(Ls, 10)), 3), "p50": round(float(np.percentile(Ls, 50)), 3), "p90": round(float(np.percentile(Ls, 90)), 3)}
def strip(gim):
    sm = []
    for r, _ in cuts:
        c = load_cut(r["file"]); h = int(r["h"] * PXG); sm.append((r, c.resize((max(1, int(c.width * h / c.height)), h), Image.LANCZOS)))
    Ws = sum(t.width for _, t in sm) + 26 * (len(sm) + 1)
    bg = Image.new("RGB", (Ws, HG))
    for iy, yy in enumerate(range(0, HG, gim.height)):
        for ix, xx in enumerate(range(0, Ws, gim.width)):
            t = gim
            if ix % 2: t = t.transpose(Image.FLIP_LEFT_RIGHT)
            if iy % 2: t = t.transpose(Image.FLIP_TOP_BOTTOM)
            bg.paste(t, (xx, yy))
    bg = bg.convert("RGBA"); xx = 26; x_new = None
    for r, t in sm:
        foot = HG - 22
        if r.get("new") and x_new is None: x_new = xx - 26          # 伊缇两张从这里开始，右边另放一份放大两倍的
        sh = Image.new("RGBA", bg.size, (0, 0, 0, 0)); ImageDraw.Draw(sh).ellipse((xx + t.width * 0.12, foot - 9, xx + t.width * 0.88, foot + 9), fill=(20, 30, 20, 95))
        bg.alpha_composite(sh.filter(ImageFilter.GaussianBlur(4))); bg.alpha_composite(t, (xx, foot - t.height + 4)); xx += t.width + 26
    bg = bg.convert("RGB")
    if x_new is not None:
        z = bg.crop((x_new, 0, bg.width, HG)); z = z.resize((z.width * 2, HG * 2), Image.LANCZOS).crop((0, HG // 2, z.width * 2, HG * 2))
        out = Image.new("RGB", (bg.width + 40 + z.width, max(HG, z.height)), (40, 40, 42)); out.paste(bg, (0, out.height - HG)); out.paste(z, (bg.width + 40, out.height - z.height))
        return out
    return bg
strips = [(n, strip(g)) for n, g in grounds]
W = max(top.width, max(s.width for _, s in strips)) + 40
H = 80 + top.height + 60 + sum(s.height + 44 for _, s in strips) + 20
out = Image.new("RGB", (W, H), (40, 40, 42)); d = ImageDraw.Draw(out)
d.text((20, 18), "和现在的十个英雄放在一起：上面是 B 的建模设定图按身高同比例并排（黄框是伊缇的两个方向）", font=f_mid, fill=(255, 255, 255))
out.paste(top, (20, 70)); y = 70 + top.height + 20
d.text((20, y), "下面三条：缩到游戏里的大小（1080p，每米约 45 像素，3.3 米约 150 像素）站在 B 的地面上（地面是 b-toon 改后的游戏截图），顺序同上；每条右边是伊缇两张再放大两倍", font=f_small, fill=(220, 220, 220)); y += 36
for n, s in strips:
    d.text((20, y), n, font=f_mid, fill=(255, 230, 160)); out.paste(s, (20, y + 34)); y += s.height + 44
out.save(OUTD + "lineup.jpg", quality=86); print("lineup", out.size)

# ---------- 3. 海报一排 ----------
ps = [(p["label"], R + p["file"], False) for p in CFG["posters"]] + [(dr["short"], dr["poster"], True) for dr in dirs if ex(dr.get("poster"))]
PW, PH = 330, 440
out = Image.new("RGB", (30 + len(ps) * (PW + 16), PH + 120), (14, 30, 70)); d = ImageDraw.Draw(out)
d.text((20, 16), "海报和现在十个英雄的 B 海报放在一起（游戏里的 public/assets/ui/splash，黄框是伊缇）", font=f_mid, fill=(255, 255, 255))
x = 20
for lab, p, new in ps:
    im = Image.open(p).convert("RGB"); s = max(PW / im.width, PH / im.height)
    im = im.resize((int(im.width * s + 0.5), int(im.height * s + 0.5)), Image.LANCZOS)
    im = im.crop(((im.width - PW) // 2, 0, (im.width - PW) // 2 + PW, PH))
    out.paste(im, (x, 64))
    if new: d.rectangle((x - 4, 60, x + PW + 3, 64 + PH + 3), outline=(255, 214, 120), width=4)
    d.text((x, 64 + PH + 12), lab, font=f_mid, fill=(255, 240, 200) if new else (220, 220, 230)); x += PW + 16
out.save(OUTD + "posters.jpg", quality=86); print("posters", out.size)
json.dump(meas, open(OUTD + "measure.json", "w"), ensure_ascii=False, indent=1)
