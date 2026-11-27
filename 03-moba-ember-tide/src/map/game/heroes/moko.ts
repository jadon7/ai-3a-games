// 摩珂 · 引潮人（辅助，沉月会）。
//
// 规格（数值是主线定的第一版，实现时照这个来；觉得哪里不合理，在报告里说，不要自己改数）：
//   普攻     远程，射程 7.5，一颗水珠，速度 20。
//   Q 潮愈   指向友军（没指着别人就放给自己），距离 8.5，冷却 7，法力 70。一道水波从目标开始，在 6 米内的友军之间弹跳，
//            一共治疗 4 次（不会连着两次落在同一个人身上；只有一个友军就只治疗一次）：第一次 180 + 60% 法强 + 每级 25，之后每跳少 15%。
//   W 水泡   指向友军（同上），距离 8.5，冷却 11，法力 70。给目标套一个护盾：320 + 80% 法强 + 每级 40，持续 4 秒。
//            护盾被打破或者到时间时水泡破裂：周围 3 米的敌人减速 40% 1.5 秒，受 80 + 30% 法强的魔法伤害。
//   E 回流   非指向，距离 9，宽 3，冷却 12，法力 70。吹响螺号，一道潮水沿直线冲出去（速度 26）：碰到的敌人被顺着方向推开 4 米，
//            受 200 + 50% 法强 + 每级 25 的魔法伤害，减速 30% 1.5 秒。
//   R 月潮   大招，6 级，直接放，冷却 80，法力 130。以施放时站的位置为中心召来潮水，持续 6 秒，半径从 4 米涨到 8 米：
//            里面的友军每 0.5 秒回复 45 + 12% 法强 + 每级 8；敌人减速 35%，每 0.5 秒受 30 + 10% 法强 + 每级 6 的魔法伤害。
//
// 写法照 heroes/lan.ts：每个技能的特效分三层（出手的预兆、过程、命中或落地），颜色用下面这几个常量。
// 动作时间表在 public/assets/hero/moko.json（资源那边做完才有；没有时控制器用默认的出手时间，不影响先把技能和特效做出来）。
//
// 实现时定下来的几处细节（规格里没写死的）：
//   · 潮愈“每跳少 15%”按连乘算（100%、85%、72%、61%）。下一跳挑 6 米内还没满血的友军里这次被治疗次数最少、血量比例最低的；都满血了也照样跳。
//   · 水泡破裂、回流、月潮的伤害都不打建筑。
//   · 回流的判定是一个 9×3 的长方形（和施法指示一样），浪的前沿扫到谁就算碰到谁；撞墙就停。
//   · 月潮按了就结算第一次，之后每 0.5 秒一次，一共 12 次（最后一次在第 5.5 秒）；水面在最后半秒淡出。
//
//   · 治疗量的数字（“+585”）由画面那边统一显示（view.ts 的 heal 事件），这里不再自己跳。
//
// 特效库里没有的几样东西，在这个文件里用 three.js 补了（“自己补的零件”那一段）：带菲涅尔边缘的球壳（水泡、普攻的水珠）、
// 弧形的水带（潮愈的每一跳）、一道浪和它身后退去的水（回流）、贴着地形的月光水面和一柱月光（月潮）。水都是普通半透明，不叠加发光；
// 叠加的只有月光那一柱（很淡）和命中时零点一几秒的一下闪。月潮的水面借用了河面的水纹贴图（slice/ripple.ts），所以粼光和河是一路的；
// 特效落在河里时调 slice/water.ts 的 addWake，让河面真的起一圈波。
//
// 第九轮 fx2b 重做了表现（数值、时间点没动）：给友军的潮愈、水泡用“往上旋的光带 + 亮环 + 小星”的治疗语言和一个会合拢、有锐利亮边的罩子，
// 颜色往薄荷青偏（HEAL），和伤害分开；回流的浪加高到 1.5 米、浪身更实，打中的人身上冲起水柱和一圈水环，身后留一道湿痕；
// 月潮的范围边上加了一圈翻起来的白沫水墙。新零件在 ../fx_fx2b.ts。

import * as THREE from "three";
import type { Ent } from "../sim";
import type { Api, HeroKit, ProjVis, SkillDef } from "../skills";
import { SPR, type Decal, type FxLib } from "../fxlib";
import { rippleNormal } from "../../slice/ripple";
import { addWake } from "../../slice/water";
import { helix, plus, thickRing, wall, warm2b } from "../fx_fx2b";
import { BOUT, FXB, glowBlend, glowOut, pick } from "../fxb";

const TIDE = pick(0x58e6e0, 0x1cbfd8), PEARL = 0xe8fbf6, DEEP = pick(0x1f8fa0, 0x1270a8), MOON = pick(0xbfe9ff, 0x58aef2);      // 潮水的青、珍珠白、深水、月光的淡蓝
// 换画风 B（b-fx）：亮地面上浅青的水、淡蓝的月光叠上去看不见（泡泡、水柱、治疗罩都成了一层白膜）。B 下潮水是饱和的水青、深水是海蓝、月光是饱和一档的天蓝；白只留给高光和白沫
const isBuilding = (e: Ent) => e.kind === "tower" || e.kind === "core";
const v3 = () => new THREE.Vector3();
const sstep = (a: number, b: number, x: number) => { const k = Math.max(0, Math.min(1, (x - a) / (b - a))); return k * k * (3 - 2 * k); };

// ---------------------------------------------------------------- 自己补的零件
const CLK = { value: 0 };                                     // 这几样零件共用的时钟（passive 里每帧对一次特效库的时间）
const uc = (c: number) => ({ value: new THREE.Color(c) });
const NOISE = /* glsl */ `
  float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
  float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 3; i++) { s += a * vn(p); p = p * 2.03 + 11.7; a *= 0.5; } return s / 0.875; }
`;

