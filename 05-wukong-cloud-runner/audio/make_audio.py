"""纯代码合成的配乐和音效（numpy）：五声音阶旋律（笛）+ 拨弦分解和弦 + 鼓点；风声、掠过声、水花、穿云重音。
时间轴（30fps）：S1 0-4s 穿峰 | S3 4-8s 高空特写 | S2 8-14s 桃花坡 | S4 14-18s 江面 | S5 18-22s 湖面 | S5B 22-24s 正面 | S6 24-29s 冲天（26.0s 穿云）
用法：python make_audio.py <out.wav>
"""
import sys, wave
import numpy as np
from scipy import signal

SR = 48000
BPM = 120.0
BEAT = 60.0 / BPM
BAR = 4 * BEAT
TOTAL = 29.0
N = int(SR * (TOTAL + 0.5))
rng = np.random.RandomState(20261121)


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12.0)


def place(buf, sig, t, gain=1.0, pan=0.0):
    i = int(t * SR)
    if i >= N:
        return
    sig = sig[:max(0, N - i)]
    l = gain * np.sqrt(0.5 * (1 - pan))
    r = gain * np.sqrt(0.5 * (1 + pan))
    buf[i:i + len(sig), 0] += sig * l
    buf[i:i + len(sig), 1] += sig * r


def env_adsr(n, a=0.02, d=0.05, s=0.8, r=0.08):
    t = np.arange(n) / SR
    dur = n / SR
    e = np.ones(n) * s
    e = np.where(t < a, t / a, e)
    e = np.where((t >= a) & (t < a + d), 1 - (1 - s) * (t - a) / d, e)
    rel = np.clip((dur - t) / r, 0, 1)
    return e * rel


def flute(m, dur, vib=True):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = hz(m)
    scoop = 1 - 0.012 * np.exp(-t / 0.03)
    vibr = 1 + (0.006 * np.sin(2 * np.pi * 5.6 * t) * np.clip((t - 0.10) / 0.15, 0, 1) if vib else 0)
    ph = 2 * np.pi * np.cumsum(f * scoop * vibr) / SR
    x = np.sin(ph) + 0.42 * np.sin(2 * ph) + 0.16 * np.sin(3 * ph) + 0.06 * np.sin(4 * ph)
    br = rng.randn(n)
    sos = signal.butter(2, [f * 1.5 / (SR / 2), min(0.9, f * 6 / (SR / 2))], btype='band', output='sos')
    br = signal.sosfilt(sos, br) * 0.10
    return (x + br) * env_adsr(n, a=0.035, d=0.06, s=0.82, r=min(0.09, dur * 0.4)) * 0.5


def pluck(m, dur=1.2, bright=1.0):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = hz(m)
    x = np.zeros(n)
    for k in range(1, 14):
        fk = f * k * (1 + 0.0004 * k * k)
        if fk > SR * 0.45:
            break
        amp = (1.0 / k) * (1.0 if k % 2 else 0.75) * bright ** (k - 1)
        x += amp * np.exp(-t * (2.2 + 1.3 * k)) * np.sin(2 * np.pi * fk * t + rng.uniform(0, 0.3))
    att = np.clip(t / 0.003, 0, 1)
    return x * att * 0.5


def kick():
    n = int(0.32 * SR)
    t = np.arange(n) / SR
    f = 52 + 90 * np.exp(-t / 0.035)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-t / 0.11) + 0.25 * rng.randn(n) * np.exp(-t / 0.004)


def tom(f0=150):
    n = int(0.28 * SR)
    t = np.arange(n) / SR
    f = f0 * (1 + 0.5 * np.exp(-t / 0.03))
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-t / 0.08)


def block(f0=1150):
    n = int(0.09 * SR)
    t = np.arange(n) / SR
    return (np.sin(2 * np.pi * f0 * t) + 0.6 * np.sin(2 * np.pi * f0 * 1.52 * t)) * np.exp(-t / 0.016)


def shaker():
    n = int(0.06 * SR)
    t = np.arange(n) / SR
    x = rng.randn(n)
    sos = signal.butter(2, 6000 / (SR / 2), btype='high', output='sos')
    return signal.sosfilt(sos, x) * np.exp(-t / 0.018)


def chime(m, dur=0.9):
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = hz(m)
    return (np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * f * 2.76 * t) + 0.15 * np.sin(2 * np.pi * f * 5.4 * t)) * np.exp(-t / 0.22) * np.clip(t / 0.002, 0, 1)


