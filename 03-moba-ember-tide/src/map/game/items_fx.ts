// 装备的被动（第九轮）：items.ts 里写的“被动”在这里实现。规则那边（sim.ts）只在四个地方调过来：
//   pre   伤害结算之前（还没算护甲、魔抗）：暴击、穿甲穿法、淬火（放技能后下一下普攻加伤）、伏击、铁砧靴减普攻伤害
//   post  扣完血以后：普攻叠层、第三下真伤、溅射、反伤、技能点燃 / 回响、低血护盾、斩杀
//   die   一个单位死了：击杀 / 助攻刷新
//   tick  每一步：光环、炉膛、护潮、渐狂掉层、韧性和被控护盾、放技能（从 sim.events 里的 cast 认出来）、处理排队的附加伤害
// 坑：post 是在 damage() 里面调的，在这里直接对同一个目标再打一下（溅射、回响、斩杀），它会死两遍（死亡结算跑两次）。
// 所以附加伤害都先排进队列，tick 里统一打——晚一步，二十分之一秒以内，看不出来。打这些附加伤害时 inProc 为真：它们本身不再触发别的被动（不然回响打出回响）。
// 画面用 skills.ts 的 Api（fxlib 的现成零件），在 createSkills 里绑定。只画玩家看得见的（我方的、视野里的）。

import type { DmgOpts, DmgType, Ent, Sim } from "./sim";
import { RULES } from "./sim";
import type { Api } from "./skills";
import { SPR } from "./fxlib";
import { itemOf } from "./items";

export interface ItemHooks {
  pre: (e: Ent, dmg: number, src: Ent | null, o: DmgOpts, type: DmgType) => number;
  post: (e: Ent, dmg: number, src: Ent | null, o: DmgOpts, type: DmgType) => void;
  die: (e: Ent, src: Ent | null) => void;
  tick: (dt: number) => void;
}

/** 一个英雄身上和装备被动有关的状态 */
interface St {
  key: string; has: Set<string>;
  ex: { crit: number; critDmg: number; apen: number; mpen: number; mpenPct: number; ten: number };
  cd: Record<string, number>;       // 各个被动下一次能触发的时间
  fury: number; furyT: number;      // 渐狂的层数、到什么时候清空
  hits: number;                     // 三连：第几下普攻了
  sheen: number;                    // 淬火 / 三锻：到什么时候之前下一下普攻加伤（0 是没有）
  heroAt: number;                   // 伏击：上一次伤害到敌方英雄的时间
  tenT: number;                     // 锚定：到什么时候之前多 30% 韧性
  cc: Record<string, number>; kb: boolean;      // 上一步身上各种控制还剩几秒（认“新上的控制”用）；上一步是不是正被击飞 / 拉拽
  furnT: number; auraT: number;
}
const CC = ["stun", "root", "taunt", "silence", "slow"] as const;
const HARD = new Set(["stun", "root", "taunt"]);
const isB = (e: Ent) => e.kind === "tower" || e.kind === "core";
const TEAL = 0x7fe9e4, EMBER = 0xff8a2e, BRASS = 0xe9b765, BRONZE = 0xc9a25e, ABYSS = 0x8c96ff, BLOOD = 0xe2584a;

let cur: { S: Map<number, St>; sim: Sim } | null = null;

/** 界面用：装备格上该显示的层数 / 冷却。n 层数；cd 还剩几秒、max 一共几秒 */
export function itemBadge(e: Ent, id: string): { n?: number; cd?: number; max?: number } | null {
  const s = cur?.S.get(e.id); if (!s || !cur) return null; const now = cur.sim.time;
  if (id === "fury") return s.fury ? { n: s.fury } : null;
  if (id === "harpoon") return s.hits % 3 ? { n: s.hits % 3 } : null;
  if ((id === "forge" || id === "trinity") && s.sheen > now) return { n: 1 };
  const max = ({ ambush: 8, anchor: 45, bulwark: 18, locket: 20, horn: 8, abyss: 6 } as Record<string, number>)[id];
  if (max && (s.cd[id] ?? 0) > now) return { cd: s.cd[id] - now, max };
  return null;
}

