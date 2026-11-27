#!/bin/bash
# helper: ./run.sh build [variant=1|2] [only=...] | render <views...> | mask
# Set BLENDER_EXE to your Blender executable before running.
B="${BLENDER_EXE:?set BLENDER_EXE to your Blender executable}"
HERE="$(cd "$(dirname "$0")" && pwd)"
V=${V:-2}
if [ "$V" = "1" ]; then OUT="$HERE/../out/cockpit_v1.glb"; PRE=cockpit; else OUT="$HERE/../out/cockpit.glb"; PRE=cockpit2; fi
PV="$HERE/preview"
cmd=$1; shift
case $cmd in
  build) "$B" -b --factory-startup -P "$HERE/ck_build.py" -- "$OUT" variant=$V "$@" 2>&1 | grep -E "BUILD|WARNING: v|WARNING: m|Error|Traceback|  File |line [0-9]+" ;;
  render) "$B" -b --factory-startup -P "$HERE/ck_render.py" -- "$OUT" "$PV" prefix=$PRE "$@" 2>&1 | grep -E "RENDER|COVER|Error|Traceback|  File |line [0-9]+" ;;
  mask) "$B" -b --factory-startup -P "$HERE/ck_render.py" -- "$OUT" "$PV" prefix=$PRE mask 2>&1 | grep -E "COVER|Error|Traceback|  File |line [0-9]+" ;;
esac