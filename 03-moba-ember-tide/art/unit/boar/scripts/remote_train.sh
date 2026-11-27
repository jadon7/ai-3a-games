#!/bin/zsh
# 野猪的训练图渲染和训练（远程 4090）。一步失败就停。日志: art/unit/boar/remote_train.log
# 野猪不会人立，不加 rear 那一批；随机姿势里抬前身的比例在 boar_rigmap.json 的 sampling 里已经调低了。
set -e
cd /Users/jadon7/Documents/SynologyDrive/code/moba
echo "== sync $(date +%H:%M:%S)"; zsh tools/remote.sh sync
echo "== push-model $(date +%H:%M:%S)"; zsh tools/remote.sh push-model boar
echo "== render 1600 $(date +%H:%M:%S)"; zsh tools/remote.sh render boar boar 1600 7300 0 8
echo "== train $(date +%H:%M:%S)"; zsh tools/remote.sh train boar 6 runs/beast/jointnet.pt
echo "== done $(date +%H:%M:%S)"
