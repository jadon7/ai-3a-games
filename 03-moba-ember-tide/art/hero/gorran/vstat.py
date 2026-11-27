"""量一段双机位视频里角色动了多少、有没有出画面：每帧在左右两半各找出角色（和灰背景差得多的像素）的外框。
用法: python3 art/hero/gorran/vstat.py <视频> [每隔几帧打印一行=12]
打印：每半边角色外框的上、下、左、右（像素），头顶上下动了多少、外框宽了多少（占身高的百分比），有没有碰到画面边或中间的分隔线。
"""
import cv2, sys
import numpy as np
src = sys.argv[1]; step = int(sys.argv[2]) if len(sys.argv) > 2 else 12
cap = cv2.VideoCapture(src); fr = []
while True:
    ok, f = cap.read()
    if not ok: break
    fr.append(f)
T = len(fr); H, W = fr[0].shape[:2]; half = W // 2; bg = np.median(fr[0][:20, :60].reshape(-1, 3), axis=0)
def box(img):
    m = (np.abs(img.astype(np.int16) - bg).max(axis=2) > 34); ys = np.where(m.sum(1) > 2)[0]; xs = np.where(m.sum(0) > 2)[0]
    return (ys[0], ys[-1], xs[0], xs[-1]) if len(ys) and len(xs) else (0, 0, 0, 0)
B = np.array([[box(f[:, 4:half - 4]), box(f[:, half + 4:W - 4])] for f in fr])      # (T, 2, 4)：上 下 左 右
h0 = B[0, 0, 1] - B[0, 0, 0]
print(f"{T} 帧 {W}x{H}，第 0 帧正面角色高 {h0} 像素")
for t in range(0, T, step): print(f"  帧 {t:3d}  正面 上{B[t,0,0]:4d} 下{B[t,0,1]:4d} 左{B[t,0,2]:4d} 右{B[t,0,3]:4d}   侧面 上{B[t,1,0]:4d} 下{B[t,1,1]:4d} 左{B[t,1,2]:4d} 右{B[t,1,3]:4d}")
wv = half - 8
for v, nm in ((0, "正面"), (1, "侧面")):
    b = B[:, v]; top = b[:, 0]; wid = b[:, 3] - b[:, 2]
    edge = [t for t in range(T) if b[t, 2] <= 1 or b[t, 3] >= wv - 2 or b[t, 0] <= 1 or b[t, 1] >= H - 2]
    print(f"{nm}: 头顶在 {top.min()}..{top.max()}（动了身高的 {100 * (top.max() - top.min()) / h0:.1f}%），外框宽 {wid.min()}..{wid.max()}（变化 {100 * (wid.max() - wid.min()) / h0:.1f}%），"
          f"最低点 {b[:, 1].min()}..{b[:, 1].max()}，" + (f"碰到画面边或分隔线的帧 {len(edge)} 个（{edge[0]}..{edge[-1]}）" if edge else "没有碰到画面边"))
d = [float(np.abs(fr[t].astype(np.int16) - fr[t - 1].astype(np.int16)).mean()) for t in range(1, T)]
print("相邻帧的平均差：中位数 %.2f 最大 %.2f（第 %d 帧）" % (np.median(d), max(d), int(np.argmax(d)) + 1))
