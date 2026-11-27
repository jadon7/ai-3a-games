#!/bin/zsh
# 出动作视频（即梦 Seedance 样片，每段约 45 积分），两段一起跑，出完抽帧成联系表。
# 用法: zsh videos.sh <编号，如 01> <动作> [<动作> …]   已经有的文件跳过（--out 已存在时下载会失败但积分照扣）
V=/Users/jadon7/Documents/SynologyDrive/code/video2rig; D=/Users/jadon7/Documents/SynologyDrive/code/fighting-game/art/fighter/yanjin
PY=$V/.venv/bin/python; n=$1; shift
one() {
  c=$1; out=out/seedance/yanjin_${c}_$n.mp4
  [ -f $V/$out ] && { echo "已有 $out"; return; }
  (cd $V && $PY scripts/jimeng.py video --ref assets/ref/yanjin_ref.png --prompt-file prompts/yanjin_$c.txt --out $out --title yanjin_${c}_$n --ceiling 50) > $D/video_logs/${c}_$n.log 2>&1
  if [ -f $V/$out ]; then $PY /Users/jadon7/Documents/SynologyDrive/code/moba/tools/vsheet.py $V/$out $D/sheets/v_${c}_$n.jpg 24 8 > /dev/null 2>&1; echo "好了 $c $(date +%H:%M)"; else echo "失败 $c"; tail -3 $D/video_logs/${c}_$n.log; fi
}
while [ $# -gt 0 ]; do
  a=$1; b=$2; shift; [ $# -gt 0 ] && shift
  one $a & [ -n "$b" ] && one $b &
  wait
done
