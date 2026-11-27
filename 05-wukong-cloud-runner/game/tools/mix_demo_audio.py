"""给录制的演示视频配音：按录制时记下的事件（穿环、翻筋斗、速度）用游戏自带的音效素材离线混一条音轨，再封进 mp4。
用法：python tools/mix_demo_audio.py shots/trailer_raw.mp4 shots/trailer.mp4
注意：这是离线混音，不是游戏里实时音频引擎的录音。
"""
import sys, os, json, subprocess, wave
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
A = os.path.join(ROOT, 'assets', 'audio'); SR = 48000

def load(name):
    with wave.open(os.path.join(A, name + '.wav')) as w:
        d = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
        d = d.reshape(-1, w.getnchannels())
        return d if d.shape[1] == 2 else np.repeat(d, 2, axis=1)

def loop(x, n):
    return np.tile(x, (int(np.ceil(n / len(x))), 1))[:n]

src, dst = sys.argv[1], sys.argv[2]
ev = json.load(open(src + '.events.json'))
n = int(ev['seconds'] * SR)
t = np.arange(n) / SR
# 速度曲线 → 风声高低两层的交叉淡化
sp = [(e['t'], e['v']) for e in ev['log'] if e['type'] == 'speed']
speed = np.interp(t, [a for a, _ in sp], [b for _, b in sp]) if sp else np.full(n, 60.0)
k = np.clip((speed - 45) / 70, 0, 1)[:, None]
mix = loop(load('music_bed'), n) * 0.9
mix += loop(load('wind_low'), n) * (0.55 * (1 - 0.6 * k)) + loop(load('wind_high'), n) * (0.75 * k) + loop(load('cloth_loop'), n) * (0.25 + 0.35 * k)
def add(name, at, gain=1.0):
    x = load(name) * gain; i = int(at * SR)
    if i < n: mix[i:i + len(x)] += x[:max(0, n - i)]
for e in ev['log']:
    if e['type'] == 'hoop': add('hoop' if e['combo'] <= 1 else 'hoop_combo_%d' % min(5, e['combo'] - 1), e['t'], 0.8)
    elif e['type'] == 'flip': add('flip', e['t'], 0.9); add('boost', e['t'] + 0.1, 0.5)
fade = np.minimum(1, np.minimum(t / 0.8, (ev['seconds'] - t) / 1.2))[:, None]
mix = np.tanh(mix * fade * 0.9)
tmp = dst + '.wav'
with wave.open(tmp, 'w') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes((np.clip(mix, -1, 1) * 32767).astype(np.int16).tobytes())
r = subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', src, '-i', tmp, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '224k', '-shortest', '-movflags', '+faststart', dst])
os.remove(tmp)
print('MIXED', dst, 'rc', r.returncode, 'events', sum(1 for e in ev['log'] if e['type'] != 'speed'), 'peak %.2f' % float(np.abs(mix).max()))
