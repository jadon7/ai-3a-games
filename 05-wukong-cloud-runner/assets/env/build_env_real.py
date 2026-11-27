"""写实山体环境 v2（暗调神话写实，Cycles），输出 env_real.blend，集合名 "ENV"。

运行（需要 ph/ 下的 Poly Haven 松树：python3 ph_download.py model pine_tree_01 1k; ... island_tree_02 1k）：
  /Applications/Blender.app/Contents/MacOS/Blender -b -P build_env_real.py -- [quick] [seed=7] [out=env_real.blend] [herolod1]

布局：米；Z 向上；云海顶 z=0；山体从 z=-150 起。走廊第一段 (-2500,0)→(600,0)，第二段从 (600,0) 沿 25° 航向。
山门（镜头 C）：gateC_L (250,85)、gateC_R (270,-80)、pine_rock (400,-42) + ENV_HeroPine；
日门（镜头 D）：gateD_L / gateD_R 在 (1959,634) 垂直航向两侧各 115 m；
镜头 B 背景：bgB_0..7；镜头 A 近景：nearA_0..3。
"""
import bpy, sys, os, math, time
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, 'common'))
import scene_common as sc  # noqa

ARGV = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
QUICK = 'quick' in ARGV
SEED = 7
OUT = 'env_real.blend'
for a in ARGV:
    if a.startswith('seed='):
        SEED = int(a[5:])
    if a.startswith('out='):
        OUT = a[4:]
TEX = os.path.join(ROOT, 'assets', 'tex')
Z0 = -150.0
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
def build_pillar(name, seed, R, H, seg=0.75, style='zjj', aspect=1.0, mat=None, nl_force=None, sharp=False, extra_spires=0):
    """多瓣峰柱：若干根高矮不一的柱子融合在一起（张家界式），或若干锥峰融合（黄山 / 桂林式）。
    style='zjj'：直壁、柱状节理、圆肩平顶；'hs'：花岗岩锥峰群。原点在主柱中心 z=0（云海面）。"""
    rng = np.random.default_rng(seed)
    nz = VNoise(seed * 7 + 3)
    phi = rng.random() * np.pi
    # ---- 瓣：主柱 + 伴生柱
    nl = int(rng.choice([1, 2, 3, 4, 5, 6], p=[0.08, 0.20, 0.27, 0.22, 0.15, 0.08])) if style == 'zjj' else int(rng.integers(2, 6))
    if nl_force:
        nl = int(nl_force)
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
    for _e in range(int(extra_spires)):            # 顶部加几根高低错落的针峰
        a = rng.random() * 6.283
        rk = R * rng.uniform(0.18, 0.36)
        dist = R * rng.uniform(0.45, 1.5)
        lobes.append((math.cos(a) * dist, math.sin(a) * dist, rk, min(H * rng.uniform(0.62, 0.99), H - 6.0)))
    nl = len(lobes)
    if extra_spires:
        hr = [min(l[2] * rng.uniform(0.22, 0.5) + 2.0, 12.0) for l in lobes]
    else:
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

    ztw = zt + (16.0 if seg < 1.5 else 46.0) * (nz(zt / 70.0 + 2.2, np.cos(th)[None, :] * 0.8, np.sin(th)[None, :] * 0.8) - 0.5) * 2
    nk = min(1.0, 1.1 / seg) * (1.0 if seg < 1.5 else 0.55)

    def bed_notch(thick, width, sd):
        q = ztw / thick + 0.37 * sd
        i = np.floor(q).astype(np.int64)
        f = q - i
        dep = _TBL[np.abs(i * 2654435761 + sd * 131) % 8192]
        return np.exp(-((f - 0.5) / width) ** 2) * dep ** 1.5

    thn = nz(th[None, :] * 2.5 + 1.1, Zg / 45.0, 0.6)
    lay -= bed_notch(5.5 * tk, 0.13, seed + 5) * (0.65 / R) * k * nk * massive * (0.4 + 1.2 * thn)
    lay -= bed_notch(37.0 * tk, 0.05, seed + 6) * (2.4 / R) * k * nk * sstep(0.35, 0.7, thn) * 1.6

    if sharp:
        def bed_saw(thick, sd):       # 每层向上逐渐外探，到层顶突然收回 → 台阶 / 岩檐
            q = ztw / thick + 0.61 * sd
            i = np.floor(q).astype(np.int64)
            dep = _TBL[np.abs(i * 2654435761 + sd * 977) % 8192]
            return (q - i - 0.5) * dep
        lay += bed_saw(6.5 * tk, seed + 11) * (1.2 / R) * (0.35 + 0.65 * massive)
        lay += bed_saw(27.0 * tk, seed + 12) * (2.4 / R) * sstep(0.3, 0.7, thn)
    bulk = (fbm(nz, X0 / 38.0, Y0 / 38.0, Zg / 38.0, 4) - 0.5) * (0.20 if style == 'zjj' else 0.30)
    mid = (ridged(nz, X0 / 9.0, Y0 / 9.0, Zg / 14.0, 4) - 0.5) * 0.05
    fine = (fbm(nz, X0 / 2.2, Y0 / 2.2, Zg / 2.2, 3) - 0.5) * (0.9 / R)
    arc = th[None, :] * float(r_ref.mean())
    bF1, bF2, bv1, bv2 = worley2(arc + 2.0 * (nz(Zg / 9.0, th[None, :] * 4, 0.2) - 0.5), Zg * rng.uniform(1.3, 2.0), rng.uniform(3.5, 6.0), seed + 77)
    if sharp:
        facet = (cellblend(bF1, bF2, bv1, bv2, 0.13) - 0.5) * (1.25 / R) * nk
        facet = facet - cellblend(bF1, bF2, (bv1 < 0.15).astype(float), (bv2 < 0.15).astype(float), 0.12) * (2.6 / R) * nk     # 崩落缺口
        seam = -(1 - sstep(0.0, 0.22, bF2 - bF1)) * (0.42 / R) * nk * (0.3 + 1.2 * nz(Zg / 20.0, th[None, :] * 3, 0.9))
    else:
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
    if sharp:
        try:
            me.set_sharp_from_angle(angle=math.radians(33.0))
        except Exception as e:
            print('set_sharp_from_angle:', e)

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
    cand = {'co': V, 'n': N, 'area': area, 'top': N[:, 2] > 0.8, 'veg': vg, 'lobes': lobes}
    return ob, cand


def pick_tree_points(cand, rng, dens_top=0.07, dens_ledge=0.03, zmin=4.0):
    co, n, area = cand['co'], cand['n'], cand['area']
    up = sstep(0.38, 0.8, n[:, 2])
    dens = dens_ledge + (dens_top - dens_ledge) * sstep(0.75, 0.95, n[:, 2])
    p = np.minimum(dens * up * np.minimum(area, 60.0), 0.9) * (co[:, 2] > zmin)
    return np.nonzero(rng.random(len(co)) < p)[0]


