#!/bin/zsh
# 宣传片的全部素材，按顺序一段一段录（不要并行，抢显卡会白屏）。输出到 docs/trailer/raw/。
# 用法: [FORCE=1] zsh tools/trailer/rec_all.sh [只录名字里带这个词的]
cd "$(dirname "$0")/../.."
R=docs/trailer/raw; mkdir -p $R; only=${1:-}
# 已经录好的不重录（要重录就带 FORCE=1）
cap() { local name=$1; shift; [[ -n $only && $name != *$only* ]] && return; [[ -z $FORCE && -f $R/$name.mp4 ]] && return; echo "== $name"; node tools/trailer/cap.mjs $R/$name.mp4 "$@" 2>&1 | grep -v "帧" | cut -c1-400; }
skill() { local name=$1; shift; [[ -n $only && $name != *$only* ]] && return; [[ -z $FORCE && -f $R/$name.mp4 ]] && return; echo "== $name"; zsh tools/trailer/skill.sh "$1" $R/$name.mp4 "${@:2}" 2>&1 | grep -v "帧" | cut -c1-400; }
LOG='[Math.round(__sim.time*10)/10, __sim.kills[0]+__sim.kills[1], __director.focus(), __sim.towersLeft(0)+__sim.towersLeft(1)]'

# ---- 空镜：没有英雄、没有对局，固定机位，每帧按住 Q/E（转）或 A/D（平移）一小段时间 = 匀速运镜 ----
cap e_aerial  "cam=0,0,84,46,0,0&nohud=1&hero=0"     '{"sec":5,"hold":["KeyQ"],"holdFrac":0.06}'
cap e_tide    "cam=-45,0,40,30,0,20&nohud=1&hero=0"  '{"sec":4,"hold":["KeyD"],"holdFrac":0.07}'
cap e_ember   "cam=45,0,40,30,0,200&nohud=1&hero=0"  '{"sec":4,"hold":["KeyD"],"holdFrac":0.07}'
cap e_river   "cam=0,0,30,20,0,90&nohud=1&hero=0"    '{"sec":6,"hold":["KeyE"],"holdFrac":0.05}'
cap e_coreT   "cam=-88,0,34,28,4,30&nohud=1&hero=0"  '{"sec":5,"hold":["KeyQ"],"holdFrac":0.05}'
cap e_coreE   "cam=88,0,34,28,4,210&nohud=1&hero=0"  '{"sec":5,"hold":["KeyQ"],"holdFrac":0.05}'

# ---- 观战（导播）：六个英雄都是电脑（show 档），镜头自己找打架的地方。每帧记下时间、击杀数、导播在看什么、剩几座塔 ----
# 画面调整（只在录像脚本里做，不改游戏）：网址带 cam=0,0,0,46 把俯角从 56° 压到 46°（导播只管位置、距离和朝向，不管俯角）；
# 再把导播给的镜头距离乘 0.72（包一层 __director.update），英雄在画面里大一些。
D="director=1&h=lan&nohud=1&cam=0,0,0,46"
ZP='const __o=__director.update; __director.update=dt=>{const s=__o(dt); s.dist*=0.72; return s;}; 1'
cap h0    "$D" "{\"cond\":\"__sim.time>55\",\"sec\":45,\"pre\":\"$ZP\",\"log\":\"$LOG\"}"
cap h1    "$D" "{\"cond\":\"__sim.time>150\",\"sec\":180,\"pre\":\"$ZP\",\"log\":\"$LOG\"}"
cap h2    "$D" "{\"cond\":\"__sim.time>400\",\"sec\":150,\"pre\":\"$ZP\",\"log\":\"$LOG\"}"
# 收尾：快进到有一座水晶掉到四成血以下，录到它爆掉
cap h_end "$D" "{\"cond\":\"__sim.ents.some(e=>e.kind==='core'&&e.alive&&e.hp<e.max*0.4)\",\"sec\":30,\"pre\":\"$ZP\",\"log\":\"$LOG\"}"

# ---- 技能特写（测试场）：英雄升满级，先放大招，再放一个小技能 ----
skill s_lan    lan    "Q@0.3,R@2.0"   5.5
skill s_torg   torg   "R@0.3,Q@3.2"   5.5
skill s_moko   moko   "R@0.3,E@3.4"   5.5
skill s_gorran gorran "R@0.3,Q@3.4"   5.5
skill s_vero   vero   "R@0.3"         4.5
skill s_osen   osen   "R@0.3,Q@3.4"   5.5

# ---- 手机横屏：触屏布局 + 省电画质，844×390 按两倍像素录 ----
cap m_phone "h=lan&auto=1&diff=show&ally=show&touch=1&q=lite" '{"w":844,"h":390,"dpr":2,"mobile":true,"cond":"__sim.time>170 && __sim.hero.alive && __sim.heroes().some(e=>e.alive&&e.team!==__sim.hero.team&&Math.hypot(e.x-__sim.hero.x,e.z-__sim.hero.z)<11)","sec":6}'
