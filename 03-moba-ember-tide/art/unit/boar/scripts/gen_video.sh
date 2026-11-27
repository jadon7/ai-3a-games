#!/bin/zsh
# 出一段或几段动作视频（按顺序一段一段出），每段出完抽帧。用法: zsh gen_video.sh <动作>[:序号] ...   例: zsh gen_video.sh idle run:02
# 每段 45 积分。输出文件已经存在就跳过（下载会失败但积分照扣），重出要换序号；序号不是 01 时优先用 prompts/boar_<动作>_<序号>.txt。
V=/Users/jadon7/Documents/SynologyDrive/code/video2rig
S=/Users/jadon7/Documents/SynologyDrive/code/moba/art/unit/boar
cd $V
for item in "$@"; do
  a=${item%%:*}; n=01; [[ "$item" == *:* ]] && n=${item##*:}
  out=out/seedance/boar_${a}_$n.mp4
  if [ -e $out ]; then echo "$a: $out 已经存在，跳过（重出要换序号）"; continue; fi
  pf=prompts/boar_$a.txt; [ "$n" != "01" ] && [ -f prompts/boar_${a}_$n.txt ] && pf=prompts/boar_${a}_$n.txt
  echo "== $a $n 开始 $(date +%H:%M:%S) 提示词 $pf"
  .venv/bin/python scripts/jimeng.py video --ref assets/ref/boar_ref.png --prompt-file $pf --out $out --title boar_$a --ceiling 50 2>&1 | tail -4
  if [ -f $out ]; then python3 /Users/jadon7/Documents/SynologyDrive/code/moba/tools/vsheet.py $out $S/sheets/v_${a}_$n.jpg 24 8; fi
  echo "== $a $n 结束 $(date +%H:%M:%S)"
done
