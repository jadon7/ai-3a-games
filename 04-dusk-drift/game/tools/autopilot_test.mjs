// 自动驾驶的无画面测试：每台车单独跑 N 圈，统计每个漂移弯有没有漂起来、出界、撞墙、圈速
//   node tools/autopilot_test.mjs [车型,...] [圈数] [sens=1.25] [verbose]
import { buildTrack } from '../src/track.js';
import { Car, CAR_SPECS } from '../src/physics.js';
import { AutoPilot, driftZones } from '../src/autopilot.js';
import fs from 'node:fs';
const info = JSON.parse(fs.readFileSync(new URL('../assets/cars/cars.json', import.meta.url)));
for (const id of Object.keys(CAR_SPECS)) { const sp = CAR_SPECS[id], m = info[id]; if (!m) continue; const r = sp.cgFront / sp.wheelbase; sp.wheelbase = m.wheelbase; sp.cgFront = m.wheelbase * r; sp.trackF = m.trackFront; sp.trackR = m.trackRear; sp.wheelR = m.wheelRadiusRear; sp.length = m.length; sp.width = m.width; sp.frontOverhang = m.frontAxleToNose; sp.rearOverhang = m.rearAxleToTail; }
const T = buildTrack().buildRacingLine(), P = T.speedProfile(0.95, 5.0, 8.5, 68);
const args = process.argv.slice(2).filter(a => { if (a.startsWith('sens=')) { globalThis.__SENS = +a.slice(5); return false; } return true; });
const cars = (args[0] && args[0] !== 'all' ? args[0] : Object.keys(CAR_SPECS).join(',')).split(','), laps = +(args[1] || 3), verbose = args.includes('verbose');
const zones = driftZones(T);
export function run(name, nLaps = laps, opts = {}) {
  const c = new Car(name, { isPlayer: true, steerSens: globalThis.__SENS ?? 1.25 });
  const g = T.gridSlot(0); c.reset(g.x, g.y, g.h); c.s = g.s; c.d = g.d;
  let resets = 0;
  const ap = new AutoPilot(c, T, P, { zones, onStuck: () => { resets++; const p = T.offset(c.s, 0); c.reset(p.x, p.y, p.h, 0); c.trackI = T.idx(c.s); } , ...opts });
  const DT = 1 / 240; let t = 0, lap = 0, lastS = c.s, lapT0 = 0, off = 0, hits = 0, spins = 0;
  const lapTimes = [], zs = zones.map(() => ({ drift: 0, maxB: 0, off: 0, tries: 0 })), log = [];
  let inZone = -1, zDrift = false;
  while (lap < nLaps + 1 && t < 90 * nLaps) {
    const inp = ap.update(DT, [c]);
    c.step(DT, inp, T); t += DT;
    if (c.s < lastS - T.L / 2) { if (lap > 0) lapTimes.push(+(t - lapT0).toFixed(1)); lapT0 = t; lap++; }
    lastS = c.s;
    if (lap < 1) continue;
    if (c.offTrack) off += DT; if (c.hitT === 0) hits++; if (Math.abs(c.beta) > 1.5) spins += DT;
    const zi = zones.findIndex(z => T.deltaS(c.s, z.s0) > -12 && T.deltaS(c.s, z.s1) < 8);
    if (zi !== inZone) { if (inZone >= 0) { zs[inZone].tries++; if (zDrift) zs[inZone].drift++; } inZone = zi; zDrift = false; }
    if (zi >= 0) { if (c.drifting && Math.abs(c.beta) > 0.35) zDrift = true; zs[zi].maxB = Math.max(zs[zi].maxB, Math.abs(c.beta)); if (c.offTrack) zs[zi].off += DT; }
    if (verbose && Math.round(t / DT) % 24 === 0 && (zi >= 0 || process.env.ALL)) log.push(`t=${t.toFixed(2)} z${zi} ${ap.phase} s=${c.s.toFixed(0)} d=${c.d.toFixed(1)} v=${(c.speed * 3.6).toFixed(0)} b=${(c.beta * 57.3).toFixed(0)} dr=${c.drifting ? 1 : 0} off=${c.offTrack ? 1 : 0}`);
  }
  if (verbose) console.log(log.join('\n'));
  return { name, lapTimes, off: +off.toFixed(1), hits, spins: +spins.toFixed(1), resets, zs };
}
if (process.argv[1].endsWith('autopilot_test.mjs')) {
  console.log('漂移弯', zones.map((z, i) => `Z${i} s${z.s0.toFixed(0)}-${z.s1.toFixed(0)} ${z.dir > 0 ? '左' : '右'}${(Math.abs(z.turn) * 57.3).toFixed(0)}° R${z.rmin.toFixed(0)} 入弯${(z.vEntry * 3.6).toFixed(0)}`).join(' | '));
  let tot = 0, ok = 0;
  for (const n of cars) {
    const r = run(n);
    const zsTxt = r.zs.map((z, i) => `Z${i} ${z.drift}/${z.tries}${z.off > 0.05 ? ' 出界' + z.off.toFixed(1) : ''} ${Math.round(z.maxB * 57.3)}°`).join(' ');
    for (const z of r.zs) { tot += z.tries; ok += z.off < 0.05 ? z.drift : 0; }
    console.log(`${n.padEnd(9)} 圈速 ${r.lapTimes.join(' / ')} | 出界 ${r.off}s 撞墙 ${r.hits} 打转 ${r.spins}s 复位 ${r.resets} | ${zsTxt}`);
  }
  console.log(`干净漂移 ${ok} / ${tot}`);
}
