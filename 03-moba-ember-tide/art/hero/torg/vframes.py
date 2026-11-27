#!/usr/bin/env python3
"""把视频里指定的一段帧拼成大图细看（tools/vsheet.py 是整段均匀抽，格子小）。
用法: python vframes.py <视频> <输出.jpg> <起始帧> <结束帧> <步长> [列数=3] [总宽=2000]"""
import sys, cv2, numpy as np
src, out, a, b, st = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])
cols = int(sys.argv[6]) if len(sys.argv) > 6 else 3; W = int(sys.argv[7]) if len(sys.argv) > 7 else 2000
cap = cv2.VideoCapture(src); fr = []
for i in range(a, b + 1, st):
    cap.set(cv2.CAP_PROP_POS_FRAMES, i); ok, f = cap.read()
    if ok: cv2.putText(f, str(i), (8, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 255), 2); fr.append(f)
h, w = fr[0].shape[:2]; rows = (len(fr) + cols - 1) // cols; sh = np.full((rows * h, cols * w, 3), 40, np.uint8)
for k, f in enumerate(fr): sh[(k // cols) * h:(k // cols + 1) * h, (k % cols) * w:(k % cols + 1) * w] = f
s = W / sh.shape[1]; sh = cv2.resize(sh, None, fx=s, fy=s, interpolation=cv2.INTER_AREA); cv2.imwrite(out, sh, [cv2.IMWRITE_JPEG_QUALITY, 88]); print(len(fr), sh.shape)
