#!/bin/zsh
# 摩珂的整套出品（第二段）：整理动作 → 摩珂自己的后处理（art/hero/moko/fix_motions.py，修法在 fix.json）→ 加进模型并压缩。
# build.json 的 motions 指向 motions_fx/，所以改了 motions.json 或 fix.json 以后要跑这个，而不是只跑 tools/hero_build.sh。
# 用法: zsh art/hero/moko/build_all.sh
set -e
cd /Users/jadon7/Documents/SynologyDrive/code/moba
PY=/Users/jadon7/Documents/SynologyDrive/code/video2rig/.venv/bin/python
BL=/Applications/Blender.app/Contents/MacOS/Blender
$PY tools/hero_motion.py art/hero/moko/motions.json
$BL -b --factory-startup -P art/hero/moko/fix_motions.py -- art/hero/moko/build.json art/hero/moko/fix.json 2>&1 | grep -E "^(FIX|Traceback|.*Error|  File)"
zsh tools/hero_build.sh art/hero/moko 2>&1 | grep -E "^(POSED|ACTION|SKIP|SAVED|Traceback|.*Error|[0-9.]+ MB)"
