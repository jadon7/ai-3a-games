// 技能框架（阶段 5）：技能怎么定义，以及技能里用得到的那些现成的动作（造成伤害、上状态、放弹道、铺范围、位移……）。
//
// 一个英雄是一份 HeroKit（heroes/<id>.ts）：一级属性、普攻、被动加 Q W E R。每个技能是一份 SkillDef：
//   cast 说它怎么放：
//     passive  被动，不用放
//     self     按了就放（原地生效，或者朝面对的方向）
//     dir      非指向：朝鼠标的方向放出去（弹道、冲刺、扇形）
//     point    范围：放在鼠标点的那个位置（超出距离会先走过去）
//     unit     指向：点一个单位（超出距离会先走过去）
//   start → fire → tick → end 是它的四个时机：动作开始、出手的那一刻、引导期间的每一帧、结束。
//   这几个函数拿到一个 Cast：谁放的、朝哪、点的谁、当时的攻击力和法强；通过 c.api 和 c.fx 干活。
//
// 这个文件里的 Api 就是“现成的动作”。技能文件不直接改单位身上的数，也不自己遍历所有单位，都走 Api：
// 这样眩晕、减速、护盾这些规矩只有一处，新英雄的技能写出来行为是一致的。

import * as THREE from "three";
import type { Nav } from "./nav";
import type { DmgType, Ent, Mod, Sim, Stats } from "./sim";
import { SPR, type BurstOpts, type FxLib, type V3 } from "./fxlib";
import type { Fx } from "./fx";
import type { Actor } from "./actor";
import type { HeroLook } from "../hero/hero";
import { bindItems } from "./items_fx";

export type CastKind = "passive" | "self" | "dir" | "point" | "unit";
export type SkillKey = "P" | "Q" | "W" | "E" | "R";
export interface Cast {
  me: Ent; a: Actor; api: Api; fx: FxLib; def: SkillDef;
  x: number; z: number; dx: number; dz: number; unit: Ent | null;      // 瞄的位置、方向（单位向量）、点中的单位
  t: number; lv: number; ad: number; ap: number;                        // t：出手以后过了几秒；lv 英雄等级
  data: Record<string, any>;                                            // 技能自己存东西用（一次施放之内）
  stop: () => void;                                                     // 提前结束引导
}
export interface SkillDef {
  key: SkillKey; name: string; desc: string; icon: string;              // icon：图标的名字（public/assets/ui/skill/<icon>.webp；没有图时界面上显示技能名的第一个字）
  cast: CastKind; target?: "enemy" | "ally" | "any";
  range?: number; radius?: number; width?: number; angle?: number;      // 施法距离；落点的半径；直线的宽；扇形的半张角（弧度）。界面按这些画指示
  cd?: number; mana?: number; minLevel?: number;                        // 大招一般 minLevel: 6
  clip?: string;                                                        // 用动作时间表（<id>.json 的 skills）里的哪一项，不写就用按键的小写
  channel?: number;                                                     // 出手以后要原地引导几秒（期间每帧调 tick）
  instant?: boolean;                                                    // 不播动作、不打断正在做的事（开关类、瞬发）
  tapAim?: "move" | "back";                                            // 触屏上点一下（不拖）时朝哪放：不写就自动对准敌人；"move" 是朝摇杆推的方向（没推就朝面前），位移技能用；"back" 是朝摇杆的反方向（没推就自动对准敌人），往后退的技能用（塞伦 E：朝前开铳、人往摇杆那边退）
  start?: (c: Cast) => void; fire?: (c: Cast) => void; tick?: (c: Cast, dt: number) => void; end?: (c: Cast, interrupted: boolean) => void;
  ready?: (c: { me: Ent; a: Actor; api: Api }) => boolean;              // 额外的可用条件（比如周围得有敌人）
  /** 第四阶段 iti-kit 新增（伊缇 Q 的三段、W 的再按一次换位）：多段施放，这一下按键实际放的是哪一段。返回 null / undefined 就是放自己（第一段）。
   *  控制器的 a.skill(key) 返回的就是这一段：能不能放、冷却、法力、动作（clip）、瞄准方式、电脑和玩家输入都按这一段走；技能栏的按钮和说明还是第一段的。
   *  段与段之间的冷却由技能自己用 a.setCd 改（放完一段把冷却改成段间隔，最后一段或超时再改成整段冷却）。没有这个字段的技能一点不变 */
  alt?: (c: { me: Ent; a: Actor; api: Api }) => SkillDef | null | undefined;
  /** 第四阶段 iti-kit 新增：多段施放的“还能再按”窗口，技能栏照这个在按钮上画段数和剩余时间（hud.ts）。不在窗口里返回 null。
   *  now 是现在的对局时间（界面那边没有 api）。n：再按一下是第几段；of：一共几段；left：窗口还剩几秒；dur：窗口一共几秒；label：按钮上显示的字（不写就显示“n/of”） */
  recast?: (c: { me: Ent; a: Actor; now: number }) => { n: number; of: number; left: number; dur: number; label?: string } | null;
}
export interface HeroKit {
  id: string; name: string; title: string; role: string; side: 0 | 1;   // side：0 沉月会，1 烬誓庭（决定特效用哪套颜色，和这局在哪一队无关）
  color: number; color2: number;                                        // 这个英雄特效的主色和辅色
  height: number; look?: Partial<HeroLook>;
  base: Stats;
  ranged?: { speed: number; shot: (c: { me: Ent; a: Actor; api: Api; fx: FxLib; from: V3; target: Ent }) => ProjVis };      // 远程普攻：弹道的样子
  skills: SkillDef[];
  /** 每次普攻打中之前调一次：可以加特效，返回值是这一下的伤害（不返回就用原来的） */
  attack?: (c: { me: Ent; a: Actor; api: Api; fx: FxLib; target: Ent; dmg: number }) => number | void;
  onKill?: (c: { me: Ent; a: Actor; api: Api; fx: FxLib; victim: Ent }) => void;
  /** 每帧调一次：被动、常驻的特效 */
  passive?: (c: { me: Ent; a: Actor; api: Api; fx: FxLib }, dt: number) => void;
}

