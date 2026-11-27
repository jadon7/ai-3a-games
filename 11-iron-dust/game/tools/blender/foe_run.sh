#!/usr/bin/env bash
# foe_run.sh -- helper for the enemy-frame pipeline (Git Bash).
# Set BLENDER_EXE to your Blender executable before running.
#   ./foe_run.sh build [ids...]         build frames
#   ./foe_run.sh equip                  build out/equip_e.glb
#   ./foe_run.sh render <foe_render.py args...>   (output paths relative to tools/blender/preview)
#   ./foe_run.sh install [names...]     copy built .glb files from out/ into models/
B="${BLENDER_EXE:?set BLENDER_EXE to your Blender executable}"
D="$(cd "$(dirname "$0")" && pwd)/.."
F='BUILD|NOTE|WARNING|RENDERED|Error|Traceback|  File |exhaust|^   '
cmd="$1"; shift
case "$cmd" in
  build)  "$B" -b --factory-startup -P "$D/build_foes.py" -- "$@" 2>&1 | grep -E "$F" ;;
  equip)  "$B" -b --factory-startup -P "$D/build_equip_e.py" -- "$@" 2>&1 | grep -E "$F" ;;
  render) "$B" -b --factory-startup -P "$D/foe_render.py" -- "$@" 2>&1 | grep -E "$F" ;;
  install)
    for n in "$@"; do cp "$D/out/$n.glb" "$D/../../models/$n.glb" && echo "installed $n.glb"; done ;;
esac