#!/usr/bin/env python3
"""Offline sanity mix of the exported game SFX, routed the way game/src/sfx.js routes them:
voice -> dry -> master, voice -> send(wet) -> hall convolver (ir_hall normalised to sum|h| = 20
per channel, i.e. audio.py's sum|h| = 40 returned at 0.5) -> master; master -> HP 28 Hz ->
compressor (WebAudio-style, incl. its automatic makeup gain).

Timeline: 10 player shots at 0.09 s, an enemy shot from ~9.7 m to the front-left (distance
attenuated + delayed like SFX.enemyShot), a hit tick and a kill tick.

Writes game/test/sfx_check.wav and game/test/sfx_check.png (waveform + spectrogram of this mix,
above the same 3 s of the video's soundtrack, output/音效轨_48k.wav from 4.0 s, for comparison).
usage: python3 game/test/sfx_check.py
"""
import os
import sys


def _ensure_deps():
    try:
        import numpy, scipy, PIL  # noqa: F401,E401
        return
    except ImportError:
        pass
    import shutil
    uv = shutil.which("uv") or os.path.expanduser("~/.local/bin/uv")
    if os.environ.get("SFX_UV_REEXEC") or not os.path.exists(uv):
        sys.exit("needs numpy, scipy, pillow (or `uv` on PATH)")
    os.environ["SFX_UV_REEXEC"] = "1"
    os.execv(uv, [uv, "run", "--quiet", "--no-project", "--with", "numpy", "--with", "scipy", "--with", "pillow",
                  "python", os.path.abspath(__file__), *sys.argv[1:]])


_ensure_deps()

import json  # noqa: E402
import math  # noqa: E402

import numpy as np  # noqa: E402
from PIL import Image, ImageDraw, ImageFont  # noqa: E402
from scipy.io import wavfile  # noqa: E402
from scipy.signal import butter, fftconvolve, sosfilt, spectrogram  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
SFX = os.path.join(ROOT, "game", "assets", "sfx")
VIDEO = os.path.join(ROOT, "output", "音效轨_48k.wav")
SR = 48000
DUR = 3.0
N = int(DUR * SR)

# mirror of the constants in sfx.js
MASTER_VOLUME = float(os.environ.get("SFX_MASTER", "0.8"))
COMP = dict(threshold=-10.0, knee=10.0, ratio=3.0, attack=0.003, release=0.25)
LOOKAHEAD = 0.006  # browsers' DynamicsCompressor delays the audio 6 ms behind its detector
ENEMY_SHOT_GAIN = 3.2
REF_DISTANCE = 3.0
IR_SUM_ABS = 20.0

manifest = json.load(open(os.path.join(SFX, "manifest.json")))


def load(fn):
    sr, d = wavfile.read(os.path.join(SFX, fn))
    assert sr == SR, (fn, sr)
    x = d.astype(float) / 32768
    return x.T if x.ndim == 2 else x


dry = np.zeros((2, N))
wet = np.zeros((2, N))
rng = np.random.default_rng(1)


def place(name, t0, gain=1.0, pan=0.0, wet_send=0.0, variant=None):
    files = manifest[name]
    x = load(files[variant if variant is not None else rng.integers(len(files))])
    if x.ndim == 1:  # mono voice -> equal-power pan (stand-in for StereoPanner / HRTF)
        a = (pan + 1) * math.pi / 4
        x = np.vstack([x * math.cos(a), x * math.sin(a)])
    i = int(round(t0 * SR))
    n = min(x.shape[1], N - i)
    dry[:, i:i + n] += x[:, :n] * gain
    wet[:, i:i + n] += x[:, :n] * gain * wet_send


# --- timeline
T0 = 0.2
for k in range(10):
    place("shot", T0 + k * 0.09, 1.0, wet_send=0.22, variant=k % len(manifest["shot"]))
place("tick", T0 + 3 * 0.09 + 0.01, wet_send=0.0)
place("tick_kill", T0 + 6 * 0.09 + 0.01, wet_send=0.05)
d = 9.7
att = REF_DISTANCE / (REF_DISTANCE + 1.0 * (d - REF_DISTANCE))  # inverse distance model
place("eshot", 1.45 + d / 343.0, ENEMY_SHOT_GAIN * att, pan=-0.6, wet_send=1.1)

