#!/usr/bin/env node
// 选人界面里能不能选到新英雄、电脑会不会选它（第九轮 k-seren）：主菜单 → 开始 → 点名册里的某张卡 → 截图 → 锁定 → 截图；再自己选同位置的另一个英雄锁定，看对面的电脑排上了谁。
// 用法: MOBA_URL=… node tools/seren_pick.mjs <输出目录> [英雄=seren] [同位置的另一个=vero]
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const [out, me = "seren", other = "vero"] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const base = process.env.MOBA_URL || "http://localhost:5183/map.html", sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 300000, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1600,900"] });
const R = { errors: [] };
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1600, height: 900 });
  page.on("pageerror", e => R.errors.push(String(e).slice(0, 200)));
  const ev = s => page.evaluate(s), click = async sel => { const r = await ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`); await page.mouse.click(r[0], r[1]); };
  for (const [who, tag] of [[me, "我选" + me], [other, "我选" + other]]) {
    await page.goto(base, { waitUntil: "load" }); await page.waitForFunction("window.__ready === true", { timeout: 120000 }); await sleep(2000);
    await click(".lob-home [data-a=play]"); await sleep(900);
    if (await ev("!!document.querySelector('.tile[data-p=adc]')")) { await page.screenshot({ path: `${out}/位置.jpg`, type: "jpeg", quality: 88 }); await click(".tile[data-p=adc]"); await sleep(900); }      // 第九轮的选人：先定位置，再挑英雄
    const cards = await ev(`[...document.querySelectorAll(".lob-pick .card")].map((c, i) => ({ i, text: c.textContent.replace(/\\s+/g, " ").trim().slice(0, 40), soon: /即将上线/.test(c.textContent) || c.classList.contains("soon") || c.classList.contains("off") }))`);
    R[tag] = { cards };
    const idx = await ev(`[...document.querySelectorAll(".lob-pick .card")].findIndex(c => c.dataset.id === ${JSON.stringify(who)} || c.outerHTML.includes(${JSON.stringify("/" + who + ".")}))`);
    R[tag].clicked = idx; if (idx < 0) continue;
    await click(`.lob-pick .card:nth-child(${idx + 1})`); await sleep(900); await page.screenshot({ path: `${out}/${tag}_选中.jpg`, type: "jpeg", quality: 88 });
    if (await ev("!!document.querySelector('.lob-pick [data-a=lock]')")) { await click(".lob-pick [data-a=lock]"); await sleep(1600); await page.screenshot({ path: `${out}/${tag}_锁定.jpg`, type: "jpeg", quality: 88 }); }
    R[tag].url = await ev("location.href"); R[tag].lineup = await ev("window.__lineup ? JSON.stringify(window.__lineup) : document.body.innerText.slice(0, 600)");
  }
  console.log(JSON.stringify(R, null, 1)); fs.writeFileSync(`${out}/pick.json`, JSON.stringify(R, null, 1));
} finally { await browser.close(); }
