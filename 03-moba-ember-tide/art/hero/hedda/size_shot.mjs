#!/usr/bin/env node
// 赫达和小兵、已有英雄站在一起比个头：测试场里把自己挪到对面的假人英雄（岚）和对面小兵中间，镜头推近，截两张（游戏默认距离一张、推近一张）。
// 用法: MOBA_Q="glb=hedda&look=height:3.2,ring:1.2" node art/hero/hedda/size_shot.mjs <输出目录> [借谁的技能=gorran]
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const [out, kit = "gorran"] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const base = process.env.MOBA_URL || "http://localhost:5190/map.html";
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 600000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1600,900"] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1600, height: 900 }); const errors = [];
  page.on("pageerror", e => errors.push(String(e).slice(0, 200)));
  await page.goto(base + `?arena=1&h=${kit}` + (process.env.MOBA_Q ? "&" + process.env.MOBA_Q : ""), { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true && window.__arena", { timeout: 120000 }); await new Promise(r => setTimeout(r, 1200));
  const info = await page.evaluate(`(() => { const A = __arena, f = A.dummy, p = A.foes[1], q = A.foes[0], a = __play.actor;
    const x = f.x * 0.45 + p.x * 0.55, z = f.z * 0.45 + p.z * 0.55; a.teleport(x, z); a.face(x + 3, z + 10, true);
    return { friend: f.h?.kit ?? f.kind, me: [x, z], f: [f.x, f.z], p: [p.x, p.z], q: [q.x, q.z] }; })()`);
  console.log(JSON.stringify(info)); await new Promise(r => setTimeout(r, 900));
  await page.screenshot({ path: `${out}/size_far.jpg`, type: "jpeg", quality: 90 });
  const box = await page.$("canvas"); const bb = await box.boundingBox(); await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  for (let i = 0; i < 6; i++) { await page.mouse.wheel({ deltaY: -100 }); await new Promise(r => setTimeout(r, 60)); }
  await new Promise(r => setTimeout(r, 900)); await page.screenshot({ path: `${out}/size_near.jpg`, type: "jpeg", quality: 90 });
  console.log(JSON.stringify({ errors: errors.slice(0, 3) }));
} finally { await browser.close(); }
