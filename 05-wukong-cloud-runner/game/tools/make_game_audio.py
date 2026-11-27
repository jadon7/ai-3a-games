"""《筋斗云驾驶模拟器》的全部音效素材：numpy/scipy 代码合成，不使用任何现成素材。
复用影片音轨脚本 ../audio/make_audio_real.py 里的积木（大鼓、锣、扫频噪声、混响、响度计）。

用法（在 game/ 下）：python tools/make_game_audio.py [--only 名字1,名字2] [--check]
  --only   只重新生成指定素材（名字不带扩展名）
  --check  不生成，只做循环点验证和清单统计
输出：assets/audio/*.wav（48 kHz / 立体声 / 16-bit）+ assets/audio/manifest.json

循环类素材的做法：整条在"环形时间"里合成——噪声用 FFT 域滤波（等价于环形卷积），调制曲线用周期样条，
音高取整到每圈整数个周期，鼓点/箫声/混响尾巴绕回开头叠加。所以首尾在数学上就是连续的，不靠交叉淡化。
"""
import sys, os, json
import numpy as np
from scipy.io import wavfile
from scipy.interpolate import CubicSpline

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(HERE)
OUT = os.path.join(GAME, 'assets', 'audio')
_film = os.path.join(os.path.dirname(GAME), 'audio')
if not os.path.exists(os.path.join(_film, 'make_audio_real.py')):
    sys.exit('找不到 ../audio/make_audio_real.py（本工具复用其中的合成积木）')
sys.path.insert(0, _film)
_argv, sys.argv = sys.argv, sys.argv[:1]          # make_audio_real 在导入时会读命令行开关
import make_audio_real as M
sys.argv = _argv

SR = M.SR
TWO_PI = 2 * np.pi
LOOP_LUFS = -20.0
SFX_PEAK_DB = -3.5
db = lambda v: 20 * np.log10(np.maximum(v, 1e-12))


# ------------------------------------------------------------------ 环形（周期）积木
def H_band(n, lo, hi, order=2):
    f = np.fft.rfftfreq(n, 1.0 / SR)
    H = np.ones_like(f)
    if lo:
        H *= 1 / np.sqrt(1 + (lo / np.maximum(f, 1e-6)) ** (2 * order))
    if hi:
        H *= 1 / np.sqrt(1 + (f / hi) ** (2 * order))
    H[0] = 0
    return H


def pband(x, lo, hi, order=2):
    """环形带通（零相位）。lo/hi 传 0 表示不限。"""
    n = x.shape[-1]
    return np.fft.irfft(np.fft.rfft(x, axis=-1) * H_band(n, lo, hi, order), n, axis=-1)


def pnoise(n, rng, corr=0.25):
    return M.st_noise(n, rng, corr)


def prand(n, cycles, rng, lo=0.0, hi=1.0):
    """周期的平滑随机曲线（一圈里约 cycles 个起伏）。"""
    k = max(4, int(round(cycles)))
    pts = rng.random(k)
    cs = CubicSpline(np.arange(k + 1), np.r_[pts, pts[0]], bc_type='periodic')
    x = cs(np.arange(n) * (k / n))
    x = (x - x.min()) / max(1e-9, x.max() - x.min())
    return lo + (hi - lo) * x


def pswept(src, fc, bw_oct, fmin=60.0, fmax=14000.0, nb=30):
    """环形的可变中心频率带通噪声（fc 必须是周期曲线）。"""
    n = len(src)
    X = np.fft.rfft(src)
    cs = np.geomspace(fmin, fmax, nb)
    sp = np.log2(fmax / fmin) / (nb - 1)
    lf = np.log2(np.clip(fc, fmin, fmax))
    sig = np.maximum(np.asarray(bw_oct, dtype=float) / 2.355, sp * 0.6)
    out = np.zeros(n)
    for c in cs:
        band = np.fft.irfft(X * H_band(n, c * 2 ** (-sp / 2), c * 2 ** (sp / 2)), n)
        out += band * np.exp(-0.5 * ((np.log2(c) - lf) / sig) ** 2)
    return out


def preverb(x, ir):
    """环形卷积混响：尾巴绕回开头。"""
    n = x.shape[1]
    fold = np.zeros((2, n))
    for i0 in range(0, ir.shape[1], n):
        seg = ir[:, i0:i0 + n]
        fold[:, :seg.shape[1]] += seg
    return np.fft.irfft(np.fft.rfft(x, axis=1) * np.fft.rfft(fold, axis=1), n, axis=1)


def padd(buf, seg, t0, gain=1.0):
    """把片段加到环形缓冲里（超出结尾的部分绕回开头）。"""
    seg = np.atleast_2d(seg)
    if seg.shape[0] == 1:
        seg = np.repeat(seg, 2, axis=0)
    idx = (int(round(t0 * SR)) + np.arange(seg.shape[1])) % buf.shape[1]
    np.add.at(buf, (slice(None), idx), gain * seg)


