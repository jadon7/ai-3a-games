"""从建模图 art/hero_iti/concept/iti-a-sheet.png 抠掉围巾的两条长飘带（只留脖子上那一圈），裁成 Tripo 用的 art/hero_iti/ref.png。

为什么抠：飘带交给 Tripo 会被烤成一块硬布，蒙皮跟着胯和腿走，跑起来飘不起来；飘带改在游戏里用代码做（src/map/hero/scarf.ts）。
照第九轮赫达抠炉子的做法（art/hero/hedda/make_ref.py），但这里简单得多：飘带是一整片饱和的绯红到品红，按颜色就能认出来。
做法：
  1. 颜色认出“围巾”：色相在品红到红（OpenCV 的 H ≥ 140 或 ≤ 3）、饱和度 ≥ 120（肤色的饱和度不到 100，不会被认成围巾）。
  2. 脖子上那一圈（围脖）在一个手量的多边形里，多边形里的围巾留着；外面的围巾就是飘带，去掉。
  3. 去掉以后，飘带的赤金细边、描边线和一点阴影会剩成一些不连着身体的碎块和贴在身体边上的细丝：只留和身体连着的最大一块，再开运算去掉细丝。
  4. 去掉的地方填成灰底，人居中裁成正方形、四周留白，1536×1536。
用法（worktree 根目录）: $PY art/hero_iti/make_ref.py [调试输出目录]
"""
import sys, os
import numpy as np, cv2

HERE = os.path.dirname(os.path.abspath(__file__))
MAIN = "/Users/jadon7/Documents/SynologyDrive/code/moba"                     # 设定图不进 git，只在主目录有
src = cv2.imread(os.path.join(MAIN, "art/hero_iti/concept/iti-a-sheet.png"))
H, W = src.shape[:2]
dbg = sys.argv[1] if len(sys.argv) > 1 else None
BG = np.array([133, 133, 133], np.float32)                                    # 灰底（四角量的 132–135）

hsv = cv2.cvtColor(src, cv2.COLOR_BGR2HSV); h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
scarf = ((h >= 140) | (h <= 3)) & (s >= 120) & (v >= 40)      # 量过：围巾 H 165–175、S 180–205；肤色 H 5–10、S 73–94；胸甲高光 H 150、S 45–69
# 围脖（原图坐标，照 50 像素的网格量的）：上到下巴，下沿压在胸甲上沿，两边到肩头
WRAP = np.array([(690, 440), (1110, 440), (1115, 640), (1062, 690), (1000, 712), (900, 722), (800, 712), (745, 690), (695, 640)], np.int32)
keep = np.zeros((H, W), np.uint8); cv2.fillPoly(keep, [WRAP], 1)
keep[:440] = 1                                                                # 头上的（眼睛是红的）一律不动
keep[990:1130, 830:980] = 1                                                   # 腰带扣的火焰纹也是红的
tail = scarf & (keep == 0)
# 胯甲、护臂的玫瑰金包边也是这个色相，而且是细线：先开运算只留成片的飘带（飘带最窄处也有二三十像素），再往外扩 3 像素吃掉飘带的边
tail = cv2.morphologyEx(tail.astype(np.uint8), cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (11, 11)))
tail = cv2.dilate(tail, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))) > 0
# 飘带的暗面（夹在胯甲外侧、膝盖旁边的几道暗红细条）：H 165–174、S 70–117、V 55–90；腿甲 H 138–159、S 48–64；手的暗部 H 0–3（所以不收 H ≤ 3）。
# 胸甲、腰封、大腿内侧的阴影也是这一类颜色（试过全身都收，胸侧和大腿被啃出缺口），所以只收两块胯甲外侧那一条（原图坐标手量）里紧挨着飘带的
dark = (h >= 162) & (s >= 65) & (v < 120) & (keep == 0)
band = np.zeros((H, W), bool); band[1080:1420, :665] = True; band[1080:1420, 1125:] = True; dark &= band
tail |= dark & (cv2.dilate(tail.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (37, 37))) > 0)
fg = (np.linalg.norm(src.astype(np.float32) - BG, axis=2) >= 12) & ~tail
fg = fg.astype(np.uint8) * 255
fg[1650:1960, 860:990] = 0; fg[1688:1792, 985:1018] = 0; fg[1712:1758, 1012:1037] = 0                                                  # 右边那条飘带火舌尖的赤金细边，勾在左膝外侧（两腿之间，手量的框，框里没有腿）
n, lab, st, _ = cv2.connectedComponentsWithStats(fg, 8)
big = 1 + np.argmax(st[1:, cv2.CC_STAT_AREA]); fg = np.where(lab == big, 255, 0).astype(np.uint8)
fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))       # 贴在胳膊、身子边上的飘带描边细丝
n, lab, st, _ = cv2.connectedComponentsWithStats(fg, 8)
big = 1 + np.argmax(st[1:, cv2.CC_STAT_AREA]); fg = np.where(lab == big, 255, 0).astype(np.uint8)
inv = 255 - fg; n, lab, st, _ = cv2.connectedComponentsWithStats(inv, 8)       # 身体里面的小洞（深色描边夹着的缝）填回去
for i in range(1, n):
    if st[i, cv2.CC_STAT_AREA] < 1500: fg[lab == i] = 255
alpha = cv2.GaussianBlur(fg, (5, 5), 0).astype(np.float32)[..., None] / 255.0
out = (src.astype(np.float32) * alpha + BG * (1 - alpha)).astype(np.uint8)

if dbg:
    os.makedirs(dbg, exist_ok=True)
    vis = src.copy(); vis[fg == 0] = (vis[fg == 0] * 0.35 + np.array([200, 0, 0]) * 0.65).astype(np.uint8)
    cv2.polylines(vis, [WRAP], True, (0, 255, 0), 2)
    cv2.imwrite(os.path.join(dbg, "seg_vis.jpg"), cv2.resize(vis, (W // 2, H // 2)))
    cv2.imwrite(os.path.join(dbg, "noscarf_full.jpg"), cv2.resize(out, (W // 2, H // 2)))

ys, xs = np.where(fg > 0); y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
side = int(max(y1 - y0, x1 - x0) * 1.12); cy = (y0 + y1) // 2; cx = (x0 + x1) // 2
canvas = np.full((side, side, 3), BG.astype(np.uint8), np.uint8)
sy0 = cy - side // 2; sx0 = cx - side // 2
ys0 = max(0, sy0); ys1 = min(H, sy0 + side); xs0 = max(0, sx0); xs1 = min(W, sx0 + side)
canvas[ys0 - sy0:ys1 - sy0, xs0 - sx0:xs1 - sx0] = out[ys0:ys1, xs0:xs1]
canvas = cv2.resize(canvas, (1536, 1536), interpolation=cv2.INTER_AREA)
dst = os.path.join(HERE, "ref.png"); cv2.imwrite(dst, canvas)
print("ref", dst, "bbox", (int(x0), int(y0), int(x1), int(y1)), "side", side, "tail px", int(tail.sum()))
