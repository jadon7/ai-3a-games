// 乌戈 · 渊灯（法师，沉月会）。两足的鮟鱇鱼人，额前一根粗骨钓竿挂一盏冷光灯。设计在 docs/round9/heroes/DESIGN.md 的“乌戈”一节。
//
// 规格（第九轮第三批 k-ugo 实现；数值是设计的第一版，跑对局以后调过的写在后面）：
//   被动 盯光   技能打中敌人时给它挂“盯光” 4 秒（只有一层）。乌戈的下一个技能打中带盯光的目标时消耗掉它，多打 60 + 25% 法强 + 每级 8 的魔法伤害。
//   Q 冷光束   非指向直线，距离 12，宽 1.1，冷却 6，法力 60。灯球聚光 0.3 秒，然后一道光束瞬间打穿整条线：线上每个敌人 200 + 70% 法强 + 每级 30。
//   W 诱光     非指向，距离 10，宽 0.9，冷却 12，法力 80。甩出一颗小灯（速度 18），打中第一个敌人：魅惑 1.3 秒（朝乌戈走 3 米，api.pull 的硬控），
//              受 120 + 40% 法强 + 每级 15。
//   E 磷潮     范围，距离 9，半径 3.2，冷却 10，法力 70。洒下一片发光的浮游生物，持续 4 秒：里面的敌人减速 20%，每 0.5 秒受 22 + 每级 5 + 10% 法强（一共 8 跳）；
//              里面的敌人对乌戈这一队现形（“照出来”，不破隐身；新加的 api.reveal）。
//   R 渊口     范围，距离 11，半径 3.6，6 级，冷却 75，法力 130。落点先出一圈往里收的尖牙预警，1.0 秒后一张巨大的鮟鱇鱼嘴从地下冲上来一口合上：
//              范围内 400 + 90% 法强 + 每级 50，眩晕 1 秒；离中心 1.4 米以内的多受 25%。
//
// 实现时定下来的、规格里没写的事：
//   · “每级 N”按“等级 × N”算（和奥森一样）。四个技能都不打建筑（塔、水晶）：光束穿过去，范围技能把它们略过。
//   · 盯光：一次施放对同一个目标只算一次（磷潮 8 跳里只有第一跳挂上或者消耗盯光，不然一片磷潮能吃四次被动）；消耗掉的那一下不再挂新的。
//     额外伤害单独打一下（单独一个伤害数字，眼睛“啪”地碎掉），主伤害已经把目标打死就不打。小兵、野怪也挂（推线有一点帮助），小兵头上的眼睛画得更小更淡。
//   · 磷潮落地比出手晚 0.2 秒（光点要飞过去），所以伤害和减速从出手后 0.2 秒开始算，还是 4 秒、8 跳。
//   · 诱光的魅惑：用 api.pull 做（对英雄是硬控：打断、1.3 秒里动不了，被拖着朝乌戈走 3 米）；被魅惑的英雄转过身、播跑步的动作朝乌戈走（不是站着滑过来）。
//   · 渊口：伤害在巨嘴合上的那一刻（出手后 1.0 秒）结算；预警的 1.0 秒里尖牙从边上往里收，最后 0.18 秒嘴从水里冲出来、张开，然后合上。
//
// 特效的路数（第二轮的标准，见 docs/round9/FX2.md、docs/round9/k-ugo/分镜.md）：沉月会里唯一偏紫的冷光，主色渊蓝紫 #7C8CFF，灯心近白 #D8E4FF，垫底的深水 #141A33。
// 亮的只有灯心和命中那一下，主体是有颜色的半透明；深色地面上靠“暗底加亮边”读得清，不靠更亮。深海的冷光要克制：不满屏发紫，光点少而精。
// 巨嘴做成深海的、有体积的、干净的：半透明的深靛色颌、一道淡紫的轮廓光、一排整齐的珍珠白牙、嘴里一点灯光；不做血、不做乱牙。新零件在 ../fx_k-ugo.ts。
// 动作时间表在 public/assets/hero/ugo.json（q 补了 pre 0.3：灯球聚光正好 0.3 秒）。远程普攻从灯上出（灯是模型里的 weapon_lamp 材质，游戏把它当武器尖）。

import * as THREE from "three";
import type { Actor } from "../actor";
import type { Ent } from "../sim";
import type { Api, Cast, HeroKit, ProjVis, SkillDef } from "../skills";
import { SPR, type FxLib, type V3 } from "../fxlib";
import { pick } from "../fxb";
import { crown, mark, warmFx2a, windup } from "../fx_fx2a";
import { thickRing, warm2b } from "../fx_fx2b";
import { CAM, beam, eye, glow, jaws, maw, shade, tether, tide, trace, warmUgo, type Eye, type Glow } from "../fx_k-ugo";

// 换画风 B（b-fx）：亮地面上浅蓝紫的光束、光圈发白，近黑的深水垫底成了污渍。B 下渊蓝紫饱和一档，深水是同色系的深靛（不是黑）
const MAIN = pick(0x7c8cff, 0x5c6cff), CORE = 0xd8e4ff, DEEP = pick(0x141a33, 0x27318a);                  // 渊蓝紫、灯心近白、深水
const INDIGO = pick(0x24304f, 0x2c3a78), PEARL = 0xe8e4da, FOAM = 0xe4e8ff, DUSK = 0x3a4590, LILAC = pick(0xaab4ff, 0x8494ff);      // 皮肤的深靛、牙的珍珠母、水沫（白里一点点紫）、暗一档的蓝紫、亮一档的淡紫
const TAU = Math.PI * 2;
const isBuilding = (e: Ent) => e.kind === "tower" || e.kind === "core";
const v3 = () => new THREE.Vector3();
const sat = (x: number) => Math.max(0, Math.min(1, x));
type Ctx = { me: Ent; a: Actor; api: Api; fx: FxLib };

