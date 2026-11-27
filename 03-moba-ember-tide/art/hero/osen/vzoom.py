"""把一段视频里指定的几帧放大看：每帧裁出正面、侧面两块（按比例给裁切框），放大后横着拼。
用法: python art/hero/osen/vzoom.py <视频> <输出.jpg> <帧号,帧号,…> [正面框 x0,y0,x1,y1（占半幅的比例）=0.15,0.2,0.85,1] [侧面框=同正面] [放大倍数=2] [每行几帧=4]"""
import cv2, sys, numpy as np
src, out = sys.argv[1], sys.argv[2]; ids = [int(v) for v in sys.argv[3].split(",")]
fb = [float(v) for v in (sys.argv[4] if len(sys.argv) > 4 else "0.15,0.2,0.85,1").split(",")]
sb = [float(v) for v in sys.argv[5].split(",")] if len(sys.argv) > 5 and sys.argv[5] != "-" else fb
k = float(sys.argv[6]) if len(sys.argv) > 6 else 2.0; cols = int(sys.argv[7]) if len(sys.argv) > 7 else 4
cap = cv2.VideoCapture(src); tiles = []
for i in ids:
    cap.set(cv2.CAP_PROP_POS_FRAMES, i); ok, f = cap.read()
    if not ok: continue
    H, W = f.shape[:2]; hw = W // 2; halves = (f[:, :hw], f[:, hw:]); parts = []
    for img, b in zip(halves, (fb, sb)):
        c = img[int(b[1] * H):int(b[3] * H), int(b[0] * hw):int(b[2] * hw)]
        parts.append(cv2.resize(c, None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC))
    hh = max(p.shape[0] for p in parts); parts = [cv2.copyMakeBorder(p, 0, hh - p.shape[0], 0, 2, cv2.BORDER_CONSTANT, value=(0, 0, 0)) for p in parts]
    t = np.hstack(parts); cv2.putText(t, str(i), (6, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.75, (0, 0, 255), 2); tiles.append(t)
h, w = tiles[0].shape[:2]; rows = (len(tiles) + cols - 1) // cols; sh = np.full((rows * h, cols * w, 3), 40, np.uint8)
for j, t in enumerate(tiles): sh[(j // cols) * h:(j // cols) * h + t.shape[0], (j % cols) * w:(j % cols) * w + t.shape[1]] = t
cv2.imwrite(out, sh, [cv2.IMWRITE_JPEG_QUALITY, 88]); print(out, sh.shape)
