#!/bin/zsh
# 钟龟：从“读出来的动作”（V2R/out/anim/turtle_*/motion.npz）到成品的整条链，改了变速或者重新读了视频以后跑这个。
#   1. Q 左右镜像（视频里是从左扫到右，特效是从右扫到左）
#   2. 普攻、W、R、死亡变速（视频里蓄力、腾空、停顿都拖得长）
#   3. tools/creature_build.sh：整理动作（motions.json）→ 装进模型 → 导出压缩到 public/assets/hero/turtle.glb
# 用法: zsh art/hero/torg_turtle/rebuild.sh
set -e
cd "$(dirname "$0")"
V=/Users/jadon7/Documents/SynologyDrive/code/video2rig; PY=$V/.venv/bin/python; A=$V/out/anim; D=$PWD
$PY mirror_motion.py $A/turtle_q/motion.npz $D/q_mirror/motion.npz | tail -1
$PY retime.py $A/turtle_attack1/motion.npz $D/retimed/attack1.npz "1-26:3.5,26-36:1,36-54:1.4" mark=27/30/33
$PY retime.py $A/turtle_w/motion.npz $D/retimed/w.npz "8-22:4,22-36:1.75,36-68:9,68-84:1,84-104:2.5,104-120:1.3" mark=74/76
$PY retime.py $A/turtle_r/motion.npz $D/retimed/r.npz "2-24:2.2,24-29:1,29-50:2.6,50-57:1.4,57-93:3,93-120:1.3" mark=28/56 zscale=0.4
$PY retime.py $A/turtle_death/motion.npz $D/retimed/death.npz "0-33:2.2,33-45:1,45-84:1.6,84-104:1" mark=42/84
cd ../../.. && zsh tools/creature_build.sh art/hero/torg_turtle
