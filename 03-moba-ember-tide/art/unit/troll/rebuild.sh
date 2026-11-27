#!/bin/zsh
# 岩石巨魔：从“读出来的动作”（V2R/out/anim/troll_*/motion.npz）到成品的整条链。改了变速、裁剪以后跑这个。
#   0.（加 solve 参数才做，要用显卡，约 3 分钟）重新读视频、修读数：
#        solve_only 读 idle、run、roar、death 四段新视频（punch、slam 两段旧的已经读过，结果和现在的脚本读出来的一模一样，不重读）
#        align_views：run 两个机位差了 9.5 帧，对齐以后重解 → troll_runal
#        resolve：筛掉认错的读数、加上更细的贴地约束重解。run、punch 加脚底不入地 → troll_runfix、troll_punchfix；
#                 slam（双拳砸地）、death（跪地撑地）从屈膝开始解，被挡住的那一侧借另一侧；slam 另加双脚钉在原地、death 另加摊开手掌和跪姿的贴地高度 → troll_slamfix、troll_deathfix
#   1. 去抖（dejudder.py：待机）、行走钉脚（footlock.py）、变速（retime.py）：蓄力、停顿拖得长的压短，跪倒、扑倒放慢一点（六米高的东西倒下去不该那么快）
#   2. 结尾接回待机（blend_tail.py）
#   3. tools/creature_build.sh：整理动作（motions.json）→ 装进模型 → 导出压缩到 public/assets/unit/troll.glb
# 用法: zsh art/unit/troll/rebuild.sh [solve]
set -e
cd "$(dirname "$0")"
V=/Users/jadon7/Documents/SynologyDrive/code/video2rig; PY=$V/.venv/bin/python; A=$V/out/anim; D=$PWD; M=/Users/jadon7/Documents/SynologyDrive/code/moba
if [ "$1" = solve ]; then
  cd $V
  $PY $M/tools/solve_only.py troll idle=out/seedance/troll_idle_01.mp4 run=out/seedance/troll_run_01.mp4 roar=out/seedance/troll_roar_01.mp4 death=out/seedance/troll_death_01.mp4 2>&1 | grep -v Warning
  $PY $D/align_views.py run runal --from 28 2>&1 | grep -v Warning
  $PY $D/resolve.py runal runfix --sole 2>&1 | grep -v Warning
  $PY $D/resolve.py punch punchfix --sole 2>&1 | grep -v Warning
  $PY $D/resolve.py slam slamfix --sym-legs 53-78 --arm-follow 24-88 --plant 0-90 --hand-floor 0.062,0.047,0.037,0.037 2>&1 | grep -v Warning
  $PY $D/resolve.py death deathfix --front-feet-off 52-120 --sym-legs 52-120 --arm-follow 78-120 --open-hands 78-120 --wrist 90 --hand-floor 0.06,0.04,0.035,0.035 --kneel-floor 0.075,0.05,0.045 --sole 2>&1 | grep -v Warning
  cd $D
fi
IDLE0=2      # 待机循环的起始帧（motions.json 里 idle 的 pick 第一个数），一次性动作的结尾回到这一帧的姿势
# idle 待机：整段去掉“两帧一顿”，循环在 motions.json 里钉成第 2 到 110 帧
$PY dejudder.py $A/troll_idle/motion.npz $D/retimed/idle.npz
# run 行走：取第 24 到 62 帧这一圈（两步，1.58 秒），绕循环去抖，再让落地脚匀速往后走；打印出来的速度就是 runSpeed
$PY footlock.py $A/troll_runfix/motion.npz $D/retimed/run.npz 24 62 6
# attack1 右直拳：拉臂 6-32 压到 2.2 倍速，出拳 32-42 原速（第 40.5 帧打直），拳头伸着不动的 42-60 四倍速带过，收拳 60-70
$PY retime.py $A/troll_punchfix/motion.npz $D/retimed/_a1.npz "6-32:2.2,32-42:1,42-60:4,60-70:1.25" mark=26/36/40.5
$PY blend_tail.py $D/retimed/_a1.npz $D/retimed/attack1.npz $D/retimed/idle.npz $IDLE0 8
# attack2 双拳砸地：下沉 16-22，举臂 22-36，举在头顶 36-50 稍微压短，砸下 50-58（第 56 帧拳头着地），撑着 58-72 压短，起身 72-86
$PY retime.py $A/troll_slamfix/motion.npz $D/retimed/_a2.npz "16-36:1,36-50:1.4,50-58:1,58-72:1.6,72-86:1" mark=22/36/50/56
$PY blend_tail.py $D/retimed/_a2.npz $D/retimed/attack2.npz $D/retimed/idle.npz $IDLE0 10
# roar 咆哮：弯腰攥拳 2-14，绷住 14-26 稍压短，挺身张臂 26-32（第 30 帧张到头），视频里吼了 2.8 秒压到约 0.9 秒，收回 98-120
$PY retime.py $A/troll_roar/motion.npz $D/retimed/_roar.npz "2-14:1,14-26:1.3,26-32:1,32-98:3,98-120:1.2" mark=14/26/30/98
$PY blend_tail.py $D/retimed/_roar.npz $D/retimed/roar.npz $D/retimed/idle.npz $IDLE0 6
# death 死亡：摇晃 8-44 快放，双膝跪下 44-54 放慢，跪着 54-74 带过，向前扑倒撑地 74-86 放慢，86-100 垂头停住
# （死亡不去抖：试过，跪下那一下会被磨软，脚尖翻过去时陷得更深）
$PY retime.py $A/troll_deathfix/motion.npz $D/retimed/death.npz "8-44:1.5,44-54:0.7,54-74:2.5,74-86:0.75,86-100:1" mark=44/52/74/82
cd $M && zsh tools/creature_build.sh art/unit/troll
