// 薇萝 · 烬弩（射手，烬誓庭）。
//
// 规格（数值是主线定的第一版，实现时照这个来；觉得哪里不合理，在报告里说，不要自己改数）：
//   普攻     远程，射程 8.5，弩矢飞行速度 34。
//   Q 穿甲矢 非指向，距离 13，宽 1.0，冷却 7，法力 60。一支穿透的重矢（速度 40）：路径上每个敌人 180 + 110% 攻击力 + 每级 25 的物理伤害，
//            并挂 4 秒易伤（受到的伤害多 15%，api.expose）。
//   W 翻滚装填 非指向，距离 5.5，冷却 8，法力 40。朝方向翻滚 5.5 米（0.3 秒，不穿墙）；之后 4 秒内的下一次普攻必定暴击（2 倍伤害）。
//   E 火油罐 范围，施法距离 9，半径 3.2，冷却 12，法力 70。抛出火油罐（0.6 秒落地），落地炸开成 4.5 秒的火场：
//            每 0.5 秒 35 + 每级 8 + 15% 攻击力的魔法伤害，减速 25%。（“照出隐身单位”等对面有隐身英雄的阶段 6 再做，报告里提一句即可。）
//   R 连弩齐射 大招，6 级，非指向扇形，距离 12，半张角 22 度，冷却 60，法力 100，引导 3 秒。朝扇形连续射 18 发，越射越快
//            （间隔从 0.26 秒缩到 0.1 秒）；每发在扇形里随机偏一点，打第一个碰到的敌人：30% 攻击力 + 20 + 每级 4 的物理伤害。
//
// 规格没写到、实现时定下来的几处：
//   · 技能都不打建筑（照岚的样板）；弹道会被墙和塔座挡住。“每级 N”按当前等级乘。
//   · 穿甲矢和连弩的弹道从英雄脚下的位置算起（和施法指示对得上），画面上是从弩口出去的，头几米并回到弹道上。
//   · 翻滚装填：不管鼠标点得多近，都朝那个方向滚满 5.5 米（碰到墙就停）。暴击在弩矢离弦的那一刻定下来（弩上的火光同时灭掉），
//     命中时翻倍；目标在弩矢飞到之前死了，这次装填还给她。
//   · 火场一共结算 9 次：落地那一下算第一次，之后每 0.5 秒一次；减速每次结算续 0.6 秒，走出去就很快没了。“照出隐身单位”没做。
//   · 连弩齐射 18 发之间的 17 个间隔按等比从 0.26 秒缩到 0.1 秒，合计 2.86 秒（按等差缩要 3.06 秒，最后一发会落到引导时间外面）。
//     每发的飞行速度和碰撞半径规格没给，用 44 和 0.4。
//
// 特效的路子：射手以“线”为主。弹道是一条头亮尾淡的细线，命中是几道溅开的火星和一个很小的亮点，不用大团的光；
// 火只在火油罐的火场里成片出现。地上留的是焦痕、尘和插着的弩矢。
// 动作时间表在 public/assets/hero/vero.json（资源那边做完才有；没有时控制器用默认的出手时间）。

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Actor } from "../actor";
import type { Ent } from "../sim";
import type { Api, Cast, HeroKit, ProjVis, SkillDef } from "../skills";
import { SPR, type Emitter, type FxLib, type V3 } from "../fxlib";
import { flameBed, puff as fire, puffer, reticle, sheet, strip, tracer, wall, warm, type PuffOpts, type Tracer } from "../fx_fx2c";
import { LITE } from "../../quality";
import { pick } from "../fxb";

const BRASS = 0xe9b765, EMBER = 0xff7a2a, OIL = pick(0x2a1a10, 0x381d0c);      // 黄铜、火、火油的黑褐（换画风 B：亮地面上一摊黑像污渍，B 下是深琥珀褐的油，也薄一些）
const HOT = 0xffd9a0, DEEP = 0x9a2c0c, DUST = 0x8f8169;                           // 火心的亮黄、火的暗红、尘土（往地面的颜色靠；第九轮 fx2c 压暗一点，原来在青绿的地面上是一团奶白）
const WOOD = 0x4a3626, IRON = 0xb4b8bc, FEATHER = 0x4a2a1a;                       // 弩矢：木杆、铁镞、尾羽
const isBuilding = (e: Ent) => e.kind === "tower" || e.kind === "core";
const v3 = () => new THREE.Vector3();
const sm = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- 这个文件自己补的零件
// 特效库的弩矢每发新建一份几何体和材质，连弩一口气十八发不合适。这里补两样，都是建一次、用完放回池子：
//   bolt   弩矢的模型：木杆、铁镞、黄铜箍、两片尾羽，合成一个网格
//   stick  射空的弩矢斜插在地上，过一会儿沉下去
// （原来还有一样“line 弹道线：两片交叉的细长条”，俯视时竖着的那片看不见，只剩一条很细的线；第九轮 fx2c 换成 fx_fx2c 的 tracer）
let boltGeo: THREE.BufferGeometry | null = null, boltMat: THREE.MeshStandardMaterial | null = null, headGeo: THREE.BufferGeometry | null = null, headMat: THREE.MeshBasicMaterial | null = null;
const boltPool: THREE.Mesh[] = [];

/** size 整体大小；thick 再加粗几成（飞着的弩矢要比实际的粗，俯视镜头下才看得见）；hot 镞是烧红的 */
function bolt(fx: FxLib, size: number, thick = 1, hot = false): THREE.Mesh {
  if (!boltGeo) {
    const part = (g: THREE.BufferGeometry, color: number) => { const c = new THREE.Color(color), n = g.getAttribute("position").count, arr = new Float32Array(n * 3); for (let i = 0; i < n; i++) c.toArray(arr, i * 3); g.setAttribute("color", new THREE.BufferAttribute(arr, 3)); return g; };
    boltGeo = mergeGeometries([
      part(new THREE.CylinderGeometry(0.03, 0.03, 1.0, 6).rotateX(Math.PI / 2), WOOD),
      part(new THREE.ConeGeometry(0.075, 0.28, 4).rotateX(Math.PI / 2).translate(0, 0, 0.63), IRON),
      part(new THREE.CylinderGeometry(0.044, 0.044, 0.08, 6).rotateX(Math.PI / 2).translate(0, 0, 0.46), BRASS),
      part(new THREE.BoxGeometry(0.014, 0.13, 0.24).translate(0, 0, -0.37), FEATHER), part(new THREE.BoxGeometry(0.13, 0.014, 0.24).translate(0, 0, -0.37), FEATHER)]);
    boltMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.25, emissive: 0x241208, emissiveIntensity: 0.5 });
    headGeo = new THREE.ConeGeometry(0.062, 0.2, 4).rotateX(Math.PI / 2).translate(0, 0, 0.675); headMat = new THREE.MeshBasicMaterial({ color: 0xff8a3a, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });      // 烧红的镞尖：套在铁镞前面那一截上（第九轮 fx2c：叠加发光，原来是一块平涂的橙色三角）
  }
  let m = boltPool.pop(); if (!m) { m = new THREE.Mesh(boltGeo, boltMat!); m.add(new THREE.Mesh(headGeo!, headMat!)); }
  m.scale.set(size * thick, size * thick, size); m.visible = true; m.children[0].visible = hot; fx.group.add(m); return m;
}
const freeBolt = (m: THREE.Mesh) => { m.removeFromParent(); boltPool.push(m); };

function stick(api: Api, fx: FxLib, x: number, z: number, dx: number, dz: number, size: number, life = 2.6) {
  const m = bolt(fx, size, 1.25), pitch = 0.5 + Math.random() * 0.3, cp = Math.cos(pitch), sp = Math.sin(pitch), y0 = fx.ground(x, z) + sp * 0.5 * size;      // 镞埋在地里，杆和尾羽露在外面
  m.position.set(x - dx * cp * 0.5 * size, y0, z - dz * cp * 0.5 * size); m.lookAt(m.position.x + dx * cp, y0 - sp, m.position.z + dz * cp);
  api.run(life, k => { m.position.y = y0 - Math.max(0, k - 0.82) / 0.18 * 0.95 * size; }, () => freeBolt(m));
}

