// 第一人称手臂 + 枪。两把枪（格洛克 17、M4A1）出自同一位作者、同一副手臂骨架，各带一整条动画（开枪 / 两种换弹 / 掏枪）。
// 这里做四件事：
//   1. 把那条动画按段切开，并在时间上抹平——原始动画是稀疏关键帧之间直线插值，换弹里有一帧转十几度的突变，看起来就是"跳帧"；
//   2. 肩膀钉在身体上，手腕跟着枪走，上臂和小臂用两段骨骼的反解算出来（枪收近、抬起、后坐时手肘会自己弯）；
//   3. 开枪时的细节：套筒 / 枪机往复、空仓挂机、扳机和食指扣动、抛壳窗防尘盖；
//   4. 两把枪切换，扔闪光弹时左手离枪。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { L } from './world.js';

export const LAYER = { STATIC: 0, DYN: 1, VM: 2 };
const WL_K = 0.34;      // 影片里枪灯的实测亮度约为标称功率的 1/3
const FR = 60;          // 抹平之后重新采样的帧率

// 摆放用的坐标都是"躯干局部、Blender 约定"（+Y 前，+Z 上，+X 右），和 player.js 里一致
export const WEAPONS = [
  {
    id: 'pistol', name: 'G17', url: './assets/vm/scene.gltf', mag: 17, auto: false, interval: 0.105, dmg: 1,
    idle: 0.4, segs: { fire: [0, 0.4, 0.008], reload: [0.4, 2.8, 0.042], reloadEmpty: [3.2, 5.87, 0.042] },
    speed: { reload: 1.25, reloadEmpty: 1.2 }, keepSlide: { reload: true },
    cues: { reload: [['mag_out', 0.27], ['mag_in', 1.0]], reloadEmpty: [['mag_out', 0.28], ['mag_in', 0.86], ['slide', 1.58]] },
    slide: { node: 'g17_slide', tBack: 0.1, cycle: 0.085 }, trig: { nodes: ['g17_trigger', 'R_point2'], t: 2 / 30 },
    muzzleRe: /slide_07/, boreRe: /Barrel/, base: 'g17_base', sound: 'pistol', gain: 9.0, flash: 1, shellV: 1, shellS: 1,
    off: [0, 0.035, 0],                                     // 模型在手臂组里的固定偏移（和影片一致）
    hip: [0.0, -0.30, 0.035], ads: [0.0, -0.016, -0.40],     // 端枪时整体往镜头方向收多少；举枪瞄准时瞄准线的左右、高低和枪口离镜头多远（镜头坐标，-Z 前）
    wall: 0.80, recoil: { rot: 300, back: 0.95, yaw: 55, w: 24, z: 0.58, pivot: 'wrist' }, camKick: 1,
    sprint: [0.03, -0.03, -0.035, -11, 16, 13], lowered: [0, -0.03, -0.05, -8, 0, 0], downFwd: 0,      // 姿势偏移：[右, 前, 上, 俯仰°, 侧倾°, 左转°]
  },
  {
    id: 'rifle', name: 'M4A1', url: './assets/vm_m4/scene.gltf', mag: 30, auto: true, interval: 0.085, dmg: 1,
    idle: 0.0, segs: { fire: [0, 0.33, 0.008], reload: [2.43, 3.6, 0.04], reloadEmpty: [0.43, 2.33, 0.04] },
    speed: { reload: 1.0, reloadEmpty: 1.0 }, keepSlide: {},
    cues: { reload: [['mag_out', 0.36], ['mag_in', 1.05]], reloadEmpty: [['mag_out', 0.36], ['mag_in', 1.08], ['slide', 1.44]] },
    slide: { node: 'm4a1_bolt', tBack: 2 / 30, cycle: 0.06, follow: ['m4a1_forwardassistassembly'] }, trig: { nodes: ['m4a1_trigger', 'R_point2'], t: 2 / 30 },
    port: { node: 'm4a1_ejectionport', t: 2 / 30 },
    muzzleRe: /flashhider/, boreRe: /flashhider/, base: 'm4a1_base', sound: 'rifle', gain: 6.5, flash: 1.5, shellV: 1.25, shellS: 1.5,
    off: [0, 0, 0],
    hip: [0.075, -0.33, -0.065], ads: [0.0, -0.034, -0.84],
    wall: 1.12, recoil: { rot: 62, back: 0.55, yaw: 22, w: 21, z: 0.62, pivot: 'stock' }, camKick: 0.55,
    sprint: [-0.03, -0.03, -0.015, 9, 26, 30], lowered: [0, -0.02, -0.04, -9, 0, 0], downFwd: 0.19,
  },
];

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3(), _v5 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _s1 = new THREE.Vector3(), _m1 = new THREE.Matrix4();
const sstep = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const worldQ = (o, out) => { o.matrixWorld.decompose(_v5, out, _s1); return out; };
// 让骨骼在世界空间里再转 qW（转成它的局部转动）
function rotWorld(bone, qW) { worldQ(bone.parent, _q2); bone.quaternion.premultiply(_q3.copy(_q2).invert().multiply(qW).multiply(_q2)); }

