#!/bin/zsh
# 读视频成动作（tools/solve_only.py），默认十段全读；R 用第二版视频（第一版空中转成一团模糊，读不出来）。
# 用法: zsh art/hero_iti/solve.sh [动作=编号 …]，如 attack1=02
# 注意：重读会把 V2R/out/anim/iti_<动作>/motion.npz 冲掉，之后要按 rebuild.sh 开头写的顺序补修正。
V=/Users/jadon7/Documents/SynologyDrive/code/video2rig; M=/Users/jadon7/Documents/SynologyDrive/code/moba/.claude/worktrees/iti-model
args=()
if [ $# -eq 0 ]; then set -- idle=01 run=01 attack1=01 attack2=01 q=01 q3=01 w=01 e=01 r=02 death=01; fi
for a in "$@"; do c=${a%%=*}; n=${a#*=}; args+=("$c=out/seedance/iti_${c}_$n.mp4"); done
cd $V && .venv/bin/python $M/tools/solve_only.py iti $args 2>&1 | grep -v Warning
