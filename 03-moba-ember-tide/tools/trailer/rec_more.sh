#!/bin/zsh
# 第二批素材：专门等某一种戏（打野、Boss 残血、拆塔、兵线相撞）出现再录，比长时间观战里去翻省事。
# 用法: [FORCE=1] zsh tools/trailer/rec_more.sh [只录名字里带这个词的]
# 和 rec_all.sh 一样：一段一段录，已经录好的不重录。
cd "$(dirname "$0")/../.."
R=docs/trailer/raw; mkdir -p $R; only=${1:-}
cap() { local name=$1; shift; [[ -n $only && $name != *$only* ]] && return; [[ -z $FORCE && -f $R/$name.mp4 ]] && return; echo "== $name"; node tools/trailer/cap.mjs $R/$name.mp4 "$@" 2>&1 | grep -v "帧" | cut -c1-400; }
LOG='[Math.round(__sim.time*10)/10, __sim.kills[0]+__sim.kills[1], __director.focus(), __sim.towersLeft(0)+__sim.towersLeft(1)]'
D="director=1&h=lan&nohud=1&cam=0,0,0,46"
ZP='const __o=__director.update; __director.update=dt=>{const s=__o(dt); s.dist*=0.72; return s;}; 1'
# 导播正在看的营地 / 建筑
CAMP='(()=>{const f=__director.focus(); if(!f.startsWith(`camp`)) return null; return __sim.camps.find(c=>c.id==+f.slice(4))||null})()'
SIEGE='(()=>{const f=__director.focus(); if(!f.startsWith(`siege`)) return null; return __sim.ents.find(e=>e.id==+f.slice(5))||null})()'

