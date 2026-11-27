// 卡兹 · 焚爪（打野，烬誓庭，四足巨型猞猁）。设计在 docs/round9/heroes/DESIGN.md 的“卡兹”一节。
//
//   被动 灼痕   普攻对野怪多打 30%。同一个目标每被普攻第三下，烧它 2 秒：共 40 + 每级 8 + 30% 攻击力（魔法，每 0.5 秒结一次）。
//   Q 扑杀      指向敌方单位，距离 7.5，冷却 9，法力 50。扑到目标身上：120 + 80% 攻击力 + 每级 25（物理），英雄眩晕 0.6 秒；
//              目标是野怪时伤害 ×1.5、冷却返还一半。
//   W 裂爪      直接放，半径 3.2，冷却 6，法力 40。原地先右后左各扫一爪（间隔照动作时间表的 second），每爪 80 + 50% 攻击力 + 每级 15（物理），
//              按造成伤害的 15% 回血（打野怪也回）。
//   E 炉吼      非指向扇形，距离 5.5，半张角 35°，冷却 12，法力 60。扇形里的敌人减速 45% 1.8 秒、易伤 15% 3 秒，受 60 + 每级 12 的魔法伤害。
//   R 焚猎      指向敌方英雄，距离 7，6 级，冷却 70，法力 100。扑到它身上：200 + 60% 攻击力 + 每级 30（物理）；之后 6 秒“锁定”：
//              它受到卡兹的伤害多 30%、卡兹朝它移动时移速多 35%；它在锁定期间死了，Q、W 冷却立刻转好，卡兹回复 20% 最大生命。
//
// 实现上定下来的几件规格里没写的事：
//   · 技能都不打建筑（塔、水晶），和别的英雄一致；被动的灼烧也不点建筑。
//   · 扑杀、焚猎是“点了就扑上去”：起跳时朝目标当时的位置跳，落地时目标还在 4 米（焚猎 5 米）以内就算扑中——闪现、冲刺躲开的算扑空。
//     跳的时长照动作时间表：起跳是 release，落地是 land（q 0.33 秒、r 0.54 秒）。扑的途中被眩晕打断就停在半路，没有伤害。
//   · 扑跃的高度：动作本身已经把身子抬起来了（模型任务留下的坑：q、r 的动作里爪尖离地最高约 0.8 米、胸口抬起 2 米，按 2.8 米的个头算），
//     程序只按扑的距离再补一点抛物线（扑杀最多 0.55 米、焚猎 0.3～0.8 米），近处的扑基本不加，不会叠成“飞上天”。见 passive 里的 leap。
//   · 焚猎只能扑英雄，但引擎的指向技能只分敌我。点到小兵、野怪时：它身边 3 米内有够得着的敌方英雄就换成扑那个英雄，没有就不放（不花冷却和法力）。
//   · “受到卡兹的伤害多 30%”只算卡兹自己的普攻、技能和被动灼烧（装备的附加伤害走规则那边，不加）；没有用 api.expose，因为那是全队的易伤，而且会和炉吼的易伤互相顶掉。
//   · “朝它移动时移速多 35%”：锁定期间卡兹在走、而且面朝它（夹角 60° 以内）就续一个 0.3 秒的移速增益。
//   · 锁定期间它被谁打死都算（不一定是卡兹的最后一击），和设计的“它在锁定期间死了”一致。
//
// 特效的路数（第二轮的标准，见 docs/round9/k-kaz/分镜.md）：锻炉边上的火——熔岩红为主、熔铁的橙只在芯和刚划开的那一下、黑烟、焦痕；
// 卡兹自己的识别是“三道爪痕”：普攻在目标身上、扑杀落地在地上、锁定的火圈里三道往里指的刻度。火团用 fx_fx2c 的（取偏低温的那一段，比葛隆红、暗），
// 爪痕、热浪扇、烙印、火圈、焦痕是 fx_k-kaz 自己画的，W 的大弧光用 fx_fx2a 的月牙。

import * as THREE from "three";
import type { Actor } from "../actor";
import type { Ent } from "../sim";
import type { Api, Cast, HeroKit, SkillDef } from "../skills";
import { SPR, type FxLib, type V3 } from "../fxlib";
import { LITE } from "../../quality";
import { mark, warmFx2a, windup } from "../fx_fx2a";
import { puff, puffer, tracer, wall, warm as warm2c, type PuffOpts, type Tracer } from "../fx_fx2c";
import { helix } from "../fx_fx2b";
import { brand, claw, fan, fireRing, rake, scorch, sweepArc, warmKaz, type Patch } from "../fx_k-kaz";
import { pick } from "../fxb";

const LAVA = 0xd8432a, MOLTEN = 0xffb070, IRON = 0x2a2624, ASH = 0x8b8279;      // 主色熔岩红、熔铁的亮橙、黑铁、灰
const CINDER = 0x7a2414, DUST = 0x8a7d68, SOOT = 0x2a2220;                       // 快凉下去的暗红、土、黑烟
const QR = 7.5, WR = 3.2, ER = 5.5, EA = 0.611, RR = 7;
const v3 = () => new THREE.Vector3();
const c01 = (v: number) => Math.max(0, Math.min(1, v));
const isBuilding = (e: Ent) => e.kind === "tower" || e.kind === "core";
/** 玩家这一队看不看得见它（看不见的单位身上不画持续的特效） */
const vis = (e: Ent) => e.team === 0 || e.seen;
/** 动作时间表里 release 之后某个时刻（land 落地、second 第二爪）离出手有几秒（对局时间） */
const after = (a: Actor, key: string, field: "land" | "second", def: number) => { const m = (a.meta.skills as Record<string, any>)[key]; return m && typeof m[field] === "number" ? Math.max(0.05, (m[field] - m.release) / (m.speed ?? 1)) : def; };

