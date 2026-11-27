// 第九轮 k-hedda：赫达（烬誓庭辅助，背炉的女铁匠）的技能特效用到的新零件。
//
// 为什么要自己写：赫达的技能是“铁”和“炉火”——一条真的铁链、一把真的火钳、一块从炉膛里掏出来的白热炉心、砸出来的一片龟裂的炭地。
// 特效库里的链子（fx0.chain）是一张贴图带子加一个青色的光点（岚的骨钩用的），从俯视的镜头看是一条细线，读不出“链子”；
// 库里也没有会发热的铁、贴着地形的龟裂炭地。所以这里用 three.js 补了下面几样（火、烟、焦线、立着的冲击环直接用 fx_fx2c 的）：
//   ironChain   一条三维的铁链：一节一节的环（一平一竖交替），沿两点之间（可以下垂）排开；每一节有自己的热度，冷的是黑铁、热的从樱桃红烧到金黄
//   tongs       火钳的钳头：两片弯的厚铁爪铆在一根短柄上，能张开、合上；爪子是烧红的
//   shackle     一个铁环（铁镣扣在脚踝上的那个、手上的那个）
//   forgeCore   炉心：一块表面结着黑壳、裂缝里透出白热的石头，外面一团很淡的光
//   coalBed     一片贴着地形的龟裂炭地：焦黑的壳、壳之间烧红的裂缝和炭块，一明一暗地喘，慢慢凉成黑的再淡掉
//   warnRing    大招落点的预警：一圈暗红的地，边上一道往里收紧的亮线，里面几圈往中心走的热纹
//   wardRing    护火：脚下一圈铆钉铁箍似的暖色光环（贴地，克制）
//   brandMark   烙印：胸口前一枚楔形的烧红铁片（不发光，慢慢凉成黑铁；第四批从头顶挪到胸口，原来夹在头和血条之间，上半截被血条盖住）
//   warmHedda   上面这些的着色器预热（赫达的 passive 第一帧调一次，和 fx_fx2c 的 warm 一样）
// 规矩和特效库一样：几何体只建一次；材质每个技能实例建一个、用完销毁，或者进池子；不在每帧里新建东西。手机档（LITE）粒子少一半由调用的地方管。

import * as THREE from "three";
import type { FxLib, V3 } from "./fxlib";
import { BOUT, FXB, glowBlend, glowOut } from "./fxb";

type Runner = { run: (sec: number, frame: (k: number, dt: number) => void, done?: () => void) => void };
const UP = new THREE.Vector3(0, 1, 0), XA = new THREE.Vector3(1, 0, 0);

// ---------------------------------------------------------------- 共用的着色器片段
/** 铁的热度颜色（sRGB 写的，进着色器前由 THREE.Color 换成线性）：凉的黑铁 → 暗红 → 樱桃红（赫达的辅色 #C0461E）→ 橙 → 炉心金（主色 #FFC864）→ 白热 */
const HEAT = [0x1c1412, 0x6a1a0b, 0xc0461e, 0xff8a34, 0xffc864, 0xfff2d0];
const heatU = () => { const o: Record<string, { value: THREE.Color }> = {}; HEAT.forEach((h, i) => (o["uH" + i] = { value: new THREE.Color(h) })); return o; };
const HEAT_GLSL = /* glsl */ `
  uniform vec3 uH0, uH1, uH2, uH3, uH4, uH5;
  vec3 heat(float h){ vec3 c = mix(uH0, uH1, smoothstep(0.0, 0.22, h)); c = mix(c, uH2, smoothstep(0.18, 0.45, h)); c = mix(c, uH3, smoothstep(0.42, 0.66, h)); c = mix(c, uH4, smoothstep(0.62, 0.85, h)); return mix(c, uH5, smoothstep(0.86, 1.0, h)); }`;
const NOISE = /* glsl */ `
  float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
  float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 3; i++) { s += a * vn(p); p = p * 2.03 + 11.7; a *= 0.5; } return s / 0.875; }
  vec2 h22(vec2 p){ p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
  float voro(vec2 x){ vec2 n = floor(x), f = fract(x); float m1 = 8.0, m2 = 8.0;      // 到最近的两个细胞核的距离差：0 就是在两块之间的缝上
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) { vec2 g = vec2(float(i), float(j)), r = g + h22(n + g) - f; float d = dot(r, r); if (d < m1) { m2 = m1; m1 = d; } else if (d < m2) m2 = d; }
    return sqrt(m2) - sqrt(m1); }`;
/** 预乘透明的混合（同 fx_fx2c）：rgb 已经乘过不透明度；烫的地方 a 小（接近叠加发光），焦黑的壳 a 大（真的压暗地面） */
const premul = { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor } as const;

