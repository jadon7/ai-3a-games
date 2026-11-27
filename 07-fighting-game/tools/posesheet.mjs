#!/usr/bin/env node
// 把某个角色定在某段动作的某几个时刻，近景拍下来拼成联系表。查动作本身的姿势问题用（脖子、肩、腰有没有折过头）。
// 用法:
//   node tools/posesheet.mjs --out docs/anim_check/yanjin_hits.jpg --who 0 --clips "hit_heavy:0.1,0.17,0.3;hit_air:0.1,0.2"
//        [--q "p1=yanjin&p2=lingshuang&training&mute&nostage"] [--view front|side|back] [--cols 6] [--w 640] [--h 720] [--jolt 0.38,0.6,0.3]
//   --clips 里每段写成 动作名:时刻,时刻…（秒）；只写动作名就按 --n（默认 6）等分
//   --dist 机位远近的倍数（默认 1 是上半身近景，1.7 左右能拍全身），--ly 镜头看向的高度（默认 1.2 米）
//   --jolt 把受击弹簧定在给定的 后仰,拧转,侧倾（弧度）上再拍（看动作和弹簧叠起来的最坏情况）
// 每张小图左上角是「动作 时刻」，右上角是腰（胯→胸）和脖子（胸→头）相对站姿的角度：仰俯（负是后仰）/ 侧倾 / 扭转。
// 地址栏加 nolimit（写进 --q）可以关掉关节限位，看动作原本的样子。
import { chromium } from 'playwright-core';
const a = process.argv.slice(2); const opt = {};
for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) { opt[a[i].slice(2)] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : '1'; }
const W = +(opt.w ?? 640), H = +(opt.h ?? 720), cols = +(opt.cols ?? 6), who = +(opt.who ?? 0);
const q = opt.q ?? 'p1=yanjin&p2=lingshuang&training&mute&nostage';
const url = `http://localhost:${opt.port ?? 5300}/?direct&${q}&nohud`;
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
  const durs = await page.evaluate(({ who }) => {
    const g = window.game, d = window.__dbg;
    g.manual = true; d.run(0.4); d.skipIntro(); d.place(-1.6, 1.6); d.run(0.5); g.paused = true;
    const v = g.views[who]; const out = {}; for (const [k, c] of Object.entries(v.animator.clips)) out[k] = c.duration; return out;
  }, { who });
  const list = [];
  for (const part of (opt.clips ?? 'idle').split(';')) {
    const [name, ts] = part.split(':');
    if (durs[name] === undefined) { errors.push('没有这段动作: ' + name); continue; }
    const n = +(opt.n ?? 6);
    const times = ts ? ts.split(',').map(Number) : Array.from({ length: n }, (_, i) => +(durs[name] * (i + 0.5) / n).toFixed(2));
    for (const t of times) list.push({ name, t });
  }
  const shots = [];
  for (const s of list) {
    const info = await page.evaluate(({ who, name, t, view, jolt, look, dist, ly }) => {
      const g = window.game, d = window.__dbg, v = g.views[who], f = v.fighter;
      f.anim.name = name; f.anim.t = t; f.anim.rate = 0; f.anim.fade = 0; f.anim.loop = false; f.anim.seq++;
      // 默认不要“头部跟随对手”（只有站立、防御时才有），看的是动作本身；加 --look 保留
      if (!look) { f.state = 'attack'; v.lookW = 0; }
      const x = f.x, s = f.facing;
      // 机位：front 是斜前方近景，side 是对战镜头的方向，back 是斜后方
      const off = view === 'side' ? [0, 0.05, 3.4] : view === 'back' ? [-1.7 * s, 0.35, 2.0] : [1.9 * s, 0.35, 2.2];
      d.cam(x + off[0] * dist, ly + off[1] * dist, off[2] * dist, x, ly, 0, 34);
      // 暂停状态下弹簧不走，直接把四个受击弹簧定在给定的值上
      const jv = jolt ? jolt.split(',').map(Number) : [0, 0, 0];
      for (const j of Object.values(v.jolts)) { j.bend = jv[0] || 0; j.twist = jv[1] || 0; j.roll = jv[2] || 0; j.bendV = j.twistV = j.rollV = 0; }
      for (let i = 0; i < 3; i++) g.tick(1 / 60);
      const L = d.limits(who);
      return L ? L.map((l) => `${l.chain === 'Hips>Spine2' ? '腰' : '颈'} ${l.pitch.toFixed(0)}/${l.roll.toFixed(0)}/${l.twist.toFixed(0)}`).join('  ') : null;
    }, { who, name: s.name, t: s.t, view: opt.view ?? 'front', jolt: opt.jolt ?? '', look: !!opt.look, dist: +(opt.dist ?? 1), ly: +(opt.ly ?? 1.2) });
    shots.push({ ...s, info, data: (await page.screenshot({ type: 'jpeg', quality: 88 })).toString('base64') });
  }
  const rows = Math.ceil(shots.length / cols), tw = Math.round(1920 / cols), th = Math.round((tw * H) / W);
  const sheet = await browser.newPage({ viewport: { width: tw * cols, height: th * rows }, deviceScaleFactor: 1 });
  await sheet.setContent(`<body style="margin:0;background:#000;display:grid;grid-template-columns:repeat(${cols},${tw}px);font:13px/1 monospace;color:#fff">` + shots.map((s) => `<div style="position:relative;width:${tw}px;height:${th}px"><img src="data:image/jpeg;base64,${s.data}" style="width:100%;height:100%;display:block"><span style="position:absolute;left:6px;top:6px;background:#000a;padding:2px 5px">${s.name} ${s.t}s</span>${s.info ? `<span style="position:absolute;right:6px;top:6px;background:#000a;padding:2px 5px">${s.info}</span>` : ''}</div>`).join('') + '</body>');
  await sheet.waitForTimeout(200);
  await sheet.screenshot({ path: opt.out ?? 'posesheet.jpg', type: 'jpeg', quality: 86 });
  console.log(JSON.stringify({ out: opt.out ?? 'posesheet.jpg', shots: shots.map((s) => `${s.name}@${s.t} ${s.info ?? ''}`), errors: errors.slice(0, 10) }));
} finally { await browser.close(); }
