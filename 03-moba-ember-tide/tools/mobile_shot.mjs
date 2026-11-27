// 用法: node tools/mobile_shot.mjs <输出目录> <宽> <高> 名字:"查询串"[:"截图前在页面里跑的 js"] ...
// 按手机横屏的样子截图（触屏、三倍屏）。查询串为空就是主菜单。js 可以是 async 的表达式。地址由 MOBA_URL 指定（默认 5183 的 map.html）。
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const [out, w, h, ...jobs] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const base = process.env.MOBA_URL || "http://localhost:5183/map.html", dpr = +(process.env.DPR || 3);
for (const job of jobs) {
  const i = job.indexOf(":"), name = job.slice(0, i), rest = job.slice(i + 1), j = rest.indexOf(":"), q = j < 0 ? rest : rest.slice(0, j), js = j < 0 ? "" : rest.slice(j + 1);
  for (let tryN = 0; tryN < 3; tryN++) {
    const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 300000,
      args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", `--window-size=${w},${h}`] });
    let ok = false;
    try {
      const page = await browser.newPage(); await page.setViewport({ width: +w, height: +h, deviceScaleFactor: dpr, isMobile: true, hasTouch: true, isLandscape: +w > +h });
      await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1");
      const errors = []; page.on("pageerror", e => errors.push(String(e).slice(0, 200))); page.on("console", m => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
      await page.goto(base + (q ? "?" + q : ""), { waitUntil: "load" }); await page.waitForFunction("window.__ready === true", { timeout: 120000 });
      await new Promise(r => setTimeout(r, 1200));
      let res; if (js) res = await page.evaluate(`(async () => { ${js} })()`);
      await new Promise(r => setTimeout(r, 700));
      await page.screenshot({ path: `${out}/${name}.jpg`, type: "jpeg", quality: 88 });
      ok = !errors.some(e => /Shader Error|VALIDATE_STATUS/.test(e));
      console.log(name, ok ? "好了" : "着色器没编过，重来", res !== undefined ? JSON.stringify(res) : "", errors.length ? errors.slice(0, 3) : "");
    } catch (e) { console.log(name, "出错", String(e).slice(0, 200)); } finally { await browser.close(); }
    if (ok) break;
  }
}
