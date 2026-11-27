#!/bin/zsh
# 出一段动作视频并抽帧。用法: zsh art/hero/osen/gen.sh <动作> [序号=01]
# 每段 45 即梦积分；输出文件已存在时不跑（下载会失败但积分照扣）。
A=$1; N=${2:-01}
V2R=/Users/jadon7/Documents/SynologyDrive/code/video2rig; MOBA=/Users/jadon7/Documents/SynologyDrive/code/moba
OUT=out/seedance/osen_${A}_${N}.mp4
cd $V2R
if [ -e $OUT ]; then echo "已经有 $OUT，换个序号"; exit 1; fi
if [ ! -f prompts/osen_$A.txt ]; then echo "没有提示词 prompts/osen_$A.txt"; exit 1; fi
.venv/bin/python scripts/jimeng.py video --ref assets/ref/osen_ref.png --prompt-file prompts/osen_$A.txt --out $OUT --title osen_$A --ceiling 50 || exit 1
SUF=""; [ "$N" != "01" ] && SUF="_$N"
.venv/bin/python $MOBA/tools/vsheet.py $OUT $MOBA/art/hero/osen/sheets/v_${A}${SUF}.jpg 24 8
