#!/usr/bin/env node
// 结束演出的连续帧（第九轮）：开一局，直接把一方的水晶打爆，按真实时间每隔 gap 毫秒截一张。
// 用法: node tools/end_frames.mjs <输出目录> <win|lose> [张数=16] [间隔毫秒=260] [网址参数=h=lan]
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const [out, which = "win", n = "16", gap = "260", q = "h=lan"] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1280,720"] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 720 });
  const errors = []; page.on("pageerror", e => errors.push(String(e).slice(0, 300)));
  await page.goto((process.env.MOBA_URL || "http://localhost:5202/map.html") + "?" + q, { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true", { timeout: 120000 }); await new Promise(r => setTimeout(r, 2500));
  // 镜头先放到水晶旁边，再打爆它
  await page.evaluate(`(()=>{ const c = __sim.ents.find(e => e.kind === "core" && e.team === ${which === "win" ? 1 : 0}); __play.follow = false; c.open = true; for (const t of __sim.ents) if (t.kind==="tower" && t.team===c.team) { t.alive=false; } __sim.reveal = true; window.__core = c; return 1; })()`);
  await new Promise(r => setTimeout(r, 1500));
  await page.evaluate(`(()=>{ const c = window.__core; __sim.damage(c, 1e9, null); return __sim.over; })()`);
  for (let i = 0; i < +n; i++) { await page.screenshot({ path: `${out}/${which}_${String(i).padStart(2, "0")}.jpg`, type: "jpeg", quality: 86 }); await new Promise(r => setTimeout(r, +gap)); }
  console.log(JSON.stringify({ errors }));
} finally { await browser.close(); }
