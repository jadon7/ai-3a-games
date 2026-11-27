// 大气模块测试页：占位石柱 + 雾 + 体积云海 + 光柱。
// 参数：?atmo=0 关掉大气模块（对比内置简单雾、测耗时差）；?fly=1 相机沿 +X 以 40 m/s 掠飞（检查运动中是否闪烁）。
import * as THREE from 'three';
import { createApp } from '../app.js';
import { PARAMS, num, vec, SUN_DIR } from '../common.js';
import { createAtmosphere } from '../atmosphere.js';

const app = await createApp();
const rock = new THREE.MeshStandardMaterial({ color: 0x3a342d, roughness: 0.95 });
const rng = (() => { let s = 11; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
for (let i = 0; i < 110; i++) {
  const h = 150 + rng() * 300, r = 12 + rng() * 30;
  const x = (rng() - 0.5) * 3200, z = (rng() - 0.5) * 3200;
  if (Math.hypot(x, z) < 70) continue;
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.75, r, h, 14), rock);
  m.position.set(x, h / 2 - 40, z);
  m.castShadow = m.receiveShadow = true; app.scene.add(m);
}
// 光柱测试用：太阳方向 130 m 处左右各一根近柱，阳光从中间的缝里漏过来
{
  const sx = new THREE.Vector3(SUN_DIR.x, 0, SUN_DIR.z).normalize(), px = new THREE.Vector3(-sx.z, 0, sx.x);
  for (const k of [-1, 1]) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(15, 19, 330, 14), rock);
    m.position.copy(sx).multiplyScalar(130).addScaledVector(px, 24 * k); m.position.y = 330 / 2 - 40;
    m.castShadow = m.receiveShadow = true; app.scene.add(m);
  }
}
let atmo = null;
if (num('atmo', 1)) { atmo = createAtmosphere(app); app.setAtmosphere(atmo); app.stats.atmo = atmo.stats; }
if (num('fly', 0)) {
  const p0 = app.camera.position.clone(), look = vec('look', new THREE.Vector3(0, 113, 0)).sub(vec('cam', new THREE.Vector3(0, 115, 12)));
  const v = num('fly', 40);
  app.onUpdate((dt, t) => { app.camera.position.set(p0.x + v * t, p0.y, p0.z); app.camera.lookAt(app.camera.position.clone().add(look)); });
}
window.__APP = app; window.__ATMO = atmo;
await app.start();
// 同步测帧耗时：连续画 N 帧后 readPixels 强制等 GPU 做完（app 自带的 bench 在无头 Chrome 里不会等 GPU）
const NB = num('bench2', 0);
if (NB) {
  const gl = app.renderer.getContext(), px = new Uint8Array(4);
  const run = n => { const t0 = performance.now(); for (let i = 0; i < n; i++) { app.step(1 / 60); app.render(1 / 60); } gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return (performance.now() - t0) / n; };
  run(8); app.stats.msSync = +run(NB).toFixed(2);
}
