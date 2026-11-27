// 双界试炼回归检查（开发用）：页面带 ?map=rift&mute 打开后，在控制台里 `await import('/tools/rift_probe.js')`。
// 用示范演示的脚本（src/game/riftdemo.js）不渲染地快进跑完全程，报告用时、切换 / 坠落 / 处决次数、阵亡、最低血量、卡住重来的次数。
//   __rift.run(次数 = 3, 每帧步长 = 1/60)   → 每次一行结果；全程零阵亡、零重来才算通过
const d = window.__dbg, g = d.game, p = g.player;
if (!g.rift) throw new Error('需要 ?map=rift');
window.__errs = window.__errs || []; window.addEventListener('error', (e) => window.__errs.push(e.message));
const R = g.rift; const orig = R.respawn.bind(R); let resp = [];
R.respawn = (fall) => { resp.push([fall ? '坠落' : p.alive ? '卡住' : '阵亡', '第' + (g.auto ? g.auto.sec : '?') + '段', p.pos.toArray().map((v) => +v.toFixed(1)).join(','), RIFT(g.phase), R.t.toFixed(1) + 's'].join(' ')); return orig(fall); };
const RIFT = (k) => (k ? '蜃界' : '现世');
const once = (dt, wall = 8000) => {
  resp = []; d.demo(true); const A = g.auto; let n = 0; const t0 = performance.now(); let minHp = 100; d.engine.render = () => {};
  try { while (performance.now() - t0 < wall && n < 240 / dt && !R.done) { d.step(1, dt, 0); n++; if (p.alive) minHp = Math.min(minHp, p.hp); } } finally { delete d.engine.render; }
  const pass = R.done && g.stats.deaths === 0 && A.stat.rescues === 0 && A.stat.restarts === 0 && R.stats.falls === 0;
  return { pass, done: R.done, t: +R.t.toFixed(1), shifts: R.stats.shifts, falls: R.stats.falls, executes: R.stats.executes, deaths: g.stats.deaths, kills: g.stats.kills, minHp: Math.round(minHp), rescues: A.stat.rescues, restarts: A.stat.restarts, respawns: resp };
};
window.__rift = { run(n = 3, dt = 1 / 60) { const out = []; for (let i = 0; i < n; i++) out.push(once(dt)); return { pass: out.every((r) => r.pass), runs: out, errs: window.__errs.slice(0, 5) }; } };
