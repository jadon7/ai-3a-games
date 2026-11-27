#!/usr/bin/env node
// 团战帧率（第九轮）：开一局观战（六个都是电脑），16 倍速快进到有一场 2 对 2 以上的团战，切回 1 倍速，导播的镜头跟着团战，每秒读一次 __stats.fps，读 n 次。
// 用法: node tools/fps_fight.mjs [网址参数=director=1&h=lan] [读几次=10]
// 量之前别开别的 Chrome。无界面 Chrome 默认锁 60 帧（垂直同步），所以电脑档看的是“掉没掉到 60 以下”。
import puppeteer from "puppeteer-core";
const [q = "director=1&h=lan", n = "10"] = process.argv.slice(2);
const N = +(process.env.FIGHT_N || 2);      // 第九轮 5v5：FIGHT_N=4 等到两边各四个人以上挤在一起（下路本来就是二对二，按两个人算一开局就触发了）
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 900000, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1920,1080"] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1920, height: 1080 });
  await page.goto((process.env.MOBA_URL || "http://localhost:5202/map.html") + "?" + q, { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true", { timeout: 120000 });
  await page.evaluate("__setSpeed(16)");
  await page.waitForFunction(`(()=>{ const hs = __sim.heroes().filter(e => e.alive); for (const a of hs) { const near = hs.filter(b => Math.hypot(a.x-b.x, a.z-b.z) < (N > 2 ? 16 : 13)); if (near.filter(b=>b.team===0).length >= ${N} && near.filter(b=>b.team===1).length >= ${N}) return true; } return false; })()`, { timeout: 900000, polling: 200 });
  await page.evaluate("__setSpeed(1)"); await new Promise(r => setTimeout(r, 1500));
  const out = [];
  for (let i = 0; i < +n; i++) { await new Promise(r => setTimeout(r, 1000)); out.push(await page.evaluate("({ fps: Math.round(__stats.fps), calls: __stats.calls, tris: __stats.tris, t: Math.round(__sim.time) })")); }
  const f = out.map(o => o.fps); console.log(JSON.stringify({ q, min: Math.min(...f), avg: Math.round(f.reduce((a, b) => a + b, 0) / f.length), samples: out }));
} finally { await browser.close(); }