/** createSkills 里调一次：把被动挂到规则上，并拿到画特效用的 Api */
export function bindItems(sim: Sim, api: Api) {
  const S = new Map<number, St>(); cur = { S, sim };
  const now = () => sim.time;
  const st = (e: Ent): St | null => {
    const h = e.h; if (!h) return null; let s = S.get(e.id);
    if (!s) { s = { key: "?", has: new Set(), ex: { crit: 0, critDmg: 0, apen: 0, mpen: 0, mpenPct: 0, ten: 0 }, cd: {}, fury: 0, furyT: 0, hits: 0, sheen: 0, heroAt: -99, tenT: 0, cc: {}, kb: false, furnT: 0, auraT: 0 }; S.set(e.id, s); }
    const key = h.items.join(",");
    if (s.key !== key) { s.key = key; s.has = new Set(h.items); const x = s.ex; x.crit = x.critDmg = x.apen = x.mpen = x.mpenPct = x.ten = 0;
      for (const id of h.items) { const v = itemOf(id)?.ex; if (!v) continue; x.crit += v.crit ?? 0; x.critDmg += v.critDmg ?? 0; x.apen += v.apen ?? 0; x.mpen += v.mpen ?? 0; x.mpenPct = Math.max(x.mpenPct, v.mpenPct ?? 0); x.ten += v.ten ?? 0; }
      x.crit = Math.min(1, x.crit); x.ten = Math.min(0.6, x.ten); }
    return s;
  };
  const baseAd = (e: Ent) => e.h!.base.ad * (1 + RULES.hero.perLevel * (e.h!.level - 1));
  const bonusAd = (e: Ent) => Math.max(0, e.h!.stat.ad - baseAd(e));
  const seen = (e: Ent) => e.team === 0 || e.seen;
  const P = (e: Ent, up = 1.2) => api.pos(e, up);
  const buff = (e: Ent, id: string, sec: number, m: Parameters<Api["buff"]>[3]) => { const v = e.h?.mods.get(id); if (v && JSON.stringify(v.m) === JSON.stringify(m)) v.left = Math.max(v.left, sec); else api.buff(e, id, sec, m); };
  const shield = (e: Ent, n: number, sec: number) => { e.shield = Math.max(e.shield, n); e.shieldT = Math.max(e.shieldT, sec); };

  // ---- 排队的附加伤害 ----
  interface Q { e: Ent; src: Ent | null; n: number; type: DmgType; big?: boolean; fx?: () => void }
  const queue: Q[] = []; let inProc = false;
  const later = (q: Q) => { if (q.n > 0.5) queue.push(q); };
  const burns = new Map<string, { e: Ent; src: Ent; n: number; acc: number }>();      // 余烬：还剩几跳（每半秒一跳，三秒六跳）。按跳数算，不按剩几秒：浮点误差会让最后一跳和“到点删掉”撞在同一步，少烧一跳
  const execs = new Set<number>();

  // ---- 小特效（都很短、很小，不留常亮的光） ----
  const fxRing = (e: Ent, r: number, color: number, life = 0.45) => { if (seen(e)) api.fx.ring(e.x, e.z, r, color, life); };
  const fxSpark = (e: Ent, color: number, size = 0.8) => { if (seen(e)) api.fx.impact(P(e), { color, size, sparks: 5 }); };
  const fxText = (e: Ent, s: string, color: string) => { if (seen(e)) api.fx0.text(P(e, 2.6), s, true, color); };
  const fxShield = (e: Ent, color: number) => { if (!seen(e)) return; api.fx.ring(e.x, e.z, 1.4, color, 0.6); api.fx.burst({ pos: P(e, 1.1), n: 8, sprite: SPR.glint, add: true, color, size: [0.18, 0.3], life: [0.3, 0.5], speed: [0.6, 1.4], ringR: 0.7, up: 0.6 }); };

  const hooks = {
    pre(e: Ent, dmg: number, src: Ent | null, o: DmgOpts, type: DmgType): number {
      let d = dmg; const a = src && src.h ? st(src) : null, v = e.h ? st(e) : null, atk = !!a && !o.skill && type === "phys", t = now();
      if (a && src && !inProc) {
        if (atk) {
          // 淬火 / 三锻：放过技能以后的第一下普攻
          if (a.sheen > t && t >= (a.cd.sheen ?? 0)) { const k = a.has.has("trinity") ? 1.6 : a.has.has("forge") ? 1.0 : 0;
            if (k) { d += baseAd(src) * k * (e.h && src.team !== e.team ? RULES.pvp : 1); a.sheen = 0; a.cd.sheen = t + 1.5; o.big = true; if (seen(e)) api.fx.impact(P(e), { color: EMBER, color2: 0xfff0c8, size: 1.1, sparks: 8 }); } }
          // 暴击
          if (a.ex.crit > 0 && Math.random() < a.ex.crit) { d *= 1.75 + a.ex.critDmg; o.big = true; if (a.ex.critDmg > 0) fxSpark(e, EMBER, 1.0); }
        }
        // 伏击：好一阵没打过英雄，这一下附带一截物理伤害（排队打，它自己也吃护甲）
        if (e.h && e.team !== src.team && a.has.has("ambush") && t - a.heroAt > 4 && t >= (a.cd.ambush ?? 0)) { a.cd.ambush = t + 8;
          later({ e, src, n: 80 + 0.4 * bonusAd(src), type: "phys", big: true, fx: () => { if (seen(e)) { api.fx.slash({ pos: P(e, 1.3), yaw: src.yaw, r: 1.3, color: TEAL, color2: 0x0d3b40, life: 0.28 }); api.fx.impact(P(e), { color: TEAL, size: 1.0, sparks: 6 }); } } }); }
      }
      if (a && src && e.h && e.team !== src.team) a.heroAt = t;
      // 穿甲、穿法：先按百分比、再减点数（照 LoL）；等价成把伤害乘回去（规则那边接着按原来的护甲算）
      if (a && type !== "true") { const res = type === "phys" ? e.armor : e.mr; if (res > 0) { const pct = type === "magic" ? a.ex.mpenPct : 0, flat = type === "phys" ? a.ex.apen : a.ex.mpen;
        if (pct || flat) d *= (100 + res) / (100 + Math.max(0, res * (1 - pct) - flat)); } }
      // 铁砧靴：普攻（小兵、野怪、英雄的）伤害少一成，塔的不算
      if (v && src && !o.skill && !isB(src) && v.has.has("boots_ar")) d *= 0.9;
      return d;
    },

    post(e: Ent, dmg: number, src: Ent | null, o: DmgOpts, type: DmgType) {
      const a = src && src.h ? st(src) : null, v = e.h ? st(e) : null, atk = !!a && !o.skill && type === "phys", t = now();
      if (a && src && !inProc && src.team !== e.team) {
        if (atk) {
          if (!isB(e)) {
            // 涨潮 / 三锻：普攻打中加移速
            const rush = a.has.has("trinity") ? 0.6 : a.has.has("great") ? 0.5 : 0; if (rush) buff(src, "it_rush", 2, { ms: src.range > 4 ? rush / 2 : rush });
            // 浪斩：溅射
            if (a.has.has("tide")) { const k = src.range > 4 ? 0.2 : 0.4, n = src.h!.stat.ad * k; let any = false;
              for (const x of sim.ents) { if (x === e || !x.alive || x.team === src.team || isB(x) || x.untarget || Math.hypot(x.x - e.x, x.z - e.z) > 3 + x.r || !api.canHit(src, x)) continue; later({ e: x, src, n, type: "phys" }); any = true; }
              if (any && seen(e)) api.fx.slash({ pos: P(e, 1.0), yaw: Math.atan2(e.x - src.x, e.z - src.z) + Math.PI / 2, r: 2.6, width: 0.5, arc: 2.4, color: TEAL, color2: 0xe9fffb, life: 0.25, alpha: 0.7 }); }
          }
          // 三连：第三下真伤
          if (a.has.has("harpoon")) { a.hits++; if (a.hits % 3 === 0) later({ e, src, n: 50 + 0.5 * bonusAd(src), type: "true", fx: () => { if (seen(e)) { api.fx.impact(P(e), { color: BRASS, color2: 0xffffff, size: 1.0, sparks: 6 }); api.fx.ring(e.x, e.z, 1.1, BRASS, 0.35); } } }); }
          // 渐狂：叠攻速，满层附带魔法伤害
          if (a.has.has("fury")) { a.fury = Math.min(6, a.fury + 1); a.furyT = t + 3; buff(src, "it_fury", 3.2, { asMul: 1 + 0.06 * a.fury });
            if (a.fury >= 6 && !isB(e)) later({ e, src, n: 30 + 0.15 * bonusAd(src), type: "magic", fx: () => { if (seen(e)) api.fx.burst({ pos: P(e), n: 6, sprite: SPR.ember, add: true, color: [0xffd27a, BLOOD], size: [0.1, 0.18], life: [0.25, 0.45], speed: [1, 2.5] }); } }); }
        }
        if (o.skill && !isB(e)) {
          // 余烬：技能点燃
          if (a.has.has("ember")) { const k = e.id + ":" + src.id, b = burns.get(k); if (b) b.n = 6; else burns.set(k, { e, src, n: 6, acc: 0 }); }
          // 回响：技能打到英雄，弹到身边两个
          if (e.h && a.has.has("abyss") && t >= (a.cd.abyss ?? 0)) { a.cd.abyss = t + 6; const n = 70 + 0.15 * src.h!.stat.ap;
            const more = sim.ents.filter(x => x !== e && x.alive && x.team !== src.team && !isB(x) && Math.hypot(x.x - e.x, x.z - e.z) <= 5 + x.r && api.canHit(src, x)).sort((p, q) => Math.hypot(p.x - e.x, p.z - e.z) - Math.hypot(q.x - e.x, q.z - e.z)).slice(0, 2);
            later({ e, src, n, type: "magic", fx: () => { if (!seen(e)) return; api.fx.flash(P(e), ABYSS, 1.2, 0.18); api.fx.ring(e.x, e.z, 1.6, ABYSS, 0.5);
              for (const x of more) { const b = api.fx.beam({ color: ABYSS, width: 0.12, life: 0.28 }); b.set(P(e), P(x)); } } });
            for (const x of more) later({ e: x, src, n, type: "magic", fx: () => { if (seen(x)) api.fx.impact(P(x), { color: ABYSS, size: 0.8, sparks: 4 }); } }); }
        }
        // 断首：打到 6% 以下直接斩杀
        if (e.h && e.alive && e.hp > 0 && e.hp < e.max * 0.06 && a.has.has("reaper") && !execs.has(e.id)) { execs.add(e.id);
          later({ e, src, n: e.hp + 50, type: "true", big: true, fx: () => { if (seen(e)) { api.fx.slash({ pos: P(e, 1.4), yaw: src.yaw, r: 1.6, width: 0.7, color: BLOOD, color2: 0xffe0c0, life: 0.35 }); fxText(e, "斩杀", "#ff8a7a"); } } }); }
      }
      if (v && e.alive && e.hp > 0) {
        // 倒刺：被普攻反伤（对小兵、野怪减半）；鲸骨棘甲还让打你的英雄攻速变慢
        if (src && !o.skill && !isB(src) && src.alive && src.team !== e.team && (v.has.has("thorn") || v.has.has("mail"))) { const big = v.has.has("thorn"), n = (big ? 30 + 0.25 * e.armor : 15 + 0.1 * e.armor) * (src.h ? 1 : 0.5);
          later({ e: src, src: e, n, type: "magic", fx: () => { if (seen(src)) api.fx.burst({ pos: P(src), n: 4, sprite: SPR.shard, color: [0xf2ead8, 0x9a907a], size: [0.08, 0.14], life: [0.25, 0.4], speed: [1.5, 3] }); } });
          if (big && src.h) buff(src, "it_chill", 2, { asMul: 0.8 }); }
        // 回潮：挨了英雄的打，回血加快
        if (src && src.h && src.team !== e.team && v.has.has("scale")) buff(e, "it_scale", 5, { hpRegen: 0.01 });
        // 锚定：低血护盾
        if (v.has.has("anchor") && e.hp < e.max * 0.35 && t >= (v.cd.anchor ?? 0)) { v.cd.anchor = t + 45; v.tenT = t + 4; shield(e, e.max * 0.25, 4); fxShield(e, BRONZE); }
      }
    },

    die(e: Ent, src: Ent | null) {
      for (const [k, b] of burns) if (b.e === e) burns.delete(k);
      if (!e.h) return;
      // 猎杀：击杀和助攻（最近十秒打过他的）都算
      const ids = new Set([...e.h.hitBy].filter(([, t0]) => now() - t0 <= RULES.kill.window).map(([id]) => id)); if (src && src.h && src.team !== e.team) ids.add(src.id);
      for (const p of sim.ents) { if (!ids.has(p.id) || !p.h || !p.alive || p.team === e.team) continue; const s = st(p); if (!s || !s.has.has("hunter")) continue;
        const ac = api.actor(p); if (ac) for (const k of ["Q", "W", "E"] as const) ac.setCd(k, 0);
        buff(p, "it_hunt", 3, { msMul: 1.3 }); if (seen(p)) { api.fx.ring(p.x, p.z, 1.8, TEAL, 0.5); fxText(p, "刷新", "#9ff3ec"); } }
    },

    tick(dt: number) {
      const t = now();
      // 放技能：cast 事件是英雄的控制器在这一步之前推进来的（画面那边每帧读完才清空），每个只认一次
      for (const ev of sim.events) { if (ev.t !== "cast" || casts.has(ev)) continue; casts.add(ev); const e = ev.e, s = st(e); if (!s) continue;
        if (s.has.has("trinity") || s.has.has("forge")) s.sheen = t + 10;
        if (s.has.has("horn") && t >= (s.cd.horn ?? 0)) { let any = false;
          for (const p of sim.ents) { if (p === e || !p.h || !p.alive || p.team !== e.team || Math.hypot(p.x - e.x, p.z - e.z) > 8) continue; buff(p, "it_surge", 4, { asMul: 1.25, ms: 0.8 }); fxRing(p, 1.2, TEAL, 0.5); any = true; }
          if (any) { s.cd.horn = t + 8; fxRing(e, 2.2, TEAL, 0.6); } } }
      // 排队的附加伤害
      if (queue.length) { const list = queue.splice(0); inProc = true;
        for (const q of list) { if (!q.e.alive) continue; sim.damage(q.e, q.n, q.src, { type: q.type, skill: true, big: q.big }); q.fx?.(); }
        inProc = false; execs.clear(); }
      // 余烬：每半秒烧一下
      for (const [k, b] of burns) { b.acc += dt;
        if (b.acc >= 0.5 - 1e-6) { b.acc -= 0.5; b.n--; if (b.e.alive) { let dps = 20 + 0.012 * b.e.max; if (b.e.kind === "monster") dps = Math.min(dps, 80); inProc = true; sim.damage(b.e, dps * 0.5, b.src, { type: "magic", skill: true }); inProc = false;
          if (seen(b.e)) api.fx.burst({ pos: P(b.e, 1.0), n: 3, sprite: SPR.ember, add: true, color: [0xffc070, EMBER], size: [0.06, 0.12], life: [0.4, 0.7], speed: [0.3, 0.9], up: 1.4, radius: 0.4 }); } }
        if (b.n <= 0 || !b.e.alive) burns.delete(k); }
      for (const e of sim.ents) {
        if (!e.h) continue; const s = st(e)!; if (!e.alive) { s.fury = 0; s.kb = false; continue; }
        // 渐狂：三秒不打就清空
        if (s.fury && t > s.furyT) { s.fury = 0; api.unbuff(e, "it_fury"); }
        // 韧性和钟鸣：认出这一步新上的控制。缩短它的时间；硬控（眩晕、定身、嘲讽、击飞）给钟鸣的护盾
        const ten = Math.min(0.6, s.ex.ten + (s.tenT > t ? 0.3 : 0)), bell = s.has.has("bulwark"); let hard = false;
        if (ten > 0 || bell) for (const f of CC) { const was = s.cc[f] ?? 0, base = Math.max(0, was - dt); if (e[f] > base + 0.02) { if (ten > 0) e[f] = base + (e[f] - base) * (1 - ten); if (HARD.has(f)) hard = true; } s.cc[f] = e[f]; }
        const kb = api.actor(e)?.state() === "stun" && e.stun <= 0; if (kb && !s.kb) hard = true; s.kb = kb;      // 击飞、拉拽：英雄的位移归控制器管，身上的 stun 是 0，状态是 stun
        if (hard && bell && t >= (s.cd.bulwark ?? 0)) { s.cd.bulwark = t + 18; shield(e, e.max * 0.12, 3); fxShield(e, BRONZE); }
        // 炉膛：每秒烧一圈。野怪只烧已经在打的（不然坦克路过野区就把整窝怪拉起来）
        if (s.has.has("furnace") && (s.furnT -= dt) <= 0) { s.furnT = 1; const n = 20 + 0.01 * e.max; let any = false; inProc = true;
          for (const x of [...sim.ents]) { if (!x.alive || x.team === e.team || isB(x) || (x.kind === "monster" && x.fight <= 0) || Math.hypot(x.x - e.x, x.z - e.z) > 3.5 + x.r || !api.canHit(e, x)) continue; sim.damage(x, x.kind === "monster" ? n * 1.5 : n, e, { type: "magic", skill: true }); any = true; }      /* 对野怪多五成（坦克打野）；对小兵不加：原来也多五成，葛隆中路推得太快 */
          inProc = false;
          if (any && seen(e)) api.fx.burst({ pos: { x: e.x, y: api.fx.ground(e.x, e.z) + 0.2, z: e.z }, n: 7, sprite: SPR.ember, add: true, color: [0xffc070, EMBER], size: [0.07, 0.13], life: [0.6, 1.0], speed: [0.3, 0.8], up: 1.6, ringR: 2.2 }); }
        if ((s.auraT -= dt) <= 0) { s.auraT = 0.5;
          // 庇护：光环
          if (s.has.has("banner")) for (const p of sim.ents) if (p !== e && p.h && p.alive && p.team === e.team && Math.hypot(p.x - e.x, p.z - e.z) <= 10) buff(p, "it_banner", 1, { armor: 15, mr: 15 });
          // 护潮：身边谁血少给谁套盾
          if (s.has.has("locket") && t >= (s.cd.locket ?? 0)) { const p = sim.ents.filter(p => p.h && p.alive && p.team === e.team && Math.hypot(p.x - e.x, p.z - e.z) <= 9 && p.hp < p.max * 0.4).sort((a, b) => a.hp / a.max - b.hp / b.max)[0];
            if (p) { s.cd.locket = t + 20; shield(p, 180 + 25 * e.h.level, 3); fxShield(p, TEAL); } } }
      }
    },
  };
  const casts = new WeakSet<object>();
  sim.itemFx = hooks;
}

// 测试脚本用：装备格上的层数 / 冷却
if (typeof window !== "undefined") (window as any).__itemfx = { badge: itemBadge };
