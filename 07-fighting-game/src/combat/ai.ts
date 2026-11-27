import { Rng } from '../core/math';
import type { Fighter, Match } from './sim';
import { emptyCmd } from './types';
import type { Btn, Cmd, InputSource, MoveDef } from './types';

/** 一步宏：按住这些键 f 帧。x 是相对朝向的方向：1 向前、-1 向后。 */
interface Step { f: number; x?: number; y?: number; b?: Btn[] }

const tap = (b: Btn, x = 0, y = 0): Step => ({ f: 2, b: [b], x, y });
const wait = (f: number, x = 0): Step => ({ f, x });

interface Tuning { react: number; block: number; antiAir: number; punish: number; combo: number; idle: number; aggression: number; superSmart: number }
const LEVELS: Record<number, Tuning> = {
  1: { react: 15, block: 0.28, antiAir: 0.1, punish: 0.25, combo: 0.35, idle: 0.45, aggression: 0.5, superSmart: 0.2 },
  2: { react: 9, block: 0.55, antiAir: 0.35, punish: 0.6, combo: 0.7, idle: 0.2, aggression: 0.7, superSmart: 0.6 },
  3: { react: 5, block: 0.82, antiAir: 0.65, punish: 0.9, combo: 0.95, idle: 0.06, aggression: 0.85, superSmart: 0.95 },
};

/**
 * 电脑对手。和人一样只能“按键”，所以它遵守同样的帧数表、同样的输入缓冲。
 * 结构：有威胁先应对（防御、对空、躲道具）→ 对手露出破绽就惩罚 → 否则按距离挑一个打法（一串预先排好的按键）。
 */
export class AiSource implements InputSource {
  private queue: Step[] = [];
  private cur: Step | null = null; private left = 0;
  private rng: Rng;
  private t: Tuning;
  private guardF = 0;          // 还要继续按住防御多少帧
  private seenMove = -1;       // 对手这一招是从哪一帧开始的（反应延迟用）
  private decided = false;     // 这一招已经决定过防不防了
  private willBlock = false;
  private cool = 0;            // 两次决策之间的间隔
  private reach: Record<string, number> = {};
  private parryNow = false;
  private blockedStreak = 0;   // 对手连续防住了几次（多了就用投技）
  private lastOppHp = -1; private lastContact = 0;

  constructor(private getMatch: () => Match | null, private idx: number, level: number) {
    this.t = LEVELS[level] ?? LEVELS[2];
    this.rng = new Rng((Math.random() * 0xffffffff) >>> 0);
  }

  private moveReach(me: Fighter, id: string): number {
    if (this.reach[id] !== undefined) return this.reach[id];
    const m = me.def.moves[id]; let r = 1;
    if (m) {
      const box = m.hits.find((h) => !h.chain)?.box;
      r = (box ? box[2] : 1.0) + (m.moves?.reduce((s, v) => s + v.dist, 0) ?? 0) * me.scale * 0.85;
    }
    return (this.reach[id] = r);
  }

  private push(...steps: Step[]) { this.queue.push(...steps); }
  private clear() { this.queue.length = 0; this.cur = null; this.left = 0; }

