#!/bin/zsh
# 四足 B 的出品（w-quad，卡兹、托尔格、奥森共用）：套好的动作 → creature_build.sh 出 GLB → 材质名改 _b、去掉用不上的贴图
# → 时间表（run_case build 按量出来的比例改 runSpeed，再按游戏里的身高换算）→ 放进 public/assets/hero/<名字>.glb/.json，名字就是英雄 id 时再出手机档 m/<id>.glb
# 用法（worktree 根目录）: zsh art/style_b/quad/rebuild.sh <英雄 id> <名字> <游戏里模型的身高 look.height> <case.json 里的 game_h>
#   art/style_b/<id>/ 里要有 build.json（creature_build 的，name 是 V2R 里摆正好的 <id>_b.blend）和 retarget/case.json
set -e
cd "$(dirname "$0")/../../.."
ID=$1; N=${2:-${ID}_b}; LH=$3; GH=$4; PY=/Users/jadon7/Documents/SynologyDrive/code/video2rig/.venv/bin/python; K=art/style_b/$ID
export TMPDIR=${TMPDIR:-/private/tmp/claude-501}
mkdir -p $K/check
zsh tools/creature_build.sh $K | grep -E "MESH|SAVED|MB|Error"
$PY tools/retarget/run_case.py $K/retarget/case.json build | grep -E "RUNSPEED|Error"
cp $K/check/packed.glb public/assets/hero/$N.glb
node tools/style_b/b_rename.mjs public/assets/hero/$N.glb
node tools/style_b/strip_maps.mjs public/assets/hero/$N.glb
# runSpeed：case.json 里 game_h、src_game_h 都写旧的身高（run_case.py build 在两个不一样时会把身高比多乘一遍），
# 游戏里新模型按 heroes/<id>.ts 的 look.height 放，所以出来的数再乘 look.height / game_h。points 等别的照抄源的时间表（骨骼名已经改成旧的）。
# 第 5 个参数可以直接给 runSpeed（游戏里量过以后定的数），给了就用它
$PY - "$K" "$N" "$LH" "$GH" "${5:-}" <<'PY'
import json, sys, glob
K, N, lh, gh, fixed = sys.argv[1:6]
src = glob.glob(f"{K}/retarget/build/*_b.json")[0]; t = json.load(open(src))
t["runSpeed"] = float(fixed) if fixed else round(t["runSpeed"] * float(lh) / float(gh), 2)
for c in [k for k in t if isinstance(t[k], dict) and "runSpeed" in t[k]]:
    t[c]["runSpeed"] = round(t[c]["runSpeed"] * float(lh) / float(gh), 2)
print("runSpeed（按游戏里的身高）", t["runSpeed"], {k: t[k]["runSpeed"] for k in t if isinstance(t[k], dict) and "runSpeed" in t[k]})
json.dump(t, open(f"public/assets/hero/{N}.json", "w"), ensure_ascii=False, indent=1)
PY
[ "$N" = "$ID" ] && node tools/lite_glb.mjs public/assets/hero/$ID.glb public/assets/hero/m/$ID.glb 1024 512
ls -la public/assets/hero/$N.glb public/assets/hero/$N.json
