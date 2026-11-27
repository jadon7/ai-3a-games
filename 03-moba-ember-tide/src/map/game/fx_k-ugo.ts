// 第九轮第三批 k-ugo：乌戈 · 渊灯（沉月会法师，鮟鱇鱼人）的技能特效零件。fxlib 和第二轮的三组零件里没有、乌戈要用的形状都在这里：
//   glow     一团正对镜头的冷光（灯球、弹体、魅惑的小光点）：一张柔光贴图的精灵，进池子
//   beam     冷光束：两点之间一道正对镜头的带子——底下一层普通混合的深水色（在亮地面上给出轮廓），上面一层叠加的光：
//            中间一道近白的芯、外面渊蓝紫，里面一道道往前流的光丝；头上（灯那一头）收细，像是从一点聚出来的
//   tether   诱光的光丝：一条正对镜头的细带子，沿一条二次曲线从乌戈的灯连到小灯（松的时候往下垂、若有若无；绷直以后变亮，有光点顺着丝往回走）
//   tide     磷潮的水面：贴着地形铺的一片深靛色的水（普通半透明，压暗地面），边上一道清楚的亮边；水里星星点点的浮游光点在着色器里现算
//            （不是几百个粒子），用预乘透明混合：水挡住地面，光点叠加发光
//   maw      渊口的预告：贴地的一片越来越深的水，水底一个鱼头的影子从小长大、浮出颌的轮廓和嘴缝，正中的灯慢慢亮起来；边线一直清楚（范围），中间一圈很淡的虚线是“多受伤害”的那 1.4 米
//   jaws     渊口的巨嘴：两片不透明的深靛色颌（半个椭球的壳，哑光的皮上有斑驳和几道褶，口沿一道淡紫的亮线、颌上一排小小的发光点——鮟鱇的发光器），沿颌口一排珍珠白的实体牙；
//            从水里冲上来、张开、一口合上。只是特效模型（照托尔格大招那口钟的做法），不参与规则
//   eye      盯光：目标头顶一只很淡的眼睛形光斑（贴图是代码画的）
// 规矩：几何体只建一次，材质进池子（用完藏起来，下次改参数接着用），团战里不每次新建；动画都用 api.run 推（对局时间：暂停、顿帧都跟着停）。
// 手机档（LITE）：巨嘴、尖牙的分段少一半，浮游光点少一层。这几样里 glow、beam、tether 是通用的形状，合并时可以搬进 fxlib。

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { LITE } from "../quality";
import type { Api } from "./skills";
import type { FxLib, V3 } from "./fxlib";
import { BOUT, FXB, glowBlend } from "./fxb";

type U = Record<string, { value: any }>;
type Run = Pick<Api, "run">;
const NOISE = /* glsl */ `
  float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
  float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 3; i++) { s += a * vn(p); p = p * 2.03 + 11.7; a *= 0.5; } return s / 0.875; }`;
const col = (c: number) => new THREE.Color(c);
const sat = (x: number) => Math.max(0, Math.min(1, x));
/** 预乘透明：rgb 已经乘过不透明度，a 是挡住后面多少。水挡住地面，光点 a 给 0 就是纯叠加 */
const premul = { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor } as const;
/** 这些零件共用的时钟：每个网格画之前对一次特效库的时间 */
const TIME = { value: 0 };
/** 场上镜头在哪（渊口的巨嘴要正对镜头张开）：贴地的零件画之前顺手记下来 */
export const CAM = new THREE.Vector3(0, 60, 40);
const tick = (fx: FxLib) => (_r: unknown, _s: unknown, cam: THREE.Camera) => { TIME.value = fx.time(); CAM.copy(cam.position); };

/** 简单的池子：用完藏起来，下次拿出来改参数接着用 */
function pool<R extends { o: THREE.Object3D }>(make: () => R) {
  const free: R[] = [];
  return { get(fx: FxLib): R { const r = free.pop() ?? make(); r.o.visible = true; fx.group.add(r.o); return r; },
    put(fx: FxLib, r: R) { r.o.visible = false; fx.group.remove(r.o); free.push(r); } };
}

// ---------------------------------------------------------------- glow：一团正对镜头的冷光
let softTex: THREE.CanvasTexture | null = null;
function soft() {
  if (softTex) return softTex;
  const N = 128, cv = document.createElement("canvas"); cv.width = cv.height = N; const c = cv.getContext("2d")!, im = c.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const u = (x + 0.5) / N * 2 - 1, v = (y + 0.5) / N * 2 - 1, r = Math.hypot(u, v), k = (y * N + x) * 4;      // 一个很小的亮芯 + 一圈很快衰减的光晕：远看是一点，不是一团雾
    const a = Math.min(1, Math.exp(-r * r * 60) * 1.1 + Math.exp(-r * r * 9) * 0.42 + Math.exp(-r * r * 3) * 0.1) * (1 - Math.max(0, (r - 0.85) / 0.15)); im.data[k] = im.data[k + 1] = im.data[k + 2] = 255; im.data[k + 3] = Math.round(Math.max(0, a) * 255); }
  c.putImageData(im, 0, 0); softTex = new THREE.CanvasTexture(cv); softTex.colorSpace = THREE.SRGBColorSpace; return softTex;
}
interface GlowRec { o: THREE.Sprite; m: THREE.SpriteMaterial; }
const GLOWS = pool<GlowRec>(() => { const m = new THREE.SpriteMaterial({ map: soft(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }); const o = new THREE.Sprite(m); o.renderOrder = 9.5; o.frustumCulled = false; return { o, m }; });
export interface Glow { set: (p: V3, size: number, alpha: number, color?: number) => void; free: () => void; }
let discTex: THREE.CanvasTexture | null = null;
function disc() {
  if (discTex) return discTex;
  const N = 64, cv = document.createElement("canvas"); cv.width = cv.height = N; const c = cv.getContext("2d")!, im = c.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const u = (x + 0.5) / N * 2 - 1, v = (y + 0.5) / N * 2 - 1, r = Math.hypot(u, v), k = (y * N + x) * 4; im.data[k] = im.data[k + 1] = im.data[k + 2] = 255; im.data[k + 3] = Math.round(Math.max(0, Math.exp(-r * r * 3.2) * (1 - Math.max(0, (r - 0.8) / 0.2))) * 255); }
  c.putImageData(im, 0, 0); discTex = new THREE.CanvasTexture(cv); discTex.colorSpace = THREE.SRGBColorSpace; return discTex;
}
const SHADES = pool<GlowRec>(() => { const m = new THREE.SpriteMaterial({ map: disc(), depthWrite: false, transparent: true }); const o = new THREE.Sprite(m); o.renderOrder = 9.4; o.frustumCulled = false; return { o, m }; });
/** 冷光底下垫的一团暗（普通混合）：亮地面上冷光的颜色才读得出来（“暗底加亮边”） */
export function shade(fx: FxLib, color: number): Glow {
  const R = SHADES.get(fx); R.m.color.set(color); R.m.opacity = 0; let live = true;
  return { set(p, s, a, c) { if (!live) return; R.o.position.set(p.x, p.y, p.z); R.o.scale.setScalar(Math.max(0.001, s)); R.m.opacity = sat(a); if (c !== undefined) R.m.color.set(c); },
    free() { if (live) { live = false; SHADES.put(fx, R); } } };
}
/** 一团冷光：每帧 set 位置、大小、亮度，用完 free */
export function glow(fx: FxLib, color: number): Glow {
  const R = GLOWS.get(fx); R.m.color.set(color); R.m.opacity = 0; let live = true;
  return { set(p, s, a, c) { if (!live) return; R.o.position.set(p.x, p.y, p.z); R.o.scale.setScalar(Math.max(0.001, s)); R.m.opacity = sat(a); if (c !== undefined) R.m.color.set(c); },
    free() { if (live) { live = false; GLOWS.put(fx, R); } } };
}