def qf(f, n):
    """把频率取整到一圈里整数个周期。"""
    L = n / SR
    return max(1, round(f * L)) / L


def ptone_stack(n, f0, harm_amps, rng, detune=0.004, voices=3, noise_amt=0.5):
    """周期的失谐泛音堆 + 谐波附近的窄带噪声（弓弦摩擦感）。"""
    t = np.arange(n) / SR
    L = n / SR
    out = np.zeros((2, n))
    for h, a in enumerate(harm_amps, 1):
        for _ in range(voices):
            f = qf(f0 * h * (1 + rng.uniform(-detune, detune)), n)
            am = prand(n, L * rng.uniform(0.12, 0.4), rng, 0.45, 1.0)
            s = np.sin(TWO_PI * f * t + rng.uniform(0, TWO_PI)) * am * a / voices
            out += M.pan(s, rng.uniform(-0.6, 0.6))
        fh = f0 * h
        nb = pband(pnoise(n, rng, 0.1), fh * 0.985, fh * 1.015)
        out += nb / (nb.std() + 1e-12) * a * noise_amt * 0.7
    return out


# ------------------------------------------------------------------ 循环：风
def wind_loop(L, seed, bands, howl, buffet, gust_depth):
    n = int(L * SR)
    rng = M.R(seed)
    common = prand(n, L * 0.45, rng)
    out = np.zeros((2, n))
    for lo, hi, g, rate in bands:
        nz = pband(pnoise(n, rng, 0.2), lo, hi)
        nz /= nz.std()
        for c in range(2):
            gust = 0.5 * common + 0.5 * prand(n, L * rate, rng)
            nz[c] *= (1 - gust_depth) + gust_depth * 1.6 * gust ** 1.6
        out += nz * g
    lo_f, hi_f, hg, voices = howl                      # 呼啸：中心频率缓慢游走的窄带噪声
    for v in range(voices):
        fc = lo_f + (hi_f - lo_f) * prand(n, L * (0.9 + 0.3 * v), rng)
        h = M.unit(pswept(rng.standard_normal(n), fc, 0.30, fmin=200, fmax=4000, nb=20))
        out += M.pan(h * hg * (0.3 + 1.05 * prand(n, L * 0.7, rng) ** 2), rng.uniform(-0.6, 0.6))
    if buffet:                                          # 高速时风压的抖动（低频 + 小喇叭听得到的中频）
        bf = M.unit(pband(pnoise(n, rng, 0.5), 0, 70)) * 2.2 * prand(n, L * 4.0, rng) ** 3
        bm = M.unit(pband(pnoise(n, rng, 0.3), 160, 520)) * 1.6 * prand(n, L * 6.0, rng) ** 3
        out += bf * buffet * 0.6 + bm * buffet * 0.5
    return out


def loop_wind_low():
    bands = [(35, 130, 0.14, 0.5), (140, 480, 0.50, 0.7), (480, 1500, 0.55, 0.9), (1700, 5200, 0.40, 1.1), (5200, 12000, 0.15, 1.4)]
    return wind_loop(12.0, 301, bands, howl=(420, 760, 0.10, 2), buffet=0.0, gust_depth=0.42)


def loop_wind_high():
    bands = [(35, 130, 0.30, 0.7), (140, 480, 0.80, 0.9), (480, 1500, 0.95, 1.2), (1700, 5200, 0.80, 1.5), (5200, 12000, 0.42, 1.9)]
    return wind_loop(12.0, 302, bands, howl=(700, 1500, 0.34, 3), buffet=0.7, gust_depth=0.50)


