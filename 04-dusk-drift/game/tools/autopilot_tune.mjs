// 给自动驾驶的每个漂移弯离线搜参数：node tools/autopilot_tune.mjs 弯号 [车型,...]
// 打分：干净漂过的车数优先，其次漂移时长（观赏性）、出界、撞墙、最低车速；输出前 5 组，填进 src/autopilot.js 的 ZONE_TUNE
import { zoneRun } from './autopilot_zone.mjs';
const zi = +process.argv[2], cars = (process.argv[3] || 'e30,mustang,stratos').split(',');
const grid = [];
for (const vk of [0.9, 1, 1.1]) for (const lead of [-3, 0, 4]) for (const app of [null, 1.5, 3.2]) for (const outE of [0, 1.5, 3]) for (const hbOn of [0.06, 0.1, 0.16]) grid.push({ vk, lead, app, outE, hbOn });
const res = [];
for (const g of grid) {
  globalThis.__APZ = { [zi]: g };
  let clean = 0, drift = 0, off = 0, hits = 0, minV = 999, t = 0;
  for (const n of cars) { const r = zoneRun(n, zi); const ok = r.done && r.off < 0.05 && !r.hits && r.drift > 0.8; clean += ok; drift += r.drift; off += r.off; hits += r.hits; minV = Math.min(minV, r.minV); t += r.t; }
  const k = cars.length, score = clean * 100 + Math.min(drift / k, 5) * 6 - off * 15 - hits * 8 + Math.min(minV, 45) * 0.4 - t / k;
  res.push({ g, clean, drift: +(drift / k).toFixed(1), off: +off.toFixed(2), hits, minV, t: +(t / k).toFixed(1), score: +score.toFixed(1) });
}
res.sort((a, b) => b.score - a.score);
console.log(`Z${zi} 前 5：`);
for (const r of res.slice(0, 5)) console.log(JSON.stringify(r));
