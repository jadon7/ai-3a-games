// 第九轮 k-seren：塞伦（珠铳，沉月会射手）技能特效自己的零件。现在只有塞伦用；pearl、line 是通用的形状，合并时可以搬进 fxlib。
//
// 塞伦和薇萝都是射手、都“以线为主”，但质感要一眼分开：薇萝是烬誓庭的火（白热的芯、橙边、烧成黑烟），塞伦是珍珠、贝壳、海水——
//   弹头是一颗有珍珠母虹光的珠子（不是火光），弹道是一道白的水线（白芯、淡海色的身子、两边垫一层深海蓝），出膛是一团白色水汽，命中溅的是水珠。
//   珊瑚橙 #F07C5E 是她在沉月会里唯一的暖色，只用在“压”上：满潮弹水线的边、压力罐上的刻度、大招打中的那一圈、定身硬壳的边。
// 和 fx2a 的发现一样：测试场和河道的地面是青绿的，浅色的东西直接叠上去没有反差，所以线和印记底下都垫一层深海蓝，靠明暗读清楚，不靠更亮。
//
//   pearl   一颗珍珠：珍珠母的虹光（看的角度一变颜色就在粉、金、青之间走），顶上一点高光。弹头、珍珠雷、大招的那颗都是它
//   line    两点之间一道正对镜头的水线：白芯、淡色的身子、两边一层压暗的深色。可以按“离弹头多远 = 多老”让尾巴由宽变细地散掉（大招）
//   swirl   大招蓄力时铳口前一圈立着的水旋（和弹道垂直，三道旋臂往里卷、越蓄越紧越亮）。第四批 polish-new 换掉了原来正对镜头的月盘（俯视像一个肥皂泡）
//   dot     一团正对镜头的小光（叠加发光，小亮芯 + 很快衰减的晕），底下可以垫一团暗：弹头、铳口的“压力阀”
//   lane    大招的预警线：贴地的一条带子，两边细线，蓄力时一道亮的前沿从脚下推到 24 米外的尽头（敌人也看得见）
//   shell   定身的硬壳：脚下一块扇贝纹的珍珠母壳，珊瑚色的边，到时间先裂开再一块块碎掉
//   mine    珍珠雷：一颗珍珠坐在一圈张开的六瓣贝壳里（第四批放大、加了贝壳：原来俯视只是一颗白珠），一圈青铜的箍
//   skid    反冲往后滑的滑痕：贴地的一条湿印，两边断续的白沫，刚划出来的一截中间亮一道，跟着人画出去，之后一块块蚀掉（第四批：fx2a 的水痕身子只有三成，滑痕太淡）
//   trap    珍珠雷的触发范围：贴地的一圈细水线（六颗小珠分成六段），生效时画出来，之后很淡地留着（敌人细看看得见）
// 规矩照 fxlib：几何体只建一次，材质进池子或者共用一份；动画用 api.run 推（对局时间：暂停、顿帧跟着停）；手机档粒子在 fxlib 里已经减半。

import * as THREE from "three";
import type { Api } from "./skills";
import type { FxLib, V3 } from "./fxlib";
import { FXB } from "./fxb";

type U = Record<string, { value: any }>;
type Run = { run: Api["run"] };
const NOISE = /* glsl */ `
  float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
  float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 3; i++) { s += a * vn(p); p = p * 2.03 + 11.7; a *= 0.5; } return s / 0.875; }
`;
/** 珍珠母的虹光：h 走一圈，颜色在暖粉、浅金、青白之间转（饱和度压得很低，是“泛光”，不是彩虹） */
const NACRE = /* glsl */ `vec3 nacre(float h){ vec3 c = 0.5 + 0.5 * cos(6.2832 * (h + vec3(0.0, 0.33, 0.67))); return mix(vec3(0.93, 0.91, 0.87), c, 0.32); }`;
const premul = { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor } as const;
const col = (c: number) => new THREE.Color(c);
const clock = { value: 0 };                                          // 这些零件共用的时钟：画之前对一次特效库的时间
const tick = (fx: FxLib) => () => { clock.value = fx.time(); };

