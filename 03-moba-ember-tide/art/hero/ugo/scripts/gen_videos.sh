#!/bin/zsh
# 出乌戈的动作视频：两段一组同时跑，每段出完抽帧成联系表。用法: zsh gen_videos.sh <动作:编号> ...   例如 idle:01 run:01
V=/Users/jadon7/Documents/SynologyDrive/code/video2rig; M=/Users/jadon7/Documents/SynologyDrive/code/moba; D=$M/art/hero/ugo; PY=$V/.venv/bin/python
mkdir -p $D/sheets $D/video_logs; cd $V
one() {
  local a=${1%%:*} n=${1##*:}; local out=out/seedance/ugo_${a}_${n}.mp4
  [ -f $out ] && { echo "已有 $out，跳过"; return; }
  $PY scripts/jimeng.py video --ref assets/ref/ugo_ref.png --prompt-file prompts/ugo_${a}.txt --out $out --title ugo_${a}_${n} --ceiling 50 > $D/video_logs/${a}_${n}.log 2>&1
  if [ -f $out ]; then python3 $M/tools/vsheet.py $out $D/sheets/v_${a}_${n}.jpg 24 8 > /dev/null 2>&1; echo "完成 $a $n"; else echo "失败 $a $n：$(tail -2 $D/video_logs/${a}_${n}.log | tr '\n' ' ')"; fi
}
args=("$@")
for ((i = 1; i <= ${#args}; i += 2)); do
  one ${args[i]} & p1=$!
  if [ -n "${args[i+1]}" ]; then one ${args[i+1]} & p2=$!; wait $p2; fi
  wait $p1
done
