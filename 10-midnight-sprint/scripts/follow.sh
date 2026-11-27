#!/bin/zsh
# 跟着 4090 的渲染进度增量拉帧并合成；合成帧数达到目标就退出。用法：follow.sh <目标帧数>
ROOT="${0:A:h:h}"
target=${1:-1272}
while true; do
  "$ROOT/scripts/final_build.sh" > "$ROOT/renders/follow.log" 2>&1
  n=$(ls "$ROOT/renders/final_png_v5" | grep -c png)
  if (( n >= target )); then
    echo "reached $n"; tail -3 "$ROOT/renders/follow.log"; exit 0
  fi
  sleep 150
done
