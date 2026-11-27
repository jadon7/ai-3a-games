"""比 tools/vsheet.py 更大的抽帧图（那张每格只有 250 像素宽，看不清动作细节）。
用法: python art/hero/osen/vsheet_big.py <视频> <输出前缀> [总帧数=24] [每张几帧=12] [每行几帧=3] [每格宽=660]
产出 <前缀>_a.jpg、_b.jpg …，每格左上角是帧号。"""
import cv2, sys, numpy as np
src, prefix = sys.argv[1], sys.argv[2]
n = int(sys.argv[3]) if len(sys.argv) > 3 else 24; per = int(sys.argv[4]) if len(sys.argv) > 4 else 12
cols = int(sys.argv[5]) if len(sys.argv) > 5 else 3; tw = int(sys.argv[6]) if len(sys.argv) > 6 else 660
cap = cv2.VideoCapture(src); T = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)); fr = []
for i in np.linspace(0, T - 1, n).astype(int):
    cap.set(cv2.CAP_PROP_POS_FRAMES, int(i)); ok, f = cap.read()
    if not ok: continue
    h, w = f.shape[:2]; f = cv2.resize(f, (tw, round(h * tw / w)), interpolation=cv2.INTER_AREA)
    cv2.putText(f, str(i), (8, 26), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2); fr.append(f)
h, w = fr[0].shape[:2]
for s in range(0, len(fr), per):
    part = fr[s:s + per]; rows = (len(part) + cols - 1) // cols; sh = np.full((rows * h, cols * w, 3), 40, np.uint8)
    for k, f in enumerate(part): sh[(k // cols) * h:(k // cols + 1) * h, (k % cols) * w:(k % cols + 1) * w] = f
    out = f"{prefix}_{chr(97 + s // per)}.jpg"; cv2.imwrite(out, sh, [cv2.IMWRITE_JPEG_QUALITY, 88]); print(T, out, sh.shape)
