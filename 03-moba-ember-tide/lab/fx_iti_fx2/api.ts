// 试验页和特效模块之间的约定（试验页 main.ts 提供，特效模块 fx/*.ts 使用）。
// 第四阶段接进游戏时：FxCtx 的 hitstop / shake 就是游戏 fxlib.ts 里的同名函数（参数一样），dim / flash 是这次新加的两个屏幕效果
// （游戏里还没有，实现见 main.ts 的“屏幕压暗”“屏幕闪光”两段，搬过去各十来行）；LabActor 换成游戏里英雄 / 小兵的视图。
import type * as THREE from "three";
import type { Hero } from "../../src/map/hero/hero";

/** 场景里的一个人（占位的伊缇用岚的模型；靶子是两个敌方英雄和四个近战小兵，站位和 Codex 那一版完全一样，方便同一时刻并排比） */
export interface LabActor {
  name: string;
  hero: Hero;
  obj: THREE.Group;              // = hero.group
  height: number;                // 身高（米）：岚 3.3，摩珂 3.3，托尔格 2.8，近战小兵 1.45
  radius: number;
  team: number;                  // 0 自己这边，1 敌方
  isHero: boolean;
  home: { x: number; z: number; yaw: number };
  setPos(x: number, z: number, y?: number): void;
  face(yaw: number): void;       // 绕 Y 轴的角度，0 面朝 +Z
  faceTo(x: number, z: number): void;
  play(clip: string, opts?: { loop?: boolean; speed?: number; fade?: number }): void;   // 岚的动作：idle run attack1 attack2 hook veil r r_end death
  setHide(k: number): void;      // 0 正常，1 完全看不见（大招里闪来闪去、不可选中时用）
  /** 受击闪白：k 0～1。游戏里的 hero.hit(k) 只亮轮廓（polish-lib 压过一档）；这里另加一层“整个人白一下”（同骨骼的白色蒙皮网格，0.1 秒退掉），
   *  王者打中人那一下就是整个人白一帧。接进游戏时给 hero.hit 加一个 whole 参数，做法照 lab 的 flashWhite */
  hit(k?: number): void;
}

/** 特效拿到的环境 */
export interface FxCtx {
  THREE: typeof THREE;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  lite: boolean;                 // 手机档（?q=lite）：粒子减半
  ground(x: number, z: number): number;
  /** 镜头抖（照游戏 fxlib.shake：amp 米，dur 秒，平方衰减；新的比正在抖的弱就不打断）。
   *  和游戏的一处不同：这里抖动按真实时间走，顿帧的时候镜头照样抖（王者打中人“停住 + 抖”是一起的）；游戏里 shakeT 跟着对局时间走，顿帧时抖也停了，接入时改成真实时间（一行） */
  shake(amp: number, dur?: number): void;
  /** 顿帧（照游戏 fxlib.hitstop）：sec 秒（真实时间）里世界时间乘 0.06——人物动作和特效都几乎停住 */
  hitstop(sec: number): void;
  /** 画面压暗（新）：地面和场景压暗到 1-k（0.55 就是暗一半多），人物和特效不压——“只留伊缇和目标亮着”。
   *  fadeIn / hold / fadeOut 都是真实时间（顿帧不影响）。再调一次就从当前亮度接着过渡 */
  dim(k: number, fadeIn: number, hold: number, fadeOut: number): void;
  /** 全屏闪一下（新）：大招的“高光时刻”。color 一般是淡绯白，k 0～1 多亮，dur 秒（真实时间） */
  flash(k: number, dur: number, color?: number): void;
  time(): number;                // 这次重放开始后的世界时间（受顿帧影响）
}

/** 一个正在播的特效。update 返回 false 表示播完了 */
export interface FxHandle {
  update(dt: number): boolean;
  dispose(): void;
}

export type Demo = {
  label: string;
  duration: number;
  setup?: (ctx: FxCtx, cast: LabActor, targets: LabActor[]) => void;
  run: (ctx: FxCtx, cast: LabActor, targets: LabActor[]) => FxHandle;
};