// ---------------------------------------------------------------- 灯
const tA = v3();
/** 灯在哪：模型里 weapon_lamp 那块离头骨最远的点（就是灯球）；没有就用出手点（头骨往上抬） */
const lampAt = (a: Actor, out: THREE.Vector3) => (a.hero.blade("R", tA, out) ? out : a.hand(out));
/** 灯的材质（模型里的 weapon_lamp）：大招起手时让它暗下去（“整个人的光收回去”），合上那一下再亮回来 */
function lampMats(a: Actor): THREE.MeshStandardMaterial[] {
  if (!a.data.lampMats) { const l: THREE.MeshStandardMaterial[] = []; a.hero.model.traverse(o => { const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined; if (m && m.name?.startsWith("weapon") && "emissiveIntensity" in m && !l.includes(m)) l.push(m); });
    a.data.lampMats = l; a.data.lampE = l.map(m => m.emissiveIntensity); }
  return a.data.lampMats;
}
/** 灯的亮度：1 是原样，0 是全暗 */
function lampLevel(a: Actor, k: number) { const l = lampMats(a), e0 = a.data.lampE as number[]; l.forEach((m, i) => { m.emissiveIntensity = e0[i] * k; }); }

// ---------------------------------------------------------------- 被动：盯光
interface Mark { until: number; t: number; e: Ent; eye: Eye | null; }
const MARKS = new Map<number, Map<number, Mark>>();      // 施法的乌戈 → 目标 → 盯光（两队可能各有一个乌戈，各挂各的）
const marksOf = (me: Ent) => { let m = MARKS.get(me.id); if (!m) MARKS.set(me.id, (m = new Map())); return m; };
/** 头顶多高：英雄按身高，野怪按块头，小兵两米 */
function topOf(api: Api, e: Ent) { const k = e.kind === "hero" ? (api.actor(e)?.kit.height ?? 3) + 0.15 : e.kind === "monster" ? 1.4 + e.r * 1.4 : 2.0; return api.height(e.x, e.z) + k; }
/** 一次施放第一次打中这个目标：带盯光就消耗掉、多打一下；不带就挂上 */
function touch(c: Ctx & { lv: number; ap: number }, e: Ent) {
  const { me, api, fx } = c, M = marksOf(me), m = M.get(e.id), now = api.time();
  if (m && m.until > now) {
    M.delete(e.id); m.eye?.free();
    const bonus = 60 + 0.25 * c.ap + 8 * c.lv; api.after(0.1, () => { if (e.alive) api.hit(me, e, bonus, "magic"); });      // 晚 0.1 秒单独打：伤害数字和主伤害错开，看得出多了一下
    if (e.team === 0 || e.seen) {      // 碎掉：眼睛那儿一下小白芯，几点光往外迸
      const p = { x: e.x, y: topOf(api, e), z: e.z };
      fx.burst({ pos: p, n: 1, sprite: SPR.glint, add: true, color: [0xffffff, MAIN], size: 0.7, grow: 1.6, life: 0.12, speed: 0, alpha: 0.9 });
      fx.burst({ pos: p, n: 6, sprite: SPR.ember, add: true, color: [CORE, MAIN], size: [0.08, 0.13], life: [0.25, 0.4], speed: [1.5, 3.2], drag: 2.5, gravity: 2 });
    }
    return;
  }
  if (!e.alive) return;
  M.set(e.id, { until: now + 4, t: 0, e, eye: m?.eye ?? null });
}
function passiveMarks(c: Ctx, dt: number) {
  const { me, api, fx } = c, M = MARKS.get(me.id); if (!M) return; const now = api.time();
  for (const [id, m] of M) {
    const e = m.e, left = m.until - now; m.t += dt;
    if (left <= 0 || !e.alive) { m.eye?.free(); M.delete(id); continue; }
    const vis = (e.team === 0 || e.seen) && !e.invis; if (!vis) { if (m.eye) { m.eye.free(); m.eye = null; } continue; }
    m.eye ??= eye(fx, "#7c8cff", "#d8e4ff");
    const small = e.kind === "melee" || e.kind === "ranged", w = small ? 0.42 : 0.62, a = (small ? 0.55 : 0.85) * sat(m.t / 0.12) * sat(left / 0.5) * (0.82 + 0.18 * Math.sin(now * 4 + id));      // 很淡；最后半秒淡掉
    m.eye.set({ x: e.x, y: topOf(api, e) + 0.06 * Math.sin(now * 2.2 + id), z: e.z }, w * (1 + 0.25 * (1 - sat(m.t / 0.15))), a);
  }
}
const dmgOf = (c: Cast, base: number, apK: number, lvK: number) => base + apK * c.ap + lvK * c.lv;

/** 打中一个人：一下很短的冷光（不加点光）、一颗小白芯、几道顺着方向的光丝、几颗水珠。不用 fx.impact：它每次在目标身上张开一圈白环，几个目标就是几个白圈 */
function hitFx(fx: FxLib, at: V3, dir: V3 | null, size = 1) {
  fx.flash(at, MAIN, 1.2 * size, 0.1, false);
  fx.burst({ pos: at, n: 1, sprite: SPR.glint, add: true, color: [0xffffff, CORE], size: 0.75 * size, grow: 1.5, life: 0.1, speed: 0, alpha: 0.9 });
  fx.burst({ pos: at, n: 4, sprite: SPR.streak, add: true, color: [CORE, MAIN], size: [0.14 * size, 0.22 * size], life: [0.12, 0.2], speed: [5, 9], dir: dir ?? undefined, spread: dir ? 0.9 : 3.14, drag: 3, stretch: 1.4 });
  fx.burst({ pos: at, n: 5, sprite: SPR.drop, color: [FOAM, MAIN], dir: dir ? { x: dir.x, y: 0.6, z: dir.z } : undefined, spread: 1.1, speed: [1.5, 3.5], size: [0.08, 0.14], life: [0.3, 0.45], gravity: 11 });
}

