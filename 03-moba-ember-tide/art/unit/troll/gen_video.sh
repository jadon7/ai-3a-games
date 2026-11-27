#!/bin/zsh
# 出巨魔的动作视频（即梦，每段 45 积分）。用法: zsh art/unit/troll/gen_video.sh <动作> <序号，如 01> [动作 序号 …]
# 目标文件已存在就不跑（下载会失败但积分照扣）。日志记到 logs/jimeng.log。
D=/Users/jadon7/Documents/SynologyDrive/code/moba/art/unit/troll
V=/Users/jadon7/Documents/SynologyDrive/code/video2rig
cd $V
while [ $# -ge 2 ]; do
  A=$1; N=$2; shift 2
  OUT=out/seedance/troll_${A}_${N}.mp4
  if [ -e $OUT ]; then echo "[$A] $OUT 已存在，跳过" >> $D/logs/jimeng.log; continue; fi
  echo "== $A $N $(date +%H:%M:%S)" >> $D/logs/jimeng.log
  .venv/bin/python scripts/jimeng.py video --ref assets/ref/troll_ref.png --prompt-file prompts/troll_${A}.txt --out $OUT --title troll_${A}_${N} --ceiling 50 2>&1 | sed "s/^/[$A] /" >> $D/logs/jimeng.log
  [ -e $OUT ] && .venv/bin/python /Users/jadon7/Documents/SynologyDrive/code/moba/tools/vsheet.py $OUT $D/sheets/v_${A}_${N}.jpg 24 8 >> $D/logs/jimeng.log 2>&1
done
echo "== done $(date +%H:%M:%S)" >> $D/logs/jimeng.log