class Gun {
  constructor(def) { this.def = def; this.ammo = def.mag; this.locked = false; this.portOpen = false; }

  async load() {
    const def = this.def;
    const gltf = await new Promise((res, rej) => new GLTFLoader().load(def.url, res, undefined, rej));
    const root = this.root = gltf.scene; root.position.set(def.off[0], def.off[2], -def.off[1]);
    this.mats = []; const byName = {};
    root.traverse((o) => {
      byName[o.name] = o;
      if (!o.isMesh) return;
      o.layers.set(LAYER.VM); o.frustumCulled = false;
      const m = o.material; if (this.mats.includes(m)) return; this.mats.push(m);
      if (m.name && m.name.startsWith('arms')) { m.color.setScalar(2.6); if (m.normalScale) m.normalScale.setScalar(1.5); }
      if (m.name && m.name.startsWith('Body.Mat3')) m.color.setScalar(0.3);        // M4 的枪托是沙色的，贴着镜头时一大片很抢眼，压成深色     // 袖子/手套贴图偏黑，和影片一样提亮；布纹压深一点
      m.envMapIntensity = 1.0;
    });
    const find = (pre) => { let hit = null; root.traverse((o) => { if (!hit && (o.name === pre || o.name.startsWith(pre))) hit = o; }); return hit; };
    this.find = find; this.base = find(def.base);
    // ---- 动画轨道 → 逐节点
    const clip = gltf.animations[0], idx = new Map(); this.nodes = [];
    const tracks = [];
    for (const tr of clip.tracks) {
      const pp = THREE.PropertyBinding.parseTrackName(tr.name), node = THREE.PropertyBinding.findNode(root, pp.nodeName); if (!node) continue;
      if (!idx.has(node)) { idx.set(node, this.nodes.length); this.nodes.push({ o: node, P: false, Q: false, S: false }); }
      const ni = idx.get(node), n = this.nodes[ni], kind = pp.propertyName === 'position' ? 'P' : pp.propertyName === 'quaternion' ? 'Q' : 'S';
      n[kind] = true; tracks.push({ ni, kind, it: tr.createInterpolant() });
    }
    this.tracks = tracks; this.idx = idx; const N = this.N = this.nodes.length;
    this.rest = this._buf(); this.nodes.forEach((n, i) => { n.o.position.toArray(this.rest.P, i * 3); n.o.quaternion.toArray(this.rest.Q, i * 4); n.o.scale.toArray(this.rest.S, i * 3); });
    this.idle = this._bake(def.idle, def.idle, 0).frames[0];
    this.segs = {}; for (const [k, [t0, t1, sg]] of Object.entries(def.segs)) this.segs[k] = this._bake(t0, t1, sg);
    this.cur = this._buf(); this.from = this._buf(); this.tgt = this._buf(); this._copy(this.idle, this.cur);
    this.anim = null; this.fade = 1; this.fadeDur = 0.15; this.trigAmt = 0; this.trigHold = 0; this.cyc = 9; this.kick = 0;
    // ---- 套筒 / 枪机、扳机和食指、防尘盖：从"开枪"那一段里取出相对待机姿态的变化量
    const at = (name, t) => { const f = this._bake(t, t, 0).frames[0], i = idx.get(find(name)); return { i, P: new THREE.Vector3().fromArray(f.P, i * 3), Q: new THREE.Quaternion().fromArray(f.Q, i * 4) }; };
    const idleOf = (i) => ({ P: new THREE.Vector3().fromArray(this.idle.P, i * 3), Q: new THREE.Quaternion().fromArray(this.idle.Q, i * 4) });
    this.slideParts = [def.slide.node, ...(def.slide.follow || [])].map((nm) => { const a = at(nm, def.slide.tBack), b = idleOf(a.i); return { o: this.nodes[a.i].o, i: a.i, p0: b.P, back: a.P.sub(b.P) }; });
    this.trigParts = def.trig.nodes.map((nm) => { const a = at(nm, def.trig.t), b = idleOf(a.i); return { o: this.nodes[a.i].o, dP: a.P.sub(b.P), dQ: b.Q.clone().invert().multiply(a.Q) }; });
    if (def.port) { const a = at(def.port.node, def.port.t), b = idleOf(a.i); this.port = { o: this.nodes[a.i].o, q0: b.Q, q1: a.Q }; }
    // ---- 手臂
    this.arms = {}; for (const s of ['L', 'R']) this.arms[s] = { up: find(s + '_arm'), lo: find(s + '_elbow'), hand: find(s + '_wrist') };
    this.lMid = find('L_middle1');
    this.skin = null; root.traverse((o) => { if (o.isSkinnedMesh) this.skin = o; });
    return this;
  }

