"""音效合成：按 out/events.json 和 out/camtrack.json 生成"记录仪麦克风"质感的音轨。
  .venv/bin/python scripts/audio.py   ->  out/audio.wav
链路：干声混合 → 混凝土房间混响 → 麦克风自动增益(枪响后环境声被压低再慢慢恢复) → 削波失真 → 窄频带
"""
import os, json, math
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve, resample_poly
from scipy.io import wavfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SFX = os.path.join(ROOT, "assets", "cod_sfx")
EV = json.load(open(os.path.join(ROOT, "out", "events.json")))
CT = json.load(open(os.path.join(ROOT, "out", "camtrack.json")))
SR = 48000; FPS = CT["fps"]; NFR = CT["frames"]
DUR = NFR / FPS
N = int((DUR + 2.5) * SR)
rng = np.random.default_rng(11)

dry = np.zeros(N)      # 不进混响的贴身声音（呼吸、衣物摩擦）
bus = np.zeros(N)      # 进混响的声音
gun = np.zeros(N)      # 枪声（单独一条，混响更重）


def load(name):
    sr, a = wavfile.read(os.path.join(SFX, name))
    a = a.astype(np.float64)
    if a.ndim > 1:
        a = a.mean(axis=1)
    a /= 32768.0 if a.dtype != np.float64 or np.abs(a).max() > 2 else 1.0
    if sr != SR:
        a = resample_poly(a, SR, sr)
    m = np.abs(a).max()
    return a / m if m > 0 else a


def sos(kind, f, order=4):
    if kind == "bp":
        return butter(order, [f[0] / (SR / 2), f[1] / (SR / 2)], btype="band", output="sos")
    return butter(order, f / (SR / 2), btype=kind, output="sos")


def filt(x, kind, f, order=4):
    return sosfilt(sos(kind, f, order), x)


def noise(n):
    return rng.standard_normal(n)


def put(track, sig, t0, gain=1.0):
    i = int(t0 * SR)
    if i >= N or i < 0:
        return
    sig = sig[: N - i]
    track[i:i + len(sig)] += sig * gain


def env_exp(n, tau, attack=0.0004):
    t = np.arange(n) / SR
    return np.exp(-t / tau) * np.clip(t / attack, 0, 1)


def t_of(f):
    return (f - 1) / FPS


# ---------------------------------------------------------------- 枪声
def pistol_shot():
    """近距离手枪：极强瞬态 + 低频冲击，麦克风会被直接打爆。"""
    n = int(0.5 * SR); t = np.arange(n) / SR
    crack = filt(noise(n), "hp", 1500) * env_exp(n, 0.0028 * rng.uniform(0.85, 1.2))
    body = filt(noise(n), "bp", (180, 2800)) * env_exp(n, 0.035 * rng.uniform(0.9, 1.15), 0.0006)
    f0 = 135 * rng.uniform(0.92, 1.08)
    thump = np.sin(2 * np.pi * (50 * t + (f0 - 50) * 0.03 * (1 - np.exp(-t / 0.03)))) * env_exp(n, 0.075)
    mech = np.zeros(n); k = int(0.011 * SR)
    mech[k:] = filt(noise(n - k), "bp", (2200, 6500)) * env_exp(n - k, 0.005) * 0.5
    return crack * 1.2 + body * 1.0 + thump * 1.4 + mech * 0.3


def rifle_shot():
    """几米外的短管步枪：更尖更响，带膛口爆音。"""
    n = int(0.6 * SR); t = np.arange(n) / SR
    crack = filt(noise(n), "hp", 2200) * env_exp(n, 0.0020)
    body = filt(noise(n), "bp", (120, 3600)) * env_exp(n, 0.05 * rng.uniform(0.9, 1.15), 0.0005)
    f0 = 105 * rng.uniform(0.92, 1.08)
    thump = np.sin(2 * np.pi * (38 * t + (f0 - 38) * 0.04 * (1 - np.exp(-t / 0.04)))) * env_exp(n, 0.11)
    return crack * 1.3 + body * 1.2 + thump * 1.6


def snap():
    n = int(0.05 * SR)
    return filt(noise(n), "hp", 3500) * env_exp(n, 0.0012, 0.0001)


shots_w = [load(f"shot_{i}.wav") for i in range(6)]
eshots_w = [load(f"eshot_{i}.wav") for i in range(4)]
impacts_w = [load(f"impact_{i}.wav") for i in range(4)]
casing_w = [load(f"casing_{i}.wav") for i in range(4)]
steps_w = [load(f"step_{i}.wav") for i in range(6)]
fall_w = [load(f"fall_{i}.wav") for i in range(2)]
whizz_w = [load(f"whizz_{i}.wav") for i in range(3)]

