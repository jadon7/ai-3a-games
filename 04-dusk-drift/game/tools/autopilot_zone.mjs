// 自动驾驶逐弯测试：每个漂移弯前 120 m 起步，跑到出弯后 60 m
//   node tools/autopilot_zone.mjs [车型,...|all] [弯号,...] [verbose]   （参数可用 globalThis.__AP 覆盖，见 autopilot.js）
import { buildTrack } from '../src/track.js';
import { Car, CAR_SPECS } from '../src/physics.js';
import { AutoPilot, driftZones } from '../src/autopilot.js';
import fs from 'node:fs';
const info = JSON.parse(fs.readFileSync(new URL('../assets/cars/cars.json', import.meta.url)));
for (const id of Object.keys(CAR_SPECS)) { const sp = CAR_SPECS[id], m = info[id]; if (!m) continue; const r = sp.cgFront / sp.wheelbase; sp.wheelbase = m.wheelbase; sp.cgFront = m.wheelbase * r; sp.trackF = m.trackFront; sp.trackR = m.trackRear; sp.wheelR = m.wheelRadiusRear; sp.length = m.length; sp.width = m.width; sp.frontOverhang = m.frontAxleToNose; sp.rearOverhang = m.rearAxleToTail; }
const T = buildTrack().buildRacingLine(), P = T.speedProfile(0.95, 5.0, 8.5, 68), zones = driftZones(T);
if (process.env.AP) globalThis.__AP = JSON.parse(process.env.AP);
export function zoneRun(name, zi, verbose = false) {
  const z = zones[zi], c = new Car(name, { isPlayer: true, steerSens: globalThis.__SENS ?? 1.25 });
  const s0 = T.wrapS(z.s0 - 120), i0 = T.idx(s0), p = T.offset(s0, T.lineD[i0]);
  c.reset(p.x, p.y, p.h, Math.min(P[i0] * 0.85, 30)); c.s = s0; c.trackI = i0;
  const ap = new AutoPilot(c, T, P, { zones });
  const DT = 1 / 240; let t = 0, off = 0, hits = 0, drift = 0, maxB = 0, log = [], minV = 99;
  while (t < 25 && T.deltaS(c.s, z.s1) < 60) {
    const inp = ap.update(DT, [c]); c.step(DT, inp, T); t += DT;
    if (c.offTrack) off += DT; if (c.hitT === 0) hits++; if (c.drifting) drift += DT; maxB = Math.max(maxB, Math.abs(c.beta));
    if (T.deltaS(c.s, z.s0) > 0) minV = Math.min(minV, c.speed);
    if (verbose && Math.round(t / DT) % 24 === 0 && T.deltaS(c.s, z.s0) > -40) log.push(`t=${t.toFixed(1)} ${ap.phase} s=${c.s.toFixed(0)} d=${c.d.toFixed(1)} v=${(c.speed * 3.6).toFixed(0)} b=${(c.beta * 57.3).toFixed(0)} dr=${c.drifting ? 1 : 0} ln=${(c.driftLine ?? 0).toFixed(2)} off=${c.offTrack ? 1 : 0}`);
  }
  if (verbose) console.log(log.join('\n'));
  return { t: +t.toFixed(2), off: +off.toFixed(2), hits, drift: +drift.toFixed(1), maxB: Math.round(maxB * 57.3), minV: Math.round(minV * 3.6), done: T.deltaS(c.s, z.s1) >= 60 };
}
if (process.argv[1].endsWith('autopilot_zone.mjs')) {
  const a = process.argv.slice(2);
  const cars = (!a[0] || a[0] === 'all' ? Object.keys(CAR_SPECS) : a[0].split(','));
  const zl = a[1] ? a[1].split(',').map(Number) : zones.map((_, i) => i), verbose = a.includes('verbose');
  let ok = 0, n = 0; const byZ = zl.map(() => 0);
  for (const name of cars) {
    const row = zl.map((zi, k) => { const r = zoneRun(name, zi, verbose); n++; const clean = r.done && r.off < 0.05 && !r.hits && r.drift > 0.8; if (clean) { ok++; byZ[k]++; } return `Z${zi}${clean ? '✓' : '✗'} ${r.t}s 漂${r.drift} 出${r.off} 撞${r.hits} ${r.maxB}° ${r.minV}`; });
    console.log(name.padEnd(9), row.join(' | '));
  }
  console.log(`干净 ${ok}/${n}  各弯 ${zl.map((z, k) => `Z${z}:${byZ[k]}`).join(' ')}`);
}
