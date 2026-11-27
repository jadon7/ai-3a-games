#!/bin/zsh
# 摩珂自己用：出一段动作视频并抽帧。用法: zsh art/hero/moko/gen_video.sh <动作> [序号=01]
# 每段 45 积分；--out 指的文件已存在就不跑（下载会失败但积分照扣）。
A=$1; N=${2:-01}
V2R=/Users/jadon7/Documents/SynologyDrive/code/video2rig
MOBA=/Users/jadon7/Documents/SynologyDrive/code/moba
OUT=$V2R/out/seedance/moko_${A}_${N}.mp4
if [ -e "$OUT" ]; then echo "已存在，不跑: $OUT"; exit 1; fi
cd $V2R
$V2R/.venv/bin/python scripts/jimeng.py video --ref assets/ref/moko_ref.png --prompt-file prompts/moko_${A}.txt --out out/seedance/moko_${A}_${N}.mp4 --title moko_${A} --ceiling 50 || { echo "FAILED $A"; exit 2; }
SUF=""; [ "$N" != "01" ] && SUF="_$N"
python3 $MOBA/tools/vsheet.py $OUT $MOBA/art/hero/moko/sheets/v_${A}${SUF}.jpg 24 8
echo "DONE $A $N"
