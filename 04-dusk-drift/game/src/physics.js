// 车辆动力学（纯数学，可在 node 里单测）
// 四轮模型：每个车轮有自己的转速，轮胎力用"归一化合成滑移 + 魔术公式"计算，
// 包含纵向/横向载荷转移、后轮驱动（锁止差速）、手刹、ABS、自动挡、护栏碰撞。
// 车身坐标：x 向前、y 向左；航向角逆时针为正；与 track.js 的平面坐标一致。
import { SURF, HALF_W } from './track.js';

const G = 9.81, RHO = 1.2;
const VMIN_X = 2.5, VMIN_Y = 2.0;
const SX_PEAK = 0.10, SY_PEAK = Math.tan(8.5 * Math.PI / 180);
const MF_C = 1.27, MF_B = Math.tan(Math.PI / (2 * MF_C));   // 峰值恰在归一化滑移 = 1，完全滑动时约 0.91
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// 路面：抓地系数、滚阻系数、颠簸幅度
export const SURFACE = {
  [SURF.ASPHALT]: { mu: 1.10, rr: 0.014, bump: 0.0 },
  [SURF.KERB]: { mu: 0.92, rr: 0.02, bump: 0.012 },
  [SURF.GRASS]: { mu: 0.56, rr: 0.09, bump: 0.02 },
  [SURF.GRAVEL]: { mu: 0.62, rr: 0.17, bump: 0.03 },
};

const TORQUE_CURVE = [[800, 0.5], [2000, 0.68], [3500, 0.84], [5000, 0.96], [6200, 1.0], [7400, 0.95], [8200, 0.84], [8600, 0.6]];
function torqueShape(rpm) {
  const c = TORQUE_CURVE;
  if (rpm <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) if (rpm < c[i][0]) { const t = (rpm - c[i - 1][0]) / (c[i][0] - c[i - 1][0]); return lerp(c[i - 1][1], c[i][1], t); }
  return c[c.length - 1][1];
}

