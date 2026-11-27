#!/usr/bin/env python3
"""KHAMSIN 宣传片剪辑：按 tools/promo/edl.json 把中间片剪成成片。

步骤（每步都可单独重跑）：
  clips    从 promo-work/mezz/<src>.mp4 精确到帧地截出每个镜头 -> promo-work/clips/<id>.mp4
  text     用 Pillow 画片名、卖点字幕、片尾卡（透明 PNG）-> promo-work/text/
  plan     生成配乐计划 promo-work/music_plan.json（在浏览器里离线渲染成 music.wav，见 README）
  audio    拼音效 / 环境声 / 配乐 -> promo-work/mix.wav（numpy 混音 + 峰值限制）
  final    拼接 + 叠字 + 混音 -> promo/KHAMSIN-宣传片.mp4
  sheet    每 4 秒抽一帧 -> promo/contact-sheet.jpg
  all      依次执行 clips text plan audio final sheet

用法：python3 tools/promo/edit.py <promo-work 目录> [步骤 ...]
"""
import json
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
PROJ = HERE.parent.parent
OUT_DIR = PROJ / 'promo'
FINAL = OUT_DIR / 'KHAMSIN-宣传片.mp4'
SHEET = OUT_DIR / 'contact-sheet.jpg'
FF = '/opt/homebrew/bin/ffmpeg'
FP = '/opt/homebrew/bin/ffprobe'
W, H, FPS, SR = 1920, 1080, 60, 48000


def find_font():
    cands = [Path('/System/Library/Fonts/PingFang.ttc')]
    cands += sorted(Path('/System/Library/AssetsV2').glob('com_apple_MobileAsset_Font*/*/AssetData/PingFang.ttc'))
    for p in cands:
        if p.exists():
            return str(p), {'regular': 3, 'medium': 7, 'semibold': 11, 'light': 15}   # PingFang SC 各字重
    return '/System/Library/Fonts/Hiragino Sans GB.ttc', {'regular': 0, 'medium': 2, 'semibold': 2, 'light': 0}


FONT, FIDX = find_font()


def font(size, weight='medium'):
    return ImageFont.truetype(FONT, size, index=FIDX[weight])


def run(cmd):
    subprocess.run(cmd, check=True)


def load_edl():
    return json.loads((HERE / 'edl.json').read_text())


def timeline(edl):
    """每个镜头在成片里的起点（帧）。"""
    t, out = 0, []
    for s in edl['shots']:
        out.append((s, t))
        t += s['len']
    return out, t


def resolve_text(edl):
    """字幕时间：可写绝对秒数 start/end，也可写 shot（从该镜头开头算）+ offset + dur；dur 缺省到该镜头结束。"""
    shots, total = timeline(edl)
    pos = {s['id']: (t0 / FPS, (t0 + s['len']) / FPS) for s, t0 in shots}
    out = []
    for c in edl['text']:
        c = dict(c)
        if 'shot' in c:
            a, b = pos[c['shot']]
            c['start'] = a + c.get('offset', 0.0)
            c['end'] = c['start'] + c['dur'] if 'dur' in c else b
            c['end'] = min(c['end'], total / FPS)
        out.append(c)
    return out


# ---------------------------------------------------------------- clips
def step_clips(work, edl):
    cdir = work / 'clips'
    cdir.mkdir(exist_ok=True)
    for s in edl['shots']:
        src = work / 'mezz' / f"{s['src']}.mp4"
        out = cdir / f"{s['id']}.mp4"
        ss = max(0.0, (s['in'] - 0.25) / FPS)
        vf = []
        if s.get('crop'):   # 静态裁切（推近），x y w h 以 1920×1080 为基准
            x, y, w, h = s['crop']
            vf.append(f'crop={w}:{h}:{x}:{y},scale={W}:{H}:flags=lanczos')
        vf.append('setsar=1,format=yuv420p')
        cmd = [FF, '-v', 'error', '-y', '-ss', f'{ss:.6f}', '-i', str(src), '-frames:v', str(s['len']),
               '-vf', ','.join(vf), '-an', '-r', str(FPS), '-c:v', 'libx264', '-preset', 'medium', '-crf', '12',
               '-g', '60', str(out)]
        run(cmd)
        n = int(subprocess.run([FP, '-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries',
                                'stream=nb_read_frames', '-of', 'csv=p=0', str(out)], check=True,
                               capture_output=True, text=True).stdout.strip().split(',')[0])
        if n != s['len']:
            raise SystemExit(f"{s['id']}: 截出 {n} 帧，应为 {s['len']}（源 {s['src']} 可能不够长）")
        print(f"clip {s['id']} <- {s['src']}[{s['in']}:{s['in'] + s['len']}]")


