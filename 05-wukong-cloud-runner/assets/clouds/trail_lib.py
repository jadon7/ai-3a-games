"""trail_lib —— 筋斗云身后的体积水汽尾迹（写实，Cycles，无状态）。

做法：按「弧长 → 年龄」解析算出每一帧的密度场，烘焙成 VDB 序列（每帧一个文件），再用体积物体按帧读取。
每一帧只取决于该帧号（噪声是固定在世界空间的平铺块），所以任意帧单独渲染、乱序渲染结果都一样。
烘焙很快（约 0.1~0.3 秒/帧），有缓存：参数和路径没变时再次调用直接复用。

约定：path_curve 是点距约 2 m 的 POLY 折线；悟空第 f 帧位于弧长 s = speed*(f - path_f0)/fps 处。
尾迹留在世界空间：某处的水汽年龄 = 悟空飞过它之后经过的时间；约 life 秒内变粗、变淡、破碎。

用法：
    import sys; sys.path.insert(0, ROOT + '/assets/clouds'); import trail_lib
    objs = trail_lib.add_vapor_trail(scene, path_curve, speed=45.0, f_start=1, f_end=120, fps=24, path_f0=1)
返回 [近段体积(5 cm 体素，离云 9 m 内), 远段体积(15 cm 体素)]，放进集合 "JDY_TRAIL"。
限制：尾迹存活的那一段路径要在水平面上大致单向（不能在 life 秒内掉头）；本片的走廊（直行 + 25° 转弯）没问题。
"""
import bpy, os, sys, math, json, hashlib, time
import numpy as np
import openvdb as vdb

_HERE = os.path.dirname(os.path.abspath(__file__))
_TILES = {}


def _smooth(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)


def _noise_tile(n, lam_lo, lam_hi, seed, slope):
    """周期高斯噪声块 n^3（波长以体素为单位），std=1。"""
    key = (n, lam_lo, lam_hi, seed, slope)
    if key in _TILES:
        return _TILES[key]
    rng = np.random.default_rng(seed)
    w = rng.standard_normal((n, n, n), dtype=np.float32)
    F = np.fft.rfftn(w, axes=(0, 1, 2))
    f = np.fft.fftfreq(n).astype(np.float32)
    fr = np.fft.rfftfreq(n).astype(np.float32)
    k = np.maximum(np.sqrt(f[:, None, None] ** 2 + f[None, :, None] ** 2 + fr[None, None, :] ** 2), 1e-9)
    k0, k1 = 1.0 / lam_hi, 1.0 / lam_lo
    with np.errstate(over='ignore'):
        filt = k ** (-slope / 2.0) / (1.0 + (k0 / k) ** 6) / (1.0 + (k / k1) ** 6)
    filt.flat[0] = 0.0
    out = np.fft.irfftn(F * filt, s=(n, n, n), axes=(0, 1, 2)).astype(np.float32)
    out /= out.std()
    _TILES[key] = out
    return out


def path_points(path_curve):
    spl = path_curve.data.splines[0]
    mw = path_curve.matrix_world
    from mathutils import Vector
    if len(spl.points):
        P = np.array([tuple(mw @ Vector(p.co[:3])) for p in spl.points], dtype=np.float64)
    else:
        P = np.array([tuple(mw @ p.co) for p in spl.bezier_points], dtype=np.float64)
    seg = np.linalg.norm(np.diff(P, axis=0), axis=1)
    return P, np.concatenate([[0.0], np.cumsum(seg)])


def sample_path(P, S, s):
    s = np.clip(np.asarray(s, dtype=np.float64), 0.0, S[-1] - 1e-6)
    idx = np.clip(np.searchsorted(S, s, side='right') - 1, 0, len(P) - 2)
    t = ((s - S[idx]) / np.maximum(S[idx + 1] - S[idx], 1e-9))[:, None]
    pos = P[idx] + (P[idx + 1] - P[idx]) * t
    i0 = np.clip(idx - 2, 0, len(P) - 1)
    i1 = np.clip(idx + 3, 0, len(P) - 1)
    tan = P[i1] - P[i0]
    tan /= np.maximum(np.linalg.norm(tan, axis=1), 1e-9)[:, None]
    return pos, tan


def _wobble(s, seed):
    """沿弧长固定的一维平滑噪声（几组正弦叠加），幅度约 ±1。"""
    rng = np.random.default_rng(seed)
    out = np.zeros_like(s)
    for lam, amp in ((6.5, 0.45), (13.0, 0.6), (27.0, 0.7)):
        out += amp * np.sin(2 * math.pi * s / lam + rng.uniform(0, 6.283))
    return out / 1.0


