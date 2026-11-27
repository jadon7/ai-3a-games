"""生成游戏用的单个音效文件（和影片音轨同一套合成方法），输出到 game/assets/sfx/。
  .venv/bin/python scripts/game_sfx.py
"""
import os, math
import numpy as np
from scipy.signal import butter, sosfilt, resample_poly
from scipy.io import wavfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "cod_sfx")
OUT = os.path.join(ROOT, "game", "assets", "sfx"); os.makedirs(OUT, exist_ok=True)
SR = 48000
rng = np.random.default_rng(23)


def load(name):
    sr, a = wavfile.read(os.path.join(SRC, name)); a = a.astype(np.float64)
    if a.ndim > 1: a = a.mean(axis=1)
    a /= 32768.0
    if sr != SR: a = resample_poly(a, SR, sr)
    m = np.abs(a).max(); return a / m if m > 0 else a


def sos(kind, f, order=4):
    if kind == "bp": return butter(order, [f[0] / (SR / 2), f[1] / (SR / 2)], btype="band", output="sos")
    return butter(order, f / (SR / 2), btype=kind, output="sos")
def filt(x, kind, f, order=4): return sosfilt(sos(kind, f, order), x)
def noise(n): return rng.standard_normal(n)
def env_exp(n, tau, attack=0.0004):
    t = np.arange(n) / SR; return np.exp(-t / tau) * np.clip(t / attack, 0, 1)
def save(name, x, peak=0.95):
    x = np.asarray(x, np.float64); m = np.abs(x).max()
    if m > 0: x = x / m * peak
    wavfile.write(os.path.join(OUT, name + ".wav"), SR, (x * 32767).astype(np.int16))


def pistol_shot():
    n = int(0.5 * SR); t = np.arange(n) / SR
    crack = filt(noise(n), "hp", 1500) * env_exp(n, 0.0028 * rng.uniform(0.85, 1.2))
    body = filt(noise(n), "bp", (180, 2800)) * env_exp(n, 0.035 * rng.uniform(0.9, 1.15), 0.0006)
    f0 = 135 * rng.uniform(0.92, 1.08)
    thump = np.sin(2 * np.pi * (50 * t + (f0 - 50) * 0.03 * (1 - np.exp(-t / 0.03)))) * env_exp(n, 0.075)
    mech = np.zeros(n); k = int(0.011 * SR)
    mech[k:] = filt(noise(n - k), "bp", (2200, 6500)) * env_exp(n - k, 0.005) * 0.5
    return crack * 1.2 + body * 1.0 + thump * 1.4 + mech * 0.3


def rifle_shot():
    n = int(0.6 * SR); t = np.arange(n) / SR
    crack = filt(noise(n), "hp", 2200) * env_exp(n, 0.0020)
    body = filt(noise(n), "bp", (120, 3600)) * env_exp(n, 0.05 * rng.uniform(0.9, 1.15), 0.0005)
    f0 = 105 * rng.uniform(0.92, 1.08)
    thump = np.sin(2 * np.pi * (38 * t + (f0 - 38) * 0.04 * (1 - np.exp(-t / 0.04)))) * env_exp(n, 0.11)
    return crack * 1.3 + body * 1.2 + thump * 1.6


def grains(dur, count, lo=2500, decay=0.16):
    n = int(dur * SR); g = np.zeros(n)
    for _ in range(count):
        k = rng.integers(0, n - 600); L = rng.integers(60, 500)
        g[k:k + L] += filt(noise(L), "hp", lo, 2) * np.hanning(L) * rng.uniform(0.2, 1.0) * math.exp(-k / SR / decay)
    return g


shots_w = [load(f"shot_{i}.wav") for i in range(6)]
eshots_w = [load(f"eshot_{i}.wav") for i in range(4)]
for i in range(4):
    a = pistol_shot() * 7.0; b = shots_w[i] * 2.5; n = max(len(a), len(b)); x = np.zeros(n); x[:len(a)] += a; x[:len(b)] += b; save(f"pistol_{i}", x)
    a = rifle_shot() * 4.2; b = eshots_w[i] * 1.6; n = max(len(a), len(b)); x = np.zeros(n); x[:len(a)] += a; x[:len(b)] += b; save(f"rifle_{i}", x)
for i in range(3):
    n = int(0.05 * SR); sn = filt(noise(n), "hp", 3500) * env_exp(n, 0.0012, 0.0001)
    w = load(f"whizz_{i}.wav"); x = np.zeros(max(n, len(w))); x[:n] += sn * 2.2; x[:len(w)] += w * 0.5; save(f"snap_{i}", x)
