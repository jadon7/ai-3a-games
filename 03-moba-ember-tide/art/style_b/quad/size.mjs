// 个头对比（w-quad，照 tools/kaz_size.mjs 改）：开一局，等第一波兵出来，把近战兵、远程兵和几个英雄沿着画面横向站成一排，停住截图。
// 自己的英雄（h=）可以用 glb= 换模型、look= 调身高，所以“旧 / 新”各截一张同样站位的比。
// 用法: MOBA_URL=... node art/style_b/quad/size.mjs <输出.jpg> <自己的英雄> "<额外网址参数>" [排在一起的英雄，逗号隔开，自己放第一个] [宽=1600] [高=900]
import puppeteer from "puppeteer-core";
const [out, me, extra = "", ids = "", w = "1600", h = "900"] = process.argv.slice(2), base = process.env.MOBA_URL;
const row = (ids || `${me},lan`).split(",");      // 只能排我方这五个里的：torg kaz osen vero lan（照 kaz_size.mjs 的阵容，换了阵容第一波兵出来时人不在一处）
const a = ["torg", "kaz", "osen", "vero", "lan"];
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 300000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", `--window-size=${w},${h}`] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  const page = await browser.newPage(); await page.setViewport({ width: +w, height: +h });
  await page.goto(base + `?h=${me}&a=${a.join(",")}&b=gorran,lan,osen,vero,moko&nohud=1&nofog=1&speed=6&${extra}`, { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true", { timeout: 120000 });
  await page.waitForFunction("__sim.time > 21", { timeout: 120000, polling: 200 });
  const info = await page.evaluate(`(() => { __setSpeed(0); const mins = __sim.ents.filter(e => e.alive && e.team === 0 && (e.kind === "melee" || e.kind === "ranged") && e.lane === 0); mins.sort((p, q) => q.s - p.s);
    const m = mins[0]; if (!m) return "没有兵"; const H = id => [...__actors.values()].find(a => a.ent.team === 0 && a.kit.id === id);
    const [x0, y0] = __screen(m.x, m.z, 0), [x1, y1] = __screen(m.x + 1, m.z, 0), [x2, y2] = __screen(m.x, m.z + 1, 0), a = x1 - x0, b = x2 - x0, c = y1 - y0, d = y2 - y0, det = a * d - b * c;
    let rx = d / det, rz = -c / det; const l = Math.hypot(rx, rz); rx /= l; rz /= l; let dx = -b / det, dz = a / det; const l2 = Math.hypot(dx, dz); dx /= l2; dz /= l2;
    const ids = ${JSON.stringify(row)}, row = [["melee", -6.2], ["ranged", -4.6], ...ids.map((id, i) => [id, -1.4 + i * 3.8])];
    const mm = { melee: mins.find(e => e.kind === "melee"), ranged: mins.find(e => e.kind === "ranged") };
    for (const e of mins) if (e !== mm.melee && e !== mm.ranged) { e.x += 40; }
    for (const h of __actors.values()) if (!ids.includes(h.kit.id) || h.ent.team !== 0) h.teleport(h.ent.x + 60, h.ent.z);
    for (const [id, off] of row) { const x = m.x + rx * off, z = m.z + rz * off; if (mm[id]) { mm[id].x = x; mm[id].z = z; mm[id].yaw = Math.atan2(dx + rx * 0.6, dz + rz * 0.6); } else { const h = H(id); if (!h) continue; h.teleport(x, z); h.face(x + dx + rx * 0.8, z + dz + rz * 0.8, true); } }
    return ids.map(id => id + ":" + (H(id)?.ent.r ?? "?")).join(" "); })()`);
  console.log(JSON.stringify(info));
  await page.evaluate("__setSpeed(0.0001)"); await sleep(1200);
  await page.screenshot({ path: out, type: "jpeg", quality: 90 });
} finally { await browser.close(); }
