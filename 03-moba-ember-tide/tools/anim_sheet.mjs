#!/usr/bin/env node
// 把预览页里的每段动作按时间均匀抽帧截图，用来检查动作质量。
// 用法: node tools/anim_sheet.mjs <输出目录> <动作名,动作名…> [每段帧数=8] [视角,视角=close,side] [边长=420]
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const [out, acts, n = "8", views = "close,side", size = "420"] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", `--window-size=${size},${size}`] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: +size, height: +size });
  const errors = []; page.on("pageerror", e => errors.push(String(e).slice(0, 200)));
  const base = process.env.VIEW_URL || "http://localhost:5183/docs/hero/3/index.html";      // 看别的角色：VIEW_URL="http://localhost:5183/viewer.html?model=/assets/hero/x.glb&height=3.2"
  await page.goto(base + (base.includes("?") ? "&" : "?") + "ui=0&t=0", { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true", { timeout: 60000 });
  const clips = Object.fromEntries((await page.evaluate("window.__stats.clips")));
  for (const a of acts.split(",")) for (const v of views.split(",")) for (let i = 0; i < +n; i++) {
    const t = (clips[a] ?? 1) * (i / (+n - (v === "loop" ? 0 : 1)));
    await page.evaluate(`window.__pose(${JSON.stringify(a)}, ${t}, ${JSON.stringify(v)})`); await new Promise(r => setTimeout(r, 70));
    await page.screenshot({ path: `${out}/${a}_${v}_${String(i).padStart(2, "0")}.jpg`, type: "jpeg", quality: 86 });
  }
  console.log(JSON.stringify({ clips, errors }));
} finally { await browser.close(); }
