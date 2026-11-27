#!/bin/zsh
# 从一局对局里录一段：先按 16 倍速快进到某个条件成立，再按 <倍速> 录 <秒数> 秒，转成 mp4。
# 用法: zsh tools/rec_clip.sh <输出.mp4> "<网址参数>" "<开录的条件（页面里的表达式）>" <录几秒> [录的时候几倍速=1] [开录前执行的脚本] [宽=1280] [高=720]
#   例: zsh tools/rec_clip.sh docs/match/6/vid/fight.mp4 "h=lan&auto=1" "__sim.time>200 && __near(2,2)" 22
# 页面里可以用的现成判断：__near(a, b) 自己英雄 12 米内有至少 a 个我方、b 个对方英雄活着；__bossFight() 自己英雄正在打 Boss。
# 无界面录屏帧率不稳，所以记下真实用时，再用 rec_fix.sh 把时间轴拉回去。显卡被别的任务抢占时画面会白，脚本会重试三次。
cd "$(dirname "$0")/.."
out=$1; q=$2; cond=$3; sec=$4; sp=${5:-1}; pre=${6:-1}; w=${7:-1280}; h=${8:-720}
tmp=$(mktemp -d); url=${MOBA_URL:-http://localhost:5190/map.html}
steps=$(node -e '
const [cond, sec, sp, pre] = process.argv.slice(1);
const helpers = "window.__near=(a,b)=>{const h=__sim.hero;if(!h.alive)return false;const n=__sim.heroes().filter(e=>e.alive&&Math.hypot(e.x-h.x,e.z-h.z)<12);return n.filter(e=>e.team===0).length>=a&&n.filter(e=>e.team===1).length>=b};window.__bossFight=()=>{const h=__sim.hero;return h.alive&&__sim.camps.some(c=>c.kind===\"boss\"&&c.up&&c.mobs[0].fight>0&&c.mobs[0].hp<c.mobs[0].max*0.8&&Math.hypot(c.x-h.x,c.z-h.z)<11)};1";
console.log(JSON.stringify([{js: helpers}, {js: "__setSpeed(16);1"}, {until: cond, timeout: 900000}, {js: "__setSpeed(" + sp + ");" + pre + ";1"}, {wait: 400}, {rec: "clip.webm"}, {js: "window.__r0=performance.now();1"}, {wait: sec * 1000}, {js: "(performance.now()-__r0)/1000", log: "REAL"}, {stop: 1}, {js: "__report()", log: "END"}]));' "$cond" "$sec" "$sp" "$pre")
for i in 1 2 3; do MOBA_URL=$url node tools/play_test.mjs $tmp "$steps" "$q" $w $h > $tmp/log.txt 2>&1; grep -q "Shader Error" $tmp/log.txt || break; echo "显卡被抢，重试 $i"; done
real=$(grep "^REAL" $tmp/log.txt | awk '{print $2}'); grep "^END" $tmp/log.txt | cut -c 1-260
[ -n "$real" ] && zsh tools/rec_fix.sh $tmp/clip.webm $out $real $w 26 || { echo "没录成"; tail -5 $tmp/log.txt | cut -c 1-300; }
