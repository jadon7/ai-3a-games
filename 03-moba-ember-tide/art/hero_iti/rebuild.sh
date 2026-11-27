#!/bin/zsh
# 伊缇的成品流程（第二段，不带 rig：RIG_READY 以后模型不许再变）。改了 motions.json 以后跑这个。
#   1. tools/hero_motion.py   按 motions.json 截取、循环、统一帧率 → art/hero_iti/motions/
#   2. fix_run.py             跑步：左腿用右腿镜像重建（MIRROR=1）、收步幅、脚重新贴地 → motions/run_s.npz（build.json 的 run 指这里）
#   3. hero_build.py game     装进模型 → art/hero_iti/check/game.glb，压缩 → check/packed.glb（同 tools/hero_build.sh 不带 rig 的后半段）
#   4. 拷到 public/assets/hero/<名字>.glb，去掉用不上的法线、粗糙度贴图（B 的材质不用），出手机档 m/<名字>.glb
# 重新读视频（solve.sh）以后先按这个顺序补，再跑这个：
#   fix_legs.py run q3 → resolve.py e q3 death q r w attack2 idle attack1 → calib.py → fix_hand.py calib.json 十段 → squash_air.py q3=0.38 r=0.5
# 用法（worktree 根目录）: zsh art/hero_iti/rebuild.sh [名字=iti]      环境变量 RUN_K 改跑步的步幅（默认 0.6）
set -e
cd /Users/jadon7/Documents/SynologyDrive/code/moba/.claude/worktrees/iti-model
N=${1:-iti}; PY=/Users/jadon7/Documents/SynologyDrive/code/video2rig/.venv/bin/python; BL=/Applications/Blender.app/Contents/MacOS/Blender
export TMPDIR=/Users/jadon7/Documents/SynologyDrive/code/moba/.claude/worktrees/iti-model/art/hero_iti/tmp; mkdir -p $TMPDIR
$PY tools/hero_motion.py art/hero_iti/motions.json | cut -c1-240
MIRROR=1 $BL -b --factory-startup -P art/hero_iti/fix_run.py -- art/hero_iti/iti_rigged.glb art/hero_iti/motions/run.npz art/hero_iti/motions/run_s.npz ${RUN_K:-0.6} 0.85 2>&1 | grep -E "^(RUN|SPEED)|Traceback|Error"
$BL -b --factory-startup -P tools/blender/hero_build.py -- art/hero_iti/build.json game 2>&1 | grep -E "^(POSED|ACTION|SAVED|Traceback|.*Error)"
T=$(mktemp -d)
npx gltf-transform resample art/hero_iti/check/game.glb "$T/a.glb" >/dev/null 2>&1
npx gltf-transform dedup "$T/a.glb" "$T/b.glb" >/dev/null 2>&1
npx gltf-transform prune "$T/b.glb" "$T/c.glb" --keep-attributes true >/dev/null 2>&1
npx gltf-transform meshopt "$T/c.glb" art/hero_iti/check/packed.glb --level medium >/dev/null 2>&1
cp art/hero_iti/check/packed.glb public/assets/hero/$N.glb
node tools/style_b/strip_maps.mjs public/assets/hero/$N.glb | tail -1
mkdir -p public/assets/hero/m && node tools/lite_glb.mjs public/assets/hero/$N.glb public/assets/hero/m/$N.glb 1024 512 2>&1 | tail -1
ls -la public/assets/hero/$N.glb public/assets/hero/m/$N.glb | awk '{printf "%.2f MB  %s\n", $5/1e6, $9}'
