#!/usr/bin/env node
// 量建筑模型（换画风 B · b-build）：整体高度和占地、各材质的三角形数、crystal / ring 节点的位置和大小、每一段高度上的最大半径。
// 压缩过的（public/assets/kit/ 里 meshopt 的）和没压缩的都能读。用法: node tools/kit_measure.mjs a.glb [b.glb …]
import fs from "node:fs";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
await MeshoptDecoder.ready;
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
for (const path of process.argv.slice(2)) {
  const buf = fs.readFileSync(path), ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const g = await new Promise((ok, no) => loader.parse(ab, "", ok, no)); const root = g.scene; root.updateMatrixWorld(true);
  const tris = {}, spins = [], P = [], v = new THREE.Vector3(); let total = 0;
  root.traverse(o => {
    const n = (o.name || "").toLowerCase(); if ((n.startsWith("crystal") || n.startsWith("ring")) && !spins.some(s => { let p = o.parent; while (p) { if (p === s.o) return true; p = p.parent; } return false; })) spins.push({ o, name: o.name });
    if (!o.isMesh) return; const pos = o.geometry.getAttribute("position"), mn = (o.material?.name || "?"), c = (o.geometry.index ? o.geometry.index.count : pos.count) / 3; tris[mn] = (tris[mn] || 0) + c; total += c;
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); P.push([v.x, v.y, v.z]); }
  });
  const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9]; for (const p of P) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
  console.log(`== ${path.split("/").pop()}  高 ${hi[1].toFixed(2)}  y0 ${lo[1].toFixed(2)}  x[${lo[0].toFixed(2)}, ${hi[0].toFixed(2)}] z[${lo[2].toFixed(2)}, ${hi[2].toFixed(2)}]  三角形 ${Math.round(total)} ${JSON.stringify(Object.fromEntries(Object.entries(tris).map(([k, x]) => [k, Math.round(x)])))}`);
  const bands = [[-1, 0.25], [0.25, 0.8], [0.8, 2], [2, 4], [4, 6], [6, 8], [8, 10], [10, 14]];
  console.log("   每段最大半径 " + bands.map(([a, b]) => { const r = P.filter(p => p[1] >= a && p[1] < b).map(p => Math.hypot(p[0], p[2])); return r.length ? `${a}-${b}:${Math.max(...r).toFixed(2)}` : ""; }).filter(Boolean).join("  "));
  for (const s of spins) { const bb = new THREE.Box3().setFromObject(s.o), c = bb.getCenter(new THREE.Vector3()), w = s.o.getWorldPosition(new THREE.Vector3()); console.log(`   节点 ${s.name}：原点 (${w.x.toFixed(2)}, ${w.y.toFixed(2)}, ${w.z.toFixed(2)})，包围盒 y ${bb.min.y.toFixed(2)}–${bb.max.y.toFixed(2)}，中心 (${c.x.toFixed(2)}, ${c.y.toFixed(2)}, ${c.z.toFixed(2)})，宽 ${(bb.max.x - bb.min.x).toFixed(2)}×${(bb.max.z - bb.min.z).toFixed(2)}`); }
}
