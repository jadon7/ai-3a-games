// 玩法：守住这栋楼。敌人从院子里跑过来——有的贴在门窗外探身射击，有的直接冲进屋、沿着走廊和房间找人。
// 敌人的动作：下半身走/跑/站/跪，上半身持枪（瞄准或低姿），按寻路结果移动，看得见玩家才开枪。
import * as THREE from 'three';
import { b2t, GROUND_Z, FLOOR_Z, MODES, QS } from './config.js';
import { L } from './world.js';
import { LV, regionOf, inFoot, floorOfZ, L_OF_FLOOR } from './level.js';

const rand = (a, b) => a + Math.random() * (b - a);
const smooth = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const wrapPi = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const ENEMY_ENV = 0.33, DEG = Math.PI / 180;      // 院子里的敌人受环境光的系数（和影片标定过的一致）；进了屋按 1.0
const RUN = 3.1, WALK = 1.35;

function raySegDist(o, d, a, b) {     // 射线(o,d) 到线段 ab 的最近距离，返回 [距离, 射线参数 t]
  const u = new THREE.Vector3().subVectors(b, a), w = new THREE.Vector3().subVectors(o, a);
  const A = d.dot(d), B = d.dot(u), C = u.dot(u), D = d.dot(w), E = u.dot(w), den = A * C - B * B;
  let s = den < 1e-9 ? 0 : (A * E - B * D) / den; s = Math.max(0, Math.min(1, s));
  let t = (B * s - D) / A; if (t < 0) t = 0;
  const p = new THREE.Vector3().copy(o).addScaledVector(d, t), q = new THREE.Vector3().copy(a).addScaledVector(u, s);
  return [p.distanceTo(q), t];
}

