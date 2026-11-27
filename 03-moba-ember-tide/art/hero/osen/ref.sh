#!/bin/zsh
# 在管线的双机位棚里用当前站姿渲染正面、侧面，拼成参考图（手册第 5 步）。
cd /Users/jadon7/Documents/SynologyDrive/code/moba
BL=/Applications/Blender.app/Contents/MacOS/Blender; V2R=/Users/jadon7/Documents/SynologyDrive/code/video2rig
$BL -b --factory-startup $V2R/assets/model/osen.blend -P tools/blender/hero_ref.py -- $V2R "$PWD/art/hero/osen/stance.npz" "$PWD/art/hero/osen/ref" 2>&1 | grep -E "^(RENDERED|Traceback|.*Error)"
$V2R/.venv/bin/python tools/hero_refsheet.py art/hero/osen/ref_front.png art/hero/osen/ref_side.png $V2R/assets/ref/osen_ref.png