# ---------------------------------------------------------------- text
SAND = (232, 196, 140, 255)
WHITE = (246, 242, 234, 255)


def shadowed(layer_size, draw_fn, blur=10, alpha=170):
    """先画一份黑色模糊的投影，再画正文，保证亮背景上也看得清。"""
    base = Image.new('RGBA', layer_size, (0, 0, 0, 0))
    sh = Image.new('RGBA', layer_size, (0, 0, 0, 0))
    draw_fn(ImageDraw.Draw(sh), (0, 0, 0, alpha), True)
    sh = sh.filter(ImageFilter.GaussianBlur(blur))
    base.alpha_composite(sh)
    draw_fn(ImageDraw.Draw(base), None, False)
    return base


def spaced(d, xy, text, f, fill, spacing):
    x, y = xy
    for ch in text:
        d.text((x, y), ch, font=f, fill=fill)
        x += d.textlength(ch, font=f) + spacing
    return x


def spaced_len(d, text, f, spacing):
    return sum(d.textlength(ch, font=f) for ch in text) + spacing * (len(text) - 1)


def make_title(path):
    # 画面中央一条柔和的暗带，让片名在亮沙色背景上可读
    band = Image.new('L', (W, H), 0)
    bd = ImageDraw.Draw(band)
    for y in range(H):
        a = max(0.0, 1 - abs(y - H * 0.5) / (H * 0.26))
        bd.line([(0, y), (W, y)], fill=int(165 * (a * a * (3 - 2 * a))))
    img = Image.new('RGBA', (W, H), (12, 9, 6, 0))
    img.putalpha(band)
    f1, f2, f3 = font(150, 'semibold'), font(44, 'medium'), font(34, 'light')
    probe = ImageDraw.Draw(img)
    t1, t2, t3 = '热风行动', 'KHAMSIN', '原创网页第一人称射击'
    w1 = spaced_len(probe, t1, f1, 30)
    w2 = spaced_len(probe, t2, f2, 26)
    w3 = spaced_len(probe, t3, f3, 8)
    y2, y1, y3 = 362, 420, 652

    def draw(d, fill, is_shadow):
        spaced(d, ((W - w2) / 2, y2), t2, f2, fill or SAND, 26)
        spaced(d, ((W - w1) / 2, y1), t1, f1, fill or WHITE, 30)
        if not is_shadow:
            d.line([(W / 2 - 60, y3 - 22), (W / 2 + 60, y3 - 22)], fill=SAND, width=3)
        spaced(d, ((W - w3) / 2, y3), t3, f3, fill or WHITE, 8)
    img.alpha_composite(shadowed((W, H), draw, 14, 150))
    img.save(path)


def make_caption(path, text, sub=None):
    """左下角的卖点字幕：沙色竖条 + 正文 + 小字说明。"""
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    # 左下角的暗角渐变，保证字幕区域可读
    g = Image.new('L', (W, H), 0)
    px = g.load()
    for y in range(H - 330, H):
        for x in range(0, 1150, 2):
            a = max(0.0, (y - (H - 330)) / 330) * max(0.0, 1 - x / 1150)
            v = int(150 * a)
            px[x, y] = v
            px[x + 1, y] = v
    img = Image.composite(Image.new('RGBA', (W, H), (10, 8, 5, 255)), img, g)
    f1, f2 = font(64, 'semibold'), font(32, 'regular')
    x0, y0 = 120, H - 220 if sub else H - 170

    def draw(d, fill, is_shadow):
        if not is_shadow:
            d.rectangle([x0 - 34, y0 + 10, x0 - 26, y0 + (130 if sub else 76)], fill=SAND)
        spaced(d, (x0, y0), text, f1, fill or WHITE, 4)
        if sub:
            spaced(d, (x0 + 2, y0 + 88), sub, f2, fill or (230, 222, 205, 255), 3)
    img.alpha_composite(shadowed((W, H), draw, 8, 160))
    img.save(path)


def make_endcard(path, lines):
    img = Image.new('RGBA', (W, H), (8, 6, 4, 200))
    f1, f2, f3 = font(120, 'semibold'), font(40, 'medium'), font(34, 'light')
    d = ImageDraw.Draw(img)
    t1, t2 = '热风行动', 'KHAMSIN'
    w1, w2 = spaced_len(d, t1, f1, 24), spaced_len(d, t2, f2, 24)
    spaced(d, ((W - w2) / 2, 360), t2, f2, SAND, 24)
    spaced(d, ((W - w1) / 2, 412), t1, f1, WHITE, 24)
    d.line([(W / 2 - 60, 600), (W / 2 + 60, 600)], fill=SAND, width=3)
    y = 630
    for ln in lines:
        wl = spaced_len(d, ln, f3, 6)
        spaced(d, ((W - wl) / 2, y), ln, f3, (232, 226, 214, 255), 6)
        y += 56
    img.save(path)


