#!/usr/bin/env node
// 换画风 B · b-build：证明建筑的几种状态还好使——英雄走到塔背后时塔镂空、塔被拆的那一下（爆炸）、拆完剩的残座、水晶被打爆。
// 用法: MOBA_URL=http://localhost:5224/map.html node tools/bbuild_states.mjs <输出目录>
// 都是单人模式（solo=1）：英雄站在我方中路外塔的背后（离镜头更远的一侧），镜头跟着英雄；拆塔、拆水晶用页面里的 __sim.damage
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const [dir] = process.argv.slice(2); fs.mkdirSync(dir, { recursive: true });
const base = process.env.MOBA_URL || "http://localhost:5224/map.html";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 300000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1600,900"] });
const log = {};
const open = async q => { const page = await browser.newPage(); await page.setViewport({ width: 1600, height: 900 }); const errors = []; page.on("pageerror", e => errors.push(String(e).slice(0, 300))); page.on("console", m => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
  await page.goto(base + "?" + q, { waitUntil: "load", timeout: 60000 }); await page.waitForFunction("window.__ready === true", { timeout: 120000 }); await sleep(2500); return { page, errors }; };
try {
  // 1 镂空：英雄在中路外塔（路向 -22,0）背后 3 米。对照：同一个机位、英雄挪到塔前面
  for (const [name, hero] of [["see_behind", "-19.8,-2.2,0,0"], ["see_front", "-24.2,2.2,0,0"]]) {
    const { page, errors } = await open(`h=lan&solo=1&hero=${hero}&nohud=1`); await page.screenshot({ path: `${dir}/${name}.jpg`, type: "jpeg", quality: 90 }); log[name] = errors; await page.close();
  }
  // 2 拆塔：英雄站在塔前，塔被打掉的那一下连拍，再等残座
  { const { page, errors } = await open(`h=lan&solo=1&hero=-26,2.5,0,0&nohud=1`);
    await page.evaluate(() => { const t = __sim.ents.find(e => e.kind === "tower" && e.team === 0 && e.lane === 0 && e.tier === 1); __sim.damage(t, 1e6, null); });
    for (const [i, ms] of [[0, 120], [1, 250], [2, 400]]) { await sleep(ms); await page.screenshot({ path: `${dir}/boom_${i}.jpg`, type: "jpeg", quality: 90 }); }
    await sleep(3500); await page.screenshot({ path: `${dir}/ruin_tower.jpg`, type: "jpeg", quality: 90 }); log.tower = errors; await page.close(); }
  // 3 对方的塔也拆一座（对方的中路外塔，路向 22,0）
  { const { page, errors } = await open(`h=lan&solo=1&hero=18,2.5,0,0&nohud=1`);
    await page.evaluate(() => { const t = __sim.ents.find(e => e.kind === "tower" && e.team === 1 && e.lane === 0 && e.tier === 1); __sim.damage(t, 1e6, null); });
    await sleep(150); await page.screenshot({ path: `${dir}/boom_foe.jpg`, type: "jpeg", quality: 90 }); await sleep(3500); await page.screenshot({ path: `${dir}/ruin_tower_foe.jpg`, type: "jpeg", quality: 90 }); log.towerFoe = errors; await page.close(); }
  // 4 拆对方的水晶（先拆掉中路三座塔，水晶才挨打）：爆炸那一下和废墟
  { const { page, errors } = await open(`h=lan&solo=1&hero=84,6,0,0&nohud=1`);
    for (const tier of [1, 2, 3]) { await page.evaluate(t => { const e = __sim.ents.find(x => x.kind === "tower" && x.team === 1 && x.lane === 0 && x.tier === t); __sim.damage(e, 1e6, null); }, tier); await sleep(300); }
    await page.evaluate(() => { const c = __sim.ents.find(e => e.kind === "core" && e.team === 1); __sim.damage(c, 1e6, null); });
    await sleep(200); await page.screenshot({ path: `${dir}/boom_core.jpg`, type: "jpeg", quality: 90 }); await sleep(4000); await page.screenshot({ path: `${dir}/ruin_core.jpg`, type: "jpeg", quality: 90 }); log.core = errors; await page.close(); }
} finally { await browser.close(); }
fs.writeFileSync(`${dir}/states.json`, JSON.stringify(log, null, 1)); console.log(JSON.stringify(log));
