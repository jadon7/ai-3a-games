"""云海 CLOUDSEA + 筋斗云 JDY + 大气雾 HAZE 的生成脚本（可重复运行）。

用法（命令行后台 Blender）：
  Blender -b -P build_clouds.py -- sea        # 生成云海 VDB（近景 3 m 体素 + 远景 24 m 体素）
  Blender -b -P build_clouds.py -- jdy        # 生成筋斗云 VDB 序列（120 帧循环）
  Blender -b -P build_clouds.py -- blend      # 组装 clouds.blend（集合 CLOUDSEA / JDY / HAZE）
  可以连写：-- sea jdy blend

约定见 common/scene_common.py：米，Z 向上，云海顶面平均 z=0，飞行方向 +X。
"""
import bpy, sys, os, math, time
import numpy as np
import openvdb as vdb

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, 'common'))
import scene_common as sc

VDB_DIR = os.path.join(HERE, 'vdb')
os.makedirs(VDB_DIR, exist_ok=True)

# ---------------------------------------------------------------- 参数
SEA_N = 8192            # 主高度场分辨率
SEA_DX = 3.0            # 近景体素 (m)
FAR_F = 8               # 远景降采样倍数 -> 24 m
FAR_DZ = 6.0            # 远景竖直体素 (m)，靠物体 Z 缩放实现
NEAR_X = 2802.0         # 近景网格半长
NEAR_Y = 702.0          # 近景网格半宽
Z_BOT, Z_TOP = -45.0, 162.0
SEA_SIGMA = 0.12
SEA_SHELL = 22.0         # 体积只保留云顶以下这么厚的一层壳，更深处用白色漫反射“云芯”网格代替（省大量时间）
SEA_G = 0.78
HAZE_SIGMA = 0.5e-4      # 大气雾消光 (1/m)：3 km 透过率≈0.74，12 km≈0.30       # 云海消光系数 (1/m)，写在材质里

JDY_T = 120             # 筋斗云循环帧数
JDY_VOX = 1.0 / 60.0    # 主体体素 (m)，约 1.67 cm
JDY_TAIL_VOX = 0.05     # 尾迹体素 (m)


def smoothstep(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)


def noise_nd(shape, d, lam_lo, lam_hi, seed, slope=None):
    """周期高斯随机场。带通波长 [lam_lo, lam_hi]（米）。slope 给定时用幂律谱 k^-slope（分形）。
    返回 float32，std=1。"""
    rng = np.random.default_rng(seed)
    w = rng.standard_normal(shape, dtype=np.float32)
    F = np.fft.rfftn(w)
    del w
    ks = []
    nd = len(shape)
    for ax, n in enumerate(shape):
        dd_ = d[ax] if isinstance(d, (tuple, list)) else d
        f = np.fft.rfftfreq(n, d=dd_) if ax == nd - 1 else np.fft.fftfreq(n, d=dd_)
        sh = [1] * nd
        sh[ax] = len(f)
        ks.append(f.reshape(sh).astype(np.float32))
    k2 = ks[0] ** 2
    for kk in ks[1:]:
        k2 = k2 + kk ** 2
    k = np.sqrt(k2)
    del k2
    k0, k1 = 1.0 / lam_hi, 1.0 / lam_lo
    kc = math.sqrt(k0 * k1)
    k = np.maximum(k, 1e-9)
    if slope is None:
        sig = math.log(k1 / k0) / 2.0 * 0.7 + 0.15
        filt = np.exp(-0.5 * (np.log(k / kc) / sig) ** 2)
    else:
        filt = k ** (-slope / 2.0)
        filt *= 1.0 / (1.0 + (k0 / k) ** 6)        # 高通
        filt *= 1.0 / (1.0 + (k / k1) ** 6)        # 低通
    filt.flat[0] = 0.0
    F *= filt
    del filt, k
    out = np.fft.irfftn(F, s=shape, axes=tuple(range(len(shape)))).astype(np.float32)
    out /= out.std()
    return out


def write_vdb(path, arr, ijk, voxel, name='density', tol=0.003):
    g = vdb.FloatGrid()
    g.copyFromArray(np.ascontiguousarray(arr, dtype=np.float32), ijk=ijk, tolerance=tol)
    g.transform = vdb.createLinearTransform(voxelSize=voxel)
    g.name = name
    g.gridClass = vdb.GridClass.FOG_VOLUME
    try:
        g.saveFloatAsHalf = True
    except Exception:
        pass
    vdb.write(path, grids=[g])
    return g.activeVoxelCount()


