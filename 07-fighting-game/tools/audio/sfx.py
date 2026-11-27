"""全部音效的程序化合成。用法：python sfx.py [名字前缀 ...]（不给参数就全部生成）。

每个音效都是叠层：瞬态（噪声爆破）+ 身体（低频正弦下滑）+ 质感层 + 短空间尾巴。
"""
import sys
import json
import os
import numpy as np
from dsp import *  # noqa
from dsp import SR
import master as M


def nz(x):
    return x / (np.max(np.abs(x)) + 1e-12)


def R(seed):
    return np.random.default_rng(seed)


def env_n(x_dur, tau, attack=0.0005):
    return expdecay(n_of(x_dur), tau, attack)


def nburst(rng, dur, lo, hi, tau, attack=0.0002, order=2):
    return bp(noise(dur, rng), lo, hi, order) * env_n(dur, tau, attack)


def body(dur, f0, f1, ftau, atau, attack=0.0006, phase0=np.pi / 2 * 0):
    return sweep(dur, f0, f1, ftau) * env_n(dur, atau, attack)


def room(x, rng, dur=0.3, wet=0.12, stereo=False, lo=250, hi=6000):
    x = fade(x, 0, min(0.3, x.shape[-1] / SR * 0.2))  # 干声末尾收干净，避免层被截断
    ir = reverb_ir(dur, rng, stereo=stereo, lo=lo, hi=hi)
    return apply_reverb(x, ir, wet)


def am_noise(rng, dur, rate, depth=0.8):
    """随机幅度调制（布料抖动、湿润感）"""
    m = lp(noise(dur, rng), rate, order=2)
    m = m / (np.max(np.abs(m)) + 1e-9)
    return 1 - depth + depth * np.abs(m)


def pings(rng, dur, count, t_mean, flo, fhi, tlo, thi, amp_decay=0.15, start=0.0):
    """随机一串短正弦叮声（玻璃、冰晶、碎屑）。"""
    out = np.zeros(n_of(dur))
    for _ in range(count):
        at = start + rng.exponential(t_mean)
        if at > dur - 0.02:
            continue
        f = np.exp(rng.uniform(np.log(flo), np.log(fhi)))
        tau = rng.uniform(tlo, thi)
        d = min(tau * 6, dur - at)
        p = np.sin(2 * np.pi * f * tt(d) + rng.uniform(0, 6.28)) * expdecay(n_of(d), tau, 0.0002)
        p += 0.4 * np.sin(2 * np.pi * f * 2.76 * tt(d)) * expdecay(n_of(d), tau * 0.5, 0.0002)
        a = rng.uniform(0.3, 1.0) * np.exp(-(at - start) / amp_decay)
        i = int(at * SR)
        out[i:i + len(p)] += a * p[: len(out) - i]
    return out


def whoosh_core(rng, dur, fs, fp, fe, q, peak=0.45, sharp=2.0):
    n = n_of(dur)
    u = np.linspace(0, 1, n)
    lf = np.interp(u, [0, peak, 1], np.log([fs, fp, fe]))
    fc = np.exp(lf)
    x = svf(noise(dur, rng), fc, q, 'bp')
    return x * bell_env(n, peak, sharp)


def taiko(rng, big=1.0, f0=95, f1=56, dur=1.2):
    """太鼓：低频下滑 + 第二模态 + 鼓皮噪声 + 鼓槌瞬态。"""
    b = body(dur, f0 * 1.25, f0 * 0.62 if f1 is None else f1, 0.06, 0.32 * big, 0.001)
    b2 = sweep(dur, f0 * 1.6 * 1.25, f0 * 1.6 * 0.66, 0.05) * env_n(dur, 0.09, 0.001) * 0.35
    skin = lp(noise(dur, rng), 700) * env_n(dur, 0.05, 0.001) * 0.5
    stick = nburst(rng, dur, 900, 3500, 0.004) * 0.35
    return sat(b + b2 + skin + stick, 1.3)


def shime(rng, f0=330, dur=0.4):
    """小太鼓（締太鼓）：高而紧。"""
    b = body(dur, f0 * 1.2, f0, 0.01, 0.06, 0.0005)
    skin = bp(noise(dur, rng), 800, 5000) * env_n(dur, 0.018, 0.0003) * 0.6
    return b * 0.7 + skin


def ka(rng, dur=0.15):
    """鼓边（木头声）"""
    w = partials(dur, [1150, 2650], [0.5, 0.25], [0.02, 0.01], rng)
    return w + nburst(rng, dur, 1500, 5000, 0.004) * 0.6


def bell(rng, f, dur=4.0, bright=1.0):
    """寺钟：非谐分音 + 拍频。"""
    ratios = [0.5, 1.0, 1.19, 1.5, 2.0, 2.52, 2.66, 3.01, 4.07, 5.2]
    amps = [0.6, 0.5, 0.35, 0.25, 0.4, 0.15, 0.12, 0.1 * bright, 0.08 * bright, 0.05 * bright]
    taus = [dur * 0.55, dur * 0.4, dur * 0.33, dur * 0.25, dur * 0.22, 0.6, 0.5, 0.35, 0.25, 0.15]
    out = partials(dur, [f * r for r in ratios], amps, taus, rng, detune=0.001)
    out += partials(dur, [f * r * 1.0035 for r in ratios[:5]], [a * 0.5 for a in amps[:5]], taus[:5], rng)
    strike = nburst(rng, dur, 400, 3000, 0.006) * 0.3
    return out + strike


