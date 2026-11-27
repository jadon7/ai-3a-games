import type * as THREE from 'three';
import type { FightEvent, MoveDef, MoveEvent } from '../combat/types';
import type { FighterView } from '../present/fighterView';
import type { FightCamera } from '../render/camera';
import type { Gfx } from '../render/gfx';
import type { Fx } from './core';

export type HitEvent = Extract<FightEvent, { type: 'hit' }>;

export interface AudioLike { play(name: string, opts?: { volume?: number; rate?: number; pan?: number; delay?: number }): void }

/** 角色特效能用到的东西。 */
export interface FxCtx {
  fx: Fx; gfx: Gfx; cam: FightCamera; audio: AudioLike;
  /** 慢动作：scale 倍率，hold 持续秒数 */
  slowmo(scale: number, hold: number): void;
  /** 把场景压暗到 k（0 到 1），之后自动恢复要再调一次 0 */
  dim(k: number): void;
  /** 特效时间（秒） */
  readonly time: number;
}

export interface ProjectileFx {
  /** 每帧：道具当前的位置（世界坐标，y 是道具中心的高度；贴地的道具 y = 0） */
  update(x: number, y: number, dt: number): void;
  /** 结束：hit 为真是打中了（或对撞），假是飞到头自己消散 */
  end(x: number, y: number, hit: boolean): void;
}

/**
 * 一个角色的全套特效。所有方法都可选；没实现的由表现层的通用特效兜底（通用的打击火花永远会放，这里是在它上面加料）。
 * self 是自己的表现对象（self.rig 可以取骨骼、武器的世界坐标；self.fighter 是模拟状态，facing 是朝向），opp 是对手。
 */
export interface FighterFx {
  /** 每帧：常驻的东西（武器上的寒气、拳头的余烬、蓄力时的光环）。sdt 是乘过慢动作的时间 */
  update?(sdt: number, self: FighterView, opp: FighterView, ctx: FxCtx): void;
  /** 出招的第一帧 */
  onMoveStart?(move: MoveDef, self: FighterView, opp: FighterView, ctx: FxCtx): void;
  /** 招式里的事件点（招式表 events 里带 fx 名字的：charge、release、dash、slam） */
  onMoveEvent?(move: MoveDef, ev: MoveEvent, self: FighterView, opp: FighterView, ctx: FxCtx): void;
  /** 自己的招打中或被挡。命中点 e.x / e.y；e.blocked、e.hit.heavy、e.hit.tag、e.move 可以区分情况 */
  onHit?(e: HitEvent, pos: THREE.Vector3, self: FighterView, opp: FighterView, ctx: FxCtx): void;
  /** 放出飞行道具（或贴地前进的地面技）。defId：fireblast / firepillar / crescent / icespikes */
  projectile?(defId: string, x: number, y: number, dir: number, self: FighterView, ctx: FxCtx): ProjectileFx | null;
  /** 大招定格的那一刻（约 1 秒，世界停住、场景压暗、镜头推到自己身上） */
  onSuperFreeze?(self: FighterView, opp: FighterView, ctx: FxCtx): void;
  /** 大招演出开始、每一拍、结束。beat 从 0 数，final 是最后一击 */
  onCineStart?(self: FighterView, opp: FighterView, ctx: FxCtx): void;
  onCineBeat?(beat: number, final: boolean, self: FighterView, opp: FighterView, ctx: FxCtx): void;
  onCineEnd?(self: FighterView, opp: FighterView, ctx: FxCtx): void;
  /** 回合结束清场 */
  reset?(): void;
}

export type FighterFxFactory = (ctx: FxCtx) => FighterFx;
