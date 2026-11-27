// 灰盒（blockout）工具：斜向的墙和房子、不规则多边形体块、位移地形、拱券、岩石、任意朝向的楼梯。
// 灰盒地图都用 'proto' 材质（1 m / 4 m 网格），颜色按功能区分。
// 约定：帧 F = frame(x, z, a) 是一个绕 y 轴转了 a 的局部坐标系，本地 +z 指向世界 (sin a, cos a)，本地 +x 指向 (cos a, −sin a)，和 Builder.obox 的 ry 一致。
import * as THREE from 'three';
import { M4 } from './kit.js';

export const clamp01 = (t) => Math.min(1, Math.max(0, t));
export const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;
export const frame = (x, z, a = 0) => ({ x, z, a, c: Math.cos(a), s: Math.sin(a) });
export const fw = (F, lx, lz) => [F.x + lx * F.c + lz * F.s, F.z - lx * F.s + lz * F.c];
// 帧里沿本地方向 (dx, dz) 的子帧，原点放在本地点 (lx, lz)
export const sub = (F, lx, lz, dx, dz) => { const [x, z] = fw(F, lx, lz); return frame(x, z, F.a + Math.atan2(dx, dz)); };
// 让本地 +z 指向世界方向 (dx, dz) 的角度
export const angTo = (dx, dz) => Math.atan2(dx, dz);

// ---------- 二维几何 ----------
// 折线：点到折线的距离、最近点所在的累计长度 t、该段的单位切向
export function polyline(pts) {
  const segs = []; let acc = 0;
  for (let i = 0; i < pts.length - 1; i++) { const [ax, az] = pts[i], [bx, bz] = pts[i + 1]; const L = Math.hypot(bx - ax, bz - az); segs.push({ ax, az, dx: (bx - ax) / L, dz: (bz - az) / L, L, t0: acc }); acc += L; }
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  return { pts, segs, len: acc, box: [x0, z0, x1, z1] };
}
export function nearest(pl, x, z, out = {}) {
  let bd = 1e18, bs = null, bu = 0;
  for (const s of pl.segs) { let u = (x - s.ax) * s.dx + (z - s.az) * s.dz; u = u < 0 ? 0 : u > s.L ? s.L : u; const px = s.ax + s.dx * u, pz = s.az + s.dz * u; const d = (x - px) * (x - px) + (z - pz) * (z - pz); if (d < bd) { bd = d; bs = s; bu = u; } }
  out.d = Math.sqrt(bd); out.t = bs.t0 + bu; out.px = bs.ax + bs.dx * bu; out.pz = bs.az + bs.dz * bu; out.tx = bs.dx; out.tz = bs.dz;
  out.side = Math.sign(bs.dx * (z - out.pz) - bs.dz * (x - out.px)) || 1;   // 切向朝前时，点在左手边（+z 一侧对东西向的线）为正
  return out;
}
// 沿折线取点：累计长度 t 处的坐标和切向
export function along(pl, t) {
  t = Math.max(0, Math.min(pl.len, t)); let s = pl.segs[pl.segs.length - 1]; for (const q of pl.segs) if (t <= q.t0 + q.L) { s = q; break; }
  const u = t - s.t0; return { x: s.ax + s.dx * u, z: s.az + s.dz * u, tx: s.dx, tz: s.dz };
}
export function inPoly(P, x, z) { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, zi] = P[i], [xj, zj] = P[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; }
// 点到多边形边界的有符号距离（外正内负）
export function polySD(P, x, z) {
  let bd = 1e18; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [ax, az] = P[j], [bx, bz] = P[i]; const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz; let u = ((x - ax) * dx + (z - az) * dz) / L2; u = u < 0 ? 0 : u > 1 ? 1 : u; const px = ax + dx * u - x, pz = az + dz * u - z; bd = Math.min(bd, px * px + pz * pz); }
  return inPoly(P, x, z) ? -Math.sqrt(bd) : Math.sqrt(bd);
}
export const area2 = (P) => { let a = 0; for (let i = 0, j = P.length - 1; i < P.length; j = i++) a += P[j][0] * P[i][1] - P[i][0] * P[j][1]; return a / 2; };
export const centroid = (P) => { let x = 0, z = 0; for (const p of P) { x += p[0]; z += p[1]; } return [x / P.length, z / P.length]; };
// 凸多边形按半平面裁剪：保留 nx·x + nz·z ≤ d 的部分
export function clipHalf(P, nx, nz, d) {
  const out = []; for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length]; const da = a[0] * nx + a[1] * nz - d, db = b[0] * nx + b[1] * nz - d;
    if (da <= 0) out.push(a); if ((da < 0) !== (db < 0) && Math.abs(da - db) > 1e-9) { const f = da / (da - db); out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]); }
  }
  return out;
}
// 凸多边形向外 / 向内偏移 r（按顶点沿角平分线挪，够灰盒用）
export function offsetPoly(P, r) {
  const [cx, cz] = centroid(P); return P.map(([x, z]) => { const dx = x - cx, dz = z - cz, l = Math.hypot(dx, dz) || 1; return [x + dx / l * r, z + dz / l * r]; });
}
// 两个凸多边形是否相交（分离轴）
export function polyHit(A, B, gap = 0) {
  for (const P of [A, B]) for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length]; const nx = b[1] - a[1], nz = a[0] - b[0], l = Math.hypot(nx, nz) || 1;
    let a0 = 1e18, a1 = -1e18, b0 = 1e18, b1 = -1e18; for (const p of A) { const v = (p[0] * nx + p[1] * nz) / l; a0 = Math.min(a0, v); a1 = Math.max(a1, v); } for (const p of B) { const v = (p[0] * nx + p[1] * nz) / l; b0 = Math.min(b0, v); b1 = Math.max(b1, v); }
    if (a1 + gap <= b0 || b1 + gap <= a0) return false;
  }
  return true;
}
// 由种子生成的伪随机（可重复）
export function hash(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }

