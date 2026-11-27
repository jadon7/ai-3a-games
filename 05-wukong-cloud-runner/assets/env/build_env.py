"""二次元风中国山水世界（EEVEE）生成脚本，输出 env.blend，集合名 "ENV"。

运行：
  /Applications/Blender.app/Contents/MacOS/Blender -b -P build_env.py -- [quick] [seed=7] [out=env.blend]

世界：米；Z 向上；水面 z=0；江沿 +X 流，江心线/地表高度见 env_height.py（主线程用它算贴地飞行）。
左岸（y>yc）桃花坡 + 远处峰林；右岸层理悬崖 + 瀑布(x=150) + 楼阁(x=-300)；x∈[500,1100] 是湖，湖中孤峰。
材质全部风格化（色块 + 渐变 + 笔触），每个材质末尾接节点组 WK_Fog（按相机距离混入天空色，
节点 FOG_DENSITY / FOG_MAX / FOG_COLOR 可调）。水和瀑布的流动靠着色器里的 frame 驱动。
（build_env_realistic.py 是之前写实版的生成脚本，已弃用。）
"""
import bpy, sys, os, math, time
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, 'common'))
sys.path.insert(0, HERE)

ARGV = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
QUICK = 'quick' in ARGV
SEED = 7
OUT = 'env.blend'
for a in ARGV:
    if a.startswith('seed='):
        SEED = int(a[5:])
    if a.startswith('out='):
        OUT = a[4:]
Z0 = -25.0
T0 = time.time()


def log(*a):
    print(f'[env {time.time() - T0:6.1f}s]', *a, flush=True)


# ----------------------------------------------------------------------------- 噪声
class VNoise:
    def __init__(self, seed, n=32):
        r = np.random.default_rng(seed)
        self.n = n
        self.t = r.random((n, n, n)).astype(np.float32)

    def __call__(self, x, y, z):
        n = self.n
        x, y, z = np.broadcast_arrays(np.asarray(x, np.float64), np.asarray(y, np.float64), np.asarray(z, np.float64))
        xf, yf, zf = np.floor(x), np.floor(y), np.floor(z)
        fx, fy, fz = (x - xf).astype(np.float32), (y - yf).astype(np.float32), (z - zf).astype(np.float32)
        x0, y0, z0 = xf.astype(np.int64) % n, yf.astype(np.int64) % n, zf.astype(np.int64) % n
        x1, y1, z1 = (x0 + 1) % n, (y0 + 1) % n, (z0 + 1) % n
        ux, uy, uz = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy), fz * fz * (3 - 2 * fz)
        t = self.t
        c00 = t[x0, y0, z0] * (1 - ux) + t[x1, y0, z0] * ux
        c10 = t[x0, y1, z0] * (1 - ux) + t[x1, y1, z0] * ux
        c01 = t[x0, y0, z1] * (1 - ux) + t[x1, y0, z1] * ux
        c11 = t[x0, y1, z1] * (1 - ux) + t[x1, y1, z1] * ux
        c0 = c00 * (1 - uy) + c10 * uy
        c1 = c01 * (1 - uy) + c11 * uy
        return c0 * (1 - uz) + c1 * uz


def fbm(nz, x, y, z, octaves=5, lac=2.03, gain=0.5):
    a, s, tot, f = 1.0, 0.0, 0.0, 1.0
    for o in range(octaves):
        s = s + a * nz(x * f + 17.1 * o, y * f + 31.7 * o, z * f + 5.3 * o)
        tot += a
        a *= gain
        f *= lac
    return s / tot


def ridged(nz, x, y, z, octaves=5, lac=2.03, gain=0.5):
    a, s, tot, f = 1.0, 0.0, 0.0, 1.0
    for o in range(octaves):
        v = 1.0 - np.abs(2.0 * nz(x * f + 11.3 * o, y * f + 7.9 * o, z * f + 3.1 * o) - 1.0)
        s = s + a * v * v
        tot += a
        a *= gain
        f *= lac
    return s / tot


def sstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0 + 1e-12), 0.0, 1.0)
    return t * t * (3 - 2 * t)


_TBL = np.random.default_rng(12345).random(8192)


def hash2(ix, iy, seed):
    h = (ix.astype(np.int64) * 73856093) ^ (iy.astype(np.int64) * 19349663) ^ (int(seed) * 83492791)
    return np.abs(h) % 8192


def worley2(x, y, cell, seed, jitter=0.85):
    """返回 F1, F2, v1, v2（最近 / 次近特征点的距离与其随机值）。"""
    x, y = np.asarray(x, np.float64), np.asarray(y, np.float64)
    gx, gy = np.floor(x / cell), np.floor(y / cell)
    F1 = np.full(x.shape, 1e9); F2 = np.full(x.shape, 1e9)
    v1 = np.zeros(x.shape); v2 = np.zeros(x.shape)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            cx, cy = gx + dx, gy + dy
            h = hash2(cx, cy, seed)
            jx = 0.5 + (_TBL[h] - 0.5) * jitter
            jy = 0.5 + (_TBL[(h + 977) % 8192] - 0.5) * jitter
            rv = _TBL[(h + 2311) % 8192]
            d = np.hypot(x - (cx + jx) * cell, y - (cy + jy) * cell)
            closer = d < F1
            mid = (~closer) & (d < F2)
            F2 = np.where(closer, F1, np.where(mid, d, F2))
            v2 = np.where(closer, v1, np.where(mid, rv, v2))
            F1 = np.where(closer, d, F1)
            v1 = np.where(closer, rv, v1)
    return F1, F2, v1, v2


def cellblend(F1, F2, v1, v2, w):
    """柱状节理：单元内取 v1，边界 w 宽度内向 v2 过渡（连续且陡）。"""
    t = 0.5 + 0.5 * np.clip((F2 - F1) / w, 0, 1)
    return v1 * t + v2 * (1 - t)


def strata1d(zq, thick, seed, sharp=0.22):
    """横向层理：每层一个随机值，层间陡变。"""
    q = zq / thick
    i = np.floor(q).astype(np.int64)
    f = q - i
    a = _TBL[np.abs(i * 2654435761 + seed * 97) % 8192]
    b = _TBL[np.abs((i + 1) * 2654435761 + seed * 97) % 8192]
    t = sstep(1.0 - sharp, 1.0, f)
    return a * (1 - t) + b * t


# ----------------------------------------------------------------------------- mesh 工具
def mesh_from_arrays(name, verts, quads=None, tris=None):
    me = bpy.data.meshes.new(name)
    nv = len(verts)
    me.vertices.add(nv)
    me.vertices.foreach_set('co', np.asarray(verts, np.float32).ravel())
    nq = 0 if quads is None else len(quads)
    nt = 0 if tris is None else len(tris)
    nl = nq * 4 + nt * 3
    me.loops.add(nl)
    me.polygons.add(nq + nt)
    li = []
    if nq:
        li.append(np.asarray(quads, np.int32).ravel())
    if nt:
        li.append(np.asarray(tris, np.int32).ravel())
    me.loops.foreach_set('vertex_index', np.concatenate(li))
    starts = np.concatenate([np.arange(nq, dtype=np.int32) * 4, nq * 4 + np.arange(nt, dtype=np.int32) * 3])
    totals = np.concatenate([np.full(nq, 4, np.int32), np.full(nt, 3, np.int32)])
    me.polygons.foreach_set('loop_start', starts)
    me.polygons.foreach_set('loop_total', totals)
    me.update(calc_edges=True)
    me.polygons.foreach_set('use_smooth', np.ones(nq + nt, bool))
    return me


def grid_quads(nr, nc, wrap=True):
    i = np.arange(nr - 1)[:, None]
    j = np.arange(nc if wrap else nc - 1)[None, :]
    j1 = (j + 1) % nc
    a = i * nc + j
    b = i * nc + j1
    c = (i + 1) * nc + j1
    d = (i + 1) * nc + j
    return np.stack([a + 0 * b, b + 0 * a, c + 0 * a, d + 0 * a], -1).reshape(-1, 4)


def set_attr(me, name, vals, kind='FLOAT'):
    at = me.attributes.new(name, kind, 'POINT')
    if kind == 'FLOAT':
        at.data.foreach_set('value', np.asarray(vals, np.float32))
    elif kind == 'INT':
        at.data.foreach_set('value', np.asarray(vals, np.int32))
    elif kind == 'FLOAT_VECTOR':
        at.data.foreach_set('vector', np.asarray(vals, np.float32).ravel())
    return at