export const CAR_SPECS = {
  e30: {
    label: 'BMW M3 E30', mass: 1040, izz: 1480, wheelbase: 2.565, cgFront: 1.27, trackF: 1.42, trackR: 1.44, cgH: 0.46,
    wheelR: 0.31, length: 4.36, width: 1.70, frontOverhang: 0.82, rearOverhang: 0.98,
    torque: 325, redline: 8300, idle: 1100, gears: [2.9, 2.05, 1.55, 1.24, 1.0], final: 4.1,
    cdA: 0.72, clA: 0.55, brakeForce: 1.28, brakeBias: 0.63, rollFront: 0.56, muScale: 1.0,
  },
  capri: {
    label: 'Ford Capri Gr.5', mass: 1000, izz: 1500, wheelbase: 2.56, cgFront: 1.24, trackF: 1.50, trackR: 1.52, cgH: 0.44,
    wheelR: 0.33, length: 4.6, width: 1.92, frontOverhang: 0.95, rearOverhang: 1.08,
    torque: 400, redline: 8000, idle: 1200, gears: [2.8, 2.0, 1.52, 1.22, 1.0], final: 3.9,
    cdA: 0.85, clA: 0.95, brakeForce: 1.3, brakeBias: 0.62, rollFront: 0.55, muScale: 1.02,
  },
  stratos: {
    label: 'Lancia Stratos HF', mass: 940, izz: 1150, wheelbase: 2.18, cgFront: 1.24, trackF: 1.43, trackR: 1.46, cgH: 0.44,
    wheelR: 0.30, length: 3.71, width: 1.75, frontOverhang: 0.72, rearOverhang: 0.81,
    torque: 310, redline: 8400, idle: 1200, gears: [2.95, 2.1, 1.58, 1.25, 1.0], final: 4.0,
    cdA: 0.62, clA: 0.45, brakeForce: 1.28, brakeBias: 0.58, rollFront: 0.58, muScale: 1.0,
  },
  // 以下 10 台：尺寸在加载模型时按清单覆盖，这里的数值只决定手感（本作所有车都按后驱模拟）
  escort: {
    label: 'Ford Escort RS Cosworth', mass: 1180, izz: 1700, wheelbase: 2.50, cgFront: 1.20, trackF: 1.61, trackR: 1.61, cgH: 0.50,
    wheelR: 0.32, length: 4.2, width: 1.9, frontOverhang: 0.85, rearOverhang: 0.86,
    torque: 400, redline: 7600, idle: 1100, gears: [2.85, 2.0, 1.52, 1.22, 1.0], final: 4.0,
    cdA: 0.82, clA: 0.75, brakeForce: 1.28, brakeBias: 0.6, rollFront: 0.55, muScale: 1.0,
  },
  p917: {
    label: 'Porsche 917K', mass: 900, izz: 1350, wheelbase: 2.35, cgFront: 1.36, trackF: 1.59, trackR: 1.66, cgH: 0.38,
    wheelR: 0.32, length: 4.27, width: 2.0, frontOverhang: 1.0, rearOverhang: 0.92,
    torque: 440, redline: 8400, idle: 1300, gears: [2.7, 1.95, 1.5, 1.21, 1.0], final: 3.7,
    cdA: 0.6, clA: 1.05, brakeForce: 1.32, brakeBias: 0.56, rollFront: 0.56, muScale: 1.03,
  },
  l037: {
    label: 'Lancia 037', mass: 990, izz: 1250, wheelbase: 2.45, cgFront: 1.40, trackF: 1.52, trackR: 1.53, cgH: 0.45,
    wheelR: 0.29, length: 3.92, width: 1.85, frontOverhang: 0.83, rearOverhang: 0.64,
    torque: 330, redline: 8200, idle: 1200, gears: [2.95, 2.1, 1.58, 1.25, 1.0], final: 4.0,
    cdA: 0.66, clA: 0.5, brakeForce: 1.28, brakeBias: 0.57, rollFront: 0.58, muScale: 1.0,
  },
  delta: {
    label: 'Lancia Delta HF Integrale', mass: 1200, izz: 1560, wheelbase: 2.46, cgFront: 1.03, trackF: 1.41, trackR: 1.39, cgH: 0.50,
    wheelR: 0.295, length: 3.9, width: 1.7, frontOverhang: 0.8, rearOverhang: 0.64,
    torque: 390, redline: 7400, idle: 1100, gears: [2.9, 2.05, 1.55, 1.24, 1.0], final: 4.1,
    cdA: 0.78, clA: 0.5, brakeForce: 1.26, brakeBias: 0.64, rollFront: 0.6, muScale: 0.99,
  },
  gt40: {
    label: 'Ford GT40 Mk II', mass: 1000, izz: 1450, wheelbase: 2.35, cgFront: 1.36, trackF: 1.38, trackR: 1.38, cgH: 0.42,
    wheelR: 0.34, length: 4.18, width: 1.8, frontOverhang: 1.1, rearOverhang: 0.73,
    torque: 460, redline: 7200, idle: 1000, gears: [2.6, 1.85, 1.42, 1.15, 0.94], final: 3.8,
    cdA: 0.62, clA: 0.55, brakeForce: 1.26, brakeBias: 0.58, rollFront: 0.57, muScale: 1.0,
  },
  mustang: {
    label: 'Ford Mustang 1969', mass: 1360, izz: 2150, wheelbase: 2.74, cgFront: 1.31, trackF: 1.51, trackR: 1.51, cgH: 0.52,
    wheelR: 0.30, length: 4.76, width: 1.88, frontOverhang: 0.95, rearOverhang: 1.06,
    torque: 540, redline: 7000, idle: 900, gears: [2.55, 1.85, 1.42, 1.15, 0.95], final: 3.7,
    cdA: 0.9, clA: 0.35, brakeForce: 1.22, brakeBias: 0.62, rollFront: 0.54, muScale: 0.98,
  },
  countach: {
    label: 'Lamborghini Countach 5000QV', mass: 1300, izz: 1900, wheelbase: 2.50, cgFront: 1.43, trackF: 1.66, trackR: 1.58, cgH: 0.44,
    wheelR: 0.31, length: 4.2, width: 2.0, frontOverhang: 0.91, rearOverhang: 0.78,
    torque: 500, redline: 7800, idle: 1000, gears: [2.65, 1.9, 1.45, 1.17, 0.97], final: 3.8,
    cdA: 0.7, clA: 0.6, brakeForce: 1.28, brakeBias: 0.58, rollFront: 0.57, muScale: 1.02,
  },
  z280: {
    label: 'Datsun 280Z', mass: 1020, izz: 1450, wheelbase: 2.30, cgFront: 1.12, trackF: 1.49, trackR: 1.49, cgH: 0.47,
    wheelR: 0.32, length: 4.3, width: 1.95, frontOverhang: 1.1, rearOverhang: 0.89,
    torque: 310, redline: 7800, idle: 1000, gears: [2.95, 2.1, 1.58, 1.25, 1.0], final: 4.1,
    cdA: 0.72, clA: 0.45, brakeForce: 1.26, brakeBias: 0.62, rollFront: 0.55, muScale: 1.0,
  },
  s15: {
    label: 'Nissan Silvia S15 LBWK', mass: 1150, izz: 1750, wheelbase: 2.48, cgFront: 1.22, trackF: 1.68, trackR: 1.60, cgH: 0.46,
    wheelR: 0.30, length: 4.75, width: 1.95, frontOverhang: 1.15, rearOverhang: 1.12,
    torque: 410, redline: 8200, idle: 1000, gears: [2.85, 2.02, 1.53, 1.23, 1.0], final: 4.0,
    cdA: 0.84, clA: 0.85, brakeForce: 1.28, brakeBias: 0.6, rollFront: 0.55, muScale: 1.01,
  },
  m190: {
    label: 'Mercedes 190E 2.5-16 Evo', mass: 1100, izz: 1700, wheelbase: 2.70, cgFront: 1.33, trackF: 1.47, trackR: 1.47, cgH: 0.47,
    wheelR: 0.31, length: 4.49, width: 1.8, frontOverhang: 0.76, rearOverhang: 1.03,
    torque: 300, redline: 8600, idle: 1100, gears: [3.0, 2.12, 1.6, 1.27, 1.02], final: 4.2,
    cdA: 0.74, clA: 0.6, brakeForce: 1.28, brakeBias: 0.62, rollFront: 0.56, muScale: 1.0,
  },
};
// 街机式漂移（只给玩家用，照 UMBRA GT 第三版漂移的做法）：
//   带方向拉手刹（或带方向点一脚刹车）立刻进入漂移；
//   方向键决定车身甩多大角度（按住往弯里 = 大角度，松开 / 反打 / 踩刹车 / 松油 = 收车）；
//   车身实际甩出的角度决定行进路线每秒往弯里拐多少，和车速无关，所以漂移是过弯的主要手段；
//   收车时行进方向和车头各让一半，约 0.4 秒收直，车头指哪最后就往哪走。
export const DRIFT = {
  enter: 0.2, exit: 0.1,              // 进入 / 退出漂移的侧滑角（弧度）
  angleHold: 0.45, angleMax: 0.8, angleBrake: 1.1,    // 刚进入 / 往弯里按住 / 拉着手刹时的目标角度
  // 甩到 angleMax 时路线每秒拐多少弧度。UMBRA GT 用 1.5（配 32 米的发卡弯）；本作的弯多是 R40–60，
  // 按住方向在 80 km/h 时弧线半径约 45 米、拉住手刹约 25 米（正好过 T6 发卡），按这个反推出 0.35
  turnMax: 0.35, latCurve: 1.3, latMax: 2.6,
  align: 9, noseHold: 9, noseShare: 0.35,              // 收车：行进方向追车头的快慢、稳车头、追多少（其余由车头往回摆）
  scrub: 0.55, push: 0.5, pushFade: [30, 46],           // 横滑掉速、油门沿车头的推力（g）、推力随车速收掉的区间（米/秒）
  lead: 0.3, drive: 0.6, tireCut: 0.85, rearGrip: 0.8, counterSteer: 0.6,
  lineRate: 2.4, kp: 16, kd: 6.5, kickYaw: 5.5,
};