def gong(dur=3.2):
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = np.zeros(n)
    for f, a, d in ((146.8, 1.0, 1.3), (220.0, 0.6, 1.1), (293.7, 0.5, 0.9), (371.0, 0.3, 0.8), (440.0, 0.35, 0.8), (587.3, 0.3, 0.6),
                    (880.0, 0.2, 0.45), (1174.7, 0.15, 0.35), (1760.0, 0.1, 0.3)):
        x += a * np.sin(2 * np.pi * f * t + rng.uniform(0, 6.28)) * np.exp(-t / d)
    sh = rng.randn(n)
    sos = signal.butter(2, 3500 / (SR / 2), btype='high', output='sos')
    x += 0.5 * signal.sosfilt(sos, sh) * np.exp(-t / 0.55)
    return x * np.clip(t / 0.004, 0, 1) * 0.35


def noise_band(n, lo, hi, order=2):
    x = rng.randn(n)
    sos = signal.butter(order, [lo / (SR / 2), hi / (SR / 2)], btype='band', output='sos')
    return signal.sosfilt(sos, x)


def whoosh(dur=0.7, f0=400, f1=3000, peak=0.6):
    """掠过声：带通噪声，中心频率扫动，幅度先升后降。"""
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = rng.randn(n)
    out = np.zeros(n)
    nb = 8
    for b in range(nb):
        a, c = b / nb, (b + 1) / nb
        fc = f0 * (f1 / f0) ** ((a + c) / 2)
        sos = signal.butter(2, [fc * 0.6 / (SR / 2), min(0.95, fc * 1.6 / (SR / 2))], btype='band', output='sos')
        seg = signal.sosfilt(sos, x)
        w = np.exp(-((t / dur - (a + c) / 2) / (1.2 / nb)) ** 2)
        out += seg * w
    env = np.exp(-((t / dur - peak) / 0.22) ** 2)
    return out * env


music = np.zeros((N, 2))
sfx = np.zeros((N, 2))

# ------------------------------------------------------------------ 旋律（八分音符，0=休止）
R = 0
mel = [
    [R, R, R, R, 81, 83, 86, 88],          # 1  S1 引子
    [90, R, 88, 86, 83, 86, 88, R],        # 2
    [74, R, R, 76, 78, R, R, R],           # 3  S3 高空特写：轻柔
    [81, R, R, 78, 76, R, 74, R],          # 4
    [81, R, 78, 76, 74, 76, 78, 81],       # 5  S2 桃花坡：主题
    [83, R, 81, 78, 76, R, R, R],          # 6
    [74, 76, 78, 81, 83, 81, 78, 76],      # 7
    [86, R, 83, 81, 83, R, 86, R],         # 8  S4 江面
    [88, 86, 83, 81, 83, R, R, R],         # 9
    [81, 83, 86, 83, 81, 78, 76, 78],      # 10 S5 湖面
    [81, R, 86, R, 88, 86, 83, 81],        # 11
    [78, 81, 83, 86, 88, R, 90, R],        # 12 S5B 正面
]
QUIET = (2, 3)
EI = BEAT / 2
for b, bar in enumerate(mel):
    i = 0
    while i < 8:
        m = bar[i]
        if m == R:
            i += 1
            continue
        j = i + 1
        # 后面是休止就延长一点
        ln = 1.0
        if j < 8 and bar[j] == R:
            ln = 1.9
        soft = 0.75 if b in QUIET else 1.0
        place(music, flute(m, EI * ln * 0.96), b * BAR + i * EI, gain=0.36 * soft, pan=0.08)
        i += 1
# 13 小节：十六分音符上行跑动（冲天）
run = [62, 64, 66, 69, 71, 74, 76, 78, 81, 83, 86, 88, 90, 93, 95, 98]
for i, m in enumerate(run):
    place(music, flute(m, BEAT / 4 * 1.1, vib=False), 12 * BAR + i * BEAT / 4, gain=0.24 + 0.012 * i, pan=0.05)
    place(music, pluck(m, 0.5, 0.9), 12 * BAR + i * BEAT / 4, gain=0.22, pan=-0.2)
# 14 小节：穿云重音 + 高音长音
T_HIT = 13 * BAR                      # 26.0 s
for m, g in ((98, 0.30), (93, 0.22), (86, 0.18)):
    place(music, flute(m, 2.4), T_HIT, gain=g, pan=0.1)
for m in (38, 50, 57, 62, 66, 69, 74):
    place(music, pluck(m, 2.8, 1.0), T_HIT, gain=0.5, pan=rng.uniform(-0.4, 0.4))
place(music, gong(3.2), T_HIT, gain=0.9)
for k, m in enumerate((86, 90, 93, 98, 102, 98, 93, 90)):
    place(music, chime(m, 1.2), T_HIT + 0.12 + 0.11 * k, gain=0.14, pan=rng.uniform(-0.6, 0.6))

