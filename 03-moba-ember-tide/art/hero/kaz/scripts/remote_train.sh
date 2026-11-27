#!/bin/zsh
# 卡兹的训练图渲染和训练（远程 4090）。用法: zsh art/hero/kaz/scripts/remote_train.sh
# 1600 组随机姿势（8 个 Blender 进程）→ 从四足兽的权重起步训 6 轮，权重自动拉回 V2R/runs/kaz/jointnet.pt
set -e
cd /Users/jadon7/Documents/SynologyDrive/code/moba
echo "== 开始 $(date +%H:%M:%S)"
zsh tools/remote.sh sync
zsh tools/remote.sh push-model kaz
zsh tools/remote.sh render kaz kaz 1600 9100 0 8
echo "== 渲染完 $(date +%H:%M:%S)"
zsh tools/remote.sh train kaz 6 runs/beast/jointnet.pt
echo "== 训练完 $(date +%H:%M:%S)"
