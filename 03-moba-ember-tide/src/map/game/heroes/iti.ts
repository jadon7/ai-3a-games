// 伊缇 · 绯刃（刺客，烬誓庭，中单）。设计在 docs/hero_iti/DESIGN.md；数值和范围以 docs/hero_iti/PHASE4.md 的表为准（对外演示用的英雄，往夸张了定）。
//
//   被动 烬痕         技能打中敌方英雄叠一层（最多 3 层，5 秒）；叠满的那一下引爆：基础伤害 + 目标已损失生命的 15%。
//                    参与击杀一个英雄（击杀或助攻）：Q 立刻回满（回到第一段、冷却清零），R 剩下的冷却减 30%。
//   Q 三叠斩          5 秒内能放三次（从第一段算起）。一、二段朝瞄的方向低身冲 6 米，砍穿路上 2.4 米宽的所有敌人；
//                    第三段腾空翻身跃向瞄的地方（最远 7 米），落地砸 5 米范围、减速 50% 1.5 秒。每段打中英雄，下一段一落地就能放（不然隔 0.35 秒）。三段放完或超时进 7 秒冷却。
//   W 残焰            原地留一个残影，自己朝瞄的方向冲 7 米。5 秒内再按一次：和残影换位（瞬移回残影那里），残影在她刚才站的地方炸开（5 米）；
//                    不换，5 秒后残影在原地自己炸。冷却 12 秒，从第一次按下算起。
//   E 影步 · 穿心      指向一个敌人（10 米，优先英雄，小兵野怪也能点；点塔不放）：闪到它身后反手一刺，它 3 秒内受到的伤害多 25%。
//                    它身上已经有 2 层烬痕时，这一刺直接叠满引爆。
//   R 绯月千刃        指定落点（14 米）。伊缇跃起消失、不能被选中，在落点 11 米内的敌人之间闪砍 8 刀（优先英雄，轮着砍、先砍血少的，每刀叠烬痕）；
//                    最后落回中心，十字新月斩炸开：范围内每个敌人受到基础伤害 + 已损失生命的 25%，中心 4 米内再多 30%。6 级学，冷却 45 秒。
//
// 特效全在 fx_iti.ts 的 ITI_FX（iti-fx3 任务写）：这里只在时机点调它，传位置、目标、范围；顿帧、震屏、压暗、闪白一概不在这里调。
// 缺的时机在这个文件里写了临时的，都标着“特效占位”。
//
// 实现上定下来的几件规格里没写的事：
//   · 多段施放走 SkillDef.alt（第四阶段在 skills.ts 新加的）：按 Q 时控制器拿到的是 Q / Q2 / Q3 里该放的那一段（三段用自己的动作 q3）；W 的残影还在时拿到的是 W2（瞬发、不播动作）。
//     段与段之间的冷却由这里用 a.setCd 改；技能栏照 SkillDef.recast 在按钮上画段数和窗口剩余时间。只有第一段花法力。
//   · Q 的一、二段是“冲过去的路上砍”：每帧把从起点到现在这一截的直线（半宽 1.2 米）里还没砍过的敌人砍一下；第三段只在落地时结算。
//     一、二段按固定距离冲（照 LoL 锐雯），被墙挡住就停在墙前，时长按冲出去的距离缩短。三段是砸地，落在瞄的地方（2.5～7 米）：固定 7 米的话贴着人放会翻过头、砸不到他。
//     三段的腾空时长照动作时间表 q3 的 land（起跳到落地的那一截按 speed 播完；第四阶段把 speed 从 2.2 提到 4.4，7 米腾空约 0.5 秒，原来 1 秒偏飘）。
//   · W 换位时残影跟她对调：她回到残影那里，残影到她刚才站的地方炸开（打的是她正在打的那一堆人）；不换就在原地炸。换位在冲刺途中、大招里不能用（排在后面）。
//     阵亡时残影直接收掉，不炸。
//   · E 点到塔、水晶不放（还没出手，冷却和法力都不花）。刺完 0.22 秒就放开动作（收招不拖人），控制器记着的普攻目标就是它，接着砍。
//   · R：按下 0.2 秒后人藏起来（模型、血条、围巾都不画）并且移到落点中心——镜头跟着人走，人留在中心镜头就停在大招的范围上，不会跟着八刀来回甩；
//     八刀的位置是“虚的”（只传给特效：从哪闪到哪）。最后在中心现身、播 r 动作的落地那一截，落地那一刻十字新月斩结算。没人可砍的刀是空砍（target 为 null）。
//     大招期间不能被选中（规则那边也不吃伤害），落地后 0.03 秒恢复。
//   · 被动“参与击杀”看的是她身上击杀加助攻的计数涨没涨（每涨一次算一次）；R 的冷却按剩下的乘 0.7。
//   · 叠层只算技能打中英雄（普攻不叠）；引爆的伤害算物理、算技能伤害。引爆时先告诉特效“变成 3 层”，再调 detonate，层数清零。