// ---------------------------------------------------------------- 会发热的铁（链节、钳头、铁环共用）
const IRON_VS = /* glsl */ `
  #ifdef USE_INSTANCING
  attribute float aHeat;
  #endif
  uniform float uHeat, uGrad; varying vec3 vN, vW, vO; varying float vH;
  void main(){
    #ifdef USE_INSTANCING
      mat4 m = modelMatrix * instanceMatrix; vH = aHeat;
    #else
      mat4 m = modelMatrix; vH = uHeat * mix(1.0 - uGrad, 1.0, smoothstep(0.42, 0.74, position.x));      // uGrad：钳爪从根到尖越来越烫（根上是黑铁，尖上烧红）
    #endif
    vec4 wp = m * vec4(position, 1.0); vW = wp.xyz; vO = position; vN = normalize(mat3(m) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp; }`;
const IRON_FS = /* glsl */ `
  uniform float uAlpha; uniform vec3 uIron; varying vec3 vN, vW, vO; varying float vH; ${HEAT_GLSL} ${NOISE}
  void main(){
    // 光从侧上方来（不是正上方）：镜头差不多是往下看的，光要是也从头顶来，平放的那一节整个是高光，铁就成了一片浅灰。侧光下高光只是环上细细的一道
    vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N; vec3 V = normalize(cameraPosition - vW), L = normalize(vec3(-0.62, 0.5, 0.32));
    float dif = 0.38 + 0.62 * max(dot(N, L), 0.0), sp = pow(max(dot(N, normalize(L + V)), 0.0), 48.0), fr = pow(1.0 - max(dot(N, V), 0.0), 2.4);
    float n = vn(vO.xy * 11.0 + vO.z * 7.0);
    // 冷的铁：深灰带一点暖，朝光的一面有一道钢的高光、轮廓一圈淡淡的亮（从俯视看，黑铁在青绿的地上靠这一圈亮边读出形状）
    vec3 c = uIron * dif * (0.75 + 0.5 * n) + vec3(0.8, 0.76, 0.7) * sp * 0.45 + vec3(0.6, 0.55, 0.5) * fr * 0.22;
    float h = clamp(vH * (0.82 + 0.36 * n), 0.0, 1.0), glow = smoothstep(0.05, 0.42, h);
    c = mix(c, heat(h) * (0.62 + 0.55 * dif) + vec3(1.0, 0.86, 0.62) * sp * 0.35, glow);      // 烧红的铁：自己发光，朝光的一面亮一点，不是一片平涂
    gl_FragColor = vec4(c, uAlpha);
    #include <colorspace_fragment>
  }`;
function ironMat(heat = 0, iron = 0x3a3532, grad = 0): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({ uniforms: { uHeat: { value: heat }, uGrad: { value: grad }, uAlpha: { value: 1 }, uIron: { value: new THREE.Color(iron) }, ...heatU() }, vertexShader: IRON_VS, fragmentShader: IRON_FS, transparent: true, side: THREE.DoubleSide });
}