const B0 = v3();
/** 弩口：弩最前头的那一点（模型没有武器时退到手前面一点），再抬高一点：从上往下看，小的火光不会被弩自己挡住 */
function muzzle(a: Actor, out: THREE.Vector3): THREE.Vector3 { if (!a.hero.blade("R", B0, out)) { a.hand(out); out.x += Math.sin(a.yaw()) * 0.9; out.z += Math.cos(a.yaw()) * 0.9; } out.y += 0.15; return out; }

/** 一支飞着的弩矢：模型、身后的弹道光、沿路按距离放的火星或烟。
 *  from 是规则上弹道的起点，tip 是弩口：画面上从弩口出去，头几米并回到规则的弹道上。range 给了的话，飞到最后一段会落向地面（射空了插在地上）。
 *  tail 弹道光最长多长；linger 弩矢没了以后弹道光还留多久。
 *  第九轮 fx2c：弹道光换成正对镜头的一道（fx_fx2c 的 tracer）：中间白热的芯、外面一层橙，从哪个角度看都一样粗。原来是两片交叉的细条，
 *  俯视时竖着的那片看不见，只剩一条很细的线（用户说的“箭太细看不清”主要是这个） */
function boltVis(api: Api, fx: FxLib, o: { from: V3; tip?: THREE.Vector3; size: number; thick?: number; hot?: boolean; tail: number; width: number; core?: number; taper?: number; linger?: number; range?: number; out?: THREE.Vector3; step?: number; trail?: (p: THREE.Vector3) => void }): ProjVis {
  const mesh = bolt(fx, o.size, o.thick ?? 1.5, o.hot), ln = tracer(fx, { width: o.width, core: o.core ?? 0.3, color: 0xff9a3a, color2: 0xc23a10, taper: o.taper ?? 1.1 }), pos = v3(), prev = v3(), d = v3(), off = v3(), q = v3(), tl = v3(); let m = -1, acc = 0, len = 0, seen = false;
  mesh.visible = false;
  return {
    move(x, y, z, dx, dy, dz) {
      d.set(dx, dy, dz); if (d.lengthSq() < 1e-8) d.set(0, 0, 1); d.normalize();
      if (m < 0) { m = 0; if (o.tip) { q.set(o.tip.x - o.from.x, o.tip.y - o.from.y, o.tip.z - o.from.z); m = Math.max(0, Math.min(2.6, q.dot(d))); off.copy(q).addScaledVector(d, -m); if (off.length() > 1.2) off.setLength(1.2); } }
      const gone = Math.hypot(x - o.from.x, y - o.from.y, z - o.from.z), k = 1 - sm((gone - m) / 3.5);
      pos.set(x + off.x * k, y + off.y * k, z + off.z * k);
      if (o.range) { const f = sm((gone / o.range - 0.72) / 0.28); pos.y += (fx.ground(x, z) + 0.2 - pos.y) * f * f; }
      o.out?.copy(pos);
      if (gone < m) return;
      if (!seen) { seen = true; mesh.visible = true; prev.copy(pos).addScaledVector(d, -0.01); }
      q.subVectors(pos, prev); const step = q.length(); if (step > 1e-4) q.divideScalar(step); else q.copy(d);
      mesh.position.copy(pos); mesh.lookAt(pos.x + q.x, pos.y + q.y, pos.z + q.z);
      len = Math.min(o.tail, len + step); ln.set(tl.copy(pos).addScaledVector(q, -len), pos);
      if (o.trail) { acc += step; const every = o.step ?? 1; while (acc >= every) { acc -= every; o.trail(tl.copy(pos).addScaledVector(q, -acc)); } }      // 按飞过的距离放：弹道快，按时间放会聚成一团一团
      prev.copy(pos);
    },
    done() {
      freeBolt(mesh); if (!seen) { ln.free(); return; }
      const head = pos.clone(), dir = q.clone(), L = len; api.run(o.linger ?? 0.14, k => { ln.alpha((1 - k) * (1 - k)); ln.set(tl.copy(head).addScaledVector(dir, -L * (1 - 0.5 * k)), head); }, () => ln.free());      // 弹道光留一下再淡掉
    },
  };
}
/** 弹道后面拖的烟（第九轮 fx2c）：一小团烫的，很快凉成灰黑的烟，往上散 */
const smokeTrail = (fx: FxLib, p: V3, s = 1) => fire(fx, { pos: p, n: 1, heat: [0.12, 0.3], cool: 0.2, smoke: 0x5a514a, opacity: [0.2, 0.3], size: [0.22 * s, 0.34 * s], grow: 3.4, life: [0.6, 0.9], drag: 2, rise: 0.7, speed: [0.1, 0.4] });
/** 一团往外翻的火（烧成黑烟） */
const blaze = (fx: FxLib, o: Partial<PuffOpts> & { pos: V3 }) => fire(fx, { heat: [0.8, 1], cool: 0.55, smoke: 0x3a332f, opacity: [0.35, 0.5], drag: 3.5, rise: 1.5, grow: 2.5, size: [0.4, 0.65], life: [0.45, 0.7], speed: [2, 5], ...o });
/** 黑烟 */
const soot = (fx: FxLib, o: Partial<PuffOpts> & { pos: V3 }) => fire(fx, { heat: 0, smoke: 0x37302c, opacity: [0.3, 0.42], drag: 1, rise: 0.9, grow: 2.3, size: [0.7, 1.1], life: [1.3, 2.0], speed: [0.1, 0.5], ...o });

/** 命中的火星：几道顺着速度拉长的细线，加一个很小的亮点。through：顺着弩矢往前带（穿过去），否则往回溅 */
function sparks(fx: FxLib, at: V3, dx: number, dz: number, n: number, power = 1, through = false) {
  const s = through ? 1 : -1;
  fx.burst({ pos: at, n, sprite: SPR.streak, add: true, color: [HOT, EMBER], dir: { x: dx * s, y: 0.45, z: dz * s }, spread: through ? 0.55 : 0.95, speed: [4 * power, 11 * power], size: [0.18, 0.34], life: [0.14, 0.3], gravity: 15, stretch: 1.1 });
  fx.burst({ pos: at, n: 1, sprite: SPR.glint, add: true, color: [HOT, EMBER], size: 0.6 * power, grow: 1.5, life: 0.12, speed: 0 });
}
/** 出膛：弩口往前的一道短亮线和几点火星 */
function muzzleFire(fx: FxLib, tip: V3, dx: number, dz: number, n: number, power = 1) {
  fx.burst({ pos: tip, n: 1, sprite: SPR.streak, add: true, color: [HOT, EMBER], dir: { x: dx, y: 0, z: dz }, spread: 0, speed: 9, size: 0.9 * power, life: 0.09, stretch: 1 });
  fx.burst({ pos: tip, n, sprite: SPR.streak, add: true, color: [HOT, EMBER], dir: { x: dx, y: 0.12, z: dz }, spread: 0.42, speed: [5 * power, 12 * power], size: [0.14, 0.26], life: [0.1, 0.2], gravity: 6, stretch: 1.2 });
}
/** 贴地的一圈黄铜色细线（不发光）：站稳、落地这类轻的动作用，比特效库的冲击波淡 */
const hoop = (fx: FxLib, x: number, z: number, r: number, life = 0.36) => { fx.decal({ kind: "shock", x, z, r, life, color: BRASS, alpha: 0.6, from: 0.15, fadeIn: 0.05, fadeOut: 0.6 }); };
const ember = (fx: FxLib, p: V3) => fx.burst({ pos: p, n: 1, sprite: SPR.ember, add: true, color: [HOT, EMBER], size: [0.05, 0.1], life: [0.2, 0.4], speed: [0.2, 0.9], gravity: 4 });
const dust = (fx: FxLib, x: number, z: number, n: number, dx = 0, dz = 0) => fx.burst({ pos: { x, y: fx.ground(x, z) + 0.15, z }, n, sprite: SPR.dust, color: [DUST, DUST], alpha: 0.34, dir: { x: dx, y: 0.6, z: dz }, spread: dx || dz ? 0.8 : 1.4, speed: [1, 3.2], size: [0.35, 0.6], grow: 2, life: [0.4, 0.7], drag: 3 });

