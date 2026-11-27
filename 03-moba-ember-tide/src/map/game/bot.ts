// 电脑对手（阶段 6）：控制一个英雄打完整局。它下的命令和玩家一样（走、打、放技能、回城、买装备），
// 只看得见自己这一队看得见的东西，数值上不作弊。我方的四个队友、对面的五个英雄用的都是这一份；网址加 ?auto=1 时玩家的英雄也交给它。
//
// 第九轮（5v5）：每个电脑有一个位置（heroes/index.ts 的 POS），按位置打——
//   · 上单、中单：守自己那条线（和原来的对线一样），离得远的架不去凑。
//   · 射手：走下路补兵；辅助跟着射手站在他侧后方，不补刀，谁打射手就先打谁，奶和盾先给射手。射手不在线上（回家、阵亡）时辅助才自己跟兵线。
//   · 打野：不走线，按营地刷野（先小营地，四级以后打增益怪；没有刷出来的就去最快刷新的那个营地门口等）；六级以后（困难五级）看哪条线的对面残了或者压过了河，
//     而且自己那条线的人在，就过去抓；Boss 的人手先叫打野。只有打野和没有打野的队伍里的人才打野怪，线上的人不去抢。
// 英雄怎么放技能（BOOK）和位置无关：岚打中单也是那一套连招，只是站的地方、干的事按位置来。
//
// 每隔零点几秒想一次（难度越高想得越勤），按下面的顺序找第一件该做的事：
//   1. 买装备（在出生点或者阵亡时）。
//   2. 保命：站在重击的预警圈里就走出去；被对面的塔盯上、或者塔下没有自己的小兵顶着就退出去；
//      血少了回家（没人追就原地回城，有人追就边跑边放保命技能）。
//   3. 打架：看得见的对面英雄里挑一个（血少的、脆的、近的），估一下这一架两边的本钱（人数、血量、等级、塔、小兵），
//      占优就上，按这个英雄的连招表放技能；明显吃亏就往自己塔下退。
//   4. 队伍的安排（抱团）：守家、帮正在打架的队友、打 Boss、对面死了人就一起推、后期抱团推一路。
//   5. 对线：跟着自己的兵线，先补快死的小兵，没有就打血最少的；小兵多了用技能清；塔下有自己的小兵顶着就拆塔。
//   6. 线上没事：打附近刷出来的野怪；要不就在自己的塔后面等兵。
//
// 三档难度差在：塔下要有几个自己的小兵顶着才敢拆（简单三个、普通两个、困难一个——在这套规则里推线快慢最要紧）、多久想一次、技能瞄得准不准、会不会预判走位、多大概率放技能、会不会卡最后一刀、多大优势才敢打、
// 会不会打野、会不会抱团、会不会攒够钱专门回家买装备、躲不躲预警圈。

import type { Actor } from "./actor";
import type { Nav } from "./nav";
import type { Api, SkillKey } from "./skills";
import { MOBS, RULES, type Camp, type Ent, type Sim } from "./sim";
import { BUILDS, atShop, autoBuy, buildFor, tripCost } from "./items";
import { POS_LANE, isPos, posOf, type Pos } from "./heroes";
import { itiUltEstimate } from "./heroes/iti";      // 第四阶段 iti-kit：伊缇的电脑估大招能不能收人头

export type Diff = "easy" | "normal" | "hard" | "show";      // show：观战（导播）专用的“表演”打法——敢打、不计较换血亏不亏，四分钟后两队都去中路抱团。为的是镜头里有团战和击杀，不追求赢
interface Tune { brawl?: boolean; cover: number; idle: number; think: number; aim: number; lead: number; skill: number; lastHit: number; engage: number; yield: number; flee: number; jungle: boolean; group: boolean; trip: boolean; dodge: number; }
export const DIFF: Record<Diff, Tune> = {
  easy: { cover: 3, idle: 0.3, think: 0.6, aim: 1.8, lead: 0, skill: 0.3, lastHit: 0.25, engage: 1.3, yield: 0.45, flee: 0.18, jungle: false, group: false, trip: false, dodge: 0.2 },
  normal: { cover: 2, idle: 0, think: 0.35, aim: 0.8, lead: 0.6, skill: 0.75, lastHit: 0.7, engage: 0.95, yield: 0.55, flee: 0.26, jungle: true, group: true, trip: true, dodge: 0.65 },
  show: { brawl: true, cover: 1, idle: 0, think: 0.2, aim: 0.3, lead: 1, skill: 1, lastHit: 0.9, engage: 0.7, yield: 0.22, flee: 0.07, jungle: false, group: true, trip: false, dodge: 0.6 },
  hard: { cover: 1, idle: 0, think: 0.2, aim: 0.25, lead: 1, skill: 1, lastHit: 0.95, engage: 0.88, yield: 0.62, flee: 0.3, jungle: true, group: true, trip: true, dodge: 0.95 },
};
export const DIFF_NAME: Record<Diff, string> = { easy: "简单", normal: "普通", hard: "困难", show: "表演" };

// ---- 每个英雄怎么用技能 ----
// 第九轮把施法前摇缩短了（见 actor.ts 的 AnimMeta），下面 delay（预判多久以后他在哪）跟着减掉了缩短的那一截
// 想事情的时候手头有的东西
interface Ctx {
  me: Ent; a: Actor; api: Api; tg: Ent | null; d: number;       // tg：这次要打的对面英雄；d：离它多远（减掉它的半径）
  foes: Ent[]; pals: Ent[]; mins: Ent[];                         // 附近看得见的对面英雄、附近的队友英雄、附近的对面小兵和野怪
  hp: number; mana: number; pressed: boolean;                    // 自己的血量和法力比例；最近两秒挨没挨打
  aim: (e: Ent, speed?: number, delay?: number) => [number, number];      // 瞄一个单位：带预判和手抖
  away: (dist: number) => [number, number];                      // 背着最近的对面英雄走 dist 米能到的地方
}
interface Cast_ { key: SkillKey; x?: number; z?: number; unit?: Ent | null; }
type Play = (c: Ctx) => Cast_ | null;
const isMinion = (e: Ent) => e.kind === "melee" || e.kind === "ranged";
const isBuilding = (e: Ent) => e.kind === "tower" || e.kind === "core";
const D = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
/** 一堆单位里，以哪一个为中心、半径 r 的圈能圈到最多：返回 [圈心, 圈到几个] */
function bestSpot(list: Ent[], r: number): [Ent | null, number] { let best: Ent | null = null, bn = 0; for (const p of list) { let n = 0; for (const q of list) if (D(p, q) <= r + q.r) n++; if (n > bn) { bn = n; best = p; } } return [best, bn]; }
/** 从 me 朝 to 画一条长 len、半宽 half 的带子，里面有几个 list 里的单位；first 是带子上最靠前的那个 */
function inBand(me: Ent, to: { x: number; z: number }, list: Ent[], len: number, half: number): { n: number; first: Ent | null } {
  const dx = to.x - me.x, dz = to.z - me.z, l = Math.hypot(dx, dz) || 1, ux = dx / l, uz = dz / l; let n = 0, first: Ent | null = null, fa = 1e9;
  for (const e of list) { const vx = e.x - me.x, vz = e.z - me.z, al = vx * ux + vz * uz, pp = Math.abs(vx * uz - vz * ux); if (al > 0 && al < len + e.r && pp < half + e.r) { n++; if (al < fa) { fa = al; first = e; } } }
  return { n, first };
}
// 几种常用的写法
/** 朝目标英雄放（非指向、范围）：离得够近才放。clear 是弹道会被第一个碰到的单位挡住的那种：路上先碰到别的就不放 */
const at = (key: SkillKey, reach: number, o: { speed?: number; delay?: number; clear?: number; min?: number; when?: (c: Ctx) => boolean } = {}): Play => c => {
  if (!c.tg || c.d > reach || c.d < (o.min ?? 0) || (o.when && !o.when(c))) return null; const [x, z] = c.aim(c.tg, o.speed, o.delay);
  if (o.clear !== undefined && inBand(c.me, { x, z }, c.api.enemies(c.me, c.me.x, c.me.z, reach + 2).filter(e => !isBuilding(e)), reach + 1, o.clear).first !== c.tg) return null;
  return { key, x, z }; };
/** 直接放的（不用瞄）：满足条件就放 */
const self = (key: SkillKey, when: (c: Ctx) => boolean): Play => c => (when(c) ? { key } : null);
/** 清兵：一条直线上至少 n 个小兵 */
const lineFarm = (key: SkillKey, len: number, half: number, n: number): Play => c => { if (c.mana < 0.45 || c.mins.length < n) return null; let best: Ent | null = null, bn = 0; for (const m of c.mins) { const k = inBand(c.me, m, c.mins, len, half).n; if (k > bn) { bn = k; best = m; } } return best && bn >= n ? { key, x: best.x, z: best.z } : null; };
/** 清兵：一个圈里至少 n 个小兵（圈心离自己不超过 range） */
const spotFarm = (key: SkillKey, range: number, r: number, n: number): Play => c => { if (c.mana < 0.45) return null; const near = c.mins.filter(m => D(m, c.me) <= range + r * 0.5), [p, k] = bestSpot(near, r); return p && k >= n ? { key, x: p.x, z: p.z } : null; };
const near = (c: Ctx, r: number) => c.foes.filter(e => D(e, c.me) - e.r <= r).length;
const lowPal = (c: Ctx, r: number, k: number) => [c.me, ...c.pals].filter(e => D(e, c.me) <= r && e.hp / e.max < k).sort((p, q) => p.hp / p.max - q.hp / q.max)[0] ?? null;

