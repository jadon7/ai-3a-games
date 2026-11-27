#!/usr/bin/env node
// 在测试场里让奥森阵亡一次，连拍倒地的过程（kit_test.mjs 不测死亡）。用法: node art/hero/osen/death_probe.mjs [输出目录] [张数=14] [间隔毫秒=150]
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const out = process.argv[2] || "art/hero/osen/kit_death", n = +(process.argv[3] || 14), gap = +(process.argv[4] || 150); fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 600000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1500,844"] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1500, height: 844 });
  await page.goto("http://localhost:5183/map.html?arena=1&h=osen", { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true && window.__arena", { timeout: 90000 });
  const sleep = ms => new Promise(r => setTimeout(r, ms)); await sleep(900);
  const how = await page.evaluate(`(() => { const h = __sim.hero; try { __sim.damage(h, 999999, __arena.dummy, { type: "true" }); } catch (e) { return "damage 报错: " + e; } return "alive=" + h.alive + " state=" + __play.actor.state(); })()`);
  for (let i = 0; i < n; i++) { await page.screenshot({ path: `${out}/D_${String(i).padStart(2, "0")}.jpg`, type: "jpeg", quality: 86 }); await sleep(gap); }
  console.log(how, "→", await page.evaluate("__play.actor.state() + ' clip=' + __play.actor.hero.current"));
} finally { await browser.close(); }
