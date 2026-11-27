"""Procedural SFX synthesis, factored out of scripts/audio.py so it can be imported
without side effects (audio.py renders its whole timeline at import time).

The generators below are the same DSP as the video soundtrack (same filters, envelopes,
constants and noise draw order). The only change is that randomness comes from an explicit
`rng` argument (falling back to a module-level Generator seeded like audio.py), so callers
can reproduce variants deterministically.

New sounds for the game (hurt, heartbeat, empty_click, whizz, medal) are written in the same
style: filtered Gaussian noise + exponential envelopes + swept sines + tanh saturation.

Nothing here touches the filesystem; scripts/export_sfx.py does the rendering.
"""
import math

import numpy as np
from scipy.signal import butter, fftconvolve, sosfilt

SR = 48000

# Mix settings audio.py used when placing each sound (gain, pan, reverb send "wet").
# Reverb return in audio.py: out = dry + conv(wet_bus, ir) * 0.5, with ir() normalised
# so sum|h| = 40.  export_sfx.py bakes `gain` into the files; sfx.js reuses `wet`.
VIDEO_MIX = {
    "shot":      dict(gain=0.95, pan=(-0.05, 0.08), wet=0.22),
    "casing":    dict(gain=1.0, pan=0.45, wet=0.15),  # amp 0.18/(b+1) is inside the sound
    "eshot":     dict(gain=0.42, wet=1.1),            # at ~9.7 m in the video, delayed d/343
    "snap":      dict(gain=0.55, wet=0.2),
    "impact":    dict(gain=0.5, wet=0.4),
    "tick":      dict(gain=0.32, wet=0.0),
    "flesh":     dict(gain=0.22, wet=0.3),
    "tick_kill": dict(gain=0.36, wet=0.05),
    "fall":      dict(gain=0.5, wet=0.6),             # * min(1, 8 / dist)
    "step":      dict(gain=0.55, pan=0.15, wet=0.3),  # * min(1, speed / 1.2), pan alternates
    "ads_in":    dict(gain=0.22, wet=0.1),            # + clack 0.07 at +0.2 s
    "ads_out":   dict(gain=0.18, wet=0.1),
    "mag_out":   dict(gain=0.25, pan=0.1, wet=0.1),   # release 0.25 + slide 0.2
    "mag_drop":  dict(gain=0.3, pan=-0.3, wet=0.5),
    "mag_in":    dict(gain=0.45, pan=0.05, wet=0.15),
    "bolt":      dict(gain=0.55, pan=0.1, wet=0.25),
}
# Reload timeline of the video (frames 505..562 at 30 fps = 1.9 s), seconds from reload start.
RELOAD_TIMES = {"mag_out": 6 / 30, "mag_in": 29 / 30, "mag_drop": 24 / 30 + 0.25, "bolt": 40 / 30}
RELOAD_DURATION = 57 / 30

_rng = np.random.default_rng(3)


def seed(s):
    """Reset the module-level fallback RNG (audio.py used default_rng(3))."""
    global _rng
    _rng = np.random.default_rng(s)


def _r(rng):
    return _rng if rng is None else rng


# ------------------------------------------------------------------ DSP helpers (as audio.py)
def t_(n): return np.arange(n) / SR


def sos(kind, f, order=4):
    if kind == "bp":
        return butter(order, [f[0] / (SR / 2), f[1] / (SR / 2)], btype="band", output="sos")
    return butter(order, f / (SR / 2), btype=kind, output="sos")


def filt(x, kind, f, order=4): return sosfilt(sos(kind, f, order), x)


def noise(n, rng=None): return _r(rng).standard_normal(n)


def env_exp(n, tau, attack=0.0005):
    t = t_(n)
    e = np.exp(-t / tau)
    if attack > 0:
        e *= np.clip(t / attack, 0, 1)
    return e


def pan_gains(pan):
    """Equal-power pan law of audio.py's place(): -1 left .. +1 right."""
    a = (pan + 1) * math.pi / 4
    return math.cos(a), math.sin(a)


def to_stereo(sig, pan=0.0):
    gl, gr = pan_gains(pan)
    return np.vstack([sig * gl, sig * gr])


def overlay(parts, n=None):
    """Sum [(t0_seconds, mono_signal), ...] into one mono buffer."""
    end = max(int(round(t0 * SR)) + len(s) for t0, s in parts)
    out = np.zeros(max(end, n or 0))
    for t0, s in parts:
        i = int(round(t0 * SR))
        out[i:i + len(s)] += s
    return out