for i in range(4):
    w = load(f"impact_{i}.wav"); g = grains(0.5, 26); x = np.zeros(int(0.56 * SR)); x[:len(w)] += w * 1.4; x[int(0.03 * SR):int(0.03 * SR) + len(g)] += g * 0.35; save(f"impact_{i}", x)
    save(f"casing_{i}", load(f"casing_{i}.wav"))
for i in range(6):
    w = filt(load(f"step_{i}.wav"), "lp", 2500); n = int(0.18 * SR); c = np.zeros(n)
    for _ in range(rng.integers(8, 16)):
        k = rng.integers(0, n - 400); L = rng.integers(40, 380); c[k:k + L] += filt(noise(L), "hp", 3000, 2) * np.hanning(L) * rng.uniform(0.2, 1.0)
    x = np.zeros(max(n, len(w)) + 600); x[:len(w)] += w; x[480:480 + n] += c * 0.55; save(f"step_{i}", x)
for i in range(2):
    save(f"bodyfall_{i}", filt(load(f"fall_{i}.wav"), "lp", 1800))
n = int(0.35 * SR); c = np.zeros(n)
for k0, a in ((0, 1.0), (int(0.07 * SR), 0.5), (int(0.13 * SR), 0.3)):
    L = n - k0; tt = np.arange(L) / SR
    c[k0:] += a * (filt(noise(L), "bp", (1800, 5200)) * np.exp(-tt / 0.02) + 0.3 * np.sin(2 * np.pi * 2350 * tt) * np.exp(-tt / 0.05))
save("rifledrop", c)
for src, dst in (("mag_out.wav", "mag_out"), ("mag_in.wav", "mag_in"), ("bolt.wav", "slide"), ("empty_click.wav", "dry")):
    save(dst, load(src))
n = int(0.12 * SR); save("thud", filt(noise(n), "lp", 420) * env_exp(n, 0.03, 0.002))
# 呼吸（吸 / 呼）
ni = int(0.42 * SR); save("breath_in", filt(noise(ni), "bp", (900, 3200), 2) * np.sin(np.linspace(0, np.pi, ni)) ** 1.5)
ne = int(0.55 * SR); save("breath_out", filt(noise(ne), "bp", (350, 1700), 2) * np.sin(np.linspace(0, np.pi, ne)) ** 0.8)
n = int(0.22 * SR); save("gasp", filt(noise(n), "bp", (1100, 3800), 2) * np.sin(np.linspace(0, np.pi, n)) ** 0.6)
# 可循环的底噪：室内底噪 + 门外的风；衣物摩擦
def loopable(x, fade=0.25):
    f = int(fade * SR); y = x[:-f].copy(); w = np.linspace(0, 1, f); y[:f] = y[:f] * w + x[-f:] * (1 - w); return y
N = int(8.25 * SR)
room = filt(noise(N), "lp", 500, 2) * 0.004 + filt(noise(N), "bp", (200, 4000), 2) * 0.0016
wind = filt(noise(N), "lp", 700, 2) * (0.5 + 0.5 * np.abs(filt(noise(N), "lp", 0.4, 2)) * 40) * 0.0022
x = loopable(room + wind); wavfile.write(os.path.join(OUT, "tone.wav"), SR, (np.clip(x / 0.02, -1, 1) * 32767).astype(np.int16))      # 实际电平 = 文件 × 0.02
N = int(3.25 * SR); r = filt(noise(N), "bp", (350, 2600), 2) * (0.6 + 0.4 * np.abs(filt(noise(N), "lp", 14, 2)) * 6)
save("rustle", loopable(r), 0.9)
# 混响脉冲：把大厅脉冲收短成空旷混凝土房间
ir = load("ir_hall.wav"); ti = np.arange(len(ir)) / SR
ir = filt(ir * np.exp(-ti / 0.55), "hp", 160, 2); ir /= np.sqrt((ir ** 2).sum())
er = np.zeros(len(ir))
for d_ms, a in ((9, 0.5), (17, 0.38), (23, 0.3), (31, 0.22), (44, 0.16)):
    er[int(d_ms / 1000 * SR)] = a
ir2 = ir * 0.9 + er * 0.25
wavfile.write(os.path.join(OUT, "ir.wav"), SR, (np.clip(ir2 / np.abs(ir2).max() * 0.95, -1, 1) * 32767).astype(np.int16))
print("sfx:", len(os.listdir(OUT)), "files", sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT)) // 1024, "KB")
