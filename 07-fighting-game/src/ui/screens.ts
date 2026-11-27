// 菜单界面：主菜单、选人、对阵、结算、暂停、出招表。
// 每个界面是一个返回 Promise 的函数，结果交给 app.ts 的流程去走。
import * as THREE from 'three';
import type { Controller, Game } from '../game';
import { anim, EASE, esc, h, keyLabel, toggle, uiRoot, wait } from './dom';
import { art, KEYSETS, keysFor, LEVELS, moveList, needFlip, roster, rosterOf, ultName, type MoveRow } from './data';
import { nav, type NavAct } from './nav';
import { KEYS_P1, KEYS_P2 } from '../core/input';

export type Mode = 'solo' | 'versus' | 'watch' | 'training';
export interface Sel { mode: Mode; p1: string; p2: string; level: number; ctrl: [Controller, Controller] }

export interface Ctx {
  game: Game;
  sfx(name: string): void;
  music(name: 'menu' | 'battle' | 'victory'): void;
  /** 让背后的 3D 场景摆出这两个人（展示模式），排队执行，不会并发 */
  showcase(p1: string, p2: string): Promise<void>;
  /** 镜头：-1 全景，0 / 1 给某一侧的角色近景 */
  focus(side: -1 | 0 | 1, wide?: 'menu' | 'select'): void;
}

const KEY = (codes: string[]) => keyLabel(codes[0]);
function keysBar(items: [string, string][]) {
  return `<div class="keys">${items.map(([k, t]) => `<span><kbd>${esc(k)}</kbd>${esc(t)}</span>`).join('')}</div>`;
}
const navKeys = () => keysBar([
  [`${KEY(KEYS_P1.up)} ${KEY(KEYS_P1.down)} / ↑ ↓`, '选择'],
  [`${KEY(KEYS_P1.L)} / 回车`, '确认'],
  [`${KEY(KEYS_P1.H)} / Esc`, '返回'],
]);

function mount(el: HTMLElement) {
  uiRoot().append(el);
  anim(el, [{ opacity: 0 }, { opacity: 1 }], 260, { fill: 'none' });
}
async function unmount(el: HTMLElement, ms = 200) {
  const a = anim(el, [{ opacity: 1 }, { opacity: 0 }], ms, { easing: EASE.in });
  await a.finished.catch(() => {});
  el.remove();
}

// ───────────────────────────── 竖排菜单 ─────────────────────────────
interface Item { id: string; t: string; d?: string }
class VMenu {
  readonly el: HTMLElement; idx = 0; private items: HTMLElement[] = [];
  constructor(private list: Item[], private ctx: Ctx, private onPick: (id: string) => void, start = 0) {
    this.el = h('div', 'menu');
    for (const [i, it] of list.entries()) {
      const e = h('div', 'mi', `<i class="mi-ink"></i><span class="mi-t">${esc(it.t)}</span>${it.d ? `<span class="mi-d">${esc(it.d)}</span>` : ''}`);
      e.addEventListener('pointerenter', () => this.set(i));
      e.addEventListener('click', () => { this.set(i, true); this.pick(); });
      this.el.append(e); this.items.push(e);
    }
    this.set(start, true);
  }
  set(i: number, silent = false) {
    i = (i + this.list.length) % this.list.length;
    if (i === this.idx && !silent) return;
    this.idx = i; this.items.forEach((e, k) => toggle(e, 'on', k === i));
    if (!silent) this.ctx.sfx('ui_move');
  }
  pick() {
    this.ctx.sfx('ui_confirm');
    const e = this.items[this.idx];
    anim(e, [{ transform: 'translateX(1.2rem) scale(1.04)' }, { transform: 'none' }], 240, { fill: 'none' });
    this.onPick(this.list[this.idx].id);
  }
  key(a: NavAct) {
    if (a.kind === 'up') this.set(this.idx - 1);
    else if (a.kind === 'down') this.set(this.idx + 1);
    else if (a.kind === 'ok') this.pick();
  }
}

function fightKeys() {
  const k = keysFor(KEYSETS.solo);
  return `<div class="keys fight-keys"><span class="fk-h">对战</span>${([[`${k.left} ${k.right} / ← →`, '移动'], [k.up, '跳'], [k.L, '轻击'], [k.H, '重击'], [k.S, '技'], [k.G, '防御'], [k.T, '投'], [k.U, '绝技'], [k.D, '冲刺'], ['Esc', '暂停']] as [string, string][]).map(([a, b]) => `<span><kbd>${esc(a)}</kbd>${b}</span>`).join('')}</div>`;
}

