// 伊缇特效的零件（iti-fx2，Opus 自己写的）。王者那种“打击感”靠的不是哪一个零件多精致，而是几样东西在同一帧叠在一起、时间卡得准：
//   刀气长线（Lines）     一道又亮又利的纺锤形光，两头尖、白芯、绯红身子、外面一圈淡辉，从一头“刷”地扫到另一头；可以收细成一根发光的线（刀网）、最后“引爆”
//   星芒（Stars）         命中处炸开的四长四短的尖芒，白芯，0.03 秒弹到最大再迅速收细；还有大招中心的八芒大星、蓄力的光点、白热的闪核
//   地面冲击环（Rings）    贴地的一圈：锐利的亮前沿 + 往里拖的渐变，一路推到范围边；也能反过来往里收（蓄力）、或者整片闪一下（范围）
//   火花碎片（Sparks）     顺着速度拉长的火花、旋转的绯红碎片、往上飘的余烬、砸地溅起的碎石，全在显卡上算
//   月牙刀气（crescent）   一弯有前沿白线、三阶硬色块、内缘碎成细丝的新月，扫过去再迅速收掉
//   地面贴花（decal）      法阵（范围）、地裂、焦痕：即梦出的黑底发光图，压暗地面 + 叠加发光两层画，发光能“冷却”成暖褐的疤
//   爆裂花（bloom）        被动引爆的绯红花（即梦出的图），白热 → 绽开 → 从里往外碎掉
//   冲击墙（wall）         有高度的一圈（Q 三段落地），让冲击波“有厚度”
//   残影（ghosts）、受击闪白在 main.ts（闪白是人物身上的事）
// 前四样是“实例化”的：每样只有一个网格、一次绘制，几百个同时在场也只是一次 draw call；每个实例的动画全在着色器里按时间算，CPU 只在生出来那一下写一次。
// 混合：一律“预乘透明”（ONE, ONE_MINUS_SRC_ALPHA）。这样一个像素里既能有“盖住地面的绯红”（在亮草地上也看得清颜色），又能有“叠加上去的白芯”（发光），
// 一次画完，不用分两层——这是亮地面上做出饱和绯红的关键（纯加法的红叠在绿草上会变成土黄）。
// 颜色直接写显示空间的值（着色器没有走 three 的色彩空间转换和色调映射），所见即所得。
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { FxCtx, FxHandle, LabActor } from "../api";

export const GLSL_COMMON = /* glsl */ `
const vec3 WHITE = vec3(1.0, 0.97, 0.95);
const vec3 HOT = vec3(1.0, 0.50, 0.52);          // 白芯和身子之间的一道窄边（返工：去掉偏蓝的粉）
const vec3 MAG = vec3(1.0, 0.16, 0.50);          // 品红：只用在光晕的外沿
const vec3 BRIGHT = vec3(1.0, 0.165, 0.416);     // #FF2A6A 亮绯
const vec3 CRIM = vec3(0.878, 0.071, 0.235);     // #E0123C 深绯：主色
const vec3 DEEP = vec3(0.38, 0.02, 0.12);
const vec3 GOLD = vec3(1.0, 0.80, 0.42);
const vec3 SCAR = vec3(0.20, 0.07, 0.06);
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
// 假泛光（返工）：不用后期，每个亮的形状自己在外面画一层同形状的柔光。g 是光晕强度（0～1，一般是离形状距离的高斯），
// edge 0～1：越往外越偏品红。大部分是加法（rgb 大、alpha 小）；留一点 alpha 把底下的亮草地“染”成绯红——纯加法的红叠在绿草上会变成土黄。
uniform float uBloom;
vec4 glow(float g, float edge) { g *= uBloom; vec3 c = mix(vec3(0.95, 0.04, 0.17), MAG, 0.4 * clamp(edge, 0.0, 1.0)); return vec4(c * g * 0.95, g * 0.26); }
// 一层叠在另一层上面（都是预乘的）
vec4 over(vec4 top, vec4 under) { return vec4(top.rgb + under.rgb * (1.0 - top.a), top.a + under.a * (1.0 - top.a)); }
`;

/** 光晕强度：电脑档 1，手机档 0.6（光晕都画在各自的着色器里，不多一次绘制，只是面片大一点；手机档再弱一点省填充） */
export const BLOOM = { value: 1 };
const premul = (o: THREE.ShaderMaterialParameters) => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor, ...o,
  uniforms: { uBloom: BLOOM, ...(o.uniforms ?? {}) },
});
const HIDE = "gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return;";
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export type V3 = { x: number; y: number; z: number };

// ============================================================ 实例化的底子
abstract class Inst {
  mesh: THREE.Mesh; geo: THREE.InstancedBufferGeometry; attrs: Record<string, THREE.InstancedBufferAttribute> = {}; next = 0; n: number; born: Float32Array;
  constructor(public kit: Kit, base: THREE.BufferGeometry, n: number, layout: Record<string, number>, mat: THREE.ShaderMaterial, order: number) {
    this.n = n; this.born = new Float32Array(n).fill(-1e9);
    const g = new THREE.InstancedBufferGeometry(); g.index = base.index; for (const k in base.attributes) g.setAttribute(k, base.attributes[k]);
    for (const [k, sz] of Object.entries(layout)) { const a = new THREE.InstancedBufferAttribute(new Float32Array(n * sz), sz); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(k, a); this.attrs[k] = a; }
    (this.attrs.aT.array as Float32Array).fill(-1e9);      // aT.x 是出生时间：一律放到很久以前 = 看不见
    g.instanceCount = n; this.geo = g;
    mat.uniforms.uTime = kit.uTime;
    this.mesh = new THREE.Mesh(g, mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = order; this.mesh.visible = false; kit.group.add(this.mesh);
  }
  maxEnd = -1e9;
  /** 记一下最晚什么时候结束；过了就把整个网格藏起来 */
  touch(t0: number, life: number) { this.maxEnd = Math.max(this.maxEnd, t0 + life); this.mesh.visible = true; }
  tick() { if (this.kit.t > this.maxEnd + 0.05) this.mesh.visible = false; }
  alloc() { const i = this.next; this.next = (this.next + 1) % this.n; return i; }
  set(i: number, k: string, ...v: number[]) { const a = this.attrs[k], arr = a.array as Float32Array; for (let j = 0; j < v.length; j++) arr[i * a.itemSize + j] = v[j]; a.needsUpdate = true; }
  clear() { (this.attrs.aT.array as Float32Array).fill(-1e9); this.attrs.aT.needsUpdate = true; this.born.fill(-1e9); this.maxEnd = -1e9; this.mesh.visible = false; }
  /** 现在还活着几个（统计用） */
  alive(life: (i: number) => number) { let c = 0; const t = this.kit.t; for (let i = 0; i < this.n; i++) if (t - this.born[i] < life(i)) c++; return c; }
}

// ============================================================ 刀气长线
// 一条从 a 到 b 的纺锤形光带，绕自己的轴转向镜头（从哪个角度看都是一条带子）。时间轴（相对出生）：
//   0 → reveal        光头从 a 刷到 b（头上一颗亮点）
//   reveal → collapse 满宽度停一下
//   collapse 之后     0.12 秒收细到 thread 宽（thread=0 就是收没）——刀网就是这些收细的线
//   ignite（绝对时间）引爆：0.04 秒胀到 1.8 倍、全白，再 0.2 秒收没
export interface LineOpts { a: V3; b: V3; width: number; life: number; reveal?: number; collapse?: number; thread?: number; kind?: number; ignite?: number; delay?: number }
const linesBase = (() => { const g = new THREE.BufferGeometry(), p: number[] = [], ix: number[] = [], S = 24;
  for (let i = 0; i <= S; i++) for (const v of [-1, 1]) p.push(i / S, v, 0);
  for (let i = 0; i < S; i++) { const a = i * 2; ix.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3)); g.setIndex(ix); return g; })();
