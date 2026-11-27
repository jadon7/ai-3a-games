#!/bin/zsh
# 葛隆调站姿时的一轮：出站姿 → 模拟管线会把站姿读成什么样 → 按两者的中间值算盾的安装角度（写回 build.json）→ 重新装武器 → 再出站姿 → 渲染检查图。
# 模拟要用管线的工程文件（V2R/assets/model/gorran.blend，prep_rig.py 生成的）；只用到里面的骨架，武器怎么装不影响。
# 用法: zsh art/hero/gorran/iter.sh <检查图的名字> [角度列表] [每格边长]
# 只在放 RIG_READY 之前用（它会重写管线的输入模型）。
set -e
cd "$(dirname "$0")/../../.."
D=art/hero/gorran; BL=/Applications/Blender.app/Contents/MacOS/Blender; V2R=/Users/jadon7/Documents/SynologyDrive/code/video2rig
[ -f $D/RIG_READY ] && { echo "已经放了 RIG_READY，不能再重做 rig"; exit 1; }
$BL -b --factory-startup -P tools/blender/hero_build.py -- $D/build.json game 2>&1 | grep -E "^(POSED|Traceback|.*Error)" || true
$BL -b --factory-startup $V2R/assets/model/gorran.blend -P $D/sim_joints.py -- $V2R "$PWD/$D/stance.npz" "$PWD/$D/sim/joints.npy" 2>&1 | grep -E "^(Traceback|.*Error)" || true
$V2R/.venv/bin/python $D/sim_solve.py $D/sim/joints.npy $D/sim/solved_hid.npz LeftHandMiddle1,LeftHandMiddle4,LeftHandThumb4 | head -1
$BL -b --factory-startup -P $D/mount_solve.py -- $V2R/assets/model/gorran_rigged.glb $D/stance.npz $D/build.json "$PWD/$D/sim/solved_hid.npz" 2>&1 | grep -E "^(BLEND|FOREARM|SHIELD|SOLVED|Traceback|.*Error)"
$BL -b --factory-startup -P tools/blender/hero_build.py -- $D/build.json rig 2>&1 | grep -E "^(FACING|JOINED|Traceback|.*Error)"
$BL -b --factory-startup -P tools/blender/hero_build.py -- $D/build.json game 2>&1 | grep -E "^(POSED|Traceback|.*Error)"
$BL -b --factory-startup -P $D/check.py -- $D/game.glb $D/chk/${1:-s}.png ${3:-640} "${2:-0:8,35:18,90:8,180:8,-90:8,0:56}" idle_pose 0 2>&1 | grep -E "^(TRIS|BBOX|WEAPON|  |SHEET|Traceback|.*Error)"
