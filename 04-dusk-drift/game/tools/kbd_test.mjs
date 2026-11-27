// 用"只有开/关两种状态"的键盘式输入跑圈，检验键盘手感是否可控
import { buildTrack } from '../src/track.js';
import { Car, CAR_SPECS } from '../src/physics.js';
import fs from 'node:fs';
const info = JSON.parse(fs.readFileSync(new URL('../assets/cars/cars.json', import.meta.url)));
for (const id of ['e30', 'capri', 'stratos']) { const sp = CAR_SPECS[id], m = info[id], r = sp.cgFront / sp.wheelbase; sp.wheelbase = m.wheelbase; sp.cgFront = m.wheelbase * r; sp.trackF = m.trackFront; sp.trackR = m.trackRear; sp.wheelR = m.wheelRadiusRear; sp.length = m.length; sp.width = m.width; sp.frontOverhang = m.frontAxleToNose; sp.rearOverhang = m.rearAxleToTail; }
const T = buildTrack().buildRacingLine(); const DT = 1 / 240;
function lap(name, pace, wet = 0) {
  const prof = T.speedProfile(0.95, 5.0, 8.5, 68);
  T.wetnessXY = wet ? ((x, y) => (Math.sin(x * 0.21) * Math.sin(y * 0.17) > 0.55 ? wet : 0)) : null;
  const c = new Car(name, { isPlayer: true }); const g = T.gridSlot(0); c.reset(g.x, g.y, g.h);
  let t = 0, laps = [], lapStart = 0, lastS = 0, hits = 0, off = 0, maxB = 0, started = false, react = 0, key = { steer: 0, thr: 0, brk: 0 };
  while (t < 300 && laps.length < 2) {
    // 人的反应：每 80 ms 才更新一次按键
    react -= DT;
    if (react <= 0) {
      react = 0.08;
      const v = c.speed, la = 7 + v * 0.42, i = T.idx(c.s + la);
      const tx = T.lineX[i], ty = T.lineY[i], dx = tx - c.x, dy = ty - c.y, cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
      const ang = Math.atan2(-dx * sy + dy * cy, dx * cy + dy * sy);
      key.steer = ang > 0.035 ? 1 : ang < -0.035 ? -1 : 0;
      const vt = prof[T.idx(c.s + 4 + v * 0.3)] * pace;
      key.thr = v < vt ? 1 : 0; key.brk = v > vt + 1.5 ? 1 : 0; if (Math.abs(c.beta) > 0.5) key.thr = 0;
    }
    c.step(DT, { steer: key.steer, throttle: key.thr, brake: key.brk, handbrake: false, tc: true }, T); t += DT;
    if (lastS > T.L - 30 && c.s < 30) { if (started) laps.push(t - lapStart); started = true; lapStart = t; }
    lastS = c.s; if (c.hitT === 0) hits++; if (c.offTrack) off += DT; maxB = Math.max(maxB, Math.abs(c.beta));
  }
  console.log(`${name} pace ${pace} wet ${wet}: laps ${laps.map(x => x.toFixed(1)).join(', ') || 'DNF'} | hits ${hits} | off ${off.toFixed(1)} s | maxBeta ${(maxB * 57.3).toFixed(0)}°`);
}
for (const n of ['e30', 'capri', 'stratos']) for (const p of [0.8, 0.9, 0.97]) lap(n, p, 0.6);
