"""Post FX (camera realism) + original FPS-style HUD, piped straight into ffmpeg.
usage: python composite.py FRAMES_DIR EVENTS_JSON OUT_MP4 [--audio WAV] [--nohud] [--frames a-b] [--still N OUT.png]
"""
import sys, os, json, math, subprocess, argparse, glob
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ap = argparse.ArgumentParser()
ap.add_argument("frames"); ap.add_argument("events"); ap.add_argument("out")
ap.add_argument("--audio"); ap.add_argument("--nohud", action="store_true")
ap.add_argument("--range", default=None); ap.add_argument("--still", nargs=2, default=None)
ap.add_argument("--crf", default="15")
A = ap.parse_args()

W, H = 1920, 1080
EV = json.load(open(A.events))
FR = {int(k): v for k, v in EV["frame"].items()}
NF = EV["frames"]

F_DIN = "/System/Library/Fonts/Supplemental/DIN Alternate Bold.ttf"
F_DINC = "/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf"
F_CN = "/System/Library/Fonts/Hiragino Sans GB.ttc"


def font(path, size, idx=0):
    try:
        return ImageFont.truetype(path, size, index=idx)
    except Exception:
        return ImageFont.truetype("/Library/Fonts/Arial Unicode.ttf", size)


FN = {k: font(F_DIN, s) for k, s in (("xs", 18), ("s", 22), ("m", 28), ("l", 40), ("xl", 64), ("xxl", 84))}
FC = {k: font(F_CN, s, 1) for k, s in (("xs", 18), ("s", 22), ("m", 28), ("l", 36))}

KILLS = sorted(EV["kills"], key=lambda k: k["f"])
HITS = sorted(EV["hits"], key=lambda k: k["f"])
ESHOTS = [e["f"] for e in EV["enemy_shots"]]
PSHOTS = [s["f"] for s in EV["shots"]]
NAMES = {"E1": "Viper_77", "E2": "Kodiak", "E3": "RAVEN.k", "E4": "Ghost_09"}
SPOT = {"E1": (95, 136), "E2": (205, 240), "E3": (300, 341), "E4": (440, 462)}
WHITE = (240, 240, 236)


def smooth(t):
    t = max(0.0, min(1.0, t)); return t * t * (3 - 2 * t)


