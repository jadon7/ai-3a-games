#!/usr/bin/env node
// 在真实对局里看巨蟾（蓝增益营地的野怪）：等它刷出来，把英雄挪到它旁边打它，连拍它的待机、普攻、重击（地上的预警圈）、追人、回营地、死亡。
// 每张图的文件名里带着拍的那一刻它的状态和这次出手过了多久（毫秒）。
// 用法（在 MOBA 目录里）: node art/unit/toad/scripts/game_check.mjs <输出目录> [打多少秒=13]
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const out = process.argv[2] || "art/unit/toad/game"; const fightSec = +(process.argv[3] || 13); fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 900000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1500,844"] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1500, height: 844 });
  const errors = []; page.on("pageerror", e => errors.push(String(e).slice(0, 300))); page.on("console", m => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
  await page.goto("http://localhost:5183/map.html?h=lan&nohud=1", { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true && window.__sim", { timeout: 90000 });
  const ev = s => page.evaluate(s), sleep = ms => new Promise(r => setTimeout(r, ms));
  await page.waitForFunction("__sim.time > 21 && __sim.ents.some(e => e.kind === 'monster' && e.mob === 'toad' && e.alive)", { timeout: 120000, polling: 250 });
  const info = await ev(`(() => { const h = __sim.hero, ts = __sim.ents.filter(e => e.kind === 'monster' && e.mob === 'toad' && e.alive); ts.sort((a, b) => Math.hypot(a.x - h.x, a.z - h.z) - Math.hypot(b.x - h.x, b.z - h.z));
    const t = window.__toad = ts[0], a = __play.actor; let x = t.x + 3.4, z = t.z + 1.2; if (!__nav.walkable(x, z)) [x, z] = __nav.nearest(x, z); a.stop(); a.teleport(x, z); window.__hx = x; window.__hz = z;
    window.__keep = setInterval(() => { h.hp = h.max; }, 100); return { toad: [t.x, t.z, t.hp, t.max], hero: [x, z], n: ts.length }; })()`);
  console.log("巨蟾", JSON.stringify(info));
  const st = () => ev("(() => { const t = __toad; return { s: t.alive ? t.state : 'dead', sw: Math.round((t.swing ?? 0) * 1000), hp: Math.round(t.hp), d: +Math.hypot(t.x - __sim.hero.x, t.z - __sim.hero.z).toFixed(1) }; })()");
  const burst = async (pre, n, gap) => { const log = []; for (let i = 0; i < n; i++) { const s = await st(); await page.screenshot({ path: `${out}/${pre}_${String(i).padStart(2, "0")}_${s.s}_${s.sw}.jpg`, type: "jpeg", quality: 86 }); log.push(`${s.s}:${s.sw}`); await sleep(gap); } return log; };
  await sleep(1500); console.log("待机", (await burst("idle", 4, 400)).join(" "));
  await ev("__play.attack(__toad)"); console.log("打起来", (await burst("fight", Math.round(fightSec * 1000 / 190), 60)).join(" "));
  // 引它追：英雄往外走 7 米，它追过来（走路），超出范围以后回营地
  await ev(`(() => { const a = __play.actor, t = __toad; let dx = __hx - t.x, dz = __hz - t.z, l = Math.hypot(dx, dz) || 1, x = __hx + dx / l * 7, z = __hz + dz / l * 7; if (!__nav.walkable(x, z)) [x, z] = __nav.nearest(x, z); a.stop(); a.moveTo(x, z); })()`);
  console.log("追人", (await burst("chase", 22, 60)).join(" "));
  await ev(`(() => { const a = __play.actor, t = __toad; let dx = __hx - t.hx, dz = __hz - t.hz, l = Math.hypot(dx, dz) || 1, x = t.hx + dx / l * 16, z = t.hz + dz / l * 16; if (!__nav.walkable(x, z)) [x, z] = __nav.nearest(x, z); a.stop(); a.teleport(x, z); })()`);
  await sleep(300); await ev("(() => { const a = __play.actor, t = __toad; a.teleport(__hx + 2, __hz + 2); })()");      // 英雄躲远一下再回来看它走回营地
  console.log("回营地", (await burst("home", 14, 60)).join(" "));
  await sleep(2500);
  await ev("(() => { __toad.hp = 1; __play.attack(__toad); })()"); await page.waitForFunction("!__toad.alive", { timeout: 20000, polling: 30 }).catch(() => {});
  console.log("死亡", (await burst("death", 16, 60)).join(" "));
  console.log(JSON.stringify({ errors: errors.slice(0, 6), fps: await ev("Math.round(__stats.fps)") }));
} finally { await browser.close(); }
