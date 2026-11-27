#!/bin/zsh
# 卡兹第三轮训练：第二轮（3200 组）val(退化后) 8.8 像素，还差一点，再补渲 1600 组（种子 9500，编号从 3200 起），
# 从第二轮的权重接着训 3 轮。第二轮的权重留在 V2R/runs/kaz/jointnet_r2_3200x4.pt。
set -e
cd /Users/jadon7/Documents/SynologyDrive/code/moba
echo "== 开始 $(date +%H:%M:%S)"
zsh tools/remote.sh render kaz kaz 1600 9500 3200 8
echo "== 渲染完 $(date +%H:%M:%S)"
zsh tools/remote.sh train kaz 3 runs/kaz/jointnet.pt
echo "== 训练完 $(date +%H:%M:%S)"
