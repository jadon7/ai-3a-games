#!/usr/bin/env node
// 宣传片素材的逐帧录制：把页面的时间换成“虚拟时间”，每走 1/30 秒截一张图，直接拼成 30 帧的 mp4。
// 无界面 Chrome 的实时录屏只有二十帧上下、时间轴不准；逐帧截图慢，但每一帧都是准的，画面是真正平滑的 30 帧。
// 用法: node tools/trailer/cap.mjs <输出.mp4> "<网址参数>" '<选项 JSON>'
// 选项:
//   cond    开录前先按 ff 倍速（默认 16）实时快进，直到这个表达式成立（不写就不等）
//   pre     开录前在页面里执行的 js（比如 __setSpeed(1)、摆镜头、放技能）
//   sec     录几秒（按游戏画面的时间）
//   speed   录的时候对局几倍速（默认 1）
//   at      [{t: 秒, js: "..."}] 录到第几秒时执行一段 js（放技能、移动）
//   clicks  [{t: 秒, sel: "css 选择器"} 或 {t, xy:[x,y]}] 录到第几秒时点一下（选人界面）
//   w h     视口（默认 1920×1080）；mobile: true 按手机横屏（触屏、iPhone 的 UA）
//   dpr     像素密度（默认 1）
//   css     额外注入的样式（藏调试按钮之类）
//   warm    开录前在虚拟时间里先空走几帧（默认 6）
//   hold    ["KeyQ"] 录的时候每帧按住这些键 holdFrac（默认 0.1）帧长：Q/E 匀速转镜头，WASD 匀速平移（只在没有自己英雄的空镜里用）
//   log     每帧在页面里算一次的表达式，结果按帧号写进 <输出>.log.json（找击杀、找打架用）
//   real    [{js, wait}] 开录前按真实时间执行的步骤（预热技能特效的着色器）
//   cond2   cond 成立以后再按 ff2 倍速（默认 1）等这个条件，等到了才开录（快进时一下就跳过去的瞬间用它卡准）
//   tries   显卡被抢（着色器报错）时重来几次（默认 3）
import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import fs from "node:fs";

const [out, query = "", optJson = "{}"] = process.argv.slice(2);
const o = JSON.parse(optJson);
const W = o.w || 1920, H = o.h || 1080, FPS = 30, N = Math.round((o.sec || 4) * FPS);
const base = process.env.MOBA_URL || "http://localhost:5190/map.html";
const sleep = ms => new Promise(r => setTimeout(r, ms));

const VT = `(() => {
  const realNow = performance.now.bind(performance), realRaf = window.requestAnimationFrame.bind(window);
  let virt = null, queue = [];
  performance.now = () => (virt === null ? realNow() : virt);
  window.requestAnimationFrame = cb => { if (virt === null) return realRaf(cb); queue.push(cb); return queue.length; };
  window.__vtStart = () => { virt = realNow(); return 1; };
  window.__vtStep = ms => { virt += ms; const q = queue; queue = []; for (const cb of q) { try { cb(virt); } catch (e) { console.error(String(e)); } } return q.length; };
})();`;

