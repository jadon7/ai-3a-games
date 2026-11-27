// 英雄的控制器（阶段 5）：一个英雄在场上怎么动。六个英雄共用这一份，谁在下命令都一样（玩家、测试脚本，以后的电脑对手）。
//
// 命令只有四种：走到某处、打某个单位、放某个技能、停下。控制器负责把命令变成位置和动作：
//   · 沿寻路给的路走；打人时走到够得着的地方再出手，出手的快慢按攻速来；远程的普攻是放一发追着目标的弹道。
//   · 放技能：先看能不能放（冷却、法力、等级、沉默、眩晕），指向技能够不着会先走过去；
//     然后播动作，播到动作时间表里“出手”的那一刻调技能的 fire，需要引导的继续站着每帧调 tick。
//   · 被冲刺、击退、眩晕打断的处理；阵亡和复活。
// 英雄同一时刻只处在一种状态里：idle 站着、move 走、attack 普攻、cast 施法的动作、channel 引导、lock 技能自己接管、dash 冲刺、stun 眩晕或被击飞、dead。
//
// 位置以这里的 pos 为准，每帧写回规则那边的单位（ent.x、ent.z）。扣血、死亡、金钱都归规则（sim.ts）管。

import * as THREE from "three";
import type { Hero } from "../hero/hero";
import type { Nav } from "./nav";
import type { Fx, Trail } from "./fx";
import { SPR, type Decal } from "./fxlib";
import type { Ent, Sim } from "./sim";
import type { Api, Cast, HeroKit, SkillDef, SkillKey } from "./skills";
import { addWake } from "../slice/water";
import { recallFx, type RecallFx } from "./recallfx";
import { sample } from "../layout";

/** 动作的时间表（public/assets/hero/<id>.json）：每段动作第几秒出手、第几秒可以接下一个动作。时间按动作原速算，speed 是播放倍率
 *
 *  第九轮（手感）：出手前那一段不再按原速播。命令到生效的时间照 LoL、王者荣耀的惯例定：
 *    · 普攻的前摇是攻击间隔的 preK（默认 20%）；技能是 pre 秒（不写就按普通技能 0.25 秒、大招 0.35 秒，原来本来就更快的不动）。
 *    · 做法是“出手前快放、出手后恢复原速”：从 from 秒（不写就自动算：最多快放 2.6 倍，再快就从片段中间起播，前面的蓄势跳过，靠 0.06 秒的过渡接上，武器不会瞬移）
 *      播到出手点，正好用 pre 秒；出手以后按 speed 播完收招。特效挂在“出手”这个事件上（fire、strike），所以和画面对得上。
 *    · 伤害、冷却、攻击间隔都没动：普攻的出手间隔还是 1/攻速，每秒伤害和原来一样。 */
export interface AnimMeta {
  runSpeed: number;                                           // 跑步动作按原速播时脚下对应的移速，用来让步子和移动对上
  attacks: { clip: string; swing: number; hit: number; end: number; hands: string[]; speed?: number; from?: number }[];
  skills: Record<string, { clip: string; release: number; end: number; speed?: number; pre?: number; from?: number }>;
  preK?: number;                                              // 普攻前摇占攻击间隔的几成（默认 0.2）
  death: { clip: string };
  /** 非人形角色没有“右手”这根骨骼：在这里写技能从哪根骨骼出手（hand）、胸口算哪根（chest），名字照模型里的写；up 是再往上抬多少米 */
  points?: { hand?: string; chest?: string; up?: number; head?: string };      // head：头是哪根骨骼（界面上的 3D 头像对着它拍）
}
/** 把读进来的时间表补齐。岚的那份是阶段 3 写的，钩引和潮隐是单独两项，这里折成 skills 里的 q 和 w */
export function normMeta(raw: any): AnimMeta {
  const skills: AnimMeta["skills"] = { ...(raw?.skills ?? {}) };
  if (raw?.hook && !skills.q) skills.q = { clip: raw.hook.clip, release: raw.hook.release, end: raw.hook.end, speed: raw.hook.speed, pre: raw.hook.pre, from: raw.hook.from };
  if (raw?.veil && !skills.w) skills.w = { clip: raw.veil.clip, release: raw.veil.start, end: raw.veil.end, speed: raw.veil.speed, pre: raw.veil.pre, from: raw.veil.from };
  return { runSpeed: raw?.runSpeed ?? 8, attacks: raw?.attacks?.length ? raw.attacks : [{ clip: "idle", swing: 0.15, hit: 0.3, end: 0.7, hands: ["R"] }], skills, death: raw?.death ?? { clip: "death" }, points: raw?.points, preK: raw?.preK };
}
/** 出手前快放：片段从 from 播到出手点 at，要正好用 pre 秒。返回 [起播的位置, 出手前的播放倍率]。最多快放 2.6 倍，再快就把起播点往后挪（不越过 keep，keep 是挥砍真正开始的那一刻） */
export function preRoll(at: number, pre: number, keep: number, from?: number): [number, number] {
  const f = from ?? Math.min(Math.max(0, keep), Math.max(0, at - pre * 2.6));
  return [f, Math.max(0.05, at - f) / Math.max(0.03, pre)];
}

