# Measures every sound in a folder: sample peak, loudest 100 ms (dBFS RMS), share of samples
# sitting at the peak (flat tops = clipping in the source), brightness, and length.
# Run:  python tools/audio/measure.py [folder]      (default: audio/)
import os, subprocess, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SR = 44100


def load(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).astype(np.float64)


def db(v):
    return 20.0 * np.log10(max(v, 1e-9))


def loud100(x):
    n = int(0.1 * SR)
    if x.size <= n:
        return db(np.sqrt((x ** 2).mean()))
    c = np.cumsum(np.concatenate([[0.0], x ** 2]))
    return db(np.sqrt(((c[n:] - c[:-n]) / n).max()))


def stats(x):
    pk = float(np.abs(x).max())
    # flat tops: runs of 3+ consecutive samples within 0.5% of the peak
    at = np.abs(x) > pk * 0.995
    runs = at[2:] & at[1:-1] & at[:-2]
    spec = np.abs(np.fft.rfft(x * np.hanning(x.size)))
    fr = np.fft.rfftfreq(x.size, 1 / SR)
    hi = float((spec[fr > 5000] ** 2).sum() / ((spec ** 2).sum() + 1e-12))
    return pk, loud100(x), int(runs.sum()), hi


if __name__ == '__main__':
    folder = sys.argv[1] if len(sys.argv) > 1 else os.path.normpath(os.path.join(HERE, '..', '..', 'audio'))
    print('%-18s %5s %6s %7s %6s %5s' % ('file', 'dur', 'peak', 'loud', 'flat', 'hi%'))
    for f in sorted(os.listdir(folder)):
        if not f.endswith(('.ogg', '.wav')):
            continue
        x = load(os.path.join(folder, f))
        pk, ld, flat, hi = stats(x)
        print('%-18s %5.2f %6.1f %7.1f %6d %5.0f' % (f, x.size / SR, db(pk), ld, flat, hi * 100))
