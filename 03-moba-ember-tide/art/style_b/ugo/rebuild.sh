#!/bin/zsh
# 乌戈 B 的重新出品：摆正出站姿（rig；钓竿灯长在头上，不装武器）→ 套好的动作出游戏用的 GLB（run_case build）→ 放到 public/assets/hero/<名字>.glb/.json。
# 用法（worktree 根目录）: zsh art/style_b/ugo/rebuild.sh [名字=ugo_b]   名字写 ugo 就是覆盖正式的（再出手机档 m/ugo.glb）
# 模型那一头（只在换模型时做一次）：Blender -P art/style_b/ugo/fix_model.py -- tripo_rigged.glb tripo_rigged_fix.glb 0.3 0.6 0.70 0.86
set -e
cd "$(dirname "$0")/../../.."
N=${1:-ugo_b}; PY=/Users/jadon7/Documents/SynologyDrive/code/video2rig/.venv/bin/python; D=art/style_b/ugo; M=$D/retarget/motions
export TMPDIR=${TMPDIR:-$PWD/$D/tmp}; mkdir -p $TMPDIR
zsh tools/hero_build.sh $D rig | grep -E "JOINED|SAVED.*rigged|Error"
# run_case.py build 去 motions/ik/ 找报告算胯的缩放，报告实际写在 motions/ 下（HERO_B.md“已知的坑”）：拷一份过去，站姿的胯偏移才按真的 k（0.967）缩放
cp $M/retarget_report.json $M/ik/retarget_report.json
# 跑步用 ikv（脚只修高低、不锁水平），理由见 case.json 的 _note；ik 那份留在 ik/run_lock.npz 对照
[ -f $M/ik/run_lock.npz ] || cp $M/ik/run.npz $M/ik/run_lock.npz
cp $M/ikv/run.npz $M/ik/run.npz
$PY tools/retarget/run_case.py $D/retarget/case.json build | grep -E "SAVED|MB|Error"
cp $D/retarget/build/ugo_b.glb public/assets/hero/$N.glb
node tools/style_b/strip_maps.mjs public/assets/hero/$N.glb      # B 的材质不用法线、粗糙度贴图，去掉省下载
$PY - "$N" <<'PY'
import json, sys
c = json.load(open("art/style_b/ugo/retarget/case.json")); t = json.load(open("art/style_b/ugo/retarget/build/ugo_b.json"))
print("RUNSPEED 写死", t["runSpeed"], "->", c["run_speed"], "（run_case 按两只脚的平均算出来的不能用，见 case.json 的 _note）"); t["runSpeed"] = c["run_speed"]
json.dump(t, open(f"public/assets/hero/{sys.argv[1]}.json", "w"), ensure_ascii=False, indent=1)
PY
[ "$N" = "ugo" ] && node tools/lite_glb.mjs public/assets/hero/ugo.glb public/assets/hero/m/ugo.glb 1024 512
ls -la public/assets/hero/$N.glb public/assets/hero/$N.json