let FOE_ID = 0;
class Foe {
  constructor(game, sx, sy, plan) {
    const g = this.g = game; this.id = ++FOE_ID;
    this.e = g.asset.spawn(); g.world.scene.add(this.e.root);
    this.x = sx; this.y = sy; this.L = plan.L ?? 2; this.z = g.nav.floorSmooth(this.L, sx, sy); this.vx = 0; this.vy = 0; this.speed = 0;
    const p = g.player;
    this.yaw = Math.atan2(p.pos.x - sx, -(p.pos.y - sy)); this.lean = 0;
    this.hp = 2; this.alive = true; this.exposed = false; this.sees = false; this.seeT = 0; this.lastSeenT = -9; this.lastKnown = [p.pos.x, p.pos.y, p.layer]; this.lkz = p.z + 1.25;
    this.role = plan.role; this.slot = plan.slot || null; this.mode = 'travel'; this.sub = 'hide'; this.t = 0; this.cycles = 0; this.blindCycles = 0; this.maxCycles = 2 + Math.floor(Math.random() * 3);
    this.path = null; this.pi = 0; this.repathT = 0; this.stuck = 0; this.usedInner = false;
    this.fs = 'idle'; this.ft = 0; this.shotsLeft = 0; this.nextShot = 0; this.shotsFired = 0; this.grace = 2; this.bursts = 0; this.peekBursts = 0; this.hasToken = false;
    this.flinchT = -9; this.stun = 0; this.stagger = 0; this.kneeling = false; this.kneelT = 0; this.stepPh = Math.random(); this.percT = rand(0, 0.12); this.probeT = 0; this.probe = null;
    this.aimW = 0; this.deadT = 0; this.holdT = 0; this.sawInPeek = false;
    this.duckT = 0; this.bendS = 0; this.mv = null; this.mvCool = rand(0.5, 1.4); this.mag = 22 + Math.floor(Math.random() * 9); this.reloadT = 0; this.suppT = -9; this.kneelMax = 5; this.swPh = rand(0, 20);
    this.e.root.scale.setScalar(rand(0.965, 1.04));          // 个头略有差别
    this.e.up.snap('ready'); this.e.lo.snap('run');
    if (this.role === 'guard') { this.mode = 'hold'; this.baseYaw = this.yaw = this._yawTo(...plan.watch); this.holdMax = rand(32, 60); this.aloneT = 0; this.e.lo.snap('aim'); }
    else if (this.role === 'peeker' && this.slot) { g.slotUsers[this.slot.id] = this; if (!this._goto(...this.slot.hide, this.slot.L)) this._becomePusher(); }
    else this._becomePusher();
    this._probe(true); this._apply(0);
  }
  // ---------------------------------------------------------------- 移动
  _goto(x, y, L = this.L) { const g = this.g, pth = g.nav.path({ x: this.x, y: this.y, L: this.L }, { x, y, L }, false, g.time < (this.avoidUntil || 0) ? this.avoid : null); this.path = pth; this.pi = 0; this.goal = [x, y, L]; return !!pth; }
  _becomePusher() { if (this.slot && this.g.slotUsers[this.slot.id] === this) delete this.g.slotUsers[this.slot.id]; this.slot = null; this.role = 'pusher'; this.mode = 'push'; this.t = 0; this.repathT = 0; this.lean = 0; }
  _move(dt, vxw, vyw) {
    const g = this.g, nav = g.nav, k = 1 - Math.exp(-dt * 8);
    for (const o of g.foes) {      // 互相别挤在一起
      if (o === this || !o.alive) continue; const dx = this.x - o.x, dy = this.y - o.y, d = Math.hypot(dx, dy);
      if (d < 0.66 && d > 1e-3) { const f = (0.66 - d) * 2.2; vxw += dx / d * f; vyw += dy / d * f; }
    }
    {      // 也别贴到玩家身上（楼梯转角、门口迎面撞上时各自让开一个身位）
      const pl = g.player;
      if (!pl.dead && Math.abs(pl.z - this.z) < 1.2) { const dx = this.x - pl.pos.x, dy = this.y - pl.pos.y, d = Math.hypot(dx, dy); if (d < 1.05 && d > 1e-3) { const f = (1.05 - d) * 3.2; vxw += dx / d * f; vyw += dy / d * f; } }
    }
    this.vx += (vxw - this.vx) * k; this.vy += (vyw - this.vy) * k;
    const nx = this.x + this.vx * dt, ny = this.y + this.vy * dt;
    const st = (x, y) => nav.stand(x, y, this.z, 0.5, 0.5, 'maskA');      // 能踩上去的那一层（楼梯平台上会换层）
    let l;
    if ((l = st(nx, ny)) >= 0) { this.x = nx; this.y = ny; this.L = l; }
    else if ((l = st(nx, this.y)) >= 0) { this.x = nx; this.L = l; this.vy *= 0.3; }
    else if ((l = st(this.x, ny)) >= 0) { this.y = ny; this.L = l; this.vx *= 0.3; }
    else {
      // 三个方向都迈不出去（粗网格找的路贴着一小截墙角，细格上过不去）：往两边错开一点绕过去
      let moved = false;
      if (Math.hypot(vxw, vyw) > 0.3) for (const a of [0.9, -0.9, 1.7, -1.7, 2.5, -2.5]) {
        const c = Math.cos(a), s_ = Math.sin(a), ux = (vxw * c - vyw * s_) * dt, uy = (vxw * s_ + vyw * c) * dt;
        if ((l = st(this.x + ux, this.y + uy)) >= 0) { this.x += ux; this.y += uy; this.L = l; this.vx = ux / dt * 0.6; this.vy = uy / dt * 0.6; moved = true; break; }
      }
      if (!moved) { this.vx *= 0.3; this.vy *= 0.3; }
    }
    this.speed = Math.hypot(this.vx, this.vy);
    this.z += (nav.floorSmooth(this.L, this.x, this.y) - this.z) * (1 - Math.exp(-dt * 14));
  }
  // 沿路径走；到终点返回 true
  _follow(dt, sp) {
    if (!this.path || !this.path.length) { this._move(dt, 0, 0); return true; }
    let tx, ty, dx, dy, d;
    const nav_ = this.g.nav; let tl, near;
    for (;;) { [tx, ty, tl] = this.path[this.pi]; dx = tx - this.x; dy = ty - this.y; d = Math.hypot(dx, dy); near = Math.abs(nav_.floor(tl, tx, ty) - this.z) < 0.9; if (d < 0.3 && near && this.pi < this.path.length - 1) this.pi++; else break; }
    if (d < 1e-4) { dx = 1e-4; d = 1e-4; }
    const last = this.pi === this.path.length - 1;
    if (last && d < 0.14 && near) { this._move(dt, 0, 0); return true; }
    const v = last ? Math.min(sp, Math.max(0.7, d * 3.2)) : sp;
    const px = this.x, py = this.y;
    this._move(dt, dx / d * v, dy / d * v);
    if (Math.hypot(this.x - px, this.y - py) < v * dt * 0.25) {
      this.stuck += dt;
      if (this.stuck > 0.6) {      // 被挡住了：先重新找路；连着几次都不行，就记下这里堵，换条路（或者换个打法）
        this.stuck = 0; this.stuckN = (this.stuckN || 0) + 1;
        if (this.stuckN >= 3) { this.stuckN = 0; this.avoid = [this.x, this.y, this.L]; this.avoidUntil = this.g.time + 7; if (this.mode === 'travel' && this.role === 'peeker') this._becomePusher(); }
        this._goto(...this.goal);
      }
    } else { this.stuck = Math.max(0, this.stuck - dt); if (this.speed > 0.8) this.stuckN = 0; }
    return false;
  }
  _turn(dt, want, rate = 7.5) { const d = wrapPi(want - this.yaw); this.yaw += clamp(d, -rate * dt, rate * dt); return Math.abs(d); }
  _yawTo(x, y) { return Math.atan2(x - this.x, -(y - this.y)); }
  _probe(force) {
    this.probeT -= 0.4; const g = this.g, pr = g.world.probeAt ? g.world.probeAt(this.x, this.y, regionOf(this.x, this.y, this.z), this.probe, this.z) : null;
    if (pr && (pr !== this.probe || force)) { this.probe = pr; this.e.setEnv(pr.rt.texture, pr.reg === 'out' ? ENEMY_ENV : 1.0); }
  }
  // ---------------------------------------------------------------- 感知：头到玩家的头/胸之间有没有遮挡
  _perceive() {
    const g = this.g, p = g.player; if (p.dead) { this.sees = false; return; }
    const eye = this.e.headWorld(_a); let sees = false;
    for (const tgt of [g.camera.position, _b.copy(b2t(p.pos.x, p.pos.y, p.eyeB.z - 0.32))]) {
      _c.subVectors(tgt, eye); const d = _c.length(); if (d > 45) continue; _c.multiplyScalar(1 / d);
      const h = g.world.raycast(eye, _c, d); if (!h || h.distance > d - 0.06) { sees = true; break; }
    }
    this.sees = sees; if (sees) { this.lastSeenT = g.time; this.lastKnown = [p.pos.x, p.pos.y, p.layer]; this.lkz = p.eyeB.z - 0.3; }
  }
  // ---------------------------------------------------------------- 开火节奏：反应 → 点射 → 停顿
  _fire(dt, can) {
    const g = this.g, D = g.diff;
    const release = () => { if (this.hasToken) { this.hasToken = false; g.tokens++; } };
    if (this.fs === 'idle') { if (can) { this.fs = 'react'; this.ft = rand(0.45, 0.9) * D.react * (this.bursts ? 0.75 : 1); } }
    else if (this.fs === 'react') {
      if (!can) { this.ft += dt * 0.5; if (g.time - this.lastSeenT > 0.5) this.fs = 'idle'; return; }
      this.ft -= dt;
      if (this.ft <= 0 && g.tokens > 0) {
        // 远了一两发慢慢瞄着打，近了才连着打一串
        const dd = Math.hypot(g.player.pos.x - this.x, g.player.pos.y - this.y);
        g.tokens--; this.hasToken = true; this.fs = 'burst'; this.shotsLeft = Math.min(this.mag, dd > 12 ? 1 + Math.floor(Math.random() * 2) : (dd > 6 ? 2 + Math.floor(Math.random() * 3) : 3 + Math.floor(Math.random() * 4))); this.nextShot = 0; this.ft = 0;
      }
    } else if (this.fs === 'burst') {
      this.ft += dt;
      if (g.player.dead) this.shotsLeft = 0;
      if (this.ft >= this.nextShot && this.shotsLeft > 0) { this._shoot(); this.shotsLeft--; this.mag--; this.nextShot = this.ft + rand(0.085, 0.11); }
      if (this.shotsLeft <= 0) {
        release(); this.fs = 'pause'; this.ft = rand(0.4, 1.0) * D.react; this.bursts++; this.peekBursts++;
        if (this.mag <= 0) { this.reloadT = rand(1.9, 2.7); this.mag = 22 + Math.floor(Math.random() * 9); this.mvCool = 0; }      // 打空了：放低枪换弹匣，顺便挪个地方
      }
    } else if (this.fs === 'pause') { this.ft -= dt; if (this.ft <= 0) this.fs = 'idle'; }
  }
  _stopFire() { if (this.hasToken) { this.hasToken = false; this.g.tokens++; } this.fs = 'idle'; }
  _shoot() {
    const g = this.g, p = g.player;
    this.e.root.updateMatrixWorld(true);
    const mz = this.e.muzzleWorld();
    g.fx.enemyFlash(mz, g.camera, 715 * g.M.flashK);        // 影片 650W；游戏里没有二次反弹光，按实测补 10%
    this.e.kick(rand(0.8, 1.25));
    g.log.push(`${g.time.toFixed(3)} E${this.id}`);
    const cam = g.camera.position, d = mz.distanceTo(cam);
    const rel = mz.clone().sub(cam).applyQuaternion(g.camera.quaternion.clone().invert());
    const pan = Math.max(-0.7, Math.min(0.7, rel.x / (Math.abs(rel.z) + 1)));
    g.audio.rnd('rifle', 4, { gain: 5.0 * Math.min(1.4, 6 / d) * (this.sees ? 1 : 0.6), pan, wet: 0.9, delay: d / 343 });
    g.fx.burst(mz.clone(), new THREE.Vector3(0, 0.15, 0).add(this.e.barrelDir()), { n: 2, speed: 2.5, spread: 0.35, size0: 0.08, size1: 0.45, life: 30, color: [0.7, 0.72, 0.75], alpha: 0.16, rise: 0.12 });
    // 弹道：瞄玩家胸口，带散布；越打越准，玩家在跑、蹲着、探着身就更难中
    const target = b2t(p.pos.x, p.pos.y, p.eyeB.z - 0.32);
    const sigma = (Math.max(4.0, 6.5 * Math.pow(0.9, this.shotsFired)) * g.diff.spread * (1 + 0.6 * Math.min(1, p.speed / 2.5)) * (1 + 0.35 * p.crouch) * (1 + 0.5 * Math.min(1, this.speed)) * (1 + 0.2 * Math.abs(p.lean))) * DEG;
    this.shotsFired++;
    const dir = target.clone().sub(mz).normalize();
    const ax = new THREE.Vector3(rand(-1, 1), rand(-1, 1), rand(-1, 1)).cross(dir).normalize();
    let ang = Math.abs(rand(-1, 1) + rand(-1, 1)) * sigma;
    if (this.grace > 0) {      // 每个敌人露头后的头两枪一定打偏：先看到弹着、听到子弹，再还击
      this.grace--;
      if (Math.random() < 0.7) {      // 多数打在玩家身前的地上（看得见的弹着）
        const fwd2 = new THREE.Vector3(mz.x - target.x, 0, mz.z - target.z).normalize(), side = new THREE.Vector3(-fwd2.z, 0, fwd2.x);
        const pt = new THREE.Vector3(target.x, p.z, target.z).addScaledVector(fwd2, rand(1.0, 3.4)).addScaledVector(side, rand(-1.0, 1.0));
        dir.copy(pt).sub(mz).normalize(); ang = 0;
      } else ang = Math.max(ang, rand(0.45, 0.95) / Math.max(1, mz.distanceTo(target)));
    }
    dir.applyAxisAngle(ax, ang);
    const wall = g.world.raycast(mz, dir, 60);
    const [miss, tAlong] = raySegDist(mz, dir, target.clone().setY(target.y - 0.35), target.clone().setY(target.y + 0.45));
    if (!p.dead && !g.god && miss < 0.24 && p.time - p.lastHurtT > 0.7 && (!wall || wall.distance > tAlong)) {
      p.hurt(34); g.stats.hurt++;
      g.audio.play('thud', { gain: 1.6, wet: 0.1 }); g.audio.play('gasp', { gain: 0.09, wet: 0, delay: 0.08 });
    } else if (g._waterShot(mz, dir, wall ? wall.distance : 60)) {       // 打进水里
    } else if (wall) {
      const n = wall.face.normal.clone(); if (n.dot(dir) > 0) n.negate();
      const kind = n.y > 0.7 ? 'floor' : 'wall';
      const dc = wall.point.distanceTo(cam);
      g.fx.impact(wall.point, n, kind, dc < 1.6 ? 1.35 : 1);
      g.audio.rnd('impact', 4, { gain: Math.min(2.2, 2.4 / Math.max(dc, 0.8)), wet: 0.55, delay: 0.01 });
      if (dc < 1.4) p.flinch(0.8);
    } else if (dir.y < -0.02) { const t = (GROUND_Z - mz.y) / dir.y; if (t > 0 && t < 60) g.fx.impact(mz.clone().addScaledVector(dir, t), new THREE.Vector3(0, 1, 0), 'ground'); }
    g.audio.rnd('snap', 3, { gain: 2.4 * Math.min(1, 0.9 / Math.max(miss, 0.3)), wet: 0.55, delay: 0.007 });
    if (!this._firstShotDone) { this._firstShotDone = true; p.flinch(1.0); }
  }
  // ---------------------------------------------------------------- 每帧
  _apply(dt) {
    const r = this.e.root, g = this.g, p = g.player;
    r.position.copy(b2t(this.x, this.y, this.z));
    r.rotation.set(0, 0, 0); r.rotateY(this.yaw); r.rotateZ(this.lean * DEG);
    const aiming = this.alive && this.stun <= 0 && (this.e.up.cur === 'aim');
    this.aimW += ((aiming ? 1 : 0) - this.aimW) * Math.min(1, dt * 8);
    if (this.alive) {
      this.e.aimTarget = _aim.copy(b2t(this.lastKnown[0], this.lastKnown[1], this.sees || g.time - this.lastSeenT < 1 ? p.eyeB.z - 0.3 : (this.lastKnown[2] === this.L ? this.z + 1.25 : this.lkz)));
      // 枪口不会死死钉在一个点上：瞄准点随呼吸慢慢游走（离得越远游走得越开）
      const tt = g.time + this.swPh, wob = 0.035 + 0.006 * Math.min(20, Math.hypot(p.pos.x - this.x, p.pos.y - this.y));
      _aim.x += (Math.sin(tt * 1.31) + 0.5 * Math.sin(tt * 2.9)) * wob; _aim.z += (Math.sin(tt * 1.07 + 2) + 0.5 * Math.sin(tt * 2.3)) * wob; _aim.y += Math.sin(tt * 0.9 + 1) * wob * 0.7;
      this.e.aimW = this.aimW;
      const bt = this.stun > 0 ? 0.55 * Math.min(1, this.stun / 0.5) : (this.duckT > 0 ? 0.42 : (this.reloadT > 0 ? 0.14 : 0));
      this.bendS += (bt - this.bendS) * Math.min(1, dt * (bt > this.bendS ? 16 : 6)); this.e.bend = this.bendS > 0.004 ? this.bendS : 0;
    }
    else { this.e.aimTarget = null; this.e.bend = 0; }
    this.e.update(dt);
    // 中弹时躯干一震
    const tf = g.time - this.flinchT;
    if (tf < 0.24 && this.e.chest && !this.e.rag) {
      const a = [0.0, 1.0, 0.8, 0.5, 0.3, 0.15, 0.05][Math.min(6, Math.floor(tf * 30))];
      this.e.chest.rotateY(-16 * a * DEG); this.e.chest.rotateX(-9 * a * DEG);
    }
    r.updateMatrixWorld(true);
  }
  _steps(dt) {       // 脚步声：离得近才听得到，隔着墙更闷
    if (this.speed < 0.5) return;
    const g = this.g; this.stepPh += dt * (this.speed > 2.05 ? 3.1 : 1.75);
    if (this.stepPh < 1) return; this.stepPh -= 1;
    const wd = g.world.pool ? g.world.pool.depthAt(this.x, this.y, this.z) : 0; if (wd > 0.03) g.world.pool.ripple(this.x, this.y, this.speed > 2.05 ? 1.5 : 0.9);
    const d = Math.hypot(this.x - g.player.pos.x, this.y - g.player.pos.y); if (d > 16) return;
    const rel = _a.copy(this.e.root.position).sub(g.camera.position).applyQuaternion(_q.copy(g.camera.quaternion).invert());
    g.audio.rnd(wd > 0.03 ? 'splash' : 'step', wd > 0.03 ? 3 : 6, { gain: 0.11 * (this.speed > 2.05 ? 1.5 : 1) * Math.min(1.6, 5 / Math.max(d, 1.5)) * (this.sees ? 1 : 0.55), pan: clamp(rel.x / (Math.abs(rel.z) + 1), -0.8, 0.8), wet: 0.5, delay: d / 343 });
  }
  update(dt) {
    const g = this.g, p = g.player, e = this.e; this.t += dt;
    if (!this.alive) {
      this.deadT += dt;
      if (!e.rag && this.deadT < 0.7 && (this.vx || this.vy)) {
        const k = Math.exp(-this.deadT * 5), nx = this.x + this.vx * k * dt, ny = this.y + this.vy * k * dt;
        if (g.nav.okA(this.L, nx, ny)) { this.x = nx; this.y = ny; }
      }
      this._apply(dt); return;
    }
    this.percT -= dt; if (this.percT <= 0) { this.percT = 0.1; this._perceive(); }
    this.probeT += dt; if (this.probeT > 0.4) this._probe(false);
    this.seeT = this.sees ? this.seeT + dt : 0;
    this.exposed = this.sees;
    const dP = Math.hypot(p.pos.x - this.x, p.pos.y - this.y, p.z - this.z);
    if (this.stagger > 0) this.stagger -= dt;
    if (this.duckT > 0) this.duckT -= dt;
    if (this.reloadT > 0) this.reloadT -= dt;
    // ---------------- 被闪光弹晃到：站不稳、放下枪、开不了火
    if (this.stun > 0) {
      this.stun -= dt; this._stopFire(); this.lean += (0 - this.lean) * Math.min(1, dt * 6);
      this._move(dt, -Math.sin(this.yaw) * 0.35, Math.cos(this.yaw) * 0.35);
      e.setUpper('ready', 0.2); e.locomotion(this.speed, 'idle', true);
      if (this.stun <= 0 && this.mode !== 'slot') { this.mode = 'push'; this.repathT = 0; }
      this._steps(dt); this._apply(dt); return;
    }
    if (this.mode === 'travel') {
      // 跑向掩护位；半路上玩家贴得很近就先打
      const near = this.goal ? Math.hypot(this.goal[0] - this.x, this.goal[1] - this.y) : 0;
      const arrived = this._follow(dt, near < 2.2 ? 1.9 : RUN);
      if (this.speed > 0.3) this._turn(dt, Math.atan2(this.vx, -this.vy), 9);
      e.setUpper('ready', 0.25); e.locomotion(this.speed, 'idle');
      if (this.sees && dP < 5.5) { this.mode = 'engage'; this.t = 0; this.back = 'travel'; }
      else if (arrived) { this.mode = 'slot'; this.sub = 'hide'; this.t = 0; this.wait = rand(0.5, 1.6); this.x = this.slot.hide[0]; this.y = this.slot.hide[1]; this.L = this.slot.L; this.vx = this.vy = 0; this.speed = 0; }
    } else if (this.mode === 'slot') this._slot(dt, dP);
    else if (this.mode === 'push') this._push(dt, dP);
    else if (this.mode === 'engage') this._engage(dt, dP);
    else if (this.mode === 'hold') this._hold(dt, dP);
    this._steps(dt); this._apply(dt);
  }
  // ---------------- 蹲守：守在别的楼层的房间里，枪口对着门口来回扫；看见人就打，听见同一层的枪声、挨了打、或者等久了就出来找
  _hold(dt, dP) {
    const g = this.g, p = g.player, e = this.e;
    this.lean += (0 - this.lean) * Math.min(1, dt * 6);
    this._turn(dt, this.baseYaw + Math.sin(this.t * 0.55 + this.id * 1.7) * 0.3, 1.2);
    this._move(dt, 0, 0);
    e.setUpper('ready', 0.3); e.locomotion(0, 'aim');
    const heard = Math.abs(p.z - this.z) < 1.6 && g.time - g.lastShotT < 0.25 && dP < 16;
    if (g.toSpawn === 0 && !g.foes.some((f) => f.alive && f.mode !== 'hold')) this.aloneT += dt;      // 别人都打完了，只剩蹲守的：过几秒自己出来
    if (this.sees && dP < 18 && !p.dead) { this.role = 'pusher'; this.mode = 'engage'; this.t = 0; this.back = 'push'; this.fs = 'idle'; this.kneeling = false; this.holdT = rand(2.5, 5); }
    else if (heard || this.t > this.holdMax || this.aloneT > 5 || this.stagger > 0) { this.lastKnown = [p.pos.x, p.pos.y, p.layer]; this._becomePusher(); }
  }
  // ---------------- 门窗外的掩护位：藏 → 探身 → 瞄准点射 → 缩回
  _slot(dt, dP) {
    const g = this.g, p = g.player, e = this.e, s = this.slot, D = g.diff;
    const look = this._yawTo(...(g.time - this.lastSeenT < 6 ? this.lastKnown : [p.pos.x, p.pos.y]));
    const mx = s.peek[0] - s.hide[0], my = s.peek[1] - s.hide[1];
    const side = Math.sign(mx * (-Math.cos(look)) + my * (-Math.sin(look))) || 1;       // 往自己右边探是 +1（身体向右倾）
    this._turn(dt, look, 9);
    if (this.sub === 'hide') {
      this.x = s.hide[0]; this.y = s.hide[1]; this.lean += (0 - this.lean) * Math.min(1, dt * 8); this.speed = 0;
      e.setUpper('ready', 0.3); e.locomotion(0, 'aim');
      // 探了几次、探出来总看不到人，或者人已经不在这个门窗对着的房间里了：改成冲进去找
      const away = s.kind !== 'inner' && !s.covers.includes(regionOf(p.pos.x, p.pos.y, p.z)) && g.time - this.lastSeenT > 2.5 && this.t > 0.8;
      if (this.cycles >= this.maxCycles || this.blindCycles >= 2 || away) { this._becomePusher(); return; }
      if (this.t > this.wait && !p.dead) { this.sub = 'out'; this.t = 0; this.peekBursts = 0; this.sawInPeek = false; this.need = 1 + (Math.random() < 0.45 ? 1 : 0); }
    } else if (this.sub === 'out') {
      const k = smooth(this.t / 0.4); this.x = s.hide[0] + mx * k; this.y = s.hide[1] + my * k;
      this.lean = side * (this.t < 0.18 ? 15 * smooth(this.t / 0.18) : 15 - 7 * smooth((this.t - 0.18) / 0.22));
      this.speed = 1.6; e.setUpper('aim', 0.22); e.lo.set('walk', 0.12, { timeScale: 1.7 });
      if (this.t >= 0.4) { this.sub = 'peek'; this.t = 0; this.fs = 'idle'; }
    } else if (this.sub === 'peek') {
      this.x = s.peek[0]; this.y = s.peek[1]; this.speed = 0; this.lean += (side * 8 - this.lean) * Math.min(1, dt * 6);
      e.setUpper('aim', 0.2); e.locomotion(0, 'aim');
      if (this.sees) this.sawInPeek = true;
      this._fire(dt, this.sees && !p.dead);
      const done = (this.peekBursts >= this.need && this.fs !== 'burst') || (!this.sees && this.t > (this.sawInPeek ? 1.6 : 2.6) && this.fs !== 'burst') || this.t > 7;
      if (done || p.dead && this.t > 1.5) { this._stopFire(); this.sub = 'in'; this.t = 0; }
    } else if (this.sub === 'in') {
      const k = smooth(this.t / 0.42); this.x = s.peek[0] - mx * k; this.y = s.peek[1] - my * k; this.lean = side * 8 * (1 - k);
      this.speed = 1.5; e.setUpper('ready', 0.3); e.lo.set('walk', 0.12, { timeScale: -1.6 });
      if (this.t >= 0.42) { this.sub = 'hide'; this.t = 0; this.wait = rand(1.1, 3.2) * D.react; this.shotsFired = Math.max(0, this.shotsFired - 2); this.cycles++; this.blindCycles = this.sawInPeek ? 0 : this.blindCycles + 1; }
    }
    this.L = s.L; this.z = g.nav.floorSmooth(s.L, this.x, this.y);
  }
  // ---------------- 进屋找人
  _push(dt, dP) {
    const g = this.g, p = g.player, e = this.e;
    this.lean += (0 - this.lean) * Math.min(1, dt * 6);
    // 进到玩家所在房间之前，先在门框边停一下、探头看一眼（只做一次）
    if (!this.usedInner && this.t > 0.2) {
      this.usedInner = true;
      const pr = regionOf(p.pos.x, p.pos.y, p.z), mr = regionOf(this.x, this.y, this.z);
      if (pr !== 'out' && pr !== mr && Math.random() < 0.6) {
        const c = LV.slots.filter((s) => s.kind === 'inner' && s.covers.includes(pr) && !g.slotUsers[s.id] && Math.hypot(s.hide[0] - p.pos.x, s.hide[1] - p.pos.y) > 2.5);
        if (c.length) { const s = c[Math.floor(Math.random() * c.length)]; this.slot = s; this.role = 'peeker'; g.slotUsers[s.id] = this; this.maxCycles = 1 + Math.floor(Math.random() * 2); this.cycles = 0; this.blindCycles = 0; if (this._goto(...s.hide, s.L)) { this.mode = 'travel'; return; } this._becomePusher(); }
      }
    }
    this.repathT -= dt;
    if (this.repathT <= 0) {
      this.repathT = rand(0.45, 0.8) * (dP > 12 ? 3 : (dP > 7 ? 1.6 : 1));        // 离得远不用那么勤地重新找路
      const atLK = this.lastKnown[2] === this.L && Math.hypot(this.lastKnown[0] - this.x, this.lastKnown[1] - this.y) < 1.2;
      const known = g.time - this.lastSeenT < 2.5 || atLK;
      const tgt = known ? [p.pos.x, p.pos.y, p.layer] : this.lastKnown;        // 最后看到的位置没人了，就循着动静找过去
      if (!this._goto(...tgt)) {
        // 找不到路（极少见）：记一下；一直找不到、玩家又看不见他，就换一个出生点重新过来
        this.path = null; this.noPath = (this.noPath || 0) + 1;
        if (this.noPath >= 4 && !this.sees) { const c = LV.spawns[Math.floor(Math.random() * LV.spawns.length)]; this.x = c[0]; this.y = c[1]; this.noPath = 0; g.log.push(`${g.time.toFixed(2)} relocate#${this.id}`); }
      } else this.noPath = 0;
      if (atLK && !this.sees) this.lastKnown = [p.pos.x, p.pos.y, p.layer];
    }
    const outdoors = regionOf(this.x, this.y, this.z) === 'out';
    const careful = !outdoors && dP < 7;
    this._follow(dt, careful ? 1.75 : RUN);
    const look = careful ? Math.sin(g.time * 1.6 + this.id * 2.1) * 0.4 : 0;      // 摸进屋的时候枪口左右扫，不是直愣愣地盯着前面走
    if (this.speed > 0.3) this._turn(dt, Math.atan2(this.vx, -this.vy) + look, careful ? 4.5 : 9);
    e.setUpper(careful ? 'aim' : 'ready', 0.25); e.locomotion(this.speed, careful ? 'aim' : 'idle');
    if (this.sees && dP < 15 && !p.dead) { this.mode = 'engage'; this.t = 0; this.back = 'push'; this.fs = 'idle'; this.kneeling = false; this.holdT = rand(1.5, 3.5); }
  }
  // ---------------- 看见人了：站定（远一点的会跪下）瞄准点射；丢了视线就追过去
  _engage(dt, dP) {
    const g = this.g, p = g.player, e = this.e, nav = g.nav;
    this.lean += (0 - this.lean) * Math.min(1, dt * 6);
    const aimYaw = this._yawTo(...this.lastKnown), busy = this.duckT > 0 || this.reloadT > 0;
    if (this.t < dt * 1.5 && dP > 5.5 && Math.random() < 0.4 && this.back === 'push' && nav.wallDist(this.L, this.x, this.y) > 0.6 && regionOf(this.x, this.y, this.z) !== 'stair') this._kneel();
    e.setUpper(this.reloadT > 0 ? 'ready' : 'aim', 0.18);
    let face = aimYaw, backward = false;
    if (this.kneeling) {
      this.kneelT += dt; if (this.kneelT > 1.5) e.setLower('kneel', 0.25); this._move(dt, 0, 0);
      if (this.kneelT > this.kneelMax && this.fs !== 'burst') { this.kneeling = false; this.mvCool = 0; }      // 跪着打一阵就起来换个位置
    } else {
      this.holdT -= dt; this.mvCool -= dt;
      const narrow = nav.wallDist(this.L, this.x, this.y) < 0.55;          // 站在门洞里：别堵着，往里走
      if (this.mv) {
        // 正在换位置：身子朝要去的方向斜过去走，上身拧回来接着瞄
        const dx = this.mv[0] - this.x, dy = this.mv[1] - this.y, d = Math.hypot(dx, dy); this.mv[2] -= dt;
        if (d < 0.2 || this.mv[2] <= 0) { this.mv = null; this.mvCool = rand(0.9, 2.6); this._move(dt, 0, 0); }
        else {
          this._move(dt, dx / d * this.mv[3], dy / d * this.mv[3]);
          const rel = wrapPi(Math.atan2(dx, -dy) - aimYaw);
          if (Math.abs(rel) <= 1.75) face = aimYaw + clamp(rel, -0.7, 0.7); else { face = aimYaw + clamp(wrapPi(rel - Math.PI), -0.7, 0.7); backward = true; }
        }
      } else if ((dP > 9 || this.holdT < 0 || narrow) && dP > 3.2 && this.fs !== 'burst' && this.stagger <= 0 && !busy) {
        // 太远就边走边压上去；站着打一阵之后也会往前挪
        this.repathT -= dt; if (this.repathT <= 0 || !this.path) { this.repathT = 0.6; this._goto(p.pos.x, p.pos.y, p.layer); }
        this._follow(dt, WALK); if (this.holdT < -1.6) this.holdT = rand(1.2, 3.0);
      } else {
        this._move(dt, 0, 0);
        // 打完一个点射就挪个位置，别站在原地当靶子
        if (this.mvCool <= 0 && this.fs !== 'burst' && this.stagger <= 0) { if (!this._pickShift(dP)) this.mvCool = rand(0.5, 1.2); }
      }
    }
    const off = this._turn(dt, face, 8);
    if (!this.kneeling) {
      if (this.speed < 0.15 && off > 0.4) e.lo.set('walk', 0.14, { timeScale: 1.3 });      // 原地转身也要倒脚，不是整个人像转盘一样转过去
      else e.locomotion(this.speed, 'aim', backward);
    }
    const aimErr = Math.abs(wrapPi(aimYaw - this.yaw));
    this._fire(dt, this.sees && aimErr < 0.8 && this.stagger <= 0 && !busy && !p.dead && (this.speed < 1.0 || dP < 6));
    if (p.dead && this.fs !== 'burst') { e.setUpper('ready', 0.5); }
    if (!this.sees && g.time - this.lastSeenT > (this.kneeling ? 1.6 : 0.9) && this.fs !== 'burst') {
      this._stopFire(); this.kneeling = false; this.mv = null;
      if (this.back === 'travel' && this.slot) { this.mode = 'travel'; this._goto(...this.slot.hide, this.slot.L); } else { this.mode = 'push'; this.repathT = 0; }
    }
  }
  _kneel() { this.kneeling = true; this.kneelT = 0; this.kneelMax = rand(3.5, 7); this.mv = null; this.e.setLower('kneel_down', 0.15, { restart: true, timeScale: 1.25 }); }
  // 交战中换个位置：往两边、斜着往前或往后挪一两步。pref=[x,y] 是想躲开的方向（子弹从另一边过来），fast 是躲子弹时的快步
  _pickShift(dP, pref = null, fast = false) {
    const g = this.g, nav = g.nav, p = g.player;
    const ax = p.pos.x - this.x, ay = p.pos.y - this.y, d = Math.hypot(ax, ay) || 1, fx = ax / d, fy = ay / d, rx = fy, ry = -fx;
    let best = null, bs = -1e9;
    for (let k = 0; k < 7; k++) {
      const sd = Math.random() < 0.5 ? -1 : 1, fw = dP > 7 ? rand(-0.1, 0.7) : (dP < 4.5 ? rand(-0.8, 0.1) : rand(-0.4, 0.4)), len = rand(0.8, 1.9);
      let ux = rx * sd + fx * fw, uy = ry * sd + fy * fw; const ul = Math.hypot(ux, uy); ux /= ul; uy /= ul;
      const tx = this.x + ux * len, ty = this.y + uy * len;
      if (!nav.okA(this.L, tx, ty) || !nav.clear(this.L, this.x, this.y, tx, ty) || Math.hypot(tx - p.pos.x, ty - p.pos.y) < 2.4) continue;
      // 偏好：躲子弹的方向；贴着墙、柱子的位置（有东西挡）
      const sc = Math.random() * 0.6 + (pref ? (ux * pref[0] + uy * pref[1]) * 1.5 : 0) + (nav.wallDist(this.L, tx, ty) < 0.7 ? 0.35 : 0);
      if (sc > bs) { bs = sc; best = [tx, ty, len]; }
    }
    if (!best) return false;
    const sp = fast ? rand(2.6, 3.1) : rand(1.6, 2.3);
    this.mv = [best[0], best[1], best[2] / sp + 0.45, sp]; this.kneeling = false;
    return true;
  }
  // 子弹贴着飞过去、打在身边的墙上：先缩一下头，多数会跟着躲开（ax, ay 是远离弹道的方向）
  suppress(ax, ay) {
    const g = this.g, p = g.player; if (!this.alive || this.stun > 0 || g.time - this.suppT < 0.45) return;
    this.suppT = g.time; this.duckT = rand(0.3, 0.6);
    if (this.fs !== 'burst' || Math.random() < 0.6) this._stopFire();
    if (!this.sees) { this.lastKnown = [p.pos.x, p.pos.y, p.layer]; this.lkz = p.z + 1.25; }
    const al = Math.hypot(ax, ay) || 1, pref = [ax / al, ay / al], dP = Math.hypot(p.pos.x - this.x, p.pos.y - this.y, p.z - this.z);
    if (this.mode === 'hold') { this._becomePusher(); return; }
    if (this.mode === 'slot') { if (this.sub === 'peek' || this.sub === 'out') { this.sub = 'in'; this.t = 0.1; } return; }      // 探着身的：缩回去
    if (this.mode !== 'engage') return;
    const r = Math.random();
    if (this.kneeling) { if (r < 0.35) { this.kneeling = false; this._pickShift(dP, pref, true); } }
    else if (r < 0.62) this._pickShift(dP, pref, true);
    else if (r < 0.8 && dP > 5 && g.nav.wallDist(this.L, this.x, this.y) > 0.6 && regionOf(this.x, this.y, this.z) !== 'stair') this._kneel();
  }
  hit(part, point, dir, dmg = 1) {
    const g = this.g;
    g.fx.bodyHit(point, dir.clone().negate());
    this.hp -= part === 'head' ? 9 : dmg; this.flinchT = g.time;
    if (this.hp <= 0) { this.die(part, dir); return; }
    this.lastSeenT = g.time; this.lastKnown = [g.player.pos.x, g.player.pos.y, g.player.layer];
    if (this.mode === 'hold') this._becomePusher();
    if (this.mode === 'slot' && (this.sub === 'peek' || this.sub === 'out')) { this._stopFire(); this.sub = 'in'; this.t = 0.1; }   // 中弹没死就缩回去
    else {
      // 挨了一枪没倒：被打得往后一个趔趄、弓一下腰，缓过来多半先换个地方
      this.stagger = rand(0.35, 0.7); this.duckT = Math.max(this.duckT, 0.45); this.fs = this.fs === 'burst' ? this.fs : 'idle'; if (this.fs === 'burst' && Math.random() < 0.7) this._stopFire();
      const hl = Math.hypot(dir.x, dir.z) || 1; this.vx += dir.x / hl * 2.6; this.vy += -dir.z / hl * 2.6;
      if (this.kneeling && Math.random() < 0.5) this.kneeling = false;
      this.mv = null; this.mvCool = Math.random() < 0.65 ? 0 : rand(0.6, 1.4);
    }
  }
  flash(sec) { if (!this.alive) return; this.stun = Math.max(this.stun, sec); this._stopFire(); this.kneeling = false; this.mv = null; }
  // 倒地：开头被倒地动作带着踉跄一下，随后交给布娃娃（按中弹的部位和方向倒，会被墙、台阶挡住）
  die(part = 'body', dir = null) {
    const g = this.g, e = this.e; this.alive = false; this.exposed = false; this.sees = false; this.deadT = 0; this.mode = 'dead';
    this._stopFire(); if (this.slot && g.slotUsers[this.slot.id] === this) delete g.slotUsers[this.slot.id];
    this.lean = 0; this.speed = 0; this.mv = null;
    const gain = Math.min(1.5, 6 / e.root.position.distanceTo(g.camera.position));
    e.playFull('fall_r', 0.14); const ts = rand(0.85, 1.25), t0 = rand(0, 0.3);
    for (const L_ of [e.lo, e.up]) { L_.a.fall_r.timeScale = ts; L_.a.fall_r.time = t0; }
    const r_ = e.root; r_.position.copy(b2t(this.x, this.y, this.z)); r_.rotation.set(0, 0, 0); r_.rotateY(this.yaw); r_.updateMatrixWorld(true);
    const ok = !QS.noragdoll && e.startRagdoll(g.world, g.nav, { dir, part, limp: this.kneeling, vel: new THREE.Vector3(this.vx, 0, -this.vy),
      onBody: () => g.audio.rnd('bodyfall', 2, { gain: 0.5 * gain, wet: 0.5 }), onGun: () => g.audio.play('rifledrop', { gain: 0.22 * gain, wet: 0.5 }) });
    if (ok) { this.vx = this.vy = 0; }
    else { this.vx *= 0.7; this.vy *= 0.7; g.audio.rnd('bodyfall', 2, { gain: 0.5 * gain, wet: 0.5, delay: 1.25 }); g.audio.play('rifledrop', { gain: 0.22 * gain, wet: 0.5, delay: 1.45 }); }
    this.kneeling = false; g.stats.kills++;
  }
  dispose() { const g = this.g; this._stopFire(); if (this.slot && g.slotUsers[this.slot.id] === this) delete g.slotUsers[this.slot.id]; g.world.scene.remove(this.e.root); this.e.mixer.stopAllAction(); for (const m of this.e.mats) m.dispose(); }
}
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _aim = new THREE.Vector3(), _q = new THREE.Quaternion();

