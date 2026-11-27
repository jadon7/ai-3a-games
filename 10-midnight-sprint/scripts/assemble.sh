#!/bin/zsh
# 把 renders/final_png/ 的帧和 out/audio.wav 编码成成片
ROOT="${0:A:h:h}"
OUT="$ROOT/out/midnight_sprint_1080p.mp4"
ffmpeg -v error -stats -y -framerate 30 -start_number 1 -i "$ROOT/renders/final_png/%04d.png" -i "$ROOT/out/audio.wav" \
  -c:v libx264 -preset slow -crf 15 -pix_fmt yuv420p -colorspace bt709 -color_primaries bt709 -color_trc bt709 \
  -c:a aac -b:a 256k -shortest -movflags +faststart "$OUT" && ls -la "$OUT"
