// 机甲步态：脚按“实际走过的距离”迈步，落地后钉在世界坐标上不动（不滑步），腿用两段式 IK 去够脚，
// 骨盆高度受腿长约束（步子迈开时自然下沉，落脚时再被冲击压一下），思路同步兵的 gait.js，但机甲没有蒙皮骨骼，直接写关节。
//   update(dt, o)  o = { pos, yaw, vx, vz, crouch, mode: 'walk' | 'air' | 'skid', height(x, z) }，返回本帧的落脚事件 [{ side, x, y, z, w }]
//   pose(model)    把结果写进 mech.js 的关节层级（pelvis / thigh / shin / foot）
import * as THREE from 'three';

const THIGH = 1.25, SHIN = 1.25, FOOT = 0.36, HIPX = 0.95, REACH = THIGH + SHIN - 0.035, STAND = 2.70;
const _a = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler();
const damp = (c, t, r, dt) => c + (t - c) * (1 - Math.exp(-r * dt));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

export class MechGait {
  constructor() {
    const mk = (side) => ({ side, p: new THREE.Vector3(), from: new THREE.Vector3(), planted: true, s: 0, s0: 0, cyc: -1, lead: 0, t: 1, yaw: 0, yaw0: 0, lift: 0, pitch: 0, gy: 0, fromGy: 0 });
    this.foot = [mk(-1), mk(1)]; this.events = []; this.inited = false;
    this.pelY = STAND; this.dip = 0; this.dipV = 0; this.sway = 0; this.twist = 0; this.roll = 0; this.sp = 0; this.dx = 0; this.dz = -1; this.last = 1; this.idleT = 0; this.mode = 'air'; this.yaw = 0; this.limit = STAND;
    this.pos = new THREE.Vector3(); this.phi = 0; this.clock = false;
  }

  _home(k, o, out) { const f = this.foot[k], c = Math.cos(o.yaw), s = Math.sin(o.yaw); return out.set(o.pos.x + c * f.side * HIPX, 0, o.pos.z - s * f.side * HIPX); }
  _ground(o, x, z) { return clamp(o.height(x, z), o.pos.y - 0.8, o.pos.y + 0.8); }
  _plant(f, o, w) { f.planted = true; f.s = 0; f.t = 0; f.lift = 0; f.pitch = 0; f.gy = this._ground(o, f.p.x, f.p.z); f.p.y = f.gy; if (w > 0) { this.events.push({ side: f.side, x: f.p.x, y: f.p.y, z: f.p.z, w }); this.dipV -= 0.55 * w; } }

  // 双脚直接放到髋下（空降、初始化）
  reset(o) { for (let k = 0; k < 2; k++) { const f = this.foot[k]; this._home(k, o, f.p); f.p.y = o.pos.y; f.gy = o.pos.y; f.planted = true; f.s = 0; f.t = 1; f.lift = 0; f.pitch = 0; f.yaw = o.yaw; } this.inited = true; this.clock = false; }