# ================================================================ 云海
def sea_height():
    """返回 (H, W, M)：全分辨率云顶高度、软边宽度、起伏度蒙版。8192^2, 3 m。"""
    N, DX = SEA_N, SEA_DX
    t0 = time.time()
    U = noise_nd((N, N), DX, 1800, 7000, 11)
    n1 = noise_nd((N, N), DX, 420, 1000, 12)
    n2 = noise_nd((N, N), DX, 170, 400, 13)
    n3 = noise_nd((N, N), DX, 70, 160, 14)
    Mk = noise_nd((N, N), DX, 2200, 6000, 15)
    Tw = noise_nd((N, N), DX, 1400, 3200, 16)
    print('  noise fields %.1fs' % (time.time() - t0), flush=True)

    M = smoothstep(Mk * 0.45 + 0.5)                 # 0=平滑层云，1=积云翻涌
    del Mk
    cov = 0.50 + 0.50 * M

    def puff(n):
        # 圆顶 + 尖谷：|n| 给出菜花状的折痕，max(n,0) 给出孤立的隆起
        return 0.35 * np.abs(n) + 0.95 * np.maximum(n, 0.0) ** 1.15

    bil = 25.0 * puff(n1) * (0.60 + 0.40 * M) + 11.0 * puff(n2) * (0.22 + 0.78 * M) + 4.5 * puff(n3) * (0.08 + 0.92 * M)
    H = 8.0 * U + bil
    del U

    # 云塔（稀疏，最高约 +150 m），飞行走廊内不放
    tower = smoothstep((Tw - 1.45) / 0.7)
    del Tw
    tower_h = tower * (40.0 + 20.0 * puff(n1) + 12.0 * puff(n2) + 6.0 * puff(n3))
    del n1, n2, n3, bil
    ax = (np.arange(N, dtype=np.float32) - N / 2) * DX
    corr_y = smoothstep((np.abs(ax)[None, :] - 160.0) / 260.0)
    corr_x = smoothstep((np.abs(ax)[:, None] - 3000.0) / 400.0)
    corr = np.maximum(corr_y, corr_x)               # 0=走廊内, 1=走廊外
    H = H + tower_h * corr
    M = np.maximum(M, tower)
    del tower, tower_h

    H -= np.median(H) - 4.0
    # 走廊内软限幅到 +28 m，保证 40 m 以上的飞行高度不穿云
    cap = 28.0
    Hc = np.where(H > 0, cap * np.tanh(np.maximum(H, 0) / cap), H)
    H = H * corr + Hc * (1.0 - corr)
    del Hc, corr
    W = (3.0 + 11.0 * (1.0 - M)).astype(np.float32)  # 软边宽度：积云区锐，层云区糊
    print('  height field done %.1fs  H: min %.1f  p50 %.1f  p95 %.1f  p99.5 %.1f  max %.1f' % (
        time.time() - t0, H.min(), np.percentile(H[::16, ::16], 50), np.percentile(H[::16, ::16], 95),
        np.percentile(H[::16, ::16], 99.5), H.max()), flush=True)
    return H.astype(np.float32), W, M.astype(np.float32)


def near_weight(x, y):
    """近景网格的权重（边缘 150 m 过渡带），x,y 可广播。"""
    fx = smoothstep((NEAR_X - 30.0 - np.abs(x)) / 150.0)
    fy = smoothstep((NEAR_Y - 30.0 - np.abs(y)) / 150.0)
    return fx * fy