# ------------------------------------------------------------------ 循环：披风
def loop_cloth():
    L = 8.0
    n = int(L * SR)
    rng = M.R(303)
    buf = np.zeros((2, n))
    tc = 0.04
    while tc < L - 0.03:
        m = int(SR * rng.uniform(0.035, 0.11))
        tt = np.arange(m) / SR
        fc = rng.uniform(180, 900)
        nz = M.unit(M.bp(rng.standard_normal(m + 300), fc * 0.5, fc * 2.2)[300:])
        a = min(rng.lognormal(-0.3, 0.5), 1.5)
        seg = nz * (1 - np.exp(-tt / 0.002)) * np.exp(-tt / rng.uniform(0.012, 0.035)) * a
        if rng.random() < 0.3:                          # 布边抽打的脆响
            k = min(m, int(SR * 0.012))
            ck = M.unit(M.bp(rng.standard_normal(k + 300), 1800, 5500)[300:]) * np.exp(-np.arange(k) / SR / 0.003)
            seg[:k] += ck * 0.5 * a
        seg *= np.clip((m - np.arange(m)) / (0.003 * SR), 0, 1)
        padd(buf, M.pan(seg, rng.uniform(-0.45, 0.45)), tc)
        tc += rng.uniform(0.045, 0.14) * (1.7 if rng.random() < 0.12 else 1.0)
    nz = pband(pnoise(n, rng, 0.4), 220, 1100)          # 连续的"猎猎"抖动层
    nz /= nz.std()
    rate = 12.5 + 3.0 * (2 * prand(n, L * 0.8, rng) - 1)
    ph = np.cumsum(rate) / SR
    ph *= round(ph[-1]) / ph[-1]                        # 一圈里整数次抖动
    flut = np.clip(np.sin(TWO_PI * ph), 0, 1) ** 2.5 * (0.5 + 0.5 * prand(n, L * 6.0, rng))
    buf += nz * flut * 0.55
    buf = pband(buf, 0, 3600)
    buf *= 0.70 + 0.45 * prand(n, L * 0.9, rng)
    return buf


# ------------------------------------------------------------------ 箫（单个乐句）
def xiao_phrase(notes, seed):
    """notes: [(起点秒, 频率), ..., (结束秒, None)]，连音。返回 (mono 片段, 片段起点秒)。"""
    rng = M.R(seed)
    real = notes[:-1]
    t_on, t_end = real[0][0], notes[-1][0]
    lead = 0.25
    n = int(SR * (t_end - t_on + lead + 0.7))
    tt = t_on - lead + np.arange(n) / SR
    f = np.full(n, real[0][1])
    for ton, fr in real[1:]:
        f[tt >= ton] = fr
    f = M.smooth(f, 0.07)                               # 连音之间的滑音
    cents = -45 * np.exp(-np.maximum(tt - t_on, 0) / 0.09)   # 起音从略低处滑上来
    vib_depth = np.zeros(n)
    gates, pts = [], [(t_on, 0.0)]
    for i, (ton, fr) in enumerate(real):
        toff = notes[i + 1][0]
        last = i == len(real) - 1
        vib_depth += min(9 + 3 * i, 15) * M.smooth(np.clip((tt - ton - 0.35) / 0.5, 0, 1) * (tt < toff), 0.05)
        gates.append(M.smooth(((tt >= ton - 0.03) & (tt < (toff + 0.5 if last else toff - 0.03))).astype(float), 0.04))
        hi = 0.78 + 0.07 * min(i, 3)
        pts += [(ton + 0.25, hi - 0.18), (max(ton + 0.32, toff - 0.30), hi), (toff - 0.05, hi - (0.05 if last else 0.16))]
    pts.append((t_end + 0.42, 0.0))
    vib_ph = TWO_PI * np.cumsum(4.7 + 0.5 * M.smooth_rand(n, 0.5, rng)) / SR
    cents += vib_depth * np.sin(vib_ph) + 5 * (M.smooth_rand(n, 2.0, rng) - 0.5)
    ph = TWO_PI * np.cumsum(f * 2 ** (cents / 1200)) / SR
    env = M.smooth(M.curve(pts, t=tt), 0.03)
    env_t = env * (1 + 0.06 * np.sin(vib_ph + 1.0) * vib_depth / 16) * (1 + 0.08 * (M.smooth_rand(n, 12.0, rng) - 0.5))
    tone = np.zeros(n)
    for h, a in enumerate([1.0, 0.40, 0.17, 0.07, 0.035, 0.015], 1):
        tone += a * np.sin(h * ph + rng.uniform(0, TWO_PI)) * env_t ** (1 + 0.35 * (h - 1))
    breath = np.zeros(n)                                # 在基频和二、三次谐波附近共振的气噪
    for (ton, fr), g in zip(real, gates):
        nz = rng.standard_normal(n)
        breath += (M.unit(M.bp(nz, fr * 0.97, fr * 1.03)) + 0.6 * M.unit(M.bp(nz, 2 * fr * 0.97, 2 * fr * 1.03))
                   + 0.35 * M.unit(M.bp(nz, 3 * fr * 0.97, 3 * fr * 1.03))) * g
    air = M.unit(M.bp(rng.standard_normal(n), 1800, 7500))
    turb = 0.6 + 0.4 * M.smooth_rand(n, 9.0, rng)
    env_b = np.interp(tt + 0.05, tt, env) + 0.5 * np.exp(-0.5 * ((tt - t_on - 0.07) / 0.06) ** 2)
    x = 0.8 * tone + breath * env_b * 0.33 * turb + air * env_b * 0.035 * turb
    return M.lp(x, 5000), t_on - lead


