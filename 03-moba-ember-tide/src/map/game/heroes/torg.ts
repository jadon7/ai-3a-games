// 托尔格 · 沉钟（斗士，沉月会）。
//
// 规格（数值是主线定的第一版，实现时照这个来；觉得哪里不合理，在报告里说，不要自己改数）：
//   被动 压舱 生命越低越硬：每损失 10% 生命，受到的伤害少 3%（最多少 24%），并且每秒多回复“已损失生命的 0.8%”。
//            （设定里的“更难被击退和减速”先不做，报告里提一句即可。）用 kit.passive 每帧刷新一个 buff 来实现。
//   Q 撞钟   非指向扇形，距离 4.5，半张角 43 度，冷却 7，法力 55。抡钟横扫面前：扇形里的敌人受 200 + 90% 攻击力 + 每级 30 的物理伤害，
//            被顺着他面对的方向击退 2.5 米，眩晕 0.8 秒。
//   W 余音   直接放，半径 6，冷却 11，法力 65。敲响大钟：一圈声波 0.5 秒内扩到 6 米，扫到的敌人减速 40% 2 秒，
//            受 120 + 40% 攻击力 + 每级 20 的魔法伤害；自己得到 280 + 10% 最大生命的护盾，持续 4 秒。
//   R 沉没   大招，6 级，范围，施法距离 6，半径 5.5，冷却 75，法力 110。跃向目标位置（0.45 秒），把钟倒扣着砸下：
//            落地时范围内 150 + 50% 攻击力的物理伤害；形成 2.5 秒的漩涡，每 0.25 秒把里面的敌人往中心拉 1.1 米并减速 30%；
//            漩涡结束时最后一声钟响：范围内 350 + 100% 攻击力 + 每级 45 的物理伤害，眩晕 1 秒。
//
// 实现上的几点：
//   · 特效库里没有的两样东西在这个文件里自己补了（见“自己补的零件”）：
//     贴地的波（很薄的同心环、厚的冲击波、横扫的弧、漩涡、脚下的深水），它是铺在地上的网格，会顺着坡和岸走，不会被地形切掉一半；
//     钟形的罩子（余音的护盾、沉没里砸下去又升起来的那口钟）。它们都挂在 fx.group 下面，用完就摘掉。
//   · 技能伤害不打建筑（塔、水晶），和岚的写法一致。
//   · 压舱的减伤是一档一档的（每满 10% 一档）；多回的血每半秒结一次，攒不够 1 点不加。
//   · 沉没的跃起没有动作，这里在 passive 里给模型加了一条抛物线的高度（只动画面，位置还是控制器管）。
//     跃到半路被眩晕、击退打断就不落地：没有伤害也没有漩涡（冷却和法力已经花掉）。
// 动作时间表在 public/assets/hero/torg.json（资源那边做完才有；没有时控制器用默认的出手时间）。特效的位置只用 a.pos、钟的位置和目标的位置，不依赖某一帧动作。

import * as THREE from "three";
import type { Actor } from "../actor";
import type { Ent } from "../sim";
import type { Api, HeroKit, SkillDef } from "../skills";
import { SPR, type BurstOpts, type FxLib, type V3 } from "../fxlib";
import { blade, converge, crown, dome, mark, splash, warmFx2a, windup } from "../fx_fx2a";
import { FXB, pick } from "../fxb";
import { LITE } from "../../quality";

// 第九轮 fx2a：三个技能重新分镜（见 docs/round9/fx2a/分镜.md）。和岚一样，主体底下垫一层深色（ABYSS），亮的只有前沿和命中那一下；
// 钟声做成看得见的形状：一个往外鼓的声壳（dome）+ 一圈前沿清楚的厚环，敌人一眼看得出 6 米的范围。
const BRONZE = pick(0x6fb8a4, 0x23a586), GLOW = pick(0x7fe9e4, 0x22c4d4), DEEP = pick(0x1d5f6a, 0x167f98), FOAM = 0xe6fbf7, ABYSS = pick(0x0c2a2e, 0x0e6884);      // 铜绿、钟口的青光、深水、白沫、垫底的深色
// 换画风 B（b-fx）：亮地面上浅铜绿、浅青的身子看不出来，近黑的垫底和漩涡中心是一块脏灰。B 下铜绿和青都饱和一档，垫底和漩涡是同色系的深海蓝（不是黑）
const VORTEX = pick(0x123f49, 0x1478a8);
const QR = 4.5, QA = 0.75, WR = 6, RR = 5.5;                                     // 撞钟的距离和半张角、余音的半径、沉没的半径
const isBuilding = (e: Ent) => e.kind === "tower" || e.kind === "core";
const v3 = () => new THREE.Vector3();

