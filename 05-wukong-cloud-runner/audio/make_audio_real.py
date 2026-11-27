"""写实版（v2）成片的电影感音轨。全部用 numpy/scipy 合成，不使用任何现成素材或音乐。

用法：python make_audio_real.py [输出.wav] [--stats] [--with-f]
五镜头版（默认，19.0 s → mix_real.wav）：
  A 0–3.5｜B 3.5–6｜E 6–9（正面特写"亮相"）｜C 9–13｜D 13–17.5｜黑场 17.5–19
六镜头版（--with-f，22.0 s → mix_real_f.wav）：B 与 E 之间插入 3 s 的镜头 F（右侧平行跟拍，全片最有速度感），之后的事件整体后移 3 s：
  A 0–3.5｜B 3.5–6｜F 6–9｜E 9–12｜C 12–16｜D 16–20.5｜黑场 20.5–22
输出：48 kHz / 立体声 / 16-bit
"""
import sys, os
import numpy as np
from scipy import signal
from scipy.io import wavfile
from scipy.interpolate import CubicSpline
from scipy.ndimage import minimum_filter1d, uniform_filter1d

WITH_F = '--with-f' in sys.argv          # 六镜头版
SH = 3.0 if WITH_F else 0.0              # 镜头 F 之后所有事件的后移量（秒）
SR = 48000
DUR = 19.0 + SH
N = int(round(SR * DUR))
T = np.arange(N) / SR
CUT_A, CUT_F = 3.5, 6.0                                             # A→B、B→F（仅六镜头版）
CUT_E, CUT_B, CUT_C, CUT_D = 6.0 + SH, 9.0 + SH, 13.0 + SH, 17.5 + SH   # →E、E→C、C→D、D→黑场
HERE = os.path.dirname(os.path.abspath(__file__))
WHOOSH_C_PK = 9.35 + SH     # 镜头 C 里悟空掠过镜头的最近点（秒）
TARGET_LUFS = -14.25
CEIL_DB = -2.0
TWO_PI = 2 * np.pi


# ------------------------------------------------------------------ 基础工具
def R(seed):
    return np.random.default_rng(seed)


def butter(kind, f, order=2):
    return signal.butter(order, f, btype=kind, fs=SR, output='sos')


def lp(x, f, order=2):
    return signal.sosfilt(butter('low', f, order), x, axis=-1)


def hp(x, f, order=2):
    return signal.sosfilt(butter('high', f, order), x, axis=-1)


def bp(x, lo, hi, order=2):
    return signal.sosfilt(butter('band', [lo, min(hi, SR * 0.49)], order), x, axis=-1)


def unit(x):
    return x / (np.std(x) + 1e-12)


def smooth(x, sec):
    w = max(1, int(sec * SR))
    for _ in range(3):
        x = uniform_filter1d(x, w, mode='nearest')
    return x


def curve(points, t=None):
    tt = T if t is None else t
    return np.interp(tt, [p[0] for p in points], [p[1] for p in points])


def shot_curve(a, b, c, d, e=None, f=None, fade_in=1.6, tail_end=None, xf=0.03):
    """按镜头分段的增益：A/B/C/D 四个值（E、F 不给就沿用 B），切点处 60 ms 过渡，黑场里淡到 0。"""
    e = b if e is None else e
    f = b if f is None else f
    tail_end = 18.3 + SH if tail_end is None else tail_end
    pts = [(0, 0), (fade_in, a), (CUT_A - xf, a), (CUT_A + xf, b)]
    if WITH_F:
        pts += [(CUT_F - xf, b), (CUT_F + xf, f), (CUT_E - xf, f)]
    else:
        pts += [(CUT_E - xf, b)]
    pts += [(CUT_E + xf, e), (CUT_B - xf, e), (CUT_B + xf, c), (CUT_C - xf, c), (CUT_C + xf, d), (CUT_D, d * 0.85), (tail_end, 0), (DUR, 0)]
    return curve(pts)


def seg_gate(t0, t1, xf=0.03):
    return curve([(0, 0), (t0 - xf, 0), (t0 + xf, 1), (t1 - xf, 1), (t1 + xf, 0), (DUR, 0)])


def pass_events():
    """F 镜头里"掠过石峰"的时刻：间隔 0.5–0.8 s 的不规则序列。返回 [(时刻, 强度, 方向)]。"""
    if not WITH_F:
        return []
    rng = R(71)
    ev, tc, k = [], CUT_F + 0.45, 0
    while tc < CUT_E - 0.22:
        ev.append((tc, rng.uniform(0.7, 1.0), 1 if k % 2 == 0 else -1))
        tc += rng.uniform(0.5, 0.8)
        k += 1
    return ev


def smooth_rand(n, rate, rng, lo=0.0, hi=1.0):
    """平滑随机曲线（每秒约 rate 个起伏）。"""
    k = int(n / SR * rate) + 5
    cs = CubicSpline(np.arange(k), rng.random(k))
    x = cs(np.arange(n) / SR * rate + 1.0)
    x = (x - x.min()) / max(1e-9, x.max() - x.min())
    return lo + (hi - lo) * x


def st_noise(n, rng, corr=0.25):
    a, b, c = rng.standard_normal((3, n))
    return np.stack([np.sqrt(1 - corr) * a + np.sqrt(corr) * c, np.sqrt(1 - corr) * b + np.sqrt(corr) * c])


def pan(mono, p):
    a = (np.clip(p, -1, 1) + 1) * np.pi / 4
    return np.stack([mono * np.cos(a), mono * np.sin(a)])


