"""量英雄身上几类颜色的中位数（w-vs：设定图 / 游戏里卡通版 / 游戏里现在 对照用；照 b-lan 的量法）。
用法: python3.14 art/style_b/vero/colors.py <颜色表 json> <图1> [图2 …]
颜色表：{"名字": [色相下限, 色相上限, 饱和度下限, 亮度(V)下限, 亮度上限], …}，色相 0–360（下限比上限大就是跨 0 度）。
图写成 路径 或 路径@x0,y0,x1,y1（只量这一块）。灰底（设定图）、草地（色相 70–160）自动排除，所以游戏截图用草地上的近镜头。
"""
import sys, json, colorsys
import numpy as np
from PIL import Image

tab = json.loads(sys.argv[1]) if sys.argv[1].lstrip().startswith("{") else json.load(open(sys.argv[1]))
for arg in sys.argv[2:]:
    path, _, box = arg.partition("@")
    im = Image.open(path).convert("RGB")
    if box: im = im.crop(tuple(int(v) for v in box.split(",")))
    a = np.asarray(im).reshape(-1, 3).astype(np.float32) / 255
    mx, mn = a.max(1), a.min(1); v = mx; s = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    r, g, b = a[:, 0], a[:, 1], a[:, 2]; d = np.maximum(mx - mn, 1e-6)
    h = np.where(mx == r, (g - b) / d % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) * 60
    keep = (s > 0.12) & ~((h > 70) & (h < 160))                      # 去掉灰底、草地
    out = []
    for name, (h0, h1, s0, v0, v1) in tab.items():
        hm = (h >= h0) & (h <= h1) if h0 <= h1 else (h >= h0) | (h <= h1)
        m = keep & hm & (s >= s0) & (v >= v0) & (v <= v1)
        if m.sum() < 30: out.append(f"{name} —"); continue
        c = np.median(a[m], 0) * 255; out.append(f"{name} ({c[0]:.0f},{c[1]:.0f},{c[2]:.0f}) n={m.sum()}")
    print(path.split("/")[-1] + (f"@{box}" if box else ""), " | ".join(out))
