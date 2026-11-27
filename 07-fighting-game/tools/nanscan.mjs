#!/usr/bin/env node
// 查“画面上闪黑色方块”：让电脑对打，逐帧把场景渲染到浮点贴图里找无效像素（NaN / 无穷大）和亮度溢出的像素，
// 并用二分法找出是哪个物体画出来的（页面里的 __dbg.nanScan）。
// 用法:
//   node tools/nanscan.mjs [--sec 60] [--hz 120] [--w 1008] [--h 638] [--dpr 2] [--shots docs/x/nan] [--q "p1=yanjin&p2=lingshuang&p1c=cpu&p2c=cpu&level=3"]
//   --find 最多对多少帧做来源定位（默认 24，定位比较慢）；--v 打印进度
//   --hz 每秒画多少帧（模拟一直是 60；120 就是高刷屏的情况）；--shots 给了就把头几次出问题的画面存成图
import { chromium } from 'playwright-core';
const a = process.argv.slice(2); const opt = {};
for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) { opt[a[i].slice(2)] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : '1'; }
const W = +(opt.w ?? 1008), H = +(opt.h ?? 638), dpr = +(opt.dpr ?? 2), hz = +(opt.hz ?? 120), sec = +(opt.sec ?? 60);
const q = opt.q ?? 'p1=yanjin&p2=lingshuang&p1c=cpu&p2c=cpu&level=3';
const url = `http://localhost:${opt.port ?? 5300}/?direct&${q}&mute&nohud`;
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--hide-scrollbars', '--mute-audio', `--window-size=${W},${H}`],
});
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: dpr });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + String(e).slice(0, 300)));
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction('window.__ready === true', null, { timeout: 90000 });
  await page.evaluate(() => { window.game.manual = true; });
  const total = Math.round(sec * hz), found = new Map(), maxFind = +(opt.find ?? 24); let frames = 0, dirty = 0, shots = 0, located = 0;
  while (frames < total) {
    const n = Math.min(opt.shots && shots < 4 ? 1e9 : 240, total - frames);
    const res = await page.evaluate(({ n, hz, find }) => {
      const g = window.game, d = window.__dbg, hits = [];
      let i = 0;
      for (; i < n; i++) {
        g.tick(1 / hz);
        const r = d.nanScan(find && hits.length < 2);
        if (r) { const s = d.state(); hits.push({ i, r, st: s ? s.f.map((f) => `${f.state}/${f.anim}${f.move ? '(' + f.move + ')' : ''}`).join(' | ') : '' }); if (hits.length >= 1 && n > 1000) { i++; break; } }
      }
      return { ran: i, hits };
    }, { n, hz, find: located < maxFind });
    for (const h of res.hits) {
      dirty++;
      if (!h.r.culprits) continue;
      located++;
      const cs = h.r.culprits.length ? h.r.culprits : [{ path: '（没找到）', mat: '' }];
      for (const c of cs) {
        const key = `${c.path ?? c.note} :: ${c.mat ?? ''}`;
        const e = found.get(key) ?? { n: 0, first: frames + h.i, sample: null, st: h.st, bad: 0, hot: 0, max: 0 };
        e.n++; e.bad = Math.max(e.bad, c.alone?.bad ?? 0); e.hot = Math.max(e.hot, c.alone?.hot ?? 0); e.max = Math.max(e.max, c.alone?.max ?? 0); if (!e.sample) e.sample = c;
        found.set(key, e);
      }
      if (opt.shots && shots < 4) { await page.screenshot({ path: `${opt.shots}_${shots}.jpg`, type: 'jpeg', quality: 85 }); shots++; console.log(`截图 ${opt.shots}_${shots - 1}.jpg 帧 ${frames + h.i} 坏像素 ${h.r.bad} 溢出 ${h.r.hot} 范围 ${JSON.stringify(h.r.box)} ${h.st}`); }
    }
    frames += res.ran;
    if (opt.v) console.log(`… ${frames}/${total} 帧，有问题 ${dirty}，已定位 ${located}`);
  }
  console.log(`一共 ${frames} 帧（${hz} 帧每秒，${W}×${H} ×${dpr}），有问题的 ${dirty} 帧`);
  for (const [k, e] of [...found].sort((x, y) => y[1].n - x[1].n)) {
    console.log(`\n■ ${e.n} 帧  ${k}\n  首次在第 ${e.first} 帧；单独显示时：无效像素最多 ${e.bad}，溢出像素最多 ${e.hot}，正常像素最大值 ${e.max.toFixed(1)}\n  当时两人：${e.st}\n  ${JSON.stringify(e.sample)}`);
  }
  if (errors.length) console.log('页面报错：', errors.slice(0, 5));
} finally { await browser.close(); }
