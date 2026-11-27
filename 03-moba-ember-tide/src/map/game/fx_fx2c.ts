// 第九轮 fx2c：葛隆、薇萝（烬誓庭）的技能特效用到的新零件。
//
// 为什么要自己写：烬誓庭的火要像锻炉里的火——橙到暗红、带火星和黑烟。特效库的粒子要么是叠加发光（再多也只是一团橙光，
// 背景越亮越糊成白），要么是普通半透明（没有“烫”的感觉），而且一颗粒子从生到死是同一种东西。真的火是一团东西从白热烧成橙、
// 再暗成红、最后变成往上飘的黑烟。这里的零件都按这个来：
//   puff / puffer   火团和烟（一颗粒子自己从热到冷：白芯 → 橙 → 暗红 → 黑烟；也可以生下来就是烟或土）。
//                   用“预乘透明”混合：烫的地方接近叠加发光，凉下来的暗红和烟会真的挡住后面的东西，火有了实体。
//   tracer          两点之间一道正对镜头的弹道光：中间一道白热的芯，外面一层橙，两边垫一层暗的（和亮的地面拉开反差），头上最亮、尾巴收掉（弩矢、火线）。
//   wall            一圈立着的冲击：一道有高度的环往外推、越推越矮（砸地、开闸、炸开）。可以是土墙，也可以是火墙；arc 给了就只朝一边。
//   fence           一圈一直在烧的矮火墙，墙根烧黑（大招、火场的范围边）。
//   strip           贴地的一条：焦黑的底、中间一道断断续续烧红的线，慢慢凉下去（穿甲矢的弹道、犁痕、熔岩缝）。跟着地形起伏。
//   reticle         脚下的瞄准记号：四段断开的弧、四个往里指的刻度，慢慢转（易伤）。
//   sheet           （第九轮 polish-old）贴地漫开的一层火：一道烧得最旺的前沿从里往外推（整圈或者一个扇形），身后烧成暗红、焦黑，
//                   再一块块蚀掉。原来“炸开”“喷火”是几十团火球堆出来的，叠在一起只剩一团橙光；这一层给了它形状（圆、扇形），火球只做点缀。
//   flameBed        （第九轮 polish-old）一片立在地上的小火苗（一张张正对镜头的火舌片，一次画完）：边上密、里面稀，此起彼伏。
//                   持续的火场原来读成一团（地上一张橙色的饼 + 飘着的火球），看不出边在哪、也不像“地在烧”；这一片火苗就是范围的边。
//   warm            上面这些的着色器预热（英雄的 passive 第一帧调一次）。
// 规矩和特效库一样：材质、几何体都只建一次或进池子；手机档（LITE）粒子减半。这几样都可以搬进 fxlib（报告里说了）。

import * as THREE from "three";
import { LITE } from "../quality";
import type { FxLib, V3 } from "./fxlib";
import { BOUT, FXB, glowBlend, glowOut, smokeB } from "./fxb";

type Rng = number | [number, number];
const rnd = (r: Rng) => (typeof r === "number" ? r : r[0] + Math.random() * (r[1] - r[0]));
const TAU = Math.PI * 2;

// ---------------------------------------------------------------- 一张能平铺的噪声图（火、烟、墙的着色器都从这里取，不在片元里现算 fbm）
let noise: THREE.DataTexture | null = null;
function noiseTex(): THREE.DataTexture {
  if (noise) return noise;
  const N = 128, d = new Uint8Array(N * N * 4);
  const hash = (x: number, y: number, s: number) => { let h = (x * 374761393 + y * 668265263 + s * 1442695041) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };
  const vn = (x: number, y: number, P: number, s: number) => { const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), m = (a: number) => ((a % P) + P) % P;
    const a = hash(m(xi), m(yi), s), b = hash(m(xi + 1), m(yi), s), c = hash(m(xi), m(yi + 1), s), e = hash(m(xi + 1), m(yi + 1), s); return a + (b - a) * u + (c - a) * v + (a - b - c + e) * u * v; };
  const fbm = (x: number, y: number, P: number, s: number, o: number) => { let a = 0.5, t = 0, n = 0; for (let i = 0; i < o; i++) { t += a * vn(x * (P << i) / N, y * (P << i) / N, P << i, s + i * 7); n += a; a *= 0.5; } return t / n; };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const k = (y * N + x) * 4;
    d[k] = Math.round(fbm(x, y, 4, 1, 4) * 255); d[k + 1] = Math.round(fbm(x, y, 8, 5, 3) * 255); d[k + 2] = Math.round(fbm(x, y, 16, 9, 2) * 255); d[k + 3] = 255; }
  noise = new THREE.DataTexture(d, N, N, THREE.RGBAFormat); noise.wrapS = noise.wrapT = THREE.RepeatWrapping; noise.magFilter = THREE.LinearFilter; noise.minFilter = THREE.LinearMipmapLinearFilter; noise.generateMipmaps = true; noise.needsUpdate = true;
  return noise;
}

/** 火的颜色（sRGB 写的，传进着色器前换成线性）：白热、亮橙、炉火橙、暗红、快熄的炭 */
const RAMP = [0xfff0c8, 0xffb24a, 0xff7a26, 0x983a12, 0x2e120a];
const ramp = () => RAMP.map(h => new THREE.Color(h));
/** 火的颜色梯度（GLSL）：h 从 0（凉）到 1（白热） */
const RAMP_GLSL = /* glsl */ `
  uniform vec3 uR0, uR1, uR2, uR3, uR4;
  vec3 fireCol(float h){ vec3 c = mix(uR4, uR3, smoothstep(0.06, 0.3, h)); c = mix(c, uR2, smoothstep(0.3, 0.55, h)); c = mix(c, uR1, smoothstep(0.55, 0.78, h)); return mix(c, uR0, smoothstep(0.8, 1.0, h)); }`;
const rampUniforms = () => { const r = ramp(); return { uR0: { value: r[0] }, uR1: { value: r[1] }, uR2: { value: r[2] }, uR3: { value: r[3] }, uR4: { value: r[4] } }; };
/** 预乘透明的混合：rgb 已经乘过不透明度；a 是挡住后面多少。烫的火 a 很小（接近叠加发光），烟和暗红的火 a 大（真的挡住） */
const premul = { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor } as const;

// ---------------------------------------------------------------- 火团和烟
export interface PuffOpts {
  pos: V3; n?: number;
  dir?: V3; spread?: number; speed?: Rng; up?: number;          // 往哪喷、张角（弧度）、速度；up 再加一个往上的初速度
  radius?: number; ringR?: number; disc?: number;                // 出生在一个球里 / 水平一圈上 / 水平一个圆盘里
  size?: Rng; grow?: number; life?: Rng; drag?: number;          // grow：结束时是开始的几倍（先快后慢地长）
  rise?: number;                                                 // 浮力（米/秒²，往上）；负的就是往下掉
  heat?: Rng; cool?: number;                                     // 生下来有多烫（0 就是纯烟、纯土；1 白热）；cool：活到几成时凉透
  smoke?: number; opacity?: Rng;                                 // 凉下来以后是什么颜色的烟、烟最浓多少
  shape?: "ball" | "tongue" | "streak"; stretch?: number; spin?: number;      // tongue：一条往上窜的火舌（底宽顶尖）；streak：顺着速度拉长
}
interface Sys { A: Record<string, THREE.InstancedBufferAttribute>; i: number; cap: number; ems: { o: PuffOpts & { rate: number }; acc: number; live: boolean }[]; last: number; }
const systems = new WeakMap<FxLib, Sys>();
const C1 = new THREE.Color(), DV = new THREE.Vector3(), AX = new THREE.Vector3(), AY = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);