  poll(): Cmd {
    const m = this.getMatch();
    const c = emptyCmd();
    if (!m || m.phase !== 'fight') { this.clear(); return c; }
    const me = m.f[this.idx], opp = m.f[1 - this.idx];
    const rng = this.rng, t = this.t;
    const dx = opp.x - me.x, dist = Math.abs(dx);
    const toward = (dx >= 0 ? 1 : -1) * me.facing >= 0;   // 对手是不是在我面前
    const gap = dist - me.half - opp.half;

    // 统计对手是不是老在防
    if (me.contact && me.move && this.lastContact !== m.frame - 1) { /* 留给下面 */ }
    if (opp.state === 'blockstun' && opp.sf === 1) this.blockedStreak++;
    if (opp.state === 'hitstun' && opp.sf === 1) this.blockedStreak = 0;

    // ── 一、威胁 ──
    let threat = false, throwThreat = false, airThreat = false;
    const om = opp.move;
    if (om && (opp.state === 'attack' || opp.state === 'air')) {
      const first = om.hits.find((h) => !h.chain);
      const reach = (first?.box ? first.box[2] : 1.2) + (om.moves?.reduce((s, v) => s + v.dist, 0) ?? 0) * opp.scale + 0.5;
      const lastActive = om.hits.reduce((s, h) => Math.max(s, h.chain ? 0 : h.f + h.a), 0);
      if (first && opp.mf <= lastActive && dist < reach + opp.half + me.half) {
        if (first.level === 'throw') throwThreat = true; else threat = true;
        if (opp.state === 'air') airThreat = true;
      }
      if (opp.sf === 1 || this.seenMove < 0 || m.frame - this.seenMove > om.total + 5) { this.seenMove = m.frame - opp.mf; this.decided = false; }
    } else { this.seenMove = -1; this.decided = false; }
    // 飞行道具
    let projThreat = false, projNear = 99;
    for (const p of m.projectiles) {
      if (p.owner === this.idx) continue;
      const d = (me.x - p.x) * p.dir;      // 正数：正朝我飞来
      if (d > -0.3 && d < 3.4) { projThreat = true; projNear = Math.min(projNear, d); }
    }

    const canAct = me.state === 'stand' || me.state === 'block';
    if ((threat || throwThreat || projThreat) && canAct) {
      const sinceStart = this.seenMove >= 0 ? m.frame - this.seenMove : 99;
      if (!this.decided && (sinceStart >= t.react || projThreat)) {
        this.decided = true;
        this.willBlock = rng.chance(t.block);
        if (throwThreat) {
          // 投技防不住：后撤或者起跳
          this.willBlock = false;
          if (rng.chance(t.block)) { this.clear(); this.push(rng.chance(0.5) ? { f: 2, b: ['D'], x: -1 } : { f: 3, y: 1, x: -1 }); }
        } else if (airThreat && rng.chance(t.antiAir) && gap < 1.6 && opp.y > 0.6) {
          this.willBlock = false; this.clear(); this.push(tap('H', 0, -1));           // 对空：上勾 / 上撩
        } else if (projThreat && !threat && rng.chance(0.3 * t.aggression) && projNear > 1.4) {
          this.willBlock = false; this.clear(); this.push({ f: 3, y: 1, x: 1 }, wait(10, 1), tap('L'));   // 跳过去压上
        }
      }
      if (this.willBlock) { if (this.guardF <= 0) this.parryNow = rng.chance(t.block * 0.18); this.guardF = 10; this.clear(); }
    }
    if (me.state === 'blockstun') this.guardF = Math.max(this.guardF, 4);
    if (this.guardF > 0) {
      this.guardF--; c.G = true; c.np = !this.parryNow;
      // 防住之后偶尔立刻反击
      if (this.guardF === 0 && me.state === 'block' && gap < 1.2 && rng.chance(t.punish * 0.6)) this.push(tap('L'), wait(8), tap('L'), wait(9), tap('L'));
      return c;
    }

    // ── 二、执行排好的按键 ──
    if (this.cur || this.queue.length) {
      if (!this.cur) { this.cur = this.queue.shift()!; this.left = this.cur.f; }
      const s = this.cur;
      if (s.x) c.x = s.x * me.facing;
      if (s.y) c.y = s.y;
      if (s.b) for (const b of s.b) c[b] = true;
      if (--this.left <= 0) this.cur = null;
      // 连段打空了（对手没被打中也没防住）就别傻按完
      if (me.state === 'attack' && me.move && me.mf > (me.move.hits[0]?.f ?? 0) + (me.move.hits[0]?.a ?? 0) + 2 && !me.contact && me.move.kind === 'normal') this.queue.length = 0;
      return c;
    }

    if (!canAct) return c;
    if (this.cool > 0) { this.cool--; if (gap > 1.6 && rng.chance(0.6)) c.x = me.facing * (toward ? 1 : -1); return c; }

    // ── 三、惩罚：对手收招、倒地起身、眩晕 ──
    const oppRecovering = opp.state === 'attack' && om && opp.mf > om.hits.reduce((s, h) => Math.max(s, h.f + h.a), 0) + 1 && om.total - opp.mf > 9;
    const oppOpen = oppRecovering || opp.state === 'dizzy' || opp.state === 'parried' || opp.state === 'land';
    if (oppOpen && rng.chance(t.punish)) {
      if (gap < this.moveReach(me, 'light1') - 0.2) { this.plan(me, opp, 'combo'); return c; }
      if (gap < this.moveReach(me, 'lunge') - 0.3) { this.push(tap('H', 1)); this.cool = 4; return c; }
      if (gap < this.moveReach(me, 'sp2') - 0.4) { this.push(tap('S', 1)); this.cool = 4; return c; }
    }
    // 对手被打飞在空中：追打
    if (opp.state === 'launched' && opp.y > 0.5 && opp.vy < 2 && gap < 1.5 && rng.chance(t.combo)) {
      this.push(rng.chance(0.5) ? tap('H') : tap('L'), wait(9), tap('S', 1)); this.cool = 6; return c;
    }
    if ((opp.state === 'down' || opp.state === 'getup') && gap > 1.5 && rng.chance(0.03)) { this.push(rng.chance(0.5) ? tap('S') : tap('S', 0, -1), wait(26)); return c; }   // 远处压起身：放道具
    if (opp.state === 'down' || opp.state === 'getup' || opp.state === 'launched') {
      // 压起身：走到合适的距离等着
      if (gap > 1.3) c.x = me.facing; else if (gap < 0.7) c.x = -me.facing;
      return c;
    }

    // ── 四、主动出击 ──
    if (rng.chance(t.idle * 0.5)) { this.cool = 8 + Math.floor(rng.range(0, 14)); return c; }
    const full = me.meter >= 100;
    if (full && gap < this.moveReach(me, 'ult') - 0.6 && rng.chance(0.05 + 0.1 * (1 - t.superSmart))) { this.push(tap('U')); this.cool = 10; return c; }

    if (gap > 4.6) {
      const r = rng.next();
      if (r < 0.34) this.push(tap('S'), wait(22));                       // 放道具
      else if (r < 0.46) this.push(tap('S', 0, -1), wait(24));            // 贴地技
      else if (r < 0.62 * t.aggression + 0.2) this.push({ f: 2, b: ['D'], x: 1 }, wait(12, 1));
      else this.push(wait(Math.floor(rng.range(14, 30)), 1));
    } else if (gap > 1.9) {
      const r = rng.next();
      if (r < 0.13) this.push(tap('H', 1));                                // 突进重击
      else if (r < 0.27) this.push(tap('S', 1));                          // 突进技
      else if (r < 0.42) this.push(tap('S', 0, -1), wait(22));            // 贴地技
      else if (r < 0.56) this.push(tap('S'), wait(18));                   // 飞行道具
      else if (r < 0.66) this.push({ f: 3, y: 1, x: 1 }, wait(16, 1), tap('H'), wait(14), tap('L'), wait(8), tap('L'));  // 跳入
      else if (r < 0.78) this.push({ f: 2, b: ['D'], x: 1 }, wait(9, 1), tap('L'), wait(8), tap('L'));
      else if (r < 0.85 && gap < 3) this.push(wait(Math.floor(rng.range(8, 16)), -1));                                    // 后退拉扯
      else this.push(wait(Math.floor(rng.range(8, 18)), 1));
    } else {
      // 近身
      if (this.blockedStreak >= 2 && gap < 0.75 && rng.chance(0.6)) { this.blockedStreak = 0; this.push(tap('T')); this.cool = 6; return c; }
      const r = rng.next();
      if (r < 0.46) this.plan(me, opp, 'combo');
      else if (r < 0.58) this.push(tap('H'));
      else if (r < 0.68) this.push(tap('L', 0, -1));                      // 扫腿
      else if (r < 0.78 && gap < 0.8) this.push(tap('T'));
      else if (r < 0.86) this.push(tap('H', 0, -1), wait(30), tap('L'), wait(9), tap('H'));   // 上勾起手接追打
      else if (r < 0.93) this.push({ f: 2, b: ['D'], x: -1 }, wait(16), rng.chance(0.6) ? tap('S') : tap('S', 0, -1), wait(20));   // 后撤拉开，接一发技能
      else this.push(wait(10, -1));
    }
    this.cool = 3 + Math.floor(rng.range(0, 8 * (1 - t.aggression) + 4));
    return c;
  }

  /** 排一套连段。能确认的话接技能，气满了接大招。 */
  private plan(me: Fighter, _opp: Fighter, _kind: 'combo') {
    const rng = this.rng, t = this.t;
    const steps: Step[] = [tap('L'), wait(8), tap('L')];
    if (rng.chance(t.combo)) {
      steps.push(wait(9), tap('L'));
      if (rng.chance(t.combo)) {
        const full = me.meter >= 100 && rng.chance(t.superSmart);
        steps.push(wait(13));
        if (full) steps.push(tap('U'));
        else { const r = rng.next(); steps.push(r < 0.45 ? tap('S', 1) : r < 0.75 ? tap('S', 0, -1) : tap('S')); }
      }
    } else if (rng.chance(0.5)) steps.push(wait(9), tap('H'));
    this.push(...steps);
  }
}

export type { MoveDef };
