#!/usr/bin/env node
// 从成品里量时间表要的几个时刻（每秒 60 次取样，模型按 6 米放）：
//   attack1：右手离胯最远（拳头打直）的时刻、右手速度最大的时刻、开始往前出拳的时刻
//   attack2：双手开始往下砸的时刻、拳头着地的时刻（手骨第一次降到离最低点 10 厘米以内）
//   roar：双手张到最开的时刻（两手距离到最大值的 95%）、头仰到最高的时刻
// 用法: node art/unit/troll/timing_check.mjs
import puppeteer from "puppeteer-core";
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 600000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--window-size=400,400"] });
const page = await browser.newPage(); await page.setViewport({ width: 400, height: 400 });
await page.goto("http://localhost:5183/viewer.html?model=/assets/unit/troll.glb&height=6&ui=0&t=0", { waitUntil: "load" });
await page.waitForFunction("window.__ready === true", { timeout: 60000 });
const res = await page.evaluate(async () => {
  const model = window.__model, B = {}; model.traverse(o => { if (o.isBone) B[o.name.replace(/^mixamorig:?/, "")] = o; });
  const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))), wp = n => { const p = B[n].getWorldPosition(new B[n].position.constructor()); return [p.x, p.y, p.z]; };
  const clips = Object.fromEntries(window.__stats.clips), S = {};
  for (const a of ["attack1", "attack2", "roar"]) { const dur = clips[a], rows = []; for (let k = 0; k <= Math.round(dur * 60); k++) { const t = Math.min(k / 60, dur - 1e-3); window.__pose(a, t); await frame(); rows.push({ t, R: wp("RightHandMiddle1"), L: wp("LeftHandMiddle1"), H: wp("Hips"), Hd: wp("HeadTop_End") }); } S[a] = rows; }
  const d = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]), dh = (p, q) => Math.hypot(p[0] - q[0], p[2] - q[2]), arg = (arr, f) => arr.reduce((b, r, i) => f(r, i) > f(arr[b], b) ? i : b, 0), out = {};
  { const r = S.attack1, reach = r.map(x => dh(x.R, x.H)), sp = r.map((x, i) => i ? d(x.R, r[i - 1].R) * 60 : 0), iR = arg(r, (_, i) => reach[i]), iS = arg(r, (_, i) => sp[i]); let i0 = iS; while (i0 > 0 && sp[i0] > 0.25 * sp[iS]) i0--; let i95 = 0; while (reach[i95] < 0.97 * reach[iR]) i95++;
    out.attack1 = { 开始出拳: +r[i0].t.toFixed(2), 拳速最大: +r[iS].t.toFixed(2), 最大拳速_米每秒: +sp[iS].toFixed(1), 打到九成七: +r[i95].t.toFixed(2), 伸到最远: +r[iR].t.toFixed(2), 最远离胯_米: +reach[iR].toFixed(2), 时长: clips.attack1 }; }
  { const r = S.attack2, y = r.map(x => Math.min(x.R[1], x.L[1])), lo = Math.min(...y), iTop = arg(r, (_, i) => y[i]); let iHit = iTop; while (y[iHit] > lo + 0.10) iHit++; let iGo = iHit; while (iGo > iTop && y[iGo] < y[iTop] - 0.3) iGo--; let iUp = r.length - 1; while (iUp > iHit && y[iUp] > lo + 0.5) iUp--;
    out.attack2 = { 举到最高: +r[iTop].t.toFixed(2), 最高_米: +y[iTop].toFixed(2), 开始往下砸: +r[iGo].t.toFixed(2), 拳头着地: +r[iHit].t.toFixed(2), 着地时手前伸_米: +dh(r[iHit].R, r[iHit].H).toFixed(2), 拳头离开地面: +r[Math.min(iUp + 1, r.length - 1)].t.toFixed(2), 时长: clips.attack2 }; }
  { const r = S.roar, w = r.map(x => d(x.R, x.L)), mx = Math.max(...w), hd = r.map(x => x.Hd[1]), iLow = arg(r.slice(0, 80), (_, i) => -hd[i]); let iOpen = iLow; while (w[iOpen] < 0.95 * mx) iOpen++; let iClose = r.length - 1; while (w[iClose] < 0.9 * mx) iClose--; let iStart = iLow; while (iStart < r.length - 1 && hd[iStart] < hd[iLow] + 0.25) iStart++;
    out.roar = { 弯腰最低: +r[iLow].t.toFixed(2), 开始挺身: +r[iStart].t.toFixed(2), 双臂张开: +r[iOpen].t.toFixed(2), 头最高: +r[arg(r, (_, i) => hd[i])].t.toFixed(2), 开始收: +r[iClose].t.toFixed(2), 时长: clips.roar }; }
  return out;
});
console.log(JSON.stringify(res, null, 1));
await Promise.race([browser.close(), new Promise(r => setTimeout(r, 3000))]); process.exit(0);
