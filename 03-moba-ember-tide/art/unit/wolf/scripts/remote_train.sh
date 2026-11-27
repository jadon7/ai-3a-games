#!/bin/zsh
# 狼的训练（远程 4090，6 轮，从四足兽的权重起步）。训练图要先渲好（remote_render.sh）。日志: art/unit/wolf/remote_train.log
set -e
cd /Users/jadon7/Documents/SynologyDrive/code/moba
echo "== train $(date +%H:%M:%S)"; zsh tools/remote.sh train wolf 6 runs/beast/jointnet.pt
echo "== done $(date +%H:%M:%S)"
