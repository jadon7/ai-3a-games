// 开发用：空气墙扫描。在控制台里
//   const P = await import('/tools/airwall_probe.js'); P.scan(6000)
// 从可走区域上方（0.5–10m）往四面八方撒射线，比较「碰撞体先挡住的距离」和「画面上先看到东西的距离」：
// 碰撞体明显更近（差 0.35m 以上）时，再量撞击点离最近的可见表面有多远：
//   超过 0.3m = 那里有看不见却撞得到的东西（bad）；不到 0.3m = 陈设的碰撞盒比外形略大一圈（edge，不算空气墙）。
// 彩旗、布棚、草、树叶本来就不挡人，不在统计里（只查「挡了却看不见」）。返回统计和最严重的若干处位置。
// 另外统计「破洞」：射线最先碰到的是某个实体表面的背面——说明那里缺了一块面，从外面能看进墙体里（holes）。
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

let RB = null;
export function scan(n = 4000, tol = 0.35, seed = 7) {
  const d = window.__dbg, w = d.world, nav = d.nav; const DS = THREE.DoubleSide;
  const THIN = ['fabric', 'fabricStripe', 'leaf', 'grass', 'poster', 'sign', 'emissive', 'rugRed', 'rugBlue', 'glass', 'terrain', 'rock'];   // 双面或单片的东西：背面朝人不算破洞
  if (!RB) { RB = []; d.engine.scene.traverse((m) => { if (m.isMesh && m.name.startsWith('w:') && m.geometry.index) { const b = new MeshBVH(m.geometry, { indirect: true }); b.thin = THIN.includes(m.name.slice(2)); b.mat = m.name.slice(2); RB.push(b); } }); }
  let s = seed >>> 0; const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const ray = new THREE.Ray(); const res = { rays: 0, hitCol: 0, hitClip: 0, bad: 0, edge: 0, badClip: 0, holes: 0, worst: [], holeAt: [] }; const cp = {};
  for (let k = 0; k < n; k++) {
    const i = nav.list[(rnd() * nav.list.length) | 0]; const x = nav.cx(i) + (rnd() - 0.5) * 0.4, z = nav.cz(i) + (rnd() - 0.5) * 0.4, y = nav.hgt[i] + 0.5 + rnd() * rnd() * 9.5;
    if (d.level.solidAt && d.level.solidAt(x, y, z)) continue;
    const a = rnd() * 6.2832, e = (rnd() - 0.35) * 1.6; ray.origin.set(x, y, z); ray.direction.set(Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e));
    const hc = w.bvh.raycastFirst(ray, DS, 0, 60), hk = w.clip ? w.clip.raycastFirst(ray, DS, 0, 60) : null;
    const tc = Math.min(hc ? hc.distance : 1e9, hk ? hk.distance : 1e9); res.rays++; if (tc > 1e8) continue; if (hk && hk.distance <= (hc ? hc.distance : 1e9)) res.hitClip++; else res.hitCol++;
    let tr = 1e9, back = false, bm = ''; for (const b of RB) { const h = b.raycastFirst(ray, DS, 0, tc + 4); if (h && h.distance < tr) { tr = h.distance; back = !b.thin && h.face.normal.dot(ray.direction) > 0.05; bm = b.mat; } }
    if (back && tr < 1e8 && tr > 0.3) { res.holes++; if (res.holeAt.length < 400) { const p = ray.origin.clone().addScaledVector(ray.direction, tr); res.holeAt.push([+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1), bm]); } }
    const gap = tr - tc;
    if (gap > tol) {
      const p = ray.origin.clone().addScaledVector(ray.direction, tc); let dmin = 1e9; for (const b of RB) { const q = b.closestPointToPoint(p, cp, 0, Math.min(dmin, 6)); if (q && q.distance < dmin) dmin = q.distance; }
      const clip = !!(hk && hk.distance <= (hc ? hc.distance : 1e9));
      if (dmin > 0.3) { res.bad++; if (clip) res.badClip++; res.worst.push({ at: [+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1)], off: +Math.min(dmin, 9).toFixed(2), clip }); } else res.edge++;
    }
  }
  res.worst.sort((p, q) => q.off - p.off); res.worst = res.worst.slice(0, 24);
  return res;
}
