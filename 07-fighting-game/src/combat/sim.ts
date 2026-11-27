import {
  BODY_HALF, DT, GRAVITY, INPUT_BUFFER, MAX_GUARD, MAX_METER, MAX_SEPARATION, PARRY_WINDOW, ROUND_TIME, ROUNDS_TO_WIN, SIM_HZ, STAGE_HALF,
} from '../core/config';
import { approach, clamp, piecewise, Rng } from '../core/math';
import type { ClipMeta } from '../anim/rig';
import { BTNS, emptyCmd } from './types';
import type { Btn, Cmd, FState, FightEvent, FighterDef, HitDef, InputSource, MoveDef, ProjectileDef } from './types';

type Box = [number, number, number, number];
const overlap = (a: Box, b: Box) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

export interface AnimOut { name: string; t: number; rate: number; fade: number; loop: boolean; seq: number }

interface Buffered { btn: Btn; dir: 'n' | 'f' | 'b' | 'd'; f: number }

export class Fighter {
  x = 0; y = 0; px = 0; py = 0; vx = 0; vy = 0; kb = 0;
  facing: 1 | -1 = 1;
  hp: number; meter = 0; guard = MAX_GUARD;
  state: FState = 'stand'; sf = 0;
  move: MoveDef | null = null; mf = 0;
  hitDone: boolean[] = []; contact = false; connected = false;
  stun = 0; hitstop = 0; invul = 0;
  comboHits = 0; comboDmg = 0; juggle = 0;
  airUsed = false; gScale = 1;
  wins = 0;
  cmd: Cmd = emptyCmd(); prev: Cmd = emptyCmd();
  buf: Buffered[] = [];
  clock = 0;                 // 角色自己走过的帧数（顿帧、定格时不走），输入缓冲按它过期
  blockAge = 999;            // 按下防御以来的帧数（弹反判定）
  tapDir = 0; tapF = -99;    // 双击方向冲刺
  dashDir = 0;
  reactClip = ''; reactRate = 1;
  launchF = 0; launchDur = 30; groundF = -1;
  cineF = 0;
  koFlag = false;
  shakeF = 0;                // 被打时的抖动（表现层读）
  lastHitBy: HitDef | null = null;
  readonly anim: AnimOut = { name: 'idle', t: 0, rate: 1, fade: 0, loop: true, seq: 0 };
  readonly scale: number;
  readonly half: number;
  clipMeta: Record<string, ClipMeta> = {};

  constructor(readonly idx: number, public def: FighterDef) {
    this.hp = def.hp;
    this.scale = def.height / 1.8;
    this.half = BODY_HALF * this.scale;
  }

  get grounded() { return this.y <= 0.0001; }
  get airborne() { return this.state === 'air' || this.state === 'launched' || this.state === 'prejump'; }
  get actionable() { return this.state === 'stand' || this.state === 'block'; }
  get busy() { return this.state === 'attack' || this.state === 'cine'; }
  get vulnerable() {
    if (this.move?.invul && this.mf >= this.move.invul[0] && this.mf < this.move.invul[1]) return false;
    return this.invul <= 0 && this.state !== 'down' && this.state !== 'getup' && this.state !== 'ko' && this.state !== 'win'
      && this.state !== 'lose' && this.state !== 'cine' && this.state !== 'cineVictim' && this.state !== 'intro';
  }
  /** 正在出招且还没收招（被打算“破招”） */
  get counterable() { return this.state === 'attack' && !!this.move && this.mf < this.move.total - 6; }

  clip(name: string) { return this.def.clipAlias?.[name] ?? name; }
  meta(name: string): ClipMeta | undefined { return this.clipMeta[this.clip(name)]; }

  setAnim(name: string, fade = 0.1, loop = false, t = 0, rate = 1) {
    const a = this.anim;
    a.name = this.clip(name); a.fade = fade; a.loop = loop; a.t = t; a.rate = rate; a.seq++;
  }
  setState(s: FState) { this.state = s; this.sf = 0; }

  hurtbox(): Box | null {
    if (!this.vulnerable) return null;
    const h = this.def.height, w = this.half * 0.95;
    if (this.state === 'launched') return [this.x - w * 1.25, this.y + 0.05 * h, this.x + w * 1.25, this.y + 0.62 * h];
    if (this.state === 'air' || this.state === 'prejump') return [this.x - w, this.y + 0.12 * h, this.x + w, this.y + 0.92 * h];
    return [this.x - w, this.y, this.x + w, this.y + 0.95 * h];
  }
  hitbox(hit: HitDef): Box {
    const b = hit.box ?? [0, 0.6, 0.9, 1.4];
    const f = this.facing;
    const x0 = this.x + b[0] * f, x1 = this.x + b[2] * f;
    return [Math.min(x0, x1), this.y + b[1], Math.max(x0, x1), this.y + b[3]];
  }
}

export interface Projectile {
  id: number; owner: number; def: ProjectileDef; x: number; y: number; px: number; dir: 1 | -1; life: number; hitsLeft: number; gap: number; dead: boolean;
}

export type Phase = 'intro' | 'ready' | 'fight' | 'ko' | 'post' | 'matchEnd';

export class Match {
  readonly f: [Fighter, Fighter];
  projectiles: Projectile[] = [];
  events: FightEvent[] = [];
  frame = 0;
  phase: Phase = 'intro'; pf = 0;
  round = 1; timer = ROUND_TIME * SIM_HZ;
  freeze = 0; freezeBy = -1; freezeTotal = 0;
  winner = -1; matchWinner = -1;
  cine: { att: number; def: number; f: number } | null = null;
  rng = new Rng(20261125);
  private pid = 1;
  /** 展示模式（选人界面用）：两人只是站着播待机，什么都不推进 */
  hold = false;
  /** 训练模式：不掉血、气满 */
  training = false;
  introFrames = 150; readyFrames = 80;

  constructor(defs: [FighterDef, FighterDef], readonly inputs: [InputSource, InputSource], clipMeta: [Record<string, ClipMeta>, Record<string, ClipMeta>]) {
    this.f = [new Fighter(0, defs[0]), new Fighter(1, defs[1])];
    this.f[0].clipMeta = clipMeta[0]; this.f[1].clipMeta = clipMeta[1];
    this.resetRound(true);
  }

  private emit(e: FightEvent) { this.events.push(e); }
  drainEvents(): FightEvent[] { const e = this.events; this.events = []; return e; }

