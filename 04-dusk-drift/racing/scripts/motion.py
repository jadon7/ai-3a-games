# 车辆运动学（纯 Python）：走线、速度、侧滑角 -> 每帧/每子步的位姿、车轮角度、轮胎滑移
import math, json
import track_def as T

FPS = 24
NF = 180
SUB = 8                      # 每帧子步数
DT = 1.0 / (FPS * SUB)
MC0 = [r for r in T.seg_ranges() if r[0][0] == 'A' and abs(r[0][1] - T.MAIN_R) < 1e-6][0][1]
MC1 = [r for r in T.seg_ranges() if r[0][0] == 'A' and abs(r[0][1] - T.MAIN_R) < 1e-6][0][2]


def hermite(keys, x):
    """非均匀 Catmull-Rom（Hermite）插值，两端外推为常数。keys: [(x, y)] 递增。"""
    n = len(keys)
    if x <= keys[0][0]:
        return keys[0][1]
    if x >= keys[-1][0]:
        return keys[-1][1]
    i = 0
    while i < n - 2 and keys[i + 1][0] <= x:
        i += 1
    x0, y0 = keys[i]
    x1, y1 = keys[i + 1]

    def slope(j):
        if j <= 0 or j >= n - 1:
            return 0.0
        return (keys[j + 1][1] - keys[j - 1][1]) / (keys[j + 1][0] - keys[j - 1][0])
    m0, m1 = slope(i), slope(i + 1)
    h = x1 - x0
    t = (x - x0) / h
    t2, t3 = t * t, t * t * t
    return (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * m0 + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * m1


def wrap(a):
    while a > math.pi:
        a -= 2 * math.pi
    while a < -math.pi:
        a += 2 * math.pi
    return a


def jitter(t, seed, amps=(1.0, 0.6, 0.35), freqs=(3.1, 6.7, 11.3)):
    v = 0.0
    for i, (a, f) in enumerate(zip(amps, freqs)):
        v += a * math.sin(2 * math.pi * f * t + seed * 1.7 + i * 2.1)
    return v / sum(amps)


def make_line(d0, s_a, d_in, s_p, d_apex, s_e, d_out, s_f, d_end, step=3.0):
    """余弦缓动的赛车线：直道 d0 -> s_a 处外侧 d_in -> s_p 处弯心 d_apex -> s_e 处出弯外侧 d_out -> s_f 处回到 d_end。"""
    def ease(a, b, u):
        return a + (b - a) * (0.5 - 0.5 * math.cos(math.pi * max(0.0, min(1.0, u))))
    keys = []
    s = 40.0
    while s <= 600.0:
        if s < s_a - 70:
            d = d0
        elif s < s_a:
            d = ease(d0, d_in, (s - (s_a - 70)) / 70.0)
        elif s < s_p:
            d = ease(d_in, d_apex, (s - s_a) / (s_p - s_a))
        elif s < s_e:
            d = ease(d_apex, d_out, (s - s_p) / (s_e - s_p))
        elif s < s_f:
            d = ease(d_out, d_end, (s - s_e) / (s_f - s_e))
        else:
            d = d_end
        keys.append((s, d))
        s += step
    return keys


# ----------------------------------------------------------------------------- 各车计划
T_IN = 1.60     # 主角开始入弯的时刻（秒）
S_IN = MC0 - 7  # 入弯点弧长

HERO_SPEED = [(-2.0, 34.0), (0.0, 33.0), (0.5, 31.0), (T_IN, 24.0), (T_IN + 1.1, 21.3), (T_IN + 2.4, 21.6),
              (T_IN + 3.4, 23.5), (T_IN + 4.4, 26.5), (T_IN + 5.9, 31.5), (T_IN + 8.0, 36.0)]

PLANS = {
    'E30': dict(
        delay=0.0,
        line=make_line(3.0, 200, 3.7, MC0 + 46, -3.4, MC1 + 34, 4.1, MC1 + 150, 0.8),
        speed=HERO_SPEED,
        # 航向相对速度方向的偏角（度），负 = 车头向右（右弯时车尾甩向外侧）
        slip=[(-2, 0), (T_IN - 0.55, 0), (T_IN - 0.22, 2.6), (T_IN + 0.12, -5), (T_IN + 0.5, -20), (T_IN + 0.95, -33),
              (T_IN + 1.5, -37.5), (T_IN + 2.2, -35), (T_IN + 2.9, -31), (T_IN + 3.5, -24), (T_IN + 4.0, -12),
              (T_IN + 4.35, 4.5), (T_IN + 4.72, -2.2), (T_IN + 5.05, 0.6), (T_IN + 5.4, 0)],
        spin=[(-2, 0), (T_IN + 0.1, 0), (T_IN + 0.5, 0.55), (T_IN + 1.0, 0.95), (T_IN + 2.6, 0.9), (T_IN + 3.4, 0.6),
              (T_IN + 4.0, 0.2), (T_IN + 4.4, 0.0)],
        roll_gain=0.34, pitch_gain=0.24, seed=1.0,
    ),
    # 领先的另一台 E30：正常走线，轻微滑动
    'E30B': dict(
        delay=-2.05,
        line=make_line(2.6, 202, 3.5, MC0 + 43, -3.8, MC1 + 30, 3.6, MC1 + 150, 0.2),
        speed=[(t, v * (1.02 if t > T_IN else 1.0) + (1.2 if T_IN < t < T_IN + 3.5 else 0.0)) for (t, v) in HERO_SPEED],
        slip=[(-2, 0), (T_IN, 0), (T_IN + 0.8, -4.5), (T_IN + 2.4, -6), (T_IN + 3.4, -8), (T_IN + 3.9, -1), (T_IN + 4.3, 0)],
        spin=[(-2, 0), (T_IN + 2.0, 0.0), (T_IN + 3.0, 0.12), (T_IN + 3.8, 0.0)],
        roll_gain=0.34, pitch_gain=0.24, seed=2.3,
    ),
    # Capri 紧跟主角
    'CAPRI': dict(
        delay=1.12,
        line=make_line(1.2, 203, 3.1, MC0 + 42, -3.9, MC1 + 30, 3.3, MC1 + 150, -0.6),
        speed=[(t, v + (0.9 if T_IN < t < T_IN + 3.6 else 0.0)) for (t, v) in HERO_SPEED],
        slip=[(-2, 0), (T_IN, 0), (T_IN + 0.7, -3.5), (T_IN + 2.0, -5), (T_IN + 3.1, -9.5), (T_IN + 3.6, 2.0), (T_IN + 3.95, -0.8), (T_IN + 4.3, 0)],
        spin=[(-2, 0), (T_IN + 2.2, 0.0), (T_IN + 3.0, 0.22), (T_IN + 3.7, 0.0)],
        roll_gain=0.20, pitch_gain=0.16, seed=3.9,
    ),
    # Stratos 排第四，尾巴更活泼
    'STRATOS': dict(
        delay=2.25,
        line=make_line(-1.0, 204, 2.8, MC0 + 44, -3.7, MC1 + 32, 3.9, MC1 + 150, 0.4),
        speed=[(t, v + (0.4 if T_IN < t < T_IN + 3.6 else 0.0)) for (t, v) in HERO_SPEED],
        slip=[(-2, 0), (T_IN - 0.1, 0), (T_IN + 0.5, -8), (T_IN + 1.3, -14), (T_IN + 2.4, -12), (T_IN + 3.2, -9), (T_IN + 3.8, 3), (T_IN + 4.2, -1), (T_IN + 4.6, 0)],
        spin=[(-2, 0), (T_IN + 0.3, 0.0), (T_IN + 1.0, 0.3), (T_IN + 2.6, 0.25), (T_IN + 3.5, 0.0)],
        roll_gain=0.30, pitch_gain=0.22, seed=5.2,
    ),
}

DIMS = {  # 轴距、轮距、前后轮半径（由绑定时测得，可被覆盖）
    'E30': dict(wb=2.575, tw=1.42, rf=0.325, rr=0.319),
    'E30B': dict(wb=2.575, tw=1.42, rf=0.325, rr=0.319),
    'CAPRI': dict(wb=2.514, tw=1.52, rf=0.295, rr=0.347),
    'STRATOS': dict(wb=2.116, tw=1.43, rf=0.298, rr=0.298),
}


def path_point(plan, s):
    d = hermite(plan['line'], s)
    x, y, hd = T.offset_point(s, d)
    return x, y


def simulate(tag, plan=None, dims=None):
    plan = plan or PLANS[tag]
    dims = dims or DIMS[tag]
    delay = plan['delay']
    wb = dims['wb']

    def local_t(t):
        return t - delay

    # 先求 s0：让该车在自己的时间轴 tau = T_IN 时到达 S_IN
    def run(s0, record=False):
        s = s0
        out = []
        nsteps = NF * SUB + 2 * SUB
        t = -1.0 / FPS      # 多算前后各一帧，便于差分
        for i in range(nsteps + SUB):
            tau = local_t(t)
            v = hermite(plan['speed'], tau)
            x, y = path_point(plan, s)
            if record:
                out.append((t, s, x, y, v))
            # 路径弧长微分
            x2, y2 = path_point(plan, s + 0.05)
            dl = math.hypot(x2 - x, y2 - y) / 0.05
            s += v * DT / dl
            t += DT
        return out if record else s

    # 二分求 s0
    def s_at_tin(s0):
        s = s0
        t = -1.0 / FPS
        t_target = T_IN + delay
        while t < t_target:
            tau = local_t(t)
            v = hermite(plan['speed'], tau)
            x, y = path_point(plan, s)
            x2, y2 = path_point(plan, s + 0.05)
            dl = math.hypot(x2 - x, y2 - y) / 0.05
            s += v * DT / dl
            t += DT
        return s
    t_begin = -1.0 / FPS
    if T_IN + delay <= t_begin:
        # 该车在片段开始前就已经过了入弯点：从入弯点正向积分到片段起点
        s = S_IN
        t = T_IN + delay
        while t < t_begin:
            v = hermite(plan['speed'], local_t(t))
            x, y = path_point(plan, s)
            x2, y2 = path_point(plan, s + 0.05)
            dl = math.hypot(x2 - x, y2 - y) / 0.05
            s += v * DT / dl
            t += DT
        s0 = s
    else:
        lo, hi = -200.0, 400.0
        for _ in range(40):
            mid = (lo + hi) / 2
            if s_at_tin(mid) < S_IN:
                lo = mid
            else:
                hi = mid
        s0 = (lo + hi) / 2
    raw = run(s0, record=True)

    n = len(raw)
    st = []
    yaw_prev = None
    roll_f = pitch_f = 0.0
    steer_f = 0.0
    ang = {'FL': 0.0, 'FR': 0.0, 'RL': 0.0, 'RR': 0.0}
    psi_prev = None
    for i in range(n):
        t, s, x, y, v = raw[i]
        a, b = raw[max(0, i - 1)], raw[min(n - 1, i + 1)]
        dtt = (b[0] - a[0])
        vx, vy = (b[2] - a[2]) / dtt, (b[3] - a[3]) / dtt
        psi = math.atan2(vy, vx)
        if psi_prev is not None:
            psi = psi_prev + wrap(psi - psi_prev)
        tau = local_t(t)
        slip = math.radians(hermite(plan['slip'], tau))
        kap = max(0.0, hermite(plan['spin'], tau))
        yaw = psi + slip
        st.append(dict(t=t, s=s, x=x, y=y, v=v, psi=psi, yaw=yaw, slip=slip, kap=kap))
        psi_prev = psi

    # 二阶量：加速度、车轮
    for i in range(n):
        c = st[i]
        a, b = st[max(0, i - 1)], st[min(n - 1, i + 1)]
        dtt = b['t'] - a['t']
        dpsi = (b['psi'] - a['psi']) / dtt
        dv = (b['v'] - a['v']) / dtt
        c['a_lat'] = c['v'] * dpsi            # 正 = 左转
        c['a_long'] = dv
        c['yaw_rate'] = (b['yaw'] - a['yaw']) / dtt

    for i in range(n):
        c = st[i]
        cy, sy = math.cos(c['yaw']), math.sin(c['yaw'])
        # 前/后轴中心
        c['fx'], c['fy'] = c['x'] + cy * wb / 2, c['y'] + sy * wb / 2
        c['rx'], c['ry'] = c['x'] - cy * wb / 2, c['y'] - sy * wb / 2
    lag_r = 1 - math.exp(-DT / 0.14)
    lag_s = 1 - math.exp(-DT / 0.07)
    for i in range(n):
        c = st[i]
        a, b = st[max(0, i - 1)], st[min(n - 1, i + 1)]
        dtt = b['t'] - a['t']
        vfx, vfy = (b['fx'] - a['fx']) / dtt, (b['fy'] - a['fy']) / dtt
        vrx, vry = (b['rx'] - a['rx']) / dtt, (b['ry'] - a['ry']) / dtt
        cy, sy = math.cos(c['yaw']), math.sin(c['yaw'])
        psi_f = math.atan2(vfy, vfx)
        steer = wrap(psi_f - c['yaw'])
        # 前轮自身的小侧偏角（朝转弯方向）
        steer += math.copysign(min(math.radians(4.0), abs(c['a_lat']) * math.radians(0.55)), c['a_lat'])
        steer = max(-math.radians(40), min(math.radians(40), steer))
        steer_f += (steer - steer_f) * lag_s
        c['steer'] = steer_f
        # 车轮线速度
        hx, hy = math.cos(c['yaw'] + steer_f), math.sin(c['yaw'] + steer_f)
        v_front = vfx * hx + vfy * hy
        v_rear_long = vrx * cy + vry * sy
        v_rear_lat = -vrx * sy + vry * cy
        w_f = v_front / dims['rf']
        w_r = v_rear_long * (1.0 + c['kap']) / dims['rr']
        ang['FL'] += w_f * DT
        ang['FR'] += w_f * DT
        ang['RL'] += w_r * DT
        ang['RR'] += w_r * DT
        c['wheel'] = dict(ang)
        # 后轮相对地面的滑动速度（用于胎烟）
        c['slide'] = math.hypot(v_rear_lat, v_rear_long * c['kap'])
        c['v_rear'] = (vrx, vry)
        # 车身姿态（带滞后）+ 路面细碎抖动
        roll_t = math.radians(plan['roll_gain']) * c['a_lat'] * math.cos(c['slip'])
        pitch_t = -math.radians(plan['pitch_gain']) * c['a_long']
        roll_f += (roll_t - roll_f) * lag_r
        pitch_f += (pitch_t - pitch_f) * lag_r
        amp = min(1.0, c['v'] / 30.0)
        sd = plan['seed']
        c['roll'] = roll_f + math.radians(0.22) * amp * jitter(c['t'], sd)
        c['pitch'] = pitch_f + math.radians(0.16) * amp * jitter(c['t'], sd + 4.0)
        c['heave'] = 0.004 * amp * jitter(c['t'], sd + 9.0)
    return st, s0


def frame_index(f, k=0):
    """帧 f（1 起）第 k 个子步在 simulate 结果中的下标。"""
    return (f) * SUB + k        # 结果从 t = -1/FPS 开始，帧1 -> 下标 SUB


if __name__ == "__main__":
    allst = {}
    for tag in PLANS:
        st, s0 = simulate(tag)
        allst[tag] = st
        f_in = st[frame_index(1)]
        f_out = st[frame_index(NF)]
        mx = max(st, key=lambda c: abs(c['a_lat']))
        print(f"{tag}: s0={s0:.1f}  f1 s={f_in['s']:.1f} v={f_in['v']:.1f}  f{NF} s={f_out['s']:.1f} v={f_out['v']:.1f}  "
              f"max|a_lat|={abs(mx['a_lat']):.1f} at t={mx['t']:.2f}  max steer={math.degrees(max(abs(c['steer']) for c in st)):.1f}  "
              f"max slide={max(c['slide'] for c in st):.1f}")
    # 车间最小距离
    tags = list(allst)
    for i in range(len(tags)):
        for j in range(i + 1, len(tags)):
            a, b = allst[tags[i]], allst[tags[j]]
            dmin = min((math.hypot(p['x'] - q['x'], p['y'] - q['y']), p['t']) for p, q in zip(a, b))
            print(f"  min dist {tags[i]}-{tags[j]}: {dmin[0]:.1f} m at t={dmin[1]:.2f}")
    h = allst['E30']
    for f in (1, 20, 39, 41, 60, 80, 100, 118, 119, 140, 160, 180):
        c = h[frame_index(f)]
        print(f"  hero f{f:3d} t={c['t']:.2f} s={c['s']:.1f} pos=({c['x']:.1f},{c['y']:.1f}) v={c['v']:.1f} slip={math.degrees(c['slip']):.1f} steer={math.degrees(c['steer']):.1f} "
              f"alat={c['a_lat']:.1f} roll={math.degrees(c['roll']):.2f} slide={c['slide']:.1f}")
    print("MC0", MC0, "MC1", MC1)
