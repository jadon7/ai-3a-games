// 关键建筑（阶段 2.7）：三档防御塔、水晶、出生点，两方各一套。
// 模型放在 public/assets/kit/ 里（清单是 index.json，由 tools/kit_collect.py 生成），载入以后统一换成项目的材质（kit/materials.ts）。
// 清单里没有的建筑，入口那边会继续摆白色的占位模型。
//
// 发光有预算：会发光的只有塔顶的晶体、水晶、出生点的水池（或火盆）。真正照亮周围的点光一共只有四盏，
// 每一帧分给离镜头最近的四处；其余的只有晶体自己亮，不把周围染一片。

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { L_BASE, coreSpots, fountainSpots, towerSpots } from "../layout";
import { applyKit, kitMaterials, kitTime } from "../kit/materials";
import { loadGLB } from "../quality";
import type { StoneTextures } from "../slice/stone";
import { DAIS_H, DAIS_R, STEP_D, terrainHeight } from "../terrain";

export const towerName = (team: number, tier: number) => `tower_${team ? "foe" : "me"}_${tier}`;
export const coreName = (team: number) => `core_${team ? "foe" : "me"}`;
export const spawnName = (team: number) => `spawn_${team ? "foe" : "me"}`;

/** 现在有哪些建筑的模型 */
export async function loadKitIndex(): Promise<Set<string>> {
  try { const r = await fetch("/assets/kit/index.json"); return r.ok ? new Set<string>((await r.json()).models ?? []) : new Set(); } catch { return new Set(); }
}

/** 一件建筑原本是几十个小网格。不转的部分按材质并成几个网格，绘制次数能少一个数量级；要转的部件（crystal、ring）原样留着 */
function compact(root: THREE.Object3D): THREE.Group {
  root.updateMatrixWorld(true);
  const out = new THREE.Group(), by = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; cast: boolean; recv: boolean }>(), keep = new Set<THREE.Object3D>();
  const spinOf = (o: THREE.Object3D) => { let hit: THREE.Object3D | null = null; for (let p: THREE.Object3D | null = o; p && p !== root; p = p.parent) { const n = p.name.toLowerCase(); if (n.startsWith("crystal") || n.startsWith("ring")) hit = p; } return hit; };
  root.traverse(o => {
    const m = o as THREE.Mesh; if (!m.isMesh) return;
    const sp = spinOf(m); if (sp) { keep.add(sp); return; }
    let g = m.geometry.clone();
    // 阶段 8 起模型是压缩过的（位置、法线存成整数，靠节点上的缩放还原）：先换回浮点数再套矩阵，不然套完又被压回整数的范围里
    for (const k of ["position", "normal"]) { const a = g.getAttribute(k); if (a && !(a.array instanceof Float32Array)) { const f = new Float32Array(a.count * 3); for (let i = 0; i < a.count; i++) { f[i * 3] = a.getX(i); f[i * 3 + 1] = a.getY(i); f[i * 3 + 2] = a.getZ(i); } g.setAttribute(k, new THREE.BufferAttribute(f, 3)); } }
    g.applyMatrix4(m.matrixWorld); if (g.index) g = g.toNonIndexed();
    for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal" && k !== "color") g.deleteAttribute(k);
    const c = g.getAttribute("color"), a = new Float32Array(c.count * 3); for (let i = 0; i < c.count; i++) { a[i * 3] = c.getX(i); a[i * 3 + 1] = c.getY(i); a[i * 3 + 2] = c.getZ(i); }
    g.setAttribute("color", new THREE.BufferAttribute(a, 3));
    const mat = m.material as THREE.Material; if (!by.has(mat)) by.set(mat, { geos: [], cast: m.castShadow, recv: m.receiveShadow }); by.get(mat)!.geos.push(g);
  });
  for (const [mat, v] of by) { const mesh = new THREE.Mesh(mergeGeometries(v.geos)!, mat); mesh.castShadow = v.cast; mesh.receiveShadow = v.recv; out.add(mesh); }
  for (const sp of keep) { const c = sp.clone(true); sp.matrixWorld.decompose(c.position, c.quaternion, c.scale); out.add(c); }
  return out;
}

