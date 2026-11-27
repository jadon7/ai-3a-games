"""从建模图 h8-hedda-sheet-b.png 里去掉背上的熔炉和烟囱（炉子另用脚本建），裁成 Tripo 用的 ref.png。
做法：GrabCut 分割。确定是背景的：灰底 + 手画的几块“肯定是炉子”的区域；确定是人的：脸、发髻、项圈、躯干。
炉子去掉的地方填成灰底。用法: PY art/hero/hedda/make_ref.py [调试输出目录]
"""
import sys, os
import numpy as np, cv2

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
src = cv2.imread(os.path.join(ROOT, "concepts/heroes/h8-hedda-sheet-b.png"))
H, W = src.shape[:2]
dbg = sys.argv[1] if len(sys.argv) > 1 else None
BG = np.array([109, 108, 110], np.float32)       # BGR，灰底

dist = np.linalg.norm(src.astype(np.float32) - BG, axis=2)
mask = np.full((H, W), cv2.GC_PR_FGD, np.uint8)
mask[dist < 9] = cv2.GC_PR_BGD

def poly(pts, val, off=(600, 100)):
    p = np.array([(x + off[0], y + off[1]) for x, y in pts], np.int32)
    cv2.fillPoly(mask, [p], int(val))

# ---- 肯定是炉子的（坐标是在 crop_head 里量的，偏移 600,100） ----
poly([(440, 45), (600, 50), (600, 105), (548, 305), (432, 295), (466, 100)], cv2.GC_BGD)       # 烟囱
poly([(25, 250), (178, 250), (178, 380), (168, 455), (25, 470)], cv2.GC_BGD)                    # 头左边的炉身
poly([(196, 236), (196, 250), (60, 250), (75, 238)], cv2.GC_BGD)                                  # 炉顶左
poly([(425, 275), (560, 290), (560, 470), (418, 460), (418, 330)], cv2.GC_BGD)                   # 头右边的炉身
poly([(400, 240), (440, 240), (432, 275), (408, 262)], cv2.GC_BGD)                               # 烟囱根和头之间
# 腰两侧露出来的炉身（原图坐标，照着 20 像素的网格量的；左边沿着胳膊内侧和围裙的边）
SIDE_L = [(592, 862), (612, 846), (655, 845), (672, 880), (682, 1000), (676, 1090), (662, 1100), (652, 1170), (566, 1170), (566, 1098), (588, 1088), (588, 875)]
SIDE_R = [(1090, 870), (1135, 850), (1178, 858), (1178, 928), (1152, 932), (1152, 1100), (1142, 1116), (1110, 1112), (1096, 1080), (1092, 1000)]
poly(SIDE_L, cv2.GC_BGD, (0, 0))
poly(SIDE_R, cv2.GC_BGD, (0, 0))

# ---- 肯定是人的 ----
cv2.ellipse(mask, (900, 385), (80, 115), 0, 0, 360, int(cv2.GC_FGD), -1)                         # 脸
poly([(255, 105), (345, 105), (380, 190), (220, 190)], cv2.GC_FGD)                               # 发髻、头顶
poly([(205, 175), (395, 175), (395, 240), (205, 240)], cv2.GC_FGD)                               # 护目镜
poly([(195, 395), (405, 395), (410, 490), (190, 490)], cv2.GC_FGD)                               # 项圈
poly([(240, 330), (360, 330), (365, 400), (235, 400)], cv2.GC_FGD)                               # 脖子
mask[600:, :][dist[600:, :] >= 30] = cv2.GC_FGD                                                  # 肩膀以下，明显不是灰底的先当人（腰两侧的炉子上面已经标成背景，下面再改回去）
poly(SIDE_L, cv2.GC_BGD, (0, 0))
poly(SIDE_R, cv2.GC_BGD, (0, 0))

bgd = np.zeros((1, 65), np.float64); fgd = np.zeros((1, 65), np.float64)
cv2.grabCut(src, mask, None, bgd, fgd, 6, cv2.GC_INIT_WITH_MASK)
fg = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
# 只留和身体连着的最大一块，填掉小洞
n, lab, st, _ = cv2.connectedComponentsWithStats(fg, 8)
big = 1 + np.argmax(st[1:, cv2.CC_STAT_AREA]); fg = np.where(lab == big, 255, 0).astype(np.uint8)
inv = 255 - fg; n, lab, st, _ = cv2.connectedComponentsWithStats(inv, 8)
for i in range(1, n):
    if st[i, cv2.CC_STAT_AREA] < 4000: fg[lab == i] = 255
fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
for pts in (SIDE_L, SIDE_R): cv2.fillPoly(fg, [np.array(pts, np.int32)], 0)      # 两侧的炉身一律去掉，不听 GrabCut 的
alpha = cv2.GaussianBlur(fg, (5, 5), 0).astype(np.float32)[..., None] / 255.0
out = (src.astype(np.float32) * alpha + BG * (1 - alpha)).astype(np.uint8)

if dbg:
    os.makedirs(dbg, exist_ok=True)
    vis = src.copy(); vis[fg == 0] = (vis[fg == 0] * 0.35 + np.array([0, 0, 200]) * 0.65).astype(np.uint8)
    cv2.imwrite(os.path.join(dbg, "seg_vis.jpg"), vis[60:1250, 450:1350])
    cv2.imwrite(os.path.join(dbg, "nofurnace_full.png"), out)

# 裁成正方形：人居中，四周留白
ys, xs = np.where(fg > 0); y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
side = int(max(y1 - y0, x1 - x0) * 1.12); cy = (y0 + y1) // 2; cx = (x0 + x1) // 2
canvas = np.full((side, side, 3), BG.astype(np.uint8), np.uint8)
sy0 = cy - side // 2; sx0 = cx - side // 2
ys0 = max(0, sy0); ys1 = min(H, sy0 + side); xs0 = max(0, sx0); xs1 = min(W, sx0 + side)
canvas[ys0 - sy0:ys1 - sy0, xs0 - sx0:xs1 - sx0] = out[ys0:ys1, xs0:xs1]
canvas = cv2.resize(canvas, (1536, 1536), interpolation=cv2.INTER_AREA)
dst = os.path.join(ROOT, "art/hero/hedda/ref.png"); cv2.imwrite(dst, canvas)
print("ref", dst, "bbox", (x0, y0, x1, y1), "side", side)
