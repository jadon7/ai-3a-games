import * as THREE from 'three';
import { rand } from '../core/math';
import type { FighterView } from '../present/fighterView';
import { FX_FRAG_HEAD, type MeshFxHandle } from './core';
import type { FxCtx } from './types';

/**
 * 凌霜（霜刃）特效的辅助代码：配色、刀的位置、几种自己的着色器和网格特效。
 * 只有 lingshuang.ts 用。
 */

// ───────────────────────────── 配色 ─────────────────────────────
/** 白 → 冰青 → 蓝。数值是线性空间的基色。 */
export const C = {
  white: 0xf2fcff,
  ice: 0xa6eaff,
  cyan: 0x6fd2ff,
  blue: 0x3f9cf0,
  deep: 0x1d4fb0,
  mist: 0x9cc6e6,
  frost: 0xcfe9ff,
  light: 0x7cc8ff,
};

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();

// ───────────────────────────── 刀 ─────────────────────────────
/**
 * 刀的世界坐标（刀镡、刀尖）。正式模型有 weapon 定义直接取；替身没有，就用右手的位置
 * 沿前臂方向、再往前偏一点“接”出一把 0.85 米长的虚拟刀。返回是否是真的刀。
 */
export function bladeWorld(self: FighterView, base: THREE.Vector3, tip: THREE.Vector3): boolean {
  if (self.rig.weaponWorld(base, tip)) return true;
  self.rig.limbWorld('RH', base);
  self.rig.limbWorld('RE', _v1);
  _v2.subVectors(base, _v1);
  const l = _v2.length() || 1;
  _v2.multiplyScalar(1 / l);
  _v2.x += self.fighter.facing * 0.55; _v2.y += 0.05;
  _v2.normalize();
  tip.copy(base).addScaledVector(_v2, 0.85 * (self.fighter.scale || 1));
  return false;
}

// ───────────────────────────── 着色器 ─────────────────────────────
/** 支持实例化的顶点着色器（冰晶碎片用 InstancedMesh）。varying 和 FX_VERT 一样。 */
export const ICE_VERT = /* glsl */ `varying vec2 vUv; varying vec3 vWorld; varying vec3 vNormalW; varying vec3 vView;
  void main() {
    vUv = uv; vec4 lp = vec4(position, 1.0); vec3 nn = normal;
    #ifdef USE_INSTANCING
      lp = instanceMatrix * lp; nn = mat3(instanceMatrix) * nn;
    #endif
    vec4 w = modelMatrix * lp; vWorld = w.xyz; vNormalW = mat3(modelMatrix) * nn; vNormalW = (dot(vNormalW, vNormalW) > 1e-12 ? normalize(vNormalW) : vec3(0.0, 1.0, 0.0)); vView = normalize(cameraPosition - w.xyz);
    gl_Position = projectionMatrix * viewMatrix * w; }`;

/** 冰：菲涅尔边缘、两道锐利高光、内部的裂纹（细胞噪声边界，随视角偏移，假装折射）、顶端偏亮。普通混合。 */
const ICE_FRAG = FX_FRAG_HEAD + /* glsl */ `
  uniform float uFade; uniform float uGlow;
  void main() {
    vec3 n = (dot(vNormalW, vNormalW) > 1e-12 ? normalize(vNormalW) : vec3(0.0, 1.0, 0.0)); vec3 v = normalize(vView);
    if (dot(n, v) < 0.0) n = -n;
    float ndv = clamp(dot(n, v), 0.0, 1.0);
    float fres = pow(max(1.0 - ndv, 0.0), 2.4);
    vec3 r = reflect(-v, n);
    float spec = pow(max(dot(r, normalize(vec3(-0.35, 0.85, 0.45))), 0.0), 42.0) * 2.4
               + pow(max(dot(r, normalize(vec3(0.7, 0.25, -0.6))), 0.0), 16.0) * 0.6;
    vec2 ruv = vWorld.xy * 0.9 + vWorld.z * 0.4 + n.xy * 0.22 + v.xy * 0.18 + uSeed;
    // 内部的裂纹：噪声的“山脊”（值接近 0.5 的细线），两个尺度
    float r1 = texture2D(uNoise, ruv * 0.6).r, r2 = texture2D(uNoise, ruv * 1.7 + 0.3).g;
    float cracks = smoothstep(0.93, 0.995, 1.0 - abs(r1 * 2.0 - 1.0)) + smoothstep(0.95, 0.997, 1.0 - abs(r2 * 2.0 - 1.0)) * 0.6;
    float depth = texture2D(uNoise, ruv * 0.45).r;
    float h = clamp(vUv.y, 0.0, 1.0);
    // 棱面：按法线方向给每个面不同的明暗，棱角才分明
    float facet = 0.5 + 0.5 * dot(n, normalize(vec3(-0.35, 0.55, 0.75)));
    vec3 body = mix(uColorB * 0.06, uColorB * 0.5, facet * facet) * (0.8 + 0.3 * depth) + uColorB * 0.15 * (1.0 - ndv);
    vec3 col = body + uColorA * fres * 1.1 + vec3(1.0) * spec + uColorA * cracks * (0.5 + 0.5 * depth) + uColorA * pow(max(h, 0.0), 5.0) * 0.7 + uColorA * uGlow;
    float a = clamp(0.5 + fres * 0.45 + spec * 0.4 + cracks * 0.2 + uGlow * 0.4, 0.0, 1.0) * uFade;
    gl_FragColor = vec4(col * uPower, a);
  }`;

