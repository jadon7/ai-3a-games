#!/usr/bin/env node
// 不锁 60 帧量帧率（换画风 B · b-toon 加的）：无界面 Chrome 关掉垂直同步，开一个固定机位的页面，等地面细图都到齐，再每秒读一次 __stats.fps，读 n 次取中位数。
// 用来比“改前 / 改后”同一个机位谁快谁慢：几个页面轮流开、各量几轮，抵掉别的任务抢显卡带来的波动（单次的绝对数不可信，看相对）。
// 用法: node tools/fps_uncap.mjs <读几秒> "<名字>|<完整网址>" ["<名字>|<完整网址>" …]   （按给的顺序轮流量 ROUNDS 轮，默认 3）
//   例: node tools/fps_uncap.mjs 6 "前|http://localhost:5190/map.html?cam=-20,2,36,50,0,-20&nohud=1&hero=0" "后|http://localhost:5221/map.html?cam=-20,2,36,50,0,-20&nohud=1&hero=0"
import puppeteer from "puppeteer-core";
const [secs = "6", ...pages] = process.argv.slice(2), ROUNDS = +(process.env.ROUNDS || 3);
const res = Object.fromEntries(pages.map(p => [p.split("|")[0], []]));
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 300000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1920,1080", "--disable-frame-rate-limit", "--disable-gpu-vsync"] });
try {
  for (let r = 0; r < ROUNDS; r++) for (const p of pages) {
    const [name, url] = p.split("|"), page = await browser.newPage(); await page.setViewport({ width: +(process.env.W || 1920), height: +(process.env.H || 1080) });
    await page.goto(url, { waitUntil: "load", timeout: 90000 }); await page.waitForFunction("window.__ready === true", { timeout: 120000 });
    await new Promise(r => setTimeout(r, 4000));
    const xs = []; for (let i = 0; i < +secs; i++) { await new Promise(r => setTimeout(r, 1000)); xs.push(await page.evaluate("__stats.fps")); }
    xs.sort((a, b) => a - b); res[name].push(Math.round(xs[xs.length >> 1])); await page.close();
  }
} finally { await browser.close(); }
for (const [k, v] of Object.entries(res)) { const s = [...v].sort((a, b) => a - b); console.log(`${k}\t每轮 ${v.join(" / ")}\t中位数 ${s[s.length >> 1]}`); }