/** 球壳：中间几乎是透明的，边缘一圈亮（菲涅尔），膜上有往下淌的水纹，左上一块高光。水泡和普攻的水珠都用它 */
let BALL: THREE.SphereGeometry | null = null;
// 第九轮 fx2b：护盾要“一眼看得出是个罩子”——轮廓一道锐利的亮边（两层菲涅尔：一层宽的、一层很细的线）、一道从下往上慢慢扫过去的反光；
// uFill 让罩子从下往上合拢（合拢的前沿一道白沫），uHit 是被打时亮一下、晃一下。水珠（普攻、潮愈的头）不用这几样，uFill 留 1、uHit 留 0
function shell(body: number, rim: number, wob: number) {
  const u = { uTime: CLK, uAlpha: { value: 1 }, uWob: { value: wob }, uBody: { value: body }, uRim: { value: rim }, uFill: { value: 1 }, uHit: { value: 0 }, uSweep: { value: 0 }, uA: uc(TIDE), uB: uc(PEARL), uC: uc(DEEP) };
  const mat = new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false,
    vertexShader: /* glsl */ `uniform float uTime, uWob, uHit; varying vec3 vN, vV, vO;
      void main() { vO = position; float w = sin(position.y * 4.0 + uTime * 2.6) * 0.02 + sin(position.x * 5.0 + position.z * 3.0 - uTime * 3.4) * 0.016 + sin(position.y * 9.0 - uTime * 30.0) * 0.03 * uHit;
        vec4 mv = modelViewMatrix * vec4(position * (1.0 + w * uWob), 1.0); vN = normalMatrix * normal; vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `uniform float uTime, uAlpha, uBody, uRim, uFill, uHit, uSweep; uniform vec3 uA, uB, uC; varying vec3 vN, vV, vO; ${NOISE}
      void main() { float front = mix(-1.15, 1.15, uFill) + (vn(vec2(atan(vO.z, vO.x) * 3.0, uTime * 3.0)) - 0.5) * 0.12 * (1.0 - uFill); if (vO.y > front) discard;
        vec3 N = normalize(vN), V = normalize(vV); float f = 1.0 - max(dot(N, V), 0.0), rim = pow(f, 2.4), line = pow(f, 9.0);
        float film = fbm(vO.xy * 2.4 + vec2(vO.z * 1.7 + uTime * 0.2, uTime * 0.45)), flow = smoothstep(0.52, 0.8, film) * (0.25 + 0.75 * f);
        float spec = pow(max(dot(N, normalize(normalize(vec3(-0.5, 0.8, 0.45)) + V)), 0.0), 70.0) + 0.3 * pow(max(dot(N, normalize(normalize(vec3(0.55, -0.5, 0.4)) + V)), 0.0), 26.0);
        float sw = exp(-pow((vO.y - (fract(uTime * 0.42) * 2.8 - 1.4)) / 0.16, 2.0)) * uSweep * (0.35 + 0.65 * f);      // 一道反光从下往上扫
        float cn = vn(vO.xz * 3.2 + vec2(vO.y * 2.0 + uTime * 0.6, -uTime * 0.4)) * 0.6 + vn(vO.yx * 5.0 - uTime * 0.7) * 0.4; sw += smoothstep(0.86, 0.98, 1.0 - abs(cn - 0.5) * 2.0) * 0.55 * uSweep;      // 膜上流动的细水纹（焦散），一看就是水做的罩子
        float seam = (1.0 - smoothstep(0.0, 0.1, front - vO.y)) * step(uFill, 0.999);                                       // 正在合拢的前沿
        float a = (uBody${FXB.on ? " * 3.2" : ""} + rim * uRim * (1.0 + 1.6 * uHit) + line * 0.55 * uSweep + flow * 0.16 + spec * 0.85 + sw * 0.4 + seam * 0.7) * uAlpha; if (a < 0.004) discard;      /* 换画风 B：罩子里有一层淡淡的水色，一眼看得出是个实的水泡 */
        vec3 c = mix(mix(uC, uA, 0.35 + 0.65 * f), uB, clamp(rim * ${FXB.on ? "0.2" : "0.55"} + flow * 0.5 + spec * 1.5 + sw + seam + line * ${FXB.on ? "0.5" : "0.9"} + uHit * 0.5, 0.0, 1.0));      /* 轮廓留一点青，不全是白（换画风 B：轮廓基本是饱和的水青，白只在高光上——亮地面上白边看不见） */
        gl_FragColor = vec4(c, min(a, 0.95));
        #include <colorspace_fragment>
      }` });
  return { u, mat, mesh() { const m = new THREE.Mesh(BALL ??= new THREE.SphereGeometry(1, 32, 22), mat); m.frustumCulled = false; m.renderOrder = 7; return m; } };
}
let BEAD: ReturnType<typeof shell> | null = null;             // 普攻的水珠共用一份材质
/** 水泡的罩子进池子（第九轮 polish-old）：原来每套一次盾新建一份材质、一个网格，破了再销毁；团战里几个摩珂轮着套盾就不停地建、扔。
 *  现在破了的罩子收回来，下次把参数（透明、合拢、晃动……）重置了接着用 */
type Shell = ReturnType<typeof shell> & { m: THREE.Mesh };
const SHIELDS: Shell[] = [];
function getShield(): Shell { const sh = SHIELDS.pop() ?? (() => { const s0 = shell(0.05, 0.8, 1); return { ...s0, m: s0.mesh() }; })(), u = sh.u;
  u.uAlpha.value = 1; u.uWob.value = 1; u.uBody.value = 0.05; u.uRim.value = 0.8; u.uFill.value = 0; u.uHit.value = 0; u.uSweep.value = 1; sh.m.scale.setScalar(1); return sh; }

/** 水带：沿一条路径铺开的一段，尾巴细、头上圆，朝着镜头展开。path(k) 给出路径上 k∈[0,1] 处的位置 */
function ribbon(fx: FxLib, width: number, N = 16) {
  const n = (N + 1) * 2, P = new Float32Array(n * 3), D = new Float32Array(n * 3), UV = new Float32Array(n * 2), idx: number[] = [], pts = Array.from({ length: N + 1 }, v3);
  for (let i = 0; i <= N; i++) { UV.set([i / N, -1, i / N, 1], i * 4); if (i < N) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); } }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(P, 3)); g.setAttribute("aDir", new THREE.BufferAttribute(D, 3)); g.setAttribute("aUV", new THREE.BufferAttribute(UV, 2)); g.setIndex(idx);
  const u = { uTime: CLK, uAlpha: { value: 1 }, uW: { value: width }, uSeed: { value: Math.random() * 30 }, uA: uc(TIDE), uB: uc(PEARL), uC: uc(DEEP) };
  const mat = new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: /* glsl */ `attribute vec3 aDir; attribute vec2 aUV; uniform float uW; varying vec2 vUv;
      void main() { vUv = aUV; vec4 mv = modelViewMatrix * vec4(position, 1.0); vec2 t = (modelViewMatrix * vec4(aDir, 0.0)).xy; float l = length(t); t = l > 1e-5 ? t / l : vec2(1.0, 0.0);
        float w = uW * pow(aUV.x, 0.7) * (1.0 - 0.45 * smoothstep(0.85, 1.0, aUV.x)); mv.xy += vec2(-t.y, t.x) * aUV.y * w; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `uniform float uTime, uAlpha, uSeed; uniform vec3 uA, uB, uC; varying vec2 vUv; ${NOISE}
      void main() { float u = vUv.x, v = abs(vUv.y), e = 1.0 - smoothstep(0.5, 1.0, v);
        float n = vn(vec2(u * 6.0 - uTime * 4.0 + uSeed, vUv.y * 1.5 + uSeed));
        float foam = clamp(smoothstep(0.5, 0.82, n) * 0.55 + smoothstep(0.55, 1.0, u) * 0.38 + (1.0 - smoothstep(0.0, 0.4, v)) * 0.22, 0.0, 1.0);      // 白沫：越往头上越多，身上顺着流的几道，中间一条亮
        vec3 c = mix(mix(uC, uA, 0.3 + 0.7 * e), uB, foam);
        float a = e * (0.62 + 0.34 * foam) * smoothstep(0.0, 0.35, u) * uAlpha; if (a < 0.004) discard;
        gl_FragColor = vec4(c, a);
        #include <colorspace_fragment>
      }` });
  const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.renderOrder = 8; fx.group.add(m);
  return { u,
    set(path: (k: number, out: THREE.Vector3) => THREE.Vector3, k0: number, k1: number) {
      for (let i = 0; i <= N; i++) path(k0 + (k1 - k0) * (i / N), pts[i]);
      for (let i = 0; i <= N; i++) { const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(N, i + 1)], o = i * 6;
        for (const s of [0, 3]) { P[o + s] = p.x; P[o + s + 1] = p.y; P[o + s + 2] = p.z; D[o + s] = b.x - a.x; D[o + s + 1] = b.y - a.y; D[o + s + 2] = b.z - a.z; } }
      g.attributes.position.needsUpdate = true; g.attributes.aDir.needsUpdate = true;
    },
    kill() { fx.group.remove(m); g.dispose(); mat.dispose(); } };
}

/** 一道浪（回流）：前头是一道往前卷的浪（背后一道长长的缓坡，浪顶往前卷出一道白沫的浪唇），身后拖一条贴着地形、很快退去的水。
 *  第九轮 polish-old：原来浪高 1.7 米、前脸几乎竖直，俯视是一块立着的青色板子（像一堵墙）。现在矮到 0.9 米上下（几股涌此起彼伏，高的那股一米出头）、背坡拉长到 3 米多，
 *  背坡是透的、看得见水往浪顶上涌；浪顶往前卷过头、浪唇悬在半空往下翻（底下是空的，不是一面墙），白沫只在浪唇上 */