import * as THREE from "three";
import type { Actor } from "../actor";
import type { Ent } from "../sim";
import type { Api, Cast, HeroKit, SkillDef } from "../skills";
import { ITI_FX, type EchoFx, type FieldFx, type ItiCtx, type P2 } from "../fx_iti";
import { windup } from "../fx_fx2a";

const CRIM = 0xe0123c, BRIGHT = 0xff2a6a;
const isBuilding = (e: Ent) => e.kind === "tower" || e.kind === "core";
const v3 = () => new THREE.Vector3();

// ---- 范围和段数（和特效任务的约定，PHASE4.md 的表，不改） ----
const Q_LEN = [6, 6, 7], Q_HALF = 1.2, Q_SLAM = 5, Q_WIN = 5, Q_CD = 7;
const W_LEN = 7, W_R = 5, W_WIN = 5, W_CD = 12;
const E_RANGE = 10, E_VULN = 0.25, E_VT = 3, E_CD = 8;
const R_RANGE = 14, R_R = 11, R_N = 8, R_CORE = 4, R_CD = 45;
const P_MAX = 3, P_SEC = 5;
// ---- 手感（技能代码定的时间，特效那边接进游戏时可以照节奏改） ----
const Q_DASH = 0.2;            // 一、二段冲满 6 米用的时间（30 米/秒，冲刺本身就是那一刀）
const Q_GAP = 0.35;            // 一、二段没打中英雄：冲完以后再隔这么久才能放下一段
const Q3_MIN = 2.5;            // 三段最近冲多远（瞄得再近也要翻起来）
const Q3_KNEEL = 0.2;          // 三段落地以后单膝跪地收势的时间（这段时间锁着，动作放慢到 KNEEL_SPEED 播）
const KNEEL_SPEED = 2.4;
const W_DASH = 0.24;           // W 冲满 7 米
/** R 的时间线（出手以后第几秒）：hide 人藏起来；cut0 第一刀、gap 每刀间隔；show 在中心现身（落地动作从这一刻播）；land 落地、十字新月斩结算；end 放开 */
// iti-fx3 第二步：现身到落地从 0.14 秒拉到 0.34 秒——这是特效“收刀”的那一拍（世界再暗一档、刀网亮起来、地上升起绯月），r 动作的落地那一截（时间表里 land 之前的 0.34 秒）正好在这一拍里落下来，
// 落地那一刻十字新月斩炸开。八刀的节奏没动；不可选中跟着多 0.2 秒（到 land 后 0.03 秒）。
const R_T = { hide: 0.2, cut0: 0.26, gap: 0.14, show: 1.36, land: 1.7, end: 2.0 };

// ---- 伤害（第四阶段 iti-kit 在对局里调的，见 docs/hero_iti/kit/数值.md）。都是物理伤害：base + lv × 等级 + ad × 攻击力 ----
interface Dmg { base: number; lv: number; ad: number }
const D = {
  pop: { base: 20, lv: 6, ad: 0.15 } as Dmg,       // 被动引爆（另加已损失生命的 POP_MISS）
  q: { base: 20, lv: 8, ad: 0.5 } as Dmg,         // Q 一、二段每个
  q3: { base: 30, lv: 12, ad: 0.7 } as Dmg,       // Q 三段砸地
  w: { base: 40, lv: 10, ad: 0.4 } as Dmg,         // W 残影炸开
  e: { base: 30, lv: 8, ad: 0.5 } as Dmg,         // E 穿心
  cut: { base: 25, lv: 7, ad: 0.3 } as Dmg,        // R 每一刀
  end: { base: 200, lv: 30, ad: 1.2 } as Dmg,      // R 十字新月斩（另加已损失生命的 R_MISS，中心 4 米内乘 R_CORE_K）
};
const POP_MISS = 0.15, R_MISS = 0.25, R_CORE_K = 1.3;
const dmg = (d: Dmg, lv: number, ad: number) => d.base + d.lv * lv + d.ad * ad;
const txt = (d: Dmg) => `${d.base} + ${Math.round(d.ad * 100)}% 攻击力`;

