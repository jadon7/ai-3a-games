// 玩家：鼠标视角 + WASD 移动 + 头戴记录仪的镜头运动（走路起伏、手持抖动、呼吸、后坐、受惊）。
// 镜头和持枪手臂的构造与影片里的 rigmath.py 相同：躯干 → 相机（头）与持枪手臂（绕肩部转动），枪比视线滞后。
// 新增：蹲、跳（能踩上矮的杂物）、左右探身、举枪瞄准、贴墙时自动收枪。
import * as THREE from 'three';
import { C_B2T, C_T2B, FLOOR_Z, b2t } from './config.js';

const DEG = Math.PI / 180;
const CAM_LOCAL = new THREE.Vector3(0.02, -0.50, 0.21);       // Blender 约定的躯干局部坐标（+Y 前，+Z 上）
const NECK = new THREE.Vector3(0.0, -0.58, 0.05);
const PIVOT = new THREE.Vector3(0.0, -0.45, -0.02);
const EYE_H = 1.48;                                           // 躯干原点离地高度
const RIG_FWD = 0.5;                                          // 躯干原点在身体（镜头）前方多远：碰撞按身体算，枪伸在前面
const STEP_UP = 0.42, JUMP_V = 3.35, CROUCH_DROP = 0.66, LEAN_MAX = 0.48, LEAN_ROLL = 18;      // 探身：身子横移的距离（米）和歪过去的角度（度）
const SHOULDER = { L: new THREE.Vector3(-0.205, -0.575, -0.075), R: new THREE.Vector3(0.205, -0.575, -0.075) };      // 两肩在躯干局部的位置（镜头在头上，肩在它的后下方）
const POSE_WALL = [0, -0.10, -0.075, -46, 0, 0], POSE_DOWN = [0.03, -0.12, -0.36, -40, 10, 0], POSE_DROP = [0, -0.05, -0.30, -50, 0, 0], POSE_ONE = [0.012, -0.02, -0.018, -3.5, -9, 0];      // [右, 前, 上, 俯仰°, 侧倾°, 左转°]

function noiseSum(t, seed, freqs, amps) {
  let v = 0;
  for (let i = 0; i < freqs.length; i++) v += amps[i] * Math.sin(2 * Math.PI * freqs[i] * t + seed * (i + 1) * 1.7);
  return v;
}
// 影片里用的冲击响应（按 30fps 的帧给出），这里按时间插值
function impulse(curve, tSince) {
  const f = tSince * 30; if (f < 0 || f >= curve.length) return 0;
  const i = Math.floor(f), a = f - i; return curve[i] * (1 - a) + (curve[i + 1] ?? 0) * a;
}
const sstep = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };

export class Player {
  constructor(camera, world, vm, nav) {
    this.camera = camera; this.world = world; this.vm = vm; this.nav = nav;
    this.pos = new THREE.Vector3(24.72, 3.27, 0);     // 身体（镜头正下方）的平面位置，Blender 坐标
    this.yaw = 90 + 35; this.pitch = -3;              // 度；yaw 是 Blender 里绕 Z 的角（90 = 朝 -X）
    this.vel = new THREE.Vector2();
    this.keys = {}; this.locked = false; this.sens = 0.085;
    this.phase = 0; this.time = 0; this.speed = 0;
    this.gunYaw = 0; this.gunPitch = 0; this.gunYawV = 0; this.gunPitchV = 0;   // 枪相对视线的滞后（度）
    this.shots = []; this.flinchT = -9; this.flinchAmp = 0; this.stress = 0; this.ready = 1; this.lastShotT = -9;
    this.hp = 100; this.lastHurtT = -9; this.dead = false; this.deadT = 0; this.crouch = 0;
    this.z = FLOOR_Z; this.layer = 2; this.vz = 0; this.grounded = true; this.jumpReq = -9; this.landT = -9; this.landAmp = 0;
    this.crouchOn = false; this.adsOn = false; this.ads = 0; this.lean = 0; this.leanOff = 0; this.wallK = 0; this.blind = 0;
    this.onStep = null; this.onLand = null; this.onJump = null;
    this.rec = 0; this.recV = 0; this.recB = 0; this.recBV = 0; this.recY = 0; this.recYV = 0; this.sprK = 0; this.strafe = 0;      // 后坐（弹簧）、冲刺姿势、横移时枪的侧倾
    this._bind();
  }

