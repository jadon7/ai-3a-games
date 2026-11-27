// 试验页和特效模块之间的约定（试验页 main.ts 提供，特效模块 fx/*.ts 使用）。
// 以后接进游戏时，FxCtx 换成游戏的对应物（场景、镜头、手机档、镜头抖动、顿帧），LabActor 换成游戏里的英雄 / 小兵视图。
import type * as THREE from "three";
import type { Hero } from "../../src/map/hero/hero";

/** 场景里的一个人（占位的伊缇用岚的模型；靶子是两个敌方英雄和几个近战小兵） */
export interface LabActor {
  name: string;
  hero: Hero;                    // 游戏里的英雄对象：hero.group 放位置朝向，hero.model 是蒙皮模型，hero.bone("RightHand") 找骨骼，hero.blade("R", base, tip) 取刀身
  obj: THREE.Group;              // = hero.group
  height: number;                // 身高（米）：岚 3.3，摩珂 3.3，托尔格 2.8，近战小兵 1.45
  radius: number;                // 身体半径（米），站位和闪到身后用
  team: number;                  // 0 自己这边，1 敌方
  isHero: boolean;
  home: { x: number; z: number; yaw: number };   // 每次重放前回到这里
  setPos(x: number, z: number): void;
  face(yaw: number): void;       // yaw：绕 Y 轴的角度，0 面朝 +Z
  faceTo(x: number, z: number): void;
  play(clip: string, opts?: { loop?: boolean; speed?: number; fade?: number }): void;   // 岚的动作：idle run attack1 attack2 hook veil r r_end death
  setHide(k: number): void;      // 0 正常，1 完全看不见（消失 / 不可选中时用）
  hit(k?: number): void;         // 受击闪白一下
}

/** 特效拿到的环境 */
export interface FxCtx {
  THREE: typeof THREE;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  onFxDraw?: (particles: number) => void;
  lite: boolean;                 // 手机档（网址 ?q=lite）：粒子数、绘制次数减半
  ground(x: number, z: number): number;   // 地面高度（试验页是平地，恒为 0）
  shake(amp: number, dur: number): void;  // 镜头抖动（米，秒）
  hitstop(sec: number): void;             // 顿帧：这段时间里世界的 dt 乘 0.08（人物动作和特效都慢下来）
  time(): number;                         // 从这次重放开始过了多少秒（世界时间，受顿帧影响）
}

/** 一个正在播的特效（或者一段演示）。update 返回 false 表示播完了，试验页随后调 dispose */
export interface FxHandle {
  update(dt: number): boolean;
  dispose(): void;
}

/** 一段演示：试验页按按钮 / 网址参数 play=名字 时调用。cast 是占位的伊缇，targets 是靶子（先英雄后小兵） */
export type Demo = {
  label: string;
  duration: number;              // 大概多长（秒），录像用
  setup?: (ctx: FxCtx, cast: LabActor, targets: LabActor[]) => void;   // 摆位（不写就用默认站位）
  run: (ctx: FxCtx, cast: LabActor, targets: LabActor[]) => FxHandle;
};
