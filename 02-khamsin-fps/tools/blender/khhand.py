# KHAMSIN 第一人称手臂：
#   手骨比例 → 手指逐节弯曲直到贴上握把截面 → 所有体块体素熔合成一整只手套（指根、虎口不再有接缝）
#   → 贴合表面的 TPR 护垫、指侧缝线、腕带 → 带褶皱的袖子 → 左前臂钩索发射器
# 解剖坐标系 A（右手）：+X 尺侧（小指一侧），+Y 指尖方向，+Z 手背；握持坐标系 G：+x 枪右，+y 前，+z 沿握把向上
import bpy, bmesh, math
from mathutils import Vector, Matrix, noise
from mathutils.bvhtree import BVHTree
from khlib import *

AX = Vector((1, 0, 0)); AY = Vector((0, 1, 0)); AZ = Vector((0, 0, 1))
FINGERS = (   # 掌指关节位置，三节指骨长度，半宽，半厚（含手套）
    ('index', (-0.0276, 0.0880, -0.0015), (0.046, 0.026, 0.0235), 0.0090, 0.0088),
    ('middle', (-0.0072, 0.0920, 0.0005), (0.050, 0.030, 0.0245), 0.0092, 0.0090),
    ('ring', (0.0130, 0.0875, -0.0015), (0.046, 0.028, 0.0235), 0.0089, 0.0087),
    ('pinky', (0.0318, 0.0780, -0.0055), (0.036, 0.021, 0.0215), 0.0080, 0.0079),
)
TAPER = (1.0, 0.94, 0.87, 0.80)
PALM = (   # y，半宽，半厚，中心 x，中心 z
    (-0.048, 0.0300, 0.0222, 0.0010, -0.0020), (-0.012, 0.0306, 0.0212, 0.0010, -0.0022), (0.012, 0.0368, 0.0204, 0.0008, -0.0030),
    (0.040, 0.0428, 0.0182, 0.0012, -0.0034), (0.066, 0.0446, 0.0158, 0.0016, -0.0024), (0.084, 0.0432, 0.0138, 0.0018, -0.0016),
)


def smooth01(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a))); return t * t * (3 - 2 * t)


def ellipsoid(c, ax, ay, az, ra, rb, rc, nu=12, nv=8):
    bm = bmesh.new(); c = Vector(c); top = bm.verts.new(c + az * rc); bot = bm.verts.new(c - az * rc); rings = []
    for j in range(1, nv):
        ph = math.pi * j / nv; z = math.cos(ph); r = math.sin(ph)
        rings.append([bm.verts.new(c + ax * (ra * r * math.cos(2 * math.pi * i / nu)) + ay * (rb * r * math.sin(2 * math.pi * i / nu)) + az * (rc * z)) for i in range(nu)])
    for i in range(nu):
        j = (i + 1) % nu; bm.faces.new((top, rings[0][i], rings[0][j])); bm.faces.new((bot, rings[-1][j], rings[-1][i]))
    for a, b in zip(rings[:-1], rings[1:]):
        for i in range(nu):
            j = (i + 1) % nu; bm.faces.new((a[i], b[i], b[j], a[j]))
    return bm


def pipe(pts, r, n=6):
    """沿折线扫出细管（缝线、线缆），两端封口。"""
    P = [Vector(p) for p in pts]; secs = []; up = None
    for i, p in enumerate(P):
        d = (P[min(i + 1, len(P) - 1)] - P[max(i - 1, 0)]).normalized()
        a = d.orthogonal().normalized() if up is None else (up - d * up.dot(d)).normalized()
        b = d.cross(a); up = a
        secs.append([p + a * (r * math.cos(2 * math.pi * k / n)) + b * (r * math.sin(2 * math.pi * k / n)) for k in range(n)])
    return loft(secs)


def smooth_path(P, n=3):
    P = [Vector(p) for p in P]; Q = [P[0]] + P + [P[-1]]; out = []
    for i in range(1, len(Q) - 2):
        p0, p1, p2, p3 = Q[i - 1], Q[i], Q[i + 1], Q[i + 2]
        for k in range(n):
            t = k / n; t2 = t * t; t3 = t2 * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(P[-1]); return out


def fuse(bm, voxel=0.0009, smooth=3, target=8200):
    """体素重构：把互相穿插的体块熔成一张连续的表面，再平滑、减面。"""
    me = bpy.data.meshes.new('_fuse'); bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new('_fuse', me); bpy.context.scene.collection.objects.link(ob)
    m = ob.modifiers.new('r', 'REMESH'); m.mode = 'VOXEL'; m.voxel_size = voxel; m.adaptivity = 0.0; apply_mods(ob)
    if smooth:
        m = ob.modifiers.new('s', 'SMOOTH'); m.factor = 0.5; m.iterations = smooth; apply_mods(ob)
    nv = len(ob.data.vertices)
    if target and nv > target:
        m = ob.modifiers.new('d', 'DECIMATE'); m.ratio = target / nv; apply_mods(ob)
    out = bmesh.new(); out.from_mesh(ob.data); me = ob.data; bpy.data.objects.remove(ob); bpy.data.meshes.remove(me)
    return out


# ---------------- 手指姿势 ----------------
def sd_rrect(y, z, yc, zc, hd, hw, r):
    qy = abs(y - yc) - (hd - r); qz = abs(z - zc) - (hw - r)
    return math.hypot(max(qy, 0.0), max(qz, 0.0)) + min(max(qy, qz), 0.0) - r


