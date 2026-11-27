#!/bin/zsh
# 六个老英雄 24 个技能的固定机位录像（第九轮 polish-old）。用法: MOBA_URL=... zsh rec_all.sh <输出目录> [只录哪几个，比如 gW,gE]
# 葛隆、薇萝的机位和摆位照 fx2c 的 rec_all.sh；岚、托尔格照 fx2a 的 fx2a_jobs.json（世界坐标换成了路向坐标）；摩珂、奥森是这里新定的。
# cam= 是路向坐标：u,v,距离,俯角,看向的点离地多高,转角。__W(u,v) 把路向坐标换成世界坐标。
out=$1; only=${2:-all}
T=/Users/jadon7/Documents/SynologyDrive/code/moba/docs/round9/polish-old/tools/fxclip.mjs
run() { local name=$1 hero=$2 cam=$3 job=$4; [[ $only == all || ",$only," == *",$name,"* ]] || return; node $T $out $hero "[$job]" 1280 720 "cam=$cam" 2>&1 | grep -v "^$" | tail -3; }
# 葛隆
run gQ gorran "-7.2,-3,18,56,1,45" '{"name":"gQ","key":"Q","dur":1.8,"pre":"const [x,z]=__W(-10,-1); __me.teleport(x,z); __me.face(__dummy.x,__dummy.z,true)"}'
run gW gorran "-6.5,-1.2,17,56,1,45" '{"name":"gW","key":"W","dur":4.4,"pre":"const [x,z]=__W(-8.5,-1); __me.teleport(x,z); const [fx,fz]=__W(-3,-1); __me.face(fx,fz,true)","after":"for (let i=0;i<7;i++) __api.after(0.45+i*0.3, ()=>__api.hit(__dummy, __sim.hero, 260, \"phys\"))"}'
run gE gorran "-6.8,-0.5,17,56,1,45" '{"name":"gE","key":"E","dur":6.2,"pre":"const [x,z]=__W(-9.5,-0.5); __me.teleport(x,z); const [fx,fz]=__W(-5,-0.5); __me.face(fx,fz,true)","aim":[-5,-0.5]}'
run gR gorran "-6.5,-1,22,56,1,45" '{"name":"gR","key":"R","dur":6.6,"pre":"const [x,z]=__W(-8,-1); __me.teleport(x,z); const [fx,fz]=__W(-3,-1); __me.face(fx,fz,true)"}'
# 薇萝
run vQ vero "-7.6,1.6,18,56,1,45" '{"name":"vQ","key":"Q","dur":2.3,"pre":"const [x,z]=__W(-14,0.94); __me.teleport(x,z); const [fx,fz]=__W(-2.2,2.8); __me.face(fx,fz,true)","aim":[-2.2,2.8]}'
run vW vero "-9,-2.2,17,56,1,45" '{"name":"vW","key":"W","dur":2.6,"pre":"const [x,z]=__W(-13.5,-0.5); __me.teleport(x,z); const [fx,fz]=__W(-6,-0.5); __me.face(fx,fz,true)","aim":[-6,-0.5],"after":"__api.after(0.62, ()=>__me.attack(__dummy))"}'
run vE vero "-8.2,-0.5,18,56,1,45" '{"name":"vE","key":"E","dur":6.6,"pre":"const [x,z]=__W(-13,0); __me.teleport(x,z); const [fx,fz]=__W(-5,-0.5); __me.face(fx,fz,true)","aim":[-5,-0.5]}'
run vR vero "-7.5,0,19,56,1,45" '{"name":"vR","key":"R","dur":4.4,"pre":"const [x,z]=__W(-13,0); __me.teleport(x,z); const [fx,fz]=__W(-4,0); __me.face(fx,fz,true)","aim":[-4,0]}'
# 岚
run lQ lan "-7.35,-3.68,13,50,0.8,90" '{"name":"lQ","key":"Q","dur":1.5,"pre":"__me.teleport(-9.2,7.6); __me.face(__dummy.x,__dummy.z,true)"}'
run lW lan "-6.15,-3.89,11.5,50,0.8,90" '{"name":"lW","dur":2.4,"pre":"__me.teleport(__dummy.x-0.4,__dummy.z+4.4); __me.face(__dummy.x,__dummy.z,true)","js":"__me.cast(\"W\"); __api.after(1.05, ()=>__me.attack(__dummy))"}'
run lR lan "-5.02,-0.35,16,55,0.8,0" '{"name":"lR","key":"R","dur":3.7,"pre":"__me.teleport(-4.6,5.4); __me.face(-3.5,2.5,true)"}'
# 托尔格
run tQ torg "-5.66,0.57,12,50,0.8,90" '{"name":"tQ","key":"Q","dur":1.7,"pre":"__me.teleport(-3.8,6.6); __me.face(-3.7,2.7,true)","aim":{"x":-3.7,"z":2.7}}'
run tW torg "-5.80,0.14,17,55,0.5,0" '{"name":"tW","key":"W","dur":2.1,"pre":"__me.teleport(-4,4.3)"}'
run tR torg "-6.79,-0.28,19,55,0.5,0" '{"name":"tR","key":"R","dur":4.9,"pre":"__me.teleport(-8.6,8.2); __me.face(-4,4,true)","aim":{"x":-4.3,"z":3.9}}'
# 摩珂（己方假人站在草里，hide=brush 把草藏掉，fx2b 也是这么录的）
run mQ moko "-13.2,4.2,15,56,1,45&hide=brush" '{"name":"mQ","key":"Q","dur":2.0,"pre":"const [x,z]=__W(-11,2); __me.teleport(x,z); __me.face(__arena.friend.x,__arena.friend.z,true)"}'
run mW moko "-13.6,4.2,12,56,1,45&hide=brush" '{"name":"mW","key":"W","dur":4.6,"pre":"const [x,z]=__W(-11,2); __me.teleport(x,z); __me.face(__arena.friend.x,__arena.friend.z,true)"}'
run mE moko "-6.8,0.2,17,56,1,45" '{"name":"mE","key":"E","dur":2.2,"pre":"const [x,z]=__W(-11.5,0.2); __me.teleport(x,z); const [fx,fz]=__W(-2,0.2); __me.face(fx,fz,true)","aim":[-2,0.2]}'
run mR moko "-5,0.5,24,58,1,45" '{"name":"mR","key":"R","dur":6.5,"pre":"const [x,z]=__W(-5,0.5); __me.teleport(x,z)"}'
# 奥森
run oQ osen "-7,0.2,15,56,1,45" '{"name":"oQ","key":"Q","dur":1.6,"pre":"const [x,z]=__W(-11,0.2); __me.teleport(x,z); const [fx,fz]=__W(-3.8,0.2); __me.face(fx,fz,true)","aim":[-3.8,0.2]}'
run oW osen "-6.5,-0.7,15,56,1,45" '{"name":"oW","key":"W","dur":3.6,"pre":"const [x,z]=__W(-11,-0.7); __me.teleport(x,z); const [fx,fz]=__W(-4.6,-0.7); __me.face(fx,fz,true)","aim":[-4.6,-0.7]}'
run oE osen "-6.5,0,16,56,1,45" '{"name":"oE","key":"E","dur":5.0,"pre":"const [x,z]=__W(-11,0); __me.teleport(x,z); const [fx,fz]=__W(-4.4,0); __me.face(fx,fz,true)","aim":[-4.4,0]}'
run oR osen "-5.5,0.3,22,58,1,45" '{"name":"oR","key":"R","dur":4.0,"pre":"const [x,z]=__W(-11,0); __me.teleport(x,z); const [fx,fz]=__W(-4,0.5); __me.face(fx,fz,true)","aim":[-4,0.5]}'