/**
 * 月牙弧光：uv.x 沿弧（0 尾、1 头），uv.y 沿半径（0 内、1 外刃）。
 * 外刃一条极细的白亮线，往里是半透明的冰青身子和细丝，尾部先被噪声侵蚀掉。加法混合。
 */
const ARC_FRAG = FX_FRAG_HEAD + /* glsl */ `
  uniform float uEdge; uniform float uBody; uniform float uIce;
  void main() {
    float along = vUv.x, rad = vUv.y;
    float n = texture2D(uNoise, vec2(along * 2.2 - uTime * 1.4 + uSeed, rad * 0.6 + uSeed * 2.7)).r;
    float n2 = texture2D(uNoise, vec2(along * 7.0 - uTime * 2.5 + uSeed, rad * 1.3)).g;
    float cellv = texture2D(uNoise, vec2(along * 3.0 + uSeed, rad * 0.8 + uSeed)).b;
    // 前 22% 的寿命里刀头从尾扫到头（看得出挥的方向），之后尾巴先散
    float reveal = uLife / 0.22;
    float drawn = 1.0 - smoothstep(reveal - 0.03, reveal + 0.02, along);
    float headK = reveal < 1.05 ? exp(-(((along - reveal) / 0.05) * ((along - reveal) / 0.05))) : 0.0;
    float edgeLine = exp(-(((1.0 - rad) / 0.065) * ((1.0 - rad) / 0.065)));         // 外刃：细而亮
    float body = pow(max(rad, 0.0), 1.9) * (0.45 + 0.55 * n);                  // 身子：贴着刃口，往里很快变透明
    float streak = smoothstep(0.5, 0.88, n2) * rad * rad;           // 顺着弧的细丝
    float crack = smoothstep(0.1, 0.03, cellv) * rad * uIce;
    float head = smoothstep(0.0, 0.45, along) * smoothstep(1.0, 0.95, along);
    float cut = (uLife - 0.18) * 1.5 - along * 0.55;
    float er = smoothstep(cut, cut + 0.25, n * 0.75 + 0.3);
    float fade = 1.0 - smoothstep(0.7, 1.0, uLife);
    float k = head * er * fade * drawn;
    float aEdge = edgeLine * k * uEdge * (0.45 + 0.55 * along) + headK * edgeLine * 1.5 * fade;
    float aBody = k * (body * 0.4 + streak * 0.35 + crack * 0.3) * uBody;
    vec3 col = uColorA * aEdge * 2.3 + mix(uColorB, uColorA, rad * rad) * aBody;
    gl_FragColor = vec4(col * uPower, clamp(aEdge + aBody, 0.0, 1.0));
  }`;

/**
 * 细长斩痕：一个对着镜头的长条。uv.x 从 A 到 B，uv.y 横向。
 * uDraw 是从 A 画到 B 的进度（画的时候头上有一点亮），uCore 是芯的亮度，uThin 是芯的粗细。
 */
const STREAK_FRAG = FX_FRAG_HEAD + /* glsl */ `
  uniform float uDraw; uniform float uFade; uniform float uCore; uniform float uThin; uniform float uHalo; uniform float uTaper;
  void main() {
    float x = vUv.x, y = abs(vUv.y - 0.5) * 2.0;
    float drawn = 1.0 - smoothstep(uDraw - 0.02, uDraw + 0.005, x);
    float tp = pow(clamp(sin(3.14159 * x), 0.0, 1.0), uTaper);
    float w = max(uThin * tp, 1e-3);
    float core = exp(-((y / w) * (y / w)));
    float n = texture2D(uNoise, vec2(x * 3.0 + uSeed, uTime * 0.6 + uSeed)).r;
    float halo = exp(-((y / (0.5 * tp + 1e-3)) * (y / (0.5 * tp + 1e-3)))) * uHalo * (0.6 + 0.6 * n);
    float headK = uDraw < 0.999 ? exp(-(((x - uDraw) / 0.035) * ((x - uDraw) / 0.035))) * exp(-y * y * 30.0) * 2.5 : 0.0;
    float a = (core * uCore + halo + headK) * drawn * uFade;
    vec3 col = uColorA * (core * uCore + headK) + uColorB * halo;
    gl_FragColor = vec4(col * uPower * drawn * uFade, clamp(a, 0.0, 1.0));
  }`;

/**
 * 地上的霜：从 A 到 B 的一条（A = B 时是一个圆），半宽 uW。用世界坐标取噪声，拉伸不变形。
 * 边缘参差、里面有冰晶的细线，蔓延的前沿一条亮边。普通混合，霜是“实”的东西。
 */
