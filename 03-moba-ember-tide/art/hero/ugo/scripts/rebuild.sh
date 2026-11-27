#!/bin/zsh
# 乌戈从解好的动作到成品的全过程（改了 motions.json 的裁剪、陷地修正的参数，用它重建）。
# 模型那一头（只在 RIG_READY 之前做过一次，不要再跑）：
#   Blender -P scripts/fix_model.py -- tripo_rigged.glb tripo_rigged_fix.glb      大头的权重归 Head、灯球单独一个 weapon_lamp 材质
#   zsh tools/hero_build.sh art/hero/ugo rig                                       摆正、出站姿（build.json）
#   V2R: Blender -P scripts/blender/prep_rig.py -- assets/model/ugo_rigged.glb ugo
# 动作：tools/solve_only.py（view_fix.py 试过给 run 校正侧面机位的大小，回投偏差反而变大，没用） 读出 V2R/out/anim/ugo_<动作>/motion.npz（命令见 logs/solve.log 上面那条）
# 用法: zsh art/hero/ugo/scripts/rebuild.sh
set -e
M=/Users/jadon7/Documents/SynologyDrive/code/moba; V=/Users/jadon7/Documents/SynologyDrive/code/video2rig; D=$M/art/hero/ugo
BL=/Applications/Blender.app/Contents/MacOS/Blender; PY=$V/.venv/bin/python
cd $M
$PY $D/scripts/fill_gap.py death 48 59      # 死亡跪下那一下的腿解坏了，前后插值
$PY tools/hero_motion.py $D/motions.json | tee $D/logs/motion.log
$BL -b --factory-startup -P $D/scripts/ground_fix.py -- $V/assets/model/ugo_rigged.glb $D/motions $D/motions_fix "${GROUND:-death:0.015,r:0.015}" 2>&1 | grep -E "^FIX|Error|Traceback"
$BL -b --factory-startup -P $D/scripts/mirror_legs.py -- $V/assets/model/ugo_rigged.glb $D/motions/run.npz $D/motions_fix/run.npz 2>&1 | grep -E "^MIRROR|Error|Traceback"      # 跑步的左腿用右腿镜像重建（侧面机位里左腿被挡，读出来一直没踩地）
TMPDIR=${TMPDIR:-/tmp} zsh tools/hero_build.sh art/hero/ugo 2>&1 | grep -E "ACTION|SAVED|MB|Error"
node tools/lite_glb.mjs public/assets/hero/ugo.glb public/assets/hero/m/ugo.glb 1024 512
