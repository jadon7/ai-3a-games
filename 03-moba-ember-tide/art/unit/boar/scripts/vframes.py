#!/usr/bin/env python3
"""从视频里抽帧拼成大图看细节（tools/vsheet.py 一行 8 帧太小）。每帧裁掉上面空着的三成多。
用法: python3 vframes.py <视频> <输出.jpg> [起-止-步长=0-120-5] [列数=4]"""
import sys, cv2, numpy as np
src, out = sys.argv[1:3]; a, b, s = map(int, (sys.argv[3] if len(sys.argv) > 3 else "0-120-5").split("-")); cols = int(sys.argv[4]) if len(sys.argv) > 4 else 4
cap = cv2.VideoCapture(src); fr = []
for i in range(a, b + 1, s):
    cap.set(cv2.CAP_PROP_POS_FRAMES, i); ok, f = cap.read()
    if not ok: break
    h = f.shape[0]; f = f[int(h * 0.36):int(h * 0.98)].copy(); cv2.putText(f, str(i), (8, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2); fr.append(f)
h, w = fr[0].shape[:2]; rows = (len(fr) + cols - 1) // cols; sh = np.zeros((rows * h, cols * w, 3), np.uint8)
for k, f in enumerate(fr): sh[(k // cols) * h:(k // cols + 1) * h, (k % cols) * w:(k % cols + 1) * w] = f
s_ = min(1.0, 2000 / sh.shape[1]); sh = cv2.resize(sh, None, fx=s_, fy=s_, interpolation=cv2.INTER_AREA); cv2.imwrite(out, sh, [cv2.IMWRITE_JPEG_QUALITY, 88]); print(len(fr), sh.shape)
