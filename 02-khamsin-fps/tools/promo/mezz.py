#!/usr/bin/env python3
"""把 promo-work/frames/<镜头>/ 下的逐帧 JPEG 压成 60 fps 的中间片 promo-work/mezz/<镜头>.mp4（近无损 x264），
可选删除原始帧以节省磁盘。

用法：python3 tools/promo/mezz.py <promo-work 目录> <镜头名> [<镜头名> ...] [--delete-frames]
"""
import shutil
import subprocess
import sys
from pathlib import Path

FFMPEG = '/opt/homebrew/bin/ffmpeg'


def mezz(work: Path, shot: str, delete: bool) -> None:
    frames = (work / 'frames' / shot).resolve()
    assert frames.parent == (work / 'frames').resolve(), frames
    jpgs = sorted(frames.glob('*.jpg'))
    if not jpgs:
        print('没有帧：', shot)
        return
    # 序号必须连续，否则 image2 会提前结束
    for k, p in enumerate(jpgs):
        if p.stem != f'{k:06d}':
            raise SystemExit(f'{shot}: 帧序号在 {k} 处不连续（{p.name}）')
    out = work / 'mezz' / f'{shot}.mp4'
    out.parent.mkdir(exist_ok=True)
    cmd = [FFMPEG, '-v', 'error', '-y', '-framerate', '60', '-i', str(frames / '%06d.jpg'),
           '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '14', '-g', '30', '-pix_fmt', 'yuv420p', str(out)]
    subprocess.run(cmd, check=True)
    n = int(subprocess.run(['/opt/homebrew/bin/ffprobe', '-v', 'error', '-count_frames', '-select_streams', 'v:0',
                            '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', str(out)],
                           check=True, capture_output=True, text=True).stdout.strip().split(',')[0])
    if n != len(jpgs):
        raise SystemExit(f'{shot}: 中间片帧数 {n} ≠ 原始帧 {len(jpgs)}，不删除原始帧')
    print(f'{shot}: {n} 帧 -> {out} ({out.stat().st_size / 1e6:.0f} MB)')
    if delete:
        shutil.rmtree(frames)
        print('  已删除原始帧', frames)


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    work = Path(args[0])
    for s in args[1:]:
        mezz(work, s, '--delete-frames' in sys.argv)
