// 入口：建渲染器、载入场景和音频、接上表现层，然后交给界面流程（或者按地址栏参数直接开打）
import { Game } from './game';
import { Keyboard } from './core/input';
import { Gfx } from './render/gfx';
import { DEBUG } from './core/config';
import { FightPresenter } from './present/fightFx';
import type { StageFactory } from './stage/types';
import { installDebug } from './debug';
import { AiSource } from './combat/ai';

const STAGES = import.meta.glob<{ createTempleStage?: StageFactory }>('./stages/temple/index.ts');
const APP = import.meta.glob<{ runApp?: (game: Game, presenter: FightPresenter) => Promise<void> }>('./app.ts');
const HUD = import.meta.glob<{ Hud?: new (game: Game) => any }>('./ui/hud.ts');
const AUDIO = import.meta.glob<{ AudioSystem?: new () => any }>('./audio/audio.ts');

async function boot() {
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const gfx = new Gfx(canvas);
  const kb = new Keyboard();
  const game = new Game(gfx, kb);
  (window as any).game = game;

  let stageFactory: StageFactory | undefined;
  const sm = STAGES['./stages/temple/index.ts'];
  if (sm && !DEBUG.has('nostage')) { try { stageFactory = (await sm()).createTempleStage; } catch (e) { console.warn('正式场景载入失败', e); } }
  await game.init(stageFactory);

  game.aiFactory = (g, idx, level) => new AiSource(() => g.match, idx, level);
  const presenter = new FightPresenter(game);
  game.presenters.push(presenter);
  const am = AUDIO['./audio/audio.ts'];
  if (am && !DEBUG.has('mute')) {
    try {
      const mod = await am();
      if (mod.AudioSystem) {
        const audio = new mod.AudioSystem();
        audio.init?.().catch(() => {});
        presenter.audio = audio; (game as any).audio = audio;
        const unlock = () => { audio.unlock?.(); };
        window.addEventListener('keydown', unlock); window.addEventListener('pointerdown', unlock);
      }
    } catch (e) { console.warn('音频载入失败', e); }
  }
  // H 键隐藏 / 显示界面（录“干净画面”用）
  window.addEventListener('keydown', (e) => { if (e.code === 'KeyH' && !e.repeat) { const ui = document.getElementById('ui')!; ui.style.visibility = ui.style.visibility === 'hidden' ? '' : 'hidden'; } });
  installDebug(game, presenter);
  game.start();
  const app = APP['./app.ts'];
  if (app && !DEBUG.has('direct')) {
    try { const mod = await app(); if (mod.runApp) { await mod.runApp(game, presenter); return; } }
    catch (e) { console.error('界面流程载入失败，直接开打', e); }
  }
  const au = (game as any).audio; au?.music?.('battle'); au?.ambience?.(true);
  // 直接开打也挂上对战界面（地址栏带 nohud 时不挂）
  const hm = HUD['./ui/hud.ts'];
  if (hm && !DEBUG.has('nohud')) { try { const mod = await hm(); if (mod.Hud) game.presenters.push(new mod.Hud(game)); } catch (e) { console.warn('对战界面载入失败', e); } }
  await game.startMatch({
    p1: DEBUG.get('p1') ?? 'yanjin', p2: DEBUG.get('p2') ?? 'lingshuang',
    ctrl: [(DEBUG.get('p1c') as any) ?? 'human', (DEBUG.get('p2c') as any) ?? 'dummy'], training: DEBUG.has('training'), level: Number(DEBUG.get('level') ?? 2),
  });
  (window as any).__ready = true;
}
boot().catch((e) => { console.error(e); document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;left:8px;top:8px;color:#f66;white-space:pre-wrap">${String(e?.stack ?? e)}</pre>`); });