def gen_sea():
    t0 = time.time()
    N, DX = SEA_N, SEA_DX
    H, W, M = sea_height()

    # ---------------- 远景：24 m × 24 m × 6 m
    f = FAR_F
    nf = N // f
    Hf = H.reshape(nf, f, nf, f).mean((1, 3))
    Wf = np.maximum(W.reshape(nf, f, nf, f).mean((1, 3)), 7.0)
    Mf = M.reshape(nf, f, nf, f).mean((1, 3))
    axf = (np.arange(nf, dtype=np.float32) - nf / 2 + 0.5) * DX * f
    kz0, kz1 = int(round(Z_BOT / FAR_DZ)), int(round(Z_TOP / FAR_DZ))
    zf = np.arange(kz0, kz1 + 1, dtype=np.float32) * FAR_DZ
    s = Hf[:, :, None] - zf[None, None, :]
    d = smoothstep(s / Wf[:, :, None])
    veil = (0.035 * (1.0 - Mf))[:, :, None] * np.exp(np.minimum(s, 0.0) / 14.0) * (s > -45.0)
    d = np.maximum(d, veil)
    d *= (s < SEA_SHELL + 12.0)
    np.save(os.path.join(VDB_DIR, 'sea_height_far.npy'), Hf)
    wn = near_weight(axf[:, None], axf[None, :])
    d *= (1.0 - wn)[:, :, None]
    # 圆形外缘淡出，避免方形边界
    rr = np.sqrt(axf[:, None] ** 2 + axf[None, :] ** 2)
    d *= smoothstep((N * DX / 2 - 100.0 - rr) / 900.0)[:, :, None]
    i0 = -nf // 2
    cnt = write_vdb(os.path.join(VDB_DIR, 'sea_far.vdb'), d, (i0, i0, kz0), DX * f)
    print('  sea_far.vdb  shape %s  active %.1fM  %.1fs' % (d.shape, cnt / 1e6, time.time() - t0), flush=True)
    del d, s, veil, Hf, Wf, Mf

    # ---------------- 近景：3 m 体素
    ix = int(round(NEAR_X / DX)); iy = int(round(NEAR_Y / DX))
    c = N // 2
    Hn = H[c - ix:c + ix + 1, c - iy:c + iy + 1]
    Wn = W[c - ix:c + ix + 1, c - iy:c + iy + 1]
    Mn = M[c - ix:c + ix + 1, c - iy:c + iy + 1]
    del H, W, M
    nx, ny = Hn.shape
    # 近景独有的高频起伏
    n4 = noise_nd((2048, 512), DX, 30, 70, 21)[:nx, :ny]
    n5 = noise_nd((2048, 512), DX, 12, 30, 22)[:nx, :ny]
    Hn = Hn + (0.06 + 0.94 * Mn) * (2.4 * (0.55 * np.abs(n4) + 0.75 * np.maximum(n4, 0)) + 0.9 * np.abs(n5))
    del n4, n5
    # 三维侵蚀噪声（可平铺块 256×256×128，周期 768 m × 384 m）
    E = noise_nd((256, 256, 128), DX, 10, 90, 23, slope=3.2)
    E2 = noise_nd((256, 256, 128), DX, 7, 30, 24, slope=2.6)
    kz0, kz1 = int(round(Z_BOT / DX)), int(round(Z_TOP / DX))
    zn = np.arange(kz0, kz1 + 1, dtype=np.float32) * DX
    nz = len(zn)
    xs = (np.arange(nx, dtype=np.float32) - ix) * DX
    ys = (np.arange(ny, dtype=np.float32) - iy) * DX
    out = np.zeros((nx, ny, nz), dtype=np.float32)
    jy = (np.arange(ny) % 256)
    kzi = (np.arange(nz) % 128)
    CH = 128
    for a in range(0, nx, CH):
        b = min(nx, a + CH)
        ii = (np.arange(a, b) % 256)
        e = E[np.ix_(ii, jy, kzi)]
        e2 = E2[np.ix_(ii, jy, kzi)]
        mloc = Mn[a:b, :, None]
        s = Hn[a:b, :, None] + (2.5 + 5.5 * mloc) * e - zn[None, None, :]
        dd = smoothstep(s / Wn[a:b, :, None])
        # 边缘区的丝缕：只在过渡带里用高频噪声做侵蚀
        edge = 4.0 * dd * (1.0 - dd)
        dd *= np.clip(1.0 + 0.8 * edge * e2, 0.0, 1.4)
        veil = (0.035 * (1.0 - mloc)) * np.exp(np.minimum(s, 0.0) / 14.0) * (s > -45.0) * np.clip(1.0 + 0.6 * e, 0.0, 2.0)
        dd = np.maximum(dd, veil)
        dd *= ((Hn[a:b, :, None] - zn[None, None, :]) < SEA_SHELL + 8.0)
        dd *= near_weight(xs[a:b, None], ys[None, :])[:, :, None]
        out[a:b] = dd
    cnt = write_vdb(os.path.join(VDB_DIR, 'sea_near.vdb'), out, (-ix, -iy, kz0), DX)
    print('  sea_near.vdb shape %s  active %.1fM  %.1fs' % (out.shape, cnt / 1e6, time.time() - t0), flush=True)