// ---------------------------------------------------------------- 铁链
export interface ChainLook {
  sag?: number;          // 中间往下垂多少米（松着的链子）
  head?: number; tail?: number; hot?: number;      // 头上（b 端）、尾上（a 端）的热度，热度从两头往里退多少米
  base?: number;         // 整条链子的底热度（铁镣绷紧时整条变红）
  shake?: number;        // 绷到快断的时候抖多厉害（米）
  floor?: boolean;       // 垂下来的链子不钻进地里
}
export interface IronChain { set: (a: V3, b: V3, o?: ChainLook) => void; alpha: (v: number) => void; free: () => void; }
let linkGeo: THREE.TorusGeometry | null = null; const MAXL = 90; const chainPool: { m: THREE.InstancedMesh; mat: THREE.ShaderMaterial; heat: THREE.InstancedBufferAttribute }[] = [];
const M4 = new THREE.Matrix4(), PT = new THREE.Vector3(), TG = new THREE.Vector3(), NH = new THREE.Vector3(), BB = new THREE.Vector3(), NB = new THREE.Vector3(), SC = new THREE.Vector3();
/** 一条三维的铁链。size 是链节的大小（1 约 0.4 米一节，岚的骨钩那条细线的两倍粗）。用完 free 还给池子 */
export function ironChain(fx: FxLib, size = 1): IronChain {
  if (!linkGeo) { linkGeo = new THREE.TorusGeometry(0.1, 0.036, 6, 14); linkGeo.scale(1.6, 1, 1); }
  let rec = chainPool.pop();
  if (!rec) { const g = linkGeo.clone(), heat = new THREE.InstancedBufferAttribute(new Float32Array(MAXL), 1); heat.setUsage(THREE.DynamicDrawUsage); g.setAttribute("aHeat", heat);
    const mat = ironMat(0), m = new THREE.InstancedMesh(g, mat, MAXL); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; m.renderOrder = 8; rec = { m, mat, heat }; }
  const R = rec; R.m.count = 0; R.mat.uniforms.uAlpha.value = 1; R.mat.transparent = false; fx.group.add(R.m);
  const pitch = 0.215 * size; let t = Math.random() * 10, dead = false;
  return {
    set(a, b, o = {}) { if (dead) return;
      const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, L = Math.hypot(dx, dy, dz), n = Math.max(1, Math.min(MAXL, Math.ceil(L / pitch))), sag = o.sag ?? 0, hot = Math.max(0.05, o.hot ?? 1.5);
      t += 0.016;
      for (let i = 0; i < n; i++) { const k = (i + 0.5) / n;
        PT.set(a.x + dx * k, a.y + dy * k - sag * 4 * k * (1 - k), a.z + dz * k);
        if (o.floor) PT.y = Math.max(PT.y, fx.ground(PT.x, PT.z) + 0.07 * size);
        TG.set(dx, dy - sag * 4 * (1 - 2 * k), dz); if (TG.lengthSq() < 1e-8) TG.set(1, 0, 0); TG.normalize();
        NH.crossVectors(TG, UP); if (NH.lengthSq() < 1e-6) NH.set(0, 0, 1); NH.normalize(); BB.crossVectors(TG, NH).normalize();      // 右手系（TG × NH = BB）：镜像过的实例三角形的正反面会反过来（实例矩阵没法像普通网格那样自动翻），法线就全朝里了，铁变成一片平平的灰
        if (o.shake) { const s = Math.sin(t * 80 + i * 1.9) * o.shake * Math.sin(Math.PI * k); PT.addScaledVector(NH, s); PT.y += Math.cos(t * 67 + i * 2.3) * o.shake * 0.5 * Math.sin(Math.PI * k); }
        if (i % 2 === 0) M4.makeBasis(TG, NH, BB); else M4.makeBasis(TG, BB, NB.copy(NH).negate());      // 一节平着、一节竖着：从上往下看是“环 — 杠 — 环”（两种摆法的行列式都是 +1）
        M4.scale(SC.set(size, size, size)); M4.setPosition(PT); R.m.setMatrixAt(i, M4);
        const fromHead = L * (1 - k), fromTail = L * k;
        R.heat.setX(i, Math.min(1, (o.base ?? 0) + (o.head ?? 0) * Math.pow(Math.max(0, 1 - fromHead / hot), 1.3) + (o.tail ?? 0) * Math.pow(Math.max(0, 1 - fromTail / hot), 1.3))); }
      R.m.count = n; R.m.instanceMatrix.needsUpdate = true; R.heat.needsUpdate = true; },
    alpha(v) { R.mat.uniforms.uAlpha.value = v; R.mat.transparent = v < 0.999; },
    free() { if (dead) return; dead = true; R.m.removeFromParent(); chainPool.push(R); },
  };
}