// 锻炉的火（fx_fx2c 的 puff 配方）：卡兹的火取偏低温的一段，红、暗、烟多
const flare = (fx: FxLib, o: Partial<PuffOpts> & { pos: V3 }) => puff(fx, { heat: [0.5, 0.78], cool: 0.5, smoke: SOOT, opacity: [0.35, 0.5], drag: 3, rise: 1.6, grow: 2.4, size: [0.5, 0.85], life: [0.55, 0.85], speed: [2, 5], ...o });
const tongue = (fx: FxLib, o: Partial<PuffOpts> & { pos: V3 }) => puff(fx, { shape: "tongue", heat: [0.5, 0.75], cool: 0.6, smoke: SOOT, opacity: 0.3, drag: 1, rise: 1.4, grow: 1.3, size: [0.3, 0.55], life: [0.4, 0.65], speed: [0.05, 0.25], up: 0.3, n: 1, ...o });
const soot = (fx: FxLib, o: Partial<PuffOpts> & { pos: V3 }) => puff(fx, { heat: 0, smoke: 0x2e2724, opacity: [0.3, 0.45], drag: 1, rise: 0.9, grow: 2.2, size: [0.7, 1.1], life: [1.1, 1.7], speed: [0.1, 0.5], ...o });
const dirt = (fx: FxLib, o: Partial<PuffOpts> & { pos: V3 }) => puff(fx, { heat: 0, smoke: 0x564c42, opacity: [0.14, 0.24], drag: 3, rise: 0.3, grow: 2.0, size: [0.45, 0.75], life: [0.4, 0.7], speed: [1, 3], ...o });      // 扬土：比葛隆的淡、小、短（第一轮在草地上像一团团棉花）
const embers = (fx: FxLib, pos: V3, n: number, o: Record<string, any> = {}) => fx.burst({ pos, n, sprite: SPR.ember, add: true, color: [MOLTEN, LAVA], size: [0.07, 0.13], life: [0.3, 0.6], speed: [1, 4], gravity: 5, ...o });

/** 扑跃身后的一道火痕：一道 fx2c 的弹道光，头跟着后胯（胸口往后 1.3 米、低 0.3 米），尾巴慢慢追上来（预乘透明、两边垫暗，在青绿的地面上也是红的，不发粉）。sec 秒以后在 0.15 秒里收掉。
 *  第四批 polish-new：原来头跟着胸口，整道火痕藏在大猫的身子底下，空中几乎看不见；挪到身后以后从尾巴那头拖出来 */
function streakBehind(a: Actor, api: Api, fx: FxLib, sec: number, width: number, alpha: number) {
  const rear = (o: THREE.Vector3) => { a.chest(o); const y = a.yaw(); o.x -= Math.sin(y) * 1.3; o.z -= Math.cos(y) * 1.3; o.y -= 0.3; return o; };
  const t = tracer(fx, { width, core: 0.16, color: MOLTEN, color2: LAVA, taper: 1.1, hot: 0.7 }), head = rear(v3()), tail = head.clone(), tmp = v3();
  api.run(sec + 0.15, (k, dt) => { const tt = k * (sec + 0.15); if (tt <= sec) rear(head); tail.lerp(head, 1 - Math.exp(-dt * (tt <= sec ? 6 : 20))); t.set(tail, tmp.copy(head)); t.alpha(alpha * (tt <= sec ? Math.min(1, tt / 0.04) : 1 - (tt - sec) / 0.15)); }, () => t.free());
}

// 每个卡兹自己跨帧存的东西（放在 a.data 里）
interface Burn { e: Ent; left: number; acc: number; per: number; fire: ReturnType<typeof puffer>; smoke: ReturnType<typeof puffer>; }
interface Hunt { e: Ent; until: number; ring: Patch; line: Tracer; buffAt: number; acc: number; }
interface State { hits: Map<number, number>; burns: Map<number, Burn>; leap: { t0: number; dur: number; h: number } | null; hunt: Hunt | null; swing: number; }
const st = (a: Actor): State => (a.data.kaz ??= { hits: new Map(), burns: new Map(), leap: null, hunt: null, swing: 0 });
/** 锁定的猎物受到卡兹的伤害多 30% */
const amp = (S: State, e: Ent, now: number) => (S.hunt && S.hunt.e === e && now < S.hunt.until ? 1.2 : 1);
const bone = (a: Actor, name: string, out: THREE.Vector3) => { const b = a.hero.bone(name); return b ? b.getWorldPosition(out) : a.chest(out); };
const PAW = { L: "tripo0_Left_Limb_5", R: "tripo0_Right_Limb_5" };      // 前爪的末端骨骼（tripo0 是前腿，tripo1 是后腿）

/** 扑：朝 e 跳过去，落在它面前（留出 gap 米，卡兹的头在身子前面）。dur 秒；h 是程序再补的抛物线高度。返回起跳时朝它的方向（单位向量） */
function pounce(c: Cast, e: Ent, dur: number, gap: number, h: number, done: () => void): { ux: number; uz: number } {
  const { me, a, api } = c, S = st(a), x0 = a.pos.x, z0 = a.pos.z; let ux = e.x - x0, uz = e.z - z0; const d0 = Math.hypot(ux, uz) || 1; ux /= d0; uz /= d0;
  const go = Math.max(0, d0 - (e.r + gap)); S.leap = { t0: api.time(), dur, h }; a.face(e.x, e.z, true);
  api.dash(me, x0 + ux * go, z0 + uz * go, dur, done); return { ux, uz };
}

// ---------------------------------------------------------------- 被动 灼痕
const P: SkillDef = { key: "P", name: "灼痕", icon: "kaz_p", cast: "passive", desc: "普攻对野怪多造成 15% 伤害。同一个目标每被普攻第三下，灼烧它 2 秒，共造成 40 + 30% 攻击力的魔法伤害（随等级提高）。" };
/** 第三下点燃：目标身上一小簇火舌和细烟烧 2 秒，每 0.5 秒结一次伤害、飘一点余烬（伤害在 passive 里结） */
function sear(me: Ent, a: Actor, api: Api, fx: FxLib, e: Ent) {
  const S = st(a), per = (40 + 8 * (me.h?.level ?? 1) + 0.3 * api.stat(me).ad) / 4, old = S.burns.get(e.id), at = api.pos(e, 1.0);
  if (old) { old.left = 2; old.per = per; } else {
    const fire = puffer(fx, { pos: at, rate: LITE ? 9 : 16, shape: "tongue", heat: [0.55, 0.78], cool: 0.6, smoke: SOOT, opacity: 0.32, drag: 1, rise: 1.4, grow: 1.3, size: [0.36, 0.58], life: [0.35, 0.55], speed: [0.05, 0.25], up: 0.3, disc: 0.3 });
    const smoke = puffer(fx, { pos: at, rate: 3, heat: 0, smoke: 0x2e2724, opacity: [0.18, 0.28], drag: 1, rise: 0.9, grow: 2.2, size: [0.35, 0.55], life: [0.9, 1.3], speed: [0.1, 0.4], radius: 0.25 });
    S.burns.set(e.id, { e, left: 2, acc: 0, per, fire, smoke }); }
  // 点着的那一下：一小团火从爪痕上窜起来，崩几点火星
  flare(fx, { pos: at, n: 4, dir: { x: 0, y: 1, z: 0 }, spread: 0.9, speed: [1, 2.5], size: [0.35, 0.55], life: [0.4, 0.6], heat: [0.6, 0.85] });
  embers(fx, at, 8, { spread: 1.4, speed: [1.5, 4], up: 1.5 });
}

