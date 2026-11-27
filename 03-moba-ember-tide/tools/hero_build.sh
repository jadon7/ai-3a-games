#!/bin/zsh
# 一个角色（英雄或小兵）的整套出品流程。用法: tools/hero_build.sh [目录=art/hero/lan] [rig]
#   目录里要有 build.json（模型、武器、站姿）和 motions.json（哪段视频的动作怎么裁）
#   加 rig：先重做“摆正、装武器”那一步（会重写动作管线的输入模型，之后管线要重新摆正、重训）
#   不加：整理动作 → 加进模型 → 压缩 → 放到 build.json 里 packed 指的位置
# 最后一步是给网页用的压缩：精简动作的关键帧、去掉重复和没用到的数据、压缩网格。
set -e
cd "$(dirname "$0")/.."
D=${1:-art/hero/lan}; CFG=$D/build.json
PY=/Users/jadon7/Documents/SynologyDrive/code/video2rig/.venv/bin/python
BL=/Applications/Blender.app/Contents/MacOS/Blender
if [ "$2" = "rig" ]; then $BL -b --factory-startup -P tools/blender/hero_build.py -- $CFG rig 2>&1 | grep -E "^(FACING|BLADE|WEAPON|JOINED|SAVED|Traceback|.*Error)"; fi
[ -f $D/motions.json ] && $PY tools/hero_motion.py $D/motions.json
$BL -b --factory-startup -P tools/blender/hero_build.py -- $CFG game 2>&1 | grep -E "^(POSED|ACTION|SAVED|Traceback|.*Error)"
RAW=$($PY -c "import json;print(json.load(open('$CFG'))['out'])"); OUT=$($PY -c "import json;print(json.load(open('$CFG'))['packed'])")
T=$(mktemp -d)
npx gltf-transform resample "$RAW" "$T/a.glb" >/dev/null 2>&1
npx gltf-transform dedup "$T/a.glb" "$T/b.glb" >/dev/null 2>&1
npx gltf-transform prune "$T/b.glb" "$T/c.glb" --keep-attributes true >/dev/null 2>&1
npx gltf-transform meshopt "$T/c.glb" "$OUT" --level medium >/dev/null 2>&1
ls -la "$RAW" "$OUT" | awk '{printf "%.2f MB  %s\n", $5/1e6, $9}'
