// 自动驾驶（录制用）：直道和小弯沿赛车线抓地跑（复用 AI 的走线、避让、脱困），
// 转角大的弯提前刹到入弯速度、摆到弯外侧，带着方向拉一下手刹甩尾，再用"手柄式"连续方向维持漂移
// （弧线不够紧就拉住手刹收紧），车头对准出口后收车。走的是玩家的街机漂移输入，所以漂移的样子和玩家自己开的一样。
// 每个弯的参数（入弯速度、甩尾点、外摆、瞄点外偏）是用 tools/autopilot_tune.mjs 离线搜出来的，见 ZONE_TUNE。
import { DRIFT } from './physics.js';
import { Driver } from './ai.js';

const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const wrap = (x) => { while (x > Math.PI) x -= 2 * Math.PI; while (x < -Math.PI) x += 2 * Math.PI; return x; };
const sstep = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };

// 赛车线上转角超过 minTurn 的弯：起止里程、方向（+1 左弯）、最小半径
export function driftZones(T, minTurn = 1.05) {
  const N = T.N, k = T.lineK, out = [];
  let cur = null;
  const close = (i) => { cur.s1 = i * T.ds; if (Math.abs(cur.turn) > minTurn) out.push(cur); cur = null; };
  for (let n = 0; n < N + 1; n++) {
    const i = n % N, on = Math.abs(k[i]) > 1 / 110, sg = Math.sign(k[i]);
    if (cur && (!on || sg !== cur.dir || n === N)) close(n);
    if (on && !cur && n < N) cur = { s0: i * T.ds, dir: sg, turn: 0, rmin: 1e9 };
    if (cur) { cur.turn += k[i] * T.ds; cur.rmin = Math.min(cur.rmin, 1 / Math.max(1e-4, Math.abs(k[i]))); }
  }
  out.forEach((z, i) => { z.i = i; z.len = z.s1 - z.s0; z.vEntry = clamp(Math.sqrt(z.rmin) * 3.15, 14.5, 22.5); });   // 入弯速度（米/秒）基准：R44 → 75 km/h
  return out;
}

// vk 入弯速度倍数 · lead 甩尾点再提前几米 · app 入弯前摆到弯外几米（null = 不摆，走赛车线）· outE 前半段瞄点再往外几米 · hbOn 偏外多少拉手刹
export const PILOT_DEFAULTS = { vk: 1, lead: 0, app: null, appD: 70, outE: 0, out: 1.5, outP: 0.6, la: 12, lv: 0.4, inTh: -0.25, hbOn: 0.1, hbOff: 0.03, hbThr: 1, vh: 1.08, vgain: 2, tmin: 0.22 };
export const ZONE_TUNE = [
  { vk: 1, lead: 0, app: null, outE: 0, hbOn: 0.16 },          // T1   右 87°  R44
  { vk: 0.9, lead: -3, app: null, outE: 1.5, hbOn: 0.16 },     // T3   右 132° R30
  { vk: 1.1, lead: 0, app: null, outE: 0, hbOn: 0.16 },        // T5   左 100° R26
  { vk: 1.1, lead: 4, app: 3.2, outE: 3, hbOn: 0.06 },         // T6   右 192° R19 发卡弯：先摆到外侧、早点甩
  { vk: 1, lead: 0, app: null, outE: 0, hbOn: 0.16 },          // T8   右 82°  R36
];

