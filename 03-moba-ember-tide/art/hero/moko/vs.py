#!/usr/bin/env python3
"""摩珂自己用：把视频抽帧拼成大一点的图，方便看细节（tools/vsheet.py 的 24 格每格只有 250 像素宽）。
用法: python3 art/hero/moko/vs.py <视频> <输出.jpg> [帧数或 "起-止-步长"=12] [每行几格=4] [总宽=2000]"""
import cv2, sys, numpy as np
src, out = sys.argv[1], sys.argv[2]; spec = sys.argv[3] if len(sys.argv) > 3 else "12"; cols = int(sys.argv[4]) if len(sys.argv) > 4 else 4; W = int(sys.argv[5]) if len(sys.argv) > 5 else 2000
cap = cv2.VideoCapture(src); T = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
if "-" in spec:
    a, b, st = [int(x) for x in spec.split("-")]; idx = list(range(a, min(b, T - 1) + 1, st))
else: idx = [int(i) for i in np.linspace(0, T - 1, int(spec))]
fr = []
for i in idx:
    cap.set(cv2.CAP_PROP_POS_FRAMES, int(i)); ok, f = cap.read()
    if ok: cv2.putText(f, str(i), (10, 34), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 255), 2); fr.append(f)
h, w = fr[0].shape[:2]; rows = (len(fr) + cols - 1) // cols; sh = np.full((rows * h, cols * w, 3), 30, np.uint8)
for k, f in enumerate(fr): sh[(k // cols) * h:(k // cols + 1) * h, (k % cols) * w:(k % cols + 1) * w] = f
s = min(1.0, W / sh.shape[1]); sh = cv2.resize(sh, None, fx=s, fy=s, interpolation=cv2.INTER_AREA); cv2.imwrite(out, sh, [cv2.IMWRITE_JPEG_QUALITY, 88]); print(T, sh.shape, idx)