  update(dt, o) {
    const F = this.foot, ev = this.events; ev.length = 0;
    dt = Math.max(dt, 1e-4);
    if (!this.inited) this.reset(o);
    const sp = Math.hypot(o.vx, o.vz); this.sp = damp(this.sp, sp, 8, dt);
    if (sp > 0.3) { this.dx = o.vx / sp; this.dz = o.vz / sp; }
    const dyaw = angDiff(o.yaw, this.yaw); this.yaw = o.yaw; this.pos.copy(o.pos);
    const moving = sp > 0.35; this.idleT = moving ? 0 : this.idleT + dt;
    // 一个完整步态周期身体走过的距离 C、着地占比 beta：越快步幅越大、着地越短（高速时带一点腾空）
    const fwd = Math.abs(this.dx * -Math.sin(o.yaw) + this.dz * -Math.cos(o.yaw));   // 横移时步幅略收，免得两腿交叉
    const C = clamp(2.4 + this.sp * 0.5, 2.6, 5.4) * (0.85 + 0.15 * fwd), beta = clamp(0.64 - this.sp * 0.034, 0.42, 0.62);
    const stance = beta * C;
    const d = sp * dt + Math.abs(dyaw) * HIPX * 0.9;

    if (o.mode === 'air') {   // 空中：脚跟着机体
      for (let k = 0; k < 2; k++) { const f = F[k]; this._home(k, o, f.p); f.p.y = o.pos.y; f.gy = o.pos.y; f.planted = false; f.s = 0; f.lift = 0; f.pitch = 0; f.yaw = o.yaw; }
    } else if (o.mode === 'skid') {   // 推进器冲刺：双脚离地一前一后掠过地面
      for (let k = 0; k < 2; k++) {
        const f = F[k]; this._home(k, o, _a); const lead = k === this.last ? 0.55 : -0.45;
        const tx = _a.x + this.dx * lead, tz = _a.z + this.dz * lead; const r = this.mode === 'skid' ? 1 - Math.exp(-22 * dt) : 1 - Math.exp(-14 * dt);
        f.p.x += (tx - f.p.x) * r; f.p.z += (tz - f.p.z) * r; f.gy = this._ground(o, f.p.x, f.p.z); f.lift = damp(f.lift, 0.2, 14, dt); f.p.y = f.gy + f.lift;
        f.planted = false; f.s = 0.5; f.pitch = damp(f.pitch, lead > 0 ? 0.22 : -0.18, 12, dt); f.yaw += angDiff(o.yaw, f.yaw) * Math.min(1, dt * 12);
      }
    } else {
      if (this.mode !== 'walk') { for (const f of F) if (!f.planted) this._plant(f, o, this.mode === 'skid' ? 1 : 0); this.clock = false; }   // 冲刺结束 / 落地：双脚砸回地面
      const beh = [0, 0], err = [0, 0];
      for (let k = 0; k < 2; k++) { const f = F[k]; f.t += dt; this._home(k, o, _a); const ox = f.p.x - _a.x, oz = f.p.z - _a.z; beh[k] = -(ox * this.dx + oz * this.dz); err[k] = Math.hypot(ox, oz); }
      const lift = (k, s0, cyc) => { const f = F[k]; f.planted = false; f.s = s0; f.s0 = s0; f.cyc = cyc; f.lead = 0; f.from.copy(f.p); f.fromGy = f.gy; f.yaw0 = f.yaw; this.last = k; };
      const swingMin = (1 - beta) / 0.62;   // 有脚在空中时步态时钟的最低速度：一步最多 0.62 秒
      if (moving) {
        // 步态时钟 phi：按走过的距离推进（一圈 = 距离 C）。脚 k 的相位 u = frac(phi + 0.5k)：u < beta 着地，其余摆动 —— 两脚永远差半圈
        if (!this.clock) {
          this.clock = true; let k, s0;
          if (!F[0].planted || !F[1].planted) { k = F[0].planted ? 1 : 0; s0 = Math.min(0.98, F[k].s); }   // 站定时正在挪的那只脚接着走完
          else { k = beh[0] > beh[1] + 0.01 ? 0 : beh[1] > beh[0] + 0.01 ? 1 : 1 - this.last; s0 = 0.5; }    // 起步：落后的脚先迈，而且只迈半步，另一只脚随后正好在半个着地距离处抬起
          this.phi = 4 + beta + (1 - beta) * s0 - 0.5 * k;
          if (F[k].planted) lift(k, s0, Math.floor(this.phi + 0.5 * k)); else F[k].cyc = Math.floor(this.phi + 0.5 * k);
        }
        this.phi += Math.max(d / C, F[0].planted && F[1].planted ? 0 : swingMin * dt);
        for (let k = 0; k < 2; k++) {
          const f = F[k]; if (!f.planted) continue; const ph = this.phi + 0.5 * k, cyc = Math.floor(ph);
          if (ph - cyc >= beta && f.cyc !== cyc) lift(k, clamp((ph - cyc - beta) / (1 - beta), 0, 0.9), cyc); else if (err[k] > 1.55) lift(k, 0, -1);   // 后者：实在够不着了（被挤开、急转），不等时钟，直接收回髋下
        }
      } else {
        this.clock = false; const k = err[0] >= err[1] ? 0 : 1, f = F[k], g = F[1 - k];   // 站定后把脚一只一只收回髋下
        if (f.planted && g.planted && this.idleT > 0.12 && g.t > 0.16 && (err[k] > 0.24 || Math.abs(angDiff(o.yaw, f.yaw)) > 0.3)) lift(k, 0, -1);
      }
      // 摆动脚：落点 = 落地那一刻髋的正下方再往前半个着地距离，每帧重新预测（转向、变速时不会落错）
      const spd = d / dt;
      for (let k = 0; k < 2; k++) {
        const f = F[k]; if (f.planted) continue; const ph = this.phi + 0.5 * k, cyc = Math.floor(ph), u = ph - cyc; let lead = 0;
        if (this.clock && f.cyc >= 0) {
          if (cyc !== f.cyc) { f.s = 1; lead = stance * 0.5; } else { f.s = Math.max(f.s, (u - beta) / (1 - beta)); lead = sp * (1 - u) / Math.max(spd / C, swingMin) + stance * 0.5; }
          f.lead = lead;
        } else { f.s += dt / 0.46; lead = f.lead = damp(f.lead, 0, 7, dt); }   // 停步时脚还在空中：落点平滑收回髋下，不跳变
        const s = Math.min(1, f.s), q = clamp((s - f.s0) / Math.max(0.02, 1 - f.s0), 0, 1); this._home(k, o, _a);
        const tx = _a.x + this.dx * lead, tz = _a.z + this.dz * lead;
        const E = (x) => x * 0.5 + x * x * (3 - 2 * x) * 0.5, e0 = E(f.s0), e = (E(s) - e0) / (1 - e0);   // 一半匀速一半缓动：抬脚利索，落脚带着速度砸下去
        f.p.x = f.from.x + (tx - f.from.x) * e; f.p.z = f.from.z + (tz - f.from.z) * e;
        const gy = this._ground(o, tx, tz); f.gy = f.fromGy + (gy - f.fromGy) * e;
        f.lift = Math.sin(Math.PI * Math.pow(q, 0.85)) * (moving ? 0.34 + 0.2 * Math.min(1, this.sp / 5) : 0.24); f.p.y = f.gy + f.lift;
        f.pitch = -Math.sin(q * Math.PI * 2) * 0.26 * Math.min(1, this.sp / 3) * (this.dx * -Math.sin(o.yaw) + this.dz * -Math.cos(o.yaw));
        f.yaw = f.yaw0 + angDiff(o.yaw, f.yaw0) * e;
        if (f.s >= 1) { f.p.x = tx; f.p.z = tz; this._plant(f, o, 0.55 + 0.45 * Math.min(1, this.sp / 5)); }
      }
    }
    this.mode = o.mode;

    // 骨盆：名义高度被“每条腿最多能伸多长”压住；落脚冲击是一个欠阻尼弹簧
    const c = Math.cos(o.yaw), sn = Math.sin(o.yaw);
    // 重心移向支撑脚；髋随迈出的腿扭一点
    const sw = F[0].planted === F[1].planted ? 0 : (F[0].planted ? -1 : 1);
    this.sway = damp(this.sway, sw * 0.075 * Math.min(1, 0.35 + this.sp / 3), 5, dt); this.roll = damp(this.roll, -sw * 0.022, 5, dt);
    const fo = (k) => { const f = F[k]; return (f.p.x - o.pos.x) * -sn + (f.p.z - o.pos.z) * -c; };
    this.twist = damp(this.twist, clamp((fo(1) - fo(0)) * 0.055, -0.13, 0.13), 7, dt);   // 右脚在前 → 右髋前送（绕 Y 正转）
    let limit = 9; const ct = Math.cos(this.twist), st = Math.sin(this.twist);
    for (let k = 0; k < 2; k++) {
      const f = F[k]; const lx = this.sway + f.side * HIPX * ct, lz = -f.side * HIPX * st;   // 髋在根局部坐标里的位置（含重心偏移与扭髋）
      const hx = o.pos.x + lx * c + lz * sn, hz = o.pos.z - lx * sn + lz * c; const dh2 = (f.p.x - hx) ** 2 + (f.p.z - hz) ** 2;
      let lim = f.p.y + FOOT + Math.sqrt(Math.max(0.3, REACH * REACH - dh2)) - o.pos.y;
      if (!f.planted && o.mode === 'walk') { const w = clamp((f.s - 0.55) / 0.35, 0, 1); lim = lim * w + 9 * (1 - w); }   // 摆动脚只在快落地时才约束骨盆（空中够不着由 IK 收腿）
      limit = Math.min(limit, lim);
    }
    this.limit = limit;
    const nominal = STAND - 0.07 * Math.min(1, this.sp / 3) - (o.crouch || 0) * 1.2;
    this.dipV += (-this.dip * 110 - this.dipV * 13) * dt; this.dip += this.dipV * dt;
    this.pelY = damp(this.pelY, Math.min(nominal, limit), 14, dt);
    return ev;
  }

