// 第九轮 fx2a：岚、托尔格技能特效自己的零件。现在只有这两个英雄用；blade、streak、crown、mark 是通用的形状，合并时可以搬进 fxlib。
//
// 为什么要自己的零件：岚和托尔格的主色是青，测试场和河道的地面也是青绿，叠加发光的青色落在上面几乎没有反差——
// 这是第一轮“改了以后在连续帧上看不出区别”的主要原因。这里的形状都分两层：
//   底下一层普通混合的深海蓝（把地面压暗一点，给出轮廓），上面一层叠加的亮边（只有最亮的那一道接近白）。
// 靠明暗反差读得清，不靠更亮、更大（用户反感光污染）。
//
//   blade   空中的月牙刀光：一道从一头扫到另一头的带子，外沿一道亮边，里面是有颜色的身体，底下垫一层深色
//   streak  两点之间的一道闪线（闪现、冲刺、钩子的路径）：头宽尾尖、中间一道白芯，很快收细
//   crown   水冠：一圈往上溅起、顶上是参差的白沫、然后往外塌下去的水墙（砸地、入水、隐身的那一下）
//   mark    贴地的印记：刀痕、水痕、裂纹、湿印、涨潮的水面、落点预告。顺着地面铺（坡上、岸边不会被切掉），刚出来的一下发亮，之后是暗的湿印，淡出时一块块蚀掉
//   dome    声壳：一个往外鼓的半球罩子，只有边缘和几道往上走的纹看得见（钟声）
//   spear   朝一个方向的一道尖的闪光（钩子出手、突刺），用粒子拉长做
//   converge 往一点收拢的水珠（起手的预兆）
// 都用池子：材质和几何体只建一次，用完藏起来下次接着用。动画用 api.run 推（对局时间：暂停、顿帧都跟着停）。
// 手机档（LITE）：水冠、声壳的分段少一半；粒子在 fxlib 里已经减半。

import * as THREE from "three";
import { LITE } from "../quality";
import type { Api } from "./skills";
import type { Actor } from "./actor";
import { SPR, type FxLib, type V3 } from "./fxlib";
import { BOUT, FXB, glowBlend } from "./fxb";

type U = Record<string, { value: any }>;
const NOISE = /* glsl */ `
  float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
  float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 3; i++) { s += a * vn(p); p = p * 2.03 + 11.7; a *= 0.5; } return s / 0.875; }
`;
const col = (c: number) => new THREE.Color(c);
/** 一个简单的池子：每个 fxlib 一套（场上只有一个），拿的时候找一个闲着的，没有就新建 */
function pool<T extends { busy: boolean }>(make: (fx: FxLib) => T) {
  const all = new WeakMap<THREE.Group, T[]>();
  return (fx: FxLib): T => { let list = all.get(fx.group); if (!list) all.set(fx.group, (list = [])); let p = list.find(x => !x.busy); if (!p) { p = make(fx); list.push(p); } p.busy = true; return p; };
}

// ---------------------------------------------------------------- blade：空中的月牙刀光
// 带子沿弧线分 32 段、横着 3 行（v=0 内沿，1 外沿）。两张网格共用一份 uniform：底下一层普通混合的深色，上面一层叠加的亮边。
const bladeGeo = (() => { const S = 32, pos: number[] = [], idx: number[] = []; for (let i = 0; i <= S; i++) { for (let j = 0; j < 3; j++) pos.push(i / S, j / 2, 0); if (i < S) { const k = i * 3; idx.push(k, k + 3, k + 1, k + 1, k + 3, k + 4, k + 1, k + 4, k + 2, k + 2, k + 4, k + 5); } }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); return g; })();
const BLADE_VERT = /* glsl */ `uniform float uArc, uR, uW, uFlip, uHead, uThin, uOver; varying vec2 vUv;
  void main(){ float t = position.x, v = position.y; vUv = vec2(t, v); float th = (t - 0.5) * uArc * (uFlip > 0.5 ? -1.0 : 1.0);
    float w = uW * uThin * pow(max(0.0, sin(3.14159 * t)), 0.55) * (1.0 + uOver);      // 两头尖、中间宽；底下那层（uOver）宽一点，亮边外面露出一圈深色
    float rr = uR * (1.0 - w * (1.0 - v)) + uR * uW * uOver * 0.18 * v;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(sin(th) * rr, 0.0, cos(th) * rr, 1.0); }`;
