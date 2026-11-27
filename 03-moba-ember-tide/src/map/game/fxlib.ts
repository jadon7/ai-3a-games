// 技能特效的零件库（阶段 5）。每个英雄的技能文件（heroes/*.ts）用这里的零件拼出自己的特效，不直接写着色器。
//
// 零件：
//   burst / emitter   粒子：一次爆开，或者挂在一个会动的点上持续喷。粒子的运动在显卡上算，放出去以后不占 CPU。
//   decal / ring      贴地的东西：冲击波、焦痕、裂纹、法阵、水面、地火、蜡、黑暗、漩涡。都是着色器现算的图案，不用贴图。
//   column            竖着的柱：火柱、光柱、水柱。
//   beam              两点之间的一道光带。
//   flash             一下闪光（一团亮，加一盏很短的点光；点光全场最多两盏，是发光预算）。
//   shake             镜头抖一下。
//   ghost             残影：把英雄当前的姿势留一个半透明的影子，很快淡掉。
//   proj              弹体的小模型：弩矢、光球、罐子。
//   indicator         施法指示：范围圈、直线、扇形、落点圈。
//   slash / trail     （第九轮）刀光的月牙带子、弹道和冲刺后面的拖尾带子
//   impact            （第九轮）标准的命中：白芯、火花（polish-lib 去掉了正对镜头的白环）
//   hitstop           （第九轮）顿帧
// 第九轮：贴花、柱、光带、闪光、刀光、拖尾都用池子，用完藏起来下次接着用，不每次新建材质；手机档（LITE）粒子数减半、点光只有一盏。
//
// 规矩（用户的口味）：亮的东西要短、要少，一个技能里最亮的那一下不超过四分之一秒；颜色用英雄自己阵营的色系
// （沉月会青色加骨白，烬誓庭琥珀橙加炭黑），不要彩虹；地上留的印记用地面的色系，淡出要慢，不要突然消失。
// 一个像样的技能特效至少三层：出手（手上或武器上的一点预兆）、过程（飞行的弹体或铺开的范围）、命中（闪一下、溅开、地上留痕）。

import * as THREE from "three";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import { LITE } from "../quality";
import { BOUT, FXB, PREMUL, deep, smokeB } from "./fxb";
import type { ScreenFx } from "./fx_iti_screen";
import type { Ent } from "./sim";

export type V3 = { x: number; y: number; z: number };
type Col = number | [number, number];
type Rng = number | [number, number];
const rnd = (r: Rng) => (typeof r === "number" ? r : r[0] + Math.random() * (r[1] - r[0]));

/** 粒子用的小图（一张图集里的第几格） */
export const SPR = { soft: 0, glint: 1, smoke: 2, streak: 3, drop: 4, ember: 5, shard: 6, ring: 7, flame: 8, leaf: 9, bubble: 10, dust: 11, arc: 12, slash: 13, disc: 14, star: 15 } as const;

export interface BurstOpts {
  pos: V3; n?: number; sprite?: number; add?: boolean;        // add：叠加发光（火花、光点）；不加就是普通半透明（烟、尘、水珠）
  color?: Col; alpha?: Rng | [number, number];                // 颜色从第一个变到第二个；alpha 是起始不透明度（结尾总是 0）
  size?: Rng; grow?: number;                                  // 起始大小（米）；grow 是结束时是起始的几倍
  life?: Rng; speed?: Rng;
  dir?: V3; spread?: number;                                  // 往哪个方向喷、张角（弧度，3.14 是整个球，1.57 是半球）
  radius?: number; ringR?: number;                            // 出生位置：一个球里随机；或者水平一圈上（ringR）
  gravity?: number; drag?: number; stretch?: number; spin?: number; up?: number;      // stretch：顺着速度拉长（火花、水线）
}
export interface Emitter { at: (x: number, y: number, z: number) => void; stop: () => void; rate: number; }
export type DecalKind = "shock" | "disc" | "scorch" | "crack" | "rune" | "water" | "fire" | "wax" | "dark" | "swirl" | "rect" | "cone";
export interface DecalOpts {
  kind: DecalKind; x: number; z: number; r: number; life: number;
  color?: number; color2?: number; alpha?: number; add?: boolean;
  from?: number;                                              // 开始时的大小是最终的几成（冲击波从小长到大）
  fadeIn?: number; fadeOut?: number;                          // 占整个寿命的比例
  spin?: number; yaw?: number; len?: number; angle?: number;  // rect：len 是长度、r 是半宽；cone：angle 是半张角
  lift?: number;
}
export interface Decal { set: (x: number, z: number, yaw?: number) => void; kill: (fade?: number) => void; size: (r: number, len?: number) => void; alive: () => boolean; alpha?: (a: number) => void; }
export interface Beam { set: (a: V3, b: V3) => void; kill: () => void; width: (w: number) => void; }
export interface Handle { obj: THREE.Object3D; kill: () => void; }
export interface Indicator { show: (on: boolean) => void; set: (x: number, z: number, yaw?: number) => void; size: (r: number, len?: number, angle?: number) => void; color: (c: number) => void; }

export interface FxLib {
  group: THREE.Group; update: (dt: number) => void; time: () => number;
  burst: (o: BurstOpts) => void;
  emitter: (o: BurstOpts & { rate: number }) => Emitter;
  decal: (o: DecalOpts) => Decal;
  ring: (x: number, z: number, r: number, color?: number, life?: number, add?: boolean) => void;      // 一圈冲击波（decal 的 shock 的简写）
  column: (o: { x: number; z: number; r: number; h: number; life: number; color?: number; color2?: number; kind?: "fire" | "light" | "water"; y?: number }) => void;
  beam: (o: { color?: number; width?: number; add?: boolean; life?: number }) => Beam;
  flash: (pos: V3, color?: number, size?: number, dur?: number, light?: boolean) => void;
  shake: (amp: number, dur?: number) => void; shakeOffset: (out: THREE.Vector3) => THREE.Vector3;
  ghost: (model: THREE.Object3D, color?: number, life?: number, opacity?: number) => void;
  proj: (kind: "bolt" | "orb" | "flask" | "shard", color?: number, size?: number) => Handle;
  indicator: (kind: "circle" | "line" | "cone" | "spot", color?: number) => Indicator;
  ground: (x: number, z: number) => number;                   // (x,z) 处特效该放多高：地面，在水里就是水面
  /** 每种特效先各出一个看不见的。主程序接着让渲染器把场景里的着色器都编好，第一次放技能就不会卡一下 */
  warm: (x: number, z: number) => void;
  /** 刀光（第九轮）：一道月牙形的带子从一头扫到另一头。pos 是圆心（一般在出手的人身上、离地一米多），yaw 朝哪边，r 半径，arc 张多大（弧度），tilt 侧倾，flip 反着扫 */
  slash: (o: { pos: V3; yaw: number; r?: number; width?: number; arc?: number; tilt?: number; color?: number; color2?: number; life?: number; sweep?: number; flip?: boolean; alpha?: number }) => void;
  /** 拖尾（第九轮）：每帧 at 一下当前位置，stop 以后尾巴自己收完 */
  trail: (o: { color?: number; color2?: number; width?: number; life?: number; alpha?: number; step?: number }) => { at: (x: number, y: number, z: number) => void; stop: () => void };
  /** 命中（第九轮）：白芯一闪、几道顺着方向的火花；big 加地上一圈和一点烟 */
  impact: (pos: V3, o?: { color?: number; color2?: number; size?: number; big?: boolean; dir?: V3; sparks?: number }) => void;
  /** 顿帧：对局停一小会儿（大招打中英雄时用）。timeScale 是主循环每帧问的：这一帧的对局时间要乘几 */
  hitstop: (sec: number) => void; timeScale: (realDt: number) => number;
  /** 伊缇第四阶段 iti-fx3 新加（只新增，老英雄不用就没有任何变化）：
   *  screen   屏幕级的演出（压暗、全屏闪、镜头推拉、泛光、径向模糊、色差、打击帧、大招切入，见 fx_iti_screen.ts）。主程序建好以后挂上来；没挂（调试页）就是 undefined
   *  tick     登记一个每帧都调的函数（对局时间的 dt，顿帧、暂停跟着停）：英雄自己的特效零件靠它推时间
   *  lamp     只借用那两盏很短的点光（flash 里的那两盏），不出那团柔光：让特效的光真的照到地面和旁边的人身上 */
  screen?: ScreenFx; tick: (fn: (dt: number) => void) => void; lamp: (pos: V3, color?: number, power?: number, dur?: number) => void;
  /** iti-fx3 第二步新加：小兵、野怪整身闪一下（view.ts 建好以后挂上来；英雄的在 hero.hitWhole）。k 多满，color 闪成什么颜色 */
  flashUnit?: (e: Ent, k: number, color?: number) => void;
  /** iti-fx3 第二步新加：整张图的地面高度贴图和它的参数（就是上面贴花在着色器里落到地面用的那一套）。英雄自己的贴地零件拿去用，坡上、岸边不会被地形切掉；调试页没有这张图时是 undefined */
  terr?: { uTerr: { value: THREE.Texture | null }; uTerrP: { value: THREE.Vector3 } };
}

/** 第九轮 polish-lib：迷雾那边（fow.ts）告诉特效库“玩家这一队看不看得见 (x,z)”。粒子在出生的时候问一次：深在迷雾里的不放（不占池子）。
 *  精确到像素的藏法在 fow.ts 的着色器里（贴花、光柱、拖尾、持续的特效每帧都按位置藏），这里只是省掉明摆着看不见的那些。没有迷雾（观战、?nofog=1）时是 null */
export const FOG: { sees: ((x: number, z: number) => boolean) | null } = { sees: null };