function sys(fx: FxLib): Sys {
  let S = systems.get(fx); if (S) return S;
  const cap = LITE ? 700 : 1400, g = new THREE.InstancedBufferGeometry(), q = new THREE.PlaneGeometry(1, 1); g.index = q.index; g.setAttribute("position", q.getAttribute("position")); g.setAttribute("uv", q.getAttribute("uv"));
  const mk = (n: number) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * n), n); a.setUsage(THREE.DynamicDrawUsage); return a; };
  const A = { aP: mk(3), aV: mk(3), aT: mk(4), aS: mk(4), aM: mk(4), aC: mk(4) }; for (const [k, a] of Object.entries(A)) g.setAttribute(k, a); g.instanceCount = cap;
  for (let i = 0; i < cap; i++) A.aT.setXYZW(i, -999, 1, 0, 0);      // 一开始全是死的
  const u = { uTime: { value: 0 }, uN: { value: noiseTex() }, ...rampUniforms() };
  const mat = new THREE.ShaderMaterial({ ...premul, transparent: true, depthWrite: false, uniforms: u,
    vertexShader: /* glsl */ `
      attribute vec3 aP, aV; attribute vec4 aT, aS, aM, aC; uniform float uTime;
      varying vec2 vUv; varying float vK, vSeed, vShape; varying vec3 vH; varying vec4 vC;
      void main() {
        float age = uTime - aT.x, k = age / aT.y;
        if (k < 0.0 || k >= 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        float dr = aM.x; vec3 vel = aV * exp(-dr * age); vel.y += aM.y * age;
        vec3 p = aP + (dr > 0.001 ? aV * (1.0 - exp(-dr * age)) / dr : aV * age); p.y += 0.5 * aM.y * age * age;
        float sz = aS.x * mix(1.0, aS.y, 1.0 - pow(1.0 - k, 2.2)), shape = aT.w;
        vec4 mv = modelViewMatrix * vec4(p, 1.0); vec2 q = position.xy;
        if (shape > 1.5) {                       // 顺着速度拉长
          vec3 vv = (modelViewMatrix * vec4(vel, 0.0)).xyz; float sp = length(vv.xy); vec2 d = sp > 0.001 ? vv.xy / sp : vec2(1.0, 0.0);
          q = vec2(q.x * (1.0 + aS.w * length(vel) * 0.1), q.y); q = vec2(d.x * q.x - d.y * q.y, d.y * q.x + d.x * q.y);
        } else if (shape > 0.5) {                // 火舌：立着（画面上朝世界的上方），根在出生点，往上长
          vec3 up = (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz; vec2 d = normalize(up.xy + vec2(0.0, 1e-4));
          q = vec2(q.x * 1.1, (q.y + 0.5) * 1.45); q = vec2(d.y * q.x + d.x * q.y, -d.x * q.x + d.y * q.y);
        } else { float rot = aS.z + aS.w * age, cs = cos(rot), sn = sin(rot); q = vec2(cs * q.x - sn * q.y, sn * q.x + cs * q.y); }
        mv.xy += q * sz; gl_Position = projectionMatrix * mv;
        vUv = uv; vK = k; vSeed = aT.z; vShape = shape; vH = vec3(aM.z, aM.w, aC.w); vC = vec4(aC.rgb, 0.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uN; varying vec2 vUv; varying float vK, vSeed, vShape; varying vec3 vH; varying vec4 vC;
      ${RAMP_GLSL}
      void main() {
        vec2 p = vUv * 2.0 - 1.0; float k = vK; vec2 o = vec2(vSeed * 7.13, vSeed * 3.71);
        float n1 = texture2D(uN, vUv * 0.85 + o + vec2(0.0, -k * 0.35)).r, n2 = texture2D(uN, vUv * 1.9 + o * 1.3 + vec2(n1 * 0.35, -k * 0.8)).g, n = n1 * 0.55 + n2 * 0.45;
        float body;
        if (vShape > 0.5 && vShape < 1.5) { float t = vUv.y, w = 0.92 * pow(1.0 - t, 0.8) * smoothstep(0.0, 0.16, t) + 0.05, x = abs(p.x + (n - 0.5) * 1.0 * t);
          body = (1.0 - smoothstep(w * 0.3, w, x)) * smoothstep(0.0, 0.08, t); }
        else { float r = length(p); body = 1.0 - smoothstep(0.12, 1.0, r + (n - 0.5) * 1.15); }
        float er = mix(0.06, 0.58, pow(k, 1.4)), d = smoothstep(er, er + 0.34, body * (0.3 + 1.1 * n));      // 越老越往里蚀：一缕一缕地散，不是整团变淡（蚀得比凉得慢：火凉下去以后还剩一团烟）
        if (d < 0.004) discard;
        float ht = vH.x * (1.0 - pow(smoothstep(0.0, max(0.01, vH.y), k), 1.7)), h = clamp(ht * (0.15 + 1.05 * body * (0.25 + n)), 0.0, 1.0);      // 芯比边烫；只有芯能烫到发白。橙的时间长、暗红一下就过去变成烟
        float fire = smoothstep(0.05, 0.26, h);
        vec3 fc = fireCol(h) * (0.72 + 0.56 * n), sc = vC.rgb * (0.55 + 0.9 * n);      // 火里也有浓淡（不然暗红的时候是一整片平涂的红）
        float aS = d * vH.z * (1.0 - fire) * (1.0 - smoothstep(0.7, 1.0, k) * 0.6), aF = d * fire * mix(0.62, 0.15, smoothstep(0.45, 0.95, h));
        vec3 rgb = fc * d * fire * (0.6 + 0.8 * h) + sc * aS;
        gl_FragColor = vec4(rgb, aS + aF);
        #include <colorspace_fragment>
      }` });
  const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.renderOrder = 8.5; fx.group.add(m);
  S = { A, i: 0, cap, ems: [], last: fx.time() };
  const s = S;
  m.onBeforeRender = () => { const now = fx.time(), dt = Math.max(0, Math.min(0.1, now - s.last)); s.last = now; u.uTime.value = now;
    for (let i = s.ems.length - 1; i >= 0; i--) { const e = s.ems[i]; if (!e.live) { s.ems.splice(i, 1); continue; } e.acc += e.o.rate * dt * (LITE ? 0.5 : 1); const n = Math.floor(e.acc); if (n > 0) { e.acc -= n; emit(fx, s, e.o, n); } } };
  systems.set(fx, S); return S;
}
function emit(fx: FxLib, S: Sys, b: PuffOpts, n: number) {
  const A = S.A, now = fx.time(), spread = b.spread ?? Math.PI, shape = b.shape === "tongue" ? 1 : b.shape === "streak" ? 2 : 0;
  if (b.dir) DV.set(b.dir.x, b.dir.y, b.dir.z).normalize(); else DV.set(0, 1, 0);
  AX.crossVectors(DV, Math.abs(DV.y) > 0.9 ? AY.set(1, 0, 0) : UP).normalize(); AY.crossVectors(DV, AX);
  C1.set(b.smoke ?? 0x1d1917); if (FXB.on) smokeB(C1);      // 换画风 B：烟凉下来不是黑的（见 fxb.ts 的 smokeB）
  for (let j = 0; j < n; j++) {
    const k = S.i; S.i = (S.i + 1) % S.cap;
    const ct = 1 - Math.random() * (1 - Math.cos(spread)), st = Math.sqrt(Math.max(0, 1 - ct * ct)), ph = Math.random() * TAU, sp = rnd(b.speed ?? 1);
    let px = b.pos.x, py = b.pos.y, pz = b.pos.z;
    if (b.ringR) { const a = Math.random() * TAU; px += Math.cos(a) * b.ringR; pz += Math.sin(a) * b.ringR; }
    if (b.disc) { const a = Math.random() * TAU, r = b.disc * Math.sqrt(Math.random()); px += Math.cos(a) * r; pz += Math.sin(a) * r; }
    if (b.radius) { const a = Math.random() * TAU, u = Math.random() * 2 - 1, rr = b.radius * Math.cbrt(Math.random()), s2 = Math.sqrt(1 - u * u); px += Math.cos(a) * s2 * rr; py += u * rr; pz += Math.sin(a) * s2 * rr; }
    A.aP.setXYZ(k, px, py, pz);
    A.aV.setXYZ(k, (DV.x * ct + (AX.x * Math.cos(ph) + AY.x * Math.sin(ph)) * st) * sp, (DV.y * ct + (AX.y * Math.cos(ph) + AY.y * Math.sin(ph)) * st) * sp + (b.up ?? 0), (DV.z * ct + (AX.z * Math.cos(ph) + AY.z * Math.sin(ph)) * st) * sp);
    A.aT.setXYZW(k, now, rnd(b.life ?? 0.8), Math.random(), shape);
    A.aS.setXYZW(k, rnd(b.size ?? 0.8), b.grow ?? 2, Math.random() * TAU, shape === 2 ? b.stretch ?? 1 : (Math.random() - 0.5) * 2 * (b.spin ?? 0.6));
    A.aM.setXYZW(k, b.drag ?? 1.5, b.rise ?? 1.2, rnd(b.heat ?? 1), b.cool ?? 0.5);
    A.aC.setXYZW(k, C1.r, C1.g, C1.b, rnd(b.opacity ?? 0.7) * (FXB.on ? 0.82 : 1));
  }
  for (const a of Object.values(A)) a.needsUpdate = true;
}
/** 一把火团或烟（一次） */
export function puff(fx: FxLib, o: PuffOpts) { const S = sys(fx), n0 = o.n ?? 6, n = LITE && n0 > 1 ? Math.ceil(n0 * 0.5) : n0; emit(fx, S, o, n); }
/** 挂在一个会动的点上一直冒（每秒 rate 颗），at 挪位置，stop 停 */
export function puffer(fx: FxLib, o: PuffOpts & { rate: number }): { at: (x: number, y: number, z: number) => void; stop: () => void; rate: (r: number) => void; aim: (x: number, y: number, z: number) => void } {
  const S = sys(fx), pos = { ...o.pos }, dir = { ...(o.dir ?? { x: 0, y: 1, z: 0 }) }, rec = { o: { ...o, pos, dir: o.dir ? dir : undefined }, acc: 0, live: true }; S.ems.push(rec);
  return { at(x, y, z) { pos.x = x; pos.y = y; pos.z = z; }, stop() { rec.live = false; }, rate(r) { rec.o.rate = r; }, aim(x, y, z) { dir.x = x; dir.y = y; dir.z = z; rec.o.dir = dir; } };
}

