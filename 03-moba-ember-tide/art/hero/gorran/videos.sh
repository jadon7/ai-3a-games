#!/bin/zsh
# 出葛隆的动作参考视频（即梦，每段 45 积分），两段两段地同时跑，日志在 art/hero/gorran/video_logs/。
# 用法: zsh art/hero/gorran/videos.sh <编号，如 01> <动作> [动作 …]
# 输出文件已经存在的那一段直接跳过（即梦那边下载会失败但积分照扣，重出要换编号）。
cd /Users/jadon7/Documents/SynologyDrive/code/video2rig
L=/Users/jadon7/Documents/SynologyDrive/code/moba/art/hero/gorran/video_logs; mkdir -p $L
N=$1; shift
one() {
  local a=$1 out=out/seedance/gorran_${1}_$N.mp4
  if [ -e $out ]; then echo "$a: $out 已经有了，跳过"; return; fi
  .venv/bin/python scripts/jimeng.py video --ref assets/ref/gorran_ref.png --prompt-file prompts/gorran_$a.txt --out $out --title gorran_$a --ceiling 50 > $L/${a}_$N.log 2>&1
  echo "$a: 退出码 $? $(tail -n 1 $L/${a}_$N.log | cut -c 1-200)"
}
while [ $# -gt 0 ]; do
  one $1 & [ -n "$2" ] && one $2 &
  wait; shift; [ $# -gt 0 ] && shift
done
