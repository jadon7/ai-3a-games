// AI 铁驭：与玩家同一套本体物理（Pilot：蹬墙跑 / 滑铲 / 二段跳 / 攀爬 / 钩索），由 PilotBrain 驱动。
// 外观复用士兵的骨架与模型，另加背后的跳跃装置、发光目镜，以及滑铲 / 蹬墙 / 腾空 / 钩索牵引 / 攀爬的程序姿态和一根看得见的钩索。
import * as THREE from 'three';
import { Soldier, soldierAssets } from './actors.js';
import { Pilot, rayCapsule } from './player.js';
import { PilotBrain, VInput } from './brain.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);
const rnd = (a, b) => a + Math.random() * (b - a);
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
const damp = (c, t, r, dt) => c + (t - c) * (1 - Math.exp(-r * dt));

let KIT = null;
function kit() {
  if (KIT) return KIT;
  const rope = new THREE.CylinderGeometry(0.011, 0.011, 1, 5, 1, true); rope.translate(0, 0.5, 0);
  KIT = {
    rope, ropeMat: new THREE.MeshStandardMaterial({ color: 0x3c3d40, roughness: 0.8, metalness: 0.2 }),
    hook: new THREE.ConeGeometry(0.035, 0.11, 6), hookMat: new THREE.MeshStandardMaterial({ color: 0x8e9196, roughness: 0.4, metalness: 1 }),
    pack: new THREE.BoxGeometry(0.21, 0.17, 0.075), packMat: new THREE.MeshStandardMaterial({ color: 0x17181b, roughness: 0.55, metalness: 0.5 }),
    jet: new THREE.BoxGeometry(0.052, 0.085, 0.04), visor: new THREE.BoxGeometry(0.128, 0.026, 0.012),
  };
  return KIT;
}

export class AIPilot extends Soldier {
  // opts.drop：从多高的空中投入（落地带尘土），opts.yaw：初始朝向
  constructor(game, team, x, z, opts = {}) {
    super(game, 'pilot', team, x, z, opts);
    const A = soldierAssets(game), K = kit(), variant = team === 0 ? 'friend' : 'enemy', glow = A.visorMat[variant];
    this.name = team === 0 ? '铁驭·' + this.name : '赤蝎铁驭';
    this.maxHp = this.hp = 150;   // 铁驭比步兵耐打得多（且会像玩家一样脱战回血）
    const vin = this.vin = new VInput(); const b = this.body = new Pilot(game, { input: vin, npc: true, team });
    b.owner = this; b.maxHp = b.hp = this.maxHp;
    const gy = game.nav.height(x, z);
    b.spawn({ x, y: gy + 0.05 + (opts.drop || 0), z, yaw: opts.yaw !== undefined ? opts.yaw : (team === 0 ? 0 : Math.PI) }); if (opts.drop) b.vel.y = -16;
    this.pos = b.pos; this.vel = b.vel;                       // 与本体共用位置 / 速度
    this.brain = new PilotBrain(game, b, vin, { skill: 0.64 });
    // 识别标记：背后的跳跃装置（两个发光喷口）与发光目镜
    const pack = new THREE.Mesh(K.pack, K.packMat); pack.position.set(0, 0.17, 0.165); pack.castShadow = true; this.bones[1].add(pack);
    for (const s of [-1, 1]) { const j = new THREE.Mesh(K.jet, glow); j.position.set(s * 0.066, -0.075, 0.012); pack.add(j); }
    if (A.human) { const vz = new THREE.Mesh(K.visor, glow); vz.position.set(0, 0.118, -0.116); this.bones[2].add(vz); }
    // 钩索
    this.rope = new THREE.Mesh(K.rope, K.ropeMat); this.rope.visible = false; this.rope.frustumCulled = false; game.engine.scene.add(this.rope);
    this.hook = new THREE.Mesh(K.hook, K.hookMat); this.hook.visible = false; this.hook.frustumCulled = false; game.engine.scene.add(this.hook);
    this.w = { slide: 0, wall: 0, air: 0, grap: 0, mantle: 0 }; this.roll = 0;
    this.burst = 0; this.shotT = 0; this.pauseT = rnd(0.2, 0.6);
    this.mesh.position.copy(this.pos); this.pose(0, 0);
  }

