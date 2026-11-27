#!/usr/bin/env node
// 赫达（k-hedda）：测试场里执行一段异步代码（可以 import 页面里的模块），然后截一张图。用法: node tools/hedda_probe2.mjs <输出.jpg> '<异步函数体>' [额外参数]
import puppeteer from "puppeteer-core";
const [out, body, extra = ""] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--hide-scrollbars", "--mute-audio", "--window-size=1280,720"] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 720 }); const errs = []; page.on("pageerror", e => errs.push(String(e))); page.on("console", m => { if (m.type() === "error") errs.push(m.text().slice(0, 300)); });
  await page.goto((process.env.MOBA_URL || "http://localhost:5212/map.html") + `?arena=1&h=hedda&nohud=1${extra ? "&" + extra : ""}`, { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true && window.__arena", { timeout: 120000 }); await new Promise(r => setTimeout(r, 1200));
  await page.evaluate(`window.__W=(u,v)=>[(u+v)/Math.SQRT2,(v-u)/Math.SQRT2]; window.__me=__actors.get(__sim.hero.id); 1`);
  const r = await page.evaluate(`(async () => { ${body} })()`); console.log(JSON.stringify(r));
  await new Promise(r => setTimeout(r, 400)); await page.screenshot({ path: out, type: "jpeg", quality: 92 }); console.log(JSON.stringify(errs.slice(0, 5)));
} finally { await browser.close(); }
