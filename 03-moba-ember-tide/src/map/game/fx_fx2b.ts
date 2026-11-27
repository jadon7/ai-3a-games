// 特效第二轮（fx2b）给摩珂、奥森补的零件。fxlib 里没有、这两个英雄要用的形状都在这里：
//   helix     从脚底绕着身体往上旋的光带（治疗、护盾成形）。“加血”的通用语言：亮环 + 旋上去的光带 + 往上飘的小星
//   fireball  一团成形的火球：先胀开，再从里往外被“烧穿”（噪声侵蚀），烧穿的边是一圈亮橙，不是一团随机粒子
//   thickRing 贴地的一圈有厚度的冲击环：外沿锐、往里拖一段软的，边上被噪声啃得不齐。水用普通半透明，火用叠加
//   wall      一圈竖着的矮墙（范围的边）：烟墙（熄灯）、白沫水墙（月潮）。底边逐点贴着地形
//   wisp      一缕细细的、弯弯曲曲往上飘的烟（熄灯里掐灭的烛芯）
//   waxSolid  凝固的蜡：蜡刺、裹住脚的一截蜡壳（实体，吃场景的光）
// 规矩：几何体只建一次；材质进池子（用完藏起来，下次改参数接着用），团战里不每次新建。手机档（LITE）不画最贵的几样。
// 这几个零件都不依赖英雄，“helix / fireball / thickRing / wall”以后可以搬进 fxlib。

import * as THREE from "three";
import type { Api } from "./skills";
import type { FxLib } from "./fxlib";
import { LITE } from "../quality";
import { BOUT, FXB, glowBlend } from "./fxb";

type Ctx = { api: Api; fx: FxLib };
const NOISE = /* glsl */ `
  float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
  float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 3; i++) { s += a * vn(p); p = p * 2.03 + 11.7; a *= 0.5; } return s / 0.875; }`;
const TIME = { value: 0 };                                           // 这些零件共用的时钟：每个网格画之前对一次特效库的时间
const col = (c: number) => ({ value: new THREE.Color(c) });
const sat = (x: number) => Math.max(0, Math.min(1, x));

/** 一个简单的池子：材质和网格用完藏起来，下次拿出来改参数接着用 */
function pool<R extends { m: THREE.Mesh }>(make: (fx: FxLib) => R) {
  const free: R[] = [];
  return {
    get(fx: FxLib): R { const r = free.pop() ?? make(fx); r.m.visible = true; fx.group.add(r.m); r.m.onBeforeRender = () => { TIME.value = fx.time(); }; return r; },
    put(fx: FxLib, r: R) { r.m.visible = false; fx.group.remove(r.m); free.push(r); },
  };
}