let CREST: THREE.BufferGeometry | null = null; const CREST_H = 0.95;
function crestGeo() {
  if (CREST) return CREST;
  const prof: [number, number][] = [[-3.0, 0], [-2.2, 0.05], [-1.5, 0.17], [-0.95, 0.38], [-0.45, 0.64], [-0.05, 0.86], [0.3, 0.96], [0.58, 0.9], [0.76, 0.72], [0.74, 0.52], [0.56, 0.4]];      // 剖面（往前几米、多高）：后面一道长缓坡，浪顶往前卷，浪唇往下翻、卷回来（最后一点不着地）
  const COLS = 20, n = prof.length, pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let j = 0; j <= COLS; j++) { const s = (j / COLS) * 2 - 1, hf = 1 - 0.7 * Math.pow(Math.abs(s), 2.2), bow = 0.55 * s * s;      // 两头矮、落后：从上面看是一道往前鼓的弧（第九轮 fx2b：原来两头只矮四成，像一块立着的板）
    prof.forEach(([z, y], i) => { pos.push(s * 1.85, y * hf, z * (0.75 + 0.25 * hf) - bow); uv.push(s, i / (n - 1)); }); }
  for (let j = 0; j < COLS; j++) for (let i = 0; i < n - 1; i++) { const a = j * n + i, b = a + n; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  CREST = new THREE.BufferGeometry(); CREST.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); CREST.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); CREST.setIndex(idx); return CREST;
}
function wave(fx: FxLib, x0: number, z0: number, dx: number, dz: number, len: number, half: number, speed: number) {
  const uA = uc(TIDE), uB = uc(PEARL), uC = uc(DEEP), seed = { value: Math.random() * 30 };
  const cu = { uTime: CLK, uAlpha: { value: 1 }, uSeed: seed, uA, uB, uC };
  const cmat = new THREE.ShaderMaterial({ uniforms: cu, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: /* glsl */ `uniform float uTime, uSeed; varying vec2 vUv; varying float vLobe;
      // 第九轮 polish-old：浪头沿着宽度分成几股此起彼伏的涌（原来整条一样高，俯视就是一道横着的墙）。lobe 高的那股往前探、浪唇白沫多，低的那股几乎平下去
      void main() { vUv = uv; vec3 p = position; float k = smoothstep(0.25, 0.5, uv.y), lobe = 0.5 + 0.32 * sin(uv.x * 4.2 + uTime * 4.0 + uSeed) + 0.18 * sin(uv.x * 9.5 - uTime * 6.5 + uSeed * 2.0);
        p.y *= mix(1.0, 0.5 + 0.85 * lobe, k) + 0.05 * sin(uv.x * 17.0 - uTime * 13.0 + uSeed * 2.0) * k; p.z += (0.45 * lobe - 0.2) * k; vLobe = lobe; gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }`,
    fragmentShader: /* glsl */ `uniform float uTime, uAlpha, uSeed; uniform vec3 uA, uB, uC; varying vec2 vUv; varying float vLobe; ${NOISE}
      void main() { float s = vUv.x, t = vUv.y, n = fbm(vec2(s * 3.5 + uSeed, t * 5.0 - uTime * 3.0));
        // 第九轮 polish-old 换了剖面（见 crestGeo），t：0 背坡的脚、0.5 快到浪顶、0.6 浪顶、0.7 往后是往前卷、往下翻的浪唇。
        // 背坡：透的深青，一道道往浪顶涌的水纹；浪顶：一道受光的亮青；浪唇：白沫，碎的，越往唇尖越碎越淡（底下是空的）
        float flow = smoothstep(0.62, 0.88, vn(vec2(s * 8.0 + uSeed, t * 5.0 - uTime * 3.2))) * smoothstep(0.12, 0.3, t) * (1.0 - smoothstep(0.5, 0.6, t));      // 背坡上往上涌的水纹
        float crestL = smoothstep(0.46, 0.58, t) * (1.0 - smoothstep(0.64, 0.72, t));                                                                      // 浪顶受光的一道
        float lip = smoothstep(0.6, 0.68, t + (n - 0.5) * 0.12), brk = smoothstep(0.25, 0.55, n + (1.0 - t) * 0.9 - 0.15 * smoothstep(0.85, 1.0, t));          // 浪唇的白沫，唇尖碎开
        float fl = fbm(vec2(s * 9.0 + uSeed, t * 7.0 - uTime * 4.0)), foamTex = 0.65 + 0.35 * smoothstep(0.35, 0.7, fl);                                         // 白沫自己也有翻滚的纹理（不是一块平涂的白）
        float foam = clamp(lip * (0.6 + 0.4 * brk) * foamTex * (0.35 + 0.65 * smoothstep(0.15, 0.65, vLobe)) * 1.25 + flow * 0.35, 0.0, 1.0);      // 浪唇一道白沫（高的那几股最白）：浪矮了以后它是认出“这是一道浪”的地方
        vec3 c = mix(uC * ${FXB.on ? "0.8" : "0.42"}, mix(uC, uA, 0.38), smoothstep(0.1, 0.5, t)); c = mix(c, uA * 1.05, crestL * 0.7);      // 背坡压深一点：亮的白沫唇才跳出来（换画风 B：只压两成，压到四成在亮地面上是黑的）
        float cn = vn(vec2(s * 7.0 + uSeed - uTime * 0.6, t * 6.0 - uTime * 2.2)) * 0.6 + vn(vec2(s * 13.0 - uTime, t * 11.0 + uSeed)) * 0.4; c += uB * smoothstep(0.88, 0.98, 1.0 - abs(cn - 0.5) * 2.0) * 0.3 * smoothstep(0.15, 0.4, t) * (1.0 - smoothstep(0.55, 0.65, t));      // 浪身里流动的焦散亮线：一看就是水
        c = mix(c, uB, foam);
        float side = 1.0 - smoothstep(0.5, 1.0, abs(s) + (n - 0.5) * 0.3);
        float body = mix(${FXB.on ? "0.22, 0.78" : "0.06, 0.5"}, smoothstep(0.05, 0.55, t)) * (1.0 - lip * 0.3) * (0.55 + 0.45 * smoothstep(0.1, 0.6, vLobe));      // 背坡透（看得见地面），越往浪顶越实；低的那股更透（换画风 B：整道浪实一些，饱和的水青才读得出来）
        float a = (body + foam * 0.7 + crestL * 0.15) * side * uAlpha * (1.0 - 0.6 * smoothstep(0.9, 1.0, t) * (1.0 - brk)); if (a < 0.004) discard;
        gl_FragColor = vec4(c, min(a, 0.92));
        #include <colorspace_fragment>
      }` });
  const crest = new THREE.Mesh(crestGeo(), cmat); crest.frustumCulled = false; crest.renderOrder = 7; crest.rotation.y = Math.atan2(dx, dz); crest.scale.set(half / 1.5 * 1.06, 0.5, 1.15); fx.group.add(crest);      /* 第九轮 fx2b：浪高 0.86 → 1.5 米，原来比人矮一大截，看上去是地上一团白 */
  // 身后的水：一条贴着地形的带子。每一处的水在浪头过去以后零点几秒就退掉
  const NL = 20, NA = 4, pos: number[] = [], q: number[] = [], idx: number[] = [];
  for (let i = 0; i <= NL; i++) for (let j = 0; j <= NA; j++) { const s = (i / NL) * (len + 0.4) - 0.2, w = ((j / NA) * 2 - 1) * (half + 0.3), x = x0 + dx * s + dz * w, z = z0 + dz * s - dx * w; pos.push(x, fx.ground(x, z) + 0.08, z); q.push(w, s); }
  for (let i = 0; i < NL; i++) for (let j = 0; j < NA; j++) { const a = i * (NA + 1) + j, b = a + NA + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const wg = new THREE.BufferGeometry(); wg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); wg.setAttribute("aQ", new THREE.Float32BufferAttribute(q, 2)); wg.setIndex(idx);
  const wu = { uTime: CLK, uHead: { value: 0 }, uT: { value: 0 }, uSeed: seed, uA, uB, uC };
  const wmat = new THREE.ShaderMaterial({ uniforms: wu, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    vertexShader: /* glsl */ `attribute vec2 aQ; varying vec2 vQ; void main() { vQ = aQ; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `uniform float uTime, uHead, uT, uSeed; uniform vec3 uA, uB, uC; varying vec2 vQ; ${NOISE}
      void main() { float age = uT - vQ.y / ${speed.toFixed(1)}; if (vQ.y > uHead || age < 0.0) discard;
        float n = fbm(vec2(vQ.x * 1.2 + uSeed, vQ.y * 0.6 + uTime * 1.6));                                               // 水往回淌
        float side = 1.0 - smoothstep(${(half - 0.45).toFixed(2)}, ${(half + 0.15).toFixed(2)}, abs(vQ.x) + (n - 0.5) * 0.7);      // 两边不齐
        float foam = smoothstep(0.5, 0.78, fbm(vec2(vQ.x * 2.6 - uSeed, vQ.y * 0.9 + uTime * 2.4)));                     // 一道道被拖长的白沫
        float lead = 1.0 - smoothstep(0.0, 1.6, uHead - vQ.y);                                                           // 紧跟着浪头的那一段最白
        float fade = 1.0 - smoothstep(0.12, 0.75, age);
        float wet = (1.0 - smoothstep(0.6, 1.7, age + (fbm(vec2(vQ.x * 1.7 - uSeed, vQ.y * 1.1)) - 0.5) * 0.9)) * (1.0 - smoothstep(${(half - 0.2).toFixed(2)}, ${(half + 0.35).toFixed(2)}, abs(vQ.x) + (n - 0.5) * 0.8));      // 水退了以后地上留一道湿痕（第九轮 fx2b），一块块地干掉
        vec3 c = mix(mix(uC, uA, 0.2 + 0.35 * n), uB, clamp(foam * 0.7 + lead * 0.4, 0.0, 1.0)); c = mix(uC * ${FXB.on ? "0.75" : "0.32"}, c, fade);
        float a = max(side * fade * (${FXB.on ? "0.55" : "0.36"} + 0.34 * foam + 0.16 * lead), wet * ${FXB.on ? "0.42" : "0.3"} * (1.0 - fade)) * smoothstep(-0.2, 0.8, vQ.y); if (a < 0.004) discard;
        gl_FragColor = vec4(c, a);
        #include <colorspace_fragment>
      }` });
  const wake = new THREE.Mesh(wg, wmat); wake.frustumCulled = false; wake.renderOrder = 6; fx.group.add(wake);
  return { crest, cu, wu,
    at(x: number, z: number, gone: number, t: number) { crest.position.set(x, fx.ground(x, z), z); crest.scale.y = CREST_H * (0.3 + 0.7 * sstep(0, 0.14, t)); wu.uHead.value = gone; wu.uT.value = t; },
    killCrest() { fx.group.remove(crest); cmat.dispose(); }, killWake() { fx.group.remove(wake); wg.dispose(); wmat.dispose(); } };
}

/** 月光下的水面（月潮）：一张贴着地形的圆盘，半径由 uR 管（网格按最大半径铺好，着色器里裁）。
 *  水纹和粼光用的是河面那张水纹贴图，所以质感和河是一路的：细碎的反光、朝光的坡亮背光的坡暗；另加一圈圈往外走的潮纹、中间一片月光、边上一道不齐的白沫 */
function tide(fx: FxLib, cx: number, cz: number, rMax: number) {
  const RINGS = 18, SEG = 64, pos: number[] = [0, fx.ground(cx, cz) + 0.1, 0], idx: number[] = [];
  for (let i = 1; i <= RINGS; i++) for (let j = 0; j < SEG; j++) { const r = rMax * (i / RINGS), a = (j / SEG) * 6.2832, x = Math.cos(a) * r, z = Math.sin(a) * r; pos.push(x, fx.ground(cx + x, cz + z) + 0.1, z); }
  for (let j = 0; j < SEG; j++) idx.push(0, 1 + ((j + 1) % SEG), 1 + j);
  for (let i = 1; i < RINGS; i++) for (let j = 0; j < SEG; j++) { const a = 1 + (i - 1) * SEG + j, b = 1 + (i - 1) * SEG + ((j + 1) % SEG), c = a + SEG, d = b + SEG; idx.push(a, b, c, b, d, c); }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  const u = { uTime: CLK, uR: { value: 0 }, uAlpha: { value: 0 }, uSeed: { value: Math.random() * 30 }, uRipple: { value: rippleNormal() }, uA: uc(TIDE), uB: uc(PEARL), uC: uc(DEEP), uM: uc(MOON) };
  const mat = new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    vertexShader: /* glsl */ `varying vec2 vP; varying vec3 vW; void main() { vP = position.xz; vec4 wp = modelMatrix * vec4(position, 1.0); vW = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */ `precision highp float;
      uniform float uTime, uR, uAlpha, uSeed; uniform sampler2D uRipple; uniform vec3 uA, uB, uC, uM; varying vec2 vP; varying vec3 vW;
      void main() { float r = length(vP); if (r > uR + 0.6) discard; vec2 p = vW.xz;                                      // 要用到的噪声都从水纹贴图里取（它的透明通道是高度），比现算便宜
        vec4 r1 = texture2D(uRipple, p * 0.15 + vec2(0.021, 0.013) * uTime), r2 = texture2D(uRipple, p * 0.34 - vec2(0.03, -0.026) * uTime + 0.37), r3 = texture2D(uRipple, p * 0.78 + vec2(0.05, 0.043) * uTime + 0.11);
        float d = uR - r + (r1.a - 0.5) * 1.5 + (r2.a - 0.5) * 0.25;                                                      // 离水边还有几米（水边不是正圆）
        if (d < 0.0) discard;
        float lo = texture2D(uRipple, vP * 0.04 + uSeed).a, fine = r3.a * 0.65 + r2.a * 0.35;
        float ph = (r - uTime * 0.85) * 2.3 + (r1.a - 0.5) * 2.2 + (lo - 0.5) * 5.0, swell = cos(ph), band = pow(max(swell, 0.0), 16.0);      // 一圈圈往外走的潮纹，波峰上一线亮
        vec3 n = normalize(vec3((r1.xy * 2.0 - 1.0) * 0.5 + (r2.xy * 2.0 - 1.0) * 0.42 + (r3.xy * 2.0 - 1.0) * 0.36 + (vP / max(r, 0.05)) * sin(ph) * 0.3, 1.0)).xzy;
        vec3 V = normalize(cameraPosition - vW);
        float hh = r1.a * 0.45 + r2.a * 0.35 + r3.a * 0.2, moon = exp(-r * r / 8.0);
        vec3 col = mix(uC * 0.78, uA, clamp(hh * 0.55 - 0.08, 0.0, 1.0) * 0.6); float a = 0.46;                          // 水是清的：颜色沉，把底下的地面染青，而不是蒙一层白
        float sh = dot(n.xz, normalize(vec2(-0.6, -0.5))); col *= 1.0 + sh * 0.8; a += abs(sh) * 0.35;                   // 朝光的坡亮一点，背光的暗一点，水才有厚度
        col = mix(col, uM, band * 0.42 * smoothstep(0.2, 1.2, d) * (0.5 + 0.5 * smoothstep(0.35, 0.6, r2.a)) + moon * 0.26); a += band * 0.1 + moon * 0.04;      // 波峰上一线月光；中间月光照着的一片
        col *= 1.0 - 0.22 * (1.0 - smoothstep(0.4, 1.8, d));                                                             // 水边那一圈水厚，颜色沉一点
        float crest = smoothstep(0.585, 0.63, hh) * (1.0 - smoothstep(0.63, 0.675, hh)); col += uM * crest * 0.1;
        vec3 H = normalize(V + normalize(vec3(-0.42, 0.78, -0.46))), H2 = normalize(V + normalize(vec3(0.5, 0.8, -0.34)));
        float spark = smoothstep(0.46, 0.6, texture2D(uRipple, p * 1.7 + vec2(0.11, -0.09) * uTime).a);                  // 把成片的反光打碎成一点一点的
        float glint = min(pow(max(dot(n, H), 0.0), 420.0) * 1.4 + pow(max(dot(n, H2), 0.0), 480.0) * 0.9, 0.85) * spark * (0.4 + 0.6 * moon + 0.4 * band);      // 细碎的月光
        col += uM * glint; a = max(a, min(glint * 1.5, 0.95));
        float foam = (1.0 - smoothstep(0.06, 0.6, d)) * (0.55 + 0.45 * smoothstep(0.4, 0.58, fine))                      // 水边的白沫
                   + (1.0 - smoothstep(0.0, 0.22, abs(d - 1.3 - swell * 0.25))) * 0.32 * smoothstep(0.47, 0.6, fine);    // 往里还有一道断断续续的旧沫线
        foam = clamp(foam, 0.0, 1.0); col = mix(col, uB, foam * 0.85); a = max(a, foam * 0.8);
        a *= smoothstep(0.0, 0.1, d) * uAlpha; if (a < 0.004) discard;
        gl_FragColor = vec4(col, min(a, 0.94));
        #include <colorspace_fragment>
      }` });
  const m = new THREE.Mesh(g, mat); m.position.set(cx, 0, cz); m.frustumCulled = false; m.renderOrder = 6; fx.group.add(m);
  return { u, kill() { fx.group.remove(m); g.dispose(); mat.dispose(); } };
}

/** 月潮落下时水面上亮起的一枚月印（第九轮 fx2b）：两圈细环、一圈刻度、中间一弯新月，沿着圆周“画”出来，很快沉进水里。叠加的淡月光 */
function moonSigil(fx: FxLib, x: number, z: number, r: number) {
  const g = new THREE.PlaneGeometry(2, 2); g.rotateX(-Math.PI / 2);
  const u = { uTime: CLK, uAlpha: { value: 0 }, uK: { value: 0 }, uM: uc(MOON) };
  const mat = new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false, ...glowBlend(), polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -5,
    vertexShader: `varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `uniform float uTime, uAlpha, uK; uniform vec3 uM; varying vec2 vP; ${FXB.on ? BOUT : ""}
      void main() { float r = length(vP), th = atan(vP.y, vP.x) / 6.2832 + 0.5;
        float draw = smoothstep(uK * 1.1 - 0.05, uK * 1.1 - 0.1, th);                                     // 沿圆周画出来
        float rings = smoothstep(0.016, 0.0, abs(r - 0.93)) + smoothstep(0.01, 0.0, abs(r - 0.8)) * 0.7 + smoothstep(0.008, 0.0, abs(r - 0.56)) * 0.5;
        float tick = step(0.82, r) * step(r, 0.91) * smoothstep(0.035, 0.0, abs(fract(th * 28.0 - uTime * 0.08) - 0.5) * r * 0.6) * 0.6;
        float d1 = r - 0.42, d2 = length(vP - vec2(0.16, 0.12)) - 0.36, cres = smoothstep(0.015, -0.01, d1) * smoothstep(-0.015, 0.01, d2);      // 一弯新月
        float star = 0.0; for (int i = 0; i < 6; i++) { float a = float(i) / 6.0 * 6.2832 + 0.4; star += smoothstep(0.035, 0.0, length(vP - vec2(cos(a), sin(a)) * 0.68)); }
        float a = ((rings + tick) * draw + cres * 0.75 * smoothstep(0.3, 0.7, uK) + star * 0.8 * smoothstep(0.5, 0.9, uK)) * uAlpha; if (a < 0.004) discard;
        ${glowOut("uM", "a")}
      }` });
  const m = new THREE.Mesh(g, mat); m.position.set(x, fx.ground(x, z) + 0.14, z); m.scale.setScalar(r); m.rotation.y = Math.random() * 6.28; m.frustumCulled = false; m.renderOrder = 7; fx.group.add(m);
  return { u, kill() { fx.group.remove(m); g.dispose(); mat.dispose(); } };
}

/** 一柱月光：上窄下宽的一个筒，正对着镜头的地方厚、轮廓处化开，越往上越淡。很淡的叠加光（库里的光柱轮廓是硬的，从上往下看像个筒，所以自己做） */
function moonbeam(fx: FxLib, x: number, y: number, z: number, r: number, h: number) {
  const g = new THREE.CylinderGeometry(0.7, 1, 1, 40, 1, true); g.translate(0, 0.5, 0);
  const u = { uTime: CLK, uAlpha: { value: 0 }, uSeed: { value: Math.random() * 30 }, uM: uc(MOON) };
  const mat = new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false, side: THREE.DoubleSide, ...glowBlend(),
    vertexShader: /* glsl */ `varying vec3 vN, vV; varying vec2 vUv; void main() { vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalMatrix * normal; vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `uniform float uTime, uAlpha, uSeed; uniform vec3 uM; varying vec3 vN, vV; varying vec2 vUv; ${NOISE} ${FXB.on ? BOUT : ""}
      void main() { float e = abs(dot(normalize(vN), normalize(vV))), y = vUv.y, rays = 0.7 + 0.3 * vn(vec2(vUv.x * 18.0 + uSeed, uTime * 0.12));
        float a = pow(e, 1.5) * pow(1.0 - y, 1.7) * smoothstep(0.0, 0.07, y) * rays * uAlpha; if (a < 0.003) discard;
        ${glowOut("uM", "a")}
      }` });
  const m = new THREE.Mesh(g, mat); m.position.set(x, y, z); m.scale.set(r, h, r); m.frustumCulled = false; m.renderOrder = 7; fx.group.add(m);
  return { u, kill() { fx.group.remove(m); g.dispose(); mat.dispose(); } };
}