  resetRound(first = false) {
    const [a, b] = this.f;
    for (const p of this.f) {
      p.hp = p.def.hp; p.guard = MAX_GUARD; if (first) p.meter = 0;
      p.vx = p.vy = p.kb = 0; p.y = p.py = 0; p.move = null; p.stun = 0; p.hitstop = 0; p.invul = 0;
      p.comboHits = 0; p.comboDmg = 0; p.juggle = 0; p.koFlag = false; p.buf.length = 0; p.gScale = 1;
    }
    a.x = a.px = -2.1; b.x = b.px = 2.1; a.facing = 1; b.facing = -1;
    this.projectiles.length = 0; this.cine = null; this.freeze = 0;
    this.timer = ROUND_TIME * SIM_HZ; this.winner = -1;
    this.phase = 'intro'; this.pf = 0;
    for (const p of this.f) {
      p.setState('intro');
      if (first && p.meta('intro')) p.setAnim('intro', 0, false, 0, 1); else p.setAnim('idle', 0.2, true, this.rng.range(0, 1));
    }
    const introSec = Math.max(...this.f.map((p) => { const m = p.meta('intro'); return m ? m.recover ?? m.dur ?? 2.5 : 1.6; }));
    this.introFrames = first ? Math.round(introSec * SIM_HZ) + 24 : 50;
    this.emit({ type: 'round', phase: 'intro', round: this.round });
  }

  // ───────────────────────────── 主循环 ─────────────────────────────
  step() {
    this.frame++; this.pf++;
    const [a, b] = this.f;
    for (const p of this.f) { p.px = p.x; p.py = p.y; }

    // 输入：任何时候都读（顿帧、定格里按的键要进缓冲）
    for (const p of this.f) this.readInput(p);

    if (this.hold) { for (const p of this.f) { p.cmd = emptyCmd(); p.anim.rate = 1; p.anim.t += DT; } return; }
    if (this.training && this.phase === 'fight') for (const p of this.f) { p.meter = MAX_METER; if (p.state === 'stand' && p.comboHits === 0) p.hp = Math.min(p.def.hp, p.hp + 8); }

    if (this.freeze > 0) { this.freeze--; this.tickFreeze(); return; }

    this.stepPhase();

    if (this.cine) this.stepCine();
    for (const p of this.f) {
      if (p.state === 'cine' || p.state === 'cineVictim') continue;
      if (p.hitstop > 0) { p.hitstop--; p.anim.rate = 0; continue; }
      this.stepFighter(p);
    }
    this.resolvePush(a, b);
    for (const p of this.f) this.autoFace(p);
    if (!this.cine) this.resolveHits();
    this.stepProjectiles();
    for (const p of this.f) { if (p.invul > 0) p.invul--; if (p.shakeF > 0) p.shakeF--; }
    this.checkKo();
  }

  private tickFreeze() {
    // 大招定格：别人完全停住，发招的人把蓄势那一段动作演完
    for (const q of this.f) q.anim.rate = 0;
    const p = this.f[this.freezeBy];
    const span = p?.move?.freezeSpan;
    if (p && span && this.freezeTotal > 0) {
      const k = 1 - this.freeze / this.freezeTotal;
      const t = span[0] + (span[1] - span[0]) * k;
      p.anim.rate = (t - p.anim.t) / DT; p.anim.t = t;
    }
  }

  private stepPhase() {
    const [a, b] = this.f;
    switch (this.phase) {
      case 'intro':
        if (this.pf >= this.introFrames) {
          this.phase = 'ready'; this.pf = 0;
          for (const p of this.f) { p.setState('intro'); if (p.anim.name !== p.clip('idle')) p.setAnim('idle', 0.25, true, 0); }
          this.emit({ type: 'round', phase: 'fight', round: this.round });
        }
        break;
      case 'ready':
        if (this.pf >= this.readyFrames) { this.phase = 'fight'; this.pf = 0; for (const p of this.f) p.setState('stand'); }
        break;
      case 'fight':
        if (!this.cine && !this.training) {
          this.timer--;
          if (this.timer <= 0) {
            this.winner = a.hp === b.hp ? -1 : a.hp > b.hp ? 0 : 1;
            this.phase = 'ko'; this.pf = 0;
            this.emit({ type: 'round', phase: 'timeup', round: this.round, winner: this.winner });
          }
        }
        break;
      case 'ko': {
        // 等败者躺稳、胜者回到可动状态，再摆胜利姿势
        const settled = this.f.every((p) => p.state === 'ko' || p.state === 'stand' || p.state === 'block' || p.state === 'lose' || (p.state === 'down' && p.koFlag));
        if ((settled && this.pf > 70) || this.pf > 300) {
          this.phase = 'post'; this.pf = 0;
          if (this.winner >= 0) {
            const w = this.f[this.winner]; w.wins++;
            w.setState('win'); w.move = null; w.vx = 0;
            w.setAnim(w.meta('win') ? 'win' : 'idle', 0.25, !w.meta('win'), 0);
            const l = this.f[1 - this.winner];
            if (l.state !== 'ko' && l.state !== 'down') { l.setState('lose'); l.move = null; l.vx = 0; if (l.meta('ko')) l.setAnim('ko', 0.25, false, 0, 1); else l.setAnim(l.meta('dizzy') ? 'dizzy' : 'idle', 0.3, true, 0); }
          }
          this.emit({ type: 'round', phase: 'win', round: this.round, winner: this.winner });
        }
        break;
      }
      case 'post':
        if (this.pf >= 230) {
          if (a.wins >= ROUNDS_TO_WIN || b.wins >= ROUNDS_TO_WIN) {
            this.matchWinner = a.wins > b.wins ? 0 : 1;
            this.phase = 'matchEnd'; this.pf = 0;
            this.emit({ type: 'round', phase: 'matchEnd', round: this.round, winner: this.matchWinner });
          } else { this.round++; this.resetRound(false); }
        }
        break;
      case 'matchEnd': break;
    }
  }

