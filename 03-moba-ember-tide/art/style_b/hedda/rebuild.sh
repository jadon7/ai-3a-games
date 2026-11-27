#!/bin/zsh
# 赫达 B 的重新出品（照 art/style_b/lan/rebuild.sh，多一步装炉子）：
#   add_forge.py 把脚本建的炉子装到 Tripo 的人背上（只蒙在 Spine2 上）→ hero_build rig 装火钳 → 套好的动作出游戏用的 GLB（run_case build）→ public/assets/hero/<名字>.glb/.json
# 用法（worktree 根目录）: zsh art/style_b/hedda/rebuild.sh [名字=hedda_b]   名字写 hedda 就是覆盖正式的（再出手机档 m/hedda.glb）
# 只改了炉子或火钳（gear.py、add_forge.py、build.json 的 gear）也跑这个：动作不用重套（retarget 只看骨架）。
set -e
cd "$(dirname "$0")/../../.."
N=${1:-hedda_b}; PY=/Users/jadon7/Documents/SynologyDrive/code/video2rig/.venv/bin/python; BL=/Applications/Blender.app/Contents/MacOS/Blender
export TMPDIR=${TMPDIR:-/tmp}
$BL -b --factory-startup -P art/style_b/hedda/add_forge.py -- art/style_b/hedda/tripo_rigged.glb art/style_b/hedda/tripo_rigged_forge.glb 2>&1 | grep -E "^(FRAME|PACK|FORGE|JOINED|SAVED)|Error"
zsh tools/hero_build.sh art/style_b/hedda rig | grep -E "JOINED|SAVED.*rigged|Error"
$PY tools/retarget/run_case.py art/style_b/hedda/retarget/case.json build | grep -E "RUNSPEED|SAVED|MB|Error"
cp art/style_b/hedda/retarget/build/hedda_b.glb public/assets/hero/$N.glb
node tools/style_b/strip_maps.mjs public/assets/hero/$N.glb      # B 的材质不用法线、粗糙度贴图，去掉省下载
$PY - "$N" <<'PY'
import json, sys
t = json.load(open("art/style_b/hedda/retarget/build/hedda_b.json")); json.dump(t, open(f"public/assets/hero/{sys.argv[1]}.json", "w"), ensure_ascii=False, indent=1)
PY
[ "$N" = "hedda" ] && node tools/lite_glb.mjs public/assets/hero/hedda.glb public/assets/hero/m/hedda.glb 1024 512
ls -la public/assets/hero/$N.glb public/assets/hero/$N.json
