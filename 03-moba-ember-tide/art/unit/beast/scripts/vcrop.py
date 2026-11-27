"""把视频里动物所在的那一块裁出来抽帧拼图（共用的 vsheet.py 拼出来动物太小看不清腿）。
用法: python3 vcrop.py <视频> <输出.jpg> [步长=4] [列数=8] [side|front|both=side] [起帧=0] [止帧=末帧] [y0=250] [y1=475]"""
import cv2, sys, numpy as np
src, out = sys.argv[1], sys.argv[2]; step = int(sys.argv[3]) if len(sys.argv) > 3 else 4; cols = int(sys.argv[4]) if len(sys.argv) > 4 else 8
view = sys.argv[5] if len(sys.argv) > 5 else "side"; cap = cv2.VideoCapture(src); T = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
a = int(sys.argv[6]) if len(sys.argv) > 6 else 0; b = int(sys.argv[7]) if len(sys.argv) > 7 else T - 1
y0 = int(sys.argv[8]) if len(sys.argv) > 8 else 250; y1 = int(sys.argv[9]) if len(sys.argv) > 9 else 475
fr = []; frames = []
while True:
    ok, f = cap.read()
    if not ok: break
    frames.append(f)
for i in range(a, min(b, len(frames) - 1) + 1, step):
    f = frames[i]; W = f.shape[1]
    c = {"side": f[y0:y1, W // 2 + 30:W - 10], "front": f[y0:y1, 110:W // 2 - 110], "both": np.concatenate([f[y0:y1, 110:W // 2 - 110], f[y0:y1, W // 2 + 30:W - 10]], 1)}[view].copy()
    cv2.putText(c, str(i), (6, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2); fr.append(c)
h, w = fr[0].shape[:2]; rows = (len(fr) + cols - 1) // cols; sh = np.full((rows * h, cols * w, 3), 200, np.uint8)
for k, f in enumerate(fr): sh[(k // cols) * h:(k // cols + 1) * h, (k % cols) * w:(k % cols + 1) * w] = f
s = min(1.0, 2000 / sh.shape[1], 2000 / sh.shape[0]); sh = cv2.resize(sh, None, fx=s, fy=s, interpolation=cv2.INTER_AREA) if s < 1 else sh
cv2.imwrite(out, sh, [cv2.IMWRITE_JPEG_QUALITY, 88]); print(len(frames), sh.shape)
