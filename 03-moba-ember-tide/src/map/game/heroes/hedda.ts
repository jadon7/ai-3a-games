// 赫达 · 缚钳（辅助，烬誓庭）。背着一座小熔炉替教团运送圣火的女铁匠，用长柄火钳把人从敌阵里夹出来。
// 和摩珂（奶、盾）分开：她是开团的辅助——钩一个人过来、拴住要跑的、冲到队友身边一起扛、把炉心砸进人堆里。
//
// 规格（docs/round9/heroes/DESIGN.md 里赫达那一节；数值是第一版）：
//   被动 烙印   赫达的技能打中敌方英雄时给它烙一个印，持续 4 秒。友方英雄打它第一下时引爆：多打 50 + 每级 10 的魔法伤害，打的那个友军回复同样多的生命。
//   Q 钳钩      非指向，距离 10，宽 0.9，冷却 14，法力 80。火钳拖着铁链射出去（速度 40），钳住第一个敌人就把它拉到自己面前（0.35 秒），
//               90 + 30% 法强 + 每级 15，眩晕 0.5 秒。小兵也能钳。会被墙挡住。
//   W 铁镣      指向敌方单位，距离 6，冷却 13，法力 70。甩出一条烧红的铁链拴住它 2.5 秒：它离赫达超过 6.5 米，铁链绷断，它被拽回 2.5 米并眩晕 1.2 秒；
//               没走远就只是减速 20%。拴上时受 60 + 每级 10 的魔法伤害。
//   E 护火      指向友方英雄（可以对自己放，原地生效），距离 7，冷却 16，法力 60。冲到友军身边（0.3 秒），两人 3 秒内受到的伤害少 30%；
//               落地时身边 2.5 米的敌人被推开 1.5 米。
//   R 炉心坠    大招，6 级。范围，距离 8，半径 4，冷却 80，法力 120。从背上的熔炉里掏出炉心掷向落点，0.6 秒后落地：
//               范围内的敌人被击飞（眩晕）1.1 秒，受 180 + 50% 法强 + 每级 25；落点留 3 秒烧红的炭地，敌人减速 30%、每 0.5 秒 20 + 每级 4。
//
// 实现时定下来的几件规格里没写死的事：
//   · 所有技能都不打建筑。Q 钩不到建筑（会穿过去找后面的人）；W 点在建筑上什么都不发生。
//   · Q 的眩晕：拉的 0.35 秒本身就是硬控（控制器的“被推”状态），拉到面前以后再晕 0.5 秒，所以一共给 0.85 秒。
//   · W 绷断：拽回的 0.2 秒加上之后的 1.2 秒眩晕。拴着的时候赫达自己走远了也算“走远了”（照 LoL 卡尔玛 W、莫甘娜 R 的拴法）。
//   · E 冲到友军靠自己这一侧的身边（不叠在他身上）；路上被眩晕打断就不生效。推开的人也算“技能打中”，会烙上印。
//   · R 的出手是 0.72 秒（蓄力的大招，按例外，时间表里写了 pre），落点的预警圈在炉心出手的那一刻才亮（0.6 秒前），敌我都看得见。
//     “击飞”用眩晕加模型往上抛一下（抛 1.4 米、0.7 秒）代替，没有改引擎。小兵和野怪只吃眩晕（它们的模型归 view.ts 管，技能这边够不着）。
//   · 烙印的引爆：查目标身上 hitBy（谁什么时候打过它）里有没有赫达以外的友方英雄、时间晚于烙上的那一刻。普攻、技能都算。
//
// 特效的路数（照 docs/round9/FX2.md）：铁和炉火。黑铁靠一圈钢的高光在青绿的地上读出形状，烧红的铁从樱桃红烧到炉心金；
// 火、烟、焦线、立着的冲击环用 fx_fx2c 的零件（锻炉里的火：白热 → 橙 → 暗红 → 黑烟），铁链、钳头、铁环、炉心、炭地、预警、护火的光环、烙印是 fx_k-hedda.ts 里新写的。
// 叠加发光只用在火星、钳口那一下、炉心外面那团很淡的光、护火的光环上。重的两下（钩中、炉心落地）才抖镜头。
// 参照（只看，不拿素材）：Q 照 Dota 2 帕吉的肉钩、LoL 布里茨的机械飞爪（一条读得清的链子、钩头最亮、拉回时地上一道印子）；
// W 照 LoL 莫甘娜的大招、卡尔玛 W（拴住的链子越绷越亮，断的那一下崩开）；E 照 LoL 布隆 W（冲到队友身边、两人一起扛）；
// R 照 LoL 古拉加斯、吉格斯的大招（掷出去的东西 + 地上的落点预警）和奥恩（锻炉的龟裂熔岩地面）；被动照 LoL 蕾欧娜的烈阳印记（友军来引爆）。
// Q 出手时模型手上的火钳藏起来（钳头飞出去、拽回来再露出来），看上去是她把火钳连着链子甩了出去，不是手里一把、天上又飞一把。

import * as THREE from "three";
import type { Actor } from "../actor";
import type { Ent } from "../sim";
import type { Api, HeroKit, SkillDef } from "../skills";
import { SPR, type FxLib, type V3 } from "../fxlib";
import { puff, puffer, strip, wall, warm, type PuffOpts } from "../fx_fx2c";
import { brandMark, coalBed, forgeCore, ironChain, shackle, tongs, wardRing, warmHedda, warnRing, type BrandMark } from "../fx_k-hedda";
import { LITE } from "../../quality";

const GOLD = 0xffc864, CHERRY = 0xc0461e, WHITE = 0xfff2d0;      // 炉心金（主色）、烧红的铁链（辅色）、白热。她的身体是全队唯一的浅色（灰白麻布 #D6CFC2），特效不用这个色
const ASH = 0x8b8279, DUST = 0xa3977f;                                             // 灰、土
const TAU = Math.PI * 2;
const v3 = () => new THREE.Vector3();
const c01 = (v: number) => Math.max(0, Math.min(1, v));
const isBuilding = (e: Ent) => e.kind === "tower" || e.kind === "core";
const foes = (api: Api, me: Ent, x: number, z: number, r: number) => api.enemies(me, x, z, r).filter(e => !isBuilding(e));
const heightOf = (api: Api, e: Ent) => (e.kind === "hero" ? api.actor(e)?.kit.height ?? 2.8 : e.big ? 2.2 : 1.6);
const inDisc = (x: number, z: number, r: number): [number, number] => { const a = Math.random() * TAU, d = r * Math.sqrt(Math.random()); return [x + Math.cos(a) * d, z + Math.sin(a) * d]; };
/** 施法前摇多长（照控制器的算法：时间表里的 pre，没写就普通技能 0.25、大招 0.35，原来就更快的不放慢） */
const windup = (a: Actor, key: string) => { const m = a.meta.skills[key]; if (!m) return 0.25; return Math.min(m.release / (m.speed ?? 1), m.pre ?? (key === "r" ? 0.35 : 0.25)); };