# ------------------------------------------------------------------ 循环：音乐床
def loop_music():
    L = 36.0
    n = int(L * SR)
    t = np.arange(n) / SR
    rng = M.R(310)
    bump = lambda c, w: np.exp(-0.5 * ((((t - c + L / 2) % L) - L / 2) / w) ** 2)       # 环形的高斯起伏
    # 低音长音：D2 为主，D1 垫底，中段上方五度 A2 涌入
    d2 = ptone_stack(n, 73.416, [0.85, 0.75, 0.58, 0.40, 0.24, 0.13], rng)
    d1 = ptone_stack(n, 36.708, [0.9, 0.40, 0.15], rng, noise_amt=0.3)
    a2 = ptone_stack(n, 110.0, [1.0, 0.50, 0.25, 0.12], rng)
    drone = d2 * (0.50 + 0.14 * prand(n, 5, rng)) + d1 * 0.13 + a2 * (0.10 + 0.50 * bump(20.0, 5.5))
    drone = np.tanh(1.3 * drone) / 1.3
    harm = pband(np.tanh(3.0 * drone + 0.2) - np.tanh(0.2), 100, 420)
    drone = 0.8 * pband(drone, 0, 950) + 0.85 * harm
    # 低弦铺底：D3 / A3，中段涌起
    pad_acc = np.zeros((2, n))
    for f0, amp, c, w in ((146.83, 1.0, 19.0, 6.0), (220.0, 0.8, 21.5, 5.0), (293.66, 0.45, 23.0, 3.5)):
        voice = np.zeros((2, n))
        for _ in range(6):
            f = qf(f0 * 2 ** (rng.uniform(-8, 8) / 1200), n)
            fv = qf(rng.uniform(4.6, 5.6), n)
            ph = TWO_PI * f * t + (rng.uniform(3, 7) / 1200 * np.log(2) * f / fv) * np.sin(TWO_PI * fv * t + rng.uniform(0, TWO_PI))
            s = np.zeros(n)
            h = 1
            while h * f0 < 3200:
                s += np.sin(h * ph + rng.uniform(0, TWO_PI)) / h ** 1.15
                h += 1
            voice += M.pan(s * amp / 6 * (0.85 + 0.3 * prand(n, L * 6.0, rng)), rng.uniform(-0.7, 0.7))
        pad_acc += voice * bump(c, w)
    pad = pband(pad_acc, 0, 1500)
    pad = pad + 0.6 * preverb(pad, M.IR_HALL)
    # 稀疏的大鼓（避开循环点）
    dry = np.zeros((2, n))
    for i, (t0, g, f0) in enumerate(((5.0, 0.55, 57.0), (14.0, 0.80, 53.0), (23.0, 0.50, 58.0), (23.9, 0.34, 60.0), (31.5, 0.68, 55.0))):
        padd(dry, M.pan(M.dagu(g, f0, seed=400 + i, bright=0.6 + 0.4 * g), rng.uniform(-0.2, 0.2)), t0)
    drums = dry + 0.30 * preverb(dry, M.IR_ROOM) + 0.30 * preverb(dry, M.IR_HALL)
    drums = drums + 1.0 * pband(drums, 200, 1200, order=1)                                  # 鼓腔中频：小喇叭上的"咚"
    tam = np.zeros((2, n))
    padd(tam, M.tamtam(410), 14.0, 0.8)
    tam = tam + 0.5 * preverb(tam, M.IR_HALL)
    # 偶尔的箫声长音
    xi = np.zeros((2, n))
    for notes, seed, p in (([(7.6, 293.66), (9.3, 349.23), (11.6, None)], 420, -0.2),
                           ([(25.6, 440.00), (27.0, 392.00), (28.3, 293.66), (30.9, None)], 421, 0.2)):
        seg, t0 = xiao_phrase(notes, seed)
        padd(xi, M.pan(seg, p), t0)
    xi = 0.75 * xi + 0.55 * preverb(xi, M.IR_HALL)
    mix = 0.165 * drone + 0.165 * pad + 0.30 * drums + 0.10 * tam + 0.19 * xi
    return pband(mix, 32, 0, order=4)


# ------------------------------------------------------------------ 单次类
def finish(x, peak_db=SFX_PEAK_DB, fade=0.04):
    x = np.atleast_2d(x)
    if x.shape[0] == 1:
        x = np.repeat(x, 2, axis=0)
    x = M.hp(x, 30.0)
    n = x.shape[1]
    k = int(fade * SR)
    x[:, -k:] *= 0.5 * (1 + np.cos(np.pi * np.arange(k) / k))
    x[:, :48] *= np.linspace(0, 1, 48)
    return x / np.abs(x).max() * 10 ** (peak_db / 20)


