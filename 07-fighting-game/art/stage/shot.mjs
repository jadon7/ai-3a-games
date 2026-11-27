// 用本机 Chrome（无界面、走真实显卡）截试验页。一次启动截多张。
// 用法: node art/stage/shot.mjs <输出目录> <名字=参数> [<名字=参数> ...]
// 例子: node art/stage/shot.mjs docs/stage "far=cam=far" "near=cam=near&dim=0.5"
// 环境变量：W、H（默认 1920x1080），WAIT（就绪后再等多少毫秒，默认 800）
import { chromium } from 'playwright-core';
const [outDir, ...jobs] = process.argv.slice(2);
const W = +(process.env.W || 1920), H = +(process.env.H || 1080), WAIT = +(process.env.WAIT || 800);
const base = 'http://localhost:5300/lab/' + (process.env.PAGE || 'stage.html');
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars', '--mute-audio', ...(process.env.UNCAP ? ['--disable-frame-rate-limit', '--disable-gpu-vsync'] : [])],
});
try {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  for (const job of jobs) {
    const i = job.indexOf('=');
    const name = job.slice(0, i), query = job.slice(i + 1);
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text().slice(0, 400)}`); });
    page.on('pageerror', (e) => errors.push('[pageerror] ' + String(e).slice(0, 600)));
    await page.goto(base + '?' + query, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction('window.__ready === true', null, { timeout: 120000 }).catch(() => errors.push('[timeout]'));
    await page.waitForTimeout(WAIT);
    const out = `${outDir}/${name}.jpg`;
    await page.screenshot({ path: out, type: 'jpeg', quality: 88 });
    const info = await page.evaluate(() => window.__stats ?? null);
    console.log(JSON.stringify({ out, info, errors: errors.slice(0, 10) }));
    await page.close();
  }
} finally { await browser.close(); }
