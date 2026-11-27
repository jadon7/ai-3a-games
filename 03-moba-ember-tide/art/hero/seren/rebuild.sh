#!/bin/zsh
# 塞伦的成品流程（第二段），改了 motions.json 或 fix.json 以后跑这个。绝不带 rig（RIG_READY 以后模型不许再变）。
#   1. tools/hero_motion.py   按 motions.json 截取、循环、统一帧率 → art/hero/seren/motions/
#   2. fix_motion.py          按 fix.json 修长铳的拿法（扛肩 / 双手端 / 单手垂）、转身对准、陷地 → art/hero/seren/motions_fix/（build.json 的 motions 指这里）
#   3. tools/hero_build.sh    装进模型、压缩 → public/assets/hero/seren.glb（它会把第 1 步再跑一遍，不影响结果）
#   4. 手机档 public/assets/hero/m/seren.glb
# 用法: zsh rebuild.sh [只修的动作名,…]
set -e
cd /Users/jadon7/Documents/SynologyDrive/code/moba
PY=/Users/jadon7/Documents/SynologyDrive/code/video2rig/.venv/bin/python; BL=/Applications/Blender.app/Contents/MacOS/Blender
export TMPDIR="${TMPDIR:-/tmp}"
$PY tools/hero_motion.py art/hero/seren/motions.json | cut -c1-260
$BL -b --factory-startup -P art/hero/seren/fix_motion.py -- art/hero/seren/fix.json ${1:-all} 2>&1 | grep -E "^(WEAPON|STANCE|FIX|SKIP|Traceback|  File|.*Error)"
zsh tools/hero_build.sh art/hero/seren 2>&1 | grep -E "^(POSED|ACTION|SKIP|SAVED|Traceback|.*Error|[0-9.]+ MB)"
mkdir -p public/assets/hero/m && node tools/lite_glb.mjs public/assets/hero/seren.glb public/assets/hero/m/seren.glb 1024 512 2>&1 | tail -1
