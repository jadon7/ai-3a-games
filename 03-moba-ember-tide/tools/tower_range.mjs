#!/usr/bin/env node
// 塔射程的口径核实（第九轮）：开一局 3v3，开局第一波兵出来之前，把六个英雄挨个摆到对面中路外塔（和水晶）前面，量
//   · 英雄普攻能打到塔的最远距离（用控制器自己的 inReach 判断，从塔心量）；
//   · 塔能打到英雄的最远距离（真的站在那里等 1.3 秒，看塔有没有锁定他）。
// 第二项也用旧的射程（塔 9.5、水晶 10）各量一遍，放在旁边比。
// 用法: MOBA_URL=http://localhost:5201/map.html node tools/tower_range.mjs [输出.json]
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const out = process.argv[2];
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 600000, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio", "--window-size=960,540"] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 960, height: 540 });
  await page.goto((process.env.MOBA_URL || "http://localhost:5201/map.html") + "?h=vero&nofog=1&nohud=1&q=lite", { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true", { timeout: 120000 });
  const ev = s => page.evaluate(s), sleep = ms => new Promise(r => setTimeout(r, ms));
  await ev("__setSpeed(0); window.__bots.length = 0; 1");      // 电脑不许动（拿掉它们的大脑），时间先停住
  const res = await ev(`(() => {
    const S = __sim, T = S.ents.find(e => e.kind === "tower" && e.team === 1 && e.lane === 0 && e.tier === 1), C = S.ents.find(e => e.kind === "core" && e.team === 1);
    const out = { tower: { r: T.r, range: T.range }, core: { r: C.r, range: C.range }, heroes: {} };
    for (const a of __actors.values()) { const me = a.ent; if (me.team !== 0 && me.team !== 1) continue;
      const one = B => { let lo = 0, hi = 30; const ux = 1, uz = 0;
        for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; a.teleport(B.x - m * Math.SQRT1_2, B.z + m * Math.SQRT1_2); if (a.inReach(B)) lo = m; else hi = m; } return +lo.toFixed(2); };
      out.heroes[me.h.kit] = { range: me.h.stat.range, ranged: !!a.kit.ranged, r: me.r, tower: one(T), core: one(C) }; }
    return out; })()`);
  // 塔打英雄：把自己的英雄摆在塔前 D 米，其余英雄挪到远处，等 1.3 秒看塔锁没锁定他
  const towerReach = async (kind, rangeOverride) => {
    const find = kind === "tower" ? `__sim.ents.find(e => e.kind === "tower" && e.team === 1 && e.lane === 0 && e.tier === 1)` : `__sim.ents.find(e => e.kind === "core" && e.team === 1)`;
    let lo = 5, hi = 20;
    for (let i = 0; i < 9; i++) { const m = (lo + hi) / 2;
      await ev(`(() => { const B = ${find}; ${kind === "core" ? "B.open = true;" : ""} ${rangeOverride ? `B.range = ${rangeOverride};` : ""} B.target = null; B.cd = 0; for (const e of __sim.ents) if (e.kind === "melee" || e.kind === "ranged") { e.alive = false; e.hp = 0; } for (const a of __actors.values()) { if (a !== __play.actor) a.teleport(a.ent.team ? 60 : -60, a.ent.team ? 60 : -60); } __play.actor.stop(); __play.actor.teleport(B.x - ${m} * Math.SQRT1_2, B.z + ${m} * Math.SQRT1_2); __sim.hero.hp = __sim.hero.max; __setSpeed(1); })()`);
      await sleep(1300); const hit = await ev(`(() => { __setSpeed(0); const B = ${find}; return B.target === __sim.hero; })()`); if (hit) lo = m; else hi = m; }
    return +lo.toFixed(2); };
  res.towerHitsHero = { new: await towerReach("tower"), old: await towerReach("tower", 9.5) };
  res.coreHitsHero = { new: await towerReach("core"), old: await towerReach("core", 10) };
  console.log(JSON.stringify(res, null, 1)); if (out) fs.writeFileSync(out, JSON.stringify(res, null, 1));
} finally { await browser.close(); }
