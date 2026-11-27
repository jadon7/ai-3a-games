#!/usr/bin/env node
// 伊缇特效在真实 5v5 团战里的帧率（iti-fx3 第二步）：正常对局开局，十个英雄升到 12 级摆到中路打团，伊缇循环放一套 E→Q→Q→Q→R（冷却每轮清零、全员回满血），
// 每一帧记用了多少毫秒。先量几秒“只是团战、伊缇不放技能”当底数，再量“伊缇循环放”。无界面 Chrome 不锁帧，数字只能当相对参考（看每帧多花了几毫秒）。
// 绘制次数要加 nohud=1 才准（带界面时最后一遍画的是头像，读到的是头像那一遍的次数）。
// 用法: MOBA_URL=http://localhost:5254/map.html node tools/iti_fx_fps.mjs "<网址参数，比如 h=iti&seed=3 或再加 &q=lite>" [底数秒=6] [放技能秒=16]
import puppeteer from "puppeteer-core";
const [query = "h=iti&seed=3", baseSec = "6", runSec = "16"] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 900000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-gpu-vsync", "--disable-frame-rate-limit", "--hide-scrollbars", "--mute-audio", "--window-size=1600,900"] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
  const errors = []; page.on("pageerror", e => errors.push(String(e).slice(0, 300)));
  await page.goto(`${process.env.MOBA_URL || "http://localhost:5254/map.html"}?${query}&adapt=0`, { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true && window.__sim && window.__actors", { timeout: 180000 });
  await new Promise(r => setTimeout(r, 2500));
  await page.evaluate(`(()=>{ const sim=__sim, me=sim.hero; window.__me=__actors.get(me.id);
    window.__stage=()=>{ const H=sim.heroes(), foes=H.filter(e=>e.team!==me.team), pals=H.filter(e=>e.team===me.team&&e!==me);
      for (const e of H) { if (!e.alive) continue; e.h.level=12; sim.recalc(e); e.hp=e.max; e.h.mana=e.h.stat.mana; }
      const put=(e,x,z)=>{ if (!e.alive) return; const p=__nav.walkable(x,z)?[x,z]:__nav.nearest(x,z); __actors.get(e.id).teleport(p[0],p[1]); };
      foes.forEach((e,i)=>{ const an=i*1.2566+0.4; put(e, 3.5+Math.cos(an)*4.2, 3.5+Math.sin(an)*4.2); }); pals.forEach((e,i)=>put(e, -6.5-(i%2)*2.2, -9.5+i*2.4)); put(me,-5.5,-5.5);
      window.__foes=foes; };
    window.__near=()=>{ const l=__foes.filter(e=>e.alive).sort((a,b)=>Math.hypot(a.x-me.x,a.z-me.z)-Math.hypot(b.x-me.x,b.z-me.z)); return l[0]||{x:me.x+3,z:me.z+3}; };
    window.__mid=()=>{ const l=__foes.filter(e=>e.alive&&Math.hypot(e.x-me.x,e.z-me.z)<16), n=Math.max(1,l.length); return l.length?{ x:l.reduce((s,e)=>s+e.x,0)/n, z:l.reduce((s,e)=>s+e.z,0)/n }:{x:me.x+3,z:me.z+3}; };
    window.__combo=()=>{ __me.data.iti=undefined; for (const k of ["Q","W","E","R"]) __me.setCd(k,0); me.hp=me.max; me.h.mana=me.h.stat.mana; const list=[["E",__near],["Q",__near],["Q",__near],["Q",__mid],["R",__mid]]; let i=0;
      __api.run(12,()=>{ if(i>=list.length||!me.alive)return; const [k,f]=list[i]; if(__me.canCast(k)){ const t=f(); __me.cast(k,{x:t.x,z:t.z},__me.skill(k).target?t:null); i++; } }); };
    __stage(); return 1; })()`);
  // 每一帧都记：这一帧用了多少毫秒、屏幕演出开着哪几样、绘制次数、伊缇特效自己的绘制次数和在场的粒子（线、星芒、环都算）
  await page.evaluate(`(()=>{ window.__rec=[]; window.__phase="base"; let last=performance.now(); const loop=()=>{ const now=performance.now(), k=__fx.group.children.find(c=>c.userData.itiStats), ks=k?k.userData.itiStats():null;
    __rec.push([__phase, now-last, __fx.screen?__fx.screen.stats().on:"", __stats.calls, ks?ks.draws:0, ks?ks.particles+ks.stars+ks.lines+ks.rings:0]); last=now; requestAnimationFrame(loop); }; requestAnimationFrame(loop); return 1; })()`);
  const wait = sec => new Promise(r => setTimeout(r, sec * 1000));
  const keep = setInterval(() => page.evaluate("__stage()").catch(() => {}), 3000);      // 每 3 秒把人摆回去、回满血：团战一直打着
  await wait(+baseSec); clearInterval(keep);      // 伊缇开始放以后不再定时摆人（会把正在冲的她拽回去），改成每套连招开始前摆一次
  // 页面里自己盯着：伊缇一直回满血（不然五个人集火，她半路就死了、连招断掉）；一套放完（大招放了、人现身了、压暗收了）就把人摆回去再来一套，卡住超过 15 秒也重来。
  // 放够 runSec 秒、并且至少放完两个大招才停（机器被别的任务抢显卡时对局走得慢，最多等四倍时间）
  await page.evaluate(`(()=>{ window.__phase="run"; window.__ults=0; const me=__sim.hero; let busy=false, t0=0;
    window.__drv=setInterval(()=>{ if (me.alive) me.hp=me.max; const d=__me.data.iti, now=performance.now();
      if (busy && __me.cdLeft("R")>1 && !(d&&d.r) && !/dim/.test(__fx.screen.stats().on)) { window.__ults++; busy=false; }
      if (busy && now-t0>15000) busy=false;
      if (!busy && me.alive) { __stage(); __combo(); busy=true; t0=now; } }, 100); return 1; })()`);
  const t0 = Date.now(); while (Date.now() - t0 < +runSec * 1000 || ((await page.evaluate("__ults")) < 2 && Date.now() - t0 < +runSec * 4000)) await wait(0.5);
  await page.evaluate("clearInterval(__drv); 1");
  const rec = await page.evaluate("__rec");
  const sum = (name, rows) => { if (!rows.length) return { name, 帧数: 0 }; const ms = rows.map(r => r[1]).sort((a, b) => a - b), tot = ms.reduce((a, b) => a + b, 0), q = p => ms[Math.min(ms.length - 1, Math.floor(ms.length * p))];
    return { name, 帧数: rows.length, 中位每帧毫秒: +q(0.5).toFixed(2), 九成的帧不超过_毫秒: +q(0.9).toFixed(2), 平均每帧毫秒: +(tot / rows.length).toFixed(2), 最慢一帧_毫秒: +ms[ms.length - 1].toFixed(1), 超过33毫秒的帧: ms.filter(v => v > 33.4).length,
      绘制次数_最高: Math.max(...rows.map(r => r[3])), 伊缇特效绘制_最高: Math.max(...rows.map(r => r[4])), 伊缇粒子线星环_最高: Math.max(...rows.map(r => r[5])) }; };
  const base = rec.filter(r => r[0] === "base"), run = rec.filter(r => r[0] === "run");
  console.log(JSON.stringify(sum("团战，伊缇不放技能", base)));
  console.log(JSON.stringify(sum("团战，伊缇循环放连招加大招（整段）", run)));
  console.log(JSON.stringify(sum("　其中屏幕压暗着的帧（大招、重击）", run.filter(r => / ?dim/.test(r[2])))));
  console.log(JSON.stringify(sum("　其中十字新月那一下（径向模糊、集中线开着）", run.filter(r => /radial/.test(r[2]) && /lines/.test(r[2])))));
  console.log(JSON.stringify({ query, 放完的大招: await page.evaluate("__ults"), 屏幕演出用到: [...new Set(run.flatMap(r => r[2].split(" ").filter(Boolean)))].join(" "), errors: errors.slice(0, 5) }));
} finally { await browser.close(); }
