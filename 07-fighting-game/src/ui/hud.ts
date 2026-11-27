// 对战界面：血条、气槽、防御条、倒计时、胜局、连击、提示字、招式名、大招切入、回合播报、训练说明。
// 数值每帧从 game.match 读，只在变了的时候写 DOM；动效全部用 transform / opacity。
import type { FightEvent } from '../combat/types';
import type { Game, Presenter } from '../game';
import { ROUNDS_TO_WIN } from '../core/config';
import { anim, EASE, esc, h, setOp, setText, setTf, toggle, uiRoot } from './dom';
import { art, KEYSETS, moveList, needFlip, roundName, rosterOf, ultName } from './data';

interface Side {
  root: HTMLElement; face: HTMLImageElement; name: HTMLElement; title: HTMLElement;
  fill: HTMLElement; ghost: HTMLElement; flash: HTMLElement; guard: HTMLElement; guardWrap: HTMLElement;
  meter: HTMLElement; meterWrap: HTMLElement; meterLabel: HTMLElement; wins: HTMLElement[];
  combo: HTMLElement; comboN: HTMLElement; comboD: HTMLElement; callouts: HTMLElement; moveName: HTMLElement;
  // 状态
  hp: number; ghostV: number; ghostHold: number; meterV: number; full: boolean; winsV: number;
  comboShown: number; comboHold: number; comboVisible: boolean; lastCombo: number; lastDmg: number;
}

export class Hud implements Presenter {
  readonly el: HTMLElement;
  private top: HTMLElement;
  private sides: Side[] = [];
  private timer: HTMLElement; private timerNum: HTMLElement; private roundLbl: HTMLElement;
  private ann: HTMLElement;
  private cut: HTMLElement;
  private training: HTMLElement;
  /** 菜单可以强制隐藏对战界面 */
  visible = true;
  private lastPhase = ''; private lastTimer = -1;
  private annToken = 0;
  /** 本帧更新的耗时（毫秒），调试用；costSum / costN 是累计 */
  cost = 0; costSum = 0; costN = 0;

  constructor(private game: Game) {
    this.el = h('div', 'hud is-hidden');
    this.top = h('div', 'hud-top');
    this.timer = h('div', 'hud-timer', '<div class="tm-frame"></div><b class="tm-num">99</b><em class="tm-round">第一回合</em>');
    this.timerNum = this.timer.querySelector('.tm-num')!; this.roundLbl = this.timer.querySelector('.tm-round')!;
    const s0 = this.makeSide(0), s1 = this.makeSide(1);
    this.top.append(s0.root, this.timer, s1.root);
    this.ann = h('div', 'ann');
    this.cut = h('div', 'cutin');
    this.training = h('div', 'train');
    this.el.append(this.top, s0.combo, s1.combo, s0.callouts, s1.callouts, s0.moveName, s1.moveName, this.training, this.cut, this.ann);
    uiRoot().append(this.el);
  }

  private makeSide(i: number): Side {
    const root = h('div', `hs p${i + 1}`);
    root.innerHTML = `
      <div class="hs-face"><img alt=""><i class="hs-face-edge"></i></div>
      <div class="hs-main">
        <div class="hs-name"><b></b><span></span></div>
        <div class="hp"><div class="hp-in"><i class="hp-ghost"></i><i class="hp-flash"></i><i class="hp-fill"></i><i class="hp-ticks"></i></div></div>
        <div class="guard"><i></i></div>
        <div class="meter-row"><div class="meter"><i class="meter-fill"></i><i class="meter-sheen"></i><i class="meter-ticks"></i></div><span class="meter-label"></span></div>
      </div>
      <div class="hs-wins"></div>`;
    const wins: HTMLElement[] = [];
    const wv = root.querySelector('.hs-wins') as HTMLElement;
    for (let k = 0; k < ROUNDS_TO_WIN; k++) { const w = h('i', 'win'); wv.append(w); wins.push(w); }
    const combo = h('div', `combo p${i + 1}`, '<div class="combo-n"><b>0</b><span>连</span></div><div class="combo-d">伤害 <b>0</b></div>');
    const callouts = h('div', `callouts p${i + 1}`);
    const moveName = h('div', `movename p${i + 1}`);
    const q = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;
    const side: Side = {
      root, face: q('.hs-face img'), name: q('.hs-name b'), title: q('.hs-name span'),
      fill: q('.hp-fill'), ghost: q('.hp-ghost'), flash: q('.hp-flash'), guard: q('.guard i'), guardWrap: q('.guard'),
      meter: q('.meter-fill'), meterWrap: q('.meter-row'), meterLabel: q('.meter-label'), wins,
      combo, comboN: combo.querySelector('.combo-n b')!, comboD: combo.querySelector('.combo-d b')!, callouts, moveName,
      hp: 1, ghostV: 1, ghostHold: 0, meterV: -1, full: false, winsV: -1,
      comboShown: 0, comboHold: 0, comboVisible: false, lastCombo: 0, lastDmg: 0,
    };
    this.sides[i] = side;
    return side;
  }

