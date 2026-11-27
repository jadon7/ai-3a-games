import * as THREE from 'three';
import type { BoneKey, Rig } from './rig';

export interface RibbonSpec {
  bone: BoneKey;
  /** 挂点相对骨骼的位置，写在角色本地空间里（x 朝前、y 朝上、z 朝镜头那一侧，米，按身高 1.8 写，自动按身高缩放）。初始化时换算成骨骼局部坐标，之后跟着骨骼转 */
  offset: [number, number, number];
  length: number; width: number; tipWidth?: number;
  nodes?: number;
  color: number; edge?: number;       // 布的颜色、镶边的颜色
  stiffness?: number;                 // 0 很软、1 很挺（每个节点往“顺着上一节”的方向回弹的力度）
  drag?: number; gravity?: number;
  /** 初始垂向（角色本地空间），默认朝下偏后 */
  rest?: [number, number, number];
  emissive?: number;
}

const SUB = 3;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _side = new THREE.Vector3(), _tan = new THREE.Vector3(), _view = new THREE.Vector3();

/**
 * 一条布带：Verlet 质点链，根部钉在骨骼上，受重力、风、惯性，不穿地、不钻进躯干。
 * 画成一条始终把宽面朝向镜头的带子（横版镜头下侧着的布带会变成一条线，所以不做真实的扭转）。
 */
class Ribbon {
  readonly mesh: THREE.Mesh;
  private n: number; private m = 0;   // 质点数、渲染用的细分点数
  private sp = new Float32Array(0);
  private p: Float32Array; private q: Float32Array;   // 当前位置、上一步位置
  private seg: number;
  private local = new THREE.Vector3();
  private pos: Float32Array; private nor: Float32Array;
  private geo = new THREE.BufferGeometry();
  private bone: THREE.Bone;
  private inited = false;
  private lastAnchor = new THREE.Vector3();