# ------------------------------------------------------------------ 分解和弦 + 低音
CH = {'D': [50, 57, 62, 66, 69], 'Bm': [47, 54, 59, 62, 66], 'G': [43, 50, 55, 59, 62], 'A': [45, 52, 57, 59, 64]}
prog = ['D', 'D', 'G', 'A', 'D', 'Bm', 'G', 'D', 'Bm', 'G', 'A', 'A', 'A']
pat = [0, 2, 3, 4, 3, 2, 3, 4]
for b, c in enumerate(prog):
    tones = CH[c]
    quiet = 0.6 if b in QUIET else 1.0
    for i in range(8):
        if b == 0 and i < 4:
            continue
        m = tones[pat[i]] + 12
        place(music, pluck(m, 0.9, 0.85), b * BAR + i * EI, gain=0.20 * quiet, pan=-0.35 + 0.1 * (i % 3))
    for beat in (0, 2):
        if b == 0 and beat == 0:
            continue
        place(music, pluck(tones[0] - 12, 1.2, 0.6), b * BAR + beat * BEAT, gain=0.30 * quiet)
# 引子：古筝式刮奏
gl = [50, 52, 54, 57, 59, 62, 64, 66, 69, 71, 74, 76, 78, 81, 83, 86]
for i, m in enumerate(gl):
    place(music, pluck(m, 1.4, 0.95), 0.05 + i * 0.052, gain=0.26, pan=-0.6 + 1.2 * i / len(gl))

# ------------------------------------------------------------------ 鼓点
for b in range(13):
    quiet = b in QUIET
    for beat in range(4):
        t = b * BAR + beat * BEAT
        if b == 0 and beat < 2:
            continue
        if beat in (0, 2) and not quiet:
            place(music, kick(), t, gain=0.42)
        if beat in (1, 3):
            place(music, block(1150 if beat == 1 else 980), t, gain=0.16 if not quiet else 0.09, pan=0.3)
        for e in (0, 1):
            place(music, shaker(), t + e * EI, gain=(0.10 if e else 0.06) * (0.5 if quiet else 1.0), pan=-0.3)
    # 每个镜头切换前的小过门
    if b in (1, 3, 6, 8, 10, 11):
        for k, f0 in enumerate((210, 170, 135)):
            place(music, tom(f0), (b + 1) * BAR - (3 - k) * BEAT / 2, gain=0.4, pan=-0.3 + 0.3 * k)
for k in range(8):
    place(music, tom(120 + 14 * k), 12 * BAR + BAR / 2 + k * BEAT / 4, gain=0.25 + 0.04 * k, pan=-0.4 + 0.1 * k)

# ------------------------------------------------------------------ 音效
# 风声底噪：强度按镜头变化
cuts = [0, 4, 8, 14, 18, 22, 24, 29]
wind_lv = [0.9, 0.4, 0.75, 0.8, 0.8, 0.6, 1.0]
t_all = np.arange(N) / SR
lv = np.zeros(N)
for i in range(len(wind_lv)):
    lv += wind_lv[i] * ((t_all >= cuts[i]) & (t_all < cuts[i + 1]))
lv = signal.sosfilt(signal.butter(1, 3.0 / (SR / 2), output='sos'), lv)
for ch in (0, 1):
    w = noise_band(N, 180, 1800) * 1.0 + noise_band(N, 1800, 6000) * 0.35
    lfo = 1 + 0.35 * np.sin(2 * np.pi * 0.31 * t_all + ch * 1.3) + 0.2 * np.sin(2 * np.pi * 1.1 * t_all + ch * 2.1)
    sfx[:, ch] += w * lfo * lv * 0.055
# 切镜头的掠过声
for i, t in enumerate(cuts[:-1]):
    place(sfx, whoosh(0.9, 300, 3500, 0.55), max(0, t - 0.45), gain=0.20, pan=(-0.5 if i % 2 else 0.5))
# S1 穿峰：两次擦过山峰
for t, p in ((1.3, -0.7), (2.7, 0.7)):
    place(sfx, whoosh(0.55, 500, 2500, 0.5), t, gain=0.16, pan=p)
# S2/S3 花瓣：零星的清脆铃音
for t in np.sort(rng.uniform(8.3, 13.7, size=14)):
    place(sfx, chime(int(rng.choice([86, 88, 90, 93, 95, 98])), 0.7), float(t), gain=0.05, pan=rng.uniform(-0.8, 0.8))
