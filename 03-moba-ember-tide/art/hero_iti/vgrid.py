"""视频抽帧拼图（比 tools/vsheet.py 大，看得清手和刀）：$PY -I art/hero_iti/vgrid.py <视频> <输出.jpg> [帧数=16] [每行=4] [起帧] [止帧]
每格是这一帧的双机位画面，按角色所在的范围裁掉上下的空白。"""
import sys, cv2, numpy as np
vid, out = sys.argv[1], sys.argv[2]; n = int(sys.argv[3]) if len(sys.argv) > 3 else 16; cols = int(sys.argv[4]) if len(sys.argv) > 4 else 4
cap = cv2.VideoCapture(vid); frames = []
while True:
    ok, f = cap.read()
    if not ok: break
    frames.append(f)
T = len(frames); a = int(sys.argv[5]) if len(sys.argv) > 5 else 0; b = int(sys.argv[6]) if len(sys.argv) > 6 else T - 1
ids = np.linspace(a, b, n).round().astype(int)
stack = np.stack([frames[i] for i in ids]).astype(np.int16); bg = np.median(stack[:, :12, :12].reshape(-1, 3), 0)
diff = (np.abs(stack - bg).max(-1) > 30).any(0); ys, xs = np.where(diff)
y0, y1 = max(0, ys.min() - 10), min(diff.shape[0], ys.max() + 10)
tiles = []
for i in ids:
    t = frames[i][y0:y1].copy(); cv2.putText(t, str(i), (8, 28), 0, 0.9, (0, 0, 255), 2); tiles.append(t)
h, w = tiles[0].shape[:2]; rows = (len(tiles) + cols - 1) // cols
grid = np.full((rows * h, cols * w, 3), 40, np.uint8)
for k, t in enumerate(tiles): grid[(k // cols) * h:(k // cols + 1) * h, (k % cols) * w:(k % cols + 1) * w] = t
s = min(1.0, 2400 / grid.shape[1]); grid = cv2.resize(grid, (int(grid.shape[1] * s), int(grid.shape[0] * s)), interpolation=cv2.INTER_AREA)
cv2.imwrite(out, grid, [cv2.IMWRITE_JPEG_QUALITY, 88]); print(out, T, "frames", grid.shape)