const FROST_FRAG = FX_FRAG_HEAD + /* glsl */ `
  uniform vec2 uA; uniform vec2 uB; uniform float uW; uniform float uFade; uniform float uFront; uniform float uTip; uniform float uZ;
  void main() {
    vec2 p = vWorld.xz;
    vec2 pz = vec2(p.x, uA.y + (p.y - uA.y) * uZ);
    vec2 ab = uB - uA; float L = length(ab);
    float t = L > 1e-4 ? clamp(dot(p - uA, ab) / (L * L), 0.0, 1.0) : 0.0;
    float d = length(pz - (uA + ab * t));
    float n = texture2D(uNoise, p * 0.32 + uSeed).r;
    float n2 = texture2D(uNoise, p * 1.15 - uSeed).g;
    float hi = texture2D(uNoise, p * 2.3 + uSeed * 0.5).a;
    float w = uW * mix(1.0, uTip, t) * (0.55 + 0.75 * n);
    float cover = 1.0 - smoothstep(w * 0.55, w, d);
    float c1 = texture2D(uNoise, p * 0.45 + uSeed).r;
    float c2 = texture2D(uNoise, p * 1.3 - uSeed * 1.3).g;
    float c3 = texture2D(uNoise, p * 3.1 + uSeed * 0.7).a;
    // 冰晶的细纹：噪声的山脊线，三个尺度叠起来像霜花
    float lines = smoothstep(0.9, 0.99, 1.0 - abs(c1 * 2.0 - 1.0)) * 0.9 + smoothstep(0.9, 0.99, 1.0 - abs(c2 * 2.0 - 1.0)) * 0.6 + smoothstep(0.88, 0.98, 1.0 - abs(c3 * 2.0 - 1.0)) * 0.35;
    // 前沿：圆形的是外圈，条形的是 B 端
    float front;
    if (L < 1e-3) front = exp(-(((d - w * 0.78) / (0.07 + 0.05 * uW)) * ((d - w * 0.78) / (0.07 + 0.05 * uW)))) * smoothstep(0.3, 0.7, n2);
    else front = exp(-((length(p - uB) / (0.35 + uW * 0.3)) * (length(p - uB) / (0.35 + uW * 0.3))));
    front *= uFront;
    vec3 base = uColorB * (0.22 + 0.3 * n2 + 0.2 * hi);
    front *= smoothstep(0.25, 0.75, hi);
    vec3 col = base + uColorA * lines * 0.9 + uColorA * front * 1.7;
    float a = (cover * (0.38 + lines * 0.5 + n2 * 0.18) + front * 0.65 * cover) * uFade;
    if (a < 0.003) discard;
    gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  }`;

/** 星芒：十字长芒 + 斜向短芒 + 小亮核。对着镜头。 */
const STAR_FRAG = FX_FRAG_HEAD + /* glsl */ `
  uniform float uRot;
  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float cs = cos(uRot), sn = sin(uRot);
    p = vec2(cs * p.x - sn * p.y, sn * p.x + cs * p.y);
    vec2 q = vec2(0.7071 * (p.x - p.y), 0.7071 * (p.x + p.y));
    float r = length(p);
    float rays = exp(-abs(p.x) * 55.0) * exp(-abs(p.y) * 2.4) + exp(-abs(p.y) * 55.0) * exp(-abs(p.x) * 2.4);
    float rays2 = (exp(-abs(q.x) * 70.0) * exp(-abs(q.y) * 6.0) + exp(-abs(q.y) * 70.0) * exp(-abs(q.x) * 6.0)) * 0.45;
    float core = exp(-r * r * 90.0);
    float env = pow(max(sin(3.14159 * clamp(uLife, 0.0, 1.0)), 0.0), 1.4);
    float a = (rays + rays2 + core * 2.0) * env;
    gl_FragColor = vec4(mix(uColorB, uColorA, clamp(core * 2.0 + rays * 0.5, 0.0, 1.0)) * uPower * a, clamp(a, 0.0, 1.0));
  }`;

/** 竖在 YZ 平面里的冲击环（突刺时套在刀尖上的那一圈）。 */
const RING_FRAG = FX_FRAG_HEAD + /* glsl */ `
  void main() {
    vec2 p = vUv - 0.5; float r = length(p) * 2.0; float ang = atan(p.y, p.x);
    float R = mix(0.15, 0.95, 1.0 - pow(max(1.0 - uLife, 0.0), 3.0));
    float n = texture2D(uNoise, vec2(ang * 0.32 + uSeed, r * 0.6 - uTime * 0.25)).r;
    float w = 0.06 * (0.6 + n * 0.8) * (1.0 - uLife * 0.5);
    float ring = exp(-(((r - R) / w) * ((r - R) / w)));
    float a = ring * (1.0 - uLife) * (1.0 - smoothstep(0.9, 1.0, r));
    gl_FragColor = vec4(mix(uColorB, uColorA, ring) * uPower * a, a);
  }`;

// ───────────────────────────── 几何 ─────────────────────────────
/**
 * 世界坐标里的一段弧（月牙）：圆心 c，平面由 e1（角度 0）和 e2（角度 +90°）张成。
 * 从 a0 扫到 a1，外半径 r，厚度 w 沿弧按 sin 形状变化（两头尖、偏头部最厚），
 * uv.x 0 是尾、1 是头；uv.y 0 内、1 外刃。
 */
export function arcGeo(c: THREE.Vector3, e1: THREE.Vector3, e2: THREE.Vector3, r: number, w: number, a0: number, a1: number, segs = 48, headBias = 0.62): THREE.BufferGeometry {
  const pos = new Float32Array((segs + 1) * 2 * 3), uv = new Float32Array((segs + 1) * 2 * 2), idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, a = a0 + (a1 - a0) * t;
    // 头部偏厚：用分段的 sin
    const s = t < headBias ? Math.sin((t / headBias) * Math.PI * 0.5) : Math.cos(((t - headBias) / (1 - headBias)) * Math.PI * 0.5);
    const th = w * Math.pow(Math.max(0, s), 0.7);
    const ca = Math.cos(a), sa = Math.sin(a);
    const dx = e1.x * ca + e2.x * sa, dy = e1.y * ca + e2.y * sa, dz = e1.z * ca + e2.z * sa;
    const ri = r - th;
    pos.set([c.x + dx * ri, c.y + dy * ri, c.z + dz * ri, c.x + dx * r, c.y + dy * r, c.z + dz * r], i * 6);
    uv.set([t, 0, t, 1], i * 4);
    if (i < segs) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(idx);
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(pos.length), 3));
  return g;
}

