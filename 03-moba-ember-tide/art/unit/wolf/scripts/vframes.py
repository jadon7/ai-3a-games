"""从视频里取几帧拼起来看细节：只留画面下面有狼的那一条，放大。
用法: python vframes.py <视频> <输出.jpg> <帧号,帧号,... 或 起:止:步长> [列数=4] [缩放=1.5] [上边裁到画面高度的几成=0.5]"""
import cv2, sys, numpy as np
src, out, spec = sys.argv[1], sys.argv[2], sys.argv[3]
if ":" in spec:
    a, b, s = [int(x) for x in spec.split(":")]; fs = list(range(a, b + 1, s))
else: fs = [int(x) for x in spec.split(",")]
cols = int(sys.argv[4]) if len(sys.argv) > 4 else 4; sc = float(sys.argv[5]) if len(sys.argv) > 5 else 1.5; top = float(sys.argv[6]) if len(sys.argv) > 6 else 0.5
cap = cv2.VideoCapture(src); ims = []
for f in fs:
    cap.set(cv2.CAP_PROP_POS_FRAMES, f); ok, im = cap.read()
    if ok:
        im = im[int(im.shape[0] * top):int(im.shape[0] * 0.97)]; im = cv2.resize(im, None, fx=sc, fy=sc, interpolation=cv2.INTER_CUBIC); cv2.putText(im, str(f), (8, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2); ims.append(im)
rows = (len(ims) + cols - 1) // cols; h, w = ims[0].shape[:2]; sh = np.zeros((rows * h, cols * w, 3), np.uint8)
for k, im in enumerate(ims): sh[(k // cols) * h:(k // cols + 1) * h, (k % cols) * w:(k % cols + 1) * w] = im
cv2.imwrite(out, sh, [cv2.IMWRITE_JPEG_QUALITY, 88]); print(sh.shape)
