import * as THREE from 'three';
import type { Element } from '../combat/types';
import type { Fx } from './core';

/** 三套配色。数值是线性空间里的基色，发光强度另外乘。 */
export const PAL: Record<Element, { core: number; hot: number; mid: number; deep: number; smoke: number; light: number }> = {
  fire: { core: 0xfff0c4, hot: 0xffa030, mid: 0xff4f10, deep: 0xb81a04, smoke: 0x241611, light: 0xff7426 },
  frost: { core: 0xf0fcff, hot: 0xa6eaff, mid: 0x52bcff, deep: 0x2466d0, smoke: 0xaecbe2, light: 0x78ccff },
  phys: { core: 0xffffff, hot: 0xfff2d0, mid: 0xffd484, deep: 0xc08a40, smoke: 0x8c8c8c, light: 0xfff0d4 },
};

const _p = new THREE.Vector3();

/**
 * 打中时的火花。pos 命中点，dir 攻击方向（1 向右、-1 向左），power 0.4（轻）到 1.5（大招）。
 * 分层：一闪的光斑 + 冲击环 + 朝被打方向喷的火花 + 元素层（火舌和余烬 / 冰屑和寒雾）+ 一盏瞬时的点光。
 */
export function hitSpark(fx: Fx, pos: THREE.Vector3, dir: number, power: number, el: Element = 'phys') {
  const pal = PAL[el];
  const p: [number, number, number] = [pos.x, pos.y, pos.z + 0.25];
  const k = power;
  fx.emit({ kind: 'glow', count: 1, pos: p, size: [0.5 * k + 0.2, 0.62 * k + 0.2], life: [0.06, 0.09], color: pal.core, color2: pal.mid, intensity: 2.2 + 1.5 * k, grow: 1.5 });
  fx.emit({ kind: 'glow', count: 1, pos: p, size: [1.3 * k, 1.6 * k], life: [0.14, 0.18], color: pal.hot, color2: pal.deep, intensity: 0.7 * k, grow: 1.3, alpha: 0.5 });
  if (k > 1.3) fx.airRing(_p.set(p[0], p[1], p[2]), 0.9 + 0.9 * k, pal.core, pal.mid, { life: 0.14 + 0.04 * k, power: 0.8 + 0.4 * k, width: 0.03 });
  fx.emit({ kind: 'spark', count: Math.round(10 + 16 * k), pos: p, dir: [dir, 0.25, 0.15], cone: 0.95, speed: [4 * k + 2, 11 * k + 5], life: [0.14, 0.38], size: [0.035, 0.07], color: pal.core, color2: pal.mid, intensity: 5, gravity: 9, drag: 2.2 });
  fx.emit({ kind: 'spark', count: Math.round(5 + 6 * k), pos: p, speed: [2, 6 * k + 3], life: [0.1, 0.25], size: [0.03, 0.05], color: pal.core, color2: pal.hot, intensity: 4, drag: 3 });
  if (el === 'fire') {
    fx.emit({ kind: 'flame', count: Math.round(5 + 7 * k), pos: p, spread: 0.12 * k, dir: [dir * 0.8, 0.6, 0], cone: 1.0, speed: [0.8, 3.2 * k], life: [0.22, 0.5], size: [0.35 * k, 0.75 * k], grow: 1.5, color: pal.hot, color2: pal.deep, intensity: 2.6, gravity: -2.2, drag: 2.4, spin: 2 });
    fx.emit({ kind: 'dot', count: Math.round(8 + 14 * k), pos: p, spread: 0.1, dir: [dir, 0.7, 0], cone: 1.2, speed: [1.5, 6 * k], life: [0.5, 1.3], size: [0.018, 0.04], color: pal.hot, color2: pal.deep, intensity: 5, gravity: -1.2, drag: 1.6, turb: 5 });
    fx.emit({ kind: 'smoke', count: Math.round(2 + 3 * k), pos: p, spread: 0.15, dir: [dir * 0.5, 1, 0], cone: 0.8, speed: [0.4, 1.4], life: [0.6, 1.1], size: [0.4 * k, 0.8 * k], grow: 2.2, color: pal.smoke, alpha: 0.55, gravity: -0.9, drag: 1.2, spin: 0.8 });
  } else if (el === 'frost') {
    fx.emit({ kind: 'flake', count: Math.round(12 + 18 * k), pos: p, spread: 0.08, dir: [dir, 0.4, 0.1], cone: 1.1, speed: [2, 8 * k + 2], life: [0.35, 0.9], size: [0.04, 0.11], color: pal.core, color2: pal.hot, intensity: 1.5, gravity: 11, drag: 1.4, spin: 9, bounce: 0.35 });
    fx.emit({ kind: 'mist', count: Math.round(3 + 4 * k), pos: p, spread: 0.2 * k, dir: [dir * 0.6, 0.3, 0], cone: 1.2, speed: [0.5, 2.2], life: [0.5, 1.0], size: [0.7 * k, 1.3 * k], grow: 1.8, color: pal.hot, color2: pal.mid, intensity: 0.3, alpha: 0.4, drag: 2 });
    fx.emit({ kind: 'glow', count: Math.round(4 + 4 * k), pos: p, spread: 0.25 * k, speed: [0.5, 2.5], life: [0.2, 0.5], size: [0.05, 0.12], color: pal.core, intensity: 5, drag: 3 });
  } else {
    fx.emit({ kind: 'smoke', count: Math.round(1 + 2 * k), pos: p, spread: 0.1, speed: [0.3, 1.2], life: [0.3, 0.6], size: [0.3 * k, 0.5 * k], grow: 2, color: 0xb8b0a4, alpha: 0.28, drag: 2 });
  }
  fx.flashLight(p, pal.light, 10 + 22 * k, 5 + 3 * k, 0.16 + 0.08 * k);
}

