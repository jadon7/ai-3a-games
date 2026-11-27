# 把一张「俯视布局图」（按固定配色画的平面图，比如让 AI 生图生成的）转成游戏能直接搭的地图数据（JSON）。
#
# 配色（和生图时给的规范一致）：白 = 实心 / 走不进去；石板蓝 = 地面；橄榄绿 = 高台（+3.2 m）；深蓝 = 下沉区（−3.2 m）；
# 黄 = 楼梯 / 坡道；浅灰小块 = 掩体；橙色细框 = A 点；品红细框 = B 点；亮绿 = 进攻方出生区；红 = 防守方出生区。
#
# 输出：
#   lvl：每 0.5 m 一格的地面高度类别（0 无 / 1 地面 / 2 高台 / 3 下沉），行程编码
#   tag：每格的标记（0 无 / 1 A 点 / 2 B 点 / 3 进攻方出生区 / 4 防守方出生区），行程编码
#   sol：每格是不是实心（墙体底下），行程编码
#   solids：实心区域的多边形（外轮廓 + 洞），世界坐标，用来挤出成墙体
#   covers / stairs：掩体和楼梯的旋转矩形（中心、长宽、角度）
#   sites / spawns：两个点位和两个出生区的中心、范围
# 用法：python3 tools/layout2map.py 布局图.png 输出.json [--size 135] [--preview 预览.png]
import sys, json, math
import numpy as np
import cv2

args = sys.argv[1:]
src, out = args[0], args[1]
SIZE = float(args[args.index('--size') + 1]) if '--size' in args else 135.0   # 地图最长边多少米
PREVIEW = args[args.index('--preview') + 1] if '--preview' in args else None
CS = 0.5

PAL = {  # 类别 → RGB
    'white': (255, 255, 255), 'ground': (0x4F, 0x6B, 0x78), 'high': (0x6E, 0x7F, 0x4A), 'low': (0x22, 0x31, 0x3F), 'stair': (0xF4, 0xC5, 0x42),
    'cover': (0xB4, 0xB4, 0xB4), 'siteA': (0xFF, 0x7A, 0x00), 'siteB': (0xE0, 0x39, 0x9B), 'spawnA': (0x35, 0xC7, 0x4A), 'spawnD': (0xE5, 0x39, 0x35),
}
NAMES = list(PAL.keys()); IDX = {n: i for i, n in enumerate(NAMES)}
img = cv2.cvtColor(cv2.imread(src, cv2.IMREAD_COLOR), cv2.COLOR_BGR2RGB).astype(np.float32)
H, W = img.shape[:2]
pal = np.array([PAL[n] for n in NAMES], np.float32)
# 逐像素找最近的配色
d = ((img[:, :, None, :] - pal[None, None, :, :]) ** 2).sum(-1)
cls = d.argmin(-1).astype(np.uint8)
# 线框（A/B 点）以外的类别做一次小的开闭运算，去掉抗锯齿留下的杂点
def mask(n): return (cls == IDX[n]).astype(np.uint8)
k3 = np.ones((3, 3), np.uint8)
walk = (cls != IDX['white']).astype(np.uint8)
walk = cv2.morphologyEx(walk, cv2.MORPH_CLOSE, k3); walk = cv2.morphologyEx(walk, cv2.MORPH_OPEN, k3)
# 去掉很小的孤立可走块（< 0.4% 面积的碎片），只留最大的连通区和够大的块
n, lab, stats, _ = cv2.connectedComponentsWithStats(walk, 8)
keep = np.zeros(n, bool)
if n > 1:
    big = stats[1:, cv2.CC_STAT_AREA].max()
    for i in range(1, n): keep[i] = stats[i, cv2.CC_STAT_AREA] >= max(400, big * 0.004)
