#!/bin/zsh
# 卡兹从“权重已经有了”到出品的全部步骤（照狼的 art/unit/wolf/scripts/rebuild.sh 改）。用法: zsh art/hero/kaz/scripts/rebuild.sh [read|solve]
#   read ：从视频重新读关节再求解（第一次，或者换了权重）
#   solve：读数用 out/anim/kaz_*/detections.npz 里现成的，只重新求解（改了 solve_kaz.py 以后）
#   不加 ：只重新整理动作、出品（改了下面这些后处理的参数或者 motions.json 以后）
# 后处理：去毛刺 → 钉脚（原地不动的爪子钉在地上；扑抓的那只、腾空的那段不钉）→ 变速（蓄力、停顿、腾空压短，出手提前，不剪断）
#        → 奔跑叠成一步、收步幅、钉脚 → 死亡不许陷地 → tools/creature_build.sh
# 中间文件都在 art/hero/kaz/retimed/，motions.json 里各段的 src 指的就是它们。视频帧号是 24 帧每秒的。
set -e
V=/Users/jadon7/Documents/SynologyDrive/code/video2rig; M=/Users/jadon7/Documents/SynologyDrive/code/moba; S=$M/art/hero/kaz/scripts; PY=$V/.venv/bin/python; R=$M/art/hero/kaz/retimed
SD=out/seedance
if [ "$1" = "read" ]; then
  cd $V; $PY $S/solve_kaz.py idle=$SD/kaz_idle_01.mp4 run=$SD/kaz_run_01.mp4 attack1=$SD/kaz_attack1_01.mp4 attack2=$SD/kaz_attack2_01.mp4 q=$SD/kaz_q_01.mp4 \
     w=$SD/kaz_w_01.mp4 e=$SD/kaz_e_01.mp4 r=$SD/kaz_r_02.mp4 death=$SD/kaz_death_01.mp4 2>&1 | grep -v Warning
elif [ "$1" = "solve" ]; then
  cd $V; $PY $S/solve_kaz.py idle run attack1 attack2 q w e r death 2>&1 | grep -v Warning