  _buf() { return { P: new Float32Array(this.N * 3), Q: new Float32Array(this.N * 4), S: new Float32Array(this.N * 3) }; }
  _copy(a, b) { b.P.set(a.P); b.Q.set(a.Q); b.S.set(a.S); }
  // 把原动画的一段按 60fps 重新采样；sigma>0 时每一帧取前后一小段时间的加权平均（所有骨骼用同一组权重，手和枪不会互相错开）
  _bake(t0, t1, sigma) {
    const n = Math.max(1, Math.round((t1 - t0) * FR) + 1), N = this.N, frames = [];
    const K = sigma > 0 ? Math.ceil(2.6 * sigma * FR) : 0, w = []; let ws = 0;
    for (let k = -K; k <= K; k++) { const x = sigma > 0 ? Math.exp(-0.5 * (k / (sigma * FR)) ** 2) : 1; w.push(x); ws += x; }
    const acc = [0, 0, 0, 0], c = [0, 0, 0, 0];
    for (let f = 0; f < n; f++) {
      const fr = this._buf(); this._copy(this.rest, fr); const tc = t0 + f / FR;
      for (const tr of this.tracks) {
        const size = tr.kind === 'Q' ? 4 : 3, dst = fr[tr.kind], o = tr.ni * size;
        const r0 = tr.it.evaluate(Math.min(t1, tc)); for (let j = 0; j < size; j++) c[j] = r0[j];
        acc.fill(0);
        for (let k = -K; k <= K; k++) {
          const r = tr.it.evaluate(Math.max(t0, Math.min(t1, tc + k / FR))); let sg = 1;
          if (size === 4 && r[0] * c[0] + r[1] * c[1] + r[2] * c[2] + r[3] * c[3] < 0) sg = -1;
          for (let j = 0; j < size; j++) acc[j] += r[j] * w[k + K] * sg;
        }
        if (size === 4) {
          let l = Math.hypot(acc[0], acc[1], acc[2], acc[3]) || 1;
          if (frames.length) { const pv = frames[frames.length - 1].Q; if (pv[o] * acc[0] + pv[o + 1] * acc[1] + pv[o + 2] * acc[2] + pv[o + 3] * acc[3] < 0) l = -l; }
          for (let j = 0; j < 4; j++) dst[o + j] = acc[j] / l;
        } else for (let j = 0; j < 3; j++) dst[o + j] = acc[j] / ws;
      }
      frames.push(fr);
    }
    return { frames, dur: (n - 1) / FR };
  }
  _sample(seg, t, out) {
    const f = Math.max(0, Math.min(seg.frames.length - 1, t * FR)), i0 = Math.floor(f), i1 = Math.min(seg.frames.length - 1, i0 + 1), a = f - i0, A = seg.frames[i0], B = seg.frames[i1];
    this._mix(A, B, a, out);
  }
  _mix(A, B, a, out) {
    const b = 1 - a;
    for (let i = 0; i < out.P.length; i++) { out.P[i] = A.P[i] * b + B.P[i] * a; out.S[i] = A.S[i] * b + B.S[i] * a; }
    for (let i = 0; i < out.Q.length; i += 4) {
      const sg = A.Q[i] * B.Q[i] + A.Q[i + 1] * B.Q[i + 1] + A.Q[i + 2] * B.Q[i + 2] + A.Q[i + 3] * B.Q[i + 3] < 0 ? -a : a;
      const x = A.Q[i] * b + B.Q[i] * sg, y = A.Q[i + 1] * b + B.Q[i + 1] * sg, z = A.Q[i + 2] * b + B.Q[i + 2] * sg, ww = A.Q[i + 3] * b + B.Q[i + 3] * sg, l = Math.hypot(x, y, z, ww) || 1;
      out.Q[i] = x / l; out.Q[i + 1] = y / l; out.Q[i + 2] = z / l; out.Q[i + 3] = ww / l;
    }
  }
  _write(p) {
    for (let i = 0; i < this.N; i++) {
      const n = this.nodes[i];
      if (n.P) n.o.position.fromArray(p.P, i * 3);
      if (n.Q) n.o.quaternion.fromArray(p.Q, i * 4);
      if (n.S) n.o.scale.fromArray(p.S, i * 3);
    }
  }
  _fadeFrom(dur) { this._copy(this.cur, this.from); this.fade = 0; this.fadeDur = dur; }
  play(name) { this._fadeFrom(0.13); this.anim = { name, seg: this.segs[name], t: 0, speed: this.def.speed[name] || 1 }; }
  stop(fade = 0.2) { if (this.anim) { this._fadeFrom(fade); this.anim = null; } }
  get busy() { return !!this.anim; }
  reset() { this.anim = null; this.fade = 1; this._copy(this.idle, this.cur); this.trigAmt = 0; this.trigHold = 0; this.cyc = 9; this.locked = false; this.ammo = this.def.mag; this.portOpen = false; this.kick = 0; this.pose(0); }
  shot(last) { this.cyc = 0; this.trigHold = 0.07; this.portOpen = true; if (last) this.locked = true; }

