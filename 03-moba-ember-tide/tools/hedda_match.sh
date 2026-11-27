#!/bin/zsh
# 赫达（k-hedda）的全电脑对战：照 match_batch.sh，多记每个英雄打英雄的伤害（h.dmg）和赫达每个技能放了几次。
# 用法: zsh tools/hedda_match.sh <输出目录> "<名字>:<网址参数>" …
cd "$(dirname "$0")/.."
out=$1; shift; mkdir -p $out
for run in "$@"; do n=${run%%:*}; q=${run#*:}
  MOBA_URL=${MOBA_URL:-http://localhost:5212/map.html} node tools/play_test.mjs $out/$n "$(cat tools/hedda_match_steps.json)" "$q&auto=1&nofog=1&nohud=1" 1280 720 2>&1 | tee $out/$n.raw | python3 tools/match_report.py > $out/$n.txt
  grep "^结束" $out/$n.raw | cut -c1-2000; grep "errors" $out/$n.raw | tail -1
done
