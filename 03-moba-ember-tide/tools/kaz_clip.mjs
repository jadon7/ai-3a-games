#!/usr/bin/env node
// 特效录像（第九轮 k-kaz 照搬 fx2c 的 fxclip.mjs，加了：开录前打印假人和小兵的路向坐标）。原说明：
// 特效录像（第九轮 fx2c）：在测试场里固定机位放技能，按对局时间一帧一帧地截（每帧正好 1/fps 秒），拼成真实时间的 mp4。
// 和 fx_frames.mjs 的区别：不靠 __setSpeed(0) 停画面（停的那一刻会多走一点，帧距不匀），而是把页面里的 performance.now 换成一个
// 由脚本推的钟：每推 1/fps 秒画一帧、截一张。无界面 Chrome 再慢，录出来的也是匀速的 30 帧。
// 用法: node fxclip.mjs <输出目录> <英雄> '<任务 JSON>' [宽=1280] [高=720] [额外网址参数，比如 cam=...]
//   任务: [{"name":"Q","key":"Q","dur":1.6,"pre":"...","aim":{"x":..,"z":..},"js":"...","wait":1.2}]
//   key 放哪个技能（不给 aim 就瞄对面的假人；aim 写成 [u,v] 是路向坐标）；js 不放技能，执行这段；pre 放之前先执行的（挪位置、转身）；
//   页面里有 __W(u,v)：路向坐标换成世界坐标；__me：自己的控制器；__dummy：对面假人
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const [out, hero, jobsJson, w = "1280", h = "720", extra = ""] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const jobs = JSON.parse(jobsJson);
for (let attempt = 0; attempt < 3; attempt++) {
  const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 900000,
    args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", `--window-size=${w},${h}`] });
  let bad = false;
  try {
    const page = await browser.newPage(); await page.setViewport({ width: +w, height: +h, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument(() => { const real = performance.now.bind(performance); window.__vt = null; performance.now = () => (window.__vt ?? real()); window.__real = real; });
    const errors = []; page.on("pageerror", e => errors.push(String(e).slice(0, 300))); page.on("console", m => { const t = m.text(); if (m.type() === "error") errors.push(t.slice(0, 300)); if (/Shader Error|VALIDATE_STATUS/.test(t)) bad = true; });
    const url = (process.env.MOBA_URL || "http://localhost:5211/map.html") + `?arena=1&h=${hero}&nohud=1${extra ? "&" + extra : ""}`;
    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction("window.__ready === true && window.__arena", { timeout: 120000 });
    await page.evaluate(`window.__W=(u,v)=>[(u+v)/Math.SQRT2,(v-u)/Math.SQRT2]; window.__me=__actors.get(__sim.hero.id); window.__dummy=__arena.dummy; const sel=document.querySelector('select'); if (sel) sel.parentElement.style.display='none'; 1`);
    await new Promise(r => setTimeout(r, 1500));
    console.log("假人", await page.evaluate(`(()=>{ const d=__arena.dummy, m=__sim.hero; const U=(x,z)=>[+((x-z)/Math.SQRT2).toFixed(2), +((x+z)/Math.SQRT2).toFixed(2)]; return { dummy: U(d.x,d.z), me: U(m.x,m.z), foes: __arena.foes.map(f=>U(f.x,f.z)) }; })()`));
    if (bad) throw new Error("显卡被抢");
    const T = () => page.evaluate("__sim.time");
    const until = async t => { await page.waitForFunction(`__sim.time >= ${t}`, { timeout: 120000, polling: "raf" }); };
    for (const j of jobs) {
      const fps = j.fps ?? 30, dir = `${out}/${j.name}`; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
      await page.evaluate(`(()=>{ window.__vt=null; const a=__me; for (const k of ["Q","W","E","R"]) a.setCd(k,0); __sim.hero.hp=__sim.hero.max; __sim.hero.h.mana=__sim.hero.h.stat.mana; __arena.reset(); __setSpeed(1); ${j.pre ?? ""}; return 1; })()`);
      const t0 = await T(); await until(t0 + (j.wait ?? 1.4));
      await page.evaluate(`window.__vt = window.__real(); 1`);
      const step = async () => page.evaluate(`new Promise(r => { window.__vt += ${1000 / fps}; requestAnimationFrame(() => requestAnimationFrame(() => r(1))); })`);
      await step();
      const res = await page.evaluate(j.js ? `(()=>{ ${j.js}; return "js"; })()` : `(()=>{ const a=__me, d=a.skill("${j.key}"); const u = d.target==="ally" ? __arena.friend : __arena.dummy; const tg = ${j.aim ? (Array.isArray(j.aim) ? `(()=>{ const [x,z]=__W(${j.aim[0]},${j.aim[1]}); return {x,z}; })()` : JSON.stringify(j.aim)) : "null"} || {x:u.x, z:u.z}; return a.cast("${j.key}", tg, d.cast==="unit" ? u : null); })()`);
      if (!res) console.log("放不出来", j.name);
      if (j.after) await page.evaluate(`(()=>{ ${j.after}; return 1; })()`);
      const n = Math.round((j.dur ?? 1.5) * fps);
      for (let i = 0; i < n; i++) { await step(); await page.screenshot({ path: `${dir}/f_${String(i).padStart(3, "0")}.jpg`, type: "jpeg", quality: 90 }); }
      await page.evaluate(`window.__vt = null; 1`);
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(fps), "-i", `${dir}/f_%03d.jpg`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", `${out}/${j.name}.mp4`], { env: { ...process.env, DYLD_LIBRARY_PATH: process.env.DYLD_LIBRARY_PATH ?? "/opt/homebrew/Cellar/x265/4.2/lib" } });      // 2026-11-20：Homebrew 的 x265 升到 4.3 以后 ffmpeg 找不到 libx265.216，指回 4.2 的库就能起来（只给 ffmpeg 这一个命令）
      console.log("录好", j.name, n, "帧");
    }
    console.log(JSON.stringify({ hero, errors: errors.slice(0, 6) }));
  } catch (e) { console.log("出错", String(e).slice(0, 300)); bad = true; }
  finally { await browser.close(); }
  if (!bad) break; console.log("重试", attempt + 1);
}
