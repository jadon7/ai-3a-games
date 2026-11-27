"""池核场景的几个水声（全部合成）：踩水 splash_0..2、弹壳落水 plop、室内泳池的底噪 water（可循环）。
  .venv/bin/python scripts/game_sfx_pool.py
"""
import os
import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, sosfilt

SR = 48000
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "game", "assets", "sfx")
rng = np.random.default_rng(37)
def bp(x, lo, hi, order=2): return sosfilt(butter(order, [lo, hi], btype="band", fs=SR, output="sos"), x)
def lp(x, f, order=2): return sosfilt(butter(order, f, btype="low", fs=SR, output="sos"), x)
def env(n, attack, decay): t = np.arange(n) / SR; return np.minimum(t / attack, 1.0) * np.exp(-np.maximum(t - attack, 0) / decay)
def save(name, x, peak=0.9):
    x = x / (np.abs(x).max() + 1e-9) * peak
    wavfile.write(os.path.join(OUT, name + ".wav"), SR, (x * 32767).astype(np.int16))
    print(name, f"{len(x)/SR:.2f}s rms={np.sqrt((x**2).mean()):.3f}")

# 踩水：一下低沉的"噗"（水被脚推开）+ 稍后一片细碎的水花
for i in range(3):
    n = int(SR * 0.5)
    low = bp(rng.standard_normal(n), 180 + 40 * i, 900 + 150 * i) * env(n, 0.012, 0.07 + 0.015 * i)
    grains = np.zeros(n)
    for _ in range(26 + 6 * i):
        t0 = int(SR * (0.02 + rng.random() ** 1.6 * 0.3)); m = int(SR * rng.uniform(0.004, 0.016))
        if t0 + m < n: grains[t0:t0 + m] += rng.standard_normal(m) * np.hanning(m) * rng.uniform(0.3, 1.0) * np.exp(-(t0 / SR) / 0.13)
    spray = bp(grains, 1800, 7500)
    bub = np.zeros(n)          # 两三个小气泡的"咕"
    for _ in range(3):
        t0 = int(SR * rng.uniform(0.05, 0.25)); m = int(SR * 0.035); f0 = rng.uniform(500, 1100); tt = np.arange(m) / SR
        bub[t0:t0 + m] += np.sin(2 * np.pi * (f0 * tt + 0.5 * f0 * 9 * tt * tt)) * np.exp(-tt / 0.012) * 0.25
    save(f"splash_{i}", low * 1.0 + spray * 0.8 + bub * 0.5)

# 弹壳落水：一声上扬的"咚"
n = int(SR * 0.3); tt = np.arange(n) / SR
f = 420 + 700 * (1 - np.exp(-tt / 0.03))
save("plop", np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt / 0.045) + bp(rng.standard_normal(n), 2500, 6000) * env(n, 0.002, 0.012) * 0.25)

# 底噪：很轻的水面拍动（慢慢起伏的中频噪声）+ 远处的循环泵嗡声 + 零星的水滴
n = SR * 8; tt = np.arange(n) / SR
mod = 0.55 + 0.45 * np.clip(lp(rng.standard_normal(n), 0.7) * 60, -1, 1)
lap = bp(rng.standard_normal(n), 350, 2200) * mod
hum = (np.sin(2 * np.pi * 49.5 * tt) + 0.4 * np.sin(2 * np.pi * 99 * tt + 1.0) + 0.15 * np.sin(2 * np.pi * 148.5 * tt)) * 0.5
drips = np.zeros(n)
for _ in range(9):
    t0 = int(rng.uniform(0.3, 7.4) * SR); m = int(SR * 0.09); t2 = np.arange(m) / SR; f0 = rng.uniform(900, 1900)
    drips[t0:t0 + m] += np.sin(2 * np.pi * (f0 * t2 + 0.5 * f0 * 5 * t2 * t2)) * np.exp(-t2 / 0.02) * rng.uniform(0.3, 1.0)
x = lap / np.abs(lap).max() * 0.5 + hum * 0.28 + drips * 0.22
fade = int(SR * 0.4); w = np.linspace(0, 1, fade); x[:fade] = x[:fade] * w + x[-fade:] * (1 - w); x = x[:-fade]          # 首尾交叠，循环处没有接缝
save("water", x, peak=0.6)
