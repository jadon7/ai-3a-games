#!/usr/bin/env python3
"""联系表：从视频里每隔 <间隔> 秒抽一帧，缩小、标上时间，拼成几张大图（自查和挑镜头用）。
用法: python3 tools/trailer/sheet.py <视频> <输出前缀> [间隔秒=1] [每行=6] [每张行数=5] [开始秒=0] [结束秒=末尾] [缩略宽=320]
输出 <前缀>_1.jpg、<前缀>_2.jpg……
"""
import subprocess
import sys
import tempfile
import os
import glob
from PIL import Image, ImageDraw, ImageFont

a = sys.argv[1:]
vid, pre = a[0], a[1]
step = float(a[2]) if len(a) > 2 else 1.0
cols = int(a[3]) if len(a) > 3 else 6
rows = int(a[4]) if len(a) > 4 else 5
t0 = float(a[5]) if len(a) > 5 else 0.0
t1 = float(a[6]) if len(a) > 6 else None
tw = int(a[7]) if len(a) > 7 else 320
tmp = tempfile.mkdtemp()
cmd = ["ffmpeg", "-v", "error", "-ss", str(t0)] + (["-to", str(t1)] if t1 else []) + ["-i", vid, "-vf", f"fps=1/{step},scale={tw}:-2", f"{tmp}/%05d.jpg"]
subprocess.run(cmd, check=True)
files = sorted(glob.glob(f"{tmp}/*.jpg"))
font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Songti.ttc", 18, index=1)
per = cols * rows
for p in range(0, len(files), per):
    chunk = files[p:p + per]
    im0 = Image.open(chunk[0])
    w, h = im0.size
    sheet = Image.new("RGB", (cols * w, ((len(chunk) - 1) // cols + 1) * h), (40, 0, 40))
    for i, f in enumerate(chunk):
        im = Image.open(f)
        d = ImageDraw.Draw(im)
        t = t0 + (p + i) * step
        d.rectangle([0, 0, 64, 22], fill=(0, 0, 0))
        d.text((4, 2), f"{t:.1f}", font=font, fill=(255, 230, 0))
        sheet.paste(im, ((i % cols) * w, (i // cols) * h))
    out = f"{pre}_{p // per + 1}.jpg"
    sheet.save(out, quality=85)
    print(out)
for f in files:
    os.remove(f)
os.rmdir(tmp)
