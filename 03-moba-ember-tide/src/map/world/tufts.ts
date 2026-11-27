// 墙脚的一溜矮草和墙顶的几丛阔叶草：把墙“缝”进地面里。叶子和颜色用样板间那一套。
// 草丛（能藏人的高草）和地表的草是 2.6 的事，这里只有跟着墙走的这一点。

import * as THREE from "three";
import { rng } from "../../core/noise";
import { BRUSH_LOOK, GRASS_LOOK, blade, bladeMaterial } from "../slice/flora";
import type { Tuft } from "../slice/stone";

export function createTufts(time: { value: number }, tufts: Tuft[], isGrass: (x: number, z: number) => boolean, cell = 26): THREE.Group {
  const group = new THREE.Group(); group.name = "tufts";
  type Inst = { x: number; y: number; z: number; yaw: number; lean: number; h: number; w: number; c: number[]; k: number; lit: number };
  const tall = new Map<string, Inst[]>(), short = new Map<string, Inst[]>(), r2 = rng(778);
  const into = (m: Map<string, Inst[]>, team: number, x: number, z: number) => { const key = `${team}:${Math.floor(x / cell)},${Math.floor(z / cell)}`; if (!m.has(key)) m.set(key, []); return m.get(key)!; };
  for (const t of tufts) {
    if (t.top && r2() < 0.3) {
      const look = BRUSH_LOOK[t.team], n = 7 + Math.floor(r2() * 4), hgt = 0.3 + r2() * 0.28, c = look.mid[Math.floor(r2() * look.mid.length)], out = into(tall, t.team, t.x, t.z);
      for (let i = 0; i < n; i++) out.push({ x: t.x + (r2() - 0.5) * 0.1, y: t.y - 0.02, z: t.z + (r2() - 0.5) * 0.1, yaw: (i / n) * 6.283 + r2(), lean: 0.25 + r2() * 0.7, h: hgt * (0.7 + r2() * 0.5), w: 1.5 + r2() * 0.9, c, k: 1.0 + r2() * 0.2, lit: 0.45 + r2() * 0.5 });
    } else if (t.top || isGrass(t.x, t.z)) {
      const look = GRASS_LOOK[t.team], c = look.mid[Math.floor(r2() * look.mid.length)], n = 4 + Math.floor(r2() * 4), out = into(short, t.team, t.x, t.z), lit = t.top ? 0.75 : 0.35, tone = t.top ? 1.04 : 0.92;
      for (let i = 0; i < n; i++) out.push({ x: t.x + (r2() - 0.5) * 0.1, y: t.y - 0.01, z: t.z + (r2() - 0.5) * 0.1, yaw: r2() * 6.283, lean: 0.12 + r2() * 0.6, h: t.h * (0.7 + r2() * 0.5), w: 0.55 + r2() * 0.4, c, k: tone * (0.9 + r2() * 0.22), lit: Math.min(lit * (0.5 + r2() * 0.9), 1) });
    }
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color();
  const bladeTall = blade(6, 0.135, 0.46, 2.4), bladeShort = blade(3, 0.085, 0.32, 2);
  const matTall = [0, 1].map(t => bladeMaterial(time, 0.07, BRUSH_LOOK[t].root, BRUSH_LOOK[t].tip)), matShort = [0, 1].map(t => bladeMaterial(time, 0.022, GRASS_LOOK[t].root, GRASS_LOOK[t].tip));
  let count = 0;
  const build = (m: Map<string, Inst[]>, geo: THREE.BufferGeometry, mats: THREE.Material[], shadow: boolean) => {
    for (const [key, list] of m) {
      const g = geo.clone(), lit = new Float32Array(list.length), im = new THREE.InstancedMesh(g, mats[Number(key[0])], list.length);
      list.forEach((b, i) => { im.setMatrixAt(i, m4.compose(new THREE.Vector3(b.x, b.y, b.z), q.setFromEuler(e.set(b.lean, b.yaw, 0, "YXZ")), new THREE.Vector3(b.w, b.h, b.h))); im.setColorAt(i, col.setRGB(b.c[0], b.c[1], b.c[2], THREE.SRGBColorSpace).multiplyScalar(b.k)); lit[i] = b.lit; });
      g.setAttribute("aLit", new THREE.InstancedBufferAttribute(lit, 1));
      im.castShadow = shadow; im.receiveShadow = !shadow; im.computeBoundingSphere(); group.add(im); count += list.length;
    }
  };
  build(tall, bladeTall, matTall, true); build(short, bladeShort, matShort, false);
  (group.userData as any).count = count;
  return group;
}