def kick(tt, t0, f_hi, f_lo, tau, drop=0.07):
    """低频"推背"一击：音高下坠的正弦 + 并行饱和出来的 90–340 Hz 谐波。"""
    ti = np.maximum(tt - t0, 0)
    on = tt >= t0
    k = np.sin(TWO_PI * np.cumsum(f_lo + (f_hi - f_lo) * np.exp(-ti / drop)) / SR) * np.exp(-ti / tau) * (1 - np.exp(-ti / 0.004)) * on
    k = np.tanh(1.6 * k)
    return k + 0.55 * M.bp(np.tanh(4.0 * k), 90, 340) * np.exp(-ti / (tau * 0.7))


def sfx_boost():
    """加速冲刺：气流猛地上扫 + 低频推背。"""
    rng = M.R(201)
    n = int(SR * 2.4)
    tt = np.arange(n) / SR
    r = np.clip(tt / 0.22, 0, 1)
    fc = 260 * (3600 / 260) ** (r ** 0.8) * np.exp(-np.maximum(tt - 0.22, 0) / 2.6)
    env = np.where(tt < 0.22, r ** 1.5, 0.55 * np.exp(-(tt - 0.22) / 0.28) + 0.45 * np.exp(-(tt - 0.22) / 0.85))
    wide = np.stack([M.unit(M.swept_noise(rng.standard_normal(n), fc, 2.0)) for _ in range(2)])
    jet = M.unit(M.swept_noise(rng.standard_normal(n), np.clip(fc * 0.55, 200, 5000), 0.30))
    air = M.bp(M.st_noise(n, rng, 0.2), 5000, 13000)
    air = air / air.std() * np.exp(-0.5 * ((tt - 0.23) / 0.06) ** 2)
    ti = np.maximum(tt - 0.03, 0)
    thump = M.unit(M.bp(rng.standard_normal(n), 140, 620)) * np.exp(-ti / 0.10) * (tt >= 0.03)
    x = wide * env * 0.9 + jet * env * 0.5 + air * 0.4 + kick(tt, 0.03, 82, 42, 0.42) * 0.9 + thump * 0.6
    return finish(x + 0.2 * M.reverb(x, M.IR_ROOM))


def sfx_flip():
    """翻筋斗：两下旋转的呼啸，声像左右甩一圈。"""
    rng = M.R(202)
    n = int(SR * 1.5)
    tt = np.arange(n) / SR
    g1, g2 = np.exp(-0.5 * ((tt - 0.30) / 0.11) ** 2), np.exp(-0.5 * ((tt - 0.80) / 0.13) ** 2)
    env = 0.85 * g1 + 1.0 * g2
    fc = 650 + 1900 * g1 + 2400 * g2
    wide = np.stack([M.unit(M.swept_noise(rng.standard_normal(n), fc, 1.7)) for _ in range(2)])
    tone = M.unit(M.swept_noise(rng.standard_normal(n), fc * 0.5, 0.3))
    low = M.unit(M.bp(rng.standard_normal(n), 90, 380))
    mono = (0.6 * tone + 0.7 * low) * env
    p = 0.75 * np.sin(TWO_PI * (tt - 0.05) / 1.0)       # 一圈：左 → 右 → 左
    a = (p + 1) * np.pi / 4
    x = wide * env * np.stack([np.cos(a), np.sin(a)]) * 1.3 + M.pan(mono, p * 0.6)
    return finish(x + 0.2 * M.reverb(x, M.IR_ROOM))


def sfx_whoosh_pass(seed, dur, f_body, sg, f_air):
    """擦着石峰掠过：风压的"呼" + 带多普勒的气流。声像居中，由引擎决定左右。"""
    rng = M.R(seed)
    n = int(SR * dur)
    tt = np.arange(n) / SR
    c = dur * 0.40
    env = np.exp(-0.5 * ((tt - c) / np.where(tt < c, sg, sg * 1.6)) ** 2)
    dop = 1.0 - 0.32 * np.tanh((tt - c) / (sg * 0.8))
    low = M.unit(M.bp(rng.standard_normal(n + 600), 70, 300)[600:])
    body = np.stack([M.unit(M.swept_noise(rng.standard_normal(n), f_body * dop, 1.4, fmin=120, fmax=6000, nb=18)) for _ in range(2)])
    air = np.stack([M.unit(M.swept_noise(rng.standard_normal(n), f_air * dop, 1.2, fmin=300, fmax=12000, nb=16)) for _ in range(2)])
    x = (0.8 * low + 0.9 * body + 0.45 * air) * env
    return finish(x + 0.18 * M.reverb(x, M.IR_ROOM))


