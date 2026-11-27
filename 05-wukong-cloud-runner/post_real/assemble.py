"""把各镜头的合成帧串成成片（硬切 + 首尾淡入淡出 + 黑场尾巴），混入音轨。
用法：python assemble.py [--crf=14] [--audio=audio/mix_real.wav] [--out=out/v2/wukong_real.mp4] [--only=A,B]
"""
import sys, os, subprocess
import numpy as np
import cv2
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import comp

W, H, FPS = comp.W, comp.H, 24
FADE_IN, FADE_OUT, TAIL = 12, 5, 36

if __name__ == '__main__':
    opts = dict(a[2:].split('=') for a in sys.argv[1:] if a.startswith('--') and '=' in a)
    order = opts['only'].split(',') if 'only' in opts else (opts['order'].split(',') if 'order' in opts else comp.ORDER)
    six = 'F' in order
    frames = []
    for sh in order:
        for f in range(1, comp.SHOT[sh]['n'] + 1):
            frames.append(os.path.join(comp.RR, sh, 'comp_%04d.png' % f))
    missing = [p for p in frames if not os.path.exists(p)]
    if missing:
        print('MISSING', len(missing), missing[:3])
        sys.exit(1)
    out = os.path.join(ROOT, opts.get('out', 'out/v2/wukong_real.mp4'))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    audio = os.path.join(ROOT, opts.get('audio', 'audio/mix_real_f.wav' if six else 'audio/mix_real.wav'))
    cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', '%dx%d' % (W, H), '-r', str(FPS), '-i', '-']
    if os.path.exists(audio) and 'only' not in opts:
        cmd += ['-i', audio, '-c:a', 'aac', '-b:a', '256k']
    cmd += ['-c:v', 'libx264', '-preset', opts.get('preset', 'slow'), '-crf', opts.get('crf', '14'), '-pix_fmt', 'yuv420p',
            '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-movflags', '+faststart', out]
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    n = len(frames)
    full = 'only' not in opts
    for i, fp in enumerate(frames):
        im = cv2.imread(fp, cv2.IMREAD_COLOR)
        if im.shape[1] != W or im.shape[0] != H:
            im = cv2.resize(im, (W, H), interpolation=cv2.INTER_AREA)
        k = 1.0
        if full and i < FADE_IN:
            k = ((i + 1) / (FADE_IN + 1)) ** 1.6
        if full and i >= n - FADE_OUT:
            k = ((n - i) / (FADE_OUT + 1)) ** 1.6
        if k < 1.0:
            im = (im.astype(np.float32) * k + 0.5).astype(np.uint8)
        p.stdin.write(im.tobytes())
    if full:
        black = np.zeros((H, W, 3), np.uint8)
        for i in range(TAIL):
            p.stdin.write(black.tobytes())
    p.stdin.close()
    rc = p.wait()
    print('ASSEMBLED', out, 'frames', n + (TAIL if full else 0), 'rc', rc, 'size %.1f MB' % (os.path.getsize(out) / 1e6))