# ================= 打击 =================
def hit_light(v):
    rng = R(100 + v)
    k = [1.0, 1.08, 0.93][v]
    d = 0.26
    # 身体 + 骨肉：一起轻微饱和
    meat = mix(
        (body(d, 260 * k, 120 * k, 0.018, 0.038), 0, 1.0),
        (bp(noise(0.12, rng), 250, 1400) * env_n(0.12, 0.025, 0.001), 0.001, 0.7),
    )
    meat = sat(meat / np.max(np.abs(meat)), 1.8)
    # 瞬态：干净叠在上面
    x = mix(
        (meat, 0, 1.0),
        (nz(nburst(rng, d, 2000, 6000, 0.004)), 0, 0.9),
        (nz(hp(noise(0.02, rng), 5000) * env_n(0.02, 0.0015, 0.0001)), 0, 0.35),
        (nz(nburst(rng, 0.05, 1000, 3000, 0.008)), 0.0005, 0.5),
    )
    return room(x, rng, 0.25, 0.10)


def hit_heavy(v):
    rng = R(200 + v)
    k = [1.0, 0.92, 1.07][v]
    d = 0.75
    crunch = crackle(0.09, rng, 1200, env_n(0.09, 0.03, 0.0005), 700, 4000) * 3
    meat = mix(
        (body(d, 155 * k, 62 * k, 0.045, 0.13, 0.0008), 0, 1.1),
        (body(d, 90 * k, 40 * k, 0.1, 0.24, 0.003), 0, 0.8),
        (crunch, 0.002, 0.6),
        (bp(noise(0.2, rng), 350, 2000) * env_n(0.2, 0.045, 0.001), 0.001, 0.7),
    )
    meat = sat(meat / np.max(np.abs(meat)), 2.6)  # 重击多一点失真
    x = mix(
        (meat, 0, 1.0),
        (nz(nburst(rng, d, 1500, 5500, 0.005)), 0, 0.85),
        (nz(hp(noise(0.02, rng), 4000) * env_n(0.02, 0.002, 0.0001)), 0, 0.35),
    )
    return room(x, rng, 0.45, 0.14)


def hit_slash(v):
    rng = R(300 + v)
    k = [1.0, 1.06, 0.95][v]
    d = 0.5
    wet = bp(noise(0.18, rng), 500, 1800) * env_n(0.18, 0.05, 0.001) * am_noise(rng, 0.18, 120, 0.9)
    shing = bp(noise(0.12, rng), 3000, 9500) * bell_env(n_of(0.12), 0.12, 1.5)
    ring = partials(d, [2350 * k, 3720 * k, 5150 * k, 6900 * k], [0.25, 0.18, 0.12, 0.08],
                    [0.12, 0.09, 0.07, 0.05], rng, detune=0.01)
    x = mix(
        (nburst(rng, d, 2500, 7500, 0.003), 0, 0.9),
        (shing, 0, 0.7),
        (ring, 0.002, 0.55),
        (wet, 0.006, 0.9),
        (body(d, 190, 90, 0.02, 0.05), 0, 0.6),
    )
    x = sat(x / np.max(np.abs(x)), 1.4)
    return room(x, rng, 0.35, 0.14)


def fire_burst(rng, dur=0.6, size=1.0):
    n = n_of(dur)
    t = tt(dur)
    fc = 600 + 7000 * np.exp(-t / (0.08 * size))
    roar = svf(noise(dur, rng), fc, 0.6, 'lp') * expdecay(n, 0.18 * size, 0.004) * am_noise(rng, dur, 25, 0.5)
    cr = crackle(dur, rng, 1500 * np.exp(-t / (0.25 * size)) + 80, expdecay(n_of(dur), 0.2 * size, 0.002), 1500, 9000, 0.0015) * 1.0
    whoomp = body(dur, 110, 45, 0.05, 0.12 * size, 0.004) * 0.5
    return fade(roar + cr + whoomp, 0, dur * 0.35)


def hit_fire(v):
    rng = R(400 + v)
    h = hit_heavy(v + 1 if v < 2 else 0)
    f = fire_burst(rng, 0.7, 1.0 + 0.15 * v)
    return mix((h, 0, 1.0), (f, 0.004, 0.75 * np.max(np.abs(h)) / (np.max(np.abs(f)) + 1e-9)))


def ice_crack(rng, dur=0.5, size=1.0, fl=1500, fh=7500):
    t = tt(dur)
    crack = nburst(rng, dur, 1500, 9000, 0.0025) * 1.2
    cr = crackle(dur, rng, 2500 * np.exp(-t / (0.04 * size)), expdecay(n_of(dur), 0.08 * size, 0.0005), 2500, 10000, 0.001) * 2
    pg = pings(rng, dur, int(35 * size), 0.06 * size, fl, fh, 0.01, 0.05, 0.12 * size)
    return crack + cr + pg * 0.6


