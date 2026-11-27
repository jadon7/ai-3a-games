#!/usr/bin/env node
// 5v5 全电脑对战的战况统计（第九轮 match5）：开一局（自己的英雄也交给电脑），16 倍速跑到分出胜负，一路记下：
//   · 每 5 秒（对局时间）每个英雄在哪一块：上路、中路、下路、野区、自己家（出生点附近），1:30 到 10:00 之间各占几成——看五个位置是不是各干各的；
//   · 10 分钟时每个人的等级、身家（金币加装备）、补刀、清了几个野怪营地；打野抓了几次；
//   · 每 5 分钟一行 __report()；结束时的时长、比分、谁赢、报错。
// 用法: MOBA_URL=http://localhost:5207/map.html node tools/match5_stats.mjs <输出.json> "<网址参数>" [速度=16]
//   例: node tools/match5_stats.mjs /tmp/m1.json "h=lan&seed=3"
// 同一时间只跑一个无界面 Chrome。
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const [out, q = "h=lan", sp = "16"] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 1800000, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1280,720"] });
const R = { q, samples: 0, region: {}, at10: null, reports: [], errors: [] };
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 720 });
  page.on("pageerror", e => R.errors.push(String(e).slice(0, 240))); page.on("console", m => { if (m.type() === "error") R.errors.push(m.text().slice(0, 200)); });
  await page.goto((process.env.MOBA_URL || "http://localhost:5207/map.html") + "?" + q + "&auto=1&nofog=1&nohud=1", { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true && window.__sim", { timeout: 180000 });
  // 页面里的小工具：一个英雄现在在哪一块
  await page.evaluate(`window.__where = e => { const f = __sim.fountain[e.team]; if (Math.hypot(e.x - f[0], e.z - f[1]) < 24) return "家"; let bl = -1, bd = 9; for (const l of [0, 1, 2]) { const [, d] = __sim.onLane(l, 0, e.x, e.z); if (d < bd) { bd = d; bl = l; } } return bl < 0 ? "野区" : ["中路", "上路", "下路"][bl]; }`);
  await page.evaluate(`__setSpeed(${+sp})`);
  let nextS = 0, nextR = 300; const t0 = Date.now();
  for (;;) {
    await new Promise(r => setTimeout(r, 200));
    const s = await page.evaluate(`({ t: __sim.time, over: __sim.over })`);
    if (s.t >= nextS) { nextS = s.t + 5;
      const hs = await page.evaluate(`__sim.heroes().filter(e => e.h).map(e => ({ k: (e.team ? "红·" : "绿·") + e.h.pos + "·" + e.h.kit, alive: e.alive, w: e.alive ? __where(e) : "阵亡" }))`);
      if (s.t >= 90 && s.t <= 600) { R.samples++; for (const h of hs) { const m = (R.region[h.k] ??= {}); m[h.w] = (m[h.w] ?? 0) + 1; } } }
    if (!R.at10 && s.t >= 600) R.at10 = await page.evaluate(`__sim.heroes().filter(e => e.h).sort((p, q) => p.team - q.team).map(e => { const h = e.h; return { team: e.team, pos: h.pos, kit: h.kit, level: h.level, gold: Math.round(h.gold), worth: Math.round(h.gold + h.items.reduce((a, id) => a + __itemCost(id), 0)), items: h.items.slice(), cs: h.cs, camps: h.camps, kda: [h.kills, h.deaths, h.assists] }; })`);      // 身家：金币加身上装备的价钱（价钱从页面里的商店数据拿，items.ts 别的任务在改）
    if (s.t >= nextR || s.over) { nextR += 300; R.reports.push(await page.evaluate("__report()")); }
    if (s.over || s.t > 2400 || Date.now() - t0 > 1500000) break;
  }
  const end = await page.evaluate(`({ t: Math.round(__sim.time), over: __sim.over, kills: __sim.kills, towers: [__sim.towersLeft(0), __sim.towersLeft(1)], ganks: __bots.filter(b => b.pos() === "jungle").map(b => ({ team: b.ent.team, kit: b.ent.h.kit, ganks: b.ganks(), camps: b.ent.h.camps })) })`);
  R.end = end;
} finally { await browser.close(); }
// 位置统计换成百分比
for (const k of Object.keys(R.region)) { const m = R.region[k], n = Object.values(m).reduce((a, b) => a + b, 0); for (const w of Object.keys(m)) m[w] = Math.round((m[w] / n) * 100); }
fs.writeFileSync(out, JSON.stringify(R, null, 1));
console.log(JSON.stringify({ q, end: R.end, at10: R.at10?.map(h => `${h.team ? "红" : "绿"} ${h.pos} ${h.kit} L${h.level} 身家${h.worth ?? h.gold} 刀${h.cs} 营${h.camps}`), region: R.region, errors: R.errors.slice(0, 5) }, null, 1));
