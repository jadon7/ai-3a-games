#!/bin/zsh
# 薇萝的成品流程（第二段）。比 tools/hero_build.sh 多一步：把读出来的动作里弩的朝向修正过来（art/hero/vero/fix_motion.py）。
#   1. tools/hero_motion.py     按 motions.json 截取、循环、统一帧率，写到 art/hero/vero/motions/
#   2. fix_motion.py            按 fix.json 修弩的朝向、左手的位置、陷地，写到 art/hero/vero/motions_fix/（build.json 的 motions 指的是这里）
#   3. tools/hero_build.sh      装进模型、压缩，放到 public/assets/hero/vero.glb（它会把第 1 步再跑一遍，不影响结果）
# 注意：只跑 tools/hero_build.sh 不会更新 motions_fix；改了 motions.json 或 fix.json 以后要跑这个脚本。绝不带 rig。
set -e
cd /Users/jadon7/Documents/SynologyDrive/code/moba
PY=/Users/jadon7/Documents/SynologyDrive/code/video2rig/.venv/bin/python; BL=/Applications/Blender.app/Contents/MacOS/Blender
export TMPDIR="${TMPDIR:-/tmp}"
$PY tools/hero_motion.py art/hero/vero/motions.json | cut -c1-240
$BL -b --factory-startup -P art/hero/vero/fix_motion.py -- art/hero/vero/fix.json all 2>&1 | grep -E "^(STANCE|FIX|SKIP|Traceback|  File|.*Error)"
zsh tools/hero_build.sh art/hero/vero 2>&1 | grep -E "^(POSED|ACTION|SKIP|SAVED|Traceback|.*Error|[0-9.]+ MB)"
