// 葛隆 · 砧卫（坦克，烬誓庭）。
//
// 规格（数值是主线定的第一版，实现时照这个来；觉得哪里不合理，在报告里说，不要自己改数）：
//   Q 砧撞   非指向，距离 7.5，宽 1.6，冷却 9，法力 60。顶着盾向前冲 7.5 米（0.35 秒，会被墙挡住），撞到第一个敌人就停下：
//            160 + 60% 攻击力 + 每级 30 的物理伤害，眩晕 1.2 秒，并把它顶退 1 米。没撞到人就冲到底。
//   W 淬火   直接放，冷却 14，法力 70，引导 2.5 秒（移动或按 S 可以提前结束）。举盾期间受到的伤害只有四成；
//            结束时把挡下的伤害的 60%（至少 120 + 每级 20）朝面前的扇形（半张角 50 度，5 米）喷回去，魔法伤害。
//   E 余烬地 范围，施法距离 5，半径 3.2，冷却 10，法力 70。跳起砸地：范围内 140 + 50% 攻击力 + 每级 25 的物理伤害；
//            地上留 4 秒余烬：每 0.5 秒 30 + 每级 6 的魔法伤害，减速 35%。
//   R 开闸   大招，6 级，直接放，半径 6.5，冷却 70，法力 100。嘲讽 6.5 米内所有敌人 2.2 秒（它们只能打他）；
//            自己 5 秒内护甲和魔抗各加 60；这 5 秒里每 0.5 秒灼烧周围 6.5 米：45 + 每级 10 + 3% 自己的最大生命，魔法伤害。
//
// 实现时定下来的几件规格里没写的事：
//   · 四个技能都不打建筑（塔和水晶）。开闸的灼烧按最大生命算，打得动建筑的话一个大招能烧掉大半座塔。
//   · 砧撞：冲刺是匀速的，被墙挡住时冲得近、用时也按比例短。路上每帧查的是“上一帧到这一帧扫过的那一段”，帧率低也不会穿过去。
//   · 淬火：挡下的量 = 引导期间自己掉的血 × 1.5（只吃了四成，另外六成是盾挡的）。被眩晕打断、自己走开、按 S 都会喷；死了不喷。
//            朝向用的是结束那一刻面对的方向（直接放的技能不会转身）。
//   · 余烬地：人不过去。锤砸在面前，一道火顺着地面窜到落点炸开。余烬每 0.25 秒查一次减速，隔一次烧一下（一共 8 下）。
//   · 开闸：灼烧一共 10 下（0.5 秒一下，第 5 秒最后一下），圈跟着人走。
//
// 特效的路数：炭黑的铁、琥珀色的炉火、余烬、烟、焦痕。火小而亮，烟和焦痕占大面积；叠加发光只用在火星、火舌、闪光上。
// 这个文件里自己写了两段着色器（见下面“框架里没有的”那一节），原因写在那里。
// 动作时间表在 public/assets/hero/gorran.json（资源那边做完才有；没有时控制器用默认的出手时间，不影响先把技能和特效做出来）。

import * as THREE from "three";
import type { Actor } from "../actor";
import type { Ent } from "../sim";
import type { Api, HeroKit, SkillDef } from "../skills";
import { SPR, type FxLib, type V3 } from "../fxlib";
import { fence, flameBed, puff, puffer, sheet, strip, wall, warm, type PuffOpts } from "../fx_fx2c";
import { LITE } from "../../quality";
import { FXB } from "../fxb";

const EMBER = 0xff8a2e, FLAME = 0xffc56a, IRON = 0x3a3634, SOOT = 0x151312;      // 炉火的橙、亮处的黄、铁的深灰、焦黑
const CINDER = 0xb5451c, ASH = 0x8b8279, DUST = 0xa3977f;                        // 同一个色系里补的三个：快凉下去的暗红、烟灰、砸起来的土
// 换画风 B（b-fx）：地上烧过的痕迹（喷火扫过的扇面、余烬地、犁痕）原来是近黑的底，亮地面上一块块像污渍。B 下底色是烧过的暖褐（线性值，屏幕上约 #5A3A26），也薄一些；红纹、火光不动
const CHAR = FXB.on ? "vec3(0.1, 0.045, 0.022)" : "vec3(0.04, 0.03, 0.03)", CHARK = FXB.on ? 0.72 : 1;
const TAU = Math.PI * 2;
const v3 = () => new THREE.Vector3();
const c01 = (v: number) => Math.max(0, Math.min(1, v));
const isBuilding = (e: Ent) => e.kind === "tower" || e.kind === "core";
const foes = (api: Api, me: Ent, x: number, z: number, r: number) => api.enemies(me, x, z, r).filter(e => !isBuilding(e));
/** 圆里随机一点（粒子铺满一片地用；框架的 radius 是个球，会飘到半空和地底下） */
const inDisc = (x: number, z: number, r: number): [number, number] => { const a = Math.random() * TAU, d = r * Math.sqrt(Math.random()); return [x + Math.cos(a) * d, z + Math.sin(a) * d]; };
/** 框架的冲击波是一张平片，放在圆心的高度；地面不平（河岸）时高的那半边会被地面挡住。这里把它垫到这一圈里最高的地方，一闪而过的东西浮起来一点看不出来 */
function shock(fx: FxLib, x: number, z: number, r: number, color: number, life: number, add = true, alpha = 1) {
  const g0 = fx.ground(x, z); let top = g0; for (let i = 0; i < 8; i++) top = Math.max(top, fx.ground(x + Math.cos(i * 0.785) * r * 0.85, z + Math.sin(i * 0.785) * r * 0.85));
  fx.decal({ kind: "shock", x, z, r, life, color, alpha, from: 0.15, fadeIn: 0.05, fadeOut: 0.6, add, lift: top - g0 + 0.07 });
}
// 第九轮 fx2c：锻炉的火（fx_fx2c 的 puff）。一团火自己从白热烧成橙、暗红，最后变成往上飘的黑烟。下面几种是这个英雄常用的配方
/** 一团往外翻的火：烧到一半变黑烟。
 *  第九轮 polish-old 压了一档：原来生下来是白热（heat 0.8～1）、烧到一半才凉，二三十团叠在一起只剩一大团发白的橙光（用户反感的光污染）。
 *  现在生下来是橙（芯上才偏黄）、凉得早，黑烟浓一点：一团火有了暗的边，几团叠在一起也看得出一团一团的形状 */
const blaze = (fx: FxLib, o: Partial<PuffOpts> & { pos: V3 }) => puff(fx, { heat: [0.6, 0.8], cool: 0.42, smoke: 0x352e2a, opacity: [0.42, 0.56], drag: 3, rise: 1.6, grow: 2.2, size: [0.6, 1], life: [0.6, 0.9], speed: [2, 5], ...o });
/** 黑烟（不烫） */
const soot = (fx: FxLib, o: Partial<PuffOpts> & { pos: V3 }) => puff(fx, { heat: 0, smoke: 0x37302c, opacity: [0.3, 0.42], drag: 1, rise: 0.9, grow: 2.2, size: [0.8, 1.3], life: [1.3, 2.0], speed: [0.1, 0.5], ...o });
/** 扬起来的土（不烫，土色） */
const dirt = (fx: FxLib, o: Partial<PuffOpts> & { pos: V3 }) => puff(fx, { heat: 0, smoke: 0x6e6455, opacity: [0.22, 0.36], drag: 2.6, rise: 0.4, grow: 2.2, size: [0.6, 1.0], life: [0.55, 0.9], speed: [1, 3], ...o });