// 锻炉的火（fx_fx2c 的 puff）：一团火自己从白热烧成橙、暗红，最后变成往上飘的黑烟。下面是这个英雄常用的几种
const blaze = (fx: FxLib, o: Partial<PuffOpts> & { pos: V3 }) => puff(fx, { heat: [0.8, 1], cool: 0.55, smoke: 0x3a332f, opacity: [0.35, 0.5], drag: 3, rise: 1.6, grow: 2.5, size: [0.6, 1], life: [0.6, 0.9], speed: [2, 5], ...o });
const tongue = (fx: FxLib, o: Partial<PuffOpts> & { pos: V3 }) => puff(fx, { shape: "tongue", heat: [0.6, 0.85], cool: 0.65, smoke: 0x3a332f, opacity: 0.3, drag: 1, rise: 1.4, grow: 1.35, size: [0.35, 0.6], life: [0.45, 0.7], speed: [0.05, 0.25], up: 0.3, n: 1, ...o });
const soot = (fx: FxLib, o: Partial<PuffOpts> & { pos: V3 }) => puff(fx, { heat: 0, smoke: 0x37302c, opacity: [0.3, 0.42], drag: 1, rise: 0.9, grow: 2.2, size: [0.7, 1.1], life: [1.0, 1.6], speed: [0.1, 0.5], ...o });
const steam = (fx: FxLib, o: Partial<PuffOpts> & { pos: V3 }) => puff(fx, { heat: 0, smoke: 0xd9d3c8, opacity: [0.32, 0.45], drag: 2, rise: 1.6, grow: 2.4, size: [0.4, 0.65], life: [0.55, 0.9], speed: [0.6, 1.6], ...o });      // 烧红的铁淬到“嗤”的一下：白汽
const dirt = (fx: FxLib, o: Partial<PuffOpts> & { pos: V3 }) => puff(fx, { heat: 0, smoke: 0x6e6455, opacity: [0.22, 0.36], drag: 2.6, rise: 0.4, grow: 2.2, size: [0.6, 1.0], life: [0.55, 0.9], speed: [1, 3], ...o });
/** 一把火星（叠加发光，往外溅、往下掉） */
const sparks = (fx: FxLib, pos: V3, n: number, o: { dir?: V3; spread?: number; speed?: [number, number]; size?: [number, number]; life?: [number, number]; radius?: number } = {}) =>
  fx.burst({ pos, n: LITE ? Math.ceil(n / 2) : n, sprite: SPR.streak, add: true, color: [GOLD, CHERRY], dir: o.dir, spread: o.spread ?? 3.14, speed: o.speed ?? [3, 8], size: o.size ?? [0.08, 0.14], life: o.life ?? [0.18, 0.36], gravity: 12, stretch: 1.1, radius: o.radius });

/** 背上的熔炉在哪：炉子只蒙在 Spine2 上（见 art/hero/hedda/add_forge.py），炉膛在脊柱后面约半米；up 往上挪（烟囱口约 1.2） */
function furnace(a: Actor, out: THREE.Vector3, up = 0, back = 0.5, side = 0): THREE.Vector3 {
  const b = a.hero.bone("Spine2"), yaw = a.yaw(); if (b) b.getWorldPosition(out); else out.set(a.pos.x, a.pos.y + a.kit.height * 0.6, a.pos.z);
  out.x += -Math.sin(yaw) * back - Math.cos(yaw) * side; out.z += -Math.cos(yaw) * back + Math.sin(yaw) * side; out.y += up; return out;
}

/** 模型上的火钳（材质名以 weapon 开头的那几块网格）藏起来 / 露出来：钳钩飞出去的时候手里不该还有一把 */
function weapon(a: Actor, on: boolean) {
  const list: THREE.Object3D[] = a.data.weap ??= (() => { const l: THREE.Object3D[] = []; a.hero.model.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && ([] as THREE.Material[]).concat(m.material).some(x => x.name.startsWith("weapon"))) l.push(m); }); return l; })();
  a.data.weapOff = (a.data.weapOff ?? 0) + (on ? -1 : 1); const show = a.data.weapOff <= 0; if (show) a.data.weapOff = 0;      // 两次钳钩叠在一起（冷却刷新）时等两把都收回来
  for (const m of list) m.visible = show;
}

// ---------------------------------------------------------------- 被动 烙印
interface Brand { e: Ent; t0: number; mark: BrandMark; }
const BRAND_T = 4;
const brands = (a: Actor): Map<number, Brand> => (a.data.brands ??= new Map<number, Brand>());
/** 技能打中敌方英雄：烙一个印（已经有了就重新计时）。烙上的那一下“嗤”地冒一小股白汽、溅几点火星 */
function brand(c: { a: Actor; api: Api; fx: FxLib; me: Ent }, e: Ent) {
  if (e.kind !== "hero" || !e.alive || e.team === c.me.team) return;
  const B = brands(c.a), old = B.get(e.id), now = c.api.time(); if (old) old.t0 = now; else B.set(e.id, { e, t0: now, mark: brandMark(c.fx) });
  if (e.team !== 0 && !e.seen) return;
  sparkUp(c.fx, { x: e.x, y: c.fx.ground(e.x, e.z) + heightOf(c.api, e) * 0.62, z: e.z }, 4);      // 烙上的那一下：铁印亮一下（见 brandTick 的 pop）、溅几点火星（白汽留给引爆的那一下）
}
const sparkUp = (fx: FxLib, pos: V3, n: number) => fx.burst({ pos, n, sprite: SPR.ember, add: true, color: [GOLD, CHERRY], size: [0.07, 0.12], life: [0.3, 0.55], speed: [0.6, 2], up: 1.4, gravity: 3 });
/** 每帧：烙印跟着人、慢慢凉；友方英雄打它第一下就引爆 */
function brandTick(c: { me: Ent; a: Actor; api: Api; fx: FxLib }) {
  const { me, a, api, fx } = c, B = a.data.brands as Map<number, Brand> | undefined; if (!B || !B.size) return;
  const now = api.time(), lv = me.h?.level ?? 1;
  for (const [id, b] of B) { const e = b.e, age = now - b.t0;
    if (!e.alive || age > BRAND_T) { b.mark.free(); B.delete(id); continue; }
    const shown = e.team === 0 || e.seen, g = fx.ground(e.x, e.z), hgt = heightOf(api, e);
    b.mark.set(e.x, g + hgt * 0.62 + 0.04 * Math.sin(now * 3), e.z); b.mark.heat(1 - age / BRAND_T);      // 烙在胸口（照 LoL 蕾欧娜的烈阳印记，印在身上）：第四批 polish-new 从头顶 +0.28 米挪下来，原来夹在头和血条（+0.62）之间，被血条盖住半截 b.mark.alpha(shown ? Math.min(1, age / 0.06) * c01((BRAND_T - age) / 0.35) : 0);
    // 引爆：赫达以外的友方英雄在烙上以后打过它
    let by: Ent | null = null; for (const p of api.sim.ents) if (p.h && p.alive && p.team === me.team && p !== me && (e.h?.hitBy.get(p.id) ?? -1) > b.t0) { by = p; break; }
    if (!by) continue;
    B.delete(id); { const mk = b.mark, mx = e.x, mz = e.z, my = g + hgt * 0.62; api.run(0.2, k => { mk.set(mx, my + 0.3 * k, mz); mk.heat(1); mk.alpha(shown ? 1 - k * k : 0); }, () => mk.free()); }      // 铁印最后亮一下、往上一飘就没了
    const n = 50 + 10 * lv; api.hit(me, e, n, "magic"); api.heal(me, by, n);
    if (!shown) continue;
    // 引爆的样子：铁印“嗤”地一下化成一股白汽、一圈火星往外溅；打它的那个友军身上一点暖色的回血光
    const top = { x: e.x, y: g + hgt + 0.25, z: e.z }, mid = api.pos(e, hgt * 0.55);
    steam(fx, { pos: top, n: 3, size: [0.28, 0.42], opacity: [0.2, 0.3], life: [0.4, 0.65], speed: [0.8, 1.8], rise: 2.6, radius: 0.15 });
    fx.burst({ pos: mid, n: LITE ? 7 : 14, sprite: SPR.streak, add: true, color: [GOLD, CHERRY], dir: { x: 0, y: 0.3, z: 0 }, spread: 1.4, speed: [3, 7], size: [0.08, 0.13], life: [0.2, 0.38], gravity: 9, stretch: 1.2 });
    fx.burst({ pos: mid, n: 1, sprite: SPR.glint, add: true, color: [0xffffff, GOLD], size: 0.9, grow: 1.4, life: 0.12, speed: 0 });
    fx.decal({ kind: "shock", x: e.x, z: e.z, r: e.r + 0.9, life: 0.32, color: GOLD, alpha: 0.7, from: 0.3, fadeIn: 0.05, fadeOut: 0.6 });
    const ac = api.actor(by), bg = fx.ground(by.x, by.z), bh = heightOf(api, by);
    if (ac) fx.ghost(ac.hero.model, GOLD, 0.32, 0.3);
    fx.burst({ pos: { x: by.x, y: bg + 0.3, z: by.z }, n: LITE ? 4 : 8, sprite: SPR.ember, add: true, ringR: by.r + 0.3, color: [WHITE, GOLD], size: [0.08, 0.14], life: [0.5, 0.8], speed: [0.1, 0.3], up: bh * 0.9, drag: 1.2 });
    fx.burst({ pos: { x: by.x, y: bg + bh * 0.5, z: by.z }, n: 1, sprite: SPR.soft, add: true, color: GOLD, alpha: 0.35, size: bh * 0.7, grow: 1.3, life: 0.35, speed: 0 });
  }
}