# ----------------------------------------------------------------------------- 地形块（远山 / 山体）
def build_terrain(name, seed, sx, sy, H, res=10.0, tower=160.0, style='mix', mat=None):
    """椭圆范围 (sx, sy) 的山体高度场。H 为高出云海的峰顶高度。"""
    rng = np.random.default_rng(seed)
    nz = VNoise(seed * 5 + 1)
    nx, ny = int(2 * sx / res) + 1, int(2 * sy / res) + 1
    x = np.linspace(-sx, sx, nx)[None, :] + np.zeros((ny, 1))
    y = np.linspace(-sy, sy, ny)[:, None] + np.zeros((1, nx))
    ox, oy = rng.random() * 50, rng.random() * 50
    d = np.hypot(x / sx, y / sy) + 0.35 * (fbm(nz, x / 700 + ox, y / 700 + oy, 0.2, 4) - 0.5)
    env = np.clip(1.0 - d, 0, 1)
    base = sstep(0.0, 0.55, env) ** 0.8
    crest = 0.35 + 0.65 * ridged(nz, x / 520 + ox, y / 520 + oy, 0.7, 5)
    F1, F2, v1, v2 = worley2(x + 60 * (fbm(nz, x / 90, y / 90, 0.1, 2) - 0.5), y, tower, seed)
    plat = cellblend(F1, F2, v1, v2, tower * 0.05)
    edge = sstep(0.0, tower * 0.16, F2 - F1)
    if style == 'zjj':
        tw = (0.25 + 0.75 * plat) * (0.30 + 0.70 * edge)
        h = base * (0.45 + 0.55 * crest) * (0.25 + 0.75 * tw)
    elif style == 'hs':
        Fb, _, vb, _ = worley2(x + 200 * (fbm(nz, x / 300, y / 300, 0.4, 2) - 0.5), y, tower * 2.6, seed + 9)
        pk = np.clip(1 - F1 / (tower * 0.75), 0, 1) ** 0.75 * (0.4 + 0.6 * v1)
        pkb = np.clip(1 - Fb / (tower * 2.2), 0, 1) ** 0.6 * (0.45 + 0.55 * vb)
        h = base * (0.30 + 0.70 * crest) * (0.35 + 0.22 * pk + 0.43 * pkb)
    else:
        tw = (0.25 + 0.75 * plat) * (0.40 + 0.60 * edge)
        pk = np.clip(1 - F1 / (tower * 0.75), 0, 1) ** 0.8
        h = base * (0.40 + 0.60 * crest) * (0.35 + 0.40 * tw + 0.25 * pk)
    h = h + (fbm(nz, x / 60, y / 60, 0.9, 4) - 0.5) * 0.05 * base
    h = h / max(float(h.max()), 1e-6)
    # 轻微台地化，做出陡崖
    Tn = 9.0
    ht = np.floor(h * Tn) / Tn + sstep(0.55, 1.0, h * Tn - np.floor(h * Tn)) / Tn
    h = 0.55 * h + 0.45 * ht
    z = Z0 + (H - Z0) * np.clip(h, 0, 1)
    V = np.stack([x, y, z], -1).reshape(-1, 3)
    i = np.arange(ny - 1)[:, None]
    j = np.arange(nx - 1)[None, :]
    a = i * nx + j
    quads = np.stack([a, a + 1, a + nx + 1, a + nx], -1).reshape(-1, 4)
    # 去掉完全沉在云下的面
    zq = z.reshape(-1)[quads].max(1)
    quads = quads[zq > Z0 + 20.0]
    me = mesh_from_arrays(name, V, quads)
    N = vnormals(me)
    vg = sstep(0.55, 0.85, N[:, 2]) * (0.5 + 1.0 * fbm(nz, V[:, 0] / 40, V[:, 1] / 40, V[:, 2] / 40, 3))
    vg = np.clip(vg, 0, 1)
    set_attr(me, 'veg', vg)
    if mat:
        me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    cand = {'co': V, 'n': N, 'area': np.full(len(V), res * res), 'top': np.ones(len(V), bool), 'veg': vg}
    return ob, cand


# ----------------------------------------------------------------------------- 材质
def load_img(path, colorspace='sRGB'):
    img = bpy.data.images.load(path, check_existing=True)
    try:
        img.colorspace_settings.name = colorspace
    except TypeError:
        pass
    return img


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


def box_tex(nt, img, vec, tile_m, blend=0.35, rot=(0, 0, 0)):
    mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (1.0 / tile_m,) * 3
    mp.inputs['Rotation'].default_value = rot
    nt.links.new(vec, mp.inputs['Vector'])
    t = nt.nodes.new('ShaderNodeTexImage')
    t.image = img
    t.projection = 'BOX'
    t.projection_blend = blend
    nt.links.new(mp.outputs[0], t.inputs['Vector'])
    return t.outputs[0]


def make_rock_material(name='WK_Rock', tile=28.0, far=False):
    """砂岩 / 花岗岩崖壁：横向层理贴图（把竖纹贴图转 90° 做平面投影）+ 灰色裂隙岩 + 水渍 + 植被遮罩。"""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    L = nt.links
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    L.new(bsdf.outputs[0], out.inputs['Surface'])
    tc = nt.nodes.new('ShaderNodeTexCoord')
    oi = nt.nodes.new('ShaderNodeObjectInfo')
    vec = tc.outputs['Object']
    sepN = nt.nodes.new('ShaderNodeSeparateXYZ')
    L.new(tc.outputs['Normal'], sepN.inputs[0])
    sepP = nt.nodes.new('ShaderNodeSeparateXYZ')
    L.new(vec, sepP.inputs[0])
    nzw = sepN.outputs[2]
    ax = math_node(nt, 'ABSOLUTE', sepN.outputs[0])
    ay = math_node(nt, 'ABSOLUTE', sepN.outputs[1])
    wx = map_range(nt, math_node(nt, 'SUBTRACT', ax, ay), -0.3, 0.3)

    d1 = load_img(os.path.join(TEX, 'marble_cliff_04', 'marble_cliff_04_Diffuse_2k.jpg'))
    h1 = load_img(os.path.join(TEX, 'marble_cliff_04', 'marble_cliff_04_Displacement_2k.png'), 'Non-Color')
    d2 = load_img(os.path.join(TEX, 'marble_cliff_05', 'marble_cliff_05_Diffuse_2k.jpg'))
    h2 = load_img(os.path.join(TEX, 'marble_cliff_05', 'marble_cliff_05_Displacement_2k.png'), 'Non-Color')

    def coords(t, off=0.0):
        cs = []
        for hsock in (sepP.outputs[1], sepP.outputs[0]):
            cb = nt.nodes.new('ShaderNodeCombineXYZ')
            L.new(sepP.outputs[2], cb.inputs[0])
            L.new(hsock, cb.inputs[1])
            mp = nt.nodes.new('ShaderNodeMapping')
            mp.inputs['Scale'].default_value = (1.0 / t, 1.0 / t, 1.0)
            mp.inputs['Location'].default_value = (off, off * 1.7, 0.0)
            L.new(cb.outputs[0], mp.inputs['Vector'])
            cs.append(mp.outputs[0])
        return cs

    def swapped(img, cs, color=True):
        outs = []
        for c in cs:
            t = nt.nodes.new('ShaderNodeTexImage')
            t.image = img
            L.new(c, t.inputs['Vector'])
            outs.append(t.outputs[0])
        if color:
            return mix_rgb(nt, wx, outs[1], outs[0])
        m = nt.nodes.new('ShaderNodeMix')
        m.data_type = 'FLOAT'
        L.new(wx, m.inputs[0]); L.new(outs[1], m.inputs[2]); L.new(outs[0], m.inputs[3])
        return m.outputs[0]

    k = 1.0 if not far else 6.0
    csA, csB = coords(tile), coords(tile * 3.7, 0.37)
    cA, cB = swapped(d1, csA), swapped(d1, csB)
    hA, hB = swapped(h1, csA, False), swapped(h1, csB, False)
    cG = box_tex(nt, d2, vec, tile * 0.9, rot=(0.0, 0.0, 0.6))
    hG = box_tex(nt, h2, vec, tile * 0.9, rot=(0.0, 0.0, 0.6))

    m_ab = noise_node(nt, vec, 0.03 / k, 2.0)
    col = mix_rgb(nt, map_range(nt, m_ab, 0.35, 0.65, 0.25, 0.85), cA, cB)
    m_g = noise_node(nt, vec, 0.012 / k, 2.0, 0.6)
    gmix = map_range(nt, m_g, 0.38, 0.62)
    col = mix_rgb(nt, gmix, col, cG)
    hsv = nt.nodes.new('ShaderNodeHueSaturation')
    L.new(col, hsv.inputs['Color'])
    hsv.inputs['Saturation'].default_value = 0.42
    hsv.inputs['Value'].default_value = 0.165
    col = hsv.outputs[0]
    tint = mix_rgb(nt, oi.outputs['Random'], (1.0, 0.76, 0.64, 1), (0.84, 0.85, 0.90, 1))
    col = mix_rgb(nt, 1.0, col, tint, 'MULTIPLY')

    wall = map_range(nt, nzw, 0.55, 0.15)
    # 竖向水渍
    st = noise_node(nt, vec, 1.0, 3.0, 0.6, sx=0.45 / k, sy=0.45 / k, sz=0.016 / k)
    st2 = noise_node(nt, vec, 1.0, 2.0, 0.5, sx=0.09 / k, sy=0.09 / k, sz=0.005 / k)
    stain = math_node(nt, 'MULTIPLY', map_range(nt, st, 0.50, 0.74), map_range(nt, st2, 0.42, 0.62))
    stain = math_node(nt, 'MULTIPLY', stain, wall)
    col = mix_rgb(nt, math_node(nt, 'MULTIPLY', stain, 0.85), col, (0.022, 0.021, 0.020, 1))
    # 背阴 / 缓坡处的苔藓
    mossn = noise_node(nt, vec, 0.16 / k, 3.0, 0.6)
    mossm = math_node(nt, 'MULTIPLY', map_range(nt, mossn, 0.50, 0.66), map_range(nt, nzw, -0.1, 0.45, 0.25, 1.0))
    col = mix_rgb(nt, math_node(nt, 'MULTIPLY', mossm, 0.55), col, (0.030, 0.045, 0.018, 1))
    # 横向色带（层理明暗）
    band = noise_node(nt, vec, 1.0, 3.0, 0.65, sx=0.003 / k, sy=0.003 / k, sz=0.11 / k)
    col = mix_rgb(nt, map_range(nt, band, 0.3, 0.7, 0.0, 0.5), col, (0.62, 0.55, 0.47, 1), 'MULTIPLY')
    pale = noise_node(nt, vec, 0.02 / k, 2.0, 0.6)
    col = mix_rgb(nt, map_range(nt, pale, 0.52, 0.74, 0.0, 0.5), col, (0.235, 0.228, 0.215, 1))

    # 植被遮罩
    at = nt.nodes.new('ShaderNodeAttribute')
    at.attribute_name = 'veg'
    vn = noise_node(nt, vec, 0.35 / k, 3.0, 0.65)
    vsum = math_node(nt, 'ADD', at.outputs[2], math_node(nt, 'MULTIPLY', math_node(nt, 'SUBTRACT', vn, 0.5), 0.9))
    vmask = map_range(nt, vsum, 0.36, 0.56)
    slope_v = map_range(nt, nzw, 0.12, 0.5)
    vn2 = noise_node(nt, vec, 0.10 / k, 3.0, 0.7)
    vmask2 = math_node(nt, 'MULTIPLY', slope_v, map_range(nt, vn2, 0.40, 0.56))
    vmask = math_node(nt, 'MAXIMUM', vmask, vmask2)
    gcol_n = noise_node(nt, vec, 1.1 / k, 3.0, 0.7)
    gcol = mix_rgb(nt, gcol_n, (0.010, 0.026, 0.009, 1), (0.045, 0.078, 0.020, 1))
    col = mix_rgb(nt, vmask, col, gcol)
    L.new(col, bsdf.inputs['Base Color'])
    wet = noise_node(nt, vec, 0.04 / k, 2.0, 0.5)
    rough = math_node(nt, 'ADD', math_node(nt, 'MULTIPLY', vmask, 0.30), map_range(nt, wet, 0.35, 0.65, 0.42, 0.72))
    L.new(rough, bsdf.inputs['Roughness'])
    if 'Specular IOR Level' in bsdf.inputs:
        bsdf.inputs['Specular IOR Level'].default_value = 0.5

    hrock = math_node(nt, 'ADD', math_node(nt, 'MULTIPLY', hA, 1.3 * k), math_node(nt, 'MULTIPLY', hB, 2.8 * k))
    mh = nt.nodes.new('ShaderNodeMix')
    mh.data_type = 'FLOAT'
    L.new(gmix, mh.inputs[0]); L.new(hrock, mh.inputs[2]); L.new(math_node(nt, 'MULTIPLY', hG, 0.9 * k), mh.inputs[3])
    vb = noise_node(nt, vec, 1.5 / k, 3.0, 0.75)
    hh = math_node(nt, 'ADD', mh.outputs[0], math_node(nt, 'MULTIPLY', math_node(nt, 'MULTIPLY', vb, vmask), 1.4 * k))
    bump = nt.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 1.0
    bump.inputs['Distance'].default_value = 1.0
    L.new(hh, bump.inputs['Height'])
    L.new(bump.outputs[0], bsdf.inputs['Normal'])
    return mat


