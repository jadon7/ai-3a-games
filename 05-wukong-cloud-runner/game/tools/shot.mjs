// 无头 Chrome 截图验证工具（走真实 GPU）。每次调用自带一个临时端口的静态服务器，可多个同时跑、互不干扰。
// 用法：
//   node tools/shot.mjs --out shots/a.png [--page index.html] [--q "shot=1&t=3&cam=chase"] [--w 1920] [--h 1080]
//                       [--wait 30000] [--eval "JS 表达式"] [--settle 0]
//   同一次启动里拍多张：重复写 --q 和 --out（一一对应）。
// 约定：页面准备好并画完请求的那一帧后设 window.__READY = true；可选 window.__STATS（对象）会被打印出来。
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = { out: [], q: [], page: 'index.html', w: 1920, h: 1080, wait: 30000, settle: 0, eval: null };
for (let i = 0; i < argv.length; i++) {
  const k = argv[i].replace(/^--/, ''); const v = argv[++i];
  if (k === 'out' || k === 'q') opt[k].push(v); else if (['w', 'h', 'wait', 'settle'].includes(k)) opt[k] = parseInt(v); else opt[k] = v;
}
if (!opt.out.length) { console.error('需要 --out'); process.exit(2); }
while (opt.q.length < opt.out.length) opt.q.push(opt.q[opt.q.length - 1] || '');

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = path.join(ROOT, '.cache', 'chrome-' + process.pid);
fs.mkdirSync(profile, { recursive: true });
const server = await startServer(0, true);
const port = server.address().port;
let code = 0;
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, userDataDir: profile,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars', '--mute-audio',
    '--autoplay-policy=no-user-gesture-required', '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--no-first-run', '--no-default-browser-check', `--window-size=${opt.w},${opt.h}`],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: opt.w, height: opt.h, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + String(e.message || e).slice(0, 400)));
  page.on('console', m => { if (m.type() === 'error') errs.push('console.error: ' + m.text().slice(0, 400)); });
  page.on('requestfailed', r => errs.push('requestfailed: ' + r.url().slice(0, 200)));
  for (let i = 0; i < opt.out.length; i++) {
    const url = `http://127.0.0.1:${port}/${opt.page}${opt.q[i] ? '?' + opt.q[i] : ''}`;
    const t0 = Date.now();
    await page.goto(url, { waitUntil: 'load', timeout: opt.wait });
    let ready = true;
    try { await page.waitForFunction('window.__READY === true', { timeout: opt.wait }); } catch (e) { ready = false; }
    if (opt.settle) await new Promise(r => setTimeout(r, opt.settle));
    let ev;
    if (opt.eval) { try { ev = await page.evaluate(opt.eval); } catch (e) { ev = 'eval error: ' + e.message; } }
    const out = path.resolve(ROOT, opt.out[i]);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await page.screenshot({ path: out, type: out.endsWith('.jpg') ? 'jpeg' : 'png', ...(out.endsWith('.jpg') ? { quality: 90 } : {}) });
    const stats = await page.evaluate('JSON.stringify(window.__STATS || {})').catch(() => '{}');
    console.log(`SHOT ${opt.out[i]} ready=${ready} ${Date.now() - t0}ms stats=${stats.slice(0, 600)}${ev !== undefined ? ' eval=' + JSON.stringify(ev).slice(0, 400) : ''}`);
    if (!ready) code = 1;
  }
  if (errs.length) { code = 1; console.log('ERRORS:\n' + [...new Set(errs)].slice(0, 12).join('\n')); }
} finally {
  await browser.close();
  server.close();
  fs.rmSync(profile, { recursive: true, force: true });
}
process.exit(code);
