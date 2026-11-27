#!/bin/zsh
# 出一段托尔格的动作视频（每段 45 即梦积分）。用法: zsh art/hero/torg/gen_video.sh <动作> <序号，如 01>
# 输出文件已经存在就不跑（那种情况下载会失败但积分照扣）。日志在 art/hero/torg/tmp/vid_<动作>_<序号>.log。
set -e
V2R=/Users/jadon7/Documents/SynologyDrive/code/video2rig; D=/Users/jadon7/Documents/SynologyDrive/code/moba/art/hero/torg
clip=$1; nn=$2; out=out/seedance/torg_${clip}_${nn}.mp4
cd $V2R
if [ -e $out ]; then echo "已经有 $out 了，换一个序号"; exit 1; fi
if [ ! -f prompts/torg_${clip}.txt ]; then echo "没有 prompts/torg_${clip}.txt"; exit 1; fi
.venv/bin/python scripts/jimeng.py video --ref assets/ref/torg_ref.png --prompt-file prompts/torg_${clip}.txt --out $out --title torg_${clip} --ceiling 50 > $D/tmp/vid_${clip}_${nn}.log 2>&1
echo "DONE $clip $nn"; tail -2 $D/tmp/vid_${clip}_${nn}.log
