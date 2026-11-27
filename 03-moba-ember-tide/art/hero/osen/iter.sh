#!/bin/zsh
# 奥森调站姿时用的一键脚本：重跑 rig+game，再渲染全身六视图。用法: zsh art/hero/osen/iter.sh <标签> [rig|game]
# 注意：放了 RIG_READY 以后不许再带 rig 跑。
cd /Users/jadon7/Documents/SynologyDrive/code/moba
export TMPDIR="/private/tmp/claude-501/-Users-jadon7-Library-Application-Support-Claude-scratch-workspaces-dfe2b44a-8503-4a5e-af9b-63b1be0e053b-aae3434b-694f-413f-a991-1f79c427025e-scratch-2026-11-16-5dd0e1/ed3a0cc6-bb30-4685-a4af-e9fd8c583b9e/scratchpad"
mkdir -p "$TMPDIR" 2>/dev/null || export TMPDIR=/tmp   # 草稿目录可能已被清掉
BL=/Applications/Blender.app/Contents/MacOS/Blender
if [ "$2" = "rig" ]; then
  if [ -f art/hero/osen/RIG_READY ]; then echo "已经有 RIG_READY，不能再跑 rig"; exit 1; fi
  zsh tools/hero_build.sh art/hero/osen rig 2>&1 | tail -8
else
  zsh tools/hero_build.sh art/hero/osen 2>&1 | tail -6
fi
$BL -b --factory-startup -P art/hero/osen/check.py -- art/hero/osen/game.glb art/hero/osen/chk/$1.png 620 "0:8,35:18,90:8,180:8,-90:8,0:56" idle_pose 0 -0.03,-0.03,0.6 1.3 2>&1 | grep -E "^(BBOX|WEAPON|  inside|  BONE|SHEET|SLOT|Traceback|.*Error)"