export type ActorState = "idle" | "move" | "attack" | "cast" | "channel" | "lock" | "dash" | "stun" | "dead";
export interface Actor {
  ent: Ent; kit: HeroKit; hero: Hero; meta: AnimMeta; pos: THREE.Vector3; data: Record<string, any>;
  yaw: () => number; state: () => ActorState;
  moveTo: (x: number, z: number) => void; attack: (e: Ent | null) => void; stop: () => void;
  /** 放技能。aim 是瞄的位置（不给就朝面对的方向）；unit 是点中的单位。返回放没放成（包括“先走过去再放”、正在做别的动作时排上队） */
  cast: (key: SkillKey, aim?: { x: number; z: number }, unit?: Ent | null) => boolean;
  skill: (key: SkillKey) => SkillDef | undefined; canCast: (key: SkillKey) => boolean;
  /** 冷却、法力、等级都够，只是手上的动作还没做完（排队用）：界面按这个决定按下技能键要不要出指示 */
  canQueue: (key: SkillKey) => boolean;
  /** 手上的动作现在不能被新命令打断（施法前摇、冲刺、技能接管、眩晕、阵亡）。出手以后的收招不算：新命令会直接打断它 */
  busy: () => boolean;
  /** 摇杆：朝这个方向一直走（不寻路，贴墙滑着走）；(0,0) 是松手 */
  steer: (vx: number, vz: number) => void;
  cdLeft: (key: SkillKey) => number; cdMax: (key: SkillKey) => number; setCd: (key: SkillKey, sec: number) => void;
  face: (x: number, z: number, snap?: boolean) => void;
  anim: (clip: string, o?: { speed?: number; loop?: boolean; fade?: number }) => void;      // 技能自己播一段动作
  lock: (sec: number) => void;                                // 接下来这么多秒由技能接管，不接受命令；lock(0) 提前放开
  finish: () => void;                                         // 技能的动作不用播完了，现在就可以接别的
  dashTo: (x: number, z: number, sec: number, done?: () => void) => void; teleport: (x: number, z: number) => void; shove: (vx: number, vz: number, sec: number) => void;
  /** 软的拖拽（漩涡、水流）：只是叠一个速度，不打断正在做的事，人还能往外走 */
  drift: (vx: number, vz: number, sec: number) => void;
  hand: (out: THREE.Vector3, side?: "Left" | "Right") => THREE.Vector3; chest: (out: THREE.Vector3) => THREE.Vector3;
  inReach: (d: Ent) => boolean;
  /** 回城：原地站 5 秒，回到自己的出生点。期间挨打、下任何命令都会打断。返回开没开始 */
  recall: () => boolean; recalling: () => number;                // recalling：还剩几秒（没在回城是 0）
  target: () => Ent | null;                                     // 现在盯着打的是谁
  update: (dt: number, camDist: number) => void;
}

