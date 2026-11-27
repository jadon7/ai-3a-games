#!/bin/zsh
# 卡兹 B：Tripo 绑好的骨架 → 修错绑 → 改成旧骨骼名 → 摆正出 V2R/assets/model/kaz_b.blend → 读两边骨架 → 改腿的尾巴方向（dir 模式用）
# 用法（worktree 根目录）: zsh art/style_b/kaz/rig/make_rig.sh
set -e
cd "$(dirname "$0")/../../../.."
PY=/Users/jadon7/Documents/SynologyDrive/code/video2rig/.venv/bin/python; V=/Users/jadon7/Documents/SynologyDrive/code/video2rig; BL=/Applications/Blender.app/Contents/MacOS/Blender; K=art/style_b/kaz
$PY tools/retarget/quad_fix_weights.py $K/tripo_rigged.glb $K/rig/fix_weights.json $K/rig/fixed.glb | grep -E "MOVE|SAVED"
$PY tools/retarget/quad_rename.py $K/rig/fixed.glb $K/rig/rename.json $V/assets/model/kaz_b_rigged.glb $V/assets/model/kaz_skeleton.json
(cd $V && $BL -b --factory-startup -P scripts/blender/prep_rig.py -- assets/model/kaz_b_rigged.glb kaz_b 2>&1 | grep -E "^(FORWARD|SCALE|SELFTEST|SAVED|Traceback|.*Error)")
$BL -b --factory-startup $V/assets/model/kaz.blend -P tools/retarget/dump_rig.py -- - $K/rigs/kaz.npz 2>&1 | grep DUMP
$BL -b --factory-startup $V/assets/model/kaz_b.blend -P tools/retarget/dump_rig.py -- - $K/rigs/kaz_b.npz 2>&1 | grep DUMP
$PY tools/retarget/quad_tails.py $K/rigs/kaz.npz $K/rig/tails.json $K/rigs/kaz_t.npz | tail -1
$PY tools/retarget/quad_tails.py $K/rigs/kaz_b.npz $K/rig/tails.json $K/rigs/kaz_b_t.npz | tail -1
