"""视频帧（上）和解出来的动作按同样机位渲染的画面（下）并排拼图，逐帧核对腿有没有解错。
用法: python cmp_sheet.py <tag> <起:止:步长 或 帧,帧,…> <输出.jpg> [列数=4] [缩放=1.0] [视频=out/seedance/wolf_<tag>_01.mp4，写 - 用默认] [只看哪边: side|front|both=both]"""
import cv2, sys, os, numpy as np
V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig"; W = "/Users/jadon7/Documents/SynologyDrive/code/moba/art/unit/wolf"
tag, spec, out = sys.argv[1:4]; cols = int(sys.argv[4]) if len(sys.argv) > 4 else 4; sc = float(sys.argv[5]) if len(sys.argv) > 5 else 1.0
video = sys.argv[6] if len(sys.argv) > 6 and sys.argv[6] != "-" else f"{V}/out/seedance/wolf_{tag}_01.mp4"; part = sys.argv[7] if len(sys.argv) > 7 else "both"
if ":" in spec:
    a, b, s = [int(x) for x in spec.split(":")]; fs = list(range(a, b + 1, s))
else: fs = [int(x) for x in spec.split(",")]
cap = cv2.VideoCapture(video); tiles = []; Y0, Y1 = 225, 470
for f in fs:
    cap.set(cv2.CAP_PROP_POS_FRAMES, f); ok, im = cap.read()
    if not ok: continue
    fr = cv2.imread(f"{W}/cmp/{tag}/front/{f:04d}.jpg"); sd = cv2.imread(f"{W}/cmp/{tag}/side/{f:04d}.jpg")
    if fr is None or sd is None: continue
    r = np.concatenate([fr, sd], 1); r = cv2.resize(r, (im.shape[1], im.shape[0]))
    X0, X1 = {"both": (0, im.shape[1]), "side": (im.shape[1] // 2 + 20, im.shape[1] - 10), "front": (90, im.shape[1] // 2 - 90)}[part]
    t = np.concatenate([im[Y0:Y1, X0:X1], r[Y0:Y1, X0:X1]], 0); cv2.putText(t, str(f), (6, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2); cv2.line(t, (0, Y1 - Y0), (t.shape[1], Y1 - Y0), (0, 0, 0), 1)
    tiles.append(cv2.resize(t, None, fx=sc, fy=sc, interpolation=cv2.INTER_AREA if sc < 1 else cv2.INTER_CUBIC) if sc != 1 else t)
h, w = tiles[0].shape[:2]; rows = (len(tiles) + cols - 1) // cols; sh = np.zeros((rows * h, cols * w, 3), np.uint8)
for k, t in enumerate(tiles): sh[(k // cols) * h:(k // cols + 1) * h, (k % cols) * w:(k % cols + 1) * w] = t
cv2.imwrite(out, sh, [cv2.IMWRITE_JPEG_QUALITY, 88]); print(sh.shape)
