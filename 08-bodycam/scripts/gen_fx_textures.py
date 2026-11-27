"""用 numpy 程序化生成特效贴图：烟尘团、枪口火光（正面星形/侧面喷焰）、弹孔。
运行：.venv/bin/python scripts/gen_fx_textures.py
"""
import os, numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter, map_coordinates

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "fx"); os.makedirs(OUT, exist_ok=True)
N = 512


def fbm(rng, n=N, octaves=5, base=64.0, persistence=0.55):
    out = np.zeros((n, n), np.float32); amp = 1.0; tot = 0.0; s = base
    for _ in range(octaves):
        g = gaussian_filter(rng.standard_normal((n, n)).astype(np.float32), s, mode="wrap")
        g = (g - g.mean()) / (g.std() + 1e-6)
        out += g * amp; tot += amp; amp *= persistence; s = max(1.0, s / 2)
    out /= tot
    return out


def grid(n=N):
    y, x = np.mgrid[0:n, 0:n].astype(np.float32)
    return (x / (n - 1) - 0.5) * 2, (y / (n - 1) - 0.5) * 2


def save(name, rgb, a):
    im = np.dstack([np.clip(rgb, 0, 1), np.clip(a, 0, 1)[..., None]])
    Image.fromarray((im * 255 + 0.5).astype(np.uint8), "RGBA").save(os.path.join(OUT, name))


def puff(seed):
    rng = np.random.default_rng(seed)
    x, y = grid()
    # 用噪声扭曲半径，让边缘不规则
    w1, w2 = fbm(rng, base=48), fbm(rng, base=24)
    r = np.sqrt((x + 0.22 * w1) ** 2 + (y + 0.22 * w2) ** 2)
    body = np.clip(1.0 - r / 0.86, 0, 1) ** 1.25
    dens = fbm(rng, base=40, octaves=6)
    dens = np.clip(0.62 + 0.42 * dens, 0, 1)
    wisps = np.clip(0.5 + 0.55 * fbm(rng, base=12, octaves=4), 0, 1)
    a = body * dens * (0.72 + 0.28 * wisps)
    a = gaussian_filter(a, 1.2)
    shade = 0.86 + 0.14 * np.clip(0.5 + 0.6 * fbm(rng, base=30), 0, 1)
    rgb = np.dstack([shade, shade, shade])
    save(f"puff_{seed}.png", rgb, a / max(a.max(), 1e-6))


def flash_star(seed):
    rng = np.random.default_rng(100 + seed)
    x, y = grid()
    r = np.sqrt(x * x + y * y) + 1e-6
    th = np.arctan2(y, x)
    # 角向亮度：若干主瓣 + 噪声
    ang = np.zeros_like(r)
    k = rng.integers(4, 7)
    for i in range(k):
        t0 = rng.uniform(-np.pi, np.pi); wdt = rng.uniform(0.10, 0.28); amp = rng.uniform(0.55, 1.0)
        d = np.angle(np.exp(1j * (th - t0)))
        ang += amp * np.exp(-(d / wdt) ** 2)
    nz = fbm(rng, base=10, octaves=4)
    ang = np.clip(ang + 0.18 + 0.25 * nz, 0, 1.6)
    reach = 0.22 + 0.70 * np.clip(ang, 0, 1)           # 各方向喷多远
    lobes = np.clip(1.0 - r / reach, 0, 1) ** 1.6
    core = np.exp(-(r / 0.16) ** 2) * 1.2
    turb = np.clip(0.75 + 0.45 * fbm(rng, base=6, octaves=3), 0.2, 1.3)
    inten = np.clip((lobes * turb + core), 0, 1.5)
    inten = gaussian_filter(inten, 1.0)
    inten /= inten.max()
    # 颜色：核心白黄，外缘橙红
    t = np.clip(inten, 0, 1)
    rgb = np.dstack([np.ones_like(t), 0.42 + 0.56 * t ** 0.8, 0.10 + 0.78 * t ** 1.8])
    save(f"flash_star_{seed}.png", rgb, np.clip(inten * 1.25, 0, 1) ** 0.85)


def flash_side(seed):
    rng = np.random.default_rng(200 + seed)
    x, y = grid()
    u = (x + 1) / 2          # 0=枪口, 1=前端
    env = np.clip(np.sin(np.pi * np.clip(u, 0, 1) ** 0.55), 0, 1) * (1 - u) ** 0.35
    wob = 0.10 * fbm(rng, base=20, octaves=4)
    wdt = 0.52 * env + 0.04
    a = np.clip(1.0 - np.abs(y + wob) / wdt, 0, 1) ** 1.3
    a *= np.clip(u / 0.04, 0, 1)
    a *= np.clip(0.7 + 0.5 * fbm(rng, base=8, octaves=4), 0.15, 1.3)
    a = gaussian_filter(a, 1.0); a /= a.max()
    t = np.clip(a, 0, 1)
    rgb = np.dstack([np.ones_like(t), 0.42 + 0.56 * t ** 0.8, 0.10 + 0.78 * t ** 1.8])
    save(f"flash_side_{seed}.png", rgb, np.clip(a * 1.2, 0, 1) ** 0.9)


def hole(seed):
    rng = np.random.default_rng(300 + seed)
    n = 256
    y, x = np.mgrid[0:n, 0:n].astype(np.float32)
    x = (x / (n - 1) - 0.5) * 2; y = (y / (n - 1) - 0.5) * 2
    w = fbm(rng, n=n, base=14, octaves=4)
    r = np.sqrt(x * x + y * y) * (1 + 0.30 * w)
    crater = np.clip(1 - r / 0.80, 0, 1)                 # 崩掉的灰皮范围
    a = np.clip(crater * 4.0, 0, 1)
    core = np.clip(1 - r / 0.20, 0, 1) ** 0.6            # 弹孔本体
    plaster = 0.80 + 0.12 * fbm(rng, n=n, base=6, octaves=3)
    val = plaster * (1 - 0.55 * np.clip(1 - r / 0.45, 0, 1) ** 2)
    val = val * (1 - core) + 0.03 * core
    rgb = np.dstack([val, val * 0.97, val * 0.93])
    save(f"hole_{seed}.png", rgb, a)


for s in range(8):
    puff(s)
for s in range(8):
    flash_star(s)
for s in range(4):
    flash_side(s)
for s in range(4):
    hole(s)

# 预览拼图（黑底合成）
names = [f"puff_{i}.png" for i in range(4)] + [f"flash_star_{i}.png" for i in range(4)] + [f"flash_side_{i}.png" for i in range(4)] + [f"hole_{i}.png" for i in range(4)]
sheet = Image.new("RGB", (4 * 256, 4 * 256), (60, 70, 80))
for i, nme in enumerate(names):
    im = Image.open(os.path.join(OUT, nme)).resize((256, 256))
    bg = Image.new("RGB", (256, 256), (25, 28, 32) if "flash" in nme else (90, 100, 110))
    bg.paste(im, (0, 0), im)
    sheet.paste(bg, ((i % 4) * 256, (i // 4) * 256))
sheet.save(os.path.join(OUT, "_sheet.jpg"), quality=90)
print("fx textures done")