// ---------------------------------------------------------------- 弹道光
export interface Tracer { set: (tail: V3, head: V3) => void; alpha: (a: number) => void; free: () => void; }
let tracerGeo: THREE.BufferGeometry | null = null; const tracerPool: THREE.Mesh[] = [];
/** 两点之间一道正对镜头的光：width 是外层的宽（米），core 白芯占几成；taper 尾巴收得多快；hot 头上那一截多亮 */
export function tracer(fx: FxLib, o: { width: number; core?: number; color?: number; color2?: number; taper?: number; hot?: number }): Tracer {
  if (!tracerGeo) { const P: number[] = [], U: number[] = [], I: number[] = [], S = 12; for (let i = 0; i <= S; i++) { const t = i / S; P.push(-1, t, 0, 1, t, 0); U.push(0, t, 1, t); if (i < S) { const k = i * 2; I.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); } }
    tracerGeo = new THREE.BufferGeometry(); tracerGeo.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); tracerGeo.setAttribute("uv", new THREE.Float32BufferAttribute(U, 2)); tracerGeo.setIndex(I); }
  let m = tracerPool.pop();
  if (!m) { m = new THREE.Mesh(tracerGeo, new THREE.ShaderMaterial({ ...premul, transparent: true, depthWrite: false, side: THREE.DoubleSide,      // 预乘透明：亮的芯接近叠加发光，两边一圈压暗（见下）
      uniforms: { uA: { value: new THREE.Vector3() }, uB: { value: new THREE.Vector3() }, uW: { value: 0.3 }, uCore: { value: 0.3 }, uC1: { value: new THREE.Color() }, uC2: { value: new THREE.Color() }, uAlpha: { value: 1 }, uTaper: { value: 1.4 }, uHot: { value: 1 }, uN: { value: noiseTex() }, uSeed: { value: 0 } },
      vertexShader: /* glsl */ `uniform vec3 uA, uB; uniform float uW; varying vec2 vUv;
        void main(){ vUv = uv; vec3 w = mix(uA, uB, position.y), t = uB - uA; vec4 mv = viewMatrix * vec4(w, 1.0); vec3 tv = (viewMatrix * vec4(t, 0.0)).xyz, sd = cross(tv, mv.xyz); float l = length(sd); sd = l > 1e-5 ? sd / l : vec3(1.0, 0.0, 0.0);
          mv.xyz += sd * position.x * uW * 0.5 * (0.35 + 0.65 * position.y); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `uniform vec3 uC1, uC2; uniform float uAlpha, uTaper, uCore, uHot, uSeed; uniform sampler2D uN; varying vec2 vUv;
        void main(){ float x = abs(vUv.x - 0.5) * 2.0, y = vUv.y, n = texture2D(uN, vec2(y * 2.5 + uSeed, vUv.x * 0.3)).r;
          float core = exp(-pow(x / max(0.02, uCore), 2.0)), glow = exp(-x * x * 5.5) * (0.55 + 0.6 * n), along = pow(y, uTaper) * smoothstep(1.0, 0.97, y), head = smoothstep(0.82, 0.98, y) * uHot;
          vec3 col = mix(uC2, uC1, clamp(y * y + core * 0.4, 0.0, 1.0)) * glow * (0.5 + 0.8 * head) + vec3(1.0, 0.86, 0.6) * core * (0.35 + 0.7 * head);      // 外层是饱和的橙（叠在亮的地面上也不发白），只有中间一道细芯是白热的
          float dark = (1.0 - smoothstep(0.55, 1.0, x)) * (1.0 - glow * 0.9) * 0.42;      // 亮光两边垫一层暗的（第九轮：和 fx2a 一样的发现——发光的颜色和地面没反差就看不出来，垫一层深色，亮的才跳出来）
          float a = along * uAlpha; if (a < 0.004) discard; gl_FragColor = vec4(col * a, dark * a);
          #include <colorspace_fragment>
        }` })); m.frustumCulled = false; m.renderOrder = 9; }
  const mesh = m, u = (mesh.material as THREE.ShaderMaterial).uniforms; u.uW.value = o.width; u.uCore.value = o.core ?? 0.3; u.uTaper.value = o.taper ?? 1.4; u.uHot.value = o.hot ?? 1; u.uAlpha.value = 1; u.uSeed.value = Math.random();
  (u.uC1.value as THREE.Color).set(o.color ?? 0xffb24a); (u.uC2.value as THREE.Color).set(o.color2 ?? 0xa82a12); mesh.visible = false; fx.group.add(mesh);
  return { alpha(a) { u.uAlpha.value = a; }, free() { mesh.removeFromParent(); tracerPool.push(mesh); },
    set(t, h) { const len = Math.hypot(h.x - t.x, h.y - t.y, h.z - t.z); mesh.visible = len > 0.03; (u.uA.value as THREE.Vector3).set(t.x, t.y, t.z); (u.uB.value as THREE.Vector3).set(h.x, h.y, h.z); } };
}

// ---------------------------------------------------------------- 立着的冲击环
let wallGeo: THREE.BufferGeometry | null = null; const wallPool: { m: THREE.Mesh; u: Record<string, { value: any }> }[] = [];
/** 一圈有高度的环从 from 倍的半径推到 r，越推越矮、越淡。fire：火墙（白热的底边、往上烧成暗红和烟）；否则是土墙（color 是土的颜色）。
 *  arc 给了就只有朝 yaw 那一边的一段弧（半张角，弧度），两头收掉：朝前拍出去的冲击用 */
export function wall(fx: FxLib, api: { run: (sec: number, frame: (k: number, dt: number) => void, done?: () => void) => void }, o: { x: number; z: number; r: number; h: number; life: number; from?: number; fire?: boolean; color?: number; alpha?: number; y?: number; arc?: number; yaw?: number }) {
  if (!wallGeo) { wallGeo = new THREE.CylinderGeometry(1, 1, 1, 64, 4, true); wallGeo.translate(0, 0.5, 0); }
  let rec = wallPool.pop();
  if (!rec) { const u = { uK: { value: 0 }, uFire: { value: 0 }, uC: { value: new THREE.Color() }, uAlpha: { value: 1 }, uSeed: { value: 0 }, uArc: { value: 9 }, uN: { value: noiseTex() }, ...rampUniforms() };
    const m = new THREE.Mesh(wallGeo, new THREE.ShaderMaterial({ ...premul, transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: u,
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `uniform float uK, uFire, uAlpha, uSeed, uArc; uniform vec3 uC; uniform sampler2D uN; varying vec2 vUv; ${RAMP_GLSL}
        void main(){ float x = vUv.x, k = uK, ang = abs(mod(x * 6.2832 + 3.14159, 6.2832) - 3.14159), side = 1.0 - smoothstep(uArc * 0.55, uArc, ang), y = vUv.y / max(0.05, 0.35 + 0.65 * side);
          if (side < 0.004) discard;
          float n = texture2D(uN, vec2(x * 5.0 + uSeed, y * 0.7 - k * 0.6)).r * 0.6 + texture2D(uN, vec2(x * 11.0 - uSeed, y * 1.6 - k * 1.3)).g * 0.4;
          float top = 1.0 - smoothstep(0.15, 1.0, y + (n - 0.5) * 0.9 + k * 0.35), er = k * k * 0.75, d = smoothstep(er, er + 0.3, top * (0.4 + n)) * smoothstep(0.0, 0.06, y) * side;
          if (d < 0.004) discard;
          vec3 rgb; float a;
          if (uFire > 0.5) { float h = clamp((1.0 - y * 1.25) * (1.0 - k * 1.1) * (0.6 + 0.8 * n) + 0.15, 0.0, 1.0), f = smoothstep(0.08, 0.3, h);
            vec3 sc = ${FXB.on ? "vec3(0.13, 0.1, 0.085)" : "vec3(0.025, 0.022, 0.02)"} * (0.7 + 0.6 * n);      /* 换画风 B：烟墙是暖灰，不是黑（亮地面上一圈黑烟是脏的） */ float aS = d * 0.6 * (1.0 - f), aF = d * f * mix(0.55, 0.12, smoothstep(0.5, 0.95, h));
            rgb = fireCol(h) * d * f * (0.7 + 1.1 * h) + sc * aS; a = aS + aF; }
          else { a = d * 0.62; rgb = uC * (0.7 + 0.55 * n + 0.25 * y) * a; }
          gl_FragColor = vec4(rgb * uAlpha, a * uAlpha);
          #include <colorspace_fragment>
        }` }));
    m.frustumCulled = false; m.renderOrder = 7.5; rec = { m, u }; }
  const R = rec, from = o.from ?? 0.2; fx.group.add(R.m); R.m.visible = true; R.m.rotation.y = o.yaw ?? 0; R.u.uArc.value = o.arc ?? 9; R.u.uFire.value = o.fire ? 1 : 0; (R.u.uC.value as THREE.Color).set(o.color ?? 0x8b8279); R.u.uSeed.value = Math.random() * 9; R.u.uAlpha.value = o.alpha ?? 1;
  const y0 = o.y ?? fx.ground(o.x, o.z) - 0.05;
  api.run(o.life, k => { const g = 1 - Math.pow(1 - k, 2.6), r = o.r * (from + (1 - from) * g), h = o.h * (0.25 + 0.75 * Math.min(1, k / 0.12)) * (1 - 0.75 * k); R.u.uK.value = k; R.m.position.set(o.x, y0, o.z); R.m.scale.set(r, h, r); },
    () => { R.m.visible = false; R.m.removeFromParent(); wallPool.push(R); });
}

// ---------------------------------------------------------------- 一圈烧着的火墙（常驻）
/** 一圈立着的矮火墙，一直在烧（火苗往上窜、顶上冒烟）：大招、火场的范围边。set 跟着人走；alpha 整体的旺度；kill 很快灭掉 */
export function fence(fx: FxLib, o: { x: number; z: number; r: number; h: number; alpha?: number }): { set: (x: number, z: number) => void; alpha: (a: number) => void; kill: () => void } {
  if (!wallGeo) { wallGeo = new THREE.CylinderGeometry(1, 1, 1, 64, 4, true); wallGeo.translate(0, 0.5, 0); }
  const u = { uT: { value: 0 }, uAlpha: { value: 0 }, uSeed: { value: Math.random() * 9 }, uRep: { value: Math.max(4, Math.round(o.r * 2.2)) }, uN: { value: noiseTex() }, ...rampUniforms() };
  const mat = new THREE.ShaderMaterial({ ...premul, transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: u,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `uniform float uT, uAlpha, uSeed, uRep; uniform sampler2D uN; varying vec2 vUv; ${RAMP_GLSL}
      void main(){ float x = vUv.x * uRep, y = vUv.y, t = uT;      // uRep：一圈火苗按周长重复几次（半径大的圈火苗不会被拉得很宽）
        float n = texture2D(uN, vec2(x * 0.9 + uSeed, y * 0.55 - t * 0.9)).r * 0.6 + texture2D(uN, vec2(x * 2.1 - uSeed, y * 1.2 - t * 1.9)).g * 0.4;
        float hm = 0.35 + 0.65 * texture2D(uN, vec2(x * 0.45 + uSeed * 3.0, t * 0.22)).b;      // 这一处的火苗有多高：一簇一簇的，此起彼伏
        float body = 1.0 - smoothstep(0.0, hm, y + (n - 0.5) * 0.55), d = smoothstep(0.06, 0.32, body * (0.3 + n)) * smoothstep(0.0, 0.05, y);
        if (d < 0.004 && y > 0.16) discard;
        float h = clamp(body * (0.45 + 0.75 * n), 0.0, 1.0), f = smoothstep(0.08, 0.3, h);
        float aS = d * 0.4 * (1.0 - f), aF = d * f * mix(0.6, 0.15, smoothstep(0.45, 0.95, h)), base = (1.0 - smoothstep(0.0, 0.16, y)) * 0.5;      // base：墙根一圈烧黑的（压暗地面，上面的火才跳出来）
        vec3 rgb = fireCol(h) * d * f * (0.6 + 0.8 * h) + ${FXB.on ? "vec3(0.13, 0.1, 0.085)" : "vec3(0.06, 0.05, 0.045)"} * aS;
        gl_FragColor = vec4(rgb * uAlpha, min(1.0, aS + aF + base * (1.0 - aF)) * uAlpha);
        #include <colorspace_fragment>
      }` });
  const m = new THREE.Mesh(wallGeo, mat); m.renderOrder = 7.5; m.frustumCulled = false; m.scale.set(o.r, o.h, o.r); fx.group.add(m);
  let a = 1, dying = false, gone = false, t0 = fx.time(), last = t0; const peak = o.alpha ?? 1;
  m.onBeforeRender = () => { if (gone) return; const now = fx.time(), dt = Math.max(0, now - last); last = now; u.uT.value = now - t0;
    if (dying) { u.uAlpha.value -= dt * 3; if (u.uAlpha.value <= 0) { gone = true; fx.group.remove(m); mat.dispose(); } } else u.uAlpha.value = peak * a * Math.min(1, (now - t0) / 0.15); };
  const set = (x: number, z: number) => { if (!gone) m.position.set(x, fx.ground(x, z) - 0.05, z); }; set(o.x, o.z);
  return { set, alpha(v) { a = v; }, kill() { dying = true; } };
}

// ---------------------------------------------------------------- 贴地漫开的一层火（第九轮 polish-old）
// 一张贴着地形的网（每个顶点落在地面上），图案在着色器里按极坐标算：前沿 uF（0 到 1，按半径归一）往外推，前沿后面 uW 宽的一条带子在烧，
// 越靠前沿越旺；推到头以后（uK 从 0 走到 1）整片从里往外一块块蚀掉，烫的先凉成暗红再变焦黑。uAng 给了（小于 3）就只画朝 +z 的扇形。
// 颜色用和火团一样的梯度、一样的预乘透明：烫的那一道接近叠加发光，暗红和焦黑真的压住地面——亮的前沿下面垫着暗的，火的形状才跳出来。
const sheetGeos: Record<number, THREE.BufferGeometry[]> = {};
const sheetPool: { m: THREE.Mesh; u: Record<string, { value: any }> }[] = [];
export interface SheetOpts { x: number; z: number; r: number; life: number; reach?: number; from?: number; band?: number; yaw?: number; angle?: number; heat?: number; alpha?: number; soot?: number }
/** 一层贴地漫开的火：reach 秒里前沿从 from 推到 r（先快后慢），band 是烧着的那一条带子占半径的几成；life 到头以前慢慢烧完、蚀掉。
 *  angle 给了就是扇形（半张角，朝 yaw）；heat 前沿有多烫（1 是白热，默认 0.8，只有前沿最中间那一点发白）；soot 烧过的地方焦黑多浓 */
export function sheet(fx: FxLib, api: { run: (sec: number, frame: (k: number, dt: number) => void, done?: () => void) => void }, o: SheetOpts) {
  const seg = o.r > 3.5 ? 28 : 16;
  let rec = sheetPool.pop();
  if (!rec) { const u = { uF: { value: 0 }, uW: { value: 0.4 }, uK: { value: 0 }, uAng: { value: 9 }, uHeat: { value: 0.8 }, uAlpha: { value: 1 }, uSeed: { value: 0 }, uT: { value: 0 }, uSoot: { value: 0.5 }, uN: { value: noiseTex() }, ...rampUniforms() };
    const m = new THREE.Mesh(undefined, new THREE.ShaderMaterial({ ...premul, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, uniforms: u,
      vertexShader: `varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `uniform float uF, uW, uK, uAng, uHeat, uAlpha, uSeed, uT, uSoot; uniform sampler2D uN; varying vec2 vP; ${RAMP_GLSL}
        void main(){ float r = length(vP), th = atan(vP.x, vP.y), side = uAng > 3.0 ? 1.0 : 1.0 - smoothstep(uAng - 0.14, uAng + 0.02, abs(th));
          if (side < 0.004 || r > 1.0) discard;
          float n = texture2D(uN, vec2(th * 0.9 + uSeed, r * 1.4 - uT * 0.9)).r, n2 = texture2D(uN, vec2(th * 2.3 - uSeed, r * 3.2 - uT * 2.1)).g, n3 = texture2D(uN, vec2(th * 5.0 + uSeed * 2.0, r * 6.0 - uT * 3.0)).b;
          float rr = r - (n - 0.5) * 0.1 - (n3 - 0.5) * 0.06;      // 前沿是一舌一舌往前舔的，不是一道规整的圆
          float lead = 1.0 - smoothstep(uF - 0.012, uF + 0.012, rr), band = smoothstep(uF - uW, uF - 0.01, rr);      // lead：前沿以内；band：越靠前沿越接近 1
          float edge = 1.0 - smoothstep(0.86, 1.0, r + (n2 - 0.5) * 0.12);      // 外沿收掉（扇形的两条边已经在 side 里收了）
          float er = uK * uK * 0.9, keep = smoothstep(er, er + 0.25, (0.35 + 0.65 * n2) * (1.0 - 0.45 * r) + 0.1);      // 推到头以后一块块蚀掉：中间先没（离前沿最远、烧得最久）
          float fire = lead * band * side * keep * edge, burnt = lead * side * keep * edge * (1.0 - smoothstep(0.85, 1.0, uK));
          float lick = texture2D(uN, vec2(th * 3.2 + uSeed * 1.7, r * 0.7 - uT * 1.8)).b;      // 顺着往外的一道道火舌（角向频率高、径向频率低：拉成放射状的条）
          float h = clamp(uHeat * band * band * (0.2 + 1.1 * n2 * n * 1.3) * (0.45 + 0.9 * lick) * (1.0 - uK * 0.85), 0.0, 1.0) * fire, f = smoothstep(0.1, 0.32, h);
          float aS = burnt * uSoot * (0.6 + 0.4 * n) * (1.0 - f), aF = f * mix(0.62, 0.14, smoothstep(0.45, 0.95, h));
          vec3 rgb = fireCol(h) * f * (0.6 + 0.8 * h) + ${FXB.on ? "vec3(0.1, 0.05, 0.028)" : "vec3(0.035, 0.028, 0.024)"} * aS;      /* 换画风 B：烧过的底是暖褐 */
          float a = (aS + aF) * uAlpha; if (a < 0.004) discard;
          gl_FragColor = vec4(rgb * uAlpha, a);
          #include <colorspace_fragment>
        }` }));
    m.frustumCulled = false; m.renderOrder = 5.8; rec = { m, u }; }
  const R = rec, m = R.m, u = R.u, base = (sheetGeos[seg] ??= []).pop() ?? new THREE.PlaneGeometry(2, 2, seg, seg).rotateX(-Math.PI / 2);
  m.geometry = base; m.scale.set(o.r, 1, o.r); m.rotation.y = o.yaw ?? Math.random() * TAU; m.position.set(o.x, fx.ground(o.x, o.z), o.z); fx.group.add(m);
  const P = base.getAttribute("position") as THREE.BufferAttribute, cs = Math.cos(m.rotation.y), sn = Math.sin(m.rotation.y), y0 = m.position.y;
  for (let i = 0; i < P.count; i++) { const lx = P.getX(i) * o.r, lz = P.getZ(i) * o.r; P.setY(i, fx.ground(o.x + lx * cs + lz * sn, o.z - lx * sn + lz * cs) + 0.1 - y0); } P.needsUpdate = true;
  const reach = o.reach ?? 0.25, from = o.from ?? 0.1, t0 = fx.time(); u.uW.value = o.band ?? 0.45; u.uAng.value = o.angle ?? 9; u.uHeat.value = o.heat ?? 0.8; u.uSeed.value = Math.random() * 9; u.uSoot.value = o.soot ?? 0.5; u.uAlpha.value = o.alpha ?? 1;
  api.run(o.life, k => { const t = k * o.life, g = Math.min(1, t / reach); u.uF.value = from + (1 - from) * (1 - Math.pow(1 - g, 2.4)); u.uK.value = Math.max(0, (t - reach) / Math.max(0.05, o.life - reach)); u.uT.value = fx.time() - t0; },
    () => { m.removeFromParent(); sheetGeos[seg].push(base); m.geometry = undefined as unknown as THREE.BufferGeometry; sheetPool.push(R); });
}