walk = keep[lab].astype(np.uint8)
# 实心里很小的洞（可走区里的白色斑点）填掉
inv = 1 - walk; n2, lab2, st2, _ = cv2.connectedComponentsWithStats(inv, 4)
for i in range(1, n2):
    if st2[i, cv2.CC_STAT_AREA] < 60: walk[lab2 == i] = 1
ys, xs = np.nonzero(walk); bx0, bx1, by0, by1 = xs.min(), xs.max(), ys.min(), ys.max()
mpp = SIZE / max(bx1 - bx0, by1 - by0)          # 每像素多少米
cxp, cyp = (bx0 + bx1) / 2, (by0 + by1) / 2     # 图上中心 → 世界原点；图的上方 = 北（−z）
toW = lambda px, py: [round((px - cxp) * mpp, 3), round((py - cyp) * mpp, 3)]

# ---------- 点位线框：把线框围住的区域填满 ----------
def fill_outline(name):
    m = cv2.morphologyEx(mask(name), cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cs: return np.zeros_like(m), None
    c = max(cs, key=cv2.contourArea); f = np.zeros_like(m); cv2.fillPoly(f, [c], 1)
    x, y, w, h = cv2.boundingRect(c); return f, (x, y, w, h)
siteA, rA = fill_outline('siteA'); siteB, rB = fill_outline('siteB')
def solid_region(m):   # 出生区里的掩体会在色块上开洞：取外轮廓填实
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, k3); cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE); f = np.zeros_like(m)
    for c in cs:
        if cv2.contourArea(c) > 200: cv2.fillPoly(f, [c], 1)
    return f
spA = solid_region(mask('spawnA')); spD = solid_region(mask('spawnD'))

# ---------- 每个像素的地面高度类别：地面 / 高台 / 下沉；楼梯、掩体、线框、出生区取周围地面的类别 ----------
lv = np.zeros((H, W), np.uint8)   # 0 无，1 地面，2 高台，3 下沉
lv[cls == IDX['ground']] = 1; lv[cls == IDX['high']] = 2; lv[cls == IDX['low']] = 3
lv[(cls == IDX['spawnA']) | (cls == IDX['spawnD'])] = 1
# 其余可走像素（楼梯、掩体、线框、杂色）：用最近的有类别的像素填（反复膨胀）
need = (walk == 1) & (lv == 0)
for _ in range(40):
    if not need.any(): break
    for v in (1, 2, 3):
        dil = cv2.dilate((lv == v).astype(np.uint8), k3).astype(bool)
        sel = need & dil; lv[sel] = v; need &= ~sel
lv[need] = 1; lv[walk == 0] = 0

# ---------- 掩体、楼梯：旋转矩形 ----------
def rects(name, min_area, max_area_frac=0.02, close=0):
    m = mask(name) & walk; m = cv2.morphologyEx(m, cv2.MORPH_OPEN, k3)
    if close: m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((close, close), np.uint8))   # 楼梯被点位线框压断时缝起来
    cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE); out = []
    for c in cs:
        a = cv2.contourArea(c)
        if a < min_area or a > W * H * max_area_frac: continue
        (x, y), (w, h), ang = cv2.minAreaRect(c)
        cx, cz = toW(x, y); out.append({'cx': cx, 'cz': cz, 'sx': round(w * mpp, 3), 'sz': round(h * mpp, 3), 'ang': round(-math.radians(ang), 4)})
    return out
covers = rects('cover', 30); stairs = rects('stair', 40, 0.05, 11)

# ---------- 实心区域 → 多边形（外轮廓 + 洞），简化到 ~0.2 m ----------
sol = (1 - walk).astype(np.uint8)
# 外围：和图片边缘连着的那一大片白色不整块做成实心，只留贴着可走区域的一圈（BAND 米厚）当外墙，再往外是沙地
BAND = float(args[args.index('--band') + 1]) if '--band' in args else 6.0
ff = sol.copy(); ffm = np.zeros((H + 2, W + 2), np.uint8); outer = np.zeros_like(sol)
for (sx, sy) in [(0, 0), (W - 1, 0), (0, H - 1), (W - 1, H - 1)]:
    if ff[sy, sx] == 1: cv2.floodFill(ff, ffm, (sx, sy), 2)