// ───────────────────────────── 主菜单 ─────────────────────────────
let lastMain = 0;
export function mainMenu(ctx: Ctx): Promise<Mode> {
  ctx.music('menu');
  ctx.focus(-1, 'menu');
  const a = roster[0].id, b = roster[1]?.id ?? a;
  ctx.showcase(a, b);
  return new Promise((resolve) => {
    const el = h('div', 'scr main');
    el.innerHTML = `
      <i class="scr-shade"></i>
      <div class="main-title"><h1><span class="t1">烬</span><span class="t2">霜</span></h1><i class="seal">武斗</i></div>
      <div class="main-sub">雪夜残寺 · 一拳一刀</div>
      ${keysBar([[`${KEY(KEYS_P1.up)} ${KEY(KEYS_P1.down)} / ↑ ↓`, '选择'], [`${KEY(KEYS_P1.L)} / 回车`, '确认'], ['鼠标', '点击']])}
      ${fightKeys()}
      <div class="main-ver">YANJIN × LINGSHUANG · 0.1</div>`;
    const items: Item[] = [
      { id: 'solo', t: '单人对战', d: '与电脑过招' },
      { id: 'versus', t: '双人对战', d: '同一键盘，各执一边' },
      { id: 'watch', t: '观战演示', d: '电脑对电脑，自动循环' },
      { id: 'training', t: '训练', d: '木桩陪练，出招表常驻' },
    ];
    let done = false;
    const menu = new VMenu(items, ctx, async (id) => {
      if (done) return; done = true; lastMain = menu.idx; off();
      await unmount(el, 220);
      resolve(id as Mode);
    }, lastMain);
    el.append(menu.el);
    mount(el);
    // 入场：标题一笔扫出
    const t = el.querySelector('h1')!;
    anim(t, [{ opacity: 0, transform: 'translateX(-4rem) scale(1.08)' }, { opacity: 1, transform: 'none' }], 700, { delay: 80 });
    anim(el.querySelector('.main-title .seal')!, [{ opacity: 0, transform: 'scale(2.4) rotate(-12deg)' }, { opacity: 1, transform: 'none' }], 260, { delay: 620, easing: EASE.in });
    anim(el.querySelector('.main-sub')!, [{ opacity: 0, transform: 'translateX(-2rem)' }, { opacity: 1, transform: 'none' }], 500, { delay: 420 });
    [...menu.el.children].forEach((c, i) => anim(c, [{ opacity: 0, transform: 'translateX(-3rem)' }, { opacity: 1, transform: 'none' }], 420, { delay: 500 + i * 60, fill: 'backwards' }));
    const off = nav.push((a) => menu.key(a));
  });
}

// ───────────────────────────── 选人 ─────────────────────────────
function statsHtml(stats: Record<string, number>) {
  return `<dl class="stats">${Object.entries(stats).map(([k, v]) => `<dt>${k}</dt><dd>${[1, 2, 3, 4, 5].map((n) => `<i class="${n <= v ? 'on' : ''}"></i>`).join('')}</dd>`).join('')}</dl>`;
}
function infoPanel(side: 0 | 1, slot: string) {
  const el = h('div', `info p${side + 1}`);
  const fill = (id: string) => {
    const r = rosterOf(id);
    el.style.setProperty('--c', r.color);
    el.innerHTML = `<div class="info-slot">${side === 0 ? '1P' : '2P'}<em>${slot}</em></div>
      <div class="info-name"><b>${r.name}</b><span>${r.title}</span></div>
      <div class="info-desc">${esc(r.desc)}</div>${statsHtml(r.stats)}
      <div class="info-slot" style="margin-top:2rem">绝技<em>${ultName(id)}</em></div>`;
  };
  return { el, fill };
}

