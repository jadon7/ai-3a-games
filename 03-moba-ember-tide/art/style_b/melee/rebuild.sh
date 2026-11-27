#!/bin/zsh
# 小兵 B 的重新出品（近战、远程共用）：装武器（rig）→ 套好的动作出游戏用的 GLB（run_case build）→ 放到 public/assets/unit/<名字>.glb，
# 去掉 B 用不上的法线、粗糙度贴图，出手机档 m/<名字>.glb，把量出来的走路速度写回 units.json（只改这个小兵的 walkSpeed）。
# 用法（worktree 根目录）: zsh art/style_b/melee/rebuild.sh melee|ranged [跳过rig]
set -e
cd "$(dirname "$0")/../../.."
N=$1; PY=/Users/jadon7/Documents/SynologyDrive/code/video2rig/.venv/bin/python
export TMPDIR=${TMPDIR:-/tmp}
[ -z "$2" ] && zsh tools/hero_build.sh art/style_b/$N rig | grep -E "JOINED|SAVED.*rigged|Error"
$PY tools/retarget/run_case.py art/style_b/$N/retarget/case.json build | grep -E "RUNSPEED|SAVED|MB|Error"
cp art/style_b/$N/retarget/build/${N}_b.glb public/assets/unit/$N.glb
node tools/style_b/strip_maps.mjs public/assets/unit/$N.glb      # B 的材质不用法线、粗糙度贴图，去掉省下载
node tools/lite_glb.mjs public/assets/unit/$N.glb public/assets/unit/m/$N.glb 1024 512
$PY - "$N" <<'PY'
import json, sys
n = sys.argv[1]; t = json.load(open(f"art/style_b/{n}/retarget/build/{n}_b.json")); src = json.load(open(f"art/style_b/{n}/src_timing.json"))
p = "public/assets/unit/units.json"; u = json.load(open(p))
u[n]["walkSpeed"] = t["walk"]["runSpeed"]      # run_case 按“新模型的脚 / 旧模型的脚”的比例改好的走路速度
json.dump(u, open(p, "w"), ensure_ascii=False, indent=1)
print("units.json", n, u[n], "（源", src["walk"]["runSpeed"], "）")
PY
ls -la public/assets/unit/$N.glb public/assets/unit/m/$N.glb
