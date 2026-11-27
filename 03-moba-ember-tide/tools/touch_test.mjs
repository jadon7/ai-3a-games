// 用法: node tools/touch_test.mjs <输出目录>
// 手机横屏、真的发触摸事件：摇杆、攻击键、技能键（点一下、拖动瞄准、拖进取消）、点地面、小地图、商店、计分板、菜单、竖屏暂停。
// 地址由 MOBA_URL 指定（默认 5183 的 map.html）。
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const out = process.argv[2]; fs.mkdirSync(out, { recursive: true });
const base = process.env.MOBA_URL || "http://localhost:5183/map.html", W = 844, H = 390;
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 300000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", `--window-size=${W},${H}`] });
const R = {};
try {
  const page = await browser.newPage(); await page.setViewport({ width: W, height: H, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true });
  await page.setUserAgent("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36");
  const errors = []; page.on("pageerror", e => errors.push(String(e).slice(0, 200))); page.on("console", m => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
  await page.goto(base + "?hero=-6,2,135&solo=1&h=lan", { waitUntil: "load" }); await page.waitForFunction("window.__ready === true", { timeout: 120000 });
  const ev = s => page.evaluate(s), sleep = ms => new Promise(r => setTimeout(r, ms)), T = page.touchscreen;
  const box = async sel => ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, r.width, r.height]; })()`);
  const tap = async (x, y) => { await T.touchStart(x, y); await sleep(40); await T.touchEnd(); };
  const drag = async (x0, y0, x1, y1, hold = 0, steps = 6) => { await T.touchStart(x0, y0); for (let i = 1; i <= steps; i++) { await sleep(25); await T.touchMove(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps); } if (hold) await sleep(hold); };
  await sleep(600);
  R["界面是触屏布局"] = await ev("document.querySelector('.hud').classList.contains('touch') && !!document.querySelector('.tc-stick')");
  // 1 攻击键：旁边放一个不还手的对方小兵（定身，不会走）
  const pin = (dx, dz) => ev(`(() => { const h = __sim.hero; __play.actor.stop(); __play.actor.setCd('Q', 0); if (!window.__d) { window.__d = __sim.add("melee", 1, h.x, h.z, { max: 3000, ad: 0, range: 0.1, period: 99, sight: 0, r: 0.55, state: "idle", lane: 0, s: 0, seen: true, think: 1e9 }); __d.root = 1e9; } __d.x = h.x + ${dx}; __d.z = h.z + ${dz}; __d.fly = 0; __d.hp = __d.max = 3000; })()`);
  await pin(4.5, -1.5); await sleep(300);
  const atk = await box(".tc-atk"); await tap(atk[0], atk[1]); await sleep(2600); R["点一下攻击键，小兵掉的血"] = 3000 - await ev("__d.hp");
  // 按住攻击键：一直打
  await pin(3, 2); await sleep(300); await T.touchStart(atk[0], atk[1]); await sleep(3200); R["按住攻击键 3 秒，小兵掉的血"] = 3000 - await ev("__d.hp"); await T.touchEnd();
  // 2 技能键点一下：自动对准小兵放钩引（小兵在右上）
  await pin(7, -4); await sleep(500);
  const q = await box(".skills .sk:not(.p)"); await tap(q[0], q[1]); await sleep(1500);
  R["点一下 Q：自动对准，打中掉的血"] = 3000 - await ev("__d.hp"); R["Q 进了冷却"] = await ev("__play.actor.cdLeft('Q') > 0");
  // 3 按住拖动瞄准：小兵挪到画面左下，手指从 Q 往左下拖；松手放出去
  await pin(-6, 5); await sleep(1300); await pin(-6, 5); await sleep(300);
  await drag(q[0], q[1], q[0] - 42, q[1] + 35, 350); R["拖动时在瞄准"] = await ev("__play.aiming()") === "Q"; R["拖动时出了取消圈"] = await ev("!document.querySelector('.tc-cancel').hidden"); await page.screenshot({ path: out + "/aim.jpg", type: "jpeg", quality: 85 });
  await T.touchEnd(); await sleep(1500); R["拖着瞄左下再松手：打中掉的血"] = 3000 - await ev("__d.hp");
  // 3b 往反方向拖（右上，小兵还在左下）：放了，但打不中
  await sleep(600); await pin(-6, 5); await sleep(300); await drag(q[0], q[1], q[0] + 42, q[1] - 35, 300); await T.touchEnd(); await sleep(1500); R["往反方向拖：放了但没打中"] = (await ev("__play.actor.cdLeft('Q') > 0")) && 3000 - await ev("__d.hp") === 0;
  // 4 拖进取消圈：不放
  await sleep(600); await pin(-6, 5); await sleep(300); const cc = await ev("(() => { const el = document.querySelector('.tc-cancel'); el.hidden = false; const r = el.getBoundingClientRect(); el.hidden = true; return [r.left + r.width / 2, r.top + r.height / 2]; })()");
  await drag(q[0], q[1], cc[0], cc[1], 250, 10); R["拖到取消圈上变红"] = await ev("document.querySelector('.tc-cancel').classList.contains('hot')"); await T.touchEnd(); await sleep(300);
  R["取消后没放"] = await ev("__play.actor.cdLeft('Q') <= 0 && !__play.aiming()"); R["取消圈收起来了"] = await ev("document.querySelector('.tc-cancel').hidden");
  await ev("__d.x = 80; __d.z = 80; 1"); await sleep(100);
  // 5 摇杆：往右推 1.6 秒，英雄往画面右边走；松手停下
  const st = await box(".tc-stick .base"); let p0 = await ev("[__sim.hero.x, __sim.hero.z]"); const s0 = await ev("__screen(__sim.hero.x, __sim.hero.z, 0)");
  await drag(st[0], st[1], st[0] + 60, st[1], 1600); await page.screenshot({ path: out + "/stick.jpg", type: "jpeg", quality: 85 });
  let p1 = await ev("[__sim.hero.x, __sim.hero.z]"); const s1 = await ev(`__screen(${p0[0]} + (${p1[0]} - ${p0[0]}), ${p0[1]} + (${p1[1]} - ${p0[1]}), 0)`);
  R["摇杆往右推，走了几米"] = +Math.hypot(p1[0] - p0[0], p1[1] - p0[1]).toFixed(1); R["走的方向在地面上是 +x（画面右）"] = p1[0] - p0[0] > 2 && Math.abs(p1[1] - p0[1]) < 1.5; R["推着的时候在走"] = await ev("__play.state()") === "move";
  await T.touchEnd(); await sleep(400); R["松手后停下"] = await ev("__play.state()") !== "move";
  // 往上推：往画面上方走（地面上是 -z）
  p0 = await ev("[__sim.hero.x, __sim.hero.z]"); await drag(st[0], st[1], st[0], st[1] - 60, 1200); await T.touchEnd(); p1 = await ev("[__sim.hero.x, __sim.hero.z]"); R["摇杆往上推，z 变小"] = p1[1] - p0[1] < -1.5;
  // 6 点地面：走过去
  p0 = await ev("[__sim.hero.x, __sim.hero.z]"); const g = await ev(`__screen(${p0[0] + 3}, ${p0[1] - 3}, 0)`); await tap(g[0], g[1]); await sleep(1500); p1 = await ev("[__sim.hero.x, __sim.hero.z]"); R["点地面后走了几米"] = +Math.hypot(p1[0] - p0[0], p1[1] - p0[1]).toFixed(1);
  // 7 小地图：点一下镜头跳过去；再推一下摇杆，镜头回到英雄
  const mm = await box(".hud-map"); await tap(mm[0] + mm[2] * 0.3, mm[1] - mm[3] * 0.3); await sleep(500); R["点小地图后不跟英雄"] = await ev("!__play.follow");
  await drag(st[0], st[1], st[0] + 50, st[1], 300); await T.touchEnd(); await sleep(300); R["推摇杆后镜头回到英雄"] = await ev("__play.follow");
  // 8 商店：点金币打开；给钱、回出生点以后买一件
  const gd = await box(".gold"); await tap(gd[0], gd[1]); await sleep(400); R["点金币打开商店"] = await ev("!document.querySelector('.shop').hidden"); await page.screenshot({ path: out + "/shop.jpg", type: "jpeg", quality: 85 });
  await ev("__sim.hero.h.gold = 2000; __play.actor.teleport(__sim.fountain[0][0], __sim.fountain[0][1]); 1"); await sleep(300);
  const it = await box(".shop .it"); await tap(it[0], it[1]); await sleep(300); const buy = await box(".shop .buy"); await tap(buy[0], buy[1]); await sleep(400); R["商店里点购买，买到了"] = await ev("__sim.hero.h.items.length") === 1;
  const x = await box(".shop .x"); await tap(x[0], x[1]); await sleep(300); R["点叉关了商店"] = await ev("document.querySelector('.shop').hidden");
  // 9 计分板和菜单
  const mid = await box(".hud-top .mid"); await tap(mid[0], mid[1]); await sleep(400); R["点比分打开计分板"] = await ev("!document.querySelector('.board').hidden"); await page.screenshot({ path: out + "/board.jpg", type: "jpeg", quality: 85 });
  const bd = await box(".board"); await tap(bd[0], bd[1]); await sleep(300); R["点计分板关掉"] = await ev("document.querySelector('.board').hidden");
  const mb = await box(".hud-me button"); await tap(mb[0], mb[1]); await sleep(400); R["点菜单键打开菜单"] = await ev("!!document.querySelector('.hud-menu')"); await page.screenshot({ path: out + "/menu.jpg", type: "jpeg", quality: 85 });
  await ev("document.querySelector('.hud-menu [data-a=go]').click()"); await sleep(200);
  // 10 回城键
  await ev("__play.actor.teleport(__sim.fountain[0][0] + 30, __sim.fountain[0][1] - 30); __play.actor.stop(); 1"); await sleep(500); const rc = await box(".tc-rc"); await tap(rc[0], rc[1]); await sleep(600); R["点回城开始读条"] = await ev("__play.actor.recalling() > 0 && !document.querySelector('.recall').hidden"); await page.screenshot({ path: out + "/recall.jpg", type: "jpeg", quality: 85 });
  // 11 竖过来：盖提示，对局暂停
  await page.setViewport({ width: H, height: W, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); await sleep(600); const t0 = await ev("__sim.time"); await sleep(1200); const t1 = await ev("__sim.time");
  R["竖屏时盖了提示"] = await ev("getComputedStyle(document.querySelector('.rot')).display !== 'none'"); R["竖屏时对局暂停"] = t1 - t0 < 0.05; await page.screenshot({ path: out + "/portrait.jpg", type: "jpeg", quality: 85 });
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true }); await sleep(600); const t2 = await ev("__sim.time"); await sleep(600); R["横回来接着走"] = (await ev("__sim.time")) - t2 > 0.3;
  R["报错"] = errors;
} catch (e) { R["出错"] = String(e).slice(0, 300); } finally { await browser.close(); }
console.log(JSON.stringify(R, null, 1));
