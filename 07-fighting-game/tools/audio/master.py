"""响度测量、归一化、导出（WAV -> m4a）和分析图。"""
import json
import os
import subprocess
import numpy as np
from scipy.io import wavfile
from scipy.signal import lfilter
from dsp import SR, dc_block, fade

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'public', 'assets', 'audio')
WAV = os.path.join(ROOT, 'tools', 'audio', 'wav')
DOCS = os.path.join(ROOT, 'docs', 'audio')
for d in (OUT, WAV, DOCS):
    os.makedirs(d, exist_ok=True)


def _kweight(x):
    fs = SR
    G, Q, fc = 3.99984385397, 0.7071752369554193, 1681.9744509555319
    A = 10 ** (G / 40)
    w0 = 2 * np.pi * fc / fs
    al = np.sin(w0) / (2 * Q)
    c = np.cos(w0)
    b = [A * ((A + 1) + (A - 1) * c + 2 * np.sqrt(A) * al), -2 * A * ((A - 1) + (A + 1) * c),
         A * ((A + 1) + (A - 1) * c - 2 * np.sqrt(A) * al)]
    a = [(A + 1) - (A - 1) * c + 2 * np.sqrt(A) * al, 2 * ((A - 1) - (A + 1) * c),
         (A + 1) - (A - 1) * c - 2 * np.sqrt(A) * al]
    x = lfilter(b, a, x)
    Q, fc = 0.5003270373253953, 38.13547087613982
    w0 = 2 * np.pi * fc / fs
    al = np.sin(w0) / (2 * Q)
    c = np.cos(w0)
    b = [(1 + c) / 2, -(1 + c), (1 + c) / 2]
    a = [1 + al, -2 * c, 1 - al]
    return lfilter(b, a, x)


def as2(x):
    return x if x.ndim == 2 else x[None, :]


def loud_momentary_max(x):
    """最大瞬时响度（400ms 窗，10ms 步进），短音频补零。单位 LUFS（近似）。"""
    x = as2(x)
    w = int(0.4 * SR)
    if x.shape[1] < w:
        x = np.concatenate([x, np.zeros((x.shape[0], w - x.shape[1]))], axis=1)
    k = np.stack([_kweight(c) for c in x]) ** 2
    cs = np.concatenate([np.zeros((k.shape[0], 1)), np.cumsum(k, axis=1)], axis=1)
    hop = int(0.01 * SR)
    starts = np.arange(0, x.shape[1] - w + 1, hop)
    ms = (cs[:, starts + w] - cs[:, starts]) / w
    tot = ms.sum(axis=0)
    return -0.691 + 10 * np.log10(tot.max() + 1e-12)


def loud_integrated(x):
    """简化的积分响度（400ms 块，75% 重叠，-70 绝对门限 + -10 相对门限）。"""
    x = as2(x)
    w = int(0.4 * SR)
    if x.shape[1] < w:
        return loud_momentary_max(x)
    k = np.stack([_kweight(c) for c in x]) ** 2
    cs = np.concatenate([np.zeros((k.shape[0], 1)), np.cumsum(k, axis=1)], axis=1)
    hop = w // 4
    starts = np.arange(0, x.shape[1] - w + 1, hop)
    ms = ((cs[:, starts + w] - cs[:, starts]) / w).sum(axis=0)
    lk = -0.691 + 10 * np.log10(ms + 1e-12)
    g = ms[lk > -70]
    if len(g) == 0:
        return -70.0
    rel = -0.691 + 10 * np.log10(g.mean()) - 10
    g2 = ms[(lk > -70) & (lk > rel)]
    return -0.691 + 10 * np.log10(g2.mean())


def peak_db(x):
    return 20 * np.log10(np.max(np.abs(x)) + 1e-12)


def soft_limit(x, ceiling=0.89, knee=0.6):
    a = np.abs(x)
    over = a > knee
    y = x.copy()
    r = ceiling - knee
    y[over] = np.sign(x[over]) * (knee + r * np.tanh((a[over] - knee) / r))
    return y


def finalize(x, target, ceiling_db=-1.0, fin=0.0004, fout=0.015, measure='momentary'):
    """去直流 -> 响度对齐 -> 软限幅 -> 首尾淡入淡出。"""
    x = dc_block(np.asarray(x, float))
    x = x - (x.mean(axis=-1, keepdims=True) if x.ndim == 2 else x.mean())
    fn = loud_momentary_max if measure == 'momentary' else loud_integrated
    ceil = 10 ** (ceiling_db / 20)
    for _ in range(4):
        L = fn(x)
        x = x * 10 ** ((target - L) / 20)
        if np.max(np.abs(x)) > ceil * 0.999:
            x = soft_limit(x, ceiling=ceil * 0.995, knee=ceil * 0.7)
        if abs(fn(x) - target) < 0.3:
            break
    return fade(x, fin, fout)


