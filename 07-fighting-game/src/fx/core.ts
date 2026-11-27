import * as THREE from 'three';
import type { Gfx } from '../render/gfx';
import { clamp, rand } from '../core/math';

// ───────────────────────────── 噪声贴图 ─────────────────────────────
/** 可平铺的噪声：R 低频云、G 中频云、B 细胞状、A 高频。所有特效着色器共用这一张。 */
function makeNoiseTexture(size = 256): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const lattice = (period: number, seed: number) => {
    const g = new Float32Array(period * period);
    let s = seed >>> 0;
    for (let i = 0; i < g.length; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; g[i] = s / 4294967296; }
    return (x: number, y: number) => {
      const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
      const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
      const i0 = ((xi % period) + period) % period, i1 = (i0 + 1) % period;
      const j0 = ((yi % period) + period) % period, j1 = (j0 + 1) % period;
      const a = g[j0 * period + i0], b = g[j0 * period + i1], c = g[j1 * period + i0], d = g[j1 * period + i1];
      return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    };
  };
  const fbm = (base: number, seed: number, oct: number) => {
    const ls = Array.from({ length: oct }, (_, o) => lattice(base << o, seed + o * 17));
    return (u: number, v: number) => { let a = 0, w = 0.5, t = 0; for (let o = 0; o < oct; o++) { a += ls[o](u * (base << o), v * (base << o)) * w; t += w; w *= 0.5; } return a / t; };
  };
  const r = fbm(4, 11, 5), g = fbm(8, 53, 4), hi = fbm(32, 97, 2);
  // 细胞噪声（周期 8）
  const cells: [number, number][] = []; let cs = 7;
  for (let i = 0; i < 64; i++) { cs = (Math.imul(cs, 1103515245) + 12345) >>> 0; const a = cs / 4294967296; cs = (Math.imul(cs, 1103515245) + 12345) >>> 0; cells.push([a, cs / 4294967296]); }
  const worley = (u: number, v: number) => {
    const x = u * 8, y = v * 8, xi = Math.floor(x), yi = Math.floor(y); let m = 9;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx, cy = yi + dy, c = cells[(((cy % 8) + 8) % 8) * 8 + (((cx % 8) + 8) % 8)];
      const px = cx + c[0] - x, py = cy + c[1] - y; m = Math.min(m, px * px + py * py);
    }
    return Math.sqrt(m);
  };
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const u = i / size, v = j / size, k = (j * size + i) * 4;
    data[k] = clamp(r(u, v) * 1.25 - 0.1, 0, 1) * 255;
    data[k + 1] = clamp(g(u, v) * 1.25 - 0.1, 0, 1) * 255;
    data[k + 2] = clamp(worley(u, v), 0, 1) * 255;
    data[k + 3] = hi(u, v) * 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

// ───────────────────────────── 粒子 ─────────────────────────────
export type ParticleKind = 'glow' | 'spark' | 'flame' | 'smoke' | 'mist' | 'flake' | 'dot';

export interface ParticleOpts {
  kind: ParticleKind;
  count?: number;
  pos: THREE.Vector3 | [number, number, number];
  /** 出生位置的随机范围（盒，半边长）或球半径 */
  spread?: [number, number, number] | number;
  /** 初速度方向和张角（弧度）。不给方向就是全向 */
  dir?: [number, number, number]; cone?: number;
  speed?: [number, number];
  life?: [number, number];
  size?: [number, number];
  /** 结束时大小是开始的几倍 */
  grow?: number;
  /** 颜色随寿命从 color 变到 color2（线性空间，可以超过 1，超过的部分会泛光） */
  color?: THREE.ColorRepresentation; color2?: THREE.ColorRepresentation;
  /** 亮度倍数：火花、光斑一般 2 到 8 */
  intensity?: number;
  alpha?: number;
  gravity?: number;      // 向下为正；负数是往上飘
  drag?: number;         // 每秒速度衰减系数
  spin?: number;         // 自转（弧度每秒）的随机范围
  /** 额外给所有粒子加的速度（比如跟着角色前冲） */
  inherit?: [number, number, number];
  /** 湍流：随机扰动加速度 */
  turb?: number;
  /** 落到地面（y=0）反弹的系数；不写就穿过去 */
  bounce?: number;
}

const QUAD = new THREE.PlaneGeometry(1, 1);

const P_VERT = /* glsl */ `
  attribute vec3 aPos; attribute vec3 aVel; attribute vec4 aColor; attribute vec4 aMisc; // 大小、旋转、种子、寿命比
  varying vec2 vUv; varying vec4 vColor; varying float vSeed; varying float vLife;
  uniform float uStretch;
  void main() {
    vec4 mv = modelViewMatrix * vec4(aPos, 1.0);
    vec2 c = position.xy;
    #ifdef STRETCH
      vec3 vv = (modelViewMatrix * vec4(aVel, 0.0)).xyz; float sp = length(vv.xy);
      vec2 d = sp > 1e-4 ? vv.xy / sp : vec2(0.0, 1.0); vec2 pp = vec2(-d.y, d.x);
      float len = aMisc.x * (1.0 + sp * uStretch);
      mv.xy += d * c.y * len + pp * c.x * aMisc.x * 0.5;
    #else
      float cs = cos(aMisc.y), sn = sin(aMisc.y);
      #ifdef TALL
        c.y *= 1.45;
      #endif
      mv.xy += vec2(cs * c.x - sn * c.y, sn * c.x + cs * c.y) * aMisc.x;
    #endif
    gl_Position = projectionMatrix * mv;
    vUv = uv; vColor = aColor; vSeed = aMisc.z; vLife = aMisc.w;
  }`;