/** 一根冰晶：六棱柱 + 尖顶（车床几何，拆成不共享顶点的面，法线是平的 → 棱面分明）。uv.y 从底到尖。 */
export function crystalGeo(r: number, h: number, sides = 6, tipK = 0.32): THREE.BufferGeometry {
  const pts = [new THREE.Vector2(r * 0.55, 0), new THREE.Vector2(r, h * 0.08), new THREE.Vector2(r * 0.92, h * (1 - tipK)), new THREE.Vector2(0.0001, h)];
  const g = new THREE.LatheGeometry(pts, sides).toNonIndexed();
  g.computeVertexNormals();
  return g;
}

/** 碎冰片：拉长的八面体，平面法线。 */
export function shardGeo(): THREE.BufferGeometry {
  const g = new THREE.OctahedronGeometry(1, 0).toNonIndexed();
  g.scale(0.45, 1.0, 0.28);
  g.computeVertexNormals();
  return g;
}
const SHARD_GEO = shardGeo();
const QUAD = new THREE.PlaneGeometry(1, 1);
const FLOOR = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

// ───────────────────────────── 材质 ─────────────────────────────
export function iceMaterial(ctx: FxCtx, power = 1.0, colA: THREE.ColorRepresentation = C.ice, colB: THREE.ColorRepresentation = C.blue) {
  return ctx.fx.material(ICE_FRAG, colA, colB, power, { uFade: { value: 1 }, uGlow: { value: 0 } }, { vertexShader: ICE_VERT, blending: THREE.NormalBlending, side: THREE.FrontSide, depthWrite: true });
}

// ───────────────────────────── 网格特效 ─────────────────────────────
export interface ArcOpts { width?: number; life?: number; power?: number; edge?: number; body?: number; ice?: number; colA?: THREE.ColorRepresentation; colB?: THREE.ColorRepresentation; segs?: number; grow?: number }

/** 一道月牙弧光（世界坐标里任意平面）。life 很短，出手那一下最亮，尾巴先散。 */
export function arcSlash(ctx: FxCtx, c: THREE.Vector3, e1: THREE.Vector3, e2: THREE.Vector3, r: number, a0: number, a1: number, o: ArcOpts = {}): MeshFxHandle {
  const geo = arcGeo(c, e1, e2, r, r * (o.width ?? 0.3), a0, a1, o.segs ?? 56);
  const mat = ctx.fx.material(ARC_FRAG, o.colA ?? C.white, o.colB ?? C.cyan, o.power ?? 1.6, { uEdge: { value: o.edge ?? 1 }, uBody: { value: o.body ?? 1 }, uIce: { value: o.ice ?? 0.35 } });
  const m = new THREE.Mesh(geo, mat); m.renderOrder = 23;
  const grow = o.grow ?? 0.06;
  // 扩散：以圆心为中心放大一点
  return ctx.fx.addMesh(m, o.life ?? 0.2, (k) => {
    mat.uniforms.uLife.value = k; mat.uniforms.uTime.value = ctx.fx.time;
    const s = 1 + grow * (1 - (1 - k) * (1 - k));
    m.position.set(c.x * (1 - s), c.y * (1 - s), c.z * (1 - s)); m.scale.setScalar(s);
  });
}

/**
 * 用两个方向定一道弧：从 vFrom 扫到 vTo（都是从圆心出发的方向，不必单位化），
 * sweep 不给就用两向量的夹角；ahead 是越过 vTo 再多扫的角度；n 给了就用它当平面法线（扫一整圈时用）。
 */
export function arcFromTo(ctx: FxCtx, c: THREE.Vector3, vFrom: THREE.Vector3, vTo: THREE.Vector3, r: number, o: ArcOpts & { sweep?: number; ahead?: number; n?: THREE.Vector3 } = {}) {
  const e1 = new THREE.Vector3().copy(vFrom).normalize();
  const to = new THREE.Vector3().copy(vTo).normalize();
  const n = o.n ? o.n.clone().normalize() : new THREE.Vector3().crossVectors(e1, to);
  if (n.lengthSq() < 1e-6) n.set(0, 0, 1);
  n.normalize();
  // e1 要和法线垂直
  e1.addScaledVector(n, -e1.dot(n)).normalize();
  const e2 = new THREE.Vector3().crossVectors(n, e1).normalize();
  const sweep = o.sweep ?? Math.acos(THREE.MathUtils.clamp(e1.dot(to), -1, 1));
  return arcSlash(ctx, c, e1, e2, r, 0, sweep + (o.ahead ?? 0), o);
}

export interface StreakOpts { life?: number; draw?: number; core?: number; thin?: number; halo?: number; width?: number; power?: number; colA?: THREE.ColorRepresentation; colB?: THREE.ColorRepresentation; taper?: number; hold?: boolean }

/**
 * 一条细长的光（斩痕、贯穿线、光枪）：A 到 B，始终对着镜头。
 * 前 draw 秒从 A 画到 B，之后按寿命淡出；hold 为真时不淡，等外面把 dead 置真或改参数。
 * 返回的句柄上挂着 a、b（可以每帧改）和材质。
 */
