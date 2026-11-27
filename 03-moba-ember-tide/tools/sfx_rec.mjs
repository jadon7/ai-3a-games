// 用法: node tools/sfx_rec.mjs <输出.webm> "<查询串>" <录几秒> [快进到对局第几秒再录=0]
// 把游戏里的声音录下来（页面里接一个 MediaRecorder 到音效的总线上），顺带报一下这段时间里的峰值和平均音量。
// 我听不了声音，靠这个确认“有声音、不爆音”；好不好听要人来听。地址由 MOBA_URL 指定（默认 5190）。
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const [out, query, sec = "12", skip = "0"] = process.argv.slice(2), base = process.env.MOBA_URL || "http://localhost:5190/map.html";
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 600000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--autoplay-policy=no-user-gesture-required", "--window-size=1280,720"] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 720 }); const errors = [];
  page.on("pageerror", e => errors.push(String(e).slice(0, 200)));
  await page.goto(base + "?" + query, { waitUntil: "load" }); await page.waitForFunction("window.__ready === true", { timeout: 180000 });
  await page.mouse.click(640, 300); await page.evaluate("__sfx.wake()");
  if (+skip > 0) { await page.evaluate("__setSpeed(10)"); await page.waitForFunction(`__sim.time >= ${skip}`, { timeout: 600000, polling: 200 }); await page.evaluate("__setSpeed(1)"); }
  const res = await page.evaluate(async sec => {
    const ctx = __sfx.ctx(), o = __sfx.out(); if (!ctx || !o) return { err: "没有 AudioContext" }; await ctx.resume();
    const dst = ctx.createMediaStreamDestination(), an = ctx.createAnalyser(); an.fftSize = 2048; o.connect(dst); o.connect(an);
    const rec = new MediaRecorder(dst.stream, { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 128000 }), parts = []; rec.ondataavailable = e => parts.push(e.data); rec.start(250);
    const buf = new Float32Array(an.fftSize); let peak = 0, sum = 0, n = 0, loud = 0; const t0 = performance.now();
    while (performance.now() - t0 < sec * 1000) { an.getFloatTimeDomainData(buf); let p = 0, s = 0; for (const v of buf) { p = Math.max(p, Math.abs(v)); s += v * v; } peak = Math.max(peak, p); const r = Math.sqrt(s / buf.length); sum += r; n++; if (r > 0.02) loud++; await new Promise(r => setTimeout(r, 40)); }
    rec.stop(); await new Promise(r => (rec.onstop = r));
    const b = new Uint8Array(await new Blob(parts).arrayBuffer()); let bin = ""; for (let i = 0; i < b.length; i += 8192) bin += String.fromCharCode.apply(null, b.subarray(i, i + 8192));
    return { state: ctx.state, peak: +peak.toFixed(3), rms: +(sum / n).toFixed(4), 有声音的时间占比: +(loud / n).toFixed(2), b64: btoa(bin) };
  }, +sec);
  if (res.b64) { fs.writeFileSync(out, Buffer.from(res.b64, "base64")); delete res.b64; }
  console.log(JSON.stringify(res), errors.length ? errors.slice(0, 3) : "");
} finally { await browser.close(); }
