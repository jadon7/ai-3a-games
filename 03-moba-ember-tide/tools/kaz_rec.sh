#!/bin/zsh
# 录卡兹的技能（第九轮 k-kaz）。用法: zsh tools/kaz_rec.sh <输出目录> [只录哪几个，比如 Q,R]
# 测试场里假人在路向坐标 (-4.5,-5.2)，五个小兵在 (-6,2.2) (-5.4,-1.6) (-3.8,0.2) (-2.2,2.8) (-1.8,-2.4)。cam= 是路向坐标，转角 45 度让技能从左往右放。
# 系统的 ffmpeg 现在缺 libx265.216（Homebrew 的 x265 升到了 4.3）：kaz_clip.mjs 调 ffmpeg 时把 DYLD_LIBRARY_PATH 指回 x265 4.2 的库。
out=$1; only=${2:-all}
T=${0:a:h}/kaz_clip.mjs
LV='for (let i=0;i<15;i++) __sim.gainXp(__sim.hero,2000);'
run() { local name=$1 cam=$2 job=$3; [[ $only == all || ",$only," == *",$name,"* ]] || return; node $T $out kaz "[$job]" 1280 720 "cam=$cam" 2>&1 | grep -v "^$" | grep -v "假人" | tail -2; }
run A "-5.6,-4.2,13,56,1,45" '{"name":"A","js":"__me.attack(__dummy)","dur":3.6,"pre":"'$LV' const [x,z]=__W(-7.4,-4.6); __me.teleport(x,z); __me.face(__dummy.x,__dummy.z,true)"}'
run Q "-8.2,-4.8,16,56,1,45" '{"name":"Q","key":"Q","dur":1.7,"pre":"'$LV' const [x,z]=__W(-12.2,-4.6); __me.teleport(x,z); __me.face(__dummy.x,__dummy.z,true)"}'
run W "-5.4,-3.2,13,56,1,45" '{"name":"W","key":"W","dur":1.7,"pre":"'$LV' const [x,z]=__W(-5.7,-3.4); __me.teleport(x,z); const [fx,fz]=__W(-3.8,-1); __me.face(fx,fz,true)"}'
run E "-7.2,-3,15,56,1,45" '{"name":"E","key":"E","dur":2.0,"aim":[-5,-3.4],"pre":"'$LV' const [x,z]=__W(-9.6,-2.6); __me.teleport(x,z); const [fx,fz]=__W(-5,-3.4); __me.face(fx,fz,true)"}'
run R "-8.2,-4.8,17,56,1,45" '{"name":"R","key":"R","dur":3.4,"pre":"'$LV' const [x,z]=__W(-12.2,-4.6); __me.teleport(x,z); __me.face(__dummy.x,__dummy.z,true)","after":"__api.after(1.4, ()=>__me.moveTo(__me.pos.x-2.5, __me.pos.z+2.5))"}'
run Rkill "-6.4,-4.8,15,56,1,45" '{"name":"Rkill","key":"R","dur":2.6,"pre":"'$LV' const [x,z]=__W(-12.2,-4.6); __me.teleport(x,z); __me.face(__dummy.x,__dummy.z,true); __me.setCd(\"Q\",6); __me.setCd(\"W\",4); __sim.hero.hp=__sim.hero.max*0.45","after":"__api.after(1.2, ()=>__sim.damage(__dummy, 99999, __sim.hero, {type:\"true\"}))"}'
