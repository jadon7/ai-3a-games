"""把各镜头的渲染帧做后期、按剪辑顺序排成连续序列，再配上音轨编码成片。
用法：python assemble.py <渲染根目录名 如 renders_v1> <输出 mp4> [--skip-post]
"""
import sys, os, glob, subprocess
import numpy as np
import cv2
from multiprocessing import Pool
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import post as PP

FPS = 30
# 剪辑顺序：(镜头, 帧数, 速度感)
EDIT = [('S1', 120, 0.80), ('S3', 120, 0.22), ('S2', 180, 0.90), ('S4', 120, 0.80), ('S5', 120, 0.80), ('S5B', 60, 0.40), ('S6', 150, 0.90)]
FLASH = {'S6': (60, 5.0)}          # 镜头内帧号, 衰减帧数：穿云白闪
TWINKLE = {'S6': (126, 133, 142)}  # 起始帧, 峰值帧, 结束帧：飞远后天边一闪
FADE_OUT = 12


def star(img, cx, cy, size, bright):
    """在 (cx, cy) 画一个四芒星光（加色）。"""
    h, w = img.shape[:2]
    lay = np.zeros((h, w), np.float32)
    L = int(size)
    for ang, ln, th in ((0, 1.0, 2), (90, 1.0, 2), (45, 0.38, 1), (135, 0.38, 1)):
        a = np.radians(ang + 8)
        dx, dy = np.cos(a) * L * ln, np.sin(a) * L * ln
        cv2.line(lay, (int(cx - dx), int(cy - dy)), (int(cx + dx), int(cy + dy)), 1.0, th, cv2.LINE_AA)
    lay = cv2.GaussianBlur(lay, (0, 0), 1.2) * 1.6
    core = np.zeros((h, w), np.float32)
    cv2.circle(core, (int(cx), int(cy)), max(2, int(size * 0.10)), 1.0, -1, cv2.LINE_AA)
    core = cv2.GaussianBlur(core, (0, 0), max(1.5, size * 0.07))
    halo = cv2.GaussianBlur(core, (0, 0), max(4.0, size * 0.35)) * 2.2
    glow = np.clip(lay + core * 1.5 + halo, 0, 1.5) * bright
    tint = np.array([0.92, 0.98, 1.0], np.float32)       # BGR：略带暖白
    return img + glow[..., None] * tint * 255.0


def work(job):
    src, dst, speed, flash, fade, tw = job
    img = cv2.imread(src, cv2.IMREAD_COLOR)
    if img is None:
        return src
    out = PP.process(img, speed).astype(np.float32)
    if flash > 0.003:
        out = out + (255.0 - out) * min(1.0, flash)
    if tw is not None:
        out = star(out, tw[0] * out.shape[1], tw[1] * out.shape[0], tw[2] * out.shape[0] / 1080.0, tw[3])
    if fade < 0.999:
        out = out * fade
    res = np.clip(out, 0, 255).astype(np.uint8)
    if dst is None:
        return res
    cv2.imwrite(dst, res, [cv2.IMWRITE_PNG_COMPRESSION, 1])
    return None


if __name__ == '__main__':
    rdir = os.path.join(ROOT, sys.argv[1])
    out_mp4 = sys.argv[2]
    skip = '--skip-post' in sys.argv
    pipe = '--pipe' in sys.argv
    seq = os.path.join(ROOT, sys.argv[1] + '_post')
    if not pipe:
        os.makedirs(seq, exist_ok=True)
    import json
    jobs, missing = [], []
    total = sum(n for _, n, _ in EDIT)
    g = 0
    for shot, n, speed in EDIT:
        for f in range(1, n + 1):
            src = os.path.join(rdir, shot, f'{shot}_{f:04d}.png')
            if not os.path.exists(src):
                src = os.path.join(rdir, shot, f'{shot}_{f:04d}.jpg')
            dst = None if pipe else os.path.join(seq, f'{g:05d}.png')
            flash = 0.0
            if shot in FLASH:
                f0, dec = FLASH[shot]
                if f >= f0 - 2:
                    flash = 0.85 * np.exp(-max(0, f - f0) / dec) * (1.0 if f >= f0 else (0.3 if f == f0 - 2 else 0.65))
            fade = 1.0
            if g < 8:
                fade = (g + 1) / 8.0
            if g > total - FADE_OUT - 1:
                fade = max(0.0, (total - 1 - g) / float(FADE_OUT))
            tw = None
            if shot in TWINKLE:
                a, pk, b = TWINKLE[shot]
                mp = os.path.join(ROOT, 'shots', 'meta', shot + '.json')
                if a <= f <= b and os.path.exists(mp):
                    meta = json.load(open(mp))
                    x, y, z = meta[str(f)]
                    k = (f - a) / (pk - a) if f <= pk else 1 - (f - pk) / (b - pk)
                    k = max(0.0, k)
                    tw = (x, y, 14 + 62 * k ** 0.8, min(1.0, 0.25 + 0.95 * k))
            if not os.path.exists(src):
                missing.append(src)
            else:
                jobs.append((src, dst, speed, float(flash), float(fade), tw))
            g += 1
    print('frames', total, 'missing', len(missing), missing[:3])
    audio = os.path.join(ROOT, 'audio', 'mix.wav')
    crf = next((a_.split('=')[1] for a_ in sys.argv if a_.startswith('--crf=')), '15')
    preset = next((a_.split('=')[1] for a_ in sys.argv if a_.startswith('--preset=')), 'slow')
    enc = ['-c:v', 'libx264', '-preset', preset, '-crf', crf, '-pix_fmt', 'yuv420p',
           '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
           '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', out_mp4]
    if pipe:
        first = cv2.imread(jobs[0][0], cv2.IMREAD_COLOR)
        h, w = first.shape[:2]
        cmd = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{w}x{h}',
               '-framerate', str(FPS), '-i', '-', '-i', audio] + enc
        ff = subprocess.Popen(cmd, stdin=subprocess.PIPE)
        nbad = 0
        with Pool(8) as p:
            for res in p.imap(work, jobs, chunksize=2):
                if isinstance(res, str) or res is None:
                    nbad += 1
                    continue
                ff.stdin.write(res.tobytes())
        ff.stdin.close()
        rc = ff.wait()
        print('pipe encode rc', rc, 'bad', nbad, 'size', f'{w}x{h}')
    else:
        if not skip:
            with Pool(8) as p:
                bad = [b_ for b_ in p.imap_unordered(work, jobs, chunksize=4) if b_ is not None]
            print('post done, failed', len(bad))
        cmd = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-framerate', str(FPS), '-i', os.path.join(seq, '%05d.png'), '-i', audio] + enc
        r = subprocess.run(cmd, capture_output=True, text=True)
        print('ffmpeg rc', r.returncode, r.stderr[-400:])
    print('OUT', out_mp4, os.path.getsize(out_mp4) if os.path.exists(out_mp4) else 'NA')