def solve_flex(mcp, lens, rads, sdf, lim=((6, 86), (8, 108), (5, 72)), gap=0.0004):
    """在 Y-Z 平面内逐节弯曲，直到这一节指腹贴上握把截面。返回三节各自的累计弯曲角。"""
    ang = 0.0; y, z = mcp[1], mcp[2]; out = []
    for L, (mn, mx), r in zip(lens, lim, rads):
        a = ang + rad(mx); k = float(mn)
        while k <= mx:
            t_ = ang + rad(k); c, s = math.cos(t_), -math.sin(t_)
            if min(sdf(y + c * L * u, z + s * L * u) for u in (0.3, 0.45, 0.6, 0.75, 0.9, 1.0)) - r - gap <= 0: a = t_; break
            k += 0.5
        ang = a; out.append(a); y += math.cos(a) * L; z -= math.sin(a) * L
    return out


def chain(mcp, lens, angs, yaw=0.0):
    Rz = Matrix.Rotation(yaw, 3, 'Z'); l = Rz @ AX; pts = [Vector(mcp)]; dirs = []; nrm = []
    for L, a in zip(lens, angs):
        d = Rz @ Vector((0, math.cos(a), -math.sin(a))); dirs.append(d); nrm.append(l.cross(d).normalized()); pts.append(pts[-1] + d * L)
    return dict(pts=pts, dirs=dirs, nrm=nrm, lat=[l, l, l])


def thumb_chain(cmc, dirs, lens, nail):
    pts = [Vector(cmc)]; D = []; N = []; Lt = []
    for d, L in zip(dirs, lens):
        d = Vector(d).normalized(); n = Vector(nail); n = (n - d * n.dot(d)).normalized()
        D.append(d); N.append(n); Lt.append(d.cross(n).normalized()); pts.append(pts[-1] + d * L)
    return dict(pts=pts, dirs=D, nrm=N, lat=Lt)


def digit_solid(bm, ch, w, t, taper=TAPER):
    P, D, N, Lt = ch['pts'], ch['dirs'], ch['nrm'], ch['lat']
    for i in range(3):
        k0, k1 = taper[i], taper[i + 1]
        join(bm, loft([ellipse(P[i].lerp(P[i + 1], u / 4), Lt[i], N[i], w * (k0 + (k1 - k0) * u / 4), t * (k0 + (k1 - k0) * u / 4), 14, 2.3) for u in range(5)]))
        if i > 0:   # 指关节：略鼓的椭球把前后两节接顺
            b = (D[i - 1] + D[i]).normalized(); join(bm, ellipsoid(P[i] + Lt[i].cross(b) * 0.0005, Lt[i], b, Lt[i].cross(b), w * k0 * 1.03, w * k0 * 1.02, t * k0 * 1.09))
    join(bm, ellipsoid(P[3] - D[2] * 0.0040, Lt[2], D[2], N[2], w * taper[3] * 1.0, 0.0082, t * taper[3] * 0.98))


def build_glove(grip, pose):
    """返回 A 坐标系下的整只手：熔合后的 bmesh、各指的骨架（给护垫 / 缝线定位）。"""
    hw, hd, gr, yc, face = grip; zc = face - hw
    sdf = lambda y, z: sd_rrect(y, z, yc, zc, hd, hw, gr)
    bm = bmesh.new(); digits = {}
    join(bm, loft([ellipse(Vector((cx, y, cz)), AX, AZ, a, b, 26, 2.7) for y, a, b, cx, cz in PALM]))
    for name, mcp, lens, w, t in FINGERS:
        ov = pose.get(name)
        if ov: angs = []; acc = 0.0; [angs.append(acc := acc + rad(a)) for a in ov['flex']]; yaw = rad(ov.get('yaw', 0.0))
        else: angs = solve_flex(mcp, lens, [t * k for k in TAPER[:3]], sdf); yaw = 0.0
        ch = chain(mcp, lens, angs, yaw); ch['w'] = w; ch['t'] = t; digits[name] = ch
        digit_solid(bm, ch, w, t)
        b = (AY + ch['dirs'][0]).normalized()   # 掌指关节：握拳时向手背鼓起
        join(bm, ellipsoid(Vector(mcp) + AZ * 0.0016, ch['lat'][0], b, ch['lat'][0].cross(b), w * 1.12, 0.0135, t * 1.30))
    names = [f[0] for f in FINGERS]
    for a, b in zip(names[:-1], names[1:]):   # 指蹼：填住相邻两指的指根
        ca, cb = digits[a], digits[b]; d = (ca['dirs'][0] + cb['dirs'][0]).normalized(); c = (ca['pts'][0] + cb['pts'][0]) / 2 + d * 0.013
        join(bm, ellipsoid(c, AX, d, AX.cross(d), 0.0085, 0.0125, 0.0074))
    th = thumb_chain(pose['thumb']['cmc'], pose['thumb']['dirs'], (0.044, 0.033, 0.029), pose['thumb']['nail']); th['w'] = 0.0122; th['t'] = 0.0112; digits['thumb'] = th
    digit_solid(bm, th, 0.0122, 0.0112, (1.12, 0.96, 0.90, 0.84))
    P, D, N, Lt = th['pts'], th['dirs'], th['nrm'], th['lat']
    join(bm, ellipsoid(P[0].lerp(P[1], 0.45) + AZ * -0.002, Lt[0], N[0], D[0], 0.0172, 0.0165, 0.032))      # 大鱼际
    join(bm, ellipsoid(Vector((0.0310, 0.0330, -0.0085)), AX, AZ, AY, 0.0128, 0.0135, 0.037))                 # 小鱼际
    web0 = P[0].lerp(P[1], 0.55); web1 = Vector((-0.0300, 0.0640, -0.0040)); wd = (web1 - web0).normalized(); wn = (AZ - wd * AZ.dot(wd)).normalized()
    join(bm, loft([ellipse(web0.lerp(web1, u / 4), wd.cross(wn), wn, 0.0125, 0.0068, 12, 2.2) for u in range(5)]))   # 虎口
    return fuse(bm), digits


