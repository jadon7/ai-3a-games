// 飞行员控制器：冲刺 / 滑铲 / 二段跳 / 蹬墙跑 / 攀爬 / 钩爪 / 滑索
import * as THREE from 'three';

const R = 0.38, H_STAND = 1.8, H_CROUCH = 1.05, EYE_STAND = 1.64, EYE_CROUCH = 0.9;
const GRAV = 21, JUMP_V = 7.0, DJUMP_V = 7.6;
const WALK = 5.2, SPRINT = 8.6, CROUCH_SPD = 2.9, ADS_SPD = 3.8;
const UP = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const _p0 = new THREE.Vector3(), _p1 = new THREE.Vector3(), _before = new THREE.Vector3();
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

export class Pilot {
  // opts.npc：AI 铁驭用的本体 —— 不碰相机、只放定位音、死亡回调交给持有者；opts.input：输入源（缺省为真实键鼠）
  constructor(game, opts = {}) {
    this.game = game; this.world = game.world; this.npc = !!opts.npc; this.input = opts.input || game.input; this.cam = this.npc ? null : game.engine.camera;
    this.owner = null; this.audible = true; this.lastHurtT = -99;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0;
    this.height = H_STAND; this.eye = EYE_STAND; this.radius = R;
    this.onGround = false; this.airTime = 0; this.jumpsLeft = 1; this.jumpBuffer = 0; this.groundNormal = new THREE.Vector3(0, 1, 0);
    this.crouching = false; this.sliding = false; this.slideBoostCD = 0; this.groundSurf = 'sand';
    this.wr = { on: false, time: 0, normal: new THREE.Vector3(), tangent: new THREE.Vector3(), sign: 1, cd: 0, lastNormal: new THREE.Vector3(), coyote: 0, chain: 0 };
    this.mantle = { on: false, t: 0, dur: 0.3, from: new THREE.Vector3(), to: new THREE.Vector3() };
    this.grapple = { state: 0, point: new THREE.Vector3(), hook: new THREE.Vector3(), t: 0, charges: 2, max: 2 };
    this.zip = { on: false, a: new THREE.Vector3(), b: new THREE.Vector3(), t: 0, dir: 1, len: 1, near: null };
    this.hp = 100; this.maxHp = 100; this.regenDelay = 0; this.alive = true; this.invuln = 0; this.deadT = 0;
    this.team = opts.team || 0; this.isPlayer = !this.npc; this.kind = 'pilot';
    this.inMech = false;
    this.roll = 0; this.bobT = 0; this.landDip = 0; this.recoilPitch = 0; this.recoilYaw = 0; this.shake = 0;
    this.speedH = 0; this.stepDist = 0; this.sprinting = false;
    this.sens = 0.0021; this.baseFov = 74; this.adsT = 0; this.adsZoom = 1.25; this.autoSprint = true;
    this.fwd = new THREE.Vector3(); this.right = new THREE.Vector3(); this.look = new THREE.Vector3();
    this.eyePos = new THREE.Vector3();
    this.stats = { wallrunTime: 0, maxSpeed: 0, slides: 0, grapples: 0, djumps: 0, walljumps: 0, wallruns: 0, mantles: 0 };
    this.lastDamageFrom = null;
  }

  spawn(s) {
    this.pos.set(s.x, s.y, s.z); this.vel.set(0, 0, 0); this.yaw = s.yaw || 0; this.pitch = 0;
    this.hp = this.maxHp; this.alive = true; this.invuln = 2.5; this.deadT = 0;
    this.crouching = false; this.sliding = false; this.wr.on = false; this.mantle.on = false; this.grapple.state = 0; this.zip.on = false;
    this.height = H_STAND; this.onGround = false; this.inMech = false;
  }

  // 音效：玩家直接播放；NPC 铁驭只在镜头附近放定位音，循环音省略
  snd(name, o) { if (!this.npc) this.game.audio.play(name, o); else if (this.audible) this.game.audio.play(name, { x: this.pos.x, y: this.pos.y + 1, z: this.pos.z, ...(o || {}), volume: ((o && o.volume) || 1) * 0.7 }); }
  sndLoop(name, on, o) { if (!this.npc) this.game.audio.loop(name, on, o); }

  aimPoint(out) { return out.set(this.pos.x, this.pos.y + this.height * 0.62, this.pos.z); }
  // 射线命中测试（供敌人射击）：返回距离或 -1
  hitTest(o, d, maxDist) {
    if (!this.alive || this.inMech) return -1;
    return rayCapsule(o, d, this.pos.x, this.pos.y + R, this.pos.z, this.height - 2 * R, R + 0.05, maxDist);
  }

