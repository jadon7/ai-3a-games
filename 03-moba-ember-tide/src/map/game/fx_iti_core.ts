// 伊缇 · 绯刃 全部技能特效的实现（第四阶段 iti-fx3）。fx_iti.ts 的 ITI_FX 就是这里的 ITI_FX_CORE；试验页（lab/fx_iti/）也直接调这里。
//
// 这一轮的路子（看了黄泉、星见雅、椿、雷电将军、李白、镜、永恩、劫、梅喧以后定的，见 docs/hero_iti/fx3/参照.md）：
//   · 亮不是靠特效自己多亮，是靠周围暗：大招整段把世界压成绯黑，只留人和刀光；平时的重击很短地暗一下。
//   · 节奏四拍：蓄 → 斩（一两帧）→ 停 → 爆。停的那一拍世界定住，屏幕上的东西（打击帧、镜头抖、推镜头）照样在动。
//   · 斩击是又直又长的线：命中那一下又粗又白（俯视镜头下白最亮），马上收成一根细的绯线留在空中；线多了就是网；收刀以后一起爆。
//   · 一个主色（绯）+ 白热的芯 + 一点赤金（火花、白到红中间那道暖边），没有别的颜色。地上的痕迹是“灼热的裂缝冷成暗褐的焦痕”，不留血红。
//   · 屏幕级的（压暗、切入、打击帧、推镜头、顿帧、镜头抖）只给“玩家屏幕里看得见的那一次”：不在画面里、或者在迷雾里的，只放世界里的特效（调度第二步定的）。
// 技能代码不用管这些，只在时机点调函数。
import * as THREE from "three";
import type { Ent } from "./sim";
import type { ItiCtx, P2, EchoFx, FieldFx } from "./fx_iti";
import type { ScreenFx } from "./fx_iti_screen";
import { FOG, type FxLib } from "./fxlib";
import { LITE } from "../quality";
import { BLOOM, CHARGE, Kit, MarkIcon, loadTex, vec, type FxHandle, type GhostSlot, type V3 } from "./fx_iti_kit";
import { itiSfx } from "./sfx";

// ---------------------------------------------------------------- 环境
const KITS = new WeakMap<FxLib, Kit>();
/** 这个对局的伊缇特效零件库（第一次用的时候建：挂在通用特效库的组下面，迷雾照样管；时间跟着对局走；登记泛光） */
export function kitOf(c: ItiCtx): Kit {
  let K = KITS.get(c.fx);
  if (!K) { K = new Kit({ parent: c.fx.group, lite: LITE, ground: c.api.ground, terr: c.fx.terr }); KITS.set(c.fx, K); const k = K, S = c.fx.screen, base = LITE ? 0.8 : 0.62;
    // 光晕跟着“世界现在多暗”走：大招压暗的时候光晕给足；亮地面上只留两三成——亮地面上的红色柔光就是一团粉，形状反而糊了
    c.fx.tick(dt => { k.update(dt); BLOOM.value = base * (0.22 + 0.78 * (S ? S.dimK() : 0)); }); S?.glow(K.group, () => k.busy(), () => 0.3 + 0.7 * S.dimK());
    for (const n of ["rune", "crack", "bloom"]) loadTex(n);
    K.group.userData.itiStats = () => k.stats(); }      // 量帧率的脚本读它（特效自己的绘制次数、粒子数）
  return K;
}
const NOS = new Proxy({}, { get: () => () => 1 }) as ScreenFx;      // 不放屏幕演出的时候：所有调用都是空的（zoomK 回 1）
let cutinTex: THREE.Texture | null = null;
const cutin = () => (cutinTex ??= (() => { const t = new THREE.TextureLoader().load("/assets/fx/iti/cutin.webp"); t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = false; t.minFilter = t.magFilter = THREE.LinearFilter; return t; })());
/** 开局预热（主程序在载入时对每个伊缇调一次）：零件库、残影池、贴图、着色器都备好，对局里第一次放技能不卡。不调也行，第一次用时会自己建 */
export function warmIti(c: ItiCtx) { const K = kitOf(c); K.warm(c.a.hero.model, c.a.hero.group); cutin(); return K; }

const DARK = 0x2e0813;      // 压暗时世界乘成什么颜色：绯黑（第二步从 #4a1c2c 压深：原来乘出来偏粉红，现在暗处接近 #2a0610）
const HITC = 0xffdccf;      // 挨打整身一闪的颜色：白热偏暖（第二步从偏粉的 #ffc4c8 换过来）
const gy = (c: ItiCtx, p: P2) => c.api.ground(p.x, p.z);
/** 身高：英雄读模型的，别的按种类估（小兵 1.89 是放大 1.3 倍以后的近战兵） */
const hOf = (c: ItiCtx, e: Ent) => c.api.actor(e)?.hero.height ?? (e.kind === "hero" ? 3.2 : e.kind === "monster" ? 2.6 : e.kind === "tower" || e.kind === "core" ? 6 : e.big ? 2.4 : e.kind === "ranged" ? 1.78 : 1.89);
const chest = (c: ItiCtx, e: Ent, k = 0.5) => vec(e.x, gy(c, e) + Math.min(hOf(c, e), 4) * k, e.z);
const dirTo = (a: P2, b: P2) => { const d = vec(b.x - a.x, 0, b.z - a.z); if (d.lengthSq() < 1e-8) d.set(0, 0, 1); return d.normalize(); };
const yawOf = (d: V3) => Math.atan2(d.x, d.z);
const ghostsOf = (c: ItiCtx) => kitOf(c).ghosts(c.a.hero.model, c.a.hero.group, 12);
/** 这一下的屏幕级演出放不放：这个点在玩家的画面里，而且玩家这一队看得见（不在迷雾里）。没挂屏幕演出的页面一律不放 */
function loud(c: ItiCtx, p: P2): boolean {
  const S = c.fx.screen; if (!S) return false;
  if (!S.inView({ x: p.x, y: gy(c, p) + 1.2, z: p.z }, 0.1)) return false;
  return !FOG.sees || FOG.sees(p.x, p.z);
}
/** 一次调用里用的那几样“只给看得见的人”的东西：S 屏幕演出（不放就是空的）、stop 顿帧、shake 镜头抖 */
function live(c: ItiCtx, p: P2, on = loud(c, p)) {
  return { on, S: on ? c.fx.screen! : NOS, stop: (sec: number) => { if (on) c.fx.hitstop(sec); }, shake: (amp: number, dur?: number) => { if (on) c.fx.shake(amp, dur); } };
}
type Live = ReturnType<typeof live>;
type Zone = ReturnType<Kit["decal"]>;
interface Field { p: P2; r: number; zone: Zone; web: number[]; done: boolean; gathered: boolean; landAt: number; stopAmb: boolean; L: Live }
interface St { dir: THREE.Vector3; field: Field | null }
const STATE = new WeakMap<Ent, St>();
const st = (c: ItiCtx) => { let s = STATE.get(c.me); if (!s) { s = { dir: vec(0, 0, 1), field: null }; STATE.set(c.me, s); } return s; };
const MARKS = new Map<string, MarkIcon>();

// ---------------------------------------------------------------- 命中那一下（所有技能共用）
// 同一帧里叠这几样：目标整个闪一下（白热，大个子减半）→ 顿帧 → 镜头抖（顿帧时照样抖）→ 一颗锐利的星芒 → 顺刀路溅火花、碎片
// → 脚下一小圈冲击 → 身上一道和刀路交叉的刀痕 → 打中英雄再加一点色差
interface StrikeOpts { dir: V3; power?: number; stop?: number; shake?: number; ring?: boolean; /** 脚下铺一片被红光照着的地面（只在压暗的时候好看，默认不铺） */ glow?: boolean; star?: number; white?: number; chroma?: number; /** 屏幕级的那几样放不放（不给就按目标在不在画面里） */ L?: Live;
  mark?: { life: number; thread?: number; collapse?: number; ignite?: number; tilt?: number; len?: number } }
