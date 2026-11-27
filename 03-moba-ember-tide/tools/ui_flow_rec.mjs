// 用法: node tools/ui_flow_rec.mjs <输出.webm> <宽> <高> [touch]
// 第九轮界面任务用：从主菜单 → 选人 → 锁定 → 载入 → 对局（开商店、看计分板）→ 结算，整条走一遍录下来。地址由 MOBA_URL 指定。
// 无界面录屏帧率不稳（二十帧上下），按真实时间录，不拉时间轴。
import puppeteer from "puppeteer-core";
const [out, w, h, mode = ""] = process.argv.slice(2), touch = mode === "touch", base = process.env.MOBA_URL || "http://localhost:5183/map.html";
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 300000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", `--window-size=${w},${h}`] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  const page = await browser.newPage(); await page.setViewport({ width: +w, height: +h, deviceScaleFactor: 1, isMobile: touch, hasTouch: touch, isLandscape: true });
  if (touch) await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1");
  const ev = s => page.evaluate(s);
  const at = async sel => ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  const tap = async sel => { const [x, y] = await at(sel); if (touch) await page.touchscreen.tap(x, y); else { await page.mouse.move(x, y, { steps: 8 }); await sleep(250); await page.mouse.click(x, y); } };
  await page.goto(base + (touch ? "?touch=1" : ""), { waitUntil: "load" }); await page.waitForFunction("window.__ready === true", { timeout: 120000 }); await sleep(800);
  const rec = await page.screencast({ path: out });
  await sleep(2600); await tap(".lob-home [data-a=play]"); await sleep(1600);
  for (const n of [1, 5, 4]) { await tap(`.lob-pick .card:nth-child(${n})`); await sleep(1100); }
  if (!touch) { const s = await ev("[...document.querySelectorAll('.pk-sk .s')].map(b => { const r = b.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })"); for (const [x, y] of s) { await page.mouse.move(x, y, { steps: 6 }); await sleep(450); } }
  await tap(".lob-pick [data-a=lock]");
  await page.waitForFunction("!!document.querySelector('.lob-load')", { timeout: 60000 }); await page.waitForFunction("window.__ready === true && !document.querySelector('.lob-load')", { timeout: 120000 }); await sleep(2500);
  await ev("(() => { __sim.gainXp(__sim.hero, 1500); __sim.hero.h.gold = 1600; })()"); await sleep(1200);
  await tap(".hud [data-k=goldbox]"); await sleep(900); await tap(".shop .it[data-id=boots]"); await sleep(700); await tap(".shop .buy"); await sleep(900); await tap(".shop .x"); await sleep(800);
  if (touch) { await tap(".hud-top .mid"); await sleep(1800); await tap(".board"); } else { await page.keyboard.down("Tab"); await sleep(1800); await page.keyboard.up("Tab"); }
  await sleep(800);
  for (let i = 0; i < 4; i++) { await ev("(() => { for (const e of __sim.ents) if (e.team === 1 && e.alive && (e.kind === 'tower' || e.kind === 'core')) __sim.damage(e, 1e6, null); })()"); await sleep(150); }
  await sleep(7000); await rec.stop(); console.log("好了", out);
} catch (e) { console.log("出错", String(e).slice(0, 300)); } finally { await browser.close(); }
