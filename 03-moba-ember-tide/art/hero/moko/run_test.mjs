#!/usr/bin/env node
// 摩珂自己用：在测试场里让英雄跑一段、再让她倒下，各连拍几张（kit_test 只测普攻和技能）。只读页面上给测试用的全局量，不改游戏。
// 用法: node art/hero/moko/run_test.mjs <输出目录>
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const out = process.argv[2]; fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 600000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1500,844"] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1500, height: 844 });
  const errors = []; page.on("pageerror", e => errors.push(String(e).slice(0, 300)));
  await page.goto("http://localhost:5183/map.html?arena=1&h=moko", { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true && window.__arena", { timeout: 90000 });
  const ev = s => page.evaluate(s), sleep = ms => new Promise(r => setTimeout(r, ms));
  await sleep(1200);
  for (let i = 0; i < 4; i++) { await page.screenshot({ path: `${out}/idle_${String(i).padStart(2, "0")}.jpg`, type: "jpeg", quality: 88 }); await sleep(900); }
  const p0 = await ev("(() => { const a = __play.actor; return [a.pos.x, a.pos.z]; })()");
  const tgt = await ev("(() => { const a = __play.actor; let [x, z] = [a.pos.x + 9, a.pos.z - 9]; if (!__nav.walkable(x, z)) [x, z] = __nav.nearest(x, z); a.moveTo(x, z); return [x, z]; })()");
  await sleep(350);
  const t0 = Date.now(), log = [];
  for (let i = 0; i < 10; i++) { await page.screenshot({ path: `${out}/run_${String(i).padStart(2, "0")}.jpg`, type: "jpeg", quality: 88 }); log.push([Date.now() - t0, await ev("(() => { const a = __play.actor; return [+a.pos.x.toFixed(2), +a.pos.z.toFixed(2), a.state()]; })()")]); await sleep(40); }
  await sleep(2500);
  await ev("(() => { const h = __sim.hero; __sim.damage(h, h.max * 10, null, { type: 'true' }); })()").catch(async () => { await ev("__sim.hero.hp = 0; __sim.hero.alive = false;"); });
  for (let i = 0; i < 10; i++) { await page.screenshot({ path: `${out}/death_${String(i).padStart(2, "0")}.jpg`, type: "jpeg", quality: 88 }); await sleep(90); }
  console.log(JSON.stringify({ p0, tgt, log, state: await ev("__play.actor.state()"), meta: await ev("JSON.stringify(__play.actor.meta)"), errors }));
} finally { await browser.close(); }