def sweep_sine(t, f0, f_end, k):
    """Sine whose frequency glides exponentially from f0 to f_end (time constant k),
    the 'thump' construction used by audio.py's gunshot."""
    return np.sin(2 * np.pi * (f_end * t + (f0 - f_end) * k * (1 - np.exp(-t / k))))


# ------------------------------------------------------------------ sound generators (audio.py)
def gunshot(var=0.0, distant=False, rng=None):
    r = _r(rng)
    n = int(0.45 * SR)
    t = t_(n)
    crack = filt(noise(n, r), "hp", 1800) * env_exp(n, 0.0022 * (1 + var))
    body = filt(noise(n, r), "bp", (250, 3200)) * env_exp(n, 0.028 * (1 + var * 0.5), 0.0008)
    f0 = 150 * (1 + var * 0.1)
    sweep = np.sin(2 * np.pi * (45 * t + (f0 - 45) * 0.025 * (1 - np.exp(-t / 0.025))))
    thump = sweep * env_exp(n, 0.07)
    mech = np.zeros(n)
    k = int(0.009 * SR)
    m = filt(noise(n - k, r), "bp", (2500, 7000)) * env_exp(n - k, 0.004)
    ring = np.sin(2 * np.pi * 3150 * t[: n - k]) * env_exp(n - k, 0.04) * 0.15
    mech[k:] = m * 0.5 + ring
    s = crack * 1.1 + body * 0.9 + thump * 1.3 + mech * 0.35
    s = np.tanh(s * 2.2) / 1.2
    if distant:
        s = filt(s, "lp", 2600)
        s = np.tanh(s * 1.5)
    return s


def bullet_snap(rng=None):
    r = _r(rng)
    n = int(0.12 * SR)
    t = t_(n)
    snap = filt(noise(n, r), "hp", 3000) * env_exp(n, 0.0015)
    ph = 2 * np.pi * np.cumsum(np.linspace(1700, 500, n)) / SR
    whiz = filt(noise(n, r), "bp", (500, 2500)) * np.sin(ph) * np.exp(-((t - 0.02) / 0.03) ** 2)
    return snap * 0.9 + whiz * 0.5


def impact_hard(rng=None):
    r = _r(rng)
    n = int(0.35 * SR)
    thud = filt(noise(n, r), "lp", 1400) * env_exp(n, 0.02)
    debris = np.zeros(n)
    for _ in range(14):
        k = int(r.uniform(0.01, 0.25) * SR)
        g = filt(noise(n - k, r), "bp", (1500, 6000)) * env_exp(n - k, r.uniform(0.002, 0.006)) * r.uniform(0.05, 0.25)
        debris[k:] += g
    return thud * 0.9 + debris


def casing_bounce(amp, rng=None):
    r = _r(rng)
    n = int(0.12 * SR)
    t = t_(n)
    s = np.zeros(n)
    for fq in r.uniform(3800, 9500, 4):
        s += np.sin(2 * np.pi * fq * t + r.uniform(0, 6)) * env_exp(n, r.uniform(0.015, 0.05))
    s += filt(noise(n, r), "hp", 4000) * env_exp(n, 0.002) * 0.6
    return s * amp


def casing_sequence(rng=None):
    """Three bounces exactly as audio.py placed them after each shot (offsets b*U(0.07,0.12),
    amplitudes 0.18/(b+1)); t=0 is the first floor contact."""
    r = _r(rng)
    parts = []
    for b in range(3):
        t0 = b * r.uniform(0.07, 0.12)
        parts.append((t0, casing_bounce(0.18 / (b + 1), r)))
    return overlay(parts)


def footstep(rng=None):
    r = _r(rng)
    n = int(0.16 * SR)
    heel = filt(noise(n, r), "lp", 700) * env_exp(n, 0.016)
    scuff = filt(noise(n, r), "bp", (1800, 5000)) * env_exp(n, 0.03, 0.01) * 0.25
    gear = np.zeros(n)
    for _ in range(3):
        k = int(r.uniform(0.005, 0.05) * SR)
        gear[k:] += np.sin(2 * np.pi * r.uniform(2500, 5000) * t_(n - k)) * env_exp(n - k, 0.01) * 0.05
    return heel * 0.9 + scuff + gear