// ---------------------------------------------------------------- beam：冷光束
const beamGeo = (() => { const N = 32, pos: number[] = [], idx: number[] = []; for (let i = 0; i <= N; i++) { pos.push(i / N, -1, 0, i / N, 1, 0); if (i < N) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); } }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); return g; })();
const BEAM_VERT = /* glsl */ `uniform vec3 uP0, uP1; uniform float uW, uOver, uNeck; varying vec2 vS;
  void main(){ float t = position.x, s = position.y; vS = vec2(t, s);
    vec3 P = mix(uP0, uP1, t); vec4 mv = viewMatrix * vec4(P, 1.0); vec3 tv = (viewMatrix * vec4(uP1 - uP0, 0.0)).xyz; vec3 sd = cross(tv, mv.xyz); float l = length(sd); sd = l > 1e-5 ? sd / l : vec3(0.0, 1.0, 0.0);
    float L = length(uP1 - uP0), d0 = t * L, d1 = (1.0 - t) * L;
    float w = uW * (1.0 + uOver) * mix(0.45, 1.0, smoothstep(0.0, uNeck * 1.4, d0)) * mix(0.55, 1.0, smoothstep(0.0, 0.6, d1));      // 灯那一头从一点聚出来（第四批：从 0.25 放到 0.45、收得更缓，原来灯口那一截细得像折了一下），尽头收一点
    mv.xyz += sd * s * w * 0.5; gl_Position = projectionMatrix * mv; }`;
