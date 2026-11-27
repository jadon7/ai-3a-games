#!/bin/zsh
# 换画风 B · b-fx：十个英雄全部技能、普攻、回城、状态图标、脚下圈的固定机位录像（在 B 的亮地面上）。改前用主目录 5190（style-b），改后用自己的 5225，同一份摆位和机位。
# 用法: MOBA_URL=http://localhost:5225/map.html zsh tools/bfx_rec.sh <输出目录> <英雄> [只录哪几个，比如 A,Q]
#   输出 <输出目录>/<英雄>/<技能>/f_000.jpg …（30 帧一秒、对局时间匀速，录像工具是第九轮 pn_clip.mjs 的拷贝 bfx_clip.mjs）和 <输出目录>/<英雄>/<技能>.mp4
# 摆位、机位照第九轮各任务：老六个照 polish-old 的 rec_all.sh，塞伦、卡兹、赫达、乌戈照 pn_rec.sh / kaz_rec.sh / hedda_rec.sh / kugo_jobs.json（世界坐标换成路向坐标）。
# 测试场的靶子（路向坐标）：对面假人 (-4.5,-5.2)，己方假人 (-14,4.6)，对面小兵 foes[0..4] 在 (-6,2.2) (-5.4,-1.6) (-3.8,0.2) (-2.2,2.8) (-1.8,-2.4)。
# cam=u,v,距离,俯角,看向的高度,转角。普攻（A）、回城（B）、状态（S）、脚下圈（O 石板上、G 草地上）是这次新加的。
out=$1; hero=$2; only=${3:-all}
T=${0:A:h}/bfx_clip.mjs      # pn_clip.mjs 的拷贝，多了 SHOTS、BFX_EXTRA、DROP_FRAMES 三个开关（见文件开头）
mkdir -p $out/$hero
run() { local name=$1 cam=$2 job=$3; [[ $only == all || ",$only," == *",$name,"* ]] || return; node $T $out/$hero $hero "[$job]" 1280 720 "cam=$cam" 2>&1 | grep -v "^$" | tail -2; }
DUM='__actors.get(__dummy.id)'
FR='__actors.get(__arena.friend.id)'
# 近战普攻：站在假人前 4 米（走过去砍）；远程：7 米
AM='{"name":"A","js":"__me.attack(__dummy)","dur":2.2,"pre":"__tp(-8.6,-5.0); __me.face(__dummy.x,__dummy.z,true)"}'
AR='{"name":"A","js":"__me.attack(__dummy)","dur":2.2,"pre":"__tp(-11.4,-5.0); __me.face(__dummy.x,__dummy.z,true)"}'
# 回城：原地站着回（5 秒引导，只录前 2.6 秒和读条的样子）；状态：对面假人晕、减速、沉默一起挂上；脚下圈：自己、己方假人、对面假人都在画面里
RB='{"name":"B","js":"__me.recall()","dur":2.6,"pre":"__tp(-8,-1); __fc(-4.5,-5.2)"}'
RS='{"name":"S","js":"__dummy.stun=3; __dummy.slow=3; __dummy.slowK=0.4; __dummy.silence=3; __dummy.vuln=0.2; __dummy.vulnT=3","dur":1.0,"pre":"__tp(-8.6,-5.0); __me.face(__dummy.x,__dummy.z,true)"}'
RO='{"name":"O","js":"1","dur":0.4,"pre":"__tp(-9.2,-0.6); __fc(-4.5,-5.2)"}'
case $hero in
gorran)
  run A "-6.6,-5,11,56,1,45" "$AM"
  run Q "-7.2,-3,18,56,1,45" '{"name":"Q","key":"Q","dur":1.8,"pre":"const [x,z]=__W(-10,-1); __me.teleport(x,z); __me.face(__dummy.x,__dummy.z,true)"}'
  run W "-6.5,-1.2,17,56,1,45" '{"name":"W","key":"W","dur":4.4,"pre":"const [x,z]=__W(-8.5,-1); __me.teleport(x,z); const [fx,fz]=__W(-3,-1); __me.face(fx,fz,true)","after":"for (let i=0;i<7;i++) __api.after(0.45+i*0.3, ()=>__api.hit(__dummy, __sim.hero, 260, \"phys\"))"}'
  run E "-6.8,-0.5,17,56,1,45" '{"name":"E","key":"E","dur":6.2,"pre":"const [x,z]=__W(-9.5,-0.5); __me.teleport(x,z); const [fx,fz]=__W(-5,-0.5); __me.face(fx,fz,true)","aim":[-5,-0.5]}'
  run R "-6.5,-1,22,56,1,45" '{"name":"R","key":"R","dur":6.6,"pre":"const [x,z]=__W(-8,-1); __me.teleport(x,z); const [fx,fz]=__W(-3,-1); __me.face(fx,fz,true)"}'
  run B "-8,-1,11,56,1,45" "$RB"
  ;;
