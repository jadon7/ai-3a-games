// 双界试炼的示范演示（录制用）：第一人称按路线跑完全程 —— 透视、空中切换、蹬墙接力、拉机关、相位处决，遇到同一界的敌人会开火。
// 和自动对战的大脑一样，只通过虚拟输入（VInput）操纵玩家本体，不改物理、不无敌。
// 路线按检查点分段；阵亡 / 坠落后从最近的检查点那一段重新开始，卡住超过 14 秒就回检查点重来。
import * as THREE from 'three';

const _e = new THREE.Vector3(), _t = new THREE.Vector3();
const yawOf = (dx, dz) => Math.atan2(-dx, -dz);
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const N = 0, E = -Math.PI / 2, S = Math.PI, W = Math.PI / 2;   // 朝向：北（-z）、东（+x）、南、西

export class RiftRunner {
  constructor(game, body, vin) { this.game = game; this.body = body; this.vin = vin; this.mv = new THREE.Vector3(); this.reset(); }
  reset() { this.stat = this.stat || { restarts: 0, rescues: 0, runs: 0 }; this.stat.runs++; this.sec = -1; this.steps = []; this.i = 0; this.stT = 0; this.first = true; this.falls = 0; this.wasAlive = true; this.lastT = 0; this.yv = 0; this.pv = 0; this.tgt = null; this.scanT = 0; this.swCD = 0; this.pty = null; this.ptgt = null; this.om = 0; this.d = {}; }