def hit_frost(v):
    rng = R(500 + v)
    h = hit_light(v)
    ic = ice_crack(rng, 0.6, 1.0 + 0.2 * v)
    shimmer = partials(0.6, [3520, 4186, 5274], [0.2, 0.15, 0.1], [0.18, 0.15, 0.1], rng, detune=0.004)
    ice = ic + shimmer
    hmax = np.max(np.abs(h))
    return mix((h, 0, 1.0), (body(0.5, 170, 75, 0.04, 0.09), 0, 0.5 * hmax),
               (ice, 0.0015, 0.8 * hmax / (np.max(np.abs(ice)) + 1e-9)))


def block(v):
    rng = R(600 + v)
    k = [1.0, 1.1][v]
    d = 0.3
    x = mix(
        (body(d, 250 * k, 125 * k, 0.02, 0.045), 0, 1.0),
        (lp(noise(d, rng), 1500) * env_n(d, 0.03, 0.0008), 0, 0.7),
        (nburst(rng, d, 1000, 3000, 0.003), 0, 0.35),
        (bp(noise(0.15, rng), 200, 800) * env_n(0.15, 0.04, 0.003) * am_noise(rng, 0.15, 60), 0.004, 0.4),
    )
    x = lp(sat(x / np.max(np.abs(x)), 1.3), 3800)
    return room(x, rng, 0.22, 0.08)


def block_blade(v):
    rng = R(700 + v)
    f0 = [760, 860][v]
    d = 0.9
    ratios = [1, 2.76, 5.40, 8.93]
    clang = partials(d, [f0 * r for r in ratios], [0.5, 0.35, 0.25, 0.12], [0.35, 0.25, 0.15, 0.08], rng)
    clang += partials(d, [f0 * r * 1.004 for r in ratios], [0.3, 0.2, 0.12, 0.06], [0.35, 0.25, 0.15, 0.08], rng)
    scrape = bp(noise(0.15, rng), 2000, 6500) * env_n(0.15, 0.05, 0.001) * am_noise(rng, 0.15, 200, 0.6)
    x = mix(
        (hp(noise(0.03, rng), 2500) * env_n(0.03, 0.005, 0.0001), 0, 0.9),
        (clang, 0, 0.8),
        (scrape, 0.003, 0.4),
        (body(0.3, 210, 110, 0.02, 0.05), 0, 0.5),
    )
    x = sat(x / np.max(np.abs(x)), 1.3)
    return room(x, rng, 0.6, 0.18, stereo=True)


def parry(v):
    rng = R(800)
    f0 = 1650
    d = 1.4
    ratios = [1, 1.003, 2.32, 2.76, 4.07, 5.4]
    ting = partials(d, [f0 * r for r in ratios], [0.5, 0.4, 0.3, 0.25, 0.15, 0.08],
                    [0.9, 0.9, 0.5, 0.4, 0.25, 0.15], rng)
    shwing = bp(noise(0.3, rng), 4000, 11000) * bell_env(n_of(0.3), 0.15, 1.5)
    x = mix(
        (hp(noise(0.03, rng), 6000) * env_n(0.03, 0.02 / 4, 0.0001), 0, 0.8),
        (nburst(rng, 0.1, 2000, 6000, 0.004), 0, 0.8),
        (body(0.4, 170, 70, 0.03, 0.09), 0, 1.0),
        (ting, 0.001, 0.75),
        (shwing, 0.01, 0.2),
    )
    x = sat(x / np.max(np.abs(x)), 1.3)
    return room(x, rng, 1.4, 0.22, stereo=True, hi=9000)


def guard_break(v):
    rng = R(900)
    d = 1.0
    glass = pings(rng, d, 70, 0.07, 2500, 9000, 0.008, 0.04, 0.15)
    t = tt(d)
    cr = crackle(d, rng, 3500 * np.exp(-t / 0.08) + 50, expdecay(n_of(d), 0.15, 0.001), 3000, 11000, 0.0012) * 2
    x = mix(
        (nburst(rng, d, 1200, 8000, 0.004), 0, 1.0),
        (body(d, 130, 45, 0.06, 0.2, 0.001), 0, 1.0),
        (body(d, 80, 34, 0.12, 0.3, 0.003), 0, 0.6),
        (glass, 0.003, 0.6),
        (cr, 0.002, 0.5),
    )
    x = sat(x / np.max(np.abs(x)), 2.0)
    return room(x, rng, 0.9, 0.18, stereo=True, hi=9000)


# ================= 破风 =================
def whoosh_light(v):
    rng = R(1000 + v)
    d = [0.2, 0.18, 0.22][v]
    k = [1.0, 1.12, 0.9][v]
    a = whoosh_core(rng, d, 700 * k, 2600 * k, 1400 * k, 1.2, 0.45)
    b = lp(noise(d, rng), 4000) * bell_env(n_of(d), 0.45) * 0.15
    return a + b


