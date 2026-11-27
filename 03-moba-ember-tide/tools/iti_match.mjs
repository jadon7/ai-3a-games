// 全电脑对战（第四阶段 iti-kit 照 k-kaz 的 kaz_match.mjs 拷的）：16 倍速跑到分出胜负（最多 35 分钟），结束时记下每个英雄的击杀/死亡/助攻、补刀、清的野怪营地、对英雄的伤害、打野抓了几次，和谁赢、打了多久、报错。
// 用法: MOBA_URL=... node tools/kaz_match.mjs <输出.json> "<网址参数>" [速度=16]
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const [out, q = "h=kaz", sp = "16"] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 1800000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1280,720"] });
const R = { q, errors: [], snaps: [] };
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 720 });
  page.on("pageerror", e => R.errors.push(String(e).slice(0, 240))); page.on("console", m => { if (m.type() === "error") R.errors.push(m.text().slice(0, 200)); });
  await page.goto(process.env.MOBA_URL + "?" + q + "&auto=1&nofog=1&nohud=1", { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true && window.__sim", { timeout: 180000 });
  await page.evaluate(`__setSpeed(${+sp})`);
  const snap = `(() => ({ t: Math.round(__sim.time), over: __sim.over, kills: __sim.kills, heroes: __bots.map(b => { const e = b.ent, h = e.h; return { id: h.kit, team: e.team, pos: b.pos(), lv: h.level, k: h.kills, d: h.deaths, a: h.assists, cs: h.cs, camps: h.camps, dmg: Math.round(h.dmg), gold: Math.round(h.gold + h.items.reduce((s, i) => s + __itemCost(i), 0)), ganks: b.ganks() }; }) }))()`;
  let next = 300;
  for (;;) { await new Promise(r => setTimeout(r, 500)); const s = await page.evaluate(`({ t: __sim.time, over: __sim.over })`);
    if (s.t >= next) { R.snaps.push(await page.evaluate(snap)); next += 300; }
    if (s.over || s.t > 2100) break; }
  R.end = await page.evaluate(snap);
} catch (e) { R.errors.push("脚本出错 " + String(e).slice(0, 200)); }
finally { await browser.close(); }
fs.writeFileSync(out, JSON.stringify(R, null, 1));
const e = R.end; if (e) { console.log(`${q}  ${Math.floor(e.t / 60)}:${String(e.t % 60).padStart(2, "0")}  ${e.over === 1 ? "a 队赢" : e.over === -1 ? "b 队赢" : "没分出胜负"}  击杀 ${e.kills.join(":")}  报错 ${R.errors.length}`);
  for (const h of e.heroes) console.log(`  ${h.team ? "b" : "a"} ${h.pos.padEnd(6)} ${h.id.padEnd(7)} L${h.lv} ${h.k}/${h.d}/${h.a} 刀${h.cs} 营${h.camps} 伤害${h.dmg} 身家${h.gold}${h.pos === "jungle" ? " 抓" + h.ganks : ""}`); }
