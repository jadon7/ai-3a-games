#!/bin/zsh
# 录这个任务的八个技能（第九轮 fx2c）。用法: zsh rec_all.sh <输出目录> [只录哪几个，比如 gQ,vR]
# 机位：测试场里葛隆先挪到靶子前面几米、面朝靶子；薇萝挪到能一箭穿两个小兵的位置。cam= 是路向坐标，转角 45 度让技能从左往右放。
out=$1; only=${2:-all}
T=/Users/jadon7/Documents/SynologyDrive/code/moba/docs/round9/fx2c/tools/fxclip.mjs
run() { local name=$1 hero=$2 cam=$3 job=$4; [[ $only == all || ",$only," == *",$name,"* ]] || return; node $T $out $hero "[$job]" 1280 720 "cam=$cam" 2>&1 | grep -v "^$" | tail -3; }
run gQ gorran "-7.2,-3,18,56,1,45" '{"name":"gQ","key":"Q","dur":1.8,"pre":"const [x,z]=__W(-10,-1); __me.teleport(x,z); __me.face(__dummy.x,__dummy.z,true)"}'
run gW gorran "-6.5,-1.2,17,56,1,45" '{"name":"gW","key":"W","dur":4.4,"pre":"const [x,z]=__W(-8.5,-1); __me.teleport(x,z); const [fx,fz]=__W(-3,-1); __me.face(fx,fz,true)","after":"for (let i=0;i<7;i++) __api.after(0.45+i*0.3, ()=>__api.hit(__dummy, __sim.hero, 260, \"phys\"))"}'
run gE gorran "-6.8,-0.5,17,56,1,45" '{"name":"gE","key":"E","dur":6.2,"pre":"const [x,z]=__W(-9.5,-0.5); __me.teleport(x,z); const [fx,fz]=__W(-5,-0.5); __me.face(fx,fz,true)","aim":[-5,-0.5]}'
run gR gorran "-6.5,-1,22,56,1,45" '{"name":"gR","key":"R","dur":6.6,"pre":"const [x,z]=__W(-8,-1); __me.teleport(x,z); const [fx,fz]=__W(-3,-1); __me.face(fx,fz,true)"}'
run vQ vero "-7.6,1.6,18,56,1,45" '{"name":"vQ","key":"Q","dur":2.3,"pre":"const [x,z]=__W(-14,0.94); __me.teleport(x,z); const [fx,fz]=__W(-2.2,2.8); __me.face(fx,fz,true)","aim":[-2.2,2.8]}'
run vW vero "-9,-2.2,17,56,1,45" '{"name":"vW","key":"W","dur":2.6,"pre":"const [x,z]=__W(-13.5,-0.5); __me.teleport(x,z); const [fx,fz]=__W(-6,-0.5); __me.face(fx,fz,true)","aim":[-6,-0.5],"after":"__api.after(0.62, ()=>__me.attack(__dummy))"}'
run vE vero "-8.2,-0.5,18,56,1,45" '{"name":"vE","key":"E","dur":6.6,"pre":"const [x,z]=__W(-13,0); __me.teleport(x,z); const [fx,fz]=__W(-5,-0.5); __me.face(fx,fz,true)","aim":[-5,-0.5]}'
run vR vero "-7.5,0,19,56,1,45" '{"name":"vR","key":"R","dur":4.4,"pre":"const [x,z]=__W(-13,0); __me.teleport(x,z); const [fx,fz]=__W(-4,0); __me.face(fx,fz,true)","aim":[-4,0]}'