export class AutoPilot {
  constructor(car, T, profile, opts = {}) {
    this.car = car; this.T = T;
    this.driver = new Driver(car, T, profile, { skill: opts.skill ?? 0.9, lineBias: 0 });
    this.zones = opts.zones || driftZones(T);
    this.tune = opts.tune || ZONE_TUNE;
    this.phase = 'cruise'; this.zone = null; this.t = 0; this.offT = 0; this.stuckT = 0; this.hbHold = false;
    this.stats = { kicks: 0 };
    this.onStuck = opts.onStuck || null;      // 卡死太久时的回调（游戏里用来复位）
  }
  params(z) { return { ...PILOT_DEFAULTS, ...(this.tune[z.i] || {}), ...(globalThis.__AP || {}), ...((globalThis.__APZ || {})[z.i] || {}) }; }
  // 前方最近的漂移弯（相对里程 > -5 m）
  nextZone() {
    const c = this.car, T = this.T; let best = null, bd = 1e9;
    for (const z of this.zones) { const d = T.deltaS(z.s0, c.s); const dd = d < -5 ? d + T.L : d; if (dd < bd) { bd = dd; best = z; } }
    return { z: best, d: bd };
  }
  // 前方 ahead 米内、横向 lat 米内有没有别的车
  traffic(others, ahead, lat) {
    const c = this.car, T = this.T;
    for (const o of others || []) { if (o === c) continue; const g = T.deltaS(o.s, c.s); if (g > -2 && g < ahead && Math.abs(o.d - c.d) < lat + Math.min(g, 30) * 0.1) return true; }
    return false;
  }
  arcadeInput(steer, thr, brk, hb) { return { steer: clamp(steer, -1, 1), throttle: thr, brake: brk, handbrake: hb, analog: true, tc: true, arcade: true }; }
  update(dt, others) {
    const c = this.car, T = this.T, v = c.speed;
    this.t += dt;
    this.offT = c.offTrack ? this.offT + dt : 0;
    this.stuckT = v < 1.5 ? this.stuckT + dt : 0;
    if (this.stuckT > 4 && this.onStuck) { this.onStuck(); this.stuckT = 0; this.phase = 'cruise'; }
    const lost = Math.abs(c.beta) > 1.25 || this.offT > 0.6;
    if (lost && this.phase !== 'cruise') this.phase = 'recover';

    if (this.phase === 'cruise' || this.phase === 'approach') {
      this.phase = 'cruise';
      const { z, d } = this.nextZone(), P = z ? this.params(z) : PILOT_DEFAULTS, vE = z ? z.vEntry * P.vk : 0;
      const toKick = d - (7 + v * 0.12 + P.lead);                    // 甩尾点：转入点前几米
      // 接近漂移弯的一段先把车摆到弯外侧（走线偏好 = 目标横向位置 − 赛车线位置）
      const near = z && P.app !== null && toKick < P.appD && toKick > -3;
      const want = near ? -z.dir * P.app - T.lineD[T.idx(c.s + 6 + v * 0.3)] : 0;
      this.driver.lineBias += clamp(want - this.driver.lineBias, -4 * dt, 4 * dt);
      const inp = { ...this.driver.update(dt, others) };
      // 抓地跑时再加一点按侧滑角的反打和收油（AI 的开法对中置引擎车阻尼不够，出发卡弯后会钟摆式甩尾）
      const cs = (globalThis.__AP || {}).cs ?? 0.8;
      inp.steerAngle += cs * c.beta; if (Math.abs(c.beta) > 0.08) inp.throttle *= clamp(1.3 - Math.abs(c.beta) * 4, 0.2, 1);
      // 跟车：前方 30 m、横向 3 m 内有车就按距离限速，不往别人身上挤（录制时画面干净）
      let vCap = 1e9;
      for (const o of others || []) { if (o === c) continue; const g = T.deltaS(o.s, c.s); if (g > 0 && g < 30 && Math.abs(o.d - c.d) < 3) vCap = Math.min(vCap, o.speed + (g - 9) * 0.45); }
      if (z && toKick < (v * v - vE * vE) / (2 * 7.5) + 6 + v * 0.25 && toKick > -3) {
        this.phase = 'approach';
        if (v > vE + 0.6) { inp.throttle = 0; inp.brake = clamp((v - vE) * 0.5, 0.25, Math.abs(c.beta) > 0.1 ? 0.35 : 1); }
        else { inp.brake = 0; inp.throttle = clamp((vE - v) * 0.4 + 0.25, 0, 1); }
      }
      if (v > vCap) { inp.throttle = 0; inp.brake = Math.max(inp.brake, clamp((v - vCap) * 0.3, 0.1, 0.8)); }
      if (z && toKick <= 0 && toKick > -3 && v > 9) {
        if (this.traffic(others, 45, 4)) { this.skipZone = z; }          // 弯里前面有车：这个弯不漂，跟在后面抓地过（AI 的避让会接管）
        else if (this.skipZone !== z) { this.phase = 'kick'; this.zone = z; this.t = 0; this.stats.kicks++; }
      }
      if (this.skipZone && T.deltaS(c.s, this.skipZone.s1) > 0) this.skipZone = null;
      if (this.phase !== 'kick') return inp;
    }
    const z = this.zone, P = z ? this.params(z) : PILOT_DEFAULTS;
    if (!z && this.phase !== 'recover') this.phase = 'recover';
    if (this.phase === 'kick') {
      if (this.t < (z.rmin < 25 ? 0.38 : 0.28)) return this.arcadeInput(z.dir, 0, 0, true);
      this.phase = 'hold'; this.t = 0; this.hbHold = false;
    }
    if (this.phase === 'hold') {
      // 看着前方赛车线（前半段瞄点往弯外偏，晚切弯心）：行进方向偏外就往弯里给方向，偏内就放松
      const prog = T.deltaS(c.s, z.s0) / z.len;
      const out = P.out + P.outE * (1 - sstep(prog / P.outP));
      const lp = this.driver.linePoint(c.s + P.la + v * P.lv, -z.dir * out);
      const e = wrap(Math.atan2(lp.y - c.y, lp.x - c.x) - (c.yaw + c.beta));
      let steer = e * 4.2;
      if (c.drifting && e * z.dir > P.inTh) steer = z.dir > 0 ? Math.max(0.2, steer) : Math.min(-0.2, steer);
      // 估"现在松手车最后朝哪"：对准出弯方向且过了弯心就收车
      const kA = T.idx(c.s + 22), kB = T.idx(c.s + 24), thA = Math.atan2(T.py[kB] - T.py[kA], T.px[kB] - T.px[kA]);
      const finalH = c.yaw + c.beta * (1 - DRIFT.noseShare);
      if (this.traffic(others, 14, 3) || (prog > 0.5 && this.t > 0.6 && Math.abs(wrap(thA - finalH)) < 0.07) || T.deltaS(c.s, z.s1) > 6 || (!c.drifting && this.t > 0.5)) { this.phase = 'exit'; this.t = 0; }
      else {
        const vT = z.vEntry * P.vk * P.vh + Math.max(0, prog) * P.vgain;        // 漂移中的目标车速
        const thr = clamp(P.tmin + (vT - v) * 0.35, P.tmin, 1);                  // 至少留点油门，松油超过 0.3 秒漂移就会收掉
        // 弧线不够紧（行进方向比目标偏外）就拉住手刹：手刹时漂移角更大，弧线半径能收到约 25 m
        const wide = e * z.dir;
        this.hbHold = this.hbHold ? wide > P.hbOff : wide > P.hbOn;
        return this.arcadeInput(this.hbHold ? z.dir : steer, this.hbHold ? P.hbThr : thr, 0, this.hbHold);
      }
    }
    if (this.phase === 'exit') {
      if (!c.drifting || this.t > 1.2) { this.phase = 'cruise'; this.zone = null; return this.driver.update(dt, others); }
      return this.arcadeInput(0, 0.5, 0, false);
    }
    // recover：交给 AI 抓地开法（它会限速、脱困倒车），直到车身摆正回到路面
    if (!lost && Math.abs(c.beta) < 0.3 && !c.offTrack) this.phase = 'cruise';
    return this.driver.update(dt, others);
  }
}
