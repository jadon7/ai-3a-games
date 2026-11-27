#!/bin/zsh
# 出一段动作视频并抽帧。用法: zsh gen_video.sh <动作名> <序号，如 01> [提示词文件名（不带目录），默认 mandrill_<动作>.txt]
# 每段 45 积分；--out 指的文件已经存在时下载会失败但积分照扣，所以先检查。
A=$1; N=$2; PF=${3:-mandrill_$A.txt}
V=/Users/jadon7/Documents/SynologyDrive/code/video2rig; M=/Users/jadon7/Documents/SynologyDrive/code/moba; D=$M/art/unit/mandrill
OUT=out/seedance/mandrill_${A}_$N.mp4
cd $V
[ -e $OUT ] && { echo "$OUT 已经存在，换一个序号"; exit 1; }
mkdir -p $D/logs $D/sheets
.venv/bin/python scripts/jimeng.py video --ref assets/ref/mandrill_ref.png --prompt-file prompts/$PF --out $OUT --title mandrill_$A --ceiling 50 2>&1 | tee $D/logs/video_${A}_$N.log
[ -f $OUT ] && python3 $M/tools/vsheet.py $OUT $D/sheets/v_${A}_$N.jpg 24 8