def whoosh_heavy(v):
    rng = R(1100 + v)
    d = [0.38, 0.42, 0.35][v]
    k = [1.0, 0.9, 1.1][v]
    a = whoosh_core(rng, d, 250 * k, 1100 * k, 450 * k, 1.0, 0.5)
    rumble = lp(noise(d, rng), 300) * bell_env(n_of(d), 0.5) * 0.7
    cloth = bp(noise(d, rng), 300, 2000) * bell_env(n_of(d), 0.45) * am_noise(rng, d, 35, 0.9) * 0.35
    return a + rumble + cloth


def whoosh_blade(v):
    rng = R(1200 + v)
    d = [0.24, 0.22, 0.26][v]
    k = [1.0, 1.1, 0.92][v]
    a = whoosh_core(rng, d, 1800 * k, 6500 * k, 3000 * k, 3.0, 0.5, 2.5)
    b = whoosh_core(rng, d, 2900 * k, 10000 * k, 4800 * k, 9.0, 0.52, 2.5) * 0.6
    air = hp(noise(d, rng), 5000) * bell_env(n_of(d), 0.5, 2.5) * 0.12
    return a + b + air


# ================= 移动 =================
def step(v):
    rng = R(1300 + v)
    d = 0.18
    x = mix(
        (nburst(rng, d, 1500, 5000, 0.002), 0, 0.6),
        (body(d, 140, 85, 0.015, 0.03), 0, 0.7),
        (crackle(0.07, rng, 1500, env_n(0.07, 0.02), 2000, 7000), 0.002, 1.2),
        (bp(noise(0.08, rng), 800, 3000) * env_n(0.08, 0.035, 0.004) * am_noise(rng, 0.08, 300), 0.004, 0.35),
    )
    return room(x, rng, 0.15, 0.06)


def cloth(rng, d, rate=35, lo=300, hi=2500, peak=0.4):
    return bp(noise(d, rng), lo, hi) * bell_env(n_of(d), peak) * am_noise(rng, d, rate, 0.9)


def jump(v):
    rng = R(1400)
    x = mix(
        (step(1) * 0.8, 0, 1.0),
        (cloth(rng, 0.3, 40), 0.01, 0.4),
        (whoosh_core(rng, 0.25, 400, 1500, 900, 1.2, 0.35), 0.02, 0.5),
    )
    return x


def land(v):
    rng = R(1500)
    d = 0.45
    x = mix(
        (nburst(rng, d, 1200, 4500, 0.003), 0, 0.7),
        (body(d, 125, 50, 0.03, 0.09, 0.0008), 0, 1.0),
        (crackle(0.12, rng, 2500, env_n(0.12, 0.035), 1800, 7000), 0.002, 1.6),
        (cloth(rng, 0.2, 40, peak=0.2), 0.0, 0.3),
    )
    x = sat(x / np.max(np.abs(x)), 1.4)
    return room(x, rng, 0.3, 0.1)


def dash(v):
    rng = R(1600)
    d = 0.36
    x = mix(
        (whoosh_core(rng, d, 600, 2200, 900, 1.1, 0.35), 0, 1.0),
        (cloth(rng, d, 38, peak=0.3), 0, 0.6),
        (crackle(0.12, rng, 1200, env_n(0.12, 0.05), 1500, 6000), 0, 0.8),
        (body(0.15, 130, 80, 0.015, 0.03), 0, 0.35),
    )
    return x


def bodyfall(v):
    rng = R(1700 + v)
    d = 0.9
    k = [1.0, 0.92][v]

    def thud(g, kk):
        return mix(
            (nburst(rng, 0.1, 800, 3500, 0.004), 0, 0.4 * g),
            (body(d * 0.8, 95 * kk, 42 * kk, 0.05, 0.13, 0.0012), 0, 1.0 * g),
            (lp(noise(0.25, rng), 900) * env_n(0.25, 0.05, 0.002), 0, 0.6 * g),
            (crackle(0.15, rng, 1500, env_n(0.15, 0.05), 1500, 6000), 0.003, 1.0 * g),
        )
    x = mix((thud(1.0, k), 0, 1.0), (thud(0.55, k * 1.2), 0.13 + 0.03 * v, 1.0),
            (cloth(rng, 0.4, 30, peak=0.2), 0.0, 0.25))
    x = sat(x / np.max(np.abs(x)), 1.5)
    return room(x, rng, 0.5, 0.1)


# ================= 火 =================
def fire_charge(v):
    rng = R(1800)
    d = 0.62
    n = n_of(d)
    t = tt(d)
    u = t / d
    rise = u ** 1.6
    rumble = svf(noise(d, rng), 200 * (15 ** u), 0.9, 'lp') * rise
    f = 55 * (4 ** u)
    tone = sum(np.sin(2 * np.pi * np.cumsum(f * h) / SR) / h for h in range(1, 7))
    tone = lp(sat(tone * 1.5, 2.0), 1800) * rise * 0.45
    cr = crackle(d, rng, 40 + 900 * u ** 2, rise, 1500, 9000, 0.0015) * 2.5
    x = rumble + tone + cr
    x = x * am_noise(rng, d, 18, 0.35)
    return fade(x, 0.02, 0.03)


