#!/usr/bin/env node
// 巨魔用的“落地脚滑不滑”测量。照 tools/run_probe.mjs 改的，改了三处：
//   1. 判“脚踩在地上”的门槛按身高放大。原脚本是“脚踝离最低点 12 厘米以内”，对六米的巨魔太窄（它一步里脚踝本身就起伏三十多厘米），只抓得到半截着地段，两只脚反推出来的原速差三倍。
//      这里看脚掌骨骼（ToeBase）：离它自己最低点 0.8% 身高以内算脚掌贴地。
//   2. 除了反推原速，还报每一段贴地期间脚掌在地上一共滑了多远（厘米）。
//   3. 关浏览器卡住时 3 秒后直接退出（原脚本显卡忙的时候会卡在这一步不退出）。
// 用法: MOBA_Q="glb=../unit/troll&look=height:6,ring:2.6" node art/unit/troll/run_probe2.mjs lan art/unit/troll/probe [身高=6]
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const id = process.argv[2] || "lan", out = process.argv[3] || "art/unit/troll/probe", H = +(process.argv[4] || 6); fs.mkdirSync(out, { recursive: true }); const FEET = ["LeftToeBase", "RightToeBase"];
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 600000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1500,844"] });
const page = await browser.newPage(); await page.setViewport({ width: 1500, height: 844 });
await page.goto(`http://localhost:5183/map.html?arena=1&h=${id}` + (process.env.MOBA_Q ? "&" + process.env.MOBA_Q : ""), { waitUntil: "load" });
await page.waitForFunction("window.__ready === true && window.__arena", { timeout: 90000 });
const sleep = ms => new Promise(r => setTimeout(r, ms)); await sleep(900);
const info = await page.evaluate(`(async () => {
  const a = __play.actor, p0 = { x: a.pos.x, z: a.pos.z }, meta = a.meta, ms = __sim.hero.h.stat.ms;
  let best = null; for (let k = 0; k < 16; k++) { const an = k / 16 * Math.PI * 2, x = p0.x + Math.cos(an) * 16, z = p0.z + Math.sin(an) * 16; if (__nav.walkable(x, z)) { let ok = true; for (let s = 1; s < 16; s++) if (!__nav.walkable(p0.x + Math.cos(an) * s, p0.z + Math.sin(an) * s)) { ok = false; break; } if (ok) { best = { x, z, an }; break; } } }
  if (!best) return { err: "找不到一段直路" };
  const bones = { Head: !!a.hero.bone("Head"), Spine2: !!a.hero.bone("Spine2"), "mixamorig:Head": !!a.hero.bone("mixamorig:Head"), LeftToeBase: !!a.hero.bone("LeftToeBase") };
  a.moveTo(best.x, best.z); const rows = [], v = () => { const o = {}; for (const n of ${JSON.stringify(FEET)}) { const b = a.hero.bone(n); const w = b.getWorldPosition(new b.position.constructor()); o[n] = [w.x, w.y, w.z]; } return o; };
  const t0 = performance.now(); await new Promise(res => { const step = () => { const t = (performance.now() - t0) / 1000; rows.push({ t, x: a.pos.x, y: a.pos.y, z: a.pos.z, st: a.state(), clip: a.hero.current, ...v() }); if (t < 2.6) requestAnimationFrame(step); else res(); }; requestAnimationFrame(step); });
  return { runSpeed: meta.runSpeed, ms, dir: [Math.cos(best.an), Math.sin(best.an)], rows, bones, scale: a.hero.model.scale.x, clips: [...a.hero.clips.keys()] };
})()`);
if (info.err) { console.log(info.err); process.exit(1); }
const R = info.rows.filter(r => r.st === "move" && r.t > 0.5), [dx, dz] = info.dir, res = {};
const vBody = ((R.at(-1).x - R[0].x) * dx + (R.at(-1).z - R[0].z) * dz) / (R.at(-1).t - R[0].t);
for (const foot of FEET) {
  const h = R.map(r => r[foot][1] - r.y), lo = Math.min(...h), on = h.map(x => x < lo + 0.008 * H), us = [], slips = []; let run = null;
  for (let i = 1; i < R.length; i++) {
    if (on[i] && on[i - 1]) { const dt = R[i].t - R[i - 1].t, d = (R[i][foot][0] - R[i - 1][foot][0]) * dx + (R[i][foot][2] - R[i - 1][foot][2]) * dz; if (dt > 0) us.push(d / dt); run = run ?? { d: 0, t: 0 }; run.d += d; run.t += dt; }
    else if (run) { if (run.t > 0.08) slips.push(run); run = null; }
  }
  us.sort((p, q) => p - q); const med = us[us.length >> 1], mean = us.reduce((s, x) => s + x, 0) / us.length;
  res[foot] = { 贴地帧数: us.length, 脚掌骨骼离地最低: +lo.toFixed(2), 贴地时脚掌在世界里的速度_平均: +mean.toFixed(2), 中位: +med.toFixed(2), 反推原速_平均: +((vBody - mean) * info.runSpeed / vBody).toFixed(2), 每段贴地滑了多少厘米: slips.map(s => +(s.d * 100).toFixed(0)), 每段贴地多少秒: slips.map(s => +s.t.toFixed(2)) };
}
console.log(JSON.stringify({ 现在填的runSpeed: info.runSpeed, 测试场里的移速: info.ms, 实测身体速度: +vBody.toFixed(2), 播放倍率: +(vBody / info.runSpeed).toFixed(2), 采样帧: R.length, 动作: [...new Set(R.map(r => r.clip))], 模型缩放: +info.scale.toFixed(3), 找得到的骨骼: info.bones, 模型里的动作: info.clips, ...res }, null, 1));
await page.evaluate(`(() => { const a = __play.actor; a.moveTo(a.pos.x - ${info.dir[0]} * 14, a.pos.z - ${info.dir[1]} * 14); })()`); await sleep(500);
for (let i = 0; i < 8; i++) { await page.screenshot({ path: `${out}/RUN_${String(i).padStart(2, "0")}.jpg`, type: "jpeg", quality: 86 }); await sleep(90); }
await Promise.race([browser.close(), new Promise(r => setTimeout(r, 3000))]); process.exit(0);