// ---------------------------------------------------------------- 技能
// 第九轮 fx2b：给友军的两个技能（潮愈、水泡）用温和的颜色、往上走的动作、成形的光带和罩子，一眼读成“加血”“加盾”；
// 给敌人的（回流、水泡破裂、月潮的伤害）用白芯、往外炸的水、有厚度的水环。治疗的颜色往薄荷绿偏一点，和飘字的绿是一路的。
const HEAL = pick(0x7ff0c4, 0x1fd6a6);      // 换画风 B：薄荷青压饱和一档（亮草地上浅薄荷绿看不见；偏青一点，和黄绿的草分开）
const heightOf = (api: Api, e: Ent) => (e.kind === "hero" ? api.actor(e)?.kit.height ?? 2.8 : e.big ? 2.2 : 1.7);
/** 一小团溅开的水：普攻命中、被浪拍到、泡破时溅到身上 */
const splash = (fx: FxLib, at: THREE.Vector3, n: number, power = 1) => {
  fx.burst({ pos: at, n, sprite: SPR.drop, color: [PEARL, TIDE], speed: [1.5 * power, 4.5 * power], up: 1.2 * power, size: [0.2, 0.36], life: [0.25, 0.5], gravity: 11, stretch: 0.8 });
  fx.burst({ pos: at, n: 2, sprite: SPR.soft, color: PEARL, alpha: 0.32, size: 0.45 * power, grow: 2.4, life: [0.2, 0.3], speed: 0.4 });      // 一小团水雾
};