// 每转点火次数（四冲程：气缸数 / 2），给引擎声音用
export const FIRES = { e30: 2, capri: 3, stratos: 3, escort: 2, p917: 6, l037: 2, delta: 2, gt40: 4, mustang: 4, countach: 6, z280: 3, s15: 2, m190: 2 };

function tyre(vlong, vlat, wR, Fz, mu, out) {
  const sx = (wR - vlong) / Math.max(Math.abs(vlong), VMIN_X);
  const sy = -vlat / Math.max(Math.abs(vlong), VMIN_Y);
  const nx = sx / SX_PEAK, ny = sy / SY_PEAK, rho = Math.hypot(nx, ny);
  out.sx = sx; out.sy = sy; out.rho = rho;
  if (rho < 1e-6 || Fz <= 0) { out.fx = 0; out.fy = 0; return; }
  const F = mu * Fz * Math.sin(MF_C * Math.atan(MF_B * rho));
  let dx = nx / rho, dy = ny / rho;
  if (rho > 1) {   // 打滑后力的方向逐渐对准真实的滑动速度方向
    const svx = wR - vlong, svy = -vlat, sv = Math.hypot(svx, svy);
    if (sv > 0.3) { const t = Math.min(1, (rho - 1) * 0.5); dx = dx * (1 - t) + svx / sv * t; dy = dy * (1 - t) + svy / sv * t; const n = Math.hypot(dx, dy) || 1; dx /= n; dy /= n; }
  }
  out.fx = F * dx; out.fy = F * dy;
}

const _t1 = {}, _t2 = {};

export class Car {
  constructor(specName, opts = {}) {
    const sp = { ...CAR_SPECS[specName], ...(opts.spec || {}) };
    this.specName = specName; this.spec = sp; this.isPlayer = !!opts.isPlayer; this.id = opts.id ?? 0;
    this.a = sp.cgFront; this.b = sp.wheelbase - sp.cgFront;
    this.wheelI = 1.4; this.engineI = 0.13;
    // 车轮顺序：FL, FR, RL, RR
    this.wpos = [[this.a, sp.trackF / 2], [this.a, -sp.trackF / 2], [-this.b, sp.trackR / 2], [-this.b, -sp.trackR / 2]];
    this.wheels = this.wpos.map(() => ({ omega: 0, angle: 0, fz: sp.mass * G / 4, fx: 0, fy: 0, sx: 0, sy: 0, rho: 0, slide: 0, surf: SURF.ASPHALT, wet: 0, wx: 0, wy: 0 }));
    this.assist = opts.assist ?? 1.0;        // 自动反打辅助强度（0–1）
    this.driftSlip = opts.driftSlip ?? 0.42; // 漂移时允许的后轮滑移率
    this.driftAngle = (opts.driftAngle ?? 44) * Math.PI / 180;   // 按住方向键时趋向的最大漂移角
    this.yawDamp = opts.yawDamp ?? 0.4;      // 反打提前量（秒）
    this.steerMax = 42 * Math.PI / 180;
    this.steerSens = opts.steerSens ?? 1;   // 转向灵敏度：方向打到位的快慢 + 中速时能打多大方向（玩家可调，见 STEER_SENS）
    this.reset(0, 0, 0);
  }
  reset(x, y, yaw, speed = 0) {
    this.x = x; this.y = y; this.yaw = yaw; this.vx = speed; this.vy = 0; this.r = 0;
    this.steer = 0; this.steerCmd = 0; this.steerIn = 0; this.throttle = 0; this.brake = 0; this.handbrake = 0;
    this.gear = 1; this.rpm = this.spec.idle; this.shiftT = 0; this.shiftCool = 0; this.reverse = false; this.limiter = 0;
    this.axF = 0; this.ayF = 0; this.ax = 0; this.ay = 0;
    this.roll = 0; this.rollV = 0; this.pitch = 0; this.pitchV = 0; this.heave = 0;
    this.trackI = -1; this.s = 0; this.d = 0; this.hitT = 9; this.hitMag = 0; this.offTrack = false; this.onGravel = false;
    for (const w of this.wheels) { w.omega = speed / this.spec.wheelR; w.angle = 0; w.slide = 0; w.fx = w.fy = 0; }
    this.t = 0; this.wheelspin = 0; this.tcAct = 0; this._betaPrev = 0; this.betaRate = 0;
    this.drifting = false; this.driftArm = 0; this.kickT = 0; this.driftDir = 1; this.driftLine = 0; this.driftTarget = 0;
    this.driftBlend = 0; this.driftOff = 0; this.driftNeutral = 0; this._prevBrk = false;
  }