def add(buf, seg, t0, gain=1.0):
    seg = np.atleast_2d(seg)
    if seg.shape[0] == 1:
        seg = np.repeat(seg, 2, axis=0)
    i0 = int(round(t0 * SR))
    a, b = max(0, i0), min(N, i0 + seg.shape[1])
    if b > a:
        buf[:, a:b] += gain * seg[:, a - i0:b - i0]


def swept_noise(src, fc, bw_oct, fmin=60.0, fmax=14000.0, nb=30):
    """可变中心频率的带通噪声（滤波器组加权叠加）。fc、bw_oct 可以是逐采样数组。"""
    cs = np.geomspace(fmin, fmax, nb)
    sp = np.log2(fmax / fmin) / (nb - 1)
    lf = np.log2(np.clip(fc, fmin, fmax))
    sig = np.maximum(np.asarray(bw_oct, dtype=float) / 2.355, sp * 0.6)
    out = np.zeros(len(src))
    for c in cs:
        band = bp(src, c * 2 ** (-sp / 2), c * 2 ** (sp / 2))
        out += band * np.exp(-0.5 * ((np.log2(c) - lf) / sig) ** 2)
    return out


def make_ir(rt60, seed, predelay=0.015, split=900.0, hi_ratio=0.55, lo_ratio=1.15):
    """指数衰减噪声脉冲响应（高频衰减更快），左右声道独立。"""
    rng = R(seed)
    n = int(SR * rt60 * 1.4)
    tt = np.arange(n) / SR
    nz = rng.standard_normal((2, n))
    lo = lp(nz, split) * np.exp(-6.91 * tt / (rt60 * lo_ratio))
    hi = hp(nz, split) * np.exp(-6.91 * tt / (rt60 * hi_ratio))
    ir = (lo * 1.5 + hi) * (1 - np.exp(-tt / 0.006))
    for k in range(8):                                   # 几个早期反射
        d = int(SR * rng.uniform(0.004, 0.075))
        ir[rng.integers(0, 2), d] += rng.choice([-1, 1]) * rng.uniform(3, 7) * (1 - k / 10)
    ir /= np.sqrt((ir ** 2).sum(axis=1).mean())
    return np.concatenate([np.zeros((2, int(predelay * SR))), ir], axis=1)


def reverb(x, ir):
    x = np.atleast_2d(x)
    if x.shape[0] == 1:
        x = np.repeat(x, 2, axis=0)
    return np.stack([signal.fftconvolve(x[c], ir[c])[:x.shape[1]] for c in range(2)])


IR_ROOM = make_ir(1.3, 5, predelay=0.010)
IR_HALL = make_ir(3.4, 6, predelay=0.030)
IR_VALLEY = make_ir(4.2, 7, predelay=0.060, hi_ratio=0.40)


# ------------------------------------------------------------------ 风
def make_wind():
    rng = R(11)
    common = smooth_rand(N, 0.45, rng)
    out = np.zeros((2, N))
    spec = [  # lo, hi, (A, B, C, D) 增益, E 增益, 阵风速率, 阵风深度
        (35, 130, (0.15, 0.42, 0.16, 0.12), 0.36, 0.5, 0.60),
        (140, 480, (0.48, 0.95, 0.42, 0.30), 0.90, 0.7, 0.60),
        (480, 1500, (0.60, 0.78, 0.44, 0.32), 0.85, 0.9, 0.70),
        (1700, 5200, (0.52, 0.52, 0.42, 0.27), 0.60, 1.1, 0.70),
        (5200, 12000, (0.22, 0.26, 0.25, 0.11), 0.32, 1.4, 0.70)]
    for lo, hi, g, ge, rate, depth in spec:
        nz = bp(st_noise(N, rng, 0.2), lo, hi)
        nz /= nz.std()
        for c in range(2):
            gust = 0.5 * common + 0.5 * smooth_rand(N, rate, rng)
            nz[c] *= (1 - depth) + depth * 1.6 * gust ** 1.6
        out += nz * shot_curve(*g, e=ge, f=g[1] * 1.08)
    # 呼啸：中心频率缓慢游走的窄带噪声
    for c in range(2):
        fc = 520 + 420 * smooth_rand(N, 0.9, rng)
        h = unit(swept_noise(rng.standard_normal(N), fc, 0.30, fmin=250, fmax=2000, nb=16))
        out[c] += h * shot_curve(0.05, 0.42, 0.12, 0.05, e=0.36, f=0.50) * (0.3 + 1.05 * smooth_rand(N, 0.7, rng) ** 2)
    # 近景里风直接拍在"话筒"上的低频抖动
    bf = unit(lp(st_noise(N, rng, 0.5), 70))
    bf *= 2.5 * smooth_rand(N, 4.0, rng) ** 3
    out += bf * shot_curve(0.0, 0.45, 0.06, 0.0, e=0.35, f=0.55)
    # C：悟空掠过之后，尾流扫过松针
    out *= 1 + 1.4 * np.exp(-0.5 * ((T - (WHOOSH_C_PK + 0.24)) / 0.3) ** 2)
    for tc, a, _ in pass_events():                          # F：经过石峰时风压一鼓一鼓
        out *= 1 + 0.32 * a * np.exp(-0.5 * ((T - tc) / 0.09) ** 2)
    return out


