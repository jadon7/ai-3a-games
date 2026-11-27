"""赫达 B（w-gh）：从路子一的建模图 hedda-p1-sheet-v2.png 里去掉背上的熔炉和烟囱，存成 Tripo 用的 ref.png（炉子另用脚本建，见 gear.py 的 make_forge）。

为什么去掉（和第九轮 art/hero/hedda/make_ref.py 一样的理由）：
  · 炉子是一大块硬东西，要整个只蒙在 Spine2 上才不会跟着手臂、肩膀变形；Tripo 把它和身体出成一整块网格的话分不开，自动绑骨会把炉子分给肩膀和手臂。
  · 正面图里炉子只露出一圈边，Tripo 猜不出背面，出来多半是一块和后背焊在一起的东西。
  · 游戏代码按“炉子蒙在 Spine2 上、炉膛在脊柱后面约半米”找炉口（heroes/hedda.ts 的 furnace()），脚本建的炉子位置可控。

做法：不用 GrabCut（第九轮用了，要手画十几个多边形），改成“颜色 + 几个区域”：
  · 炉子是深钢蓝（B 比 R 高 10–30），人身上挨着炉子的颜色都偏暖（灰白头发 B−R 约 −16、皮肤 −88、衬衫米白、皮带棕），按颜色就分得开；
    唯一同色的是脖子上的铁项圈，用一个框把它排除。
  · 炉子的黑色勾线（亮度 < 50 且不偏暖）也算炉子；炉子圈住的小洞（炉门的火光、铆钉、高光）填进来。
  · 左边炉门的橙色光晕染到了灰底上：这一块（前臂和围裙之间）整块换回灰底。
  · 右腰皮带后面露出的一条炉身：换成皮带的深棕（换成灰底会在皮带和围裙之间开一道缝，Tripo 会把皮带出成一条悬空的带子）。
用法: python3.14 art/style_b/hedda/make_ref.py <输出 ref.png> [调试图]
"""
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SRC = "/Users/jadon7/Documents/SynologyDrive/code/moba/art/style_b/concept/hedda-p1-sheet-v2.png"
out = sys.argv[1]; dbg = sys.argv[2] if len(sys.argv) > 2 else None
im = Image.open(SRC).convert("RGB"); A = np.asarray(im).astype(np.int32); H, W = A.shape[:2]
r, g, b = A[..., 0], A[..., 1], A[..., 2]; L = 0.3 * r + 0.55 * g + 0.15 * b
BG = np.array([125, 121, 122])


def poly(pts):
    m = Image.new("L", (W, H), 0); ImageDraw.Draw(m).polygon(pts, fill=255); return np.asarray(m) > 0


# 炉子可能出现的地方：头的两边和上面（烟囱）、左腰（炉身和炉门）、右腰一条
zone = poly([(600, 140), (1220, 140), (1220, 575), (1150, 575), (1150, 1130), (1060, 1130), (1060, 880), (1010, 560), (775, 560), (720, 640), (720, 1200), (560, 1200), (560, 575), (600, 575)])
def ellipse(cx, cy, rx, ry):
    m = Image.new("L", (W, H), 0); ImageDraw.Draw(m).ellipse((cx - rx, cy - ry, cx + rx, cy + ry), fill=255); return np.asarray(m) > 0
collar = ellipse(893, 550, 119, 79)                                                  # 铁项圈：和炉子同色，排除
zone &= ~collar
forge = zone & (((b - r) >= 4) & (L < 205) | ((L < 50) & ((b - r) >= -3)))
# 去掉零星的点，再把炉子圈住的小洞（火光、铆钉、高光）填上
fm = Image.fromarray((forge * 255).astype(np.uint8)).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(3))
forge = np.asarray(fm) > 0
inv = ~forge; seen = np.zeros_like(inv)
from collections import deque
lab = np.zeros((H, W), np.int32); cur = 0; sizes = {}
# 连通块（非炉子的部分）：小于 6000 像素、而且整个落在 zone 里的块是炉子上的洞
ys, xs = np.nonzero(inv & zone)
visited = np.zeros((H, W), bool)
for y0, x0 in zip(ys[::1], xs[::1]):
    if visited[y0, x0]: continue
    q = deque([(y0, x0)]); visited[y0, x0] = True; pix = []; inside = True
    while q:
        y, x = q.popleft(); pix.append((y, x))
        if not zone[y, x]: inside = False
        if len(pix) > 6000: inside = False
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            yy, xx = y + dy, x + dx
            if 0 <= yy < H and 0 <= xx < W and inv[yy, xx] and not visited[yy, xx]:
                visited[yy, xx] = True; q.append((yy, xx))
        if not inside and len(pix) > 6000: break
    if inside and len(pix) <= 6000:
        for y, x in pix: forge[y, x] = True
# 炉子外沿的勾线：抗锯齿的那一两圈是勾线和灰底的混色（中性灰，B−R 在 0 上下），上面的颜色规则抓不到，会留下一圈淡淡的炉子轮廓。
# 往外长 6 像素，只吃不偏暖的像素（头发、皮肤、衬衫、皮带都偏暖，B−R 在 −15 以下）
near = np.asarray(Image.fromarray((forge * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(13))) > 0
forge |= near & zone & ((b - r) >= -5)
# 左边炉门和它的光晕：前臂外沿和围裙之间整块回到灰底（这一块里除了炉子就是被染橙的灰底）
halo = poly([(566, 872), (686, 880), (690, 960), (682, 1040), (668, 1085), (645, 1140), (628, 1186), (498, 1186), (498, 1012), (532, 958)])      # 右边沿着围裙的勾线：炉门和下半截炉身被火光染暖了，按颜色分不出来，整块去掉
forge |= halo
# 右腰：皮带后面那条炉身换成皮带的深棕，不挖空
right = poly([(1060, 880), (1125, 880), (1125, 1125), (1060, 1125)]) & forge
forge &= ~right

alpha = np.asarray(Image.fromarray((forge * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))).astype(np.float32)[..., None] / 255
ra = np.asarray(Image.fromarray((right * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))).astype(np.float32)[..., None] / 255
o = A * (1 - alpha) + BG * alpha
o = o * (1 - ra) + np.array([62, 40, 36]) * ra
Image.fromarray(np.clip(o, 0, 255).astype(np.uint8)).save(out)
print("REF", out, "炉子像素", int(forge.sum()), "右腰换色", int(right.sum()))
if dbg:
    v = A.copy(); v[forge] = (v[forge] * 0.35 + np.array([230, 30, 30]) * 0.65).astype(np.int32); v[right] = (v[right] * 0.35 + np.array([30, 200, 30]) * 0.65).astype(np.int32)
    Image.fromarray(v.astype(np.uint8)).crop((450, 100, 1300, 1300)).save(dbg)
