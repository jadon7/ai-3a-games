#!/bin/zsh
# 凌霜的出品（照 MOBA/tools/hero_build.sh，用自己目录里拷出来改过的 hero_build.py / hero_motion.py）。
# 用法: zsh build.sh [rig]   —— 加 rig 先重做摆正、装刀（会重写管线输入模型；RIG_READY 之后绝不再带 rig）
#   不带 rig：整理动作（motions.json）→ 修正（fix.sh，如果有）→ 装进模型 → 压缩 → public/assets/fighters/lingshuang/lingshuang.glb
set -e
D=/Users/jadon7/Documents/SynologyDrive/code/fighting-game/art/fighter/lingshuang; CFG=$D/build.json
PY=/Users/jadon7/Documents/SynologyDrive/code/video2rig/.venv/bin/python
BL=/Applications/Blender.app/Contents/MacOS/Blender
export TMPDIR=$D/work
if [ "$1" = "rig" ]; then $BL -b --factory-startup -P $D/pipeline/hero_build.py -- $CFG rig 2>&1 | grep -E "^(FACING|BLADE|WEAPON|SWORD|JOINED|SAVED|Traceback|.*Error)"; fi
[ -f $D/motions.json ] && [ "$1" != "rig" ] && $PY $D/pipeline/hero_motion.py $D/motions.json | cut -c1-220
[ -f $D/fix.sh ] && [ "$1" != "rig" ] && zsh $D/fix.sh
$BL -b --factory-startup -P $D/pipeline/hero_build.py -- $CFG game 2>&1 | grep -E "^(POSED|PONY|ACTION|SPLIT|SAVED|Traceback|.*Error)"
RAW=$D/game.glb; OUT=/Users/jadon7/Documents/SynologyDrive/code/fighting-game/public/assets/fighters/lingshuang/lingshuang.glb
T=$(mktemp -d)
cd /Users/jadon7/Documents/SynologyDrive/code/moba
npx gltf-transform resample "$RAW" "$T/a.glb" >/dev/null 2>&1
npx gltf-transform dedup "$T/a.glb" "$T/b.glb" >/dev/null 2>&1
npx gltf-transform prune "$T/b.glb" "$T/c.glb" --keep-attributes true >/dev/null 2>&1
npx gltf-transform meshopt "$T/c.glb" "$OUT" --level medium >/dev/null 2>&1
ls -la "$RAW" "$OUT" | awk '{printf "%.2f MB  %s\n", $5/1e6, $9}'
