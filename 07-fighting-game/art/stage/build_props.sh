#!/bin/bash
# Tripo 原始模型 → 场景用的成品 GLB：底部居中、按需减面、贴图缩小转 webp、meshopt 压缩。
# 用法: bash art/stage/build_props.sh   （在 MOBA 目录里调 gltf-transform）
set -e
FG=/Users/jadon7/Documents/SynologyDrive/code/fighting-game
OUT=$FG/public/assets/stage/temple/props
T=$FG/art/stage/work
mkdir -p "$OUT" "$T"
cd /Users/jadon7/Documents/SynologyDrive/code/moba
# 名字 贴图尺寸 减面比例(1=不减)
while read -r n tex ratio err; do
  err=${err:-0.002}
  [ -z "$n" ] && continue
  src=${n%_lod}
  RAW=$FG/art/models_src/stage_${src}_raw.glb
  npx gltf-transform center "$RAW" "$T/${n}_a.glb" --pivot below >/dev/null 2>&1
  npx gltf-transform weld "$T/${n}_a.glb" "$T/${n}_b.glb" >/dev/null 2>&1
  if [ "$ratio" != "1" ]; then
    npx gltf-transform simplify "$T/${n}_b.glb" "$T/${n}_c.glb" --ratio "$ratio" --error "$err" >/dev/null 2>&1
  else cp "$T/${n}_b.glb" "$T/${n}_c.glb"; fi
  npx gltf-transform resize "$T/${n}_c.glb" "$T/${n}_d.glb" --width "$tex" --height "$tex" >/dev/null 2>&1
  npx gltf-transform webp "$T/${n}_d.glb" "$T/${n}_e.glb" --quality 88 >/dev/null 2>&1
  npx gltf-transform meshopt "$T/${n}_e.glb" "$OUT/${n}.glb" --level medium >/dev/null 2>&1
  echo "$n $(du -h "$OUT/${n}.glb" | cut -f1)"
done <<LIST
${ONLY:-lion 1024 0.55
stonelantern 1024 1
brazier 1024 1
pine 1024 0.25 0.02
deadtree 1024 0.35 0.02
pagoda 1024 0.5 0.01
pine_lod 512 0.02 0.4}
LIST