function strike(c: ItiCtx, t: Ent, o: StrikeOpts) {
  const K = kitOf(c), p = o.power ?? 1, hero = t.kind === "hero", h = hOf(c, t), g = gy(c, t), L = o.L ?? live(c, t);
  const ct = vec(t.x, g + Math.min(h, 4) * (hero ? 0.5 : 0.55), t.z), d = vec(o.dir.x, 0, o.dir.z); if (d.lengthSq() < 1e-6) d.set(0, 0, 1); d.normalize();
  const big = t.r > 0.78 || t.kind === "monster" || t.kind === "tower" || t.kind === "core", w = o.white ?? 1, wk = w * (big ? 0.45 : hero ? 0.9 : 0.8);
  const H = c.api.actor(t)?.hero; if (H) { H.hit?.(Math.min(1, w)); H.hitWhole?.(wk, HITC); } else c.fx.flashUnit?.(t, wk, HITC);      // 大个子整身闪按体型减半（上一轮是一大团白）；小兵、野怪走 view.ts 的 flashUnit
  if (o.stop !== 0) L.stop(o.stop ?? (hero ? 0.055 : 0.03) * Math.min(1.4, p));
  if (o.shake !== 0) L.shake(o.shake ?? 0.12 * p, 0.16 + 0.06 * p);
  const sk = o.star ?? 1;
  K.stars.add({ pos: ct, size: (hero ? 2.7 : 1.9) * p * sk, life: 0.2 + 0.04 * p, rot: Math.atan2(d.z, d.x) + 0.3 });
  K.stars.add({ pos: ct, size: Math.min(h, 3.4) * (big ? 0.32 : 0.44) * Math.min(1.15, p) * sk, life: 0.08, kind: 4 });
  K.sparks.add({ pos: ct, n: Math.round(16 * p), dir: vec(d.x, 0.25, d.z), spread: 0.75, speed: [8, 19 * Math.min(1.3, p)], life: [0.12, 0.32], size: [0.06, 0.12], gravity: 0.8, drag: 3, stretch: 0.05 });
  K.sparks.add({ pos: ct, n: Math.round(3 * p), dir: vec(d.x, 0.6, d.z), spread: 1.0, speed: [3, 8], life: [0.22, 0.4], size: [0.14, 0.22], kind: 1, gravity: 1.2, drag: 2 });
  if (hero) K.sparks.add({ pos: ct, n: 1, dir: vec(d.x, 0.9, d.z), spread: 1.2, speed: [1.5, 4], life: [0.6, 1.0], size: [0.15, 0.22], kind: 4, gravity: 0.22, drag: 1.6 });      // 花瓣只给英雄一片（第二步：满地红点像血迹，减掉大半）
  if (o.ring !== false) K.rings.add({ x: t.x, z: t.z, y: g, rMax: (hero ? 2.3 : 1.6) * Math.sqrt(p), life: 0.28, thick: 0.6, r0: 0.3 });
  if (o.glow) K.rings.add({ x: t.x, z: t.z, y: g, rMax: (hero ? 2.6 : 1.9) * Math.sqrt(p), life: 0.4, kind: 3, alpha: 0.8 });
  if (hero && o.chroma !== 0) L.S.chroma(o.chroma ?? 0.3 * p, 0.14);
  itiSfx("hit", t.x, t.z, hero ? p : p * 0.6);
  let mark = -1;
  if (o.mark) {      // 刀痕：顺着刀路、斜着划过身子的一道，和穿过去的刀气交成一个锐利的 X
    const side = vec(-d.z, 0, d.x), tilt = o.mark.tilt ?? 0.55, len = o.mark.len ?? (hero ? 1.25 : 0.85);
    const ax = d.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(side, Math.sin(tilt)).normalize();
    const a = ct.clone().addScaledVector(ax, -len).add(vec(0, 0.45 * len, 0)), b = ct.clone().addScaledVector(ax, len).add(vec(0, -0.4 * len, 0));
    mark = K.lines.add({ a, b, width: hero ? 0.4 : 0.3, life: o.mark.life, reveal: 0.035, collapse: o.mark.collapse ?? 0.1, thread: o.mark.thread ?? 0.1, ignite: o.mark.ignite, kind: 2 });
  }
  return { center: ct, mark };
}
/** 往一个点聚的光：一圈小光点从半径 r 飞向中心（蓄力“光往刀上聚”） */
function converge(K: Kit, center: V3, r: number, n: number, dur: number, size = 0.12) {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.4, y = (Math.random() - 0.3) * r * 0.6;
    const p = vec(center.x + Math.cos(a) * r, center.y + y, center.z + Math.sin(a) * r), v = vec(center.x - p.x, center.y - p.y, center.z - p.z).multiplyScalar(1 / dur);
    K.sparks.add({ pos: p, n: 1, dir: v, spread: 0.0, speed: [v.length(), v.length()], life: [dur, dur], size: [size, size * 1.4], gravity: 0, drag: 0.01, stretch: 0.06, delay: Math.random() * dur * 0.3 });
  }
}
/** 冲刺时一路留残影 */
function trailGhosts(c: ItiCtx, dur: number, every: number, o: { life?: number; alpha?: number; white?: number }) {
  const K = kitOf(c), G = ghostsOf(c); let t = 0, last = -1;
  K.add({ quiet: true, update(dt) { t += dt; if (t - last >= every && t < dur) { last = t; G.spawn(o); } return t < dur; }, dispose() { /* 残影自己淡掉 */ } });
}
/** 冲刺的共用部分：身后一道彗尾、几道速度线、地上一道烧红的刀痕（很快冷成焦痕） */
function dashTrail(c: ItiCtx, from: P2, to: P2, dur: number, w = 0.85, n = 7, scar = 0.3) {
  const K = kitOf(c), d = dirTo(from, to), len = Math.hypot(to.x - from.x, to.z - from.z), side = vec(-d.z, 0, d.x), y0 = gy(c, from), y1 = gy(c, to);
  K.lines.add({ a: vec(from.x - d.x * 0.3, y0 + 1.15, from.z - d.z * 0.3), b: vec(to.x + d.x * 0.9, y1 + 1.15, to.z + d.z * 0.9), width: w, life: dur + 0.2, reveal: Math.max(0.03, dur), collapse: dur + 0.02, thread: 0, kind: 5 });
  K.lines.add({ a: vec(from.x, y0 + 0.07, from.z), b: vec(to.x + d.x * 0.5, y1 + 0.07, to.z + d.z * 0.5), width: scar, life: 1.5, reveal: Math.max(0.03, dur), kind: 4 });
  for (let i = 0; i < (K.lite ? Math.ceil(n / 2) : n); i++) {
    const off = (i % 2 ? 1 : -1) * (0.6 + 0.22 * i), y = 0.35 + ((i * 0.37) % 1) * 2.1, L = 2.6 + ((i * 0.61) % 1) * 2.6, at = 0.15 + ((i * 0.43) % 1) * 0.7;
    const p = vec(from.x + d.x * len * at, y0 + y, from.z + d.z * len * at).addScaledVector(side, off);
    K.lines.add({ a: p.clone().addScaledVector(d, -L * 0.7), b: p.clone().addScaledVector(d, L * 0.3), width: 0.14 + 0.07 * (i % 3), life: 0.18, reveal: 0.05, kind: 1, collapse: 0.07, thread: 0, delay: 0.01 * i });
  }
  K.rings.add({ x: from.x, z: from.z, y: y0, rMax: 1.8, life: 0.24, thick: 0.5 });
  return { d, len, side };
}