def make_foliage_material(name='WK_Needles'):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    oi = nt.nodes.new('ShaderNodeObjectInfo')
    geo = nt.nodes.new('ShaderNodeNewGeometry')
    at = nt.nodes.new('ShaderNodeAttribute')
    at.attribute_name = 'tuft'
    tuft = at.outputs[2]
    base = mix_rgb(nt, oi.outputs['Random'], (0.014, 0.036, 0.012, 1), (0.040, 0.070, 0.018, 1))
    base = mix_rgb(nt, tuft, base, (0.060, 0.105, 0.028, 1))         # 新叶尖更亮
    dif = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(base, dif.inputs['Base Color'])
    dif.inputs['Roughness'].default_value = 0.5
    if 'Specular IOR Level' in dif.inputs:
        dif.inputs['Specular IOR Level'].default_value = 0.3
    tr = nt.nodes.new('ShaderNodeBsdfTranslucent')
    nt.links.new(mix_rgb(nt, 0.5, base, (0.16, 0.24, 0.03, 1)), tr.inputs['Color'])
    ms = nt.nodes.new('ShaderNodeMixShader')
    ms.inputs[0].default_value = 0.28
    nt.links.new(dif.outputs[0], ms.inputs[1])
    nt.links.new(tr.outputs[0], ms.inputs[2])
    nt.links.new(ms.outputs[0], out.inputs['Surface'])
    return mat


def make_bark_material(name='WK_Bark'):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
    tc = nt.nodes.new('ShaderNodeTexCoord')
    p = os.path.join(TEX, 'pine_bark', 'pine_bark_Diffuse_1k.jpg')
    if os.path.exists(p):
        col = box_tex(nt, load_img(p), tc.outputs['Object'], 0.9)
        col = mix_rgb(nt, 0.6, col, (0.30, 0.22, 0.17, 1), 'MULTIPLY')
        nt.links.new(col, bsdf.inputs['Base Color'])
    else:
        bsdf.inputs['Base Color'].default_value = (0.07, 0.05, 0.04, 1)
    bsdf.inputs['Roughness'].default_value = 0.85
    return mat


# ----------------------------------------------------------------------------- 松树（黄山松：平顶层状树冠）
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


def _pad_tufts(rng, center, rx, ry, rz, dens, blade_len, blade_w, nblade=3):
    """一个扁椭球叶团：在上半表面附近撒针叶簇（细三角形扇）。"""
    area = math.pi * rx * ry
    n = max(12, int(area * dens))
    u = rng.random(n) ** 0.55
    a = rng.random(n) * 2 * np.pi
    m = 1 + 0.30 * np.sin(3 * a + rng.random() * 6.28) + 0.20 * np.sin(5 * a + rng.random() * 6.28)
    px, py = u * np.cos(a) * m, u * np.sin(a) * m
    shell = np.sqrt(np.clip(1 - u * u, 0, 1))
    pz = shell * (0.35 + 0.65 * rng.random(n)) - 0.15 * rng.random(n)
    base = center + np.stack([px * rx, py * ry, pz * rz], -1)
    out = np.stack([px, py, np.zeros(n)], -1)
    V, T, tuft = [], [], []
    vi = 0
    for b in range(nblade):
        d = np.stack([np.zeros(n), np.zeros(n), np.ones(n)], -1) + out * rng.uniform(0.3, 0.9) + rng.normal(0, 0.45, (n, 3))
        d /= np.linalg.norm(d, axis=1, keepdims=True) + 1e-9
        L = blade_len * rng.uniform(0.6, 1.3, n)[:, None]
        side = np.cross(d, rng.normal(0, 1, (n, 3)))
        side /= np.linalg.norm(side, axis=1, keepdims=True) + 1e-9
        w = blade_w * rng.uniform(0.7, 1.3, n)[:, None]
        p0, p1, p2 = base - side * w, base + side * w, base + d * L
        V.append(np.stack([p0, p1, p2], 1).reshape(-1, 3))
        idx = vi + np.arange(n * 3).reshape(n, 3)
        T.append(idx)
        tuft.append(np.tile(np.array([0.0, 0.0, 1.0]), n))
        vi += n * 3
    return np.concatenate(V), np.concatenate(T), np.concatenate(tuft)