export class Game {
  constructor(o) {
    Object.assign(this, o);        // world, camera, vm, fx, audio, asset, player, nav, mode
    this.time = 0; this.foes = []; this.log = []; this.trigger = false; this.bangAt = -1; this.lastFire = -9; this.slotUsers = {}; this.tokens = 2; this.nades = []; this.bangs = 2; this.bangT = 0;
    this.stats = { kills: 0, shots: 0, hits: 0, hurt: 0, t: 0 }; this.wave = 0; this.toSpawn = 0; this.lastShotT = -9; this.spawnT = 3.5; this.waveGap = 0;
    this.diff = { react: 1, spread: 1 }; this.running = false; this.god = false; this.lightOn = true; this.ammoShowT = -9; this.bangShowT = -9; this.cutT = 0; this.clockJump = 0;
    this.startAt = QS.start;
    const pool = this.world.pool;
    this.fx.onShellBounce = (pos, n) => {
      if (pool && pool.depthAt(pos.x, -pos.z, pos.y - 0.02) > 0.03) { if (n === 1) { this.audio.play('plop', { gain: 0.16, wet: 0.5 }); pool.ripple(pos.x, -pos.z, 0.5); } return; }      // 弹壳掉进水里
      if (n <= 2) this.audio.rnd('casing', 4, { gain: n === 1 ? 0.22 : 0.11, wet: 0.45 });
    };
    const P = this.player;
    P.onStep = (sp) => {
      if (P.wade > 0.03) { this.audio.rnd('splash', 3, { gain: (0.05 + 0.045 * Math.min(sp, 1.6)) * Math.min(1, 0.45 + P.wade * 1.4) * (1 - 0.35 * P.crouch), wet: 0.4, rate: 1.1 - 0.3 * Math.min(1, P.wade) }); pool.ripple(P.pos.x, P.pos.y, 0.7 + 0.5 * Math.min(sp, 2)); }      // 踩水
      else this.audio.rnd('step', 6, { gain: (0.026 + 0.03 * Math.min(sp, 1.2)) * 1.5 * (1 - 0.45 * P.crouch), wet: 0.2 });
    };
    P.onLand = (a) => {
      if (P.wade > 0.03) { this.audio.rnd('splash', 3, { gain: 0.2 * a, wet: 0.5, rate: 0.75 }); pool.ripple(P.pos.x, P.pos.y, 2.4 * a); this.fx.splash(b2t(P.pos.x, P.pos.y, pool.zw), Math.min(1.6, 0.6 + a)); return; }
      this.audio.rnd('step', 6, { gain: 0.09 * a, wet: 0.25, rate: 0.8 }); this.audio.rnd('step', 6, { gain: 0.07 * a, wet: 0.25, rate: 0.72, delay: 0.04 });
    };
    P.onJump = () => this.audio.rnd('step', 6, { gain: 0.05, wet: 0.2, rate: 1.1 });
    // 闪光弹的弹体
    this.nadeGeo = new THREE.CylinderGeometry(0.026, 0.026, 0.115, 12); this.nadeMat = new THREE.MeshStandardMaterial({ color: 0x23261f, roughness: 0.55, metalness: 0.5 });
    // 掩护位坐标落在墙里的话挪到最近的可走格
    this.fx.floorAt = (pt) => this.nav.floorBelow(pt.x, -pt.z, pt.y);
    for (const s of LV.slots) for (const k of ['hide', 'peek']) { const q = this.nav.nearest(s.L, s[k][0], s[k][1], 6); if (q) s[k] = q; else console.warn('slot unreachable', s.id, k); }
  }
  get M() { return MODES[this.mode]; }
  get ammo() { return this.vm.gun.ammo; }
  set ammo(v) { this.vm.gun.ammo = v; }
  get magSize() { return this.vm.def.mag; }