/** 治疗落在一个人身上（第九轮 fx2b）。参照 LoL 召唤师技能“治疗术”、索拉卡 W：脚下一圈亮环张开 → 三道光带从脚底绕着身体旋上去 → 十字小星往上飘，
 *  英雄的身体整个泛一下青绿。big 是潮愈的每一跳；月潮每 0.5 秒的回血用小一号的（不留地纹、不泛身体、光带两股、淡） */
function healMark(c: { api: Api; fx: FxLib }, e: Ent, big: boolean) {
  const { api, fx } = c, g = fx.ground(e.x, e.z), hgt = heightOf(api, e), rr = Math.max(0.75, e.r + 0.45, e.kind === "hero" ? hgt * 0.4 : 0);      // 光带绕在身体外面（托尔格这种大个子，按碰撞半径会钻进身体里被挡住）
  fx.decal({ kind: "shock", x: e.x, z: e.z, r: rr * (big ? 1.6 : 1.3), life: big ? 0.36 : 0.28, color: HEAL, alpha: big ? 0.9 : 0.5, from: 0.3, fadeIn: 0.04, fadeOut: 0.6 });
  if (big) fx.decal({ kind: "water", x: e.x, z: e.z, r: rr * 1.35, life: 0.95, color: 0x3fcfa8, color2: PEARL, alpha: 0.5, from: 0.55, fadeIn: 0.1, fadeOut: 0.6 });      // 脚下一圈水光，从边上蚀掉
  helix(c, { x: e.x, y: g + 0.04, z: e.z, h: hgt * 1.1, r: rr, life: big ? 0.66 : 0.5, color: 0xd2ffec, color2: 0x45e0a0, turns: 1.2, strands: big ? 3 : 2, width: big ? 0.5 : 0.32, alpha: big ? 1 : 0.6,
    follow: () => (e.alive ? { x: e.x, y: fx.ground(e.x, e.z) + 0.04, z: e.z } : null) });
  fx.burst({ pos: { x: e.x, y: g + 0.2, z: e.z }, n: big ? 10 : 4, sprite: SPR.streak, add: true, ringR: rr * 0.9, color: [0xffffff, HEAL], alpha: 0.9, size: [0.3, 0.42], life: [0.5, 0.75], speed: [0.1, 0.3], up: big ? 4.2 : 3.2, drag: 1.4, stretch: 1.6 });      // 往上走的光丝
  fx.burst({ pos: { x: e.x, y: g + hgt * 0.4, z: e.z }, n: big ? 7 : 3, sprite: SPR.glint, add: true, ringR: rr * 0.95, color: [PEARL, HEAL], alpha: 0.95, size: [0.3, 0.46], life: [0.7, 1.0], speed: [0.05, 0.2], up: 1.5, drag: 0.8 });      // 往上飘的十字小星
  if (big && e.kind === "hero") { const ac = api.actor(e); if (ac) fx.ghost(ac.hero.model, HEAL, 0.42, 0.42); }
  const fol = () => (e.alive ? { x: e.x, z: e.z } : null);      // 往上飘的“十”字：最通用的“加血了”（大的三个错开飘，小的一个）
  for (let i = 0; i < (big ? 3 : 1); i++) { const an = Math.random() * 6.2832, d = rr * (0.45 + 0.35 * Math.random());
    api.after(i * 0.09, () => plus(c, { x: e.x + Math.cos(an) * d, y: g + hgt * (0.55 + 0.25 * Math.random()), z: e.z + Math.sin(an) * d, size: big ? 0.5 - i * 0.08 : 0.34, rise: 1.0, life: big ? 0.8 : 0.6, color: 0xeafff4, color2: 0x3fe39c, alpha: big ? 1 : 0.75, follow: fol })); }
}

const Q: SkillDef = { key: "Q", name: "潮愈", icon: "moko_q", cast: "unit", target: "ally", range: 8.5, cd: 7, mana: 70,
  desc: "一道水波从一个友军开始，在附近的友军之间弹跳 4 次，每次治疗 180 + 60% 法强，逐次减少。",
  start(c) { const { a, api, fx } = c, h = a.hand(v3()), orb = (BEAD ??= shell(0.62, 0.5, 0)).mesh(); let t = 0, on = true;      // 出手前：杖头聚起一颗水珠，周围几滴水往里收（第九轮 fx2b）
    orb.renderOrder = 9; orb.scale.setScalar(0.05); orb.position.copy(h); fx.group.add(orb);
    const off = () => { if (on) { on = false; fx.group.remove(orb); } };
    api.run(1.4, (_k, dt) => { if (!on) return; if (c.data.lit || c.data.over) return off(); t += dt; a.hand(h); orb.position.copy(h); orb.scale.setScalar(0.05 + 0.25 * sstep(0, 0.42, t) * (1 + 0.06 * Math.sin(t * 22))); }, off);
    for (let i = 0; i < 7; i++) { const an = (i / 7) * 6.2832, dx = Math.cos(an), dz = Math.sin(an);
      fx.burst({ pos: { x: h.x + dx * 0.95, y: h.y + 0.35, z: h.z + dz * 0.95 }, n: 1, sprite: SPR.drop, color: [PEARL, TIDE], dir: { x: -dx, y: -0.35, z: -dz }, spread: 0.12, speed: [2.2, 2.8], drag: 3, size: [0.16, 0.24], life: [0.36, 0.44], stretch: 0.6 }); }
    fx.burst({ pos: h, n: 1, sprite: SPR.soft, add: true, color: HEAL, alpha: 0.3, size: 0.5, grow: 1.8, life: 0.45, speed: 0 }); },
  end(c) { c.data.over = true; },
  fire(c) {
    const { me, a, api, fx } = c, base = 180 + c.ap * 0.6 + c.lv * 25, times = new Map<number, number>(); c.data.lit = true;
    const land = (e: Ent, i: number) => {                                                        // 第 i 次治疗落在 e 身上
      const amount = base * Math.pow(0.85, i), at = api.pos(e, 1.2);
      api.heal(me, e, amount); times.set(e.id, (times.get(e.id) ?? 0) + 1);
      healMark(c, e, true); fx.flash(at, HEAL, 1.3, 0.14, false); addWake(e.x, e.z, 1.2);
      fx.burst({ pos: at, n: 6, sprite: SPR.drop, color: [PEARL, TIDE], speed: [1.2, 3], up: 1, size: [0.16, 0.26], life: [0.25, 0.45], gravity: 9, stretch: 0.7 });      // 水珠打在身上碎开
      if (i >= 3) return;
      const rest = api.allies(me, e.x, e.z, 6).filter(o => o !== e); if (!rest.length) return;
      const score = (o: Ent) => (o.hp >= o.max ? 100 : 0) + (times.get(o.id) ?? 0) * 10 + o.hp / o.max;      // 先挑没满血的，再挑这次还没被治疗过的，再挑血少的
      hop(at, rest.reduce((p, o) => (score(o) < score(p) ? o : p)), i + 1);
    };
    const hop = (from: THREE.Vector3, to: Ent, i: number) => {                                   // 一道弧形的水带飞向 to：头上一颗水珠、一团淡淡的光
      const S = from.clone(), T = api.pos(to, 1.2), d0 = Math.max(0.5, Math.hypot(T.x - S.x, T.z - S.z)), arc = 1 + d0 * 0.2, LEN = 0.65, rb = ribbon(fx, 0.62), head = v3(), bead = (BEAD ??= shell(0.62, 0.5, 0)).mesh(); let kh = 0;
      rb.u.uA.value.set(0x6cecd0); bead.scale.setScalar(0.3); bead.renderOrder = 9; bead.position.copy(S); fx.group.add(bead);
      const path = (k: number, out: THREE.Vector3) => out.set(S.x + (T.x - S.x) * k, S.y + (T.y - S.y) * k + arc * 4 * k * (1 - k), S.z + (T.z - S.z) * k);
      const drip = fx.emitter({ pos: S, rate: 42, sprite: SPR.drop, color: [PEARL, TIDE], alpha: 0.85, size: [0.16, 0.28], life: [0.3, 0.5], speed: [0.2, 0.8], gravity: 6 });
      const glow = fx.emitter({ pos: S, rate: 50, sprite: SPR.soft, add: true, color: [HEAL, TIDE], alpha: 0.22, size: [0.6, 0.8], grow: 0.5, life: [0.1, 0.16], speed: 0 });
      rb.set(path, 0, 0.001);
      api.shoot({ me, from: { x: S.x, y: S.y, z: S.z }, target: to, ally: true, speed: Math.min(17, Math.max(8, d0 / 0.3)), hit: e => land(e, i),
        vis: { move(x, _y, z) { T.copy(api.pos(to, 1.2)); kh = Math.max(kh, Math.min(1, 1 - Math.hypot(T.x - x, T.z - z) / d0)); rb.set(path, Math.max(0, kh - LEN), kh); path(kh, head); bead.position.copy(head); drip.at(head.x, head.y, head.z); glow.at(head.x, head.y, head.z); },
          done() { drip.stop(); glow.stop(); fx.group.remove(bead); const k0 = Math.max(0, kh - LEN); api.run(0.16, f => { rb.set(path, k0 + (kh - k0) * f, kh); rb.u.uAlpha.value = 1 - f * f; }, () => rb.kill()); } } });      // 尾巴收进去
    };
    const first = c.unit && c.unit.alive ? c.unit : me, h = a.hand(v3());
    fx.burst({ pos: h, n: 6, sprite: SPR.drop, color: [PEARL, TIDE], dir: { x: first.x - me.x, y: 0.6, z: first.z - me.z }, spread: 0.5, speed: [2, 5], size: [0.18, 0.3], life: [0.2, 0.35], gravity: 7, stretch: 1 });
    if (first === me) land(me, 0); else hop(h, first, 0);
  },
};