const P_FRAG: Record<ParticleKind, string> = {
  glow: /* glsl */ `
    void main() { vec2 p = vUv - 0.5; float r2 = dot(p, p) * 4.0; float a = exp(-r2 * 4.5) - 0.011; if (a <= 0.0) discard; gl_FragColor = vec4(vColor.rgb, a * vColor.a); }`,
  dot: /* glsl */ `
    void main() { vec2 p = vUv - 0.5; float r = length(p) * 2.0; float a = smoothstep(1.0, 0.35, r); if (a <= 0.0) discard; gl_FragColor = vec4(vColor.rgb, a * vColor.a); }`,
  spark: /* glsl */ `
    void main() { vec2 p = vUv - 0.5; float w = 1.0 - smoothstep(0.0, 0.5, abs(p.x)); float l = 1.0 - smoothstep(0.1, 0.5, abs(p.y)); float head = smoothstep(-0.5, 0.45, p.y);
      float a = w * w * l * (0.35 + 0.65 * head); gl_FragColor = vec4(vColor.rgb * (1.0 + 1.5 * w * w * head), a * vColor.a); }`,
  flame: /* glsl */ `
    uniform sampler2D uNoise; uniform float uTime;
    void main() {
      vec2 p = vUv - 0.5; p.x *= 1.25;
      // 火舌的形状：下宽上尖
      float r = length(vec2(p.x * (1.0 + (p.y + 0.5) * 0.9), p.y)) * 2.0;
      vec2 nuv = vec2(vUv.x * 1.1, vUv.y * 0.8) + vec2(vSeed * 7.31, vSeed * 3.17 - uTime * 0.9);
      float n = texture2D(uNoise, nuv).r * 0.55 + texture2D(uNoise, nuv * 2.3 + vec2(0.37, -uTime * 0.6)).g * 0.3 + texture2D(uNoise, nuv * 5.0 + vec2(vSeed, -uTime * 1.1)).a * 0.15;
      float mask = 1.0 - smoothstep(0.1, 1.0, r);
      float d = n * mask * 2.0;
      float cut = mix(0.2, 1.05, vLife * vLife) + (vUv.y - 0.5) * 0.25;
      float a = smoothstep(cut, cut + 0.16, d);
      if (a <= 0.003) discard;
      float heat = clamp((d - cut) * 2.6, 0.0, 1.0) * (1.0 - vLife * 0.75);
      vec3 col = mix(vColor.rgb * 0.22, vColor.rgb, heat) + vColor.rgb * vec3(1.0, 0.72, 0.42) * pow(max(heat, 0.0), 3.0) * 1.8;
      gl_FragColor = vec4(col, a * vColor.a);
    }`,
  smoke: /* glsl */ `
    uniform sampler2D uNoise; uniform float uTime;
    void main() {
      vec2 p = vUv - 0.5; float r = length(p) * 2.0;
      vec2 nuv = vUv * 0.7 + vec2(vSeed * 5.13, vSeed * 9.71 - uTime * 0.08);
      float n = texture2D(uNoise, nuv).r * 0.6 + texture2D(uNoise, nuv * 2.4).g * 0.4;
      float mask = 1.0 - smoothstep(0.0, 1.0, r);
      float cut = mix(0.08, 0.6, vLife);
      float a = smoothstep(cut, cut + 0.6, n * mask * 1.7) * (1.0 - vLife * vLife) * mask;
      if (a <= 0.003) discard;
      float shade = 0.55 + 0.45 * smoothstep(-0.3, 0.4, p.y + (n - 0.5) * 0.4);
      gl_FragColor = vec4(vColor.rgb * shade, a * vColor.a);
    }`,
  mist: /* glsl */ `
    uniform sampler2D uNoise; uniform float uTime;
    void main() {
      vec2 p = vUv - 0.5; float r = length(p) * 2.0;
      vec2 nuv = vUv * 0.6 + vec2(vSeed * 3.3 + uTime * 0.03, vSeed * 8.1);
      float n = texture2D(uNoise, nuv).r;
      float a = (1.0 - smoothstep(0.0, 1.0, r)) * smoothstep(0.2, 0.8, n) * sin(min(1.0, vLife * 6.0) * 1.5708) * (1.0 - vLife);
      if (a <= 0.003) discard;
      gl_FragColor = vec4(vColor.rgb, a * vColor.a);
    }`,
  flake: /* glsl */ `
    void main() { vec2 p = (vUv - 0.5) * 2.0; p.x *= 2.4; float d = abs(p.x) + abs(p.y); float a = smoothstep(1.0, 0.75, d); float e = smoothstep(0.2, 0.9, d);
      if (a <= 0.0) discard; gl_FragColor = vec4(vColor.rgb * (0.6 + 0.9 * e), a * vColor.a); }`,
};

class Batch {
  readonly mesh: THREE.Mesh;
  count = 0;
  private aPos: Float32Array; private aVel: Float32Array; private aColor: Float32Array; private aMisc: Float32Array;
  // 模拟数据
  private p: Float32Array; private v: Float32Array; private life: Float32Array; private age: Float32Array;
  private s0: Float32Array; private s1: Float32Array; private rot: Float32Array; private spin: Float32Array;
  private c0: Float32Array; private c1: Float32Array; private alpha: Float32Array;
  private grav: Float32Array; private drag: Float32Array; private turb: Float32Array; private bounce: Float32Array; private seed: Float32Array;
  private geo: THREE.InstancedBufferGeometry;
  readonly mat: THREE.ShaderMaterial;