export interface Streak { h: MeshFxHandle; a: THREE.Vector3; b: THREE.Vector3; mat: THREE.ShaderMaterial; width: number; t: number; fadeK: number }
export function streak(ctx: FxCtx, a: THREE.Vector3, b: THREE.Vector3, o: StreakOpts = {}): Streak {
  const mat = ctx.fx.material(STREAK_FRAG, o.colA ?? C.white, o.colB ?? C.cyan, o.power ?? 1.4, {
    uDraw: { value: 0 }, uFade: { value: 1 }, uCore: { value: o.core ?? 2.2 }, uThin: { value: o.thin ?? 0.1 }, uHalo: { value: o.halo ?? 0.35 }, uTaper: { value: o.taper ?? 0.6 },
  });
  const m = new THREE.Mesh(QUAD, mat); m.renderOrder = 24;
  const s: Streak = { h: null as unknown as MeshFxHandle, a: a.clone(), b: b.clone(), mat, width: o.width ?? 0.16, t: 0, fadeK: 1 };
  const draw = o.draw ?? 0.06, life = o.life ?? 0.35;
  s.h = ctx.fx.addMesh(m, o.hold ? 1e6 : life, (_k, dt) => {
    s.t += dt;
    mat.uniforms.uTime.value = ctx.fx.time;
    const dk = draw <= 0 ? 1 : Math.min(1, s.t / draw);
    mat.uniforms.uDraw.value = 1 - (1 - dk) * (1 - dk) * (1 - dk) + (dk >= 1 ? 0.05 : 0);
    if (!o.hold) { const k = Math.max(0, (s.t - draw) / Math.max(0.001, life - draw)); mat.uniforms.uFade.value = s.fadeK * (1 - k) * (1 - k); mat.uniforms.uThin.value = (o.thin ?? 0.1) * (1 - 0.6 * k); }
    else mat.uniforms.uFade.value = s.fadeK;
    orientStreak(ctx, m, s.a, s.b, s.width);
  });
  s.h.geos.length = 0;
  orientStreak(ctx, m, s.a, s.b, s.width);
  return s;
}

/** 让一个单位方片从 A 伸到 B，宽度方向和视线垂直。 */
function orientStreak(ctx: FxCtx, m: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, width: number) {
  const x = _v1.subVectors(b, a); const len = x.length() || 1e-4; x.multiplyScalar(1 / len);
  m.position.addVectors(a, b).multiplyScalar(0.5);
  const view = _v2.subVectors(ctx.gfx.camera.position, m.position).normalize();
  const y = _v3.crossVectors(view, x); if (y.lengthSq() < 1e-6) y.set(0, 1, 0); y.normalize();
  const z = _v4.crossVectors(x, y).normalize();
  _m.makeBasis(x, y, z); m.quaternion.setFromRotationMatrix(_m);
  m.scale.set(len, width, 1);
}

/** 星芒闪光。pos 可以是一个会被外面每帧更新的向量（跟着刀尖走）。 */
export function glint(ctx: FxCtx, pos: THREE.Vector3, size: number, life = 0.3, power = 2.4, follow = true) {
  const mat = ctx.fx.material(STAR_FRAG, C.white, C.cyan, power, { uRot: { value: rand(-0.3, 0.3) } });
  const m = new THREE.Mesh(QUAD, mat); m.renderOrder = 26; m.scale.setScalar(size);
  const p = follow ? pos : pos.clone();
  const rot0 = mat.uniforms.uRot.value as number;
  const h = ctx.fx.addMesh(m, life, (k) => {
    mat.uniforms.uLife.value = k; mat.uniforms.uRot.value = rot0 + k * 0.5;
    m.position.copy(p); m.quaternion.copy(ctx.gfx.camera.quaternion);
  });
  h.geos.length = 0;
  m.position.copy(p);
  return h;
}

/** 套在刀尖上、竖在 YZ 平面里的冲击环（从侧面看是一道竖的椭圆）。 */
export function lanceRing(ctx: FxCtx, c: THREE.Vector3, size: number, life = 0.25, power = 2) {
  const mat = ctx.fx.material(RING_FRAG, C.white, C.cyan, power);
  const m = new THREE.Mesh(QUAD, mat); m.renderOrder = 21; m.position.copy(c); m.rotation.y = Math.PI / 2; m.scale.setScalar(size);
  const h = ctx.fx.addMesh(m, life, (k) => { mat.uniforms.uLife.value = k; mat.uniforms.uTime.value = ctx.fx.time; });
  h.geos.length = 0;
  return h;
}

export interface FrostOpts { width: number; zK?: number; life?: number; spread?: number; front?: number; tip?: number; hold?: number; colA?: THREE.ColorRepresentation; colB?: THREE.ColorRepresentation }
export interface Frost { h: MeshFxHandle; mat: THREE.ShaderMaterial; a: THREE.Vector2; b: THREE.Vector2; target: THREE.Vector2; w: number; t: number }
/**
 * 地上的霜：从 (ax, az) 蔓延到 (bx, bz)（相同就是从中心向外扩成圆）。spread 秒长满，
 * hold 秒后开始化掉，life 秒消失。返回的句柄可以每帧改 target（跟着飞行道具走）。
 */
