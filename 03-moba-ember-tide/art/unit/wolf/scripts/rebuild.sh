#!/bin/zsh
# 狼从“权重已经有了”到出品的全部步骤。用法: zsh art/unit/wolf/scripts/rebuild.sh [read|solve]
#   read ：从视频重新读关节再求解（第一次，或者换了权重）
#   solve：读数用 out/anim/wolf_*/detections.npz 里现成的，只重新求解（改了 solve_wolf.py 以后）
#   不加 ：只重新整理动作、出品（改了下面这些后处理脚本或者 motions.json 以后）
# 后处理的顺序：待机接成循环并钉脚 → 普攻钉脚、变速 → 死亡不许陷地、变速 → 奔跑叠成一步、收小步幅、钉脚 → tools/creature_build.sh
# 中间文件都在 art/unit/wolf/retimed/，motions.json 里四段动作的 src 指的就是它们。出品以后时间表 public/assets/unit/wolf.json 要手改（events.py 量时间点，run_probe_tip.mjs 量原速）。
set -e
V=/Users/jadon7/Documents/SynologyDrive/code/video2rig; M=/Users/jadon7/Documents/SynologyDrive/code/moba; S=$M/art/unit/wolf/scripts; PY=$V/.venv/bin/python
ACTS=(idle run attack1 death)
if [ "$1" = "read" ]; then
  cd $V; $PY $S/solve_wolf.py idle=out/seedance/wolf_idle_01.mp4 run=out/seedance/wolf_run_01.mp4 attack1=out/seedance/wolf_attack1_01.mp4 death=out/seedance/wolf_death_01.mp4 2>&1 | grep -v Warning
elif [ "$1" = "solve" ]; then
  cd $V; $PY $S/solve_wolf.py $ACTS 2>&1 | grep -v Warning
fi
if [ -n "$1" ]; then
  cd $V; for a in idle attack1 death; do $PY $S/deglitch.py out/anim/wolf_$a/motion_fix.npz out/anim/wolf_$a/motion_dg.npz 8 | head -1; done      # 奔跑不去毛刺：腿本来就快，会被误伤
fi
cd $M
# 原地的动作把四只爪子钉在地上（说明见 pin_feet.py）；待机先接成循环（第 6 到 118 帧，是 hero_motion.py 自己找出来的那一对）再钉
$PY $S/pin_feet.py $V/out/anim/wolf_idle/motion_dg.npz $M/art/unit/wolf/retimed/idle.npz loop=6,118
$PY $S/pin_feet.py $V/out/anim/wolf_attack1/motion_dg.npz $M/art/unit/wolf/retimed/attack1_pin.npz
# 变速（不剪断）：普攻取视频里的第二遍，出手前的蓄力压短（游戏里野怪前摇只有 0.42 秒），咬完收回按原速；死亡整体加快到两秒出头（游戏里死后 2.2 秒尸体开始下沉）
$PY $S/retime.py $M/art/unit/wolf/retimed/attack1_pin.npz $M/art/unit/wolf/retimed/attack1.npz "75-87:2.4,87-97:1.4,97-118:1" mark=87/97
$PY $S/fix_death.py $V/out/anim/wolf_death/motion_dg.npz $M/art/unit/wolf/retimed/death_fix.npz      # 死亡：趴下以后下巴、肘、胸口不许陷进地里（说明见 fix_death.py）
$PY $S/retime.py $M/art/unit/wolf/retimed/death_fix.npz $M/art/unit/wolf/retimed/death.npz "16-40:1.6,40-64:1.3,64-92:2,92-96:1" mark=40/64/92
# 奔跑：六七步按相位叠成干净的一步，落地的爪子匀速后退（说明见 fix_run.py）
$PY $S/fix_run.py
zsh tools/creature_build.sh art/unit/wolf