def write(name, x, stereo=None, bitrate=None):
    """写 WAV（16bit）和 m4a。返回 m4a 路径。"""
    x = np.asarray(x, float)
    if x.ndim == 2 and stereo is False:
        x = x.mean(axis=0)
    data = x.T if x.ndim == 2 else x
    pcm = np.clip(data, -1, 1)
    pcm = (pcm * 32767 + np.random.default_rng(0).triangular(-1, 0, 1, pcm.shape)).astype(np.int16)
    wp = os.path.join(WAV, name + '.wav')
    wavfile.write(wp, SR, pcm)
    mp = os.path.join(OUT, name + '.m4a')
    ch = 2 if x.ndim == 2 else 1
    br = bitrate or ('128k' if ch == 2 else '80k')
    env = dict(os.environ)
    env['DYLD_LIBRARY_PATH'] = '/opt/homebrew/Cellar/x265/4.2/lib'
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wp, '-c:a', 'aac', '-b:a', br,
                    '-movflags', '+faststart', mp], check=True, env=env)
    return mp


def stats(x):
    x = np.asarray(x, float)
    m = x if x.ndim == 1 else x.mean(axis=0)
    a = np.abs(m)
    pk = a.max() + 1e-12
    env = np.convolve(a, np.ones(44) / 44, mode='same')  # 1ms 包络
    above = np.where(env > env.max() * 0.1)[0]
    onset = above[0] if len(above) else 0
    reach = np.where(env >= env.max() * 0.7)[0]
    attack_ms = ((reach[0] if len(reach) else 0) - onset) / SR * 1000
    spec = np.abs(np.fft.rfft(m * np.hanning(len(m))))
    f = np.fft.rfftfreq(len(m), 1 / SR)
    cent = float((spec * f).sum() / (spec.sum() + 1e-12))
    p2 = spec ** 2
    low = float(p2[(f >= 40) & (f < 160)].sum() / (p2.sum() + 1e-12))
    return dict(
        dur=round(len(m) / SR, 3),
        peak_db=round(peak_db(x), 2),
        lufs_m=round(loud_momentary_max(x), 2),
        lufs_i=round(loud_integrated(x), 2) if len(m) > 0.4 * SR else None,
        dc=round(float(np.mean(m)), 6),
        attack_ms=round(attack_ms, 2),
        centroid_hz=round(cent),
        low40_160=round(low, 3),
        start=round(float(np.max(np.abs(x[..., 0]))), 4),
        end=round(float(np.max(np.abs(x[..., -1]))), 4),
        ch=1 if x.ndim == 1 else x.shape[0],
    )


def sheet(items, path, title):
    """items: [(name, x)] -> 每行波形 + 频谱图的总览 PNG。"""
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    n = len(items)
    fig, axes = plt.subplots(n, 2, figsize=(13, 1.55 * n + 0.6), squeeze=False,
                             gridspec_kw=dict(width_ratios=[1, 1.3]))
    for r, (name, x) in enumerate(items):
        m = x if x.ndim == 1 else x.mean(axis=0)
        t = np.arange(len(m)) / SR
        ax = axes[r, 0]
        ax.plot(t, m, lw=0.5, color='#1f4e79')
        ax.set_ylim(-1, 1)
        ax.axhline(0.891, color='r', lw=0.4, ls=':')
        ax.axhline(-0.891, color='r', lw=0.4, ls=':')
        s = stats(x)
        ax.set_title(f"{name}  {s['dur']}s  pk {s['peak_db']}dB  M {s['lufs_m']}LU  atk {s['attack_ms']}ms",
                     fontsize=8, loc='left')
        ax.tick_params(labelsize=6)
        ax2 = axes[r, 1]
        nfft = 1024 if len(m) > 4096 else 256
        ax2.specgram(m + 1e-9, NFFT=nfft, Fs=SR, noverlap=nfft * 3 // 4, cmap='magma', vmin=-120)
        ax2.set_yscale('symlog', linthresh=200)
        ax2.set_ylim(30, 20000)
        ax2.tick_params(labelsize=6)
    fig.suptitle(title, fontsize=10)
    fig.tight_layout()
    fig.savefig(path, dpi=90)
    plt.close(fig)


def save_report(rows, path):
    with open(path, 'w') as f:
        json.dump(rows, f, ensure_ascii=False, indent=1)