def vnormals(me):
    n = np.zeros(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get('normal', n)
    return n.reshape(-1, 3)


def new_coll(name, parent, hide=False):
    c = bpy.data.collections.new(name)
    parent.children.link(c)
    if hide:
        c.hide_render = True
        c.hide_viewport = True
    return c


# ----------------------------------------------------------------------------- 峰柱
def build_pillar(name, seed, R, H, seg=0.75, style='zjj', aspect=1.0, mat=None):
    """多瓣峰柱：若干根高矮不一的柱子融合在一起（张家界式），或若干锥峰融合（黄山 / 桂林式）。
    style='zjj'：直壁、柱状节理、圆肩平顶；'hs'：花岗岩锥峰群。原点在主柱中心 z=0（云海面）。"""
    rng = np.random.default_rng(seed)
    nz = VNoise(seed * 7 + 3)
    phi = rng.random() * np.pi
    # ---- 瓣：主柱 + 伴生柱
    nl = int(rng.choice([1, 2, 3, 4, 5, 6], p=[0.08, 0.20, 0.27, 0.22, 0.15, 0.08])) if style == 'zjj' else int(rng.integers(2, 6))
    lobes = [(0.0, 0.0, R, H)]
    for k in range(1, nl):
        a = phi + (0.0 if rng.random() < 0.5 else np.pi) + rng.normal(0, 0.9 / max(aspect, 1.0))
        if style == 'zjj' and rng.random() < 0.3:          # 细针峰
            rk = R * rng.uniform(0.2, 0.38)
            hk = min(H * rng.uniform(0.7, 0.98), H - 10.0)
            dist = (R + rk) * rng.uniform(0.7, 0.95)
        else:
            rk = R * rng.uniform(0.35, 0.85)
            dist = (R + rk) * (rng.uniform(0.45, 0.85) if style == 'zjj' else rng.uniform(0.55, 0.95))
            hk = min(H * rng.uniform(0.30, 0.93), H - 14.0)
        lobes.append((math.cos(a) * dist, math.sin(a) * dist, rk, hk))
    hr = [min(l[2] * rng.uniform(0.45, 0.9) + 3.0, 26.0) if style == 'zjj' else 0.0 for l in lobes]

    def union_r(th_, rad):
        """从原点沿 th_ 方向到各瓣外缘的最大距离。rad: 每瓣半径数组（可随高度变）。"""
        dx, dy = np.cos(th_), np.sin(th_)
        best = np.zeros(np.broadcast(th_, rad[0]).shape)
        for (cx, cy, _, _), r_k in zip(lobes, rad):
            cd = cx * dx + cy * dy
            disc = r_k * r_k - (cx * cx + cy * cy) + cd * cd
            t = cd + np.sqrt(np.maximum(disc, 0.0))
            t = np.where((disc > 0) & (t > 0), t, 0.0)
            best = np.maximum(best, t)
        return best

    r_ref0 = union_r(np.linspace(0, 2 * np.pi, 256, endpoint=False), [l[2] for l in lobes])
    nth = max(32, int(2 * math.pi * float(r_ref0.mean()) * 1.25 / seg))
    th = np.linspace(0, 2 * np.pi, nth, endpoint=False)
    ang_n = 1 + 0.12 * (fbm(nz, np.cos(th) * 1.5, np.sin(th) * 1.5, 0.5, 3) - 0.5) * 2
    r_ref = union_r(th, [l[2] for l in lobes]) * ang_n
    xr, yr = r_ref * np.cos(th), r_ref * np.sin(th)

    # ---- 环的高度：云下稀疏，云上均匀，各瓣顶部加密
    dz = seg * 1.15
    z_w = H - 0.36 * hr[0] if style == 'zjj' else H
    zl = [np.arange(Z0, -25.0, max(6.0, dz * 4)), np.arange(-25.0, z_w, dz), [z_w]]
    if style == 'zjj':
        for (cx, cy, rk, hk), h_r in zip(lobes, hr):
            nd = int(np.clip(rk / seg, 4, 40))
            sv = np.linspace(0.04, 1.0, nd)
            zz = hk - h_r * sv ** 2
            zl.append(zz[zz < z_w])
            if hk < z_w:
                zl.append([hk + 0.05])
    zs = np.unique(np.concatenate([np.asarray(a, float) for a in zl]))
    zs = zs[np.concatenate([[True], np.diff(zs) > 0.04])]
    nr = len(zs)
    Zg = zs[:, None] + np.zeros((1, nth))

    # ---- 各瓣半径随高度变化
    rads = []
    e_cone = rng.uniform(0.45, 0.8, nl)
    for k, ((cx, cy, rk, hk), h_r) in enumerate(zip(lobes, hr)):
        z = zs[:, None]
        if style == 'zjj':
            taper = rng.uniform(-0.10, 0.30)
            pr = (1.0 + 0.32 * sstep(-15.0, Z0, z)) * (1 - taper * np.clip(z / hk, 0, 1) ** 1.5)
            pr = pr * (1 + 0.26 * (nz(z / 85.0 + 3.3 + 7.7 * k, 0.1, 0.7) - 0.5) * 2)
            pr = pr * np.sqrt(np.clip((hk - z) / h_r, 0, 1))
        else:
            uu = np.clip((z - Z0) / (hk - Z0), 0, 1)
            pr = (0.10 + 1.25 * (1 - uu) ** e_cone[k]) * (1 + 0.14 * (nz(z / 90.0 + 1.3 + 5.1 * k, 0.4, 0.2) - 0.5) * 2)
            pr = pr * (z <= hk)
        rads.append(rk * pr)
    r0 = union_r(th[None, :], rads) * ang_n[None, :]
    if style != 'zjj':
        r0 = r0 * (1 + 0.5 * (fbm(nz, np.cos(th)[None, :] * 1.2, np.sin(th)[None, :] * 1.2, Zg / 110.0, 3) - 0.5))
    r0 = np.maximum(r0, 0.5)
    X0, Y0 = r0 * np.cos(th)[None, :], r0 * np.sin(th)[None, :]

    # ---- 柱状单元（Worley）：竖向节理 + 块体进退
    cs = R * rng.uniform(0.38, 0.65)
    F1, F2, v1, v2 = worley2(xr, yr, cs, seed)
    wcr = cs * 0.055
    seglen = rng.uniform(35, 80)
    zq = (Zg + v1[None, :] * 300.0) / seglen
    zi = np.floor(zq).astype(np.int64)
    kv1 = np.floor(v1 * 4096).astype(np.int64)[None, :]
    kv2 = np.floor(v2 * 4096).astype(np.int64)[None, :]
    tz = sstep(0.9, 1.0, zq - zi)
    blk1 = _TBL[(kv1 + zi * 131) % 8192] * (1 - tz) + _TBL[(kv1 + (zi + 1) * 131) % 8192] * tz
    blk2 = _TBL[(kv2 + zi * 131) % 8192]
    tb = (0.5 + 0.5 * np.clip((F2 - F1) / wcr, 0, 1))[None, :]
    blocky = (blk1 * tb + blk2 * (1 - tb) - 0.5) * (0.18 if style == 'zjj' else 0.16)
    crack = (1 - sstep(0.0, wcr * 1.3, F2 - F1))[None, :]
    crack = crack * (0.35 + 0.65 * fbm(nz, th[None, :] * 3.0, 0.2, Zg / 60.0, 3)) * (0.5 + 0.7 * np.clip(Zg / H, 0, 1))
    groove = -crack * (0.075 if style == 'zjj' else 0.09)
    fine_v = (fbm(nz, X0 / 3.5, Y0 / 3.5, Zg / 45.0, 4) - 0.5) * 0.035

    # ---- 横向层理（略带倾角；有的层段厚重无层理）
    dip_a = rng.random() * 6.28
    zt = Zg + 0.035 * (X0 * math.cos(dip_a) + Y0 * math.sin(dip_a))
    tk = rng.uniform(0.75, 1.6)
    k = (1.0 if style == 'zjj' else 0.45)
    massive = sstep(0.25, 0.55, nz(zt / 95.0 + 9.1, 0.3, 0.6))
    lay = (strata1d(zt, 14.0 * tk, seed + 1) - 0.5) * 0.07 * k
    lay += (strata1d(zt, 1.4 * tk, seed + 3, 0.35) - 0.5) * 0.012 * k

    ztw = zt + 16.0 * (nz(zt / 70.0 + 2.2, np.cos(th)[None, :] * 0.8, np.sin(th)[None, :] * 0.8) - 0.5) * 2
    nk = min(1.0, 1.1 / seg)

    def bed_notch(thick, width, sd):
        q = ztw / thick + 0.37 * sd
        i = np.floor(q).astype(np.int64)
        f = q - i
        dep = _TBL[np.abs(i * 2654435761 + sd * 131) % 8192]
        return np.exp(-((f - 0.5) / width) ** 2) * dep ** 1.5

    thn = nz(th[None, :] * 2.5 + 1.1, Zg / 45.0, 0.6)
    lay -= bed_notch(5.5 * tk, 0.13, seed + 5) * (0.65 / R) * k * nk * massive * (0.4 + 1.2 * thn)
    lay -= bed_notch(37.0 * tk, 0.05, seed + 6) * (2.4 / R) * k * nk * sstep(0.35, 0.7, thn) * 1.6

    bulk = (fbm(nz, X0 / 38.0, Y0 / 38.0, Zg / 38.0, 4) - 0.5) * (0.20 if style == 'zjj' else 0.30)
    mid = (ridged(nz, X0 / 9.0, Y0 / 9.0, Zg / 14.0, 4) - 0.5) * 0.05
    fine = (fbm(nz, X0 / 2.2, Y0 / 2.2, Zg / 2.2, 3) - 0.5) * (0.9 / R)
    arc = th[None, :] * float(r_ref.mean())
    bF1, bF2, bv1, bv2 = worley2(arc + 2.0 * (nz(Zg / 9.0, th[None, :] * 4, 0.2) - 0.5), Zg * rng.uniform(1.3, 2.0), rng.uniform(3.5, 6.0), seed + 77)
    facet = (cellblend(bF1, bF2, bv1, bv2, 0.30) - 0.5) * (0.75 / R) * nk
    seam = -(1 - sstep(0.0, 0.4, bF2 - bF1)) * (0.25 / R) * nk * (0.3 + 1.2 * nz(Zg / 20.0, th[None, :] * 3, 0.9))
    rr = r0 * (1 + blocky + groove + fine_v + lay + bulk + mid + fine + facet + seam)
    rr = np.maximum(rr, 0.4)
    Xw, Yw = rr * np.cos(th)[None, :], rr * np.sin(th)[None, :]

    # ---- 主柱顶盖
    rtop = rr[-1]
    ncap = int(np.clip(rtop.mean() / (seg * 1.1), 4, 90))
    rho = (1.0 - np.arange(1, ncap) / ncap)[:, None]
    Xc, Yc = rho * Xw[-1][None, :], rho * Yw[-1][None, :]
    capdome = 0.36 * hr[0] if style == 'zjj' else 1.5
    lump = (fbm(nz, Xc / 9.0, Yc / 9.0, 0.3, 4) - 0.5) * 7.0 * (1 - rho ** 4)
    Zc = z_w + capdome * (1 - rho ** 2) + lump
    zc_center = float(Zc[-1].mean())

    V = np.concatenate([
        np.stack([Xw, Yw, Zg], -1).reshape(-1, 3),
        np.stack([Xc, Yc, Zc], -1).reshape(-1, 3),
        np.array([[0.0, 0.0, zc_center]])])
    nrings = nr + ncap - 1
    quads = grid_quads(nrings, nth)
    last = (nrings - 1) * nth
    j = np.arange(nth)
    tris = np.stack([last + j, last + (j + 1) % nth, np.full(nth, nrings * nth)], -1)
    me = mesh_from_arrays(name, V, quads, tris)

    N = vnormals(me)
    zv = V[:, 2]
    vg = sstep(0.42, 0.78, N[:, 2]) * sstep(-2.0, 6.0, zv)
    nb = fbm(nz, V[:, 0] / 6.0, V[:, 1] / 6.0, V[:, 2] / 6.0, 3)
    vg = np.clip(vg * (0.6 + 0.9 * nb), 0, 1)
    vg[nr * nth:] = np.maximum(vg[nr * nth:], 0.85)
    set_attr(me, 'veg', vg)
    ob = bpy.data.objects.new(name, me)
    if mat:
        me.materials.append(mat)

    G = np.concatenate([np.stack([Xw, Yw, Zg], -1), np.stack([Xc, Yc, Zc], -1)], 0)
    dth = np.linalg.norm(np.roll(G, -1, 1) - G, axis=-1)
    dr = np.linalg.norm(np.diff(G, axis=0, append=G[-1:]), axis=-1)
    area = np.concatenate([(dth * dr).ravel(), [0.0]])
    cand = {'co': V, 'n': N, 'area': area, 'top': N[:, 2] > 0.8, 'veg': vg}
    return ob, cand


def pick_tree_points(cand, rng, dens_top=0.07, dens_ledge=0.03, zmin=4.0):
    co, n, area = cand['co'], cand['n'], cand['area']
    up = sstep(0.38, 0.8, n[:, 2])
    dens = dens_ledge + (dens_top - dens_ledge) * sstep(0.75, 0.95, n[:, 2])
    p = np.minimum(dens * up * np.minimum(area, 60.0), 0.9) * (co[:, 2] > zmin)
    return np.nonzero(rng.random(len(co)) < p)[0]


# ----------------------------------------------------------------------------- 节点小工具
def mix_rgb(nt, fac, a, b, blend='MIX'):
    n = nt.nodes.new('ShaderNodeMix')
    n.data_type = 'RGBA'
    n.blend_type = blend
    for sock, v in ((n.inputs[0], fac), (n.inputs[6], a), (n.inputs[7], b)):
        if hasattr(v, 'links') or hasattr(v, 'is_linked'):
            nt.links.new(v, sock)
        else:
            sock.default_value = v
    return n.outputs[2]


def math_node(nt, op, a, b=None, c=None, clamp=False):
    n = nt.nodes.new('ShaderNodeMath')
    n.operation = op
    n.use_clamp = clamp
    for sock, v in zip(n.inputs, (a, b, c)):
        if v is None:
            continue
        if hasattr(v, 'is_linked'):
            nt.links.new(v, sock)
        else:
            sock.default_value = v
    return n.outputs[0]


def map_range(nt, v, a0, a1, b0=0.0, b1=1.0, smooth=True):
    n = nt.nodes.new('ShaderNodeMapRange')
    if smooth:
        n.interpolation_type = 'SMOOTHSTEP'
    nt.links.new(v, n.inputs[0])
    n.inputs[1].default_value, n.inputs[2].default_value = a0, a1
    n.inputs[3].default_value, n.inputs[4].default_value = b0, b1
    return n.outputs[0]


def noise_node(nt, vec, scale, detail=6.0, rough=0.55, sx=1.0, sy=1.0, sz=1.0):
    if (sx, sy, sz) != (1.0, 1.0, 1.0):
        mp = nt.nodes.new('ShaderNodeMapping')
        mp.inputs['Scale'].default_value = (sx, sy, sz)
        nt.links.new(vec, mp.inputs['Vector'])
        vec = mp.outputs[0]
    n = nt.nodes.new('ShaderNodeTexNoise')
    n.inputs['Scale'].default_value = scale
    n.inputs['Detail'].default_value = detail
    n.inputs['Roughness'].default_value = rough
    nt.links.new(vec, n.inputs['Vector'])
    return n.outputs[0]


def _tube(path, radii, sides):
    path = np.asarray(path, float)
    n = len(path)
    tang = np.gradient(path, axis=0)
    tang /= np.linalg.norm(tang, axis=1, keepdims=True) + 1e-9
    ref = np.array([0.0, 0.0, 1.0])
    V = []
    for i in range(n):
        t = tang[i]
        a = np.cross(t, ref if abs(t[2]) < 0.95 else np.array([1.0, 0, 0]))
        a /= np.linalg.norm(a) + 1e-9
        b = np.cross(t, a)
        ang = np.linspace(0, 2 * np.pi, sides, endpoint=False)
        V.append(path[i] + radii[i] * (np.cos(ang)[:, None] * a + np.sin(ang)[:, None] * b))
    V = np.concatenate(V)
    Q = grid_quads(n, sides)
    return V, Q


# ----------------------------------------------------------------------------- 几何节点实例器
def make_instancer_group(name, coll):
    ng = bpy.data.node_groups.new(name, 'GeometryNodeTree')
    ng.interface.new_socket('Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
    ng.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
    N, L = ng.nodes, ng.links
    gi, go = N.new('NodeGroupInput'), N.new('NodeGroupOutput')
    ci = N.new('GeometryNodeCollectionInfo')
    ci.inputs['Collection'].default_value = coll
    ci.inputs['Separate Children'].default_value = True
    ci.inputs['Reset Children'].default_value = True
    iop = N.new('GeometryNodeInstanceOnPoints')
    iop.inputs['Pick Instance'].default_value = True

    def attr(nm, dt):
        a = N.new('GeometryNodeInputNamedAttribute')
        a.data_type = dt
        a.inputs['Name'].default_value = nm
        return a.outputs[0]
    e2r = N.new('FunctionNodeEulerToRotation')
    L.new(attr('rot', 'FLOAT_VECTOR'), e2r.inputs[0])
    L.new(gi.outputs[0], iop.inputs['Points'])
    L.new(ci.outputs[0], iop.inputs['Instance'])
    L.new(attr('tid', 'INT'), iop.inputs['Instance Index'])
    L.new(e2r.outputs[0], iop.inputs['Rotation'])
    L.new(attr('scl', 'FLOAT_VECTOR'), iop.inputs['Scale'])
    L.new(iop.outputs[0], go.inputs[0])
    return ng


def make_points_object(name, co, tid, rot, scl, group):
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(co))
    me.vertices.foreach_set('co', np.asarray(co, np.float32).ravel())
    set_attr(me, 'tid', tid, 'INT')
    set_attr(me, 'rot', rot, 'FLOAT_VECTOR')
    set_attr(me, 'scl', scl, 'FLOAT_VECTOR')
    me.update()
    ob = bpy.data.objects.new(name, me)
    md = ob.modifiers.new('inst', 'NODES')
    md.node_group = group
    return ob



# ============================================================================= 二次元山水世界
import bmesh
import env_height as EH

# 留空的飞行走廊（主线程约定）
CORRIDOR = {
    'air': ((-1500.0, 240.0), (-850.0, 150.0)),      # (x, z)：y = yc(x)+40 → yc(x)+190，周围 35 m 无山体
    'band': (-700.0, 0.0, EH.BAND_D, 12.0),          # x0, x1, 离江心距离, 中线两侧无树半宽
    'river': (100.0, 1150.0, 35.0),                  # x0, x1, 江心线两侧净空
}
ALB = 0.70            # 把“受光后想看到的颜色”换算成反照率（太阳 4.2 + 蓝色天光）
FOG_COLOR = (0.50, 0.73, 0.97)
FOG_DENS = 1.0 / 7500.0
FOG_MAX = 0.80

# 调色板（线性，受光后的目标色）
G1, G2, G3 = (0.075, 0.32, 0.06), (0.21, 0.54, 0.07), (0.44, 0.66, 0.10)
PINK, LPINK, WHITE, YELLOW = (0.92, 0.28, 0.47), (0.96, 0.50, 0.65), (0.92, 0.90, 0.86), (0.95, 0.75, 0.12)
SAND = (0.76, 0.67, 0.46)
STRATA = [(0.60, 0.40, 0.24), (0.78, 0.60, 0.38), (0.50, 0.29, 0.22), (0.70, 0.50, 0.30), (0.50, 0.37, 0.36), (0.82, 0.66, 0.43)]


def A(c, k=None):
    k = ALB if k is None else k
    return (c[0] * k, c[1] * k, c[2] * k, 1.0)


def lerp(a, b, t):
    a, b = np.asarray(a, float), np.asarray(b, float)
    t = np.asarray(t, float)[..., None]
    return a * (1 - t) + b * t


# ----------------------------------------------------------------------------- 着色工具
def new_mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.node_tree.nodes.clear()
    return m, m.node_tree


def fog_group():
    ng = bpy.data.node_groups.get('WK_Fog')
    if ng:
        return ng
    ng = bpy.data.node_groups.new('WK_Fog', 'ShaderNodeTree')
    ng.interface.new_socket('Shader', in_out='INPUT', socket_type='NodeSocketShader')
    ng.interface.new_socket('Shader', in_out='OUTPUT', socket_type='NodeSocketShader')
    N, L = ng.nodes, ng.links
    gi, go = N.new('NodeGroupInput'), N.new('NodeGroupOutput')
    cam = N.new('ShaderNodeCameraData')
    m1 = N.new('ShaderNodeMath'); m1.operation = 'MULTIPLY'; m1.name = 'FOG_DENSITY'
    L.new(cam.outputs['View Distance'], m1.inputs[0]); m1.inputs[1].default_value = -FOG_DENS
    m2 = N.new('ShaderNodeMath'); m2.operation = 'EXPONENT'; L.new(m1.outputs[0], m2.inputs[0])
    m3 = N.new('ShaderNodeMath'); m3.operation = 'SUBTRACT'; m3.inputs[0].default_value = 1.0; L.new(m2.outputs[0], m3.inputs[1])
    m4 = N.new('ShaderNodeMath'); m4.operation = 'MINIMUM'; m4.name = 'FOG_MAX'
    L.new(m3.outputs[0], m4.inputs[0]); m4.inputs[1].default_value = FOG_MAX
    em = N.new('ShaderNodeEmission'); em.name = 'FOG_COLOR'
    em.inputs['Color'].default_value = (*FOG_COLOR, 1)
    mix = N.new('ShaderNodeMixShader')
    L.new(m4.outputs[0], mix.inputs[0]); L.new(gi.outputs[0], mix.inputs[1]); L.new(em.outputs[0], mix.inputs[2])
    L.new(mix.outputs[0], go.inputs[0])
    return ng


def out_fog(nt, shader):
    g = nt.nodes.new('ShaderNodeGroup')
    g.node_tree = fog_group()
    o = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(shader, g.inputs[0])
    nt.links.new(g.outputs[0], o.inputs['Surface'])


def lk(nt, v, sock):
    if hasattr(v, 'is_linked'):
        nt.links.new(v, sock)
    else:
        sock.default_value = v


def diffuse(nt, col, normal=None):
    d = nt.nodes.new('ShaderNodeBsdfDiffuse')
    lk(nt, col, d.inputs['Color'])
    d.inputs['Roughness'].default_value = 1.0
    if normal is not None:
        lk(nt, normal, d.inputs['Normal'])
    return d.outputs[0]


def attr_node(nt, name):
    n = nt.nodes.new('ShaderNodeAttribute')
    n.attribute_name = name
    return n


def ramp(nt, fac, stops, interp='LINEAR'):
    n = nt.nodes.new('ShaderNodeValToRGB')
    cr = n.color_ramp
    cr.interpolation = interp
    stops = sorted(stops, key=lambda s: s[0])
    cr.elements[0].position = stops[0][0]
    cr.elements[1].position = stops[-1][0]
    for p, _ in stops[1:-1]:
        cr.elements.new(p)
    for e, (p, c) in zip(sorted(cr.elements, key=lambda e: e.position), stops):
        e.color = (c[0], c[1], c[2], 1.0)
    lk(nt, fac, n.inputs[0])
    return n.outputs[0]


def up_normal(nt):
    c = nt.nodes.new('ShaderNodeCombineXYZ')
    c.inputs[2].default_value = 1.0
    return c.outputs[0]


def time_node(nt, fps=30.0):
    """秒：随帧变化的驱动（简单表达式，不需要开自动执行脚本）。"""
    v = nt.nodes.new('ShaderNodeValue')
    v.name = 'WK_TIME'
    d = v.outputs[0].driver_add('default_value')
    d.driver.type = 'SCRIPTED'
    d.driver.expression = f'frame/{fps}'
    return v.outputs[0]


def toon(nt, shadow, mid, light, t1=0.34, t2=0.58, soft=0.035):
    """赛璐璐三段色：白色漫反射 → Shader to RGB → 色带 → 自发光（仍然接收阴影）。"""
    d = nt.nodes.new('ShaderNodeBsdfDiffuse')
    d.inputs['Color'].default_value = (1, 1, 1, 1)
    s2r = nt.nodes.new('ShaderNodeShaderToRGB')
    nt.links.new(d.outputs[0], s2r.inputs[0])
    bw = nt.nodes.new('ShaderNodeRGBToBW')
    nt.links.new(s2r.outputs[0], bw.inputs[0])
    v = math_node(nt, 'MULTIPLY', bw.outputs[0], 0.5)
    col = ramp(nt, v, [(0.0, shadow), (t1 - soft, shadow), (t1 + soft, mid), (t2 - soft, mid), (t2 + soft, light), (1.0, light)])
    return col


def strata_color(nt, pos):
    """横向岩层条带：按世界高度分段取色，条带略带波浪。"""
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(pos, sep.inputs[0])
    n1 = noise_node(nt, pos, 0.010, 2.0, 0.5)
    z1 = math_node(nt, 'ADD', math_node(nt, 'MULTIPLY', sep.outputs[2], 1.0 / 46.0), math_node(nt, 'MULTIPLY', n1, 0.5))
    f1 = math_node(nt, 'FRACT', z1)
    stops = [(i / len(STRATA), A(c)) for i, c in enumerate(STRATA)] + [(0.07, A(STRATA[4])), (0.40, A(STRATA[2])), (0.58, A(STRATA[5])), (0.90, A(STRATA[0]))]
    c1 = ramp(nt, f1, stops, 'CONSTANT')
    c1 = mix_rgb(nt, 0.42, c1, A((0.68, 0.50, 0.32)))
    # 细条带明暗
    z2 = math_node(nt, 'ADD', math_node(nt, 'MULTIPLY', sep.outputs[2], 1.0 / 9.5), math_node(nt, 'MULTIPLY', n1, 2.5))
    c2 = ramp(nt, math_node(nt, 'FRACT', z2), [(0.0, (1, 1, 1)), (0.6, (0.93, 0.90, 0.90)), (0.82, (1.04, 1.03, 1.0))], 'CONSTANT')
    col = mix_rgb(nt, 1.0, c1, c2, 'MULTIPLY')
    # 竖向柔和笔触
    st = noise_node(nt, pos, 1.0, 2.0, 0.5, sx=0.07, sy=0.07, sz=0.004)
    col = mix_rgb(nt, map_range(nt, st, 0.35, 0.7, 0.0, 0.22), col, A((0.42, 0.30, 0.34)))
    return col


def brush(nt, col, pos, amt=0.10):
    """手绘笔触感：大色块 + 细笔触的轻微明度变化（不引入脏噪点）。"""
    b1 = noise_node(nt, pos, 0.035, 2.0, 0.5)
    b2 = noise_node(nt, pos, 1.0, 1.0, 0.5, sx=0.9, sy=0.25, sz=0.5)
    v = math_node(nt, 'ADD', math_node(nt, 'MULTIPLY', b1, 0.6), math_node(nt, 'MULTIPLY', b2, 0.4))
    g = map_range(nt, v, 0.3, 0.7, 1.0 - amt, 1.0 + amt)
    hs = nt.nodes.new('ShaderNodeHueSaturation')
    nt.links.new(col, hs.inputs['Color'])
    nt.links.new(g, hs.inputs['Value'])
    return hs.outputs[0]


def lifted(nt, col, amt):
    """漫反射 + 少量同色自发光：暗部保留色相（二次元的“透气”阴影）。"""
    em = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(col, em.inputs['Color'])
    em.inputs['Strength'].default_value = amt
    add = nt.nodes.new('ShaderNodeAddShader')
    nt.links.new(diffuse(nt, col), add.inputs[0])
    nt.links.new(em.outputs[0], add.inputs[1])
    return add.outputs[0]


def mat_ground():
    m, nt = new_mat('WK_Ground')
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    pos = geo.outputs['Position']
    col = attr_node(nt, 'col').outputs['Color']
    rock = attr_node(nt, 'rock').outputs[2]
    c = mix_rgb(nt, rock, brush(nt, col, pos, 0.07), strata_color(nt, pos))
    out_fog(nt, lifted(nt, c, 0.16))
    return m


def mat_pillar(name, veg_bias=0.0):
    m, nt = new_mat(name)
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    pos = geo.outputs['Position']
    veg = attr_node(nt, 'veg').outputs[2]
    vn = noise_node(nt, pos, 0.05, 2.0, 0.5)
    vm = map_range(nt, math_node(nt, 'ADD', math_node(nt, 'ADD', veg, veg_bias), math_node(nt, 'MULTIPLY', math_node(nt, 'SUBTRACT', vn, 0.5), 0.7 + veg_bias)), 0.40, 0.52)
    gn = noise_node(nt, pos, 0.02, 1.0, 0.5)
    green = mix_rgb(nt, map_range(nt, gn, 0.35, 0.65), A(G1), A(G2))
    c = mix_rgb(nt, vm, strata_color(nt, pos), green)
    out_fog(nt, lifted(nt, c, 0.32))
    return m


def mat_crown(name, shadow, mid, light):
    m, nt = new_mat(name)
    col = toon(nt, shadow, mid, light)
    h = attr_node(nt, 'h').outputs[2]               # 树冠内的相对高度：顶部提亮
    col = mix_rgb(nt, map_range(nt, h, 0.3, 1.0, 0.0, 0.35), col, (*light, 1))
    em = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(col, em.inputs['Color'])
    out_fog(nt, em.outputs[0])
    return m


def mat_flat(name, color, normal_up=False):
    m, nt = new_mat(name)
    out_fog(nt, diffuse(nt, A(color), up_normal(nt) if normal_up else None))
    return m


def mat_plant():
    m, nt = new_mat('WK_Plant')
    col = attr_node(nt, 'pc').outputs['Color']
    out_fog(nt, diffuse(nt, col, up_normal(nt)))
    return m


def mat_water():
    m, nt = new_mat('WK_Water')
    L = nt.links
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    pos = geo.outputs['Position']
    t = time_node(nt)
    shore = attr_node(nt, 'shore').outputs[2]
    depth = map_range(nt, shore, 0.0, 58.0)
    col = ramp(nt, depth, [(0.0, (0.22, 0.82, 0.74)), (0.16, (0.05, 0.56, 0.80)), (0.5, (0.015, 0.30, 0.74)), (1.0, (0.008, 0.15, 0.56))], 'EASE')
    # 视角渐变：近处深、远处（掠射角）映出天空的浅蓝
    lw = nt.nodes.new('ShaderNodeLayerWeight')
    lw.inputs['Blend'].default_value = 0.5
    col = mix_rgb(nt, map_range(nt, lw.outputs['Facing'], 0.55, 1.0, 0.0, 0.40), col, (0.20, 0.62, 0.96, 1))
    # 流动的波纹短线（沿 +X 拉长）
    def flow(sx_, sy_, speed, seed):
        mp = nt.nodes.new('ShaderNodeMapping')
        mp.inputs['Scale'].default_value = (sx_, sy_, 1.0)
        cx = nt.nodes.new('ShaderNodeCombineXYZ')
        L.new(math_node(nt, 'MULTIPLY', t, -speed * sx_), cx.inputs[0])
        cx.inputs[1].default_value = seed
        L.new(math_node(nt, 'MULTIPLY', t, 0.06), cx.inputs[2])
        L.new(cx.outputs[0], mp.inputs['Location'])
        L.new(pos, mp.inputs['Vector'])
        n = nt.nodes.new('ShaderNodeTexNoise')
        n.inputs['Scale'].default_value = 1.0; n.inputs['Detail'].default_value = 1.0
        L.new(mp.outputs[0], n.inputs['Vector'])
        return n.outputs[0]
    f1 = flow(0.045, 0.62, 9.0, 0.0)
    f2 = flow(0.11, 1.3, 14.0, 37.0)
    line = math_node(nt, 'MULTIPLY', map_range(nt, f1, 0.655, 0.668), map_range(nt, f1, 0.70, 0.688))
    line2 = math_node(nt, 'MULTIPLY', map_range(nt, f2, 0.66, 0.675), map_range(nt, f2, 0.715, 0.70))
    lines = math_node(nt, 'MAXIMUM', line, math_node(nt, 'MULTIPLY', line2, 0.7))
    col = mix_rgb(nt, map_range(nt, f1, 0.30, 0.42, 0.22, 0.0), col, (0.008, 0.10, 0.42, 1))       # 暗色水纹块
    col = mix_rgb(nt, math_node(nt, 'MULTIPLY', lines, 0.62), col, (0.78, 0.95, 1.0, 1))
    # 岸边白色浪花线：贴岸一圈 + 向岸推进的波纹线
    wn = noise_node(nt, pos, 0.09, 2.0, 0.5)
    ph = math_node(nt, 'ADD', math_node(nt, 'SUBTRACT', math_node(nt, 'MULTIPLY', shore, 0.75), math_node(nt, 'MULTIPLY', t, 1.3)), math_node(nt, 'MULTIPLY', wn, 5.0))
    wave = map_range(nt, math_node(nt, 'SINE', ph), 0.88, 0.95)
    wave = math_node(nt, 'MULTIPLY', wave, map_range(nt, shore, 2.0, 16.0, 1.0, 0.0))
    wave = math_node(nt, 'MULTIPLY', wave, map_range(nt, wn, 0.36, 0.48))
    edge = map_range(nt, math_node(nt, 'ADD', shore, math_node(nt, 'MULTIPLY', wn, 2.4)), 1.7, 2.2, 1.0, 0.0)
    foam = math_node(nt, 'MAXIMUM', wave, edge)
    col = mix_rgb(nt, foam, col, (0.97, 0.99, 1.0, 1))
    em = nt.nodes.new('ShaderNodeEmission')
    L.new(col, em.inputs['Color'])
    em.inputs['Strength'].default_value = 0.50
    gl = nt.nodes.new('ShaderNodeBsdfGlossy')
    gl.inputs['Roughness'].default_value = 0.10
    gl.inputs['Color'].default_value = (1, 1, 1, 1)
    dif = diffuse(nt, mix_rgb(nt, 0.62, col, (0, 0, 0, 1)), up_normal(nt))
    add = nt.nodes.new('ShaderNodeAddShader')
    L.new(em.outputs[0], add.inputs[0]); L.new(dif, add.inputs[1])
    mx = nt.nodes.new('ShaderNodeMixShader')
    mx.inputs[0].default_value = 0.06
    L.new(add.outputs[0], mx.inputs[1]); L.new(gl.outputs[0], mx.inputs[2])
    out_fog(nt, mx.outputs[0])
    return m


def mat_fall():
    m, nt = new_mat('WK_Waterfall')
    L = nt.links
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    t = time_node(nt)
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (0.75, 0.0, 0.030)
    cx = nt.nodes.new('ShaderNodeCombineXYZ')
    L.new(math_node(nt, 'MULTIPLY', t, 0.85), cx.inputs[2])
    L.new(cx.outputs[0], mp.inputs['Location'])
    L.new(geo.outputs['Position'], mp.inputs['Vector'])
    n = nt.nodes.new('ShaderNodeTexNoise')
    n.inputs['Scale'].default_value = 1.0; n.inputs['Detail'].default_value = 2.0
    L.new(mp.outputs[0], n.inputs['Vector'])
    col = ramp(nt, n.outputs[0], [(0.0, (0.36, 0.70, 0.95)), (0.42, (0.58, 0.85, 0.98)), (0.54, (0.97, 0.99, 1.0)), (1.0, (1.0, 1.0, 1.0))], 'EASE')
    em = nt.nodes.new('ShaderNodeEmission')
    L.new(col, em.inputs['Color'])
    em.inputs['Strength'].default_value = 0.95
    out_fog(nt, em.outputs[0])
    return m


def mat_mist():
    m, nt = new_mat('WK_Mist')
    L = nt.links
    lw = nt.nodes.new('ShaderNodeLayerWeight')
    lw.inputs['Blend'].default_value = 0.35
    a = map_range(nt, lw.outputs['Facing'], 0.15, 0.9, 0.26, 0.0)
    em = nt.nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (0.95, 0.98, 1.0, 1)
    em.inputs['Strength'].default_value = 0.95
    tr = nt.nodes.new('ShaderNodeBsdfTransparent')
    mx = nt.nodes.new('ShaderNodeMixShader')
    L.new(a, mx.inputs[0]); L.new(tr.outputs[0], mx.inputs[1]); L.new(em.outputs[0], mx.inputs[2])
    o = nt.nodes.new('ShaderNodeOutputMaterial')
    L.new(mx.outputs[0], o.inputs['Surface'])
    for prop, val in (('surface_render_method', 'BLENDED'), ('blend_method', 'BLEND')):
        try:
            setattr(m, prop, val)
        except Exception:
            pass
    return m


def mat_far(name, color, haze_mix=0.45):
    m, nt = new_mat(name)
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(geo.outputs['Position'], sep.inputs[0])
    g = map_range(nt, sep.outputs[2], 0.0, 420.0, haze_mix, 0.0)
    col = mix_rgb(nt, g, (*color, 1), (*FOG_COLOR, 1))
    em = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(col, em.inputs['Color'])
    o = nt.nodes.new('ShaderNodeOutputMaterial')
    nt.links.new(em.outputs[0], o.inputs['Surface'])
    return m


# ----------------------------------------------------------------------------- 地形
def ground_color(X, Y, Z, NZ):
    yc = EH.river_center(X); w = EH.river_halfwidth(X)
    d = Y - yc
    tL = d - w
    n1 = EH.fbm2(X / 95 + 1.3, Y / 95 + 4.1, 3)
    n2 = EH.fbm2(X / 28 + 7.7, Y / 28 + 2.9, 2)
    g = lerp(G1, G2, sstep(0.36, 0.56, n1))
    g = lerp(g, G3, sstep(0.48, 0.75, n2) * 0.8)
    zone = sstep(10, 38, tL) * (1 - sstep(440, 530, tL)) * sstep(-950, -860, X) * (1 - sstep(1300, 1450, X))
    fl = sstep(0.40, 0.54, EH.fbm2(X / 75 + 11.0, Y / 75 + 3.0, 3)) * zone
    col = lerp(g, lerp(PINK, LPINK, n2), 0.82 * fl)
    wm = sstep(0.60, 0.68, EH.fbm2(X / 42 + 2.0, Y / 42 + 9.0, 2)) * zone * (1 - fl)
    col = lerp(col, WHITE, 0.55 * wm)
    ym = sstep(0.66, 0.72, EH.fbm2(X / 33 + 8.0, Y / 33 + 1.0, 2)) * zone * (1 - fl)
    col = lerp(col, YELLOW, 0.6 * ym)
    sand = (1 - sstep(0.4, 1.8, Z)) * sstep(0.70, 0.9, NZ)
    col = lerp(col, SAND, sand)
    col = np.where((Z < -0.55)[..., None], np.array([0.20, 0.52, 0.55]), col)
    rock = sstep(0.82, 0.66, NZ) * (Z > 0.0)
    return col * ALB, rock, fl


def build_ground(mat):
    step = 3.5 if not QUICK else 10.0
    xs = np.arange(-1900.0, 1900.0 + step, step)
    ys = np.arange(-1150.0, 1500.0 + step, step)
    X, Y = np.meshgrid(xs, ys)
    Z = EH.ground_height(X, Y)
    gy, gx = np.gradient(Z, step)
    NZ = 1.0 / np.sqrt(1 + gx * gx + gy * gy)
    col, rock, _ = ground_color(X, Y, Z, NZ)
    ny, nx = X.shape
    V = np.stack([X, Y, Z], -1).reshape(-1, 3)
    i = np.arange(ny - 1)[:, None]; j = np.arange(nx - 1)[None, :]
    a = i * nx + j
    quads = np.stack([a, a + 1, a + nx + 1, a + nx], -1).reshape(-1, 4)
    me = mesh_from_arrays('ENV_Ground', V, quads)
    ca = me.attributes.new('col', 'FLOAT_COLOR', 'POINT')
    ca.data.foreach_set('color', np.concatenate([col.reshape(-1, 3), np.ones((len(V), 1))], 1).astype(np.float32).ravel())
    set_attr(me, 'rock', rock.ravel())
    me.materials.append(mat)
    log('ground', X.shape, len(V))
    return bpy.data.objects.new('ENV_Ground', me), (xs[0], xs[-1], ys[0], ys[-1])


def build_outer(mat, rect):
    step = 45.0 if not QUICK else 120.0
    xs = np.arange(-11000.0, 11000.0 + step, step)
    X, Y = np.meshgrid(xs, xs)
    Z = EH.ground_height(X, Y)
    yc = EH.river_center(X); w = EH.river_halfwidth(X)
    far = sstep(1900, 2600, np.hypot(X, Y)) * sstep(w + 200, w + 500, np.abs(Y - yc))
    F1, F2, v1, v2 = worley2(X + 80 * (EH.fbm2(X / 300, Y / 300) - 0.5), Y, 430.0, 5)
    cone = np.clip(1 - F1 / (430.0 * 0.40), 0, 1) ** 0.55 * (v1 > 0.42) * (140 + 300 * v1)
    Z = Z + cone * far - 2.5
    gy, gx = np.gradient(Z, step)
    NZ = 1.0 / np.sqrt(1 + gx * gx + gy * gy)
    col, rock, _ = ground_color(X, Y, Z + 2.5, NZ)
    col = lerp(col, np.array(G1) * ALB, far * 0.5)
    ny, nx = X.shape
    V = np.stack([X, Y, Z], -1).reshape(-1, 3)
    i = np.arange(ny - 1)[:, None]; j = np.arange(nx - 1)[None, :]
    a = (i * nx + j)
    quads = np.stack([a, a + 1, a + nx + 1, a + nx], -1).reshape(-1, 4)
    cx, cy = X[:-1, :-1] + step / 2, Y[:-1, :-1] + step / 2
    inside = (cx > rect[0] + step) & (cx < rect[1] - step) & (cy > rect[2] + step) & (cy < rect[3] - step)
    quads = quads[~inside.ravel()]
    me = mesh_from_arrays('ENV_GroundFar', V, quads)
    ca = me.attributes.new('col', 'FLOAT_COLOR', 'POINT')
    ca.data.foreach_set('color', np.concatenate([col.reshape(-1, 3), np.ones((len(V), 1))], 1).astype(np.float32).ravel())
    set_attr(me, 'rock', (rock * 0.9).ravel())
    me.materials.append(mat)
    return bpy.data.objects.new('ENV_GroundFar', me)


def tower_list():
    """湖中桂林式孤峰：(x, 离江心偏移 d, 半径, 高度)。水道 ≥ 60 m，江心线两侧 35 m 净空。"""
    return [(610.0, 118.0, 26.0, 105.0), (735.0, -128.0, 30.0, 140.0), (800.0, 172.0, 24.0, 88.0),
            (905.0, -112.0, 22.0, 120.0), (965.0, 122.0, 28.0, 72.0), (690.0, 205.0, 18.0, 60.0)]


def build_water(mat):
    step = 4.0
    xs = np.arange(-1900.0, 1900.0 + step, step)
    sv = np.linspace(-1.0, 1.0, 81)
    X = xs[None, :] + np.zeros((len(sv), 1))
    w = EH.river_halfwidth(X) + 10.0
    Y = EH.river_center(X) + sv[:, None] * w
    shore = (w - 10.0) - np.abs(Y - EH.river_center(X))
    for (tx, td, tr, th) in tower_list():
        ty = float(EH.river_center(tx)) + td
        shore = np.minimum(shore, np.hypot(X - tx, Y - ty) - tr * 1.45)
    fy = float(EH.river_center(EH.FALL_X)) - 45.0
    shore = np.minimum(shore, np.maximum(np.hypot(X - EH.FALL_X, (Y - fy) * 0.8) - 16.0, 0.0) * 0.6 + 0.3)
    ny, nx = X.shape
    V = np.stack([X, Y, np.zeros_like(X)], -1).reshape(-1, 3)
    i = np.arange(ny - 1)[:, None]; j = np.arange(nx - 1)[None, :]
    a = i * nx + j
    quads = np.stack([a, a + 1, a + nx + 1, a + nx], -1).reshape(-1, 4)
    me = mesh_from_arrays('ENV_Water', V, quads)
    set_attr(me, 'shore', shore.ravel())
    me.materials.append(mat)
    ob = bpy.data.objects.new('ENV_Water', me)
    # 远处的水面（大平面，略低）
    R = 11000.0
    me2 = mesh_from_arrays('ENV_WaterFar', np.array([[-R, -R, -0.12], [R, -R, -0.12], [R, R, -0.12], [-R, R, -0.12]]), np.array([[0, 1, 2, 3]]))
    set_attr(me2, 'shore', np.full(4, 30.0))
    me2.materials.append(mat)
    return ob, bpy.data.objects.new('ENV_WaterFar', me2)


def build_fall(mat_f, mat_m, mat_w):
    x0 = EH.FALL_X
    xs = np.linspace(x0 - 13.0, x0 + 13.0, 14)
    zs = np.linspace(0.0, 1.0, 40)
    yc = EH.river_center(xs); w = EH.river_halfwidth(xs)
    H = EH.cliff_height(xs) - 1.0
    s, wc = EH.cliff_params(xs)
    Zg = zs[:, None] * H[None, :]
    tface = s[None, :] + wc[None, :] * np.clip(Zg / H[None, :], 0, 1) ** (1 / 0.8)
    bulge = 3.0 + 1.5 * np.sin(np.linspace(0, np.pi, 14))[None, :] + 2.5 * (1 - zs[:, None]) ** 2
    Y = yc[None, :] - w[None, :] - tface + bulge
    X = xs[None, :] + np.zeros_like(Y)
    V = np.stack([X, Y, Zg], -1).reshape(-1, 3)
    ny, nx = X.shape
    i = np.arange(ny - 1)[:, None]; j = np.arange(nx - 1)[None, :]
    a = i * nx + j
    quads = np.stack([a + 1, a, a + nx, a + nx + 1], -1).reshape(-1, 4)
    me = mesh_from_arrays('ENV_Waterfall', V, quads)
    me.materials.append(mat_f)
    objs = [bpy.data.objects.new('ENV_Waterfall', me)]
    # 崖顶溪流（顺着溪沟）
    yy = np.linspace(0.0, 300.0, 60)
    ycf, wf = float(EH.river_center(x0)), float(EH.river_halfwidth(x0))
    sf, wcf = [float(v) for v in EH.cliff_params(x0)]
    ytop = ycf - wf - sf - wcf
    sx = np.array([-6.5, 6.5])
    SX = x0 + sx[None, :] + 4.0 * np.sin(yy[:, None] / 40.0)
    SY = (ytop + 2.0 - yy)[:, None] + np.zeros((1, 2))
    SZ = EH.ground_height(np.full_like(yy, x0), ytop - yy - 1.0)[:, None] + 1.3 + np.zeros((1, 2))
    SZ[0] = float(H.mean())
    V2 = np.stack([SX, SY, SZ], -1).reshape(-1, 3)
    i = np.arange(len(yy) - 1)[:, None]
    a = i * 2
    q2 = np.stack([a, a + 1, a + 3, a + 2], -1).reshape(-1, 4)
    me2 = mesh_from_arrays('ENV_Stream', V2, q2)
    set_attr(me2, 'shore', np.tile(np.array([0.5, 0.5]), len(yy)) + 8.0)
    me2.materials.append(mat_w)
    objs.append(bpy.data.objects.new('ENV_Stream', me2))
    # 底部水雾
    rng = np.random.default_rng(3)
    bv, bf = ICO[2]
    MV, MT, off = [], [], 0
    ybase = ycf - wf - sf + 6.0
    for k in range(9):
        c = np.array([x0 + rng.uniform(-13, 13), ybase + rng.uniform(-5, 7), rng.uniform(1.5, 6)])
        r = rng.uniform(4, 8)
        MV.append(bv * np.array([r, r * 0.9, r * 0.6]) + c)
        MT.append(bf + off); off += len(bv)
    me3 = mesh_from_arrays('ENV_FallMist', np.concatenate(MV), None, np.concatenate(MT))
    me3.materials.append(mat_m)
    objs.append(bpy.data.objects.new('ENV_FallMist', me3))
    return objs


# ----------------------------------------------------------------------------- 团块树（二次元）
def _ico(sub):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
    v = np.array([p.co[:] for p in bm.verts])
    f = np.array([[q.index for q in fc.verts] for fc in bm.faces])
    bm.free()
    return v, f


ICO = {}


def build_blob_tree(name, seed, kind, lod, m_trunk, m_crown):
    rng = np.random.default_rng(seed)
    bv, bf = ICO[2 if lod == 0 else 1]
    nzn = VNoise(seed + 5, 16)
    BV, BT, BH = [], [], []
    TV, TQ = None, None

    def blob(c, r, sq=(1.0, 1.0, 1.0)):
        c = np.asarray(c, float)
        k = 1 + 0.28 * (fbm(nzn, bv[:, 0] * 1.4 + c[0], bv[:, 1] * 1.4 + c[1], bv[:, 2] * 1.4 + c[2], 2) - 0.5) * 2
        BV.append(bv * k[:, None] * r * np.asarray(sq) + c)
        BT.append(bf)

    def trunk(h, r0, lean=0.06):
        nonlocal TV, TQ
        t = np.linspace(0, 1, 5)
        l = rng.normal(0, lean, 2) * h
        path = np.stack([l[0] * t ** 2, l[1] * t ** 2, h * t], -1)
        TV, TQ = _tube(path, r0 * (1 - 0.6 * t) + 0.02, 5 if lod == 0 else 3)
        return path[-1]

    if kind == 'peach':
        top = trunk(rng.uniform(2.6, 3.4), 0.22, 0.12)
        for k in range(int(rng.integers(11, 15))):
            a = rng.random() * 6.28; rr = rng.uniform(0.3, 2.5)
            blob(top + [math.cos(a) * rr, math.sin(a) * rr, rng.uniform(0.0, 2.1) * (1.15 - rr / 3.2)], rng.uniform(0.85, 1.45), (1, 1, 0.82))
    elif kind == 'round':
        top = trunk(rng.uniform(4.5, 6.5), 0.3)
        for k in range(int(rng.integers(6, 9))):
            a = rng.random() * 6.28; rr = rng.uniform(0.5, 2.6)
            blob(top + [math.cos(a) * rr, math.sin(a) * rr, rng.uniform(0.0, 3.4)], rng.uniform(1.8, 2.9), (1, 1, 0.85))
    elif kind == 'pine':
        h = rng.uniform(10.0, 14.0)
        top = trunk(h, 0.32, 0.10)
        npad = int(rng.integers(4, 6))
        for k in range(npad):
            tb = 0.5 + 0.5 * k / (npad - 1)
            a = k * 2.4 + rng.random()
            off = 0.0 if k == npad - 1 else rng.uniform(1.4, 2.8)
            r = rng.uniform(2.2, 3.4) * (1.15 - 0.35 * tb)
            blob([top[0] * tb ** 2 + math.cos(a) * off, top[1] * tb ** 2 + math.sin(a) * off, h * tb], r, (1, 1, 0.30))
    else:   # bush
        for k in range(int(rng.integers(2, 4))):
            r = rng.uniform(0.7, 1.2)
            blob([rng.normal(0, 0.6), rng.normal(0, 0.6), r * 0.6], r, (1, 1, 0.8))
    nt_v = 0 if TV is None else len(TV)
    Vb = np.concatenate(BV)
    zb = Vb[:, 2]
    hh = (zb - zb.min()) / max(zb.max() - zb.min(), 1e-6)
    tris, off = [], nt_v
    for v, t in zip(BV, BT):
        tris.append(t + off); off += len(v)
    V = Vb if TV is None else np.concatenate([TV, Vb])
    if kind == 'peach':
        V = V * 1.5
    me = mesh_from_arrays(name, V, TQ, np.concatenate(tris))
    set_attr(me, 'h', np.concatenate([np.zeros(nt_v), hh]))
    me.materials.append(m_trunk); me.materials.append(m_crown)
    nq = 0 if TQ is None else len(TQ)
    me.polygons.foreach_set('material_index', np.concatenate([np.zeros(nq, np.int32), np.ones(len(me.polygons) - nq, np.int32)]))
    return bpy.data.objects.new(name, me)


TREE_KINDS = ['peach', 'peach', 'peach', 'round', 'round', 'pine', 'pine', 'bush', 'pbush']   # 序号即 tid


def build_plants(mat):
    """草丛 ×3 + 花 ×5（顶点色 pc）。返回物体列表，顺序即 tid。"""
    rng = np.random.default_rng(42)
    out = []
    for k in range(3):
        V, Q, T, C = [], [], [], []
        vi = 0
        nb = 5
        for b in range(nb):
            a = b * 6.283 / nb + rng.random()
            h = rng.uniform(0.45, 0.85)
            wd = rng.uniform(0.05, 0.085)
            dirv = np.array([math.cos(a), math.sin(a), 0.0])
            side = np.array([-math.sin(a), math.cos(a), 0.0])
            base = dirv * rng.uniform(0.02, 0.12)
            lean = rng.uniform(0.15, 0.5)
            p0, p1 = base - side * wd, base + side * wd
            m = base + dirv * lean * h * 0.35 + np.array([0, 0, h * 0.55])
            p2, p3 = m - side * wd * 0.7, m + side * wd * 0.7
            tip = base + dirv * lean * h + np.array([0, 0, h])
            V += [p0, p1, p3, p2, tip]
            Q.append([vi, vi + 1, vi + 2, vi + 3]); T.append([vi + 3, vi + 2, vi + 4])
            cb, cm, ct = np.array(G1) * 0.9, np.array(G2), np.array(G3) * 1.05
            C += [cb, cb, cm, cm, ct]
            vi += 5
        me = mesh_from_arrays(f'plant_{k:02d}_grass', np.array(V), np.array(Q), np.array(T))
        ca = me.attributes.new('pc', 'FLOAT_COLOR', 'POINT')
        ca.data.foreach_set('color', np.concatenate([np.array(C) * ALB, np.ones((len(C), 1))], 1).astype(np.float32).ravel())
        me.materials.append(mat)
        out.append(bpy.data.objects.new(me.name, me))
    petals = [PINK, LPINK, WHITE, YELLOW, (0.80, 0.50, 0.92)]
    for k, pc in enumerate(petals):
        V, Q, T, C = [], [], [], []
        h = 0.55 + 0.12 * k % 0.3
        r = 0.23 + 0.03 * (k % 3)
        sw = 0.012
        V += [[-sw, 0, 0], [sw, 0, 0], [sw, 0, h], [-sw, 0, h]]
        Q.append([0, 1, 2, 3]); C += [np.array(G1)] * 4
        vi = 4
        tilt = np.array([0.15, 0.1, 0.0])
        for p in range(5):
            a0, a1, am = p * 1.2566 - 0.45, p * 1.2566 + 0.45, p * 1.2566
            c0 = np.array([0, 0, h])
            e0 = c0 + np.array([math.cos(a0) * r * 0.75, math.sin(a0) * r * 0.75, 0.05])
            e1 = c0 + np.array([math.cos(a1) * r * 0.75, math.sin(a1) * r * 0.75, 0.05])
            em = c0 + np.array([math.cos(am) * r, math.sin(am) * r, 0.02]) + tilt * 0.0
            V += [c0, e0, em, e1]
            Q.append([vi, vi + 1, vi + 2, vi + 3])
            C += [np.array(pc) * 0.8, np.array(pc), np.array(pc) * 1.08, np.array(pc)]
            vi += 4
        # 花心
        cc = np.array([0, 0, h + 0.03])
        V += [cc + [0.04, 0, 0], cc + [0, 0.04, 0], cc + [-0.04, 0, 0], cc + [0, -0.04, 0]]
        Q.append([vi, vi + 1, vi + 2, vi + 3]); C += [np.array(YELLOW) * 0.9] * 4
        me = mesh_from_arrays(f'plant_{k + 3:02d}_flower', np.array(V, float), np.array(Q))
        ca = me.attributes.new('pc', 'FLOAT_COLOR', 'POINT')
        ca.data.foreach_set('color', np.concatenate([np.clip(np.array(C), 0, 1.2) * ALB * 1.15, np.ones((len(C), 1))], 1).astype(np.float32).ravel())
        me.materials.append(mat)
        out.append(bpy.data.objects.new(me.name, me))
    return out


def build_pagoda(mats):
    """五层楼阁：红柱身 + 灰瓦飞檐 + 金顶。原点在底面中心。"""
    m_red, m_roof, m_gold, m_base = mats
    V, Q, MI = [], [], []
    vi = 0

    def box(cx, cy, z0, z1, hw, mi):
        nonlocal vi
        p = [[cx - hw, cy - hw, z0], [cx + hw, cy - hw, z0], [cx + hw, cy + hw, z0], [cx - hw, cy + hw, z0],
             [cx - hw, cy - hw, z1], [cx + hw, cy - hw, z1], [cx + hw, cy + hw, z1], [cx - hw, cy + hw, z1]]
        V.extend(p)
        for f in ([0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], [4, 5, 6, 7], [3, 2, 1, 0]):
            Q.append([vi + q for q in f]); MI.append(mi)
        vi += 8

    def roof(z0, half, rh, mi):
        nonlocal vi
        n = 9
        u = np.linspace(-1, 1, n)
        U, W = np.meshgrid(u, u)
        r = np.maximum(np.abs(U), np.abs(W))
        Zr = z0 + rh * (1 - r) ** 1.7 + half * 0.16 * (np.abs(U * W)) ** 2.2 - half * 0.03
        P = np.stack([U * half, W * half, Zr], -1).reshape(-1, 3)
        V.extend(P.tolist())
        for i in range(n - 1):
            for j in range(n - 1):
                a = vi + i * n + j
                Q.append([a, a + 1, a + n + 1, a + n]); MI.append(mi)
        vi += n * n

    box(0, 0, 0.0, 2.2, 9.5, 3)
    z = 2.2
    hw = 6.2
    for tier in range(5):
        th = 6.0 - tier * 0.45
        box(0, 0, z, z + th, hw, 0)
        roof(z + th - 0.6, hw * 1.75, 3.4 - tier * 0.25, 1)
        z += th + 1.5
        hw *= 0.84
    box(0, 0, z - 1.0, z + 5.5, 0.35, 2)
    me = mesh_from_arrays('ENV_Pagoda', np.array(V, float), np.array(Q))
    for m in (m_red, m_roof, m_gold, m_base):
        me.materials.append(m)
    me.polygons.foreach_set('material_index', np.array(MI, np.int32))
    me.polygons.foreach_set('use_smooth', np.zeros(len(me.polygons), bool))
    return bpy.data.objects.new('ENV_Pagoda', me)


def build_far_rings():
    objs = []
    layers = [(3300, 300, (0.13, 0.36, 0.56)), (4400, 420, (0.19, 0.44, 0.65)), (5800, 560, (0.26, 0.52, 0.74)),
              (7400, 720, (0.34, 0.60, 0.82)), (9600, 950, (0.42, 0.67, 0.89))]
    for k, (R, Hh, col) in enumerate(layers):
        n = 1400
        a = np.linspace(0, 2 * np.pi, n, endpoint=False)
        s = a * R
        nzv = VNoise(900 + k, 32)
        base = 0.30 + 0.5 * ridged(nzv, s / 2600.0, 0.3 + k, 0.7, 4)
        cell = 520.0 + 90 * k
        q = s / cell + 0.37 * k
        ci = np.floor(q).astype(np.int64)
        f = q - ci
        hv = _TBL[np.abs(ci * 7919 + k * 131) % 8192]
        bump = np.clip(1 - (2 * f - 1) ** 2, 0, 1) ** 0.6 * (hv > 0.3) * (0.35 + 0.65 * hv)
        q2 = s / (cell * 0.37) + 1.9 * k
        c2 = np.floor(q2).astype(np.int64)
        f2 = q2 - c2
        hv2 = _TBL[np.abs(c2 * 104729 + k * 17) % 8192]
        bump2 = np.clip(1 - (2 * f2 - 1) ** 2, 0, 1) ** 0.5 * (hv2 > 0.45) * hv2
        top = Hh * (0.45 * base + 0.42 * bump + 0.26 * bump2) + 60.0
        P0 = np.stack([R * np.cos(a), R * np.sin(a), np.full(n, -40.0)], -1)
        P1 = np.stack([R * np.cos(a), R * np.sin(a), top], -1)
        V = np.concatenate([P0, P1])
        j = np.arange(n)
        quads = np.stack([j, (j + 1) % n, n + (j + 1) % n, n + j], -1)
        me = mesh_from_arrays(f'ENV_FarRing_{k}', V, quads)
        me.materials.append(mat_far(f'WK_Far_{k}', col))
        objs.append(bpy.data.objects.new(me.name, me))
    return objs


def seg_dist(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    t = np.clip(((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy), 0, 1)
    return np.hypot(px - (ax + t * vx), py - (ay + t * vy))


# ----------------------------------------------------------------------------- 主流程
def main():
    global Z0
    Z0 = -25.0
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    rng = np.random.default_rng(SEED)
    ICO[1], ICO[2] = _ico(1), _ico(2)
    ENV = bpy.data.collections.new('ENV')
    scene.collection.children.link(ENV)
    C_terr = new_coll('ENV_terrain', ENV)
    C_water = new_coll('ENV_water', ENV)
    C_peaks = new_coll('ENV_peaks', ENV)
    C_veg = new_coll('ENV_veg', ENV)
    C_props = new_coll('ENV_props', ENV)
    C_far = new_coll('ENV_far', ENV)
    C_lib = bpy.data.collections.new('ENV_lib'); C_lib.use_fake_user = True      # 实例源，不进场景
    C_t0 = new_coll('ENV_lib_trees', C_lib)
    C_t1 = new_coll('ENV_lib_trees_lo', C_lib)
    C_pl = new_coll('ENV_lib_plants', C_lib)
    C_pv = new_coll('ENV_lib_pillars', C_lib)

    # ---- 材质
    m_ground = mat_ground()
    m_pillar = mat_pillar('WK_RockPillar', 0.0)
    m_karst = mat_pillar('WK_RockKarst', 0.40)
    m_water = mat_water()
    m_trunk = mat_flat('WK_Trunk', (0.20, 0.11, 0.08))
    m_peach = mat_crown('WK_CrownPeach', (0.62, 0.22, 0.45), (0.93, 0.40, 0.58), (1.0, 0.66, 0.76))
    m_green = mat_crown('WK_CrownGreen', (0.04, 0.24, 0.17), (0.15, 0.48, 0.10), (0.42, 0.70, 0.13))
    m_pine = mat_crown('WK_CrownPine', (0.02, 0.15, 0.17), (0.06, 0.32, 0.17), (0.20, 0.52, 0.20))
    m_plant = mat_plant()

    # ---- 地形 / 水
    ground, rect = build_ground(m_ground)
    C_terr.objects.link(ground)
    C_terr.objects.link(build_outer(m_ground, rect))
    wa, wb = build_water(m_water)
    C_water.objects.link(wa); C_water.objects.link(wb)
    for ob in build_fall(mat_fall(), mat_mist(), m_water):
        C_water.objects.link(ob)
    log('terrain + water done')

    # ---- 树库
    crown = {'peach': m_peach, 'round': m_green, 'pine': m_pine, 'bush': m_green, 'pbush': m_peach}
    for lod, coll in ((0, C_t0), (1, C_t1)):
        for k, kd in enumerate(TREE_KINDS):
            ob = build_blob_tree(f't{lod}_{k:02d}_{kd}', 300 + k, 'bush' if kd == 'pbush' else kd, lod, m_trunk, crown[kd])
            coll.objects.link(ob)
    G_t0 = make_instancer_group('WK_Inst_Trees', C_t0)
    G_t1 = make_instancer_group('WK_Inst_TreesLo', C_t1)
    for ob in build_plants(m_plant):
        C_pl.objects.link(ob)
    G_pl = make_instancer_group('WK_Inst_Plants', C_pl)

    def tree_points(name, x, y, tid, smin, smax, group, zoff=-0.25):
        n = len(x)
        z = EH.ground_height(x, y) + zoff
        s = rng.uniform(smin, smax, n)
        rot = np.stack([np.zeros(n), np.zeros(n), rng.random(n) * 6.283], -1)
        scl = np.stack([s, s, s * rng.uniform(0.9, 1.15, n)], -1)
        return make_points_object(name, np.stack([x, y, z], -1), tid, rot, scl, group)

    # ---- 桃花林（左岸花坡）+ 绿树 / 松（右岸崖顶、坡上零星）
    N = 60000 if not QUICK else 8000
    x = rng.uniform(-1900, 1900, N); y = rng.uniform(-1150, 1500, N)
    yc = EH.river_center(x); w = EH.river_halfwidth(x); d = y - yc
    tL, tR = d - w, -d - w
    s_, wc_ = EH.cliff_params(x)
    back = tR - s_ - wc_
    grove = EH.fbm2(x / 110 + 21.0, y / 110 + 5.0, 3)
    band_d = np.abs(d - EH.BAND_D)
    in_band_x = (x > -900) & (x < 90)
    band_keep = np.where(x < -640, 24.0, 15.0)
    left_slope = (tL > 22) & (tL < 505) & (x > -900) & (x < 1420)
    keep_peach = left_slope & (grove > 0.50) & ~(in_band_x & (band_d < band_keep)) & (rng.random(N) < 0.16)
    keep_green = left_slope & (grove < 0.36) & ~(in_band_x & (band_d < band_keep)) & (rng.random(N) < 0.05)
    keep_right = (back > 6) & (back < 520) & (np.abs(x - EH.FALL_X) > 16) & (np.hypot(x - EH.PAGODA_X, back - 32) > 26) & (rng.random(N) < np.where(grove > 0.45, 0.10, 0.015))
    keep_outer = ((tL > 505) | (x < -900) & (tL > 14)) & (rng.random(N) < 0.05)
    # 走廊：空中段下方地面无所谓；江面 35 m 内本来就是水
    tid = np.zeros(N, np.int64)
    r_ = rng.random(N)
    tid = np.where(keep_peach, np.where(r_ < 0.86, rng.integers(0, 3, N), 8), tid)
    tid = np.where(keep_green & ~keep_peach, np.where(r_ < 0.7, rng.integers(3, 5, N), 7), tid)
    tid = np.where(keep_right & ~keep_peach & ~keep_green, np.where(r_ < 0.45, rng.integers(5, 7, N), np.where(r_ < 0.85, rng.integers(3, 5, N), 7)), tid)
    tid = np.where(keep_outer & ~keep_peach & ~keep_green & ~keep_right, np.where(r_ < 0.5, rng.integers(5, 7, N), rng.integers(3, 5, N)), tid)
    keep = keep_peach | keep_green | keep_right | keep_outer
    C_veg.objects.link(tree_points('ENV_Trees', x[keep], y[keep], tid[keep], 0.8, 1.35, G_t0))
    log('trees', int(keep.sum()), 'peach', int(keep_peach.sum()))

    # ---- 花草：贴地走廊两侧 60 m 内高密度实例
    x0b, x1b = -850.0, 80.0
    area = (x1b - x0b) * 120.0
    ng_ = int(area * (4.6 if not QUICK else 0.3))
    gx = rng.uniform(x0b, x1b, ng_); go = rng.uniform(-60, 60, ng_)
    keepg = rng.random(ng_) < np.maximum(np.exp(-(go / 30.0) ** 2), 0.10) * sstep(x0b, x0b + 70, gx) * (1 - sstep(x1b - 70, x1b, gx))
    gx, go = gx[keepg], go[keepg]
    gy = EH.river_center(gx) + EH.BAND_D + go
    gz = EH.ground_height(gx, gy)
    _, _, flm = ground_color(gx, gy, gz, np.ones_like(gx))
    kp2 = rng.random(len(gx)) < (1.0 - 0.45 * flm)
    gx, gy, gz, flm = gx[kp2], gy[kp2], gz[kp2], flm[kp2]
    isf = rng.random(len(gx)) < (0.10 + 0.55 * flm)
    ptid = np.where(isf, 3 + np.where(flm > 0.5, rng.choice([0, 0, 0, 1, 1, 2], len(gx)), rng.choice([2, 2, 3, 4, 0, 1], len(gx))), rng.integers(0, 3, len(gx)))
    n = len(gx)
    s = rng.uniform(0.8, 1.5, n)
    rot = np.stack([rng.normal(0, 0.12, n), rng.normal(0, 0.12, n), rng.random(n) * 6.283], -1)
    C_veg.objects.link(make_points_object('ENV_Plants', np.stack([gx, gy, gz - 0.02], -1), ptid, rot, np.stack([s, s, s], -1), G_pl))
    log('plants', n, 'flowers', int(isf.sum()))

    # ---- 峰柱变体库（实例源）
    n_var = 4 if QUICK else 11
    var_r = []
    for k in range(n_var):
        R = rng.uniform(20, 42)
        H = rng.uniform(210, 450)
        ob, cand = build_pillar(f'pvar_{k:02d}', SEED * 2000 + k, R, H, 3.2, 'zjj', rng.uniform(1.0, 2.2), m_pillar)
        vc = new_coll(f'ENV_lib_pv_{k:02d}', C_pv)
        vc.objects.link(ob)
        co = cand['co']
        var_r.append(float(np.hypot(co[:, 0], co[:, 1])[co[:, 2] > 5].max()))
        idx = pick_tree_points(cand, rng, 0.016, 0.006, 8.0)
        if len(idx):
            c = co[idx]
            nn = len(idx)
            tt = np.where(rng.random(nn) < 0.5, rng.integers(5, 7, nn), np.where(rng.random(nn) < 0.7, rng.integers(3, 5, nn), 7))
            sc_ = rng.uniform(0.9, 1.6, nn)
            tp = make_points_object(f'pvar_{k:02d}_trees', c - np.array([0, 0, 0.5]), tt, np.stack([np.zeros(nn), np.zeros(nn), rng.random(nn) * 6.28], -1), np.stack([sc_] * 3, -1), G_t1)
            tp.parent = ob
            vc.objects.link(tp)
        log(f'pvar {k}: R={R:.0f} H={H:.0f} rmax={var_r[-1]:.0f} verts={len(ob.data.vertices)} trees={len(idx)}')
    G_pv = make_instancer_group('WK_Inst_Pillars', C_pv)
    var_r = np.array(var_r)

    # ---- 峰林摆放
    P0 = (-1500.0, float(EH.river_center(-1500.0)) + 40.0)
    A1 = (-850.0, float(EH.river_center(-850.0)) + 190.0)
    A0 = (-1950.0, P0[1] - (A1[1] - P0[1]) / 650.0 * 450.0)
    A2 = (-690.0, float(EH.river_center(-690.0)) + EH.BAND_D)
    pts, tids, rots, scls = [], [], [], []

    def try_add(px, py, tid_, sc, min_clear=40.0, hero=False):
        r = var_r[tid_] * sc
        yc_ = float(EH.river_center(px)); w_ = float(EH.river_halfwidth(px))
        d_ = py - yc_
        if abs(d_) < w_ + r + 18 and not (hero and px < -880):
            return False
        if min(seg_dist(px, py, *A0, *A1), seg_dist(px, py, *A1, *A2)) < r + min_clear:
            return False
        if d_ > 0 and px > -880 and (d_ - w_) < 525 + r:          # 花坡上不放峰柱
            return False
        if d_ < 0 and px > -900 and (-d_ - w_) < 330 + r:         # 右岸崖顶前沿留给草甸和楼阁
            return False
        for (qx, qy, _), qt, qs in zip(pts, tids, scls):
            if math.hypot(px - qx, py - qy) < (r + var_r[qt] * qs[0]) * 0.8:
                return False
        z = float(EH.ground_height(px, py)) - 6.0
        pts.append((px, py, z)); tids.append(tid_)
        rots.append((0.0, 0.0, rng.random() * 6.283)); scls.append((sc, sc, sc * rng.uniform(0.85, 1.2)))
        return True

    # 起点区：夹着空中走廊的主角峰
    for xx, sd_, off in ((-1560, -1, 60), (-1480, 1, 58), (-1390, -1, 52), (-1290, 1, 48), (-1180, -1, 50), (-1080, 1, 46), (-970, -1, 55), (-900, 1, 80)):
        tid_ = int(rng.integers(0, n_var))
        tline = (xx - A0[0]) / (A1[0] - A0[0])
        ly = A0[1] + tline * (A1[1] - A0[1])
        ok = try_add(xx, ly + sd_ * (off + var_r[tid_]), tid_, 1.0, 37.0, hero=True)
        log('hero pillar', xx, sd_, 'ok' if ok else 'rejected')
    for _ in range(600 if not QUICK else 60):
        px = rng.uniform(-1900, -860); py = rng.uniform(-900, 1000)
        try_add(px, py, int(rng.integers(0, n_var)), rng.uniform(0.75, 1.2))
        if len(pts) > 44:
            break
    n_start = len(pts)
    for _ in range(900 if not QUICK else 80):
        px = rng.uniform(-900, 1900); py = rng.uniform(-1140, 1480)
        try_add(px, py, int(rng.integers(0, n_var)), rng.uniform(0.8, 1.35))
        if len(pts) > n_start + 58:
            break
    for _ in range(260 if not QUICK else 40):       # 网格外围再补一圈
        a = rng.random() * 6.283; rr = rng.uniform(1700, 3000)
        px, py = math.cos(a) * rr * 1.1, math.sin(a) * rr
        if abs(px) < 1900 and -1150 < py < 1500:
            continue
        try_add(px, py, int(rng.integers(0, n_var)), rng.uniform(1.0, 1.7))
    C_peaks.objects.link(make_points_object('ENV_Pillars', np.array(pts), np.array(tids), np.array(rots), np.array(scls), G_pv))
    log('pillars', len(pts), 'start zone', n_start)

    # ---- 湖中孤峰（桂林式）
    for k, (tx, td, tr, th) in enumerate(tower_list()):
        ob, cand = build_pillar(f'ENV_Tower_{k}', 7000 + k, tr, th, 2.2, 'zjj', 1.15, m_karst)
        ob.location = (tx, float(EH.river_center(tx)) + td, -3.0)
        C_peaks.objects.link(ob)
        idx = pick_tree_points(cand, rng, 0.03, 0.012, 6.0)
        if len(idx):
            nn = len(idx)
            tt = np.where(rng.random(nn) < 0.45, rng.integers(5, 7, nn), np.where(rng.random(nn) < 0.75, rng.integers(3, 5, nn), 7))
            sc_ = rng.uniform(0.7, 1.2, nn)
            tp = make_points_object(f'ENV_Tower_{k}_trees', cand['co'][idx] - np.array([0, 0, 0.4]), tt, np.stack([np.zeros(nn), np.zeros(nn), rng.random(nn) * 6.28], -1), np.stack([sc_] * 3, -1), G_t0)
            tp.parent = ob
            C_peaks.objects.link(tp)

    # ---- 楼阁
    px = EH.PAGODA_X
    s_p, wc_p = [float(v) for v in EH.cliff_params(px)]
    py = float(EH.river_center(px)) - float(EH.river_halfwidth(px)) - s_p - wc_p - 30.0
    pg = build_pagoda((mat_flat('WK_PagodaRed', (0.80, 0.13, 0.08)), mat_flat('WK_PagodaRoof', (0.20, 0.27, 0.36)),
                       mat_flat('WK_PagodaGold', (0.95, 0.72, 0.15)), mat_flat('WK_PagodaBase', (0.78, 0.74, 0.66))))
    pg.location = (px, py, float(EH.ground_height(px, py)) - 0.8)
    pg.rotation_euler = (0, 0, 0.5)
    pg.scale = (1.9, 1.9, 1.9)
    C_props.objects.link(pg)

    # ---- 远山剪影
    for ob in build_far_rings():
        C_far.objects.link(ob)

    out = OUT if os.path.isabs(OUT) else os.path.join(HERE, OUT)
    bpy.ops.wm.save_as_mainfile(filepath=out, compress=True)
    log('saved', out, f'{os.path.getsize(out) / 1e6:.1f} MB')


main()
