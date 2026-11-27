#!/usr/bin/env python3
"""把视频里一段连续的帧密集抽出来拼图（只留画面下半截）。用法: python vdense.py <视频> <输出.jpg> <起> <止> [步长=2] [每行几格=4] [从画面高度的几成开始=0.45]"""
import sys, cv2, numpy as np
src, out, a, b = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]); st = int(sys.argv[5]) if len(sys.argv) > 5 else 2; cols = int(sys.argv[6]) if len(sys.argv) > 6 else 4; top = float(sys.argv[7]) if len(sys.argv) > 7 else 0.45
cap = cv2.VideoCapture(src); fr = []
while True:
    ok, f = cap.read()
    if not ok: break
    fr.append(f)
tiles = []
for i in range(a, min(b, len(fr) - 1) + 1, st):
    f = fr[i][int(fr[i].shape[0] * top):].copy(); cv2.putText(f, str(i), (8, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2); tiles.append(f)
h, w = tiles[0].shape[:2]; rows = (len(tiles) + cols - 1) // cols; sh = np.zeros((rows * h, cols * w, 3), np.uint8)
for k, f in enumerate(tiles): sh[(k // cols) * h:(k // cols + 1) * h, (k % cols) * w:(k % cols + 1) * w] = f
cv2.imwrite(out, sh, [cv2.IMWRITE_JPEG_QUALITY, 85]); print(len(fr), sh.shape)