// ---------------------------------------------------------------- 击飞（眩晕 + 模型往上抛一下）
const tossed = new WeakMap<object, number>();
/** 把一个英雄的模型往上抛 h 米、dur 秒落回来（只动画面：位置、碰撞还是原地，眩晕由技能另给）。同一个人又被抛，后一下接管 */
function toss(api: Api, e: Ent, h: number, dur: number) {
  const ac = api.actor(e); if (!ac) return; const m = ac.hero.model, id = (tossed.get(m) ?? 0) + 1; tossed.set(m, id); const spin = (Math.random() - 0.5) * 0.9;
  api.run(dur, k => { if (tossed.get(m) !== id) return; const y = h * (1 - Math.pow(2 * k - 1, 2)); m.position.y = y; m.rotation.x = -0.32 * Math.sin(Math.PI * k); m.rotation.z = spin * Math.sin(Math.PI * k); },
    () => { if (tossed.get(m) === id) { m.position.y = 0; m.rotation.x = 0; m.rotation.z = 0; } });
}

const P: SkillDef = { key: "P", name: "烙印", icon: "hedda_p", cast: "passive",
  desc: "赫达的技能打中敌方英雄时给它烙一个印，持续 4 秒。友方英雄打它第一下时引爆：多造成 50 点魔法伤害（随等级提高），打的那个友军回复同样多的生命。" };