def _bake_grid(P, S, s_emit, speed, voxel, pr, w_lo, w_hi, near):
    """生成一帧的一个密度网格。w_lo/w_hi：这个网格负责的“离出生点距离”范围（米），两端各 2.5 m 交叉淡化。"""
    g = vdb.FloatGrid()
    g.transform = vdb.createLinearTransform(voxelSize=voxel)
    g.name = 'density'
    g.gridClass = vdb.GridClass.FOG_VOLUME
    try:
        g.saveFloatAsHalf = True
    except Exception:
        pass
    life = pr['life']
    L = speed * life
    sa = max(0.0, s_emit - min(L, w_hi))
    sb = s_emit - max(0.0, w_lo - 2.5)
    if sb - sa < voxel * 4 or s_emit <= 0:
        return g
    ss = np.arange(sa, sb, voxel * 0.5)
    pos, tan = sample_path(P, S, ss)
    age = (s_emit - ss) / speed
    side = np.stack([-tan[:, 1], tan[:, 0], np.zeros(len(ss))], -1)
    side /= np.maximum(np.linalg.norm(side, axis=1), 1e-9)[:, None]
    A = pr['wobble'] * (1.0 - np.exp(-age / 1.2))
    C = pos + side * (A * _wobble(ss, pr['seed']))[:, None]
    C[:, 2] += pr['offset_z'] + A * 0.6 * _wobble(ss, pr['seed'] + 1) + pr['rise'] * age
    ax = 0 if abs(C[-1, 0] - C[0, 0]) >= abs(C[-1, 1] - C[0, 1]) else 1
    la = 1 - ax
    u = C[:, ax].copy()
    lat, zz, ag, ct = C[:, la], C[:, 2], age, np.abs(tan[:, ax])
    if u[-1] < u[0]:
        u, lat, zz, ag, ct = u[::-1], lat[::-1], zz[::-1], ag[::-1], ct[::-1]
    u = np.maximum.accumulate(u)
    iu = np.arange(int(math.ceil(u[0] / voxel)), int(math.floor(u[-1] / voxel)) + 1)
    if len(iu) < 2:
        return g
    U = iu * voxel
    yc = np.interp(U, u, lat); zc = np.interp(U, u, zz); a = np.interp(U, u, ag); c = np.maximum(np.interp(U, u, ct), 0.3)
    R = pr['r0'] + (pr['r_end'] - pr['r0']) * np.sqrt(np.clip(a / life, 0, 1))
    d = a * speed                                             # 离出生点的距离
    w = _smooth((d - (w_lo - 2.5)) / 2.5) if w_lo > 0 else np.ones_like(d)
    if w_hi < L:
        w = w * (1.0 - _smooth((d - (w_hi - 2.5)) / 2.5))
    Dn = pr['density'] * (pr['r0'] / R) ** 2 * _smooth(a / 0.05) * (1.0 - _smooth((a - 0.55 * life) / (0.45 * life))) * w
    thr = 0.20 + 0.24 * np.clip(a / life, 0, 1)
    n = 128
    if near:
        tA = _noise_tile(n, 3.0, 26.0, 71, 3.2); tB = _noise_tile(n, 1.6, 7.0, 72, 2.6)
    else:
        tA = _noise_tile(n, 4.0, 22.0, 73, 3.2); tB = _noise_tile(n, 2.0, 7.0, 74, 2.6)
    CH = 48
    for i0 in range(0, len(iu), CH):
        i1 = min(len(iu), i0 + CH)
        if Dn[i0:i1].max() <= 1e-4:
            continue
        Rm = R[i0:i1].max() * 1.75
        jlo = int(math.floor((yc[i0:i1].min() - Rm / c[i0:i1].min()) / voxel)); jhi = int(math.ceil((yc[i0:i1].max() + Rm / c[i0:i1].min()) / voxel))
        klo = int(math.floor((zc[i0:i1].min() - Rm) / voxel)); khi = int(math.ceil((zc[i0:i1].max() + Rm) / voxel))
        jy = np.arange(jlo, jhi + 1); kz = np.arange(klo, khi + 1)
        dy = (jy[None, :, None] * voxel - yc[i0:i1, None, None]) * c[i0:i1, None, None]
        dz = kz[None, None, :] * voxel - zc[i0:i1, None, None]
        q = (dy * dy + dz * dz) / (R[i0:i1, None, None] ** 2)
        prof = np.exp(-2.0 * q).astype(np.float32)
        if ax == 0:
            ix3 = np.ix_(iu[i0:i1] % n, jy % n, kz % n)
            nA = tA[ix3]; nB = tB[ix3]
        else:
            ix3 = np.ix_(jy % n, iu[i0:i1] % n, kz % n)
            nA = tA[ix3].transpose(1, 0, 2); nB = tB[ix3].transpose(1, 0, 2)
        val = prof * np.clip(1.0 + 0.95 * nA + 0.45 * nB, 0.0, 3.2)
        dens = Dn[i0:i1, None, None] * _smooth((val - thr[i0:i1, None, None]) / 0.22)
        dens = dens.astype(np.float32)
        if ax == 0:
            g.copyFromArray(np.ascontiguousarray(dens), ijk=(int(iu[i0]), jlo, klo), tolerance=0.002)
        else:
            g.copyFromArray(np.ascontiguousarray(dens.transpose(1, 0, 2)), ijk=(jlo, int(iu[i0]), klo), tolerance=0.002)
    return g


