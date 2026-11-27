#!/bin/zsh
# 给一批动作补手臂的系统偏差：前臂 → 重新标定 → 手。用法: zsh fixhands.sh 动作 …
# 标定值用的是 calib_ref.json / calib_ref2.json（第一批 7 段量的平均，各段一致），新动作直接用同一组数。
D=/Users/jadon7/Documents/SynologyDrive/code/fighting-game/art/fighter/lingshuang; PY=/Users/jadon7/Documents/SynologyDrive/code/video2rig/.venv/bin/python
$PY $D/pipeline/fix_hand.py $D/calib_ref.json RightForeArm,LeftForeArm "$@" | grep -v Warn
$PY $D/pipeline/fix_hand.py $D/calib_ref2.json RightHand,LeftHand "$@" | grep -v Warn