const bladeFrag = (glow: boolean) => /* glsl */ `uniform float uHead, uAlpha, uTail; uniform vec3 uA, uB, uD; varying vec2 vUv; ${glow && FXB.on ? BOUT : ""}
  void main(){ float u = vUv.x, v = vUv.y; if (u > uHead) discard;
    float tail = smoothstep(uHead - uTail, uHead, u) * smoothstep(0.0, 0.06, u), hot = exp(-(uHead - u) * 9.0) * (1.0 - smoothstep(0.95, 1.2, uHead));
    ${glow ? `float edge = smoothstep(0.5, 0.97, v), body = pow(v, 1.2), rim = smoothstep(0.88, 0.99, v);
      vec3 c = mix(uB, uA, ${FXB.on ? "pow(edge, 4.0)" : "edge * edge"}); c = mix(c, vec3(1.0), clamp(rim * (0.5 + 0.5 * hot), 0.0, 1.0));      // 换画风 B：身子多留主色（浅色的外半圈在亮地面上就是白的），刃口那一道才白      // 外沿一道发白的刃，往里是主色的一条带子，再往里淡掉
      float a = (edge * 0.85 + rim * 0.3 + body * 0.35) * tail * uAlpha; if (a < 0.004) discard; ${FXB.on ? "gl_FragColor = bOut_(c, a);" : "gl_FragColor = vec4(c * a, a);\n    #include <colorspace_fragment>"}`
    : `float a = (0.15 + 0.6 * smoothstep(0.0, 0.7, v)) * tail * uAlpha * 0.55; if (a < 0.004) discard; gl_FragColor = vec4(uD, a);
    #include <colorspace_fragment>`}
  }`;
interface BladeRec { busy: boolean; g: THREE.Group; u: U; }
const getBlade = pool<BladeRec>(fx => {
  const u: U = { uHead: { value: 0 }, uAlpha: { value: 1 }, uTail: { value: 0.8 }, uArc: { value: 2 }, uR: { value: 1 }, uW: { value: 0.3 }, uFlip: { value: 0 }, uThin: { value: 1 }, uA: { value: col(0xffffff) }, uB: { value: col(0xffffff) }, uD: { value: col(0) } };
  const g = new THREE.Group(); g.rotation.order = "YXZ";
  for (const glow of [false, true]) {
    const uu: U = { ...u, uOver: { value: glow ? 0 : 0.35 } };
    const m = new THREE.Mesh(bladeGeo, new THREE.ShaderMaterial({ uniforms: uu, transparent: true, depthWrite: false, depthTest: false,      /* 刀光画在模型前面：砍的是目标，刀光穿过它的身子时不能被身子挡掉（LoL 的刀光也是这样） */ side: THREE.DoubleSide, ...(glow ? glowBlend() : { blending: THREE.NormalBlending }), vertexShader: BLADE_VERT, fragmentShader: bladeFrag(glow) }));
    m.frustumCulled = false; m.renderOrder = glow ? 9 : 8.5; g.add(m);
  }
  g.visible = false; fx.group.add(g); return { busy: false, g, u };
});
export interface BladeOpts { pos: V3; yaw: number; tilt?: number; roll?: number; r: number; arc?: number; width?: number; life?: number; sweep?: number; flip?: boolean; color?: number; color2?: number; deep?: number; alpha?: number; tail?: number; }
/** 一道月牙刀光：sweep 秒里从一头扫到另一头，扫完以后一边变细一边淡掉（总共 life 秒）。yaw 朝哪边，tilt 绕前进方向侧倾（斜劈），roll 前后倾 */
export function blade(api: Api, fx: FxLib, o: BladeOpts) {
  const R = getBlade(fx), u = R.u, life = o.life ?? 0.32, sweep = o.sweep ?? life * 0.38, al = o.alpha ?? 1;
  u.uArc.value = o.arc ?? 2.2; u.uR.value = o.r; u.uW.value = o.width ?? 0.32; u.uFlip.value = o.flip ? 1 : 0; u.uTail.value = o.tail ?? 0.8; u.uHead.value = 0; u.uThin.value = 1; u.uAlpha.value = al;
  (u.uA.value as THREE.Color).set(o.color ?? 0xe6fbf7); (u.uB.value as THREE.Color).set(o.color2 ?? 0x7fe9e4); (u.uD.value as THREE.Color).set(o.deep ?? 0x0b2f45);
  R.g.position.set(o.pos.x, o.pos.y, o.pos.z); R.g.rotation.set(o.roll ?? 0, o.yaw, o.tilt ?? 0); R.g.visible = true;
  api.run(life, k => { const t = k * life; if (t < sweep) { u.uHead.value = t / sweep; } else { const f = (t - sweep) / Math.max(1e-3, life - sweep); u.uHead.value = 1 + f * 0.7; u.uThin.value = 1 - 0.7 * f; u.uAlpha.value = al * (1 - f) * (1 - f * 0.5); } },
    () => { R.g.visible = false; R.busy = false; });
}

// ---------------------------------------------------------------- streak：两点之间的一道闪线
// 一条正对镜头的带子：aT 是沿线的位置（0 在起点 a，1 在终点 b），头上宽、往起点收尖；中间一道白芯，外面是主色，最外面垫一层深色
const streakGeo = (() => { const N = 16, pos: number[] = [], idx: number[] = []; for (let i = 0; i <= N; i++) { pos.push(i / N, -1, 0, i / N, 1, 0); if (i < N) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); } }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); return g; })();
const STREAK_VERT = /* glsl */ `uniform vec3 uP0, uP1; uniform float uW, uOver, uTaper; varying vec2 vS;
  void main(){ float t = position.x, s = position.y; vS = vec2(t, s);
    vec3 P = mix(uP0, uP1, t); vec4 mv = viewMatrix * vec4(P, 1.0); vec3 tv = (viewMatrix * vec4(uP1 - uP0, 0.0)).xyz; vec3 sd = cross(tv, mv.xyz); float l = length(sd); sd = l > 1e-5 ? sd / l : vec3(0.0, 1.0, 0.0);
    float w = uW * (1.0 + uOver) * mix(1.0, pow(t, 0.7), uTaper) * (1.0 - smoothstep(0.9, 1.0, t) * 0.6);
    mv.xyz += sd * s * w * 0.5; gl_Position = projectionMatrix * mv; }`;
const streakFrag = (glow: boolean) => /* glsl */ `uniform vec3 uA, uB, uD; uniform float uAlpha; varying vec2 vS; ${glow && FXB.on ? BOUT : ""}
  void main(){ float p = 1.0 - abs(vS.y), t = vS.x;
    ${glow ? `float core = pow(p, 4.0), a = (core + pow(p, 1.3) * 0.45) * uAlpha * smoothstep(0.0, 0.25, t); if (a < 0.004) discard; vec3 c = mix(uB, mix(uA, vec3(1.0), core), core); ${FXB.on ? "gl_FragColor = bOut_(c, a);" : "gl_FragColor = vec4(c * a, a);\n    #include <colorspace_fragment>"}`
    : `float a = pow(p, 0.8) * 0.5 * uAlpha * smoothstep(0.0, 0.35, t); if (a < 0.004) discard; gl_FragColor = vec4(uD, a);
    #include <colorspace_fragment>`}
  }`;
interface StreakRec { busy: boolean; g: THREE.Group; u: U; }
const getStreak = pool<StreakRec>(fx => {
  const u: U = { uP0: { value: new THREE.Vector3() }, uP1: { value: new THREE.Vector3() }, uW: { value: 0.5 }, uTaper: { value: 1 }, uAlpha: { value: 1 }, uA: { value: col(0xffffff) }, uB: { value: col(0xffffff) }, uD: { value: col(0) } };
  const g = new THREE.Group();
  for (const glow of [false, true]) { const m = new THREE.Mesh(streakGeo, new THREE.ShaderMaterial({ uniforms: { ...u, uOver: { value: glow ? 0 : 0.9 } }, transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide, ...(glow ? glowBlend() : { blending: THREE.NormalBlending }), vertexShader: STREAK_VERT, fragmentShader: streakFrag(glow) })); m.frustumCulled = false; m.renderOrder = glow ? 9 : 8.5; g.add(m); }
  g.visible = false; fx.group.add(g); return { busy: false, g, u };
});
export interface Streak { set: (a: V3, b: V3) => void; }
/** 一道闪线：从 a 到 b，hold 秒里保持（可以 set 改两头，跟着冲刺的人走），然后 fade 秒里收细、淡掉 */
export function streak(api: Api, fx: FxLib, a: V3, b: V3, o: { width?: number; hold?: number; fade?: number; color?: number; color2?: number; deep?: number; taper?: number; alpha?: number } = {}): Streak {
  const R = getStreak(fx), u = R.u, w = o.width ?? 0.5, hold = o.hold ?? 0, fade = o.fade ?? 0.2, al = o.alpha ?? 1;
  (u.uP0.value as THREE.Vector3).set(a.x, a.y, a.z); (u.uP1.value as THREE.Vector3).set(b.x, b.y, b.z); u.uW.value = w; u.uTaper.value = o.taper ?? 1; u.uAlpha.value = al;
  (u.uA.value as THREE.Color).set(o.color ?? 0xe6fbf7); (u.uB.value as THREE.Color).set(o.color2 ?? 0x7fe9e4); (u.uD.value as THREE.Color).set(o.deep ?? 0x0b2f45); R.g.visible = true;
  api.run(hold + fade, k => { const t = k * (hold + fade); if (t > hold) { const f = (t - hold) / fade; u.uW.value = w * (1 - f) * (1 - f * 0.3); u.uAlpha.value = al * (1 - f * f); } }, () => { R.g.visible = false; R.busy = false; });
  return { set(p, q) { (u.uP0.value as THREE.Vector3).set(p.x, p.y, p.z); (u.uP1.value as THREE.Vector3).set(q.x, q.y, q.z); } };
}

// ---------------------------------------------------------------- crown：水冠
// 一圈没有顶和底的水墙：往上长的时候顶上是参差的白沫尖，身上一道道竖的水纹；长到顶以后往外张开、往下塌，最后从下往上淡掉
const crownGeo = (seg: number) => { const g = new THREE.CylinderGeometry(1, 1, 1, seg, 6, true); g.translate(0, 0.5, 0); return g; };
const CROWN_VERT = /* glsl */ `uniform float uFlare; varying float vY, vTh; varying vec3 vN, vV;
  void main(){ vec3 p = position; vY = p.y; vTh = atan(p.x, p.z); float k = 1.0 + uFlare * p.y * p.y; p.xz *= k;
    vec4 mv = modelViewMatrix * vec4(p, 1.0); vN = normalize(normalMatrix * vec3(p.x, -uFlare * 0.6, p.z)); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const CROWN_FRAG = /* glsl */ `uniform float uTop, uAlpha, uSeed, uLow, uTime, uBreak; uniform vec3 uA, uB, uD; varying float vY, vTh; varying vec3 vN, vV; ${NOISE}
  void main(){ float th = vTh * 1.2732 + uSeed;      // 一圈分成 8 个单位，噪声沿着一圈是连续的
    float lobe = vn(vec2(th * 2.2, uSeed)) * 0.3 + pow(vn(vec2(th * 6.0, uSeed + 3.0)), 2.0) * 0.22;      // 顶上是圆的水舌，几根长一点，不是冰碴似的尖
    float top = uTop * (0.6 + lobe); if (vY > top) discard;
    float lip = smoothstep(top - 0.15, top - 0.015, vY);                                 // 顶上一道白沫
    float streaks = 0.6 + 0.4 * vn(vec2(th * 16.0, vY * 2.0 - uTime * 3.0));            // 竖的水纹
    float fr = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.5);
    float brk = smoothstep(uBreak - 0.12, uBreak + 0.04, vn(vec2(th * 5.0, vY * 5.0 - uTime * 2.0) + uSeed));      // 塌下去的时候碎成一块块，不是整圈一起变淡
    float a = (${FXB.on ? "0.34 + 0.42" : "0.16 + 0.32"} * fr + 0.62 * lip) * streaks * brk * smoothstep(uLow, uLow + 0.25, vY) * uAlpha; if (a < 0.004) discard;      // 换画风 B：水墙的身子实一倍（亮地面上透明的浅青就是一层白膜）
    vec3 c = mix(mix(uD, uB, smoothstep(0.0, 0.8, vY / max(top, 0.01)) * 0.75 + fr * 0.25), uA, lip);
    gl_FragColor = vec4(c, min(a, 1.0));
    #include <colorspace_fragment>
  }`;
interface CrownRec { busy: boolean; m: THREE.Mesh; u: U; }
const getCrown = pool<CrownRec>(fx => {
  const u: U = { uTop: { value: 0 }, uAlpha: { value: 1 }, uSeed: { value: 0 }, uLow: { value: 0 }, uBreak: { value: 0 }, uFlare: { value: 0.3 }, uTime: { value: 0 }, uA: { value: col(0xffffff) }, uB: { value: col(0xffffff) }, uD: { value: col(0) } };
  const m = new THREE.Mesh(crownGeo(LITE ? 24 : 48), new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false, side: THREE.DoubleSide, vertexShader: CROWN_VERT, fragmentShader: CROWN_FRAG }));
  m.frustumCulled = false; m.renderOrder = 7.5; m.visible = false; fx.group.add(m); return { busy: false, m, u };
});
/** 一圈水冠：底圈半径 r，rise 秒里长到 h 米高，（hold 秒里立着不动，水纹照样往上走），之后往外张到 r2、往下塌，总共 life 秒 */
export function crown(api: Api, fx: FxLib, x: number, z: number, o: { r: number; r2?: number; h: number; life?: number; rise?: number; hold?: number; color?: number; color2?: number; deep?: number; alpha?: number; flare?: number; y?: number }) {
  const R = getCrown(fx), u = R.u, life = o.life ?? 0.6, rise = o.rise ?? life * 0.28, hold = o.hold ?? 0, r2 = o.r2 ?? o.r * 1.5, al = o.alpha ?? 0.9, y = o.y ?? fx.ground(x, z) - 0.05;
  (u.uA.value as THREE.Color).set(o.color ?? 0xf2fffc); (u.uB.value as THREE.Color).set(o.color2 ?? 0x7fe9e4); (u.uD.value as THREE.Color).set(o.deep ?? 0x16506a); u.uSeed.value = Math.random() * 50; u.uFlare.value = o.flare ?? 0.35;
  R.m.position.set(x, y, z); R.m.visible = true;
  api.run(life, k => { const t = k * life, g = Math.min(1, t / rise), e = 1 - (1 - g) * (1 - g), f = Math.max(0, (t - rise - hold) / Math.max(1e-3, life - rise - hold));
    const rr = o.r + (r2 - o.r) * (0.35 * e + 0.65 * f * (2 - f)); R.m.scale.set(rr, o.h * (e * (1 - 0.55 * f * f)), rr);
    u.uTop.value = e; u.uLow.value = f * f * 0.8; u.uBreak.value = f * 0.9; u.uAlpha.value = al * Math.min(1, t / 0.03) * (1 - f * f * 0.7); u.uTime.value = fx.time(); }, () => { R.m.visible = false; R.busy = false; });
}

