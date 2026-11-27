#!/usr/bin/env node
// 技能特效的固定机位录像（第九轮 fx2a）：测试场里把施法者和靶子都框进画面，按对局时间每 1/30 秒停住画面截一张，拼成真实时间的 30 帧 mp4。
// 和 rec_clip.sh 的区别：无界面 Chrome 只有二十帧上下、还不稳，录屏再拉时间轴会掉帧、抖；这里每一帧都是停住的对局时刻，所以录像是匀的。
// 第一轮的联系表镜头跟着英雄、靶子在画面外，岚的大招根本没截到；这里镜头用 ?cam= 固定在给定的世界坐标上。
// 用法: node tools/fx2a_clip.mjs <输出目录> <英雄> '<任务 JSON>' [宽=1280] [高=720] [额外网址参数]
//   任务: [{"name":"Q","cam":[x,z,距离,俯角,转角,看向的高度],"pre":"…摆位置的 js…","key":"Q","aim":[x,z],"sec":1.6,"lead":0.2}]
//   cam：世界坐标（脚本里换成 ?cam= 要的路向坐标）；pre：放之前执行的（摆英雄、摆靶子）；key：放哪个技能，aim 瞄哪（不写瞄对面的假人）；js：不放技能，执行这段
//   sec：放出去以后录几秒；lead：放之前先录几秒；fps：每秒几帧（默认 30）；sp：截帧时对局走几倍速（越慢停得越准，默认 0.25）
//   输出: <输出目录>/<name>/f_000.jpg …，<输出目录>/<name>.mp4
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
const [out, hero, jobsJson, w = "1280", h = "720", extra = ""] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const jobs = JSON.parse(jobsJson), SQ2 = Math.SQRT2;
const toLane = (x, z) => [(x - z) / SQ2, (x + z) / SQ2];
for (const j of jobs) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 900000,
      args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", `--window-size=${w},${h}`] });
    let bad = false;
    try {
      const page = await browser.newPage(); await page.setViewport({ width: +w, height: +h, deviceScaleFactor: 1 });
      const errors = []; page.on("pageerror", e => errors.push(String(e).slice(0, 300))); page.on("console", m => { const t = m.text(); if (m.type() === "error") errors.push(t.slice(0, 300)); if (/Shader Error|VALIDATE_STATUS/.test(t)) bad = true; });
      const [cx, cz, cd = 16, cp = 52, cy = 0, ch = 0.8] = j.cam ?? [0, 0], [u, v] = toLane(cx, cz);
      const url = (process.env.MOBA_URL || "http://localhost:5204/map.html") + `?arena=1&h=${hero}&nohud=1&cam=${u.toFixed(2)},${v.toFixed(2)},${cd},${cp},${ch},${cy}${extra ? "&" + extra : ""}`;
      await page.goto(url, { waitUntil: "load" });
      await page.waitForFunction("window.__ready === true && window.__arena", { timeout: 120000 });
      await new Promise(r => setTimeout(r, 1500));
      if (bad) throw new Error("显卡被抢");
      const T = () => page.evaluate("__sim.time");
      const until = async t => { await page.waitForFunction(`__sim.time >= ${t}`, { timeout: 120000, polling: "raf" }); };
      await page.evaluate(`(()=>{ for (const b of document.querySelectorAll("button")) if (b.textContent === "升一级") b.parentElement.remove();      /* 测试场左上角的调试按钮不进画面 */
        const a=__actors.get(__sim.hero.id); for (const k of ["Q","W","E","R"]) a.setCd(k,0); __sim.hero.hp=__sim.hero.max; __sim.hero.h.mana=__sim.hero.h.stat.mana; __arena.reset(); __setSpeed(1); return 1; })()`);
      if (j.pre) await page.evaluate(`(()=>{ const a=__actors.get(__sim.hero.id), A=__arena, D=A.dummy; ${j.pre}; return 1; })()`);
      const t0 = await T(); await until(t0 + (j.wait ?? 1.2));
      if (j.pre2) await page.evaluate(`(()=>{ const a=__actors.get(__sim.hero.id), A=__arena, D=A.dummy; ${j.pre2}; return 1; })()`);
      const sp = j.sp ?? 0.25, fps = j.fps ?? 30, dir = `${out}/${j.name}`; fs.mkdirSync(dir, { recursive: true });
      for (const f of fs.readdirSync(dir)) if (f.endsWith(".jpg")) fs.unlinkSync(`${dir}/${f}`);
      await page.evaluate(`__setSpeed(${sp})`);
      let k = 0; const shot = async t => { await until(t); await page.evaluate("__setSpeed(0)"); await new Promise(r => setTimeout(r, 40)); await page.screenshot({ path: `${dir}/f_${String(k++).padStart(3, "0")}.jpg`, type: "jpeg", quality: 90 }); await page.evaluate(`__setSpeed(${sp})`); };
      let ts = await T(); const lead = Math.round((j.lead ?? 0.2) * fps);
      for (let i = 0; i < lead; i++) await shot(ts + i / fps);
      ts = await T();
      const res = await page.evaluate(j.js ? `(()=>{ const a=__actors.get(__sim.hero.id), A=__arena, D=A.dummy; ${j.js}; return "js"; })()`
        : `(()=>{ const a=__actors.get(__sim.hero.id), d=a.skill("${j.key}"), D=__arena.dummy; const tg = ${j.aim ? `{x:${j.aim[0]},z:${j.aim[1]}}` : "{x:D.x, z:D.z}"}; return a.cast("${j.key}", tg, d.cast==="unit" ? D : null); })()`);
      if (!res) console.log("放不出来", j.name);
      const n = Math.round((j.sec ?? 1.5) * fps);
      for (let i = 0; i < n; i++) await shot(ts + i / fps);
      await page.evaluate("__setSpeed(1)");
      console.log(JSON.stringify({ job: j.name, frames: k, cast: res, errors: errors.slice(0, 6) }));
      execFileSync("ffmpeg", ["-v", "error", "-y", "-framerate", String(fps), "-i", `${dir}/f_%03d.jpg`, "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", `${out}/${j.name}.mp4`]);
    } catch (e) { console.log("出错", j.name, String(e).slice(0, 300)); bad = true; }
    finally { await browser.close(); }
    if (!bad) break; console.log("重试", attempt + 1);
  }
}