  constructor(readonly kind: ParticleKind, readonly max: number, noise: THREE.Texture) {
    const f = (n: number) => new Float32Array(max * n);
    this.aPos = f(3); this.aVel = f(3); this.aColor = f(4); this.aMisc = f(4);
    this.p = f(3); this.v = f(3); this.life = f(1); this.age = f(1); this.s0 = f(1); this.s1 = f(1); this.rot = f(1); this.spin = f(1);
    this.c0 = f(3); this.c1 = f(3); this.alpha = f(1); this.grav = f(1); this.drag = f(1); this.turb = f(1); this.bounce = f(1); this.seed = f(1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = QUAD.index; geo.setAttribute('position', QUAD.getAttribute('position')); geo.setAttribute('uv', QUAD.getAttribute('uv'));
    const dyn = (arr: Float32Array, n: number) => { const a = new THREE.InstancedBufferAttribute(arr, n); a.setUsage(THREE.DynamicDrawUsage); return a; };
    geo.setAttribute('aPos', dyn(this.aPos, 3)); geo.setAttribute('aVel', dyn(this.aVel, 3)); geo.setAttribute('aColor', dyn(this.aColor, 4)); geo.setAttribute('aMisc', dyn(this.aMisc, 4));
    geo.instanceCount = 0;
    this.geo = geo;
    const additive = kind !== 'smoke';
    this.mat = new THREE.ShaderMaterial({
      vertexShader: P_VERT,
      fragmentShader: 'precision highp float; varying vec2 vUv; varying vec4 vColor; varying float vSeed; varying float vLife;\n' + P_FRAG[kind],
      uniforms: { uNoise: { value: noise }, uTime: { value: 0 }, uStretch: { value: 0.045 } },
      defines: kind === 'spark' ? { STRETCH: 1 } : kind === 'flame' ? { TALL: 1 } : {},
      transparent: true, depthWrite: false, depthTest: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 20 : 15;
  }

  spawn(o: ParticleOpts) {
    const n = o.count ?? 1;
    const base = Array.isArray(o.pos) ? o.pos : [o.pos.x, o.pos.y, o.pos.z];
    const c0 = _c0.set(o.color ?? 0xffffff), c1 = _c1.set(o.color2 ?? o.color ?? 0xffffff);
    const k = o.intensity ?? 1;
    const sp = o.speed ?? [0, 0], lf = o.life ?? [0.4, 0.8], sz = o.size ?? [0.1, 0.2];
    let dx = 0, dy = 1, dz = 0; const hasDir = !!o.dir;
    if (o.dir) { const l = Math.hypot(o.dir[0], o.dir[1], o.dir[2]) || 1; dx = o.dir[0] / l; dy = o.dir[1] / l; dz = o.dir[2] / l; }
    // 以 dir 为轴的一组正交基，张角里随机取方向
    let ux = 1, uy = 0, uz = 0, wx = 0, wy = 0, wz = 1;
    if (hasDir) {
      if (Math.abs(dy) > 0.99) { ux = 1; uy = 0; uz = 0; } else { const l = Math.hypot(dz, dx); ux = dz / l; uy = 0; uz = -dx / l; }
      wx = dy * uz - dz * uy; wy = dz * ux - dx * uz; wz = dx * uy - dy * ux;
    }
    for (let i = 0; i < n; i++) {
      if (this.count >= this.max) return;
      const j = this.count++;
      let ox = 0, oy = 0, oz = 0;
      if (typeof o.spread === 'number') { const r = Math.cbrt(Math.random()) * o.spread, th = Math.random() * 6.2832, ph = Math.acos(2 * Math.random() - 1); ox = r * Math.sin(ph) * Math.cos(th); oy = r * Math.cos(ph); oz = r * Math.sin(ph) * Math.sin(th); }
      else if (o.spread) { ox = (Math.random() * 2 - 1) * o.spread[0]; oy = (Math.random() * 2 - 1) * o.spread[1]; oz = (Math.random() * 2 - 1) * o.spread[2]; }
      this.p[j * 3] = base[0] + ox; this.p[j * 3 + 1] = base[1] + oy; this.p[j * 3 + 2] = base[2] + oz;
      const s = rand(sp[0], sp[1]);
      let vx: number, vy: number, vz: number;
      if (hasDir) {
        const cone = o.cone ?? 0.3, a = Math.random() * 6.2832, t = Math.sqrt(Math.random()) * cone, st = Math.sin(t), ct = Math.cos(t);
        const ca = Math.cos(a) * st, sa = Math.sin(a) * st;
        vx = (dx * ct + ux * ca + wx * sa) * s; vy = (dy * ct + uy * ca + wy * sa) * s; vz = (dz * ct + uz * ca + wz * sa) * s;
      } else { const th = Math.random() * 6.2832, ph = Math.acos(2 * Math.random() - 1); vx = Math.sin(ph) * Math.cos(th) * s; vy = Math.cos(ph) * s; vz = Math.sin(ph) * Math.sin(th) * s; }
      if (o.inherit) { vx += o.inherit[0]; vy += o.inherit[1]; vz += o.inherit[2]; }
      this.v[j * 3] = vx; this.v[j * 3 + 1] = vy; this.v[j * 3 + 2] = vz;
      this.life[j] = rand(lf[0], lf[1]); this.age[j] = 0;
      const size = rand(sz[0], sz[1]); this.s0[j] = size; this.s1[j] = size * (o.grow ?? 1);
      this.rot[j] = this.kind === 'flame' ? rand(-0.45, 0.45) : Math.random() * 6.2832; this.spin[j] = o.spin ? rand(-o.spin, o.spin) * (this.kind === 'flame' ? 0.15 : 1) : 0;
      const v = 0.85 + Math.random() * 0.3;
      this.c0[j * 3] = c0.r * k * v; this.c0[j * 3 + 1] = c0.g * k * v; this.c0[j * 3 + 2] = c0.b * k * v;
      this.c1[j * 3] = c1.r * k * v; this.c1[j * 3 + 1] = c1.g * k * v; this.c1[j * 3 + 2] = c1.b * k * v;
      this.alpha[j] = o.alpha ?? 1; this.grav[j] = o.gravity ?? 0; this.drag[j] = o.drag ?? 0; this.turb[j] = o.turb ?? 0; this.bounce[j] = o.bounce ?? -1;
      this.seed[j] = Math.random();
    }
  }

  update(dt: number, time: number) {
    this.mat.uniforms.uTime.value = time;
    const { p, v, life, age, s0, s1, rot, spin, c0, c1, alpha, grav, drag, turb, bounce, seed, aPos, aVel, aColor, aMisc } = this;
    let n = this.count;
    for (let i = 0; i < n; i++) {
      age[i] += dt;
      if (age[i] >= life[i]) {
        // 用最后一个补位
        n--;
        if (i !== n) {
          p[i * 3] = p[n * 3]; p[i * 3 + 1] = p[n * 3 + 1]; p[i * 3 + 2] = p[n * 3 + 2];
          v[i * 3] = v[n * 3]; v[i * 3 + 1] = v[n * 3 + 1]; v[i * 3 + 2] = v[n * 3 + 2];
          c0[i * 3] = c0[n * 3]; c0[i * 3 + 1] = c0[n * 3 + 1]; c0[i * 3 + 2] = c0[n * 3 + 2];
          c1[i * 3] = c1[n * 3]; c1[i * 3 + 1] = c1[n * 3 + 1]; c1[i * 3 + 2] = c1[n * 3 + 2];
          life[i] = life[n]; age[i] = age[n]; s0[i] = s0[n]; s1[i] = s1[n]; rot[i] = rot[n]; spin[i] = spin[n]; alpha[i] = alpha[n];
          grav[i] = grav[n]; drag[i] = drag[n]; turb[i] = turb[n]; bounce[i] = bounce[n]; seed[i] = seed[n];
        }
        i--; continue;
      }
      const k = age[i] / life[i];
      const dk = Math.exp(-drag[i] * dt);
      let vx = v[i * 3] * dk, vy = (v[i * 3 + 1] - grav[i] * dt) * dk, vz = v[i * 3 + 2] * dk;
      if (turb[i] > 0) { const t = time * 3.1 + seed[i] * 40; vx += Math.sin(t * 1.7 + seed[i] * 9) * turb[i] * dt; vy += Math.cos(t * 1.3) * turb[i] * dt * 0.6; vz += Math.sin(t * 2.1 + 1.3) * turb[i] * dt; }
      let py = p[i * 3 + 1] + vy * dt;
      if (bounce[i] >= 0 && py < 0.02 && vy < 0) { py = 0.02; vy = -vy * bounce[i]; vx *= 0.6; vz *= 0.6; }
      p[i * 3] += vx * dt; p[i * 3 + 1] = py; p[i * 3 + 2] += vz * dt;
      v[i * 3] = vx; v[i * 3 + 1] = vy; v[i * 3 + 2] = vz;
      rot[i] += spin[i] * dt;
      aPos[i * 3] = p[i * 3]; aPos[i * 3 + 1] = py; aPos[i * 3 + 2] = p[i * 3 + 2];
      aVel[i * 3] = vx; aVel[i * 3 + 1] = vy; aVel[i * 3 + 2] = vz;
      aColor[i * 4] = c0[i * 3] + (c1[i * 3] - c0[i * 3]) * k; aColor[i * 4 + 1] = c0[i * 3 + 1] + (c1[i * 3 + 1] - c0[i * 3 + 1]) * k; aColor[i * 4 + 2] = c0[i * 3 + 2] + (c1[i * 3 + 2] - c0[i * 3 + 2]) * k;
      // 淡入很快、淡出按寿命
      aColor[i * 4 + 3] = alpha[i] * Math.min(1, k * 12) * (1 - k * k);
      aMisc[i * 4] = s0[i] + (s1[i] - s0[i]) * (1 - (1 - k) * (1 - k)); aMisc[i * 4 + 1] = rot[i]; aMisc[i * 4 + 2] = seed[i]; aMisc[i * 4 + 3] = k;
    }
    this.count = n;
    this.geo.instanceCount = n;
    if (n > 0) for (const name of ['aPos', 'aVel', 'aColor', 'aMisc']) { const a = this.geo.getAttribute(name) as THREE.InstancedBufferAttribute; a.clearUpdateRanges(); a.addUpdateRange(0, n * a.itemSize); a.needsUpdate = true; }
    this.mesh.visible = n > 0;
  }
}
const _c0 = new THREE.Color(), _c1 = new THREE.Color();

// ───────────────────────────── 网格特效 ─────────────────────────────
export interface MeshFxHandle { mesh: THREE.Object3D; life: number; age: number; dead: boolean; tick?: (k: number, dt: number, h: MeshFxHandle) => void; onEnd?: () => void; mats: THREE.Material[]; geos: THREE.BufferGeometry[] }

/** 特效着色器共用的头：噪声、时间、寿命、两个颜色。片元里用 uLife（0 到 1）做侵蚀和淡出。 */
export const FX_UNIFORMS = () => ({ uNoise: { value: null as THREE.Texture | null }, uTime: { value: 0 }, uLife: { value: 0 }, uColorA: { value: new THREE.Color(1, 1, 1) }, uColorB: { value: new THREE.Color(1, 1, 1) }, uPower: { value: 1 }, uSeed: { value: 0 } });
export const FX_VERT = /* glsl */ `varying vec2 vUv; varying vec3 vWorld; varying vec3 vNormalW; varying vec3 vView;
  void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; vNormalW = mat3(modelMatrix) * normal; vNormalW = (dot(vNormalW, vNormalW) > 1e-12 ? normalize(vNormalW) : vec3(0.0, 1.0, 0.0)); vView = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`;
export const FX_FRAG_HEAD = /* glsl */ `precision highp float; varying vec2 vUv; varying vec3 vWorld; varying vec3 vNormalW; varying vec3 vView;
  uniform sampler2D uNoise; uniform float uTime; uniform float uLife; uniform vec3 uColorA; uniform vec3 uColorB; uniform float uPower; uniform float uSeed;\n`;

/** 弧形刀光的几何：圆环的一段。uv.x 沿弧（0 是尾、1 是刀头），uv.y 沿半径（0 内、1 外）。在 XY 平面里，从 angle0 扫到 angle1。 */
export function arcGeometry(inner: number, outer: number, angle0: number, angle1: number, segs = 40): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, a = angle0 + (angle1 - angle0) * t, c = Math.cos(a), s = Math.sin(a);
    pos.push(c * inner, s * inner, 0, c * outer, s * outer, 0); uv.push(t, 0, t, 1);
    if (i < segs) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const SLASH_FRAG = FX_FRAG_HEAD + /* glsl */ `
  void main() {
    // 沿弧：刀头亮、尾巴淡；随寿命整条弧从尾部开始被侵蚀掉
    float along = vUv.x, rad = vUv.y;
    float n = texture2D(uNoise, vec2(along * 1.6 - uTime * 0.9 + uSeed, rad * 0.7 + uSeed * 3.1)).r;
    float n2 = texture2D(uNoise, vec2(along * 4.0 - uTime * 1.7, rad * 2.0 + uSeed)).g;
    float edge = smoothstep(0.0, 0.12, rad) * smoothstep(1.0, 0.86, rad);
    float core = pow(smoothstep(0.35, 0.97, rad), 3.0);          // 外沿一条亮芯
    float body = smoothstep(0.0, 1.0, rad) * 0.5;                 // 里面一层有颜色的身子
    float streak = smoothstep(0.35, 0.9, n2) * 0.6;               // 细丝
    float head = smoothstep(0.0, 0.25, along) * smoothstep(1.0, 0.93, along);
    float cut = uLife * 1.25 - along * 0.55;                      // 尾部先消失
    float er = smoothstep(cut, cut + 0.3, n * 0.8 + 0.25);
    float a = edge * head * er * (core * 1.6 + body + streak * rad);
    a *= 1.0 - smoothstep(0.75, 1.0, uLife);
    vec3 col = mix(uColorB, uColorA, core) * (1.0 + core * 2.0);
    gl_FragColor = vec4(col * uPower, clamp(a, 0.0, 1.0));
  }`;

const RING_FRAG = FX_FRAG_HEAD + /* glsl */ `
  uniform float uWidth;
  void main() {
    vec2 p = vUv - 0.5; float r = length(p) * 2.0; float ang = atan(p.y, p.x);
    float R = mix(0.08, 0.95, 1.0 - pow(max(1.0 - uLife, 0.0), 3.0));
    float n = texture2D(uNoise, vec2(ang * 0.32 + uSeed, r * 0.6 - uTime * 0.25)).r;
    float w = uWidth * (0.6 + n * 0.9) * (1.0 - uLife * 0.6);
    float ring = exp(-(((r - R) / w) * ((r - R) / w)));
    float inner = smoothstep(R, R - 0.5, r) * 0.12 * (1.0 - uLife);
    float a = (ring + inner) * (1.0 - uLife) * (1.0 - smoothstep(0.9, 1.0, r));
    gl_FragColor = vec4(mix(uColorB, uColorA, ring) * uPower, a);
  }`;

const PILLAR_FRAG = FX_FRAG_HEAD + /* glsl */ `
  void main() {
    // 圆柱展开：uv.x 绕一圈，uv.y 从下到上
    float n = texture2D(uNoise, vec2(vUv.x * 2.0 + uSeed, vUv.y * 1.3 - uTime * 2.2)).r;
    float n2 = texture2D(uNoise, vec2(vUv.x * 5.0 - uSeed, vUv.y * 3.0 - uTime * 3.6)).g;
    float d = n * 0.65 + n2 * 0.35;
    float h = vUv.y;
    float grow = smoothstep(0.0, 0.18, uLife);
    float top = 1.0 - smoothstep(grow * 0.55, grow, h + (d - 0.5) * 0.35);
    float cut = mix(0.25, 0.95, smoothstep(0.35, 1.0, uLife)) + h * 0.3;
    float a = smoothstep(cut, cut + 0.25, d + 0.35) * top;
    float fres = pow(max(1.0 - abs(dot((dot(vNormalW, vNormalW) > 1e-12 ? normalize(vNormalW) : vec3(0.0, 1.0, 0.0)), vView)), 0.0), 1.5);
    float heat = clamp(d * 1.4 - h * 0.6 + 0.3, 0.0, 1.0);
    vec3 col = mix(uColorB, uColorA, heat) * (1.0 + heat * heat * 2.5);
    gl_FragColor = vec4(col * uPower, a * (0.45 + 0.55 * (1.0 - fres)));
  }`;

export interface DecalHandle { mesh: THREE.Mesh; life: number; age: number; fadeIn: number; hold: number; mat: THREE.ShaderMaterial }

const DECAL_FRAG = FX_FRAG_HEAD + /* glsl */ `
  uniform int uKind; uniform float uAlpha; uniform float uGlow;
  float crack(vec2 p, float ang) {
    // 从中心放射的裂纹：角度方向上的细胞噪声边界
    float r = length(p) * 2.0;
    float n = texture2D(uNoise, vec2(ang * 0.5 + uSeed, r * 0.25 + uSeed * 2.0)).b;
    float n2 = texture2D(uNoise, p * 1.3 + uSeed).b;
    float line = smoothstep(0.16, 0.02, n) + smoothstep(0.12, 0.02, n2) * 0.7;
    return line * smoothstep(1.0, 0.25, r);
  }
  void main() {
    vec2 p = vUv - 0.5; float r = length(p) * 2.0; float ang = atan(p.y, p.x);
    float n = texture2D(uNoise, vUv * 1.7 + uSeed).r; float n2 = texture2D(uNoise, vUv * 4.0 - uSeed).g;
    float fall = smoothstep(1.0, 0.2 + n * 0.5, r);
    if (uKind == 0) {            // 焦痕：暗褐的烧灼 + 中心未熄的余烬
      float dark = fall * (0.55 + n2 * 0.45);
      float c = crack(p, ang);
      vec3 ember = uColorA * c * uGlow * (0.4 + 0.6 * n2) * 3.0;
      gl_FragColor = vec4(mix(vec3(0.03, 0.02, 0.015), ember, clamp(c * uGlow, 0.0, 1.0)) + ember, clamp(dark * 0.85 + c * uGlow, 0.0, 1.0) * uAlpha);
    } else if (uKind == 1) {     // 霜痕：放射状的冰晶，边缘亮
      float rays = texture2D(uNoise, vec2(ang * 1.3 + uSeed, r * 0.35)).b;
      float cry = smoothstep(0.35, 0.05, rays) * fall + smoothstep(0.5, 0.9, n2) * fall * 0.5;
      float rim = smoothstep(0.55, 0.9, r) * fall * 2.0;
      vec3 col = uColorA * (0.25 + cry * 1.2 + rim * 0.3) + uColorB * uGlow * cry;
      gl_FragColor = vec4(col, clamp(fall * 0.5 + cry * 0.6, 0.0, 1.0) * uAlpha);
    } else {                     // 裂痕：地面被砸裂，缝里透光
      float c = crack(p, ang);
      vec3 col = mix(vec3(0.0), uColorA * 3.0, uGlow) * c;
      gl_FragColor = vec4(col, clamp(c * (0.8 + uGlow), 0.0, 1.0) * uAlpha);
    }
  }`;

// ───────────────────────────── 拖尾 ─────────────────────────────
const TRAIL_FRAG = FX_FRAG_HEAD + /* glsl */ `
  void main() {
    // uv.x：0 是最新的一段、1 是最老的；uv.y：0 根部、1 尖端
    float age = vUv.x;
    float n = texture2D(uNoise, vec2(age * 1.4 + uTime * 0.6 + uSeed, vUv.y * 0.9)).r;
    float tip = pow(smoothstep(0.25, 1.0, vUv.y), 2.2);
    float edge = smoothstep(0.0, 0.08, vUv.y) * smoothstep(1.0, 0.94, vUv.y);
    float fade = pow(max(1.0 - age, 0.0), 1.6);
    float er = smoothstep(age * 0.9, age * 0.9 + 0.3, n + 0.25);
    float rim = ((smoothstep(0.72, 0.99, vUv.y)) * (smoothstep(0.72, 0.99, vUv.y)));
    float a = edge * fade * er * (0.07 + tip * 0.35 + rim * 1.4) * (0.55 + 0.45 * fade);
    vec3 col = mix(uColorB, uColorA, rim) * (0.8 + rim * 2.2);
    gl_FragColor = vec4(col * uPower, clamp(a, 0.0, 1.0));
  }`;

/** 刀光 / 拳风拖尾：每帧喂根部和尖端两个点，自动连成带子并随时间淡出。 */
export class Trail {
  readonly mesh: THREE.Mesh;
  private pts: { b: THREE.Vector3; t: THREE.Vector3; age: number }[] = [];
  private pos: Float32Array; private uv: Float32Array;
  private geo = new THREE.BufferGeometry();
  readonly mat: THREE.ShaderMaterial;
  emitting = false;
  private lastB = new THREE.Vector3(); private lastT = new THREE.Vector3(); private hasLast = false;
  private prevB = new THREE.Vector3(); private prevT = new THREE.Vector3(); private hasPrev = false;

  constructor(noise: THREE.Texture, colorA: THREE.ColorRepresentation, colorB: THREE.ColorRepresentation, readonly life = 0.22, readonly maxPts = 96, power = 2.2) {
    this.pos = new Float32Array(maxPts * 2 * 3); this.uv = new Float32Array(maxPts * 2 * 2);
    const idx: number[] = [];
    for (let i = 0; i < maxPts - 1; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2).setUsage(THREE.DynamicDrawUsage));
    this.geo.setIndex(idx);
    const u = FX_UNIFORMS(); u.uNoise.value = noise; u.uColorA.value.set(colorA); u.uColorB.value.set(colorB); u.uPower.value = power; u.uSeed.value = Math.random() * 10;
    this.mat = new THREE.ShaderMaterial({ vertexShader: FX_VERT, fragmentShader: TRAIL_FRAG, uniforms: u, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 22;
  }

  /** 每帧调用。emit 为真时把这一帧的两个端点接到带子上（中间自动补点，快速挥动也不会折成直线）。 */
  update(dt: number, time: number, base: THREE.Vector3, tip: THREE.Vector3, emit: boolean) {
    for (const p of this.pts) p.age += dt;
    while (this.pts.length && this.pts[this.pts.length - 1].age > this.life) this.pts.pop();
    if (emit) {
      if (this.hasLast && this.emitting) {
        const d = this.lastT.distanceTo(tip);
        const steps = clamp(Math.ceil(d / 0.07), 1, 10);
        // 用前两次采样、这一次和外推的下一次做 Catmull-Rom，快速挥动时带子是弧而不是折线
        const p0b = this.hasPrev ? this.prevB : this.lastB, p0t = this.hasPrev ? this.prevT : this.lastT;
        const p3b = _tb.copy(base).multiplyScalar(2).sub(this.lastB), p3t = _tt.copy(tip).multiplyScalar(2).sub(this.lastT);
        // 刀身的方向用球面插值（挥刀主要是绕手腕转，直接连两帧的刀尖会把弧线拉成折线）
        _d0.subVectors(this.lastT, this.lastB); _d1.subVectors(tip, base);
        const l0 = _d0.length(), l1 = _d1.length();
        const turning = l0 > 1e-4 && l1 > 1e-4 && _d0.angleTo(_d1) > 0.12;
        if (turning) { _d0.divideScalar(l0); _d1.divideScalar(l1); _qs.setFromUnitVectors(_d0, _d1); }
        const steps2 = turning ? clamp(Math.ceil(_d0.angleTo(_d1) / 0.14), steps, 16) : steps;
        for (let i = 1; i <= steps2; i++) {
          const k = i / steps2;
          const nb = catmull(p0b, this.lastB, base, p3b, k, new THREE.Vector3());
          let nt: THREE.Vector3;
          if (turning) { _qi.identity().slerp(_qs, k); nt = new THREE.Vector3().copy(_d0).applyQuaternion(_qi).multiplyScalar(l0 + (l1 - l0) * k).add(nb); }
          else nt = catmull(p0t, this.lastT, tip, p3t, k, new THREE.Vector3());
          this.pts.unshift({ b: nb, t: nt, age: dt * (1 - k) });
        }
        void p3t; void p0t;
      } else this.pts.unshift({ b: base.clone(), t: tip.clone(), age: 0 });
      while (this.pts.length > this.maxPts) this.pts.pop();
    }
    if (this.hasLast) { this.prevB.copy(this.lastB); this.prevT.copy(this.lastT); this.hasPrev = this.emitting; }
    this.emitting = emit; this.lastB.copy(base); this.lastT.copy(tip); this.hasLast = true;
    const n = this.pts.length;
    for (let i = 0; i < n; i++) {
      const p = this.pts[i], k = i * 6, a = p.age / this.life;
      this.pos[k] = p.b.x; this.pos[k + 1] = p.b.y; this.pos[k + 2] = p.b.z; this.pos[k + 3] = p.t.x; this.pos[k + 4] = p.t.y; this.pos[k + 5] = p.t.z;
      this.uv[i * 4] = a; this.uv[i * 4 + 1] = 0; this.uv[i * 4 + 2] = a; this.uv[i * 4 + 3] = 1;
    }
    this.geo.setDrawRange(0, Math.max(0, (n - 1) * 6));
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.uv.needsUpdate = true;
    this.mat.uniforms.uTime.value = time;
    this.mesh.visible = n > 1;
  }
  clear() { this.pts.length = 0; this.hasLast = false; this.hasPrev = false; this.mesh.visible = false; }
  /** 断开：下一次喂点时另起一段（换招的时候用，免得两招之间被拉出一条直线） */
  cut() { this.hasLast = false; this.hasPrev = false; this.emitting = false; }
}

const _tb = new THREE.Vector3(), _tt = new THREE.Vector3(), _d0 = new THREE.Vector3(), _d1 = new THREE.Vector3(), _qs = new THREE.Quaternion(), _qi = new THREE.Quaternion();
function catmull(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, t: number, out: THREE.Vector3) {
  const t2 = t * t, t3 = t2 * t;
  const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return out.set(f(p0.x, p1.x, p2.x, p3.x), f(p0.y, p1.y, p2.y, p3.y), f(p0.z, p1.z, p2.z, p3.z));
}

// ───────────────────────────── 特效系统 ─────────────────────────────
interface LightSlot { light: THREE.PointLight; life: number; age: number; peak: number }
interface Timer { t: number; fn: () => void }

export class Fx {
  readonly root = new THREE.Group();
  readonly noise = makeNoiseTexture();
  private batches = new Map<ParticleKind, Batch>();
  private meshes: MeshFxHandle[] = [];
  private decals: DecalHandle[] = [];
  private lights: LightSlot[] = [];
  private timers: Timer[] = [];
  private trails: Trail[] = [];
  time = 0;
  private decalGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

  constructor(readonly gfx: Gfx) {
    gfx.scene.add(this.root);
    const caps: Record<ParticleKind, number> = { glow: 1500, spark: 3000, flame: 2500, smoke: 1200, mist: 800, flake: 2500, dot: 2500 };
    for (const k of Object.keys(caps) as ParticleKind[]) { const b = new Batch(k, caps[k], this.noise); this.batches.set(k, b); this.root.add(b.mesh); }
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 9, 1.8);
      l.castShadow = false; this.root.add(l);
      this.lights.push({ light: l, life: 0, age: 1, peak: 0 });
    }
  }

  /** 发射粒子。 */
  emit(o: ParticleOpts) { this.batches.get(o.kind)!.spawn(o); }

  /** 延迟执行（按特效时间走，慢动作时跟着变慢）。 */
  after(delay: number, fn: () => void) { this.timers.push({ t: this.time + delay, fn }); }

  /** 一闪而过的点光：照亮角色和地面，是“特效真的在场景里”的关键。 */
  flashLight(pos: THREE.Vector3 | [number, number, number], color: THREE.ColorRepresentation, intensity = 30, distance = 9, life = 0.25) {
    let slot = this.lights[0];
    for (const s of this.lights) { if (s.age >= s.life) { slot = s; break; } if (s.life - s.age < slot.life - slot.age) slot = s; }
    const p = Array.isArray(pos) ? pos : [pos.x, pos.y, pos.z];
    slot.light.position.set(p[0], p[1], p[2] + 0.6); slot.light.color.set(color); slot.light.distance = distance;
    slot.peak = intensity; slot.life = life; slot.age = 0; slot.light.intensity = intensity;
    return slot;
  }

  /** 通用网格特效：到时间自动移除并释放。tick(k, dt) 里 k 是 0 到 1 的寿命。 */
  addMesh(mesh: THREE.Object3D, life: number, tick?: MeshFxHandle['tick'], onEnd?: () => void): MeshFxHandle {
    const mats: THREE.Material[] = [], geos: THREE.BufferGeometry[] = [];
    mesh.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { geos.push(m.geometry); (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => mats.push(x)); m.frustumCulled = false; } });
    const h: MeshFxHandle = { mesh, life, age: 0, dead: false, tick, onEnd, mats, geos };
    this.root.add(mesh); this.meshes.push(h);
    return h;
  }