// ---------------------------------------------------------------- 框架里没有的：贴地的图案、淬火的盾墙
// 这两样是自己写着色器画的（fxlib 的规矩是技能文件不直接写着色器，这里破例，报告里说了，希望以后收进框架）：
//   · 贴地的图案：框架的 decal 没有扇形的火和焦痕；crack 画出来是一整片亮盘（只有几道暗缝，和它注释写的相反）；
//     而且都是一张平片，河岸这种有高差的地方会被地面切掉一半。这里的图案是一张 10×10 的网，每个顶点落在地面上，跟着地形起伏。
//   · 盾墙：一段立着的弧面，炉门的轮廓。
// 几何体的样子全场共用；材质每放一次技能建一个，放完销毁；不在每帧里新建东西。
const NOISE = /* glsl */ `
  float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
  float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vn(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
`;
const PATCH_FRAG = /* glsl */ `
  uniform float uTime, uK, uFront, uAlpha, uSeed, uAngle; uniform int uKind; uniform vec3 uA, uB, uC; varying vec2 vP;
  ${NOISE}
  void main() {
    vec2 p = vP; float r = length(p), th = atan(p.x, p.y), da = abs(th), a; vec3 col;
    bool isFan = uKind == 0 || uKind == 1 || uKind == 3;
    if ((uKind != 4 && r > 1.0) || (isFan && da > uAngle + 0.15)) discard;
    if (uKind == 0) {                                          // 喷出去的火：一道火头从扇柄扫到扇沿，扫过的地方留下一道一道的焦痕，里面的红纹慢慢凉下去
      float st = fbm(vec2(th * 7.0 + uSeed, r * 1.6));
      float m = (1.0 - smoothstep(uAngle - 0.2, uAngle + 0.02, da + (st - 0.5) * 0.3)) * (1.0 - smoothstep(0.7, 1.0, r + (st - 0.5) * 0.36)) * smoothstep(0.03, 0.16, r);
      float swept = 1.0 - smoothstep(uFront - 0.2, uFront, r);
      float head = (1.0 - smoothstep(0.0, 0.24, abs(r - uFront + 0.05))) * (1.0 - smoothstep(0.85, 1.25, uFront));
      float ck = 1.0 - smoothstep(0.0, 0.04, abs(fbm(p * 6.0 + uSeed * 2.0) - 0.5)), cool = (1.0 - uK) * (1.0 - uK);
      col = mix(${CHAR}, uA, clamp((ck * 0.9 + st * 0.3) * cool * cool, 0.0, 1.0));
      col = mix(col, uB, head * (0.5 + 0.5 * st));
      a = m * max(swept * (0.72 * ${CHARK} + ck * 0.2), head);
    } else if (uKind == 1) {                                   // 炉门里漏出来的火光：淡淡的一片，近处亮，会闪
      float n = fbm(vec2(th * 5.0 + uSeed, r * 3.0 - uTime * 1.3)), fl = 0.8 + 0.2 * vn(vec2(uTime * 8.0, uSeed));
      a = pow(1.0 - r, 1.1) * (1.0 - smoothstep(uAngle * 0.25, uAngle, da)) * (0.65 + 0.6 * n) * fl * smoothstep(0.0, 0.1, r);
      col = mix(uA, uB, pow(1.0 - r, 3.0));
    } else if (uKind == 2) {                                   // 余烬：焦黑的底上一张烧红的裂纹网，一明一暗地喘，缝之间几块暗红的炭；uFront 是有多热（刚砸下去大于 1，凉透了是 0，底还留着）
      float n = fbm(p * 3.0 + uSeed), m = 1.0 - smoothstep(0.8, 0.98, r + (n - 0.5) * 0.24), heat = min(uFront, 1.0), flare = max(uFront - 1.0, 0.0);
      float c1 = 1.0 - smoothstep(0.0, 0.03 + flare * 0.03, abs(fbm(p * 4.4 + uSeed * 2.0) - 0.5)), c2 = 1.0 - smoothstep(0.0, 0.018, abs(fbm(p * 9.5 - uSeed) - 0.48));
      float coal = smoothstep(0.56 - flare * 0.2, 0.78, fbm(p * 2.4 + uSeed * 3.0)), breath = 0.62 + 0.38 * sin(uTime * 2.6 + n * 9.0);
      float g = clamp(c1 + c2 * 0.45, 0.0, 1.0), glow = clamp((g * (0.55 + 0.45 * breath) + coal * (0.3 + flare * 0.5) * breath) * heat, 0.0, 1.0), soot = ${(0.56 * CHARK).toFixed(3)} * (0.55 + 0.45 * n), cover = mix(soot, 1.0, glow);
      vec3 hot = mix(uC, uA, clamp(g + flare * 0.6, 0.0, 1.0)); hot = mix(hot, uB, clamp(c1 * c1 * (0.45 + flare), 0.0, 1.0) * heat);
      col = mix(${CHAR}, hot, glow / cover); a = m * cover;
    } else if (uKind == 3) {                                   // 淬火的预告：扇沿一道线、两条边线（靠近扇柄的地方收掉，不糊成一团），里面很淡；一道弧从扇柄走到扇沿就是还剩多久喷
      float rimL = smoothstep(0.945, 0.965, r) * (1.0 - smoothstep(0.985, 1.0, r)), side = (1.0 - smoothstep(0.012, 0.03, r * sin(max(uAngle - da, 0.0)))) * smoothstep(0.18, 0.4, r);
      float tick = (1.0 - smoothstep(0.0, 0.03, abs(r - uFront))) * 0.55 + (1.0 - smoothstep(uFront - 0.02, uFront, r)) * 0.1;
      a = (rimL * 0.85 + side * 0.7 + 0.07 + tick * step(0.05, uFront)) * step(da, uAngle) * smoothstep(0.1, 0.22, r);
      col = mix(uA, uB, tick * 0.6);
    } else if (uKind == 4) {                                   // 犁痕：一条带子（p.y 从 -1 起点到 1 头上），两边不齐的一道黑，中间盾沿刮出来的一条红线，头上最红；uAngle 是半宽、uFront 是半长（米）
      vec2 q = vec2(p.x * uAngle, p.y * uFront); float n = fbm(q * vec2(2.6, 0.8) + uSeed), ax = abs(p.x), cap = 0.7 / max(uFront, 0.7);
      float m = (1.0 - smoothstep(0.5, 1.0, ax + (n - 0.5) * 0.55)) * smoothstep(-1.0, -1.0 + cap, p.y) * (1.0 - smoothstep(1.0 - cap, 1.0, p.y));
      float rut = 1.0 - smoothstep(0.0, 0.2, abs(p.x + (n - 0.5) * 0.7)), cool = (1.0 - uK) * (1.0 - uK); cool *= cool;
      col = mix(${CHAR}, uA, clamp(rut * cool * (0.3 + 0.7 * smoothstep(-0.6, 1.0, p.y)), 0.0, 1.0));
      a = m * (0.45 * ${CHARK} + rut * 0.35);
    } else if (uKind == 5) {                                   // 一圈热浪：一道细线往外推（线是抖的），后面拖一点很淡的
      float rr = r + (fbm(vec2(th * 3.0 + uSeed, uTime * 0.7)) - 0.5) * 0.035;
      float line = 1.0 - smoothstep(0.0, 0.02, abs(rr - uFront)), tail = smoothstep(uFront - 0.2, uFront, rr) * (1.0 - step(uFront, rr));
      a = line * 0.85 + tail * 0.16; col = mix(uA, uB, line * 0.35);
    } else {                                                   // 范围的边线：一道清楚的细线，里面很淡的一层
      a = smoothstep(0.952, 0.97, r) * (1.0 - smoothstep(0.986, 1.0, r)) * 0.9 + 0.07 * (0.6 + 0.4 * vn(p * 5.0 + uTime * 0.3)); col = uA;
    }
    a *= uAlpha; if (a < 0.004) discard;
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }`;
const WARD_FRAG = /* glsl */ `
  uniform float uTime, uHeat, uAlpha, uSeed; uniform vec3 uA, uB, uC, uD; varying vec2 vUv;
  ${NOISE}
  void main() {
    float x = vUv.x, y = vUv.y, cx = abs(x - 0.5) * 2.0, top = 1.0 - 0.3 * cx * cx * cx, h = clamp(uHeat, 0.0, 1.0);      // 上沿是拱的：炉门的轮廓
    if (y > top) discard;
    float rim = max(1.0 - smoothstep(0.0, 0.07, top - y), 1.0 - smoothstep(0.0, 0.06, 1.0 - cx));          // 上沿和两侧的一道边
    float n = fbm(vec2(x * 6.0 + uSeed, y * 3.2 - uTime * 0.6));
    float temp = n * 0.6 + (1.0 - y) * 0.7 - (1.05 - h * 0.6);                                              // 这一处有多烫：从门脚往上漫，挡得越多漫得越高；最顶上总留着一截黑铁
    float d = length(vec2((x - 0.5) * 2.5, (y - 0.5) * 2.6)), win = 1.0 - smoothstep(0.4, 0.46, d), frame = (1.0 - smoothstep(0.0, 0.05, abs(d - 0.5))) * 0.7;      // 门中间的圆炉栅：里面透着火，隔着几根竖条
    float bars = smoothstep(0.3, 0.42, abs(fract(x * 11.0) - 0.5)), fire = win * (1.0 - bars) * (0.5 + 0.5 * n) * (0.5 + 0.5 * h);
    vec3 iron = uC * 0.5, col = mix(iron, uD, smoothstep(0.0, 0.14, temp));                                 // 黑铁 → 暗红 → 橙 → 最烫的地方发黄
    col = mix(col, uA, smoothstep(0.12, 0.42, temp)); col = mix(col, uB, smoothstep(0.45, 0.85, temp) * 0.6);
    col = mix(col, uA, rim * (0.35 + 0.65 * h)); col = mix(col, iron * 0.7, max(frame, win * bars * 0.8)); col = mix(col, mix(uA, uB, 0.3 + 0.4 * h), fire);
    float a = ((0.66 + 0.16 * n) * (1.0 - y * 0.3) + rim * 0.3 + smoothstep(0.0, 0.3, temp) * 0.12 + win * 0.2 + frame * 0.2) * uAlpha * smoothstep(0.0, 0.05, y);
    if (a < 0.004) discard;
    gl_FragColor = vec4(col, min(a, 0.92));
    #include <colorspace_fragment>
  }`;