fi
cd $V
for a in idle attack1 attack2 q w e r death; do $PY $S/deglitch.py out/anim/kaz_$a/motion_fix.npz out/anim/kaz_$a/motion_dg.npz 8 | head -1; done      # 奔跑不去毛刺：腿本来就快，会被误伤
cd $M; mkdir -p $R
A=$V/out/anim
# 待机：整段 0~120 帧首尾本来就接近，接成循环再把四只爪子钉住
$PY $S/pin_feet.py $A/kaz_idle/motion_dg.npz $R/idle.npz loop=0,120 | tail -1
# 普攻一（右爪扑抓）：第一遍。抬爪 3~22 帧压成 3.4 倍速，下抓 22~28 帧 1.3 倍，按住、收回略快；右前爪不钉
$PY $S/pin_feet.py $A/kaz_attack1/motion_dg.npz $R/attack1_pin.npz legs=0,2,3 | tail -1
$PY $S/retime.py $R/attack1_pin.npz $R/attack1.npz "3-22:3.4,22-28:1.3,28-36:1.6,36-50:1.3" mark=22/27
# 普攻二（咬）：第一遍。左前爪往前迈一步，不钉
$PY $S/pin_feet.py $A/kaz_attack2/motion_dg.npz $R/attack2_pin.npz legs=1,2,3 | tail -1
$PY $S/retime.py $R/attack2_pin.npz $R/attack2_rt.npz "16-22:2.2,22-28:1.1,28-40:2.2,40-54:1.3" mark=22/27
FLOOR_EXTRA=LeftFToe=0.035 $PY $S/fix_death.py $R/attack2_rt.npz $R/attack2.npz | head -1      # 迈出去按地的左前爪趾尖不戳进地里
# Q 扑杀：下蹲 2~14 压 2 倍、蹲住 14~28 压 4 倍，起跳原速，腾空 34~50 压 2.2 倍，落地原速；腾空高度只留两成（游戏自己加抛物线，动作里跳太高会叠成两倍）
$PY $S/pin_feet.py $A/kaz_q/motion_dg.npz $R/q_pin.npz win=0-29,56-75 | tail -1
$PY $S/retime.py $R/q_pin.npz $R/q.npz "2-14:2,14-28:4,28-34:1,34-50:2.2,50-58:1,58-70:1.3" mark=30/52 zscale=0.2
# W 裂爪：右爪抬起 4~18 压 2.2 倍，横扫原速，两爪之间压 4 倍（设计里两爪隔 0.25 秒），左爪横扫 1.3 倍；后腿钉住
$PY $S/pin_feet.py $A/kaz_w/motion_dg.npz $R/w_pin.npz legs=2,3 | tail -1
$PY $S/retime.py $R/w_pin.npz $R/w_rt.npz "4-18:2.2,18-26:1,26-38:4,38-48:1.3,48-62:1.3" mark=21/44
FLOOR_EXTRA=RightFToe=0.04,RightFFetlock=0.05,LeftFToe=0.04 $PY $S/fix_death.py $R/w_rt.npz $R/w.npz | head -1      # 扫完落地的爪尖不戳进地里
# E 炉吼：后坐抬头压 2 倍、仰着停住压 4 倍，向前吼原速，吼住 33~57 压 1.5 倍（约 0.7 秒），收回 1.2 倍
$PY $S/pin_feet.py $A/kaz_e/motion_dg.npz $R/e_pin.npz | tail -1
$PY $S/retime.py $R/e_pin.npz $R/e_rt.npz "3-15:2,15-27:4,27-33:1,33-57:1.5,57-69:1.2" mark=30
FLOOR_EXTRA=RightHHock=0.05,LeftHHock=0.05,RightHAnkle=0.04,LeftHAnkle=0.04 $PY $S/fix_death.py $R/e_rt.npz $R/e.npz | head -1      # 坐下时飞节和跖骨不陷进地里
# R 焚猎：伏低 3~12 1.6 倍、蓄力 12~27 压 2.5 倍，起跳原速，空中悬停 33~78 压 5 倍（设计里扑 0.45 秒），落地原速，抬头站定 1.3 倍；腾空高度只留两成五
$PY $S/pin_feet.py $A/kaz_r/motion_dg.npz $R/r_pin.npz win=0-28,84-120 | tail -1
$PY $S/retime.py $R/r_pin.npz $R/r.npz "3-12:1.6,12-27:2.5,27-33:1,33-78:5,78-87:1,87-105:1.3" mark=29/81 zscale=0.25
# 死亡：后腿软下去那一长段 6~54 压 1.8 倍，前腿跪下原速，头垂下 1.5 倍
$PY $S/fix_death.py $A/kaz_death/motion_dg.npz $R/death_fix.npz | tail -2
$PY $S/retime.py $R/death_fix.npz $R/death.npz "6-54:1.8,54-66:1,66-90:1.5,90-100:1" mark=57/84
# 尾巴不跟踪、跟着骨盆硬动：坐下、伏低、趴下时会插进地里，把尾根抬起来（说明见 tail_lift.py）
for a in q e r death; do $PY $S/tail_lift.py $R/$a.npz | head -1; done
# 奔跑：六七步按相位叠成干净的一步，步幅收到 RUN_SCALE，落地的爪子匀速后退
RUN_SCALE=${RUN_SCALE:-0.55} $PY $S/fix_run.py | grep -E "^(周期|原速)|视频时间里|爪: 踩地|腾空"
$PY -c "import json,numpy as np; p='art/hero/kaz/motions.json'; c=json.load(open(p)); n=len(np.load('art/hero/kaz/retimed/run.npz')['quats'])-1; c['actions']['run'].update(loop=[n,n], pick=[0,n]); json.dump(c,open(p,'w'),ensure_ascii=False,indent=1)"      # 一步的帧数随读数变，motions.json 跟着改
zsh tools/creature_build.sh art/hero/kaz
$PY $S/events_kaz.py art/hero/kaz/motions                         # 各段的出手时刻，对着改 public/assets/hero/kaz.json
