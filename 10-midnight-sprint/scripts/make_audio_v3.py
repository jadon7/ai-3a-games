#!/usr/bin/env python3
"""全部音频用代码合成（没有用任何现成素材）：引擎、风噪、胎噪、氮气、擦身呼啸、隧道混响、UI 提示音、原创配乐。
uv run --with numpy --with scipy python make_audio.py  → out/audio.wav（另存分轨）"""
import json, math, os
import numpy as np
from scipy import signal
from scipy.io import wavfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TELE = json.load(open(os.path.join(ROOT, "out", "telemetry.json")))
META, FR = TELE["meta"], TELE["frames"]
SR = 48000
FPS = META["fps"]
NF = len(FR)
DUR = NF / FPS
N = int(DUR * SR)
tt = np.arange(N) / SR
rng = np.random.default_rng(7)
F_GO, F_FIN, F_OUT = META["F_GO"], META["F_FIN"], META["F_OUT"]
T_GO, T_FIN, T_OUT = (F_GO - 1) / FPS, (F_FIN - 1) / FPS, (F_OUT - 1) / FPS


def per_frame(key, fn=None):
    v = np.array([(fn(f) if fn else f[key]) for f in FR], dtype=np.float64)
    return np.interp(tt, np.arange(NF) / FPS, v)


def smooth(x, ms):
    n = max(1, int(SR * ms / 1000))
    k = np.hanning(n * 2 + 1); k /= k.sum()
    return np.convolve(x, k, mode="same")


def bp(x, lo, hi, order=2):
    sos = signal.butter(order, [lo, hi], btype="band", fs=SR, output="sos")
    return signal.sosfilt(sos, x)


def lp(x, fc, order=2):
    return signal.sosfilt(signal.butter(order, fc, btype="low", fs=SR, output="sos"), x)


def hp(x, fc, order=2):
    return signal.sosfilt(signal.butter(order, fc, btype="high", fs=SR, output="sos"), x)


def noise(n=N):
    return rng.standard_normal(n)


def place(buf, sig, t0, gain=1.0, pan=0.0):
    """把单声道片段放到立体声缓冲里。pan: -1 左 … +1 右。"""
    i = int(t0 * SR)
    if i >= N or i + len(sig) <= 0:
        return
    a, b = max(0, i), min(N, i + len(sig))
    seg = sig[a - i:b - i] * gain
    buf[a:b, 0] += seg * math.sqrt(0.5 * (1 - pan))
    buf[a:b, 1] += seg * math.sqrt(0.5 * (1 + pan))


def stereo(x, width=0.0):
    if width <= 0:
        return np.column_stack([x, x]) * 0.7071
    d = int(SR * 0.011)
    y = np.concatenate([np.zeros(d), x[:-d]])
    return np.column_stack([x + width * y, x - width * y]) * 0.6


