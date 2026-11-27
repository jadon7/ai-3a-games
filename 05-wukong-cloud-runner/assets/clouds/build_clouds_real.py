"""写实方案：体积云海 CLOUDSEA + 大气 HAZE + 写实筋斗云 JDY（Cycles）。

用法：Blender -b -P build_clouds_real.py -- sea mist jdy blend     （可以只跑其中几步）
输出：assets/clouds/clouds_real.blend，VDB 在 assets/clouds/vdb_real/（blend 里是相对路径）。

布局：米，Z 上，云海顶面平均 z=0。悟空走廊：(-2500,0)→(600,0)→(2600,930)（第二段航向 25°），
走廊中线两侧 80 m 内云顶 < 45 m；云塔只出现在离走廊 350 m 以外。
"""
import bpy, sys, os, math, time
import numpy as np
import openvdb as vdb

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, 'common'))
import scene_common as sc

VDB_DIR = os.path.join(HERE, 'vdb_real')
os.makedirs(VDB_DIR, exist_ok=True)

# ---------------------------------------------------------------- 参数
N = 4096                 # 主高度场分辨率
DXM = 6.0                # 主高度场格距 (m) -> 覆盖 24.6 km
DX = 3.0                 # 近景体素 (m)
FAR_F = 4                # 远景 = 主场 4x4 平均 -> 24 m
FAR_DZ = 4.0             # 远景竖直体素 (m)，靠物体 Z 缩放
Z_BOT = -45.0
Z_TOP_FAR = 162.0
Z_TOP_NEAR = 114.0
CORRIDOR = [(-2650.0, 0.0), (600.0, 0.0), (2740.0, 995.0)]     # 两端各延长约 150 m
NEAR_LINE = [(-2650.0, 0.0), (600.0, 0.0), (5130.0, 2112.0)]    # 近景细节覆盖线：第二段沿 25° 多延伸到 5 km（给 135mm 长焦镜头 D）
NEAR_W = 760.0           # 近景网格覆盖走廊两侧这么宽（最外 150 m 与远景交叉淡化）
NEAR_FADE = 150.0
SEA_SIGMA = 0.13         # 云海消光 (1/m)
SEA_G = 0.78
SEA_SHELL = 26.0         # 只保留云顶下这么厚的体积壳，更深处用白色“云芯”网格
HAZE_SIGMA = 0.30e-4     # 高层大气雾消光 (1/m)，z -40~620
HAZE_LOW_SIGMA = 0.5e-4  # 低层晨雾消光 (1/m)，z -38~240：出光柱、让 3 km 外明显变淡
HAZE_G = 0.70
HAZE_LOW_G = 0.60
MIST_MAX = 0.018         # 山腰薄雾的归一化密度上限（乘 SEA_SIGMA 后约 0.01 /m）
JDY_T = 120              # 筋斗云循环帧数（24 fps 下 5 秒一圈，序列设为 REPEAT）
JDY_VOX = 1.0 / 60.0     # 筋斗云体素，约 1.67 cm
JDY_BOOST = 14.0         # 筋斗云消光 (1/m)


def smoothstep(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)


def noise_nd(shape, d, lam_lo, lam_hi, seed, slope=None):
    """周期高斯随机场，带通波长 [lam_lo, lam_hi]；slope 给定时为幂律谱。d 可为各轴不同的元组。std=1。"""
    rng = np.random.default_rng(seed)
    w = rng.standard_normal(shape, dtype=np.float32)
    F = np.fft.rfftn(w, axes=tuple(range(len(shape))))
    del w
    nd = len(shape)
    k2 = None
    for ax, n in enumerate(shape):
        dd = d[ax] if isinstance(d, (tuple, list)) else d
        f = np.fft.rfftfreq(n, d=dd) if ax == nd - 1 else np.fft.fftfreq(n, d=dd)
        sh = [1] * nd
        sh[ax] = len(f)
        f2 = (f.reshape(sh).astype(np.float32)) ** 2
        k2 = f2 if k2 is None else k2 + f2
    k = np.maximum(np.sqrt(k2), 1e-9)
    del k2
    k0, k1 = 1.0 / lam_hi, 1.0 / lam_lo
    if slope is None:
        kc = math.sqrt(k0 * k1)
        sig = math.log(k1 / k0) / 2.0 * 0.7 + 0.15
        filt = np.exp(-0.5 * (np.log(k / kc) / sig) ** 2)
    else:
        with np.errstate(over='ignore'):
            filt = k ** (-slope / 2.0)
            filt *= 1.0 / (1.0 + (k0 / k) ** 6)
            filt *= 1.0 / (1.0 + (k / k1) ** 6)
    filt.flat[0] = 0.0
    F *= filt
    del filt, k
    out = np.fft.irfftn(F, s=shape, axes=tuple(range(len(shape)))).astype(np.float32)
    out /= out.std()
    return out


