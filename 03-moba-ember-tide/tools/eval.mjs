#!/usr/bin/env node
// 在无界面 Chrome 里打开游戏并执行一段表达式，打印结果。调试用。
// 用法: node tools/eval.mjs "<网址参数>" "<JS 表达式>"
import puppeteer from "puppeteer-core";
const [query = "", expr = "1"] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--window-size=1280,720"] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 720 });
  const logs = [];
  page.on("console", m => logs.push(`[${m.type()}] ${m.text().slice(0, 500)}`));
  page.on("pageerror", e => logs.push("[pageerror] " + String(e).slice(0, 800)));
  await page.goto((process.env.MOBA_URL || "http://localhost:5183/") + "?" + query, { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true", { timeout: 60000 }).catch(() => logs.push("[timeout]"));
  await new Promise(r => setTimeout(r, 800));
  console.log(JSON.stringify(await page.evaluate(expr), null, 1));
  console.log(logs.slice(0, 15).join("\n"));
} finally { await browser.close(); }
