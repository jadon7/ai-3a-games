// 个头对比（第九轮 k-kaz）：开一局（卡兹和岚在同一队，岚放在辅助位），等第一波兵出来，把两个小兵、卡兹、岚、托尔格沿着画面的横向站成一排，停住截图。
// 用法: MOBA_URL=... node tools/kaz_size.mjs <输出.jpg> [宽=1600] [高=900]
import puppeteer from "puppeteer-core";
const [out, w = "1600", h = "900"] = process.argv.slice(2), base = process.env.MOBA_URL;
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 300000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", `--window-size=${w},${h}`] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  const page = await browser.newPage(); await page.setViewport({ width: +w, height: +h });
  await page.goto(base + "?h=kaz&a=torg,kaz,osen,vero,lan&b=gorran,lan,osen,vero,moko&nohud=1&nofog=1&speed=6", { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true", { timeout: 120000 });
  await page.waitForFunction("__sim.time > 21", { timeout: 120000, polling: 200 });
  const info = await page.evaluate(`(() => { __setSpeed(0); const mins = __sim.ents.filter(e => e.alive && e.team === 0 && (e.kind === "melee" || e.kind === "ranged") && e.lane === 0); mins.sort((p, q) => q.s - p.s);
    const m = mins[0]; if (!m) return "没有兵"; const H = id => [...__actors.values()].find(a => a.ent.team === 0 && a.kit.id === id);
    // 画面的横向在地上是哪个方向：投两个点求出来，再把几个单位沿着它站成一排（左到右：近战兵、远程兵、卡兹、岚、托尔格），都面朝镜头偏右
    const [x0, y0] = __screen(m.x, m.z, 0), [x1, y1] = __screen(m.x + 1, m.z, 0), [x2, y2] = __screen(m.x, m.z + 1, 0), a = x1 - x0, b = x2 - x0, c = y1 - y0, d = y2 - y0, det = a * d - b * c;
    let rx = d / det, rz = -c / det; const l = Math.hypot(rx, rz); rx /= l; rz /= l; let dx = -b / det, dz = a / det; const l2 = Math.hypot(dx, dz); dx /= l2; dz /= l2;      // (rx,rz)：画面往右；(dx,dz)：画面往下（朝镜头）
    const cx = m.x, cz = m.z, row = [["melee", -6.2], ["ranged", -4.6], ["kaz", -1.6], ["lan", 2.0], ["torg", 5.6]];
    const mm = { melee: mins.find(e => e.kind === "melee"), ranged: mins.find(e => e.kind === "ranged") };
    for (const e of mins) if (e !== mm.melee && e !== mm.ranged) { e.x += 40; }
    for (const h of __actors.values()) if (!["kaz", "lan", "torg"].includes(h.kit.id) || h.ent.team !== 0) h.teleport(h.ent.x + 60, h.ent.z);      // 别的英雄挪出画面
    for (const [id, off] of row) { const x = cx + rx * off, z = cz + rz * off; if (mm[id]) { mm[id].x = x; mm[id].z = z; mm[id].yaw = Math.atan2(dx + rx * 0.6, dz + rz * 0.6); } else { const h = H(id); h.teleport(x, z); h.face(x + dx + rx * 0.8, z + dz + rz * 0.8, true); } }
    return { kazR: H("kaz").ent.r, lanR: H("lan").ent.r, torgR: H("torg").ent.r }; })()`);
  console.log(JSON.stringify(info));
  await page.evaluate("__setSpeed(0.0001)"); await sleep(1200);
  await page.screenshot({ path: out, type: "jpeg", quality: 90 });
} finally { await browser.close(); }