// ---------------------------------------------------------------- 自己补的零件
// 贴地的波：一张铺在地上的网格片（每个顶点落在各自位置的地面上，所以在坡上、岸边不会被地形切掉一半），图案在着色器里现算。
// uKind：0 几圈很薄的同心环（钟声）；1 一道厚的冲击波（可以只留面前的扇形）；2 横扫的弧（一道月牙从一侧扫到另一侧，这个不贴地，平着悬在半空）；
// 3 脚下一圈很淡的深水（压舱）；4 漩涡。半径、透明度这些每帧由技能自己写进 uniform。
const flat = new THREE.PlaneGeometry(2, 2); flat.rotateX(-Math.PI / 2);
const grids: Record<number, THREE.BufferGeometry[]> = {};      // 用完的网格收回来下次再用，不反复向显卡要缓冲
const WAVE_VERT = `varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const WAVE_FRAG = /* glsl */ `
  uniform float uR, uS, uAlpha, uSeed, uAngle, uW, uGap, uN, uFill, uHead, uTime; uniform int uKind; uniform vec3 uA, uB, uC; varying vec2 vP;
  float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
  void main() {
    vec2 p = vP / uS; float r = length(p), th = atan(p.x, p.y), a = 0.0; vec2 d = p / max(r, 1e-4); vec3 col = uA;
    if (uKind == 0) {                                          // 钟声：领头的一圈最清楚，后面的一圈比一圈淡；uGap 是负的就是往里收的
      for (int i = 0; i < 4; i++) {
        float fi = float(i), ri = uR - fi * uGap;
        float k = (1.0 - smoothstep(uW * 0.35, uW, abs(r - ri))) * smoothstep(0.03, 0.14, ri) * (1.0 - smoothstep(0.94, 1.0, ri)) * (1.0 - fi * 0.22) * step(fi, uN - 0.5);
        if (k > a) { a = k; col = mix(uA, uB, fi / 3.0); }
      }
      a += smoothstep(uR - 0.2, uR, r) * (1.0 - step(uR, r)) * 0.09 * step(0.0, uGap) * (1.0 - smoothstep(0.85, 1.0, uR));      // 领头那一圈后面压着一层很淡的
      a *= 0.86 + 0.14 * vn(d * 5.0 + uSeed);
    } else if (uKind == 1) {                                   // 厚冲击波：前沿一道白沫（uGap 是它的宽度），后面拖一段带水纹的厚带，再往里是很淡的一层
      float n = vn(d * 4.0 + uSeed), fr = uR * (1.0 + (n - 0.5) * 0.06);
      float front = smoothstep(fr - uGap, fr - uGap * 0.3, r) * (1.0 - smoothstep(fr - uGap * 0.3, fr, r)) * (0.6 + 0.4 * vn(d * 26.0 + uSeed * 2.0));
      float body = smoothstep(fr - uW, fr, r) * (1.0 - step(fr, r));
      float streak = 0.3 + 0.7 * vn(d * 16.0 + uSeed * 3.0 + r * 2.0);
      a = front * 0.92 + body * body * ${FXB.on ? "0.8" : "0.5"} * streak + (1.0 - step(fr, r)) * uFill;      // 换画风 B：前沿后面那段厚带实一些
      col = mix(uB, uA, clamp(front + body * body * body * 0.3, 0.0, 1.0));
      a *= (1.0 - smoothstep(uAngle - 0.1, uAngle, abs(th))) * smoothstep(0.02, 0.12, r);
    } else if (uKind == 2) {                                   // 横扫的弧：外沿一道实的亮边（中间最粗），往里是带拖痕的一片；扫过的地方留一段越来越淡的尾巴
      float behind = uHead - th;
      float tr = smoothstep(-0.05, 0.04, behind) * exp(-max(behind, 0.0) * uGap) * smoothstep(-uAngle - 0.02, -uAngle + 0.35, th) * (1.0 - smoothstep(uAngle - 0.1, uAngle + 0.04, th));
      float sh = pow(max(cos(clamp(th / uAngle, -1.0, 1.0) * 1.5708), 0.0), 0.7) * smoothstep(0.0, 0.45, behind);      // 月牙：中间厚，两头收成尖；正在扫的那一头也是尖的
      float edge = smoothstep(0.94 - 0.14 * sh, 0.94 - 0.03 * sh, r) * (1.0 - smoothstep(0.945, 0.965, r));
      float body = smoothstep(0.94 - uW * sh, 0.94, r) * (1.0 - step(0.955, r));
      a = (edge * 0.95 + body * (0.15 + 0.5 * body) * (0.7 + 0.3 * sin(r * 70.0 + uSeed))) * tr;
      col = mix(uB, uA, clamp(edge + body * body * body * 0.4, 0.0, 1.0));
    } else if (uKind == 3) {                                   // 压舱：一摊慢慢起伏的深水
      float n = vn(p * 3.0 + uSeed + uTime * 0.15), rp = sin((r - uTime * 0.22) * 15.0 + n * 4.0) * 0.5 + 0.5;
      a = (0.6 + 0.4 * rp * rp) * (1.0 - smoothstep(0.5, 1.0, r + (n - 0.5) * 0.25));
      col = mix(uA, uB, rp * rp * 0.4 * smoothstep(0.35, 0.85, r));
    } else {                                                   // 漩涡：越往中心越深；几条断断续续的白沫旋臂往里卷（uW 管白沫多少），越靠里转得越快；uR 那一圈是沉在水下的钟口，透一点青光（uFill 管亮度）
      float ang = atan(p.y, p.x), n = vn(p * 4.0 + uSeed), ph = ang * 3.0 + log(r + 0.04) * 5.0 - uHead * (1.0 + (1.0 - r)) * 3.0 + n * 1.3;
      float arm = sin(ph) * 0.5 + 0.5;
      float foam = smoothstep(0.972, 0.999, arm) * (0.15 + 0.85 * smoothstep(0.3, 0.7, vn(vec2(ph * 0.9, r * 12.0) + uSeed))) * uW;      /* 第九轮 fx2a：旋臂收细（原来是一大片奶白的宽带子） */
      float fine = smoothstep(0.9, 1.0, sin(ph * 2.0 + 1.7 + n * 2.0) * 0.5 + 0.5) * 0.22 * uW;
      float depth = 1.0 - smoothstep(0.08, 0.9, r);
      float rim = smoothstep(0.92, 0.955, r + (n - 0.5) * 0.04) * (1.0 - smoothstep(0.965, 1.0, r)) * (0.4 + 0.6 * uW);
      float eye = exp(-pow((r - uR) / 0.035, 2.0)) * uFill;
      float f = clamp((foam + fine) * smoothstep(0.08, 0.3, r) * (0.45 + 0.55 * r) + rim * 0.7, 0.0, 1.0) * (1.0 - smoothstep(0.95, 1.0, r));
      col = mix(mix(mix(uB, uB * ${FXB.on ? "0.5" : "0.25"}, depth), uA, f), uC, clamp(eye, 0.0, 1.0));      /* 换画风 B：中心压到一半就够深，压到四分之一在亮地面上是一个黑洞 */
      a = max((0.62 + 0.3 * depth + 0.08 * (1.0 - arm)) * (1.0 - smoothstep(0.93, 1.0, r)), max(f * 0.58, eye));
    }
    a *= uAlpha * (1.0 - step(1.0, r)); if (a < 0.004) discard;
    gl_FragColor = vec4(col, min(a, 1.0));
    #include <colorspace_fragment>
  }`;
type Uni = Record<string, { value: any }>;
interface Wave { m: THREE.Mesh; u: Uni; kill: () => void; fit: (x: number, z: number) => void; }
/** 铺一张波。给了 y 就是平着悬在那个高度的；不给就贴着地面。fit 把它挪到别处并重新贴地 */
function wave(fx: FxLib, kind: 0 | 1 | 2 | 3 | 4, x: number, z: number, r: number, cA: number, cB: number, p: { y?: number; yaw?: number; angle?: number; w?: number; gap?: number; n?: number; fill?: number; cC?: number } = {}): Wave {
  const u: Uni = { uKind: { value: kind }, uR: { value: 0 }, uS: { value: 1 }, uAlpha: { value: 0 }, uSeed: { value: Math.random() * 40 }, uAngle: { value: p.angle ?? 4 }, uW: { value: p.w ?? 0.2 }, uGap: { value: p.gap ?? 0.2 }, uN: { value: p.n ?? 4 },
    uFill: { value: p.fill ?? 0 }, uHead: { value: 0 }, uTime: { value: 0 }, uA: { value: new THREE.Color(cA) }, uB: { value: new THREE.Color(cB) }, uC: { value: new THREE.Color(p.cC ?? cA) } };
  const mat = new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, vertexShader: WAVE_VERT, fragmentShader: WAVE_FRAG });
  const air = p.y !== undefined, seg = r > 3 ? 24 : 8, geo = air ? flat : grids[seg]?.pop() ?? new THREE.PlaneGeometry(2, 2, seg, seg).rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, mat); m.scale.set(r, 1, r); m.rotation.y = p.yaw ?? 0; m.renderOrder = 5; m.frustumCulled = false; fx.group.add(m);
  const fit = (nx: number, nz: number) => {
    m.position.set(nx, air ? p.y! : 0, nz); if (air) return;
    const pos = geo.getAttribute("position") as THREE.BufferAttribute, cs = Math.cos(m.rotation.y), sn = Math.sin(m.rotation.y);
    for (let i = 0; i < pos.count; i++) { const lx = pos.getX(i) * r, lz = pos.getZ(i) * r; pos.setY(i, fx.ground(nx + lx * cs + lz * sn, nz - lx * sn + lz * cs) + 0.09); }
    pos.needsUpdate = true;
  };
  fit(x, z);
  return { m, u, fit, kill() { fx.group.remove(m); mat.dispose(); if (!air) (grids[seg] ??= []).push(geo); } };
}
/** 一道厚的冲击波，从小长到 r 米再淡掉 */
function shock(api: Api, fx: FxLib, x: number, z: number, r: number, o: { yaw?: number; angle?: number; w?: number; crest?: number; grow?: number; fade?: number; fill?: number; alpha?: number; from?: number; cB?: number } = {}) {
  const w = wave(fx, 1, x, z, r, FOAM, o.cB ?? GLOW, { yaw: o.yaw, angle: o.angle, w: o.w ?? 0.3, gap: o.crest ?? 0.05, fill: o.fill ?? 0 }), grow = o.grow ?? 0.28, fade = o.fade ?? 0.3, f0 = o.from ?? 0.15, al = o.alpha ?? 1;
  api.run(grow + fade, k => { const t = k * (grow + fade), g = Math.min(1, t / grow); w.u.uR.value = f0 + (1 - f0) * (1 - (1 - g) * (1 - g)); w.u.uAlpha.value = al * (t < grow ? Math.min(1, t / 0.03) : 1 - (t - grow) / fade); }, w.kill);
}
/** 钟声：n 圈很薄的环依次往外走，领头的一圈 sec 秒走到 r 米 */
function toll(api: Api, fx: FxLib, x: number, z: number, r: number, sec: number, o: { n?: number; gap?: number; thick?: number; alpha?: number; cA?: number; cB?: number } = {}) {
  const R = r / 0.95, n = o.n ?? 4, gap = o.gap ?? 0.17, total = sec * (1 + (n - 1) * gap) / 0.95, al = o.alpha ?? 1;
  const w = wave(fx, 0, x, z, R, o.cA ?? pick(FOAM, GLOW), o.cB ?? BRONZE, { w: (o.thick ?? 0.09) / R, gap, n });      // 换画风 B：领头那圈是饱和的青（白的在亮石板上看不见）
  api.run(total, k => { const t = k * total; w.u.uR.value = 0.95 * t / sec; w.u.uAlpha.value = al * Math.min(1, t / 0.04); }, w.kill);
}
/** 贴着地面朝四周泼出去的一圈水 */
function spray(fx: FxLib, x: number, y: number, z: number, r: number, n: number, speed: [number, number], up: number, o: Partial<BurstOpts> = {}) {
  for (let i = 0; i < n; i++) { const a = ((i + Math.random()) / n) * 6.2832, cs = Math.cos(a), sn = Math.sin(a);
    fx.burst({ pos: { x: x + cs * r, y, z: z + sn * r }, n: 2, sprite: SPR.drop, color: [FOAM, BRONZE], dir: { x: cs, y: up, z: sn }, spread: 0.25, speed, size: [0.1, 0.22], life: [0.35, 0.65], gravity: 12, stretch: 1, ...o }); }
}
/** 崩出来的铜绿碎屑：一半从白沫色落到铜绿，一半从铜绿落到深水色（地面本身偏青，全用铜绿看不出来） */
function chips(fx: FxLib, pos: V3, dx: number, dy: number, dz: number, n: number, spread = 0.85) {
  for (const color of [[FOAM, BRONZE], [BRONZE, DEEP]] as [number, number][])
    fx.burst({ pos, n: Math.ceil(n / 2), sprite: SPR.shard, color, dir: { x: dx, y: dy, z: dz }, spread, speed: [2.5, 6.5], size: [0.12, 0.24], life: [0.4, 0.65], gravity: 14, spin: 9 });
}

// 钟形的罩子：一口没有底的钟，只有轮廓和钟口那一圈看得清，身上有一圈圈往上走的纹。护盾罩在身上的、沉没里砸下去的都是它。
const bellGeo = new THREE.LatheGeometry([[1, 0], [1, 0.035], [0.93, 0.08], [0.9, 0.3], [0.89, 0.55], [0.85, 0.74], [0.73, 0.87], [0.5, 0.955], [0.22, 0.992], [0, 1]].map(([r, y]) => new THREE.Vector2(r, y)), 40);
const BELL_VERT = `varying vec3 vN, vV; varying float vY, vU; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); vY = position.y; vU = uv.x; gl_Position = projectionMatrix * mv; }`;
const BELL_FRAG = /* glsl */ `
  uniform float uTime, uAlpha, uFlash, uFill, uRip; uniform vec3 uA, uB; varying vec3 vN, vV; varying float vY, vU;
  void main() {
    float fr = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.6);
    float hoop = (1.0 - smoothstep(0.0, 0.014, abs(vY - 0.1))) + (1.0 - smoothstep(0.0, 0.01, abs(vY - 0.36))) + (1.0 - smoothstep(0.0, 0.01, abs(vY - 0.76)));      // 钟身上的三道箍
    float rib = (1.0 - smoothstep(0.0, 0.025, abs(fract(vU * 8.0) - 0.5))) * step(0.36, vY) * step(vY, 0.76);                                                     // 两道箍之间的八条竖棱
    float rip = smoothstep(0.8, 1.0, sin(vY * 24.0 - uTime * 5.0) * 0.5 + 0.5) * (1.0 - vY);                                                                    // 一圈圈往上走的余音
    float lip = 1.0 - smoothstep(0.0, 0.06, vY);
    float a = (fr * 0.7 + (hoop + rib * 0.6) * 0.34 + rip * uRip + lip * 0.34 + uFill + uFlash * 0.12) * uAlpha; if (a < 0.004) discard;
    gl_FragColor = vec4(mix(uB, uA, clamp(fr * 0.8 + lip * 0.5 + uFlash * 0.6, 0.0, 1.0)), min(a, 1.0));
    #include <colorspace_fragment>
  }`;
type Bell = Omit<Wave, "fit">;
function bell(fx: FxLib, cA: number, cB: number, fill = 0, rip = 0): Bell {
  const u: Uni = { uTime: { value: 0 }, uAlpha: { value: 0 }, uFlash: { value: 0 }, uFill: { value: fill }, uRip: { value: rip }, uA: { value: new THREE.Color(cA) }, uB: { value: new THREE.Color(cB) } };
  const mat = new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false, side: THREE.DoubleSide, vertexShader: BELL_VERT, fragmentShader: BELL_FRAG });
  const m = new THREE.Mesh(bellGeo, mat); m.renderOrder = 7; m.frustumCulled = false; fx.group.add(m);
  return { m, u, kill() { fx.group.remove(m); mat.dispose(); } };
}

// 每个托尔格自己跨帧存的东西（放在 a.data 里）
interface State { cut: number; buffAt: number; acc: number; accT: number; lowK: number; low?: Wave; bub: number; shieldTill: number; shieldK: number; lastShield: number; flash: number; ring: number; shell?: Bell; leap: { t0: number; dur: number; h: number } | null; }
const state = (a: Actor): State => (a.data.torg ??= { cut: -1, buffAt: 0, acc: 0, accT: 0, lowK: 0, bub: 0, shieldTill: -1, shieldK: 0, lastShield: 0, flash: 0, ring: 0, leap: null });
const tmpA = v3();
/** 钟现在在哪：武器上离手最远的那一头；模型没配武器就用手 */
const bellAt = (a: Actor, out: THREE.Vector3) => (a.hero.blade("R", tmpA, out) || a.hero.blade("L", tmpA, out) ? out : a.hand(out));

const P: SkillDef = { key: "P", name: "压舱", icon: "torg_p", cast: "passive",
  desc: "生命越低越硬：每损失 10% 生命，受到的伤害减少 3%（最多 24%），并加快生命恢复。" };

const Q: SkillDef = { key: "Q", name: "撞钟", icon: "torg_q", cast: "dir", range: QR, angle: QA, cd: 7, mana: 55,
  desc: "猛地甩身，背上的沉钟横扫过面前的扇形：造成 170 + 70% 攻击力的物理伤害，把敌人击退 2.5 米并眩晕 0.8 秒。",
  start(c) {                                                  // 起手（前摇多长就多长，原来 0.38 秒）：钟上亮一点青光，水往钟上收
    const { a, fx } = c, p = bellAt(a, v3()), w = windup(a, "q");
    fx.burst({ pos: p, n: 1, sprite: SPR.glint, add: true, color: GLOW, size: 0.8, grow: 2.2, life: w, speed: 0, alpha: 0.8 });
    converge(fx, p, 1.6, 12, Math.max(0.1, w * 0.9), [FOAM, BRONZE]);
  },
  fire(c) {
    const { me, a, api, fx } = c, x = me.x, z = me.z, y = fx.ground(x, z), yaw = Math.atan2(c.dx, c.dz), dmg = 170 + c.ad * 0.7 + c.lv * 20;
    const list = api.inCone(me, x, z, c.dx, c.dz, QR, QA).filter(e => !isBuilding(e));
    for (const e of list) {
      api.hit(me, e, dmg, "phys");
      if (e.alive) { api.push(e, c.dx, c.dz, 2.5, 0.25); api.stun(e, 0.8); }
      const at = api.pos(e, 1.1);                              // 打中的每一个：白芯一下、脚下溅起一小圈水冠、崩出几片铜绿；被推开的一路拖着水
      fx.impact(at, { color: FOAM, color2: GLOW, size: 1.25, dir: { x: c.dx, y: 0.4, z: c.dz } });
      crown(api, fx, e.x, e.z, { r: e.r * 0.7 + 0.2, r2: e.r + 1.1, h: 1.6, life: 0.42, rise: 0.07, deep: ABYSS, color2: BRONZE, alpha: 0.85 });
      chips(fx, at, c.dx, 0.6, c.dz, 6);
      if (e.alive) { const em = fx.emitter({ pos: { x: e.x, y: 0, z: e.z }, rate: 40, sprite: SPR.drop, color: [FOAM, BRONZE], size: [0.08, 0.16], life: [0.3, 0.45], speed: [0.5, 1.6], up: 1.4, gravity: 9 }); api.run(0.28, () => em.at(e.x, fx.ground(e.x, e.z) + 0.25, e.z), () => em.stop()); }
    }
    // 横扫：钟扫过去的轨迹是一道很厚的月牙（前沿一道亮边，后面是铜绿的身体，底下垫深色），从右扫到左；
    // 地上一道扇形的厚冲击波（前沿白沫、身体压深），扫过的地方留几道弧形的刮痕
    blade(api, fx, { pos: { x, y: a.pos.y + 1.5, z }, yaw, r: QR + 0.25, arc: QA * 2 + 0.45, width: 0.6, life: 0.5, sweep: 0.13, tail: 0.95, deep: ABYSS, color: FOAM, color2: GLOW });
    shock(api, fx, x, z, QR, { yaw, angle: QA + 0.05, w: 0.4, crest: 0.1, grow: 0.26, fade: 0.45, fill: 0.12, from: 0.25, cB: DEEP });
    mark(api, fx, { kind: "groove", x, z, r: QR + 0.3, yaw, ang: QA + 0.1, life: 1.0, hot: 1, hotLife: 0.22, deep: ABYSS, color2: BRONZE, color: FOAM, alpha: 0.8, fadeOut: 0.6 });
    fx.flash(bellAt(a, v3()), GLOW, 1.6, 0.12, false);
    fx.burst({ pos: { x: x + c.dx * 1.2, y: y + 0.3, z: z + c.dz * 1.2 }, n: 24, sprite: SPR.drop, color: [FOAM, BRONZE], dir: { x: c.dx, y: 0.22, z: c.dz }, spread: 0.7, speed: [5, 12], size: [0.09, 0.2], life: [0.28, 0.5], gravity: 11, drag: 1.5, stretch: 1.1 });
    fx.shake(list.length ? 0.08 : 0.04, 0.18);
  },
};

const W: SkillDef = { key: "W", name: "余音", icon: "torg_w", cast: "self", radius: WR, cd: 11, mana: 65,
  desc: "震响背上的沉钟，声波向外扩散：减速周围的敌人 40% 并造成伤害，自己获得一层护盾。",
  start(c) {                                                  // 起手（前摇多长就多长，原来 0.66 秒）：钟上的青光越聚越亮，地上的水往他脚下收
    const { a, api, fx } = c, p = bellAt(a, v3()), x = a.pos.x, z = a.pos.z, y = fx.ground(x, z), w = windup(a, "w");
    fx.burst({ pos: p, n: 1, sprite: SPR.glint, add: true, color: GLOW, size: 0.6, grow: 3, life: w, speed: 0, alpha: 0.75 });
    converge(fx, p, 1.4, 8, Math.max(0.1, w * 0.8), [0xffffff, GLOW], { add: true, size: [0.1, 0.18] });
    api.after(w * 0.2, () => converge(fx, { x, y: y + 0.2, z }, 3.2, 18, Math.max(0.1, w * 0.75), [FOAM, BRONZE], { flat: true }));      // 地上的水往他脚下收（声音在攒）
    // （第九轮 polish-old：原来这里还有几圈往里收的细环，和放出去的环加起来满屏都是圈，去掉了）
  },
  fire(c) {
    const { me, a, api, fx } = c, S = state(a), x = me.x, z = me.z, y = fx.ground(x, z), dmg = 120 + c.ad * 0.4 + c.lv * 20, done = new Set<number>();
    api.shieldOwn(me, 280 + me.max * 0.1, 4); S.shieldTill = api.time() + 4;      // 罩子的样子在 passive 里画
    // 声波 0.5 秒走到 6 米，走到谁那儿谁才中
    api.run(0.5, k => {
      for (const e of api.enemies(me, x, z, WR * k)) {
        if (done.has(e.id) || isBuilding(e)) continue; done.add(e.id);
        api.hit(me, e, dmg, "magic"); if (e.alive) api.slow(e, 0.4, 2);
        fx.burst({ pos: api.pos(e, 0.9), n: 4, sprite: SPR.drop, color: [FOAM, BRONZE], speed: [1, 3], up: 1.5, size: [0.08, 0.15], life: [0.25, 0.4], gravity: 9 });
        crown(api, fx, e.x, e.z, { r: e.r * 0.6 + 0.2, r2: e.r + 0.7, h: 1.1, life: 0.35, rise: 0.06, deep: ABYSS, color2: BRONZE, alpha: 0.7 });
      }
    });
    // 钟响（第九轮 polish-old 重排）：原来是声壳 + 厚环 + 三圈细环 + 钟上两圈环 + 矮水墙，五六道圈叠在一起，读成“几道环”，不像敲钟。
    // 参照 Dota 2 斯拉达的鱼人碎击（Slithereen Crush）、LoL 诺提勒斯的 E：声音把水震起来——
    //   ① 钟本身：身上那口钟罩被敲得一胀一缩（passive 里画，这里给它一下），钟口往外喷一圈水；
    //   ② 一道往外推的水墙（声波），比原来高、顶上是一舌舌的水，前沿一路把水甩上天；
    //   ③ 声波扫过的地方变成一片湿的深色（看得出 6 米的范围是一片，不是一根线），慢慢干掉；
    //   ④ 前沿只留一道厚环（白沫的边 + 压深的身体）
    S.ring = 1;
    crown(api, fx, x, z, { r: 2.2, r2: 3.4, h: 2.0, life: 0.38, rise: 0.08, deep: ABYSS, color2: GLOW, alpha: 0.85, flare: 0.45 });      // 钟口一圈水冠（钟一响，脚下的水先跳起来）
    crown(api, fx, x, z, { r: 1.6, r2: WR + 0.2, h: 1.7, life: 0.6, rise: 0.1, deep: ABYSS, color2: BRONZE, alpha: 0.85, flare: -0.1 });      // 声波推出去的水墙，边走边矮
    shock(api, fx, x, z, WR, { w: 0.34, crest: 0.06, grow: 0.5, fade: 0.5, from: 0.12, cB: ABYSS, alpha: 0.9, fill: 0.3 });      // 前沿一道白沫，后面拖一段压暗的厚带，圈里压一层深色：6 米的范围是一片，不是一根线
    const wet = mark(api, fx, { kind: "stain", x, z, r: WR + 0.4, life: 1.9, grow: 0.15, deep: 0x0d3a40, color2: BRONZE, alpha: 0.85, fadeIn: 0.02, fadeOut: 0.55 });      // 扫过的地方湿成一片
    api.run(0.5, k => wet.size(0.15 + 0.87 * (1 - (1 - k) * (1 - k))));
    let acc = 0.05; api.run(0.5, (k, dt) => { acc += dt; if (acc < 0.05 || k > 0.97) return; acc = 0; const r = 0.6 + (WR - 0.6) * (1 - (1 - k) * (1 - k)); splash(fx, x, y + 0.1, z, r, 12, [1.5, 3.5], 3.2, [FOAM, BRONZE], [0.1, 0.18]); });      // 前沿一路把水甩起来
    // 声音震着地上的水：声波扫过的地方，水珠一颗颗原地往上跳（不是往外飞），越靠前沿跳得越高——“余音”就是这片还在颤的水
    let jump = 0; api.run(0.9, (k, dt) => { jump += dt * (LITE ? 70 : 140) * (1 - k); const front = WR * Math.min(1, 1 - (1 - Math.min(1, k * 1.8)) ** 2);
      while (jump >= 1) { jump -= 1; const an = Math.random() * 6.2832, rr = 1.2 + (front - 1.2) * Math.sqrt(Math.random()), px = x + Math.cos(an) * rr, pz = z + Math.sin(an) * rr, near = Math.max(0, 1 - (front - rr) / 2.5);
        fx.burst({ pos: { x: px, y: fx.ground(px, pz) + 0.08, z: pz }, n: 1, sprite: SPR.drop, color: [FOAM, BRONZE], alpha: 0.9, dir: { x: 0, y: 1, z: 0 }, spread: 0.12, speed: [1.5 + 2.5 * near, 2.5 + 3 * near], size: [0.14, 0.24], life: [0.3, 0.5], gravity: 14, stretch: 0.6 }); } });
    fx.flash(bellAt(a, v3()), GLOW, 1.4, 0.12, false);
    fx.burst({ pos: { x, y: y + 0.15, z }, n: 18, sprite: SPR.drop, ringR: 1.8, color: [FOAM, BRONZE], speed: [1.5, 3], up: 4, size: [0.12, 0.2], life: [0.45, 0.65], gravity: 10 });      // 钟口喷起来的一圈水
  },
};

const R: SkillDef = { key: "R", name: "沉没", icon: "torg_r", cast: "point", range: 6, radius: RR, cd: 75, mana: 110, minLevel: 6,
  desc: "跃向一处重重砸下，形成漩涡把敌人拖向中心；最后一声钟响造成 350 + 100% 攻击力的物理伤害并眩晕。",
  start(c) {                                                  // 蓄力：脚下的水卷起来；落点先亮出范围
    const { a, api, fx } = c, x = a.pos.x, z = a.pos.z, to = api.walkable(c.x, c.z) ? [c.x, c.z] : api.nearest(c.x, c.z); c.data.to = to;
    fx.decal({ kind: "swirl", x, z, r: 1.9, life: 0.7, color: BRONZE, color2: DEEP, alpha: 0.65, fadeIn: 0.2, fadeOut: 0.5 });
    fx.burst({ pos: { x, y: a.pos.y + 0.2, z }, n: 16, sprite: SPR.drop, ringR: 1.2, color: [FOAM, BRONZE], speed: [0.3, 1], up: 4, size: [0.1, 0.2], life: [0.4, 0.7], gravity: 6 });
    const wr = windup(a, "r", true) + 0.45, spot = mark(api, fx, { kind: "target", x: to[0], z: to[1], r: RR, life: wr + 0.05, deep: ABYSS, color2: GLOW, color: FOAM, alpha: 0.85, fadeIn: 0.15, fadeOut: 0.25 });      // 落点预告：边线清楚，几道刻度往里收（给敌人看范围），一直亮到砸下来（前摇 + 0.45 秒的跳）
    api.run(wr, k => spot.head(k));
  },
  fire(c) {
    const { me, a, api, fx } = c, S = state(a), [tx, tz] = c.data.to as [number, number], T = 0.45, H = 2.4, BR = 1.9, BH = 4.0;
    a.lock(T + 0.6); S.leap      /* 落地后多趴 0.4 秒再起身（原来 0.22 秒就切回站姿，砸地的姿势看不到） */ = { t0: api.time(), dur: T, h: H };
    // 起跳：脚下炸开一圈水，身后拖一串水珠；那口钟跟着他一起落下来，越落越实
    fx.ring(a.pos.x, a.pos.z, 2.2, BRONZE, 0.4, false);
    fx.burst({ pos: { x: a.pos.x, y: a.pos.y + 0.2, z: a.pos.z }, n: 14, sprite: SPR.drop, color: [FOAM, BRONZE], spread: 1.2, speed: [2, 5], size: [0.1, 0.2], life: [0.3, 0.5], gravity: 12 });
    const trail = fx.emitter({ pos: a.pos, rate: 60, sprite: SPR.drop, color: [FOAM, DEEP], size: [0.09, 0.17], life: [0.3, 0.5], speed: [0.4, 1.6], gravity: 9 });
    const big = bell(fx, GLOW, BRONZE, 0.03, 0.05); let landed = false, gone = false;
    const drop = () => { if (!gone) { gone = true; big.kill(); } };
    api.run(T, k => { if (landed) return; const jy = H * 4 * k * (1 - k), s = 0.55 + 0.45 * k;
      trail.at(a.pos.x, a.pos.y + jy + 1.2, a.pos.z); big.m.position.set(a.pos.x, a.pos.y + jy + 2.2 * (1 - k) * (1 - k), a.pos.z); big.m.scale.set(BR * s, BH * s, BR * s); big.u.uAlpha.value = k * 0.8; big.u.uTime.value = fx.time(); });
    api.after(T + 0.15, () => { if (!landed) { trail.stop(); drop(); } });      // 半路被打断：没有落地，就没有后面的事

    const land = () => {
      landed = true; trail.stop();
      const x = a.pos.x, z = a.pos.z, y = fx.ground(x, z);
      for (const e of api.enemies(me, x, z, RR)) if (!isBuilding(e)) api.hit(me, e, 150 + c.ad * 0.5, "phys");
      // 落地：闪一下、一圈厚冲击波、一根水柱、泼出去一圈水，镜头一震；钟砸进水里沉下去
      fx.flash({ x, y: y + 1, z }, FOAM, 5, 0.18); fx.shake(0.18, 0.36); fx.impact({ x, y: y + 0.6, z }, { color: FOAM, color2: GLOW, size: 1.8, big: true });
      shock(api, fx, x, z, RR, { w: 0.3, grow: 0.3, fade: 0.35 });
      crown(api, fx, x, z, { r: 1.5, r2: 4.4, h: 4.2, life: 0.9, rise: 0.12, deep: ABYSS, color2: GLOW, alpha: 0.9, flare: 0.5 });
      mark(api, fx, { kind: "crack", x, z, r: 4.6, life: 3.2, hot: 1, hotLife: 0.45, deep: 0x1b4a52, color: FOAM, color2: GLOW, alpha: 0.7, fadeOut: 0.3 });
      spray(fx, x, y + 0.2, z, 1.4, 14, [4, 9], 0.9);
      fx.burst({ pos: { x, y: y + 0.3, z }, n: 22, sprite: SPR.drop, radius: 1, color: [FOAM, BRONZE], spread: 0.9, speed: [4, 10], size: [0.1, 0.24], life: [0.45, 0.8], gravity: 14 });
      big.m.position.set(x, y, z); big.m.scale.set(BR, BH, BR);
      api.run(0.45, k => { big.m.position.y = y - BH * 0.9 * k * k; big.u.uAlpha.value = 0.85 * (1 - k * k); big.u.uFlash.value = Math.max(0, 1 - k * 4); big.u.uTime.value = fx.time(); });
      // 漩涡：一片转着的深水（边上一道白沫就是范围），水珠和白沫一圈圈往里卷；最后一响以后它不马上没，慢慢平下去
      const vor = wave(fx, 4, x, z, RR, FOAM, VORTEX, { cC: GLOW, w: 0.8 }); vor.u.uR.value = BR / RR;
      crown(api, fx, x, z, { r: RR * 0.96, r2: RR * 1.08, h: 0.85, rise: 0.3, hold: 2.3, life: 3.0, deep: ABYSS, color2: GLOW, alpha: 0.7, flare: -0.22 });      // 漩涡的边上一圈翻起来的水墙（往里卷），范围一眼看得出，最后一响时塌掉
      let ang = 0, acc = 0, conv: Wave | null = null;
      api.zone({ me, x, z, r: RR, dur: 2.5, tick: 0.25,
        each(e) { if (isBuilding(e)) return; api.drag(e, x, z, 1.1); api.slow(e, 0.3, 0.5); },
        frame(zn, dt) {
          const t = zn.t, open = Math.min(1, t / 0.3), grow = 0.3 + 0.7 * (1 - (1 - open) * (1 - open)), tight = Math.max(0, (t - 1.75) / 0.75);      // tight：最后四分之三秒从 0 走到 1，漩涡收紧
          ang += dt * (1.3 + 4.5 * tight * tight); vor.u.uS.value = grow; vor.u.uHead.value = ang; vor.u.uAlpha.value = Math.min(1, t / 0.15); vor.u.uFill.value = 0.22 + 0.5 * tight; vor.u.uW.value = 0.8 + 0.2 * tight;
          acc += dt * (60 + 60 * tight);
          while (acc >= 1) { acc -= 1; const ph = Math.random() * 6.2832, rr = RR * (0.3 + 0.65 * Math.random()), cs = Math.cos(ph), sn = Math.sin(ph), vt = 3.5 + 2.5 * Math.random() + 3 * tight, vr = 2 + 1.5 * Math.random() + 2 * tight, streak = Math.random() < 0.55;
            fx.burst({ pos: { x: x + cs * rr, y: y + 0.14, z: z + sn * rr }, n: 1, sprite: streak ? SPR.streak : SPR.drop, color: [FOAM, BRONZE], alpha: streak ? 0.7 : 0.9, dir: { x: -sn * vt - cs * vr, y: 0, z: cs * vt - sn * vr }, spread: 0.04,
              speed: Math.hypot(vt, vr), size: streak ? [0.5, 0.85] : [0.14, 0.24], life: [0.35, 0.6], stretch: streak ? 1.6 : 1, up: streak ? 0.15 : 1.6, gravity: streak ? 0 : 6 }); }
          if (tight > 0) {                                    // 预告：几圈细环从边上收到中心，沉下去的钟从水里升起来
            conv ??= wave(fx, 0, x, z, RR, GLOW, GLOW, { w: 0.016, gap: -0.2, n: 3 });
            conv.u.uR.value = 1 - 0.9 * tight; conv.u.uAlpha.value = Math.min(1, tight * 4) * 0.8;
            const e = 1 - (1 - tight) * (1 - tight); big.m.position.y = y - BH * 0.9 * (1 - e); big.u.uAlpha.value = 0.8 * e; big.u.uTime.value = fx.time();
          }
        },
        end() {
          conv?.kill(); api.run(2.2, (k, dt) => { ang += dt * 5 * (1 - k) * (1 - k); vor.u.uHead.value = ang; vor.u.uW.value = Math.max(0, 1 - k * 2.5); vor.u.uFill.value = 0.7 * Math.max(0, 1 - k * 5); vor.u.uAlpha.value = 0.85 * Math.pow(1 - k, 1.3); }, vor.kill);
          // 最后一声钟响：由内向外一圈重冲击波，后面跟着几圈钟声；水柱、泼出去的水，镜头再震一下
          const dmg = 350 + c.ad + c.lv * 45;
          for (const e of api.enemies(me, x, z, RR)) { if (isBuilding(e)) continue;
            api.hit(me, e, dmg, "phys", true); if (e.alive) api.stun(e, 1); fx.impact(api.pos(e, 1.1), { color: FOAM, color2: GLOW, size: 1.3, big: true }); if (e.kind === "hero") fx.hitstop(0.08);      // 最后一响打中（第九轮）：白芯和顿帧
            fx.burst({ pos: api.pos(e, 1), n: 6, sprite: SPR.drop, color: [FOAM, BRONZE], spread: 0.8, speed: [3, 7], up: 2, size: [0.1, 0.2], life: [0.3, 0.55], gravity: 13 }); }
          fx.flash({ x, y: y + 1.4, z }, GLOW, 5.5, 0.2); fx.shake(0.15, 0.4);
          shock(api, fx, x, z, RR, { w: 0.42, grow: 0.32, fade: 0.4, from: 0.1, cB: DEEP });
          dome(api, fx, x, y, z, { r0: 1.6, r1: RR + 1.4, hk: 0.6, grow: 0.42, fade: 0.28, alpha: 0.6, color: FOAM, color2: GLOW });
          api.after(0.1, () => toll(api, fx, x, z, RR * 1.15, 0.5, { n: 3, alpha: 0.7, cA: GLOW }));
          crown(api, fx, x, z, { r: 1.8, r2: 5.0, h: 5.2, life: 1.0, rise: 0.13, deep: ABYSS, color2: GLOW, alpha: 0.9, flare: 0.5 });
          mark(api, fx, { kind: "crack", x, z, r: 5.4, life: 2.0, hot: 1, hotLife: 0.4, deep: 0x1b4a52, color: FOAM, color2: GLOW, alpha: 0.7, fadeOut: 0.5 });
          spray(fx, x, y + 0.2, z, 1.6, 18, [5, 11], 0.7);
          fx.burst({ pos: { x, y: y + 0.4, z }, n: 30, sprite: SPR.drop, radius: 1.2, color: [FOAM, BRONZE], spread: 0.8, speed: [5, 12], size: [0.1, 0.26], life: [0.5, 0.9], gravity: 14 });
          fx.burst({ pos: { x, y: y + 0.3, z }, n: 10, sprite: SPR.bubble, radius: RR * 0.6, color: FOAM, alpha: 0.6, speed: [0.2, 0.8], up: 1.2, size: [0.12, 0.26], life: [0.7, 1.3], drag: 1.2 });
          api.run(0.45, k => { const s = 1 + 0.14 * (1 - (1 - k) * (1 - k)); big.m.position.y = y; big.m.scale.set(BR * s, BH * s, BR * s); big.u.uFlash.value = Math.max(0, 1 - k * 4); big.u.uAlpha.value = 0.85 * (1 - k) * (1 - k); big.u.uTime.value = fx.time(); }, drop);
        } });
    };
    api.dash(me, tx, tz, T, land);
  },
};

export const torg: HeroKit = {
  id: "torg", name: "托尔格", title: "沉钟", role: "斗士", side: 0, color: 0x6fb8a4, color2: 0x7fe9e4, height: 2.8, look: { ring: 1.7, lift: 1.05, sat: 1.6 },      /* 换画风 B（w-quad）：卡通版的龟甲是 Tripo 照设定图出的暖沙褐，贴图本身浅，按默认的提亮 1.4 在游戏里发白（中间调 163,164,153），压到 1.05、饱和度提到 1.6 以后是金褐（136,135,116 一带），和设定图的龟甲接近。2026-11-19 换成了四足的钟龟：身高连背上的钟一起算 2.6 米，身长约 3.4 米，脚下的圈放大 */
  base: { hp: 4000, mana: 520, ad: 190, ap: 0, armor: 42, mr: 30, ms: 5.0, as: 1.0, range: 3.4,      /* 钟龟：个头大，够得远一点（不然撞的时候头会穿进目标）；走得慢一点 */
    cdr: 0, ls: 0, hpRegen: 0.007, manaRegen: 0.012 },
  skills: [P, Q, W, R],
  attack(c) {                                                 // 重锤砸中：一圈小的冲击波，崩出几片铜绿和一点水沫。不改伤害
    const { me, api, fx, target: e } = c, dx = e.x - me.x, dz = e.z - me.z, l = Math.hypot(dx, dz) || 1, ix = e.x - (dx / l) * e.r * 0.6, iz = e.z - (dz / l) * e.r * 0.6;
    const at = { x: ix, y: api.height(ix, iz) + (isBuilding(e) ? 2 : 1.1), z: iz };
    shock(api, fx, ix, iz, 1.6, { w: 0.4, grow: 0.16, fade: 0.24, from: 0.3, alpha: 0.8 }); fx.flash(at, FOAM, 1.3, 0.09, false);
    chips(fx, at, dx / l, 0.8, dz / l, 8);
    fx.burst({ pos: at, n: 5, sprite: SPR.drop, color: [FOAM, BRONZE], spread: 1.4, speed: [1.5, 4.5], size: [0.09, 0.16], life: [0.25, 0.45], gravity: 11 });
  },
  passive(c, dt) {
    const { me, a, api, fx } = c, S = state(a), now = api.time(), x = a.pos.x, z = a.pos.z; warmFx2a(api, fx, x, z);
    // 沉没的那一跃：给模型加一条抛物线的高度
    if (S.leap) { const k = (now - S.leap.t0) / S.leap.dur; if (k >= 1 || !me.alive) S.leap = null; else a.hero.group.position.y += S.leap.h * 4 * k * (1 - k); }
    // 压舱：每损失一成生命少受 3% 伤害（最多 24%）；每秒多回“已损失生命的 0.8%”，每半秒结一次
    const lost = me.alive ? 1 - me.hp / me.max : 0;
    if (!me.alive) { S.cut = -1; S.acc = S.accT = 0; }
    else {
      const cut = Math.min(0.24, Math.floor(lost * 10 + 1e-6) * 0.03);
      if (cut !== S.cut || now >= S.buffAt) { S.cut = cut; S.buffAt = now + 0.5; if (cut > 0) api.buff(me, "ballast", 1, { dmgTaken: 1 - cut }); else if (api.hasBuff(me, "ballast")) api.unbuff(me, "ballast"); }
      S.acc += (me.max - me.hp) * 0.008 * dt; S.accT += dt;
      if (S.accT >= 0.5) { S.accT = 0; if (S.acc >= 1) { const n = Math.floor(S.acc); S.acc -= n; api.heal(me, me, n); } }
    }
    // 血低于一半：脚下一圈很淡的深水，越低越深，偶尔冒一个泡
    const lowT = me.alive && me.seen && lost > 0.5 ? 0.34 + 0.3 * Math.min(1, (lost - 0.5) / 0.3) : 0; S.lowK += (lowT - S.lowK) * (1 - Math.exp(-dt * 4));
    if (S.lowK > 0.01) {
      const w = (S.low ??= wave(fx, 3, x, z, 2.1, DEEP, BRONZE)); w.m.visible = true; if (Math.hypot(x - w.m.position.x, z - w.m.position.z) > 0.12) w.fit(x, z); w.u.uAlpha.value = S.lowK; w.u.uTime.value = fx.time();
      S.bub -= dt; if (S.bub <= 0 && lowT > 0) { S.bub = 0.4 + Math.random() * 0.4; fx.burst({ pos: { x, y: fx.ground(x, z) + 0.1, z }, n: 1, sprite: SPR.bubble, ringR: 0.5 + Math.random() * 0.9, color: [FOAM, BRONZE], alpha: 0.55, size: [0.1, 0.18], life: [0.7, 1.1], speed: 0.1, up: 1, drag: 0.8 }); }
    } else if (S.low) S.low.m.visible = false;
    // 余音的护盾：罩在身上的一口钟。挨打时亮一下；被打穿了就碎
    const on = me.alive && me.seen && me.shield > 0 && now < S.shieldTill;
    if (on && me.shield < S.lastShield - 0.5) S.flash = 1;
    if (!on && S.lastShield > 0 && me.alive && me.seen && now < S.shieldTill - 0.1) chips(fx, a.chest(tmpA), 0, 1, 0, 12, 2.4);
    S.lastShield = on ? me.shield : 0; S.flash = Math.max(0, S.flash - dt * 5); S.shieldK += ((on ? 1 : 0) - S.shieldK) * (1 - Math.exp(-dt * (on ? 14 : 7)));
    const rg = S.ring; S.ring = Math.max(0, S.ring - dt * 2.2);      // 余音敲响的那一下（第九轮 polish-old）：钟罩被敲得一胀一缩、晃几下再停，钟身上的纹往上走得快
    if (S.shieldK > 0.01) {
      const b = (S.shell ??= bell(fx, GLOW, BRONZE, 0.02, 0.14)), wob = rg * rg * Math.sin((1 - rg) * 30) * 0.22, s = 1 + (1 - S.shieldK) * 0.25 + wob; b.m.visible = true; b.m.position.copy(a.hero.group.position); b.m.scale.set(2.5 * s, 3.4 * (1 + (1 - S.shieldK) * 0.25 - wob * 0.6), 2.5 * s);      /* 钟罩按钟龟的身子放大：原来半径 1.6 米是给人形的，罩不住 3.4 米长的龟 */
      b.u.uAlpha.value = S.shieldK * 0.6; b.u.uFlash.value = Math.max(S.flash, rg * rg); b.u.uRip.value = 0.14 + 0.5 * rg; b.u.uTime.value = fx.time();
    } else if (S.shell) S.shell.m.visible = false;
  },
};
