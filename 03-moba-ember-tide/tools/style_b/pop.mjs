#!/usr/bin/env node
// 给 pop.py（同目录）拍一对图：同一个页面、同一帧，先拍“只有英雄”（脚下的圈、影子、血条都关掉，免得混进英雄的像素），再把英雄藏起来拍一张地面。
// 用法: MOBA_URL=… node tools/style_b/pop.mjs <输出前缀> "<网址参数>"     产出 <前缀>_hero.jpg、<前缀>_none.jpg
import puppeteer from "puppeteer-core";
const [out, q] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1920,1080"] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1920, height: 1080 });
  await page.goto((process.env.MOBA_URL || "http://localhost:5226/map.html") + "?" + q, { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true", { timeout: 90000 }); await new Promise(r => setTimeout(r, 2500));
  await page.evaluate(() => { const hs = []; __scene.traverse(o => { if (o.name === "hero" && o.isGroup) hs.push(o); }); window.__hs = hs;
    for (const g of hs) { g.children.forEach((c, i) => { if (i > 0) c.scale.setScalar(1e-4); });      /* 圈和血条每帧会被 update() 设回可见，所以缩成一个点 */ g.traverse(o => { if (o.isMesh) o.castShadow = false; }); }
    window.__setSpeed?.(0); });
  await new Promise(r => setTimeout(r, 400));
  await page.screenshot({ path: `${out}_hero.jpg`, type: "jpeg", quality: 95 });
  await page.evaluate(() => { for (const g of window.__hs) g.visible = false; });
  await new Promise(r => setTimeout(r, 300));
  await page.screenshot({ path: `${out}_none.jpg`, type: "jpeg", quality: 95 });
  console.log(out, await page.evaluate(() => window.__hs.length));
} finally { await browser.close(); }
