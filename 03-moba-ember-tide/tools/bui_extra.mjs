// 用法: MOBA_URL=http://localhost:5227/map.html node tools/bui_extra.mjs <输出目录>
// 换画风 B（b-ui）补拍 match5_shots / ui2_hud 没拍到的几屏：首页的设置弹层（电脑）、手机首页的设置弹层、手机竖着拿时的“请横过来”。改前改后跑同一个脚本对着看。
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const [out] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const base = process.env.MOBA_URL || "http://localhost:5227/map.html", sleep = ms => new Promise(r => setTimeout(r, ms));
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 300000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1920,1080"] });
const errors = [];
try {
  const shoot = async (name, w, h, touch, q, act) => {
    const page = await browser.newPage(); page.on("pageerror", e => errors.push(String(e).slice(0, 200)));
    await page.setViewport({ width: w, height: h, deviceScaleFactor: touch ? 2 : 1, isMobile: touch, hasTouch: touch, isLandscape: w > h }); if (touch) await page.setUserAgent(UA);
    await page.goto(base + (q ? "?" + q : ""), { waitUntil: "load" }); await page.waitForFunction("window.__ready === true", { timeout: 120000 }).catch(() => {}); await sleep(2500);
    if (act) { await page.evaluate(act); await sleep(700); }
    await page.screenshot({ path: `${out}/${name}.jpg`, type: "jpeg", quality: 90 }); await page.close();
  };
  await shoot("settings_pc", 1920, 1080, false, "", `document.querySelector('.lob-home [data-a=set]').click()`);
  await shoot("settings_phone", 844, 390, true, "touch=1", `document.querySelector('.lob-home [data-a=set]').click()`);
  await shoot("rotate_phone", 390, 844, true, "touch=1", `document.querySelector('.rot')?.classList.add('force')`);
} catch (e) { console.log("出错", String(e).slice(0, 300)); } finally { await browser.close(); }
console.log(JSON.stringify({ out, errors: errors.slice(0, 6) }));
