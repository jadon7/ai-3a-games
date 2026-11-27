#!/bin/zsh
# 岩甲巨兽：从“读出来的动作”（V2R/out/anim/beast_*/motion.npz）到成品的整条链。改了整理脚本、重新读了视频以后跑这个。
#   1. 一次性动作（attack1、attack2、roar、death）：钉脚、变速、收尾巴、贴地 → src/<动作>.npz
#   2. 走路：周期化、对称化、重建脚的落点 → src/run.npz
#   3. 待机：左右各看一次、钉脚、加呼吸 → src/idle.npz
#   4. tools/creature_build.sh：按 motions.json 整理 → 装进模型 → 导出压缩到 public/assets/unit/beast.glb
#   5. 用 Blender 按蒙皮以后的网格复查每段动作陷没陷进地里 → logs/floor.json
# 用法: zsh art/unit/beast/scripts/rebuild.sh [skip]      加 skip 只做第 4、5 步
set -e
cd "$(dirname "$0")/.."
V=/Users/jadon7/Documents/SynologyDrive/code/video2rig; PY=$V/.venv/bin/python; BL=/Applications/Blender.app/Contents/MacOS/Blender; D=$PWD
[ -f src/skin.npz ] || $BL -b --factory-startup $V/assets/model/beast.blend -P scripts/export_skin.py -- $D/src/skin.npz 2>&1 | grep -E "^SKIN|Traceback|Error"
if [ "$1" != "skip" ]; then
  $PY scripts/prep_shots.py
  $PY scripts/prep_run.py
  $PY scripts/prep_idle.py
fi
cd ../../.. && zsh tools/creature_build.sh art/unit/beast 2>&1 | grep -E "^(idle|run|attack|roar|death)|ACTION|SKIP|SAVED|MB|Traceback|Error"
$BL -b --factory-startup $V/assets/model/beast.blend -P art/unit/beast/scripts/mesh_floor.py -- art/unit/beast/motions art/unit/beast/logs/floor.json 2>&1 | grep -E "^FLOOR|Traceback|Error"