outer[ff == 2] = 1
r = max(1, int(round(BAND / mpp))); dil = cv2.dilate(walk, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1)))
sol = (((outer == 1) & (dil == 1)) | ((sol == 1) & (outer == 0))).astype(np.uint8)
outside = ((outer == 1) & (dil == 0)).astype(np.uint8)
cs, hier = cv2.findContours(sol, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
eps = max(1.0, 0.18 / mpp)
solids = []
if hier is not None:
    hier = hier[0]
    for i, c in enumerate(cs):
        if hier[i][3] != -1: continue   # 洞在下面跟着外轮廓一起处理
        if cv2.contourArea(c) < (1.2 / mpp) ** 2: continue
        outer = [toW(p[0][0], p[0][1]) for p in cv2.approxPolyDP(c, eps, True)]
        holes = []; j = hier[i][2]
        while j != -1:
            hc = cs[j]
            if cv2.contourArea(hc) > (1.2 / mpp) ** 2: holes.append([toW(p[0][0], p[0][1]) for p in cv2.approxPolyDP(hc, eps, True)])
            j = hier[j][0]
        x, y, w, h = cv2.boundingRect(c); border = x <= 1 or y <= 1 or x + w >= W - 1 or y + h >= H - 1
        solids.append({'outer': outer, 'holes': holes, 'border': bool(border), 'area': round(cv2.contourArea(c) * mpp * mpp, 1)})

# ---------- 栅格（0.5 m）：多数表决 ----------
gx0, gz0 = toW(bx0, by0); gx1, gz1 = toW(bx1, by1)
gx0, gz0 = math.floor(gx0 / CS) * CS - BAND - 3, math.floor(gz0 / CS) * CS - BAND - 3; gx1, gz1 = math.ceil(gx1 / CS) * CS + BAND + 3, math.ceil(gz1 / CS) * CS + BAND + 3
GW, GH = int(round((gx1 - gx0) / CS)), int(round((gz1 - gz0) / CS))
def sample(arr, fn, empty=0):
    g = np.zeros((GH, GW), np.uint8)
    for j in range(GH):
        for i in range(GW):
            x0 = (gx0 + i * CS) / mpp + cxp; y0 = (gz0 + j * CS) / mpp + cyp; x1 = x0 + CS / mpp; y1 = y0 + CS / mpp
            ya, yb, xa, xb = max(0, int(y0)), min(H, max(0, int(math.ceil(y1)))), max(0, int(x0)), min(W, max(0, int(math.ceil(x1))))   # 超出图片的格子：下标夹到 0，别让负数下标绕回去
            a = arr[ya:yb, xa:xb] if yb > ya and xb > xa else arr[0:0, 0:0]
            g[j, i] = fn(a) if a.size else empty
    return g
def major(a): v = np.bincount(a.ravel(), minlength=4); return int(v.argmax()) if v[1:].sum() * 2 >= a.size else 0
glv = sample(lv, major)
tagpx = np.zeros((H, W), np.uint8); tagpx[siteA == 1] = 1; tagpx[siteB == 1] = 2; tagpx[spA == 1] = 3; tagpx[spD == 1] = 4
def tagmajor(a): v = np.bincount(a.ravel(), minlength=5); v[0] = 0; return int(v.argmax()) if v.max() * 2 >= a.size else 0
gtag = sample(tagpx, tagmajor)
gsol = sample(sol, lambda a: 1 if a.mean() > 0.5 else 0)
gout = sample(outside, lambda a: 1 if a.mean() > 0.5 else 0, 1)   # 图片外面的格子也算镇外（铺沙地）
# 行程编码："值x长度" 用逗号隔开
def rle(g):
    f = g.ravel(); out = []; i = 0
    while i < len(f):
        j = i
        while j < len(f) and f[j] == f[i]: j += 1
        out.append(f'{f[i]}x{j - i}'); i = j
    return ','.join(out)
def region(m, r):
    if r is None: return None
    ys, xs = np.nonzero(m); x, z = toW(xs.mean(), ys.mean()); x0, z0 = toW(r[0], r[1]); x1, z1 = toW(r[0] + r[2], r[1] + r[3])
    return {'x': x, 'z': z, 'r': round(max(x1 - x0, z1 - z0) / 2, 2), 'box': [x0, z0, x1, z1]}
def sp(m):
    if m.sum() < 50: return None
    ys, xs = np.nonzero(m); x, z = toW(xs.mean(), ys.mean()); x0, z0 = toW(xs.min(), ys.min()); x1, z1 = toW(xs.max(), ys.max())
    return {'x': x, 'z': z, 'box': [x0, z0, x1, z1]}
import os
LB = src.rsplit('.', 1)[0] + '.labels.json'; names = []
if os.path.exists(LB):
    for n in json.load(open(LB)): x, z = toW(n['px'], n['py']); names.append({'text': n['text'], 'x': x, 'z': z})
data = {'names': names, 'src': src.split('/')[-1], 'mpp': round(mpp, 5), 'cs': CS, 'x0': gx0, 'z0': gz0, 'w': GW, 'h': GH,
        'lvl': rle(glv), 'tag': rle(gtag), 'sol': rle(gsol), 'out': rle(gout), 'solids': solids, 'covers': covers, 'stairs': stairs,
        'sites': {'A': region(siteA, rA), 'B': region(siteB, rB)}, 'spawns': {'att': sp(spA), 'def': sp(spD)}}
json.dump(data, open(out, 'w'), ensure_ascii=False, separators=(',', ':'))
print(json.dumps({'grid': [GW, GH], 'mpp': round(mpp, 4), 'extent_m': [round((bx1 - bx0) * mpp, 1), round((by1 - by0) * mpp, 1)], 'solids': len(solids), 'covers': len(covers), 'stairs': len(stairs),
                  'levels': {k: int((glv == v).sum()) for k, v in (('ground', 1), ('high', 2), ('low', 3))}, 'sites': {k: (v and {'x': v['x'], 'z': v['z'], 'r': v['r']}) for k, v in data['sites'].items()},
                  'spawns': {k: (v and {'x': v['x'], 'z': v['z']}) for k, v in data['spawns'].items()}}, ensure_ascii=False))
if PREVIEW:
    col = {0: (255, 255, 255), 1: PAL['ground'], 2: PAL['high'], 3: PAL['low']}
    pv = np.zeros((GH, GW, 3), np.uint8)
    for v, c in col.items(): pv[glv == v] = c
    pv[gtag == 1] = (255, 160, 60); pv[gtag == 2] = (230, 90, 170); pv[gtag == 3] = (80, 220, 90); pv[gtag == 4] = (230, 70, 60)
    pv = cv2.resize(pv, (GW * 3, GH * 3), interpolation=cv2.INTER_NEAREST)
    s = 3 / CS
    for so in solids:
        pts = np.array([[(x - gx0) * s, (z - gz0) * s] for x, z in so['outer']], np.int32); cv2.polylines(pv, [pts], True, (40, 40, 40), 1)
    for r in covers + stairs:
        box = cv2.boxPoints((((r['cx'] - gx0) * s, (r['cz'] - gz0) * s), (r['sx'] * s, r['sz'] * s), -math.degrees(r['ang'])))
        cv2.polylines(pv, [box.astype(np.int32)], True, (200, 200, 200) if r in covers else (244, 197, 66), 2)
    cv2.imwrite(PREVIEW, cv2.cvtColor(pv, cv2.COLOR_RGB2BGR))
