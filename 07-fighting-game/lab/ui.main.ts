// 界面调试入口：和 src/main.ts 一样，只是路径换到 lab 下（开发服务器缓存了 main.ts 里的 glob 时用）
import { Game } from '../src/game';
import { Keyboard } from '../src/core/input';
import { Gfx } from '../src/render/gfx';
import { DEBUG } from '../src/core/config';
import { FightPresenter } from '../src/present/fightFx';
import type { StageFactory } from '../src/stage/types';
import { installDebug } from '../src/debug';
import { AiSource } from '../src/combat/ai';

const STAGES = import.meta.glob<{ createTempleStage?: StageFactory }>('../src/stages/temple/index.ts');
const APP = import.meta.glob<{ runApp?: (game: Game, presenter: FightPresenter) => Promise<void> }>('../src/app.ts');
const AUDIO = import.meta.glob<{ AudioSystem?: new () => any }>('../src/audio/audio.ts');

async function boot() {
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const gfx = new Gfx(canvas);
  const kb = new Keyboard();
  const game = new Game(gfx, kb);
  (window as any).game = game;

  let stageFactory: StageFactory | undefined;
  const sm = STAGES['../src/stages/temple/index.ts'];
  if (sm && !DEBUG.has('nostage')) { try { stageFactory = (await sm()).createTempleStage; } catch (e) { console.warn('正式场景载入失败', e); } }
  await game.init(stageFactory);

  game.aiFactory = (g, idx, level) => new AiSource(() => g.match, idx, level);
  const presenter = new FightPresenter(game);
  game.presenters.push(presenter);
  const am = AUDIO['../src/audio/audio.ts'];
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
  installDebug(game, presenter);
  game.start();
  const app = APP['../src/app.ts'];
  if (app && !DEBUG.has('direct')) {
    try { const mod = await app(); if (mod.runApp) { await mod.runApp(game, presenter); return; } }
    catch (e) { console.error('界面流程载入失败，直接开打', e); }
  }
  const au = (game as any).audio; au?.music?.('battle'); au?.ambience?.(true);
  await game.startMatch({
    p1: DEBUG.get('p1') ?? 'yanjin', p2: DEBUG.get('p2') ?? 'lingshuang',
    ctrl: [(DEBUG.get('p1c') as any) ?? 'human', (DEBUG.get('p2c') as any) ?? 'dummy'], training: DEBUG.has('training'), level: Number(DEBUG.get('level') ?? 2),
  });
  (window as any).__ready = true;
}
boot().catch((e) => { console.error(e); document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;left:8px;top:8px;color:#f66;white-space:pre-wrap">${String(e?.stack ?? e)}</pre>`); });
