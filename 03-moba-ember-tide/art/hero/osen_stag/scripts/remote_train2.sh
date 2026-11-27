#!/bin/zsh
# 鹿的训练，第二次：remote.sh train 写死了 --workers 16，train.py 有 3 个数据加载器，一共 48 个进程约 24G 内存；
# 和巨龟的训练撞在一起把远程 32G 内存撑爆，两边都死了。这里用 remote.sh run 自己起，只开 4 个 worker（12 个进程约 6G）。
set -e
V=/Users/jadon7/Documents/SynologyDrive/code/video2rig
cd /Users/jadon7/Documents/SynologyDrive/code/moba
echo "== train $(date +%H:%M:%S)"
zsh tools/remote.sh run '"$PY" scripts/train.py stag --epochs 6 --batch 16 --workers 4 --init runs/beast/jointnet.pt > runs_stag.out 2>&1; grep -E "EPOCH|DONE|Error|Traceback|^train " runs_stag.out | cut -c 1-240'
mkdir -p $V/runs/stag
scp -q -o BatchMode=yes -o LogLevel=ERROR "jadon7-wsl:D:/moba-remote/video2rig/runs/stag/jointnet.pt" $V/runs/stag/jointnet.pt
scp -q -o BatchMode=yes -o LogLevel=ERROR "jadon7-wsl:D:/moba-remote/video2rig/runs/stag/train_log.txt" $V/runs/stag/train_log_remote.txt
ls -la $V/runs/stag/jointnet.pt
echo "== done $(date +%H:%M:%S)"
