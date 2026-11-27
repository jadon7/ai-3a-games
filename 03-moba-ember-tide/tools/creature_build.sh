#!/bin/zsh
# 非人形角色（四足等）的出品流程。用法: zsh tools/creature_build.sh <目录，如 art/hero/torg_turtle>
#   目录里要有 build.json（见 tools/blender/creature_build.py 的开头）和 motions.json（哪段视频的动作怎么裁，格式和人形的一样）
#   整理动作 → 加进管线摆正好的模型 → 导出 → 压缩 → 放到 build.json 里 packed 指的位置
# 还没有 motions.json 也能跑：出来的模型只有一段不动的 idle_pose，先看模型用。
set -e
cd "$(dirname "$0")/.."
D=$1; CFG=$D/build.json
V=/Users/jadon7/Documents/SynologyDrive/code/video2rig
PY=$V/.venv/bin/python
BL=/Applications/Blender.app/Contents/MacOS/Blender
NAME=$($PY -c "import json;print(json.load(open('$CFG'))['name'])")
[ -f $D/motions.json ] && $PY tools/hero_motion.py $D/motions.json
$BL -b --factory-startup $V/assets/model/$NAME.blend -P tools/blender/creature_build.py -- $CFG 2>&1 | grep -E "^(MESH|ACTION|SKIP|SAVED|Traceback|.*Error)"
RAW=$($PY -c "import json;print(json.load(open('$CFG'))['out'])"); OUT=$($PY -c "import json;print(json.load(open('$CFG'))['packed'])")
T=$(mktemp -d)
npx gltf-transform resample "$RAW" "$T/a.glb" >/dev/null 2>&1
npx gltf-transform dedup "$T/a.glb" "$T/b.glb" >/dev/null 2>&1
npx gltf-transform prune "$T/b.glb" "$T/c.glb" --keep-attributes true >/dev/null 2>&1
npx gltf-transform meshopt "$T/c.glb" "$OUT" --level medium >/dev/null 2>&1
ls -la "$RAW" "$OUT" | awk '{printf "%.2f MB  %s\n", $5/1e6, $9}'