// ---------------------------------------------------------------- 技能
const P: SkillDef = { key: "P", name: "盯光", icon: "ugo_p", cast: "passive",
  desc: "技能打中敌人时在它头上挂一只“盯光” 4 秒。乌戈的下一个技能打中带盯光的目标时消耗掉它，多造成 60 + 25% 法强的魔法伤害。" };

/** 起手时灯上的光：size 从 s0 收到 s1、亮度从 a0 涨到 a1（聚光），出手（c.data.lit）或者被打断（c.data.over）就收掉 */
function lampCharge(c: Cast, sec: number, s0: number, s1: number, a0: number, a1: number, color = MAIN) {
  const { a, api, fx } = c, g = glow(fx, color), inner = glow(fx, CORE), p = v3(); let t = 0;
  api.run(sec + 0.3, (_k, dt) => { if (c.data.lit || c.data.over) { g.free(); inner.free(); return; } t += dt; const k = sat(t / sec), e = k * k * (3 - 2 * k); lampAt(a, p);
    g.set(p, s0 + (s1 - s0) * e, a0 + (a1 - a0) * e); inner.set(p, 0.35 + 0.25 * e, 0.4 + 0.6 * e); }, () => { g.free(); inner.free(); });
}

const Q: SkillDef = { key: "Q", name: "冷光束", icon: "ugo_q", cast: "dir", range: 12, width: 1.1, cd: 6, mana: 60,
  desc: "灯球聚光，然后一道冷光束瞬间打穿整条直线：线上每个敌人受到 185 + 70% 法强的魔法伤害。",
  start(c) {
    const { a, api, fx } = c, w = windup(a, "q"), p = lampAt(a, v3()), yaw = Math.atan2(c.dx, c.dz), x0 = a.pos.x, z0 = a.pos.z, L = 12;
    // 预兆（前摇 0.3 秒）：灯球缩小、变亮；周围几点冷光往灯里收；脚下一条窄长的淡蓝紫预警条沿着方向铺开（敌人看得见往哪打）
    lampCharge(c, w, 1.6, 0.75, 0.25, 0.9);
    fx.burst({ pos: p, n: 1, sprite: SPR.glint, add: true, color: [MAIN, CORE], size: 0.35, grow: 2.2, life: w, speed: 0, alpha: 0.6 });
    for (let i = 0; i < 7; i++) { const an = Math.random() * TAU, el = (Math.random() - 0.3) * 1.6, r = 1.1 + Math.random() * 0.4, d = { x: Math.cos(an) * Math.cos(el), y: Math.sin(el), z: Math.sin(an) * Math.cos(el) }, life = Math.max(0.12, w * (0.7 + 0.3 * Math.random()));
      fx.burst({ pos: { x: p.x + d.x * r, y: p.y + d.y * r, z: p.z + d.z * r }, n: 1, sprite: SPR.glint, add: true, color: [MAIN, CORE], size: [0.12, 0.18], grow: 0.4, life, speed: r / life, dir: { x: -d.x, y: -d.y, z: -d.z }, spread: 0.02 }); }
    const tele = fx.decal({ kind: "rect", x: x0, z: z0, r: 0.55, len: 0.5, yaw, life: w + 0.12, color: MAIN, alpha: 0.42, fadeIn: 0.1, fadeOut: 0.12, lift: 0.09 });
    api.run(Math.min(w, 0.22), k => { const e = 1 - (1 - k) ** 2, len = Math.max(0.5, L * e); tele.size(0.55, len); tele.set(x0 + c.dx * len / 2, z0 + c.dz * len / 2, yaw); });
    c.data.tele = tele;
  },
  end(c) { c.data.over = true; if (!c.data.lit) (c.data.tele as { kill: (f?: number) => void } | undefined)?.kill(0.08); },
  fire(c) {
    const { me, a, api, fx } = c, L = 12, half = 0.55, x0 = me.x, z0 = me.z, dmg = dmgOf(c, 185, 0.7, 30); c.data.lit = true;
    (c.data.tele as { kill: (f?: number) => void } | undefined)?.kill(0.1);
    const list = api.inLine(me, x0, z0, c.dx, c.dz, L, half).filter(e => !isBuilding(e));
    const from = lampAt(a, v3()), ex = x0 + c.dx * L, ez = z0 + c.dz * L, end = { x: ex, y: fx.ground(ex, ez) + 1.05, z: ez };
    // 光束：从灯球射到线的尽头，0.15 秒最亮，然后 0.3 秒变细消失（芯近白、外缘渊蓝紫，底下垫一层深水色）
    beam(api, fx, from, end, { width: 0.7, hold: 0.15, fade: 0.3, color: CORE, color2: MAIN, deep: DEEP, alpha: 0.95 });
    fx.flash(from, MAIN, 1.5, 0.1, false); fx.burst({ pos: from, n: 1, sprite: SPR.soft, add: true, color: [0xffffff, CORE], size: 1.0, grow: 1.4, life: 0.12, speed: 0, alpha: 0.8 });      // 灯上“嗡”的一下（第四批：四芒星换成一团圆的光——星芒和光束的头连在一起像折了一下）
    // 地上：光束扫过的地方留一道很淡的水光痕（刚出来时中间亮一下，很快凉成暗的湿印）
    trace(api, fx, x0 + c.dx * 0.6, z0 + c.dz * 0.6, ex, ez, { width: 0.95, life: 1.3, hotLife: 0.24, color: LILAC, color2: MAIN, deep: DEEP, alpha: 0.8 });
    // 沿着光束飘几点冷光，尽头散开一小团（光“泼”出去）
    for (let i = 0; i < 9; i++) { const k = 0.15 + 0.85 * Math.random(), q = { x: from.x + (end.x - from.x) * k, y: from.y + (end.y - from.y) * k, z: from.z + (end.z - from.z) * k };
      fx.burst({ pos: q, n: 1, sprite: SPR.ember, add: true, color: [CORE, MAIN], size: [0.08, 0.13], life: [0.35, 0.6], speed: [0.2, 0.6], up: 0.5, drag: 1.5 }); }
    fx.burst({ pos: end, n: 7, sprite: SPR.ember, add: true, color: [CORE, MAIN], dir: { x: c.dx, y: 0.3, z: c.dz }, spread: 0.9, size: [0.08, 0.14], life: [0.25, 0.45], speed: [2, 5], drag: 2.5 });
    fx.burst({ pos: end, n: 1, sprite: SPR.soft, add: true, color: [CORE, MAIN], size: 1.2, grow: 1.6, life: 0.18, speed: 0, alpha: 0.45 });
    // 打穿的每个人：身上一点白光，几颗水珠溅开
    for (const e of list) {
      api.hit(me, e, dmg); touch(c, e);
      const at = api.pos(e, e.kind === "hero" ? 1.3 : 0.9);
      hitFx(fx, at, { x: c.dx, y: 0.2, z: c.dz }, 0.9);
    }
  },
};