# ------------------------------------------------------------------ 低音长音
def tone_stack(f0, harm_amps, rng, detune=0.004, voices=3, noise_amt=0.5):
    out = np.zeros((2, N))
    for h, a in enumerate(harm_amps, 1):
        for _ in range(voices):
            f = f0 * h * (1 + rng.uniform(-detune, detune))
            drift = 1 + 0.0015 * (smooth_rand(N, 0.3, rng) - 0.5)
            am = smooth_rand(N, rng.uniform(0.12, 0.4), rng, 0.45, 1.0)
            s = np.sin(TWO_PI * np.cumsum(f * drift) / SR + rng.uniform(0, TWO_PI)) * am * a / voices
            out += pan(s, rng.uniform(-0.6, 0.6))
        fh = f0 * h                                       # 谐波附近的窄带噪声：像弓弦摩擦，不是裸正弦
        nb = bp(st_noise(N, rng, 0.1), fh * 0.985, fh * 1.015)
        out += nb / (nb.std() + 1e-12) * a * noise_amt * 0.7
    return out


def make_drone():
    rng = R(21)
    d2 = tone_stack(73.416, [0.85, 0.75, 0.58, 0.40, 0.24, 0.13], rng)           # D2
    d1 = tone_stack(36.708, [0.9, 0.40, 0.15], rng, noise_amt=0.3)              # D1：B 镜头起加厚
    a2 = tone_stack(110.0, [1.0, 0.50, 0.25, 0.12], rng)                        # A2：D 镜头上行五度
    a1 = tone_stack(55.0, [0.8, 0.35], rng, noise_amt=0.3)
    d3 = tone_stack(146.83, [0.6, 0.30, 0.15, 0.08], rng)                       # D3：E 镜头"亮相"时加上去
    g_d2 = shot_curve(0.52, 0.62, 0.50, 0.47, e=1.05, f=0.72, fade_in=2.8)
    g_d1 = shot_curve(0.0, 0.30, 0.19, 0.22, e=0.38, f=0.34)
    pre_e = [(CUT_F, 0), (CUT_F + 0.3, 0.12), (CUT_E - 0.03, 0.55)] if WITH_F else [(CUT_E - 0.03, 0)]      # F：高八度缓慢涌上来
    g_d3 = curve([(0, 0)] + pre_e + [(CUT_E + 0.12, 0.80), (CUT_E + 1.6, 0.95), (CUT_B - 0.03, 0.85), (CUT_B + 0.03, 0), (DUR, 0)])
    g_a = curve([(0, 0), (CUT_C - 0.05, 0), (CUT_C + 0.08, 0.25), (14.4 + SH, 0.58), (17.2 + SH, 0.66), (17.6 + SH, 0.42), (18.3 + SH, 0), (DUR, 0)])
    x = d2 * g_d2 + d1 * g_d1 + d3 * g_d3 + (a2 + 0.7 * a1) * g_a
    if WITH_F:                                              # F：张力缓慢上扬——整体渐强，再叠一条缓缓上行的窄带气柱
        x *= curve([(0, 1), (CUT_F, 1), (CUT_E - 0.03, 1.22), (CUT_E + 0.03, 1), (DUR, 1)])
        i0, i1 = int(CUT_F * SR), int(CUT_E * SR)
        u = np.arange(i1 - i0) / (i1 - i0)
        rise = np.stack([unit(swept_noise(rng.standard_normal(i1 - i0), 140 * (330 / 140) ** u, 0.5, fmin=90, fmax=700, nb=14)) for _ in range(2)])
        x[:, i0:i1] += 0.4 * rise * (0.12 + 0.88 * u ** 1.6) * np.clip(u / 0.02, 0, 1) * np.clip((1 - u) / 0.004, 0, 1)
    x = np.tanh(1.3 * x) / 1.3
    harm = bp(np.tanh(3.0 * x + 0.2) - np.tanh(0.2), 100, 420)          # 谐波层：别只靠 60 Hz 以下撑
    return lp(x, 950) + 0.55 * harm


def make_pad():
    """D 镜头的低弦铺底（多把失谐、带各自揉弦的加法合成，低通后送大厅混响）。"""
    rng = R(61)
    i0 = int((12.6 + SH) * SR)
    n = N - i0
    tt = T[i0:]
    out = np.zeros((2, n))
    for f0, ton, amp in ((146.83, 13.0 + SH, 1.0), (220.0, 13.7 + SH, 0.8), (293.66, 15.8 + SH, 0.55)):   # D3 A3 D4
        env = np.clip((tt - ton) / 2.4, 0, 1) ** 1.5
        for _ in range(6):
            det = 2 ** (rng.uniform(-8, 8) / 1200)
            vr = rng.uniform(4.6, 5.6)
            vib = 2 ** (rng.uniform(3, 7) / 1200 * np.sin(TWO_PI * vr * tt + rng.uniform(0, TWO_PI)) * np.clip((tt - ton - 0.5) / 1.0, 0, 1))
            ph = TWO_PI * np.cumsum(f0 * det * vib) / SR
            s = np.zeros(n)
            h = 1
            while h * f0 < 3200:
                s += np.sin(h * ph + rng.uniform(0, TWO_PI)) / h ** 1.15
                h += 1
            s *= env * amp / 6 * (0.85 + 0.3 * smooth_rand(n, 6.0, rng))
            out += pan(s, rng.uniform(-0.7, 0.7))
    out = lp(out, 1500)
    out *= curve([(12.6 + SH, 1), (17.25 + SH, 1), (18.3 + SH, 0), (DUR, 0)], t=tt)
    full = np.zeros((2, N))
    full[:, i0:] = out
    return full + 0.6 * reverb(full, IR_HALL)