export interface Buildings { group: THREE.Group; update: (t: number, x: number, z: number) => void; circles: { x: number; z: number; r: number; a: number }[]; tris: number;
  /** 把 (x,z) 上的塔或水晶变成废墟（阶段 4）：晶体和金属件没了，只剩一截矮石座。返回那座建筑，没找到返回 null */
  destroy: (x: number, z: number) => THREE.Object3D | null;
  /** (x,z) 上那座塔或水晶从脚下到顶有多高（阶段 4 的血条放在顶上用）；没找到返回 0 */
  top: (x: number, z: number) => number; }

export async function createBuildings(tex: StoneTextures, have: Set<string>): Promise<Buildings> {
  const group = new THREE.Group(); group.name = "buildings";
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder), cache = new Map<string, THREE.Object3D>(), circles: Buildings["circles"] = [];
  const spin: { o: THREE.Object3D; k: number }[] = [], glows: { p: THREE.Vector3; team: number; power: number; reach: number }[] = []; let tris = 0;
  const placed: { o: THREE.Object3D; team: number; x: number; z: number; top: number; glow: number[] }[] = [], halos: THREE.Sprite[] = [];
  // ?kitsrc=名字:路径,名字:路径 —— 把某几件换成别处的模型（换画风 B · b-build：建模的人在整张地图里、真实的位置和地面上看自己的半成品，比如
  // kitsrc=tower_me_1:/lab/kit_b/tower_me/out/tower_me_1.glb）。不带这个参数就是 public/assets/kit/ 里的正式模型
  const over = new Map((new URLSearchParams(location.search).get("kitsrc") ?? "").split(",").filter(kv => kv.includes(":")).map(kv => [kv.slice(0, kv.indexOf(":")), kv.slice(kv.indexOf(":") + 1)] as [string, string]));
  const get = async (name: string, team: number) => {
    if (!have.has(name) && !over.has(name)) return null;
    if (!cache.has(name)) { const g = await loadGLB(loader, over.get(name) ?? `/assets/kit/${name}.glb`); applyKit(g.scene, tex, team); cache.set(name, compact(g.scene)); }
    return cache.get(name)!.clone(true);
  };
  // 正面（模型的 +Z）朝地图中间：我方朝右上，对方朝左下
  const yawOf = (team: number) => (team === 0 ? (Math.PI * 3) / 4 : -Math.PI / 4);
  const box = new THREE.Box3(), v = new THREE.Vector3();
  const add = (o: THREE.Object3D, team: number, x: number, y: number, z: number, power: number, reach: number) => {
    o.position.set(x, y, z); o.rotation.y = yawOf(team); group.add(o); o.updateMatrixWorld(true); const g0 = glows.length;
    o.traverse(n => {
      const nm = n.name.toLowerCase(), m = n as THREE.Mesh; if (m.isMesh) tris += (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute("position").count) / 3;
      if (nm.startsWith("ring")) spin.push({ o: n, k: 0.15 });
      else if (nm.startsWith("crystal")) { spin.push({ o: n, k: 0.5 }); if (nm === "crystal" && power > 0) glows.push({ p: box.setFromObject(n).getCenter(v).clone(), team, power, reach }); }
    });
    placed.push({ o, team, x, z, top: box.setFromObject(o).max.y - y, glow: glows.slice(g0).map((_, i) => g0 + i) });
  };

  for (const t of towerSpots()) { const o = await get(towerName(t.team, t.tier), t.team); if (o) add(o, t.team, t.x, terrainHeight(t.x, t.z), t.z, 8, 8); }
  for (const c of coreSpots()) {
    const o = await get(coreName(c.team), c.team); if (!o) continue;
    add(o, c.team, c.x, terrainHeight(c.x, c.z), c.z, 20, 16); circles.push({ x: c.x, z: c.z, r: 5.4, a: 0.35 });
    // 水晶脚下一圈水槽，再有一小段通向出生点的台阶：设计稿里水是从出生点流到水晶的（对方是余烬槽）
    const mats = kitMaterials(tex, c.team), y = L_BASE + 0.03, ring = (r0: number, r1: number, mat: THREE.Material, dy: number) => { const m = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 72), mat); m.rotation.x = -Math.PI / 2; m.position.set(c.x, y + dy, c.z); m.receiveShadow = true; group.add(m); };
    const flat = new THREE.MeshStandardMaterial({ color: c.team === 0 ? 0xc9c9b8 : 0x6a6268, roughness: 0.9 });      // 水槽两边的石沿（B：我方浅灰白、对方暖灰的玄武岩，和建筑的石头一家）
    ring(4.76, 4.86, flat, 0.02); ring(4.86, 5.1, mats.water, 0); ring(5.1, 5.2, flat, 0.02);
    const f = fountainSpots().find(s => s.team === c.team)!, dx = f.x - c.x, dz = f.z - c.z, d = Math.hypot(dx, dz), a0 = 5.1, a1 = d - (DAIS_R + STEP_D * 3) + 0.1;
    if (a1 > a0) { const link = new THREE.Mesh(new THREE.PlaneGeometry(0.34, a1 - a0), mats.water); link.rotation.set(-Math.PI / 2, 0, -Math.atan2(dx, dz)); link.position.set(c.x + (dx / d) * (a0 + a1) / 2, y, c.z + (dz / d) * (a0 + a1) / 2); group.add(link); }
  }
  for (const f of fountainSpots()) { const o = await get(spawnName(f.team), f.team); if (o) add(o, f.team, f.x, L_BASE + DAIS_H, f.z, 6, 9); }
  // 出生点没有 crystal 节点也给一处微光（水池或火盆）
  for (const f of fountainSpots()) if (have.has(spawnName(f.team)) && !glows.some(g => Math.hypot(g.p.x - f.x, g.p.z - f.z) < 6)) glows.push({ p: new THREE.Vector3(f.x, L_BASE + DAIS_H + 0.6, f.z), team: f.team, power: 5, reach: 8 });

  // 晶体外面一圈很小的光晕，和四盏轮流用的点光
  const cv = document.createElement("canvas"); cv.width = cv.height = 128;
  { const g = cv.getContext("2d")!, gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, "rgba(255,255,255,0.9)"); gr.addColorStop(0.3, "rgba(255,255,255,0.28)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); }
  const haloTex = new THREE.CanvasTexture(cv), hue = [new THREE.Color(0x58e6e0), new THREE.Color(0xff7a2e)];
  for (const g of glows) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color: hue[g.team], blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.32 })); s.position.copy(g.p); s.scale.setScalar(g.power > 10 ? 6.5 : 2.6); group.add(s); halos.push(s); }
  const lamps = Array.from({ length: 4 }, () => { const l = new THREE.PointLight(0xffffff, 0, 8, 2); group.add(l); return l; });
  const update = (t: number, x: number, z: number) => {
    kitTime.value = t;
    for (const s of spin) s.o.rotation.y = t * s.k;
    const near = glows.map(g => ({ g, d: Math.hypot(g.p.x - x, g.p.z - z) })).sort((a, b) => a.d - b.d);
    lamps.forEach((l, i) => { const n = near[i]; if (n && n.d < 60) { l.position.copy(n.g.p); l.color.copy(hue[n.g.team]); l.intensity = n.g.power; l.distance = n.g.reach; } else l.intensity = 0; });
  };
  const destroy = (x: number, z: number) => {
    const b = placed.find(q => Math.hypot(q.x - x, q.z - z) < 1.5); if (!b) return null;
    for (const i of b.glow) { glows[i].power = 0; if (halos[i]) halos[i].visible = false; }
    const stone = kitMaterials(tex, b.team).stone;
    for (const c of [...b.o.children]) { const nm = c.name.toLowerCase(); if (nm.startsWith("crystal") || nm.startsWith("ring")) { b.o.remove(c); const k = spin.findIndex(sp => sp.o === c); if (k >= 0) spin.splice(k, 1); } else if ((c as THREE.Mesh).isMesh && (c as THREE.Mesh).material !== stone) c.visible = false; }
    for (let k = spin.length - 1; k >= 0; k--) { let p: THREE.Object3D | null = spin[k].o; while (p && p !== b.o) p = p.parent; if (p === b.o) { spin[k].o.removeFromParent(); spin.splice(k, 1); } }
    b.o.scale.y *= 0.3; b.o.rotation.z = 0.05; b.o.rotation.x = -0.04;
    return b.o;
  };
  const top = (x: number, z: number) => placed.find(q => Math.hypot(q.x - x, q.z - z) < 1.5)?.top ?? 0;
  return { group, update, circles, tris: Math.round(tris), destroy, top };
}
