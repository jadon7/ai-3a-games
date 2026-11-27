"""Procedural sound design for the FPS shot, driven by renders/events.json.
usage: python audio.py events.json out.wav"""
import sys, json, math
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve
from scipy.io import wavfile

EV = json.load(open(sys.argv[1]))
OUT = sys.argv[2]
SR = 48000
FPS = 30
NF = EV["frames"]
DUR = NF / FPS
N = int(DUR * SR) + SR  # 1 s tail headroom
L = np.zeros(N); R = np.zeros(N)
WET_L = np.zeros(N); WET_R = np.zeros(N)
FR = {int(k): v for k, v in EV["frame"].items()}
rng = np.random.default_rng(3)


def t_(n): return np.arange(n) / SR


def sos(kind, f, order=4):
    if kind == "bp":
        return butter(order, [f[0] / (SR / 2), f[1] / (SR / 2)], btype="band", output="sos")
    return butter(order, f / (SR / 2), btype=kind, output="sos")


def filt(x, kind, f, order=4): return sosfilt(sos(kind, f, order), x)


def noise(n): return rng.standard_normal(n)


def place(sig, t0, gain=1.0, pan=0.0, wet=0.25):
    """pan -1 left .. +1 right (equal power)."""
    i = int(t0 * SR)
    if i >= N or i + len(sig) <= 0:
        return
    if i < 0:
        sig = sig[-i:]; i = 0
    sig = sig[: N - i]
    a = (pan + 1) * math.pi / 4
    gl, gr = math.cos(a) * gain, math.sin(a) * gain
    L[i:i + len(sig)] += sig * gl; R[i:i + len(sig)] += sig * gr
    WET_L[i:i + len(sig)] += sig * gl * wet; WET_R[i:i + len(sig)] += sig * gr * wet


def env_exp(n, tau, attack=0.0005):
    t = t_(n)
    e = np.exp(-t / tau)
    if attack > 0:
        e *= np.clip(t / attack, 0, 1)
    return e


# ------------------------------------------------------------------ sound generators
def gunshot(var=0.0, distant=False):
    n = int(0.45 * SR)
    t = t_(n)
    crack = filt(noise(n), "hp", 1800) * env_exp(n, 0.0022 * (1 + var))
    body = filt(noise(n), "bp", (250, 3200)) * env_exp(n, 0.028 * (1 + var * 0.5), 0.0008)
    f0 = 150 * (1 + var * 0.1)
    sweep = np.sin(2 * np.pi * (45 * t + (f0 - 45) * 0.025 * (1 - np.exp(-t / 0.025))))
    thump = sweep * env_exp(n, 0.07)
    mech = np.zeros(n)
    k = int(0.009 * SR)
    m = filt(noise(n - k), "bp", (2500, 7000)) * env_exp(n - k, 0.004)
    ring = np.sin(2 * np.pi * 3150 * t[: n - k]) * env_exp(n - k, 0.04) * 0.15
    mech[k:] = m * 0.5 + ring
    s = crack * 1.1 + body * 0.9 + thump * 1.3 + mech * 0.35
    s = np.tanh(s * 2.2) / 1.2
    if distant:
        s = filt(s, "lp", 2600)
        s = np.tanh(s * 1.5)
    return s


def bullet_snap():
    n = int(0.12 * SR)
    t = t_(n)
    snap = filt(noise(n), "hp", 3000) * env_exp(n, 0.0015)
    ph = 2 * np.pi * np.cumsum(np.linspace(1700, 500, n)) / SR
    whiz = filt(noise(n), "bp", (500, 2500)) * np.sin(ph) * np.exp(-((t - 0.02) / 0.03) ** 2)
    return snap * 0.9 + whiz * 0.5


def impact_hard():
    n = int(0.35 * SR)
    thud = filt(noise(n), "lp", 1400) * env_exp(n, 0.02)
    debris = np.zeros(n)
    for _ in range(14):
        k = int(rng.uniform(0.01, 0.25) * SR)
        g = filt(noise(n - k), "bp", (1500, 6000)) * env_exp(n - k, rng.uniform(0.002, 0.006)) * rng.uniform(0.05, 0.25)
        debris[k:] += g
    return thud * 0.9 + debris


def casing_bounce(amp):
    n = int(0.12 * SR)
    t = t_(n)
    s = np.zeros(n)
    for fq in rng.uniform(3800, 9500, 4):
        s += np.sin(2 * np.pi * fq * t + rng.uniform(0, 6)) * env_exp(n, rng.uniform(0.015, 0.05))
    s += filt(noise(n), "hp", 4000) * env_exp(n, 0.002) * 0.6
    return s * amp


