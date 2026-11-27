// 敌人：和影片同一个带骨骼的角色模型。
// 动画分两层：下半身（髋、腿、腰）放走/跑/站/跪的动捕，上半身（胸、头、双臂、手指）放持枪姿态（瞄准 / 低姿持枪）。
// 瞄准和倒地两段是从影片场景里烘焙出来的；走、跑、待机、跪姿是动捕重定向到这副骨架上的。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { LAYER } from './viewmodel.js';
import { Ragdoll } from './ragdoll.js';

// 敌人贴到枪口前一两米时，按平方反比会被枪灯照成一片死白（白天的手电不会这样）。
// 对没有截止距离的灯（枪灯）把衰减钳在 4 米：更近也只按 4 米处的亮度算；枪口火光（有截止距离）不受影响。
const FALLOFF = 'float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), 0.01 );';
function softNear(shader) {
  const chunk = THREE.ShaderChunk.lights_pars_begin;
  if (!chunk.includes(FALLOFF)) return;
  shader.fragmentShader = shader.fragmentShader.replace('#include <lights_pars_begin>',
    chunk.replace(FALLOFF, 'float distanceFalloff = 1.0 / max( pow( lightDistance, decayExponent ), cutoffDistance > 0.0 ? 0.01 : 16.0 );'));
}

const isLowerNode = (n) => /(Hips|UpLeg|Leg|Foot|ToeBase|Toe_End)/.test(n) || /Spine_/.test(n) || !/mixamorig/.test(n);
const LOOPS = { walk: THREE.LoopRepeat, run: THREE.LoopRepeat, idle: THREE.LoopPingPong, aim: THREE.LoopPingPong, kneel: THREE.LoopPingPong, ready: THREE.LoopRepeat, kneel_down: THREE.LoopOnce, fall_r: THREE.LoopOnce };

export class EnemyAsset {
  async load() {
    const [gltf, info] = await Promise.all([
      new Promise((res, rej) => new GLTFLoader().load('./assets/enemy/scene.gltf', res, undefined, rej)),
      fetch('./assets/enemy/clips.json').then((r) => r.json()).catch(() => ({})),
    ]);
    this.gltf = gltf; this.info = info;
    this.clips = {};
    for (const c of gltf.animations) this.clips[c.name] = c;
    // 游戏里循环用的干净瞄准片段（影片第 2–70 帧，没有开火和中弹）
    if (this.clips.aim) { this.clips.aim_full = this.clips.aim; this.clips.aim = THREE.AnimationUtils.subclip(this.clips.aim_full, 'aim', 0, 68, 30); }
    // 每个片段拆成上下两层
    this.lower = {}; this.upper = {};
    for (const [n, c] of Object.entries(this.clips)) {
      const lo = c.tracks.filter((t) => isLowerNode(t.name.split('.')[0])), up = c.tracks.filter((t) => !isLowerNode(t.name.split('.')[0]));
      this.lower[n] = new THREE.AnimationClip(n + '_lo', c.duration, lo);
      this.upper[n] = new THREE.AnimationClip(n + '_up', c.duration, up);
    }
    this.speed = { walk: info.walk?.speed || 1.0, run: info.run?.speed || 2.7 };
    gltf.scene.traverse((o) => {
      if (o.isMesh) { o.frustumCulled = false; o.layers.set(LAYER.DYN); }
    });
    return this;
  }
  spawn() { return new Enemy(this); }
}

