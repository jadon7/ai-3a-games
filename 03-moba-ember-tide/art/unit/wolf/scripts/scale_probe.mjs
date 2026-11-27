#!/usr/bin/env node
// 量测试场里借英雄位置放进去的模型实际放大了几倍（骨骼的世界缩放），核对 runSpeed 的换算。用法: MOBA_Q="glb=../unit/wolf&look=height:1.45" node scale_probe.mjs
import puppeteer from "puppeteer-core";
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 600000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1500,844"] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1500, height: 844 });
  await page.goto(`http://localhost:5183/map.html?arena=1&h=lan` + (process.env.MOBA_Q ? "&" + process.env.MOBA_Q : ""), { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true && window.__arena", { timeout: 90000 });
  await new Promise(r => setTimeout(r, 900));
  const info = await page.evaluate(`(() => { const a = __play.actor, b = a.hero.bone("tripo::Root"), V = b.position.constructor; const s = b.getWorldScale(new V());
    const pts = {}; for (const n of ["tripo::Head_2", "tripo::0_Left_Limb_3", "bone_28", "tripo::Root"]) { const o = a.hero.bone(n); if (o) { const w = o.getWorldPosition(new V()); pts[n] = [+(w.x - a.pos.x).toFixed(3), +(w.y - a.pos.y).toFixed(3), +(w.z - a.pos.z).toFixed(3)]; } }
    return { scale: [s.x, s.y, s.z].map(x => +x.toFixed(4)), clip: a.hero.current, pts, meta: a.meta }; })()`);
  console.log(JSON.stringify(info));
} finally { await browser.close(); }