  // ───────────────────────────── 生命周期 ─────────────────────────────
  onMatchStart(game: Game) {
    const cfg = game.config!, m = game.match!;
    toggle(this.el, 'is-showcase', !!cfg.showcase);
    for (const [i, s] of this.sides.entries()) {
      const f = m.f[i], r = rosterOf(f.def.id);
      s.root.style.setProperty('--c', r.color);
      for (const e of [s.combo, s.callouts, s.moveName]) e.style.setProperty('--c', r.color);
      s.face.src = art.face(f.def.id); toggle(s.face, 'flip', needFlip(f.def.id, 'portrait', i === 0 ? 1 : -1));
      s.name.textContent = f.def.name; s.title.textContent = f.def.title;
      s.meterLabel.textContent = `${ultName(f.def.id, f.def)} · 就绪`;
      s.hp = s.ghostV = 1; s.ghostHold = 0; s.meterV = -1; s.full = false; s.winsV = -1;
      s.comboShown = 0; s.comboVisible = false; toggle(s.combo, 'on', false);
      setTf(s.fill, 'scaleX(1)'); setTf(s.ghost, 'scaleX(1)'); setOp(s.flash, '0');
      s.callouts.replaceChildren(); s.moveName.replaceChildren();
    }
    this.ann.replaceChildren(); this.cut.replaceChildren();
    this.lastPhase = ''; this.lastTimer = -2;
    toggle(this.el, 'is-training', !!cfg.training);
    this.buildTraining(game);
    toggle(this.top, 'in', false);
  }

  onMatchEnd() { this.ann.replaceChildren(); this.cut.replaceChildren(); }

  private buildTraining(game: Game) {
    const cfg = game.config!; const m = game.match!;
    if (!cfg.training) { this.training.replaceChildren(); return; }
    const both = cfg.ctrl[0] === 'human' && cfg.ctrl[1] === 'human';
    const map = both ? KEYSETS.p1 : KEYSETS.solo;
    const ml = moveList(m.f[0].def, map);
    const row = (r: { input: string; name: string; tag?: string }) => `<li><kbd>${esc(r.input)}</kbd><span>${esc(r.name)}${r.tag ? `<em>${r.tag}</em>` : ''}</span></li>`;
    this.training.innerHTML = `
      <div class="train-h"><b>训练</b><span>不掉血 · 气槽常满 · Esc 暂停</span></div>
      <ul class="train-l">${ml.system.map(row).join('')}</ul>
      <div class="train-sub">技 / 绝技</div><ul class="train-l">${ml.specials.map(row).join('')}</ul>
      <div class="train-sub">拳脚</div><ul class="train-l">${ml.normals.map(row).join('')}</ul>`;
  }