/** 被挡住：小一号、偏冷白的火花，金属碰撞感。 */
export function blockSpark(fx: Fx, pos: THREE.Vector3, dir: number, power: number, blade: boolean) {
  const p: [number, number, number] = [pos.x, pos.y, pos.z + 0.3];
  const col = blade ? 0xdff3ff : 0xfff4dc;
  fx.emit({ kind: 'glow', count: 1, pos: p, size: [0.4, 0.5], life: [0.06, 0.09], color: 0xffffff, color2: col, intensity: 2.8, grow: 1.4 });
  fx.airRing(_p.set(p[0], p[1], p[2]), 0.7 + power * 0.35, 0xffffff, 0x8fb4d8, { life: 0.13, power: 0.9, width: 0.035 });
  fx.emit({ kind: 'spark', count: Math.round(8 + 8 * power), pos: p, dir: [-dir, 0.4, 0.2], cone: 1.2, speed: [3, 9], life: [0.1, 0.3], size: [0.025, 0.05], color: 0xffffff, color2: col, intensity: 4, gravity: 12, drag: 2 });
  fx.flashLight(p, col, 9, 4, 0.12);
}

/** 弹反：又大又亮的十字星光和金白色的环。 */
export function parrySpark(fx: Fx, pos: THREE.Vector3, dir: number) {
  const p: [number, number, number] = [pos.x, pos.y, pos.z + 0.3];
  fx.emit({ kind: 'glow', count: 1, pos: p, size: [1.6, 1.8], life: [0.14, 0.18], color: 0xffffff, color2: 0xffe6a0, intensity: 9, grow: 1.5 });
  fx.airRing(_p.set(p[0], p[1], p[2]), 3.4, 0xffffff, 0xffd070, { life: 0.34, power: 3.5, width: 0.05 });
  fx.airRing(_p.set(p[0], p[1], p[2]), 2.0, 0xffffff, 0xffe9b8, { life: 0.22, power: 3, width: 0.08 });
  for (const d of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const)
    fx.emit({ kind: 'spark', count: 7, pos: p, dir: [d[0], d[1], 0], cone: 0.12, speed: [7, 18], life: [0.12, 0.26], size: [0.05, 0.09], color: 0xffffff, color2: 0xffd98a, intensity: 6, drag: 4 });
  fx.emit({ kind: 'spark', count: 26, pos: p, dir: [-dir, 0.3, 0.2], cone: 1.4, speed: [4, 13], life: [0.2, 0.5], size: [0.03, 0.06], color: 0xffffff, color2: 0xffc860, intensity: 5, gravity: 10, drag: 1.8 });
  fx.flashLight(p, 0xfff0c0, 55, 9, 0.25);
}