# 打野：原来想等导播看小野怪营地（j_camp），十五分钟都等不到，放弃；改成 rec_three.sh 里的 j_boar
# Boss：导播在看 Boss，而且 Boss 只剩三成血（多半能录到它倒下的慢放）
cap b_beast "$D" "{\"cond\":\"(c=>c&&c.kind==='boss'&&c.mob==='beast'&&c.mobs[0].alive&&c.mobs[0].hp<c.mobs[0].max*0.3)($CAMP)\",\"sec\":10,\"pre\":\"$ZP\",\"log\":\"$LOG\"}"
cap b_troll "$D" "{\"cond\":\"(c=>c&&c.kind==='boss'&&c.mob==='troll'&&c.mobs[0].alive&&c.mobs[0].hp<c.mobs[0].max*0.3)($CAMP)\",\"sec\":10,\"pre\":\"$ZP\",\"log\":\"$LOG\"}"
# 拆塔：导播在看一座塔挨打，塔只剩两成血
cap t_tower "$D" "{\"cond\":\"(e=>e&&e.kind==='tower'&&e.alive&&e.hp<e.max*0.2)($SIEGE)\",\"sec\":7,\"pre\":\"$ZP\",\"log\":\"$LOG\"}"
# 兵线相撞：第三波兵在中路接上的时候，镜头沿着中路匀速往前推（自己接管导播的镜头：位置线性移动，距离和朝向不变）
CLASH='__sim.time>62 && __sim.ents.some(a=>a.alive&&a.team===0&&a.kind===`melee`&&a.lane===0&&__sim.ents.some(b=>b.alive&&b.team===1&&b.kind===`melee`&&b.lane===0&&Math.hypot(a.x-b.x,a.z-b.z)<4))'
LANE='(()=>{const ms=__sim.ents.filter(e=>e.alive&&e.lane===0&&(e.kind===`melee`||e.kind===`ranged`)); let b=null; for(const a of ms){const n=ms.filter(o=>o.team!==a.team&&Math.hypot(a.x-o.x,a.z-o.z)<7).length; if(!b||n>b.n) b={n,x:a.x,z:a.z};} const c=b||{x:0,z:0}; let T=0; __director.update=dt=>{T+=dt; return {x:c.x-2.5+T*0.9, z:c.z+2.5-T*0.9, dist:21, yaw:0.55, slow:1};}; return 1})()'
cap l_clash "$D" "{\"cond\":\"$CLASH\",\"sec\":6,\"pre\":\"$LANE\",\"log\":\"$LOG\"}"
# 敌方水晶的空镜（第一版那条前景被树挡了）
cap e_coreE2 "cam=88,0,32,32,4,250&nohud=1&hero=0" '{"sec":5,"hold":["KeyE"],"holdFrac":0.05}'
# 水晶爆掉：第一版（rec_all 的 h_end）等到四成血开录，三十秒内没打下来；这里等到一成血再录
cap h_end2 "$D" "{\"cond\":\"__sim.ents.some(e=>e.kind==='core'&&e.alive&&e.hp<e.max*0.1)\",\"sec\":14,\"pre\":\"$ZP\",\"log\":\"[__sim.time, __sim.over, __sim.ents.filter(e=>e.kind==='core').map(e=>Math.round(e.hp))]\"}"
# 第二版：h_end2 开录的那一刻水晶就碎了，而且导播镜头不在水晶上（网址带了 cam= 以后，游戏不会把镜头自动移到碎掉的水晶上）。
# 这里自己接管镜头：一直对着血最少的那座水晶，距离 24，朝向每秒匀速转 0.05 弧度；等到水晶剩一成五血再录。
CORE='(()=>{const c=__sim.ents.filter(e=>e.kind===`core`).sort((a,b)=>a.hp/a.max-b.hp/b.max)[0]; let T=0; __director.update=dt=>{T+=dt; return {x:c.x, z:c.z, dist:24, yaw:(c.team?4.36:0.52)+T*0.05, slow:1};}; return 1})()'
cap h_end3 "$D" "{\"cond\":\"__sim.ents.some(e=>e.kind==='core'&&e.alive&&e.hp<e.max*0.15)\",\"sec\":16,\"pre\":\"$CORE\",\"log\":\"[__sim.time, __sim.over, __sim.ents.filter(e=>e.kind==='core').map(e=>Math.round(e.hp))]\"}"
# 第三版：水晶碎掉在游戏里是一帧之内消失（只有一圈碎屑和冲击环），分出胜负以后整局定格。
# 所以这里拍它碎之前挨打的几秒：等到剩两成血，镜头拉远到 30 米把整座水晶装进画面，对局放慢到半速（逐帧录，慢放也是平滑的）
CORE2='(()=>{const c=__sim.ents.filter(e=>e.kind===`core`).sort((a,b)=>a.hp/a.max-b.hp/b.max)[0]; let T=0; __director.update=dt=>{T+=dt; return {x:c.x, z:c.z, dist:30, yaw:(c.team?4.36:0.52)+T*0.05, slow:1};}; return 1})()'
cap h_end4 "$D" "{\"cond\":\"__sim.ents.some(e=>e.kind==='core'&&e.alive&&e.hp<e.max*0.2)\",\"sec\":7,\"speed\":0.5,\"pre\":\"$CORE2\",\"log\":\"[__sim.time, __sim.over, __sim.ents.filter(e=>e.kind==='core').map(e=>Math.round(e.hp))]\"}"
# 第四版：h_end4 镜头看的是地面，水晶上半截出了画面，打水晶的人也在画面外。
# 改成：网址的 cam= 第五个数把镜头看的点抬到离地 4 米（导播只改水平位置，高度留着）；俯角 40°、距离 34；
# 看的点往地图中心挪 5 米，镜头从侧面（和进攻方向垂直）看过去，进攻的人从画面一侧进来
CORE3='(()=>{const c=__sim.ents.filter(e=>e.kind===`core`).sort((a,b)=>a.hp/a.max-b.hp/b.max)[0], l=Math.hypot(c.x,c.z), ux=-c.x/l, uz=-c.z/l; let T=0; __director.update=dt=>{T+=dt; return {x:c.x+ux*5, z:c.z+uz*5, dist:34, yaw:(c.team?3.93:0.785)+T*0.04, slow:1};}; return 1})()'
cap h_end5 "director=1&h=lan&nohud=1&cam=0,0,0,40,4" "{\"cond\":\"__sim.ents.some(e=>e.kind==='core'&&e.alive&&e.hp<e.max*0.25)\",\"sec\":8,\"speed\":0.5,\"pre\":\"$CORE3\",\"log\":\"[__sim.time, __sim.over, __sim.ents.filter(e=>e.kind==='core').map(e=>Math.round(e.hp))]\"}"
# 第五版：h_end5 在 16 倍速快进里等条件，等到的时候水晶已经碎了。改成先快进到四成五血，再按正常速度等到一成五血，然后半速开录
cap h_end6 "director=1&h=lan&nohud=1&cam=0,0,0,40,4" "{\"cond\":\"__sim.ents.some(e=>e.kind==='core'&&e.alive&&e.hp<e.max*0.45)\",\"cond2\":\"__sim.ents.some(e=>e.kind==='core'&&e.alive&&e.hp<e.max*0.15)\",\"sec\":7,\"speed\":0.5,\"pre\":\"$CORE3\",\"log\":\"[__sim.time, __sim.over, __sim.ents.filter(e=>e.kind==='core').map(e=>Math.round(e.hp))]\"}"