// ---------------------------------------------------------------- 火钳的钳头
export interface Tongs { obj: THREE.Group; open: (k: number) => void; heat: (h: number) => void; alpha: (a: number) => void; aim: (pos: V3, dir: V3) => void; back: (out: THREE.Vector3) => THREE.Vector3; free: () => void; }
let jawGeo: THREE.TubeGeometry | null = null, shaftGeo: THREE.CylinderGeometry | null = null, hubGeo: THREE.SphereGeometry | null = null, eyeGeo: THREE.TorusGeometry | null = null;
const tongsPool: { g: THREE.Group; pa: THREE.Group; pb: THREE.Group; hot: THREE.ShaderMaterial; cold: THREE.ShaderMaterial }[] = [];
/** 钳头：朝 +x 伸出去，两片爪在水平面上张合（俯视看得最清楚）。size 1 约 1.3 米长 */
export function tongs(fx: FxLib, size = 1.25): Tongs {
  if (!jawGeo) {
    const pts = [[0, 0, 0.03], [0.16, 0, 0.2], [0.4, 0, 0.27], [0.62, 0, 0.19], [0.75, 0, 0.04], [0.71, 0, -0.07]].map(([x, y, z]) => new THREE.Vector3(x, y, z));
    jawGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 18, 0.072, 7, false);
    shaftGeo = new THREE.CylinderGeometry(0.05, 0.068, 0.62, 8); shaftGeo.rotateZ(Math.PI / 2); shaftGeo.translate(-0.33, 0, 0);
    hubGeo = new THREE.SphereGeometry(0.105, 12, 9); eyeGeo = new THREE.TorusGeometry(0.1, 0.034, 6, 12); eyeGeo.rotateY(Math.PI / 2); eyeGeo.translate(-0.7, 0, 0);      // 柄尾一个铁环，链子从这里接出去
  }
  let rec = tongsPool.pop();
  if (!rec) { const hot = ironMat(0.85, 0x3a3532, 0.8), cold = ironMat(0.12), g = new THREE.Group(), pa = new THREE.Group(), pb = new THREE.Group();
    const ja = new THREE.Mesh(jawGeo, hot), jb = new THREE.Mesh(jawGeo, hot); jb.scale.z = -1; pa.add(ja); pb.add(jb);
    g.add(pa, pb, new THREE.Mesh(shaftGeo!, cold), new THREE.Mesh(hubGeo!, cold), new THREE.Mesh(eyeGeo!, cold));
    g.traverse(o => { o.frustumCulled = false; o.renderOrder = 8; }); rec = { g, pa, pb, hot, cold }; }
  const R = rec, q = new THREE.Quaternion(), d = new THREE.Vector3(); R.g.scale.setScalar(size); R.g.visible = true; fx.group.add(R.g);
  const T: Tongs = {
    obj: R.g,
    open(k) { R.pa.rotation.y = -0.52 * k; R.pb.rotation.y = 0.52 * k; },
    heat(h) { R.hot.uniforms.uHeat.value = h; R.cold.uniforms.uHeat.value = Math.min(0.3, h * 0.08); },
    alpha(a) { for (const m of [R.hot, R.cold]) { m.uniforms.uAlpha.value = a; m.transparent = a < 0.999; } },
    aim(pos, dir) { R.g.position.set(pos.x, pos.y, pos.z); d.set(dir.x, dir.y, dir.z); if (d.lengthSq() > 1e-8) { q.setFromUnitVectors(XA, d.normalize()); R.g.quaternion.copy(q); } },
    back(out) { return out.set(-0.7 * size, 0, 0).applyQuaternion(R.g.quaternion).add(R.g.position); },      // 柄尾那个环的位置（链子接在这儿）
    free() { R.g.removeFromParent(); tongsPool.push(R); },
  };
  T.open(0.6); T.heat(0.85); T.alpha(1); return T;
}

// ---------------------------------------------------------------- 铁环
export interface Shackle { obj: THREE.Mesh; heat: (h: number) => void; alpha: (a: number) => void; free: () => void; }
let ringGeo: THREE.TorusGeometry | null = null;
/** 一个铁环（平放的圆环，半径 1，用 scale 定大小）：铁镣扣在脚踝上的那个 */
export function shackle(fx: FxLib): Shackle {
  ringGeo ??= (() => { const g = new THREE.TorusGeometry(1, 0.16, 7, 28); g.rotateX(Math.PI / 2); return g; })();
  const mat = ironMat(0.6), m = new THREE.Mesh(ringGeo, mat); m.frustumCulled = false; m.renderOrder = 8; fx.group.add(m);
  return { obj: m, heat(h) { mat.uniforms.uHeat.value = h; }, alpha(a) { mat.uniforms.uAlpha.value = a; mat.transparent = a < 0.999; }, free() { m.removeFromParent(); mat.dispose(); } };
}

