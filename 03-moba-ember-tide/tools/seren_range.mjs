#!/usr/bin/env node
// 塞伦的射程和塔（第九轮 k-seren）：开一局，把自己的塞伦升到 1、6、11、15 级，在对面中路外塔和水晶前面量
//   · 她的普攻能打到塔（水晶）的最远距离（控制器自己的 inReach，从塔心量）；
//   · 塔（水晶）能打到她的最远距离（真的站在那里等 1.3 秒，看塔有没有锁定她；塔下没有小兵）。
// 第二项和等级无关，量一次。照 tools/tower_range.mjs 的写法。
// 用法: MOBA_URL=http://localhost:5214/map.html node tools/seren_range.mjs [输出.json]
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const out = process.argv[2];
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 600000, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio", "--window-size=960,540"] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 960, height: 540 });
  await page.goto((process.env.MOBA_URL || "http://localhost:5214/map.html") + "?h=seren&nofog=1&nohud=1&q=lite", { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true", { timeout: 120000 });
  const ev = s => page.evaluate(s), sleep = ms => new Promise(r => setTimeout(r, ms));
  await ev("__setSpeed(0); window.__bots.length = 0; 1");
  const find = kind => kind === "tower" ? `__sim.ents.find(e => e.kind === "tower" && e.team === 1 && e.lane === 0 && e.tier === 1)` : `__sim.ents.find(e => e.kind === "core" && e.team === 1)`;
  const res = { levels: {} };
  for (const lv of [1, 6, 11, 15]) {
    await ev(`(() => { const h = __sim.hero; while (h.h.level < ${lv}) __sim.gainXp(h, 40); __play.actor.update(0.016, 30); return 1; })()`);      // passive 每帧把射程按等级补上
    res.levels[lv] = await ev(`(() => { const a = __play.actor, me = a.ent, T = ${find("tower")}, C = ${find("core")};
      const one = B => { let lo = 0, hi = 30; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; a.teleport(B.x - m * Math.SQRT1_2, B.z + m * Math.SQRT1_2); if (a.inReach(B)) lo = m; else hi = m; } return +lo.toFixed(2); };
      return { level: me.h.level, range: +me.h.stat.range.toFixed(2), hitsTower: one(T), hitsCore: one(C) }; })()`);
  }
  const towerReach = async kind => { let lo = 5, hi = 20;
    for (let i = 0; i < 9; i++) { const m = (lo + hi) / 2;
      await ev(`(() => { const B = ${find(kind)}; ${kind === "core" ? "B.open = true;" : ""} B.target = null; B.cd = 0; for (const e of __sim.ents) if (e.kind === "melee" || e.kind === "ranged") { e.alive = false; e.hp = 0; } for (const a of __actors.values()) { if (a !== __play.actor) a.teleport(a.ent.team ? 60 : -60, a.ent.team ? 60 : -60); } __play.actor.stop(); __play.actor.teleport(B.x - ${m} * Math.SQRT1_2, B.z + ${m} * Math.SQRT1_2); __sim.hero.hp = __sim.hero.max; __setSpeed(1); })()`);
      await sleep(1300); const hit = await ev(`(() => { __setSpeed(0); const B = ${find(kind)}; return B.target === __sim.hero; })()`); if (hit) lo = m; else hi = m; }
    return +lo.toFixed(2); };
  res.towerHitsHero = await towerReach("tower"); res.coreHitsHero = await towerReach("core");
  // 实打：满级的塞伦站在能打到塔的最远处、右键塔，看塔是不是回头打她（塔下没有小兵）
  res.duel = await ev(`(async () => { const a = __play.actor, B = ${find("tower")}; B.target = null; B.cd = 0; const d = ${res.levels[15].hitsTower} - 0.05; a.teleport(B.x - d * Math.SQRT1_2, B.z + d * Math.SQRT1_2); __sim.hero.hp = __sim.hero.max; const hp0 = __sim.hero.hp, t0 = B.hp; a.attack(B); __setSpeed(1);
    await new Promise(r => setTimeout(r, 3000)); __setSpeed(0); return { stoodAt: +Math.hypot(a.pos.x - B.x, a.pos.z - B.z).toFixed(2), towerLost: Math.round(t0 - B.hp), heroLost: Math.round(hp0 - __sim.hero.hp), towerTarget: B.target === __sim.hero }; })()`);
  console.log(JSON.stringify(res, null, 1)); if (out) fs.writeFileSync(out, JSON.stringify(res, null, 1));
} finally { await browser.close(); }
