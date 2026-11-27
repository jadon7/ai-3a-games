// 选人界面里卡兹能不能选（第九轮 k-kaz）：主菜单 → 开始对局 → 打野 → 截图；再查名册里卡兹是不是“即将上线”。用法: MOBA_URL=... node tools/kaz_pick.mjs <输出目录>
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const out = process.argv[2]; fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 300000, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1600,900"] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let page;
const click = async sel => { const r = await page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`); if (r) await page.mouse.click(r[0], r[1]); return !!r; };
try {
  page = await browser.newPage(); await page.setViewport({ width: 1600, height: 900 });
  await page.goto(process.env.MOBA_URL, { waitUntil: "load" }); await page.waitForFunction("window.__ready === true", { timeout: 120000 }); await sleep(2500);
  const home = await page.evaluate(`(() => { const b = document.querySelector('[data-h="kaz"]'); const soon = [...document.querySelectorAll("button.soon")].map(x => x.title.split(" ")[0]); return { kazButton: !!b, kazTitle: b?.title ?? null, soon }; })()`);
  await page.screenshot({ path: out + "/home.jpg", type: "jpeg", quality: 85 });
  await click(".lob-home [data-a=play]"); await sleep(900); await click(".lob-pick .tile[data-p=jungle]"); await sleep(1200);
  const pick = await page.evaluate(`(() => [...document.querySelectorAll(".lob-pick .card")].map(x => (x.dataset.id || "") + (x.className.includes("soon") ? "(soon)" : "")).filter(Boolean))()`);
  await page.screenshot({ path: out + "/pick_jungle.jpg", type: "jpeg", quality: 85 });
  const k = await click('.lob-pick .card[data-id="kaz"]'); if (k) { await sleep(900); await page.screenshot({ path: out + "/pick_kaz.jpg", type: "jpeg", quality: 85 }); }
  console.log(JSON.stringify({ home, pick, clickedKaz: !!k }));
} finally { await browser.close(); }