const WARD_HALF = 1.25, WARD_UP = 1.0;      // 盾墙的半张角（比喷火的扇形宽一点）；往上弯到多高（仰角，弧度）
let gridGeo: THREE.BufferGeometry | null = null, arcGeo: THREE.BufferGeometry | null = null;
const grid = () => { if (!gridGeo) { gridGeo = new THREE.PlaneGeometry(2, 2, 10, 10); gridGeo.rotateX(-Math.PI / 2); } return gridGeo; };
/** 盾墙的形状（第九轮 fx2c）：原来是一段竖直的弧面，俯视镜头下人朝左右的时候只看得到一条边。改成往后弯过头顶的一片球面（像一扇鼓起来的炉门），
 *  从哪个方向看都有一大片面朝着镜头。高度归一到 1，uv 和原来一样（x 横过去，y 从地面到顶） */
const arc = () => { if (!arcGeo) { arcGeo = new THREE.SphereGeometry(1, 24, 10, Math.PI / 2 - WARD_HALF, WARD_HALF * 2, Math.PI / 2 - WARD_UP, WARD_UP); arcGeo.scale(1, 1 / Math.sin(WARD_UP), 1); } return arcGeo; };

type PatchKind = "spray" | "glow" | "cracks" | "aim" | "skid" | "wave" | "edge";
const PATCH: Record<PatchKind, number> = { spray: 0, glow: 1, cracks: 2, aim: 3, skid: 4, wave: 5, edge: 6 };
interface Patch { set: (x: number, z: number, yaw?: number) => void; span: (x0: number, z0: number, x1: number, z1: number) => void; kill: () => void; }      // span：skid 用，从哪拉到哪；kill：很快淡掉
/** 贴地的一块自己画的图案，跟着地形起伏：
 *    spray  扇形。一道火头在 sweep 秒里从扇柄扫到扇沿，留下焦痕，后一半寿命慢慢淡掉
 *    glow   扇形。炉门漏出来的火光（叠加发光，很淡）
 *    cracks 圆。焦黑的底上一张烧红的裂纹网：sweep 秒里从小铺到大，烧 hot 秒（最后 cool 秒凉下去），焦黑的底留到最后再淡掉
 *    aim    扇形。预告：边线，加一道在 sweep 秒里从扇柄走到扇沿的弧
 *    skid   一条带子（r 是半宽），用 span 拉长；后一半寿命淡掉
 *    wave   圆。一圈细细的热浪，一辈子从里推到外
 *    edge   圆。范围的边线 */
function patch(fx: FxLib, api: Api, o: { kind: PatchKind; x: number; z: number; yaw?: number; r: number; angle?: number; life: number; alpha?: number; sweep?: number; hot?: number; cool?: number; color?: number; floor?: number }): Patch {
  const kind = o.kind, u = { uTime: { value: fx.time() }, uK: { value: 0 }, uFront: { value: 0 }, uAlpha: { value: 0 }, uSeed: { value: Math.random() * 40 }, uAngle: { value: kind === "skid" ? o.r : o.angle ?? 3.2 }, uKind: { value: PATCH[kind] },
    uA: { value: new THREE.Color(o.color ?? EMBER) }, uB: { value: new THREE.Color(FLAME) }, uC: { value: new THREE.Color(CINDER) } };
  const mat = new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false, blending: kind === "glow" ? THREE.AdditiveBlending : THREE.NormalBlending, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    vertexShader: `varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`, fragmentShader: PATCH_FRAG });
  const under = kind === "spray" || kind === "skid", lift = under ? 0.08 : 0.1, base = grid().getAttribute("position"), geo = grid().clone(), P = geo.getAttribute("position") as THREE.BufferAttribute;
  const m = new THREE.Mesh(geo, mat); m.renderOrder = under ? 4 : 6; m.frustumCulled = false; m.scale.set(o.r, 1, o.r); fx.group.add(m);      // 焦痕和框架的焦痕一层（在水面底下）；发亮的和线画在水面上面
  // 把网的每个顶点落到地面上。挪得不多就不重算（查一次地面高度几微秒，一张网一百多个点）
  let lx = NaN, lz = 0, lyaw = 0, lsx = 0, lsz = 0;
  const drape = () => { const { x, z, y } = m.position, yaw = m.rotation.y, sx = m.scale.x, sz = m.scale.z;
    if (Math.hypot(x - lx, z - lz) < 0.3 && Math.abs(yaw - lyaw) < 0.05 && Math.abs(sx - lsx) < 0.04 * sx && Math.abs(sz - lsz) < 0.04 * sz) return;
    lx = x; lz = z; lyaw = yaw; lsx = sx; lsz = sz; const cs = Math.cos(yaw), sn = Math.sin(yaw);
    for (let i = 0; i < P.count; i++) { const px = base.getX(i) * sx, pz = base.getZ(i) * sz; P.setY(i, fx.ground(x + px * cs + pz * sn, z - px * sn + pz * cs) + lift - y); } P.needsUpdate = true; };
  let dead = false;
  const set = (x: number, z: number, yaw?: number) => { if (dead) return; m.position.set(x, fx.ground(x, z), z); if (yaw !== undefined) m.rotation.y = yaw; drape(); };
  const span = (x0: number, z0: number, x1: number, z1: number) => { const dx = x1 - x0, dz = z1 - z0, half = Math.max(0.05, Math.hypot(dx, dz) / 2); m.scale.set(o.r, 1, half); u.uFront.value = half; set((x0 + x1) / 2, (z0 + z1) / 2, Math.atan2(dx, dz)); };
  set(o.x, o.z, o.yaw ?? Math.random() * TAU);
  let t = 0, off = 1, dying = false; const alpha = o.alpha ?? 1, sweep = o.sweep ?? 0.25, cool = o.cool ?? 0.6, hot = o.hot ?? o.life, fade = kind === "aim" ? 9 : kind === "edge" ? 5 : 3;
  const drop = () => { if (dead) return; dead = true; fx.group.remove(m); mat.dispose(); geo.dispose(); };
  api.run(o.life, (k, dt) => { if (dead) return; t += dt; if (dying && (off -= dt * fade) <= 0) return drop(); u.uTime.value = fx.time(); u.uK.value = k; const left = o.life - t; let al = Math.min(1, t / 0.06);
    if (kind === "spray") { u.uFront.value = Math.min(1.3, (t / sweep) * 1.3); al *= c01(left / (o.life * 0.45)); }
    else if (kind === "glow") al = Math.min(1, t / 0.2) * c01(left / 0.5);
    else if (kind === "cracks") { const g = 1 - Math.pow(1 - Math.min(1, t / sweep), 2.4), sc = o.r * (0.3 + 0.7 * g); if (sc !== m.scale.x) { m.scale.set(sc, 1, sc); drape(); } u.uFront.value = Math.max(c01((hot - t) / cool) * (1 + 0.9 * Math.exp(-t / 0.13)), (o.floor ?? 0) * c01((o.life - 1.5 - t) / 1.0)); al *= c01(left / Math.max(0.7, o.life * 0.3)); }      // floor：凉下去以后裂纹里还留几成暗红（polish-old）
    else if (kind === "aim") { u.uFront.value = Math.min(1, t / sweep); al = Math.min(1, t / 0.1); }
    else if (kind === "skid") al *= c01(left / (o.life * 0.5));
    else if (kind === "wave") { u.uFront.value = 0.1 + 0.88 * (1 - Math.pow(1 - k, 2.2)); al = Math.min(1, k / 0.12) * Math.pow(1 - k, 1.1); }
    else al = Math.min(1, t / 0.12) * c01(left / 0.4);
    u.uAlpha.value = alpha * off * al; }, drop);
  return { set, span, kill() { dying = true; } };
}

