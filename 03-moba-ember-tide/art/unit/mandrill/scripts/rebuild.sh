#!/bin/zsh
# 山魈从视频到成品的全过程。改了裁剪、换了权重、重出了视频，都用它重建（直接重跑 tools/solve_only.py 会把清理过的求解冲掉——它只写 mandrill_<动作>/，
# 清理后的结果在 mandrill_<动作>_fix/，motions.json 用的是后者）。
# 模型那一头要从头来的话，顺序是：
#   Blender -P scripts/to_mixamo.py -- tripo_rigged.glb V2R/assets/model/mandrill_rigged.glb 0.82      Tripo 的命名改成 Mixamo 的、缩到 0.82
#   Blender -P V2R/scripts/blender/prep_rig.py -- assets/model/mandrill_rigged.glb mandrill            管线摆正（会重写 mandrill.blend 和 mandrill_skeleton.json）
#   python3 scripts/add_profile.py V2R/assets/model/mandrill_skeleton.json                              补山魈自己的活动范围（prep_rig 会把它冲掉）
#   NFIX_K=8 Blender mandrill.blend -P scripts/fix_normals.py -- V2R/out/anim/mandrill_attack1_fix/motion.npz 22,32,40,82,86,90,94,96    腋下的法线（同样会被 prep_rig 冲掉）
# 用法: zsh art/unit/mandrill/scripts/rebuild.sh [read]      加 read：先用现在的权重把四段视频重新读一遍（约 4 分钟）
set -e
V=/Users/jadon7/Documents/SynologyDrive/code/video2rig; M=/Users/jadon7/Documents/SynologyDrive/code/moba; D=$M/art/unit/mandrill; PY=$V/.venv/bin/python
RUN_VIDEO=${RUN_VIDEO:-out/seedance/mandrill_run_02.mp4}
cd $V
if [ "$1" = read ]; then
  $PY $M/tools/solve_only.py mandrill attack1=out/seedance/mandrill_attack1_01.mp4 run=$RUN_VIDEO idle=out/seedance/mandrill_idle_01.mp4 death=out/seedance/mandrill_death_01.mp4 2>&1 | grep -v -i warn | tee $D/logs/solve.log
fi
{
$PY $D/scripts/solve_mandrill.py attack1 --mirror-arms 0-120 --mirror-legs 0-120      # 普攻：双臂、双腿都是一起动的，左边借右边的前后位置
$PY $D/scripts/solve_mandrill.py run --legs 0-120 --arms 0-120                         # 跑步：侧面机位整段整段地把左右认反，逐帧纠正
$PY $D/scripts/solve_mandrill.py idle --mirror-legs 0-120                              # 待机：双脚不动；右手抓胸口不对称，手臂不镜像
$PY $D/scripts/solve_mandrill.py death --kneel 58-120                                  # 死亡：跪下以后膝、髋从屈着开始解
} 2>&1 | grep -v -i warn | tee $D/logs/solve_fix.log
cd $M
TMPDIR=${TMPDIR:-/tmp} zsh tools/creature_build.sh art/unit/mandrill 2>&1 | tee $D/logs/build.log
