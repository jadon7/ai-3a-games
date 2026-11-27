#!/usr/bin/env python3
"""量一段双机位视频里角色动了多少（只读）。用法: python vmotion.py <视频> [每隔几帧=8]
每个机位各打印：角色轮廓的中心和包围盒随时间的变化（像素；480p 下角色身高约 267 像素）、相邻取样帧之间画面变了多少、
头盔舷窗（正面那团青色）的位置。数字小就是动作幅度小。"""
import sys, cv2, numpy as np
src = sys.argv[1]; step = int(sys.argv[2]) if len(sys.argv) > 2 else 8
cap = cv2.VideoCapture(src); fr = []
while True:
    ok, f = cap.read()
    if not ok: break
    fr.append(f)
T = len(fr); h, w = fr[0].shape[:2]; half = w // 2
bg = np.median(np.stack(fr[::10]), 0).astype(np.float32) if False else None
def mask(img):      # 背景是浅灰，角色比它暗或者带颜色
    g = img.astype(np.int16); sat = g.max(2) - g.min(2); lum = g.mean(2)
    return (sat > 28) | (lum < 150)
print("帧数", T, "尺寸", w, h)
for name, x0, x1 in (("正面", 0, half - 2), ("侧面", half + 2, w)):
    rows = []; prev = None; diffs = []
    for i in range(0, T, step):
        m = mask(fr[i][:, x0:x1]); ys, xs = np.nonzero(m)
        if len(xs) < 50: rows.append((i, None)); continue
        g = cv2.cvtColor(fr[i][:, x0:x1], cv2.COLOR_BGR2GRAY).astype(np.float32)
        if prev is not None: diffs.append(float(np.abs(g - prev).mean()))
        prev = g
        b, gg, r = [fr[i][:, x0:x1, k].astype(np.int16) for k in range(3)]; cy = (np.minimum(b, gg) - r > 70) & (ys.min() + (ys.max() - ys.min()) * 0.0 <= np.arange(h)[:, None])
        cyy, cxx = np.nonzero(cy)
        rows.append((i, (xs.mean(), ys.mean(), xs.min(), xs.max(), ys.min(), ys.max(), len(xs), (cxx.mean() if len(cxx) else -1), (cyy.mean() if len(cyy) else -1))))
    ok = [r[1] for r in rows if r[1]]
    a = np.array(ok)
    print(f"== {name}: 轮廓中心 x {a[:,0].min():.0f}~{a[:,0].max():.0f}  y {a[:,1].min():.0f}~{a[:,1].max():.0f} | 左缘 {a[:,2].min():.0f}~{a[:,2].max():.0f} 右缘 {a[:,3].min():.0f}~{a[:,3].max():.0f} 顶 {a[:,4].min():.0f}~{a[:,4].max():.0f} 底 {a[:,5].min():.0f}~{a[:,5].max():.0f} | 相邻取样帧的平均差 {np.mean(diffs):.2f}（最大 {np.max(diffs):.2f}）| 贴边: 左 {int(a[:,2].min()<=2)} 右 {int(a[:,3].max()>=x1-x0-3)} 顶 {int(a[:,4].min()<=2)} 底 {int(a[:,5].max()>=h-3)}")
    print("   逐帧(帧号:中心x,中心y,顶,底,青色中心x,y): " + "  ".join(f"{i}:{v[0]:.0f},{v[1]:.0f},{v[4]:.0f},{v[5]:.0f},{v[7]:.0f},{v[8]:.0f}" for i, v in rows if v))