  // ---------- 步骤 ----------
  // 走到 (x, z)。默认沿导航网格寻路（地面）；direct：直线（平台、楼梯、回廊上）；precise：最后一米收着走，停稳在目标点上（起跳点要准）
  goto(x, z, tol = 0.5, o = {}) {
    return () => {
      const p = this.body, g = this.game;
      if (this.first) { this.d.path = o.direct ? null : g.nav.findPath(p.pos.x, p.pos.z, x, z, false, 0.45); this.d.pi = 0; }
      const path = this.d.path; let tx = x, tz = z;
      if (path && path.length) { while (this.d.pi < path.length - 1 && Math.hypot(path[this.d.pi].x - p.pos.x, path[this.d.pi].z - p.pos.z) < 0.8) this.d.pi++; if (this.d.pi < path.length - 1) { tx = path[this.d.pi].x; tz = path[this.d.pi].z; } }
      const dx = tx - p.pos.x, dz = tz - p.pos.z, dd = Math.hypot(dx, dz) || 1; if (o.noCombat) this.noCombat = true;
      const fin = Math.hypot(x - p.pos.x, z - p.pos.z);
      if (o.precise && fin < 1.3) { const along = (p.vel.x * dx + p.vel.z * dz) / dd; if (fin > 0.06 && along < fin * 4.2) this.move(dx / dd, dz / dd); return fin < tol && Math.hypot(p.vel.x, p.vel.z) < 0.8; }
      this.move(dx / dd, dz / dd);
      if (o.jump && p.onGround && this.stT > 0.25 && Math.hypot(p.vel.x, p.vel.z) < 2.5) this.vin.tap('Space');   // 被栏杆之类的矮东西挡住：跳过去
      return fin < tol;
    };
  }
  // 站定 sec 秒。look：看向的点；peek：按住 Z 透视；yaw：看向的方位
  wait(sec, o = {}) { return () => { if (o.look) this.lookAt(o.look[0], o.look[1], o.look[2]); if (o.yaw !== undefined) this.lookDir(o.yaw, o.pitch || 0); if (o.peek) this.vin.set('KeyZ', true); if (o.noCombat !== false) this.noCombat = true; return this.stT >= sec; }; }
  shift(ph) { return () => { const g = this.game; if (g.phase === ph) return true; if (g.rift.cd <= 0 && this.stT > 0.05) this.vin.tap('KeyT'); this.noCombat = true; return false; }; }
  // 原地清掉这一界附近看得见的敌人（最多 maxT 秒）
  fight(maxT, r = 30) {
    return () => {
      const p = this.body, d = this.d; if (this.first) { d.ax = p.pos.x; d.az = p.pos.z; }
      const t = this.scan(r);
      if (t) {   // 边打边横移（离开起点 2 m 就往回走），让对面打不准
        const dx = t.pos.x - p.pos.x, dz = t.pos.z - p.pos.z, dd = Math.hypot(dx, dz) || 1, ox = p.pos.x - d.ax, oz = p.pos.z - d.az, off = Math.hypot(ox, oz);
        if (off > 2) this.move(-ox, -oz); else { const sd = Math.sin(this.stT * 4.2) > 0 ? 1 : -1; this.move(-dz / dd * sd, dx / dd * sd); }
      }
      return (this.stT > 0.4 && !t) || this.stT > maxT;
    };
  }
  // 躲在掩体后回血（看得见敌人照样还击）
  rest(hp, maxT) { return () => this.body.hp >= hp || this.stT > maxT; }
  // 断桥：沿蜃界的南半截冲刺，桥头起跳，空中切到现世，落在北半截
  bridge() {
    return () => {
      const p = this.body, g = this.game, d = this.d; if (this.first) { d.tj = -1; d.sh = false; }
      this.move(-p.pos.x * 0.4, -1); this.lookDir(N, -0.08); this.noCombat = true;
      if (d.tj < 0 && p.onGround && p.pos.z < 23.3) { this.vin.tap('Space'); d.tj = this.stT; }
      if (d.tj >= 0 && !d.sh && this.stT - d.tj > 0.1) { this.vin.tap('KeyT'); d.sh = g.phase === 0 || g.rift.cd > 0; }
      return d.tj >= 0 && p.onGround && p.pos.z < 19.7 && g.phase === 0;
    };
  }
  // 蹬墙回廊：现世的左墙 → 蹬出去、空中切换 → 蜃界的右墙 → 再蹬、再切 → 现世的左墙 → 对岸
  corridor() {
    return () => {
      const p = this.body, g = this.game, d = this.d, z = p.pos.z; if (this.first) { d.stage = 0; d.tj = 0; }
      this.move(d.stage === 0 ? clamp((-1.9 - p.pos.x) * 1.5, -0.3, 0.3) : 0, -1); this.lookDir(N, 0.04); this.noCombat = true;   // 起跳前贴着左墙的延长线跑
      if (d.stage === 0 && z < 5.15) { this.vin.tap('Space'); d.stage = 1; }
      else if (d.stage === 1 && p.wr.on && z < -3) { this.vin.tap('Space'); d.stage = 2; d.tj = this.stT; }
      else if (d.stage === 2 && this.stT - d.tj > 0.12) { this.vin.tap('KeyT'); if (g.phase === 1 || g.rift.cd > 0) d.stage = 3; }
      else if (d.stage === 3 && p.wr.on && z < -14.5) { this.vin.tap('Space'); d.stage = 4; d.tj = this.stT; }
      else if (d.stage === 4 && this.stT - d.tj > 0.12) { this.vin.tap('KeyT'); if (g.phase === 0 || g.rift.cd > 0) d.stage = 5; }
      // 过了最后一面墙：按住下蹲不再贴墙，落地顺势滑铲
      this.vin.set('KeyC', d.stage === 5 && z < -25.2 && !p.onGround);
      const done = d.stage === 5 && p.onGround && z < -25.6; if (done) this.vin.set('KeyC', false);
      return done;
    };
  }
  // 升井的一跳：朝 yaw 起跳 →（空中切到 toPhase）→ 二段跳 → 攀上平台
  hop(yaw, toPhase = null) {
    return () => {
      const p = this.body, g = this.game, d = this.d; if (this.first) { d.y0 = p.pos.y; d.dj = false; d.sh = toPhase === null; this.vin.tap('Space'); }
      this.move(-Math.sin(yaw), -Math.cos(yaw)); this.lookDir(yaw, 0.3); this.noCombat = true;
      if (!d.sh && this.stT > 0.08) { this.vin.tap('KeyT'); d.sh = g.phase === toPhase; }
      if (!d.dj && this.stT > 0.34 && !p.mantle.on && !p.onGround) { this.vin.tap('Space'); d.dj = true; }
      if (this.stT > 1.3 && p.onGround && p.pos.y < d.y0 + 1.2) { this.restart = true; return false; }   // 没上去：这一段重来
      return this.stT > 0.5 && p.onGround && !p.mantle.on && p.pos.y > d.y0 + 1.5;
    };
  }
  lever() { return () => { const g = this.game, l = g.rift.lever; this.lookAt(l.x, l.y + 1.2, l.z - 0.3); this.noCombat = true; if (g.interactPrompt && this.stT > 0.35) this.vin.tap('KeyE'); return l.on; }; }
  // 隔界猎杀：自己待在第 hide 界，按住 Z 盯着另一界守卫的剪影走到他身上，切过去处决；随即切回来（其余守卫丢失目标，会去消失点查看），再找下一个。
  // 另一界的守卫看不见也打不着这边；这一界要是有敌人露头，照常开火还击。范围：z ∈ [z0, z1]、与自己高差 1.5 m 以内
  ambush(hide, maxT, z0, z1) {
    return () => {
      const p = this.body, g = this.game, d = this.d, R = g.rift, vp = 1 - hide; if (this.first) d.v = null;
      const ok = (a) => a.alive && a.phase === vp && a.team !== 0 && a.pos.z > z0 && a.pos.z < z1 && Math.abs(a.pos.y - p.pos.y) < 1.5;
      if (g.phase === vp) { if (this.stT > maxT || !g.actors.some(ok)) return true; if (R.cd <= 0) this.vin.tap('KeyT'); return false; }
      if (!d.v || !ok(d.v)) { d.v = null; let bd = 1e9; for (const a of g.actors) { if (!ok(a)) continue; const dd = Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z); if (dd < bd) { bd = dd; d.v = a; } } }
      const v = d.v; if (!v || this.stT > maxT) return true;
      const dx = v.pos.x - p.pos.x, dz = v.pos.z - p.pos.z, dd = Math.hypot(dx, dz); this.vin.set('KeyZ', true); this.lookAt(v.pos.x, v.pos.y + 1.3, v.pos.z);
      if (dd > 0.25) this.move(dx / dd, dz / dd);
      if (dd < 0.75 && R.cd <= 0) this.vin.tap('KeyT');
      return false;
    };
  }

  // 第 k 个检查点到下一个检查点之间的脚本
  section(k) {
    const g = (x, z, tol, o) => this.goto(x, z, tol, o), D = { direct: true, noCombat: true }, P = { direct: true, noCombat: true, precise: true };
    switch (k) {
      case 0: return [this.shift(0), g(0, 40.3, 0.5), this.wait(1.2, { look: [0, 2, 38.6], peek: true }), this.shift(1), g(0, 34.7, 0.5), this.wait(0.4, { look: [0, 1.6, 33] }), this.shift(0), g(0, 30.6, 0.5)];
      case 1: return [g(0, 30.2, 0.5), this.wait(1.2, { look: [0, -0.5, 22], peek: true }), this.shift(1), this.bridge(), g(0, 12.4, 0.6)];
      case 2: return [this.shift(0), this.fight(6, 26), g(-1.9, 10.2, 0.2, { direct: true, precise: true }), this.wait(1.2, { look: [3, 3, -12], peek: true }), this.wait(0.3, { yaw: N }), this.corridor(), g(0, -28.2, 0.6)];
      // 大厅：现世三个步兵、蜃界一个追猎者，硬闯会被两头夹击。
      //   先退到门外的墙后切进蜃界（现世的步兵丢失目标），回满血，用枪解决追猎者；再隔界猎杀现世的步兵；上回廊拉机关，回现世从打开的闸门出去
      case 3: return [g(6.2, -28.3, 0.4, { direct: true }), this.shift(1), this.rest(90, 7), this.fight(6, 24), g(0, -30.3, 0.5, { direct: true }), this.fight(8, 24), this.ambush(1, 12, -48, -24), this.shift(1),
        g(7.3, -35.4, 0.5), g(7.3, -44.7, 0.4, { direct: true }), g(6.9, -46.4, 0.4, { direct: true }), g(-5.5, -46.3, 0.4, { direct: true }), this.lever(), this.wait(1.4, { look: [0, 1.4, -47.8], peek: true }),
        g(-5.2, -43.6, 0.7, { direct: true, jump: true, noCombat: true }), this.ambush(1, 10, -48, -24), g(0, -46.3, 0.5), this.shift(0), this.fight(5, 22), g(0, -51.6, 0.5, D)];
      case 4: return [this.shift(0), g(-2.2, -53.4, 0.2, P), this.wait(0.3, { yaw: N }), this.hop(N), g(-1.4, -56.2, 0.2, P), this.wait(0.3, { yaw: E }), this.hop(E, 1), g(2.2, -55.3, 0.2, P), this.wait(0.3, { yaw: S }), this.hop(S, 0),
        g(1.3, -51.8, 0.2, P), this.wait(0.3, { yaw: W }), this.hop(W, 1), g(-2.2, -52.7, 0.2, P), this.wait(0.3, { yaw: N }), this.hop(N), g(0, -56.6, 0.4, D), g(0, -60.4, 0.5, D)];
      // 天台：守卫都在现世，蜃界这边是空的 —— 留在蜃界把他们逐个处决，再去信标
      default: return [this.shift(1), g(0, -61.2, 0.5, D), this.ambush(1, 12, -76, -59), g(0, -68.4, 0.6, { direct: true })];
    }
  }
  start(k) { this.sec = k; this.steps = []; for (let j = k; j <= 5; j++) this.steps.push({ sec: j }, ...this.section(j)); this.i = 0; this.stT = 0; this.first = true; this.d = {}; this.vin.set('KeyC', false); }

  // ---------- 输出 ----------
  move(x, z) { const l = Math.hypot(x, z) || 1; this.mv.set(x / l, 0, z / l); this.moving = true; }
  lookAt(x, y, z) { const p = this.body; p.getEye(_e); const dx = x - _e.x, dy = y - _e.y, dz = z - _e.z; this.ty = yawOf(dx, dz); this.tp = Math.atan2(dy, Math.hypot(dx, dz)); this.looked = true; }
  lookDir(yaw, pitch) { this.ty = yaw; this.tp = pitch; this.looked = true; }
  // 找这一界里看得见的最近敌人
  scan(r) {
    const g = this.game, p = this.body; p.getEye(_e); let best = null, bd = r;
    for (const a of g.actors) { if (!a.alive || a.team === 0 || a.phase !== g.phase) continue; a.aimPoint(_t); const d = _t.distanceTo(_e); if (d < bd && !g.world.blocked(_e, _t)) { bd = d; best = a; } }
    this.tgt = best; return best;
  }

  update(dt) {
    const g = this.game, p = this.body, R = g.rift, vin = this.vin, a = vin.axis;
    vin.endFrame(); vin.set('KeyZ', false); this.moving = false; this.looked = false; this.noCombat = false; this.restart = false; let fire = false, aimW = 10; const W = g.weapons; let want = 'rifle';
    if (R.t < this.lastT) this.reset(); this.lastT = R.t;   // 新的一局
    if (g.state !== 'playing' || !R.running || R.done || !p.alive) { if (!p.alive) this.wasAlive = false; a.f = 0; a.s = 0; vin.set('Mouse0', false); vin.set('KeyC', false); return; }
    if (this.sec < 0 || !this.wasAlive || R.stats.falls !== this.falls) { this.wasAlive = true; this.falls = R.stats.falls; this.start(R.cp); }
    // 当前步骤
    while (this.i < this.steps.length && this.steps[this.i].sec !== undefined) { this.sec = this.steps[this.i].sec; this.i++; }
    if (this.i < this.steps.length) {
      const done = this.steps[this.i](); this.first = false; this.stT += dt;
      if (this.restart) { this.stat.restarts++; this.start(this.sec); }
      else if (done) { this.i++; this.stT = 0; this.first = true; }
      else if (this.stT > 14) { this.stat.rescues++; R.respawn(false); this.start(R.cp); }   // 卡住：回检查点重来
    }
    // 战斗：没有被步骤禁止时，看得见敌人就转过去开火（移动方向不变，等于边走边打）。瞄脖子的高度并抵消后坐力，枪口上跳时正好落在头上
    if (!this.noCombat) {
      if ((this.scanT -= dt) <= 0) { this.scanT = 0.1; this.scan(32); }
      const t = this.tgt;
      if (t && t.alive && t.phase === g.phase) {
        t.aimPoint(_t); const dist = _t.distanceTo(p.pos); this.lookAt(_t.x, _t.y + 0.16, _t.z); this.tp -= p.recoilPitch; this.ty -= p.recoilYaw; const e = Math.abs(angDiff(this.ty, p.yaw)) + Math.abs(this.tp - p.pitch);
        // 目标和自己都在动：按目标方位的角速度加前馈，否则准星总是慢半拍
        if (this.pty !== null && this.ptgt === t) { const om = clamp(angDiff(this.ty, this.pty) / dt, -4, 4); this.om += (om - this.om) * Math.min(1, dt * 12); } else this.om = 0;
        this.pty = this.ty; this.ptgt = t; aimW = 18; this.ty += this.om * 2 / aimW;
        // 追猎者会冲上来近战：进了八米换霰弹枪，一枪放倒
        want = t.kind === 'stalker' && dist < (W.cur === 'shotgun' ? 11 : 8.5) && W.ammo.shotgun > 0 ? 'shotgun' : 'rifle';
        const tol = Math.max(0.035, Math.min(0.12, 0.42 / dist));   // 允许的瞄准误差：约半个身位
        if (W.cur === 'shotgun') { if (e < tol * 1.3 && W.cooldown <= 0 && W.ammo.shotgun > 0 && W.switchT < 0) vin.tap('Mouse0'); } else fire = e < tol;
      } else { this.tgt = null; this.pty = null; }
    } else { this.tgt = null; this.pty = null; }
    // 弹药：打空了就换弹；没有敌人时把手里的枪装满（霰弹枪装满了再换回步枪）
    if (W.reloadT < 0 && W.switchT < 0) { const am = W.ammo[W.cur], full = W.cur === 'shotgun' ? 6 : 30; if (am <= 0 || (!this.tgt && am < full * 0.6)) vin.tap('KeyR'); }
    if (!this.tgt && W.cur === 'shotgun' && (W.ammo.shotgun < 6 || W.reloadT >= 0)) want = 'shotgun';
    this.swCD -= dt; if (want !== W.cur && this.swCD <= 0 && W.switchT < 0) { vin.tap(want === 'shotgun' ? 'Digit2' : 'Digit1'); this.swCD = 0.9; }
    if (!this.looked) { if (this.moving) { this.ty = yawOf(this.mv.x, this.mv.z); this.tp = -0.04; } else { this.ty = p.yaw; this.tp = p.pitch * 0.9; } }
    vin.set('Mouse0', fire);
    // 视角：临界阻尼地转向目标方位
    const w = aimW, ex = Math.exp(-w * dt); let u = this.yv, x = -angDiff(this.ty, p.yaw), tmp = (u + w * x) * dt; this.yv = clamp((u - w * tmp) * ex, -9, 9);
    u = this.pv; x = -(this.tp - p.pitch); tmp = (u + w * x) * dt; this.pv = clamp((u - w * tmp) * ex, -4, 4);
    const dyaw = this.yv * dt; vin.dx = -dyaw / p.sens; vin.dy = -this.pv * dt / p.sens;
    if (this.moving) { const yaw = p.yaw + dyaw, sy = Math.sin(yaw), cy = Math.cos(yaw); a.f = -this.mv.x * sy - this.mv.z * cy; a.s = this.mv.x * cy - this.mv.z * sy; } else { a.f = 0; a.s = 0; }
  }
}
