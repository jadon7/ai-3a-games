#!/bin/zsh
# 葛隆 B 的重新出品（照 art/style_b/lan/rebuild.sh）：装武器（rig）→ 套好的动作出游戏用的 GLB（run_case build）→ 放到 public/assets/hero/<名字>.glb/.json。
# 用法（worktree 根目录）: zsh art/style_b/gorran/rebuild.sh [名字=gorran_b]   名字写 gorran 就是覆盖正式的（再出手机档 m/gorran.glb）
# 只改了武器（gear.py、build.json 的 gear）也跑这个：动作不用重套（retarget 只看骨架），rig 一步会把新武器装进 gorran_b_rigged.glb，build 再把动作放上去。
set -e
cd "$(dirname "$0")/../../.."
N=${1:-gorran_b}; PY=/Users/jadon7/Documents/SynologyDrive/code/video2rig/.venv/bin/python
export TMPDIR=${TMPDIR:-/tmp}
zsh tools/hero_build.sh art/style_b/gorran rig | grep -E "JOINED|SAVED.*rigged|Error"
$PY tools/retarget/run_case.py art/style_b/gorran/retarget/case.json build | grep -E "RUNSPEED|SAVED|MB|Error"
cp art/style_b/gorran/retarget/build/gorran_b.glb public/assets/hero/$N.glb
node tools/style_b/strip_maps.mjs public/assets/hero/$N.glb      # B 的材质不用法线、粗糙度贴图，去掉省下载
node art/style_b/gorran/glow_map.mjs public/assets/hero/$N.glb 1.6      # 面罩缝和胸口炉栅自己发琥珀橙的光（身份表的发光处；1.0 看得出、不够像在烧，1.6）
$PY - "$N" <<'PY'
import json, sys
t = json.load(open("art/style_b/gorran/retarget/build/gorran_b.json")); json.dump(t, open(f"public/assets/hero/{sys.argv[1]}.json", "w"), ensure_ascii=False, indent=1)
PY
[ "$N" = "gorran" ] && node tools/lite_glb.mjs public/assets/hero/gorran.glb public/assets/hero/m/gorran.glb 1024 512
ls -la public/assets/hero/$N.glb public/assets/hero/$N.json