// ---------------------------------------------------------------- 一片立在地上的小火苗（第九轮 polish-old）
// 一张张竖着的火舌片（只绕竖轴转向镜头），一次画完。每片有自己的高矮、粗细、相位：高度随时间此起彼伏，偶尔矮到没有再窜起来；
// 火舌的形状、颜色在片元里算（根部暗红、往上橙、只有最旺的几片尖上发黄），透明用预乘，暗红的根真的压住地面。
// 参照 Dota 2 杰奇洛的烈焰焚身（Macropyre）：持续的火场就是地上密密的一层小火苗，边在哪一眼看得出。
let bedQuad: THREE.PlaneGeometry | null = null;
export interface FlameBed { set: (x: number, z: number) => void; alpha: (a: number) => void; ignite: (k: number) => void; kill: () => void; }
/** 一片火苗：半径 r；edge 张火舌片沿着边（间隔约 0.42 米一片，不给就按周长算），inner 张散在里面（一簇一簇的）；h 边上火苗多高（米）。
 *  ignite(k) 从中间往外点着（0 到 1，不调就是全点着）；alpha 整体的旺度；set 挪到别处（跟着人走）；kill 很快灭掉 */
export function flameBed(fx: FxLib, o: { x: number; z: number; r: number; edge?: number; inner?: number; h?: number; w?: number; alpha?: number; heat?: number }): FlameBed {
  bedQuad ??= (() => { const g = new THREE.PlaneGeometry(1, 1, 1, 4); g.translate(0, 0.5, 0); return g; })();
  const nE0 = o.edge ?? Math.round((TAU * o.r) / 0.3), nI0 = o.inner ?? Math.round(o.r * o.r * 1.2), nE = LITE ? Math.ceil(nE0 * 0.6) : nE0, nI = LITE ? Math.ceil(nI0 * 0.5) : nI0, N = nE + nI, H = o.h ?? 0.8, Wd = o.w ?? 0.55;
  const B = bedFree.get(N)?.pop() ?? newBed(N), { g, mat, u, aP, aS, PA, SA } = B, loc: [number, number][] = [];
  for (let i = 0; i < nE; i++) { const a = ((i + Math.random() * 0.8) / nE) * TAU, rr = o.r * (0.88 + 0.11 * Math.random()), tall = Math.random() < 0.3; loc.push([Math.cos(a) * rr, Math.sin(a) * rr]);      // 两三成高的，其余矮的，连起来是一道起伏的火线
    aS.set([H * (tall ? 1.0 + 0.45 * Math.random() : 0.5 + 0.4 * Math.random()), Wd * (0.75 + 0.5 * Math.random()), Math.random(), rr / o.r], i * 4); }
  const clusters = Array.from({ length: Math.max(2, Math.round(nI / 6)) }, () => { const a = Math.random() * TAU, d = o.r * 0.72 * Math.sqrt(Math.random()); return [Math.cos(a) * d, Math.sin(a) * d]; });
  for (let i = 0; i < nI; i++) { const c = clusters[i % clusters.length], a = Math.random() * TAU, d = 0.25 + Math.random() * 0.75; let px = c[0] + Math.cos(a) * d, pz = c[1] + Math.sin(a) * d; const l = Math.hypot(px, pz); if (l > o.r * 0.8) { px *= o.r * 0.8 / l; pz *= o.r * 0.8 / l; }
    loc.push([px, pz]); aS.set([H * (0.35 + 0.5 * Math.random()), Wd * (0.6 + 0.5 * Math.random()), Math.random(), Math.hypot(px, pz) / o.r], (nE + i) * 4); }
  SA.needsUpdate = true; u.uT.value = 0; u.uAlpha.value = 0; u.uIgn.value = 1; u.uHeat.value = o.heat ?? 0.82;
  const m = B.m; fx.group.add(m);
  let cx = NaN, cz = NaN, a = 1, dying = false, gone = false; const t0 = fx.time(), peak = o.alpha ?? 1; let last = t0;
  const set = (x: number, z: number) => { if (gone) return; if (Math.hypot(x - cx, z - cz) < 0.15) { m.position.x = x; m.position.z = z; return; } cx = x; cz = z; const y0 = fx.ground(x, z); m.position.set(x, y0, z);
    for (let i = 0; i < N; i++) { const [lx, lz] = loc[i]; aP[i * 3] = lx; aP[i * 3 + 1] = fx.ground(x + lx, z + lz) - y0 - 0.04; aP[i * 3 + 2] = lz; } PA.needsUpdate = true; };
  set(o.x, o.z);
  m.onBeforeRender = () => { if (gone) return; const now = fx.time(), dt = Math.max(0, now - last); last = now; u.uT.value = now - t0;
    if (dying) { u.uAlpha.value -= dt * 3; if (u.uAlpha.value <= 0) { gone = true; m.onBeforeRender = () => {}; fx.group.remove(m); let f = bedFree.get(N); if (!f) bedFree.set(N, f = []); f.push(B); } } else u.uAlpha.value = peak * a * Math.min(1, (now - t0) / 0.12); };
  void g; void mat;
  return { set, alpha(v) { a = v; }, ignite(k) { u.uIgn.value = k * 1.2; }, kill() { dying = true; } };
}
interface BedRec { m: THREE.Mesh; g: THREE.InstancedBufferGeometry; mat: THREE.ShaderMaterial; u: Record<string, { value: any }>; aP: Float32Array; aS: Float32Array; PA: THREE.InstancedBufferAttribute; SA: THREE.InstancedBufferAttribute; }
const bedFree = new Map<number, BedRec[]>();      // 池子：按火舌片的张数分，用完的留着几何体和材质，下次换位置、换随机数接着用
function newBed(N: number): BedRec {
  const q = bedQuad!, g = new THREE.InstancedBufferGeometry(); g.index = q.index; g.setAttribute("position", q.getAttribute("position")); g.setAttribute("uv", q.getAttribute("uv"));
  const aP = new Float32Array(N * 3), aS = new Float32Array(N * 4), PA = new THREE.InstancedBufferAttribute(aP, 3), SA = new THREE.InstancedBufferAttribute(aS, 4); PA.setUsage(THREE.DynamicDrawUsage); SA.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute("aP", PA); g.setAttribute("aS", SA); g.instanceCount = N;
  const u = { uT: { value: 0 }, uAlpha: { value: 0 }, uIgn: { value: 1 }, uHeat: { value: 0.82 }, uN: { value: noiseTex() }, ...rampUniforms() };
  const mat = new THREE.ShaderMaterial({ ...premul, transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: u,
    vertexShader: /* glsl */ `attribute vec3 aP; attribute vec4 aS; uniform float uT, uIgn; varying vec2 vUv; varying float vSeed, vLife;
      void main(){ float s = aS.z * 61.0, lit = smoothstep(aS.w - 0.18, aS.w + 0.02, uIgn);
        float f = 0.5 + 0.28 * sin(uT * (2.3 + aS.z * 1.7) + s) + 0.22 * sin(uT * (5.1 + aS.z * 2.9) + s * 1.7);      // 此起彼伏：两个频率叠起来的高矮
        float life = lit * smoothstep(0.12, 0.42, f), h = aS.x * (0.45 + 0.75 * f) * life;
        vec3 R = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]); R.y = 0.0; R = normalize(R + vec3(1e-4, 0.0, 0.0));
        vec3 b = (modelMatrix * vec4(aP, 1.0)).xyz, w = b + R * (position.x * aS.y * (0.55 + 0.45 * life) + sin(uT * 4.0 + s) * 0.12 * position.y * position.y * h) + vec3(0.0, position.y * h, 0.0);
        vUv = uv; vSeed = aS.z; vLife = life; gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0); }`,
    fragmentShader: /* glsl */ `uniform float uT, uAlpha, uHeat; uniform sampler2D uN; varying vec2 vUv; varying float vSeed, vLife; ${RAMP_GLSL}
      void main(){ if (vLife < 0.01) discard; float t = vUv.y, x = (vUv.x - 0.5) * 2.0;
        float n = texture2D(uN, vec2(vUv.x * 0.45 + vSeed * 7.0, t * 0.55 - uT * 1.7)).r, n2 = texture2D(uN, vec2(vUv.x * 0.9 - vSeed * 5.0, t * 1.2 - uT * 2.9)).g, n3 = texture2D(uN, vec2(vUv.x * 1.7 + vSeed * 3.0, t * 2.2 - uT * 4.1)).b;
        float bend = (n - 0.5) * 1.4 * t * t + sin(t * 5.0 - uT * 7.0 + vSeed * 40.0) * 0.12 * t;      // 火舌往上越来越扭
        float w = (0.95 * pow(1.0 - t, 0.8) + 0.05) * (0.5 + 0.5 * smoothstep(0.0, 0.22, t)), ax = abs(x + bend);      // 底下收圆（不是一道平的底边，不然一片片像剪纸三角）
        float body = (1.0 - smoothstep(w * 0.3, w, ax + (n3 - 0.5) * 0.3 * t));
        body *= 1.0 - smoothstep(0.5, 1.0, t + (n2 - 0.5) * 0.6);                        // 上半截被往上走的噪声撕成一舌一舌的
        if (body < 0.004) discard;
        float core = (1.0 - smoothstep(0.0, w * 0.6, ax)) * smoothstep(0.03, 0.16, t) * (1.0 - smoothstep(0.35, 0.75, t + (n2 - 0.5) * 0.4));      // 火心：根部往上一截，最烫
        float hv = 0.72 + 0.4 * fract(vSeed * 7.7);      // 每一片旺的程度不一样：有的偏暗红，有的偏黄
        float h = clamp(uHeat * hv * (body * (0.5 + 0.4 * n2) * (1.0 - 0.45 * t) + core * 0.4) * (0.65 + 0.35 * vLife), 0.0, 1.0), f = smoothstep(0.08, 0.28, h);
        float root = 1.0 - smoothstep(0.0, 0.12, t);                                          // 根部压暗：火是从焦黑的地上长出来的
        float aS = body * (0.3 * (1.0 - f) + 0.35 * root) * (1.0 - t), aF = body * f * mix(0.55, 0.16, smoothstep(0.45, 0.95, h)) * (1.0 - 0.6 * root);      // 凉的地方、根部是暗的（压住地面），只有火舌身上是亮的
        vec3 rgb = fireCol(h) * f * body * (0.5 + 0.75 * h) * (1.0 - 0.6 * root) + ${FXB.on ? "vec3(0.1, 0.05, 0.028)" : "vec3(0.05, 0.035, 0.03)"} * aS;      /* 换画风 B：烧过的底是暖褐 */
        float a = (aS + aF) * uAlpha; if (a < 0.004) discard;
        gl_FragColor = vec4(rgb * uAlpha, a);
        #include <colorspace_fragment>
      }` });
  const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.renderOrder = 8.2;
  return { m, g, mat, u, aP, aS, PA, SA };
}