class Layer {
  constructor(mixer, clips) {
    this.a = {}; this.w = {}; this.cur = null; this.fade = 0.2;
    for (const [n, c] of Object.entries(clips)) {
      const a = mixer.clipAction(c); a.clampWhenFinished = true; a.setLoop(LOOPS[n] ?? THREE.LoopRepeat, Infinity); a.enabled = true; a.setEffectiveWeight(0); a.play();
      this.a[n] = a; this.w[n] = 0;
    }
  }
  set(name, fade = 0.2, { restart = false, timeScale = null, startAt = null } = {}) {
    const a = this.a[name]; if (!a) return;
    if (this.cur !== name || restart) { if (restart || LOOPS[name] === THREE.LoopOnce) { a.reset(); a.setEffectiveWeight(this.w[name]); a.play(); } if (startAt != null) a.time = startAt; }
    if (timeScale != null) a.timeScale = timeScale;
    this.cur = name; this.fade = fade;
  }
  snap(name) { for (const n of Object.keys(this.w)) { this.w[n] = n === name ? 1 : 0; this.a[n].setEffectiveWeight(this.w[n]); } this.cur = name; }
  update(dt) {
    const st = this.fade > 0 ? dt / this.fade : 1; let sum = 0;
    for (const n of Object.keys(this.w)) { const tg = n === this.cur ? 1 : 0; this.w[n] += Math.max(-st, Math.min(st, tg - this.w[n])); sum += this.w[n]; }
    if (sum < 1e-4) { this.w[this.cur] = 1; sum = 1; }
    for (const n of Object.keys(this.w)) this.a[n].setEffectiveWeight(this.w[n] / sum);
  }
}

