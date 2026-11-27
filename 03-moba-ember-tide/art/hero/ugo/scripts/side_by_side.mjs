// 测试场里把乌戈（借薇萝的技能，换成乌戈的模型）挪到对面小兵和对面假人英雄旁边，近景、正常镜头各截几张，看个头。
// 也可以连拍一个技能的近景：加第 4 个参数（A、Q、W、E、R）和张数、间隔。
// 用法: node art/hero/ugo/scripts/side_by_side.mjs <输出目录> "<额外地址参数>" [镜头距离列表=14,27] [技能键] [张数=8] [间隔毫秒=120]
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const [out, q = "", dists = "14,27", key = "", n = "8", gap = "120"] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const base = process.env.MOBA_URL || "http://localhost:5190/map.html";
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 600000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1500,844"] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  for (const d of dists.split(",")) {
    const page = await browser.newPage(); await page.setViewport({ width: 1500, height: 844 }); const errors = [];
    page.on("pageerror", e => errors.push(String(e).slice(0, 200)));
    await page.goto(`${base}?arena=1&h=vero&nofog=1&dist=${d}&${q}`, { waitUntil: "load" });
    await page.waitForFunction("window.__ready === true && window.__arena", { timeout: 90000 }); await sleep(1200);
    const info = await page.evaluate(`(() => { const A = __arena, a = __play.actor, f = A.foes, d = A.dummy;
      const cx = f.reduce((s, e) => s + e.x, 0) / f.length, cz = f.reduce((s, e) => s + e.z, 0) / f.length;
      let px = cx - 3.2, pz = cz + 1.0; if (!__nav.walkable(px, pz)) [px, pz] = __nav.nearest(px, pz); a.teleport(px, pz); a.stop();
      return { foes: f.map(e => [+e.x.toFixed(1), +e.z.toFixed(1)]), dummy: d ? [+d.x.toFixed(1), +d.z.toFixed(1), d.h?.id ?? d.hero ?? ''] : null, me: [+px.toFixed(1), +pz.toFixed(1)] }; })()`);
    await sleep(1500);
    await page.screenshot({ path: `${out}/stand_d${d}.jpg`, type: "jpeg", quality: 90 });
    if (key) {
      await page.evaluate(`(() => { const A = __arena, a = __play.actor, f = A.foes; for (const k of ['Q','W','E','R']) a.setCd(k, 0);
        const cx = f.reduce((s, e) => s + e.x, 0) / f.length, cz = f.reduce((s, e) => s + e.z, 0) / f.length;
        if (${JSON.stringify(key)} === "A") __play.attack(f[0]); else __play.cast(${JSON.stringify(key)}, cx, cz, null); })()`);
      for (let i = 0; i < +n; i++) { await page.screenshot({ path: `${out}/${key}_d${d}_${String(i).padStart(2, "0")}.jpg`, type: "jpeg", quality: 88 }); await sleep(+gap); }
    }
    console.log(JSON.stringify({ dist: d, ...info, errors: errors.slice(0, 3), fps: await page.evaluate("Math.round(__stats.fps)") }));
    await page.close();
  }
} finally { await browser.close(); }
