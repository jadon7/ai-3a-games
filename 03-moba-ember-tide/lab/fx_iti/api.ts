// 试验页和演示脚本之间的约定（iti-fx3）。
// 这一轮特效的代码不在试验页里了：全部在 src/map/game/fx_iti_core.ts（实现）、fx_iti_kit.ts（零件）、fx_iti_screen.ts（屏幕级的演出），
// 试验页只做三件事：搭一个和游戏一样的场景（真的 fxlib、真的屏幕演出）、给特效造一个假的“技能上下文”（ItiCtx：假的单位、假的英雄控制器、假的 api）、
// 照技能代码将来的写法在时机点上调 ITI_FX（演示脚本 fx/demos.ts 就是“假装自己是技能代码”）。
import type * as THREE from "three";
import type { Hero } from "../../src/map/hero/hero";
import type { Ent } from "../../src/map/game/sim";
import type { ItiCtx } from "../../src/map/game/fx_iti";

/** 场景里的一个人：伊缇，或者靶子（敌方英雄、近战小兵） */
export interface LabActor {
  name: string; ent: Ent; hero: Hero; obj: THREE.Group; height: number; radius: number; isHero: boolean;
  home: { x: number; z: number };
  setPos(x: number, z: number, y?: number): void;
  face(yaw: number): void; faceTo(x: number, z: number): void;
  play(clip: string, opts?: { loop?: boolean; speed?: number; fade?: number; at?: number }): void;      // at：从动作的第几秒开始播
  setHide(k: number): void;      // 1 整个人看不见（大招里闪来闪去、不可选中时）
}

/** 演示脚本拿到的东西 */
export interface Lab {
  c: ItiCtx; cast: LabActor; targets: LabActor[]; lite: boolean;
  /** t 秒（对局时间，顿帧跟着停）时调一次 */
  at(t: number, fn: () => void): void;
  /** 从 t0 起 dur 秒里每帧调 fn(k)，k 从 0 到 1 */
  tween(t0: number, dur: number, fn: (k: number) => void): void;
  /** 镜头跟不跟着伊缇走（冲刺类的演示要跟；大招看落点，不跟） */
  follow(on: boolean, x?: number, z?: number): void;
}
export type Demo = { label: string; duration: number; setup?: (L: Lab) => void; run: (L: Lab) => void };
