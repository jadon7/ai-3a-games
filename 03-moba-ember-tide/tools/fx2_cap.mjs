#!/usr/bin/env node
// 特效第二轮（fx2b）的取证工具：测试场里用固定机位放一个技能，按对局时间连续停帧截图，同时记下每一帧的对局时间，
// 拿这些帧既拼连续帧对比（fx2_sheet.py），又按真实时间合成录像（帧的时长按记下的对局时间算，播放是真实速度，不受无界面 Chrome 帧率影响）。
// 用法: MOBA_URL=... node tools/fx2_cap.mjs <输出目录> <英雄> '<任务 JSON>' [宽=1280] [高=720]
//   任务: [{"name":"Q","cam":"-13.5,4,17,52,0,45","key":"Q","aim":{"x":..,"z":..}|"friend"|"dummy"|{"f":8,"r":0},"dur":1.6,"fps":30,"lead":0.3,"js":"...","at":[[1.5,"js"]]}]
//   cam：网址里的 cam 参数（路向坐标 u,v,距离,俯角,高度,转角），机位一变就重新载入页面；aim：瞄哪里（f/r 是相对英雄的前后左右米数）
//   dur：放出去以后截多少秒；fps：每秒几帧（对局时间）；lead：放之前先截几秒（起手的预兆从按键开始）；at：放出去以后第几秒执行一段脚本（比如把护盾打掉）
// 输出: <目录>/<名字>/f_000.jpg …，<目录>/<名字>/times.json（每帧相对按键的对局时间），<目录>/<名字>.mp4
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const [out, hero, jobsJson, w = "1280", h = "720"] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const jobs = JSON.parse(jobsJson), base = process.env.MOBA_URL || "http://localhost:5205/map.html";
const sleep = ms => new Promise(r => setTimeout(r, ms));
for (let attempt = 0; attempt < 3; attempt++) {
  const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 900000,
    args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", `--window-size=${w},${h}`] });
  let bad = false;
  try {
    const page = await browser.newPage(); await page.setViewport({ width: +w, height: +h, deviceScaleFactor: 1 });
    const errors = []; page.on("pageerror", e => errors.push(String(e).slice(0, 300))); page.on("console", m => { const t = m.text(); if (m.type() === "error") errors.push(t.slice(0, 300)); if (/Shader Error|VALIDATE_STATUS/.test(t)) bad = true; });
    let cam = null;
    const T = () => page.evaluate("__sim.time");
    const until = async t => { await page.waitForFunction(`__sim.time >= ${t}`, { timeout: 120000, polling: "raf" }); };
    for (const j of jobs) {
      if (j.cam !== cam) { cam = j.cam;
        await page.goto(base + `?arena=1&h=${hero}&nohud=1&vig=0${cam ? "&cam=" + cam : ""}${j.extra ? "&" + j.extra : ""}`, { waitUntil: "load" });
        await page.waitForFunction("window.__ready === true && window.__arena", { timeout: 120000 }); await sleep(2500);
        await page.evaluate(`[...document.querySelectorAll("div")].filter(d => d.style.position === "fixed" && d.querySelector("select")).forEach(d => d.style.display = "none")`);      // 测试场左上角的调试按钮不进画面
        if (bad) throw new Error("显卡被抢"); }
      const dir = `${out}/${j.name}`; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
      const sp = j.speed ?? 0.3, fps = j.fps ?? 30, dur = j.dur ?? 1.6, lead = j.lead ?? 0;
      await page.evaluate(`(()=>{ const a=__actors.get(__sim.hero.id); for (const k of ["Q","W","E","R"]) a.setCd(k,0); __sim.hero.hp=__sim.hero.max; __sim.hero.h.mana=__sim.hero.h.stat.mana; __arena.reset(); __setSpeed(1); ${j.pre ?? ""}; return 1; })()`);
      const t0w = await T(); await until(t0w + (j.wait ?? 2.2));
      await page.evaluate(`__setSpeed(${sp})`);
      const times = []; let i = 0;
      const shot = async () => { await page.evaluate("__setSpeed(0)"); await sleep(45); const t = await T(); await page.screenshot({ path: `${dir}/f_${String(i).padStart(3, "0")}.jpg`, type: "jpeg", quality: 90 }); times.push(t); i++; await page.evaluate(`__setSpeed(${sp})`); };
      // 起手之前：按键的时刻记作 0，往前留 lead 秒的空镜头
      const tl = await T(); for (let k = 0; k < Math.round(lead * fps); k++) { await until(tl + k / fps); await shot(); }
      const tc = await T();
      const aimJs = typeof j.aim === "string" ? `__arena.${j.aim}` : j.aim && j.aim.f !== undefined ? `{x: a.pos.x + Math.sin(a.yaw()) * ${j.aim.f} + Math.cos(a.yaw()) * ${j.aim.r ?? 0}, z: a.pos.z + Math.cos(a.yaw()) * ${j.aim.f} - Math.sin(a.yaw()) * ${j.aim.r ?? 0}}` : j.aim ? JSON.stringify(j.aim) : "null";
      const res = await page.evaluate(j.js ? `(()=>{ ${j.js}; return "js"; })()` : `(()=>{ const a=__actors.get(__sim.hero.id), d=a.skill("${j.key}"); const u = d.target==="ally" ? __arena.friend : __arena.dummy; const tg = ${aimJs} || {x:u.x, z:u.z}; return a.cast("${j.key}", {x: tg.x, z: tg.z}, d.cast==="unit" ? (${typeof j.aim === "string" ? `__arena.${j.aim}` : "u"}) : null); })()`);
      if (!res) console.log("放不出来", j.name);
      const todo = [...(j.at ?? [])];
      for (let k = 0; k <= Math.round(dur * fps); k++) {
        const tt = tc + k / fps; for (let q = todo.length - 1; q >= 0; q--) if (todo[q][0] <= k / fps) { await page.evaluate(todo[q][1]); todo.splice(q, 1); }
        await until(tt); await shot(); }
      await page.evaluate("__setSpeed(1)");
      const rel = times.map(t => +(t - tc).toFixed(4)); fs.writeFileSync(`${dir}/times.json`, JSON.stringify(rel));
      // 录像：每帧按它和下一帧的对局时间差显示，合成 30 帧每秒的 mp4（真实速度）
      const list = rel.map((t, k) => `file 'f_${String(k).padStart(3, "0")}.jpg'\nduration ${Math.max(0.005, (rel[k + 1] ?? t + 1 / fps) - t).toFixed(4)}`).join("\n") + `\nfile 'f_${String(rel.length - 1).padStart(3, "0")}.jpg'\n`;
      fs.writeFileSync(`${dir}/list.txt`, list);
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", `${dir}/list.txt`, "-vf", `fps=30,format=yuv420p${j.crop ? ",crop=" + j.crop : ""}`, "-c:v", "libx264", "-crf", "21", "-preset", "medium", "-movflags", "+faststart", `${out}/${j.name}.mp4`]);
      console.log(j.name, "帧数", times.length, "对局时间", rel[0], "→", rel[rel.length - 1]);
    }
    console.log(JSON.stringify({ hero, errors: errors.slice(0, 6) }));
  } catch (e) { console.log("出错", String(e).slice(0, 300)); bad = true; }
  finally { await browser.close(); }
  if (!bad) break; console.log("重试", attempt + 1);
}