def swish(dur=0.22, rng=None):
    n = int(dur * SR)
    t = t_(n)
    e = np.sin(np.pi * t / dur) ** 2
    return filt(noise(n, rng), "bp", (350, 2200)) * e


def tick(kill=False, rng=None):
    r = _r(rng)
    n = int(0.25 * SR)
    t = t_(n)
    if not kill:
        return (np.sin(2 * np.pi * 2900 * t) * env_exp(n, 0.006) + filt(noise(n, r), "hp", 5000) * env_exp(n, 0.0015) * 0.4)
    s = (np.sin(2 * np.pi * 980 * t) * env_exp(n, 0.05) + np.sin(2 * np.pi * 1470 * t) * env_exp(n, 0.09) * 0.6
         + filt(noise(n, r), "lp", 900) * env_exp(n, 0.01) * 0.8)
    return s


def clack(f_lo=800, f_hi=5000, tau=0.012, ringf=2200, rng=None):
    n = int(0.3 * SR)
    t = t_(n)
    return (filt(noise(n, rng), "bp", (f_lo, f_hi)) * env_exp(n, tau) + np.sin(2 * np.pi * ringf * t) * env_exp(n, 0.06) * 0.12)


def flesh_hit(rng=None):
    n = int(0.12 * SR)
    return filt(noise(n, rng), "lp", 700) * env_exp(n, 0.02)


def body_fall(rng=None):
    r = _r(rng)
    n = int(0.6 * SR)
    s = np.zeros(n)
    for k_t, a in ((0.0, 1.0), (0.12, 0.6), (0.22, 0.35)):
        k = int(k_t * SR)
        s[k:] += filt(noise(n - k, r), "lp", 500) * env_exp(n - k, 0.04) * a
    s += filt(noise(n, r), "bp", (1000, 4000)) * env_exp(n, 0.08) * 0.08
    return s


# ------------------------------------------------------------------ reload pieces (audio.py)
# Unit gain; the video's per-piece gains (0.25 / 0.2 / 0.3 / 0.45 / 0.55) are in VIDEO_MIX.
def reload_release(rng=None): return clack(1500, 7000, 0.004, 3400, rng)


def reload_slide(rng=None):
    r = _r(rng)
    return swish(0.18, r) * 0.7 + filt(noise(int(0.18 * SR), r), "bp", (3000, 8000)) * 0.1


def reload_drop(rng=None):
    """Old magazine hitting the floor (audio.py placed it 0.25 s after the 'drop' frame)."""
    r = _r(rng)
    cb = np.zeros(int(0.3 * SR))
    c_ = casing_bounce(0.2, r)
    cb[: len(c_)] = c_
    return clack(300, 2500, 0.02, 900, r) + cb


def reload_insert(rng=None):
    r = _r(rng)
    return overlay([(0.0, clack(600, 4500, 0.01, 1800, r)), (0.05, clack(1500, 6500, 0.004, 2600, r) * 0.6)])


def reload_bolt(rng=None):
    r = _r(rng)
    return overlay([(0.0, clack(400, 5000, 0.015, 1500, r)), (0.03, clack(2000, 8000, 0.003, 4100, r) * 0.5)])


def ads_in(rng=None):
    """Raise-to-aim cloth swish + sight 'clack' 0.2 s later, gains as in the video."""
    r = _r(rng)
    return overlay([(0.0, swish(0.2, r) * 0.22), (0.2, clack(1500, 6000, 0.004, 3000, r) * 0.07)])


def ads_out(rng=None): return swish(0.25, rng) * 0.18


# ------------------------------------------------------------------ ambience (audio.py)
def brown_noise(n, rng=None):
    """audio.py's room-tone rumble: integrated noise, 0.1 s moving-average removed, LP 350 Hz,
    normalised to peak 1. (Moving average done with fftconvolve; same result as np.convolve.)"""
    brown = np.cumsum(noise(n, rng))
    ma = fftconvolve(brown, np.ones(4801) / 4801, mode="same")
    brown = filt(brown - ma, "lp", 350)
    return brown / (np.abs(brown).max() + 1e-9)


def mains_hum(n):
    tt = t_(n)
    return np.sin(2 * np.pi * 50 * tt) * 0.5 + np.sin(2 * np.pi * 100 * tt) * 0.3 + np.sin(2 * np.pi * 150 * tt) * 0.15