/** 弹道的样子：每帧告诉它飞到哪了；结束时告诉它是打中了还是飞完了 */
export interface ProjVis { move: (x: number, y: number, z: number, dx: number, dy: number, dz: number, dt: number) => void; done: (hit: boolean) => void; }
export interface Proj { x: number; y: number; z: number; dx: number; dz: number; t: number; gone: number; alive: boolean; hits: Set<number>; kill: () => void; }
export interface ProjSpec {
  me: Ent; from: V3; speed: number;
  dir?: { x: number; z: number }; range?: number;                       // 直线飞：方向和最远距离
  target?: Ent;                                                         // 追着一个单位飞（普攻、指向技能）
  to?: { x: number; z: number }; arc?: number;                          // 抛到一个点：arc 是最高处比起点高多少
  radius?: number; pierce?: boolean; walls?: boolean;                   // 碰撞半径；穿透；撞墙就停
  ally?: boolean;                                                       // 打的是自己人（治疗弹）
  hit?: (e: Ent, p: Proj) => void | false;                              // 碰到一个单位。返回 false 表示这个不算，继续飞
  end?: (p: Proj, hit: boolean) => void;                                // 飞完了、撞墙了、落地了
  vis?: ProjVis;
}
export interface Zone { x: number; z: number; r: number; t: number; dur: number; alive: boolean; kill: () => void; }
export interface ZoneSpec {
  me: Ent; x: number; z: number; r: number; dur: number; delay?: number; tick?: number;      // tick：每隔几秒结算一次（默认 0.5）
  ally?: boolean; follow?: Ent;
  each?: (e: Ent, z: Zone) => void;                                     // 每次结算，圈里的每个目标调一次
  every?: (z: Zone, list: Ent[]) => void;                               // 每次结算调一次
  frame?: (z: Zone, dt: number) => void;                                // 每帧调一次（让特效跟着走）
  end?: (z: Zone) => void;
}
export interface Api {
  sim: Sim; nav: Nav; fx: FxLib; fx0: Fx; time: () => number; height: (x: number, z: number) => number; ground: (x: number, z: number) => number;
  stat: (e: Ent) => Stats;
  // 伤害、治疗、护盾
  hit: (me: Ent, target: Ent, amount: number, type?: DmgType, big?: boolean) => number;      // 技能伤害
  heal: (me: Ent, target: Ent, amount: number) => void;
  shield: (target: Ent, amount: number, sec: number) => void;
  /** 第九轮 polish-lib：和 shield 一样上护盾，同时声明“这个护盾的样子我自己画”——通用的护盾泡（view.ts）这段时间不画，不和技能自己的罩子叠在一起 */
  shieldOwn: (target: Ent, amount: number, sec: number) => void;
  // 状态
  stun: (e: Ent, sec: number) => void; root: (e: Ent, sec: number) => void; silence: (e: Ent, sec: number) => void;
  slow: (e: Ent, k: number, sec: number) => void;                       // k：减掉几成移速（0.4 就是只剩六成）
  taunt: (e: Ent, to: Ent, sec: number) => void;
  expose: (e: Ent, k: number, sec: number) => void;                     // 易伤：接下来 sec 秒受到的伤害多 k 成（0.15 就是多 15%）
  push: (e: Ent, dx: number, dz: number, dist: number, sec?: number) => void;      // 朝一个方向推开
  pull: (e: Ent, x: number, z: number, dist: number, sec?: number) => void;        // 朝一个点拉过去（最多拉 dist 米，不会越过那个点）。对英雄是硬控：打断并且这段时间动不了
  drag: (e: Ent, x: number, z: number, dist: number, sec?: number) => void;        // 软的拉：英雄只是被一股力往那边带，不打断、还能往外走（漩涡、水流用这个）；小兵和 pull 一样
  buff: (e: Ent, id: string, sec: number, m: Mod, end?: () => void) => void; hasBuff: (e: Ent, id: string) => boolean; unbuff: (e: Ent, id: string) => void;
  // 找目标（都只返回活着的、看得见的、能选中的）
  enemies: (me: Ent, x: number, z: number, r: number) => Ent[];
  allies: (me: Ent, x: number, z: number, r: number, self?: boolean) => Ent[];
  inLine: (me: Ent, x: number, z: number, dx: number, dz: number, len: number, half: number) => Ent[];
  inCone: (me: Ent, x: number, z: number, dx: number, dz: number, r: number, halfAngle: number) => Ent[];
  canHit: (me: Ent, e: Ent) => boolean;
  // 弹道、范围、定时
  shoot: (s: ProjSpec) => Proj; zone: (s: ZoneSpec) => Zone;
  after: (sec: number, fn: () => void) => void;
  /** 接下来 sec 秒里每帧调一次 frame（k 从 0 走到 1），结束时调 done。用来让特效跟着东西走、做收回之类的小过程 */
  run: (sec: number, frame: (k: number, dt: number) => void, done?: () => void) => void;
  // 位移
  dash: (me: Ent, x: number, z: number, sec: number, done?: () => void) => void;      // 冲过去（穿过小兵，终点落在能站的地方）
  blink: (me: Ent, x: number, z: number) => void;
  walkable: (x: number, z: number) => boolean; nearest: (x: number, z: number) => [number, number];
  /** 从 (x,z) 朝一个方向最多走 dist 米，碰到墙就停，返回停下的位置 */
  reach: (x: number, z: number, dx: number, dz: number, dist: number) => [number, number];
  actor: (e: Ent) => Actor | undefined;
  /** 常用的弹道样子：一个小模型拖着一串粒子 */
  projVis: (kind: "bolt" | "orb" | "flask" | "shard", color: number, size?: number, trail?: Partial<BurstOpts> & { rate?: number }, spin?: number) => ProjVis;
  pos: (e: Ent, up?: number) => THREE.Vector3;                          // 单位的位置（up：离地多高），每次返回新的向量
  /** 第九轮 k-ugo 新加（乌戈的磷潮“照出”里面的敌人）：这一帧里 (x,z) 半径 r 以内的对面单位对 me 这一队现形（草丛里的也算，不破隐身）。
   *  规则那边每秒重算八次视野，技能在规则之后更新，所以要每帧调（放在 zone 的 frame 里）。只改看不看得见，不改迷雾的画面 */
  reveal: (me: Ent, x: number, z: number, r: number) => void;
}

