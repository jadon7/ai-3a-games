#!/bin/zsh
# 拼证据（第九轮 polish-old，照 fx2c 的 make_evidence.sh）：每个改了的技能一张改前/改后的连续帧对比、一条改前|改后并排的录像。
# 用法: zsh make_evidence.sh [只拼哪几个，比如 gE,vE]   （在 docs/round9/polish-old 里找 before/、after/ 两个目录）
D=/Users/jadon7/Documents/SynologyDrive/code/moba/docs/round9/polish-old; cd $D
P=/opt/homebrew/opt/python@3.14/bin/python3.14
only=${1:-all}
typeset -A NAME FR CROP
NAME=(gQ "葛隆 Q 砧撞" gW "葛隆 W 淬火" gE "葛隆 E 余烬地" gR "葛隆 R 开闸" vE "薇萝 E 火油罐" vW "薇萝 W 翻滚装填" tW "托尔格 W 余音" mE "摩珂 E 回流" oQ "奥森 Q 烛焰")
FR=(gQ 6,8,9,10,11,12,14,16,18,22,28,36 gW 40,74,78,80,82,84,86,88,92,98,110,125 gE 8,10,12,14,16,18,22,30,45,70,110,160 gR 8,10,12,14,16,18,22,28,40,80,130,180
    vE 16,20,24,26,28,30,34,40,60,100,150,185 vW 0,3,6,9,12,16,24,28,31,33,36,42 tW 0,3,5,7,9,11,13,15,18,22,28,40 mE 4,8,10,12,14,16,18,20,23,26,32,45 oQ 6,9,12,14,15,16,17,18,20,23,27,34)
CROP=(gQ 200,0,1100,560 gW 120,40,1000,535 gE 200,40,1100,546 gR 60,0,1220,652 vE 300,40,1260,580 vW 100,0,1180,608 tW 160,0,1120,600 mE 100,60,1180,640 oQ 200,60,1180,640)
for k in gQ gW gE gR vE vW tW mE oQ; do
  [[ $only == all || ",$only," == *",$k,"* ]] || continue
  [[ -d before/$k && -d after/$k ]] || { echo "缺 $k"; continue; }
  $P tools/compare.py "对比_${k}.jpg" before/$k after/$k ${FR[$k]} 0 0 ${CROP[$k]} 380 "${NAME[$k]}：改前（上，phase9）/ 改后（下，r9-polish-old），按对局时间（30 帧每秒），同一时刻" > /dev/null
  cp before/$k.mp4 "改前_${k}.mp4"; cp after/$k.mp4 "改后_${k}.mp4"
  DYLD_LIBRARY_PATH=/opt/homebrew/Cellar/x265/4.2/lib ffmpeg -y -loglevel error -i before/$k.mp4 -i after/$k.mp4 -i tools/lb_before.png -i tools/lb_after.png -filter_complex "[0:v][2:v]overlay=16:12[a];[1:v][3:v]overlay=16:12[b];[a][b]hstack=inputs=2,scale=1920:-2" -c:v libx264 -pix_fmt yuv420p -crf 22 "并排_${k}.mp4"
  echo $k
done
