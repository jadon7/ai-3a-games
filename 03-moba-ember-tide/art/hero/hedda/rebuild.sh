#!/bin/zsh
# 赫达的成品流程（第二段，不带 rig）。比 tools/hero_build.sh 多一步：把读出来的动作里火钳的拿法修正过来（fix_tongs.py）。
#   1. tools/hero_motion.py   按 motions.json 截取、循环、统一帧率 → art/hero/hedda/motions/
#   2. fix_tongs.py           按 fix.json 修火钳朝向、左手、贴地 → art/hero/hedda/motions_fix/（build.json 的 motions 指这里）
#   2b. fix_run.py            跑步：左腿镜像右腿、收步幅、贴地 → motions_fix/run_m.npz
#   3. hero_build.py 的 game 一步装进模型 → tone_forge.py 熔炉贴图压暗 → 压缩（同 tools/hero_build.sh）→ public/assets/hero/hedda.glb
#   4. 手机档 public/assets/hero/m/hedda.glb
# 改了 motions.json 或 fix.json 以后跑这个。重新读视频（solve.sh）的话，先按这个顺序补：fix_legs.py run death → resolve.py e death q r attack2 → calib.py → fix_hand.py calib.json 九段，再跑这个。绝不带 rig。
set -e
cd /Users/jadon7/Documents/SynologyDrive/code/moba
PY=/Users/jadon7/Documents/SynologyDrive/code/video2rig/.venv/bin/python; BL=/Applications/Blender.app/Contents/MacOS/Blender
export TMPDIR=/Users/jadon7/Documents/SynologyDrive/code/moba/art/hero/hedda/work
$PY tools/hero_motion.py art/hero/hedda/motions.json | cut -c1-200
$BL -b --factory-startup -P art/hero/hedda/fix_tongs.py -- art/hero/hedda/fix.json all 2>&1 | grep -E "^(STANCE|FIX|Traceback|  File|.*Error)" | cut -c1-200
# 跑步：左腿用右腿镜像重建（侧面机位里左腿被挡，读出来的左脚滑步）、步幅收到 0.6、脚重新贴地 → motions_fix/run_m.npz（build.json 的 run 指这里）
$BL -b --factory-startup -P art/hero/hedda/fix_run.py -- /Users/jadon7/Documents/SynologyDrive/code/video2rig/assets/model/hedda_rigged.glb art/hero/hedda/motions_fix/run.npz art/hero/hedda/motions_fix/run_m.npz ${RUN_K:-0.6} 0.8 2>&1 | grep -E "^(RUN|SPEED)|Traceback|.*Error"
# 下面四步就是 tools/hero_build.sh 不带 rig 的那几步，中间多插一步 tone_forge.py（熔炉的贴图压暗）
$BL -b --factory-startup -P tools/blender/hero_build.py -- art/hero/hedda/build.json game 2>&1 | grep -E "^(POSED|ACTION|SAVED|Traceback|.*Error)"
$PY art/hero/hedda/tone_forge.py art/hero/hedda/game.glb art/hero/hedda/game_toned.glb 0.6
T=$(mktemp -d)
npx gltf-transform resample art/hero/hedda/game_toned.glb "$T/a.glb" >/dev/null 2>&1
npx gltf-transform dedup "$T/a.glb" "$T/b.glb" >/dev/null 2>&1
npx gltf-transform prune "$T/b.glb" "$T/c.glb" --keep-attributes true >/dev/null 2>&1
npx gltf-transform meshopt "$T/c.glb" public/assets/hero/hedda.glb --level medium >/dev/null 2>&1
ls -la art/hero/hedda/game_toned.glb public/assets/hero/hedda.glb | awk '{printf "%.2f MB  %s\n", $5/1e6, $9}'
node tools/lite_glb.mjs public/assets/hero/hedda.glb public/assets/hero/m/hedda.glb 1024 512
