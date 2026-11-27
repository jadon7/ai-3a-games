#!/usr/bin/env node
// 换画风 B · b-walls：证明“挡路的范围一点没变”。开一局（只有自己、没有电脑），读出游戏真正在用的寻路网格，
// 把 0.5 米一格的每一格能不能走拼成一串、算一个指纹；同时记下被挡住的格数、几处固定点之间寻路的路程，
// 以及画面上那些会变成障碍的东西（墙头石头和墩柱、倒木、树桩）的位置和半径。改前改后各跑一次，两份 JSON 应该一模一样。
// 用法: MOBA_URL=http://localhost:5222/map.html node tools/bwalls_navhash.mjs <输出.json>
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const [out] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 600000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=960,540"] });
let R;
try {
  const page = await browser.newPage(); await page.setViewport({ width: 960, height: 540 });
  const errors = []; page.on("pageerror", e => errors.push(String(e).slice(0, 300)));
  await page.goto((process.env.MOBA_URL || "http://localhost:5222/map.html") + "?solo=1&h=lan&nofog=1&nohud=1&q=lite", { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true && window.__nav", { timeout: 180000 });
  await page.evaluate("__setSpeed(0)");
  R = await page.evaluate(() => {
    const N = window.__nav, CELL = 0.5, R0 = 81, n = Math.round((R0 * 2) / CELL) + 1;
    let h1 = 2166136261 >>> 0, h2 = 0, walk = 0; const rows = [];
    for (let j = 0; j < n; j++) { let row = ""; for (let i = 0; i < n; i++) { const w = N.walkable(i * CELL - R0, j * CELL - R0) ? 1 : 0; walk += w; row += w; h1 = Math.imul(h1 ^ w, 16777619) >>> 0; h2 = (h2 * 31 + w * (i + 1) * (j + 7)) % 1000000007; } rows.push(row); }
    const SQ = Math.SQRT2, W = (u, v) => [(u + v) / SQ, (v - u) / SQ];
    const plen = (a, b) => { const [ax, az] = W(...a), [bx, bz] = W(...b), p = N.path(ax, az, bx, bz); let l = 0, px = ax, pz = az; for (const [x, z] of p) { l += Math.hypot(x - px, z - pz); px = x; pz = z; } return Math.round(l * 100) / 100; };
    // 绕墙的几条路：营地进出口、草丛背后、Boss 坑、口子
    const routes = [[[-20, 0], [-32, 36]], [[20, 0], [32, 36]], [[-20, 0], [-32, -36]], [[20, 0], [32, -36]], [[-8, 4], [-14, 30]], [[8, 4], [14, 30]], [[-5, 30], [0, 46]], [[5, 30], [0, 46]], [[-55, 30], [-54, 19]], [[55, 30], [54, 19]], [[-40, 0], [-70, 0]], [[40, 0], [70, 0]], [[-30, 60], [-20, 57]], [[30, 60], [20, 57]], [[-60, -10], [-30, -25]], [[60, -10], [30, -25]]];
    const veg = window.__veg, wc = window.__scene?.getObjectByName("walls")?.userData?.contact ?? { circles: [], lines: [] };
    return { cells: n * n, walkable: walk, blockedCells: N.blockedCells, fnv: h1.toString(16), poly: h2, routes: routes.map(([a, b]) => ({ a, b, len: plen(a, b) })),
      veg: { circles: veg.circles.map(c => [+c.x.toFixed(3), +c.z.toFixed(3), +c.r.toFixed(3)]), lines: veg.lines.map(l => [l.pts.map(p => p.map(v => +v.toFixed(3))), +l.w.toFixed(3)]) },
      walls: { circles: wc.circles.map(c => [+c.x.toFixed(4), +c.z.toFixed(4), +c.r.toFixed(4)]), lineCount: wc.lines.length, lineHash: wc.lines.reduce((s, l) => s + l.reduce((t, p) => t + p[0] * 1.3 + p[1] * 0.7, 0), 0).toFixed(4) }, rows };
  });
  R.errors = errors;
} finally { await browser.close(); }
const rows = R.rows; delete R.rows;
fs.writeFileSync(out, JSON.stringify(R, null, 1)); fs.writeFileSync(out.replace(/\.json$/, "_grid.txt"), rows.join("\n"));
console.log(JSON.stringify({ cells: R.cells, walkable: R.walkable, blockedCells: R.blockedCells, fnv: R.fnv, poly: R.poly, routes: R.routes.map(r => r.len).join(" "), veg: [R.veg.circles.length, R.veg.lines.length], wallCircles: R.walls.circles.length, wallLines: R.walls.lineCount, errors: R.errors }));