// ---------------------------------------------------------------- pearl：一颗珍珠
let pearlGeo: THREE.SphereGeometry | null = null, pearlMat: THREE.ShaderMaterial | null = null;
const pearlPool: THREE.Mesh[] = [];
function pearlMaterial(): THREE.ShaderMaterial {
  return pearlMat ??= new THREE.ShaderMaterial({ uniforms: { uTime: clock },
    vertexShader: /* glsl */ `varying vec3 vN, vV, vP; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vP = position; vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `uniform float uTime; varying vec3 vN, vV, vP; ${NACRE}
      void main(){ vec3 N = normalize(vN), V = normalize(vV); float f = 1.0 - max(0.0, dot(N, V));
        vec3 c = nacre(f * 1.4 + N.y * 0.3 + vP.x * 0.6 + uTime * 0.12);                       // 薄膜干涉：边上转得快，正对着看是乳白
        vec3 L = normalize(vec3(0.35, 1.0, 0.2)); float dif = 0.62 + 0.38 * max(0.0, dot(N, L)), sp = pow(max(0.0, dot(reflect(-V, N), L)), 36.0);
        c = c * dif + vec3(1.0) * sp * 0.85 + vec3(0.9, 0.97, 1.0) * pow(f, 3.0) * 0.35;      // 一点高光、一圈很淡的边光（俯视时和地面分得开）
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }` });
}
export interface Pearl { obj: THREE.Mesh; free: () => void; }
/** 一颗珍珠（半径 r 米）。拿去以后自己 obj.position.set，用完 free */
export function pearl(fx: FxLib, r: number): Pearl {
  pearlGeo ??= new THREE.SphereGeometry(1, 18, 12);
  let m = pearlPool.pop(); if (!m) { m = new THREE.Mesh(pearlGeo, pearlMaterial()); m.frustumCulled = false; m.renderOrder = 8; m.onBeforeRender = tick(fx); }
  const mesh = m; mesh.scale.setScalar(r); mesh.visible = true; mesh.rotation.set(0, 0, 0); fx.group.add(mesh);
  return { obj: mesh, free() { mesh.removeFromParent(); pearlPool.push(mesh); } };
}

// ---------------------------------------------------------------- line：水线
let lineGeo: THREE.BufferGeometry | null = null; const linePool: { m: THREE.Mesh; u: U }[] = [];
export interface LineOpts { width: number; core?: number; color?: number; color2?: number; deep?: number; taper?: number; thin?: number; age?: number; glow?: number; occ?: number; }
export interface Line { set: (tail: V3, head: V3) => void; alpha: (a: number) => void; width: (w: number) => void; age0: (v: number) => void; free: () => void; }
/** 一道水线：width 外层多宽（米），core 白芯占几成，color 芯的颜色（白），color2 身子的颜色，deep 两边垫的深色；taper 尾巴淡得多快，thin 尾巴细到几成。
 *  age 给了（=1/(速度×寿命)）就按“离头多远 = 多老”算：尾巴越老越细越淡，age0 再整体往老里推（弹头没了以后整条线散掉） */
export function line(fx: FxLib, o: LineOpts): Line {
  if (!lineGeo) { const P: number[] = [], I: number[] = [], S = 24; for (let i = 0; i <= S; i++) { P.push(-1, i / S, 0, 1, i / S, 0); if (i < S) { const k = i * 2; I.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); } }
    lineGeo = new THREE.BufferGeometry(); lineGeo.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); lineGeo.setIndex(I); }
  let rec = linePool.pop();
  if (!rec) {
    const u: U = { uA: { value: new THREE.Vector3() }, uB: { value: new THREE.Vector3() }, uW: { value: 0.3 }, uThin: { value: 0.3 }, uAgeK: { value: 0 }, uAge0: { value: 0 }, uAgeOn: { value: 0 }, uTaper: { value: 1 }, uCore: { value: 0.3 }, uAlpha: { value: 1 }, uGlow: { value: 1 }, uOcc: { value: 0.22 }, uC1: { value: col(0xffffff) }, uC2: { value: col(0xffffff) }, uD: { value: col(0) }, uTime: clock };
    const m = new THREE.Mesh(lineGeo, new THREE.ShaderMaterial({ ...premul, transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: u,
      vertexShader: /* glsl */ `uniform vec3 uA, uB; uniform float uW, uThin, uAgeK, uAge0, uAgeOn; varying vec2 vUv; varying float vLife;
        void main(){ float y = position.y; vUv = vec2(position.x * 0.5 + 0.5, y);
          vec3 w = mix(uA, uB, y), t = uB - uA; vec4 mv = viewMatrix * vec4(w, 1.0); vec3 tv = (viewMatrix * vec4(t, 0.0)).xyz, sd = cross(tv, mv.xyz); float l = length(sd); sd = l > 1e-5 ? sd / l : vec3(1.0, 0.0, 0.0);
          float life = mix(1.0, clamp(1.0 - ((1.0 - y) * uAgeK + uAge0), 0.0, 1.0), uAgeOn); vLife = life;
          float wf = mix(uThin, 1.0, pow(y, 0.6)) * mix(1.0, 0.2 + 0.8 * life, uAgeOn);      // 头宽、往尾巴收细；按老的算时越老越细
          mv.xyz += sd * position.x * uW * 0.5 * wf; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `uniform vec3 uC1, uC2, uD; uniform float uAlpha, uTaper, uCore, uAgeOn, uTime, uGlow, uOcc; varying vec2 vUv; varying float vLife; ${NOISE}
        void main(){ float x = abs(vUv.x - 0.5) * 2.0, y = vUv.y;
          float along = pow(y, uTaper) * (1.0 - smoothstep(0.985, 1.0, y) * 0.6) * mix(1.0, vLife * vLife, uAgeOn);
          float n = vn(vec2(y * 14.0 - uTime * 9.0, x * 2.0));                                   // 水是流的：身子上一点顺着走的浓淡
          float core = exp(-pow(x / uCore, 2.0)), body = exp(-x * x * 4.0) * (0.75 + 0.35 * n);
          vec3 c = mix(uC2 * body, uC1, core); float glow = (core * 0.95 + body * 0.4) * uGlow;
          float dark = (1.0 - smoothstep(0.55, 1.0, x)) * (1.0 - body * 0.7) * 0.45;      // 两边垫一层深色：浅色的水线落在青绿的地上也读得出来
          float a = along * uAlpha; if (a < 0.004) discard;
          gl_FragColor = vec4((c * glow + uC2 * body * uOcc * 0.8 + uD * dark) * a, (dark + body * uOcc) * a);      // 预乘透明：白芯接近叠加发光，身子有一点实体（水不是光；occ 越大越像一股水、越不像一道光）
          #include <colorspace_fragment>
        }` }));
    m.frustumCulled = false; m.renderOrder = 9; m.onBeforeRender = tick(fx); rec = { m, u };
  }
  const R = rec, u = R.u; u.uW.value = o.width; u.uCore.value = o.core ?? 0.3; u.uTaper.value = o.taper ?? 1.2; u.uThin.value = o.thin ?? 0.3; u.uAlpha.value = 1; u.uGlow.value = o.glow ?? 1; u.uOcc.value = o.occ ?? 0.22; u.uAgeOn.value = o.age ? 1 : 0; u.uAgeK.value = 0; u.uAge0.value = 0;
  (u.uC1.value as THREE.Color).set(o.color ?? 0xf6fffd); (u.uC2.value as THREE.Color).set(o.color2 ?? 0xbfe9e4); (u.uD.value as THREE.Color).set(o.deep ?? 0x0e2a40);
  R.m.visible = false; fx.group.add(R.m); let gone = false;
  return {
    set(t, h) { if (gone) return; const len = Math.hypot(h.x - t.x, h.y - t.y, h.z - t.z); R.m.visible = len > 0.03; (u.uA.value as THREE.Vector3).set(t.x, t.y, t.z); (u.uB.value as THREE.Vector3).set(h.x, h.y, h.z); if (o.age) u.uAgeK.value = len * o.age; },
    alpha(a) { u.uAlpha.value = a; }, width(w) { u.uW.value = w; }, age0(v) { u.uAge0.value = v; },
    free() { if (gone) return; gone = true; R.m.removeFromParent(); linePool.push(R); },
  };
}

// ---------------------------------------------------------------- dot：一团正对镜头的小光（弹头、铳口），底下可以垫一团暗
// 第四批 polish-new：普攻原来只有一颗半径 0.13 的珠子和一道 0.34 米宽的水线，游戏镜头（27 米远）里只剩十几个像素的一道细白线。
// 弹头加一团小光（亮芯很小、晕很快衰减：远看是“一颗亮珠”，不是一团雾），底下垫一团深海蓝（亮草地上也读得出来）
let dotTex: THREE.CanvasTexture | null = null, shadeTex: THREE.CanvasTexture | null = null;
function radialTex(f: (r: number) => number, N = 96) {
  const cv = document.createElement("canvas"); cv.width = cv.height = N; const c = cv.getContext("2d")!, im = c.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const u = (x + 0.5) / N * 2 - 1, v = (y + 0.5) / N * 2 - 1, r = Math.hypot(u, v), k = (y * N + x) * 4; im.data[k] = im.data[k + 1] = im.data[k + 2] = 255; im.data[k + 3] = Math.round(Math.max(0, Math.min(1, f(r)) * (1 - Math.max(0, (r - 0.85) / 0.15))) * 255); }
  c.putImageData(im, 0, 0); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const dotPool: { s: THREE.Sprite; m: THREE.SpriteMaterial; dark: boolean }[] = [];