export function selectScreen(ctx: Ctx, mode: Mode, prev?: Sel): Promise<Sel | null> {
  ctx.music('menu');
  const ids = roster.map((r) => r.id);
  const pick: [string, string] = [prev?.p1 ?? ids[0], prev?.p2 ?? ids[1] ?? ids[0]];
  const cur: [number, number] = [ids.indexOf(pick[0]), ids.indexOf(pick[1])];
  const locked = [false, false];
  const two = mode === 'versus';
  let step = 0;       // 单人 / 训练：0 选自己，1 选对手，2 选难度（单人）
  let level = prev?.level ?? 2;
  const titles: Record<Mode, [string, string]> = {
    solo: ['单人对战', '择一人出战，再择对手'], versus: ['双人对战', '各自择人，确认后开打'],
    training: ['训练', '择一人练招，再择陪练木桩'], watch: ['观战演示', '择两人对阵'],
  };

  return new Promise((resolve) => {
    const el = h('div', 'scr sel');
    el.innerHTML = `<i class="scr-shade"></i><div class="sel-head"><h2>${titles[mode][0]}</h2><p>${titles[mode][1]}</p></div>`;
    const info = [infoPanel(0, two ? '一号位' : '出战'), infoPanel(1, mode === 'training' ? '木桩' : two ? '二号位' : '对手')];
    el.append(info[0].el, info[1].el);
    const cardsEl = h('div', 'sel-cards'); el.append(cardsEl);
    const cards = ids.map((id, i) => {
      const r = rosterOf(id);
      const c = h('div', 'card', `<div class="card-in"><img src="${art.portrait(id)}" alt=""><div class="card-name"><b>${r.name}</b><span>${r.title}</span></div></div><div class="card-tags"><i class="ptag p1">1P</i><i class="ptag p2">${two ? '2P' : mode === 'training' ? '木桩' : 'CPU'}</i></div>`);
      c.style.setProperty('--c', r.color);
      c.addEventListener('pointerenter', () => { const s = activeSide(); if (s >= 0) move(s, i - cur[s]); });
      c.addEventListener('click', () => { const s = activeSide(); if (s >= 0) { move(s, i - cur[s]); confirm(s as 0 | 1); } });
      cardsEl.append(c);
      return c;
    });
    const lv = h('div', 'lv');
    lv.innerHTML = LEVELS.map((l) => `<div class="lv-i" data-lv="${l.lv}"><b><small>${'I'.repeat(l.lv)}</small>${l.name}</b><span>${l.desc}</span></div>`).join('');
    lv.style.display = 'none';
    el.append(lv);
    lv.querySelectorAll<HTMLElement>('.lv-i').forEach((e) => {
      e.addEventListener('pointerenter', () => { level = +e.dataset.lv!; render(); });
      e.addEventListener('click', () => { level = +e.dataset.lv!; render(); confirm(0); });
    });
    const p2keys = keysFor(KEYS_P2);
    el.insertAdjacentHTML('beforeend', two
      ? keysBar([['A D', '1P 选择'], [KEY(KEYS_P1.L), '1P 确认'], [KEY(KEYS_P1.H), '1P 取消'], ['← →', '2P 选择'], [p2keys.L, '2P 确认'], [p2keys.H, '2P 取消'], ['Esc', '返回']])
      : keysBar([['A D / ← →', '选择'], [`${KEY(KEYS_P1.L)} / 回车`, '确认'], [`${KEY(KEYS_P1.H)} / Esc`, '返回']]));
    mount(el);
    cards.forEach((c, i) => anim(c, [{ opacity: 0, transform: 'translateY(6rem)' }, { opacity: 1, transform: 'none' }], 460, { delay: 120 + i * 80, fill: 'backwards' }));

    let finished = false;
    function activeSide(): number {
      if (two) return !locked[0] ? 0 : !locked[1] ? 1 : -1;
      return step <= 1 ? step : -1;
    }
    function render() {
      for (const s of [0, 1] as const) info[s].fill(ids[cur[s]]);
      const act = activeSide();
      cards.forEach((c, i) => {
        toggle(c, 'hov', two ? (i === cur[0] || i === cur[1]) : act >= 0 ? i === cur[act] : (i === cur[0] || i === cur[1]));
        const t1 = c.querySelector('.ptag.p1') as HTMLElement, t2 = c.querySelector('.ptag.p2') as HTMLElement;
        toggle(t1, 'on', i === cur[0]); toggle(t2, 'on', (two || step >= 1) && i === cur[1]);
        toggle(t1, 'lock', locked[0] || (!two && step > 0)); toggle(t2, 'lock', locked[1] || (!two && step > 1));
      });
      toggle(info[0].el, 'locked', two ? locked[0] : step > 0);
      toggle(info[1].el, 'locked', two ? locked[1] : step > 1);
      toggle(info[1].el, 'wait', !two && step === 0);
      lv.style.display = mode === 'solo' && step === 2 ? 'flex' : 'none';
      lv.querySelectorAll<HTMLElement>('.lv-i').forEach((e) => toggle(e, 'on', +e.dataset.lv! === level));
      ctx.showcase(ids[cur[0]], ids[cur[1]]);
      ctx.focus(two ? -1 : act >= 0 ? (act as 0 | 1) : -1, 'select');
    }
    function move(s: number, d: number) {
      if (d === 0) return;
      cur[s] = (cur[s] + d + ids.length) % ids.length;
      ctx.sfx('ui_move');
      const c = cards[cur[s]];
      anim(c, [{ transform: 'translateY(-1.6rem) scale(1.05)' }, { transform: 'translateY(-1.6rem)' }], 200, { fill: 'none' });
      render();
    }
    async function confirm(s: 0 | 1) {
      ctx.sfx('ui_confirm');
      if (two) {
        if (locked[s]) return;
        locked[s] = true;
        anim(info[s].el.querySelector('.info-name b')!, [{ transform: 'scale(1.2)' }, { transform: 'none' }], 300, { easing: EASE.back });
        render();
        if (locked[0] && locked[1]) finish({ mode, p1: ids[cur[0]], p2: ids[cur[1]], level, ctrl: ['human', 'human'] });
        return;
      }
      anim(info[step === 2 ? 1 : step].el.querySelector('.info-name b')!, [{ transform: 'scale(1.2)' }, { transform: 'none' }], 300, { easing: EASE.back });
      if (step === 0) { step = 1; if (cur[1] === cur[0] && ids.length > 1) cur[1] = (cur[0] + 1) % ids.length; render(); return; }
      if (step === 1 && mode === 'solo') { step = 2; render(); return; }
      const ctrl: [Controller, Controller] = mode === 'training' ? ['human', 'dummy'] : mode === 'watch' ? ['cpu', 'cpu'] : ['human', 'cpu'];
      finish({ mode, p1: ids[cur[0]], p2: ids[cur[1]], level, ctrl });
    }
    function back(s: number) {
      ctx.sfx('ui_back');
      if (two) {
        if (locked[s]) { locked[s] = false; render(); return; }
        if (s === 1 && !locked[0]) return;
        if (locked[0] || locked[1]) { locked[0] = locked[1] = false; render(); return; }
        finish(null); return;
      }
      if (step > 0) { step--; render(); return; }
      finish(null);
    }
    async function finish(r: Sel | null) {
      if (finished) return; finished = true; off();
      await unmount(el, 220);
      resolve(r);
    }
    const off = nav.push((a) => {
      if (step === 2 && !two) {
        if (a.kind === 'left' || a.kind === 'up') { level = Math.max(1, level - 1); ctx.sfx('ui_move'); render(); }
        else if (a.kind === 'right' || a.kind === 'down') { level = Math.min(3, level + 1); ctx.sfx('ui_move'); render(); }
        else if (a.kind === 'ok') confirm(0);
        else if (a.kind === 'back') back(0);
        return;
      }
      // 双人时各控各的；单人时两套键都控当前这一步
      const s = two ? a.pad : activeSide();
      if (a.code === 'Escape' && two) { finish(null); return; }
      if (s < 0) return;
      if (a.kind === 'left' || a.kind === 'up') { if (!(two && locked[s])) move(s, -1); }
      else if (a.kind === 'right' || a.kind === 'down') { if (!(two && locked[s])) move(s, 1); }
      else if (a.kind === 'ok') confirm(s as 0 | 1);
      else if (a.kind === 'back') back(s);
    });
    render();
  });
}

