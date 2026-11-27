// 场景构建器：把成千上万个盒体/几何体按材质与区块合并，生成碰撞网格，并烘焙逐顶点全局光照
import * as THREE from 'three';
import { ALBEDO, MATINFO } from '../gfx/materials.js';

export const SURF_NAMES = ['stone', 'sand', 'wood', 'metal', 'cloth', 'glass'];
const SURF = { stone: 0, sand: 1, wood: 2, metal: 3, cloth: 4, glass: 5 };
const lin = (c) => Math.pow(c, 2.2);

const FACES = [
  { k: 'E', n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { k: 'W', n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { k: 'U', n: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0] },
  { k: 'D', n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { k: 'S', n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { k: 'N', n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
];

const _m3 = new THREE.Matrix3(), _m4 = new THREE.Matrix4(), _e = new THREE.Euler();
const _v = new THREE.Vector3(), _n = new THREE.Vector3();

export class Builder {
  constructor(chunk = 40) {
    this.chunk = chunk;
    this.batches = new Map();
    this.cPos = []; this.cIdx = []; this.cCol = []; this.cSurf = [];
    this.kPos = []; this.kIdx = [];
    this.mPos = []; this.mIdx = [];   // 机甲专用碰撞（只含大型结构）
    this.lights = [];
    this.probes = [];      // 小物件共用的光照探针
    this.curProbe = -1;
    this.cell = 2.2;       // 面细分尺寸（决定烘焙光照的分辨率）
  }

  _batch(mat, x, z) {
    const key = mat + '|' + Math.floor(x / this.chunk) + '|' + Math.floor(z / this.chunk);
    let b = this.batches.get(key);
    if (!b) { b = { mat, pos: [], nrm: [], uv: [], col: [], bp: [], ex: [], idx: [], rays: [], pid: [] }; this.batches.set(key, b); }
    return b;
  }

  addProbe(x, y, z) { this.probes.push(x, y, z); return this.probes.length / 3 - 1; }
  // 分组：组内的小物件共用一个光照探针
  group(x, y, z, fn) { const prev = this.curProbe; this.curProbe = this.addProbe(x, y, z); try { fn(); } finally { this.curProbe = prev; } }

  // 轴对齐盒（最小/最大角）
  box(mat, x0, y0, z0, x1, y1, z1, o) {
    if (x1 < x0) [x0, x1] = [x1, x0]; if (y1 < y0) [y0, y1] = [y1, y0]; if (z1 < z0) [z0, z1] = [z1, z0];
    this._box(mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, null, o || {});
  }

  // 有朝向的盒体：中心 + 尺寸 + 旋转 (rx, ry, rz)
  obox(mat, cx, cy, cz, sx, sy, sz, rot, o) {
    let R = null;
    if (rot && (rot[0] || rot[1] || rot[2])) { _e.set(rot[0] || 0, rot[1] || 0, rot[2] || 0, 'YXZ'); _m4.makeRotationFromEuler(_e); R = new THREE.Matrix3().setFromMatrix4(_m4); }
    this._box(mat, cx, cy, cz, sx, sy, sz, R, o || {});
  }

  _box(mat, cx, cy, cz, sx, sy, sz, R, o) {
    const info = MATINFO[mat] || {};
    const ts = o.ts || info.ts || 2;
    const c = o.c || [1, 1, 1];
    const cr = lin(c[0]), cg = lin(c[1]), cb = lin(c[2]);
    const a0 = o.a !== undefined ? o.a : (info.a || 0);
    const hs = [sx / 2, sy / 2, sz / 2];
    const b = this._batch(mat, cx, cz);
    const cell = o.cell || this.cell;
    const skip = o.skip || '';
    const skipBottom = o.bottom === false || (o.bottom === undefined && !R && (cy - hs[1]) <= 0.02);
    const grainLong = (mat === 'wood' || mat === 'woodPaint' || mat === 'corrugated') && o.grain !== false;   // 'shutter' 的横纹保持水平
    const gr = o.grime, tp = o.top;
    let rays = o.rays !== undefined ? o.rays : (Math.max(sx, sy, sz) < 1.3 ? 8 : 20);
    let pid = -1;
    if (rays > 0 && rays <= 12) { pid = this.curProbe >= 0 ? this.curProbe : this.addProbe(cx, cy + hs[1] + 0.08, cz); rays = 0; }
    const e = R ? R.elements : null;
    const tx = (x, y, z) => e ? [cx + e[0] * x + e[3] * y + e[6] * z, cy + e[1] * x + e[4] * y + e[7] * z, cz + e[2] * x + e[5] * y + e[8] * z] : [cx + x, cy + y, cz + z];
    const tn = (x, y, z) => e ? [e[0] * x + e[3] * y + e[6] * z, e[1] * x + e[4] * y + e[7] * z, e[2] * x + e[5] * y + e[8] * z] : [x, y, z];

    for (const f of FACES) {
      if (skip.includes(f.k)) continue;
      if (f.k === 'D' && skipBottom) continue;
      const n = f.n, u = f.u, v = f.v;
      const hn = hs[0] * Math.abs(n[0]) + hs[1] * Math.abs(n[1]) + hs[2] * Math.abs(n[2]);
      const hu = hs[0] * Math.abs(u[0]) + hs[1] * Math.abs(u[1]) + hs[2] * Math.abs(u[2]);
      const hv = hs[0] * Math.abs(v[0]) + hs[1] * Math.abs(v[1]) + hs[2] * Math.abs(v[2]);
      const lu = hu * 2, lv = hv * 2;
      if (lu < 1e-5 || lv < 1e-5) continue;
      const ox = n[0] * hn - u[0] * hu - v[0] * hv, oy = n[1] * hn - u[1] * hu - v[1] * hv, oz = n[2] * hn - u[2] * hu - v[2] * hv;
      const vertical = n[1] === 0;
      // 细分断点
      const nu = Math.min(24, Math.max(1, Math.ceil(lu / cell)));
      const us = []; for (let i = 0; i <= nu; i++) us.push(lu * i / nu);
      let vs = []; const nv = Math.min(24, Math.max(1, Math.ceil(lv / cell)));
      for (let j = 0; j <= nv; j++) vs.push(lv * j / nv);
      if (vertical) {
        if (gr && gr.h < lv - 0.05) vs.push(gr.h);
        if (tp && tp.h < lv - 0.05) vs.push(lv - tp.h);
        vs.sort((p, q) => p - q);
        vs = vs.filter((x, i) => i === 0 || x - vs[i - 1] > 0.02);
      }
      const base = b.pos.length / 3;
      const nn = tn(n[0], n[1], n[2]);
      const swap = grainLong && lu > lv;
      const insU = Math.min(0.14, lu * 0.2), insV = Math.min(0.14, lv * 0.2);
      for (let j = 0; j < vs.length; j++) {
        for (let i = 0; i < us.length; i++) {
          const lx = ox + u[0] * us[i] + v[0] * vs[j], ly = oy + u[1] * us[i] + v[1] * vs[j], lz = oz + u[2] * us[i] + v[2] * vs[j];
          const p = tx(lx, ly, lz);
          b.pos.push(p[0], p[1], p[2]); b.nrm.push(nn[0], nn[1], nn[2]);
          const wx = cx + lx, wy = cy + ly, wz = cz + lz;
          const uu = (wx * u[0] + wy * u[1] + wz * u[2]) / ts, vv = (wx * v[0] + wy * v[1] + wz * v[2]) / ts;
          if (swap) b.uv.push(vv, uu); else b.uv.push(uu, vv);
          let mul = 1, al = a0;
          if (vertical) {
            if (gr) { const t = Math.max(0, 1 - vs[j] / gr.h); mul *= 1 - (1 - gr.m) * t * Math.sqrt(t); if (gr.a !== undefined) al = a0 + (gr.a - a0) * t; }
            if (tp) { const t = Math.max(0, (vs[j] - (lv - tp.h)) / tp.h); mul *= 1 - (1 - tp.m) * t; }
          }
          b.col.push(cr * mul, cg * mul, cb * mul, al);
          const du = i === 0 ? insU : (i === us.length - 1 ? -insU : 0), dv = j === 0 ? insV : (j === vs.length - 1 ? -insV : 0);
          const q = tx(lx + n[0] * 0.07 + u[0] * du + v[0] * dv, ly + n[1] * 0.07 + u[1] * du + v[1] * dv, lz + n[2] * 0.07 + u[2] * du + v[2] * dv);
          b.bp.push(q[0], q[1], q[2]); b.ex.push(0); b.rays.push(rays); b.pid.push(pid);
        }
      }
      const w = us.length;
      for (let j = 0; j < vs.length - 1; j++) for (let i = 0; i < w - 1; i++) {
        const a = base + j * w + i, bb = a + 1, cc = a + w + 1, d = a + w;
        b.idx.push(a, bb, cc, a, cc, d);
      }
    }

    if (o.collide !== false) {
      const al = ALBEDO[mat] || [0.5, 0.5, 0.5];
      this._colBox(this.cPos, this.cIdx, tx, hs);
      if (o.mech === true || (o.mech !== false && sy >= 2.0 && Math.max(sx, sz) >= 0.5)) this._colBox(this.mPos, this.mIdx, tx, hs);
      const surf = SURF[o.surf || info.surf || 'stone'];
      for (let i = 0; i < 8; i++) { this.cCol.push(al[0] * cr, al[1] * cg, al[2] * cb); this.cSurf.push(surf); }
    }
  }

  _colBox(pos, idx, tx, hs) {
    const base = pos.length / 3;
    for (let i = 0; i < 8; i++) {
      const p = tx((i & 1 ? 1 : -1) * hs[0], (i & 2 ? 1 : -1) * hs[1], (i & 4 ? 1 : -1) * hs[2]);
      pos.push(p[0], p[1], p[2]);
    }
    const T = [0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 1, 4, 1, 5, 4, 2, 6, 3, 3, 6, 7, 0, 4, 2, 2, 4, 6, 1, 3, 5, 3, 7, 5];
    for (const t of T) idx.push(base + t);
  }

  // 仅碰撞（不可见）的实心盒：建筑主体等
  colBox(x0, y0, z0, x1, y1, z1, mat = 'plaster', c = null, surfName = null) {
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
    const hs = [Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, Math.abs(z1 - z0) / 2];
    this._colBox(this.cPos, this.cIdx, (x, y, z) => [cx + x, cy + y, cz + z], hs);
    if (hs[1] >= 1.0) this._colBox(this.mPos, this.mIdx, (x, y, z) => [cx + x, cy + y, cz + z], hs);
    const al = ALBEDO[mat] || [0.5, 0.5, 0.5]; const surf = SURF[surfName || (MATINFO[mat] || {}).surf || 'stone'];
    const cr = c ? lin(c[0]) : 1, cg = c ? lin(c[1]) : 1, cb = c ? lin(c[2]) : 1;
    for (let i = 0; i < 8; i++) { this.cCol.push(al[0] * cr, al[1] * cg, al[2] * cb); this.cSurf.push(surf); }
  }

  // 碰撞四边形，自动调整绕序使法线朝向 (nx,ny,nz)
  colQuadN(a, b, c, d, nx, ny, nz, mat = 'paving') {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const dot = (uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz;
    if (dot >= 0) this.colQuad(a, b, c, d, mat); else this.colQuad(a, d, c, b, mat);
  }
  colTriN(a, b, c, nx, ny, nz, mat = 'paving') {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const dot = (uy * vz - uz * vy) * nx + (uz * vx - ux * vz) * ny + (ux * vy - uy * vx) * nz;
    if (dot >= 0) this.colTri(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], mat); else this.colTri(a[0], a[1], a[2], c[0], c[1], c[2], b[0], b[1], b[2], mat);
  }

  // 仅玩家碰撞的隐形墙
  clipBox(x0, y0, z0, x1, y1, z1) {
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
    const hs = [Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, Math.abs(z1 - z0) / 2];
    this._colBox(this.kPos, this.kIdx, (x, y, z) => [cx + x, cy + y, cz + z], hs);
    this._colBox(this.mPos, this.mIdx, (x, y, z) => [cx + x, cy + y, cz + z], hs);
  }

  // 仅碰撞（不可见）的任意三角形：用于楼梯斜坡等
  colTri(ax, ay, az, bx, by, bz, cx, cy, cz, mat = 'paving') {
    const base = this.cPos.length / 3; const al = ALBEDO[mat] || [0.5, 0.5, 0.5]; const surf = SURF[(MATINFO[mat] || {}).surf || 'stone'];
    this.cPos.push(ax, ay, az, bx, by, bz, cx, cy, cz); this.cIdx.push(base, base + 1, base + 2);
    for (let i = 0; i < 3; i++) { this.cCol.push(al[0], al[1], al[2]); this.cSurf.push(surf); }
  }
  colQuad(a, b, c, d, mat) { this.colTri(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], mat); this.colTri(a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2], mat); }

  // 加入任意几何体（已带 position/normal/uv），matrix 为世界变换
  addGeo(mat, geo, matrix, o = {}) {
    const info = MATINFO[mat] || {};
    const pa = geo.attributes.position, na = geo.attributes.normal, ua = geo.attributes.uv;
    const wa = geo.attributes.aWind, ca = geo.attributes.color, la = geo.attributes.aLayer;
    _m3.getNormalMatrix(matrix);
    const c = o.c || [1, 1, 1];
    const cr = lin(c[0]), cg = lin(c[1]), cb = lin(c[2]);
    const a0 = o.a !== undefined ? o.a : (info.a || 0);
    const ts = o.ts || info.ts || 2;
    _v.set(0, 0, 0).applyMatrix4(matrix);
    const b = this._batch(mat, _v.x, _v.z);
    const base = b.pos.length / 3;
    const us = o.uvScale || [1, 1];
    const rays = o.rays !== undefined ? o.rays : 12;
    const hdr = o.hdr || 1;
    let sx_ = 0, sz_ = 0, my_ = -1e9;
    for (let i = 0; i < pa.count; i++) {
      _v.fromBufferAttribute(pa, i).applyMatrix4(matrix);
      _n.fromBufferAttribute(na, i).applyMatrix3(_m3).normalize();
      b.pos.push(_v.x, _v.y, _v.z); b.nrm.push(_n.x, _n.y, _n.z);
      if (o.uv === 'world') {
        const ax = Math.abs(_n.x), ay = Math.abs(_n.y), az = Math.abs(_n.z);
        if (ay >= ax && ay >= az) b.uv.push(_v.z / ts, _v.x / ts);
        else if (ax >= az) b.uv.push(-_v.z * Math.sign(_n.x) / ts, _v.y / ts);
        else b.uv.push(_v.x * Math.sign(_n.z) / ts, _v.y / ts);
      } else b.uv.push(ua ? ua.getX(i) * us[0] + (o.uvOff ? o.uvOff[0] : 0) : 0, ua ? ua.getY(i) * us[1] + (o.uvOff ? o.uvOff[1] : 0) : 0);
      if (ca && ca.itemSize >= 3) b.col.push(cr * hdr * ca.getX(i), cg * hdr * ca.getY(i), cb * hdr * ca.getZ(i), la ? la.getX(i) : a0);
      else { const k = ca ? ca.getX(i) : 1; b.col.push(cr * hdr * k, cg * hdr * k, cb * hdr * k, la ? la.getX(i) : a0); }
      b.bp.push(_v.x + _n.x * 0.08, _v.y + _n.y * 0.08, _v.z + _n.z * 0.08);
      b.ex.push(wa ? wa.getX(i) : 0); b.rays.push(rays > 12 ? rays : 0); b.pid.push(-1);
      sx_ += _v.x; sz_ += _v.z; if (_v.y > my_) my_ = _v.y;
    }
    if (rays > 0 && rays <= 12 && pa.count) {
      const pid = this.curProbe >= 0 ? this.curProbe : this.addProbe(sx_ / pa.count, my_ + 0.08, sz_ / pa.count);
      for (let i = 0; i < pa.count; i++) b.pid[base + i] = pid;
    }
    const ia = geo.index;
    const cnt = ia ? ia.count : pa.count;
    for (let i = 0; i < cnt; i++) b.idx.push(base + (ia ? ia.getX(i) : i));
    if (o.collide) {
      const cb0 = this.cPos.length / 3; const al = ALBEDO[mat] || [0.5, 0.5, 0.5]; const surf = SURF[o.surf || info.surf || 'stone'];
      for (let i = 0; i < pa.count; i++) {
        this.cPos.push(b.pos[(base + i) * 3], b.pos[(base + i) * 3 + 1], b.pos[(base + i) * 3 + 2]);
        this.cCol.push(al[0] * cr, al[1] * cg, al[2] * cb); this.cSurf.push(surf);
      }
      for (let i = 0; i < cnt; i++) this.cIdx.push(cb0 + (ia ? ia.getX(i) : i));
      if (o.mech) {
        const mb0 = this.mPos.length / 3;
        for (let i = 0; i < pa.count; i++) this.mPos.push(b.pos[(base + i) * 3], b.pos[(base + i) * 3 + 1], b.pos[(base + i) * 3 + 2]);
        for (let i = 0; i < cnt; i++) this.mIdx.push(mb0 + (ia ? ia.getX(i) : i));
      }
    }
  }

  // ---------- 导入地形用（world/kmap.js）----------
  // 任意凸多边形 P = [[x,y,z],…]（逆时针，法线 n 朝外）。按 cell 切成网格，逐顶点烘焙光照；贴图坐标按世界轴投影，和盒体接得上。
  //   o.c 颜色，o.a 第二层权重，o.grime / o.top 墙脚 / 墙头做旧（同 box），o.rays ≤ 12 时并入当前光照探针。只管渲染，碰撞用 colPoly
  poly(mat, P, n, o = {}) {
    const info = MATINFO[mat] || {}; const ts = o.ts || info.ts || 2; const c = o.c || [1, 1, 1]; const cr = lin(c[0]), cg = lin(c[1]), cb = lin(c[2]);
    const a0 = o.a !== undefined ? o.a : (info.a || 0); const cell = o.cell || this.cell; const gr = o.grime, tp = o.top;
    const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]); const flat = ay >= ax && ay >= az;
    // 面内正交基 U、V：水平面取世界 Z / X，其余取水平切线 / 朝上
    let U; if (flat) { const d = n[2]; U = [-n[0] * d, -n[1] * d, 1 - n[2] * d]; } else U = [n[2], 0, -n[0]];
    const ul = Math.hypot(U[0], U[1], U[2]) || 1; U = [U[0] / ul, U[1] / ul, U[2] / ul];
    const V = [n[1] * U[2] - n[2] * U[1], n[2] * U[0] - n[0] * U[2], n[0] * U[1] - n[1] * U[0]];
    const m = P.length; const S = new Array(m), T = new Array(m); let s0 = 1e9, s1 = -1e9, t0 = 1e9, t1 = -1e9, cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < m; i++) { const p = P[i]; const s = p[0] * U[0] + p[1] * U[1] + p[2] * U[2], t = p[0] * V[0] + p[1] * V[1] + p[2] * V[2]; S[i] = s; T[i] = t; if (s < s0) s0 = s; if (s > s1) s1 = s; if (t < t0) t0 = t; if (t > t1) t1 = t; cx += p[0]; cy += p[1]; cz += p[2]; }
    cx /= m; cy /= m; cz /= m; const lu = s1 - s0, lv = t1 - t0; if (lu < 1e-4 || lv < 1e-4) return;
    const k0 = P[0][0] * n[0] + P[0][1] * n[1] + P[0][2] * n[2];   // 平面常数：p = U·s + V·t + n·k0
    const nu = Math.min(24, Math.max(1, Math.ceil(lu / cell))), nv = Math.min(24, Math.max(1, Math.ceil(lv / cell)));
    const us = []; for (let i = 0; i <= nu; i++) us.push(s0 + lu * i / nu);
    let vs = []; for (let j = 0; j <= nv; j++) vs.push(t0 + lv * j / nv);
    const vertical = !flat && ay < 0.5;
    if (vertical) { if (gr && gr.h < lv - 0.05) vs.push(t0 + gr.h); if (tp && tp.h < lv - 0.05) vs.push(t1 - tp.h); vs.sort((p, q) => p - q); vs = vs.filter((x, i) => i === 0 || x - vs[i - 1] > 0.02); }
    let rays = o.rays !== undefined ? o.rays : 20, pid = -1;
    if (rays > 0 && rays <= 12) { pid = this.curProbe >= 0 ? this.curProbe : this.addProbe(cx + n[0] * 0.1, cy + n[1] * 0.1 + 0.05, cz + n[2] * 0.1); rays = 0; }
    const b = this._batch(mat, cx, cz); const seen = new Map();
    const vert = (s, t) => {
      const key = Math.round(s * 2048) + '|' + Math.round(t * 2048); let id = seen.get(key); if (id !== undefined) return id;
      const x = U[0] * s + V[0] * t + n[0] * k0, y = U[1] * s + V[1] * t + n[1] * k0, z = U[2] * s + V[2] * t + n[2] * k0;
      id = b.pos.length / 3; seen.set(key, id); b.pos.push(x, y, z); b.nrm.push(n[0], n[1], n[2]);
      if (flat) b.uv.push(z / ts, x / ts); else if (ax >= az) b.uv.push(-z * Math.sign(n[0]) / ts, y / ts); else b.uv.push(x * Math.sign(n[2]) / ts, y / ts);
      let mul = 1, al = a0;
      if (vertical) {
        if (gr) { const q = Math.max(0, 1 - (t - t0) / gr.h); mul *= 1 - (1 - gr.m) * q * Math.sqrt(q); if (gr.a !== undefined) al = a0 + (gr.a - a0) * q; }
        if (tp) { const q = Math.max(0, (t - (t1 - tp.h)) / tp.h); mul *= 1 - (1 - tp.m) * q; }
      }
      if (o.af) al = o.af(x, y, z, al);
      b.col.push(cr * mul, cg * mul, cb * mul, al);
      const dx = cx - x, dy = cy - y, dz = cz - z, dl = Math.hypot(dx, dy, dz), k = dl > 1e-6 ? Math.min(0.14, dl * 0.2) / dl : 0;   // 烘焙采样点：离开表面 7cm，再朝面心收一点，避免贴着墙角采到邻面背后
      b.bp.push(x + n[0] * 0.07 + dx * k, y + n[1] * 0.07 + dy * k, z + n[2] * 0.07 + dz * k); b.ex.push(0); b.rays.push(rays); b.pid.push(pid);
      return id;
    };
    // 沿一条网格线把凸多边形切成两半里靠内的一半（保留 lo ≤ 坐标 ≤ hi）
    const cut = (ps, pt, lo, hi) => {
      for (const [bound, sign] of [[lo, 1], [hi, -1]]) {
        const os = [], ot = []; const k = ps.length;
        for (let i = 0; i < k; i++) {
          const j = (i + 1) % k; const a = (pt === 0 ? ps[i][0] : ps[i][1]) - bound, bq = (pt === 0 ? ps[j][0] : ps[j][1]) - bound; const ia = a * sign >= -1e-7, ib = bq * sign >= -1e-7;
          if (ia) os.push(ps[i]);
          if (ia !== ib) { const f = a / (a - bq); os.push([ps[i][0] + (ps[j][0] - ps[i][0]) * f, ps[i][1] + (ps[j][1] - ps[i][1]) * f]); }
        }
        ps = os; if (ps.length < 3) return ps;
      }
      return ps;
    };
    const base = []; for (let i = 0; i < m; i++) base.push([S[i], T[i]]);
    for (let i = 0; i < us.length - 1; i++) {
      const col = us.length === 2 ? base : cut(base, 0, us[i], us[i + 1]); if (col.length < 3) continue;
      for (let j = 0; j < vs.length - 1; j++) {
        const q = vs.length === 2 ? col : cut(col, 1, vs[j], vs[j + 1]); if (q.length < 3) continue;
        const ids = []; for (const p of q) { const id = vert(p[0], p[1]); if (ids.length === 0 || (ids[ids.length - 1] !== id && ids[0] !== id)) ids.push(id); }
        for (let k = 1; k < ids.length - 1; k++) b.idx.push(ids[0], ids[k], ids[k + 1]);
      }
    }
  }
  // 凸多边形的碰撞面（扇形三角化）。mech = true 时也挡机甲
  colPoly(P, mat = 'plaster', c = null, mech = false, surfName = null) {
    const al = ALBEDO[mat] || [0.5, 0.5, 0.5]; const surf = SURF[surfName || (MATINFO[mat] || {}).surf || 'stone']; const cr = c ? lin(c[0]) : 1, cg = c ? lin(c[1]) : 1, cb = c ? lin(c[2]) : 1;
    const base = this.cPos.length / 3; for (const p of P) { this.cPos.push(p[0], p[1], p[2]); this.cCol.push(al[0] * cr, al[1] * cg, al[2] * cb); this.cSurf.push(surf); }
    for (let k = 1; k < P.length - 1; k++) this.cIdx.push(base, base + k, base + k + 1);
    if (mech) { const mb = this.mPos.length / 3; for (const p of P) this.mPos.push(p[0], p[1], p[2]); for (let k = 1; k < P.length - 1; k++) this.mIdx.push(mb, mb + k, mb + k + 1); }
  }
  // 只挡人的隐形面
  clipPoly(P) { const base = this.kPos.length / 3; for (const p of P) this.kPos.push(p[0], p[1], p[2]); for (let k = 1; k < P.length - 1; k++) this.kIdx.push(base, base + k, base + k + 1); }
  // 位移地形块：size×size 个顶点（行优先的 Float32Array），平滑法线。o.af(x, y, z, ny) 给出每个顶点的第二层权重，o.cf 给出颜色。
  // o.double：背面也画、也挡（岩壁这类立着的单片，绕到背后不能是透明的）
  dispGrid(mat, size, G, nrm, o = {}) {
    const info = MATINFO[mat] || {}; const ts = o.ts || info.ts || 2; const n = size * size; const N = new Float32Array(n * 3);
    const at = (i, j, k) => G[(i * size + j) * 3 + k];
    // 三角形绕序：让面法线和块的整体朝向一致
    const e1 = [at(1, 0, 0) - at(0, 0, 0), at(1, 0, 1) - at(0, 0, 1), at(1, 0, 2) - at(0, 0, 2)], e2 = [at(0, 1, 0) - at(0, 0, 0), at(0, 1, 1) - at(0, 0, 1), at(0, 1, 2) - at(0, 0, 2)];
    const fx = e1[1] * e2[2] - e1[2] * e2[1], fy = e1[2] * e2[0] - e1[0] * e2[2], fz = e1[0] * e2[1] - e1[1] * e2[0]; const flip = fx * nrm[0] + fy * nrm[1] + fz * nrm[2] < 0;
    const tris = [];
    for (let i = 0; i < size - 1; i++) for (let j = 0; j < size - 1; j++) {
      const a = i * size + j, bq = (i + 1) * size + j, cq = (i + 1) * size + j + 1, d = i * size + j + 1;
      const T = (i + j) & 1 ? [a, bq, d, bq, cq, d] : [a, bq, cq, a, cq, d];
      for (let k = 0; k < 6; k += 3) { if (flip) tris.push(T[k], T[k + 2], T[k + 1]); else tris.push(T[k], T[k + 1], T[k + 2]); }
    }
    for (let k = 0; k < tris.length; k += 3) {
      const a = tris[k] * 3, bq = tris[k + 1] * 3, cq = tris[k + 2] * 3;
      const ux = G[bq] - G[a], uy = G[bq + 1] - G[a + 1], uz = G[bq + 2] - G[a + 2], vx = G[cq] - G[a], vy = G[cq + 1] - G[a + 1], vz = G[cq + 2] - G[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const q of [a, bq, cq]) { N[q] += nx; N[q + 1] += ny; N[q + 2] += nz; }
    }
    let mx = 0, mz = 0; for (let i = 0; i < n; i++) { mx += G[i * 3]; mz += G[i * 3 + 2]; }
    const b = this._batch(mat, mx / n, mz / n); const base = b.pos.length / 3; const flatUV = Math.abs(nrm[1]) >= 0.5;
    const al = ALBEDO[mat] || [0.5, 0.5, 0.5]; const surf = SURF[o.surf || info.surf || 'stone']; const cb0 = this.cPos.length / 3;
    for (let i = 0; i < n; i++) {
      const x = G[i * 3], y = G[i * 3 + 1], z = G[i * 3 + 2]; let nx = N[i * 3], ny = N[i * 3 + 1], nz = N[i * 3 + 2]; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      b.pos.push(x, y, z); b.nrm.push(nx, ny, nz);
      if (flatUV) b.uv.push(z / ts, x / ts); else if (Math.abs(nrm[0]) >= Math.abs(nrm[2])) b.uv.push(-z * Math.sign(nrm[0]) / ts, y / ts); else b.uv.push(x * Math.sign(nrm[2]) / ts, y / ts);
      const c = o.cf ? o.cf(x, y, z, ny) : (o.c || [1, 1, 1]); const cr = lin(c[0]), cg = lin(c[1]), cbb = lin(c[2]);
      b.col.push(cr, cg, cbb, o.af ? o.af(x, y, z, ny) : (o.a !== undefined ? o.a : (info.a || 0)));
      b.bp.push(x + nx * 0.1, y + ny * 0.1, z + nz * 0.1); b.ex.push(0); b.rays.push(o.rays !== undefined ? o.rays : 20); b.pid.push(-1);
      this.cPos.push(x, y, z); this.cCol.push(al[0] * cr, al[1] * cg, al[2] * cbb); this.cSurf.push(surf);
    }
    for (let k = 0; k < tris.length; k++) { b.idx.push(base + tris[k]); this.cIdx.push(cb0 + tris[k]); }
    if (o.double) {
      const base2 = b.pos.length / 3, cb2 = this.cPos.length / 3;
      for (let i = 0; i < n; i++) {
        const q = (base + i) * 3, u = (base + i) * 2, c4 = (base + i) * 4; const x = b.pos[q], y = b.pos[q + 1], z = b.pos[q + 2], nx = -b.nrm[q], ny = -b.nrm[q + 1], nz = -b.nrm[q + 2];
        b.pos.push(x, y, z); b.nrm.push(nx, ny, nz); b.uv.push(b.uv[u], b.uv[u + 1]); b.col.push(b.col[c4], b.col[c4 + 1], b.col[c4 + 2], b.col[c4 + 3]);
        b.bp.push(x + nx * 0.1, y + ny * 0.1, z + nz * 0.1); b.ex.push(0); b.rays.push(b.rays[base + i]); b.pid.push(-1);
        const cq = (cb0 + i) * 3; this.cPos.push(x, y, z); this.cCol.push(this.cCol[cq], this.cCol[cq + 1], this.cCol[cq + 2]); this.cSurf.push(surf);
      }
      for (let k = 0; k < tris.length; k += 3) { b.idx.push(base2 + tris[k], base2 + tris[k + 2], base2 + tris[k + 1]); this.cIdx.push(cb2 + tris[k], cb2 + tris[k + 2], cb2 + tris[k + 1]); }
    }
    if (o.mech) { const mb = this.mPos.length / 3; for (let i = 0; i < n * 3; i++) this.mPos.push(G[i]); for (let k = 0; k < tris.length; k++) this.mIdx.push(mb + tris[k]); }
  }

  // 烘焙用点光源（灯笼等），不产生实时光照开销
  light(x, y, z, color, intensity, radius) { this.lights.push({ x, y, z, r: color[0] * intensity, g: color[1] * intensity, b: color[2] * intensity, radius }); }

  // 生成碰撞几何
  collisionGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.cPos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.cCol, 3));
    g.setAttribute('surf', new THREE.Uint8BufferAttribute(this.cSurf, 1));
    g.setIndex(this.cIdx);
    return g;
  }
  clipGeometry() {
    if (!this.kPos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.kPos, 3));
    g.setIndex(this.kIdx);
    return g;
  }

  mechGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.mPos, 3));
    g.setIndex(this.mIdx);
    return g;
  }

  vertexCount() { let n = 0; for (const b of this.batches.values()) n += b.pos.length / 3; return n; }

  // 布局签名（用于缓存烘焙结果）
  signature() {
    let h = 2166136261 >>> 0, n = 0;
    for (const b of this.batches.values()) { const p = b.pos; n += p.length; for (let i = 0; i < p.length; i += 37) { h ^= Math.round(p[i] * 64) | 0; h = Math.imul(h, 16777619) >>> 0; } }
    for (const l of this.lights) { h ^= Math.round((l.x + l.y * 3 + l.z * 7 + l.r) * 16) | 0; h = Math.imul(h, 16777619) >>> 0; }
    return 'gi5:' + n + ':' + this.probes.length + ':' + h.toString(16);   // 改了反照率表 / 烘焙算法就把版本号加一，让旧缓存失效
  }
  exportGI() { let n = 0; for (const b of this.batches.values()) n += b.gi.length; const out = new Float32Array(n); let o = 0; for (const b of this.batches.values()) { out.set(b.gi, o); o += b.gi.length; } return out; }
  importGI(arr) { let n = 0; for (const b of this.batches.values()) n += (b.pos.length / 3) * 4; if (!arr || arr.length !== n) return false; let o = 0; for (const b of this.batches.values()) { const len = (b.pos.length / 3) * 4; b.gi = arr.slice(o, o + len); o += len; } return true; }

  // 烘焙：天空可见度 + 一次反弹的太阳光/天光 + 静态点光源（大表面逐顶点，小物件用探针）
  // rayScale：每个顶点的采样射线数乘这个系数（手机上取 0.6，首次烘焙快一些，略糙）
  async bake(bvh, { sunDir, sunE, skyE, strength = 1.0, onProgress = null, sliceMs = 24, rayScale = 1 }) {
    const colAttr = bvh.geometry.attributes.color, idxAttr = bvh.geometry.index;
    const ray = new THREE.Ray(), ray2 = new THREE.Ray();
    const DS = THREE.DoubleSide;
    const n = new THREE.Vector3(), t = new THREE.Vector3(), bt = new THREE.Vector3(), d = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), xa = new THREE.Vector3(1, 0, 0);
    const dirCache = new Map();
    const dirs = (K) => {
      let a = dirCache.get(K);
      if (!a) { a = []; for (let k = 0; k < K; k++) { const u1 = (k + 0.5) / K, u2 = (k * 0.6180339887) % 1; const r = Math.sqrt(u1), ph = u2 * Math.PI * 2; a.push(r * Math.cos(ph), r * Math.sin(ph), Math.sqrt(1 - u1)); } dirCache.set(K, a); }
      return a;
    };
    const out = [0, 0, 0, 0];
    // 从 (ox,oy,oz) 沿法线 n 的半球收集：out = [r,g,b,sky]
    const gather = (ox, oy, oz, K) => {
      t.crossVectors(n, Math.abs(n.y) < 0.9 ? up : xa).normalize(); bt.crossVectors(n, t);
      const D = dirs(K);
      let sky = 0, upc = 0, invalid = 0, lr = 0, lg = 0, lb = 0;
      ray.origin.set(ox, oy, oz);
      for (let k = 0; k < K; k++) {
        const lx = D[k * 3], ly = D[k * 3 + 1], lz = D[k * 3 + 2];
        d.set(t.x * lx + bt.x * ly + n.x * lz, t.y * lx + bt.y * ly + n.y * lz, t.z * lx + bt.z * ly + n.z * lz);
        ray.direction.copy(d);
        if (d.y > 0) upc++;
        const hit = bvh.raycastFirst(ray, DS, 0, 90);
        if (!hit) { if (d.y > 0) sky++; else { lr += 0.20; lg += 0.15; lb += 0.09; } continue; }
        const hn = hit.face.normal;
        if (hn.dot(d) > 0) { invalid++; if (d.y > 0) upc--; continue; }
        const vi = idxAttr.getX(hit.faceIndex * 3);
        const ar = colAttr.getX(vi), ag = colAttr.getY(vi), ab = colAttr.getZ(vi);
        const ndl = hn.dot(sunDir);
        let er = skyE[0] * 0.45, eg = skyE[1] * 0.45, eb = skyE[2] * 0.45;
        if (ndl > 0.02) {
          ray2.origin.copy(hit.point).addScaledVector(hn, 0.04); ray2.direction.copy(sunDir);
          if (!bvh.raycastFirst(ray2, DS, 0, 250)) { er += sunE[0] * ndl; eg += sunE[1] * ndl; eb += sunE[2] * ndl; }
        }
        const fall = 1 / (1 + hit.distance * 0.015);
        lr += ar * er * fall / Math.PI; lg += ag * eg * fall / Math.PI; lb += ab * eb * fall / Math.PI;
      }
      const valid = K - invalid;
      if (valid < K * 0.35) { out[0] = 0.3; out[1] = 0.24; out[2] = 0.18; out[3] = 0.35; return; }
      const k2 = Math.PI * strength / valid;
      out[0] = lr * k2; out[1] = lg * k2; out[2] = lb * k2;
      out[3] = upc > 0 ? sky / upc : (n.y < -0.5 ? 0 : 1);
    };
    const lights = this.lights;
    let total = this.probes.length / 3; for (const b of this.batches.values()) total += b.pos.length / 3;
    let done = 0, last = performance.now();
    const tick = async () => { if (performance.now() - last > sliceMs) { if (onProgress) onProgress(done / total); await new Promise((res) => setTimeout(res, 0)); last = performance.now(); } };
    // 1) 探针
    const np = this.probes.length / 3; const pres = new Float32Array(np * 4);
    for (let i = 0; i < np; i++) {
      n.set(0, 1, 0); gather(this.probes[i * 3], this.probes[i * 3 + 1], this.probes[i * 3 + 2], 20);
      pres[i * 4] = out[0]; pres[i * 4 + 1] = out[1]; pres[i * 4 + 2] = out[2]; pres[i * 4 + 3] = out[3];
      done++; if ((i & 127) === 0) await tick();
    }
    // 2) 顶点
    for (const b of this.batches.values()) {
      const cnt = b.pos.length / 3;
      const gi = new Float32Array(cnt * 4);
      const isEmissive = b.mat === 'emissive';
      for (let i = 0; i < cnt; i++) {
        done++;
        if (isEmissive) { gi[i * 4 + 3] = 1; continue; }
        const K = rayScale === 1 || b.rays[i] <= 0 ? b.rays[i] : Math.max(6, Math.round(b.rays[i] * rayScale)), pid = b.pid[i];
        const nx = b.nrm[i * 3], ny = b.nrm[i * 3 + 1], nz = b.nrm[i * 3 + 2];
        let r, g, bl, s, shadowTest = false;
        const ox = b.bp[i * 3], oy = b.bp[i * 3 + 1], oz = b.bp[i * 3 + 2];
        if (pid >= 0) {
          const k1 = 0.62 + 0.38 * ny, k2 = 0.8 + 0.2 * ny;
          r = pres[pid * 4] * k2; g = pres[pid * 4 + 1] * k2; bl = pres[pid * 4 + 2] * k2; s = pres[pid * 4 + 3] * k1;
        } else if (K <= 0) { r = 0.42; g = 0.34; bl = 0.25; s = 0.8 * (0.62 + 0.38 * ny); }
        else {
          n.set(nx, ny, nz); gather(ox, oy, oz, K);
          r = out[0]; g = out[1]; bl = out[2]; s = out[3]; shadowTest = true;
        }
        for (let li = 0; li < lights.length; li++) {
          const L = lights[li];
          const dx = L.x - ox, dy = L.y - oy, dz = L.z - oz; const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > L.radius * L.radius) continue;
          const dist = Math.sqrt(d2); let nl = (dx * nx + dy * ny + dz * nz) / dist;
          if (!shadowTest) nl = nl * 0.6 + 0.4;
          if (nl <= 0) continue;
          if (shadowTest) { ray2.origin.set(ox, oy, oz); ray2.direction.set(dx / dist, dy / dist, dz / dist); if (bvh.raycastFirst(ray2, DS, 0, dist - 0.15)) continue; }
          const w = 1 - dist / L.radius; const att = nl * w * w / (d2 * 0.25 + 1);
          r += L.r * att; g += L.g * att; bl += L.b * att;
        }
        gi[i * 4] = r; gi[i * 4 + 1] = g; gi[i * 4 + 2] = bl; gi[i * 4 + 3] = s;
        if ((i & 255) === 0) await tick();
      }
      b.gi = gi;
    }
    if (onProgress) onProgress(1);
  }

  // 生成渲染网格
  build(materials, opts = {}) {
    const group = new THREE.Group(); group.name = 'world';
    let tris = 0;
    for (const b of this.batches.values()) {
      const mat = materials[b.mat];
      if (!mat) { console.warn('缺少材质', b.mat); continue; }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 4));
      const cnt = b.pos.length / 3;
      let gi = b.gi;
      if (!gi) { gi = new Float32Array(cnt * 4); for (let i = 0; i < cnt; i++) { gi[i * 4] = 0.3; gi[i * 4 + 1] = 0.25; gi[i * 4 + 2] = 0.2; gi[i * 4 + 3] = 1; } }
      g.setAttribute('aGI', new THREE.BufferAttribute(gi, 4));
      if (mat.defines && mat.defines.USE_WIND !== undefined) g.setAttribute('aWind', new THREE.Float32BufferAttribute(b.ex, 1));
      g.setIndex(b.idx);
      g.computeBoundingSphere(); g.computeBoundingBox();
      const mesh = new THREE.Mesh(g, mat);
      mesh.matrixAutoUpdate = false;
      const noShadow = b.mat === 'poster' || b.mat === 'sign' || b.mat === 'emissive' || b.mat === 'grass';
      mesh.castShadow = !noShadow; mesh.receiveShadow = b.mat !== 'emissive';
      if (b.mat === 'leaf' && materials.leafDepth) mesh.customDepthMaterial = materials.leafDepth;
      if (b.mat === 'poster' || b.mat === 'sign') mesh.renderOrder = 2;
      mesh.name = 'w:' + b.mat;
      group.add(mesh);
      tris += b.idx.length / 3;
    }
    this.tris = tris;
    return group;
  }
}