def fire_blast(v):
    rng = R(1900)
    d = 1.1
    t = tt(d)
    x = mix(
        (nburst(rng, d, 1200, 6000, 0.005), 0, 0.8),
        (body(d, 115, 40, 0.08, 0.25, 0.002), 0, 1.0),
        (svf(noise(d, rng), 600 + 7000 * np.exp(-t / 0.15), 0.6, 'lp') * expdecay(n_of(d), 0.35, 0.004), 0, 1.2),
        (crackle(d, rng, 1200 * np.exp(-t / 0.4) + 60, expdecay(n_of(d), 0.4, 0.002), 1500, 9000, 0.0015), 0, 0.8),
    )
    x = sat(x / np.max(np.abs(x)), 1.6)
    return room(x, rng, 1.0, 0.2, stereo=True)


def fire_fly(v):
    rng = R(2000)
    L, X, pre = 1.0, 0.2, 0.25
    d = L + X + pre
    t = tt(d)
    roar = lp(noise(d, rng), 1800) * (0.65 + 0.35 * np.sin(2 * np.pi * 11 * t)) * am_noise(rng, d, 6, 0.4)
    rumble = lp(noise(d, rng), 220) * 1.6
    cr = crackle(d, rng, 260, None, 1500, 9000, 0.0015) * 3
    hiss = bp(noise(d, rng), 3000, 8000) * 0.12
    x = (roar + rumble + cr + hiss)[n_of(pre):]
    return loop_xfade(x, n_of(L), n_of(X))


def fire_explode(v):
    rng = R(2100 + v)
    d = 1.4
    t = tt(d)
    k = [1.0, 0.9][v]
    x = mix(
        (nburst(rng, d, 1000, 6000, 0.006), 0, 0.9),
        (body(d, 80 * k, 30 * k, 0.12, 0.4, 0.002), 0, 1.3),
        (body(d, 140 * k, 55 * k, 0.04, 0.12, 0.001), 0, 0.6),
        (svf(noise(d, rng), 400 + 8000 * np.exp(-t / 0.12), 0.6, 'lp') * expdecay(n_of(d), 0.45, 0.003), 0, 1.3),
        (crackle(d, rng, 3000 * np.exp(-t / 0.3) + 100, expdecay(n_of(d), 0.5, 0.002), 1200, 9000, 0.002), 0.01, 0.9),
    )
    x = sat(x / np.max(np.abs(x)), 2.0)
    return room(x, rng, 1.5, 0.25, stereo=True)


# ================= 霜 =================
def frost_charge(v):
    rng = R(2200)
    d = 0.62
    t = tt(d)
    u = t / d
    rise = u ** 1.3
    f = 700 * (2.6 ** u)
    sh = sum(a * osc_f(f * r * (1 + 0.002 * i)) for i, (r, a) in enumerate(zip([1, 1.5, 2, 3], [0.5, 0.35, 0.3, 0.15])))
    sh = sh * (0.7 + 0.3 * np.sin(2 * np.pi * 18 * t)) * rise
    air = hp(noise(d, rng), 5000) * rise * 0.25
    ticks = pings(rng, d, 40, 0.35, 4000, 10000, 0.004, 0.015, 10.0) * (0.3 + u)
    return fade(sh * 0.5 + air + ticks * 0.5, 0.03, 0.03)


def frost_wave(v):
    rng = R(2300)
    d = 0.9
    t = tt(d)
    chord = partials(d, [1320, 1980, 2640, 3960, 5280], [0.4, 0.3, 0.25, 0.15, 0.1], [0.35, 0.3, 0.25, 0.18, 0.12], rng, 0.003)
    x = mix(
        (hp(noise(0.03, rng), 3000) * env_n(0.03, 0.002, 0.0001), 0, 1.0),
        (whoosh_core(rng, 0.35, 2000, 7000, 3500, 2.0, 0.25), 0, 0.9),
        (chord, 0.002, 0.6),
        (crackle(d, rng, 2000 * np.exp(-t / 0.06) + 30, expdecay(n_of(d), 0.15, 0.001), 4000, 11000, 0.001), 0, 1.0),
        (body(0.3, 200, 100, 0.02, 0.05), 0, 0.4),
    )
    return room(x, rng, 1.2, 0.3, stereo=True, hi=10000)