def step_text(work, edl):
    tdir = work / 'text'
    tdir.mkdir(exist_ok=True)
    for i, c in enumerate(edl['text']):
        p = tdir / f'text{i:02d}.png'
        if c['kind'] == 'title':
            make_title(p)
        elif c['kind'] == 'caption':
            make_caption(p, c['text'], c.get('sub'))
        elif c['kind'] == 'end':
            make_endcard(p, c['lines'])
        print('text', p.name, c.get('text') or c['kind'])


# ---------------------------------------------------------------- music plan
def step_plan(work, edl):
    """生成两份在浏览器里离线渲染的事件表（帧号是成片时间轴上的帧）：
    music_plan.json  战斗配乐：按段落设定强度，最后接胜利短句
    extra_plan.json  非实战镜头的环境风声（实战镜头自带音效时把风声压到 0）+ 镜头里手工指定的音效（如机甲落地）"""
    shots, total = timeline(edl)
    plan = [[0, 'setIntensity', [edl['music'].get('i0', 0.3)]], [0, 'music', ['combat']]]
    for t, v in edl['music'].get('intensity', []):
        plan.append([int(t * FPS), 'setIntensity', [v]])
    if edl['music'].get('end_sting') is not None:
        plan.append([int(edl['music']['end_sting'] * FPS), 'music', ['victory']])
    plan.sort(key=lambda x: x[0])
    (work / 'music_plan.json').write_text(json.dumps({'frames': total + FPS * 2, 'plan': plan}))
    extra = []
    gameplay = set(edl['audio'].get('gameplay_srcs', []))
    for s, t0 in shots:
        vol = 0.0 if s['src'] in gameplay else edl['audio'].get('wind', 0.5)
        extra.append([t0, 'loop', ['wind', True, {'volume': vol}]])
        for f, m, a in s.get('sfx_events', []):
            extra.append([t0 + f, m, a])
    extra.sort(key=lambda x: x[0])
    (work / 'extra_plan.json').write_text(json.dumps({'frames': total + FPS * 2, 'plan': extra}))
    print('music plan:', len(plan), 'events; extra plan:', len(extra), 'events;', total / FPS, 's')


# ---------------------------------------------------------------- audio
def read_wav(p):
    with wave.open(str(p)) as w:
        assert w.getframerate() == SR and w.getsampwidth() == 2, p
        a = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
        return a.reshape(-1, w.getnchannels())