// ---- 每个伊缇自己跨帧存的东西（a.data.iti） ----
interface Mark { e: Ent; n: number; until: number }
interface Echo { fx: EchoFx; x: number; z: number; until: number; cdEnd: number }
interface Ult { field: FieldFx; hide: boolean; p: P2; id: number }
interface State {
  marks: Map<number, Mark>;                       // 烬痕：目标 id → 层数、到什么时候过期
  q: { n: number; until: number; busy: boolean }; // n：再按 Q 放第几段（1 是新的一轮）；until：再按的窗口到什么时候；busy：这一段正在起手（窗口到了也等它出手）
  w: Echo | null;                                 // 残影
  dash: number;                                   // 冲刺（Q、W）到什么时候结束：W 换位要等冲完
  r: Ult | null;                                  // 大招进行中
  ka: number;                                     // 击杀 + 助攻记到几（-1 是还没记）
  rid: number;
}
export const st = (a: Actor): State => (a.data.iti ??= { marks: new Map(), q: { n: 1, until: 0, busy: false }, w: null, dash: 0, r: null, ka: -1, rid: 0 });
const cdOf = (me: Ent, api: Api, sec: number) => sec * (1 - api.stat(me).cdr);
/** 动作时间表里 release 之后某个时刻（land）离出手有几秒（对局时间） */
const after = (a: Actor, key: string, field: string, def: number) => { const m = (a.meta.skills as Record<string, any>)[key]; return m && typeof m[field] === "number" ? Math.max(0.05, (m[field] - m.release) / (m.speed ?? 1)) : def; };
/** 从片段的第 t 秒起播一段动作（R 落地那一截用） */
function seek(a: Actor, clip: string, t: number, speed: number) { const c = a.hero.clips.get(clip); if (!c) return; a.anim(clip, { speed, fade: 0.05 }); const act = a.hero.mixer.existingAction(c); if (act) act.time = Math.min(t, c.duration - 0.01); }
const spot = (api: Api, x: number, z: number): P2 => { const [tx, tz] = api.walkable(x, z) ? [x, z] : api.nearest(x, z); return { x: tx, z: tz }; };

// 击杀刷新（Q 回满、R 冷却缩短）的那一下：原来这里有个占位 refreshFx，iti-fx3 第二步收进了 ITI_FX.refresh

// ---------------------------------------------------------------- 被动 烬痕
/** 技能打中英雄：叠 add 层（E 对 2 层的目标是直接叠满）。叠满就引爆，返回引爆了没有 */
function stack(c: ItiCtx, e: Ent, lv: number, ad: number, add = 1): boolean {
  if (e.kind !== "hero" || !e.alive) return false;
  const { api } = c, S = st(c.a), now = api.time(), m = S.marks.get(e.id), n = Math.min(P_MAX, (m && m.until > now ? m.n : 0) + add);
  if (n < P_MAX) { S.marks.set(e.id, { e, n, until: now + P_SEC }); ITI_FX.mark(c, e, n, P_SEC); return false; }
  S.marks.delete(e.id); ITI_FX.mark(c, e, P_MAX, 0.2);
  const d = api.hit(c.me, e, dmg(D.pop, lv, ad) + POP_MISS * Math.max(0, e.max - e.hp), "phys", true);
  ITI_FX.detonate(c, e, d);
  return true;
}
const P: SkillDef = { key: "P", name: "烬痕", icon: "iti_p", cast: "passive",
  desc: `技能打中敌方英雄时留下一层烬痕（最多 ${P_MAX} 层，${P_SEC} 秒）。叠满的那一下引爆，造成 ${txt(D.pop)}（随等级提高）加目标已损失生命 ${POP_MISS * 100}% 的物理伤害。参与击杀英雄后，三叠斩立刻回满，绯月千刃剩余的冷却减少 30%。` };