// ---------------------------------------------------------------- Q 扑杀
const Q: SkillDef = { key: "Q", name: "扑杀", icon: "kaz_q", cast: "unit", target: "enemy", range: QR, cd: 9, mana: 50,
  desc: "扑到一个敌方单位身上，造成 120 + 80% 攻击力的物理伤害（随等级提高），英雄被眩晕 0.6 秒。目标是野怪时伤害提高 30%，冷却返还一半。",
  start(c) {      // 起手：后腿下蹲（动作），面甲的眼缝亮一下，脚边扬一点灰
    const { a, fx } = c, w = windup(a, "q"), hd = a.hand(v3()), y = fx.ground(a.pos.x, a.pos.z);
    fx.burst({ pos: hd, n: 1, sprite: SPR.glint, add: true, color: [0xffe2b8, LAVA], size: 0.55, grow: 1.7, life: Math.min(0.16, w), speed: 0, alpha: 0.9 });
    dirt(fx, { pos: { x: a.pos.x, y: y + 0.15, z: a.pos.z }, n: 4, ringR: 1.0, dir: { x: 0, y: 1, z: 0 }, spread: 1.2, speed: [0.4, 1.2], size: [0.5, 0.8], opacity: [0.16, 0.26] });
  },
  fire(c) {
    const { me, a, api, fx } = c, e = c.unit, S = st(a); if (!e || !e.alive) return;
    const dur = after(a, "q", "land", 0.33), x0 = a.pos.x, z0 = a.pos.z, y0 = fx.ground(x0, z0), d0 = Math.hypot(e.x - x0, e.z - z0) - e.r - 2.1;
    a.lock(dur + 0.14);
    // 起跳：后脚蹬起一蓬土、地上一圈土色的环
    const dir = { x: (e.x - x0) / (Math.hypot(e.x - x0, e.z - z0) || 1), z: (e.z - z0) / (Math.hypot(e.x - x0, e.z - z0) || 1) };
    dirt(fx, { pos: { x: x0 - dir.x * 0.9, y: y0 + 0.2, z: z0 - dir.z * 0.9 }, n: 6, dir: { x: -dir.x, y: 0.55, z: -dir.z }, spread: 0.9, speed: [1.5, 3.5] });
    fx.decal({ kind: "shock", x: x0, z: z0, r: 1.5, life: 0.35, color: DUST, alpha: 0.55, add: false, from: 0.3, fadeIn: 0.05, fadeOut: 0.6 });
    // 空中：身后一条很短的火痕、一串火星；跳出去一截以后留两个暗红的影子（起跳那一刻留的影子和身子叠在一起，整只猫看着发粉）
    streakBehind(a, api, fx, dur, 1.0, 0.9); const em = fx.emitter({ pos: a.pos, rate: LITE ? 40 : 70, sprite: SPR.ember, add: true, color: [MOLTEN, LAVA], size: [0.07, 0.13], life: [0.25, 0.45], speed: [0.3, 1.5], gravity: 3, radius: 0.4 }), ch = v3();
    api.run(dur, () => { a.chest(ch); em.at(ch.x, ch.y - 0.2, ch.z); }, () => em.stop());
    for (const k of [0.3, 0.65]) api.after(dur * k, () => { if (me.alive && st(a).leap) fx.ghost(a.hero.model, CINDER, 0.18, 0.18); });
    const { ux, uz } = pounce(c, e, dur, 2.1, Math.min(0.55, Math.max(0, (d0 - 1.5) * 0.09)), () => {      // 落在普攻够得着的地方（头在身子前面一米多，再近就把头插进它身子里）
      if (!me.alive) return; const x = a.pos.x, z = a.pos.z, y = fx.ground(x, z), yaw = Math.atan2(ux, uz), side = (S.swing = (S.swing + 1) % 2) ? 1 : -1;
      const ok = e.alive && api.canHit(me, e) && Math.hypot(e.x - x, e.z - z) < e.r + 4;
      // 落地：一圈土色的冲击环（半径 1.8，立着的土墙 + 贴地的环）、扬起一圈土；面前的地上三道斜着的大爪痕，烧红的线 1.5 秒里慢慢凉成黑的
      wall(fx, api, { x, z, r: 1.9, h: 0.8, life: 0.4, from: 0.3, color: DUST, alpha: 0.75 });
      fx.decal({ kind: "shock", x, z, r: 1.8, life: 0.4, color: DUST, alpha: 0.7, add: false, from: 0.25, fadeIn: 0.04, fadeOut: 0.6 });
      dirt(fx, { pos: { x, y: y + 0.25, z }, n: 8, ringR: 0.9, dir: { x: 0, y: 1, z: 0 }, spread: 1.3, speed: [1.2, 3] });
      rake(api, fx, { x: x + ux * 1.7 - uz * side * 0.5, z: z + uz * 1.7 + ux * side * 0.5, yaw: yaw + side * 0.5, len: 2.0, wid: 1.15, life: 1.7, hot: 0.25, cool: 1.0 });
      fx.shake(0.06, 0.15);
      if (!ok) return;
      let dmg = (120 + c.ad * 0.8 + c.lv * 25) * amp(S, e, api.time()); if (e.kind === "monster") dmg *= 1.3;
      api.hit(me, e, dmg, "phys", true); if (e.alive && e.kind === "hero") api.stun(e, 0.6);
      if (e.kind === "monster") a.setCd("Q", a.cdLeft("Q") * 0.5);
      // 扑中的那一下：三道爪痕划过它的身子、白芯一闪，火星顺着扑的方向崩出去
      const at = api.pos(e, 1.1);
      claw(api, fx, { pos: at, size: 1.2 + e.r * 0.2, rot: side * 0.4, life: 0.26, sweep: 0.06 });
      fx.impact(at, { color: MOLTEN, color2: LAVA, size: 1.05, dir: { x: ux, y: 0.3, z: uz } });
      fx.burst({ pos: at, n: 12, sprite: SPR.streak, add: true, color: [MOLTEN, LAVA], dir: { x: ux, y: 0.4, z: uz }, spread: 0.7, speed: [4, 10], size: [0.08, 0.15], life: [0.18, 0.36], gravity: 14, stretch: 1.1 });
      if (e.kind === "hero") fx.hitstop(0.04);
    });
  },
  end(c, interrupted) { if (interrupted) st(c.a).leap = null; },      // 跳到半路被眩晕：落回地上，不再往上抛
};

