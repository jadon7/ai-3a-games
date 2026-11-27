#!/usr/bin/env node
// 在测试场里让一个英雄跑一段，逐帧记两只脚骨骼的世界位置，量“落地的那只脚在地上滑不滑”，反推跑步动作按原速播时对应的移速（runSpeed 应该填的数）。
// 原理：播放倍率 = 移速 / runSpeed。落地脚在世界里的速度 u = 移速 v − 动作里脚后蹬的速度 s × 倍率；不打滑就是 u = 0，也就是 runSpeed = s。量出 u 就能算出 s = (v − u) × runSpeed / v。
// 用法: node tools/run_probe.mjs <英雄 id> [输出目录]（会顺手连拍几张跑步的图）。环境变量 MOBA_Q：额外的地址参数；FEET=左脚骨骼名,右脚骨骼名（默认 LeftFoot,RightFoot，四足的写前脚或后脚的那两根）
// 伊缇：从 tools/run_probe.mjs 拷来，只改了一处——网址走 MOBA_URL（原来写死 5183，这个任务只能用自己的 5253）。
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const id = process.argv[2]; if (!id) { console.error("用法: node tools/run_probe.mjs <英雄 id> [输出目录]"); process.exit(1); }
const out = process.argv[3] || `art/hero/${id}/kit_run`; fs.mkdirSync(out, { recursive: true }); const FEET = (process.env.FEET || "LeftFoot,RightFoot").split(",");
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 600000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1500,844"] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1500, height: 844 });
  await page.goto((process.env.MOBA_URL || "http://localhost:5253/map.html") + `?arena=1&h=${id}` + (process.env.MOBA_Q ? "&" + process.env.MOBA_Q : ""), { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true && window.__arena", { timeout: 90000 });
  const sleep = ms => new Promise(r => setTimeout(r, ms)); await sleep(900);
  const info = await page.evaluate(`(async () => {
    const a = __play.actor, T = window.THREE, p0 = { x: a.pos.x, z: a.pos.z }, meta = a.meta, ms = __sim.hero.h.stat.ms;
    // 找一个能走过去的远处目标：沿几个方向试，取路径最直的
    let best = null; for (let k = 0; k < 16; k++) { const an = k / 16 * Math.PI * 2, x = p0.x + Math.cos(an) * 14, z = p0.z + Math.sin(an) * 14; if (__nav.walkable(x, z)) { let ok = true; for (let s = 1; s < 14; s++) if (!__nav.walkable(p0.x + Math.cos(an) * s, p0.z + Math.sin(an) * s)) { ok = false; break; } if (ok) { best = { x, z, an }; break; } } }
    if (!best) return { err: "找不到一段直路" };
    a.moveTo(best.x, best.z); const rows = [], v = () => { const o = {}; for (const n of ${JSON.stringify(FEET)}) { const b = a.hero.bone(n); if (!b) { o[n] = null; continue; } const w = b.getWorldPosition(new b.position.constructor()); o[n] = [w.x, w.y, w.z]; } return o; };
    const t0 = performance.now(); await new Promise(res => { const step = () => { const t = (performance.now() - t0) / 1000; rows.push({ t, x: a.pos.x, y: a.pos.y, z: a.pos.z, st: a.state(), clip: a.hero.current, ...v() }); if (t < 2.2) requestAnimationFrame(step); else res(); }; requestAnimationFrame(step); });
    return { runSpeed: meta.runSpeed, ms, dir: [Math.cos(best.an), Math.sin(best.an)], rows };
  })()`);
  if (info.err) { console.log(info.err); process.exit(1); }
  const R = info.rows.filter(r => r.st === "move" && r.t > 0.5), [dx, dz] = info.dir, res = {};
  const vBody = (R.at(-1).x - R[0].x) * dx / (R.at(-1).t - R[0].t) + (R.at(-1).z - R[0].z) * dz / (R.at(-1).t - R[0].t);
  for (const foot of FEET) {
    const h = R.map(r => r[foot][1] - r.y), lo = Math.min(...h), us = [];
    for (let i = 1; i < R.length; i++) if (h[i] < lo + 0.12 && h[i - 1] < lo + 0.12) { const dt = R[i].t - R[i - 1].t; if (dt > 0) us.push(((R[i][foot][0] - R[i - 1][foot][0]) * dx + (R[i][foot][2] - R[i - 1][foot][2]) * dz) / dt); }
    us.sort((p, q) => p - q); const med = us[Math.floor(us.length / 2)], mean = us.reduce((s, x) => s + x, 0) / us.length;
    res[foot] = { 着地帧数: us.length, 脚离地最低: +lo.toFixed(2), 落地脚的世界速度_中位: +med.toFixed(2), 平均: +mean.toFixed(2), 反推原速_中位: +((vBody - med) * info.runSpeed / vBody).toFixed(2), 反推原速_平均: +((vBody - mean) * info.runSpeed / vBody).toFixed(2) };
  }
  console.log(JSON.stringify({ 现在填的runSpeed: info.runSpeed, 移速: info.ms, 实测身体速度: +vBody.toFixed(2), 采样帧: R.length, 动作: [...new Set(R.map(r => r.clip))], ...res }, null, 1));
  // 再跑一次，连拍 8 张
  await page.evaluate(`(() => { const a = __play.actor; a.teleport(window.__kx ?? a.pos.x, window.__kz ?? a.pos.z); })()`);
  await page.evaluate(`(() => { const a = __play.actor; a.moveTo(a.pos.x - ${info.dir[0]} * 13, a.pos.z - ${info.dir[1]} * 13); })()`); await sleep(350);
  for (let i = 0; i < 8; i++) { await page.screenshot({ path: `${out}/RUN_${String(i).padStart(2, "0")}.jpg`, type: "jpeg", quality: 86 }); await sleep(40); }
} finally { await browser.close(); }
