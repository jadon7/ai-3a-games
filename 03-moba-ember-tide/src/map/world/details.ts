// 地面上近看才有的小东西（阶段 2.5）：地表的短草，和地面同色系的小石子。
//   · 短草按画好的地面来长：画的是草（或红土）的地方才长，石板缝里、路边长得密而矮，把石板“缝”进地面里；
//   · 小石子只放在墙脚、路边、河岸、营地边上，颜色用的就是墙边大石头那种石头，明度贴着地面，不撒在空地中间。
// 两样都按 25 米一格分开：镜头走到哪一格才生成哪一格，镜头外的不画。能藏人的高草丛是 2.6 的事，这里没有。

import { TOON_ON } from "../toon";
import * as THREE from "three";
import { mergeGeometries, toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { fbm, rng, smoothstep } from "../../core/noise";
import { fields } from "../layout";
import { GRASS_LOOK, blade, bladeMaterial } from "../slice/flora";
import { tint, wallMaterials, type StoneTextures } from "../slice/stone";
import { WATER_Y, plateau, terrainHeight } from "../terrain";

const CELL = 25, HALF = 100, NEAR = 58;       // 每格 25 米；离镜头 58 米以内的格子才生成

export interface Details { group: THREE.Group; update: (x: number, z: number, far: boolean) => void; busy: () => boolean; count: () => { grass: number; stones: number }; }

export function createDetails(time: { value: number }, grassAt: (x: number, z: number) => number, tex: StoneTextures): Details {
  const group = new THREE.Group(); group.name = "details";
  const bladeShort = blade(3, 0.085, 0.32, 2), grassMat = [0, 1].map(t => bladeMaterial(time, 0.022, GRASS_LOOK[t].root, GRASS_LOOK[t].tip));
  // 小石子的三种形状：一个低面数的球压几刀
  // 对方的石头本身颜色深，放在红土上像一个个黑点，所以对方的小石子提亮一档
  const pebbleSet = (k: number) => [11, 23, 37].map(seed => {
    const g = new THREE.IcosahedronGeometry(1, 2), p = g.getAttribute("position"), rd = rng(seed), v = new THREE.Vector3();
    const planes = Array.from({ length: 7 }, () => ({ n: new THREE.Vector3(rd() * 2 - 1, rd() * 1.6 - 0.4, rd() * 2 - 1).normalize(), d: 0.55 + rd() * 0.3 }));
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); for (const pl of planes) { const e = v.dot(pl.n) - pl.d; if (e > 0) v.addScaledVector(pl.n, -e * 0.85); } p.setXYZ(i, v.x, v.y * 0.62, v.z); }
    const o = toCreasedNormals(g, 0.7); o.deleteAttribute("uv"); return tint(o, k, 0.2);
  });
  const pebbles = [pebbleSet(0.98), pebbleSet(1.55)];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color();
  let nGrass = 0, nStones = 0;

  function buildCell(ci: number, cj: number) {
    const x0 = -HALF + ci * CELL, z0 = -HALF + cj * CELL, r = rng(9000 + ci * 31 + cj * 17);
    // ---- 短草 ----
    type Inst = { x: number; y: number; z: number; yaw: number; lean: number; h: number; w: number; c: number[]; k: number; lit: number };
    const lists: Inst[][] = [[], []], STEP = 0.3;
    for (let z = z0; z < z0 + CELL; z += STEP) for (let x = x0; x < x0 + CELL; x += STEP) {
      const px = x + (r() - 0.5) * STEP, pz = z + (r() - 0.5) * STEP;
      if (Math.abs(px) > 79 || Math.abs(pz) > 79 || grassAt(px, pz) < 0.6) continue;
      const f = fields(px, pz);
      if (f.dEdge < 2.3 || f.dRiver < 0.3 || f.dWall < -0.25 || f.dIsland < 0.6 || Math.abs(f.dBase) < 1.3 || f.dBrush < 0.25) continue;      // 草丛里面是高草，不再长短草
      const team = f.u < 0 ? 0 : 1, inBase = f.dBase < 0;
      // 石板缝里、路边、塔脚下那圈石板之间、广场的缝里：密而矮。空地上：按斑块稀稀地长，高一点
      const paved = Math.max(smoothstep(1.6, 0.2, f.dLane), smoothstep(7.5, 5.5, f.dTower), inBase ? 1 : 0), patch = smoothstep(0.48, 0.7, fbm(px * 0.22, pz * 0.22, 3, 91));
      let prob = 0.035 + paved * 0.42 + patch * 0.3;
      if (f.dTrail < 0.4) prob *= 0.3; if (f.dCamp < 0) prob *= 0.25; if (team === 1) prob *= 0.6;          // 土路、营地踩秃了；红土地上的草本来就稀
      if (r() > prob) continue;
      const y = terrainHeight(px, pz); if (y < WATER_Y + 0.04) continue;
      const hgt = (paved > 0.5 ? 0.1 + r() * 0.12 : 0.15 + r() * 0.2) + patch * 0.07, look = GRASS_LOOK[team], c = look.mid[Math.floor(r() * look.mid.length)], n = 4 + Math.floor(r() * 4), lit = 0.25 + patch * 0.5;
      for (let i = 0; i < n; i++) lists[team].push({ x: px + (r() - 0.5) * 0.1, y: y - 0.01, z: pz + (r() - 0.5) * 0.1, yaw: r() * 6.283, lean: 0.12 + r() * 0.6, h: hgt * (0.7 + r() * 0.5), w: 0.55 + r() * 0.4, c, k: 0.9 + r() * 0.22, lit: Math.min(lit * (0.5 + r() * 0.9), 1) });
    }
    for (const team of [0, 1]) {
      const list = lists[team]; if (!list.length) continue;
      const g = bladeShort.clone(), lit = new Float32Array(list.length), im = new THREE.InstancedMesh(g, grassMat[team], list.length);
      list.forEach((b, i) => { im.setMatrixAt(i, m4.compose(new THREE.Vector3(b.x, b.y, b.z), q.setFromEuler(e.set(b.lean, b.yaw, 0, "YXZ")), new THREE.Vector3(b.w, b.h, b.h))); im.setColorAt(i, col.setRGB(b.c[0], b.c[1], b.c[2], THREE.SRGBColorSpace).multiplyScalar(b.k)); lit[i] = b.lit; });
      g.setAttribute("aLit", new THREE.InstancedBufferAttribute(lit, 1));
      im.receiveShadow = true; im.computeBoundingSphere(); im.name = "grass"; group.add(im); nGrass += list.length;
    }
    // ---- 小石子 ----
    const geo: THREE.BufferGeometry[][] = [[], []];
    for (let k = 0; k < 760; k++) {
      const px = x0 + r() * CELL, pz = z0 + r() * CELL, roll = r();
      if (Math.abs(px) > 78 || Math.abs(pz) > 78) continue;
      const f = fields(px, pz);
      if (f.dEdge < 2.4 || f.dRiver < 0.25 || f.dWall < 0.25 || f.dTower < 2.3 || f.dIsland < 0.6 || f.dBrush < 0.6 || plateau(f.a, f.w, f.dBase) > 0.02) continue;
      const score = f.dWall < 2.0 ? 0.22 : f.dRiver < 2.0 ? 0.15 : f.dLane > -0.2 && f.dLane < 1.5 ? 0.05 : f.dCamp < 0.8 && f.dCamp > -2 ? 0.08 : 0.002;
      if (roll > score) continue;
      const cnt = 1 + Math.floor(r() * 2.4);
      for (let j = 0; j < cnt; j++) {
        const sx = px + (j ? (r() - 0.5) * 0.7 : 0), sz = pz + (j ? (r() - 0.5) * 0.7 : 0), s = 0.07 + r() * r() * 0.26, y = terrainHeight(sx, sz); if (y < WATER_Y) continue;
        const team = f.u < 0 ? 0 : 1, g = pebbles[team][Math.floor(r() * 3)].clone();
        g.applyMatrix4(m4.compose(new THREE.Vector3(sx, y + s * 0.18, sz), q.setFromEuler(e.set(r() * 0.4 - 0.2, r() * 6.283, r() * 0.4 - 0.2)), new THREE.Vector3(s * (1 + r() * 0.5), s, s * (1 + r() * 0.3))));
        geo[team].push(g); nStones++;
      }
    }
    for (const team of [0, 1]) { if (!geo[team].length || TOON_ON) continue;      /* stylecost 试验：卡通档不要满地小石子 */ const m = new THREE.Mesh(mergeGeometries(geo[team])!, wallMaterials(tex, team).rock); m.castShadow = true; m.receiveShadow = true; m.name = "stones"; group.add(m); }
  }

  const done = new Set<string>(); let pending = 0;
  const update = (x: number, z: number, far: boolean) => {
    group.visible = !far; if (far) return;
    pending = 0; let built = false;
    for (let cj = 0; cj < 8; cj++) for (let ci = 0; ci < 8; ci++) {
      const key = ci + "," + cj; if (done.has(key)) continue;
      if (Math.hypot(-HALF + (ci + 0.5) * CELL - x, -HALF + (cj + 0.5) * CELL - z) > NEAR) continue;
      if (built) { pending++; continue; }                                    // 一帧只生成一格，不卡顿
      buildCell(ci, cj); done.add(key); built = true;
    }
  };
  return { group, update, busy: () => pending > 0, count: () => ({ grass: nGrass, stones: nStones }) };
}
