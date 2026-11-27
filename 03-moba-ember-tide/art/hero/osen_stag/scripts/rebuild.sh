#!/bin/zsh
# 鹿从“视频已经读过”到出品的全部步骤（改了裁剪或者想重解时跑这个）。用法: zsh art/hero/osen_stag/scripts/rebuild.sh [solve]
#   加 solve：先用 solve_stag.py 重新求解（读数用 out/anim/stag_*/detections.npz 里现成的）并去毛刺；不加就只重新裁剪、出品。
set -e
V=/Users/jadon7/Documents/SynologyDrive/code/video2rig; M=/Users/jadon7/Documents/SynologyDrive/code/moba; S=$M/art/hero/osen_stag/scripts; PY=$V/.venv/bin/python
if [ "$1" = "solve" ]; then
  cd $V; $PY $S/solve_stag.py idle run run2 attack1 q w e r death 2>&1 | grep -v Warning
  for a in idle run2 attack1 q w e r death; do $PY $S/deglitch.py out/anim/stag_$a/motion_fix.npz out/anim/stag_$a/motion_dg.npz 5 | head -1; done      # 奔跑（run）不去毛刺：它的腿本来就快，会被误伤，motions.json 里直接用 motion_fix.npz
fi
cd $M; zsh tools/creature_build.sh art/hero/osen_stag
$PY $S/events.py art/hero/osen_stag/motions                                # 各段的出手时刻，对着改 public/assets/hero/stag.json
