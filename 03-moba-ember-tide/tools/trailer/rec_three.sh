#!/bin/zsh
# 第三批：导播很少专门看小野怪（等不到），打野改成单人对局里自己去打；薇萝的大招（细箭）在画面里看不清，换成火油罐 + 穿甲矢。
# 用法: [FORCE=1] zsh tools/trailer/rec_three.sh [只录名字里带这个词的]
cd "$(dirname "$0")/../.."
R=docs/trailer/raw; only=${1:-}
cap() { local name=$1; shift; [[ -n $only && $name != *$only* ]] && return; [[ -z $FORCE && -f $R/$name.mp4 ]] && return; echo "== $name"; node tools/trailer/cap.mjs $R/$name.mp4 "$@" 2>&1 | grep -v "帧" | cut -c1-400; }
skill() { local name=$1; shift; [[ -n $only && $name != *$only* ]] && return; [[ -z $FORCE && -f $R/$name.mp4 ]] && return; echo "== $name"; zsh tools/trailer/skill.sh "$1" $R/$name.mp4 "${@:2}" 2>&1 | grep -v "帧" | cut -c1-400; }

# 打野：葛隆（单人对局、没有电脑）升到 7 级，站到己方下路的烬鬃野猪营地前面开打，先放余烬地再砧撞。
# 照 tools/rec_wild.sh 的做法：血掉到三成五以下续到六成（一个人打增益怪撑不了多久，这里只为把动作录全）。
SETUP='(()=>{const s=__sim,h=s.hero; for(let i=0;i<4000&&h.h.level<7;i++) s.gainXp(h,40); h.hp=h.max; const c=s.camps.find(c=>c.mob===`boar`&&(c.side===0||c.side===2)); if(!c.up) s.spawnCamp(c); window.__c=c; const a=__actors.get(h.id); a.teleport(c.x+c.fx*7,c.z+c.fz*7); a.face(c.x,c.z,true); __play.follow=true; return 1})()'
HIT='(()=>{const h=__sim.hero,m=__c.mobs.find(x=>x.alive); if(!m) return 0; if(h.hp<h.max*0.35) h.hp=h.max*0.6; if(__play.state()===`idle`) __play.attack(m); return 1})()'
CASTE='(()=>{const m=__c.mobs.find(x=>x.alive); return m?__play.cast(`E`,m.x,m.z):0})()'
CASTQ='(()=>{const m=__c.mobs.find(x=>x.alive); return m?__play.cast(`Q`,m.x,m.z):0})()'
cap j_boar "h=gorran&solo=1&nofog=1&nohud=1&dist=19" "{\"cond\":\"__sim.time>21\",\"real\":[{\"js\":\"$SETUP\",\"wait\":1800}],\"pre\":\"$HIT\",\"sec\":7,\"at\":[{\"t\":0.6,\"js\":\"$HIT\"},{\"t\":1.2,\"js\":\"$CASTE\"},{\"t\":2.2,\"js\":\"$HIT\"},{\"t\":3.4,\"js\":\"$CASTQ\"},{\"t\":4.4,\"js\":\"$HIT\"},{\"t\":5.4,\"js\":\"$HIT\"},{\"t\":6.2,\"js\":\"$HIT\"}]}"

skill s_vero2 vero "E@0.3,Q@2.4" 4.5
