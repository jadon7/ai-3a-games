#!/usr/bin/env python3
"""从视频里取连续的若干帧拼大图（比 tools/vsheet.py 的抽帧图大，看细节用）。
用法: python3 vframes.py <视频> <输出.jpg> <起始帧> <结束帧> [步长=2] [每行几张=4] [缩放=0.6]"""
import cv2, sys, numpy as np
src, out, a, b = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]); step = int(sys.argv[5]) if len(sys.argv) > 5 else 2; cols = int(sys.argv[6]) if len(sys.argv) > 6 else 4; sc = float(sys.argv[7]) if len(sys.argv) > 7 else 0.6
cap = cv2.VideoCapture(src); fr = []
for i in range(a, b + 1, step):
    cap.set(cv2.CAP_PROP_POS_FRAMES, i); ok, f = cap.read()
    if not ok: break
    f = cv2.resize(f, None, fx=sc, fy=sc, interpolation=cv2.INTER_AREA); cv2.putText(f, str(i), (8, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2); fr.append(f)
h, w = fr[0].shape[:2]; rows = (len(fr) + cols - 1) // cols; sh = np.full((rows * h, cols * w, 3), 40, np.uint8)
for k, f in enumerate(fr): sh[(k // cols) * h:(k // cols + 1) * h, (k % cols) * w:(k % cols + 1) * w] = f
cv2.imwrite(out, sh, [cv2.IMWRITE_JPEG_QUALITY, 86]); print(len(fr), sh.shape)