const isBuilding = (e: Ent) => e.kind === "tower" || e.kind === "core";
/** 场上英雄的控制器（第九轮）：画面那边（view.ts）要拿英雄的模型做受击闪白，从这里查 */
export const ACTORS: { map: Map<number, Actor> | null } = { map: null };
/** 第九轮 polish-lib：自己画护盾样子的单位（api.shieldOwn）→ 画到哪个对局时间为止。view.ts 的通用护盾泡看到这里有就不画 */
export const OWN_SHIELD = new Map<number, number>();
/** 受击闪白：英雄被打中的那一下亮一下白（伤害越高越亮）。第九轮 polish-lib：给了伤害就按这一下占最大血量的几成算（普攻约 0.45、掉一成五的技能约 0.75、封顶 1），不给按原来的两档 */
export function flinch(e: Ent, big = false, dmg?: number) { if (e.kind !== "hero") return; ACTORS.map?.get(e.id)?.hero.hit?.(dmg !== undefined && e.max > 0 ? Math.min(1, 0.3 + 3.0 * dmg / e.max) : big ? 1 : 0.6); }

export function createSkills(o: { sim: Sim; nav: Nav; fx: FxLib; fx0: Fx; height: (x: number, z: number) => number; actors: Map<number, Actor> }): { api: Api; update: (dt: number) => void } {
  ACTORS.map = o.actors;
  const { sim, nav, fx } = o, projs: { s: ProjSpec; p: Proj; t0: { x: number; y: number; z: number }; dur: number }[] = [], zones: { s: ZoneSpec; z: Zone; acc: number; wait: number }[] = [], timers: { at: number; fn: () => void }[] = [], runs: { t: number; dur: number; frame: (k: number, dt: number) => void; done?: () => void }[] = [];
  const alive = (e: Ent) => e.alive && !e.untarget;
  const canHit = (me: Ent, e: Ent) => alive(e) && e.team !== me.team && (me.team === 0 ? e.seen : me.team === 1 ? e.seen1 || e.team === 2 : true) && !(isBuilding(e) && !e.open);      // 只打得到自己这一队看得见的（对方的电脑也一样）
  const enemies = (me: Ent, x: number, z: number, r: number) => sim.ents.filter(e => canHit(me, e) && Math.hypot(e.x - x, e.z - z) <= r + e.r);
  const allies = (me: Ent, x: number, z: number, r: number, self = true) => sim.ents.filter(e => e.alive && e.team === me.team && !isBuilding(e) && (self || e !== me) && Math.hypot(e.x - x, e.z - z) <= r + e.r);
  const force = (e: Ent, vx: number, vz: number, sec: number) => { if (isBuilding(e) || !e.alive || e.untarget) return; const a = o.actors.get(e.id); if (a) a.shove(vx, vz, sec); else { e.fvx = vx; e.fvz = vz; e.fly = sec; } };
  sim.shove = force;      // 规则那边要推开一个单位（野怪的重击）也走这里：英雄归它的控制器管
  const api: Api = {
    sim, nav, fx, fx0: o.fx0, time: () => sim.time, height: o.height, ground: fx.ground,
    stat: e => e.h?.stat ?? { hp: e.max, mana: 0, ad: e.ad, ap: 0, armor: e.armor, mr: e.mr, ms: 3.5, as: 1, range: e.range, cdr: 0, ls: 0, hpRegen: 0, manaRegen: 0 },
    hit: (me, target, amount, type = "magic", big = false) => { const d = sim.damage(target, amount, me, { type, skill: true, big }); if (d > 0 && (target.seen || target.team === 0)) flinch(target, big, d); return d; },
    heal: (_me, target, amount) => sim.heal(target, amount),
    shield: (target, amount, sec) => { target.shield = Math.max(target.shield, amount); target.shieldT = Math.max(target.shieldT, sec); },
    shieldOwn: (target, amount, sec) => { api.shield(target, amount, sec); OWN_SHIELD.set(target.id, Math.max(OWN_SHIELD.get(target.id) ?? 0, sim.time + sec)); },
    stun: (e, sec) => { if (!isBuilding(e) && !e.untarget) e.stun = Math.max(e.stun, sec); },      // 不可选中的（伊缇、岚的大招期间）不吃新的控制，照 LoL：之前存下目标、延时生效的技能也打断不了它
    root: (e, sec) => { if (!isBuilding(e) && !e.untarget) e.root = Math.max(e.root, sec); },
    silence: (e, sec) => { if (!e.untarget) e.silence = Math.max(e.silence, sec); },
    slow: (e, k, sec) => { if (isBuilding(e) || e.untarget) return; if (k >= e.slowK || e.slow <= 0) e.slowK = k; e.slow = Math.max(e.slow, sec); },
    taunt: (e, to, sec) => { if (isBuilding(e) || e.untarget) return; e.taunt = Math.max(e.taunt, sec); e.tauntBy = to; e.target = to; },
    expose: (e, k, sec) => { e.vuln = Math.max(e.vulnT > 0 ? e.vuln : 0, k); e.vulnT = Math.max(e.vulnT, sec); },
    push: (e, dx, dz, dist, sec = 0.22) => { const l = Math.hypot(dx, dz) || 1; force(e, (dx / l) * dist / sec, (dz / l) * dist / sec, sec); },
    drag: (e, x, z, dist, sec = 0.25) => { if (isBuilding(e) || !e.alive || e.untarget) return; const dx = x - e.x, dz = z - e.z, l = Math.hypot(dx, dz); if (l < 0.3) return; const d = Math.min(dist, l - 0.3), a = o.actors.get(e.id); if (a) a.drift((dx / l) * d / sec, (dz / l) * d / sec, sec); else force(e, (dx / l) * d / sec, (dz / l) * d / sec, sec); },
    pull: (e, x, z, dist, sec = 0.25) => { const dx = x - e.x, dz = z - e.z, l = Math.hypot(dx, dz); if (l < 0.3) return; const d = Math.min(dist, l - 0.3); force(e, (dx / l) * d / sec, (dz / l) * d / sec, sec); },
    buff: (e, id, sec, m, end) => { if (!e.h) return; e.h.mods.set(id, { m, left: sec, end }); sim.recalc(e); },
    hasBuff: (e, id) => !!e.h?.mods.has(id),
    unbuff: (e, id) => { const v = e.h?.mods.get(id); if (v) { e.h!.mods.delete(id); sim.recalc(e); v.end?.(); } },
    enemies, allies, canHit,
    inLine: (me, x, z, dx, dz, len, half) => sim.ents.filter(e => { if (!canHit(me, e)) return false; const vx = e.x - x, vz = e.z - z, al = vx * dx + vz * dz, pp = Math.abs(vx * dz - vz * dx); return al > -e.r && al < len + e.r && pp < half + e.r; }),
    inCone: (me, x, z, dx, dz, r, half) => sim.ents.filter(e => { if (!canHit(me, e)) return false; const vx = e.x - x, vz = e.z - z, d = Math.hypot(vx, vz); if (d > r + e.r) return false; if (d < 0.6) return true; return Math.acos(Math.max(-1, Math.min(1, (vx * dx + vz * dz) / d))) <= half + Math.atan2(e.r, d); }),
    shoot(s) {
      const p: Proj = { x: s.from.x, y: s.from.y, z: s.from.z, dx: s.dir?.x ?? 0, dz: s.dir?.z ?? 1, t: 0, gone: 0, alive: true, hits: new Set(), kill() { p.alive = false; } };
      const dur = s.to ? Math.max(0.12, Math.hypot(s.to.x - s.from.x, s.to.z - s.from.z) / s.speed) : 0;
      projs.push({ s, p, t0: { ...s.from }, dur }); return p;
    },
    zone(s) { const z: Zone = { x: s.x, z: s.z, r: s.r, t: 0, dur: s.dur, alive: true, kill() { z.alive = false; } }; zones.push({ s, z, acc: s.tick ?? 0.5, wait: s.delay ?? 0 }); return z; },
    after: (sec, fn) => { timers.push({ at: sim.time + sec, fn }); },
    run: (sec, frame, done) => { runs.push({ t: 0, dur: Math.max(1e-3, sec), frame, done }); frame(0, 0); },
    dash: (me, x, z, sec, done) => { const a = o.actors.get(me.id); if (!a) return; const [tx, tz] = nav.walkable(x, z) ? [x, z] : nav.nearest(x, z); a.dashTo(tx, tz, sec, done); },
    blink: (me, x, z) => { const a = o.actors.get(me.id); if (!a) return; const [tx, tz] = nav.walkable(x, z) ? [x, z] : nav.nearest(x, z); a.teleport(tx, tz); },
    walkable: (x, z) => nav.walkable(x, z), nearest: (x, z) => nav.nearest(x, z),
    reach: (x, z, dx, dz, dist) => { let bx = x, bz = z; for (let s = 0.5; s <= dist + 1e-3; s += 0.5) { const nx = x + dx * s, nz = z + dz * s; if (!nav.walkable(nx, nz)) break; bx = nx; bz = nz; } return [bx, bz]; },
    actor: e => o.actors.get(e.id),
    projVis: (kind, color, size = 1, trail, spin = 0) => {
      // 第九轮：除了模型和一串粒子，再拖一条带子（头宽尾尖、中间发白），头上一团很小的光。飞得快的东西看得出轨迹，不是一个小点在跳
      const h = fx.proj(kind, color, size), em = trail ? fx.emitter({ pos: { x: 0, y: -99, z: 0 }, rate: trail.rate ?? 40, sprite: 0, add: true, color, size: 0.25, life: 0.3, speed: 0.3, ...trail }) : null; const q = new THREE.Vector3();
      const rib = fx.trail({ color, width: 0.34 * size, life: 0.16 }); let first = true;
      return { move(x, y, z, dx, dy, dz, dt) { h.obj.position.set(x, y, z); if (spin) h.obj.rotation.x += spin * dt; else h.obj.lookAt(q.set(x + dx, y + dy, z + dz)); em?.at(x, y, z); rib.at(x, y, z);
          if (first) { first = false; fx.burst({ pos: { x, y, z }, n: 1, sprite: SPR.glint, add: true, color, size: 0.7 * size, grow: 1.4, life: 0.1, speed: 0 }); } },      // 出膛的那一下
        done() { h.kill(); em?.stop(); rib.stop(); } };
    },
    pos: (e, up = 0) => new THREE.Vector3(e.x, o.height(e.x, e.z) + up, e.z),
    reveal: (me, x, z, r) => { for (const e of sim.ents) { if (!e.alive || e.team === me.team || e.invis || isBuilding(e) || Math.hypot(e.x - x, e.z - z) > r + e.r) continue; if (me.team === 0) e.seen = true; else if (me.team === 1) e.seen1 = true; } },
  };

  bindItems(sim, api);      // 第九轮：装备的被动挂到规则上（伤害、死亡、每一步的挂钩），特效用这里的 api

  function update(dt: number) {
    for (let i = timers.length - 1; i >= 0; i--) if (sim.time >= timers[i].at) { const t = timers[i]; timers.splice(i, 1); t.fn(); }
    for (let i = runs.length - 1; i >= 0; i--) { const r = runs[i]; r.t += dt; const k = Math.min(1, r.t / r.dur); r.frame(k, dt); if (k >= 1) { runs.splice(runs.indexOf(r), 1); r.done?.(); } }
    for (let i = projs.length - 1; i >= 0; i--) {
      const { s, p, t0, dur } = projs[i]; let ended = false, hitSomething = false; p.t += dt;
      if (!p.alive) ended = true;
      else if (s.to) {                                          // 抛物线：按时间走，落地结束
        const k = Math.min(1, p.t / dur), nx = t0.x + (s.to.x - t0.x) * k, nz = t0.z + (s.to.z - t0.z) * k, gy = fx.ground(s.to.x, s.to.z), ny = t0.y + (gy - t0.y) * k + (s.arc ?? 2) * 4 * k * (1 - k);
        s.vis?.move(nx, ny, nz, nx - p.x, ny - p.y, nz - p.z, dt); p.x = nx; p.y = ny; p.z = nz; if (k >= 1) { ended = true; hitSomething = true; }
      } else if (s.target) {                                    // 追踪：一定打中，除非目标没了
        const tg = s.target, ty = o.height(tg.x, tg.z) + (tg.kind === "tower" ? 3 : tg.kind === "core" ? 4 : 1.2), dx = tg.x - p.x, dy = ty - p.y, dz = tg.z - p.z, d = Math.hypot(dx, dy, dz), step = s.speed * dt;
        if (!tg.alive) ended = true;
        else if (d <= step + 0.35) { s.vis?.move(tg.x, ty, tg.z, dx, dy, dz, dt); p.x = tg.x; p.y = ty; p.z = tg.z; s.hit?.(tg, p); ended = true; hitSomething = true; }
        else { p.x += (dx / d) * step; p.y += (dy / d) * step; p.z += (dz / d) * step; p.dx = dx / d; p.dz = dz / d; s.vis?.move(p.x, p.y, p.z, dx, dy, dz, dt); }
      } else {                                                  // 直线
        const step = s.speed * dt, nx = p.x + p.dx * step, nz = p.z + p.dz * step; p.gone += step;
        if (s.walls !== false && !nav.walkable(nx, nz) && fx.ground(nx, nz) > p.y - 0.4) ended = true;      // 撞上比它高的地方（墙、塔座）
        else {
          // 这一步扫过的线段都算数，不只看落点：弹道快的时候不会从目标身上跳过去。第一步从出手的人身上算起（弹道是从手、弩口出发的，贴身的目标在起点后面）
          const first = p.gone <= step + 1e-6 && Math.hypot(t0.x - s.me.x, t0.z - s.me.z) < 2.5, ox = first ? s.me.x : p.x, oz = first ? s.me.z : p.z, sx = nx - ox, sz = nz - oz, sl2 = sx * sx + sz * sz || 1e-9;
          p.x = nx; p.z = nz; s.vis?.move(p.x, p.y, p.z, p.dx, 0, p.dz, dt); const R = s.radius ?? 0.5, cand: [number, Ent][] = [];
          for (const e of sim.ents) { if (p.hits.has(e.id)) continue; if (s.ally ? !(e.alive && e.team === s.me.team && e !== s.me && !isBuilding(e)) : !canHit(s.me, e)) continue;
            const tt = Math.max(0, Math.min(1, ((e.x - ox) * sx + (e.z - oz) * sz) / sl2)); if (Math.hypot(e.x - (ox + sx * tt), e.z - (oz + sz * tt)) > R + e.r) continue; cand.push([tt, e]); }
          cand.sort((a, b) => a[0] - b[0]);                       // 先碰到的先算
          for (const [, e] of cand) { if (s.hit?.(e, p) === false) continue; p.hits.add(e.id); if (!s.pierce) { ended = true; hitSomething = true; break; } }
          if (p.gone >= (s.range ?? 10)) ended = true;
        }
      }
      if (ended || !p.alive) { p.alive = false; s.vis?.done(hitSomething); s.end?.(p, hitSomething); projs.splice(i, 1); }
    }
    for (let i = zones.length - 1; i >= 0; i--) {
      const { s, z } = zones[i], rec = zones[i]; if (rec.wait > 0) { rec.wait -= dt; continue; }
      if (s.follow) { z.x = s.follow.x; z.z = s.follow.z; if (!s.follow.alive) z.alive = false; }
      z.t += dt; rec.acc += dt; s.frame?.(z, dt); const step = s.tick ?? 0.5;
      if (z.alive && rec.acc >= step) { rec.acc -= step; const list = s.ally ? allies(s.me, z.x, z.z, z.r) : enemies(s.me, z.x, z.z, z.r); s.every?.(z, list); if (s.each) for (const e of list) s.each(e, z); }
      if (!z.alive || z.t >= z.dur) { z.alive = false; s.end?.(z); zones.splice(i, 1); }
    }
  }
  return { api, update };
}
