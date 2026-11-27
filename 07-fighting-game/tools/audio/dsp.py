"""程序化合成用的基础 DSP 工具（numpy / scipy）。全部是确定性的：传入 rng 控制随机。"""
import numpy as np
from scipy.signal import butter, sosfilt, lfilter, fftconvolve

SR = 44100


def n_of(dur):
    return max(1, int(round(dur * SR)))


def tt(dur):
    return np.arange(n_of(dur)) / SR


# ---------------- 滤波 ----------------
def _sos(kind, f, order):
    nyq = SR / 2
    if kind == 'bandpass':
        lo, hi = f
        lo = max(lo, 10)
        hi = min(hi, nyq * 0.95)
        return butter(order, [lo, hi], 'bandpass', fs=SR, output='sos')
    f = min(max(f, 10), nyq * 0.95)
    return butter(order, f, kind, fs=SR, output='sos')


def lp(x, f, order=2):
    return sosfilt(_sos('lowpass', f, order), x)


def hp(x, f, order=2):
    return sosfilt(_sos('highpass', f, order), x)


def bp(x, lo, hi, order=2):
    return sosfilt(_sos('bandpass', (lo, hi), order), x)


def svf(x, fc, q=0.7, mode='bp'):
    """时变状态变量滤波器（TPT 结构）。fc 可以是标量或逐样本数组。"""
    n = len(x)
    fc = np.broadcast_to(np.asarray(fc, float), (n,))
    q = np.broadcast_to(np.asarray(q, float), (n,))
    g = np.tan(np.pi * np.clip(fc, 10, SR * 0.45) / SR)
    k = 1.0 / q
    a1 = 1.0 / (1.0 + g * (g + k))
    a2 = g * a1
    a3 = g * a2
    out = np.empty(n)
    ic1 = ic2 = 0.0
    m = {'lp': 0, 'bp': 1, 'hp': 2}[mode]
    xs = x.tolist()
    a1l, a2l, a3l, kl = a1.tolist(), a2.tolist(), a3.tolist(), k.tolist()
    for i in range(n):
        v0 = xs[i]
        v3 = v0 - ic2
        v1 = a1l[i] * ic1 + a2l[i] * v3
        v2 = ic2 + a2l[i] * ic1 + a3l[i] * v3
        ic1 = 2 * v1 - ic1
        ic2 = 2 * v2 - ic2
        if m == 0:
            out[i] = v2
        elif m == 1:
            out[i] = v1
        else:
            out[i] = v0 - kl[i] * v1 - v2
    return out


# ---------------- 包络 ----------------
def expdecay(n, tau, attack=0.0008):
    t = np.arange(n) / SR
    e = np.exp(-t / tau)
    na = int(attack * SR)
    if na > 1:
        e[:na] *= np.linspace(0, 1, na)
    return e


def adsr(n, a, d, s, r, hold=None):
    """a/d/r 秒，s 电平；hold 为到 release 开始的时刻（默认 n - r）。"""
    t = np.arange(n) / SR
    total = n / SR
    rel_start = (total - r) if hold is None else hold
    e = np.where(t < a, t / max(a, 1e-6),
                 np.where(t < a + d, 1 - (1 - s) * (t - a) / max(d, 1e-6), s))
    e = np.where(t >= rel_start, e * np.clip(1 - (t - rel_start) / max(r, 1e-6), 0, 1), e)
    return e


def bell_env(n, peak=0.4, sharp=2.0):
    """先升后降的包络，峰值位于 peak（0..1 比例）。"""
    u = np.linspace(0, 1, n)
    e = np.where(u < peak, (u / peak) ** sharp, ((1 - u) / (1 - peak)) ** (sharp * 0.8))
    return e


# ---------------- 振荡 ----------------
def sweep(dur, f0, f1, tau, phase0=0.0):
    """频率从 f0 指数靠近 f1 的正弦（打击身体的“咚”）。"""
    t = tt(dur)
    f = f1 + (f0 - f1) * np.exp(-t / tau)
    ph = phase0 + 2 * np.pi * np.cumsum(f) / SR
    return fade(np.sin(ph), 0, min(0.06, dur * 0.3))