export interface Dot { set: (p: V3, size: number, alpha: number) => void; free: () => void; }
/** 一团小光（dark 为 true 时是一团普通混合的暗，垫在光的底下）。每帧 set 位置、大小（米）、不透明度，用完 free */
export function dot(fx: FxLib, color: number, dark = false): Dot {
  dotTex ??= radialTex(r => Math.exp(-r * r * 55) * 1.1 + Math.exp(-r * r * 8) * 0.38 + Math.exp(-r * r * 2.5) * 0.08);
  shadeTex ??= radialTex(r => Math.exp(-r * r * 3.2));
  let i = dotPool.findIndex(d => d.dark === dark), R = i >= 0 ? dotPool.splice(i, 1)[0] : null;
  if (!R) { const m = new THREE.SpriteMaterial({ map: dark ? shadeTex : dotTex, blending: dark ? THREE.NormalBlending : THREE.AdditiveBlending, depthWrite: false, transparent: true }), s = new THREE.Sprite(m); s.frustumCulled = false; s.renderOrder = dark ? 8.4 : 9.4; R = { s, m, dark }; }
  const D = R; D.m.color.set(color); D.m.opacity = 0; D.s.visible = true; fx.group.add(D.s); let live = true;
  return { set(p, size, a) { if (!live) return; D.s.position.set(p.x, p.y, p.z); D.s.scale.setScalar(Math.max(0.001, size)); D.m.opacity = Math.max(0, Math.min(1, a)); },
    free() { if (!live) return; live = false; D.s.visible = false; D.s.removeFromParent(); dotPool.push(D); } };
}

// ---------------------------------------------------------------- swirl：大招蓄力时铳口前一圈立着的水旋
// 原来是正对镜头的珍珠母月盘：从哪看都是一个圆片，俯视像一个肥皂泡。现在是和弹道垂直的一圈环（俯视是一道竖着的椭圆，看得出“朝前”），
// 环上三道旋臂往里卷（水被吸进铳口），越蓄半径越小、旋得越快、边越亮；中间那颗越长越大的珍珠是 pearl。画在模型前面（铳口常被肩甲挡一半）
let swirlGeo: THREE.RingGeometry | null = null; const swirlPool: { m: THREE.Mesh; u: U }[] = [];
export interface Swirl { set: (p: V3, dir: V3, r: number, k: number, alpha: number) => void; free: () => void; }
export function swirl(fx: FxLib, color = 0xf6fffd, color2 = 0xbfe9e4, deep = 0x0e2a40): Swirl {
  swirlGeo ??= new THREE.RingGeometry(0.5, 1, 56, 2);      // 内径 0.5：旋臂留在珍珠外面（第一版内径 0.28，旋臂画在珍珠上，像一根棒棒糖）
  let rec = swirlPool.pop();
  if (!rec) { const u: U = { uK: { value: 0 }, uAlpha: { value: 0 }, uSpin: { value: 0 }, uA: { value: col(0xffffff) }, uB: { value: col(0xffffff) }, uD: { value: col(0) }, uTime: clock };
    const m = new THREE.Mesh(swirlGeo, new THREE.ShaderMaterial({ ...premul, transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide, uniforms: u,
      vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `uniform float uK, uAlpha, uSpin, uTime; uniform vec3 uA, uB, uD; varying vec2 vP; ${NOISE}
        void main(){ float r = length(vP), th = atan(vP.y, vP.x), t = (r - 0.5) / 0.5;
          float arm = fract(th / 6.2832 * 3.0 + t * (0.9 + 0.6 * uK) + uSpin);                       // 三道往里卷的旋臂
          float a1 = smoothstep(0.0, 0.18, arm) * (1.0 - smoothstep(0.32, 0.62, arm));
          float n = 0.75 + 0.25 * vn(vec2(th * 5.0 - uSpin * 6.0, r * 4.0));
          float fade = smoothstep(0.0, 0.25, t) * (1.0 - smoothstep(0.7, 1.0, t));
          float rim = exp(-pow((t - 0.9) / 0.06, 2.0)) * (0.35 + 0.65 * uK);                         // 外沿一道细亮边：蓄得越满越亮
          float body = a1 * fade * n;
          float dark = (1.0 - smoothstep(0.0, 0.5, abs(t - 0.55))) * 0.22;                            // 一层很淡的深色垫底：白的水旋落在亮地面上也有轮廓
          vec3 c = mix(uB, uA, smoothstep(0.3, 0.9, body + rim)); float glow = body * (0.55 + 0.45 * uK) + rim * 0.8;
          glow = body * (0.8 + 0.5 * uK) + rim * 0.6;
          float a = (body * 0.7 + rim * 0.3 + dark) * uAlpha; if (a < 0.004) discard;
          gl_FragColor = vec4((c * glow + uD * dark) * uAlpha, a);
          #include <colorspace_fragment>
        }` }));
    m.frustumCulled = false; m.renderOrder = 9.5; m.onBeforeRender = tick(fx); rec = { m, u }; }
  const R = rec, u = R.u; (u.uA.value as THREE.Color).set(color); (u.uB.value as THREE.Color).set(color2); (u.uD.value as THREE.Color).set(deep); u.uAlpha.value = 0; R.m.visible = true; fx.group.add(R.m); let gone = false, spin = 0, last = -1;
  return { set(p, d, r, k, a) { if (gone) return; R.m.position.set(p.x, p.y, p.z); R.m.lookAt(p.x + d.x, p.y + d.y, p.z + d.z); R.m.scale.setScalar(Math.max(0.01, r)); u.uK.value = k; u.uAlpha.value = a;
      const t = fx.time(); if (last >= 0) spin += (t - last) * (0.8 + 3.2 * k); last = t; u.uSpin.value = spin; },      // 越蓄转得越快（累加，不用“时间 × 速度”：速度一变会跳）
    free() { if (gone) return; gone = true; R.m.visible = false; R.m.removeFromParent(); swirlPool.push(R); } };
}

// ---------------------------------------------------------------- halo：套在弹道上的一圈冲击环
let haloGeo: THREE.RingGeometry | null = null; const haloPool: { m: THREE.Mesh; u: U }[] = [];
/** 出膛时套在弹道上、和弹道垂直的一圈环（音爆那样），从 r0 张到 r1、越张越薄：外沿珊瑚色、往里是白的水汽色。
 *  原来用的是正对镜头的圆环贴图，从哪看都是一个白圈，廉价；这个是立在弹道上的，俯视时是一道竖着的椭圆，看得出“朝前打出去” */
