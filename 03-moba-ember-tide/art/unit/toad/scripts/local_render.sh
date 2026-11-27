#!/bin/zsh
# 巨蟾：训练图在本机渲（远程那台同时有 22 个 Blender 在抢，6 个进程 5 分半钟只出了 48 组），渲完传过去训练。
# 放后台跑：zsh art/unit/toad/scripts/local_render.sh > art/unit/toad/logs/local_render.log 2>&1
#   1. 共用的随机姿势 1600 组（本机 2 个进程，种子 7300、7301）
#   2. 巨蟾专用的成套姿势 400 组（蹲下、摊开贴地、腾空、前探），编号 1600 起（种子 9100、9101）
# 渲完以后：zsh art/unit/toad/scripts/push_train.sh（传到远程训练）
set -e
V=/Users/jadon7/Documents/SynologyDrive/code/video2rig; BL=/Applications/Blender.app/Contents/MacOS/Blender; L=/Users/jadon7/Documents/SynologyDrive/code/moba/art/unit/toad/logs
mkdir -p $L; cd $V; t0=$(date +%s)
for k in 0 1; do $BL -b --factory-startup assets/model/toad.blend -P scripts/blender/render_dataset.py -- toad data/toad/train 800 $((7300 + k)) $((k * 800)) > $L/render_std_$k.log 2>&1 & done; wait
echo "共用姿势渲完，用时 $(($(date +%s) - t0)) 秒，共 $(ls data/toad/train/front | wc -l) 张"
for k in 0 1; do $BL -b --factory-startup assets/model/toad.blend -P scripts/blender/render_dataset_toad.py -- toad data/toad/train 200 $((9100 + k)) $((1600 + k * 200)) > $L/render_toadx_$k.log 2>&1 & done; wait
echo "专用姿势渲完，用时 $(($(date +%s) - t0)) 秒，共 $(ls data/toad/train/front | wc -l) 张，标签文件 $(ls data/toad/train/labels_*.npz | wc -l) 个"
grep -l -E "Traceback|Error" $L/render_*.log || true
echo RENDER_DONE
