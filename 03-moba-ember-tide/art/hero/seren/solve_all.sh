#!/bin/zsh
# 权重到了以后：读全部视频 → 纠正认反的腿（跑步）→ 蹲、跪的几段从屈膝开始重解 → 变速。之后跑 rebuild.sh。
# 注意：重跑这个会把 out/anim/seren_*/motion.npz 冲掉，修正都在这里面重做一遍。fix_legs / resolve 第一次跑时会把原结果存成 motion_raw.npz、detections_raw.npz，
# 之后它们读的是这两个 _raw 文件；重新读视频以后要手动删掉 _raw（rm 写完整路径）。
cd /Users/jadon7/Documents/SynologyDrive/code/video2rig
PY=.venv/bin/python; M=/Users/jadon7/Documents/SynologyDrive/code/moba
clips=($@); [ ${#clips} -eq 0 ] && clips=(idle run attack1 attack2 q w e r death)      # zsh 不按空格拆 ${@:-…}，所以先放进数组
typeset -A ver; ver=(run 03)      # 跑步用第三版视频（第一版是快速腾空跑，腿糊、逐帧认反，读不出来；第二版成了原地踏步）
args=(); for a in $clips; do args+=("$a=out/seedance/seren_${a}_${ver[$a]:-01}.mp4"); done
$PY $M/tools/solve_only.py seren $args 2>&1 | grep -v Warning
# 蹲、跪：从屈膝开始重解（只有回投偏差变小才换）。跑步第三版读得干净（1.8%），不再用 fix_legs.py
for a in w e r death; do (( ${clips[(Ie)$a]} )) && $PY $M/art/hero/seren/resolve.py $a 2>&1 | grep -v Warning | tail -3; done
skip=(idle run death); todo=(${clips:|skip}); (( ${#todo} )) && zsh $M/art/hero/seren/prep.sh $todo
