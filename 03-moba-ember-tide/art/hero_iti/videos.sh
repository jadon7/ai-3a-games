#!/bin/zsh
# 出动作视频（即梦 Seedance 样片，每段约 45 积分），两段一起跑，出完抽帧成联系表（art/hero_iti/sheets/v_<动作>_<编号>.jpg）。
# 用法: zsh art/hero_iti/videos.sh <编号，如 01> <动作> [<动作> …]
V=/Users/jadon7/Documents/SynologyDrive/code/video2rig; D=/Users/jadon7/Documents/SynologyDrive/code/moba/.claude/worktrees/iti-model/art/hero_iti
PY=$V/.venv/bin/python; n=$1; shift
mkdir -p $D/video_logs $D/sheets
one() {
  c=$1; out=out/seedance/iti_${c}_$n.mp4
  [ -f $V/$out ] && { echo "已有 $out"; return; }
  (cd $V && $PY scripts/jimeng.py video --ref assets/ref/iti_ref.png --prompt-file prompts/iti_$c.txt --out $out --title iti_${c}_$n --ceiling 50) > $D/video_logs/${c}_$n.log 2>&1
  if [ -f $V/$out ]; then /opt/homebrew/opt/python@3.14/bin/python3.14 /Users/jadon7/Documents/SynologyDrive/code/moba/.claude/worktrees/iti-model/tools/vsheet.py $V/$out $D/sheets/v_${c}_$n.jpg 24 8 > /dev/null 2>&1; echo "好了 $c"; else echo "失败 $c"; tail -3 $D/video_logs/${c}_$n.log; fi
}
while [ $# -gt 0 ]; do
  a=$1; b=$2; shift; [ $# -gt 0 ] && shift
  one $a & [ -n "$b" ] && one $b &
  wait
done