def dist_corridor(x, y, line=None):
    """点到走廊折线的水平距离（可广播）。"""
    d = None
    line = line or CORRIDOR
    for (ax, ay), (bx, by) in zip(line[:-1], line[1:]):
        ex, ey = bx - ax, by - ay
        t = np.clip(((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey), 0.0, 1.0)
        dd = np.sqrt((x - ax - t * ex) ** 2 + (y - ay - t * ey) ** 2)
        d = dd if d is None else np.minimum(d, dd)
    return d


def near_weight(x, y):
    return smoothstep((NEAR_W - dist_corridor(x, y, NEAR_LINE)) / NEAR_FADE)


def new_grid(voxel):
    g = vdb.FloatGrid()
    g.transform = vdb.createLinearTransform(voxelSize=voxel)
    g.name = 'density'
    g.gridClass = vdb.GridClass.FOG_VOLUME
    try:
        g.saveFloatAsHalf = True
    except Exception:
        pass
    return g


def write_vdb(path, arr, ijk, voxel, tol=0.003):
    g = new_grid(voxel)
    g.copyFromArray(np.ascontiguousarray(arr, dtype=np.float32), ijk=ijk, tolerance=tol)
    vdb.write(path, grids=[g])
    return g.activeVoxelCount()


def up2(a):
    n, m = a.shape
    out = np.empty((2 * n - 1, 2 * m - 1), a.dtype)
    out[::2, ::2] = a
    out[1::2, ::2] = 0.5 * (a[:-1] + a[1:])
    out[:, 1::2] = 0.5 * (out[:, :-1:2] + out[:, 2::2])
    return out


def puff(n):
    # 圆顶 + 尖谷：菜花状的折痕 + 孤立的隆起
    return 0.35 * np.abs(n) + 0.95 * np.maximum(n, 0.0) ** 1.15


# ================================================================ 云海
def sea_height():
    t0 = time.time()
    U = noise_nd((N, N), DXM, 1800, 7000, 11)
    n0 = noise_nd((N, N), DXM, 900, 2200, 17)
    n1 = noise_nd((N, N), DXM, 420, 1000, 12)
    n2 = noise_nd((N, N), DXM, 170, 400, 13)
    n3 = noise_nd((N, N), DXM, 70, 160, 14)
    Mk = noise_nd((N, N), DXM, 2200, 6000, 15)
    Tw = noise_nd((N, N), DXM, 1400, 3200, 16)
    M = smoothstep(Mk * 0.45 + 0.55)                 # 0=平滑层云，1=积云翻涌（整体偏翻涌）
    del Mk
    # 大尺度结构：千米级的云丘和云谷 + 几百米的云团 + 细碎起伏
    H = 11.0 * U + 16.0 * puff(n0) * (0.5 + 0.5 * M) + 27.0 * puff(n1) * (0.55 + 0.45 * M) \
        + 12.0 * puff(n2) * (0.22 + 0.78 * M) + 5.0 * puff(n3) * (0.08 + 0.92 * M)
    del U, n0
    ax = ((np.arange(N, dtype=np.float32) - N / 2) * DXM)
    dc = dist_corridor(ax[:, None], ax[None, :]).astype(np.float32)
    # 云塔（稀疏），只在离走廊 350 m 以外
    tower = smoothstep((Tw - 1.40) / 0.7) * smoothstep((dc - 350.0) / 350.0)
    del Tw
    H += tower * (45.0 + 22.0 * puff(n1) + 12.0 * puff(n2) + 6.0 * puff(n3))
    M = np.maximum(M, tower)
    del tower, n1, n2, n3
    H = np.where(H > 140.0, 140.0 + 25.0 * np.tanh((H - 140.0) / 25.0), H)      # 云塔封顶约 +165 m
    H -= np.median(H[::8, ::8]) - 4.0
    # 走廊限高：中线两侧 80 m 内软限到 26 m（加上近景细节和侵蚀噪声后 < 45 m），380 m 外不限
    cw = smoothstep((dc - 80.0) / 300.0)
    Hc = np.where(H > 0, 26.0 * np.tanh(np.maximum(H, 0) / 26.0), H)
    H = H * cw + Hc * (1.0 - cw)
    del Hc, cw, dc
    W = (3.0 + 11.0 * (1.0 - M)).astype(np.float32)   # 软边宽度：积云区锐、层云区糊
    hs = H[::8, ::8]
    print('  height field %.1fs  H: min %.1f p50 %.1f p95 %.1f p99.5 %.1f max %.1f' % (
        time.time() - t0, hs.min(), np.percentile(hs, 50), np.percentile(hs, 95), np.percentile(hs, 99.5), hs.max()), flush=True)
    return H.astype(np.float32), W, M.astype(np.float32)


def gen_sea():
    t0 = time.time()
    H, W, M = sea_height()
    # ---------------- 远景 24 m × 24 m × 6 m
    f = FAR_F
    nf = N // f
    Hf = H.reshape(nf, f, nf, f).mean((1, 3))
    Wf = np.maximum(W.reshape(nf, f, nf, f).mean((1, 3)), 10.0)
    Mf = M.reshape(nf, f, nf, f).mean((1, 3))
    axf = (np.arange(nf, dtype=np.float32) - nf / 2) * DXM * f + (f - 1) / 2 * DXM
    kz0, kz1 = int(round(Z_BOT / FAR_DZ)), int(round(Z_TOP_FAR / FAR_DZ))
    zf = np.arange(kz0, kz1 + 1, dtype=np.float32) * FAR_DZ
    s = Hf[:, :, None] - zf[None, None, :]
    d = smoothstep(s / Wf[:, :, None])
    veil = (0.035 * (1.0 - Mf))[:, :, None] * np.exp(np.minimum(s, 0.0) / 14.0) * (s > -45.0)
    d = np.maximum(d, veil)
    d *= (s < SEA_SHELL + 12.0)
    np.save(os.path.join(VDB_DIR, 'sea_height_far.npy'), Hf)
    d *= (1.0 - near_weight(axf[:, None], axf[None, :]))[:, :, None]
    rr = np.sqrt(axf[:, None] ** 2 + axf[None, :] ** 2)
    d *= smoothstep((N * DXM / 2 - 100.0 - rr) / 900.0)[:, :, None]
    cnt = write_vdb(os.path.join(VDB_DIR, 'sea_far.vdb'), d, (-nf // 2, -nf // 2, kz0), DXM * f)
    print('  sea_far.vdb %s active %.1fM %.1fs' % (d.shape, cnt / 1e6, time.time() - t0), flush=True)
    del d, s, veil, Hf, Wf, Mf, rr

    # ---------------- 近景 3 m：走廊两侧 NEAR_W 以内
    xs_c = [p[0] for p in NEAR_LINE]; ys_c = [p[1] for p in NEAR_LINE]
    c = N // 2
    i0 = int(math.floor((min(xs_c) - NEAR_W) / DXM)) + c; i1 = int(math.ceil((max(xs_c) + NEAR_W) / DXM)) + c
    j0 = int(math.floor((min(ys_c) - NEAR_W) / DXM)) + c; j1 = int(math.ceil((max(ys_c) + NEAR_W) / DXM)) + c
    Hn = up2(H[i0:i1 + 1, j0:j1 + 1]); Wn = up2(W[i0:i1 + 1, j0:j1 + 1]); Mn = up2(M[i0:i1 + 1, j0:j1 + 1])
    del H, W, M
    nx, ny = Hn.shape
    I0, J0 = 2 * (i0 - c), 2 * (j0 - c)                  # 近景体素索引起点（世界坐标 = 索引 × 3 m）
    xs = (np.arange(nx, dtype=np.float32) + I0) * DX
    ys = (np.arange(ny, dtype=np.float32) + J0) * DX
    n4 = noise_nd((1024, 512), DX, 30, 70, 21)
    n5 = noise_nd((1024, 512), DX, 12, 30, 22)
    ii = np.arange(nx) % 1024; jj = np.arange(ny) % 512
    d4 = n4[np.ix_(ii, jj)]; d5 = n5[np.ix_(ii, jj)]
    Hn = Hn + (0.06 + 0.94 * Mn) * (2.4 * (0.55 * np.abs(d4) + 0.75 * np.maximum(d4, 0)) + 0.9 * np.abs(d5))
    del n4, n5, d4, d5
    E = noise_nd((256, 256, 64), DX, 10, 90, 23, slope=3.2)
    E2 = noise_nd((256, 256, 64), DX, 7, 30, 24, slope=2.6)
    kz0, kz1 = int(round(Z_BOT / DX)), int(round(Z_TOP_NEAR / DX))
    zn = np.arange(kz0, kz1 + 1, dtype=np.float32) * DX
    nz = len(zn)
    jy = np.arange(ny) % 256; kzi = np.arange(nz) % 64
    g = new_grid(DX)
    CH = 96
    for a in range(0, nx, CH):
        b = min(nx, a + CH)
        wn = near_weight(xs[a:b, None], ys[None, :])
        if wn.max() <= 0.0:
            continue
        ix = np.arange(a, b) % 256
        e = E[np.ix_(ix, jy, kzi)]; e2 = E2[np.ix_(ix, jy, kzi)]
        mloc = Mn[a:b, :, None]
        s0 = Hn[a:b, :, None] - zn[None, None, :]
        s = s0 + (2.5 + 5.5 * mloc) * e
        dd = smoothstep(s / Wn[a:b, :, None])
        edge = 4.0 * dd * (1.0 - dd)
        dd *= np.clip(1.0 + 0.8 * edge * e2, 0.0, 1.4)
        veil = (0.035 * (1.0 - mloc)) * np.exp(np.minimum(s, 0.0) / 14.0) * (s > -45.0) * np.clip(1.0 + 0.6 * e, 0.0, 2.0)
        dd = np.maximum(dd, veil)
        dd *= (s0 < SEA_SHELL + 8.0)
        dd *= wn[:, :, None]
        g.copyFromArray(np.ascontiguousarray(dd, dtype=np.float32), ijk=(I0 + a, J0, kz0), tolerance=0.003)
    vdb.write(os.path.join(VDB_DIR, 'sea_near.vdb'), grids=[g])
    print('  sea_near.vdb (%d,%d,%d) active %.1fM %.1fs' % (nx, ny, nz, g.activeVoxelCount() / 1e6, time.time() - t0), flush=True)


def gen_mist():
    """缠绕山腰的薄雾带：z 10~250 m，稀疏、水平拉长、半透明。体素 8 m × 8 m × 4 m（物体 Z 缩放 0.5）。"""
    t0 = time.time()
    V = 8.0
    xs_c = [p[0] for p in CORRIDOR]; ys_c = [p[1] for p in CORRIDOR]
    W = 1400.0
    I0 = int(math.floor((min(xs_c) - W) / V)); I1 = int(math.ceil((max(xs_c) + W) / V))
    J0 = int(math.floor((min(ys_c) - W) / V)); J1 = int(math.ceil((max(ys_c) + W) / V))
    nx, ny, nz = I1 - I0 + 1, J1 - J0 + 1, 64
    nxp, nyp = nx + (nx % 2), ny + (ny % 2)
    # 水平波长 250~1100 m，竖直约为其 1/7（薄层）
    a = noise_nd((nxp, nyp, nz), (V, V, 4.0 * 10.0), 250, 1100, 51, slope=3.0)[:nx, :ny]
    b = noise_nd((nxp, nyp, nz), (V, V, 4.0 * 4.0), 60, 260, 52, slope=2.8)[:nx, :ny]
    z = (np.arange(nz, dtype=np.float32) * 4.0)[None, None, :]
    prof = smoothstep((z - 6.0) / 30.0) * (1.0 - smoothstep((z - 90.0) / 110.0))
    m = smoothstep((a + 0.35 * b - 0.95) / 0.8) * prof
    m *= np.clip(1.0 + 0.5 * b, 0.3, 1.8)
    x = (np.arange(nx, dtype=np.float32) + I0) * V
    y = (np.arange(ny, dtype=np.float32) + J0) * V
    dc = dist_corridor(x[:, None], y[None, :])
    m *= smoothstep((dc - 55.0) / 190.0)[:, :, None]                        # 飞行走廊里不放雾带（留给山腰）
    m *= smoothstep((W - 100.0 - dc) / 400.0)[:, :, None]                   # 外缘淡出
    # 走廊一带再垫一层很淡的晨雾（z<150），让山体阴影在里面切出光柱
    veil = 0.0004 * smoothstep((z - 0.0) / 20.0) * (1.0 - smoothstep((z - 70.0) / 90.0))
    m = (m * MIST_MAX + veil * smoothstep((W - 300.0 - dc) / 500.0)[:, :, None]).astype(np.float32)
    cnt = write_vdb(os.path.join(VDB_DIR, 'mist.vdb'), m, (I0, J0, 0), V, tol=0.0002)
    print('  mist.vdb (%d,%d,%d) active %.1fM  coverage %.1f%%  %.1fs' % (nx, ny, nz, cnt / 1e6, 100.0 * (m > 0.01).mean(), time.time() - t0), flush=True)


# ================================================================ 筋斗云
def _blob_field(X, Y, Z, blobs):
    f = np.zeros(np.broadcast(X, Y, Z).shape, dtype=np.float32)
    for (cx, cy, cz, rx, ry, rz) in blobs:
        q = ((X - cx) / rx) ** 2 + ((Y - cy) / ry) ** 2 + ((Z - cz) / rz) ** 2
        f += np.exp(-2.2 * q).astype(np.float32)
    return f


def gen_jdy(frames=None):
    """写实筋斗云：致密小积云（长 3.2 × 宽 2.0 × 高 1.0 m，顶面 z≈0），边缘翻卷，后缘被气流撕出丝缕。
    120 帧无缝循环（噪声块按整数体素滚动）。局部坐标：原点=落脚点，+X 前进方向。"""
    t0 = time.time()
    T = JDY_T
    rng = np.random.default_rng(7)
    v = JDY_VOX
    nx, ny, nz = 360, 180, 180
    i0, j0, k0 = -240, -90, -114               # x∈[-4.0,2.0) y∈[-1.5,1.5) z∈[-1.9,1.1)
    x = (np.arange(nx, dtype=np.float32) + i0) * v
    y = (np.arange(ny, dtype=np.float32) + j0) * v
    z = (np.arange(nz, dtype=np.float32) + k0) * v
    X, Y, Z = x[:, None, None], y[None, :, None], z[None, None, :]
    S = 0.91                                    # 整体比例（相对最初 3.5 m 的版本）
    blobs = [(0.10, 0.0, -0.50, 1.20, 0.82, 0.40), (-0.70, 0.0, -0.48, 0.95, 0.66, 0.34)]
    for a in np.linspace(0, 2 * math.pi, 11, endpoint=False):
        cx = 0.22 + 1.24 * math.cos(a) * (1.0 if math.cos(a) > 0 else 1.12)
        cy = 0.78 * math.sin(a)
        cz = -0.40 + 0.20 * rng.random() - 0.10
        s = 0.40 + 0.16 * rng.random()
        blobs.append((cx, cy, cz, s * 1.15, s, s * 0.80))
    for _ in range(9):
        blobs.append((rng.uniform(-1.25, 1.15), rng.uniform(-0.66, 0.66), rng.uniform(-0.27, -0.12),
                      rng.uniform(0.27, 0.40), rng.uniform(0.25, 0.36), rng.uniform(0.15, 0.23)))
    for _ in range(6):
        blobs.append((rng.uniform(-1.1, 0.95), rng.uniform(-0.56, 0.56), rng.uniform(-0.90, -0.72),
                      rng.uniform(0.28, 0.42), rng.uniform(0.26, 0.38), rng.uniform(0.21, 0.28)))
    blobs = [tuple(c * S for c in b) for b in blobs]
    shape = _blob_field(X, Y, Z, blobs)
    shape *= 0.25 + 0.75 * smoothstep((0.02 - Z) / 0.20)            # 顶面压平到 z≈0
    # 尾流区：把形状场向后“拖”出去并逐渐衰减，丝缕只在这里面长
    wake = np.zeros_like(shape)
    for dsh in (0.2, 0.4, 0.65, 0.9, 1.2, 1.55):
        sh = int(round(dsh / v))
        r = np.zeros_like(shape)
        r[:-sh] = shape[sh:]
        wake = np.maximum(wake, r * math.exp(-dsh / 0.75))
    wk = np.clip(wake - 0.9 * shape, 0.0, None) * smoothstep((-0.75 * S - X) / 0.6)   # 只留云体后缘往后的部分，云体表面不长丝
    del wake
    nA = noise_nd((nx, ny, nz), v, 0.18, 1.6, 31, slope=3.4)        # 大翻涌
    nB = noise_nd((nx, ny, nz), v, 0.06, 0.45, 32, slope=3.0)       # 细节
    nC = noise_nd((nx, ny, nz), v, 0.035, 0.20, 33, slope=2.6)      # 碎边
    nS = noise_nd((nx, ny, nz), (v / 6.0, v, v), 0.05, 0.40, 34, slope=2.4)   # 沿气流方向拉长 6 倍的丝
    fadex = smoothstep((X + 4.0) / 0.6)                              # 网格后端淡出

    if frames is None:
        frames = range(1, T + 1)
    for fr in frames:
        q = fr - 1
        a = np.roll(nA, (-3 * q, 0, 3 * q), axis=(0, 1, 2))
        b = np.roll(nB, (-6 * q, 3 * q, 0), axis=(0, 1, 2))
        c = np.roll(nC, (-9 * q, 0, -3 * q), axis=(0, 1, 2))
        st = np.roll(nS, (-18 * q, 0, 0), axis=(0, 1, 2))
        mod = np.clip(1.0 + 0.55 * a + 0.22 * b, 0.05, 2.6)
        dens = smoothstep((shape * mod - 0.50) / 0.18)
        edge = 4.0 * dens * (1.0 - dens)
        dens = dens * np.clip(1.0 + 0.9 * edge * c, 0.0, 1.4)
        # 被气流撕扯的丝缕：尾流区里用拉长的噪声做阈值，越往后越稀
        wmod = np.clip(1.0 + 1.1 * st + 0.45 * a, 0.0, 3.2)
        wisp = smoothstep((wk * wmod - 0.15) / 0.16) * 0.26
        wisp *= np.clip(1.0 + 0.8 * c, 0.2, 1.8)
        halo = 0.06 * smoothstep((shape * np.clip(1.0 + 0.5 * a, 0.0, 2.5) - 0.16) / 0.40)
        dens = np.maximum(dens, np.maximum(wisp, halo * np.clip(1.0 + 0.8 * b, 0, 2)))
        dens *= fadex
        write_vdb(os.path.join(VDB_DIR, 'jdy_%04d.vdb' % fr), dens, (i0, j0, k0), v, tol=0.004)
        if fr % 30 == 1:
            print('  jdy frame %d %.1fs' % (fr, time.time() - t0), flush=True)
    print('  jdy done %.1fs' % (time.time() - t0), flush=True)


# ================================================================ 材质与组装
def cloud_material(name, sigma, g=0.78, albedo=(1.0, 1.0, 1.0)):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    info = nt.nodes.new('ShaderNodeVolumeInfo')
    mul = nt.nodes.new('ShaderNodeMath')
    mul.operation = 'MULTIPLY'
    mul.inputs[1].default_value = sigma
    mul.name = mul.label = 'SIGMA'
    sca = nt.nodes.new('ShaderNodeVolumeScatter')
    sca.inputs['Color'].default_value = (*albedo, 1.0)
    for sock in sca.inputs:
        if sock.name == 'Anisotropy':
            sock.default_value = g
    sc._set_enum(sca, 'phase', ['HENYEY_GREENSTEIN'])
    sca.name = 'SCATTER'
    nt.links.new(info.outputs['Density'], mul.inputs[0])
    nt.links.new(mul.outputs[0], sca.inputs['Density'])
    nt.links.new(sca.outputs[0], out.inputs['Volume'])
    return m


def haze_material(name, sigma, g, color=(0.80, 0.88, 1.0)):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    sca = nt.nodes.new('ShaderNodeVolumeScatter')
    sc._set_enum(sca, 'phase', ['HENYEY_GREENSTEIN'])
    sca.inputs['Color'].default_value = (*color, 1.0)  
    sca.inputs['Density'].default_value = sigma
    for sock in sca.inputs:
        if sock.name == 'Anisotropy':
            sock.default_value = g
    sca.name = 'HAZE_SCATTER'
    nt.links.new(sca.outputs[0], out.inputs['Volume'])
    return m


def _coll(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c


def _volume_obj(name, relpath, coll, mat, sequence=False, frames=1):
    vol = bpy.data.volumes.new(name)
    vol.filepath = relpath
    if sequence:
        vol.is_sequence = True
        vol.frame_duration = frames
        vol.frame_start = 1
        vol.frame_offset = 0
        sc._set_enum(vol, 'sequence_mode', ['REPEAT'])
    try:
        sc._set_enum(vol.render, 'precision', ['HALF', 'FULL'])
    except Exception:
        pass
    ob = bpy.data.objects.new(name, vol)
    coll.objects.link(ob)
    vol.materials.append(mat)
    return ob


def build_blend():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    blend_path = os.path.join(HERE, 'clouds_real.blend')
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
    sc.setup_render(scene, res=(1920, 804), samples=24, vol_bounces=4)
    sc.setup_world(scene)
    scene.frame_start, scene.frame_end = 1, 240

    cs = _coll('CLOUDSEA')
    m_sea = cloud_material('WK_CloudSea', SEA_SIGMA, g=SEA_G)
    _volume_obj('CloudSea_Near', '//vdb_real/sea_near.vdb', cs, m_sea)
    far = _volume_obj('CloudSea_Far', '//vdb_real/sea_far.vdb', cs, m_sea)
    far.scale = (1.0, 1.0, FAR_DZ / (DXM * FAR_F))
    far.location = ((FAR_F - 1) / 2 * DXM, (FAR_F - 1) / 2 * DXM, 0.0)
    if os.path.exists(os.path.join(VDB_DIR, 'mist.vdb')):
        m_mist = cloud_material('WK_Mist', SEA_SIGMA, g=0.80)
        mist = _volume_obj('CloudSea_Mist', '//vdb_real/mist.vdb', cs, m_mist)
        mist.scale = (1.0, 1.0, 0.5)
    # 垫底面（延伸到地平线）+ 云芯（云顶下 SEA_SHELL 处的白色漫反射面）
    bpy.ops.mesh.primitive_circle_add(vertices=96, radius=90000.0, fill_type='NGON', location=(0, 0, Z_BOT - 1.0))
    under = bpy.context.object
    under.name = 'CloudSea_Underlay'
    for c in list(under.users_collection):
        c.objects.unlink(under)
    cs.objects.link(under)
    mu = bpy.data.materials.new('WK_CloudCore')
    mu.use_nodes = True
    b = next(n for n in mu.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = (0.86, 0.87, 0.90, 1.0)
    b.inputs['Roughness'].default_value = 1.0
    for nm in ('Specular IOR Level', 'Specular'):
        if nm in b.inputs:
            b.inputs[nm].default_value = 0.0
    under.data.materials.append(mu)
    Hf = np.load(os.path.join(VDB_DIR, 'sea_height_far.npy'))
    nc = Hf.shape[0] // 2
    Hs = Hf.reshape(nc, 2, nc, 2).min((1, 3))
    Hm = Hs.copy()
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            Hm = np.minimum(Hm, np.roll(Hs, (di, dj), axis=(0, 1)))
    Hs = (Hm + np.roll(Hm, 1, 0) + np.roll(Hm, -1, 0) + np.roll(Hm, 1, 1) + np.roll(Hm, -1, 1)) / 5.0
    step = DXM * FAR_F * 2
    axc = (np.arange(nc, dtype=np.float32) - nc / 2) * step + (FAR_F * 2 - 1) / 2 * DXM
    XX, YY = np.meshgrid(axc, axc, indexing='ij')
    fade = smoothstep((N * DXM / 2 - 100.0 - np.sqrt(XX ** 2 + YY ** 2)) / 900.0)
    ZZ = (Hs - SEA_SHELL) * fade + (Z_BOT - 0.5) * (1.0 - fade)
    co = np.stack([XX, YY, ZZ], -1).reshape(-1, 3).astype(np.float32)
    ii, jj = np.meshgrid(np.arange(nc - 1), np.arange(nc - 1), indexing='ij')
    v0 = (ii * nc + jj).ravel()
    quads = np.stack([v0, v0 + nc, v0 + nc + 1, v0 + 1], -1).astype(np.int32)
    me = bpy.data.meshes.new('CloudSea_Core')
    me.vertices.add(len(co)); me.vertices.foreach_set('co', co.ravel())
    nq = len(quads)
    me.loops.add(nq * 4); me.polygons.add(nq)
    me.loops.foreach_set('vertex_index', quads.ravel())
    me.polygons.foreach_set('loop_start', np.arange(nq, dtype=np.int32) * 4)
    me.polygons.foreach_set('loop_total', np.full(nq, 4, dtype=np.int32))
    me.polygons.foreach_set('use_smooth', np.ones(nq, dtype=bool))
    me.update(calc_edges=True)
    me.materials.append(mu)
    core = bpy.data.objects.new('CloudSea_Core', me)
    cs.objects.link(core)

    jc = _coll('JDY')
    root = bpy.data.objects.new('JDY_ROOT', None)
    root.empty_display_size = 1.0
    jc.objects.link(root)
    m_jdy = cloud_material('WK_JDY', JDY_BOOST, g=0.76)
    body = _volume_obj('JDY_Body', '//vdb_real/jdy_0001.vdb', jc, m_jdy, sequence=True, frames=JDY_T)
    body.parent = root

    hc = _coll('HAZE')
    for nm, zlo, zhi, sig, g in (('Haze', -40.0, 620.0, HAZE_SIGMA, HAZE_G), ('Haze_Low', -38.0, 240.0, HAZE_LOW_SIGMA, HAZE_LOW_G)):
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, (zlo + zhi) / 2))
        hz = bpy.context.object
        hz.name = nm
        hz.scale = (64000.0 if nm == 'Haze' else 63000.0, 64000.0 if nm == 'Haze' else 63000.0, zhi - zlo)
        for c in list(hz.users_collection):
            c.objects.unlink(hz)
        hc.objects.link(hz)
        hz.data.materials.append(haze_material('WK_' + nm, sig, g))
        hz.display_type = 'BOUNDS'
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
    print('saved', blend_path, flush=True)


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if 'sea' in args:
        print('== SEA', flush=True); gen_sea()
    if 'mist' in args:
        print('== MIST', flush=True); gen_mist()
    if 'jdy' in args:
        print('== JDY', flush=True); gen_jdy()
    if 'jdytest' in args:
        print('== JDY test', flush=True); gen_jdy(frames=[1, 31, 61])
    if 'blend' in args:
        print('== BLEND', flush=True); build_blend()
