#!/bin/zsh
# 在测试场里录一个英雄的技能特写（逐帧、30 帧、1920×1080、无界面）。
# 用法: zsh tools/trailer/skill.sh <英雄 id> <输出.mp4> "<技能序列，如 R@0.3,Q@3.4>" [录几秒=6] [镜头距离=17] [额外网址参数]
# 做法：先把英雄升满级，每个技能按真实时间空放一遍（特效的着色器编好，录的时候不卡），靶子复位，再按虚拟时间逐帧录。
# 放技能的写法照 tools/showcase.mjs：对着对面小兵的中心放；指向友方的技能放给己方假人；够不着就先站近。
cd "$(dirname "$0")/../.."
id=$1; out=$2; seq=$3; sec=${4:-6}; dist=${5:-17}; extra=${6:-}
opts=$(node -e '
const [seq, sec] = process.argv.slice(1);
const setup = `(() => { for (const el of document.querySelectorAll("body > div")) if (el.querySelector("select") && !el.classList.contains("hud")) el.style.display = "none";
  const h = __sim.hero; for (let i = 0; i < 15; i++) __sim.gainXp(h, 2000);
  window.__kx = __play.actor.pos.x; window.__kz = __play.actor.pos.z;
  window.__treset = () => { const a = __play.actor; __arena.reset(); a.stop(); a.teleport(__kx, __kz); for (const k of ["Q","W","E","R"]) a.setCd(k, 0); h.hp = h.max; h.h.mana = h.h.stat.mana; h.stun = 0; h.shield = 0; };
  window.__tcast = key => { const A = __arena, f = A.foes.filter(e => e.alive), cx = f.reduce((s, e) => s + e.x, 0) / f.length, cz = f.reduce((s, e) => s + e.z, 0) / f.length;
    const a0 = __play.actor, def = a0.skill(key), ally = def.target === "ally", unit = def.cast === "unit" ? (ally ? A.friend : A.dummy) : null, x = unit ? unit.x : cx, z = unit ? unit.z : cz;
    const reach = def.cast === "self" ? (def.radius ?? def.range ?? 0) * 0.6 : (def.range ?? def.radius ?? 0) * 0.7, ddx = a0.pos.x - x, ddz = a0.pos.z - z, dl = Math.hypot(ddx, ddz);
    if (reach > 0 && dl > reach) { const kk = Math.max(reach, 1.6) / dl; let px = x + ddx * kk, pz = z + ddz * kk; if (!__nav.walkable(px, pz)) [px, pz] = __nav.nearest(px, pz); a0.teleport(px, pz); }
    return __play.cast(key, x, z, unit); };
  return 1; })()`;
const real = [{ js: setup, wait: 600 }];
for (const k of ["Q", "W", "E", "R"]) real.push({ js: "__treset(); 1", wait: 250 }, { js: `try { __tcast("${k}") } catch (e) {}; 1`, wait: 2600 });
real.push({ js: "__treset(); 1", wait: 4200 }, { js: "__treset(); 1", wait: 600 });
const at = seq.split(",").filter(Boolean).map(s => { const [k, t] = s.split("@"); return k === "reset" ? { t: +t, js: "__treset(); 1" } : k === "A" ? { t: +t, js: "__play.attack(__arena.foes[0]); 1" } : { t: +t, js: `__tcast("${k}"); 1` }; });
console.log(JSON.stringify({ sec: +sec, real, at, warm: 3 }));' "$seq" "$sec")
node tools/trailer/cap.mjs "$out" "arena=1&h=$id&nohud=1&dist=$dist$extra" "$opts"