interface Book { lane: number; build: string[]; fight: Play[]; farm: Play[]; flee: Play[]; }
const BOOK: Record<string, Book> = {
  // 岚：钩过去、隐身补第一刀、周围有残血或者人多就开大
  lan: { lane: 0, build: BUILDS.lan,
    fight: [self("R", c => !!c.tg && c.d < 6.5 && (c.tg.hp / c.tg.max < 0.6 || near(c, 8) >= 2)), self("W", c => !!c.tg && c.d < 9 && c.d > 1.5), at("Q", 10.5, { speed: 85, clear: 0.8, min: 3.2 })],
    farm: [c => { const m = c.mins.filter(e => e.kind === "monster" && D(e, c.me) < 9.5).sort((p, q) => q.hp - p.hp)[0]; return m && c.mana > 0.5 ? { key: "Q", x: m.x, z: m.z } : null; }],      // 第九轮 balance：清野也钩血最多的那只（原来清野一个技能都不放，营地比卡兹少三成）。不用潮隐：隐身了野怪会丢目标、回去回满血
    flee: [self("W", c => near(c, 9) > 0)] },
  // 托尔格：贴上去横扫眩晕，身边有人就震钟拿盾，圈得到人就跳进去
  torg: { lane: 1, build: BUILDS.torg,
    fight: [at("R", 7.5, { delay: 0.22, when: c => c.tg!.hp / c.tg!.max < 0.8 || near(c, 9) >= 2 }), at("Q", 3.6), self("W", c => near(c, 5) > 0)],
    farm: [c => (c.mana > 0.5 && c.mins.filter(m => D(m, c.me) < 4.2).length >= 3 ? { key: "Q", x: c.mins[0].x, z: c.mins[0].z } : null), self("W", c => c.mana > 0.6 && c.mins.filter(m => D(m, c.me) < 5.5).length >= 4)],
    flee: [self("W", c => near(c, 6) > 0), at("Q", 3.6)] },
  // 摩珂：谁血少奶谁、谁挨打给谁套盾，有人贴上来就吹开，人多的时候开大
  moko: { lane: 2, build: BUILDS.moko,
    fight: [self("R", c => near(c, 8) > 0 && (c.pals.filter(p => D(p, c.me) < 7).length >= 1 || c.hp < 0.45)), c => { const p = lowPal(c, 8.5, 0.7); return p ? { key: "Q", unit: p } : null; }, c => { const p = [c.me, ...c.pals].filter(e => D(e, c.me) <= 8.5 && c.api.time() - e.hurtAt < 1.5 && e.hp / e.max < 0.85)[0]; return p ? { key: "W", unit: p } : null; }, at("E", 8, { speed: 26 })],
    farm: [c => { const p = lowPal(c, 8.5, 0.6); return p ? { key: "Q", unit: p } : null; }, lineFarm("E", 9, 1.5, 3)],
    flee: [at("E", 7, { speed: 26 }), c => ({ key: "W", unit: c.me }), c => (c.hp < 0.5 ? { key: "Q", unit: c.me } : null)] },
  // 葛隆：冲上去撞晕，砸地留余烬，身边有人就开闸嘲讽；被集火的时候举盾
  gorran: { lane: 0, build: BUILDS.gorran,
    fight: [self("R", c => near(c, 5.5) >= 1 && (near(c, 6) >= 2 || (!!c.tg && c.tg.hp / c.tg.max < 0.75))), at("Q", 7, { clear: 1.2, min: 2.2 }), at("E", 6.5, { delay: 0.05 }), self("W", c => c.pressed && c.hp < 0.6 && near(c, 5) > 0)],
    farm: [spotFarm("E", 5, 3.2, 3)], flee: [c => { const [x, z] = c.away(7.5); return near(c, 8) > 0 ? { key: "Q", x, z } : null; }] },
  // 薇萝：远远地穿一箭、扔火油，有人贴脸就滚开；目标残血或者人扎堆就站桩齐射
  vero: { lane: 1, build: BUILDS.vero,
    fight: [at("R", 10, { when: c => near(c, 4.5) === 0 && (c.tg!.hp / c.tg!.max < 0.65 || near(c, 11) >= 2) }), at("Q", 12, { speed: 40 }), at("E", 10.5, { delay: 0.25 }), c => { const [x, z] = c.away(5.5); return near(c, 3.8) > 0 ? { key: "W", x, z } : null; },
      // 第九轮 balance：翻滚完下一发必定暴击（两倍），照 LoL 薇恩的 Q 当输出用——对面在射程里、没人贴脸，就往侧面滚一步接普攻（原来只拿来逃跑，一局三次）
      c => { const t = c.tg; if (!t || c.mana < 0.4 || near(c, 3.8) > 0 || c.d > c.api.stat(c.me).range || (t.hp / t.max > 0.7 && !c.pressed)) return null; const dx = t.x - c.me.x, dz = t.z - c.me.z, l = Math.hypot(dx, dz) || 1, s = Math.random() < 0.5 ? 1 : -1, [x, z] = c.api.reach(c.me.x, c.me.z, (-dz / l) * s, (dx / l) * s, 3.5); return { key: "W", x, z }; }],
    farm: [lineFarm("Q", 13, 0.5, 3), spotFarm("E", 9, 3.2, 4)], flee: [c => { const [x, z] = c.away(5.5); return near(c, 9) > 0 ? { key: "W", x, z } : null; }, at("E", 6, { delay: 0.25 })] },
  // 奥森：烛焰消耗，先蜡封定住再接大招，有人冲脸就熄灯沉默
  osen: { lane: 2, build: BUILDS.osen,
    fight: [at("W", 9.5, { delay: 0.5 }), at("R", 11, { delay: 0.25, when: c => c.tg!.hp / c.tg!.max < 0.85 || near(c, 12) >= 2 }), at("Q", 10.5, { speed: 24, clear: 0.6 }), at("E", 9.5, { when: c => c.d < 7 })],
    farm: [c => { if (c.mana < 0.4) return null; const [p, k] = bestSpot(c.mins.filter(m => D(m, c.me) < 10.5), 2.6); return p && k >= 2 && inBand(c.me, p, c.mins, 11, 0.6).first === p ? { key: "Q", x: p.x, z: p.z } : null; }, spotFarm("W", 9, 2.8, 3)],
    flee: [at("W", 8, { delay: 0.5 }), at("E", 7)] },
  // 赫达（第九轮第三批，开团辅助）：跟着射手走（辅助的通用逻辑），对面一露头就找机会开——
  //   R 炉心坠：出手 0.72 秒 + 飞 0.6 秒，砸人堆（3 米内圈得到两个以上对面英雄，砸他们中间），或者砸已经被控住（眩晕、定身还剩 0.6 秒以上）、被队友追着打的残血；
  //   E 护火：队友（多半是射手）1.5 秒内挨过打、血不到六成就冲过去一起减伤；开团时冲到已经贴上对面的那个队友身边（顺手把贴身的推开）；
  //   W 铁镣：拴要跑的（背对着她、或者血不到一半——走远了被拽回来眩晕），和冲上来贴脸的（让他追不走也跑不掉）；
  //   Q 钳钩：只钩“值得钩”的——血不到七成，或者她身后 8 米内有自己人接应（把人钩进自己人堆里）；自己血太少不钩。
  //   逃跑：先拴最近的追兵（她越跑越远，链子绷断时追兵被拽住晕 1.2 秒），再朝离追兵更远的队友冲过去，没有队友就原地推开贴身的
  hedda: { lane: 2, build: BUILDS.hedda,
    fight: [c => { const pool = c.foes.filter(e => D(e, c.me) < 11.5), [p, n] = bestSpot(pool, 3), t = c.tg; if (p && n >= 2 && D(p, c.me) < 8.5) { const grp = pool.filter(e => D(e, p) <= 3 + e.r); return { key: "R", x: grp.reduce((s, e) => s + e.x, 0) / grp.length, z: grp.reduce((s, e) => s + e.z, 0) / grp.length }; }
        return t && c.d < 8 && (t.stun > 0.6 || (t.root > 0.6 && t.root < 1e6) || (t.hp / t.max < 0.4 && c.pals.some(q => D(q, t) < 5))) ? { key: "R", x: t.x, z: t.z } : null; },
      c => { const p = c.pals.filter(q => D(q, c.me) <= 7 && c.api.time() - q.hurtAt < 1.5 && q.hp / q.max < 0.6).sort((p, q) => p.hp / p.max - q.hp / q.max)[0], t = c.tg, lead = t && c.d > 4 ? c.pals.find(q => D(q, c.me) <= 7 && D(q, t) < 3.5) : undefined; return p || lead ? { key: "E", unit: p ?? lead } : null; },
      c => { const t = c.tg; if (!t || c.d > 5.8) return null; const away = Math.sin(t.yaw) * (t.x - c.me.x) + Math.cos(t.yaw) * (t.z - c.me.z) > 0.3 * D(t, c.me); return away || t.hp / t.max < 0.5 || (c.d < 3 && c.pressed) ? { key: "W", unit: t } : null; },
      at("Q", 9.5, { speed: 40, clear: 0.9, min: 3, when: c => c.hp > 0.35 && (c.tg!.hp / c.tg!.max < 0.7 || c.pals.some(p => D(p, c.me) < 8 && (p.x - c.me.x) * (c.tg!.x - c.me.x) + (p.z - c.me.z) * (c.tg!.z - c.me.z) < 0)) })],
    farm: [c => { const p = c.foes.length ? c.pals.filter(q => D(q, c.me) <= 7 && c.api.time() - q.hurtAt < 1.2 && q.hp / q.max < 0.45)[0] : undefined; return p ? { key: "E", unit: p } : null; }],      // 跟着射手时（support 里只认给队友的）：射手被打残了就冲过去
    flee: [c => { const f = c.foes.filter(e => D(e, c.me) - e.r < 5.8).sort((p, q) => D(p, c.me) - D(q, c.me))[0]; return f ? { key: "W", unit: f } : null; },
      c => { const f = c.foes.slice().sort((p, q) => D(p, c.me) - D(q, c.me))[0]; if (!f) return null; const p = c.pals.find(q => D(q, c.me) <= 7 && D(q, f) > D(c.me, f) + 2); return p ? { key: "E", unit: p } : D(f, c.me) - f.r < 2.5 ? { key: "E", unit: c.me } : null; }] },
  // 乌戈（第九轮 k-ugo）：冷光束远远地消耗，磷潮放在目标脚下；诱光拉到人、对面被晕住，或者落点能罩住两个以上，就往那儿放渊口（出手加预警一共 1.27 秒，预判 1.2 秒）；
  // 有人冲脸先诱光拉一下再走（魅惑 1.3 秒是硬控），边跑边在身后铺磷潮
  ugo: { lane: 0, build: BUILDS.ugo,
    fight: [at("R", 11, { delay: 1.2, when: c => { const t = c.tg!; return t.stun > 0 || t.root > 0 || c.api.actor(t)?.state() === "stun" || c.foes.filter(e => D(e, t) < 3.4).length >= 2; } }), at("W", 9.5, { speed: 18, clear: 0.9 }), at("Q", 11.5, { delay: 0.3 }), at("E", 9, { delay: 0.3 })],
    farm: [lineFarm("Q", 12, 0.55, 3), spotFarm("E", 9, 3.2, 3)],
    flee: [at("W", 8, { speed: 18, clear: 0.9, when: c => c.d < 6 }), at("E", 7, { delay: 0.2 })] },
  // 卡兹（第九轮 k-kaz）：对面三米外才扑（贴脸了扑不出距离），扑上去接吼、身边有人就旋爪；目标残血或者一对一（它身边十米内没有别的英雄）就开大锁住。
  // 清野：先扑营地里血最多的那只（打野怪伤害高、冷却返还一半），身边两只以上、或者血不满时贴着野怪旋爪回血。逃跑时不扑（会扑到人脸上），朝追来的吼一嗓子减速
  kaz: { lane: 0, build: BUILDS.kaz,
    fight: [at("R", 7, { when: c => c.tg!.hp / c.tg!.max < 0.6 || !c.foes.some(f => f !== c.tg && D(f, c.tg!) < 10) }), at("Q", 7.5, { min: 3 }), at("E", 5), self("W", c => near(c, 3.2) > 0)],
    farm: [c => { const m = c.mins.filter(e => e.kind === "monster" && D(e, c.me) - e.r < 7.5).sort((p, q) => q.hp - p.hp)[0]; return m ? { key: "Q", unit: m } : null; },
      self("W", c => c.mins.filter(m => D(m, c.me) - m.r < 3.2).length >= 2 || (c.hp < 0.8 && c.mins.some(m => m.kind === "monster" && D(m, c.me) - m.r < 3.2)))],
    flee: [c => { const f = c.foes.filter(e => D(e, c.me) - e.r < 5).sort((p, q) => D(p, c.me) - D(q, c.me))[0]; return f ? { key: "E", x: f.x, z: f.z } : null; }] },
  // 伊缇（第四阶段 iti-kit，中路刺客）：连招 E → Q → Q → Q → R。E 闪到身后起手（10 米），Q 三段跟上（窗口里就接着放，打中英雄下一段马上能放），
  // R 留给落点 11 米内圈得到两个以上英雄、或者估得到能收掉目标的时候；残血时 W 再按一次换回残影撤走（残影离对面比自己远才换），逃跑时 W 朝家的方向冲。
  // 清兵：一线三个以上用 Q 穿过去；清野：Q 冲血最多的那只
  iti: { lane: 0, build: BUILDS.iti,
    fight: [c => { const t = c.tg; if (!t) return null; const pool = c.foes.filter(e => D(e, c.me) < 25), [p, n] = bestSpot(pool, 8); if (p && n >= 2 && D(p, c.me) < 15) { const g = pool.filter(e => D(e, p) <= 8 + e.r); return { key: "R", x: g.reduce((s, e) => s + e.x, 0) / g.length, z: g.reduce((s, e) => s + e.z, 0) / g.length }; }
        return c.d < 13 && itiUltEstimate(c.me, t, c.api) * 0.85 > t.hp + t.shield ? { key: "R", x: t.x, z: t.z } : null; },
      c => { const w = c.a.data.iti?.w, f = c.foes.slice().sort((p, q) => D(p, c.me) - D(q, c.me))[0]; return w && c.hp < 0.32 && f && D(w, f) > D(c.me, f) + 3 ? { key: "W" } : null; },
      c => (c.tg && c.d <= 10 ? { key: "E", unit: c.tg } : null),
      at("Q", 6.5), at("Q", 9, { when: c => c.a.data.iti?.q?.n > 1 }),
      at("W", 12, { min: 5, when: c => !c.a.data.iti?.w && c.hp > 0.5 && c.a.cdLeft("E") > 1 })],
    farm: [lineFarm("Q", 6, 1.2, 3), c => { const m = c.mins.filter(e => e.kind === "monster" && D(e, c.me) - e.r < 6).sort((p, q) => q.hp - p.hp)[0]; return m && (c.mana > 0.4 || c.a.data.iti?.q?.n > 1) ? { key: "Q", x: m.x, z: m.z } : null; }],
    flee: [c => { const w = c.a.data.iti?.w, f = c.foes.slice().sort((p, q) => D(p, c.me) - D(q, c.me))[0]; return w && (!f || D(w, f) > D(c.me, f) + 2) ? { key: "W" } : null; },
      c => { if (c.a.data.iti?.w) return null; const [x, z] = c.away(7); return near(c, 10) > 0 ? { key: "W", x, z } : null; }] },
  // 塞伦（第三批）：残血的、一线能穿两个的就开大（身边 5 米有人不开，蓄力会被打断）；有人贴到 3.8 米以内就朝他轰一铳退开（往家的方向退）；射程里有英雄就压满；被控住的、扑上来的脚下埋雷。逃跑时朝追兵轰一铳退开、在身后埋雷
  seren: { lane: 2, build: BUILDS.seren,
    fight: [c => { if (near(c, 5) > 0) return null; const t = c.foes.filter(e => D(e, c.me) < 22 && e.hp / e.max < 0.45).sort((p, q) => p.hp - q.hp)[0] ?? (c.tg && D(c.tg, c.me) < 22 && inBand(c.me, c.tg, c.foes, 24, 0.9).n >= 2 ? c.tg : null); if (!t) return null; const [x, z] = c.aim(t, 55, 0.8); return { key: "R", x, z }; },
      c => { if (near(c, 4.5) === 0) return null; const [x, z] = c.away(5); return { key: "E", x: 2 * c.me.x - x, z: 2 * c.me.z - z }; }, self("Q", c => !!c.tg && c.d <= c.api.stat(c.me).range + 0.3),
      c => (c.tg && c.d < 3.4 && c.tg.hp < (60 + 0.5 * c.api.stat(c.me).ad) * 1.2 ? { key: "E", x: c.tg.x, z: c.tg.z } : null),      // 第九轮 balance：贴得近的残血，轰一铳收掉（原来 E 只在有人贴到 3.8 米时用，一局三次）
      c => (c.tg && c.d < 8 && (c.tg.root > 0 || c.tg.stun > 0) ? { key: "W", x: c.tg.x, z: c.tg.z } : null), at("W", 7, { delay: 0.9, when: c => near(c, 4.5) > 0 }),
      at("W", 7.5, { delay: 0.9, when: c => c.mana > 0.7 || (c.mana > 0.4 && (c.tg!.hp / c.tg!.max < 0.7 || c.pressed)) })],      // 第九轮 balance：照 LoL 女警放夹子，对线、打架时往对面要走的地方先埋一颗（最多两颗，存在 40 秒，踩不中也封路）；原来只在对面被控住或扑脸时埋，一局四次
    farm: [self("Q", c => c.mana > 0.45 && (c.mins.filter(m => D(m, c.me) < c.api.stat(c.me).range + 1).length >= 3 || c.mins.some(m => m.kind === "monster")))],
    flee: [c => { if (near(c, 5) === 0) return null; const [x, z] = c.away(5); return { key: "E", x: 2 * c.me.x - x, z: 2 * c.me.z - z }; }, c => { const f = c.foes.filter(e => D(e, c.me) < 8).sort((p, q) => D(p, c.me) - D(q, c.me))[0]; return f ? { key: "W", x: c.me.x + (f.x - c.me.x) * 0.4, z: c.me.z + (f.z - c.me.z) * 0.4 } : null; }] },
};
/** 每个英雄默认走哪条线：0 中、1 上、2 下。第九轮起按名册里的主位置算（打野算中路），BOOK 里的 lane 是三对三时候的分路，不再用 */
export const LANE_OF = (id: string) => Math.max(0, POS_LANE[posOf(id)]);