// ---------------------------------------------------------------- Q 钳钩
const Q: SkillDef = { key: "Q", name: "钳钩", icon: "hedda_q", cast: "dir", range: 10, width: 0.9, cd: 14, mana: 80,
  desc: "火钳拖着铁链射出去，钳住第一个敌人就把它拉到自己面前：造成 90 + 30% 法强的魔法伤害（随等级提高），眩晕 0.5 秒。小兵也能钳，会被墙挡住。",
  start(c) {      // 出手前：火钳的钳口烧红（白热的一点从钳口亮起来），手上甩出两三点火星
    const { a, fx } = c, w = windup(a, "q"), b0 = v3(), tip = v3(), hand = a.hand(v3()); const p = a.hero.blade("R", b0, tip) ? tip : hand;
    fx.burst({ pos: p, n: 1, sprite: SPR.glint, add: true, color: [WHITE, GOLD], size: 0.55, grow: 1.8, life: Math.max(0.12, w), speed: 0, alpha: 0.85 });
    tongue(fx, { pos: p, n: 2, size: [0.25, 0.35], life: [0.25, 0.35], heat: [0.85, 1] });
    fx.burst({ pos: hand, n: 3, sprite: SPR.ember, add: true, color: [GOLD, CHERRY], size: [0.07, 0.12], life: [0.25, 0.4], speed: [1, 2.5], gravity: 6 });
  },
  fire(c) {
    const { me, a, api, fx } = c, dx = c.dx, dz = c.dz, hand = a.hand(v3()), dir = { x: dx, y: 0, z: dz };
    // 火钳本身飞出去：手里那把（模型上的武器）先藏起来，钳头收回手里再露出来——看上去是她把火钳连着链子甩了出去、再拽回来
    const head = tongs(fx, 1.4), chain = ironChain(fx, 1.35), tip = hand.clone(), back = v3(), H = v3(); let hooked: Ent | null = null;
    weapon(a, false); head.open(0.9); head.heat(0.78); head.aim(tip, dir);
    const done = () => { head.free(); chain.free(); weapon(a, true); };
    const trail = fx.emitter({ pos: tip, rate: LITE ? 30 : 60, sprite: SPR.ember, add: true, color: [GOLD, CHERRY], size: [0.06, 0.12], life: [0.2, 0.4], speed: [0.3, 1.5], gravity: 4 });
    const draw = (heat = 1) => { head.back(back); chain.set(a.hand(H), back, { head: heat, hot: 2.2, base: 0.03 }); };
    // 出手：手上往前甩出一把火星
    sparks(fx, hand, 9, { dir: { x: dx, y: 0.2, z: dz }, spread: 0.45, speed: [5, 12], life: [0.15, 0.3] });
    draw();
    api.shoot({ me, from: { x: hand.x, y: hand.y, z: hand.z }, dir: { x: dx, z: dz }, speed: 40, range: 10, radius: 0.45,
      hit(e) { if (isBuilding(e)) return false; hooked = e; },
      vis: { move(x, y, z) { tip.set(x, y, z); head.aim(tip, dir); draw(); trail.at(x, y, z); }, done() { trail.stop(); } },
      end(p) {
        const e = hooked as Ent | null;
        if (!e) {      // 没钳到：撞墙的话钳口在墙上磕出一把火星；链子拖着钳头收回手里
          if (p.gone < 9.6) { sparks(fx, tip, 12, { dir: { x: -dx, y: 0.4, z: -dz }, spread: 1.0, speed: [3, 8] }); dirt(fx, { pos: tip, n: 2, size: [0.4, 0.6] }); }
          const from = tip.clone(); head.open(0.3);
          api.run(0.24, k => { tip.lerpVectors(from, a.hand(H), k * k); head.aim(tip, dir); draw(1 - k * 0.6); }, done);
          return;
        }
        // 钳中：钳头卡在它朝着赫达的那一面，钳口“咔”地合上——白热的一闪、一圈火星往外溅、一小股黑烟
        const hgt = heightOf(api, e), l0 = Math.hypot(e.x - me.x, e.z - me.z) || 1, ux = (e.x - me.x) / l0, uz = (e.z - me.z) / l0, up = Math.min(1.35, hgt * 0.45);
        const grip = (out: THREE.Vector3) => out.set(e.x - ux * e.r * 0.75, fx.ground(e.x, e.z) + up, e.z - uz * e.r * 0.75), at = grip(v3()), toMe = { x: -ux, y: 0.3, z: -uz };
        api.hit(me, e, 90 + c.ap * 0.3 + c.lv * 15, "magic"); brand(c, e);
        if (e.kind === "hero") fx.hitstop(0.04);
        head.aim(at, { x: ux, y: 0, z: uz }); draw();
        fx.flash(at, GOLD, 1.4, 0.1); fx.impact(at, { color: GOLD, color2: CHERRY, size: 0.9, dir: toMe, sparks: 3 });
        sparks(fx, at, 16, { speed: [3, 9], life: [0.2, 0.42] }); soot(fx, { pos: at, n: 1, size: [0.4, 0.55], life: [0.5, 0.7], speed: [0.3, 0.8] });
        fx.shake(0.06, 0.14);
        api.run(0.07, k => head.open(0.9 * (1 - k)));
        if (!e.alive) { api.run(0.2, k => { head.alpha(1 - k); chain.alpha(1 - k); draw(1 - k); }, done); return; }
        // 拉回来：拉到赫达面前（大个子的模型比碰撞圈大得多，按身高留出空，不然托尔格会被拉进她怀里）；晕到拉完再 0.5 秒
        const gap = me.r + Math.max(e.r, hgt * 0.32) + 0.5, px = me.x + ux * gap, pz = me.z + uz * gap, far = Math.hypot(e.x - px, e.z - pz);
        if (far > 0.4) api.pull(e, px - ux * 0.3, pz - uz * 0.3, far + 0.3, 0.35);
        api.stun(e, 0.85);
        // 拉的路上：被拉的人身后在地上拖出一道焦痕（一条黑印子，中间断续地透一点红，2 秒淡掉），脚下一路扬土、火星；钳子钳着它，链子越收越短
        const x0 = e.x, z0 = e.z, scar = strip(fx, api, { r: 0.42, life: 2.4, hot: 0, cool: 0.4, alpha: 0.75 }); scar.span(x0, z0, x0 + 0.01, z0);
        let acc = 0;
        api.run(0.36, (_k, dt) => { grip(at); head.aim(at, { x: ux, y: 0, z: uz }); draw(0.9);
          scar.span(x0 + ux * 0.4, z0 + uz * 0.4, e.x, e.z); acc += dt;
          if (acc > 0.09) { acc = 0; const g = fx.ground(e.x, e.z); dirt(fx, { pos: { x: e.x, y: g + 0.12, z: e.z }, n: 1, size: [0.35, 0.55], opacity: [0.14, 0.22], life: [0.35, 0.55], dir: { x: ux, y: 0.3, z: uz }, spread: 0.8 });
            fx.burst({ pos: { x: e.x, y: g + 0.15, z: e.z }, n: 2, sprite: SPR.ember, add: true, color: [GOLD, CHERRY], size: [0.06, 0.1], life: [0.2, 0.35], speed: [1, 3], dir: { x: ux, y: 0.6, z: uz }, spread: 0.7, gravity: 7 }); } },
          () => {      // 拉到了：钳口张开、钳头收回手里
            const from = v3().copy(head.obj.position);
            api.run(0.16, k => { head.open(0.8 * k); tip.lerpVectors(from, a.hand(H), k); head.aim(tip, { x: ux, y: 0, z: uz }); draw(0.9 - k * 0.6); }, done);
          });
      } });
  },
};