// ---------------------------------------------------------------- Q 穿甲矢
/** 易伤的记号（第九轮 fx2c）：脚下一个黄铜的瞄准记号（四段弧、四个刻度，慢慢转），伤口上往下掉火星。跟着目标走，到时间或者目标死了就收掉 */
function mark(c: Cast, e: Ent) {
  const { me, a, api, fx } = c, marks: Map<number, { kill: () => void }> = (a.data.marks ??= new Map()); marks.get(e.id)?.kill();
  const ring = reticle(fx, { r: e.r + 0.75, color: BRASS, alpha: 0.85 }); ring.set(e.x, e.z);
  const drip = fx.emitter({ pos: api.pos(e, 1.1), rate: 7, sprite: SPR.ember, add: true, color: [HOT, EMBER], radius: 0.22, size: [0.05, 0.09], life: [0.3, 0.5], speed: [0.1, 0.5], gravity: 5 });
  const z = api.zone({ me, x: e.x, z: e.z, r: 0.1, dur: 4, tick: 99, follow: e,
    frame(zn) { ring.set(zn.x, zn.z); drip.at(zn.x, api.height(zn.x, zn.z) + 1.1, zn.z); if (e.vulnT <= 0) zn.kill(); },
    end() { ring.kill(); drip.stop(); if (marks.get(e.id) === z) marks.delete(e.id); } });
  marks.set(e.id, z);
}

const Q: SkillDef = { key: "Q", name: "穿甲矢", icon: "vero_q", cast: "dir", range: 13, width: 1.0, cd: 7, mana: 60,
  desc: "射出一支穿透的重矢：路径上的敌人受到 120 + 90% 攻击力的物理伤害，并在 4 秒内多受 15% 伤害。",
  start(c) {      // 出手前（第九轮 fx2c）：一条细的瞄准线沿着要射的方向闪过去；周围的火星往弩口收，弩口越来越亮——看得出在蓄这一发
    const { a, api, fx } = c, y = a.pos.y + 1.5, near = { x: a.pos.x + c.dx * 1.7, y, z: a.pos.z + c.dz * 1.7 }, far = { x: a.pos.x + c.dx * 13, y, z: a.pos.z + c.dz * 13 }, ln = tracer(fx, { width: 0.16, core: 0.4, color: BRASS, color2: BRASS, taper: 0.6, hot: 0 });
    ln.set(near, far); api.run(0.3, k => ln.alpha(0.55 * Math.sin(k * Math.PI)), () => ln.free());
    const tip = v3(); let acc = 0, gl = 0;
    api.run(0.6, (k, dt) => { if (c.data.fired) return; muzzle(a, tip); acc += dt * (LITE ? 14 : 28); gl += dt;
      while (acc >= 1) { acc -= 1; const an = Math.random() * 6.2832, r = 1.2 + Math.random() * 1.0, p = { x: tip.x + Math.cos(an) * r, y: tip.y + (Math.random() - 0.3) * 1.0, z: tip.z + Math.sin(an) * r }, tt = 0.22;
        fx.burst({ pos: p, n: 1, sprite: SPR.ember, add: true, color: [EMBER, HOT], dir: { x: tip.x - p.x, y: tip.y - p.y, z: tip.z - p.z }, spread: 0.04, speed: Math.hypot(tip.x - p.x, tip.y - p.y, tip.z - p.z) / tt, size: [0.07, 0.12], life: tt, stretch: 0.8 }); }
      if (gl > 0.07) { gl = 0; fx.burst({ pos: tip, n: 1, sprite: SPR.glint, add: true, color: [HOT, EMBER], size: 0.4 + 0.9 * k, grow: 1.2, life: 0.1, speed: 0 });
        fire(fx, { pos: tip, n: 1, heat: [0.6 + 0.35 * k, 0.75 + 0.25 * k], cool: 0.5, smoke: 0x3a332f, opacity: 0.3, size: [0.18 + 0.3 * k, 0.26 + 0.36 * k], grow: 1.8, life: [0.25, 0.35], speed: [0.2, 0.5], drag: 2, rise: 2 }); } });      // 矢尖上的火越烧越旺
  },
  fire(c) {
    const { me, a, api, fx } = c, tip = muzzle(a, v3()), at = v3(), from = { x: me.x, y: tip.y, z: me.z }, dmg = 120 + c.ad * 0.9 + c.lv * 15; c.data.fired = true;
    // 出手（第九轮 fx2c）：弩口一团火往前喷、很快变烟，一下白芯和一圈；脚下往后一蓬土；这一发重，镜头顿一下
    fx.flash(tip, EMBER, 1.8, 0.12); muzzleFire(fx, tip, c.dx, c.dz, 10, 1.5); fx.shake(0.07, 0.15);
    fx.burst({ pos: tip, n: 1, sprite: SPR.ring, add: true, color: [0xffffff, EMBER], size: 0.7, grow: 2.6, life: 0.14, speed: 0 });
    blaze(fx, { pos: tip, n: 6, dir: { x: c.dx, y: 0.1, z: c.dz }, spread: 0.45, speed: [4, 9], drag: 5, size: [0.35, 0.55], grow: 2.6, life: [0.4, 0.6] });
    soot(fx, { pos: { x: tip.x - c.dx * 0.3, y: tip.y, z: tip.z - c.dz * 0.3 }, n: 3, size: [0.4, 0.6], life: [0.8, 1.2], opacity: [0.28, 0.4] });
    fire(fx, { pos: { x: a.pos.x - c.dx * 0.4, y: fx.ground(a.pos.x, a.pos.z) + 0.2, z: a.pos.z - c.dz * 0.4 }, n: 4, heat: 0, smoke: 0x6e6455, opacity: [0.22, 0.36], dir: { x: -c.dx, y: 0.4, z: -c.dz }, spread: 0.8, speed: [1.5, 3.5], drag: 3, rise: 0.3, size: [0.5, 0.8], grow: 2.2, life: [0.5, 0.8] });
    // 地上烧出的一条焦线：跟着弩矢往前长，0.4 秒后开始凉，事后还看得出射过哪里
    const burn = strip(fx, api, { r: 0.5, life: 3.4, hot: 0.45, cool: 1.0, alpha: 0.7 }), sx = me.x + c.dx * 1.2, sz = me.z + c.dz * 1.2; let reach = 0;
    api.shoot({ me, from, dir: { x: c.dx, z: c.dz }, speed: 40, range: 13, radius: 0.5, pierce: true,
      // 过程：粗一号、镞烧红的弩矢，身后一道六米长的白芯橙边的弹道光，弹道光后面拖一条烟、掉火星
      vis: boltVis(api, fx, { from, tip, size: 1.9, thick: 1.7, hot: true, tail: 13, width: 1.0, core: 0.22, taper: 0.8, linger: 0.4, range: 13, out: at, step: 0.3, trail: p => {
        smokeTrail(fx, p, 1.2); if (Math.random() < 0.6) ember(fx, p); const d = (p.x - sx) * c.dx + (p.z - sz) * c.dz; if (d > reach) { reach = d; burn.span(sx, sz, sx + c.dx * d, sz + c.dz * d); } } }),
      hit(e) {
        if (isBuilding(e)) return false;
        api.hit(me, e, dmg, "phys"); api.expose(e, 0.15, 4); mark(c, e);
        // 命中：一下白芯，穿过去——一团火和一把火星从背后带出来
        const p = { x: e.x, y: at.y, z: e.z }; sparks(fx, p, c.dx, c.dz, 12, 1.4, true); fx.impact(p, { color: HOT, color2: EMBER, size: 1.1, dir: { x: c.dx, y: 0.2, z: c.dz }, sparks: 4 }); fx.ring(e.x, e.z, 1.3, EMBER, 0.26);
        blaze(fx, { pos: { x: p.x + c.dx * 0.4, y: p.y, z: p.z + c.dz * 0.4 }, n: 5, dir: { x: c.dx, y: 0.2, z: c.dz }, spread: 0.45, speed: [4, 9], drag: 4.5, size: [0.35, 0.55], life: [0.45, 0.7] });
        if (e.kind === "hero") fx.hitstop(0.04);
      },
      end(p) {
        if (p.gone >= 13 - 0.05) { const gp = { x: p.x, y: fx.ground(p.x, p.z) + 0.2, z: p.z }; stick(api, fx, p.x, p.z, c.dx, c.dz, 2.0, 3.2); dust(fx, p.x, p.z, 6, c.dx, c.dz); sparks(fx, gp, c.dx, c.dz, 5, 0.8); blaze(fx, { pos: gp, n: 2, dir: { x: 0, y: 1, z: 0 }, spread: 0.8, speed: [0.5, 1.5], size: [0.3, 0.45] }); }      // 飞到头：扎进地里
        else { sparks(fx, at, c.dx, c.dz, 8, 1.1); dust(fx, p.x, p.z, 4); blaze(fx, { pos: at, n: 3, dir: { x: -c.dx, y: 0.4, z: -c.dz }, spread: 0.8, size: [0.3, 0.5] }); }      // 撞在墙上
      } });
  },
  end(c) { c.data.fired = true; },
};

