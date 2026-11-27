#!/usr/bin/env node
// 在测试场里把巨兽的某几段动作按原速各播一遍、连拍（共用的 kit_test.mjs 只能出普攻，而且是按岚的攻速加速过的；咆哮、死亡出不来）。
// 用法（在 MOBA 根目录）: node art/unit/beast/scripts/arena_clip.mjs <输出目录> <动作,动作…> [张数=10] [地址参数]
// 产出: <输出目录>/<动作>.jpg（裁掉界面的连拍）和 <动作>_NN.jpg（单张原图）
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const [out, clips, n = "10", q = "glb=../unit/beast&look=height:3.3,ring:3.2,bar:0.4"] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 600000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1500,844"] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1500, height: 844 }); const errors = []; page.on("pageerror", e => errors.push(String(e).slice(0, 200)));
  await page.goto(`http://localhost:5183/map.html?arena=1&h=lan&${q}`, { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true && window.__arena", { timeout: 90000 });
  const sleep = ms => new Promise(r => setTimeout(r, ms)); await sleep(1200);
  const lost = await page.evaluate("(() => { const c = document.querySelector('canvas'), g = c.getContext('webgl2'); return g ? g.isContextLost() : true; })()");
  if (lost) { console.log(JSON.stringify({ blank: true, note: "三维画面没出来（显卡被占用时会这样），等一会儿重跑" })); process.exit(2); }
  const durs = await page.evaluate("Object.fromEntries([...__play.actor.hero.clips].map(([k, c]) => [k, c.duration]))");
  for (const c of clips.split(",")) {
    const dur = durs[c]; if (!dur) { console.log(c, "没有这段动作"); continue; }
    await page.evaluate(`(() => { const a = __play.actor; a.stop(); a.lock(${dur + 0.6}); a.anim(${JSON.stringify(c)}, { speed: 1, fade: 0.1 }); })()`);
    const t0 = Date.now();
    for (let i = 0; i < +n; i++) { const due = t0 + (dur * 1000) * i / (+n - 1); const w = due - Date.now(); if (w > 0) await sleep(w); await page.screenshot({ path: `${out}/${c}_${String(i).padStart(2, "0")}.jpg`, type: "jpeg", quality: 86 }); }
    await sleep(900);
    try { execFileSync("python3", ["tools/kit_sheet.py", out, c, n]); } catch (e) { errors.push("拼图失败"); }
    console.log(c, dur.toFixed(2) + " 秒，拍了", n, "张，实际用时", ((Date.now() - t0) / 1000).toFixed(2));
  }
  console.log(JSON.stringify({ errors }));
} finally { await browser.close(); }
