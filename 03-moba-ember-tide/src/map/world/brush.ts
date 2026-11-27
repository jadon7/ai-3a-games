// 整张地图的草丛（阶段 2.6）：能藏人的高草，每方 24 块。长法和样板间里验收过的是同一个函数（slice/flora.ts 的 brushBlades），
// 这里只管把 48 块都种上：一块草丛一个网格，镜头外的不画；拉远了看的时候每块只画三成的叶子。
// 我方青绿，对方红褐。规矩不变：看起来能藏人的只有它，布局里它覆盖的范围也跟画面一致（见 layout.ts 的 sample）。

import * as THREE from "three";
import { rng } from "../../core/noise";
import { BRUSH, toLane, toWorld } from "../layout";
import { BRUSH_LOOK, blade, bladeMaterial, brushBlades, type Inst } from "../slice/flora";
import { terrainHeight } from "../terrain";
import { TOON_ON, T } from "../toon";

export interface Brush { group: THREE.Group; setFar: (far: boolean) => void; patches: { p: [number, number]; q: [number, number]; hw: number }[]; count: number; }

export function createBrush(time: { value: number }): Brush {
  const group = new THREE.Group(); group.name = "brush";
  const geo = blade(6, TOON_ON ? T.bw : 0.135, 0.46, 2.4)      /* 画风 B：叶子宽一点，一丛一丛的更像 B 里那种概括的阔叶草 */, mats = [0, 1].map(t => bladeMaterial(time, 0.07, BRUSH_LOOK[t].root, BRUSH_LOOK[t].tip));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color();
  const patches: Brush["patches"] = [], meshes: { im: THREE.InstancedMesh; full: number }[] = []; let count = 0;
  BRUSH.forEach((b, bi) => { for (const su of [-1, 1]) for (const sv of [-1, 1]) {
    const P = toWorld(su * b.p[0], sv * b.p[1]), Q = toWorld(su * b.q[0], sv * b.q[1]), team = su < 0 ? 0 : 1, rd = rng(4242 + bi * 53 + (su + 1) * 7 + (sv + 1) * 3);
    const all: Inst[] = []; brushBlades(all, P, Q, b.hw, team, rd, terrainHeight);
    const list = all.filter(bl => toLane(bl.x, bl.z)[0] * su > -0.15);       // 只留自己这一侧的
    if (!list.length) return;
    // 打乱顺序：拉远时只画前面一部分，剩下的仍然均匀地分布在整块草丛里
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rd() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    const g = geo.clone(), lit = new Float32Array(list.length), im = new THREE.InstancedMesh(g, mats[team], list.length);
    list.forEach((bl, i) => { im.setMatrixAt(i, m4.compose(new THREE.Vector3(bl.x, bl.y, bl.z), q.setFromEuler(e.set(bl.lean, bl.yaw, 0, "YXZ")), new THREE.Vector3(bl.w, bl.h, bl.h))); im.setColorAt(i, col.setRGB(bl.c[0], bl.c[1], bl.c[2], THREE.SRGBColorSpace).multiplyScalar(bl.k)); lit[i] = bl.lit; });
    g.setAttribute("aLit", new THREE.InstancedBufferAttribute(lit, 1));
    im.castShadow = true; im.receiveShadow = false; im.computeBoundingSphere(); group.add(im);
    meshes.push({ im, full: list.length }); patches.push({ p: P, q: Q, hw: b.hw }); count += list.length;
  } });
  const setFar = (far: boolean) => { for (const m of meshes) m.im.count = far ? Math.ceil(m.full * 0.3) : m.full; };
  return { group, setFar, patches, count };
}
