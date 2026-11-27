#!/bin/zsh
# 用法: fixvid.sh <录屏.webm> <输出.mp4> <真实秒数> [宽=1280] [crf=27]
# 无界面录屏的帧率不稳，直接转出来会偏快：先转一遍量出时长，再按真实秒数把时间轴拉回去，统一成 30 帧。
in="$1"; out="$2"; real="$3"; w="${4:-1280}"; crf="${5:-27}"; tmp="${out%.mp4}_tmp.mp4"
ffmpeg -v error -y -i "$in" -an -c:v libx264 -preset veryfast -crf 20 "$tmp"
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$tmp")
k=$(python3 -c "print($real/$dur)")
ffmpeg -v error -y -i "$tmp" -an -vf "setpts=PTS*$k,fps=30,scale=$w:-2:flags=lanczos" -c:v libx264 -preset slow -crf "$crf" -pix_fmt yuv420p -movflags +faststart "$out"
echo "$out 录屏 ${dur}s → 真实 ${real}s（×$k） $(du -h "$out" | cut -f1)"
