#!/usr/bin/env node
// 在真的对局里拍狼跑：把英雄传到最近的狼营地旁边，打一下引它们，马上往空地方向跑开，连拍它们追过来、追不上再跑回营地。
// 用法: node camp_run.mjs <输出目录>      产出: run_NN.jpg（1500×844 原图），并打印每拍三只狼的状态、离英雄多远、速度
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const out = process.argv[2] || "art/unit/wolf/camp_run"; fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 600000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1500,844"] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1500, height: 844 });
  await page.goto("http://localhost:5183/map.html?h=lan", { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true && window.__sim && window.__play", { timeout: 90000 });
  const ev = s => page.evaluate(s), sleep = ms => new Promise(r => setTimeout(r, ms));
  await page.waitForFunction("__sim.ents.some(e => e.kind === 'monster' && e.mob === 'wolf' && e.alive)", { timeout: 60000, polling: 300 });
  const camp = await ev(`(() => { const h = __sim.hero, ws = __sim.ents.filter(e => e.kind === 'monster' && e.mob === 'wolf' && e.alive); ws.sort((p, q) => Math.hypot(p.x - h.x, p.z - h.z) - Math.hypot(q.x - h.x, q.z - h.z)); const c = ws[0].camp, mine = ws.filter(e => e.camp === c);
    const cx = mine.reduce((s, e) => s + e.x, 0) / mine.length, cz = mine.reduce((s, e) => s + e.z, 0) / mine.length; window.__wolves = mine; return JSON.stringify({ cx, cz }); })()`).then(JSON.parse);
  // 找一个方向：从营地出去 14 米一路都能走（空地），英雄先站在这个方向上离营地 4.5 米处
  const dir = await ev(`(() => { const c = ${JSON.stringify(camp)}; let best = null; for (let k = 0; k < 32; k++) { const an = k / 32 * Math.PI * 2; let n = 0; for (let s = 3; s <= 16; s += 0.5) { if (!__nav.walkable(c.cx + Math.cos(an) * s, c.cz + Math.sin(an) * s)) break; n = s; } if (!best || n > best.n) best = { an, n }; }
    const a = __play.actor; a.teleport(c.cx + Math.cos(best.an) * 4.5, c.cz + Math.sin(best.an) * 4.5); return JSON.stringify(best); })()`).then(JSON.parse);
  console.log("空地方向能走", dir.n, "米"); await sleep(700);
  await ev("(() => { __play.attack(__wolves[0]); })()"); await page.waitForFunction("__wolves.some(e => e.state !== 'idle')", { timeout: 6000, polling: 50 }).catch(() => console.log("没引到")); await sleep(250);
  await ev(`(() => { const a = __play.actor, c = ${JSON.stringify(camp)}, an = ${dir.an}; a.moveTo(c.cx + Math.cos(an) * ${Math.min(dir.n, 15)}, c.cz + Math.sin(an) * ${Math.min(dir.n, 15)}); })()`);
  let prev = null; const rows = [];
  for (let i = 0; i < 40; i++) {
    await sleep(70); await page.screenshot({ path: `${out}/run_${String(i).padStart(2, "0")}.jpg`, type: "jpeg", quality: 88 });
    const s = await ev("JSON.stringify({ t: performance.now() / 1000, w: __wolves.map(e => ({ s: e.state, x: e.x, z: e.z, tg: !!e.target, d: Math.hypot(e.x - __sim.hero.x, e.z - __sim.hero.z) })) })").then(JSON.parse);
    if (prev) rows.push(i + ": " + s.w.map((w, k) => `${w.s}${w.tg ? "(追)" : ""} 离英雄 ${w.d.toFixed(1)} 速度 ${(Math.hypot(w.x - prev.w[k].x, w.z - prev.w[k].z) / (s.t - prev.t)).toFixed(1)}`).join(" | "));
    prev = s;
  }
  console.log(rows.filter((_, i) => i % 3 === 0).join("\n"));
} finally { await browser.close(); }