vero)
  run A "-8,-5,13,56,1,45" "$AR"
  run Q "-7.6,1.6,18,56,1,45" '{"name":"Q","key":"Q","dur":2.3,"pre":"const [x,z]=__W(-14,0.94); __me.teleport(x,z); const [fx,fz]=__W(-2.2,2.8); __me.face(fx,fz,true)","aim":[-2.2,2.8]}'
  run W "-9,-2.2,17,56,1,45" '{"name":"W","key":"W","dur":2.6,"pre":"const [x,z]=__W(-13.5,-0.5); __me.teleport(x,z); const [fx,fz]=__W(-6,-0.5); __me.face(fx,fz,true)","aim":[-6,-0.5],"after":"__api.after(0.62, ()=>__me.attack(__dummy))"}'
  run E "-8.2,-0.5,18,56,1,45" '{"name":"E","key":"E","dur":6.6,"pre":"const [x,z]=__W(-13,0); __me.teleport(x,z); const [fx,fz]=__W(-5,-0.5); __me.face(fx,fz,true)","aim":[-5,-0.5]}'
  run R "-7.5,0,19,56,1,45" '{"name":"R","key":"R","dur":4.4,"pre":"const [x,z]=__W(-13,0); __me.teleport(x,z); const [fx,fz]=__W(-4,0); __me.face(fx,fz,true)","aim":[-4,0]}'
  ;;
lan)
  run A "-6.6,-5,11,56,1,45" "$AM"
  run Q "-7.35,-3.68,13,50,0.8,90" '{"name":"Q","key":"Q","dur":1.5,"pre":"__me.teleport(-9.2,7.6); __me.face(__dummy.x,__dummy.z,true)"}'
  run W "-6.15,-3.89,11.5,50,0.8,90" '{"name":"W","dur":2.4,"pre":"__me.teleport(__dummy.x-0.4,__dummy.z+4.4); __me.face(__dummy.x,__dummy.z,true)","js":"__me.cast(\"W\"); __api.after(1.05, ()=>__me.attack(__dummy))"}'
  run R "-5.02,-0.35,16,55,0.8,0" '{"name":"R","key":"R","dur":3.7,"pre":"__me.teleport(-4.6,5.4); __me.face(-3.5,2.5,true)"}'
  run B "-8,-1,11,56,1,45" "$RB"
  run S "-6.2,-5,9,56,1,45" "$RS"
  run O "-9.6,0,21,56,1,45" "$RO"
  run G "-11.6,-2.4,11,56,1,45" '{"name":"G","js":"1","dur":0.4,"pre":"__tp(-12.2,-2.4); __fc(-4.5,-5.2)"}'      # 自己站在草地上（亮草地上的绿圈）
  ;;
torg)
  run A "-6.6,-5,11,56,1,45" "$AM"
  run Q "-5.66,0.57,12,50,0.8,90" '{"name":"Q","key":"Q","dur":1.7,"pre":"__me.teleport(-3.8,6.6); __me.face(-3.7,2.7,true)","aim":{"x":-3.7,"z":2.7}}'
  run W "-5.80,0.14,17,55,0.5,0" '{"name":"W","key":"W","dur":2.1,"pre":"__me.teleport(-4,4.3)"}'
  run R "-6.79,-0.28,19,55,0.5,0" '{"name":"R","key":"R","dur":4.9,"pre":"__me.teleport(-8.6,8.2); __me.face(-4,4,true)","aim":{"x":-4.3,"z":3.9}}'
  ;;