# ------------------------------------------------------------------ post fx
def post(img, f):
    """img float32 RGB 0..1 (H,W,3)."""
    h, w = img.shape[:2]
    # bloom
    lum = img.max(axis=2)
    m = np.clip((lum - 0.78) / 0.22, 0, 1)[..., None] * img
    small = cv2.resize(m, (w // 4, h // 4), interpolation=cv2.INTER_AREA)
    b1 = cv2.GaussianBlur(small, (0, 0), 3)
    b2 = cv2.GaussianBlur(small, (0, 0), 12)
    bloom = cv2.resize(b1 * 0.35 + b2 * 0.3, (w, h), interpolation=cv2.INTER_LINEAR)
    img = img + bloom
    # chromatic aberration (radial)
    def scale_ch(ch, s):
        M = np.float32([[s, 0, (1 - s) * w / 2], [0, s, (1 - s) * h / 2]])
        return cv2.warpAffine(ch, M, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    img = np.dstack([scale_ch(img[..., 0], 1.0012), img[..., 1], scale_ch(img[..., 2], 0.9988)])
    # sharpen (counter denoiser softness)
    bl = cv2.GaussianBlur(img, (0, 0), 1.1)
    img = img + (img - bl) * 0.45
    # grade: gentle S-curve + slight cool shadows / warm highs
    img = np.clip(img, 0, 1.2)
    x = np.clip(img, 0, 1)
    s = x * x * (3 - 2 * x)
    img = img * 0.8 + s * 0.2
    lumv = img.mean(axis=2, keepdims=True)
    img = img + (0.5 - lumv) * np.array([-0.012, 0.0, 0.018], np.float32) * 0.6
    # vignette
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    r2 = ((xx - w / 2) / (w / 2)) ** 2 + ((yy - h / 2) / (h / 2)) ** 2
    img = img * (1 - 0.16 * r2)[..., None]
    # grain (luma + a bit of chroma)
    rng = np.random.default_rng(f * 7919)
    g = rng.normal(0, 0.011, (h // 1, w // 1, 1)).astype(np.float32)
    gc = rng.normal(0, 0.004, (h, w, 3)).astype(np.float32)
    img = img + g + gc
    return np.clip(img, 0, 1)


# ------------------------------------------------------------------ HUD geometry: mall map (world metres)
MAP_RECTS = [  # (x0,y0,x1,y1, kind)
    (-11, -12, 11, 62, "floor"),
    (-17, -12, -11, 62, "store"), (11, -12, 17, 62, "store"),
    (-1.7, 19.3, 1.7, 20.7, "obj"), (-2.2, 1.6, 2.2, 3.2, "obj"), (-1.7, 36, 1.7, 44.7, "esc"),
]
UNIT_B = [-12, -3, 6, 15, 24, 33, 42, 51, 62]
COLS = [(s * 5.15, y) for s in (-1, 1) for y in (0, 9, 18, 27, 36, 45, 54)]


def minimap(d, fr, f):
    cx, cy, R = 40 + 150, 40 + 150, 150
    sc = 4.2
    px, py = fr["x"], fr["y"]
    th = math.radians(fr["yaw"])
    fx, fy = math.cos(th), math.sin(th)
    rx, ry = math.sin(th), -math.cos(th)

    def tp(x, y):
        dx, dy = x - px, y - py
        u = dx * rx + dy * ry
        v = -(dx * fx + dy * fy)
        return cx + u * sc, cy + v * sc

    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    ld.ellipse((cx - R, cy - R, cx + R, cy + R), fill=(10, 12, 14, 150))
    for x0, y0, x1, y1, kind in MAP_RECTS:
        pts = [tp(x0, y0), tp(x1, y0), tp(x1, y1), tp(x0, y1)]
        col = {"floor": (120, 130, 135, 90), "store": (60, 66, 70, 160), "obj": (170, 176, 180, 140), "esc": (90, 96, 100, 170)}[kind]
        ld.polygon(pts, fill=col)
    for s in (-1, 1):
        for yb in UNIT_B:
            ld.line([tp(s * 11, yb), tp(s * 17, yb)], fill=(150, 156, 160, 140), width=2)
        ld.line([tp(s * 11, -12), tp(s * 11, 62)], fill=(190, 196, 200, 170), width=2)
        ld.line([tp(s * 4.5, -12), tp(s * 4.5, 62)], fill=(150, 160, 165, 90), width=1)
    for (x, y) in COLS:
        a, b = tp(x, y); ld.ellipse((a - 2.5, b - 2.5, a + 2.5, b + 2.5), fill=(200, 205, 208, 150))
    # enemies (spotted)
    for name, e in fr["enemies"].items():
        s0, s1 = SPOT[name]
        if not (s0 <= f <= s1 + 45):
            continue
        al = smooth((f - s0) / 4) * (1 - smooth((f - s1 - 25) / 20))
        a, b = tp(e["x"], e["y"])
        if (a - cx) ** 2 + (b - cy) ** 2 > (R - 8) ** 2:
            continue
        if e["alive"]:
            ld.ellipse((a - 6, b - 6, a + 6, b + 6), fill=(235, 40, 35, int(235 * al)), outline=(255, 160, 150, int(200 * al)))
        else:
            ld.line([(a - 6, b - 6), (a + 6, b + 6)], fill=(235, 60, 50, int(220 * al)), width=3)
            ld.line([(a - 6, b + 6), (a + 6, b - 6)], fill=(235, 60, 50, int(220 * al)), width=3)
    # view cone + player arrow
    cone = [(cx, cy), (cx - 70, cy - 120), (cx + 70, cy - 120)]
    ld.polygon(cone, fill=(255, 255, 255, 22))
    ld.polygon([(cx, cy - 11), (cx - 8, cy + 8), (cx, cy + 4), (cx + 8, cy + 8)], fill=(255, 214, 90, 255))
    mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(mask).ellipse((cx - R, cy - R, cx + R, cy + R), fill=255)
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    out.paste(layer, (0, 0), mask)
    od = ImageDraw.Draw(out)
    od.ellipse((cx - R, cy - R, cx + R, cy + R), outline=(230, 232, 228, 120), width=2)
    # north marker on ring
    bearing = math.radians(90 - fr["yaw"])  # world +Y is north
    nx, ny = cx - math.sin(bearing) * (R - 2), cy - math.cos(bearing) * (R - 2)
    nx, ny = cx + math.sin(-bearing) * (R - 2), cy - math.cos(-bearing) * (R - 2)
    od.ellipse((nx - 11, ny - 11, nx + 11, ny + 11), fill=(20, 22, 24, 220))
    od.text((nx, ny), "N", font=FN["xs"], fill=WHITE, anchor="mm")
    return out


def compass(d, fr):
    cx, y, half = W // 2, 44, 330
    heading = (90 - fr["yaw"]) % 360
    d.rectangle((cx - half, y - 2, cx + half, y - 1), fill=(255, 255, 255, 60))
    labels = {0: "N", 45: "NE", 90: "E", 135: "SE", 180: "S", 225: "SW", 270: "W", 315: "NW"}
    ppd = 6.0
    for deg in range(0, 360, 5):
        diff = (deg - heading + 540) % 360 - 180
        x = cx + diff * ppd
        if abs(diff) * ppd > half:
            continue
        al = int(255 * (1 - (abs(diff) * ppd / half) ** 3))
        if deg % 45 == 0:
            d.text((x, y + 16), labels[deg], font=FN["m"], fill=(*WHITE, al), anchor="mm")
            d.line([(x, y), (x, y + 4)], fill=(255, 255, 255, al), width=2)
        elif deg % 15 == 0:
            d.text((x, y + 14), str(deg), font=FN["xs"], fill=(200, 200, 196, int(al * 0.8)), anchor="mm")
            d.line([(x, y), (x, y + 3)], fill=(255, 255, 255, int(al * 0.7)), width=1)
        else:
            d.line([(x, y), (x, y + 6)], fill=(255, 255, 255, int(al * 0.45)), width=1)
    d.polygon([(cx - 7, y - 10), (cx + 7, y - 10), (cx, y - 2)], fill=(255, 214, 90, 230))
    d.text((cx, y + 40), f"{int(round(heading)) % 360:03d}", font=FN["s"], fill=(*WHITE, 210), anchor="mm")


def scoreboard(d, f):
    x1, y = W - 40, 40
    kills_so_far = sum(1 for k in KILLS if k["f"] <= f)
    ours, theirs = 61 + kills_so_far, 58
    secs = max(0, 4 * 60 + 37 - f // 30)
    d.rounded_rectangle((x1 - 300, y, x1, y + 58), radius=6, fill=(12, 14, 16, 140))
    d.rectangle((x1 - 300, y, x1 - 296, y + 58), fill=(70, 170, 255, 230))
    d.text((x1 - 282, y + 29), f"{ours}", font=FN["l"], fill=(110, 190, 255, 255), anchor="lm")
    d.text((x1 - 150, y + 18), "团队死斗", font=FC["xs"], fill=(*WHITE, 220), anchor="mm")
    d.text((x1 - 150, y + 41), f"{secs // 60}:{secs % 60:02d}", font=FN["s"], fill=(*WHITE, 230), anchor="mm")
    d.text((x1 - 18, y + 29), f"{theirs}", font=FN["l"], fill=(255, 95, 85, 255), anchor="rm")
    # progress bars
    d.rectangle((x1 - 300, y + 62, x1 - 300 + int(300 * ours / 75), y + 66), fill=(110, 190, 255, 200))
    d.rectangle((x1 - 300, y + 70, x1 - 300 + int(300 * theirs / 75), y + 74), fill=(255, 95, 85, 200))


def killfeed(d, f):
    x1, y = W - 40, 130
    shown = [k for k in KILLS if k["f"] <= f < k["f"] + 150]
    for i, k in enumerate(reversed(shown)):
        age = f - k["f"]
        al = smooth(age / 5) * (1 - smooth((age - 130) / 20))
        yy = y + i * 38
        en = NAMES[k["enemy"]]
        wtxt = "▬╾"
        w_en = d.textlength(en, font=FN["s"])
        w_me = d.textlength("大师", font=FC["s"])
        total = w_me + w_en + 90
        x0 = x1 - total
        d.rounded_rectangle((x0 - 12, yy, x1, yy + 32), radius=4, fill=(10, 12, 14, int(150 * al)))
        d.text((x0, yy + 16), "大师", font=FC["s"], fill=(110, 190, 255, int(255 * al)), anchor="lm")
        gx = x0 + w_me + 14
        # small rifle glyph
        d.rectangle((gx, yy + 13, gx + 44, yy + 18), fill=(*WHITE, int(230 * al)))
        d.rectangle((gx + 14, yy + 18, gx + 19, yy + 26), fill=(*WHITE, int(230 * al)))
        d.rectangle((gx + 26, yy + 18, gx + 30, yy + 24), fill=(*WHITE, int(230 * al)))
        d.rectangle((gx - 6, yy + 12, gx, yy + 20), fill=(*WHITE, int(230 * al)))
        d.text((x1 - 8, yy + 16), en, font=FN["s"], fill=(255, 95, 85, int(255 * al)), anchor="rm")


def weapon_panel(d, fr, f):
    x1, y1 = W - 50, H - 50
    ammo = fr["ammo"]
    reserve = 90 if f < 545 else 60
    d.text((x1, y1 - 30), f"{ammo}", font=FN["xxl"], fill=(255, 210, 90, 255) if ammo <= 8 else (*WHITE, 255), anchor="rs")
    w_am = d.textlength(f"{ammo}", font=FN["xxl"])
    d.text((x1 - w_am - 12, y1 - 36), f"/ {reserve}", font=FN["m"], fill=(*WHITE, 200), anchor="rs")
    d.text((x1, y1 - 2), "AR-15 卡宾枪", font=FC["s"], fill=(*WHITE, 230), anchor="rs")
    d.text((x1 - 260, y1 - 2), "全自动", font=FC["xs"], fill=(200, 200, 196, 210), anchor="ls")
    # magazine bars
    for i in range(30):
        x = x1 - 4 - i * 7
        on = i < ammo
        d.rectangle((x - 4, y1 - 128, x, y1 - 112), fill=(*WHITE, 230) if on else (255, 255, 255, 50))
    # equipment
    for i in range(2):
        cx = x1 - 340 - i * 36
        d.ellipse((cx - 11, y1 - 40, cx + 11, y1 - 18), outline=(*WHITE, 220), width=3)
        d.rectangle((cx - 4, y1 - 46, cx + 4, y1 - 40), fill=(*WHITE, 220))


def health(d, f):
    x0, y1 = 50, H - 50
    d.text((x0, y1 - 44), "大师", font=FC["m"], fill=(*WHITE, 240), anchor="ls")
    d.rounded_rectangle((x0 + 80, y1 - 62, x0 + 128, y1 - 40), radius=4, fill=(255, 214, 90, 230))
    d.text((x0 + 104, y1 - 51), "LV 55", font=FN["xs"], fill=(20, 20, 20, 255), anchor="mm")
    hp = 100
    d.rectangle((x0, y1 - 26, x0 + 300, y1 - 16), fill=(255, 255, 255, 45))
    d.rectangle((x0, y1 - 26, x0 + int(300 * hp / 100), y1 - 16), fill=(*WHITE, 230))
    d.text((x0 + 312, y1 - 13), f"{hp}", font=FN["s"], fill=(*WHITE, 230), anchor="ls")


def crosshair(d, fr, f):
    a = fr["ads"]
    al = max(0.0, 1 - a * 2.2)
    if fr.get("reload", 0) > 0.05:
        al *= 0.5
    if al <= 0.01:
        return
    bloom = 0
    for s in PSHOTS:
        if 0 <= f - s < 10:
            bloom = max(bloom, 14 * math.exp(-(f - s) / 3))
    cx, cy = W // 2, H // 2
    g = 12 + bloom
    L = 14
    c = (*WHITE, int(230 * al))
    sh = (0, 0, 0, int(110 * al))
    for (dx, dy) in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        x0, y0 = cx + dx * g, cy + dy * g
        x1, y1 = cx + dx * (g + L), cy + dy * (g + L)
        d.line([(x0 + 1, y0 + 1), (x1 + 1, y1 + 1)], fill=sh, width=3)
        d.line([(x0, y0), (x1, y1)], fill=c, width=2)
    d.ellipse((cx - 2, cy - 2, cx + 2, cy + 2), fill=c)


def hitmarker(d, f):
    cx, cy = W // 2, H // 2
    for h in HITS:
        age = f - h["f"]
        if not (0 <= age < 9):
            continue
        kill = any(k["f"] == h["f"] + 1 and k["enemy"] == h["enemy"] for k in KILLS) or \
            any(k["enemy"] == h["enemy"] and 0 <= k["f"] - h["f"] <= 2 for k in KILLS)
        al = 1 - smooth(age / 9)
        sz = (14 if not kill else 20) + age * 1.2
        col = (255, 60, 50, int(255 * al)) if kill else (*WHITE, int(255 * al))
        g = 8
        for sx, sy in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
            d.line([(cx + sx * g, cy + sy * g), (cx + sx * (g + sz), cy + sy * (g + sz))], fill=(0, 0, 0, int(120 * al)), width=5)
            d.line([(cx + sx * g, cy + sy * g), (cx + sx * (g + sz), cy + sy * (g + sz))], fill=col, width=3)


MEDALS = {1: ("击杀", ""), 2: ("双杀", "DOUBLE"), 3: ("三杀", "TRIPLE"), 4: ("四杀", "QUAD")}


def kill_popup(d, f):
    cx, cy = W // 2, int(H * 0.755)
    for i, k in enumerate(KILLS):
        age = f - k["f"]
        if not (0 <= age < 60):
            continue
        n = i + 1
        al = smooth(age / 4) * (1 - smooth((age - 45) / 15))
        pop = 1 + 0.35 * math.exp(-age / 3)
        pts = 100 + (n - 1) * 50
        d.text((cx, cy), f"+{pts}", font=font(F_DIN, int(48 * pop)), fill=(255, 214, 90, int(255 * al)), anchor="mm")
        zh, en = MEDALS[min(n, 4)]
        d.text((cx, cy + 46), zh + (f"  {en} KILL" if en else "  敌人已消灭"), font=FC["s"], fill=(*WHITE, int(235 * al)), anchor="mm")
        if n >= 2:
            r = 34 * pop
            hx, hy = cx - 150, cy + 16
            hexa = [(hx + r * math.cos(math.radians(60 * j + 30)), hy + r * math.sin(math.radians(60 * j + 30))) for j in range(6)]
            d.polygon(hexa, fill=(200, 40, 35, int(220 * al)), outline=(255, 214, 90, int(255 * al)))
            d.text((hx, hy), f"×{n}", font=FN["l"], fill=(255, 240, 220, int(255 * al)), anchor="mm")


def damage_indicator(layer, fr, f):
    """Red arc pointing toward E3 while it is shooting at us."""
    d = ImageDraw.Draw(layer)
    e = fr["enemies"]["E3"]
    best = None
    for s in ESHOTS:
        age = f - s - 1
        if 0 <= age < 30:
            best = age if best is None else min(best, age)
    if best is None:
        return
    al = 1 - smooth(best / 30)
    dx, dy = e["x"] - fr["x"], e["y"] - fr["y"]
    ang_world = math.degrees(math.atan2(dy, dx))
    rel = (ang_world - fr["yaw"] + 540) % 360 - 180  # + = left
    cx, cy, R = W // 2, H // 2, 190
    # PIL arc angles: 0 = +x (right), clockwise; screen up = -90
    centre = -90 - rel
    d.arc((cx - R, cy - R, cx + R, cy + R), centre - 22, centre + 22, fill=(230, 30, 25, int(200 * al)), width=10)
    # edge vignette in red
    sw, sh_ = W // 4, H // 4
    v = Image.new("L", (sw, sh_), 0)
    vd = ImageDraw.Draw(v)
    vd.rectangle((0, 0, sw, sh_), fill=int(70 * al))
    vd.ellipse((-sw * 0.08, -sh_ * 0.1, sw * 1.08, sh_ * 1.1), fill=0)
    v = v.filter(ImageFilter.GaussianBlur(6)).resize((W, H))
    red = Image.new("RGBA", (W, H), (140, 0, 0, 0))
    red.putalpha(v)
    layer.alpha_composite(red)


def reload_text(d, fr):
    if fr.get("reload", 0) > 0.1:
        al = min(1.0, fr["reload"] * 2)
        d.text((W // 2, H // 2 + 70), "装填中", font=FC["m"], fill=(*WHITE, int(230 * al)), anchor="mm")


def xp_bar(d, f):
    k = sum(1 for kk in KILLS if kk["f"] <= f)
    d.rectangle((0, H - 6, W, H), fill=(0, 0, 0, 90))
    d.rectangle((0, H - 6, int(W * (0.42 + 0.04 * k)), H), fill=(255, 214, 90, 200))


ENEMY_Z = {"E1": 0.0, "E2": 5.0, "E3": 0.0, "E4": 0.0}
HEAD_DZ = {"E1": 0.38, "E2": 0.38, "E3": 0.4, "E4": 0.38}
CHEST = {"E1": 1.3, "E2": 1.3, "E3": 0.95, "E4": 1.3}


def project(fr, px, py, pz):
    yaw, pitch = math.radians(fr["yaw"]), math.radians(fr["pitch"])
    fwd = (math.cos(pitch) * math.cos(yaw), math.cos(pitch) * math.sin(yaw), math.sin(pitch))
    right = (math.sin(yaw), -math.cos(yaw), 0.0)
    up = (right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0])
    d = (px - fr["x"], py - fr["y"], pz - 1.66)
    z = sum(a * b for a, b in zip(d, fwd))
    if z <= 0.3:
        return None
    lens = 18.0 + (34.0 - 18.0) * fr["ads"]
    k = lens / 36.0 * W
    sx = W / 2 + sum(a * b for a, b in zip(d, right)) / z * k
    sy = H / 2 - sum(a * b for a, b in zip(d, up)) / z * k
    return sx, sy, z


def nametags(d, fr, f):
    for name, e in fr["enemies"].items():
        if not e["active"] or not e["alive"]:
            continue
        hz = ENEMY_Z[name] + CHEST[name] + HEAD_DZ[name]
        pr = project(fr, e["x"], e["y"], hz)
        if pr is None:
            continue
        sx, sy, z = pr
        cpr = project(fr, e["x"], e["y"], ENEMY_Z[name] + CHEST[name])
        if cpr is None:
            continue
        off = math.hypot(cpr[0] - W / 2, cpr[1] - H / 2)
        if off > 140:
            continue
        al = 1 - smooth((off - 60) / 80)
        y = sy - 18
        tw = d.textlength(NAMES[name], font=FN["s"])
        d.polygon([(sx - tw / 2 - 16, y), (sx - tw / 2 - 10, y - 6), (sx - tw / 2 - 4, y), (sx - tw / 2 - 10, y + 6)],
                  fill=(255, 60, 50, int(240 * al)))
        d.text((sx + 4, y), NAMES[name], font=FN["s"], fill=(255, 70, 60, int(250 * al)), anchor="mm")


def hud(f):
    fr = FR[f]
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    damage_indicator(layer, fr, f)
    layer.alpha_composite(minimap(None, fr, f))
    d = ImageDraw.Draw(layer)
    compass(d, fr)
    scoreboard(d, f)
    killfeed(d, f)
    weapon_panel(d, fr, f)
    health(d, f)
    nametags(d, fr, f)
    crosshair(d, fr, f)
    hitmarker(d, f)
    kill_popup(d, f)
    reload_text(d, fr)
    xp_bar(d, f)
    return layer


# ------------------------------------------------------------------ main
def load(f):
    for ext in ("png", "jpg"):
        p = os.path.join(A.frames, f"f_{f:04d}.{ext}")
        if os.path.exists(p):
            im = cv2.imread(p, cv2.IMREAD_COLOR)[..., ::-1]
            if im.shape[1] != W:
                im = cv2.resize(im, (W, H), interpolation=cv2.INTER_CUBIC)
            return im.astype(np.float32) / 255.0
    return None


def frame_rgb(f):
    img = load(f)
    if img is None:
        return None
    img = post(img, f)
    out = Image.fromarray((img * 255 + 0.5).astype(np.uint8), "RGB")
    if not A.nohud:
        h = hud(f)
        # soft drop shadow for legibility
        sh = h.split()[3].filter(ImageFilter.GaussianBlur(2)).point(lambda v: int(v * 0.45))
        shadow = Image.new("RGBA", (W, H), (0, 0, 0, 0)); shadow.putalpha(sh)
        base = out.convert("RGBA")
        base.alpha_composite(shadow, (2, 2))
        base.alpha_composite(h)
        out = base.convert("RGB")
    return out


if A.still:
    n, path = int(A.still[0]), A.still[1]
    frame_rgb(n).save(path, quality=92)
    sys.exit()

f0, f1 = 1, NF
if A.range:
    f0, f1 = map(int, A.range.split("-"))
cmd = ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", "30", "-i", "-"]
if A.audio:
    cmd += ["-ss", f"{(f0 - 1) / 30:.4f}", "-i", A.audio, "-c:a", "aac", "-b:a", "256k", "-shortest"]
cmd += ["-c:v", "libx264", "-preset", "slow", "-crf", A.crf, "-pix_fmt", "yuv420p", "-movflags", "+faststart", A.out]
p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
last = None
for f in range(f0, f1 + 1):
    im = frame_rgb(f)
    if im is None:
        im = last
    if im is None:
        continue
    last = im
    p.stdin.write(im.tobytes())
    if f % 50 == 0:
        print("comp", f, flush=True)
p.stdin.close(); p.wait()
print("WROTE", A.out)
