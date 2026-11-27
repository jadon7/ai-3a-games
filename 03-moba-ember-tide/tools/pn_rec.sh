#!/bin/zsh
# 第九轮 polish-new：四个新英雄（塞伦、乌戈、卡兹、赫达）改动的技能的固定机位录像。改前用主目录 5190（phase9），改后用自己的 5218，同一份摆位和机位。
# 用法: MOBA_URL=http://localhost:5218/map.html zsh tools/pn_rec.sh <输出目录> <英雄> [只录哪几个，比如 A,Q]
#   输出 <输出目录>/<英雄>/<技能>/f_000.jpg …（30 帧一秒、对局时间匀速）和 <输出目录>/<英雄>/<技能>.mp4
# 测试场的靶子（路向坐标）：对面假人 (-4.5,-5.2)，己方假人 (-14,4.6)，对面小兵 foes[0..4] 在 (-6,2.2) (-5.4,-1.6) (-3.8,0.2) (-2.2,2.8) (-1.8,-2.4)。
# cam=u,v,距离,俯角,看向的高度,转角；转角 45 让技能从左往右放，90 是乌戈第三批录的机位（照抄，前后好比）。
# 塞伦、卡兹、赫达的摆位照各自第三批的录像脚本（seren_jobs.json、kaz_rec.sh、hedda_rec.sh），塞伦的普攻和 Q 把人挪近到 6 米、镜头拉近（原来一道细线在 16 米宽的画面里只有几个像素）。
out=$1; hero=$2; only=${3:-all}
T=${0:A:h}/pn_clip.mjs
mkdir -p $out/$hero
run() { local name=$1 cam=$2 job=$3; [[ $only == all || ",$only," == *",$name,"* ]] || return; node $T $out/$hero $hero "[$job]" 1280 720 "cam=$cam" 2>&1 | grep -v "^$" | tail -2; }
DUM='__actors.get(__dummy.id)'
case $hero in
seren)
  run A  "-8.6,-1.4,10.5,56,1,45" '{"name":"A","js":"__me.attack(__arena.foes[1])","dur":2.0,"pre":"__tp(-11.6,-1.2); __fc(-5.4,-1.6); __me.data.shots=0"}'
  run P  "-8.0,-1.4,12,56,1,45"   '{"name":"P","js":"__me.attack(__arena.foes[1])","dur":1.3,"pre":"__tp(-11.6,-0.8); __fc(-5.4,-1.6); __me.data.shots=3"}'
  run Q  "-8.6,-1.2,10.5,56,1,45" '{"name":"Q","js":"__me.cast(\"Q\"); __me.attack(__arena.foes[1])","dur":2.4,"pre":"__tp(-11.6,-1.2); __fc(-5.4,-1.6); __me.data.shots=0; __mv(__arena.foes[0],-4.7,-0.3)"}'
  run W2 "-8.4,-0.6,8.5,56,0.6,45" '{"name":"W2","key":"W","aim":[-7.6,-0.4],"dur":2.0,"pre":"__tp(-10.6,0.2); __fc(-7.6,-0.4)"}'
  run W  "-7.2,-1.4,9.5,56,0.8,45" '{"name":"W","key":"W","aim":[-5.4,-1.6],"dur":2.8,"pre":"__tp(-9.8,-1.0); __fc(-5.4,-1.6)"}'
  run E  "-8.6,-1.4,11,56,1,45"   '{"name":"E","key":"E","aim":[-5.4,-1.6],"dur":1.6,"pre":"__tp(-7.8,-1.4); __fc(-5.4,-1.6)"}'
  run R  "-7.6,-1.6,15,56,1,45"   '{"name":"R","key":"R","aim":[0,-1.9],"dur":2.2,"pre":"__tp(-13,-1.4); __mv(__dummy,-7.4,-1.6); __fc(0,-1.9)"}'
  run Rc "-12.0,-1.4,7,56,1.4,45" '{"name":"Rc","key":"R","aim":[0,-1.9],"dur":1.1,"pre":"__tp(-13,-1.4); __mv(__dummy,-7.4,-1.6); __fc(0,-1.9)"}'
  # 游戏的默认镜头（距离 27、俯角 56）：普攻和压满在真正打的时候看得见看不见
  run A27 "-8.6,-1.4,27,56,1,45"  '{"name":"A27","js":"__me.attack(__arena.foes[1])","dur":2.0,"pre":"__tp(-11.6,-1.2); __fc(-5.4,-1.6); __me.data.shots=0"}'
  run Q27 "-8.6,-1.2,27,56,1,45"  '{"name":"Q27","js":"__me.cast(\"Q\"); __me.attack(__arena.foes[1])","dur":2.4,"pre":"__tp(-11.6,-1.2); __fc(-5.4,-1.6); __me.data.shots=0; __mv(__arena.foes[0],-4.7,-0.3)"}'
  ;;