export function halo(api: Run, fx: FxLib, p: V3, dir: V3, o: { r0: number; r1: number; life: number; color?: number; color2?: number; alpha?: number; push?: number }) {
  haloGeo ??= new THREE.RingGeometry(0.55, 1, 48, 1);
  let rec = haloPool.pop();
  if (!rec) { const u: U = { uK: { value: 0 }, uAlpha: { value: 1 }, uA: { value: col(0xffffff) }, uB: { value: col(0xffffff) }, uTime: clock };
    const m = new THREE.Mesh(haloGeo, new THREE.ShaderMaterial({ ...premul, transparent: true, depthWrite: false, side: THREE.DoubleSide, uniforms: u,
      vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `uniform float uK, uAlpha, uTime; uniform vec3 uA, uB; varying vec2 vP; ${NOISE}
        void main(){ float r = length(vP), t = (r - 0.55) / 0.45, th = atan(vP.y, vP.x);
          float edge = exp(-pow((t - 0.8) / (0.1 + 0.05 * uK), 2.0)), body = smoothstep(0.0, 0.75, t) * (1.0 - smoothstep(0.85, 1.0, t)) * 0.45;
          float n = 0.7 + 0.3 * vn(vec2(th * 6.0, uTime * 3.0)), thin = 1.0 - uK * 0.6;
          vec3 c = mix(uB, uA, smoothstep(0.55, 0.95, t)); float a = (edge * 0.85 + body) * n * thin * uAlpha; if (a < 0.004) discard;
          gl_FragColor = vec4(c * a, a * 0.6);
          #include <colorspace_fragment>
        }` }));
    m.frustumCulled = false; m.renderOrder = 9; m.onBeforeRender = tick(fx); rec = { m, u }; }
  const R = rec, u = R.u, l = Math.hypot(dir.x, dir.y, dir.z) || 1, dx = dir.x / l, dy = dir.y / l, dz = dir.z / l, al = o.alpha ?? 1, push = o.push ?? 0.8;
  (u.uA.value as THREE.Color).set(o.color ?? 0xf07c5e); (u.uB.value as THREE.Color).set(o.color2 ?? 0xf6fffd); R.m.visible = true; fx.group.add(R.m);
  R.m.position.set(p.x, p.y, p.z); R.m.lookAt(p.x + dx, p.y + dy, p.z + dz);
  api.run(o.life, k => { const e = 1 - Math.pow(1 - k, 2.4); R.m.scale.setScalar(o.r0 + (o.r1 - o.r0) * e); R.m.position.set(p.x + dx * push * e, p.y + dy * push * e, p.z + dz * push * e); u.uK.value = k; u.uAlpha.value = al * Math.min(1, k / 0.06) * (1 - k * k); },
    () => { R.m.visible = false; R.m.removeFromParent(); haloPool.push(R); });
}

// ---------------------------------------------------------------- gauge：压力罐上的四格刻度（被动）
let gaugeGeo: THREE.RingGeometry | null = null;
export interface Gauge { set: (p: V3, dir: V3, n: number, show: boolean) => void; free: () => void; }
/** 套在枪管上（和枪管垂直）的一圈四格刻度：n 是攒了几格（0 到 3），亮的格是珊瑚橙，没亮的是很淡的白；攒满三格时整圈亮起来、轻轻跳（下一发是满潮弹）。
 *  画在模型前面（不然在肩甲后面看不见），很小（半径 r 米），只是给玩家看的提示 */
export function gauge(fx: FxLib, r: number): Gauge {
  gaugeGeo ??= new THREE.RingGeometry(0.62, 1, 40, 1);
  const u: U = { uN: { value: 0 }, uAlpha: { value: 0 }, uC: { value: col(0xf07c5e) }, uTime: clock };
  const m = new THREE.Mesh(gaugeGeo, new THREE.ShaderMaterial({ ...premul, transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide, uniforms: u,
    vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `uniform float uN, uAlpha, uTime; uniform vec3 uC; varying vec2 vP;
      void main(){ float r = length(vP), th = atan(vP.y, vP.x) / 6.2832 + 0.5, seg = floor(th * 4.0), f = fract(th * 4.0);
        float gap = smoothstep(0.04, 0.1, f) * (1.0 - smoothstep(0.9, 0.96, f)), band = smoothstep(0.62, 0.7, r) * (1.0 - smoothstep(0.92, 1.0, r));
        float full = step(2.5, uN), lit = max(step(seg + 0.5, uN), full), pulse = full * (0.75 + 0.25 * sin(uTime * 12.0));
        vec3 c = mix(vec3(0.85, 0.95, 0.95), uC, lit); float a = band * mix(gap, 1.0, full * 0.85) * mix(0.22, 0.95, lit) * (full > 0.5 ? pulse : 1.0) * uAlpha; if (a < 0.004) discard;
        gl_FragColor = vec4(c * a, a * 0.7);
        #include <colorspace_fragment>
      }` }));
  m.frustumCulled = false; m.renderOrder = 9.6; m.scale.setScalar(r); m.visible = false; m.onBeforeRender = tick(fx); fx.group.add(m);
  return { set(p, d, n, show) { m.visible = show; if (!show) return; m.position.set(p.x, p.y, p.z); m.lookAt(p.x + d.x, p.y + d.y, p.z + d.z); u.uN.value = n; u.uAlpha.value = 1; },
    free() { fx.group.remove(m); (m.material as THREE.Material).dispose(); } };
}

// ---------------------------------------------------------------- 贴地的网格（lane、shell 共用）：每个顶点落在各自位置的地面上，坡上、岸边不会被切掉
function drape(fx: FxLib, m: THREE.Mesh, x: number, z: number, rx: number, rz: number, yaw: number, lift: number) {
  m.rotation.set(0, yaw, 0); m.scale.set(rx, 1, rz); m.position.set(x, 0, z);
  const pos = m.geometry.getAttribute("position") as THREE.BufferAttribute, cs = Math.cos(yaw), sn = Math.sin(yaw);
  for (let i = 0; i < pos.count; i++) { const lx = pos.getX(i) * rx, lz = pos.getZ(i) * rz; pos.setY(i, fx.ground(x + lx * cs + lz * sn, z - lx * sn + lz * cs) + lift); }
  pos.needsUpdate = true;
}