  // 每帧：推进动画，写骨骼姿态，再叠上套筒、扳机这些零件的动作（肩肘的反解在 ViewModel 里，要等整组的位置定了才能算）
  pose(dt) {
    const def = this.def;
    if (this.anim) {
      const a = this.anim; a.t += dt * a.speed;
      this._sample(a.seg, a.t, this.tgt);
      if (a.t >= a.seg.dur) { this.anim = null; this._copy(this.tgt, this.cur); this._fadeFrom(0.22); this.done = a.name; if (a.name === 'reloadEmpty') this.locked = false; }
    }
    if (!this.anim) this._copy(this.idle, this.tgt);
    if (this.fade < 1) { this.fade = Math.min(1, this.fade + dt / this.fadeDur); this._mix(this.from, this.tgt, sstep(this.fade), this.cur); } else this._copy(this.tgt, this.cur);
    this._write(this.cur);
    // 套筒 / 枪机：开枪后往复一次；打空了挂在后面，换弹动画里放回去
    this.cyc += dt; const c = this.cyc / def.slide.cycle;
    let s = c < 0.18 ? c / 0.18 : c < 0.42 ? 1 : c < 1 ? 1 - sstep((c - 0.42) / 0.58) : 0;
    s = Math.max(s, this.kick);
    const an = this.anim ? this.anim.name : '', keep = !!def.keepSlide[an];
    if (this.locked && !(an === 'reloadEmpty' && this._clipSlide() > 0.5)) s = 1;
    for (const sp of this.slideParts) {
      const sc = keep ? 0 : Math.max(0, _v1.copy(sp.o.position).sub(sp.p0).dot(sp.back) / sp.back.lengthSq());
      sp.o.position.copy(sp.p0).addScaledVector(sp.back, Math.min(1, sc + s));
    }
    if (an === 'reloadEmpty' && this.locked && this._clipSlide() > 0.5) this.locked = false;       // 动画自己把套筒拉到后面了，之后由动画放回
    // 扳机和食指
    this.trigHold -= dt; const want = this.trigHold > 0 ? 1 : 0;
    this.trigAmt += (want - this.trigAmt) * (1 - Math.exp(-dt / (want ? 0.012 : 0.045)));
    if (this.trigAmt > 0.002) for (const tp of this.trigParts) { tp.o.position.addScaledVector(tp.dP, this.trigAmt); tp.o.quaternion.multiply(_q1.identity().slerp(tp.dQ, this.trigAmt)); }
    if (this.port) this.port.o.quaternion.copy(this.portOpen ? this.port.q1 : this.port.q0);
  }
  _clipSlide() { const sp = this.slideParts[0], i = sp.i * 3; return _v1.set(this.cur.P[i], this.cur.P[i + 1], this.cur.P[i + 2]).sub(sp.p0).dot(sp.back) / sp.back.lengthSq(); }
}

