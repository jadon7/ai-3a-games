#!/bin/zsh
# 后期合成：帧序列 -> 调色（辉光/暖色/暗角/颗粒/轻微色散）-> H.264
#   post.sh <帧目录> <输出.mp4> [帧率=24] [扩展名=png] [起始帧=1] [mode: full|clean]
#   full  = 成片（暖色调色 + 辉光 + 镜头畸变/色散 + 暗角 + 胶片颗粒）
#   clean = 只做色彩空间转换，不加任何风格化（保留给你自己调色用）
set -e
DIR="$1"; OUT="$2"; FPS="${3:-24}"; EXT="${4:-png}"; START="${5:-1}"; MODE="${6:-full}"

BLOOM="split=2[base][hl];[hl]curves=all='0/0 0.66/0 0.88/0.32 1/1',gblur=sigma=16,colorchannelmixer=rr=1.0:gg=0.84:bb=0.66[bloom];[base][bloom]blend=all_mode=screen:all_opacity=0.5"
GRADE="colortemperature=temperature=5700:mix=0.5,colorbalance=rs=-0.02:bs=0.035:rm=0.025:gm=0.005:bm=-0.03:rh=0.04:gh=0.01:bh=-0.05,curves=all='0/0 0.11/0.078 0.5/0.515 0.86/0.9 1/1',huesaturation=saturation=0.08"
LENS="lenscorrection=k1=-0.010:k2=0.0,rgbashift=rh=-1:bh=1"
FINISH="format=rgb24,vignette=angle=0.36,noise=alls=5:allf=t+u,unsharp=3:3:0.3"

case "$MODE" in
  full)  FG="format=gbrp16le,${BLOOM},${GRADE},${LENS},${FINISH},format=yuv420p" ;;
  clean) FG="format=yuv420p" ;;
esac

ffmpeg -y -loglevel error -framerate "$FPS" -start_number "$START" -i "$DIR/f%04d.$EXT" \
  -filter_complex "$FG" -r "$FPS" -c:v libx264 -preset slow -crf 13 -profile:v high -pix_fmt yuv420p \
  -color_primaries bt709 -color_trc bt709 -colorspace bt709 -movflags +faststart "$OUT"
ls -la "$OUT"