  constructor(private rig: Rig, private spec: RibbonSpec, tex: THREE.Texture) {
    const s = rig.height / 1.8;
    this.n = spec.nodes ?? 9;
    this.seg = (spec.length * s) / (this.n - 1);
    this.p = new Float32Array(this.n * 3); this.q = new Float32Array(this.n * 3);
    this.bone = rig.bones[spec.bone];
    this.m = (this.n - 1) * SUB + 1;
    this.pos = new Float32Array(this.m * 2 * 3); this.nor = new Float32Array(this.m * 2 * 3);
    const uv = new Float32Array(this.m * 2 * 2); const idx: number[] = [];
    for (let i = 0; i < this.m; i++) { const t = i / (this.m - 1); uv.set([0, t, 1, t], i * 4); if (i < this.m - 1) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); } }
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.geo.setIndex(idx);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex, roughness: 0.82, metalness: 0.0, side: THREE.DoubleSide, alphaTest: 0.5, emissive: spec.emissive ?? 0x000000, emissiveIntensity: spec.emissive ? 0.6 : 0 });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false; this.mesh.castShadow = true; this.mesh.receiveShadow = true;
  }

  private anchor(out: THREE.Vector3) { return out.copy(this.local).applyMatrix4(this.bone.matrixWorld); }

  /** 在角色摆好姿势、矩阵更新之后调用一次：定挂点，把链子顺着垂向放好。 */
  init() {
    const rig = this.rig, s = rig.height / 1.8, o = this.spec.offset;
    // 角色本地空间的偏移 → 世界 → 骨骼局部
    _a.setFromMatrixPosition(this.bone.matrixWorld);
    rig.face.worldToLocal(_a); _a.x += o[0] * s; _a.y += o[1] * s; _a.z += o[2] * s; rig.face.localToWorld(_a);
    this.local.copy(_a); this.bone.worldToLocal(this.local);
    this.reset();
    this.inited = true;
  }

  reset() {
    const r = this.spec.rest ?? [-0.25, -1, 0];
    _b.set(r[0], r[1], r[2]).normalize().transformDirection(this.rig.face.matrixWorld);
    this.anchor(_a);
    for (let i = 0; i < this.n; i++) { const k = i * 3; this.p[k] = this.q[k] = _a.x + _b.x * this.seg * i; this.p[k + 1] = this.q[k + 1] = Math.max(0.02, _a.y + _b.y * this.seg * i); this.p[k + 2] = this.q[k + 2] = _a.z + _b.z * this.seg * i; }
    this.lastAnchor.copy(_a);
  }

  step(dt: number, time: number, camera: THREE.Camera, hips: THREE.Vector3, chest: THREE.Vector3, bodyR: number, backX: number, head: THREE.Vector3) {
    if (!this.inited) return;
    const { p, q, n, seg } = this;
    this.anchor(_a);
    // 瞬移（换边、闪现）：整条跟着平移，不拉出一条横贯画面的长带
    const jump = _a.distanceTo(this.lastAnchor);
    if (jump > 0.9) { const dx = _a.x - this.lastAnchor.x, dy = _a.y - this.lastAnchor.y, dz = _a.z - this.lastAnchor.z; for (let i = 0; i < n * 3; i += 3) { p[i] += dx; p[i + 1] += dy; p[i + 2] += dz; q[i] += dx; q[i + 1] += dy; q[i + 2] += dz; } }
    this.lastAnchor.copy(_a);
    const sub = 2, h = Math.min(dt, 1 / 30) / sub;
    const g = (this.spec.gravity ?? 15) * h * h, damp = 1 - (this.spec.drag ?? 2.2) * h;
    const stiff = this.spec.stiffness ?? 0.12;
    for (let sIt = 0; sIt < sub; sIt++) {
      p[0] = _a.x; p[1] = _a.y; p[2] = _a.z;
      for (let i = 1; i < n; i++) {
        const k = i * 3, t = i / (n - 1);
        let vx = (p[k] - q[k]) * damp, vy = (p[k + 1] - q[k + 1]) * damp, vz = (p[k + 2] - q[k + 2]) * damp;
        // 限速：动作被快放时胯甩得很猛，布带不能跟着抽成鞭子
        const vl = Math.hypot(vx, vy, vz), vmax = 5.5 * h;
        if (vl > vmax) { const m = vmax / vl; vx *= m; vy *= m; vz *= m; }
        q[k] = p[k]; q[k + 1] = p[k + 1]; q[k + 2] = p[k + 2];
        // 风：缓慢变化的横向扰动，越靠尾端越明显
        const w = (Math.sin(time * 1.3 + i * 0.7) * 0.6 + Math.sin(time * 2.9 + i * 1.9) * 0.4) * t;
        // 微风总是把布带往角色身后吹（不然朝左站的人布带会糊到脸上）
        p[k] += vx + backX * (1.6 + w * 1.6) * h * h * 1.2; p[k + 1] += vy - g + Math.abs(w) * h * h * 0.8; p[k + 2] += vz + w * h * h * 1.5;
      }
      for (let it = 0; it < 3; it++) {
        for (let i = 1; i < n; i++) {
          const k = i * 3, j = k - 3;
          let dx = p[k] - p[j], dy = p[k + 1] - p[j + 1], dz = p[k + 2] - p[j + 2];
          const d = Math.hypot(dx, dy, dz) || 1e-5, f = (d - seg) / d;
          if (i === 1) { p[k] -= dx * f; p[k + 1] -= dy * f; p[k + 2] -= dz * f; }
          else { p[k] -= dx * f * 0.5; p[k + 1] -= dy * f * 0.5; p[k + 2] -= dz * f * 0.5; p[j] += dx * f * 0.5; p[j + 1] += dy * f * 0.5; p[j + 2] += dz * f * 0.5; }
          // 挺度：往“延续上一节方向”的位置拉一点
          if (stiff > 0 && i >= 2) {
            const i0 = j - 3; const ex = p[j] + (p[j] - p[i0]), ey = p[j + 1] + (p[j + 1] - p[i0 + 1]), ez = p[j + 2] + (p[j + 2] - p[i0 + 2]);
            p[k] += (ex - p[k]) * stiff * 0.3; p[k + 1] += (ey - p[k + 1]) * stiff * 0.3; p[k + 2] += (ez - p[k + 2]) * stiff * 0.3;
          }
          // 防折叠：和隔一个的节点至少隔 1.55 节长，布带不会折成锐角
          if (i >= 2) {
            const i0 = j - 3;
            dx = p[k] - p[i0]; dy = p[k + 1] - p[i0 + 1]; dz = p[k + 2] - p[i0 + 2];
            const d2 = Math.hypot(dx, dy, dz) || 1e-5, minD = seg * 1.55;
            if (d2 < minD) { const f2 = (minD - d2) / d2; p[k] += dx * f2; p[k + 1] += dy * f2; p[k + 2] += dz * f2; }
          }
          // 不穿地
          if (p[k + 1] < 0.018) { p[k + 1] = 0.018; q[k] += (p[k] - q[k]) * 0.5; q[k + 2] += (p[k + 2] - q[k + 2]) * 0.5; }
          // 不钻进躯干（胯和胸两个球）
          for (let ci = 0; ci < 3; ci++) {
            const c = ci === 0 ? hips : ci === 1 ? chest : head, rr = ci === 2 ? bodyR * 0.72 : bodyR;
            dx = p[k] - c.x; dy = p[k + 1] - c.y; dz = p[k + 2] - c.z;
            const dd = Math.hypot(dx, dy, dz);
            if (dd < rr && dd > 1e-4) { const m = rr / dd; p[k] = c.x + dx * m; p[k + 1] = c.y + dy * m; p[k + 2] = c.z + dz * m; }
          }
        }
      }
    }
    // 出网格：先把质点连成平滑曲线（Catmull-Rom 细分），再沿曲线铺带子
    const m = this.m;
    if (this.sp.length !== m * 3) this.sp = new Float32Array(m * 3);
    const sp = this.sp;
    for (let i = 0; i < n - 1; i++) {
      const i0 = Math.max(0, i - 1) * 3, i1 = i * 3, i2 = (i + 1) * 3, i3 = Math.min(n - 1, i + 2) * 3;
      for (let u = 0; u < SUB; u++) {
        const t = u / SUB, t2 = t * t, t3 = t2 * t, o = (i * SUB + u) * 3;
        for (let c = 0; c < 3; c++) sp[o + c] = 0.5 * (2 * p[i1 + c] + (-p[i0 + c] + p[i2 + c]) * t + (2 * p[i0 + c] - 5 * p[i1 + c] + 4 * p[i2 + c] - p[i3 + c]) * t2 + (-p[i0 + c] + 3 * p[i1 + c] - 3 * p[i2 + c] + p[i3 + c]) * t3);
      }
    }
    sp[(m - 1) * 3] = p[(n - 1) * 3]; sp[(m - 1) * 3 + 1] = p[(n - 1) * 3 + 1]; sp[(m - 1) * 3 + 2] = p[(n - 1) * 3 + 2];
    const s = this.rig.height / 1.8, w0 = this.spec.width * s, w1 = (this.spec.tipWidth ?? this.spec.width * 0.75) * s;
    for (let i = 0; i < m; i++) {
      const k = i * 3, a = Math.max(0, i - 1) * 3, b = Math.min(m - 1, i + 1) * 3;
      _tan.set(sp[b] - sp[a], sp[b + 1] - sp[a + 1], sp[b + 2] - sp[a + 2]).normalize();
      _view.set(camera.position.x - sp[k], camera.position.y - sp[k + 1], camera.position.z - sp[k + 2]).normalize();
      _side.crossVectors(_tan, _view);
      if (_side.lengthSq() < 1e-6) _side.set(0, 0, 1); else _side.normalize();
      const t = i / (m - 1), hw = (w0 + (w1 - w0) * t) * 0.5;
      const o = i * 6;
      this.pos[o] = sp[k] - _side.x * hw; this.pos[o + 1] = sp[k + 1] - _side.y * hw; this.pos[o + 2] = sp[k + 2] - _side.z * hw;
      this.pos[o + 3] = sp[k] + _side.x * hw; this.pos[o + 4] = sp[k + 1] + _side.y * hw; this.pos[o + 5] = sp[k + 2] + _side.z * hw;
      _c.crossVectors(_side, _tan).normalize();
      this.nor[o] = this.nor[o + 3] = _c.x; this.nor[o + 1] = this.nor[o + 4] = _c.y; this.nor[o + 2] = this.nor[o + 5] = _c.z;
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.normal.needsUpdate = true;
  }
}

