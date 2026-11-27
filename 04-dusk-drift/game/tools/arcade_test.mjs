// 街机漂移的无画面测试：模拟"随手漂一下"的键盘玩家过 T1（R48 右弯），对比开 / 关街机漂移
//   node tools/arcade_test.mjs [车型,车型] [入弯km/h,...] [arcade=1|0] [verbose]
// 玩家行为：入弯前刹到目标车速；到弯口带着右方向拉 0.3 秒手刹，之后按住右 + 全油门；
// 车头对准出弯方向（航向误差 < 8°）就松开方向，直道上按位置轻点修正。
import { buildTrack } from '../src/track.js';
import { Car, CAR_SPECS, DRIFT } from '../src/physics.js';
import fs from 'node:fs';
let HB = 0.3, ENTRY_S = 210;
const info = JSON.parse(fs.readFileSync(new URL('../assets/cars/cars.json', import.meta.url)));
for (const id of Object.keys(CAR_SPECS)) { const sp = CAR_SPECS[id], m = info[id]; if (!m) continue; const r = sp.cgFront / sp.wheelbase; sp.wheelbase = m.wheelbase; sp.cgFront = m.wheelbase * r; sp.trackF = m.trackFront; sp.trackR = m.trackRear; sp.wheelR = m.wheelRadiusRear; sp.length = m.length; sp.width = m.width; sp.frontOverhang = m.frontAxleToNose; sp.rearOverhang = m.rearAxleToTail; }
const T = buildTrack().buildRacingLine(); const DT = 1 / 240;
const a = process.argv.slice(2).filter(x => { if (!x.includes('=')) return true; const [k, v] = x.split('='); if (k === 'hb') HB = +v; else if (k === 'at') ENTRY_S = +v; else if (k === 'pf') DRIFT.pushFade = v.split(':').map(Number); else DRIFT[k] = +v; return false; });
const cars = (a[0] || 'e30,p917,mustang,z280').split(','), entries = (a[1] || '80,100,120').split(',').map(Number);
const modes = a[2] === undefined || a[2] === 'x' ? [0, 1] : [+a[2]], verbose = a.includes('verbose'), POLICY = a.includes('hold') ? 'hold' : a.includes('pad') ? 'pad' : 'line';
const wrap = (x) => { while (x > Math.PI) x -= 2 * Math.PI; while (x < -Math.PI) x += 2 * Math.PI; return x; };