for e in EV:
    t = t_of(e["f"]); ty = e["type"]
    if ty == "pshot":
        put(gun, pistol_shot(), t, 7.0)
        put(gun, shots_w[rng.integers(6)], t, 2.5)
    elif ty == "eshot":
        d = e.get("dist", 6.0)
        put(gun, rifle_shot(), t + d / 343.0, 4.2)
        put(gun, eshots_w[rng.integers(4)], t + d / 343.0, 1.6)
    elif ty == "snap":
        put(bus, snap(), t + 0.007, 2.2)
        put(bus, whizz_w[rng.integers(3)], t + 0.004, 0.5)
    elif ty == "impact":
        d = e.get("dist", 3.0)
        g = 1.6 / max(d, 0.8)
        put(bus, impacts_w[rng.integers(4)], t + 0.009, 1.4 * g)
        # 碎屑散落
        n = int(0.5 * SR); grains = np.zeros(n)
        for _ in range(int(22 * min(1.5, g + 0.4))):
            k = rng.integers(0, n - 600); L = rng.integers(60, 500)
            grains[k:k + L] += filt(noise(L), "hp", 2500, 2) * np.hanning(L) * rng.uniform(0.2, 1.0) * math.exp(-k / SR / 0.16)
        put(bus, grains, t + 0.03, 0.35 * g)
    elif ty == "impact_far":
        put(bus, impacts_w[rng.integers(4)], t + 0.02, 0.25)
    elif ty == "casing":
        put(bus, casing_w[rng.integers(4)], t, 0.30 if e.get("n", 0) == 0 else 0.15)
    elif ty == "step":
        sp = e.get("speed", 0.6)
        g = 0.026 + 0.03 * min(sp, 1.2)
        st_ = filt(steps_w[rng.integers(6)], "lp", 2500)
        put(dry, st_, t, g); put(bus, st_, t, g * 0.22)
        n = int(0.16 * SR); crunch = np.zeros(n)
        for _ in range(rng.integers(8, 16)):
            k = rng.integers(0, n - 400); L = rng.integers(40, 380)
            crunch[k:k + L] += filt(noise(L), "hp", 3000, 2) * np.hanning(L) * rng.uniform(0.2, 1.0)
        put(dry, crunch, t + 0.01, g * 0.55); put(bus, crunch, t + 0.01, g * 0.12)
    elif ty == "bodyfall":
        put(bus, filt(fall_w[rng.integers(2)], "lp", 1800), t + 0.02, 0.5)
    elif ty == "rifle_drop":
        n = int(0.35 * SR); c = np.zeros(n)
        for k0, a in ((0, 1.0), (int(0.07 * SR), 0.5), (int(0.13 * SR), 0.3)):
            L = n - k0; tt = np.arange(L) / SR
            c[k0:] += a * (filt(noise(L), "bp", (1800, 5200)) * np.exp(-tt / 0.02) + 0.3 * np.sin(2 * np.pi * 2350 * tt) * np.exp(-tt / 0.05))
        put(bus, c, t + 0.02, 0.22)

# ---------------------------------------------------------------- 贴身声音
tt = np.arange(N) / SR
fr = np.clip(tt * FPS, 0, NFR)                    # 连续帧号
yaw = np.array(CT["yaw"]); pit = np.array(CT["pitch"]); rol = np.array(CT["roll"])
ang = np.sqrt(np.gradient(yaw) ** 2 + np.gradient(pit) ** 2 + 0.5 * np.gradient(rol) ** 2)   # 度/帧
ang_s = np.interp(fr, np.arange(len(ang)), ang)
vel_s = np.interp(fr, np.arange(len(CT["vel"])), np.array(CT["vel"]))
# 衣物/装具摩擦：跟着转头速度走
rub = filt(noise(N), "bp", (350, 2600), 2)
rub_env = np.clip(ang_s / 3.5, 0, 1.6) ** 1.2 + 0.25 * np.clip(vel_s, 0, 1)
k = int(0.03 * SR); rub_env = np.convolve(rub_env, np.ones(k) / k, mode="same")
flut = 0.6 + 0.4 * np.abs(filt(noise(N), "lp", 14, 2)) * 6
dry += rub * rub_env * flut * 0.05
# 装具晃动的小碰撞声
for s in CT["steps"]:
    if s <= NFR and rng.random() < 0.7:
        L = int(0.05 * SR); x = filt(noise(L), "bp", (1500, 4500), 2) * env_exp(L, 0.008)
        put(dry, x, t_of(s) + rng.uniform(0.02, 0.08), 0.035)