export const ITI_FX_CORE = {
  // ================================================================ 普攻
  /** 普攻打中之前。combo 0：右手一刀，一弯白刃；1：双手，两弯交叉 */
  attack(c: ItiCtx, target: Ent, combo: number) {
    const K = kitOf(c), me = c.a.pos, d = dirTo(me, target), yaw = yawOf(d), y = gy(c, c.me) + 1.5;
    const dist = Math.hypot(target.x - me.x, target.z - me.z), R = Math.max(2.4, Math.min(3.3, dist * 1.05));
    const mk = (flip: boolean, tilt: number, delay = 0, w = 1.05) => K.crescent({ pos: vec(me.x + d.x * 0.3, y, me.z + d.z * 0.3), yaw, tilt, r: R, width: w, white: 0.8, edgeW: 1.4, a0: Math.PI / 2 + (flip ? -1.35 : 1.35), a1: Math.PI / 2 + (flip ? 1.35 : -1.35), sweep: 0.06, hold: 0.07, linger: 0.15, sym: true, glow: 1.1, delay });
    if (combo === 0) mk(false, 0.38); else { mk(true, -0.5); mk(false, 0.4, 0.035, 0.85); }
    itiSfx("swing", me.x, me.z, combo ? 0.8 : 0.6);
    strike(c, target, { dir: d, power: combo ? 0.85 : 0.7, stop: target.kind === "hero" ? (combo ? 0.035 : 0.025) : 0, shake: combo ? 0.07 : 0.05, chroma: 0, mark: { life: 0.3, collapse: 0.1, thread: 0, tilt: combo ? -0.6 : 0.55 } });
  },

  // ================================================================ 被动 · 烬痕
  /** target 身上的烬痕变成 n 层（0 = 清掉），sec 秒后过期。头顶三格记号自己跟着目标走 */
  mark(c: ItiCtx, target: Ent, n: number, sec: number) {
    const K = kitOf(c), key = c.me.id + ":" + target.id; let m = MARKS.get(key);
    if (n <= 0) { m?.kill(); MARKS.delete(key); return; }
    if (!m || m.dead) { m = K.add(new MarkIcon(K, () => ({ x: target.x, y: gy(c, target), z: target.z, h: Math.min(hOf(c, target), 4.2), ok: target.alive !== false && (target.team === 0 || target.seen !== false) }))); MARKS.set(key, m); }
    m.set(n, sec);
    const cr = c.fx.screen?.camRight() ?? { x: 1, z: 0 }, off = n >= 3 ? 0 : (n - 2) * 0.62;      // 新亮的那一格在第几格：按镜头的左右摆
    const top = vec(target.x + cr.x * off, gy(c, target) + Math.min(hOf(c, target), 4.2) + 1.2, target.z + cr.z * off);
    K.stars.add({ pos: top, size: n >= 3 ? 2.6 : 0.9, life: n >= 3 ? 0.16 : 0.14, kind: n >= 3 ? 5 : 2, rot: 0 });
  },
  /** 叠满引爆的那一下：白热的星 → 绯红的花猛地绽开 → 从里往外碎掉；一根细光柱；地上一朵花形的焦印 */
  detonate(c: ItiCtx, target: Ent, dmg: number) {
    const K = kitOf(c), L = live(c, target), S = L.S, hero = target.kind === "hero", ct = chest(c, target, 0.5), g = gy(c, target), k = Math.max(0.85, Math.min(1.3, 0.85 + dmg / 900)) * (hero ? 1 : 0.8);
    const H = c.api.actor(target)?.hero; H?.hit?.(1); H?.hitWhole?.(target.r > 0.78 ? 0.5 : 1, HITC);
    // 大招落地那一下引爆的：屏幕上的那几样（顿帧、一闪、冲击波）让给十字新月——不然这里的顿帧会把新月“打击帧一过就炸开”拖后两帧
    // 大招里八刀之间引爆的：顿帧短一点（0.045 秒）。一个大招的顿帧加起来控制在半秒左右：八刀各 0.033（60 帧下两帧；顿帧是按整帧算的，写 0.04 会变成三帧）、中途引爆至多两三次、十字新月 0.1
    const F0 = st(c).field, fin = !!F0 && !F0.done && F0.gathered && c.api.time() >= F0.landAt - 0.03;
    L.shake(0.34 * k, 0.3);
    if (!fin) { L.stop(F0 && !F0.done ? 0.045 : hero ? 0.07 : 0.04); S.dim(0.5, 0.04, 0.12, 0.35, DARK); S.flash(0.1 * k, 0.1, 0xffd8d0); S.chroma(0.55 * k, 0.2); S.wave(vec(target.x, g, target.z), 0.4, 4.2 * k, 0.3, 0.014); }
    c.fx.lamp({ x: target.x, y: g + 2.2, z: target.z }, 0xff2a48, 26, 0.35); itiSfx("pop", target.x, target.z, k);
    K.stars.add({ pos: ct, size: 3.2 * k, life: 0.14, kind: 0, rot: 0.4 });
    K.stars.add({ pos: ct, size: 5.5 * k, life: 0.16, kind: 5, rot: 0.25 });
    K.bloom({ pos: ct, size: 2.7 * k, life: 0.52, rot: Math.random() * 0.8, delay: 0.035 });
    K.lines.add({ a: vec(target.x, g + 0.05, target.z), b: vec(target.x, g + 7.5 * k, target.z), width: 0.9 * k, life: 0.34, reveal: 0.04, collapse: 0.1, thread: 0, kind: 3, delay: 0.02 });
    K.rings.add({ x: target.x, z: target.z, y: g, rMax: 3.2 * k, r0: 0.4, life: 0.32, thick: 0.9, delay: 0.02 });
    K.rings.add({ x: target.x, z: target.z, y: g, rMax: 4.2 * k, r0: 0.6, life: 0.42, thick: 0.4, delay: 0.07, alpha: 0.7 });
    K.decal({ tex: "bloom", x: target.x, z: target.z, y: g, r: 2.0 * k, life: 1.6, grow: 0.12, rot: 0.3, glow: [2.0, 0.42, 0.0], dark: [0.3, 0.2, 0.0] });
    K.sparks.add({ pos: ct, n: 30, speed: [7, 16], life: [0.18, 0.45], size: [0.07, 0.13], up: 0.3, gravity: 0.7, drag: 2.6, stretch: 0.05 });
    K.sparks.add({ pos: ct, n: 8, speed: [4, 10], life: [0.3, 0.5], size: [0.18, 0.3], kind: 1, up: 0.45, gravity: 1, drag: 1.8 });
    K.sparks.add({ pos: ct, n: 5, speed: [2, 6], life: [0.8, 1.3], size: [0.16, 0.24], kind: 4, up: 0.7, gravity: 0.2, drag: 1.5 });
    K.sparks.add({ pos: vec(target.x, g + 0.6, target.z), n: 10, speed: [1, 3], life: [0.7, 1.2], size: [0.1, 0.18], kind: 2, up: 1, gravity: -0.1, drag: 1.3, jitter: 0.15 });
    for (let i = 0; i < 6; i++) { const a = i * 1.047 + 0.3, r = 0.4; K.lines.add({ a: vec(target.x + Math.cos(a) * r, ct.y - 0.4, target.z + Math.sin(a) * r), b: vec(target.x + Math.cos(a) * 1.5, ct.y + 2.0 + (i % 2) * 0.8, target.z + Math.sin(a) * 1.5), width: 0.24, life: 0.2, reveal: 0.05, collapse: 0.07, thread: 0, delay: 0.04, kind: 1 }); }
    MARKS.delete(c.me.id + ":" + target.id);
  },
  /** 新加：参与击杀后刷新（Q 回满、R 冷却缩短）的那一下。原来是技能代码里的占位 refreshFx：脚下一圈往里收、刀上一颗十字闪、几点光往身上聚 */
  refresh(c: ItiCtx) {
    const K = kitOf(c), me = c.a.pos, g = gy(c, c.me), h = vec(); c.a.chest(h);
    K.rings.add({ x: me.x, z: me.z, y: g, rMax: 2.6, r0: 0.4, life: 0.28, kind: 1, thick: 0.7, ease: 0 });
    K.rings.add({ x: me.x, z: me.z, y: g, rMax: 2.0, life: 0.3, thick: 0.4, delay: 0.26, alpha: 0.8 });
    K.stars.add({ pos: h, size: 3.2, life: 0.18, kind: 5, rot: 0.4, delay: 0.24 });
    converge(K, h, 2.2, K.lite ? 5 : 9, 0.26, 0.1);
    itiSfx("refresh", me.x, me.z, 1);
  },

  // ================================================================ Q · 三叠斩
  /** 动作开始（w 秒后出手）：脚下的光往里收，刀上一颗十字闪 */
  qWindup(c: ItiCtx, stage: number, w: number) {
    const K = kitOf(c), me = c.a.pos, g = gy(c, c.me), h = vec(); c.a.hand(h, "Right"); const big = stage >= 3;
    K.rings.add({ x: me.x, z: me.z, y: g, rMax: big ? 3.2 : 2.2, r0: 0.3, life: Math.max(0.06, w), kind: 1, thick: big ? 0.9 : 0.6, ease: 0 });
    K.stars.add({ pos: h, size: big ? 2.2 : 1.6, life: Math.max(0.08, w), kind: 5, rot: 0.5 });
    if (big) converge(K, vec(me.x, g + 1.4, me.z), 1.6, K.lite ? 4 : 8, Math.max(0.06, w), 0.09);
  },
  /** 出手：从 from 冲到 to，用 dur 秒。一、二段各一大弯横切的白刃（方向相反）；三段腾空，一弯竖着的新月跟着翻身；stage 0 是 W 的冲刺（没有横切） */
  qDash(c: ItiCtx, stage: number, from: P2, to: P2, dur: number) {
    const K = kitOf(c), S = st(c), slash = stage === 1 || stage === 2, L = live(c, to);
    const { d, len } = dashTrail(c, from, to, dur, stage === 3 ? 0.6 : slash ? 1.25 : 0.85, slash ? 11 : 7, slash ? 0.5 : 0.3), yaw = yawOf(d), g = gy(c, from);
    S.dir.copy(d); itiSfx(stage === 3 ? "leap" : "dash", from.x, from.z, slash ? 1 : 0.8);
    if (stage === 3) {      // 腾空翻身下劈：竖着的新月（roll=90° 让圆弧立起来：角度 0 朝上、+90° 朝前），从背后翻过头顶劈到身前地上
      trailGhosts(c, dur, 0.05, { life: 0.26, alpha: 0.6, white: 0.15 });
      ghostsOf(c).spawn({ life: 0.24, alpha: 0.75, white: 0.5 });
      const mid = vec((from.x + to.x) / 2, g + 1.6, (from.z + to.z) / 2), R = Math.max(1.6, len * 0.5 + 0.2);
      K.crescent({ pos: mid, yaw, roll: Math.PI / 2, r: R, width: 1.35, white: 0.6, edgeW: 1.3, a0: -2.1, a1: 2.72, sweep: Math.max(0.08, dur), linger: 0.22, tail: 0.72, glow: 1.25 });
      K.rings.add({ x: from.x, z: from.z, y: g, rMax: 2.6, life: 0.28, thick: 0.7 });
      L.shake(0.06, 0.12);
      return;
    }
    trailGhosts(c, dur, 0.035, { life: 0.24, alpha: 0.7, white: 0.25 });
    const side = vec(-d.z, 0, d.x);
    K.lines.add({ a: vec(from.x - d.x * 1.5, g + 1.15, from.z - d.z * 1.5), b: vec(to.x + d.x * 3.4, g + 1.15, to.z + d.z * 3.4), width: slash ? 0.7 : 0.5, life: dur + 0.24, reveal: Math.max(0.03, dur * 0.7), collapse: dur * 0.7 + 0.03, thread: 0.06, kind: 2 });      // 一道比人先到的白线：从身后一直穿到终点前面三米多（“一线”）
    if (slash) for (const k of [-1, 1]) K.lines.add({ a: vec(from.x, g + 0.8 + 0.5 * k, from.z).addScaledVector(side, 0.75 * k), b: vec(to.x + d.x * 2.2, g + 0.8 + 0.5 * k, to.z + d.z * 2.2).addScaledVector(side, 0.75 * k), width: 0.3, life: dur + 0.14, reveal: Math.max(0.03, dur * 0.8), collapse: dur * 0.8 + 0.02, thread: 0, kind: 2 });      // 一、二段：上下再各一道细的白线（三道一组，刀气才显得厚）
    for (let i = 0; i < 5; i++) { const k = 0.15 + i * 0.18; K.sparks.add({ pos: vec(from.x + d.x * len * k, g + 0.9, from.z + d.z * len * k), n: 4, dir: vec(-d.x, 0.5, -d.z), spread: 0.9, speed: [3, 10], life: [0.15, 0.35], size: [0.05, 0.1], gravity: 0.8, drag: 2.5, stretch: 0.05, delay: dur * k }); }
    L.S.dim(slash ? 0.4 : 0.3, 0.03, dur + 0.1, 0.28, DARK);      // 出刀的那一下世界很短地暗一下：白和绯才立得住
    if (!slash) return;
    // 横切的大月牙（照李白、澜那种一大弯）：半径 3.6 米、张 145 度，最宽处 1.9 米，冲到一半开始扫、0.06 秒扫开，整弯停一下再收。
    // 弯的顶点落在冲刺终点再往前一米多（刀是砍在身前的）；路径宽 2.4 米，月牙两头各出去一截
    const sw = stage === 1, R = 3.6, ctr = vec(to.x + d.x * (1.3 - R), g + 1.2, to.z + d.z * (1.3 - R));
    K.crescent({ pos: ctr, yaw, tilt: sw ? 0.22 : -0.22, r: R, width: 1.9, white: 0.9, edgeW: 1.7, a0: Math.PI / 2 + (sw ? 1.27 : -1.27), a1: Math.PI / 2 + (sw ? -1.27 : 1.27), sweep: 0.06, hold: 0.17, linger: 0.17, tail: 1.04, sym: true, glow: 1.3, delay: dur * 0.45 });
    K.crescent({ pos: vec(ctr.x + d.x * 0.55, ctr.y + (sw ? -0.25 : 0.3), ctr.z + d.z * 0.55), yaw, tilt: sw ? -0.1 : 0.14, r: R * 0.8, width: 0.7, white: 0.5, a0: Math.PI / 2 + (sw ? -1.15 : 1.15), a1: Math.PI / 2 + (sw ? 1.15 : -1.15), sweep: 0.07, hold: 0.1, linger: 0.15, tail: 1.04, sym: true, glow: 0.9, delay: dur * 0.7 });      // 里面再叠一弯反着扫的（双刀）
    K.at(dur * 0.45, () => K.stars.add({ pos: vec(to.x + d.x * 1.2, g + 1.3, to.z + d.z * 1.2), size: 4.5, life: 0.16, kind: 5, rot: yaw + 1.57 }));      // 月牙顶上一颗十字闪：这一刀的“落点”
    L.shake(0.09, 0.16);
  },
  qHit(c: ItiCtx, stage: number, e: Ent) {
    const d = st(c).dir, hero = e.kind === "hero";
    strike(c, e, { dir: stage === 3 ? dirTo(c.a.pos, e) : d, power: hero ? (stage === 3 ? 1.25 : 1.3) : (stage === 3 ? 0.8 : 0.95), stop: stage === 3 ? 0 : undefined, shake: stage === 3 ? 0 : undefined, glow: stage !== 3, mark: { life: 0.42, collapse: 0.12, thread: 0, tilt: stage === 2 ? -0.6 : stage === 3 ? 1.2 : 0.55, len: hero ? 1.5 : 1.0 } });
  },
  /** 第三段落地：砸地，r 是范围。冲击波一路推到边，地面裂开（灼热的裂缝很快冷成焦痕），范围整片亮一下 */
  qLand(c: ItiCtx, p: P2, r: number) {
    const K = kitOf(c), L = live(c, p), S = L.S, g = gy(c, p), d = st(c).dir, ctr = vec(p.x, g, p.z);
    L.stop(0.09); L.shake(0.55, 0.42); S.dim(0.55, 0.04, 0.14, 0.4, DARK); S.zoom(0.95, 0.04, 0.06, 0.28); S.radial(0.07, 0.22, ctr); S.wave(ctr, 0.5, r * 1.05, 0.36, 0.022); S.flash(0.13, 0.1); S.chroma(0.5, 0.2);
    c.fx.lamp({ x: p.x, y: g + 2.4, z: p.z }, 0xff2a48, 34, 0.4); itiSfx("slam", p.x, p.z, 1);
    K.lines.add({ a: vec(p.x + d.x * 0.8, g + 8, p.z + d.z * 0.8), b: vec(p.x, g, p.z), width: 1.3, life: 0.18, reveal: 0.025, collapse: 0.06, thread: 0, kind: 2 });      // 一道从天上劈下来的白光
    K.lines.add({ a: vec(p.x, g + 0.05, p.z), b: vec(p.x, g + 9, p.z), width: 1.7, life: 0.4, reveal: 0.03, collapse: 0.12, thread: 0, kind: 3, delay: 0.02 });
    K.stars.add({ pos: vec(p.x, g + 1.0, p.z), size: 4.6, life: 0.24, kind: 1 });
    K.stars.add({ pos: vec(p.x, g + 1.0, p.z), size: 8.5, life: 0.2, kind: 5, rot: 0.2 });
    K.rings.add({ x: p.x, z: p.z, y: g, rMax: r, life: 0.36, kind: 2, alpha: 0.9 });                                      // 范围整片亮一下（边线最亮）
    K.rings.add({ x: p.x, z: p.z, y: g, rMax: r, r0: 0.3, life: 0.28, thick: 2.0 });
    K.rings.add({ x: p.x, z: p.z, y: g, rMax: r + 0.3, r0: 0.3, life: 0.38, thick: 0.6, delay: 0.05, alpha: 0.8 });
    K.wall({ x: p.x, z: p.z, y: g, r0: 0.8, r1: r, h: 2.3, life: 0.36 });
    K.decal({ tex: "crack", x: p.x, z: p.z, y: g, r: r * 1.08, life: 2.2, grow: 0.12, rot: yawOf(d), glow: [2.6, 0.42, 0], dark: [0.3, 0.2, 0.0] });
    for (let i = 0; i < (K.lite ? 5 : 9); i++) { const a = i * (6.283 / 9) + 0.3 + (i % 3) * 0.13, r0 = 2.6 + (i % 2) * 0.7, r1 = r * (0.86 + 0.14 * ((i * 0.37) % 1));      // 裂缝一路裂到边（即梦那张裂纹图拉到 5 米会糊，外面这一截用代码画的细线接上）
      K.lines.add({ a: vec(p.x + Math.cos(a) * r0, g + 0.07, p.z + Math.sin(a) * r0), b: vec(p.x + Math.cos(a) * r1, g + 0.07, p.z + Math.sin(a) * r1), width: 0.18 + 0.08 * (i % 2), life: 1.6, reveal: 0.1, kind: 4, delay: 0.02 }); }
    K.sparks.add({ pos: vec(p.x, g + 0.4, p.z), n: 44, speed: [8, 20], life: [0.2, 0.5], size: [0.07, 0.14], up: 0.35, gravity: 0.8, drag: 2.4 });
    K.sparks.add({ pos: vec(p.x, g + 0.3, p.z), n: 14, speed: [4, 9], life: [0.45, 0.65], size: [0.14, 0.26], kind: 3, up: 1.2, gravity: 2.2, drag: 0.8 });
    K.sparks.add({ pos: vec(p.x, g + 0.6, p.z), n: 6, speed: [5, 11], life: [0.3, 0.5], size: [0.18, 0.3], kind: 1, up: 0.6, gravity: 1, drag: 1.6 });
    K.sparks.add({ pos: vec(p.x, g + 0.8, p.z), n: 5, speed: [2.5, 7], life: [0.8, 1.3], size: [0.16, 0.24], kind: 4, up: 0.9, gravity: 0.22, drag: 1.4 });
    K.sparks.add({ pos: vec(p.x, g + 0.3, p.z), n: 12, speed: [1, 3.5], life: [0.8, 1.4], size: [0.1, 0.18], kind: 2, up: 0.8, gravity: -0.1, drag: 1.2, jitter: 0.2 });
  },

  // ================================================================ W · 残焰
  /** 出手时在 p 留下残影（面朝 yaw）：一个烧着的绯红影子，脚下一圈小法阵，火星往上飘。返回的东西由技能代码在换回或炸开时 move / remove */
  wEcho(c: ItiCtx, p: P2, yaw: number): EchoFx {
    const K = kitOf(c), G = ghostsOf(c), g = gy(c, p); void yaw;
    const slot: GhostSlot = G.spawn({ hold: true, alpha: 0.95, white: 0.9, flame: 1 }); slot.root.position.set(p.x, g, p.z);
    const dec = K.decal({ tex: "rune", x: p.x, z: p.z, y: g, r: 1.5, life: 99, grow: 0.12, spin: 1.1, glow: [1.4, 0.72, 0.72], dark: [0.3, 0.3, 0.3] }); (dec as FxHandle).quiet = true;      // 残影要挂好几秒：不为它一直开着泛光
    K.rings.add({ x: p.x, z: p.z, y: g, rMax: 2.2, life: 0.3, thick: 0.6 }); K.stars.add({ pos: vec(p.x, g + 1.5, p.z), size: 2.0, life: 0.16 });
    let x = p.x, z = p.z, alive = true, acc = 0, pulse = 0;
    K.add({ quiet: true, update(dt) { if (!alive) return false; acc += dt; pulse += dt;
        while (acc > 0.07) { acc -= 0.07; K.sparks.add({ pos: vec(x + (Math.random() - 0.5) * 0.8, K.env.ground(x, z) + 0.3 + Math.random() * 2.2, z + (Math.random() - 0.5) * 0.8), n: 1, speed: [0.4, 1.4], life: [0.5, 0.9], size: [0.09, 0.16], kind: 2, up: 1.6, gravity: -0.15, drag: 1.2 }); }
        if (pulse > 0.9) { pulse = 0; K.rings.add({ x, z, y: K.env.ground(x, z), rMax: 1.9, r0: 0.5, life: 0.5, thick: 0.3, alpha: 0.6 }); }      // 每隔一会儿脚下一圈细的脉动：提醒“这里有个残影，可以换回来”
        return true; }, dispose() { /* */ } });
    return { move(nx, nz) { x = nx; z = nz; const y = K.env.ground(nx, nz); slot.root.position.set(nx, y, nz); dec.mesh.position.set(nx, y + 0.02, nz); },
      remove() { if (!alive) return; alive = false; G.release(slot, 0.14); dec.end(0.2); } };
  },
  wDash(c: ItiCtx, from: P2, to: P2, dur: number) { ITI_FX_CORE.qDash(c, 0, from, to, dur); },
  /** 再按一次和残影换位（from 是换之前站的地方，to 是残影那里）：原地往里一收、一道细白线连过去、那边一颗十字闪 */
  wSwap(c: ItiCtx, from: P2, to: P2) {
    const K = kitOf(c), L = live(c, to), g0 = gy(c, from), g1 = gy(c, to);
    K.rings.add({ x: from.x, z: from.z, y: g0, rMax: 2.6, r0: 0.3, life: 0.14, kind: 1, thick: 0.8, ease: 0 });
    K.lines.add({ a: vec(from.x, g0 + 1.3, from.z), b: vec(to.x, g1 + 1.3, to.z), width: 0.55, life: 0.34, reveal: 0.05, collapse: 0.07, thread: 0.07, kind: 2 });
    K.lines.add({ a: vec(from.x, g0 + 0.07, from.z), b: vec(to.x, g1 + 0.07, to.z), width: 0.3, life: 1.2, reveal: 0.05, kind: 4 });
    K.lines.add({ a: vec(to.x, g1 + 0.1, to.z), b: vec(to.x, g1 + 5.5, to.z), width: 0.8, life: 0.2, reveal: 0.03, collapse: 0.06, thread: 0, kind: 3, delay: 0.04 });
    K.at(0.05, () => { K.stars.add({ pos: vec(to.x, g1 + 1.5, to.z), size: 5.5, life: 0.18, kind: 5, rot: 0.3 }); K.rings.add({ x: to.x, z: to.z, y: g1, rMax: 2.4, life: 0.26, thick: 0.6 }); });
    L.S.chroma(0.4, 0.16); L.shake(0.06, 0.12); itiSfx("blink", to.x, to.z, 1);
  },
  /** 残影炸开：r 半径，hits 打中的。一朵大的绯焰花、冲击墙推到边、地上烧出一朵花形的焦印 */
  wBurst(c: ItiCtx, p: P2, r: number, hits: Ent[]) {
    const K = kitOf(c), L = live(c, p), S = L.S, g = gy(c, p), ctr = vec(p.x, g, p.z), anyHero = hits.some(e => e.kind === "hero");
    if (anyHero) L.stop(0.06); L.shake(0.42, 0.34); S.dim(0.5, 0.04, 0.14, 0.4, DARK); S.wave(ctr, 0.5, r * 1.05, 0.34, 0.02); S.flash(0.1, 0.1); S.chroma(0.4, 0.18); S.radial(0.045, 0.18, ctr);
    c.fx.lamp({ x: p.x, y: g + 2.2, z: p.z }, 0xff2a48, 30, 0.4); itiSfx("burst", p.x, p.z, 1);
    K.stars.add({ pos: vec(p.x, g + 1.5, p.z), size: 4.2, life: 0.2, kind: 1 });
    K.stars.add({ pos: vec(p.x, g + 1.5, p.z), size: 7, life: 0.18, kind: 5, rot: 0.35 });
    K.bloom({ pos: vec(p.x, g + 1.5, p.z), size: 3.6, life: 0.55, rot: Math.random(), delay: 0.03 });
    K.lines.add({ a: vec(p.x, g + 0.05, p.z), b: vec(p.x, g + 8, p.z), width: 1.4, life: 0.4, reveal: 0.03, collapse: 0.12, thread: 0, kind: 3 });
    K.rings.add({ x: p.x, z: p.z, y: g, rMax: r, life: 0.36, kind: 2, alpha: 0.9 });
    K.rings.add({ x: p.x, z: p.z, y: g, rMax: r, r0: 0.4, life: 0.3, thick: 1.8 });
    K.rings.add({ x: p.x, z: p.z, y: g, rMax: r + 0.3, r0: 0.4, life: 0.4, thick: 0.5, delay: 0.05, alpha: 0.8 });
    K.wall({ x: p.x, z: p.z, y: g, r0: 0.7, r1: r, h: 2.0, life: 0.36 });
    K.decal({ tex: "bloom", x: p.x, z: p.z, y: g, r: r * 0.7, life: 1.8, grow: 0.14, rot: 0.4, glow: [2.2, 0.42, 0.0], dark: [0.3, 0.2, 0.0] });
    for (let i = 0; i < 8; i++) { const a = i * 0.785 + 0.2; K.lines.add({ a: vec(p.x + Math.cos(a) * r * 0.55, g + 0.07, p.z + Math.sin(a) * r * 0.55), b: vec(p.x + Math.cos(a) * r * 0.97, g + 0.07, p.z + Math.sin(a) * r * 0.97), width: 0.18, life: 1.5, reveal: 0.1, kind: 4 }); }
    K.sparks.add({ pos: vec(p.x, g + 1.2, p.z), n: 38, speed: [8, 19], life: [0.2, 0.5], size: [0.07, 0.14], up: 0.3, gravity: 0.8, drag: 2.4 });
    K.sparks.add({ pos: vec(p.x, g + 1.2, p.z), n: 8, speed: [5, 11], life: [0.3, 0.5], size: [0.18, 0.3], kind: 1, up: 0.5, gravity: 1, drag: 1.6 });
    K.sparks.add({ pos: vec(p.x, g + 1.2, p.z), n: 6, speed: [3, 8], life: [0.8, 1.3], size: [0.16, 0.24], kind: 4, up: 0.8, gravity: 0.22, drag: 1.4 });
    K.sparks.add({ pos: vec(p.x, g + 0.4, p.z), n: 12, speed: [1, 3.5], life: [0.8, 1.4], size: [0.1, 0.18], kind: 2, up: 0.9, gravity: -0.1, drag: 1.2, jitter: 0.2 });
    for (const e of hits) { const dd = Math.hypot(e.x - p.x, e.z - p.z); K.at(0.02 + dd * 0.02, () => strike(c, e, { dir: dirTo(p, e), power: e.kind === "hero" ? 1.1 : 0.8, stop: 0, shake: 0, L, mark: { life: 0.4, collapse: 0.12, thread: 0, tilt: 1.1 } })); }
  },

  // ================================================================ E · 影步 · 穿心
  /** 从 from 消失、出现在 to（target 身后）：原地一根光柱里消失，一道细白线瞬间连过去，目标脚下一圈往里收的锁定 */
  eBlink(c: ItiCtx, from: P2, to: P2, target: Ent) {
    const K = kitOf(c), g0 = gy(c, from), g1 = gy(c, to), gt = gy(c, target);
    K.rings.add({ x: from.x, z: from.z, y: g0, rMax: 2.4, r0: 0.3, life: 0.12, kind: 1, thick: 0.7, ease: 0 });
    K.lines.add({ a: vec(from.x, g0 + 0.1, from.z), b: vec(from.x, g0 + 5, from.z), width: 0.7, life: 0.18, reveal: 0.03, collapse: 0.06, thread: 0, kind: 3 });
    K.stars.add({ pos: vec(from.x, g0 + 1.5, from.z), size: 1.9, life: 0.14 });
    K.sparks.add({ pos: vec(from.x, g0 + 1.3, from.z), n: 3, speed: [1, 3], life: [0.5, 0.9], size: [0.14, 0.22], kind: 4, up: 0.8, gravity: 0.2, drag: 1.5 });
    K.lines.add({ a: vec(from.x, g0 + 1.2, from.z), b: vec(to.x, g1 + 1.2, to.z), width: 0.42, life: 0.26, reveal: 0.04, collapse: 0.06, thread: 0.05, kind: 2 });
    K.lines.add({ a: vec(from.x, g0 + 0.07, from.z), b: vec(to.x, g1 + 0.07, to.z), width: 0.26, life: 1.1, reveal: 0.04, kind: 4 });
    K.rings.add({ x: target.x, z: target.z, y: gt, rMax: 2.6, r0: 0.7, life: 0.16, kind: 1, thick: 0.5, ease: 0 });
    K.at(0.04, () => { K.stars.add({ pos: vec(to.x, g1 + 1.6, to.z), size: 3.6, life: 0.14, kind: 5, rot: 0.6 }); K.rings.add({ x: to.x, z: to.z, y: g1, rMax: 1.8, life: 0.22, thick: 0.5 }); ghostsOf(c).spawn({ life: 0.22, alpha: 0.8, white: 0.9 }); });
    itiSfx("blink", to.x, to.z, 1);
  },
  /** 反手刺中：一道白刃从背后穿过胸口、从身前透出去七米；detonate 表示这一刺引爆了被动（引爆本身另调 detonate） */
  eStab(c: ItiCtx, target: Ent, detonate: boolean) {
    const K = kitOf(c), L = live(c, target), S = L.S, me = c.a.pos, d = dirTo(me, target), ct = chest(c, target, 0.52), g = gy(c, target), side = vec(-d.z, 0, d.x), hero = target.kind === "hero";
    st(c).dir.copy(d);
    const a = ct.clone().addScaledVector(d, -1.6), b = ct.clone().addScaledVector(d, 7.0); b.y = g + 0.9;
    K.lines.add({ a, b, width: 1.25, life: 0.5, reveal: 0.04, collapse: 0.05, thread: 0.1, ignite: K.t + 0.3, kind: 2 });      // 穿心的那一道：0.04 秒刺出去，收成一根线留一下再碎掉
    for (const s of [-1, 1]) K.lines.add({ a: a.clone().addScaledVector(side, 0.3 * s).addScaledVector(d, 0.8), b: b.clone().addScaledVector(side, 0.55 * s).addScaledVector(d, -1.4), width: 0.26, life: 0.2, reveal: 0.05, collapse: 0.06, thread: 0, kind: 1 });
    K.lines.add({ a: vec(target.x - d.x * 0.5, g + 0.07, target.z - d.z * 0.5), b: vec(target.x + d.x * 6.5, g + 0.07, target.z + d.z * 6.5), width: 0.4, life: 1.5, reveal: 0.05, kind: 4 });
    strike(c, target, { dir: d, power: 1.35, stop: hero ? 0.08 : 0.04, shake: 0.24, chroma: 0.6, L, mark: { life: 0.5, collapse: 0.12, thread: 0.08, tilt: 1.25, len: 1.4, ignite: K.t + 0.3 } });
    K.stars.add({ pos: ct, size: 6.5, life: 0.18, kind: 5, rot: Math.atan2(d.z, d.x) });
    K.sparks.add({ pos: ct.clone().addScaledVector(d, 0.5), n: 30, dir: vec(d.x, 0.08, d.z), spread: 0.32, speed: [10, 28], life: [0.16, 0.4], size: [0.07, 0.13], gravity: 0.5, drag: 2.6, stretch: 0.06 });      // 从身前透出去的一蓬
    K.sparks.add({ pos: ct.clone().addScaledVector(d, 0.6), n: 3, dir: vec(d.x, 0.3, d.z), spread: 0.5, speed: [3, 9], life: [0.7, 1.2], size: [0.16, 0.24], kind: 4, gravity: 0.25, drag: 1.5 });
    S.zoom(0.965, 0.03, 0.05, 0.2); S.dim(0.45, 0.03, 0.1, 0.3, DARK); if (hero) S.cut(ct, yawOf(d), 0.2, 0.007, 0.8);
    itiSfx("stab", target.x, target.z, 1);
    if (detonate) L.shake(0.3, 0.3);
  },

  // ================================================================ R · 绯月千刃
  /** 按下的一刻（落点 p、范围 r、最多 n 刀）：全屏一闪、世界压成绯黑、眼部切入、镜头推近；落点一轮 r 米的法阵。返回法阵，大招结束或被打断时 end */
  rStart(c: ItiCtx, p: P2, r: number, n: number): FieldFx {
    const K = kitOf(c), L = live(c, p), S = L.S, me = c.a.pos, g = gy(c, p), g0 = gy(c, c.me), s = st(c); void n;
    if (s.field && !s.field.done) endField(c, s.field);
    // 屏幕：一闪 → 压成绯黑（一直压到炸完）→ 眼部特写的横幅划过 → 镜头猛地推近一下再拉远。
    // 第二步在真实对局里改的：原来整段推近到 0.9、收刀 0.82，27 米的镜头下 11 米的法阵有一大半在画面外；现在推一下就拉到 1.12 倍远，整个法阵和刀网都在画面里
    S.flash(0.22, 0.12); S.dim(0.93, 0.09, 99, 0.3, DARK); S.zoom(0.9, 0.08, 0.1, 0.2); K.at(0.2, () => S.zoom(1.12, 0.3, 99, 0.3)); S.cutin(cutin(), 0.5, { y: 0.7, h: 0.13, v: 0.4, slope: -0.07 }); S.lines(0.55, 0.24, vec(p.x, g + 1, p.z)); S.chroma(0.6, 0.2);
    L.shake(0.16, 0.2); c.fx.lamp({ x: p.x, y: g + 3, z: p.z }, 0xff2a48, 30, 1.6); itiSfx("ult", p.x, p.z, 1);
    // 落点：法阵。即梦那张符文图只铺中间六成（拉到 11 米会糊），外圈是代码画的细环、辐条、一圈小月牙，最外一道亮边线
    const zone = K.decal({ tex: "rune", x: p.x, z: p.z, y: g, r, life: 99, grow: 0.16, spin: 0.3, zone: true, texScale: 0.6, glow: [1.0, 0.5, 0.5], dark: [0.22, 0.15, 0.15] }); zone.edge = 1.4;
    K.at(0.14, () => { zone.edge = 0.35; });
    K.rings.add({ x: p.x, z: p.z, y: g, rMax: r, life: 0.26, kind: 2, alpha: 0.9 });
    K.rings.add({ x: p.x, z: p.z, y: g, rMax: r, r0: 0.5, life: 0.2, thick: 1.2, alpha: 0.7 });
    // 伊缇：光往脚下收、往刀上聚，一道光柱里消失
    K.rings.add({ x: me.x, z: me.z, y: g0, rMax: 3.0, r0: 0.35, life: 0.13, kind: 1, thick: 0.9, ease: 0 });
    converge(K, vec(me.x, g0 + 1.6, me.z), 1.8, K.lite ? 6 : 12, 0.11, 0.1);
    K.stars.add({ pos: vec(me.x, g0 + 1.7, me.z), size: 6, life: 0.16, kind: 5, rot: 0.2 });
    K.at(0.1, () => { ghostsOf(c).spawn({ life: 0.3, alpha: 0.9, white: 0.9 }).root.position.set(me.x, g0, me.z);
      K.lines.add({ a: vec(me.x, g0 + 0.1, me.z), b: vec(me.x, g0 + 7, me.z), width: 1.0, life: 0.22, reveal: 0.03, collapse: 0.07, thread: 0, kind: 3 });
      K.rings.add({ x: me.x, z: me.z, y: g0, rMax: 2.0, life: 0.22, thick: 0.5 }); });
    const F: Field = { p: { x: p.x, z: p.z }, r, zone, web: [], done: false, gathered: false, landAt: 0, stopAmb: false, L };
    // 范围里一直有余烬往上飘（到炸开为止；花瓣只偶尔一片）
    let acc = 0; K.add({ quiet: true, update(dt) { if (F.done || F.stopAmb) return false; acc += dt; while (acc > (K.lite ? 0.1 : 0.05)) { acc -= K.lite ? 0.1 : 0.05; const a = Math.random() * 6.283, rr = Math.sqrt(Math.random()) * r * 0.95, x = p.x + Math.cos(a) * rr, z = p.z + Math.sin(a) * rr;
        K.sparks.add({ pos: vec(x, K.env.ground(x, z) + 0.2 + Math.random() * 0.6, z), n: 1, speed: [0.3, 1.2], life: [0.9, 1.5], size: [0.1, 0.2], kind: Math.random() < 0.15 ? 4 : 2, up: 1.8, gravity: -0.12, drag: 1.0 }); } return true; }, dispose() { /* */ } });
    s.field = F;
    return { end() { endField(c, F); } };
  },
  /** 第 i 刀（从 0 数）：从 from 闪到 to 砍 target（null 是空砍）。一道十几米的白刃穿过目标，马上收成一根绯线留在空中；目标身上再扫一弯月牙 */
  rSlash(c: ItiCtx, i: number, from: P2, to: P2, target: Ent | null) {
    const K = kitOf(c), s = st(c), F = s.field, d = dirTo(from, to), side = vec(-d.z, 0, d.x), hero = target?.kind === "hero", L = F && !F.done ? F.L : live(c, to);
    const g0 = gy(c, from), g1 = gy(c, to), yHit = target ? Math.min(hOf(c, target), 4) * 0.5 : 1.2, keep = F && !F.done ? 99 : 0.5;
    s.dir.copy(d);
    const a = vec(from.x - d.x * 1.2, g0 + 1.1, from.z - d.z * 1.2), b = vec(to.x + d.x * 3.6, g1 + yHit * 0.8 + 0.2, to.z + d.z * 3.6);
    const id = K.lines.add({ a, b, width: hero ? 1.55 : 1.25, life: keep, reveal: 0.04, collapse: 0.035, thread: 0.09, kind: 2 }); if (F && !F.done) F.web.push(id);      // 主刀气：0.04 秒刷过去，0.15 秒内收成 9 厘米的线，留成刀网
    for (const k of [-1, 1]) K.lines.add({ a: a.clone().addScaledVector(side, 0.34 * k).addScaledVector(d, 1.4), b: b.clone().addScaledVector(side, 0.34 * k).addScaledVector(d, -0.8), width: 0.24, life: 0.2, reveal: 0.06, kind: 1, collapse: 0.06, thread: 0 });
    K.lines.add({ a: vec(from.x, g0 + 0.07, from.z), b: vec(to.x + d.x * 2.4, g1 + 0.07, to.z + d.z * 2.4), width: 0.36, life: 2.2, reveal: 0.05, kind: 4 });      // 地上跟着一道烧红的刀痕（冷成焦痕）
    // 目标身上一弯李白那种大月牙：近白，跟刀路斜着交叉，左右手轮着来
    const at = target ?? to, gt = gy(c, at), fl = i % 2 === 0;
    K.crescent({ pos: vec(at.x - d.x * 1.7, gt + yHit + 0.2, at.z - d.z * 1.7), yaw: yawOf(d) + (fl ? 0.5 : -0.5), tilt: fl ? 0.5 : -0.5, r: 2.7, width: 1.15, white: 0.85, edgeW: 1.4, a0: Math.PI / 2 + (fl ? 1.25 : -1.25), a1: Math.PI / 2 + (fl ? -1.25 : 1.25), sweep: 0.05, hold: 0.07, linger: 0.16, tail: 1.04, sym: true, glow: 1.1 });
    itiSfx("cut", at.x, at.z, 0.7 + 0.04 * i, i);
    if (target) { const r = strike(c, target, { dir: d, power: hero ? 1.15 : 0.8, stop: hero ? 0.033 : 0.017, shake: hero ? 0.16 : 0.09, chroma: hero ? 0.35 : 0, glow: true, L, mark: { life: keep, thread: 0.08, collapse: 0.12, tilt: fl ? 0.6 : -0.6, len: hero ? 1.5 : 1.0 } }); if (F && !F.done) F.web.push(r.mark); }
    else K.stars.add({ pos: vec(to.x, g1 + 1.3, to.z), size: 2.0, life: 0.16 });
    // 伊缇闪到落点：留一个开头偏白的残影，顺着刀路往前飘
    const gs = ghostsOf(c).spawn({ life: 0.3, alpha: 0.9, white: 0.75, drift: vec(d.x * 3, 0, d.z * 3) }); gs.root.position.set(to.x, g1, to.z); gs.root.rotation.set(0, yawOf(d), 0);
    if (F && !F.done) { F.zone.edge = Math.max(F.zone.edge, 0.7); K.at(0.06, () => { if (!F.done && !F.gathered) F.zone.edge = 0.35; }); }
  },
  /** 新加：八刀砍完、伊缇在中心现身（往下落）的那一刻调，sec 秒以后调 rFinale（落地）。这是“停”的那一拍：世界再暗一档，空中的刀网一根根亮起来，地上升起一轮绯月，镜头再推近。
   *  不调也行（rFinale 自己会补一个很短的），但有这一拍，最后那一下才炸得开 */
  rGather(c: ItiCtx, p: P2, r: number, sec = 0.34) {
    const K = kitOf(c), F = st(c).field, L = F && !F.done ? F.L : live(c, p), S = L.S, g = gy(c, p);
    S.dim(0.96, sec * 0.6, 99, 0.3, DARK); S.zoom(1.0, sec, 99, 0.3);      // 镜头从 1.12 慢慢推回 1：蓄的那一拍
    K.rings.add({ x: p.x, z: p.z, y: g, rMax: r, r0: 0.6, life: sec, kind: 1, thick: 1.6, ease: 0, alpha: 0.8 });      // 地上的光从范围边往中心收
    converge(K, vec(p.x, g + 1.5, p.z), 4.5, K.lite ? 8 : 18, sec * 0.9, 0.12);
    K.at(0.02, () => ghostsOf(c).spawn({ life: 0.22, alpha: 0.9, white: 1 }));
    let t = 0; K.add({ quiet: true, update(dt) { t += dt; const k = Math.min(1, t / sec); CHARGE.value = k; if (F && !F.done) { F.zone.moon = k * k; F.zone.edge = 0.4 + 1.2 * k; } return t < sec + 0.2 && !(F?.done); }, dispose() { /* */ } });
    if (F) { F.gathered = true; F.landAt = c.api.time() + sec; } itiSfx("gather", p.x, p.z, 1);
    K.at(Math.max(0, sec - 0.09), () => { K.stars.add({ pos: vec(p.x, g + 1.6, p.z), size: 9, life: 0.14, kind: 5, rot: 0.0 }); S.chroma(0.5, 0.12); itiSfx("ting", p.x, p.z, 1); });      // 落地前的那一下“叮”
  },
  /** 落回中心的十字新月斩（r 范围，hits 打中的）：两帧打击帧 → 两弯横贯范围的新月交成 X、屏幕沿着 X 被斩开 → 定住 → 整张刀网一起爆、每个人身上一根光柱、冲击波推到边 */
  rFinale(c: ItiCtx, p: P2, r: number, hits: Ent[]) {
    const K = kitOf(c), s = st(c), F = s.field, L = F ? F.L : live(c, p), S = L.S, g = gy(c, p), ctr = vec(p.x, g, p.z), mid = vec(p.x, g + 1.2, p.z);
    if (F) { F.stopAmb = true; if (!F.gathered) { CHARGE.value = 1; F.zone.moon = 0.8; } }
    // ---- 头两帧：白底黑人的打击帧（就两帧，0.066 秒），同时两弯新月开始扫、屏幕沿 X 的两条线被斩开
    // X 按镜头摆（对局里镜头是斜 45 度看的：按世界方向摆的话屏幕上是个 +，不是 X）
    const cr = c.fx.screen?.camRight() ?? { x: 1, z: 0 }, base = Math.atan2(cr.z, cr.x), m1 = base + Math.PI * 0.25, m2 = base + Math.PI * 0.75;
    S.impact(0.066, 2); S.cut(mid, -m1, 0.42, 0.022, 1.3); S.cut(mid, -m2, 0.42, 0.022, 1.3); L.shake(0.5, 0.3); itiSfx("finale", p.x, p.z, 1);
    const Rc = 14, half = (r * 1.08) / Rc;      // 两弯：圆弧半径 14 米，弧长约 2.16r（横贯整个范围），弧的中点压在中心上，交成 X
    for (const [m, flip] of [[m1, false], [m2, true]] as [number, boolean][]) {
      const nx = Math.cos(m), nz = Math.sin(m), cx = p.x - nx * Rc, cz = p.z - nz * Rc, mdl = Math.atan2(nz, nx);
      K.crescent({ pos: vec(cx, g + 1.0, cz), yaw: 0, r: Rc, width: 1.9, white: 0.55, edgeW: 2.0, a0: flip ? mdl + half : mdl - half, a1: flip ? mdl - half : mdl + half, sweep: 0.09, hold: 0.2, linger: 0.42, tail: 1.04, glow: 1.3, sym: true });
      // 顺着新月的方向再各一道极长的细白线，一直伸出范围外（全屏大斩）
      const tx = -nz, tz = nx, Ln = r * 1.9;
      K.lines.add({ a: vec(p.x - tx * Ln, g + 1.0, p.z - tz * Ln), b: vec(p.x + tx * Ln, g + 1.0, p.z + tz * Ln), width: 0.6, life: 0.55, reveal: 0.06, collapse: 0.1, thread: 0.07, kind: 2 });
    }
    K.stars.add({ pos: mid, size: 14, life: 0.22, kind: 5, rot: 0.785 });      // 星芒是正对镜头的片：0.785 就是屏幕上的 45 度
    for (const e of hits) { const H = c.api.actor(e)?.hero, k = e.r > 0.78 ? 0.4 : 0.75; if (H) { H.hit?.(1); H.hitWhole?.(k, HITC); } else c.fx.flashUnit?.(e, k, HITC); }
    // ---- 打击帧一过：全屏一闪、径向模糊、集中线、色差；镜头从推近弹回去再拉远一点；然后定住。压暗不收——整个炸开都在暗的世界里演，0.5 秒以后再慢慢亮回来
    K.at(0.067, () => {
      S.flash(0.3, 0.14); S.radial(0.13, 0.2, ctr); S.lines(0.85, 0.24, mid); S.chroma(0.55, 0.22); S.dim(0, 0.9, 0, 0); S.dim(0.86, 0.05, 0.5, 0.7, DARK); S.zoom(1.16, 0.07, 0.08, 0.6);      /* 一直压着的那一层慢慢放开，换成一下 0.5 秒的（两层取深的） */ S.wave(ctr, 1, r * 1.05, 0.5, 0.036);
      L.stop(0.1); L.shake(0.95, 0.75);      // 定在 X 最完整的那一帧：世界停住，镜头在抖
      c.fx.lamp({ x: p.x, y: g + 3, z: p.z }, 0xff3050, 70, 0.6); c.fx.lamp({ x: p.x, y: g + 6, z: p.z }, 0xffd8d0, 40, 0.3);
      K.stars.add({ pos: mid, size: 6, life: 0.2, kind: 1, rot: 0.2 });
      K.lines.add({ a: vec(p.x, g + 0.05, p.z), b: vec(p.x, g + 13, p.z), width: 2.6, life: 0.55, reveal: 0.03, collapse: 0.16, thread: 0, kind: 3 });      // 中心一根冲天的光柱：俯视镜头里“竖着的东西”最显眼，是“结束了”的信号
      K.rings.add({ x: p.x, z: p.z, y: g, rMax: r, life: 0.4, kind: 2, alpha: 1 });
      K.rings.add({ x: p.x, z: p.z, y: g, rMax: r, r0: 0.5, life: 0.36, thick: 2.8, ease: 1 });
      K.wall({ x: p.x, z: p.z, y: g, r0: 1.0, r1: r, h: 2.6, life: 0.4 });
      K.decal({ tex: "crack", x: p.x, z: p.z, y: g, r: Math.min(r, 7.6), life: 2.6, grow: 0.16, rot: 0.6, glow: [2.6, 0.42, 0.0], dark: [0.3, 0.2, 0.0] });
      for (let i = 0; i < (K.lite ? 6 : 11); i++) { const a = i * (6.283 / 11) + 0.2 + (i % 3) * 0.13, r0 = 5.5 + (i % 2) * 1.2, r1 = r * (0.86 + 0.14 * ((i * 0.37) % 1));      // 裂缝裂到边（即梦那张裂纹图只铺到 7 米多，外面这一段用代码画的细线接上）
        K.lines.add({ a: vec(p.x + Math.cos(a) * r0, g + 0.07, p.z + Math.sin(a) * r0), b: vec(p.x + Math.cos(a) * r1, g + 0.07, p.z + Math.sin(a) * r1), width: 0.2 + 0.1 * (i % 2), life: 2.0, reveal: 0.14, kind: 4, delay: 0.02 }); }
      K.sparks.add({ pos: mid, n: 26, speed: [12, 28], life: [0.25, 0.55], size: [0.08, 0.15], up: 0.25, gravity: 0.7, drag: 2.2, stretch: 0.05 });
      if (F) { F.zone.edge = 2.2; F.zone.moon = 1; }
    });
    K.at(0.13, () => { if (F) { F.zone.edge = 0.5; F.zone.fill = 0.6; } });
    // ---- 0.2 秒以后：刀网和身上的刀痕从中心往外依次碎掉；每个被打中的人身上一根细光柱、一颗星、整身一闪；余烬（花瓣只几片）
    K.at(0.2, () => {
      CHARGE.value = 0;
      if (F) { for (const id of F.web) if (id >= 0) K.lines.ignite(id, K.t + Math.random() * 0.09); F.web = []; F.zone.edge = 1.8; F.zone.end(0.45); F.done = true; }
      K.sparks.add({ pos: mid, n: 10, speed: [5, 12], life: [0.35, 0.6], size: [0.2, 0.32], kind: 1, up: 0.5, gravity: 1, drag: 1.6 });
      K.sparks.add({ pos: vec(p.x, g + 1.5, p.z), n: 10, speed: [3, 11], life: [0.9, 1.5], size: [0.16, 0.26], kind: 4, up: 0.9, gravity: 0.2, drag: 1.3 });
      K.sparks.add({ pos: vec(p.x, g + 0.4, p.z), n: 26, speed: [1.5, 5], life: [0.9, 1.6], size: [0.1, 0.2], kind: 2, up: 0.9, gravity: -0.12, drag: 1.2, jitter: 0.3 });
    });
    K.at(0.3, () => { if (F) F.zone.edge = 0.4; });
    hits.forEach((e, i) => { const dd = Math.hypot(e.x - p.x, e.z - p.z); K.at(0.2 + dd * 0.014, () => { const ge = gy(c, e), hero = e.kind === "hero";
      strike(c, e, { dir: dd > 0.3 ? dirTo(p, e) : vec(1, 0, 0), power: hero ? 1.2 : 0.85, stop: hero && i < 2 ? 0.04 : 0, shake: 0, star: 0.75, white: 0.75, chroma: 0, L });
      K.lines.add({ a: vec(e.x, ge + 0.05, e.z), b: vec(e.x, ge + (hero ? 7.5 : 5), e.z), width: hero ? 1.0 : 0.7, life: 0.36, reveal: 0.03, collapse: 0.1, thread: 0, kind: 3 }); }); });
  },
};

/** 大招被打断或者正常结束：法阵淡掉，压暗和推近收回来，留在空中的线碎掉 */
function endField(c: ItiCtx, F: Field) {
  if (F.done) return; F.done = true; F.stopAmb = true; CHARGE.value = 0;
  const K = kitOf(c), S = F.L.S; F.zone.end(0.3); for (const id of F.web) if (id >= 0) K.lines.ignite(id, K.t + Math.random() * 0.1); F.web = [];
  S.dim(0, 0.25, 0, 0); S.zoom(1, 0.2, 0, 0.01);
}
