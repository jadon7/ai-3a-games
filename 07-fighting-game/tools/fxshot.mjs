#!/usr/bin/env node
// 用本机 Chrome（无界面、走真实显卡）拍一招的连拍联系表，或者拍任意时刻的画面。
// 用法:
//   node tools/fxshot.mjs --out docs/x/sp1.jpg --move sp1 [--who 0] [--frames 4,10,16,24,36,50] [--gap 2.6]
//        [--q "standin&training&mute"] [--opp dummy|block|cpu] [--cols 4] [--w 1280] [--h 720] [--pre "页面里先执行的 JS"] [--port 5300]
//   --move 可以写多个，用逗号隔开，按顺序连着出（比如 light1,light2,light3 每个间隔 --chain 帧，默认 10）
//   --frames 是出招以后第几帧截图（60 帧每秒，按真实时间走，顿帧和慢动作都算在内）
//   不写 --move：只执行 --pre，然后按 --frames 截图（拍对局里的某个时刻）。加 --intro 不跳过开场（拍出场演出）；加 --hud 带上对战界面
// 输出一张拼好的联系表，并打印页面里的报错和最后的状态。
import { chromium } from 'playwright-core';
const a = process.argv.slice(2); const opt = {};
for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) { opt[a[i].slice(2)] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : '1'; }
const W = +(opt.w ?? 1280), H = +(opt.h ?? 720), cols = +(opt.cols ?? 4);
const frames = (opt.frames ?? '4,10,16,24,34,46,60,80').split(',').map(Number);
const q = opt.q ?? 'standin&training&mute';
const url = `http://localhost:${opt.port ?? 5300}/?direct&${q}${opt.opp === 'cpu' ? '&p2c=cpu' : ''}${opt.hud ? '' : '&nohud'}`;
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars', '--mute-audio', `--window-size=${W},${H}`],
});
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on('console', (m) => { if (m.type() === 'error') errors.push('[error] ' + m.text().slice(0, 400)); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + String(e).slice(0, 400)));
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction('window.__ready === true', null, { timeout: 90000 });
  const who = +(opt.who ?? 0), gap = +(opt.gap ?? 2.4), moves = opt.move ? opt.move.split(',') : [], chain = +(opt.chain ?? 10);
  await page.evaluate(({ who, gap, opp, pre, intro }) => {
    const g = window.game, d = window.__dbg;
    g.manual = true; if (!intro) { d.run(0.4); d.skipIntro(); d.place(-gap / 2, gap / 2); d.run(0.5); }
    if (opp === 'block') { const src = g.match.inputs[1 - who]; if (src.cmd) src.cmd.G = true; d.run(0.2); }
    if (pre) (0, eval)(pre);
  }, { who, gap, opp: opt.opp ?? 'dummy', pre: opt.pre ?? '', intro: !!opt.intro });
  const shots = []; let cur = 0, mi = 0;
  const fire = async () => { if (mi < moves.length) { const id = moves[mi++]; await page.evaluate(({ who, id }) => { const m = window.game.match, f = m.f[who]; const mv = f.def.moves[id]; if (mv) { if (mv.cost) f.meter = 100; f.buf.length = 0; if (f.state === 'attack' || f.state === 'stand' || f.state === 'block') window.__dbg.move(who, id); } }, { who, id }); } };
  await fire();
  for (const f of frames) {
    while (cur < f) { const next = Math.min(f, (Math.floor(cur / chain) + 1) * chain); await page.evaluate((n) => window.__dbg.run(n / 60), next - cur); cur = next; if (cur % chain === 0 && mi < moves.length && cur < f + 1) await fire(); }
    shots.push({ f, data: (await page.screenshot({ type: 'jpeg', quality: 88 })).toString('base64') });
  }
  const state = await page.evaluate(() => JSON.stringify(window.__dbg.state()));
  // 拼联系表
  const rows = Math.ceil(shots.length / cols), tw = Math.round(1920 / cols), th = Math.round((tw * H) / W);
  const sheet = await browser.newPage({ viewport: { width: tw * cols, height: th * rows }, deviceScaleFactor: 1 });
  await sheet.setContent(`<body style="margin:0;background:#000;display:grid;grid-template-columns:repeat(${cols},${tw}px);font:14px/1 monospace;color:#fff">` + shots.map((s) => `<div style="position:relative;width:${tw}px;height:${th}px"><img src="data:image/jpeg;base64,${s.data}" style="width:100%;height:100%;display:block"><span style="position:absolute;left:6px;top:6px;background:#000a;padding:2px 5px">${opt.move ?? ''} f${s.f}</span></div>`).join('') + '</body>');
  await sheet.waitForTimeout(200);
  await sheet.screenshot({ path: opt.out ?? 'fxshot.jpg', type: 'jpeg', quality: 86 });
  console.log(JSON.stringify({ out: opt.out ?? 'fxshot.jpg', url, state: JSON.parse(state), errors: errors.slice(0, 10) }));
} finally { await browser.close(); }