  pose(m) {
    const F = this.foot, yaw = this.yaw, c = Math.cos(yaw), sn = Math.sin(yaw), pos = this.pos;
    m.root.position.copy(pos); m.root.rotation.set(0, yaw, 0);
    const py = Math.min(this.limit, this.pelY + this.dip);
    m.pelvis.position.set(this.sway, py, 0); m.pelvis.rotation.set(0, this.twist, this.roll); const pq = m.pelvis.quaternion;
    for (let k = 0; k < 2; k++) {
      const f = F[k], L = m.legs[k];
      // 踝关节目标：世界 → 根局部 → 骨盆局部
      const wx = f.p.x - pos.x, wy = f.p.y + FOOT - pos.y, wz = f.p.z - pos.z;
      _a.set(wx * c - wz * sn - this.sway, wy - py, wx * sn + wz * c).applyQuaternion(_q.copy(pq).invert()); _a.x -= f.side * HIPX;
      let len = _a.length(); const max = THIGH + SHIN - 0.004; if (len > max) { _a.multiplyScalar(max / len); len = max; } else if (len < 0.9) { _a.multiplyScalar(0.9 / Math.max(1e-4, len)); len = 0.9; }
      const a = Math.asin(clamp(-_a.z / len, -1, 1)), b = Math.atan2(_a.x, -_a.y);
      const knee = Math.PI - Math.acos(clamp((THIGH * THIGH + SHIN * SHIN - len * len) / (2 * THIGH * SHIN), -1, 1));
      const al = Math.acos(clamp((THIGH * THIGH + len * len - SHIN * SHIN) / (2 * THIGH * len), -1, 1));
      L.thigh.rotation.order = 'ZXY'; L.thigh.rotation.set(a + al, 0, b); L.shin.rotation.set(-knee, 0, 0);
      // 脚掌保持水平并朝向落地时的方向：抵消骨盆、大腿、小腿的旋转
      _q.copy(pq).multiply(L.thigh.quaternion).multiply(L.shin.quaternion).invert();
      L.foot.quaternion.copy(_q).multiply(_q2.setFromEuler(_e.set(f.pitch, angDiff(f.yaw, yaw), 0, 'YXZ')));
    }
  }
}