function run(name, entry, arcade, entryS = ENTRY_S, policy = POLICY) {
  const c = new Car(name, { isPlayer: true }); const p = T.offset(120, 1.5); c.reset(p.x, p.y, p.h, entry / 3.6);
  let t = 0, hbT = -1, released = -1, settle = -1, off = 0, hits = 0, spun = false, minV = 99, tIn = -1, tOut = -1, maxB = 0, phase = 0, log = [];
  while (t < 14) {
    const inp = { steer: 0, throttle: 1, brake: 0, handbrake: false, tc: true, arcade: !!arcade };
    const i = T.idx(c.s), herr = wrap(T.ph ? 0 : 0);
    // 赛道切线方向
    const j = T.idx(c.s + 2), tx = T.px[j] - T.px[i], ty = T.py[j] - T.py[i], th = Math.atan2(ty, tx), he = wrap(th - c.yaw);
    if (phase === 0) {                                   // 入弯前：保持目标车速
      if (c.speed * 3.6 > entry + 1) { inp.throttle = 0; inp.brake = 1; } else if (c.speed * 3.6 > entry - 3) inp.throttle = 0.3;
      if (c.s >= entryS && c.s < 600) { phase = 1; hbT = t; tIn = t; }
    } else if (phase === 1) {                            // 漂移：按住右，开头拉手刹
      if (policy === 'hold') inp.steer = -1;
      else {                                             // 看着前方赛道中线：行进方向偏外了就按住右，偏内了就松开
        const k2 = T.idx(c.s + 14 + c.speed * 0.4), gx = T.px[k2] - c.x, gy = T.py[k2] - c.y;
        const want = Math.atan2(gy, gx), travel = c.yaw + c.beta;
        const e = wrap(want - travel);
        if (policy === 'pad') { inp.analog = true; inp.steer = Math.max(-1, Math.min(1, e * 4)); if (c.drifting && e < 0.25) inp.steer = Math.min(-0.2, inp.steer); }   // 手柄：按偏差连续给方向，漂移中只放松不反打
        else inp.steer = e < -0.03 ? -1 : (c.drifting && e < 0.2) ? (Math.floor(t * 8) % 2 ? -1 : 0) : e > 0.05 ? 1 : 0;   // 键盘：漂移中偏内了就点按（不完全松开），偏得多才松手收车
      }
      if (t - hbT < HB) { inp.handbrake = true; inp.throttle = 0; inp.steer = -1; }
      // 出弯：车身已经转到出弯方向附近（弯道总转角 95°）
      const exitH = wrap(T.ph ? 0 : 0);
      // 估"现在松手车最后朝哪"（行进方向往车头追 noseShare 那么多）：对准出弯后的直道就松手
      const kA = T.idx(c.s + 25), kB = T.idx(c.s + 27), thA = Math.atan2(T.py[kB] - T.py[kA], T.px[kB] - T.px[kA]);
      const finalH = c.yaw + c.beta * (1 - DRIFT.noseShare);
      if (c.drifting && t - hbT > 0.8 && Math.abs(wrap(thA - finalH)) < 0.06 && c.s > 255) { phase = 2; released = t; }
      if (!c.drifting && c.s > 250 && Math.abs(he) < 0.14 && t - hbT > 0.8) { phase = 2; released = t; }
      if (c.s > 300) { phase = 2; released = t; }
    } else {                                             // 直道：按位置修正
      const k2 = T.idx(c.s + 10 + c.speed * 0.5), e = wrap(Math.atan2(T.py[k2] - c.y, T.px[k2] - c.x) - c.yaw - c.beta);
      inp.steer = e < -0.04 ? -1 : e > 0.04 ? 1 : 0;
      if (settle < 0 && Math.abs(c.beta) < 0.1) settle = t;
    }
    c.step(DT, inp, T); t += DT;
    if (c.hitT === 0) hits++; if (c.offTrack) off += DT; if (Math.abs(c.beta) > 1.5) spun = true;
    if (phase >= 1 && c.s < 380) minV = Math.min(minV, c.speed);
    maxB = Math.max(maxB, Math.abs(c.beta));
    if (tOut < 0 && c.s > 370 && c.s < 600) tOut = t;
    if (verbose && Math.round(t / DT) % 24 === 0 && phase >= 1 && c.s < 400) log.push(`t=${t.toFixed(2)} ph${phase} s=${c.s.toFixed(0)} d=${c.d.toFixed(1)} v=${(c.speed * 3.6).toFixed(0)} beta=${(c.beta * 57.3).toFixed(0)} he=${(he * 57.3).toFixed(0)} r=${(c.r * 57.3).toFixed(0)} drift=${c.drifting ? 1 : 0}`);
    if (tOut > 0 && t > tOut + 0.5) break;
  }
  if (verbose) console.log(log.join('\n'));
  const res = { car: name, entry, arcade, T1: tOut > 0 ? +(tOut - tIn).toFixed(2) : null, off: +off.toFixed(2), hits, spun, minV: Math.round(minV * 3.6), maxBeta: Math.round(maxB * 57.3), settle: released > 0 && settle > 0 ? +(settle - released).toFixed(2) : null };
  return res;
}
const rows = [];
for (const n of cars) for (const e of entries) for (const m of modes) rows.push(run(n, e, m));
let ok = 0; for (const r of rows) if (r.T1 && r.off < 0.3 && !r.hits) ok++; console.log('干净通过', ok, '/', rows.length);
for (const r of rows) console.log(`${r.car.padEnd(9)} ${String(r.entry).padStart(3)}km/h ${r.arcade ? '街机' : '原版'}  T1 ${r.T1 ?? 'DNF'} s | 出界 ${r.off}s 撞墙 ${r.hits} ${r.spun ? '打转' : ''} | 最低 ${r.minV} | 最大角 ${r.maxBeta}° | 松手后收直 ${r.settle ?? '-'} s`);