def chime(f0, dur, seed, bright=1.0):
    """磬/钟一样清亮的一击：非谐泛音，每个泛音是一对略微失谐的分音（有拍频），高频衰减更快。"""
    rng = M.R(seed)
    n = int(SR * dur)
    tt = np.arange(n) / SR
    out = np.zeros((2, n))
    for ratio, amp, tau in ((0.5, 0.16, 1.5), (1.0, 1.0, 1.35), (2.0, 0.42, 0.95), (2.76, 0.50, 0.70), (4.07, 0.30, 0.48),
                            (5.40, 0.20 * bright, 0.36), (6.80, 0.13 * bright, 0.27), (8.90, 0.08 * bright, 0.19), (11.3, 0.04 * bright, 0.13)):
        f = f0 * ratio
        if f > 15000:
            continue
        for sgn in (-1, 1):
            s = np.sin(TWO_PI * f * (1 + sgn * 0.0012) * tt + rng.uniform(0, TWO_PI)) * np.exp(-tt / tau) * amp * 0.5
            out += M.pan(s, sgn * 0.35)
    out *= 1 - np.exp(-tt / 0.0012)
    strike = M.bp(M.st_noise(n, rng, 0.3), 2000, 9000)
    out += strike / strike.std() * 0.22 * bright * np.exp(-tt / 0.006)
    return out


PENTA = (587.33, 698.46, 783.99, 880.00, 1046.50, 1174.66)     # D5 F5 G5 A5 C6 D6


def sfx_hoop(step=0):
    """穿过金环。step=0 是基础的一击（磬 + 轻鼓）；1..5 是连续穿环时沿五声音阶逐级上行。"""
    dur = 2.3
    n = int(SR * dur)
    x = chime(PENTA[step], dur, 500 + step, bright=1.0 + 0.08 * step)
    if step >= 3:                                       # 高连击：叠一个晚 60 ms 的高八度
        o = chime(PENTA[step] * 2, dur - 0.06, 520 + step, bright=0.8)
        x[:, int(0.06 * SR):] += 0.28 * o
    d = M.dagu(1.0, 64.0 if step == 0 else 70.0, seed=540 + step, bright=0.8)[:n]
    d = d * np.exp(-np.arange(len(d)) / SR / 0.22)
    x[:, :len(d)] += d * (0.40 if step == 0 else (0.34 if step == 5 else 0.16))
    return finish(x + 0.30 * M.reverb(x, M.IR_HALL))


def sfx_hit():
    """撞山：闷响 + 碎石。"""
    rng = M.R(203)
    n = int(SR * 1.9)
    tt = np.arange(n) / SR
    x = np.zeros((2, n))
    body = M.unit(M.bp(rng.standard_normal(n), 110, 720)) * np.exp(-tt / 0.085)
    crack = M.unit(M.bp(rng.standard_normal(n), 1400, 6500)) * np.exp(-tt / 0.014)
    x += kick(tt, 0.0, 95, 44, 0.24, drop=0.05) * 0.55 + body * 1.1 + crack * 0.75
    x += M.unit(M.bp(rng.standard_normal(n), 300, 1500)) * np.exp(-tt / 0.05) * 0.7          # 岩石的"砰"
    for _ in range(46):                                 # 碎石：越往后越稀、越轻
        t0 = 0.04 + rng.exponential(0.32)
        if t0 > 1.5:
            continue
        m = int(SR * rng.uniform(0.008, 0.045))
        fc = rng.uniform(600, 5200)
        g = M.unit(M.bp(rng.standard_normal(m + 200), fc * 0.75, fc * 1.35)[200:]) * np.exp(-np.arange(m) / SR / rng.uniform(0.004, 0.014))
        i0 = int(t0 * SR)
        if i0 + m < n:
            x[:, i0:i0 + m] += M.pan(g * rng.uniform(0.35, 0.9) * np.exp(-t0 / 0.6), rng.uniform(-0.7, 0.7))
    grit = M.unit(M.bp(rng.standard_normal(n), 220, 1400)) * np.exp(-tt / 0.33) * (0.35 + 0.65 * M.smooth_rand(n, 22.0, rng) ** 2)
    x += grit * 0.6
    return finish(x + 0.25 * M.reverb(x, M.IR_ROOM))


def sfx_cloud_dive():
    """钻进云海：一下被闷住的"噗"。"""
    rng = M.R(204)
    n = int(SR * 1.8)
    tt = np.arange(n) / SR
    fc = 260 + 4200 * np.exp(-tt / 0.16)
    env = (1 - np.exp(-tt / 0.03)) * (0.6 * np.exp(-tt / 0.22) + 0.4 * np.exp(-tt / 0.6))
    wide = np.stack([M.unit(M.swept_noise(rng.standard_normal(n), fc, 2.4)) for _ in range(2)])
    muff = M.unit(M.bp(M.st_noise(n, rng, 0.2), 150, 520)) * (1 - np.exp(-tt / 0.08)) * np.exp(-tt / 0.55)
    x = wide * env + 0.55 * muff + kick(tt, 0.02, 92, 50, 0.36) * 0.8
    return finish(x + 0.3 * M.lp(M.reverb(x, M.IR_HALL), 1200))


