#!/bin/zsh
# 回归（第九轮 polish-old）：鼠标、触屏回归改前（5190 = phase9）改后（5217 = 本分支）各跑一遍；整局全电脑对战；团战帧率改前改后。
# 一个一个跑（同一时间只开一个无界面 Chrome）。用法: zsh regress.sh [只跑哪几步，比如 click,touch,match,fps]
W=/Users/jadon7/Documents/SynologyDrive/code/moba/.claude/worktrees/polish-old
R=/Users/jadon7/Documents/SynologyDrive/code/moba/docs/round9/polish-old/regress
B=http://localhost:5190/map.html; A=http://localhost:5217/map.html
only=${1:-click,touch,match,fps}; mkdir -p $R; cd $W
has() { [[ ",$only," == *",$1,"* ]]; }
if has click; then
  MOBA_URL=$B node tools/click_test.mjs $R/click_before > $R/click_before.log 2>&1; echo click_before $?
  MOBA_URL=$A node tools/click_test.mjs $R/click_after > $R/click_after.log 2>&1; echo click_after $?
fi
if has touch; then
  MOBA_URL=$B node tools/touch_test.mjs $R/touch_before > $R/touch_before.log 2>&1; echo touch_before $?
  MOBA_URL=$A node tools/touch_test.mjs $R/touch_after > $R/touch_after.log 2>&1; echo touch_after $?
fi
if has match; then
  MOBA_URL=$A zsh tools/match_batch.sh $R/match g:"h=gorran" > $R/match.log 2>&1; echo match $?
fi
if has fps; then
  for q in "director=1&h=gorran" "director=1&h=gorran&touch=1&q=lite"; do
    tag=${q//[^a-z]/_}
    FIGHT_N=4 MOBA_URL=$B node tools/fps_fight.mjs "$q" 10 > $R/fps_before_$tag.log 2>&1; echo fps_before $tag $?
    FIGHT_N=4 MOBA_URL=$A node tools/fps_fight.mjs "$q" 10 > $R/fps_after_$tag.log 2>&1; echo fps_after $tag $?
  done
fi
