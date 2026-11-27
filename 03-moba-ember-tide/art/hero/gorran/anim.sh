#!/bin/zsh
# 葛隆第二段调动作时的一轮：整理动作 → 装进模型并压缩 → 在预览页里抽帧 → 每段动作拼一张大图。
# 用法: zsh art/hero/gorran/anim.sh [动作名,动作名…=全部] [每段抽几帧=8]
set -e
cd "$(dirname "$0")/../../.."
export TMPDIR="/private/tmp/claude-501/-Users-jadon7-Library-Application-Support-Claude-scratch-workspaces-dfe2b44a-8503-4a5e-af9b-63b1be0e053b-aae3434b-694f-413f-a991-1f79c427025e-scratch-2026-11-16-5dd0e1/ed3a0cc6-bb30-4685-a4af-e9fd8c583b9e/scratchpad/tmp"
D=art/hero/gorran; A=${1:-idle,run,attack1,q,w,e,r,death}; N=${2:-8}
zsh tools/hero_build.sh $D 2>&1 | grep -E "循环|截取|原速|Traceback|Error|MB" | cut -c 1-260
VIEW_URL="http://localhost:5183/viewer.html?model=/assets/hero/gorran.glb&height=3.5" node tools/anim_sheet.mjs $D/sheets/a $A $N close,side 420 2>&1 | tail -1 | cut -c 1-200
for a in ${(s:,:)A}; do python3 $D/bigsheet.py $D/sheets/a $a $D/sheets/a_$a.jpg >/dev/null; done
echo "大图在 $D/sheets/a_<动作>.jpg"