def sfx_ui_click():
    rng = M.R(205)
    n = int(SR * 0.14)
    tt = np.arange(n) / SR
    x = np.zeros(n)
    for f, a, tau in ((1250, 1.0, 0.012), (1980, 0.6, 0.008), (2900, 0.35, 0.005)):
        x += a * np.sin(TWO_PI * f * tt) * np.exp(-tt / tau)
    x += 0.4 * M.unit(M.bp(rng.standard_normal(n), 2000, 7000)) * np.exp(-tt / 0.003)
    return finish(x, peak_db=-8.0, fade=0.02)


LOOPS = dict(wind_low=loop_wind_low, wind_high=loop_wind_high, cloth_loop=loop_cloth, music_bed=loop_music)
SFX = dict(boost=sfx_boost, flip=sfx_flip,
           whoosh_pass_1=lambda: sfx_whoosh_pass(211, 1.0, 520, 0.075, 2400),
           whoosh_pass_2=lambda: sfx_whoosh_pass(212, 1.25, 380, 0.105, 1700),
           whoosh_pass_3=lambda: sfx_whoosh_pass(213, 0.8, 680, 0.055, 3200),
           hoop=lambda: sfx_hoop(0),
           hoop_combo_1=lambda: sfx_hoop(1), hoop_combo_2=lambda: sfx_hoop(2), hoop_combo_3=lambda: sfx_hoop(3),
           hoop_combo_4=lambda: sfx_hoop(4), hoop_combo_5=lambda: sfx_hoop(5),
           hit=sfx_hit, cloud_dive=sfx_cloud_dive, ui_click=sfx_ui_click)


# ------------------------------------------------------------------ 输出与验证
def write_wav(name, x, seed):
    assert x.shape[0] == 2 and np.isfinite(x).all(), name
    d = (M.R(seed).random(x.shape) - M.R(seed + 1).random(x.shape)) / 32768.0
    pcm = np.clip(np.round((x + d) * 32767.0), -32768, 32767).astype(np.int16)
    path = os.path.join(OUT, name + '.wav')
    wavfile.write(path, SR, pcm.T)
    return path


def read_wav(name):
    sr, d = wavfile.read(os.path.join(OUT, name + '.wav'))
    assert sr == SR and d.dtype == np.int16 and d.ndim == 2 and d.shape[1] == 2, name
    return d.astype(np.float64).T / 32768.0


def low_share(x):
    X = np.abs(np.fft.rfft(x.mean(0))) ** 2
    f = np.fft.rfftfreq(x.shape[1], 1.0 / SR)
    return float(X[f < 200].sum() / X.sum())