  // ───────────────────────────── 输入 ─────────────────────────────
  private readInput(p: Fighter) {
    p.prev = p.cmd;
    const live = this.phase === 'fight' || this.phase === 'ready';
    p.cmd = live ? this.inputs[p.idx].poll(p.idx) : emptyCmd();
    const c = p.cmd, o = p.prev;
    const fwd = c.x * p.facing;
    const dir: Buffered['dir'] = c.y < 0 ? 'd' : fwd > 0 ? 'f' : fwd < 0 ? 'b' : 'n';
    if (p.hitstop <= 0 && this.freeze <= 0) p.clock++;
    for (const k of BTNS) if (c[k] && !o[k]) { if (k !== 'G') p.buf.push({ btn: k, dir, f: p.clock }); }
    if (c.G && !o.G) p.blockAge = 0; else p.blockAge++;
    // 双击方向 = 冲刺
    if (c.x !== 0 && o.x === 0) {
      if (p.tapDir === c.x && this.frame - p.tapF <= 14) { p.buf.push({ btn: 'D', dir: c.x * p.facing > 0 ? 'f' : 'b', f: p.clock }); p.tapF = -99; }
      else { p.tapDir = c.x; p.tapF = this.frame; }
    }
    while (p.buf.length && p.clock - p.buf[0].f > INPUT_BUFFER) p.buf.shift();
  }

  private resolveCommand(p: Fighter, b: Buffered, air: boolean): MoveDef | null {
    const cm = p.def.commands;
    const pre = air ? 'air' : '';
    const id = cm[pre + b.dir + b.btn] ?? cm[pre + 'n' + b.btn] ?? (air ? cm['air' + b.btn] : undefined);
    if (!id) return null;
    const m = p.def.moves[id];
    if (!m) return null;
    if ((m.cost ?? 0) > p.meter && !this.training) return null;
    if (!!m.air !== air) return null;
    return m;
  }

  private tryStartMove(p: Fighter, air: boolean, allow?: string[]): boolean {
    for (let i = 0; i < p.buf.length; i++) {
      const b = p.buf[i];
      if (b.btn === 'D' || b.btn === 'G') continue;
      let m = this.resolveCommand(p, b, air);
      if (!m) continue;
      if (allow) {
        const nx = p.move?.next?.[m.id];
        if (nx && p.def.moves[nx]) m = p.def.moves[nx];
        if (!allow.includes(m.id)) continue;
      }
      p.buf.splice(0, i + 1);
      this.startMove(p, m);
      return true;
    }
    return false;
  }

  startMove(p: Fighter, m: MoveDef) {
    if (m.cost && !this.training) p.meter = Math.max(0, p.meter - m.cost);
    p.move = m; p.mf = 0; p.hitDone = m.hits.map(() => false); p.contact = false; p.connected = false;
    if (!m.air) { p.setState('attack'); p.vx = 0; }
    else p.airUsed = true;
    // 出招的那一刻转向对手（空中招不转）
    if (!m.air) { const o = this.f[1 - p.idx]; if (o.x !== p.x) p.facing = o.x > p.x ? 1 : -1; }
    const t0 = m.warp[0][1];
    p.setAnim(m.clip, m.fade ?? 0.07, false, t0, 0);
    this.emit({ type: 'moveStart', who: p.idx, move: m.id });
  }

