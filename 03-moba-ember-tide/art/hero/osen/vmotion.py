"""粗看一段视频里动了多少：每一帧和第 0 帧、和前一帧的平均差（只算有角色的像素），再分左右半边给出角色包围盒的变化。
用法: python art/hero/osen/vmotion.py <视频> [每隔几帧打印一次=10]"""
import cv2, sys, numpy as np
src = sys.argv[1]; step = int(sys.argv[2]) if len(sys.argv) > 2 else 10
cap = cv2.VideoCapture(src); fr = []
while True:
    ok, f = cap.read()
    if not ok: break
    fr.append(f)
H, W = fr[0].shape[:2]; bg = np.median(np.stack([f[:20].reshape(-1, 3) for f in fr[:5]]).reshape(-1, 3), axis=0)
def box(img):
    m = (np.abs(img.astype(np.int16) - bg).sum(-1) > 60); ys, xs = np.where(m)
    return (xs.min(), ys.min(), xs.max(), ys.max()) if len(xs) else (0, 0, 0, 0)
g = [cv2.cvtColor(f, cv2.COLOR_BGR2GRAY).astype(np.float32) for f in fr]
print("frames", len(fr), "size", W, H)
for i in range(0, len(fr), step):
    d0 = np.abs(g[i] - g[0]).mean(); d1 = np.abs(g[i] - g[max(i - 1, 0)]).mean()
    print("f%3d  diff0 %.2f  diff_prev %.2f  front box %s  side box %s" % (i, d0, d1, box(fr[i][:, :W // 2 - 4]), box(fr[i][:, W // 2 + 4:])))