def loop_check(x, frame=2400):
    """循环点验证：把首尾拼接处和文件中部的所有相邻处放在同一把尺子上比。
    波形：拼接处的一阶差分 |x[0]−x[−1]|、二阶差分，与全文件相邻采样差分的分布比较。
    频谱：以拼接处为中心的一帧，与它左右两帧平均值的对数谱距离（1/3 倍频程带，100 Hz–12 kHz），
          与文件里所有同样取法的"某帧 vs 左右两帧"的距离分布比较。"""
    n = x.shape[1]
    d1 = np.abs(np.diff(x, axis=1)).max(axis=0)
    seam1 = float(np.abs(x[:, 0] - x[:, -1]).max())
    d2 = np.abs(x[:, 2:] - 2 * x[:, 1:-1] + x[:, :-2]).max(axis=0)
    seam2 = float(max(np.abs(x[:, 0] - 2 * x[:, -1] + x[:, -2]).max(), np.abs(x[:, 1] - 2 * x[:, 0] + x[:, -1]).max()))
    y = np.roll(x.mean(0), frame // 2)                  # 让第 0 帧正好以拼接处为中心
    nf = n // frame
    fr = y[:nf * frame].reshape(nf, frame) * np.hanning(frame)
    P = np.abs(np.fft.rfft(fr, axis=1)) ** 2
    f = np.fft.rfftfreq(frame, 1.0 / SR)
    edges = 100 * 2 ** (np.arange(0, 22) / 3.0)
    B = np.stack([P[:, (f >= a) & (f < b)].sum(axis=1) for a, b in zip(edges[:-1], edges[1:])], axis=1)
    LB = 10 * np.log10(B + 1e-12)
    dist = np.sqrt(((LB - 0.5 * (np.roll(LB, 1, axis=0) + np.roll(LB, -1, axis=0))) ** 2).mean(axis=1))
    tail = n - nf * frame                               # 不足一帧的余数会让最后一帧与第 0 帧不相邻，只在整除时成立
    hf = M.hp(np.concatenate([x[:, -4800:], x[:, :4800]], axis=1), 6000.0)
    w = 240
    e = np.array([np.sqrt((hf[:, i:i + w] ** 2).mean()) for i in range(1200, hf.shape[1] - w, w // 2)])
    k_seam = (4800 - 1200) // (w // 2) - 1
    return dict(seam_d1=seam1, d1_rms=float(np.sqrt((np.diff(x, axis=1) ** 2).mean())), d1_p999=float(np.percentile(d1, 99.9)),
                seam_d2=seam2, d2_p999=float(np.percentile(d2, 99.9)),
                spec_seam=float(dist[0]), spec_med=float(np.median(dist[1:])), spec_p95=float(np.percentile(dist[1:], 95)),
                spec_rank=float((dist[1:] < dist[0]).mean()), frames=int(nf), remainder=int(tail),
                hf_seam_db=float(db(e[k_seam:k_seam + 2].max())), hf_med_db=float(db(np.median(e))), hf_max_db=float(db(e.max())))


def main():
    only = None
    for i, a in enumerate(sys.argv):
        if a == '--only':
            only = set(sys.argv[i + 1].split(','))
    os.makedirs(OUT, exist_ok=True)
    if '--check' not in sys.argv:
        for k, (name, fn) in enumerate(LOOPS.items()):
            if only and name not in only:
                continue
            x = fn()
            x = x * 10 ** ((LOOP_LUFS - M.lufs(x)) / 20)
            pk = np.abs(x).max()
            if pk > 0.84:                               # 无记忆软削波，不破坏周期性
                x = np.tanh(x / 0.84) * 0.84
                x = x * 10 ** ((LOOP_LUFS - M.lufs(x)) / 20)
            write_wav(name, x, 900 + 2 * k)
            print('生成', name, '%.1fs' % (x.shape[1] / SR), flush=True)
        for k, (name, fn) in enumerate(SFX.items()):
            if only and name not in only:
                continue
            write_wav(name, fn(), 950 + 2 * k)
            print('生成', name, flush=True)
    manifest, total = {}, 0
    print('\n名称              时长(s)  体积(KB)  LUFS   峰值dBFS  200Hz以下')
    for name in list(LOOPS) + list(SFX):
        p = os.path.join(OUT, name + '.wav')
        if not os.path.exists(p):
            print('缺少', name)
            continue
        x = read_wav(name)
        size = os.path.getsize(p)
        total += size
        dur = x.shape[1] / SR
        lu = float(M.lufs(x)) if dur >= 0.5 else None
        info = dict(file=name + '.wav', kind='loop' if name in LOOPS else 'sfx', duration=round(dur, 4), bytes=size,
                    lufs=None if lu is None else round(lu, 1), peak_db=round(float(db(np.abs(x).max())), 1), below_200hz=round(low_share(x), 3))
        manifest[name] = info
        print('%-17s %6.2f  %8d  %5s  %7.1f   %5.1f%%' % (name, dur, size // 1024, '-' if lu is None else '%.1f' % lu, info['peak_db'], 100 * info['below_200hz']))
    print('合计 %.1f MB，%d 个文件' % (total / 1e6, len(manifest)))
    print('\n循环点验证（拼接处 vs 文件中部相邻处）')
    for name in LOOPS:
        if name not in manifest:
            continue
        c = loop_check(read_wav(name))
        manifest[name]['loop_check'] = {k: (round(v, 5) if isinstance(v, float) else v) for k, v in c.items()}
        print('%-11s 波形差: 拼接处 %.4f | 全文件RMS %.4f, 99.9%%分位 %.4f || 二阶差: 拼接处 %.4f | 99.9%%分位 %.4f' % (
            name, c['seam_d1'], c['d1_rms'], c['d1_p999'], c['seam_d2'], c['d2_p999']))
        print('%-11s 频谱差(dB): 拼接帧 %.2f | 中位 %.2f, 95%%分位 %.2f, 拼接帧排在 %.0f%% 分位（共 %d 帧，余数 %d）|| 6kHz以上能量(dB): 拼接处 %.1f | 中位 %.1f, 最大 %.1f' % (
            '', c['spec_seam'], c['spec_med'], c['spec_p95'], 100 * c['spec_rank'], c['frames'], c['remainder'], c['hf_seam_db'], c['hf_med_db'], c['hf_max_db']))
    json.dump(manifest, open(os.path.join(OUT, 'manifest.json'), 'w'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