def frost_fly(v):
    rng = R(2400)
    L, X, pre = 1.0, 0.2, 0.25
    d = L + X + pre
    t = tt(d)
    hiss = hp(noise(d, rng), 3500) * (0.7 + 0.3 * np.sin(2 * np.pi * 3 * t)) * 0.4
    # 整数赫兹 + 整数拍频：1 秒周期严格闭合
    sh = sum(a * (np.sin(2 * np.pi * f * t) + np.sin(2 * np.pi * (f + b) * t))
             for f, b, a in [(3136, 3, 0.2), (3951, 5, 0.15), (4699, 4, 0.12), (6272, 7, 0.08)])
    whistle = svf(noise(d, rng), 2600, 12, 'bp') * 0.5
    ticks = pings(rng, d, 1, 1, 4000, 9000, 0.004, 0.01, 10)  # 占位，下面加均匀的
    ticks = crackle(d, rng, 25, None, 4000, 11000, 0.003) * 1.5
    x = (hiss + sh + whistle + ticks)[n_of(pre):]
    return loop_xfade(x, n_of(L), n_of(X))


def frost_shatter(v):
    rng = R(2500 + v)
    d = 1.0
    x = mix(
        (ice_crack(rng, d, 1.3 + 0.3 * v, 1500, 7000), 0, 1.0),
        (body(0.4, 180, 80, 0.02, 0.06), 0, 0.6),
        (pings(rng, d, 14, 0.2, 2500, 8000, 0.01, 0.04, 0.4, start=0.1), 0, 0.3),
    )
    x = sat(x / np.max(np.abs(x)), 1.3)
    return room(x, rng, 1.0, 0.2, stereo=True, hi=10000)


def frost_spike(v):
    rng = R(2600)
    d = 1.1
    x = np.zeros(1)
    for i in range(4):
        g = 0.6 + 0.15 * i
        burst = mix(
            (body(0.3, 95 + 30 * i, 50 + 15 * i, 0.02, 0.06 + 0.02 * (i == 3)), 0, 1.0 * g),
            (ice_crack(rng, 0.4, 0.5 + 0.2 * i, 1200 * (1 + 0.25 * i), 5000 * (1 + 0.25 * i)), 0, 0.8 * g),
        )
        x = place(x, burst, 0.09 * i)
    x = sat(x / np.max(np.abs(x)), 1.4)
    return room(x, rng, 1.0, 0.2, stereo=True, hi=10000)


# ================= 大招 =================
def super_freeze(v):
    rng = R(2700)
    cut = 0.65
    boom = body(cut, 120, 40, 0.1, 0.25, 0.001) + lp(noise(cut, rng), 900) * env_n(cut, 0.2) * 0.6
    inhale = boom[::-1] * np.linspace(0, 1, n_of(cut)) ** 0.5
    air = svf(noise(cut, rng), 500 * 8 ** (tt(cut) / cut), 2.0, 'bp') * (tt(cut) / cut) ** 2 * 0.6
    td = 0.55
    tu = tt(td)
    f = 800 * 5 ** (tu / 0.35)
    f = np.minimum(f, 4000)
    tone = (osc_f(f) * 0.5 + osc_f(f * 1.5) * 0.25 + osc_f(f * 2.01) * 0.15) * expdecay(n_of(td), 0.25, 0.005)
    x = mix(
        (inhale, 0, 1.0), (air, 0, 1.0),
        (hp(noise(0.02, rng), 3000) * env_n(0.02, 0.002, 0.0001), cut - 0.002, 0.8),
        (tone, cut - 0.15, 0.55),
    )
    return room(fade(x, 0.01, 0.05), rng, 1.5, 0.3, stereo=True, hi=10000)


def super_fire(v):
    rng = R(2800)
    d = 2.4
    t = tt(d)
    x = mix(
        (nburst(rng, d, 1000, 6000, 0.006), 0, 1.0),
        (body(d, 70, 28, 0.2, 0.7, 0.003), 0, 1.4),
        (body(d, 120, 45, 0.06, 0.25, 0.001), 0, 0.8),
        (body(d, 95, 35, 0.1, 0.4, 0.002), 0.05, 0.7),
        (svf(noise(d, rng), 300 + 9000 * np.exp(-t / 0.4), 0.6, 'lp') * expdecay(n_of(d), 0.9, 0.003)
         * am_noise(rng, d, 14, 0.4), 0, 1.4),
        (crackle(d, rng, 2500 * np.exp(-t / 0.6) + 150, expdecay(n_of(d), 0.8, 0.002), 1200, 9000, 0.002), 0.01, 0.9),
    )
    x = sat(x / np.max(np.abs(x)), 2.2)
    return room(x, rng, 3.0, 0.32, stereo=True)


def super_frost(v):
    rng = R(2900)
    d = 2.4
    shimmer = partials(d, [2093, 2637, 3136, 4186, 5274, 6272], [0.3, 0.25, 0.2, 0.15, 0.1, 0.08],
                       [1.2, 1.0, 0.9, 0.7, 0.5, 0.4], rng, 0.003)
    shimmer *= np.minimum(1, tt(d) / 0.05)
    x = mix(
        (ice_crack(rng, d, 2.5, 1200, 8000), 0, 1.0),
        (body(d, 80, 32, 0.15, 0.6, 0.003), 0, 1.4),
        (body(d, 160, 60, 0.04, 0.15, 0.001), 0, 0.6),
        (shimmer, 0.01, 0.35),
    )
    x = sat(x / np.max(np.abs(x)), 2.5)
    return room(x, rng, 3.0, 0.4, stereo=True, hi=10000)