const NOISE = /* glsl */ `
  float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
  float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vn(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
`;

/** 画粒子图集（第九轮重画）：4×4 格，每格 256 像素，都是白色的形状，颜色在着色器里乘。
 *  原来是用画布的渐变和几笔路径画的，形状单一、边缘是一样的圆滑渐变，放大了一眼看出是“程序画的圆”。
 *  现在烟、尘、火、余烬是逐像素用噪声算的（有絮状的边、里面有浓淡），火花和刀光是中间一道亮芯、两头收尖，
 *  闪光是四芒的星。烟和尘的不透明度里带着浓淡：粒子着色器靠它做“从边上往里散掉”的消散（见下面的 dissolve）。 */
function atlas(): THREE.CanvasTexture {
  const N = 256, cv = document.createElement("canvas"); cv.width = cv.height = N * 4; const c = cv.getContext("2d")!;
  const hash = (x: number, y: number, s: number) => { let h = (x * 374761393 + y * 668265263 + s * 1442695041) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };
  const vn = (x: number, y: number, s: number) => { const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), cc = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s); return a + (b - a) * u + (cc - a) * v + (a - b - cc + d) * u * v; };
  const fbm = (x: number, y: number, s: number, o = 4) => { let a = 0.5, t = 0; for (let i = 0; i < o; i++) { t += a * vn(x, y, s + i * 17); x = x * 2.03 + 11.7; y = y * 2.03 + 3.1; a *= 0.5; } return t / (1 - Math.pow(0.5, o)); };
  const ss = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  /** 逐像素画一格：f 拿到 (u, v) ∈ [-1,1]（v 朝上），返回 [亮度, 不透明度] */
  const px = (i: number, f: (u: number, v: number) => [number, number]) => { const im = c.createImageData(N, N), d = im.data;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const [l, a] = f((x + 0.5) / N * 2 - 1, 1 - (y + 0.5) / N * 2), k = (y * N + x) * 4, L = Math.round(Math.max(0, Math.min(1, l)) * 255); d[k] = d[k + 1] = d[k + 2] = L; d[k + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255); }
    c.putImageData(im, (i % 4) * N, Math.floor(i / 4) * N); };
  const cell = (i: number, draw: (c: CanvasRenderingContext2D) => void) => { c.save(); c.translate((i % 4) * N, Math.floor(i / 4) * N); c.scale(2, 2); c.beginPath(); c.rect(0, 0, 128, 128); c.clip(); draw(c); c.restore(); };
  const rad = (c: CanvasRenderingContext2D, stops: [number, number][], r = 64) => { const g = c.createRadialGradient(64, 64, 0, 64, 64, r); for (const [p, a] of stops) g.addColorStop(p, `rgba(255,255,255,${a})`); c.fillStyle = g; c.fillRect(0, 0, 128, 128); };
  px(SPR.soft, (u, v) => { const r = Math.hypot(u, v); return [1, Math.exp(-r * r * 4.2) * (1 - ss(0.82, 1, r))]; });
  px(SPR.glint, (u, v) => { const r = Math.hypot(u, v), au = Math.abs(u), av = Math.abs(v), du = Math.abs(u + v) * 0.7071, dv = Math.abs(u - v) * 0.7071;      // 四芒星：两道长芒、两道短的斜芒、中间一团
    const ray = Math.exp(-av * 70) * Math.pow(Math.max(0, 1 - au), 2.2) + Math.exp(-au * 70) * Math.pow(Math.max(0, 1 - av), 2.2), diag = (Math.exp(-dv * 90) * Math.pow(Math.max(0, 1 - du * 1.8), 2) + Math.exp(-du * 90) * Math.pow(Math.max(0, 1 - dv * 1.8), 2)) * 0.45;
    return [1, Math.min(1, Math.exp(-r * r * 40) + Math.exp(-r * r * 9) * 0.35 + ray + diag) * (1 - ss(0.9, 1, r))]; });
  px(SPR.smoke, (u, v) => { const r = Math.hypot(u, v), n = fbm(u * 2.1 + 3, v * 2.1, 7), m = fbm(u * 4.5, v * 4.5 + 5, 9, 3);      // 一团絮状的烟：边缘被噪声啃过，里面有浓淡；亮度偏上面亮一点（像受光）
    const shape = 1 - ss(0.3, 0.98, r + (n - 0.5) * 0.75); return [0.66 + 0.24 * m + 0.1 * v, shape * (0.25 + 0.75 * ss(0.2, 0.8, n * 0.7 + m * 0.3))]; });
  px(SPR.streak, (u, v) => { const t = (u + 1) / 2, w = 0.035 + 0.05 * Math.sin(Math.PI * Math.min(1, t * 1.15)), along = ss(0, 0.7, t) * (1 - ss(0.82, 1, t));      // 火花：一道两头尖的亮线，头上（右边）最亮
    return [1, along * (Math.exp(-(v / w) * (v / w)) + 0.25 * Math.exp(-(v / (w * 3)) * (v / (w * 3))))]; });
  cell(SPR.drop, c => { const g = c.createRadialGradient(60, 74, 0, 64, 72, 34); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.6, "rgba(255,255,255,0.8)"); g.addColorStop(1, "rgba(255,255,255,0.25)"); c.fillStyle = g; c.beginPath(); c.moveTo(64, 14); c.quadraticCurveTo(100, 70, 64, 108); c.quadraticCurveTo(28, 70, 64, 14); c.fill(); c.fillStyle = "rgba(255,255,255,0.9)"; c.beginPath(); c.ellipse(56, 76, 5, 9, 0.3, 0, 6.283); c.fill(); });
  px(SPR.ember, (u, v) => { const r = Math.hypot(u, v), n = fbm(u * 3 + 1, v * 3, 3); return [1, Math.min(1, Math.exp(-r * r * 26) * 1.2 + Math.exp(-r * r * 5) * 0.4 * n) * (1 - ss(0.8, 1, r))]; });
  cell(SPR.shard, c => { const P = [[64, 8], [90, 62], [72, 120], [40, 78]]; c.fillStyle = "#fff"; c.beginPath(); P.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); c.fill();      // 碎片：一亮一暗两个面，中间一道棱
    c.fillStyle = "rgba(120,120,120,0.55)"; c.beginPath(); c.moveTo(64, 8); c.lineTo(72, 120); c.lineTo(40, 78); c.closePath(); c.fill(); c.strokeStyle = "rgba(255,255,255,0.9)"; c.lineWidth = 2; c.beginPath(); c.moveTo(64, 8); c.lineTo(72, 120); c.stroke(); });
  px(SPR.ring, (u, v) => { const r = Math.hypot(u, v); return [1, Math.exp(-Math.pow((r - 0.76) / 0.05, 2)) + 0.3 * Math.exp(-Math.pow((r - 0.68) / 0.16, 2)) * (r < 0.76 ? 1 : 0.3)]; });
  px(SPR.flame, (u, v) => { const t = (v + 1) / 2, wob = (fbm(u * 2.2, v * 1.6 - 4, 5) - 0.5) * 0.55 * t, x = Math.abs(u + wob), w = 0.5 * Math.pow(Math.max(0, 1 - t), 0.75) * (0.75 + 0.25 * Math.sin(t * 3.1));      // 一条火舌：底宽顶尖，越往上抖得越厉害；中间一道更亮的芯
    if (w <= 0) return [1, 0]; const body = ss(w, w * 0.25, x) * ss(0, 0.16, t), core = ss(w * 0.5, 0, x) * ss(0, 0.1, t) * (1 - ss(0.2, 0.7, t)), n = fbm(u * 5, v * 3 - 2, 8, 3);
    return [1, Math.min(1, body * (0.45 + 0.4 * n) + core * 0.6)]; });
  cell(SPR.leaf, c => { c.fillStyle = "#fff"; c.beginPath(); c.moveTo(64, 14); c.quadraticCurveTo(104, 60, 64, 114); c.quadraticCurveTo(24, 60, 64, 14); c.fill(); c.strokeStyle = "rgba(0,0,0,0.25)"; c.lineWidth = 3; c.beginPath(); c.moveTo(64, 20); c.lineTo(64, 108); c.stroke(); });
  cell(SPR.bubble, c => { rad(c, [[0, 0.06], [0.7, 0.14], [0.86, 0.9], [0.93, 0.4], [1, 0]], 56); const g = c.createRadialGradient(46, 44, 0, 46, 44, 16); g.addColorStop(0, "rgba(255,255,255,0.95)"); g.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = g; c.fillRect(0, 0, 128, 128); });
  px(SPR.dust, (u, v) => { const r = Math.hypot(u, v), n = fbm(u * 2.4 + 9, v * 2.4, 13), m = fbm(u * 6, v * 6, 21, 3);      // 扬起来的土：比烟稀，一缕一缕的
    return [0.75 + 0.25 * m, (1 - ss(0.25, 0.95, r + (n - 0.5) * 0.8)) * ss(0.3, 0.75, n * 0.6 + m * 0.4) * 0.85]; });
  px(SPR.arc, (u, v) => { const cx = 0, cy = -0.55, R = 1.18, dx = u - cx, dy = v - cy, r = Math.hypot(dx, dy), th = Math.atan2(dx, dy), t = 0.5 + th / 1.7;      // 月牙形的刀光：外沿一道最亮的边，往里很快淡掉，两头收尖
    if (t <= 0 || t >= 1) return [1, 0]; const thick = 0.34 * Math.pow(Math.sin(Math.PI * t), 0.8), d = (R - r) / Math.max(1e-3, thick); if (d < -0.08 || d > 1) return [1, 0];
    const edge = Math.exp(-Math.pow(Math.max(0, d) / 0.12, 2)) + 0.45 * Math.pow(Math.max(0, 1 - d), 2.2); return [1, Math.min(1, edge) * ss(-0.08, 0.02, d)]; });
  px(SPR.slash, (u, v) => { const t = (u + 1) / 2, w = 0.06 * Math.pow(Math.sin(Math.PI * t), 0.7), y = v + 0.18 * (u * u - 0.3); return [1, w > 0 ? Math.exp(-(y / w) * (y / w)) + 0.2 * Math.exp(-(y / (w * 4)) * (y / (w * 4))) * Math.sin(Math.PI * t) : 0]; });
  cell(SPR.disc, c => rad(c, [[0, 1], [0.8, 1], [1, 0]], 58));
  cell(SPR.star, c => { const g = c.createRadialGradient(64, 64, 0, 64, 64, 56); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.6, "rgba(255,255,255,0.95)"); g.addColorStop(1, "rgba(255,255,255,0.6)"); c.fillStyle = g; c.beginPath(); for (let i = 0; i < 10; i++) { const a = (i / 10) * 6.2832 - 1.5708, r = i % 2 ? 22 : 54; c.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r); } c.closePath(); c.fill(); });
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = 4; return t;
}

