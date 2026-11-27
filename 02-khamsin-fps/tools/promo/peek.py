#!/usr/bin/env python3
"""挑素材用：从中间片（或逐帧目录）里按“起始帧:帧数”各抽 6 帧，拼成一张预览图。

用法：python3 tools/promo/peek.py <promo-work 目录> <输出.jpg> <源>:<起始帧>:<帧数> [...]
"""
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw

FF = '/opt/homebrew/bin/ffmpeg'


def grab(work, src, f):
    jpg = work / 'frames' / src / f'{f:06d}.jpg'
    if jpg.exists():
        return Image.open(jpg).convert('RGB')
    mp4 = work / 'mezz' / f'{src}.mp4'
    out = subprocess.run([FF, '-v', 'error', '-ss', f'{max(0, f - 0.25) / 60:.5f}', '-i', str(mp4), '-frames:v', '1',
                          '-vf', 'scale=384:216', '-f', 'image2pipe', '-vcodec', 'png', '-'], check=True, capture_output=True).stdout
    import io
    return Image.open(io.BytesIO(out)).convert('RGB')


def main():
    work, out = Path(sys.argv[1]), sys.argv[2]
    specs = sys.argv[3:]
    w, h, n = 384, 216, 6
    sheet = Image.new('RGB', (w * n, (h + 22) * len(specs)), (16, 16, 16))
    d = ImageDraw.Draw(sheet)
    for r, sp in enumerate(specs):
        src, a, ln = sp.split(':')
        a, ln = int(a), int(ln)
        for c in range(n):
            f = a + round(c * (ln - 1) / (n - 1))
            sheet.paste(grab(work, src, f).resize((w, h)), (c * w, r * (h + 22) + 22))
        d.text((6, r * (h + 22) + 4), f'{src} {a}..{a + ln}', fill=(255, 220, 160))
    sheet.save(out, quality=85)


if __name__ == '__main__':
    main()