// ---------------------------------------------------------------- W 铁镣
const W: SkillDef = { key: "W", name: "铁镣", icon: "hedda_w", cast: "unit", target: "enemy", range: 6, cd: 13, mana: 70,
  desc: "甩出一条烧红的铁链拴住一个敌人 2.5 秒，造成 60 点魔法伤害（随等级提高）、减速 20%。它走到离赫达 6.5 米以外，铁链绷断：它被拽回 2.5 米并眩晕 1.2 秒。",
  start(c) { const { a, fx } = c, h = a.hand(v3(), "Left");      // 出手前：左手攥着的链头一亮、掉几点火星
    fx.burst({ pos: h, n: 1, sprite: SPR.glint, add: true, color: [WHITE, GOLD], size: 0.45, grow: 1.6, life: Math.max(0.12, windup(a, "w")), speed: 0, alpha: 0.8 });
    fx.burst({ pos: h, n: 4, sprite: SPR.ember, add: true, color: [GOLD, CHERRY], size: [0.06, 0.11], life: [0.25, 0.4], speed: [0.5, 2], gravity: 6 }); },
  fire(c) {
    const { me, a, api, fx } = c, tg = c.unit; if (!tg || !tg.alive || isBuilding(tg)) return;
    const DUR = 2.5, FLY = 0.12, MAX = 6.5, ch = ironChain(fx, 0.82), cuff = shackle(fx), grip = shackle(fx), L = v3(), A = v3(), M = v3();
    const ank = (out: THREE.Vector3) => out.set(tg.x, fx.ground(tg.x, tg.z) + 0.28, tg.z);
    const cuffR = Math.max(0.42, tg.r * 0.75); cuff.obj.visible = false; grip.obj.scale.setScalar(0.13);
    let t = 0, on = false, done = false, sparkAcc = 0;
    const freeAll = () => { ch.free(); cuff.free(); grip.free(); };
    const attach = () => { on = true; api.hit(me, tg, 60 + c.lv * 10, "magic"); brand(c, tg);
      // 扣上：脚踝上一个铁环“咔”地合上（从大往里一收）、一圈火星，地上一圈小冲击
      ank(A); cuff.obj.visible = true; sparks(fx, A, 12, { dir: { x: 0, y: 0.6, z: 0 }, spread: 1.3, speed: [2, 6] }); fx.burst({ pos: A, n: 1, sprite: SPR.glint, add: true, color: [WHITE, GOLD], size: 0.9, grow: 1.3, life: 0.1, speed: 0 });
      fx.decal({ kind: "shock", x: tg.x, z: tg.z, r: cuffR + 0.8, life: 0.3, color: GOLD, alpha: 0.6, from: 0.4, fadeIn: 0.05, fadeOut: 0.6 }); };
    const snap = () => {      // 绷断：链子中间崩开一团火星，两截各自弹回去；它被拽回来、晕住
      done = true; M.lerpVectors(L, A, 0.5); const half = ironChain(fx, 0.82), m0 = M.clone();
      fx.burst({ pos: m0, n: LITE ? 14 : 28, sprite: SPR.streak, add: true, color: [WHITE, GOLD], speed: [5, 12], size: [0.13, 0.22], life: [0.25, 0.5], gravity: 10, stretch: 1.4 });
      fx.burst({ pos: m0, n: LITE ? 4 : 8, sprite: SPR.shard, color: [0x3a3532, 0x1c1714], speed: [3, 8], up: 2, size: [0.12, 0.2], life: [0.5, 0.8], gravity: 16, spin: 10 });      // 崩飞的几节碎链
      fx.burst({ pos: m0, n: 1, sprite: SPR.glint, add: true, color: [0xffffff, GOLD], size: 1.6, grow: 1.5, life: 0.12, speed: 0 }); fx.flash(m0, GOLD, 1.5, 0.1);
      fx.decal({ kind: "shock", x: m0.x, z: m0.z, r: 1.5, life: 0.3, color: GOLD, alpha: 0.6, from: 0.2, fadeIn: 0.05, fadeOut: 0.6 });
      fx.shake(0.05, 0.12);
      api.pull(tg, me.x, me.z, 2.5, 0.2); api.stun(tg, 1.4);
      const x0 = tg.x, z0 = tg.z, scar = strip(fx, api, { r: 0.35, life: 1.8, hot: 0.2, cool: 0.7, alpha: 0.8 }); scar.span(x0, z0, x0 + 0.01, z0);
      api.run(0.24, k => { const e1 = k * k, wob = 0.7 * Math.sin(Math.PI * k); a.hand(L, "Left"); ank(A); ch.set(L, M.lerpVectors(m0, L, e1), { sag: -wob, base: 0.7 * (1 - k), head: 1 - k, hot: 0.8 }); half.set(A, v3().lerpVectors(m0, A, e1), { sag: -wob, base: 0.7 * (1 - k), head: 1 - k, hot: 0.8 });      // 两截链子往上一甩、弹回去
        ch.alpha(1 - k * k); half.alpha(1 - k * k); cuff.obj.position.copy(A); cuff.obj.scale.setScalar(cuffR * (1 + 0.5 * k)); cuff.alpha(1 - k); cuff.heat(1 - k); grip.obj.position.copy(L); grip.alpha(1 - k); scar.span(x0, z0, tg.x, tg.z); },
        () => { freeAll(); half.free(); });
      dirt(fx, { pos: { x: tg.x, y: fx.ground(tg.x, tg.z) + 0.15, z: tg.z }, n: 2, size: [0.45, 0.65], opacity: [0.16, 0.24], life: [0.4, 0.6] }); };
    const slack = () => {      // 到时间了：铁环松开，链子垂到地上、凉下去、淡掉
      done = true; const L0 = L.clone(), A0 = A.clone();
      api.run(0.4, k => { ch.set(L0, A0, { sag: 1.6 + 1.5 * k, base: 0.2 * (1 - k), floor: true }); ch.alpha(1 - k); cuff.obj.scale.setScalar(cuffR * (1 + 0.6 * k)); cuff.alpha(1 - k); cuff.heat(0.3 * (1 - k)); grip.alpha(1 - k); }, freeAll); };
    api.run(DUR + FLY, (_k, dt) => {
      if (done) return; t += dt; a.hand(L, "Left"); ank(A); grip.obj.position.copy(L);
      if (!me.alive || !tg.alive) return slack();
      if (t < FLY) { const f = t / FLY; ch.set(L, M.lerpVectors(L, A, f), { head: 1, hot: 1.2, base: 0.2 }); return; }      // 甩出去：链子从手上飞到脚踝
      if (!on) attach();
      const d = Math.hypot(tg.x - me.x, tg.z - me.z), ten = c01((d - 2.2) / (MAX - 2.2));
      if (d > MAX) return snap();
      if (!(tg.slow > 0 && tg.slowK > 0.2 + 1e-3)) api.slow(tg, 0.2, 0.15);      // 每帧续一小段；身上已经有更狠的减速就不碰（api.slow 会顺手把那个更狠的时长也续上）
      // 拴着：松的时候往下垂、颜色偏暗；越绷越直、越红，快断的时候发抖、往下掉火星
      const pop = Math.exp(-(t - FLY) * 12);
      ch.set(L, A, { sag: (1 - ten) * 1.2, base: 0.1 + 0.56 * Math.pow(ten, 1.5) + 0.3 * pop, head: 0.2, hot: 0.9, shake: ten > 0.8 ? (ten - 0.8) * 0.45 : 0, floor: true });      // 绷紧到樱桃红偏橙为止，不烧到发黄（发黄的一整条太亮）
      cuff.obj.position.copy(A); cuff.obj.scale.setScalar(cuffR * (1 + 0.6 * pop)); cuff.heat(0.4 + 0.55 * ten + 0.3 * pop); grip.heat(0.3 + 0.6 * ten);
      sparkAcc += dt * (ten > 0.7 ? 26 * ten : 3);
      while (sparkAcc >= 1) { sparkAcc -= 1; const k = Math.random(); M.lerpVectors(L, A, k); fx.burst({ pos: M, n: 1, sprite: SPR.ember, add: true, color: [GOLD, CHERRY], size: [0.05, 0.1], life: [0.25, 0.45], speed: [0.3, 1.2], gravity: 6 }); }
    }, () => { if (!done) slack(); });
  },
};

