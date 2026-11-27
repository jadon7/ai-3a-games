#!/bin/zsh
# 岚 B 的重新出品：装武器（rig）→ 套好的动作出游戏用的 GLB（run_case build）→ 放到 public/assets/hero/<名字>.glb/.json。
# 用法（worktree 根目录）: zsh art/style_b/lan/rebuild.sh [名字=lan_b]   名字写 lan 就是覆盖正式的（再出手机档 m/lan.glb）
set -e
cd "$(dirname "$0")/../../.."
N=${1:-lan_b}; PY=/Users/jadon7/Documents/SynologyDrive/code/video2rig/.venv/bin/python
export TMPDIR=${TMPDIR:-/tmp}
zsh tools/hero_build.sh art/style_b/lan rig | grep -E "JOINED|SAVED.*rigged|Error"
$PY tools/retarget/run_case.py art/style_b/lan/retarget/case.json build | grep -E "RUNSPEED|SAVED|MB|Error"
cp art/style_b/lan/retarget/build/lan_b.glb public/assets/hero/$N.glb
node tools/style_b/strip_maps.mjs public/assets/hero/$N.glb      # B 的材质不用法线、粗糙度贴图，去掉省下载
$PY - "$N" <<'PY'
import json, sys
t = json.load(open("art/style_b/lan/retarget/build/lan_b.json")); json.dump(t, open(f"public/assets/hero/{sys.argv[1]}.json", "w"), ensure_ascii=False, indent=1)
PY
[ "$N" = "lan" ] && node tools/lite_glb.mjs public/assets/hero/lan.glb public/assets/hero/m/lan.glb 1024 512
ls -la public/assets/hero/$N.glb public/assets/hero/$N.json
