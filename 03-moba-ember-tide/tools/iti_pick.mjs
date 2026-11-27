#!/usr/bin/env node
// 选人、载入、计分板里的伊缇（第四阶段 iti-kit，照 k-kaz 的 kaz_pick.mjs 改）：主菜单 → 开始对局 → 中单 → 截图；点伊缇 → 截图；锁定 → 截载入画面；
// 进了对局按住 Tab 截计分板。再查名册里伊缇是不是“即将上线”、电脑排两队时会不会排到她（换 40 个种子数一数）。
// 用法: MOBA_URL=... node tools/iti_pick.mjs <输出目录> [宽=1600] [高=900]
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const [out, W = "1600", H = "900"] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 300000, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", `--window-size=${W},${H}`] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let page;
const click = async sel => { const r = await page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`); if (r) await page.mouse.click(r[0], r[1]); return !!r; };
const tag = `${W}x${H}`;
try {
  page = await browser.newPage(); await page.setViewport({ width: +W, height: +H });
  const errors = []; page.on("pageerror", e => errors.push(String(e).slice(0, 300)));
  await page.goto(process.env.MOBA_URL, { waitUntil: "load" }); await page.waitForFunction("window.__ready === true", { timeout: 120000 }); await sleep(2500);
  const home = await page.evaluate(`(() => { const b = document.querySelector('[data-h="iti"]'); const soon = [...document.querySelectorAll("button.soon")].map(x => x.title.split(" ")[0]); return { itiButton: !!b, itiTitle: b?.title ?? null, soon }; })()`);
  await page.screenshot({ path: `${out}/${tag}_1_home.jpg`, type: "jpeg", quality: 88 });
  // 电脑排队会不会排到她：拿选人界面用的同一个排法，换 40 个种子（玩家选岚打野）
  // 打包版和线上没有源文件可导入，这一项只在开发服务器上数
  const picks = await page.evaluate(`(async () => { let L; try { L = await import("/src/map/game/lineup.ts"); } catch { return "打包版里没法数"; } let a = 0, b = 0; for (let s = 1; s <= 40; s++) { const l = L.makeLineup("lan", "jungle", L.seeded(s)); if (l.teams[0].some(x => x.id === "iti")) a++; if (l.teams[1].some(x => x.id === "iti")) b++; } return { 我方排到: a, 对面排到: b, 共: 40 }; })()`);
  await click(".lob-home [data-a=play]"); await sleep(900); await click(".lob-pick .tile[data-p=mid]"); await sleep(1200);
  const pick = await page.evaluate(`(() => [...document.querySelectorAll(".lob-pick .card")].map(x => (x.dataset.id || "") + (x.className.includes("soon") ? "(soon)" : "")).filter(Boolean))()`);
  await page.screenshot({ path: `${out}/${tag}_2_pick_mid.jpg`, type: "jpeg", quality: 88 });
  const k = await click('.lob-pick .card[data-id="iti"]'); await sleep(900); await page.screenshot({ path: `${out}/${tag}_3_pick_iti.jpg`, type: "jpeg", quality: 88 });
  await click('.lob-pick [data-a=lock]'); await sleep(1400); await page.screenshot({ path: `${out}/${tag}_4_lock.jpg`, type: "jpeg", quality: 88 });
  await page.waitForFunction("location.search.includes('h=iti')", { timeout: 30000 }).catch(() => {}); await sleep(1500);
  await page.screenshot({ path: `${out}/${tag}_5_loading.jpg`, type: "jpeg", quality: 88 });
  await page.waitForFunction("window.__ready === true && window.__sim", { timeout: 120000 }); await sleep(2500);
  const lineup = await page.evaluate(`({ url: location.search, a: __lineup?.teams?.[0]?.map(s => s.id), b: __lineup?.teams?.[1]?.map(s => s.id) })`);
  await page.screenshot({ path: `${out}/${tag}_6_game.jpg`, type: "jpeg", quality: 88 });
  await page.keyboard.down("Tab"); await sleep(600); await page.screenshot({ path: `${out}/${tag}_7_board.jpg`, type: "jpeg", quality: 88 }); await page.keyboard.up("Tab");
  console.log(JSON.stringify({ home, picks, pick, clickedIti: k, lineup, errors: errors.slice(0, 5) }, null, 1));
} finally { await browser.close(); }
