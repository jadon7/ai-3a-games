#!/usr/bin/env node
// 量帧率：无界面 Chrome（显卡走 Metal）正常跑试验页（不是录像模式）。同一个页面里先量“不放特效”的底数，再把每段演示循环放着量，
// 每 0.25 秒记一次帧率和绘制次数。用法：node tools/fps.mjs [网址参数] [每段秒数=6] [宽=1600] [高=900] [演示名,逗号分隔=r,q,w,e,passive,combo]
// 注意：无界面 Chrome 的帧率只能当相对参考（和真机不一样，别的任务抢显卡时也会抖），主要看放特效时比底数掉多少。
import puppeteer from "puppeteer-core";
const [query = "", secArg = "6", w = "1600", h = "900", list = "r,q,w,e,passive,combo"] = process.argv.slice(2);
const base = process.env.LAB_URL || "http://localhost:5255/lab/fx_iti/index.html";
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-gpu-vsync", "--disable-frame-rate-limit", "--hide-scrollbars", "--mute-audio", `--window-size=${w},${h}`] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: +w, height: +h, deviceScaleFactor: 1 });
  await page.goto(`${base}?nohud=1&dpr=1${query ? "&" + query : ""}`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction("window.__lab && window.__lab.ready === true", { timeout: 90000 });
  await new Promise(r => setTimeout(r, 2500));
  const sample = async (sec) => { const out = []; for (let i = 0; i < sec * 4; i++) { await new Promise(r => setTimeout(r, 250)); out.push(await page.evaluate(() => window.__lab.stats())); } return out; };
  const sum = (name, run) => { const fps = run.map(s => s.fps).filter(v => v > 0); const avg = fps.reduce((a, b) => a + b, 0) / fps.length;
    return { name, avgFps: +avg.toFixed(0), minFps: +Math.min(...fps).toFixed(0), peakCalls: Math.max(...run.map(s => s.peakCalls)), peakFx: Math.max(...run.map(s => s.peakFx)), peakParticles: Math.max(...run.map(s => s.peakParticles)) }; };
  const res = [sum("不放特效", await sample(+secArg))];
  for (const d of list.split(",")) {
    await page.evaluate(d => { const dur = window.__lab.demos[d].duration; window.__lab.play(d); window.__loop && clearInterval(window.__loop); window.__loop = setInterval(() => window.__lab.play(d), (dur + 0.4) * 1000); }, d);   // 每段先放一遍热身（着色器编译），再量
    await new Promise(r => setTimeout(r, 1500));
    res.push(sum(d, await sample(+secArg)));
  }
  await page.evaluate(() => { clearInterval(window.__loop); window.__lab.reset(); });
  res.push(sum("不放特效（再量一次）", await sample(+secArg)));
  for (const r of res) console.log(JSON.stringify(r));
} finally { await browser.close(); }