// ───────────────────────────── 对阵过场 ─────────────────────────────
export async function versusScreen(ctx: Ctx, sel: Sel, label: string) {
  const r1 = rosterOf(sel.p1), r2 = rosterOf(sel.p2);
  const el = h('div', 'scr vs');
  el.innerHTML = `
    <div class="vs-half p1 ${needFlip(sel.p1, 'portrait', 1) ? 'flip' : ''}" style="--c:${r1.color}"><img src="${art.portrait(sel.p1)}" alt=""></div>
    <div class="vs-half p2 ${needFlip(sel.p2, 'portrait', -1) ? 'flip' : ''}" style="--c:${r2.color}"><img src="${art.portrait(sel.p2)}" alt=""></div>
    <i class="vs-slash"></i>
    <div class="vs-name p1" style="--c:${r1.color}"><b>${r1.name}</b><span>${r1.title}</span></div>
    <div class="vs-name p2" style="--c:${r2.color}"><b>${r2.name}</b><span>${r2.title}</span></div>
    <div class="vs-mid"><b>对</b><i class="seal">决</i></div>
    <div class="vs-round">${esc(label)}</div>`;
  uiRoot().append(el);
  const [h1, h2] = el.querySelectorAll<HTMLElement>('.vs-half');
  const [i1, i2] = el.querySelectorAll<HTMLElement>('.vs-half img');
  const [n1, n2] = el.querySelectorAll<HTMLElement>('.vs-name');
  const T = 2500;
  anim(el, [{ opacity: 0 }, { opacity: 1 }], 120);
  anim(h1, [{ transform: 'translateX(-60%)' }, { transform: 'translateX(1%)', offset: 0.13 }, { transform: 'translateX(0)', offset: 0.2 }, { transform: 'translateX(-1.5%)' }], T, { easing: EASE.lin });
  anim(h2, [{ transform: 'translateX(60%)' }, { transform: 'translateX(-1%)', offset: 0.13 }, { transform: 'translateX(0)', offset: 0.2 }, { transform: 'translateX(1.5%)' }], T, { easing: EASE.lin });
  const fl = (n: string) => (needFlip(n === 'a' ? sel.p1 : sel.p2, 'portrait', n === 'a' ? 1 : -1) ? ' scaleX(-1)' : '');
  anim(i1, [{ transform: 'scale(1.12)' + fl('a') }, { transform: 'scale(1.0)' + fl('a') }], T, { easing: EASE.lin });
  anim(i2, [{ transform: 'scale(1.12)' + fl('b') }, { transform: 'scale(1.0)' + fl('b') }], T, { easing: EASE.lin });
  anim(el.querySelector('.vs-slash')!, [{ opacity: 0, transform: 'rotate(11deg) scaleY(0)' }, { opacity: 1, transform: 'rotate(11deg) scaleY(1)' }], 260, { delay: 280 });
  anim(n1, [{ opacity: 0, transform: 'translateX(-6rem)' }, { opacity: 1, transform: 'none' }], 380, { delay: 380 });
  anim(n2, [{ opacity: 0, transform: 'translateX(6rem)' }, { opacity: 1, transform: 'none' }], 380, { delay: 380 });
  const mid = el.querySelector('.vs-mid')!;
  anim(mid, [{ opacity: 0, transform: 'scale(2.6)' }, { opacity: 1, transform: 'scale(0.94)', offset: 0.7 }, { opacity: 1, transform: 'scale(1)' }], 300, { delay: 560, easing: EASE.in });
  anim(el.querySelector('.vs-mid .seal')!, [{ opacity: 0, transform: 'scale(2) rotate(-14deg)' }, { opacity: 1, transform: 'rotate(-6deg)' }], 200, { delay: 900, easing: EASE.in });
  anim(el, [{ transform: 'translate(0,0)' }, { transform: 'translate(-6px,4px)' }, { transform: 'translate(5px,-3px)' }, { transform: 'translate(0,0)' }], 200, { delay: 760, easing: EASE.lin, fill: 'none' });
  anim(el.querySelector('.vs-round')!, [{ opacity: 0 }, { opacity: 1 }], 400, { delay: 700 });
  setTimeout(() => ctx.sfx('fight_drum'), 760);
  await wait(T - 250);
  return {
    /** 对战开始后再收起，免得露出加载中的画面 */
    close: async () => {
      anim(h1, [{ transform: 'translateX(-1.5%)' }, { transform: 'translateX(-105%)' }], 300, { easing: EASE.in });
      anim(h2, [{ transform: 'translateX(1.5%)' }, { transform: 'translateX(105%)' }], 300, { easing: EASE.in });
      await unmount(el, 320);
    },
  };
}