// ---------------------------------------------------------------- Q 三叠斩
function qStart(c: Cast, n: number) { const S = st(c.a); S.q.busy = true; ITI_FX.qWindup(c, n, windup(c.a, n === 3 ? "q3" : "q")); }
function qFire(c: Cast, n: number) {
  const { me, a, api } = c, S = st(a), now = api.time(), x0 = a.pos.x, z0 = a.pos.z;
  const len = n === 3 ? Math.max(Q3_MIN, Math.min(Q_LEN[2], Math.hypot(c.x - x0, c.z - z0))) : Q_LEN[n - 1];      // 三段是砸地：落在瞄的地方（最远 7 米、最近 2.5 米），不然贴着人放会翻过头、砸不到他
  const [tx, tz] = api.reach(x0, z0, c.dx, c.dz, len), far = Math.hypot(tx - x0, tz - z0);
  const dur = n === 3 ? after(a, "q3", "land", 0.5) : Q_DASH * Math.max(0.35, far / len);
  // 段数和冷却：一、二段放完把冷却改成“冲完再隔一下”，打中英雄时在下面清零；三段放完进整段冷却
  if (n < 3) { S.q = { n: n + 1, until: n === 1 ? now + Q_WIN : S.q.until, busy: false }; a.setCd("Q", dur + Q_GAP); }
  else { S.q = { n: 1, until: 0, busy: false }; a.setCd("Q", cdOf(me, api, Q_CD)); }
  S.dash = now + dur; a.lock(dur + (n === 3 ? Q3_KNEEL : 0.04));
  ITI_FX.qDash(c, n, { x: x0, z: z0 }, { x: tx, z: tz }, dur);
  if (n < 3) {      // 一、二段：冲过去的路上，把起点到现在这一截直线里没砍过的都砍一下
    const done = new Set<number>(), sweep = () => {
      const gone = Math.hypot(a.pos.x - x0, a.pos.z - z0);
      for (const e of api.inLine(me, x0, z0, c.dx, c.dz, gone + 0.5, Q_HALF)) { if (done.has(e.id) || isBuilding(e)) continue; done.add(e.id);
        api.hit(me, e, dmg(D.q, c.lv, c.ad), "phys", e.kind === "hero"); ITI_FX.qHit(c, n, e);
        if (e.kind === "hero") { stack(c, e, c.lv, c.ad); if (st(a).q.n === n + 1) a.setCd("Q", 0); } }      // 打中英雄：下一段一落地就能放（被动刷新过就不管）
    };
    api.run(dur, sweep); api.dash(me, tx, tz, dur, sweep);
  } else {          // 三段：腾空翻过去，落地砸一圈
    api.dash(me, tx, tz, dur, () => {
      if (!me.alive) return; const p = { x: a.pos.x, z: a.pos.z };
      a.hero.setSpeed(KNEEL_SPEED);
      const hits = api.enemies(me, p.x, p.z, Q_SLAM).filter(e => !isBuilding(e));
      ITI_FX.qLand(c, p, Q_SLAM);
      for (const e of hits) { api.hit(me, e, dmg(D.q3, c.lv, c.ad), "phys", true); if (e.alive) api.slow(e, 0.5, 1.5); ITI_FX.qHit(c, 3, e); stack(c, e, c.lv, c.ad); }
    });
  }
}
const qEnd = (c: Cast) => { st(c.a).q.busy = false; };
const qBase = { key: "Q" as const, icon: "iti_q", cast: "dir" as const, width: Q_HALF * 2, cd: Q_CD, tapAim: "move" as const, end: qEnd };
const Q2: SkillDef = { ...qBase, name: "三叠斩 · 二段", range: Q_LEN[1], desc: "", start: c => qStart(c, 2), fire: c => qFire(c, 2) };
const Q3: SkillDef = { ...qBase, name: "三叠斩 · 三段", range: Q_LEN[2], clip: "q3", desc: "", start: c => qStart(c, 3), fire: c => qFire(c, 3) };
const Q: SkillDef = { ...qBase, name: "三叠斩", range: Q_LEN[0], mana: 40,
  desc: `${Q_WIN} 秒内可以放三次。一、二段朝一个方向低身冲 ${Q_LEN[0]} 米，砍穿路上的所有敌人，造成 ${txt(D.q)} 的物理伤害；第三段腾空翻身跃向目标地点（最远 ${Q_LEN[2]} 米），落地砸地，对周围 ${Q_SLAM} 米造成 ${txt(D.q3)} 的物理伤害并减速 50%，持续 1.5 秒（伤害随等级提高）。每段打中英雄，下一段可以马上放。三段放完或超时后进入冷却。`,
  alt: ({ a, api }) => { const s = st(a).q; return s.n > 1 && api.time() <= s.until ? (s.n === 2 ? Q2 : Q3) : null; },
  recast: ({ a, now }) => { const s = st(a).q; return s.n > 1 && now <= s.until ? { n: s.n, of: 3, left: s.until - now, dur: Q_WIN } : null; },
  start: c => qStart(c, 1), fire: c => qFire(c, 1) };

