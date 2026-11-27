"""配乐和环境声。用法：python music.py [battle|menu|victory|ambience ...]

无缝循环的做法：所有音符事件渲染到“循环长度 + 尾巴”的缓冲，再把尾巴折回开头；
持续音用整数周期的频率；噪声用循环滤波；混响用循环卷积。这样首尾在数学上是连续的。
"""
import sys
import os
import json
import numpy as np
from dsp import *  # noqa
from dsp import SR
import master as M
from sfx import taiko, shime, ka, bell, hz, round_gong

BPM = 105
BEAT = 60 / BPM
BAR = BEAT * 4


# ---------------- 乐器 ----------------
def bend(y, cents):
    """按逐样本音分曲线重采样（揉弦、滑音）。"""
    r = 2 ** (np.asarray(cents) / 1200)
    pos = np.cumsum(np.broadcast_to(r, y.shape))
    pos = pos[pos < len(y) - 1]
    return np.interp(pos, np.arange(len(y)), y)


def zheng(rng, f, dur=2.5, vib=False, bright=0.6, decay=0.9985):
    y = pluck(f, dur, rng, decay, bright, pos=0.14)
    if vib:
        t = tt(dur)
        c = 18 * np.sin(2 * np.pi * 5.5 * t) * np.clip((t - 0.25) / 0.3, 0, 1)
        y = bend(y, c)
    return fade(y, 0.0005, 0.08)


def harmonic(rng, f, dur=2.5):
    """泛音：拨在弦长一半处，柔和像钟。"""
    y = pluck(f, dur, rng, 0.999, 0.25, pos=0.5, body=False)
    return fade(y, 0.001, 0.1)


def pipa_trem(rng, f, dur, rate=13.0, amp_curve=None):
    out = np.zeros(n_of(dur) + n_of(0.6))
    k = 0
    t = 0.0
    while t < dur:
        p = pluck(f * (1 + rng.uniform(-0.002, 0.002)), 0.5, rng, 0.993, 0.8, pos=0.1)
        a = rng.uniform(0.75, 1.0) * (amp_curve(t / dur) if amp_curve else 1.0)
        i = n_of(t)
        out[i:i + len(p)] += a * p[: len(out) - i]
        t += 1 / rate * rng.uniform(0.9, 1.1)
        k += 1
    return fade(out, 0.0005, 0.15)


def xiao(rng, f, dur, amp=1.0):
    n = n_of(dur)
    t = tt(dur)
    scoop = -35 * np.exp(-t / 0.06)
    vib = 12 * np.sin(2 * np.pi * 4.8 * t) * np.clip((t - 0.35) / 0.4, 0, 1)
    ff = f * 2 ** ((scoop + vib) / 1200)
    ph = 2 * np.pi * np.cumsum(ff) / SR
    tone = np.sin(ph) + 0.32 * np.sin(2 * ph) + 0.12 * np.sin(3 * ph) + 0.05 * np.sin(4 * ph)
    breath = bp(rng.standard_normal(n), f * 0.8, min(f * 5, 12000)) * 0.22
    env = adsr(n, 0.09, 0.2, 0.8, min(0.25, dur * 0.3))
    swell = 1 + 0.15 * np.sin(np.pi * np.clip(t / dur, 0, 1))
    chiff = bp(rng.standard_normal(n), 1500, 6000) * expdecay(n, 0.03, 0.01) * 0.15
    return (tone * env * swell + breath * env + chiff) * amp


def bass(rng, f, dur=0.45):
    y = pluck(f, dur, rng, 0.975, 0.35, pos=0.2, body=False)
    y = lp(y, 700) * 1.8 + 0.6 * np.sin(2 * np.pi * f * tt(dur)) * expdecay(n_of(dur), 0.12, 0.003)
    return fade(y, 0.001, 0.05)