# ---- 2026-11-19 游戏加了塔和水晶被拆时的爆炸（约 1.2 秒），重录这两镜 ----
# 水晶：和 h_end6 一样的录法（四成五血快进、一成五血按正常速度等、半速开录、镜头锁在水晶上），录长一点，把爆炸整个留下
cap h_end7 "director=1&h=lan&nohud=1&cam=0,0,0,40,4" "{\"cond\":\"__sim.ents.some(e=>e.kind==='core'&&e.alive&&e.hp<e.max*0.45)\",\"cond2\":\"__sim.ents.some(e=>e.kind==='core'&&e.alive&&e.hp<e.max*0.15)\",\"sec\":7,\"speed\":0.5,\"pre\":\"$CORE3\",\"log\":\"[__sim.time, __sim.over, __sim.ents.filter(e=>e.kind==='core').map(e=>Math.round(e.hp))]\"}"
# 推塔：先快进到有一座正在挨打的塔剩四成血，再按正常速度等到一成血，镜头锁在这座塔上（从地图中心那一侧斜着看过去），六成速开录
TOWER='(()=>{const t=__sim.ents.filter(e=>e.kind===`tower`&&e.alive&&__sim.time-e.hurtAt<2).sort((a,b)=>a.hp/a.max-b.hp/b.max)[0]; window.__tw=t; const y0=Math.atan2(-t.x,-t.z)+0.5; let T=0; __director.update=dt=>{T+=dt; return {x:t.x, z:t.z, dist:26, yaw:y0+T*0.04, slow:1};}; return 1})()'
HURT='__sim.ents.some(e=>e.kind===`tower`&&e.alive&&__sim.time-e.hurtAt<1.5&&e.hp<e.max*'
cap t_tower2 "director=1&h=lan&nohud=1&cam=0,0,0,44,3" "{\"cond\":\"__sim.time>200&&${HURT}0.4)\",\"cond2\":\"${HURT}0.1)\",\"sec\":5,\"speed\":0.6,\"pre\":\"$TOWER\",\"log\":\"[__sim.time, __tw&&__tw.alive, __tw&&Math.round(__tw.hp)]\"}"
# h_end7 开录以后进攻方撤了，水晶停在 139 血没碎。h_end8 等到剩 6% 血再录，录 9 秒（半速）
cap h_end8 "director=1&h=lan&nohud=1&cam=0,0,0,40,4" "{\"cond\":\"__sim.ents.some(e=>e.kind==='core'&&e.alive&&e.hp<e.max*0.45)\",\"cond2\":\"__sim.ents.some(e=>e.kind==='core'&&e.alive&&e.hp<e.max*0.06)\",\"sec\":9,\"speed\":0.5,\"pre\":\"$CORE3\",\"log\":\"[__sim.time, __sim.over, __sim.ents.filter(e=>e.kind==='core').map(e=>Math.round(e.hp))]\"}"
# h_end9：只等烬誓庭（team 1）的水晶，和前面推塔那一镜（沉月会拆烬誓庭的塔）对得上；剩一成血开录，半速 9 秒
cap h_end9 "director=1&h=lan&nohud=1&cam=0,0,0,40,4" "{\"timeout\":700000,\"cond\":\"__sim.ents.some(e=>e.kind==='core'&&e.team===1&&e.alive&&e.hp<e.max*0.45)\",\"cond2\":\"__sim.ents.some(e=>e.kind==='core'&&e.team===1&&e.alive&&e.hp<e.max*0.1)\",\"sec\":9,\"speed\":0.5,\"pre\":\"$CORE3\",\"log\":\"[__sim.time, __sim.over, __sim.ents.filter(e=>e.kind==='core').map(e=>Math.round(e.hp))]\"}"
