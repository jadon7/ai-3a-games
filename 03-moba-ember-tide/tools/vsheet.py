import cv2, sys, numpy as np
src, out = sys.argv[1], sys.argv[2]; n = int(sys.argv[3]) if len(sys.argv) > 3 else 8; cols = int(sys.argv[4]) if len(sys.argv) > 4 else 4
cap = cv2.VideoCapture(src); T = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)); fr = []
for i in np.linspace(0, T - 1, n).astype(int):
    cap.set(cv2.CAP_PROP_POS_FRAMES, int(i)); ok, f = cap.read()
    if ok: cv2.putText(f, str(i), (8, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2); fr.append(f)
h, w = fr[0].shape[:2]; rows = (len(fr) + cols - 1) // cols; sh = np.zeros((rows * h, cols * w, 3), np.uint8)
for k, f in enumerate(fr): sh[(k // cols) * h:(k // cols + 1) * h, (k % cols) * w:(k % cols + 1) * w] = f
s = min(1.0, 2000 / sh.shape[1]); sh = cv2.resize(sh, None, fx=s, fy=s, interpolation=cv2.INTER_AREA); cv2.imwrite(out, sh, [cv2.IMWRITE_JPEG_QUALITY, 85]); print(T, sh.shape)