  // ───────────────────────────── 每帧 ─────────────────────────────
  update(dt: number, _sdt: number, game: Game) {
    const t0 = performance.now();
    const m = game.match, cfg = game.config;
    const show = this.visible && !!m && !!cfg && !cfg.showcase;
    toggle(this.el, 'is-hidden', !show);
    if (!show || !m) { this.cost = performance.now() - t0; return; }

    // 第一回合的出场镜头期间把顶栏收起来，进入准备阶段再放下
    const phase = m.phase;
    if (phase !== this.lastPhase) {
      const prev = this.lastPhase; this.lastPhase = phase;
      if (phase === 'intro' && m.round === 1) toggle(this.top, 'in', false);
      else toggle(this.top, 'in', true);
      if (phase === 'ready') this.announceRound(m.round, this.isFinal(game));
      if (phase === 'fight' && prev === 'ready') this.announceFight();
    }
    if (game.paused) { this.cost = performance.now() - t0; return; }

    // 倒计时
    const secs = cfg!.training ? -1 : Math.max(0, Math.ceil(m.timer / 60));
    if (secs !== this.lastTimer) {
      this.lastTimer = secs;
      setText(this.timerNum, secs < 0 ? '∞' : String(secs));
      toggle(this.timer, 'low', secs >= 0 && secs <= 10 && phase === 'fight');
      if (secs >= 0 && secs <= 10 && phase === 'fight') anim(this.timerNum, [{ transform: 'scale(1.35)' }, { transform: 'scale(1)' }], 260, { easing: EASE.back });
    }
    setText(this.roundLbl, roundName(m.round, this.isFinal(game)));

    for (let i = 0; i < 2; i++) {
      const s = this.sides[i], f = m.f[i];
      // 血：先闪白（被打掉的那一段），残影停一下再追上来
      const hp = Math.max(0, f.hp / f.def.hp);
      if (hp < s.hp - 1e-4) {
        setTf(s.flash, `scaleX(${s.hp.toFixed(4)})`);
        anim(s.flash, [{ opacity: 1 }, { opacity: 1, offset: 0.25 }, { opacity: 0 }], 320, { easing: EASE.lin });
        anim(s.root.querySelector('.hp')!, [{ transform: `translateX(${i === 0 ? -6 : 6}px)` }, { transform: 'translateX(0)' }], 160, { fill: 'none' });
        s.ghostHold = 0.55;
        if (s.ghostV < s.hp) s.ghostV = s.hp;
      } else if (hp > s.hp + 1e-4) { if (s.ghostV < hp) s.ghostV = hp; }
      s.hp = hp;
      if (s.ghostHold > 0) s.ghostHold -= dt;
      else if (s.ghostV > hp) s.ghostV = Math.max(hp, s.ghostV - dt * 0.9);
      setTf(s.fill, `scaleX(${hp.toFixed(4)})`);
      setTf(s.ghost, `scaleX(${Math.max(hp, s.ghostV).toFixed(4)})`);
      toggle(s.root, 'danger', hp <= 0.25 && hp > 0);

      // 防御条
      const g = Math.max(0, f.guard / 100);
      setTf(s.guard, `scaleX(${g.toFixed(3)})`);
      toggle(s.guardWrap, 'low', g < 0.3);
      toggle(s.guardWrap, 'broken', f.state === 'dizzy');

      // 气
      const mv = Math.round(f.meter);
      if (mv !== s.meterV) { s.meterV = mv; setTf(s.meter, `scaleX(${(mv / 100).toFixed(3)})`); }
      const full = f.meter >= 100;
      if (full !== s.full) {
        s.full = full; toggle(s.root, 'full', full);
        if (full) anim(s.meterLabel, [{ opacity: 0, transform: 'translateY(30%) scale(1.3)' }, { opacity: 1, transform: 'none' }], 380, { easing: EASE.back, fill: 'none' });
      }

      // 胜局
      if (f.wins !== s.winsV) {
        const before = s.winsV; s.winsV = f.wins;
        s.wins.forEach((w, k) => {
          toggle(w, 'on', k < f.wins);
          if (before >= 0 && k < f.wins && k >= before) anim(w, [{ transform: 'rotate(45deg) scale(2.4)', opacity: 0 }, { transform: 'rotate(45deg) scale(1)', opacity: 1 }], 380, { easing: EASE.in, fill: 'none' });
        });
      }

      // 连击：comboHits 记在挨打的人身上，显示在出手的一侧
      this.updateCombo(this.sides[1 - i], f.comboHits, f.comboDmg, dt);
    }
    this.cost = performance.now() - t0; this.costSum += this.cost; this.costN++;
  }

  private isFinal(game: Game) { const m = game.match!; return m.f[0].wins === ROUNDS_TO_WIN - 1 && m.f[1].wins === ROUNDS_TO_WIN - 1; }

