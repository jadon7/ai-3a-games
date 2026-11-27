import { buildTrack } from '../src/track.js';
import { Car } from '../src/physics.js';
import { Driver } from '../src/ai.js';
const T = buildTrack().buildRacingLine(); const DT = 1 / 300;
const prof = T.speedProfile(1.0, 5.0, 9.0, 68);
const c = new Car('e30'); const g = T.gridSlot(0); c.reset(g.x, g.y, g.h);
const d = new Driver(c, T, prof, { skill: +process.argv[2] || 0.96 });
let t = 0; const every = +process.argv[3] || 150, tmax = +process.argv[4] || 30;
while (t < tmax) {
  const inp = d.update(DT, [c]); c.step(DT, inp, T); t += DT;
  if (Math.round(t / DT) % every === 0) console.log(`t=${t.toFixed(1)} s=${c.s.toFixed(0)} d=${c.d.toFixed(1)} line=${T.lineD[c.trackI].toFixed(1)} v=${(c.speed * 3.6).toFixed(0)}/${(prof[c.trackI] * 3.6).toFixed(0)} g${c.gear} rpm=${c.rpm.toFixed(0)} thr=${inp.throttle.toFixed(2)} brk=${inp.brake.toFixed(2)} st=${(c.steer * 57.3).toFixed(1)} beta=${(c.beta * 57.3).toFixed(1)} r=${c.r.toFixed(2)} sxR=${c.wheels[2].sx.toFixed(2)} ay=${(c.ayF / 9.81).toFixed(2)} ${c.offTrack ? 'OFF' : ''}`);
}
