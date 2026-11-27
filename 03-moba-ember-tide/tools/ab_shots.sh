#!/bin/zsh
# 用法: zsh tools/ab_shots.sh <输出目录> <名字> "<附加的查询参数>"
# 在固定的五个机位各截一张（时间也固定），名字不同的几组放一起就能逐张对比。调画面参数用。
out=$1; name=$2; extra=$3; mkdir -p $out
typeset -A V
V=(lane "cam=-30,0,22,50" base "cam=-62,0,40,52" foe "cam=44,0,26,50" river "cam=0,0,30,52" jungle "cam=-28,26,26,50" hero "h=lan&solo=1&hero=-24,3,135")
for k in lane base foe river jungle hero; do
  q="${V[$k]}&nohud=1&t=3"; [ $k = hero ] || q="$q&hero=0"
  MOBA_URL=${MOBA_URL:-http://localhost:5190/map.html} node tools/shot.mjs $out/${k}_$name.jpg "$q&$extra" 1920 1080 1400 2>&1 | grep -o '"errors":\[[^]]*\]' | grep -v '\[\]'
done
ls $out | grep "_$name" | wc -l