def ko(v):
    rng = R(3000)
    d = 4.5
    t = tt(d)
    low = (np.sin(2 * np.pi * 41.2 * t) + 0.5 * np.sin(2 * np.pi * 82.4 * t) + 0.2 * np.sin(2 * np.pi * 123.6 * t))
    low *= expdecay(n_of(d), 1.6, 0.02)
    x = mix(
        (body(1.0, 110, 40, 0.08, 0.3, 0.001), 0, 0.9),
        (nburst(rng, 0.1, 1200, 5000, 0.005), 0, 0.5),
        (low, 0, 0.7),
        (bell(rng, 196, 4.2, 0.8), 0.05, 0.55),
    )
    x = sat(x / np.max(np.abs(x)), 1.3)
    return room(x, rng, 3.5, 0.3, stereo=True)


def round_gong(v):
    rng = R(3100)
    d = 4.5
    t = tt(d)
    f0 = 175
    ratios = [1, 1.52, 2.03, 2.6, 3.24, 3.9, 4.6, 5.8, 7.1, 8.3]
    glide = 1 - 0.035 * (1 - np.exp(-t / 0.6))
    out = np.zeros(len(t))
    for i, r in enumerate(ratios):
        a = 0.5 / (1 + 0.35 * i)
        tau = 2.2 / (1 + 0.25 * i)
        bloom = (1 - np.exp(-t / (0.02 + 0.03 * i))) if i > 2 else 1
        out += a * osc_f(f0 * r * glide * (1 + rng.uniform(-0.003, 0.003))) * np.exp(-t / tau) * bloom
    wash = bp(noise(d, rng), 1200, 7000) * (1 - np.exp(-t / 0.1)) * np.exp(-t / 0.9) * 0.15
    x = mix((out, 0, 1.0), (wash, 0, 1.0), (body(0.6, 120, 70, 0.03, 0.12), 0, 0.5),
            (nburst(rng, 0.05, 500, 2500, 0.005), 0, 0.3))
    x = sat(x / np.max(np.abs(x)), 1.2)
    return room(x, rng, 3.0, 0.3, stereo=True)


def fight_drum(v):
    rng = R(3200)
    hits = [(0.0, 0.8, 1.0), (0.18, 0.7, 1.02), (0.36, 0.75, 1.0), (0.45, 0.8, 1.05), (0.62, 1.25, 0.94)]
    x = np.zeros(1)
    for at, g, k in hits:
        x = place(x, taiko(rng, 1.0 + 0.5 * (g > 1), 95 * k, 56 * k, 1.0), at, g)
    x = place(x, ka(rng), 0.09, 0.35)
    x = place(x, ka(rng), 0.27, 0.35)
    x = sat(x / np.max(np.abs(x)), 1.3)
    return room(x, rng, 1.4, 0.25, stereo=True)


NOTE = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}


def hz(name):
    """'D4' / 'Bb3' -> 频率"""
    n = NOTE[name[0]]
    rest = name[1:]
    if rest.startswith('b'):
        n -= 1
        rest = rest[1:]
    elif rest.startswith('#'):
        n += 1
        rest = rest[1:]
    midi = 12 * (int(rest) + 1) + n
    return 440 * 2 ** ((midi - 69) / 12)


def win_sting(v):
    rng = R(3300)
    x = np.zeros((2, 1))
    arp = ['D4', 'F4', 'G4', 'A4', 'C5', 'D5', 'F5']
    for i, nm in enumerate(arp):
        p = pluck(hz(nm), 1.2, rng, 0.997, 0.7)
        x = place(x, pan(p, -0.4 + 0.12 * i), 0.07 * i, 0.5)
    for nm, pp in [('D4', -0.3), ('A4', 0.1), ('D5', 0.3), ('A3', 0)]:
        p = pluck(hz(nm), 2.2, rng, 0.9985, 0.55)
        x = place(x, pan(p, pp), 0.62, 0.55)
    x = place(x, pan(taiko(rng, 1.4, 90, 52, 1.5), 0), 0.62, 0.9)
    x = place(x, pan(taiko(rng, 0.8, 100, 60, 0.8), 0), 0.0, 0.5)
    g = round_gong(0)
    x = place(x, g * 0.25, 0.62)
    x = x[:, : n_of(2.6)]
    ir = reverb_ir(2.0, rng)
    out = np.stack([apply_reverb(x[c], ir[c], 0.25) for c in range(2)])
    return fade(out[:, : n_of(2.6)], 0.002, 0.6)


def ui_move(v):
    rng = R(3400)
    d = 0.08
    return partials(d, [1800, 4100], [0.5, 0.2], [0.012, 0.006], rng) + nburst(rng, d, 2000, 6000, 0.002) * 0.3


