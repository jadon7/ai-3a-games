// 可平铺的水纹贴图：水面用它做波纹和粼光，地面用它做河底的光斑和水下的晃动。

import * as THREE from "three";
import { vnoise } from "../../core/noise";

let cached: THREE.DataTexture | null = null;
/** 可平铺的水纹法线：周期性的值噪声求梯度。透明通道存高度 */
export function rippleNormal(size = 256): THREE.DataTexture {
  if (cached) return cached;
  const h = new Float32Array(size * size);
  const per = (x: number, y: number, f: number, seed: number) => {
    const fx = (x / size) * f, fy = (y / size) * f, xi = Math.floor(fx), yi = Math.floor(fy), tx = fx - xi, ty = fy - yi;
    const s = (t: number) => t * t * (3 - 2 * t), g = (i: number, j: number) => vnoise(((i % f) + f) % f + 0.5, ((j % f) + f) % f + 0.5, seed);
    const a = g(xi, yi), b = g(xi + 1, yi), c = g(xi, yi + 1), d = g(xi + 1, yi + 1);
    return a + (b - a) * s(tx) + (c - a) * s(ty) + (a - b - c + d) * s(tx) * s(ty);
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[y * size + x] = per(x, y, 6, 1) * 0.5 + per(x, y, 13, 2) * 0.3 + per(x, y, 29, 3) * 0.2;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const gx = (h[y * size + ((x + 1) % size)] - h[y * size + ((x + size - 1) % size)]) * 9, gy = (h[((y + 1) % size) * size + x] - h[((y + size - 1) % size) * size + x]) * 9;
    const inv = 1 / Math.hypot(gx, gy, 1), o = (y * size + x) * 4;
    data[o] = (-gx * inv * 0.5 + 0.5) * 255; data[o + 1] = (-gy * inv * 0.5 + 0.5) * 255; data[o + 2] = (inv * 0.5 + 0.5) * 255; data[o + 3] = h[y * size + x] * 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = true; t.needsUpdate = true;
  cached = t;
  return t;
}

