#!/usr/bin/env node
// 伊缇的时间表（第四阶段 iti-kit）：测试场里每个技能按一下，量“按键到出手”、每段位移的距离和时长、大招每一刀和落地的时刻（全是对局时间）。
// 做法：把 fx_iti.ts 的 ITI_FX 每个函数包一层，调到的时候记下对局时间和参数（技能代码只在出手、命中、落地这些时机调它，所以它就是“出手”的时刻）；
// 普攻的“打中”从 sim.damage 拦。规则每走一步记一次伊缇的位置，量冲刺真正走了多远、用了多久。
// 用法: MOBA_URL=... node tools/iti_timing.mjs <输出.json>
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const [out] = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 900000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1280,720"] });
let R;
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 720 });
  const errors = []; page.on("pageerror", e => errors.push(String(e).slice(0, 300)));
  await page.goto(process.env.MOBA_URL + "?arena=1&h=iti&nohud=1&q=lite", { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true && window.__arena && window.__arena.dummy", { timeout: 120000 });
  R = await page.evaluate(`(async () => {
    const F = (await import("/src/map/game/fx_iti.ts")).ITI_FX, sim = __sim, me = sim.hero, a = __actors.get(me.id), d = __arena.dummy, sleep = ms => new Promise(r => setTimeout(r, ms));
    __actors.get(d.id).kit.passive = undefined; d.h.base.hp = 1e6; sim.recalc(d); d.hp = d.max;      // 假人别死、别变硬
    let ev = []; const P = p => p && typeof p.x === "number" ? [+p.x.toFixed(2), +p.z.toFixed(2)] : p;
    for (const k of Object.keys(F)) { const f = F[k]; F[k] = (...args) => { ev.push({ f: k, t: sim.time, args: args.slice(1).map(x => Array.isArray(x) ? x.map(e => e.kind) : x && x.kind ? x.kind : typeof x === "number" ? +x.toFixed(3) : P(x)) }); return f(...args); }; }
    // 规则每走一步记一次位置
    const su = sim.update, track = []; sim.update = dt => { su(dt); track.push([sim.time, me.x, me.z, a.state(), a.hero.current]); };
    const dmg0 = sim.damage; let hits = []; sim.damage = (e, n, src, o) => { const r = dmg0(e, n, src, o); if (e === d && src === me) hits.push([sim.time, Math.round(r)]); return r; };
    const reset = async (dist = 7) => { a.stop(); for (const k of ["Q","W","E","R"]) a.setCd(k, 0); a.data.iti = undefined; me.h.mana = me.h.stat.mana; me.hp = me.max; d.hp = d.max; d.vuln = d.vulnT = 0;
      let px = d.x - Math.SQRT1_2 * dist, pz = d.z - Math.SQRT1_2 * dist; if (!__nav.walkable(px, pz)) [px, pz] = __nav.nearest(px, pz); a.teleport(px, pz); a.face(d.x, d.z, true); await sleep(500); ev = []; hits = []; track.length = 0; };
    const idle = async () => { for (let i = 0; i < 200 && a.state() !== "idle" && a.state() !== "attack"; i++) await sleep(20); await sleep(150); };
    const moved = (t0, t1) => { const pts = track.filter(p => p[0] >= t0 - 1e-6 && p[0] <= t1 + 1e-6); if (pts.length < 2) return 0; return +Math.hypot(pts[pts.length - 1][1] - pts[0][1], pts[pts.length - 1][2] - pts[0][2]).toFixed(2); };
    // 位移真正开始、结束（每步挪了 1 厘米以上算在动）
    const motion = t0 => { let s = -1, e = -1; for (let i = 1; i < track.length; i++) { if (track[i][0] < t0) continue; const m = Math.hypot(track[i][1] - track[i - 1][1], track[i][2] - track[i - 1][2]) > 0.01; if (m && s < 0) s = track[i - 1][0]; if (m) e = track[i][0]; } return s < 0 ? null : { start: +(s - t0).toFixed(3), end: +(e - t0).toFixed(3), dist: moved(s, e) }; };
    const res = {};
    // 普攻：按下到打中（两下，第二下是双刀）
    await reset(1.8); { const t0 = sim.time; a.attack(d); for (let i = 0; i < 150 && hits.length < 2; i++) await sleep(20); res.A = { 第一下打中: +(hits[0][0] - t0).toFixed(3), 第二下打中: hits[1] ? +(hits[1][0] - t0).toFixed(3) : null, 攻速: +me.h.stat.as.toFixed(2) }; a.stop(); }
    // Q 三段：每段按下就放（瞄假人），记出手、冲刺
    await reset(7); { const out = [];
      for (let n = 1; n <= 3; n++) { let w = 0; while (!a.canCast("Q") && w < 200) { await sleep(10); w++; } const t0 = sim.time, nm = a.skill("Q").name; ev = []; a.cast("Q", { x: d.x, z: d.z }); await idle();
        const dash = ev.find(e => e.f === "qDash"), land = ev.find(e => e.f === "qLand"); out.push({ 段: nm, 按键到出手: dash ? +(dash.t - t0).toFixed(3) : null, 冲刺: dash ? { 从: dash.args[1], 到: dash.args[2], 时长: dash.args[3], 距离: +Math.hypot(dash.args[2][0] - dash.args[1][0], dash.args[2][1] - dash.args[1][1]).toFixed(2) } : null, 实测位移: motion(t0), 落地: land ? +(land.t - t0).toFixed(3) : null, 命中: ev.filter(e => e.f === "qHit").length }); }
      res.Q = out; }
    // W：出手、冲刺；再按一次换位
    await reset(7); { const t0 = sim.time; a.cast("W", { x: d.x, z: d.z }); await idle(); const dash = ev.find(e => e.f === "wDash"), echo = ev.find(e => e.f === "wEcho");
      res.W = { 按键到出手: dash ? +(dash.t - t0).toFixed(3) : null, 冲刺: dash ? { 时长: dash.args[2], 距离: +Math.hypot(dash.args[1][0] - dash.args[0][0], dash.args[1][1] - dash.args[0][1]).toFixed(2) } : null, 实测位移: motion(t0), 残影在: echo?.args[0] };
      await sleep(300); ev = []; const t1 = sim.time; a.cast("W"); await sleep(200); const sw = ev.find(e => e.f === "wSwap"), bu = ev.find(e => e.f === "wBurst"); res.W2 = { 按键到换位: sw ? +(sw.t - t1).toFixed(3) : null, 换位距离: sw ? +Math.hypot(sw.args[1][0] - sw.args[0][0], sw.args[1][1] - sw.args[0][1]).toFixed(2) : null, 炸开: bu ? { 半径: bu.args[1], 打中: bu.args[2] } : null }; }
    // E：按下到闪到身后、刺中
    await reset(8); { const t0 = sim.time; a.cast("E", undefined, d); await idle(); const bl = ev.find(e => e.f === "eBlink"), sb = ev.find(e => e.f === "eStab");
      res.E = { 按键到出手: bl ? +(bl.t - t0).toFixed(3) : null, 闪的距离: bl ? +Math.hypot(bl.args[1][0] - bl.args[0][0], bl.args[1][1] - bl.args[0][1]).toFixed(2) : null, 刺中: sb ? +(sb.t - t0).toFixed(3) : null, 落点离假人: bl ? +Math.hypot(bl.args[1][0] - d.x, bl.args[1][1] - d.z).toFixed(2) : null }; }
    // R：按下到出手；每一刀、现身、落地
    await reset(9); { const t0 = sim.time, ut = []; const iv = setInterval(() => ut.push([sim.time, me.untarget, a.hero.group.visible]), 10); a.cast("R", { x: d.x, z: d.z }); await sleep(2600); clearInterval(iv);
      const st = ev.find(e => e.f === "rStart"), cuts = ev.filter(e => e.f === "rSlash"), fin = ev.find(e => e.f === "rFinale"), unt = ut.filter(x => x[1]), hid = ut.filter(x => !x[2]);
      res.R = { 按键到出手: st ? +(st.t - t0).toFixed(3) : null, 落点: st?.args[0], 每一刀: cuts.map(c => +(c.t - st.t).toFixed(3)), 每刀砍谁: cuts.map(c => c.args[3] ?? "空砍"), 十字新月斩: fin ? +(fin.t - st.t).toFixed(3) : null, 落地时按键后: fin ? +(fin.t - t0).toFixed(3) : null,
        不可选中: unt.length ? [+(unt[0][0] - t0).toFixed(2), +(unt[unt.length - 1][0] - t0).toFixed(2)] : null, 看不见: hid.length ? [+(hid[0][0] - t0).toFixed(2), +(hid[hid.length - 1][0] - t0).toFixed(2)] : null }; }
    sim.update = su; sim.damage = dmg0;
    return res; })()`);
  R.errors = errors;
} finally { await browser.close(); }
fs.writeFileSync(out, JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1));
