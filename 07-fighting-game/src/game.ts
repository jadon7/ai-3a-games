import * as THREE from 'three';
import { Match } from './combat/sim';
import type { FightEvent, InputSource } from './combat/types';
import { DEBUG, DT } from './core/config';
import { DummySource, KEYS_P1, KEYS_P2, KEYS_SOLO, Keyboard, KeyboardSource } from './core/input';
import { damp } from './core/math';
import { loadFighter, resolveAutoBoxes, type LoadedFighter } from './data/assets';
import { FighterView } from './present/fighterView';
import { FightCamera } from './render/camera';
import type { Gfx } from './render/gfx';
import { createPlaceholderStage } from './stage/placeholder';
import type { Stage } from './stage/types';

const _cv = new THREE.Vector3();

export type Controller = 'human' | 'cpu' | 'dummy';
export interface MatchConfig { p1: string; p2: string; ctrl: [Controller, Controller]; training?: boolean; level?: number; /** 展示模式：只把两人摆出来播待机（选人界面） */ showcase?: boolean }

/** 表现层的各个部件都实现这个接口，Game 把模拟事件和每帧更新分发给它们。 */
export interface Presenter {
  onMatchStart?(game: Game): void;
  onEvent?(e: FightEvent, game: Game): void;
  /** dt 真实时间；sdt 乘过慢动作的时间 */
  update?(dt: number, sdt: number, game: Game): void;
  onMatchEnd?(game: Game): void;
}

export class Game {
  readonly cam: FightCamera;
  stage!: Stage;
  match: Match | null = null;
  views: FighterView[] = [];
  loaded: LoadedFighter[] = [];
  config: MatchConfig | null = null;
  presenters: Presenter[] = [];
  /** 慢动作：timeScale 会向 slowTarget 靠拢，slowHold 秒后恢复 1 */
  timeScale = 1; private slowTarget = 1; private slowHold = 0;
  private acc = 0; time = 0; simTime = 0;
  paused = false;
  private last = 0;
  fps = 60;
  aiFactory: ((game: Game, idx: number, level: number) => InputSource) | null = null;
  private heads = [new THREE.Vector3(), new THREE.Vector3()];

  constructor(readonly gfx: Gfx, readonly kb: Keyboard) {
    this.cam = new FightCamera(gfx.camera);
  }