# ================================================================ 筋斗云
def _blob_field(X, Y, Z, blobs):
    """软球并集：返回 0..1 的形状场（1=核心）。blobs: (cx,cy,cz,rx,ry,rz)。"""
    f = np.zeros(np.broadcast(X, Y, Z).shape, dtype=np.float32)
    for (cx, cy, cz, rx, ry, rz) in blobs:
        q = ((X - cx) / rx) ** 2 + ((Y - cy) / ry) ** 2 + ((Z - cz) / rz) ** 2
        f += np.exp(-2.2 * q).astype(np.float32)
    return f


def gen_jdy(frames=None):
    """筋斗云：主体（2.5 cm 体素）+ 尾迹（5 cm 体素），120 帧无缝循环。
    局部坐标：原点=悟空落脚点，+X 前进方向，云顶 z≈0。"""
    t0 = time.time()
    T = JDY_T
    rng = np.random.default_rng(7)
    # ---------- 主体网格：x∈[-3.0,3.0) y∈[-1.5,1.5) z∈[-1.9,1.1)  => 240×120×120
    v = JDY_VOX
    nx, ny, nz = 360, 180, 180
    i0, j0, k0 = -180, -90, -114
    x = (np.arange(nx, dtype=np.float32) + i0) * v
    y = (np.arange(ny, dtype=np.float32) + j0) * v
    z = (np.arange(nz, dtype=np.float32) + k0) * v
    X, Y, Z = x[:, None, None], y[None, :, None], z[None, None, :]
    # 蓬松积云团：一个扁平的主团 + 周围一圈鼓包（前缘翻卷，后缘收窄）
    blobs = [(0.10, 0.0, -0.52, 1.25, 0.85, 0.42),
             (-0.75, 0.0, -0.50, 1.00, 0.70, 0.36)]
    for a in np.linspace(0, 2 * math.pi, 11, endpoint=False):
        r = 0.80 + 0.22 * rng.random()
        cx = 0.25 + 1.30 * math.cos(a) * (1.0 if math.cos(a) > 0 else 1.15)
        cy = 0.82 * math.sin(a)
        cz = -0.42 + 0.20 * rng.random() - 0.10
        s = 0.42 + 0.16 * rng.random()
        blobs.append((cx, cy, cz, s * 1.15, s, s * 0.80))
    for _ in range(9):      # 顶面小鼓包（脚边），和底部垂坠
        blobs.append((rng.uniform(-1.3, 1.2), rng.uniform(-0.7, 0.7), rng.uniform(-0.28, -0.12),
                      rng.uniform(0.28, 0.42), rng.uniform(0.26, 0.38), rng.uniform(0.16, 0.24)))
    for _ in range(6):
        blobs.append((rng.uniform(-1.2, 1.0), rng.uniform(-0.6, 0.6), rng.uniform(-0.95, -0.75),
                      rng.uniform(0.30, 0.45), rng.uniform(0.28, 0.40), rng.uniform(0.22, 0.30)))
    shape = _blob_field(X, Y, Z, blobs)
    # 顶面压平到 z≈0（悟空站立处），上方只留很薄的雾
    top = smoothstep((0.02 - Z) / 0.22)
    shape = shape * (0.25 + 0.75 * top)
    # 噪声块（周期 = 网格尺寸，np.roll 实现无缝循环）
    nA = noise_nd((nx, ny, nz), v, 0.18, 1.6, 31, slope=3.4)    # 大翻涌
    nB = noise_nd((nx, ny, nz), v, 0.06, 0.45, 32, slope=3.0)   # 细节
    nC = noise_nd((nx, ny, nz), v, 0.035, 0.20, 33, slope=2.6)  # 丝缕

    # ---------- 尾迹网格：x∈[-21,-3) y∈[-1.5,1.5) z∈[-2.0,1.0) => 360×60×60 (5 cm)
    tv = JDY_TAIL_VOX
    tx_n, ty_n, tz_n = 360, 60, 60
    ti0, tj0, tk0 = -410, -30, -40
    tx = (np.arange(tx_n, dtype=np.float32) + ti0) * tv
    ty = (np.arange(ty_n, dtype=np.float32) + tj0) * tv
    tz = (np.arange(tz_n, dtype=np.float32) + tk0) * tv
    TX, TY, TZ = tx[:, None, None], ty[None, :, None], tz[None, None, :]
    tA = noise_nd((tx_n, ty_n, tz_n), (tv / 1.4, tv, tv), 0.22, 1.5, 41, slope=3.2)
    tB = noise_nd((tx_n, ty_n, tz_n), (tv / 3.0, tv, tv), 0.10, 0.7, 42, slope=2.8)
    tC = noise_nd((tx_n, ty_n, tz_n), tv, 0.10, 0.35, 43, slope=2.4)
    u = np.clip((-3.0 - TX) / 18.0, 0.0, 1.0)            # 0=尾迹根部, 1=末端
    # 主体网格里的尾迹起始段（x<-1.2）也按同一公式算，保证衔接
    ub = np.clip((-3.0 - X) / 18.0, -0.2, 1.0)

    if frames is None:
        frames = range(1, T + 1)
    for fr in frames:
        ph = (fr - 1) / T
        # ---- 主体
        a = np.roll(nA, (-3 * (fr - 1), 0, 3 * (fr - 1)), axis=(0, 1, 2))      # 向后流 + 向上翻
        b = np.roll(nB, (-6 * (fr - 1), 3 * (fr - 1), 0), axis=(0, 1, 2))
        c = np.roll(nC, (-9 * (fr - 1), 0, -3 * (fr - 1)), axis=(0, 1, 2))
        # 尾迹根部（在主体网格内延伸到 x=-3）
        yc = 0.10 * np.sin(2 * math.pi * (X / 2.4 + 2 * ph)) * np.clip(-X - 1.0, 0, 1.5)
        zc = -0.50 + 0.06 * np.sin(2 * math.pi * (X / 3.1 + 1 * ph))
        rr = 0.62 * (1.0 - 0.10 * np.clip(-X - 1.2, 0, 2))
        troot = np.exp(-1.8 * (((Y - yc) / rr) ** 2 + ((Z - zc) / (rr * 0.62)) ** 2)).astype(np.float32)
        troot *= smoothstep((-0.9 - X) / 1.2)
        sfield = np.maximum(shape, 0.85 * troot)
        mod = np.clip(1.0 + 0.55 * a + 0.22 * b, 0.05, 2.6)
        dens = smoothstep((sfield * mod - 0.50) / 0.22)
        edge = 4.0 * dens * (1.0 - dens)
        dens = dens * np.clip(1.0 + 0.9 * edge * c, 0.0, 1.4)
        # 外圈薄雾（柔化轮廓）
        halo = 0.07 * smoothstep((sfield * np.clip(1.0 + 0.5 * a, 0.0, 2.5) - 0.16) / 0.40)
        dens = np.maximum(dens, halo * np.clip(1.0 + 0.8 * b, 0, 2))
        # 网格边界淡出
        dens *= smoothstep((X + 3.0) / 0.5)   # 后端交给尾迹网格（两者在 x∈[-3,-2.5] 交叉淡化）
        write_vdb(os.path.join(VDB_DIR, 'jdy_body_%04d.vdb' % fr), dens, (i0, j0, k0), v, tol=0.004)

        # ---- 尾迹
        ta = np.roll(tA, (-6 * (fr - 1), 0, 0), axis=(0, 1, 2))
        tb = np.roll(tB, (-9 * (fr - 1), 0, (fr - 1)), axis=(0, 1, 2)) if tz_n % 1 == 0 and (tz_n * 2) % T == 0 else \
            np.roll(tB, (-9 * (fr - 1), 0, 0), axis=(0, 1, 2))
        yc = 0.10 * np.sin(2 * math.pi * (TX / 2.4 + 2 * ph)) * np.clip(-TX - 1.0, 0, 1.5) \
            + 0.35 * u * np.sin(2 * math.pi * (TX / 6.0 + 1 * ph))
        zc = -0.50 + 0.06 * np.sin(2 * math.pi * (TX / 3.1 + 1 * ph)) + 0.25 * u * np.sin(2 * math.pi * (TX / 9.0 + 1 * ph) + 1.3)
        rr = 0.50 * (1.0 - 0.60 * u ** 0.8) + 0.06
        tube = None
        # 三股互相缠绕的丝缕（越往后分得越开）
        for (ay, az, py, pz, lam, rs) in ((1.0, 1.0, 0.0, 1.3, 6.0, 1.0), (-0.9, 0.8, 2.1, 0.4, 4.5, 0.62), (0.7, -1.0, 4.0, 2.9, 7.5, 0.55)):
            yci = 0.10 * np.sin(2 * math.pi * (TX / 2.4 + 2 * ph)) * np.clip(-TX - 1.0, 0, 1.5) \
                + 0.38 * u * ay * np.sin(2 * math.pi * (TX / lam + 1 * ph) + py)
            zci = -0.50 + 0.06 * np.sin(2 * math.pi * (TX / 3.1 + 1 * ph)) \
                + 0.26 * u * az * np.sin(2 * math.pi * (TX / (lam * 1.5) + 1 * ph) + pz)
            ri = rr * (1.0 - (1.0 - rs) * np.clip(u * 4.0, 0, 1))
            t_i = np.exp(-1.8 * (((TY - yci) / ri) ** 2 + ((TZ - zci) / (ri * 0.66)) ** 2)).astype(np.float32)
            tube = t_i if tube is None else np.maximum(tube, t_i)
        tc = np.roll(tC, (-12 * (fr - 1), 0, 0), axis=(0, 1, 2))
        thr = 0.40 + 0.22 * u                       # 越往后越稀疏、越破碎
        tmod = np.clip(1.0 + (0.60 + 0.55 * u) * ta + (0.25 + 0.35 * u) * tb, 0.0, 3.0)
        td = smoothstep((0.85 * tube * tmod - thr) / 0.20)
        thalo = 0.07 * smoothstep((tube * np.clip(1.0 + 0.6 * ta, 0, 2.5) - 0.12) / 0.4) * np.clip(1.0 + 0.8 * tb, 0, 2)
        td *= (1.0 - u) ** 1.1 * (0.38 + 0.62 * np.exp(-7.0 * u))
        edge = 4.0 * td * (1.0 - td)
        td = td * np.clip(1.0 + 1.0 * edge * tc, 0.0, 1.5)
        td = np.maximum(td, thalo)
        td *= 1.0 - smoothstep((TX + 3.0) / 0.5)    # 与主体网格交叉淡化
        td *= smoothstep((1.0 - u) / 0.12)
        write_vdb(os.path.join(VDB_DIR, 'jdy_tail_%04d.vdb' % fr), td, (ti0, tj0, tk0), tv, tol=0.004)
        if fr % 20 == 1:
            print('  jdy frame %d  %.1fs' % (fr, time.time() - t0), flush=True)
    print('  jdy done %.1fs' % (time.time() - t0), flush=True)