const beamFrag = (glow: boolean) => /* glsl */ `uniform vec3 uA, uB, uD; uniform float uAlpha, uHot, uTime, uLen, uSeed; varying vec2 vS; ${NOISE} ${glow && FXB.on ? BOUT : ""}
  void main(){ float p = 1.0 - abs(vS.y), t = vS.x, d = t * uLen;
    float ends = smoothstep(0.0, 0.2, d) * (1.0 - smoothstep(uLen - 0.5, uLen, d) * 0.7);
    ${glow ? `float core = pow(p, 16.0), body = pow(p, 1.6), halo = pow(p, 0.6);
      float flow = vn(vec2(d * 0.7 - uTime * 22.0 + uSeed, vS.y * 1.2 + uSeed)) * 0.7 + vn(vec2(d * 1.9 - uTime * 33.0, vS.y * 2.5 - uSeed)) * 0.3;      // 往前流的光丝（第四批：频率减半、只在身子上，芯是干净的一道直线——原来最亮那一帧光丝把白芯打得一段段的，像折线闪电）
      float a = (core * (0.55 + 0.35 * uHot) + body * (0.42 + 0.2 * smoothstep(0.4, 0.85, flow) * (1.0 - core)) + halo * 0.12) * uAlpha * ends; if (a < 0.004) discard;
      vec3 c = mix(uB, uA, smoothstep(0.7, 0.98, p)); c = mix(c, vec3(1.0), core * (0.15 + 0.35 * uHot));      // 主体是渊蓝紫，只有正中一道细芯发白
      ${FXB.on ? "gl_FragColor = bOut_(c, a);" : "gl_FragColor = vec4(c * a, a);\n    #include <colorspace_fragment>"}`
    : `float a = pow(p, 0.7) * 0.55 * uAlpha * ends; if (a < 0.004) discard; gl_FragColor = vec4(uD, a);
    #include <colorspace_fragment>`}
  }`;
interface BeamRec { o: THREE.Group; u: U; }
const BEAMS = pool<BeamRec>(() => {
  const u: U = { uP0: { value: new THREE.Vector3() }, uP1: { value: new THREE.Vector3() }, uW: { value: 0.5 }, uNeck: { value: 1.2 }, uAlpha: { value: 1 }, uHot: { value: 1 }, uTime: TIME, uLen: { value: 10 }, uSeed: { value: 0 }, uA: { value: col(0xffffff) }, uB: { value: col(0xffffff) }, uD: { value: col(0) } };
  const o = new THREE.Group();
  for (const g of [false, true]) { const m = new THREE.Mesh(beamGeo, new THREE.ShaderMaterial({ uniforms: { ...u, uOver: { value: g ? 0 : 1.1 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide, ...(g ? glowBlend() : { blending: THREE.NormalBlending }), vertexShader: BEAM_VERT, fragmentShader: beamFrag(g) }));
    m.frustumCulled = false; m.renderOrder = g ? 9.2 : 8.6; o.add(m); }
  return { o, u };
});
/** 一道冷光束：a 到 b，hold 秒里最亮（宽 w），然后 fade 秒里收细、淡掉 */
export function beam(api: Run, fx: FxLib, a: V3, b: V3, o: { width: number; hold: number; fade: number; color: number; color2: number; deep: number; alpha?: number }) {
  const R = BEAMS.get(fx), u = R.u, al = o.alpha ?? 1;
  (u.uP0.value as THREE.Vector3).set(a.x, a.y, a.z); (u.uP1.value as THREE.Vector3).set(b.x, b.y, b.z); u.uLen.value = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z); u.uSeed.value = Math.random() * 30; u.uW.value = o.width;
  (u.uA.value as THREE.Color).set(o.color); (u.uB.value as THREE.Color).set(o.color2); (u.uD.value as THREE.Color).set(o.deep);
  (R.o.children[0] as THREE.Mesh).onBeforeRender = () => { TIME.value = fx.time(); };
  const T = o.hold + o.fade;
  api.run(T, k => { const t = k * T, f = sat((t - o.hold) / o.fade), pop = t < 0.05 ? 1 + 0.35 * (1 - t / 0.05) : 1;      // 出来的一瞬比后面宽一点（“打出去”的那一下）
    u.uW.value = o.width * pop * (1 - f) * (1 - f * 0.4); u.uAlpha.value = al * (1 - f * f); u.uHot.value = Math.max(0, 1 - t / (o.hold + 0.05)); }, () => BEAMS.put(fx, R));
}

// ---------------------------------------------------------------- trace：光束扫过的地面留下的一道水光痕
// 一条贴着地形的带子（沿线 40 段，每个顶点各自落在地面上）：中间一道刚被照亮的细亮线（很快凉下去），两边一层淡紫的光，底下一道暗的湿印慢慢一块块蚀掉
const TN = 40;
const TRACE_FRAG = /* glsl */ `uniform vec3 uA, uB, uD; uniform float uAlpha, uHot, uDis, uSeed, uTime, uLen; varying vec2 vUv; ${NOISE}
  void main(){ float d = abs(vUv.x - 0.5) * 2.0, v = vUv.y, m = v * uLen;
    float n = vn(vec2(m * 1.3 + uSeed, vUv.x * 3.0)), ends = smoothstep(0.0, 0.6, m) * (1.0 - smoothstep(uLen - 1.2, uLen, m));
    float wet = (1.0 - smoothstep(0.3, 1.0, d + (n - 0.5) * 0.35)) * ends;
    float line = exp(-pow(d / 0.1, 2.0)) * ends, band = exp(-pow(d / 0.5, 2.0)) * ends;
    float sp = pow(vn(vec2(m * 2.6 - uTime * 0.6, uSeed)), 8.0) * line * 2.0;                                  // 凉下去以后线上还留几点微光
    float keep = 1.0; if (uDis > 0.0) keep = smoothstep(uDis * 1.2 - 0.18, uDis * 1.2, vn(vec2(m * 0.9, vUv.x * 2.0) + uSeed) * 0.8 + 0.2 * (1.0 - d));
    float a = wet * 0.32 * uAlpha * keep;
    vec3 glow = (mix(uB, uA, line) * (line * 0.14 + band * 0.05) * uHot + uB * sp * 0.15 * (1.0 - uHot)) * uAlpha * keep;      // 很淡：俯视时和空中的光束错开一段（第四批又压了一档：原来 0.42 的亮线和空中的光束叠成两道平行的白线，像折线）
    if (a < 0.004 && max(glow.r, max(glow.g, glow.b)) < 0.004) discard;
    gl_FragColor = vec4(uD * a + glow, a);
    #include <colorspace_fragment>
  }`;
interface TraceRec { o: THREE.Mesh; u: U; g: THREE.BufferGeometry; }
const TRACES = pool<TraceRec>(() => {
  const P = new Float32Array((TN + 1) * 2 * 3), UV: number[] = [], I: number[] = [];
  for (let i = 0; i <= TN; i++) { UV.push(0, i / TN, 1, i / TN); if (i < TN) { const k = i * 2; I.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); } }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(P, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(UV, 2)); g.setIndex(I);
  const u: U = { uA: { value: col(0xffffff) }, uB: { value: col(0xffffff) }, uD: { value: col(0) }, uAlpha: { value: 0 }, uHot: { value: 1 }, uDis: { value: 0 }, uSeed: { value: 0 }, uTime: TIME, uLen: { value: 10 } };
  const o = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false, side: THREE.DoubleSide, ...premul, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`, fragmentShader: TRACE_FRAG }));
  o.frustumCulled = false; o.renderOrder = 5.65; return { o, u, g };
});
/** 地上一道光痕：从 (x0,z0) 到 (x1,z1)，宽 width 米；hotLife 秒里亮线凉下去，life 秒以后蚀完 */
export function trace(api: Run, fx: FxLib, x0: number, z0: number, x1: number, z1: number, o: { width: number; life: number; hotLife: number; color: number; color2: number; deep: number; alpha?: number }) {
  const R = TRACES.get(fx), u = R.u, P = R.g.getAttribute("position") as THREE.BufferAttribute, L = Math.hypot(x1 - x0, z1 - z0) || 1, nx = -(z1 - z0) / L * o.width / 2, nz = (x1 - x0) / L * o.width / 2, al = o.alpha ?? 1;
  for (let i = 0; i <= TN; i++) { const k = i / TN, cx = x0 + (x1 - x0) * k, cz = z0 + (z1 - z0) * k;
    for (const [j, s] of [[0, -1], [1, 1]] as const) { const px = cx + nx * s, pz = cz + nz * s; P.setXYZ(i * 2 + j, px, fx.ground(px, pz) + 0.08, pz); } }
  P.needsUpdate = true; R.g.computeBoundingSphere();
  (u.uA.value as THREE.Color).set(o.color); (u.uB.value as THREE.Color).set(o.color2); (u.uD.value as THREE.Color).set(o.deep); u.uLen.value = L; u.uSeed.value = Math.random() * 30;
  R.o.onBeforeRender = () => { TIME.value = fx.time(); };
  api.run(o.life, k => { const t = k * o.life; u.uAlpha.value = al * sat(t / 0.03); u.uHot.value = Math.pow(Math.max(0, 1 - t / o.hotLife), 1.6); u.uDis.value = sat((k - 0.45) / 0.55); }, () => TRACES.put(fx, R));
}

// ---------------------------------------------------------------- tether：诱光的光丝
const tetherGeo = (() => { const N = 28, pos: number[] = [], idx: number[] = []; for (let i = 0; i <= N; i++) { pos.push(i / N, -1, 0, i / N, 1, 0); if (i < N) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); } }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); return g; })();
const TETHER_VERT = /* glsl */ `uniform vec3 uP0, uP1, uP2; uniform float uW; varying vec2 vS;
  void main(){ float t = position.x, s = position.y, q = 1.0 - t; vS = vec2(t, s);
    vec3 P = q * q * uP0 + 2.0 * q * t * uP1 + t * t * uP2, T = 2.0 * q * (uP1 - uP0) + 2.0 * t * (uP2 - uP1);
    vec4 mv = viewMatrix * vec4(P, 1.0); vec3 tv = (viewMatrix * vec4(T, 0.0)).xyz; vec3 sd = cross(tv, mv.xyz); float l = length(sd); sd = l > 1e-5 ? sd / l : vec3(0.0, 1.0, 0.0);
    mv.xyz += sd * s * uW * 0.5; gl_Position = projectionMatrix * mv; }`;
const TETHER_FRAG = /* glsl */ `uniform vec3 uA, uB; uniform float uAlpha, uTaut, uTime, uSeed, uCut; varying vec2 vS; ${NOISE} ${FXB.on ? BOUT : ""}
  void main(){ float p = 1.0 - abs(vS.y), t = vS.x;
    float dash = mix(smoothstep(0.35, 0.75, vn(vec2(t * 9.0 - uTime * 1.5 + uSeed, 0.5))), 1.0, uTaut);      // 松的时候若有若无（一段段断开），绷直以后连成一根
    float bead = pow(max(0.0, sin((t * 6.0 + uTime * 3.2) * 3.14159)), 18.0) * uTaut;                       // 绷直以后一颗颗光点顺着丝往回（往乌戈那头）走
    float cut = step(uCut, abs(t - 0.5) * 2.0);                                                              // 断开：从中间往两头断
    float a = (pow(p, 2.2) * (0.38 + 0.5 * uTaut) * dash + bead * pow(p, 1.2) * 0.9) * uAlpha * (1.0 - cut) * smoothstep(0.0, 0.04, t) * smoothstep(1.0, 0.96, t); if (a < 0.004) discard;
    vec3 c = mix(uB, uA, pow(p, 4.0) * 0.8 + bead * 0.6); ${FXB.on ? "gl_FragColor = bOut_(c, a * 0.85);" : "gl_FragColor = vec4(c * a * 0.72, a);\n    #include <colorspace_fragment>"}      // 叠加的光收三成（第四批：亮草地上叠满了就是白的）
  }`;
