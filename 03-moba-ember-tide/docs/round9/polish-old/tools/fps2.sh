#!/bin/zsh
# 帧率补测（第九轮 polish-old）：上一轮薇萝电脑档改后有两次掉到 33～36（当时机器上还有别的任务的无界面 Chrome），重测两遍；再测观战团战（三对三以上）。
W=/Users/jadon7/Documents/SynologyDrive/code/moba/.claude/worktrees/polish-old
R=/Users/jadon7/Documents/SynologyDrive/code/moba/docs/round9/polish-old/regress; T=/Users/jadon7/Documents/SynologyDrive/code/moba/docs/round9/polish-old/tools
B=http://localhost:5190/map.html; A=http://localhost:5217/map.html
cd $W
for i in 1 2; do
  MOBA_URL=$B node $T/fps_skills.mjs vero 12 "" > $R/fps_skills_before_vero_$i.log 2>&1; echo before vero$i $(tail -1 $R/fps_skills_before_vero_$i.log | cut -c1-140)
  MOBA_URL=$A node $T/fps_skills.mjs vero 12 "" > $R/fps_skills_after_vero_$i.log 2>&1; echo after vero$i $(tail -1 $R/fps_skills_after_vero_$i.log | cut -c1-140)
done
FIGHT_N=3 MOBA_URL=$B node tools/fps_fight.mjs "director=1&h=gorran" 10 > $R/fps_fight_before.log 2>&1; echo fight_before $(tail -1 $R/fps_fight_before.log | cut -c1-120)
FIGHT_N=3 MOBA_URL=$A node tools/fps_fight.mjs "director=1&h=gorran" 10 > $R/fps_fight_after.log 2>&1; echo fight_after $(tail -1 $R/fps_fight_after.log | cut -c1-120)
FIGHT_N=3 MOBA_URL=$B node tools/fps_fight.mjs "director=1&h=gorran&touch=1&q=lite" 10 > $R/fps_fight_before_lite.log 2>&1; echo fight_before_lite $(tail -1 $R/fps_fight_before_lite.log | cut -c1-120)
FIGHT_N=3 MOBA_URL=$A node tools/fps_fight.mjs "director=1&h=gorran&touch=1&q=lite" 10 > $R/fps_fight_after_lite.log 2>&1; echo fight_after_lite $(tail -1 $R/fps_fight_after_lite.log | cut -c1-120)
echo ALLDONE