export class Enemy {
  constructor(asset) {
    this.asset = asset;
    this.root = new THREE.Group();                 // 站立点（three 坐标），角色局部 +Z 朝前
    this.model = SkeletonUtils.clone(asset.gltf.scene);
    this.root.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
    this.lo = new Layer(this.mixer, asset.lower); this.up = new Layer(this.mixer, asset.upper);
    this.lo.snap('aim'); this.up.snap('aim');
    this.mats = [];
    this.model.traverse((o) => {
      if (o.isMesh) {
        o.layers.set(LAYER.DYN); o.frustumCulled = false;
        if (!this.mats.includes(o.material)) { o.material = o.material.clone(); o.material.onBeforeCompile = softNear; o.material.customProgramCacheKey = () => 'softNear'; this.mats.push(o.material); }
      }
      if (o.name === 'E_Muzzle') this.muzzle = o;
      if (o.name === 'E_Breech') this.breech = o;
      if (o.name === 'GunAim') this.gunAim = o;
      if (o.name === 'GunReady') this.gunReady = o;
      if (o.isBone && /Hips/.test(o.name)) this.hips = o;
      if (o.isBone && /Spine2/.test(o.name)) this.chest = o;
      if (o.isBone && /Spine1/.test(o.name)) this.spine1 = o;
      if (o.isBone && /Spine_/.test(o.name)) this.spine0 = o;
      if (o.isBone && /Head$|Head_/.test(o.name) && !/Top/.test(o.name)) this.head = o;
    });
    if (this.gunAim) { this.gAimP = this.gunAim.position.clone(); this.gAimQ = this.gunAim.quaternion.clone(); }
    if (this.gunReady) { this.gRdyP = this.gunReady.position.clone(); this.gRdyQ = this.gunReady.quaternion.clone(); }
    // 克隆后材质按名字共享回来（同名材质共用一份克隆）
    const byName = {};
    this.model.traverse((o) => { if (o.isMesh) { const k = o.material.name; if (byName[k]) o.material = byName[k]; else byName[k] = o.material; } });
    this.mats = Object.values(byName);
    this.aimTarget = null; this.aimW = 0; this.bend = 0;
    this.rag = null;                                                          // 倒地后的布娃娃
    this.rc = 0; this.rcV = 0; this.rcY = 0; this.rcYV = 0; this.swT = Math.random() * 20; this.live = 1;      // 后坐、呼吸晃动
    // 上半身的持枪姿态是按"瞄准站姿"的腰部朝向做的。下半身换成走/跑/跪之后腰的朝向变了，上半身要按原来的朝向摆（否则枪会跟着仰起来或栽下去）。
    // 这里记下瞄准站姿里腰（下半身最上面那节脊柱）相对站立点的朝向。
    if (!asset.refSpineQ && this.spine0) {
      for (const L_ of [this.lo, this.up]) { const a = L_.a.aim; a.time = Math.min(a.getClip().duration, 58 / 30); }
      this.mixer.update(0); this.root.updateMatrixWorld(true);
      asset.refSpineQ = this.root.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(this.spine0.getWorldQuaternion(new THREE.Quaternion()));
      for (const L_ of [this.lo, this.up]) L_.a.aim.time = 0;
    }
  }
  setEnv(tex, intensity) { for (const m of this.mats) { if (!m.envMap) m.needsUpdate = true; m.envMap = tex; m.envMapIntensity = intensity; } }
  // 直接把某个片段定格到指定时间（演示/比对用）
  pose(name, t) {
    for (const L_ of [this.lo, this.up]) {
      L_.snap(name);
      for (const [n, a] of Object.entries(L_.a)) { if (n === name) { a.paused = true; a.time = Math.max(0, Math.min(a.getClip().duration, t)); } }
    }
    this.mixer.update(0); this._gun();
  }
  setLower(name, fade, o) { this.lo.set(name, fade, o); }
  setUpper(name, fade, o) { this.up.set(name, fade, o); }
  // 整个人换一个片段（倒地）
  playFull(name, fade = 0.16) { this.lo.set(name, fade, { restart: true, timeScale: 1 }); this.up.set(name, fade, { restart: true, timeScale: 1 }); }
  // 按移动速度选下半身：站 / 走 / 跑，并让步频跟上实际速度（脚不打滑）
  locomotion(speed, standClip = 'aim', backward = false) {
    const S = this.asset.speed;
    if (speed < 0.12) this.lo.set(standClip, 0.22, { timeScale: 1 });
    else if (speed < 2.05) this.lo.set('walk', 0.18, { timeScale: (backward ? -1 : 1) * Math.max(0.55, Math.min(1.9, speed / S.walk)) });
    else this.lo.set('run', 0.16, { timeScale: Math.max(0.8, Math.min(1.3, speed / S.run)) });
  }
  _gun() {
    if (!this.gunAim || !this.gRdyP) return;
    const k = this.up.w.ready || 0;
    this.gunAim.position.lerpVectors(this.gAimP, this.gRdyP, k); this.gunAim.quaternion.slerpQuaternions(this.gAimQ, this.gRdyQ, k);
  }
  // 倒地：开头被倒地动作带着，随后交给布娃娃。返回 false 表示骨架不认识（退回纯动画）
  startRagdoll(world, nav, opts) { const r = new Ragdoll(this, world, nav, opts); this.rag = r.bad ? null : r; return !!this.rag; }
  // 开一枪：枪口往上一跳，带一点左右（弹簧回正）
  kick(k = 1) { this.rcV += 0.5 * k; this.rcYV += (Math.random() - 0.5) * 0.5 * k; }
  _worldRot(bone, axis, ang) {      // 让某根骨头绕世界坐标里的一根轴转
    const P = bone.parent.getWorldQuaternion(_q3);
    bone.quaternion.premultiply(_q4.copy(P).invert().multiply(_q2.setFromAxisAngle(axis, ang)).multiply(P));
  }
  // 每帧：推进动画 → 持枪位置 → 把枪管拧向目标（上半身整体转，只动一节脊柱）
  update(dt) {
    const rag = this.rag;
    if (rag && rag.noAnim) { rag.step(dt); return; }
    this.lo.update(dt); this.up.update(dt);
    if (rag) rag.restoreAnim();
    // 动画混合器对"数值没变"的骨骼不会重写（静止姿态就是这样），所以每帧先把上一帧我们额外加的转动撤掉，免得越叠越多
    if (this._b1) { this.spine1.quaternion.copy(this._b1); this.chest.quaternion.copy(this._b2); }
    this.mixer.update(dt);
    if (this.spine1 && this.chest) { (this._b1 || (this._b1 = new THREE.Quaternion())).copy(this.spine1.quaternion); (this._b2 || (this._b2 = new THREE.Quaternion())).copy(this.chest.quaternion); }
    this._gun();
    const kStab = (this.up.w.aim || 0) + (this.up.w.ready || 0);
    if (kStab > 0.01 && this.spine0 && this.spine1 && this.asset.refSpineQ) {
      this.root.updateMatrixWorld(true);
      const qs = _q3.copy(this.root.getWorldQuaternion(_q1)).invert().multiply(this.spine0.getWorldQuaternion(_q2));      // 腰现在相对站立点的朝向
      const tgt = _q4.copy(this.asset.refSpineQ).slerp(qs, 0.3);                                                          // 留三成跟着下半身晃
      const d = _q1.copy(qs).invert().multiply(tgt);
      this.spine1.quaternion.premultiply(_q2.identity().slerp(d, Math.min(1, kStab)));
    }
    if (this.bend && this.spine1) this.spine1.rotateX(this.bend);          // 被闪光弹晃到：弓背低头
    if (this.aimTarget && this.aimW > 0.01 && this.spine1 && this.muzzle && this.breech) {
      this.root.updateMatrixWorld(true);
      const mz = this.muzzle.getWorldPosition(_v1), br = this.breech.getWorldPosition(_v2);
      const cur = _v3.subVectors(mz, br).normalize(), want = _v4.subVectors(this.aimTarget, mz).normalize();
      const q = _q1.setFromUnitVectors(cur, want);
      const ang = 2 * Math.acos(Math.min(1, Math.abs(q.w))), lim = 0.75;
      const f = this.aimW * (ang > lim ? lim / ang : 1);
      _q2.identity().slerp(q, f);
      const P = this.spine1.parent.getWorldQuaternion(_q3);
      this.spine1.quaternion.premultiply(_q4.copy(P).invert().multiply(_q2).multiply(P));
    }
    if (rag) { rag.cacheAnim(); rag.step(dt); return; }
    // 活人不会一动不动：呼吸带着枪口轻微起伏、慢慢晃；每开一枪上身往后一震
    this.rcV += (-300 * this.rc - 26 * this.rcV) * dt; this.rc += this.rcV * dt; this.rcYV += (-260 * this.rcY - 24 * this.rcYV) * dt; this.rcY += this.rcYV * dt;
    if (this.spine1 && this.live > 0) {
      this.swT += dt; const t = this.swT;
      const pit = (Math.sin(t * 1.75) * 0.007 + Math.sin(t * 0.61 + 1.3) * 0.005) * this.live - this.rc, yw = (Math.sin(t * 0.47 + 0.6) * 0.007 + Math.sin(t * 1.13) * 0.003) * this.live + this.rcY;
      this.root.updateMatrixWorld(true); const rq = this.root.getWorldQuaternion(_q1);
      this._worldRot(this.spine1, _v1.set(1, 0, 0).applyQuaternion(rq), pit); this._worldRot(this.spine1, _v2.set(0, 1, 0), yw);
      if (this.chest && Math.abs(this.rc) > 1e-4) this._worldRot(this.chest, _v1, -this.rc * 0.5);
    }
  }
  muzzleWorld(out = new THREE.Vector3()) { return this.muzzle ? this.muzzle.getWorldPosition(out) : this.root.getWorldPosition(out); }
  barrelDir(out = new THREE.Vector3()) { return out.subVectors(this.muzzle.getWorldPosition(_v1), this.breech.getWorldPosition(_v2)).normalize(); }
  hipsWorld(out = new THREE.Vector3()) { return this.hips.getWorldPosition(out); }
  chestWorld(out = new THREE.Vector3()) { return this.chest.getWorldPosition(out); }
  headWorld(out = new THREE.Vector3()) { return this.head.getWorldPosition(out); }
}
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _q4 = new THREE.Quaternion();
