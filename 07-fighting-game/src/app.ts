// 游戏流程：主菜单 → 选人 → 对阵过场 → 对战 → 结算；对战中 Esc / 回车暂停；观战演示自动循环。
import * as THREE from 'three';
import type { FightEvent } from './combat/types';
import type { Game } from './game';
import type { FightPresenter } from './present/fightFx';
import { Hud } from './ui/hud';
import { nav } from './ui/nav';
import { mainMenu, pauseMenu, resultScreen, selectScreen, versusScreen, watchTag, type Ctx, type Sel } from './ui/screens';
import { roster } from './ui/data';
import { wait } from './ui/dom';

export async function runApp(game: Game, presenter: FightPresenter): Promise<void> {
  const hud = new Hud(game);
  game.presenters.push(hud);
  (window as any).__hud = hud;
  const audio = () => ((game as any).audio ?? presenter.audio) as any;
  hud.audio = { play: (n: string, o?: any) => audio()?.play?.(n, o) };

  // 对战事件：等 matchEnd
  let onEnd: ((w: number) => void) | null = null;
  game.presenters.push({
    onEvent(e: FightEvent) { if (e.type === 'round' && e.phase === 'matchEnd' && onEnd) { const f = onEnd; onEnd = null; f(e.winner ?? 0); } },
  });

  // 背后的展示场景：排队，只保留最新的请求
  let want = '', have = '', busy = false;
  const pump = async () => {
    if (busy) return; busy = true;
    try {
      while (want && want !== have) {
        const key = want; const [p1, p2] = key.split('|');
        await game.startMatch({ p1, p2, ctrl: ['dummy', 'dummy'], showcase: true });
        have = key; applyFocus();
      }
    } catch (e) { console.warn('展示场景载入失败', e); }
    busy = false;
  };
  let focusSide: -1 | 0 | 1 = -1, focusKind: 'menu' | 'select' = 'menu', focusKey = '';
  const applyFocus = () => {
    const m = game.match; if (!m || !game.config?.showcase) return;
    const key = `${focusSide}|${focusKind}|${have}`;
    if (key === focusKey) return; focusKey = key;
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    if (focusSide < 0) {
      if (focusKind === 'menu') game.cam.play([{ pos: V(-0.4, 1.0, 8.8), look: V(-1.6, 1.5, 0), fov: 34, dur: 600, into: 0.8, push: 0, orbit: 0 }]);
      else game.cam.play([{ pos: V(0, 1.25, 7.2), look: V(0, 1.25, 0), fov: 34, dur: 600, into: 0.8 }]);
      return;
    }
    const f = m.f[focusSide as 0 | 1], x = f.x, side = f.facing, hgt = f.def.height;
    // 近景：角色放在信息栏的另一侧
    game.cam.play([{ pos: V(x + side * 0.4, hgt * 0.56, 5.6), look: V(x - side * 0.3, hgt * 0.42, 0), fov: 32, dur: 600, into: 0.7, push: 0, orbit: 0 }]);
  };

  const ctx: Ctx = {
    game,
    sfx: (n) => { try { audio()?.play?.(n); } catch { /* 无音频 */ } },
    music: (n) => { try { audio()?.music?.(n); } catch { /* 无音频 */ } },
    showcase: async (p1, p2) => { want = `${p1}|${p2}`; await pump(); },
    focus: (side, kind = 'select') => { focusSide = side; focusKind = kind; applyFocus(); },
  };
  try { audio()?.ambience?.(true); } catch { /* 无音频 */ }

  const fight = (sel: Sel) => game.startMatch({ p1: sel.p1, p2: sel.p2, ctrl: sel.ctrl, level: sel.level, training: sel.mode === 'training' });

  /** 打一场：返回胜者，或者暂停菜单里选了退出 / 重开 */
  async function playMatch(sel: Sel): Promise<{ kind: 'end'; winner: number } | { kind: 'quit' }> {
    for (;;) {
      hud.visible = true;
      ctx.music('battle');
      const untag = sel.mode === 'watch' ? watchTag() : () => {};
      const r = await new Promise<{ kind: 'end'; winner: number } | { kind: 'quit' } | { kind: 'restart' }>((resolve) => {
        onEnd = (w) => { nav.onPause = null; resolve({ kind: 'end', winner: w }); };
        nav.onPause = async () => {
          if (game.paused) return;
          game.paused = true; ctx.sfx('ui_confirm');
          try { audio()?.duck?.(0.6, 9999); } catch { /* */ }
          const p = await pauseMenu(ctx, sel);
          try { audio()?.duck?.(0, 0.1); } catch { /* */ }
          game.paused = false;
          if (p === 'quit') { onEnd = null; nav.onPause = null; resolve({ kind: 'quit' }); }
          else if (p === 'restart') { onEnd = null; nav.onPause = null; resolve({ kind: 'restart' }); }
        };
      });
      untag();
      if (r.kind === 'restart') { await fight(sel); continue; }
      return r;
    }
  }

  const randomSel = (prev?: Sel): Sel => {
    const ids = roster.map((r) => r.id);
    let p1 = ids[Math.floor(Math.random() * ids.length)], p2 = ids[Math.floor(Math.random() * ids.length)];
    if (prev) { p1 = prev.p2; p2 = prev.p1; if (Math.random() < 0.35) { p2 = ids[Math.floor(Math.random() * ids.length)]; } }
    else if (p1 === p2 && ids.length > 1) p2 = ids.find((i) => i !== p1)!;
    return { mode: 'watch', p1, p2, level: 3, ctrl: ['cpu', 'cpu'] };
  };

  for (;;) {
    hud.visible = false;
    if (game.match && !game.config?.showcase) game.endMatch();
    focusKey = ''; have = game.config?.showcase ? have : '';
    const mode = await mainMenu(ctx);
    let sel: Sel | null = mode === 'watch' ? randomSel() : await selectScreen(ctx, mode);
    let count = 0;
    while (sel) {
      count++;
      const label = sel.mode === 'training' ? '训练' : sel.mode === 'watch' ? `观战演示 · 第 ${count} 局` : sel.mode === 'versus' ? '双人对战' : `单人对战 · ${['', '初窥', '登堂', '宗师'][sel.level]}`;
      // 过场期间预载这两个人
      const pre = ctx.showcase(sel.p1, sel.p2);
      const vs = await versusScreen(ctx, sel, label);
      await pre;
      have = ''; focusKey = '';
      game.cam.stop();
      await fight(sel);
      await vs.close();
      const r = await playMatch(sel);
      if (r.kind === 'quit') break;
      await wait(1600);
      hud.visible = false;
      const m = game.match!;
      const pick = await resultScreen(ctx, sel, r.winner, [m.f[0].wins, m.f[1].wins], sel.mode === 'watch');
      hud.visible = false;
      if (pick === 'menu') break;
      if (pick === 'again') { if (sel.mode === 'watch') sel = randomSel(sel); continue; }
      sel = await selectScreen(ctx, sel.mode, sel);
    }
  }
}