  // 街机式漂移的状态机：返回这一步要加的路线角速度等（见 DRIFT 的说明）
  _arcadeDrift(dt, si, thr, brk, hb) {
    const D = DRIFT, v = this.speed, vF = this.vx, beta = this.beta;
    const bp = brk > 0.5;
    if (bp && !this._prevBrk && Math.abs(si) > 0.35 && vF > 14) { this.kickT = 0.35; this.driftArm = 0.8; }
    this._prevBrk = bp;
    this.kickT = Math.max(0, this.kickT - dt);
    if (hb && vF > 8) this.driftArm = 0.8;
    this.driftArm = Math.max(0, this.driftArm - dt);
    const onPower = thr > 0.15 || hb;
    if (!this.drifting) {
      const yank = hb && Math.abs(si) > 0.3 && vF > 9;
      const slid = this.driftArm > 0 && Math.abs(beta) > D.enter && v > 11;
      if (yank || slid) {
        this.drifting = true;
        this.driftDir = yank ? Math.sign(si) : (beta < 0 ? 1 : -1);      // +1 = 向左漂（车头指向行进方向左侧）
        this.driftLine = clamp(si * this.driftDir, 0, 1) * 0.6; this.driftOff = 0; this.driftNeutral = 0;
      }
    } else {
      const into = clamp(si * this.driftDir, -1, 1);
      const letGo = Math.abs(si) < 0.15 || into < 0;
      const rate = into > this.driftLine ? D.lineRate : letGo ? D.lineRate * 5 : D.lineRate * 2;
      this.driftLine += (into - this.driftLine) * (1 - Math.exp(-dt * rate));
      this.driftOff = onPower ? 0 : this.driftOff + dt;
      this.driftNeutral = Math.abs(si) < 0.15 ? this.driftNeutral + dt : 0;
      if (hb && into < -0.3 && v > 9) { this.driftDir = -this.driftDir; this.driftLine = 0.6; this.driftNeutral = 0; }   // 反方向再拉手刹：换边（S 弯）
      else if (v < 7 || Math.abs(beta) > 1.35 || this.hitT < 0.05) this.drifting = false;   // 太慢、转过头、撞墙：漂移作废，交还给轮胎
      else if (Math.abs(beta) < D.exit && Math.abs(this.driftTarget) < D.exit * 1.5) this.drifting = false;
    }
    let turn = 0, lat = 0, over = 0;
    if (this.drifting) {
      const p = this.driftLine;
      const fade = this.driftOff > 0.3 || (brk > 0.3 && !hb) ? 0 : 1 - smooth(0, 0.25, this.driftNeutral);
      const hold = D.angleHold * fade;
      let ang = p >= 0 ? hold + (D.angleMax - hold) * p * (fade > 0 || Math.abs(si) > 0.15 ? 1 : 0) : hold * clamp(1 + p * 4, 0, 1);
      if (hb && p > -0.3) ang = Math.max(ang, D.angleBrake);
      this.driftTarget = -this.driftDir * ang;
      const out = Math.max(clamp(-beta * this.driftDir, 0, 1.4), ang * D.lead);
      const k = clamp(Math.sin(out) / Math.sin(D.angleMax), 0, 1.15);
      const cap = D.latMax * G / Math.max(v, 6);
      over = clamp(-beta * this.driftDir - ang, 0, 1.2);
      const closing = smooth(0, 0.1, over);
      const caught = Math.min(over * D.align * D.noseShare, cap * 1.6);
      turn = Math.min(D.turnMax * Math.pow(k, D.latCurve), cap) * (1 - closing);
      lat = (turn + caught) * v;
    } else this.driftTarget = 0;
    this.driftBlend += ((this.drifting ? 1 : 0) - this.driftBlend) * (1 - Math.exp(-dt * (this.drifting ? 6 : 4)));
    return { turn, lat, over };
  }
  get speed() { return Math.hypot(this.vx, this.vy); }
  get beta() { return Math.abs(this.vx) > 2 || Math.abs(this.vy) > 2 ? Math.atan2(this.vy, Math.abs(this.vx)) : 0; }   // 侧滑角

