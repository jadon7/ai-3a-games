#!/bin/zsh
# 野猪从“视频”到成品的整条链。改了裁剪、变速，或者换了权重以后跑这个（重跑 tools/solve_only.py 会把下面的整理冲掉，所以都收在这里）。
# 用法: zsh art/unit/boar/scripts/rebuild.sh [read] [solve]
#   read ：先用 tools/solve_only.py 把六段视频重新读一遍（换了 runs/boar/jointnet.pt 以后要加）
#   solve：用 solve_boar.py 重新求解（清野点、被挡的腿借近侧腿、稳健损失从宽收到窄）并去毛刺；不加就只重新整理、出品
# 步骤: 读视频 → 求解 → 去毛刺 → 普攻收小人立幅度 → 普攻、重击、死亡变速 → tools/creature_build.sh（裁剪见 motions.json）→ 量时间点
set -e
V=/Users/jadon7/Documents/SynologyDrive/code/video2rig; M=/Users/jadon7/Documents/SynologyDrive/code/moba; D=$M/art/unit/boar; S=$D/scripts; PY=$V/.venv/bin/python; A=$V/out/anim
for arg in "$@"; do
  if [ "$arg" = "read" ]; then
    cd $V; $PY $M/tools/solve_only.py boar idle=out/seedance/boar_idle_01.mp4 run=out/seedance/boar_run_01.mp4 run2=out/seedance/boar_run_02.mp4 attack1=out/seedance/boar_attack1_01.mp4 attack2=out/seedance/boar_attack2_01.mp4 death=out/seedance/boar_death_01.mp4 2>&1 | grep -v Warning
  fi
  if [ "$arg" = "solve" ]; then
    cd $V; $PY $S/solve_boar.py idle run run2 attack1 attack2 death 2>&1 | grep -v Warning
    for a in idle run2 attack1 attack2 death; do $PY $S/deglitch.py $A/boar_$a/motion_fix.npz $A/boar_$a/motion_dg.npz 8 | head -6; done      # 跃奔（run）不去毛刺：腿本来就快，会被误伤；它只是备用，不进成品
  fi
done
cd $S
# 普攻：上挑到落地（视频第 30~56 帧）身体幅度收到 55%，头照旧
$PY soften.py $A/boar_attack1/motion_dg.npz $D/retimed/attack1_soft.npz 30 56 0.55 0 4
# 变速（帧号都是视频的帧号）。普攻只用第一遍：压头右摆快放 → 上挑原速 → 高处停留压短 → 落地
$PY retime.py $D/retimed/attack1_soft.npz $D/retimed/attack1.npz "2-27:2.2,27-36:1,36-48:2,48-58:1.25" mark=29/33/36/54
# 重击：压头 → 刨三下 → 后坐 → 坐着不动的一秒半压到五帧 → 预备 → 顶出去（第 92 帧前后）→ 人立上甩 → 前蹄跺地 → 回正
$PY retime.py $A/boar_attack2/motion_dg.npz $D/retimed/attack2.npz "0-9:2,9-39:1.6,39-48:1.2,48-84:7,84-90:1,90-96:1,96-102:1.5,102-110:1,110-120:1.4" mark=39/84/90/92/108
# 死亡：开头站着晃的那段快放，跪下、趴下原速
$PY retime.py $A/boar_death/motion_dg.npz $D/retimed/death.npz "30-44:1.5,44-78:1,78-92:1.3" mark=44/68/76
cd $M; zsh tools/creature_build.sh art/unit/boar
cd $S; $PY events.py $D/motions; $PY measure_run.py $D/motions/run.npz ${BOAR_HEIGHT:-2.7} | tail -2