// ---------------------------------------------------------------- W 裂爪
/** 一爪：i=0 先从右往左扫，i=1 再从左往右扫回来 */
function swipe(c: Cast, i: number) {
  const { me, a, api, fx } = c, S = st(a); if (!me.alive) return;
  const x = a.pos.x, z = a.pos.z, y = fx.ground(x, z), yaw = a.yaw(), now = api.time(), dmg = 80 + c.ad * 0.5 + c.lv * 15, turn = i ? -1 : 1; let gain = 0;
  for (const e of api.enemies(me, x, z, WR)) { if (isBuilding(e)) continue;
    gain += api.hit(me, e, dmg * amp(S, e, now), "phys");
    const at = api.pos(e, 1.0), rx = e.x - x, rz = e.z - z, rl = Math.hypot(rx, rz) || 1, tx = (-rz / rl) * turn, tz = (rx / rl) * turn;      // 火星顺着爪子扫过去的方向（切线）崩出去
    fx.burst({ pos: at, n: 6, sprite: SPR.streak, add: true, color: [MOLTEN, LAVA], dir: { x: tx + rx / rl * 0.4, y: 0.35, z: tz + rz / rl * 0.4 }, spread: 0.6, speed: [3, 7], size: [0.07, 0.13], life: [0.16, 0.32], gravity: 12, stretch: 1.1 });
    fx.burst({ pos: at, n: 1, sprite: SPR.glint, add: true, color: [0xffe2b8, LAVA], size: 0.6, grow: 1.4, life: 0.09, speed: 0, alpha: 0.8 }); }
  if (gain > 0) { api.heal(me, me, gain * 0.1);      // 回血：身上一点暖色的光，往上飘几点余烬（很淡）
    const ch = a.chest(v3()); fx.burst({ pos: ch, n: 1, sprite: SPR.soft, add: true, color: [MOLTEN, LAVA], size: 1.6, grow: 1.3, life: 0.3, speed: 0, alpha: 0.28 });
    embers(fx, { x, y: y + 0.5, z }, 5, { radius: 0.8, speed: [0.2, 0.6], up: 1.8, gravity: -0.5, life: [0.5, 0.8] }); }
  // 一道 270° 的弧光贴着地面扫一圈（实的熔岩红月牙，外沿熔铁的亮边），地上留一圈弧形的爪痕；弧光甩出去一圈火星
  // （第四批 polish-new：弧光从离地 0.65 米降到 0.35、宽 1.15 → 1.5：原来高在半空，镜头这边看过去后半圈被身子挡住；两爪的半径错开 0.3，不叠成同一圈）
  sweepArc(api, fx, { pos: { x, y: y + 0.35, z }, yaw, r: WR + 0.15 - i * 0.3, w: 1.5, arc: 4.71, flip: i === 1, sweep: 0.11, life: 0.36 });
  mark(api, fx, { kind: "groove", x, z, r: WR + 0.15 - i * 0.3, yaw: yaw + (Math.random() - 0.5) * 0.3, ang: 2.35, life: 1.2, hot: 0.7, hotLife: 0.22, deep: pick(0x160c08, 0x4a2a17), color2: 0x4a160c, color: MOLTEN, alpha: 0.55, fadeOut: 0.6 });      /* 换画风 B：刮痕的底是烧过的暖褐，不是黑 */      // 地上的刮痕淡一档：三道同心的细弧叠在月牙下面又是“几根线”
  const nn = LITE ? 6 : 12;
  for (let k = 0; k < nn; k++) { const an = yaw + turn * (k / (nn - 1) - 0.5) * 4.2, cs = Math.sin(an), sn = Math.cos(an), d = turn;
    api.after((k / nn) * 0.11, () => fx.burst({ pos: { x: x + cs * (WR - 0.4), y: y + 0.7, z: z + sn * (WR - 0.4) }, n: 1, sprite: SPR.ember, add: true, color: [MOLTEN, LAVA], dir: { x: sn * d + cs * 0.4, y: 0.3, z: -cs * d + sn * 0.4 }, spread: 0.3, speed: [2, 5], size: [0.07, 0.12], life: [0.3, 0.5], gravity: 4 })); }
  fx.shake(0.03, 0.1);
}
const W: SkillDef = { key: "W", name: "裂爪", icon: "kaz_w", cast: "self", radius: WR, cd: 6, mana: 40,
  desc: "原地先右后左各扫一爪，每爪对周围 3.2 米的敌人造成 80 + 50% 攻击力的物理伤害（随等级提高），并按造成伤害的 10% 回复生命。",
  start(c) {      // 起手：两只前爪上亮起熔岩红，拖出两道弧光（跟着爪子走到第二爪扫完）
    const { a, api, fx } = c, w = windup(a, "w"), gap = after(a, "w", "second", 0.3), L = v3(), R = v3();
    const tl = fx.trail({ color: LAVA, color2: CINDER, width: 0.42, life: 0.2 }), tr = fx.trail({ color: LAVA, color2: CINDER, width: 0.42, life: 0.2 });
    bone(a, PAW.L, L); bone(a, PAW.R, R);
    for (const p of [L, R]) fx.burst({ pos: p, n: 1, sprite: SPR.glint, add: true, color: [MOLTEN, LAVA], size: 0.4, grow: 1.8, life: w, speed: 0, alpha: 0.75 });
    c.data.trails = [tl, tr];
    api.run(w + gap + 0.12, () => { if (c.data.cut) return; bone(a, PAW.L, L); bone(a, PAW.R, R); tl.at(L.x, L.y, L.z); tr.at(R.x, R.y, R.z); }, () => { tl.stop(); tr.stop(); });
  },
  fire(c) {
    const { a, api } = c, gap = after(a, "w", "second", 0.3);
    swipe(c, 0); a.lock(gap + 0.06);      // 两爪之间锁住：第二爪一定扫出来（被眩晕打断除外），点了别的命令排在后面
    api.after(gap, () => { if (!c.data.cut) swipe(c, 1); });
  },
  end(c, interrupted) { if (interrupted) { c.data.cut = true; for (const t of c.data.trails ?? []) t.stop(); } },
};