def room_tone(n, rng=None):
    return brown_noise(n, rng) * 0.03 + mains_hum(n) * 0.006


def fire_bell(n):
    """Distant pulsing fire-alarm bell, dry. In the video it only went to the reverb bus."""
    tt = t_(n)
    pulse = (np.sin(2 * np.pi * 2.2 * tt) > 0.2).astype(float)
    pulse = filt(pulse, "lp", 40, 2)
    bell = (np.sin(2 * np.pi * 880 * tt) + 0.5 * np.sin(2 * np.pi * 1760 * tt + 1) + 0.3 * np.sin(2 * np.pi * 2650 * tt)) * pulse
    return filt(bell, "lp", 2200) * 0.006


# ------------------------------------------------------------------ reverb + master (audio.py)
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


def hall_ir():
    """The stereo IR the video actually used: ir(1.8, seed 1) for L, ir(1.8, seed 2) for R."""
    return np.vstack([ir(1.8, 1), ir(1.8, 2)])


WET_RETURN = 0.5  # audio.py: out = dry + conv(wet, ir) * 0.5


def master(mix, n_out=None, fade_s=0.25):
    """audio.py's mastering: HP 28 Hz, peak -> 1.25, tanh soft clip to 0.9, end fade."""
    mix = filt(mix, "hp", 28, 2)
    peak = np.abs(mix).max()
    mix = mix / (peak + 1e-9) * 1.25
    mix = np.tanh(mix * 1.15) / np.tanh(1.15 * 1.25) * 0.9
    if n_out is not None:
        mix = mix[:, :n_out]
    if fade_s:
        fade = int(fade_s * SR)
        mix[:, -fade:] *= np.linspace(1, 0, fade)
    return mix


class Mix:
    """Stereo dry + wet buses with audio.py's place() semantics, for offline test renders."""

    def __init__(self, dur_s):
        self.n = int(dur_s * SR)
        self.dry = np.zeros((2, self.n))
        self.wet = np.zeros((2, self.n))

    def place(self, sig, t0, gain=1.0, pan=0.0, wet=0.25):
        """sig: mono (n,) panned equal-power, or stereo (2, n) used as-is (pan ignored)."""
        sig = np.asarray(sig, dtype=float)
        st = sig if sig.ndim == 2 else to_stereo(sig, pan)
        i = int(t0 * SR)
        if i >= self.n or i + st.shape[1] <= 0:
            return
        if i < 0:
            st = st[:, -i:]; i = 0
        st = st[:, : self.n - i]
        self.dry[:, i:i + st.shape[1]] += st * gain
        self.wet[:, i:i + st.shape[1]] += st * gain * wet

    def render(self, ir_lr=None, wet_return=WET_RETURN):
        h = hall_ir() if ir_lr is None else ir_lr
        rl = fftconvolve(self.wet[0], h[0])[: self.n]
        rr = fftconvolve(self.wet[1], h[1])[: self.n]
        return self.dry + np.vstack([rl, rr]) * wet_return


