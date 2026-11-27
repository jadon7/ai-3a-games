#!/bin/zsh
# 巨蟾：把本机渲好的训练图传到远程，训练 6 轮（从四足兽的权重起步），权重自动拉回 V2R/runs/toad/jointnet.pt。放后台跑。
set -e
cd /Users/jadon7/Documents/SynologyDrive/code/moba
zsh tools/remote.sh push-data toad
zsh tools/remote.sh train toad 6 runs/beast/jointnet.pt
echo ALL_DONE