  takeDamage(amount, from, info) {
    if (!this.alive || this.invuln > 0 || this.inMech) return;
    this.hp -= amount; this.regenDelay = 4.2; this.lastDamageFrom = from; this.lastHurtT = this.game.time;
    if (this.npc) {   // AI 铁驭：受伤 / 阵亡交给持有者（AIPilot）处理
      if (this.hp > 0) return false;
      this.hp = 0; this.alive = false; this.deadT = 0; this.grapple.state = 0; this.zip.on = false; this.wr.on = false; return true;
    }
    this.shake = Math.min(1, this.shake + amount * 0.012);
    this.game.onPlayerHurt(amount, from, info);
    if (this.hp <= 0) { this.hp = 0; this.alive = false; this.deadT = 0; this.grapple.state = 0; this.zip.on = false; this.wr.on = false; this.game.onPlayerDeath(from); }
  }

  update(dt) {
    const inp = this.input;
    // 视角
    const zoomSens = 1 / (1 + (this.adsZoom - 1) * this.adsT);
    this.yaw -= inp.dx * this.sens * zoomSens; this.pitch -= inp.dy * this.sens * zoomSens;
    this.pitch = Math.max(-1.52, Math.min(1.52, this.pitch));
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw), cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    this.fwd.set(-sy, 0, -cy); this.right.set(cy, 0, -sy); this.look.set(-sy * cp, sp, -cy * cp);

    if (!this.alive) { this.deadT += dt; this.vel.y -= GRAV * dt; this.vel.x *= 0.96; this.vel.z *= 0.96; this.integrate(dt, false); this.updateCamera(dt); return; }
    if (this.inMech) return;

    this.slideBoostCD = Math.max(0, this.slideBoostCD - dt); this.wr.cd = Math.max(0, this.wr.cd - dt); this.wr.coyote = Math.max(0, this.wr.coyote - dt);
    this.invuln = Math.max(0, this.invuln - dt); this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    if (this.regenDelay > 0) this.regenDelay -= dt; else if (this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + 26 * dt);
    const g = this.grapple; if (g.charges < g.max) g.charges = Math.min(g.max, g.charges + dt / 6.5);
    if (inp.hit('Space')) this.jumpBuffer = 0.14;

