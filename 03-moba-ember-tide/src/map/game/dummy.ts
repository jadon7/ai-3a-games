// 木桩（阶段 3）：练手用的靶子。一根木桩、一根横木、草扎的身子、麻布的头，脚下是对方的红圈。
// 挨打会晃、会掉血；打空了倒下，三秒后重新立起来。

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { lifeBar } from "../hero/hero";

export interface Dummy {
  group: THREE.Group; x: number; z: number; y: number; radius: number;
  hp: number; max: number; alive: boolean;
  hit: (dmg: number, fromX: number, fromZ: number) => boolean;      // 返回这一下是不是打倒了
  update: (dt: number, camDist: number) => void;
}

export function createDummy(x: number, z: number, y: number, yaw = 0): Dummy {
  const group = new THREE.Group(); group.position.set(x, y, z);
  const body = new THREE.Group(); body.rotation.y = yaw; group.add(body);
  const col = (g: THREE.BufferGeometry, c: number, k = 0.12) => { const o = g.index ? g.toNonIndexed() : g; o.deleteAttribute("uv"); const n = o.getAttribute("position").count, a = new Float32Array(n * 3), cc = new THREE.Color(c);
    for (let i = 0; i < n; i++) { const s = 1 + (Math.sin(i * 12.9898) * 43758.5453 % 1) * k * (i % 3 === 0 ? 1 : 0.5); a[i * 3] = cc.r * s; a[i * 3 + 1] = cc.g * s; a[i * 3 + 2] = cc.b * s; } o.setAttribute("color", new THREE.BufferAttribute(a, 3)); return o; };
  const at = (g: THREE.BufferGeometry, px: number, py: number, pz: number, rx = 0, rz = 0) => { g.rotateX(rx); g.rotateZ(rz); g.translate(px, py, pz); return g; };
  const WOOD = 0x6f4e33, STRAW = 0xc1a04f, ROPE = 0x8c7a52, CLOTH = 0xb9ab8c, RAG = 0x9b2f24;
  const parts = [
    col(at(new THREE.CylinderGeometry(0.62, 0.7, 0.16, 10), 0, 0.08, 0), 0x8a8676),                        // 石座
    col(at(new THREE.CylinderGeometry(0.13, 0.16, 2.3, 8), 0, 1.25, 0), WOOD),                             // 立柱
    col(at(new THREE.CylinderGeometry(0.09, 0.09, 1.7, 7), 0, 1.95, 0, 0, Math.PI / 2), WOOD),             // 横木（两臂）
    col(at(new THREE.CylinderGeometry(0.36, 0.3, 1.0, 12), 0, 1.5, 0), STRAW, 0.22),                       // 草扎的身子
    col(at(new THREE.TorusGeometry(0.36, 0.035, 5, 14), 0, 1.82, 0, Math.PI / 2), ROPE),
    col(at(new THREE.TorusGeometry(0.33, 0.035, 5, 14), 0, 1.22, 0, Math.PI / 2), ROPE),
    col(at(new THREE.SphereGeometry(0.3, 12, 9), 0, 2.42, 0), CLOTH, 0.1),                                 // 麻布的头
    col(at(new THREE.TorusGeometry(0.2, 0.03, 5, 12), 0, 2.16, 0, Math.PI / 2), ROPE),
    col(at(new THREE.BoxGeometry(0.5, 0.42, 0.03), 0, 1.55, 0.37), RAG, 0.08),                             // 胸前一块红布：对方的颜色
    col(at(new THREE.CylinderGeometry(0.12, 0.14, 0.26, 8), -0.85, 1.95, 0, 0, Math.PI / 2), STRAW, 0.2),
    col(at(new THREE.CylinderGeometry(0.12, 0.14, 0.26, 8), 0.85, 1.95, 0, 0, Math.PI / 2), STRAW, 0.2),
  ];
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  const mesh = new THREE.Mesh(mergeGeometries(parts)!, mat); mesh.castShadow = true; mesh.receiveShadow = true; body.add(mesh);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.92, 0.98, 48), new THREE.MeshBasicMaterial({ color: 0xff5a48, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; ring.renderOrder = 3; group.add(ring);
  const bar = lifeBar(1); bar.sprite.position.y = 3.25; group.add(bar.sprite);

  let tiltX = 0, tiltZ = 0, vx = 0, vz = 0, flash = 0, down = 0;
  const d: Dummy = {
    group, x, z, y, radius: 0.7, hp: 600, max: 600, alive: true,
    hit(dmg, fromX, fromZ) {
      if (!d.alive) return false;
      d.hp = Math.max(0, d.hp - dmg); bar.set(d.hp / d.max); flash = 1;
      const dx = x - fromX, dz = z - fromZ, l = Math.hypot(dx, dz) || 1, k = 2.2 + dmg * 0.012;      // 往挨打的反方向晃
      vx += (dz / l) * k; vz += (-dx / l) * k;
      if (d.hp <= 0) { d.alive = false; down = 0.0001; return true; }
      return false;
    },
    update(dt, camDist) {
      // 晃动：一个有阻尼的弹簧
      vx += (-tiltX * 90 - vx * 7) * dt; vz += (-tiltZ * 90 - vz * 7) * dt; tiltX += vx * dt; tiltZ += vz * dt;
      let fall = 0;
      if (down > 0) { down += dt; fall = Math.min(1, down / 0.45); if (down > 3.2) { down = 0; d.alive = true; d.hp = d.max; bar.set(1); tiltX = tiltZ = vx = vz = 0; } }
      body.rotation.x = tiltX + fall * fall * 1.45; body.rotation.z = tiltZ; body.position.y = -fall * 0.05;
      flash = Math.max(0, flash - dt * 7); mat.emissive.setRGB(0.2 * flash, 0.2 * flash, 0.18 * flash);
      bar.sprite.visible = camDist > 12 && d.alive; ring.visible = d.alive;
    },
  };
  return d;
}
