// 用法: node tools/net_probe.mjs "<完整网址>" [mobile]
// 量一次进游戏到底下载了什么：每个目录多少个文件、多少字节，到 __ready 用了多久。阶段 8 压缩资源前后各跑一次对比。
import puppeteer from "puppeteer-core";
const url = process.argv[2], mobile = process.argv[3] === "mobile";
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 300000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1280,720", "--disk-cache-size=1"] });
try {
  const page = await browser.newPage();
  if (mobile) await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 3, isMobile: true, hasTouch: true, isLandscape: true }); else await page.setViewport({ width: 1280, height: 720 });
  await page.setCacheEnabled(false);
  const files = []; const errors = [];
  page.on("pageerror", e => errors.push(String(e).slice(0, 200))); page.on("console", m => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
  page.on("response", async r => { try { const u = new URL(r.url()); if (u.protocol === "data:" || u.protocol === "blob:") return; const b = await r.buffer().catch(() => null); files.push([u.pathname, b ? b.length : 0, +(r.headers()["content-length"] || 0)]); } catch {} });
  const t0 = Date.now(); await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true", { timeout: 120000 }).catch(() => errors.push("没等到 __ready"));
  const ready = Date.now() - t0; await new Promise(r => setTimeout(r, 2500));
  const by = {}; let total = 0;
  for (const [p, n] of files) { const k = p.startsWith("/assets/") ? p.split("/").slice(0, 3).join("/") : p.startsWith("/src/") || p.startsWith("/node_modules/") || p.startsWith("/@") ? "(代码)" : p.split("/").slice(0, 2).join("/"); (by[k] ??= [0, 0]); by[k][0]++; by[k][1] += n; total += n; }
  console.log("到 __ready:", (ready / 1000).toFixed(1), "秒；请求", files.length, "个；共", (total / 1e6).toFixed(1), "MB");
  for (const [k, v] of Object.entries(by).sort((a, b) => b[1][1] - a[1][1])) console.log("  " + k.padEnd(22), String(v[0]).padStart(4), "个", (v[1] / 1e6).toFixed(2).padStart(7), "MB");
  console.log("最大的 14 个:"); for (const [p, n] of files.sort((a, b) => b[1] - a[1]).slice(0, 14)) console.log("  " + (n / 1e6).toFixed(2).padStart(6), "MB", p);
  if (errors.length) console.log("报错:", errors.slice(0, 5));
} finally { await browser.close(); }