/** 脚下扬起的雪尘。amount 0.3（小碎步）到 2（重摔）。dir：往哪边扬（0 = 两边）。 */
export function dust(fx: Fx, x: number, amount: number, dir = 0, z = 0) {
  const n = Math.round(1 + 6 * amount);
  // 小碎步只扬起一点点，重摔才是一大团
  fx.emit({ kind: 'smoke', count: n, pos: [x, 0.16 + 0.14 * amount, z + 0.25], spread: [0.25 * amount, 0.06, 0.2], dir: dir ? [dir, 0.35, 0] : [0, 1, 0], cone: dir ? 0.7 : 1.45, speed: [0.4, 1.2 + amount * 1.6], life: [0.4, 0.7 + amount * 0.5], size: [0.12 + 0.12 * amount, 0.2 + 0.3 * amount], grow: 2.4, color: 0xc9d4e0, alpha: 0.1 + 0.14 * Math.min(1, amount), gravity: -0.25, drag: 2.2, spin: 0.7 });
  fx.emit({ kind: 'flake', count: Math.round(4 * amount + 2), pos: [x, 0.05, z], spread: [0.2 * amount, 0.02, 0.2], dir: dir ? [dir, 1, 0] : [0, 1, 0], cone: 1.0, speed: [1, 3 + amount * 2], life: [0.3, 0.7], size: [0.02, 0.05], color: 0xeaf4ff, intensity: 1.1, gravity: 9, drag: 1, spin: 8 });
}

/** 重物砸地：一圈雪尘向外推开，加碎屑。 */
export function groundSlam(fx: Fx, x: number, power: number, el: Element = 'phys', z = 0) {
  const pal = PAL[el];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    fx.emit({ kind: 'smoke', count: 2, pos: [x + c * 0.3, 0.34, z + s * 0.3 + 0.2], dir: [c, 0.12, s], cone: 0.25, speed: [2.5 * power, 5.5 * power], life: [0.5, 1.1], size: [0.35, 0.6], grow: 2.8, color: 0xc4d0dc, alpha: 0.3, drag: 3.2, spin: 0.8 });
  }
  fx.emit({ kind: 'flake', count: Math.round(18 * power), pos: [x, 0.05, z], spread: [0.5, 0.02, 0.4], dir: [0, 1, 0], cone: 0.9, speed: [2, 7 * power], life: [0.4, 1.0], size: [0.03, 0.08], color: 0xdde8f2, intensity: 1, gravity: 12, drag: 0.6, spin: 9, bounce: 0.3 });
  fx.groundRing(x, z, 3.2 * power + 1.5, pal.core, pal.mid, { life: 0.45, power: el === 'phys' ? 1.0 : 2.4, width: 0.07 });
}

/** 冲刺、突进时身后的气流线。 */
export function windLines(fx: Fx, x: number, y: number, dir: number, len = 1, color: THREE.ColorRepresentation = 0xdfeeff) {
  fx.emit({ kind: 'spark', count: Math.round(8 * len), pos: [x, y, 0.2], spread: [0.3, 0.55, 0.3], dir: [-dir, 0, 0], cone: 0.06, speed: [7, 15], life: [0.1, 0.22], size: [0.02, 0.04], color, intensity: 1.6, alpha: 0.7 });
}
