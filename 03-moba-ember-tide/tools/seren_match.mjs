#!/usr/bin/env node
// 全电脑 5v5 的战况（第九轮 k-seren，看新英雄的数值在不在一个档次）：开一局（自己的英雄也交给电脑），16 倍速跑到分出胜负，
// 结束时记下每个英雄的 击杀/死亡/助攻、补刀、对英雄造成的伤害、等级、身家，以及每个技能放了几次（每隔一会儿看一次冷却：冷却从小跳到大就是放了一次）。
// 用法: MOBA_URL=http://localhost:5214/map.html node tools/seren_match.mjs <输出.json> "<网址参数>" [速度=16]
//   例: node tools/seren_match.mjs /tmp/m.json "h=seren&a=torg,lan,osen,seren,moko&b=gorran,lan,osen,vero,moko"
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const [out, q = "h=seren", sp = "16"] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 1800000, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1280,720"] });
const R = { q, errors: [] };
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 720 });
  page.on("pageerror", e => R.errors.push(String(e).slice(0, 240))); page.on("console", m => { if (m.type() === "error") R.errors.push(m.text().slice(0, 200)); });
  await page.goto((process.env.MOBA_URL || "http://localhost:5214/map.html") + "?" + q + "&auto=1&nofog=1&nohud=1", { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true && window.__sim", { timeout: 180000 });
  await page.evaluate(`window.__casts = {}; window.__cdPrev = {}; window.__key = a => (a.ent.team ? "红·" : "绿·") + a.ent.h.pos + "·" + a.kit.id;
    window.__poll = () => { for (const a of __actors.values()) { if (!a.ent.h) continue; const k = __key(a), c = (__casts[k] ??= { Q: 0, W: 0, E: 0, R: 0 }), p = (__cdPrev[k] ??= {});
      for (const s of ["Q", "W", "E", "R"]) { const v = a.cdLeft(s); if (v > (p[s] ?? 0) + 0.5) c[s]++; p[s] = v; } } };
    __setSpeed(${+sp})`);
  const t0 = Date.now(); let at10 = null;
  for (;;) {
    await new Promise(r => setTimeout(r, 150));
    const s = await page.evaluate(`(__poll(), { t: __sim.time, over: __sim.over })`);
    if (!at10 && s.t >= 600) at10 = await page.evaluate(`__sim.heroes().filter(e => e.h).map(e => ({ k: (e.team ? "红·" : "绿·") + e.h.pos + "·" + e.h.kit, lv: e.h.level, cs: e.h.cs, kda: [e.h.kills, e.h.deaths, e.h.assists], dmg: Math.round(e.h.dmg) }))`);
    if (s.over || s.t > 2400 || Date.now() - t0 > 1500000) break;
  }
  R.result = await page.evaluate(`({ t: Math.round(__sim.time), over: __sim.over, kills: __sim.kills, report: __report(),
    heroes: __sim.heroes().filter(e => e.h).sort((p, q) => p.team - q.team).map(e => { const h = e.h, a = [...__actors.values()].find(v => v.ent === e); return { k: __key(a), lv: h.level, kda: [h.kills, h.deaths, h.assists], cs: h.cs, dmg: Math.round(h.dmg), worth: Math.round(h.gold + h.items.reduce((s, id) => s + __itemCost(id), 0)), items: h.items.slice(), casts: __casts[__key(a)] }; }) })`);
  R.at10 = at10; R.fps = await page.evaluate("Math.round(__stats.fps)");
  const winner = R.result.over === 1 ? "绿（0 队）" : R.result.over === -1 ? "红（1 队）" : String(R.result.over);
  console.log(`时长 ${Math.floor(R.result.t / 60)}:${String(R.result.t % 60).padStart(2, "0")}  赢的：${winner}  击杀 ${R.result.kills}  报错 ${R.errors.length}`);
  for (const h of R.result.heroes) console.log(`  ${h.k.padEnd(18)} L${h.lv}  ${h.kda.join("/")}  刀${h.cs}  伤害${h.dmg}  身家${h.worth}  技能 Q${h.casts?.Q} W${h.casts?.W} E${h.casts?.E} R${h.casts?.R}`);
  if (out) fs.writeFileSync(out, JSON.stringify(R, null, 1));
} finally { await browser.close(); }
