#!/bin/zsh
# 阎烬的成品流程（不带 rig）：动作整理 → 装进模型 → 压缩 → public/assets/fighters/yanjin/yanjin.glb
# 和 MOBA/tools/hero_build.sh 一样的几步，只是用 FG/tools/pipeline/yanjin 里的拷贝（贴图 4096、按动作控制手指）
set -e
D=/Users/jadon7/Documents/SynologyDrive/code/fighting-game/art/fighter/yanjin
T=/Users/jadon7/Documents/SynologyDrive/code/fighting-game/tools/pipeline/yanjin
PY=/Users/jadon7/Documents/SynologyDrive/code/video2rig/.venv/bin/python; BL=/Applications/Blender.app/Contents/MacOS/Blender
[ -f $D/motions.json ] && [ -z "$NOMOTION" ] && $PY $T/hero_motion.py $D/motions.json | cut -c1-260
[ -z "$NOMOTION" ] && $BL -b --factory-startup -P $D/fix_ground.py -- /Users/jadon7/Documents/SynologyDrive/code/video2rig/assets/model/yanjin_rigged.glb $D/motions 2>&1 | grep -E "^GROUND|Traceback|Error"
$BL -b --factory-startup -P $T/hero_build.py -- $D/build.json game 2>&1 | grep -E "^(POSED|ACTION|SKIP|SAVED|Traceback|.*Error)"
OUT=/Users/jadon7/Documents/SynologyDrive/code/fighting-game/public/assets/fighters/yanjin/yanjin.glb
mkdir -p $D/work/tmp; X=$D/work/tmp
cd /Users/jadon7/Documents/SynologyDrive/code/moba
npx gltf-transform resample $D/game.glb $X/a.glb >/dev/null 2>&1
npx gltf-transform dedup $X/a.glb $X/b.glb >/dev/null 2>&1
npx gltf-transform prune $X/b.glb $X/c.glb --keep-attributes true >/dev/null 2>&1
npx gltf-transform meshopt $X/c.glb $OUT --level medium >/dev/null 2>&1
ls -la $D/game.glb $OUT | awk '{printf "%.2f MB  %s\n", $5/1e6, $9}'
