#!/bin/zsh
# 读视频成动作（tools/solve_only.py），默认九段全读。用法: zsh art/hero/hedda/solve.sh [动作=编号 …]，如 attack1=02
V=/Users/jadon7/Documents/SynologyDrive/code/video2rig; M=/Users/jadon7/Documents/SynologyDrive/code/moba
args=()
if [ $# -eq 0 ]; then set -- idle=01 run=01 attack1=01 attack2=01 q=01 w=01 e=01 r=01 death=01; fi
for a in "$@"; do c=${a%%=*}; n=${a#*=}; args+=("$c=out/seedance/hedda_${c}_$n.mp4"); done
cd $V && .venv/bin/python $M/tools/solve_only.py hedda $args
