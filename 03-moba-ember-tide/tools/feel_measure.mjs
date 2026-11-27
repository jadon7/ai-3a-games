#!/usr/bin/env node
// 手感测量（第九轮）：在测试场里逐帧采样，量六个英雄“下命令到生效”的时间。
// 用法: MOBA_URL=http://localhost:5201/map.html node tools/feel_measure.mjs <输出.json> [英雄,英雄…]
//
// 做法：对局按 0.5 倍速走（每一步的对局时间更细），在规则那边的每一步（sim.update）之后记一帧：时间、位置、朝向、控制器的状态、正在播的动作。
// 命令都在两帧之间下（page.evaluate），t0 取下命令那一刻的对局时间。伤害从 sim.damage 拦，远程普攻的“出手”从 api.shoot 拦，技能的“出手”从技能的 fire 拦。
// 量的东西（全是对局时间，秒）：
//   移动：下命令到开始位移；到全速；按停到停住；原地掉头 180 度（朝向转到差 0.15 弧度以内）要多久、掉头时的速度。
//   普攻：目标在射程内，下命令到出手（近战是伤害结算，远程是弹道飞出）；出手后不再下命令多久才回到空闲；出手那一刻下移动命令，多久开始走；连着打 6 秒的平均出手间隔。
//   技能：按下到出手（fire）；到第一下伤害；到开始位移；不再下命令时多久回到空闲（被锁住多久）；一直狂点移动时多久开始走、技能有没有照样放出来。
//   排队：放技能的动作还没做完时按下一个技能 / 移动 / 普攻，会不会被吞掉。
//   鼠标：真的按鼠标（按下停 120 毫秒再松开），从按下到英雄开始走过了多少毫秒（真实时间，对局 1 倍速）。
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const [out, only] = process.argv.slice(2);
const HEROES = (only || "lan,torg,moko,gorran,vero,osen").split(",");
const browser = await puppeteer.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: "new", protocolTimeout: 900000,
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-webgl", "--hide-scrollbars", "--mute-audio", "--window-size=1280,720"] });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ALL = {};
try {
  for (const id of HEROES) {
    const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 720 });
    const errors = []; page.on("pageerror", e => errors.push(String(e).slice(0, 300)));
    await page.goto((process.env.MOBA_URL || "http://localhost:5201/map.html") + `?arena=1&h=${id}&nohud=1&nofog=1&q=lite`, { waitUntil: "load" });
    await page.waitForFunction("window.__ready === true && window.__arena && window.__arena.dummy", { timeout: 120000 });
    const ev = s => page.evaluate(s);
    await ev(`(() => {
      const S = __sim, P = __play, a = P.actor, me = a.ent, api = __api;
      const F = window.__fm = { rec: null, x0: me.x, z0: me.z, yaw0: a.yaw() };
      const od = S.damage; S.damage = (e, d, src, o) => { const r = od(e, d, src, o); if (F.rec && src === me && r > 0) F.rec.dmg.push([S.time, e.id]); return r; };
      const os = api.shoot; api.shoot = s => { if (F.rec && s.me === me) F.rec.shot.push([S.time, s.target ? s.target.id : -1]); return os(s); };
      for (const d of a.kit.skills) { const f = d.fire; if (f) d.fire = c => { if (F.rec && c.me === me) F.rec.fire.push([S.time, d.key]); return f(c); }; }
      const ou = S.update; S.update = dt => { ou(dt); const R = F.rec; if (!R) return;
        R.fr.push([+S.time.toFixed(4), +a.pos.x.toFixed(3), +a.pos.z.toFixed(3), +a.yaw().toFixed(3), a.state(), a.hero.current]);
        if (R.spam) a.moveTo(R.spam[0], R.spam[1]);
        if (R.onHit && (R.dmg.length || R.shot.length)) { const [x, z] = R.onHit; R.onHit = null; R.hitAt = S.time; a.moveTo(x, z); }
        if (R.then && S.time >= R.then.at) { const t = R.then; R.then = null; R.thenT = S.time; t.fn(); } };
      F.start = () => { F.rec = { t0: S.time, fr: [], dmg: [], shot: [], fire: [] }; return S.time; };
      F.stop = () => { const r = F.rec; F.rec = null; return r; };
      F.fresh = () => { for (const k of ["Q", "W", "E", "R"]) a.setCd(k, 0); me.h.mana = me.h.stat.mana; me.hp = me.max; me.stun = me.root = me.silence = me.slow = 0; __arena.reset(); const dm = __arena.dummy; if (dm) { dm.hp = dm.max; } for (const f of __arena.foes) f.hp = f.max; };
      /** 找一个开阔的方向：从 (x,z) 朝那边走 len 米一路都能走 */
      F.openDir = (x, z, len) => { for (let i = 0; i < 16; i++) { const y = F.yaw0 + i * Math.PI / 8, dx = Math.sin(y), dz = Math.cos(y); if (__nav.clear(x, z, x + dx * len, z + dz * len) && __nav.clear(x, z, x - dx * len, z - dz * len)) return [dx, dz]; } return [Math.sin(F.yaw0), Math.cos(F.yaw0)]; };
    })()`);
    await ev("__setSpeed(0.5)");
    const R = { id, ms: await ev("__play.actor.ent.h.stat.ms"), as: await ev("__play.actor.ent.h.stat.as"), range: await ev("__play.actor.ent.h.stat.range") };
    const until = async (cond, capSim) => { const t0 = await ev("__sim.time"); for (;;) { await sleep(40); const [ok, t] = await ev(`[!!(${cond}), __sim.time]`); if (ok || t - t0 > capSim) return; } };
    const idle = () => until("['idle'].includes(__play.actor.state())", 8);
    const waitSim = async s => until(`__sim.time >= ${await ev("__sim.time")} + ${s}`, s + 1);
    // ---------------- 移动 ----------------
    await ev("__play.actor.stop(); __play.actor.teleport(__fm.x0, __fm.z0); 1"); await waitSim(0.6);
    const [dx, dz] = await ev("__fm.openDir(__fm.x0, __fm.z0, 11)");
    await ev(`__play.actor.face(__fm.x0 + ${dx}, __fm.z0 + ${dz}, true); 1`); await waitSim(0.3);
    await ev("__fm.start()"); await ev(`__play.moveTo(__fm.x0 + ${dx * 10}, __fm.z0 + ${dz * 10}); __fm.rec.cmd = __sim.time; 1`);
    await waitSim(1.0); await ev("__play.actor.stop(); __fm.rec.stopAt = __sim.time; 1"); await waitSim(0.5);
    const mv = await ev("__fm.stop()");
    { const f = mv.fr.filter(r => r[0] >= mv.cmd), p0 = f[0]; let start = null, full = null, stopT = null;
      for (let i = 1; i < f.length; i++) { const d = Math.hypot(f[i][1] - p0[1], f[i][2] - p0[2]), sp = Math.hypot(f[i][1] - f[i - 1][1], f[i][2] - f[i - 1][2]) / Math.max(1e-4, f[i][0] - f[i - 1][0]);
        if (start === null && d > 0.01) start = f[i][0] - mv.cmd; if (full === null && sp >= R.ms * 0.95 && f[i][0] < mv.stopAt) full = f[i][0] - mv.cmd;
        if (f[i][0] > mv.stopAt && stopT === null && sp < 0.05) stopT = f[i][0] - mv.stopAt; }
      // 这一帧的位移是在 cmd 之后第一步算的：一步的长度就是测量的分辨率
      const step = f.length > 2 ? (f[f.length - 1][0] - f[0][0]) / (f.length - 1) : 0;
      R.move = { start: +(start ?? -1).toFixed(3), full: +(full ?? -1).toFixed(3), stop: +(stopT ?? -1).toFixed(3), step: +step.toFixed(3) }; }
    // 掉头：先走一秒，再朝身后点
    await ev("__play.actor.teleport(__fm.x0, __fm.z0); 1"); await ev(`__play.actor.face(__fm.x0 + ${dx}, __fm.z0 + ${dz}, true); __play.moveTo(__fm.x0 + ${dx * 10}, __fm.z0 + ${dz * 10}); 1`); await waitSim(0.9);
    await ev("__fm.start()"); await ev(`(() => { const p = __play.pos; __fm.rec.cmd = __sim.time; __fm.rec.tyaw = Math.atan2(${-dx}, ${-dz}); __play.moveTo(p.x - ${dx * 8}, p.z - ${dz * 8}); })()`);
    await waitSim(0.8); await ev("__play.actor.stop(); 1"); const tn = await ev("__fm.stop()");
    { const f = tn.fr.filter(r => r[0] >= tn.cmd); let done = null, back = null, minSp = 99;
      for (let i = 1; i < f.length; i++) { let e = f[i][3] - tn.tyaw; e = Math.atan2(Math.sin(e), Math.cos(e)); const vx = (f[i][1] - f[i - 1][1]), vz = (f[i][2] - f[i - 1][2]), dtt = Math.max(1e-4, f[i][0] - f[i - 1][0]), sp = Math.hypot(vx, vz) / dtt;
        if (done === null) { minSp = Math.min(minSp, sp); if (Math.abs(e) < 0.15) done = f[i][0] - tn.cmd; }
        if (back === null && (vx * -dx + vz * -dz) / dtt > R.ms * 0.9) back = f[i][0] - tn.cmd; }
      R.turn = { t180: +(done ?? -1).toFixed(3), newDirFull: +(back ?? -1).toFixed(3), minSpeedWhileTurning: +minSp.toFixed(2) }; }
    // ---------------- 普攻 ----------------
    const placeAt = async (eid, gap) => ev(`(() => { const a = __play.actor, e = __sim.ents.find(o => o.id === ${eid}), [dx, dz] = __fm.openDir(e.x, e.z, 3); const reach = a.kit.ranged ? a.ent.h.stat.range : a.ent.h.stat.range - 0.7; const d = e.r + reach - ${gap};
      a.stop(); a.teleport(e.x - dx * d, e.z - dz * d); a.face(e.x, e.z, true); return Math.hypot(a.pos.x - e.x, a.pos.z - e.z); })()`);
    let foe = 0; const getFoe = async () => { foe = await ev("(() => { const e = __arena.foes[2]; e.max = e.hp = 1e7; return e.id; })()"); };      // 靶子血加满（连着打会打死，死了会换一个新的）
    await ev("__fm.fresh(); 1"); await getFoe(); await placeAt(foe, 0.5); await waitSim(1.4);
    await ev("__fm.start()"); await ev(`__fm.rec.cmd = __sim.time; __play.attack(__sim.ents.find(o => o.id === ${foe})); 1`); await until("__fm.rec.dmg.length || __fm.rec.shot.length", 3);
    await until("__play.actor.state() !== 'attack'", 3); await ev("__play.actor.stop(); 1"); await waitSim(0.2); const at1 = await ev("__fm.stop()");
    { const hitT = (at1.shot[0] ?? at1.dmg[0] ?? [NaN])[0], f = at1.fr.filter(r => r[0] > hitT); const end = f.find(r => r[4] !== "attack");
      R.attack = { windup: +(hitT - at1.cmd).toFixed(3), period: +(1 / R.as).toFixed(3), windupPct: Math.round(((hitT - at1.cmd) * R.as) * 100), backswing: end ? +(end[0] - hitT).toFixed(3) : -1, land: at1.dmg[0] ? +(at1.dmg[0][0] - at1.cmd).toFixed(3) : -1, clip: (at1.fr.find(r => r[4] === "attack") ?? [])[5] }; }
    // 出手那一刻下移动命令：多久开始走
    await ev("__fm.fresh(); 1"); await getFoe(); await placeAt(foe, 0.5); await waitSim(1.4);
    await ev("__fm.start()"); await ev(`(() => { const p = __play.pos, e = __sim.ents.find(o => o.id === ${foe}); __fm.rec.onHit = [p.x - (e.x - p.x) * 2, p.z - (e.z - p.z) * 2]; __fm.rec.cmd = __sim.time; __play.attack(e); })()`);
    await waitSim(1.2); await ev("__play.actor.stop(); 1"); const at2 = await ev("__fm.stop()");
    { const f = at2.fr.filter(r => r[0] > at2.hitAt), p0 = f[0]; const mvT = p0 ? f.find(r => Math.hypot(r[1] - p0[1], r[2] - p0[2]) > 0.02) : null; R.attack.moveAfterHit = mvT ? +(mvT[0] - at2.hitAt).toFixed(3) : -1; if (process.env.DBG) console.log(JSON.stringify({ hitAt: at2.hitAt, dmg: at2.dmg, shot: at2.shot, st: at2.fr.map(r => r[4][0]).join(''), alive: await ev(`[__sim.ents.find(o => o.id === ${foe})?.alive, __sim.ents.find(o => o.id === ${foe})?.hp]`) })); }
    // 连着打 6 秒
    await ev("__fm.fresh(); 1"); await getFoe(); await placeAt(foe, 0.5); await waitSim(1.4);
    await ev("__fm.start()"); await ev(`__fm.rec.cmd = __sim.time; __play.attack(__sim.ents.find(o => o.id === ${foe})); 1`); await waitSim(6.2); await ev("__play.actor.stop(); 1"); const at3 = await ev("__fm.stop()");
    { const hs = (at3.shot.length ? at3.shot : at3.dmg).map(r => r[0]); R.attack.hits6s = hs.length; R.attack.meanGap = hs.length > 1 ? +((hs[hs.length - 1] - hs[0]) / (hs.length - 1)).toFixed(3) : -1; }
    // ---------------- 技能 ----------------
    const keys = await ev("__play.actor.kit.skills.filter(s => s.cast !== 'passive').map(s => s.key)");
    R.skills = {};
    const setup = async () => { await ev("__fm.fresh(); 1"); await waitSim(0.2); await ev(`(() => { const a = __play.actor, e = __arena.dummy, [dx, dz] = __fm.openDir(e.x, e.z, 4); a.stop(); a.teleport(e.x - dx * 3.4, e.z - dz * 3.4); a.face(e.x, e.z, true); })()`); await waitSim(0.9); };
    const castJs = k => `(() => { const a = __play.actor, d = a.skill('${k}'), e = __arena.dummy; __fm.rec.cmd = __sim.time; return __play.cast('${k}', e.x, e.z, d.cast === 'unit' ? (d.target === 'ally' ? a.ent : e) : null); })()`;
    for (const k of keys) {
      // A：按下以后什么都不做
      await setup(); await ev("__fm.start()"); const ok = await ev(castJs(k));
      await until("__fm.rec.fr.length > 3 && ['idle','move','attack'].includes(__play.actor.state())", 9); await waitSim(0.3); await ev("__play.actor.stop(); 1"); const A = await ev("__fm.stop()");
      const f = A.fr.filter(r => r[0] >= A.cmd), p0 = f[0] ?? [0, 0, 0], free = f.find((r, i) => i > 0 && ["idle", "move", "attack"].includes(r[4]) && f.slice(0, i).some(q => !["idle", "move", "attack"].includes(q[4])));
      const moveStart = f.find(r => Math.hypot(r[1] - p0[1], r[2] - p0[2]) > 0.1), states = [...new Set(f.map(r => r[4]))];
      const s = { ok, fire: A.fire[0] ? +(A.fire[0][0] - A.cmd).toFixed(3) : -1, dmg: A.dmg[0] ? +(A.dmg[0][0] - A.cmd).toFixed(3) : -1, dash: moveStart ? +(moveStart[0] - A.cmd).toFixed(3) : -1, locked: free ? +(free[0] - A.cmd).toFixed(3) : (states.every(x => ["idle", "move", "attack"].includes(x)) ? 0 : -1), states: states.join(">"), clip: (f.find(r => r[4] === "cast" || r[4] === "channel" || r[4] === "lock") ?? [])[5] ?? "" };
      // B：按下以后一直狂点移动（像玩家想走）：多久开始走；技能有没有照样放出来
      await setup(); await ev("__fm.start()"); await ev(castJs(k)); await ev("(() => { const p = __play.pos, e = __arena.dummy; __fm.rec.spam = [p.x + (p.z - e.z) * 1.6, p.z - (p.x - e.x) * 1.6]; })()");
      await waitSim(3.2); await ev("__fm.rec.spam = null; __play.actor.stop(); 1"); await until("['idle','move','attack'].includes(__play.actor.state())", 6); const B = await ev("__fm.stop()");
      const fb = B.fr.filter(r => r[0] >= B.cmd), mvB = fb.find(r => r[4] === "move");
      s.moveAfter = mvB ? +(mvB[0] - B.cmd).toFixed(3) : -1; s.firedWhileSpamMove = B.fire.length > 0;
      R.skills[k] = s;
    }
    // ---------------- 排队 ----------------
    R.queue = {};
    const k1 = keys.find(k => k !== "R") ?? keys[0], k2 = keys.find(k => k !== k1 && k !== "R") ?? "R";
    // 放 k1，0.08 秒后按 k2
    await setup(); await ev("__fm.start()"); await ev(castJs(k1)); await ev(`__fm.rec.then = { at: __sim.time + 0.08, fn: () => { const a = __play.actor, d = a.skill('${k2}'), e = __arena.dummy; __fm.rec.k2ok = __play.cast('${k2}', e.x, e.z, d.cast === 'unit' ? (d.target === 'ally' ? a.ent : e) : null); } }; 1`);
    await waitSim(4); await until("['idle','move','attack'].includes(__play.actor.state())", 8); { const q = await ev("__fm.stop()"); const f2 = q.fire.find(r => r[1] === k2); R.queue.skillDuringSkill = { pair: k1 + "→" + k2, accepted: q.k2ok, fired: !!f2, at: f2 ? +(f2[0] - q.cmd).toFixed(3) : -1 }; }
    // 放 k1，0.08 秒后点一下地面
    await setup(); await ev("__fm.start()"); await ev(castJs(k1)); await ev(`__fm.rec.then = { at: __sim.time + 0.08, fn: () => { const p = __play.pos, e = __arena.dummy; __play.moveTo(p.x + (p.z - e.z) * 1.6, p.z - (p.x - e.x) * 1.6); } }; 1`);
    await waitSim(3); { const q = await ev("__fm.stop()"); const mvq = q.fr.find(r => r[0] > q.cmd && r[4] === "move"); R.queue.moveDuringSkill = { key: k1, moved: !!mvq, at: mvq ? +(mvq[0] - q.cmd).toFixed(3) : -1 }; }
    await ev("__play.actor.stop(); 1");
    // 放 k1，0.08 秒后点对面的小兵
    await setup(); await ev("__fm.start()"); await ev(castJs(k1)); await ev(`__fm.rec.then = { at: __sim.time + 0.08, fn: () => __play.attack(__arena.foes[0]) }; 1`);
    await waitSim(4); { const q = await ev("__fm.stop()"); const hit = (q.shot.find(r => r[1] === q.fr && 0) ?? null); const f0 = await ev("__arena.foes[0].id"); const h1 = [...q.shot, ...q.dmg].filter(r => r[1] === f0).sort((p, q2) => p[0] - q2[0])[0]; R.queue.attackDuringSkill = { key: k1, attacked: !!h1, at: h1 ? +(h1[0] - q.cmd).toFixed(3) : -1 }; void hit; }
    await ev("__play.actor.stop(); 1");
    // ---------------- 鼠标：真实时间 ----------------
    await ev("__setSpeed(1); __fm.fresh(); __play.actor.stop(); __play.actor.teleport(__fm.x0, __fm.z0); 1"); await sleep(600);
    R.mouse = {};
    for (const btn of ["left", "right"]) {
      await ev("__play.actor.stop(); __play.actor.teleport(__fm.x0, __fm.z0); 1"); await sleep(500);
      const [cx, cy] = await ev(`(() => { const [dx, dz] = __fm.openDir(__fm.x0, __fm.z0, 6); return __screen(__fm.x0 + dx * 5, __fm.z0 + dz * 5, 0); })()`);
      await ev(`(() => { const p = __play.pos, x = p.x, z = p.z; window.__mm = { down: 0, moved: 0 }; addEventListener('pointerdown', () => { if (!__mm.down) __mm.down = performance.now(); }, { capture: true, once: true }); const chk = () => { if (Math.hypot(__play.pos.x - x, __play.pos.z - z) > 0.02) { __mm.moved = performance.now(); return; } requestAnimationFrame(chk); }; requestAnimationFrame(chk); })()`);
      await page.mouse.move(cx, cy); await page.mouse.down({ button: btn }); await sleep(120); await page.mouse.up({ button: btn }); await sleep(900);
      const mm = await ev("__mm"); R.mouse[btn] = mm.moved ? Math.round(mm.moved - mm.down) : -1;
    }
    R.errors = errors;
    ALL[id] = R; console.log(JSON.stringify(R));
    await page.close();
  }
} finally { fs.writeFileSync(out, JSON.stringify(ALL, null, 1)); await browser.close(); }