  // ───────────────────────────── 单个角色 ─────────────────────────────
  private stepFighter(p: Fighter) {
    p.sf++;
    const c = p.cmd;
    const o = this.f[1 - p.idx];
    const fwd = c.x * p.facing;

    switch (p.state) {
      case 'intro': case 'win': case 'lose': case 'ko':
        p.vx = 0; this.advanceAnim(p);
        break;

      case 'stand': {
        if (this.phase !== 'fight') { p.vx = 0; this.loopAnim(p, 'idle', 0.18); break; }
        if (this.tryStartMove(p, false)) break;
        const d = p.buf.find((b) => b.btn === 'D');
        if (d || (c.D && !p.prev.D)) {
          const dir = d ? (d.dir === 'b' ? -1 : 1) : fwd < 0 ? -1 : 1;
          p.buf = p.buf.filter((b) => b.btn !== 'D');
          this.startDash(p, dir); break;
        }
        if (c.y > 0) { p.setState('prejump'); p.vx = 0; p.dashDir = fwd > 0 ? 1 : fwd < 0 ? -1 : 0; this.playJump(p); break; }
        if (c.G) { p.setState('block'); p.vx = 0; this.playBlock(p); break; }
        if (fwd > 0) { p.vx = p.def.walkF * p.facing; this.loopWalk(p, 'walk_f', p.def.walkF); }
        else if (fwd < 0) { p.vx = -p.def.walkB * p.facing; this.loopWalk(p, 'walk_b', p.def.walkB); }
        else { p.vx = 0; this.loopAnim(p, 'idle', 0.16); }
        p.x += p.vx * DT;
        p.guard = Math.min(MAX_GUARD, p.guard + 0.22);
        break;
      }

      case 'block': {
        p.vx = 0;
        if (this.tryStartMove(p, false)) break;
        if (!c.G) { p.setState('stand'); p.setAnim('idle', 0.12, true, 0); break; }
        this.holdBlockAnim(p);
        break;
      }

      case 'blockstun': {
        this.applyKb(p);
        this.holdBlockAnim(p);
        if (--p.stun <= 0) { if (c.G) p.setState('block'); else { p.setState('stand'); p.setAnim('idle', 0.14, true, 0); } }
        break;
      }

      case 'parried': case 'hitstun': case 'dizzy': {
        this.applyKb(p);
        this.advanceAnim(p);
        if (p.state !== 'dizzy') p.guard = Math.min(MAX_GUARD, p.guard + 0.1);
        if (--p.stun <= 0) { this.endCombo(p); p.setState('stand'); p.setAnim('idle', 0.16, true, 0); if (p.guard <= 0) p.guard = MAX_GUARD; }
        break;
      }

      case 'grabbed': {
        p.vx = 0; this.advanceAnim(p);
        if (--p.stun <= 0) { this.endCombo(p); p.setState('stand'); p.setAnim('idle', 0.16, true, 0); }
        break;
      }

      case 'dash': {
        const fwdDash = p.dashDir > 0;
        const total = fwdDash ? 17 : 19;
        const dist = fwdDash ? p.def.dashF : p.def.dashB;
        const k0 = (p.sf - 1) / total, k1 = p.sf / total;
        const e = (k: number) => 1 - Math.pow(1 - k, 2.6);
        p.x += (e(k1) - e(k0)) * dist * p.dashDir * p.facing;
        this.advanceAnim(p);
        if (fwdDash && p.sf > 6 && this.tryStartMove(p, false)) break;   // 前冲可以提前出招
        if (p.sf >= total) { p.setState('stand'); p.setAnim('idle', 0.14, true, 0); }
        break;
      }

      case 'prejump': {
        this.advanceAnim(p);
        if (p.sf >= 4) {
          p.setState('air'); p.vy = p.def.jumpV; p.vx = p.dashDir * p.def.jumpVx * p.facing; p.airUsed = false; p.move = null;
          this.emit({ type: 'jump', who: p.idx });
        }
        break;
      }

      case 'air': {
        p.vy -= GRAVITY * DT; p.x += p.vx * DT; p.y += p.vy * DT;
        if (p.move) {
          p.mf++; this.fireMoveEvents(p);
          this.moveAnim(p);
          if (p.mf >= p.move.total) { p.move = null; this.playJump(p, true); }
        } else {
          if (!p.airUsed && this.tryStartMove(p, true)) { /* 空中出招 */ }
          else this.jumpAnim(p);
        }
        if (p.y <= 0 && p.vy < 0) {
          p.y = 0; p.vy = 0; p.vx = 0;
          const lag = p.move ? p.move.landLag ?? 8 : 4;
          p.move = null; p.stun = lag; p.setState('land');
          this.landAnim(p);
          this.emit({ type: 'land', who: p.idx, hard: false });
        }
        break;
      }

      case 'land': {
        this.advanceAnim(p);
        if (--p.stun <= 0) { p.setState('stand'); if (!this.tryStartMove(p, false)) p.setAnim('idle', 0.16, true, 0); }
        break;
      }

      case 'attack': {
        const m = p.move!;
        p.mf++;
        // 位移
        if (m.moves) for (const mv of m.moves) {
          if (p.mf > mv.f0 && p.mf <= mv.f1) {
            const n = mv.f1 - mv.f0, k0 = (p.mf - 1 - mv.f0) / n, k1 = (p.mf - mv.f0) / n;
            const e = mv.ease === 'lin' ? (k: number) => k : mv.ease === 'in' ? (k: number) => k * k : (k: number) => 1 - (1 - k) * (1 - k);
            p.x += (e(k1) - e(k0)) * mv.dist * p.scale * p.facing;
          }
        }
        this.applyKb(p);
        this.fireMoveEvents(p);
        this.moveAnim(p);
        // 取消
        if (m.cancels) for (const cw of m.cancels) {
          if (p.mf >= cw.f0 && p.mf <= cw.f1 && (cw.when === 'always' || (cw.when === 'contact' && p.contact) || (cw.when === 'hit' && p.connected))) {
            if (this.tryStartMove(p, false, cw.into)) return;
          }
        }
        if (p.mf === m.hits[0]?.f + (m.hits[0]?.a ?? 0) + 1 && !p.contact && m.hits.length) this.emit({ type: 'whiff', who: p.idx, move: m.id, heavy: !!m.hits[0].heavy });
        if (p.mf >= m.total) { p.move = null; p.setState('stand'); if (!this.tryStartMove(p, false)) p.setAnim('idle', 0.14, true, 0); }
        break;
      }

      case 'launched': {
        p.launchF++;
        p.vy -= GRAVITY * p.gScale * DT; p.x += p.vx * DT; p.y += p.vy * DT;
        this.launchAnim(p);
        if (p.y <= 0 && p.vy < 0) {
          p.y = 0;
          this.emit({ type: 'bounce', who: p.idx, x: p.x });
          this.emit({ type: 'land', who: p.idx, hard: true });
          p.vy = 0; p.kb = p.vx * 0.5; p.vx = 0;
          p.setState('down'); p.groundF = 0;
          p.stun = p.koFlag ? 99999 : 34;
          this.groundAnim(p);
        }
        break;
      }

      case 'down': {
        this.applyKb(p, 0.86);
        this.advanceAnim(p);
        if (p.koFlag) { if (p.sf > 50) { p.setState('ko'); } break; }
        if (--p.stun <= 0) {
          this.endCombo(p);
          p.setState('getup'); p.stun = 26;
          const gm = p.meta('getup');
          if (gm) { const dur = gm.recover ?? gm.dur ?? 1; p.setAnim('getup', 0.08, false, 0, dur / (p.stun * DT)); }
          else p.setAnim('idle', 0.3, true, 0);
          this.emit({ type: 'getup', who: p.idx });
        }
        break;
      }

      case 'getup': {
        this.advanceAnim(p);
        if (--p.stun <= 0) { p.setState('stand'); p.invul = 4; p.setAnim('idle', 0.18, true, 0); }
        break;
      }

      case 'cine': case 'cineVictim': break;
    }
  }

  private endCombo(p: Fighter) { p.comboHits = 0; p.comboDmg = 0; p.juggle = 0; p.gScale = 1; }

  private applyKb(p: Fighter, fr = 0.84) {
    if (p.kb !== 0) { p.x += p.kb * DT; p.kb *= fr; if (Math.abs(p.kb) < 0.05) p.kb = 0; }
  }

  private fireMoveEvents(p: Fighter) {
    const m = p.move!; if (!m.events) return;
    for (const ev of m.events) if (ev.f === p.mf) {
      if (ev.flag === 'superFreeze') { this.freeze = this.freezeTotal = m.freezeFrames ?? 52; this.freezeBy = p.idx; this.emit({ type: 'superFreeze', who: p.idx, move: m.id }); }
      if (ev.proj) this.spawnProjectile(p, ev.proj);
      this.emit({ type: 'moveEvent', who: p.idx, move: m.id, ev });
    }
  }

  private startDash(p: Fighter, dir: number) {
    p.setState('dash'); p.dashDir = dir; p.vx = 0;
    if (dir < 0) p.invul = 9;
    const name = dir > 0 ? 'dash_f' : 'dash_b';
    const m = p.meta(name);
    const frames = dir > 0 ? 17 : 19;
    if (m) p.setAnim(name, 0.06, false, 0, (m.recover ?? m.dur ?? 0.5) / (frames * DT));
    else {
      const wn = dir > 0 ? 'walk_f' : 'walk_b';
      const wm = p.meta(wn);
      p.setAnim(wn, 0.06, true, 0, wm ? (wm.dur ?? 1) / (frames * DT) * 0.5 : 2);
    }
    this.emit({ type: 'dash', who: p.idx, dir });
  }

