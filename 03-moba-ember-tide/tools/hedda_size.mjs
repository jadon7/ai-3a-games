#!/usr/bin/env node
// 赫达（k-hedda）：个头对比图。开一局（赫达打辅助，对面辅助是摩珂），快进到兵线碰面，把摩珂和一个小兵挪到赫达身边，停住截一张。
// 用法: node tools/hedda_size.mjs <输出.jpg>
import puppeteer from "puppeteer-core";
const [out] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 600000, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--hide-scrollbars", "--mute-audio", "--window-size=1600,900"] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1600, height: 900 });
  await page.goto((process.env.MOBA_URL || "http://localhost:5212/map.html") + "?h=hedda&pos=sup&a=gorran,lan,osen,vero,hedda&b=torg,lan,osen,vero,moko&nohud=1&nofog=1&auto=1", { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true", { timeout: 180000 }); await page.evaluate("__setSpeed(8)");
  await page.waitForFunction("__sim.time > 78", { timeout: 300000, polling: 200 }); await page.evaluate("__setSpeed(1)");
  await page.evaluate("for (const b of (window.__bots || [])) void b; 1");
  const r = await page.evaluate(`(() => { const me = __actors.get(__sim.hero.id), h = __sim.hero; me.stop();
    const moko = [...__actors.values()].find(a => a.kit.id === "moko"), vero = [...__actors.values()].find(a => a.kit.id === "vero" && a.ent.team === 0);
    const yaw = me.yaw(), fx = Math.sin(yaw), fz = Math.cos(yaw), rx = fz, rz = -fx;
    moko.teleport(h.x + rx * 3.2, h.z + rz * 3.2); moko.stop(); moko.face(h.x, h.z, true);
    const mins = __sim.ents.filter(e => (e.kind === "melee" || e.kind === "ranged") && e.alive).sort((p, q) => Math.hypot(p.x - h.x, p.z - h.z) - Math.hypot(q.x - h.x, q.z - h.z)).slice(0, 2);
    mins.forEach((m, i) => { m.x = h.x - rx * (2.4 + i * 1.6) + fx * 0.6; m.z = h.z - rz * (2.4 + i * 1.6) + fz * 0.6; });
    return { moko: !!moko, mins: mins.map(m => m.kind), heights: { hedda: me.kit.height, moko: moko.kit.height } }; })()`);
  await new Promise(r => setTimeout(r, 150)); await page.evaluate("__setSpeed(0.0001)"); await new Promise(r => setTimeout(r, 700));
  await page.screenshot({ path: out, type: "jpeg", quality: 92 }); console.log(JSON.stringify(r));
} finally { await browser.close(); }