# ---------------- 排列工具 ----------------
class Track:
    def __init__(self, L_sec, tail=8.0):
        self.L = n_of(L_sec)
        self.dry = np.zeros((2, self.L + n_of(tail)))
        self.send = np.zeros((2, self.L + n_of(tail)))

    def add(self, x, at, gain=1.0, p=0.0, rev=0.2):
        s = pan(x, p) if x.ndim == 1 else x
        i = int(round(at * SR)) % self.L
        n = min(s.shape[1], self.dry.shape[1] - i)
        self.dry[:, i:i + n] += gain * s[:, :n]
        self.send[:, i:i + n] += gain * rev * s[:, :n]

    def fold(self, buf):
        out = buf[:, :self.L].copy()
        rest = buf[:, self.L:]
        k = 0
        while k < rest.shape[1]:
            m = min(self.L, rest.shape[1] - k)
            out[:, :m] += rest[:, k:k + m]
            k += m
        return out

    def render(self, ir, extra_dry=None, extra_send=None):
        dry = self.fold(self.dry)
        send = self.fold(self.send)
        if extra_dry is not None:
            dry += extra_dry
        if extra_send is not None:
            send += extra_send
        wet = circ_reverb(send, ir, 1.0) - (send if send.ndim == 2 else 0)
        return dry + wet


def periodic_f(f, L_sec):
    return round(f * L_sec) / L_sec


def drone(L_sec, notes, amp_fn, rng, bright=1.0):
    """整数周期的持续低音（多谐波，谐波幅度用整数周期 LFO 慢慢呼吸）。"""
    n = n_of(L_sec)
    t = np.arange(n) / SR
    out = np.zeros((2, n))
    for f0, a0, p in notes:
        for h in range(1, 9):
            f = periodic_f(f0 * h, L_sec)
            if f > 3000:
                break
            cyc = rng.integers(2, 9)
            lfo = 0.6 + 0.4 * np.sin(2 * np.pi * cyc * t / L_sec + rng.uniform(0, 6.28))
            a = a0 * (1 / h ** 1.3) * (bright if h > 3 else 1)
            for c, sgn in enumerate([-1, 1]):
                ph = rng.uniform(0, 6.28)
                out[c] += a * lfo * np.sin(2 * np.pi * f * t + ph) * (1 + 0.15 * sgn * p)
    return out * amp_fn(t)


def circ_noise(rng, n, fn):
    x = rng.standard_normal(n)
    return circ_filter(fn, x)


# ================= 对战曲 =================
PENTA = {'D': 0, 'F': 3, 'G': 5, 'A': 7, 'C': 10}


