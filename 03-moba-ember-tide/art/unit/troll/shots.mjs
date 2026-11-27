#!/usr/bin/env node
// 在查看页里把指定动作定在指定时刻、指定视角截图（tools/anim_sheet.mjs 只能均匀抽帧；这个用来盯某一刻，比如拳头着地、跪到地上的那一帧）。
// 用法: node art/unit/troll/shots.mjs <输出目录> <模型在查看页里的身高，如 3.2> <动作:秒:视角,动作:秒:视角,…> [边长=640]
//   视角是查看页自带的：close、game（游戏里的俯视）、front、side、back、wide、wside。秒可以写 end（最后一帧）。
// 产出: <输出目录>/<动作>_<秒>_<视角>.jpg。关浏览器偶尔会卡住（显卡忙的时候），所以截完等 3 秒关不掉就直接退出。
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const [out, height, list, size = "640"] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", `--window-size=${size},${size}`] });
const page = await browser.newPage(); await page.setViewport({ width: +size, height: +size });
const errors = []; page.on("pageerror", e => errors.push(String(e).slice(0, 200)));
await page.goto(`http://localhost:5183/viewer.html?model=/assets/unit/troll.glb&height=${height}&ui=0&t=0`, { waitUntil: "load" });
await page.waitForFunction("window.__ready === true", { timeout: 60000 });
const clips = Object.fromEntries(await page.evaluate("window.__stats.clips")); const done = [];
for (const item of list.split(",")) {
  const [a, ts, v] = item.split(":"); const t = ts === "end" ? clips[a] : +ts;
  await page.evaluate(`window.__pose(${JSON.stringify(a)}, ${t}, ${JSON.stringify(v)})`); await new Promise(r => setTimeout(r, 120));
  const f = `${out}/${a}_${ts}_${v}.jpg`; await page.screenshot({ path: f, type: "jpeg", quality: 88 }); done.push(f);
}
console.log(JSON.stringify({ clips, shots: done.length, errors }));
await Promise.race([browser.close(), new Promise(r => setTimeout(r, 3000))]); process.exit(0);