// ---------------------------------------------------------------- 贴地的一条
let stripBase: THREE.BufferGeometry | null = null;
export interface Strip { span: (x0: number, z0: number, x1: number, z1: number) => void; kill: () => void; }
/** 一条贴地的焦痕：r 半宽；life 一辈子；hot 烧红的线亮多久（之后在 cool 秒里凉下去）；用 span 拉长、挪位置 */
export function strip(fx: FxLib, api: { run: (sec: number, frame: (k: number, dt: number) => void, done?: () => void) => void }, o: { r: number; life: number; hot?: number; cool?: number; alpha?: number; color?: number }): Strip {
  if (!stripBase) { stripBase = new THREE.PlaneGeometry(2, 2, 4, 24); stripBase.rotateX(-Math.PI / 2); }
  const geo = stripBase.clone(), P = geo.getAttribute("position") as THREE.BufferAttribute, B = stripBase.getAttribute("position");
  const u = { uHeat: { value: 1 }, uAlpha: { value: 0 }, uSeed: { value: Math.random() * 9 }, uHalf: { value: 1 }, uW: { value: o.r }, uDis: { value: 0 }, uN: { value: noiseTex() }, uC: { value: new THREE.Color(o.color ?? 0xff7424) }, ...rampUniforms() };
  const mat = new THREE.ShaderMaterial({ ...premul, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, uniforms: u,
    vertexShader: `varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `uniform float uHeat, uAlpha, uSeed, uHalf, uW, uDis; uniform vec3 uC; uniform sampler2D uN; varying vec2 vP; ${RAMP_GLSL}
      void main(){ float L = uHalf, along = vP.y * L, x = vP.x;      // along：从中点量的米数；x：-1 到 1 横过去
        float n = texture2D(uN, vec2(along * 0.11 + uSeed, x * 0.25)).r, m2 = texture2D(uN, vec2(along * 0.33 - uSeed, x * 0.6 + 0.3)).g;
        float cap = smoothstep(-L, -L + 0.6, along) * (1.0 - smoothstep(L - 0.5, L, along)), ax = abs(x + (n - 0.5) * 0.5);
        float seg = smoothstep(0.32, 0.62, texture2D(uN, vec2(along * 0.07 - uSeed, 0.5)).b * 0.5 + m2 * 0.7 - 0.1);      // 烧红的线是断断续续的：一段亮、一段只剩暗红的炭
        float soot = (1.0 - smoothstep(0.3, 1.0, ax + (m2 - 0.5) * 0.7)) * cap, line = (1.0 - smoothstep(0.0, 0.16 + 0.12 * seg, abs(x + (n - 0.5) * 0.45))) * cap * (0.35 + 0.65 * seg);
        float dis = smoothstep(uDis * 1.2 - 0.2, uDis * 1.2, n * 0.7 + m2 * 0.3); soot *= dis; line *= dis;
        float h = clamp(uHeat * (0.55 + 0.6 * m2) * line, 0.0, 1.0), f = smoothstep(0.04, 0.25, h);
        vec3 sc = ${FXB.on ? "vec3(0.1, 0.05, 0.028)" : "vec3(0.03, 0.025, 0.022)"}; float aS = soot * ${FXB.on ? "0.55" : "0.7"} * (1.0 - f * 0.5), aF = f * line * 0.35;      /* 换画风 B：焦线、犁痕、滑痕的底是暖褐、薄一点（原来是一道黑，亮地面上像一条污渍） */
        vec3 rgb = fireCol(h) * f * line * (0.6 + 1.2 * h) + sc * aS; float a = (aS + aF) * uAlpha; if (a < 0.004) discard;
        gl_FragColor = vec4(rgb * uAlpha, a);
        #include <colorspace_fragment>
      }` });
  const m = new THREE.Mesh(geo, mat); m.renderOrder = 5.6; m.frustumCulled = false; fx.group.add(m);
  let dead = false, dying = false, off = 1, t = 0, cx = 0, cz = 0, yaw = 0, half = 0.1;
  const drape = () => { const cs = Math.cos(yaw), sn = Math.sin(yaw), y0 = fx.ground(cx, cz); m.position.set(cx, y0, cz); m.rotation.y = yaw; m.scale.set(o.r, 1, half);
    for (let i = 0; i < P.count; i++) { const px = B.getX(i) * o.r, pz = B.getZ(i) * half; P.setY(i, fx.ground(cx + px * cs + pz * sn, cz - px * sn + pz * cs) + 0.08 - y0); } P.needsUpdate = true; };
  const hot = o.hot ?? 0.4, cool = o.cool ?? 1.2, alpha = o.alpha ?? 1;
  api.run(o.life, (_k, dt) => { if (dead) return; t += dt; if (dying) off -= dt * 3; const left = o.life - t;
    u.uHeat.value = hot + cool <= 0 ? 0 : t < hot ? 1 : Math.max(0, 1 - (t - hot) / cool); u.uDis.value = Math.max(0, 1 - left / Math.max(0.6, o.life * 0.35)); u.uAlpha.value = alpha * Math.min(1, t / 0.04) * Math.max(0, off); },
    () => { dead = true; fx.group.remove(m); mat.dispose(); geo.dispose(); });
  return { span(x0, z0, x1, z1) { if (dead) return; const dx = x1 - x0, dz = z1 - z0; half = Math.max(0.05, Math.hypot(dx, dz) / 2); cx = (x0 + x1) / 2; cz = (z0 + z1) / 2; yaw = Math.atan2(dx, dz); u.uHalf.value = half; drape(); },
    kill() { dying = true; } };
}

// ---------------------------------------------------------------- 瞄准记号
let reticleGeo: THREE.PlaneGeometry | null = null; const reticlePool: { m: THREE.Mesh; u: Record<string, { value: any }> }[] = [];
export interface Reticle { set: (x: number, z: number) => void; kill: () => void; }
/** 脚下的瞄准记号：一圈四段断开的弧、四个往里指的刻度，慢慢转；出现时从大往里一收 */
export function reticle(fx: FxLib, o: { r: number; color?: number; alpha?: number }): Reticle {
  if (!reticleGeo) { reticleGeo = new THREE.PlaneGeometry(2, 2); reticleGeo.rotateX(-Math.PI / 2); }
  let rec = reticlePool.pop();
  if (!rec) { const u = { uT: { value: 0 }, uC: { value: new THREE.Color() }, uAlpha: { value: 1 }, uIn: { value: 0 } };
    const m = new THREE.Mesh(reticleGeo, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, ...glowBlend(), uniforms: u, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      vertexShader: `varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `uniform float uT, uAlpha, uIn; uniform vec3 uC; varying vec2 vP; ${FXB.on ? BOUT : ""}
        void main(){ float s = 1.0 + 0.6 * (1.0 - uIn); vec2 p = vP * s; float r = length(p), th = atan(p.y, p.x) + uT * 0.8, seg = fract(th / 1.5708);
          float arc = (1.0 - smoothstep(0.02, 0.045, abs(r - 0.82))) * smoothstep(0.08, 0.14, seg) * (1.0 - smoothstep(0.86, 0.92, seg));
          float tk = (1.0 - smoothstep(0.03, 0.06, abs(fract(th / 1.5708 + 0.5) - 0.5) * r * 6.0)) * smoothstep(0.5, 0.55, r) * (1.0 - smoothstep(0.7, 0.74, r));
          float glow = exp(-pow((r - 0.82) / 0.12, 2.0)) * 0.25;
          float a = (arc + tk * 0.9 + glow) * uAlpha; if (a < 0.004) discard; ${glowOut("uC", "a")}
        }` }));
    m.frustumCulled = false; m.renderOrder = 6.5; rec = { m, u }; }
  const R = rec; fx.group.add(R.m); R.m.visible = true; (R.u.uC.value as THREE.Color).set(o.color ?? 0xe9b765); R.u.uIn.value = 0; R.u.uAlpha.value = 0; R.m.scale.setScalar(o.r);
  let dying = false, gone = false, t = 0, last = fx.time();
  R.m.onBeforeRender = () => { if (gone) return; const now = fx.time(), dt = Math.max(0, now - last); last = now; t += dt; R.u.uT.value = t; R.u.uIn.value = 1 - Math.pow(1 - Math.min(1, t / 0.18), 3);
    const a = (o.alpha ?? 0.9) * Math.min(1, t / 0.08); if (dying) { R.u.uAlpha.value -= dt * 4; if (R.u.uAlpha.value <= 0) { gone = true; R.m.visible = false; R.m.removeFromParent(); R.m.onBeforeRender = () => {}; reticlePool.push(R); } } else R.u.uAlpha.value = a; };
  return { set(x, z) { if (!gone) R.m.position.set(x, fx.ground(x, z) + 0.1, z); }, kill() { dying = true; } };
}