def footstep():
    n = int(0.16 * SR)
    heel = filt(noise(n), "lp", 700) * env_exp(n, 0.016)
    scuff = filt(noise(n), "bp", (1800, 5000)) * env_exp(n, 0.03, 0.01) * 0.25
    gear = np.zeros(n)
    for _ in range(3):
        k = int(rng.uniform(0.005, 0.05) * SR)
        gear[k:] += np.sin(2 * np.pi * rng.uniform(2500, 5000) * t_(n - k)) * env_exp(n - k, 0.01) * 0.05
    return heel * 0.9 + scuff + gear


def swish(dur=0.22):
    n = int(dur * SR)
    t = t_(n)
    e = np.sin(np.pi * t / dur) ** 2
    return filt(noise(n), "bp", (350, 2200)) * e


def tick(kill=False):
    n = int(0.25 * SR)
    t = t_(n)
    if not kill:
        return (np.sin(2 * np.pi * 2900 * t) * env_exp(n, 0.006) + filt(noise(n), "hp", 5000) * env_exp(n, 0.0015) * 0.4)
    s = (np.sin(2 * np.pi * 980 * t) * env_exp(n, 0.05) + np.sin(2 * np.pi * 1470 * t) * env_exp(n, 0.09) * 0.6
         + filt(noise(n), "lp", 900) * env_exp(n, 0.01) * 0.8)
    return s


def clack(f_lo=800, f_hi=5000, tau=0.012, ringf=2200):
    n = int(0.3 * SR)
    t = t_(n)
    return (filt(noise(n), "bp", (f_lo, f_hi)) * env_exp(n, tau) + np.sin(2 * np.pi * ringf * t) * env_exp(n, 0.06) * 0.12)


def flesh_hit():
    n = int(0.12 * SR)
    return filt(noise(n), "lp", 700) * env_exp(n, 0.02)


def body_fall():
    n = int(0.6 * SR)
    s = np.zeros(n)
    for k_t, a in ((0.0, 1.0), (0.12, 0.6), (0.22, 0.35)):
        k = int(k_t * SR)
        s[k:] += filt(noise(n - k), "lp", 500) * env_exp(n - k, 0.04) * a
    s += filt(noise(n), "bp", (1000, 4000)) * env_exp(n, 0.08) * 0.08
    return s


# ------------------------------------------------------------------ placement helpers
def rel_pan(f, ex, ey):
    fr = FR[min(max(f, 1), NF)]
    ang = math.degrees(math.atan2(ey - fr["y"], ex - fr["x"]))
    rel = (ang - fr["yaw"] + 540) % 360 - 180  # + = left
    return max(-1, min(1, -math.sin(math.radians(rel)))), math.hypot(ex - fr["x"], ey - fr["y"])


ft = lambda f: (f - 1) / FPS

# player shots
for s in EV["shots"]:
    f = s["f"]
    var = rng.uniform(-0.12, 0.12)
    place(gunshot(var), ft(f), gain=0.95, pan=rng.uniform(-0.05, 0.08), wet=0.22)
    # casings land ~0.4 s later, bounce 3 times
    t0 = ft(f) + rng.uniform(0.36, 0.5)
    for b in range(3):
        place(casing_bounce(0.18 / (b + 1)), t0 + b * rng.uniform(0.07, 0.12), pan=0.45, wet=0.15)

# enemy (E3) shots: distant, panned, delayed
for s in EV["enemy_shots"]:
    f = s["f"]
    e = FR[f]["enemies"]["E3"]
    pan, dist = rel_pan(f, e["x"], e["y"])
    place(gunshot(rng.uniform(-0.1, 0.1), distant=True), ft(f) + dist / 343.0, gain=0.42, pan=pan * 0.8, wet=1.1)
    place(bullet_snap(), ft(f) + 0.012, gain=0.55, pan=rng.uniform(-0.6, 0.6), wet=0.2)
    place(impact_hard(), ft(f) + 0.03, gain=0.5, pan=rng.uniform(-0.7, 0.7), wet=0.4)

# hits & kills
kill_frames = {k["f"] for k in EV["kills"]}
for h in EV["hits"]:
    f = h["f"]
    place(tick(False), ft(f) + 0.01, gain=0.32, wet=0.0)
    place(flesh_hit(), ft(f) + 0.04, gain=0.22, wet=0.3)
for k in EV["kills"]:
    f = k["f"]
    place(tick(True), ft(f), gain=0.36, wet=0.05)
    e = FR[f]["enemies"][k["enemy"]]
    pan, dist = rel_pan(f, e["x"], e["y"])
    place(body_fall(), ft(f) + 0.55, gain=0.5 * min(1.0, 8.0 / max(dist, 1)), pan=pan, wet=0.6)

