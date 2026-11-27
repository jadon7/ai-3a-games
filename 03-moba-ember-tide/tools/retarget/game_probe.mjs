#!/usr/bin/env node
// 在游戏的测试场里看套好动作的新模型：站着、跑、普攻各截几张，并照 tools/foot_slip.mjs 的办法量跑步时落地脚滑多少。
// 和 foot_slip.mjs 的区别只有一个：可以用 glb=<名字> 把英雄换成 public/assets/hero/<名字>.glb（连同 <名字>.json 的时间表）。
// 用法: MOBA_URL=http://localhost:5223/map.html node tools/retarget/game_probe.mjs <英雄 id> <输出目录> [glb 名字，可省]
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const [id, out, glb] = process.argv.slice(2); fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 600000, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio", "--hide-scrollbars", "--window-size=1500,844"] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1500, height: 844 });
  const errors = []; page.on("pageerror", e => errors.push(String(e).slice(0, 200))); page.on("console", m => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
  await page.goto((process.env.MOBA_URL || "http://localhost:5223/map.html") + `?arena=1&h=${id}&nohud=1&nofog=1` + (glb ? `&glb=${glb}` : "") + (process.env.CAM ? "&cam=" + process.env.CAM : ""), { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true && window.__arena", { timeout: 120000 }); await sleep(1200);
  const tag = glb || id; await page.evaluate("(() => { const a = __play.actor; window.__kx = a.pos.x; window.__kz = a.pos.z; })()");
  await page.screenshot({ path: `${out}/${tag}_idle.jpg`, type: "jpeg", quality: 88 });
  const r = await page.evaluate(async () => {
    const a = __play.actor, S = __sim, bones = []; a.hero.model.traverse(o => { if (o.isBone) bones.push(o); });
    let feet = bones.filter(b => /foot|toe|ankle/i.test(b.name) && !/end|nub|top/i.test(b.name));
    if (feet.length > 4) feet = feet.filter(b => /toe/i.test(b.name)).length >= 2 ? feet.filter(b => /toe/i.test(b.name) && !/toe.*\d/i.test(b.name)) : feet;
    const x0 = a.pos.x, z0 = a.pos.z; let dir = null; for (let i = 0; i < 16; i++) { const y = i * Math.PI / 8, dx = Math.sin(y), dz = Math.cos(y); if (__nav.clear(x0, z0, x0 + dx * 16, z0 + dz * 16)) { dir = [dx, dz]; break; } }
    a.moveTo(x0 + dir[0] * 16, z0 + dir[1] * 16); __setSpeed(0.5);
    await new Promise(res => setTimeout(res, 900));
    const fr = [], v = new feet[0].position.constructor(), ou = S.update; S.update = dt => { ou(dt); fr.push({ t: S.time, gy: __h(a.pos.x, a.pos.z), f: feet.map(b => { b.getWorldPosition(v); return [v.x, v.y, v.z]; }) }); };
    await new Promise(res => setTimeout(res, 2400)); S.update = ou;
    const ms = a.ent.h.stat.ms, res = [];
    feet.forEach((b, i) => { const hs = fr.map(q => q.f[i][1] - q.gy), lo = Math.min(...hs), hi = Math.max(...hs), cut = lo + (hi - lo) * 0.15; const ws = [];
      for (let k = 1; k < fr.length; k++) if (hs[k] <= cut && hs[k - 1] <= cut) { const dt = fr[k].t - fr[k - 1].t; if (dt > 1e-4) ws.push(((fr[k].f[i][0] - fr[k - 1].f[i][0]) * dir[0] + (fr[k].f[i][2] - fr[k - 1].f[i][2]) * dir[1]) / dt); }
      ws.sort((p, q) => p - q); const w = ws.length ? ws[Math.floor(ws.length / 2)] : NaN; res.push({ bone: b.name, frames: ws.length, w: +w.toFixed(2), slip: +(w / ms).toFixed(2), runSpeedFit: +(a.meta.runSpeed * (ms - w) / ms).toFixed(2), lowest: +lo.toFixed(3) }); });
    __setSpeed(1); return { ms, runSpeed: a.meta.runSpeed, clip: a.hero.current, feet: res };
  });
  for (let i = 0; i < 4; i++) { await page.screenshot({ path: `${out}/${tag}_run_${i}.jpg`, type: "jpeg", quality: 88 }); await sleep(90); }
  await page.evaluate("(() => { const a = __play.actor; a.stop(); __arena.reset(); a.teleport(window.__kx, window.__kz); })()"); await sleep(1500);
  await page.evaluate("(() => { __play.attack(__arena.foes[0]); })()"); await sleep(200);
  for (let i = 0; i < 6; i++) { await page.screenshot({ path: `${out}/${tag}_attack_${i}.jpg`, type: "jpeg", quality: 88 }); await sleep(140); }
  console.log(JSON.stringify({ hero: id, glb: glb || null, ...r, errors: errors.slice(0, 5) }));
} finally { await browser.close(); }
