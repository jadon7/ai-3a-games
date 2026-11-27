#!/usr/bin/env python3
"""量化画面：亮度分布、饱和度、色彩丰富度、高亮像素占比。用来把我的帧和参考图对照。"""
import sys, cv2, numpy as np
def stats(path):
    im = cv2.imread(path)
    im = cv2.resize(im, (960, int(960 * im.shape[0] / im.shape[1])))
    rgb = cv2.cvtColor(im, cv2.COLOR_BGR2RGB).astype(np.float32)
    y = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]
    hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV).astype(np.float32)
    s, v = hsv[..., 1] / 255, hsv[..., 2] / 255
    rg = rgb[..., 0] - rgb[..., 1]; yb = 0.5 * (rgb[..., 0] + rgb[..., 1]) - rgb[..., 2]
    colorful = np.sqrt(rg.std() ** 2 + yb.std() ** 2) + 0.3 * np.sqrt(rg.mean() ** 2 + yb.mean() ** 2)
    return dict(mean=y.mean(), med=np.median(y), p90=np.percentile(y, 90), p99=np.percentile(y, 99),
                dark=(y < 30).mean() * 100, bright=(y > 180).mean() * 100, sat=(s * v).sum() / (v.sum() + 1e-6), satbright=((s > 0.6) & (v > 0.6)).mean() * 100, colorful=colorful)
print(f"{'image':28s} {'mean':>5s} {'med':>5s} {'p90':>5s} {'p99':>5s} {'<30%':>6s} {'>180%':>6s} {'sat':>5s} {'鲜艳亮%':>7s} {'colorful':>8s}")
for p in sys.argv[1:]:
    d = stats(p)
    print(f"{p.split('/')[-1][:28]:28s} {d['mean']:5.1f} {d['med']:5.1f} {d['p90']:5.1f} {d['p99']:5.1f} {d['dark']:6.1f} {d['bright']:6.1f} {d['sat']:5.2f} {d['satbright']:7.1f} {d['colorful']:8.1f}")
