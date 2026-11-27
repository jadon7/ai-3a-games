#!/bin/zsh
# 拼证据（第九轮 fx2c）：每个技能一张改前/改后的连续帧对比、一条改前|改后并排的录像；再拼一张改后的代表帧总表。
# 用法: zsh make_evidence.sh   （在 docs/round9/fx2c 里找 before/、after/ 两个目录）
D=/Users/jadon7/Documents/SynologyDrive/code/moba/docs/round9/fx2c; cd $D
typeset -A NAME FR CROP
NAME=(gQ "葛隆 Q 砧撞" gW "葛隆 W 淬火" gE "葛隆 E 余烬地" gR "葛隆 R 开闸" vQ "薇萝 Q 穿甲矢" vW "薇萝 W 翻滚装填" vE "薇萝 E 火油罐" vR "薇萝 R 连弩齐射")
FR=(gQ 3,6,9,12,15,17,19,21,24,28,34,42 gW 20,45,70,82,85,88,91,94,98,103,110,120 gE 15,22,24,26,28,31,35,45,70,100,140,165 gR 18,26,28,30,33,37,45,60,90,130,160,185
    vQ 8,15,19,20,22,24,26,28,31,35,42,55 vW 0,3,6,9,12,16,24,28,31,33,36,42 vE 15,25,35,38,40,43,47,55,80,120,160,185 vR 10,20,30,40,50,60,70,80,90,100,110,125)
CROP=(gQ 260,0,1180,518 gW 120,40,1000,535 gE 200,40,1100,546 gR 60,0,1220,652 vQ 40,40,1240,715 vW 100,0,1180,608 vE 300,40,1260,580 vR 60,40,1240,704)
for k in gQ gW gE gR vQ vW vE vR; do
  python3 tools/compare.py "对比_${k}.jpg" before/$k after/$k ${FR[$k]} 0 0 ${CROP[$k]} 380 "${NAME[$k]}：改前（上）/ 改后（下），按对局时间（30 帧每秒），同一时刻" > /dev/null
  ffmpeg -y -loglevel error -i before/$k.mp4 -i after/$k.mp4 -i tools/lb_before.png -i tools/lb_after.png -filter_complex "[0:v][2:v]overlay=16:12[a];[1:v][3:v]overlay=16:12[b];[a][b]hstack=inputs=2,scale=1920:-2" -c:v libx264 -pix_fmt yuv420p -crf 22 "并排_${k}.mp4"
  echo $k
done