// ───────────────────────────── 结算 ─────────────────────────────
const QUOTES: Record<string, string[]> = {
  yanjin: ['火没灭，拳就不停。', '这一拳，你接得住几回？', '余烬未冷，再来。'],
  lingshuang: ['刀快，不如心静。', '三尺之内，皆是霜。', '雪落无声，你也一样。'],
};
export type ResultPick = 'again' | 'reselect' | 'menu';
export function resultScreen(ctx: Ctx, sel: Sel, winner: number, score: [number, number], auto: boolean): Promise<ResultPick> {
  ctx.music('victory');
  ctx.sfx('win_sting');
  const wid = winner === 0 ? sel.p1 : sel.p2, r = rosterOf(wid);
  const who = sel.mode === 'versus' ? (winner === 0 ? '一号位' : '二号位') : sel.mode === 'solo' ? (winner === 0 ? '你赢了' : '败北') : winner === 0 ? '一号位' : '二号位';
  const q = QUOTES[wid] ?? ['胜。'];
  return new Promise((resolve) => {
    const el = h('div', 'scr res');
    el.style.setProperty('--c', r.color);
    el.innerHTML = `
      <i class="scr-shade"></i>
      <div class="res-art ${needFlip(wid, 'portrait', 1) ? 'flip' : ''}"><img src="${art.portrait(wid)}" alt=""></div>
      <div class="res-main">
        <div class="res-sheng"><b>胜</b><i class="seal">${sel.mode === 'solo' && winner !== 0 ? '败' : '印'}</i></div>
        <div class="res-name">${r.name}<span>${esc(who)}</span></div>
        <div class="res-score"><em>${rosterOf(sel.p1).name}</em>${score[0]}<i>:</i>${score[1]}<em>${rosterOf(sel.p2).name}</em></div>
        <div class="res-quote">「${esc(q[Math.floor(Math.random() * q.length)])}」</div>
      </div>
      ${auto ? '<div class="res-auto">观战演示 · 即将开始下一局　按 Esc 返回主菜单</div>' : navKeys()}`;
    const items: Item[] = [
      { id: 'again', t: '再来一局' },
      { id: 'reselect', t: '重新选人' },
      { id: 'menu', t: '回主菜单' },
    ];
    let done = false;
    const finish = async (id: ResultPick) => { if (done) return; done = true; off(); clearTimeout(timer); await unmount(el, 240); resolve(id); };
    const menu = new VMenu(items, ctx, (id) => finish(id as ResultPick));
    if (!auto) el.append(menu.el);
    mount(el);
    anim(el.querySelector('.res-art img')!, [{ opacity: 0, transform: `translateX(-6rem) scale(1.06)${needFlip(wid, 'portrait', 1) ? ' scaleX(-1)' : ''}` }, { opacity: 1, transform: `none${needFlip(wid, 'portrait', 1) ? ' scaleX(-1)' : ''}`.replace('none ', '') }], 900);
    anim(el.querySelector('.res-sheng b')!, [{ opacity: 0, transform: 'scale(1.6)' }, { opacity: 1, transform: 'scale(0.96)', offset: 0.7 }, { opacity: 1, transform: 'none' }], 360, { delay: 200, easing: EASE.in });
    anim(el.querySelector('.res-sheng .seal')!, [{ opacity: 0, transform: 'scale(2.4) rotate(-14deg)' }, { opacity: 1, transform: 'rotate(-5deg)' }], 220, { delay: 560, easing: EASE.in });
    for (const [i, s] of ['.res-name', '.res-score', '.res-quote'].entries()) anim(el.querySelector(s)!, [{ opacity: 0, transform: 'translateY(2rem)' }, { opacity: 1, transform: 'none' }], 420, { delay: 420 + i * 90 });
    if (!auto) [...menu.el.children].forEach((c, i) => anim(c, [{ opacity: 0, transform: 'translateX(-3rem)' }, { opacity: 1, transform: 'none' }], 380, { delay: 700 + i * 60, fill: 'backwards' }));
    const timer = auto ? setTimeout(() => finish('again'), 6500) : 0;
    const off = nav.push((a) => {
      if (auto) { if (a.kind === 'back') finish('menu'); else if (a.kind === 'ok') finish('again'); return; }
      menu.key(a);
      if (a.kind === 'back') finish('menu');
    });
  });
}