// ---------------------------------------------------------------- 往上旋的光带（治疗、护盾成形）
// 两股（或三股）螺旋的带子，绕着一根竖轴从脚底往上走：亮的头在前、身后拖一段渐暗的尾巴，越往上圈越小。叠加发光，颜色淡。
let helixGeo: THREE.BufferGeometry | null = null;
function helixGeometry() {
  if (helixGeo) return helixGeo;
  const S = 56, STR = 3, P: number[] = [], A: number[] = [], I: number[] = [];
  for (let st = 0; st < STR; st++) for (let i = 0; i <= S; i++) for (const side of [-1, 1]) { P.push(0, 0, 0); A.push(i / S, side, st); }
  for (let st = 0; st < STR; st++) for (let i = 0; i < S; i++) { const b = st * (S + 1) * 2 + i * 2; I.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
  helixGeo = new THREE.BufferGeometry(); helixGeo.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); helixGeo.setAttribute("aH", new THREE.Float32BufferAttribute(A, 3)); helixGeo.setIndex(I);
  helixGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 50); return helixGeo;
}
const HELIX = pool(() => {
  const u = { uTime: TIME, uHead: { value: 0 }, uLen: { value: 0.5 }, uR: { value: 1 }, uH: { value: 2 }, uW: { value: 0.22 }, uTurns: { value: 1.5 }, uAlpha: { value: 1 }, uStr: { value: 2 }, uSeed: { value: 0 }, uA: col(0xffffff), uB: col(0xffffff) };
  const mat = new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,      // 一半叠加一半遮挡：纯叠加在亮的草地上会被冲成发黄的白，颜色读不出来
    vertexShader: /* glsl */ `attribute vec3 aH; uniform float uR, uH, uW, uTurns, uSeed, uStr; varying vec2 vQ; varying float vSt;
      void main() { float s = aH.x, th = s * uTurns * 6.2832 + aH.z * 6.2832 / uStr + uSeed, r = uR * (1.0 - 0.38 * s * s);
        vec3 p = vec3(cos(th) * r, s * uH + aH.y * uW * 0.5 * (1.0 - 0.5 * s), sin(th) * r); vQ = vec2(s, aH.y); vSt = aH.z;
        gl_Position = aH.z < uStr ? projectionMatrix * modelViewMatrix * vec4(p, 1.0) : vec4(2.0, 2.0, 2.0, 1.0); }`,
    fragmentShader: /* glsl */ `uniform float uHead, uLen, uAlpha, uTime, uSeed; uniform vec3 uA, uB; varying vec2 vQ; varying float vSt; ${NOISE}
      void main() { float s = vQ.x, h = uHead - vSt * 0.06, k = (s - (h - uLen)) / uLen; if (k < 0.0 || s > h) discard;
        float across = 1.0 - abs(vQ.y); float body = pow(k, 1.6) * smoothstep(0.0, 0.25, across) * (0.55 + 0.45 * across);
        float flow = 0.7 + 0.3 * vn(vec2(s * 14.0 - uTime * 6.0 + uSeed, vQ.y * 2.0 + vSt * 3.0));
        float a = body * flow * smoothstep(1.0, 0.82, s) * uAlpha; if (a < 0.004) discard;
        vec3 c = mix(uB, uA, k); c = mix(c, vec3(1.0), pow(k, 6.0) * across * 0.55);      // 头上发白
        gl_FragColor = vec4(c * a, a * 0.6);
        #include <colorspace_fragment>
      }` });
  const m = new THREE.Mesh(helixGeometry(), mat); m.frustumCulled = false; m.renderOrder = 9; return { m, u };
});
/** 一次往上旋的光带：(x, y, z) 是脚底，h 旋多高，r 圈多大，life 走完要多久 */
export function helix(c: Ctx, o: { x: number; y: number; z: number; h: number; r: number; life?: number; color: number; color2?: number; turns?: number; strands?: number; width?: number; alpha?: number; follow?: () => { x: number; y: number; z: number } | null }) {
  const R = HELIX.get(c.fx), u = R.u, life = o.life ?? 0.6;
  R.m.position.set(o.x, o.y, o.z); u.uR.value = o.r; u.uH.value = o.h; u.uW.value = o.width ?? 0.24; u.uTurns.value = o.turns ?? 1.4; u.uStr.value = o.strands ?? 2; u.uSeed.value = Math.random() * 6.28; u.uAlpha.value = o.alpha ?? 1; u.uLen.value = 0.55;
  u.uA.value.set(o.color); u.uB.value.set(o.color2 ?? o.color);
  c.api.run(life, k => { const e = 1 - (1 - k) * (1 - k); u.uHead.value = e * 1.55; u.uAlpha.value = (o.alpha ?? 1) * (1 - sat((k - 0.7) / 0.3)); const p = o.follow?.(); if (p) R.m.position.set(p.x, p.y, p.z); }, () => HELIX.put(c.fx, R));
}