  /** 做一个用公共 uniform 的特效材质（加法混合、不写深度、双面）。 */
  material(frag: string, colorA: THREE.ColorRepresentation, colorB: THREE.ColorRepresentation, power = 2, extra: Record<string, THREE.IUniform> = {}, opts: Partial<THREE.ShaderMaterialParameters> = {}) {
    const u = FX_UNIFORMS(); u.uNoise.value = this.noise; u.uColorA.value.set(colorA); u.uColorB.value.set(colorB); u.uPower.value = power; u.uSeed.value = Math.random() * 10;
    return new THREE.ShaderMaterial({ vertexShader: FX_VERT, fragmentShader: frag, uniforms: { ...u, ...extra }, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, ...opts });
  }

  /**
   * 弧形刀光。center 世界坐标；rotation 决定弧所在的平面（默认在 XY 平面，也就是正对镜头）；
   * angle0 → angle1 是扫过的角度（弧度，0 朝 +X，逆时针为正），radius 外半径，width 带宽占半径的比例。
   */
  slash(center: THREE.Vector3, radius: number, angle0: number, angle1: number, colorA: THREE.ColorRepresentation, colorB: THREE.ColorRepresentation, o: { width?: number; life?: number; power?: number; rot?: THREE.Euler; scaleX?: number; grow?: number } = {}) {
    const geo = arcGeometry(radius * (1 - (o.width ?? 0.45)), radius, angle0, angle1, 48);
    const mat = this.material(SLASH_FRAG, colorA, colorB, o.power ?? 3);
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(center); if (o.rot) m.rotation.copy(o.rot); if (o.scaleX) m.scale.x = o.scaleX;
    m.renderOrder = 23;
    const grow = o.grow ?? 0.12, sx = m.scale.x;
    return this.addMesh(m, o.life ?? 0.28, (k) => { mat.uniforms.uLife.value = k; mat.uniforms.uTime.value = this.time; const s = 1 + grow * k; m.scale.set(sx * s, s, s); });
  }

