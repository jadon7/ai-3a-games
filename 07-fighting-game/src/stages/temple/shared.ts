import * as THREE from 'three';

/** 场景里所有自定义着色器共享的统一变量：时间、压暗系数。改一处全场景生效，setDim 每帧只写一个数。 */
export interface Shared {
  uTime: { value: number };
  uDim: { value: number };
  /** 火盆的位置（世界坐标），火星和地面暖光用 */
  braziers: THREE.Vector3[];
  /** 火盆火焰的强度（闪烁、受冲击时变旺） */
  uFire: { value: THREE.Vector2 };
  /** 最近一次砸地：x、开始时间、强度 */
  uImpact: { value: THREE.Vector3 };
}

export function createShared(): Shared {
  return {
    uTime: { value: 0 },
    uDim: { value: 0 },
    braziers: [new THREE.Vector3(-4.9, 0, -3.4), new THREE.Vector3(4.9, 0, -3.4)],
    uFire: { value: new THREE.Vector2(1, 1) },
    uImpact: { value: new THREE.Vector3(0, -100, 0) },
  };
}

/** 场景雾的颜色（线性）和密度。天空地平线的颜色要和它接得上。 */
export const FOG_COLOR = new THREE.Color(0.03, 0.05, 0.068);
export const FOG_DENSITY = 0.029;
