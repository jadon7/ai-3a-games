#!/usr/bin/env node
// 数一段演示的峰值：特效绘制次数、火花粒子数、同时在场的刀气线 / 星芒 / 冲击环（录像模式一帧一帧推，和机器快慢无关）
// 用法：node tools/measure.mjs [网址参数]
import puppeteer from "puppeteer-core";
const [query = ""] = process.argv.slice(2);
const base = process.env.LAB_URL || "http://localhost:5252/lab/fx_iti/index.html";
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--hide-scrollbars", "--mute-audio", "--window-size=1280,720"] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 720 });
  await page.goto(`${base}?cap=1&nohud=1${query ? "&" + query : ""}`, { waitUntil: "load" });
  await page.waitForFunction("window.__lab && window.__lab.ready", { timeout: 90000 });
  for (const d of ["r", "q", "passive"]) {
    const r = await page.evaluate(async d => { const L = window.__lab; L.stage(d); L.play(d); const pk = { draws: 0, particles: 0, lines: 0, stars: 0, rings: 0, ghosts: 0 };
      for (let i = 0; i < 90; i++) { const s = L.step(1 / 30); const k = window.__kit.stats(); pk.draws = Math.max(pk.draws, s.fxCalls); for (const n of ["particles", "lines", "stars", "rings", "ghosts"]) pk[n] = Math.max(pk[n], k[n]); }
      return pk; }, d);
    console.log(JSON.stringify({ demo: d, query, ...r }));
  }
} finally { await browser.close(); }