  /** 地面冲击环（贴着地面的一个扩散的圈）。 */
  groundRing(x: number, z: number, size: number, colorA: THREE.ColorRepresentation, colorB: THREE.ColorRepresentation, o: { life?: number; power?: number; width?: number; y?: number } = {}) {
    const mat = this.material(RING_FRAG, colorA, colorB, o.power ?? 2.5, { uWidth: { value: o.width ?? 0.09 } }, { polygonOffset: true, polygonOffsetFactor: -4 });
    const m = new THREE.Mesh(this.decalGeo, mat);
    m.position.set(x, o.y ?? 0.03, z); m.scale.setScalar(size); m.renderOrder = 12;
    const h = this.addMesh(m, o.life ?? 0.5, (k) => { mat.uniforms.uLife.value = k; mat.uniforms.uTime.value = this.time; });
    h.geos.length = 0;   // 共用的几何体不能释放
    return h;
  }

  /** 竖直的冲击环（正对镜头，打击点的冲击波）。 */
  airRing(center: THREE.Vector3, size: number, colorA: THREE.ColorRepresentation, colorB: THREE.ColorRepresentation, o: { life?: number; power?: number; width?: number } = {}) {
    const mat = this.material(RING_FRAG, colorA, colorB, o.power ?? 2.5, { uWidth: { value: o.width ?? 0.07 } });
    const m = new THREE.Mesh(QUAD, mat);
    m.position.copy(center); m.scale.setScalar(size); m.renderOrder = 21;
    const h = this.addMesh(m, o.life ?? 0.3, (k) => { mat.uniforms.uLife.value = k; mat.uniforms.uTime.value = this.time; m.quaternion.copy(this.gfx.camera.quaternion); });
    h.geos.length = 0;
    return h;
  }

