#!/usr/bin/env node
// 技能连放的帧率（第九轮 fx2c）：测试场里把一个英雄的四个技能冷却清零、反复连放（大招、火场叠在一起），每秒读一次 __stats.fps。
// 用法: node fps_skills.mjs <英雄> [读几次=12] [额外网址参数，比如 q=lite&touch=1]
// 量之前别开别的 Chrome。无界面 Chrome 锁 60 帧，电脑档看的是“掉没掉到 60 以下”。
import puppeteer from "puppeteer-core";
const [hero = "gorran", n = "12", extra = ""] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 900000, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1920,1080"] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1920, height: 1080 });
  await page.goto((process.env.MOBA_URL || "http://localhost:5206/map.html") + `?arena=1&h=${hero}&nohud=1${extra ? "&" + extra : ""}`, { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true && window.__arena", { timeout: 120000 });
  await new Promise(r => setTimeout(r, 2500));
  // 每 0.4 秒：冷却清零、回满蓝，按 R E Q W 的顺序放一个能放的（瞄着对面的假人或者小兵堆）
  await page.evaluate(`(()=>{ const a=__actors.get(__sim.hero.id); let i=0; window.__spam=setInterval(()=>{ for (const k of ["Q","W","E","R"]) a.setCd(k,0); __sim.hero.h.mana=__sim.hero.h.stat.mana; __sim.hero.hp=__sim.hero.max;
    const k=["R","E","Q","W"][i++%4], d=a.skill(k), u=__arena.foes[i%__arena.foes.length] ?? __arena.dummy; a.cast(k, {x:u.x, z:u.z}, d.cast==="unit"?u:null); }, 400); return 1; })()`);
  await new Promise(r => setTimeout(r, 2000));
  const out = [];
  for (let i = 0; i < +n; i++) { await new Promise(r => setTimeout(r, 1000)); out.push(await page.evaluate("({ fps: Math.round(__stats.fps), calls: __stats.calls, tris: __stats.tris })")); }
  const f = out.map(o => o.fps); console.log(JSON.stringify({ hero, extra, min: Math.min(...f), avg: Math.round(f.reduce((a, b) => a + b, 0) / f.length), calls: Math.max(...out.map(o => o.calls)), samples: f }));
} finally { await browser.close(); }