/** 布带贴图：布纹 + 可选的镶边 + 尾端剪成燕尾。横向是宽度，纵向是长度（下端是尾巴）。 */
function ribbonTexture(color: number, edge?: number): THREE.Texture {
  const W = 64, H = 256;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  const c = new THREE.Color(color);
  g.clearRect(0, 0, W, H);
  // 燕尾形的轮廓
  g.beginPath(); g.moveTo(0, 0); g.lineTo(W, 0); g.lineTo(W, H); g.lineTo(W / 2, H - 34); g.lineTo(0, H); g.closePath(); g.clip();
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, `#${c.clone().multiplyScalar(0.8).getHexString()}`); grad.addColorStop(0.5, `#${c.getHexString()}`); grad.addColorStop(1, `#${c.clone().multiplyScalar(0.7).getHexString()}`);
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  // 布纹：细的横竖线
  g.globalAlpha = 0.14; g.strokeStyle = '#000';
  for (let y = 0; y < H; y += 3) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); g.stroke(); }
  g.globalAlpha = 0.1; g.strokeStyle = '#fff';
  for (let x = 0; x < W; x += 4) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); g.stroke(); }
  // 中间一道暗的折痕、两边亮一点，有点厚度感
  g.globalAlpha = 0.25; const fold = g.createLinearGradient(0, 0, W, 0);
  fold.addColorStop(0, '#fff'); fold.addColorStop(0.5, '#000'); fold.addColorStop(1, '#fff'); g.fillStyle = fold; g.fillRect(0, 0, W, H);
  if (edge !== undefined) { g.globalAlpha = 0.95; g.fillStyle = `#${new THREE.Color(edge).getHexString()}`; g.fillRect(0, 0, 5, H); g.fillRect(W - 5, 0, 5, H); }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}

