#!/bin/zsh
# 野猪的第二批训练图和第二次训练。为什么要补：即梦出的 attack1、attack2 里上挑那一下前半身抬到了五十度上下（接近人立），
# 第一批 1600 组里抬前身的只有 12%、最多 45 度。这里按 rear 模式补 400 组（85% 的样本前身抬起 35~88 度），再从第一次的权重接着训。
# 映射（骨骼、跟踪点）没有动，第一批的标签照旧有效。日志: art/unit/boar/remote_train2.log
# 用法: zsh remote_train2.sh render   只渲染    zsh remote_train2.sh train [轮数=4]   只训练（从 runs/boar/jointnet_r1.pt 起步）
set -e
V=/Users/jadon7/Documents/SynologyDrive/code/video2rig
cd /Users/jadon7/Documents/SynologyDrive/code/moba
if [ "$1" = "render" ]; then
  echo "== render rear 400 $(date +%H:%M:%S)"; zsh tools/remote.sh render boar boar 400 7400 1600 4 rear
elif [ "$1" = "train" ]; then
  [ -f $V/runs/boar/jointnet_r1.pt ] || { echo "没有 runs/boar/jointnet_r1.pt（第一次训练的权重，先拷一份）"; exit 1; }
  echo "== train2 $(date +%H:%M:%S)"; zsh tools/remote.sh train boar ${2:-4} runs/boar/jointnet_r1.pt
fi
echo "== done $(date +%H:%M:%S)"
