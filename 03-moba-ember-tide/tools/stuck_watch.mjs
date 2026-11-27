#!/usr/bin/env node
// 卡地形检测（第九轮）：开一局全电脑对战快进跑完，每 0.25 秒（对局时间）看一遍每个小兵、野怪、英雄：
//   “应该在走”（小兵、野怪的 state 是 walk；英雄的控制器在 move；都没被定身、击飞、眩晕）连着三秒，三秒里位移不到 0.3 米，就算卡住。
//   traveled 是这三秒里一共走了多远：走了不少、位置却没变的是来回晃（电脑拿不定主意），不是被地形卡住。
//   记下第一次卡住的时间、位置（世界坐标和路向坐标）、它在追谁、离目标多远，卡了多久（一直卡着的到对局结束为止）。
// 用法: MOBA_URL=http://localhost:5201/map.html node tools/stuck_watch.mjs <输出.json> ["网址参数"] [最长对局秒数]
//   例: node tools/stuck_watch.mjs /tmp/s1.json "h=lan&diff=hard" 2400
// 输出：一行一个卡住的事件（打在终端），最后是汇总和 __report()；完整结果写进 <输出.json>（画位置图用 tools/stuck_map.py）。
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const [out, q = "h=lan", maxT = "2400"] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 1800000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=960,540"] });
try {
  const page = await browser.newPage(); await page.setViewport({ width: 960, height: 540 });
  const errors = []; page.on("pageerror", e => errors.push(String(e).slice(0, 300))); page.on("console", m => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
  await page.goto((process.env.MOBA_URL || "http://localhost:5201/map.html") + "?" + q + "&auto=1&nofog=1&nohud=1&q=lite", { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true", { timeout: 120000 });
  await page.evaluate(() => {
    const S = window.__sim, A = window.__actors, orig = S.update.bind(S), hist = new Map(), live = new Map(), log = []; let acc = 0;
    const SQ2 = Math.SQRT2, lane = (x, z) => [+((x - z) / SQ2).toFixed(1), +((x + z) / SQ2).toFixed(1)];
    const name = e => e.kind === "hero" ? e.h.kit + (e.team ? "*" : "") : e.kind === "monster" ? e.mob : e.kind + e.team;
    window.__stuck = log;
    S.update = dt => { orig(dt); acc += dt; if (acc < 0.25) return; acc = 0;
      for (const e of S.ents) {
        if (!e.alive || !(e.kind === "melee" || e.kind === "ranged" || e.kind === "monster" || e.kind === "hero")) { hist.delete(e.id); continue; }
        const a = e.kind === "hero" ? A.get(e.id) : null;
        const want = (a ? a.state() === "move" : e.state === "walk") && e.root <= 0 && e.fly <= 0 && e.stun <= 0;
        let h = hist.get(e.id); if (!h) hist.set(e.id, h = []);
        h.push([S.time, e.x, e.z, want]); while (h.length && S.time - h[0][0] > 3.01) h.shift();
        const full = h.length >= 12 && h.every(s => s[3]), moved = Math.hypot(e.x - h[0][1], e.z - h[0][2]); let trav = 0; for (let i = 1; i < h.length; i++) trav += Math.hypot(h[i][1] - h[i - 1][1], h[i][2] - h[i - 1][2]);
        const cur = live.get(e.id);
        if (full && moved < 0.3) {
          if (!cur) { const tg = a ? a.target() : e.target; const rec = { who: name(e), id: e.id, t: +S.time.toFixed(1), x: +e.x.toFixed(2), z: +e.z.toFixed(2), uv: lane(e.x, e.z), state: a ? a.state() : e.state, target: tg ? name(tg) : null, tgDist: tg ? +Math.hypot(tg.x - e.x, tg.z - e.z).toFixed(1) : null, lane: e.lane, s: e.kind === "hero" ? null : +e.s.toFixed(1), route: e.route ? e.route.length : null, dur: 3, traveled: +trav.toFixed(2), doing: null };
            if (a) { const b = (window.__bots || []).find(b => b.ent === e); rec.doing = b ? b.doing() : "玩家"; }
            live.set(e.id, rec); log.push(rec); }
          else cur.dur = +(3 + S.time - cur.t).toFixed(1);
        } else if (cur && (!want || moved > 0.6)) live.delete(e.id);
      }
    };
  });
  await page.evaluate("__setSpeed(16)");
  const t0 = Date.now(); let lastN = 0;
  for (;;) {
    await new Promise(r => setTimeout(r, 3000));
    const st = await page.evaluate("({ t: __sim.time, over: __sim.over, n: __stuck.length, rows: __stuck.slice(" + lastN + ") })");
    for (const r of st.rows) console.log("卡住", JSON.stringify(r));
    lastN = st.n;
    if (st.over || st.t > +maxT || Date.now() - t0 > 1500000) break;
  }
  const res = await page.evaluate("({ stuck: __stuck, report: __report(), time: __sim.time, over: __sim.over })");
  res.errors = errors; fs.writeFileSync(out, JSON.stringify(res, null, 1));
  const by = {}; for (const r of res.stuck) { const k = r.who.replace(/[01*]$/, ""); by[k] = (by[k] || 0) + 1; }
  const terr = res.stuck.filter(r => r.traveled < 1), osc = res.stuck.filter(r => r.traveled >= 1);
  console.log(JSON.stringify({ 时间: Math.round(res.time), 结果: res.over, 卡住次数: res.stuck.length, 其中原地不动: terr.length, 其中来回晃: osc.length, 超过三秒: res.stuck.filter(r => r.dur >= 3).length, 按种类: by, 最长: Math.max(0, ...res.stuck.map(r => r.dur)), errors: errors.slice(0, 6) }));
  console.log(JSON.stringify(res.report));
} finally { await browser.close(); }
