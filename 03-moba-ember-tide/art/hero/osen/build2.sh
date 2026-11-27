#!/bin/zsh
# 第二段的一键脚本：后处理（手腕校准、杖的指向、变速）→ 共用的 hero_build.sh（不带 rig）→ 动作预览抽帧。
# 用法: zsh art/hero/osen/build2.sh [抽帧标签=a] [每段几帧=8]
cd /Users/jadon7/Documents/SynologyDrive/code/moba
export TMPDIR="/private/tmp/claude-501/-Users-jadon7-Library-Application-Support-Claude-scratch-workspaces-dfe2b44a-8503-4a5e-af9b-63b1be0e053b-aae3434b-694f-413f-a991-1f79c427025e-scratch-2026-11-16-5dd0e1/ed3a0cc6-bb30-4685-a4af-e9fd8c583b9e/scratchpad"
mkdir -p "$TMPDIR" 2>/dev/null || export TMPDIR=/tmp
PY=/Users/jadon7/Documents/SynologyDrive/code/video2rig/.venv/bin/python; TAG=${1:-a}; N=${2:-8}; ACTS=idle,run,attack1,q,w,e,r,death
$PY art/hero/osen/compose.py art/hero/osen/compose.json 2>&1 | grep -v Warning || exit 1
zsh tools/hero_build.sh art/hero/osen 2>&1 | grep -vE "^(POSED)" | tail -22
VIEW_URL="http://localhost:5183/viewer.html?model=/assets/hero/osen.glb&height=3.1" node tools/anim_sheet.mjs art/hero/osen/sheets/$TAG $ACTS $N close,side 420 2>&1 | tail -1
python3 tools/asheet.py art/hero/osen/sheets/$TAG $ACTS art/hero/osen/sheets/anim.jpg close,side
for a in ${(s:,:)ACTS}; do $PY art/hero/osen/asheet_big.py art/hero/osen/sheets/$TAG $a art/hero/osen/sheets/${TAG}_big_$a.jpg close,side $(( N > 8 ? 6 : N / 2 )) > /dev/null; done