async function attempt() {
  const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 1800000,
    args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", `--window-size=${W},${H}`] });
  const errors = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: H, deviceScaleFactor: o.dpr || 1, ...(o.mobile ? { isMobile: true, hasTouch: true, isLandscape: true } : {}) });
    if (o.mobile) await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1");
    page.on("pageerror", e => errors.push(String(e).slice(0, 300))); page.on("console", m => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
    await page.evaluateOnNewDocument(VT);
    await page.goto(base + (query ? "?" + query : ""), { waitUntil: "load", timeout: 90000 });
    await page.waitForFunction("window.__ready === true", { timeout: 120000 });
    if (o.css) await page.addStyleTag({ content: o.css });
    await sleep(o.settle ?? 800);
    if (o.cond) { await page.evaluate(`__setSpeed(${o.ff || 16});1`); await page.waitForFunction(o.cond, { timeout: o.timeout || 900000, polling: 100 }); }
    if (o.cond2) { await page.evaluate(`__setSpeed(${o.ff2 || 1});1`); await page.waitForFunction(o.cond2, { timeout: o.timeout2 || 300000, polling: 50 }); }      // 第二个条件按正常速度等，开录的时机更准
    if (o.cond) await page.evaluate(`__setSpeed(${o.speed || 1});1`);      // 快进到了就先恢复正常速度，再走下面按真实时间的步骤
    for (const r of o.real || []) { if (r.js) await page.evaluate(r.js); if (r.wait) await sleep(r.wait); }      // 开录前按真实时间走的步骤（先把技能空放一遍，让着色器编好）
    await page.evaluate(`window.__setSpeed && __setSpeed(${o.speed || 1}); __vtStart()`);
    if (o.pre) await page.evaluate(o.pre);
    for (let i = 0; i < (o.warm ?? 6); i++) await page.evaluate("__vtStep(1000/30)");
    if (errors.some(e => /Shader Error|VALIDATE_STATUS/.test(e))) return { ok: false, errors };
    const ff = spawn("ffmpeg", ["-v", "error", "-y", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-", "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "14", "-pix_fmt", "yuv420p", out], { stdio: ["pipe", "inherit", "inherit"] });
    const at = [...(o.at || [])].sort((a, b) => a.t - b.t), clicks = [...(o.clicks || [])].sort((a, b) => a.t - b.t);
    const t0 = Date.now(), logs = [];
    for (let f = 0; f < N; f++) {
      const t = f / FPS;
      while (at.length && at[0].t <= t) { const s = at.shift(); try { await page.evaluate(s.js); } catch (e) { errors.push("at " + s.t + ": " + String(e).slice(0, 200)); } }
      while (clicks.length && clicks[0].t <= t) { const c = clicks.shift(); if (c.sel) { const el = await page.$(c.sel); if (el) await el.click(); else errors.push("没找到 " + c.sel); } else await page.mouse.click(c.xy[0], c.xy[1]); }
      if (o.hold && o.hold.length) {      // 镜头匀速转、匀速平移：每帧只按住键一小段时间（holdFrac），转速/移速就是游戏里的 holdFrac 倍，而且是线性的
        const fr = o.holdFrac ?? 0.1, ks = JSON.stringify(o.hold);
        await page.evaluate(`for (const k of ${ks}) dispatchEvent(new KeyboardEvent("keydown", {code: k})); __vtStep(1000/30*${fr}); for (const k of ${ks}) dispatchEvent(new KeyboardEvent("keyup", {code: k})); __vtStep(1000/30*${1 - fr})`);
      } else await page.evaluate("__vtStep(1000/30)");
      if (o.log) logs.push([f, await page.evaluate(o.log).catch(e => String(e).slice(0, 80))]);
      const buf = await page.screenshot({ type: "jpeg", quality: 94, optimizeForSpeed: true });
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once("drain", r));
      if (f % 150 === 149) process.stderr.write(`  ${f + 1}/${N} 帧 ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
    }
    ff.stdin.end(); await new Promise(r => ff.on("close", r));
    if (o.log) fs.writeFileSync(out.replace(/\.mp4$/, ".log.json"), JSON.stringify(logs));
    const rep = await page.evaluate("window.__report ? __report() : ({time: window.__sim && __sim.time})").catch(() => null);
    return { ok: !errors.some(e => /Shader Error|VALIDATE_STATUS/.test(e)), errors, rep };
  } finally { await browser.close(); }
}

for (let i = 0; i < (o.tries || 3); i++) {
  const r = await attempt();
  console.log(JSON.stringify({ out, ok: r.ok, rep: r.rep, errors: r.errors.slice(0, 5) }).slice(0, 900));
  if (r.ok) break;
  console.log("显卡被抢或着色器出错，重来", i + 1);
}
if (!fs.existsSync(out)) process.exit(1);