  // ───────────────────────────── 动作时间 ─────────────────────────────
  private advanceAnim(p: Fighter) { p.anim.t += p.anim.rate * DT; }

  private loopAnim(p: Fighter, name: string, fade: number) {
    if (p.anim.name !== p.clip(name)) p.setAnim(name, fade, true, 0, 1);
    p.anim.rate = 1; p.anim.t += DT;
  }
  private loopWalk(p: Fighter, name: string, speed: number) {
    const m = p.meta(name);
    let rate = 1;
    // 步幅 × 身高 = 一个循环走的米数；播放倍率让脚和地面对上
    if (m?.stride && m.dur) rate = clamp(speed / ((m.stride * p.def.height) / m.dur), 0.7, 2.0);
    if (p.anim.name !== p.clip(name)) p.setAnim(name, 0.14, true, 0, rate);
    p.anim.rate = rate; p.anim.t += rate * DT;
  }
  private moveAnim(p: Fighter) {
    const m = p.move!;
    const t0 = piecewise(m.warp, p.mf), t1 = piecewise(m.warp, p.mf + 1);
    p.anim.t = t0; p.anim.rate = (t1 - t0) / DT;
  }
  private playBlock(p: Fighter) {
    const m = p.meta('block');
    if (m) p.setAnim('block', 0.07, false, 0, m.hold ? m.hold[0] / (5 * DT) : 1);
    else p.setAnim('idle', 0.1, true, 0, 0.4);
  }
  private holdBlockAnim(p: Fighter) {
    const m = p.meta('block');
    if (!m) { p.anim.rate = 0.3; p.anim.t += 0.3 * DT; return; }
    if (p.anim.name !== p.clip('block')) this.playBlock(p);
    const [h0, h1] = m.hold ?? [0.3, (m.dur ?? 1) - 0.3];
    if (p.anim.t < h0) { p.anim.t = Math.min(h0, p.anim.t + p.anim.rate * DT); }
    else {
      // 保持段里慢慢来回走，不僵住
      const span = Math.max(0.05, h1 - h0);
      const k = ((this.frame * DT * 0.35) % 2);
      p.anim.t = h0 + span * (k < 1 ? k : 2 - k) * 0.5; p.anim.rate = 0;
    }
  }
  private playJump(p: Fighter, falling = false) {
    const m = p.meta('jump');
    if (!m) { p.setAnim('idle', 0.1, true, 0, 0.5); return; }
    if (falling) { p.setAnim('jump', 0.15, false, ((m.takeoff ?? 0.3) + (m.land ?? 1)) / 2, 0); return; }
    p.setAnim('jump', 0.05, false, 0, (m.takeoff ?? 0.3) / (4 * DT));
  }
  private jumpAnim(p: Fighter) {
    const m = p.meta('jump');
    if (!m) { p.anim.t += 0.5 * DT; return; }
    if (p.anim.name !== p.clip('jump')) return;
    const t0 = m.takeoff ?? 0.3, t1 = m.land ?? (m.dur ?? 1) - 0.2;
    // 按竖直速度定在腾空段的哪里：刚起跳在开头，最高点在中间，落地前在末尾
    const k = clamp(0.5 - p.vy / (2 * p.def.jumpV), 0, 1);
    const target = t0 + (t1 - t0) * k;
    p.anim.rate = (target - p.anim.t) / DT; p.anim.t = target;
  }
  private landAnim(p: Fighter) {
    const m = p.meta('jump');
    if (m && p.anim.name === p.clip('jump')) {
      const t1 = m.land ?? (m.dur ?? 1) - 0.2, end = m.recover ?? m.dur ?? t1 + 0.2;
      p.anim.t = t1; p.anim.rate = (end - t1) / (Math.max(p.stun, 1) * DT);
    } else if (m) p.setAnim('jump', 0.06, false, m.land ?? 0.9, ((m.recover ?? m.dur ?? 1) - (m.land ?? 0.9)) / (Math.max(p.stun, 1) * DT));
    else p.setAnim('idle', 0.1, true, 0);
  }
  private launchAnim(p: Fighter) {
    const name = 'knockdown';
    const m = p.meta(name);
    if (!m) { p.anim.t += DT; return; }
    if (p.anim.name !== p.clip(name)) p.setAnim(name, 0.07, false, m.airborne?.[0] ?? 0, 0);
    const a0 = m.airborne?.[0] ?? 0.05, a1 = m.airborne?.[1] ?? m.ground ?? 0.5;
    const k = clamp(p.launchF / Math.max(p.launchDur, 1), 0, 1);
    const target = a0 + (a1 - a0) * k;
    p.anim.rate = (target - p.anim.t) / DT; p.anim.t = target;
  }
  private groundAnim(p: Fighter) {
    const name = 'knockdown';
    const m = p.meta(name);
    if (!m) { p.setAnim('idle', 0.2, true, 0, 0.3); return; }
    const g = m.ground ?? m.airborne?.[1] ?? 0.5;
    if (p.anim.name !== p.clip(name)) p.setAnim(name, 0.06, false, g, 1); else { p.anim.t = g; p.anim.rate = 1; }
  }
  private playReact(p: Fighter, hit: HitDef, frames: number) {
    const want = hit.knock === 'stagger' || hit.react === 'heavy' ? 'hit_heavy' : hit.react === 'high' ? 'hit_high' : hit.react === 'side' ? 'hit_side' : 'hit_mid';
    const name = p.meta(want) ? want : p.meta('hit_mid') ? 'hit_mid' : p.meta('hit_high') ? 'hit_high' : '';
    if (!name) { p.anim.rate = 0.2; return; }
    const m = p.meta(name)!;
    const dur = m.recover ?? m.dur ?? 0.5;
    p.setAnim(name, 0.04, false, m.impact ?? 0, clamp(dur / (frames * DT), 0.55, 2.4));
  }

