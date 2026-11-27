#!/bin/zsh
# 录伊缇的技能（第四阶段 iti-kit，照 k-kaz 的 kaz_rec.sh；录像工具就是 kaz_clip.mjs：按对局时间一帧一帧截，拼成真实时间 30 帧的 mp4）。
# 用法: MOBA_URL=... zsh tools/iti_rec.sh <输出目录> [只录哪几个，比如 Q,R]
# 测试场里假人（托尔格）在路向坐标 (-4.5,-5.2)，五个小兵在 (-6,2.2) (-5.4,-1.6) (-3.8,0.2) (-2.2,2.8) (-1.8,-2.4)。cam= 是路向坐标、距离、俯角、看的高度、转角。
# __chain([[键, 目标函数], …])：一个接一个放，前一个放完、这个能放了就放（多段的 Q 用它连着按）；目标函数返回 {x,z}（指向技能返回单位）。
out=$1; only=${2:-all}
T=${0:a:h}/kaz_clip.mjs
CH='window.__chain=(list)=>{let i=0;__api.run(8,()=>{if(i>=list.length)return;const [k,f]=list[i];if(__me.canCast(k)){const t=f();__me.cast(k,{x:t.x,z:t.z},__me.skill(k).target?t:null);i++;}});};'
MID='(()=>{const f=__arena.foes,d=__dummy,all=[...f,d];return{x:all.reduce((s,e)=>s+e.x,0)/all.length,z:all.reduce((s,e)=>s+e.z,0)/all.length};})()'
run() { local name=$1 cam=$2 job=$3; [[ $only == all || ",$only," == *",$name,"* ]] || return; node $T $out iti "[$job]" 1280 720 "cam=$cam" 2>&1 | grep -v "^$" | grep -v "假人" | tail -2; }
run A  "-5.6,-4.2,15,56,1,45" '{"name":"A","js":"__me.attack(__dummy)","dur":3.0,"pre":"const [x,z]=__W(-7.4,-4.6); __me.teleport(x,z); __me.face(__dummy.x,__dummy.z,true)"}'
run Q  "-9.0,-4.6,24,56,1,45" '{"name":"Q","js":"__chain([[\"Q\",()=>__dummy],[\"Q\",()=>__dummy],[\"Q\",()=>__dummy]])","dur":3.0,"pre":"'$CH' const [x,z]=__W(-13.5,-4.6); __me.teleport(x,z); __me.face(__dummy.x,__dummy.z,true)"}'
run W  "-6.4,-2.4,24,56,1,45" '{"name":"W","js":"__me.cast(\"W\",__W2(-1.4,0.6)); __api.after(1.3,()=>__me.cast(\"W\"))","dur":2.6,"pre":"'$CH' window.__W2=(u,v)=>{const [x,z]=__W(u,v);return {x,z};}; const [x,z]=__W(-9.6,-3.2); __me.teleport(x,z); const [fx,fz]=__W(-1.4,0.6); __me.face(fx,fz,true)"}'
run Wauto "-6.4,-2.4,24,56,1,45" '{"name":"Wauto","js":"__me.cast(\"W\",__W2(-13,-9))","dur":5.8,"pre":"window.__W2=(u,v)=>{const [x,z]=__W(u,v);return {x,z};}; const [x,z]=__W(-6.4,-2.2); __me.teleport(x,z); const [fx,fz]=__W(-13,-9); __me.face(fx,fz,true)"}'
run E  "-7.2,-4.6,18,56,1,45" '{"name":"E","key":"E","dur":1.8,"pre":"const [x,z]=__W(-13,-4.2); __me.teleport(x,z); __me.face(__dummy.x,__dummy.z,true)"}'
run R  "-5.0,-2.0,34,58,1,45" '{"name":"R","js":"__me.cast(\"R\",'$MID')","dur":2.6,"pre":"const [x,z]=__W(-14,-6); __me.teleport(x,z); __me.face(__dummy.x,__dummy.z,true)"}'
run combo "-7.0,-3.4,30,56,1,45" '{"name":"combo","js":"__chain([[\"E\",()=>__dummy],[\"Q\",()=>__dummy],[\"Q\",()=>__dummy],[\"Q\",()=>__dummy],[\"R\",()=>__dummy]])","dur":4.6,"pre":"'$CH' __dummy.h.level=11; __sim.recalc(__dummy); __dummy.hp=__dummy.max; const [x,z]=__W(-13.5,-4.6); __me.teleport(x,z); __me.face(__dummy.x,__dummy.z,true)"}'