  reset() {
    for (const f of this.foes) f.dispose();
    this.foes = []; this.slotUsers = {}; this.tokens = 2; this.fx.clear();
    for (const n of this.nades) this.world.scene.remove(n.m); this.nades = []; if (this.held) { this.world.scene.remove(this.held); this.held = null; } L.uBang.value.w = 0; this.bangT = 0;
    this.time = 0; this.lastFire = -9; this.bangs = 2; this.trigger = false; this.bangAt = -1;
    this.stats = { kills: 0, shots: 0, hits: 0, hurt: 0, t: 0 }; this.wave = 0; this.toSpawn = 0; this.lastShotT = -9; this.spawnT = 3.2; this.waveGap = 0; this.cutT = 0; this.clockJump = 0; this.ammoShowT = -9; this.bangShowT = -9;
    const p = this.player;
    if (QS.pos) p.place(QS.pos[0], QS.pos[1], QS.pos[2] ?? 122, QS.pos[4] ?? 2); else if (this.startAt === 'pool') p.place(LV.poolStart[0], LV.poolStart[1], 0, 0); else p.place(24.72, 3.27, 90 + 32);
    p.pitch = QS.pos ? (QS.pos[3] ?? -3) : -3; p.hp = 100; p.dead = false; p.deadT = 0; p.stress = 0; p.ready = 1; p.shots = []; p.crouchOn = false; p.crouch = 0; p.ads = 0; p.adsOn = false; p.lean = 0; p.blind = 0; p.wallK = 0;
    this.vm.group.visible = true; this.vm.resetPose(); L.uWLOn.value = this.lightOn ? 1 : 0;
    p.blockFn = (x, y) => {
      for (const f of this.foes) {
        if (!f.alive || Math.abs(f.z - p.z) > 1.2) continue;
        const d1 = Math.hypot(f.x - x, f.y - y); if (d1 < 0.5 && d1 < Math.hypot(f.x - p.pos.x, f.y - p.pos.y)) return true;
      }
      return false;
    };
    this._startWave();
  }
  _startWave() {
    // 人数是原来的三分之一：每一段一到三个人（原来 4 到 9 个），同一时间在外面活动的只有一个，打到后面才会两个一起来
    this.wave++; this.toSpawn = QS.nofoe ? 0 : Math.min(3, Math.max(1, Math.round((3 + this.wave) / 3))); this.maxAlive = this.wave >= 5 ? 2 : 1; this.bangs = 2;
    // 每段人少、段数就多，所以每过一段只难一点点
    this.diff = { react: Math.max(0.5, Math.pow(0.94, this.wave - 1)), spread: Math.max(0.55, Math.pow(0.96, this.wave - 1)) };
    // 两个人以上的那几段，其中一个是守在别的楼层的
    if (this.toSpawn > 1 && !QS.noguard) this.toSpawn -= this._placeGuards(1);
  }
  // 每一段开头：在玩家不在的楼层放几个蹲守的（房间里、走廊尽头），算在这一段的人数里
  _placeGuards(n) {
    const p = this.player, pf = floorOfZ(p.z), pool = LV.guards.filter((c) => c.f !== pf);
    let placed = 0;
    while (placed < n && pool.length) {
      const c = pool.splice(Math.floor(Math.random() * pool.length), 1)[0], L_ = L_OF_FLOOR[c.f];
      const q = this.nav.nearest(L_, c.p[0], c.p[1], 12, 'maskA'); if (!q) continue;
      if (this.foes.some((f) => f.alive && f.L === L_ && Math.hypot(f.x - q[0], f.y - q[1]) < 3)) continue;
      const f = new Foe(this, q[0], q[1], { role: 'guard', L: L_, watch: c.watch });
      this.foes.push(f); placed++; this.log.push(`${this.time.toFixed(2)} guard#${f.id} F${c.f} @${q[0].toFixed(1)},${q[1].toFixed(1)}`);
    }
    return placed;
  }
  // 从院子里挑一个玩家看不到的出生点，按玩家所在的房间决定这人去哪个门窗、还是直接冲进来
  _spawn() {
    const p = this.player, reg = regionOf(p.pos.x, p.pos.y, p.z), cam = this.camera.position;
    const free = LV.slots.filter((s) => s.kind !== 'inner' && s.covers.includes(reg) && !this.slotUsers[s.id]);
    const peekers = this.foes.filter((f) => f.alive && f.role === 'peeker').length, pushers = this.foes.filter((f) => f.alive && f.role === 'pusher').length;
    let role = free.length && (Math.random() < 0.55 || pushers >= 2) ? 'peeker' : 'pusher';
    if (role === 'peeker' && peekers >= 2 && pushers === 0) role = 'pusher';
    const slot = role === 'peeker' ? free[Math.floor(Math.random() * free.length)] : null;
    const goal = slot ? slot.hide : [p.pos.x, p.pos.y];
    // 玩家在池核里时，敌人也可以从池核深处他看不到的角落里冒出来（都看得到的话，还是从院子里绕下来）
    const pts = [...(reg === 'pool0' ? LV.poolSpawns.map(([x, y]) => [x, y, 0]) : []), ...LV.spawns.map(([x, y]) => [x, y, 2])];
    const cands = pts.map(([x, y, L_]) => {
      const head = b2t(x, y, (L_ === 0 ? this.nav.floor(0, x, y) : GROUND_Z) + 1.6), d = head.clone().sub(cam), len = d.length(); d.multiplyScalar(1 / len);
      const h = this.world.raycast(cam, d, len); const hidden = !!h && h.distance < len - 0.3;
      return { x, y, L: L_, hidden, dg: Math.hypot(goal[0] - x, goal[1] - y), dp: len, busy: this.foes.some((f) => f.alive && Math.hypot(f.x - x, f.y - y) < 2) };
    }).filter((c) => !c.busy && c.dp > 9);
    let pool = cands.filter((c) => c.hidden); if (!pool.length) pool = cands; if (!pool.length) return false;
    pool.sort((a, b) => a.dg - b.dg);
    const c = pool[Math.floor(Math.random() * Math.min(3, pool.length))];
    const sp = this.nav.nearest(c.L, c.x + rand(-0.4, 0.4), c.y + rand(-0.4, 0.4), 8, 'maskA') || [c.x, c.y];
    const f = new Foe(this, sp[0], sp[1], { role, slot, L: c.L });
    this.foes.push(f); this.log.push(`${this.time.toFixed(2)} spawn#${f.id} ${f.role}${slot ? ':' + slot.id : ''} @${c.x},${c.y}`);
    return true;
  }

