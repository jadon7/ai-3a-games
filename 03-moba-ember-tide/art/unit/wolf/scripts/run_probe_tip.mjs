#!/usr/bin/env node
// 在测试场里让狼（借英雄的位置）跑一段，逐帧记四只爪尖在世界里的位置，量“踩在地上的爪子滑不滑”。
// 和 tools/run_probe.mjs 的区别：那个量的是爪根那根骨骼的位置、离最低点 12 厘米以内都算着地。狼的爪子抬得低（最低的一只才抬十几厘米），
// 大半步都被算成着地；而且蹬地的时候爪根会绕着爪尖往前翻，量爪根会把这个当成滑。这里量爪尖（骨架文件里的标记点，挂在爪骨上），离最低点 1.5 厘米以内才算着地。
// 用法: MOBA_Q="glb=../unit/wolf&look=height:1.45" node run_probe_tip.mjs [秒数=2.6]
// 打印：每只爪子着地时在世界里的速度（应该是 0）、每一次着地期间爪尖在地上一共挪了多少厘米、按这个反推的原速。
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const SK = JSON.parse(fs.readFileSync("/Users/jadon7/Documents/SynologyDrive/code/video2rig/assets/model/wolf_skeleton.json", "utf8"));
const secs = +(process.argv[2] || 2.6), TH = +(process.env.TH || 0.015);
const tips = ["LeftFToe", "RightFToe", "LeftHToeTip", "RightHToeTip"].map(n => {
  const j = SK.joints.find(x => x.name === n), b = SK.bones.find(x => x.name === j.bone), M = b.matrix, s = Math.hypot(M[0][0], M[1][0], M[2][0]), o = j.offset;
  const loc = [0, 1, 2].map(c => (M[0][c] * o[0] + M[1][c] * o[1] + M[2][c] * o[2]) / s / s);      // 标记点在骨骼自己坐标系里的位置（Blender 的轴）
  return { name: n, bone: j.bone, loc, restH: b.head[2] + o[2] };
});
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 600000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1500,844"] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1500, height: 844 });
  await page.goto(`http://localhost:5183/map.html?arena=1&h=lan` + (process.env.MOBA_Q ? "&" + process.env.MOBA_Q : ""), { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true && window.__arena", { timeout: 90000 });
  await new Promise(r => setTimeout(r, 900));
  const info = await page.evaluate(`(async () => {
    const a = __play.actor, tips = ${JSON.stringify(tips)}, p0 = { x: a.pos.x, z: a.pos.z }, meta = a.meta, ms = __sim.hero.h.stat.ms;
    const B = tips.map(t => a.hero.bone(t.bone)), V = B[0].position.constructor, sc = B[0].getWorldScale(new V()).x;
    // 导出时骨骼自己的坐标轴可能换过（Blender 的 Z 朝上 → glTF 的 Y 朝上）：站着的时候两种换法都算一遍，取离“站着时爪尖的高度”近的那种
    const cands = [l => new V(l[0], l[1], l[2]), l => new V(l[0], l[2], -l[1])];
    const pick = tips.map((t, i) => { const hs = cands.map(c => B[i].localToWorld(c(t.loc)).y - a.pos.y); return Math.abs(hs[0] - t.restH * sc) < Math.abs(hs[1] - t.restH * sc) ? 0 : 1; });
    const stand = tips.map((t, i) => +(B[i].localToWorld(cands[pick[i]](t.loc)).y - a.pos.y).toFixed(3));
    let best = null; for (let k = 0; k < 16; k++) { const an = k / 16 * Math.PI * 2, x = p0.x + Math.cos(an) * 16, z = p0.z + Math.sin(an) * 16; if (__nav.walkable(x, z)) { let ok = true; for (let s = 1; s < 16; s++) if (!__nav.walkable(p0.x + Math.cos(an) * s, p0.z + Math.sin(an) * s)) { ok = false; break; } if (ok) { best = { x, z, an }; break; } } }
    if (!best) return { err: "找不到一段直路" };
    a.moveTo(best.x, best.z); const rows = [];
    const t0 = performance.now(); await new Promise(res => { const step = () => { const t = (performance.now() - t0) / 1000; rows.push({ t, x: a.pos.x, y: a.pos.y, z: a.pos.z, st: a.state(), p: tips.map((tp, i) => { const w = B[i].localToWorld(cands[pick[i]](tp.loc)); return [w.x, w.y, w.z]; }) }); if (t < ${secs}) requestAnimationFrame(step); else res(); }; requestAnimationFrame(step); });
    return { runSpeed: meta.runSpeed, ms, sc, pick, stand, restH: tips.map(t => +(t.restH * sc).toFixed(3)), dir: [Math.cos(best.an), Math.sin(best.an)], rows };
  })()`);
  if (info.err) { console.log(info.err); process.exit(1); }
  const R = info.rows.filter(r => r.st === "move" && r.t > 0.5), [dx, dz] = info.dir;
  const vBody = ((R.at(-1).x - R[0].x) * dx + (R.at(-1).z - R[0].z) * dz) / (R.at(-1).t - R[0].t);
  console.log(JSON.stringify({ 现在填的runSpeed: info.runSpeed, 移速: info.ms, 实测身体速度: +vBody.toFixed(2), 播放倍率: +(vBody / info.runSpeed).toFixed(3), 模型放大: +info.sc.toFixed(3), 采样帧: R.length, 站着时爪尖高度: info.stand, 应该是: info.restH }));
  const names = ["左前", "右前", "左后", "右后"]; const back = [];
  for (let c = 0; c < 4; c++) {
    const h = R.map(r => r.p[c][1] - r.y), along = R.map(r => r.p[c][0] * dx + r.p[c][2] * dz), lo = Math.min(...h), on = h.map(v => v < lo + TH), us = [], segs = []; let cur = null;
    for (let i = 1; i < R.length; i++) {
      if (on[i] && on[i - 1]) { const dt = R[i].t - R[i - 1].t; if (dt > 0) us.push((along[i] - along[i - 1]) / dt); if (!cur) cur = { a: i - 1, b: i }; else cur.b = i; }
      else if (cur) { segs.push(cur); cur = null; }
    }
    if (cur) segs.push(cur);
    const full = segs.filter(s => s.a > 1 && s.b < R.length - 1 && s.b - s.a >= 2), drift = full.map(s => (along[s.b] - along[s.a]) * 100), dur = full.map(s => R[s.b].t - R[s.a].t);
    us.sort((p, q) => p - q); const med = us[Math.floor(us.length / 2)] ?? NaN, mean = us.reduce((s, x) => s + x, 0) / Math.max(1, us.length);
    back.push((vBody - mean) * info.runSpeed / vBody);
    console.log(`${names[c]}爪: 着地 ${us.length} 帧、${full.length} 次（每次 ${(dur.reduce((s, x) => s + x, 0) / Math.max(1, dur.length)).toFixed(2)} 秒），着地时在世界里的速度 中位 ${med.toFixed(2)} 平均 ${mean.toFixed(2)} 米/秒（范围 ${us[0]?.toFixed(2)} ~ ${us.at(-1)?.toFixed(2)}），每次着地爪尖在地上挪了 ${drift.map(d => d.toFixed(1)).join("、")} 厘米；爪尖离地最低 ${(lo * 100).toFixed(1)} 最高 ${(Math.max(...h) * 100).toFixed(1)} 厘米；按平均速度反推原速 ${back[c].toFixed(2)}`);
  }
  console.log("四只爪子反推的原速平均", (back.reduce((s, x) => s + x, 0) / 4).toFixed(2), "米/秒");
} finally { await browser.close(); }
