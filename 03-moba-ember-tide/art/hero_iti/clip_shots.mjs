#!/usr/bin/env node
// 伊缇还没有技能代码（第四阶段写），借岚的技能只能看到 q w e r 四段。这里在测试场里直接让模型播每一段动作（按 iti.json 里的播放倍率），
// 在游戏的镜头（俯视约 50 度，dist 可调）里均匀连拍，每段拼成一条。
// 用法: MOBA_URL=http://localhost:5253/map.html node art/hero_iti/clip_shots.mjs <输出目录> [动作,…] [每段张数=8] [dist=15] [额外参数]
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const [out, only = "idle,run,attack1,attack2,q,q3,w,e,r,death", nS = "8", dist = "15", extra = ""] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const meta = JSON.parse(fs.readFileSync(new URL("../../public/assets/hero/iti.json", import.meta.url)));
const speedOf = c => (meta.attacks.find(a => a.clip === c)?.speed) ?? (Object.values(meta.skills).find(s => s.clip === c)?.speed) ?? 1;
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 600000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1500,844"] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1500, height: 844 });
  const errors = []; page.on("pageerror", e => errors.push(String(e).slice(0, 200)));
  await page.goto((process.env.MOBA_URL || "http://localhost:5253/map.html") + `?arena=1&h=lan&glb=iti&look=height:3.3,scarf:1&nohud=1&nofog=1&dist=${dist}` + (extra ? "&" + extra : ""), { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true && window.__arena", { timeout: 120000 }); await sleep(1500);
  const res = {};
  for (const c of only.split(",")) {
    const sp = c === "idle" || c === "run" ? 1 : speedOf(c);
    const dur = await page.evaluate(`(() => { const a = __play.actor; a.stop(); const h = a.hero, cl = h.clips.get(${JSON.stringify(c)}); if (!cl) return -1;
      h.play(${JSON.stringify(c)}, { loop: ${c === "idle" || c === "run"}, speed: ${sp}, fade: 0.05 }); return cl.duration; })()`);
    if (dur < 0) { res[c] = "没有这段"; continue; }
    const n = +nS, total = Math.min(dur / sp, 4), t0 = Date.now();
    for (let i = 0; i < n; i++) {
      const due = t0 + (i / (n - 1)) * total * 1000 * 0.97; while (Date.now() < due) await sleep(5);
      await page.screenshot({ path: `${out}/${c}_${String(i).padStart(2, "0")}.jpg`, type: "jpeg", quality: 88, clip: { x: 450, y: 120, width: 600, height: 600 } });
    }
    res[c] = { dur: +dur.toFixed(2), speed: sp, shown: +(total).toFixed(2), state: await page.evaluate("__play.state() + ' ' + __play.actor.hero.current") };
    await sleep(500);
  }
  console.log(JSON.stringify({ res, errors: errors.slice(0, 6), fps: await page.evaluate("Math.round(__stats.fps)") }));
} finally { await browser.close(); }