const W: SkillDef = { key: "W", name: "诱光", icon: "ugo_w", cast: "dir", range: 10, width: 0.9, cd: 12, mana: 80,
  desc: "甩出一颗小灯，打中第一个敌人：魅惑它 1.3 秒（被牵着朝乌戈走 3 米），并造成 120 + 40% 法强的魔法伤害。",
  start(c) {                                                  // 出手前：右手指尖亮起一点（手指一勾）
    const { a, api, fx } = c, w = windup(a, "w"), g = glow(fx, MAIN), h = v3(); let t = 0;
    api.run(w + 0.3, (_k, dt) => { if (c.data.lit || c.data.over) { g.free(); return; } t += dt; a.hand(h, "Right"); g.set(h, 0.6 + 0.5 * sat(t / w), 0.3 + 0.5 * sat(t / w)); }, () => g.free());
    lampCharge(c, w, 1.2, 0.9, 0.15, 0.45);
  },
  end(c) { c.data.over = true; },
  fire(c) {
    const { me, a, api, fx } = c, dmg = dmgOf(c, 120, 0.4, 15), hd = a.hand(v3(), "Right"); c.data.lit = true; let got: Ent | null = null;
    const from = { x: a.pos.x + c.dx * 0.6, y: Math.min(a.pos.y + 2.4, Math.max(a.pos.y + 1.2, hd.y)), z: a.pos.z + c.dz * 0.6 };
    fx.burst({ pos: hd, n: 1, sprite: SPR.glint, add: true, color: [0xffffff, MAIN], size: 0.6, grow: 1.5, life: 0.12, speed: 0, alpha: 0.85 });
    // 一颗小灯晃晃悠悠地飞（上下摆、左右轻轻晃），后面一根若有若无的光丝连回乌戈的灯
    const core = glow(fx, CORE), halo = glow(fx, MAIN), dark = shade(fx, DEEP), thread = tether(fx, 0x9aa6ff, MAIN), tr = fx.trail({ color: LILAC, color2: DUSK, width: 0.3, life: 0.26, alpha: 0.75 }), lp = v3(), at = v3();
    let t = 0, last = { x: from.x, y: from.y, z: from.z };
    const vis: ProjVis = {
      move(x, y, z, _dx, _dy, _dz, dt) { t += dt; const bob = Math.sin(t * 9) * 0.24, sw = Math.sin(t * 6.3) * 0.14, px = x - c.dz * sw, pz = z + c.dx * sw; at.set(px, y + bob, pz); last = { x: at.x, y: at.y, z: at.z };
        const pul = 1 + 0.12 * Math.sin(t * 17); dark.set(at, 2.0, 0.42); core.set(at, 0.8 * pul, 1); halo.set(at, 2.2 * pul, 0.8); tr.at(at.x, at.y, at.z);      // 底下垫一团暗，冷光在亮的草地上也读得出颜色
        lampAt(a, lp); thread.set(lp, at, 0.35 + 0.06 * Math.hypot(at.x - lp.x, at.z - lp.z)); thread.look({ width: 0.11, alpha: 0.7 * sat(t / 0.08), taut: 0 }); },
      done() { core.free(); halo.free(); dark.free(); tr.stop(); },
    };
    api.shoot({ me, from, dir: { x: c.dx, z: c.dz }, speed: 18, range: 10 - 0.6, radius: 0.45, hit(e) { if (isBuilding(e)) return false; got = e; }, vis,
      end() {
        const e = got as Ent | null;
        if (!e) {                                             // 没打中：小灯在尽头闪一下灭掉，光丝淡掉
          fx.burst({ pos: last, n: 5, sprite: SPR.ember, add: true, color: [CORE, MAIN], size: [0.07, 0.12], life: [0.2, 0.35], speed: [0.8, 2], drag: 2 });
          fx.burst({ pos: last, n: 1, sprite: SPR.soft, add: true, color: [CORE, MAIN], size: 0.8, grow: 0.3, life: 0.16, speed: 0, alpha: 0.6 });
          api.run(0.22, k => { lampAt(a, lp); thread.set(lp, last, 0.5); thread.look({ alpha: 0.55 * (1 - k), cut: k }); }, thread.free); return;
        }
        api.hit(me, e, dmg); touch(c, e);
        const hit = api.pos(e, e.kind === "hero" ? 1.4 : 0.9);
        hitFx(fx, hit, null, 1); fx.burst({ pos: hit, n: 1, sprite: SPR.ring, add: true, color: [CORE, MAIN], size: 0.5, grow: 3.0, life: 0.2, speed: 0, alpha: 0.55 });      // 小灯碎开：一圈淡紫的环
        if (!e.alive) { thread.free(); return; }
        // 魅惑：被拖着朝乌戈走 3 米（1.3 秒的硬控）；英雄转过身、播跑步的动作，像是自己走过来的
        const CH = 1.3; api.pull(e, me.x, me.z, 3, CH);
        const act = api.actor(e); if (act) { act.face(me.x, me.z, true); act.anim("run", { loop: true, speed: Math.max(0.25, (3 / CH) / act.meta.runSpeed) * 1.35, fade: 0.08 }); }
        // 光丝绷直、变亮，一颗颗光点顺着丝往回走；目标头顶一圈蓝紫的小光点打转
        const dots: Glow[] = Array.from({ length: 5 }, () => glow(fx, MAIN)), dims: Glow[] = Array.from({ length: 5 }, () => shade(fx, DEEP)), ch = v3(), r0 = Math.random() * TAU; let tt = 0, broke = false;
        const ring = fx.decal({ kind: "disc", x: e.x, z: e.z, r: e.r + 0.6, life: CH + 0.1, color: MAIN, alpha: 0.5, fadeIn: 0.08, fadeOut: 0.15, add: true, lift: 0.1 });      // 脚下一圈淡淡的蓝紫：被魅惑了
        const brk = () => { if (broke) return; broke = true; for (const d of dots) d.free(); for (const d of dims) d.free(); ring.kill(0.15);
          lampAt(a, lp); const top = { x: e.x, y: topOf(api, e) - 0.2, z: e.z };
          for (let i = 1; i < 7; i++) { const k = i / 7; fx.burst({ pos: { x: lp.x + (ch.x - lp.x) * k, y: lp.y + (ch.y - lp.y) * k - Math.sin(k * Math.PI) * 0.1, z: lp.z + (ch.z - lp.z) * k }, n: 1, sprite: SPR.ember, add: true, color: [CORE, MAIN], size: [0.08, 0.12], life: [0.3, 0.5], speed: [0.3, 0.9], up: 0.4, drag: 1.5 }); }
          fx.burst({ pos: top, n: 5, sprite: SPR.glint, add: true, color: [CORE, MAIN], size: [0.12, 0.18], life: [0.2, 0.35], speed: [1.2, 2.4], drag: 3 });
          api.run(0.16, k => { lampAt(a, lp); thread.set(lp, ch, 0.05); thread.look({ cut: k, alpha: 0.95 * (1 - k * 0.5) }); }, thread.free); };
        api.run(CH, (_k, dt) => { if (broke) return; tt += dt; if (!e.alive || !me.alive) { brk(); return; }
          lampAt(a, lp); ch.set(e.x, api.height(e.x, e.z) + (e.kind === "hero" ? 1.5 : 0.9), e.z); const tg = sat(tt / 0.08);
          thread.set(lp, ch, 0.35 * (1 - tg) + 0.04); thread.look({ width: 0.11 + 0.07 * tg, alpha: 0.7 + 0.3 * tg, taut: tg }); ring.set(e.x, e.z);
          const top = topOf(api, e) + 0.1; dots.forEach((d, i) => { const an = r0 + tt * 4.2 + (i / dots.length) * TAU, rr = 0.62 + 0.05 * Math.sin(tt * 6 + i), q = { x: e.x + Math.cos(an) * rr, y: top + Math.sin(an * 2 + i) * 0.06, z: e.z + Math.sin(an) * rr }; d.set(q, 0.62, sat(tt / 0.1)); dims[i].set(q, 0.6, 0.3 * sat(tt / 0.1)); }); },
          brk);
      } });
  },
};

