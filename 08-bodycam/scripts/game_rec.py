"""把自动试玩逐帧保存的画面（game/_shots/<前缀>_NNNN.jpg）加上记录仪时间戳，压成 mp4（无声）。
  .venv/bin/python scripts/game_rec.py <前缀> <输出文件名> [起始帧] [结束帧]
"""
import os, sys, glob, subprocess
import numpy as np
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import post
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
pre, name = sys.argv[1], sys.argv[2]
files = sorted(glob.glob(os.path.join(ROOT, "game", "_shots", pre + "_[0-9]*.jpg")))
a = int(sys.argv[3]) if len(sys.argv) > 3 else 0; b = int(sys.argv[4]) if len(sys.argv) > 4 else len(files)
files = files[a:b]
out = os.path.join(ROOT, "out", name)
cmd = ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "1920x1080", "-r", "30", "-i", "-",
       "-c:v", "libx264", "-preset", "medium", "-b:v", "9000k", "-maxrate", "12000k", "-bufsize", "9000k", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out]
p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
for i, f in enumerate(files):
    im = np.asarray(Image.open(f).convert("RGB"))
    p.stdin.write(post.overlay(im, i + 1).tobytes())
p.stdin.close(); p.wait()
print(out, len(files), "frames", round(os.path.getsize(out) / 1e6, 1), "MB")