def build_pine(name, seed, height, lod=0, mats=None, kind='pine'):
    """kind: 'pine' 黄山松（平顶层状）；'round' 阔叶圆冠；'cone' 杉树尖塔；'shrub' 灌木。"""
    rng = np.random.default_rng(seed)
    dens = (115.0, 24.0, 7.0)[lod]
    bl = (0.38, 0.85, 1.7)[lod]
    bw = (0.045, 0.16, 0.45)[lod]
    sides = (7, 5, 3)[lod]
    TV, TQ = [], []
    FV, FT, FA = [], [], []
    voff = 0

    def add_tube(path, radii, s):
        nonlocal voff
        v, q = _tube(path, radii, s)
        TV.append(v); TQ.append(q + voff); voff += len(v)

    def add_pad(c, rx, ry, rz, d=1.0, wide=1.0):
        v, t, a = _pad_tufts(rng, np.asarray(c, float), rx, ry, rz, dens * d, bl, bw * wide)
        FV.append(v); FT.append(t); FA.append(a)

    if kind == 'shrub':
        for k in range(int(rng.integers(2, 5))):
            c = [rng.normal(0, height * 0.3), rng.normal(0, height * 0.3), height * rng.uniform(0.3, 0.6)]
            r = height * rng.uniform(0.45, 0.75)
            add_pad(c, r, r, r * 0.8, 0.8, 1.6)
    else:
        t = np.linspace(0, 1, 9)
        lean = rng.normal(0, 0.10 if kind == 'pine' else 0.04, 2) * height
        bend = rng.normal(0, 0.07 if kind == 'pine' else 0.02, 2) * height
        path = np.stack([lean[0] * t + bend[0] * np.sin(np.pi * t * 1.3), lean[1] * t + bend[1] * np.sin(np.pi * t * 0.9 + 0.5), height * t], -1)
        r0 = height * rng.uniform(0.018, 0.026)
        add_tube(path, r0 * (1 - 0.8 * t) + 0.01, sides)

        def on_trunk(tb):
            i = min(int(tb * 8), 7)
            return path[i] + (path[i + 1] - path[i]) * (tb * 8 - i)

        if kind == 'pine':
            nb = int(rng.integers(4, 8))
            ang0 = rng.random() * 6.28
            for b in range(nb):
                tb = 0.42 + 0.5 * (b + rng.random() * 0.6) / nb
                start = on_trunk(tb)
                ang = ang0 + b * 2.4 + rng.normal(0, 0.35)
                Lb = height * rng.uniform(0.22, 0.42) * (1.25 - 0.6 * tb)
                dirv = np.array([math.cos(ang), math.sin(ang), 0.0])
                sv = np.linspace(0, 1, 5)
                bp = start[None, :] + dirv[None, :] * (Lb * sv)[:, None]
                bp[:, 2] += Lb * (-0.10 * np.sin(np.pi * sv) + 0.12 * sv ** 2) + rng.normal(0, 0.02 * Lb, 5)
                if lod < 2:
                    add_tube(bp, r0 * 0.38 * (1 - 0.7 * sv) + 0.008, max(3, sides - 3))
                pr = Lb * rng.uniform(0.55, 0.8)
                add_pad(bp[-1] + np.array([0, 0, pr * 0.05]) - dirv * pr * 0.25, pr, pr * rng.uniform(0.7, 1.0), pr * rng.uniform(0.22, 0.38) * (1.0, 1.5, 1.9)[lod])
            pr = height * rng.uniform(0.20, 0.30)
            add_pad(path[-1] + np.array([0, 0, -pr * 0.05]), pr, pr * rng.uniform(0.75, 1.0), pr * rng.uniform(0.25, 0.4) * (1.0, 1.5, 1.9)[lod])
        elif kind == 'round':
            nb = int(rng.integers(6, 11))
            cr = height * rng.uniform(0.26, 0.36)
            cz = height * rng.uniform(0.62, 0.72)
            for b in range(nb):
                d = rng.normal(0, 1, 3)
                d /= np.linalg.norm(d) + 1e-9
                d[2] = abs(d[2]) * 0.9 - 0.15
                c = on_trunk(0.95) * np.array([1, 1, 0]) + np.array([0, 0, cz]) + d * cr * rng.uniform(0.35, 0.8) * np.array([1, 1, 0.8])
                pr = cr * rng.uniform(0.5, 0.8)
                add_pad(c, pr, pr, pr * rng.uniform(0.6, 0.9), 0.75, 1.8)
        else:   # cone
            nlv = int(rng.integers(7, 11))
            for b in range(nlv):
                tb = 0.2 + 0.8 * b / (nlv - 1)
                pr = height * (0.24 * (1 - tb) + 0.025) * rng.uniform(0.85, 1.15)
                add_pad(on_trunk(tb) + np.array([0, 0, -pr * 0.25]), pr, pr, pr * 0.45, 0.9, 1.0)

    nt_v = voff
    V = np.concatenate((TV + FV) if TV else FV)
    tris, off = [], nt_v
    for v, tt in zip(FV, FT):
        tris.append(tt + off); off += len(v)
    quads = np.concatenate(TQ) if TQ else None
    me = mesh_from_arrays(name, V, quads, np.concatenate(tris))
    set_attr(me, 'tuft', np.concatenate([np.zeros(nt_v)] + FA))
    nq = 0 if quads is None else len(quads)
    if mats:
        me.materials.append(mats[0]); me.materials.append(mats[1])
        me.polygons.foreach_set('material_index', np.concatenate([np.zeros(nq, np.int32), np.ones(len(me.polygons) - nq, np.int32)]))
        me.polygons.foreach_set('use_smooth', np.concatenate([np.ones(nq, bool), np.zeros(len(me.polygons) - nq, bool)]))
    return bpy.data.objects.new(name, me)


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


def scatter_trees(name, cand, rng, group, n_var, n_shrub, dens_top, dens_ledge, scale=(0.6, 1.15), shrub_ratio=0.55, tree_set='lo', ph_only=False):
    idx = pick_tree_points(cand, rng, dens_top, dens_ledge)
    if len(idx) == 0:
        return None
    co = cand['co'][idx].copy()
    n = len(idx)
    co[:, 2] -= 0.25
    is_shrub = rng.random(n) < shrub_ratio
    if tree_set == 'hi' and PH_IDS:
        ids = np.array(PH_IDS['pine'] + PH_IDS['broad'] + [0, 1, 2, 3, 4, 5, 6, 7])
        w = np.array([0.5 / max(len(PH_IDS['pine']), 1)] * len(PH_IDS['pine']) + [0.14 / max(len(PH_IDS['broad']), 1)] * len(PH_IDS['broad'])
                     + [0.05] * 5 + [0.03, 0.03, 0.05])
        tree_id = rng.choice(ids, n, p=w / w.sum())
    elif n_var >= 8:
        rr_ = rng.random(n)
        tree_id = np.where(rr_ < 0.55, rng.integers(0, 5, n), np.where(rr_ < 0.87, rng.integers(5, 7, n), 7))
    else:
        tree_id = rng.integers(0, n_var, n)
    if tree_set == 'lo':
        rr_ = rng.random(n)
        tree_id = np.where(rr_ < 0.40, rng.integers(0, 5, n), np.where(rr_ < 0.82, rng.integers(5, 7, n), 7))
    tid = np.where(is_shrub, n_var + rng.integers(0, max(n_shrub, 1), n), tree_id)
    if ph_only and PH_IDS:        # ph_only 可以是概率：这部分树换成真实扫描树
        sel = rng.random(n) < float(ph_only)
        if float(ph_only) < 1.5:
            sel &= ~is_shrub
        tid = np.where(sel, rng.choice(np.array(PH_IDS['pine'] * 2 + PH_IDS['broad']), n), tid)
    ledge = ~cand['top'][idx]
    s = rng.uniform(scale[0], scale[1], n) * np.where(ledge, 0.7, 1.0)
    rot = np.stack([rng.normal(0, 0.07, n), rng.normal(0, 0.07, n), rng.random(n) * 6.283], -1)
    scl = np.stack([s, s, s * rng.uniform(0.9, 1.1, n)], -1)
    return make_points_object(name, co, tid, rot, scl, group)


PH_IDS = {}


def append_ph_trees(coll, start_idx):
    """把 Poly Haven 的真实松树（LOD2）和小阔叶树追加进近景树库，返回它们在集合里的序号。"""
    from mathutils import Matrix
    specs = [('pine_tree_01', 'pine_tree_01_1k.blend', ['pine_tree_01_a_LOD2', 'pine_tree_01_b_LOD2', 'pine_tree_01_c_LOD2'], 0.50, 'pine'),
             ('island_tree_02', 'island_tree_02_1k.blend', ['island_tree_02_LOD1'], 1.9, 'broad')]
    idx = start_idx
    out = {'pine': [], 'broad': []}
    for folder, fn, names, scale, kind in specs:
        path = os.path.join(HERE, 'ph', folder, fn)
        if not os.path.exists(path):
            log('missing', path); continue
        with bpy.data.libraries.load(path, link=False) as (src, dst):
            dst.objects = [n for n in names if n in src.objects]
        for ob in dst.objects:
            if ob is None:
                continue
            ob.data.transform(Matrix.Scale(scale, 4))
            ob.location = (0, 0, 0); ob.rotation_euler = (0, 0, 0); ob.scale = (1, 1, 1)
            ob.name = f't0_{idx:02d}_ph_{kind}'
            coll.objects.link(ob)
            out[kind].append(idx)
            idx += 1
            log('PH tree', ob.name, len(ob.data.polygons), [round(d, 1) for d in ob.dimensions])
    return out


# ----------------------------------------------------------------------------- 写实版 v2：走廊 / 机位布局
HDG = math.radians(25.0)
HX, HY = math.cos(HDG), math.sin(HDG)
TURN = (600.0, 0.0)
END2 = (TURN[0] + 3000.0 * HX, TURN[1] + 3000.0 * HY)
L1 = 3100.0                      # 第一段长度：(-2500,0) → (600,0)