// ---------------------------------------------------------------- E 护火
const WARD = 0.7;      // 受到的伤害乘几
const E: SkillDef = { key: "E", name: "护火", icon: "hedda_e", cast: "unit", target: "ally", range: 7, cd: 16, mana: 60,
  desc: "冲到一个友方英雄身边（可以对自己放），两人 3 秒内受到的伤害减少 30%；落地时把身边 2.5 米的敌人推开 1.5 米。",
  start(c) { const { a, fx } = c, g = fx.ground(a.pos.x, a.pos.z);      // 出手前：脚下一圈火星往上跳
    fx.burst({ pos: { x: a.pos.x, y: g + 0.12, z: a.pos.z }, n: LITE ? 6 : 12, sprite: SPR.ember, add: true, ringR: 0.9, color: [GOLD, CHERRY], size: [0.07, 0.12], life: [0.3, 0.5], speed: [0.2, 0.6], up: 2.2, gravity: 5 }); },
  fire(c) {
    const { me, a, api, fx } = c, tg = c.unit && c.unit.alive && c.unit.team === me.team && c.unit !== me ? c.unit : me;
    const land = () => {
      const x = a.pos.x, z = a.pos.z, g = fx.ground(x, z), pair = tg === me ? [me] : [me, tg];
      // 推开：一圈土墙往外推（灰尘冲击环）、地上一圈冲击，被推的人脚下扬土
      let shoved = 0;
      for (const e of foes(api, me, x, z, 2.5)) { const l = Math.hypot(e.x - x, e.z - z), ex = l > 0.05 ? (e.x - x) / l : Math.sin(a.yaw()), ez = l > 0.05 ? (e.z - z) / l : Math.cos(a.yaw());
        api.push(e, ex, ez, 1.5, 0.2); brand(c, e); if (e.kind === "hero") shoved++;
        dirt(fx, { pos: { x: e.x, y: fx.ground(e.x, e.z) + 0.25, z: e.z }, n: 2, dir: { x: ex, y: 0.4, z: ez }, spread: 0.7, size: [0.5, 0.8] }); }
      wall(fx, api, { x, z, r: 2.7, h: 0.95, life: 0.42, from: 0.25, color: DUST, alpha: 0.85 });
      fx.decal({ kind: "shock", x, z, r: 2.6, life: 0.38, color: ASH, alpha: 0.7, from: 0.2, fadeIn: 0.05, fadeOut: 0.6 });
      dirt(fx, { pos: { x, y: g + 0.25, z }, n: 6, ringR: 1.2, dir: { x: 0, y: 0.5, z: 0 }, spread: 1.2, speed: [1.5, 3.5], size: [0.6, 0.9] });
      if (shoved) fx.shake(0.04, 0.1);
      // 两个人：受到的伤害少三成；脚下各一圈暖色的铁箍光环（3 秒，克制），刚套上时身上掠过一圈金光、几点火星往上走；之后身上偶尔掉一点余烬
      for (const p of pair) { if (!p.alive) continue; api.buff(p, "hedda_ward", 3, { dmgTaken: WARD });
        const R = Math.max(1.05, p.r + 0.7), ring = wardRing(fx, p.x, p.z, R), ph = heightOf(api, p), pg = fx.ground(p.x, p.z), ac = api.actor(p);
        if (ac) fx.ghost(ac.hero.model, GOLD, 0.3, 0.32);
        fx.burst({ pos: { x: p.x, y: pg + 0.15, z: p.z }, n: LITE ? 5 : 10, sprite: SPR.ember, add: true, ringR: R * 0.85, color: [WHITE, GOLD], size: [0.07, 0.12], life: [0.45, 0.75], speed: [0.1, 0.3], up: ph * 0.95, drag: 1.3 });
        let drip = 0;
        api.run(3, (k, dt) => { const vis = p.alive && (p.team === 0 || p.seen); ring.set(p.x, p.z); ring.alpha(vis ? 0.8 * c01((1 - k) * 3 / 0.45) * (0.85 + 0.15 * Math.sin(k * 3 * 5)) : 0);
          drip += dt; if (vis && drip > 0.3) { drip = 0; fx.burst({ pos: api.pos(p, ph * (0.45 + Math.random() * 0.3)), n: 1, sprite: SPR.ember, add: true, radius: 0.35, color: [GOLD, CHERRY], size: [0.06, 0.1], life: [0.5, 0.8], speed: 0.2, gravity: 3 }); } },
          () => ring.free()); }
    };
    if (tg === me) { land(); return; }
    // 冲过去：落在友军靠自己这一侧的身边。身后一道矮的火痕（贴地的焦线，一路几撮火舌）。（第一版原地还留一个金色的影子，从上往下看是一块发亮的方块，去掉了）
    const l = Math.hypot(tg.x - me.x, tg.z - me.z) || 1, ux = (tg.x - me.x) / l, uz = (tg.z - me.z) / l, gap = Math.min(l, tg.r + me.r + 0.35), tx = tg.x - ux * gap, tz = tg.z - uz * gap;
    const x0 = a.pos.x, z0 = a.pos.z, scar = strip(fx, api, { r: 0.45, life: 2.2, hot: 0.15, cool: 0.55, alpha: 0.8 }); scar.span(x0, z0, x0 + ux * 0.05, z0 + uz * 0.05);
    let lx = x0, lz = z0, gone = false;
    api.run(0.32, () => { if (gone) return; scar.span(x0 - ux * 0.3, z0 - uz * 0.3, a.pos.x, a.pos.z);
      if (Math.hypot(a.pos.x - lx, a.pos.z - lz) > 0.42) { lx = a.pos.x; lz = a.pos.z; tongue(fx, { pos: { x: lx, y: fx.ground(lx, lz) + 0.03, z: lz }, n: 2, disc: 0.25, size: [0.3, 0.5], life: [0.4, 0.65] });
        fx.burst({ pos: { x: lx, y: fx.ground(lx, lz) + 0.2, z: lz }, n: 2, sprite: SPR.ember, add: true, color: [GOLD, CHERRY], size: [0.06, 0.1], life: [0.3, 0.5], speed: [0.3, 1], up: 1, gravity: 3 }); } });
    api.dash(me, tx, tz, 0.3, () => { gone = true; land(); });
  },
};

