import type * as THREE from 'three';

/**
 * 场景的接口。场景自己带灯光、雾、环境贴图，决定整体氛围。
 * 坐标：对战在 z = 0 的平面上进行，x 是左右（-8.2 到 8.2 是角色能到的范围），y 向上，地面在 y = 0。
 * 镜头在 +z 一侧朝 -z 看（离对战平面 6 到 10 米），所以布景主要摆在 z < 0，z > 0 只放镜头前的前景。
 */
export interface Stage {
  readonly root: THREE.Group;
  /** 环境贴图（PMREM 处理过的），角色用它做环境反射和环境光。没有就给 null */
  readonly env: THREE.Texture | null;
  /** 每帧调用：dt 秒（已经乘过慢动作倍率），t 是累计时间 */
  update(dt: number, t: number): void;
  /** 大招时把场景压暗：0 正常，1 最暗。角色和特效不受影响（由游戏那边另外打光） */
  setDim(k: number): void;
  /** 有东西砸到地面：场景可以让附近的积雪、灰尘、火盆有点反应。可以不实现 */
  onImpact?(x: number, strength: number): void;
  dispose(): void;
}

export interface StageContext {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
}

export type StageFactory = (ctx: StageContext) => Promise<Stage>;