  // input: { steer[-1,1] 左正, throttle, brake, handbrake, steerAngle?（AI 直接给弧度）, gearUp, gearDown }
  step(dt, input, track) {
    const sp = this.spec, W = this.wheels;
    this.t += dt;
    const v = this.speed;
    // ---------- 输入整形 ----------
    let thrIn = input.throttle || 0, brkIn = input.brake || 0;
    if (this.isPlayer || input.autoReverse) {   // 停住后继续踩刹车 = 倒车
      if (!this.reverse && brkIn > 0.1 && thrIn < 0.1 && this.vx < 0.6) this.reverse = true;
      if (this.reverse && thrIn > 0.1 && this.vx > -0.6) this.reverse = false;
      if (this.reverse) { const tmp = thrIn; thrIn = brkIn; brkIn = tmp; }
    }
    if (input.tc) {
      // 牵引力辅助：直线上压住后轮空转；打方向或已经侧滑时放宽到"漂移滑移率"，
      // 让键盘全油门也能维持一个可控的漂移角，而不是一脚油门直接转圈
      let lim, gain;
      if (input.tc === true) {
        const drift = Math.max(smooth(0.07, 0.24, Math.abs(this.beta)), smooth(0.25, 0.8, Math.abs(this.steerIn)) * 0.4);
        this.tcAct += (drift - this.tcAct) * Math.min(1, dt * (drift > this.tcAct ? 12 : 4));
        lim = lerp(0.055, this.driftSlip, this.tcAct); gain = lerp(14, 4.5, this.tcAct);
      } else { lim = input.tc; gain = 16; }
      if (this.wheelspin > lim) thrIn *= clamp(1 - (this.wheelspin - lim) * gain, 0.04, 1);
    }
    const rateT = thrIn > this.throttle ? 6 : 10, rateB = brkIn > this.brake ? 7 : 12;
    this.throttle += clamp(thrIn - this.throttle, -rateT * dt, rateT * dt);
    this.brake += clamp(brkIn - this.brake, -rateB * dt, rateB * dt);
    this.handbrake = input.handbrake ? 1 : 0;
    const arc = input.arcade ? this._arcadeDrift(dt, clamp(input.steer || 0, -1, 1), thrIn, brkIn, !!input.handbrake) : null;
    const dB = arc ? this.driftBlend : 0;

    let target;
    if (input.steerAngle !== undefined) target = this.steerCmd = clamp(input.steerAngle, -this.steerMax, this.steerMax);
    else {
      const si = clamp(input.steer || 0, -1, 1);
      const sens = globalThis.__SENS ?? this.steerSens;
      const rate = (Math.abs(si) > Math.abs(this.steerIn) || si * this.steerIn < 0 ? (input.analog ? 9 : 4.2) : (input.analog ? 12 : 6.5)) * sens;
      this.steerIn += clamp(si - this.steerIn, -rate * dt, rate * dt);
      const vs = 16 * Math.sqrt(sens), range = Math.max(7.5 * Math.PI / 180, this.steerMax / (1 + (v / vs) * (v / vs)));
      // 反打辅助：抓地时（漂移角 < 2°）只用一半力度，车尾滑出（> 6°）才全力。
      // 原来全程满力度时，高速下它会和方向输入形成反馈：点一下方向键，前轮就在 ±4° 来回摆停不下来，方向盘跟着乱甩
      const g = this.assist * smooth(3, 10, v), gGrip = 0.5 + 0.5 * smooth(0.035, 0.1, Math.abs(this.beta));
      const beta = this.beta;
      // 漂移角变化率（低通），用来提前反打，抑制甩尾过冲
      const bRate = clamp((beta - this._betaPrev) / dt, -6, 6); this._betaPrev = beta;
      this.betaRate += (bRate - this.betaRate) * Math.min(1, dt * 25);
      // 已经有漂移角时，继续向弯内打方向的"权限"逐渐收掉：按住方向键 = 维持目标漂移角，而不是无限加角度
      let auth = 1;
      if (si * beta < 0) auth = 1 - smooth(this.driftAngle * 0.3, this.driftAngle, Math.abs(beta)) * this.assist;
      const align = this.vx > 2 ? Math.atan2(this.vy + this.r * this.a, this.vx) : 0;
      this.steerCmd = clamp(this.steerIn * range, -this.steerMax, this.steerMax);   // 只含玩家输入的转角（驾驶位方向盘显示用）
      target = clamp(this.steerIn * range * auth + g * gGrip * (align + this.yawDamp * this.betaRate), -this.steerMax, this.steerMax);
      if (arc && this.drifting) target = clamp(this.steerIn * Math.max(range, 0.3) + beta * DRIFT.counterSteer, -this.steerMax, this.steerMax);   // 漂移中：方向键 + 自动反打
    }
    const dmax = 2.6 * dt;
    this.steer += clamp((target - this.steer) * Math.min(1, dt * 16), -dmax, dmax);
    const cd = Math.cos(this.steer), sd = Math.sin(this.steer);

    // ---------- 载荷 ----------
    const L = sp.wheelbase, m = sp.mass;
    const down = 0.5 * RHO * sp.clA * v * v;
    const fzF = (m * G * this.b / L + down * 0.42) / 2, fzR = (m * G * this.a / L + down * 0.58) / 2;
    const dLong = m * this.axF * sp.cgH / L / 2;
    const dLatF = sp.rollFront * m * this.ayF * sp.cgH / sp.trackF, dLatR = (1 - sp.rollFront) * m * this.ayF * sp.cgH / sp.trackR;
    W[0].fz = Math.max(0, fzF - dLong - dLatF); W[1].fz = Math.max(0, fzF - dLong + dLatF);
    W[2].fz = Math.max(0, fzR + dLong - dLatR); W[3].fz = Math.max(0, fzR + dLong + dLatR);
    const fz0 = m * G / 4;

    // ---------- 路面 ----------
    if (track) {
      const tc = track.toTrack(this.x, this.y, this.trackI, this.trackI < 0 ? 30 : 12);
      this.trackI = tc.i; this.s = tc.s; this.d = tc.d;
      const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
      let off = 0, grav = 0;
      for (let i = 0; i < 4; i++) {
        const p = this.wpos[i], wx = this.x + cy * p[0] - sy * p[1], wy = this.y + sy * p[0] + cy * p[1];
        const wc = track.toTrack(wx, wy, tc.i, 5);
        W[i].surf = track.surface(wc.s, wc.d); W[i].wx = wx; W[i].wy = wy; W[i].ws = wc.s; W[i].wd = wc.d;
        W[i].wet = track.wetnessXY ? track.wetnessXY(wx, wy) : 0;
        if (W[i].surf >= SURF.GRASS) off++; if (W[i].surf === SURF.GRAVEL) grav++;
      }
      this.offTrack = off >= 3; this.onGravel = grav >= 2;
    }

    // ---------- 发动机与变速箱 ----------
    const R = sp.wheelR;
    const ratio = (this.reverse ? -3.2 : sp.gears[this.gear - 1]) * sp.final;
    const wRear = (W[2].omega + W[3].omega) / 2;
    let rpmW = Math.abs(wRear * ratio) * 60 / (2 * Math.PI);
    const clutchSlip = rpmW < sp.idle + 400;
    let rpm = clutchSlip ? Math.max(rpmW, sp.idle + this.throttle * 2600) : rpmW;
    this.shiftT -= dt; this.shiftCool -= dt;
    let engT = 0;
    const shifting = this.shiftT > 0;
    if (!shifting && !this.handbrake) {
      if (rpm >= sp.redline) { engT = -40; this.limiter = 0.08; }
      else if (this.limiter > 0) { this.limiter -= dt; engT = 0; }
      else engT = this.throttle > 0.02 ? sp.torque * torqueShape(rpm) * this.throttle : -(18 + 42 * rpm / 8000) * (clutchSlip ? 0.2 : 1);
    }
    this.rpm += (Math.min(rpm, sp.redline + 60) - this.rpm) * Math.min(1, dt * 22);
    let driveT = engT * ratio * 0.92;                       // 传到后轴的扭矩
    if (!this.reverse && !shifting && this.shiftCool <= 0 && !input.manual) {
      // 自动挡：升挡看后轮转速（空转严重或漂移中不升挡），降挡看车速
      const rpmV = v / R * Math.abs(ratio) * 60 / (2 * Math.PI);
      const drifting = Math.abs(this.beta) > 0.2 && v > 8;
      if (rpmW > sp.redline - 450 && rpmV > rpmW * 0.8 && this.gear < sp.gears.length && !drifting && this.throttle > 0.3) { this.gear++; this.shiftT = 0.11; this.shiftCool = 0.45; }
      else if (this.gear > 1 && !this.handbrake && !(drifting && this.gear <= 2)) {
        const rpmLower = rpmV * sp.gears[this.gear - 2] / sp.gears[this.gear - 1];
        if (rpmLower < (this.throttle > 0.6 ? 6300 : 5600)) { this.gear--; this.shiftT = 0.09; this.shiftCool = 0.35; }
      }
    }
    if (input.manual && this.shiftCool <= 0) {
      if (input.gearUp && this.gear < sp.gears.length) { this.gear++; this.shiftT = 0.1; this.shiftCool = 0.25; }
      if (input.gearDown && this.gear > 1) { this.gear--; this.shiftT = 0.1; this.shiftCool = 0.25; }
    }

    // ---------- 刹车 ----------
    const brakeTotal = sp.brakeForce * m * G * R * this.brake;     // 总制动力矩
    const bT = [brakeTotal * sp.brakeBias / 2, brakeTotal * sp.brakeBias / 2, brakeTotal * (1 - sp.brakeBias) / 2, brakeTotal * (1 - sp.brakeBias) / 2];
    if (this.handbrake) { bT[2] += 2600; bT[3] += 2600; driveT = 0; }
    if (dB > 0) driveT *= 1 - (1 - DRIFT.drive) * dB;

    // ---------- 轮胎力 ----------
    let Fx = 0, Fy = 0, Mz = 0, spinAcc = 0, rearFx = 0;
    const rearI = 2 * this.wheelI + ((clutchSlip || shifting || this.handbrake) ? 0 : this.engineI * ratio * ratio);
    let rearTyreT = 0, rearK = 0;
    for (let i = 0; i < 4; i++) {
      const w = W[i], p = this.wpos[i];
      const vwx = this.vx - this.r * p[1], vwy = this.vy + this.r * p[0];
      let vl, vt;
      if (i < 2) { vl = vwx * cd + vwy * sd; vt = -vwx * sd + vwy * cd; } else { vl = vwx; vt = vwy; }
      const sf = SURFACE[w.surf];
      let mu = sf.mu * sp.muScale * (1 - 0.10 * (w.fz / fz0 - 1));
      if (w.surf === SURF.ASPHALT) mu *= 1 - 0.20 * w.wet;        // 积水处更滑
      const wR = w.omega * R;
      tyre(vl, vt, wR, w.fz, mu, _t1);
      tyre(vl, vt, wR + 0.05, w.fz, mu, _t2);
      const kx = Math.max(0, (_t2.fx - _t1.fx) / 0.05);           // dFx/d(ωR)，用于半隐式积分
      let fx = _t1.fx, fy = _t1.fy;
      if (dB > 0) fy *= (1 - DRIFT.tireCut * dB) * (i >= 2 ? DRIFT.rearGrip : 1);   // 漂移中侧向力让给下面的线路控制
      // ABS：抱死趋势时松开一点刹车（手刹不受影响）
      let brk = bT[i];
      if (_t1.sx < -0.13 && !(this.handbrake && i >= 2)) brk *= clamp(1 + (_t1.sx + 0.13) * 9, 0.15, 1);
      // 滚阻与松软路面阻力（沿车轮滚动方向）
      const vAbs = Math.hypot(vl, vt);
      const frr = sf.rr * w.fz * Math.tanh(vAbs * (w.surf >= SURF.GRASS ? 0.22 : 0.8));
      const rx = vAbs > 1e-3 ? -frr * vl / vAbs : 0, ry = vAbs > 1e-3 ? -frr * vt / vAbs * (w.surf >= SURF.GRASS ? 1 : 0) : 0;
      w.sx = _t1.sx; w.sy = _t1.sy; w.rho = _t1.rho; w.fx = fx; w.fy = fy;
      const slipV = Math.hypot(wR - vl, vt);
      w.slide = _t1.rho > 1 ? slipV * Math.min(1, (_t1.rho - 1) * 1.2) * Math.min(1.5, w.fz / fz0) : 0;
      // 车轮转动
      if (i < 2) {
        const den = this.wheelI + kx * R * R * dt;
        let om = w.omega + (-fx * R) * dt / den;
        const db = brk * dt / den;
        om = Math.abs(om) <= db ? 0 : om - Math.sign(om) * db;
        w.omega = om;
      } else { rearTyreT += fx * R; rearK += kx; w._brk = brk; }
      const tx = fx + rx, ty = fy + ry;
      let bx, by;
      if (i < 2) { bx = tx * cd - ty * sd; by = tx * sd + ty * cd; } else { bx = tx; by = ty; }
      Fx += bx; Fy += by; Mz += p[0] * by - p[1] * bx;
      if (i >= 2) rearFx += bx;
      if (i >= 2) spinAcc += Math.max(0, _t1.sx);
    }
    {   // 后轴（锁止差速：两轮同速）
      const den = rearI + rearK * R * R * dt;
      let om = wRear + (driveT - rearTyreT) * dt / den;
      const db = (W[2]._brk + W[3]._brk) * dt / den;
      om = Math.abs(om) <= db ? 0 : om - Math.sign(om) * db;
      W[2].omega = W[3].omega = om;
    }
    this.wheelspin = spinAcc / 2;
    // 风阻
    const drag = 0.5 * RHO * sp.cdA * v;
    Fx -= drag * this.vx; Fy -= drag * this.vy;

    // ---------- 街机漂移：线路控制（指向弯心的向心力、横滑掉速、沿车头的推力）和车身角度控制 ----------
    let yawAcc = 0;
    if (arc) {
      const D = DRIFT, beta = this.beta;
      if (!this.drifting && this.kickT > 0) yawAcc += Math.sign(input.steer || 0) * D.kickYaw;     // 点刹入弯：推一把车尾
      if (this.drifting && v > 1) {
        const err = beta - this.driftTarget, over = arc.over, catching = smooth(0, 0.1, over);
        const swing = err * D.kp + this.betaRate * D.kd;
        const noseRate = this.driftDir * (arc.turn - over * D.align * (1 - D.noseShare));
        yawAcc += swing * (1 - catching) + (noseRate - this.r) * D.noseHold * catching;
        const tx = this.vx / v, ty = this.vy / v, px = -ty * this.driftDir, py = tx * this.driftDir;   // 行进方向、指向弯心
        const fromDrive = Math.max(0, rearFx * px) / m;
        const cen = Math.max(0, arc.lat * smooth(3, 12, v) - fromDrive);
        const scrub = G * D.scrub * Math.sin(Math.min(Math.abs(beta), 1.2)) * this.driftBlend * (0.25 + (v / 38) * (v / 38));
        const nose = clamp(-beta * this.driftDir, 0, 1.4);
        const push = G * D.push * this.throttle * this.driftBlend * smooth(0.08, 0.4, nose) * smooth(3, 12, v) * (1 - smooth(D.pushFade[0], D.pushFade[1], v));
        Fx += m * (px * cen - tx * scrub + push); Fy += m * (py * cen - ty * scrub);
      }
      yawAcc = clamp(yawAcc, -30, 30);
    }

    // ---------- 积分 ----------
    const ax = Fx / m, ay = Fy / m;
    this.ax = ax; this.ay = ay;
    const kf = Math.min(1, dt * 14);
    this.axF += (ax - this.axF) * kf; this.ayF += (ay - this.ayF) * kf;
    this.vx += (ax + this.r * this.vy) * dt;
    this.vy += (ay - this.r * this.vx) * dt;
    this.r += (Mz / sp.izz + yawAcc) * dt;
    if (v < 0.25 && this.throttle < 0.02) { this.vx *= 0.9; this.vy *= 0.9; this.r *= 0.9; }   // 驻车
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    this.x += (this.vx * cy - this.vy * sy) * dt;
    this.y += (this.vx * sy + this.vy * cy) * dt;
    this.yaw += this.r * dt;
    for (const w of W) w.angle += w.omega * dt;

    // ---------- 车身姿态（视觉）：二阶弹簧 ----------
    const wn = 14, zeta = 0.55;
    const rollT = -this.ayF / G * 0.050, pitchT = -this.axF / G * 0.026;   // 弧度：左转（ay>0）车身向右倾
    this.rollV += (wn * wn * (rollT - this.roll) - 2 * zeta * wn * this.rollV) * dt; this.roll += this.rollV * dt;
    this.pitchV += (wn * wn * (pitchT - this.pitch) - 2 * zeta * wn * this.pitchV) * dt; this.pitch += this.pitchV * dt;

    // ---------- 护栏碰撞 ----------
    this.hitT += dt;
    if (track) this._collideBarriers(track);
  }