const E: SkillDef = { key: "E", name: "磷潮", icon: "ugo_e", cast: "point", range: 9, radius: 3.2, cd: 10, mana: 70,
  desc: "在一处洒下一片发光的浮游生物，持续 4 秒：里面的敌人减速 20%、持续受到魔法伤害，并对乌戈这一队现形。",
  start(c) {                                                  // 出手前：两只手上各亮一点，几点光往手心收
    const { a, api, fx } = c, w = windup(a, "e"), gl = glow(fx, MAIN), gr = glow(fx, MAIN), hl = v3(), hr = v3(); let t = 0;
    api.run(w + 0.3, (_k, dt) => { if (c.data.lit || c.data.over) { gl.free(); gr.free(); return; } t += dt; const k = sat(t / w); a.hand(hl, "Left"); a.hand(hr, "Right"); gl.set(hl, 0.5 + 0.4 * k, 0.25 + 0.4 * k); gr.set(hr, 0.5 + 0.4 * k, 0.25 + 0.4 * k); }, () => { gl.free(); gr.free(); });
  },
  end(c) { c.data.over = true; },
  fire(c) {
    const { me, a, api, fx } = c, x = c.x, z = c.z, RR = 3.2, gy = fx.ground(x, z), tick = dmgOf(c, 22, 0.1, 5), FLY = 0.3, DUR = 4, LIFE = FLY - 0.1 + DUR + 0.25, done = new Set<number>(); c.data.lit = true;
    // 撒出去：两只手里几十点小光点划着弧线飞到落点，落在圈里各处
    const hands = [a.hand(v3(), "Left"), a.hand(v3(), "Right")], N = 26, G = 14;
    for (let i = 0; i < N; i++) { const h = hands[i % 2], an = Math.random() * TAU, d = RR * 0.92 * Math.sqrt(Math.random()), tx = x + Math.cos(an) * d, tz = z + Math.sin(an) * d, ty = fx.ground(tx, tz) + 0.15, T = FLY * (0.75 + 0.35 * Math.random());
      const vx = (tx - h.x) / T, vz = (tz - h.z) / T, vy = (ty - h.y + 0.5 * G * T * T) / T, sp = Math.hypot(vx, vy, vz);
      fx.burst({ pos: h, n: 1, sprite: i % 4 ? SPR.ember : SPR.glint, add: true, color: [CORE, MAIN], size: i % 4 ? [0.09, 0.14] : [0.16, 0.22], life: T, speed: sp, dir: { x: vx, y: vy, z: vz }, spread: 0, gravity: G }); }
    // 水面：一片深靛色的水从落点铺开（光点落下来的时候），边上一道清楚的亮线；水里星星点点的浮游光慢慢漂；最后半秒光点熄灭、水面一块块退去
    const pool = tide(fx, x, z, RR, { water: DUSK, deep: DEEP, speck: MAIN, hot: CORE }), u = pool.u; let t = 0;
    api.run(LIFE, (_k, dt) => { t += dt; const open = sat((t - FLY * 0.55) / 0.35), out = sat((t - (LIFE - 0.6)) / 0.6);
      u.uR.value = 0.12 + 0.88 * (1 - (1 - open) ** 3); u.uAlpha.value = sat((t - FLY * 0.5) / 0.15) * (1 - out * 0.3); u.uGlow.value = sat((t - FLY * 0.6) / 0.25) * (1 - sat((t - (LIFE - 0.75)) / 0.35)); u.uDis.value = out; }, pool.free);
    api.after(FLY * 0.85, () => {      // 落下去的一下：一圈很薄的水环往外推到边上
      thickRing(c, { x, z, r: RR, r0: 0.6, width: 0.7, life: 0.4, color: FOAM, color2: MAIN, alpha: 0.55 });
      fx.burst({ pos: { x, y: gy + 0.2, z }, n: 10, sprite: SPR.drop, ringR: RR * 0.55, color: [FOAM, MAIN], speed: [0.4, 1.2], up: 2.2, size: [0.07, 0.12], life: [0.3, 0.5], gravity: 9 }); });
    let acc = 0;
    api.zone({ me, x, z, r: RR, dur: DUR, delay: FLY - 0.1, tick: 0.5,
      frame(_zn, dt) {
        api.reveal(me, x, z, RR);                             // 浮游光照出里面的人（对乌戈这一队现形，不破隐身）
        for (const e of api.enemies(me, x, z, RR)) { if (isBuilding(e)) continue; api.slow(e, 0.2, 0.3); }      // 站在里面就一直减速，走出去 0.3 秒后消
        acc += dt * 5.5; while (acc >= 1) { acc -= 1; const an = Math.random() * TAU, d = RR * 0.85 * Math.sqrt(Math.random()), px = x + Math.cos(an) * d, pz = z + Math.sin(an) * d;      // 偶尔一点光从水里慢慢浮上来
          fx.burst({ pos: { x: px, y: fx.ground(px, pz) + 0.2, z: pz }, n: 1, sprite: SPR.ember, add: true, color: [CORE, MAIN], size: [0.07, 0.11], life: [0.9, 1.4], speed: [0.05, 0.15], up: 0.55, drag: 0.6 }); }
      },
      each(e, zn) {
        if (zn.t > 3.75 || isBuilding(e)) return;             // 一共 8 跳：0、0.5……3.5 秒
        api.hit(me, e, tick); if (!done.has(e.id)) { done.add(e.id); touch(c, e); }
        if (e.team === 0 || e.seen) fx.decal({ kind: "shock", x: e.x, z: e.z, r: e.r + 0.45, life: 0.45, color: LILAC, alpha: 0.3, from: 0.4, fadeIn: 0.05, fadeOut: 0.7, add: true });      // 脚边一圈淡淡的涟漪
      },
    });
  },
};

