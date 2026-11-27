#!/bin/zsh
# 在一局真实对局里（只有自己，没有电脑）走到一个野怪营地去打，录一段。Boss 没到时间也可以录：脚本会提前把它放出来。
# 用法: zsh tools/rec_wild.sh <野怪名> <输出.mp4> [英雄=lan] [英雄等级=5] [镜头距离=22] [录几秒=14]
# 录的时候英雄的血掉到三成五以下会被续到六成（一个人打增益怪和 Boss 本来撑不了这么久，这里只为把怪的动作录全）。
cd "$(dirname "$0")/.."
mob=$1; out=$2; hero=${3:-lan}; lv=${4:-5}; dist=${5:-22}; sec=${6:-14}; tmp=$(mktemp -d)
steps=$(node -e '
const [mob, lv, sec] = process.argv.slice(1);
console.log(JSON.stringify([
 {js: "__setSpeed(8); 1"}, {until: "__sim.time > 21"}, {js: "__setSpeed(1); 1"},
 {js: "const s = __sim, h = s.hero; for (let i = 0; i < 4000 && h.h.level < " + lv + "; i++) s.gainXp(h, 40); h.hp = h.max; const c = s.camps.find(c => c.mob === \"" + mob + "\" && (c.side === 0 || c.side === 2)); if (!c.up) s.spawnCamp(c); window.__c = c; const a = __actors.get(h.id); a.teleport(c.x + c.fx * 9, c.z + c.fz * 9); a.face(c.x, c.z, true); __play.follow = true; 1"},
 {wait: 1800}, {rec: "clip.webm"}, {js: "window.__r0 = performance.now(); 1"}, {wait: 1500},
 {js: "__play.attack(__c.mobs[0]); window.__iv = setInterval(() => { const h = __sim.hero, m = __c.mobs.find(x => x.alive); if (!m) return; if (h.hp < h.max * 0.35) h.hp = h.max * 0.6; if (__play.state() === \"idle\") __play.attack(m); }, 300); 1"},
 {wait: (sec - 1.5) * 1000}, {js: "clearInterval(__iv); (performance.now() - __r0) / 1000", log: "REAL"}, {stop: 1}]));' $mob $lv $sec)
for i in 1 2 3; do MOBA_URL=${MOBA_URL:-http://localhost:5190/map.html} node tools/play_test.mjs $tmp "$steps" "h=$hero&solo=1&nofog=1&nohud=1&dist=$dist" 1280 720 > $tmp/log.txt 2>&1; grep -q "Shader Error" $tmp/log.txt || break; echo "显卡被抢，重试 $i"; done
real=$(grep "^REAL" $tmp/log.txt | awk '{print $2}')
[ -n "$real" ] && zsh tools/rec_fix.sh $tmp/clip.webm $out $real 1280 26 || { echo "没录成"; tail -4 $tmp/log.txt | cut -c 1-300; }
