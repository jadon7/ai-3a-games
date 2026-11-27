#!/bin/zsh
# 出动作视频（即梦 Seedance，每段约 45 积分），两段一起跑，出完抽帧成联系表 sheets/v_<动作>_<编号>.jpg。
# 用法: zsh videos.sh <编号，如 01> <动作> [<动作> …]
V=/Users/jadon7/Documents/SynologyDrive/code/video2rig; L=/Users/jadon7/Documents/SynologyDrive/code/fighting-game/art/fighter/lingshuang
PY=$V/.venv/bin/python; n=$1; shift
one() {
  c=$1; out=out/seedance/lingshuang_${c}_$n.mp4
  [ -f $V/$out ] && { echo "已有 $out"; return; }
  (cd $V && $PY scripts/jimeng.py video --ref assets/ref/lingshuang_ref.png --prompt-file prompts/lingshuang_$c.txt --out $out --title lingshuang_${c}_$n --ceiling 50) > $L/video_logs/${c}_$n.log 2>&1
  if [ -f $V/$out ]; then $PY /Users/jadon7/Documents/SynologyDrive/code/moba/tools/vsheet.py $V/$out $L/sheets/v_${c}_$n.jpg 24 6 > /dev/null 2>&1; echo "好了 $c $(date +%H:%M)"; else echo "失败 $c"; tail -3 $L/video_logs/${c}_$n.log; fi
}
while [ $# -gt 0 ]; do
  a=$1; b=$2; shift; [ $# -gt 0 ] && shift
  one $a & [ -n "$b" ] && one $b &
  wait
done