// ---------------------------------------------------------------- 往上飘的十字（治疗）
// 王者荣耀、很多手游的治疗都会飘几个绿色的“十”字，玩家一眼就认得是加血。正对镜头的一块片，片上画一个带柔光的十字
let plusGeo: THREE.PlaneGeometry | null = null;
const PLUS = pool(() => {
  const u = { uSize: { value: 0.5 }, uAlpha: { value: 1 }, uA: col(0xffffff), uB: col(0xffffff) };
  const mat = new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false, depthTest: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    vertexShader: `uniform float uSize; varying vec2 vQ; void main(){ vQ = position.xy * 2.0; vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0); mv.xy += position.xy * uSize; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `uniform float uAlpha; uniform vec3 uA, uB; varying vec2 vQ;
      void main() { vec2 q = abs(vQ); float bar = min(max(q.x / 0.17, q.y / 0.62), max(q.x / 0.62, q.y / 0.17));      // 十字：两根圆头的短棒
        float body = 1.0 - smoothstep(0.85, 1.0, bar), core = 1.0 - smoothstep(0.35, 0.6, bar), glow = exp(-bar * bar * 0.9) * 0.45;
        float a = clamp(body * 0.9 + glow, 0.0, 1.0) * uAlpha; if (a < 0.004) discard;
        vec3 c = mix(uB, uA, core); gl_FragColor = vec4(c * a, a * 0.75);
        #include <colorspace_fragment>
      }` });
  const m = new THREE.Mesh(plusGeo ??= new THREE.PlaneGeometry(1, 1), mat); m.frustumCulled = false; m.renderOrder = 11; return { m, u };
});
/** 一个十字从 (x, y, z) 往上飘 rise 米，life 秒里先弹出来、再淡掉 */
export function plus(c: Ctx, o: { x: number; y: number; z: number; size?: number; rise?: number; life?: number; color: number; color2: number; alpha?: number; follow?: () => { x: number; z: number } | null }) {
  const R = PLUS.get(c.fx), u = R.u, life = o.life ?? 0.75, S = o.size ?? 0.45; let ox = 0, oz = 0, base: { x: number; z: number } | null = null;      // 跟着人走：只加上人挪动的那一段
  u.uA.value.set(o.color); u.uB.value.set(o.color2);
  c.api.run(life, k => { const p = o.follow?.(); if (p) { base ??= { x: p.x, z: p.z }; ox = p.x - base.x; oz = p.z - base.z; } const pop = k < 0.18 ? 1 + 0.35 * Math.sin((k / 0.18) * Math.PI) : 1; u.uSize.value = S * sat(k / 0.1) * pop; u.uAlpha.value = (o.alpha ?? 1) * (1 - sat((k - 0.55) / 0.45));
    R.m.position.set(o.x + ox, o.y + (o.rise ?? 0.9) * (1 - (1 - k) * (1 - k)), o.z + oz); }, () => PLUS.put(c.fx, R));
}

// ---------------------------------------------------------------- 火球（烛焰、千烛祷的爆燃）
let ballGeo: THREE.BufferGeometry | null = null;
const FIREBALL = pool(() => {
  const u = { uTime: TIME, uK: { value: 0 }, uSeed: { value: 0 }, uAlpha: { value: 1 }, uCore: col(0xfff1c9), uMid: col(0xffb347), uEdge: col(0xff6a1e), uSoot: col(0x2a1a12) };
  const mat = new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,      // 一半叠加一半遮挡（和烛火一样）：亮的地上也不会被冲成白的
    vertexShader: /* glsl */ `uniform float uTime, uSeed, uK; varying vec3 vN, vV, vO; ${NOISE}
      void main() { vO = position; float n = fbm(vec2(position.x * 1.7 + position.z * 1.1 + uSeed, position.y * 1.7 - uTime * 2.2));
        vec3 p = position * (1.0 + (n - 0.5) * 0.42 * (0.4 + uK)) + vec3(0.0, uK * uK * 0.35 * (position.y + 1.0), 0.0);      // 表面一鼓一鼓的，后半段往上飘
        vec4 mv = modelViewMatrix * vec4(p, 1.0); vN = normalMatrix * normal; vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `uniform float uTime, uK, uSeed, uAlpha; uniform vec3 uCore, uMid, uEdge, uSoot; varying vec3 vN, vV, vO; ${NOISE}
      void main() { float f = abs(dot(normalize(vN), normalize(vV)));
        float n = fbm(vec2(vO.x * 2.3 + vO.z * 1.6 + uSeed, vO.y * 2.3 - uTime * 3.0)) * 0.7 + vn(vec2(vO.x * 6.0 - vO.z * 4.0, vO.y * 6.0 + uSeed)) * 0.3;
        float thr = uK * 1.15 - 0.12 + (1.0 - f) * 0.25 * uK;                 // 烧穿：阈值随时间往上走，轮廓处先穿
        float d = n - thr; if (d < 0.0) discard;
        float burn = 1.0 - smoothstep(0.0, 0.1, d);                            // 烧穿的边：一圈亮橙
        float hot = smoothstep(0.45, 0.85, n * 0.7 + f * 0.45);                       // 一团一团的：亮的火团和暗一点的橙交错，不是一整块均匀的黄
        vec3 c = mix(uEdge * 0.85, uMid, hot); c = mix(c, uCore, smoothstep(0.86, 1.0, f) * smoothstep(0.55, 0.8, n) * (1.0 - smoothstep(0.05, 0.35, uK)));      // 火心只在正中、只在最开始，不然整团发白
        c = mix(c, uSoot, smoothstep(0.45, 0.95, uK) * (1.0 - burn) * 0.85); c = mix(c, uEdge * 1.25, burn * smoothstep(0.05, 0.3, uK));
        float a = smoothstep(0.0, 0.45, f) * (0.85 - 0.25 * uK) * uAlpha; if (a < 0.004) discard;
        gl_FragColor = vec4(c * a * 0.85, a * mix(0.55, 0.85, smoothstep(0.4, 0.9, uK)));      // 越到后面越“实”（烟）、越不发光
        #include <colorspace_fragment>
      }` });
  const m = new THREE.Mesh(ballGeo ??= new THREE.IcosahedronGeometry(1, 4), mat); m.frustumCulled = false; m.renderOrder = 9; return { m, u };
});
/** 一团火球在 pos 胀开到半径 r，life 秒里被烧穿、变成烟往上飘 */
export function fireball(c: Ctx, pos: { x: number; y: number; z: number }, r: number, life = 0.45) {
  const R = FIREBALL.get(c.fx), u = R.u; u.uSeed.value = Math.random() * 30; u.uK.value = 0; u.uAlpha.value = 1; R.m.position.set(pos.x, pos.y, pos.z); R.m.rotation.y = Math.random() * 6.28;
  c.api.run(life, k => { const g = 1 - Math.pow(1 - sat(k / 0.35), 3); R.m.scale.setScalar(r * (0.25 + 0.75 * g + 0.12 * k)); u.uK.value = Math.pow(k, 0.85); }, () => FIREBALL.put(c.fx, R));
}