// ---------- 灰盒积木 ----------
export function createBlockout(B, COL) {
  const O = { B, COL };
  const col = (k) => (Array.isArray(k) ? k : COL[k]);
  // 帧里的盒子（本地对角两点 + 世界高度）
  O.box = (kind, F, lx0, y0, lz0, lx1, y1, lz1, o = {}) => {
    const [wx, wz] = fw(F, (lx0 + lx1) / 2, (lz0 + lz1) / 2);
    B.obox('proto', wx, (y0 + y1) / 2, wz, Math.abs(lx1 - lx0), Math.abs(y1 - y0), Math.abs(lz1 - lz0), [0, F.a, 0], { c: col(kind), ...o });
  };
  // 世界坐标的轴对齐盒（帧为单位帧时），只是 B.box 的简写
  O.abox = (kind, x0, y0, z0, x1, y1, z1, o = {}) => B.box('proto', x0, y0, z0, x1, y1, z1, { c: col(kind), ...o });
  // 一段墙：帧里从 A 到 B 的中线，厚 t，高 y0..y1。holes = [[沿墙距离, 宽, 下沿(相对 y0), 上沿(相对 y0)], …]
  O.wall = (kind, F, ax, az, bx, bz, y0, y1, t, holes = [], o = {}) => {
    const L = Math.hypot(bx - ax, bz - az); if (L < 0.05) return; const G = sub(F, ax, az, bx - ax, bz - az); const h = y1 - y0, ht = t / 2;
    let at = 0; for (const [c, w, o0, o1] of [...holes].sort((p, q) => p[0] - q[0])) {
      const a = Math.max(at, c - w / 2), b = Math.min(L, c + w / 2); if (a > at + 0.02) O.box(kind, G, -ht, y0, at, ht, y1, a, o);
      if (o0 > 0.02) O.box(kind, G, -ht, y0, a, ht, y0 + o0, b, o); if (o1 < h - 0.02) O.box(kind, G, -ht, y0 + o1, a, ht, y1, b, { ...o, bottom: true }); at = b;
    }
    if (L > at + 0.02) O.box(kind, G, -ht, y0, at, ht, y1, L, o);
  };
  // 沿折线（世界坐标）的连续墙 / 堤岸，每段略加长一点把转角接上
  O.wallPath = (kind, pts, y0, y1, t, o = {}) => {
    const F = frame(0, 0, 0); const ext = o.ext !== undefined ? o.ext : t * 0.5;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1]; const L = Math.hypot(bx - ax, bz - az); if (L < 0.05) continue; const G = sub(F, ax, az, bx - ax, bz - az);
      const yy0 = typeof y0 === 'function' ? y0((ax + bx) / 2, (az + bz) / 2) : y0, yy1 = typeof y1 === 'function' ? y1((ax + bx) / 2, (az + bz) / 2) : y1;
      O.box(kind, G, -t / 2, yy0, i ? -ext : 0, t / 2, yy1, i < pts.length - 2 ? L + ext : L, o);
    }
  };
  // 一个面（凸多边形，世界坐标三维点），自动调整绕序让法线朝 n；collide 时同时做碰撞
  O.face = (kind, P3, n, o = {}) => {
    let nx = 0, ny = 0, nz = 0; for (let i = 0; i < P3.length; i++) { const a = P3[i], b = P3[(i + 1) % P3.length]; nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]); }
    const P = nx * n[0] + ny * n[1] + nz * n[2] < 0 ? [...P3].reverse() : P3;
    if (o.render !== false) B.poly('proto', P, n, { c: col(kind), rays: o.rays, grime: o.grime, top: o.top });
    if (o.collide !== false) B.colPoly(P, 'proto', col(kind), !!o.mech);
  };
  // 竖直棱柱：凸多边形底面 P = [[x,z],…]（世界坐标），从 y0 到 y1。o.bottom 画底面；o.mech 挡机甲；o.sides=false 只要顶面
  O.prism = (kind, P, y0, y1, o = {}) => {
    if (P.length < 3 || y1 - y0 < 0.01) return; const [cx, cz] = centroid(P); const k = o.topKind || kind;
    O.face(k, P.map(([x, z]) => [x, y1, z]), [0, 1, 0], o);
    if (o.bottom) O.face(kind, P.map(([x, z]) => [x, y0, z]), [0, -1, 0], o);
    if (o.sides !== false) for (let i = 0; i < P.length; i++) {
      const [ax, az] = P[i], [bx, bz] = P[(i + 1) % P.length]; let nx = bz - az, nz = ax - bx; const l = Math.hypot(nx, nz); if (l < 0.02) continue; nx /= l; nz /= l;
      if ((ax + bx) / 2 * nx + (az + bz) / 2 * nz < cx * nx + cz * nz) { nx = -nx; nz = -nz; }
      O.face(o.sideKind || kind, [[ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az]], [nx, 0, nz], { ...o, grime: o.grime || { h: 0.6, m: 0.82 } });
    }
  };
  // 斜面楔块：凸多边形顶面（三维点），侧面竖直落到 yb。用于斜坡、塌下来的桥面
  O.slab = (kind, top, yb, o = {}) => {
    const n = (() => { const [a, b, c] = top; const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]; let x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx; const l = Math.hypot(x, y, z); if (y < 0) { x = -x; y = -y; z = -z; } return [x / l, y / l, z / l]; })();
    O.face(kind, top, n, o); const cx = top.reduce((s, p) => s + p[0], 0) / top.length, cz = top.reduce((s, p) => s + p[2], 0) / top.length;
    for (let i = 0; i < top.length; i++) {
      const a = top[i], b = top[(i + 1) % top.length]; let nx = b[2] - a[2], nz = a[0] - b[0]; const l = Math.hypot(nx, nz); if (l < 0.02) continue; nx /= l; nz /= l;
      if ((a[0] + b[0]) / 2 * nx + (a[2] + b[2]) / 2 * nz < cx * nx + cz * nz) { nx = -nx; nz = -nz; }
      if (a[1] - yb < 0.02 && b[1] - yb < 0.02) continue;
      const q = [[a[0], yb, a[2]], [b[0], yb, b[2]]]; if (b[1] > yb + 0.01) q.push([b[0], b[1], b[2]]); if (a[1] > yb + 0.01) q.push([a[0], a[1], a[2]]);
      if (q.length >= 3) O.face(o.sideKind || kind, q, [nx, 0, nz], o);
    }
  };
  // 楼梯：帧里从本地 (lx, lz) 出发沿本地 +z 上升 rise，水平长 run，宽 w。踏步只是外观，人走在一条斜的碰撞面上（和 Kit.stairs 一样）
  //   o.solid = false：悬空的梯段（每级是单独的踏板，下面是空的），侧面和背面不做碰撞
  O.stairs = (kind, F, lx, lz, y0, rise, run, w, o = {}) => {
    const steps = Math.max(2, Math.round(rise / 0.2)); const sh = rise / steps, sd = run / steps; const hw = w / 2; const solid = o.solid !== false;
    for (let i = 0; i < steps; i++) {
      if (solid) O.box(kind, F, lx - hw, y0 + (i ? sh * i : (o.yb !== undefined ? o.yb - y0 : 0)), lz + sd * i, lx + hw, y0 + sh * (i + 1), lz + run, { collide: false, rays: 10, bottom: false });
      else O.box(kind, F, lx - hw, y0 + sh * i, lz + sd * i, lx + hw, y0 + sh * (i + 1), lz + sd * (i + 1), { collide: false, rays: 8, bottom: true });
    }
    const P = (u, v, y) => { const [x, z] = fw(F, lx + u, lz + v); return [x, y, z]; };
    const A0 = P(-hw, 0, y0), A1 = P(hw, 0, y0), B0 = P(-hw, run, y0 + rise), B1 = P(hw, run, y0 + rise), C0 = P(-hw, run, y0), C1 = P(hw, run, y0);
    const [fx, fz] = [F.s, F.c], [rx, rz] = [F.c, -F.s];   // 本地 +z、+x 在世界里的方向
    B.colQuadN(A0, A1, B1, B0, -fx * 0.5, 1, -fz * 0.5, 'proto');
    if (solid) { B.colTriN(A0, C0, B0, -rx, 0, -rz, 'proto'); B.colTriN(A1, B1, C1, rx, 0, rz, 'proto'); B.colQuadN(C0, C1, B1, B0, fx, 0, fz, 'proto'); }
  };
  // 拱券墙：在帧的本地 x–y 平面里画一个二维轮廓（[[u, y], …]，可以是凹的），沿本地 z 挤出厚度 depth（居中）
  O.extrude = (kind, F, contour, depth, o = {}) => {
    const sh = new THREE.Shape(); sh.moveTo(contour[0][0], contour[0][1]); for (let i = 1; i < contour.length; i++) sh.lineTo(contour[i][0], contour[i][1]); sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false, curveSegments: 1 }); g.translate(0, 0, -depth / 2);
    // ExtrudeGeometry 在本地 x–y 里画、沿本地 z 挤出：本地 x 要对上帧的本地 x
    B.addGeo('proto', g, M4(F.x, 0, F.z, 0, F.a, 0), { c: col(kind), uv: 'world', ts: 4, collide: o.collide !== false, mech: o.mech !== false, rays: o.rays !== undefined ? o.rays : 20 });
  };
  // 半圆弧上的点（u 从 c−r 到 c+r，弧顶在 y0 + r）
  O.arc = (c, r, y0, a0 = Math.PI, a1 = 0, n = 14) => { const out = []; for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; out.push([c + Math.cos(a) * r, y0 + Math.sin(a) * r]); } return out; };
  // 岩石：抖动过的二十面体，平面着色
  O.rock = (x, y, z, sx, sy, sz, ry = 0, seed = 1, o = {}) => {
    const g = new THREE.IcosahedronGeometry(1, o.detail !== undefined ? o.detail : 1); const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i); const k = 1 + (o.jit || 0.24) * (hash(Math.round(vx * 97) * 0.37 + Math.round(vy * 97) * 1.91 + Math.round(vz * 97) * 3.13 + seed * 17.3) - 0.5) * 2; p.setXYZ(i, vx * k, vy < -0.5 ? -0.75 : vy * k, vz * k); }
    g.computeVertexNormals();
    B.addGeo('proto', g, M4(x, y, z, 0, ry, 0, sx, sy, sz), { c: col(o.kind || 'rock'), uv: 'world', ts: 4, collide: o.collide !== false, mech: o.mech !== false, rays: 20 });
  };
  // 位移地形：h(x, z) 在 [x0, x1] × [z0, z1] 上按 cs 取样，切成 n×n 的块。cf(x, y, z, ny) → 颜色；o.mech 挡机甲；o.skip(x0, z0, x1, z1) 返回 true 的块跳过
  O.terrain = (h, x0, z0, x1, z1, cs, n, cf, o = {}) => {
    for (let bz = z0; bz < z1 - 1e-6; bz += cs * n) for (let bx = x0; bx < x1 - 1e-6; bx += cs * n) {
      if (o.skip && o.skip(bx, bz, bx + cs * n, bz + cs * n)) continue;
      const size = n + 1, G = new Float32Array(size * size * 3);
      for (let i = 0; i < size; i++) for (let j = 0; j < size; j++) { const x = bx + j * cs, z = bz + i * cs, k = (i * size + j) * 3; G[k] = x; G[k + 1] = h(x, z); G[k + 2] = z; }
      B.dispGrid('proto', size, G, [0, 1, 0], { cf, mech: o.mech !== false, rays: o.rays, a: 0 });
    }
  };
  // 只渲染的远景地形（大格子，不做碰撞）
  O.farTerrain = (h, x0, z0, x1, z1, cs, cf) => {
    const w = x1 - x0, d = z1 - z0, g = new THREE.PlaneGeometry(w, d, Math.max(1, Math.round(w / cs)), Math.max(1, Math.round(d / cs))); g.rotateX(-Math.PI / 2); g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const p = g.attributes.position; const c = new Float32Array(p.count * 3);
    // addGeo 里顶点色按线性值用：sRGB 先换成线性
    for (let i = 0; i < p.count; i++) { const y = h(p.getX(i), p.getZ(i)); p.setY(i, y); const cc = cf(p.getX(i), y, p.getZ(i), 1); c[i * 3] = Math.pow(cc[0], 2.2); c[i * 3 + 1] = Math.pow(cc[1], 2.2); c[i * 3 + 2] = Math.pow(cc[2], 2.2); }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.computeVertexNormals();
    B.addGeo('proto', g, new THREE.Matrix4(), { uv: 'world', ts: 4, rays: 0, c: [1, 1, 1] });
  };
  return O;
}
