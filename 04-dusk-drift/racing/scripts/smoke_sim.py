# 胎烟/水雾粒子模拟 -> OpenVDB 序列（需在 Blender 自带 Python 里运行：Blender -b -P smoke_sim.py -- [--frames a-b] [--test]）
import sys, os, math, time
import numpy as np

ROOT = "/Users/jadon7/Library/Application Support/Claude/scratch-workspaces/dfe2b44a-8503-4a5e-af9b-63b1be0e053b/aae3434b-694f-413f-a991-1f79c427025e/scratch-2026-11-21-ab6c85/racing"
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import motion as M
import openvdb as vdb

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    return argv[argv.index(name) + 1] if name in argv else default


OUT = arg("--out", os.path.join(ROOT, "cache/smoke"))
os.makedirs(OUT, exist_ok=True)
F0, F1 = 1, M.NF
if arg("--frames"):
    a, b = arg("--frames").split("-")
    F0, F1 = int(a), int(b)
WRITE_STEP = int(arg("--step", "1"))
VOX = float(arg("--vox", "0.09"))
MIST_VOX = 0.22
SMOKE_SCALE = float(arg("--rate", "1.0"))

rng = np.random.default_rng(42)
SUB, DT, NF = M.SUB, M.DT, M.NF

TAGS = ['E30', 'E30B', 'CAPRI', 'STRATOS']
ST = {t: M.simulate(t)[0] for t in TAGS}
TW = {t: M.DIMS[t]['tw'] for t in TAGS}

# ------------------------------------------------------------------ 粒子存储
CAP = 400000
pos = np.zeros((CAP, 3), np.float32)
vel = np.zeros((CAP, 3), np.float32)
birth = np.zeros(CAP, np.float32)
sig0 = np.zeros(CAP, np.float32)
grow = np.zeros(CAP, np.float32)
amp0 = np.zeros(CAP, np.float32)
life = np.zeros(CAP, np.float32)
kind = np.zeros(CAP, np.int8)        # 0 胎烟 1 水雾
owner = np.zeros(CAP, np.int8)
buoy = np.zeros(CAP, np.float32)
n_p = 0

WIND = np.array([0.9, -0.55, 0.0], np.float32)

# 湍流：若干无散的正弦模态
NM = 10
lam = rng.uniform(1.6, 8.0, NM)
kdir = rng.normal(size=(NM, 3)); kdir[:, 2] *= 0.6
kdir /= np.linalg.norm(kdir, axis=1, keepdims=True)
kvec = (kdir * (2 * np.pi / lam)[:, None]).astype(np.float32)
avec = np.cross(kdir, rng.normal(size=(NM, 3)))
avec /= np.linalg.norm(avec, axis=1, keepdims=True)
avec = (avec * (0.30 + 0.085 * lam)[:, None]).astype(np.float32)
omega = rng.uniform(0.4, 1.6, NM).astype(np.float32)
phase = rng.uniform(0, 6.28, NM).astype(np.float32)


def turb(p, t):
    ph = p @ kvec.T + omega[None, :] * t + phase[None, :]
    return np.sin(ph) @ avec


def emit(n, p0, v0, t, s0, g, a0, lf, kd, own, by, p_sig=0.08):
    global n_p
    if n <= 0:
        return
    n = min(n, CAP - n_p)
    sl = slice(n_p, n_p + n)
    pos[sl] = p0 + rng.normal(0, p_sig, (n, 3)).astype(np.float32) * np.array([1, 1, 0.5], np.float32)
    pos[sl, 2] = np.abs(pos[sl, 2]) + 0.03
    vel[sl] = v0
    birth[sl] = t
    sig0[sl] = s0
    grow[sl] = g
    amp0[sl] = a0
    life[sl] = lf
    kind[sl] = kd
    owner[sl] = own
    buoy[sl] = by
    n_p += n


def wheel_points(c, tw):
    cy, sy = math.cos(c['yaw']), math.sin(c['yaw'])
    nx, ny = -sy, cy
    return {
        'RL': (c['rx'] + nx * tw / 2, c['ry'] + ny * tw / 2),
        'RR': (c['rx'] - nx * tw / 2, c['ry'] - ny * tw / 2),
        'FL': (c['fx'] + nx * tw / 2, c['fy'] + ny * tw / 2),
        'FR': (c['fx'] - nx * tw / 2, c['fy'] - ny * tw / 2),
    }


# ------------------------------------------------------------------ 体素沉积
def gauss_kernel(sigma_vox):
    r = max(1, int(math.ceil(2.6 * sigma_vox)))
    ax = np.arange(-r, r + 1, dtype=np.float32)
    g = np.exp(-(ax ** 2) / (2 * sigma_vox ** 2))
    k = g[:, None, None] * g[None, :, None] * g[None, None, :]
    return k.astype(np.float32), r


_KCACHE = {}


def kernel_for(sigma_vox):
    q = round(math.log(max(sigma_vox, 0.35)) / math.log(1.10))
    if q not in _KCACHE:
        _KCACHE[q] = gauss_kernel(1.10 ** q)
    return _KCACHE[q]


