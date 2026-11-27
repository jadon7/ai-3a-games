#!/bin/zsh
# 换画风 B（w-beast）：一只四足野怪的出品。套好的动作（art/style_b/<怪>/retarget/motions/ik/）→ 游戏用的 GLB 和时间表 → public/assets/unit/。
#   1. run_case.py build：照旧怪的 build.json 写一份新的（模型换成 V2R/assets/model/<tgt_blend_name>.blend，动作换成套好的）
#   2. creature_build.sh 出 GLB（共用脚本，没改）
#   3. tools/style_b/b_rename.mjs --as mob 把材质 hero 改名 mob_b（游戏按 _b 认 B 的处理；原来是本目录的 mob_b.mjs，b-polish 合进了 b_rename.mjs，结果逐字节一样），strip_maps.mjs 去掉 B 用不上的法线、粗糙度贴图
#   4. 时间表：照抄旧怪的（开工时拷的 src_timing.json），runSpeed 乘“新/旧”该填 runSpeed 之比，再盖上 timing_patch.json（身高、圈、血条、骨骼名）
#      为什么不用 run_case.py 写的那份：它在比例上又乘了一遍 game_h/src_game_h，而 measure.json 里两边的米已经各按自己的 game_h 换算过了，
#      两边身高不一样时 runSpeed 会多乘一次（狼 1.55/1.45：6.53 被算成 6.98）。人形岚两边都是 3.3，碰不到
#   5. 名字就是怪名时（正式出品）再出手机档 m/<怪>.glb（颜色 1024、别的 512，和 tools/pack_assets.sh 一样）
# 用法（worktree 根目录）: zsh art/style_b/beasts/rebuild.sh <怪> [出品名=<怪>]     游戏按怪名载入模型（没有 glb= 那样的换模型参数），所以直接覆盖正式的；旧的在 git 里（标签 v9-painted）
set -e
cd "$(dirname "$0")/../../.."
M=$1; N=${2:-$M}; D=art/style_b/$M/retarget; PY=/Users/jadon7/Documents/SynologyDrive/code/video2rig/.venv/bin/python
export TMPDIR=${TMPDIR:-/private/tmp/claude-501/w-beast-tmp}; mkdir -p $TMPDIR
$PY tools/retarget/run_case.py $D/case.json build | grep -E "Error|Traceback" || true
$PY - "$M" "$N" <<'PY'
import json, sys, numpy as np
M, N = sys.argv[1:3]; D = f"art/style_b/{M}/retarget"; case = json.load(open(f"{D}/case.json")); V = "/Users/jadon7/Documents/SynologyDrive/code/video2rig/assets/model"
b = json.load(open(f"{D}/build/build.json")); b["skeleton"] = f"{V}/{case['tgt_blend_name']}_skeleton.json"; b["tex"] = case.get("tex", b.get("tex", 1024)); json.dump(b, open(f"{D}/build/build.json", "w"), ensure_ascii=False, indent=1)
t = json.load(open(case["src_timing"] if not case["src_timing"].startswith("/") else case["src_timing"]))
mj = json.load(open(f"{D}/measure.json"))
if "run" in mj:
    f = lambda lab: float(np.mean([v["该填runSpeed"] for k, v in mj["run"][lab].items() if k.startswith("脚:") and v.get("该填runSpeed")]))
    r = f("ik") / f("src"); print("RUNSPEED", t["runSpeed"], "->", round(t["runSpeed"] * r, 2), "（新/旧该填之比", round(r, 3), "）"); t["runSpeed"] = round(t["runSpeed"] * r, 2)
try: patch = json.load(open(f"art/style_b/{M}/timing_patch.json"))
except FileNotFoundError: patch = {}
for k, v in patch.items():
    if not k.startswith("_"): t[k] = v
txt = json.dumps(t, ensure_ascii=False, indent=1); open(f"public/assets/unit/{N}.json", "w").write(txt + "\n"); print(txt)
PY
zsh tools/creature_build.sh $D/build | grep -E "MESH|MB|Error"
cp $D/build/$($PY -c "import json;print(json.load(open('$D/case.json'))['name'])").glb public/assets/unit/$N.glb
node tools/style_b/b_rename.mjs --as mob public/assets/unit/$N.glb
node tools/style_b/strip_maps.mjs public/assets/unit/$N.glb
[ "$N" = "$M" ] && node tools/lite_glb.mjs public/assets/unit/$N.glb public/assets/unit/m/$N.glb 1024 512
ls -la public/assets/unit/$N.glb public/assets/unit/$N.json