const R: SkillDef = { key: "R", name: "渊口", icon: "ugo_r", cast: "point", range: 11, radius: 3.6, cd: 75, mana: 130, minLevel: 6,
  desc: "落点的水下浮起一个巨大的鱼头影子，1 秒后一张巨大的深海巨口从地下冲出一口合上：范围内的敌人受到 385 + 90% 法强的魔法伤害并眩晕 1 秒，离中心越近伤害越高。",
  start(c) {                                                  // 起手：双臂高举，灯暗下去，周围的光往灯里收（整个人的光“收”回去）
    const { a, api, fx } = c, w = windup(a, "r", true), p = lampAt(a, v3()); lampMats(a); let t = 0;
    api.run(w + 1.4, (_k, dt) => { t += dt; if (c.data.bright) return; if (c.data.over && !c.data.lit) { lampLevel(a, 1); return; } lampLevel(a, c.data.lit ? 0.15 : 1 - 0.85 * sat(t / w)); }, () => { if (!c.data.bright) lampLevel(a, 1); });      // bright：巨嘴合上、灯已经亮回来了
    for (let i = 0; i < 10; i++) { const an = Math.random() * TAU, el = (Math.random() - 0.2) * 1.4, r = 1.6 + Math.random() * 0.6, d = { x: Math.cos(an) * Math.cos(el), y: Math.sin(el), z: Math.sin(an) * Math.cos(el) }, life = Math.max(0.15, w * (0.75 + 0.25 * Math.random()));
      fx.burst({ pos: { x: p.x + d.x * r, y: p.y + d.y * r, z: p.z + d.z * r }, n: 1, sprite: SPR.glint, add: true, color: [CORE, MAIN], size: [0.14, 0.2], grow: 0.3, life, speed: r / life, dir: { x: -d.x, y: -d.y, z: -d.z }, spread: 0.02 }); }
  },
  end(c, interrupted) { c.data.over = true; if (interrupted && !c.data.lit) lampLevel(c.a, 1); },
  fire(c) {
    const { me, a, api, fx } = c, x = c.x, z = c.z, RR = 3.6, IN = 1.4, T = 1.0, RISE = 0.5, OPEN = 0.86, gy = fx.ground(x, z), dmg = dmgOf(c, 385, 0.9, 50); c.data.lit = true;
    // 预告（1.0 秒）：一片深色的水面浮出来，边线清楚（范围）；水底一个巨大的鱼头影子从小长大、越来越黑，浮出两片颌的轮廓和嘴缝，正中那盏灯从深处亮起来；中间那 1.4 米一圈很淡的虚线
    // （第四批 polish-new：原来地上画一圈 14 颗白色的平面尖牙往里收，俯视像钟面图标。照 LoL 菲兹大招的落点改成“水下有个影子上来”）
    const yaw = Math.atan2(CAM.x - x, CAM.z - z), tele = maw(fx, x, z, RR, IN, { fang: PEARL, rim: LILAC, glow: MAIN, deep: DEEP }, yaw); let t = 0;
    api.run(T, (_k, dt) => { t += dt; tele.u.uK.value = 1 - (1 - sat(t / T)) ** 1.6; tele.u.uAlpha.value = sat(t / 0.12); tele.u.uFang.value = 1 - sat((t - RISE - 0.1) / 0.3); }, () => {});
    for (let i = 0; i < 3; i++) api.after(0.2 + i * 0.15, () => fx.burst({ pos: { x, y: gy + 0.1, z }, n: 4, sprite: SPR.bubble, radius: RR * 0.5, color: [FOAM, LILAC], alpha: 0.55, speed: [0.1, 0.4], up: 1.3, size: [0.12, 0.22], life: [0.45, 0.7], drag: 1 }));      // 水底冒上来几串泡
    // 巨嘴：后半秒从深水里浮上来、慢慢张开（嘴里那盏灯越来越亮），最后 0.14 秒一口合上；合上以后停一下，再沉回去
    api.after(RISE, () => {
      const J = jaws(fx, x, gy, z, yaw, { skin: 0x2a386c, skin2: 0x0f152b, rim: LILAC, inside: DEEP, spot: PEARL, glow: MAIN, tooth: PEARL, tooth2: LILAC }), H = 3.3;
      let tt = 0, burst = false; const up = OPEN - RISE, shut = T - OPEN;
      api.run(1.05, (_k, dt) => { tt += dt;
        if (tt < up) { const k = tt / up, e = 1 - (1 - k) ** 2.2; J.set({ y: H * 1.1 * (1 - e), open: 0.2 + 0.52 * e, alpha: Math.min(1, k * 2.5), lure: 0.4 + 0.6 * k, teeth: 0.4 + 0.6 * e });
          if (!burst && e > 0.55) { burst = true; fx.burst({ pos: { x, y: gy + 0.2, z }, n: 14, sprite: SPR.drop, ringR: RR * 0.62, color: [FOAM, MAIN], speed: [0.8, 2.2], up: 4, size: [0.09, 0.18], life: [0.45, 0.7], gravity: 12 }); } }      // 颌冲出水面：口沿上挂下来的水
        else if (tt < up + shut) { const k = (tt - up) / shut; J.set({ y: H * 0.3 * k * k, open: 0.72 * (1 - Math.pow(k, 2.2)), alpha: 1, lure: 1 - k * 0.5 }); }      // 一边咬合一边往下扎：合拢那一刻已经沉下去三成，不会在地上立起一个完整的圆顶
        else { const s = tt - up - shut, sink = sat(s / 0.24), y0 = H * 0.3;      // 合上以后马上扎回水下（0.24 秒；第四批：原来停 0.1 秒、0.42 秒慢慢沉，合着的扁圆顶留在画面里像个罩子）
          J.set({ y: y0 + (H * 1.25 - y0) * sink * (2 - sink), open: 0, alpha: 1 - sink * sink, flash: Math.max(0, 1 - s / 0.12), lure: 0.3 * (1 - sink), teeth: 1 - sink }); } }, J.free);
    });
    api.after(T, () => {
      api.run(0.45, k => { tele.u.uAlpha.value = (1 - k) * (1 - k); }, tele.free);      // 深水不马上没：嘴沉回去的时候底下还是暗的，合上的嘴不会在亮地面上显得发白
      // 合上的一刻：结算；口沿一下白光（不到 0.2 秒）、一圈水的冲击环、中间一股往上冲的水；镜头抖 0.14
      const hits = api.enemies(me, x, z, RR).filter(e => !isBuilding(e));
      for (const e of hits) { const close = Math.hypot(e.x - x, e.z - z) <= IN; api.hit(me, e, dmg * (close ? 1.25 : 1), "magic", true); if (e.alive) api.stun(e, 1); touch(c, e);
        const at = api.pos(e, e.kind === "hero" ? 1.3 : 0.9); hitFx(fx, at, null, close ? 1.2 : 1); if (e.kind === "hero") fx.hitstop(0.06); }
      fx.flash({ x, y: gy + 2.6, z }, CORE, 2.2, 0.14); fx.shake(0.14, 0.32);
      thickRing(c, { x, z, r: RR + 0.9, r0: 2.2, width: 1.1, life: 0.48, color: FOAM, color2: DUSK, alpha: 0.6 });
      crown(api, fx, x, z, { r: RR * 0.55, r2: RR * 0.85, h: 0.85, life: 0.4, rise: 0.06, deep: DEEP, color: FOAM, color2: MAIN, alpha: 0.32, flare: 0.5 });      // 水冠矮、快、往里收一点（第四批：原来一圈 1.3 米高的半透明水墙围着整个圈，和合上的嘴一起读成果冻罩子）
      fx.burst({ pos: { x, y: gy + 2.4, z }, n: 16, sprite: SPR.drop, radius: 0.5, color: [FOAM, MAIN], spread: 0.35, dir: { x: 0, y: 1, z: 0 }, speed: [6, 11], size: [0.12, 0.24], life: [0.5, 0.8], gravity: 15, stretch: 0.8 });      // 合上的缝里挤出来一股水
      fx.burst({ pos: { x, y: gy + 0.4, z }, n: 18, sprite: SPR.drop, ringR: RR * 0.85, color: [FOAM, MAIN], spread: 0.6, dir: { x: 0, y: 1, z: 0 }, speed: [3, 6], size: [0.1, 0.2], life: [0.45, 0.7], gravity: 14 });
      fx.burst({ pos: { x, y: gy + 0.3, z }, n: 10, sprite: SPR.bubble, radius: RR * 0.6, color: FOAM, alpha: 0.5, speed: [0.2, 0.8], up: 1.2, size: [0.12, 0.24], life: [0.7, 1.2], drag: 1.2 });
      // 余韵：地上一圈慢慢平复的涟漪、一摊暗下去的水渍；乌戈的灯亮回来
      fx.decal({ kind: "water", x, z, r: RR * 0.9, life: 1.4, color: DUSK, color2: LILAC, alpha: 0.24, fadeIn: 0.04, fadeOut: 0.6 });      // 余韵淡一档、短一秒：原来 2.4 秒一大片发白的淡紫圆盘
      mark(api, fx, { kind: "stain", x, z, r: RR * 0.9, life: 1.9, deep: DEEP, color2: LILAC, alpha: 0.55, fadeOut: 0.5 });
      c.data.bright = true; lampLevel(a, 1); const lp = lampAt(a, v3()); fx.burst({ pos: lp, n: 1, sprite: SPR.glint, add: true, color: [0xffffff, MAIN], size: 0.8, grow: 1.4, life: 0.15, speed: 0, alpha: 0.85 });
    });
  },
};