def osc_f(f):
    """按逐样本频率数组生成正弦。"""
    return np.sin(2 * np.pi * np.cumsum(f) / SR)


def partials(dur, freqs, amps, taus, rng=None, detune=0.0):
    t = tt(dur)
    out = np.zeros(len(t))
    for f, a, tau in zip(freqs, amps, taus):
        if rng is not None and detune:
            f = f * (1 + rng.uniform(-detune, detune))
        ph = rng.uniform(0, 2 * np.pi) if rng is not None else 0
        out += a * np.sin(2 * np.pi * f * t + ph) * np.exp(-t / tau)
    return fade(out, 0, min(0.05, dur * 0.25))


def noise(dur, rng):
    return rng.standard_normal(n_of(dur))


def crackle(dur, rng, density, env=None, lo=1500, hi=8000, tau=0.002):
    """稀疏随机脉冲（噼啪、碎屑、颗粒）。density：每秒个数，可以是数组（逐样本）。"""
    n = n_of(dur)
    dens = np.broadcast_to(np.asarray(density, float), (n,))
    trig = rng.random(n) < dens / SR
    imp = np.zeros(n)
    imp[trig] = rng.uniform(0.3, 1.0, trig.sum()) * rng.choice([-1, 1], trig.sum())
    k = expdecay(int(tau * 8 * SR) + 2, tau, attack=0)
    burst = fftconvolve(imp, k * rng.standard_normal(len(k)))[:n]
    out = bp(burst, lo, hi)
    if env is not None:
        out *= env
    return out


def pluck(freq, dur, rng, decay=0.996, bright=0.6, pos=0.18, body=True):
    """Karplus-Strong 拨弦（带分数延迟全通，音准准确），用 lfilter 实现，很快。"""
    n = n_of(dur)
    N = SR / freq - 0.5
    Ni = int(np.floor(N))
    d = N - Ni
    if d < 0.15:
        Ni -= 1
        d += 1
    C = (1 - d) / (1 + d)
    g = decay
    num_L = g * 0.5 * np.array([C, 1 + C, 1.0])
    a = np.zeros(Ni + 3)
    a[0] = 1.0
    a[1] += C
    a[Ni:Ni + 3] -= num_L
    b = np.array([1.0, C])
    exc = rng.uniform(-1, 1, Ni)
    # 亮度：一阶低通激励
    exc = lfilter([bright], [1, -(1 - bright)], exc)
    # 拨弦位置：梳状
    p = max(1, int(pos * Ni))
    exc = exc - np.concatenate([np.zeros(p), exc[:-p]])
    x = np.zeros(n)
    x[:Ni] = exc
    y = lfilter(b, a, x)
    if body:
        # 共鸣箱：两三个宽共振峰
        y = y + 0.35 * bp(y, 180, 320) + 0.25 * bp(y, 420, 700)
    return fade(y, 0, min(0.05, dur * 0.2))


# ---------------- 效果 ----------------
def sat(x, drive=1.0):
    return np.tanh(x * drive) / np.tanh(drive)


def reverb_ir(dur, rng, decay=None, lo=200, hi=7000, stereo=True, predelay=0.0):
    n = n_of(dur)
    decay = decay or dur
    t = np.arange(n) / SR
    env = np.exp(-t * 6.9 / decay)
    chans = []
    for _ in range(2 if stereo else 1):
        x = rng.standard_normal(n) * env
        # 高频衰减更快：分两段混合
        x = bp(x, lo, hi) * 0.7 + lp(x, 1200) * 0.3 * np.exp(-t * 3 / decay)
        x[: int(0.002 * SR)] *= np.linspace(0, 1, int(0.002 * SR))
        if predelay > 0:
            x = np.concatenate([np.zeros(n_of(predelay)), x])[:n]
        x /= np.sqrt(np.sum(x ** 2)) + 1e-12
        chans.append(x)
    return np.stack(chans) if stereo else chans[0]


