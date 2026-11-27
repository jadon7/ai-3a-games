#!/bin/zsh
# 录赫达（k-hedda）的技能。用法: zsh tools/hedda_rec.sh <输出目录> [只录哪几个，比如 Q,R]
# 测试场里赫达站在路向 (-13,0)、面朝 +u；对面假人是托尔格 (-4.5,-5.2)，己方假人是葛隆 (-14,4.6)，对面五个小兵在 (-6..-1.8, -2.4..2.8)。
# 机位 cam=u,v,距离,俯角,高度,转角（路向坐标）；转角 45 让技能从左往右放。录像工具是 fx2c 的 fxclip.mjs 拷来的（tools/hedda_clip.mjs）
out=$1; only=${2:-all}
T=${0:A:h}/hedda_clip.mjs
run() { local name=$1 cam=$2 job=$3; [[ $only == all || ",$only," == *",$name,"* ]] || return; node $T $out hedda "[$job]" 1280 720 "cam=$cam" 2>&1 | grep -v "^$" | tail -3; }
DUM='__actors.get(__dummy.id)'; FR='__actors.get(__arena.friend.id)'
run A "-6.6,-0.6,11,56,1,45" '{"name":"A","js":"__me.attack(__arena.foes[1])","dur":2.4,"pre":"const [x,z]=__W(-8,-1.2); __me.teleport(x,z); __me.face(__arena.foes[1].x,__arena.foes[1].z,true)"}'
run Q "-8.6,-4.8,12.5,56,1,45" '{"name":"Q","key":"Q","dur":1.7,"pre":"const [x,z]=__W(-13,-4.4); __me.teleport(x,z); __me.face(__dummy.x,__dummy.z,true)"}'
run W "-7.6,-3.4,13.5,56,1,45" '{"name":"W","key":"W","dur":3.0,"pre":"const [x,z]=__W(-8.3,-4.4); __me.teleport(x,z); __me.face(__dummy.x,__dummy.z,true)","after":"__api.after(0.95, ()=>{ const [x,z]=__W(-11.5,0.5); __me.moveTo(x,z); })"}'
run E "-10,0.2,14,56,1,45" '{"name":"E","key":"E","dur":2.4,"pre":"const [fx,fz]=__W(-8,2.5); '"$FR"'.teleport(fx,fz); const [x,z]=__W(-12.5,-2.6); __me.teleport(x,z); __me.face(fx,fz,true); const m=__arena.foes[0]; const [mx,mz]=__W(-10.3,2.4); m.x=mx; m.z=mz; const [dx,dz]=__W(-8.1,-0.5); '"$DUM"'.teleport(dx,dz)"}'
run R "-7,-0.6,19,56,1,45" '{"name":"R","key":"R","dur":5.6,"aim":[-4.4,0],"pre":"const [x,z]=__W(-11.6,-0.6); __me.teleport(x,z); const [dx,dz]=__W(-4.4,-1.4); '"$DUM"'.teleport(dx,dz); __me.face(dx,dz,true)"}'
run Rw "-11.2,-0.6,7.5,56,1.6,45" '{"name":"Rw","key":"R","dur":1.1,"aim":[-4.4,0],"pre":"const [x,z]=__W(-11.6,-0.6); __me.teleport(x,z); const [dx,dz]=__W(-4.4,-1.4); '"$DUM"'.teleport(dx,dz); __me.face(dx,dz,true)"}'
run Rl "-5,-0.6,11,56,1,45" '{"name":"Rl","key":"R","dur":2.4,"aim":[-4.4,0],"pre":"const [x,z]=__W(-11.6,-0.6); __me.teleport(x,z); const [dx,dz]=__W(-4.4,-1.4); '"$DUM"'.teleport(dx,dz); __me.face(dx,dz,true)"}'
run P "-6.5,-4,14,56,1,45" '{"name":"P","key":"W","dur":2.6,"pre":"const [x,z]=__W(-8.5,-4.4); __me.teleport(x,z); __me.face(__dummy.x,__dummy.z,true); const [fx,fz]=__W(-6,-7.6); '"$FR"'.teleport(fx,fz)","after":"__api.after(1.0, ()=>'"$FR"'.attack(__dummy))"}'
