#!/usr/bin/env node
// 换画风 B（w-unit）：真实对局里看一窝野怪在自己营地里（Boss 在河道里）的样子。先开一次拿到营地的位置，再带着 cam= 机位重开，提前刷出这一窝。
// 用法: MOBA_URL=… node tools/style_b/camp_look.mjs <输出前缀> <野怪名> [第几个营地=0] [镜头距离=20] [俯角=50] [额外网址参数]
//   产出 <前缀>.jpg（站着），<前缀>_hit.jpg（英雄瞬移过去打它一下以后，看出手的动作和血条）
import puppeteer from "puppeteer-core";
const [out, mob, idx = "0", dist = "20", pitch = "50", extra = ""] = process.argv.slice(2);
const base = process.env.MOBA_URL || "http://localhost:5235/map.html";
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1920,1080"] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1920, height: 1080 });
  const errors = []; page.on("pageerror", e => errors.push(String(e).slice(0, 300)));
  const q0 = `h=lan&nohud=1&solo=1${extra ? "&" + extra : ""}`;
  await page.goto(`${base}?${q0}`, { waitUntil: "load", timeout: 60000 }); await page.waitForFunction("window.__ready === true && !!window.__sim", { timeout: 90000 });
  const c = await page.evaluate((m, i) => { const cs = window.__sim.camps.filter(c => c.mob === m); const c = cs[Math.min(+i, cs.length - 1)]; return { x: c.x, z: c.z, fx: c.fx, fz: c.fz, n: cs.length }; }, mob, idx);
  const u = (c.x - c.z) / Math.SQRT2, v = (c.x + c.z) / Math.SQRT2;
  await page.goto(`${base}?${q0}&cam=${u.toFixed(2)},${v.toFixed(2)},${dist},${pitch}&t=3`, { waitUntil: "load", timeout: 60000 }); await page.waitForFunction("window.__ready === true && !!window.__sim", { timeout: 90000 });
  await page.evaluate((m, i) => { const sim = window.__sim; sim.reveal = true; const cs = sim.camps.filter(c => c.mob === m); const c = cs[Math.min(+i, cs.length - 1)]; if (!c.up) sim.spawnCamp(c); window.__camp = c; }, mob, idx);
  await new Promise(r => setTimeout(r, 3500));
  await page.screenshot({ path: `${out}.jpg`, type: "jpeg", quality: 92 });
  // 英雄瞬移到营地前面打一下：看出手的动作
  await page.evaluate(() => { const c = window.__camp, a = window.__actors.get(window.__sim.hero.id); const x = c.x + c.fx * 3.5, z = c.z + c.fz * 3.5; a.teleport(x, z); window.__play?.attack?.(c.mobs[0]); });
  await new Promise(r => setTimeout(r, 2200));
  await page.screenshot({ path: `${out}_hit.jpg`, type: "jpeg", quality: 92 });
  console.log(JSON.stringify({ out, camp: c, lane: [u, v], errors: errors.slice(0, 5) }));
} finally { await browser.close(); }