/** 每个角色身上的布带。 */
export const RIBBONS: Record<string, RibbonSpec[]> = {
  yanjin: [
    // 腰带在后腰偏镜头一侧打结，垂下两条
    { bone: 'Hips', offset: [-0.15, 0.07, 0.11], length: 0.66, width: 0.095, tipWidth: 0.08, nodes: 10, color: 0x7a1418, stiffness: 0.1, drag: 3.2, rest: [-0.35, -1, 0.05] },
    { bone: 'Hips', offset: [-0.16, 0.06, 0.07], length: 0.5, width: 0.085, tipWidth: 0.07, nodes: 8, color: 0x64100f, stiffness: 0.12, drag: 3.2, rest: [-0.5, -1, -0.1] },
  ],
  lingshuang: [
    // 腰封后面的两条饰带（发带不做了：马尾本身有弹簧骨骼）
    { bone: 'Hips', offset: [-0.13, 0.06, 0.09], length: 0.54, width: 0.07, tipWidth: 0.058, nodes: 9, color: 0x232e52, stiffness: 0.1, drag: 3.4, rest: [-0.35, -1, 0.05] },
    { bone: 'Hips', offset: [-0.14, 0.05, 0.03], length: 0.42, width: 0.064, tipWidth: 0.052, nodes: 8, color: 0x1b2440, stiffness: 0.12, drag: 3.4, rest: [-0.5, -1, -0.1] },
  ],
};

export class RibbonSet {
  readonly group = new THREE.Group();
  private ribbons: Ribbon[] = [];
  private hips = new THREE.Vector3(); private chest = new THREE.Vector3(); private head = new THREE.Vector3();
  private ready = false;

  constructor(private rig: Rig, specs: RibbonSpec[]) {
    const cache = new Map<string, THREE.Texture>();
    for (const s of specs) {
      if (!rig.bones[s.bone]) continue;
      const key = `${s.color}/${s.edge}`;
      let tex = cache.get(key); if (!tex) { tex = ribbonTexture(s.color, s.edge); cache.set(key, tex); }
      const r = new Ribbon(rig, s, tex);
      this.ribbons.push(r); this.group.add(r.mesh);
    }
  }

  /** 角色摆好第一帧姿势之后调用。 */
  init() { this.rig.root.updateMatrixWorld(true); for (const r of this.ribbons) r.init(); this.ready = true; }
  reset() { if (this.ready) for (const r of this.ribbons) r.reset(); }

  update(dt: number, time: number, camera: THREE.Camera) {
    if (!this.ready || dt <= 0) return;
    this.rig.boneWorld('Hips', this.hips); this.rig.boneWorld('Spine2', this.chest);
    const r = 0.17 * (this.rig.height / 1.8);
    this.rig.boneWorld('Head', this.head);
    const backX = -Math.sign(this.rig.face.scale.x || 1);
    for (const rb of this.ribbons) rb.step(dt, time, camera, this.hips, this.chest, r, backX, this.head);
  }

  dispose() { for (const r of this.ribbons) { r.mesh.geometry.dispose(); (r.mesh.material as THREE.Material).dispose(); } }
}