# ------------------------------------------------------------------ 披风
def make_cloth():
    rng = R(31)
    buf = np.zeros((2, N))
    tc = CUT_A + 0.04
    while tc < CUT_B - 0.06:
        n = int(SR * rng.uniform(0.035, 0.11))
        tt = np.arange(n) / SR
        fc = rng.uniform(180, 900)
        nz = unit(bp(rng.standard_normal(n + 300), fc * 0.5, fc * 2.2)[300:])
        a = min(rng.lognormal(-0.3, 0.5), 1.5)
        seg = nz * (1 - np.exp(-tt / 0.002)) * np.exp(-tt / rng.uniform(0.012, 0.035)) * a
        if rng.random() < 0.3:                            # 布边抽打的脆响
            m = min(n, int(SR * 0.012))
            ck = unit(bp(rng.standard_normal(m + 300), 1800, 5500)[300:]) * np.exp(-np.arange(m) / SR / 0.003)
            seg[:m] += ck * 0.5 * a
        add(buf, pan(seg, rng.uniform(-0.45, 0.35)), tc)
        tc += rng.uniform(0.045, 0.14) * (1.7 if rng.random() < 0.12 else 1.0)
    # 连续的"猎猎"抖动层
    nz = bp(st_noise(N, rng, 0.4), 220, 1100)
    nz /= nz.std()
    rate = 12.5 + 3.0 * (2 * smooth_rand(N, 0.8, rng) - 1)
    flut = np.clip(np.sin(TWO_PI * np.cumsum(rate) / SR), 0, 1) ** 2.5 * (0.5 + 0.5 * smooth_rand(N, 6.0, rng))
    buf += nz * flut * 0.55
    buf = lp(buf, 3200)
    buf *= 0.55 + 0.75 * smooth_rand(N, 0.9, rng)        # 跟着阵风起伏
    gate = curve([(0, 0), (CUT_A - 0.03, 0), (CUT_A + 0.03, 1), (CUT_B - 0.03, 1), (CUT_B + 0.03, 0), (DUR, 0)])
    return buf * gate * ((1 + 0.22 * seg_gate(CUT_F, CUT_E)) * 1.3 if WITH_F else 1.0)      # F 段更猛一些；1.3 用来抵消六镜头版随机阵风曲线偏低


# ------------------------------------------------------------------ 大鼓
def dagu(gain=1.0, f0=55.0, seed=0, bright=1.0):
    """大鼓：圆膜非谐模态 + 击后音高回落 + 鼓皮噪声 + 鼓槌瞬态 + 木腔共鸣。"""
    rng = R(1000 + seed)
    n = int(SR * 3.0)
    tt = np.arange(n) / SR
    pe = 1 + 0.55 * np.exp(-tt / 0.03) + 0.07 * np.exp(-tt / 0.3)
    ph = TWO_PI * np.cumsum(f0 * pe) / SR
    modes = [(1.00, 0.74, 0.52), (1.59, 0.62, 0.36), (2.14, 0.42, 0.26), (2.30, 0.32, 0.22), (2.65, 0.24, 0.18),
             (2.92, 0.18, 0.15), (3.16, 0.14, 0.12), (3.50, 0.11, 0.10), (4.06, 0.08, 0.08), (4.60, 0.06, 0.07)]
    x = np.zeros(n)
    for r, a, tau in modes:
        x += a * np.sin(ph * r + rng.uniform(0, TWO_PI)) * np.exp(-tt / (tau * rng.uniform(0.9, 1.1)))
    x *= 1 - np.exp(-tt / 0.0015)
    pk0 = np.abs(x).max()
    # 并行饱和：把鼓腔低频压出谐波，只取 150–500 Hz 混回去——小喇叭放不出基频时仍听得出"咚"
    harm = bp(np.tanh(2.5 * lp(x, 130) + 0.3) - np.tanh(0.3), 170, 560)
    x += 1.0 * pk0 * harm / (np.abs(harm).max() + 1e-9) * np.exp(-tt / 0.28)
    x += 0.68 * unit(bp(rng.standard_normal(n), 80, 480)) * np.exp(-tt / 0.10)                    # 鼓皮
    x += 0.85 * unit(bp(rng.standard_normal(n), 180, 700)) * np.exp(-tt / 0.08)                   # 鼓腔的"嘭"
    x += 0.60 * unit(bp(rng.standard_normal(n), 300, 1200)) * np.exp(-tt / 0.045)                 # 鼓皮的"啪"
    x += 0.55 * bright * unit(bp(rng.standard_normal(n), 900, 5000)) * np.exp(-tt / 0.012)        # 鼓槌
    x += 0.62 * bright * unit(bp(rng.standard_normal(n), 1000, 3200)) * np.exp(-tt / 0.022)       # 鼓皮敲击的 1–3 kHz
    for fr, a, tau in ((186.0, 0.34, 0.11), (243.0, 0.40, 0.10), (311.0, 0.38, 0.09), (420.0, 0.24, 0.07), (545.0, 0.12, 0.05)):   # 木腔
        x += a * np.sin(TWO_PI * fr * tt + rng.uniform(0, TWO_PI)) * np.exp(-tt / tau)
    x = np.tanh(1.4 * x)
    return x / np.abs(x).max() * gain


def sub_dive():
    n = int(SR * 1.8)
    tt = np.arange(n) / SR
    f = 30 + 36 * np.exp(-tt / 0.45)
    x = np.sin(TWO_PI * np.cumsum(f) / SR) * np.exp(-tt / 0.55) * (1 - np.exp(-tt / 0.01))
    x = np.tanh(1.5 * x) / np.tanh(1.5)
    return x + 0.35 * bp(np.tanh(4.0 * x), 90, 320) * np.exp(-tt / 0.5)


