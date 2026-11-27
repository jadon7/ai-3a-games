// 用法: node tools/ui_shots.mjs <输出目录> <宽> <高> [touch] [只截这几个,逗号分开]
// 第九轮界面任务用：把对局以外和对局里的几个界面挨个截下来（主菜单、选人、载入、对局、商店、计分板、菜单、结算），改之前改之后对着看。
// 带 touch 就按手机横屏截（触屏、两倍屏、苹果手机的 UA）。地址由 MOBA_URL 指定。
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const [out, w, h, mode = "", only = ""] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const touch = mode === "touch", base = process.env.MOBA_URL || "http://localhost:5183/map.html", dpr = +(process.env.DPR || (touch ? 2 : 1)), want = new Set(only.split(",").filter(Boolean));
const tq = touch ? "&touch=1" : "";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 300000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", `--window-size=${w},${h}`] });
const errors = [];
const page = await browser.newPage();
await page.setViewport({ width: +w, height: +h, deviceScaleFactor: dpr, isMobile: touch, hasTouch: touch, isLandscape: +w > +h });
if (touch) await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1");
page.on("pageerror", e => errors.push(String(e).slice(0, 200))); page.on("console", m => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
const ev = s => page.evaluate(s), shot = n => page.screenshot({ path: `${out}/${n}.jpg`, type: "jpeg", quality: 88 });
const click = async sel => { const r = await ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`); if (touch) await page.touchscreen.tap(r[0], r[1]); else await page.mouse.click(r[0], r[1]); };
const go = async (q, ready = true) => { await page.goto(base + (q ? "?" + q : ""), { waitUntil: "load" }); if (ready) await page.waitForFunction("window.__ready === true", { timeout: 120000 }); };
const job = n => !want.size || want.has(n);
try {
  if (job("home") || job("pick")) {
    await go(touch ? "touch=1" : ""); await sleep(2500); if (job("home")) await shot("home");
    if (job("pick")) { await click(".lob-home [data-a=play]"); await sleep(900); await click(".lob-pick .card:nth-child(2)"); await sleep(900); await shot("pick");
      if (await ev("!!document.querySelector('.lob-pick [data-a=lock]')")) { await click(".lob-pick [data-a=lock]"); await sleep(320); await shot("pick_lock"); } }
  }
  if (job("load")) { await go("h=vero&lane=bot" + tq, false); await page.waitForSelector(".lob-load", { timeout: 60000 }); await sleep(2600); await shot("load"); }
  if (job("game") || job("shop") || job("board") || job("menu") || job("result")) {
    await go("h=lan" + tq); await sleep(1200);
    await ev("(() => { __sim.gainXp(__sim.hero, 2600); __sim.hero.h.gold = 4000; __shop.buy('blade'); __shop.buy('boots'); __shop.buy('plate'); __sim.hero.h.gold = 1325; const [fx, fz] = __sim.fountain[0]; __play.actor.teleport(fx * 0.8, fz * 0.8); })()"); await sleep(600); await ev("(() => { __sim.hero.hp = __sim.hero.max * 0.72; __sim.hero.h.mana *= 0.6; })()");
    await page.keyboard.press("KeyW"); await sleep(2400);
    if (!touch) { const r = await ev("(() => { const b = document.querySelectorAll('.skills .sk:not(.p)')[2]; const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()"); await page.mouse.move(r[0], r[1]); await sleep(400); }
    if (job("game")) await shot("game");
    if (!touch) await page.mouse.move(+w / 2, +h / 3);
    if (job("shop")) { await ev("__shop.open()"); await sleep(500); await shot("shop"); await ev("__shop.close()"); await sleep(300); }
    if (job("board")) { if (touch) { await click(".hud-top .mid"); await sleep(600); await shot("board"); await click(".board"); } else { await page.keyboard.down("Tab"); await sleep(700); await shot("board"); await page.keyboard.up("Tab"); } await sleep(300); }
    if (job("menu")) { await click(".hud-me button"); await sleep(500); await shot("menu"); await ev("document.querySelector('.hud-menu [data-a=go]').click()"); await sleep(300); }
    if (job("result")) { for (let i = 0; i < 4; i++) { await ev("(() => { for (const e of __sim.ents) if (e.team === 1 && e.alive && (e.kind === 'tower' || e.kind === 'core')) __sim.damage(e, 1e6, null); })()"); await sleep(200); } await sleep(+(process.env.END_WAIT || 6500)); await shot("result"); }
  }
} catch (e) { console.log("出错", String(e).slice(0, 300)); } finally { await browser.close(); }
console.log(JSON.stringify({ out, errors: errors.slice(0, 8) }));