# 呼吸：交火前平稳，开枪时屏气，之后急促
def breath_cycle(dur, strength):
    n = int(dur * SR); x = np.zeros(n)
    ni = int(n * 0.36); ne = int(n * 0.46); gap = int(n * 0.06)
    inh = filt(noise(ni), "bp", (900, 3200), 2) * np.sin(np.linspace(0, np.pi, ni)) ** 1.5
    exh = filt(noise(ne), "bp", (350, 1700), 2) * np.sin(np.linspace(0, np.pi, ne)) ** 0.8
    x[:ni] = inh * 0.7; x[ni + gap: ni + gap + ne] = exh * 1.0
    return x * strength

t = 0.2
while t < DUR:
    f = t * FPS
    if f < 84:
        dur, st = rng.uniform(2.6, 3.2), 0.005
    elif f < 132:
        t += 0.4; continue                  # 屏气
    elif f < 260:
        dur, st = rng.uniform(1.05, 1.35), 0.022
    else:
        dur, st = rng.uniform(1.4, 1.8), 0.016
    put(dry, breath_cycle(dur, st), t)
    t += dur
# 被袭瞬间的一声短促吸气
L = int(0.22 * SR)
put(dry, filt(noise(L), "bp", (1100, 3800), 2) * np.sin(np.linspace(0, np.pi, L)) ** 0.6, t_of(89), 0.08)

# 环境底噪 + 门外的风
room = filt(noise(N), "lp", 500, 2) * 0.004 + filt(noise(N), "bp", (200, 4000), 2) * 0.0016
wind = filt(noise(N), "lp", 700, 2) * (0.5 + 0.5 * np.abs(filt(noise(N), "lp", 0.4, 2)) * 40) * 0.0022
dry += room + wind

# ---------------------------------------------------------------- 混响（空旷混凝土房间）
ir = load("ir_hall.wav")
ti = np.arange(len(ir)) / SR
ir = ir * np.exp(-ti / 0.55)                       # 把大厅脉冲收短成 RT60≈1.5s 的房间
ir = filt(ir, "hp", 160, 2)
ir /= np.sqrt((ir ** 2).sum())
wet_bus = fftconvolve(bus, ir)[:N]
wet_gun = fftconvolve(gun, ir)[:N]
# 早期反射
er = np.zeros(int(0.06 * SR)); er[0] = 0
for d_ms, a in ((9, 0.5), (17, 0.38), (23, 0.3), (31, 0.22), (44, 0.16)):
    er[int(d_ms / 1000 * SR)] = a
early_gun = fftconvolve(gun, er)[:N]
mix = dry + bus + wet_bus * 0.55 + gun + early_gun * 0.6 + wet_gun * 0.9

# ---------------------------------------------------------------- 麦克风链路
mix = filt(mix, "hp", 140, 2)
# 自动增益：快起慢放。枪响时把环境声一起压下去
env = np.abs(mix)
att = math.exp(-1 / (0.005 * SR)); rel = math.exp(-1 / (0.5 * SR))
e = 0.0; g = np.empty(N)
TH = 0.13
for i in range(N):
    x = env[i]
    e = att * e + (1 - att) * x if x > e else rel * e + (1 - rel) * x
    g[i] = TH / e if e > TH else 1.0
mix = mix * g
# 削波失真（枪声会顶死）
mix = np.tanh(mix * 6.0) * 0.92
# 窄频带 + 轻微中频突出
mix = filt(mix, "lp", 7200, 4)
pres = filt(mix, "bp", (1800, 3600), 2)
mix = mix + pres * 0.35
mix = np.tanh(mix * 1.15)
mix = mix[: int(DUR * SR)]
mix[: int(0.02 * SR)] *= np.linspace(0, 1, int(0.02 * SR))
mix[-int(0.05 * SR):] *= np.linspace(1, 0, int(0.05 * SR))
mix = mix / max(np.abs(mix).max(), 1e-6) * 0.94
out = (np.stack([mix, mix], axis=1) * 32767).astype(np.int16)
wavfile.write(os.path.join(ROOT, "out", "audio.wav"), SR, out)

# 统计，便于不听也能检查
def db(x):
    return 20 * math.log10(max(float(np.sqrt(np.mean(x ** 2))), 1e-9))
seg = lambda a, b: mix[int(a * SR): int(b * SR)]
print("AUDIO OK dur", round(len(mix) / SR, 2), "s")
print("  rms dB  0-2.5s(行走):", round(db(seg(0.2, 2.5)), 1), " 2.8-4.3s(交火):", round(db(seg(2.83, 4.3)), 1),
      " 4.5-6s(余响):", round(db(seg(4.5, 6.0)), 1), " 8-12s(推进):", round(db(seg(8, 12)), 1))
print("  peak:", round(float(np.abs(mix).max()), 3), " 交火段削波占比:", round(float((np.abs(seg(2.83, 4.3)) > 0.85).mean()), 3))
