// 用法: MOBA_URL=http://localhost:5207/map.html node tools/match5_shots.mjs <输出目录> <宽> <高> [touch] [只截这几个,逗号分开]
// 第九轮 match5（5v5）：主菜单、选位置、选英雄、锁定（对面翻出来）、载入、对局（顶栏十个头像、小地图上十个人）、计分板、结算，挨个截下来。
// 带 touch 就按手机横屏截（触屏、两倍屏、苹果手机的 UA）。对局那几张是真的开一局、快进到三分钟（大家都在线上、野区里）再截。
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const [out, w, h, mode = "", only = ""] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const touch = mode === "touch", base = process.env.MOBA_URL || "http://localhost:5207/map.html", dpr = +(process.env.DPR || (touch ? 2 : 1)), want = new Set(only.split(",").filter(Boolean));
const tq = touch ? "&touch=1" : "";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 600000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", `--window-size=${w},${h}`] });
const errors = [];
const page = await browser.newPage();
await page.setViewport({ width: +w, height: +h, deviceScaleFactor: dpr, isMobile: touch, hasTouch: touch, isLandscape: +w > +h });
if (touch) await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1");
page.on("pageerror", e => errors.push(String(e).slice(0, 200))); page.on("console", m => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
const ev = s => page.evaluate(s), shot = n => page.screenshot({ path: `${out}/${n}.jpg`, type: "jpeg", quality: 90 });
const click = async sel => { const r = await ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`); if (touch) await page.touchscreen.tap(r[0], r[1]); else await page.mouse.click(r[0], r[1]); };
const go = async (q, ready = true) => { await page.goto(base + (q ? "?" + q : ""), { waitUntil: "load" }); if (ready) await page.waitForFunction("window.__ready === true", { timeout: 120000 }); };
const job = n => !want.size || want.has(n);
const R = {};
try {
  if (job("home") || job("pick")) {
    await go(touch ? "touch=1" : ""); await sleep(2500); if (job("home")) await shot("home");
    if (job("pick")) {
      await click(".lob-home [data-a=play]"); await sleep(1000); await shot("pick_pos");                         // 第一步：选位置
      await click('.pk-pos [data-p="jungle"]'); await sleep(1000); await shot("pick_hero");                       // 第二步：打野，英雄卡里打野的排前面
      R.lineup = await ev("__pick.lineup()");
      await click('.pk-go [data-v="mid"]'); await sleep(900); await shot("pick_mid");                             // 换成中单：自动换成中单的英雄，队友跟着补
      await click('.lob-pick .card[data-id="lan"]'); await sleep(900); await shot("pick_off");                    // 中单选岚（不是主位置也能选）
      await click(".lob-pick [data-a=lock]"); await sleep(700); await shot("pick_lock");                         // 锁定：对面五个翻出来
      await page.waitForSelector(".lob-load", { timeout: 20000 }).catch(() => {}); await sleep(1600); await shot("load_from_pick");
      R.url = page.url();
    }
  }
  if (job("load")) { await go("h=vero&pos=adc&seed=4" + tq, false); await page.waitForSelector(".lob-load", { timeout: 60000 }); await sleep(2600); await shot("load"); }
  if (job("game") || job("board") || job("result")) {
    await go("h=lan&pos=jungle&seed=4&auto=1" + tq); await sleep(800); await ev("__setSpeed(16)");      // auto=1：自己的英雄也交给电脑打，镜头跟着它进野区
    await page.waitForFunction("__sim.time > 185", { timeout: 300000, polling: 200 }); await ev("__setSpeed(1)"); await sleep(1500);      // 三分钟：大家都到了线上、打野在刷野
    if (job("game")) { await shot("game"); const mm = await ev(`(() => { const r = document.querySelector(".hud-map").getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; })()`); await page.screenshot({ path: `${out}/minimap.jpg`, type: "jpeg", quality: 92, clip: mm });
      const tb = await ev(`(() => { const r = document.querySelector(".hud-top").getBoundingClientRect(); return { x: Math.max(0, r.left - 6), y: 0, width: r.width + 12, height: r.height + 8 }; })()`); await page.screenshot({ path: `${out}/topbar.jpg`, type: "jpeg", quality: 92, clip: tb });
      R.top = await ev(`[...document.querySelectorAll(".hud-top .squad")].map(s => s.children.length)`); R.where = await ev(`__sim.heroes().map(e => (e.team ? "红" : "绿") + e.h.pos + "·" + e.h.kit + "@" + Math.round(e.x) + "," + Math.round(e.z))`); }
    if (job("board")) { if (touch) { await click(".hud-top .mid"); await sleep(700); await shot("board"); await click(".board"); } else { await page.keyboard.down("Tab"); await sleep(800); await shot("board"); await page.keyboard.up("Tab"); } await sleep(300);
      R.board = await ev(`(() => { const b = document.querySelector(".board"); b.hidden = false; const r = b.getBoundingClientRect(), rows = b.querySelectorAll("tbody tr:not(.tm)").length; b.hidden = true; return { rows, top: Math.round(r.top), bottom: Math.round(r.bottom), scroll: b.scrollHeight > b.clientHeight + 2 }; })()`); }
    if (job("result")) { await ev("__setSpeed(16)"); await page.waitForFunction("__sim.time > 330", { timeout: 300000, polling: 200 }); await ev("__setSpeed(1)");
      for (let i = 0; i < 4; i++) { await ev("(() => { for (const e of __sim.ents) if (e.team === 1 && e.alive && (e.kind === 'tower' || e.kind === 'core')) __sim.damage(e, 1e6, null); })()"); await sleep(200); }
      await sleep(+(process.env.END_WAIT || 7000)); await shot("result"); R.result = await ev(`document.querySelectorAll(".hud-end .ed-row").length`); }
  }
} catch (e) { console.log("出错", String(e).slice(0, 300)); } finally { await browser.close(); }
console.log(JSON.stringify({ ...R, errors: errors.slice(0, 8) }, null, 1));
