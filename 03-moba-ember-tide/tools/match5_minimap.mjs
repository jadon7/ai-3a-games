// 用法: MOBA_URL=http://localhost:5207/map.html node tools/match5_minimap.mjs <输出目录> "<网址参数>" [时刻(秒),逗号分开=90,180,300,420,540]
// 第九轮 match5：开一局全电脑的 5v5（带界面），16 倍速跑，到每个时刻停下来把小地图截下来（三倍屏，放大了也看得清；全图都揭开，对面的人也画上），
// 同时记下每个英雄在哪、在干什么。窗口按 1920×1080 开：1280 宽的时候底下英雄栏的等级章会压到小地图的右下角。看五个位置是不是各干各的：上单在上路、中单在中路、射手和辅助一起在下路、打野在野区。
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const [out, q = "h=lan&seed=4", ts = "90,180,300,420,540"] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 900000, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1920,1080"] });
const R = { q, at: [], errors: [] };
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 3 });
  page.on("pageerror", e => R.errors.push(String(e).slice(0, 200))); page.on("console", m => { if (m.type() === "error") R.errors.push(m.text().slice(0, 160)); });
  await page.goto((process.env.MOBA_URL || "http://localhost:5207/map.html") + "?" + q + "&auto=1", { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true && window.__sim", { timeout: 120000 });
  await page.evaluate("__sim.reveal = true");      // 小地图上把对面的人也画出来（不看视野）
  for (const t of ts.split(",").map(Number)) {
    await page.evaluate("__setSpeed(16)"); await page.waitForFunction(`__sim.time >= ${t} || __sim.over`, { timeout: 600000, polling: 100 }); await page.evaluate("__setSpeed(0)"); await new Promise(r => setTimeout(r, 450));
    const mm = await page.evaluate(`(() => { const r = document.querySelector(".hud-map").getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; })()`);
    const name = `minimap_${String(Math.floor(t / 60)).padStart(2, "0")}m${String(t % 60).padStart(2, "0")}`; await page.screenshot({ path: `${out}/${name}.png`, clip: mm });
    R.at.push({ t, shot: name, heroes: await page.evaluate(`__sim.heroes().sort((p, q) => p.team - q.team).map(e => { const b = __bots.find(x => x.ent === e); return (e.team ? "红" : "绿") + " " + e.h.pos + " " + e.h.kit + " L" + e.h.level + " [" + (b ? b.doing() : "玩家") + "]"; })`) });
  }
} finally { await browser.close(); }
fs.writeFileSync(`${out}/minimap.json`, JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1));