moko)
  run A "-8,-5,13,56,1,45" "$AR"
  run Q "-13.2,4.2,15,56,1,45&hide=brush" '{"name":"Q","key":"Q","dur":2.0,"pre":"const [x,z]=__W(-11,2); __me.teleport(x,z); __me.face(__arena.friend.x,__arena.friend.z,true)"}'
  run W "-13.6,4.2,12,56,1,45&hide=brush" '{"name":"W","key":"W","dur":4.6,"pre":"const [x,z]=__W(-11,2); __me.teleport(x,z); __me.face(__arena.friend.x,__arena.friend.z,true)"}'
  run E "-6.8,0.2,17,56,1,45" '{"name":"E","key":"E","dur":2.2,"pre":"const [x,z]=__W(-11.5,0.2); __me.teleport(x,z); const [fx,fz]=__W(-2,0.2); __me.face(fx,fz,true)","aim":[-2,0.2]}'
  run R "-5,0.5,24,58,1,45" '{"name":"R","key":"R","dur":6.5,"pre":"const [x,z]=__W(-5,0.5); __me.teleport(x,z)"}'
  ;;
osen)
  run A "-8,-5,13,56,1,45" "$AR"
  run Q "-7,0.2,15,56,1,45" '{"name":"Q","key":"Q","dur":1.6,"pre":"const [x,z]=__W(-11,0.2); __me.teleport(x,z); const [fx,fz]=__W(-3.8,0.2); __me.face(fx,fz,true)","aim":[-3.8,0.2]}'
  run W "-6.5,-0.7,15,56,1,45" '{"name":"W","key":"W","dur":3.6,"pre":"const [x,z]=__W(-11,-0.7); __me.teleport(x,z); const [fx,fz]=__W(-4.6,-0.7); __me.face(fx,fz,true)","aim":[-4.6,-0.7]}'
  run E "-6.5,0,16,56,1,45" '{"name":"E","key":"E","dur":5.0,"pre":"const [x,z]=__W(-11,0); __me.teleport(x,z); const [fx,fz]=__W(-4.4,0); __me.face(fx,fz,true)","aim":[-4.4,0]}'
  run R "-5.5,0.3,22,58,1,45" '{"name":"R","key":"R","dur":4.0,"pre":"const [x,z]=__W(-11,0); __me.teleport(x,z); const [fx,fz]=__W(-4,0.5); __me.face(fx,fz,true)","aim":[-4,0.5]}'
  ;;
seren)
  run A  "-8.6,-1.4,10.5,56,1,45" '{"name":"A","js":"__me.attack(__arena.foes[1])","dur":2.0,"pre":"__tp(-11.6,-1.2); __fc(-5.4,-1.6); __me.data.shots=0"}'
  run P  "-8.0,-1.4,12,56,1,45"   '{"name":"P","js":"__me.attack(__arena.foes[1])","dur":1.3,"pre":"__tp(-11.6,-0.8); __fc(-5.4,-1.6); __me.data.shots=3"}'
  run Q  "-8.6,-1.2,10.5,56,1,45" '{"name":"Q","js":"__me.cast(\"Q\"); __me.attack(__arena.foes[1])","dur":2.4,"pre":"__tp(-11.6,-1.2); __fc(-5.4,-1.6); __me.data.shots=0; __mv(__arena.foes[0],-4.7,-0.3)"}'
  run W  "-7.2,-1.4,9.5,56,0.8,45" '{"name":"W","key":"W","aim":[-5.4,-1.6],"dur":2.8,"pre":"__tp(-9.8,-1.0); __fc(-5.4,-1.6)"}'
  run E  "-8.6,-1.4,11,56,1,45"   '{"name":"E","key":"E","aim":[-5.4,-1.6],"dur":1.6,"pre":"__tp(-7.8,-1.4); __fc(-5.4,-1.6)"}'
  run R  "-7.6,-1.6,15,56,1,45"   '{"name":"R","key":"R","aim":[0,-1.9],"dur":2.2,"pre":"__tp(-13,-1.4); __mv(__dummy,-7.4,-1.6); __fc(0,-1.9)"}'
  ;;
