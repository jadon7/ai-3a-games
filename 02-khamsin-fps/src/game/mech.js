// 机甲：Blender 硬表面模型（assets/models/mech.glb，载入失败时退回程序化方块模型）+ 不滑步的步行 IK + 轨道空降 + 玩家驾驶 + AI
import * as THREE from 'three';
import { Parts } from './weapons.js';
import { rayCapsule } from './player.js';
import { hasMechModel, mechFromModel, mechMaterials, mechOwnMaterials } from './mechloader.js';
import { MechGait } from './mechgait.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3(), _v6 = new THREE.Vector3(), _q = new THREE.Quaternion();
const rnd = (a, b) => a + Math.random() * (b - a);
const damp = (c, t, r, dt) => c + (t - c) * (1 - Math.exp(-r * dt));
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const ease = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const THIGH = 1.25, SHIN = 1.25, FOOT = 0.36;

let MATS = null;
function mats(game) {
  if (MATS) return MATS;
  const T = game.engine.T;
  const std = (t, color) => new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughnessMap: t.ormMap, metalnessMap: t.ormMap, roughness: 1, metalness: 1, color });
  for (const t of [T.armor, T.gunmetal]) { /* 大型部件贴图平铺 */ }
  const mk = (main, sec, accent, glow) => ({ main: std(T.armor, main), sec: std(T.armor, sec), joint: std(T.gunmetal, 0xd0d0d0), dark: new THREE.MeshStandardMaterial({ color: 0x08080a, roughness: 0.6, metalness: 0.5 }), accent: std(T.armor, accent), glow: new THREE.MeshBasicMaterial({ color: glow, fog: false }), vent: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.0, 1.1, 0.25), fog: false }),
    warn: std(T.armor, 0xd9a21a), glass: new THREE.MeshStandardMaterial({ color: 0x0b1d24, roughness: 0.16, metalness: 0.9 }) });   // warn / glass 只有 GLB 模型用到
  MATS = [mk(0xb8944a, 0x4a4a44, 0x1f7a84, new THREE.Color(0.4, 2.4, 3.2)), mk(0x7a1a14, 0x26262a, 0xc8a020, new THREE.Color(3.4, 0.5, 0.15))];
  return MATS;
}

// 程序化方块模型：GLB 载入失败时的退路（关节层级与 GLB 版完全相同）
function buildModel(M) {
  const root = new THREE.Group();
  const pelvis = new THREE.Group(); root.add(pelvis);
  pelvis.add(new Parts().box('main', 1.5, 0.55, 1.1, 0, 0, 0, 0, 0, 0, 0.1).cyl('joint', 0.38, 0.5, 0.85, 0, 0, 'x', 14).cyl('joint', 0.38, 0.5, -0.85, 0, 0, 'x', 14).box('sec', 0.5, 0.6, 0.3, 0, -0.35, -0.5, 0, 0, 0, 0.06).box('sec', 0.6, 0.45, 0.3, 0, -0.2, 0.55, 0, 0, 0, 0.06).build(M, true));
  const legs = [];
  for (const s of [-1, 1]) {
    const thigh = new THREE.Group(); thigh.position.set(s * 0.95, 0, 0); pelvis.add(thigh);
    thigh.add(new Parts().box('main', 0.55, 1.35, 0.7, 0, -0.6, 0, 0, 0, 0, 0.1).box('sec', 0.62, 0.8, 0.25, 0, -0.5, -0.42, 0, 0, 0, 0.06).cyl('joint', 0.33, 0.66, 0, -THIGH, 0, 'x', 14).box('accent', 0.57, 0.12, 0.72, 0, -0.15, 0, 0, 0, 0, 0.03).build(M, true));
    const shin = new THREE.Group(); shin.position.set(0, -THIGH, 0); thigh.add(shin);
    shin.add(new Parts().box('sec', 0.48, 1.3, 0.55, 0, -0.62, 0.05, 0, 0, 0, 0.08).box('main', 0.56, 0.9, 0.2, 0, -0.5, -0.3, 0, 0, 0, 0.05).cyl('joint', 0.06, 0.9, 0.2 * s, -0.6, 0.38, 'y', 8).cyl('joint', 0.26, 0.6, 0, -SHIN, 0, 'x', 12).build(M, true));
    const foot = new THREE.Group(); foot.position.set(0, -SHIN, 0); shin.add(foot);
    foot.add(new Parts().box('main', 0.85, 0.32, 1.55, 0, -0.2, -0.25, 0, 0, 0, 0.08).box('sec', 0.9, 0.2, 0.4, 0, -0.26, -1.0, 0, 0, 0, 0.05).box('joint', 0.3, 0.3, 0.5, 0, -0.1, 0.65, 0, 0, 0, 0.06).build(M, true));
    legs.push({ thigh, shin, foot, side: s });
  }
  const torso = new THREE.Group(); torso.position.set(0, 0.4, 0); pelvis.add(torso);
  const tp = new Parts();
  tp.box('main', 2.3, 1.7, 1.9, 0, 1.15, 0.1, 0, 0, 0, 0.18).box('sec', 1.7, 1.0, 0.3, 0, 1.15, -0.95, -0.15, 0, 0, 0.08).box('main', 1.0, 0.7, 0.2, 0, 1.5, -1.08, 0, 0, 0, 0.06).box('glow', 0.7, 0.09, 0.05, 0, 1.63, -1.19)
    .cyl('joint', 0.6, 0.5, 0, 0.12, 0, 'y', 16).box('main', 0.75, 0.8, 1.0, 1.5, 1.75, 0, 0, 0, 0, 0.1).box('main', 0.75, 0.8, 1.0, -1.5, 1.75, 0, 0, 0, 0, 0.1)
    .box('sec', 0.95, 0.25, 1.25, 1.58, 2.25, 0, 0, 0, -0.15, 0.06).box('sec', 0.95, 0.25, 1.25, -1.58, 2.25, 0, 0, 0, 0.15, 0.06).box('sec', 1.4, 1.2, 0.6, 0, 1.3, 1.15, 0, 0, 0, 0.1)
    .cyl('joint', 0.18, 0.55, 0.45, 2.15, 1.2, 'y', 10).cyl('joint', 0.18, 0.55, -0.45, 2.15, 1.2, 'y', 10).box('vent', 0.5, 0.08, 0.05, 0.4, 1.0, 1.46).box('vent', 0.5, 0.08, 0.05, -0.4, 1.0, 1.46).box('vent', 0.5, 0.08, 0.05, 0.4, 1.2, 1.46).box('vent', 0.5, 0.08, 0.05, -0.4, 1.2, 1.46)
    .box('joint', 0.5, 0.3, 0.5, 0, 2.15, -0.45, 0, 0, 0, 0.06).cyl('joint', 0.02, 0.9, 0.2, 2.7, -0.3, 'y', 6).box('accent', 2.32, 0.12, 0.5, 0, 1.86, -0.62, 0, 0, 0, 0.03).box('accent', 0.3, 0.5, 0.05, 0.7, 1.25, -1.12)
    .box('sec', 0.9, 0.6, 1.25, -1.5, 2.72, 0.1, 0, 0, 0, 0.06);
  for (let i = 0; i < 6; i++) tp.cyl('dark', 0.1, 0.06, -1.5 + ((i % 3) - 1) * 0.27, 2.72 + (i < 3 ? 0.14 : -0.14), -0.53, 'z', 10);
  torso.add(tp.build(M, true));
  const armR = new THREE.Group(); armR.position.set(1.5, 1.75, 0); torso.add(armR);
  armR.add(new Parts().box('sec', 0.5, 1.1, 0.55, 0.38, -0.5, 0, 0, 0, 0, 0.08).cyl('joint', 0.3, 0.62, 0.38, -1.0, 0, 'x', 12).box('dark', 0.6, 0.6, 2.2, 0.4, -1.0, -1.0, 0, 0, 0, 0.08).box('main', 0.66, 0.3, 1.2, 0.4, -0.72, -0.9, 0, 0, 0, 0.06)
    .cyl('joint', 0.16, 1.7, 0.4, -1.0, -2.6, 'z', 12).box('joint', 0.46, 0.46, 0.36, 0.4, -1.0, -3.4, 0, 0, 0, 0.05).cyl('sec', 0.4, 0.5, 0.4, -1.5, -0.6, 'x', 14).box('accent', 0.62, 0.1, 0.3, 0.4, -0.7, -1.9).build(M, true));
  const muzzle = new THREE.Object3D(); muzzle.position.set(0.4, -1.0, -3.65); armR.add(muzzle);
  const armL = new THREE.Group(); armL.position.set(-1.5, 1.75, 0); torso.add(armL);
  armL.add(new Parts().box('sec', 0.5, 1.1, 0.55, -0.38, -0.5, 0, 0, 0, 0, 0.08).cyl('joint', 0.3, 0.62, -0.38, -1.0, 0, 'x', 12).box('main', 0.5, 0.55, 1.5, -0.38, -1.0, -0.7, 0, 0, 0, 0.08).box('joint', 0.62, 0.62, 0.62, -0.38, -1.0, -1.6, 0, 0, 0, 0.1)
    .box('sec', 0.1, 1.0, 1.2, -0.72, -1.0, -0.8, 0, 0, 0, 0.04).box('glow', 0.03, 0.5, 0.06, -0.78, -1.0, -0.8).build(M, true));
  const pod = new THREE.Object3D(); pod.position.set(-1.5, 2.72, -0.6); torso.add(pod);
  const eye = new THREE.Object3D(); eye.position.set(0, 1.75, -1.36); torso.add(eye);
  root.traverse((o) => { if (o.isMesh) { o.frustumCulled = true; } });
  return { root, pelvis, legs, torso, armR, armL, muzzle, pod, eye };
}

