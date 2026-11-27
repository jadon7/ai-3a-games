#!/bin/zsh
# 巨蟾：从视频到成品的整条链。改了求解的选项、变速、裁剪，或者换了权重以后跑这个。
#   zsh art/unit/toad/rebuild.sh read     重新读五段视频（换了权重才需要；顺带用共用求解器解一遍，得到报告里的基准数字），再往下全做
#   zsh art/unit/toad/rebuild.sh solve    从专用求解开始（读数不变）
#   zsh art/unit/toad/rebuild.sh          只做：整理步态、变速、整理动作（motions.json）、装进模型、导出压缩到 public/assets/unit/toad.glb
# 各段用的视频：idle_01、run_01、attack1_02（01 真的扑出了画面，不用）、attack2_01、death_01。帧号都是视频的帧号（每秒 24 帧）。
set -e
D=/Users/jadon7/Documents/SynologyDrive/code/moba/art/unit/toad
V=/Users/jadon7/Documents/SynologyDrive/code/video2rig; PY=$V/.venv/bin/python; A=$V/out/anim; S=$V/out/seedance
cd $V
if [ "$1" = read ]; then
  $PY /Users/jadon7/Documents/SynologyDrive/code/moba/tools/solve_only.py toad idle=$S/toad_idle_01.mp4 run=$S/toad_run_01.mp4 attack1=$S/toad_attack1_02.mp4 attack2=$S/toad_attack2_01.mp4 death=$S/toad_death_01.mp4 2>&1 | grep -v Warning | tee $D/logs/solve.log
fi
if [ "$1" = read ] || [ "$1" = solve ]; then
  # 原地的四段都开“脚踩实”（plant：踩在地上的脚不许在地面上挪；待机给 60，另外三段身体动得大，给 6——给到 40 普攻的前探会被压掉一大半）；待机只用这一项（左右对称的先验会把“身体转一下”错当成两边的腿一起动）；
  # 普攻、重击、死亡是左右对称的动作，再加对称先验（sym：看不清的左腿向右腿的镜像靠拢，腾空时全靠它）。走路是跑步机上原地走，两项都不开（后面单独整理步态）
  $PY $D/scripts/solve_toad.py idle plant=60 run attack1 sym=0.02 plant=6 attack2 sym=0.03 plant=6 death sym=0.02 plant=6 2>&1 | grep -v Warning | cut -c 1-250 | tee $D/logs/solve_fix.log
fi
cd $D
# 走路：视频里是“跑步机上大步快跑”（按原速每秒六七米，腿甩得很开），游戏里要的是每秒 3.6 米的沉重快走。分两步：
#   gait.py      把视频里六个多周期叠成一个干净的周期，左腿用右腿差半个周期的镜像（左腿在侧面机位里被身体挡住）
#   gait_walk.py 在脚的位置上重做：着地那半个周期严格匀速往后（0.917 单位/秒 = 游戏里 3.6 米/秒，不打滑），迈步沿用视频的曲线形状，再反解腿的角度
$PY scripts/gait.py $A/toad_run/motion_fix.npz $D/retimed/run_fold.npz from=18 to=118 mix=1
$PY scripts/gait_walk.py $D/retimed/run_fold.npz $D/retimed/run.npz v=0.917 duty=0.5 lift=0.45 cycle=0.6667
# 普攻：用第二次前探（蓄势快，自然）。蓄势 1.7 倍速、前探和收回基本原速 → 第 0.55 秒打中
$PY scripts/retime.py $A/toad_attack1/motion_fix.npz $D/retimed/attack1.npz "79-91:1.7,91-99:1.1,99-118:1.1" mark=91/98/99
# 重击：下蹲和蓄力的停顿快放、腾空 2.2 倍速 → 第 1.3 秒砸地；趴着的停顿 3 倍速
$PY scripts/retime.py $A/toad_attack2/motion_fix.npz $D/retimed/attack2.npz "6-24:3.6,24-44:2.9,44-49:1,49-75:2.2,75-78:1.2,78-101:3,101-120:1.4" mark=44/49/63/78
# 死亡：前面三秒的摇晃只留半秒，瘫倒原速
$PY scripts/retime.py $A/toad_death/motion_fix.npz $D/retimed/death.npz "20-66:4,66-84:1,84-100:2" mark=70/78
cd /Users/jadon7/Documents/SynologyDrive/code/moba && zsh tools/creature_build.sh art/unit/toad
