#!/bin/zsh
# 出片：从 4090 拉回 EXR → 后期（记录仪质感）→ 配音 → 模拟机内编码
# 用法：scripts/finalize.sh <day|dusk> <输出名前缀>
set -e
cd "$(dirname "$0")/.."
VAR=$1; NAME=$2
mkdir -p "renders/final_$VAR" out
echo "== 同步帧"
scp -q -o BatchMode=yes "jadon7-wsl:D:/gunfight/$VAR/*.exr" "renders/final_$VAR/" 2>/dev/null
ls "renders/final_$VAR" | wc -l
echo "== 音轨"
.venv/bin/python scripts/audio.py | tail -n 3
echo "== 后期 + 编码"
# 第一遍：高码率中间片（后期完成的画面）
.venv/bin/python scripts/post.py "renders/final_$VAR" --video "out/_${NAME}_master.mp4" --audio out/audio.wav --bitrate 40M | tail -n 2
# 第二遍：模拟记录仪的机内硬件编码（码率有限、无 B 帧），保留真实的压缩痕迹
ffmpeg -y -loglevel error -i "out/_${NAME}_master.mp4" -c:v libx264 -preset veryfast -tune zerolatency -b:v 6500k -maxrate 8000k -bufsize 6000k \
  -g 30 -bf 0 -pix_fmt yuv420p -c:a aac -b:a 96k -ar 44100 -movflags +faststart "out/${NAME}.mp4"
ffprobe -v error -show_entries format=duration,size,bit_rate -of default=nw=1 "out/${NAME}.mp4"
echo "DONE out/${NAME}.mp4"
