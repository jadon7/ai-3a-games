"""视频抽帧看清楚：按给的帧号（或 起:止:步）取帧，裁掉上下空白，4 列拼图，标帧号。
用法: <V2R>/.venv/bin/python vframes.py <视频> <输出.jpg> <帧号,帧号…|起:止:步> [列=4] [缩放=0.75]"""
import cv2, sys, numpy as np
src, out, spec = sys.argv[1:4]; cols = int(sys.argv[4]) if len(sys.argv) > 4 else 4; s = float(sys.argv[5]) if len(sys.argv) > 5 else 0.75
cap = cv2.VideoCapture(src); T = int(cap.get(7))
fs = list(range(*[int(x) for x in spec.split(":")])) if ":" in spec else [int(x) for x in spec.split(",")]
fr = []
for i in fs:
    if i >= T: continue
    cap.set(1, i); ok, f = cap.read()
    if not ok: continue
    f = f[110:470]; cv2.putText(f, str(i), (8, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 0, 255), 2); fr.append(cv2.resize(f, None, fx=s, fy=s))
h, w = fr[0].shape[:2]; rows = (len(fr) + cols - 1) // cols; sh = np.full((rows * h, cols * w, 3), 40, np.uint8)
for k, f in enumerate(fr): sh[(k // cols) * h:(k // cols + 1) * h, (k % cols) * w:(k % cols + 1) * w] = f
cv2.imwrite(out, sh, [cv2.IMWRITE_JPEG_QUALITY, 82]); print(T, len(fr), sh.shape)