def paint_palm(bm, digits):
    """顶点属性 tint：1 = 掌面（深色合成革），0 = 手背（织物）。"""
    lay = bm.verts.layers.float.new('tint'); segs = []
    for name, ch in digits.items():
        for i in range(3):
            segs.append((ch['pts'][i], ch['pts'][i + 1], ch['nrm'][i], ch['t'] * TAPER[i], 0.18 if (name == 'thumb' and i == 0) else 0.0))
    for v in bm.verts:
        p = v.co; best = None; bd = 1e9
        for p0, p1, n, r, tmin in segs:
            d = p1 - p0; tt = (p - p0).dot(d) / d.length_squared
            if tt <= tmin: continue
            q = p0 + d * min(1.0, tt); dist = (p - q).length - r
            if dist < bd: bd = dist; best = (q, n)
        if best and bd < 0.0028: s = (p - best[0]).dot(best[1])
        else: s = p.z + 0.0028
        v[lay] = 1.0 - smooth01(-0.0008, 0.0008, s)


def pad(bvh, c, t, b, n, hw, hh, r, th, edge=0.0010, step=0.0016, embed=0.0006, axis=None, R=0.009, drop=0.0055):
    """贴合表面的模压护垫：(t, b) 平面内的圆角矩形投到手套表面，再整体抬高 th，边缘圆滑收下去。
    axis 给出指骨轴线上的点时改用柱面投影（b 方向的距离换算成绕轴角度），护垫会包住手指而不是摊平。"""
    c = Vector(c); bm = bmesh.new(); rings = []; deltas = [0.0, edge * 0.3, edge * 0.65, edge]; d = edge; m = min(hw, hh)
    while m - d > step * 1.2: d += step; deltas.append(d)
    def proj(qx, qy, hgt):
        if axis is not None:
            ph = qy / R; dr = n * math.cos(ph) + b * math.sin(ph); o = Vector(axis) + t * qx
            h = bvh.ray_cast(o + dr * 0.0015, dr, R * 1.7)   # 从手指内部向外：只会打到这根手指自己的表面
            return (h[0] if h[0] is not None else o + dr * R * 1.12) + dr * hgt
        o = c + t * qx + b * qy; h = bvh.ray_cast(o + n * 0.025, -n, 0.06); q = h[0] if h[0] is not None else o - n * drop
        dn = (c - q).dot(n)
        if dn > drop: q = q + n * (dn - drop)   # 边缘落进指缝 / 关节沟时不跟着掉下去
        return q + n * hgt
    for dl in deltas:
        x = min(1.0, dl / edge); hgt = th * (1 - (1 - x) ** 3.0) - (embed if dl == 0 else 0)
        rings.append([bm.verts.new(proj(q.x, q.y, hgt)) for q in rrect(Vector((0, 0, 0)), X, F, hw - dl, hh - dl, max(2e-4, r - dl * 0.8), n=4)])
    top = bm.verts.new(proj(0, 0, th)); bot = bm.verts.new(proj(0, 0, -0.0030)); N = len(rings[0])
    for a, bq in zip(rings[:-1], rings[1:]):
        for i in range(N):
            j = (i + 1) % N; bm.faces.new((a[i], a[j], bq[j], bq[i]))
    for i in range(N):
        j = (i + 1) % N; bm.faces.new((rings[-1][i], rings[-1][j], top)); bm.faces.new((rings[0][j], rings[0][i], bot))
    return bm