# 时间, 力度, 基频, 是否大击
HITS = [(CUT_A, 1.00, 52.0, True)] + ([(CUT_F, 0.72, 56.0, False)] if WITH_F else []) + [(CUT_E, 0.96 if WITH_F else 0.80, 57.0, False),
        (10.50 + SH, 0.72, 60.0, False), (11.30 + SH, 0.75, 58.0, False), (11.95 + SH, 0.80, 56.0, False), (12.50 + SH, 0.88, 54.0, False),
        (13.00 + SH, 1.00, 52.0, True), (17.20 + SH, 1.10, 49.0, True)]


def make_drums():
    dry = np.zeros((2, N))
    big = np.zeros((2, N))
    hits = HITS
    rng = R(55)
    for i, (t0, g, f0, is_big) in enumerate(hits):
        d = dagu(g, f0, seed=i, bright=0.7 + 0.5 * g)
        add(dry, pan(d, 0.0 if is_big else rng.uniform(-0.15, 0.15)), t0)
        if is_big:                                        # 大击：三面鼓略微错开，再叠一层低频
            d2 = dagu(g * 0.60, f0 * 1.12, seed=50 + i)
            d3 = dagu(g * 0.40, f0 * 0.94, seed=80 + i)
            add(dry, pan(d2, -0.28), t0 + 0.014)
            add(dry, pan(d3, 0.30), t0 + 0.022)
            add(big, d + d2 + d3, t0)
    add(dry, sub_dive(), 17.2 + SH, 0.50)
    return dry + 0.28 * reverb(dry, IR_ROOM) + 0.30 * reverb(big, IR_HALL)


def tamtam(seed, dur=6.0, f_lo=70.0, f_hi=4200.0, n_part=70):
    """大锣：密集非谐泛音，高频晚一点才"涌"出来。"""
    rng = R(seed)
    n = int(SR * dur)
    tt = np.arange(n) / SR
    out = np.zeros((2, n))
    fs = np.geomspace(f_lo, f_hi, n_part) * (1 + rng.uniform(-0.04, 0.04, n_part))
    for f in fs:
        u = np.log2(f / f_lo) / np.log2(f_hi / f_lo)
        a = (f / f_lo) ** -0.7 * rng.uniform(0.4, 1.0)
        env = (1 - np.exp(-tt / (0.01 + 0.5 * u))) * np.exp(-tt / (3.2 * (f / f_lo) ** -0.45))
        beat = 1 + 0.3 * np.sin(TWO_PI * rng.uniform(0.3, 2.5) * tt + rng.uniform(0, TWO_PI))
        out += pan(a * np.sin(TWO_PI * f * tt + rng.uniform(0, TWO_PI)) * env * beat, rng.uniform(-0.8, 0.8))
    return out / np.abs(out).max()


def make_tam():
    buf = np.zeros((2, N))
    add(buf, tamtam(91), CUT_A, 0.45)
    add(buf, tamtam(94, f_lo=82.0), CUT_E, 0.30)
    add(buf, tamtam(92), 13.0 + SH, 0.8)
    add(buf, tamtam(93, f_lo=58.0), 17.2 + SH, 1.0)
    return buf + 0.5 * reverb(buf, IR_HALL)


# ------------------------------------------------------------------ 呼啸
def whoosh_a():
    """A：约 95 m 外由近及远的掠过，左 → 右，多普勒下滑。"""
    rng = R(41)
    t0, pk = 0.3, 1.1
    n = int(SR * 2.8)
    tt = t0 + np.arange(n) / SR
    env = np.where(tt < pk, np.exp(-0.5 * ((tt - pk) / 0.22) ** 2),
                   0.75 * np.exp(-(tt - pk) / 0.38) + 0.25 * np.exp(-(tt - pk) / 0.9))
    dop = 1.0 - 0.38 * np.tanh((tt - pk) / 0.28)
    m1 = unit(swept_noise(rng.standard_normal(n), 900 * dop, 1.6))
    m2 = unit(swept_noise(rng.standard_normal(n), 2100 * dop, 0.4))
    m3 = unit(swept_noise(rng.standard_normal(n), 3800 * dop, 1.4)) * np.exp(-0.5 * ((tt - pk) / 0.2) ** 2)
    x = (0.8 * m1 + 0.45 * m2 + 0.3 * m3) * env
    d = np.clip((tt - pk) / 1.3, 0, 1) * 0.8                # 越远越闷
    x = x * (1 - d) + lp(x, 1100) * d
    x *= np.clip((t0 + n / SR - tt) / 0.3, 0, 1)
    st = pan(x, curve([(0.3, -0.8), (pk, -0.25), (2.2, 0.55), (3.1, 0.6)], t=tt))
    buf = np.zeros((2, N))
    add(buf, st, t0)
    return buf + 0.45 * reverb(buf, IR_HALL)


