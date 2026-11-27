#!/bin/zsh
# 读视频成动作（MOBA/tools/solve_only.py，只读不改），用法: zsh solve.sh 动作=编号 …（如 light1=01）
V=/Users/jadon7/Documents/SynologyDrive/code/video2rig
args=(); for a in "$@"; do c=${a%%=*}; n=${a#*=}; args+=("$c=out/seedance/yanjin_${c}_$n.mp4"); done
cd $V && .venv/bin/python /Users/jadon7/Documents/SynologyDrive/code/moba/tools/solve_only.py yanjin $args 2>&1 | grep -v "HF Hub"