  fire() {
    const p = this.player, W = this.vm.def;
    if (p.dead || !this.running || this.vm.reloading || this.vm.switching || this.vm.lh > 0.3 || this.time - this.lastFire < W.interval || p.blocked || p.sprinting) return;
    this.ammoShowT = this.time;
    if (this.ammo <= 0) { if (this.time - this.lastFire > 0.25) { this.audio.play('dry', { gain: 0.12, wet: 0.1 }); this.lastFire = this.time; } return; }
    this.ammo--; this.lastFire = this.time; this.lastShotT = this.time; this.stats.shots++; this.log.push(`${this.time.toFixed(3)} P`);
    this.vm.shot(this.ammo === 0);        // 套筒 / 枪机往复，扣扳机；最后一发打完挂机
    const mw = this.vm.worldPoint(this.vm.muzzle), fwd = this.vm.forward();
    const sp = (0.0075 - 0.005 * p.ads) * (1 + 0.5 * Math.min(1, p.speed / 2));
    const dir = fwd.clone(); dir.x += rand(-1, 1) * sp; dir.y += rand(-1, 1) * sp; dir.z += rand(-1, 1) * sp; dir.normalize();
    const wall = this.world.raycast(mw, dir, 80);
    // 命中敌人？（头：球；躯干：胸到髋的胶囊；腿：髋到脚的胶囊）
    let best = null; const mo = mw.clone().addScaledVector(dir, -0.7);
    for (const f of this.foes) {
      if (!f.alive) continue;
      const head = f.e.headWorld().add(new THREE.Vector3(0, 0.07, 0)), chest = f.e.chestWorld(), hips = f.e.hipsWorld(), feet = f.e.root.position.clone();
      // 判定从枪口往后退 0.7m 的地方算起：贴身时敌人可能站在镜头和枪口之间，也要算打中
      const cands = [['head', ...raySegDist(mo, dir, head, head), 0.15], ['body', ...raySegDist(mo, dir, chest, hips), 0.23], ['legs', ...raySegDist(mo, dir, hips, feet), 0.17]];
      for (const [part, dist, t0, r] of cands) { const t = t0 - 0.7; if (dist < r && (!wall || t < wall.distance) && (!best || t < best.t)) best = { f, part, t }; }
    }
    if (best) { this.stats.hits++; best.f.hit(best.part, mw.clone().addScaledVector(dir, best.t), dir, W.dmg); this.audio.play('thud', { gain: 0.25, wet: 0.4, delay: Math.max(0, best.t) / 343 }); }
    else if (this._waterShot(mw, dir, wall ? wall.distance : 60)) { /* 打进水里：溅水花，不留弹孔 */ }
    else if (wall) {
      const n = wall.face.normal.clone(); if (n.dot(dir) > 0) n.negate();
      this.fx.impact(wall.point, n, n.y > 0.7 ? 'floor' : 'wall', wall.distance < 1.6 ? 1.3 : 1);
      this.audio.rnd('impact', 4, { gain: Math.min(1.5, 1.5 / Math.max(wall.distance, 1)), wet: 0.5, delay: wall.distance / 343 });
    } else if (dir.y < -0.02) {
      const t = (GROUND_Z - mw.y) / dir.y; if (t > 0 && t < 40) this.fx.impact(mw.clone().addScaledVector(dir, t), new THREE.Vector3(0, 1, 0), 'ground');
    }
    // 没打中的子弹从敌人身边擦过、或者打在他身边的墙上：他会缩一下、躲开
    for (const f of this.foes) {
      if (!f.alive || (best && best.f === f)) continue;
      const chest = f.e.chestWorld(), [dist, t] = raySegDist(mw, dir, chest, f.e.hipsWorld()); let away = null;
      if (dist < 0.85 && t > 0.5 && t < (wall ? wall.distance : 80) + 0.3) away = chest.clone().sub(mw.clone().addScaledVector(dir, t));
      else if (wall && wall.point.distanceTo(chest) < 1.3) away = chest.clone().sub(wall.point);
      if (away) f.suppress(away.x, -away.z);
    }
    // 枪声会把附近的敌人引过来
    for (const f of this.foes) if (f.alive && Math.hypot(f.x - p.pos.x, f.y - p.pos.y) < 25) { if (!f.sees) { f.lastKnown = [p.pos.x, p.pos.y, p.layer]; f.lkz = p.z + 1.25; } }
    const show = Math.random() < (W.auto ? 0.6 : 0.7);
    const vp = mw.clone().applyMatrix4(this.camera.matrixWorldInverse).normalize(), th = Math.acos(Math.max(-1, Math.min(1, -vp.z)));
    const row = 0.5 - (2 * L.uLens.value.x * Math.sin(th * 0.5) * vp.y / Math.max(Math.hypot(vp.x, vp.y), 1e-5)) / (2 * L.uLens.value.z);      // 枪口在成片画面里的行（和着色器里的 outRow 一致）
    this.fx.playerFlash(mw, fwd, (show ? 325 : 165) * this.M.flashK * (W.auto ? 1.5 : 1), show, 0.030, row, W.flash);      // 影片 260/130W，同样按实测补上反弹光
    this.fx.gunSmoke(mw, fwd);
    const R = new THREE.Matrix3().setFromMatrix4(this.vm.group.matrixWorld);
    this.fx.ejectShell(this.vm.worldPoint(this.vm.eject), new THREE.Vector3(rand(1.9, 2.7), rand(1.2, 1.9), rand(0.3, 0.9)).multiplyScalar(W.shellV).applyMatrix3(R), p.z, W.shellS);
    p.fireKick(1 - 0.25 * p.ads);
    this.audio.rnd(W.sound, 4, { gain: W.gain, wet: 0.9 }); this.audio.holdBreath(1.2);
  }
  // 子弹在打到墙之前先穿过了水面：溅起水花、荡开一圈涟漪
  _waterShot(o, dir, maxT) {
    const pool = this.world.pool, pt = pool ? pool.waterHit(o, dir, maxT) : null; if (!pt) return false;
    const dc = pt.distanceTo(this.camera.position);
    this.fx.splash(pt); pool.ripple(pt.x, -pt.z, 2.0);
    this.audio.rnd('splash', 3, { gain: Math.min(0.45, 1.2 / Math.max(dc, 1)), wet: 0.6, rate: 1.45, delay: dc / 343 });
    return true;
  }
  reload() {
    if (this.player.dead || !this.running || this.ammo >= this.magSize || this.vm.lh > 0.05) return;
    const name = this.vm.startReload(); if (!name) return;
    this.ammoShowT = this.time + 2;
    for (const [snd, at] of this.vm.def.cues[name]) this.audio.play(snd, { gain: snd === 'slide' ? 0.12 : 0.1, wet: 0.15, delay: at });
  }
  // 换枪：1 手枪，2 步枪（或者滚轮 / X 在两把之间切）。换弹中途换枪，换弹作废
  switchWeapon(i) {
    if (this.player.dead || !this.running) return;
    if (i == null) i = (this.vm.next >= 0 ? this.vm.next : this.vm.idx) === 0 ? 1 : 0;
    if (this.vm.switchTo(i)) { this.trigger = false; this.ammoShowT = this.time + 1.2; this.audio.play('rustle', { gain: 0.05, wet: 0.1, rate: 1.5 }); this.audio.play('slide', { gain: 0.05, wet: 0.1, rate: 0.7, delay: 0.3 }); }
  }
  toggleLight() { this.lightOn = !this.lightOn; L.uWLOn.value = this.lightOn ? 1 : 0; this.audio.play('dry', { gain: 0.05, wet: 0.05, rate: 1.6 }); }

