#!/bin/zsh
# 鹿的训练图渲染和训练（远程 4090）。一步失败就停。日志: art/hero/osen_stag/remote_train.log
set -e
cd /Users/jadon7/Documents/SynologyDrive/code/moba
echo "== sync $(date +%H:%M:%S)"; zsh tools/remote.sh sync
echo "== push-model $(date +%H:%M:%S)"; zsh tools/remote.sh push-model stag
echo "== render 1600 $(date +%H:%M:%S)"; zsh tools/remote.sh render stag stag 1600 7100 0 8
echo "== render rear 400 $(date +%H:%M:%S)"; zsh tools/remote.sh render stag stag 400 7200 1600 4 rear
echo "== train $(date +%H:%M:%S)"; zsh tools/remote.sh train stag 6 runs/beast/jointnet.pt
echo "== done $(date +%H:%M:%S)"
