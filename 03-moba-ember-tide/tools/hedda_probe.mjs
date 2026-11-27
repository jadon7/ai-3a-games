#!/usr/bin/env node
// 赫达（k-hedda）：开测试场，执行一段代码，打印结果（看靶子的路向坐标、骨骼位置之类）。用法: node tools/hedda_probe.mjs '<表达式>' [额外参数]
import puppeteer from "puppeteer-core";
const [expr, extra = ""] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--hide-scrollbars", "--mute-audio", "--window-size=1280,720"] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 720 });
  await page.goto((process.env.MOBA_URL || "http://localhost:5212/map.html") + `?arena=1&h=hedda&nohud=1${extra ? "&" + extra : ""}`, { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true && window.__arena", { timeout: 120000 }); await new Promise(r => setTimeout(r, 1200));
  await page.evaluate(`window.__U=(x,z)=>[+((x-z)/Math.SQRT2).toFixed(2),+((x+z)/Math.SQRT2).toFixed(2)]; window.__W=(u,v)=>[(u+v)/Math.SQRT2,(v-u)/Math.SQRT2]; window.__me=__actors.get(__sim.hero.id); 1`);
  console.log(JSON.stringify(await page.evaluate(expr), null, 1));
} finally { await browser.close(); }
