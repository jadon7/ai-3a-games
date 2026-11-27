#!/bin/zsh
# 只重新出品并在查看页里看一段动作。用法: zsh scripts/view_clip.sh <动作> <标签> [帧数=10] [裁剪=0.15,0.2,0.85,0.8]
# 截图放在 sheets/shots_<动作>_<标签>/（每次一个新目录，不用清旧图），拼好的图是 sheets/anim_<动作>_<标签>.jpg
set -e
a=$1; tag=$2; n=${3:-10}; box=${4:-0.15,0.2,0.85,0.8}
cd /Users/jadon7/Documents/SynologyDrive/code/moba && zsh tools/creature_build.sh art/unit/toad 2>&1 | grep -E "^$a |Error|Traceback" | cut -c 1-220
VIEW_URL="http://localhost:5183/viewer.html?model=/assets/unit/toad.glb&height=2.3" node tools/anim_sheet.mjs art/unit/toad/sheets/shots_${a}_$tag $a $n wide,wside 420 > /dev/null
python3 art/hero/torg_turtle/asheet2.py art/unit/toad/sheets/shots_${a}_$tag $a art/unit/toad/sheets/anim_${a}_$tag.jpg wide,wside $box 2600