// ---- 队伍的安排 ----
export interface Order { kind: "defend" | "boss" | "push"; x: number; z: number; lane: number; camp: Camp | null; until: number; who: Set<number> | null; }      // who：这件事叫了谁（单位 id）；null 是全队
export interface Brain {
  team: 0 | 1; order: () => Order | null; update: (dt: number) => void;
  /** 离 e 最近的一场“队友正在和对面英雄打”的架（不算 e 自己的），max 米以内 */
  fightNear: (e: Ent, max: number) => Ent | null;
  /** 这条线是不是正在被压：我方这条线最靠外的塔在挨打、塔下有对面的英雄、或者塔下进了一堆对面的小兵。守这条线的人这时候不该去打野、打 Boss、回家买东西 */
  siege: (lane: number) => boolean;
  /** 给电脑分路：按位置走（POS_LANE）。第九轮：玩家离开了自己位置的那条线、在另一条单人线上待住了，那条线上的电脑（上单、中单）让到玩家原来那条线去 */
  laneFor: (e: Ent, want: number) => number; claim: (e: Ent, lane: number) => void;
}
/** human：这一队里玩家自己操控的英雄（没有就是 null）。他该走哪条线按他的位置（h.pos）算 */
export function createBrain(sim: Sim, team: 0 | 1, diff: Diff, human: Ent | null = null): Brain {
  const T = DIFF[diff], foe = 1 - team; let acc = 1, order: Order | null = null, humanAt = -1, humanT = 0; const lanes = new Map<number, number>();
  const humanHome = human && isPos(human.h?.pos) ? POS_LANE[human.h!.pos as Pos] : -1; let humanLane = humanHome;      // humanHome：玩家的位置该走的线（打野是 -1）；humanLane：他现在实际待在哪条线
  const mates = () => sim.ents.filter(e => e.h && e.team === team), alive = (l: Ent[]) => l.filter(e => e.alive);
  const lv = (l: Ent[]) => l.reduce((s, e) => s + e.h!.level, 0) / Math.max(1, l.length);
  /** 哪条线推得最深：对面那条线剩的塔最少的；一样多就看中路 */
  const deepest = () => { let best = 0, bn = 9; for (const l of [0, 1, 2]) { const n = sim.ents.filter(e => e.kind === "tower" && e.team === foe && e.lane === l && e.alive).length; if (n < bn) { bn = n; best = l; } } return best; };
  const brain: Brain = {
    team, order: () => order,
    fightNear(e, max) { let best: Ent | null = null, bd = max; for (const p of mates()) { if (p === e || !p.alive) continue; const hot = [...p.h!.hitBy.values()].some(t => sim.time - t < 2.5) || sim.ents.some(q => q.h && q.team === foe && q.alive && sim.time - (q.h.hitBy.get(p.id) ?? -9) < 2.5); if (!hot) continue; const d = D(p, e); if (d < bd) { bd = d; best = p; } } return best; },
    siege(lane) { const t = sim.ents.filter(e => e.kind === "tower" && e.team === team && e.lane === lane && e.alive).sort((p, q) => p.tier - q.tier)[0]; if (!t) return lane >= 0;
      return sim.time - t.hurtAt < 4 || sim.ents.some(q => q.h && q.team === foe && q.alive && sim.sees(team, q) && D(q, t) < 14) || sim.ents.filter(m => m.alive && m.team === foe && isMinion(m) && D(m, t) < t.range).length >= 3; },
    laneFor(e, want) { const p = e.h?.pos; if (humanLane < 0 || humanLane === humanHome || (p !== "top" && p !== "mid") || POS_LANE[p] !== humanLane) return want; return humanHome >= 0 ? humanHome : want; },      // 下路两个人和打野不让
    claim(e, lane) { lanes.set(e.id, lane); },
    update(dt) {
      // 玩家现在在哪条线：在一条线上连着待够八秒才算（路过不算）
      if (human && human.alive) { let bl = -1, bd = 9; for (const l of [0, 1, 2]) { const [s, d] = sim.onLane(l, team, human.x, human.z); if (d < bd && s > 55) { bd = d; bl = l; } } if (bl === humanAt) humanT += dt; else { humanAt = bl; humanT = 0; } if (bl >= 0 && humanT > 8) humanLane = bl; }
      acc += dt; if (acc < 1.2) return; acc = 0; const mine = alive(mates()), theirs = alive(sim.ents.filter(e => e.h && e.team === foe));
      // 守家：高地塔或者水晶正在挨打，而且对面有英雄在场
      // 守：高地塔或者水晶在挨打（哪怕只是小兵）；或者对面两个以上的英雄压到了我方哪座塔下
      const mineB = sim.ents.filter(e => e.alive && e.team === team && isBuilding(e)), seen = theirs.filter(q => sim.sees(team, q));
      const base = mineB.find(b => (b.kind === "core" || b.tier === 3) && sim.time - b.hurtAt < 3.5) ?? (T.group ? mineB.filter(b => seen.filter(q => D(q, b) < 17).length >= 2).sort((p, q) => q.tier - p.tier)[0] : undefined);
      if (base) { order = { kind: "defend", x: base.x, z: base.z, lane: base.kind === "core" ? 0 : base.lane, camp: null, until: sim.time + 6, who: null }; return; }
      // 哪座塔在挨对面英雄的打，而附近一个自己人都没有（守这条线的人死了或者不在）：叫离得最近的一个人去
      const lone = mineB.find(b => b.kind === "tower" && sim.time - b.hurtAt < 3.5 && seen.some(q => D(q, b) < 13) && !mine.some(p => D(p, b) < 20));
      if (lone && mine.length && (!order || order.kind !== "defend")) { const near = mine.slice().sort((p, q) => D(p, lone) - D(q, lone))[0]; order = { kind: "defend", x: lone.x, z: lone.z, lane: lone.lane, camp: null, until: sim.time + 8, who: new Set([near.id]) }; return; }
      if (order && (sim.time > order.until || (order.kind === "boss" && (!order.camp!.up || mine.length < 2)) || (order.kind === "push" && mine.length < 2 && theirs.length >= mine.length))) order = null;
      if (order || !T.group || mine.length < 2) return;
      const hpAvg = mine.reduce((s, e) => s + e.hp / e.max, 0) / mine.length, ahead = theirs.length < mine.length || lv(mine) >= lv(theirs) + 1.5;
      // 一起推：对面死得只剩一个（或者全灭）；或者身上有巨魔之怒。平时各守各的线
      // 九分钟以后，领先的一方（剩的塔多；一样多就看人头）抱团推最深的那条线，把局收掉；落后的一方会被“对面两个以上英雄压到塔下”叫去守，团战就打起来了
      const tw = (tm: number) => sim.ents.filter(e => e.kind === "tower" && e.team === tm && e.alive).length, lead = tw(team) - tw(foe) || sim.kills[team] - sim.kills[foe];
      // 第九轮（5v5）：抱团收局从八分钟推到十分钟、要四个人以上（一队五个人一起推，塔倒得比三个人快得多，第二局试下来不到十六分钟就推平了）；对面只剩一两个人才算“死光了”
      const big = mates().length >= 5, wipe = theirs.length <= (big ? 2 : 1) && mine.length >= (big ? 3 : 2), fury = sim.teamBuff.troll[team] > sim.time, close = sim.time > (big ? 600 : 480) && lead > 0 && mine.length >= (big ? 4 : 3) && hpAvg > 0.6;
      const brawl = !!T.brawl && sim.time > 240;      // 表演打法：四分钟后两队都去中路，撞在一起
      const push = (lane: number) => { order = { kind: "push", x: 0, z: 0, lane, camp: null, until: sim.time + (wipe ? 25 : 30), who: null }; };
      // 第九轮（5v5）：五个人守家很稳，试过两局拖到三四十分钟（两边各剩两座塔，领先的一方一直在轮流打 Boss，谁也不去收）。所以五对五里推线排在打 Boss 前面的几种：
      // 对面死得只剩一两个、身上有巨魔之怒（打巨魔就是为了推）、十五分钟以后领先、二十分钟以后对面的水晶已经露出来了（人不比对面少、血够）
      const finish = big && sim.time > 1200 && sim.ents.some(e => e.kind === "core" && e.team === foe && e.open) && mine.length >= 4 && mine.length >= theirs.length && hpAvg > 0.55;
      if (big && (wipe || fury || finish || (close && sim.time > 900))) { push(human && human.alive && humanLane >= 0 && !wipe && !finish ? humanLane : deepest()); return; }
      // 打 Boss：血够、等级够，而且对面少人或者我们明显领先；七分钟以后势均力敌也去（Boss 附近没看见对面的人就行），不然后期谁也推不动谁。
      // 只叫够用的人：巨兽两个，巨魔三个（十二级以后两个也行）；自己那条线正被压着的人不叫。线上不能没人——只会守线的一方会把塔全推了
      const free = mine.filter(e => e !== human && !brain.siege(lanes.get(e.id) ?? -1));
      if (hpAvg > 0.62) for (const c of sim.camps.filter(c => c.kind === "boss" && c.up).sort((p, q) => (q.mob === "troll" ? 1 : 0) - (p.mob === "troll" ? 1 : 0))) { if (!ahead && !(sim.time > 420 && hpAvg > 0.72 && !seen.some(q => D(q, c) < 26))) continue;
        const pri = (e: Ent) => D(e, c) - (e.h!.pos === "jungle" ? 40 : e.h!.pos === "sup" ? 12 : 0);      // 第九轮：先叫打野，再叫辅助，其余按远近（单人线的人尽量别从线上拉走）
        const troll = c.mob === "troll", n = troll && lv(mine) < 12 ? 3 : 2, crew = free.slice().sort((p, q) => pri(p) - pri(q)).slice(0, n); if (lv(mine) < (troll ? 8 : 5) || crew.length < Math.min(n, 2) || (troll && crew.length < n && theirs.length > 0)) continue;
        order = { kind: "boss", x: c.x, z: c.z, lane: 0, camp: c, until: sim.time + 70, who: new Set(crew.map(e => e.id)) }; return; }
      if (wipe || fury || close || brawl) push(brawl && !wipe ? 0 : human && human.alive && humanLane >= 0 && !wipe ? humanLane : deepest());
    },
  };
  return brain;
}

