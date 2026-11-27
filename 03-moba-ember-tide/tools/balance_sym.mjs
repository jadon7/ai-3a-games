#!/usr/bin/env node
// 第九轮 balance：查地图两边（左下 0 队、右上 1 队）对不对称。两部分：
//   1. 量（不跑对局）：三条兵线每队走的总长、从出兵点走到自己每座塔和对面每座塔的路程；从每队出生点寻路到自己的野怪营地、两只 Boss、两座外塔的路程；
//      出生点五个格子、营地、塔的位置照河道（u → -u）镜像以后差多少。
//   2. 只放小兵（?solo=1，自己的英雄站在出生点不动、没有电脑）：16 倍速跑 sec 秒，每条线记两队第一波兵在哪碰上（离中点多远）、
//      之后每 30 秒两队最前面的兵各在哪、每座塔还剩多少血、哪座先倒。两边对称的话，碰头的位置在河道正中、塔一起掉血。
// 用法: MOBA_URL=http://localhost:5219/map.html node tools/balance_sym.mjs <输出.json> [秒=900]
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const [out, sec = "900"] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 1800000, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1280,720"] });
const R = { errors: [] };
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 720 });
  page.on("pageerror", e => R.errors.push(String(e).slice(0, 240)));
  await page.goto((process.env.MOBA_URL || "http://localhost:5219/map.html") + "?solo=1&h=lan&nofog=1&nohud=1", { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true && window.__sim", { timeout: 180000 });
  await page.evaluate("__setSpeed(0)");
  // ---- 1. 静态的量 ----
  R.static = await page.evaluate(`(() => {
    const S = __sim, N = __nav, SQ = Math.SQRT2, u = (x, z) => (x - z) / SQ, v = (x, z) => (x + z) / SQ, r1 = n => Math.round(n * 10) / 10;
    const plen = (ax, az, bx, bz) => { const p = N.path(ax, az, bx, bz); let l = 0, px = ax, pz = az; for (const [x, z] of p) { l += Math.hypot(x - px, z - pz); px = x; pz = z; } return r1(l + Math.hypot(bx - px, bz - pz)); };
    const lanes = [0, 1, 2].map(l => { const T = S.laneLen(l), tw = S.ents.filter(e => e.kind === "tower" && e.lane === l).map(t => ({ team: t.team, tier: t.tier, s0: r1(S.onLane(l, 0, t.x, t.z)[0]), s1: r1(S.onLane(l, 1, t.x, t.z)[0]), u: r1(u(t.x, t.z)), v: r1(v(t.x, t.z)) }));
      const pts = S.lanes[l].pts, mid = S.along(l, 0, T / 2); return { lane: ["中", "上", "下"][l], len: r1(T), midU: r1(u(mid[0], mid[1])), midV: r1(v(mid[0], mid[1])), start0: pts[0].map(r1), end: pts[pts.length - 1].map(r1), towers: tw }; });
    const fz = S.fountain, camps = S.camps.map(c => ({ kind: c.kind, mob: c.mob, side: c.side, top: c.top, buff: c.buff, u: r1(u(c.x, c.z)), v: r1(v(c.x, c.z)), from0: plen(fz[0][0], fz[0][1], c.x, c.z), from1: plen(fz[1][0], fz[1][1], c.x, c.z) }));
    const t1 = S.ents.filter(e => e.kind === "tower" && e.tier === 1).map(t => ({ team: t.team, lane: t.lane, from0: plen(fz[0][0], fz[0][1], t.x, t.z), from1: plen(fz[1][0], fz[1][1], t.x, t.z) }));
    return { fountain: fz.map(f => [r1(u(f[0], f[1])), r1(v(f[0], f[1]))]), lanes, camps, t1 };
  })()`);
  // ---- 2. 只放小兵 ----
  await page.evaluate(`(() => { const S = __sim, B = window.__sym = { meet: [null, null, null], log: [], fall: [] }; const ev = S.events, push0 = ev.push;
    ev.push = function (...xs) { for (const x of xs) { if (x.t === "hit" && x.src && (x.src.kind === "melee" || x.src.kind === "ranged") && (x.e.kind === "melee" || x.e.kind === "ranged") && !B.meet[x.e.lane]) B.meet[x.e.lane] = { t: Math.round(S.time * 10) / 10, u: Math.round(((x.e.x - x.e.z) / Math.SQRT2 + (x.src.x - x.src.z) / Math.SQRT2) * 5) / 10 };
      if (x.t === "die" && x.e.kind === "tower") B.fall.push({ t: Math.round(S.time), team: x.e.team, lane: x.e.lane, tier: x.e.tier }); } return push0.apply(this, xs); }; })()`);
  await page.evaluate("__setSpeed(16)");
  let next = 30;
  for (;;) { await new Promise(r => setTimeout(r, 250)); const t = await page.evaluate("__sim.time"); if (t >= next) { next += 30;
      await page.evaluate(`(() => { const S = __sim, B = window.__sym, row = { t: Math.round(S.time), front: [], towers: [] };
        for (const l of [0, 1, 2]) { const T = S.laneLen(l), f = [0, 1].map(tm => { const ms = S.ents.filter(m => m.alive && m.team === tm && (m.kind === "melee" || m.kind === "ranged") && m.lane === l); if (!ms.length) return null; const s = Math.max(...ms.map(m => S.onLane(l, tm, m.x, m.z)[0])); return Math.round((s - T / 2) * 10) / 10; }); row.front.push(f); }
        row.towers = S.ents.filter(e => e.kind === "tower" || e.kind === "core").map(e => ({ team: e.team, lane: e.lane, tier: e.tier, kind: e.kind, hp: Math.round(e.hp), alive: e.alive })); B.log.push(row); })()`); }
    if (t >= +sec || await page.evaluate("__sim.over")) break; }
  R.run = await page.evaluate("({ ...window.__sym, over: __sim.over, t: Math.round(__sim.time) })");
} finally { await browser.close(); }
fs.writeFileSync(out, JSON.stringify(R, null, 1));
const S = R.static; console.log("兵线（每队从自己的出兵点到对面出兵点）: " + S.lanes.map(l => `${l.lane} ${l.len} 米，中点 u=${l.midU}`).join("；"));
for (const l of S.lanes) console.log(`  ${l.lane}路的塔（离 0 队出兵点 / 离 1 队出兵点）: ` + l.towers.sort((a, b) => a.team - b.team || a.tier - b.tier).map(t => `${t.team}队${t.tier}塔 ${t.s0}/${t.s1}`).join("  "));
console.log("营地（离 0 队出生点 / 离 1 队出生点 的寻路路程）: " + S.camps.map(c => `${c.side === 2 ? c.mob : c.side + "队" + (c.top ? "上" : "下") + (c.buff || c.mob)} ${c.from0}/${c.from1}`).join("；"));
console.log("外塔（离 0 队出生点 / 离 1 队出生点）: " + S.t1.map(t => `${t.team}队${["中", "上", "下"][t.lane]} ${t.from0}/${t.from1}`).join("；"));
console.log("第一波兵碰头（离兵线中点的 u，负数偏 0 队）: " + R.run.meet.map((m, l) => `${["中", "上", "下"][l]} ${m ? m.u + " 米（" + m.t + " 秒）" : "-"}`).join("；"));
console.log("塔倒的顺序: " + (R.run.fall.map(f => `${f.t}s ${f.team}队${["中", "上", "下"][f.lane]}${f.tier}塔`).join("，") || "没有") + `；结束 ${R.run.t}s over=${R.run.over}`);
const last = R.run.log[R.run.log.length - 1]; if (last) { const hp = tm => last.towers.filter(e => e.team === tm).reduce((s, e) => s + (e.alive ? e.hp : 0), 0); console.log(`最后（${last.t}s）两队塔和水晶的血合计: 0 队 ${hp(0)}，1 队 ${hp(1)}`); }