// ---------------------------------------------------------------- W 翻滚装填
const W: SkillDef = { key: "W", name: "翻滚装填", icon: "vero_w", cast: "dir", tapAim: "move", range: 5.5, width: 1.2, cd: 8, mana: 40,
  desc: "朝一个方向翻滚 5.5 米。之后 4 秒内的下一次普攻必定暴击，造成 2 倍伤害。",
  fire(c) {
    const { me, a, api, fx } = c, x0 = a.pos.x, z0 = a.pos.z, [tx, tz] = api.reach(me.x, me.z, c.dx, c.dz, 5.5), now = api.time(); let lx = x0, lz = z0;
    a.data.loadFrom = now + 0.3; a.data.loadTo = now + 0.3 + 4;      // 落地以后的 4 秒
    // 出手：蹬地的一蓬尘（朝后），原地留一个影子
    // 第九轮 polish-old：翻滚只有 0.3 秒，原来缩小看几乎只剩一小团土。加两样：地上一道被蹭出来的暗痕（从起点跟着她拉到落点，事后看得出滚过哪），
    // 路上每隔一段留一个黄铜色的残影（三个，越后面越淡）；蹬地那一下朝后扬起一道矮的土墙
    fx.ghost(a.hero.model, BRASS, 0.34, 0.42); dust(fx, x0, z0, 6, -c.dx, -c.dz);
    wall(fx, api, { x: x0 - c.dx * 0.2, z: z0 - c.dz * 0.2, r: 1.5, h: 0.7, life: 0.4, from: 0.3, color: 0x7a6e5c, alpha: 0.8, arc: 1.1, yaw: Math.atan2(-c.dx, -c.dz) });
    const skid = strip(fx, api, { r: 0.62, life: 2.8, hot: 0, cool: 0, alpha: 0.75 }); skid.span(x0, z0, x0 + c.dx * 0.1, z0 + c.dz * 0.1);
    fire(fx, { pos: { x: x0, y: fx.ground(x0, z0) + 0.25, z: z0 }, n: 5, heat: 0, smoke: 0x6e6455, opacity: [0.24, 0.38], dir: { x: -c.dx, y: 0.5, z: -c.dz }, spread: 0.7, speed: [1.5, 3.5], drag: 3, rise: 0.3, size: [0.55, 0.85], grow: 2.2, life: [0.5, 0.8] });
    // 过程（第九轮 fx2c）：身后两道贴着身子的拖尾（黄铜色，越旧越红、越淡），脚下一路扬土，夹几点火星。原来是两条细线，翻滚一快就看不出形状
    const tr = [0.6, 1.45].map((h, i) => ({ h, t: fx.trail({ color: i ? 0xffd9a0 : BRASS, color2: DEEP, width: i ? 0.7 : 1.1, life: 0.3, alpha: 1, step: 0.1 }) }));
    api.run(0.34, () => { for (const { h, t } of tr) t.at(a.pos.x, a.pos.y + h, a.pos.z); skid.span(x0, z0, a.pos.x, a.pos.z);
      if (Math.hypot(a.pos.x - lx, a.pos.z - lz) < 0.55) return; lx = a.pos.x; lz = a.pos.z; dust(fx, lx, lz, 3, -c.dx * 0.5, -c.dz * 0.5); ember(fx, { x: lx, y: a.pos.y + 0.5, z: lz });
      if (Math.random() < 0.6) { const j = (Math.random() - 0.5) * 0.7; fire(fx, { pos: { x: lx + c.dz * j, y: fx.ground(lx, lz) + 0.2, z: lz - c.dx * j }, n: 1, heat: 0, smoke: 0x6e6455, opacity: [0.2, 0.32], dir: { x: -c.dx, y: 0.5, z: -c.dz }, spread: 0.9, speed: [0.6, 1.8], drag: 3, rise: 0.3, size: [0.4, 0.85], grow: 2.2, life: [0.45, 0.8] }); }      // 一路零星扬起的土（隔一段、左右错开，不排成一串珠子）
    }, () => { for (const { t } of tr) t.stop(); });
    for (const [d, op] of [[0.1, 0.34], [0.2, 0.26]] as const) api.after(d, () => { if (a.state() !== "dead") fx.ghost(a.hero.model, BRASS, 0.3, op); });
    api.dash(me, tx, tz, 0.3, () => {
      // 落地：脚下刹住的土（朝前），弩上“咔”的一下装好了：一下白芯、一圈黄铜的环、矢尖着火
      const tip = muzzle(a, v3()), gy = fx.ground(a.pos.x, a.pos.z); dust(fx, a.pos.x, a.pos.z, 5, c.dx, c.dz); hoop(fx, a.pos.x, a.pos.z, 1.7, 0.34);
      fire(fx, { pos: { x: a.pos.x + c.dx * 0.4, y: gy + 0.25, z: a.pos.z + c.dz * 0.4 }, n: 5, heat: 0, smoke: 0x6e6455, opacity: [0.24, 0.38], dir: { x: c.dx, y: 0.4, z: c.dz }, spread: 1.0, speed: [1.5, 3.5], drag: 3, rise: 0.3, size: [0.5, 0.8], grow: 2.2, life: [0.5, 0.8] });
      fx.burst({ pos: tip, n: 1, sprite: SPR.glint, add: true, color: [0xffffff, EMBER], size: 1.2, grow: 1.5, life: 0.2, speed: 0 }); fx.burst({ pos: tip, n: 1, sprite: SPR.ring, add: true, color: [HOT, BRASS], size: 0.5, grow: 3, life: 0.2, speed: 0 });
      fx.burst({ pos: tip, n: 8, sprite: SPR.streak, add: true, color: [HOT, BRASS], speed: [2, 6], size: [0.12, 0.2], life: [0.15, 0.3], gravity: 9, stretch: 1.1 });
      blaze(fx, { pos: tip, n: 3, dir: { x: 0, y: 1, z: 0 }, spread: 0.8, speed: [0.5, 1.5], size: [0.25, 0.4], life: [0.35, 0.5] });
      api.after(0.2, () => { if (!c.data.over) a.finish(); });      // 落地后留 0.2 秒让“弹起、抖弩”那一下播出来，再放开操作（这次施放要是已经结束了，就别去动她现在在做的事）
    });
  },
  end(c) { c.data.over = true; },
};