// ---------------------------------------------------------------- E 炉吼
const E: SkillDef = { key: "E", name: "炉吼", icon: "kaz_e", cast: "dir", range: ER, angle: EA, cd: 12, mana: 60,
  desc: "冲着前方一吼：扇形里的敌人减速 45% 持续 1.8 秒，受到的伤害提高 15% 持续 3 秒，并受到 60 点魔法伤害（随等级提高）。",
  start(c) {      // 起手：面甲下透出炉火的光，火星往嘴边收
    const { a, fx } = c, w = windup(a, "e"), hd = a.hand(v3());
    fx.burst({ pos: hd, n: 1, sprite: SPR.glint, add: true, color: [MOLTEN, LAVA], size: 0.45, grow: 2.4, life: w, speed: 0, alpha: 0.75 });
    for (let i = 0; i < (LITE ? 4 : 8); i++) { const an = Math.random() * 6.283, el = Math.random() * 1.2 - 0.3, r = 1.3, p = { x: hd.x + Math.cos(an) * Math.cos(el) * r, y: hd.y + Math.sin(el) * r, z: hd.z + Math.sin(an) * Math.cos(el) * r };
      fx.burst({ pos: p, n: 1, sprite: SPR.ember, add: true, color: [MOLTEN, LAVA], dir: { x: hd.x - p.x, y: hd.y - p.y, z: hd.z - p.z }, spread: 0.03, speed: r / w, size: [0.07, 0.12], life: w, stretch: 0.6 }); }
  },
  fire(c) {
    const { me, a, api, fx } = c, x = me.x, z = me.z, y = fx.ground(x, z), yaw = Math.atan2(c.dx, c.dz), hd = a.hand(v3()), S = st(a), now = api.time(), dmg = 60 + 12 * c.lv;
    for (const e of api.inCone(me, x, z, c.dx, c.dz, ER, EA)) { if (isBuilding(e)) continue;
      api.hit(me, e, dmg * amp(S, e, now), "magic");
      if (e.alive) { api.slow(e, 0.45, 1.8); api.expose(e, 0.15, 3); brand(api, fx, e, { r: e.r + 0.85, life: 3, alpha: 0.75, show: () => vis(e) }); }      // 脚下一个暗红的烙印：3 秒的易伤
      const at = api.pos(e, 1.0); api.after(0.1, () => soot(fx, { pos: at, n: 3, size: [0.45, 0.7], life: [0.8, 1.2], speed: [0.3, 0.9], up: 0.6, opacity: [0.35, 0.5], dir: { x: c.dx, y: 0.3, z: c.dz }, spread: 0.8 }));      // 被吼到的身上冒一小股黑烟
      embers(fx, at, 4, { dir: { x: c.dx, y: 0.3, z: c.dz }, spread: 0.8, speed: [2, 5] }); }
    // 吼：嘴前一闪（不亮）；贴地的扇形热浪由近到远推开，后面跟两道声纹；空中一道发热的淡烟往前推、越推越矮；嘴里喷出一口暗红的热气烧成黑烟；夹着被吹起来的灰烬
    fx.flash(hd, LAVA, 1.1, 0.1, false);
    fan(api, fx, { x, z, yaw, r: ER + 0.25, ang: EA + 0.03, grow: 0.3, fade: 0.4 });
    const mouth = { x: hd.x + c.dx * 0.4, y: hd.y - 0.2, z: hd.z + c.dz * 0.4 };
    for (let i = 0; i < 7; i++) { const an = yaw + (i / 6 - 0.5) * EA * 1.7, d = { x: Math.sin(an), y: 0.02, z: Math.cos(an) };      // 发热的淡烟：一层暗色的烟贴着扇形往外涌，越涌越散
      puff(fx, { pos: { x: x + d.x * 1.6, y: y + 0.7, z: z + d.z * 1.6 }, n: 1, dir: d, spread: 0.15, speed: [7, 11], drag: 2.4, size: [0.6, 0.9], grow: 2.8, life: [0.6, 0.9], heat: [0.06, 0.16], cool: 0.2, smoke: 0x2a211e, opacity: [0.2, 0.3], rise: 0.5 }); }      // 只带一点温度：第一轮 0.25～0.4 一出来是一堵橙色的墙
    fx.burst({ pos: mouth, n: LITE ? 8 : 16, sprite: SPR.shard, color: [ASH, IRON], dir: { x: c.dx, y: 0.15, z: c.dz }, spread: EA * 0.9, speed: [5, 11], drag: 1.6, size: [0.06, 0.12], life: [0.6, 1.0], gravity: 1.5, spin: 7 });      // 灰烬
    fx.burst({ pos: mouth, n: LITE ? 6 : 12, sprite: SPR.ember, add: true, color: [MOLTEN, LAVA], dir: { x: c.dx, y: 0.1, z: c.dz }, spread: EA * 0.9, speed: [5, 12], drag: 1.8, size: [0.06, 0.11], life: [0.45, 0.8], gravity: -0.4 });
    fx.shake(0.05, 0.16);
  },
};

