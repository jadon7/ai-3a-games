// 逐帧录制实机画面（确定性：固定步长推进，不受机器快慢影响）→ mp4。
// 用法：node tools/record.mjs --out shots/demo.mp4 [--q "t=2&cammode=chase"] [--seconds 8] [--fps 30] [--w 1920] [--h 1080]
//                             [--events "2.5:window.__game.setCam('side');5:window.__game.flip()"]   （秒:JS，分号分隔）
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2); const opt = { out: 'shots/demo.mp4', q: '', seconds: 8, fps: 30, w: 1920, h: 1080, page: 'index.html', events: '', crf: 18 };
for (let i = 0; i < argv.length; i++) { const k = argv[i].replace(/^--/, ''); const v = argv[++i]; opt[k] = ['seconds', 'fps', 'w', 'h', 'crf'].includes(k) ? parseFloat(v) : v; }
const events = opt.events ? opt.events.split(';').map(e => { const i = e.indexOf(':'); return { t: parseFloat(e.slice(0, i)), js: e.slice(i + 1), done: false }; }) : [];
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = path.join(ROOT, '.cache', 'chrome-rec-' + process.pid), frames = path.join(ROOT, '.cache', 'frames-' + process.pid);
fs.mkdirSync(profile, { recursive: true }); fs.mkdirSync(frames, { recursive: true });
const server = await startServer(0, true);
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: profile,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars', '--mute-audio', '--no-first-run', `--window-size=${opt.w},${opt.h}`] });
let code = 0;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: opt.w, height: opt.h, deviceScaleFactor: 1 });
  const errs = []; page.on('pageerror', e => errs.push(String(e.message).slice(0, 300)));
  await page.goto(`http://127.0.0.1:${server.address().port}/${opt.page}?shot=1&${opt.q}`, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction('window.__READY === true', { timeout: 60000 });
  const sub = Math.max(1, Math.round(60 / opt.fps)), total = Math.round(opt.seconds * opt.fps);
  const t0 = Date.now();
  const log = []; let lastHoops = await page.evaluate('window.__STATS.hoops || 0'), combo = 0, lastHoopT = -99, inFlip = false;
  for (let f = 0; f < total; f++) {
    const t = f / opt.fps;
    for (const ev of events) if (!ev.done && t >= ev.t) { ev.done = true; await page.evaluate(ev.js).catch(e => errs.push('event: ' + e.message)); }
    const st = await page.evaluate(`(window.__advance(${sub}, ${1 / 60}), { hoops: window.__STATS.hoops, flip: window.__game ? window.__game.flight.state.flip : 0, speed: window.__STATS.speed })`);
    if (st.hoops > lastHoops) { combo = (t - lastHoopT < 4.5) ? combo + 1 : 1; lastHoopT = t; log.push({ t: +t.toFixed(3), type: 'hoop', combo }); }
    lastHoops = st.hoops;
    if (st.flip > 0 && !inFlip) log.push({ t: +t.toFixed(3), type: 'flip' });
    inFlip = st.flip > 0;
    if (f % 15 === 0) log.push({ t: +t.toFixed(3), type: 'speed', v: st.speed });
    await page.screenshot({ path: path.join(frames, `f_${String(f).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 95 });
  }
  console.log(`RECORDED ${total} frames in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  fs.writeFileSync(path.resolve(ROOT, opt.out + '.events.json'), JSON.stringify({ seconds: opt.seconds, fps: opt.fps, log }));
  if (errs.length) { code = 1; console.log('ERRORS:\n' + [...new Set(errs)].slice(0, 8).join('\n')); }
  const out = path.resolve(ROOT, opt.out); fs.mkdirSync(path.dirname(out), { recursive: true });
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-r', String(opt.fps), '-i', path.join(frames, 'f_%05d.jpg'), '-c:v', 'libx264', '-preset', 'medium', '-crf', String(opt.crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: 'inherit' });
  console.log('ENCODED', opt.out, 'rc', r.status, fs.existsSync(out) ? (fs.statSync(out).size / 1e6).toFixed(1) + ' MB' : 'missing');
} finally {
  await browser.close(); server.close();
  fs.rmSync(profile, { recursive: true, force: true }); fs.rmSync(frames, { recursive: true, force: true });
}
process.exit(code);
