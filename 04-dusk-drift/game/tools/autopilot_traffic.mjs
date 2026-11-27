// 自动驾驶带 5 台 AI 对手跑（和游戏里一样从最后一个发车位出发）：node tools/autopilot_traffic.mjs [玩家车] [圈数] [种子]
import { buildTrack } from '../src/track.js';
import { Car, CAR_SPECS, collideCars } from '../src/physics.js';
import { Driver } from '../src/ai.js';
import { AutoPilot, driftZones } from '../src/autopilot.js';
import fs from 'node:fs';
const info = JSON.parse(fs.readFileSync(new URL('../assets/cars/cars.json', import.meta.url)));
for (const id of Object.keys(CAR_SPECS)) { const sp = CAR_SPECS[id], m = info[id]; if (!m) continue; const r = sp.cgFront / sp.wheelbase; sp.wheelbase = m.wheelbase; sp.cgFront = m.wheelbase * r; sp.trackF = m.trackFront; sp.trackR = m.trackRear; sp.wheelR = m.wheelRadiusRear; sp.length = m.length; sp.width = m.width; sp.frontOverhang = m.frontAxleToNose; sp.rearOverhang = m.rearAxleToTail; }
const T = buildTrack().buildRacingLine(), P = T.speedProfile(0.95, 5.0, 8.5, 68), zones = driftZones(T);
const me = process.argv[2] || 'e30', laps = +(process.argv[3] || 3); let seed = +(process.argv[4] || 1);
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const pool = Object.keys(CAR_SPECS).filter(i => i !== me).sort(() => rnd() - 0.5).slice(0, 5);
const SL = [{ skill: 0.925, bias: 0.3 }, { skill: 0.915, bias: -0.4 }, { skill: 0.905, bias: 0.2 }, { skill: 0.895, bias: -0.3 }, { skill: 0.885, bias: 0.5 }];
const E = [...pool.map((id, i) => ({ id, ...SL[i] })), { id: me, player: true }].map((d, n) => { const c = new Car(d.id, { isPlayer: !!d.player, id: n, steerSens: 1.25 }); const g = T.gridSlot(n); c.reset(g.x, g.y, g.h); c.s = g.s; c.d = g.d; return { ...d, car: c, drv: d.player ? null : new Driver(c, T, P, { skill: d.skill, lineBias: d.bias }) }; });
const pl = E[5];
pl.drv = new AutoPilot(pl.car, T, P, { zones, onStuck: () => { const c = pl.car, p = T.offset(c.s, 0); c.reset(p.x, p.y, p.h, 0); c.trackI = T.idx(c.s); resets++; } });
const cars = E.map(e => e.car), DT = 1 / 240; let t = 0, lap = 0, last = pl.car.s, off = 0, hits = 0, resets = 0, drifts = 0, wasD = false;
while (lap <= laps && t < 100 * laps) {
  for (const e of E) e.car.step(DT, e.drv.update(DT, cars), T);
  collideCars(cars); t += DT;
  const c = pl.car; if (c.s < last - T.L / 2) lap++; last = c.s;
  if (lap >= 1) { if (c.offTrack) off += DT; if (c.hitT === 0) { hits++; if (process.env.V) { let best = null, bg = 99; for (const o of cars) { if (o === c) continue; const g = T.deltaS(o.s, c.s); if (Math.abs(g) < Math.abs(bg)) { bg = g; best = o; } } console.log(`  碰撞 lap${lap} s=${c.s.toFixed(0)} ${pl.drv.phase} v=${(c.speed*3.6).toFixed(0)} 最近车 ${best.specName} 相对 ${bg.toFixed(1)}m 横 ${(best.d - c.d).toFixed(1)} 车速 ${(best.speed*3.6).toFixed(0)} mag ${c.hitMag?.toFixed(1)}`); } } if (c.drifting && !wasD) drifts++; wasD = c.drifting; }
}
console.log(`${me} 对手 ${pool.join(',')} | ${laps} 圈 ${t.toFixed(0)}s | 出界 ${off.toFixed(1)}s 碰撞 ${hits} 复位 ${resets} 漂移 ${drifts} 次`);
