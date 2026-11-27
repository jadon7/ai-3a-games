#!/bin/zsh
# 塞伦的训练图和训练都放远程：传模型 → 渲染 2400 组 → 从五个人形英雄的权重起步训 6 轮，权重拉回 V2R/runs/seren/jointnet.pt
cd /Users/jadon7/Documents/SynologyDrive/code/moba
zsh tools/remote.sh sync && zsh tools/remote.sh push-model seren
zsh tools/remote.sh render seren seren 2400 9100 0 8
zsh tools/remote.sh train seren 6 runs/heroes5/jointnet.pt