// ---------------------------------------------------------------- lane：大招的预警线
const lanePool: { m: THREE.Mesh; u: U }[] = [];
export interface Lane { fill: (k: number) => void; alpha: (a: number) => void; kill: (fade?: number) => void; }
/** 从 (x,z) 朝 (dx,dz) 铺一条长 len、半宽 w 的预警带。fill(k)：蓄力的进度，一道亮的前沿从脚下推到尽头 */
export function lane(api: Run, fx: FxLib, o: { x: number; z: number; dx: number; dz: number; len: number; w: number; color?: number; color2?: number; alpha?: number }): Lane {
  let rec = lanePool.pop();
  if (!rec) { const u: U = { uFill: { value: 0 }, uAlpha: { value: 0 }, uLen: { value: 24 }, uE: { value: col(0xffffff) }, uF: { value: col(0xffffff) }, uD: { value: col(0x0e2a40) }, uTime: clock };
    const g = new THREE.PlaneGeometry(2, 2, 4, 64).rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, uniforms: u,
      vertexShader: `varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `uniform float uFill, uAlpha, uLen, uTime; uniform vec3 uE, uF, uD; varying vec2 vP; ${NOISE}
        void main(){ float x = abs(vP.x), z = vP.y * 0.5 + 0.5, m = z * uLen;                     // z：0 在脚下、1 在尽头；m 是米
          float ends = smoothstep(0.0, 1.2, m) * (1.0 - smoothstep(uLen - 0.4, uLen, m));
          float edge = exp(-pow((x - 0.9) / 0.045, 2.0)) * (0.75 + 0.25 * vn(vec2(m * 1.5 - uTime * 2.0, 1.0)));      // 两边一道细线（有一点流动的浓淡）
          float lit = step(m, uFill * uLen), front = exp(-pow((m - uFill * uLen) / 0.7, 2.0)) * step(0.01, uFill) * (1.0 - step(0.999, uFill));      // 蓄到哪：前沿一道亮的，走过的地方淡淡地铺开
          float inner = (1.0 - smoothstep(0.6, 0.9, x)) * (0.06 + 0.1 * lit) + front * (1.0 - smoothstep(0.2, 0.95, x)) * 0.5;
          float under = (1.0 - smoothstep(0.85, 1.0, x)) * 0.16;                               // 整条带子垫一层很淡的深色
          float a = (edge * (0.4 + 0.35 * lit) + inner + under) * ends * step(x, 1.0) * uAlpha; if (a < 0.004) discard;
          vec3 c = mix(uD, mix(uF, uE, clamp(edge + front, 0.0, 1.0)), clamp((edge + inner) / max(0.001, edge + inner + under), 0.0, 1.0));
          gl_FragColor = vec4(c, a);
          #include <colorspace_fragment>
        }` }));
    m.frustumCulled = false; m.renderOrder = 5.7; m.onBeforeRender = tick(fx); rec = { m, u }; }
  const R = rec, u = R.u, half = o.len / 2, peak = o.alpha ?? 0.9; u.uLen.value = o.len; u.uFill.value = 0; u.uAlpha.value = 0;
  (u.uE.value as THREE.Color).set(o.color ?? 0xf6fffd); (u.uF.value as THREE.Color).set(o.color2 ?? 0xf07c5e);
  drape(fx, R.m, o.x + o.dx * half, o.z + o.dz * half, o.w, half, Math.atan2(o.dx, o.dz), 0.09); R.m.visible = true; fx.group.add(R.m);
  let a = 1, t = 0, dead = -1, gone = false;
  const end = () => { if (gone) return; gone = true; R.m.visible = false; R.m.removeFromParent(); lanePool.push(R); };
  api.run(12, (_k, dt) => { if (gone) return; t += dt; const out = dead < 0 ? 1 : Math.max(0, 1 - (t - dead) / 0.3); u.uAlpha.value = peak * a * Math.min(1, t / 0.12) * out;
    if (out <= 0) end(); }, end);      // 忘了 kill 也最多留 12 秒
  return { fill(k) { u.uFill.value = Math.max(0, Math.min(1, k)); }, alpha(v) { a = v; }, kill(fade = 0.3) { if (dead < 0) dead = t + Math.max(0, fade - 0.3); } };
}

// ---------------------------------------------------------------- shell：定身的硬壳
const shellPool: { m: THREE.Mesh; u: U }[] = [];
/** 脚下一块扇贝纹的珍珠母壳：0.08 秒从中间长满，hold 秒以后裂开、一块块碎掉（碎片的粒子由调用的人放）。follow 给了就跟着那个单位 */
export function shell(api: Run, fx: FxLib, x: number, z: number, r: number, hold: number, o: { coral?: number; follow?: () => { x: number; z: number } | null } = {}) {
  let rec = shellPool.pop();
  if (!rec) { const u: U = { uGrow: { value: 0 }, uCrack: { value: 0 }, uAlpha: { value: 0 }, uSeed: { value: 0 }, uB: { value: col(0xf07c5e) }, uD: { value: col(0x0e2a40) }, uTime: clock };
    const g = new THREE.PlaneGeometry(2, 2, 10, 10).rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5, uniforms: u,
      vertexShader: `varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `uniform float uGrow, uCrack, uAlpha, uSeed, uTime; uniform vec3 uB, uD; varying vec2 vP; ${NOISE} ${NACRE}
        void main(){ vec2 p = vP; float r = length(p), th = atan(p.y, p.x);
          float er = 0.8 + 0.05 * pow(abs(cos(th * 9.0 + uSeed)), 0.6);                          // 扇贝的边：一圈小圆齿
          float inside = (1.0 - smoothstep(er - 0.025, er, r)) * step(r, uGrow * er + 0.02);
          float rib = pow(abs(cos(th * 9.0 + uSeed)), 5.0), rings = smoothstep(0.75, 1.0, sin(r * 30.0) * 0.5 + 0.5);      // 放射的棱、一圈圈生长纹
          vec3 c = mix(vec3(0.9, 0.88, 0.84), nacre(r * 1.2 + th * 0.12 + uTime * 0.05 + uSeed), 0.45) * (0.78 + 0.22 * rib - 0.08 * rings);      // 第四批：珍珠母的彩虹压一半（原来一整块粉绿的彩虹盘子太花）
          c = mix(c, uB, smoothstep(er - 0.16, er - 0.04, r) * 0.75);                           // 珊瑚色的边：塞伦的“压”
          float n = fbm(p * 3.2 + uSeed), crack = (1.0 - smoothstep(0.0, 0.035, abs(n - 0.5))) * smoothstep(0.0, 0.15, uCrack);      // 裂开：先出几道深色的缝
          float keep = smoothstep(uCrack * 1.3 - 0.2, uCrack * 1.3 - 0.1, fract(n * 3.7 + vn(p * 9.0 + uSeed) * 0.3));      // 再一块块没掉（uCrack 是 0 时一块不少）
          c = mix(c, uD, crack * 0.85);
          float outline = (1.0 - smoothstep(er, er + 0.14, r)) * (1.0 - inside) * step(r, uGrow * er + 0.16) * 0.5;      // 外面一圈深色的影子：浅色的壳在亮的地上也有轮廓
          float a = max(inside * 0.88 * keep, outline * (1.0 - uCrack)) * uAlpha; if (a < 0.004) discard;
          gl_FragColor = vec4(mix(uD, c, inside), a);
          #include <colorspace_fragment>
        }` }));
    m.frustumCulled = false; m.renderOrder = 5.8; m.onBeforeRender = tick(fx); rec = { m, u }; }
  const R = rec, u = R.u; u.uGrow.value = 0; u.uCrack.value = 0; u.uAlpha.value = 1; u.uSeed.value = Math.random() * 20; (u.uB.value as THREE.Color).set(o.coral ?? 0xf07c5e);
  let cx = x, cz = z; drape(fx, R.m, cx, cz, r, r, 0, 0.1); R.m.visible = true; fx.group.add(R.m);
  const brk = 0.32;
  api.run(hold + brk, k => { const t = k * (hold + brk); u.uGrow.value = Math.min(1, t / 0.08); u.uCrack.value = Math.max(0, (t - hold) / brk); u.uAlpha.value = 1 - Math.max(0, (t - hold - brk * 0.6) / (brk * 0.4));
      const f = o.follow?.(); if (f && Math.hypot(f.x - cx, f.z - cz) > 0.05) { cx = f.x; cz = f.z; drape(fx, R.m, cx, cz, r, r, 0, 0.1); } },
    () => { R.m.visible = false; R.m.removeFromParent(); shellPool.push(R); });
  return { at: () => ({ x: cx, z: cz }) };
}