  /** 火柱 / 光柱：从地面窜起的一根柱子。 */
  pillar(x: number, z: number, radius: number, height: number, colorA: THREE.ColorRepresentation, colorB: THREE.ColorRepresentation, o: { life?: number; power?: number } = {}) {
    const geo = new THREE.CylinderGeometry(radius * 0.55, radius, height, 28, 12, true); geo.translate(0, height / 2, 0);
    const mat = this.material(PILLAR_FRAG, colorA, colorB, o.power ?? 3);
    const m = new THREE.Mesh(geo, mat); m.position.set(x, 0, z); m.renderOrder = 19;
    return this.addMesh(m, o.life ?? 0.7, (k) => { mat.uniforms.uLife.value = k; mat.uniforms.uTime.value = this.time; m.scale.set(1 + k * 0.35, 0.6 + 0.4 * Math.min(1, k * 6), 1 + k * 0.35); });
  }

  /** 地面贴花：kind 0 焦痕、1 霜痕、2 裂痕。glow 是刚出现时缝里的光，会先于整体淡掉。 */
  decal(x: number, z: number, size: number, kind: 0 | 1 | 2, colorA: THREE.ColorRepresentation, colorB: THREE.ColorRepresentation = 0xffffff, life = 6, rot = Math.random() * 6.28) {
    const u = FX_UNIFORMS(); u.uNoise.value = this.noise; u.uColorA.value.set(colorA); u.uColorB.value.set(colorB); u.uSeed.value = Math.random() * 10;
    const mat = new THREE.ShaderMaterial({ vertexShader: FX_VERT, fragmentShader: DECAL_FRAG, uniforms: { ...u, uKind: { value: kind }, uAlpha: { value: 0 }, uGlow: { value: 1 } }, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const m = new THREE.Mesh(this.decalGeo, mat);
    m.position.set(x, 0.012 + this.decals.length * 0.0006, z); m.rotation.y = rot; m.scale.setScalar(size); m.renderOrder = 5; m.frustumCulled = false;
    this.root.add(m);
    if (this.decals.length > 14) { const d = this.decals.shift()!; this.root.remove(d.mesh); d.mat.dispose(); }
    const d: DecalHandle = { mesh: m, life, age: 0, fadeIn: 0.06, hold: life * 0.6, mat };
    this.decals.push(d);
    return d;
  }

  /** 新建一条拖尾（刀光、拳风）。归特效系统管，自己每帧调 trail.update。 */
  trail(colorA: THREE.ColorRepresentation, colorB: THREE.ColorRepresentation, life = 0.2, power = 2.2) {
    const t = new Trail(this.noise, colorA, colorB, life, 96, power);
    this.root.add(t.mesh); this.trails.push(t);
    return t;
  }

  /**
   * 残影：把一个蒙皮网格当前的姿势烤成静态网格，用边缘光着色并淡出。
   * 每个残影要逐顶点算一遍蒙皮（几万个顶点约 1 到 3 毫秒），一次冲刺放三四个没问题，别每帧放。
   */
  ghost(meshes: THREE.Mesh[], color: THREE.ColorRepresentation, life = 0.35, power = 1.6) {
    const group = new THREE.Group();
    const mat = this.material(FX_FRAG_HEAD + /* glsl */ `
      void main() { float f = pow(max(1.0 - abs(dot((dot(vNormalW, vNormalW) > 1e-12 ? normalize(vNormalW) : vec3(0.0, 1.0, 0.0)), vView)), 0.0), 2.2); float a = (0.12 + f) * (1.0 - uLife) * (1.0 - uLife);
        gl_FragColor = vec4(mix(uColorB, uColorA, f) * uPower, a); }`, color, color, power, {}, { side: THREE.FrontSide });
    const v = new THREE.Vector3();
    for (const src of meshes) {
      const sm = src as THREE.SkinnedMesh;
      const g = new THREE.BufferGeometry();
      const srcPos = src.geometry.getAttribute('position');
      const out = new Float32Array(srcPos.count * 3);
      for (let i = 0; i < srcPos.count; i++) {
        if (sm.isSkinnedMesh) sm.getVertexPosition(i, v); else v.fromBufferAttribute(srcPos, i);
        v.applyMatrix4(src.matrixWorld);
        out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z;
      }
      g.setAttribute('position', new THREE.BufferAttribute(out, 3));
      if (src.geometry.index) g.setIndex(src.geometry.index);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, mat); m.renderOrder = 18;
      group.add(m);
    }
    const h = this.addMesh(group, life, (k) => { mat.uniforms.uLife.value = k; });
    return h;
  }

  update(dt: number) {
    this.time += dt;
    for (let i = this.timers.length - 1; i >= 0; i--) if (this.timers[i].t <= this.time) { const t = this.timers[i]; this.timers.splice(i, 1); t.fn(); }
    for (const b of this.batches.values()) b.update(dt, this.time);
    for (let i = this.meshes.length - 1; i >= 0; i--) {
      const h = this.meshes[i];
      h.age += dt;
      const k = Math.min(1, h.age / h.life);
      h.tick?.(k, dt, h);
      if (h.age >= h.life || h.dead) {
        this.root.remove(h.mesh); h.onEnd?.();
        for (const m of h.mats) m.dispose(); for (const g of h.geos) g.dispose();
        this.meshes.splice(i, 1);
      }
    }
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i]; d.age += dt;
      const a = Math.min(1, d.age / d.fadeIn) * (d.age > d.hold ? Math.max(0, 1 - (d.age - d.hold) / (d.life - d.hold)) : 1);
      d.mat.uniforms.uAlpha.value = a; d.mat.uniforms.uGlow.value = Math.max(0, 1 - d.age / (d.life * 0.35));
      if (d.age >= d.life) { this.root.remove(d.mesh); d.mat.dispose(); this.decals.splice(i, 1); }
    }
    for (const s of this.lights) {
      if (s.age < s.life) { s.age += dt; const k = Math.min(1, s.age / s.life); s.light.intensity = s.peak * (1 - k) * (1 - k); } else s.light.intensity = 0;
    }
  }

  /** 换回合时清场。 */
  clear() {
    for (const h of this.meshes) h.dead = true;
    for (const d of this.decals) d.age = d.life;
    for (const t of this.trails) t.clear();
    this.timers.length = 0;
  }
}

export const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