// 底下垫的一层暗（普通混合，宽一倍多）：叠加发光的淡紫落在亮草地上会变成发白的一道（第四批 polish-new），垫暗以后读成“蓝紫的丝”
const TETHER_DARK = /* glsl */ `uniform vec3 uD; uniform float uAlpha, uTaut, uTime, uSeed, uCut; varying vec2 vS; ${NOISE}
  void main(){ float p = 1.0 - abs(vS.y), t = vS.x;
    float dash = mix(smoothstep(0.35, 0.75, vn(vec2(t * 9.0 - uTime * 1.5 + uSeed, 0.5))), 1.0, uTaut), cut = step(uCut, abs(t - 0.5) * 2.0);
    float a = pow(p, 1.3) * (0.32 + 0.24 * uTaut) * dash * uAlpha * (1.0 - cut) * smoothstep(0.0, 0.06, t) * smoothstep(1.0, 0.94, t); if (a < 0.004) discard;
    gl_FragColor = vec4(uD, a);
    #include <colorspace_fragment>
  }`;
interface TetherRec { o: THREE.Group; u: U; }
const TETHERS = pool<TetherRec>(() => {
  const u: U = { uP0: { value: new THREE.Vector3() }, uP1: { value: new THREE.Vector3() }, uP2: { value: new THREE.Vector3() }, uW: { value: 0.08 }, uAlpha: { value: 1 }, uTaut: { value: 0 }, uTime: TIME, uSeed: { value: 0 }, uCut: { value: 2 }, uA: { value: col(0xffffff) }, uB: { value: col(0xffffff) }, uD: { value: col(0x141a33) } };
  const o = new THREE.Group();
  const lit = new THREE.Mesh(tetherGeo, new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false, side: THREE.DoubleSide, ...glowBlend(), vertexShader: TETHER_VERT, fragmentShader: TETHER_FRAG }));
  const dark = new THREE.Mesh(tetherGeo, new THREE.ShaderMaterial({ uniforms: { ...u, uW: { value: 0.2 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide, vertexShader: TETHER_VERT, fragmentShader: TETHER_DARK }));
  lit.frustumCulled = dark.frustumCulled = false; lit.renderOrder = 9.1; dark.renderOrder = 9.0; o.add(dark, lit); return { o, u };
});
export interface Tether { set: (a: V3, b: V3, sag: number) => void; look: (o: { width?: number; alpha?: number; taut?: number; cut?: number }) => void; free: () => void; }
/** 一根光丝：每帧 set 两头和下垂多少米，look 改粗细、亮度、绷直几成、断到哪（0 没断，1 断完） */
export function tether(fx: FxLib, color: number, color2: number): Tether {
  const R = TETHERS.get(fx), u = R.u; (u.uA.value as THREE.Color).set(color); (u.uB.value as THREE.Color).set(color2); u.uSeed.value = Math.random() * 30; u.uTaut.value = 0; u.uCut.value = 2; u.uAlpha.value = 0; let live = true;
  R.o.children[1].onBeforeRender = () => { TIME.value = fx.time(); };
  return { set(a, b, sag) { if (!live) return; (u.uP0.value as THREE.Vector3).set(a.x, a.y, a.z); (u.uP2.value as THREE.Vector3).set(b.x, b.y, b.z); (u.uP1.value as THREE.Vector3).set((a.x + b.x) / 2, (a.y + b.y) / 2 - sag, (a.z + b.z) / 2); },
    look(o) { if (!live) return; if (o.width !== undefined) { u.uW.value = o.width; ((R.o.children[0] as THREE.Mesh).material as THREE.ShaderMaterial).uniforms.uW.value = o.width * 2.6; } if (o.alpha !== undefined) u.uAlpha.value = o.alpha; if (o.taut !== undefined) u.uTaut.value = o.taut; if (o.cut !== undefined) u.uCut.value = 1 - o.cut; },
    free() { if (live) { live = false; TETHERS.put(fx, R); } } };
}