# --- reverb: normalise the IR exactly as sfx.js does
ir = load("ir_hall.wav")
ir = ir / np.abs(ir).sum(axis=1, keepdims=True) * IR_SUM_ABS
rev = np.vstack([fftconvolve(wet[c], ir[c])[:N] for c in range(2)])
mix = (dry + rev) * MASTER_VOLUME

# --- master: highpass 28 Hz (2nd-order Butterworth, like the BiquadFilter) + compressor
mix = sosfilt(butter(2, 28 / (SR / 2), "hp", output="sos"), mix)


def comp_curve_db(x_db, thr, knee, ratio):
    y = np.where(x_db < thr - knee / 2, x_db,
                 np.where(x_db > thr + knee / 2, thr + (x_db - thr) / ratio,
                          x_db + (1 / ratio - 1) * (x_db - thr + knee / 2) ** 2 / (2 * knee)))
    return y


def compressor(x, threshold, knee, ratio, attack, release):
    lvl = np.abs(x).max(axis=0)
    lvl_db = 20 * np.log10(lvl + 1e-9)
    target_gr = comp_curve_db(lvl_db, threshold, knee, ratio) - lvl_db  # <= 0
    a_att = math.exp(-1 / (attack * SR))
    a_rel = math.exp(-1 / (release * SR))
    gr = np.zeros_like(target_gr)
    g = 0.0
    for i, tg in enumerate(target_gr):
        coef = a_att if tg < g else a_rel
        g = coef * g + (1 - coef) * tg
        gr[i] = g
    full_range = comp_curve_db(np.array(0.0), threshold, knee, ratio)  # gain at 0 dBFS
    makeup_db = -float(full_range) * 0.6  # WebAudio: (1 / fullRangeGain) ^ 0.6
    la = int(LOOKAHEAD * SR)
    xd = np.concatenate([np.zeros((x.shape[0], la)), x[:, :-la]], axis=1)  # audio path delayed
    return xd * 10 ** ((gr + makeup_db) / 20), makeup_db, gr.min()


def soft_clip(u):
    # same curve as the WaveShaper in sfx.js: unity below 0.6, tanh knee above, -> 1.0
    a = np.abs(u)
    return np.where(a <= 0.6, u, np.sign(u) * (0.6 + 0.4 * np.tanh((a - 0.6) / 0.4)))


comp_out, makeup_db, max_gr = compressor(mix, **COMP)
out = soft_clip(comp_out)
out = out[:, int(LOOKAHEAD * SR):]  # re-align with the timeline for the picture
out = np.concatenate([out, np.zeros((2, N - out.shape[1]))], axis=1)
peak = np.abs(out).max()
print(f"master volume {MASTER_VOLUME}: pre-comp peak {np.abs(mix).max():.3f}  makeup +{makeup_db:.1f} dB  "
      f"max gain reduction {max_gr:.1f} dB  post-comp peak {np.abs(comp_out).max():.3f}")
print(f"output peak {peak:.3f} ({20 * np.log10(peak):.1f} dBFS)  rms {20 * np.log10(np.sqrt(np.mean(out ** 2))):.1f} dBFS"
      + ("  ** would clip at the destination **" if peak >= 1 else ""))
wavfile.write(os.path.join(HERE, "sfx_check.wav"), SR, (np.clip(out, -1, 1).T * 32767).astype(np.int16))

# per-shot transient check: peak in each 90 ms slot should stand out from the gap before it
env = np.abs(out).max(axis=0)
print("shot slots (peak / level 5 ms before onset):")
for k in range(10):
    i = int((T0 + k * 0.09) * SR)
    pk = env[i:i + int(0.01 * SR)].max()
    pre = env[i - int(0.006 * SR):i - int(0.001 * SR)].max()
    print(f"  shot {k}: peak {pk:.3f}  pre {pre:.3f}  ratio {pk / max(pre, 1e-6):.1f}x")

# --- video reference window
sr, v = wavfile.read(VIDEO)
v = v.astype(float).T / 32768
ref = v[:, int(4.0 * SR):int(4.0 * SR) + N]


