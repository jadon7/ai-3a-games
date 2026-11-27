#!/usr/bin/env node
// 在测试场里放一个技能（或普攻、死亡、跑），连拍并记下每张图距离出手过了多少秒（游戏里的时间），用来核对动作和特效对不对得上。
// 用法: node cast_burst.mjs <输出目录> <键: A|Q|W|E|R|RUN|DEATH> [张数=14] [地址参数] [每张之间再等几毫秒=0]
// 产出: <输出目录>/<键>_<序号>_<秒>.jpg（裁到英雄附近）
import puppeteer from "/Users/jadon7/Documents/SynologyDrive/code/moba/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
import fs from "node:fs";
const [out, key, n = "14", q = "glb=stag&look=height:3.4,ring:1.3,head:1,hand:1&dist=17", gap = "0"] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 600000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1280,720"] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 720 });
  const errors = []; page.on("pageerror", e => errors.push(String(e).slice(0, 300)));
  await page.goto(`http://localhost:5183/map.html?arena=1&h=osen&nohud=1&${q}`, { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true && window.__arena", { timeout: 90000 });
  const ev = s => page.evaluate(s), sleep = ms => new Promise(r => setTimeout(r, ms));
  await sleep(1200);
  await ev("(() => { for (const el of document.querySelectorAll('body > div')) if (el.querySelector('select') && !el.classList.contains('hud')) el.style.display = 'none'; const a = __play.actor; for (const k of ['Q','W','E','R']) a.setCd(k, 0); const h = __sim.hero; h.h.mana = h.h.stat.mana; })()");
  let did;
  if (key === "A") did = await ev("(() => { __play.attack(__arena.foes[0]); return __sim.time; })()");
  else if (key === "RUN") did = await ev("(() => { const a = __play.actor; a.moveTo(a.pos.x - 12, a.pos.z + 1); return __sim.time; })()");
  else if (key === "DEATH") did = await ev("(() => { const h = __sim.hero; __sim.damage(h, 999999, null, { type: \"true\" }); return __sim.time; })()");
  else did = await ev(`(() => { const A = __arena, f = A.foes, cx = f.reduce((s, e) => s + e.x, 0) / f.length, cz = f.reduce((s, e) => s + e.z, 0) / f.length; __play.cast(${JSON.stringify(key)}, cx, cz, null); return __sim.time; })()`);
  const t0 = did;
  for (let i = 0; i < +n; i++) {
    const t = await ev("__sim.time"); const name = `${out}/${key}_${String(i).padStart(2, "0")}_${(t - t0).toFixed(2)}.jpg`;
    await page.screenshot({ path: name, type: "jpeg", quality: 85, clip: { x: 340, y: 110, width: 600, height: 460 } });
    if (+gap) await sleep(+gap);
  }
  console.log(JSON.stringify({ key, state: await ev("__play.state()"), errors: errors.slice(0, 3) }));
} finally { await browser.close(); }
