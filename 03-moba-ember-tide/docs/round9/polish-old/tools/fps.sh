#!/bin/zsh
# 帧率改前（5190 = phase9）改后（5217 = 本分支）（第九轮 polish-old）。一个一个跑。
# fps_skills：测试场里葛隆、薇萝四个技能冷却清零反复连放（火场、开闸的一圈火苗叠在一起），每秒读一次；fps_fight：观战等到三对三以上的团战。
W=/Users/jadon7/Documents/SynologyDrive/code/moba/.claude/worktrees/polish-old
R=/Users/jadon7/Documents/SynologyDrive/code/moba/docs/round9/polish-old/regress; T=/Users/jadon7/Documents/SynologyDrive/code/moba/docs/round9/polish-old/tools
B=http://localhost:5190/map.html; A=http://localhost:5217/map.html
mkdir -p $R; cd $W
for h in gorran vero; do for ex in "" "q=lite&touch=1"; do tag=$h${ex:+_lite}
  MOBA_URL=$B node $T/fps_skills.mjs $h 12 "$ex" > $R/fps_skills_before_$tag.log 2>&1; echo before $tag $(tail -1 $R/fps_skills_before_$tag.log | cut -c1-120)
  MOBA_URL=$A node $T/fps_skills.mjs $h 12 "$ex" > $R/fps_skills_after_$tag.log 2>&1; echo after $tag $(tail -1 $R/fps_skills_after_$tag.log | cut -c1-120)
done; done
FIGHT_N=3 MOBA_URL=$B node tools/fps_fight.mjs "director=1&h=gorran" 10 > $R/fps_fight_before.log 2>&1; echo fight_before $(tail -1 $R/fps_fight_before.log | cut -c1-100)
FIGHT_N=3 MOBA_URL=$A node tools/fps_fight.mjs "director=1&h=gorran" 10 > $R/fps_fight_after.log 2>&1; echo fight_after $(tail -1 $R/fps_fight_after.log | cut -c1-100)
