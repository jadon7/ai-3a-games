#!/usr/bin/env node
// 团战帧率，不锁 60 帧（换画风 B · b-fx）：polish_fps.mjs 的摆法（十个英雄挪到河道挤成一团、全是电脑、冷却清零、九级、镜头固定在那一团上）
// 加 fps_uncap.mjs 的做法（无界面 Chrome 关掉垂直同步，读出来的是真能跑多少帧）。改前、改后两个页面轮流开、各量几轮，抵掉别的任务抢显卡的波动，看中位数。
// 用法: node tools/bfx_fps.mjs <每轮读几秒> "<名字>|<map.html 的完整地址，不带参数>[|只给这一页加的参数，比如 fxb=0]" … [环境变量 ROUNDS=3 轮数，EXTRA=再加的网址参数，比如 q=lite&touch=1]
import puppeteer from "puppeteer-core";
const [secs = "8", ...pages] = process.argv.slice(2), ROUNDS = +(process.env.ROUNDS || 3), EXTRA = process.env.EXTRA || "";
const res = Object.fromEntries(pages.map(p => [p.split("|")[0], []])), low = Object.fromEntries(pages.map(p => [p.split("|")[0], []]));
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 300000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1920,1080", "--disable-frame-rate-limit", "--disable-gpu-vsync"] });
const errors = [];
try {
  for (let r = 0; r < ROUNDS; r++) for (const p of pages) {
    const [name, base, more = ""] = p.split("|"), page = await browser.newPage();      /* 第三段：只给这一页加的网址参数（比如 fxb=0） */ await page.setViewport({ width: 1920, height: 1080 });
    page.on("pageerror", e => errors.push(name + " " + String(e).slice(0, 200)));
    await page.goto(base + "?h=lan&auto=1&a=torg,lan,ugo,seren,moko&b=gorran,kaz,osen,vero,hedda&cam=-2,0,27,56,0,0&seed=7" + (EXTRA ? "&" + EXTRA : "") + (more ? "&" + more : ""), { waitUntil: "load", timeout: 90000 });
    await page.waitForFunction("window.__ready === true", { timeout: 120000 });
    await page.evaluate(`(()=>{ const W=(u,v)=>[(u+v)/Math.SQRT2,(v-u)/Math.SQRT2]; const hs=[...__actors.values()].sort((p,q)=>p.ent.team-q.ent.team||(p.kit.id<q.kit.id?-1:1)); const [cx,cz]=W(-2,0);
      hs.forEach((a,i)=>{ const ang=i*2.39996, r=0.8+Math.sqrt(i)*1.4; const [x,z]=__nav.nearest(cx+Math.cos(ang)*r, cz+Math.sin(ang)*r); a.teleport(x,z); });
      for (const a of hs) { a.ent.h.level = 9; for (const k of ["Q","W","E","R"]) a.setCd(k, 0); } return 1; })()`);
    await new Promise(r => setTimeout(r, 3000));
    const xs = []; for (let i = 0; i < +secs; i++) { await new Promise(r => setTimeout(r, 1000)); xs.push(await page.evaluate("__stats.fps")); }
    xs.sort((a, b) => a - b); res[name].push(Math.round(xs[xs.length >> 1])); low[name].push(Math.round(xs[0])); await page.close();
  }
} finally { await browser.close(); }
for (const [k, v] of Object.entries(res)) { const s = [...v].sort((a, b) => a - b); console.log(`${k}\t每轮中位数 ${v.join(" / ")}\t每轮最低 ${low[k].join(" / ")}\t总中位数 ${s[s.length >> 1]}`); }
if (errors.length) console.log("报错", JSON.stringify(errors.slice(0, 6)));
