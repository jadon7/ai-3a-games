#!/usr/bin/env node
// 伊缇的技能栏（第四阶段 iti-kit）：测试场里放 Q 一段、W 一段，截技能栏上“再按一次”的样子（段数牌、剩余时间条），桌面版和触屏版各一套。
// 用法: MOBA_URL=... node tools/iti_hud.mjs <输出目录>
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const [out] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 300000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1600,900"] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const info = {};
try {
  for (const [tag, q, w, h] of [["desk", "", 1600, 900], ["touch", "&touch=1&q=lite", 844, 390]]) {
    const page = await browser.newPage(); await page.setViewport({ width: w, height: h, deviceScaleFactor: tag === "touch" ? 2 : 1 });
    const errors = []; page.on("pageerror", e => errors.push(String(e).slice(0, 300)));
    await page.goto(process.env.MOBA_URL + "?arena=1&h=iti" + q, { waitUntil: "load" });
    await page.waitForFunction("window.__ready === true && window.__arena && window.__arena.dummy", { timeout: 120000 }); await sleep(1500);
    const shot = async name => { await page.screenshot({ path: `${out}/${tag}_${name}.jpg`, type: "jpeg", quality: 90 }); };
    await shot("0_ready");
    await page.evaluate(`(() => { const a = __play.actor, d = __arena.dummy; a.cast("Q", { x: d.x, z: d.z }); return 1; })()`); await sleep(900);
    info[tag + "_q"] = await page.evaluate(`(() => { const b = [...document.querySelectorAll(".sk")].find(x => x.classList.contains("recast")); return b ? { text: b.querySelector(".rc")?.textContent, cls: b.className } : null; })()`);
    await shot("1_q2");
    await page.evaluate(`(() => { const a = __play.actor, d = __arena.dummy; a.cast("Q", { x: d.x, z: d.z }); return 1; })()`); await sleep(900);
    await shot("2_q3");
    await page.evaluate(`(() => { const a = __play.actor, d = __arena.dummy; a.cast("W", { x: d.x + 3, z: d.z - 3 }); return 1; })()`); await sleep(900);
    info[tag + "_w"] = await page.evaluate(`[...document.querySelectorAll(".sk.recast")].map(b => b.querySelector(".rc")?.textContent)`);
    await shot("3_w2");
    info[tag + "_errors"] = errors;
    await page.close();
  }
  console.log(JSON.stringify(info, null, 1));
} finally { await browser.close(); }