  aimPoint(out) { const b = this.body; return out.set(b.pos.x, b.pos.y + b.height * 0.66, b.pos.z); }
  eye(out) { return this.body.getEye(out); }
  hitTest(o, d, maxDist) {
    if (!this.alive) return -1; const b = this.body, h = b.height;
    const t = rayCapsule(o, d, b.pos.x, b.pos.y + 0.36, b.pos.z, h - 0.72, 0.36, maxDist); if (t < 0) return -1;
    this._head = (o.y + d.y * t) > b.pos.y + h - 0.34; return t;
  }

  takeDamage(amount, from, info = {}) {
    if (!this.alive) return false; const b = this.body; if (b.invuln > 0) return false;
    const killed = b.takeDamage(amount, from, info) === true; this.hp = b.hp; this.flinch = 1;
    if (killed) { this.die(from, info); return true; }
    return false;
  }
  die(from, info = {}) {
    this.alive = false; this.dead = 0; this.target = null; this.hp = 0; this.rope.visible = false; this.hook.visible = false;
    const d = info.dir; if (d) { const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw); this.fallDir = (d.x * fx + d.z * fz) > 0 ? -1 : 1; } else this.fallDir = Math.random() < 0.5 ? 1 : -1;
    this.fallYaw = rnd(-0.5, 0.5);
    this.game.audio.play('impact_flesh', { x: this.pos.x, y: this.pos.y + 1, z: this.pos.z, volume: 0.8 });
    this.game.onKill(this, from, info);
  }
  remove() { super.remove(); this.game.engine.scene.remove(this.rope); this.game.engine.scene.remove(this.hook); }

  update(dt, camDist) {
    const g = this.game, b = this.body, W = this.w;
    b.audible = camDist < 70;
    if (!this.alive) {   // 尸体：空中阵亡的会继续落到地面
      this.dead += dt; if (this.dead < 3) b.update(dt);
      this.mesh.position.copy(b.pos); this.mesh.rotation.z = 0; this.animateDeath(dt); return this.dead < 9;
    }
    this.brain.update(dt); b.update(dt);
    if (!b.alive) { this.die(b.lastDamageFrom, {}); return true; }   // 掉出世界
    this.hp = b.hp; this.flinch = Math.max(0, this.flinch - dt * 4); this.pauseT -= dt;
    const o = this.brain.out, engaged = !!o.tgt && this.brain.tgtVis;
    if (o.fire && o.tgt) this.shoot(dt, o.tgt); else if (!engaged) this.burst = 0;
    // 朝向：交战时面向目标，否则面向行进方向
    const sp = Math.hypot(b.vel.x, b.vel.z); this.moveSp = sp; this.aimYaw = b.yaw; this.aimPitch = b.pitch; this.target = engaged ? o.tgt : null;
    // 交战时面向目标；但跑得快时下半身转向行进方向（上半身由 pose 里的 twist 拧回去瞄准），不会出现高速倒着跑、横着跑
    const moveYaw = Math.atan2(-b.vel.x, -b.vel.z), turnK = Math.max(0, Math.min(1, (sp - 2.5) / 2.5));
    const faceYaw = b.wr.on ? Math.atan2(-b.wr.tangent.x, -b.wr.tangent.z) : engaged ? this.aimYaw + angDiff(moveYaw, this.aimYaw) * turnK : sp > 1.2 ? moveYaw : this.yaw;
    this.yaw += angDiff(faceYaw, this.yaw) * Math.min(1, dt * 10);
    // 姿态权重
    const gs = b.grapple.state === 2, air = !b.onGround && !b.wr.on && !b.mantle.on && !gs;
    W.slide = damp(W.slide, b.sliding && b.onGround ? 1 : 0, 12, dt); W.wall = damp(W.wall, b.wr.on ? 1 : 0, 12, dt); W.air = damp(W.air, air ? 1 : 0, 10, dt);
    W.grap = damp(W.grap, gs ? 1 : 0, 10, dt); W.mantle = damp(W.mantle, b.mantle.on ? 1 : 0, 16, dt);
    this.crouchW += ((b.crouching && !b.sliding && b.onGround ? 1 : 0) - this.crouchW) * Math.min(1, dt * 8);
    // 蹬墙时身体向墙外倾斜（网格绕自身前后轴滚转）
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw); const side = b.wr.on ? Math.sign(b.wr.normal.x * rx + b.wr.normal.z * rz) : 0;
    this.roll = damp(this.roll, -side * 0.34, 10, dt);
    this.animT += dt * (2.4 + Math.min(sp, 10) * 1.6);
    this.mesh.position.copy(b.pos); this.mesh.rotation.set(0, this.yaw, this.roll);
    this.grounded = b.onGround;   // 腾空 / 蹬墙时脚不去贴合地面高度
    if (camDist < 110) this.pose(Math.min(1.2, sp / 6.5), dt);
    this.shadowLOD(camDist);
    if ((g.frame + (this.mesh.id & 15)) % 16 === 0) { const s = 0.3 + 0.7 * g.nav.skyAt(this.pos.x, this.pos.z); if (Math.abs(s - this.ambient) > 0.02) { this.ambient = s; this.mat.envMapIntensity = s; } }
    this.updateRope(camDist);
    return true;
  }

  // 钩索：从左手拉到钩头的一根细缆
  updateRope(camDist) {
    const gr = this.body.grapple, on = gr.state > 0 && camDist < 140; this.rope.visible = on; this.hook.visible = on; if (!on) return;
    this.mesh.updateMatrixWorld(true); const from = _v.set(0, -0.27, 0).applyMatrix4(this.bones[4].matrixWorld);
    const d = _v2.subVectors(gr.hook, from); const len = d.length(); if (len < 0.05) { this.rope.visible = false; return; } d.multiplyScalar(1 / len);
    this.rope.position.copy(from); this.rope.quaternion.setFromUnitVectors(UP, d); this.rope.scale.set(1, len, 1);
    this.hook.position.copy(gr.hook); this.hook.quaternion.copy(this.rope.quaternion);
  }

  // 射击：沿用步兵的 hitscan + 散布模型，命中略高；自身高速机动时散布变大
  shoot(dt, tgt) {
    const g = this.game, b = this.body;
    if (this.burst <= 0) { if (this.pauseT > 0) return; this.burst = (4 + Math.random() * 4) | 0; this.shotT = 0; }
    this.shotT -= dt; if (this.shotT > 0) return;
    this.shotT = 0.1; this.burst--; if (this.burst <= 0) this.pauseT = rnd(0.6, 1.3);
    const mz = b.getEye(_v).addScaledVector(b.look, 0.7).addScaledVector(b.right, 0.14); mz.y -= 0.22;
    tgt.aimPoint(_v2); if (tgt.isPlayer) _v2.y += 0.1;
    const tsp = tgt.isPlayer ? Math.hypot(tgt.vel.x, tgt.vel.z) + Math.abs(tgt.vel.y) * 0.5 : (tgt.moveSp || 0);
    const sig = 0.033 * (1 + tsp / (tgt.isPlayer ? 4.5 : 9)) * (1 + this.moveSp / 16) * (tgt.kind === 'mech' ? 0.5 : 1) * g.aiAccuracy;
    const dir = _v3.subVectors(_v2, mz).normalize(); dir.x += (Math.random() + Math.random() - 1) * sig; dir.y += (Math.random() + Math.random() - 1) * sig * 0.7; dir.z += (Math.random() + Math.random() - 1) * sig; dir.normalize();
    const h = g.hitscan(mz, dir, 110, this);
    const near = g.engine.camera.position.distanceToSquared(mz) < 95 * 95; const col = this.team === 0 ? 0xbfe8ff : 0xffb070;
    if (h) {
      if (h.ent) { const dmg = h.ent.isPlayer ? 7 : h.ent.kind === 'mech' ? 4.5 : 6.5; h.ent.takeDamage(dmg, this, { point: h.point, dir, head: false }); if (near && !h.ent.isPlayer) g.fx.hitFlesh(h.point, dir, h.ent.robot || h.ent.kind === 'mech'); }
      else if (near) g.fx.impact(h.point, h.normal, h.surf, 1, Math.random() < 0.5);
      if (near) g.fx.tracer(mz, h.point, col, 260, 0.03, 6);
    } else if (near) g.fx.tracer(mz, _v2.copy(mz).addScaledVector(dir, 100), col, 260, 0.03, 6);
    if (near) { g.fx.muzzleFlash(mz, dir, 0.7); g.audio.play('enemy_fire', { x: mz.x, y: mz.y, z: mz.z, volume: 0.75 }); }
    if (tgt.isPlayer && (!h || !h.ent) && Math.random() < 0.3) g.audio.play('bullet_whiz', { volume: 0.5 });
  }

  // 在士兵的跑 / 站 / 蹲姿态上叠加铁驭动作
  pose(run, dt) {
    super.pose(run, dt);
    const W = this.w; if (!W) return;   // 父类构造时会先调一次
    const b = this.bones; const mix = (bone, x, k) => { bone.rotation.x += (x - bone.rotation.x) * k; };
    const arm = (bone, x, y, z, k) => { bone.quaternion.slerp(_q.setFromEuler(_e.set(x, y, z)), k); };
    if (W.slide > 0.01) {   // 滑铲：身体后仰，一腿前伸一腿收起
      const k = W.slide; b[0].position.y += (0.40 - b[0].position.y) * k; mix(b[0], 0.66, k); mix(b[1], -0.6, k); mix(b[2], 0.1, k);
      mix(b[7], 0.74, k); mix(b[8], -0.16, k); mix(b[9], 0.95, k); mix(b[10], -1.8, k);
    }
    if (W.air > 0.01) {     // 腾空：屈膝收腿
      const k = W.air; mix(b[0], -0.14, k); mix(b[7], 0.85, k); mix(b[8], -1.3, k); mix(b[9], 0.3, k); mix(b[10], -0.8, k);
    }
    if (W.grap > 0.01) {    // 钩索牵引：身体前倾，左臂前伸抓缆，双腿拖在后面
      const k = W.grap; mix(b[0], -0.5, k); mix(b[7], -0.3, k); mix(b[8], -0.45, k); mix(b[9], -0.05, k); mix(b[10], -0.95, k);
      arm(b[3], 2.15 + this.aimPitch * 0.6, 0, 0.12, k); arm(b[4], 0.12, 0, 0, k);
    }
    if (W.mantle > 0.01) {  // 攀爬：双臂上举，提膝
      const k = W.mantle; mix(b[0], -0.25, k); mix(b[7], 1.05, k); mix(b[8], -1.3, k); mix(b[9], 0.2, k); mix(b[10], -0.5, k);
      arm(b[3], 2.75, 0, 0.2, k); arm(b[4], 0.35, 0, 0, k); arm(b[5], 2.75, 0, -0.2, k); arm(b[6], 0.35, 0, 0, k);
    }
    // 这些动作里脚不踩地：脚掌放松成自然下垂
    const kf = Math.max(W.slide, W.air, W.grap, W.mantle); if (kf > 0.01 && b[12]) { arm(b[12], -0.32, 0, 0, kf); arm(b[13], -0.32, 0, 0, kf); }
  }
}