// 机炮抛出的弹壳（每台机甲一个小池子）
let CASE = null;
function caseMesh() {
  if (!CASE) CASE = { geo: new THREE.CylinderGeometry(0.07, 0.082, 0.42, 8), mat: new THREE.MeshStandardMaterial({ color: 0xb48c3c, roughness: 0.34, metalness: 1 }) };
  const m = new THREE.Mesh(CASE.geo, CASE.mat); m.visible = false; return m;
}

const BUBBLE_MAT = () => new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uAlpha: { value: 1 }, uColor: { value: new THREE.Color(0.3, 1.3, 1.8) } },
  vertexShader: /* glsl */`varying vec3 vN; varying vec3 vP; varying vec3 vL; void main(){ vL = position; vec4 w = modelMatrix * vec4(position, 1.0); vP = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: /* glsl */`
    uniform float uTime; uniform float uAlpha; uniform vec3 uColor; varying vec3 vN; varying vec3 vP; varying vec3 vL;
    void main(){ vec3 V = normalize(cameraPosition - vP); float f = pow(1.0 - abs(dot(V, normalize(vN))), 2.2);
      vec3 q = vL * 3.2; float hex = abs(sin(q.x + sin(q.y * 1.7)) * sin(q.y + sin(q.z * 1.7)) * sin(q.z + sin(q.x * 1.7)));
      float line = smoothstep(0.06, 0.0, hex) * 0.6; float sweep = smoothstep(0.9, 1.0, sin(vL.y * 0.8 - uTime * 2.5) * 0.5 + 0.5);
      gl_FragColor = vec4(uColor * (f * 1.6 + line + sweep * 0.25 + 0.03) * uAlpha, 1.0); }`,
  transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
});

// 驾驶时两臂相对肩座的收拢量 [向内, 向上, 向前]（米）：右臂机炮、左臂动力拳。
// 左臂比机炮短，光平移够不到画面里：再向内摆一个角度（第 4 项，弧度），拳头从左下角伸进视野。不能再往前移：肩关节会跑到眼睛前面，贴脸一大块
const FP_R = [0.22, 0.33, 0.55], FP_L = [0.30, 0.46, 0.7, 0.35];

export class Mech {
  constructor(game, team, x, z, opts = {}) {
    this.game = game; this.team = team; this.kind = 'mech'; this.robot = true; this.isPlayerMech = !!opts.player; this.name = team === 0 ? (opts.player ? '你的机甲' : '友军机甲') : '赤蝎机甲';
    this.pos = new THREE.Vector3(x, game.nav.height(x, z), z); this.vel = new THREE.Vector3(); this.groundY = this.pos.y;
    this.legYaw = opts.yaw || 0; this.aimYaw = this.legYaw; this.aimPitch = 0;
    this.maxHp = opts.player ? 3200 : 2600; this.hp = this.maxHp; this.alive = true; this.state = 'drop'; this.t = 0; this.dropDelay = opts.delay !== undefined ? opts.delay : 1.8;
    this.phase = 0; this.walk = 0; this.stepSide = 0; this.crouch = 1; this.punchT = -1; this.recoil = 0;
    this.cool = 0; this.mag = 10; this.reloadT = -1; this.rocketCD = 3; this.salvo = 0; this.salvoT = 0; this.dash = 2; this.dashT = 0; this.core = opts.player ? 0.3 : 0; this.laserT = -1; this.exitHold = 0; this.doomT = 0;
    this.target = null; this.think = 0; this.path = null; this.pathI = 0; this.repath = 0; this.burst = 0; this.pause = 1; this.moveSp = 0; this.bubbleT = 0; this.piloted = false; this.hitFlash = 0;
    const M = mats(game)[team]; let glb = null; this.own = null;
    if (hasMechModel() && !opts.proc) { this.own = mechOwnMaterials(M); glb = mechFromModel(M.glb || (M.glb = mechMaterials(M)), this.own, team); }
    const m = this.model = glb || buildModel(M);
    // 表现用的状态（不影响玩法）：步态、炮管转速与过热、火箭巢盖、座舱盖、传感器头、弹壳
    this.gait = new MechGait(); this._px = x; this._pz = z; this._h = (hx, hz) => game.nav.height(hx, hz);
    this.spin = 0; this.spinV = 0; this.heat = 0; this.lid = 0; this.lidT = 0; this.hatchO = 0; this.hatchT = 0; this.headYaw = 0; this.tube = 0; this.punchFx = false; this.camY = null; this.turning = false; this.aimPrev = this.aimYaw; this.fxT = 0; this.twist = 0; this.kick = 0; this.cases = []; this.caseI = 0; this.arcs = null; this.embarkT = -1; this.wasPiloted = false; this.kneel = 0; this.glowCol = M.glow.color.clone();
    m.root.visible = false; game.engine.scene.add(m.root);
    // 落点标记
    this.marker = new THREE.Mesh(new THREE.RingGeometry(2.6, 3.0, 40), new THREE.MeshBasicMaterial({ color: team === 0 ? new THREE.Color(0.4, 1.8, 2.4) : new THREE.Color(2.6, 0.4, 0.15), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    this.marker.rotation.x = -Math.PI / 2; this.marker.position.set(x, this.pos.y + 0.12, z); game.engine.scene.add(this.marker);
    this.bubble = new THREE.Mesh(new THREE.SphereGeometry(5.6, 32, 20), BUBBLE_MAT()); this.bubble.visible = false; this.bubble.renderOrder = 8; game.engine.scene.add(this.bubble);
    if (team === 1) this.bubble.material.uniforms.uColor.value.setRGB(1.8, 0.5, 0.2);
    game.audio.play('mech_drop_warn', { x, y: this.pos.y + 20, z, volume: 1 });
  }

  aimPoint(out) { return out.set(this.pos.x, this.pos.y + 3.5, this.pos.z); }
  hitTest(o, d, maxDist) { if (!this.alive || this.state === 'drop') return -1; this._head = false; return rayCapsule(o, d, this.pos.x, this.pos.y + 1.5, this.pos.z, 3.2, 1.55, maxDist); }

  takeDamage(amount, from, info = {}) {
    if (!this.alive || this.state === 'drop' || this.bubbleT > 0 || this.state === 'doomed' || this.state === 'ejected') return false;
    this.hp -= amount; this.hitFlash = 1;
    if (this.piloted) { this.game.onPlayerHurt(Math.min(40, amount * 0.08), from, info); this.game.player.shake = Math.min(1, this.game.player.shake + amount * 0.0012); if (amount > 60) this.game.audio.play('mech_shield_hit', { volume: 0.7 }); }
    if (from && from.team !== this.team && !this.piloted && (!this.target || from.kind === 'mech')) this.target = from;
    if (this.hp <= 0) {
      this.hp = 0;
      if (this.piloted) { this.state = 'doomed'; this.doomT = 6; this.game.audio.play('mech_doomed'); this.game.hud.announce('机甲濒临摧毁！按 E 弹射', 'warn'); this.killer = from; }
      else this.destroy(from);
      return this.state !== 'doomed';
    }
    return false;
  }

  destroy(from) {
    if (!this.alive) return; this.alive = false; const g = this.game;
    this.aimPoint(_v); g.fx.explosion(_v, 4.2, { scorch: false }); g.fx.explosion(_v2.set(this.pos.x, this.pos.y + 0.2, this.pos.z), 3, {});
    g.audio.play('mech_explode', { x: this.pos.x, y: this.pos.y + 3, z: this.pos.z }); g.audio.duck(0.5, 1.5);
    g.explosionDamage(_v, 11, 260, this, 500, true);
    g.audio.loop('mech_laser', false); g.audio.loop('mech_hum', false);
    // 残骸：几次迟到的殉爆 + 持续几秒的火与黑烟
    const px = this.pos.x, py = this.pos.y, pz = this.pos.z;
    for (let i = 0; i < 3; i++) g.after(0.14 + i * 0.17, () => { g.fx.explosion(_v.set(px + rnd(-2, 2), py + rnd(0.6, 3.6), pz + rnd(-2, 2)), rnd(1.0, 1.7), { scorch: false }); g.fx.sparks(_v, null, 16, [2.4, 1.3, 0.5], 14); });
    for (let i = 0; i < 14; i++) g.after(0.3 + i * 0.22, () => { for (let k = 0; k < 3; k++) g.fx.mechFire(_v.set(px + rnd(-1.6, 1.6), py + rnd(0.2, 1.4), pz + rnd(-1.6, 1.6)), 1.5 - i * 0.06); });
    this.remove(); g.onKill(this, from, {});
  }
  remove() {
    const s = this.game.engine.scene; s.remove(this.model.root); s.remove(this.marker); s.remove(this.bubble); this.removed = true;
    for (const c of this.cases) s.remove(c.m); this.cases.length = 0; this.releaseBeams();
    if (this.own) for (const k of Object.keys(this.own)) this.own[k].dispose();
  }
  releaseBeams() { if (this.beamA) { this.beamA.hold = false; this.beamB.hold = false; this.beamA = null; } if (this.arcs) { for (const a of this.arcs) a.hold = false; this.arcs = null; } }

  // ---------- 主更新 ----------
  update(dt) {
    const g = this.game; if (!this.alive) return false;
    this.t += dt; this.hitFlash = Math.max(0, this.hitFlash - dt * 5); this.cool -= dt; this.rocketCD -= dt; this.recoil = damp(this.recoil, 0, 9, dt);
    if (this.dash < 2) this.dash = Math.min(2, this.dash + dt / 5);
    if (this.state === 'drop') { this.updateDrop(dt); return true; }
    if (this.bubbleT > 0) { this.bubbleT -= dt; const b = this.bubble; b.visible = this.bubbleT > 0; b.position.set(this.pos.x, this.pos.y + 2.2, this.pos.z); b.material.uniforms.uTime.value = this.t; b.material.uniforms.uAlpha.value = Math.min(1, this.bubbleT / 1.5) * (this.piloted ? 0.22 : 1); }   // 从座舱里往外看：护盾纹路压淡，不挡视线
    if (this.state === 'landing') { this.crouch = Math.max(0, 1 - (this.t - this.landT) / 1.1); if (this.crouch <= 0) this.state = 'idle'; }
    else if (this.state === 'doomed') { this.doomT -= dt; if (Math.random() < 0.5) g.fx.sparks(this.aimPoint(_v).add(_v2.set(rnd(-1.5, 1.5), rnd(-1, 1.5), rnd(-1, 1))), null, 3, [1.8, 1.0, 0.4], 5); if (Math.random() < dt * 22) g.fx.mechFire(this.aimPoint(_v).add(_v2.set(rnd(-1.3, 1.3), rnd(-0.6, 1.8), rnd(-1.4, 0.6))), 1.1); if (this.doomT <= 0 || g.ctl.hit('KeyE')) { g.ejectFromMech(this); this.state = 'ejected'; } else this.updatePiloted(dt, true); }   // 弹射后标成 ejected：否则同一帧里 game.js 会因为“机甲待机 + 按了 E”又把人塞回去
    else if (this.state === 'ejected') { if (Math.random() < dt * 30) g.fx.mechFire(this.aimPoint(_v).add(_v2.set(rnd(-1.3, 1.3), rnd(-0.6, 1.8), rnd(-1.4, 0.6))), 1.2); }   // 空机等待殉爆
    else if (this.piloted) this.updatePiloted(dt, false);
    else this.updateAI(dt);
    // 武器：装填 / 火箭齐射 / 激光
    if (this.reloadT >= 0) { this.reloadT += dt; if (this.reloadT > 2.3) { this.reloadT = -1; this.mag = 10; if (this.piloted) g.audio.play('reload_in', { pitch: 0.6 }); } }
    if (this.salvo > 0) { this.salvoT -= dt; if (this.salvoT <= 0) { this.salvoT = 0.1; this.salvo--; this.fireRocket(); } }
    this.animate(dt);
    return true;
  }

  updateDrop(dt) {
    const g = this.game; const t = this.t - this.dropDelay;
    this.marker.scale.setScalar(1 + 0.12 * Math.sin(this.t * 9)); this.marker.material.opacity = 0.6 + 0.4 * Math.sin(this.t * 14);
    if (t < 0) return;
    const fall = 1.25; const u = Math.min(1, t / fall); const y = this.groundY + (1 - u) * 170;
    this.model.root.visible = true; this.pos.y = y; this.crouch = 1;
    for (let i = 0; i < 4; i++) g.fx.add.spawn({ x: this.pos.x + rnd(-1.5, 1.5), y: y + 4 + rnd(0, 6), z: this.pos.z + rnd(-1.5, 1.5), vx: 0, vy: 20, vz: 0, life: rnd(0.25, 0.5), s0: rnd(2.5, 4), s1: 0.5, r: 2.6, g: 1.2, b: 0.4, a: 0.9, tile: 6 });
    g.fx.alpha.spawn({ x: this.pos.x + rnd(-1, 1), y: y + 8, z: this.pos.z + rnd(-1, 1), vx: 0, vy: 6, vz: 0, life: 2.2, s0: 3, s1: 9, r: 0.35, g: 0.32, b: 0.3, a: 0.4, tile: 1, drag: 0.5, fadeIn: 0.1 });
    if (u > 0.55) for (const s of [-1, 1]) g.fx.add.spawn({ x: this.pos.x + s * 0.95 + rnd(-0.2, 0.2), y: y + 0.4, z: this.pos.z + rnd(-0.2, 0.2), vx: rnd(-2, 2), vy: -34, vz: rnd(-2, 2), life: rnd(0.08, 0.16), s0: rnd(1.2, 1.8), s1: 0.4, r: 1.4, g: 2.2, b: 3.2, a: 0.9, tile: 6 });   // 着陆前的反推喷焰
    if (u >= 1) {
      this.pos.y = this.groundY; this.state = 'landing'; this.landT = this.t; this.bubbleT = 9; g.engine.scene.remove(this.marker);
      _v.set(this.pos.x, this.pos.y + 0.1, this.pos.z);
      this.gait.reset({ pos: this.pos, yaw: this.legYaw }); this.gait.dipV = -1.4; this._px = this.pos.x; this._pz = this.pos.z; g.fx.stomp(_v, 2.2);
      g.fx.explosion(_v, 2.6, {}); g.fx.dustPuff(_v, 26, 3.5, g.fx.dustCol, 11); g.fx.ring(_v, this.team === 0 ? [0.5, 1.6, 2.2] : [2.2, 0.7, 0.3], 22, 0.9);
      g.audio.play('mech_impact', { x: _v.x, y: _v.y, z: _v.z }); g.audio.duck(0.4, 1.0); g.shake(_v, 1.0, 70);
      g.explosionDamage(_v, 7, 600, this, 500, false);
      if (this.isPlayerMech) g.hud.announce('机甲已着陆 —— 靠近并按 E 登机', 'good');
    }
    this.animate(dt);
  }

  // ---------- 玩家驾驶 ----------
  updatePiloted(dt, doomed) {
    const g = this.game, inp = g.ctl, p = g.player, cam = g.engine.camera;
    this.aimYaw = p.yaw; p.pitch = Math.max(-0.7, Math.min(0.75, p.pitch)); this.aimPitch = p.pitch;
    const f = (inp.down('KeyW') ? 1 : 0) - (inp.down('KeyS') ? 1 : 0), s = (inp.down('KeyD') ? 1 : 0) - (inp.down('KeyA') ? 1 : 0);
    const wish = _v.set(p.fwd.x * f + p.right.x * s, 0, p.fwd.z * f + p.right.z * s); const wl = wish.length(); if (wl > 0) wish.multiplyScalar(1 / wl);
    const v = this.vel;
    if (this.dashT > 0) this.dashT -= dt;
    else {
      const sp = Math.hypot(v.x, v.z); if (sp > 0.01) { const ns = Math.max(0, sp - Math.max(sp, 2) * 5 * dt); v.x *= ns / sp; v.z *= ns / sp; }
      const max = doomed ? 3.5 : 6.6; const cur = v.x * wish.x + v.z * wish.z; const add = max - cur; if (wl > 0 && add > 0) { const a = Math.min(34 * dt, add); v.x += wish.x * a; v.z += wish.z * a; }
      if (inp.hit('ShiftLeft') && this.dash >= 1 && wl > 0 && !doomed) { this.dash -= 1; this.dashT = 0.3; v.x = wish.x * 22; v.z = wish.z * 22; g.audio.play('mech_dash'); g.fx.dustPuff(this.pos, 14, 2.4, g.fx.dustCol, 7); p.shake = Math.min(1, p.shake + 0.4); }
    }
    v.y -= 24 * dt;
    // 碰撞（仅大型结构）
    const dist = v.length() * dt; const steps = Math.max(1, Math.ceil(dist / 0.5));
    for (let i = 0; i < steps; i++) {
      this.pos.addScaledVector(v, dt / steps);
      _v2.set(this.pos.x, this.pos.y + 1.5, this.pos.z); _v3.set(this.pos.x, this.pos.y + 4.3, this.pos.z); _v4.copy(_v2);
      const res = g.world.collideCapsule(_v2, _v3, 1.5, true, true);
      if (res.any) { _v4.subVectors(_v2, _v4); this.pos.add(_v4); const l = _v4.length(); if (l > 1e-6) { _v4.multiplyScalar(1 / l); const vn = v.dot(_v4); if (vn < 0) v.addScaledVector(_v4, -vn); } }
    }
    this.moveSp = Math.hypot(v.x, v.z);
    // 腿的朝向：行进时跟随瞄准方向；站定时上身可以单独扭到 ±40° 左右，超过才挪脚转身（脚钉在地上，不再原地打滑转圈）
    { const dy = angDiff(this.aimYaw, this.legYaw); if (this.moveSp > 0.6) this.turning = true; else if (Math.abs(dy) > 0.7) this.turning = true; else if (Math.abs(dy) < 0.08) this.turning = false;
      if (this.turning) this.legYaw += dy * Math.min(1, dt * (this.moveSp > 0.6 ? 5 : 3.2)); }
    this.walkDir = (v.x * p.fwd.x + v.z * p.fwd.z) >= -0.5 ? 1 : -1;
    // 踩踏
    if (this.moveSp > 1.5) for (const a of g.actors) { if (a.alive && a.team !== this.team && a.kind !== 'drone') { const dx = a.pos.x - this.pos.x, dz = a.pos.z - this.pos.z; if (dx * dx + dz * dz < 4.4) a.takeDamage(999, p, { dir: _v2.set(dx, 0, dz).normalize(), stomp: true }); } }
    if (!doomed) {
      // 主炮
      if (inp.down('Mouse0') && this.cool <= 0 && this.reloadT < 0 && this.laserT < 0) { if (this.mag > 0) this.fireCannon(this.aimTarget(_v)); else { this.reloadT = 0; g.audio.play('reload_out', { pitch: 0.6 }); } }
      if (inp.hit('KeyR') && this.mag < 10 && this.reloadT < 0) { this.reloadT = 0; g.audio.play('reload_out', { pitch: 0.6 }); }
      if (inp.hit('Mouse2') && this.rocketCD <= 0) { this.salvo = 8; this.salvoT = 0; this.rocketCD = 9; }
      if (inp.hit('KeyF') && this.punchT < 0) this.punch(p);
      if (inp.hit('KeyX') && this.core >= 1 && this.laserT < 0) { this.laserT = 0; this.core = 0; g.hud.announce('熔毁核心 · 启动', 'good'); g.audio.play('mech_ready'); }
      this.core = Math.min(1, this.core + dt / 140);
      if (inp.down('KeyE')) { this.exitHold += dt; if (this.exitHold > 0.45) { this.exitHold = 0; g.disembark(this); return; } } else this.exitHold = 0;
    }
    if (this.punchT >= 0) { this.punchT += dt; if (this.punchT > 0.7) this.punchT = -1; }
    this.updateLaser(dt, p);
    // 座舱视角
    this.model.root.updateMatrixWorld(true);
    this.model.eye.getWorldPosition(_v);
    const sh = p.shake * p.shake; const t = g.time * 31;
    // 眼睛跟着机体起伏（步态里骨盆的沉浮），但只取一半：另一半留给座舱内饰相对视线的晃动
    if (this.camY === null || Math.abs(this.camY - _v.y) > 1.5) this.camY = _v.y; this.camY = damp(this.camY, _v.y, 7, dt); const cy = this.camY + (_v.y - this.camY) * 0.5;
    cam.position.set(_v.x + Math.sin(t) * sh * 0.12, cy + Math.sin(t * 1.3) * sh * 0.12, _v.z);
    p.shake = damp(p.shake, 0, 5, dt); p.recoilPitch = damp(p.recoilPitch, 0, 7, dt);
    cam.rotation.set(p.pitch + p.recoilPitch + Math.sin(t * 1.7) * sh * 0.02, p.yaw, this.gait.roll * 0.45 - this.gait.sway * 0.06);
    const nf = damp(cam.fov, 82 + (this.dashT > 0 ? 8 : 0), 8, dt); if (Math.abs(nf - cam.fov) > 0.01) { cam.fov = nf; cam.updateProjectionMatrix(); }
    p.pos.copy(this.pos); p.vel.copy(v); p.eyePos.copy(cam.position);
    g.audio.loop('mech_hum', true, { volume: 0.35 + Math.min(0.3, this.moveSp * 0.04), pitch: 0.9 + this.moveSp * 0.02 });
  }

  aimTarget(out) {
    const g = this.game, p = g.player; const h = g.hitscan(g.engine.camera.position, p.look, 300, this);
    if (h && h.dist > 4) return out.copy(h.point); return out.copy(g.engine.camera.position).addScaledVector(p.look, 200);
  }
  muzzlePos(out) { this.model.muzzle.updateWorldMatrix(true, false); return out.setFromMatrixPosition(this.model.muzzle.matrixWorld); }

  fireCannon(target) {
    const g = this.game; this.cool = this.piloted ? 0.4 : 0.55; this.mag--; this.recoil = 1;
    const mz = this.muzzlePos(_v2); const dir = _v3.subVectors(target, mz).normalize();
    g.spawnProjectile({ kind: 'shell', pos: mz, vel: dir.clone().multiplyScalar(140), team: this.team, owner: this.piloted ? g.player : this, mech: this, dmg: 150, mechDmg: 260, radius: 3.6, life: 3 });
    const dist = mz.distanceTo(target);
    g.fx.muzzleFlash(mz, dir, 4.5); g.fx.flashLight(mz, [1, 0.7, 0.35], 160, 0.09, 26); g.fx.dustPuff(_v4.set(this.pos.x, this.pos.y, this.pos.z), 3, 1.6);
    if (this.piloted) { g.audio.play('mech_cannon'); g.player.recoilPitch += 0.022; g.player.shake = Math.min(1, g.player.shake + 0.3); } else g.audio.play('mech_cannon', { x: mz.x, y: mz.y, z: mz.z });
    // 表现：炮管加速旋转、炮口升温、制退器喷焰、粗曳光、抛壳
    this.spinV = Math.min(36, this.spinV + 14); this.heat = Math.min(1, this.heat + 0.2); this.kick = 1;
    const right = _v4.set(Math.cos(this.aimYaw), 0, -Math.sin(this.aimYaw));
    g.fx.mechMuzzle(mz, dir, right); g.fx.tracer(mz, _v5.copy(mz).addScaledVector(dir, Math.min(300, dist + 8)), 0xffc890, 140, 0.22, 14);
    this.ejectCase(right);
  }
  ejectCase(right) {
    const g = this.game, m = this.model; if (!m.glb || g.engine.camera.position.distanceToSquared(this.pos) > 90 * 90) return;
    let c = null; for (const x of this.cases) if (!x.on) { c = x; break; }
    if (!c) { if (this.cases.length < 6) { c = { m: caseMesh(), v: new THREE.Vector3(), w: new THREE.Vector3(), on: false, life: 0, b: 0 }; g.engine.scene.add(c.m); this.cases.push(c); } else c = this.cases[this.caseI = (this.caseI + 1) % 6]; }
    m.anchors.eject.updateWorldMatrix(true, false); c.m.position.setFromMatrixPosition(m.anchors.eject.matrixWorld);
    const k = rnd(4, 6.5); c.v.set(right.x * k + this.vel.x * 0.5, rnd(2.6, 4.2), right.z * k + this.vel.z * 0.5); c.w.set(rnd(-10, 10), 0, rnd(-10, 10));
    c.on = true; c.life = 2.6; c.b = 0; c.m.visible = true; c.m.rotation.set(rnd(0, 6), rnd(0, 6), rnd(0, 6));
    g.fx.steam(c.m.position, right.x * 2, 0.6, right.z * 2, 0.7, 0.22);
  }
  fireRocket() {
    const g = this.game, m = this.model; m.pod.updateWorldMatrix(true, false); const o = _v2.setFromMatrixPosition(m.pod.matrixWorld);
    if (m.glb) { const i = this.tube++ % 8; o.add(_v5.set(((i % 4) - 1.5) * 0.225, i < 4 ? 0.135 : -0.135, 0).applyQuaternion(m.torso.getWorldQuaternion(_q))); }   // 八个发射筒轮流出弹
    let tgt; if (this.piloted) tgt = this.aimTarget(_v); else if (this.target && this.target.alive !== false) tgt = this.target.aimPoint(_v); else return;
    const dir = _v3.subVectors(tgt, o).normalize(); dir.x += rnd(-0.05, 0.05); dir.y += rnd(0.0, 0.07); dir.z += rnd(-0.05, 0.05); dir.normalize();
    g.spawnProjectile({ kind: 'rocket', pos: o, vel: dir.clone().multiplyScalar(62), team: this.team, owner: this.piloted ? g.player : this, mech: this, dmg: 95, mechDmg: 150, radius: 3.2, life: 4, homing: tgt.clone() });
    g.audio.play('mech_rocket', this.piloted ? { volume: 0.8 } : { x: o.x, y: o.y, z: o.z }); g.fx.muzzleFlash(o, dir, 2);
    this.lidT = 0.8; this.lid = Math.max(this.lid, 0.75); g.fx.backblast(_v5.copy(o).addScaledVector(dir, -1.4), dir); g.fx.flashLight(o, [1, 0.6, 0.3], 60, 0.08, 14);
  }
  punch(p) {
    const g = this.game; this.punchT = 0; this.punchFx = true; g.audio.play('mech_melee', this.piloted ? {} : { x: this.pos.x, y: this.pos.y + 3, z: this.pos.z });
    const fx = -Math.sin(this.aimYaw), fz = -Math.cos(this.aimYaw);
    for (const e of g.enemiesOf(this.team)) { if (e.alive === false) continue; const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z; const d = Math.hypot(dx, dz); if (d < (e.kind === 'mech' ? 6.2 : 5) && (dx * fx + dz * fz) / Math.max(d, 0.1) > 0.4) { e.takeDamage(e.kind === 'mech' ? 650 : 999, this.piloted ? p : this, { dir: _v.set(fx, 0, fz), melee: true }); g.fx.sparks(e.aimPoint(_v2), null, 20, [1.8, 1.2, 0.5], 9); if (this.piloted) { g.hud.hitMarker(false, e.alive === false); this.core = Math.min(1, this.core + 0.12); } } }
    g.shake(this.pos, 0.6, 25);
  }
  updateLaser(dt, p) {
    const g = this.game, m = this.model; if (this.laserT < 0) { if (this.beamA) { this.releaseBeams(); g.audio.loop('mech_laser', false); } return; }
    this.laserT += dt;
    // 光束从胸口的核心发射口射出（程序化模型没有这个锚点，用眼睛下方）
    let o; if (m.anchors) { m.anchors.core.updateWorldMatrix(true, false); o = _v2.setFromMatrixPosition(m.anchors.core.matrixWorld); } else { m.eye.updateWorldMatrix(true, false); o = _v2.setFromMatrixPosition(m.eye.matrixWorld); o.y -= 0.55; }
    const res = g.hitscanAll(g.engine.camera.position, p.look, 260, this);
    for (const h of res.hits) { h.ent.takeDamage(h.ent.kind === 'mech' ? 1100 * dt : 600 * dt, p, { point: h.point, dir: p.look }); if (Math.random() < 0.5) g.fx.sparks(h.point, null, 4, [2, 1.2, 0.5], 8); }
    if (!this.beamA) { this.beamA = g.fx.beam(o, res.end, [1.0, 0.45, 0.15], 0.9, 1, 7); this.beamB = g.fx.beam(o, res.end, [1, 0.95, 0.8], 0.28, 1, 16); this.beamA.hold = true; this.beamB.hold = true;
      this.arcs = [0, 1, 2].map(() => { const a = g.fx.beam(o, res.end, [1.0, 0.7, 0.35], 0.07, 1, 12); a.hold = true; return a; }); }
    this.beamA.a.copy(o); this.beamA.b.copy(res.end); this.beamB.a.copy(o); this.beamB.b.copy(res.end); this.beamA.w = 0.9 + Math.sin(g.time * 60) * 0.15; this.beamB.w = 0.28 + Math.sin(g.time * 47) * 0.05;
    // 沿光束边缘爬行的电弧：每帧换一段位置
    const d = _v5.subVectors(res.end, o); const len = d.length(); d.multiplyScalar(1 / Math.max(0.01, len));
    for (const a of this.arcs) { const t0 = Math.random() * Math.min(len, 60), sl = rnd(1.5, 5); a.a.copy(o).addScaledVector(d, t0).add(_v6.set(rnd(-0.45, 0.45), rnd(-0.45, 0.45), rnd(-0.45, 0.45))); a.b.copy(o).addScaledVector(d, Math.min(len, t0 + sl)).add(_v6.set(rnd(-0.45, 0.45), rnd(-0.45, 0.45), rnd(-0.45, 0.45))); a.w = rnd(0.04, 0.1); }
    if (res.world) { g.fx.sparks(res.end, res.normal, 5, [2.2, 1.2, 0.5], 10); if (Math.random() < 0.3) g.fx.impact(res.end, res.normal, res.surf, 2.5); g.fx.flashLight(res.end, [1, 0.5, 0.2], 90, 0.1, 14); }
    g.fx.add.spawn({ x: res.end.x, y: res.end.y, z: res.end.z, vx: 0, vy: 0, vz: 0, life: 0.08, s0: 3.5, s1: 2, r: 2.6, g: 1.3, b: 0.5, a: 1, tile: 6 });
    g.fx.molten(res.end, res.world ? res.normal : null, dt);
    g.fx.add.spawn({ x: o.x, y: o.y, z: o.z, vx: 0, vy: 0, vz: 0, life: 0.05, s0: rnd(1.6, 2.4), s1: 1.2, r: 3.2, g: 1.7, b: 0.6, a: 1, tile: 3 });   // 发射口的耀斑
    p.shake = Math.min(1, p.shake + dt * 1.6); g.audio.loop('mech_laser', true, { volume: 0.9 });
    if (this.laserT > 5) this.laserT = -1;
  }

  // ---------- AI ----------
  updateAI(dt) {
    const g = this.game, nav = g.nav; this.think -= dt; this.repath -= dt; this.pause -= dt;
    if (this.think <= 0) {
      this.think = 0.5; let best = null, bs = 1e9; this.aimPoint(_v);
      for (const c of g.enemiesOf(this.team)) { if (c.alive === false) continue; c.aimPoint(_v2); const d = _v.distanceTo(_v2); if (d > (this.isPlayerMech ? 55 : 95)) continue; let s = d * (c.kind === 'mech' ? 0.5 : c.isPlayer ? 0.8 : 1.3); if (c === this.target) s *= 0.7; if (s < bs && !g.world.blocked(_v, _v2)) { bs = s; best = c; } }
      if (best) this.target = best; else if (this.target && (this.target.alive === false || this.pos.distanceTo(this.target.pos) > 110)) this.target = null;
    }
    const tgt = this.target; let moving = false;
    if (tgt && tgt.alive !== false) {
      tgt.aimPoint(_v); const dx = _v.x - this.pos.x, dz = _v.z - this.pos.z; const dist = Math.hypot(dx, dz);
      const wantYaw = Math.atan2(-dx, -dz); const dy = angDiff(wantYaw, this.aimYaw); this.aimYaw += Math.sign(dy) * Math.min(Math.abs(dy), 1.5 * dt);
      this.aimPitch = damp(this.aimPitch, Math.atan2(_v.y - (this.pos.y + 3.5), Math.max(3, dist)), 4, dt);
      if (!this.isPlayerMech) { if (dist > 42 && this.repath <= 0) { this.setPath(_v.x, _v.z); this.repath = 2.5; } else if (dist < 16 && this.repath <= 0) { const q = nav.randomNear(this.pos.x - dx / dist * 14, this.pos.z - dz / dist * 14, 8, true); if (q) this.setPath(q.x, q.z); this.repath = 3; } moving = this.followPath(dt, 4.4); }
      if (Math.abs(dy) < 0.12 && this.cool <= 0 && this.reloadT < 0 && this.pause <= 0) {
        if (this.mag <= 0) this.reloadT = 0;
        else {
          if (this.burst <= 0) this.burst = 3; this.burst--; if (this.burst <= 0) this.pause = rnd(1.6, 2.8);
          const tv = tgt.vel || _v3.set(0, 0, 0); const tt = dist / 140; const err = dist * 0.03 * (tgt.isPlayer ? 1.0 + Math.hypot(tgt.vel.x, tgt.vel.z) * 0.12 : 1);
          _v4.copy(_v).addScaledVector(tv, tt * 0.7); _v4.x += rnd(-err, err); _v4.z += rnd(-err, err); if (!tgt.kind || tgt.kind !== 'mech') _v4.y = Math.max(tgt.pos.y + 0.2, _v4.y - 0.9);
          this.fireCannon(_v4);
        }
      }
      if (tgt.kind === 'mech' && this.rocketCD < 0.45 && dist < 70) this.lidT = Math.max(this.lidT, 0.15);   // 对机甲必定齐射：提前开盖
      if (this.rocketCD <= 0 && dist < 70 && (tgt.kind === 'mech' || Math.random() < 0.3)) { this.salvo = 5; this.salvoT = 0; this.rocketCD = rnd(11, 16); } else if (this.rocketCD <= 0) this.rocketCD = 3;
      if (tgt.kind === 'mech' && dist < 6 && this.punchT < 0 && Math.abs(dy) < 0.5) this.punch(null);
    } else if (!this.isPlayerMech) {
      if (!this.path && this.repath <= 0) { const q = nav.randomPoint(true); if (q) this.setPath(q.x, q.z); this.repath = 4; }
      moving = this.followPath(dt, 3.6); if (moving) { const wy = Math.atan2(-this.vx, -this.vz); this.aimYaw += angDiff(wy, this.aimYaw) * Math.min(1, dt * 1.5); } this.aimPitch = damp(this.aimPitch, 0, 2, dt);
    }
    if (this.punchT >= 0) { this.punchT += dt; if (this.punchT > 0.7) this.punchT = -1; }
    this.moveSp = damp(this.moveSp, moving ? 4.2 : 0, 6, dt); this.walkDir = 1;
    if (moving) { this.legYaw += angDiff(Math.atan2(-this.vx, -this.vz), this.legYaw) * Math.min(1, dt * 3); for (const a of g.actors) { if (a.alive && a.team !== this.team && a.kind !== 'drone') { const dx = a.pos.x - this.pos.x, dz = a.pos.z - this.pos.z; if (dx * dx + dz * dz < 4) a.takeDamage(999, this, { stomp: true }); } }
      const pl = g.player; if (pl.alive && !pl.inMech && this.team === 1) { const dx = pl.pos.x - this.pos.x, dz = pl.pos.z - this.pos.z; if (dx * dx + dz * dz < 3.5 && pl.pos.y < this.pos.y + 2) pl.takeDamage(60, this, { dir: _v.set(dx, 0, dz).normalize() }); } }
    else this.legYaw += angDiff(this.aimYaw, this.legYaw) * Math.min(1, dt * 1.2);
    this.pos.y = damp(this.pos.y, nav.height(this.pos.x, this.pos.z), 10, dt);
  }
  setPath(x, z) { this.path = this.game.nav.findPath(this.pos.x, this.pos.z, x, z, true); this.pathI = 0; }
  followPath(dt, speed) {
    if (!this.path || this.pathI >= this.path.length) { this.path = null; return false; }
    const w = this.path[this.pathI]; const dx = w.x - this.pos.x, dz = w.z - this.pos.z; const d = Math.hypot(dx, dz);
    if (d < 1.2) { this.pathI++; return this.pathI < this.path.length; }
    this.vx = dx / d; this.vz = dz / d; const nx = this.pos.x + this.vx * speed * dt, nz = this.pos.z + this.vz * speed * dt;
    if (this.game.nav.walkable(nx, nz, true)) { this.pos.x = nx; this.pos.z = nz; } else { this.path = null; return false; }
    return true;
  }

  // ---------- 动画 ----------
  animate(dt) {
    const m = this.model, g = this.game, G = this.gait, p = g.player; const run = Math.min(1, this.moveSp / 5.5), idle = 1 - run;
    // 步态：按这一帧机体实际走过的位移驱动，脚落地后钉在世界坐标上
    let vx = (this.pos.x - this._px) / Math.max(dt, 1e-4), vz = (this.pos.z - this._pz) / Math.max(dt, 1e-4); this._px = this.pos.x; this._pz = this.pos.z;
    if (vx * vx + vz * vz > 45 * 45) { vx = 0; vz = 0; G.inited = false; }
    // 待机的玩家机甲：驾驶员走近时略微下蹲并打开座舱盖
    let ho = 0; if (this.isPlayerMech && !this.piloted && this.state === 'idle' && p.alive && !p.inMech) { const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z; if (dx * dx + dz * dz < 11 * 11) ho = 1; }
    this.kneel = damp(this.kneel || 0, ho, 3, dt);
    if (this.piloted !== this.wasPiloted) {   // 登机：舱盖合上；离舱 / 弹射：舱盖弹开并喷出一股蒸汽
      this.wasPiloted = this.piloted;
      if (this.piloted) { this.hatchO = 0; this.hatchT = 0; this.embarkT = 0; this.camY = null; }
      else { this.hatchO = 1; this.hatchT = 1.5; this.embarkT = -1; if (m.hatch) { m.hatch.getWorldPosition(_v); for (let i = 0; i < 6; i++) g.fx.steam(_v, rnd(-2, 2), rnd(1, 3), rnd(-2, 2), 1.2, 0.3); } }
    }
    if (this.hatchT > 0) { this.hatchT -= dt; ho = 1; }
    this.hatchO = this.piloted ? 0 : damp(this.hatchO, ho, 4.5, dt);
    const air = this.state === 'drop' || this.pos.y - g.nav.height(this.pos.x, this.pos.z) > 1.3;
    const ev = G.update(dt, { pos: this.pos, yaw: this.legYaw, vx, vz, crouch: this.crouch + this.kneel * 0.22, mode: air ? 'air' : (this.dashT > 0 || vx * vx + vz * vz > 100) ? 'skid' : 'walk', height: this._h });
    for (const e of ev) {   // 落脚：扬尘、闷响、震屏
      _v.set(e.x, e.y + 0.05, e.z); g.fx.dustPuff(_v, 6, 1.5, g.fx.dustCol, 3.5); g.fx.stomp(_v, e.w);
      if (this.piloted) { g.audio.play('mech_step', { volume: 0.8 * e.w }); p.shake = Math.min(1, p.shake + 0.16 * e.w); } else { g.audio.play('mech_step', { x: _v.x, y: _v.y, z: _v.z }); g.shake(_v, 0.28 * e.w, 28); }
    }
    G.pose(m);
    // 上身：随瞄准转动（抵消扭髋）、落脚点头、后坐、液压“呼吸”
    const br = Math.sin(this.t * 1.15), c = this.crouch;
    const pt = this.punchT; const ext = pt < 0 ? 0 : pt < 0.07 ? -0.3 * (pt / 0.07) : pt < 0.2 ? -0.3 + 1.3 * ease((pt - 0.07) / 0.13) : pt < 0.3 ? 1 : 1 - ease((pt - 0.3) / 0.4);   // 动力拳：后引 → 出拳 → 顶住 → 收回
    this.kick = damp(this.kick, 0, 14, dt);
    const doom = this.state === 'doomed' || this.state === 'ejected' ? 1 : 0;
    m.torso.rotation.set(-0.05 * run - c * 0.25 + this.hitFlash * 0.03 + this.recoil * 0.03 + br * 0.005 * idle + G.dip * 0.9, angDiff(this.aimYaw, this.legYaw) - G.twist - ext * 0.3 + this.recoil * 0.012, -G.roll * 0.7 - this.recoil * 0.012 + doom * Math.sin(this.t * 23) * 0.012);
    m.torso.position.y = 0.4 + br * 0.014 * idle;
    // 右臂机炮：俯仰、后坐、炮管旋转与过热；装填时炮身下压，弹鼓锁紧时一顿
    const rt = this.reloadT; const dipR = rt < 0 ? 0 : ease(rt / 0.4) * (1 - ease((rt - 1.85) / 0.45)); const jolt = rt > 1.15 && rt < 1.4 ? Math.sin((rt - 1.15) / 0.25 * Math.PI) * 0.05 : 0;
    // 第一人称：两臂向内、向上、向前收（像步兵的持枪视角），机炮和动力拳才进得了画面；登机 / 离舱时渐变。转向时武器略微滞后
    this.fpK = damp(this.fpK || 0, this.piloted ? 1 : 0, 5, dt); const fp = this.fpK;
    this.armLag = damp(this.armLag || 0, fp > 0.01 ? clamp(angDiff(this.aimYaw, this.aimPrev) / Math.max(dt, 1e-3) * 0.022, -0.07, 0.07) : 0, 9, dt);
    m.armR.rotation.x = this.aimPitch + this.recoil * 0.07 - dipR * 0.5 + jolt; m.armR.rotation.z = -dipR * 0.07; m.armR.rotation.y = fp * this.armLag;
    m.armR.position.set(1.5 - FP_R[0] * fp, 1.75 + FP_R[1] * fp, this.recoil * 0.25 - FP_R[2] * fp);
    this.spinV = damp(this.spinV, rt >= 0 ? 3 : 0, 1.5, dt); this.spin += this.spinV * dt; this.heat = Math.max(0, this.heat - dt * 0.16);
    if (m.barrel) { m.barrel.rotation.z = this.spin; m.barrel.position.z = this.kick * 0.2; }
    const near = g.engine.camera.position.distanceToSquared(this.pos) < 75 * 75;
    if (m.anchors && near) {
      const pr = this._rl === undefined ? -1 : this._rl;
      if (rt >= 0.15 && pr < 0.15) { m.anchors.eject.getWorldPosition(_v); for (let i = 0; i < 5; i++) g.fx.steam(_v, rnd(-1, 1), rnd(0.5, 2), rnd(-1, 1), 1.0, 0.3); }   // 开膛泄压
      if (rt >= 1.15 && pr < 1.15) { m.anchors.eject.getWorldPosition(_v); g.fx.sparks(_v, null, 10, [1.8, 1.3, 0.7], 5); }   // 弹鼓锁紧
      if (this.heat > 0.5 && Math.random() < dt * 16) { this.muzzlePos(_v); g.fx.steam(_v, 0, 1.2, 0, 0.5, 0.16 * this.heat, 0.6); }   // 炮口余烟
    }
    this._rl = rt;
    // 左臂动力拳
    const pu = Math.max(0, ext);
    if (m.glb) {
      m.armL.rotation.x = this.aimPitch * (0.5 + 0.5 * fp) - 0.1 * (1 - fp) + ext * 0.45 + G.twist * 0.6 * run * (1 - fp); m.armL.rotation.y = fp * (this.armLag * 0.8 - FP_L[3]);
      m.armL.position.set(-1.5 + FP_L[0] * fp, 1.75 + FP_L[1] * fp, -pu * 0.45 - FP_L[2] * fp); m.fistL.position.z = -pu * 0.9; m.foreL.rotation.x = Math.max(0, -ext) * 0.6;
      if (this.punchFx && pt >= 0.17) {
        this.punchFx = false; m.anchors.fist.getWorldPosition(_v); _v2.set(-Math.sin(this.aimYaw), 0, -Math.cos(this.aimYaw));
        g.fx.mechPunch(_v, _v2, this.pos.y); if (this.piloted) p.shake = Math.min(1, p.shake + 0.35);
      }
    } else { m.armL.rotation.x = this.aimPitch * 0.5 + pu * 0.9 - 0.1 + G.twist * 0.5 * run; m.armL.position.z = -pu * 1.1; }
    // 火箭巢盖：齐射时弹开，打完后缓缓合上
    this.lidT -= dt; const lo = this.salvo > 0 || this.lidT > 0 ? 1 : 0; this.lid = damp(this.lid, lo, lo ? 26 : 4, dt);
    if (m.lidA) { m.lidA.rotation.x = this.lid * 1.8; m.lidB.rotation.x = -this.lid * 1.8; }
    if (m.hatch) { m.hatch.rotation.x = this.hatchO * 1.05; m.hatch.visible = !this.piloted; }
    // 传感器头：驾驶时略微领先转向；AI 盯着目标；待机时看向走近的驾驶员，否则来回扫视
    let hy;
    if (this.piloted) hy = clamp(angDiff(this.aimYaw, this.aimPrev) / Math.max(dt, 1e-3) * 0.16, -0.6, 0.6);
    else if (this.target && this.target.alive !== false) { this.target.aimPoint(_v); hy = clamp(angDiff(Math.atan2(-(_v.x - this.pos.x), -(_v.z - this.pos.z)), this.aimYaw), -1.2, 1.2); }
    else if (this.isPlayerMech && p.alive && !p.inMech) hy = clamp(angDiff(Math.atan2(-(p.pos.x - this.pos.x), -(p.pos.z - this.pos.z)), this.aimYaw), -1.3, 1.3);
    else hy = Math.sin(this.t * 0.6) * 0.7;
    this.aimPrev = this.aimYaw; this.headYaw = damp(this.headYaw, hy, 6, dt); if (m.head) m.head.rotation.y = this.headYaw;
    // 发光件：核心发射口随充能变亮（就绪后脉动、释放时白热），炮口过热发红，排气口随负荷变亮，濒毁时传感器闪烁
    if (this.own) {
      const k = this.laserT >= 0 ? 3.4 + Math.sin(this.t * 70) * 0.8 : this.core >= 1 ? 1.5 + Math.sin(this.t * 6) * 0.6 : 0.1 + this.core * 0.8;
      this.own.core.color.setRGB(1.0 * k, 0.38 * k, 0.1 * k);
      const h = this.heat * this.heat; this.own.heat.userData.mechU.uHeat.value.set(2.4 * h, 0.45 * h, 0.05 * h);
      const vk = 0.4 + 0.45 * run + (this.dashT > 0 ? 1.4 : 0) + br * 0.05; this.own.vent.color.setRGB(3.0 * vk, 1.1 * vk, 0.25 * vk);
      const ek = doom && Math.random() < 0.35 ? 0.08 : 1; this.own.eye.color.copy(this.glowCol).multiplyScalar(ek);
    }
    // 排气管的烟、冲刺时推进器的喷焰
    this.fxT -= dt;
    if (m.anchors && near && this.state !== 'drop') {
      if (this.fxT <= 0) { this.fxT = 0.24 - 0.13 * run; for (const a of [m.anchors.exhL, m.anchors.exhR]) { a.getWorldPosition(_v); g.fx.steam(_v, 0, 1.6 + run * 1.6, 0, 0.55 + run * 0.3, 0.13 + 0.1 * run + doom * 0.2, doom ? 0.1 : 0.22); } }
      if (this.dashT > 0) for (const a of [m.anchors.jetL, m.anchors.jetR]) { a.getWorldPosition(_v); for (let i = 0; i < 2; i++) g.fx.add.spawn({ x: _v.x, y: _v.y, z: _v.z, vx: -vx * 0.3 + rnd(-1, 1), vy: rnd(-6, -3), vz: -vz * 0.3 + rnd(-1, 1), life: rnd(0.1, 0.2), s0: rnd(0.7, 1.0), s1: 0.25, r: 1.2, g: 2.0, b: 3.2, a: 0.9, tile: 6, drag: 3 }); }
    }
    // 自己打出去的火箭：加粗尾焰和白烟尾迹（弹体的飞行与命中仍由 game.js 负责）
    for (const q of g.projectiles) {
      if (q.mech !== this || q.kind !== 'rocket') continue; const sp = Math.max(1, q.vel.length()), k = -1 / sp;
      g.fx.add.spawn({ x: q.pos.x + q.vel.x * k * 0.5, y: q.pos.y + q.vel.y * k * 0.5, z: q.pos.z + q.vel.z * k * 0.5, vx: 0, vy: 0, vz: 0, life: 0.07, s0: 1.5, s1: 0.5, r: 3.0, g: 1.5, b: 0.5, a: 1, tile: 6 });
      const gr = rnd(0.7, 0.86); g.fx.alpha.spawn({ x: q.pos.x + q.vel.x * k * 1.2, y: q.pos.y + q.vel.y * k * 1.2, z: q.pos.z + q.vel.z * k * 1.2, vx: rnd(-0.5, 0.5), vy: rnd(0.1, 0.7), vz: rnd(-0.5, 0.5), life: rnd(0.9, 1.4), s0: 0.45, s1: rnd(1.6, 2.4), r: gr, g: gr, b: gr, a: 0.42, tile: 1, drag: 1.2, ease: true, vrot: rnd(-0.8, 0.8) });
    }
    // 弹壳
    for (const cs of this.cases) {
      if (!cs.on) continue; cs.life -= dt; if (cs.life <= 0) { cs.on = false; cs.m.visible = false; continue; }
      cs.v.y -= 16 * dt; cs.m.position.addScaledVector(cs.v, dt); cs.m.rotation.x += cs.w.x * dt; cs.m.rotation.z += cs.w.z * dt;
      const fl = Math.max(g.nav.height(cs.m.position.x, cs.m.position.z), this.pos.y - 1.5) + 0.08;
      if (cs.m.position.y < fl) { cs.m.position.y = fl; if (cs.b++ === 0) g.audio.play('shell', { x: cs.m.position.x, y: fl, z: cs.m.position.z, volume: 0.5, pitch: 0.5 }); cs.v.y = -cs.v.y * 0.3; cs.v.x *= 0.5; cs.v.z *= 0.5; cs.w.multiplyScalar(0.4); if (cs.b > 2) { cs.v.set(0, 0, 0); cs.w.set(0, 0, 0); } }
    }
  }
}