// ───────────────────────────── 暂停 / 出招表 ─────────────────────────────
export type PausePick = 'resume' | 'restart' | 'quit';
export function pauseMenu(ctx: Ctx, sel: Sel): Promise<PausePick> {
  const game = ctx.game;
  return new Promise((resolve) => {
    const el = h('div', 'scr pause');
    el.innerHTML = `<div class="pause-box"><div class="pause-h"><b class="brush">暂停</b><span>${modeName(sel.mode)}</span></div></div>`;
    const box = el.querySelector('.pause-box')!;
    const items: Item[] = [
      { id: 'resume', t: '继续' }, { id: 'moves', t: '出招表' }, { id: 'restart', t: '重新开始' }, { id: 'quit', t: '退出到主菜单' },
    ];
    let sub: (() => void) | null = null;
    let done = false;
    const finish = async (id: PausePick) => { if (done) return; done = true; off(); await unmount(el, 140); resolve(id); };
    const menu = new VMenu(items, ctx, (id) => {
      if (id === 'moves') { sub = moveSheet(ctx, sel, el, () => { sub = null; }); return; }
      finish(id as PausePick);
    });
    box.append(menu.el);
    const solo = sel.ctrl[0] === 'human' && sel.ctrl[1] !== 'human';
    const k = keysFor(solo ? KEYSETS.solo : KEYSETS.p1);
    box.insertAdjacentHTML('beforeend', keysBar([
      [`${k.left} ${k.right}${solo ? ' / ← →' : ''}`, '移动'], [k.up, '跳'], [k.L, '轻击'], [k.H, '重击'], [k.S, '技'], [k.G, '防御'], [k.T, '投'], [k.U, '绝技'], [k.D, '冲刺'],
    ]));
    if (sel.mode === 'versus') {
      const k2 = keysFor(KEYSETS.p2);
      box.insertAdjacentHTML('beforeend', `<div style="margin-top:1rem;font-size:1.2rem;color:var(--paper-3);letter-spacing:.1em">二号位：方向键移动 · ${esc(k2.L)} 轻 · ${esc(k2.H)} 重 · ${esc(k2.S)} 技 · ${esc(k2.G)} 防 · ${esc(k2.T)} 投 · ${esc(k2.U)} 绝技 · ${esc(k2.D)} 冲刺</div>`);
    }
    uiRoot().append(el);
    anim(el, [{ opacity: 0 }, { opacity: 1 }], 140);
    anim(box, [{ opacity: 0, transform: 'translate(-50%, -46%) scale(.97)' }, { opacity: 1, transform: 'translate(-50%, -50%)' }], 220);
    const off = nav.push((a) => {
      if (sub) return;
      if (a.kind === 'back') { ctx.sfx('ui_back'); finish('resume'); return; }
      menu.key(a);
    });
    void game;
  });
}
const modeName = (m: Mode) => ({ solo: '单人对战', versus: '双人对战', watch: '观战演示', training: '训练' }[m]);

