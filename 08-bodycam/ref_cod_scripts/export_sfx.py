#!/usr/bin/env python3
"""Render the real-time game SFX library (one-shot WAVs + manifest) from sfx_lib.py,
which holds the same synthesis as the video soundtrack (scripts/audio.py).

usage: python3 scripts/export_sfx.py [out_dir]     (default: game/assets/sfx)

Format: 48 kHz 16-bit PCM. Mono for positional sounds, stereo for loops / UI / player-local
foley. Files are DRY (no reverb) - the game adds the hall reverb live via ir_hall.wav - with
two exceptions: the distant enemy gunshot keeps audio.py's lowpass/saturation 'distance'
shaping, and ambience_loop bakes the reverb into the fire bell (in the video the bell only
existed on the reverb bus; that is what makes it sound far away).

Levels: every sound is rendered at the gain audio.py placed it with, then ALL files share one
global scale (the 0.741 audio.py's master applied before its soft clip, unless that would
clip), so relative loudness between files equals the video mix. ir_hall is peak-normalised
on its own; sfx.js re-normalises it to audio.py's scale (sum|h| = 40, returned at 0.5).

If numpy/scipy are missing, the script re-runs itself through `uv` when available.
"""
import json
import os
import sys


def _ensure_deps():
    try:
        import numpy  # noqa: F401
        import scipy  # noqa: F401
        return
    except ImportError:
        pass
    import shutil
    uv = shutil.which("uv") or os.path.expanduser("~/.local/bin/uv")
    if os.environ.get("SFX_UV_REEXEC") or not os.path.exists(uv):
        sys.exit("export_sfx.py needs numpy + scipy (pip install numpy scipy), or `uv` on PATH")
    os.environ["SFX_UV_REEXEC"] = "1"
    os.execv(uv, [uv, "run", "--quiet", "--no-project", "--with", "numpy", "--with", "scipy",
                  "python", os.path.abspath(__file__), *sys.argv[1:]])


_ensure_deps()

import numpy as np  # noqa: E402
from scipy.io import wavfile  # noqa: E402
from scipy.signal import fftconvolve  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import sfx_lib as S  # noqa: E402

SR = S.SR
OUT = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(ROOT, "game", "assets", "sfx")

# Measured by running audio.py's own timeline (output identical to output/音效轨_48k.wav):
VIDEO_MASTER_GAIN = 0.7408  # audio.py scaled its raw mix by 1.25 / 1.687 before the tanh soft clip
VIDEO_BROWN_RMS = 0.2201    # interior RMS of audio.py's peak-normalised brown noise (its peak was an
                            # edge artefact at the end of the buffer, so the rumble sat at ~0.22)
TARGET_PEAK = 10 ** (-1 / 20)  # never let any file exceed -1 dBFS
END_FADE = 0.008            # seconds of cosine fade at the end of every one-shot

rng = np.random.default_rng(20261123)
M = S.VIDEO_MIX


def mono(x): return np.asarray(x, dtype=float)


def stereo(x, pan=0.0):
    x = np.asarray(x, dtype=float)
    return x if x.ndim == 2 else S.to_stereo(x, pan)


def end_fade(x, sec=END_FADE):
    x = np.array(x, dtype=float, copy=True)
    n = int(sec * SR)
    w = 0.5 * (1 + np.cos(np.linspace(0, np.pi, n)))
    x[..., -n:] *= w
    return x


