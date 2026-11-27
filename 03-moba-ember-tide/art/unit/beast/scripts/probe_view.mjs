#!/usr/bin/env node
// 在查看页里把一段动作按时间均匀定格 n 次，记几根骨骼的世界位置（米），用来量：走路时落地脚往后走多快（runSpeed）、攻击里前脚哪一刻砸到地。
// 用法: node art/unit/beast/scripts/probe_view.mjs <动作> <采样数> <骨骼名,骨骼名…> [身高=3.3] > 输出.json      （在 MOBA 根目录跑；骨骼名照骨架文件写，标点会自动忽略）
import puppeteer from "puppeteer-core";
const [clip, n = "60", bones = "", height = "3.3"] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--window-size=420,420"] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 420, height: 420 });
  await page.goto(`http://localhost:5183/viewer.html?model=/assets/unit/beast.glb&height=${height}&ui=0&t=0`, { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true", { timeout: 60000 });
  const out = await page.evaluate(async (clip, n, names) => {
    const dur = Object.fromEntries(window.__stats.clips)[clip], key = s => s.replace(/[^A-Za-z0-9]/g, "").toLowerCase(), map = {};
    window.__model.traverse(o => { if (o.isBone) map[key(o.name)] = o; });
    const raf = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))), rows = [];
    for (let i = 0; i <= n; i++) {
      const t = dur * i / n; window.__pose(clip, t); await raf(); const row = { t };
      for (const nm of names) { const b = map[key(nm)]; if (!b) { row[nm] = null; continue; } b.updateWorldMatrix(true, false); const e = b.matrixWorld.elements; row[nm] = [e[12], e[13], e[14]]; }
      rows.push(row);
    }
    return { clip, dur, rows };
  }, clip, +n, bones.split(",").filter(Boolean));
  console.log(JSON.stringify(out));
} finally { await browser.close(); }
