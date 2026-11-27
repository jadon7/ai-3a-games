#!/usr/bin/env node
// 团战帧率（第九轮 polish-lib）：tools/fps_fight.mjs 要 16 倍速等到一场自然打起来的团战，碰上电脑不打可以等满 15 分钟。
// 这里直接把十个英雄挪到河道中间挤成一团（固定阵容、固定站位），1 倍速让他们打，镜头固定在那一团上，每秒读一次 __stats.fps，读 n 次。
// 迷雾是开着的（不是观战），所以“迷雾里藏特效”的着色器也算在里面。同一时间只开这一个无界面 Chrome。
// 用法: MOBA_URL=... node tools/polish_fps.mjs [读几次=12] [额外网址参数]
import puppeteer from "puppeteer-core";
const [n = "12", extra = ""] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 300000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1920,1080"] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1920, height: 1080 });
  const errors = []; page.on("pageerror", e => errors.push(String(e).slice(0, 200))); page.on("console", m => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
  await page.goto((process.env.MOBA_URL || "http://localhost:5216/map.html") + "?h=lan&auto=1&a=torg,lan,ugo,seren,moko&b=gorran,kaz,osen,vero,hedda&cam=-2,0,27,56,0,0" + (extra ? "&" + extra : ""), { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true", { timeout: 120000 });
  await page.evaluate(`(()=>{ const W=(u,v)=>[(u+v)/Math.SQRT2,(v-u)/Math.SQRT2]; const hs=[...__actors.values()].sort((p,q)=>p.ent.team-q.ent.team||(p.kit.id<q.kit.id?-1:1)); const [cx,cz]=W(-2,0);
    hs.forEach((a,i)=>{ const ang=i*2.39996, r=0.8+Math.sqrt(i)*1.4; const [x,z]=__nav.nearest(cx+Math.cos(ang)*r, cz+Math.sin(ang)*r); a.teleport(x,z); });
    for (const a of hs) { a.ent.h.level = 9; for (const k of ["Q","W","E","R"]) a.setCd(k, 0); } return 1; })()`);
  await new Promise(r => setTimeout(r, 2500));
  const out = [];
  for (let i = 0; i < +n; i++) { await new Promise(r => setTimeout(r, 1000)); out.push(await page.evaluate("({ fps: Math.round(__stats.fps), calls: __stats.calls, t: Math.round(__sim.time), alive: __sim.heroes().filter(e=>e.alive).length })")); }
  const f = out.map(o => o.fps); console.log(JSON.stringify({ min: Math.min(...f), avg: Math.round(f.reduce((a, b) => a + b, 0) / f.length), samples: out, errors: errors.slice(0, 5) }));
} finally { await browser.close(); }
