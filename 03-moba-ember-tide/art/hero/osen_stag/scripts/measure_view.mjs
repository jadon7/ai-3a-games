// 在查看页里量一下模型实际被放大了多少：头骨、根骨、蹄子的世界高度。用法: node measure_view.mjs <身高参数>
import puppeteer from "/Users/jadon7/Documents/SynologyDrive/code/moba/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js";
const h = process.argv[2] || "3.4";
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--window-size=420,420"] });
try {
  const page = await browser.newPage(); await page.goto(`http://localhost:5183/viewer.html?model=/assets/hero/stag.glb&height=${h}&ui=0&t=0&a=idle_pose`, { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true", { timeout: 60000 });
  const r = await page.evaluate(`(() => { const m = window.__model; m.updateMatrixWorld(true); const out = { scale: m.scale.x, bones: {} };
    m.traverse(o => { if (o.isBone) out.bones[o.name] = o.matrixWorld.elements.slice(12, 15).map(v => +v.toFixed(3)); }); return out; })()`);
  console.log(JSON.stringify(r));
} finally { await browser.close(); }
