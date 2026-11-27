// 水边的植物（阶段 2.6）：岸边一丛丛的水草，水面上几片睡莲。
// 水草故意做得矮（不到一米）、稀：规矩是“看起来能藏人的植被就必须真的能藏人”，岸边这些一眼看得出藏不了人。
// 过河的路、河道两头的石阶、Boss 的石台附近不长。

import * as THREE from "three";
import { rng } from "../../core/noise";
import { LAGOON, fields, toWorld } from "../layout";
import { blade, bladeMaterial } from "../slice/flora";
import { WATER_Y, terrainHeight } from "../terrain";

export function createShore(time: { value: number }): THREE.Group {
  const group = new THREE.Group(); group.name = "shore";
  const rd = rng(9100), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color();
  /** 从水里往岸上找水边：沿着 (du,dv) 方向，在 r0 到 r1 之间找地面刚好露出水面的那一点 */
  const waterline = (u0: number, v0: number, du: number, dv: number, r0: number, r1: number) => {
    const h = (r: number) => { const [x, z] = toWorld(u0 + du * r, v0 + dv * r); return terrainHeight(x, z) - WATER_Y; };
    if (h(r0) > 0 || h(r1) < 0) return null;
    let lo = r0, hi = r1; for (let i = 0; i < 18; i++) { const m = (lo + hi) / 2; if (h(m) < 0) lo = m; else hi = m; }
    return lo;
  };
  // 岸线上的候选点：河道两岸，加上两个 Boss 潭的一圈
  const spots: { u: number; v: number; du: number; dv: number; r: number }[] = [];
  for (let v = -74; v <= 74; v += 1.6) for (const su of [-1, 1]) { if (Math.abs(v) < 7.5 || Math.abs(Math.abs(v) - LAGOON.w) < LAGOON.r + 1) continue; const r = waterline(0, v, su, 0, 2.5, 13); if (r !== null) spots.push({ u: 0, v, du: su, dv: 0, r }); }
  for (const sv of [-1, 1]) for (let t = 0; t < 6.283; t += 0.11) { const r = waterline(0, sv * LAGOON.w, Math.cos(t), Math.sin(t), 8.5, 17); if (r !== null) spots.push({ u: 0, v: sv * LAGOON.w, du: Math.cos(t), dv: Math.sin(t), r }); }

  type Inst = { x: number; y: number; z: number; yaw: number; lean: number; h: number; w: number; c: number[]; lit: number };
  const reeds: Inst[][] = [[], []], pads: { x: number; z: number; r: number; yaw: number; c: number[] }[] = [];
  const REED = [{ root: [0.1, 0.24, 0.2], mid: [[0.3, 0.46, 0.26], [0.36, 0.5, 0.25], [0.26, 0.42, 0.28]], tip: [0.68, 0.74, 0.42] }, { root: [0.26, 0.12, 0.09], mid: [[0.52, 0.3, 0.18], [0.58, 0.36, 0.2], [0.46, 0.26, 0.17]], tip: [0.86, 0.64, 0.38] }];
  const PAD = [[[0.24, 0.42, 0.2], [0.32, 0.5, 0.22], [0.2, 0.38, 0.24]], [[0.3, 0.36, 0.17], [0.36, 0.4, 0.18], [0.26, 0.32, 0.18]]];      // 河是中立的：两侧的睡莲都是绿的，对方一侧偏橄榄色
  let skip = 0;
  for (const sp of spots) {
    if (skip > 0) { skip--; continue; }
    if (rd() > 0.36) continue;
    const at = (r: number, side = 0) => toWorld(sp.u + sp.du * r - sp.dv * side, sp.v + sp.dv * r + sp.du * side), [bx, bz] = at(sp.r), f = fields(bx, bz), team = f.u < 0 ? 0 : 1;
    if (f.dLane < 3 || f.dIsland < 3 || f.sSide > -8) continue;
    skip = 1 + Math.floor(rd() * 3);
    // 一丛水草：根在水边的浅水里
    const n = 16 + Math.floor(rd() * 14), look = REED[team];
    for (let i = 0; i < n; i++) {
      const [x, z] = at(sp.r - 0.05 - rd() * 0.6, (rd() - 0.5) * 1.7), y = Math.max(terrainHeight(x, z), WATER_Y - 0.12);
      reeds[team].push({ x, y: y - 0.02, z, yaw: rd() * 6.283, lean: 0.04 + rd() * 0.26, h: 0.5 + rd() * 0.5, w: 1.3 + rd() * 0.8, c: look.mid[Math.floor(rd() * 3)], lit: 0.3 + rd() * 0.6 });
    }
    // 旁边的水面上几片睡莲
    if (rd() < 0.75) { const m = 3 + Math.floor(rd() * 5), base = sp.r - 1.0 - rd() * 1.2, off = (rd() - 0.5) * 2;
      for (let i = 0; i < m; i++) { const [x, z] = at(base - rd() * 1.1, off + (rd() - 0.5) * 1.8); if (terrainHeight(x, z) > WATER_Y - 0.12) continue; pads.push({ x, z, r: 0.16 + rd() * 0.2, yaw: rd() * 6.283, c: PAD[team][Math.floor(rd() * 3)] }); } }
  }
  const g0 = blade(5, 0.06, 0.4, 2.2);
  for (const team of [0, 1]) {
    const list = reeds[team]; if (!list.length) continue;
    const g = g0.clone(), lit = new Float32Array(list.length), im = new THREE.InstancedMesh(g, bladeMaterial(time, 0.05, REED[team].root, REED[team].tip), list.length);
    list.forEach((b, i) => { im.setMatrixAt(i, m4.compose(new THREE.Vector3(b.x, b.y, b.z), q.setFromEuler(e.set(b.lean, b.yaw, 0, "YXZ")), new THREE.Vector3(b.w, b.h, b.h))); im.setColorAt(i, col.setRGB(b.c[0], b.c[1], b.c[2], THREE.SRGBColorSpace)); lit[i] = b.lit; });
    g.setAttribute("aLit", new THREE.InstancedBufferAttribute(lit, 1)); im.castShadow = true; im.frustumCulled = false; group.add(im);
  }
  if (pads.length) {
    // 睡莲叶：缺一个口的圆片，平躺在水面上
    const pg = new THREE.CircleGeometry(1, 12, 0.3, 5.7); pg.rotateX(-Math.PI / 2);
    const im = new THREE.InstancedMesh(pg, new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0, side: THREE.DoubleSide }), pads.length);
    pads.forEach((p, i) => { im.setMatrixAt(i, m4.compose(new THREE.Vector3(p.x, WATER_Y + 0.016, p.z), q.setFromEuler(e.set(0, p.yaw, 0)), new THREE.Vector3(p.r, 1, p.r))); im.setColorAt(i, col.setRGB(p.c[0], p.c[1], p.c[2], THREE.SRGBColorSpace)); });
    im.frustumCulled = false; im.receiveShadow = true; group.add(im);
  }
  (group.userData as any).count = { reeds: reeds[0].length + reeds[1].length, pads: pads.length };
  return group;
}