// ---------------------------------------------------------------- W 残焰
/** 残影炸开：p 是炸的地方（换位时是她刚才站的地方，不换就是残影原地） */
function burst(c: ItiCtx, w: Echo, p: P2) {
  const { me, a, api } = c, S = st(a), lv = me.h?.level ?? 1, ad = api.stat(me).ad;
  const hits = api.enemies(me, p.x, p.z, W_R).filter(e => !isBuilding(e));
  for (const e of hits) { api.hit(me, e, dmg(D.w, lv, ad), "phys", e.kind === "hero"); stack(c, e, lv, ad); }
  ITI_FX.wBurst(c, p, W_R, hits); w.fx.remove();
  if (S.w === w) S.w = null; a.setCd("W", Math.max(0, w.cdEnd - api.time()));
}
const W2: SkillDef = { key: "W", name: "残焰 · 换位", icon: "iti_w", cast: "self", instant: true, cd: W_CD, desc: "",
  ready: ({ a, api }) => { const S = st(a); return !!S.w && api.time() >= S.dash && !S.r; },      // 冲刺途中、大招里不能换（按下会排在后面）
  fire(c) {
    const { me, a, api } = c, w = st(a).w; if (!w) return; const from = { x: a.pos.x, z: a.pos.z }, to = { x: w.x, z: w.z };
    ITI_FX.wSwap(c, from, to); api.blink(me, to.x, to.z); w.fx.move(from.x, from.z); burst(c, w, from);
  } };
const W: SkillDef = { key: "W", name: "残焰", icon: "iti_w", cast: "dir", range: W_LEN, width: 1.4, cd: W_CD, mana: 60, tapAim: "move",
  desc: `原地留下一个绯焰残影，自己朝一个方向冲 ${W_LEN} 米。${W_WIN} 秒内再按一次：和残影换位，残影在你刚才站的地方炸开，对周围 ${W_R} 米造成 ${txt(D.w)} 的物理伤害（随等级提高）；不换的话 ${W_WIN} 秒后残影在原地自己炸开。`,
  alt: ({ a }) => (st(a).w ? W2 : null),
  recast: ({ a, now }) => { const w = st(a).w; return w ? { n: 2, of: 2, left: Math.max(0, w.until - now), dur: W_WIN, label: "换" } : null; },
  fire(c) {
    const { me, a, api } = c, S = st(a), now = api.time(), x0 = a.pos.x, z0 = a.pos.z, [tx, tz] = api.reach(x0, z0, c.dx, c.dz, W_LEN), dur = W_DASH * Math.max(0.4, Math.hypot(tx - x0, tz - z0) / W_LEN);
    S.w?.fx.remove();
    S.w = { fx: ITI_FX.wEcho(c, { x: x0, z: z0 }, Math.atan2(c.dx, c.dz)), x: x0, z: z0, until: now + W_WIN, cdEnd: now + cdOf(me, api, W_CD) };
    a.setCd("W", dur + 0.1);      // 冲完才能换位
    ITI_FX.wDash(c, { x: x0, z: z0 }, { x: tx, z: tz }, dur);
    S.dash = now + dur; a.lock(dur + 0.04); api.dash(me, tx, tz, dur);
  } };

