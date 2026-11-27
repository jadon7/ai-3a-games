#!/bin/zsh
# 连着跑几局全电脑的 3v3（16 倍速，一局一两分钟），每局的战况写到 <输出目录>/<名字>.txt，最后打一张汇总。
# 用法: zsh tools/match_batch.sh <输出目录> "<名字>:<网址参数>" ["<名字>:<网址参数>" …]
#   例: zsh tools/match_batch.sh /tmp/b lan:"h=lan" osen:"h=osen&diff=hard"
# 走不做热更新的那个测试服务器（端口 5190，npx vite --config vite.test.config.ts），跑的时候改代码不会把对局重置。
cd "$(dirname "$0")/.."
out=$1; shift; mkdir -p $out
for run in "$@"; do n=${run%%:*}; q=${run#*:}
  MOBA_URL=${MOBA_URL:-http://localhost:5190/map.html} node tools/play_test.mjs $out/$n "$(cat tools/match_steps/bots_end.json)" "$q&auto=1&nofog=1&nohud=1" 1280 720 2>&1 | python3 tools/match_report.py > $out/$n.txt
done
for run in "$@"; do n=${run%%:*}; echo "== $n"; grep -v "^    " $out/$n.txt | grep -v errors | tail -1; done
