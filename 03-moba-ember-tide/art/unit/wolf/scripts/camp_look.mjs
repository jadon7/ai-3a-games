#!/usr/bin/env node
// 在真的对局里看狼（不是借英雄的位置）：等营地刷出来，把英雄传到最近的狼营地旁边，拍待机；打一只，拍它们反击、追、死。
// 用法: node camp_look.mjs <输出目录>      产出: idle_NN.jpg、fight_NN.jpg、chase_NN.jpg（1500×844 原图），并打印狼的状态变化
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const out = process.argv[2] || "art/unit/wolf/camp"; fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 600000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1500,844"] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1500, height: 844 });
  const errors = []; page.on("pageerror", e => errors.push(String(e).slice(0, 300)));
  await page.goto("http://localhost:5183/map.html?h=lan", { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true && window.__sim && window.__play", { timeout: 90000 });
  const ev = s => page.evaluate(s), sleep = ms => new Promise(r => setTimeout(r, ms));
  console.log("接口:", await ev("JSON.stringify({ play: Object.keys(__play), actor: Object.keys(__play.actor).slice(0, 40), sim: Object.keys(__sim).slice(0, 30) })"));
  await page.waitForFunction("__sim.ents.some(e => e.kind === 'monster' && e.mob === 'wolf' && e.alive)", { timeout: 60000, polling: 500 });
  const camp = await ev(`(() => { const h = __sim.hero, ws = __sim.ents.filter(e => e.kind === 'monster' && e.mob === 'wolf' && e.alive); ws.sort((p, q) => Math.hypot(p.x - h.x, p.z - h.z) - Math.hypot(q.x - h.x, q.z - h.z)); const c = ws[0].camp, mine = ws.filter(e => e.camp === c);
    const cx = mine.reduce((s, e) => s + e.x, 0) / mine.length, cz = mine.reduce((s, e) => s + e.z, 0) / mine.length; window.__wolves = mine; return JSON.stringify({ n: mine.length, cx, cz, hero: [h.x, h.z], mobs: mine.map(e => ({ id: e.id, x: +e.x.toFixed(1), z: +e.z.toFixed(1), hp: e.hp, state: e.state })) }); })()`).then(JSON.parse);
  console.log("最近的狼营地:", JSON.stringify(camp));
  // 传到营地旁边：从营地往英雄原来的方向退 5 米，找一个能站的点
  const spot = await ev(`(() => { const a = __play.actor, c = ${JSON.stringify(camp)}; let best = null; for (let k = 0; k < 24; k++) { const an = k / 24 * Math.PI * 2, x = c.cx + Math.cos(an) * 5.5, z = c.cz + Math.sin(an) * 5.5; if (__nav.walkable(x, z)) { const d = Math.hypot(x - c.hero[0], z - c.hero[1]); if (!best || d < best.d) best = { x, z, d }; } } a.teleport(best.x, best.z); return JSON.stringify(best); })()`).then(JSON.parse);
  console.log("英雄传到:", JSON.stringify(spot)); await sleep(1500);
  for (let i = 0; i < 4; i++) { await page.screenshot({ path: `${out}/idle_${String(i).padStart(2, "0")}.jpg`, type: "jpeg", quality: 88 }); await sleep(600); }
  const st = () => ev("JSON.stringify(__wolves.map(e => ({ s: e.state, hp: Math.round(e.hp), alive: e.alive, d: +Math.hypot(e.x - __sim.hero.x, e.z - __sim.hero.z).toFixed(1) })))");
  // 让英雄别还手太快把狼打死：只打一下引它们过来，然后站着挨打
  await ev("(() => { __play.attack(__wolves[0]); })()"); const log = [];
  for (let i = 0; i < 26; i++) { await sleep(110); await page.screenshot({ path: `${out}/fight_${String(i).padStart(2, "0")}.jpg`, type: "jpeg", quality: 88 }); if (i % 3 === 0) log.push(i + ":" + await st()); if (i === 4) await ev("(() => { __play.actor.stop && __play.actor.stop(); })()"); }
  console.log("打起来以后:", log.join("\n  "));
  // 跑开，拍它们追
  await ev(`(() => { const a = __play.actor, c = ${JSON.stringify(camp)}; const dx = a.pos.x - c.cx, dz = a.pos.z - c.cz, L = Math.hypot(dx, dz); a.moveTo(a.pos.x + dx / L * 7, a.pos.z + dz / L * 7); })()`); const log2 = [];
  for (let i = 0; i < 14; i++) { await sleep(110); await page.screenshot({ path: `${out}/chase_${String(i).padStart(2, "0")}.jpg`, type: "jpeg", quality: 88 }); if (i % 3 === 0) log2.push(i + ":" + await st()); }
  console.log("跑开以后:", log2.join("\n  "));
  // 回去把一只打死，拍死亡
  await ev("(() => { const w = __wolves.filter(e => e.alive).sort((p, q) => p.hp - q.hp)[0]; window.__victim = w; __play.attack(w); })()"); const log3 = []; let deadAt = -1;
  for (let i = 0; i < 60; i++) { await sleep(120); const dead = await ev("!__victim.alive"); if (dead && deadAt < 0) deadAt = i; if (deadAt >= 0 && i - deadAt < 16) await page.screenshot({ path: `${out}/death_${String(i - deadAt).padStart(2, "0")}.jpg`, type: "jpeg", quality: 88 }); if (deadAt >= 0 && i - deadAt >= 16) break; if (i % 5 === 0) log3.push(i + ":" + await st()); }
  console.log("打死一只:", deadAt >= 0 ? "第 " + deadAt + " 拍死的" : "没打死", log3.slice(-3).join("\n  ")); console.log("错误:", JSON.stringify(errors.slice(0, 3)));
} finally { await browser.close(); }
