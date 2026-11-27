#!/bin/zsh
# 出动作视频：两段一起跑。用法: zsh videos.sh <版本号如 01> 动作 动作 …
cd /Users/jadon7/Documents/SynologyDrive/code/video2rig
PY=.venv/bin/python; ver=$1; shift
mkdir -p /Users/jadon7/Documents/SynologyDrive/code/moba/art/hero/seren/video_logs
run() { $PY scripts/jimeng.py video --ref assets/ref/seren_ref.png --prompt-file prompts/seren_$1.txt --out out/seedance/seren_$1_$ver.mp4 --title seren_$1 --ceiling 50 > /Users/jadon7/Documents/SynologyDrive/code/moba/art/hero/seren/video_logs/$1_$ver.log 2>&1; echo "$1 $ver exit $? $(tail -1 /Users/jadon7/Documents/SynologyDrive/code/moba/art/hero/seren/video_logs/$1_$ver.log | cut -c1-120)"; }
while [ $# -gt 0 ]; do
  a=$1; b=$2; shift; [ $# -gt 0 ] && shift
  run $a & p1=$!
  [ -n "$b" ] && { run $b & p2=$!; wait $p2; }
  wait $p1
done