  private updateCombo(s: Side, hits: number, dmg: number, dt: number) {
    if (hits >= 2) {
      if (hits !== s.lastCombo) {
        s.lastCombo = hits; s.comboShown = hits; s.comboHold = 1.1;
        setText(s.comboN, String(hits));
        if (!s.comboVisible) { s.comboVisible = true; toggle(s.combo, 'on', true); anim(s.combo, [{ opacity: 0, transform: `translateX(${s === this.sides[0] ? -40 : 40}px)` }, { opacity: 1, transform: 'none' }], 200, { fill: 'none' }); }
        anim(s.comboN, [{ transform: 'scale(1.7) rotate(-4deg)' }, { transform: 'scale(0.94)', offset: 0.55 }, { transform: 'scale(1)' }], 220, { easing: EASE.out, fill: 'none' });
        toggle(s.combo, 'big', hits >= 10);
      }
      if (dmg !== s.lastDmg) { s.lastDmg = dmg; setText(s.comboD, String(dmg)); }
    } else {
      s.lastCombo = 0;
      if (s.comboVisible) {
        s.comboHold -= dt;
        if (s.comboHold <= 0) {
          s.comboVisible = false;
          anim(s.combo, [{ opacity: 1 }, { opacity: 0, transform: 'translateY(-12px)' }], 220, { easing: EASE.in, fill: 'none' }).onfinish = () => { if (!s.comboVisible) toggle(s.combo, 'on', false); };
        } else toggle(s.combo, 'done', true);
      }
    }
    if (hits >= 2) toggle(s.combo, 'done', false);
  }

  // ───────────────────────────── 事件 ─────────────────────────────
  onEvent(e: FightEvent, game: Game) {
    if (!this.visible || game.config?.showcase) return;
    const m = game.match!;
    switch (e.type) {
      case 'hit':
        if (e.parry) this.callout(e.def, '弹反', 'parry');
        else if (e.counter && !e.blocked) this.callout(e.att, '破招', 'counter');
        break;
      case 'guardBreak': this.callout(1 - e.who, '破防', 'gbreak'); break;
      case 'moveStart': {
        const mv = m.f[e.who].def.moves[e.move];
        if (mv && mv.kind === 'special') this.flashMove(e.who, mv.name);
        break;
      }
      case 'superFreeze': this.superCut(e.who, game, e.move); break;
      case 'round':
        if (e.phase === 'ko') this.announceBig('终结', 'ko');
        else if (e.phase === 'timeup') this.announceBig('时间到', 'timeup');
        else if (e.phase === 'win') {
          const w = e.winner ?? -1;
          if (w < 0) this.announceBig('平局', 'draw');
          else {
            const f = m.f[w];
            this.announceWin(w, f.def.name, f.hp >= f.def.hp);
          }
        }
        break;
    }
  }

  // ───────────────────────────── 提示字 ─────────────────────────────
  private callout(side: number, text: string, kind: string) {
    const s = this.sides[side];
    const c = h('div', `callout ${kind}`, `<span>${text}</span>`);
    s.callouts.prepend(c);
    while (s.callouts.children.length > 2) s.callouts.lastElementChild!.remove();
    anim(c, [
      { opacity: 0, transform: 'scale(2.2) rotate(-8deg)' },
      { opacity: 1, transform: 'scale(0.92) rotate(-3deg)', offset: 0.12 },
      { opacity: 1, transform: 'scale(1) rotate(-3deg)', offset: 0.2 },
      { opacity: 1, transform: 'scale(1) rotate(-3deg)', offset: 0.85 },
      { opacity: 0, transform: 'scale(1.05) rotate(-3deg)' },
    ], 1300, { easing: EASE.lin }).onfinish = () => c.remove();
  }