  async init(stageFactory?: (ctx: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera }) => Promise<Stage>) {
    const ctx = { renderer: this.gfx.renderer, scene: this.gfx.scene, camera: this.gfx.camera };
    try { this.stage = await (stageFactory ?? createPlaceholderStage)(ctx); }
    catch (e) { console.error('场景载入失败，用占位场景', e); this.stage = await createPlaceholderStage(ctx); }
  }

  /** 慢动作。delay 秒后才开始（让命中那一下的闪光先按正常速度放完，不然慢动作会把它拉成长时间的白屏） */
  slowmo(scale: number, hold: number, delay = 0) {
    if (delay > 0) { this.slowQueue.push({ t: this.time + delay, scale, hold }); return; }
    this.slowTarget = Math.min(this.slowTarget, scale); this.slowHold = Math.max(this.slowHold, hold); if (scale < this.timeScale) this.timeScale = scale;
  }
  private slowQueue: { t: number; scale: number; hold: number }[] = [];

  async startMatch(cfg: MatchConfig) {
    this.endMatch();
    this.config = cfg;
    const [a, b] = await Promise.all([loadFighter(cfg.p1), loadFighter(cfg.p2)]);
    this.loaded = [a, b];
    const inputs = cfg.ctrl.map((c, i) => this.makeInput(c, i, cfg)) as [InputSource, InputSource];
    const match = new Match([a.def, b.def], inputs, [a.asset.meta.clips, b.asset.meta.clips]);
    match.training = !!cfg.training;
    if (cfg.showcase) { match.hold = true; for (const f of match.f) f.setAnim('idle', 0, true, Math.random() * 2); match.drainEvents(); }
    this.views = match.f.map((f, i) => new FighterView(this.loaded[i].asset, f));
    for (const [i, v] of this.views.entries()) {
      this.gfx.scene.add(v.rig.root, v.world); v.camera = this.gfx.camera;
      resolveAutoBoxes(this.loaded[i].def, v.rig, v.animator);
    }
    this.match = match;
    this.acc = 0; this.timeScale = 1; this.slowTarget = 1; this.slowHold = 0;
    for (const p of this.presenters) p.onMatchStart?.(this);
    for (const e of match.drainEvents()) for (const p of this.presenters) p.onEvent?.(e, this);
  }

  private makeInput(c: Controller, i: number, cfg: MatchConfig): InputSource {
    if (c === 'human') {
      const both = cfg.ctrl[0] === 'human' && cfg.ctrl[1] === 'human';
      return new KeyboardSource(this.kb, both ? (i === 0 ? KEYS_P1 : KEYS_P2) : KEYS_SOLO, i);
    }
    if (c === 'cpu' && this.aiFactory) return this.aiFactory(this, i, cfg.level ?? 2);
    return new DummySource();
  }

  endMatch() {
    if (!this.match) return;
    for (const p of this.presenters) p.onMatchEnd?.(this);
    for (const v of this.views) this.gfx.scene.remove(v.rig.root, v.world);
    this.views = []; this.match = null;
  }

  frame = (now: number) => {
    requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, (now - this.last) / 1000 || 0.016);
    this.last = now;
    this.fps = damp(this.fps, 1 / Math.max(dt, 1e-4), 2, dt);
    if (this.manual) return;
    this.tick(dt);
  };

  /** 手动驱动（自动化测试、页面在后台时用）：置 true 后只有调用 tick 才前进 */
  manual = false;

  tick(dt: number) {
    this.time += dt;
    this.gfx.resize();

    for (let i = this.slowQueue.length - 1; i >= 0; i--) if (this.slowQueue[i].t <= this.time) { const q = this.slowQueue[i]; this.slowQueue.splice(i, 1); this.slowmo(q.scale, q.hold); }
    // 慢动作恢复
    if (this.slowHold > 0) { this.slowHold -= dt; if (this.slowHold <= 0) this.slowTarget = 1; }
    this.timeScale = damp(this.timeScale, this.slowTarget, this.slowTarget < this.timeScale ? 30 : 5, dt);
    const sdt = this.paused ? 0 : dt * this.timeScale;
    this.simTime += sdt;

    const m = this.match;
    if (m) {
      this.acc += sdt;
      let steps = 0;
      while (this.acc >= DT && steps < 5) {
        m.step(); this.acc -= DT; steps++;
        for (const e of m.drainEvents()) for (const p of this.presenters) p.onEvent?.(e, this);
      }
      if (steps === 5) this.acc = 0;
      const alpha = this.acc / DT;
      const [va, vb] = this.views;
      va.headWorld(this.heads[0]); vb.headWorld(this.heads[1]);
      va.update(alpha, dt, sdt, this.heads[1]);
      vb.update(alpha, dt, sdt, this.heads[0]);
      // 高度带一点预判（正在往上飞的按再飞 0.13 秒算），镜头才来得及让出位置
      // 自己起跳只让镜头略微抬一点；被打飞才大幅让位
      // 击飞动作自己还带着一段腾空（胯的位移轨道），人实际比模拟里的高度高得多：按骨骼的实际最高点算，不然击倒那一下人会飞出画面上沿
      const camY = (i: number) => {
        const f = m.f[i], v = this.views[i], y = v.pos.y;
        if (f.state !== 'launched') return y * 0.42;
        const hi = Math.max(v.rig.boneWorld('Head', _cv).y, v.rig.boneWorld('Hips', _cv).y, v.rig.boneWorld('LeftFoot', _cv).y, v.rig.boneWorld('RightFoot', _cv).y);
        return Math.max(y, hi - 1.4) + Math.max(0, f.vy) * 0.13;
      };
      this.cam.update(dt, va.pos.x, camY(0), vb.pos.x, camY(1));
    } else {
      this.cam.update(dt, -2, 0, 2, 0);
    }
    this.stage.update(sdt, this.simTime);
    for (const p of this.presenters) p.update?.(dt, sdt, this);
    this.gfx.render(dt);
  }

  start() { this.last = performance.now(); requestAnimationFrame(this.frame); }
}

export const debugFlag = (k: string) => DEBUG.has(k);
