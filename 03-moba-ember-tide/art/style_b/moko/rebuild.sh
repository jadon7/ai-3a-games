#!/bin/zsh
# 摩珂 B 的重新出品：装杖（rig）→ 套好的动作出游戏用的 GLB（run_case build）→ 放到 public/assets/hero/<名字>.glb/.json。
# 用法（worktree 根目录）: zsh art/style_b/moko/rebuild.sh [名字=moko_b]   名字写 moko 就是覆盖正式的（再出手机档 m/moko.glb）
set -e
cd "$(dirname "$0")/../../.."
N=${1:-moko_b}; PY=/Users/jadon7/Documents/SynologyDrive/code/video2rig/.venv/bin/python; D=art/style_b/moko
export TMPDIR=${TMPDIR:-$PWD/$D/tmp}; mkdir -p $TMPDIR
zsh tools/hero_build.sh $D rig | grep -E "JOINED|SAVED.*rigged|Error"
# run_case.py build 去 motions/ik/ 找报告算胯的缩放，报告实际写在 motions/ 下（HERO_B.md“已知的坑”）：拷一份过去，站姿的胯偏移才按真的 k 缩放
cp $D/retarget/motions/retarget_report.json $D/retarget/motions/ik/retarget_report.json
$PY tools/retarget/run_case.py $D/retarget/case.json build | grep -E "RUNSPEED|SAVED|MB|Error"
cp $D/retarget/build/moko_b.glb public/assets/hero/$N.glb
node tools/style_b/strip_maps.mjs public/assets/hero/$N.glb      # B 的材质不用法线、粗糙度贴图，去掉省下载
$PY - "$N" <<'PY'
import json, sys
t = json.load(open("art/style_b/moko/retarget/build/moko_b.json")); json.dump(t, open(f"public/assets/hero/{sys.argv[1]}.json", "w"), ensure_ascii=False, indent=1)
PY
[ "$N" = "moko" ] && node tools/lite_glb.mjs public/assets/hero/moko.glb public/assets/hero/m/moko.glb 1024 512
ls -la public/assets/hero/$N.glb public/assets/hero/$N.json