  _collideBarriers(track) {
    const sp = this.spec, hw = sp.width / 2 - 0.04;
    const xf = this.a + sp.frontOverhang, xr = -(this.b + sp.rearOverhang);
    const corners = [[xf, hw], [xf, -hw], [xr, hw], [xr, -hw]];
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    for (const c of corners) {
      const rx = cy * c[0] - sy * c[1], ry = sy * c[0] + cy * c[1];
      const tc = track.toTrack(this.x + rx, this.y + ry, this.trackI, 8);
      const i = tc.i;
      let pen = 0, nx = 0, ny = 0;
      const bl = track.barrierL(tc.s), br = track.barrierR(tc.s);
      if (tc.d > bl) { pen = tc.d - bl; nx = track.hy[i]; ny = -track.hx[i]; }
      else if (tc.d < -br) { pen = -br - tc.d; nx = -track.hy[i]; ny = track.hx[i]; }
      if (pen <= 0) continue;
      // 世界系速度
      const vwx = this.vx * cy - this.vy * sy, vwy = this.vx * sy + this.vy * cy;
      const px = vwx - this.r * ry, py = vwy + this.r * rx;
      const vn = px * nx + py * ny;
      this.x += nx * pen; this.y += ny * pen;
      if (vn >= 0) continue;
      const m = sp.mass, I = sp.izz;
      const rn = rx * ny - ry * nx;
      const j = -(1 + 0.12) * vn / (1 / m + rn * rn / I);
      const tx = -ny, ty = nx, vt = px * tx + py * ty, rt = rx * ty - ry * tx;
      let jt = -vt / (1 / m + rt * rt / I); const jtMax = 0.32 * j; jt = clamp(jt, -jtMax, jtMax);
      const ix = j * nx + jt * tx, iy = j * ny + jt * ty;
      const nvx = vwx + ix / m, nvy = vwy + iy / m;
      this.r += (rx * iy - ry * ix) / I;
      this.vx = nvx * cy + nvy * sy; this.vy = -nvx * sy + nvy * cy;
      const mag = Math.abs(vn);
      if (mag > 0.8) { this.hitT = 0; this.hitMag = mag; this.hitX = this.x + rx; this.hitY = this.y + ry; }
    }
  }
}

