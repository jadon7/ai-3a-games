// 方向盘抖动的无画面测试：高速跑赛道，记录前轮转角 c.steer，统计 60Hz 帧间的来回抖动
//   node tools/steer_jitter.mjs [车型,...] [km/h,...] [policy=line|zero|hold]
import { buildTrack } from '../src/track.js';
import { Car, CAR_SPECS } from '../src/physics.js';
import fs from 'node:fs';
const info = JSON.parse(fs.readFileSync(new URL('../assets/cars/cars.json', import.meta.url)));
for (const id of Object.keys(CAR_SPECS)) { const sp = CAR_SPECS[id], m = info[id]; if (!m) continue; const r = sp.cgFront / sp.wheelbase; sp.wheelbase = m.wheelbase; sp.cgFront = m.wheelbase * r; sp.trackF = m.trackFront; sp.trackR = m.trackRear; sp.wheelR = m.wheelRadiusRear; sp.length = m.length; sp.width = m.width; sp.frontOverhang = m.frontAxleToNose; sp.rearOverhang = m.rearAxleToTail; }
const T = buildTrack().buildRacingLine();
const a = process.argv.slice(2);
const cars = (a[0] || 'e30,p917,countach').split(','), speeds = (a[1] || '120,180,230').split(',').map(Number), policy = (a[2] || 'line');
const wrap = (x) => { while (x > Math.PI) x -= 2 * Math.PI; while (x < -Math.PI) x += 2 * Math.PI; return x; };
export function run(name, kmh, pol, visual = null) {
  const c = new Car(name, { isPlayer: true }); const p = T.offset(30, 0); c.reset(p.x, p.y, p.h, kmh / 3.6);
  const FR = 1 / 60, sub = 4, h = FR / sub; let t = 0; const st = [], vis = [];
  let vs = 0;
  while (t < 8) {
    const inp = { steer: 0, throttle: 1, brake: 0, handbrake: false, tc: true, arcade: true };
    if (c.speed * 3.6 > kmh + 2) { inp.throttle = 0; inp.brake = 0.4; } else if (c.speed * 3.6 > kmh - 3) inp.throttle = 0.4;
    if (pol === 'line') { const k = T.idx(c.s + 10 + c.speed * 0.5), e = wrap(Math.atan2(T.py[k] - c.y, T.px[k] - c.x) - c.yaw - c.beta); inp.steer = e < -0.02 ? -1 : e > 0.02 ? 1 : 0; }
    else if (pol === 'hold') inp.steer = t > 1 ? -0.6 : 0;
    for (let k = 0; k < sub; k++) c.step(h, inp, T);
    t += FR; st.push(c.steer);
    if (visual) { vs = visual(c, vs, FR); vis.push(vs); }
  }
  const m = (arr) => { let rev = 0, tv = 0, prev = 0; for (let i = 1; i < arr.length; i++) { const d = arr[i] - arr[i - 1]; tv += Math.abs(d); if (d * prev < 0 && Math.abs(d) > 1e-4) rev++; if (Math.abs(d) > 1e-4) prev = d; } const net = Math.abs(arr[arr.length - 1] - arr[0]); return { revPerS: +(rev / 8).toFixed(1), travelDegPerS: +(tv / 8 * 57.3).toFixed(1) }; };
  return { car: name, kmh, steer: m(st), wheel48: m(st.map(x => x * 4.8)), vis: visual ? m(vis) : null, beta: +(Math.abs(c.beta) * 57.3).toFixed(1) };
}
if (process.argv[1].endsWith("steer_jitter.mjs")) for (const n of cars) for (const v of speeds) { const r = run(n, v, policy); console.log(`${n.padEnd(9)} ${v}km/h  前轮 换向 ${r.steer.revPerS}/s 行程 ${r.steer.travelDegPerS}°/s | 方向盘(×4.8) 行程 ${r.wheel48.travelDegPerS}°/s`); }
