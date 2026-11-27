#!/usr/bin/env node
// 卡兹用（照 art/hero/seren/stand.mjs 改）：在测试场里把自己的英雄（借奥森的位置、换卡兹的模型）挪到己方小兵和假人英雄旁边站着，拉近镜头截几张图，看个头合不合适。
// 用法: MOBA_URL=http://localhost:5190/map.html MOBA_Q="glb=kaz&look=height:2.4,ring:1.6" node art/hero/kaz/scripts/stand.mjs <输出目录> [英雄=osen]
// 产出: <输出目录>/stand_pals.jpg（己方两个小兵和己方假人英雄旁边）、stand_foes.jpg（对面小兵和对面假人英雄旁边）、各自一张近景 *_close.jpg
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const [out, hero = "osen"] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 600000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1500,844"] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1500, height: 844 });
  const errors = []; page.on("pageerror", e => errors.push(String(e).slice(0, 300)));
  await page.goto((process.env.MOBA_URL || "http://localhost:5190/map.html") + `?arena=1&nohud=1&h=${hero}` + (process.env.MOBA_Q ? "&" + process.env.MOBA_Q : ""), { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true && window.__arena", { timeout: 90000 });
  const sleep = ms => new Promise(r => setTimeout(r, ms)); await sleep(1200);
  const info = await page.evaluate(`(() => { const A = __arena, p = A.pals[0], f = A.friend, d = A.dummy, g = A.foes[0]; return { pal: [p.x, p.z], friend: [f.x, f.z], dummy: [d.x, d.z], foe: [g.x, g.z], me: [__play.actor.pos.x, __play.actor.pos.z] }; })()`);
  // 站到己方小兵和假人英雄的中间，面朝镜头那边一点
  for (const [name, a, b] of [["pals", info.pal, info.friend], ["foes", info.foe, info.dummy]]) {
    const x = (a[0] + b[0]) / 2 + 0.8, z = (a[1] + b[1]) / 2 + 0.8;
    await page.evaluate(`(() => { const a = __play.actor; a.teleport(${x}, ${z}); })()`); await sleep(1500);
    await page.screenshot({ path: `${out}/stand_${name}.jpg`, type: "jpeg", quality: 90 });
    await page.screenshot({ path: `${out}/stand_${name}_close.jpg`, type: "jpeg", quality: 92, clip: { x: 450, y: 180, width: 600, height: 420 } });
  }
  // 卡兹加的：站到对面假人英雄（岚，3.1 米）旁边的空地上，再把两个己方小兵挪到另一边，排成一排比个头
  { const x = info.dummy[0] + 3.2, z = info.dummy[1] + 0.4;
    await page.evaluate(`(() => { const a = __play.actor, A = __arena; a.teleport(${x}, ${z}); A.pals[0].x = ${x} + 2.8; A.pals[0].z = ${z} - 0.6; A.pals[1].x = ${x} + 3.0; A.pals[1].z = ${z} + 1.2; })()`); await sleep(1500);
    await page.screenshot({ path: `${out}/stand_row.jpg`, type: "jpeg", quality: 90 });
    await page.screenshot({ path: `${out}/stand_row_close.jpg`, type: "jpeg", quality: 92, clip: { x: 400, y: 160, width: 700, height: 460 } }); }
  console.log(JSON.stringify({ info, errors: errors.slice(0, 5) }));
} finally { await browser.close(); }
