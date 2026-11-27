#!/bin/zsh
# 托尔格 B（钟龟）：Tripo 绑好的骨架 → 修错绑 → 改成旧骨骼名 → 摆正出 V2R/assets/model/torg_b.blend → 读两边骨架 → 改腿的尾巴方向（dir 模式用）
# 用法（worktree 根目录）: zsh art/style_b/kaz/rig/make_rig.sh
set -e
cd "$(dirname "$0")/../../../.."
PY=/Users/jadon7/Documents/SynologyDrive/code/video2rig/.venv/bin/python; V=/Users/jadon7/Documents/SynologyDrive/code/video2rig; BL=/Applications/Blender.app/Contents/MacOS/Blender; K=art/style_b/torg
$PY tools/retarget/quad_fix_weights.py $K/tripo_rigged.glb $K/rig/fix_weights.json $K/rig/fixed.glb | grep -E "MOVE|SAVED"
$PY tools/retarget/quad_rename.py $K/rig/fixed.glb $K/rig/rename.json $V/assets/model/torg_b_rigged.glb $V/assets/model/turtle_skeleton.json
(cd $V && $BL -b --factory-startup -P scripts/blender/prep_rig.py -- assets/model/torg_b_rigged.glb torg_b 2>&1 | grep -E "^(FORWARD|SCALE|SELFTEST|SAVED|Traceback|.*Error)")
# 钟里加一根记号骨骼 tripo::Spine_1（旧钟龟技能的出手点 points.hand 认它；新骨架的钟整块绑在 Root 上，没有骨骼）：位置照旧的（钟口往下 0.12、偏左 0.11）
$BL -b --factory-startup $V/assets/model/torg_b.blend -P tools/retarget/quad_add_marker.py -- tripo::Spine_1 tripo::Root 0.11,0.02,0.734 0.11,0.02,0.80 2>&1 | grep -E "MARKER|Error"
$BL -b --factory-startup $V/assets/model/turtle.blend -P tools/retarget/dump_rig.py -- - $K/rigs/turtle.npz 2>&1 | grep DUMP
$BL -b --factory-startup $V/assets/model/torg_b.blend -P tools/retarget/dump_rig.py -- - $K/rigs/torg_b.npz 2>&1 | grep DUMP
$PY tools/retarget/quad_tails.py $K/rigs/turtle.npz $K/rig/tails.json $K/rigs/turtle_t.npz | tail -1
$PY tools/retarget/quad_tails.py $K/rigs/torg_b.npz $K/rig/tails.json $K/rigs/torg_b_t.npz | tail -1