def glove_details(bvh, digits):
    """返回 [(名字, bmesh, 材质, 倒角)]，全部在 A 坐标系。"""
    out = []
    def P(name, *a, mat='rubber', **kw): out.append((name, pad(bvh, *a, **kw), mat))
    for name, _, _, w, t in FINGERS:
        ch = digits[name]; pts, D, N, Lt = ch['pts'], ch['dirs'], ch['nrm'], ch['lat']; small = name == 'pinky'
        kt = (AY + D[0]).normalized(); kn = (AZ + N[0]).normalized()                               # 指节护块：骑在掌指关节的折弯上
        P('knuckle', pts[0] + kn * (t + 0.0035) + kt * 0.0015, kt, Lt[0], kn, 0.0100 if not small else 0.0086, w * 1.02, 0.0036, 0.0030, edge=0.0016, drop=0.0042)
        L0 = (pts[1] - pts[0]).length
        for u, hl in ((0.62, 0.0115),) if not small else ((0.64, 0.0075),):          # 近节护条
            P('fpad', pts[0] + D[0] * (L0 * u) + N[0] * (t + 0.003), D[0], Lt[0], N[0], hl, w * 0.92, 0.0026, 0.0017, axis=pts[0] + D[0] * (L0 * u), R=(w + t) * 0.5)
        L1 = (pts[2] - pts[1]).length
        if not small: P('fpad', pts[1] + D[1] * (L1 * 0.52) + N[1] * (t + 0.003), D[1], Lt[1], N[1], L1 * 0.30, w * 0.84, 0.0026, 0.0015, axis=pts[1] + D[1] * (L1 * 0.52), R=(w + t) * 0.47)
        # 指侧缝线：沿两侧走到指尖绕一圈
        side = []
        for sg in (1, -1):
            run = []
            for i in range(3):
                Ls = (pts[i + 1] - pts[i]).length
                for u in ((0.45, 0.7, 0.95) if i == 0 else (0.2, 0.5, 0.85)):
                    k = TAPER[i] + (TAPER[i + 1] - TAPER[i]) * u; q = pts[i] + D[i] * (Ls * u) + Lt[i] * (sg * w * k * 1.2)
                    hit = bvh.find_nearest(q); run.append(hit[0] if hit[0] is not None else q)
            side.append(run)
        tipc = pts[3] - D[2] * 0.0035; arc = []
        for a in (25, 55, 90, 125, 155):
            q = tipc + (Lt[2] * math.cos(rad(a)) + D[2] * math.sin(rad(a))) * 0.014; hit = bvh.find_nearest(q); arc.append(hit[0] if hit[0] is not None else q)
        out.append(('seam', pipe(smooth_path(side[0] + arc + side[1][::-1], 3), 0.00050, 5), 'dark'))
    th = digits['thumb']; pts, D, N, Lt = th['pts'], th['dirs'], th['nrm'], th['lat']
    P('tpad', pts[1] + D[1] * 0.016 + N[1] * 0.014, D[1], Lt[1], N[1], 0.0090, 0.0070, 0.003, 0.0016, axis=pts[1] + D[1] * 0.016, R=0.0112)
    P('tpad', pts[0] + D[0] * 0.030 + N[0] * 0.02, D[0], Lt[0], N[0], 0.0090, 0.0062, 0.003, 0.0016, drop=0.004)
    for i, y in enumerate((0.0300, 0.0425, 0.0550)):   # 手背三道斜向护条
        P('dorsal', Vector((0.0040 - i * 0.0016, y, 0.03)), (AX * 0.97 + AY * 0.24).normalized(), (AY * 0.97 - AX * 0.24).normalized(), AZ, 0.0215 + i * 0.0016, 0.0036, 0.0030, 0.0018)
    ring = [(-0.026, 0.016), (-0.031, 0.040), (-0.030, 0.066), (-0.016, 0.073), (0.004, 0.074), (0.022, 0.070), (0.034, 0.058), (0.036, 0.036), (0.031, 0.016)]
    out.append(('seam', pipe(smooth_path([bvh.ray_cast(Vector((x, y, 0.04)), -AZ, 0.08)[0] or Vector((x, y, 0.014)) for x, y in ring], 4), 0.00055, 5), 'dark'))
    edge = [Vector((0.0465 - 0.012 * max(0.0, (0.03 - y) / 0.03), y, -0.0030)) for y in (0.004, 0.02, 0.036, 0.052, 0.066)]   # 掌缘缝线
    out.append(('seam', pipe(smooth_path([bvh.find_nearest(q)[0] for q in edge], 3), 0.00050, 5), 'dark'))
    return out


def build_hand(K, group, M, grip, pose, mirror=False):
    """M：握持坐标系 G → 枪坐标；mirror=True 时做成左手。"""
    hw, hd, gr, yc, face = grip; zc = face - hw
    AG = Matrix(((0, 0, 1, 0), (0, 1, 0, 0), (-1, 0, 0, 0), (0, 0, 0, 1))) @ Matrix.Translation((0, -yc, -zc))
    MT = M @ (Matrix.Diagonal((-1, 1, 1, 1)) if mirror else Matrix.Identity(4)) @ AG
    def A(name, bm, mat, **kw):
        xform(bm, MT)
        if mirror: bmesh.ops.reverse_faces(bm, faces=bm.faces)
        return K.add(name, bm, mat, group, **kw)
    hand, digits = build_glove(grip, pose)
    bvh = BVHTree.FromBMesh(hand)
    det = glove_details(bvh, digits)
    paint_palm(hand, digits)
    A('glove', hand, 'gloveFab', bevel=0, sharp=180)
    for name, bm, mat in det: A(name, bm, mat, bevel=0, sharp=180 if name == 'seam' else 38)
    # 腕口：氯丁橡胶袖口 + 魔术贴腕带 + 拉环
    cz = -0.0021
    A('cuff', loft([ellipse(Vector((0.001, y, cz)), AX, AZ, a, b, 30, 2.7) for y, a, b in ((0.010, 0.0322, 0.0215), (0.004, 0.0330, 0.0228), (-0.022, 0.0326, 0.0236), (-0.034, 0.0322, 0.0236), (-0.037, 0.0300, 0.0214))]), 'dark', bevel=0, sharp=180)
    A('wstrap', loft([ellipse(Vector((0.001, y, cz)), AX, AZ, a, b, 30, 2.7) for y, a, b in ((-0.0045, 0.0318, 0.0226), (-0.0060, 0.0345, 0.0250), (-0.0235, 0.0343, 0.0252), (-0.0250, 0.0318, 0.0228))]), 'rubber', bevel=0, sharp=40)
    A('wtab', box(0.030, 0.0150, 0.0034, (0.004, -0.0148, cz + 0.0250)), 'rubber', bevel=0.0012, seg=2)
    A('wlogo', box(0.0150, 0.0080, 0.0012, (0.006, -0.0148, cz + 0.0271)), 'plate', bevel=0.0005)
    if False: A('wloop', pipe([Vector((-0.004 + 0.008 * math.cos(a), -0.050 - 0.010 * math.sin(a), cz - 0.0235)) for a in [rad(k * 20) for k in range(10)]], 0.0016, 6), 'dark', bevel=0, sharp=180)
    return MT, digits


