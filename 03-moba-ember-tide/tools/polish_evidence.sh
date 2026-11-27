#!/bin/zsh
# 第九轮 polish-lib 的改前改后取证：同一份任务，改前对着主目录 5190（phase9）跑，改后对着自己的端口跑。
# 用法: zsh tools/polish_evidence.sh <输出目录> <网址，比如 http://localhost:5190/map.html> [只跑哪几段，逗号分开]
#   段：R（赫达大招：伤害数字、眩晕、闪白）board（六种状态摆一排）flash（钳钩、普攻和直接扣血打英雄的闪白：flashT 没有别的特效，只看闪白本身）hit（远程、近战普攻的命中）
#       shield（摩珂的水泡和通用护盾）fog（迷雾里对面放技能）names（十个英雄挤在一起的头顶名字）ui（选人、载入、结算）
# 测试场里自己站在路向 (-13,0)、面朝 +u；对面假人 (-4.5,-5.2)，己方假人 (-14,4.6)，对面五个小兵在 (-6..-1.8, -2.4..2.8)。
# 名册顺序 torg gorran lan …：自己不是托尔格时对面假人是托尔格；自己是托尔格时对面假人是葛隆。
out=$1; url=$2; only=${3:-all}
T=${0:A:h}/polish_clip.mjs
want() { [[ $only == all || ",$only," == *",$1,"* ]]; }
run() { MOBA_URL=$url node $T "$@" 2>&1 | grep -v "^$" | tail -2; }
mkdir -p $out
DUM='__actors.get(__dummy.id)'; FR='__actors.get(__friend.id)'
if want R; then run $out hedda '[{"name":"R","key":"R","dur":2.6,"aim":[-4.4,0],"pre":"const [x,z]=__W(-11.6,-0.6); __me.teleport(x,z); const [dx,dz]=__W(-4.4,-1.4); '"$DUM"'.teleport(dx,dz); __me.face(dx,dz,true)"}]' 1280 720 "cam=-4.8,-0.8,13,56,1,45"; fi
if want board; then run $out hedda '[{"name":"board","still":true,"wait":1.0,"pre":"const F=__arena.foes; F[0].stun=8; F[1].root=8; F[2].slow=8; F[2].slowK=0.4; F[3].silence=8; F[4].vulnT=8; F[4].vuln=0.2; __dummy.stun=8; const [fx,fz]=__W(-7.4,-3.8); '"$FR"'.teleport(fx,fz); const [dx,dz]=__W(-3.4,-3.9); '"$DUM"'.teleport(dx,dz); __friend.shield=400; __friend.shieldT=8; const [mx,mz]=__W(-12,1); __me.teleport(mx,mz)"}]' 1280 720 "cam=-4.7,-0.8,15,56,1,45"; fi
if want flash; then run $out hedda '[{"name":"flashQ","key":"Q","dur":1.7,"pre":"const [x,z]=__W(-13,-4.4); __me.teleport(x,z); __me.face(__dummy.x,__dummy.z,true)"}]' 1280 720 "cam=-9,-4.7,11,56,1.2,45"
  run $out hedda '[{"name":"flashT","js":"__api.hit(__sim.hero, __dummy, 250, \"phys\"); __api.after(1.0, ()=>__api.hit(__sim.hero, __dummy, 900, \"magic\", true))","dur":1.6,"pre":"const [x,z]=__W(-12,-1); __me.teleport(x,z)"}]' 1280 720 "cam=-4.5,-5.2,7,56,1.3,45"
  run $out hedda '[{"name":"flashA","js":"__me.attack(__dummy)","dur":2.6,"pre":"const [x,z]=__W(-7.2,-4.8); __me.teleport(x,z); __me.face(__dummy.x,__dummy.z,true)"}]' 1280 720 "cam=-5.9,-5,10,56,1.2,45"; fi
if want hit; then
  run $out vero '[{"name":"hit_ranged","js":"__me.attack(__arena.foes[1]); __arena.foes[1].hp=1e5","dur":2.6,"pre":"const [x,z]=__W(-10.4,-1.6); __me.teleport(x,z); __me.face(__arena.foes[1].x,__arena.foes[1].z,true)"}]' 1280 720 "cam=-6.6,-1.5,8,56,0.8,45"
  run $out lan '[{"name":"hit_melee","js":"__me.attack(__arena.foes[1]); __arena.foes[1].hp=1e5","dur":2.6,"pre":"const [x,z]=__W(-7.4,-1.6); __me.teleport(x,z); __me.face(__arena.foes[1].x,__arena.foes[1].z,true)"}]' 1280 720 "cam=-6.2,-1.5,7.5,56,0.8,45"; fi
if want shield; then run $out moko '[{"name":"shield","key":"W","dur":2.4,"pre":"const [x,z]=__W(-11.6,2.2); __me.teleport(x,z); __me.face(__friend.x,__friend.z,true)"}]' 1280 720 "cam=-13.2,3.9,9,56,1.3,45"; fi
if want fog; then run $out torg '[{"name":"fog","js":"const g='"$DUM"'; const [x,z]=__W(7,0.5); g.cast(\"E\", {x,z}, null); __api.after(0.9, ()=>{ const [a,b]=__W(1,0); g.face(a,b,true); g.cast(\"W\", {x:a,z:b}, null); }); __api.after(1.6, ()=>{ const [a,b]=__W(-1,0); __me.moveTo(a,b); })","dur":5.0,"pre":"const [dx,dz]=__nav.nearest(...__W(9,0.5)); '"$DUM"'.teleport(dx,dz); const [x,z]=__W(-13,0); __me.teleport(x,z)"}]' 1280 720 "cam=0,0,28,58,0,45"; fi
if want names; then POLISH_Q="h=lan&auto=1&nohud=1&a=torg,lan,ugo,seren,moko&b=gorran,kaz,osen,vero,hedda" run $out lan '[{"name":"names","still":true,"wait":0,"hold":1800,"pre":"const hs=[...__actors.values()].sort((p,q)=>p.ent.team-q.ent.team||(p.kit.id<q.kit.id?-1:1)); const [cx,cz]=__W(-2,0); hs.forEach((a,i)=>{ const ang=i*2.39996, r=0.5+Math.sqrt(i)*1.0; const [x,z]=__nav.nearest(cx+Math.cos(ang)*r, cz+Math.sin(ang)*r); a.teleport(x,z); }); for (const e of __sim.ents) if (e.kind===\"hero\") e.seen=true; __setSpeed(0)"}]' 1280 720 "cam=-2,0,24,56,0,0"; fi
if want ui; then MOBA_URL=$url node ${0:A:h}/ui_shots.mjs $out/ui 1280 720 "" pick,load,result 2>&1 | tail -2; fi
