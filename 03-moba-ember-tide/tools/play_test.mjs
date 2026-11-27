#!/usr/bin/env node
// 在无界面 Chrome 里按脚本操控英雄并连续截图，用来检查走路、普攻、技能。
// 用法: node tools/play_test.mjs <输出目录> '<步骤 JSON>' ["网址参数"] [宽] [高]
// 环境变量: HEADFUL=1 开真实的 Chrome 窗口（量帧率用）；DPR=2 按视网膜屏的像素密度渲染
// 步骤: {"rec":"文件名.webm"} 开始录屏、{"stop":1} 停止、{"js":"__play.key('KeyQ')"}、{"wait":300}、{"shot":"名字"}、{"burst":["前缀",张数,间隔毫秒]}、{"until":"条件表达式","timeout":毫秒}（等到条件成立）、{"click":[x,y]}、{"key":"KeyW"}
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const [out, stepsJson, query = "nohud=1", w = "1280", h = "720"] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: process.env.HEADFUL ? false : "new", protocolTimeout: 900000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", `--window-size=${w},${h}`] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: +w, height: +h, deviceScaleFactor: +(process.env.DPR || 1) });
  const errors = []; page.on("pageerror", e => errors.push(String(e).slice(0, 300))); page.on("console", m => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
  await page.goto((process.env.MOBA_URL || "http://localhost:5183/map.html") + "?" + query, { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true", { timeout: 90000 });
  const sleep = ms => new Promise(r => setTimeout(r, ms)), shot = n => page.screenshot({ path: `${out}/${n}.jpg`, type: "jpeg", quality: 88 });
  let rec = null;
  for (const s of JSON.parse(stepsJson)) {
    if (s.rec) rec = await page.screencast({ path: `${out}/${s.rec}` });
    if (s.stop && rec) { await rec.stop(); rec = null; }
    if (s.js) { const r = await page.evaluate(s.js); if (s.log) console.log(s.log, JSON.stringify(r)); }
    if (s.until) await page.waitForFunction(s.until, { timeout: s.timeout || 300000, polling: 100 });
    if (s.wait) await sleep(s.wait);
    if (s.shot) await shot(s.shot);
    if (s.click) await page.mouse.click(s.click[0], s.click[1], { button: s.button || "left" });
    if (s.move) await page.mouse.move(s.move[0], s.move[1]);
    if (s.key) await page.keyboard.press(s.key);
    if (s.burst) { const [pre, n, gap] = s.burst; for (let i = 0; i < n; i++) { await shot(`${pre}_${String(i).padStart(2, "0")}`); await sleep(gap); } }
  }
  console.log(JSON.stringify({ errors: errors.slice(0, 8), stats: await page.evaluate("({fps: Math.round(__stats.fps), calls: __stats.calls, state: window.__play && __play.state(), pos: window.__play && [__play.pos.x.toFixed(1), __play.pos.z.toFixed(1)]})") }));
} finally { await browser.close(); }
