#!/usr/bin/env node
// 在真的对局里拍狼的死亡：把英雄传到最近的狼营地旁边的空地上（不引它们），直接给离得最近的一只扣满血，连拍它倒下、躺着、沉下去。
// 用法: node camp_death.mjs <输出目录>      产出: death_NN.jpg（1500×844 原图）
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const out = process.argv[2] || "art/unit/wolf/camp_death"; fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 600000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1500,844"] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1500, height: 844 });
  await page.goto("http://localhost:5183/map.html?h=lan", { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true && window.__sim && window.__play", { timeout: 90000 });
  const ev = s => page.evaluate(s), sleep = ms => new Promise(r => setTimeout(r, ms));
  await page.waitForFunction("__sim.ents.some(e => e.kind === 'monster' && e.mob === 'wolf' && e.alive)", { timeout: 60000, polling: 300 });
  await ev(`(() => { const h = __sim.hero, ws = __sim.ents.filter(e => e.kind === 'monster' && e.mob === 'wolf' && e.alive); ws.sort((p, q) => Math.hypot(p.x - h.x, p.z - h.z) - Math.hypot(q.x - h.x, q.z - h.z)); const c = ws[0].camp, mine = ws.filter(e => e.camp === c);
    const cx = mine.reduce((s, e) => s + e.x, 0) / mine.length, cz = mine.reduce((s, e) => s + e.z, 0) / mine.length; window.__wolves = mine;
    let best = null; for (let k = 0; k < 32; k++) { const an = k / 32 * Math.PI * 2; let n = 0; for (let s = 3; s <= 16; s += 0.5) { if (!__nav.walkable(cx + Math.cos(an) * s, cz + Math.sin(an) * s)) break; n = s; } if (!best || n > best.n) best = { an, n }; }
    __play.actor.teleport(cx + Math.cos(best.an) * 6.5, cz + Math.sin(best.an) * 6.5); })()`);
  await sleep(1500);
  await page.screenshot({ path: `${out}/death_00.jpg`, type: "jpeg", quality: 90 });
  await ev("(() => { const h = __sim.hero, w = [...__wolves].sort((p, q) => Math.hypot(p.x - h.x, p.z - h.z) - Math.hypot(q.x - h.x, q.z - h.z))[0]; window.__victim = w; __sim.damage(w, 99999, null); })()");
  for (let i = 1; i < 24; i++) { await sleep(i < 16 ? 110 : 260); await page.screenshot({ path: `${out}/death_${String(i).padStart(2, "0")}.jpg`, type: "jpeg", quality: 90 }); }
  console.log(await ev("JSON.stringify({ alive: __victim.alive, others: __wolves.map(e => e.state) })"));
} finally { await browser.close(); }
