#!/bin/zsh
# 读视频成动作（MOBA/tools/solve_only.py，只读不改）。用法: zsh solve.sh 动作=编号 …，如 idle=01 heavy=02
V=/Users/jadon7/Documents/SynologyDrive/code/video2rig; M=/Users/jadon7/Documents/SynologyDrive/code/moba
args=()
for a in "$@"; do c=${a%%=*}; n=${a#*=}; args+=("$c=out/seedance/lingshuang_${c}_$n.mp4"); done
cd $V && .venv/bin/python $M/tools/solve_only.py lingshuang $args