  private flashMove(side: number, name: string) {
    const s = this.sides[side];
    const c = h('div', 'mv', `<i class="mv-ink"></i><b>${esc(name)}</b>`);
    s.moveName.replaceChildren(c);
    const dx = side === 0 ? -1 : 1;
    anim(c.querySelector('.mv-ink')!, [{ transform: `translateX(${dx * 70}%) scaleX(0.3)`, opacity: 0 }, { transform: 'none', opacity: 1 }], 180);
    anim(c.querySelector('b')!, [{ transform: `translateX(${dx * 30}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], 220, { delay: 40 });
    anim(c, [{ opacity: 1 }, { opacity: 0 }], 260, { delay: 1000, easing: EASE.in }).onfinish = () => c.remove();
  }

  // ───────────────────────────── 大招切入 ─────────────────────────────
  private superCut(who: number, game: Game, moveId: string) {
    const f = game.match!.f[who], r = rosterOf(f.def.id);
    const name = f.def.moves[moveId]?.name ?? ultName(f.def.id, f.def);
    const dir = who === 0 ? 1 : -1;
    const c = h('div', `cut p${who + 1}`);
    c.style.setProperty('--c', r.color);
    c.innerHTML = `
      <i class="cut-dim"></i>
      <div class="cut-band"><div class="cut-band-in"><img src="${art.super(f.def.id)}" alt="" class="${needFlip(f.def.id, 'super', dir) !== (who === 1) ? 'flip' : ''}"><i class="cut-tint"></i></div></div>
      <i class="cut-line a"></i><i class="cut-line b"></i>
      <div class="cut-text"><div class="cut-wipe"><div class="cut-wipe-in"><b>${esc(name)}</b></div></div><span>${esc(f.def.name)} · 绝技</span></div>`;
    this.cut.replaceChildren(c);
    const band = c.querySelector('.cut-band')!, img = c.querySelector('.cut-band img')!;
    const wipe = c.querySelector('.cut-wipe')!, wipeIn = c.querySelector('.cut-wipe-in')!, sub = c.querySelector('.cut-text span')!;
    anim(c.querySelector('.cut-dim')!, [{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }], 1150, { easing: EASE.lin });
    // 墨笔从发招者那一侧横扫过来
    anim(band, [
      { transform: `translateX(${-dir * 105}%) skewX(${-dir * 8}deg)` },
      { transform: `translateX(${dir * 1.5}%) skewX(0deg)`, offset: 0.16 },
      { transform: 'translateX(0)', offset: 0.22 },
      { transform: `translateX(${dir * 3}%)`, offset: 0.84 },
      { transform: `translateX(${dir * 105}%) scaleY(0.6)` },
    ], 1150, { easing: EASE.out });
    anim(img, [{ transform: `scale(1.18) translateX(${-dir * 3}%)` }, { transform: `scale(1.04) translateX(${dir * 2}%)` }], 1150, { easing: EASE.lin });
    for (const [k, l] of [...c.querySelectorAll('.cut-line')].entries())
      anim(l, [{ transform: `translateX(${-dir * 120}%)` }, { transform: `translateX(${dir * 120}%)` }], 420 + k * 120, { delay: 60 + k * 50, easing: EASE.out });
    // 名字：遮罩擦除 + 轻微缩放回弹
    anim(wipe, [{ transform: `translateX(${-dir * 101}%)` }, { transform: 'translateX(0)' }], 300, { delay: 160, easing: EASE.out });
    anim(wipeIn, [{ transform: `translateX(${dir * 101}%) scale(1.25)` }, { transform: 'translateX(0) scale(1)' }], 300, { delay: 160, easing: EASE.out });
    anim(sub, [{ opacity: 0, transform: 'translateY(40%)' }, { opacity: 1, transform: 'none' }], 260, { delay: 340 });
    anim(c.querySelector('.cut-text')!, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${dir * 6}%)` }], 160, { delay: 980, easing: EASE.in }).onfinish = () => c.remove();
  }