// ---------------------------------------------------------------- R 炉心坠
const R: SkillDef = { key: "R", name: "炉心坠", icon: "hedda_r", cast: "point", range: 8, radius: 4, cd: 80, mana: 120, minLevel: 6,
  desc: "从背上的熔炉里掏出炉心掷向一处，0.6 秒后落地：范围内的敌人被击飞 1.1 秒，受到 180 + 50% 法强的魔法伤害（随等级提高）；落点留下 3 秒烧红的炭地，敌人减速 30% 并持续受到伤害。",
  start(c) {
    // 蓄力（0.72 秒）：炉门打开，背上的熔炉往外喷火、烟囱顶上窜一股火；她伸手到背后，一块白热的炉心被掏出来，攥在两手之间举过头顶
    const { a, api, fx } = c, w = windup(a, "r"), F = v3(), Hr = v3(), Hl = v3(), d = c.data;
    const door = puffer(fx, { pos: furnace(a, F, -0.3, 0.62), rate: LITE ? 14 : 28, heat: [0.85, 1], cool: 0.5, smoke: 0x3a332f, opacity: [0.3, 0.42], size: [0.3, 0.5], grow: 2.3, life: [0.4, 0.6], speed: [0.6, 1.6], drag: 2, rise: 2.4, radius: 0.15 });
    fx.burst({ pos: furnace(a, F), n: 1, sprite: SPR.soft, add: true, color: GOLD, alpha: 0.55, size: 2.2, grow: 1.4, life: 0.22, speed: 0 });      // 炉门开的那一下：一道炉火光（0.2 秒）
    const core = forgeCore(fx); core.obj.visible = false; core.heat(1); core.glow(0, 2);
    d.windup = { door, core, live: true };
    let t = 0, acc = 0;
    api.run(Math.max(0.15, w), (_k, dt) => { const W0 = d.windup; if (!W0?.live) return; t += dt; furnace(a, F, -0.3, 0.62); door.at(F.x, F.y, F.z);
      acc += dt; if (acc > 0.05) { acc = 0; fx.burst({ pos: furnace(a, v3(), 1.15, 0.45, -0.3), n: 1, sprite: SPR.ember, add: true, color: [GOLD, CHERRY], size: [0.07, 0.12], life: [0.4, 0.7], speed: [0.5, 1.5], up: 2.5, gravity: -0.5, drag: 0.8 }); }      // 烟囱口往上蹿的火星
      if (t > w * 0.4) { core.obj.visible = true; a.hand(Hr); a.hand(Hl, "Left"); const s = 0.22 + 0.16 * c01((t - w * 0.4) / (w * 0.4)); core.obj.position.lerpVectors(Hr, Hl, 0.5); core.obj.scale.setScalar(s); core.obj.rotation.y += dt * 2; core.glow(0.45, 2.4); } });
    api.after(w * 0.35, () => { if (!d.windup?.live) return; furnace(a, F, 1.1, 0.45, -0.3); blaze(fx, { pos: F, n: 3, dir: { x: 0, y: 1, z: 0 }, spread: 0.3, speed: [3, 5], size: [0.35, 0.55], life: [0.45, 0.65], rise: 2.5 }); });      // 烟囱窜火
  },
  end(c) { const W0 = c.data.windup; if (W0?.live) { W0.live = false; W0.door.stop(); if (!c.data.fired) W0.core.free(); } },      // 蓄力被打断：火灭、炉心收掉
  fire(c) {
    const { me, a, api, fx } = c, x = c.x, z = c.z, RAD = 4, FLIGHT = 0.6, d = c.data, W0 = d.windup; d.fired = true;
    if (W0) { W0.live = false; W0.door.stop(); }
    const core = W0?.core ?? forgeCore(fx), from = v3(); if (W0) from.copy(core.obj.position); else a.hand(from);
    core.obj.visible = true; core.heat(1); core.glow(0.5, 2.6);
    const dist = Math.hypot(x - from.x, z - from.z);
    // 出手：抡出去的那一下手上甩开一把火星
    sparks(fx, from, 10, { dir: { x: x - from.x, y: 0.5, z: z - from.z }, spread: 0.7, speed: [3, 8] });
    // 落点的预警（0.6 秒）：暗红的一片，边上一道亮线收紧到正好的范围，沿边冒小火苗
    const warn = warnRing(fx, x, z, RAD); let wt = 0, lick = 0;
    api.run(FLIGHT, (k, dt) => { wt += dt; warn.k(k); warn.alpha(Math.min(1, wt / 0.08));
      lick += dt * (LITE ? 18 : 36); while (lick >= 1) { lick -= 1; const an = Math.random() * TAU, rr = RAD * (1.22 - 0.22 * (1 - (1 - k) * (1 - k))) * (0.98 + Math.random() * 0.03), ex = x + Math.cos(an) * rr, ez = z + Math.sin(an) * rr;
        tongue(fx, { pos: { x: ex, y: fx.ground(ex, ez) + 0.02, z: ez }, size: [0.22, 0.36], life: [0.28, 0.4], heat: [0.55, 0.8] }); } });
    // 飞的路上：身后一条热的拖尾（头上白热、尾巴收成暗红），一路掉火星、冒烟（烟比火多：是一块冒着烟的烫石头，不是一串火球）
    const smoke = puffer(fx, { pos: from, rate: LITE ? 16 : 32, heat: [0.25, 0.5], cool: 0.3, smoke: 0x2e2826, opacity: [0.3, 0.42], size: [0.32, 0.5], grow: 2.6, life: [0.5, 0.8], speed: [0.1, 0.5], drag: 2, rise: 1.2, radius: 0.12 });
    const embers = fx.emitter({ pos: from, rate: LITE ? 20 : 40, sprite: SPR.ember, add: true, color: [WHITE, GOLD], size: [0.07, 0.13], life: [0.3, 0.6], speed: [0.3, 1.5], gravity: 3 });
    const tail = fx.trail({ color: GOLD, color2: CHERRY, width: 0.62, life: 0.22 });
    let spin = 0;
    api.shoot({ me, from: { x: from.x, y: from.y, z: from.z }, to: { x, z }, arc: 3.2, speed: Math.max(1, dist) / FLIGHT,
      vis: { move(px, py, pz, _dx, _dy, _dz, dt) { spin += dt; const up = c01((py - fx.ground(px, pz) - 1.5) / 3.5);      // 飞到最高处离镜头近了 4 米多，看着大两成：按离地多高缩回去（第四批 polish-new）
          core.obj.position.set(px, py, pz); core.obj.scale.setScalar(0.34 * (1 - 0.24 * up)); core.glow(0.5 - 0.15 * up, 2.6 - 0.8 * up); core.obj.rotation.set(spin * 5, spin * 3, 0); smoke.at(px, py, pz); embers.at(px, py, pz); tail.at(px, py, pz); }, done() { smoke.stop(); embers.stop(); tail.stop(); } },
      end() { warn.free(); land(); } });
    const land = () => {
      const g = fx.ground(x, z), dmg = 180 + c.ap * 0.5 + c.lv * 25; let heroes = 0;
      for (const e of foes(api, me, x, z, RAD)) { api.hit(me, e, dmg, "magic", true); if (!e.alive) continue; api.stun(e, 1.1); brand(c, e);
        if (e.kind === "hero") { heroes++; toss(api, e, 1.4, 0.7); }
        const eg = fx.ground(e.x, e.z); dirt(fx, { pos: { x: e.x, y: eg + 0.2, z: e.z }, n: 2, size: [0.5, 0.8], dir: { x: 0, y: 1, z: 0 }, spread: 0.9 });
        fx.burst({ pos: { x: e.x, y: eg + 0.3, z: e.z }, n: 4, sprite: SPR.ember, add: true, color: [GOLD, CHERRY], size: [0.07, 0.12], life: [0.35, 0.6], speed: [1, 3], up: 3, gravity: 7 }); }
      if (heroes) fx.hitstop(0.05);
      // 落地（全技能最亮的一下，只有这一下）：白芯一闪；一根短而粗的火柱窜起来烧成黑烟；一圈厚的火墙推到范围的边，外面跟一圈土墙；碎石和火星往外崩；镜头抖
      // （第一版这里是一大团橙火，盖住了人、也碰到“发光克制”的线：火柱收窄、火团减半、烧成烟更快）
      fx.flash({ x, y: g + 1.2, z }, GOLD, 3.0, 0.14); fx.shake(0.12, 0.42);
      fx.impact({ x, y: g + 0.6, z }, { color: GOLD, color2: CHERRY, size: 1.4, big: true });
      blaze(fx, { pos: { x, y: g + 0.4, z }, n: 9, disc: 0.55, dir: { x: 0, y: 1, z: 0 }, spread: 0.18, speed: [8, 13], drag: 2.6, size: [0.65, 0.95], grow: 2.2, life: [0.5, 0.75], rise: 3, heat: [0.85, 1], cool: 0.45 });
      blaze(fx, { pos: { x, y: g + 0.5, z }, n: 5, disc: 0.4, dir: { x: 0, y: 1, z: 0 }, spread: 0.1, speed: [13, 17], drag: 3, size: [0.5, 0.75], grow: 2.2, life: [0.45, 0.65], rise: 2, heat: [0.9, 1], cool: 0.4, shape: "streak", stretch: 0.5 });
      for (let i = 0; i < 7; i++) { const an = (i / 7) * TAU + (Math.random() - 0.5) * 0.8, dir = { x: Math.sin(an), y: 0.05, z: Math.cos(an) };      // 贴着地往外滚的几团火（快慢差得多，不排成一圈珠子）
        blaze(fx, { pos: { x: x + dir.x * 0.8, y: g + 0.4, z: z + dir.z * 0.8 }, n: 1, dir, spread: 0.2, speed: [4, 15], drag: 3.2, size: [0.4, 0.65], grow: 2.4, life: [0.4, 0.65], rise: 1.2, cool: 0.45, shape: "streak", stretch: 0.35 }); }
      wall(fx, api, { x, z, r: RAD * 1.02, h: 1.6, life: 0.5, from: 0.12, fire: true });
      wall(fx, api, { x, z, r: RAD * 1.12, h: 1.3, life: 0.75, from: 0.15, color: DUST, alpha: 0.75 });
      fx.decal({ kind: "shock", x, z, r: RAD * 1.05, life: 0.45, color: GOLD, alpha: 0.8, from: 0.12, fadeIn: 0.04, fadeOut: 0.6 });
      fx.burst({ pos: { x, y: g + 0.4, z }, n: LITE ? 8 : 16, sprite: SPR.shard, color: [0x2e2a28, 0x151312], spread: 1.0, speed: [4, 11], size: [0.14, 0.26], life: [0.5, 0.9], gravity: 17, spin: 9, radius: 0.8 });
      fx.burst({ pos: { x, y: g + 0.4, z }, n: LITE ? 9 : 18, sprite: SPR.ember, add: true, color: [WHITE, GOLD], spread: 1.1, speed: [4, 10], size: [0.08, 0.15], life: [0.5, 1.0], gravity: 8, radius: 1.0 });
      soot(fx, { pos: { x, y: g + 1.5, z }, n: 6, radius: 1.2, size: [1.0, 1.5], life: [1.4, 2.0], speed: [0.4, 1.2], up: 1.2 });
      // 留下的：炉心半埋在落点中间慢慢凉；一片龟裂的炭地（3 秒里一明一暗，最后一秒凉黑，再一秒淡掉），上面零星的火舌和往上飘的火星
      const bed = coalBed(fx, x, z, RAD); core.obj.position.set(x, g + 0.15, z); core.obj.scale.setScalar(0.5); core.obj.rotation.set(0.4, Math.random() * TAU, 0.2);
      api.run(4.2, k => { const t = k * 4.2; bed.grow(Math.min(1.25, t / 0.22)); bed.heat(t < 0.25 ? 1.3 : t < 2.2 ? 1 - (t - 0.25) * 0.08 : Math.max(0, 0.84 * (1 - (t - 2.2) / 0.9))); bed.alpha(t < 3.2 ? 1 : 1 - (t - 3.2));
          core.heat(Math.max(0.15, 1 - t * 0.22)); core.glow(Math.max(0, 0.42 * (1 - t / 3)), 2.4); core.obj.position.y = g + 0.15 - 0.35 * c01((t - 3) / 1.2); core.alpha(1 - c01((t - 3.2) / 1)); },
        () => { bed.free(); core.free(); });
      let acc = 0;
      api.zone({ me, x, z, r: RAD, dur: 3, tick: 0.5,
        every(_z, list) { for (const e of list) { if (isBuilding(e)) continue; api.slow(e, 0.3, 0.6); api.hit(me, e, 20 + c.lv * 4, "magic");
          tongue(fx, { pos: api.pos(e, 0.05), n: 1, disc: 0.3, size: [0.35, 0.5], life: [0.35, 0.5], opacity: 0.4 }); } },
        frame(zn, dt) { const k = c01((zn.dur - zn.t) / 0.8); acc += dt * k;
          while (acc > 0) { acc -= LITE ? 0.07 : 0.035; const [fxx, fzz] = inDisc(x, z, RAD * 0.85), y = fx.ground(fxx, fzz), roll = Math.random();
            if (roll < 0.35) tongue(fx, { pos: { x: fxx, y: y + 0.03, z: fzz }, size: [0.3, 0.5] });
            else if (roll < 0.85) fx.burst({ pos: { x: fxx, y: y + 0.15, z: fzz }, n: 1, sprite: SPR.ember, add: true, color: [GOLD, CHERRY], size: [0.06, 0.11], life: [0.8, 1.4], speed: [0.1, 0.4], up: 1.5, gravity: -0.5, drag: 0.5 });
            else soot(fx, { pos: { x: fxx, y: y + 0.4, z: fzz }, n: 1, opacity: [0.22, 0.32] }); } } });
    };
  },
};

