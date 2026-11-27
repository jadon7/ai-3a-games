#!/bin/zsh
# 渲一段动作的连拍：zsh frames.sh <模型.glb> <动作名> <帧号,… 或 起:止:步长> <输出名> [视角=0:5,90:5] [每行几帧=8]
cd /Users/jadon7/Documents/SynologyDrive/code/moba
out=art/hero/seren/sheets/$4.jpg
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P art/hero/seren/frames.py -- $1 $out $2 "$3" "${5:-0:5,90:5}" 300 2>&1 | grep -E "^FRAMES|Traceback|Error"
python3 - "$out" ${6:-8} <<'PY'
import sys, glob, os, re
from PIL import Image, ImageDraw
out, cols = sys.argv[1], int(sys.argv[2]); tmp = os.path.splitext(out)[0] + "_tmp"
fs = sorted(glob.glob(tmp + "/*.png")); frames = sorted(set(int(os.path.basename(f)[:3]) for f in fs)); nv = len(fs) // max(1, len(frames))
w = 300; cw = w * nv + 4; rows = (len(frames) + cols - 1) // cols
S = Image.new("RGB", (cw * cols, w * rows), (30, 30, 30)); d = ImageDraw.Draw(S)
for i, f in enumerate(frames):
    for j in range(nv):
        S.paste(Image.open(f"{tmp}/{f:03d}_{j}.png").convert("RGB"), ((i % cols) * cw + j * w, (i // cols) * w))
    d.text(((i % cols) * cw + 4, (i // cols) * w + 3), str(f), fill=(255, 40, 40))
S.save(out, quality=85)
for f in fs: os.remove(f)
os.rmdir(tmp)
PY
echo $out