interface Ward { update: (dt: number, heat: number) => void; release: () => void; }
/** 淬火的盾墙：面前立起一道炉门形的铁影，挡下的伤害越多烧得越红；放开时往前一掀，淡掉 */
function ward(fx: FxLib, api: Api, a: Actor): Ward {
  const u = { uTime: { value: fx.time() }, uHeat: { value: 0.2 }, uAlpha: { value: 0 }, uSeed: { value: Math.random() * 40 }, uA: { value: new THREE.Color(EMBER) }, uB: { value: new THREE.Color(FLAME) }, uC: { value: new THREE.Color(IRON) }, uD: { value: new THREE.Color(CINDER) } };
  const mat = new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`, fragmentShader: WARD_FRAG });
  const m = new THREE.Mesh(arc(), mat); m.renderOrder = 7; m.frustumCulled = false; fx.group.add(m);
  const place = (rad: number, h: number) => { m.position.set(a.pos.x, fx.ground(a.pos.x, a.pos.z), a.pos.z); m.rotation.y = a.yaw(); m.scale.set(rad, h, rad); };
  const H = a.kit.height * 0.74; let t = 0, gone = false;
  const w: Ward = {
    update(dt, heat) { t += dt; const up = 1 - Math.pow(1 - Math.min(1, t / 0.16), 3); u.uTime.value = fx.time(); u.uHeat.value = heat; u.uAlpha.value = up; place(1.8, H * (0.3 + 0.7 * up)); },
    release() { if (gone) return; gone = true; api.run(0.2, k => { u.uTime.value = fx.time(); u.uHeat.value = 1; u.uAlpha.value = (1 - k) * (1 - k); place(1.8 + 1.7 * k, H * (1 - 0.3 * k)); }, () => { fx.group.remove(m); mat.dispose(); }); },
  };
  w.update(0, 0.2); return w;
}

// ---------------------------------------------------------------- Q 砧撞
const Q: SkillDef = { key: "Q", name: "砧撞", icon: "gorran_q", cast: "dir", range: 7.5, width: 1.6, cd: 9, mana: 60,
  desc: "顶着盾向前冲 7.5 米，撞到第一个敌人就停下：造成 160 + 60% 攻击力的物理伤害，眩晕 1.2 秒，并把它顶退。会被墙挡住。",
  start(c) {      // 出手前：盾沿一下白亮的星芒、蹭出几点火星，后脚蹬起一蓬土
    const { a, fx } = c, gy = fx.ground(a.pos.x, a.pos.z), sh = a.hand(v3(), "Left");
    fx.burst({ pos: sh, n: 1, sprite: SPR.glint, add: true, color: [0xffffff, FLAME], size: 1.1, grow: 1.6, life: 0.18, speed: 0 });
    fx.burst({ pos: sh, n: 7, sprite: SPR.ember, add: true, color: [FLAME, EMBER], size: [0.08, 0.14], life: [0.2, 0.36], speed: [1, 3.5], gravity: 7 });
    dirt(fx, { pos: { x: a.pos.x - c.dx * 0.5, y: gy + 0.2, z: a.pos.z - c.dz * 0.5 }, n: 5, dir: { x: -c.dx, y: 0.45, z: -c.dz }, spread: 0.7, speed: [1.5, 3.5] });
  },
  fire(c) {
    const { me, a, api, fx } = c, { dx, dz } = c, x0 = a.pos.x, z0 = a.pos.z, [tx, tz] = api.reach(x0, z0, dx, dz, 7.5), dist = Math.hypot(tx - x0, tz - z0), dur = Math.max(0.08, 0.35 * dist / 7.5);
    let px = x0, pz = z0, over = false;
    const gy = () => fx.ground(a.pos.x, a.pos.z), front = (up: number, ahead = 0.9) => ({ x: a.pos.x + dx * ahead, y: gy() + up, z: a.pos.z + dz * ahead });
    // 过程（第九轮 fx2c 重做）：身后一条犁痕（焦黑、中间一道烧红的线，跟着人拉长）；脚下一路扬土；盾前被顶着走的一层火（贴着盾面生出来、甩在身后烧成黑烟）；盾沿甩火星
    const dust = puffer(fx, { pos: { x: x0, y: gy() + 0.2, z: z0 }, rate: 40, heat: 0, smoke: 0x6e6455, opacity: [0.2, 0.32], size: [0.7, 1.1], grow: 2.2, life: [0.5, 0.85], speed: [0.4, 1.6], up: 0.9, drag: 2.4, rise: 0.3, disc: 0.4 });
    const ram = puffer(fx, { pos: front(1.0), rate: 60, heat: [0.6, 0.85], cool: 0.45, smoke: 0x3a332f, opacity: [0.28, 0.4], size: [0.4, 0.62], grow: 2.4, life: [0.4, 0.6], dir: { x: dx, y: 0.1, z: dz }, spread: 0.6, speed: [2, 5], drag: 3.5, rise: 1.6, radius: 0.35 });
    const sparks = fx.emitter({ pos: front(1.4), rate: 90, sprite: SPR.ember, add: true, color: [FLAME, CINDER], size: [0.09, 0.17], life: [0.3, 0.6], dir: { x: -dx, y: 0.3, z: -dz }, spread: 0.9, speed: [1, 4.5], gravity: 6, radius: 0.5 });
    const skid = strip(fx, api, { r: 0.75, life: dur + 3.6, hot: dur + 0.25, cool: 1.1, alpha: 0.95 }); skid.span(x0 - dx * 0.3, z0 - dz * 0.3, x0 + dx * 0.3, z0 + dz * 0.3);
    c.data.clean = () => { over = true; dust.stop(); ram.stop(); sparks.stop(); };
    fx.ghost(a.hero.model, CINDER, 0.3, 0.26);
    api.after(dur * 0.5, () => { if (!over) fx.ghost(a.hero.model, CINDER, 0.26, 0.2); });
    /** 上一帧到这一帧扫过的那一段里，最靠前的一个敌人 */
    const sweep = (): Ent | null => {
      const step = Math.hypot(a.pos.x - px, a.pos.z - pz), list = api.inLine(me, px, pz, dx, dz, step + 0.8, 0.8).filter(e => !isBuilding(e)); px = a.pos.x; pz = a.pos.z;
      return list.length ? list.reduce((p, q) => ((p.x - x0) * dx + (p.z - z0) * dz <= (q.x - x0) * dx + (q.z - z0) * dz ? p : q)) : null;
    };
    const slam = (e: Ent) => {      // 撞上了：停在原地，伤害、眩晕、顶退
      api.dash(me, a.pos.x, a.pos.z, 0.01);
      const at = front(1.45, 1.0), ey = fx.ground(e.x, e.z);
      api.hit(me, e, 160 + c.ad * 0.6 + c.lv * 20, "phys", true);
      if (e.alive) { api.stun(e, 1.2); api.push(e, dx, dz, 1, 0.16); }
      fx.flash(at, FLAME, 1.4, 0.12); fx.shake(0.16, 0.28); fx.impact(at, { color: FLAME, color2: EMBER, size: 1.0, big: true, dir: { x: dx, y: 0.4, z: dz } }); if (e.kind === "hero") fx.hitstop(0.07);      // 撞上（第九轮）：白芯、火花、顿帧（polish-old：闪光 2.3 → 1.4，原来一下把盾前面整片冲成白的）
      fx.burst({ pos: at, n: 1, sprite: SPR.ring, add: true, color: [0xffffff, FLAME], size: 1.0, grow: 2.6, life: 0.16, speed: 0 });                                          // 盾面上炸开的一圈
      // 第九轮 fx2c：朝前的一扇——盾面把火拍出去（火团往前滚、烧成黑烟），碎石和火星跟着往前喷；目标脚下一圈立着的土墙炸开
      blaze(fx, { pos: at, n: 8, dir: { x: dx, y: 0.2, z: dz }, spread: 0.55, speed: [6, 14], drag: 4.2, size: [0.5, 0.8], grow: 2.4, life: [0.45, 0.75], radius: 0.3, shape: "streak", stretch: 0.4 });      // polish-old：15 + 5 团 → 8 + 2 团，小一号；形状交给下面那一扇贴地的火
      blaze(fx, { pos: { x: at.x, y: at.y - 0.6, z: at.z }, n: 2, dir: { x: dx, y: 0.6, z: dz }, spread: 0.9, speed: [3, 6], size: [0.6, 0.9], life: [0.7, 1.0] });
      sheet(fx, api, { x: at.x - dx * 0.6, z: at.z - dz * 0.6, r: 3.6, yaw: Math.atan2(dx, dz), angle: 0.6, life: 0.75, reach: 0.15, from: 0.15, band: 0.6, heat: 0.78, soot: 0.35 });      // 盾面拍出去的一扇火（第九轮 polish-old）
      fx.burst({ pos: at, n: 18, sprite: SPR.streak, add: true, color: [FLAME, EMBER], dir: { x: dx, y: 0.45, z: dz }, spread: 0.8, speed: [6, 15], size: [0.1, 0.18], life: [0.2, 0.42], gravity: 15, stretch: 1.2 });
      dirt(fx, { pos: { x: e.x, y: ey + 0.3, z: e.z }, n: 7, dir: { x: dx, y: 0.5, z: dz }, spread: 1.2, speed: [1.5, 4.5], size: [0.8, 1.2] });
      fx.burst({ pos: { x: e.x, y: ey + 0.4, z: e.z }, n: 9, sprite: SPR.shard, color: [IRON, SOOT], dir: { x: dx, y: 0.9, z: dz }, spread: 0.9, speed: [3, 8], size: [0.12, 0.22], life: [0.4, 0.7], gravity: 16, spin: 9 });      // 崩起来的碎石
      wall(fx, api, { x: e.x, z: e.z, r: 2.4, h: 1.2, life: 0.5, from: 0.25, color: 0x8a7d68 });      // 目标脚下一圈立着的土墙
      wall(fx, api, { x: at.x - dx * 0.8, z: at.z - dz * 0.8, r: 3.4, h: 1.7, life: 0.42, from: 0.2, fire: true, arc: 1.0, yaw: Math.atan2(dx, dz) });      // 盾面拍出去的一道弧形火墙，只朝前
      shock(fx, e.x, e.z, 2.0, ASH, 0.4, false);
      patch(fx, api, { kind: "spray", x: at.x - dx * 0.3, z: at.z - dz * 0.3, yaw: Math.atan2(dx, dz), r: 3.6, angle: 0.62, life: 3.4, alpha: 0.85, sweep: 0.16 });      // 火星顺着撞的方向扫出去，烧出一小片扇形的焦痕
      a.finish();
    };
    api.dash(me, tx, tz, dur, () => {
      if (over) return; const e = sweep(); if (e) return slam(e);
      // 没撞到人：刹住，脚下一圈土；是被墙拦下的话盾在墙上磕出几点火星
      dirt(fx, { pos: { x: a.pos.x + dx * 0.4, y: gy() + 0.25, z: a.pos.z + dz * 0.4 }, n: 8, dir: { x: dx, y: 0.4, z: dz }, spread: 1.3, speed: [1, 3.5] });
      wall(fx, api, { x: a.pos.x, z: a.pos.z, r: 1.9, h: 0.8, life: 0.42, from: 0.3, color: DUST });
      shock(fx, a.pos.x, a.pos.z, 1.7, ASH, 0.38, false);
      if (dist < 7) { fx.burst({ pos: front(1.4, 1.0), n: 12, sprite: SPR.streak, add: true, color: [FLAME, EMBER], dir: { x: -dx, y: 0.5, z: -dz }, spread: 1.2, speed: [3, 9], size: [0.09, 0.15], life: [0.18, 0.36], gravity: 14, stretch: 1.1 }); fx.shake(0.05, 0.15); }
      a.finish();
    });
    a.lock(dur + 0.3);
    api.run(dur + 0.1, () => {
      if (over) return; const y = gy(); dust.at(a.pos.x - dx * 0.3, y + 0.2, a.pos.z - dz * 0.3); const f = front(1.4); sparks.at(f.x, f.y, f.z); const r0 = front(1.0, 1.1); ram.at(r0.x, r0.y, r0.z);
      skid.span(x0 - dx * 0.3, z0 - dz * 0.3, a.pos.x + dx * 0.7, a.pos.z + dz * 0.7);
      const e = sweep(); if (e) slam(e);
    });
  },
  end(c) { c.data.clean?.(); },
};

// ---------------------------------------------------------------- W 淬火
const W: SkillDef = { key: "W", name: "淬火", icon: "gorran_w", cast: "self", cd: 14, mana: 70, channel: 2.5, range: 5, angle: 0.87,
  desc: "举盾 2.5 秒，期间受到的伤害只有四成；结束时把挡下伤害的 60% 朝面前的扇形喷回去。移动可以提前结束。",
  start(c) {      // 出手前：盾往面前的地上一杵，一圈矮的土墙，盾沿几点火星
    const { a, api, fx } = c, yaw = a.yaw(), x = a.pos.x + Math.sin(yaw) * 1.2, z = a.pos.z + Math.cos(yaw) * 1.2;
    dirt(fx, { pos: { x, y: fx.ground(x, z) + 0.2, z }, n: 6, spread: 1.4, speed: [0.8, 2.4] }); wall(fx, api, { x, z, r: 1.6, h: 0.55, life: 0.35, from: 0.3, color: DUST, alpha: 0.8 });
    fx.burst({ pos: a.hand(v3(), "Left"), n: 5, sprite: SPR.ember, add: true, color: [FLAME, EMBER], size: [0.08, 0.13], life: [0.2, 0.35], speed: [0.8, 2.6], gravity: 6 });
  },
  fire(c) {
    const { me, a, api, fx } = c, d = c.data, yaw = a.yaw();
    d.on = true; d.hp = me.hp; d.lost = 0; d.pulse = 0; d.suck = 0;
    api.buff(me, "quench", 2.8, { dmgTaken: 0.4 });      // 比引导长一点，结束时在 end 里摘掉
    // 过程：面前立起盾墙；地上一个扇形告诉对面“这里一会儿要喷火”，里面一道弧走到扇沿就喷；盾顶冒烟（第九轮 fx2c：烧红的铁冒的烟，挡得越多越浓）
    d.wall = ward(fx, api, a);
    d.cone = patch(fx, api, { kind: "aim", x: a.pos.x, z: a.pos.z, yaw, r: 5, angle: 0.87, life: 3.2, alpha: 0.5, sweep: 2.5 });
    d.glow = patch(fx, api, { kind: "glow", x: a.pos.x, z: a.pos.z, yaw, r: 3.4, angle: 0.95, life: 3.2, alpha: 0.5 });      // 盾后面漏出来的炉火光，铺在面前的地上
    d.steam = puffer(fx, { pos: { x: a.pos.x, y: a.pos.y + 2.6, z: a.pos.z }, rate: 5, heat: [0.2, 0.4], cool: 0.25, smoke: 0x2a2421, opacity: [0.3, 0.45], size: [0.45, 0.75], grow: 2.4, life: [1.0, 1.5], speed: [0.1, 0.4], up: 0.8, drag: 0.8, rise: 1.0, radius: 0.5 });
    patch(fx, api, { kind: "wave", x: a.pos.x, z: a.pos.z, r: 2.1, life: 0.35, alpha: 0.9 });
  },
  tick(c, dt) {
    const { me, a, fx } = c, d = c.data; if (!d.on) return;
    const yaw = a.yaw(), fdx = Math.sin(yaw), fdz = Math.cos(yaw), sx = a.pos.x + fdx * 1.6, sz = a.pos.z + fdz * 1.6, gy = fx.ground(a.pos.x, a.pos.z);
    if (me.hp < d.hp - 0.5) {      // 这一帧掉血了：盾面上炸一小团火、溅一把火星，盾墙红一下
      d.lost += d.hp - me.hp; d.pulse = 1;
      const side = (Math.random() - 0.5) * 1.6, hp = { x: sx + fdz * side * 0.6, y: gy + 1.0 + Math.random() * 1.0, z: sz - fdx * side * 0.6 };
      fx.burst({ pos: hp, n: 1, sprite: SPR.glint, add: true, color: [0xffffff, FLAME], size: 0.9, grow: 1.5, life: 0.12, speed: 0 });
      blaze(fx, { pos: hp, n: 3, dir: { x: fdx, y: 0.5, z: fdz }, spread: 1.0, speed: [1.5, 3.5], size: [0.3, 0.5], grow: 2.2, life: [0.35, 0.55], cool: 0.5 });
      fx.burst({ pos: hp, n: 9, sprite: SPR.streak, add: true, color: [FLAME, EMBER], dir: { x: fdx, y: 0.5, z: fdz }, spread: 1.3, speed: [3, 8], size: [0.08, 0.14], life: [0.18, 0.34], gravity: 13, stretch: 1.1, radius: 0.2 });
    }
    d.hp = me.hp; d.pulse = Math.max(0, d.pulse - dt * 3.5);
    const floor = 120 + 20 * c.lv, charge = Math.min(1, d.lost * 0.9 / (floor * 2)), near = c01((c.t - 1.9) / 0.6);      // 快到时间了也会越来越红：提醒要喷了
    d.wall.update(dt, Math.min(1, 0.16 + 0.5 * charge + 0.3 * near + 0.4 * d.pulse));
    d.steam.rate(5 + 16 * charge + 6 * near); d.steam.at(sx, gy + a.kit.height * 0.72, sz); d.cone.set(a.pos.x, a.pos.z, yaw); d.glow.set(a.pos.x, a.pos.z, yaw);
    // 蓄着的火：扇形里的火星被吸回盾里，挡得越多吸得越多（看得出“攒着要还回去”）
    d.suck += dt * (5 + 26 * charge + 10 * near);
    while (d.suck >= 1) { d.suck -= 1; const an = yaw + (Math.random() - 0.5) * 1.6, r = 2 + Math.random() * 2.6, p = { x: a.pos.x + Math.sin(an) * r, y: gy + 0.3 + Math.random() * 1.2, z: a.pos.z + Math.cos(an) * r }, to = { x: sx, y: gy + 1.4, z: sz }, tt = 0.3;
      fx.burst({ pos: p, n: 1, sprite: SPR.ember, add: true, color: [EMBER, FLAME], dir: { x: to.x - p.x, y: to.y - p.y, z: to.z - p.z }, spread: 0.05, speed: Math.hypot(to.x - p.x, to.y - p.y, to.z - p.z) / tt, size: [0.08, 0.13], life: tt, stretch: 0.8 }); }
  },
  end(c) {
    const { me, a, api, fx } = c, d = c.data; if (!d.on) return; d.on = false;      // 还没举起来就被打断：什么都没发生
    if (me.alive && me.hp < d.hp) d.lost += d.hp - me.hp;
    api.unbuff(me, "quench"); d.cone.kill(); d.glow.kill(); d.steam.stop(); d.wall.release();
    if (!me.alive) return;
    // 喷：挡下的量是掉血量的 1.5 倍，还回去六成，有保底
    const yaw = a.yaw(), dx = Math.sin(yaw), dz = Math.cos(yaw), floor = 120 + 20 * c.lv, dmg = Math.max(d.lost * 1.5 * 0.6, floor), p = Math.min(2, dmg / floor), gy = fx.ground(a.pos.x, a.pos.z);
    for (const e of api.inCone(me, me.x, me.z, dx, dz, 5, 0.87)) { if (isBuilding(e)) continue; api.hit(me, e, dmg, "magic", true); const ep = api.pos(e, 1.1);
      api.after(0.08, () => blaze(fx, { pos: ep, n: 3, dir: { x: dx, y: 0.6, z: dz }, spread: 0.9, speed: [1, 3], size: [0.45, 0.7], life: [0.5, 0.75] }));
      fx.burst({ pos: ep, n: 5, sprite: SPR.ember, add: true, color: [FLAME, CINDER], size: [0.09, 0.16], life: [0.35, 0.6], speed: [1, 3.5], up: 1.5, gravity: 3 }); }
    const mouth = { x: a.pos.x + dx * 1.3, y: gy + 0.75, z: a.pos.z + dz * 1.3 };
    patch(fx, api, { kind: "spray", x: a.pos.x, z: a.pos.z, yaw, r: 5.25, angle: 0.87, life: 4, alpha: 0.95, sweep: 0.3 });
    fx.flash(mouth, FLAME, 1.1 + 0.2 * p, 0.1); fx.shake(0.08 + 0.04 * p, 0.3); fx.burst({ pos: mouth, n: 1, sprite: SPR.ring, add: true, color: [0xffffff, FLAME], size: 1.0, grow: 2.6, life: 0.14, speed: 0, alpha: 0.7 });
    // 第九轮 polish-old：喷出来的火先是一层贴地漫开的扇形火（前沿最旺、身后烧成暗红再焦黑），扇形的样子一眼看出来；火团只剩一拨，小一号、凉得早
    sheet(fx, api, { x: a.pos.x + dx * 0.4, z: a.pos.z + dz * 0.4, r: 5.3, yaw, angle: 0.87, life: 0.85, reach: 0.24, from: 0.12, band: 0.42 + 0.08 * Math.min(1, p - 1), heat: 0.82 + 0.06 * Math.min(1, p - 1), soot: 0.45 });
    // 第九轮 fx2c 重做：喷出来的是一大口真的火。九个方向各一股火团贴着地往外滚：出口白热，越滚越大，滚到扇沿烧成暗红、变成黑烟往上飘；
    // 分三拨出去，连成一道往外推的火墙。挡下的越多（p）火越大。扇沿再起一排火舌，火停下来的地方看得出“喷到这里为止”
    const gust = (k: number) => { for (let i = 0; i < 7; i++) {
      const an = yaw + (i / 6 - 0.5) * 1.5 + (Math.random() - 0.5) * 0.1, dir = { x: Math.sin(an), y: 0.04, z: Math.cos(an) };
      blaze(fx, { pos: mouth, n: 1, dir, spread: 0.1, speed: k ? [6, 11] : [12, 19], drag: 3.6, size: [0.38, 0.55] as [number, number], grow: 2.4 + 0.3 * p, life: [0.5, 0.75], heat: k ? [0.55, 0.7] : [0.7, 0.85], cool: 0.45, rise: 1.2, radius: 0.25, shape: "streak", stretch: 0.45 });      // 顺着速度拉长：飞得快时是一股往外窜的火，慢下来变成一团翻滚的火
      if (!k) fx.burst({ pos: mouth, n: 2, sprite: SPR.ember, add: true, color: [FLAME, CINDER], dir, spread: 0.26, speed: [5, 18], drag: 2.2, size: [0.07, 0.13], life: [0.5, 1.0], gravity: -1.2, radius: 0.3 });
    } };
    gust(0); api.after(0.08, () => gust(1));
    api.after(0.14, () => { for (let i = 0; i < 6; i++) { const an = yaw + (i / 5 - 0.5) * 1.5, r = 4.4 + Math.random() * 0.6, x = a.pos.x + Math.sin(an) * r, z = a.pos.z + Math.cos(an) * r;      // 扇沿几团烟火：火停下来的地方
      blaze(fx, { pos: { x, y: fx.ground(x, z) + 0.3, z }, n: 1, dir: { x: Math.sin(an), y: 0.6, z: Math.cos(an) }, spread: 0.4, speed: [1, 2.5], size: [0.45, 0.65], life: [0.5, 0.7], heat: [0.5, 0.65] }); } });
  },
};

// ---------------------------------------------------------------- E 余烬地
const E: SkillDef = { key: "E", name: "余烬地", icon: "gorran_e", cast: "point", range: 5, radius: 3.2, cd: 10, mana: 70,
  desc: "跳起砸向一处：范围内造成 140 + 50% 攻击力的物理伤害，地上留 4 秒余烬，持续灼烧并减速 35%。",
  start(c) {      // 出手前：落点先亮一圈细线（告诉对面要砸哪；砸下去以后它就是余烬的边线），举起的锤头带起几点火星
    const { a, api, fx } = c;
    c.data.edge = patch(fx, api, { kind: "edge", x: c.x, z: c.z, r: 3.2, life: 12, alpha: 0.5 });
    fx.burst({ pos: a.hand(v3()), n: 7, sprite: SPR.ember, add: true, color: [FLAME, EMBER], size: [0.08, 0.14], life: [0.25, 0.4], speed: [0.5, 2], up: 2.4, gravity: 5 });
  },
  fire(c) {
    const { me, a, api, fx } = c, x = c.x, z = c.z, R = 3.2, gy = fx.ground(x, z), far = Math.hypot(x - a.pos.x, z - a.pos.z), hd = Math.min(1.3, far), hx = a.pos.x + c.dx * hd, hz = a.pos.z + c.dz * hd, hy = fx.ground(hx, hz);
    const edge = c.data.edge as Patch; c.data.fired = true;
    // 砸地的那一下：范围伤害
    for (const e of foes(api, me, x, z, R)) { api.hit(me, e, 140 + c.ad * 0.5 + c.lv * 25, "phys", true); api.slow(e, 0.35, 0.5); }
    // 锤砸在面前，一道熔岩缝顺着地面窜到落点（第九轮 fx2c：原来是一闪而过的光带，现在是地上一条烧红的缝，0.08 秒窜过去，之后凉成焦线）
    fx.burst({ pos: { x: hx, y: hy + 0.25, z: hz }, n: 12, sprite: SPR.streak, add: true, color: [FLAME, EMBER], spread: 1.2, speed: [4, 10], size: [0.09, 0.16], life: [0.2, 0.4], gravity: 15, stretch: 1.2 });
    blaze(fx, { pos: { x: hx, y: hy + 0.3, z: hz }, n: 3, dir: { x: 0, y: 1, z: 0 }, spread: 1.2, speed: [1, 3], size: [0.4, 0.6], life: [0.45, 0.65] }); dirt(fx, { pos: { x: hx, y: hy + 0.25, z: hz }, n: 3, size: [0.5, 0.8] });
    if (far > 1.6) { const sx0 = hx + c.dx * 0.2, sz0 = hz + c.dz * 0.2, fis = strip(fx, api, { r: 0.42, life: 3.2, hot: 0.4, cool: 1.0, alpha: 0.95 }); let lx = sx0, lz = sz0;
      api.run(0.08, k => { const ex = sx0 + (x - sx0) * k, ez = sz0 + (z - sz0) * k; fis.span(sx0, sz0, ex, ez);
        if (Math.hypot(ex - lx, ez - lz) > 0.7) { lx = ex; lz = ez; blaze(fx, { pos: { x: ex, y: fx.ground(ex, ez) + 0.2, z: ez }, n: 1, dir: { x: 0, y: 1, z: 0 }, spread: 0.6, speed: [0.5, 1.5], size: [0.35, 0.55], life: [0.4, 0.6] }); } }); }
    // 落地：一闪；一圈有高度的土墙往外推，里面紧跟一圈火墙；一圈火团往上翻（烧成黑烟），掀起的碎石；镜头抖一下
    // 第九轮 polish-old：闪光 2.8 → 1.5、标准命中小一号；原来一圈 14 团 + 中间 4 团白热的火球，读成落点上一大团橙光。
    // 现在落地的形状交给一层从中间漫到边上的火（前沿最旺、后面烧成暗红和焦黑）和外面那一圈土墙、火墙；火球只剩几团，从火墙上往上翻
    fx.flash({ x, y: gy + 0.6, z }, FLAME, 1.5, 0.12); fx.shake(0.17, 0.34); shock(fx, x, z, R, EMBER, 0.45, true, 0.6); fx.impact({ x, y: gy + 0.5, z }, { color: FLAME, color2: EMBER, size: 1.0, big: true });
    wall(fx, api, { x, z, r: R * 1.08, h: 1.5, life: 0.55, from: 0.15, color: 0x766b5a, alpha: 0.7 }); wall(fx, api, { x, z, r: R * 0.92, h: 1.2, life: 0.42, from: 0.12, fire: true });      // 土墙压暗一点（原来是浅土色，俯视像一个发白的半透明罩子）
    sheet(fx, api, { x, z, r: R * 1.02, life: 0.85, reach: 0.16, from: 0.08, band: 0.5, heat: 0.82, soot: 0.3 });
    blaze(fx, { pos: { x, y: gy + 0.35, z }, n: 7, ringR: R * 0.8, dir: { x: 0, y: 1, z: 0 }, spread: 0.6, speed: [2, 4.5], up: 0.6, size: [0.5, 0.8], grow: 2.2, life: [0.6, 0.9], heat: [0.55, 0.75] });
    dirt(fx, { pos: { x, y: gy + 0.3, z }, n: 10, ringR: R * 0.85, dir: { x: 0, y: 1, z: 0 }, spread: 1.3, speed: [1.5, 4], size: [0.8, 1.3] });
    fx.burst({ pos: { x, y: gy + 0.3, z }, n: 14, sprite: SPR.shard, color: [IRON, SOOT], spread: 0.9, speed: [4, 10], size: [0.14, 0.26], life: [0.5, 0.85], gravity: 17, spin: 9, radius: 0.8 });
    fx.burst({ pos: { x, y: gy + 0.3, z }, n: 22, sprite: SPR.ember, add: true, color: [FLAME, CINDER], spread: 1.1, speed: [3, 9], size: [0.08, 0.15], life: [0.5, 1.0], gravity: 8, radius: 1.0 });
    // 地上留下的：焦黑的底上一张烧红的裂纹网。刚砸下去最亮，烧满 4 秒才凉，凉下去以后焦痕再留几秒慢慢淡掉
    // 第九轮 polish-old：裂纹原来一直烧到第 4.9 秒，整片地是一张发亮的橙色裂纹网（像一张熔岩饼）。现在砸下去最亮，一秒多就凉成暗红（留三成），
    // 火场“在烧”交给边上和里面立着的火苗：暗的地、亮的火，范围的边一眼看清
    patch(fx, api, { kind: "cracks", x, z, r: R * 1.06, life: 8.5, alpha: 0.95, sweep: 0.2, hot: 0.7, cool: 1.0, floor: 0.32 });
    // 余烬：减速每 0.25 秒查一次（走进来的人马上就慢），伤害隔一次结算一次，一共 8 下
    // 第九轮 polish-old：范围的边原来是一圈矮火墙（俯视只剩一道亮线），里面是一股股往上窜的火球——整片读成一团，看不出边、也不像地在烧。
    // 现在是一片立在地上的小火苗：沿着边密密的一圈（这就是减速、灼烧的范围），里面一簇一簇稀的；落地时从中间往外点着
    const burn = 30 + c.lv * 6; let n = 0, acc = 0; const ring = flameBed(fx, { x, z, r: R * 0.97, h: 1.35, w: 0.95, heat: 0.8 }); ring.ignite(0);
    api.run(0.3, k => ring.ignite(k));
    api.zone({ me, x, z, r: R, dur: 4.05, tick: 0.25,
      every(_z, list) { const hit = n > 0 && n % 2 === 0; n++;
        for (const e of list) { if (isBuilding(e)) continue; api.slow(e, 0.35, 0.45); if (!hit) continue; api.hit(me, e, burn, "magic");
          blaze(fx, { pos: api.pos(e, 0.5), n: 2, dir: { x: 0, y: 1, z: 0 }, spread: 0.5, speed: [0.5, 1.5], size: [0.28, 0.42], grow: 2, life: [0.35, 0.5], heat: [0.5, 0.68], radius: 0.25 });      /* polish-old：原来是两撮立着的火舌，俯视像脚下插了两个橙色锥子 */ } },
      frame(zn, dt) {      // 这一片地一直在烧（第九轮 fx2c）：一撮撮立着的火舌此起彼伏（烧到头冒一点黑烟）、往上飘的火星、偶尔一缕黑烟；最后半秒收掉
        const k = Math.min(1, (zn.dur - zn.t) / 0.6); acc += dt * k; ring.alpha(0.4 + 0.6 * k);
        while (acc > 0) { acc -= LITE ? 0.11 : 0.055; const [fxx, fzz] = inDisc(x, z, R * 0.9), y = fx.ground(fxx, fzz), roll = Math.random();
          if (roll < 0.62) fx.burst({ pos: { x: fxx, y: y + 0.15, z: fzz }, n: 1, sprite: SPR.ember, add: true, color: [FLAME, CINDER], size: [0.06, 0.12], life: [0.8, 1.5], speed: [0.1, 0.5], up: 1.6, gravity: -0.6, drag: 0.5 });      // 往上飘的火星
          else soot(fx, { pos: { x: fxx, y: y + 0.6, z: fzz }, n: 1, opacity: [0.2, 0.32], size: [0.6, 1.0] }); }      // 偶尔一缕黑烟
      },
      end() { edge.kill(); ring.kill(); } });
  },
  end(c) { if (!c.data.fired) c.data.edge?.kill(); },      // 还没砸下去就被打断：把落点的圈收掉
};

// ---------------------------------------------------------------- R 开闸
const R: SkillDef = { key: "R", name: "开闸", icon: "gorran_r", cast: "self", radius: 6.5, cd: 70, mana: 100, minLevel: 6,
  desc: "打开胸口的炉门：嘲讽 6.5 米内所有敌人 2.2 秒，自己 5 秒内护甲和魔抗各加 60，并持续灼烧周围。",
  start(c) {      // 出手前：周围的火星往胸口收，炉门缝里透出一点光
    const { a, fx } = c, ch = a.chest(v3());
    for (let i = 0; i < 16; i++) { const an = Math.random() * TAU, r = 2.2 + Math.random() * 1.6, p = { x: ch.x + Math.cos(an) * r, y: ch.y - 1.0 + Math.random() * 1.6, z: ch.z + Math.sin(an) * r };
      fx.burst({ pos: p, n: 1, sprite: SPR.ember, add: true, color: [EMBER, FLAME], dir: { x: ch.x - p.x, y: ch.y - p.y, z: ch.z - p.z }, spread: 0.08, speed: r / 0.24, size: [0.08, 0.14], life: 0.25, stretch: 0.7 }); }
    fx.flash(ch, EMBER, 1.3, 0.24, false);
  },
  fire(c) {
    const { me, a, api, fx } = c, RAD = 6.5, x = a.pos.x, z = a.pos.z, gy = fx.ground(x, z), ch = a.chest(v3()), yaw = a.yaw(), fdx = Math.sin(yaw), fdz = Math.cos(yaw);
    // 规则：嘲讽、双抗、灼烧
    for (const e of foes(api, me, x, z, RAD)) { api.taunt(e, me, 2.2);
      const b = fx.beam({ color: CINDER, width: 0.2, life: 0.1 }); b.set(ch, api.pos(e, 1.2));                         // 一道火线把它们拽住，一闪就没
      shock(fx, e.x, e.z, e.r + 0.6, EMBER, 0.5); }
    api.buff(me, "sluice", 5, { armor: 60, mr: 60 });
    // 开闸的那一下：胸口的火冲出来，一圈热浪推到 6.5 米，后面跟着一圈黑烟；脚下烧出一大片焦痕
    fx.flash(ch, FLAME, 1.8, 0.16); fx.shake(0.22, 0.5); fx.impact(ch, { color: FLAME, color2: EMBER, size: 1.1, big: true });      // 开闸那一下（第九轮）：胸口一团白芯（polish-old：闪光 3.4 → 1.8，原来整个人被一团黄光吞掉）
    // 第九轮 fx2c 重做：原来是一道叠加发光的火柱加一圈细线，看着是“一团橙光”。现在是炉门一开，一大团火从胸口往前、往上翻出来，烧成黑烟；
    // 一圈火墙推到 6.5 米（嘲讽的范围），外面跟一圈黑烟墙；贴着地往四周滚出去的火团
    // 第九轮 polish-old：原来胸口 12 团、脚下 10 团、贴地往外滚 40 团，几乎全是白热的，叠成一整盘发白的橙色，圈里什么都看不见。
    // 现在：胸口朝前喷一小口火（几团，橙、凉得早）；一层贴地的火从脚下漫到 6.5 米（前沿是一道最旺的火圈，身后烧成暗红再焦黑），外面跟着火墙和烟墙；
    // 贴地往外滚的火团只剩十来团、小一号，跟在火圈后面
    blaze(fx, { pos: { x: ch.x + fdx * 0.5, y: ch.y, z: ch.z + fdz * 0.5 }, n: 6, dir: { x: fdx, y: 0.35, z: fdz }, spread: 0.55, speed: [5, 10], drag: 3.2, size: [0.6, 0.9], grow: 2.3, life: [0.6, 0.9], rise: 2.2, heat: [0.65, 0.82] });
    wall(fx, api, { x, z, r: RAD, h: 1.7, life: 0.6, from: 0.1, fire: true }); wall(fx, api, { x, z, r: RAD * 1.06, h: 1.4, life: 0.9, from: 0.12, color: 0x3a3330, alpha: 0.6 });
    sheet(fx, api, { x, z, r: RAD * 1.02, life: 1.0, reach: 0.42, from: 0.14, band: 0.24, heat: 0.8, soot: 0.38 });
    shock(fx, x, z, RAD, CINDER, 0.6, true, 0.5); patch(fx, api, { kind: "wave", x, z, r: RAD, life: 0.5, alpha: 0.6 });
    patch(fx, api, { kind: "cracks", x, z, r: 5.0, life: 9.5, alpha: 0.88, sweep: 0.3, hot: 0.8, cool: 1.2, floor: 0.3 });      // polish-old：原来亮满 6.3 秒（一整盘发亮的裂纹），现在一秒多凉成暗红，圈里看得清人
    for (let i = 0; i < 12; i++) { const an = (i / 12) * TAU + (Math.random() - 0.5) * 0.4, dir = { x: Math.sin(an), y: 0.06, z: Math.cos(an) }, p = { x: x + dir.x * 0.9, y: gy + 0.5, z: z + dir.z * 0.9 };      // 贴着地往四周滚出去的火团（快慢不一，不排成一圈珠子）
      blaze(fx, { pos: p, n: 1, dir, spread: 0.2, speed: [9, 17], drag: 3.0, size: [0.42, 0.62], grow: 2.4, life: [0.5, 0.75], rise: 1.4, shape: "streak", stretch: 0.35, heat: [0.5, 0.7] }); }
    fx.burst({ pos: ch, n: 24, sprite: SPR.ember, add: true, color: [FLAME, CINDER], spread: 1.25, speed: [3, 9], size: [0.08, 0.15], life: [0.7, 1.4], gravity: 6, drag: 0.6, radius: 0.4 });
    // 这 5 秒：胸口一直烧着、冒黑烟，门里的火光漏在面前的地上；范围的边上一圈贴地的火舌围成“炉膛”（跟着人走）；每 0.5 秒一圈热浪就是一次灼烧
    // 范围边上一圈烧着的火：炉膛的边，嘲讽和灼烧的范围一眼看清（第九轮 polish-old：原来是一圈连着的矮火墙，俯视像一道发黄的亮线；换成一圈立在地上的火苗，火墙压矮压淡留着当墙根）
    const edge = patch(fx, api, { kind: "edge", x, z, r: RAD, life: 6, alpha: 0.42 }), ring = fence(fx, { x, z, r: RAD * 0.98, h: 0.7, alpha: 0.4 }), bed = flameBed(fx, { x, z, r: RAD * 0.99, inner: 0, h: 1.6, w: 1.0, heat: 0.8 }); bed.ignite(0);
    api.run(0.45, k => bed.ignite(k));
    const glow = patch(fx, api, { kind: "glow", x, z, yaw, r: 5.5, angle: 0.85, life: 5.05, alpha: 0.7 });
    const fire = puffer(fx, { pos: ch, rate: 18, heat: [0.62, 0.8], cool: 0.45, smoke: 0x3a332f, opacity: [0.3, 0.42], size: [0.4, 0.65], grow: 2.3, life: [0.5, 0.75], dir: { x: fdx, y: 0.5, z: fdz }, spread: 0.5, speed: [1.5, 3.5], drag: 2, rise: 2.2, radius: 0.15 });      // 开着的炉门里一直往外翻的火
    const spit = fx.emitter({ pos: ch, rate: 14, sprite: SPR.ember, add: true, color: [FLAME, CINDER], dir: { x: fdx, y: 0.3, z: fdz }, spread: 0.8, speed: [1.5, 4.5], size: [0.06, 0.12], life: [0.4, 0.85], gravity: 4 });
    const smoke = puffer(fx, { pos: ch, rate: 6, heat: [0.15, 0.3], cool: 0.2, smoke: 0x221d1a, opacity: [0.4, 0.55], size: [0.7, 1.1], grow: 2.4, life: [1.4, 2.0], speed: [0.1, 0.4], up: 1.0, drag: 0.6, rise: 1.2, radius: 0.4 });
    let ringAcc = 0;
    const burn = () => 45 + c.lv * 10 + me.max * 0.01,      /* 原来是 3% 最大生命，十下加起来比刺客的大招还高，降到 1% */ q = v3(); let n = 0, acc = 0, lx = x, lz = z, wave: Patch | null = null;
    api.zone({ me, x, z, r: RAD, dur: 5.05, tick: 0.5, follow: me,
      every(zn, list) { if (n++ === 0) return;      // 第一下和开闸是同一刻，不算；之后 0.5 秒一下，一共 10 下
        wave = patch(fx, api, { kind: "wave", x: zn.x, z: zn.z, r: RAD, life: 0.5, alpha: 0.7 });
        for (const e of list) { if (isBuilding(e)) continue; api.hit(me, e, burn(), "magic");
          blaze(fx, { pos: api.pos(e, 0.5), n: 2, dir: { x: 0, y: 1, z: 0 }, spread: 0.5, speed: [0.5, 1.5], size: [0.28, 0.42], grow: 2, life: [0.35, 0.5], heat: [0.5, 0.68], radius: 0.25 });      /* polish-old：原来是两撮立着的火舌，俯视像脚下插了两个橙色锥子 */ } },
      frame(zn, dt) {
        const yw = a.yaw(), dx = Math.sin(yw), dz = Math.cos(yw); a.chest(q);
        edge.set(zn.x, zn.z); ring.set(zn.x, zn.z); bed.set(zn.x, zn.z); glow.set(zn.x, zn.z, yw); wave?.set(zn.x, zn.z); fire.at(q.x + dx * 0.55, q.y - 0.2, q.z + dz * 0.55); fire.aim(dx, 0.5, dz); spit.at(q.x + dx * 0.6, q.y, q.z + dz * 0.6); smoke.at(q.x, q.y + 1.0, q.z);
        if (Math.hypot(zn.x - lx, zn.z - lz) > 2.4) { lx = zn.x; lz = zn.z; patch(fx, api, { kind: "cracks", x: lx, z: lz, r: 2.5, life: 6, alpha: 0.75, sweep: 0.25, hot: 1.6, cool: 1.2 }); }      // 走到哪烧到哪
        const k = Math.min(1, (zn.dur - zn.t) / 0.6); acc += dt * k; ring.alpha(k); bed.alpha(k); ringAcc += dt * k * (LITE ? 2 : 4);
        while (ringAcc >= 1) { ringAcc -= 1; const an = Math.random() * TAU, rr = RAD * (0.94 + Math.random() * 0.05), ex = zn.x + Math.cos(an) * rr, ez = zn.z + Math.sin(an) * rr;      // 火墙上偶尔窜起一团火、冒一缕烟
          blaze(fx, { pos: { x: ex, y: fx.ground(ex, ez) + 0.5, z: ez }, n: 1, dir: { x: 0, y: 1, z: 0 }, spread: 0.4, speed: [1, 2], size: [0.4, 0.6], life: [0.6, 0.85], heat: [0.5, 0.68] }); }
        while (acc > 0) { acc -= 0.06; const [ex, ez] = inDisc(zn.x, zn.z, RAD * 0.95), y = fx.ground(ex, ez);      // 圈里零星往上飘的余烬，偶尔一缕烟
          if (Math.random() < 0.8) fx.burst({ pos: { x: ex, y: y + 0.15, z: ez }, n: 1, sprite: SPR.ember, add: true, color: [FLAME, CINDER], size: [0.06, 0.12], life: [0.8, 1.5], speed: [0.1, 0.5], up: 1.7, gravity: -0.6, drag: 0.5 });
          else soot(fx, { pos: { x: ex, y: y + 0.4, z: ez }, n: 1, opacity: [0.2, 0.32] }); }
      },
      end(zn) {      // 关闸：火收掉，胸口冒一团烟
        fire.stop(); spit.stop(); smoke.stop(); glow.kill(); edge.kill(); ring.kill(); bed.kill();
        if (!me.alive) return; a.chest(q);
        soot(fx, { pos: q, n: 8, size: [0.8, 1.2], life: [1.0, 1.6], speed: [0.4, 1.4], up: 0.8, radius: 0.3, opacity: [0.4, 0.55] });
        patch(fx, api, { kind: "wave", x: zn.x, z: zn.z, r: 2.4, life: 0.5, alpha: 0.8, color: ASH });
      } });
  },
};

export const gorran: HeroKit = {
  id: "gorran", name: "葛隆", title: "砧卫", role: "坦克", side: 1, color: EMBER, color2: IRON, height: 3.5, look: { lift: 1.15, sat: 0.85 },      /* 换画风 B（w-gh）：卡通版的钢蓝铁甲按默认的提亮 1.4、饱和 1.3 在游戏里发白发艳（中间调 92,107,143），压到 1.15、0.85 后量出来 79,91,118，设定图 gorran-p1-sheet-bright 是 80,88,109；亮部仍比设定图亮（171 对 133），红土上要靠它跳出来。HB 乘在这上面，不动 HB 的默认值 */
  base: { hp: 4450, mana: 500, ad: 165, ap: 0, armor: 50, mr: 35, ms: 5.4, as: 1.0,      /* 阶段 6：攻击 150 → 165、攻速 0.95 → 1.0，不然他守的那条线推不动 */ range: 2.4, cdr: 0, ls: 0, hpRegen: 0.008, manaRegen: 0.012 },
  skills: [Q, W, E, R],
  passive(c) { warm(c.fx, c.api, c.me.x, c.me.z); },      // 第九轮 fx2c：新零件的着色器在第一帧编好（只做一次）
  attack(c) {      // 普攻：锤头砸中，溅几点火星，带一小团灰
    const { me, api, fx, target: e } = c, at = api.pos(e, isBuilding(e) ? 2.2 : 1.2), dir = { x: e.x - me.x, y: 0.6, z: e.z - me.z };
    fx.burst({ pos: at, n: 10, sprite: SPR.streak, add: true, color: [FLAME, EMBER], dir, spread: 1.1, speed: [3, 8], size: [0.1, 0.17], life: [0.2, 0.36], gravity: 14, stretch: 1.1 });
    fx.burst({ pos: at, n: 3, sprite: SPR.dust, color: [ASH, IRON], alpha: [0.24, 0.4], size: [0.45, 0.75], grow: 1.9, life: [0.3, 0.5], speed: [0.4, 1.4], radius: 0.2 });
  },
};