// ---------------------------------------------------------------- E 影步 · 穿心
const E: SkillDef = { key: "E", name: "影步 · 穿心", icon: "iti_e", cast: "unit", target: "enemy", range: E_RANGE, cd: E_CD, mana: 50,
  desc: `闪到 ${E_RANGE} 米内一个敌人的身后反手一刺，造成 ${txt(D.e)} 的物理伤害（随等级提高），它 ${E_VT} 秒内受到的伤害提高 ${E_VULN * 100}%。目标已有 2 层烬痕时，这一刺直接叠满引爆。`,
  start(c) { const e = c.unit; if (!e || isBuilding(e)) { c.data.cancel = true; c.a.finish(); c.a.stop(); } },      // 点到塔、水晶：不放（还没出手，冷却和法力都没花）
  fire(c) {
    const { me, a, api } = c, e = c.unit; if (c.data.cancel || !e || !e.alive || !api.canHit(me, e)) return;
    const from = { x: a.pos.x, z: a.pos.z }, l = Math.hypot(e.x - from.x, e.z - from.z) || 1, ux = (e.x - from.x) / l, uz = (e.z - from.z) / l, off = e.r + 0.9;
    const to = api.walkable(e.x + ux * off, e.z + uz * off) ? { x: e.x + ux * off, z: e.z + uz * off } : spot(api, e.x - uz * off, e.z + ux * off);      // 身后站不了人就站侧面
    ITI_FX.eBlink(c, from, to, e); api.blink(me, to.x, to.z); a.face(e.x, e.z, true);
    const S = st(a), m = S.marks.get(e.id), two = e.kind === "hero" && !!m && m.until > api.time() && m.n >= 2;
    api.hit(me, e, dmg(D.e, c.lv, c.ad), "phys", true); if (e.alive) api.expose(e, E_VULN, E_VT);
    ITI_FX.eStab(c, e, two && e.alive);
    stack(c, e, c.lv, c.ad, two ? P_MAX : 1);
    api.after(0.22, () => { if (!c.data.done) a.finish(); });      // 收招不拖人：0.22 秒后放开，控制器接着砍它（begin 时已经把它记成普攻目标）
  },
  end(c) { c.data.done = true; } };

// ---------------------------------------------------------------- R 绯月千刃
const R: SkillDef = { key: "R", name: "绯月千刃", icon: "iti_r", cast: "point", range: R_RANGE, radius: R_R, cd: R_CD, mana: 100, minLevel: 6,
  desc: `跃起消失，在落点 ${R_R} 米内的敌人之间来回闪砍 ${R_N} 刀（优先英雄），每刀造成 ${txt(D.cut)} 的物理伤害并留下烬痕；最后落回中心，十字新月斩炸开，对范围内的敌人造成 ${txt(D.end)}（伤害随等级提高）加目标已损失生命 ${R_MISS * 100}% 的物理伤害，中心 ${R_CORE} 米内再提高 ${Math.round((R_CORE_K - 1) * 100)}%。期间不能被选中。`,
  fire(c) {
    const { me, a, api } = c, S = st(a), p = spot(api, c.x, c.z), id = ++S.rid, lv = c.lv, ad = c.ad;
    me.untarget = true; a.lock(R_T.end);
    const U: Ult = { field: ITI_FX.rStart(c, p, R_R, R_N), hide: false, p, id }; S.r = U;
    const live = () => S.r === U && me.alive;
    // 藏起来：人移到落点中心（镜头跟着人，就停在大招的范围上）
    api.after(R_T.hide, () => { if (!live()) return; U.hide = true; api.blink(me, p.x, p.z); });
    // 八刀：轮着砍范围里的英雄（砍得少的、血少的先砍，不连着砍同一个），没有英雄砍小兵野怪，什么都没有就空砍
    const cuts = new Map<number, number>(); let last: Ent | null = null, at: P2 = { x: a.pos.x, z: a.pos.z };
    for (let k = 0; k < R_N; k++) api.after(R_T.cut0 + k * R_T.gap, () => {
      if (!live()) return;
      const pool = api.enemies(me, p.x, p.z, R_R).filter(e => !isBuilding(e)), heroes = pool.filter(e => e.kind === "hero"), list = heroes.length ? heroes : pool;
      const score = (e: Ent) => (cuts.get(e.id) ?? 0) + (e === last && list.length > 1 ? 10 : 0) + 0.5 * e.hp / e.max;
      const e = list.sort((x, y) => score(x) - score(y))[0] ?? null, from = at;
      if (!e) { const an = Math.random() * 6.2832, rr = R_R * (0.25 + 0.5 * Math.random()); at = spot(api, p.x + Math.sin(an) * rr, p.z + Math.cos(an) * rr); ITI_FX.rSlash(c, k, from, at, null); return; }
      const an = Math.atan2(e.x - from.x, e.z - from.z) + (Math.random() - 0.5) * 2.0; at = spot(api, e.x + Math.sin(an) * (e.r + 1.2), e.z + Math.cos(an) * (e.r + 1.2));      // 从上一刀的地方穿过它，落在它另一边
      ITI_FX.rSlash(c, k, from, at, e);
      api.hit(me, e, dmg(D.cut, lv, ad), "phys", true); stack(c, e, lv, ad);
      cuts.set(e.id, (cuts.get(e.id) ?? 0) + 1); last = e;
    });
    // 现身：在中心，从 r 动作落地前那一截起播
    api.after(R_T.show, () => { if (!live()) return; U.hide = false; api.blink(me, p.x, p.z); const m = (a.meta.skills as Record<string, any>).r, sp = m?.speed ?? 1.6; if (m?.land) seek(a, "r", m.land - (R_T.land - R_T.show) * sp, sp);
      ITI_FX.rGather(c, p, R_R, R_T.land - R_T.show); });      // 特效的“收刀”一拍：现身到落地这 0.34 秒
    // 落地：十字新月斩
    api.after(R_T.land, () => {
      if (!live()) return;
      const hits = api.enemies(me, p.x, p.z, R_R).filter(e => !isBuilding(e));
      for (const e of hits) { const core = Math.hypot(e.x - p.x, e.z - p.z) <= R_CORE + e.r ? R_CORE_K : 1;
        api.hit(me, e, (dmg(D.end, lv, ad) + R_MISS * Math.max(0, e.max - e.hp)) * core, "phys", true); stack(c, e, lv, ad); }
      ITI_FX.rFinale(c, p, R_R, hits);
      api.after(0.03, () => { if (S.r === U) me.untarget = false; });
    });
  },
  end(c) { const S = st(c.a), U = S.r; if (U) { S.r = null; U.field.end(); } c.me.untarget = false; } };