  // ───────────────────────────── 推挤、朝向 ─────────────────────────────
  private resolvePush(a: Fighter, b: Fighter) {
    const ghost = (p: Fighter) => p.state === 'cine' || p.state === 'cineVictim' || (!!p.move?.ghost && p.mf >= p.move.ghost[0] && p.mf < p.move.ghost[1]);
    if (!ghost(a) && !ghost(b)) {
      const yTouch = Math.abs(a.y - b.y) < 0.62 * Math.min(a.def.height, b.def.height);   // 跳到对手胸口以上就能越过去
      const lying = (p: Fighter) => p.state === 'down' || p.state === 'ko';
      if (yTouch && !lying(a) && !lying(b)) {
        const min = a.half + b.half;
        let dx = b.x - a.x;
        if (Math.abs(dx) < min) {
          const s = dx === 0 ? (a.facing as number) : Math.sign(dx);
          const pen = min - Math.abs(dx);
          const aw = Math.abs(a.x) >= STAGE_HALF - 0.01, bw = Math.abs(b.x) >= STAGE_HALF - 0.01;
          const ka = aw && !bw ? 0 : bw && !aw ? 1 : 0.5;
          a.x -= s * pen * ka; b.x += s * pen * (1 - ka);
        }
      }
    }
    for (const p of [a, b]) p.x = clamp(p.x, -STAGE_HALF, STAGE_HALF);
    // 镜头框不住时拦住正在远离的那个
    const d = b.x - a.x;
    if (Math.abs(d) > MAX_SEPARATION) {
      const over = Math.abs(d) - MAX_SEPARATION, s = Math.sign(d);
      const ma = Math.abs(a.x - a.px), mb = Math.abs(b.x - b.px);
      const ka = ma + mb < 1e-6 ? 0.5 : ma / (ma + mb);
      a.x += s * over * ka; b.x -= s * over * (1 - ka);
    }
  }

  private autoFace(p: Fighter) {
    if (p.state !== 'stand' && p.state !== 'block' && p.state !== 'land' && p.state !== 'getup' && p.state !== 'intro' && p.state !== 'win') return;
    const o = this.f[1 - p.idx];
    if (Math.abs(o.x - p.x) > 0.05) p.facing = o.x > p.x ? 1 : -1;
  }

  // ───────────────────────────── 命中 ─────────────────────────────
  private resolveHits() {
    const pending: { att: Fighter; def: Fighter; hit: HitDef; i: number; box: Box; hurt: Box; id: string; dir: 1 | -1 }[] = [];
    for (const att of this.f) {
      const m = att.move; if (!m || att.hitstop > 0) continue;
      const def = this.f[1 - att.idx];
      for (let i = 0; i < m.hits.length; i++) {
        const h = m.hits[i];
        if (att.hitDone[i] || att.mf < h.f || att.mf >= h.f + h.a) continue;
        if (h.chain && !att.connected) continue;
        const hurt = def.hurtbox(); if (!hurt) continue;
        if (h.chain) { pending.push({ att, def, hit: h, i, box: hurt, hurt, id: m.id, dir: att.facing }); continue; }  // 抓住以后的后续段必中
        const box = att.hitbox(h);
        if (!overlap(box, hurt)) continue;
        if (h.level === 'throw') {
          const ok = def.grounded && (def.state === 'stand' || def.state === 'block' || def.state === 'dash' || def.state === 'land' || def.state === 'dizzy');
          if (!ok) continue;
        }
        pending.push({ att, def, hit: h, i, box, hurt, id: m.id, dir: att.facing });
      }
    }
    for (const h of pending) {
      if (this.cine) break;
      h.att.hitDone[h.i] = true;
      const cx = (Math.max(h.box[0], h.hurt[0]) + Math.min(h.box[2], h.hurt[2])) / 2;
      const cy = (Math.max(h.box[1], h.hurt[1]) + Math.min(h.box[3], h.hurt[3])) / 2;
      this.applyHit(h.att, h.def, h.hit, h.id, cx, cy, h.dir, false);
    }
  }

  private canBlock(def: Fighter, hit: HitDef, fromDir: number): boolean {
    if (hit.level === 'throw' || hit.level === 'unblock') return false;
    if (def.state !== 'block' && def.state !== 'blockstun') return false;
    return def.facing === -fromDir;   // 背后来的挡不住
  }