# ================================================================ 材质与组装
def cloud_material(name, sigma, diameter=18.0, albedo=(1.0, 1.0, 1.0), density_boost=1.0, phase='HENYEY_GREENSTEIN', g=0.72):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    info = nt.nodes.new('ShaderNodeVolumeInfo')
    mul = nt.nodes.new('ShaderNodeMath')
    mul.operation = 'MULTIPLY'
    mul.inputs[1].default_value = sigma * density_boost
    mul.label = 'SIGMA'
    mul.name = 'SIGMA'
    sca = nt.nodes.new('ShaderNodeVolumeScatter')
    sca.inputs['Color'].default_value = (*albedo, 1.0)
    for sock in sca.inputs:                      # 切换相函数前先把所有参数写好
        if sock.name == 'Anisotropy':
            sock.default_value = g
        elif sock.name == 'Diameter':
            sock.default_value = diameter
    sc._set_enum(sca, 'phase', [phase, 'HENYEY_GREENSTEIN'])
    nt.links.new(info.outputs['Density'], mul.inputs[0])
    nt.links.new(mul.outputs[0], sca.inputs['Density'])
    nt.links.new(sca.outputs[0], out.inputs['Volume'])
    return m


def haze_material(name, sigma, g=0.55, color=(0.80, 0.88, 1.0)):
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
    try:
        m.cycles.volume_sampling = 'DISTANCE'
    except Exception:
        pass
    return m


