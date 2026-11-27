"""量一只野怪身上的颜色，和设定图比（STYLE.md 的量法：亮度是相对亮度按 gamma 2.2 换回 0–1，饱和度是 HSV 的 S）。
游戏截图：同一机位“有怪”和“没怪”两张相减，差得多的像素当作怪（只看画面中间一块，排除英雄和水面）；设定图：去掉纯灰底。
把怪的像素分成几类，每类给 RGB 中位数：绿（苔藓等，G 明显大于 R、B）、暖（R 明显大于 B：毛、皮、红鬃）、冷（B ≥ R：蓝灰的皮、甲）、亮（亮度 > 0.75：肚皮、獠牙、高光）。
用法: python3.14 mob_colors.py sheet <设定图.png>
      python3.14 mob_colors.py game <有怪.jpg> <没怪.jpg> [中间多大一块，占画面的比例=0.5]
"""
import sys, numpy as np
from PIL import Image

lin = lambda c: np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
Y = lambda c: (lin(c) @ np.array([0.2126, 0.7152, 0.0722])) ** (1 / 2.2)


def stats(px, tag):
    y = Y(px); mx = px.max(1); mn = px.min(1); s = (mx - mn) / (mx + 1e-6); r, g, b = px[:, 0], px[:, 1], px[:, 2]
    cls = {"绿": (g > r + 0.06) & (g > b + 0.04), "暖": (r > b + 0.06) & ~((g > r + 0.06) & (g > b + 0.04)), "冷": (b >= r - 0.01) & ~((g > r + 0.06) & (g > b + 0.04)), "亮": y > 0.75}
    p = lambda v, q: float(np.percentile(v, q))
    out = f"{tag}\t{len(px)} 像素\t亮度 p10 {p(y, 10):.2f} p50 {p(y, 50):.2f} p90 {p(y, 90):.2f}\t饱和度 p50 {p(s, 50):.2f} p90 {p(s, 90):.2f}"
    for k, m in cls.items():
        if m.sum() > 0.02 * len(px): out += f"\t{k} {100 * m.mean():.0f}% ({','.join(str(int(v * 255)) for v in np.median(px[m], 0))})"
    print(out)


if sys.argv[1] == "pop": pass
elif sys.argv[1] == "sheet":
    a = np.asarray(Image.open(sys.argv[2]).convert("RGB")).astype(np.float32) / 255
    bg = np.median(np.concatenate([a[:20].reshape(-1, 3), a[-20:].reshape(-1, 3), a[:, :20].reshape(-1, 3), a[:, -20:].reshape(-1, 3)]), 0)
    m = np.abs(a - bg).sum(2) > 0.12
    stats(a[m], "设定图 " + sys.argv[2].split("/")[-1])
else:
    a = np.asarray(Image.open(sys.argv[2]).convert("RGB")).astype(np.float32) / 255; b = np.asarray(Image.open(sys.argv[3]).convert("RGB")).astype(np.float32) / 255
    f = float(sys.argv[4]) if len(sys.argv) > 4 else 0.5; h, w = a.shape[:2]
    win = np.zeros((h, w), bool); win[int(h * (0.5 - f / 2)):int(h * (0.5 + f / 2)), int(w * (0.5 - f / 2)):int(w * (0.5 + f / 2))] = True
    d = np.abs(a - b).sum(2)
    # 怪脚下的影子也会差出来：影子是地面变暗（颜色方向和地面一样、只是暗），去掉“和没怪那张同色相、只是更暗”的像素
    ratio = (a + 1e-3) / (b + 1e-3); shade = (ratio.max(2) - ratio.min(2) < 0.12) & (ratio.mean(2) < 0.95)
    m = (d > 0.25) & win & ~shade
    stats(a[m], "游戏 " + sys.argv[2].split("/")[-1])


def pop(a_path, b_path, f=0.5):
    """显不显眼（STYLE.md 3.1 第 1 条的量法，照 tools/style_b/pop.py）：怪的亮度 p10/p50/p90、跨度，怪四周一圈地面的亮度和跨度，跨度之比"""
    a = np.asarray(Image.open(a_path).convert("RGB")).astype(np.float32) / 255; b = np.asarray(Image.open(b_path).convert("RGB")).astype(np.float32) / 255; h, w = a.shape[:2]
    win = np.zeros((h, w), bool); win[int(h * (0.5 - f / 2)):int(h * (0.5 + f / 2)), int(w * (0.5 - f / 2)):int(w * (0.5 + f / 2))] = True
    d = np.abs(a - b).sum(2); ratio = (a + 1e-3) / (b + 1e-3); shade = (ratio.max(2) - ratio.min(2) < 0.12) & (ratio.mean(2) < 0.95)
    m = (d > 0.25) & win & ~shade; ys, xs = np.nonzero(m)
    ring = np.zeros_like(m); ring[max(0, ys.min() - 60):ys.max() + 60, max(0, xs.min() - 60):xs.max() + 60] = True; ring &= ~m & (d < 0.05)
    ym, yg = Y(a[m]), Y(b[ring]); p = lambda v, q: float(np.percentile(v, q)); mx = a[m].max(1); mn = a[m].min(1); sat = (mx - mn) / (mx + 1e-6)
    sm, sg = p(ym, 90) - p(ym, 10), p(yg, 90) - p(yg, 10)
    return f"{m.sum()} 像素\t怪亮度 p10 {p(ym, 10):.2f} p50 {p(ym, 50):.2f} p90 {p(ym, 90):.2f} 跨度 {sm:.2f}\t饱和度 p90 {p(sat, 90):.2f}\t地面 {np.median(yg):.2f}（跨度 {sg:.2f}）\t跨度之比 {sm / max(sg, 1e-3):.1f}"


if sys.argv[1] == "pop":
    print(sys.argv[2].split("/")[-1], pop(sys.argv[2], sys.argv[3], float(sys.argv[4]) if len(sys.argv) > 4 else 0.5))