def ui_confirm(v):
    rng = R(3500)
    x = mix((pluck(hz('A4'), 0.5, rng, 0.992, 0.7), 0, 0.6), (pluck(hz('D5'), 0.6, rng, 0.993, 0.7), 0.06, 0.7),
            (partials(0.5, [1760, 3520 * 1.19], [0.15, 0.05], [0.2, 0.1], rng), 0.06, 1.0))
    return room(x, rng, 0.4, 0.15)


def ui_back(v):
    rng = R(3600)
    x = mix((partials(0.12, [620, 1400], [0.5, 0.2], [0.03, 0.012], rng), 0, 0.8),
            (pluck(hz('D4'), 0.3, rng, 0.98, 0.5), 0.0, 0.5),
            (pluck(hz('A3'), 0.35, rng, 0.98, 0.5), 0.07, 0.5))
    return room(x, rng, 0.3, 0.1)


# 名字 -> (函数, 变体数, 目标瞬时响度 LUFS, 是否循环)
REG = {
    'hit_light': (hit_light, 3, -14), 'hit_heavy': (hit_heavy, 3, -11), 'hit_slash': (hit_slash, 3, -13),
    'hit_fire': (hit_fire, 2, -11), 'hit_frost': (hit_frost, 2, -12),
    'block': (block, 2, -16), 'block_blade': (block_blade, 2, -14), 'parry': (parry, 1, -12),
    'guard_break': (guard_break, 1, -11),
    'whoosh_light': (whoosh_light, 3, -22), 'whoosh_heavy': (whoosh_heavy, 3, -20),
    'whoosh_blade': (whoosh_blade, 3, -21),
    'step': (step, 3, -28), 'jump': (jump, 1, -25), 'land': (land, 1, -21), 'dash': (dash, 1, -21),
    'bodyfall': (bodyfall, 2, -17),
    'fire_charge': (fire_charge, 1, -16), 'fire_blast': (fire_blast, 1, -12), 'fire_fly': (fire_fly, 1, -20),
    'fire_explode': (fire_explode, 2, -11),
    'frost_charge': (frost_charge, 1, -16), 'frost_wave': (frost_wave, 1, -13), 'frost_fly': (frost_fly, 1, -21),
    'frost_shatter': (frost_shatter, 2, -12), 'frost_spike': (frost_spike, 1, -12),
    'super_freeze': (super_freeze, 1, -12), 'super_fire': (super_fire, 1, -9), 'super_frost': (super_frost, 1, -9),
    'ko': (ko, 1, -11), 'round_gong': (round_gong, 1, -12), 'fight_drum': (fight_drum, 1, -11),
    'win_sting': (win_sting, 1, -13),
    'ui_move': (ui_move, 1, -26), 'ui_confirm': (ui_confirm, 1, -22), 'ui_back': (ui_back, 1, -25),
}
LOOPS = {'fire_fly', 'frost_fly'}

GROUPS = [
    ('hits', ['hit_light', 'hit_heavy', 'hit_slash', 'hit_fire', 'hit_frost']),
    ('defense', ['block', 'block_blade', 'parry', 'guard_break']),
    ('whoosh_move', ['whoosh_light', 'whoosh_heavy', 'whoosh_blade', 'step', 'jump', 'land', 'dash', 'bodyfall']),
    ('fire_frost', ['fire_charge', 'fire_blast', 'fire_fly', 'fire_explode', 'frost_charge', 'frost_wave',
                    'frost_fly', 'frost_shatter', 'frost_spike']),
    ('super_round_ui', ['super_freeze', 'super_fire', 'super_frost', 'ko', 'round_gong', 'fight_drum',
                        'win_sting', 'ui_move', 'ui_confirm', 'ui_back']),
]


def main(only):
    rep_path = os.path.join(M.DOCS, 'sfx_report.json')
    rep = json.load(open(rep_path)) if os.path.exists(rep_path) else {}
    rendered = {}
    for name, (fn, nv, target) in REG.items():
        if only and not any(name.startswith(o) for o in only):
            continue
        for v in range(nv):
            x = np.asarray(fn(v), float)
            if name in LOOPS:
                # 循环素材：不做首尾淡化（交叉淡化已经闭合），只做响度
                y = M.dc_block(x)
                y = y * 10 ** ((target - M.loud_momentary_max(y)) / 20)
                if np.max(np.abs(y)) > 0.89:
                    y = M.soft_limit(y, 0.885, 0.62)
            else:
                y = trim_tail(x, -60, fout=0.03) if x.shape[-1] > n_of(0.1) else x
                y = M.finalize(y, target, fout=0.012 if y.shape[-1] < n_of(0.3) else 0.03)
            fname = f'{name}_{v + 1}'
            M.write('sfx/' + fname if False else fname, y)
            rendered[fname] = y
            s = M.stats(y)
            s['target'] = target
            rep[fname] = s
            print(fname, s)
    M.save_report(rep, rep_path)
    for gname, names in GROUPS:
        items = [(k, rendered[k]) for k in sorted(rendered) if k.rsplit('_', 1)[0] in names]
        if items:
            M.sheet(items, os.path.join(M.DOCS, f'sfx_{gname}.png'), f'SFX {gname}')


if __name__ == '__main__':
    main(sys.argv[1:])