// ---------------------------------------------------------------- 普攻：一颗小冷光珠
function pearlShot(fx: FxLib, from: V3): ProjVis {
  const core = glow(fx, CORE), halo = glow(fx, MAIN), dark = shade(fx, DEEP), tr = fx.trail({ color: LILAC, color2: DUSK, width: 0.26, life: 0.13, alpha: 0.7 }), p = v3(); let t = 0, first = true;
  return { move(x, y, z, _dx, _dy, _dz, dt) { t += dt; p.set(x, y, z); dark.set(p, 1.2, 0.3); core.set(p, 0.5, 1); halo.set(p, 1.35 * (1 + 0.1 * Math.sin(t * 30)), 0.62); tr.at(x, y, z);
      if (first) { first = false; fx.burst({ pos: from, n: 1, sprite: SPR.glint, add: true, color: [0xffffff, MAIN], size: 0.55, grow: 1.4, life: 0.1, speed: 0, alpha: 0.8 }); } },
    done() { core.free(); halo.free(); dark.free(); tr.stop(); } };
}

export const ugo: HeroKit = {
  id: "ugo", name: "乌戈", title: "渊灯", role: "法师", side: 0, color: 0x7c8cff, color2: CORE, height: 3.7, look: { ring: 1.15, lift: 1.15 },      /* 模型任务定的 3.1 米只比小兵高三分之一；乌戈是佝偻着站的，身高（连钓竿）给 3.7，俯视里和奥森（3.4，鹿身长）差不多显眼、明显比小兵大。换画风 B（w-mu）：lift 1.15，默认 1.4 时群青的皮肤提成浅蓝紫 (79,93,144)，1.15 是 (61,75,127)，设定图 (65,70,103) */
  base: { hp: 2750, mana: 950, ad: 130, ap: 70, armor: 20, mr: 26, ms: 5.5, as: 0.8, range: 8.5, cdr: 0, ls: 0, hpRegen: 0.005, manaRegen: 0.018 },
  ranged: { speed: 22, shot: c => pearlShot(c.fx, c.from) },
  skills: [P, Q, W, E, R],
  attack(c) {                                                  // 打中：一小圈蓝紫的水光溅开
    const { api, fx, target: e } = c, at = api.pos(e, e.kind === "tower" ? 3 : e.kind === "core" ? 4 : e.kind === "hero" ? 1.3 : 0.9);
    fx.burst({ pos: at, n: 1, sprite: SPR.ring, add: true, color: [CORE, MAIN], size: 0.35, grow: 3, life: 0.16, speed: 0, alpha: 0.7 });
    fx.burst({ pos: at, n: 1, sprite: SPR.soft, add: true, color: [CORE, MAIN], size: 0.7, grow: 0.6, life: 0.1, speed: 0, alpha: 0.6 });
    fx.burst({ pos: at, n: 5, sprite: SPR.drop, color: [FOAM, MAIN], speed: [1.2, 3], size: [0.07, 0.12], life: [0.25, 0.4], gravity: 10 });
  },
  passive(c, dt) { const { a, api, fx } = c; warmFx2a(api, fx, a.pos.x, a.pos.z); warm2b(c); warmUgo(api, fx, a.pos.x, a.pos.z); passiveMarks(c, dt); },
};