  applyHit(att: Fighter, def: Fighter, hit: HitDef, moveId: string, cx: number, cy: number, dir: number, proj: boolean) {
    const blocked = this.canBlock(def, hit, dir);
    const heavy = !!hit.heavy;
    const stop = hit.stop ?? (heavy ? 11 : 7);
    if (!proj) { att.contact = true; }

    if (blocked) {
      const parry = def.state === 'block' && def.blockAge <= PARRY_WINDOW && !proj && !def.cmd.np;
      if (parry) {
        att.hitstop = def.hitstop = 14;
        att.move = null;
        if (att.y > 0.01) { att.setState('air'); att.airUsed = true; att.vx = -3.5 * dir; att.vy = 4.5; this.playJump(att, true); }
        else { att.setState('parried'); att.stun = 34; att.kb = -4.5 * dir; this.playReact(att, { ...hit, react: 'high' }, 34); }
        def.meter = Math.min(MAX_METER, def.meter + 10);
        def.guard = Math.min(MAX_GUARD, def.guard + 25);
        this.emit({ type: 'hit', att: att.idx, def: def.idx, hit, move: moveId, x: cx, y: cy, blocked: true, parry: true, combo: 0, dmg: 0, counter: false, proj, kill: false, air: false });
        return;
      }
      const chip = this.training ? 0 : Math.min(def.hp - 1, hit.chip ?? Math.round(hit.dmg * (hit.el && hit.el !== 'phys' ? 0.14 : 0.04)));
      def.hp -= Math.max(0, chip);
      def.guard -= hit.guardDmg ?? hit.dmg * 0.16;
      def.setState('blockstun'); def.stun = hit.blockstun ?? (heavy ? 20 : 13);
      def.kb = (hit.pushBlock ?? (hit.push ?? 5) * 0.9) * dir;
      if (!proj) { att.hitstop = Math.round(stop * 0.7); if (Math.abs(def.x) >= STAGE_HALF - 0.05) att.kb = -def.kb * 0.8; }
      def.hitstop = Math.round(stop * 0.7); def.shakeF = def.hitstop;
      att.meter = Math.min(MAX_METER, att.meter + (hit.meter ?? hit.dmg * 0.06) * 0.5);
      def.meter = Math.min(MAX_METER, def.meter + hit.dmg * 0.03);
      if (def.guard <= 0) {
        def.guard = 0; def.setState('dizzy'); def.stun = 110; def.kb = 3 * dir;
        def.setAnim(def.meta('dizzy') ? 'dizzy' : def.meta('hit_heavy') ? 'hit_heavy' : 'idle', 0.1, !!def.meta('dizzy'), 0, 1);
        this.emit({ type: 'guardBreak', who: def.idx });
      }
      this.emit({ type: 'hit', att: att.idx, def: def.idx, hit, move: moveId, x: cx, y: cy, blocked: true, parry: false, combo: 0, dmg: chip, counter: false, proj, kill: false, air: false });
      return;
    }

    // ── 打中了 ──
    if (!proj) att.connected = true;
    const counter = def.counterable && hit.level !== 'throw';
    const inCombo = def.state === 'hitstun' || def.state === 'launched' || def.state === 'grabbed' || def.state === 'dizzy' && def.comboHits > 0;
    if (!inCombo) { def.comboHits = 0; def.comboDmg = 0; def.juggle = 0; def.gScale = 1; }
    def.comboHits++;
    const scaleMin = att.move?.kind === 'ult' ? 0.5 : 0.25;
    const scaling = Math.max(scaleMin, 1 - 0.1 * (def.comboHits - 1));
    let dmg = Math.round(hit.dmg * scaling * (counter ? 1.2 : 1));
    if (this.training) dmg = 0;
    const wasAir = def.airborne || def.state === 'launched';
    const armored = def.state === 'attack' && def.move?.armor && def.mf >= def.move.armor[0] && def.mf < def.move.armor[1] && hit.level !== 'throw' && !hit.cine;
    def.hp = Math.max(0, def.hp - dmg); def.comboDmg += dmg;
    att.meter = Math.min(MAX_METER, att.meter + (hit.meter ?? hit.dmg * 0.075));
    def.meter = Math.min(MAX_METER, def.meter + hit.dmg * 0.05);
    def.lastHitBy = hit;
    const kill = def.hp <= 0 && !this.training && this.phase === 'fight';

    if (!proj) att.hitstop = stop + (counter ? 3 : 0);
    def.hitstop = stop + (counter ? 3 : 0); def.shakeF = def.hitstop + 4;

    if (hit.cine && !kill && !armored) { this.startCine(att, def); this.emit({ type: 'hit', att: att.idx, def: def.idx, hit, move: moveId, x: cx, y: cy, blocked: false, parry: false, combo: def.comboHits, dmg, counter, proj, kill: false, air: wasAir }); return; }

    if (armored && !kill) {
      // 霸体：吃伤害不吃硬直
    } else if (hit.level === 'throw' && !kill) {
      def.move = null; def.setState('grabbed'); def.stun = 90; def.vx = def.vy = 0; def.y = 0;
      def.x = clamp(att.x + dir * (att.half + def.half + 0.12), -STAGE_HALF, STAGE_HALF);
      def.facing = -dir as 1 | -1;
      this.playReact(def, { ...hit, react: 'mid' }, 30);
    } else if (wasAir || hit.knock === 'launch' || hit.knock === 'down' || hit.knock === 'spin' || kill) {
      def.move = null;
      def.juggle++;
      let [lx, ly] = hit.launch ?? (wasAir ? [2.2, 5.6] : hit.knock === 'down' ? [3.2, 3.6] : [2.4, 9.2]);
      if (kill) { lx = Math.max(lx, 4.2) * 1.15; ly = Math.max(ly, 6.5); def.koFlag = true; }
      if (wasAir && !hit.launch) ly = Math.max(3.4, ly - def.juggle * 0.45);
      def.gScale = 1 + Math.min(def.juggle, 8) * 0.13;
      def.vx = lx * dir; def.vy = ly; def.kb = 0;
      if (def.y <= 0) def.y = 0.02;
      def.setState('launched'); def.launchF = 0;
      const g = GRAVITY * def.gScale;
      def.launchDur = Math.round(((ly + Math.sqrt(ly * ly + 2 * g * def.y)) / g) * SIM_HZ);
      def.anim.seq++; def.anim.name = '';   // 强制重新起播击飞动作
      this.launchAnim(def);
      if (def.juggle > 9) def.invul = 999;
    } else if (hit.chain && def.state === 'grabbed') {
      def.stun = 80; this.playReact(def, hit, 20);
    } else {
      def.move = null;
      const frames = (hit.hitstun ?? (heavy ? 24 : 16)) + (counter ? 6 : 0);
      def.setState('hitstun'); def.stun = frames;
      def.kb = (hit.push ?? (heavy ? 7 : 4.5)) * dir;
      this.playReact(def, hit, frames);
    }
    if (def.state === 'launched' && def.invul > 100 && !kill) { /* 连段上限：落地前不再挨打 */ }
    // 把对手顶在墙上时，自己被反推开
    if (!proj && Math.abs(def.x) >= STAGE_HALF - 0.05 && def.state === 'hitstun') att.kb = -(hit.push ?? 4.5) * dir * 0.8;

    this.emit({ type: 'hit', att: att.idx, def: def.idx, hit, move: moveId, x: cx, y: cy, blocked: false, parry: false, combo: def.comboHits, dmg, counter, proj, kill, air: wasAir });
    if (kill) this.onKo(def, att);
  }

  private onKo(loser: Fighter, by: Fighter) {
    if (this.phase !== 'fight') return;
    this.phase = 'ko'; this.pf = 0; this.winner = by.idx;
    loser.koFlag = true;
    this.emit({ type: 'ko', who: loser.idx, by: by.idx });
    this.emit({ type: 'round', phase: 'ko', round: this.round, winner: by.idx });
  }

  private checkKo() {
    if (this.phase !== 'fight') return;
    for (const p of this.f) if (p.hp <= 0 && !p.koFlag && !this.training) {
      // 被磨血或演出打死
      p.koFlag = true; p.move = null;
      if (p.state !== 'launched') { p.setState('launched'); p.vx = -p.facing * 3; p.vy = 5; p.y = Math.max(p.y, 0.02); p.launchF = 0; p.launchDur = 24; p.anim.name = ''; this.launchAnim(p); }
      this.onKo(p, this.f[1 - p.idx]);
    }
  }

  // ───────────────────────────── 飞行道具 ─────────────────────────────
  private spawnProjectile(p: Fighter, id: string) {
    const d = p.def.projectiles[id]; if (!d) return;
    const pr: Projectile = { id: this.pid++, owner: p.idx, def: d, x: p.x + p.facing * 0.9 * p.scale, y: d.ground ? 0 : d.y * p.scale, px: 0, dir: p.facing, life: d.life, hitsLeft: d.hits ?? 1, gap: 0, dead: false };
    pr.px = pr.x;
    this.projectiles.push(pr);
    this.emit({ type: 'projSpawn', who: p.idx, id: pr.id, def: id });
  }