// ---------------------------------------------------------------- E 火油罐
// 火场自己画两样（特效库的地火贴花在这里太淡，粒子的火苗朝向是乱的，立不起来）：
//   地上一摊烧着的油：深色的油面上一片片翻动的火，边上一圈烧着的亮线就是范围
//   （原来还有一样“油面上立着的一撮撮小火苗”，第九轮 fx2c 去掉了，立着的火交给 fx_fx2c 的火团：会烧成黑烟，俯视下也不像蜡烛）
const NOISE = /* glsl */ `
  float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
  float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vn(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
`;
let flatGeo: THREE.BufferGeometry | null = null;
function fireField(fx: FxLib, x: number, z: number, r: number) {
  if (!flatGeo) flatGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  const gy = fx.ground(x, z), u = { uTime: { value: fx.time() }, uFire: { value: 0 }, uAlpha: { value: 1 }, uSeed: { value: Math.random() * 40 }, uR: { value: r }, uC: { value: new THREE.Vector3(x, gy + 0.1, z) },
    uOil: { value: new THREE.Color(OIL) }, uDeep: { value: new THREE.Color(DEEP) }, uEmber: { value: new THREE.Color(EMBER) }, uHot: { value: new THREE.Color(HOT) } };
  const oil = new THREE.Mesh(flatGeo, new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    vertexShader: `varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `uniform float uTime, uFire, uAlpha, uSeed; uniform vec3 uOil, uDeep, uEmber, uHot; varying vec2 vP; ${NOISE}
      void main() {
        vec2 p = vP; float r = length(p), th = atan(p.y, p.x);
        float er = 0.93 + (fbm(vec2(cos(th), sin(th)) * 1.8 + uSeed) - 0.47) * 0.13;                       // 油摊的边：不齐，但贴着半径
        float inside = 1.0 - smoothstep(er - 0.012, er + 0.012, r); if (inside < 0.004) discard;
        float n1 = fbm(p * 2.6 + uSeed), n3 = fbm(p * 9.0 - vec2(0.0, uTime * 1.2));
        vec3 col = uOil * (0.4 + 0.6 * n1); float a = (0.84 + 0.12 * n1) * mix(0.75, 1.0, smoothstep(er, er - 0.2, r)) * ${pick(1, 0.94)};      // 油面：发黑，靠边薄一点（和地面融在一起）
        col += vec3(0.2, 0.13, 0.08) * smoothstep(0.64, 0.8, fbm(p * 4.6 + vec2(uTime * 0.07, 0.0) + uSeed * 1.3)) * 0.35;      // 一点油光
        // 第九轮 polish-old：原来油面上满是一道道烧红的火线，整片读成一张熔岩饼。现在油面本身是黑的，烧着的地方只是火苗底下透上来的一片暗红的光（一块块、一明一暗），
        // 立着的火交给 fx_fx2c 的 flameBed；边上一圈暗红的光垫在那圈火苗底下
        float patch_ = smoothstep(0.5, 0.74, fbm(p * 1.7 + vec2(uTime * 0.08, -uTime * 0.05) + uSeed * 3.0)) * (0.7 + 0.3 * vn(p * 6.0 + uTime * 2.5));
        float rim = smoothstep(er - 0.16, er - 0.03, r) * (1.0 - smoothstep(er - 0.03, er, r)) * (0.65 + 0.35 * vn(vec2(th * 9.0 + uSeed, uTime * 2.4)));
        float f = clamp(patch_ * 0.5 + rim * 0.75 + smoothstep(0.7, 0.85, n3) * patch_ * 0.2, 0.0, 1.0) * uFire;
        col = mix(col, uDeep * 0.85, smoothstep(0.0, 0.45, f)); col = mix(col, uEmber, smoothstep(0.45, 0.9, f) * 0.55);
        gl_FragColor = vec4(col, a * inside * uAlpha);
        #include <colorspace_fragment>
      }` }));
  oil.position.set(x, gy + 0.08, z); oil.scale.setScalar(r / 0.93); oil.renderOrder = 4.5; oil.frustumCulled = false;
  fx.group.add(oil);      // 第九轮 fx2c：原来油面上还立着一排叠加发光的小火苗（一次画完的实例），俯视下像一根根蜡烛，去掉了；立着的火改成 fx_fx2c 的火团
  return {
    /** 每帧：fire 火有多旺（0 到 1），alpha 整摊油还剩多少 */
    set(f: number, alpha: number) { u.uTime.value = fx.time(); u.uFire.value = f; u.uAlpha.value = alpha; },
    kill() { fx.group.remove(oil); (oil.material as THREE.Material).dispose(); },
  };
}

/** 火油罐落地：碎开、溅油、起火，然后是 4.5 秒的火场 */
function burn(c: Cast, x: number, z: number) {
  const { me, api, fx } = c, RAD = 3.2, DUR = 4.5, at = { x, y: fx.ground(x, z) + 0.3, z }, dmg = 25 + c.lv * 5 + c.ad * 0.1, field = fireField(fx, x, z, RAD); let ticks = 0, acc = 0;
  // 落地（第九轮 fx2c 重做）：一下白芯；一团火球往上翻、烧成黑烟（原来是一道叠加发光的火柱，看着是一团橙光）；一圈火墙往外推；
  // 陶片和油往外溅，油点落到哪、那里过一会儿窜起一撮火——火是从中间往外铺开的
  // 第九轮 polish-old：火球 9 + 10 团 → 4 + 5 团、橙而不白；形状交给一层从落点往外漫开的火（油泼到哪火烧到哪），外面一圈火墙
  fx.flash(at, EMBER, 1.2, 0.1); fx.impact(at, { color: EMBER, color2: EMBER, size: 0.8, big: true }); fx.shake(0.07, 0.18);
  blaze(fx, { pos: { x, y: at.y + 0.2, z }, n: 4, dir: { x: 0, y: 1, z: 0 }, spread: 0.8, speed: [2.5, 5], drag: 2.6, size: [0.7, 1.0], grow: 2.3, life: [0.7, 1.0], rise: 2.4, radius: 0.4, heat: [0.6, 0.78] });
  blaze(fx, { pos: { x, y: at.y, z }, n: 5, dir: { x: 0, y: 0.15, z: 0 }, spread: 1.45, speed: [5, 9], drag: 4, size: [0.45, 0.7], grow: 2.3, life: [0.45, 0.7], heat: [0.55, 0.75] });
  sheet(fx, api, { x, z, r: RAD * 1.02, life: 0.9, reach: 0.28, from: 0.1, band: 0.45, heat: 0.8, soot: 0.15 });
  wall(fx, api, { x, z, r: RAD * 1.05, h: 1.0, life: 0.42, from: 0.15, fire: true, alpha: 0.8 });
  fx.burst({ pos: at, n: 10, sprite: SPR.shard, color: [0x4a3626, OIL], speed: [3, 7], up: 3, size: [0.12, 0.22], life: [0.5, 0.8], gravity: 15, spin: 9, spread: 1.4 });
  fx.burst({ pos: at, n: 16, sprite: SPR.drop, color: [OIL, OIL], alpha: 0.85, speed: [3, 8], up: 2, size: [0.12, 0.22], life: [0.35, 0.6], gravity: 16, spread: 1.5, stretch: 0.8 });
  fx.burst({ pos: at, n: 14, sprite: SPR.streak, add: true, color: [HOT, EMBER], speed: [4, 10], up: 3, size: [0.14, 0.26], life: [0.25, 0.5], gravity: 14, spread: 1.4, stretch: 1.1 });
  for (let i = 0; i < 9; i++) { const an = Math.random() * 6.2832, r = RAD * (0.35 + 0.6 * Math.random()), px = x + Math.cos(an) * r, pz = z + Math.sin(an) * r;      // 油点落地起火
    api.after(0.12 + r / RAD * 0.25, () => fx.burst({ pos: { x: px, y: fx.ground(px, pz) + 0.15, z: pz }, n: 4, sprite: SPR.ember, add: true, color: [HOT, EMBER], size: [0.06, 0.11], life: [0.35, 0.6], speed: [0.5, 1.8], up: 1.6, gravity: 5 })); }      // polish-old：原来这里窜起一撮立着的火舌（俯视像一个个橙色的锥子），点火交给火苗那一片（从中间往外点着），这里只溅几点火星
  // 地上：底下一块焦痕（火灭了以后还留着，慢慢淡掉），上面是烧着的油
  fx.decal({ kind: "scorch", x, z, r: RAD + 0.1, life: 11, color: EMBER, alpha: 0.62, fadeIn: 0.02, fadeOut: 0.5 });
  // 火场的范围（第九轮 polish-old）：原来是油摊边上一圈矮火墙，俯视只剩一道发亮的橙线；换成一片立在地上的小火苗，边上密密一圈，里面一簇簇稀的，从落点往外点着
  const ring = flameBed(fx, { x, z, r: RAD * 0.95, h: 1.2, w: 0.85, heat: 0.74 }); ring.ignite(0); api.run(0.35, k => ring.ignite(k));
  const cols = [0, 1, 2].map(i => { const an = i * 2.1 + Math.random(), r = RAD * (0.25 + 0.35 * Math.random()), px = x + Math.cos(an) * r, pz = z + Math.sin(an) * r;      // 油烧出来的黑烟：几柱成股往上走
    return puffer(fx, { pos: { x: px, y: fx.ground(px, pz) + 0.8, z: pz }, rate: 4, heat: [0.15, 0.3], cool: 0.2, smoke: 0x2e2825, opacity: [0.32, 0.45], size: [0.6, 0.9], grow: 2.4, life: [1.4, 2.0], speed: [0.1, 0.3], up: 0.8, drag: 0.6, rise: 1.0, radius: 0.3 }); });
  api.zone({ me, x, z, r: RAD, dur: DUR, tick: 0.5,
    every() { ticks++; },
    each(e) { if (ticks > 9 || isBuilding(e)) return; api.hit(me, e, dmg, "magic"); api.slow(e, 0.25, 0.6);
      blaze(fx, { pos: api.pos(e, 0.5), n: 2, dir: { x: 0, y: 1, z: 0 }, spread: 0.5, speed: [0.5, 1.5], size: [0.28, 0.42], grow: 2, life: [0.35, 0.5], heat: [0.5, 0.68], radius: 0.25 });      /* polish-old：原来是两撮立着的火舌，俯视像脚下插了两个橙色锥子 */
      fx.burst({ pos: api.pos(e, 0.9), n: 3, sprite: SPR.ember, add: true, color: [HOT, EMBER], radius: 0.3, size: [0.07, 0.13], life: [0.3, 0.55], speed: [0.3, 1], up: 1.6 }); },
    // 火场里（第九轮 fx2c）：一撮撮立着的火舌此起彼伏、往上飘的火星、几柱黑烟（油烧出来的烟是黑的、成柱往上走）；最后不到一秒火慢慢小下去
    frame(zn, dt) {
      const k = Math.min(1, zn.t / 0.25) * Math.min(1, (DUR - zn.t) / 0.8); field.set(k, 1); ring.alpha(k); acc += dt * (LITE ? 8 : 16) * k;
      while (acc >= 1) { acc -= 1; const r = RAD * 0.9 * Math.sqrt(Math.random()), th = Math.random() * 6.2832, px = x + Math.cos(th) * r, pz = z + Math.sin(th) * r, gy = fx.ground(px, pz), p = { x: px, y: gy + 0.3, z: pz }, roll = Math.random();
        if (roll < 0.75) fx.burst({ pos: p, n: 1, sprite: SPR.ember, add: true, color: [HOT, EMBER], size: [0.06, 0.11], life: [0.6, 1.2], speed: [0.2, 0.7], up: 1.9, drag: 0.6 });      // 往上飘的火星
        else soot(fx, { pos: { x: px, y: gy + 0.8, z: pz }, n: 1, rise: 1.4, size: [0.6, 0.9], opacity: [0.26, 0.38] }); }      // 偶尔一缕黑烟（油烧出来的烟是黑的）
    },
    end() { ring.kill(); for (const c of cols) c.stop(); soot(fx, { pos: { x, y: at.y + 0.5, z }, n: 6, disc: RAD * 0.6, opacity: [0.3, 0.42] }); api.run(0.7, k => field.set(0, 1 - k), () => field.kill()); } });      // 火灭了：油面淡掉，冒最后一团烟，剩下焦痕
}

const E: SkillDef = { key: "E", name: "火油罐", icon: "vero_e", cast: "point", range: 9, radius: 3.2, cd: 12, mana: 70,
  desc: "抛出火油罐，落地形成 4.5 秒的火场：持续灼烧里面的敌人并减速 25%。",
  start(c) { const { a, fx } = c; fx.burst({ pos: a.hand(v3(), "Left"), n: 5, sprite: SPR.streak, add: true, color: [HOT, EMBER], speed: [1, 3], up: 1, size: [0.1, 0.18], life: [0.15, 0.3], gravity: 6, stretch: 1 }); },      // 出手前：手上的引信点着了
  fire(c) {
    const { me, a, api, fx } = c, from = a.hand(v3(), "Left"), x = c.x, z = c.z, dist = Math.hypot(x - from.x, z - from.z), flask = fx.proj("flask", EMBER, 1.3);
    const wick = fx.emitter({ pos: from, rate: 46, sprite: SPR.ember, add: true, color: [HOT, EMBER], size: [0.07, 0.14], life: [0.18, 0.36], speed: [0.2, 0.8], gravity: 3 });
    const fume = puffer(fx, { pos: from, rate: 30, heat: [0.5, 0.8], cool: 0.25, smoke: 0x4a423c, opacity: [0.24, 0.34], size: [0.18, 0.28], grow: 3, life: [0.5, 0.75], speed: 0.3, drag: 2, rise: 0.6 });      // 第九轮 fx2c：引信烧出来的一缕烟，在天上拖成一道
    const flame = puffer(fx, { pos: from, rate: 26, heat: 1, cool: 0.7, opacity: 0.3, size: [0.16, 0.26], grow: 1.6, life: [0.18, 0.28], speed: 0.4, drag: 2, rise: 2 });
    fx.decal({ kind: "disc", x, z, r: 3.2, life: 0.64, color: EMBER, alpha: 0.5, fadeIn: 0.25, fadeOut: 0.1 });      // 落点的预告：罐子还在天上，圈先到
    api.shoot({ me, from, to: { x, z }, arc: 2.8, speed: Math.max(dist, 0.05) / 0.6,
      vis: { move(px, py, pz, _dx, _dy, _dz, dt) { flask.obj.position.set(px, py, pz); flask.obj.rotation.x += 10 * dt; flask.obj.rotation.z += 4 * dt; wick.at(px, py + 0.2, pz); fume.at(px, py, pz); flame.at(px, py + 0.25, pz); }, done() { flask.kill(); wick.stop(); fume.stop(); flame.stop(); } },
      end() { burn(c, x, z); } });
  },
};

// ---------------------------------------------------------------- R 连弩齐射
const SHOTS = 18, SWEEP = 1, FAN = 0.27;      // SWEEP：弩矢从扇形的哪一边排起，和动作里弩口扫的方向一致（截图对过）      // 扇形从 0.38 收窄：太散的时候单个目标只吃得到四分之一的箭
const GAPS = Array.from({ length: SHOTS - 1 }, (_, i) => 0.26 * Math.pow(0.1 / 0.26, i / (SHOTS - 2)));      // 两发之间的间隔：0.26 秒等比缩到 0.1 秒

/** 每一发落下的地方留一小块焦痕（第九轮 fx2c）：三秒里一块块叠起来，扇形里被射过的地方一眼看得出 */
const scar = (fx: FxLib, x: number, z: number) => fx.decal({ kind: "scorch", x, z, r: 0.6, life: 2.2, color: EMBER, alpha: 0.6, fadeIn: 0.02, fadeOut: 0.5 });
/** 连弩的一发 */
function volley(c: Cast, i: number) {
  const { me, a, api, fx } = c, tip = muzzle(a, v3()), at = v3(), heat = i / (SHOTS - 1), last = i === SHOTS - 1;
  // 动作里弩口是从左慢慢扫到右的，所以弩矢也按先后从扇形的一边排到另一边（各带一点随机偏差），和弩口指的方向对得上
  const jit = (((c.data.seed * 97 + i * 0.618034) % 1) - 0.5) * 0.16, ang = SWEEP * (-1 + 2 * i / (SHOTS - 1) + jit) * FAN * 0.95, cs = Math.cos(ang), sn = Math.sin(ang), dx = c.dx * cs - c.dz * sn, dz = c.dx * sn + c.dz * cs;      // 在扇形里偏一点：用黄金分割的序列，看着是乱的，其实铺得匀
  const from = { x: me.x, y: tip.y, z: me.z }, dmg = c.ad * 0.35 + 25 + c.lv * 5, size = last ? 2.0 : 1.65;      /* 第九轮：用户说箭太细看不清。弩矢本身只大一点（再大就像根木头），主要靠弹道光加粗加亮 */
  // 出膛：弩口一小团火往前喷（很快变烟）、一下火光，往前一道亮线和几点火星；越射越烫
  fx.flash(tip, i % 2 ? EMBER : HOT, 1.0 + heat * 0.6, 0.08, last); muzzleFire(fx, tip, dx, dz, 4 + Math.round(heat * 3), 1 + heat * 0.3);
  blaze(fx, { pos: tip, n: last ? 5 : 3, dir: { x: dx, y: 0.1, z: dz }, spread: 0.4, speed: [3, 8], drag: 6, size: last ? [0.45, 0.65] : [0.28, 0.45], grow: 2.4, life: [0.3, 0.45] });
  if (last) { fx.shake(0.08, 0.18); hoop(fx, a.pos.x, a.pos.z, 2.0); dust(fx, a.pos.x, a.pos.z, 6, -c.dx, -c.dz); fx.burst({ pos: tip, n: 1, sprite: SPR.ring, add: true, color: [0xffffff, EMBER], size: 0.7, grow: 2.8, life: 0.15, speed: 0 }); }
  api.shoot({ me, from, dir: { x: dx, z: dz }, speed: 44, range: 12, radius: 0.4,
    // 过程（第九轮 fx2c）：粗的弹道光（白芯橙边，正对镜头，俯视也一样粗），后面拖一条很快散掉的烟；弩矢没了以后弹道光还留三分之一秒。越射越快，扇形里的光越来越密
    vis: boltVis(api, fx, { from, tip, size, thick: last ? 1.8 : 1.7, hot: true, tail: 13, width: last ? 1.6 : 1.2, core: 0.2, taper: 0.7, linger: last ? 0.6 : 0.45, range: 12, out: at, step: LITE ? 1.6 : 0.8, trail: p => { ember(fx, p); smokeTrail(fx, p, last ? 1.3 : 1); } }),      // 弹道光从弩口一直拉到落点、留小半秒：越射越快，扇形里叠满一道道火光
    hit(e) { if (isBuilding(e)) return false; api.hit(me, e, dmg, "phys"); const p = { x: e.x, y: at.y, z: e.z }; scar(fx, e.x - dx * 0.4, e.z - dz * 0.4); sparks(fx, p, dx, dz, last ? 11 : 7, last ? 1.4 : 1.1); fx.impact(p, { color: HOT, color2: EMBER, size: last ? 1.4 : 0.95, big: last, dir: { x: dx, y: 0.3, z: dz }, sparks: 3 });
      blaze(fx, { pos: { x: p.x + dx * 0.3, y: p.y, z: p.z + dz * 0.3 }, n: last ? 6 : 2, dir: { x: dx, y: 0.3, z: dz }, spread: 0.6, speed: [2, 5], size: last ? [0.45, 0.7] : [0.3, 0.45], life: [0.4, 0.6] }); if (last && e.kind === "hero") fx.hitstop(0.06); },
    end(p, hit) {
      if (hit) return; const gp = { x: p.x, y: fx.ground(p.x, p.z) + 0.25, z: p.z }; scar(fx, p.x, p.z);
      if (p.gone >= 12 - 0.05) { stick(api, fx, p.x, p.z, dx, dz, size); dust(fx, p.x, p.z, 3, dx, dz); sparks(fx, gp, dx, dz, 4, 0.8); blaze(fx, { pos: gp, n: 1, dir: { x: 0, y: 1, z: 0 }, spread: 0.6, speed: [0.5, 1.5], size: [0.28, 0.4], life: [0.4, 0.55] }); }      // 射空：扎进地里，溅土、火星、一小团火
      else { sparks(fx, at, dx, dz, 4, 0.8); blaze(fx, { pos: at, n: 1, size: [0.28, 0.4] }); }
    } });
}

const R: SkillDef = { key: "R", name: "连弩齐射", icon: "vero_r", cast: "dir", range: 12, angle: FAN, cd: 60, mana: 100, minLevel: 6, channel: 3,
  desc: "站定 3 秒，朝一个扇形连续射出 18 发弩矢，越射越快。移动可以提前结束。",
  start(c) {      // 出手前：站稳，脚下一圈尘；地上的扇形亮出来，整段引导都在
    const { a, fx } = c;
    c.data.cone = fx.decal({ kind: "cone", x: a.pos.x, z: a.pos.z, r: 12, angle: FAN, yaw: Math.atan2(c.dx, c.dz), life: 99, color: BRASS, alpha: 0.36, fadeIn: 0.003, fadeOut: 0 });
    hoop(fx, a.pos.x, a.pos.z, 1.8, 0.4); dust(fx, a.pos.x, a.pos.z, 8);
    fx.burst({ pos: muzzle(a, v3()), n: 1, sprite: SPR.glint, add: true, color: [HOT, BRASS], size: 0.7, grow: 1.6, life: 0.24, speed: 0 });
  },
  fire(c) {
    c.data.n = 0; c.data.next = 0; c.data.seed = Math.random();
    c.data.heat = c.fx.emitter({ pos: muzzle(c.a, v3()), rate: 0, sprite: SPR.glint, add: true, color: [HOT, EMBER], size: [0.3, 0.5], life: [0.1, 0.16], speed: 0 });      // 弩口越射越烫
    c.data.fume = puffer(c.fx, { pos: muzzle(c.a, v3()), rate: 0, heat: [0.3, 0.6], cool: 0.25, smoke: 0x4a423c, opacity: [0.24, 0.34], size: [0.25, 0.4], grow: 2.6, life: [0.7, 1.0], speed: [0.2, 0.6], up: 0.6, drag: 1.5, rise: 1.2 });      // 越射越烫，弩口冒的烟越来越多
    R.tick!(c, 0);
  },
  tick(c) {
    while (c.data.n < SHOTS && c.t >= c.data.next) { volley(c, c.data.n); c.data.next += GAPS[c.data.n] ?? 99; c.data.n++; }
    const tip = muzzle(c.a, T1), heat = c.data.heat as Emitter; heat.at(tip.x, tip.y, tip.z); heat.rate = 4 + 22 * (c.data.n / SHOTS); c.data.fume.at(tip.x, tip.y + 0.1, tip.z); c.data.fume.rate(2 + 12 * (c.data.n / SHOTS));
  },
  end(c) {
    const { a, fx } = c; c.data.cone?.kill(0.35); (c.data.heat as Emitter | undefined)?.stop(); c.data.fume?.stop();
    if (c.data.n) { const tip = muzzle(a, v3()); soot(fx, { pos: tip, n: 2 + Math.round(c.data.n / 5), size: [0.35, 0.55], life: [0.9, 1.3], opacity: [0.32, 0.45] }); if (c.data.n >= SHOTS) fx.burst({ pos: tip, n: 6, sprite: SPR.ember, add: true, color: [HOT, EMBER], size: [0.06, 0.11], life: [0.5, 0.9], speed: [0.3, 1], up: 1.2, drag: 1 }); }      // 收：弩口冒烟
  },
};

const T1 = v3(), T2 = v3();
export const vero: HeroKit = {
  id: "vero", name: "薇萝", title: "烬弩", role: "射手", side: 1, color: BRASS, color2: EMBER, height: 3.3,
  look: { lift: 1.6, sat: 1.9, rim: 1.6 },      /* 换画风 B（w-vs）：卡通版是深红皮甲加深棕，场景的天光偏冷，默认的饱和度（1.3 × HB 0.7）下红色发粉、棕色发灰（游戏里量 (127,49,64)，设定图 (112,36,39)），
                                                  饱和度 1.9 回到 (150,38,62)；整体偏暗，提亮 1.6、顺光亮边 1.6（红土上亮部 p90 0.78 → 0.81，地面 0.50）。只对 B 的模型这么调，HB 的默认值不动 */
  base: { hp: 2900, mana: 550, ad: 185, ap: 0, armor: 22, mr: 22, ms: 5.7, as: 1.05, range: 8.5, cdr: 0, ls: 0, hpRegen: 0.005, manaRegen: 0.012 },
  ranged: { speed: 34, shot({ a, api, fx, from, target }) {
    const now = api.time(), tip = muzzle(a, v3()), keep = a.data.loadTo ?? 0, hot = keep > now, at: THREE.Vector3 = (a.data.hitAt ??= v3());
    const l = Math.hypot(target.x - tip.x, target.z - tip.z) || 1, dx = (target.x - tip.x) / l, dz = (target.z - tip.z) / l;
    if (hot) { a.data.loadTo = 0; a.data.hot = target.id; fx.flash(tip, EMBER, 1.5, 0.1, false); blaze(fx, { pos: tip, n: 4, dir: { x: dx, y: 0.1, z: dz }, spread: 0.45, speed: [3, 7], drag: 5.5, size: [0.3, 0.45], life: [0.35, 0.5] }); }      // 装填过的这一发：离弦时就定下是暴击；弩口喷一小团火
    // 出膛：弩口往前的一道短亮线和几点火星
    muzzleFire(fx, tip, dx, dz, hot ? 8 : 4, hot ? 1.3 : 1);
    // 过程：一支弩矢，身后一条短的弹道光，沿路掉几点火星；装填过的那一发是一支烧着的大矢，弹道光粗一倍、后面拖烟
    const vis = boltVis(api, fx, { from, tip, size: hot ? 1.9 : 1.2, thick: hot ? 1.8 : 1.5, hot, tail: hot ? 4.5 : 2.4, width: hot ? 0.55 : 0.22, core: hot ? 0.3 : 0.35, out: at, step: hot ? 0.4 : 0.9, trail: hot ? p => { ember(fx, p); smokeTrail(fx, p, 1.1); } : p => ember(fx, p) });
    return { move: vis.move, done(hit) { vis.done(hit); if (!hit && hot && a.data.hot === target.id) { a.data.hot = 0; a.data.loadTo = keep; } } };      // 目标先死了：这次装填还给她
  } },
  skills: [Q, W, E, R],
  attack(c) {
    const { me, a, api, fx, target: e } = c, at: V3 = a.data.hitAt ?? api.pos(e, 1.2), l = Math.hypot(e.x - me.x, e.z - me.z) || 1, dx = (e.x - me.x) / l, dz = (e.z - me.z) / l;
    if (a.data.hot === e.id) {      // 翻滚装填的那一发：2 倍
      a.data.hot = 0; sparks(fx, at, dx, dz, 12, 1.4); fx.impact(at, { color: HOT, color2: EMBER, size: 1.3, big: true, dir: { x: -dx, y: 0.4, z: -dz } }); fx.shake(0.06, 0.12);      // 第九轮 fx2c：暴击的那一下炸开一团火（烧成黑烟）、一圈火墙，和普通的一发一眼分得开
      blaze(fx, { pos: at, n: 8, spread: 1.3, speed: [2.5, 6], drag: 4, size: [0.45, 0.7], life: [0.5, 0.75] }); wall(fx, api, { x: e.x, z: e.z, r: 1.7, h: 1.1, life: 0.32, from: 0.25, fire: true });
      fx.burst({ pos: at, n: 6, sprite: SPR.ember, add: true, color: [HOT, EMBER], size: [0.07, 0.13], life: [0.35, 0.6], speed: [1, 3], up: 1.5, gravity: 6 });
      return Math.round(c.dmg * 2);
    }
    sparks(fx, at, dx, dz, 5);      // 普攻命中：一点火花
  },
  passive(c) {
    // 装填好了：弩上压着的那支矢烧得发亮（沿着弩身的一道亮线），弩口一点跳动的火光，偶尔掉一粒火星；最后一秒火光变弱
    // 第九轮 fx2c：矢尖上真的烧着一小撮火（往上窜、冒一点烟），比原来的几点光看得清：一眼知道“下一发是装填过的”
    warm(c.fx, c.api, c.me.x, c.me.z);      // 第九轮 fx2c：新零件的着色器在第一帧编好（只做一次）
    const { me, a, api, fx } = c, now = api.time(), left = (a.data.loadTo ?? 0) - now, on = me.alive && left > 0 && now >= (a.data.loadFrom ?? 0), g = a.data.glow as { core: Emitter; drip: Emitter; ln: Tracer; flame: ReturnType<typeof puffer> } | undefined;
    if (!on) { if (g) { g.core.stop(); g.drip.stop(); g.ln.free(); g.flame.stop(); a.data.glow = undefined; } return; }
    const tip = muzzle(a, T1), base = a.hero.blade("R", T2, B0) ? T2 : a.hand(T2); tip.y += 0.05; base.y += 0.2;      // 整条线抬到弩身上面
    if (!g) { a.data.glow = { ln: tracer(fx, { width: 0.3, core: 0.35, color: HOT, color2: EMBER, taper: 0.7 }), core: fx.emitter({ pos: tip, rate: 16, sprite: SPR.glint, add: true, color: [HOT, EMBER], size: [0.5, 0.75], life: [0.14, 0.2], speed: 0 }), drip: fx.emitter({ pos: tip, rate: 7, sprite: SPR.ember, add: true, color: [HOT, EMBER], size: [0.05, 0.09], life: [0.3, 0.5], speed: [0.2, 0.6], gravity: 4 }),
      flame: puffer(fx, { pos: tip, rate: 26, heat: [0.75, 0.95], cool: 0.5, smoke: 0x3a332f, opacity: 0.3, size: [0.22, 0.34], grow: 2.0, life: [0.3, 0.45], speed: [0.1, 0.3], drag: 1.5, rise: 2.2 }) }; return; }
    g.core.at(tip.x, tip.y, tip.z); g.drip.at(tip.x, tip.y, tip.z); g.flame.at(tip.x, tip.y - 0.05, tip.z); g.flame.rate(left < 1 ? 10 : 22); g.core.rate = left < 1 ? 8 : 16; g.ln.set(base, tip); g.ln.alpha((left < 1 ? 0.45 : 0.85) * (0.85 + 0.15 * Math.sin(now * 14)));
  },
};