// ---------------------------------------------------------------- 预热
const warmed = new WeakSet<FxLib>();
/** 每种零件先各出一个看不见的（埋在地下、一闪就收），让渲染器在对局开头就把着色器编好，第一次放技能不会卡一下。
 *  特效库的 warm 由主程序在开局前调；这几样是这个任务新加的，主程序不认识，所以由用到它们的英雄在第一帧调（见 gorran、vero 的 passive） */
export function warm(fx: FxLib, api: { run: (sec: number, frame: (k: number, dt: number) => void, done?: () => void) => void }, x: number, z: number) {
  if (warmed.has(fx)) return; warmed.add(fx);
  const y = fx.ground(x, z) - 40, p = { x, y, z };
  puff(fx, { pos: p, n: 1, size: 0.01, life: 0.2 });
  const t = tracer(fx, { width: 0.01 }); t.set(p, { x, y: y + 0.01, z }); api.run(0.2, () => {}, () => t.free());
  wall(fx, api, { x, z, r: 0.01, h: 0.01, life: 0.2, y }); wall(fx, api, { x, z, r: 0.01, h: 0.01, life: 0.2, y, fire: true });
  const f = fence(fx, { x, z, r: 0.01, h: 0.01 }); f.kill();
  const r = reticle(fx, { r: 0.01 }); r.set(x, z); r.kill();
  const s = strip(fx, api, { r: 0.01, life: 0.2 }); s.span(x, z, x + 0.01, z);
  sheet(fx, api, { x, z, r: 0.01, life: 0.2, alpha: 0 });      // 第九轮 polish-old 加的两样
  flameBed(fx, { x, z, r: 0.01, edge: 1, inner: 0, alpha: 0 }).kill();      // 透明度是 0，片元全丢掉，摆在地面上也看不见
}