  // ---------------------------------------------------------------- 闪光弹
  throwBang() {
    const p = this.player; this.bangShowT = this.time;
    if (p.dead || !this.running || this.bangs <= 0 || this.time - (this.lastBang ?? -9) < 0.9 || this.vm.reloading || this.vm.switching) return;
    this.bangs--; this.lastBang = this.time; this.bangAt = this.time + 0.37; this.trigger = false;
    this.vm.throwLeft();                 // 左手离枪去扔，0.37 秒后出手
    const m = this.held = new THREE.Mesh(this.nadeGeo, this.nadeMat); m.layers.set(1); m.frustumCulled = false; m.visible = false; this.world.scene.add(m);
    if (this.probeTex) this.nadeMat.envMap = this.probeTex;
    this.audio.play('slide', { gain: 0.06, wet: 0.1, rate: 1.9 });
  }
  _releaseBang() {
    const p = this.player, cam = this.camera, f = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    let o = this.vm.palmWorld().addScaledVector(f, 0.05);
    const h = this.world.raycast(cam.position, o.clone().sub(cam.position).normalize(), o.distanceTo(cam.position) + 0.08); if (h) o = cam.position.clone().addScaledVector(f, 0.05);
    const v = f.clone().multiplyScalar(11.5); v.y += 2.4; v.x += p.vel.x * 0.6; v.z += -p.vel.y * 0.6;
    const m = this.held; this.held = null; m.visible = true; m.position.copy(o);
    this.nades.push({ m, p: o, v, t: 0, w: new THREE.Vector3(rand(-14, 14), rand(-14, 14), rand(-14, 14)) });
  }
  _nades(dt) {
    const up = new THREE.Vector3(0, 1, 0);
    if (this.held) { this.held.visible = this.time > this.lastBang + 0.17; this.vm.palmWorld(this.held.position); this.held.rotation.set(0.4, 0, 1.2); }      // 出手前弹体握在左手里
    if (this.bangAt >= 0 && this.time >= this.bangAt) { this.bangAt = -1; if (!this.player.dead) this._releaseBang(); else { this.world.scene.remove(this.held); this.held = null; } }
    for (const n of this.nades) {
      n.t += dt;
      for (let i = 0; i < 2; i++) {
        const h = dt / 2; n.v.y -= 9.8 * h; const len = n.v.length() * h; if (len < 1e-5) continue;
        const d = n.v.clone().normalize(), hit = this.world.raycast(n.p, d, len + 0.03);
        let nrm = null, pt = null;
        if (hit) { nrm = hit.face.normal.clone(); if (nrm.dot(d) > 0) nrm.negate(); pt = hit.point.clone().addScaledVector(nrm, 0.03); }
        else if (n.p.y + d.y * len < GROUND_Z + 0.03 && n.v.y < 0 && !inFoot(n.p.x, -n.p.z)) { nrm = up.clone(); pt = n.p.clone().addScaledVector(d, len); pt.y = GROUND_Z + 0.03; }
        if (nrm) {
          const vn = n.v.dot(nrm), sp = n.v.length();
          n.v.addScaledVector(nrm, -(1 + 0.36) * vn); const tn = n.v.clone().addScaledVector(nrm, -n.v.dot(nrm)); n.v.addScaledVector(tn, -0.3);
          n.p.copy(pt); n.w.multiplyScalar(0.6);
          if (sp > 1.3) { const dc = pt.distanceTo(this.camera.position); this.audio.rnd('casing', 4, { gain: Math.min(0.5, 1.2 / Math.max(dc, 1)), wet: 0.5, rate: 0.42, delay: dc / 343 }); }
        } else n.p.addScaledVector(d, len);
      }
      n.m.position.copy(n.p); n.m.rotation.x += n.w.x * dt; n.m.rotation.y += n.w.y * dt; n.m.rotation.z += n.w.z * dt;
      if (n.t >= 1.5) { this._detonate(n.p.clone()); this.world.scene.remove(n.m); n.done = true; }
    }
    this.nades = this.nades.filter((n) => !n.done);
    if (this.bangT > 0) { this.bangT -= dt; L.uBang.value.w = this.bangT > 0 ? this.bangE * Math.pow(this.bangT / 0.13, 1.5) : 0; }
  }
  _detonate(pos) {
    const p = this.player, cam = this.camera.position;
    L.uBang.value.set(pos.x, pos.y + 0.12, pos.z, 0); this.bangE = 9.0e4 * (0.5 + 0.5 * this.M.flashK); this.bangT = 0.13; L.uBang.value.w = this.bangE;
    this.fx.burst(pos.clone().add(new THREE.Vector3(0, 0.1, 0)), new THREE.Vector3(0, 1, 0), { n: 16, speed: 3.2, spread: 1.0, size0: 0.25, size1: 1.5, life: 150, color: [0.9, 0.9, 0.88], alpha: 0.2, rise: 0.1, wl: 1 });
    const los = (a, b) => { const d = b.clone().sub(a), len = d.length(); d.multiplyScalar(1 / len); const h = this.world.raycast(a, d, len); return !h || h.distance > len - 0.08; };
    const src = pos.clone(); src.y += 0.15;
    const d = src.distanceTo(cam), see = los(src, cam), cf = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion), facing = cf.dot(src.clone().sub(cam).normalize());
    let k = see ? clamp(1.2 - d / 11, 0, 1) * (facing > -0.15 ? 1 : 0.5) : clamp(0.32 - d / 22, 0, 0.3);
    if (this.god && QS.auto != null) k *= 1;
    p.blind = Math.max(p.blind, 3.3 * k); if (k > 0.2) p.flinch(1.4 * k);
    this.audio.bang(d, see, k);
    let n = 0;
    for (const f of this.foes) {
      if (!f.alive) continue; const hd = f.e.headWorld(), df = src.distanceTo(hd);
      if (df < 9.5 && los(src, hd)) { f.flash(1.8 + 2.8 * (1 - df / 9.5)); n++; }
    }
    this.log.push(`${this.time.toFixed(2)} bang blind=${k.toFixed(2)} stunned=${n}`); this.stats.bangHits = (this.stats.bangHits || 0) + n;
  }

  update(dt) {
    if (!this.running) return;
    this.time += dt; const p = this.player;
    if (!p.dead) this.stats.t += dt;
    // 敌人波次
    const alive = this.foes.filter((f) => f.alive);
    if (!p.dead) {
      if (this.toSpawn > 0) {
        this.spawnT -= dt;
        if (this.spawnT <= 0) {
          if (alive.filter((f) => f.mode !== 'hold').length < this.maxAlive && this._spawn()) { this.toSpawn--; this.spawnT = rand(5.0, 10.0); }      // 人少了，前一个倒下之后隔一阵下一个才摸过来
          else this.spawnT = 0.6;
        }
      } else if (alive.length === 0 && !this.cutT && !QS.nofoe) { this.waveGap += dt; if (this.waveGap > 8) { this.cutT = 0.3; this.audio.cut(0.3); } }     // 这一段打完：画面"剪一刀"（像剪辑过的记录仪视频）
    }
    if (this.cutT > 0) {
      this.cutT -= dt;
      if (this.cutT <= 0) {
        this.cutT = 0; for (const f of this.foes) f.dispose(); this.foes = []; this.slotUsers = {}; this.tokens = 2;
        this.clockJump += rand(140, 520); this.waveGap = 0; this._startWave(); this.spawnT = rand(3.5, 7.0);
      }
    }
    const inCombat = alive.some((f) => f.sees || f.mode === 'engage' || (f.mode === 'slot' && f.sub !== 'hide')) || this.time - this.lastFire < 2.5;
    p.update(dt, inCombat);
    this.vm.group.visible = !(p.dead && p.deadT > 0.5);
    if (this.trigger && this.vm.def.auto && !p.dead) this.fire();        // 步枪按住连发
    this.vm.update(dt);
    const gun = this.vm.gun; if (gun.done) { gun.ammo = gun.def.mag; gun.done = null; }      // 换弹动作做完的那一帧弹匣才算换好
    for (const f of this.foes) f.update(dt);
    this._nades(dt);
    // 倒下太多就清掉最早的
    const dead = this.foes.filter((f) => !f.alive);
    while (dead.length > 6) { const b = dead.shift(); this.foes = this.foes.filter((f) => f !== b); b.dispose(); }
    // 脚下的接触阴影（离镜头最近的 6 个）
    const cam = this.camera.position;
    const near = this.foes.map((f) => ({ f, d: f.e.root.position.distanceToSquared(cam) })).sort((a, b) => a.d - b.d).slice(0, 6);
    let k = 0;
    for (const { f } of near) { const h = f.e.hipsWorld(); L.uBlob.value[k++].set(h.x, f.e.root.position.y, h.z, f.alive ? 0.6 : 0.85); }
    for (; k < 6; k++) L.uBlob.value[k].set(0, -99, 0, 0.001);
    this.fx.update(dt, this.camera);
  }
}