def whoosh_c():
    """C：最近点在 WHOOSH_C_PK，贴着头顶掠过（宽频扫频 + 低频冲击 + 明显多普勒），随后远去并带山谷回声。"""
    rng = R(43)
    t0, pk = CUT_B + 0.01, WHOOSH_C_PK
    n = int(SR * 3.8)
    tt = t0 + np.arange(n) / SR
    after = np.maximum(tt - pk, 0)
    env = np.where(tt < pk, np.exp(np.minimum(tt - pk, 0) / 0.10),
                   0.52 * np.exp(-after / 0.16) + 0.38 * np.exp(-after / 0.50) + 0.10 * np.exp(-after / 1.2))
    env = np.maximum(env, 0.9 * np.exp(-0.5 * ((tt - pk) / 0.13) ** 2))      # 最近的那 0.3 s 保持满能量
    dop = 1.0 - 0.42 * np.tanh((tt - pk) / 0.07)
    fcw = curve([(t0, 2500), (pk - 0.1, 4200), (pk, 2600), (pk + 0.25, 900), (pk + 1.0, 380), (pk + 3.0, 260)], t=tt)
    wide = np.stack([unit(swept_noise(rng.standard_normal(n), fcw, 2.8)) for _ in range(2)])
    width = curve([(t0, 1.0), (pk, 1.0), (pk + 0.5, 0.35), (pk + 1.5, 0.15)], t=tt)     # 掠顶时很宽，远去后收到正前方
    mid, side = wide.mean(0), (wide[0] - wide[1]) / 2
    wide = np.stack([mid + side * width, mid - side * width])
    tone = unit(swept_noise(rng.standard_normal(n), 880 * dop, 0.28) + 0.7 * swept_noise(rng.standard_normal(n), 1320 * dop, 0.30))
    rip = bp(st_noise(n, rng, 0.2), 5500, 13000)
    rip = rip / rip.std() * np.exp(-0.5 * ((tt - pk) / 0.045) ** 2)
    ti = np.maximum(tt - (pk - 0.01), 0)
    imp = np.sin(TWO_PI * np.cumsum(38 + 55 * np.exp(-ti / 0.07)) / SR) * np.exp(-ti / 0.32) * (1 - np.exp(-ti / 0.004)) * (tt >= pk - 0.01)
    lown = unit(bp(rng.standard_normal(n), 30, 140)) * np.exp(-0.5 * ((tt - pk) / 0.12) ** 2)
    out = wide * env + 0.60 * tone * env + 0.5 * rip + 0.6 * imp + 0.4 * lown
    d = np.clip(after / 1.2, 0, 1) * 0.85
    out = out * (1 - d) + lp(out, 900) * d
    out *= np.clip((t0 + n / SR - tt) / 0.4, 0, 1) * np.clip((tt - t0) / 0.03, 0, 1)
    buf = np.zeros((2, N))
    add(buf, out, t0)
    echo = np.zeros((2, N))                                 # 山谷回声
    for dly, g, fcut, p in ((0.43, 0.28, 1800, -0.5), (0.81, 0.16, 1200, 0.55), (1.30, 0.08, 900, -0.2)):
        add(echo, pan(lp(out.mean(0), fcut), p), t0 + dly, g)
    return buf + echo + 0.5 * reverb(buf + echo, IR_VALLEY)


def make_riser():
    """切点前的气流上扬（反向感），到鼓点处戛然而止。"""
    rng = R(47)
    buf = np.zeros((2, N))
    for t_hit, dur, g in ((CUT_A, 0.9, 0.8), (13.0 + SH, 1.1, 1.0)):
        n = int(SR * dur)
        tt = np.arange(n) / SR
        fc = 250 * (3500 / 250) ** ((tt / dur) ** 1.5)
        e = np.exp((tt - dur) / (dur * 0.28)) * np.clip((dur - tt) / 0.006, 0, 1)
        st = np.stack([unit(swept_noise(rng.standard_normal(n), fc, 1.5)) for _ in range(2)]) * e
        add(buf, st, t_hit - dur, g)
    return buf


# ------------------------------------------------------------------ 六镜头版新增
def make_passby():
    """F：高速经过近处石峰时的风压脉动——不规则的"呼"的一下，左右声像轻摆。"""
    buf = np.zeros((2, N))
    rng = R(72)
    for tc, a, side in pass_events():
        dur = rng.uniform(0.44, 0.62)
        n = int(SR * dur)
        tt = np.arange(n) / SR
        c = dur * 0.45
        sg = rng.uniform(0.06, 0.10)
        env = np.exp(-0.5 * ((tt - c) / np.where(tt < c, sg, sg * 1.5)) ** 2)
        dop = 1.0 - 0.3 * np.tanh((tt - c) / 0.07)
        low = unit(bp(rng.standard_normal(n + 600), 70, 300)[600:])                                         # 风压的"呼"
        body = unit(swept_noise(rng.standard_normal(n), 520 * dop, 1.4, fmin=120, fmax=6000, nb=18))        # 小喇叭也听得到的部分
        air = unit(swept_noise(rng.standard_normal(n), 2400 * dop, 1.2, fmin=300, fmax=12000, nb=16))
        p0 = side * rng.uniform(0.18, 0.45)
        add(buf, pan((0.9 * low + 0.8 * body + 0.35 * air) * env * a, np.linspace(p0, -0.6 * p0, n)), tc - c)
    return buf + 0.2 * reverb(buf, IR_ROOM)


def make_shimmer():
    """E：悟空从山影飞入阳光的瞬间（切入后约 0.4–0.6 s），一层很轻的、向上打开的泛音和气声。"""
    buf = np.zeros((2, N))
    if not WITH_F:
        return buf
    rng = R(83)
    n = int(SR * 2.2)
    tt = np.arange(n) / SR
    x = np.zeros((2, n))
    for k, fr in enumerate((587.33, 880.0, 1174.66, 1760.0, 2349.3)):       # D5 A5 D6 A6 D7：自下而上依次打开
        ts = np.maximum(tt - 0.05 * k, 0)
        env = (1 - np.exp(-ts / 0.12)) * np.exp(-ts / (0.9 - 0.1 * k)) * (tt >= 0.05 * k)
        nb = bp(st_noise(n, rng, 0.1), fr * 0.992, fr * 1.008)
        x += nb / (nb.std() + 1e-12) * env * 0.9 ** k
    fc = 1800 * (7500 / 1800) ** np.clip(tt / 0.6, 0, 1)
    air = np.stack([unit(swept_noise(rng.standard_normal(n), fc, 1.3, fmin=600, fmax=14000, nb=18)) for _ in range(2)])
    x += 0.45 * air * (1 - np.exp(-tt / 0.15)) * np.exp(-tt / 0.45)
    add(buf, x, CUT_E + 0.36)
    return buf + 0.7 * reverb(buf, IR_HALL)


