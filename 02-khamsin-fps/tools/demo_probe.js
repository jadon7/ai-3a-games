// 自动对战验收探针（开发用）：在浏览器控制台里 `await import('/tools/demo_probe.js')` 后用 __t.run(秒) 推进并统计。
// 统计：各机动次数、击杀 / 阵亡、视角单帧变化与二阶差分的最大值、最长原地停滞、NPC 铁驭的机动次数。
const d = window.__dbg, g = d.game, p = g.player;
window.__errs = window.__errs || []; window.addEventListener('error', (e) => window.__errs.push(e.message + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno));
const cerr = console.error; console.error = (...a) => { window.__errs.push(a.map(String).join(' ').slice(0, 200)); cerr.apply(console, a); };
// 击杀来源统计：谁（玩家 / 铁驭 / 步兵…）杀了谁
const tally = window.__tally = {}; { const ok = g.onKill.bind(g); g.onKill = (v, k, info) => { const key = (k ? (k === p || k.isPlayerMech ? 'player' : k.kind + k.team) : 'env') + '>' + v.kind + v.team; tally[key] = (tally[key] || 0) + 1; return ok(v, k, info); }; }
const T = window.__t = {
  samples: [], maxDy: 0, maxDp: 0, maxD2y: 0, maxD2p: 0, ly: null, lp: 0, ldy: 0, ldp: 0, simT: 0, err: null, trace: [], mechT: 0, deadT: 0, npc: {},
  start() {   // 冻结 rAF 主循环（调试机位），只由本探针推进；开一局自动对战并跳过开场
    d.view = { pos: [0, 80, 0], look: [0, 0, 0.1] }; d.demo(true);
    this.samples = []; this.maxDy = this.maxDp = this.maxD2y = this.maxD2p = 0; this.ly = null; this.simT = 0; this.err = null; this.trace = []; this.mechT = 0; this.deadT = 0; this.npc = {};
    p.stats = { wallrunTime: 0, maxSpeed: 0, slides: 0, grapples: 0, djumps: 0, walljumps: 0, wallruns: 0, mantles: 0 }; g.weapons.stats = { shots: 0, hits: 0 };
  },
  run(sec, dt = 1 / 60, rep = true) {
    const n = Math.round(sec / dt);
    try {
      for (let i = 0; i < n; i++) {
        d.step(1, dt, 0); this.simT += dt;
        if (g.state !== 'playing') continue;
        if (p.inMech) this.mechT += dt; if (!p.alive) this.deadT += dt;
        if (p.alive && !p.inMech) {
          if (this.ly !== null) {
            let dy = p.yaw - this.ly; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI; const dp = p.pitch - this.lp;
            this.maxDy = Math.max(this.maxDy, Math.abs(dy)); this.maxDp = Math.max(this.maxDp, Math.abs(dp));
            if (this.d1ok) { this.maxD2y = Math.max(this.maxD2y, Math.abs(dy - this.ldy)); this.maxD2p = Math.max(this.maxD2p, Math.abs(dp - this.ldp)); }   // 二阶差分要连续三帧都有效
            this.ldy = dy; this.ldp = dp; this.d1ok = true;
          }
          this.ly = p.yaw; this.lp = p.pitch;
        } else { this.ly = null; this.ldy = 0; this.ldp = 0; this.d1ok = false; }
        if ((g.frame % 30) === 0) this.samples.push([this.simT, p.alive && !p.inMech ? 1 : 0, p.pos.x, p.pos.y, p.pos.z]);
        if ((g.frame % 60) === 0) for (const x of g.actors) if (x.kind === 'pilot') { const s = x.body.stats; this.npc[x.mesh.id] = [x.team, s.slides, +s.wallrunTime.toFixed(1), s.djumps, s.grapples, s.walljumps, x.brain.stat.stuckMax]; }
      }
    } catch (e) { this.err = String(e && e.stack || e).slice(0, 700); }
    return rep ? this.report() : null;
  },
  // 最长原地停滞：存活且不在机甲里时，停留在某个采样点 1.5 m 半径内的最长时间
  stagn() { const S = this.samples; let best = 0, at = null; for (let i = 0; i < S.length; i++) { if (!S[i][1]) continue; let j = i; while (j + 1 < S.length && S[j + 1][1] && Math.hypot(S[j + 1][2] - S[i][2], S[j + 1][3] - S[i][3], S[j + 1][4] - S[i][4]) < 1.5) j++; const dur = S[j][0] - S[i][0]; if (dur > best) { best = dur; at = [+S[i][0].toFixed(1), +S[i][2].toFixed(1), +S[i][3].toFixed(1), +S[i][4].toFixed(1)]; } } return [+best.toFixed(2), at]; },
  report() {
    const st = p.stats, gs = g.stats, a = g.auto; const npc = { 0: [0, 0, 0, 0, 0, 0, 0, 0], 1: [0, 0, 0, 0, 0, 0, 0, 0] };
    for (const k in this.npc) { const r = this.npc[k], o = npc[r[0]]; o[0]++; for (let i = 1; i < 6; i++) o[i] += r[i]; o[6] = Math.max(o[6], r[6]); }
    return { simT: +this.simT.toFixed(1), state: g.state, matchT: +g.matchT.toFixed(1), score: g.score.slice(), err: this.err, errs: window.__errs.slice(0, 6), hp: Math.round(p.hp), mechT: +this.mechT.toFixed(1), deadT: +this.deadT.toFixed(1),
      slides: st.slides, wallrunT: +st.wallrunTime.toFixed(1), wallruns: st.wallruns, walljumps: st.walljumps, djumps: st.djumps, grapples: st.grapples, mantles: st.mantles, maxSpeed: +st.maxSpeed.toFixed(1),
      kills: gs.kills, deaths: gs.deaths, head: gs.headshots, shots: g.weapons.stats.shots, hits: g.weapons.stats.hits, brain: a ? { ...a.stat, mode: a.mode } : null,
      aim: { maxDy: +this.maxDy.toFixed(4), maxDp: +this.maxDp.toFixed(4), maxD2y: +this.maxD2y.toFixed(4), maxD2p: +this.maxD2p.toFixed(4) }, stagn: this.stagn(),
      npc: { friend: { n: npc[0][0], slides: npc[0][1], wallrunT: +npc[0][2].toFixed(1), djumps: npc[0][3], grapples: npc[0][4], walljumps: npc[0][5], stuckMax: npc[0][6] }, enemy: { n: npc[1][0], slides: npc[1][1], wallrunT: +npc[1][2].toFixed(1), djumps: npc[1][3], grapples: npc[1][4], walljumps: npc[1][5], stuckMax: npc[1][6] } } };
  },
  // 卡顿点记录：水平速度 < 1.2 m/s 持续 0.8 秒时记一条现场
  watch(sec) {
    const a = g.auto; const stalls = this.stalls || (this.stalls = []); let low = this._low || 0; const t0 = performance.now();
    for (let k = 0; k < 60 * sec; k++) {
      this.run(1 / 60, 1 / 60, false); if (g.state !== 'playing' || !a) break;
      if (p.alive && !p.inMech && p.speedH < 1.2 && Math.abs(p.vel.y) < 1) {
        low += 1 / 60;
        if (Math.abs(low - 0.8) < 0.009) { const w = a.path && a.path[a.pathI]; stalls.push([this.simT.toFixed(1), a.mode, a.tempo, p.pos.x.toFixed(1) + ',' + p.pos.y.toFixed(1) + ',' + p.pos.z.toFixed(1), 'wp ' + (w ? w.x.toFixed(1) + ',' + w.z.toFixed(1) : 'none') + ' i' + a.pathI + '/' + (a.path ? a.path.length : 0), 'goal ' + (a.goal ? a.goal.x.toFixed(0) + ',' + a.goal.z.toFixed(0) : '-'), 'mov' + (a.moving ? 1 : 0), 'still' + a.still, 'hold' + a.aimHold.toFixed(2), 'clr' + a.clr.toFixed(1), 'seg' + a.seg.toFixed(1), a.wall ? 'wall' : '', a.grap ? 'grap' + a.grap.state : '', a.tgt ? a.tgt.kind + (a.tgtVis ? '+' : '-') : '', 'gnd' + (p.onGround ? 1 : 0), 'cr' + (p.crouching ? 1 : 0), 'ax' + a.vin.axis.f.toFixed(1) + '/' + a.vin.axis.s.toFixed(1), 'detour' + a.detourT.toFixed(1)].join(' ')); }
      } else low = 0;
    }
    this._low = low; return { wall: Math.round(performance.now() - t0), simT: +this.simT.toFixed(1), state: g.state, kd: g.stats.kills + '/' + g.stats.deaths, score: g.score.join(':'), stalls: stalls.length };
  },
  // 每 0.5 秒一行的状态轨迹（调行为用）
  log(sec) { const a = g.auto, W = g.weapons, out = []; for (let k = 0; k < sec * 2; k++) { this.run(0.5, 1 / 60, false); const tg = a && a.tgt; out.push([this.simT.toFixed(1), a ? a.mode + '/' + a.tempo[0] : '-', tg ? tg.kind + (a.tgtVis ? '+' : '-') + (a.out.dist | 0) : '', 'n' + (a ? a.nearVis : 0), 'hp' + (p.hp | 0), W.cur[0] + W.ammo[W.cur], p.pos.x.toFixed(0) + ',' + p.pos.y.toFixed(0) + ',' + p.pos.z.toFixed(0), 'v' + p.speedH.toFixed(0), (p.sliding ? 'S' : '') + (p.wr.on ? 'W' : '') + (p.onGround ? '' : 'A') + (p.grapple.state ? 'G' + p.grapple.state : '') + (p.inMech ? 'M' : ''), 'k' + g.stats.kills + 'd' + g.stats.deaths, 'sh' + W.stats.shots + '/' + W.stats.hits].join(' ')); } return out.join('\n'); },
};
