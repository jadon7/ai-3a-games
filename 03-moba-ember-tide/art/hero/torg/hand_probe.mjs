#!/usr/bin/env node
// 只读地看一眼：测试场里托尔格右手骨骼的缩放是多少、锤在游戏里有多长（钟顶到握点），默认和 look=hand:1 各看一次，并各截一张站着不动的图。
// 用法: node art/hero/torg/hand_probe.mjs <输出目录>      （开发服务器在 5183，不启动、不重启它）
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const out = process.argv[2]; fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 300000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1500,844"] });
try {
  for (const [tag, q] of [["default", ""], ["hand1", "&look=hand:1"]]) {
    const page = await browser.newPage(); await page.setViewport({ width: 1500, height: 844 });
    await page.goto(`http://localhost:5183/map.html?arena=1&h=torg${q}`, { waitUntil: "load" });
    await page.waitForFunction("window.__ready === true && window.__arena", { timeout: 90000 }); await new Promise(r => setTimeout(r, 1500));
    const info = await page.evaluate(`(() => { const a = __play.actor, h = a.hero, rb = h.bone("RightHand"), lb = h.bone("LeftHand"), hd = h.bone("Head");
      const B = new rb.position.constructor(), T = new rb.position.constructor(), W = new rb.position.constructor(); const ok = h.blade("R", B, T); rb.getWorldPosition(W);
      return JSON.stringify({ 右手缩放: rb.scale.x, 左手缩放: lb.scale.x, 头缩放: hd.scale.x, 模型缩放: +h.model.scale.x.toFixed(3), 钟顶离右手腕: ok ? +T.distanceTo(W).toFixed(2) : null, 钟顶高度: ok ? +(T.y - a.pos.y).toFixed(2) : null, 当前动作: h.current, kit高: a.kit.height }); })()`);
    console.log(tag, info);
    await page.screenshot({ path: `${out}/idle_${tag}.jpg`, type: "jpeg", quality: 90 });
    if (tag === "default") {      // 模拟“手放大 1.3 倍真的生效”是什么样：只在这个页面里把动作的缩放通道摘掉（它们会把骨骼的缩放冲回 1），再把两只手设成 1.3。不改任何文件
      await page.evaluate(`(() => { const h = __play.actor.hero; h.mixer.stopAllAction(); for (const c of h.clips.values()) { h.mixer.uncacheClip(c); c.tracks = c.tracks.filter(t => !/\\.scale$/.test(t.name)); } h.current = ""; h.play("idle"); for (const n of ["LeftHand", "RightHand"]) h.bone(n).scale.setScalar(1.3); })()`);
      await new Promise(r => setTimeout(r, 1200));
      console.log("sim13", await page.evaluate(`(() => { const a = __play.actor, h = a.hero, rb = h.bone("RightHand"); const B = new rb.position.constructor(), T = new rb.position.constructor(), W = new rb.position.constructor(); h.blade("R", B, T); rb.getWorldPosition(W); return JSON.stringify({ 右手缩放: rb.scale.x, 钟顶离右手腕: +T.distanceTo(W).toFixed(2), 钟顶高度: +(T.y - a.pos.y).toFixed(2) }); })()`));
      await page.screenshot({ path: `${out}/idle_sim13.jpg`, type: "jpeg", quality: 90 });
    }
    await page.close();
  }
} finally { await browser.close(); }