export const hedda: HeroKit = {
  id: "hedda", name: "赫达", title: "缚钳", role: "辅助", side: 1, color: GOLD, color2: CHERRY, height: 3.3,
  base: { hp: 3900, mana: 700, ad: 120, ap: 30, armor: 40, mr: 32, ms: 5.5, as: 0.9, range: 2.6, cdr: 0, ls: 0, hpRegen: 0.008, manaRegen: 0.016 },
  skills: [P, Q, W, E, R],
  attack(c) {      // 普攻：火钳砸中，钳口撞出一小撮火星和一点黑烟（不发光）
    const { me, api, fx, target: e } = c, at = api.pos(e, isBuilding(e) ? 2.2 : Math.min(1.4, heightOf(api, e) * 0.5)), dir = { x: e.x - me.x, y: 0.5, z: e.z - me.z };
    fx.burst({ pos: at, n: LITE ? 4 : 8, sprite: SPR.streak, add: true, color: [GOLD, CHERRY], dir, spread: 1.0, speed: [3, 7], size: [0.08, 0.14], life: [0.18, 0.32], gravity: 14, stretch: 1.1 });
    soot(fx, { pos: at, n: 1, size: [0.35, 0.5], life: [0.6, 0.9], speed: [0.2, 0.6], opacity: [0.25, 0.35] });
  },
  passive(c, dt) {
    const { me, a, api, fx } = c; warm(fx, api, me.x, me.z); warmHedda(fx, api, me.x, me.z);      // 两份零件的着色器在第一帧编好（只做一次）
    brandTick(c);
    // 背上的熔炉：烟囱口一直冒一缕很淡的烟（看得出“背着一座炉子”），跑起来、死了、看不见的时候不冒
    if (!me.alive || !(me.team === 0 || me.seen)) return;
    a.data.smk = (a.data.smk ?? 0) + dt;
    if (a.data.smk > (a.state() === "move" ? 0.7 : 0.45)) { a.data.smk = 0; const F = furnace(a, v3(), 1.25, 0.45, -0.3); soot(fx, { pos: F, n: 1, size: [0.22, 0.32], grow: 2.6, life: [1.1, 1.6], speed: [0.1, 0.25], up: 0.5, opacity: [0.16, 0.24], rise: 0.6 }); }
  },
};
