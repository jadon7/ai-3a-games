#!/usr/bin/env python3
"""换画风 B · b-toon：拼“B 设计稿 / 改前 / 改后”的三联图，并量颜色和亮度（量法同 docs/round9/map_gap 和 stylecost：
原图裁成 16:9、缩到 480×270；亮度用 Rec.709；大块明暗是缩到 16×9 后亮度的标准差；细碎明暗是亮度减去 3 像素高斯模糊后的标准差；
饱和度是 (max−min)/max 的平均；草地 / 红土的颜色是绿色 / 橙红色像素的中位数）。
要 Pillow：用 /opt/homebrew/opt/python@3.14/bin/python3.14 跑。

用法：
  python3.14 tools/style_b_compare.py tri <输出.jpg> <标题1>=<图1> <标题2>=<图2> [<标题3>=<图3> ...]   并排拼图，每张上面一条标题
  python3.14 tools/style_b_compare.py stats <图> [<图> ...]                                          量数（JSON 一行一张）
"""
import json, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

def load169(p, w=480):
    im = Image.open(p).convert("RGB"); W, H = im.size; t = W / H
    if t > 16 / 9: nw = int(H * 16 / 9); im = im.crop(((W - nw) // 2, 0, (W - nw) // 2 + nw, H))
    else: nh = int(W * 9 / 16); im = im.crop((0, (H - nh) // 2, W, (H - nh) // 2 + nh))
    return im.resize((w, w * 9 // 16), Image.LANCZOS)

def stats(p):
    im = load169(p); a = np.asarray(im).astype(np.float32) / 255
    L = a @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    big = np.asarray(Image.fromarray((L * 255).astype(np.uint8)).resize((16, 9), Image.BOX)).astype(np.float32) / 255
    fine = L - np.asarray(Image.fromarray((L * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(3))).astype(np.float32) / 255
    mx, mn = a.max(axis=2), a.min(axis=2); sat = (mx - mn) / np.maximum(mx, 1e-3)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    green = (g > r * 1.08) & (g > b * 1.15) & (sat > 0.3)
    red = (r > g * 1.35) & (r > b * 1.5) & (sat > 0.35)
    med = lambda m: [int(v) for v in np.median(a[m] * 255, axis=0)] if m.sum() > 200 else None
    return {"img": p.split("/")[-1], "lum": round(float(L.mean()), 3), "big": round(float(big.std()), 3), "fine": round(float(fine.std()), 3), "sat": round(float(sat.mean()), 3),
            "grass": med(green), "grassShare": round(float(green.mean()), 2), "soil": med(red), "soilShare": round(float(red.mean()), 2), "p5": round(float(np.percentile(L, 5)), 3), "p95": round(float(np.percentile(L, 95)), 3)}

def font(sz):
    for f in ["/System/Library/Fonts/PingFang.ttc", "/System/Library/Fonts/STHeiti Medium.ttc", "/System/Library/Fonts/Hiragino Sans GB.ttc"]:
        try: return ImageFont.truetype(f, sz)
        except Exception: pass
    return ImageFont.load_default()

def tri(out, items, w=1000):
    h = w * 9 // 16; bar = 44; f = font(26)
    s = Image.new("RGB", (w * len(items) + 8 * (len(items) - 1), h + bar), (18, 20, 24)); d = ImageDraw.Draw(s)
    for i, (t, p) in enumerate(items):
        x = i * (w + 8); s.paste(load169(p, w), (x, bar)); d.text((x + 12, 7), t, font=f, fill=(235, 235, 230))
    s.save(out, quality=90); print("拼好了", out, s.size)

if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "tri": tri(sys.argv[2], [tuple(a.split("=", 1)) for a in sys.argv[3:]])
    else:
        for p in sys.argv[2:]: print(json.dumps(stats(p), ensure_ascii=False))