class Lines extends Inst {
  constructor(kit: Kit) {
    super(kit, linesBase, 160, { aA: 3, aB: 3, aT: 4, aS: 4 }, premul({
      uniforms: {}, depthTest: true, side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        uniform float uTime, uBloom; attribute vec3 aA, aB; attribute vec4 aT, aS;
        varying vec2 vUV; varying float vHead, vFade, vIgn, vKind, vThin, vAge;
        void main() {
          float age = uTime - aT.x, life = aT.y; vAge = age;
          if (age < 0.0 || age > life) { ${HIDE} }
          float u = position.x, v = position.y;
          vec3 ax = aB - aA; float L = max(length(ax), 1e-4); vec3 dir = ax / L, P = aA + ax * u;
          vec3 side = normalize(cross(dir, normalize(P - cameraPosition)));
          float w = aT.w, ca = aS.y, th = aS.x;
          float cw = mix(1.0, th / w, smoothstep(ca, ca + 0.12, age));
          float ig = uTime - aS.z, wf = cw;
          if (ig >= 0.0) wf = ig < 0.03 ? mix(cw, 0.22, ig / 0.03) : mix(0.22, 0.0, clamp((ig - 0.03) / 0.14, 0.0, 1.0));      // 引爆：胀回一点（不超过原来宽度的 3/4，第二版胀到 1.8 倍，整根 8 米的白纺锤太抢）再收没
          float W = w * wf;
          float M = 2.4 + 1.2 * uBloom;                                 // 面片往外放：留出光晕的地方
          vec3 pos = P + side * v * W * 0.5 * M;
          vUV = vec2(u, v * M);
          float hk = clamp(age / max(aT.z, 1e-3), 0.0, 1.0);
          vHead = 1.0 - (1.0 - hk) * (1.0 - hk) * (1.0 - hk);       // 刷过去：先快后慢
          vHead = hk >= 1.0 ? 2.0 : vHead;
          vFade = 1.0 - smoothstep(life * 0.72, life, age);
          vThin = 1.0 - cw;                                           // 收细了多少（0 满宽，1 只剩线）
          vIgn = ig; vKind = aS.w;
          gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        ${GLSL_COMMON}
        varying vec2 vUV; varying float vHead, vFade, vIgn, vKind, vThin, vAge;
        void main() {
          float u = vUV.x, y = abs(vUV.y);
          float env = pow(max(sin(3.14159 * u), 0.0), 0.62);
          float rev = 1.0 - smoothstep(vHead - 0.015, vHead + 0.004, u);
          float d = y / max(env, 0.015);
          float core = 1.0 - smoothstep(0.08, 0.26, d);
          float body = 1.0 - smoothstep(0.62, 1.0, d);
          float hot = smoothstep(0.16, 0.26, d) * (1.0 - smoothstep(0.3, 0.42, d));      // 白芯外面一道很窄的亮红，粉只有这么一条
          float fl = 1.0 + 1.3 * (1.0 - smoothstep(0.0, 0.15, vAge));                 // 刚出现那 0.15 秒最亮
          float gk = (vKind > 0.5 ? 0.55 : 1.0) * fl * (1.0 - 0.6 * vThin);
          float halo = exp(-pow(d / 1.35, 2.0)) * gk;                                   // 光晕：同一个纺锤形放大约 2 倍
          float hg = vHead < 1.5 ? exp(-pow((u - vHead) * 22.0, 2.0)) * (1.0 - smoothstep(0.0, 1.2, y)) : 0.0;
          // 身子里两道顺着走的细丝（错开一点长度），不让它是一根光滑的管子
          float fil = (1.0 - smoothstep(0.0, 0.07, abs(d - 0.78))) * smoothstep(0.12, 0.3, u) * (1.0 - smoothstep(0.7, 0.9, u)) * 0.8;
          vec3 bc = vKind > 0.5 ? BRIGHT : mix(CRIM, BRIGHT, smoothstep(0.95, 0.4, d));
          float a = clamp(max(body * 0.94, core), 0.0, 1.0);
          vec3 rgb = bc * body * 0.94 * (1.0 - core) + HOT * hot * body * 0.7 + BRIGHT * fil * body * 0.4 + WHITE * core * (0.85 + 0.25 * fl + 0.35 * vThin) + WHITE * hg * 1.2;
          vec4 cc = over(vec4(rgb, a), glow(halo * (1.0 - body * 0.6), smoothstep(0.9, 2.4, d)));
          rgb = cc.rgb; a = cc.a;
          float m = rev * vFade;
          if (vIgn >= 0.0) {      // 引爆：芯白、身子亮绯，同时从中间往两头碎成一段一段（噪声门槛越抬越高）
            float f = 1.0 - smoothstep(0.0, 0.14, vIgn);
            rgb = mix(rgb, (CRIM * body + WHITE * core * 1.3), f * 0.6) + WHITE * core * f * 0.5;
            float brk = vnoise(vec2(u * 26.0, 3.0)) - smoothstep(0.03, 0.2, vIgn) * 1.1 + abs(u - 0.5) * 0.4;
            m *= smoothstep(0.0, 0.08, brk);
          }
          gl_FragColor = vec4(rgb * m, a * m);
        }`,
    }), 12);
  }
  life = (i: number) => (this.attrs.aT.array as Float32Array)[i * 4 + 1];
  add(o: LineOpts) {
    const i = this.alloc(), t0 = this.kit.t + (o.delay ?? 0);
    this.set(i, "aA", o.a.x, o.a.y, o.a.z); this.set(i, "aB", o.b.x, o.b.y, o.b.z);
    this.set(i, "aT", t0, o.life, o.reveal ?? 0.05, o.width);
    this.set(i, "aS", o.thread ?? 0, o.collapse ?? o.life, o.ignite ?? 1e9, o.kind ?? 0);
    this.born[i] = t0; this.touch(t0, o.life); return i;
  }
  ignite(i: number, at: number) { const s = this.attrs.aS.array as Float32Array, T = this.attrs.aT.array as Float32Array; s[i * 4 + 2] = at; this.attrs.aS.needsUpdate = true; T[i * 4 + 1] = Math.max(T[i * 4 + 1], at - T[i * 4] + 0.26); this.attrs.aT.needsUpdate = true; this.touch(T[i * 4], T[i * 4 + 1]); }
}

// ============================================================ 星芒、光点、闪核
// kind 0 命中星芒：四长四短，白芯，0.03 秒弹到 1.15 倍，然后芒越来越细
// kind 1 大星：八道长芒长短交错，外面一圈淡淡的绯红光晕（大招中心）
// kind 2 光点：白芯 + 品红光晕，收缩（蓄力往里聚的那一点）
// kind 3 闪核：一个硬边的白热圆，带一圈品红边，快速胀开、变成环、散掉（被动引爆的第一下）
export interface StarOpts { pos: V3; size: number; life: number; kind?: number; rot?: number; delay?: number; stretch?: number }
const quadBase = (() => { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3)); g.setIndex([0, 1, 2, 0, 2, 3]); return g; })();
class Stars extends Inst {
  constructor(kit: Kit) {
    super(kit, quadBase, 64, { aP: 3, aT: 4, aK: 4 }, premul({
      uniforms: {}, depthTest: false,
      vertexShader: /* glsl */ `
        uniform float uTime; attribute vec3 aP; attribute vec4 aT, aK; varying vec2 vQ; varying float vK, vKind, vRot;
        void main() {
          float age = uTime - aT.x; if (age < 0.0 || age > aT.y) { ${HIDE} }
          float k = age / aT.y; vK = k; vKind = aK.x; vRot = aT.w;
          vec4 mv = viewMatrix * vec4(aP, 1.0); mv.xyz += normalize(-mv.xyz) * 1.5;     // 往镜头挪一点：画在目标身上而不是身体里
          float s = aT.z;
          mv.xy += position.xy * s; vQ = position.xy;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        ${GLSL_COMMON}
        varying vec2 vQ; varying float vK, vKind, vRot;
        float ray(vec2 p, float ang, float len, float th) {
          vec2 dir = vec2(cos(ang), sin(ang)); float x = dot(p, dir), y = abs(dot(p, vec2(-dir.y, dir.x)));
          float r = 1.0 - abs(x) / len; if (r <= 0.0) return 0.0;
          float t = th * pow(r, 1.6); return 1.0 - smoothstep(t * 0.35, t, y);
        }
        void main() {
          float k = vK, kind = vKind; vec2 p = vQ; float l = length(p);
          float pop = k < 0.12 ? mix(0.45, 1.15, 1.0 - pow(1.0 - k / 0.12, 3.0)) : mix(1.15, 0.85, (k - 0.12) / 0.88);
          vec3 rgb = vec3(0.0); float a = 0.0;
          if (kind < 0.5 || (kind > 0.5 && kind < 1.5)) {
            float big = kind > 0.5 ? 1.0 : 0.0;
            float th = mix(0.075, 0.11, big) * pow(1.0 - k, 1.4) + 0.004;
            float r = 0.0; float tipc = 0.0;
            for (int i = 0; i < 8; i++) {
              float fi = float(i), ang = vRot + fi * 0.7853982;
              float len = (mod(fi, 2.0) < 0.5 ? 1.0 : mix(0.52, 0.8, big)) * pop * mix(1.0, 0.72, k);
              if (big > 0.5) len *= 0.82 + 0.18 * hash(vec2(fi, 3.1));
              float rr = ray(p, ang, len, th * (mod(fi, 2.0) < 0.5 ? 1.0 : 0.7));
              if (rr > r) { r = rr; tipc = l / max(len, 1e-3); }
            }
            float core = 1.0 - smoothstep(0.10 * pop * (1.0 - k), 0.17 * pop * (1.0 - k) + 0.001, l);
            vec3 rc = mix(WHITE, mix(BRIGHT, CRIM, smoothstep(0.5, 1.0, tipc)), smoothstep(0.12, 0.45, tipc));
            a = max(r, core);
            rgb = rc * r * (1.0 - core) + WHITE * core;
            // 光晕：芒外面一层柔光（芒的形状放大）+ 中心一团，跟着芒一起闪一起收
            float gr = 0.0;
            for (int i = 0; i < 4; i++) { float ang = vRot + float(i) * 1.5707963; vec2 dd = vec2(cos(ang), sin(ang)); float x = abs(dot(p, dd)), y = abs(dot(p, vec2(-dd.y, dd.x))); gr = max(gr, exp(-pow(y / (0.1 + 0.18 * x), 2.0)) * max(0.0, 1.0 - x / (pop * 1.05))); }
            float g = (gr * 0.8 + exp(-l * l * 7.0)) * pow(1.0 - k, 1.5) * (big > 0.5 ? 1.1 : 1.0);
            vec4 cc = over(vec4(rgb, a), glow(g, smoothstep(0.2, 0.9, l)));
            rgb = cc.rgb; a = cc.a;
          } else if (kind < 2.5) {
            float s = mix(1.0, 0.25, k);
            float core = 1.0 - smoothstep(0.12 * s, 0.22 * s, l);
            vec4 cc = over(vec4(WHITE * core, core), glow(exp(-l * l / (0.2 * s * s)), l));
            rgb = cc.rgb; a = cc.a;
          } else if (kind > 3.5) {      // kind 4 柔光圆（返工）：命中时目标身上一团柔光，0.08 秒，直径约身高的 1.5 倍
            float g = exp(-l * l * 3.2) * (1.0 - smoothstep(0.0, 1.0, k)) * (1.0 - smoothstep(0.92, 1.0, l));
            vec4 cc = glow(g * 0.62, smoothstep(0.1, 0.8, l));
            cc.rgb += WHITE * exp(-l * l * 18.0) * (1.0 - k) * 0.35;
            rgb = cc.rgb; a = cc.a;
          } else {
            float e = 1.0 - pow(1.0 - k, 3.0), R = mix(0.2, 0.95, e), th = mix(0.6, 0.02, pow(k, 0.6));
            float disc = 1.0 - smoothstep(R - 0.02, R + 0.01, l);
            float inner = smoothstep(R - th - 0.02, R - th, l);
            float ringv = disc * inner;
            float edge = exp(-pow((l - R) / 0.035, 2.0));
            a = max(ringv, edge * 0.6) * (1.0 - smoothstep(0.6, 1.0, k));
            rgb = (mix(WHITE, BRIGHT, smoothstep(0.0, 0.6, k)) * ringv + BRIGHT * edge * 0.7) * (1.0 - smoothstep(0.6, 1.0, k));
          }
          gl_FragColor = vec4(rgb, a);
        }`,
    }), 30);
  }
  life = (i: number) => (this.attrs.aT.array as Float32Array)[i * 4 + 1];
  add(o: StarOpts) { const i = this.alloc(), t0 = this.kit.t + (o.delay ?? 0); this.set(i, "aP", o.pos.x, o.pos.y, o.pos.z); this.set(i, "aT", t0, o.life, o.size, o.rot ?? Math.random() * 6.28); this.set(i, "aK", o.kind ?? 0, o.stretch ?? 1, 0, 0); this.born[i] = t0; this.touch(t0, o.life); return i; }
}

// ============================================================ 贴地冲击环
// kind 0 往外推的冲击波：锐利的亮前沿 + 往里拖的渐变（厚度 thick 米），一路推到 rMax
// kind 1 往里收的环（蓄力：地上的光往脚下收）
// kind 2 范围闪一下：整片 rMax 的圆亮一下（边线最亮，往里渐变），迅速淡掉——“伤害到哪里，光就到哪里”
export interface RingOpts { x: number; z: number; y?: number; rMax: number; life: number; thick?: number; kind?: number; r0?: number; alpha?: number; delay?: number; ease?: number }
class Rings extends Inst {
  constructor(kit: Kit) {
    super(kit, quadBase, 48, { aP: 3, aT: 4, aK: 4 }, premul({
      uniforms: {}, depthTest: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      vertexShader: /* glsl */ `
        uniform float uTime; attribute vec3 aP; attribute vec4 aT, aK; varying vec2 vQ; varying float vK, vKind, vR, vTh, vR0, vA, vE;
        void main() {
          float age = uTime - aT.x; if (age < 0.0 || age > aT.y) { ${HIDE} }
          vK = age / aT.y; vKind = aK.x; vR = aT.z; vTh = aT.w; vR0 = aK.y; vA = aK.z; vE = aK.w;
          float S = aT.z * 1.12 + 0.9; vQ = position.xy * S;
          gl_Position = projectionMatrix * viewMatrix * vec4(aP + vec3(position.x * S, 0.03 + aK.x * 0.004, position.y * S), 1.0);
        }`,
      fragmentShader: /* glsl */ `
        ${GLSL_COMMON}
        varying vec2 vQ; varying float vK, vKind, vR, vTh, vR0, vA, vE;
        void main() {
          float r = length(vQ), k = vK, ang = atan(vQ.y, vQ.x);
          float e = vE > 0.5 ? 1.0 - pow(2.0, -9.0 * k) : 1.0 - pow(1.0 - k, 3.0);
          vec3 rgb; float a;
          if (vKind < 1.5) {
            float rr = vKind < 0.5 ? mix(vR0, vR, e) : mix(vR, vR0, e);
            float th = vTh * (1.0 - 0.45 * k);
            float lead = vKind < 0.5 ? 1.0 - smoothstep(rr - 0.02, rr + 0.09, r) : smoothstep(rr - 0.09, rr + 0.02, r);
            float trail = vKind < 0.5 ? smoothstep(rr - th, rr, r) : 1.0 - smoothstep(rr, rr + th, r);
            float n = fbm(vec2(cos(ang), sin(ang)) * 2.6 + vec2(k * 2.0, vR));
            float band = lead * trail * trail * (0.62 + 0.55 * n);
            float edge = exp(-pow((r - rr) / 0.06, 2.0)) * (0.7 + 0.3 * n);
            float fade = pow(1.0 - k, 1.25) * vA;
            a = clamp(band * 0.8 + edge * 0.55, 0.0, 1.0) * fade;
            rgb = (mix(DEEP, CRIM, pow(trail, 2.0)) * band * 0.8 + mix(HOT, WHITE, 0.65) * edge * 0.95) * fade;
            vec4 cc = over(vec4(rgb, a), glow(exp(-pow((r - rr) / (0.3 + 0.08 * vTh), 2.0)) * fade * 0.6, smoothstep(0.0, 0.5, abs(r - rr))));
            rgb = cc.rgb; a = cc.a;
          } else {
            float edge = exp(-pow((r - vR) / 0.07, 2.0));
            float fill = pow(clamp(r / vR, 0.0, 1.0), 2.6) * (1.0 - smoothstep(vR - 0.02, vR + 0.04, r));
            float fade = k < 0.12 ? k / 0.12 : pow(1.0 - (k - 0.12) / 0.88, 1.6);
            fade *= vA;
            a = clamp(fill * 0.18 + edge * 0.85, 0.0, 1.0) * fade;
            rgb = (mix(DEEP, CRIM, fill) * fill * 0.18 + mix(HOT, WHITE, 0.6) * edge * 1.25) * fade;
            vec4 cc = over(vec4(rgb, a), glow(exp(-pow((r - vR) / 0.3, 2.0)) * fade * 0.7, 0.5));
            rgb = cc.rgb; a = cc.a;
          }
          gl_FragColor = vec4(rgb, a);
        }`,
    }), 6);
  }
  life = (i: number) => (this.attrs.aT.array as Float32Array)[i * 4 + 1];
  add(o: RingOpts) { const i = this.alloc(), t0 = this.kit.t + (o.delay ?? 0); this.set(i, "aP", o.x, o.y ?? 0, o.z); this.set(i, "aT", t0, o.life, o.rMax, o.thick ?? 0.8); this.set(i, "aK", o.kind ?? 0, o.r0 ?? 0.2, o.alpha ?? 1, o.ease ?? 1); this.born[i] = t0; this.touch(t0, o.life); return i; }
}

// ============================================================ 火花、碎片、余烬、碎石
// kind 0 火花：顺着速度在屏幕上拉长，白 → 金 → 绯红；1 碎片：旋转的绯红菱形（亮边）；2 余烬：小圆点，往上飘；3 碎石：暗褐的不规则块，受重力
export interface SparkOpts { pos: V3; n: number; speed: [number, number]; life: [number, number]; size: [number, number]; dir?: V3; spread?: number; up?: number; kind?: number; gravity?: number; drag?: number; stretch?: number; delay?: number; jitter?: number }
class Sparks extends Inst {
  constructor(kit: Kit) {
    super(kit, quadBase, 512, { aP: 3, aV: 3, aT: 4, aC: 4 }, premul({
      uniforms: { uAspect: { value: 1 } }, depthTest: true,
      vertexShader: /* glsl */ `
        uniform float uTime, uAspect; attribute vec3 aP, aV; attribute vec4 aT, aC; varying vec2 vQ; varying float vK, vKind, vSeed;
        void main() {
          float age = uTime - aT.x; if (age < 0.0 || age > aT.y) { ${HIDE} }
          float k = age / aT.y; vK = k; vKind = aC.x; vSeed = aC.y;
          float dr = max(aC.w, 0.01), g = 9.8 * aC.z, ed = exp(-dr * age);
          vec3 p = aP + aV * (1.0 - ed) / dr - vec3(0.0, 0.5 * g * age * age, 0.0);
          vec3 vel = aV * ed - vec3(0.0, g * age, 0.0);
          vec4 c0 = projectionMatrix * viewMatrix * vec4(p, 1.0);
          float sz = aT.z * (aC.x < 0.5 ? (1.0 - 0.6 * k) : (aC.x < 2.5 ? 1.0 - 0.5 * k : 1.0)) * projectionMatrix[1][1] / c0.w;
          vec2 off;
          if (aC.x < 0.5) {
            vec4 c1 = projectionMatrix * viewMatrix * vec4(p - vel * aT.w, 1.0);
            vec2 s0 = c0.xy / c0.w, s1 = c1.xy / c1.w, dd = (s0 - s1) * vec2(uAspect, 1.0);
            float len = length(dd); vec2 nd = len > 1e-5 ? dd / len : vec2(1.0, 0.0), pp = vec2(-nd.y, nd.x);
            vec2 o = nd * position.x * (len * 0.5 + sz) + pp * position.y * sz * 0.5;
            o -= nd * len * 0.5;
            off = o / vec2(uAspect, 1.0);
          } else {
            float a = aC.y * 6.28 + age * (aC.x < 1.5 ? 9.0 : 3.0) * (aC.y > 0.5 ? 1.0 : -1.0);
            mat2 R = mat2(cos(a), sin(a), -sin(a), cos(a));
            off = (R * (position.xy * vec2(1.0, aC.x < 1.5 ? 0.55 : 1.0))) * sz / vec2(uAspect, 1.0);
          }
          vQ = position.xy;
          gl_Position = vec4((c0.xy / c0.w + off) * c0.w, c0.z, c0.w);
        }`,
      fragmentShader: /* glsl */ `
        ${GLSL_COMMON}
        varying vec2 vQ; varying float vK, vKind, vSeed;
        void main() {
          float k = vK; vec3 rgb; float a;
          if (vKind < 0.5) {
            float m = (1.0 - vQ.x * vQ.x) * (1.0 - smoothstep(0.25, 1.0, abs(vQ.y)));
            vec3 c = k < 0.3 ? mix(WHITE, GOLD, k / 0.3) : mix(GOLD, CRIM, (k - 0.3) / 0.7);
            float f = 1.0 - smoothstep(0.65, 1.0, k);
            a = m * f; rgb = c * m * f * 1.15;
          } else if (vKind < 1.5) {
            float dm = abs(vQ.x) + abs(vQ.y);
            float m = 1.0 - smoothstep(0.92, 1.0, dm), e = smoothstep(0.55, 0.85, dm) * m;
            float f = 1.0 - smoothstep(0.6, 1.0, k);
            a = m * f; rgb = (mix(BRIGHT, CRIM, 0.45) * m + HOT * e * 0.8 + WHITE * (1.0 - smoothstep(0.0, 0.3, dm)) * (1.0 - k)) * f;
          } else if (vKind < 2.5) {
            float l = length(vQ), m = exp(-l * l * 5.0);
            float f = smoothstep(0.0, 0.1, k) * (1.0 - smoothstep(0.5, 1.0, k));
            a = m * f * 0.7; rgb = mix(GOLD, BRIGHT, vSeed) * m * f * 1.2;
          } else {
            float dm = max(abs(vQ.x) * 0.9 + abs(vQ.y) * 0.5, abs(vQ.y));
            float m = 1.0 - smoothstep(0.8, 0.9, dm + 0.15 * hash(floor(vQ * 3.0) + vSeed));
            float f = 1.0 - smoothstep(0.7, 1.0, k);
            a = m * f; rgb = mix(vec3(0.24, 0.17, 0.14), vec3(0.42, 0.30, 0.24), step(vQ.y, -0.1)) * m * f;
          }
          gl_FragColor = vec4(rgb, a);
        }`,
    }), 24);
  }
  life = (i: number) => (this.attrs.aT.array as Float32Array)[i * 4 + 1];
  add(o: SparkOpts) {
    const n = Math.max(1, Math.round(o.n * (this.kit.lite ? 0.5 : 1))), rnd = (r: [number, number]) => r[0] + Math.random() * (r[1] - r[0]);
    const d = o.dir ? V(o.dir.x, o.dir.y, o.dir.z).normalize() : null, spread = o.spread ?? Math.PI;
    for (let j = 0; j < n; j++) {
      const i = this.alloc(), t0 = this.kit.t + (o.delay ?? 0) + Math.random() * (o.jitter ?? 0);
      let v: THREE.Vector3;
      if (d) {      // 在 dir 周围 spread 角度的圆锥里随机
        const q = V(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
        v = d.clone().multiplyScalar(Math.cos(spread * Math.random())).add(q.sub(d.clone().multiplyScalar(q.dot(d))).normalize().multiplyScalar(Math.sin(spread * Math.random()))).normalize();
      } else { const a = Math.random() * 6.283, y = (Math.random() * 2 - 1) * 0.35; v = V(Math.cos(a), y, Math.sin(a)).normalize(); }
      v.y += o.up ?? 0; v.multiplyScalar(rnd(o.speed));
      this.set(i, "aP", o.pos.x, o.pos.y, o.pos.z); this.set(i, "aV", v.x, v.y, v.z);
      this.set(i, "aT", t0, rnd(o.life), rnd(o.size), o.stretch ?? 0.05);
      this.set(i, "aC", o.kind ?? 0, Math.random(), o.gravity ?? 1, o.drag ?? 2.5);
      this.born[i] = t0; this.touch(t0, (this.attrs.aT.array as Float32Array)[i * 4 + 1]);
    }
  }
}

// ============================================================ 月牙刀气（单个网格，每刀一个）
// 在局部 XZ 平面里沿圆弧 a0 → a1 的一条带子，外缘是刃（v=1），往里 width 米；物体自己的位置 / 旋转决定圆心和倾斜。
// 时间：0 → sweep 刀头从 a0 扫到 a1（先快后慢）；之后 linger 秒里尾巴追上刀头、整条变细淡掉。
// 刀身：外缘一道恒宽的白热刃线 → 亮粉 → 品红 → 绯红，三阶硬边（照动漫的两三阶色块），内缘被噪声咬成丝缕；刃外一圈淡辉。
export interface CrescentOpts { edgeW?: number; hold?: number; sym?: boolean; pos: V3; yaw: number; tilt?: number; roll?: number; r: number; width: number; a0: number; a1: number; sweep: number; linger: number; tail?: number; alpha?: number; delay?: number; glow?: number }
const crescentBase = (() => { const g = new THREE.BufferGeometry(), p: number[] = [], ix: number[] = [], S = 64, R = 6;
  for (let i = 0; i <= S; i++) for (let j = 0; j <= R; j++) p.push(i / S, j / R * 1.7 - 0.12, 0);      // v 从 -0.12 到 1.58：刃外 0.58 倍宽、内缘外一点，都是光晕的地方
  for (let i = 0; i < S; i++) for (let j = 0; j < R; j++) { const a = i * (R + 1) + j; ix.push(a, a + R + 1, a + 1, a + 1, a + R + 1, a + R + 2); }
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3)); g.setIndex(ix); return g; })();
const crescentMat = premul({
  uniforms: { uR: { value: 3 }, uW: { value: 1 }, uA0: { value: 0 }, uA1: { value: 3 }, uHead: { value: 0 }, uLen: { value: 0.6 }, uThin: { value: 1 }, uFade: { value: 1 }, uGlow: { value: 1 }, uSeed: { value: 0 }, uEdgeW: { value: 1 }, uSym: { value: 0 } },
  side: THREE.DoubleSide, depthTest: true,
  vertexShader: /* glsl */ `
    uniform float uR, uW, uA0, uA1; varying vec2 vUV;
    void main() { float ang = mix(uA0, uA1, position.x), v = position.y;
      float rad = uR - (1.0 - v) * uW;
      vUV = vec2(position.x, v);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(cos(ang) * rad, 0.0, sin(ang) * rad, 1.0); }`,
  fragmentShader: /* glsl */ `
    ${GLSL_COMMON}
    uniform float uW, uR, uHead, uLen, uThin, uFade, uGlow, uSeed, uA0, uA1, uEdgeW, uSym; varying vec2 vUV;
    void main() {
      float u = vUV.x, v = vUV.y;
      float s = (uHead - u) / max(uLen, 1e-3);
      if (s < -0.02 || s > 1.0) discard;
      float sc = clamp(s, 0.0, 1.0);
      float prof = mix(pow(smoothstep(0.0, 0.10, sc), 0.55) * pow(1.0 - sc, 1.15), pow(max(sin(3.14159 * u), 0.0), 0.7), uSym) * uThin;      // uSym：扫完以后变成两头尖、中间厚的新月（终结的 X）
      float dw = (1.0 - v) * uW;                      // 离刃口多少米（刃外是负的）
      float d = (1.0 - v) / max(prof, 1e-3);           // 刀身里的相对深度：0 刃口，1 内缘
      float arcLen = abs(uA1 - uA0) * uR;
      float n = fbm(vec2(d * 5.5 + uSeed, u * arcLen * 0.55 + uSeed * 3.0));
      float n2 = vnoise(vec2(d * 22.0, u * arcLen * 0.25 + uSeed));
      float inner = 1.0 - smoothstep(0.55 + 0.45 * n - 0.06, 0.55 + 0.45 * n, d);          // 内缘咬成丝缕
      float body = dw >= 0.0 ? inner * step(d, 1.05) : 0.0;
      float edge = (1.0 - smoothstep(0.035 * uEdgeW, 0.085 * uEdgeW, abs(dw - 0.02 * uEdgeW))) * smoothstep(0.0, 0.04, sc) * (1.0 - smoothstep(0.85, 1.0, sc)) * step(0.0, uThin - 0.05);
      // 光晕（返工）：同一弯新月放大约 2 倍的柔光——刃外一层、内缘外一层，亮度跟着 uFade / uThin 一起收
      float T = max(prof * uW, 0.02);
      float gOut = dw < 0.0 ? exp(-pow(dw / (0.45 * T + 0.22), 2.0)) : 0.0;
      float gIn = dw > T * 0.6 ? exp(-pow((dw - T * 0.6) / (0.5 * T + 0.2), 2.0)) : (dw >= 0.0 ? 1.0 : 0.0);
      float gl = max(gOut, gIn * 0.75) * smoothstep(0.0, 0.08, sc) * (1.0 - smoothstep(0.85, 1.0, sc)) * uGlow * min(1.0, prof * 3.0 + 0.2);
      // 三阶硬色块（边上只抹一点点，不是渐变）：白刃 → 亮绯 → 深绯（返工：去掉品红和粉）
      float b1 = 1.0 - smoothstep(0.16, 0.19, d), b2 = 1.0 - smoothstep(0.42, 0.46, d);
      vec3 col = mix(mix(CRIM, BRIGHT, b2 * 0.7), mix(BRIGHT, WHITE, 0.3), b1);
      col = mix(col, DEEP, smoothstep(0.75, 1.0, d) * 0.6);
      float streak = smoothstep(0.55, 0.85, n2) * body * (1.0 - b1) * 0.35;
      float fil = smoothstep(0.72, 0.92, vnoise(vec2(d * 38.0 + uSeed, u * arcLen * 0.12))) * smoothstep(0.15, 0.3, d) * (1.0 - smoothstep(0.7, 0.95, d));
      streak += fil * body * 0.55;
      body *= 1.0 - smoothstep(0.8, 1.0, sc) * (1.0 - smoothstep(0.45, 0.75, vnoise(vec2(d * 30.0, u * arcLen * 0.4 + uSeed))));      // 尾巴：只留一缕一缕
      float bo = body * (0.97 - 0.42 * smoothstep(0.2, 1.0, d));      // 越往里越透
      float a = clamp(bo, 0.0, 1.0);
      vec3 rgb = col * bo + HOT * streak * 0.7 + WHITE * edge * 1.3 + WHITE * b1 * body * 0.2;
      a = max(a, edge);
      vec4 cc = over(vec4(rgb, a), glow(gl, gOut > 0.0 ? smoothstep(0.0, 0.6, -dw) : 0.3));
      gl_FragColor = cc * uFade;
    }`,
});
class Crescent implements FxHandle {
  mesh: THREE.Mesh; mat: THREE.ShaderMaterial; t: number;
  constructor(public kit: Kit, public o: CrescentOpts) {
    this.mat = crescentMat.clone(); const u = this.mat.uniforms;
    u.uR.value = o.r; u.uW.value = o.width; u.uA0.value = o.a0; u.uA1.value = o.a1; u.uGlow.value = o.glow ?? 1; u.uEdgeW.value = o.edgeW ?? 1; u.uSeed.value = Math.random() * 10; u.uHead.value = 0;
    this.mesh = new THREE.Mesh(crescentBase, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 32;      /* 画在星芒上面：终结那一下 X 形新月是主角，不能被中心的大星盖住 */
    this.mesh.position.set(o.pos.x, o.pos.y, o.pos.z); this.mesh.rotation.set(o.tilt ?? 0, o.yaw, o.roll ?? 0, "YXZ"); this.mesh.visible = false;
    kit.group.add(this.mesh); this.t = -(o.delay ?? 0);
  }
  update(dt: number) {
    this.t += dt; const o = this.o, u = this.mat.uniforms, t = this.t;
    if (t < 0) return true;
    this.mesh.visible = true;
    const tail = o.tail ?? 0.75;
    u.uSym.value = o.sym ? Math.min(1, Math.max(0, (t / o.sweep - 0.55) / 0.45)) : 0;
    if (t < o.sweep) { const k = t / o.sweep, e = 1 - Math.pow(1 - k, 2.2); u.uHead.value = e; u.uLen.value = Math.max(0.05, Math.min(tail, e * 1.1)); u.uThin.value = 1; u.uFade.value = o.alpha ?? 1; }
    else if (t < o.sweep + (o.hold ?? 0)) { u.uHead.value = 1; u.uLen.value = tail; u.uThin.value = 1; u.uFade.value = o.alpha ?? 1; }      // hold：整弯停一下（终结的 X 要两弯同时完整地亮着）
    else { const k = Math.min(1, (t - o.sweep - (o.hold ?? 0)) / o.linger), e = 1 - Math.pow(1 - k, 2); u.uHead.value = 1 + e * 0.08; u.uLen.value = Math.max(0.02, tail * (1 - e * 0.9)); u.uThin.value = 1 - 0.75 * e; u.uFade.value = (o.alpha ?? 1) * (1 - k * k); }
    return t < o.sweep + (o.hold ?? 0) + o.linger;
  }
  dispose() { this.kit.group.remove(this.mesh); this.mat.dispose(); }
}

// ============================================================ 地面贴花（即梦的黑底发光图：法阵、地裂；或者纯代码的焦痕）
// 两层一起画：mask（图上有东西的地方）把地面压暗成 dark 色（让发光在亮地面上跳出来），再叠加发光 emit（可以“冷却”：从白热绯红褪到 0，只剩暗疤）。
// reveal：从中心往外长出来（带噪声的边）。spin：转。zone=true 时在图外面再加一圈代码画的范围边线和往里渐变的填色。
export interface DecalOpts { tex: "rune" | "crack" | "bloom" | "none"; x: number; z: number; r: number; rot?: number; spin?: number; life: number;
  grow?: number; glow?: [number, number, number]; dark?: [number, number, number]; zone?: boolean; zoneEdge?: number; scar?: number; delay?: number; y?: number; texScale?: number }
const texCache: Record<string, THREE.Texture> = {};
export function loadTex(name: string) { if (!texCache[name]) { const t = new THREE.TextureLoader().load(`/lab/fx_iti/tex/${name}.webp`); t.colorSpace = THREE.NoColorSpace; t.anisotropy = 8; texCache[name] = t; } return texCache[name]; }
const decalMat = premul({
  uniforms: { map: { value: null }, uHasMap: { value: 1 }, uReveal: { value: 1 }, uRot: { value: 0 }, uGlow: { value: 1 }, uDark: { value: 0.5 }, uAlpha: { value: 1 }, uZone: { value: 0 }, uEdge: { value: 0 }, uR: { value: 1 }, uScar: { value: 0 }, uTexScale: { value: 1 }, uTime: { value: 0 } },
  depthTest: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  vertexShader: `varying vec2 vQ; void main() { vQ = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position.x, 0.0, position.y, 1.0); }`,
  fragmentShader: /* glsl */ `
    ${GLSL_COMMON}
    uniform sampler2D map; uniform float uHasMap, uReveal, uRot, uGlow, uDark, uAlpha, uZone, uEdge, uR, uScar, uTexScale, uTime; varying vec2 vQ;
    void main() {
      vec2 q = vQ; float r = length(q), ang = atan(q.y, q.x);
      float rv = 1.0 - smoothstep(uReveal - 0.06, uReveal, r + 0.05 * (vnoise(vec2(cos(ang), sin(ang)) * 3.0 + 1.0) - 0.5));
      vec3 emit = vec3(0.0); float mask = 0.0;
      if (uHasMap > 0.5) {
        vec2 p = mat2(cos(uRot), sin(uRot), -sin(uRot), cos(uRot)) * q / uTexScale;
        vec3 t = texture2D(map, p * 0.5 + 0.5).rgb * step(abs(p.x), 1.0) * step(abs(p.y), 1.0);
        float b = max(t.r, max(t.g, t.b));
        mask = smoothstep(0.03, 0.22, b);
        emit = t * uGlow * mix(0.3, 1.0, smoothstep(0.03, 0.2, r));      // 图正中那团白热收掉大半（不然冷却以后中间还剩一块白雾）
        if (uZone > 0.5) {      // 法阵（返工）：只留线芯（线变细），颜色压成深绯、暗一半，不要一块粉地毯
          float core = smoothstep(0.42, 0.8, b);
          mask = core; emit = mix(CRIM, BRIGHT, smoothstep(0.6, 1.0, b)) * core * uGlow * 0.55;
        }
      } else {
        mask = (1.0 - smoothstep(0.3, 1.0, r)) * (0.75 + 0.25 * fbm(q * 4.0));
      }
      // 疤：发光褪掉以后，亮的那些线留成暗暖褐
      vec3 dark = mix(SCAR, DEEP, 0.25);
      float a = mask * uDark;
      vec3 rgb = dark * a + emit;
      if (uZone > 0.5) {      // 范围：边线 + 往里渐变的填色（边上最浓）
        float e = exp(-pow((r - 0.985) / 0.012, 2.0));
        float fill = pow(clamp(r, 0.0, 1.0), 4.0) * (1.0 - smoothstep(0.975, 0.99, r));
        float tick = step(0.5, fract(ang * 36.0 / 6.2832 + uTime * 0.6)) * smoothstep(0.93, 0.95, r) * (1.0 - smoothstep(0.965, 0.975, r));
        float fk = 0.14 * (1.0 + uEdge * 1.5);      // 填色：原来 0.34 的四成；边线闪的时候跟着闪一下
        a = max(a, clamp(fill * fk + e * 0.95 + tick * 0.2, 0.0, 1.0));
        rgb += mix(DEEP, CRIM, fill) * fill * fk + mix(HOT, WHITE, 0.65) * e * (0.8 + uEdge) + CRIM * tick * 0.2;
        vec4 cc = over(vec4(rgb, a), glow(exp(-pow((r - 0.985) / 0.03, 2.0)) * (0.7 + 0.5 * uEdge), smoothstep(0.0, 0.05, abs(r - 0.985))));
        rgb = cc.rgb; a = cc.a;
      }
      float m = rv * uAlpha;
      gl_FragColor = vec4(rgb * m, clamp(a, 0.0, 1.0) * m);
    }`,
});
class Decal implements FxHandle {
  mesh: THREE.Mesh; mat: THREE.ShaderMaterial; t: number;
  /** 外面可以随时改：edge（边线额外亮多少）、glowMul、alphaMul */
  edge = 0; glowMul = 1; alphaMul = 1; endAt = -1;
  constructor(public kit: Kit, public o: DecalOpts) {
    this.mat = decalMat.clone(); const u = this.mat.uniforms;
    if (o.tex !== "none") u.map.value = loadTex(o.tex); else u.uHasMap.value = 0;
    u.uZone.value = o.zone ? 1 : 0; u.uR.value = o.r; u.uTexScale.value = o.texScale ?? 1; u.uRot.value = o.rot ?? 0;
    const g = new THREE.PlaneGeometry(2, 2); this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 4;
    this.mesh.position.set(o.x, (o.y ?? 0) + 0.02, o.z); this.mesh.scale.setScalar(o.r * (o.zone ? 1.06 : 1)); this.mesh.visible = false; kit.group.add(this.mesh); this.t = -(o.delay ?? 0);
  }
  /** 从现在起 sec 秒后淡完 */
  end(sec: number) { this.endAt = this.t; this.o.life = this.t + sec; }
  update(dt: number) {
    this.t += dt; const o = this.o, u = this.mat.uniforms, t = this.t; if (t < 0) return true;
    this.mesh.visible = true;
    const grow = o.grow ?? 0.1, k = Math.min(1, t / grow);
    u.uReveal.value = o.zone ? 1.2 : (1 - Math.pow(1 - k, 3)) * 1.15;
    if (o.zone) this.mesh.scale.setScalar(o.r * (0.35 + 0.65 * (1 - Math.pow(1 - k, 3)) + 0.04 * Math.sin(Math.min(1, k) * Math.PI)));
    u.uRot.value = (o.rot ?? 0) + (o.spin ?? 0) * t; u.uTime.value = t;
    const g = o.glow ?? [1, 1, 1], dk = o.dark ?? [0.5, 0.5, 0.5];
    // glow / dark 三个数：[开始，0.25 秒后，结束]；中间按时间插值（发光的“冷却”）
    const L = o.life, f = t / L, lerp3 = (v: number[]) => (t < 0.25 ? v[0] + (v[1] - v[0]) * (t / 0.25) : v[1] + (v[2] - v[1]) * Math.min(1, (t - 0.25) / Math.max(L - 0.25, 1e-3)));
    u.uGlow.value = lerp3(g) * this.glowMul; u.uDark.value = lerp3(dk);
    const endFade = this.endAt >= 0 ? Math.max(0, 1 - (t - this.endAt) / Math.max(L - this.endAt, 1e-3)) : 1 - Math.pow(Math.max(0, (f - 0.7) / 0.3), 1.5);
    u.uAlpha.value = Math.max(0, endFade) * this.alphaMul * Math.min(1, t / 0.03 + (o.zone ? 0 : 1));
    u.uEdge.value = this.edge;
    return t < L;
  }
  dispose() { this.kit.group.remove(this.mesh); this.mesh.geometry.dispose(); this.mat.dispose(); }
}

// ============================================================ 爆裂花（被动引爆）：即梦的花图做公告板，白热 → 绽开（转一点）→ 从里往外碎掉
export interface BloomOpts { pos: V3; size: number; life: number; rot?: number; delay?: number }
const bloomMat = premul({
  uniforms: { map: { value: null }, uK: { value: 0 }, uRot: { value: 0 }, uSeed: { value: 0 } }, depthTest: false,
  vertexShader: `uniform float uK; varying vec2 vQ; void main() { vQ = position.xy; vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0); mv.xyz += normalize(-mv.xyz) * 1.6; mv.xy += position.xy * vec2(modelMatrix[0][0], modelMatrix[1][1]); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: /* glsl */ `
    ${GLSL_COMMON}
    uniform sampler2D map; uniform float uK, uRot, uSeed; varying vec2 vQ;
    void main() {
      float k = uK; vec2 q = vQ; float r = length(q), ang = atan(q.y, q.x);
      vec2 p = mat2(cos(uRot), sin(uRot), -sin(uRot), cos(uRot)) * q * 1.25;      // 面片比花大 1.25 倍：外面留给光晕
      vec3 t = texture2D(map, p * 0.5 + 0.5).rgb * step(abs(p.x), 1.0) * step(abs(p.y), 1.0);
      float b = max(t.r, max(t.g, t.b));
      // 返工：不用图里原来的颜色（花瓣外沿那圈暗红像剪纸描边），按亮度重新上色：深绯 → 亮绯 → 白；暗的那圈几乎透明，边是软的
      float m = smoothstep(0.1, 0.45, b), lum = dot(t, vec3(0.3, 0.59, 0.11));
      vec3 col = mix(CRIM, BRIGHT, smoothstep(0.14, 0.38, lum)); col = mix(col, WHITE, smoothstep(0.55, 0.9, lum));
      // 光晕：同一张图取模糊的那一层（mipmap 往上偏 3.5 级）、再放大 1.35 倍，就是花形的柔光
      vec2 pg = p / 1.35;
      float bg = max(max(texture2D(map, pg * 0.5 + 0.5, 3.5).r, texture2D(map, pg * 0.5 + 0.5, 3.5).g), texture2D(map, pg * 0.5 + 0.5, 3.5).b) * step(abs(pg.x), 1.0) * step(abs(pg.y), 1.0);
      float g = smoothstep(0.02, 0.45, bg) * (1.0 - smoothstep(0.3, 0.75, k)) * 0.7;
      // 碎掉：从中心往外、带噪声的门槛（花瓣先空心，再从根部断开，尖端最后没）
      float n = fbm(vec2(cos(ang), sin(ang)) * 1.6 + vec2(uSeed, r * 4.0));
      float hole = smoothstep(0.0, 0.06, r - (k - 0.22) * 1.6 - 0.25 * n);
      float tipcut = 1.0 - smoothstep(0.86, 1.0, k);
      m *= hole * tipcut;
      // 返工：去掉开头整朵过曝的白（那 0.1 秒是一团糊的白粉球），白热改由一颗锐利的星芒来闪
      vec4 cc = over(vec4(col * m * 0.95, m * 0.92), glow(g, 1.0 - smoothstep(0.1, 0.5, bg)));
      gl_FragColor = cc;
    }`,
});
class Bloom implements FxHandle {
  mesh: THREE.Mesh; mat: THREE.ShaderMaterial; t: number;
  constructor(public kit: Kit, public o: BloomOpts) {
    this.mat = bloomMat.clone(); this.mat.uniforms.map.value = loadTex("bloom"); this.mat.uniforms.uSeed.value = Math.random() * 10;
    this.mesh = new THREE.Mesh(quadBase, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 28; this.mesh.position.set(o.pos.x, o.pos.y, o.pos.z); this.mesh.visible = false;
    kit.group.add(this.mesh); this.t = -(o.delay ?? 0);
  }
  update(dt: number) {
    this.t += dt; const t = this.t, o = this.o; if (t < 0) return true; this.mesh.visible = true;
    const k = Math.min(1, t / o.life), e = 1 - Math.pow(2, -10 * Math.min(1, k * 2.2));
    const s = o.size * (0.25 + 0.75 * e + 0.12 * k) * 1.25;
    this.mesh.scale.set(s, s, 1); this.mat.uniforms.uK.value = k; this.mat.uniforms.uRot.value = (o.rot ?? 0) + 0.35 * e + 0.2 * k;
    return t < o.life;
  }
  dispose() { this.kit.group.remove(this.mesh); this.mat.dispose(); }
}

// ============================================================ 冲击墙：有高度的一圈（开口圆柱），往外推、往下矮、淡掉
export interface WallOpts { x: number; z: number; r0: number; r1: number; h: number; life: number; delay?: number }
const wallGeo = new THREE.CylinderGeometry(1, 1, 1, 64, 1, true).translate(0, 0.5, 0);
const wallMat = premul({
  uniforms: { uK: { value: 0 }, uSeed: { value: 0 } }, side: THREE.DoubleSide, depthTest: true,
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    ${GLSL_COMMON}
    uniform float uK, uSeed; varying vec2 vUv;
    void main() {
      float h = vUv.y, k = uK;
      float n = fbm(vec2(vUv.x * 24.0 + uSeed, h * 2.0 - k * 3.0));
      float top = 1.0 - smoothstep(0.25 + 0.55 * n - 0.1, 0.25 + 0.55 * n, h);      // 上沿被咬成一缕一缕往上窜的火舌
      float base = exp(-h * 3.0);
      float m = top * (0.35 + 0.65 * base) * pow(1.0 - k, 1.3);
      vec3 c = mix(CRIM, HOT, base * 0.8) + WHITE * pow(base, 6.0) * 0.6;
      gl_FragColor = vec4(c * m, m * 0.85);
    }`,
});
class Wall implements FxHandle {
  mesh: THREE.Mesh; mat: THREE.ShaderMaterial; t: number;
  constructor(public kit: Kit, public o: WallOpts) { this.mat = wallMat.clone(); this.mat.uniforms.uSeed.value = Math.random() * 10; this.mesh = new THREE.Mesh(wallGeo, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 10; this.mesh.position.set(o.x, 0.02, o.z); this.mesh.visible = false; kit.group.add(this.mesh); this.t = -(o.delay ?? 0); }
  update(dt: number) { this.t += dt; const t = this.t, o = this.o; if (t < 0) return true; this.mesh.visible = true; const k = Math.min(1, t / o.life), e = 1 - Math.pow(1 - k, 3); const r = o.r0 + (o.r1 - o.r0) * e; this.mesh.scale.set(r, o.h * (1 - 0.55 * k), r); this.mat.uniforms.uK.value = k; return t < o.life; }
  dispose() { this.kit.group.remove(this.mesh); this.mat.dispose(); }
}

// ============================================================ 残影：施法者此刻姿势的一个绯红剪影（预先克隆好一池，用的时候抄骨骼）
const ghostMat = new THREE.ShaderMaterial({
  uniforms: { uA: { value: 1 }, uW: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  vertexShader: /* glsl */ `
    #include <common>
    #include <skinning_pars_vertex>
    varying vec3 vN; varying vec3 vV;
    void main() {
      #include <skinbase_vertex>
      #include <beginnormal_vertex>
      #include <skinnormal_vertex>
      #include <begin_vertex>
      #include <skinning_vertex>
      vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
      vN = normalize(normalMatrix * objectNormal); vV = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    ${GLSL_COMMON}
    uniform float uA, uW; varying vec3 vN; varying vec3 vV;
    void main() { float f = 1.0 - abs(dot(normalize(vN), normalize(vV))); f = pow(f, 1.6);
      vec3 c = mix(CRIM, BRIGHT, f) + WHITE * pow(f, 4.0) * 0.8;
      c = mix(c, WHITE, uW);
      float a = (0.42 + 0.58 * f) * uA;
      gl_FragColor = vec4(c * a, a); }`,
});
interface GhostSlot { root: THREE.Group; model: THREE.Object3D; bones: THREE.Object3D[]; mat: THREE.ShaderMaterial; t: number; life: number; a: number; white: number; busy: boolean; drift: THREE.Vector3 }
class Ghosts {
  slots: GhostSlot[] = []; srcBones: THREE.Object3D[] = [];
  constructor(public kit: Kit, public src: LabActor, n: number) {
    const list = (o: THREE.Object3D) => { const b: THREE.Object3D[] = []; o.traverse(x => { if ((x as THREE.Bone).isBone) b.push(x); }); return b; };
    this.srcBones = list(src.hero.model);
    for (let i = 0; i < n; i++) {
      const model = cloneSkinned(src.hero.model), mat = ghostMat.clone(), root = new THREE.Group();
      const kill: THREE.Object3D[] = [];
      model.traverse(o => { const m = o as THREE.Mesh; if (!m.isMesh) return; if (m.name === "outline" || m.name === "white") { kill.push(m); return; } m.material = mat; m.castShadow = false; m.receiveShadow = false; m.renderOrder = 9; m.frustumCulled = false; });
      for (const k of kill) k.parent?.remove(k);
      root.add(model); root.visible = false; kit.group.add(root);
      this.slots.push({ root, model, bones: list(model), mat, t: 0, life: 0.3, a: 0.8, white: 0, busy: false, drift: V() });
    }
  }
  /** 在施法者现在的位置和姿势留一个残影。white：开头白多少（闪现落点那一下）；drift：残影往哪个方向飘（米/秒） */
  spawn(o: { life?: number; alpha?: number; white?: number; drift?: V3; scale?: number } = {}) {
    const s = this.slots.find(x => !x.busy) ?? this.slots.reduce((a, b) => (a.t / a.life > b.t / b.life ? a : b));
    const src = this.src.hero.model;
    for (let i = 0; i < s.bones.length && i < this.srcBones.length; i++) { const a = this.srcBones[i], b = s.bones[i]; b.position.copy(a.position); b.quaternion.copy(a.quaternion); b.scale.copy(a.scale); }
    s.model.position.copy(src.position); s.model.quaternion.copy(src.quaternion); s.model.scale.copy(src.scale);
    this.src.obj.updateMatrixWorld(); s.root.position.copy(this.src.obj.position); s.root.quaternion.copy(this.src.obj.quaternion); s.root.scale.setScalar(o.scale ?? 1);
    s.t = 0; s.life = o.life ?? 0.3; s.a = o.alpha ?? 0.8; s.white = o.white ?? 0; s.busy = true; s.root.visible = true; s.drift.set(o.drift?.x ?? 0, o.drift?.y ?? 0, o.drift?.z ?? 0);
  }
  update(dt: number) { for (const s of this.slots) { if (!s.busy) continue; s.t += dt; const k = s.t / s.life; if (k >= 1) { s.busy = false; s.root.visible = false; continue; } s.root.position.addScaledVector(s.drift, dt); s.mat.uniforms.uA.value = s.a * (1 - k) * (1 - k); s.mat.uniforms.uW.value = s.white * Math.max(0, 1 - k * 4); } }
  clear() { for (const s of this.slots) { s.busy = false; s.root.visible = false; } }
  count() { return this.slots.filter(s => s.busy).length; }
}

// ============================================================ 套件
export class Kit {
  t = 0; uTime = { value: 0 }; group = new THREE.Group(); lite: boolean;
  lines: Lines; stars: Stars; rings: Rings; sparks: Sparks; ghosts: Ghosts; live: FxHandle[] = [];
  constructor(public ctx: FxCtx, cast: LabActor) {
    this.lite = ctx.lite; ctx.scene.add(this.group); BLOOM.value = ctx.lite ? 0.6 : 1;
    this.lines = new Lines(this); this.stars = new Stars(this); this.rings = new Rings(this); this.sparks = new Sparks(this);
    this.ghosts = new Ghosts(this, cast, 12);
  }
  crescent(o: CrescentOpts) { const h = new Crescent(this, o); this.live.push(h); return h; }
  decal(o: DecalOpts) { const h = new Decal(this, o); this.live.push(h); return h; }
  bloom(o: BloomOpts) { const h = new Bloom(this, o); this.live.push(h); return h; }
  wall(o: WallOpts) { const h = new Wall(this, o); this.live.push(h); return h; }
  update(dt: number) {
    this.t += dt; this.uTime.value = this.t;
    (this.sparks.mesh.material as THREE.ShaderMaterial).uniforms.uAspect.value = this.ctx.camera.aspect;
    for (let i = this.live.length - 1; i >= 0; i--) if (!this.live[i].update(dt)) { this.live[i].dispose(); this.live.splice(i, 1); }
    this.ghosts.update(dt);
    for (const s of [this.lines, this.stars, this.rings, this.sparks]) s.tick();
  }
  clear() { for (const h of this.live) h.dispose(); this.live = []; this.lines.clear(); this.stars.clear(); this.rings.clear(); this.sparks.clear(); this.ghosts.clear(); }
  /** 统计：在场的粒子（火花 + 星芒 + 线 + 环）、单个网格的个数 */
  stats() {
    // 特效自己的绘制次数（直接数，不用“总数减底数”——大招里伊缇藏起来，她自己那几次绘制没了，减出来的数会偏小）
    let draws = 0; this.group.traverse(o => { if ((o as THREE.Mesh).isMesh && o.visible) { let v = true, p: THREE.Object3D | null = o; while (p) { if (!p.visible) { v = false; break; } p = p.parent; } if (v) draws++; } });
    return { draws, particles: this.sparks.alive(this.sparks.life), stars: this.stars.alive(this.stars.life), lines: this.lines.alive(this.lines.life), rings: this.rings.alive(this.rings.life), meshes: this.live.length, ghosts: this.ghosts.count() };
  }
}

let KIT: Kit | null = null;
export function kit() { return KIT!; }
export async function prepareKit(ctx: FxCtx, actors: LabActor[]) {
  KIT = new Kit(ctx, actors[0]); (window as any).__kit = KIT;
  for (const n of ["rune", "crack", "bloom", "slash"]) loadTex(n);
  // 先把每种材质画一次（看不见的位置），着色器编好，第一次放技能不卡
  await new Promise(r => setTimeout(r, 300));
  ctx.renderer.compile(ctx.scene, ctx.camera);
}
export function kitStats() { return KIT ? KIT.stats() : { draws: 0, particles: 0, stars: 0, lines: 0, rings: 0, meshes: 0, ghosts: 0 }; }

// ============================================================ 共用的小工具
export const vec = V;
export const sat = (x: number) => Math.max(0, Math.min(1, x));
/** 一段按时间点触发的事件（时间是这段特效自己的世界时间）；同时推着 kit 走 */
export function sequence(events: [number, () => void][], end: number, onEnd?: () => void, extra?: (t: number, dt: number) => void): FxHandle {
  let time = 0, next = 0; events.sort((a, b) => a[0] - b[0]);
  return {
    update(dt) {
      const to = time + dt;
      while (next < events.length && events[next][0] <= to) { const [at, fn] = events[next++]; const step = at - time; if (step > 0) { KIT!.update(step); extra?.(at, step); time = at; } fn(); }
      const rest = to - time; if (rest > 0) { KIT!.update(rest); extra?.(to, rest); } time = to;
      return time < end;
    },
    dispose() { KIT!.clear(); onEnd?.(); },
  };
}
/** 目标身上该打在哪（胸口高度） */
export const chest = (a: LabActor, k = 0.55) => V(a.obj.position.x, a.obj.position.y + a.height * k, a.obj.position.z);