// ---------------------------------------------------------------- R 焚猎
function endHunt(S: State) { const H = S.hunt; if (!H) return; S.hunt = null; H.ring.kill(0.3); H.line.free(); }
const R: SkillDef = { key: "R", name: "焚猎", icon: "kaz_r", cast: "unit", target: "enemy", range: RR, cd: 70, mana: 100, minLevel: 6,
  desc: "扑向一个敌方英雄，造成 200 + 60% 攻击力的物理伤害（随等级提高），并锁定它 6 秒：它受到卡兹的伤害提高 20%，卡兹朝它移动时移速提高 35%。它在锁定期间死亡，扑杀和裂爪的冷却立刻转好，卡兹回复 20% 最大生命。",
  start(c) {
    const { me, a, api, fx } = c, e = c.unit;
    if (e && e.kind !== "hero") {      // 只扑英雄（引擎的指向技能只分敌我）：点到小兵、野怪时换成它旁边够得着的敌方英雄，没有就不放（还没出手，冷却和法力都没花）
      const h = api.enemies(me, e.x, e.z, 3).filter(f => f.kind === "hero" && Math.hypot(f.x - me.x, f.z - me.z) - f.r <= RR + 0.5).sort((p, q) => Math.hypot(p.x - e.x, p.z - e.z) - Math.hypot(q.x - e.x, q.z - e.z))[0];
      if (!h) { c.data.cancel = true; a.finish(); a.stop(); return; } c.unit = h; a.face(h.x, h.z, true); }
    // 起手（前摇多长就多长）：伏低，一圈火从脚下点着、绕一圈烧满；耳簇和眼缝亮起来，火星往身上收
    const w = windup(a, "r", true), x = a.pos.x, z = a.pos.z, hd = a.hand(v3());
    c.data.ring = fireRing(api, fx, { x, z, r: 1.6, life: w + 0.9, ignite: Math.max(0.12, w * 0.75), heat: () => 0.9 });
    for (const up of [0, 0.45]) fx.burst({ pos: { x: hd.x, y: hd.y + up, z: hd.z }, n: 1, sprite: SPR.glint, add: true, color: [0xffe2b8, LAVA], size: up ? 0.4 : 0.6, grow: 2.0, life: w, speed: 0, alpha: 0.85 });
    const ch = a.chest(v3());
    for (let i = 0; i < (LITE ? 6 : 12); i++) { const an = Math.random() * 6.283, p = { x: x + Math.cos(an) * 1.6, y: fx.ground(x, z) + 0.2, z: z + Math.sin(an) * 1.6 };
      fx.burst({ pos: p, n: 1, sprite: SPR.ember, add: true, color: [MOLTEN, LAVA], dir: { x: ch.x - p.x, y: ch.y - p.y, z: ch.z - p.z }, spread: 0.05, speed: Math.hypot(ch.x - p.x, ch.y - p.y, ch.z - p.z) / Math.max(0.12, w), size: [0.07, 0.12], life: Math.max(0.12, w), stretch: 0.6 }); }
    api.run(w, (k, dt) => { c.data.tacc = (c.data.tacc ?? 0) + dt * (LITE ? 10 : 20) * k; while (c.data.tacc >= 1) { c.data.tacc -= 1; const an = Math.random() * 6.283; tongue(fx, { pos: { x: x + Math.cos(an) * 1.5, y: fx.ground(x, z) + 0.05, z: z + Math.sin(an) * 1.5 } }); } });
  },
  fire(c) {
    const { me, a, api, fx } = c, e = c.unit, S = st(a); c.data.fired = true; const ring = c.data.ring as Patch | undefined;
    if (c.data.cancel || !e || !e.alive) { ring?.kill(0.2); return; }
    const dur = after(a, "r", "land", 0.54), x0 = a.pos.x, z0 = a.pos.z, y0 = fx.ground(x0, z0), d0 = Math.hypot(e.x - x0, e.z - z0) - e.r - 2.0;
    a.lock(dur + 0.22);
    // 起跳：脚下那圈火被蹬得往上一窜（一圈矮火墙），土往外扬
    ring?.kill(0.35);
    wall(fx, api, { x: x0, z: z0, r: 1.9, h: 1.2, life: 0.38, from: 0.6, fire: true, alpha: 0.85 });
    dirt(fx, { pos: { x: x0, y: y0 + 0.2, z: z0 }, n: 7, ringR: 1.0, dir: { x: 0, y: 1, z: 0 }, spread: 1.3, speed: [1.5, 3.5] });
    // 空中：拖一道火的残影（一串烧红的影子、身后一路火团烧成黑烟、火星）
    const ch = v3(), trail = puffer(fx, { pos: a.chest(ch), rate: LITE ? 30 : 60, heat: [0.4, 0.62], cool: 0.4, smoke: SOOT, opacity: [0.26, 0.38], size: [0.3, 0.5], grow: 2.4, life: [0.35, 0.55], speed: [0.2, 0.8], drag: 2, rise: 1.2, radius: 0.45 });
    streakBehind(a, api, fx, dur, 1.45, 0.95);
    const em = fx.emitter({ pos: a.pos, rate: LITE ? 40 : 80, sprite: SPR.ember, add: true, color: [MOLTEN, LAVA], size: [0.07, 0.13], life: [0.3, 0.55], speed: [0.3, 1.5], gravity: 3, radius: 0.5 });
    let gh = 0; api.run(dur, (_k, dt) => { a.chest(ch); trail.at(ch.x, ch.y, ch.z); em.at(ch.x, ch.y, ch.z); gh += dt; if (gh > 0.13 && st(a).leap) { gh = 0; fx.ghost(a.hero.model, CINDER, 0.2, 0.18); } }, () => { trail.stop(); em.stop(); });      // 残影隔得开、淡一点（第一轮 0.09 秒一个、叠在身上像整只猫变成粉红）
    const { ux, uz } = pounce(c, e, dur, 2.0, Math.min(0.8, Math.max(0.3, 0.3 + d0 * 0.07)), () => {
      if (!me.alive) return; const x = a.pos.x, z = a.pos.z, y = fx.ground(x, z), yaw = Math.atan2(ux, uz);
      const ok = e.alive && api.canHit(me, e) && Math.hypot(e.x - x, e.z - z) < e.r + 5;
      // 落地（全技能最重的一下）：一闪、镜头抖 0.1；一圈火墙和一圈土墙往外推；落点一块焦痕、面前三道大爪痕；目标脚下一根很矮的火柱
      fx.flash({ x, y: y + 0.8, z }, LAVA, 2.4, 0.12); fx.shake(0.1, 0.28);
      wall(fx, api, { x, z, r: 2.9, h: 1.5, life: 0.5, from: 0.2, fire: true }); wall(fx, api, { x, z, r: 3.3, h: 0.9, life: 0.55, from: 0.2, color: DUST, alpha: 0.7 });
      scorch(api, fx, { x, z, r: 2.3, life: 3.2, hot: 0.4, cool: 1.4 });
      rake(api, fx, { x: x + ux * 1.8 + uz * 0.4, z: z + uz * 1.8 - ux * 0.4, yaw: yaw - 0.35, len: 2.4, wid: 1.4, life: 2.6, hot: 0.35, cool: 1.4 });
      dirt(fx, { pos: { x, y: y + 0.3, z }, n: 10, ringR: 1.3, dir: { x: 0, y: 1, z: 0 }, spread: 1.3, speed: [1.5, 4] });
      fx.burst({ pos: { x, y: y + 0.3, z }, n: LITE ? 10 : 20, sprite: SPR.ember, add: true, color: [MOLTEN, CINDER], spread: 1.2, speed: [3, 8], size: [0.08, 0.14], life: [0.5, 0.9], gravity: 7, radius: 0.8 });
      if (!ok) return;
      const ey = fx.ground(e.x, e.z);
      flare(fx, { pos: { x: e.x, y: ey + 0.25, z: e.z }, n: 9, disc: 0.45, dir: { x: 0, y: 1, z: 0 }, spread: 0.3, speed: [4, 7], drag: 2.5, size: [0.45, 0.7], grow: 2.2, life: [0.4, 0.6], heat: [0.65, 0.9], shape: "streak", stretch: 1.4 });      // 很矮的火柱（0.3 秒就烧成烟）
      for (let i = 0; i < 6; i++) { const an = (i / 6) * 6.283; tongue(fx, { pos: { x: e.x + Math.cos(an) * (e.r + 0.4), y: ey + 0.05, z: e.z + Math.sin(an) * (e.r + 0.4) }, size: [0.4, 0.6] }); }
      api.hit(me, e, 200 + c.ad * 0.6 + c.lv * 30, "phys", true);
      const at = api.pos(e, 1.1); claw(api, fx, { pos: at, size: 1.5 + e.r * 0.2, rot: -0.45, life: 0.32, sweep: 0.07 });
      fx.impact(at, { color: MOLTEN, color2: LAVA, size: 1.4, big: true, dir: { x: ux, y: 0.3, z: uz } }); if (e.kind === "hero") fx.hitstop(0.06);
      if (!e.alive) return; a.attack(e);      // 落地接着打它（点小兵换成英雄的时候，控制器记着的普攻目标还是那个小兵；这时锁着，命令排在锁定结束以后）
      // 锁定 6 秒：它脚下一圈熔岩红的火圈跟着它走（贴地、不刺眼，最后一秒淡出），卡兹和它之间一道很淡的暗红热气线
      endHunt(S); const until = api.time() + 6, alive = { on: true };      // alive：这一次锁定还在（火圈的透明度回调先建好，那时 S.hunt 还没换成这一次）
      const H: Hunt = { e, until, buffAt: 0, acc: 0, line: tracer(fx, { width: 0.34, core: 0.1, color: LAVA, color2: 0x5a160a, taper: 0.5, hot: 0 }),
        ring: fireRing(api, fx, { x: e.x, z: e.z, r: 2.5, life: 6.1, ignite: 0.25, heat: () => (api.time() < until - 5.6 ? 0.75 : 0.42), alpha: () => (alive.on && vis(e) ? c01((until - api.time()) / 1) * (api.time() < until - 5.6 ? 0.8 : 0.58) : 0) }) };      // 比起手的火圈暗一档：要跟 6 秒，不刺眼（第四批：套上的前 0.4 秒亮，之后压到 0.42 的温度、0.58 的不透明，只剩一圈暗红的火和三道刻度）
      const kill = H.ring.kill; H.ring.kill = f => { alive.on = false; kill(f); };
      H.line.alpha(0); S.hunt = H;
    });
  },
  end(c, interrupted) { if (!c.data.fired) (c.data.ring as Patch | undefined)?.kill(0.15); if (interrupted) st(c.a).leap = null; },
};