const W: SkillDef = { key: "W", name: "水泡", icon: "moko_w", cast: "unit", target: "ally", range: 8.5, cd: 11, mana: 70,
  desc: "给一个友军套上水泡，吸收 320 + 80% 法强的伤害，持续 4 秒。水泡破裂时减速周围的敌人并造成少量伤害。",
  start(c) { c.fx.burst({ pos: c.a.hand(v3()), n: 5, sprite: SPR.bubble, radius: 0.25, color: PEARL, alpha: 0.75, speed: [0.3, 0.9], up: 1, size: [0.12, 0.24], life: [0.35, 0.6], drag: 1.5 }); },      // 出手前：手上冒出几个小泡
  fire(c) {
    const { me, api, fx } = c, tg = c.unit && c.unit.alive ? c.unit : me, amount = 320 + c.ap * 0.8 + c.lv * 40, burstDmg = 80 + c.ap * 0.3 + c.lv * 12, DUR = 4;
    const hgt = heightOf(api, tg), rad = hgt * 0.6, cy = hgt * 0.5, sh = getShield(), m = sh.m, p = v3(); let t = 0, warn: Decal | null = null, closed = -1, last = amount;
    m.position.copy(api.pos(tg, cy)); m.scale.setScalar(rad);
    api.shieldOwn(tg, amount, DUR); fx.group.add(m);
    if (tg !== me) { const S = c.a.hand(v3()), T = v3(), rb = ribbon(fx, 0.26, 10), path = (k: number, out: THREE.Vector3) => out.lerpVectors(S, T, k).setY(S.y + (T.y - S.y) * k + 2.4 * k * (1 - k));      // 手上甩过去的一道细水线
      api.run(0.18, k => { T.copy(api.pos(tg, cy)); rb.set(path, Math.max(0, k * 1.7 - 0.7), Math.min(1, k * 1.7)); rb.u.uAlpha.value = Math.min(1, (1 - k) / 0.3); }, () => rb.kill()); }
    // 成形（第九轮 fx2b）：水从脚下绕着身体旋上来，罩子从下往上合拢；合上那一下轮廓亮一下、头顶几点亮、脚下一圈环
    helix(c, { x: tg.x, y: fx.ground(tg.x, tg.z) + 0.04, z: tg.z, h: hgt * 1.12, r: rad * 0.98, life: 0.42, color: PEARL, color2: TIDE, turns: 1.1, strands: 3, width: 0.38, alpha: 0.8, follow: () => (tg.alive ? { x: tg.x, y: fx.ground(tg.x, tg.z) + 0.04, z: tg.z } : null) });
    fx.burst({ pos: { x: tg.x, y: fx.ground(tg.x, tg.z) + 0.15, z: tg.z }, n: 10, sprite: SPR.drop, ringR: rad * 0.8, color: [PEARL, TIDE], speed: [0.1, 0.4], up: 3, size: [0.22, 0.36], life: [0.4, 0.65], gravity: 4 });      // 水从脚下拢上来
    const under = fx.decal({ kind: "water", x: tg.x, z: tg.z, r: rad * 1.08, life: DUR + 0.3, color: TIDE, color2: PEARL, alpha: 0.3, from: 0.5, fadeIn: 0.06, fadeOut: 0.04 });      // 脚下一圈很淡的水纹，跟着人走
    api.zone({ me, x: tg.x, z: tg.z, r: 3, dur: DUR, follow: tg, tick: 99,
      frame(z, dt) { t += dt; if (tg.shield <= 0) { z.kill(); return; }                         // 护盾被打没了：马上破
        sh.u.uFill.value = sstep(0.04, 0.34, t);
        if (closed < 0 && t >= 0.34) { closed = t; const q = api.pos(tg, hgt * 1.0);
          fx.decal({ kind: "shock", x: tg.x, z: tg.z, r: rad * 1.5, life: 0.34, color: 0xd8fbf4, alpha: 0.9, from: 0.45, fadeIn: 0.04, fadeOut: 0.6 });
          fx.burst({ pos: q, n: 5, sprite: SPR.glint, add: true, radius: rad * 0.45, color: [0xffffff, TIDE], size: [0.22, 0.36], life: [0.25, 0.4], speed: [0.2, 0.6] }); sh.u.uHit.value = 1; }
        if (closed >= 0 && tg.shield < last - 1) sh.u.uHit.value = Math.min(1, sh.u.uHit.value + 0.7); last = tg.shield;      // 挨打：罩子亮一下、晃一下
        sh.u.uHit.value *= Math.exp(-dt * 6);
        const lastK = sstep(DUR - 0.9, DUR, t), pop = closed >= 0 ? 0.08 * Math.exp(-(t - closed) * 9) : 0;      // 合上的那一下鼓一下；最后不到一秒开始发颤
        p.copy(api.pos(tg, cy)); m.position.copy(p); m.scale.setScalar(rad * (1 + pop + 0.015 * Math.sin(t * 3.1) + 0.03 * lastK * Math.sin(t * 26)));
        sh.u.uWob.value = 1 + 3 * lastK; sh.u.uAlpha.value = Math.min(1, t / 0.08) * (0.6 + 0.4 * Math.min(1, tg.shield / amount));      // 护盾剩得少，泡也薄
        if (!warn && t > DUR - 0.9) warn = fx.decal({ kind: "disc", x: tg.x, z: tg.z, r: 3, life: 0.9, color: 0xbdeee8, alpha: 0.38, fadeIn: 0.7, fadeOut: 0.05 });      // 快到时间了：地上淡淡地亮出要溅到的范围
        warn?.set(tg.x, tg.z); under.set(tg.x, tg.z); },
      end() {
        warn?.kill(0.1); under.kill(0.15); const x = tg.x, z = tg.z; p.copy(api.pos(tg, cy));
        api.run(0.13, k => { m.scale.setScalar(rad * (1 + 0.3 * k)); sh.u.uAlpha.value = (1 - k) * (1 - k); }, () => { fx.group.remove(m); SHIELDS.push(sh); });      // 泡膜一下胀开，没了（罩子收回池子）
        for (let i = 0; i < 10; i++) { const an = (i / 10) * 6.2832 + Math.random() * 0.5, el = -0.15 + Math.random() * 0.9, d = { x: Math.cos(an) * Math.cos(el), y: Math.sin(el), z: Math.sin(an) * Math.cos(el) };      // 水花从泡膜上四面溅开
          fx.burst({ pos: { x: p.x + d.x * rad * 0.85, y: p.y + d.y * rad * 0.85, z: p.z + d.z * rad * 0.85 }, n: 4, sprite: SPR.drop, color: [PEARL, TIDE], dir: d, spread: 0.45, speed: [3, 7.5], size: [0.28, 0.5], life: [0.35, 0.6], gravity: 11, stretch: 1 }); }
        fx.burst({ pos: p, n: 8, sprite: SPR.bubble, radius: rad * 0.8, color: PEARL, alpha: 0.7, speed: [0.5, 1.6], up: 0.8, size: [0.12, 0.3], life: [0.4, 0.8], drag: 2 });      // 碎成的小泡
        fx.flash(p, PEARL, rad * 1.3, 0.12, false);
        thickRing(c, { x, z, r: 3, r0: rad * 0.8, width: 0.8, life: 0.45, color: PEARL, color2: TIDE, alpha: 0.85 });      // 一圈有厚度的水环推到 3 米：溅到的范围（第九轮 fx2b，原来是一条细线）
        fx.decal({ kind: "water", x, z, r: 3, life: 1.6, color: DEEP, color2: 0xc4f0ea, alpha: 0.46, from: 0.3, fadeIn: 0.05, fadeOut: 0.65 }); addWake(x, z, 1.6);      // 地上一摊水，慢慢退
        for (const e of api.enemies(me, x, z, 3)) { if (isBuilding(e)) continue; api.hit(me, e, burstDmg, "magic"); api.slow(e, 0.4, 1.5); splash(fx, api.pos(e, 1.1), 5, 0.8); }
      } });
  },
};

