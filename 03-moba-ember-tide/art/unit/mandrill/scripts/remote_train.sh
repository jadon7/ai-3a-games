#!/bin/zsh
# 山魈的远程渲染 + 训练，一条龙。用法: zsh art/unit/mandrill/scripts/remote_train.sh [张数=1600] [种子=7400] [轮数=6]
# 日志在 art/unit/mandrill/logs/remote_*.log。放后台跑。
set -e
cd /Users/jadon7/Documents/SynologyDrive/code/moba
N=${1:-1600}; SEED=${2:-7400}; EP=${3:-6}; L=art/unit/mandrill/logs
zsh tools/remote.sh sync 2>&1 | tee $L/remote_sync.log
zsh tools/remote.sh push-model mandrill 2>&1 | tee -a $L/remote_sync.log
zsh tools/remote.sh render mandrill mandrill $N $SEED 0 8 2>&1 | tee $L/remote_render.log
zsh tools/remote.sh train mandrill $EP runs/minion/jointnet.pt 2>&1 | tee $L/remote_train.log
echo "REMOTE_ALL_DONE"
