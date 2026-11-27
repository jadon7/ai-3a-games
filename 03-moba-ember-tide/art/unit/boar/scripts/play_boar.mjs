#!/usr/bin/env node
// 在测试场里把野猪当成玩家的模型（借岚的位置），对着对面的假人英雄连打普攻，按原速连拍。
// tools/kit_test.mjs 打的是小兵（三下就死，看不到 attack1、attack2 轮流），而且岚的攻速 1.92 会把动作加速好几倍。
// 这里把攻速压到 0.3（每次出手之间留足时间，动作按原速播），打血厚的假人，顺便每 50 毫秒记一次当前在播哪段动作。
// 用法: node art/unit/boar/scripts/play_boar.mjs <输出目录> [张数=40] [间隔毫秒=150] [look，如 height:2.7,ring:1.9,bar:0] [死亡=0|1：打完以后把自己弄死，拍死亡动作]
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const [out, nShots = "40", gap = "150", look = "height:2.7,ring:1.9,bar:0", die = "0"] = process.argv.slice(2); const SIDE = +(process.env.SIDE || 0);
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 600000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1500,844"] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1500, height: 844 });
  const errors = []; page.on("pageerror", e => errors.push(String(e).slice(0, 300)));
  await page.goto(`http://localhost:5183/map.html?arena=1&h=lan&glb=../unit/boar&look=${look}`, { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true && window.__arena", { timeout: 90000 });
  const ev = s => page.evaluate(s), sleep = ms => new Promise(r => setTimeout(r, ms)); await sleep(900);
  if (process.env.CLIP) {      // CLIP=动作名[,动作名]：不打人，原地（出生点旁边的空地）直接播这几段动作，看游戏机位下动作本身的样子。YAW=朝向（度，可选）
    for (const clip of process.env.CLIP.split(",")) {
      const dur = await ev(`(() => { const a = __play.actor; a.stop(); const c = a.hero.clips.get(${JSON.stringify(clip)}); a.hero.play(${JSON.stringify(clip)}, { loop: false, fade: 0.05 }); return c ? (c.duration ?? c.getClip?.().duration ?? 0) : -1; })()`);
      const n = Math.ceil(((dur > 0 ? dur : 3) * 1000 + 200) / +gap);
      for (let i = 0; i < n; i++) { await page.screenshot({ path: `${out}/${clip}_${String(i).padStart(2, "0")}.jpg`, type: "jpeg", quality: 86 }); await sleep(Math.max(0, +gap - 45)); }
      console.log(clip, "时长", dur, "拍了", n, "张，当前动作", await ev("__play.actor.hero.current"));
    }
    process.exit(0);
  }
  // 站到假人跟前，攻速压低，开打
  const info = await ev(`(() => { const SIDE = ${SIDE}; const a = __play.actor, d = __arena.dummy, h = __sim.hero; const dx = a.pos.x - d.x, dz = a.pos.z - d.z, l = Math.hypot(dx, dz); let ux = dx / l, uz = dz / l; if (SIDE) [ux, uz] = [-uz * SIDE, ux * SIDE]; let px = d.x + ux * 4.2, pz = d.z + uz * 4.2;      /* SIDE=±1：绕到假人侧面站，野猪侧身对着镜头，动作看得清 */ if (!__nav.walkable(px, pz)) [px, pz] = __nav.nearest(px, pz); a.teleport(px, pz);
    window.__as0 = h.h.stat.as; window.__log = []; window.__t0 = performance.now(); window.__iv = setInterval(() => { h.h.stat.as = 0.3; d.hp = d.max; window.__log.push([Math.round(performance.now() - window.__t0), a.state(), a.hero.current]); }, 50);
    h.h.stat.as = 0.3; __play.attack(d); return { as0: window.__as0, meta: a.meta, height: a.kit?.height }; })()`);
  for (let i = 0; i < +nShots; i++) { await page.screenshot({ path: `${out}/P_${String(i).padStart(2, "0")}.jpg`, type: "jpeg", quality: 86 }); await sleep(+gap); }
  const log = await ev("(() => { clearInterval(window.__iv); return window.__log; })()");
  // 把时间线压成“哪段动作从几毫秒到几毫秒”
  const runs = []; for (const [t, st, clip] of log) { const k = st + ":" + clip; if (!runs.length || runs.at(-1).k !== k) runs.push({ k, from: t, to: t }); else runs.at(-1).to = t; }
  console.log(JSON.stringify({ 原来的攻速: info.as0, 时间表: info.meta, 动作时间线: runs.map(r => `${r.k} ${r.from}~${r.to}ms`), errors }, null, 1));
  if (die === "1") {
    await ev("(() => { const h = __sim.hero; h.shield = 0; __sim.damage(h, 1e7, null, { type: 'true' }); })()");
    for (let i = 0; i < 16; i++) { await sleep(200); await page.screenshot({ path: `${out}/D_${String(i).padStart(2, "0")}.jpg`, type: "jpeg", quality: 86 }); }
    console.log("死亡以后:", await ev("JSON.stringify([__play.state(), __play.actor.hero.current])"));
  }
} finally { await browser.close(); }