export class ViewModel {
  constructor() {
    this.group = new THREE.Group(); this.group.matrixAutoUpdate = false;
    this.guns = []; this.idx = 0; this.next = -1; this.equip = 1; this.swT = 0;
    this.kick = 0;            // 影片比对模式用：直接给套筒后坐量 0..1
    this.ik = true; this.anchor = { L: new THREE.Vector3(), R: new THREE.Vector3() }; this.pole = { L: new THREE.Vector3(-0.5, -0.8, 0.3), R: new THREE.Vector3(0.5, -0.8, 0.3) };
    this.lh = 0; this.lhPos = new THREE.Vector3(); this.lhQ = new THREE.Quaternion();     // 左手离枪（扔闪光弹）：权重、世界位置、世界朝向
    this.light = new THREE.Vector3(); this.muzzle = new THREE.Vector3(); this.eject = new THREE.Vector3();
    L.uWLE.value.set(5400 * WL_K, 1980 * WL_K, 520 * WL_K);
  }
  get gun() { return this.guns[this.idx]; }
  get def() { return this.gun.def; }

  async load() {
    for (const def of WEAPONS) { const g = await new Gun(def).load(); this.guns.push(g); this.group.add(g.root); }
    this.group.updateMatrixWorld(true);
    const inv = this.group.matrixWorld.clone().invert();
    for (const g of this.guns) this._dress(g, inv);
    this.mats = []; this.group.traverse((o) => { if (o.isMesh && !this.mats.includes(o.material)) this.mats.push(o.material); });
    this._show(0);
    return this;
  }