# ---------------- 袖子 ----------------
class Sleeve:
    """前臂作战服袖管：腕口收紧，往上是斜向的压缩褶皱；束带压住的地方布料被勒紧、两侧鼓起。"""
    def __init__(self, P0, d0, P2, up, seed=1.0, n=72, seg=48, straps=(), down=Vector((0, 0, -1))):
        P0 = Vector(P0); P2 = Vector(P2); P1 = P0 + Vector(d0).normalized() * 0.062
        raw = [((1 - t) ** 2) * P0 + (2 * t * (1 - t)) * P1 + (t * t) * P2 for t in [i / 240 for i in range(241)]]
        acc = [0.0]
        for a, b in zip(raw[:-1], raw[1:]): acc.append(acc[-1] + (b - a).length)
        self.L = acc[-1]; self.n = n; self.seg = seg; self.seed = seed; self.straps = straps; self.C = []; self.T = []; self.U = []; self.S = []
        j = 0; up = Vector(up)
        for i in range(n + 1):
            s = self.L * i / n
            while j < 239 and acc[j + 1] < s: j += 1
            f = (s - acc[j]) / max(1e-9, acc[j + 1] - acc[j]); c = raw[j].lerp(raw[j + 1], f); tg = (raw[j + 1] - raw[j]).normalized()
            up = (up - tg * up.dot(tg)).normalized(); self.C.append(c); self.T.append(tg); self.U.append(up.copy()); self.S.append(tg.cross(up).normalized())
        self.down = down

    def frame(self, s):
        x = max(0.0, min(self.n - 1e-6, s / self.L * self.n)); i = int(x); f = x - i
        return self.C[i].lerp(self.C[i + 1], f), self.T[i].lerp(self.T[i + 1], f).normalized(), self.U[i].lerp(self.U[i + 1], f).normalized(), self.S[i].lerp(self.S[i + 1], f).normalized()

    def arm(self, s):   # 前臂本体的椭圆截面（半轴：侧向，背掌向）
        k = smooth01(0.0, 0.27, s)
        return 0.0312 + (0.0500 - 0.0312) * k, 0.0228 + (0.0470 - 0.0228) * k

    def base(self, s, th):
        a, b = self.arm(s); c, sn = math.cos(th), math.sin(th)
        return 1.0 / math.sqrt((c / a) ** 2 + (sn / b) ** 2)

    def cloth(self, s, th):
        loose = 0.0048 + 0.0050 * smooth01(0.030, 0.062, s)
        if s > 0.034:
            c, tg, up, sd = self.frame(s); dirv = sd * math.cos(th) + up * math.sin(th)
            q = Vector((math.cos(th) * 0.05, math.sin(th) * 0.05, s)); wob = noise.noise(q * 13 + Vector((self.seed * 7.3, 1.7, 0)))
            ph = s / 0.031 + 0.50 * math.sin(th + self.seed) + 0.85 * wob
            ridge = (0.5 + 0.5 * math.cos(2 * math.pi * ph)) ** 1.5
            env = 0.42 + 0.60 * math.exp(-((s - 0.060) / 0.036) ** 2) + 0.65 * smooth01(self.L - 0.13, self.L, s)
            fold = 0.0046 * env * (ridge - 0.30) + 0.0010 * noise.noise(q * 55 + Vector((3.1, self.seed, 9.0)))
            sag = 0.0058 * max(0.0, dirv.dot(self.down)) ** 2 * smooth01(0.04, 0.11, s)
            k = smooth01(0.034, 0.056, s); loose += (fold + sag) * k
        else:
            loose += 0.0011 * (smooth01(0.0, 0.004, s) - smooth01(0.004, 0.008, s)) + 0.0010 * smooth01(0.026, 0.030, s)   # 腕口的折边
        for sk, wk in self.straps:   # 束带勒紧
            x = (s - sk) / (wk * 0.5 + 0.004)
            if abs(x) < 3: loose = loose * (1 - 0.86 * math.exp(-x * x * 1.3)) + 0.0020 * math.exp(-((abs(x) - 1.55) ** 2) * 3.0)
        return max(0.0012, loose)

    def point(self, s, th, off=0.0, cloth=True):
        c, tg, up, sd = self.frame(s); r = self.base(s, th) + (self.cloth(s, th) if cloth else 0.0) + off
        return c + (sd * math.cos(th) + up * math.sin(th)) * r

    def mesh(self):
        secs = []
        for i in range(self.n + 1):
            s = self.L * i / self.n; secs.append([self.point(s, 2 * math.pi * k / self.seg) for k in range(self.seg)])
        return loft(secs)

    def band(self, s, width, thick, off=0.0030, seg=40):
        """绕手臂一圈的织带（压在布料上）。"""
        bm = bmesh.new(); rings = []
        for k in range(seg):
            th = 2 * math.pi * k / seg; q = []
            for ds, dr in ((-width / 2, 0.0), (-width / 2, thick), (width / 2, thick), (width / 2, 0.0)):
                q.append(bm.verts.new(self.point(s + ds, th, off + dr, cloth=False)))
            rings.append(q)
        for k in range(seg):
            a, b = rings[k], rings[(k + 1) % seg]
            for i in range(4):
                j = (i + 1) % 4; bm.faces.new((a[i], a[j], b[j], b[i]))
        return bm

    def patch(self, s, width, th0, th1, off, thick, seg=14, cloth=False):
        """贴在袖子曲面上的一块补片（角度范围 th0..th1）。"""
        bm = bmesh.new(); rows = []
        for k in range(seg + 1):
            th = th0 + (th1 - th0) * k / seg
            rows.append([bm.verts.new(self.point(s + ds, th, off + dr, cloth=cloth)) for ds, dr in ((-width / 2, 0.0), (-width / 2, thick), (width / 2, thick), (width / 2, 0.0))])
        for a, b in zip(rows[:-1], rows[1:]):
            for i in range(4):
                j = (i + 1) % 4; bm.faces.new((a[i], a[j], b[j], b[i]))
        bm.faces.new(rows[0][::-1]); bm.faces.new(rows[-1])
        return bm

    def simulate(self, pin, frames=50, loose=0.0085, grow=0.11, wide=0.025):
        """用 Blender 的布料解算做真实褶皱：袖管比手臂长 / 宽出 grow，两端和束带处钉住，多余的布料自己堆出褶子。
        pin(s, th) → 0..1：1 = 钉住并贴身。失败时返回 None（调用方退回解析褶皱）。"""
        n, seg = self.n, self.seg; bm = bmesh.new(); rings = []; w = []
        for i in range(n + 1):
            s = self.L * i / n; ring = []
            for k in range(seg):
                th = 2 * math.pi * k / seg; pk = pin(s, th)
                fr = (self.base(s, th) + loose) * (1 + wide) / (1 + grow) - self.base(s, th)   # 布料整体会长大 grow：周长先收一点，长出来后正好略宽松，长度方向多出来的堆成横褶
                ring.append(bm.verts.new(self.point(s, th, 0.0022 + (max(0.0034, fr) - 0.0022) * (1 - pk), cloth=False))); w.append(1.0 if pk > 0.93 else 0.0)
            rings.append(ring)
        for a, b in zip(rings[:-1], rings[1:]):
            for k in range(seg):
                j = (k + 1) % seg; bm.faces.new((a[k], a[j], b[j], b[k]))
        me = bpy.data.meshes.new('_cloth'); bm.to_mesh(me); bm.free(); ob = bpy.data.objects.new('_cloth', me); sc = bpy.context.scene; sc.collection.objects.link(ob)
        vg = ob.vertex_groups.new(name='pin')
        for i, x in enumerate(w):
            if x > 0: vg.add([i], 1.0, 'REPLACE')
        cm = bpy.data.meshes.new('_arm'); cb = loft([[self.point(self.L * i / 40, 2 * math.pi * k / 28, -0.0006, cloth=False) for k in range(28)] for i in range(41)]); cb.to_mesh(cm); cb.free()
        co = bpy.data.objects.new('_arm', cm); sc.collection.objects.link(co); co.modifiers.new('col', 'COLLISION'); co.collision.thickness_outer = 0.0016; co.collision.cloth_friction = 12
        m = ob.modifiers.new('cloth', 'CLOTH'); st = m.settings
        st.quality = 10; st.mass = 0.05; st.air_damping = 3.0; st.tension_stiffness = 12; st.compression_stiffness = 12; st.shear_stiffness = 5; st.bending_stiffness = 0.05
        st.tension_damping = 6; st.compression_damping = 6; st.shear_damping = 6; st.bending_damping = 0.6; st.shrink_min = -grow; st.vertex_group_mass = 'pin'; st.pin_stiffness = 1.0
        cs = m.collision_settings; cs.use_collision = True; cs.distance_min = 0.0014; cs.collision_quality = 4; cs.use_self_collision = True; cs.self_distance_min = 0.0012
        m.point_cache.frame_start = 1; m.point_cache.frame_end = frames; sc.frame_start = 1; sc.frame_end = frames
        try:
            for f in range(1, frames + 1): sc.frame_set(f)
            dg = bpy.context.evaluated_depsgraph_get(); ev = ob.evaluated_get(dg); out = bmesh.new(); out.from_mesh(ev.data)
            dm = max(((v.co - self.frame(self.L * (i // seg) / n)[0]).length if math.isfinite(v.co.x) else 9.0) for i, v in enumerate(out.verts))
            ok = dm < 0.10; print('[khamsin] cloth sim: max dist %.4f, verts %d, ok %s' % (dm, len(out.verts), ok))
        except Exception as e:
            print('[khamsin] cloth sim failed:', e); ok = False; out = None
        sc.frame_set(1); bpy.data.objects.remove(ob); bpy.data.objects.remove(co); bpy.data.meshes.remove(me); bpy.data.meshes.remove(cm)
        if not ok: return None
        for _ in range(2): bmesh.ops.smooth_vert(out, verts=[v for i, v in enumerate(out.verts) if w[i] == 0.0], factor=0.4, use_axis_x=True, use_axis_y=True, use_axis_z=True)
        out.faces.new([v for v in list(out.verts)[:seg]][::-1]); out.faces.new(list(out.verts)[-seg:])
        return out

    def mount(self, s, hint, h=0.0):
        """袖子表面上的安装标架：局部 x 横向，y 朝肘，z 朝外。"""
        c, tg, up, sd = self.frame(s); n = Vector(hint); n = (n - tg * n.dot(tg)).normalized(); th = math.atan2(n.dot(up), n.dot(sd))
        o = c + n * (self.base(s, th) + h); x = tg.cross(n).normalized()
        return Matrix(((x.x, tg.x, n.x, o.x), (x.y, tg.y, n.y, o.y), (x.z, tg.z, n.z, o.z), (0, 0, 0, 1))), th


def sleeve_cuff(K, group, sl, th):
    """袖口：双层折边 + 魔术贴调节片（都贴着袖子曲面）。"""
    K.add('cuffhem', sl.band(0.0125, 0.0250, 0.0012, off=0.0050), 'sleeve', group, bevel=0.0004, sharp=60)
    K.add('cufftab', sl.patch(0.0125, 0.0200, th - 0.62, th + 0.50, 0.0062, 0.0016), 'sleeve', group, bevel=0.0005, sharp=60)
    K.add('cuffvel', sl.patch(0.0125, 0.0160, th + 0.50, th + 0.95, 0.0062, 0.0008), 'dark', group, bevel=0.0003, sharp=60)


def buckle(K, group, M):
    K.add('buckle', xform(box(0.030, 0.021, 0.0042, (0, 0, 0.0020)), M), 'poly', group, bevel=0.0012, seg=2)
    K.add('buckle_bar', xform(box(0.022, 0.0034, 0.0030, (0, 0.0046, 0.0050)), M), 'poly', group, bevel=0.0008)
    K.add('buckle_bar', xform(box(0.022, 0.0034, 0.0030, (0, -0.0046, 0.0050)), M), 'poly', group, bevel=0.0008)


def launcher(K, group, sl, s0, hint):
    """左前臂钩索发射器：底托 + 机匣 + 状态屏 + 发射管（内有钩头）+ 线盘 + 气瓶。返回钩索出口（组内坐标）。"""
    M, th = sl.mount(s0, hint, 0.0052)
    def A(name, bm, mat, **kw): return K.add(name, xform(bm, M), mat, group, **kw)
    # 底托：下表面贴着手臂曲面，上表面是平的安装面
    Mi = M.inverted(); cr = bmesh.new(); top = []; bot = []; ns, nt = 16, 12
    for i in range(ns + 1):
        s_ = s0 - 0.066 + 0.156 * i / ns; rt = []; rb = []
        for k in range(nt + 1):
            a_ = th - 0.64 + 1.28 * k / nt
            rb.append(cr.verts.new(sl.point(s_, a_, 0.0030, cloth=False))); rt.append(cr.verts.new(sl.point(s_, a_, 0.0066, cloth=False)))
        top.append(rt); bot.append(rb)
    for i in range(ns):
        for k in range(nt):
            cr.faces.new((top[i][k], top[i][k + 1], top[i + 1][k + 1], top[i + 1][k])); cr.faces.new((bot[i][k], bot[i + 1][k], bot[i + 1][k + 1], bot[i][k + 1]))
        for k in (0, nt): cr.faces.new((top[i][k], top[i + 1][k], bot[i + 1][k], bot[i][k]))
    for k in range(nt):
        for i in (0, ns): cr.faces.new((top[i][k], top[i][k + 1], bot[i][k + 1], bot[i][k]))
    K.add('gl_cradle', cr, 'rubber', group, bevel=0.0012, sharp=50)
    A('gl_base', box(0.0400, 0.1000, 0.0130, (0, 0.000, 0.0005)), 'poly', bevel=0.0016)
    for sx in (-1, 1): A('gl_rail', box(0.0042, 0.100, 0.0090, (sx * 0.0262, 0.000, 0.0070)), 'metal', bevel=0.0012)
    body = A('gl_body', box(0.0470, 0.0920, 0.0190, (0, 0.0, 0.0150)), 'tan', bevel=0.0030, seg=2)
    g = bmesh.new()
    for sx in (-1, 1): join(g, xform(box(0.0050, 0.0500, 0.0090, (sx * 0.0240, 0.004, 0.0150)), M))
    join(g, xform(box(0.0300, 0.0080, 0.0070, (0, -0.0470, 0.0215)), M)); cut(body, g)
    A('gl_deck', box(0.0400, 0.0580, 0.0052, (0, 0.0120, 0.0262)), 'tan', bevel=0.0016, seg=2)
    A('gl_bezel', box(0.0350, 0.0470, 0.0012, (0, 0.0150, 0.0286)), 'poly', bevel=0.0005)
    A('gl_glass', box(0.0320, 0.0440, 0.0008, (0, 0.0150, 0.0290)), 'dark', bevel=0)
    for sx in (-1, 1):
        A('gl_btn', tube((sx * 0.0105, -0.0225, 0.0262), (sx * 0.0105, -0.0225, 0.0296), 0.0034, seg=10), 'rubber', bevel=0.0005)
        for y in (-0.038, 0.042): A('gl_screw', tube((sx * 0.0195, y, 0.0240), (sx * 0.0195, y, 0.0254), 0.0024, seg=8), 'metalBare', bevel=0.0004)
        for y in (-0.030, 0.034): A('gl_screw', tube((sx * 0.0232, y, 0.0100), (sx * 0.0246, y, 0.0100), 0.0022, seg=8), 'metalBare', bevel=0.0004)
    A('gl_led', box(0.0060, 0.0026, 0.0010, (0, -0.0225, 0.0290)), 'red', bevel=0)
    # 发射管（朝手腕方向 = -y）
    bz = 0.0152
    brl = A('gl_barrel', tube((0, -0.040, bz), (0, -0.104, bz), 0.0108, seg=16), 'metal', bevel=0.0006)
    cut(brl, xform(tube((0, -0.070, bz), (0, -0.110, bz), 0.0086, seg=16), M))
    A('gl_shroud', tube((0, -0.046, bz), (0, -0.060, bz), 0.0130, seg=16), 'metal', bevel=0.0010)
    col = A('gl_muz', orient(gear(0.0110, 0.0142, 0.0134, 22), (0, -0.104, bz), (0, 1, 0)), 'metal', bevel=0.0004)
    cut(col, xform(tube((0, -0.110, bz), (0, -0.090, bz), 0.0090, seg=16), M))
    A('gl_hook', tube((0, -0.0860, bz), (0, -0.1090, bz), 0.0052, 0.0008, seg=10), 'metalBare', bevel=0)
    for k in range(3):
        a = rad(90 + k * 120); c, sn = math.cos(a), math.sin(a)
        A('gl_fluke', xform(box(0.0016, 0.0150, 0.0050, (0, 0, 0.0040)), Matrix.Translation((0, -0.0960, bz)) @ Matrix.Rotation(a - math.pi / 2, 4, 'Y')), 'metal', bevel=0.0004)
    # 线盘（朝肘 = +y）
    ry, rz = 0.0680, 0.0200
    for i in range(10): A('gl_cable', tube((-0.0140 + i * 0.0028, ry, rz), (-0.0140 + (i + 1) * 0.0028, ry, rz), 0.0152 if i % 2 == 0 else 0.0145, seg=8), 'rubber', bevel=0.0003)
    for sx in (-1, 1):
        fl = A('gl_flange', tube((sx * 0.0142, ry, rz), (sx * 0.0170, ry, rz), 0.0192, seg=18), 'tanMetal', bevel=0.0006)
        g = bmesh.new()
        for k in range(6): a = rad(k * 60 + 30); join(g, xform(tube((sx * 0.0130, ry + 0.0122 * math.cos(a), rz + 0.0122 * math.sin(a)), (sx * 0.0180, ry + 0.0122 * math.cos(a), rz + 0.0122 * math.sin(a)), 0.0030, seg=8), M))
        cut(fl, g)
        A('gl_hub', orient(hexp(0.0042, 0.0056), (sx * 0.0170 if sx > 0 else -0.0212, ry, rz), (1, 0, 0)), 'metalBare', bevel=0.0004)
        A('gl_fork', box(0.0040, 0.0300, 0.0130, (sx * 0.0222, 0.0560, 0.0130)), 'metal', bevel=0.0012)
    A('gl_guide', pipe(smooth_path([(0.004, 0.0640, 0.0352), (0.008, 0.0500, 0.0330), (0.0215, 0.0400, 0.0285), (0.0222, 0.0000, 0.0262), (0.0215, -0.0300, 0.0262), (0.0100, -0.0440, 0.0225)], 4), 0.0015, 6), 'dark', bevel=0, sharp=180)
    # 气瓶（外侧 = -x，朝镜头）
    gx, gz = -0.0345, 0.0128
    A('gl_gas', orient(lathe([(-0.036, 0.0030), (-0.032, 0.0042), (-0.027, 0.0050), (-0.020, 0.0088), (0.022, 0.0088), (0.0275, 0.0072), (0.030, 0.0036)], seg=16), (gx, 0.004, gz), (0, 1, 0)), 'metalBare', bevel=0)
    A('gl_valve', box(0.0130, 0.0140, 0.0150, (gx + 0.0020, -0.0390, gz)), 'metal', bevel=0.0014)
    A('gl_cap', orient(gear(0.0060, 0.0064, 0.0058, 14), (gx, 0.0340, gz), (0, 1, 0)), 'metal', bevel=0.0003)
    for y in (-0.008, 0.016): A('gl_clamp', tube((gx, y, gz), (gx, y + 0.0044, gz), 0.0096, seg=14), 'dark', bevel=0.0004)
    # 束带与扣具
    for ds in (-0.044, 0.046):
        K.add('strap', sl.band(s0 + ds, 0.0200, 0.0020), 'dark', group, bevel=0.0005, sharp=60)
        Mb, _ = sl.mount(s0 + ds, (M.to_3x3() @ Vector((-0.86, 0, 0.5))), 0.0045); buckle(K, group, Mb)
    # 触发线：从机匣前端沿袖子走到手套腕带
    P = [M @ Vector((-0.016, -0.0470, 0.0100)), M @ Vector((-0.020, -0.062, 0.0040))]
    for s in (s0 - 0.085, s0 - 0.105, 0.030, 0.012): P.append(sl.point(max(0.004, s), th - 0.35, 0.0016))
    K.add('gl_wire', pipe(smooth_path(P, 4), 0.0015, 6), 'dark', group, bevel=0, sharp=180)
    g = M @ Vector((0, -0.106, bz)); e = empty('grapple', (g.x, g.y, g.z), K.g[group])
    d = empty('grDisp', (0, 0, 0), K.g[group]); d.matrix_local = M @ Matrix.Translation((0, 0.0150, 0.0301))
    return M
