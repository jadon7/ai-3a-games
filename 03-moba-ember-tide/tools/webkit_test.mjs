// 用法: node tools/webkit_test.mjs <输出目录> [地址=http://localhost:5184/]
// 用 WebKit（Safari 的内核，Playwright 带的那一份）按 iPhone 横屏的参数打开游戏：主菜单、选人、进对局、推摇杆、放技能，各截一张图，记下报错和帧率。
// 这不是真的 iPhone 上的 Safari（没有刘海、没有地址栏、显卡是这台电脑的），只能说明“同一个内核下页面能跑、布局对”。
import { webkit, devices } from "playwright-core";
import fs from "node:fs";
const out = process.argv[2], base = process.argv[3] || "http://localhost:5184/"; fs.mkdirSync(out, { recursive: true });
const browser = await webkit.launch({ headless: true });
const R = {};
try {
  const ctx = await browser.newContext({ ...devices["iPhone 14 landscape"], viewport: { width: 844, height: 390 } });
  const page = await ctx.newPage(); const errors = [];
  page.on("pageerror", e => errors.push(String(e).slice(0, 240))); page.on("console", m => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
  const sleep = ms => new Promise(r => setTimeout(r, ms)), ev = s => page.evaluate(s);
  await page.goto(base + "?touch=1", { waitUntil: "load" });      /* 这个内核不模拟“主要的指点设备是手指”，用开关强制进触屏布局（真手机上是自动的） */ await page.waitForFunction("window.__ready === true", null, { timeout: 180000 }); await sleep(1500);
  R["内核"] = await ev("navigator.userAgent.match(/Version\\/[\\d.]+/)?.[0] + ' ' + (document.createElement('canvas').getContext('webgl2') ? 'WebGL2' : '没有 WebGL2')");
  await page.screenshot({ path: out + "/home.png" });
  R["主菜单有安装提示"] = await ev("!!document.querySelector('.lob-home .tip')");
  // 第九轮起选人是先选位置再选英雄（match5）；第二个参数之后可以带英雄 id，默认中单伊缇
  const hero = process.argv[4] || "iti";
  await page.tap(".lob-home [data-a=play]"); await sleep(600); await page.tap(".lob-pick .tile[data-p=mid]"); await sleep(900);
  if (await ev(`!!document.querySelector('.lob-pick .card[data-id="${hero}"]')`)) await page.tap(`.lob-pick .card[data-id="${hero}"]`); else await page.tap(".lob-pick .card:not(.soon)");
  await sleep(500); await page.screenshot({ path: out + "/pick.png" }); R["选的英雄"] = await ev("document.querySelector('.lob-pick .card.sel')?.dataset.id ?? null");
  R["选人界面锁定键在屏幕内"] = await ev("(() => { const r = document.querySelector('.lob-pick [data-a=lock]').getBoundingClientRect(); return r.bottom <= innerHeight && r.right <= innerWidth && r.width > 40; })()");
  await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.tap(".lob-pick [data-a=lock]")]);
  const t0 = Date.now(); await page.waitForFunction("window.__ready === true", null, { timeout: 180000 }); R["进对局用时（秒，本机）"] = +((Date.now() - t0) / 1000).toFixed(1); await sleep(2500);
  R["触屏布局"] = await ev("document.querySelector('.hud').classList.contains('touch')"); R["用的是手机档模型"] = await ev("performance.getEntriesByType('resource').some(e => /\\/hero\\/m\\/.*\\.glbz/.test(e.name))");
  await page.screenshot({ path: out + "/game.png" });
  // 推摇杆（真的触摸事件）
  const box = async sel => ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  const cdp = async (type, pts) => page.evaluate(([type, pts]) => { const el = document.elementFromPoint(pts[0], pts[1]) || document.body; el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: pts[0], clientY: pts[1] })); }, [type, pts]);
  const p0 = await ev("[__sim.hero.x, __sim.hero.z]"); const st = await box(".tc-stick .base");
  await ev(`(() => { const z = document.querySelector('.tc-stick'); const mk = (t, x, y) => z.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: x, clientY: y })); mk('pointerdown', ${st[0]}, ${st[1]}); mk('pointermove', ${st[0] + 50}, ${st[1] - 30}); window.__up = () => mk('pointerup', ${st[0] + 50}, ${st[1] - 30}); })()`);
  await sleep(1800); await page.screenshot({ path: out + "/move.png" }); await ev("__up()"); const p1 = await ev("[__sim.hero.x, __sim.hero.z]"); R["推摇杆走了几米"] = +Math.hypot(p1[0] - p0[0], p1[1] - p0[1]).toFixed(1);
  await ev("__setSpeed(12)"); await sleep(5000); await ev("__setSpeed(1)"); await sleep(1500);
  R["帧率（本机显卡）"] = Math.round(await ev("__stats.fps")); R["画布像素"] = await ev("document.getElementById('view').width + '×' + document.getElementById('view').height"); R["分辨率系数"] = await ev("__stats.res");
  await page.tap(".gold"); await sleep(500); await page.screenshot({ path: out + "/shop.png" }); R["点金币开了商店"] = await ev("!document.querySelector('.shop').hidden");
  R["离线缓存注册了"] = await ev("navigator.serviceWorker ? navigator.serviceWorker.getRegistration().then(r => !!r) : '这个内核不给'");
  R["报错"] = errors.slice(0, 6);
} catch (e) { R["出错"] = String(e).slice(0, 400); } finally { await browser.close(); }
console.log(JSON.stringify(R, null, 1));