def _segd(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    t = np.clip(((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy), 0, 1)
    return np.hypot(px - (ax + t * vx), py - (ay + t * vy))


def corr_dist(px, py):
    """到飞行走廊中线（两段折线）的水平距离。"""
    px, py = np.asarray(px, float), np.asarray(py, float)
    return np.minimum(_segd(px, py, -3000.0, 0.0, TURN[0], TURN[1]), _segd(px, py, TURN[0], TURN[1], END2[0], END2[1]))


def corr_point(s):
    """沿走廊弧长 s（从 x=-2500 起）→ 位置、法向（左手侧）。"""
    if s < L1:
        return (-2500.0 + s, 0.0), (0.0, 1.0)
    u = s - L1
    return (TURN[0] + u * HX, TURN[1] + u * HY), (-HY, HX)


def find_pillar(cx, cy, R, H, min_clear, zmin=40.0, want_lobes=3, seeds=range(500, 540), aspect=1.4, nl_force=None, mode=None, spires=0):
    """挑一个造型好、又不侵入走廊的峰柱：返回 (seed, 旋转角, 实际净空)。"""
    best = None
    for sd in seeds:
        ob, cand = build_pillar('tmp', sd, R, H, 3.0, 'zjj', aspect, None, nl_force=nl_force, extra_spires=spires)
        co = cand['co']
        m = co[:, 2] > zmin
        lobes = cand['lobes']
        me = ob.data
        bpy.data.objects.remove(ob); bpy.data.meshes.remove(me)
        if len(lobes) < want_lobes:
            continue
        hs = np.array([l[3] for l in lobes])
        for k in range(12):
            a = k * math.pi / 6
            ca, sa = math.cos(a), math.sin(a)
            wx = cx + co[m, 0] * ca - co[m, 1] * sa
            wy = cy + co[m, 0] * sa + co[m, 1] * ca
            clear = float(corr_dist(wx, wy).min())
            if clear < min_clear:
                continue
            score = min(len(lobes), 5) + 5.0 * float(hs.std()) / H - 0.04 * (clear - min_clear)
            if mode == 'spires':        # 顶部是几根高低错落的尖峰
                score += sum((1.0 + l[2] / R) for l in lobes[1:] if l[3] > 0.72 * H) * 1.5
            elif mode == 'band':        # 在 z=70~150 的视线带上有带松树的台肩
                score += sum(1.5 for l in lobes[1:] if 70.0 < l[3] < 150.0)
            if best is None or score > best[0]:
                best = (score, sd, a, clear, len(lobes))
    return best


def load_hero_pine():
    from mathutils import Matrix
    path = os.path.join(HERE, 'ph', 'pine_tree_01', 'pine_tree_01_1k.blend')
    if not os.path.exists(path):
        log('hero pine: missing', path); return None
    for nm in (('pine_tree_01_b_LOD0',) if 'herolod0' in ARGV else ()) + ('pine_tree_01_b_LOD1', 'pine_tree_01_b_LOD2'):
        with bpy.data.libraries.load(path, link=False) as (src, dst):
            dst.objects = [nm] if nm in src.objects else []
        if dst.objects and dst.objects[0] is not None:
            ob = dst.objects[0]
            ob.name = 'ENV_HeroPine'
            ob.location = (0, 0, 0); ob.rotation_euler = (0, 0, 0); ob.scale = (1, 1, 1)
            log('hero pine', nm, len(ob.data.polygons), [round(d, 1) for d in ob.dimensions])
            return ob
    return None



# ----------------------------------------------------------------------------- Tripo 黄山松（真实造型）+ 扫描松针
def sun_dist(px, py):
    """到镜头 C 的“太阳通道”（相机 (85,-32) 沿 25° 方位）的水平距离：这条线上不能有东西挡太阳。"""
    return _segd(np.asarray(px, float), np.asarray(py, float), 85.0, -32.0, 85.0 + 1650.0 * HX, -32.0 + 1650.0 * HY)


def load_twigs(coll):
    """从 Poly Haven 扫描松树（LOD1，松针是真实几何）的树冠上切几块带松针的枝梢，作为松针簇实例源：
    生长方向转到 +Z、根部在原点。"""
    from mathutils import Vector
    path = os.path.join(HERE, 'ph', 'pine_tree_01', 'pine_tree_01_1k.blend')
    if not os.path.exists(path):
        return 0
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        dst.objects = [n for n in ('pine_tree_01_b_LOD1',) if n in src.objects]
    if not dst.objects or dst.objects[0] is None:
        return 0
    ob = dst.objects[0]
    me = ob.data
    me.calc_loop_triangles()
    nt_ = len(me.loop_triangles)
    tv = np.zeros(nt_ * 3, np.int32); me.loop_triangles.foreach_get('vertices', tv); tv = tv.reshape(-1, 3)
    tl = np.zeros(nt_ * 3, np.int32); me.loop_triangles.foreach_get('loops', tl); tl = tl.reshape(-1, 3)
    tm = np.zeros(nt_, np.int32); me.loop_triangles.foreach_get('material_index', tm)
    co = np.zeros(len(me.vertices) * 3, np.float32); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3).astype(np.float64)
    uv = np.zeros(len(me.loops) * 2, np.float32); me.uv_layers[0].data.foreach_get('uv', uv); uv = uv.reshape(-1, 2)
    mi = next((i for i, m in enumerate(me.materials) if m and 'twig' in m.name), None)
    if mi is None:
        return 0
    twig_mat = me.materials[mi]
    fsel = np.nonzero(tm == mi)[0]
    cen = co[tv[fsel]].mean(1)
    axis = co[:, :2].mean(0)
    zlo, zhi = co[:, 2].min(), co[:, 2].max()
    rng = np.random.default_rng(77)
    k = 0
    tries = 0
    while k < 5 and tries < 60:
        tries += 1
        j = int(rng.integers(0, len(cen)))
        c0 = cen[j]
        rad = np.hypot(c0[0] - axis[0], c0[1] - axis[1])
        if c0[2] < zlo + 0.55 * (zhi - zlo) or rad < 1.2:      # 取树冠外缘的枝梢
            continue
        m = np.linalg.norm(cen - c0, axis=1) < 0.40
        if m.sum() < 600:
            continue
        ft, fl = tv[fsel][m], tl[fsel][m]
        cc = cen[m].mean(0)
        d = np.array([(cc[0] - axis[0]) / max(rad, 1e-6) * 0.55, (cc[1] - axis[1]) / max(rad, 1e-6) * 0.55, 0.83])
        d /= np.linalg.norm(d)
        R3 = np.array(Vector(d).rotation_difference(Vector((0, 0, 1))).to_matrix())
        used = np.unique(ft)
        remap = np.full(len(co), -1, np.int64); remap[used] = np.arange(len(used))
        V = (co[used] - (cc - d * 0.30)) @ R3.T
        me2 = mesh_from_arrays(f'twig_{k:02d}', V, None, remap[ft])
        ul = me2.uv_layers.new(name='UVMap')
        ul.data.foreach_set('uv', uv[fl.ravel()].ravel().astype(np.float32))
        me2.materials.append(twig_mat)
        coll.objects.link(bpy.data.objects.new(me2.name, me2))
        log('needle tuft', me2.name, 'tris', len(ft), 'size', [round(float(v), 2) for v in (V.max(0) - V.min(0))])
        k += 1
    bpy.data.objects.remove(ob)
    if me.users == 0:
        bpy.data.meshes.remove(me)
    return k


def load_tripo_tree(fname, idx, coll_parent, G_twig, n_twig, tree_h, seed):
    """导入 Tripo 松树 glb：切掉自带的岩石底座、原点放到树干根部、缩放到真实树高，
    并在绿色叶团表面撒上扫描松枝（真实松针）。返回 dict 或 None。"""
    from mathutils import Vector, Quaternion
    path = os.path.join(HERE, 'tripo', fname)
    if not os.path.exists(path):
        return None
    rng = np.random.default_rng(seed)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == 'MESH']
    if not meshes:
        return None
    src = max(meshes, key=lambda o: len(o.data.polygons))
    me = src.data
    M = np.array(src.matrix_world)
    co = np.zeros(len(me.vertices) * 3, np.float32); me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3).astype(np.float64) @ M[:3, :3].T + M[:3, 3]
    tot = np.zeros(len(me.polygons), np.int32); me.polygons.foreach_get('loop_total', tot)
    if not (tot == 3).all():
        log('tripo: not triangulated', fname); return None
    vi = np.zeros(len(me.loops), np.int32); me.loops.foreach_get('vertex_index', vi)
    tri = vi.reshape(-1, 3)
    uv = np.zeros(len(me.loops) * 2, np.float32); me.uv_layers[0].data.foreach_get('uv', uv)
    uv = uv.reshape(-1, 3, 2)
    mat = me.materials[0]
    img = None
    try:
        bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        img = bsdf.inputs['Base Color'].links[0].from_node.image
    except Exception:
        pass
    cen = co[tri].mean(1)
    for nd in mat.node_tree.nodes:
        if nd.type == 'TEX_IMAGE' and nd.image and nd.image.size[0] > 2048:
            nd.image.scale(2048, 2048)
            try:
                nd.image.pack()
            except Exception as e:
                log('pack image:', e)
    zmin, zmax = co[:, 2].min(), co[:, 2].max()
    zf = (cen[:, 2] - zmin) / (zmax - zmin)
    if img is not None:
        im = img.copy(); im.scale(1024, 1024)
        px = np.zeros(1024 * 1024 * 4, np.float32); im.pixels.foreach_get(px); px = px.reshape(1024, 1024, 4)
        bpy.data.images.remove(im)
        uvc = uv.mean(1)
        col = px[np.clip((uvc[:, 1] % 1.0) * 1024, 0, 1023).astype(int), np.clip((uvc[:, 0] % 1.0) * 1024, 0, 1023).astype(int), :3]
    else:
        col = np.tile(np.array([0.2, 0.4, 0.1]), (len(tri), 1))
    r, g, b = col[:, 0], col[:, 1], col[:, 2]
    # 自带岩石底座的识别：底部各高度切片里“非绿色”表面积远大于树干 → 从面积骤降处切掉
    c3 = co[tri]
    area_all = np.linalg.norm(np.cross(c3[:, 1] - c3[:, 0], c3[:, 2] - c3[:, 0]), axis=1) * 0.5
    nong = ~((g > r * 1.03) & (g > b * 1.05))
    nb = 50
    sl_a = np.bincount(np.clip((zf * nb).astype(int), 0, nb - 1), weights=area_all * nong, minlength=nb)
    mid_med = np.median(sl_a[int(nb * 0.40):int(nb * 0.62)]) + 1e-9
    zcut = 0.0
    for j in range(int(nb * 0.5), -1, -1):          # 从树干中部往下找：表面积突然变大的那层就是岩石顶
        if sl_a[j] > 3.2 * mid_med:
            zcut = (j + 1.25) / nb
            break
    keep = zf >= zcut
    fol = keep & (g > r * 1.03) & (g > b * 1.05)
    scale = tree_h / ((1.0 - zcut) * (zmax - zmin))
    sl = keep & (zf < zcut + 0.035)
    base = np.array([np.median(cen[sl, 0]), np.median(cen[sl, 1]), zmin + zcut * (zmax - zmin)]) if sl.any() else np.array([0, 0, zmin])
    co2 = (co - base) * scale
    tk = tri[keep]
    used = np.unique(tk)
    remap = np.full(len(co2), -1, np.int64); remap[used] = np.arange(len(used))
    name = f'tripo_{idx:02d}_' + os.path.splitext(fname)[0]
    me2 = mesh_from_arrays(name, co2[used], None, remap[tk])
    uvl = me2.uv_layers.new(name='UVMap')
    uvl.data.foreach_set('uv', uv[keep].reshape(-1).astype(np.float32))
    me2.materials.append(mat)
    core = bpy.data.materials.get('WK_PineCore')
    if core is None:
        core = bpy.data.materials.new('WK_PineCore')
        core.use_nodes = True
        bs = next(n for n in core.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        bs.inputs['Base Color'].default_value = (0.010, 0.020, 0.009, 1)
        bs.inputs['Roughness'].default_value = 0.9
    me2.materials.append(core)
    me2.polygons.foreach_set('material_index', fol[keep].astype(np.int32))
    tree = bpy.data.objects.new(name, me2)
    for o in new:
        d = o.data if o.type == 'MESH' else None
        bpy.data.objects.remove(o)
        if d is not None and d.users == 0:
            bpy.data.meshes.remove(d)
    vc = bpy.data.collections.new(f'ENV_lib_tripo_{idx:02d}')
    coll_parent.children.link(vc)
    vc.objects.link(tree)
    # 探枝方向：低处叶团相对树干的方位
    cen2 = (cen - base) * scale
    low = fol & (zf < zcut + 0.28)
    refm = low if low.sum() > 200 else fol
    bx, by = float(cen2[refm, 0].mean()), float(cen2[refm, 1].mean())
    branch_angle = math.atan2(by, bx)
    crown_r = float(np.percentile(np.hypot(cen2[fol, 0], cen2[fol, 1]), 98)) if fol.any() else 3.0
    ntw = 0
    if n_twig and fol.any():
        ft = tri[fol]
        a, b_, c = co2[ft[:, 0]], co2[ft[:, 1]], co2[ft[:, 2]]
        nrm = np.cross(b_ - a, c - a)
        area = np.linalg.norm(nrm, axis=1) * 0.5
        nrm = nrm / (np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-12)
        ntw = int(min(area.sum() * 48.0, 6500))
        pick = rng.choice(len(ft), ntw, p=area / area.sum())
        u, v = rng.random(ntw), rng.random(ntw)
        fl = u + v > 1; u[fl], v[fl] = 1 - u[fl], 1 - v[fl]
        pts = a[pick] + (b_[pick] - a[pick]) * u[:, None] + (c[pick] - a[pick]) * v[:, None]
        d = nrm[pick] * 0.6 + np.array([0, 0, 0.8]) + rng.normal(0, 0.30, (ntw, 3))
        d /= np.linalg.norm(d, axis=1, keepdims=True)
        rot = np.zeros((ntw, 3))
        tw = rng.random(ntw) * 6.283
        for i in range(ntw):
            q = Vector(d[i]).to_track_quat('Z', 'Y') @ Quaternion((0, 0, 1), tw[i])
            rot[i] = q.to_euler()
        sc_ = rng.uniform(0.8, 1.3, ntw)
        tids_ = rng.integers(0, n_twig, ntw)
        tp = make_points_object(name + '_twigs', pts - d * 0.10, tids_, rot, np.stack([sc_] * 3, -1), G_twig)
        tp.parent = tree
        vc.objects.link(tp)
        # 散布用的轻量版本：同一棵树的网格，松针数量减到约 1/3
        nf = min(300, ntw)
        vc2 = bpy.data.collections.new(f'ENV_lib_tripo_{idx + 1:02d}')
        coll_parent.children.link(vc2)
        tree2 = bpy.data.objects.new(name + '_field', me2)
        vc2.objects.link(tree2)
        tp2 = make_points_object(name + '_field_twigs', (pts - d * 0.10)[:nf], tids_[:nf], rot[:nf], np.stack([sc_[:nf] * 1.8] * 3, -1), G_twig)
        tp2.parent = tree2
        vc2.objects.link(tp2)
    log(f'tripo {name}: tris={len(tk)} zcut={zcut:.2f} scale={scale:.2f} branch_angle={math.degrees(branch_angle):.0f} crown_r={crown_r:.1f} twigs={ntw}')
    return {'coll': vc, 'obj': tree, 'branch_angle': branch_angle, 'crown_r': crown_r, 'hero_id': idx, 'field_id': idx + 1 if ntw else idx}


def scatter_tripo(name, cand, rng, group, ids, dens_top=0.012, dens_ledge=0.02, scale=(0.75, 1.2), zmin=10.0):
    idx = pick_tree_points(cand, rng, dens_top, dens_ledge, zmin)
    if len(idx) == 0:
        return None
    n = len(idx)
    co = cand['co'][idx].copy()
    co[:, 2] -= 0.2
    s_ = rng.uniform(scale[0], scale[1], n)
    rot = np.stack([rng.normal(0, 0.06, n), rng.normal(0, 0.06, n), rng.random(n) * 6.283], -1)
    return make_points_object(name, co, rng.choice(np.array(ids), n), rot, np.stack([s_] * 3, -1), group)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    rng = np.random.default_rng(SEED)
    ENV = bpy.data.collections.new('ENV')
    scene.collection.children.link(ENV)
    C_near = new_coll('ENV_near', ENV)
    C_mid = new_coll('ENV_mid', ENV)
    C_far = new_coll('ENV_far', ENV)
    C_lib = bpy.data.collections.new('ENV_lib'); C_lib.use_fake_user = True     # 实例源，不进场景
    C_trees_hi = new_coll('ENV_lib_trees_hi', C_lib)
    C_trees_lo = new_coll('ENV_lib_trees_lo', C_lib)
    C_trees_far = new_coll('ENV_lib_trees_far', C_lib)
    C_pvars = new_coll('ENV_lib_pillars', C_lib)

    m_rock = make_rock_material('WK_Rock', 28.0)
    m_rock_mid = make_rock_material('WK_RockMid', 44.0)
    m_rock_far = make_rock_material('WK_RockFar', 130.0, far=True)
    m_need = make_foliage_material()
    m_bark = make_bark_material()

    # ---- 树库
    TREES = [('pine', 6.0), ('pine', 7.5), ('pine', 9.0), ('pine', 10.5), ('pine', 12.0),
             ('round', 6.5), ('round', 8.5), ('cone', 11.0), ('shrub', 2.2), ('shrub', 3.1), ('shrub', 1.5)]
    NV = sum(1 for kd, _ in TREES if kd != 'shrub')
    NS = len(TREES) - NV
    for lod, coll in ((0, C_trees_hi), (1, C_trees_lo), (2, C_trees_far)):
        for k, (kd, hgt) in enumerate(TREES):
            coll.objects.link(build_pine(f't{lod}_{k:02d}_{kd}', 100 + k, hgt, lod, (m_bark, m_need), kd))
    if not QUICK and 'noph' not in ARGV:
        PH_IDS.update(append_ph_trees(C_trees_hi, len(TREES)))
    G_hi = make_instancer_group('WK_Inst_TreesHi', C_trees_hi)
    G_lo = make_instancer_group('WK_Inst_TreesLo', C_trees_lo)
    G_far = make_instancer_group('WK_Inst_TreesFar', C_trees_far)
    log('tree lib done, PH:', PH_IDS)
    # Tripo 黄山松（迎客松 + 可能出现的两棵变体），叶团上撒扫描松针
    C_twigs = new_coll('ENV_lib_twigs', C_lib)
    C_tripo = new_coll('ENV_lib_tripo', C_lib)
    TRIPO = []
    if not QUICK and 'notripo' not in ARGV:
        n_twig = load_twigs(C_twigs)
        G_twig = make_instancer_group('WK_Inst_Twigs', C_twigs) if n_twig else None
        for fn, th_ in (('pine_welcome.glb', 6.8), ('pine_var_a.glb', 6.2), ('pine_var_b.glb', 8.5)):
            t = load_tripo_tree(fn, 2 * len(TRIPO), C_tripo, G_twig, n_twig, th_, 4000 + len(TRIPO))
            if t:
                TRIPO.append(t)
    G_tripo = make_instancer_group('WK_Inst_Tripo', C_tripo) if TRIPO else None

    placed = []     # (x, y, rmax)

    def add_near(name, cx, cy, R, H, seg, min_clear, zmin=40.0, want=3, seeds=range(500, 530), aspect=1.4, nl_force=None,
                 dens=(0.13, 0.11), hi=True, mode=None, tscale=(0.6, 1.15), ph_only=False, sharp=True, spires=0, tripo=None):
        b = find_pillar(cx, cy, R, H, min_clear, zmin, want if nl_force is None else 1, seeds, aspect, nl_force, mode, spires)
        if b is None:
            b = find_pillar(cx, cy, R * 0.85, H, min_clear, zmin, 1, seeds, aspect, nl_force, None, spires)
        if b is None:
            log('!! no valid pillar for', name); return None, None
        _, sd, ang, clear, nl = b
        ob, cand = build_pillar(name, sd, R, H, seg if not QUICK else 2.5, 'zjj', aspect, m_rock, nl_force=nl_force, sharp=sharp, extra_spires=spires)
        ob.location = (cx, cy, 0); ob.rotation_euler = (0, 0, ang)
        C_near.objects.link(ob)
        tp = scatter_trees(name + '_trees', cand, rng, G_hi if hi else G_lo, NV, NS, dens[0], dens[1], scale=tscale, tree_set='hi' if hi else 'lo', ph_only=ph_only)
        if tp:
            tp.parent = ob
            C_near.objects.link(tp)
        if tripo and G_tripo is not None:
            tq = scatter_tripo(name + '_tripo', cand, rng, G_tripo, [t['field_id'] for t in TRIPO], tripo[0], tripo[1])
            if tq:
                tq.parent = ob
                C_near.objects.link(tq)
                log('  tripo pines on', name, len(tq.data.vertices))
        co = cand['co']
        rmax = float(np.hypot(co[:, 0], co[:, 1])[co[:, 2] > 0].max())
        placed.append((cx, cy, rmax))
        log(f'{name}: seed={sd} lobes={nl} clear={clear:.0f} rmax={rmax:.0f} verts={len(ob.data.vertices)} trees={len(tp.data.vertices) if tp else 0}')
        return ob, cand

    # ---- 镜头 C（逆光穿山门）：相机约 (85,-32,98) 朝 +X；太阳（方位 25°）要从门缝里透过来，
    #      所以北柱内缘退到离走廊中线 ≥58 m（太阳光线在 x=250 处经过 y≈45）
    add_near('gateC_L', 250.0, 104.0, 26.0, 312.0, 0.62, 58.0, zmin=30.0, want=3, seeds=range(500, 570), mode='band', ph_only=1.0, tripo=(0.006, 0.011))
    add_near('gateC_R', 270.0, -80.0, 23.0, 268.0, 0.62, 30.0, zmin=30.0, want=3, seeds=range(600, 670), mode='band', ph_only=1.0, tripo=(0.006, 0.011))
    # 迎客松小峰：(95,-38)，顶高约 z=94；顶上是主角松（Tripo 迎客松，探枝朝走廊 +Y 方向伸出）
    rock, rcand = add_near('pine_rock', 95.0, -38.0, 12.5, 94.0, 0.45, 14.0, zmin=20.0, seeds=range(700, 712), aspect=1.2, nl_force=1,
                           dens=(0.012, 0.03), tscale=(0.3, 0.55), ph_only=2.0)
    if rock is not None and TRIPO:
        ang = rock.rotation_euler[2]
        ca, sa = math.cos(-ang), math.sin(-ang)
        wx, wy = 3.0, 0.8                                   # 主角松相对小峰中心的世界偏移（在相机右前方）
        lx, ly = wx * ca - wy * sa, wx * sa + wy * ca
        co = rcand['co']
        topm = co[:, 2] > 60.0
        j = np.argmin(np.hypot(co[topm, 0] - lx, co[topm, 1] - ly) - 0.3 * co[topm, 2])
        lz = float(co[topm][j, 2])
        rz = math.radians(100.0) - TRIPO[0]['branch_angle'] - ang
        hp = make_points_object('ENV_HeroPine', np.array([[lx, ly, lz - 0.25]]), np.array([TRIPO[0]['hero_id']]), np.array([[0.0, 0.0, rz]]), np.array([[1.0, 1.0, 1.0]]), G_tripo)
        hp.parent = rock
        C_near.objects.link(hp)
        log('hero pine at local', round(lx, 1), round(ly, 1), round(lz, 1))

    # ---- 镜头 D：日门（两座巨峰，垂直航向各 115 m）
    gx, gy = TURN[0] + 1500.0 * HX, TURN[1] + 1500.0 * HY
    add_near('gateD_L', gx - 115.0 * HY, gy + 115.0 * HX, 33.0, 450.0, 1.2, 36.0, zmin=120.0, want=4, seeds=range(800, 880), aspect=1.25, mode='spires', dens=(0.022, 0.04), tscale=(1.1, 1.7), spires=5)
    add_near('gateD_R', gx + 115.0 * HY, gy - 115.0 * HX, 31.0, 436.0, 1.2, 36.0, zmin=120.0, want=4, seeds=range(900, 980), aspect=1.25, mode='spires', dens=(0.022, 0.04), tscale=(1.1, 1.7), spires=5)

    # ---- 镜头 B 的虚化背景：x∈[-400,100] 两侧 120~400 m，几根的峰顶在飞行高度附近（松树剪影）
    for i, (cx, cy, R, H) in enumerate([(-80, 190, 20, 128), (30, 268, 24, 152), (-300, 215, 22, 138), (-190, -172, 22, 122),
                                         (60, -245, 26, 168), (-380, -265, 28, 240), (-140, 365, 30, 295), (115, 150, 15, 205)]):
        add_near(f'bgB_{i}', float(cx), float(cy), float(R), float(H), 0.9, 62.0, want=2, seeds=range(1000 + i * 20, 1012 + i * 20), dens=(0.11, 0.10), ph_only=0.5, tripo=(0.006, 0.008))
    # ---- 镜头 A 的近景（画面两侧）
    for i, (cx, cy, R, H) in enumerate([(-764, -114, 17, 168), (-600, -190, 25, 192), (-520, -150, 18, 132), (-690, 150, 22, 230)]):
        add_near(f'nearA_{i}', float(cx), float(cy), float(R), float(H), 0.9, 62.0, want=2, seeds=range(1300 + i * 20, 1312 + i * 20), dens=(0.10, 0.08), ph_only=0.5, tripo=(0.006, 0.008))

    # ---- 走廊沿线其余近景峰柱（两侧 90~300 m）
    n_rand = 0
    s = 150.0
    side = 1
    while s < L1 + 2500.0 and not QUICK:
        (px, py), (nx, ny) = corr_point(s + rng.uniform(-60, 60))
        R = rng.uniform(17, 38); H = rng.uniform(100, 330)
        side = -side if rng.random() < 0.7 else side
        lat = side * rng.uniform(100 + 2.0 * R, 310)
        cx, cy = px + nx * lat, py + ny * lat
        s += rng.uniform(190, 330)
        if any(math.hypot(cx - qx, cy - qy) < qr + 2.2 * R + 30 for qx, qy, qr in placed):
            continue
        if -470 < cx < 180:           # B 段已手工布置
            continue
        if float(sun_dist(cx, cy)) < 2.4 * R + 45:     # 镜头 C 的太阳通道
            continue
        add_near(f'near_{n_rand:02d}', cx, cy, R, H, 1.35, 64.0, want=1, seeds=range(2000 + n_rand * 7, 2005 + n_rand * 7), aspect=float(rng.uniform(1.0, 2.2)))
        n_rand += 1

    # ---- 中景峰柱变体库（实例化）
    n_var = 5 if QUICK else 14
    var_styles = []
    for k in range(n_var):
        style = 'hs' if k % 5 == 4 else 'zjj'
        R = rng.uniform(11, 30) if style == 'zjj' else rng.uniform(55, 95)
        H = rng.uniform(130, 360) if style == 'zjj' else rng.uniform(260, 420)
        asp = rng.uniform(1.0, 2.8) if style == 'zjj' else rng.uniform(1.0, 1.5)
        ob, cand = build_pillar(f'pvar_{k:02d}', SEED * 2000 + k, R, H, 2.2 if style == 'zjj' else 3.5, style, asp, m_rock_mid)
        var_styles.append(style)
        vc = new_coll(f'ENV_lib_pv_{k:02d}', C_pvars)
        vc.objects.link(ob)
        tp = scatter_trees(f'pvar_{k:02d}_trees', cand, rng, G_lo, NV, NS, 0.11, 0.07, scale=(0.6, 1.35), shrub_ratio=0.35)
        if tp:
            tp.parent = ob
            vc.objects.link(tp)
    G_pv = make_instancer_group('WK_Inst_Pillars', C_pvars)
    zjj_ids = [i for i, st in enumerate(var_styles) if st == 'zjj']

    pts, tids, rots, scls = [], [], [], []
    n_cl = 12 if QUICK else 78
    made = 0
    for _ in range(4000):
        if made >= n_cl:
            break
        cx, cy = rng.uniform(-5600, 6200), rng.uniform(-3400, 4600)
        dc = float(corr_dist(cx, cy))
        if dc < 520 or dc > 3300:
            continue
        made += 1
        m = int(rng.integers(4, 15))
        spread = rng.uniform(90, 260)
        hs_ = rng.uniform(0.7, 1.35)
        for q in range(m):
            px, py = cx + rng.normal(0, spread), cy + rng.normal(0, spread * 0.8)
            d2 = float(corr_dist(px, py))
            if d2 < 390 or float(sun_dist(px, py)) < 120:
                continue
            tid = int(rng.integers(0, n_var))
            if var_styles[tid] == 'hs' and d2 < 1300:
                tid = zjj_ids[int(rng.integers(0, len(zjj_ids)))]
            pts.append((px, py, 0.0)); tids.append(tid)
            rots.append((0.0, 0.0, rng.random() * 6.283))
            sxy = rng.uniform(0.8, 1.5)
            scls.append((sxy, sxy, hs_ * rng.uniform(0.75, 1.2)))
    for q in range(0 if QUICK else 30):       # 走廊外侧 340~560 m 补一些，保证两侧不空
        (px, py), (nx, ny) = corr_point(rng.uniform(0, L1 + 2600))
        lat = rng.choice([-1, 1]) * rng.uniform(345, 560)
        px, py = px + nx * lat, py + ny * lat
        if float(corr_dist(px, py)) < 340 or float(sun_dist(px, py)) < 120:
            continue
        pts.append((px, py, 0.0)); tids.append(zjj_ids[int(rng.integers(0, len(zjj_ids)))])
        rots.append((0.0, 0.0, rng.random() * 6.283))
        s_ = rng.uniform(0.7, 1.1)
        scls.append((s_, s_, s_ * rng.uniform(0.8, 1.2)))
    C_mid.objects.link(make_points_object('mid_pillars', np.array(pts), np.array(tids), np.array(rots), np.array(scls), G_pv))
    log('mid instances:', len(pts))

    # ---- 山体与远山层
    terr = []
    if QUICK:
        terr = [(5200, 2400, 2600, 1300, 520, 0.4, 'mix', 14.0, False)]
    else:
        tries = 0
        while len(terr) < 9 and tries < 400:          # 2~5 km 的大山体
            tries += 1
            cx, cy = rng.uniform(-5500, 6500), rng.uniform(-4500, 5500)
            dc = float(corr_dist(cx, cy))
            if dc < 2000 or dc > 4800:
                continue
            sx, sy = rng.uniform(900, 1700), rng.uniform(600, 1100)
            terr.append((cx, cy, sx, sy, rng.uniform(330, 720), rng.random() * 3.14, ('hs', 'zjj', 'mix')[len(terr) % 3], 11.0, True))
        tries = 0
        n0 = len(terr)
        while len(terr) < n0 + 16 and tries < 600:    # 5~12 km 的远山脊（环绕）
            tries += 1
            ang = rng.random() * 6.283
            dist = rng.uniform(5200, 12000)
            cx, cy = 500 + math.cos(ang) * dist, 200 + math.sin(ang) * dist
            if abs((ang - HDG + math.pi) % (2 * math.pi) - math.pi) < 0.5:
                continue                               # 太阳方位留给下面的层叠背景
            sx, sy = rng.uniform(2200, 4600), rng.uniform(700, 1400)
            H = rng.uniform(380, 950) * (0.8 + dist / 22000)
            terr.append((cx, cy, sx, sy, H, ang + math.pi / 2 + rng.normal(0, 0.3), ('zjj', 'mix', 'hs')[len(terr) % 3], 18.0 if dist < 8000 else 24.0, True))
        # 太阳方位（航向 25°，镜头 A / D 的背景）：层叠山脊，越远越高，长轴垂直于视线；高度压在太阳仰角线以下
        for dist, Hh, n_seg in ((4000, 360, 2), (5200, 480, 3), (6700, 640, 3), (8600, 830, 3), (11200, 1050, 4)):
            for q in range(n_seg):
                lat = (q - (n_seg - 1) / 2) * rng.uniform(4300, 5600) + rng.uniform(-800, 800)
                dd = dist + rng.uniform(-300, 300)
                cx = 500 + dd * HX - lat * HY
                cy = 200 + dd * HY + lat * HX
                terr.append((cx, cy, rng.uniform(2300, 3600), rng.uniform(650, 1100), Hh * rng.uniform(0.75, 1.15),
                             HDG + math.pi / 2 + rng.normal(0, 0.18), ('zjj', 'mix', 'hs')[(q + int(dist)) % 3], 12.0 if dist < 6000 else 17.0, False))
    kk = 0
    for (x, y, sx, sy, H, rot, style, res, check) in terr:
        if check:
            aa = np.linspace(0, 2 * np.pi, 24, endpoint=False)
            ex = x + sx * np.cos(aa) * math.cos(rot) - sy * np.sin(aa) * math.sin(rot)
            ey = y + sx * np.cos(aa) * math.sin(rot) + sy * np.sin(aa) * math.cos(rot)
            if float(corr_dist(ex, ey).min()) < 420 or float(corr_dist(x, y)) < 420:
                continue
        tw = rng.uniform(110, 190) if res < 12 else rng.uniform(170, 300)
        ob, cand = build_terrain(f'terr_{kk:02d}', SEED * 3000 + kk, sx, sy, H, res, tw, style, m_rock_far)
        ob.location = (x, y, 0)
        ob.rotation_euler = (0, 0, rot)
        C_far.objects.link(ob)
        if res <= 12.5:
            c2 = dict(cand)
            c2['area'] = cand['area'] * (cand['veg'] > 0.35)
            tp = scatter_trees(f'terr_{kk:02d}_trees', c2, rng, G_far, NV, NS, 0.02, 0.012, scale=(0.8, 1.5), shrub_ratio=0.25)
            if tp:
                tp.parent = ob
                C_far.objects.link(tp)
        kk += 1
    log('terrains:', kk)

    try:
        bpy.ops.file.pack_all()
    except Exception as e:
        log('pack_all:', e)
    out = OUT if os.path.isabs(OUT) else os.path.join(HERE, OUT)
    bpy.ops.wm.save_as_mainfile(filepath=out, compress=True)
    log('saved', out, f'{os.path.getsize(out) / 1e6:.1f} MB')


main()
