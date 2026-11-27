#!/bin/zsh
# 远程 4090：传模型 → 渲染 2400 组训练图（8 进程）→ 从 heroes5 的权重起步训 6 轮，权重自动拉回 V2R/runs/yanjin/jointnet.pt
R=/Users/jadon7/Documents/SynologyDrive/code/moba/tools/remote.sh
zsh $R push-model yanjin && zsh $R render yanjin yanjin 2400 5100 0 8 && zsh $R train yanjin 6 runs/heroes5/jointnet.pt
