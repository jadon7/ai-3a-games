// 用法: node tools/look_shots.mjs <输出目录> "<查询串>" <秒,秒,秒> [宽=1920] [高=1080] [快进倍数=8]
// 开一局，快进到对局时间的这几个时刻各截一张图（截之前先回到正常速度站一秒，动作是正常的样子）。对着参考图看画面用。
// 地址由 MOBA_URL 指定（默认 5190 那个不会自己刷新的测试服务器）。
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const [out, query, times, w = "1920", h = "1080", sp = "8"] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const base = process.env.MOBA_URL || "http://localhost:5190/map.html";
for (let tryN = 0; tryN < 3; tryN++) {
  const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 600000,
    args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", `--window-size=${w},${h}`] });
  let ok = true;
  try {
    const page = await browser.newPage(); await page.setViewport({ width: +w, height: +h }); const errors = [];
    page.on("pageerror", e => errors.push(String(e).slice(0, 200))); page.on("console", m => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
    await page.goto(base + "?" + query, { waitUntil: "load" }); await page.waitForFunction("window.__ready === true", { timeout: 180000 });
    for (const t of times.split(",").map(Number)) {
      await page.evaluate(`__setSpeed(${sp})`); await page.waitForFunction(`__sim.time >= ${t} || __sim.over`, { timeout: 600000, polling: 200 });
      await page.evaluate("__setSpeed(1)"); await new Promise(r => setTimeout(r, 1100));
      await page.screenshot({ path: `${out}/t${t}.jpg`, type: "jpeg", quality: 90 }); console.log("截了", t, "秒", JSON.stringify(await page.evaluate("({ fps: Math.round(__stats.fps), kills: __sim.kills })")));
    }
    if (errors.some(e => /Shader Error|VALIDATE_STATUS/.test(e))) { ok = false; console.log("着色器没编过，重来"); } else if (errors.length) console.log("报错", errors.slice(0, 3));
  } catch (e) { console.log("出错", String(e).slice(0, 200)); ok = false; } finally { await browser.close(); }
  if (ok) break;
}