// ---------------------------------------------------------------- fan：贴地往外推的一道扇形水浪
const fanPool: { m: THREE.Mesh; u: U }[] = [];
/** 从 (x,z) 朝 yaw 推出去的扇形水浪：前沿一道有厚度的白沫（被噪声撕得不齐）往外推，走过的地方湿一片、拖着几道放射的水纹，两边收掉。
 *  r 推到多远，ang 半张角；life 秒（前 45% 推到头，之后湿印一块块蚀掉）。立着的冲击环从俯视只剩一道细弧，这个是给俯视看的“面” */
export function fan(api: Run, fx: FxLib, o: { x: number; z: number; yaw: number; r: number; ang: number; life: number; push?: number; color?: number; color2?: number; deep?: number; alpha?: number }) {
  let rec = fanPool.pop();
  if (!rec) { const u: U = { uF: { value: 0 }, uAng: { value: 0.5 }, uAlpha: { value: 0 }, uDis: { value: 0 }, uSeed: { value: 0 }, uA: { value: col(0xffffff) }, uB: { value: col(0xffffff) }, uD: { value: col(0) }, uTime: clock };
    const g = new THREE.PlaneGeometry(2, 2, 16, 16).rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, uniforms: u,
      vertexShader: `varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `uniform float uF, uAng, uAlpha, uDis, uSeed, uTime; uniform vec3 uA, uB, uD; varying vec2 vP; ${NOISE}
        void main(){ vec2 p = vP; float r = length(p), th = atan(p.x, p.y);
          float side = 1.0 - smoothstep(uAng * 0.82, uAng, abs(th)), n = fbm(vec2(th * 7.0 + uSeed, r * 5.0 - uTime * 2.0)), m2 = vn(vec2(th * 22.0 + uSeed, r * 9.0));
          float fr = uF + (n - 0.5) * 0.09, d = r - fr;                                                    // 前沿：不齐的一道
          float gone = 1.0 - smoothstep(0.0, 0.3, uDis), foam = exp(-pow(d / (0.045 + 0.02 * uF), 2.0)) * (0.55 + 0.55 * m2) * gone, lip = exp(-pow((d + 0.07) / 0.05, 2.0)) * 0.6 * gone;      // 推到头以后白沫很快塌掉（第四批：原来只薄四成，一道白弧在尽头停约 0.4 秒）
          float wet = (1.0 - smoothstep(-0.02, 0.03, d)) * smoothstep(0.06, 0.2, r) * (0.35 + 0.25 * n);   // 走过的地方：湿的一片
          float rays = smoothstep(0.7, 0.95, vn(vec2(th * 26.0 + uSeed, r * 2.5 - uTime * 0.5)) * (0.6 + 0.6 * n)) * (1.0 - smoothstep(-0.02, 0.03, d)) * smoothstep(0.25, 0.55, r) * 0.18;      // 几道顺着推的方向、断断续续的淡水纹（原来 0.5 太齐，像一把折扇）
          float keep = uDis > 0.0 ? smoothstep(uDis * 1.2 - 0.18, uDis * 1.2 - 0.02, fbm(p * 3.0 + uSeed) * 0.8 + m2 * 0.2) : 1.0;
          float a = (foam * 0.9 + lip * 0.3 + wet * 0.55 + rays) * side * keep * step(r, 1.02) * uAlpha; if (a < 0.004) discard;
          vec3 c = mix(uD, uB, clamp(rays * 1.5 + lip, 0.0, 1.0)); c = mix(c, uA, clamp(foam * 1.2, 0.0, 1.0));
          gl_FragColor = vec4(c, min(a, 1.0));
          #include <colorspace_fragment>
        }` }));
    m.frustumCulled = false; m.renderOrder = 5.75; m.onBeforeRender = tick(fx); rec = { m, u }; }
  const R = rec, u = R.u, al = o.alpha ?? 1; u.uAng.value = o.ang; u.uSeed.value = Math.random() * 30; u.uF.value = 0.1; u.uDis.value = 0; u.uAlpha.value = 0;
  (u.uA.value as THREE.Color).set(o.color ?? 0xf6fffd); (u.uB.value as THREE.Color).set(o.color2 ?? 0xbfe9e4); (u.uD.value as THREE.Color).set(o.deep ?? 0x0e2a40);
  drape(fx, R.m, o.x, o.z, o.r, o.r, o.yaw, 0.09); R.m.visible = true; fx.group.add(R.m);
  const push = o.push ?? 0.45;
  api.run(o.life, k => { const g = Math.min(1, k / push), e = 1 - Math.pow(1 - g, 2.2); u.uF.value = 0.1 + 0.9 * e; u.uAlpha.value = al * Math.min(1, k / 0.04) * (1 - Math.max(0, (k - 0.85) / 0.15)); u.uDis.value = Math.max(0, (k - push) / (1 - push)) * 0.95; },
    () => { R.m.visible = false; R.m.removeFromParent(); fanPool.push(R); });
}

// ---------------------------------------------------------------- mine：珍珠雷
// 第四批 polish-new：原来是半径 0.3 的珍珠加一圈细箍、六根细刺，俯视只是一颗白珠子。改成“一颗珍珠坐在一圈张开的六瓣贝壳里”：
// 贝壳瓣朝上张开（俯视正好看见里面的珍珠母），瓣尖收成尖的（看得出是个会咬人的东西），边上一点珊瑚色；整个直径约 1.3 米，游戏镜头里一眼认得出
let cageGeo: THREE.BufferGeometry | null = null, cageMat: THREE.MeshStandardMaterial | null = null, petalGeo: THREE.BufferGeometry | null = null, petalMat: THREE.ShaderMaterial | null = null;
const minePool: { g: THREE.Group; p: THREE.Mesh; open: THREE.Group[] }[] = [];
function petalGeometry() {
  // 一片贝壳瓣：从根（原点）往 +x 伸出去的一片勺子形，根窄、中间宽、瓣尖收尖；中间凹下去（俯视是一片有明暗的扇贝）。aR 是离根多远（0 到 1），aS 是横着的位置（-1 到 1）
  const NU = 10, NV = 8, P: number[] = [], R: number[] = [], S: number[] = [], I: number[] = [];
  for (let i = 0; i <= NU; i++) { const t = i / NU, half = 0.62 * Math.pow(Math.sin(Math.PI * (0.1 + 0.46 * t)), 0.8) * Math.sqrt(Math.max(0, 1 - Math.pow(Math.max(0, (t - 0.74) / 0.26), 2))) + 0.04;      // 根窄，越往外越宽，瓣尖是圆的；六瓣宽到互相压住一点，连成一圈扇贝边的壳（第一版六瓣分开，像一朵花）
    for (let j = 0; j <= NV; j++) { const s = j / NV * 2 - 1, x = t * 1.0, z = s * half, y = -0.12 * (1 - s * s) * Math.sin(Math.PI * t) + 0.05 * t; P.push(x, y, z); R.push(t); S.push(s); } }
  for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) { const a = i * (NV + 1) + j, b = a + NV + 1; I.push(a, b, a + 1, a + 1, b, b + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); g.setAttribute("aR", new THREE.Float32BufferAttribute(R, 1)); g.setAttribute("aS", new THREE.Float32BufferAttribute(S, 1)); g.setIndex(I); g.computeVertexNormals(); return g;
}
function petalMaterial(): THREE.ShaderMaterial {
  return petalMat ??= new THREE.ShaderMaterial({ uniforms: { uTime: clock }, side: THREE.DoubleSide,
    vertexShader: /* glsl */ `attribute float aR, aS; varying float vR, vS; varying vec3 vN, vV; void main(){ vR = aR; vS = aS; vec4 w = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - w.xyz); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `uniform float uTime; varying float vR, vS; varying vec3 vN, vV; ${NACRE}
      void main(){ vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N; vec3 V = normalize(vV), L = normalize(vec3(0.35, 1.0, 0.2));
        float rib = pow(abs(cos(vS * 4.0 * 3.1416)), 3.0), dif = 0.55 + 0.45 * max(0.0, dot(N, L));      // 扇贝的放射棱
        vec3 c = mix(vec3(0.88, 0.87, 0.83), nacre(vR * 0.8 + vS * 0.25 + uTime * 0.05), 0.5) * (0.84 + 0.16 * rib) * dif;      // 里面是珍珠母：一道道放射的棱（彩虹压一半，不发粉发绿）
        c *= mix(0.5, 1.0, smoothstep(0.05, 0.55, vR));                                                                           // 根上暗：壳是凹下去的，珍珠坐在里面
        c = mix(c, vec3(0.94, 0.49, 0.37), smoothstep(0.78, 0.98, vR) * 0.7);                                         // 瓣尖一点珊瑚色
        c = mix(vec3(0.07, 0.17, 0.24), c, smoothstep(0.0, 0.12, 1.0 - abs(vS)) * smoothstep(0.0, 0.08, vR + 0.02));  // 瓣的两边压一道深海蓝：一片片分得开，亮地面上有轮廓
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }` });
}
/** 一颗珍珠雷：珍珠坐在六瓣张开的贝壳里，一圈青铜箍。set 放到地上；sink(k) 往下沉（0 在地面，1 全埋了）；open(k) 贝壳张开几成（落地时从合着张开） */
export function mine(fx: FxLib, r = 0.22): { g: THREE.Group; set: (x: number, z: number, spin?: number) => void; sink: (k: number) => void; open: (k: number) => void; free: () => void } {
  if (!cageGeo) {
    cageGeo = new THREE.TorusGeometry(0.98, 0.12, 6, 24).rotateX(Math.PI / 2);
    cageMat = new THREE.MeshStandardMaterial({ color: 0x7fb3a0, roughness: 0.4, metalness: 0.5, emissive: 0x24463c, emissiveIntensity: 0.8 });      // 铜绿青铜（塞伦的武器同一种）
    petalGeo = petalGeometry();
  }
  let rec = minePool.pop();
  if (!rec) { const g = new THREE.Group(), cage = new THREE.Mesh(cageGeo, cageMat!); cage.castShadow = false; pearlGeo ??= new THREE.SphereGeometry(1, 18, 12); const p = new THREE.Mesh(pearlGeo, pearlMaterial()); p.onBeforeRender = tick(fx); g.add(cage, p);
    const open: THREE.Group[] = [];
    for (let i = 0; i < 6; i++) { const yawG = new THREE.Group(), hinge = new THREE.Group(), leaf = new THREE.Mesh(petalGeo!, petalMaterial()); leaf.scale.set(2.0, 2.0, 2.0); leaf.onBeforeRender = tick(fx); hinge.position.set(0.7, 0, 0); hinge.add(leaf); yawG.rotation.y = i / 6 * Math.PI * 2; yawG.add(hinge); g.add(yawG); open.push(hinge); }
    rec = { g, p, open }; }
  const R = rec; R.g.scale.setScalar(r); R.g.visible = true; fx.group.add(R.g); let gx = 0, gz = 0, gy = 0, sk = 0;
  const place = () => R.g.position.set(gx, gy - r * 0.2 - sk * r * 2.4, gz);      // 珍珠半埋，贝壳瓣贴着地面张开
  const opn = (k: number) => { for (const h of R.open) h.rotation.z = 0.12 + (1 - k) * 1.25; };      // 1 是张开（瓣稍微往上翘），0 是合着（瓣竖起来包住珍珠）
  opn(1);
  return { g: R.g, set(x, z, spin = 0) { gx = x; gz = z; gy = fx.ground(x, z); R.g.rotation.set(0, spin, 0); place(); }, sink(k) { sk = k; place(); }, open: opn, free() { R.g.visible = false; R.g.removeFromParent(); minePool.push(R); } };
}