// ---- 一个电脑控制的英雄 ----
export interface Bot { update: (dt: number) => void; ent: Ent; doing: () => string; lane: () => number; pos: () => Pos; ganks: () => number; hist: Record<string, number>; }      // hist：每件事各做了多少秒（调试用）；ganks：打野去抓了几次

/** pos：这一局打什么位置（不写就用英雄的主位置）。英雄身上的 h.pos 也会被设成它 */
export function createBot(o: { actor: Actor; sim: Sim; api: Api; nav: Nav; brain: Brain; diff: Diff; pos?: string }): Bot {
  const { actor: a, sim, api, nav, brain } = o, me = a.ent, h = me.h!, T = DIFF[o.diff], team = me.team as 0 | 1, foeTeam = 1 - team, home = sim.fountain[team], book = BOOK[a.kit.id] ?? BOOK.lan, ranged = !!a.kit.ranged;
  const pos: Pos = isPos(o.pos) ? o.pos : isPos(h.pos) ? h.pos : posOf(a.kit.id); h.pos = pos;
  const jungler = pos === "jungle", sup = pos === "sup";
  let acc = Math.random() * T.think, doing = "出门", lane = brain.laneFor(me, jungler ? 0 : POS_LANE[pos]), homing = false, tripAt = -99, goal: [number, number] | null = null, atk: Ent | null = null, lastPos: [number, number] = [me.x, me.z], still = 0, dodged = 0, camp: Camp | null = null, fightKeep = 0, lastTg: Ent | null = null, engageAt = 0, benchId = -1, benchUntil = 0, campAt = 0, backUntil = 0, backPt: [number, number] = [0, 0];      // engageAt：这一架从什么时候开始打的；bench：追不上、暂时不理的那个人
  const vel = new Map<number, { x: number; z: number; t: number; vx: number; vz: number }>();      // 看得见的对面英雄：上次的位置和估出来的速度（预判用）
  brain.claim(me, jungler ? -1 : lane);
  const sees = (e: Ent) => sim.sees(team, e);
  // 第九轮（5v5）：打野和辅助用的几样东西
  interface Gank { lane: number; until: number; foe: Ent; mate: Ent; }
  let gank: Gank | null = null, gankAt = -99, ganks = 0;      // 打野正在抓哪条线（抓谁、和哪个队友一起）；上次抓人什么时候结束的
  const duo = () => sup ? sim.ents.find(e => e.h && e.team === team && e !== me && e.h.pos === "adc") ?? null : null;      // 辅助跟着的射手
  const hasJungler = () => sim.ents.some(e => e.h && e.team === team && e.h.pos === "jungle");
  // 第九轮：不急的走动（跟兵线、去打 Boss、去帮人……）不许在 3.2 秒内掉头往回走。原来“退一步、进一步”每想一次就换一次方向，人在原地来回晃（卡兵检测里英雄的“卡住”都是这个）。
  // 急的（躲塔、逃跑、吃亏后撤、躲重击、拉开距离）照走不误，并且算一次换向
  let dirX = 0, dirZ = 0, dirAt = -99;
  const go = (x: number, z: number, urgent = false) => { if (goal && Math.hypot(goal[0] - x, goal[1] - z) < 1.3 && a.state() === "move") return; if (Math.hypot(me.x - x, me.z - z) < 0.6) { goal = null; return; }
    const l = Math.hypot(x - me.x, z - me.z), ux = (x - me.x) / l, uz = (z - me.z) / l, dot = ux * dirX + uz * dirZ;
    if (!urgent && dot < -0.3 && sim.time - dirAt < 3.2) return;
    if (dot < 0.7) { dirX = ux; dirZ = uz; dirAt = sim.time; }
    const [gx, gz] = nav.walkable(x, z) ? [x, z] : nav.nearest(x, z); a.moveTo(gx, gz); goal = [x, z]; atk = null; };
  const hit = (e: Ent) => { if (atk === e && a.target() === e && (a.state() === "attack" || a.state() === "move" || a.state() === "idle")) return;
    // 打小兵、野怪、建筑而且得先走过去的：和 go 一样，刚换过方向就不许马上掉头（打英雄不受限）
    if (!e.h && a.state() === "move" && !a.inReach(e)) { const l = Math.hypot(e.x - me.x, e.z - me.z) || 1, dot = ((e.x - me.x) * dirX + (e.z - me.z) * dirZ) / l; if (dot < -0.3 && sim.time - dirAt < 3.2) return; }
    a.attack(e); atk = e; goal = null; };
  const toward = (x: number, z: number, dist: number): [number, number] => { const dx = x - me.x, dz = z - me.z, l = Math.hypot(dx, dz) || 1; return [me.x + (dx / l) * Math.min(dist, l), me.z + (dz / l) * Math.min(dist, l)]; };
  const hp = () => me.hp / me.max, mana = () => (h.stat.mana > 0 ? h.mana / h.stat.mana : 1);
  // 一个英雄的本钱：打得疼不疼 × 扛不扛得住，开个方（两边人数、血量、等级的差别都在里面）
  const worth = (e: Ent) => { const st = e.h!.stat; return Math.sqrt((st.ad * st.as + st.ap * 0.5 + 60 + e.h!.level * 22) * (e.hp + e.shield + 200) * (1 + (e.armor + e.mr) / 220)); };
  const towers = (tm: number) => sim.ents.filter(e => e.alive && e.team === tm && isBuilding(e));
  /** 这个位置在不在对面哪座塔（或者水晶）的射程里。返回那座塔 */
  const towerOver = (x: number, z: number, pad = 1.2) => towers(foeTeam).find(t => Math.hypot(t.x - x, t.z - z) < t.range + pad) ?? null;
  /** 那座塔下面有没有自己的小兵顶着（塔先打小兵） */
  const covered = (t: Ent) => sim.ents.some(m => m.alive && m.team === team && isMinion(m) && D(m, t) < t.range - 0.3 && m.hp > m.max * 0.15);
  const safeAt = (x: number, z: number) => { const t = towerOver(x, z); return !t || (covered(t) && t.target !== me); };
  /** 往家的方向退 dist 米能到的地方 */
  const back = (dist: number): [number, number] => { const [s, off] = sim.onLane(lane, team, me.x, me.z), [x, z] = sim.along(lane, team, Math.max(0, s - dist)); return off < 10 && D({ x, z }, me) > 3 ? [x, z] : toward(home[0], home[1], dist); };      // 第九轮：离自己那条线远（打野在野区、辅助跟着射手去了别处）就直接朝家退，不先跑回线上
  // 第九轮：装备有了合成。照出装单的顺序：钱够就合成下一件成装（身上的配件自动用掉、只付差价），不够就先买它缺的配件里买得起的最贵的；没鞋先买双基础鞋
  const build = BOOK[a.kit.id]?.build ?? buildFor(a.kit.id, a.kit.role);      // 出装单在 items.ts 的 BUILDS（商店的“推荐”也读那一份）；BOOK 里没有的英雄按职业
  function shop() { if (!atShop(sim, me)) return; autoBuy(sim, me, build); }
  function tryCast(plays: Play[], c: Ctx, noUlt = false): boolean {
    for (const p of plays) { const r = p(c); if (!r || !a.canCast(r.key) || (noUlt && r.key === "R")) continue; const d = a.skill(r.key)!;
      if (d.cast === "unit" ? a.cast(r.key, undefined, r.unit ?? c.tg) : a.cast(r.key, r.x !== undefined ? { x: r.x, z: r.z! } : c.tg ? { x: c.tg.x, z: c.tg.z } : undefined)) { goal = null; atk = null; return true; } }
    return false;
  }

  /** 打野（第九轮）：抓人、刷野、等野怪。返回 true 表示这一轮已经有事做了；野区没事（营地都还要很久才刷）返回 false，下面就去中路跟兵线 */
  function jungle(ctx: Ctx, now: number, st: string, useSkill: boolean): boolean {
    // 正在抓：朝那个人去（看不见他就先去和队友会合），看得见、打得过，上面“打架”那一段会接手。他逃回家、死了、队友没了，或者二十四秒还没打起来，就回野区
    if (gank) { const g = gank, fh = sim.fountain[foeTeam];
      if (now > g.until || !g.foe.alive || !g.mate.alive || hp() < 0.45 || Math.hypot(g.foe.x - fh[0], g.foe.z - fh[1]) < 32 || (towerOver(g.foe.x, g.foe.z, 0) && !covered(towerOver(g.foe.x, g.foe.z, 0)!))) { gank = null; gankAt = now; }
      else { const seen = sees(g.foe), [tx, tz] = seen ? [g.foe.x, g.foe.z] : [g.mate.x, g.mate.z]; doing = "抓" + ["中路", "上路", "下路"][g.lane]; camp = null; go(tx, tz); return true; } }
    // 要不要去抓：六级以后（困难五级），血蓝都够，上一次抓完过了四十秒。挑一条线：对面那个人残了、或者压过了半场，而且自己那条线的人在他边上（二打一）；在他自己塔下的不抓
    if (T.group && h.level >= (o.diff === "hard" ? 4 : 5) && now - gankAt > 40 && hp() > 0.6 && mana() > 0.3) {      // 第九轮 balance：6 级（困难 5 级）→ 5 级（困难 4 级）。LoL 的打野清完第一轮野（三四级）就去抓；原来六级才抓，八局里九分钟以前平均不到四个人头
      let best: Gank | null = null, bs = 0.2;      // 第一局试下来门槛 0.55 太高：十分钟只抓了一次（满血的对面要压到半场以内、离得还得近才够）
      for (const l of [1, 0, 2]) { const L = sim.laneLen(l);
        for (const f of sim.ents) { if (!f.h || !f.alive || f.team !== foeTeam || !sees(f) || towerOver(f.x, f.z, 0)) continue; const [s, off] = sim.onLane(l, team, f.x, f.z); if (off > 9) continue;
          const mate = sim.ents.find(m => m.h && m.alive && m.team === team && m !== me && D(m, f) < 18 && m.hp / m.max > 0.35); if (!mate) continue;
          const sc = (1 - f.hp / f.max) * 1.6 + (s < L * 0.5 ? 0.6 : s < L * 0.62 ? 0.3 : 0) + (mate.hp / mate.max - 0.5) * 0.4 - D(f, me) / 90; if (sc > bs) { bs = sc; best = { lane: l, until: now + 24, foe: f, mate }; } } }
      if (best) { gank = best; ganks++; return jungle(ctx, now, st, useSkill); } }
    // 刷野：自己这边的营地挑最近的（先打小营地，四级以后、血够才打增益怪）；血不够开下一个营地就先回家。
    // 原来二级就去打增益怪：烬鬃野猪 4400 血、重击推人，二级的岚打到一半残血回家，有一局五分钟了还是二级
    if (camp && (!camp.up || !camp.mobs.some(m => m.alive))) camp = null;
    if (!camp) { if (hp() < 0.42) { homing = true; return false; }
      camp = sim.camps.filter(c => c.up && c.kind !== "boss" && c.side === team && (c.kind !== "buff" || (h.level >= 4 && hp() > 0.6)) && !towerOver(c.x, c.z)).sort((p, q) => D(p, me) - D(q, me))[0] ?? null; campAt = now; }
    if (camp) { const m = camp.mobs.filter(x => x.alive).sort((p, q) => p.hp - q.hp)[0];
      if (m) { doing = "打野 " + MOBS[m.mob].name; const dc = D(camp, me); if (dc > 6.5) { const [x, z] = toward(camp.x, camp.z, dc - 4); go(x, z); return true; }      // 先走进营地再动手：站在外面打，野怪追不到人会脱战回血
        if (D(m, me) < 9 && useSkill && mana() > 0.4 && book.farm.length) { ctx.mins = camp.mobs.filter(x => x.alive); ctx.tg = null; if (tryCast(book.farm, ctx)) return true; } hit(m); return true; }
      camp = null; }
    // 营地都没刷出来：去最快刷出来的那个门口等（半分钟以内的）
    const next = sim.camps.filter(c => !c.up && c.kind !== "boss" && c.side === team && (c.kind !== "buff" || h.level >= 4)).sort((p, q) => p.nextAt - q.nextAt)[0];
    if (next && next.nextAt - now < 30) { doing = "等野怪"; if (D(next, me) > 6.5) { const [x, z] = toward(next.x, next.z, D(next, me) - 5); go(x, z); } else if (st === "move") a.stop(); return true; }
    return false;
  }
  /** 辅助（第九轮）：跟着射手，站在他侧后方（不叠在一起）；不补刀；能奶、能盾的先给他。打人的事上面“打架”那一段管（谁打射手先打谁） */
  function support(ctx: Ctx, adc: Ent, st: string, useSkill: boolean): boolean {
    if (useSkill) for (const p of book.farm) { const r = p(ctx); if (!r || !r.unit || r.unit.team !== team || r.unit === me || !a.canCast(r.key)) continue; if (a.cast(r.key, undefined, r.unit)) { doing = "奶 " + r.unit.h?.kit; goal = null; atk = null; return true; } }      // 摩珂的 Q：谁血少奶谁
    const [s, off] = sim.onLane(2, team, adc.x, adc.z); let x: number, z: number;
    if (off < 9) { const [px, pz, tx, tz] = sim.along(2, team, Math.max(0, s - 2.6)); x = px - tz * 1.7; z = pz + tx * 1.7; }      // 在下路：射手身后两米半、往旁边让一米七
    else { const l = Math.max(1, D(adc, { x: home[0], z: home[1] })); x = adc.x + ((home[0] - adc.x) / l) * 2.6; z = adc.z + ((home[1] - adc.z) / l) * 2.6; }      // 射手去了别处（帮人、打 Boss）：站在他和家之间
    if (!safeAt(x, z)) [x, z] = back(4);
    doing = "跟着 " + adc.h!.kit; if (D({ x, z }, me) > 1.8) go(x, z); else if (st === "move") a.stop();
    return true;
  }

  function think() {
    if (sim.over) return;
    if (!me.alive) { doing = "阵亡"; shop(); homing = false; goal = null; atk = null; camp = null; if (gank) { gank = null; gankAt = sim.time; } return; }
    shop();
    const now = sim.time, st = a.state(); if (st === "stun" || st === "dash" || st === "lock" || (st === "cast" && a.busy())) return;      // 第九轮：技能出手以后的收招不再等它播完（新命令会直接打断收招，和玩家一样）
    if (st === "channel" && !(now - me.hurtAt < 1 && hp() < 0.25)) { doing = "引导技能"; return; }      // 正在引导（齐射、举盾）：让它放完，除非快死了
    // 走着走着半天没动（被什么卡住了）：把目的地忘掉，下一轮重新找路
    if (st === "move") { if (Math.hypot(me.x - lastPos[0], me.z - lastPos[1]) < 0.15) { still += T.think; if (still > 1.4) { goal = null; atk = null; still = 0; a.stop(); } } else still = 0; } else still = 0; lastPos = [me.x, me.z];
    const heroes = sim.ents.filter(e => e.h && e.alive), foes = heroes.filter(e => e.team === foeTeam && sees(e) && !e.untarget && D(e, me) < 20), pals = heroes.filter(e => e.team === team && e !== me && D(e, me) < 16);
    for (const e of foes) { const v = vel.get(e.id), el = v ? now - v.t : 0, ok = !!v && el > 1e-3 && el < 1.5; vel.set(e.id, { x: e.x, z: e.z, t: now, vx: ok ? (e.x - v!.x) / el : 0, vz: ok ? (e.z - v!.z) / el : 0 }); }
    const nearMin = sim.ents.filter(e => e.alive && e.team !== team && (isMinion(e) || e.kind === "monster") && sees(e) && D(e, me) < 13 && (e.kind !== "monster" || e.fight > 0)), pressed = now - me.hurtAt < 2;
    const nearestFoe = foes.slice().sort((p, q) => D(p, me) - D(q, me))[0] ?? null;
    const ctx: Ctx = { me, a, api, tg: null, d: 99, foes, pals, mins: nearMin, hp: hp(), mana: mana(), pressed,
      aim(e, speed, delay = 0) { const v = vel.get(e.id), t = (speed ? D(e, me) / speed : 0) + delay, k = T.lead * Math.min(t, 1.2), er = T.aim * (0.4 + 0.6 * Math.random()), ang = Math.random() * 6.283; return [e.x + (v ? v.vx * k : 0) + Math.sin(ang) * er, e.z + (v ? v.vz * k : 0) + Math.cos(ang) * er]; },
      away(dist) { const f = nearestFoe; if (!f) return back(dist); const dx = me.x - f.x, dz = me.z - f.z, l = Math.hypot(dx, dz) || 1, [bx, bz] = back(dist), mx = dx / l + (bx - me.x) / dist * 0.8, mz = dz / l + (bz - me.z) / dist * 0.8, ml = Math.hypot(mx, mz) || 1; return api.reach(me.x, me.z, mx / ml, mz / ml, dist); } };
    const useSkill = Math.random() < T.skill;

    // ---- 保命 ----
    // 重击的预警圈：站在里面就往外走
    for (const m of sim.ents) { if (m.kind !== "monster" || !m.alive || m.state !== "heavy" || m.struck || now - dodged < 0.3) continue; const d = Math.hypot(me.x - m.hvx, me.z - m.hvz); if (d > m.hvr + 0.6) continue;
      if (Math.random() > T.dodge) { dodged = now + 3; break; } const dx = me.x - m.hvx, dz = me.z - m.hvz, l = d || 1, [gx, gz] = api.reach(me.x, me.z, dx / l, dz / l, m.hvr + 1.6 - d); doing = "躲重击"; a.moveTo(gx, gz); goal = [gx, gz]; atk = null; dodged = now; return; }
    if (a.recalling() > 0) { if (foes.some(e => D(e, me) < 11)) a.stop(); else { doing = "回城"; return; } }
    // 塔：被盯上了，或者站在塔的射程里而塔下没有自己的小兵
    const tw = towerOver(me.x, me.z, 0.4), diving = !!lastTg && lastTg.alive && lastTg.hp / lastTg.max < (o.diff === "hard" ? 0.22 : o.diff === "normal" ? 0.16 : 0) && hp() > 0.5 && D(lastTg, me) < 6;      // 越塔：对面只剩一丝血、自己血还多，才顶着塔追进去（第九轮 balance：普通 0.12 → 0.16）
    if (tw && (tw.target === me || !covered(tw)) && !diving && !(T.brawl && foes.some(e => D(e, me) < 9) && hp() > 0.3) && !(foes.length === 0 && heroes.filter(e => e.team === foeTeam).length <= 1 && hp() > 0.4 && me.max > 5200 && tw.open)) { const dx = me.x - tw.x, dz = me.z - tw.z, l = Math.hypot(dx, dz) || 1, [bx, bz] = back(8), ex = dx / l * 0.5 + (bx - me.x) / 8, ez = dz / l * 0.5 + (bz - me.z) / 8, el = Math.hypot(ex, ez) || 1, [gx, gz] = api.reach(me.x, me.z, ex / el, ez / el, tw.range + 3 - l + 2);
      doing = "退出塔的射程"; go(gx, gz, true); if (tw.target === me && useSkill) tryCast(book.flee, ctx); return; }
    // 血少了回家；想买的装备攒够钱了也回家（线上得没什么事）
    const winning = !!lastTg && lastTg.alive && now < fightKeep && lastTg.hp / lastTg.max < hp() && D(lastTg, me) < 9;      // 正打着，而且对面那个比我还残：不走，打完再说
    if (!homing && !winning && (hp() < T.flee || (hp() < 0.45 && mana() < 0.15 && foes.length > 0))) homing = true;
    if (!homing && T.trip && now - tripAt > 150 && foes.length === 0 && nearMin.length === 0 && !brain.siege(lane)) { if (h.gold >= tripCost(h.items, build) + 300 && D({ x: home[0], z: home[1] }, me) > 30) { homing = true; tripAt = now; } }      // 攒够了合成下一件（或者买下它最贵的那件进阶配件）的钱
    if (homing) {
      const dh = Math.hypot(me.x - home[0], me.z - home[1]);
      if (dh < RULES.fountainR - 1.5) { if (hp() > 0.92 && mana() > 0.8) { homing = false; tripAt = now; } else { doing = "在出生点回血"; if (st === "move") a.stop(); return; } }
      else { const chased = foes.some(e => D(e, me) < 13) || now - me.hurtAt < 2.5;
        if (chased) { doing = "逃跑"; if (useSkill || hp() < 0.25) tryCast(book.flee, ctx); if (a.state() !== "cast") go(home[0], home[1], true); }
        else if (dh > 26) { doing = "回城"; if (st === "move" || st === "attack") a.stop(); a.recall(); goal = null; atk = null; }
        else { doing = "走回家"; go(home[0], home[1]); }
        return; }
    }

    // ---- 打架 ----
    // 第九轮：决定吃亏后撤以后，至少退 2.5 秒（或者退到地方）再重新掂量。原来每想一次都重新算一遍：这一次看见对面就退，下一次对面进了迷雾又往回走，
    // 在 Boss 坑边上来回晃，三秒里走了十几米、位置没变（卡兵检测里英雄“卡住”的几乎都是这个）
    if (now < backUntil) { doing = "吃亏，后撤"; if (D({ x: backPt[0], z: backPt[1] }, me) > 2) { if (a.state() !== "cast") go(backPt[0], backPt[1], true); } else if (st === "move") a.stop(); return; }      // 退到了就站住，等这 2.5 秒过完再说
    const ord0 = brain.order(), sieged = !jungler && brain.siege(lane), ord = ord0 && (!ord0.who || ord0.who.has(me.id)) && !(ord0.kind === "boss" && sieged) ? ord0 : null;
    const partner = duo(), withDuo = !!partner && partner.alive && D(partner, { x: home[0], z: home[1] }) > 26;      // 辅助：射手在外面（没死、没在家）就跟着他
    // 手边有没有正事：够得着、能拆的塔；一刀能补掉的小兵。有正事的时候不为了追人把它们扔下
    const empty = foes.length === 0 && heroes.filter(e => e.team === foeTeam).length <= 1 && hp() > 0.55 && me.max > 5200;      // 对面几乎死光了、自己够肉：没有小兵顶着也顶着塔拆
    const shield = (t: Ent) => sim.ents.filter(m => m.alive && m.team === team && isMinion(m) && D(m, t) < t.range - 0.3 && m.hp > m.max * 0.15).length;      // 塔下顶着几个自己的小兵
    const struct = towers(foeTeam).filter(t => t.open && D(t, me) < 13 && ((shield(t) >= T.cover && t.target !== me) || empty)).sort((p, q) => D(p, me) - D(q, me))[0];
    const range = h.stat.range;      // 第九轮 balance：补刀、消耗、“够不够得着”都按现在的射程算（原来用 kit.base.range，塞伦满级 9.25 米还按 7 米站位，射手后期吃不到射程优势）
    const reach = range + 1.5, dmgTo = (m: Ent) => h.stat.ad * 100 / (100 + Math.max(0, m.armor)), lastM = withDuo ? undefined : nearMin.filter(      /* 辅助跟着射手的时候不补刀 */m => isMinion(m) && m.hp <= dmgTo(m) * 1.05 && D(m, me) - m.r < reach + 2.5 && safeAt(m.x, m.z)).sort((p, q) => p.hp - q.hp)[0];
    if (foes.length) {
      // 挑谁：血少的、脆的、近的优先；在对面塔下而且塔下没有我的兵的往后排
      const score = (e: Ent) => (1 - e.hp / e.max) * 2.2 + (e.max < 3600 ? 0.4 : 0) - D(e, me) / 14 + (e === lastTg ? 0.3 : 0) - (safeAt(e.x, e.z) ? 0 : 1.6) + (withDuo && now - (partner!.h!.hitBy.get(e.id) ?? -99) < 2.5 ? 1.4 : 0) + (gank && gank.foe === e ? 1.2 : 0);      // 辅助：谁在打射手先打谁；打野：先打要抓的那个
      const tg = foes.filter(e => D(e, me) < 12.5 && !(e.id === benchId && now < benchUntil)).sort((p, q) => score(q) - score(p))[0];
      if (tg) {
        const d = D(tg, me) - tg.r, around = (p: Ent, tm: number) => heroes.filter(e => e.team === tm && (tm === team || sees(e)) && D(e, p) < 11);
        let mine = around(tg, team).reduce((s, e) => s + worth(e), 0), theirs = around(tg, foeTeam).reduce((s, e) => s + worth(e), 0); if (!around(tg, team).includes(me)) mine += worth(me) * 0.7;
        const tE = towerOver(tg.x, tg.z, 0), tA = towers(team).find(t => D(t, tg) < t.range); if (tE && !covered(tE)) theirs *= 1.7; else if (tE) theirs *= 1.15; if (tA) mine *= 1.45;
        const mA = sim.ents.filter(m => m.alive && isMinion(m) && D(m, tg) < 8); mine *= 1 + Math.min(0.2, 0.035 * mA.filter(m => m.team === team).length); theirs *= 1 + Math.min(0.2, 0.035 * mA.filter(m => m.team === foeTeam).length);
        // 第九轮 balance：照 LoL 的电脑，占了便宜更敢打——等级比他高（每级降 0.04，落后的时候反过来抬）、他身边我们的人比他们多、他的血比我低一截，开打的门槛各降一点。
        // 原来只看两边本钱的比值：普通难度势均力敌时谁都不先动手，八局里 10 分钟前平均只有 4.6 个人头
        const lvl = Math.max(-2, Math.min(3, h.level - tg.h!.level)), more = around(tg, team).length - around(tg, foeTeam).length, hpGap = hp() - tg.hp / tg.max, press = lvl * 0.04 + (more >= 1 ? 0.08 : 0) + (more >= 2 ? 0.06 : 0) + (hpGap > 0.25 ? 0.08 : 0);
        const adv = mine / Math.max(1, theirs), kill = tg.hp < (h.stat.ad * 2.2 + h.stat.ap * 1.2 + 150) && d < 9, ganking = !!gank && gank.foe === tg, want = T.engage - press - (kill ? 0.3 : 0) - (now < fightKeep && tg === lastTg ? 0.2 : 0) - (ganking ? 0.3 : 0);      // 已经打起来了就别轻易收手。第九轮：打野来抓人就是来拼的，门槛再低一点
        ctx.tg = tg; ctx.d = d;
        // 追着打了三秒半还没碰到他（他在跑，或者一直够不着）：不追了，七秒内不理他，回去干正事。不然人没杀掉，兵和塔全丢了
        const hitAgo = now - (tg.h!.hitBy.get(me.id) ?? -99), hurtAgo = now - (h.hitBy.get(tg.id) ?? -99); if (tg !== lastTg || now > fightKeep) engageAt = now;
        const helping = pals.some(p => D(p, tg) < 10 && now - (tg.h!.hitBy.get(p.id) ?? -99) < 2);      // 第九轮 balance：身边的队友正在打他（辅助先手、打野来抓）：一起上，不先去补兵。原来射手常常看着辅助一个人冲上去
        // 对线是一套一套地换血，不是一直追着打：打了四秒，他还有四成五以上的血、也没在还手，就收手回去补兵，六秒后再说。
        // 一直点下去人杀不掉（他残了会回家），自己的兵和塔倒全漏了。团战（身边有队友、对面不止一个）不受这个限制
        const duel = around(tg, team).length <= 1 && around(tg, foeTeam).length <= 1, low = tg.hp / tg.max < 0.45;
        const stale = !kill && !(ganking && now - engageAt < 7) && ((now - engageAt > (tg.hp / tg.max < 0.3 ? 5.5 : 3.5) && hitAgo > 3 && hurtAgo > 2) ||      /* 第九轮 balance：他只剩三成血，多追两秒 */ (!T.brawl && duel && !low && now - engageAt > 4 && hurtAgo > 1.5)); if (stale) { benchId = tg.id; benchUntil = now + 6; lastTg = null; }
        // 手边有一刀能补掉的兵：先补（除非能杀他，或者他残了，或者他正在打我）。他离得还远、也没在打我，而有塔可拆：先拆
        const busy = !T.brawl && !kill && !helping && ((!!lastM && !low && hurtAgo > 1) || (hurtAgo > 2 && d > (ranged ? range + 0.5 : 4.5) && !!struct));
        // 一对一的时候，只有他残了、能杀、他先动的手、或者自己优势很大才真打；不然只丢技能消耗，其余时间补兵
        const allIn = !!T.brawl || !duel || low || kill || hurtAgo < 1.5 || adv >= 1.3 || ganking || (adv >= 1.12 && (lvl >= 2 || hpGap > 0.3));      // 第九轮 balance：高他两级、或者血比他多三成，优势小一点也上
        if (!stale && !busy && allIn && adv >= want && (safeAt(tg.x, tg.z) || diving || T.brawl || (kill && o.diff === "hard" && hp() > 0.6))) {
          doing = "打 " + tg.h!.kit; lastTg = tg; fightKeep = now + 3; camp = null;
          if (useSkill && tryCast(book.fight, ctx)) return;
          // 远程：有近战贴脸、自己又不占大优势，就先拉开一步再打
          if (ranged && adv < 1.5 && d < 3.2 && tg.range < 4 && now - me.hurtAt < 1.2 && a.state() !== "attack") { const [x, z] = ctx.away(3.5); go(x, z, true); return; }
          hit(tg); return;
        }
        if (adv < T.yield && d < (ranged ? 9.5 : 8) + (tg.range > 5 ? 2 : 0)) {      // 明显吃亏：往自己塔下退，边退边放保命的
          doing = "吃亏，后撤"; lastTg = null; if (useSkill && d < 6) tryCast(book.flee, ctx); { const [x, z] = back(9); backPt = [x, z]; backUntil = now + 2.5; benchId = tg.id; benchUntil = now + 4; if (a.state() !== "cast") go(x, z, true); } return;      /* 退了就先别回头找他（4 秒内不把他当目标），不然退一步进一步来回晃 */
        }
        // 半斤八两：射程够得着、又不用进塔，就点他几下（消耗）；够不着就接着干自己的事
        // 半斤八两：不用进塔的话，技能够得着就丢（不交大招），普攻够得着就点（消耗）；都够不着就接着干自己的事
        if (!stale && adv >= 0.82 && safeAt(tg.x, tg.z) && safeAt(me.x, me.z) && nearMin.filter(m => m.target === me).length < 3) {
          if (useSkill && mana() > 0.35 && d < 11.5 && tryCast(book.fight, ctx, true)) { doing = "消耗 " + tg.h!.kit; lastTg = tg; fightKeep = now + 2; return; }
          if (d <= range + 0.8 && !lastM && !struct) { doing = "消耗 " + tg.h!.kit; hit(tg); return; } }
      }
    }

    // ---- 队伍的安排 ----
    // 帮队友：附近有人打起来了就过去
    const fight = brain.fightNear(me, T.group ? (jungler ? 44 : pos === "top" || pos === "mid" ? 24 : 32) : 14);      // 第九轮：上单、中单只帮身边的（不然一有架就离线，五个人全挤到一处）；打野走得远
    if (fight && hp() > 0.45 && foes.length === 0 && (!sieged || D(fight, me) < 14)) { const t = towerOver(fight.x, fight.z, 0); if (!t || covered(t)) { doing = "去帮 " + fight.h!.kit; camp = null; go(fight.x, fight.z); return; } }
    if (ord && ord.kind === "defend" && D(ord, me) > 9) { doing = "回防"; camp = null; go(ord.x, ord.z); return; }
    if (ord && ord.kind === "boss" && ord.camp && hp() > 0.4) { const c = ord.camp, boss = c.mobs.find(m => m.alive), dB = D(c, me), there = heroes.filter(e => e.team === team && D(e, c) < 14).length;
      if (boss) { doing = "打 " + MOBS[boss.mob].name; camp = null; if (dB > 12) go(c.x, c.z); else if (there >= 2 || boss.fight > 0) { if (dB > 9.5) { const [x, z] = toward(c.x, c.z, dB - 8); go(x, z); return; }      /* 站进它的地盘里打：站在外面它会脱战回血 */ if (useSkill) { ctx.mins = [boss]; ctx.tg = null; tryCast(book.farm, ctx); } hit(boss); } else if (dB > 10) go(c.x, c.z); else if (st === "move") a.stop(); return; } }
    // ---- 第九轮：打野、辅助按位置干自己的事（队伍叫了推线、守家就跟着大家走，归下面对线那一段管；辅助推线时也跟着射手） ----
    if (jungler && !ord && jungle(ctx, now, st, useSkill)) return;
    if (sup && withDuo && (!ord || ord.kind === "push") && support(ctx, partner!, st, useSkill)) return;
    const myLane = ord && (ord.kind === "push" || ord.kind === "defend") ? ord.lane : lane, holding = !!ord && ord.kind === "defend";

    // ---- 对线 ----
    // 够得着的塔和水晶：塔下有自己的小兵顶着就拆
    // 小兵：先补一刀能打死的；没有就打血最少的（简单难度不会卡刀，逮着近的打）
    const mins = nearMin.filter(m => safeAt(m.x, m.z) || (struct && D(m, struct) < struct.range));
    let pickM: Ent | null = null;
    if (mins.length) { const last = Math.random() < T.lastHit ? mins.filter(m => isMinion(m) && m.hp <= dmgTo(m) * 1.05 && D(m, me) - m.r < reach + 2.5).sort((p, q) => p.hp - q.hp)[0] : undefined;
      pickM = last ?? mins.slice().sort((p, q) => (T.lastHit > 0.5 ? p.hp / p.max - q.hp / q.max : 0) + (D(p, me) - D(q, me)) * 0.08)[0]; }
    if (pickM && (!struct || mins.filter(isMinion).length >= 2 || D(pickM, me) < 3)) { doing = "清兵"; camp = pickM.kind === "monster" ? camp : null; if (useSkill && mins.length >= 3 && tryCast(book.farm, ctx)) return; hit(pickM); return; }
    if (struct) { doing = struct.kind === "core" ? "打水晶" : "拆塔"; camp = null; hit(struct); return; }

    // ---- 线上没事 ----
    const own = sim.ents.filter(m => m.alive && m.team === team && isMinion(m) && m.lane === myLane).sort((p, q) => q.s - p.s)[0];      // 这条线上走在最前面的自己的小兵
    const [myS] = sim.onLane(myLane, team, me.x, me.z), waveNear = own && Math.abs(own.s - myS) < 22;
    // 打野：线上的兵还远、附近有刷出来的营地、血够。第九轮：队里有打野就不去抢他的野怪（只有三对三那样没有打野的队伍，线上的人才顺手打）
    if (T.jungle && !ord && !sieged && hp() > (camp ? 0.4 : 0.7) && h.level >= 2 && !hasJungler()) {
      // 第九轮：兵线近不近（waveNear）在 22 米上下来回跳，打野和跟兵线就每想一次换一次、在半路来回走。去了营地至少 4 秒再说，兵要更近（16 米）才回去
      if (camp && (!camp.up || (now - campAt > 4 && own && Math.abs(own.s - myS) < 16 && !camp.mobs.some(m => m.fight > 0)))) camp = null;
      if (!camp && !waveNear) { campAt = now; camp = sim.camps.filter(c => c.up && c.kind !== "boss" && c.side === team && D(c, me) < 27 && (c.kind !== "buff" || h.level >= 3) && !towerOver(c.x, c.z)).sort((p, q) => D(p, me) - D(q, me))[0] ?? null; }
      if (camp) { const m = camp.mobs.filter(x => x.alive).sort((p, q) => p.hp - q.hp)[0]; if (m) { doing = "打野 " + MOBS[m.mob].name; const dc = D(camp, me); if (dc > 6.5) { const [x, z] = toward(camp.x, camp.z, dc - 4); go(x, z); return; }      /* 先走进营地再动手：站在外面打，野怪追不到人会脱战回血 */
        if (D(m, me) < 9 && useSkill && mana() > 0.5) { ctx.mins = camp.mobs.filter(x => x.alive); tryCast(book.farm, ctx); } hit(m); return; } camp = null; }
    } else camp = null;
    // 跟兵线：站在最前面那个小兵身后；兵还没到就在自己这条线最靠外的塔后面等
    let spot: [number, number];
    if (holding) { const [x, z] = toward(ord!.x, ord!.z, Math.max(0, D(ord!, me) - 5)); doing = "守"; if (D(ord!, me) > 7) go(x, z); else if (st === "move") a.stop(); return; }      // 守家：没东西打就站在那座塔（水晶）跟前，不跟着兵线出去
    if (own) { let s = own.s - (ranged ? 4.5 : 1.2); spot = [0, 0]; for (let i = 0; i < 12; i++) { const [x, z] = sim.along(myLane, team, Math.max(0, s)); spot = [x, z]; if (safeAt(x, z)) break; s -= 3; } }
    else { const t = sim.ents.filter(e => e.kind === "tower" && e.team === team && e.lane === myLane && e.alive).sort((p, q) => p.tier - q.tier)[0], [ts] = t ? sim.onLane(myLane, team, t.x, t.z) : [20, 0], [x, z] = sim.along(myLane, team, Math.max(0, ts - 3.5)); spot = [x, z]; }
    doing = own ? "跟兵线" : "等兵"; if (D({ x: spot[0], z: spot[1] }, me) > 2.2) go(spot[0], spot[1]); else if (st === "move" && !own) a.stop();
  }

  const hist: Record<string, number> = {};
  return { ent: me, doing: () => doing, lane: () => (jungler ? -1 : lane), pos: () => pos, ganks: () => ganks, hist,
    update(dt) { acc += dt; if (acc < T.think) return; { const k = doing.split(" ")[0]; hist[k] = (hist[k] ?? 0) + acc; } acc = 0;
      if (!jungler) { const want = brain.laneFor(me, POS_LANE[pos]); if (want !== lane) { lane = want; brain.claim(me, lane); } }      // 玩家换线了：让出来（他走了以后再回来）
      if (T.idle && Math.random() < T.idle && me.alive && sim.time - me.hurtAt > 1.5) return;      // 简单难度：十次里有三次愣着没反应（挨打的时候不愣）
      think(); } };
}
