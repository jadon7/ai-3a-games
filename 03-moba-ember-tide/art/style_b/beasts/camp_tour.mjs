#!/usr/bin/env node
// 在真的对局里看四种四足野怪：把它们的营地（狼、野猪、巨蟾）和河道里的 Boss（岩甲巨兽）直接刷出来，镜头固定对着营地（?cam=，游戏镜头的俯角），
// 拍站着的一张；英雄从旁边打一下引它们动起来再拍一张。换模型前后跑同一份，拿来并排比。
// 用法: MOBA_URL=http://localhost:5236/map.html node art/style_b/beasts/camp_tour.mjs <输出目录> [怪名,逗号分开=wolf,boar,toad,beast] [镜头距离,逗号分开=27,14]
// 产出: <怪>_d<距离>.jpg（站着）、<怪>_d<距离>_fight.jpg（打了一下之后 1.4 秒）、<怪>_d<距离>_none.jpg（刷怪之前，量颜色用）。27 米是游戏镜头，14 米是近镜头
// 环境变量 PITCH（俯角，度；不写是游戏镜头的）、YAW（镜头转角，度）、LOOKY（看向的点离地多高）：拍近一点、低一点的“对着设定图看”的镜头用
// 营地的位置是固定的（sim.ts 按地图布局摆），这里写死：取离我方近的那一个（Boss 只有一个）
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const out = process.argv[2]; const mobs = (process.argv[3] || "wolf,boar,toad,beast").split(","), dists = (process.argv[4] || "27,14").split(","); fs.mkdirSync(out, { recursive: true });
const base = process.env.MOBA_URL || "http://localhost:5236/map.html";
const CAMP = { wolf: [-54.4, -26.2], boar: [1.4, -43.8], toad: [-43.8, 1.4], beast: [32.5, 32.5] };
const lane = (x, z) => [((x - z) / Math.SQRT2).toFixed(2), ((x + z) / Math.SQRT2).toFixed(2)];
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 600000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1600,900"] });
const errors = [];
try {
  for (const mob of mobs) for (const dist of dists) {
    const page = await browser.newPage(); await page.setViewport({ width: 1600, height: 900 });
    page.on("pageerror", e => errors.push(String(e).slice(0, 300))); page.on("console", m => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
    const [u, v] = lane(...CAMP[mob]);
    await page.goto(base + `?h=gorran&nohud=1&nofog=1&cam=${u},${v},${dist},${process.env.PITCH || 0},${process.env.LOOKY || 0.6},${process.env.YAW || 0}` + (process.env.Q ? "&" + process.env.Q : ""), { waitUntil: "load" });
    await page.waitForFunction("window.__ready === true && window.__sim && window.__play", { timeout: 90000 });
    const ev = s => page.evaluate(s), sleep = ms => new Promise(r => setTimeout(r, ms));
    // 英雄先站到营地旁边最后要站的位置，拍一张“没有怪”的（量颜色时和有怪的那张相减，差出来的像素当作怪；英雄两张里站在同一处，减掉了），再刷营地
    const info = await ev(`(() => { const h = __sim.hero; window.__keep = setInterval(() => { h.hp = h.max; }, 100);
      const cs = __sim.camps.filter(c => c.mob === "${mob}"); cs.sort((a, b) => Math.hypot(a.x - ${CAMP[mob][0]}, a.z - ${CAMP[mob][1]}) - Math.hypot(b.x - ${CAMP[mob][0]}, b.z - ${CAMP[mob][1]})); const c = cs[0];
      window.__c = c; const a = __play.actor; let x = c.x + c.fx * 6 + c.fz * 4, z = c.z + c.fz * 6 - c.fx * 4; if (!__nav.walkable(x, z)) [x, z] = __nav.nearest(x, z); a.stop(); a.teleport(x, z);
      return { camp: [+c.x.toFixed(1), +c.z.toFixed(1)], hero: [+x.toFixed(1), +z.toFixed(1)] }; })()`);
    await sleep(1500); await page.screenshot({ path: `${out}/${mob}_d${dist}_none.jpg`, type: "jpeg", quality: 90 });
    info.n = await ev("(() => { if (!__c.up) __sim.spawnCamp(__c); return __c.mobs.length; })()");
    console.log(mob, dist, JSON.stringify(info));
    await sleep(1800); await page.screenshot({ path: `${out}/${mob}_d${dist}.jpg`, type: "jpeg", quality: 90 });
    await ev("__play.attack(__c.mobs.find(m => m.alive)); 1"); await sleep(1400); await page.screenshot({ path: `${out}/${mob}_d${dist}_fight.jpg`, type: "jpeg", quality: 90 });
    await page.close();
  }
  console.log(JSON.stringify({ errors: errors.slice(0, 6) }));
} finally { await browser.close(); }
