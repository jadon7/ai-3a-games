"""（w-quad 拷的 tools/style_b/pop.py，只把取英雄的窗口放宽给四足用）量英雄在地面上显不显眼（STYLE.md 3.1 第 1 条的量法）：同一个机位拍“有英雄”和“没英雄”两张，差得多的像素当作英雄。
打印英雄亮度（相对亮度 0–1）的 p10 / p50 / p90、跨度，脚下一圈地面的亮度中位数和跨度，以及“英雄跨度 / 地面跨度”。
用法: python3.14 tools/style_b/pop.py <有英雄.jpg> <没英雄.jpg> [标签]"""
import sys, numpy as np
from PIL import Image
a = np.asarray(Image.open(sys.argv[1]).convert("RGB")).astype(np.float32) / 255; b = np.asarray(Image.open(sys.argv[2]).convert("RGB")).astype(np.float32) / 255
lin = lambda c: np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
Y = lambda c: (lin(c) @ np.array([0.2126, 0.7152, 0.0722])) ** (1 / 2.2)      # 相对亮度换回感知上的 0–1（和 b-concept 的量法一样按 gamma 2.2）
d = np.abs(a - b).sum(2); h, w = d.shape
cy, cx = h // 2, w // 2; win = np.zeros_like(d, bool); win[cy - 150:cy + 90, cx - 160:cx + 160] = True      # w-quad：四足横着长，窗口放宽到 320×240（原来 140×200 会切掉身子）。只看画面正中英雄那一块（镜头对着英雄脚下），排除头顶的血条、远处草摇、水面
m = (d > 0.25) & win
ys, xs = np.nonzero(m); y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
ring = np.zeros_like(m); ring[max(0, y0 - 80):y1 + 80, max(0, x0 - 80):x1 + 80] = True; ring &= ~m & (d < 0.05)
yh, yg = Y(a[m]), Y(b[ring])
p = lambda v, q: float(np.percentile(v, q))
span_h, span_g = p(yh, 90) - p(yh, 10), p(yg, 90) - p(yg, 10)
mx = a[m].max(1); mn = a[m].min(1); sat = (mx - mn) / (mx + 1e-6)
print(f"{sys.argv[3] if len(sys.argv) > 3 else ''}\t英雄 {m.sum()} 像素，高 {y1 - y0} 像素\t亮度 p10 {p(yh, 10):.2f} p50 {p(yh, 50):.2f} p90 {p(yh, 90):.2f} 跨度 {span_h:.2f}\t饱和度 p90 {p(sat, 90):.2f}\t地面 {np.median(yg):.2f} 跨度 {span_g:.2f}\t英雄跨度 / 地面跨度 {span_h / max(span_g, 1e-3):.1f}")