const E: SkillDef = { key: "E", name: "回流", icon: "moko_e", cast: "dir", range: 9, width: 3, cd: 12, mana: 70,
  desc: "吹响螺号，一道潮水沿直线冲出去：把碰到的敌人推开 4 米，造成 200 + 50% 法强的魔法伤害并减速。",
  start(c) { const { a, api, fx } = c, h = a.hand(v3());                                         // 出手前：螺号口一圈圈声波往前推（第九轮 fx2b），脚前的水拢起来
    for (let i = 0; i < 3; i++) api.after(0.08 + i * 0.13, () => { if (c.data.over) return; fx.burst({ pos: a.hand(v3()), n: 1, sprite: SPR.ring, add: true, color: [PEARL, TIDE], alpha: 0.5 - i * 0.1, size: 0.35, grow: 4.4, life: 0.4, speed: 3.4, dir: { x: c.dx, y: 0.04, z: c.dz }, spread: 0 }); });
    fx.burst({ pos: h, n: 5, sprite: SPR.drop, color: [PEARL, TIDE], dir: { x: c.dx, y: 0.4, z: c.dz }, spread: 0.6, speed: [1, 3], size: [0.16, 0.26], life: [0.25, 0.4], gravity: 6 });
    fx.decal({ kind: "swirl", x: a.pos.x + c.dx * 0.9, z: a.pos.z + c.dz * 0.9, r: 1.6, life: 0.6, color: TIDE, color2: DEEP, alpha: 0.65, fadeIn: 0.25, fadeOut: 0.5, spin: 2.5 }); },
  end(c) { c.data.over = true; },
  fire(c) {
    const { me, a, api, fx } = c, dx = c.dx, dz = c.dz, x0 = a.pos.x, z0 = a.pos.z, dmg = 200 + c.ap * 0.5 + c.lv * 25, LEN = 9, HALF = 1.5, SPEED = 19;      // 26 太快，浪一闪就过去了
    const wv = wave(fx, x0, z0, dx, dz, LEN, HALF, SPEED), at = v3(); let t = 0, spray = 0, wet = 0;
    wv.at(x0, z0, 0, 0);
    // 出手：脚下的水一下立起来（第九轮 fx2b）
    fx.burst({ pos: { x: x0 + dx * 0.8, y: fx.ground(x0, z0) + 0.2, z: z0 + dz * 0.8 }, n: 12, sprite: SPR.drop, color: [PEARL, TIDE], dir: { x: dx, y: 1.4, z: dz }, spread: 0.6, speed: [3, 7], size: [0.24, 0.42], life: [0.35, 0.6], gravity: 12, stretch: 1 });
    api.shoot({ me, from: { x: x0, y: a.pos.y + 0.6, z: z0 }, dir: { x: dx, z: dz }, speed: SPEED, range: LEN, radius: HALF + 0.4, pierce: true,
      hit(e, p) {
        if (isBuilding(e)) return false;
        const vx = e.x - x0, vz = e.z - z0, along = vx * dx + vz * dz, off = Math.abs(vx * dz - vz * dx);
        if (along < -e.r || along > p.gone + e.r || off > HALF + e.r) return false;              // 浪的前沿是一条直线：还没扫到的、在带子外面的都不算（没扫到的下一帧再看）
        api.push(e, dx, dz, 4); api.hit(me, e, dmg, "magic"); api.slow(e, 0.3, 1.5);
        // 打中（第九轮 fx2b）：人身上冲起一柱水、白芯一下、一圈白沫环、水花四溅，顺着推开的方向再甩一串水
        const q = api.pos(e, 1.0), g = fx.ground(e.x, e.z);
        splash(fx, q, 10, 1.4); fx.impact(q, { color: PEARL, color2: TIDE, size: 1.0, dir: { x: dx, y: 0.4, z: dz }, sparks: 3 });
        fx.burst({ pos: { x: e.x, y: g + 0.4, z: e.z }, n: 16, sprite: SPR.drop, radius: 0.5, color: [PEARL, TIDE], dir: { x: dx * 0.3, y: 1, z: dz * 0.3 }, spread: 0.45, speed: [6, 10], size: [0.3, 0.5], life: [0.5, 0.75], gravity: 18, stretch: 0.9 });      // 人身上冲起一大团水
        fx.burst({ pos: { x: e.x, y: g + 1.2, z: e.z }, n: 4, sprite: SPR.smoke, radius: 0.5, color: PEARL, alpha: 0.4, size: [0.9, 1.3], grow: 1.9, life: [0.4, 0.6], speed: [0.6, 1.4], up: 1.8 });
        thickRing(c, { x: e.x, z: e.z, r: 1.8, r0: 0.4, width: 0.5, life: 0.42, color: PEARL, color2: TIDE, alpha: 0.85 });
        fx.burst({ pos: { x: e.x, y: g + 0.3, z: e.z }, n: 8, sprite: SPR.drop, color: [PEARL, TIDE], dir: { x: dx, y: 1.2, z: dz }, spread: 0.55, speed: [4, 8], size: [0.26, 0.44], life: [0.4, 0.65], gravity: 13, stretch: 1 });
        fx.burst({ pos: api.pos(e, 0.6), n: 3, sprite: SPR.smoke, color: PEARL, alpha: 0.3, size: [0.7, 1.1], grow: 1.8, life: [0.35, 0.55], speed: [0.5, 1.5], up: 1 });
      },
      vis: { move(x, _y, z, _dx, _dy, _dz, dt) { t += dt; wv.at(x, z, Math.hypot(x - x0, z - z0), t);
          const g = fx.ground(x, z); spray += dt * 160; wet += dt;
          for (; spray >= 1; spray -= 3) { const w = (Math.random() * 2 - 1) * HALF * 0.95;      // 浪头上甩出去的水沫，沿着整道浪
            fx.burst({ pos: { x: x + dz * w + dx * 0.7, y: g + 0.85, z: z - dx * w + dz * 0.7 }, n: 3, sprite: SPR.drop, color: [0xffffff, PEARL], alpha: 0.85, dir: { x: dx, y: 0.45, z: dz }, spread: 0.6, speed: [4, 9], size: [0.14, 0.28], life: [0.3, 0.55], gravity: 12, stretch: 1.3 }); }      // 第九轮 polish-old：从浪唇上往前甩（浪矮了，高度跟着改）
          if (wet > 0.03) { wet = 0; const w = (Math.random() * 2 - 1) * HALF * 0.8; addWake(x + dz * w, z - dx * w, 1.6);      // 经过河面：水面真的起波
            fx.burst({ pos: { x: x + dz * w, y: g + 0.95, z: z - dx * w }, n: 2, sprite: SPR.smoke, color: [0xffffff, PEARL], alpha: 0.26, size: [0.8, 1.2], grow: 1.9, life: [0.35, 0.55], speed: [0.5, 2], dir: { x: -dx, y: 0.6, z: -dz }, spread: 0.6 }); } },      // 浪顶被风扯开、往后飘的水雾
        done() { /* 收尾在 end 里 */ } },
      end(p) {
        const ex = p.x, ez = p.z, gone = Math.hypot(ex - x0, ez - z0), g = fx.ground(ex, ez); let crestOn = true;
        api.run(1.7, (k, dt) => { t += dt; wv.wu.uT.value = t; if (!crestOn) return;             // 身后的水退完、湿痕干掉再收；浪头往前扑倒、摊平
          const kc = Math.min(1, (k * 1.7) / 0.26), s = gone + 1.1 * (1 - (1 - kc) * (1 - kc)); at.set(x0 + dx * s, 0, z0 + dz * s);
          wv.crest.position.set(at.x, fx.ground(at.x, at.z), at.z); wv.crest.scale.y = CREST_H * (1 - 0.8 * kc); wv.cu.uAlpha.value = 1 - kc * kc; if (kc >= 1) { crestOn = false; wv.killCrest(); } }, () => { if (crestOn) wv.killCrest(); wv.killWake(); });
        fx.decal({ kind: "water", x: ex + dx * 0.7, z: ez + dz * 0.7, r: 2.2, life: 1.4, color: DEEP, color2: 0xbdeee8, alpha: 0.4, from: 0.5, fadeIn: 0.1, fadeOut: 0.7 });      // 浪停下的地方留一摊水，慢慢退
        thickRing(c, { x: ex + dx * 0.9, z: ez + dz * 0.9, r: 2.4, r0: 0.8, width: 0.7, life: 0.5, color: PEARL, color2: TIDE, alpha: 0.75 });      // 扑倒摊开的一圈白沫
        for (let i = 0; i < 6; i++) { const w = ((i + Math.random()) / 6 * 2 - 1) * HALF;
          fx.burst({ pos: { x: ex + dz * w + dx * 0.3, y: g + 0.7, z: ez - dx * w + dz * 0.3 }, n: 4, sprite: SPR.drop, color: [PEARL, TIDE], dir: { x: dx, y: 1, z: dz }, spread: 0.7, speed: [2.5, 6.5], size: [0.26, 0.46], life: [0.35, 0.6], gravity: 12, stretch: 0.9 }); }
        fx.burst({ pos: { x: ex + dx * 0.5, y: g + 0.5, z: ez + dz * 0.5 }, n: 7, sprite: SPR.smoke, radius: 1.3, color: PEARL, alpha: 0.3, size: [1.1, 1.7], grow: 1.7, life: [0.45, 0.7], speed: [0.4, 1.2], up: 0.6 });
        addWake(ex + dx * 0.6, ez + dz * 0.6, 2);
      } });
    const h = a.hand(v3()); fx.burst({ pos: h, n: 8, sprite: SPR.drop, color: [PEARL, TIDE], dir: { x: dx, y: 0.25, z: dz }, spread: 0.5, speed: [4, 9], size: [0.18, 0.3], life: [0.2, 0.4], gravity: 8, stretch: 1.2 });
  },
};