# ------------------------------------------------------------------ 箫
def make_xiao():
    """D 镜头的箫声：D4–F4–A4 三个长音，带气声、起音滑入、延迟进入的揉音。"""
    rng = R(77)
    notes = [(13.35 + SH, 293.66), (14.75 + SH, 349.23), (15.85 + SH, 440.00)]
    t0 = 13.1 + SH
    n = int(SR * 5.2)
    tt = t0 + np.arange(n) / SR
    f = np.full(n, notes[0][1])
    for ton, fr in notes[1:]:
        f[tt >= ton] = fr
    f = smooth(f, 0.07)                                     # 连音之间的滑音
    cents = -45 * np.exp(-np.maximum(tt - notes[0][0], 0) / 0.09)
    vib_depth = np.zeros(n)
    gates = []
    for i, (ton, fr) in enumerate(notes):
        toff = notes[i + 1][0] if i + 1 < len(notes) else 99.0
        vib_depth += (9, 11, 16)[i] * smooth(np.clip((tt - ton - 0.35) / 0.5, 0, 1) * (tt < toff), 0.05)
        gates.append(smooth(((tt >= ton - 0.03) & (tt < toff - 0.03)).astype(float), 0.04))
    vib_ph = TWO_PI * np.cumsum(4.7 + 0.5 * smooth_rand(n, 0.5, rng)) / SR
    cents += vib_depth * np.sin(vib_ph) + 5 * (smooth_rand(n, 2.0, rng) - 0.5)
    ph = TWO_PI * np.cumsum(f * 2 ** (cents / 1200)) / SR
    env = smooth(curve([(13.35, 0), (13.6, 0.55), (14.3, 0.75), (14.7, 0.6), (14.85, 0.8), (15.6, 0.85), (15.82, 0.7),
                        (16.0, 0.95), (16.9, 1.0), (17.25, 0.8), (17.7, 0.0)], t=tt - SH), 0.03)
    env_t = env * (1 + 0.06 * np.sin(vib_ph + 1.0) * vib_depth / 16) * (1 + 0.08 * (smooth_rand(n, 12.0, rng) - 0.5))
    tone = np.zeros(n)
    for h, a in enumerate([1.0, 0.40, 0.17, 0.07, 0.035, 0.015], 1):
        tone += a * np.sin(h * ph + rng.uniform(0, TWO_PI)) * env_t ** (1 + 0.35 * (h - 1))
    breath = np.zeros(n)                                    # 在基频和二、三次谐波附近共振的气噪
    for (ton, fr), g in zip(notes, gates):
        nz = rng.standard_normal(n)
        b = unit(bp(nz, fr * 0.97, fr * 1.03)) + 0.6 * unit(bp(nz, 2 * fr * 0.97, 2 * fr * 1.03)) + 0.35 * unit(bp(nz, 3 * fr * 0.97, 3 * fr * 1.03))
        breath += b * g
    air = unit(bp(rng.standard_normal(n), 1800, 7500))
    turb = 0.6 + 0.4 * smooth_rand(n, 9.0, rng)
    env_b = np.interp(tt + 0.05, tt, env)                   # 气息比乐音早一点
    env_b = env_b + 0.5 * np.exp(-0.5 * ((tt - SH - 13.42) / 0.06) ** 2)
    x = 0.8 * tone + breath * env_b * 0.33 * turb + air * env_b * 0.035 * turb
    x = lp(x, 5000)
    buf = np.zeros((2, N))
    add(buf, pan(x, -0.15), t0)
    return 0.75 * buf + 0.55 * reverb(buf, IR_HALL)


# ------------------------------------------------------------------ 混音与母带
GAINS = dict(wind=0.092, drone=0.165, pad=0.135, cloth=0.185, drums=0.400, tam=0.100,
             whooshA=0.160, whooshC=0.250, riser=0.055, xiao=0.195, passby=0.125, shimmer=0.036)


PRESENCE = dict(wind=0.38, cloth=0.38, whooshA=0.38, whooshC=0.33, drums=0.30, passby=0.30)      # 800 Hz–6 kHz 并行提升量（0.38 ≈ +2.8 dB）


def presence(x, amt):
    return x + amt * signal.sosfiltfilt(butter('band', [800.0, 6000.0], 1), x, axis=-1)


def build():
    return dict(wind=make_wind(), drone=make_drone(), pad=make_pad(), cloth=make_cloth(), drums=make_drums(),
                tam=make_tam(), whooshA=whoosh_a(), whooshC=whoosh_c(), riser=make_riser(), xiao=make_xiao(),
                passby=make_passby(), shimmer=make_shimmer())


def lufs(x):
    """BS.1770 积分响度（K 计权 + 双门限），48 kHz。"""
    y = signal.lfilter([1.53512485958697, -2.69169618940638, 1.19839281085285], [1.0, -1.69065929318241, 0.73248077421585], x, axis=-1)
    y = signal.lfilter([1.0, -2.0, 1.0], [1.0, -1.99004745483398, 0.99007225036621], y, axis=-1)
    blk, hop = int(0.4 * SR), int(0.1 * SR)
    ms = np.array([(y[:, i:i + blk] ** 2).mean(axis=1).sum() for i in range(0, y.shape[1] - blk + 1, hop)])
    l = -0.691 + 10 * np.log10(ms + 1e-12)
    g1 = ms[l > -70]
    rel = -0.691 + 10 * np.log10(g1.mean() + 1e-12) - 10
    g2 = ms[(l > -70) & (l > rel)]
    return -0.691 + 10 * np.log10(g2.mean() + 1e-12)


