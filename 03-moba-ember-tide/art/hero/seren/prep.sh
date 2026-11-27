#!/bin/zsh
# 读完视频以后、hero_motion 之前：按 retime.json 给一次性动作变速，写到 art/hero/seren/retimed/<动作>.npz（motions.json 指这里）
cd /Users/jadon7/Documents/SynologyDrive/code/moba
PY=/Users/jadon7/Documents/SynologyDrive/code/video2rig/.venv/bin/python; V=/Users/jadon7/Documents/SynologyDrive/code/video2rig
mkdir -p art/hero/seren/retimed
clips=($@); [ ${#clips} -eq 0 ] && clips=(attack1 attack2 q w e r)
for a in $clips; do
  args=("${(@f)$($PY -c "import json;[print(x) for x in json.load(open('art/hero/seren/retime.json'))['$a']]")}")
  $PY art/hero/seren/retime.py $V/out/anim/seren_$a/motion.npz art/hero/seren/retimed/$a.npz "${args[@]}" | tail -1
done
