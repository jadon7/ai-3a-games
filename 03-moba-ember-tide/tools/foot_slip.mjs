#!/usr/bin/env node
// 跑步滑不滑步（第九轮）：在测试场里让英雄直着跑 1.5 秒，逐帧记脚（名字里带 foot / toe / ankle 的骨骼，四足的取腿最末端那节）在世界里的位置。
// 脚踩在地上的那几帧（这只脚最低的那 15% 高度）里，脚在地面上本该不动；它沿着前进方向还在走多快 w，就是滑步。
//   滑步比 = w / 移速（0 是完全踩实；正的是脚往前溜＝动作播慢了，负的是脚往后蹭＝动作播快了）。
//   顺便估出“这只脚不滑时 runSpeed 该是多少”：runSpeed × (移速 − w) / 移速。
// 用法: MOBA_URL=http://localhost:5201/map.html node tools/foot_slip.mjs [英雄,英雄…]
import puppeteer from "puppeteer-core";
const HEROES = (process.argv[2] || "lan,torg,moko,gorran,vero,osen").split(",");
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 600000, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--mute-audio", "--window-size=960,540"] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  for (const id of HEROES) {
    const page = await browser.newPage(); await page.setViewport({ width: 960, height: 540 });
    await page.goto((process.env.MOBA_URL || "http://localhost:5201/map.html") + `?arena=1&h=${id}&nohud=1&nofog=1&q=lite`, { waitUntil: "load" });
    await page.waitForFunction("window.__ready === true && window.__arena", { timeout: 120000 });
    const r = await page.evaluate(async () => {
      const a = __play.actor, S = __sim, bones = []; a.hero.model.traverse(o => { if (o.isBone) bones.push(o); });
      let feet = bones.filter(b => /foot|toe|ankle/i.test(b.name) && !/end|nub|top/i.test(b.name));
      if (feet.length > 4) feet = feet.filter(b => /toe/i.test(b.name)).length >= 2 ? feet.filter(b => /toe/i.test(b.name) && !/toe.*\d/i.test(b.name)) : feet;
      if (!feet.length) feet = bones.filter(b => !b.children.some(c => c.isBone) && b.getWorldPosition(new b.position.constructor()).y - a.pos.y < 0.4);      // 四足：没有子骨骼、离地很近的末端
      const x0 = a.pos.x, z0 = a.pos.z; let dir = null; for (let i = 0; i < 16; i++) { const y = i * Math.PI / 8, dx = Math.sin(y), dz = Math.cos(y); if (__nav.clear(x0, z0, x0 + dx * 16, z0 + dz * 16)) { dir = [dx, dz]; break; } }
      a.moveTo(x0 + dir[0] * 16, z0 + dir[1] * 16); __setSpeed(0.5);
      await new Promise(res => setTimeout(res, 900));      // 先跑起来（跑步动作淡入）
      const fr = [], v = new feet[0].position.constructor(), ou = S.update; S.update = dt => { ou(dt); fr.push({ t: S.time, gy: __h(a.pos.x, a.pos.z), f: feet.map(b => { b.getWorldPosition(v); return [v.x, v.y, v.z]; }) }); };
      await new Promise(res => setTimeout(res, 2400)); S.update = ou; a.stop();
      const ms = a.ent.h.stat.ms, out = [];
      feet.forEach((b, i) => { const hs = fr.map(q => q.f[i][1] - q.gy), lo = Math.min(...hs), hi = Math.max(...hs), cut = lo + (hi - lo) * 0.15; const ws = [];
        for (let k = 1; k < fr.length; k++) if (hs[k] <= cut && hs[k - 1] <= cut) { const dt = fr[k].t - fr[k - 1].t; if (dt > 1e-4) ws.push(((fr[k].f[i][0] - fr[k - 1].f[i][0]) * dir[0] + (fr[k].f[i][2] - fr[k - 1].f[i][2]) * dir[1]) / dt); }
        ws.sort((p, q) => p - q); const w = ws.length ? ws[Math.floor(ws.length / 2)] : NaN; out.push({ bone: b.name, frames: ws.length, w: +w.toFixed(2), slip: +(w / ms).toFixed(2), runSpeedFit: +(a.meta.runSpeed * (ms - w) / ms).toFixed(2) }); });
      return { ms, runSpeed: a.meta.runSpeed, clip: a.hero.current, feet: out };
    });
    console.log(id, JSON.stringify(r));
    await page.close();
  }
} finally { await browser.close(); }
