#!/bin/zsh
# 只改站姿（不动武器）时的一轮：出站姿 → 模拟管线会把它读成什么样 → 比较两者的差别。不重做 rig。
# 用法: zsh art/hero/gorran/sim.sh [检查图名字]
set -e
cd "$(dirname "$0")/../../.."
D=art/hero/gorran; BL=/Applications/Blender.app/Contents/MacOS/Blender; V2R=/Users/jadon7/Documents/SynologyDrive/code/video2rig
$BL -b --factory-startup -P tools/blender/hero_build.py -- $D/build.json game 2>&1 | grep -E "^(POSED|Traceback|.*Error)"
$BL -b --factory-startup $V2R/assets/model/gorran.blend -P $D/sim_joints.py -- $V2R "$PWD/$D/stance.npz" "$PWD/$D/sim/joints.npy" 2>&1 | grep -E "^(Traceback|.*Error)" || true
$V2R/.venv/bin/python $D/sim_solve.py $D/sim/joints.npy $D/sim/solved_hid.npz LeftHandMiddle1,LeftHandMiddle4,LeftHandThumb4
$BL -b --factory-startup $V2R/assets/model/gorran.blend -P $D/sim_joints.py -- $V2R "$PWD/$D/stance.npz" "$PWD/$D/sim/joints.npy" "$PWD/$D/sim/solved_hid.npz" 2>&1 | grep -E "^(DIFF|Traceback|.*Error)"
if [ -n "$1" ]; then $BL -b --factory-startup -P $D/check.py -- $D/game.glb $D/chk/$1.png 560 "0:8,-90:8,0:56" idle_pose 0 2>&1 | grep -E "^(WEAPON|  inside|SHEET|Traceback|.*Error)"; fi