  _bind() {
    window.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.repeat || !this.locked || this.dead) return;
      if (e.code === 'KeyC') this.crouchOn = !this.crouchOn;
      if (e.code === 'Space') this.jumpReq = this.time;
    });
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    window.addEventListener('blur', () => { this.keys = {}; this.adsOn = false; });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked || this.dead) return;
      const k = this.sens * (1 - 0.3 * this.ads) * (1 - 0.6 * Math.min(1, this.blind));
      this.yaw -= e.movementX * k; this.pitch -= e.movementY * k;
      this.pitch = Math.max(-70, Math.min(60, this.pitch));
    });
    document.addEventListener('mousedown', (e) => { if (e.button === 2) this.adsOn = true; });
    document.addEventListener('mouseup', (e) => { if (e.button === 2) this.adsOn = false; });
  }

  // 能不能站到 (x,y)：格子可走，而且那里的地面不比脚高出一步（空中时只能落到不高于脚的地方）
  // 返回能站的那一层（楼梯的半层平台上会自动换层），不能站返回 -1
  standAt(x, y) { return this.nav ? this.nav.stand(x, y, this.z, this.grounded ? STEP_UP : 0.05, 1.5) : 2; }
  _tryTo(x, y) { const l = this.standAt(x, y); if (l < 0 || (this.blockFn && this.blockFn(x, y))) return false; this.pos.x = x; this.pos.y = y; this.layer = l; return true; }
  place(x, y, yaw, layer = 2) { this.pos.set(x, y, 0); this.layer = layer; if (yaw != null) this.yaw = yaw; this.z = this.nav ? this.nav.floorSmooth(layer, x, y) : FLOOR_Z; this.vz = 0; this.grounded = true; this.vel.set(0, 0); this._py = undefined; this.gunYaw = this.gunPitch = this.gunYawV = this.gunPitchV = 0; this.rec = this.recV = this.recB = this.recBV = this.recY = this.recYV = 0; }

  fireKick(k = 1) {
    const W = this.vm.def, R = W.recoil, a = k * (0.85 + Math.random() * 0.35);
    this.recV += R.rot * a; this.recBV += R.back * a; this.recYV += R.yaw * a * (Math.random() * 2 - 1);
    this.shots.push({ t: this.time, k: a * W.camKick, r: (Math.random() * 2 - 1) * W.camKick }); if (this.shots.length > 8) this.shots.shift();
    this.lastShotT = this.time; this.stress = Math.min(1, this.stress + 0.25 * W.camKick);
  }
  flinch(amp = 1) { this.flinchT = this.time; this.flinchAmp = amp; this.stress = Math.min(1, this.stress + 0.5 * amp); }
  hurt(dmg) {
    if (this.dead) return;
    this.hp -= dmg; this.lastHurtT = this.time; this.flinch(1.6);
    if (this.hp <= 0) { this.dead = true; this.deadT = 0; }
  }

  update(dt, inCombat) {
    this.time += dt; const t = this.time, nav = this.nav, alive = !this.dead;
    // ---------------- 移动
    let fx = 0, fy = 0;
    if (alive && this.locked) {
      if (this.keys.KeyW) fy += 1; if (this.keys.KeyS) fy -= 1; if (this.keys.KeyD) fx += 1; if (this.keys.KeyA) fx -= 1;
    }
    const wantLean = alive && this.locked ? ((this.keys.KeyE ? 1 : 0) - (this.keys.KeyQ ? 1 : 0)) : 0;
    const sprint = !!(this.keys.ShiftLeft || this.keys.ShiftRight) && fy > 0 && !this.crouchOn && alive;
    this.sprinting = sprint && this.speed > 2.0;
    const adsWant = alive && this.adsOn && !sprint && !this.vm.reloading && !this.vm.switching ? 1 : 0;
    this.ads += (adsWant - this.ads) * (1 - Math.exp(-dt * 12));
    let want = (fx || fy) ? (sprint ? 3.4 : 1.6) : 0;
    want *= (1 - 0.42 * this.crouch) * (1 - 0.38 * this.ads) * (1 - 0.3 * Math.abs(this.lean));
    this.wade = this.world.pool ? this.world.pool.depthAt(this.pos.x, this.pos.y, this.z) : 0;      // 脚下的水深：水越深走得越慢
    want *= 1 - 0.5 * Math.min(1, this.wade / 0.85);
    const psi = this.yaw * DEG;
    const fwd = [-Math.sin(psi), Math.cos(psi)], rgt = [Math.cos(psi), Math.sin(psi)];
    const l = Math.hypot(fx, fy) || 1;
    const tv = [(fwd[0] * fy + rgt[0] * fx) / l * want, (fwd[1] * fy + rgt[1] * fx) / l * want];
    const acc = 1 - Math.exp(-dt * (this.grounded ? 9 : 2.5));
    this.vel.x += (tv[0] - this.vel.x) * acc; this.vel.y += (tv[1] - this.vel.y) * acc;
    const nx = this.pos.x + this.vel.x * dt, ny = this.pos.y + this.vel.y * dt;
    if (this._tryTo(nx, ny)) { /* 走过去了 */ }
    else if (this._tryTo(nx, this.pos.y)) this.vel.y *= 0.2;
    else if (this._tryTo(this.pos.x, ny)) this.vel.x *= 0.2;
    else this.vel.multiplyScalar(0.2);
    this.speed = this.vel.length();
    const tc = (alive && this.crouchOn) ? 1 : 0;
    this.crouch += (tc - this.crouch) * (1 - Math.exp(-dt * 10));
    // ---------------- 竖直方向：贴地、跳、落地
    const fz = nav ? nav.floorSmooth(this.layer, this.pos.x, this.pos.y) : FLOOR_Z;
    if (this.grounded) {
      if (alive && t - this.jumpReq < 0.14) { this.vz = JUMP_V; this.grounded = false; this.jumpReq = -9; this.crouchOn = false; if (this.onJump) this.onJump(); }
      else if (fz < this.z - 0.4) { this.grounded = false; this.vz = 0; }
      else this.z += (fz - this.z) * (1 - Math.exp(-dt * 14));
    }
    if (!this.grounded) {
      this.vz -= 9.8 * dt; this.z += this.vz * dt;
      if (this.z <= fz && this.vz <= 0) { this.z = fz; this.grounded = true; this.landT = t; this.landAmp = Math.min(1.6, -this.vz / 3.2); this.vz = 0; if (this.onLand) this.onLand(this.landAmp); }
    }
    // ---------------- 探身：先看那一侧有没有地方
    this.lean += (wantLean - this.lean) * (1 - Math.exp(-dt * 9));
    let leanOff = this.lean * LEAN_MAX;
    if (Math.abs(leanOff) > 0.01 && this.world.raycast) {
      const sgn = Math.sign(leanOff), o = b2t(this.pos.x, this.pos.y, this.z + 1.35), d = b2t(rgt[0] * sgn, rgt[1] * sgn, 0).normalize();
      const h = this.world.raycast(o, d, LEAN_MAX + 0.4);
      if (h) leanOff = sgn * Math.min(Math.abs(leanOff), Math.max(0, h.distance - 0.22));
    }
    this.leanOff = leanOff;
    // ---------------- 步伐
    const gate = this.grounded ? Math.min(1, Math.max(0, (this.speed - 0.12) / 0.4)) : 0;
    const prevPhase = this.phase;
    this.phase += gate * (1.55 + 0.5 * Math.min(this.speed, 3.4)) * dt;
    if (Math.floor(this.phase) !== Math.floor(prevPhase) && this.onStep) this.onStep(this.speed);
    const stepT = (this.phase - Math.floor(this.phase)) / Math.max(0.5, (1.55 + 0.5 * this.speed));       // 距上次落脚的时间
    const foot = gate * impulse([1.0, 0.45, 0.15], stepT);
    const bobZ = -0.028 * gate * (0.5 - 0.5 * Math.cos(2 * Math.PI * this.phase)) * (sprint ? 1.5 : 1);
    const sway = 0.016 * gate * Math.sin(Math.PI * this.phase);
    // ---------------- 状态量
    this.stress = Math.max(inCombat ? 0.35 : 0, this.stress - dt * 0.08);
    const wantReady = ((t - this.lastShotT > 2.5 && !inCombat && this.ads < 0.3) || this.sprinting) ? 1 : 0;
    this.ready += (wantReady - this.ready) * (1 - Math.exp(-dt * (wantReady ? (this.sprinting ? 7 : 2.5) : 9)));
    if (alive && t - this.lastHurtT > 3.5) this.hp = Math.min(100, this.hp + 16 * dt);
    this.blind = Math.max(0, this.blind - dt);
    const breathAmp = 0.25 + 0.75 * this.stress, breathHz = 0.32 + 0.43 * this.stress;
    this._bph = (this._bph || 0) + breathHz * dt; const breath = Math.sin(2 * Math.PI * this._bph);
    // ---------------- 后坐与受惊
    let camP = 0, camR = 0;
    for (const s of this.shots) { const ts = t - s.t; camP += s.k * impulse([0.5, 1.1, 0.4, -0.2], ts); camR += s.r * impulse([0.3, 0.9, 0.4], ts); }
    // 枪的后坐用弹簧：枪口上跳的角度、整枪往后的距离、左右的小摆动。连发时一发叠一发，枪口会越打越高
    const W = this.vm.def, RC = W.recoil, nsub = Math.max(1, Math.ceil(dt / 0.01)), hh = dt / nsub;
    for (let i = 0; i < nsub; i++) {
      this.recV += (-RC.w * RC.w * this.rec - 2 * RC.z * RC.w * this.recV) * hh; this.rec += this.recV * hh;
      this.recBV += (-1.7 * RC.w * RC.w * this.recB - 2 * 0.75 * 1.3 * RC.w * this.recBV) * hh; this.recB += this.recBV * hh;
      this.recYV += (-RC.w * RC.w * this.recY - 2 * 0.7 * RC.w * this.recYV) * hh; this.recY += this.recYV * hh;
    }
    const tf = t - this.flinchT;
    camP += this.flinchAmp * impulse([-1.5, -2.5, -1.5, -0.5], tf); camR += this.flinchAmp * impulse([3.0, 5.5, 3.5, 1.5, 0.5], tf);
    const land = this.landAmp * impulse([1.0, 0.8, 0.45, 0.2, 0.05], t - this.landT);
    camP -= 2.2 * land;
    // ---------------- 手持抖动、呼吸
    const calm = 1 - 0.55 * this.ads;
    const nyaw = noiseSum(t, 11, [0.31, 0.83, 2.3, 6.7], [0.9, 0.45, 0.2, 0.07]);
    const npit = noiseSum(t, 12, [0.27, 0.91, 2.7, 7.3], [0.7, 0.35, 0.18, 0.06]) + 0.5 * breathAmp * breath - 0.55 * foot;
    const nrol = noiseSum(t, 13, [0.23, 0.71, 2.1, 5.9], [1.1, 0.5, 0.22, 0.06]) + 0.9 * gate * Math.sin(Math.PI * this.phase) + 0.3 * foot * Math.sign(Math.sin(Math.PI * this.phase));
    const gyaw = noiseSum(t, 21, [0.37, 1.1, 3.1], [0.5, 0.22, 0.08]) * calm;
    const gpit = (noiseSum(t, 22, [0.33, 1.3, 3.4], [0.45, 0.2, 0.08]) + 0.7 * breathAmp * breath) * calm;
    // ---------------- 枪滞后于视线（二阶弹簧，略欠阻尼：甩枪时会迟到并轻微过冲）
    const camYaw = this.yaw, camPitch = this.pitch;
    if (this._py === undefined) { this._py = camYaw; this._pp = camPitch; }
    const dy = camYaw - this._py, dp = camPitch - this._pp; this._py = camYaw; this._pp = camPitch;
    this.gunYaw -= dy; this.gunPitch -= dp;                       // 视线转了，枪暂时还留在原处
    const w = 17, z = 0.72;
    const step = (x, v) => { const a = -w * w * x - 2 * z * w * v; v += a * dt; x += v * dt; return [x, v]; };
    [this.gunYaw, this.gunYawV] = step(this.gunYaw, this.gunYawV); [this.gunPitch, this.gunPitchV] = step(this.gunPitch, this.gunPitchV);
    this.gunYaw = Math.max(-28, Math.min(28, this.gunYaw)); this.gunPitch = Math.max(-18, Math.min(18, this.gunPitch));
    // ---------------- 阵亡：镜头倒地
    let dz = 0, dRoll = 0, dPitch = 0;
    if (this.dead) {
      this.deadT += dt; const k = Math.min(1, this.deadT / 0.9), e = k * k * (3 - 2 * k);
      dz = -1.25 * e * (1 - 0.45 * this.crouch); dRoll = 72 * e; dPitch = 14 * e;
    }
    // ---------------- 合成矩阵（Blender 约定），再换到 three
    const zT = this.z + EYE_H - CROUCH_DROP * this.crouch - 0.10 * Math.abs(leanOff) / LEAN_MAX + bobZ + 0.004 * breathAmp * breath + dz - 0.035 * land;
    const ox = this.pos.x + fwd[0] * RIG_FWD + rgt[0] * (sway + leanOff), oy = this.pos.y + fwd[1] * RIG_FWD + rgt[1] * (sway + leanOff);
    const T = new THREE.Matrix4().makeTranslation(ox, oy, zT).multiply(new THREE.Matrix4().makeRotationZ(psi));
    const yawOff = nyaw * DEG, pc = (camPitch + npit + camP + dPitch) * DEG, leanRoll = LEAN_ROLL * leanOff / LEAN_MAX, rc = (nrol + camR + dRoll + leanRoll) * DEG;
    const rotOnly = new THREE.Matrix4().makeRotationZ(yawOff).multiply(new THREE.Matrix4().makeRotationX(pc * 0.6));
    const camPos = CAM_LOCAL.clone().sub(NECK).applyMatrix4(rotOnly).add(NECK);
    const Mc = new THREE.Matrix4().makeTranslation(camPos.x, camPos.y, camPos.z)
      .multiply(new THREE.Matrix4().makeRotationZ(yawOff)).multiply(new THREE.Matrix4().makeRotationX(pc)).multiply(new THREE.Matrix4().makeRotationY(rc)).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
    const camW = new THREE.Matrix4().multiplyMatrices(C_B2T, T).multiply(Mc);
    camW.decompose(this.camera.position, this.camera.quaternion, this.camera.scale);
    this.camera.updateMatrixWorld(true);
    // ---------------- 贴墙收枪：镜头正前方很近处有墙时，枪压低收回（也就开不了枪）。长枪伸得远，离墙更远就得收
    let wk = 0;
    if (alive && this.world.raycast) {
      const cf = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      const h = this.world.raycast(this.camera.position, cf, 1.6);
      if (h) wk = Math.max(0, Math.min(1, (W.wall - h.distance) / 0.36));
    }
    this.wallK += (wk - this.wallK) * (1 - Math.exp(-dt * 10));
    this.blocked = this.wallK > 0.55;
    // 阵亡：手臂脱力，枪落出画面
    const dk = this.dead ? Math.min(1, this.deadT / 0.45) : 0, drop = dk * dk * (3 - 2 * dk);
    this.vmDrop = drop;
    // ---------------- 枪的摆放。几种姿势各有一组偏移，按权重叠加：放松端枪、冲刺、贴墙、换枪收起、单手持枪、阵亡
    this.sprK += ((this.sprinting ? 1 : 0) - this.sprK) * (1 - Math.exp(-dt * 8));
    const down = 1 - sstep(this.vm.equip), calmK = Math.max(this.ready * (1 - this.ads), 0) * (1 - this.sprK);
    const off = [0, 0, 0, 0, 0, 0];
    for (const [pose, k] of [[W.lowered, calmK], [W.sprint, this.sprK * (1 - this.wallK)], [POSE_WALL, this.wallK], [POSE_DOWN, down], [POSE_DROP, drop], [POSE_ONE, this.vm.lh]]) for (let i = 0; i < 6; i++) off[i] += pose[i] * k;
    off[1] += W.downFwd * Math.max(0, Math.min(1, (-camPitch - 12) / 45)) * (1 - this.ads);      // 低头时长枪往前送一点，枪托不会怼到镜头上
    // 走路时枪跟着步子轻轻晃，横移时往反方向歪一点，落地时往下一沉
    const vr = this.vel.x * rgt[0] + this.vel.y * rgt[1];
    this.strafe += (vr - this.strafe) * (1 - Math.exp(-dt * 7));
    const bobK = 1 - 0.65 * this.ads, sw = Math.sin(Math.PI * this.phase);
    off[0] += 0.0055 * gate * sw * bobK; off[2] += (-0.007 * gate * Math.abs(Math.sin(2 * Math.PI * this.phase)) * (1 + 0.8 * this.sprK) - 0.028 * land) * bobK; off[3] += -4.5 * land; off[4] += -2.4 * this.strafe * bobK + 1.6 * gate * sw * bobK;
    // 探身时身子（两肩和枪）跟着镜头一起歪，画面里看到的是世界歪了
    const Tb = T.clone().multiply(new THREE.Matrix4().makeTranslation(CAM_LOCAL.x, CAM_LOCAL.y, CAM_LOCAL.z)).multiply(new THREE.Matrix4().makeRotationY(0.9 * leanRoll * DEG)).multiply(new THREE.Matrix4().makeTranslation(-CAM_LOCAL.x, -CAM_LOCAL.y, -CAM_LOCAL.z));
    const gp = (camPitch + this.gunPitch + gpit - 1.2 + off[3]) * DEG, gy = (this.gunYaw + gyaw + off[5]) * DEG;
    const Mv = new THREE.Matrix4().makeTranslation(PIVOT.x, PIVOT.y, PIVOT.z)
      .multiply(new THREE.Matrix4().makeRotationZ(gy)).multiply(new THREE.Matrix4().makeRotationX(gp))
      .multiply(new THREE.Matrix4().makeTranslation(-PIVOT.x, -PIVOT.y, -PIVOT.z))
      .multiply(new THREE.Matrix4().makeTranslation(W.hip[0] + off[0], W.hip[1] + off[1], W.hip[2] + off[2]));
    const hip = new THREE.Matrix4().multiplyMatrices(C_B2T, Tb).multiply(Mv).multiply(C_T2B);
    const e = sstep(this.ads) * (1 - drop) * (1 - down);
    const M = this.vm.group.matrix;
    if (e > 0.002) {
      // 举枪瞄准：枪摆到镜头正前方，照门照星落在画面中心稍下
      const m = this.vm.muzzle;
      const adsLocal = new THREE.Matrix4().makeRotationY((this.gunYaw * 0.35 + gyaw * 0.5) * DEG)
        .multiply(new THREE.Matrix4().makeRotationX((this.gunPitch * 0.35 + gpit * 0.5 - 50 * this.wallK) * DEG))
        .multiply(new THREE.Matrix4().makeTranslation(W.ads[0] - m.x + off[0] * 0.4, W.ads[1] - this.vm.gun.sightY - m.y - 0.02 * this.wallK + off[2] * 0.4, W.ads[2] - m.z + 0.2 * this.wallK));
      const adsW = new THREE.Matrix4().multiplyMatrices(camW, adsLocal);
      const p0 = new THREE.Vector3(), q0 = new THREE.Quaternion(), s0 = new THREE.Vector3(), p1 = new THREE.Vector3(), q1 = new THREE.Quaternion(), s1 = new THREE.Vector3();
      hip.decompose(p0, q0, s0); adsW.decompose(p1, q1, s1);
      M.compose(p0.lerp(p1, e), q0.slerp(q1, e), s0);
    } else M.copy(hip);
    // 后坐和侧倾都绕着枪上的支点转：手枪是握把（手腕），步枪是抵肩的枪托
    const pv = this.vm.gun.pivot, rk = 1 - 0.32 * this.ads;
    M.multiply(new THREE.Matrix4().makeTranslation(pv.x, pv.y, pv.z + this.recB * rk))
      .multiply(new THREE.Matrix4().makeRotationX(this.rec * rk * DEG)).multiply(new THREE.Matrix4().makeRotationY(this.recY * rk * DEG)).multiply(new THREE.Matrix4().makeRotationZ(-off[4] * DEG))
      .multiply(new THREE.Matrix4().makeTranslation(-pv.x, -pv.y, -pv.z));
    // 两肩钉在身体上，手肘由手臂模块反解
    const TW = new THREE.Matrix4().multiplyMatrices(C_B2T, Tb);
    for (const s of ['L', 'R']) this.vm.anchor[s].copy(SHOULDER[s]).applyMatrix4(TW);
    this.vm.pole.L.set(-0.55, -0.8, 0.25).transformDirection(this.camera.matrixWorld); this.vm.pole.R.set(0.55, -0.8, 0.25).transformDirection(this.camera.matrixWorld);
    this.eyeB = new THREE.Vector3(this.pos.x, this.pos.y, zT + 0.15);      // 给敌人瞄准用的胸口位置（Blender 坐标）
    this.headB = new THREE.Vector3(this.pos.x + rgt[0] * leanOff, this.pos.y + rgt[1] * leanOff, zT + 0.21);
  }
}
