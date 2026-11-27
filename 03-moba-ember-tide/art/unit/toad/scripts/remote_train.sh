#!/bin/zsh
# 巨蟾：远程渲染训练图 + 训练，一条龙（最初的打算。实际没用上：那台机器当时有四个任务同时渲染，显存撑满，6 个进程 5 分半钟只出了 48 组；改成了 local_render.sh 本机渲染 + push_train.sh 传过去训练）。
#   1. 同步代码、传模型
#   2. 共用的随机姿势 1600 组（6 个进程；那台机器别的任务也在渲）
#   3. 巨蟾专用的成套姿势 400 组（蹲下、摊开贴地、腾空、前探；scripts/blender/render_dataset_toad.py），编号 1600 起
#   4. 训练 6 轮，从四足兽的权重起步；remote.sh train 自己排队，完了把权重拉回 V2R/runs/toad/jointnet.pt
set -e
cd /Users/jadon7/Documents/SynologyDrive/code/moba
zsh tools/remote.sh sync
zsh tools/remote.sh push-model toad
zsh tools/remote.sh render toad toad 1600 7300 0 6
zsh tools/remote.sh run 't0=$(date +%s); for k in 0 1 2 3; do "$BL" -b --factory-startup assets/model/toad.blend -P scripts/blender/render_dataset_toad.py -- toad data/toad/train 100 $((9100 + k)) $((1600 + k * 100)) > data/toad/render_toadx_$k.log 2>&1 & done; wait; echo "巨蟾专用姿势渲染完，用时 $(($(date +%s) - t0)) 秒，目录里共 $(ls data/toad/train/front | wc -l) 张，标签文件 $(ls data/toad/train/labels_*.npz | wc -l) 个"; grep -l -E "Traceback|Error" data/toad/render_toadx_*.log || true'
zsh tools/remote.sh train toad 6 runs/beast/jointnet.pt
echo ALL_DONE
