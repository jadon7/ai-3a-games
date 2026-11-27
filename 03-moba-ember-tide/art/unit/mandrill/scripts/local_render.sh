#!/bin/zsh
# 本机渲染山魈的训练图（远程那台机器上四个任务同时渲染、显存撑满，速度掉到每分钟 5 组时的退路）。
# 用法: zsh local_render.sh [总张数=1600] [种子=7400] [起始编号=0] [进程数=2]
N=${1:-1600}; SEED=${2:-7400}; ST=${3:-0}; P=${4:-2}; PER=$((N / P))
V=/Users/jadon7/Documents/SynologyDrive/code/video2rig; L=/Users/jadon7/Documents/SynologyDrive/code/moba/art/unit/mandrill/logs
cd $V; mkdir -p data/mandrill/train
for k in $(seq 0 $((P - 1))); do
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup assets/model/mandrill.blend -P scripts/blender/render_dataset.py -- mandrill data/mandrill/train $PER $((SEED + k)) $((ST + k * PER)) > $L/local_render_${ST}_$k.log 2>&1 &
done
wait
grep -h -E "^(DONE|STOP|Traceback)|Error" $L/local_render_${ST}_*.log
echo "本机渲染完：front 目录里共 $(ls data/mandrill/train/front | wc -l) 张"
