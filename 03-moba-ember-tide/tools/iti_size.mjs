// 个头对比（第四阶段 iti-kit，照 k-kaz 的 kaz_size.mjs 改）：开一局，等第一波兵出来，把两个小兵、伊缇、岚、两个老中单（乌戈、奥森）沿着画面的横向站成一排，停住截图。乌戈、奥森放在伊缇这一队（上单、辅助的格子）：对面的英雄停住以后视野不重算，挪过来也画不出来
// 第二个参数是额外的网址参数（比如 look=lift:1.5 试提亮；dist=15 拉近）
// 用法: MOBA_URL=... node tools/iti_size.mjs <输出.jpg> [额外参数] [宽=1600] [高=900]
import puppeteer from "puppeteer-core";
const [out, extra = "", w = "1600", h = "900"] = process.argv.slice(2), base = process.env.MOBA_URL;
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 300000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", `--window-size=${w},${h}`] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  const page = await browser.newPage(); await page.setViewport({ width: +w, height: +h });
  await page.goto(base + "?h=iti&a=ugo,lan,iti,vero,osen&b=gorran,kaz,torg,seren,moko&nohud=1&nofog=1&speed=6" + (extra ? "&" + extra : ""), { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true", { timeout: 120000 });
  await page.waitForFunction("__sim.time > 21", { timeout: 120000, polling: 200 });
  const info = await page.evaluate(`(() => { __setSpeed(0); const mins = __sim.ents.filter(e => e.alive && e.team === 0 && (e.kind === "melee" || e.kind === "ranged") && e.lane === 0); mins.sort((p, q) => q.s - p.s);
    const m = mins[0]; if (!m) return "没有兵"; const H = id => [...__actors.values()].find(a => a.kit.id === id);
    // 画面的横向在地上是哪个方向：投两个点求出来，再把几个单位沿着它站成一排（左到右：近战兵、远程兵、卡兹、岚、托尔格），都面朝镜头偏右
    const [x0, y0] = __screen(m.x, m.z, 0), [x1, y1] = __screen(m.x + 1, m.z, 0), [x2, y2] = __screen(m.x, m.z + 1, 0), a = x1 - x0, b = x2 - x0, c = y1 - y0, d = y2 - y0, det = a * d - b * c;
    let rx = d / det, rz = -c / det; const l = Math.hypot(rx, rz); rx /= l; rz /= l; let dx = -b / det, dz = a / det; const l2 = Math.hypot(dx, dz); dx /= l2; dz /= l2;      // (rx,rz)：画面往右；(dx,dz)：画面往下（朝镜头）
    const cx = m.x, cz = m.z, row = [["melee", -7.6], ["ranged", -5.6], ["iti", -2.6], ["lan", 0.8], ["ugo", 4.2], ["osen", 8.0]];
    const mm = { melee: mins.find(e => e.kind === "melee"), ranged: mins.find(e => e.kind === "ranged") };
    for (const e of mins) if (e !== mm.melee && e !== mm.ranged) { e.x += 40; }
    for (const h of __actors.values()) if (!["iti", "lan", "ugo", "osen"].includes(h.kit.id)) h.teleport(h.ent.x + 60, h.ent.z);      // 别的英雄挪出画面
    for (const [id, off] of row) { const x = cx + rx * off, z = cz + rz * off; if (mm[id]) { mm[id].x = x; mm[id].z = z; mm[id].yaw = Math.atan2(dx + rx * 0.6, dz + rz * 0.6); } else { const h = H(id); h.teleport(x, z); h.face(x + dx + rx * 0.8, z + dz + rz * 0.8, true); } }
    return { iti: H("iti").kit.height, lan: H("lan").kit.height, ugo: H("ugo").kit.height, osen: H("osen").kit.height }; })()`);
  console.log(JSON.stringify(info));
  await page.evaluate("__setSpeed(0.0001)"); await sleep(1200);
  await page.screenshot({ path: out, type: "jpeg", quality: 90 });
} finally { await browser.close(); }
