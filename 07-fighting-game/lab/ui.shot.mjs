#!/usr/bin/env node
// 界面截图：无界面 Chrome 打开游戏，按场景走流程并截图。
// 用法：node lab/ui.shot.mjs <输出目录> [宽=1920] [高=1080] [场景,逗号分隔=all] [额外参数=standin]
// 场景：main select versus hud super ko win result pause moves training watch
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const [outDir = 'docs/ui', W = '1920', H = '1080', only = 'all', extra = 'standin'] = process.argv.slice(2);
const base = process.env.GAME_URL || 'http://localhost:5300/lab/ui.html';
fs.mkdirSync(outDir, { recursive: true });
const want = (s) => only === 'all' || only.split(',').includes(s);
const tag = `${W}x${H}`;

const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
});
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: +W, height: +H } });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + String(e).slice(0, 300)));
  const sleep = (ms) => page.waitForTimeout(ms);
  const shot = async (name) => { const p = `${outDir}/${name}-${tag}.jpg`; await page.screenshot({ path: p, type: 'jpeg', quality: 88 }); console.log('shot', p); };
  const key = async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await sleep(140); } };
  const ev = (fn, arg) => page.evaluate(fn, arg);

  await page.goto(base + '?' + extra, { waitUntil: 'load', timeout: 90000 });
  await page.waitForSelector('.scr.main', { timeout: 90000 });
  await page.waitForFunction(() => window.game?.match && window.game.config?.showcase, null, { timeout: 60000 });
  await sleep(2600);
  if (want('main')) await shot('main');

  // 单人：选人
  await key('Enter');
  await page.waitForSelector('.scr.sel'); await sleep(1600);
  if (want('select')) await shot('select');
  await key('KeyJ'); await sleep(1300);
  if (want('select')) await shot('select-opp');
  await key('KeyJ'); await sleep(500);
  if (want('select')) await shot('select-level');
  await key('KeyJ');
  await page.waitForSelector('.scr.vs'); await sleep(1300);
  if (want('versus')) await shot('versus');
  if (!want('hud') && !want('super') && !want('pause') && !want('ko') && !want('win') && !want('result') && !want('round')) { console.log('done'); process.exit(0); }
  await page.waitForFunction(() => window.game?.match && !window.game.config.showcase, null, { timeout: 30000 });
  await sleep(1200);
  // 动画停在指定毫秒再截（无界面 Chrome 帧率低，实时截容易错过）
  const frozen = async (name, ms) => { await ev((t) => window.__hud.freeze(t), ms); await sleep(150); await shot(name); await ev(() => window.__hud.thaw()); };
  await ev(() => { window.__dbg.skipIntro(); window.__dbg.place(-0.9, 0.9); const m = window.game.match; m.f[0].meter = 100; m.f[1].meter = 62; });
  await sleep(1200);
  if (want('round')) {
    await ev(() => window.__hud.announceRound(3, true)); await frozen('round', 620);
    await ev(() => window.__hud.announceFight()); await frozen('fight', 420);
    await sleep(900);
  }
  await ev(() => window.__dbg.move(0, 'heavy')); await sleep(250);
  await ev(() => { const m = window.game.match; m.f[1].comboHits = 7; m.f[1].comboDmg = 386; m.f[0].wins = 1; m.f[1].guard = 22; m.f[0].hp = Math.round(m.f[0].def.hp * 0.62); });
  await sleep(120);
  await ev(() => window.__dbg.move(1, 'sp1')); await sleep(200);
  if (want('hud')) await frozen('hud', 330);
  await sleep(1600);
  if (want('super')) {
    await ev(() => { window.__dbg.place(-0.9, 0.9); window.__dbg.move(0, 'ult'); });
    await page.waitForSelector('.cut', { timeout: 5000 }).catch(() => {});
    await frozen('super', 560);
    await sleep(2600);
    await ev(() => { window.__dbg.place(0.9, -0.9); window.__dbg.move(1, 'ult'); });
    await page.waitForSelector('.cut', { timeout: 5000 }).catch(() => {});
    await frozen('super-p2', 560);
    await sleep(3000);
  }
  if (want('pause')) {
    await key('Escape'); await sleep(500); await shot('pause');
    await key('KeyS'); await key('KeyJ'); await sleep(400); await shot('moves');
    await key('KeyK'); await sleep(200); await key('Escape'); await sleep(300);
  }
  // 终结
  await ev(() => { const m = window.game.match; m.f[0].hp = m.f[0].def.hp; m.f[0].wins = 1; m.f[1].hp = 0; });
  await page.waitForSelector('.an.ko', { timeout: 8000 }).catch(() => {});
  if (want('ko')) await frozen('ko', 420);
  await page.waitForSelector('.an.victory', { timeout: 15000 }).catch(() => {});
  if (want('win')) await frozen('win', 900);
  await page.waitForSelector('.scr.res', { timeout: 20000 }).catch(() => {});
  await sleep(1800);
  if (want('result')) await shot('result');
  const cost = await ev(() => ({ avgMs: window.__hud.costSum / Math.max(1, window.__hud.costN), frames: window.__hud.costN }));
  console.log('hud update cost:', JSON.stringify(cost));
} finally {
  if (errors.length) console.log('errors:', JSON.stringify(errors.slice(0, 10), null, 1));
  await browser.close();
}
