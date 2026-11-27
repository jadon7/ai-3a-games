#!/usr/bin/env node
// 数每段演示的峰值（录像模式一帧一帧推，和机器快慢无关）：整帧绘制次数（减去不放特效时的底数就是特效多画的）、零件库自己的网格数、屏幕演出多画的遍数、火花粒子、线 / 星芒 / 环 / 残影
// 用法：node tools/measure.mjs [网址参数]
import puppeteer from "puppeteer-core";
const [query = ""] = process.argv.slice(2);
const base = process.env.LAB_URL || "http://localhost:5255/lab/fx_iti/index.html";
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--hide-scrollbars", "--mute-audio", "--window-size=1600,900"] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1600, height: 900 });
  await page.goto(`${base}?cap=1&nohud=1${query ? "&" + query : ""}`, { waitUntil: "load" });
  await page.waitForFunction("window.__lab && window.__lab.ready", { timeout: 90000 });
  for (const d of ["attack", "passive", "q", "w", "e", "r", "combo"]) {
    const r = await page.evaluate(async d => { const L = window.__lab; L.stage(d); let base = 0; for (let i = 0; i < 4; i++) base = L.step(1 / 30).calls; L.play(d);
      const pk = { calls: 0, kitDraws: 0, passes: 0, particles: 0, lines: 0, stars: 0, rings: 0, ghosts: 0 }, n = Math.round((L.demos[d].duration + 0.8) * 30);
      for (let i = 0; i < n; i++) { const s = L.step(1 / 30), k = s.kit; pk.calls = Math.max(pk.calls, s.calls); pk.passes = Math.max(pk.passes, s.passes); pk.kitDraws = Math.max(pk.kitDraws, k.draws); for (const m of ["particles", "lines", "stars", "rings", "ghosts"]) pk[m] = Math.max(pk[m], k[m]); }
      return { base, extra: pk.calls - base, ...pk }; }, d);
    console.log(JSON.stringify({ demo: d, ...r }));
  }
} finally { await browser.close(); }
