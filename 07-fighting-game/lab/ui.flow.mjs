#!/usr/bin/env node
// 其余流程的截图：双人选人、训练、观战演示（自动循环）。
// 用法：node lab/ui.flow.mjs <输出目录> [宽=1920] [高=1080] [场景=p2select,training,watch]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const [outDir = 'docs/ui', W = '1920', H = '1080', only = 'p2select,training,watch'] = process.argv.slice(2);
const want = (s) => only.split(',').includes(s);
fs.mkdirSync(outDir, { recursive: true });
const tag = `${W}x${H}`;
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--mute-audio'] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: +W, height: +H } });
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
  const sleep = (ms) => page.waitForTimeout(ms);
  const shot = async (n) => { const p = `${outDir}/${n}-${tag}.jpg`; await page.screenshot({ path: p, type: 'jpeg', quality: 88 }); console.log('shot', p); };
  const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await sleep(160); } };
  await page.goto('http://localhost:5300/lab/ui.html?standin&mute', { waitUntil: 'load', timeout: 90000 });
  await page.waitForSelector('.scr.main', { timeout: 90000 });
  await page.waitForFunction(() => window.game?.match && window.game.config?.showcase, null, { timeout: 60000 });
  await sleep(1500);
  if (want('p2select')) {
    await key('KeyS'); await key('Enter');
    await page.waitForSelector('.scr.sel'); await sleep(900);
    await key('KeyJ'); await key('ArrowLeft'); await sleep(900);
    await shot('select-2p');
    await key('Escape'); await page.waitForSelector('.scr.main'); await sleep(800);
    await key('KeyW');
  }
  if (want('training')) {
    await key('KeyS', 3); await key('Enter');
    await page.waitForSelector('.scr.sel'); await sleep(700);
    await key('KeyJ'); await sleep(500); await key('KeyJ');
    await page.waitForFunction(() => window.game?.match && !window.game.config.showcase, null, { timeout: 30000 });
    await sleep(800);
    await page.evaluate(() => window.__dbg.skipIntro());
    await sleep(1500);
    await shot('training');
    await key('Escape'); await sleep(400); await key('KeyS', 3); await key('KeyJ');
    await page.waitForSelector('.scr.main'); await sleep(1000);
    await key('KeyW', 3);
  }
  if (want('watch')) {
    await key('KeyS', 2); await key('Enter');
    await page.waitForSelector('.scr.vs', { timeout: 10000 }); await sleep(1200);
    await shot('watch-versus');
    await page.waitForFunction(() => window.game?.match && !window.game.config.showcase, null, { timeout: 30000 });
    await sleep(9000);
    await shot('watch-fight');
    // 快进到结束：把二号位的血清零两次
    for (let r = 0; r < 2; r++) {
      await page.waitForFunction(() => window.game.match.phase === 'fight', null, { timeout: 30000 }).catch(() => {});
      await page.evaluate(() => { window.game.match.f[1].hp = 0; });
      await sleep(500);
    }
    await page.waitForSelector('.scr.res', { timeout: 40000 }); await sleep(1500);
    await shot('watch-result');
    await page.waitForSelector('.scr.vs', { timeout: 15000 }).then(() => console.log('watch loop ok: next versus shown')).catch(() => console.log('watch loop: no next versus'));
  }
} finally {
  if (errors.length) console.log('errors:', JSON.stringify(errors, null, 1));
  await browser.close();
}