/** 电脑用：一发大招大概能在 e 身上打多少（八刀全砍它，加收尾；不算护甲、不算引爆）。bot.ts 拿它判断能不能收人头 */
export function itiUltEstimate(me: Ent, e: Ent, api: Api): number {
  const lv = me.h?.level ?? 1, ad = api.stat(me).ad, cut = dmg(D.cut, lv, ad) * R_N, rest = Math.max(0, e.hp - cut);
  return cut + dmg(D.end, lv, ad) + R_MISS * (e.max - rest);
}

export const iti: HeroKit = {
  id: "iti", name: "伊缇", title: "绯刃", role: "刺客", side: 1, color: CRIM, color2: BRIGHT, height: 3.4,
  look: { scarf: 1, lift: 1.5, fill: 0.8 },      // 提亮（第四阶段）：深紫灰的甲在对局里比岚暗约一成（亮度中位数 0.47 对 0.56），提亮 1.4 → 1.5、补光 0.5 → 0.8 以后 0.51，再亮紫色就发灰（docs/hero_iti/kit/pop/）
  base: { hp: 3300, mana: 620, ad: 170, ap: 0, armor: 28, mr: 25, ms: 6.1, as: 1.2, range: 2.2, cdr: 0, ls: 0, hpRegen: 0.006, manaRegen: 0.013 },
  skills: [P, Q, W, E, R],
  attack(c) { ITI_FX.attack(c, c.target, c.a.hero.current === "attack2" ? 1 : 0); },
  passive(c) {
    const { me, a, api } = c, S = st(a), now = api.time();
    // 大招里人藏着（控制器每帧按视野设一次可见，这里在它之后盖掉）
    if (S.r?.hide) a.hero.group.visible = false;
    // 参与击杀：Q 回满，R 剩下的冷却减 30%
    const ka = (me.h?.kills ?? 0) + (me.h?.assists ?? 0);
    if (S.ka < 0) S.ka = ka;
    else if (ka > S.ka) { const n = ka - S.ka; S.ka = ka; S.q = { n: 1, until: 0, busy: false }; a.setCd("Q", 0); a.setCd("R", a.cdLeft("R") * Math.pow(0.7, n)); if (me.alive) ITI_FX.refresh(c); }
    // Q 的窗口过了：进整段冷却
    if (S.q.n > 1 && now > S.q.until && !S.q.busy) { S.q = { n: 1, until: 0, busy: false }; a.setCd("Q", cdOf(me, api, Q_CD)); }
    // 残影：阵亡就收掉；到时间在原地炸
    const w = S.w;
    if (w && !me.alive) { w.fx.remove(); S.w = null; a.setCd("W", Math.max(0, w.cdEnd - now)); }
    else if (w && now >= w.until) burst(c, w, { x: w.x, z: w.z });
    // 烬痕过期、目标死了：告诉特效收掉头顶的记号
    for (const [id, m] of S.marks) if (m.until <= now || !m.e.alive) { S.marks.delete(id); ITI_FX.mark(c, m.e, 0, 0); }
  },
};