function moveSheet(ctx: Ctx, sel: Sel, parent: HTMLElement, onClose: () => void) {
  const m = ctx.game.match!;
  const el = h('div', 'ml');
  const row = (r: MoveRow) => `<li><kbd>${esc(r.input)}</kbd><span>${esc(r.name)}${r.tag ? `<em>${r.tag}</em>` : ''}</span></li>`;
  const col = (i: number) => {
    const def = m.f[i].def, r = rosterOf(def.id);
    const map = sel.mode === 'versus' ? (i === 0 ? KEYSETS.p1 : KEYSETS.p2) : KEYSETS.solo;
    const ml = moveList(def, map);
    return `<div class="ml-col" style="--c:${r.color}"><h3><b>${def.name}</b><span>${def.title}${sel.mode === 'versus' ? (i === 0 ? ' · 一号位键位' : ' · 二号位键位') : ''}</span></h3>
      <h4>技 · 绝技</h4><ul class="ml-l">${ml.specials.map(row).join('')}</ul>
      <h4>拳脚</h4><ul class="ml-l">${ml.normals.map(row).join('')}</ul>
      <h4>基本</h4><ul class="ml-l">${ml.system.map(row).join('')}</ul></div>`;
  };
  el.innerHTML = `<div class="ml-box">${col(0)}${col(1)}</div><div class="ml-foot">方向以角色面朝右为准 · ${keyLabel(KEYS_P1.H[0])} / Esc 返回</div>`;
  parent.append(el); parent.classList.add('ml-open');
  anim(el, [{ opacity: 0 }, { opacity: 1 }], 160);
  const close = () => { off(); ctx.sfx('ui_back'); el.remove(); parent.classList.remove('ml-open'); onClose(); };
  el.addEventListener('click', close);
  const off = nav.push((a) => { if (a.kind === 'back' || a.kind === 'ok') close(); });
  return close;
}

// ───────────────────────────── 观战角标 ─────────────────────────────
export function watchTag() {
  const el = h('div', 'scr-tag watch-tag', '<i></i>观战演示　Esc 暂停');
  uiRoot().append(el);
  return () => el.remove();
}

export { THREE };
