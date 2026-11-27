// 中盘帧率：观战（十个电脑，导播镜头跟着打架的地方）16 倍速跑到对局 10 分钟，切回 1 倍速，每秒读一次 __stats，读 12 次；同时记下画面附近最大的一团人
// fps_fight.mjs 等“两边各 N 个人挤在 13–16 米内”，5v5 观战里这种时刻很少，十几分钟等不到，所以换成固定时刻量
import puppeteer from "/Users/jadon7/Documents/SynologyDrive/code/moba/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 600000, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1920,1080"] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1920, height: 1080 });
  await page.goto(process.env.MOBA_URL + "?director=1&h=lan", { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true", { timeout: 120000 }); await page.evaluate("__setSpeed(16)");
  await page.waitForFunction("__sim.time > 600 || __sim.over", { timeout: 500000, polling: 300 });
  await page.evaluate("__setSpeed(1)"); await new Promise(r => setTimeout(r, 1500));
  const out = [];
  for (let i = 0; i < 12; i++) { await new Promise(r => setTimeout(r, 1000)); out.push(await page.evaluate(`(() => { const hs = __sim.heroes().filter(e => e.alive); let best = 0; for (const a of hs) best = Math.max(best, hs.filter(b => Math.hypot(a.x-b.x, a.z-b.z) < 16).length); return { fps: Math.round(__stats.fps), calls: __stats.calls, t: Math.round(__sim.time), group: best }; })()`)); }
  const f = out.map(o => o.fps); console.log(JSON.stringify({ min: Math.min(...f), avg: Math.round(f.reduce((a, b) => a + b, 0) / f.length), samples: out }));
} finally { await browser.close(); }
