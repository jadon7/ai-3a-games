#!/bin/zsh
# 野怪 B（两足：骨面山魈、岩石巨魔）的重新出品：装好的模型（rig）→ 套好的动作出游戏用的 GLB（run_case build，走 hero_build.sh）→ 放到 public/assets/unit/<名字>.glb，
# 去掉 B 用不上的法线、粗糙度贴图，出手机档 m/<名字>.glb（颜色贴图 1024），时间表 <名字>.json 照抄旧的（src_timing.json）、只改 runSpeed（按量出来的比例）。
# 用法（worktree 根目录）: zsh art/style_b/mandrill/rebuild.sh mandrill|troll [跳过rig]
set -e
cd "$(dirname "$0")/../../.."
N=$1; PY=/Users/jadon7/Documents/SynologyDrive/code/video2rig/.venv/bin/python
export TMPDIR=${TMPDIR:-/tmp}
[ -z "$2" ] && /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/blender/hero_build.py -- art/style_b/$N/build.json rig 2>&1 | grep -E "^(JOINED|SAVED|Traceback|.*Error)"
$PY tools/retarget/run_case.py art/style_b/$N/retarget/case.json build | grep -E "RUNSPEED|SAVED|MB|Error"
cp art/style_b/$N/retarget/build/${N}_b.glb public/assets/unit/$N.glb
node tools/style_b/strip_maps.mjs public/assets/unit/$N.glb
node tools/lite_glb.mjs public/assets/unit/$N.glb public/assets/unit/m/$N.glb 1024 512
$PY - "$N" <<'PY'
import json, re, sys
n = sys.argv[1]; rs = json.load(open(f"art/style_b/{n}/retarget/build/{n}_b.json"))["runSpeed"]; src = open(f"art/style_b/{n}/src_timing.json").read()
open(f"public/assets/unit/{n}.json", "w").write(re.sub(r'"runSpeed": [0-9.]+', f'"runSpeed": {rs}', src, count=1))      # 原样抄旧的时间表（保留排版，合并时 diff 只有一行），只改 runSpeed
print(n, "runSpeed", rs)
PY
ls -la public/assets/unit/$N.glb public/assets/unit/m/$N.glb public/assets/unit/$N.json
