// AI 车手：沿赛车线做纯追踪转向 + 速度剖面跟随，带牵引力控制和简单的避让
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;

export class Driver {
  constructor(car, track, profile, opts = {}) {
    this.car = car; this.track = track; this.profile = profile;
    this.skill = opts.skill ?? 0.96;          // 速度剖面的缩放
    this.lineBias = opts.lineBias ?? 0;       // 偏离赛车线的个人习惯（米）
    this.avoid = 0; this.input = { steerAngle: 0, throttle: 0, brake: 0, handbrake: false };
    this.stuckT = 0; this.reverseT = 0;
  }
  linePoint(s, extra) {
    const T = this.track, f = T.wrapS(s) / T.ds, i = Math.floor(f) % T.N, j = (i + 1) % T.N, t = f - Math.floor(f);
    const d = (T.lineD[i] * (1 - t) + T.lineD[j] * t) + extra;
    const lim = 4.4; const dd = clamp(d, -lim, lim);
    const cx = T.px[i] * (1 - t) + T.px[j] * t, cy = T.py[i] * (1 - t) + T.py[j] * t;
    const hx = T.hx[i], hy = T.hy[i];
    return { x: cx - hy * dd, y: cy + hx * dd };
  }
  update(dt, others) {
    const c = this.car, T = this.track, v = c.speed, inp = this.input;
    // ---- 避让：前方近处有车就横向让开，并且不追尾 ----
    let targetAvoid = 0, vCap = 1e9;
    for (const o of others) {
      if (o === c) continue;
      const gap = T.deltaS(o.s, c.s);
      if (gap < 1.5 || gap > 10 + v * 0.7) continue;
      const lat = o.d - c.d;
      if (Math.abs(lat) < 2.3) {
        const side = lat > 0 ? -1 : 1;                    // 往空的一侧走
        const room = side > 0 ? 4.6 - o.d : o.d + 4.6;
        if (room > 2.4) targetAvoid = side * (2.5 - Math.abs(lat)) * 1.2;
        else vCap = Math.min(vCap, o.speed + (gap - 5) * 0.6);
        if (gap < 7 && Math.abs(lat) < 1.6) vCap = Math.min(vCap, o.speed + (gap - 4.5) * 0.8);
      }
    }
    this.avoid += clamp(targetAvoid - this.avoid, -2.5 * dt, 2.5 * dt);
    // ---- 转向：纯追踪 ----
    const la = 5.5 + v * 0.30;
    const tp = this.linePoint(c.s + la, this.lineBias + this.avoid);
    const dx = tp.x - c.x, dy = tp.y - c.y, cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
    const lx = dx * cy + dy * sy, ly = -dx * sy + dy * cy;
    const dist2 = lx * lx + ly * ly;
    let steer = Math.atan(2 * c.spec.wheelbase * ly / Math.max(1, dist2)) * 1.15;
    // 横摆阻尼：抑制高速时的甩尾
    steer -= c.r * 0.035 * clamp(v / 30, 0, 1.3);
    inp.steerAngle = steer;
    // ---- 速度 ----
    const iAhead = T.idx(c.s + 2 + v * 0.12);
    let vt = Math.min(this.profile[iAhead] * this.skill, vCap);
    if (c.offTrack) vt = Math.min(vt, 16);
    const err = vt - v;
    let thr = clamp(err * 0.6 + 0.25, 0, 1), brk = err < -0.6 ? clamp(-err * 0.28, 0, 1) : 0;
    if (brk > 0) thr = 0;
    // 侧向已用掉的抓地力越多，油门越保守；侧滑时收油
    const latUse = Math.min(1, Math.abs(c.ayF) / 9.6);
    thr *= clamp(1.15 - latUse * latUse * 0.75, 0.3, 1);
    thr *= clamp(1.2 - Math.abs(c.beta) * 4.0, 0.15, 1);
    inp.throttle = thr; inp.brake = brk; inp.handbrake = false; inp.tc = 0.045;
    // ---- 卡住脱困：撞墙停住就倒一下 ----
    if (v < 1.2 && this.reverseT <= 0) this.stuckT += dt; else this.stuckT = 0;
    if (this.stuckT > 1.6) { this.reverseT = 1.4; this.stuckT = 0; }
    if (this.reverseT > 0) { this.reverseT -= dt; inp.throttle = 0; inp.brake = 0.8; inp.steerAngle = -steer; inp.autoReverse = true; } else inp.autoReverse = c.reverse;
    return inp;
  }
}