ugo)
  run R "-5.6,1.4,13.5,54,0.8,90" '{"name":"R","key":"R","aim":[-5.09,0],"dur":2.6,"pre":"__me.teleport(-1.0,8.6); __me.face(-3.6,3.6,true)"}'
  run Q "-5.8,-0.71,15,50,0.8,90" '{"name":"Q","key":"Q","aim":[-4.5,-5.2],"dur":1.3,"pre":"__me.teleport(-2.2,7.4); __me.face(-6.86,-0.49,true)"}'
  run W "-7.28,-3.46,13,50,0.8,90" '{"name":"W","key":"W","aim":[-4.5,-5.2],"dur":2.2,"pre":"__me.teleport(-9.2,5.6); __me.face(-6.86,-0.49,true)"}'
  ;;
kaz)
  run Q "-8.2,-4.8,16,56,1,45" '{"name":"Q","key":"Q","dur":1.7,"pre":"__tp(-12.2,-4.6); __me.face(__dummy.x,__dummy.z,true)"}'
  run W "-5.4,-3.2,12,56,1,45" '{"name":"W","key":"W","dur":1.7,"pre":"__tp(-5.7,-3.4); __fc(-3.8,-1)"}'
  run E "-7.2,-3,15,56,1,45"   '{"name":"E","key":"E","aim":[-5,-3.4],"dur":2.0,"pre":"__tp(-9.6,-2.6); __fc(-5,-3.4)"}'
  run R "-8.2,-4.8,17,56,1,45" '{"name":"R","key":"R","dur":3.4,"pre":"__tp(-12.2,-4.6); __me.face(__dummy.x,__dummy.z,true)","after":"__api.after(1.4, ()=>__me.moveTo(__me.pos.x-2.5, __me.pos.z+2.5))"}'
  ;;
hedda)
  run R  "-7,-0.6,19,56,1,45"        '{"name":"R","key":"R","dur":5.6,"aim":[-4.4,0],"pre":"__tp(-11.6,-0.6); const [dx,dz]=__W(-4.4,-1.4); '"$DUM"'.teleport(dx,dz); __me.face(dx,dz,true)"}'
  run Rw "-11.2,-0.6,7.5,56,1.6,45" '{"name":"Rw","key":"R","dur":1.1,"aim":[-4.4,0],"pre":"__tp(-11.6,-0.6); const [dx,dz]=__W(-4.4,-1.4); '"$DUM"'.teleport(dx,dz); __me.face(dx,dz,true)"}'
  run Rl "-5,-0.6,11,56,1,45"        '{"name":"Rl","key":"R","dur":4.8,"aim":[-4.4,0],"pre":"__tp(-11.6,-0.6); const [dx,dz]=__W(-4.4,-1.4); '"$DUM"'.teleport(dx,dz); __me.face(dx,dz,true)"}'
  run P  "-6.5,-4,14,56,1,45"        '{"name":"P","key":"W","dur":2.6,"pre":"__tp(-8.5,-4.4); __me.face(__dummy.x,__dummy.z,true); const [fx,fz]=__W(-6,-7.6); __actors.get(__arena.friend.id).teleport(fx,fz)","after":"__api.after(1.0, ()=>__actors.get(__arena.friend.id).attack(__dummy))"}'
  run P19 "-6.5,-4,19,56,1,45"        '{"name":"P19","key":"W","dur":2.6,"pre":"__tp(-8.5,-4.4); __me.face(__dummy.x,__dummy.z,true); const [fx,fz]=__W(-6,-7.6); __actors.get(__arena.friend.id).teleport(fx,fz)","after":"__api.after(1.0, ()=>__actors.get(__arena.friend.id).attack(__dummy))"}'      # 血条只在镜头距离 15 以外才画：远一点看烙印和血条的关系
  ;;
esac