# ------------------------------------------------------------------ helpers for the game export
def widen(s, amount=0.2, f_split=1200, rng=None):
    """Mono -> stereo with slight width: M/S where S is the >f_split part of the signal sent
    through a short random-phase (all-pass-like) FIR. L+R sums back to exactly 2*s, so it
    stays mono-compatible and the transient/body of the sound is untouched."""
    r = _r(rng)
    m = 512
    spec = np.exp(1j * r.uniform(0, 2 * np.pi, m // 2 + 1))
    spec[0] = 1; spec[-1] = 1
    h = np.fft.irfft(spec, m) * np.exp(-np.arange(m) / (m / 4))
    h /= np.sqrt(np.sum(h ** 2))
    side = fftconvolve(filt(s, "hp", f_split), h)[: len(s)]
    return np.vstack([s + amount * side, s - amount * side])


# ------------------------------------------------------------------ new sounds (same style)
def hurt(var=0.0, rng=None):
    """Player taking a hit: dull low thump (swept sine, like the gunshot thump but lower)
    + short low-passed noise + a muffled body smack, saturated and low-passed."""
    r = _r(rng)
    n = int(0.4 * SR)
    t = t_(n)
    f0 = 140 * (1 + var * 0.2)
    thump = sweep_sine(t, f0, 48, 0.03) * env_exp(n, 0.06 * (1 + var * 0.3), 0.001)
    body = filt(noise(n, r), "lp", 600) * env_exp(n, 0.035, 0.001)
    smack = filt(noise(n, r), "bp", (150, 900)) * env_exp(n, 0.012)
    s = thump * 1.2 + body * 0.9 + smack * 0.6
    s = np.tanh(s * 1.6) / 1.3
    return filt(s, "lp", 1800)


def heartbeat(bpm=84, beats=2, rng=None):
    """Low-health heartbeat, 'lub-dub' per beat, exactly `beats` periods long and rendered
    circularly (tails wrap to the start) so it loops seamlessly."""
    r = _r(rng)
    period = 60.0 / bpm
    n = int(round(period * beats * SR))
    out = np.zeros(n)

    def beat(f0, f1, amp, tau):
        m = int(0.4 * SR)
        t = t_(m)
        thump = sweep_sine(t, f0, f1, 0.03) * env_exp(m, tau, 0.004)
        body = filt(noise(m, r), "lp", 140) * env_exp(m, tau * 0.6, 0.003) * 0.8
        return (thump + body) * amp

    for b in range(beats):
        for dt, args in ((0.0, (72, 38, 1.0, 0.07)), (0.24, (88, 46, 0.7, 0.05))):
            s = beat(*args)
            i = int(round((b * period + dt) * SR))
            idx = (np.arange(len(s)) + i) % n
            np.add.at(out, idx, s)
    out = np.tanh(out * 1.5) / 1.5  # harmonics so it reads on small speakers
    return out


def empty_click(rng=None):
    """Dry fire: sharp trigger/hammer click, then a softer sear click 14 ms later."""
    r = _r(rng)
    a = clack(2200, 8000, 0.0025, 4300, r)
    b = clack(900, 4500, 0.005, 2400, r) * 0.55
    return overlay([(0.0, a), (0.014, b)])[: int(0.2 * SR)]


def whizz(var=0.0, rng=None):
    """Bullet passing close: a tonal Doppler fly-by (pitch falls through closest approach,
    slight tumble flutter), with a little of bullet_snap's ring-modulated noise band."""
    r = _r(rng)
    dur = 0.3
    n = int(dur * SR)
    t = t_(n)
    tc = 0.11 * (1 + var * 0.2)
    fc = 1250 * (1 + var * 0.25)
    f = fc * (1 - 0.32 * np.tanh((t - tc) / 0.022))
    ph = 2 * np.pi * np.cumsum(f) / SR
    w = np.where(t < tc, 0.045, 0.03)
    env = np.exp(-((t - tc) / w) ** 2)
    flutter = 1 + 0.25 * np.sin(2 * np.pi * (70 + var * 25) * t)
    tone = np.sin(ph) + 0.3 * np.sin(2 * ph + 0.5)
    band = filt(noise(n, r), "bp", (fc * 0.5, fc * 2.2)) * np.sin(ph)
    return (tone * 0.7 + band * 0.5) * env * flutter


def medal(rng=None):
    """Multi-kill UI sting: bright rising arpeggio built on the kill tick's 980/1470 Hz
    (3:4:6 of 490 Hz), each note with an hp-noise tick on the onset. Returns stereo."""
    r = _r(rng)
    n = int(0.75 * SR)
    L = np.zeros(n); R = np.zeros(n)
    for t0, fq, amp, tau, pan in ((0.0, 1470, 0.8, 0.09, -0.25), (0.065, 1960, 0.8, 0.09, 0.25),
                                  (0.13, 2940, 1.0, 0.18, 0.0)):
        k = int(t0 * SR)
        m = n - k
        tt = t_(m)
        s = (np.sin(2 * np.pi * fq * tt) + 0.35 * np.sin(2 * np.pi * 2 * fq * tt)) * env_exp(m, tau, 0.001) * amp
        s += filt(noise(m, r), "hp", 5000) * env_exp(m, 0.0015) * 0.3
        gl, gr = pan_gains(pan)
        L[k:] += s * gl; R[k:] += s * gr
    k = int(0.13 * SR)
    sh = np.sin(2 * np.pi * 5880 * t_(n - k)) * env_exp(n - k, 0.05) * 0.15
    L[k:] += sh; R[k:] += sh
    return np.vstack([L, R])
