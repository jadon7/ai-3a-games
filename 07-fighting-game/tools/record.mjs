#!/usr/bin/env node
// 逐帧录制实机画面：页面按固定的 1/60 秒一帧推进，每帧截图，直接喂给 ffmpeg 编码成 mp4。
// 不受机器当时卡不卡的影响，出来一定是流畅的 60 帧（没有声音：手动推进时音频不走）。
// 用法:
//   node tools/record.mjs --out docs/showcase/match.mp4 --sec 40 [--q "p1c=cpu&p2c=cpu&level=3&mute"] [--w 1920] [--h 1080]
//        [--hud] [--intro] [--pre "开录前在页面里执行的 JS"] [--skip 秒：先空跑这么久再开录] [--crf 21]
//   默认跳过开场、不带界面；--intro 从开场演出开始录；--hud 带对战界面。
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
const a = process.argv.slice(2); const opt = {};
for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) { opt[a[i].slice(2)] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : '1'; }
const W = +(opt.w ?? 1920), H = +(opt.h ?? 1080), sec = +(opt.sec ?? 20), fps = 60;
const out = opt.out ?? 'record.mp4';
mkdirSync(dirname(out), { recursive: true });
const url = `http://localhost:${opt.port ?? 5300}/?direct&${opt.q ?? 'p1c=cpu&p2c=cpu&level=3&mute'}${opt.hud ? '' : '&nohud'}`;
const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', String(opt.crf ?? 21), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out],
  { stdio: ['pipe', 'inherit', 'inherit'], env: { ...process.env, DYLD_LIBRARY_PATH: '/opt/homebrew/Cellar/x265/4.2/lib' } });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars', '--mute-audio', `--window-size=${W},${H}`] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction('window.__ready === true', null, { timeout: 90000 });
  await page.evaluate(({ intro, pre, skip }) => { const g = window.game, d = window.__dbg; g.manual = true; if (!intro) { d.run(0.3); d.skipIntro(); } if (pre) (0, eval)(pre); if (skip) d.run(skip); }, { intro: !!opt.intro, pre: opt.pre ?? '', skip: +(opt.skip ?? 0) });
  const n = Math.round(sec * fps); const t0 = Date.now();
  for (let i = 0; i < n; i++) {
    await page.evaluate(() => window.game.tick(1 / 60));
    const buf = await page.screenshot({ type: 'jpeg', quality: 93 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if (i % 300 === 299) console.error(`  ${i + 1}/${n} 帧，已用 ${Math.round((Date.now() - t0) / 1000)} 秒`);
  }
  const state = await page.evaluate(() => JSON.stringify(window.__dbg.state()));
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  console.log(JSON.stringify({ out, frames: n, seconds: sec, took: Math.round((Date.now() - t0) / 1000), state: JSON.parse(state).phase, errors }));
} finally { await browser.close(); }