export function createActor(o: { ent: Ent; kit: HeroKit; hero: Hero; meta: AnimMeta; sim: Sim; api: Api; nav: Nav; fx0: Fx; height: (x: number, z: number) => number; waterY: number; yaw?: number }): Actor {
  const { ent: me, kit, hero, meta, sim, api, nav } = o, h = me.h!;
  const pos = new THREE.Vector3(me.x, o.height(me.x, me.z), me.z), tmp = new THREE.Vector3(), bA = new THREE.Vector3(), bB = new THREE.Vector3();
  let st: ActorState = "idle", t = 0, yaw = o.yaw ?? 0, yawT = yaw, path: [number, number][] = [], target: Ent | null = null, lockLeft = 0;
  let atk = meta.attacks[0], atkIdx = 0, atkK1 = 1, atkK2 = 1, atkCt = 0, hitDone = false, nextAtk = 0, atkPrev = 0; const swings = new Map<string, Trail>();
  let cur: Cast | null = null, curMeta = { clip: "idle", release: 0.25, end: 0.6, speed: 1, k1: 1 }, castCt = 0, fired = false, stopped = false;
  // 排队（第九轮）：手上的动作做到一半（施法前摇、冲刺、被技能接管、眩晕）时按下的命令先记着，一能动就执行。只记最后一个，和 LoL 一样后按的顶掉先按的。
  // 技能排队 1.5 秒内有效（按下以后人被晕了很久，晕醒了再放出去就不对了）；移动和普攻一直有效
  let queued: { k: "move" | "attack" | "cast"; x: number; z: number; e: Ent | null; key: SkillKey; aim?: { x: number; z: number }; unit?: Ent | null; at: number } | null = null;
  let steerD: [number, number] | null = null;                 // 摇杆推着的方向（单位向量）；null 是没在用摇杆走
  let want: { key: SkillKey; x: number; z: number; unit: Ent | null } | null = null;
  let dash: { fx: number; fz: number; tx: number; tz: number; t: number; dur: number; done?: () => void; back: ActorState } | null = null, kb = { vx: 0, vz: 0, left: 0 }, dr = { vx: 0, vz: 0, left: 0 };
  let hideK = 0, wade = 0, foot = 1;
  const RECALL = 5; let rc = 0, rcHurt = 0, rcFx: RecallFx | null = null, rcT = 0;      // 回城的特效在 recallfx.ts（第九轮）
  const stopRecall = () => { if (rc > 0) { rc = 0; rcFx?.cancel(); rcFx = null; } };
  const cds: Record<string, number> = {};
  const skill = (key: SkillKey) => { const d = kit.skills.find(s => s.key === key); return d?.alt?.({ me, a: actor, api }) ?? d; };      // 第四阶段 iti-kit：多段施放（SkillDef.alt，伊缇的 Q、W）返回这一下实际放的那一段；没有 alt 的技能和原来一样
  const cdMax = (key: SkillKey) => (skill(key)?.cd ?? 0) * (1 - h.stat.cdr);
  const swing = (hands: string[], on: boolean, big = false) => { for (const hd of hands) { let tr = swings.get(hd); if (on) { if (!tr) { tr = o.fx0.trail(big); swings.set(hd, tr); } if (hero.blade(hd, bA, bB)) tr.push(bA, bB); } else if (tr) { tr.end(); swings.delete(hd); } } };
  const loopAnim = (name: string, speed = 1) => { const n = hero.clips.has(name) ? name : "idle_pose"; if (hero.current === n) hero.setSpeed(speed); else hero.play(n, { fade: 0.1, speed }); };
  /** 播一段一次性的动作；from 是从片段的第几秒起播（出手前快放时跳过一段蓄势） */
  const playOnce = (name: string, speed: number, fade = 0.08, from = 0) => { const c = hero.clips.get(name); if (!c) return; hero.play(name, { loop: false, fade, speed }); if (from > 0) { const act = hero.mixer.existingAction(c); if (act) act.time = Math.min(from, c.duration - 0.01); } };
  const toIdle = () => { st = "idle"; t = 0; loopAnim("idle"); };
  const face = (x: number, z: number, snap = false) => { if (Math.hypot(x - pos.x, z - pos.z) > 0.05) { yawT = Math.atan2(x - pos.x, z - pos.z); if (snap) yaw = yawT; } };
  const reach = () => (kit.ranged ? h.stat.range : h.stat.range - 0.7);
  const inReach = (d: Ent) => Math.hypot(pos.x - d.x, pos.z - d.z) - d.r <= reach();
  const ok = (e: Ent | null): e is Ent => !!e && e.alive && !e.untarget && sim.sees(me.team, e) && !(e.invis && e.team !== me.team);
  const free = () => st === "idle" || st === "move" || st === "attack";
  /** 新命令进不来（只能排队）的时候：施法前摇、冲刺、技能接管、眩晕 */
  const locked = () => st === "stun" || st === "lock" || st === "dash" || (st === "cast" && !fired);
  /** 一个新的移动、普攻命令要接手之前：引导中的技能断掉；出手以后的收招直接打断；普攻还没出手就被打断的话这一下不算，攻击计时退回去（LoL 的“取消前摇”） */
  function release() { if (st === "channel") { endCast(true); toIdle(); } else if (st === "cast") { endCast(false); toIdle(); } else if (st === "attack") { if (!hitDone) nextAtk = atkPrev; swing(["L", "R"], false); toIdle(); } }
  const hand = (out: THREE.Vector3, side: "Left" | "Right" = "Right") => { const b = hero.bone(meta.points?.hand ?? side + "Hand"); if (b) { b.getWorldPosition(out); if (meta.points?.hand) out.y += meta.points.up ?? 0; } else out.copy(pos).setY(pos.y + kit.height * 0.55); return out; };
  const chest = (out: THREE.Vector3) => { const b = meta.points?.chest ? hero.bone(meta.points.chest) : undefined; return b ? b.getWorldPosition(out) : out.set(pos.x, pos.y + kit.height * 0.55, pos.z); };

  function approach(x: number, z: number, keep: number) {       // 走到离 (x,z) 还有 keep 米的地方
    const dx = pos.x - x, dz = pos.z - z, l = Math.hypot(dx, dz) || 1; let gx = x + (dx / l) * keep, gz = z + (dz / l) * keep;
    // 第九轮：站位点落在墙里时，原来取离它最近的能走的格子——那一格可能还是够不着目标（目标在营地的墙后面），人走到那儿、够不着、再算还是那儿，原地“走”十几秒。
    // 现在直接朝目标本身寻路：路上一进射程就停下出手（见 update 的 move）
    if (!nav.walkable(gx, gz)) [gx, gz] = nav.walkable(x, z) ? [x, z] : nav.nearest(x, z);
    path = nav.path(pos.x, pos.z, gx, gz); st = path.length ? "move" : "idle"; t = 0;
  }
  function startAttack() {
    if (!ok(target)) { target = null; toIdle(); return; }
    st = "attack"; t = 0; hitDone = false; path = []; steerD = null; atk = meta.attacks[atkIdx++ % meta.attacks.length];
    const period = 1 / Math.max(0.2, h.stat.as), sp0 = Math.max(atk.speed ?? 1, atk.end / period); atkPrev = nextAtk; nextAtk = sim.time + period;      // 攻速快到动作来不及播完，就把动作加速
    // 前摇：攻击间隔的两成（最短 0.1 秒；原来本来就更快的不放慢）。出手以后按原速收招，收招要在下一次出手之前播完
    const pre = Math.min(atk.hit / sp0, Math.max(0.1, period * (meta.preK ?? 0.2))), [from, k1] = preRoll(atk.hit, pre, atk.swing - 0.06, atk.from);
    atkK1 = k1; atkK2 = Math.max(sp0, (atk.end - atk.hit) / Math.max(0.05, period - pre)); atkCt = from;
    face(target.x, target.z, true); playOnce(atk.clip, atkK1, 0.06, from);
  }
  function strike() {
    if (!ok(target)) return; const tg = target, onB = tg.kind === "tower" || tg.kind === "core", base = Math.round((h.stat.ad + (onB ? h.stat.ap * 0.8 : 0)) * (0.94 + Math.random() * 0.12));      // 打建筑时法强也算八成：法师和辅助的技能打不了塔，不然他们一个人守的那条线推不动
    const land = (e: Ent) => { if (!e.alive) return; const dmg = kit.attack?.({ me, a: actor, api, fx: api.fx, target: e, dmg: base }) ?? base; const was = e.alive; sim.damage(e, dmg, me, { type: "phys", big: dmg > base * 1.4 }); if (was && !e.alive) kit.onKill?.({ me, a: actor, api, fx: api.fx, victim: e }); };
    if (kit.ranged) { const from = (hero.blade("R", bA, tmp) ? tmp : hand(tmp)).clone();      /* 远程普攻从武器的尖上出（弩口、杖头）；没有武器的（四足）从出手点出 */ api.shoot({ me, from, target: tg, speed: kit.ranged.speed, hit: land, vis: kit.ranged.shot({ me, a: actor, api, fx: api.fx, from, target: tg }) }); }
    else land(tg);
  }
  function endCast(interrupted: boolean) { const c = cur; cur = null; fired = false; if (c) c.def.end?.(c, interrupted); }
  function interrupt() { if (cur) endCast(true); if (st === "lock") lockLeft = 0; swing(["L", "R"], false); want = null; steerD = null; }
  function canCast(key: SkillKey) {
    const d = skill(key); if (!d || d.cast === "passive" || !me.alive || me.stun > 0 || me.silence > 0 || sim.over) return false;
    if ((cds[key] ?? 0) > 0 || h.mana < (d.mana ?? 0) || h.level < (d.minLevel ?? 1)) return false;
    if (!d.instant && (locked() || st === "channel" || st === "dead")) return false;      // 出手以后的收招不挡：新技能直接打断它
    return d.ready ? d.ready({ me, a: actor, api }) : true;
  }
  function canQueue(key: SkillKey) {
    const d = skill(key); if (!d || d.cast === "passive" || !me.alive || me.silence > 0 || sim.over) return false;
    return (cds[key] ?? 0) <= 0.3 && h.mana >= (d.mana ?? 0) && h.level >= (d.minLevel ?? 1);
  }
  function begin(d: SkillDef, x: number, z: number, unit: Ent | null) {
    let dx = x - pos.x, dz = z - pos.z; const l = Math.hypot(dx, dz); if (l < 0.05) { dx = Math.sin(yaw); dz = Math.cos(yaw); } else { dx /= l; dz /= l; }
    const c: Cast = { me, a: actor, api, fx: api.fx, def: d, x, z, dx, dz, unit, t: 0, lv: h.level, ad: h.stat.ad, ap: h.stat.ap, data: {}, stop() { stopped = true; } };
    const pay = () => { h.mana -= d.mana ?? 0; cds[d.key] = cdMax(d.key); };
    sim.events.push({ t: "cast", e: me, key: d.key });      // 音效用（阶段 8）
    if (d.instant) { pay(); d.start?.(c); d.fire?.(c); if (d.end) d.end(c, false); return; }
    const m = meta.skills[d.clip ?? d.key.toLowerCase()], sp = m?.speed ?? 1, rel = m?.release ?? 0.25;
    // 施法前摇：pre 秒（不写就普通技能 0.25、大招 0.35；原来就更快的不放慢）。出手前快放，出手后按原速
    const pre = Math.min(rel / sp, m?.pre ?? (d.key === "R" ? 0.35 : 0.25)), [from, k1] = preRoll(rel, pre, rel - 0.15, m?.from);
    curMeta = { clip: m?.clip ?? "", release: rel, end: m?.end ?? 0.6, speed: sp, k1 }; castCt = from;
    st = "cast"; t = 0; fired = false; stopped = false; cur = c; path = []; steerD = null; target = d.cast === "unit" && unit && unit.team !== me.team ? unit : target; swing(["L", "R"], false);
    if (d.cast !== "self") face(x, z, true); if (curMeta.clip) playOnce(curMeta.clip, k1, 0.06, from);
    c.data.pay = pay; d.start?.(c);
  }
  function cast(key: SkillKey, aim?: { x: number; z: number }, unit: Ent | null = null): boolean {
    const d = skill(key); if (!d) return false;
    if (!canCast(key)) { if ((locked() || st === "channel") && canQueue(key)) { queued = { k: "cast", x: 0, z: 0, e: null, key, aim: aim ? { x: aim.x, z: aim.z } : undefined, unit, at: sim.time }; return true; } return false; }      // 手上的动作没做完：排队
    if (!d.instant && st === "cast") { endCast(false); toIdle(); }      // 上一个技能出手以后的收招：直接打断
    let x = aim ? aim.x : pos.x + Math.sin(yaw) * 3, z = aim ? aim.z : pos.z + Math.cos(yaw) * 3;
    if (d.cast === "unit") {
      if (!unit || !unit.alive || unit.untarget || (d.target === "ally" ? unit.team !== me.team : d.target === "any" ? false : unit.team === me.team)) return false;
      x = unit.x; z = unit.z; const dist = Math.hypot(x - pos.x, z - pos.z) - unit.r;
      if (d.range && dist > d.range) { if (!free()) return false; want = { key, x, z, unit }; target = null; approach(x, z, d.range + unit.r - 0.3); return true; }      // 够不着：先走过去
    } else if (d.cast === "point" && d.range) { const dx = x - pos.x, dz = z - pos.z, l = Math.hypot(dx, dz); if (l > d.range) { x = pos.x + (dx / l) * d.range; z = pos.z + (dz / l) * d.range; } }      // 点得太远：放在最远能放的地方
    want = null; begin(d, x, z, unit); return true;
  }
  function die() { interrupt(); queued = null; dash = null; kb.left = 0; st = "dead"; t = 0; path = []; target = null; if (hero.clips.has(meta.death.clip)) hero.play(meta.death.clip, { loop: false, fade: 0.1 }); }

  const actor: Actor = {
    ent: me, kit, hero, meta, pos, data: {}, yaw: () => yaw, state: () => st,
    // 第九轮：命令在动作做到一半时不再被吞掉——施法前摇、冲刺、技能接管、眩晕时先排队（见 queued），出手以后的收招和普攻直接被打断
    moveTo(x, z) { if (st === "dead") return; target = null; want = null; steerD = null;
      if (locked()) { queued = { k: "move", x, z, e: null, key: "Q", at: sim.time }; return; }
      queued = null; release(); path = nav.path(pos.x, pos.z, x, z); if (path.length) { st = "move"; t = 0; } },
    attack(e) { if (st === "dead" || !ok(e) || e.team === me.team) return; want = null; steerD = null;
      if (locked()) { queued = { k: "attack", x: 0, z: 0, e, key: "Q", at: sim.time }; return; }
      queued = null; if (st === "attack" && e === target) return;      // 已经在打它了：接着打（不重新起手）
      release(); target = e; if (st === "idle" || st === "move") { if (inReach(e)) { if (sim.time >= nextAtk) startAttack(); else { path = []; toIdle(); } } else approach(e.x, e.z, e.r + reach() - 0.3); } },
    steer(vx, vz) { const l = Math.hypot(vx, vz);
      if (l < 1e-3) { if (steerD) { steerD = null; if (st === "move" && !path.length) toIdle(); } return; }
      if (st === "dead" || locked()) return;      // 摇杆每帧都在推：动作做完下一帧自然接上，不用排队
      if (!steerD || st !== "move") { target = null; want = null; queued = null; release(); st = "move"; t = 0; }
      steerD = [vx / l, vz / l]; path = []; },
    busy: () => locked() || st === "channel" || st === "dead", canQueue,
    recall() { if (!me.alive || rc > 0 || (st !== "idle" && st !== "move" && st !== "attack") || me.stun > 0 || sim.over) return false; path = []; target = null; want = null; swing(["L", "R"], false); toIdle();      /* 正在普攻也能回城：手上的这一下不打了 */ rc = RECALL; rcHurt = me.hurtAt; rcT = 0;
      rcFx = recallFx(api.fx, pos.x, pos.z, kit.color, (kit.look?.ring ?? 1) ** 0.5, () => me.team === 0 || me.seen); return true; },
    recalling: () => rc, target: () => target,
    stop() { stopRecall(); target = null; want = null; queued = null; steerD = null;      /* 不管正在做什么，“接下来要打谁”都清掉：不然两次普攻之间按了停，回过头还会接着打 */
      if (st === "move") { path = []; toIdle(); } else if (st === "attack" || st === "channel" || (st === "cast" && fired)) { release(); path = []; } },      // 普攻没出手就停：这一下不算；收招、引导直接断
    cast, skill, canCast, cdLeft: key => Math.max(0, cds[key] ?? 0), cdMax, setCd(key, sec) { cds[key] = sec; },
    face, anim(clip, a = {}) { if (hero.clips.has(clip)) hero.play(clip, { loop: a.loop ?? false, fade: a.fade ?? 0.08, speed: a.speed ?? 1 }); },
    lock(sec) { if (sec <= 0) { lockLeft = 0; if (st === "lock") { endCast(false); toIdle(); } return; } st = "lock"; lockLeft = sec; path = []; },
    finish() { if (st === "cast" || st === "channel" || st === "lock") { lockLeft = 0; endCast(false); toIdle(); } },
    dashTo(x, z, sec, done) { dash = { fx: pos.x, fz: pos.z, tx: x, tz: z, t: 0, dur: Math.max(0.01, sec), done, back: st === "lock" || st === "cast" || st === "channel" ? st : "idle" }; if (free()) st = "dash"; path = []; face(x, z, true); },
    teleport(x, z) { pos.x = x; pos.z = z; pos.y = o.height(x, z); me.x = x; me.z = z; path = []; hero.group.position.copy(pos); },
    drift(vx, vz, sec) { if (st !== "dead") dr = { vx, vz, left: sec }; },
    shove(vx, vz, sec) { if (st === "dead") return; interrupt(); dash = null; kb = { vx, vz, left: sec }; st = "stun"; t = 0; path = []; loopAnim("idle"); },
    hand, chest, inReach,
    update(dt, camDist) {
      for (const k in cds) if (cds[k] > 0) cds[k] -= dt;
      // 站进草丛：自己看是半透明的；出手就现形（只有玩家这一队的英雄做这个效果）
      if (me.team === 0) { const hid = st !== "dead" && sample(pos.x, pos.z).brush && (st === "idle" || st === "move"); hideK += ((hid ? 1 : 0) - hideK) * (1 - Math.exp(-dt * 8)); hero.setHide(hideK < 0.004 ? 0 : hideK); }
      if (rc > 0) {      // 回城：站着不动才算数；挨了打、做了别的事就断
        if (st !== "idle" || me.hurtAt !== rcHurt || !me.alive || target || want) stopRecall();
        else { rc -= dt; rcT += dt; rcFx?.tick(dt, 1 - rc / RECALL, pos.x, pos.y, pos.z);
          if (rc <= 0) { rc = 0; const f = sim.fountain[me.team as 0 | 1], ang = Math.random() * 6.283; rcFx?.leave(pos.x, pos.z);
            actor.teleport(f[0] + Math.sin(ang) * 1.6, f[1] + Math.cos(ang) * 1.6); yaw = yawT = me.team === 0 ? Math.PI * 0.75 : -Math.PI * 0.25; rcFx?.arrive(pos.x, pos.z); rcFx = null; } } }
      if (!me.alive && st !== "dead") die();
      if (st === "dead" && me.alive) { pos.set(me.x, o.height(me.x, me.z), me.z); yaw = yawT = me.team === 0 ? Math.PI * 0.75 : -Math.PI * 0.25; toIdle(); }
      if (st !== "dead" && me.stun > 0 && st !== "stun") { interrupt(); dash = null; st = "stun"; t = 0; path = []; loopAnim("idle", 0.4); }
      if (st === "stun" && me.stun <= 0 && kb.left <= 0) toIdle();
      if (target && !ok(target)) target = null;
      t += dt;
      if (st === "idle") {
        if (want) { const d = skill(want.key), u = want.unit; if (!d || (u && !u.alive)) want = null; else cast(want.key, { x: want.x, z: want.z }, u); }
        else if (target) { if (inReach(target)) { if (sim.time >= nextAtk) startAttack(); else face(target.x, target.z); } else approach(target.x, target.z, target.r + reach() - 0.3); }
      } else if (st === "move") {
        if (want && want.unit && Math.hypot(want.unit.x - pos.x, want.unit.z - pos.z) - want.unit.r <= (skill(want.key)?.range ?? 0)) { const w = want; want = null; path = []; st = "idle"; cast(w.key, { x: w.unit!.x, z: w.unit!.z }, w.unit); }
        else if (target && inReach(target)) { if (sim.time >= nextAtk) startAttack(); else { path = []; toIdle(); } }
        else if (me.root > 0) loopAnim("idle");
        else if (steerD) {      // 摇杆：直着朝推的方向走；前面是墙就往两边偏着试（最多偏 80 度），贴着墙滑过去
          const v = h.stat.ms * (me.slow > 0 ? 1 - me.slowK : 1), step = v * dt, [ux, uz] = steerD; let went = false;
          for (const a of [0, 0.3, -0.3, 0.6, -0.6, 0.95, -0.95, 1.4, -1.4]) { const c = Math.cos(a), s = Math.sin(a), dx = ux * c - uz * s, dz = ux * s + uz * c, k = step * (a ? Math.max(0.45, c) : 1), nx = pos.x + dx * k, nz = pos.z + dz * k;
            if (nav.walkable(nx, nz) && nav.walkable(pos.x + dx * (k + 0.25), pos.z + dz * (k + 0.25))) { pos.x = nx; pos.z = nz; yawT = Math.atan2(dx, dz); went = true; break; } }
          if (went) loopAnim("run", v / meta.runSpeed); else { yawT = Math.atan2(ux, uz); loopAnim("idle"); }
        }
        else {
          const v = h.stat.ms * (me.slow > 0 ? 1 - me.slowK : 1); let step = v * dt;
          while (step > 0 && path.length) { const [wx, wz] = path[0], dx = wx - pos.x, dz = wz - pos.z, d = Math.hypot(dx, dz);
            if (d <= step) { pos.x = wx; pos.z = wz; step -= d; path.shift(); } else { pos.x += (dx / d) * step; pos.z += (dz / d) * step; yawT = Math.atan2(dx, dz); step = 0; } }
          if (!path.length) { if (target) approach(target.x, target.z, target.r + reach() - 0.3); else if (want) st = "idle"; else toIdle(); } else loopAnim("run", v / meta.runSpeed);
        }
      } else if (st === "attack") {
        if (target) face(target.x, target.z);
        atkCt += dt * (atkCt < atk.hit ? atkK1 : atkK2); if (atkCt >= atk.hit && hero.current === atk.clip) hero.setSpeed(atkK2);      // 出手前快放、出手后按原速收招（动作的时间和这里的 atkCt 同步走）
        const ts = atkCt; if (!kit.ranged) swing(atk.hands, ts >= atk.swing && ts <= atk.hit + 0.16, !!actor.data.bigSwing);
        if (!hitDone && ts >= atk.hit) { hitDone = true; strike(); }
        if (ts >= atk.end) { if (path.length) { st = "move"; t = 0; } else if (ok(target) && inReach(target)) { if (sim.time >= nextAtk) startAttack(); else toIdle(); } else if (ok(target)) approach(target.x, target.z, target.r + reach() - 0.3); else { target = null; toIdle(); } }
      } else if (st === "cast" && cur) {
        castCt += dt * (castCt < curMeta.release ? curMeta.k1 : curMeta.speed); const ts = castCt, c = cur;
        if (!fired && ts >= curMeta.release) { fired = true; if (curMeta.clip && hero.current === curMeta.clip) hero.setSpeed(curMeta.speed); c.data.pay?.(); c.def.fire?.(c); if (cur === c && c.def.channel && st === "cast") { st = "channel"; t = 0; if (queued && queued.k !== "cast") queued = null; } }      // 引导技能：前摇里点的移动不算数（不然一出手就被自己点的那一下打断）
        if (st === "cast" && cur === c && ts >= curMeta.end) { endCast(false); if (path.length) { st = "move"; t = 0; } else toIdle(); }
      } else if (st === "channel" && cur) {
        const c = cur; c.t += dt; c.def.tick?.(c, dt);
        if (cur === c && (stopped || c.t >= (c.def.channel ?? 0))) { endCast(false); toIdle(); }
      } else if (st === "lock") {
        if (cur) { cur.t += dt; cur.def.tick?.(cur, dt); }
        lockLeft -= dt; if (lockLeft <= 0 && st === "lock") { endCast(false); toIdle(); }
      }
      // 排队的命令：一能动就执行（出手以后的收招也算能动，新命令直接打断收招）
      if (queued && st !== "dead") { const q = queued;
        if (q.k === "cast" && sim.time - q.at > 1.5) queued = null;
        else if (!locked() && st !== "channel") { queued = null; if (q.k === "move") actor.moveTo(q.x, q.z); else if (q.k === "attack") { if (q.e && ok(q.e)) actor.attack(q.e); } else cast(q.key, q.aim, q.unit ?? null); } }
      // 冲刺和击退：盖在上面的位移，不管当前在做什么
      if (dash) { const d = dash; d.t += dt; const k = Math.min(1, d.t / d.dur), e = k * k * (3 - 2 * k); pos.x = d.fx + (d.tx - d.fx) * e; pos.z = d.fz + (d.tz - d.fz) * e;
        if (k >= 1) { dash = null; if (st === "dash") { st = d.back; t = 0; if (st === "idle") loopAnim("idle"); } d.done?.(); } }
      if (dr.left > 0 && st !== "dead" && !dash) { const s = Math.min(dt, dr.left), nx = pos.x + dr.vx * s, nz = pos.z + dr.vz * s; if (nav.walkable(nx, nz)) { pos.x = nx; pos.z = nz; } dr.left -= dt; }
      if (kb.left > 0) { const s = Math.min(dt, kb.left), nx = pos.x + kb.vx * s, nz = pos.z + kb.vz * s; if (nav.walkable(nx, nz)) { pos.x = nx; pos.z = nz; } kb.left -= dt; }
      // 转身：走路时掉头 180 度约 0.12 秒（每秒 26 弧度），出手时更快（0.07 秒）。转身的同时已经在朝新方向走了（位移不等转身）。
      // 原来是每秒 13 / 22 弧度，掉头要 0.24 秒，看着像先刹住再拐（第九轮，LoL、王者荣耀的转身几乎是瞬间的）
      let dy = yawT - yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); const turn = (st === "cast" || st === "attack" || st === "lock" ? 45 : 26) * dt; yaw += Math.max(-turn, Math.min(turn, dy));
      const gy = o.height(pos.x, pos.z); pos.y += (gy - pos.y) * (dash ? 1 : 1 - Math.exp(-dt * 16));
      if (me.alive) { me.x = pos.x; me.z = pos.z; me.yaw = yaw; }
      hero.group.position.copy(pos); hero.group.rotation.y = yaw; hero.marks.position.y = Math.max(0, o.waterY - pos.y); hero.group.visible = me.team === 0 || me.seen || !me.alive;      /* 对面的英雄不在视野里就不画 */
      // 在水里走：落脚的地方水面起一圈涟漪（做在水面的着色里，见 slice/water.ts 的 addWake）
      if (pos.y < o.waterY - 0.08 && st !== "dead") { const mv = st === "move" || !!dash; wade += dt;
        if (wade > (mv ? 0.085 : 1.15)) { wade = 0; foot = -foot; addWake(pos.x + Math.cos(yaw) * 0.22 * foot, pos.z - Math.sin(yaw) * 0.22 * foot, mv ? 0.72 : 0.5); } }
      if (st !== "attack" && swings.size && !actor.data.keepSwing) swing(["L", "R"], false);
      kit.passive?.({ me, a: actor, api, fx: api.fx }, dt);
      hero.setLife(me.hp / me.max, me.max, h.level, h.stat.mana > 0 ? h.mana / h.stat.mana : -1, !me.alive ? "" : me.stun > 0 ? "眩晕" : me.taunt > 0 ? "嘲讽" : me.root > 0 ? "禁锢" : me.silence > 0 ? "沉默" : me.slow > 0 ? "减速" : "", me.shield > 0 ? me.shield / me.max : 0);
      hero.update(dt, camDist);
    },
  };
  hero.tag?.(kit.name, () => me === sim.hero && !sim.reveal);      // 第九轮 ui2：头顶血条写名字、分自己 / 队友 / 对方（观战时 reveal 为真，谁都不算自己）
  loopAnim("idle");
  return actor;
}
