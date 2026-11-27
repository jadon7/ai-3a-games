#!/usr/bin/env node
// 量真实帧率：电脑对打跑一段，取平均帧时间。用法: node tools/fps.mjs [--q "p1c=cpu&p2c=cpu&mute"] [--w 1920] [--h 1080] [--sec 8] [--dsf 1]
import { chromium } from 'playwright-core';
const a = process.argv.slice(2); const opt = {};
for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) { opt[a[i].slice(2)] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : '1'; }
const W = +(opt.w ?? 1920), H = +(opt.h ?? 1080), sec = +(opt.sec ?? 8);
const url = `http://localhost:${opt.port ?? 5300}/?direct&${opt.q ?? 'p1c=cpu&p2c=cpu&mute&level=3'}`;
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--mute-audio', `--window-size=${W},${H}`, '--disable-frame-rate-limit', '--disable-gpu-vsync'] });
try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: +(opt.dsf ?? 1) });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction('window.__ready === true', null, { timeout: 90000 });
  await page.evaluate(() => window.__dbg.skipIntro());
  const r = await page.evaluate((sec) => new Promise((res) => {
    const ts = []; let last = performance.now(); const t0 = last;
    const tick = (now) => { ts.push(now - last); last = now; if (now - t0 < sec * 1000) requestAnimationFrame(tick); else {
      ts.sort((a, b) => a - b); const avg = ts.reduce((s, v) => s + v, 0) / ts.length; const info = window.game.gfx.renderer.info;
      res({ frames: ts.length, avgMs: +avg.toFixed(2), fps: +(1000 / avg).toFixed(1), p95Ms: +ts[Math.floor(ts.length * 0.95)].toFixed(2), p99Ms: +ts[Math.floor(ts.length * 0.99)].toFixed(2), calls: info.render.calls, tris: info.render.triangles, state: window.__dbg.state().phase }); } };
    requestAnimationFrame(tick);
  }), sec);
  console.log(JSON.stringify({ url, size: `${W}x${H}`, ...r, errors }));
} finally { await browser.close(); }
