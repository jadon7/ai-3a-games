"""把 tools/kit_test.mjs 连拍的原图在英雄附近裁一块放大了拼起来（kit_sheet.py 拼的图里英雄只有几十个像素高，看不清动作）。
用法: python3 art/hero/gorran/kitzoom.py <目录> <键> <张数> [起始张=0] [每行几张=5] [裁多宽=560]
英雄在画面里的位置：取每张图里头顶血条（等级牌旁的绿条）附近；找不到就用画面中间。
"""
import sys
from PIL import Image
import numpy as np
d, key, n = sys.argv[1], sys.argv[2], int(sys.argv[3]); s0 = int(sys.argv[4]) if len(sys.argv) > 4 else 0; cols = int(sys.argv[5]) if len(sys.argv) > 5 else 5; cw = int(sys.argv[6]) if len(sys.argv) > 6 else 560
ch = int(cw * 0.8); ims = []
for i in range(s0, s0 + n):
    im = Image.open(f"{d}/{key}_{i:02d}.jpg").convert("RGB"); a = np.asarray(im).astype(int); H, W = a.shape[:2]
    g = (a[..., 1] > 170) & (a[..., 0] < 150) & (a[..., 2] < 150) & (a[..., 1] - a[..., 0] > 60)          # 自己的血条是亮绿色
    g[:, : int(W * 0.15)] = False; g[:, int(W * 0.88):] = False; g[int(H * 0.82):] = False; ys, xs = np.where(g)
    if len(xs) > 200:
        col = np.bincount(xs, minlength=W); x = int(np.argmax(np.convolve(col, np.ones(90), "same"))); sel = np.abs(xs - x) < 60; cx, cy = int(xs[sel].mean()), int(ys[sel].mean()) + 95
    else: cx, cy = W // 2, H // 2
    x0 = min(max(cx - cw // 2, 0), W - cw); y0 = min(max(cy - ch // 2, 0), H - ch); ims.append(im.crop((x0, y0, x0 + cw, y0 + ch)))
rows = (len(ims) + cols - 1) // cols; sh = Image.new("RGB", (cw * cols, ch * rows))
for k, im in enumerate(ims): sh.paste(im, ((k % cols) * cw, (k // cols) * ch))
out = f"{d}/{key}_zoom.jpg"; sh.save(out, quality=88); print(out, sh.size)