export function frost(ctx: FxCtx, ax: number, az: number, bx: number, bz: number, o: FrostOpts): Frost {
  const life = o.life ?? 5, spread = o.spread ?? 0.4, hold = o.hold ?? life * 0.55;
  const mat = ctx.fx.material(FROST_FRAG, o.colA ?? C.frost, o.colB ?? C.mist, 1, {
    uA: { value: new THREE.Vector2(ax, az) }, uB: { value: new THREE.Vector2(ax, az) }, uW: { value: 0.01 }, uFade: { value: 1 }, uFront: { value: o.front ?? 1 }, uTip: { value: o.tip ?? 1 }, uZ: { value: o.zK ?? 1 },
  }, { blending: THREE.NormalBlending, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const m = new THREE.Mesh(FLOOR, mat); m.renderOrder = 6;
  const fr: Frost = { h: null as unknown as MeshFxHandle, mat, a: mat.uniforms.uA.value, b: mat.uniforms.uB.value, target: new THREE.Vector2(bx, bz), w: o.width, t: 0 };
  const radial = Math.abs(ax - bx) + Math.abs(az - bz) < 1e-3;
  fr.h = ctx.fx.addMesh(m, life, (_k, dt) => {
    fr.t += dt;
    const g = Math.min(1, fr.t / spread), e = 1 - Math.pow(1 - g, 2.2);
    if (radial) { mat.uniforms.uW.value = fr.w * e; }
    else { fr.b.set(fr.a.x + (fr.target.x - fr.a.x) * e, fr.a.y + (fr.target.y - fr.a.y) * e); mat.uniforms.uW.value = fr.w * Math.min(1, 0.4 + e); }
    mat.uniforms.uFront.value = (o.front ?? 1) * Math.max(0, 1 - Math.max(0, fr.t - spread * 0.7) / 0.5);
    mat.uniforms.uFade.value = Math.min(1, fr.t / 0.05) * (fr.t > hold ? Math.max(0, 1 - (fr.t - hold) / Math.max(0.01, life - hold)) : 1);
    // 方片罩住整个范围
    const minx = Math.min(fr.a.x, fr.b.x) - fr.w * 1.4, maxx = Math.max(fr.a.x, fr.b.x) + fr.w * 1.4;
    const zk = o.zK ?? 1, minz = Math.min(fr.a.y, fr.b.y) - (fr.w * 1.4) / zk, maxz = Math.max(fr.a.y, fr.b.y) + (fr.w * 1.4) / zk;
    m.position.set((minx + maxx) / 2, 0.014, (minz + maxz) / 2); m.scale.set(maxx - minx, 1, maxz - minz);
  });
  fr.h.geos.length = 0;
  return fr;
}

/**
 * 一丛冰晶：count 根，主的一根最高。dirs 决定朝向（ground：从地里斜着刺出来；burst：从一个中心向四周炸开）。
 * 长出来（rise 秒，带一点回弹）、停住、在 life 末尾消失（碎掉由外面放 shatter）。返回句柄、组、材质。
 */
export interface ClusterOpts { vspread?: number; count?: number; height: number; radius?: number; rise?: number; life?: number; lean?: number; dir?: number; mode?: 'ground' | 'burst'; power?: number; widthK?: number }
export interface Cluster { h: MeshFxHandle; group: THREE.Group; mat: THREE.ShaderMaterial; tips: THREE.Vector3[] }
export function iceCluster(ctx: FxCtx, pos: THREE.Vector3, o: ClusterOpts): Cluster {
  const group = new THREE.Group();
  const mat = iceMaterial(ctx, o.power ?? 1);
  const n = o.count ?? 5, rise = o.rise ?? 0.1, life = o.life ?? 0.9, dir = o.dir ?? 1;
  const tips: THREE.Vector3[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < n; i++) {
    const main = i === 0;
    const h = o.height * (main ? 1 : rand(0.35, 0.78));
    const r = h * rand(0.1, 0.15) * (o.widthK ?? 1);
    const g = crystalGeo(r, h, main ? 6 : 5, rand(0.22, 0.4));
    const m = new THREE.Mesh(g, mat); m.renderOrder = 17;
    let d: THREE.Vector3;
    if ((o.mode ?? 'ground') === 'ground') {
      const ang = rand(0, Math.PI * 2), rr = main ? 0 : rand(0.25, 1) * (o.radius ?? 0.4);
      m.position.set(Math.cos(ang) * rr, -0.05, Math.sin(ang) * rr * 0.8);
      // 往外、往前斜
      const lean = (o.lean ?? 0.35) * (main ? 0.4 : 1);
      d = new THREE.Vector3(Math.cos(ang) * lean + dir * 0.18, 1, Math.sin(ang) * lean * 0.8).normalize();
    } else {
      // 从中心向外：偏上、两侧，少量向下
      const th = rand(0, Math.PI * 2), ph = rand(0.15, o.vspread ? 2.5 : 1.9);
      d = new THREE.Vector3(Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th) * 0.8).normalize();
      if (main) d.set(dir * 0.2, 1, 0).normalize();
      m.position.copy(d).multiplyScalar(rand(0.05, 0.25) * (o.radius ?? 0.4));
      if (o.vspread) m.position.y += rand(-1, 1) * o.vspread;
    }
    m.quaternion.setFromUnitVectors(up, d);
    m.rotateY(rand(0, 6.28));
    m.userData.delay = main ? 0 : rand(0, 0.5);
    m.scale.setScalar(0.001);
    group.add(m);
    tips.push(new THREE.Vector3().copy(m.position).addScaledVector(d, h));
  }
  group.position.copy(pos);
  const h = ctx.fx.addMesh(group, life, (k) => {
    const t = k * life;
    for (const c of group.children) {
      const dl = (c.userData.delay as number) * rise;
      const g = Math.min(1, Math.max(0, (t - dl) / rise));
      // 冲出来带一点过冲
      const e = g < 1 ? 1 - Math.pow(1 - g, 3) * (1 - 0.0) + Math.sin(g * Math.PI) * 0.12 : 1;
      c.scale.set(0.75 + 0.25 * e, Math.max(0.001, e), 0.75 + 0.25 * e);
    }
    mat.uniforms.uTime.value = ctx.fx.time;
    mat.uniforms.uFade.value = 1 - Math.max(0, (k - 0.93) / 0.07);
  });
  return { h, group, mat, tips };
}

/**
 * 碎冰：一把会旋转、受重力、在地上弹一下的冰片（InstancedMesh，一次一个材质）。
 * 每帧只改实例矩阵，不新建对象。
 */
export function shatter(ctx: FxCtx, pos: THREE.Vector3, o: { count: number; spread?: number; speed?: [number, number]; size?: [number, number]; life?: [number, number]; dir?: THREE.Vector3; cone?: number; gravity?: number; up?: number; power?: number; spreadY?: number }) {
  const n = o.count, mat = iceMaterial(ctx, o.power ?? 1.15, C.white, C.cyan);
  const im = new THREE.InstancedMesh(SHARD_GEO, mat, n); im.renderOrder = 17; im.frustumCulled = false;
  const P = new Float32Array(n * 3), V = new Float32Array(n * 3), R = new Float32Array(n * 3), W = new Float32Array(n * 3), S = new Float32Array(n), L = new Float32Array(n);
  const sp = o.speed ?? [2, 7], sz = o.size ?? [0.03, 0.09], lf = o.life ?? [0.5, 1.1], g = o.gravity ?? 12, spread = o.spread ?? 0.2;
  const dir = o.dir ? o.dir.clone().normalize() : null, cone = o.cone ?? 1.0;
  for (let i = 0; i < n; i++) {
    P[i * 3] = pos.x + rand(-spread, spread); P[i * 3 + 1] = pos.y + rand(-spread, spread) * (o.spreadY ?? 1); P[i * 3 + 2] = pos.z + rand(-spread, spread) * 0.6;
    let vx = rand(-1, 1), vy = rand(-1, 1), vz = rand(-1, 1); const l = Math.hypot(vx, vy, vz) || 1; vx /= l; vy /= l; vz /= l;
    if (dir) { vx = dir.x + vx * cone; vy = dir.y + vy * cone; vz = dir.z + vz * cone; const l2 = Math.hypot(vx, vy, vz) || 1; vx /= l2; vy /= l2; vz /= l2; }
    const s = rand(sp[0], sp[1]);
    V[i * 3] = vx * s; V[i * 3 + 1] = vy * s + (o.up ?? 1.5); V[i * 3 + 2] = vz * s * 0.6;
    R[i * 3] = rand(0, 6.28); R[i * 3 + 1] = rand(0, 6.28); R[i * 3 + 2] = rand(0, 6.28);
    W[i * 3] = rand(-14, 14); W[i * 3 + 1] = rand(-14, 14); W[i * 3 + 2] = rand(-14, 14);
    S[i] = rand(sz[0], sz[1]) * (Math.random() < 0.15 ? 1.8 : 1); L[i] = rand(lf[0], lf[1]);
  }
  const maxL = Math.max(...L);
  let t = 0;
  const e = new THREE.Euler();
  const step = (dt: number) => {
    t += dt;
    for (let i = 0; i < n; i++) {
      const j = i * 3;
      if (t < L[i]) {
        V[j + 1] -= g * dt; const dk = Math.exp(-0.8 * dt); V[j] *= dk; V[j + 2] *= dk;
        P[j] += V[j] * dt; P[j + 1] += V[j + 1] * dt; P[j + 2] += V[j + 2] * dt;
        if (P[j + 1] < 0.02 && V[j + 1] < 0) { P[j + 1] = 0.02; V[j + 1] *= -0.28; V[j] *= 0.5; V[j + 2] *= 0.5; W[j] *= 0.5; W[j + 1] *= 0.5; W[j + 2] *= 0.5; }
        R[j] += W[j] * dt; R[j + 1] += W[j + 1] * dt; R[j + 2] += W[j + 2] * dt;
      }
      const k = Math.min(1, t / L[i]);
      const sc = S[i] * (k < 0.75 ? 1 : Math.max(0, 1 - (k - 0.75) / 0.25));
      e.set(R[j], R[j + 1], R[j + 2]); _q.setFromEuler(e); _s.setScalar(Math.max(1e-4, sc));
      _m.compose(_v1.set(P[j], P[j + 1], P[j + 2]), _q, _s);
      im.setMatrixAt(i, _m);
    }
    im.instanceMatrix.needsUpdate = true;
  };
  step(0);
  const h = ctx.fx.addMesh(im, maxL, (_k, dt) => { step(dt); });
  h.geos.length = 0;   // 共用的碎片几何体不释放
  return h;
}

/**
 * 霜月斩的月牙冰刃：两头尖、中间厚的弧，凸面朝前。外刃一条薄而亮的线，身子是半透明的冰（细丝往后流、冰裂纹），
 * uDis 从 0 到 1 是消散（噪声侵蚀）。uv.x 从下尖到上尖，uv.y 0 内、1 外刃。
 */
const CRESCENT_FRAG = FX_FRAG_HEAD + /* glsl */ `
  uniform float uDis; uniform float uEdge; uniform float uBody;
  void main() {
    float along = vUv.x, rad = vUv.y;
    float tips = smoothstep(0.0, 0.14, along) * smoothstep(1.0, 0.86, along);
    float n = texture2D(uNoise, vec2(along * 1.7 + uSeed, rad * 0.45 + uTime * 2.4)).r;
    float n2 = texture2D(uNoise, vec2(along * 6.5 + uSeed, rad * 1.2 + uTime * 3.8)).g;
    float cellv = texture2D(uNoise, vec2(along * 2.6 + uSeed, rad * 0.8 + uTime * 0.15)).b;
    float edge = exp(-(((1.0 - rad) / 0.045) * ((1.0 - rad) / 0.045)));
    float edgeSoft = exp(-(((1.0 - rad) / 0.2) * ((1.0 - rad) / 0.2))) * 0.4;
    float body = (0.25 + 0.75 * pow(max(rad, 0.0), 1.5)) * (0.35 + 0.65 * n);
    float streak = smoothstep(0.5, 0.85, n2) * rad;
    float crack = smoothstep(0.1, 0.022, cellv) * smoothstep(0.15, 0.75, rad);
    float er = smoothstep(uDis, uDis + 0.22, n * 0.75 + 0.25 + rad * 0.08);
    float aE = edge * tips * er * uEdge;
    float aB = (body * 0.32 + streak * 0.28 + crack * 0.5 + edgeSoft) * tips * er * uBody * smoothstep(0.0, 0.3, rad);
    vec3 col = uColorA * aE * 2.6 + mix(uColorB, uColorA, rad * rad) * aB;
    gl_FragColor = vec4(col * uPower, clamp(aE + aB, 0.0, 1.0));
  }`;
export function crescentMaterial(ctx: FxCtx, edge: number, body: number, power: number, colA: THREE.ColorRepresentation = C.white, colB: THREE.ColorRepresentation = C.cyan) {
  return ctx.fx.material(CRESCENT_FRAG, colA, colB, power, { uDis: { value: 0 }, uEdge: { value: edge }, uBody: { value: body } });
}

/**
 * 预热：开场时把每种着色器各放一个看不见的（地下很深的地方），第一帧就编译好，
 * 免得第一次出招时卡一下。
 */
export function prewarm(ctx: FxCtx) {
  const far = new THREE.Vector3(0, -60, 0);
  const g = new THREE.Group(); g.position.copy(far);
  const add = (m: THREE.Mesh) => { m.frustumCulled = false; g.add(m); };
  add(new THREE.Mesh(arcGeo(new THREE.Vector3(), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), 1, 0.3, 0, 1, 4), ctx.fx.material(ARC_FRAG, C.white, C.cyan, 1, { uEdge: { value: 1 }, uBody: { value: 1 }, uIce: { value: 1 } })));
  add(new THREE.Mesh(QUAD, ctx.fx.material(STREAK_FRAG, C.white, C.cyan, 1, { uDraw: { value: 1 }, uFade: { value: 1 }, uCore: { value: 1 }, uThin: { value: 0.1 }, uHalo: { value: 0.3 }, uTaper: { value: 0.5 } })));
  add(new THREE.Mesh(QUAD, ctx.fx.material(STAR_FRAG, C.white, C.cyan, 1, { uRot: { value: 0 } })));
  add(new THREE.Mesh(QUAD, ctx.fx.material(RING_FRAG, C.white, C.cyan, 1)));
  add(new THREE.Mesh(QUAD, crescentMaterial(ctx, 1, 1, 1)));
  add(new THREE.Mesh(FLOOR, ctx.fx.material(FROST_FRAG, C.frost, C.mist, 1, { uA: { value: new THREE.Vector2() }, uB: { value: new THREE.Vector2() }, uW: { value: 1 }, uFade: { value: 1 }, uFront: { value: 1 }, uTip: { value: 1 }, uZ: { value: 1 } }, { blending: THREE.NormalBlending, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })));
  add(new THREE.Mesh(crystalGeo(0.1, 0.5), iceMaterial(ctx)));
  const im = new THREE.InstancedMesh(SHARD_GEO, iceMaterial(ctx, 1.15, C.white, C.cyan), 1); im.setMatrixAt(0, new THREE.Matrix4()); add(im);
  const h = ctx.fx.addMesh(g, 0.25);
  // 共用的几何体不能释放
  h.geos.length = 0;
}

/** 一圈贴地向外推开的雪雾（冲击波）。 */
export function mistRing(ctx: FxCtx, x: number, z: number, n: number, speed: number, size: [number, number], alpha = 0.35, y = 0.25) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rand(-0.1, 0.1), c = Math.cos(a), s = Math.sin(a);
    ctx.fx.emit({ kind: 'mist', count: 1, pos: [x + c * 0.4, y + rand(-0.1, 0.15), z + s * 0.3], dir: [c, 0.05, s * 0.7], cone: 0.12, speed: [speed * 0.7, speed], life: [0.9, 1.6], size, grow: 2.2, color: C.frost, color2: C.mist, intensity: 0.55, alpha, drag: 2.6, gravity: 0.05 });
  }
}