    if (this.mantle.on) this.updateMantle(dt);
    else if (this.zip.on) this.updateZip(dt);
    else this.move(dt);
    this.updateGrapple(dt);
    this.checkZipline();
    if (this.pos.y < -40) this.takeDamage(999, null, {});
    this.updateCamera(dt);
  }

  move(dt) {
    const inp = this.input, v = this.vel;
    const ax = inp.axis;   // 虚拟输入给的是模拟量移动轴（AI 大脑）；真实键鼠走 WASD
    const f = ax ? ax.f : (inp.down('KeyW') ? 1 : 0) - (inp.down('KeyS') ? 1 : 0), s = ax ? ax.s : (inp.down('KeyD') ? 1 : 0) - (inp.down('KeyA') ? 1 : 0);
    const wish = _a.set(this.fwd.x * f + this.right.x * s, 0, this.fwd.z * f + this.right.z * s);
    const wl = wish.length(); if (wl > 0) wish.multiplyScalar(1 / wl);
    const crouchDown = inp.anyDown('ControlLeft', 'KeyC') || (this.autoSprint && inp.down('ShiftLeft'));
    let speedH = Math.hypot(v.x, v.z);
    let jumped = false;

    // 下蹲 / 滑铲状态
    if (crouchDown && !this.crouching) {
      this.crouching = true;
      if (this.onGround && speedH > 6.0) this.startSlide(speedH);
    } else if (!crouchDown && this.crouching) {
      _b.set(this.pos.x, this.pos.y + H_STAND - R, this.pos.z);
      if (!this.world.sphereHits(_b, R * 0.9)) { this.crouching = false; this.sliding = false; }
    }
    this.height = this.crouching ? H_CROUCH : H_STAND;
    const ads = this.adsT > 0.5;
    this.sprinting = f > 0 && Math.abs(s) <= f && !ads && !this.crouching && (this.autoSprint || inp.down('ShiftLeft'));
    const maxSpeed = this.crouching ? CROUCH_SPD : ads ? ADS_SPD : this.sprinting ? SPRINT : WALK;

    if (this.onGround) {
      this.airTime = 0; this.jumpsLeft = 1; this.wr.chain = 0;
      if (v.y < 0) v.y = 0;
      if (this.slopeVy > 0 && Math.abs(v.y - this.slopeVy) < 1e-4) v.y = 0;   // 上一帧顺坡设的竖直速度（不是爆炸、钩爪这些外力给的）：先清掉，下面按新的坡面重算
      if (this.sliding) {
        const dec = 2.4; const ns = Math.max(0, speedH - dec * dt);
        if (speedH > 1e-3) { v.x *= ns / speedH; v.z *= ns / speedH; }
        // 顺坡加速
        const gn = this.groundNormal; v.x += gn.x * GRAV * 0.9 * dt; v.z += gn.z * GRAV * 0.9 * dt;
        if (wl > 0) { const steer = 1.2 * dt; v.x += wish.x * steer; v.z += wish.z * steer; }
        if (ns < 3.4) this.sliding = false;
      } else {
        if (speedH > 1e-3) { const drop = Math.max(speedH, 2.2) * 8.5 * dt; const ns = Math.max(0, speedH - drop); v.x *= ns / speedH; v.z *= ns / speedH; }
        accelerate(v, wish, wl > 0 ? maxSpeed : 0, 9.5, dt);
      }
      // 在坡面 / 楼梯上：速度顺着坡面走（上坡不被碰撞吃掉水平速度，下坡贴着坡面不腾空）。钩爪拉着的时候不管
      this.slopeVy = 0;
      { const gn = this.groundNormal; if (gn.y > 0.64 && gn.y < 0.999 && this.grapple.state !== 2) { const sv = -(gn.x * v.x + gn.z * v.z) / gn.y; if (v.y <= 1e-3 || sv > v.y) { v.y = sv; this.slopeVy = sv; } } }
      if (this.jumpBuffer > 0) {
        v.y = JUMP_V; this.onGround = false; jumped = true; this.jumpBuffer = 0;
        if (this.sliding) { this.sliding = false; const sp2 = Math.hypot(v.x, v.z); if (sp2 > 0.1 && sp2 < 13) { v.x *= 1.04; v.z *= 1.04; } }
        this.snd('jump');
      }
    } else {
      this.airTime += dt; this.slopeVy = 0;
      if (this.wr.on) jumped = this.updateWallrun(dt, f) || jumped;
      else {
        const gs = this.grapple.state === 2 ? 0.3 : 1;
        v.y -= GRAV * gs * dt;
        if (wl > 0) { const cur = v.x * wish.x + v.z * wish.z; const add = 2.4 - cur; if (add > 0) { const a = Math.min(46 * dt, add); v.x += wish.x * a; v.z += wish.z * a; } }
        if (this.jumpBuffer > 0) {
          if (this.wr.coyote > 0) { this.wallJump(); jumped = true; }
          else if (this.jumpsLeft > 0) { this.doubleJump(wish, wl, speedH); jumped = true; }
        }
        if (!jumped) { if (!crouchDown) this.tryWallrun(speedH); if (!this.wr.on && f > 0) this.tryMantle(); }
      }
    }
    this.integrate(dt, jumped);
    speedH = Math.hypot(v.x, v.z); this.speedH = speedH;
    if (speedH > this.stats.maxSpeed) this.stats.maxSpeed = speedH;
    // 脚步声
    if (this.onGround && !this.sliding && speedH > 1.5) {
      this.stepDist += speedH * dt;
      if (this.stepDist > (this.sprinting ? 2.5 : 1.9)) { this.stepDist = 0; this.snd('step_' + (this.groundSurf === 'cloth' || this.groundSurf === 'glass' ? 'stone' : this.groundSurf), { volume: this.crouching ? 0.25 : 0.55 }); }
    }
    this.sndLoop('slide', this.sliding && this.onGround, { volume: Math.min(1, speedH / 10), pitch: 0.7 + speedH / 20 });
    this.sndLoop('wallrun', this.wr.on, { volume: 0.7 });
    this.sndLoop('speed_wind', speedH > 9 || Math.abs(v.y) > 12, { volume: Math.min(1, (Math.hypot(speedH, v.y) - 9) / 12) });
  }

  startSlide(speedH) {
    this.sliding = true; this.stats.slides++;
    if (this.slideBoostCD <= 0 && speedH > 0.1) { const b = Math.min(3.4, Math.max(0, 13.5 - speedH)); this.vel.x += this.vel.x / speedH * b; this.vel.z += this.vel.z / speedH * b; this.slideBoostCD = 2.0; }
    this.snd('slide_start');
    this.game.fx.dustPuff(this.pos, 5, 0.5);
  }

  doubleJump(wish, wl, speedH) {
    const v = this.vel;
    v.y = Math.max(v.y * 0.3, 0) + DJUMP_V;
    if (wl > 0) {
      v.x = v.x * 0.72 + wish.x * Math.max(3.0, speedH * 0.42); v.z = v.z * 0.72 + wish.z * Math.max(3.0, speedH * 0.42);
      const ns = Math.hypot(v.x, v.z), cap = Math.max(speedH, 7.6); if (ns > cap) { v.x *= cap / ns; v.z *= cap / ns; }
    }
    this.jumpsLeft = 0; this.jumpBuffer = 0; this.stats.djumps++;
    this.snd('double_jump'); this.game.fx.jetPuff(this.pos);
  }

  tryWallrun(speedH) {
    const v = this.vel; const wr = this.wr;
    if (speedH < 3.2 || this.airTime < 0.05 || v.y < -15) return;
    const dirX = v.x / speedH, dirZ = v.z / speedH;
    const rx = -dirZ, rz = dirX;
    const o = _b.set(this.pos.x, this.pos.y + 1.0, this.pos.z);
    let best = null, bestD = 1e9; const reach = R + 0.44;
    for (let i = 0; i < 4; i++) {
      const sgn = i & 1 ? -1 : 1, diag = i >= 2 ? 0.75 : 0;
      _c.set(rx * sgn + dirX * diag, 0, rz * sgn + dirZ * diag).normalize();
      const h = this.world.raycast(o, _c, reach);
      if (h && Math.abs(h.normal.y) < 0.2 && h.distance < bestD) { bestD = h.distance; best = _d.copy(h.normal); }
    }
    if (!best) return;
    if (wr.cd > 0 && best.dot(wr.lastNormal) > 0.7) return;
    if (v.x * best.x + v.z * best.z > 1.6) return;
    // 墙要够高、脚下要悬空
    _c.copy(best).negate(); _b.y = this.pos.y + 1.7; if (!this.world.raycast(_b, _c, reach + 0.3)) return;
    _b.set(this.pos.x, this.pos.y + 0.3, this.pos.z); if (this.world.raycast(_b, DOWN, 0.95)) return;
    _a.crossVectors(UP, best).normalize();
    let along = v.x * _a.x + v.z * _a.z;
    if (Math.abs(along) < speedH * 0.25) along = (this.fwd.x * _a.x + this.fwd.z * _a.z) >= 0 ? speedH * 0.8 : -speedH * 0.8;
    const sgn = along >= 0 ? 1 : -1;
    // 墙面要沿前进方向延伸出去（身前 0.9 m 处还是同一面墙）：柱子、灯杆、箱角、门扇边这些窄东西不触发蹬墙
    _b.set(this.pos.x + _a.x * sgn * 0.9, this.pos.y + 1.0, this.pos.z + _a.z * sgn * 0.9); { const h2 = this.world.raycast(_b, _c, reach + 0.45); if (!h2 || h2.normal.dot(best) < 0.7) return; }
    wr.on = true; wr.time = 0; wr.normal.copy(best); this.stats.wallruns++;
    wr.tangent.copy(_a);
    wr.sign = sgn; if (wr.sign < 0) wr.tangent.negate();
    const sp = Math.max(Math.abs(along), 7.8) + 0.4;
    v.x = wr.tangent.x * sp; v.z = wr.tangent.z * sp; v.y = Math.max(v.y, -1) * 0.5 + 2.4;
    this.jumpsLeft = 1; this.sliding = false;
    this.snd('wallrun_start');
  }

  updateWallrun(dt, f) {
    const wr = this.wr, v = this.vel;
    wr.time += dt; this.stats.wallrunTime += dt;
    // 重新探测墙面
    const o = _b.set(this.pos.x, this.pos.y + 1.0, this.pos.z); _c.copy(wr.normal).negate();
    const h = this.world.raycast(o, _c, R + 0.7);
    if (!h || Math.abs(h.normal.y) > 0.25 || h.normal.dot(wr.normal) < 0.6) { this.endWallrun(0.22); return false; }
    wr.normal.copy(h.normal); wr.tangent.crossVectors(UP, wr.normal).normalize().multiplyScalar(wr.sign);
    let along = v.x * wr.tangent.x + v.z * wr.tangent.z;
    const target = f >= 0 ? Math.max(9.8, along - 0.6 * dt) : 3.5;
    along += Math.sign(target - along) * Math.min(Math.abs(target - along), (f >= 0 ? 11 : 16) * dt);
    v.x = wr.tangent.x * along - wr.normal.x * 1.4; v.z = wr.tangent.z * along - wr.normal.z * 1.4;
    const gs = wr.time < 1.0 ? 0.10 : Math.min(1, 0.10 + (wr.time - 1.0) * 0.85);
    v.y -= GRAV * gs * dt; if (wr.time < 1.0) v.y = Math.max(-3, Math.min(v.y, 3.6));
    if (this.jumpBuffer > 0) { this.wallJump(); return true; }
    if (this.input.anyHit('ControlLeft', 'KeyC') || (this.autoSprint && this.input.hit('ShiftLeft')) || wr.time > 2.2 || along < 2.2) { v.x += wr.normal.x * 2; v.z += wr.normal.z * 2; this.endWallrun(0); }
    return false;
  }

  endWallrun(coyote) { const wr = this.wr; wr.on = false; wr.coyote = coyote; wr.cd = 0.4; wr.lastNormal.copy(wr.normal); }

  wallJump() {
    const wr = this.wr, v = this.vel;
    const along = Math.max(6, v.x * wr.tangent.x + v.z * wr.tangent.z) + Math.max(0, 0.9 - wr.chain * 0.2);
    v.x = wr.tangent.x * along + wr.normal.x * 6.0 + this.fwd.x * 1.2; v.z = wr.tangent.z * along + wr.normal.z * 6.0 + this.fwd.z * 1.2;
    v.y = JUMP_V + 0.6;
    wr.chain++; this.jumpsLeft = 1; this.jumpBuffer = 0; this.stats.walljumps++;
    if (wr.on) this.endWallrun(0); wr.coyote = 0; wr.cd = 0.45;
    this.snd('jump', { pitch: 1.15 });
  }

  tryMantle() {
    if (this.vel.y > 6 || this.grapple.state === 2) return;
    const o = _b.set(this.pos.x, this.pos.y + 1.25, this.pos.z);
    const h = this.world.raycast(o, this.fwd, R + 0.5);
    if (!h || Math.abs(h.normal.y) > 0.3) return;
    const tx = h.point.x - h.normal.x * 0.42, tz = h.point.z - h.normal.z * 0.42;
    _c.set(tx, this.pos.y + 2.55, tz);
    const top = this.world.raycast(_c, DOWN, 2.1);
    if (!top || top.normal.y < 0.7) return;
    const ly = top.point.y; const dh = ly - this.pos.y;
    if (dh < 0.55 || dh > 2.5) return;
    _c.set(tx, ly + 0.55, tz); if (this.world.sphereHits(_c, 0.36)) return;
    _c.set(tx, ly + 1.1, tz); if (this.world.sphereHits(_c, 0.36)) return;
    // 落点必须从身前直接够得着：在落点上方 0.9 m 的高度，从自己这边朝落点打一条射线，中间有面挡着就说明落点在实心体里面
    // （例如卡车的车斗底板压在货箱下面，从上往下探会探到它）
    _c.set(this.pos.x, ly + 0.9, this.pos.z); _d.set(tx - this.pos.x, 0, tz - this.pos.z);
    { const dl = _d.length(); if (dl > 1e-3) { _d.multiplyScalar(1 / dl); if (this.world.raycast(_c, _d, dl + 0.2)) return; } }
    const m = this.mantle; m.on = true; m.t = 0; m.dur = 0.2 + 0.11 * dh; m.from.copy(this.pos); m.to.set(tx, ly + 0.03, tz);
    this.vel.set(0, 0, 0); this.wr.on = false; this.sliding = false; this.stats.mantles++;
    this.snd('mantle');
  }

  updateMantle(dt) {
    const m = this.mantle; m.t += dt / m.dur;
    const e = Math.min(1, m.t); const s = e * e * (3 - 2 * e);
    const ky = Math.min(1, s * 1.4), kx = Math.max(0, (s - 0.3) / 0.7);
    this.pos.set(m.from.x + (m.to.x - m.from.x) * kx, m.from.y + (m.to.y - m.from.y) * ky, m.from.z + (m.to.z - m.from.z) * kx);
    if (m.t >= 1) {
      m.on = false; this.onGround = true; this.airTime = 0; this.jumpsLeft = 1; this.landDip = 0.08;
      const k = this.input.down('KeyW') ? 5 : 1.5; this.vel.set(this.fwd.x * k, 0, this.fwd.z * k);
    }
  }

  // ---------- 钩爪 ----------
  updateGrapple(dt) {
    const g = this.grapple, inp = this.input;
    if (inp.hit('KeyQ') && !this.mantle.on) {
      if (g.state === 1 || g.state === 2) this.releaseGrapple(false);
      else if (g.charges >= 1) {
        this.getEye(_b);
        const h = this.world.raycast(_b, this.look, 34);
        g.t = 0; g.hook.copy(_b);
        if (h) { g.state = 1; g.point.copy(h.point); g.charges -= 1; this.stats.grapples++; }
        else { g.state = 3; g.point.copy(_b).addScaledVector(this.look, 20); }
        this.snd('grapple_fire');
      } else this.snd('dry_fire');
    }
    if (g.state === 0) { this.sndLoop('grapple_reel', false); return; }
    g.t += dt;
    if (g.state === 1 || g.state === 3) {
      const d = _c.subVectors(g.point, g.hook); const len = d.length(); const stepLen = 95 * dt;
      if (len <= stepLen) { g.hook.copy(g.point); if (g.state === 1) { g.state = 2; g.t = 0; this.snd('grapple_hit', { x: g.point.x, y: g.point.y, z: g.point.z }); this.game.fx.sparks(g.point, null, 6); } else g.state = 0; }
      else g.hook.addScaledVector(d, stepLen / len);
    } else if (g.state === 2) {
      if (this.zip.on) { this.releaseGrapple(false); return; }
      const chest = _b.set(this.pos.x, this.pos.y + 1.1, this.pos.z);
      const d = _c.subVectors(g.point, chest); const dist = d.length(); d.multiplyScalar(1 / Math.max(dist, 1e-3));
      const v = this.vel;
      v.addScaledVector(d, 64 * dt);
      const vn = v.dot(d);
      // 轻微阻尼垂直于绳的速度，让摆荡收敛
      const k = Math.exp(-0.9 * dt); v.x = d.x * vn + (v.x - d.x * vn) * k; v.y = d.y * vn + (v.y - d.y * vn) * k; v.z = d.z * vn + (v.z - d.z * vn) * k;
      if (vn > 27) v.addScaledVector(d, 27 - vn);
      if (this.onGround && d.y > 0.15) { this.onGround = false; v.y = Math.max(v.y, 2.5); }
      if (this.mantle.on) this.mantle.on = false;
      this.wr.on = false;
      this.sndLoop('grapple_reel', true, { pitch: 0.8 + Math.min(1, v.length() / 25) * 0.6, volume: 0.6 });
      if (dist < 2.3 || g.t > 3.6 || (vn < -3 && g.t > 0.35)) this.releaseGrapple(false);
      else if (this.jumpBuffer > 0) { this.releaseGrapple(true); }
    }
  }
  releaseGrapple(hop) {
    const g = this.grapple; if (g.state === 2) { if (hop) { this.vel.y = Math.max(this.vel.y, 0) + 5.2; this.jumpBuffer = 0; } this.jumpsLeft = 1; this.snd('grapple_release'); }
    g.state = 0;
  }

  // ---------- 滑索 ----------
  checkZipline() {
    const z = this.zip; z.near = null; if (z.on || this.mantle.on) return;
    const lines = this.game.level.ziplines; this.getEye(_b);
    for (const l of lines) {
      _c.set(l.b[0] - l.a[0], l.b[1] - l.a[1], l.b[2] - l.a[2]); const len = _c.length(); _c.multiplyScalar(1 / len);
      _d.set(_b.x - l.a[0], _b.y - l.a[1], _b.z - l.a[2]); const t = Math.max(0.5, Math.min(len - 0.5, _d.dot(_c)));
      const px = l.a[0] + _c.x * t, py = l.a[1] + _c.y * t, pz = l.a[2] + _c.z * t;
      const dist = Math.hypot(_b.x - px, _b.y - py, _b.z - pz);
      if (dist < 2.6) { z.near = l; if (this.input.hit('KeyE')) { z.on = true; z.a.set(l.a[0], l.a[1], l.a[2]); z.b.set(l.b[0], l.b[1], l.b[2]); z.len = len; z.t = t; z.dir = this.look.dot(_c) >= 0 ? 1 : -1; this.wr.on = false; this.sliding = false; this.crouching = false; this.snd('zipline'); } break; }
    }
  }
  updateZip(dt) {
    const z = this.zip; const dir = _c.subVectors(z.b, z.a).multiplyScalar(1 / z.len);
    const speed = 16; z.t += speed * z.dir * dt;
    this.vel.copy(dir).multiplyScalar(speed * z.dir);
    this.pos.set(z.a.x + dir.x * z.t, z.a.y + dir.y * z.t - 2.05, z.a.z + dir.z * z.t);
    this.onGround = false; this.airTime = 0.2; this.jumpsLeft = 1; this.speedH = Math.hypot(this.vel.x, this.vel.z);
    this.sndLoop('zipline_ride', true, { volume: 0.7 });
    const end = z.t <= 0.6 || z.t >= z.len - 0.6;
    if (this.jumpBuffer > 0 || end || this.input.hit('KeyE') && z.t > 1) { z.on = false; if (!end || this.jumpBuffer > 0) this.vel.y += 5.5; this.jumpBuffer = 0; this.sndLoop('zipline_ride', false); }
  }

  // ---------- 积分 + 碰撞 ----------
  integrate(dt, jumped) {
    const v = this.vel; const wasGround = this.onGround && !jumped;
    const dist = v.length() * dt; const steps = Math.min(10, Math.max(1, Math.ceil(dist / 0.15))); const sdt = dt / steps;
    let grounded = false; const preVy = v.y;
    for (let i = 0; i < steps; i++) {
      this.pos.addScaledVector(v, sdt);
      _p0.set(this.pos.x, this.pos.y + R, this.pos.z); _p1.set(this.pos.x, this.pos.y + this.height - R, this.pos.z);
      _before.copy(_p0);
      const res = this.world.collideCapsule(_p0, _p1, R, true);
      if (res.any) {
        _before.subVectors(_p0, _before); this.pos.add(_before);
        const dl = _before.length();
        if (dl > 1e-6) { _before.multiplyScalar(1 / dl); const vn = v.dot(_before); if (vn < 0) v.addScaledVector(_before, -vn); }
        if (res.ground) { grounded = true; this.groundNormal.copy(res.groundNormal); }
        if (res.ceil && v.y > 0) v.y = 0;
      }
    }
    let onG = false;
    // 走上坡道 / 楼梯：碰撞把速度投影到坡面会带出向上的分量，顺坡走时 move 里也会给正的竖直速度（slopeVy）。
    // 上一帧在地上、没起跳、这一帧脚下还碰着地面，就仍然算在地上，不当成腾空
    const upSlope = wasGround && this.slopeVy > 0;
    if (grounded && (v.y <= 0.6 || wasGround)) onG = true;
    if (!onG && wasGround && (v.y <= 0.6 || upSlope)) {
      _b.set(this.pos.x, this.pos.y + 0.5, this.pos.z);
      const h = this.world.raycast(_b, DOWN, 0.95);
      if (h && h.normal.y > 0.64) { this.pos.y = h.point.y; onG = true; this.groundNormal.copy(h.normal); this.groundSurf = h.surf; if (v.y < 0) v.y = 0; }
    }
    if (onG && !this.onGround && !jumped) this.land(-preVy);
    if (onG && grounded) { _b.set(this.pos.x, this.pos.y + 0.4, this.pos.z); const h = this.world.raycast(_b, DOWN, 0.8); if (h) this.groundSurf = h.surf; }
    this.onGround = onG;
  }

  land(impact) {
    if (this.airTime > 0.22 || impact > 5) {
      this.landDip = Math.min(0.3, impact * 0.018);
      this.snd('land', { volume: Math.min(1, 0.3 + impact * 0.05) });
      if (impact > 7) this.game.fx.dustPuff(this.pos, 6, 0.7);
    }
    this.wr.on = false; this.wr.cd = 0;
    const speedH = Math.hypot(this.vel.x, this.vel.z);
    if (this.crouching && speedH > 6.0) this.startSlide(speedH);
  }

  getEye(out) { return out.set(this.pos.x, this.pos.y + this.eye, this.pos.z); }

  updateCamera(dt) {
    const cam = this.cam; const speedH = this.speedH;
    const targetEye = !this.alive ? 0.35 : this.crouching ? EYE_CROUCH : EYE_STAND;
    this.eye = damp(this.eye, targetEye, this.alive ? 13 : 4, dt);
    if (this.npc) { this.eyePos.set(this.pos.x, this.pos.y + this.eye, this.pos.z); return; }
    let bobX = 0, bobY = 0;
    if (this.onGround && !this.sliding && speedH > 1) { this.bobT += dt * (4.5 + speedH * 0.95); const k = Math.min(1, speedH / 8) * (1 - this.adsT * 0.8); bobY = Math.sin(this.bobT * 2) * 0.026 * k; bobX = Math.cos(this.bobT) * 0.018 * k; }
    this.landDip = damp(this.landDip, 0, 9, dt);
    const s = this.input.axis ? this.input.axis.s : (this.input.down('KeyD') ? 1 : 0) - (this.input.down('KeyA') ? 1 : 0);
    let rollT = -s * 0.016;
    if (this.wr.on) { const side = Math.sign(this.wr.normal.x * this.right.x + this.wr.normal.z * this.right.z); rollT = -side * 0.21; }
    else if (this.sliding) rollT += 0.05;
    if (!this.alive) rollT = 0.9;
    this.roll = damp(this.roll, rollT, 10, dt);
    this.recoilPitch = damp(this.recoilPitch, 0, 7, dt); this.recoilYaw = damp(this.recoilYaw, 0, 7, dt);
    this.shake = damp(this.shake, 0, 5.5, dt);
    const sh = this.shake * this.shake;
    const t = this.game.time * 37;
    const shx = (Math.sin(t * 1.3) + Math.sin(t * 2.9 + 1.7)) * 0.5 * sh, shy = (Math.sin(t * 1.7 + 0.3) + Math.sin(t * 3.3 + 2.1)) * 0.5 * sh;
    cam.position.set(this.pos.x + this.right.x * bobX + shx * 0.05, this.pos.y + this.eye + bobY - this.landDip + shy * 0.05, this.pos.z + this.right.z * bobX);
    cam.rotation.set(this.pitch + this.recoilPitch + shy * 0.03, this.yaw + this.recoilYaw + shx * 0.03, this.roll + shx * 0.02);
    this.eyePos.copy(cam.position);
    // FOV：速度感
    const total = Math.hypot(speedH, this.vel.y * 0.5);
    let fovT = this.baseFov + Math.max(0, Math.min(1, (total - 6.5) / 9)) * 10 + (this.wr.on ? 3 : 0) + (this.grapple.state === 2 ? 4 : 0);
    fovT = fovT + (this.baseFov / this.adsZoom - fovT) * this.adsT;
    const nf = damp(cam.fov, fovT, 9, dt);
    if (Math.abs(nf - cam.fov) > 0.01) { cam.fov = nf; cam.updateProjectionMatrix(); }
  }
}