def _coll(name):
    c = bpy.data.collections.get(name)
    if c is None:
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
    blend_path = os.path.join(HERE, 'clouds.blend')
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)     # 先存一次，才能用 // 相对路径
    sc.setup_render(scene, samples=64, vol_bounces=8)
    sc.setup_world(scene)
    scene.frame_start, scene.frame_end = 1, 240

    # ---------------- CLOUDSEA
    cs = _coll('CLOUDSEA')
    m_sea = cloud_material('WK_CloudSea', SEA_SIGMA, g=SEA_G)
    near = _volume_obj('CloudSea_Near', '//vdb/sea_near.vdb', cs, m_sea)
    far = _volume_obj('CloudSea_Far', '//vdb/sea_far.vdb', cs, m_sea)
    far.scale = (1.0, 1.0, FAR_DZ / (SEA_DX * FAR_F))
    far.location = (10.5, 10.5, 0.0)        # 远景块平均后的半体素偏移
    # 云芯：云顶以下 SEA_SHELL 处的白色漫反射面，代替深处的体积（多次散射的近似 + 提前截断阴影光线）
    Hf = np.load(os.path.join(VDB_DIR, 'sea_height_far.npy'))
    nc = Hf.shape[0] // 2
    Hs = Hf.reshape(nc, 2, nc, 2).min((1, 3))
    Hm = Hs.copy()
    for di in (-1, 0, 1):
        for dj in (-1, 0, 1):
            Hm = np.minimum(Hm, np.roll(Hs, (di, dj), axis=(0, 1)))
    Hs = (Hm + np.roll(Hm, 1, 0) + np.roll(Hm, -1, 0) + np.roll(Hm, 1, 1) + np.roll(Hm, -1, 1)) / 5.0
    step = SEA_DX * FAR_F * 2
    axc = ((np.arange(nc, dtype=np.float32) - nc / 2) * step + 22.5)
    XX, YY = np.meshgrid(axc, axc, indexing='ij')
    rr = np.sqrt(XX ** 2 + YY ** 2)
    fade = smoothstep((SEA_N * SEA_DX / 2 - 100.0 - rr) / 900.0)
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
    core = bpy.data.objects.new('CloudSea_Core', me)
    cs.objects.link(core)
    # 云下垫底面：相当于更深处的云，挡住从下方漏上来的天空，并延伸到地平线
    bpy.ops.mesh.primitive_circle_add(vertices=96, radius=90000.0, fill_type='NGON', location=(0, 0, Z_BOT - 1.0))
    under = bpy.context.object
    under.name = 'CloudSea_Underlay'
    for c in list(under.users_collection):
        c.objects.unlink(under)
    cs.objects.link(under)
    mu = bpy.data.materials.new('WK_CloudUnderlay')
    mu.use_nodes = True
    b = next(n for n in mu.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = (0.86, 0.87, 0.90, 1.0)
    b.inputs['Roughness'].default_value = 1.0
    for nm in ('Specular IOR Level', 'Specular'):
        if nm in b.inputs:
            b.inputs[nm].default_value = 0.0
    under.data.materials.append(mu)
    core.data.materials.append(mu)

    # ---------------- JDY
    jc = _coll('JDY')
    root = bpy.data.objects.new('JDY_ROOT', None)
    root.empty_display_size = 1.0
    jc.objects.link(root)
    m_jdy = cloud_material('WK_JDY', 1.0, diameter=18.0, density_boost=12.0)
    body = _volume_obj('JDY_Body', '//vdb/jdy_body_0001.vdb', jc, m_jdy, sequence=True, frames=JDY_T)
    tail = _volume_obj('JDY_Tail', '//vdb/jdy_tail_0001.vdb', jc, m_jdy, sequence=True, frames=JDY_T)
    body.parent = root
    tail.parent = root

    # ---------------- HAZE
    hc = _coll('HAZE')
    zlo, zhi = -40.0, 520.0
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, (zlo + zhi) / 2))
    hz = bpy.context.object
    hz.name = 'Haze'
    hz.scale = (64000.0, 64000.0, zhi - zlo)
    for c in list(hz.users_collection):
        c.objects.unlink(hz)
    hc.objects.link(hz)
    hz.data.materials.append(haze_material('WK_Haze', HAZE_SIGMA))
    hz.display_type = 'BOUNDS'
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
    print('saved', blend_path, flush=True)


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if 'sea' in args:
        print('== SEA', flush=True)
        gen_sea()
    if 'jdy' in args:
        print('== JDY', flush=True)
        gen_jdy()
    if 'jdytest' in args:
        print('== JDY test frames', flush=True)
        gen_jdy(frames=[1, 60])
    if 'blend' in args:
        print('== BLEND', flush=True)
        build_blend()
