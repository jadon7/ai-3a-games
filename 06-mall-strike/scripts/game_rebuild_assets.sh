#!/bin/bash
# After a bake: denoise atlases into game/assets/lm, export mall.glb + materials.json.
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
B=/Applications/Blender.app/Contents/MacOS/Blender
mkdir -p bake_raw_lm
for n in floor arch store0 store1 propbox outside; do
  cp "game/assets/lm/$n.exr" "bake_raw_lm/$n.exr"
  $B -b --factory-startup -P scripts/game_denoise.py -- "bake_raw_lm/$n.exr" "game/assets/lm/$n.exr" 4 0.18 2>&1 | grep DENOISED | cut -c1-80
done
$B -b blend/game_baked.blend -P scripts/game_export.py > logs/game_export.log 2>&1
grep "LMV\|GLB\|DONE" logs/game_export.log
