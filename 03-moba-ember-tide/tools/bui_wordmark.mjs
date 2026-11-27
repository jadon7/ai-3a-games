// 用法: node tools/bui_wordmark.mjs <输出.webp>
// 换画风 B（b-ui）：重新渲染标题字 “烬与潮”（public/assets/ui/kit/wordmark.webp）。原来那张是黑色粗描边 + 旧铜边（第九轮代码渲染的，脚本没留下），
// B 的规矩是“不要黑色粗描边”，换成深海蓝描边 + 亮金边；“烬”余烬渐变、“潮”潮青渐变、副标 EMBER · AND · TIDE 这些身份照旧，尺寸照旧（1200×527），首页和载入的排版不用动。
// 做法：本机的宋体（Songti SC Black）在无界面 Chrome 里用 SVG 画，透明底截成 PNG，再用 Pillow 转 webp。
import puppeteer from "puppeteer-core";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
const out = process.argv[2]; if (!out) { console.log("用法: node tools/bui_wordmark.mjs <输出.webp>"); process.exit(1); }
const W = 1200, H = 527, png = out.replace(/\.webp$/, "") + ".png";
const glyph = (ch, x, y, size, fill, k = 1) => `
  <text x="${x}" y="${y}" font-size="${size}" stroke="#0b2352" stroke-width="${19 * k}" stroke-linejoin="round" filter="url(#sh)">${ch}</text>
  <text x="${x}" y="${y}" font-size="${size}" stroke="url(#gold)" stroke-width="${10 * k}" stroke-linejoin="round">${ch}</text>
  <text x="${x}" y="${y}" font-size="${size}" stroke="url(#${fill})" stroke-width="${3.4 * k}" stroke-linejoin="round" fill="url(#${fill})">${ch}</text>
  <text x="${x}" y="${y}" font-size="${size}" fill="url(#hi)" style="mix-blend-mode:screen">${ch}</text>`;      /* 一层深蓝描边（带一点投影）、一层亮金边、字本身（同色描一圈加粗一点）、上半截一层白的高光 */
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <linearGradient id="ember" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe08c"/><stop offset=".42" stop-color="#ff9a45"/><stop offset="1" stop-color="#e5532f"/></linearGradient>
  <linearGradient id="tide" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dcfffa"/><stop offset=".45" stop-color="#64e0d6"/><stop offset="1" stop-color="#1c97b0"/></linearGradient>
  <linearGradient id="pearl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#f1dfb4"/></linearGradient>
  <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff4cc"/><stop offset=".45" stop-color="#f3cb6c"/><stop offset="1" stop-color="#c58b2e"/></linearGradient>
  <linearGradient id="hi" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".38"/><stop offset=".34" stop-color="#fff" stop-opacity=".08"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient>
  <linearGradient id="line" x1="0" x2="1"><stop offset="0" stop-color="#f3cb6c" stop-opacity="0"/><stop offset=".22" stop-color="#f3cb6c"/><stop offset=".78" stop-color="#f3cb6c"/><stop offset="1" stop-color="#f3cb6c" stop-opacity="0"/></linearGradient>
  <filter id="sh" x="-10%" y="-10%" width="120%" height="125%"><feDropShadow dx="0" dy="5" stdDeviation="6" flood-color="#06163a" flood-opacity=".45"/></filter>
</defs>
<g font-family="Songti SC" font-weight="900" text-anchor="middle" fill="none">
  ${glyph("烬", 260, 356, 362, "ember")}
  ${glyph("与", 600, 300, 138, "pearl", 0.6)}
  ${glyph("潮", 940, 356, 362, "tide")}
</g>
<path d="M100 414H1100" stroke="#0b2352" stroke-opacity=".3" stroke-width="3.6"/><path d="M100 414H1100" stroke="url(#line)" stroke-width="2.4"/>
<circle cx="560" cy="414" r="5" fill="#fff1c4" stroke="#0b2352" stroke-opacity=".7" stroke-width="1.6"/><circle cx="640" cy="414" r="5" fill="#fff1c4" stroke="#0b2352" stroke-opacity=".7" stroke-width="1.6"/>
<path d="M600 395 619 414 600 433 581 414Z" fill="#f3cd72" stroke="#0b2352" stroke-opacity=".85" stroke-width="2"/><path d="M600 402 612 414 600 426Z" fill="#ff9a52"/><path d="M600 402 588 414 600 426Z" fill="#5fdcd2"/><path d="M600 402 605 407 600 412 595 407Z" fill="#fff" fill-opacity=".6"/>
<text x="600" y="492" font-family="Songti SC" font-weight="700" font-size="36" letter-spacing="20" text-anchor="middle" fill="#ffe9b0" stroke="#0b2352" stroke-width="6" stroke-linejoin="round" paint-order="stroke">EMBER · AND · TIDE</text>
</svg>`;
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", args: ["--hide-scrollbars"] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg}</body></html>`, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: png, omitBackground: true, clip: { x: 0, y: 0, width: W, height: H } });
} finally { await browser.close(); }
execFileSync("/opt/homebrew/opt/python@3.14/bin/python3.14", ["-c", `from PIL import Image; Image.open(${JSON.stringify(png)}).save(${JSON.stringify(out)}, "WEBP", quality=92, method=6)`]);
fs.unlinkSync(png); console.log("写好了", out, fs.statSync(out).size, "字节");