def compress(x, thr_db=-13.0, ratio=1.6):
    lvl = np.sqrt(uniform_filter1d(np.mean(x ** 2, axis=0), int(0.05 * SR), mode='nearest'))
    over = np.maximum(20 * np.log10(lvl + 1e-9) - thr_db, 0)
    gr = -over * (1 - 1 / ratio)
    gr = uniform_filter1d(minimum_filter1d(gr, int(0.02 * SR), mode='nearest'), int(0.12 * SR), mode='nearest')
    return x * 10 ** (gr / 20)


def soft_clip(x, k=0.92):
    return np.tanh(x / k) * k


def limiter(x, ceil_db=CEIL_DB, hold=0.060, sm=0.030):
    """前视限幅：保持窗取最小增益，再用更短的窗平滑，保证不超过门限。"""
    thr = 10 ** (ceil_db / 20)
    g = np.minimum(1.0, thr / np.maximum(np.abs(x).max(axis=0), 1e-9))
    g = minimum_filter1d(g, int(hold * SR) | 1, mode='nearest')
    g = uniform_filter1d(g, int(sm * SR) | 1, mode='nearest')
    limiter.max_gr_db = float(-20 * np.log10(g.min()))
    limiter.active = float((g < 0.89).mean())              # 压下超过 1 dB 的时间占比
    return x * g


def master(mix):
    pre = signal.sosfiltfilt(butter('high', 32.0, 4), mix, axis=-1)
    tail = curve([(0, 1), (CUT_D + 0.2, 1), (18.2 + SH, 0.45), (18.7 + SH, 0.10), (DUR, 0.06)])
    fade = np.where(T < DUR - 0.3, 1.0, 0.5 * (1 + np.cos(np.pi * np.clip((T - (DUR - 0.3)) / 0.3, 0, 1))))
    fade[-1] = 0.0
    g = 10 ** ((TARGET_LUFS - lufs(pre)) / 20)
    y = pre
    for _ in range(6):
        y = limiter(soft_clip(compress(pre * g))) * tail * fade
        err = TARGET_LUFS - lufs(y)
        if abs(err) < 0.1:
            break
        g *= 10 ** (err / 20)
    return y, 20 * np.log10(g)


def seg_rms_db(x, a, b):
    s = x[:, int(a * SR):int(b * SR)]
    return 20 * np.log10(np.sqrt(np.mean(s ** 2)) + 1e-12)


SEGS = (('A', 0.0, CUT_A),) + ((('B', CUT_A, CUT_F), ('F', CUT_F, CUT_E)) if WITH_F else (('B', CUT_A, CUT_E),)) + (('E', CUT_E, CUT_B), ('C', CUT_B, CUT_C), ('D', CUT_C, CUT_D), ('黑场', CUT_D, DUR))


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    out_path = args[0] if args else os.path.join(HERE, 'mix_real_f.wav' if WITH_F else 'mix_real.wav')
    buses = build()
    if '--stats' in sys.argv:
        print('各分轨（乘增益后）RMS dBFS：' + '  '.join(n for n, _, _ in SEGS) + '  | 峰值')
        for k, v in buses.items():
            w = v * GAINS[k]
            print('  %-8s' % k + ' '.join('%7.1f' % seg_rms_db(w, a, b) for _, a, b in SEGS) + '  | %6.1f' % (20 * np.log10(np.abs(w).max() + 1e-12)))
    buses = {k: presence(v, PRESENCE[k]) if k in PRESENCE else v for k, v in buses.items()}
    buses['drums'] = buses['drums'] + 1.0 * signal.sosfiltfilt(butter('band', [200.0, 1200.0], 1), buses['drums'], axis=-1)   # 鼓腔中频：小喇叭上的"咚"
    duck = np.ones(N)                                       # 鼓点落下的瞬间，其他声部让一下
    for t0, g, _, is_big in HITS:
        duck *= 1 - (0.50 if is_big else 0.32) * np.exp(-np.maximum(T - t0, 0) / 0.15) * (T >= t0 - 0.004)
    if WITH_F:                                              # F 结尾到"亮相"鼓点之前留一口气
        duck *= 1 - 0.42 * np.clip((T - (CUT_E - 0.10)) / 0.08, 0, 1) * (T < CUT_E)
    mix = sum(buses[k] * GAINS[k] * (1.0 if k in ('drums', 'tam') else duck) for k in buses)
    y, gain_db = master(mix)
    assert y.shape == (2, N) and np.isfinite(y).all()
    dither = (R(999).random((2, N)) - R(998).random((2, N))) / 32768.0
    dither[:, -int(0.02 * SR):] = 0
    pcm = np.clip(np.round((y + dither) * 32767.0), -32768, 32767).astype(np.int16)
    pcm[:, -1] = 0
    wavfile.write(out_path, SR, pcm.T)
    print('WROTE %s\n母带增益 %+.1f dB  响度 %.1f LUFS  限幅最大 %.1f dB（>1 dB 的时间占 %.1f%%）' % (out_path, gain_db, lufs(pcm / 32768.0), limiter.max_gr_db, limiter.active * 100))


if __name__ == '__main__':
    main()
