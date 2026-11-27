#!/bin/zsh
# 卡兹第二轮训练：第一轮 1600 组 6 轮，val(退化后) 停在 11.4 像素（鹿、龟 7 像素左右），补渲 1600 组（种子 9300，编号从 1600 起），
# 从第一轮的权重接着训 4 轮。第一轮的权重留在 V2R/runs/kaz/jointnet_r1_1600x6.pt。
set -e
cd /Users/jadon7/Documents/SynologyDrive/code/moba
echo "== 开始 $(date +%H:%M:%S)"
zsh tools/remote.sh render kaz kaz 1600 9300 1600 8
echo "== 渲染完 $(date +%H:%M:%S)"
zsh tools/remote.sh train kaz 4 runs/kaz/jointnet.pt
echo "== 训练完 $(date +%H:%M:%S)"
