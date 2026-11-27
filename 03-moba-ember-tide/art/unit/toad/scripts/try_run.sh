#!/bin/zsh
# 试一组步态参数：整理步态 → 只重做 run → 出品 → 查看页抽 10 帧拼图。用法: zsh scripts/try_run.sh <标签> <gait.py 的选项…>
set -e
D=/Users/jadon7/Documents/SynologyDrive/code/moba/art/unit/toad; PY=/Users/jadon7/Documents/SynologyDrive/code/video2rig/.venv/bin/python; A=/Users/jadon7/Documents/SynologyDrive/code/video2rig/out/anim
tag=$1; shift
cd $D && $PY scripts/gait.py $A/toad_run/motion_fix.npz retimed/run.npz from=18 to=118 mix=1 "$@" | sed -n 2,3p
cd /Users/jadon7/Documents/SynologyDrive/code/moba && zsh tools/creature_build.sh art/unit/toad 2>&1 | grep -E "^run|Error|Traceback" | cut -c 1-200
VIEW_URL="http://localhost:5183/viewer.html?model=/assets/unit/toad.glb&height=2.3" node tools/anim_sheet.mjs art/unit/toad/sheets/a run 10 wide,wside 420 > /dev/null
python3 art/hero/torg_turtle/asheet2.py art/unit/toad/sheets/a run art/unit/toad/sheets/anim_run_$tag.jpg wide,wside 0.15,0.2,0.85,0.8 2600