export const kaz: HeroKit = {
  id: "kaz", name: "卡兹", title: "焚爪", role: "斗士", side: 1, color: LAVA, color2: MOLTEN, height: 2.8, look: { ring: 1.6, height: 3.1 },      // 换画风 B（w-quad）：卡通版的耳簇和肩甲铁片更高，模型的包围盒高 0.70（旧的 0.62），身高照 2.8 放身子会小一成，look 里给模型单独写 3.1（身长和旧的差不多，规则里的 height 不动）。四足的大猫：模型任务定的是身高 2.4 米；第九轮界面任务定了统一的个头（小兵缩小、四足英雄 2.8～3.4 米），照调度的意见定 2.8，身长约 3.7 米
  base: { hp: 3700, mana: 500, ad: 172, ap: 0, armor: 34, mr: 28, ms: 6.0, as: 1.15, range: 2.8, cdr: 0, ls: 0, hpRegen: 0.007, manaRegen: 0.012 },      // 攻击距离：四足的头在身子前面，太近会把头插进目标里。设计是 2.6（按 2.4 米的个头）；个头放到 2.8 以后头往前多伸了 0.2 米，跟着加到 2.8
  skills: [P, Q, W, E, R],
  attack(c) {
    const { me, a, api, fx, target: e } = c, S = st(a); let dmg = c.dmg;
    if (e.kind === "monster") dmg *= 1.15;                                      // 灼痕：打野怪多 15%（第九轮 balance：30% → 15%，卡兹 10 分钟比岚多清四个营地、高两级半）
    dmg *= amp(S, e, api.time());
    // 普攻：左右前爪交替扑抓，三道暗红的爪痕在目标身上一闪，几点火星
    const bld = isBuilding(e), side = (S.swing = (S.swing + 1) % 2) ? 1 : -1, dx = e.x - me.x, dz = e.z - me.z, l = Math.hypot(dx, dz) || 1;
    const at = { x: e.x - (dx / l) * e.r * 0.5, y: api.height(e.x, e.z) + (bld ? 2.0 : 1.1), z: e.z - (dz / l) * e.r * 0.5 };
    claw(api, fx, { pos: at, size: bld ? 1.2 : 0.85 + e.r * 0.25, rot: side * 0.55, life: 0.2, sweep: 0.05, alpha: 0.95 });
    fx.burst({ pos: at, n: 6, sprite: SPR.streak, add: true, color: [MOLTEN, LAVA], dir: { x: dx / l, y: 0.5, z: dz / l }, spread: 1.0, speed: [2.5, 6], size: [0.07, 0.13], life: [0.16, 0.3], gravity: 12, stretch: 1.1 });
    if (!bld) { const n = (S.hits.get(e.id) ?? 0) + 1;                         // 灼痕：同一个目标第三下点燃
      if (S.hits.size > 40) for (const [id] of S.hits) if (!api.sim.ents.some(o => o.id === id && o.alive)) S.hits.delete(id);
      if (n >= 3) { S.hits.set(e.id, 0); sear(me, a, api, fx, e); } else S.hits.set(e.id, n); }
    return Math.round(dmg);
  },
  passive(c, dt) {
    const { me, a, api, fx } = c, S = st(a), now = api.time();
    warmFx2a(api, fx, a.pos.x, a.pos.z); warm2c(fx, api, a.pos.x, a.pos.z); warmKaz(api, fx, a.pos.x, a.pos.z);      // 用到的特效零件第一帧先编好着色器
    // 扑跃：动作自己会把身子抬起来，这里只补一点抛物线（见文件开头）
    if (S.leap) { const k = (now - S.leap.t0) / S.leap.dur; if (k >= 1 || !me.alive) S.leap = null; else a.hero.group.position.y += S.leap.h * 4 * k * (1 - k); }
    // 灼痕的灼烧：每 0.5 秒结一次；火舌和细烟跟着目标走
    for (const [id, b] of S.burns) { const e = b.e; b.left -= dt; b.acc += dt;
      if (b.acc >= 0.5) { b.acc -= 0.5; if (e.alive) { api.hit(me, e, b.per * amp(S, e, now), "magic"); if (vis(e)) embers(fx, api.pos(e, 1.0), 2, { spread: 1.2, speed: [0.3, 1], up: 1.6, gravity: -0.6, life: [0.6, 1.0] }); } }
      if (b.left <= 0 || !e.alive) { b.fire.stop(); b.smoke.stop(); S.burns.delete(id); continue; }
      const p = api.pos(e, e.h ? (api.actor(e)?.kit.height ?? 2.6) * 0.62 : e.kind === "monster" ? 1.3 : 0.9), on = vis(e); b.fire.at(p.x, p.y, p.z); b.smoke.at(p.x, p.y + 0.6, p.z); b.fire.rate(on ? (LITE ? 9 : 16) : 0); b.smoke.rate(on ? 3 : 0); }      // 按个头抬高：英雄的 r 都是 0.6，看不出个头，用 kit 的身高；低了会被大个子（托尔格的龟壳）整个挡住
    // 焚猎的锁定
    const H = S.hunt;
    if (H) { const e = H.e, left = H.until - now;
      if (!me.alive) endHunt(S);
      else if (!e.alive) {      // 锁定期间它死了：Q、W 转好，回 20% 生命。它身上爆一团余烬，卡兹身上一圈暖色的回血光
        endHunt(S); a.setCd("Q", 0); a.setCd("W", 0); api.heal(me, me, me.max * 0.2);
        const ey = fx.ground(e.x, e.z), p = { x: e.x, y: ey + 1.0, z: e.z };
        flare(fx, { pos: p, n: 10, radius: 0.5, spread: 1.4, speed: [2, 5], size: [0.5, 0.8], life: [0.6, 0.9], heat: [0.6, 0.85] });
        embers(fx, p, LITE ? 14 : 28, { spread: 1.5, speed: [2, 6], up: 2.5, gravity: 2, life: [0.6, 1.2], radius: 0.4 }); soot(fx, { pos: p, n: 5, radius: 0.5, up: 0.8 });
        helix({ api, fx }, { x: a.pos.x, y: a.pos.y, z: a.pos.z, h: a.kit.height, r: 1.5, life: 0.9, color: MOLTEN, color2: LAVA, alpha: 0.55, follow: () => (me.alive ? a.pos : null) });
        fx.ring(a.pos.x, a.pos.z, 1.9, LAVA, 0.45);
      }
      else if (left <= 0) endHunt(S);
      else {
        H.ring.set(e.x, e.z);
        const show = vis(e) && vis(me), fade = c01(left / 1), ch = a.chest(v3()), tp = api.pos(e, 1.0), far = Math.hypot(e.x - me.x, e.z - me.z);
        H.line.set(ch, tp); H.line.alpha(show && far < 16 ? 0.42 * fade * c01((now - (H.until - 6)) / 0.3) : 0);
        H.acc += dt * (show ? (LITE ? 3 : 6) : 0);      // 火圈上偶尔窜起一撮火舌
        while (H.acc >= 1) { H.acc -= 1; const an = Math.random() * 6.283; tongue(fx, { pos: { x: e.x + Math.cos(an) * 2.3, y: fx.ground(e.x, e.z) + 0.05, z: e.z + Math.sin(an) * 2.3 }, size: [0.3, 0.45], opacity: 0.25 }); }
        // 朝它走：移速多 35%（面朝它、夹角 60° 以内，每 0.15 秒续一次 0.3 秒的增益）
        if (a.state() === "move" && now >= H.buffAt) { const ang = Math.atan2(e.x - me.x, e.z - me.z) - a.yaw(); if (Math.cos(ang) > 0.5) { api.buff(me, "kaz_hunt", 0.3, { msMul: 1.35 }); H.buffAt = now + 0.15; } }
      }
    }
  },
};