function accelerate(v, wish, wishSpeed, accel, dt) {
  const cur = v.x * wish.x + v.z * wish.z; const add = wishSpeed - cur; if (add <= 0) return;
  let a = accel * dt * Math.max(wishSpeed, 4); if (a > add) a = add;
  v.x += wish.x * a; v.z += wish.z * a;
}

// 射线 vs 竖直胶囊（底球心 (cx,cy,cz)，轴长 h，半径 r）。返回命中距离或 -1
export function rayCapsule(o, d, cx, cy, cz, h, r, maxDist) {
  // 先求射线与竖直线段的最近点
  const ox = o.x - cx, oy = o.y - cy, oz = o.z - cz;
  const dd = d.x * d.x + d.z * d.z;
  let best = -1;
  // 无限圆柱
  if (dd > 1e-8) {
    const b = ox * d.x + oz * d.z, c = ox * ox + oz * oz - r * r; const disc = b * b - dd * c;
    if (disc >= 0) { const t = (-b - Math.sqrt(disc)) / dd; if (t >= 0 && t <= maxDist) { const y = oy + d.y * t; if (y >= 0 && y <= h) best = t; } }
  }
  for (const sy of [0, h]) {
    const py = oy - sy; const b = ox * d.x + py * d.y + oz * d.z, c = ox * ox + py * py + oz * oz - r * r; const disc = b * b - c;
    if (disc >= 0) { const t = -b - Math.sqrt(disc); if (t >= 0 && t <= maxDist && (best < 0 || t < best)) best = t; }
  }
  return best;
}