// ---------------------------------------------------------------- mark：贴地的印记
// 一张铺在地上的网格（每个顶点落在各自位置的地面上），图案在着色器里现算；p 是 [-1,1] 的本地坐标（x 横、y 是本地的 z 向前）。
//   0 刀痕：一道月牙形的湿印，外沿一道白沫，刚出来时中间一道发亮的芯
//   1 水痕：沿本地 z 从 -1 画到 uHead 的一道湿印（钩子、冲刺划过地面），两边白沫，中间发亮的芯
//   2 裂纹：从中心放射出去的几道裂口，刚出来时里面亮着，很快凉成暗的；中心一块砸出来的湿印
//   3 湿印：一摊边缘不齐的深色水渍
//   4 涨潮：一大片暗下去的水，边上一道清楚的白沫（范围），里面细的水流纹
//   5 预告：落点的一圈，边线清楚、几道刻度往里收、里面很淡的一层（给敌人看范围）
//   6 刮痕：扇形里几道同心的弧形刮痕（重武器扫过地面）
const MARK_VERT = /* glsl */ `varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const MARK_FRAG = /* glsl */ `uniform int uKind; uniform float uK, uHot, uAlpha, uSeed, uHead, uW, uDis, uTime, uAng, uS; uniform vec3 uA, uB, uD; varying vec2 vP; ${NOISE}
  void main(){ vec2 p = vP / uS; float r = length(p), a = 0.0, hot = 0.0, foam = 0.0;
    if (uKind == 0) {                                          // 刀痕
      float x = p.x, zc = 0.5 * (1.0 - x * x) - 0.15, w = uW * pow(max(0.0, 1.0 - x * x), 0.8), d = p.y - zc;
      float n = vn(vec2(x * 6.0 + uSeed, uSeed)) * 0.3;
      float body = 1.0 - smoothstep(w * 0.45, w * (1.0 + n), abs(d)); foam = (1.0 - smoothstep(0.0, w * 0.3 + 0.012, abs(d - w * 0.62))) * step(0.0, d) * 0.9;
      hot = (1.0 - smoothstep(0.0, w * 0.35 + 0.01, abs(d))) * step(abs(x), 0.96);
      a = body * 0.62;
    } else if (uKind == 1) {                                   // 水痕
      float z = p.y, w = uW * mix(0.3, 1.0, smoothstep(-1.0, -0.2, z)) * (0.8 + 0.4 * vn(vec2(z * 6.0 + uSeed, 1.0))), d = abs(p.x);
      float along = step(z, uHead) * smoothstep(-1.0, -0.9, z) * (1.0 - smoothstep(0.85, 1.0, z));
      float body = 1.0 - smoothstep(w * 0.3, w, d); foam = (1.0 - smoothstep(0.0, w * 0.16 + 0.01, abs(d - w * 0.7))) * step(0.6, vn(vec2(z * 10.0 + sign(p.x) * 7.0, uSeed))) * 0.4;      // 两边的白沫是断断续续的、很少（多了像两道车辙）
      hot = (1.0 - smoothstep(0.0, w * 0.3, d)) * (0.35 + 0.65 * smoothstep(uHead - 0.6, uHead, z));
      a = body * 0.3 * along; foam *= along; hot *= along;
    } else if (uKind == 2) {                                   // 裂纹
      float th = atan(p.x, p.y), w = fbm(vec2(th * 2.0 + uSeed, r * 3.0));
      float ln = 1.0 - smoothstep(0.0, 0.035 + 0.03 * (1.0 - r), abs(fract(th * 1.1 + w * 0.8 + uSeed) - 0.5) - 0.44 + r * 0.03);
      ln *= (1.0 - smoothstep(0.55, 1.0, r + (w - 0.5) * 0.3)) * smoothstep(0.08, 0.2, r);
      float pit = 1.0 - smoothstep(0.18, 0.42, r + (vn(p * 6.0 + uSeed) - 0.5) * 0.15);
      a = max(ln * 0.5, pit * 0.26); hot = ln * (1.0 - smoothstep(0.4, 1.0, r)) + pit * 0.5; foam = ln * 0.2;
    } else if (uKind == 3) {                                   // 湿印
      float n = fbm(p * 2.6 + uSeed); a = (1.0 - smoothstep(0.55, 1.0, r + (n - 0.5) * 0.5)) * (0.26 + 0.14 * n); foam = (1.0 - smoothstep(0.0, 0.04, abs(r + (n - 0.5) * 0.5 - 0.8))) * 0.14;
    } else if (uKind == 4) {                                   // 涨潮
      float th = atan(p.x, p.y), n = fbm(p * 1.3 + vec2(uTime * 0.05, uSeed)), rr = r + (vn(vec2(th * 6.0 + uSeed, uTime * 0.5)) - 0.5) * 0.025;
      float lines = smoothstep(0.8, 1.0, sin((r - uTime * 0.12) * 46.0 + n * 3.0) * 0.5 + 0.5) * smoothstep(0.45, 0.9, r) * (1.0 - step(0.93, rr));      // 靠边几道往外走的细浪线
      a = (1.0 - smoothstep(0.935, 0.975, rr)) * (0.34 + 0.12 * n * smoothstep(0.0, 0.8, r));
      foam = (1.0 - smoothstep(0.0, 0.022, abs(rr - 0.955))) * (0.75 + 0.25 * vn(vec2(th * 24.0 + uSeed, uTime))) + lines * 0.1;
    } else if (uKind == 5) {                                   // 预告
      float th = atan(p.x, p.y), rim = 1.0 - smoothstep(0.0, 0.025, abs(r - 0.965));
      float tick = step(0.82, fract(th * 2.546 + 0.5)) * (1.0 - smoothstep(0.0, 0.08, abs(r - (0.86 - uHead * 0.5)))) * step(0.3, r);
      a = (1.0 - step(0.99, r)) * (0.2 + 0.1 * vn(p * 5.0 + uTime)); foam = rim + tick * 0.8;
    } else {                                                   // 刮痕
      float th = atan(p.x, p.y), inA = 1.0 - smoothstep(uAng - 0.12, uAng, abs(th));
      float g = 0.0; for (int i = 0; i < 3; i++) { float ri = 0.42 + float(i) * 0.2 + (vn(vec2(th * 4.0, float(i) + uSeed)) - 0.5) * 0.05; g = max(g, (1.0 - smoothstep(0.0, 0.02 + 0.008 * float(i), abs(r - ri))) * smoothstep(0.3, 0.55, vn(vec2(th * 9.0 + float(i) * 5.0, uSeed)))); }      // 刮痕是断断续续的
      a = g * inA * 0.6 * smoothstep(0.2, 0.35, r); foam = g * inA * 0.3 * smoothstep(0.2, 0.35, r); hot = g * inA;
    }
    if (uDis > 0.0) { float dn = fbm(p * 3.4 + uSeed * 1.7) * 0.8 + vn(p * 13.0 + uSeed) * 0.2; float keep = smoothstep(uDis * 1.2 - 0.18, uDis * 1.2 - 0.02, dn); a *= keep; foam *= keep; hot *= keep; }      // 淡出：一块块蚀掉，不是整片变淡
    hot *= uHot; foam = clamp(foam, 0.0, 1.0); ${FXB.on ? "if (uKind == 1 || uKind == 3) a *= 1.6;" : ""}      // 换画风 B：水痕、湿印的身子是有颜色的水，厚一些（原来按暗地面调，亮地面上看不出来）
    float alpha = clamp(a + foam * 0.85 + hot, 0.0, 1.0) * uAlpha * (1.0 - step(1.0, max(abs(p.x), abs(p.y)))); if (alpha < 0.004) discard;
    vec3 c = mix(uD, uB, clamp(foam, 0.0, 1.0)); c = mix(c, uA, clamp(hot * 1.2 + foam * 0.4, 0.0, 1.0));
    gl_FragColor = vec4(c, alpha);
    #include <colorspace_fragment>
  }`;
interface MarkRec { busy: boolean; m: THREE.Mesh; u: U; seg: [number, number]; }
const markGeos: Record<string, THREE.BufferGeometry[]> = {};
const markMat = (fx: FxLib) => { void fx; const u: U = { uKind: { value: 0 }, uK: { value: 0 }, uHot: { value: 0 }, uAlpha: { value: 0 }, uSeed: { value: 0 }, uHead: { value: 1 }, uW: { value: 0.2 }, uDis: { value: 0 }, uTime: { value: 0 }, uAng: { value: 0.8 }, uS: { value: 1 }, uA: { value: col(0xffffff) }, uB: { value: col(0xffffff) }, uD: { value: col(0) } };
  return { u, mat: new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, vertexShader: MARK_VERT, fragmentShader: MARK_FRAG }) }; };
const getMark = pool<MarkRec>(fx => { const { u, mat } = markMat(fx); const m = new THREE.Mesh(undefined, mat); m.frustumCulled = false; m.renderOrder = 5.6; m.visible = false; fx.group.add(m); return { busy: false, m, u, seg: [0, 0] }; });
export type MarkKind = "slash" | "wake" | "crack" | "stain" | "tide" | "target" | "groove";
const MK: Record<MarkKind, number> = { slash: 0, wake: 1, crack: 2, stain: 3, tide: 4, target: 5, groove: 6 };
export interface MarkOpts { kind: MarkKind; x: number; z: number; r: number; len?: number; yaw?: number; life: number; grow?: number; hot?: number; hotLife?: number; w?: number; ang?: number; fadeIn?: number; fadeOut?: number; alpha?: number; color?: number; color2?: number; deep?: number; lift?: number; }
export interface Mark { head: (h: number) => void; size: (s: number) => void; kill: (fade?: number) => void; alpha: (a: number) => void; u: U; }
/** 铺一个贴地的印记。r 是横向的半径，len 是本地 z 向的半长（不给就和 r 一样）；hot 是刚出来时亮芯的亮度，hotLife 秒里凉下去。
 *  网格按 r、len 一次贴好地面；要“长大”的（涨潮）用 grow 给开始时是几成、之后 size(k) 改，图案在着色器里缩放，不重新贴地 */
export function mark(api: Api, fx: FxLib, o: MarkOpts): Mark {
  const R = getMark(fx), u = R.u, m = R.m, len = o.len ?? o.r, yaw = o.yaw ?? 0, big = Math.max(o.r, len), sx = Math.min(32, Math.max(2, Math.ceil(o.r / 0.7))), sz = Math.min(48, Math.max(2, Math.ceil(len / 0.7))), key = `${sx}x${sz}`;
  if (R.seg[0] !== sx || R.seg[1] !== sz) { if (m.geometry && R.seg[0]) (markGeos[`${R.seg[0]}x${R.seg[1]}`] ??= []).push(m.geometry); m.geometry = markGeos[key]?.pop() ?? new THREE.PlaneGeometry(2, 2, sx, sz).rotateX(-Math.PI / 2); R.seg = [sx, sz]; }
  void big;
  m.rotation.set(0, yaw, 0); m.scale.set(o.r, 1, len); m.position.set(o.x, 0, o.z);
  const pos = m.geometry.getAttribute("position") as THREE.BufferAttribute, cs = Math.cos(yaw), sn = Math.sin(yaw), lift = o.lift ?? 0.08;
  for (let i = 0; i < pos.count; i++) { const lx = pos.getX(i) * o.r, lz = pos.getZ(i) * len; pos.setY(i, fx.ground(o.x + lx * cs + lz * sn, o.z - lx * sn + lz * cs) + lift); }
  pos.needsUpdate = true;
  u.uKind.value = MK[o.kind]; u.uSeed.value = Math.random() * 40; u.uHead.value = 1; u.uW.value = o.w ?? 0.2; u.uAng.value = o.ang ?? 0.8; u.uDis.value = 0; u.uS.value = o.grow ?? 1;
  (u.uA.value as THREE.Color).set(o.color ?? 0xf2fffc); (u.uB.value as THREE.Color).set(o.color2 ?? 0xbff5ee); (u.uD.value as THREE.Color).set(o.deep ?? 0x0b2f45); m.visible = true;
  const life = o.life, fi = o.fadeIn ?? 0.04, fo = o.fadeOut ?? 0.45, hot = o.hot ?? 0, hl = o.hotLife ?? 0.25; let al = o.alpha ?? 1;
  let t = 0, done = false, kT = -1, kF = 0.4;      // kT：被提前 kill 的时刻，之后 kF 秒里蚀掉
  const finish = () => { if (done) return; done = true; m.visible = false; R.busy = false; };
  const frame = (dt: number) => {
    if (done) return; t += dt;
    const k = Math.min(1, t / life), out = Math.min(1, (1 - k) / Math.max(1e-3, fo), kT >= 0 ? 1 - (t - kT) / kF : 1);
    if (out <= 0) { finish(); return; }
    u.uK.value = k; u.uDis.value = 1 - out; u.uAlpha.value = al * Math.min(1, t / Math.max(1e-3, fi * life)) * Math.sqrt(out); u.uHot.value = hot * Math.max(0, 1 - t / hl) ** 1.5; u.uTime.value = fx.time();
  };
  frame(0); api.run(life, (_k, dt) => frame(dt), finish);
  return { u, head(h) { u.uHead.value = h; }, size(k) { if (!done) u.uS.value = Math.max(0.01, k); }, alpha(a) { al = a; },
    kill(fade = 0.4) { if (done || kT >= 0) return; kT = t; kF = Math.max(0.01, fade); } };
}

// ---------------------------------------------------------------- dome：声壳
const domeGeo = (() => { const g = new THREE.SphereGeometry(1, LITE ? 24 : 40, LITE ? 8 : 14, 0, Math.PI * 2, 0, Math.PI / 2); return g; })();
const DOME_VERT = /* glsl */ `varying vec3 vN, vV; varying float vY; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vY = position.y; gl_Position = projectionMatrix * mv; }`;
const DOME_FRAG = /* glsl */ `uniform float uAlpha, uTime, uSeed; uniform vec3 uA, uB; varying vec3 vN, vV; varying float vY; ${NOISE}
  void main(){ float fr = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
    float band = smoothstep(0.75, 1.0, sin(vY * 18.0 - uTime * 14.0 + uSeed) * 0.5 + 0.5) * (1.0 - vY) * 0.5;
    float a = (fr * ${FXB.on ? "1.0 + band * 0.5 + 0.1" : "0.85 + band * 0.35 + 0.03"}) * smoothstep(0.0, 0.06, vY) * uAlpha; if (a < 0.004) discard;      // 换画风 B：声壳的边和身子都实一些
    gl_FragColor = vec4(mix(uB, uA, clamp(fr * 1.2, 0.0, 1.0)), min(a, 1.0));
    #include <colorspace_fragment>
  }`;
interface DomeRec { busy: boolean; m: THREE.Mesh; u: U; }
const getDome = pool<DomeRec>(fx => { const u: U = { uAlpha: { value: 0 }, uTime: { value: 0 }, uSeed: { value: 0 }, uA: { value: col(0xffffff) }, uB: { value: col(0xffffff) } };
  const m = new THREE.Mesh(domeGeo, new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false, side: THREE.DoubleSide, vertexShader: DOME_VERT, fragmentShader: DOME_FRAG })); m.frustumCulled = false; m.renderOrder = 7.4; m.visible = false; fx.group.add(m); return { busy: false, m, u }; });
/** 一个往外鼓的声壳：grow 秒里从 r0 长到 r1（高是半径的 hk 倍），之后 fade 秒里淡掉 */
export function dome(api: Api, fx: FxLib, x: number, y: number, z: number, o: { r0: number; r1: number; hk?: number; grow?: number; fade?: number; alpha?: number; color?: number; color2?: number }) {
  const R = getDome(fx), u = R.u, grow = o.grow ?? 0.45, fade = o.fade ?? 0.25, hk = o.hk ?? 0.55, al = o.alpha ?? 0.6;
  (u.uA.value as THREE.Color).set(o.color ?? 0xf2fffc); (u.uB.value as THREE.Color).set(o.color2 ?? 0x7fe9e4); u.uSeed.value = Math.random() * 9; R.m.position.set(x, y, z); R.m.visible = true;
  api.run(grow + fade, k => { const t = k * (grow + fade), g = Math.min(1, t / grow), e = 1 - Math.pow(1 - g, 2.2), r = o.r0 + (o.r1 - o.r0) * e; R.m.scale.set(r, r * hk * (1 - 0.25 * e), r);
    u.uAlpha.value = al * Math.min(1, t / 0.04) * (t < grow ? 1 - 0.45 * g : 0.55 * (1 - (t - grow) / fade)); u.uTime.value = fx.time(); }, () => { R.m.visible = false; R.busy = false; });
}

// ---------------------------------------------------------------- 起手有多长
/** 这一招从按下到出手有多久（对局时间），起手的预兆按它定长短。
 *  老的时间表按 release / speed 算；第九轮 feel 任务（手感）以后，前摇是时间表里的 pre 秒（没写 pre 的：普通技能 0.25、大招 0.35，原来就更快的不动）。
 *  两种都认：合并 feel 以后前摇变短了，预兆跟着变短，不会出现“已经出手了，起手的光还在往上涨”。key 是时间表里的名字（q、w、r） */
export function windup(a: Actor, key: string, ult = false): number {
  const m = (a.meta.skills as Record<string, { release: number; speed?: number; pre?: number }>)[key]; if (!m) return 0.25;
  const old = m.release / (m.speed ?? 1); if (m.pre !== undefined) return m.pre;
  return "preK" in a.meta ? Math.min(old, ult ? 0.35 : 0.25) : old;
}

// ---------------------------------------------------------------- 粒子的小组合
/** 朝一个方向的一道尖的闪光（拉长的火花粒子，几乎不动、很快没）：钩子出手、突刺 */
export function spear(fx: FxLib, pos: V3, dir: V3, o: { size?: number; color?: number; life?: number; n?: number } = {}) {
  const s = o.size ?? 1;
  fx.burst({ pos, n: o.n ?? 1, sprite: SPR.streak, add: true, color: [0xffffff, o.color ?? 0x7fe9e4], size: [0.5 * s, 0.6 * s], life: o.life ?? 0.12, speed: [16 * s, 20 * s], dir, spread: 0.04, drag: 18, stretch: 4 });
  fx.burst({ pos, n: 1, sprite: SPR.glint, add: true, color: 0xffffff, size: 0.9 * s, grow: 1.3, life: 0.09, speed: 0, alpha: 0.9 });
}
/** 往一点收拢的水珠：在半径 r 的球壳上出生、朝中心飞，life 秒正好到 */
export function converge(fx: FxLib, c: V3, r: number, n: number, life: number, color: [number, number], o: { add?: boolean; size?: [number, number]; flat?: boolean } = {}) {
  const k = LITE ? Math.ceil(n / 2) : n;
  for (let i = 0; i < k; i++) { const a = Math.random() * 6.2832, e = o.flat ? (Math.random() - 0.3) * 0.5 : (Math.random() - 0.35) * 2.2, cx = Math.cos(a) * Math.cos(e), cy = Math.sin(e), cz = Math.sin(a) * Math.cos(e), rr = r * (0.75 + Math.random() * 0.25);
    fx.burst({ pos: { x: c.x + cx * rr, y: c.y + cy * rr, z: c.z + cz * rr }, n: 1, sprite: o.add ? SPR.glint : SPR.drop, add: o.add, color, size: o.size ?? [0.08, 0.15], life, speed: rr / life, dir: { x: -cx, y: -cy, z: -cz }, spread: 0.02, stretch: 1, grow: 0.5 }); }
}
/** 一圈沿地面往外泼的水（水冠的点缀）：从半径 r 的一圈出生，斜着往外往上飞，落下来 */
export function splash(fx: FxLib, x: number, y: number, z: number, r: number, n: number, speed: [number, number], up: number, color: [number, number], size: [number, number] = [0.1, 0.22]) {
  const k = LITE ? Math.ceil(n / 2) : n;
  for (let i = 0; i < k; i++) { const a = ((i + Math.random()) / k) * 6.2832, cs = Math.cos(a), sn = Math.sin(a);
    fx.burst({ pos: { x: x + cs * r, y, z: z + sn * r }, n: 1, sprite: SPR.drop, color, dir: { x: cs, y: up, z: sn }, spread: 0.2, speed, size, life: [0.4, 0.7], gravity: 13, stretch: 1.1 }); }
}

/** 每种零件先各出一个看不见的（在地下 40 米、完全透明），让着色器趁开局编好，第一次放技能时不卡一下。一局只做一次 */
const warmed = new WeakSet<THREE.Group>();
export function warmFx2a(api: Api, fx: FxLib, x: number, z: number) {
  if (warmed.has(fx.group)) return; warmed.add(fx.group);
  const y = fx.ground(x, z) - 40, p = { x, y, z };
  blade(api, fx, { pos: p, yaw: 0, r: 0.01, life: 0.1, alpha: 0 });
  streak(api, fx, p, { x, y: y + 0.01, z }, { fade: 0.1, alpha: 0 });
  crown(api, fx, x, z, { r: 0.01, h: 0.01, life: 0.1, alpha: 0, y });
  dome(api, fx, x, y, z, { r0: 0.01, r1: 0.02, grow: 0.05, fade: 0.05, alpha: 0 });
  mark(api, fx, { kind: "stain", x, z, r: 0.01, life: 0.1, alpha: 0, lift: -40 });
}
