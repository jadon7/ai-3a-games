"""视频抽帧联系表（只裁出角色所在的中间部分，放大看）。用法: python vcrop.py <视频> <输出.jpg> [帧数=16] [列数=4] [起帧] [止帧]"""
import cv2, sys, numpy as np
src, out = sys.argv[1], sys.argv[2]; n = int(sys.argv[3]) if len(sys.argv) > 3 else 16; cols = int(sys.argv[4]) if len(sys.argv) > 4 else 4
cap = cv2.VideoCapture(src); T = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)); a = int(sys.argv[5]) if len(sys.argv) > 5 else 0; b = int(sys.argv[6]) if len(sys.argv) > 6 else T - 1
fr = []
for i in np.linspace(a, b, n).astype(int):
    cap.set(cv2.CAP_PROP_POS_FRAMES, int(i)); ok, f = cap.read()
    if not ok: continue
    H, W = f.shape[:2]; y0, y1 = int(H * 0.06), int(H * 0.98)
    f = np.concatenate([f[y0:y1, int(W * 0.08):int(W * 0.42)], f[y0:y1, int(W * 0.58):int(W * 0.92)]], 1)
    cv2.putText(f, str(i), (6, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2); fr.append(f)
h, w = fr[0].shape[:2]; rows = (len(fr) + cols - 1) // cols; sh = np.full((rows * h, cols * w, 3), 255, np.uint8)
for k, f in enumerate(fr): sh[(k // cols) * h:(k // cols + 1) * h, (k % cols) * w:(k % cols + 1) * w] = f
s = min(1.0, 2400 / sh.shape[1]); sh = cv2.resize(sh, None, fx=s, fy=s, interpolation=cv2.INTER_AREA); cv2.imwrite(out, sh, [cv2.IMWRITE_JPEG_QUALITY, 85]); print(T, sh.shape)