# ------------------------------------------------------------------ one-shots
def build_oneshots():
    snd = {}
    # player rifle: audio.py var ~ U(-0.12, 0.12); slight stereo width (mono-compatible M/S)
    snd["shot"] = [S.widen(S.gunshot(v, rng=rng) * M["shot"]["gain"], 0.2, rng=rng)
                   for v in np.linspace(-0.12, 0.12, 6)]
    # distant enemy rifle (audio.py's distant=True shaping), gain as heard at ~9.7 m in the video
    snd["eshot"] = [mono(S.gunshot(v, distant=True, rng=rng) * M["eshot"]["gain"])
                    for v in np.linspace(-0.1, 0.1, 4)]
    snd["snap"] = [mono(S.bullet_snap(rng) * M["snap"]["gain"]) for _ in range(4)]
    snd["impact"] = [mono(S.impact_hard(rng) * M["impact"]["gain"]) for _ in range(4)]
    snd["casing"] = [mono(S.casing_sequence(rng) * M["casing"]["gain"]) for _ in range(4)]
    snd["step"] = [mono(S.footstep(rng) * M["step"]["gain"]) for _ in range(6)]
    snd["flesh"] = [mono(S.flesh_hit(rng) * M["flesh"]["gain"]) for _ in range(3)]
    snd["fall"] = [mono(S.body_fall(rng) * M["fall"]["gain"]) for _ in range(2)]
    snd["whizz"] = [mono(S.whizz(v, rng) * 0.3) for v in (-0.5, 0.0, 0.5)]  # ~6 dB under eshot (RMS)

    # player-local foley / UI: stereo, with the video's pan baked in
    snd["ads_in"] = [stereo(S.ads_in(rng))]
    snd["ads_out"] = [stereo(S.ads_out(rng))]
    snd["tick"] = [stereo(S.tick(False, rng) * M["tick"]["gain"])]
    snd["tick_kill"] = [stereo(S.tick(True, rng) * M["tick_kill"]["gain"])]
    mag_out = S.overlay([(0.0, S.reload_release(rng) * 0.25),
                         (M_SLIDE_OFFSET, S.reload_slide(rng) * 0.2)])
    snd["mag_out"] = [stereo(mag_out, M["mag_out"]["pan"])]
    snd["mag_drop"] = [stereo(S.reload_drop(rng) * M["mag_drop"]["gain"], M["mag_drop"]["pan"])]
    snd["mag_in"] = [stereo(S.reload_insert(rng) * M["mag_in"]["gain"], M["mag_in"]["pan"])]
    snd["bolt"] = [stereo(S.reload_bolt(rng) * M["bolt"]["gain"], M["bolt"]["pan"])]
    snd["empty_click"] = [stereo(S.empty_click(rng) * 0.6, 0.05)]  # about mag_in level
    snd["hurt"] = [stereo(S.hurt(v, rng) * 0.6) for v in (-0.6, 0.0, 0.6)]
    snd["medal"] = [stereo(S.medal(rng) * 0.3)]
    return {k: [end_fade(x) for x in v] for k, v in snd.items()}


# audio.py: release at frame R0+6, slide at R0+10 -> slide 4 frames after release
M_SLIDE_OFFSET = 4 / 30


# ------------------------------------------------------------------ loops
def crossfade_loop(x, L, X):
    """x has L+X samples; fold the last X into the first X with an equal-power crossfade so
    sample L-1 runs straight into sample 0 (which is x[L] at full weight)."""
    th = np.linspace(0, np.pi / 2, X)
    y = x[:L].copy()
    y[:X] = x[:X] * np.sin(th) + x[L:L + X] * np.cos(th)
    return y


def ambience_loop(dur=20.0, xfade=2.0):
    """Mall room tone + distant fire bell, seamless. Periodic parts (50/100/150 Hz hum, the 2.2 Hz
    bell pulse and its 880/1760/2650 Hz partials) complete whole cycles in exactly 20 s; the noise
    rumble is crossfaded; the bell's reverb is a circular convolution so its tail wraps too."""
    L, X, P = int(dur * SR), int(xfade * SR), SR

    def brown():
        b = S.brown_noise(P + L + X + P, rng)[P:P + L + X]  # drop the moving-average edges
        return crossfade_loop(b / b.std() * VIDEO_BROWN_RMS, L, X)

    bA, bB = brown(), brown()
    hum = S.mains_hum(L)
    # audio.py: L = amb, R = 0.95 * amb (same signal). Here R is partly decorrelated (r = 0.85)
    # for a little width; level per channel is unchanged.
    roomL = bA * 0.03 + hum * 0.006
    roomR = (0.85 * bA + np.sqrt(1 - 0.85 ** 2) * bB) * 0.03 + hum * 0.006
    bell = S.fire_bell(2 * L)[L:]  # second period: filters settled, exactly periodic
    h = S.hall_ir()

    def circ(x, hh): return fftconvolve(np.concatenate([x, x]), hh)[L:2 * L]

    bellL = circ(bell, h[0]) * S.WET_RETURN
    bellR = circ(bell * 0.9, h[1]) * S.WET_RETURN
    return np.vstack([roomL + bellL, roomR * 0.95 + bellR])


def heartbeat_loop():
    return stereo(S.heartbeat(84, 2, rng) * 0.45)