ugo)
  run A "-6.2,1.1,12,50,0.8,90" '{"name":"A","js":"__me.attack(__arena.foes[1])","dur":1.8,"pre":"__me.teleport(-1.6,7.4); __me.face(-4.95,2.69,true)"}'
  run Q "-5.8,-0.71,15,50,0.8,90" '{"name":"Q","key":"Q","aim":[-4.5,-5.2],"dur":1.3,"pre":"__me.teleport(-2.2,7.4); __me.face(-6.86,-0.49,true)"}'
  run W "-7.28,-3.46,13,50,0.8,90" '{"name":"W","key":"W","aim":[-4.5,-5.2],"dur":2.2,"pre":"__me.teleport(-9.2,5.6); __me.face(-6.86,-0.49,true)"}'
  run E "-5.66,1.98,14,52,0.8,90" '{"name":"E","key":"E","aim":{"x":-3.6,"z":3.6},"dur":4.9,"pre":"__me.teleport(-1.0,8.6); __me.face(-3.6,3.6,true)"}'
  run R "-5.6,1.4,13.5,54,0.8,90" '{"name":"R","key":"R","aim":[-5.09,0],"dur":2.6,"pre":"__me.teleport(-1.0,8.6); __me.face(-3.6,3.6,true)"}'
  ;;
kaz)
  run A "-5.6,-4.2,13,56,1,45" '{"name":"A","js":"__me.attack(__dummy)","dur":2.4,"pre":"__tp(-7.4,-4.6); __me.face(__dummy.x,__dummy.z,true)"}'
  run Q "-8.2,-4.8,16,56,1,45" '{"name":"Q","key":"Q","dur":1.7,"pre":"__tp(-12.2,-4.6); __me.face(__dummy.x,__dummy.z,true)"}'
  run W "-5.4,-3.2,12,56,1,45" '{"name":"W","key":"W","dur":1.7,"pre":"__tp(-5.7,-3.4); __fc(-3.8,-1)"}'
  run E "-7.2,-3,15,56,1,45"   '{"name":"E","key":"E","aim":[-5,-3.4],"dur":2.0,"pre":"__tp(-9.6,-2.6); __fc(-5,-3.4)"}'
  run R "-8.2,-4.8,17,56,1,45" '{"name":"R","key":"R","dur":3.4,"pre":"__tp(-12.2,-4.6); __me.face(__dummy.x,__dummy.z,true)","after":"__api.after(1.4, ()=>__me.moveTo(__me.pos.x-2.5, __me.pos.z+2.5))"}'
  ;;
hedda)
  run A "-6.6,-0.6,11,56,1,45" '{"name":"A","js":"__me.attack(__arena.foes[1])","dur":2.4,"pre":"__tp(-8,-1.2); __me.face(__arena.foes[1].x,__arena.foes[1].z,true)"}'
  run Q "-8.6,-4.8,12.5,56,1,45" '{"name":"Q","key":"Q","dur":1.7,"pre":"__tp(-13,-4.4); __me.face(__dummy.x,__dummy.z,true)"}'
  run W "-7.6,-3.4,13.5,56,1,45" '{"name":"W","key":"W","dur":3.0,"pre":"__tp(-8.3,-4.4); __me.face(__dummy.x,__dummy.z,true)","after":"__api.after(0.95, ()=>{ const [x,z]=__W(-11.5,0.5); __me.moveTo(x,z); })"}'
  run E "-10,0.2,14,56,1,45" '{"name":"E","key":"E","dur":2.4,"pre":"const [fx,fz]=__W(-8,2.5); '"$FR"'.teleport(fx,fz); __tp(-12.5,-2.6); __me.face(fx,fz,true); __mv(__arena.foes[0],-10.3,2.4); const [dx,dz]=__W(-8.1,-0.5); '"$DUM"'.teleport(dx,dz)"}'
  run R "-7,-0.6,19,56,1,45" '{"name":"R","key":"R","dur":5.6,"aim":[-4.4,0],"pre":"__tp(-11.6,-0.6); const [dx,dz]=__W(-4.4,-1.4); '"$DUM"'.teleport(dx,dz); __me.face(dx,dz,true)"}'
  run P "-6.5,-4,14,56,1,45" '{"name":"P","key":"W","dur":2.6,"pre":"__tp(-8.5,-4.4); __me.face(__dummy.x,__dummy.z,true); const [fx,fz]=__W(-6,-7.6); '"$FR"'.teleport(fx,fz)","after":"__api.after(1.0, ()=>'"$FR"'.attack(__dummy))"}'
  ;;
esac