const R: SkillDef = { key: "R", name: "月潮", icon: "moko_r", cast: "self", radius: 8, cd: 80, mana: 130, minLevel: 6,
  desc: "召来一片不断扩大的潮水，持续 6 秒：里面的友军持续回血，敌人被减速 35% 并持续受到伤害。",
  start(c) { const { a, fx } = c, x = a.pos.x, z = a.pos.z;                                      // 出手前：脚下的水拢起来，一圈水珠往上升
    fx.decal({ kind: "swirl", x, z, r: 2.2, life: 0.9, color: TIDE, color2: DEEP, alpha: 0.55, fadeIn: 0.25, fadeOut: 0.5, spin: 1.6 });
    fx.burst({ pos: { x, y: fx.ground(x, z) + 0.15, z }, n: 14, sprite: SPR.drop, ringR: 1.5, color: [PEARL, TIDE], speed: [0.1, 0.4], up: 2.4, size: [0.26, 0.4], life: [0.6, 0.9], gravity: 2 }); },
  fire(c) {
    const { me, a, api, fx } = c, x = a.pos.x, z = a.pos.z, g = fx.ground(x, z), heal = 45 + c.ap * 0.12 + c.lv * 8, dmg = 30 + c.ap * 0.1 + c.lv * 6, DUR = 6, R0 = 4, R1 = 8, TICKS = 12;
    const sea = tide(fx, x, z, R1 + 0.5), beam = moonbeam(fx, x, g, z, 1.5, 14), edge = wall(c, x, z, "foam", PEARL, TIDE), sig = moonSigil(fx, x, z, R0 * 0.85); let n = 0, foam = 0;
    api.run(1.6, k => { const t = k * 1.6; sig.u.uK.value = sstep(0, 0.5, t); sig.u.uAlpha.value = 0.75 * sstep(0, 0.1, t) * (1 - sstep(0.7, 1.6, t)); }, () => sig.kill());      // 水面上亮起一枚月印，画完就沉下去      // 水面、头顶落下来的一柱很淡的月光、水边一圈翻起来的白沫（第九轮 fx2b：范围的边一眼看得出）
    fx.flash({ x, y: g + 1.4, z }, MOON, 4.2, 0.24, false); fx.decal({ kind: "shock", x, z, r: R0 + 0.6, life: 0.8, color: PEARL, alpha: 0.55, from: 0.15, fadeIn: 0.05, fadeOut: 0.6 });
    fx.column({ x, z, r: 2.2, h: 12, life: 0.8, color: PEARL, color2: MOON, kind: "light" }); fx.shake(0.08, 0.3);      // 月光落下的那一下：一道宽的光柱
    thickRing(c, { x, z, r: R1, r0: 1.5, width: 1.1, life: 0.75, color: PEARL, color2: MOON, alpha: 0.6 });      // 一圈水推到最大范围（第九轮 fx2b：原来是一道叠加的白线，太刺眼）
    fx.burst({ pos: { x, y: g + 6, z }, n: 18, sprite: SPR.glint, add: true, radius: 2, color: [0xffffff, MOON], size: [0.16, 0.3], life: [0.6, 1.0], speed: [2, 5], dir: { x: 0, y: -1, z: 0 }, spread: 0.4, drag: 1.4 });
    api.zone({ me, x, z, r: R0, dur: DUR, tick: 0.5,
      frame(zn, dt) {
        zn.r = R0 + (R1 - R0) * Math.min(1, zn.t / DUR);                                         // 半径 6 秒里从 4 米涨到 8 米；水面跟着长
        sea.u.uR.value = zn.r * (1 - Math.pow(1 - Math.min(1, zn.t / 0.45), 3)); sea.u.uAlpha.value = Math.min(1, zn.t / 0.25) * (1 - 0.55 * sstep(DUR - 0.5, DUR, zn.t));      // 开头从脚下涌开；最后一次结算以后开始淡
        edge.set(sea.u.uR.value + 0.1, 0.55 + 1.2 * (1 - sstep(0.12, 0.85, zn.t)), sea.u.uAlpha.value * 0.85);      // 水从脚下涌开：一圈一人高的水墙推出去，落成边上半米高的白沫
        beam.u.uAlpha.value = 0.95 * sstep(0, 0.8, zn.t) * (1 - sstep(DUR - 1.2, DUR, zn.t));
        for (foam += dt * 20; foam >= 1; foam--) fx.burst({ pos: { x, y: g + 0.18, z }, n: 1, sprite: SPR.smoke, ringR: sea.u.uR.value - 0.15, color: PEARL, alpha: 0.26, size: [0.5, 0.9], grow: 1.6, life: [0.5, 0.8], speed: [0.1, 0.4], up: 0.25 });      // 水边翻起来的沫
      },
      every(zn, foes) {
        if (n++ >= TICKS) return;
        for (const e of foes) { if (isBuilding(e)) continue; api.hit(me, e, dmg, "magic"); api.slow(e, 0.35, 0.75);
          fx.burst({ pos: api.pos(e, 0.25), n: 3, sprite: SPR.drop, radius: 0.4, color: [TIDE, DEEP], alpha: 0.8, speed: [0.8, 2], up: 1.4, size: [0.18, 0.3], life: [0.25, 0.4], gravity: 9 }); }
        for (const f of api.allies(me, zn.x, zn.z, zn.r)) { api.heal(me, f, heal); healMark(c, f, false); }      // 友军身上：小一号的治疗（和潮愈一样的语言）
      },
      end() { const a0 = sea.u.uAlpha.value; beam.kill(); api.run(0.5, k => { sea.u.uAlpha.value = a0 * (1 - k); edge.set(sea.u.uR.value + 0.1, 0.55, a0 * 0.8 * (1 - k)); }, () => { sea.kill(); edge.kill(); }); },
    });
  },
};

export const moko: HeroKit = {
  id: "moko", name: "摩珂", title: "引潮人", role: "辅助", side: 0, color: 0x58e6e0, color2: PEARL, height: 3.3, look: { lift: 1.15 },      /* 换画风 B（w-mu）：卡通版的贴图本来就浅，照默认提亮 1.4 鳞袍是 (96,175,157)、整个人比草地还亮一截、发白；1.15 量下来 (85,164,148)，设定图 (87,149,134) */
  base: { hp: 3000, mana: 950, ad: 110, ap: 50, armor: 24, mr: 28, ms: 5.6, as: 0.85, range: 7.5, cdr: 0, ls: 0, hpRegen: 0.006, manaRegen: 0.018 },
  ranged: { speed: 20, shot(c): ProjVis {                                                        // 普攻：一颗拖着水线的水珠
    const { fx } = c, m = (BEAD ??= shell(0.62, 0.5, 0)).mesh(), q = v3(); m.scale.set(0.2, 0.2, 0.44); m.renderOrder = 8; m.position.set(c.from.x, c.from.y, c.from.z); fx.group.add(m);
    const tail = fx.emitter({ pos: c.from, rate: 40, sprite: SPR.drop, color: [PEARL, TIDE], alpha: 0.9, size: [0.15, 0.26], life: [0.22, 0.38], speed: [0.1, 0.5], gravity: 5 });
    fx.burst({ pos: c.from, n: 4, sprite: SPR.drop, color: [PEARL, TIDE], dir: { x: c.target.x - c.me.x, y: 0.5, z: c.target.z - c.me.z }, spread: 0.7, speed: [1, 3], size: [0.14, 0.24], life: [0.2, 0.35], gravity: 8 });
    return { move(x, y, z, dx, dy, dz) { m.position.set(x, y, z); m.lookAt(q.set(x + dx, y + dy, z + dz)); tail.at(x, y, z); }, done() { fx.group.remove(m); tail.stop(); } };
  } },
  skills: [Q, W, E, R],
  attack(c) { const { api, fx, target: e } = c, at = api.pos(e, e.kind === "tower" ? 3 : e.kind === "core" ? 4 : 1.2); splash(fx, at, 7); fx.flash(at, PEARL, 0.9, 0.1, false); },      // 普攻命中：水珠碎开
  passive(c) { CLK.value = c.fx.time(); warm2b(c); },
};