# ------------------------------------------------------------------ output
def write_wav(path, x):
    x = np.asarray(x, dtype=float)
    data = np.round(np.clip(x, -1, 1) * 32767).astype(np.int16)
    data = data.T.copy() if data.ndim == 2 else data  # (n,) or (n, channels)
    wavfile.write(path, SR, data)
    return data


def stats(data):
    x = data.astype(float) / 32767
    ch = x.T if x.ndim == 2 else x[None]  # (channels, n)
    peak = np.abs(ch).max()
    rms = np.sqrt(np.mean(ch ** 2))
    w = int(0.05 * SR)
    p = np.mean(ch ** 2, axis=0)
    if len(p) > w:
        c = np.cumsum(np.concatenate([[0], p]))
        rms50 = np.sqrt(np.max(c[w:] - c[:-w]) / w)
    else:
        rms50 = rms
    clips = int(np.sum(np.abs(data.astype(int)) >= 32767))
    db = lambda v: 20 * np.log10(v + 1e-12)
    return peak, db(peak), db(rms), db(rms50), clips


def main():
    os.makedirs(OUT, exist_ok=True)
    groups = build_oneshots()
    groups["heartbeat"] = [heartbeat_loop()]
    groups["ambience_loop"] = [ambience_loop()]
    loops = {"heartbeat", "ambience_loop"}

    raw_peak = max(np.abs(x).max() for v in groups.values() for x in v)
    G = min(VIDEO_MASTER_GAIN, TARGET_PEAK / raw_peak)
    print(f"global scale G = {G:.4f} (video master gain {VIDEO_MASTER_GAIN}, loudest raw peak {raw_peak:.3f})")

    order = ["shot", "eshot", "snap", "whizz", "impact", "casing", "step", "flesh", "fall",
             "ads_in", "ads_out", "tick", "tick_kill", "medal", "hurt", "empty_click",
             "mag_out", "mag_in", "mag_drop", "bolt", "heartbeat", "ambience_loop"]
    manifest = {}
    total = 0
    worst = 0.0
    print(f"\n{'file':22s}{'ch':>3s}{'dur s':>7s}{'peak':>7s}{'peak dB':>9s}{'rms dB':>8s}{'rms50ms dB':>11s}{'clip':>5s}")
    rows = []
    for name in order:
        files = []
        for i, x in enumerate(groups[name]):
            fn = f"{name}.wav" if len(groups[name]) == 1 else f"{name}_{i}.wav"
            data = write_wav(os.path.join(OUT, fn), x * G)
            rows.append((fn, data))
            files.append(fn)
        manifest[name] = files

    # impulse response: stereo, peak-normalised (sfx.js rescales to audio.py's sum|h| rule)
    h = S.hall_ir()
    h = h / np.abs(h).max() * 0.9
    rows.append(("ir_hall.wav", write_wav(os.path.join(OUT, "ir_hall.wav"), h)))
    manifest["ir_hall"] = ["ir_hall.wav"]

    for fn, data in rows:
        peak, pdb, rdb, r50, clips = stats(data)
        if fn != "ir_hall.wav":
            worst = max(worst, peak)
        nch = data.shape[1] if data.ndim == 2 else 1
        dur = data.shape[0] / SR
        total += os.path.getsize(os.path.join(OUT, fn))
        print(f"{fn:22s}{nch:3d}{dur:7.3f}{peak:7.3f}{pdb:9.1f}{rdb:8.1f}{r50:11.1f}{clips:5d}")

    with open(os.path.join(OUT, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=1)
    total += os.path.getsize(os.path.join(OUT, "manifest.json"))

    # loop seam check: the jump across the loop point vs typical sample-to-sample motion
    print()
    for name in sorted(loops):
        sr, d = wavfile.read(os.path.join(OUT, manifest[name][0]))
        d = d.astype(float)
        jump = np.abs(d[0] - d[-1]).max()
        typ = np.percentile(np.abs(np.diff(d, axis=0)), 99)
        print(f"loop seam {name:14s} |x[0]-x[-1]| = {jump:6.1f} LSB   (99th pct of |diff| = {typ:6.1f} LSB)")

    print(f"\n{sum(len(v) for v in manifest.values())} files, {len(manifest)} keys, "
          f"total {total / 1e6:.2f} MB, loudest file peak {worst:.3f} ({20 * np.log10(worst):.1f} dBFS)")
    print("manifest:", os.path.join(OUT, "manifest.json"))
    if worst >= 1.0:
        sys.exit("ERROR: clipping")


if __name__ == "__main__":
    main()
