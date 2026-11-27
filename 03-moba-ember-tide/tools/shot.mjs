#!/usr/bin/env node
// 用本机 Chrome（无界面、走真实显卡）给游戏截图。
// 用法: node tools/shot.mjs <输出.jpg> "<网址参数>" [宽=1920] [高=1080] [等待毫秒=600]
// 例子: node tools/shot.mjs /tmp/a.jpg "cam=0,0,30&nohud=1&t=3"
import puppeteer from "puppeteer-core";
const [out, query = "", w = "1920", h = "1080", wait = "600"] = process.argv.slice(2);
const base = process.env.MOBA_URL || "http://localhost:5183/";
const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", `--window-size=${w},${h}`, ...(process.env.MOBA_UNCAP ? ["--disable-frame-rate-limit", "--disable-gpu-vsync"] : [])],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: +w, height: +h, deviceScaleFactor: +(process.env.MOBA_DSF || 1) });
  const errors = [];
  page.on("console", m => { if (m.type() === "error" || m.type() === "warning") errors.push(`[${m.type()}] ${m.text().slice(0, 600)}`); });
  page.on("pageerror", e => errors.push("[pageerror] " + String(e).slice(0, 600)));
  await page.goto(base + (query ? "?" + query : ""), { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction("window.__ready === true", { timeout: 90000 }).catch(() => errors.push("[timeout] 等不到 __ready"));
  await new Promise(r => setTimeout(r, +wait));
  await page.screenshot({ path: out, type: "jpeg", quality: 90 });
  const info = await page.evaluate(() => ({ ...(window.__stats ?? {}), counts: window.__counts }));
  console.log(JSON.stringify({ out, info, errors: errors.slice(0, 12) }));
} finally { await browser.close(); }