# S4/S5 水面：入水的哗啦 + 持续的水花嘶声
n = int(10.0 * SR)
hiss = noise_band(n, 2500, 9000) * (0.7 + 0.3 * np.abs(signal.sosfilt(signal.butter(1, 9 / (SR / 2), output='sos'), rng.randn(n)) * 30))
edge = np.clip(np.arange(n) / (0.3 * SR), 0, 1) * np.clip((n - np.arange(n)) / (0.5 * SR), 0, 1)
place(sfx, hiss * edge, 14.0, gain=0.035, pan=0.0)
for t in (14.0, 18.0):
    sp = noise_band(int(0.9 * SR), 600, 7000) * np.exp(-np.arange(int(0.9 * SR)) / SR / 0.22)
    place(sfx, sp, t + 0.05, gain=0.16)
for t, p in ((19.2, -0.6), (20.6, 0.6), (23.2, -0.5)):       # 擦过湖中石柱
    place(sfx, whoosh(0.6, 400, 2600, 0.5), t, gain=0.16, pan=p)
# S6 冲天：上升音 + 穿云
n = int(2.0 * SR)
t = np.arange(n) / SR
f = 160 * (2 ** (t / 2.0 * 3.2))
riser = np.sin(2 * np.pi * np.cumsum(f) / SR) * (t / 2.0) ** 2 * 0.5 + noise_band(n, 800, 7000) * (t / 2.0) ** 2.5 * 0.6
place(sfx, riser, 24.0, gain=0.22)
place(sfx, whoosh(1.4, 200, 5000, 0.25), T_HIT - 0.3, gain=0.34)
boom = np.sin(2 * np.pi * np.cumsum(70 * np.exp(-np.arange(int(0.8 * SR)) / SR / 0.3) + 35) / SR) * np.exp(-np.arange(int(0.8 * SR)) / SR / 0.25)
place(sfx, boom, T_HIT, gain=0.5)

# S4 侧滚（16.2-17.1 s）和 S6 空翻（26.6-27.6 s）的旋转呼啸
place(sfx, whoosh(0.9, 500, 4200, 0.5), 14.0 + 66 / 30.0, gain=0.20, pan=-0.2)
place(sfx, whoosh(0.5, 900, 3000, 0.5), 14.0 + 78 / 30.0, gain=0.10, pan=0.4)
place(sfx, whoosh(1.0, 600, 5000, 0.5), 24.0 + 76 / 30.0, gain=0.20, pan=0.2)
place(sfx, whoosh(1.1, 300, 2500, 0.3), 24.0 + 110 / 30.0, gain=0.22, pan=0.0)      # 最后加速飞远
# S3 仙鹤掠过：两声清亮的鹤鸣（滑音）
for t0, f0, f1 in ((5.1, 1250, 980), (5.55, 1320, 1020), (6.4, 1180, 940)):
    n_ = int(0.22 * SR); tt = np.arange(n_) / SR
    fr = f0 + (f1 - f0) * (tt / 0.22) ** 0.6
    ph_ = 2 * np.pi * np.cumsum(fr) / SR
    call = (np.sin(ph_) + 0.5 * np.sin(2 * ph_) + 0.25 * np.sin(3 * ph_)) * np.sin(np.pi * tt / 0.22) ** 0.8
    place(sfx, call, t0, gain=0.035, pan=0.5)

# 收尾：飞远后天边“叮”的一闪（28.23 s）
for m, g_, d_ in ((105, 0.22, 0.0), (110, 0.16, 0.0), (117, 0.10, 0.03), (112, 0.08, 0.09)):
    place(sfx, chime(m, 1.1), 24.0 + 133 / 30.0 + d_, gain=g_, pan=0.15)

# ------------------------------------------------------------------ 混音
mix = music * 0.9 + sfx * 1.0
# 简单的房间感：几个短延迟
for d, g in ((0.031, 0.18), (0.047, 0.14), (0.083, 0.10), (0.127, 0.07)):
    k = int(d * SR)
    mix[k:, 0] += music[:-k, 1] * g
    mix[k:, 1] += music[:-k, 0] * g
fade = np.clip(t_all / 0.08, 0, 1) * np.clip((TOTAL + 0.3 - t_all) / 0.9, 0, 1)
mix *= fade[:, None]
mix = mix[:int(SR * (TOTAL + 0.3))]
peak = np.max(np.abs(mix))
mix = np.tanh(mix / peak * 1.35) / np.tanh(1.35) * 0.89
rms = np.sqrt(np.mean(mix ** 2))
print('AUDIO dur %.2fs peak %.3f rms %.3f nan %s' % (len(mix) / SR, np.max(np.abs(mix)), rms, np.isnan(mix).any()))
out = sys.argv[1]
with wave.open(out, 'wb') as wf:
    wf.setnchannels(2); wf.setsampwidth(2); wf.setframerate(SR)
    wf.writeframes((mix * 32767).astype('<i2').tobytes())
