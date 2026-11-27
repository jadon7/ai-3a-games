#!/usr/bin/env node
// 第九轮 polish-lib 的取证工具（tools/hedda_clip.mjs 拷来改的）：固定机位，按对局时间一帧一帧地截（页面的 performance.now 换成脚本推的钟，
// 每推 1/fps 秒画一帧、截一张），拼成真实时间的 mp4。改前用主目录 5190（phase9），改后用自己的端口，同一份任务各跑一遍。
// 用法: MOBA_URL=... node tools/polish_clip.mjs <输出目录> <英雄> '<任务 JSON>' [宽=1280] [高=720] [额外网址参数]
//   任务: [{"name":"R","key":"R","dur":1.6,"pre":"...","aim":[u,v],"js":"...","after":"...","wait":1.4,"still":false}]
//   key 放哪个技能（不给 aim 就瞄对面的假人；aim 写成 [u,v] 是路向坐标）；js 不放技能，执行这段；pre 放之前先执行的；after 放出去以后马上执行的；
//   still：只截一张（pre 以后等 wait 秒）。页面里有 __W(u,v)（路向坐标换世界坐标）、__me（自己的控制器）、__dummy（对面假人）、__friend（己方假人）
//   POLISH_Q 环境变量：不进测试场，整个网址参数换成它（比如 5v5 对局 "h=lan&auto=1&nohud=1"），这时 __arena 不存在
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
// 2026-11-20：Homebrew 的 x265 升到 4.3 以后 ffmpeg 起不来，只给 ffmpeg 这一个进程指到旧版本的库
const FFENV = { ...process.env, DYLD_LIBRARY_PATH: "/opt/homebrew/Cellar/x265/4.2/lib" };
const [out, hero, jobsJson, w = "1280", h = "720", extra = ""] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const jobs = JSON.parse(jobsJson), Q = process.env.POLISH_Q;
for (let attempt = 0; attempt < 3; attempt++) {
  const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 900000,
    args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", `--window-size=${w},${h}`] });
  let bad = false;
  try {
    const page = await browser.newPage(); await page.setViewport({ width: +w, height: +h, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument(() => { const real = performance.now.bind(performance); window.__vt = null; performance.now = () => (window.__vt ?? real()); window.__real = real; });
    const errors = []; page.on("pageerror", e => errors.push(String(e).slice(0, 300))); page.on("console", m => { const t = m.text(); if (m.type() === "error") errors.push(t.slice(0, 300)); if (/Shader Error|VALIDATE_STATUS/.test(t)) bad = true; });
    const url = (process.env.MOBA_URL || "http://localhost:5216/map.html") + "?" + (Q ?? `arena=1&h=${hero}&nohud=1`) + (extra ? "&" + extra : "");
    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction(Q ? "window.__ready === true" : "window.__ready === true && window.__arena", { timeout: 120000 });
    await page.evaluate(`window.__W=(u,v)=>[(u+v)/Math.SQRT2,(v-u)/Math.SQRT2]; window.__me=__actors.get(__sim.hero.id); window.__dummy=window.__arena?.dummy; window.__friend=window.__arena?.friend; const sel=document.querySelector('select'); if (sel) sel.parentElement.style.display='none'; 1`);
    await new Promise(r => setTimeout(r, 1500));
    if (bad) throw new Error("显卡被抢");
    const T = () => page.evaluate("__sim.time");
    const until = async t => { await page.waitForFunction(`__sim.time >= ${t}`, { timeout: 120000, polling: "raf" }); };
    for (const j of jobs) {
      const fps = j.fps ?? 30, dir = `${out}/${j.name}`;
      await page.evaluate(`(()=>{ window.__vt=null; const a=__me; for (const k of ["Q","W","E","R"]) a.setCd(k,0); __sim.hero.hp=__sim.hero.max; __sim.hero.h.mana=__sim.hero.h.stat.mana; window.__arena?.reset(); __setSpeed(1); ${j.pre ?? ""}; return 1; })()`);
      const t0 = await T(); await until(t0 + (j.wait ?? 1.4));
      if (j.still) { if (j.js) await page.evaluate(`(()=>{ ${j.js}; return 1; })()`); await new Promise(r => setTimeout(r, j.hold ?? 300)); await page.screenshot({ path: `${out}/${j.name}.jpg`, type: "jpeg", quality: 92 }); console.log("截好", j.name); continue; }
      fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
      await page.evaluate(`window.__vt = window.__real(); 1`);
      const step = async () => page.evaluate(`new Promise(r => { window.__vt += ${1000 / fps}; requestAnimationFrame(() => requestAnimationFrame(() => r(1))); })`);
      await step();
      const aim = j.aim ? (Array.isArray(j.aim) ? `(()=>{ const [x,z]=__W(${j.aim[0]},${j.aim[1]}); return {x,z}; })()` : JSON.stringify(j.aim)) : "null";
      const res = await page.evaluate(j.js ? `(()=>{ ${j.js}; return "js"; })()` : `(()=>{ const a=__me, d=a.skill("${j.key}"); const u = d.target==="ally" ? __arena.friend : __arena.dummy; const tg = ${aim} || {x:u.x, z:u.z}; return a.cast("${j.key}", tg, d.cast==="unit" ? u : null); })()`);
      if (!res) console.log("放不出来", j.name);
      if (j.after) await page.evaluate(`(()=>{ ${j.after}; return 1; })()`);
      const n = Math.round((j.dur ?? 1.5) * fps);
      for (let i = 0; i < n; i++) { await step(); await page.screenshot({ path: `${dir}/f_${String(i).padStart(3, "0")}.jpg`, type: "jpeg", quality: 90 }); }
      await page.evaluate(`window.__vt = null; 1`);
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(fps), "-i", `${dir}/f_%03d.jpg`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", `${out}/${j.name}.mp4`], { env: FFENV });
      console.log("录好", j.name, n, "帧");
    }
    console.log(JSON.stringify({ hero, errors: errors.slice(0, 6) }));
  } catch (e) { console.log("出错", String(e).slice(0, 300)); bad = true; }
  finally { await browser.close(); }
  if (!bad) break; console.log("重试", attempt + 1);
}
