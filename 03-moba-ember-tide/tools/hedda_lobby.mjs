#!/usr/bin/env node
// 赫达（k-hedda）：主菜单和选人界面截图，看赫达能不能选（“即将上线”没了）。用法: node tools/hedda_lobby.mjs <输出目录>
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const [out] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--hide-scrollbars", "--mute-audio", "--window-size=1600,900"] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1600, height: 900 }); const errs = []; page.on("pageerror", e => errs.push(String(e)));
  await page.goto(process.env.MOBA_URL || "http://localhost:5212/map.html", { waitUntil: "load" }); await new Promise(r => setTimeout(r, 2500));
  await page.screenshot({ path: `${out}/home.jpg`, type: "jpeg", quality: 90 });
  const home = await page.evaluate(`[...document.querySelectorAll("button[data-h], button.soon")].map(b => (b.dataset.h || "soon:" + b.title.split(" ")[0]))`);
  await page.evaluate(`document.querySelector('button[data-h="hedda"]')?.click()`); await new Promise(r => setTimeout(r, 2500));
  await page.screenshot({ path: `${out}/pick.jpg`, type: "jpeg", quality: 90 });
  const pick = await page.evaluate(`({ soon: [...document.querySelectorAll(".card.soon")].map(b => b.dataset.id), cards: [...document.querySelectorAll(".card")].map(b => b.dataset.id), lineup: window.__pick ? window.__pick.lineup() : null })`);
  console.log(JSON.stringify({ home, pick, errs }, null, 1));
} finally { await browser.close(); }
