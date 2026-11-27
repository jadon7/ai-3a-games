#!/usr/bin/env node
// 特效的连续帧（第九轮）：在测试场里放一个技能（或者跑一段脚本），按对局时间每隔 step 秒停住画面截一张，拼联系表用。
// 停住画面靠 __setSpeed(0)：粒子、贴花都按对局的时间走，停住以后截出来的就是那一刻，不受无界面 Chrome 帧率的影响。
// 用法: node tools/fx_frames.mjs <输出目录> <英雄> '<任务 JSON>' [宽=1280] [高=720] [额外网址参数]
//   任务: [{"name":"Q","key":"Q","n":10,"step":0.08,"lead":0}, {"name":"recall","js":"__actors.get(__sim.hero.id).recall()","n":12,"step":0.45}]
//   key：放哪个技能（瞄着对面的假人；对友方的技能瞄着己方假人）；js：不放技能，执行这段；pre：开始前先执行的；lead：放出去以前先截几帧（技能起手）
//   wait：放之前等几秒（对局时间）让上一段的特效散掉
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const [out, hero, jobsJson, w = "1280", h = "720", extra = ""] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const jobs = JSON.parse(jobsJson);
for (let attempt = 0; attempt < 3; attempt++) {
  const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 900000,
    args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", `--window-size=${w},${h}`] });
  let bad = false;
  try {
    const page = await browser.newPage(); await page.setViewport({ width: +w, height: +h, deviceScaleFactor: 1 });
    const errors = []; page.on("pageerror", e => errors.push(String(e).slice(0, 300))); page.on("console", m => { const t = m.text(); if (m.type() === "error") errors.push(t.slice(0, 300)); if (/Shader Error|VALIDATE_STATUS/.test(t)) bad = true; });
    const url = (process.env.MOBA_URL || "http://localhost:5202/map.html") + `?arena=1&h=${hero}&nohud=1${extra ? "&" + extra : ""}`;
    await page.goto(url, { waitUntil: "load" });
    await page.waitForFunction("window.__ready === true && window.__arena", { timeout: 120000 });
    await new Promise(r => setTimeout(r, 1500));
    if (bad) throw new Error("显卡被抢");
    const T = () => page.evaluate("__sim.time");
    const until = async t => { await page.waitForFunction(`__sim.time >= ${t}`, { timeout: 120000, polling: "raf" }); };
    for (const j of jobs) {
      const sp = j.speed ?? 0.5;
      await page.evaluate(`(()=>{ const a=__actors.get(__sim.hero.id); for (const k of ["Q","W","E","R"]) a.setCd(k,0); __sim.hero.hp=__sim.hero.max; __sim.hero.h.mana=__sim.hero.h.stat.mana; __arena.reset(); __setSpeed(1); ${j.pre ?? ""}; return 1; })()`);
      const t0 = await T(); await until(t0 + (j.wait ?? 1.6));
      await page.evaluate(`__setSpeed(${sp})`);
      let ts = await T(); const lead = j.lead ?? 0, step = j.step ?? 0.08, n = j.n ?? 10;
      const shot = async (i, t) => { await until(t); await page.evaluate("__setSpeed(0)"); await new Promise(r => setTimeout(r, 60)); await page.screenshot({ path: `${out}/${j.name}_${String(i).padStart(2, "0")}.jpg`, type: "jpeg", quality: 88 }); await page.evaluate(`__setSpeed(${sp})`); };
      for (let i = 0; i < lead; i++) await shot(i, ts + i * step);
      ts = await T();
      const res = await page.evaluate(j.js ? `(()=>{ ${j.js}; return "js"; })()` : `(()=>{ const a=__actors.get(__sim.hero.id), d=a.skill("${j.key}"); const u = d.target==="ally" ? __arena.friend : __arena.dummy; const tg = ${j.aim ? JSON.stringify(j.aim) : "null"} || (d.cast==="point" ? {x:(u.x*2+a.pos.x)/3, z:(u.z*2+a.pos.z)/3} : {x:u.x, z:u.z}); return a.cast("${j.key}", tg, d.cast==="unit" ? u : null); })()`);
      if (!res) console.log("放不出来", j.name);
      for (let i = 0; i < n; i++) await shot(lead + i, ts + (i + (j.skip ?? 0)) * step);
      await page.evaluate("__setSpeed(1)");
    }
    console.log(JSON.stringify({ hero, errors: errors.slice(0, 6) }));
  } catch (e) { console.log("出错", String(e).slice(0, 200)); bad = true; }
  finally { await browser.close(); }
  if (!bad) break; console.log("重试", attempt + 1);
}