  // 量出枪口、抛壳口、枪灯的位置，装上枪灯、夜光准星点、袖口封堵
  _dress(g, inv) {
    const def = g.def; g.pose(0); this.group.updateMatrixWorld(true);
    const bbox = (re) => { const b = new THREE.Box3(); g.root.traverse((o) => { if (o.isMesh && re.test(o.name)) { o.geometry.computeBoundingBox(); b.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld).applyMatrix4(inv)); } }); return b; };
    const add = (mesh, parent) => { mesh.layers.set(LAYER.VM); mesh.frustumCulled = false; this.group.add(mesh); mesh.updateMatrixWorld(true); parent.attach(mesh); return mesh; };
    const dark = new THREE.MeshStandardMaterial({ color: 0x08080a, roughness: 0.42, metalness: 0.75 }), rub = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.8, metalness: 0.1 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x1a2226, roughness: 0.08, metalness: 0.9 });
    const cyl = (r, len, mat, x, y, z, seg = 24) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat); m.rotation.x = Math.PI / 2; m.position.set(x, y, z); return m; };
    const box = (sx, sy, sz, mat, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat); m.position.set(x, y, z); return m; };
    const bm = bbox(def.muzzleRe), bb = bbox(def.boreRe);
    const mx = (bb.min.x + bb.max.x) / 2, my = (bb.min.y + bb.max.y) / 2, mz = bm.min.z;
    g.muzzle = new THREE.Vector3(mx, my, mz);
    if (def.id === 'pistol') {
      g.eject = new THREE.Vector3(bm.max.x, bm.max.y - 0.006, (bm.min.z + bm.max.z) / 2 - 0.01);
      // 枪灯：导轨上的机身 + 灯头 + 灯头前圈 + 镜片 + 两侧拨杆
      const ly = my - 0.041, parts = [
        box(0.027, 0.026, 0.05, dark, mx, ly + 0.002, mz + 0.058), box(0.021, 0.008, 0.044, dark, mx, ly + 0.017, mz + 0.058),
        cyl(0.0138, 0.03, dark, mx, ly, mz + 0.02), cyl(0.0152, 0.007, dark, mx, ly, mz + 0.003), cyl(0.0125, 0.002, glass, mx, ly, mz + 0.0002),
        box(0.006, 0.012, 0.012, rub, mx - 0.0155, ly + 0.002, mz + 0.085), box(0.006, 0.012, 0.012, rub, mx + 0.0155, ly + 0.002, mz + 0.085)];
      for (const m of parts) add(m, g.base);
      g.light = new THREE.Vector3(mx, ly, mz - 0.012);
      // 照门两点、准星一点（夜光点）：装在套筒上跟着走
      const sb = bbox(/Sights/), dot = new THREE.MeshStandardMaterial({ color: 0xdfe6d8, roughness: 0.5, metalness: 0, emissive: new THREE.Color(0.25, 0.9, 0.32), emissiveIntensity: 0.014 });
      const disc = (x, y, z) => { const m = new THREE.Mesh(new THREE.CircleGeometry(0.0013, 12), dot); m.position.set(x, y, z); return m; };
      const cx = (sb.min.x + sb.max.x) / 2, slide = g.find(def.slide.node);
      add(disc(cx - 0.0062, sb.max.y - 0.0026, sb.max.z + 0.0003), slide); add(disc(cx + 0.0062, sb.max.y - 0.0026, sb.max.z + 0.0003), slide);
      add(disc(cx, sb.max.y - 0.0022, sb.min.z + 0.0052), slide);
      g.sightY = sb.max.y - my;
      g.pivot = g.arms.R.hand.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);       // 后坐的支点：握枪那只手的手腕
    } else {
      const rc = bbox(/ejectionport/);
      g.eject = new THREE.Vector3(rc.max.x + 0.004, (rc.min.y + rc.max.y) / 2, (rc.min.z + rc.max.z) / 2);
      // 护木右侧的战术灯：灯座 + 灯身 + 灯头 + 前圈 + 镜片 + 尾盖
      const hg = bbox(/handguard/), lx = hg.max.x + 0.0135, ly = (hg.min.y + hg.max.y) / 2 + 0.004, lz = hg.min.z + 0.02, parts = [
        box(0.012, 0.022, 0.03, dark, hg.max.x + 0.002, ly, lz + 0.075), cyl(0.0112, 0.085, dark, lx, ly, lz + 0.07), cyl(0.0146, 0.034, dark, lx, ly, lz + 0.017),
        cyl(0.0158, 0.006, dark, lx, ly, lz + 0.002), cyl(0.0128, 0.002, glass, lx, ly, lz - 0.0008), cyl(0.0122, 0.012, rub, lx, ly, lz + 0.118)];
      for (const m of parts) add(m, g.base);
      g.light = new THREE.Vector3(lx, ly, mz - 0.01);       // 光源点放到枪口那一截的前面：灯在护木上，照到自己枪管和准星座上会白成一片
      const rs = bbox(/rearsight/); g.sightY = rs.max.y - my - 0.012;
      const st = bbox(/stock/); g.pivot = new THREE.Vector3(mx, my - 0.03, st.max.z - 0.02);       // 后坐的支点：抵肩的枪托尾
    }
    // 枪灯位置换到枪身节点的局部（换弹时枪会歪，灯和光束要跟着歪）
    g.base.updateWorldMatrix(true, false);
    const toBase = g.base.matrixWorld.clone().invert().multiply(this.group.matrixWorld);
    g.lightB = g.light.clone().applyMatrix4(toBase); g.fwdB = new THREE.Vector3(0, 0, -1).transformDirection(toBase);
    // 袖口封堵：上臂袖口那一圈顶点（离手腕最远的一圈）盖一个深色椭球，跟着上臂骨骼走，低头时不穿帮
    const cloth = new THREE.MeshStandardMaterial({ color: 0x030303, roughness: 0.92, metalness: 0 }), sk = g.skin;
    if (sk) {
      sk.skeleton.update();
      const n = sk.geometry.attributes.position.count, p = new THREE.Vector3(), si = sk.geometry.attributes.skinIndex, sw = sk.geometry.attributes.skinWeight, bones = sk.skeleton.bones;
      for (const s of ['L', 'R']) {
        const up = g.arms[s].up, bi = bones.indexOf(up), sh = up.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv), el = g.arms[s].lo.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
        const ax = sh.clone().sub(el).normalize(), pts = [];
        for (let i = 0; i < n; i++) {
          let wgt = 0; for (let k = 0; k < 4; k++) if (si.getComponent(i, k) === bi) wgt += sw.getComponent(i, k);
          if (wgt < 0.5) continue; sk.getVertexPosition(i, p); pts.push(p.clone().applyMatrix4(sk.matrixWorld).applyMatrix4(inv));
        }
        if (!pts.length) continue;
        const far = Math.max(...pts.map((q) => q.clone().sub(el).dot(ax))), ring = pts.filter((q) => q.clone().sub(el).dot(ax) > far - 0.035);
        const c = ring.reduce((a, q) => a.add(q), new THREE.Vector3()).multiplyScalar(1 / ring.length);
        const r = Math.max(...ring.map((q) => { const d = q.clone().sub(c); return d.addScaledVector(ax, -d.dot(ax)).length(); }));
        const m = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), cloth);
        m.scale.set(r * 0.98, r * 0.98, 0.06); m.position.copy(c).addScaledVector(ax, -0.035); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), ax);
        add(m, up);
      }
    }
  }

  _show(i) {
    this.idx = i; this.guns.forEach((g, k) => (g.root.visible = k === i));
    const g = this.gun; this.muzzle.copy(g.muzzle); this.eject.copy(g.eject); this.light.copy(g.light);
    if (this.onSwitch) this.onSwitch(g);
  }
  setEnvMap(tex, k = 1) { for (const m of this.mats) { if (!m.envMap) m.needsUpdate = true; m.envMap = tex; m.envMapIntensity = k; } }

  // ---- 对外的动作
  get reloading() { return this.gun.busy; }
  get switching() { return this.next >= 0 || this.equip < 0.98; }
  startReload() { const g = this.gun; if (g.busy || this.switching) return null; const name = g.locked || g.ammo === 0 ? 'reloadEmpty' : 'reload'; g.done = null; g.play(name); return name; }
  switchTo(i) { if (i === this.idx && this.next < 0) return false; if (i === this.next) return false; this.next = i; return true; }
  shot(last) { this.gun.shot(last); }
  throwLeft() { this.thT = 0; }
  resetPose() { for (const g of this.guns) g.reset(); this.next = -1; this.equip = 1; this.kick = 0; this.thT = undefined; this.lh = 0; this._show(0); }

  // 每帧：姿态 → 换枪 → 肩肘反解 → 枪灯
  update(dt) {
    // 换枪：先把手上的收到画面外，换成另一把再端起来（换弹中途换枪，换弹作废）
    if (this.next >= 0) {
      this.equip = Math.max(0, this.equip - dt / 0.2);
      if (this.equip <= 0) { this.gun.stop(0); this.gun.fade = 1; if (this.next !== this.idx) this._show(this.next); this.next = -1; }
    } else if (this.equip < 1) this.equip = Math.min(1, this.equip + dt / 0.3);
    const g = this.gun; g.kick = this.kick; g.pose(dt);
    this.group.updateMatrixWorld(true);
    // 扔闪光弹：左手离枪，从腰间取弹、举到耳边、往前甩出去、再回到枪上（路径在镜头坐标里：x 右，y 上，-z 前）
    if (this.thT !== undefined && this.camera) {
      this.thT += dt; const t = this.thT;
      if (t >= 0.8) { this.thT = undefined; this.lh = 0; }
      else {
        const K = [[0, -0.22, -0.36, -0.22], [0.15, -0.30, -0.46, -0.10], [0.28, -0.36, -0.10, -0.05], [0.37, -0.22, 0.04, -0.34], [0.44, -0.10, -0.06, -0.56], [0.56, -0.07, -0.26, -0.48], [0.8, -0.06, -0.24, -0.42]];
        let i = 0; while (i < K.length - 2 && t > K[i + 1][0]) i++;
        const a = sstep((t - K[i][0]) / (K[i + 1][0] - K[i][0]));
        this.lhPos.set(K[i][1] + (K[i + 1][1] - K[i][1]) * a, K[i][2] + (K[i + 1][2] - K[i][2]) * a, K[i][3] + (K[i + 1][3] - K[i][3]) * a).applyMatrix4(this.camera.matrixWorld);
        this.lh = sstep(t / 0.13) * (1 - sstep((t - 0.56) / 0.24));
        const sw = t < 0.28 ? -50 * sstep(t / 0.28) : -50 + 72 * sstep((t - 0.28) / 0.16);       // 手腕先往后扳，出手时往前甩
        this.lhQ.setFromAxisAngle(_v1.set(1, 0, 0).transformDirection(this.camera.matrixWorld), -sw * Math.PI / 180);
      }
    }
    if (this.ik) { this._ik(g, 'R', null); this._ik(g, 'L', this.lh > 0.001 ? this.lh : 0); }
    g.base.updateWorldMatrix(true, false);
    L.uWLPos.value.copy(g.lightB).applyMatrix4(g.base.matrixWorld);
    L.uWLDir.value.copy(g.fwdB).transformDirection(g.base.matrixWorld);
  }

  // 两段骨骼的反解：肩膀钉在 anchor，手腕保持在姿态给出的位置和朝向（或者被左手的"离枪"目标拉走）
  _ik(g, s, free) {
    const a = g.arms[s], S = this.anchor[s];
    a.hand.matrixWorld.decompose(_v1, _q1, _s1); const T = _v1.clone(), TQ = _q1.clone();
    if (free) { T.lerp(this.lhPos, free); TQ.slerp(_q2.copy(this.lhQ).multiply(TQ), free); }
    a.up.position.copy(a.up.parent.worldToLocal(_v2.copy(S))); a.up.updateWorldMatrix(false, true);
    const E = _v2.setFromMatrixPosition(a.lo.matrixWorld).clone(), W = _v3.setFromMatrixPosition(a.hand.matrixWorld).clone();
    const la = E.distanceTo(S), lb = W.distanceTo(E), d = Math.max(Math.abs(la - lb) + 0.02, Math.min(la + lb - 0.004, T.distanceTo(S)));
    // 肘的夹角
    const u = S.clone().sub(E).normalize(), v = W.clone().sub(E).normalize();
    const th0 = Math.acos(Math.max(-1, Math.min(1, u.dot(v)))), th1 = Math.acos(Math.max(-1, Math.min(1, (la * la + lb * lb - d * d) / (2 * la * lb))));
    const ax = u.clone().cross(v); if (ax.lengthSq() < 1e-8) ax.set(1, 0, 0); ax.normalize();
    rotWorld(a.lo, _q1.setFromAxisAngle(ax, th1 - th0)); a.lo.updateWorldMatrix(false, true);
    // 整条手臂绕肩膀转到手腕对准目标
    W.setFromMatrixPosition(a.hand.matrixWorld);
    const dir = T.clone().sub(S).normalize();
    rotWorld(a.up, _q1.setFromUnitVectors(W.sub(S).normalize(), dir)); a.up.updateWorldMatrix(false, true);
    // 手肘朝向：绕"肩→腕"轴转到指定的一侧（向外、向下）
    E.setFromMatrixPosition(a.lo.matrixWorld).sub(S); E.addScaledVector(dir, -E.dot(dir));
    const P = _v4.copy(this.pole[s]); P.addScaledVector(dir, -P.dot(dir));
    if (E.lengthSq() > 1e-6 && P.lengthSq() > 1e-6) {
      E.normalize(); P.normalize(); let ang = Math.acos(Math.max(-1, Math.min(1, E.dot(P)))); if (_v5.copy(E).cross(P).dot(dir) < 0) ang = -ang;
      rotWorld(a.up, _q1.setFromAxisAngle(dir, ang)); a.up.updateWorldMatrix(false, true);
    }
    worldQ(a.hand.parent, _q2); a.hand.quaternion.copy(_q2.invert().multiply(TQ)); a.hand.updateWorldMatrix(false, true);
  }

  // 左手掌心的位置（扔闪光弹时弹体先握在手里）
  palmWorld(out = new THREE.Vector3()) { const g = this.gun; out.setFromMatrixPosition(g.arms.L.hand.matrixWorld).lerp(_v1.setFromMatrixPosition(g.lMid.matrixWorld), 0.6); if (this.camera) out.addScaledVector(_v1.set(0, 1, 0).transformDirection(this.camera.matrixWorld), 0.03); return out; }
  worldPoint(local, out = new THREE.Vector3()) { return out.copy(local).applyMatrix4(this.group.matrixWorld); }
  forward(out = new THREE.Vector3()) { return out.set(0, 0, -1).transformDirection(this.group.matrixWorld); }
}