# footsteps from movement
last_step = -100
for f in range(2, NF):
    a, b = FR[f], FR[f + 1]
    spd = math.hypot(b["x"] - a["x"], b["y"] - a["y"]) * FPS
    if spd > 0.35 and f - last_step >= 16:
        last_step = f
        place(footstep(), ft(f), gain=0.55 * min(1.0, spd / 1.2), pan=(-0.15 if (f // 16) % 2 else 0.15), wet=0.3)

# ADS cloth swishes
prev = 0.0
for f in range(1, NF + 1):
    a = FR[f]["ads"]
    if prev < 0.05 <= a:
        place(swish(0.2), ft(f) - 0.03, gain=0.22, wet=0.1)
        place(clack(1500, 6000, 0.004, 3000), ft(f) + 0.17, gain=0.07, wet=0.1)
    if prev > 0.95 >= a:
        place(swish(0.25), ft(f), gain=0.18, wet=0.1)
    prev = a

# reload sequence (frames 505..562)
R0 = 505
for (df, kind, g) in ((6, "release", 0.25), (10, "slide", 0.2), (24, "drop", 0.3), (29, "insert", 0.45), (40, "bolt", 0.55)):
    t0 = ft(R0 + df)
    if kind == "release":
        place(clack(1500, 7000, 0.004, 3400), t0, g, 0.1, 0.1)
    elif kind == "slide":
        place(swish(0.18) * 0.7 + filt(noise(int(0.18 * SR)), "bp", (3000, 8000)) * 0.1, t0, g, 0.1, 0.1)
    elif kind == "drop":
        cb = np.zeros(int(0.3 * SR)); c_ = casing_bounce(0.2); cb[: len(c_)] = c_
        place(clack(300, 2500, 0.02, 900) + cb, t0 + 0.25, g, -0.3, 0.5)
    elif kind == "insert":
        place(clack(600, 4500, 0.01, 1800), t0, g, 0.05, 0.15)
        place(clack(1500, 6500, 0.004, 2600), t0 + 0.05, g * 0.6, 0.05, 0.15)
    elif kind == "bolt":
        place(clack(400, 5000, 0.015, 1500), t0, g, 0.1, 0.25)
        place(clack(2000, 8000, 0.003, 4100), t0 + 0.03, g * 0.5, 0.1, 0.25)

# ------------------------------------------------------------------ ambience
n = N
brown = np.cumsum(noise(n)); brown = filt(brown - np.convolve(brown, np.ones(4801) / 4801, mode="same"), "lp", 350)
brown /= np.abs(brown).max() + 1e-9
tt = t_(n)
hum = (np.sin(2 * np.pi * 50 * tt) * 0.5 + np.sin(2 * np.pi * 100 * tt) * 0.3 + np.sin(2 * np.pi * 150 * tt) * 0.15)
amb = brown * 0.03 + hum * 0.006
# distant fire alarm bell (pulsing)
bell = np.zeros(n)
pulse = (np.sin(2 * np.pi * 2.2 * tt) > 0.2).astype(float)
pulse = filt(pulse, "lp", 40, 2)
bell = (np.sin(2 * np.pi * 880 * tt) + 0.5 * np.sin(2 * np.pi * 1760 * tt + 1) + 0.3 * np.sin(2 * np.pi * 2650 * tt)) * pulse
bell = filt(bell, "lp", 2200) * 0.006
L += amb * 1.0; R += amb * 0.95
WET_L += bell; WET_R += bell * 0.9

# ------------------------------------------------------------------ reverb (large indoor hall)
def ir(rt60=1.7, seed=0):
    r = np.random.default_rng(seed)
    n = int(rt60 * 1.3 * SR)
    t = t_(n)
    tail = r.standard_normal(n) * np.exp(-6.9 * t / rt60)
    tail = filt(tail, "lp", 4500) * 0.7 + filt(tail, "lp", 1200) * 0.5
    er = np.zeros(n)
    for d, a in ((0.013, 0.5), (0.021, 0.35), (0.034, 0.3), (0.047, 0.25), (0.066, 0.2), (0.089, 0.16)):
        k = int(d * SR * r.uniform(0.9, 1.1)); er[k] += a * r.choice([-1, 1])
    h = er + tail * 0.12
    h[:int(0.006 * SR)] = 0
    return h / np.abs(h).sum() * 40


rl = fftconvolve(WET_L, ir(1.8, 1))[:N]
rr = fftconvolve(WET_R, ir(1.8, 2))[:N]
outL = L + rl * 0.5
outR = R + rr * 0.5

# ------------------------------------------------------------------ master
mix = np.vstack([outL, outR])
mix = filt(mix, "hp", 28, 2)
peak = np.abs(mix).max()
mix = mix / (peak + 1e-9) * 1.25
mix = np.tanh(mix * 1.15) / np.tanh(1.15 * 1.25) * 0.9
mix = mix[:, : int(DUR * SR)]
fade = int(0.25 * SR)
mix[:, -fade:] *= np.linspace(1, 0, fade)
wavfile.write(OUT, SR, (mix.T * 32767).astype(np.int16))
print("WROTE", OUT, mix.shape, "peak", float(np.abs(mix).max()))