def write_wav(p, a):
    a = np.clip(a, -1, 1)
    with wave.open(str(p), 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((a * 32767).astype(np.int16).tobytes())


def seg(src, start_s, n, fade_in=0.012, fade_out=0.025):
    i0 = int(round(start_s * SR))
    out = np.zeros((n, 2), np.float32)
    if i0 < len(src):
        piece = src[max(0, i0):i0 + n]
        out[:len(piece)] = piece
    fi, fo = int(fade_in * SR), int(fade_out * SR)
    if fi:
        out[:fi] *= np.linspace(0, 1, fi)[:, None]
    if fo:
        out[-fo:] *= np.linspace(1, 0, fo)[:, None]
    return out


def step_audio(work, edl):
    shots, total = timeline(edl)
    n_total = int(total / FPS * SR)
    mix_sfx = np.zeros((n_total, 2), np.float32)
    A = edl['audio']
    src_map = {}   # 采集段名 -> (音效轨, 该段在轨上的起始帧)
    for name in A.get('sfx_wavs', []):
        if (work / name).exists():
            arr = read_wav(work / name)
            for src, (off, _n) in json.loads((work / (name + '.offsets.json')).read_text()).items():
                src_map[src] = (arr, off)
        else:
            print('警告：缺少音效轨', name)
    for s, t0 in shots:
        n = int(s['len'] / FPS * SR)
        i0 = int(t0 / FPS * SR)
        n = min(n, n_total - i0)
        if s['src'] in src_map:
            arr, off = src_map[s['src']]
            mix_sfx[i0:i0 + n] += seg(arr, (off + s['in']) / FPS, n) * A.get('sfx_gain', 1.0) * s.get('sfx_gain', 1.0)
    if (work / A['extra_wav']).exists():
        ex = read_wav(work / A['extra_wav'])
        k = min(len(ex), n_total)
        mix_sfx[:k] += ex[:k] * A.get('extra_gain', 1.0)
    else:
        print('警告：缺少环境声 / 手工音效轨', A['extra_wav'])
    mus = read_wav(work / A['music_wav']) if (work / A['music_wav']).exists() else None
    out = mix_sfx.copy()
    if mus is not None:
        m = np.zeros_like(out)
        k = min(len(mus), n_total)
        m[:k] = mus[:k]
        out += m * A.get('music_gain', 0.5)
    else:
        print('警告：没有配乐 wav，只混音效')
    # 收尾：最后 fade_out 秒淡出
    fo = int(A.get('fade_out', 1.5) * SR)
    out[-fo:] *= np.linspace(1, 0, fo)[:, None]
    fi = int(0.3 * SR)
    out[:fi] *= np.linspace(0, 1, fi)[:, None]
    # 简单的峰值限制：先压到 RMS 目标，再软削波
    rms = float(np.sqrt(np.mean(out ** 2)) + 1e-9)
    out *= (10 ** (A.get('rms_db', -17) / 20)) / rms
    out = np.tanh(out * 1.1) / np.tanh(1.1)
    out *= 0.89 / max(0.89, float(np.abs(out).max()))
    write_wav(work / 'mix.wav', out)
    print('mix.wav', out.shape[0] / SR, 's  rms', 20 * np.log10(np.sqrt(np.mean(out ** 2))), 'dB')


# ---------------------------------------------------------------- final
def step_final(work, edl):
    shots, total = timeline(edl)
    lst = work / 'clips' / 'list.txt'
    lst.write_text(''.join(f"file '{(work / 'clips' / (s['id'] + '.mp4')).as_posix()}'\n" for s, _ in shots))
    main = work / 'main.mp4'
    run([FF, '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', str(lst), '-c', 'copy', str(main)])
    dur = total / FPS
    inputs = ['-i', str(main)]
    fl = []
    last = '0:v'
    k = 1
    for i, c in enumerate(resolve_text(edl)):
        p = work / 'text' / f'text{i:02d}.png'
        d = c['end'] - c['start']
        inputs += ['-loop', '1', '-framerate', str(FPS), '-t', f'{d:.3f}', '-i', str(p)]
        fi, fo = c.get('fade_in', 0.35), c.get('fade_out', 0.35)
        fl.append(f'[{k}:v]format=rgba,fade=t=in:st=0:d={fi}:alpha=1,fade=t=out:st={d - fo:.3f}:d={fo}:alpha=1,'
                  f'setpts=PTS-STARTPTS+{c["start"]:.3f}/TB[t{k}]')
        fl.append(f'[{last}][t{k}]overlay=0:0:eof_action=pass:repeatlast=0[v{k}]')
        last = f'v{k}'
        k += 1
    fade = edl.get('fade', {})
    fl.append(f'[{last}]fade=t=in:st=0:d={fade.get("in", 0.25)},fade=t=out:st={dur - fade.get("out", 1.0):.3f}:'
              f'd={fade.get("out", 1.0)},scale=in_range=pc:out_range=tv,format=yuv420p[vout]')
    mix = work / 'mix.wav'
    amap = []
    if mix.exists():
        inputs += ['-i', str(mix)]
        amap = ['-map', f'{k}:a', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000']
    OUT_DIR.mkdir(exist_ok=True)
    cmd = [FF, '-v', 'error', '-y', *inputs, '-filter_complex', ';'.join(fl), '-map', '[vout]', *amap,
           '-t', f'{dur:.3f}', '-r', str(FPS), '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-profile:v', 'high',
           '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
           '-movflags', '+faststart', str(FINAL)]
    run(cmd)
    print('final ->', FINAL)


# ---------------------------------------------------------------- contact sheet
def step_sheet(work, edl):
    tmp = work / 'sheet'
    tmp.mkdir(exist_ok=True)
    for p in tmp.glob('*.png'):
        p.unlink()
    run([FF, '-v', 'error', '-y', '-i', str(FINAL), '-vf', f"select='eq(mod(n\\,{4 * FPS})\\,{FPS // 2})',scale=480:270:flags=lanczos",
         '-vsync', 'vfr', str(tmp / 's%03d.png')])
    frames = sorted(tmp.glob('s*.png'))
    cols = 4
    rows = (len(frames) + cols - 1) // cols
    cw, ch, lab, pad = 480, 270, 34, 8
    sheet = Image.new('RGB', (cols * (cw + pad) + pad, rows * (ch + lab + pad) + pad + 50), (20, 18, 16))
    d = ImageDraw.Draw(sheet)
    d.text((pad, 10), f'KHAMSIN 宣传片 · 每 4 秒一帧（取各 4 秒段的第 0.5 秒，避开片头淡入）· 共 {len(frames)} 帧', font=font(26, 'medium'), fill=(230, 220, 200))
    shots, _ = timeline(edl)
    for i, p in enumerate(frames):
        t = i * 4
        sid = next((s['id'] for s, t0 in reversed(shots) if t0 <= t * FPS + FPS // 2), '')
        x, y = pad + (i % cols) * (cw + pad), 50 + pad + (i // cols) * (ch + lab + pad)
        sheet.paste(Image.open(p).convert('RGB'), (x, y))
        d.text((x + 4, y + ch + 3), f'{t // 60:02d}:{t % 60:02d}.5  {sid}', font=font(24, 'regular'), fill=(235, 228, 214))
    sheet.save(SHEET, quality=90)
    print('sheet ->', SHEET, len(frames), 'frames')


# ---------------------------------------------------------------- shot list
def tc(f):
    s = f / FPS
    return f'{int(s // 60):02d}:{s % 60:05.2f}'


def step_shotlist(work, edl):
    shots, total = timeline(edl)
    texts = resolve_text(edl)
    L = ['# KHAMSIN · 热风行动 宣传片 镜头表', '',
         f'成片 `promo/KHAMSIN-宣传片.mp4`：{W}×{H}，{FPS} fps，总长 {tc(total)}（{total} 帧）。时间码为 分:秒.百分秒。',
         '画面全部是离线逐帧渲染的无界面画面（游戏 HUD 是 DOM，不在画布里），文字为后期叠加。',
         '“士兵近景”列标“是”的镜头含第三人称士兵 / 铁驭近景，走路动画再改时需要重采（流程见 `tools/promo/README.md`）。', '',
         '| # | 时间码 | 时长 | 类型 | 内容 | 素材（源:入点帧） | 采集方式 / 机位 | 士兵近景 |', '| --- | --- | --- | --- | --- | --- | --- | --- |']
    for s, t0 in shots:
        L.append(f"| {s['id']} | {tc(t0)}–{tc(t0 + s['len'])} | {s['len'] / FPS:.2f}s | {s['kind']} | {s['desc']} | "
                 f"{s['src']}:{s['in']} | {edl.get('sources', {}).get(s['src'], '')} | {s.get('soldier', '否')} |")
    L += ['', '## 文字', '', '| 时间码 | 内容 |', '| --- | --- |']
    for c in texts:
        t = {'title': '片名：KHAMSIN / 热风行动 / 原创网页第一人称射击', 'end': '片尾卡：KHAMSIN / 热风行动 / ' + ' '.join(c.get('lines', []))}.get(c['kind'])
        t = t or f"卖点字幕：{c['text']}（{c.get('sub', '')}）"
        L.append(f"| {tc(c['start'] * FPS)}–{tc(c['end'] * FPS)} | {t} |")
    g = sum(s['len'] for s, _ in shots if s['kind'].startswith('实战'))
    L += ['', f'实战镜头合计 {g / FPS:.1f} 秒，占 {100 * g / total:.0f}%。', '',
          '## 声音', '', '- 音效：采集实战镜头时记录了游戏音频引擎的每一次调用（帧号 + 参数），之后用游戏自己的程序化音频引擎在 OfflineAudioContext 里按帧重放渲染，和画面逐帧对齐；全程没有接扬声器。',
          '- 空镜下是同一引擎的风声循环；机甲空降（第三人称）镜头的预警声和落地声按落地帧手工放置。',
          '- 配乐：游戏的战斗配乐（程序化），按段落设定强度，片尾接胜利短句。']
    (OUT_DIR / '镜头表.md').write_text('\n'.join(L) + '\n')
    print('shot list ->', OUT_DIR / '镜头表.md')


STEPS = {'shotlist': step_shotlist, 'clips': step_clips, 'text': step_text, 'plan': step_plan, 'audio': step_audio, 'final': step_final, 'sheet': step_sheet}

if __name__ == '__main__':
    work = Path(sys.argv[1]).resolve()
    steps = sys.argv[2:] or ['all']
    if steps == ['all']:
        steps = ['clips', 'text', 'plan', 'audio', 'final', 'sheet', 'shotlist']
    edl = load_edl()
    for st in steps:
        STEPS[st](work, edl)