// ---------------------------------------------------------------- 炉心
let coreGeo: THREE.BufferGeometry | null = null, glowTex: THREE.Texture | null = null;
function softTex(): THREE.Texture {
  if (glowTex) return glowTex;
  const c = document.createElement("canvas"); c.width = c.height = 64; const g = c.getContext("2d")!, gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.35, "rgba(255,255,255,0.45)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c); return glowTex;
}
export interface ForgeCore { obj: THREE.Group; heat: (h: number) => void; alpha: (a: number) => void; glow: (a: number, s?: number) => void; free: () => void; }
/** 炉心：一块不规则的石头（半径 1，用 scale 定大小），黑壳上的裂缝里透出白热；heat 1 时整块都烫得发亮，往下慢慢只剩裂缝红 */
export function forgeCore(fx: FxLib): ForgeCore {
  if (!coreGeo) { const g = new THREE.IcosahedronGeometry(1, 3), p = g.getAttribute("position") as THREE.BufferAttribute, v = new THREE.Vector3();
    const bump = (x: number, y: number, z: number) => Math.sin(x * 3.1 + y * 1.7) * 0.5 + Math.sin(y * 4.3 - z * 2.9) * 0.3 + Math.sin(z * 5.7 + x * 2.2) * 0.2;
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).normalize(); const s = 0.84 + 0.13 * bump(v.x, v.y, v.z) + 0.05 * Math.sin(v.x * 11 + v.z * 9); p.setXYZ(i, v.x * s * 1.1, v.y * s * 0.9, v.z * s); }
    g.computeVertexNormals(); coreGeo = g; }
  const u = { uHeat: { value: 1 }, uAlpha: { value: 1 }, uSeed: { value: Math.random() * 20 }, ...heatU() };
  const mat = new THREE.ShaderMaterial({ uniforms: u, transparent: true,
    vertexShader: /* glsl */ `varying vec3 vN, vW, vO; void main(){ vO = position; vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */ `uniform float uHeat, uAlpha, uSeed; varying vec3 vN, vW, vO; ${HEAT_GLSL} ${NOISE}
      void main(){ vec3 N = normalize(vN), V = normalize(cameraPosition - vW); float dif = 0.35 + 0.65 * max(dot(N, normalize(vec3(-0.45, 0.8, 0.4))), 0.0), fr = pow(1.0 - max(dot(N, V), 0.0), 2.0);
        vec2 q = vO.xy * 2.1 + vec2(vO.z * 1.7 + uSeed, -vO.z * 1.3); float n = fbm(q * 1.4), cr = 1.0 - smoothstep(0.0, 0.11, voro(q * 1.3)), cr2 = (1.0 - smoothstep(0.0, 0.07, voro(q * 2.9 + 3.0))) * 0.7;
        float crack = max(cr, cr2), H = clamp(uHeat, 0.0, 1.0);
        vec3 crust = vec3(0.05, 0.035, 0.03) * dif * (0.8 + 0.6 * n);
        vec3 c = mix(crust, heat(H * 0.62) * (0.6 + 0.5 * dif), smoothstep(0.55, 1.0, H) * (0.55 + 0.45 * n));      // 刚掏出来的时候壳也烫得发红，凉下来只剩裂缝
        c = mix(c, heat(min(1.0, H * (0.9 + 0.25 * n))), crack * smoothstep(0.02, 0.25, H));
        c += heat(H * 0.8) * fr * H * 0.6;                                                                             // 轮廓一圈热光
        gl_FragColor = vec4(c, uAlpha);
        #include <colorspace_fragment>
      }` });
  const m = new THREE.Mesh(coreGeo, mat); m.frustumCulled = false; m.renderOrder = 8;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex(), color: 0xffb04a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5 })); sp.scale.setScalar(4); sp.renderOrder = 9;
  const g = new THREE.Group(); g.add(m, sp); fx.group.add(g);
  return { obj: g, heat(h) { u.uHeat.value = h; }, alpha(a) { u.uAlpha.value = a; },
    glow(a, s = 4) { sp.material.opacity = a; sp.scale.setScalar(s); sp.visible = a > 0.004; },
    free() { g.removeFromParent(); mat.dispose(); sp.material.dispose(); } };
}

// ---------------------------------------------------------------- 贴着地形的一块（炭地、预警、光环共用）
const grids = new Map<number, THREE.PlaneGeometry>();
interface GroundPatch { mesh: THREE.Mesh; set: (x: number, z: number) => void; free: () => void; }
function groundPatch(fx: FxLib, mat: THREE.ShaderMaterial, x: number, z: number, r: number, N: number, lift: number, order: number): GroundPatch {
  let base = grids.get(N); if (!base) { base = new THREE.PlaneGeometry(2, 2, N, N); base.rotateX(-Math.PI / 2); grids.set(N, base); }
  const geo = base.clone(), P = geo.getAttribute("position") as THREE.BufferAttribute, B = base.getAttribute("position");
  const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.renderOrder = order; m.scale.set(r, 1, r); fx.group.add(m);
  let lx = NaN, lz = NaN;
  const set = (px: number, pz: number) => { const y0 = fx.ground(px, pz); m.position.set(px, y0, pz); if (Math.hypot(px - lx, pz - lz) < 0.25) return; lx = px; lz = pz;      // 挪得不多就不重新贴（一张网几百个点）
    for (let i = 0; i < P.count; i++) { const ox = B.getX(i) * r, oz = B.getZ(i) * r; P.setY(i, fx.ground(px + ox, pz + oz) + lift - y0); } P.needsUpdate = true; };
  set(x, z);
  return { mesh: m, set, free() { m.removeFromParent(); geo.dispose(); mat.dispose(); } };
}
const PATCH_VS = /* glsl */ `varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

// ---------------------------------------------------------------- 炭地
export interface CoalBed { heat: (h: number) => void; alpha: (a: number) => void; grow: (k: number) => void; free: () => void; }
/** 一片龟裂的炭地（大招落点留下的）：焦黑的壳一块一块，壳之间的缝和一些炭块烧得通红、一明一暗；heat 从 1（白热的缝）凉到 0（只剩黑壳）；grow 是从中心铺开到多大 */
export function coalBed(fx: FxLib, x: number, z: number, r: number): CoalBed {
  const u = { uTime: { value: 0 }, uHeat: { value: 1 }, uAlpha: { value: 1 }, uGrow: { value: 0 }, uR: { value: r }, uSeed: { value: Math.random() * 30 }, ...heatU() };
  const mat = new THREE.ShaderMaterial({ ...premul, uniforms: u, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, vertexShader: PATCH_VS,
    fragmentShader: /* glsl */ `uniform float uTime, uHeat, uAlpha, uGrow, uR, uSeed; varying vec2 vP; ${HEAT_GLSL} ${NOISE}
      void main(){ float r = length(vP), n = fbm(vP * 3.2 + uSeed);
        float edge = 1.0 - smoothstep(0.78, 1.0, r + (n - 0.5) * 0.3), grow = 1.0 - smoothstep(uGrow - 0.18, uGrow, r + (n - 0.5) * 0.12);
        if (edge * grow < 0.004) discard;
        // 裂缝：两层大小不一的龟裂（缝宽跟着噪声变，越往边上越少、越细），壳里几块还烧着的炭（中间多）。第一版只有一层大块，像一张规整的网
        vec2 q = vP * uR * 1.2 + uSeed + vec2(fbm(vP * 2.0 + uSeed) - 0.5) * 1.6; float v1 = voro(q), v2 = voro(q * 2.3 + 5.0), wv = 0.045 + 0.07 * fbm(q * 0.7 + 3.0), rim = 1.0 - smoothstep(0.45, 0.98, r);
        float crack = (1.0 - smoothstep(0.0, wv, v1)) * (0.55 + 0.45 * n) * (0.35 + 0.65 * rim), fine = (1.0 - smoothstep(0.0, 0.035, v2)) * 0.5 * rim;
        float coal = smoothstep(0.58, 0.8, fbm(q * 0.5 + 7.0)) * (0.4 + 0.6 * rim);
        float breath = 0.72 + 0.28 * sin(uTime * 2.6 + n * 9.0), centre = 1.0 - smoothstep(0.0, 0.75, r) * 0.35;      // 一明一暗地喘；中间比边上烫
        float H = uHeat * centre, h = clamp(H * (max(crack, fine) * (0.78 + 0.3 * breath) + coal * 0.42 * breath), 0.0, 1.0), hot = smoothstep(0.03, 0.26, h);
        float a = edge * grow * (0.4 + 0.16 * n) * (1.0 - 0.3 * smoothstep(0.45, 1.0, r)) * uAlpha;                 // 焦黑的壳：压暗地面（预乘透明，真的挡住）。第四批 polish-new：0.66～0.84 → 0.4～0.56，原来是一大块压死的黑盘子
        vec3 rgb = vec3(0.07, 0.045, 0.035) * (0.7 + 0.6 * n) * a + heat(h) * hot * (0.5 + 0.75 * h) * edge * grow * uAlpha;      // 壳是烧过的深褐灰，不是纯黑
        gl_FragColor = vec4(rgb, a * (1.0 - 0.35 * hot));
        #include <colorspace_fragment>
      }` });
  const p = groundPatch(fx, mat, x, z, r, 34, 0.07, 5.7), t0 = fx.time();
  p.mesh.onBeforeRender = () => { u.uTime.value = fx.time() - t0; };
  return { heat(h) { u.uHeat.value = h; }, alpha(a) { u.uAlpha.value = a; }, grow(k) { u.uGrow.value = k; }, free: p.free };
}

// ---------------------------------------------------------------- 预警圈
export interface WarnRing { k: (v: number) => void; alpha: (a: number) => void; free: () => void; }
/** 大招落点的预警：暗红的一片地，边上一道亮线从 1.25 倍的半径收紧到正好的范围（k 从 0 到 1），里面几圈热纹往中心走。敌我都看得见 */
export function warnRing(fx: FxLib, x: number, z: number, r: number): WarnRing {
  const u = { uTime: { value: 0 }, uK: { value: 0 }, uAlpha: { value: 0 }, uSeed: { value: Math.random() * 30 }, ...heatU() };
  const mat = new THREE.ShaderMaterial({ ...premul, uniforms: u, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, vertexShader: PATCH_VS,
    fragmentShader: /* glsl */ `uniform float uTime, uK, uAlpha, uSeed; varying vec2 vP; ${HEAT_GLSL} ${NOISE}
      void main(){ vec2 p = vP * 1.3; float r = length(p), th = atan(p.y, p.x);
        float ring = mix(1.22, 1.0, 1.0 - pow(1.0 - uK, 2.0)), jag = (vn(vec2(th * 9.0 + uSeed, uTime * 4.0)) - 0.5) * 0.035, rr = r + jag;
        if (rr > ring + 0.12) discard;
        float inside = 1.0 - smoothstep(ring - 0.008, ring + 0.008, rr);
        float line = exp(-pow((rr - ring) / 0.011, 2.0)), band = exp(-pow((rr - ring + 0.04) / 0.045, 2.0)) * inside;
        float rip = pow(max(0.0, sin(r * 15.0 + uTime * 11.0)), 10.0) * inside * smoothstep(0.1, 0.9, r) * (0.3 + 0.7 * uK);      // 往中心收的热纹
        float fill = inside * (0.5 + 0.22 * uK) * (0.8 + 0.2 * vn(p * 6.0 + uSeed));
        // （第一版亮线里面还有一道宽的亮带，近看像一圈发光的管子，太重；现在只剩一道细亮线，里面是压暗的暗红地和往里收的细热纹）
        // 第四批 polish-new：里面原来只压暗两三成、加的红在输出时被转成 sRGB 提亮，和青绿的地一混成了浅褐（试过加更多红，成了不透明的肉粉色）。
        // 现在反过来：加的红很暗（线性 0.12 × fill），靠更实的压暗（0.55～0.85）把青绿盖住，剩下的就是一片暗红的地；热纹淡一档
        vec3 rgb = vec3(0.12, 0.008, 0.003) * fill + heat(0.7) * line * 0.95 + heat(0.45) * band * 0.06 + heat(0.4) * rip * 0.12;
        float a = (min(0.78, fill * 1.2) * (0.8 + 0.2 * smoothstep(0.3, 1.0, r)) + line * 0.3 + band * 0.05) * uAlpha;      // 靠边更实、中间透一点地面：有形状，不是一块平涂的砖红
        gl_FragColor = vec4(rgb * uAlpha, a);
        #include <colorspace_fragment>
      }` });
  const p = groundPatch(fx, mat, x, z, r * 1.3, 30, 0.1, 6.2), t0 = fx.time();      // 网比范围大三成（着色器里 p = vP * 1.3，1 就是范围的边）：收紧前的那圈线画在范围外面
  p.mesh.onBeforeRender = () => { u.uTime.value = fx.time() - t0; };
  return { k(v) { u.uK.value = v; }, alpha(a) { u.uAlpha.value = a; }, free: p.free };
}

// ---------------------------------------------------------------- 护火的光环
export interface WardRing { set: (x: number, z: number) => void; alpha: (a: number) => void; free: () => void; }
/** 脚下一圈暖色的铁箍：一道金边、一道细的内圈、八颗铆钉，里面很淡的一层暖光；慢慢转。出现时从大往里一收 */
export function wardRing(fx: FxLib, x: number, z: number, r: number): WardRing {
  const u = { uTime: { value: 0 }, uIn: { value: 0 }, uAlpha: { value: 0 }, ...heatU() };
  const mat = new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false, ...glowBlend(), polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, vertexShader: PATCH_VS,
    fragmentShader: /* glsl */ `uniform float uTime, uIn, uAlpha; varying vec2 vP; ${HEAT_GLSL} ${FXB.on ? BOUT : ""}
      void main(){ float r = length(vP) * mix(1.4, 1.0, uIn), th = atan(vP.y, vP.x) + uTime * 0.6;
        float rim = exp(-pow((r - 0.9) / 0.028, 2.0)), rim2 = exp(-pow((r - 0.72) / 0.014, 2.0)) * 0.55;
        float cell = fract(th / 6.2832 * 8.0), dd = length(vec2((cell - 0.5) * 0.81 * 6.2832 / 8.0, r - 0.81)), rivet = 1.0 - smoothstep(0.022, 0.04, dd);
        float fill = (1.0 - smoothstep(0.2, 0.9, r)) * 0.1 + exp(-pow((r - 0.86) / 0.1, 2.0)) * 0.12;
        float a = (rim * 0.75 + rim2 + rivet * 0.8 + fill) * uAlpha; if (a < 0.004) discard;
        vec3 c = mix(heat(0.74), heat(0.95), rim * 0.6 + rivet * 0.5);
        ${glowOut("c", "a")}
      }` });
  const p = groundPatch(fx, mat, x, z, r, 12, 0.11, 6.4), t0 = fx.time();
  p.mesh.onBeforeRender = () => { const t = fx.time() - t0; u.uTime.value = t; u.uIn.value = 1 - Math.pow(1 - Math.min(1, t / 0.22), 3); };
  return { set: p.set, alpha(a) { u.uAlpha.value = a; }, free: p.free };
}

