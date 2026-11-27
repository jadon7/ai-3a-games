// 换画风 B · b-walls：在 node 里直接跑一遍地图的建造代码（不开浏览器、不要显卡），把所有“会挡路或者决定挡路的东西”打出来：
//   野区墙的中线和墙头石头、墩柱（nav 用）、城墙外山石占的地方（决定树种在哪）、倒木和树桩（nav 用）、树的数量和树干的几何（树干没改形状，
//   几何一样就说明每棵树的位置一样）、寻路网格（照 world/main.ts 的拼法）。改前、改后各打包跑一次，对比两份 JSON。
// 用法见 tools/bwalls_proof.sh。
// toon.ts 在载入时读网址参数：node 里没有 location，打包时用 esbuild 的 banner 先垫一个（import 会被提到最前面，写在这里来不及）
import * as THREE from "three";
import { createWalls, useGround } from "../src/map/slice/stone";
import { createRamparts } from "../src/map/world/ramparts";
import { createTrees } from "../src/map/world/trees";
import { terrainHeight } from "../src/map/terrain";
import { fields } from "../src/map/layout";
import { createNav, gateSolids } from "../src/map/game/nav";

useGround(terrainHeight);
const st = { stone: [null, null], trim: [null, null], rock: [null, null], bark: null } as any;
const walls = createWalls(st, { inside: () => true, cell: 26 });
const ramparts = createRamparts(st, { cornerPier: [false, false] });      // 出生点的建筑都有了，角上不立占位的大墩（和游戏里一样）
const wc = (walls.userData as any).contact as { lines: [number, number][][]; circles: { x: number; z: number; r: number }[] };
const trees = createTrees(st, { value: 0 }, ramparts.solids, wc.lines);
// 和 world/main.ts 里一模一样的拼法
const rocks = wc.circles.map(c => ({ x: c.x, z: c.z, r: c.r * 0.8 })).filter(c => fields(c.x, c.z).dLane > c.r);
const nav = createNav([gateSolids(), { circles: [...rocks, ...trees.contact.circles.map(c => ({ x: c.x, z: c.z, r: c.r * 0.55 }))], lines: trees.contact.lines.map(l => ({ pts: l.pts, w: l.w * 0.5 })) }]);
let h = 2166136261 >>> 0, walk = 0;
for (let j = 0; j <= 324; j++) for (let i = 0; i <= 324; i++) { const w = nav.walkable(i * 0.5 - 81, j * 0.5 - 81) ? 1 : 0; walk += w; h = Math.imul(h ^ w, 16777619) >>> 0; }
/** 一组几何体所有顶点位置的指纹（保留到毫米） */
const geoHash = (o: THREE.Object3D, pick: (m: THREE.Mesh) => boolean) => { let a = 0, n = 0; o.traverse(m => { const me = m as THREE.Mesh; if (!me.isMesh || !pick(me)) return; const p = me.geometry.getAttribute("position"); for (let i = 0; i < p.count; i++) { a = (a * 31 + Math.round(p.getX(i) * 1000) * 3 + Math.round(p.getY(i) * 1000) * 5 + Math.round(p.getZ(i) * 1000) * 7) % 1000000007; } n += p.count; }); return { verts: n, hash: a }; };
const r4 = (v: number) => Math.round(v * 10000) / 10000;
const out = {
  wallLines: wc.lines.map(l => l.map(([x, z]) => [r4(x), r4(z)])),
  wallFootprints: wc.circles.map(c => [r4(c.x), r4(c.z), r4(c.r)]),
  navRocks: rocks.map(c => [r4(c.x), r4(c.z), r4(c.r)]),
  rampartSolids: ramparts.solids.map(c => [r4(c.x), r4(c.z), r4(c.r)]),
  rampartContactCircles: ramparts.contact.circles.map(c => [r4(c.x), r4(c.z), r4(c.r)]),
  rampartContactLines: ramparts.contact.lines.map(l => [l.pts.map(([x, z]) => [r4(x), r4(z)]), l.w]),
  foam: ramparts.foam.map(c => [r4(c.x), r4(c.z), r4(c.r)]),
  treeContact: { circles: trees.contact.circles.map(c => [r4(c.x), r4(c.z), r4(c.r)]), lines: trees.contact.lines.map(l => [l.pts.map(([x, z]) => [r4(x), r4(z)]), r4(l.w)]) },
  treeCount: trees.count,
  barkGeometry: geoHash(trees.group, m => (m.material as THREE.MeshStandardMaterial).roughness !== 1),      // 树干、倒木、树桩（叶团的材质粗糙度是 1）
  nav: { blockedCells: nav.blockedCells, walkable: walk, fnv: h.toString(16) },
  // 这几项会变（形状和草是画风的事），只是记下来看看
  info: { wallTufts: ((walls.userData as any).tufts as unknown[]).length, rampartTufts: ramparts.tufts.length, wallVerts: geoHash(walls, () => true).verts, rampartVerts: geoHash(ramparts.group, () => true).verts, treeVerts: geoHash(trees.group, () => true).verts },
};
console.log(JSON.stringify(out));