def battle():
    rng = np.random.default_rng(7)
    bars = 32
    L_sec = bars * BAR
    T = Track(L_sec, tail=8)

    def at(bar, beat):
        return (bar * 4 + beat) * BEAT

    # ---- 鼓 ----
    def pat(s):
        return [i for i, ch in enumerate(s) if ch == 'x']

    for b in range(bars):
        st = lambda k: at(b, k / 4)
        if b < 8:
            for k in pat('x.....x.x.......'):
                T.add(0.78 * taiko(rng, 1.0, 92, 54, 1.4), st(k), 0.95 if k == 0 else 0.7, 0, 0.25)
            if b >= 4:
                for k in pat('....x.......x...'):
                    T.add(ka(rng), st(k), 0.28, 0.25, 0.15)
                for k in pat('..............xx'):
                    T.add(shime(rng), st(k), 0.22, -0.2, 0.15)
        elif b < 24:
            fill = b in (15, 23)
            for k in pat('x..x....x.xx....' if not fill else 'x.......x.......'):
                T.add(0.78 * taiko(rng, 1.0, 92, 54, 1.2), st(k), 0.95 if k in (0, 8) else 0.65, 0, 0.25)
            for k in pat('....x.......x...'):
                T.add(ka(rng), st(k), 0.42, 0.25, 0.15)
            if fill:
                for k in range(8, 16):
                    T.add(shime(rng, 330 + 6 * k), st(k), 0.18 + 0.03 * (k - 8), -0.2, 0.2)
                T.add(0.78 * taiko(rng, 1.2, 100, 58, 1.2), st(14), 0.8, 0, 0.25)
            else:
                for k in pat('..x...x...x...x.'):
                    T.add(shime(rng), st(k), 0.2, -0.2, 0.15)
                if b % 4 == 3:
                    for k in (12, 13, 14, 15):
                        T.add(shime(rng, 350), st(k), 0.22, -0.2, 0.15)
        elif b < 28:
            if b in (24, 26):
                T.add(0.78 * taiko(rng, 2.0, 85, 46, 3.0), st(0), 1.1, 0, 0.45)
            if b == 27:
                T.add(0.78 * taiko(rng, 1.2, 92, 54, 1.4), st(12), 0.6, 0, 0.3)
                T.add(0.78 * taiko(rng, 1.2, 92, 54, 1.4), st(14), 0.75, 0, 0.3)
        else:
            for k in pat('x.......x.......'):
                T.add(0.78 * taiko(rng, 1.0, 92, 54, 1.2), st(k), 0.95, 0, 0.25)
            rate = 2 if b < 30 else 1
            for k in range(0, 16, rate):
                g = 0.12 + 0.18 * ((b - 28) * 16 + k) / 64
                T.add(shime(rng, 320 + 2 * k), st(k), g, -0.2, 0.15)
            if b == 31:
                for k in range(8, 16):
                    T.add(0.78 * taiko(rng, 0.8, 96, 58, 0.8), st(k), 0.45 + 0.06 * (k - 8), 0, 0.25)

    # ---- 低音脉冲 ----
    prog = ['D2', 'D2', 'Bb1', 'C2']
    for b in list(range(8, 24)) + list(range(28, 32)):
        root = prog[(b // 2) % 4] if b < 24 else 'D2'
        for k in range(0, 16, 2):
            acc = k in (0, 6, 12)
            T.add(bass(rng, hz(root)), at(b, k / 4), 0.42 if acc else 0.25, 0, 0.05)

    # ---- 古筝 ----
    def z(bar, beat, name, dur=2.2, g=0.45, vib=False, p=0.3):
        T.add(zheng(rng, hz(name), dur, vib), at(bar, beat), g * 1.7, p, 0.3)

    # 开头：低而稀
    for bar, beat, nm in [(0, 0, 'D3'), (1, 2.5, 'A2'), (2, 0, 'C3'), (2, 3, 'D3'), (3, 0, 'A2'), (3, 0.02, 'F3')]:
        z(bar, beat, nm, 3.0, 0.5, vib=True)
    M1 = [(0, 'D5', 1), (1, 'C5', .5), (1.5, 'A4', .5), (2, 'G4', 1), (3, 'A4', .75), (3.75, 'C5', .25),
          (4, 'D5', 1.5), (5.5, 'F5', .5), (6, 'D5', .5), (6.5, 'C5', .5), (7, 'A4', 1)]
    M2 = [(0, 'F5', .5), (0.5, 'G5', .5), (1, 'A5', 1), (2, 'G5', .5), (2.5, 'F5', .5), (3, 'D5', 1),
          (4, 'C5', .5), (4.5, 'D5', .5), (5, 'A4', 1), (6, 'G4', 1), (7, 'D4', 1)]

    def octv(nm, d):
        return nm[:-1] + str(int(nm[-1]) + d)

    def motif(m, bar, shift=0, g=0.42, trem=False):
        for beat, nm, du in m:
            nm2 = octv(nm, shift)
            long = du >= 1
            z(bar + int(beat // 4), beat % 4, nm2, 1.6 + du, g, vib=long)
            if trem and du >= 1.5:
                T.add(pipa_trem(rng, hz(nm2), du * BEAT * 0.95), at(bar + int(beat // 4), beat % 4), 0.24, -0.35, 0.25)

    motif(M1, 4, -1, 0.4)
    motif(M1, 8)
    motif(M2, 10)
    motif(M1, 12, trem=True)
    motif(M2, 14, trem=True)

    # 箫：8 小节长音
    XM = [(0, 'D4', 3), (3, 'C4', 1), (4, 'A3', 4), (8, 'G3', 2), (10, 'A3', 1), (11, 'C4', 1), (12, 'D4', 4),
          (16, 'F4', 3), (19, 'D4', 1), (20, 'C4', 2), (22, 'A3', 2), (24, 'G3', 4), (28, 'A3', 3.5)]
    for beat, nm, du in XM:
        f = hz(octv(nm, 1))
        T.add(xiao(rng, f, du * BEAT + 0.15), at(16, beat), 0.26, -0.2, 0.4)
    # 箫段的古筝伴奏：每两拍一个和弦音
    acc = ['D3', 'A3', 'C4', 'A3', 'G3', 'D4', 'A3', 'G3']
    for i in range(16):
        z(16 + i // 2, (i % 2) * 2, acc[i % 8], 1.6, 0.3, p=0.45)
    # 琵琶轮指点缀
    T.add(pipa_trem(rng, hz('A4'), BAR * 0.9, amp_curve=lambda u: 0.4 + 0.6 * u), at(19, 0), 0.18, -0.4, 0.25)
    T.add(pipa_trem(rng, hz('D5'), BAR * 0.9, amp_curve=lambda u: 0.4 + 0.6 * u), at(23, 0), 0.2, -0.4, 0.25)

    # 间奏：泛音 + 紧张的小二度轮指
    for bar, beat, nm in [(24, 0, 'D6'), (24, 2.5, 'A5'), (25, 1, 'C6'), (26, 0, 'D6'), (26, 3, 'F5'), (27, 1, 'G5')]:
        T.add(harmonic(rng, hz(nm), 3.0), at(bar, beat), 0.35, 0.4, 0.6)
    for bar in (25, 27):
        T.add(pipa_trem(rng, hz('A4'), BAR, 16, lambda u: np.sin(np.pi * u)), at(bar, 0), 0.12, -0.4, 0.4)
        T.add(pipa_trem(rng, hz('Bb4'), BAR, 15, lambda u: np.sin(np.pi * u)), at(bar, 0), 0.10, 0.4, 0.4)
    # 推进：轮指一小节一个音往上
    for i, nm in enumerate(['D4', 'F4', 'G4', 'A4']):
        T.add(pipa_trem(rng, hz(nm), BAR * 0.95, 14, lambda u: 0.5 + 0.5 * u), at(28 + i, 0), 0.14 + 0.03 * i, -0.35, 0.3)
    for j, nm in enumerate(['D4', 'F4', 'G4', 'A4', 'C5', 'D5', 'F5', 'G5']):  # 刮奏
        z(31, 3 + j * 0.11, nm, 1.5, 0.22 + 0.02 * j, p=0.3)

    # ---- 持续音（整数周期）----
    def damp(t):
        b = t / BAR
        g = np.ones_like(t) * 0.8
        g = np.where((b >= 24) & (b < 28), 1.1, g)
        g = np.where(b < 1, 0.8, g)
        return g
    dr = drone(L_sec, [(hz('D2'), 1.0, -0.5), (hz('A2'), 0.5, 0.5), (hz('D1'), 0.3, 0)], damp, rng, 0.7)
    dr = np.stack([circ_filter(lambda x: lp(x, 1200), dr[c]) for c in range(2)])
    # 高音紧张的弦：只在 24-31 小节，首尾为零
    n = T.L
    t = np.arange(n) / SR
    bpos = t / BAR
    tension_env = np.clip(np.sin(np.pi * np.clip((bpos - 24) / 8, 0, 1)), 0, 1) ** 1.5
    ten = np.zeros((2, n))
    for f, p in [(periodic_f(hz('A4'), L_sec), -0.5), (periodic_f(hz('Bb4'), L_sec), 0.5), (periodic_f(hz('D5'), L_sec), 0)]:
        s = np.sin(2 * np.pi * f * t) * (0.8 + 0.2 * np.sin(2 * np.pi * 6 * t))
        ten += pan(s, p)
    ten *= tension_env * 0.05
    # 风（很轻，循环滤波）
    wind = np.stack([circ_noise(rng, n, lambda x: bp(x, 300, 1500)) for _ in range(2)])
    wind *= 0.015 * (0.7 + 0.3 * np.sin(2 * np.pi * 5 * t / L_sec))
    ir = reverb_ir(3.0, rng, decay=2.6, lo=150, hi=6000, predelay=0.02)
    out = T.render(ir, extra_dry=dr * 0.12 + ten + wind, extra_send=dr * 0.05 + ten * 0.5)
    return out, L_sec


# ================= 菜单 =================
def menu():
    rng = np.random.default_rng(11)
    L_sec = 40.0
    T = Track(L_sec, tail=10)
    n = T.L
    t = np.arange(n) / SR
    # 风：两层，阵风包络整数周期
    gust = 0.55 + 0.45 * (0.5 + 0.5 * np.sin(2 * np.pi * 3 * t / L_sec)) * (0.6 + 0.4 * np.sin(2 * np.pi * 7 * t / L_sec + 1))
    fc = 500 + 700 * gust
    wind = []
    for c in range(2):
        x = rng.standard_normal(n)
        w = circ_filter(lambda y: svf(y, np.concatenate([fc, fc]), 1.3, 'bp'), x)
        low = circ_filter(lambda y: lp(y, 250), rng.standard_normal(n)) * 0.6
        wind.append((w * 0.5 + low) * gust)
    wind = np.stack(wind) * 0.08
    # 钟
    T.add(bell(rng, hz('D3'), 7.0, 0.7), 0.3, 0.25, -0.2, 0.5)
    T.add(bell(rng, hz('A2'), 7.0, 0.6), 21.0, 0.2, 0.3, 0.5)
    # 稀疏拨弦
    for s, nm, p in [(3.0, 'A3', 0.3), (4.2, 'D4', 0.3), (8.5, 'C4', -0.3), (9.4, 'A3', -0.3), (13, 'G3', 0.2),
                     (16.5, 'F4', 0.4), (17.3, 'D4', 0.4), (24.5, 'A3', -0.2), (25.4, 'C4', -0.2),
                     (26.2, 'D4', -0.2), (31.0, 'G3', 0.3), (34.5, 'A3', 0.1), (35.3, 'D3', 0.1)]:
        T.add(zheng(rng, hz(nm), 3.5, vib=True), s, 0.3, p, 0.45)
    T.add(harmonic(rng, hz('D6'), 3.0), 12.0, 0.18, 0.5, 0.7)
    T.add(harmonic(rng, hz('A5'), 3.0), 29.0, 0.18, -0.5, 0.7)
    # 箫一句
    for s, nm, du in [(14.0, 'A4', 2.5), (16.6, 'G4', 1.4), (18.0, 'D4', 3.5)]:
        T.add(xiao(rng, hz(nm), du), s, 0.18, -0.15, 0.6)
    dr = drone(L_sec, [(hz('D2'), 1.0, -0.4), (hz('A2'), 0.4, 0.4)], lambda tt_: np.ones_like(tt_), rng, 0.4)
    dr = np.stack([circ_filter(lambda x: lp(x, 600), dr[c]) for c in range(2)])
    ir = reverb_ir(4.0, rng, decay=3.5, lo=150, hi=5000, predelay=0.03)
    out = T.render(ir, extra_dry=wind + dr * 0.08, extra_send=dr * 0.04 + wind * 0.2)
    return out, L_sec


# ================= 胜利 =================
def victory():
    rng = np.random.default_rng(13)
    T = Track(8.0, tail=0.01)
    T.L = n_of(14)  # 不循环：用大缓冲
    T.dry = np.zeros((2, T.L))
    T.send = np.zeros((2, T.L))
    T.add(round_gong(0), 0.0, 0.35, 0, 0.3)
    T.add(taiko(rng, 2.0, 88, 50, 4.5), 0.0, 0.9, 0, 0.4)
    beat = 0.42
    phrase = [(0.5, 'D4'), (0.5 + beat, 'F4'), (0.5 + 2 * beat, 'G4'), (0.5 + 3 * beat, 'A4'), (0.5 + 3.5 * beat, 'C5'),
              (0.5 + 4 * beat, 'D5')]
    for s, nm in phrase:
        T.add(zheng(rng, hz(nm), 2.5, vib=nm == 'D5'), s, 0.45, 0.3, 0.35)
    for s, nm, du in [(2.2, 'A4', 1.3), (3.5, 'C5', 0.8), (4.3, 'D5', 3.2)]:
        T.add(xiao(rng, hz(nm), du), s, 0.3, -0.2, 0.45)
    T.add(taiko(rng, 1.0, 95, 56, 2.0), 4.3 - 2 * beat * 0.5, 0.5, 0, 0.3)
    T.add(taiko(rng, 1.6, 90, 52, 4.0), 4.3, 0.85, 0, 0.4)
    for nm, p in [('D3', -0.3), ('A3', 0.0), ('D4', 0.3), ('F4', 0.4)]:
        T.add(zheng(rng, hz(nm), 3.5, vib=True), 4.3, 0.3, p, 0.4)
    T.add(bell(rng, hz('D4'), 4.5, 0.6), 4.3, 0.15, 0.2, 0.5)
    ir = reverb_ir(3.0, rng, decay=2.8, lo=150, hi=6000, predelay=0.02)
    dry, send = T.dry, T.send
    wet = np.stack([fftconvolve(send[c], ir[c])[:T.L] for c in range(2)])
    out = (dry + wet)[:, : n_of(8.5)]
    return fade(out, 0.001, 1.5), None


# ================= 环境声 =================
def ambience():
    rng = np.random.default_rng(17)
    L_sec = 20.0
    n = n_of(L_sec)
    t = np.arange(n) / SR
    gust = 0.5 + 0.5 * (0.5 + 0.5 * np.sin(2 * np.pi * 2 * t / L_sec)) * (0.6 + 0.4 * np.sin(2 * np.pi * 5 * t / L_sec + 2))
    chans = []
    for c in range(2):
        fc = np.concatenate([700 + 900 * gust] * 2)
        w = circ_filter(lambda y: svf(y, fc, 2.0, 'bp'), rng.standard_normal(n))
        low = circ_filter(lambda y: lp(y, 300), rng.standard_normal(n))
        hiss = circ_filter(lambda y: hp(y, 4000), rng.standard_normal(n)) * 0.05  # 雪粒
        chans.append((w * 0.35 + low * 0.8) * gust + hiss)
    wind = np.stack(chans)
    # 火盆：低频呼呼 + 成簇的噼啪
    roar = circ_filter(lambda y: lp(y, 350), rng.standard_normal(n)) * (0.8 + 0.2 * np.sin(2 * np.pi * 9 * t / L_sec))
    dens = 6 + 30 * (rng.random(n) < 0)  # 基础密度
    clusters = np.zeros(n)
    for _ in range(14):
        c0 = rng.uniform(0, L_sec)
        w_ = rng.uniform(0.2, 0.8)
        clusters += 60 * np.exp(-((((t - c0 + L_sec / 2) % L_sec) - L_sec / 2) / w_) ** 2)
    cr = crackle(L_sec, rng, dens + clusters, None, 900, 8000, 0.0015)
    # 噼啪是稀疏脉冲，把超出 L 的部分没有，开头结尾各留 30ms 的空隙防止切断
    guard = n_of(0.03)
    cr[:guard] *= np.linspace(0, 1, guard)
    cr[-guard:] *= np.linspace(1, 0, guard)
    fire = pan(roar * 0.25 + cr * 1.2, -0.35)
    out = wind + fire
    return out, L_sec


TRACKS = {'battle': (battle, -16.0), 'menu': (menu, -21.0), 'victory': (victory, -16.0), 'ambience': (ambience, -27.0)}


def main(only):
    rep_path = os.path.join(M.DOCS, 'music_report.json')
    rep = json.load(open(rep_path)) if os.path.exists(rep_path) else {}
    for name, (fn, target) in TRACKS.items():
        if only and name not in only:
            continue
        x, L = fn()
        x = M.dc_block(x) if L is None else np.stack([circ_filter(lambda y: hp(y, 22), c) for c in x])
        for _ in range(3):
            x = x * 10 ** ((target - M.loud_integrated(x)) / 20)
            if np.max(np.abs(x)) > 0.89:
                x = M.soft_limit(x, 0.885, 0.6)
        fname = 'music_' + name if name != 'ambience' else 'amb_snow'
        M.write(fname, x, bitrate='128k' if name != 'ambience' else '96k')
        s = M.stats(x)
        s['loop_sec'] = L
        s['loop_samples'] = None if L is None else x.shape[1]
        # 循环接缝检查：最后一个样本到第一个样本的跳变，相对于全曲平均逐样本差
        if L is not None:
            jump = np.max(np.abs(x[:, 0] - x[:, -1]))
            win = np.concatenate([x[:, -2000:], x[:, :2000]], axis=1)
            typ = np.percentile(np.abs(np.diff(win, axis=1)), 99)  # 接缝附近 99 分位的逐样本差
            s['seam_jump'] = round(float(jump), 5)
            s['typ_step'] = round(float(typ), 5)
        rep[fname] = s
        print(fname, s)
        M.sheet([(fname, x)], os.path.join(M.DOCS, f'{fname}.png'), fname)
    M.save_report(rep, rep_path)


if __name__ == '__main__':
    main(sys.argv[1:])