  private stepProjectiles() {
    for (const pr of this.projectiles) {
      if (pr.dead) continue;
      pr.px = pr.x;
      pr.x += pr.def.speed * pr.dir * DT; pr.life--; if (pr.gap > 0) pr.gap--;
      const b = pr.def.box;
      const box: Box = [pr.x + Math.min(b[0] * pr.dir, b[2] * pr.dir), pr.y + b[1], pr.x + Math.max(b[0] * pr.dir, b[2] * pr.dir), pr.y + b[3]];
      // 两发对撞，同归于尽
      for (const other of this.projectiles) {
        if (other === pr || other.dead || other.owner === pr.owner) continue;
        const ob = other.def.box;
        const obox: Box = [other.x + Math.min(ob[0] * other.dir, ob[2] * other.dir), other.y + ob[1], other.x + Math.max(ob[0] * other.dir, ob[2] * other.dir), other.y + ob[3]];
        if (overlap(box, obox)) {
          pr.dead = other.dead = true;
          this.emit({ type: 'projEnd', id: pr.id, x: (pr.x + other.x) / 2, y: pr.y + (b[1] + b[3]) / 2, hit: true });
          this.emit({ type: 'projEnd', id: other.id, x: (pr.x + other.x) / 2, y: other.y + (ob[1] + ob[3]) / 2, hit: true });
        }
      }
      if (pr.dead) continue;
      const def = this.f[1 - pr.owner];
      const hurt = def.hurtbox();
      if (hurt && pr.gap <= 0 && overlap(box, hurt) && !this.cine) {
        const cx = clamp(pr.x, hurt[0], hurt[2]), cy = clamp(pr.y + (b[1] + b[3]) / 2, hurt[1], hurt[3]);
        this.applyHit(this.f[pr.owner], def, { f: 0, a: 1, ...pr.def.hit }, pr.def.id, cx, cy, pr.dir, true);
        pr.hitsLeft--; pr.gap = pr.def.hitGap ?? 8;
        if (pr.hitsLeft <= 0) { pr.dead = true; this.emit({ type: 'projEnd', id: pr.id, x: cx, y: cy, hit: true }); }
      }
      if (!pr.dead && (pr.life <= 0 || Math.abs(pr.x) > STAGE_HALF + 2.5)) { pr.dead = true; this.emit({ type: 'projEnd', id: pr.id, x: pr.x, y: pr.y + (b[1] + b[3]) / 2, hit: false }); }
    }
    this.projectiles = this.projectiles.filter((p) => !p.dead);
  }

  // ───────────────────────────── 大招演出 ─────────────────────────────
  private startCine(att: Fighter, def: Fighter) {
    const plan = att.def.cine; if (!plan) return;
    att.move = null; def.move = null;
    att.setState('cine'); def.setState('cineVictim');
    att.hitstop = def.hitstop = 0; att.vx = att.vy = def.vx = def.vy = 0; att.y = def.y = 0; att.kb = def.kb = 0;
    // 站位：对手放在面前固定距离，靠墙就把自己往回挪
    const gap = plan.gap * att.scale + def.half;
    let dx = att.x + att.facing * gap;
    if (Math.abs(dx) > STAGE_HALF) { dx = clamp(dx, -STAGE_HALF, STAGE_HALF); att.x = dx - att.facing * gap; }
    def.x = dx; def.facing = -att.facing as 1 | -1;
    att.setAnim(plan.clip, 0.1, false, plan.warp[0][1], 0);
    def.setAnim(def.meta('hit_mid') ? 'hit_mid' : 'idle', 0.1, false, 0, 0);
    this.cine = { att: att.idx, def: def.idx, f: 0 };
    this.projectiles.length = 0;
    this.emit({ type: 'cineStart', who: att.idx });
  }

  private stepCine() {
    const c = this.cine!; const att = this.f[c.att], def = this.f[c.def]; const plan = att.def.cine!;
    c.f++;
    const t0 = piecewise(plan.warp, c.f), t1 = piecewise(plan.warp, c.f + 1);
    att.anim.t = t0; att.anim.rate = (t1 - t0) / DT;
    def.anim.t += def.anim.rate * DT;
    if (def.shakeF > 0) def.shakeF--;
    for (let i = 0; i < plan.beats.length; i++) {
      const b = plan.beats[i];
      if (b.f !== c.f) continue;
      const dmg = this.training ? 0 : Math.min(def.hp - (b.final ? 0 : 1), b.dmg);
      def.hp = Math.max(0, def.hp - Math.max(0, dmg)); def.comboHits++; def.comboDmg += Math.max(0, dmg);
      def.shakeF = 10;
      if (!b.final) this.playReact(def, { f: 0, a: 1, dmg: 0, react: b.react, heavy: b.heavy }, 22);
      this.emit({ type: 'cineBeat', who: att.idx, beat: i, final: !!b.final });
      if (b.final) {
        const kill = def.hp <= 0 && !this.training;
        def.setState('launched'); def.launchF = 0; def.juggle = 20; def.gScale = 1.0; def.invul = 999;
        def.vx = plan.launch[0] * att.facing; def.vy = plan.launch[1]; def.y = 0.05;
        const g = GRAVITY; def.launchDur = Math.round(((def.vy + Math.sqrt(def.vy * def.vy + 2 * g * def.y)) / g) * SIM_HZ);
        if (kill) def.koFlag = true;
        def.anim.name = ''; this.launchAnim(def);
        this.emit({ type: 'hit', att: att.idx, def: def.idx, hit: { f: 0, a: 1, dmg: b.dmg, heavy: true, knock: 'launch', el: att.def.el, tag: 'cineFinal' }, move: 'ult', x: def.x, y: 1.1 * def.scale, blocked: false, parry: false, combo: def.comboHits, dmg: Math.max(0, dmg), counter: false, kill, air: false });
        if (kill) this.onKo(def, att);
      }
    }
    if (c.f >= plan.total) {
      att.setState('stand'); att.setAnim('idle', 0.25, true, 0);
      if (def.state === 'cineVictim') { def.setState('stand'); def.setAnim('idle', 0.2, true, 0); }
      this.cine = null;
      this.emit({ type: 'cineEnd', who: att.idx });
    }
  }
}

export { approach };
