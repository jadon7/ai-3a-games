// 模拟键盘玩家过 T1：node tools/drift_test.mjs [car] [entryKmh] [hbSec] [policy] [k=v ...]
import { buildTrack } from '../src/track.js';
import { Car } from '../src/physics.js';
const T = buildTrack().buildRacingLine(); const DT = 1 / 300;
const a = process.argv.slice(2); const name = a[0] || 'e30', entry = +(a[1] || 95), hb = +(a[2] || 0.25), policy = a[3] || 'naive';
const opts = {}; for (const kv of a.slice(4)) { const [k, v] = kv.split('='); opts[k] = +v; }
export function run(name, entry, hb, policy, opts, verbose = true) {
  const c = new Car(name, { isPlayer: true, ...opts }); const p = T.offset(90, 2.5); c.reset(p.x, p.y, p.h, 40);
  if (opts.izz) c.spec.izz = opts.izz;
  let t = 0, log = [], maxB = 0, driftT = 0, hits = 0, tHb = -1, offT = 0, spun = false, minV = 99;
  while (t < 12 && (c.s < 400 || t < 1)) {
    const inp = { steer: 0, throttle: 1, brake: 0, handbrake: false, tc: true };
    const b = c.beta * 57.3;
    if (c.s < 210) { if (c.speed * 3.6 > entry && c.s > 150) { inp.throttle = 0; inp.brake = 1; } }
    else if (c.s < 290) {
      if (tHb < 0) tHb = t;
      if (policy === 'naive') inp.steer = -1;                                        // 一直按住右
      else if (policy === 'line') inp.steer = c.d > -1.5 ? -1 : (c.d < -3.5 ? 0.3 : 0);   // 按位置修正
      else if (policy === 'tap') inp.steer = (b < 25 || c.d > 1) ? -1 : 0;            // 角度够了就松
      if (t - tHb < hb) { inp.handbrake = true; inp.throttle = 0; }
    } else { inp.steer = c.d > 1.5 ? -0.5 : (c.d < -1.5 ? 0.5 : 0); }
    c.step(DT, inp, T); t += DT;
    if (c.hitT === 0) hits++; if (c.offTrack) offT += DT; if (Math.abs(c.beta) > 1.3) spun = true;
    if (c.s > 215 && c.s < 330) minV = Math.min(minV, c.speed);
    if (Math.abs(c.beta) > 0.26 && c.speed > 10) driftT += DT; maxB = Math.max(maxB, Math.abs(c.beta));
    if (verbose && Math.round(t / DT) % 90 === 0 && c.s > 200) log.push(`t=${t.toFixed(1)} s=${c.s.toFixed(0)} d=${c.d.toFixed(1)} v=${(c.speed * 3.6).toFixed(0)} g${c.gear} rpm=${c.rpm.toFixed(0)} beta=${b.toFixed(0)} r=${(c.r * 57.3).toFixed(0)} steer=${(c.steer * 57.3).toFixed(0)} thr=${c.throttle.toFixed(1)} spin=${c.wheelspin.toFixed(2)} ay=${(c.ayF / 9.81).toFixed(2)} ${c.offTrack ? 'OFF' : ''}`);
  }
  const res = `${name} entry ${entry} hb ${hb} ${policy}: drift ${driftT.toFixed(2)} s, maxBeta ${(maxB * 57.3).toFixed(0)}°, minV ${(minV * 3.6).toFixed(0)}, hits ${hits}, off ${offT.toFixed(1)} s, t=${t.toFixed(1)} ${spun ? 'SPUN' : ''}`;
  if (verbose) console.log(log.slice(0, 26).join('\n')); console.log(res);
  return { spun, driftT, hits, offT };
}
if (a[0] === 'matrix') {
  for (const n of ['e30', 'capri', 'stratos']) for (const e of [80, 95, 110]) for (const h of [0, 0.25, 0.5]) for (const pol of ['naive', 'tap', 'line']) run(n, e, h, pol, opts, false);
} else run(name, entry, hb, policy, opts);
