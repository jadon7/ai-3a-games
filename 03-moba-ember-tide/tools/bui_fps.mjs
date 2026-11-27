// 用法: MOBA_URL=http://localhost:5227/map.html node tools/bui_fps.mjs [desktop|phone] [读几秒=30] [shop]
// 换画风 B（b-ui）：界面换成半透明的蓝玻璃以后（桌面的底栏、弹出的面板用了 backdrop-filter 毛玻璃），量一下玩家视角（不是观战，观战没有底栏）的帧率掉没掉。
// 开一局 h=lan&auto=1（自己的英雄也交给电脑，镜头跟着它走），16 倍速快进到 3 分钟，切回 1 倍速，每秒读一次 __stats.fps。带 shop 就把商店开着量（最大的一块毛玻璃）。
// 无界面 Chrome 锁 60 帧，看的是掉没掉到 60 以下；显卡同时被别的任务用的时候数会抖，改前改后最好挨着跑。
import puppeteer from "puppeteer-core";
const [mode = "desktop", n = "30", shop = ""] = process.argv.slice(2), phone = mode === "phone", W = phone ? 844 : 1920, H = phone ? 390 : 1080;
const base = process.env.MOBA_URL || "http://localhost:5227/map.html", sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 600000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", `--window-size=${W},${H}`] });
const R = { mode, shop: !!shop, fps: [], errors: [] };
try {
  const page = await browser.newPage(); page.on("pageerror", e => R.errors.push(String(e).slice(0, 160)));
  await page.setViewport({ width: W, height: H, deviceScaleFactor: phone ? 3 : 1, isMobile: phone, hasTouch: phone, isLandscape: true });
  if (phone) await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1");
  await page.goto(base + "?h=lan&pos=jungle&seed=4&auto=1" + (phone ? "&touch=1&q=lite" : ""), { waitUntil: "load" }); await page.waitForFunction("window.__ready === true", { timeout: 180000 });
  await sleep(800); await page.evaluate("__setSpeed(16)"); await page.waitForFunction("__sim.time > 180", { timeout: 300000, polling: 250 }); await page.evaluate("__setSpeed(1)"); await sleep(2500);
  if (shop) { await page.evaluate("__shop.open()"); await sleep(600); }
  for (let i = 0; i < +n; i++) { await sleep(1000); R.fps.push(await page.evaluate("Math.round(__stats.fps)")); }
} catch (e) { R.errors.push(String(e).slice(0, 200)); } finally { await browser.close(); }
const f = R.fps.slice().sort((a, b) => a - b), avg = f.reduce((a, b) => a + b, 0) / Math.max(1, f.length);
console.log(JSON.stringify({ ...R, avg: +avg.toFixed(1), p10: f[Math.floor(f.length * 0.1)] ?? null, min: f[0] ?? null }));