// ---------------------------------------------------------------- 有厚度的冲击环
let quadGeo: THREE.PlaneGeometry | null = null;
const RINGS = [false, true].map(add => pool(() => {
  const u = { uTime: TIME, uC: { value: 0.7 }, uW: { value: 0.12 }, uAlpha: { value: 1 }, uSeed: { value: 0 }, uA: col(0xffffff), uB: col(0xffffff) };
  const mat = new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false, ...(add ? glowBlend() : { blending: THREE.NormalBlending }), polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    vertexShader: `varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `uniform float uC, uW, uAlpha, uSeed, uTime; uniform vec3 uA, uB; varying vec2 vP; ${NOISE} ${add && FXB.on ? BOUT : ""}
      void main() { float r = length(vP), th = atan(vP.y, vP.x), n = vn(vec2(th * 6.0 + uSeed, r * 4.0 - uTime)) * 0.6 + vn(vec2(th * 19.0 - uSeed, r * 9.0)) * 0.4;
        float e = r + (n - 0.5) * uW * 0.35, x = (uC - e) / uW;                // x：从外沿往里走了几成厚度
        float a = smoothstep(-0.06, 0.0, x) * (1.0 - smoothstep(0.0, 1.0, x)) * (0.55 + 0.45 * smoothstep(0.25, 0.7, n));
        float lead = 1.0 - smoothstep(0.0, 0.22, x);
        vec3 c = mix(uB, uA, lead); a = (a * 0.75 + lead * a * 0.5) * uAlpha${!add && FXB.on ? " * 1.4" : ""}; if (a < 0.004) discard;      // 换画风 B：水的环（普通混合）厚一些
        ${add && FXB.on ? "gl_FragColor = bOut_(c, a);" : `gl_FragColor = vec4(c ${add ? "* a, a" : ", a"});
        #include <colorspace_fragment>`}
      }` });
  const m = new THREE.Mesh(quadGeo ??= (() => { const g = new THREE.PlaneGeometry(2, 2); g.rotateX(-Math.PI / 2); return g; })(), mat); m.frustumCulled = false; m.renderOrder = 6; return { m, u };
}));
/** 贴地的一圈环从 r0 推到 r，life 秒；width 是厚度（米）；add 叠加发光（火），不加是普通半透明（水、烟） */
export function thickRing(c: Ctx, o: { x: number; z: number; r: number; r0?: number; width?: number; life?: number; color: number; color2?: number; alpha?: number; add?: boolean; y?: number }) {
  const P = RINGS[o.add ? 1 : 0], R = P.get(c.fx), u = R.u, life = o.life ?? 0.35, W = o.width ?? o.r * 0.22, M = o.r + W;
  R.m.position.set(o.x, (o.y ?? c.fx.ground(o.x, o.z)) + 0.1, o.z); R.m.scale.setScalar(M); u.uA.value.set(o.color); u.uB.value.set(o.color2 ?? o.color); u.uSeed.value = Math.random() * 40;
  c.api.run(life, k => { const g = 1 - Math.pow(1 - k, 2.6), rr = (o.r0 ?? o.r * 0.15) + (o.r - (o.r0 ?? o.r * 0.15)) * g; u.uC.value = rr / M; u.uW.value = Math.min(rr, W * (0.5 + 0.5 * g)) / M; u.uAlpha.value = (o.alpha ?? 1) * (1 - Math.pow(sat((k - 0.35) / 0.65), 1.4)); }, () => P.put(c.fx, R));
}

// ---------------------------------------------------------------- 范围边上的一圈矮墙（烟墙、白沫水墙）
const WN = 72;
type WallRec = { m: THREE.Mesh; g: THREE.BufferGeometry; P: Float32Array; u: { uTime: typeof TIME; uAlpha: { value: number }; uSeed: { value: number }; uA: { value: THREE.Color }; uB: { value: THREE.Color } } };
const WALLS: Record<"smoke" | "foam", WallRec[]> = { smoke: [], foam: [] };      // 池子：用完的墙留着几何体和材质，下次改颜色、位置接着用
function makeWall(kind: "smoke" | "foam"): WallRec {
  const P = new Float32Array((WN + 1) * 2 * 3), UV: number[] = [], I: number[] = [];
  for (let i = 0; i <= WN; i++) { UV.push(i / WN, 0, i / WN, 1); if (i < WN) { const k = i * 2; I.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); } }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(P, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(UV, 2)); g.setIndex(I);
  const smoke = kind === "smoke", u = { uTime: TIME, uAlpha: { value: 0 }, uSeed: { value: 0 }, uA: col(0xffffff), uB: col(0xffffff) };
  const mat = new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `uniform float uTime, uAlpha, uSeed; uniform vec3 uA, uB; varying vec2 vUv; ${NOISE}
      void main() { float x = vUv.x * ${smoke ? "22.0" : "34.0"}, y = vUv.y;
        float n = fbm(vec2(x + uSeed, y * ${smoke ? "1.6" : "2.2"} - uTime * ${smoke ? "0.55" : "1.3"})), m = vn(vec2(x * 2.3 - uSeed, y * 3.0 - uTime * ${smoke ? "0.9" : "2.4"}));
        float body = smoothstep(${smoke ? "0.24, 0.62" : "0.42, 0.8"}, n * 0.75 + m * 0.25 + (1.0 - y) * ${smoke ? "0.42" : "0.5"} - y * 0.15);
        float a = body * pow(1.0 - y, ${smoke ? "1.1" : "1.6"}) * smoothstep(0.0, 0.06, y) * uAlpha * ${smoke ? "0.82" : "0.9"}; if (a < 0.004) discard;
        vec3 c = mix(uB, uA, smoothstep(0.35, 0.85, n + (1.0 - y) * 0.2));
        gl_FragColor = vec4(c, a);
        #include <colorspace_fragment>
      }` });
  const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.renderOrder = 7; return { m, g, P, u };
}
/** 一圈矮墙：kind "smoke" 是往上翻的烟（普通半透明，暗），"foam" 是翻起来的白沫水。set(r, h, alpha) 每帧调；底边贴着地形 */
export function wall(c: Ctx, x: number, z: number, kind: "smoke" | "foam", colorA: number, colorB: number) {
  const R = WALLS[kind].pop() ?? makeWall(kind), { u, P, g } = R; let lastR = -1, lastH = -1, live = true;
  u.uA.value.set(colorA); u.uB.value.set(colorB); u.uAlpha.value = 0; u.uSeed.value = Math.random() * 30; R.m.onBeforeRender = () => { TIME.value = c.fx.time(); }; c.fx.group.add(R.m);
  return { u,
    set(r: number, h: number, alpha: number) { u.uAlpha.value = alpha; if (Math.abs(r - lastR) < 0.03 && h === lastH) return; lastR = r; lastH = h;
      for (let i = 0; i <= WN; i++) { const a = (i / WN) * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r, gy = c.fx.ground(px, pz) - 0.05, o = i * 6; P[o] = px; P[o + 1] = gy; P[o + 2] = pz; P[o + 3] = px; P[o + 4] = gy + h; P[o + 5] = pz; }
      g.attributes.position.needsUpdate = true; },
    kill() { if (!live) return; live = false; c.fx.group.remove(R.m); WALLS[kind].push(R); } };
}

// ---------------------------------------------------------------- 一缕往上飘的细烟（掐灭的烛芯）
let wispGeo: THREE.PlaneGeometry | null = null;
const WISP = pool(() => {
  const u = { uTime: TIME, uH: { value: 1.6 }, uW: { value: 0.1 }, uAlpha: { value: 1 }, uSeed: { value: 0 }, uA: col(0xffffff), uB: col(0xffffff) };
  const mat = new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: /* glsl */ `uniform float uTime, uH, uW, uSeed; varying vec2 vUv;
      void main() { vUv = uv; float y = uv.y, t = uTime;
        vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]); right.y = 0.0; right = normalize(right);      // 只绕竖轴转向镜头
        vec3 side = normalize(cross(right, vec3(0.0, 1.0, 0.0)));
        float sw = sin(y * 5.5 - t * 2.1 + uSeed) * 0.16 * y + sin(y * 12.0 - t * 3.7 + uSeed * 2.0) * 0.05 * y * y;      // 越往上摆得越大
        float sd = cos(y * 4.3 - t * 1.7 + uSeed) * 0.12 * y;
        vec4 o = modelMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vec3 w = o.xyz + right * (position.x * uW * (1.0 + 2.2 * y) + sw) + side * sd + vec3(0.0, y * uH, 0.0);
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0); }`,
    fragmentShader: /* glsl */ `uniform float uTime, uAlpha, uSeed; uniform vec3 uA, uB; varying vec2 vUv; ${NOISE}
      void main() { float x = abs(vUv.x - 0.5) * 2.0, y = vUv.y;
        float core = exp(-x * x * 5.0), brk = smoothstep(0.25, 0.65, vn(vec2(y * 7.0 - uTime * 1.6 + uSeed, 1.3)) + (1.0 - y) * 0.45);      // 往上越来越断
        float a = core * brk * smoothstep(0.0, 0.08, y) * pow(1.0 - y, 1.3) * uAlpha; if (a < 0.004) discard;
        gl_FragColor = vec4(mix(uB, uA, y), a);
        #include <colorspace_fragment>
      }` });
  const m = new THREE.Mesh(wispGeo ??= (() => { const g = new THREE.PlaneGeometry(1, 1, 1, 28); g.translate(0, 0.5, 0); return g; })(), mat); m.frustumCulled = false; m.renderOrder = 8; return { m, u };
});
/** 一缕细烟从 (x, y, z) 往上飘 h 米，life 秒（前 0.3 秒长出来，最后 0.6 秒散掉） */
export function wisp(c: Ctx, o: { x: number; y: number; z: number; h?: number; life: number; color: number; color2: number; alpha?: number; width?: number }) {
  const R = WISP.get(c.fx), u = R.u; R.m.position.set(o.x, o.y, o.z); u.uH.value = o.h ?? 1.6; u.uW.value = o.width ?? 0.07; u.uSeed.value = Math.random() * 30; u.uA.value.set(o.color); u.uB.value.set(o.color2);
  c.api.run(o.life, (k, _dt) => { const t = k * o.life; u.uAlpha.value = (o.alpha ?? 0.7) * sat(t / 0.3) * sat((o.life - t) / 0.6); }, () => WISP.put(c.fx, R));
}

// ---------------------------------------------------------------- 凝固的蜡（蜡刺、裹住脚的蜡壳）
// 实体：普通的受光材质，骨白，背光处偏暖（蜡透光），表面一点点光泽。几何体里直接做出不齐的口和往下流的蜡泪
let waxMat: THREE.MeshStandardMaterial | null = null, spikeGeo: THREE.BufferGeometry | null = null, caseGeo: THREE.BufferGeometry | null = null;
const hash = (i: number) => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
export function waxMaterial() {
  return waxMat ??= new THREE.MeshStandardMaterial({ color: 0xf0e4c8, roughness: 0.36, metalness: 0, emissive: 0x9a6a38, emissiveIntensity: 0.42, side: THREE.DoubleSide });      // 自发光暖一点：蜡透光，背光的一面也不该是灰的      // 两面都画：蜡壳的口是敞着的，从上往下看得到里面
}
/** 一根蜡刺：上尖下粗的一滴，几道往下流的棱 */
export function spikeGeometry() {
  if (spikeGeo) return spikeGeo;
  const prof: [number, number][] = [[0, 0], [0.36, 0], [0.4, 0.07], [0.33, 0.24], [0.24, 0.46], [0.15, 0.7], [0.07, 0.9], [0, 1]];
  const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 14), p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x), k = 1 + 0.16 * Math.sin(a * 5 + 1.3) * (1 - y) + 0.08 * Math.sin(a * 11) * (1 - y); p.setX(i, x * k); p.setZ(i, z * k); }
  g.computeVertexNormals(); return (spikeGeo = g);
}
/** 裹住脚的一截蜡壳：底下鼓、往上收，口是不齐的，外面挂着几道往下流的蜡泪 */
export function caseGeometry() {
  if (caseGeo) return caseGeo;
  const prof: [number, number][] = [[0.0, 0.0], [1.08, 0.0], [1.14, 0.08], [1.06, 0.26], [0.97, 0.5], [0.92, 0.74], [0.9, 0.9], [0.84, 0.98], [0.76, 1.0], [0.7, 0.96]];
  const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 28, 0, Math.PI * 2), p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x);
    const lip = 0.16 * Math.sin(a * 3 + 0.7) + 0.1 * Math.sin(a * 7 + 2.1), drip = Math.max(0, Math.sin(a * 6 + 0.4)) ** 6 * 0.12 + Math.max(0, Math.sin(a * 9 + 2.6)) ** 8 * 0.08;      // 口不齐；几道蜡泪鼓出来
    p.setY(i, y >= 0.9 ? y * (1 + lip * 0.6) : y); const k = 1 + drip * (0.3 + y); p.setX(i, x * k); p.setZ(i, z * k); }
  g.computeVertexNormals(); return (caseGeo = g);
}
export const waxSeed = hash;

/** 手机档少画的东西用这个开关 */
export const FX2_LITE = LITE;

let candleGeo: THREE.BufferGeometry | null = null;
/** 一截蜡烛（熄灯里掐灭的那几根）：高 1 米（用 scale.y 调），口不齐、挂几道蜡泪 */
export function candleGeometry() {
  if (candleGeo) return candleGeo;
  const prof: [number, number][] = [[0, 0], [0.16, 0], [0.16, 0.04], [0.135, 0.12], [0.125, 0.86], [0.13, 0.95], [0.1, 1.0], [0.03, 0.96], [0, 0.96]];
  const g = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 12), p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x), k = 1 + Math.max(0, Math.sin(a * 3 + 0.5)) ** 8 * 0.35 * (0.3 + y); p.setX(i, x * k); p.setZ(i, z * k); if (y > 0.9) p.setY(i, y + 0.05 * Math.sin(a * 2 + 1)); }
  g.computeVertexNormals(); return (candleGeo = g);
}

let warmed = false;
/** 第一次用之前先把这些零件的着色器编好：英雄的 passive 第一帧调一次，各放一个看不见的（地底下、透明），免得第一次放技能时卡一下 */
export function warm2b(c: Ctx) {
  if (warmed) return; warmed = true;
  const y = -40, o = { x: 0, y, z: 0 };
  helix(c, { ...o, h: 0.01, r: 0.01, life: 0.1, color: 0, alpha: 0 }); plus(c, { ...o, life: 0.1, color: 0, color2: 0, alpha: 0 }); fireball(c, o, 0.01, 0.1); wisp(c, { ...o, life: 0.1, color: 0, color2: 0, alpha: 0 });
  for (const add of [false, true]) thickRing(c, { x: 0, z: 0, y, r: 0.01, life: 0.1, color: 0, alpha: 0, add });
  for (const k of ["smoke", "foam"] as const) { const w = wall(c, 0, 0, k, 0, 0); w.set(0.01, 0.01, 0); c.api.after(0.1, () => w.kill()); }
  for (const g of [spikeGeometry(), caseGeometry(), candleGeometry()]) { const m = new THREE.Mesh(g, waxMaterial()); m.position.set(0, y, 0); m.frustumCulled = false; c.fx.group.add(m); c.api.after(0.1, () => c.fx.group.remove(m)); }
}