  // ───────────────────────────── 回合播报 ─────────────────────────────
  private stage(kind: string, html: string): HTMLElement {
    const t = ++this.annToken;
    const c = h('div', `an ${kind}`, html);
    c.dataset.t = String(t);
    this.ann.replaceChildren(c);
    return c;
  }
  /** 毛笔一笔扫出来：外层往右揭开，内层反向抵消，看起来像擦除遮罩 */
  private stroke(c: HTMLElement, delay = 0, dur = 340) {
    const w = c.querySelector('.an-wipe'), wi = c.querySelector('.an-wipe-in'), ink = c.querySelector('.an-ink');
    if (ink) anim(ink, [{ transform: 'translateX(-60%) scaleX(0.2)', opacity: 0 }, { transform: 'translateX(0) scaleX(1)', opacity: 1 }], dur * 0.9, { delay });
    if (w && wi) {
      anim(w, [{ transform: 'translateX(-102%)' }, { transform: 'translateX(0)' }], dur, { delay: delay + 40 });
      anim(wi, [{ transform: 'translateX(102%) scale(1.18)' }, { transform: 'translateX(0) scale(0.97)', offset: 0.75 }, { transform: 'translateX(0) scale(1)' }], dur + 120, { delay: delay + 40 });
    }
  }
  private leave(c: HTMLElement, after: number) {
    anim(c, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(1.06)' }], 160, { delay: after, easing: EASE.in }).onfinish = () => c.remove();
  }

  announceRound(round: number, final: boolean) {
    const c = this.stage('round', `<i class="an-ink"></i><div class="an-wipe"><div class="an-wipe-in"><b>${roundName(round, final)}</b></div></div>`);
    this.stroke(c);
    this.leave(c, 1050);
    this.sfx('round_gong');
  }
  announceFight() {
    const c = this.stage('fight', `<i class="an-ink"></i><div class="an-wipe"><div class="an-wipe-in"><b>开战</b><i class="an-seal">斗</i></div></div>`);
    this.stroke(c, 0, 260);
    anim(c.querySelector('.an-seal')!, [{ opacity: 0, transform: 'scale(2.6) rotate(-14deg)' }, { opacity: 1, transform: 'scale(1) rotate(-6deg)' }], 220, { delay: 200, easing: EASE.in });
    anim(c, [{ transform: 'scale(1)' }, { transform: 'scale(1.03)' }], 700, { delay: 260, easing: EASE.lin, fill: 'none' });
    this.leave(c, 760);
    this.sfx('fight_drum');
  }
  private announceBig(text: string, kind: string) {
    const c = this.stage(`big ${kind}`, `<i class="an-ink"></i><div class="an-wipe"><div class="an-wipe-in"><b>${text}</b></div></div>`);
    if (kind === 'ko') {
      anim(c.querySelector('.an-wipe-in')!, [{ transform: 'scale(2.4)', opacity: 0 }, { transform: 'scale(0.94)', opacity: 1, offset: 0.6 }, { transform: 'scale(1)', opacity: 1 }], 280, { easing: EASE.in });
      anim(c.querySelector('.an-ink')!, [{ transform: 'scaleX(0.1)', opacity: 0 }, { transform: 'scaleX(1)', opacity: 1 }], 220, { delay: 120 });
      anim(c, [{ transform: 'translate(0,0)' }, { transform: 'translate(-8px,5px)' }, { transform: 'translate(7px,-4px)' }, { transform: 'translate(-4px,2px)' }, { transform: 'translate(0,0)' }], 260, { delay: 160, easing: EASE.lin, fill: 'none' });
    } else this.stroke(c);
    this.leave(c, 1500);
  }
  private announceWin(w: number, name: string, perfect: boolean) {
    const c = this.stage(`victory p${w + 1}`, `<i class="an-ink"></i><div class="an-wipe"><div class="an-wipe-in"><b>${esc(name)}</b><b class="an-sheng">胜</b></div></div>${perfect ? '<div class="an-perfect"><span>完美</span></div>' : ''}`);
    c.style.setProperty('--c', rosterOf(this.game.match!.f[w].def.id).color);
    this.stroke(c, 0, 380);
    const p = c.querySelector('.an-perfect');
    if (p) anim(p, [{ opacity: 0, transform: 'scale(2) rotate(-10deg)' }, { opacity: 1, transform: 'scale(1) rotate(-4deg)' }], 260, { delay: 520, easing: EASE.in });
    this.leave(c, 2600);
  }

  /** 截图调试：把播报 / 切入的动画停在第 ms 毫秒 */
  freeze(ms: number) { for (const a of this.el.getAnimations({ subtree: true })) { a.pause(); a.currentTime = ms; } }
  thaw() { for (const a of this.el.getAnimations({ subtree: true })) a.play(); }

  private sfx(name: string) { try { (this as any).audio?.play(name); } catch { /* 没有音频 */ } }
  /** app 会把 FightPresenter 的 audio 接进来 */
  audio: { play(n: string, o?: any): void } | null = null;
}