// 车与车之间的碰撞：每台车用 3 个圆近似
export function collideCars(cars) {
  const offs = [0.36, 0, -0.36];
  for (let a = 0; a < cars.length; a++) for (let b = a + 1; b < cars.length; b++) {
    const A = cars[a], B = cars[b];
    const dx0 = B.x - A.x, dy0 = B.y - A.y;
    if (dx0 * dx0 + dy0 * dy0 > 36) continue;
    const ra = A.spec.width * 0.5, rb = B.spec.width * 0.5;
    const ca = Math.cos(A.yaw), sa = Math.sin(A.yaw), cb = Math.cos(B.yaw), sb = Math.sin(B.yaw);
    for (const oa of offs) for (const ob of offs) {
      const la = oa * A.spec.length + (A.a - A.b) * 0.5 * 0, lb = ob * B.spec.length;
      const ax = A.x + ca * la, ay = A.y + sa * la, bx = B.x + cb * lb, by = B.y + sb * lb;
      const dx = bx - ax, dy = by - ay, d = Math.hypot(dx, dy), minD = ra + rb;
      if (d >= minD || d < 1e-4) continue;
      const nx = dx / d, ny = dy / d, pen = minD - d;
      A.x -= nx * pen * 0.5; A.y -= ny * pen * 0.5; B.x += nx * pen * 0.5; B.y += ny * pen * 0.5;
      const rax = ca * la, ray = sa * la, rbx = cb * lb, rby = sb * lb;
      const avx = A.vx * ca - A.vy * sa - A.r * ray, avy = A.vx * sa + A.vy * ca + A.r * rax;
      const bvx = B.vx * cb - B.vy * sb - B.r * rby, bvy = B.vx * sb + B.vy * cb + B.r * rbx;
      const vn = (bvx - avx) * nx + (bvy - avy) * ny;
      if (vn >= 0) continue;
      const rna = rax * ny - ray * nx, rnb = rbx * ny - rby * nx;
      const j = -(1 + 0.2) * vn / (1 / A.spec.mass + 1 / B.spec.mass + rna * rna / A.spec.izz + rnb * rnb / B.spec.izz);
      const apply = (C, c, s, rx, ry, jx, jy) => {
        const wx = C.vx * c - C.vy * s + jx / C.spec.mass, wy = C.vx * s + C.vy * c + jy / C.spec.mass;
        C.r += (rx * jy - ry * jx) / C.spec.izz; C.vx = wx * c + wy * s; C.vy = -wx * s + wy * c;
      };
      apply(A, ca, sa, rax, ray, -j * nx, -j * ny); apply(B, cb, sb, rbx, rby, j * nx, j * ny);
      const mag = Math.abs(vn);
      if (mag > 0.8) { A.hitT = 0; A.hitMag = mag; A.hitX = ax; A.hitY = ay; B.hitT = 0; B.hitMag = mag; B.hitX = bx; B.hitY = by; }
    }
  }
}