def deposit(P, S, A, vox, zmax=9.0):
    """P (n,3) 位置, S (n) sigma(米), A (n) 幅值 -> (数组, 原点索引)。三层分辨率。"""
    if len(P) == 0:
        return None, None
    pad = 2.7 * S.max() + 4 * vox
    lo = np.floor((P.min(0) - pad) / (vox * 4)).astype(int) * 4
    hi = np.ceil((P.max(0) + pad) / (vox * 4)).astype(int) * 4
    lo[2] = 0
    hi[2] = min(hi[2], int(math.ceil(zmax / (vox * 4))) * 4)
    dims = hi - lo
    out = np.zeros(dims, np.float32)
    levels = [(1, S < 0.30), (2, (S >= 0.30) & (S < 0.72)), (4, S >= 0.72)]
    for fac, mask in levels:
        if not mask.any():
            continue
        v = vox * fac
        d = dims // fac
        g = np.zeros(d, np.float32)
        Pi = np.rint((P[mask] - lo * vox) / v - 0.5).astype(int)
        Sv = S[mask] / v
        Av = A[mask]
        for i in range(len(Pi)):
            k, r = kernel_for(float(Sv[i]))
            x, y, z = Pi[i]
            x0, x1 = x - r, x + r + 1
            y0, y1 = y - r, y + r + 1
            z0, z1 = z - r, z + r + 1
            kx0, ky0, kz0 = max(0, -x0), max(0, -y0), max(0, -z0)
            kx1 = k.shape[0] - max(0, x1 - d[0])
            ky1 = k.shape[1] - max(0, y1 - d[1])
            kz1 = k.shape[2] - max(0, z1 - d[2])
            if kx1 <= kx0 or ky1 <= ky0 or kz1 <= kz0:
                continue
            g[max(0, x0):min(d[0], x1), max(0, y0):min(d[1], y1), max(0, z0):min(d[2], z1)] += Av[i] * k[kx0:kx1, ky0:ky1, kz0:kz1]
        if fac > 1:
            for ax in range(3):
                g = np.repeat(g, fac, axis=ax)
            # 抹平重复采样造成的台阶
            w = fac
            for ax in range(3):
                cs = np.cumsum(g, axis=ax, dtype=np.float32)
                sh = np.roll(cs, w, axis=ax)
                idx = [slice(None)] * 3
                idx[ax] = slice(0, w)
                sh[tuple(idx)] = 0
                g = (cs - sh) / w
                g = np.roll(g, -(w // 2), axis=ax)
                # roll 会把开头的切片绕到末尾，必须清零（否则贴地浓烟会出现在域顶）
                tail = [slice(None)] * 3
                tail[ax] = slice(g.shape[ax] - (w // 2), None)
                g[tuple(tail)] = 0
        out += g
    return out, lo


def write_vdb(path, arr, lo, vox, name="density"):
    grid = vdb.FloatGrid()
    grid.name = name
    if arr is not None and arr.max() > 0:
        grid.copyFromArray(arr, ijk=(int(lo[0]), int(lo[1]), int(lo[2])), tolerance=2e-3)
    grid.transform = vdb.createLinearTransform(voxelSize=vox)
    grid.gridClass = vdb.GridClass.FOG_VOLUME
    try:
        grid.saveFloatAsHalf = True
    except Exception:
        pass
    vdb.write(path, grids=[grid])


# ------------------------------------------------------------------ 主循环
t_start = time.time()
total = NF * SUB + 1
acc = {}
for step in range(0, total):
    cE = ST['E30'][step]
    t = cE['t']
    # ---- 发射
    for ti, tag in enumerate(TAGS):
        c = ST[tag][step]
        wp = wheel_points(c, TW[tag])
        cy, sy = math.cos(c['yaw']), math.sin(c['yaw'])
        vrx, vry = c['v_rear']
        slide = c['slide']
        # 胎烟：后轮
        inten = min(1.35, max(0.0, (slide - 3.0) / 14.0))
        if inten > 0:
            rate = 2300.0 * inten * SMOKE_SCALE
            for w in ('RL', 'RR'):
                key = (tag, w)
                acc[key] = acc.get(key, 0.0) + rate * DT
                n = int(acc[key]); acc[key] -= n
                if n <= 0:
                    continue
                p0 = np.array([wp[w][0], wp[w][1], 0.08], np.float32)
                drag = rng.uniform(0.12, 0.42, (n, 1)).astype(np.float32)
                fling = rng.uniform(1.0, 5.5, (n, 1)).astype(np.float32) * min(1.0, c['kap'] + 0.3)
                v0 = np.concatenate([vrx * drag - cy * fling, vry * drag - sy * fling,
                                     rng.uniform(0.1, 1.5, (n, 1)).astype(np.float32)], axis=1)
                v0 += rng.normal(0, 0.7, (n, 3)).astype(np.float32) * np.array([1, 1, 0.6], np.float32)
                emit(n, p0, v0, t,
                     rng.uniform(0.07, 0.12, n), 0.40 * rng.uniform(0.7, 1.4, n),
                     inten * rng.uniform(0.35, 1.65, n) ** 1.3, rng.uniform(5.0, 9.0, n), 0, ti,
                     rng.uniform(0.25, 0.75, n))
        # 水雾：四个轮子，随速度
        v = c['v']
        if False and v > 8:
            mrate = 170.0 * (v / 30.0) * (0.75 + 0.5 * math.sin(c['s'] * 0.21 + ti) * math.sin(c['s'] * 0.047 + 1.3))
            for w in ('RL', 'RR', 'FL', 'FR'):
                key = (tag, w, 'm')
                acc[key] = acc.get(key, 0.0) + max(0.0, mrate) * DT
                n = int(acc[key]); acc[key] -= n
                if n <= 0:
                    continue
                p0 = np.array([wp[w][0] - cy * 0.3, wp[w][1] - sy * 0.3, 0.10], np.float32)
                vx, vy = c['v'] * math.cos(c['psi']), c['v'] * math.sin(c['psi'])
                drag = rng.uniform(0.35, 0.75, (n, 1)).astype(np.float32)
                v0 = np.concatenate([vx * drag, vy * drag, rng.uniform(0.5, 2.6, (n, 1)).astype(np.float32)], axis=1)
                v0 += rng.normal(0, 0.8, (n, 3)).astype(np.float32)
                emit(n, p0, v0, t, rng.uniform(0.11, 0.17, n), 0.85 * rng.uniform(0.8, 1.3, n),
                     0.10 * rng.uniform(0.5, 1.5, n), rng.uniform(1.0, 2.2, n), 1, ti, np.zeros(n), p_sig=0.12)
    # ---- 推进
    if n_p:
        sl = slice(0, n_p)
        age = t - birth[sl]
        bg = WIND[None, :] + turb(pos[sl], t).astype(np.float32)
        bg[:, 2] += buoy[sl] * np.exp(-age / 2.6)
        tau = np.where(kind[sl] == 0, 0.30, 0.45).astype(np.float32)[:, None]
        vel[sl] += (bg - vel[sl]) * (DT / tau)
        # 其它车驶过时的尾流卷吸
        for ti, tag in enumerate(TAGS):
            c = ST[tag][step]
            ctr = np.array([c['x'], c['y'], 0.7], np.float32)
            rel = pos[sl] - ctr[None, :]
            d2 = (rel ** 2).sum(1)
            near = d2 < 16.0
            if not near.any():
                continue
            w = np.exp(-d2[near] / (1.7 ** 2))
            w *= np.where(owner[sl][near] == ti, np.clip((age[near] - 0.25) * 2.0, 0.0, 0.6), 1.0)
            vc = np.array([c['v'] * math.cos(c['psi']) * 0.55, c['v'] * math.sin(c['psi']) * 0.55, 0.25], np.float32)
            idx = np.nonzero(near)[0]
            vel[idx] += (vc[None, :] - vel[idx]) * np.minimum(1.0, w * DT / 0.06)[:, None]
            # 向两侧排开
            push = rel[near] / np.sqrt(d2[near] + 1e-4)[:, None]
            push[:, 2] *= 0.15
            vel[idx] += push * (w * 7.0 * DT)[:, None]
        pos[sl] += vel[sl] * DT
        low = pos[sl, 2] < 0.04
        pos[sl, 2] = np.where(low, 0.04, pos[sl, 2])
        vel[sl, 2] = np.where(low, np.abs(vel[sl, 2]) * 0.2, vel[sl, 2])
    # ---- 写帧
    if step % SUB == 0:
        f = step // SUB
        if f >= F0 and f <= F1 and (f - F0) % WRITE_STEP == 0:
            sl = slice(0, n_p)
            age = t - birth[sl]
            sig = sig0[sl] + grow[sl] * np.power(np.maximum(age, 0.0), 0.65)
            fade = np.clip((life[sl] - age) / (0.3 * life[sl]), 0.0, 1.0)
            fade = fade * fade * (3 - 2 * fade)
            amp = amp0[sl] * np.power(sig0[sl] / sig, 2.3) * fade
            # 刚喷出的头几帧渐入，避免点状
            amp *= np.clip(age / 0.02, 0.0, 1.0)
            for kd, vox, nm in ((0, VOX, "smoke"),):
                m = (kind[sl] == kd) & (amp > 2e-4) & (pos[sl, 2] < 9.0)
                path = os.path.join(OUT, f"{nm}_{f:04d}.vdb")
                if m.any():
                    arr, lo = deposit(pos[sl][m], sig[m], amp[m], vox)
                else:
                    arr, lo = None, None
                write_vdb(path, arr, lo, vox)
                if nm == "smoke":
                    info = "empty" if arr is None else f"dims={arr.shape} max={arr.max():.2f} n={int(m.sum())}"
            print(f"frame {f}: particles={n_p} smoke {info}  elapsed {time.time() - t_start:.0f}s", flush=True)
print("SMOKE_DONE", flush=True)