// ---------------------------------------------------------------- skid：反冲的滑痕
const skidPool: { m: THREE.Mesh; u: U }[] = [];
export interface Skid { head: (k: number) => void; }
/** 从 (x0,z0) 滑到 (x1,z1) 的滑痕，半宽 w；head(k) 画到几成（0 到 1）；life 秒，后 45% 一块块蚀掉 */
export function skid(api: Run, fx: FxLib, o: { x0: number; z0: number; x1: number; z1: number; w: number; life: number; color?: number; deep?: number; alpha?: number }): Skid {
  let rec = skidPool.pop();
  if (!rec) { const u: U = { uHead: { value: 0 }, uAlpha: { value: 0 }, uDis: { value: 0 }, uHot: { value: 1 }, uLen: { value: 5 }, uSeed: { value: 0 }, uA: { value: col(0xffffff) }, uD: { value: col(0) }, uTime: clock };
    const g = new THREE.PlaneGeometry(2, 2, 4, 40).rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, uniforms: u,
      vertexShader: `varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `uniform float uHead, uAlpha, uDis, uHot, uLen, uSeed; uniform vec3 uA, uD; varying vec2 vP; ${NOISE}
        void main(){ float x = vP.x, y = vP.y * 0.5 + 0.5, m = y * uLen;                 // y：0 在起点、1 在终点
          if (y > uHead) discard;
          float n = vn(vec2(m * 3.0 + uSeed, x * 2.0)), ax = abs(x) + (n - 0.5) * 0.14;
          float wet = 1.0 - smoothstep(0.38, 0.62, ax);                                       // 一整条湿印（两道细沟像车辙，第一版就是）
          float foam = exp(-pow((ax - 0.66) / 0.07, 2.0)) * smoothstep(0.35, 0.6, vn(vec2(m * 5.0 + sign(x) * 9.0, uSeed)));      // 两边断断续续的白沫（被踢开的水）
          float ends = smoothstep(0.0, 0.08, y) * (1.0 - smoothstep(uHead - 0.04, uHead, y) * 0.5);
          float fresh = smoothstep(uHead - 0.35, uHead, y) * uHot, core = (1.0 - smoothstep(0.0, 0.22, ax)) * fresh;      // 刚划出来的那一截中间亮一道
          float keep = uDis > 0.0 ? smoothstep(uDis * 1.2 - 0.18, uDis * 1.2, vn(vec2(m * 1.6, x * 3.0) + uSeed) * 0.8 + 0.2 * y) : 1.0;
          float a = (wet * (0.42 + 0.1 * n) + foam * (0.55 + 0.35 * fresh) + core * 0.5) * ends * keep * uAlpha * step(abs(x), 1.0); if (a < 0.004) discard;
          vec3 c = mix(uD, uA, clamp(foam * (0.75 + 0.25 * fresh) + core, 0.0, 1.0));
          gl_FragColor = vec4(c, a);
          #include <colorspace_fragment>
        }` }));
    m.frustumCulled = false; m.renderOrder = 5.7; m.onBeforeRender = tick(fx); rec = { m, u }; }
  const R = rec, u = R.u, dx = o.x1 - o.x0, dz = o.z1 - o.z0, L = Math.hypot(dx, dz) || 0.01, al = o.alpha ?? 1;
  u.uHead.value = 0; u.uAlpha.value = al; u.uDis.value = 0; u.uHot.value = 1; u.uLen.value = L; u.uSeed.value = Math.random() * 30;
  (u.uA.value as THREE.Color).set(o.color ?? 0xf6fffd); (u.uD.value as THREE.Color).set(o.deep ?? (FXB.on ? 0x1a78a8 : 0x0e2a40));      // 换画风 B：滑痕是海蓝的湿印，不是一道深灰
  drape(fx, R.m, (o.x0 + o.x1) / 2, (o.z0 + o.z1) / 2, o.w, L / 2, Math.atan2(dx, dz), 0.085); R.m.visible = true; fx.group.add(R.m);
  api.run(o.life, k => { const t = k * o.life; u.uHot.value = Math.max(0, 1 - t / 0.5); u.uDis.value = Math.max(0, (k - 0.55) / 0.45); }, () => { R.m.visible = false; R.m.removeFromParent(); skidPool.push(R); });
  return { head(k) { u.uHead.value = Math.max(0, Math.min(1.01, k)); } };
}

// ---------------------------------------------------------------- trap：珍珠雷的触发范围
const trapPool: { m: THREE.Mesh; u: U }[] = [];
export interface Trap { draw: (k: number) => void; alpha: (a: number) => void; kill: () => void; }
/** 贴地的一圈细水线（半径 r），六颗小珠把它分成六段；draw(k) 画出来到几成（从一处绕一圈），alpha 整体透明度。底下垫一圈深色（亮地面上读得出） */
export function trap(api: Run, fx: FxLib, x: number, z: number, r: number, color = 0xf6fffd, deep = 0x0e2a40): Trap {
  let rec = trapPool.pop();
  if (!rec) { const u: U = { uDraw: { value: 0 }, uAlpha: { value: 0 }, uA: { value: col(0xffffff) }, uD: { value: col(0) }, uTime: clock };
    const g = new THREE.PlaneGeometry(2, 2, 12, 12).rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.ShaderMaterial({ ...premul, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, uniforms: u,
      vertexShader: `varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `uniform float uDraw, uAlpha, uTime; uniform vec3 uA, uD; varying vec2 vP;
        void main(){ vec2 p = vP * 1.1; float r = length(p), th = atan(p.y, p.x), u = th / 6.2832 + 0.5;
          if (r > 1.08) discard;
          float drawn = 1.0 - smoothstep(uDraw - 0.02, uDraw, u);
          float seg = fract(u * 6.0), gap = smoothstep(0.03, 0.08, seg) * (1.0 - smoothstep(0.92, 0.97, seg));
          float line = exp(-pow((r - 0.97) / 0.016, 2.0)) * gap;
          float bead = 1.0 - smoothstep(0.03, 0.05, length(vec2((seg - (seg > 0.5 ? 1.0 : 0.0)) * 6.2832 / 6.0 * 0.97, r - 0.97)));      // 每段之间一颗小珠
          float under = exp(-pow((r - 0.96) / 0.05, 2.0)) * 0.35;
          float a = (line * 0.5 + bead * 0.7 + under) * drawn * uAlpha; if (a < 0.004) discard;
          gl_FragColor = vec4((uA * (line * 0.85 + bead) + uD * under) * drawn * uAlpha, a);
          #include <colorspace_fragment>
        }` }));
    m.frustumCulled = false; m.renderOrder = 5.8; m.onBeforeRender = tick(fx); rec = { m, u }; }
  const R = rec, u = R.u; (u.uA.value as THREE.Color).set(color); (u.uD.value as THREE.Color).set(deep); u.uDraw.value = 0; u.uAlpha.value = 0;
  drape(fx, R.m, x, z, r * 1.1, r * 1.1, 0, 0.08); R.m.visible = true; fx.group.add(R.m); let gone = false;
  const end = () => { if (gone) return; gone = true; R.m.visible = false; R.m.removeFromParent(); trapPool.push(R); };
  api.run(60, () => {}, end);      // 忘了 kill 也最多留 60 秒（雷最多活 40 秒）
  return { draw(k) { u.uDraw.value = Math.max(0, Math.min(1.02, k)); }, alpha(a) { u.uAlpha.value = a; }, kill: end };
}

