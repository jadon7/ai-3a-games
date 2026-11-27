# Masters the game's sound effects: tools/audio/src/<id>.ogg  ->  audio/<id>.ogg
#
# The sources come from different packs and tools and were far apart in level (a 20 dB
# spread), several decoded above full scale (audible break-up), and some were all hiss.
# For every sound this does, in order:
#   1. remove DC / sub rumble (20 Hz high-pass)
#   2. tame harshness: a high shelf cut sized by how much of the energy sits above 5 kHz
#   3. set the loudness of its loudest 100 ms to the target of its role (table below)
#   4. look-ahead peak limiter to a -2 dBFS ceiling (gain rides down before a peak, no clipping)
#   5. short fades at both ends
# and encodes mono 44.1 kHz Ogg Vorbis, then checks the decoded result is under -1 dBFS.
#
# Run:  python tools/audio/master.py            (needs ffmpeg, numpy, scipy)
# To replace a sound: put the new file in tools/audio/src/ under the id's name and run again.
import os, subprocess, sys
import numpy as np
from scipy.ndimage import minimum_filter1d, uniform_filter1d
from scipy.signal import butter, sosfilt

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from measure import load, loud100, stats, db, SR  # noqa: E402

SRC = os.path.join(HERE, 'src')
OUT = os.path.normpath(os.path.join(HERE, '..', '..', 'audio'))
CEIL_DB = -2.0
MAX_LIMIT_DB = 4.0      # never ask the limiter for more than this: peaky sounds stay a little quieter instead

# loudest-100-ms level (dBFS RMS) by role
ROLES = {
    'ui': (-21.0, ['click', 'confirm', 'touch', 'lock', 'warn', 'alarm', 'radio', 'servo', 'swap', 'reload', 'scan', 'jam', 'focus']),
    'small': (-18.0, ['gatling', 'smg', 'rifle', 'beam_rifle', 'hit', 'ric', 'heat_hit']),
    'heavy': (-15.0, ['cannon', 'shotgun', 'missile', 'rail', 'grenade', 'cannon_big']),
    'blast': (-14.0, ['explosion', 'bigboom', 'flak', 'collapse']),
    'body': (-17.0, ['step', 'land', 'boost', 'qb', 'brace', 'hurt', 'stagger', 'shield', 'shield_break', 'clang', 'swing', 'whiff', 'plasma_swing', 'hook', 'ram']),
    'system': (-18.0, ['od_on', 'od_off', 'charge', 'banner', 'repair', 'jet']),
    'siren': (-21.0, ['siren']),
    'loop': (-19.0, ['thr_loop', 'drone_loop']),
    'wind': (-22.0, ['wind_loop']),
    'music': (-13.0, ['bgm_battle']),
}
TARGET = {}
for role, (lv, ids) in ROLES.items():
    for i in ids:
        TARGET[i] = (role, lv)


def shelf_cut(x, hi):
    # hi = share of energy above 5 kHz. Up to ~35 % is left alone; all-hiss sounds lose up to 9 dB of top.
    cut_db = float(np.clip((hi - 0.35) / 0.6, 0.0, 1.0)) * 9.0
    if cut_db < 0.5:
        return x, 0.0
    sos = butter(2, 4500.0, 'lowpass', fs=SR, output='sos')
    low = sosfilt(sos, x)
    return low + (x - low) * (10.0 ** (-cut_db / 20.0)), cut_db


def limit(x, ceil):
    need = np.minimum(1.0, ceil / np.maximum(np.abs(x), 1e-9))
    la = int(0.003 * SR)
    g = minimum_filter1d(need, 2 * la + 1, mode='nearest')      # start turning down 3 ms early ...
    g = uniform_filter1d(g, la, mode='nearest')                 # ... smoothly
    rel = int(0.04 * SR)
    g = np.minimum(g, minimum_filter1d(uniform_filter1d(g, rel, mode='nearest'), 1))  # and let go over 40 ms
    return x * np.minimum(g, need)


def master(sid, x):
    role, lv = TARGET[sid]
    x = sosfilt(butter(2, 20.0, 'highpass', fs=SR, output='sos'), x)
    pk0, ld0, flat, hi = stats(x)
    x, cut = shelf_cut(x, hi)
    pk, ld = float(np.abs(x).max()), loud100(x)
    gain = lv - ld
    gain = min(gain, CEIL_DB - db(pk) + MAX_LIMIT_DB)
    x = x * (10.0 ** (gain / 20.0))
    over = max(0.0, db(float(np.abs(x).max())) - CEIL_DB)
    x = limit(x, 10.0 ** (CEIL_DB / 20.0))
    if role not in ('loop', 'wind', 'music'):
        a, b = int(0.003 * SR), min(int(0.02 * SR), x.size // 4)
        x[:a] *= np.linspace(0, 1, a)
        x[-b:] *= np.linspace(1, 0, b)
    return x, (ld0, gain, cut, over)


def main():
    print('%-14s %-6s %7s %6s %5s %6s | %6s %6s' % ('id', 'role', 'was', 'gain', 'shelf', 'limit', 'peak', 'loud'))
    bad = []
    for f in sorted(os.listdir(SRC)):
        sid = os.path.splitext(f)[0]
        if sid not in TARGET:
            print('%-14s  (no role: skipped)' % sid)
            continue
        x, (ld0, gain, cut, over) = master(sid, load(os.path.join(SRC, f)))
        dst = os.path.join(OUT, sid + '.ogg')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', '-', '-c:a', 'libvorbis', '-q:a', '6', dst],
                       input=x.astype(np.float32).tobytes(), check=True)
        y = load(dst)
        pk, ld = db(float(np.abs(y).max())), loud100(y)
        print('%-14s %-6s %7.1f %+6.1f %5.1f %6.1f | %6.1f %6.1f' % (sid, TARGET[sid][0], ld0, gain, cut, over, pk, ld))
        if pk > -1.0:
            bad.append(sid)
    print('over -1 dBFS after encoding:', bad if bad else 'none')


if __name__ == '__main__':
    main()