def _material(name, sigma, g):
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    info = nt.nodes.new('ShaderNodeVolumeInfo')
    mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'
    mul.inputs[1].default_value = sigma; mul.name = mul.label = 'SIGMA'
    sca = nt.nodes.new('ShaderNodeVolumeScatter')
    sca.inputs['Color'].default_value = (1, 1, 1, 1)
    for s in sca.inputs:
        if s.name == 'Anisotropy':
            s.default_value = g
    nt.links.new(info.outputs['Density'], mul.inputs[0])
    nt.links.new(mul.outputs[0], sca.inputs['Density'])
    nt.links.new(sca.outputs[0], out.inputs['Volume'])
    return m


def add_vapor_trail(scene, path_curve, speed, f_start, f_end, fps=24, path_f0=None, name='VaporTrail',
                    life=2.6, r0=0.45, r_end=2.4, density=1.0, sigma=7.0, g=0.76, wobble=0.8, rise=0.30,
                    offset=(-1.3, -0.45), voxel=0.15, voxel_near=0.05, near_len=9.0,
                    cache_dir=None, rebake=False, collection='JDY_TRAIL', seed=11, verbose=True):
    """筋斗云水汽尾迹。
    speed：飞行速度 m/s；f_start..f_end：需要尾迹的帧范围；path_f0：悟空位于曲线起点的帧（默认 = f_start）。
    life：水汽寿命（秒），尾迹长度 ≈ speed*life；r0 / r_end：初始 / 消散前半径（米）；
    sigma：消光系数（1/m，新鲜尾迹的浓度，材质里可再调，节点名 SIGMA）；density：整体密度倍率；
    offset：(沿飞行方向, 竖直) 出生点相对悟空落脚点的偏移，默认在身后 1.3 m、脚下 0.45 m（筋斗云后缘）；
    wobble：尾迹随年龄左右/上下飘摆的幅度（米）；rise：上浮速度 m/s。
    返回 [near_obj, far_obj]。烘焙结果缓存在 cache_dir（默认 assets/clouds/trail_cache/<name>）。"""
    fps = float(fps or scene.render.fps)
    path_f0 = f_start if path_f0 is None else path_f0
    P, S = path_points(path_curve)
    cache_dir = cache_dir or os.path.join(_HERE, 'trail_cache', name)
    os.makedirs(cache_dir, exist_ok=True)
    pr = dict(life=float(life), r0=float(r0), r_end=float(r_end), density=float(density), wobble=float(wobble),
              rise=float(rise), offset_z=float(offset[1]), seed=int(seed))
    key = hashlib.md5(json.dumps([pr, float(speed), int(f_start), int(f_end), fps, float(path_f0), float(offset[0]),
                                  voxel, voxel_near, near_len, np.round(P, 2).tolist()]).encode()).hexdigest()
    nfr = int(f_end) - int(f_start) + 1
    meta = os.path.join(cache_dir, 'meta.json')
    ok = False
    if not rebake and os.path.exists(meta):
        try:
            ok = json.load(open(meta)).get('key') == key and all(
                os.path.exists(os.path.join(cache_dir, '%s_%s_%04d.vdb' % (name, t, nfr))) for t in ('near', 'far'))
        except Exception:
            ok = False
    if not ok:
        t0 = time.time()
        for i in range(nfr):
            f = f_start + i
            s_emit = speed * (f - path_f0) / fps + offset[0]
            gn = _bake_grid(P, S, s_emit, speed, voxel_near, pr, 0.0, near_len, True)
            gf = _bake_grid(P, S, s_emit, speed, voxel, pr, near_len, 1e9, False)
            vdb.write(os.path.join(cache_dir, '%s_near_%04d.vdb' % (name, i + 1)), grids=[gn])
            vdb.write(os.path.join(cache_dir, '%s_far_%04d.vdb' % (name, i + 1)), grids=[gf])
        json.dump({'key': key, 'frames': nfr, 'f_start': int(f_start)}, open(meta, 'w'))
        if verbose:
            print('trail_lib: baked %d frames -> %s  (%.1fs)' % (nfr, cache_dir, time.time() - t0), flush=True)
    coll = bpy.data.collections.get(collection)
    if coll is None:
        coll = bpy.data.collections.new(collection)
    if coll.name not in [c.name for c in scene.collection.children_recursive]:
        scene.collection.children.link(coll)
    mat = _material('WK_VaporTrail', sigma, g)
    objs = []
    for t in ('near', 'far'):
        oname = '%s_%s' % (name, t)
        old = bpy.data.objects.get(oname)
        if old is not None:
            bpy.data.objects.remove(old)
        vol = bpy.data.volumes.new(oname)
        vol.filepath = os.path.join(cache_dir, '%s_%s_%04d.vdb' % (name, t, 1))
        vol.is_sequence = True
        vol.frame_start = int(f_start)
        vol.frame_duration = nfr
        vol.frame_offset = 0
        try:
            vol.sequence_mode = 'CLIP'
        except Exception:
            pass
        try:
            vol.render.precision = 'HALF'
        except Exception:
            pass
        vol.materials.append(mat)
        ob = bpy.data.objects.new(oname, vol)
        coll.objects.link(ob)
        objs.append(ob)
    return objs
