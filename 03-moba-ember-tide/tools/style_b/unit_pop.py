"""量小兵 / 野怪和英雄比亮不亮（换画风 B · w-unit）：unit_look.mjs 加 MOBA_NONE=1 拍的“有单位”和“没单位”两张，差得多的像素当单位，按每个单位在画面里的位置分开量。
量法和 pop.py 一样：相对亮度按 gamma 2.2 换回 0–1，打印 p10 / p50 / p90、跨度、饱和度 p90。
用法: python3.14 tools/style_b/unit_pop.py <有单位.jpg> '<unit_look 打印的 pos JSON>' [半宽像素=70] [往上多少像素=150] [往下=60]"""
import sys, json, numpy as np
from PIL import Image
a_p = sys.argv[1]; pos = json.loads(sys.argv[2]); hw = int(sys.argv[3]) if len(sys.argv) > 3 else 70; up = int(sys.argv[4]) if len(sys.argv) > 4 else 150; dn = int(sys.argv[5]) if len(sys.argv) > 5 else 60
a = np.asarray(Image.open(a_p).convert("RGB")).astype(np.float32) / 255; b = np.asarray(Image.open(a_p.replace(".jpg", "_none.jpg")).convert("RGB")).astype(np.float32) / 255
lin = lambda c: np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
Y = lambda c: (lin(c) @ np.array([0.2126, 0.7152, 0.0722])) ** (1 / 2.2)
d = np.abs(a - b).sum(2); H, W = d.shape; p = lambda v, q: float(np.percentile(v, q))
for name, team, sp in pos:
    if not sp: continue
    x, y = sp; k = 2.2 if name == "hero" else 1.0
    win = np.zeros_like(d, bool); win[max(0, int(y - up * k)):min(H, int(y + dn * k)), max(0, int(x - hw * k)):min(W, int(x + hw * k))] = True
    m = (d > 0.25) & win
    if m.sum() < 30: print(name, team, "没量到"); continue
    yh = Y(a[m]); mx = a[m].max(1); mn = a[m].min(1); sat = (mx - mn) / (mx + 1e-6)
    print(f"{name}\t队{team}\t{m.sum()} 像素\t亮度 p10 {p(yh, 10):.2f} p50 {p(yh, 50):.2f} p90 {p(yh, 90):.2f} 跨度 {p(yh, 90) - p(yh, 10):.2f}\t饱和度 p50 {p(sat, 50):.2f} p90 {p(sat, 90):.2f}")
