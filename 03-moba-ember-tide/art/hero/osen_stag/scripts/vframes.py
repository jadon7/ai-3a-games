"""从视频里取几帧拼起来看细节。用法: python vframes.py <视频> <输出.jpg> <帧号,帧号,...> [列数=3] [缩放=0.75]"""
import cv2, sys, numpy as np
src, out, fs = sys.argv[1], sys.argv[2], [int(x) for x in sys.argv[3].split(",")]
cols = int(sys.argv[4]) if len(sys.argv) > 4 else 3; sc = float(sys.argv[5]) if len(sys.argv) > 5 else 0.75
cap = cv2.VideoCapture(src); ims = []
for f in fs:
    cap.set(cv2.CAP_PROP_POS_FRAMES, f); ok, im = cap.read()
    if ok: im = cv2.resize(im, None, fx=sc, fy=sc, interpolation=cv2.INTER_AREA); cv2.putText(im, str(f), (8, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2); ims.append(im)
rows = (len(ims) + cols - 1) // cols; h, w = ims[0].shape[:2]; sh = np.zeros((rows * h, cols * w, 3), np.uint8)
for k, im in enumerate(ims): sh[(k // cols) * h:(k // cols + 1) * h, (k % cols) * w:(k % cols + 1) * w] = im
cv2.imwrite(out, sh, [cv2.IMWRITE_JPEG_QUALITY, 88]); print(sh.shape)