export function createFxLib(o: { height: (x: number, z: number) => number; waterY: number; terrain?: { tex: THREE.Texture; half: number; n: number } }): FxLib {
  const group = new THREE.Group(); group.name = "fxlib"; const clock = { value: 0 }, tex = atlas();
  const ground = (x: number, z: number) => Math.max(o.height(x, z), o.waterY);
  const C = new THREE.Color(), C2 = new THREE.Color();
  const cols = (c: Col | undefined, d: number): [THREE.Color, THREE.Color] => { const a = c === undefined ? d : typeof c === "number" ? c : c[0], b = c === undefined ? d : typeof c === "number" ? c : c[1]; return [C.set(a), C2.set(b)]; };

  // ---------------------------------------------------------------- 粒子
  // 每个粒子只在出生时写一次数据（出生点、初速度、寿命、大小、颜色……），之后的位置、大小、颜色都由顶点着色器按时间算出来。
  const CAP = 1600;
  function pool(additive: boolean) {
    const g = new THREE.InstancedBufferGeometry(); const q = new THREE.PlaneGeometry(1, 1); g.index = q.index; g.setAttribute("position", q.getAttribute("position")); g.setAttribute("uv", q.getAttribute("uv"));
    const mk = (n: number) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(CAP * n), n); a.setUsage(THREE.DynamicDrawUsage); return a; };
    const A = { p: mk(3), v: mk(3), t: mk(4), s: mk(4), c0: mk(4), c1: mk(4), k: mk(4) };
    g.setAttribute("aP", A.p); g.setAttribute("aV", A.v); g.setAttribute("aT", A.t); g.setAttribute("aS", A.s); g.setAttribute("aC0", A.c0); g.setAttribute("aC1", A.c1); g.setAttribute("aK", A.k); g.instanceCount = CAP;
    const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, ...(additive && FXB.on ? PREMUL : { blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }), uniforms: { uTime: clock, uMap: { value: tex } },      /* 换画风 B：发光的粒子按颜色分，白的叠加、有颜色的盖住地面（见 fxb.ts） */
      vertexShader: /* glsl */ `
        attribute vec3 aP, aV; attribute vec4 aT, aS, aC0, aC1, aK; uniform float uTime; varying vec2 vUv; varying vec4 vCol; varying float vK;
        void main() {
          float age = uTime - aT.x, k = age / aT.y;
          if (k < 0.0 || k >= 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          float dr = aK.y; vec3 vel = aV * exp(-dr * age); vel.y -= aK.x * age;
          vec3 p = aP + (dr > 0.001 ? aV * (1.0 - exp(-dr * age)) / dr : aV * age); p.y -= 0.5 * aK.x * age * age;
          float sz = aS.x * mix(1.0, aS.y, 1.0 - (1.0 - k) * (1.0 - k)), rot = aS.z + aS.w * age;
          vec4 mv = modelViewMatrix * vec4(p, 1.0); vec2 q = position.xy;
          if (aK.z > 0.0) {                                    // 顺着速度拉长：粒子的长边对准它在画面上运动的方向
            vec3 vv = (modelViewMatrix * vec4(vel, 0.0)).xyz; float sp = length(vv.xy); vec2 d = sp > 0.001 ? vv.xy / sp : vec2(1.0, 0.0);
            q = vec2(q.x * (1.0 + aK.z * length(vel) * 0.12), q.y); q = vec2(d.x * q.x - d.y * q.y, d.y * q.x + d.x * q.y);
          } else { float cs = cos(rot), sn = sin(rot); q = vec2(cs * q.x - sn * q.y, sn * q.x + cs * q.y); }
          mv.xy += q * sz; gl_Position = projectionMatrix * mv;
          float cell = aT.z; vUv = (vec2(mod(cell, 4.0), 3.0 - floor(cell / 4.0)) + uv) / 4.0;
          vCol = mix(aC0, aC1, k); vK = k;
          ${additive ? "vCol.rgb = mix(min(vec3(1.0), vCol.rgb * 1.5 + 0.3), vCol.rgb, smoothstep(0.0, 0.28, k)); vCol.a *= smoothstep(0.0, aK.w + 0.0001, k) * (1.0 - smoothstep(0.55, 1.0, k));"      /* 发光的粒子刚出生那一下偏白、偏亮（热的芯），很快退回本色：亮只亮在最开始 */
            : "vCol.a *= smoothstep(0.0, aK.w + 0.0001, k) * (1.0 - smoothstep(0.82, 1.0, k));"}      /* 烟尘不整体淡掉，在片元里从稀的地方往里散（见下） */
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap; varying vec2 vUv; varying vec4 vCol; varying float vK; ${additive && FXB.on ? BOUT : ""}
        void main() { vec4 t = texture2D(uMap, vUv); float a = t.a * vCol.a;
          ${additive ? "" : "float e_ = max(0.0, vK - 0.3) * 0.75; a *= smoothstep(e_, e_ + 0.22, t.a);"}      /* 侵蚀：年纪越大，图里越稀的地方先没，烟是一缕一缕散掉的，不是整团变透明 */
          if (a < 0.004) discard; ${additive && FXB.on ? "gl_FragColor = bOut_(vCol.rgb * t.rgb, a);" : `gl_FragColor = vec4(vCol.rgb * t.rgb ${additive ? "* a, a" : ", a"});
        #include <colorspace_fragment>`}
        }` });
    const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.renderOrder = additive ? 9 : 8; group.add(m);
    return { A, i: 0, dirty: false };
  }
  const pools = [pool(false), pool(true)], dv = new THREE.Vector3(), ax = new THREE.Vector3(), ay = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  function burst(b: BurstOpts) {
    if (FOG.sees && !FOG.sees(b.pos.x, b.pos.z)) return;      // 深在迷雾里：不放（见上面 FOG）
    const P = pools[b.add ? 1 : 0], n0 = b.n ?? 8, n = LITE && n0 > 1 ? Math.ceil(n0 * 0.5) : n0,      /* 手机档粒子数减半（一颗的不减） */ [c0, c1] = cols(b.color, 0xffffff), r0 = c0.r, g0 = c0.g, b0 = c0.b, r1 = c1.r, g1 = c1.g, b1 = c1.b, spread = b.spread ?? Math.PI;
    if (b.dir) { dv.set(b.dir.x, b.dir.y, b.dir.z).normalize(); } else dv.set(0, 1, 0);
    ax.crossVectors(dv, Math.abs(dv.y) > 0.9 ? ay.set(1, 0, 0) : UP).normalize(); ay.crossVectors(dv, ax);
    let R0 = r0, G0 = g0, B0 = b0, R1 = r1, G1 = g1, B1 = b1;
    if (FXB.on && !b.add && b.sprite === SPR.smoke) { smokeB(c0); smokeB(c1); R0 = c0.r; G0 = c0.g; B0 = c0.b; R1 = c1.r; G1 = c1.g; B1 = c1.b; }      // 换画风 B：黑烟往暖灰拉（见 fxb.ts）
    if (FXB.on && !b.add && b.sprite === SPR.drop) { c0.lerp(c1, 0.5); R0 = c0.r; G0 = c0.g; B0 = c0.b; }      // 换画风 B：水珠从白沫色起步在亮地面上看不见，起步就带一半水色
    for (let i = 0; i < n; i++) {
      const k = P.i; P.i = (P.i + 1) % CAP;
      const ct = 1 - Math.random() * (1 - Math.cos(spread)), st = Math.sqrt(Math.max(0, 1 - ct * ct)), ph = Math.random() * 6.2832, sp = rnd(b.speed ?? 2);
      const vx = (dv.x * ct + (ax.x * Math.cos(ph) + ay.x * Math.sin(ph)) * st) * sp, vy = (dv.y * ct + (ax.y * Math.cos(ph) + ay.y * Math.sin(ph)) * st) * sp + (b.up ?? 0), vz = (dv.z * ct + (ax.z * Math.cos(ph) + ay.z * Math.sin(ph)) * st) * sp;
      let px = b.pos.x, py = b.pos.y, pz = b.pos.z;
      if (b.ringR) { const a = Math.random() * 6.2832; px += Math.cos(a) * b.ringR; pz += Math.sin(a) * b.ringR; }
      if (b.radius) { const a = Math.random() * 6.2832, u = Math.random() * 2 - 1, rr = b.radius * Math.cbrt(Math.random()), s2 = Math.sqrt(1 - u * u); px += Math.cos(a) * s2 * rr; py += u * rr; pz += Math.sin(a) * s2 * rr; }
      P.A.p.setXYZ(k, px, py, pz); P.A.v.setXYZ(k, vx, vy, vz);
      P.A.t.setXYZW(k, clock.value, rnd(b.life ?? 0.5), b.sprite ?? SPR.soft, Math.random());
      P.A.s.setXYZW(k, rnd(b.size ?? 0.3), b.grow ?? 1, Math.random() * 6.2832, (Math.random() - 0.5) * 2 * (b.spin ?? 0));
      const al = rnd((b.alpha as Rng) ?? 1); P.A.c0.setXYZW(k, R0, G0, B0, al); P.A.c1.setXYZW(k, R1, G1, B1, al);
      P.A.k.setXYZW(k, b.gravity ?? 0, b.drag ?? 0, b.stretch ?? 0, 0.08);
    }
    P.dirty = true;
  }
  const emitters: { o: BurstOpts & { rate: number }; acc: number; live: boolean; h: Emitter }[] = [];
  function emitter(eo: BurstOpts & { rate: number }): Emitter {
    const pos = { x: eo.pos.x, y: eo.pos.y, z: eo.pos.z }, rec = { o: { ...eo, pos }, acc: 0, live: true, h: null as unknown as Emitter };
    rec.h = { rate: eo.rate, at(x, y, z) { pos.x = x; pos.y = y; pos.z = z; }, stop() { rec.live = false; } }; emitters.push(rec); return rec.h;
  }

  // ---------------------------------------------------------------- 贴地的图案
  const KIND: Record<DecalKind, number> = { shock: 0, disc: 1, scorch: 2, crack: 3, rune: 4, water: 5, fire: 6, wax: 7, dark: 8, swirl: 9, rect: 10, cone: 11 };
  // 贴花是一张 32×32 格的片：有整张图的高度贴图时，每个顶点在着色器里落到地面（或水面）上，坡上不会被地形切掉
  const flat = new THREE.PlaneGeometry(2, 2, 32, 32); flat.rotateX(-Math.PI / 2);
  const terr = { uTerr: { value: o.terrain?.tex ?? null }, uTerrP: { value: new THREE.Vector3(o.terrain?.half ?? 1, o.terrain?.n ?? 2, o.waterY) } };
  const decalVert = /* glsl */ `uniform sampler2D uTerr; uniform vec3 uTerrP; uniform float uLift; varying vec2 vP;
    void main(){ vP = position.xz; vec4 w = modelMatrix * vec4(position, 1.0);
      ${o.terrain ? "vec2 tuv = ((w.xz + uTerrP.x) / (2.0 * uTerrP.x) * (uTerrP.y - 1.0) + 0.5) / uTerrP.y; w.y = max(texture2D(uTerr, tuv).r, uTerrP.z) + uLift;" : ""}
      gl_Position = projectionMatrix * viewMatrix * w; }`;
  const decalFrag = (add: boolean) => /* glsl */ `
    uniform float uTime, uK, uAlpha, uSeed, uAngle, uDis; uniform int uKind; uniform vec3 uA, uB; varying vec2 vP;
    ${NOISE} ${add && FXB.on ? BOUT : ""}
    void main() {
      vec2 p = vP; float r = length(p), th = atan(p.y, p.x), a = 0.0; vec3 col = uA;
      float edge = 1.0 - smoothstep(0.93, 1.0, r);
      if (uKind == 0) {                                          // 冲击波：一圈细亮线，后面拖一层很淡的
        float n = vn(vec2(th * 5.0 + uSeed, uSeed)) * 0.05; a = smoothstep(0.80, 0.93, r + n) * (1.0 - smoothstep(0.93, 0.99, r + n)) + smoothstep(0.4, 0.92, r) * 0.12 * (1.0 - step(0.93, r));
      } else if (uKind == 1) {                                   // 范围圈：一条清楚的边线，里面很淡的一层
        a = (smoothstep(0.9, 0.955, r) * (1.0 - smoothstep(0.965, 1.0, r)) * 0.9 + 0.13 * (0.6 + 0.4 * vn(p * 5.0 + uTime * 0.3))) * step(r, 1.0);
      } else if (uKind == 2) {                                   // 焦痕：边缘不齐的一块黑，里面几道还红着的裂纹，慢慢凉下去
        float n = fbm(p * 3.2 + uSeed), m = 1.0 - smoothstep(0.55, 0.95, r + (n - 0.5) * 0.5); float ck = smoothstep(0.035, 0.0, abs(fbm(p * 5.5 + uSeed * 2.0) - 0.5)) * m;
        col = mix(${FXB.on ? "vec3(0.105, 0.042, 0.018)" : "vec3(0.04, 0.03, 0.03)"}, uA, ck * (1.0 - uK) * (1.0 - uK)); a = m * ${FXB.on ? "0.5" : "0.78"} + ck * 0.2;      /* 换画风 B：亮地面上一块黑像污渍，改成烧过的暖褐（线性值，屏幕上约 #5A3A24），也淡一些 */
      } else if (uKind == 3) {                                   // 裂纹：从中心放射出去的几道，亮着
        float w = fbm(vec2(th * 2.2 + uSeed, r * 2.0)); float ln = smoothstep(0.0, 0.05, abs(fract(th * 1.11 + w * 0.9 + uSeed) - 0.5) - 0.44 + r * 0.03)      /* 原来两个边界写反了：画出来是一整片亮、几道暗缝 */ + smoothstep(0.04, 0.0, abs(fbm(p * 4.0 + uSeed) - 0.5)) * 0.6;
        a = ln * (1.0 - smoothstep(0.5, 1.0, r)) ; col = mix(uB, uA, smoothstep(0.0, 0.6, 1.0 - r));
      } else if (uKind == 4) {                                   // 法阵：几圈线加一圈转动的刻度
        float l1 = smoothstep(0.02, 0.0, abs(r - 0.94)), l2 = smoothstep(0.012, 0.0, abs(r - 0.8)), l3 = smoothstep(0.012, 0.0, abs(r - 0.42));
        float tk = step(0.5, fract((th + uTime * 0.35) * 3.8197)) * smoothstep(0.8, 0.82, r) * (1.0 - smoothstep(0.92, 0.94, r)) * 0.55;
        float sp = smoothstep(0.012, 0.0, abs(fract((th - uTime * 0.2) * 0.9549 + 0.5) - 0.5) * r) * step(0.42, r) * step(r, 0.8) * 0.7;
        a = l1 + l2 * 0.8 + l3 * 0.7 + tk + sp + 0.06 * step(r, 0.94);
      } else if (uKind == 5) {                                   // 水：一圈圈往外走的水纹，边上一道白沫
        float n = fbm(p * 3.0 + uTime * 0.25 + uSeed), rp = sin((r - uTime * 0.35) * 22.0 + n * 5.0) * 0.5 + 0.5;
        a = (0.3 + 0.3 * rp * rp + smoothstep(0.86, 0.95, r + n * 0.08) * 0.5) * edge; col = mix(uA, uB, rp * rp * 0.6 + smoothstep(0.86, 0.95, r) * 0.6);
      } else if (uKind == 6) {                                   // 地火：从上往下看的一片火，中间亮边上暗，一直在翻
        float n = fbm(p * 3.6 + vec2(0.0, -uTime * 0.9) + uSeed) * 0.65 + fbm(p * 8.0 - vec2(uTime * 0.6, 0.0)) * 0.35; float f = smoothstep(0.34 + r * 0.3, 0.72, n) * edge;
        a = f; col = mix(uB, uA, smoothstep(0.45, 0.8, n));
      } else if (uKind == 7) {                                   // 蜡：几摊连在一起的浅色，边缘圆
        float n = fbm(p * 2.2 + uSeed); a = smoothstep(0.02, 0.1, 0.95 - r - (0.5 - n) * 0.7) * 0.9; col = mix(uB, uA, smoothstep(0.3, 0.7, fbm(p * 5.0 + uSeed * 3.0)));
      } else if (uKind == 8) {                                   // 黑暗：边缘翻卷的一片暗
        float n = fbm(vec2(th * 1.5, r * 2.0 - uTime * 0.4) + uSeed); a = (1.0 - smoothstep(0.55, 1.0, r + (n - 0.5) * 0.45)) * 0.72; col = mix(uA, uB, n);
      } else if (uKind == 9) {                                   // 漩涡：几条旋臂往中心卷
        float arm = sin(th * 3.0 + r * 9.0 - uTime * 4.0 + fbm(p * 3.0) * 2.0) * 0.5 + 0.5; a = (0.18 + arm * arm * 0.6) * edge * smoothstep(0.02, 0.2, r); col = mix(uB, uA, arm);
      } else if (uKind == 10) {                                  // 直线指示：一条带子，两边有边线，前头有个箭头的意思
        vec2 q = abs(p); a = (smoothstep(0.86, 0.93, q.x) * 0.85 + 0.12 + smoothstep(0.92, 0.98, p.y) * 0.5) * step(q.x, 1.0) * step(q.y, 1.0);
      } else {                                                   // 扇形指示
        float da = abs(atan(p.x, p.y)); a = (smoothstep(0.9, 0.955, r) * 0.85 + smoothstep(uAngle - 0.06, uAngle - 0.02, da) * 0.7 + 0.12) * step(da, uAngle) * step(r, 1.0);
      }
      if (uDis > 0.0 && (uKind == 2 || uKind == 3 || uKind == 5 || uKind == 6 || uKind == 7 || uKind == 8)) { float dn = fbm(p * 3.4 + uSeed * 1.7) * 0.8 + vn(p * 13.0 + uSeed) * 0.2; a *= smoothstep(uDis * 1.2 - 0.18, uDis * 1.2 - 0.02, dn); }      // 消散（第九轮）：地上的印记不是整片变淡，而是从一块块的地方先蚀掉
      a *= uAlpha; if (a < 0.004) discard;
      ${add && FXB.on ? "gl_FragColor = bOutS_(col, a);" : `gl_FragColor = vec4(col, a);
        #include <colorspace_fragment>`}
    }`;
  // 贴花用池子（第九轮）：用完的不销毁，藏起来留给下一个；材质只在池子不够时新建。拿着旧句柄的技能再调 set、kill 不会动到别人的（按 gen 认）
  interface DecalRec { m: THREE.Mesh; u: Record<string, { value: any }>; t: number; o: DecalOpts; dead: number; r: number; len: number; gen: number; add: boolean; }
  const decals: DecalRec[] = [], decalFree: DecalRec[][] = [[], []];
  function decal(d: DecalOpts): Decal {
    const add = !!d.add; let rec = decalFree[add ? 1 : 0].pop();
    if (!rec) { const u = { uTime: clock, uK: { value: 0 }, uAlpha: { value: 0 }, uDis: { value: 0 }, uSeed: { value: 0 }, uAngle: { value: 0.5 }, uKind: { value: 0 }, uLift: { value: 0.07 }, ...terr, uA: { value: new THREE.Color() }, uB: { value: new THREE.Color() } };
      const mat = new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false, ...(add && FXB.on ? PREMUL : { blending: add ? THREE.AdditiveBlending : THREE.NormalBlending }), polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
        vertexShader: decalVert, fragmentShader: decalFrag(add) });
      const m = new THREE.Mesh(flat, mat); m.renderOrder = add ? 6 : 5.5; m.frustumCulled = false; group.add(m);      /* 水面是 5：贴花要画在水面之后，不然河里的线和圈会被水盖灰 */
      rec = { m, u, t: 0, o: d, dead: -1, r: d.r, len: d.r, gen: 0, add }; }
    const R = rec, u = R.u, m = R.m; R.gen++; R.t = 0; R.o = d; R.dead = -1; R.r = d.r; R.len = d.len ?? d.r; m.visible = true; m.rotation.set(0, 0, 0);
    u.uSeed.value = Math.random() * 40; u.uAngle.value = d.angle ?? 0.5; u.uKind.value = KIND[d.kind]; u.uLift.value = d.lift ?? 0.07; u.uDis.value = 0; (u.uA.value as THREE.Color).set(d.color ?? 0xffffff); (u.uB.value as THREE.Color).set(d.color2 ?? d.color ?? 0xffffff);
    decals.push(R); const gen = R.gen, mine = () => R.gen === gen && R.m.visible;
    const place = (x: number, z: number, yaw?: number) => { if (!mine()) return; m.position.set(x, ground(x, z) + (d.lift ?? 0.07), z); if (yaw !== undefined) m.rotation.y = yaw; };
    place(d.x, d.z, d.yaw ?? 0); tickDecal(R, 0);
    return { set: place, kill(fade = 0.25) { if (mine() && R.dead < 0) { R.dead = fade; R.o = { ...R.o, life: R.t + fade, fadeOut: fade / (R.t + fade) }; } }, size(r, len) { if (!mine()) return; R.r = r; if (len !== undefined) R.len = len; }, alive: () => mine() && decals.includes(R), alpha(a) { if (mine()) R.o = { ...R.o, alpha: a }; } };
  }
  function tickDecal(d: DecalRec, dt: number) {
    d.t += dt; const k = Math.min(1, d.t / d.o.life), fi = d.o.fadeIn ?? 0.08, fo = d.o.fadeOut ?? 0.3; d.u.uK.value = k;
    const out = Math.min(1, (1 - k) / Math.max(1e-4, fo)), eat = d.o.kind === "scorch" || d.o.kind === "crack" || d.o.kind === "water" || d.o.kind === "fire" || d.o.kind === "wax" || d.o.kind === "dark";
    d.u.uDis.value = d.o.life > 1e8 || !eat ? 0 : 1 - out;      // 地上留的印记：淡出的那一段一边蚀一边淡
    d.u.uAlpha.value = d.o.life > 1e8 ? d.o.alpha ?? 1 : (d.o.alpha ?? 1) * Math.min(1, k / Math.max(1e-4, fi)) * (eat ? Math.sqrt(out) : out);      // 寿命写得极长的（施法指示）一直是满的，不淡入淡出
    const g = d.o.from !== undefined ? d.o.from + (1 - d.o.from) * (1 - Math.pow(1 - k, 2.4)) : 1;
    if (d.o.kind === "rect") d.m.scale.set(d.r, 1, d.len / 2); else d.m.scale.set(d.r * g, 1, d.r * g);
    if (d.o.spin) d.m.rotation.y += d.o.spin * dt;
    return d.t < d.o.life;
  }

  // ---------------------------------------------------------------- 柱
  // 柱、光带、闪光都用池子（第九轮）：用完藏起来，下次直接拿来改参数，不每次新建材质
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 28, 1, true); cyl.translate(0, 0.5, 0);
  type ColRec = { m: THREE.Mesh; u: Record<string, { value: any }>; t: number; life: number; water: boolean };
  const cols_: ColRec[] = [], colFree: ColRec[][] = [[], []];
  function column(c: { x: number; z: number; r: number; h: number; life: number; color?: number; color2?: number; kind?: "fire" | "light" | "water"; y?: number }) {
    const water = c.kind === "water"; let rec = colFree[water ? 1 : 0].pop();
    if (!rec) { const u = { uTime: clock, uK: { value: 0 }, uA: { value: new THREE.Color() }, uB: { value: new THREE.Color() }, uKind: { value: 0 }, uSeed: { value: 0 } };
      const m = new THREE.Mesh(cyl, new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false, side: THREE.DoubleSide, ...(water ? { blending: THREE.NormalBlending } : FXB.on ? PREMUL : { blending: THREE.AdditiveBlending }),
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `uniform float uTime, uK, uSeed; uniform int uKind; uniform vec3 uA, uB; varying vec2 vUv; ${NOISE} ${!water && FXB.on ? BOUT : ""}
          void main() { float y = vUv.y, n = fbm(vec2(vUv.x * 9.0 + uSeed, y * 3.0 - uTime * (uKind == 1 ? 0.6 : 2.6))); float rise = smoothstep(0.0, 0.25, uK), fall = 1.0 - smoothstep(0.55, 1.0, uK), a;
            if (uKind == 1) { float streak = smoothstep(0.55, 0.9, vn(vec2(vUv.x * 24.0 + uSeed, y * 1.5 - uTime * 2.2)));      // 光柱：底下亮、往上散，里面几道往上走的细光丝
              a = (0.28 + 0.32 * n + 0.45 * streak) * pow(1.0 - y, 1.5) * smoothstep(0.0, 0.06, y) * (1.0 - smoothstep(rise * 1.05, rise * 1.05 + 0.05, y)); }
            else a = smoothstep(0.3 + y * 0.45, 0.75, n + (1.0 - y) * 0.35) * (1.0 - smoothstep(rise * 0.9, rise, y)) * smoothstep(0.0, 0.05, y);
            a *= fall; if (a < 0.004) discard; vec3 col = mix(uB, uA, clamp(n * 1.3 - y * 0.5 + 0.2, 0.0, 1.0)); col = mix(col, vec3(1.0), (1.0 - smoothstep(0.0, 0.25, uK)) * (1.0 - y) * 0.35); ${!water && FXB.on ? "gl_FragColor = bOut_(col, a);" : `gl_FragColor = vec4(col ${water ? ", a * 0.75" : "* a, a"});
          #include <colorspace_fragment>`}
          }` }));
      m.renderOrder = 7; m.frustumCulled = false; group.add(m); rec = { m, u, t: 0, life: 1, water }; }
    const R = rec; R.t = 0; R.life = c.life; R.u.uK.value = 0; (R.u.uA.value as THREE.Color).set(c.color ?? 0xffffff); (R.u.uB.value as THREE.Color).set(c.color2 ?? c.color ?? 0xffffff); R.u.uKind.value = c.kind === "light" ? 1 : water ? 2 : 0; R.u.uSeed.value = Math.random() * 30;
    R.m.position.set(c.x, c.y ?? ground(c.x, c.z), c.z); R.m.scale.set(c.r, c.h, c.r); R.m.visible = true; cols_.push(R);
  }

  // ---------------------------------------------------------------- 光带
  // 中间一道发白的细芯，两边是主色（第九轮：原来只有一层主色，看起来像一根塑料管）
  type BeamRec = { m: THREE.Mesh; g: THREE.BufferGeometry; u: Record<string, { value: any }>; live: boolean; t: number; life: number; add: boolean; gen: number };
  const beams: BeamRec[] = [], beamFree: BeamRec[][] = [[], []];
  function beam(bo: { color?: number; width?: number; add?: boolean; life?: number }): Beam {
    const add = bo.add !== false; let rec = beamFree[add ? 1 : 0].pop();
    if (!rec) { const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(8 * 3), 3)); g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 1, 0, 1, 1, 0, 0, 0, 1, 1, 0, 1, 1]), 2)); g.setIndex([0, 1, 2, 2, 1, 3, 4, 5, 6, 6, 5, 7]);
      const u = { uTime: clock, uA: { value: new THREE.Color() }, uAlpha: { value: 1 } };
      const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, ...(add && FXB.on ? PREMUL : { blending: add ? THREE.AdditiveBlending : THREE.NormalBlending }), uniforms: u,
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `uniform float uTime, uAlpha; uniform vec3 uA; varying vec2 vUv; ${NOISE} ${add && FXB.on ? BOUT : ""}
          void main(){ float c = 1.0 - abs(vUv.y - 0.5) * 2.0, n = vn(vec2(vUv.x * 14.0 - uTime * 9.0, 3.0)); float a = (pow(c, 3.0) + pow(c, 0.8) * 0.25 * n) * uAlpha * smoothstep(0.0, 0.04, vUv.x) * smoothstep(1.0, 0.96, vUv.x); if (a < 0.004) discard;
            vec3 col = mix(uA, vec3(1.0), pow(c, 10.0) * 0.75); ${add && FXB.on ? "gl_FragColor = bOut_(col, a);" : `gl_FragColor = vec4(col * a, a);
          #include <colorspace_fragment>`}
          }` });
      const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.renderOrder = 9; group.add(m); rec = { m, g, u, live: true, t: 0, life: 1e9, add, gen: 0 }; }
    const R = rec; R.gen++; R.live = true; R.t = 0; R.life = bo.life ?? 1e9; R.u.uAlpha.value = 1; (R.u.uA.value as THREE.Color).set(FXB.on && add ? deep(bo.color ?? 0xffffff, 0.5, 0.75) : bo.color ?? 0xffffff); R.m.visible = true; beams.push(R);      /* 换画风 B：身子用同色系深一档（亮地面上浅色的光带看不见），白芯照旧 */
    let w = bo.width ?? 0.2; const gen = R.gen, g = R.g;
    const a_ = new THREE.Vector3(), b_ = new THREE.Vector3(), d_ = new THREE.Vector3(), s1 = new THREE.Vector3(), s2 = new THREE.Vector3();
    return { width(x) { w = x; }, kill() { if (R.gen === gen) R.live = false; },
      set(a, b) { if (R.gen !== gen) return; a_.set(a.x, a.y, a.z); b_.set(b.x, b.y, b.z); d_.subVectors(b_, a_).normalize(); s1.crossVectors(d_, Math.abs(d_.y) > 0.95 ? ay.set(1, 0, 0) : UP).normalize().multiplyScalar(w / 2); s2.crossVectors(d_, s1).normalize().multiplyScalar(w / 2);
        const p = g.getAttribute("position") as THREE.BufferAttribute; let k = 0; for (const s of [s1, s2]) { p.setXYZ(k++, a_.x + s.x, a_.y + s.y, a_.z + s.z); p.setXYZ(k++, a_.x - s.x, a_.y - s.y, a_.z - s.z); p.setXYZ(k++, b_.x + s.x, b_.y + s.y, b_.z + s.z); p.setXYZ(k++, b_.x - s.x, b_.y - s.y, b_.z - s.z); } p.needsUpdate = true; } };
  }

  // ---------------------------------------------------------------- 闪光、镜头抖、残影、顿帧
  const lamps = (LITE ? [0] : [0, 1]).map(() => { const l = new THREE.PointLight(0xffffff, 0, 11, 2); group.add(l); return { l, t: 0, dur: 0, power: 0 }; });      // 手机档只有一盏
  const softTex = (() => { const cv = document.createElement("canvas"); cv.width = cv.height = 64; const c = cv.getContext("2d")!, g = c.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.3, "rgba(255,255,255,0.5)"); g.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = g; c.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const flashes: { s: THREE.Sprite; t: number; dur: number; size: number }[] = [], flashFree: THREE.Sprite[] = [];
  /** 一下闪光：一团柔光（主色）、中间一颗很小很亮的白芯（四芒星），加一盏很短的点光。亮的面积小、时间短（第九轮：原来只有一团主色的光晕，糊） */
  function flash(pos: V3, color = 0xffffff, size = 3, dur = 0.22, light = true) {
    const s = flashFree.pop() ?? (() => { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: softTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); sp.renderOrder = 10; group.add(sp); return sp; })();
    s.material.color.set(color); s.position.set(pos.x, pos.y, pos.z); s.visible = true; flashes.push({ s, t: 0, dur, size: size * 0.85 * (FXB.on ? FXB.flash : 1) });      /* 换画风 B：亮地面上叠加的柔光就是一块白斑，收小（白芯那颗四芒星不动） */
    if (size >= 1.2) burst({ pos, n: 1, sprite: SPR.glint, add: true, color: 0xffffff, size: Math.min(2.6, size * 0.5), grow: 1.5, life: Math.min(0.2, dur * 0.8), speed: 0, alpha: 0.95 });
    if (light && lamps.length) { const L = lamps.reduce((a, b) => (a.t / (a.dur || 1) > b.t / (b.dur || 1) ? a : b)); L.l.position.set(pos.x, pos.y + 0.6, pos.z); L.l.color.set(color); L.t = 0; L.dur = dur * 1.6; L.power = size * 5 * (FXB.on ? FXB.lamp : 1); }      /* 换画风 B：点光照在亮地面上一下就过曝成一块白 */
  }
  let shakeAmp = 0, shakeT = 0, shakeDur = 0, stopLeft = 0;
  // iti-fx3：镜头抖改成按真实时间走。原来 shakeT 和抖动的相位都跟着对局时间（update 的 dt），顿帧时世界乘 0.06，镜头也跟着几乎不抖了——
  // “停住 + 抖”是打击感里最要紧的一拍（王者、格斗游戏都是人停住、镜头在抖）。现在主循环每帧问 timeScale(真实 dt) 时顺手推抖动的时钟；
  // 没人问 timeScale 的页面（调试页只调 update）照旧跟着 update 的 dt 走。这一处会影响所有英雄：凡是“顿帧 + 镜头抖”一起用的技能，抖动不再被顿帧拉长、停住的那一下能看到抖。
  let shakeClock = 0, realFed = false;
  const shake = (amp: number, dur = 0.25) => { if (amp >= shakeAmp * (1 - shakeT / (shakeDur || 1))) { shakeAmp = amp; shakeT = 0; shakeDur = dur; } };
  const shakeOffset = (out: THREE.Vector3) => { const k = shakeDur > 0 && shakeT < shakeDur ? shakeAmp * Math.pow(1 - shakeT / shakeDur, 2) : 0; return out.set(Math.sin(shakeClock * 61) * k, Math.sin(shakeClock * 83 + 1.3) * k * 0.7, Math.cos(shakeClock * 71) * k); };
  const ghosts: { o: THREE.Object3D; mat: THREE.MeshBasicMaterial; t: number; life: number; a: number }[] = [];
  function ghost(model: THREE.Object3D, color = 0x9af7ee, life = 0.4, opacity = 0.5) {
    model.updateWorldMatrix(true, true); const c = SkeletonUtils.clone(model), mat = FXB.on ? new THREE.MeshBasicMaterial({ color: deep(color, 0.5, 0.75), transparent: true, opacity: opacity * 0.8 * FXB.ghost, depthWrite: false })      /* 换画风 B：叠加的残影在亮地面上是一团白；改成有颜色的半透明剪影 */
      : new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
    c.traverse(n => { const m = n as THREE.Mesh; if (m.isMesh) { m.material = mat; m.castShadow = false; m.receiveShadow = false; m.frustumCulled = false; m.renderOrder = 7; } });
    const holder = new THREE.Group(); if (model.parent) model.parent.matrixWorld.decompose(holder.position, holder.quaternion, holder.scale); holder.add(c); group.add(holder); ghosts.push({ o: holder, mat, t: 0, life, a: mat.opacity });
  }

  // ---------------------------------------------------------------- 刀光（第九轮新加）
  // 一道月牙形的带子，在 sweep 秒里从一头扫到另一头：扫过的地方留一截尾巴，外沿最亮、往里淡；扫完以后整道一边变细一边淡掉。
  // 平放在地面上方（俯视镜头下看得最清楚），可以绕前进方向侧倾（tilt），斜劈、上挑都用它。用池子，二十道够全场用。
  const slashGeo = (() => { const S = 28, pos: number[] = [], uv: number[] = [], idx: number[] = []; for (let i = 0; i <= S; i++) { const t = i / S; for (let j = 0; j < 3; j++) { pos.push(t, j / 2, 0); uv.push(t, j / 2); } if (i < S) { const k = i * 3; idx.push(k, k + 3, k + 1, k + 1, k + 3, k + 4, k + 1, k + 4, k + 2, k + 2, k + 4, k + 5); } }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); return g; })();
  type SlashRec = { m: THREE.Mesh; u: Record<string, { value: any }>; t: number; life: number; sweep: number };
  const slashes: SlashRec[] = [], slashFree: SlashRec[] = [];
  function slash(so: { pos: V3; yaw: number; r?: number; width?: number; arc?: number; tilt?: number; color?: number; color2?: number; life?: number; sweep?: number; flip?: boolean; alpha?: number }) {
    let rec = slashFree.pop();
    if (!rec) { const u = { uHead: { value: 0 }, uAlpha: { value: 1 }, uA: { value: new THREE.Color() }, uB: { value: new THREE.Color() }, uArc: { value: 2 }, uR: { value: 1 }, uW: { value: 0.3 }, uFlip: { value: 0 } };
      const m = new THREE.Mesh(slashGeo, new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false, side: THREE.DoubleSide, ...(FXB.on ? PREMUL : { blending: THREE.AdditiveBlending }),
        vertexShader: /* glsl */ `uniform float uArc, uR, uW, uFlip, uHead; varying vec2 vUv;
          void main(){ vUv = uv; float th = (position.x - 0.5) * uArc * (uFlip > 0.5 ? -1.0 : 1.0), t = uFlip > 0.5 ? 1.0 - position.x : position.x;
            float thin = 1.0 - 0.6 * smoothstep(1.0, 1.6, uHead), w = uW * thin * pow(max(0.0, sin(3.14159 * clamp(t, 0.0, 1.0))), 0.45), rr = uR * (1.0 - w * (1.0 - position.y));      // 两头尖、中间宽；扫完以后变细
            gl_Position = projectionMatrix * modelViewMatrix * vec4(sin(th) * rr, 0.0, cos(th) * rr, 1.0); }`,
        fragmentShader: /* glsl */ `uniform float uHead, uAlpha; uniform vec3 uA, uB; varying vec2 vUv; ${FXB.on ? BOUT : ""}
          void main(){ float u = vUv.x, v = vUv.y; if (u > uHead) discard;
            float tail = smoothstep(uHead - 0.8, uHead, u), e = pow(v, 2.6), hot = exp(-(uHead - u) * 7.0) * (1.0 - smoothstep(1.0, 1.25, uHead));
            vec3 col = mix(uB, uA, e); col = mix(col, vec3(1.0), clamp(hot * e * 0.75 + pow(v, 12.0) * 0.35, 0.0, 1.0));
            float a = tail * (0.18 + 0.82 * e) * smoothstep(0.0, 0.08, u) * uAlpha; if (a < 0.004) discard; ${FXB.on ? "gl_FragColor = bOut_(col, a);" : `gl_FragColor = vec4(col * a, a);
          #include <colorspace_fragment>`}
          }` }));
      m.frustumCulled = false; m.renderOrder = 9; m.rotation.order = "YXZ"; group.add(m); rec = { m, u, t: 0, life: 1, sweep: 0.1 }; }
    const R = rec, life = so.life ?? 0.26; R.t = 0; R.life = life; R.sweep = so.sweep ?? life * 0.42;
    R.u.uHead.value = 0; R.u.uAlpha.value = so.alpha ?? 1; (R.u.uA.value as THREE.Color).set(so.color ?? 0xffffff); (R.u.uB.value as THREE.Color).set(FXB.on ? deep(so.color2 ?? so.color ?? 0xffffff, 0.45, 0.7) : so.color2 ?? so.color ?? 0xffffff); R.u.uArc.value = so.arc ?? 2.2; R.u.uR.value = so.r ?? 1.6; R.u.uW.value = so.width ?? 0.32; R.u.uFlip.value = so.flip ? 1 : 0;
    R.m.position.set(so.pos.x, so.pos.y, so.pos.z); R.m.rotation.set(0, so.yaw, so.tilt ?? 0); R.m.visible = true; slashes.push(R);
  }

  // ---------------------------------------------------------------- 拖尾（第九轮新加）
  // 弹道、冲刺后面拖的一条带子：记下最近一段路上的点，在显卡里把每一段转成正对镜头的宽度，头上宽、往后收尖、越旧越淡，中间一道发白的芯。
  const TN = 24;
  type TrailRec = { m: THREE.Mesh; g: THREE.BufferGeometry; u: Record<string, { value: any }>; pts: { x: number; y: number; z: number; t: number }[]; life: number; live: boolean; gen: number; minStep: number };
  const trails: TrailRec[] = [], trailFree: TrailRec[] = [];
  function trail(to: { color?: number; color2?: number; width?: number; life?: number; alpha?: number; step?: number }): { at: (x: number, y: number, z: number) => void; stop: () => void } {
    let rec = trailFree.pop();
    if (!rec) { const g = new THREE.BufferGeometry(), idx: number[] = []; g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TN * 2 * 3), 3)); g.setAttribute("aTan", new THREE.BufferAttribute(new Float32Array(TN * 2 * 3), 3)); g.setAttribute("aSK", new THREE.BufferAttribute(new Float32Array(TN * 2 * 2), 2));
      for (let i = 0; i < TN - 1; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); } g.setIndex(idx);
      const u = { uA: { value: new THREE.Color() }, uB: { value: new THREE.Color() }, uW: { value: 0.3 }, uAlpha: { value: 1 } };
      const m = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false, side: THREE.DoubleSide, ...(FXB.on ? PREMUL : { blending: THREE.AdditiveBlending }),
        vertexShader: /* glsl */ `attribute vec3 aTan; attribute vec2 aSK; uniform float uW; varying vec2 vSK;
          void main(){ vSK = aSK; vec4 mv = modelViewMatrix * vec4(position, 1.0); vec3 tv = (modelViewMatrix * vec4(aTan, 0.0)).xyz; vec3 sd = cross(tv, mv.xyz); float l = length(sd); sd = l > 1e-5 ? sd / l : vec3(0.0, 1.0, 0.0);
            mv.xyz += sd * aSK.x * uW * pow(max(0.0, 1.0 - aSK.y), 0.8); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: /* glsl */ `uniform vec3 uA, uB; uniform float uAlpha; varying vec2 vSK; ${FXB.on ? BOUT : ""}
          void main(){ float p = 1.0 - abs(vSK.x), k = clamp(vSK.y, 0.0, 1.0), a = pow(p, 1.4) * pow(1.0 - k, 1.5) * uAlpha; if (a < 0.004) discard;
            vec3 col = mix(uB, uA, 1.0 - k); col = mix(col, vec3(1.0), pow(p, 5.0) * (1.0 - k) * 0.65); ${FXB.on ? "gl_FragColor = bOut_(col, a);" : `gl_FragColor = vec4(col * a, a);
          #include <colorspace_fragment>`}
          }` }));
      m.frustumCulled = false; m.renderOrder = 9; group.add(m); rec = { m, g, u, pts: [], life: 0.2, live: true, gen: 0, minStep: 0.05 }; }
    const R = rec; R.gen++; R.pts.length = 0; R.life = to.life ?? 0.2; R.live = true; R.minStep = to.step ?? 0.05; R.u.uW.value = (to.width ?? 0.3) / 2; R.u.uAlpha.value = to.alpha ?? 1; (R.u.uA.value as THREE.Color).set(to.color ?? 0xffffff); (R.u.uB.value as THREE.Color).set(FXB.on ? deep(to.color2 ?? to.color ?? 0xffffff, 0.45, 0.7) : to.color2 ?? to.color ?? 0xffffff); R.m.visible = false; trails.push(R);      /* 换画风 B：尾巴（身子）用同色系深一档 */
    const gen = R.gen;
    return { at(x, y, z) { if (R.gen !== gen || !R.live) return; const p0 = R.pts[0]; if (p0 && Math.hypot(x - p0.x, y - p0.y, z - p0.z) < R.minStep) { p0.x = x; p0.y = y; p0.z = z; return; } R.pts.unshift({ x, y, z, t: clock.value }); if (R.pts.length > TN) R.pts.pop(); },
      stop() { if (R.gen === gen) R.live = false; } };
  }
  function tickTrail(R: TrailRec) {
    const now = clock.value; while (R.pts.length && now - R.pts[R.pts.length - 1].t > R.life) R.pts.pop();
    const n = R.pts.length; if (n < 2) { R.m.visible = false; return R.live; } R.m.visible = true;
    const P = R.g.getAttribute("position") as THREE.BufferAttribute, T = R.g.getAttribute("aTan") as THREE.BufferAttribute, K = R.g.getAttribute("aSK") as THREE.BufferAttribute;
    for (let i = 0; i < n; i++) { const p = R.pts[i], a = R.pts[Math.max(0, i - 1)], b = R.pts[Math.min(n - 1, i + 1)], k = Math.min(1, Math.max(i / (n - 1) * 0.35, (now - p.t) / R.life));
      for (let s = 0; s < 2; s++) { const j = i * 2 + s; P.setXYZ(j, p.x, p.y, p.z); T.setXYZ(j, a.x - b.x, a.y - b.y, a.z - b.z); K.setXY(j, s ? 1 : -1, k); } }
    P.needsUpdate = T.needsUpdate = K.needsUpdate = true; R.g.setDrawRange(0, (n - 1) * 6); return true;
  }

  /** 命中（第九轮新加）：一颗很小很短的白芯、顺着打过来的方向溅出几道火花；big 再加地上一圈冲击和一点烟。
   *  所有技能和普攻的“打中了”都可以用这一个，颜色给主色，亮芯自己是白的。
   *  第九轮 polish-lib：去掉了原来那圈正对镜头的白环（粒子图集里的 ring：每个目标身上一个一模一样、永远是正圆的白圈，从哪个角度看都一样，像界面图标，
   *  一个技能打中五个人就是五个一样的圈，廉价）。现在小伤害只剩一点白芯和几道带方向的火花（LoL 普攻打中的路子），柔光也小一圈、短一半；
   *  big 的那圈冲击改成贴在地上的（跟着地面有透视），用主色、压一半亮度 */
  function impact(pos: V3, io: { color?: number; color2?: number; size?: number; big?: boolean; dir?: V3; sparks?: number } = {}) {
    const col = io.color ?? 0xffffff, c2 = io.color2 ?? col, s = io.size ?? 1, big = !!io.big;
    flash(pos, col, (big ? 1.6 : 1.05) * s, big ? 0.12 : 0.09, big);
    burst({ pos, n: 1, sprite: SPR.glint, add: true, color: [0xffffff, col], size: (big ? 1.05 : 0.85) * s, grow: 1.3, life: big ? 0.12 : 0.1, speed: 0, alpha: 0.95 });      // 白芯：四芒的一小颗，一闪就没（打中的那一下最亮的就是它，比原来的白环小得多）
    burst({ pos, n: io.sparks ?? (big ? 9 : 5), sprite: SPR.streak, add: true, color: [0xffffff, c2], size: [0.1 * s, 0.17 * s], life: [0.12, big ? 0.28 : 0.2], speed: [5 * s, (big ? 12 : 8.5) * s], dir: io.dir, spread: io.dir ? 0.85 : 3.14, gravity: 9, drag: 2.5, stretch: 1.3 });
    if (big) { burst({ pos, n: 3, sprite: SPR.smoke, color: [0x9a9590, 0x5a5652], alpha: [0.16, 0.24], size: [0.6 * s, 0.9 * s], grow: 2, life: [0.4, 0.6], speed: [0.4, 1.2], up: 0.6 });
      decal({ kind: "shock", x: pos.x, z: pos.z, r: 1.45 * s, life: 0.3, color: col, alpha: 0.55, from: 0.2, fadeIn: 0.05, fadeOut: 0.65, add: true }); }
  }
  /** 顿帧：大招打中英雄那一下整个对局停一小会儿（主循环每帧问 timeScale），sec 一般 0.05～0.08 */
  const hitstop = (sec: number) => { stopLeft = Math.max(stopLeft, sec); };
  const timeScale = (realDt: number) => { realFed = true; shakeClock += realDt; if (shakeT < shakeDur) shakeT += realDt; if (stopLeft <= 0) return 1; stopLeft -= realDt; return 0.06; };
  // iti-fx3 新加：只用点光，不出柔光团（见接口上的说明）
  function lamp(pos: V3, color = 0xffffff, power = 12, dur = 0.3) { if (!lamps.length) return; const L = lamps.reduce((a, b) => (a.t / (a.dur || 1) > b.t / (b.dur || 1) ? a : b)); L.l.position.set(pos.x, pos.y, pos.z); L.l.color.set(color); L.t = 0; L.dur = dur; L.power = power * (FXB.on ? FXB.lamp : 1); }
  const ticks: ((dt: number) => void)[] = [], tick = (fn: (dt: number) => void) => { ticks.push(fn); };

  // ---------------------------------------------------------------- 弹体的小模型
  function proj(kind: "bolt" | "orb" | "flask" | "shard", color = 0xffffff, size = 1): Handle {
    let obj: THREE.Object3D;
    if (kind === "bolt") { const g = new THREE.Group(), shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 6), new THREE.MeshStandardMaterial({ color: 0x3a2c22, roughness: 0.8 })), head = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.24, 6), new THREE.MeshStandardMaterial({ color: 0x9a9a98, roughness: 0.4, metalness: 0.6, emissive: color, emissiveIntensity: 0.6 }));
      shaft.rotation.x = Math.PI / 2; head.rotation.x = Math.PI / 2; head.position.z = 0.55; g.add(shaft, head); obj = g; }
    else if (kind === "orb") { obj = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 10), new THREE.MeshBasicMaterial({ color })); }
    else if (kind === "flask") { const g = new THREE.Group(), body = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshStandardMaterial({ color: 0x5a3a26, roughness: 0.7 })), neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.16, 8), new THREE.MeshStandardMaterial({ color: 0x2b2420, emissive: color, emissiveIntensity: 0.8 })); neck.position.y = 0.22; g.add(body, neck); obj = g; }
    else { obj = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), new THREE.MeshStandardMaterial({ color, roughness: 0.3, emissive: color, emissiveIntensity: 0.5, flatShading: true })); }
    obj.scale.setScalar(size); group.add(obj);
    return { obj, kill() { group.remove(obj); obj.traverse(n => { const m = n as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } }); } };
  }

  // ---------------------------------------------------------------- 施法指示
  function indicator(kind: "circle" | "line" | "cone" | "spot", color = 0xbff5ee): Indicator {
    const dk: DecalKind = kind === "line" ? "rect" : kind === "cone" ? "cone" : "disc";
    decal({ kind: dk, x: 0, z: 0, r: 1, life: 1e9, color, alpha: kind === "spot" ? 0.9 : 0.6, fadeIn: 0, fadeOut: 0, lift: 0.09 }); const rec = decals[decals.length - 1]; rec.m.visible = false; let len = 1, yaw_ = 0;
    (rec.m.material as THREE.Material).userData.fowKeep = true;      // 施法指示是玩家自己在瞄：瞄进迷雾里也要画（fow.ts 藏迷雾里的特效时跳过它）
    return { show(on) { rec.m.visible = on; },
      set(x, z, yaw) { if (yaw !== undefined) yaw_ = yaw; if (kind === "line") { rec.m.position.set(x + Math.sin(yaw_) * len / 2, ground(x, z) + 0.09, z + Math.cos(yaw_) * len / 2); rec.m.rotation.y = yaw_; } else { rec.m.position.set(x, ground(x, z) + 0.09, z); rec.m.rotation.y = yaw_; } },
      size(r, l, angle) { rec.r = r; if (l !== undefined) { len = l; rec.len = l; } if (angle !== undefined) rec.u.uAngle.value = angle; },
      color(c) { (rec.u.uA.value as THREE.Color).set(c); } };
  }

  function update(dt: number) {
    clock.value += dt;
    for (const P of pools) if (P.dirty) { for (const a of Object.values(P.A)) a.needsUpdate = true; P.dirty = false; }
    for (let i = emitters.length - 1; i >= 0; i--) { const e = emitters[i]; if (!e.live) { emitters.splice(i, 1); continue; } e.acc += e.h.rate * dt * (LITE ? 0.5 : 1); const n = Math.floor(e.acc); if (n > 0) { e.acc -= n; burst({ ...e.o, n: LITE ? n * 2 : n }); } }      // 手机档喷得少一半（burst 里还会再减半，所以这里先乘回去）
    for (let i = decals.length - 1; i >= 0; i--) if (!tickDecal(decals[i], dt)) { const d = decals[i]; d.m.visible = false; d.gen++; decals.splice(i, 1); decalFree[d.add ? 1 : 0].push(d); }
    for (let i = cols_.length - 1; i >= 0; i--) { const c = cols_[i]; c.t += dt; c.u.uK.value = Math.min(1, c.t / c.life); if (c.t >= c.life) { c.m.visible = false; cols_.splice(i, 1); colFree[c.water ? 1 : 0].push(c); } }
    for (let i = beams.length - 1; i >= 0; i--) { const b = beams[i]; b.t += dt; const u = b.u.uAlpha; if (!b.live || b.t > b.life) { u.value -= dt * 6; if (u.value <= 0) { b.m.visible = false; b.gen++; beams.splice(i, 1); beamFree[b.add ? 1 : 0].push(b); } } }
    for (let i = flashes.length - 1; i >= 0; i--) { const f = flashes[i]; f.t += dt; const k = f.t / f.dur; if (k >= 1) { f.s.visible = false; flashFree.push(f.s); flashes.splice(i, 1); continue; } f.s.scale.setScalar(f.size * (0.45 + 0.9 * k)); f.s.material.opacity = (1 - k) * (1 - k); }
    for (let i = slashes.length - 1; i >= 0; i--) { const s = slashes[i]; s.t += dt; const h = s.t / s.sweep; s.u.uHead.value = Math.min(1.6, h * 1.0); const fade = (s.t - s.sweep) / Math.max(1e-3, s.life - s.sweep); if (fade >= 1) { s.m.visible = false; slashes.splice(i, 1); slashFree.push(s); continue; } if (fade > 0) s.u.uHead.value = 1 + fade * 0.6; }
    for (let i = trails.length - 1; i >= 0; i--) { const r = trails[i]; if (!tickTrail(r) && !r.live) { r.m.visible = false; r.gen++; trails.splice(i, 1); trailFree.push(r); } }
    for (const L of lamps) { if (L.dur > 0) { L.t += dt; const k = L.t / L.dur; L.l.intensity = k >= 1 ? 0 : L.power * (1 - k) * (1 - k); if (k >= 1) L.dur = 0; } }
    for (let i = ghosts.length - 1; i >= 0; i--) { const g = ghosts[i]; g.t += dt; if (g.t >= g.life) { group.remove(g.o); g.mat.dispose(); ghosts.splice(i, 1); continue; } g.mat.opacity = g.a * Math.pow(1 - g.t / g.life, 1.5); }
    if (!realFed) { shakeClock += dt; if (shakeT < shakeDur) shakeT += dt; } realFed = false;      // 主循环问过 timeScale 的话，抖动的时钟已经按真实时间推过了
    for (const f of ticks) f(dt);
  }
  const ring = (x: number, z: number, r: number, color = 0xffffff, life = 0.45, add = true) => { decal({ kind: "shock", x, z, r, life, color, from: 0.15, fadeIn: 0.05, fadeOut: 0.6, add }); };
  const warm = (x: number, z: number) => { const p = { x, y: ground(x, z) - 30, z };
    decal({ kind: "disc", x, z, r: 0.01, life: 0.2, alpha: 0 }); decal({ kind: "shock", x, z, r: 0.01, life: 0.2, alpha: 0, add: true });
    for (const k of ["fire", "light", "water"] as const) column({ x, z, r: 0.01, h: 0.01, life: 0.2, kind: k, y: p.y });
    const b = beam({ life: 0.2 }); b.set(p, { x: p.x, y: p.y + 0.01, z: p.z }); flash(p, 0xffffff, 0.01, 0.2, false);
    slash({ pos: p, yaw: 0, r: 0.01, life: 0.2 }); const tr = trail({}); tr.at(p.x, p.y, p.z); tr.at(p.x, p.y + 1, p.z); tr.stop();
    burst({ pos: p, n: 1, size: 0.001, life: 0.2 }); burst({ pos: p, n: 1, size: 0.001, life: 0.2, add: true }); };
  return { group, update, time: () => clock.value, burst, emitter, decal, ring, column, beam, flash, shake, shakeOffset, ghost, proj, indicator, ground, warm, slash, trail, impact, hitstop, timeScale, tick, lamp, terr: o.terrain ? terr : undefined };
}