def apply_reverb(x, ir, wet):
    """x 单声道 -> 单/立体声。ir 为 (2, n) 时输出立体声。"""
    if ir.ndim == 1:
        w = fftconvolve(x, ir)
        y = np.zeros(len(w))
        y[:len(x)] += x
        return y + wet * w
    out = []
    for c in range(ir.shape[0]):
        w = fftconvolve(x, ir[c])
        y = np.zeros(len(w))
        y[:len(x)] += x
        out.append(y + wet * w)
    return np.stack(out)


def place(buf, x, at, gain=1.0):
    """把 x（单声道或 (2,n)）放到 buf 的 at 秒处。buf 自动扩展，返回新 buf。"""
    i = int(round(at * SR))
    if x.ndim == 1 and buf.ndim == 2:
        x = np.stack([x, x])
    need = i + x.shape[-1]
    if need > buf.shape[-1]:
        pad = need - buf.shape[-1]
        buf = np.concatenate([buf, np.zeros(buf.shape[:-1] + (pad,))], axis=-1)
    buf[..., i:i + x.shape[-1]] += gain * x
    return buf


def mix(*items, stereo=False):
    """items: (signal, at_seconds, gain)"""
    buf = np.zeros((2, 1)) if stereo else np.zeros(1)
    for it in items:
        x, at, g = (it + (1.0,))[:3] if len(it) == 2 else it
        buf = place(buf, x, at, g)
    return buf


def pan(x, p):
    """等功率声像，p -1..1。"""
    a = (p + 1) * np.pi / 4
    return np.stack([x * np.cos(a), x * np.sin(a)])


def fade(x, fin=0.0005, fout=0.01):
    x = x.copy()
    n = x.shape[-1]
    ni, no = min(n, int(fin * SR)), min(n, int(fout * SR))
    if ni > 1:
        x[..., :ni] *= np.linspace(0, 1, ni)
    if no > 1:
        x[..., n - no:] *= np.cos(np.linspace(0, np.pi / 2, no)) ** 2
    return x


def trim_tail(x, thresh_db=-62, min_dur=0.05, fout=0.02):
    """去掉末尾几乎无声的部分（保持淡出）。"""
    mono = np.abs(x) if x.ndim == 1 else np.max(np.abs(x), axis=0)
    peak = mono.max() + 1e-12
    th = peak * 10 ** (thresh_db / 20)
    idx = np.where(mono > th)[0]
    end = max(int(min_dur * SR), (idx[-1] + 1) if len(idx) else 1)
    end = min(end + int(0.01 * SR), x.shape[-1])
    return fade(x[..., :end], 0, fout)


def dc_block(x):
    return hp(x, 22, order=2) if x.ndim == 1 else np.stack([hp(c, 22, order=2) for c in x])


def loop_xfade(x, L, X):
    """x 长度 >= L+X：把 L 之后的 X 个样本等功率交叉淡入到开头，得到可无缝循环的长度 L。"""
    x = x.copy()
    u = np.linspace(0, 1, X)
    fi, fo = np.sin(u * np.pi / 2), np.cos(u * np.pi / 2)
    x[..., :X] = x[..., :X] * fi + x[..., L:L + X] * fo
    return x[..., :L]


def circ_filter(fn, x):
    """对周期信号做因果滤波：处理两遍拼接，取第二遍，边界状态自洽。"""
    n = x.shape[-1]
    y = fn(np.concatenate([x, x], axis=-1))
    return y[..., n:]


def circ_reverb(x, ir, wet):
    """周期信号的循环卷积混响（无缝循环用）。x (2,L) 或 (L,)；ir (2,m)。"""
    L = x.shape[-1]
    xs = x if x.ndim == 2 else np.stack([x, x])
    out = []
    for c in range(2):
        h = np.zeros(L)
        m = min(L, ir.shape[-1])
        h[:m] = ir[c][:m]
        w = np.fft.irfft(np.fft.rfft(xs[c]) * np.fft.rfft(h), n=L)
        out.append(xs[c] + wet * w)
    return np.stack(out)