# =============== 遥测曲线 ===============
rpm = smooth(per_frame("rpm"), 25)
v = per_frame("v")
vn = np.clip(v / 94.0, 0, 1)
along = per_frame("a_long")
drift = np.abs(per_frame("drift"))
nit = per_frame("nitro_env")
t_race = per_frame("t")
thr = np.clip(0.45 + along / 14.0, 0.12, 1.0)
thr = np.where(t_race <= 0, np.clip((rpm - 1400) / 5200.0, 0.15, 1.0), thr)
thr = np.maximum(thr, nit)
# 换挡瞬间收一下油
gear = np.array([f["gear"] for f in FR])
for i in np.where(np.diff(gear) > 0)[0]:
    c = int((i + 1) / FPS * SR)
    w = int(0.085 * SR)
    a, b = max(0, c - w // 4), min(N, c + w)
    thr[a:b] *= 1 - 0.75 * np.hanning(b - a)
thr = smooth(thr, 18)
after_fin = np.clip((tt - T_FIN - 0.2) / 2.5, 0, 1)

# =============== 引擎 ===============
def engine(rpm_, thr_, orders, drive=2.4, seed=0):
    f0 = rpm_ / 60.0
    ph = 2 * np.pi * np.cumsum(f0) / SR
    r = np.random.default_rng(seed)
    jit = lp(r.standard_normal(N), 90) * 0.35          # 点火不均匀
    x = np.zeros(N)
    for k, a in orders:
        x += a * np.sin(k * ph + 0.6 * jit * k * 0.2 + r.uniform(0, 6.28))
    x *= 0.55 + 0.45 * thr_
    x = np.tanh(x * (drive * (0.6 + 0.8 * thr_)))
    # 排气/进气共振
    y = 0.9 * bp(x, 90, 420) + 0.8 * bp(x, 500, 1500) + 0.45 * bp(x, 1800, 4200)
    y += 0.10 * bp(r.standard_normal(N), 1500, 7000) * thr_ * np.clip(rpm_ / 8000, 0, 1) ** 2   # 进气嘶声
    return y * (0.35 + 0.65 * thr_)


ORD_HERO = [(0.5, 0.25), (1, 0.45), (1.5, 0.2), (2, 0.9), (2.5, 0.15), (3, 0.35), (4, 1.0), (5, 0.2), (6, 0.5), (8, 0.35), (10, 0.15), (12, 0.12)]
eng = engine(rpm, thr, ORD_HERO, seed=1)
eng *= 1 - 0.55 * after_fin
ENG = stereo(lp(eng, 7000), 0.25) * 0.50

# 对手引擎：按离主角最近的对手距离和左右位置混进去
hx, hy, hyaw = per_frame("x"), per_frame("y"), per_frame("yaw")
RIV = np.zeros((N, 2))
for k in range(len(META["rival_names"])):
    rx = per_frame(None, lambda f, k=k: f["rivals"][k][0]); ry = per_frame(None, lambda f, k=k: f["rivals"][k][1])
    dx, dy = rx - hx, ry - hy
    dist = np.hypot(dx, dy)
    side = (-np.sin(hyaw) * dx + np.cos(hyaw) * dy)        # 左正
    gain = 0.42 / (1 + (dist / 7.0) ** 1.6)
    gain *= (t_race > -3.2)
    e = engine(np.clip(rpm * (0.82 + 0.07 * k) + 300 * k, 1200, 9000), np.clip(thr * 0.9 + 0.1, 0, 1),
               [(1, 0.5), (2, 0.6), (3, 1.0), (4.5, 0.3), (6, 0.6), (9, 0.3)] if k % 2 == 0 else [(1, 0.4), (2, 1.0), (4, 0.8), (6, 0.4), (8, 0.3)], drive=2.0, seed=10 + k)
    pan = np.clip(-side / 6.0, -0.8, 0.8)
    e = e * smooth(gain, 40)
    RIV[:, 0] += e * np.sqrt(0.5 * (1 - pan)); RIV[:, 1] += e * np.sqrt(0.5 * (1 + pan))
RIV *= 0.55

# =============== 风噪和路噪 ===============
wind = bp(noise(), 180, 2600) * 0.9 + lp(noise(), 160) * 1.6
wind *= (vn ** 1.7) * 0.33 * (0.85 + 0.15 * np.sin(2 * np.pi * 0.7 * tt))
WIND = stereo(wind, 0.5)

# =============== 胎噪：漂移和起步打滑 ===============
sq_amt = np.clip(drift / 0.45, 0, 1) * (v > 6)
sq_amt = np.maximum(sq_amt, np.clip(1 - t_race / 1.25, 0, 1) * (t_race > 0) * 0.8)
sq_amt = np.maximum(sq_amt, np.clip((-along - 9) / 8.0, 0, 1) * 0.35)
sq_amt = smooth(sq_amt, 40)
wob = 1 + 0.06 * np.sin(2 * np.pi * 5.3 * tt) + 0.04 * lp(noise(), 12) * 3
phs = 2 * np.pi * np.cumsum(1050 * wob) / SR
squeal = (np.sin(phs) + 0.5 * np.sin(1.83 * phs) + 0.3 * np.sin(2.6 * phs)) * (0.6 + 0.4 * lp(noise(), 40) * 2)
squeal = 0.45 * squeal + 0.9 * bp(noise(), 800, 2600)
TIRE = stereo(squeal * sq_amt * 0.16, 0.4)

# =============== 氮气 ===============
jet = (bp(noise(), 1400, 6500) * 0.5 + bp(noise(), 300, 900) * 0.6) * nit * 0.34
whine_ph = 2 * np.pi * np.cumsum(900 + 1500 * nit + 600 * vn) / SR
jet += np.sin(whine_ph) * nit * 0.035
NIT = stereo(jet, 0.6)
SFX = np.zeros((N, 2))
for e in META["events"]:
    if e["type"] == "nitro":
        t0 = (e["f"] - 1) / FPS
        n = int(0.7 * SR); x = np.arange(n) / SR
        boom = np.sin(2 * np.pi * (140 * np.exp(-x * 7) + 38) * x) * np.exp(-x * 5.5)
        burst = bp(rng.standard_normal(n), 500, 5000) * np.exp(-x * 9)
        place(SFX, boom * 0.9 + burst * 0.5, t0, 0.9)

# =============== 擦身而过 / 经过桥塔和龙门架的呼啸 ===============
def whoosh(dur, f0, f1, sharp=1.0):
    n = int(dur * SR); x = np.arange(n) / n
    env = np.sin(np.pi * x) ** (2.0 * sharp)
    src = rng.standard_normal(n)
    out = np.zeros(n)
    hop = 512
    for i in range(0, n, hop):          # 分段扫频带通
        fc = f0 * (f1 / f0) ** (i / n)
        seg = src[max(0, i - hop):i + 2 * hop]
        y = bp(seg, fc * 0.6, min(fc * 1.7, SR / 2 - 100))
        a = i - max(0, i - hop)
        out[i:i + hop] = y[a:a + hop][:len(out[i:i + hop])]
    return out * env


s_arr = np.array([f["s"] for f in FR])
for e in META["events"]:
    t0 = (e["f"] - 1) / FPS
    if e["type"] == "near":
        onc = e.get("oncoming")
        w = whoosh(0.34 if onc else 0.5, 2600 if onc else 1500, 500 if onc else 700, 1.4 if onc else 1.0)
        place(SFX, w, t0 - (0.14 if onc else 0.22), 0.75 if onc else 0.55, pan=-0.75 * e.get("side", 1.0))
    elif e["type"] == "overtake":
        place(SFX, whoosh(0.6, 900, 350), t0 - 0.3, 0.5, pan=0.5)
PASS_S = [META["START_S"] + 9.0, 300.0, 1000.0, 1630.0, 1714.0, 1904.0, 2094.0, META["FINISH_S"]]
for ps in PASS_S:
    idx = int(np.searchsorted(s_arr, ps))
    if 0 < idx < NF and FR[idx]["v"] > 20:
        place(SFX, whoosh(0.3, 500, 180, 1.2), idx / FPS - 0.15, 0.5 * min(1.0, FR[idx]["v"] / 60))

# =============== 隧道混响（作用在引擎/风/胎/特效总线上） ===============
BUS = ENG + RIV + WIND + TIRE + NIT + SFX
in_tun = ((s_arr > 1236) & (s_arr < 1472)).astype(float)
wet = smooth(np.interp(tt, np.arange(NF) / FPS, in_tun), 180)
n_ir = int(1.1 * SR)
ir = rng.standard_normal((n_ir, 2)) * np.exp(-np.arange(n_ir) / SR * 5.0)[:, None]
ir[:int(0.012 * SR)] = 0
rev = np.column_stack([signal.fftconvolve(BUS[:, c] * wet, ir[:, c])[:N] for c in range(2)]) * 0.013
BUS = BUS * (1 - 0.30 * wet[:, None]) + rev
# 全局带一点很短的空间感
n_ir2 = int(0.35 * SR)
ir2 = rng.standard_normal((n_ir2, 2)) * np.exp(-np.arange(n_ir2) / SR * 14.0)[:, None]
BUS += np.column_stack([signal.fftconvolve(BUS[:, c], ir2[:, c])[:N] for c in range(2)]) * 0.006

# =============== UI 提示音 ===============
UI = np.zeros((N, 2))


def tone(freq, dur, decay=8.0, harm=((1, 1.0), (2, 0.3), (3, 0.12))):
    n = int(dur * SR); x = np.arange(n) / SR
    y = sum(a * np.sin(2 * np.pi * freq * k * x) for k, a in harm)
    return y * np.exp(-x * decay) * np.minimum(1, x / 0.004)


for k, off in enumerate((-90, -60, -30)):
    place(UI, tone(660, 0.22, 10), (F_GO + off - 1) / FPS, 0.30)
place(UI, tone(1320, 0.7, 4.0), T_GO, 0.34)
for e in META["events"]:
    t0 = (e["f"] - 1) / FPS
    if e["type"] == "overtake":
        for j, fq in enumerate((880, 1174.7, 1568)):
            place(UI, tone(fq, 0.25, 9), t0 + j * 0.07, 0.16)
    elif e["type"] == "near":
        place(UI, tone(1760, 0.09, 30), t0, 0.10)
    elif e["type"] == "drift":
        for j, fq in enumerate((1318.5, 1760, 2637)):
            place(UI, tone(fq, 0.2, 12), t0 + j * 0.055, 0.13)

# =============== 涂鸦特效的音效：喷漆罐摇晃 + 嘶声，烟团的“噗” ===============
def spray(dur=0.26):
    n = int(dur * SR); x = np.arange(n) / SR
    hiss = bp(rng.standard_normal(n), 2600, 11000) * np.minimum(1, x / 0.012) * np.exp(-x * 9.0)
    return hiss


def rattle():
    n = int(0.16 * SR); y = np.zeros(n)
    for t0, g in ((0.0, 1.0), (0.055, 0.8), (0.105, 0.6)):
        i = int(t0 * SR); m = int(0.02 * SR); xx = np.arange(m) / SR
        y[i:i + m] += g * np.sin(2 * np.pi * 2300 * xx) * np.exp(-xx * 260)
    return y


def poof():
    n = int(0.22 * SR); x = np.arange(n) / SR
    return lp(rng.standard_normal(n), 900) * np.exp(-x * 16) * np.minimum(1, x / 0.006)


drift_arr = np.array([abs(f["drift"]) for f in FR]); v_arr = np.array([f["v"] for f in FR])
TAG_F = [F_GO, F_FIN + 8] + [e["f"] for e in META["events"] if e["type"] in ("nitro", "overtake")]
TAG_F += [i + 1 for i in range(1, NF) if drift_arr[i] > 0.3 and drift_arr[i - 1] <= 0.3 and v_arr[i] > 8]
for tf_ in TAG_F:
    t0 = (tf_ - 1) / FPS
    place(UI, rattle(), t0 - 0.12, 0.10)
    place(UI, spray(), t0 + 0.02, 0.20, pan=0.2)
# 烧胎/漂移时一连串“噗噗”
for i in range(NF):
    amt = min(1.0, drift_arr[i] / 0.42) if drift_arr[i] > 0.17 else 0.0
    if 0 < FR[i]["t"] < 1.5:
        amt = max(amt, 1.0 - FR[i]["t"] / 1.5)
    if amt > 0.2 and i % 4 == 0:
        place(UI, poof(), i / FPS, 0.10 * amt, pan=0.5 * (1 if (i // 4) % 2 else -1))

# =============== 配乐（A 小调，约 152 BPM，Am–F–C–G） ===============
BAR = (563 - F_GO) / FPS / 9.0            # 让第 9 小节正好落在第一次氮气点火
BEAT = BAR / 4
MUS = np.zeros((N, 2))
A1 = 55.0
ROOTS = [0, -4, 3, -2]                    # A, F, C, G（相对 A 的半音）
CHORDS = [(0, 3, 7), (-4, 0, 3), (3, 7, 10), (-2, 2, 5)]
semi = lambda n: 2 ** (n / 12.0)


def saw(freq, n, detune=0.0):
    ph = np.cumsum(np.full(n, freq * (1 + detune))) / SR
    return 2 * (ph % 1.0) - 1


def kick():
    n = int(0.34 * SR); x = np.arange(n) / SR
    return np.sin(2 * np.pi * (48 * x + (150 - 48) / 22 * (1 - np.exp(-22 * x)))) * np.exp(-x * 9) + 0.25 * np.exp(-x * 400) * rng.standard_normal(n)


def clap():
    n = int(0.22 * SR); x = np.arange(n) / SR
    return bp(rng.standard_normal(n), 900, 4200) * np.exp(-x * 22) + 0.4 * np.sin(2 * np.pi * 190 * x) * np.exp(-x * 30)


def hat(open_=False):
    n = int((0.19 if open_ else 0.045) * SR); x = np.arange(n) / SR
    return hp(rng.standard_normal(n), 7000) * np.exp(-x * (16 if open_ else 90))


def bass_note(freq, dur):
    n = int(dur * SR); x = np.arange(n) / SR
    y = saw(freq, n) * 0.6 + np.sign(np.sin(2 * np.pi * freq * x)) * 0.35 + np.sin(2 * np.pi * freq * 0.5 * x) * 0.5
    y = lp(y, 520, 2)
    return y * np.minimum(1, x / 0.005) * np.exp(-x * 5.0) * np.minimum(1, (dur - x) / 0.02)


def lead_note(freq, dur, bright=1.0):
    n = int(dur * SR); x = np.arange(n) / SR
    y = saw(freq, n, 0.004) + saw(freq, n, -0.004) + 0.5 * saw(freq * 2, n, 0.002)
    y = lp(y, 1800 + 2600 * bright, 2)
    return y * np.minimum(1, x / 0.004) * np.exp(-x * 9.0)


def pad_chord(root_semi, chord, dur, cutoff=900):
    n = int(dur * SR); x = np.arange(n) / SR
    y = np.zeros(n)
    for c in chord:
        fq = A1 * 4 * semi(c)
        for d in (-0.006, 0.0, 0.007):
            y += saw(fq, n, d)
    y = lp(y, cutoff, 2) * 0.12
    env = np.minimum(1, x / 0.25) * np.minimum(1, (dur - x) / 0.3)
    return y * env


def riser(dur):
    n = int(dur * SR); x = np.arange(n) / n
    y = whoosh(dur, 300, 7000, 0.3) * 0.0
    src = rng.standard_normal(n)
    out = np.zeros(n); hop = 1024
    for i in range(0, n, hop):
        fc = 300 * (9000 / 300) ** (i / n)
        seg = src[max(0, i - hop):i + 2 * hop]
        yy = bp(seg, fc * 0.7, min(fc * 1.4, SR / 2 - 100))
        a = i - max(0, i - hop)
        out[i:i + hop] = yy[a:a + hop][:len(out[i:i + hop])]
    return out * x ** 2


def impact():
    n = int(2.2 * SR); x = np.arange(n) / SR
    return np.sin(2 * np.pi * (36 + 60 * np.exp(-x * 9)) * x) * np.exp(-x * 2.6) * 0.9 + hp(rng.standard_normal(n), 3500) * np.exp(-x * 2.2) * 0.25


K, C, H, HO = kick(), clap(), hat(), hat(True)
n_bars = int((T_FIN - T_GO) / BAR) + 1
duck = np.ones(N)
for b in range(n_bars + 1):
    tb = T_GO + b * BAR
    if tb > T_FIN - 0.05:
        break
    ch = b % 4
    # 段落：0-8 主歌；9-12 第一次氮气（加主旋律）；13-16 过渡；隧道里 16-18 抽掉鼓；19 起终段
    tunnel_break = 16 <= b < 19
    chorus = (9 <= b < 13) or b >= 19
    root = A1 * semi(ROOTS[ch])
    place(MUS, pad_chord(ROOTS[ch], CHORDS[ch], BAR + 0.25, 800 if not chorus else 1500), tb, 0.55 if not tunnel_break else 0.9)
    for q in range(4):
        tq = tb + q * BEAT
        if tq > T_FIN - 0.02:
            break
        if not tunnel_break:
            place(MUS, K, tq, 0.95)
            i0 = int(tq * SR); n_d = int(0.22 * SR)
            if i0 + n_d < N:
                duck[i0:i0 + n_d] = np.minimum(duck[i0:i0 + n_d], 1 - 0.75 * np.exp(-np.arange(n_d) / SR * 14))
            if q in (1, 3):
                place(MUS, C, tq, 0.5)
            place(MUS, HO if chorus else H, tq + BEAT / 2, 0.20 if chorus else 0.16, pan=0.25)
            for h in (0.25, 0.75):
                place(MUS, H, tq + BEAT * h, 0.10, pan=-0.3)
        elif b == 18:                     # 进终段前的军鼓滚奏
            for r_ in range(4 if q < 2 else 8):
                place(MUS, C, tq + r_ * BEAT / (4 if q < 2 else 8), 0.18 + 0.05 * q + 0.02 * r_)
        # 贝斯：反拍八分音符
        for h in ((0.5,) if tunnel_break else (0.0, 0.5, 0.75) if chorus else (0.5, 0.75)):
            place(MUS, bass_note(root * (2 if (h == 0.75 and q % 2) else 1), BEAT * 0.42), tq + BEAT * h, 0.55)
        # 琶音
        arp = [0, 2, 1, 2, 0, 2, 1, 2] if not chorus else [0, 1, 2, 1, 2, 0, 2, 1]
        if b >= 4 or chorus:
            for s16 in range(4):
                idx = arp[(q * 4 + s16) % 8]
                octv = 2 if (not chorus or s16 % 2 == 0) else 4
                fq = A1 * 4 * octv / 2 * semi(CHORDS[ch][idx])
                place(MUS, lead_note(fq, BEAT * 0.5, 1.0 if chorus else 0.35), tq + s16 * BEAT / 4, 0.10 if chorus else 0.07, pan=0.35 * (1 if s16 % 2 else -1))
# 琶音的回声
dly = int(BEAT * 0.75 * SR)
echo = np.zeros_like(MUS)
echo[dly:] = MUS[:-dly] * 0.0
MUS = MUS * duck[:, None] * 0.0 + MUS * np.column_stack([0.35 + 0.65 * duck, 0.35 + 0.65 * duck])
# 片头：铺底和上升音效；发车、两次氮气、冲线的重击
place(MUS, pad_chord(0, CHORDS[0], T_GO + 0.2, 500), 0.0, 0.8)
place(MUS, riser(T_GO - 0.3), 0.3, 0.16)
for tb, g in ((T_GO, 0.8), (T_GO + 9 * BAR, 0.75), (T_GO + 19 * BAR, 0.85), (T_FIN, 1.0)):
    place(MUS, impact(), tb, g)
place(MUS, riser(BAR), T_GO + 8 * BAR, 0.14)
place(MUS, riser(BAR * 2), T_GO + 17 * BAR, 0.16)
# 冲线后：和弦收尾
for j, c in enumerate(CHORDS[0]):
    place(MUS, pad_chord(0, (c, c + 12), DUR - T_FIN, 1400), T_FIN, 0.7)
# 赛后音乐淡出鼓点
mfade = np.where(tt < T_FIN, 1.0, 1.0)
MUS *= mfade[:, None]
MUS += np.column_stack([signal.fftconvolve(MUS[:, c], ir2[:, c])[:N] for c in range(2)]) * 0.004

# =============== 混音 ===============
bus_gain = np.where(tt < T_GO, 0.85, 1.0)
mix = BUS * 0.9 * bus_gain[:, None] + UI * 0.9 + MUS * 0.42
fade = np.minimum(1, tt / 0.4) * np.minimum(1, (DUR - tt) / 1.6)
mix *= fade[:, None]
mix = hp(mix[:, 0], 28), hp(mix[:, 1], 28)
mix = np.column_stack(mix)
peak = np.percentile(np.abs(mix), 99.9)
mix = np.tanh(mix / peak * 1.25) * 0.93
os.makedirs(os.path.join(ROOT, "out"), exist_ok=True)
wavfile.write(os.path.join(ROOT, "out", "audio.wav"), SR, (mix * 32767).astype(np.int16))
for nm, arr in (("stem_engine", BUS), ("stem_music", MUS), ("stem_ui", UI)):
    p = np.max(np.abs(arr)) + 1e-9
    wavfile.write(os.path.join(ROOT, "out", nm + ".wav"), SR, (arr / p * 0.9 * 32767).astype(np.int16))
rms = lambda a: 20 * math.log10(np.sqrt(np.mean(a ** 2)) + 1e-9)
print(f"audio {DUR:.2f}s  bar={BAR:.3f}s bpm={240 / BAR:.1f}  rms bus {rms(BUS * 0.9):.1f} ui {rms(UI):.1f} mus {rms(MUS * 0.42):.1f} mix {rms(mix):.1f} dB")