// ---------------------------------------------------------------- 贴着地形铺的网格（磷潮的水面、渊口的预告共用）
const gridFree: Record<number, THREE.BufferGeometry[]> = {};
function groundGrid(fx: FxLib, x: number, z: number, r: number): { g: THREE.BufferGeometry; seg: number } {
  const seg = r > 3 ? 32 : 16, g = gridFree[seg]?.pop() ?? new THREE.PlaneGeometry(2, 2, seg, seg).rotateX(-Math.PI / 2), pos = g.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) { const lx = pos.getX(i), lz = pos.getZ(i); pos.setY(i, fx.ground(x + lx * r, z + lz * r) + 0.09); }      // 网格的 x、z 是 [-1,1]，模型矩阵只做平移和缩放 x、z，所以 y 直接写世界高度（缩放 y 给 1）
  pos.needsUpdate = true; return { g, seg };
}
const giveGrid = (seg: number, g: THREE.BufferGeometry) => (gridFree[seg] ??= []).push(g);
const GROUND_VERT = /* glsl */ `varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// ---------------------------------------------------------------- tide：磷潮的水面
const TIDE_FRAG = (rich: boolean) => /* glsl */ `uniform float uR, uAlpha, uGlow, uTime, uSeed, uSize, uDis; uniform vec3 uA, uB, uC, uD; varying vec2 vP; ${NOISE}
  // 一层浮游光点：每格（cell 米见方）里最多一颗，位置随机、慢慢漂，亮度一明一暗；只有一部分格子有
  vec3 specks(vec2 w, float cell, float keep, float sz, float seed) {
    vec2 g = w / cell, id = floor(g), f = fract(g); vec3 acc = vec3(0.0);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) { vec2 o = vec2(float(i), float(j)), c = id + o; float h = h21(c + seed);
      if (h > keep) continue;
      float ph = h21(c * 1.7 + seed) * 6.2832, sp = 0.4 + h21(c * 2.3) * 0.8;
      vec2 at = o + 0.5 + 0.32 * vec2(sin(uTime * 0.35 * sp + ph), cos(uTime * 0.29 * sp + ph * 1.3)) - f;
      float d = length(at) * cell, tw = 0.45 + 0.55 * pow(0.5 + 0.5 * sin(uTime * (1.2 + sp) + ph * 3.0), 2.0), big = step(0.88, h21(c * 3.1 + seed));      // 少数几颗更亮更大
      float k = exp(-d * d / (sz * sz * (1.0 + big * 1.6))) * tw * (0.55 + 0.75 * big);
      acc += mix(uB, uC, big * tw) * k; }
    return acc; }
  void main(){
    vec2 w = vP * uSize; float r = length(vP) * 1.05, th = atan(vP.y, vP.x);      // 网格铺到 1.05 倍半径（给边线留地方），r = 1 正好在技能的边上
    float rr = (r + (vn(vec2(th * 3.0 + uSeed, uTime * 0.4)) - 0.5) * 0.02) / max(uR, 1e-3);                 // 边缘慢慢地起伏一点
    if (rr > 1.03) discard;
    float inside = 1.0 - smoothstep(0.975, 0.995, rr);
    float n = fbm(w * 0.45 + vec2(uTime * 0.05, -uTime * 0.04) + uSeed), m = fbm(w * 0.8 - vec2(uTime * 0.07, uTime * 0.03) + uSeed * 2.0);
    float caustic = smoothstep(0.05, 0.0, abs(n - m)) * smoothstep(0.15, 0.6, rr) * 0.6;                       // 细细的水光纹
    float body = inside * (0.46 + 0.16 * smoothstep(0.55, 0.97, rr) + 0.06 * n);                              // 越靠边越深一点：边是清楚的
    float rim = exp(-pow((rr - 0.985) / 0.009, 2.0)), halo = exp(-pow((rr - 0.95) / 0.035, 2.0)) * 0.14;      // 边上一道亮线，里面贴着一圈很淡的光
    vec3 glow = specks(w + uSeed, 0.72, 0.55, 0.075, uSeed) * 0.95 ${rich ? "+ specks(w * 1.0 + 7.3, 0.41, 0.45, 0.045, uSeed + 3.0) * 0.55" : ""};
    glow = glow * inside * uGlow + uB * caustic * 0.07 * inside * uGlow + mix(uB, uC, 0.35) * (rim * 0.6 + halo) * uGlow;
    float keep = 1.0; if (uDis > 0.0) keep = smoothstep(uDis * 1.25 - 0.2, uDis * 1.25, fbm(w * 0.6 + uSeed * 1.3) * 0.85 + rr * 0.15);      // 退去：一块块地没了，外圈先没
    float a = body * uAlpha * keep; glow *= uAlpha * keep;
    vec3 c = mix(uD, uA, caustic * 0.5 + smoothstep(0.6, 1.0, rr) * 0.25);
    if (a < 0.004 && max(glow.r, max(glow.g, glow.b)) < 0.004) discard;
    gl_FragColor = vec4(c * a + glow, a);
    #include <colorspace_fragment>
  }`;
interface TideRec { o: THREE.Mesh; u: U; seg: number; }
const TIDES = pool<TideRec>(() => {
  const u: U = { uR: { value: 1 }, uAlpha: { value: 0 }, uGlow: { value: 1 }, uTime: TIME, uSeed: { value: 0 }, uSize: { value: 3 }, uDis: { value: 0 }, uA: { value: col(0xffffff) }, uB: { value: col(0xffffff) }, uC: { value: col(0xffffff) }, uD: { value: col(0) } };
  const o = new THREE.Mesh(undefined, new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false, ...premul, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, vertexShader: GROUND_VERT, fragmentShader: TIDE_FRAG(!LITE) }));
  o.frustumCulled = false; o.renderOrder = 5.7; return { o, u, seg: 0 };
});
export interface Tide { u: U; free: () => void; }
/** 磷潮的一片水：圆心 (x,z)、半径 r。uR（铺开到几成）、uAlpha、uGlow（光点亮几成）、uDis（退去）由技能每帧写 */
export function tide(fx: FxLib, x: number, z: number, r: number, c: { water: number; deep: number; speck: number; hot: number }): Tide {
  const R = TIDES.get(fx), u = R.u, M = r * 1.05, { g, seg } = groundGrid(fx, x, z, M); R.o.geometry = g; R.seg = seg; R.o.position.set(x, 0, z); R.o.scale.set(M, 1, M);
  u.uSize.value = M; u.uSeed.value = Math.random() * 40; u.uR.value = 0.1; u.uAlpha.value = 0; u.uGlow.value = 1; u.uDis.value = 0;
  (u.uA.value as THREE.Color).set(c.water); (u.uD.value as THREE.Color).set(c.deep); (u.uB.value as THREE.Color).set(c.speck); (u.uC.value as THREE.Color).set(c.hot);
  R.o.onBeforeRender = tick(fx) as never; let live = true;
  return { u, free() { if (!live) return; live = false; giveGrid(R.seg, R.o.geometry); TIDES.put(fx, R); } };
}

// ---------------------------------------------------------------- maw：渊口的预告
// 第四批 polish-new 重做：原来是贴地画一圈 14 颗白色的平面尖牙往里收，俯视像一个钟面图标（白牙是纸片，没有体积）。
// 现在照 LoL 菲兹大招的落点：一片越来越深的暗水，边线一直清楚（范围）；水底一个巨大的鱼头影子从小长大、越来越黑（“有东西从下面上来了”），
// 影子上后半段浮出两片颌的轮廓和中间那道嘴缝（淡紫的细线）；正中那盏灯（鮟鱇的诱饵）从深处慢慢亮起来；几段断开的波纹往中心收。
// 牙只长在真的三维巨嘴上（jaws），地上不再画牙。uRot 是巨嘴的朝向（和 jaws 的 yaw 一样），影子的长轴、嘴缝跟着它
const MAW_FRAG = /* glsl */ `uniform float uK, uAlpha, uTime, uSeed, uIn, uN, uFang, uRot; uniform vec3 uA, uB, uC, uD; varying vec2 vP; ${NOISE}
  void main(){
    vec2 p = vP * 1.06; float r = length(p), th = atan(p.y, p.x); if (r > 1.05) discard;      // 网格铺到 1.06 倍半径，r = 1 正好在技能的边上
    float inside = 1.0 - smoothstep(0.986, 0.998, r), n = fbm(p * 3.0 + uSeed);
    float body = inside * mix(0.42, 0.8, uK) * (0.92 + 0.08 * n);                                                 // 水面：越来越深（暗水要压得住地面，淡了就是一块发白的半透明盘子）
    // 水底的鱼头影子：一个横着的椭圆（长轴沿巨嘴的铰链），从小长大、越来越黑；巨嘴浮上来以后（uFang 收到 0）影子就是嘴本身，地上的淡掉
    float cs = cos(uRot), sn = sin(uRot); vec2 q = vec2(p.x * cs - p.y * sn, p.x * sn + p.y * cs);
    float sz = mix(0.22, 0.9, uK * uK * (3.0 - 2.0 * uK)), e = length(q / vec2(sz, sz * 0.52)) + (n - 0.5) * 0.12;
    float shadow = (1.0 - smoothstep(0.45, 1.0, e)) * smoothstep(0.05, 0.35, uK) * uFang;
    float lip = exp(-pow((e - 0.93) / 0.035, 2.0)) * smoothstep(0.4, 0.85, uK) * uFang * (0.55 + 0.45 * vn(vec2(th * 7.0 + uSeed, uTime * 1.5)));      // 两片颌的轮廓：影子边上一道很淡的淡紫
    float seam = exp(-pow((q.y - 0.05 * sz * sin(q.x / sz * 3.0)) / (0.01 + 0.012 * (1.0 - uK)), 2.0)) * (1.0 - smoothstep(0.6, 0.98, abs(q.x) / sz)) * smoothstep(0.55, 0.92, uK) * uFang;      // 中间那道嘴缝
    // 往中心收的波纹：一段段断开的细弧（不是整圈的环——整圈的像靶子）
    float rw = r * 22.0 + uTime * 7.0, arc = step(0.55, vn(vec2(th * 4.0 + uSeed, floor(rw / 6.2832) * 3.1)));
    float rip = pow(max(0.0, sin(rw)), 14.0) * arc * smoothstep(0.35, 0.6, r) * (1.0 - smoothstep(0.82, 0.95, r)) * (0.4 + 0.6 * uK);
    float rim = exp(-pow((r - 0.99) / 0.008, 2.0)), rimIn = exp(-pow((r - 0.962) / 0.022, 2.0)) * 0.22;      // 边线：一道清楚的细亮线
    float outer = smoothstep(0.992, 1.002, r) * (1.0 - smoothstep(1.002, 1.035, r)) * 0.4;                    // 边线外面一圈很窄的暗边：亮地面上也看得出边
    float sweet = exp(-pow((r - uIn) / 0.007, 2.0)) * step(0.5, fract(th * 9.0 / 3.14159 + uTime * 0.12)) * 0.3 * (1.0 - shadow * 0.6);      // 中心 1.4 米：一圈很淡的虚线
    float lure = exp(-r * r / 0.012) * uK * uK * (0.85 + 0.15 * sin(uTime * 9.0)), lureHalo = exp(-r * r / 0.07) * uK * uK * 0.35;            // 水底那盏灯：从深处慢慢亮起来
    float a = (body + shadow * 0.55 * (1.0 - body) + outer) * uAlpha;
    vec3 c = uD * (1.0 - 0.45 * shadow);
    vec3 glow = (uB * (rim * 0.8 + rimIn + lip * 0.22 + seam * 0.45 + rip * 0.08) + uC * sweet + uC * (lure * 0.9 + lureHalo * 0.7)) * uAlpha;      // 颌的轮廓只是若有若无的一道（亮了像几圈轨道线）
    if (a < 0.004 && max(glow.r, max(glow.g, glow.b)) < 0.004) discard;
    gl_FragColor = vec4(c * a + glow, a);
    #include <colorspace_fragment>
  }`;
interface MawRec { o: THREE.Mesh; u: U; seg: number; }
const MAWS = pool<MawRec>(() => {
  const u: U = { uK: { value: 0 }, uAlpha: { value: 0 }, uTime: TIME, uSeed: { value: 0 }, uIn: { value: 0.4 }, uN: { value: 14 }, uFang: { value: 1 }, uRot: { value: 0 }, uA: { value: col(0xffffff) }, uB: { value: col(0xffffff) }, uC: { value: col(0xffffff) }, uD: { value: col(0) } };
  const o = new THREE.Mesh(undefined, new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false, ...premul, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, vertexShader: GROUND_VERT, fragmentShader: MAW_FRAG }));
  o.frustumCulled = false; o.renderOrder = 5.75; return { o, u, seg: 0 };
});
export interface Maw { u: U; free: () => void; }
/** 渊口的预告：半径 r（边线正好在 r 上），inner 是“多受伤害”那一圈的半径，yaw 是巨嘴的朝向（水底影子的长轴跟着它）。uK（0→1 越来越深）、uAlpha、uFang（水底影子还在几成）由技能每帧写 */
export function maw(fx: FxLib, x: number, z: number, r: number, inner: number, c: { fang: number; rim: number; glow: number; deep: number }, yaw = 0): Maw {
  const R = MAWS.get(fx), u = R.u, M = r * 1.06, { g, seg } = groundGrid(fx, x, z, M); R.o.geometry = g; R.seg = seg; R.o.position.set(x, 0, z); R.o.scale.set(M, 1, M);
  u.uK.value = 0; u.uAlpha.value = 0; u.uFang.value = 1; u.uSeed.value = Math.random() * 40; u.uIn.value = inner / r; u.uN.value = LITE ? 12 : 14; u.uRot.value = yaw;
  (u.uA.value as THREE.Color).set(c.fang); (u.uB.value as THREE.Color).set(c.rim); (u.uC.value as THREE.Color).set(c.glow); (u.uD.value as THREE.Color).set(c.deep);
  R.o.onBeforeRender = tick(fx) as never; let live = true;
  return { u, free() { if (!live) return; live = false; giveGrid(R.seg, R.o.geometry); MAWS.put(fx, R); } };
}

// ---------------------------------------------------------------- jaws：渊口的巨嘴
// 一片颌是半个椭球的壳（SphereGeometry 的半边：开口是 z=0 的那个面，口沿是一个竖着的椭圆）。圆心放在水面上，水面以下的一半被地面挡住看不见。
// 两片颌合上就是一个扁圆的“鱼头”顶出水面；张开时各自绕水面上那根横轴往外倒。牙沿着口沿的上半圈，朝口的中心长（两片错开半颗），珍珠白。
// 颌壳分两遍画：先画里面（背面：深色的口腔，越往下越透出灯的蓝紫），再画外面（正面：有明暗的深靛色皮、淡紫的轮廓光、口沿一道亮线）。
// 都是半透明不写深度，分两遍才不会里外乱叠。牙是不透明的实体（写深度），所以壳和牙的前后关系是对的；牙的出现和消失靠缩放，不靠透明。
const JAW_VERT = /* glsl */ `varying vec3 vN, vW, vL; void main(){ vL = position; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`;
const jawFrag = (inside: boolean) => /* glsl */ `uniform vec3 uSkin, uSkin2, uRim, uIn, uSpot, uGlow; uniform float uAlpha, uFlash, uG, uLure, uSeed; varying vec3 vN, vW, vL; ${NOISE}
  void main(){
    vec3 N = normalize(vN) * ${inside ? "-1.0" : "1.0"}, V = normalize(cameraPosition - vW);
    float fr = pow(1.0 - abs(dot(N, V)), 2.0), wl = smoothstep(uG - 0.05, uG + 0.55, vW.y);              // 贴着水面的那一截淡掉：像是从水里冲出来的
    float lip = 1.0 - smoothstep(0.0, 0.07, vL.z);                                                        // 口沿：半个壳开口的那一圈
    vec3 c; float a;
    ${inside ? `float low = 1.0 - smoothstep(0.0, 0.85, vL.y);
      c = mix(uIn, uGlow * 0.6, low * uLure * 0.75) + uRim * lip * 0.6; a = 1.0;`
    : `float lam = 0.3 + 0.7 * max(0.0, dot(N, normalize(vec3(-0.35, 0.85, 0.4)))), rimL = pow(1.0 - abs(dot(N, V)), 3.2);
      float th = atan(vL.y, vL.x), row = exp(-pow((vL.z - 0.42) / 0.07, 2.0)), dots = smoothstep(0.965, 0.995, cos(th * 16.0)) * row * step(0.12, vL.y);      // 颌上一排小小的发光点（鮟鱇的发光器），代替乱的斑点
      // 第四批 polish-new：原来是半透明（0.9）加一圈很亮的菲涅尔轮廓光，合上以后整个是一个发光的扁圆顶，像果冻罩子。
      // 现在不透明、哑光：皮上一层斑驳（深浅不一的靛色）和几道顺着颌弯的褶，轮廓光压到很弱、只剩口沿一道亮线——读成一个有分量的鱼头，不是玻璃
      float mott = fbm(vL.xy * 3.2 + vL.z * 2.0 + uSeed), fold = smoothstep(0.55, 0.95, sin(length(vL.xy) * 15.0 + mott * 2.5) * 0.5 + 0.5) * smoothstep(0.15, 0.6, vL.z);
      c = mix(uSkin2, uSkin, lam) * (0.72 + 0.5 * mott) * (1.0 - 0.22 * fold) + uRim * (rimL * 0.12 + lip * (0.55 + uFlash)) + uGlow * dots * 0.8;
      a = 1.0;`}
    c = mix(c, vec3(1.0), uFlash * (0.04 + 0.6 * lip));
    a *= uAlpha * wl; if (a < 0.004) discard;
    gl_FragColor = vec4(c, min(a, 1.0));
    #include <colorspace_fragment>
  }`;
const TOOTH_VERT = /* glsl */ `attribute float aT; varying vec3 vN, vW; varying float vT; void main(){ vT = aT; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`;
const TOOTH_FRAG = /* glsl */ `uniform vec3 uA, uB; uniform float uFlash; varying vec3 vN, vW; varying float vT;
  void main(){ vec3 N = normalize(vN), V = normalize(cameraPosition - vW); float fr = pow(1.0 - abs(dot(N, V)), 1.6), lit = 0.62 + 0.38 * max(0.0, dot(N, normalize(vec3(-0.35, 0.85, 0.4))));
    vec3 c = mix(uA * lit, uB, fr * 0.5 + (1.0 - vT) * 0.3); c = mix(c, vec3(1.0), uFlash * 0.35 + vT * vT * 0.2);      // 牙根带一点淡紫，牙尖更白
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }`;
let jawGeo: THREE.BufferGeometry | null = null;
const toothGeos: THREE.BufferGeometry[] = [];
/** 一片颌上的一排牙（合成一个网格）。side 0、1 两片错开半颗。牙的位置是没有缩放的颌坐标（颌的壳单独缩放） */
function teethGeometry(side: number, RX: number, RY: number) {
  if (toothGeos[side]) return toothGeos[side];
  const n = LITE ? 7 : 9, parts: THREE.BufferGeometry[] = [], up = new THREE.Vector3(0, 1, 0), d = new THREE.Vector3(), q = new THREE.Quaternion();
  for (let i = 0; i < n; i++) {
    const s = Math.PI * (0.14 + 0.72 * (i + (side ? 0.75 : 0.25)) / n), cx = RX * Math.cos(s), cy = RY * Math.sin(s), mid = Math.sin(s), long = (i + side) % 2 === 0;
    const h = (long ? 0.56 : 0.38) * (0.8 + 0.3 * mid), r0 = (long ? 0.15 : 0.12) * (0.85 + 0.25 * mid);
    const g = new THREE.ConeGeometry(r0, h, LITE ? 6 : 8, 1); g.translate(0, h / 2, 0);
    const t = new Float32Array(g.getAttribute("position").count); const P = g.getAttribute("position"); for (let k = 0; k < t.length; k++) t[k] = P.getY(k) / h; g.setAttribute("aT", new THREE.BufferAttribute(t, 1));
    d.set(-Math.cos(s) / RX, -Math.sin(s) / RY, -0.5).normalize(); q.setFromUnitVectors(up, d); g.applyQuaternion(q);      // 朝口的中心长，往对面那片颌斜一点
    g.translate(cx * 0.985, cy * 0.985, 0.05); parts.push(g.toNonIndexed());
  }
  const all = mergeGeometries(parts)!; for (const p of parts) p.dispose(); toothGeos[side] = all; return all;
}
interface JawRec { o: THREE.Group; jaws: THREE.Group[]; teeth: THREE.Mesh[]; u: U; ut: U; }
const JRX = 3.3, JRY = 2.9, JRZ = 1.55;
const JAWS = pool<JawRec>(() => {
  jawGeo ??= new THREE.SphereGeometry(1, LITE ? 22 : 40, LITE ? 12 : 22, 0, Math.PI, 0, Math.PI);
  const u: U = { uSkin: { value: col(0) }, uSkin2: { value: col(0) }, uRim: { value: col(0) }, uIn: { value: col(0) }, uSpot: { value: col(0) }, uGlow: { value: col(0) }, uAlpha: { value: 0 }, uFlash: { value: 0 }, uG: { value: 0 }, uLure: { value: 1 }, uSeed: { value: 0 } };
  const ut: U = { uA: { value: col(0xffffff) }, uB: { value: col(0xffffff) }, uFlash: { value: 0 } };
  const mIn = new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false, side: THREE.BackSide, vertexShader: JAW_VERT, fragmentShader: jawFrag(true) });
  const mOut = new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false, side: THREE.FrontSide, vertexShader: JAW_VERT, fragmentShader: jawFrag(false) });
  const tm = new THREE.ShaderMaterial({ uniforms: ut, vertexShader: TOOTH_VERT, fragmentShader: TOOTH_FRAG });
  const o = new THREE.Group(), jaws: THREE.Group[] = [], teeth: THREE.Mesh[] = [];
  for (const side of [0, 1]) {
    const hinge = new THREE.Group(), turn = new THREE.Group(); turn.rotation.y = side ? Math.PI : 0;      // 第二片转半圈，长在另一边
    for (const [m, ro] of [[mIn, 7.55], [mOut, 7.65]] as const) { const shell = new THREE.Mesh(jawGeo, m); shell.scale.set(JRX, JRY, JRZ); shell.renderOrder = ro; shell.frustumCulled = false; hinge.add(shell); }
    const th = new THREE.Mesh(teethGeometry(side, JRX, JRY), tm); th.frustumCulled = false; hinge.add(th); teeth.push(th);
    turn.add(hinge); o.add(turn); jaws.push(hinge);
  }
  return { o, jaws, teeth, u, ut };
});
export interface Jaws { set: (o: { y: number; open: number; alpha: number; flash?: number; scale?: number; lure?: number; teeth?: number }) => void; free: () => void; }
/** 一张巨嘴：(x, gy, z) 是水面的圆心，yaw 让它正对镜头张开（下颌靠近镜头）。set 每帧给：整体往下沉多少米、张开的角度、透明度、合上那一下的泛白、牙长出来几成 */
export function jaws(fx: FxLib, x: number, gy: number, z: number, yaw: number, c: { skin: number; skin2: number; rim: number; inside: number; spot: number; glow: number; tooth: number; tooth2: number }): Jaws {
  const R = JAWS.get(fx), { u, ut } = R; R.o.position.set(x, gy, z); R.o.rotation.set(0, yaw, 0);
  (u.uSkin.value as THREE.Color).set(c.skin); (u.uSkin2.value as THREE.Color).set(c.skin2); (u.uRim.value as THREE.Color).set(c.rim); (u.uIn.value as THREE.Color).set(c.inside); (u.uSpot.value as THREE.Color).set(c.spot); (u.uGlow.value as THREE.Color).set(c.glow);
  (ut.uA.value as THREE.Color).set(c.tooth); (ut.uB.value as THREE.Color).set(c.tooth2); u.uG.value = gy; u.uSeed.value = Math.random() * 20; u.uAlpha.value = 0;
  const lure = glow(fx, c.glow), lp = new THREE.Vector3(); let live = true;
  return { set(o) { if (!live) return; const s = o.scale ?? 1, tk = o.teeth ?? 1; R.o.position.y = gy - o.y; R.o.scale.setScalar(s);
      R.jaws[0].rotation.x = o.open; R.jaws[1].rotation.x = o.open * 1.12;      // 下颌（靠镜头那片）张得大一点，像鮟鱇往前伸的下巴
      for (const t of R.teeth) { t.visible = tk > 0.02 && o.alpha > 0.05; t.scale.setScalar(Math.max(0.02, tk)); }
      u.uAlpha.value = o.alpha; u.uFlash.value = ut.uFlash.value = o.flash ?? 0; u.uLure.value = o.lure ?? 1;
      lp.set(x, gy - o.y + 0.9 * s, z); lure.set(lp, 1.6 * s, (o.lure ?? 1) * o.alpha * 0.8); },
    free() { if (!live) return; live = false; lure.free(); JAWS.put(fx, R); } };
}

// ---------------------------------------------------------------- eye：盯光
let eyeTex: THREE.CanvasTexture | null = null;
/** 一只眼睛形的光斑：外面一道暗的描边（在亮地面上也看得清），里面一道亮线勾出杏仁形的眼眶、一圈虹膜、一个瞳孔 */
function eyeTexture(main: string, hot: string) {
  if (eyeTex) return eyeTex;
  const W = 160, H = 96, cv = document.createElement("canvas"); cv.width = W; cv.height = H; const c = cv.getContext("2d")!;
  const lid = () => { c.beginPath(); c.moveTo(14, H / 2); c.quadraticCurveTo(W / 2, 2, W - 14, H / 2); c.quadraticCurveTo(W / 2, H - 2, 14, H / 2); c.closePath(); };
  c.lineJoin = "round"; c.lineCap = "round";
  lid(); c.fillStyle = "rgba(20,26,51,0.35)"; c.fill(); c.lineWidth = 11; c.strokeStyle = "rgba(20,26,51,0.55)"; c.stroke();
  lid(); c.lineWidth = 4.5; c.strokeStyle = main; c.stroke();
  c.beginPath(); c.arc(W / 2, H / 2, 21, 0, Math.PI * 2); c.lineWidth = 3.5; c.strokeStyle = main; c.stroke();
  const g = c.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, 11); g.addColorStop(0, "#ffffff"); g.addColorStop(0.5, hot); g.addColorStop(1, "rgba(124,140,255,0)"); c.fillStyle = g; c.beginPath(); c.arc(W / 2, H / 2, 11, 0, Math.PI * 2); c.fill();
  eyeTex = new THREE.CanvasTexture(cv); eyeTex.colorSpace = THREE.SRGBColorSpace; return eyeTex;
}
interface EyeRec { o: THREE.Sprite; m: THREE.SpriteMaterial; }
let eyeCols = ["#7c8cff", "#d8e4ff"];
const EYES = pool<EyeRec>(() => { const m = new THREE.SpriteMaterial({ map: eyeTexture(eyeCols[0], eyeCols[1]), depthWrite: false, depthTest: false, transparent: true }); const o = new THREE.Sprite(m); o.renderOrder = 10; o.frustumCulled = false; return { o, m }; });
export interface Eye { set: (p: V3, w: number, alpha: number) => void; free: () => void; }
export function eye(fx: FxLib, main: string, hot: string): Eye {
  eyeCols = [main, hot]; const R = EYES.get(fx); R.m.opacity = 0; let live = true;
  return { set(p, w, a) { if (!live) return; R.o.position.set(p.x, p.y, p.z); R.o.scale.set(w, w * 0.6, 1); R.m.opacity = sat(a); }, free() { if (live) { live = false; EYES.put(fx, R); } } };
}

/** 着色器预热：每种零件先各出一个看不见的（在地下 40 米），第一次放技能时不卡一下。一局只做一次 */
const warmed = new WeakSet<THREE.Group>();
export function warmUgo(api: Run, fx: FxLib, x: number, z: number) {
  if (warmed.has(fx.group)) return; warmed.add(fx.group);
  const y = fx.ground(x, z) - 40, p = { x, y, z }, q = { x, y: y + 0.01, z };
  const g = glow(fx, 0xffffff); g.set(p, 0.01, 0); api.run(0.1, () => {}, g.free); const sh = shade(fx, 0); sh.set(p, 0.01, 0); api.run(0.1, () => {}, sh.free);
  beam(api, fx, p, q, { width: 0.01, hold: 0.05, fade: 0.05, color: 0, color2: 0, deep: 0, alpha: 0 });
  trace(api, fx, x, z, x + 0.01, z, { width: 0.01, life: 0.1, hotLife: 0.05, color: 0, color2: 0, deep: 0, alpha: 0 });
  const t = tether(fx, 0, 0); t.set(p, q, 0); api.run(0.1, () => {}, t.free);
  const e = eye(fx, "#7c8cff", "#d8e4ff"); e.set(p, 0.01, 0); api.run(0.1, () => {}, e.free);
  const td = tide(fx, x, z, 0.5, { water: 0, deep: 0, speck: 0, hot: 0 }); td.u.uAlpha.value = 0; td.u.uGlow.value = 0; api.run(0.1, () => {}, td.free);
  const mw = maw(fx, x, z, 0.5, 0.2, { fang: 0, rim: 0, glow: 0, deep: 0 }); api.run(0.1, () => {}, mw.free);
  const j = jaws(fx, x, y, z, 0, { skin: 0, skin2: 0, rim: 0, inside: 0, spot: 0, glow: 0, tooth: 0, tooth2: 0 }); j.set({ y: 0, open: 0, alpha: 0.06 }); api.run(0.1, () => {}, j.free);      // 在地下 40 米，透明度给一点点让牙的着色器也编上
}
