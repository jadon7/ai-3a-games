#!/usr/bin/env node
// 第九轮 balance：连着跑几局 5v5 全电脑对战（16 倍速跑到分出胜负），每局记下 match_batch.sh 没有的东西，给平衡用：
//   · 每个英雄 10 分钟时和结束时的等级、金币、身家（金币加装备）、补刀、营地、击杀/死亡/助攻、对英雄伤害（普攻和技能分开）、每个技能放了几次；
//   · 击杀的时间线（谁、几分几秒、哪一队）；每 6 分钟一行 __report()（和 match_batch 的 txt 一样能读）。
// 每局写 <输出目录>/<名字>.json 和 <名字>.txt；汇总用 tools/balance_table.py。
// 用法: MOBA_URL=http://localhost:5219/map.html node tools/balance_match.mjs <输出目录> "<名字>:<网址参数>" ["<名字>:<网址参数>" …]
//   例: node tools/balance_match.mjs /tmp/b g1:"h=torg&a=torg,lan,ugo,seren,moko&b=gorran,kaz,osen,vero,hedda"
// 一局一个无界面 Chrome，按顺序跑（同一时间只开一个）。着色器报错、Chrome 断开（显卡被别的任务抢）的那一局自动重跑一次。
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const [out, ...runs] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const URL0 = process.env.MOBA_URL || "http://localhost:5219/map.html", SPEED = +(process.env.SPEED || 16);
// 页面里的钩子：sim.events 每帧被画面那边清空（length = 0，同一个数组），所以把它的 push 包一层，事件进来的时候就记下
const HOOK = `(() => { const B = window.__bal = { casts: {}, dmg: {}, kills: [], mon: {} };
  const ev = __sim.events, push0 = ev.push;
  ev.push = function (...xs) { for (const x of xs) {
      if (x.t === "cast" && x.e.h) { const c = (B.casts[x.e.id] ??= {}); c[x.key] = (c[x.key] ?? 0) + 1; }
      else if (x.t === "hit" && x.dmg > 0 && x.e.h && x.src && x.src.h && x.src.team !== x.e.team) { const d = (B.dmg[x.src.id] ??= { basic: 0, skill: 0 }); d[x.skill ? "skill" : "basic"] += x.dmg; }
      else if (x.t === "die" && x.e.kind === "monster" && x.by && x.by.h) B.mon[x.by.id] = (B.mon[x.by.id] ?? 0) + 1;      // 补刀数里野怪占几个（h.cs 两样都算）
      else if (x.t === "kill" && x.e.h) B.kills.push({ t: Math.round(__sim.time), team: 1 - x.e.team, victim: x.e.h.kit, by: x.by && x.by.h ? x.by.h.kit : "", n: x.assists.length });
    } return push0.apply(this, xs); };
  return true; })()`;
const SNAP = `__sim.heroes().filter(e => e.h).sort((p, q) => p.team - q.team).map(e => { const h = e.h, B = window.__bal; return { id: e.id, team: e.team, pos: h.pos, kit: h.kit, level: h.level, gold: Math.round(h.gold),
  worth: Math.round(h.gold + h.items.reduce((s, id) => s + __itemCost(id), 0)), items: h.items.slice(), cs: h.cs, mon: B.mon[e.id] ?? 0, quest: h.quest ? h.quest.got : 0, camps: h.camps, k: h.kills, d: h.deaths, a: h.assists, dmg: Math.round(h.dmg),
  basic: Math.round(B.dmg[e.id]?.basic ?? 0), skill: Math.round(B.dmg[e.id]?.skill ?? 0), casts: B.casts[e.id] ?? {}, range: +h.stat.range.toFixed(2), ad: h.stat.ad, ap: h.stat.ap, hp: e.max }; })`;
const fmt = (d) => `${Math.floor(d.t / 60)}:${String(d.t % 60).padStart(2, "0")}`;
async function one(name, q) {
  const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 1800000,
    args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1280,720"] });
  const R = { name, q, reports: [], at10: null, end: null, kills: [], errors: [], wall: 0 }; const t0 = Date.now();
  try {
    const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 720 });
    page.on("pageerror", e => R.errors.push(String(e).slice(0, 240))); page.on("console", m => { if (m.type() === "error") R.errors.push(m.text().slice(0, 240)); });
    await page.goto(URL0 + "?" + q + "&auto=1&nofog=1&nohud=1", { waitUntil: "load" });
    await page.waitForFunction("window.__ready === true && window.__sim && window.__report", { timeout: 180000 });
    await page.evaluate(HOOK); await page.evaluate(`__setSpeed(${SPEED})`);
    let nextR = 360;
    for (;;) {
      await new Promise(r => setTimeout(r, 250));
      const s = await page.evaluate(`({ t: __sim.time, over: __sim.over })`);
      if (!R.at10 && s.t >= 600) R.at10 = await page.evaluate(SNAP);
      if (s.t >= nextR) { nextR += 360; R.reports.push(await page.evaluate("__report()")); }
      if (s.over || s.t > 2400 || Date.now() - t0 > 1500000) break;
    }
    R.reports.push(await page.evaluate("__report()"));
    R.end = await page.evaluate(`({ t: Math.round(__sim.time), over: __sim.over, kills: __sim.kills, towers: [__sim.towersLeft(0), __sim.towersLeft(1)], heroes: ${SNAP}, ganks: __bots.filter(b => b.pos() === "jungle").map(b => ({ team: b.ent.team, kit: b.ent.h.kit, ganks: b.ganks() })) })`);
    R.kills = await page.evaluate("window.__bal.kills");
  } catch (e) { R.errors.push("脚本: " + String(e).slice(0, 240)); }
  finally { R.wall = Math.round((Date.now() - t0) / 1000); await browser.close().catch(() => {}); }
  return R;
}
for (const run of runs) {
  const i = run.indexOf(":"), name = run.slice(0, i), q = run.slice(i + 1);
  let R = await one(name, q);
  if (!R.end || R.errors.some(e => /Shader Error|VALIDATE_STATUS|detached Frame|Target closed|Protocol error/.test(e))) { console.error(`${name}: 重跑（${R.errors[0] ?? "没跑完"}）`); R = await one(name, q); R.retried = true; }
  fs.writeFileSync(`${out}/${name}.json`, JSON.stringify(R, null, 1));
  // 和 match_batch 的 txt 一样的样子，方便对着看
  const lines = [];
  for (const d of R.reports) { lines.push(`时间 ${fmt(d)}  结果 ${d.over}  击杀 ${JSON.stringify(d.kills)}  塔 ${JSON.stringify(d.towers)}（中上下 ${d.lanes}）  安排 ${JSON.stringify(d.order)}  营地 ${d.camps}  Boss ${JSON.stringify(d.boss)}  队伍增益 ${JSON.stringify(d.buff)}`); for (const h of d.heroes) lines.push("    " + h); }
  lines.push(JSON.stringify({ errors: R.errors.slice(0, 8), wall: R.wall, retried: !!R.retried }));
  fs.writeFileSync(`${out}/${name}.txt`, lines.join("\n") + "\n");
  const e = R.end; console.log(`== ${name}  ${e ? `${fmt(e)}  ${e.over === 1 ? "0 队（左下）赢" : e.over === -1 ? "1 队（右上）赢" : "没分出胜负"}  击杀 ${e.kills.join(":")}  塔 ${e.towers.join(":")}` : "没跑完"}  报错 ${R.errors.length}  用时 ${R.wall} 秒`);
}