// ---------------------------------------------------------------- 烙印
let brandTex: THREE.Texture | null = null;
/** 一枚楔形的铁片（往下尖的五边形），中间压出一个铁砧的印：边是亮的、中间暗一档、印子最暗。颜色由 SpriteMaterial 的 color 染 */
function brandTexture(): THREE.Texture {
  if (brandTex) return brandTex;
  const S = 128, c = document.createElement("canvas"); c.width = c.height = S; const g = c.getContext("2d")!;
  const wedge = (k: number) => { g.beginPath(); const P = [[0.16, 0.12], [0.84, 0.12], [0.9, 0.42], [0.5, 0.94], [0.1, 0.42]]; P.forEach(([x, y], i) => { const X = (0.5 + (x - 0.5) * k) * S, Y = (0.52 + (y - 0.52) * k) * S; if (i) g.lineTo(X, Y); else g.moveTo(X, Y); }); g.closePath(); };
  g.fillStyle = "rgba(20,16,14,0.9)"; wedge(1.12); g.fill();                     // 外面一圈暗边：不管落在什么背景上都看得出轮廓
  g.fillStyle = "#ffffff"; wedge(1); g.fill();
  g.fillStyle = "#9a9a9a"; wedge(0.76); g.fill();
  g.fillStyle = "#3a3a3a"; g.beginPath();                                      // 铁砧的印
  g.moveTo(0.3 * S, 0.34 * S); g.lineTo(0.74 * S, 0.34 * S); g.quadraticCurveTo(0.7 * S, 0.43 * S, 0.6 * S, 0.45 * S); g.lineTo(0.58 * S, 0.56 * S); g.lineTo(0.66 * S, 0.62 * S); g.lineTo(0.36 * S, 0.62 * S); g.lineTo(0.44 * S, 0.56 * S); g.lineTo(0.42 * S, 0.45 * S); g.quadraticCurveTo(0.34 * S, 0.43 * S, 0.3 * S, 0.34 * S); g.fill();
  brandTex = new THREE.CanvasTexture(c); brandTex.colorSpace = THREE.SRGBColorSpace; return brandTex;
}
export interface BrandMark { set: (x: number, y: number, z: number) => void; heat: (h: number) => void; alpha: (a: number) => void; free: () => void; }
const C0 = new THREE.Color(), C1 = new THREE.Color(0x2a221e), C2 = new THREE.Color(0xc0461e), C3 = new THREE.Color(0xff9a46);
export function brandMark(fx: FxLib, size = 0.46): BrandMark {
  const mat = new THREE.SpriteMaterial({ map: brandTexture(), transparent: true, depthWrite: false, depthTest: false }), sp = new THREE.Sprite(mat); sp.scale.setScalar(size); sp.renderOrder = 11; fx.group.add(sp);
  return { set(x, y, z) { sp.position.set(x, y, z); },
    heat(h) { if (h > 0.5) C0.copy(C2).lerp(C3, (h - 0.5) * 2); else C0.copy(C1).lerp(C2, h * 2); mat.color.copy(C0); },      // 1 橙红（刚烙上）→ 0.5 樱桃红 → 0 黑铁
    alpha(a) { mat.opacity = a; }, free() { sp.removeFromParent(); mat.dispose(); } };
}

// ---------------------------------------------------------------- 预热
const warmed = new WeakSet<FxLib>();
/** 每样零件先出一个埋在地下的、一闪就收，让着色器在对局开头编好（第一次放技能不卡一下） */
export function warmHedda(fx: FxLib, api: Runner, x: number, z: number) {
  if (warmed.has(fx)) return; warmed.add(fx);
  const y = fx.ground(x, z) - 40, a = { x, y, z }, b = { x: x + 1, y, z };
  const ch = ironChain(fx); ch.set(a, b); const tg = tongs(fx); tg.aim(a, b); const sh = shackle(fx); sh.obj.position.set(x, y, z);
  const co = forgeCore(fx); co.obj.position.set(x, y, z); const bm = brandMark(fx); bm.set(x, y, z); bm.alpha(0);
  const cb = coalBed(fx, x, z, 0.5), wr = warnRing(fx, x, z, 0.5), wd = wardRing(fx, x, z, 0.5);      // 这三样一开始就是看不见的（铺开 0、透明 0）
  api.run(0.2, () => {}, () => { ch.free(); tg.free(); sh.free(); co.free(); bm.free(); cb.free(); wr.free(); wd.free(); });
}