// ---------------------------------------------------------------- 预热
const warmed = new WeakSet<THREE.Group>();
/** 每种零件先各出一个看不见的（在地下 40 米），让着色器趁开局编好，第一次放技能时不卡一下。一局只做一次（塞伦的 passive 第一帧调） */
export function warmSeren(api: Run, fx: FxLib, x: number, z: number) {
  if (warmed.has(fx.group)) return; warmed.add(fx.group);
  const y = fx.ground(x, z) - 40, p = { x, y, z }, q = { x, y: y + 0.01, z };
  const pr = pearl(fx, 0.01); pr.obj.position.set(x, y, z);
  const ln = line(fx, { width: 0.01 }); ln.set(p, q);
  const sw = swirl(fx); sw.set(p, { x: 0, y: 0, z: 1 }, 0.01, 1, 0);
  const d0 = dot(fx, 0xffffff), d1 = dot(fx, 0, true); d0.set(p, 0.01, 0); d1.set(p, 0.01, 0);
  const mi = mine(fx, 0.01); mi.set(x, z); mi.g.position.y = y;
  const tp = trap(api, fx, x, z, 0.01); tp.alpha(0);
  skid(api, fx, { x0: x, z0: z, x1: x + 0.01, z1: z, w: 0.01, life: 0.1, alpha: 0 });
  const la = lane(api, fx, { x, z, dx: 0, dz: 1, len: 0.1, w: 0.01, alpha: 0 }); la.kill(0);
  shell(api, fx, x, z, 0.01, 0.05);
  fan(api, fx, { x, z, yaw: 0, r: 0.01, ang: 0.5, life: 0.1, alpha: 0 });
  halo(api, fx, p, { x: 0, y: 0, z: 1 }, { r0: 0.01, r1: 0.02, life: 0.1, alpha: 0 });
  api.run(0.2, () => {}, () => { pr.free(); ln.free(); sw.free(); d0.free(); d1.free(); mi.free(); tp.kill(); });
}
