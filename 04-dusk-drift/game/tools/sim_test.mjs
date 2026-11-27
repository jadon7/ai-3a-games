import { buildTrack } from '../src/track.js';
import { Car, collideCars } from '../src/physics.js';
import { Driver } from '../src/ai.js';
const T = buildTrack().buildRacingLine(); const DT = 1 / 300;
const kmh = v => (v * 3.6).toFixed(0);
function accel(name, tc = true) {
  const c = new Car(name); c.reset(0, 0, 0); let t = 0, t100 = 0, t200 = 0, d400 = 0;
  while (t < 60) { c.step(DT, { steerAngle: 0, throttle: 1, brake: 0, tc: tc }, null); t += DT; if (!t100 && c.vx > 27.78) t100 = t; if (!t200 && c.vx > 55.56) t200 = t; if (!d400 && c.x > 400) d400 = t; }
  const top = c.vx;
  // 刹车
  c.reset(0, 0, 0, 44.44); let x0 = c.x, tb = 0; while (c.vx > 0.5 && tb < 20) { c.step(DT, { steerAngle: 0, throttle: 0, brake: 1 }, null); tb += DT; }
  console.log(`${name} tc=${tc}: 0-100 ${t100.toFixed(2)}s  0-200 ${t200.toFixed(2)}s  400m ${d400.toFixed(2)}s  top ${kmh(top)} km/h (gear ${c.gear})  brake 160-0: ${(c.x - x0).toFixed(1)} m in ${tb.toFixed(2)} s (${(44.44 / tb / 9.81).toFixed(2)} g)`);
}
function skidpad(name, R, v) {
  const c = new Car(name); c.reset(0, 0, 0, v); let t = 0; let ok = true;
  const delta = Math.atan(c.spec.wheelbase / R);
  let maxB = 0, vEnd = 0;
  while (t < 12) { const thr = c.speed < v ? 0.6 : 0.05; c.step(DT, { steerAngle: delta * (1 + 0.004 * v * v / 9.81 * 3), throttle: thr, brake: 0 }, null); t += DT; if (t > 6) maxB = Math.max(maxB, Math.abs(c.beta)); }
  const ayg = c.speed * Math.abs(c.r) / 9.81;
  return `v=${kmh(v)}: ay=${ayg.toFixed(2)}g beta=${(maxB * 57.3).toFixed(1)}° vEnd=${kmh(c.speed)}`;
}
function aiLap(name, skill, laps = 2, verbose = false) {
  const prof = T.speedProfile(0.95, 5.0, 8.5, 68);
  const c = new Car(name); const g = T.gridSlot(0); c.reset(g.x, g.y, g.h);
  const d = new Driver(c, T, prof, { skill });
  let t = 0, lap = -1, lapStart = 0, lastS = c.s, hits = 0, maxBeta = 0, offT = 0, times = [], vmax = 0, vminCorner = 99;
  while (t < 400 && times.length < laps) {
    const inp = d.update(DT, [c]); c.step(DT, inp, T); t += DT;
    if (lastS > T.L - 30 && c.s < 30) { if (lap >= 0) times.push(t - lapStart); lap++; lapStart = t; }
    lastS = c.s; if (c.hitT === 0) hits++; maxBeta = Math.max(maxBeta, Math.abs(c.beta)); if (c.offTrack) offT += DT; vmax = Math.max(vmax, c.speed);
    if (verbose && Math.round(t / DT) % 600 === 0) console.log(`  t=${t.toFixed(0)} s=${c.s.toFixed(0)} d=${c.d.toFixed(1)} v=${kmh(c.speed)} g${c.gear} rpm=${c.rpm.toFixed(0)} beta=${(c.beta * 57.3).toFixed(1)}`);
  }
  console.log(`AI ${name} skill ${skill}: laps ${times.map(x => x.toFixed(2)).join(', ')} s; hits ${hits}; maxBeta ${(maxBeta * 57.3).toFixed(1)}°; offTrack ${offT.toFixed(1)} s; vmax ${kmh(vmax)}`);
}
function driftTest(name, assist, entryKmh = 95, hb = 0.25, verbose = true) {
  const c = new Car(name, { isPlayer: true, assist }); const p = T.offset(90, 2.5); c.reset(p.x, p.y, p.h, 40);
  let t = 0, log = [], maxB = 0, driftT = 0, hits = 0, tHb = -1, offT = 0, spun = false;
  while (t < 12 && (c.s < 420 || t < 1)) {
    const inp = { steer: 0, throttle: 1, brake: 0, handbrake: false, tc: true };
    const b = c.beta * 57.3;                      // 右弯：车尾向左甩时为正
    if (c.s < 212) { if (c.speed * 3.6 > entryKmh && c.s > 150) { inp.throttle = 0; inp.brake = 1; } }
    else if (c.s < 300) {
      if (tHb < 0) tHb = t;
      inp.steer = b < 22 ? -1 : (b > 42 ? 0.5 : 0);
      if (t - tHb < hb) { inp.handbrake = true; inp.throttle = 0; } else inp.throttle = b > 48 ? 0 : 1;
    } else { inp.steer = c.d > 2.5 ? -0.4 : (c.d < -2.5 ? 0.4 : 0); inp.throttle = Math.abs(b) > 30 ? 0.3 : 1; }
    c.step(DT, inp, T); t += DT;
    if (c.hitT === 0) hits++; if (c.offTrack) offT += DT; if (Math.abs(c.beta) > 1.4) spun = true;
    if (Math.abs(c.beta) > 0.26 && c.speed > 10) driftT += DT; maxB = Math.max(maxB, Math.abs(c.beta));
    if (Math.round(t / DT) % 120 === 0 && c.s > 195) log.push(`t=${t.toFixed(1)} s=${c.s.toFixed(0)} d=${c.d.toFixed(1)} v=${kmh(c.speed)} g${c.gear} rpm=${c.rpm.toFixed(0)} beta=${b.toFixed(0)} steer=${(c.steer * 57.3).toFixed(0)} thr=${c.throttle.toFixed(1)} spin=${c.wheelspin.toFixed(2)} ${c.offTrack ? 'OFF' : ''}`);
  }
  console.log(`drift ${name} assist ${assist} entry ${entryKmh} hb ${hb}: driftTime ${driftT.toFixed(2)} s, maxBeta ${(maxB * 57.3).toFixed(0)}°, hits ${hits}, off ${offT.toFixed(1)} s ${spun ? 'SPUN' : ''}`); if (verbose) console.log(log.slice(0, 16).join('\n'));
}
for (const n of ['e30', 'capri', 'stratos']) accel(n);
accel('e30', false);
console.log('skidpad e30 R50:', [16, 20, 22, 24].map(v => skidpad('e30', 50, v)).join(' | '));
aiLap('e30', 0.96, 2, process.argv.includes('-v')); aiLap('capri', 0.96); aiLap('stratos', 0.96); aiLap('e30', 1.03);
driftTest('e30', 1.0); driftTest('e30', 1.0, 105, 0.3, false); driftTest('e30', 1.0, 85, 0.0, true); driftTest('e30', 0.75, 95, 0.25, false); driftTest('capri', 1.0, 95, 0.25, false); driftTest('stratos', 1.0, 95, 0.25, false);