def rms50max(x):
    p = np.mean(x ** 2, axis=0); w = int(0.05 * SR); c = np.cumsum(np.concatenate([[0], p]))
    return 20 * np.log10(np.sqrt(np.max(c[w:] - c[:-w]) / w))


print(f"loudest 50 ms RMS: this mix {rms50max(out):.1f} dBFS, video window {rms50max(ref):.1f} dBFS; "
      f"video window peak {np.abs(ref).max():.3f}")


# --- picture
W, WH, SH, PAD = 1600, 150, 190, 26
BG, FG, FG2, AX = (16, 16, 18), (110, 150, 210), (215, 228, 242), (240, 190, 40)
try:
    font = ImageFont.load_default(size=14)
except TypeError:
    font = ImageFont.load_default()
H = 2 * (PAD + WH + SH) + PAD
img = Image.new("RGB", (W, H), BG)
dr = ImageDraw.Draw(img)


def colormap(v):
    stops = np.array([[0, 0, 4], [40, 11, 84], [101, 21, 110], [159, 42, 99], [212, 72, 66], [245, 125, 21], [250, 193, 39], [252, 255, 164]], float)
    v = np.clip(v, 0, 1) * (len(stops) - 1)
    i = np.minimum(v.astype(int), len(stops) - 2)
    f = (v - i)[..., None]
    return (stops[i] * (1 - f) + stops[i + 1] * f).astype(np.uint8)


def draw_wave(x, top, label):
    dr.text((8, top - 20), label, fill=AX, font=font)
    mid = top + WH // 2
    m = x.max(axis=0) if x.ndim == 2 else x
    lo = x.min(axis=0) if x.ndim == 2 else x
    spp = len(m) / W
    for px in range(W):
        a, b = int(px * spp), max(int((px + 1) * spp), int(px * spp) + 1)
        hi_, lo_ = m[a:b].max(), lo[a:b].min()
        rms = np.sqrt(np.mean(((m[a:b] - lo[a:b]) / 2) ** 2))
        dr.line([(px, mid - hi_ * WH / 2), (px, mid - lo_ * WH / 2)], fill=FG)
        dr.line([(px, mid - rms * WH / 2), (px, mid + rms * WH / 2)], fill=FG2)
    for s in np.arange(0, DUR + 1e-9, 0.25):
        px = int(s / DUR * (W - 1))
        dr.line([(px, top), (px, top + 6)], fill=AX)
        if abs(s - round(s)) < 1e-9 or abs(s * 2 - round(s * 2)) < 1e-9:
            dr.text((px + 3, top + 4), f"{s:.2f}s", fill=AX, font=font)


def draw_spec(x, top):
    mono = x.mean(axis=0) if x.ndim == 2 else x
    f, t, S = spectrogram(mono, SR, nperseg=1024, noverlap=1024 - 128, mode="magnitude")
    db = 20 * np.log10(S + 1e-9)
    db = (db - (db.max() - 80)) / 80  # 80 dB range
    keep = f <= 16000
    db = db[keep][::-1]
    im = Image.fromarray(colormap(db)).resize((W, SH), Image.BILINEAR)
    img.paste(im, (0, top))
    for khz in (1, 4, 8, 12, 16):
        y = top + SH - int(khz * 1000 / 16000 * SH)
        dr.text((4, max(top, y - 8)), f"{khz}k", fill=(230, 230, 230), font=font)


y = PAD
draw_wave(out, y, "game SFX sanity mix: 10x shot_* @0.09 s (wet 0.22), hit tick, kill tick, eshot @9.7 m (wet 1.1) - through IR + master HP + compressor")
draw_spec(out, y + WH)
y += WH + SH + PAD
draw_wave(ref, y, "reference: the video's soundtrack WAV in output/ (48 kHz), 4.0-7.0 s (5 player shots @ frames 128-138, hits, kill, casings, body fall)")
draw_spec(ref, y + WH)
img.save(os.path.join(HERE, "sfx_check.png"))
print("wrote", os.path.join(HERE, "sfx_check.wav"), "and", os.path.join(HERE, "sfx_check.png"))
