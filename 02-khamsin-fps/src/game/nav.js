// 导航网格（默认 1m 栅格，bounds.cell 可改）：自动从碰撞体生成可行走高度图 + A* 寻路 + 环境光探测
import * as THREE from 'three';
import { ATMOS } from '../gfx/sky.js';

const DOWN = new THREE.Vector3(0, -1, 0), UPV = new THREE.Vector3(0, 1, 0);
const NDX = [1, -1, 0, 0, 1, 1, -1, -1], NDZ = [0, 0, 1, -1, 1, -1, 1, -1];

export class Nav {
  constructor(world, bounds) {
    this.world = world;
    const cs = this.cs = bounds.cell || 1;   // 格子边长。门洞窄的地图用 0.5：1m 的格子，格心经常落不进 1.2m 宽的门里
    this.rad = bounds.radius || 0.45;        // 格心四周要留出的净距
    this.x0 = Math.floor(bounds.x0) + 1; this.z0 = Math.floor(bounds.z0) + 1;
    this.w = Math.floor((Math.floor(bounds.x1 - bounds.x0) - 2) / cs); this.h = Math.floor((Math.floor(bounds.z1 - bounds.z0) - 2) / cs);
    const n = this.w * this.h;
    this.hgt = new Float32Array(n).fill(-999);
    this.ok = new Uint8Array(n);        // 1 = 步兵可走（主连通区）
    this.mech = new Uint8Array(n);      // 1 = 机甲可走
    this.sky = new Float32Array(n);     // 天空可见度（动态物体的环境光强度）
    this.sun = new Uint8Array(n);       // 是否被太阳直射
    this.comp = new Int32Array(n).fill(-1);
    this._g = new Float32Array(n); this._from = new Int32Array(n); this._stamp = new Uint32Array(n); this._closed = new Uint32Array(n); this._stampId = 1;
    this.list = []; this.mechList = [];
    this.step = bounds.step || 0.55;   // 相邻两格允许的高差（台阶陡的地图要放宽）
    this.layers = bounds.layers || 5;  // 每格从上往下最多看几层表面（屋檐、梁、楼板叠得多的地图要加大）
    this.useClip = !!bounds.clip;      // 把只挡人的隐形墙也算作不可走（导入的地图靠它封边界）
    this.solid = bounds.solid || null;  // 可选：(x, y, z) → 这个点是不是在实心体里面。笔刷搭的地图里上下两块紧贴着叠放，光靠「朝上先碰到背面」判断不准
  }
  // 多空间（两界切换）：切到另一套导航数据。搜索用的时间戳计数留在自己身上，各套数据的标记数组互不干扰
  use(sub) { for (const k of ['world', 'x0', 'z0', 'w', 'h', 'hgt', 'ok', 'mech', 'sky', 'sun', 'comp', '_g', '_from', '_stamp', '_closed', 'list', 'mechList', 'walk', 'step', 'cs', 'rad']) this[k] = sub[k]; return this; }
  idx(x, z) { const ix = Math.floor((x - this.x0) / this.cs), iz = Math.floor((z - this.z0) / this.cs); if (ix < 0 || iz < 0 || ix >= this.w || iz >= this.h) return -1; return iz * this.w + ix; }
  cx(i) { return this.x0 + ((i % this.w) + 0.5) * this.cs; } cz(i) { return this.z0 + (Math.floor(i / this.w) + 0.5) * this.cs; }

  // extraSeeds：额外的连通域种子点（地图被深沟分成几段、彼此不连通时，每段撒一个）
  build(seedX, seedZ, mechSeeds, extraSeeds = []) {
    const W = this.w, H = this.h, bvh = this.world.bvh; const ray = new THREE.Ray(); const o = new THREE.Vector3();
    const FS = THREE.FrontSide, DS = THREE.DoubleSide;
    const side = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)];
    const skyDirs = [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0.6, 0.8, 0), new THREE.Vector3(-0.6, 0.8, 0), new THREE.Vector3(0, 0.8, 0.6), new THREE.Vector3(0, 0.8, -0.6)];
    const walk = new Uint8Array(W * H); const clear = new Float32Array(W * H);
    for (let iz = 0; iz < H; iz++) for (let ix = 0; ix < W; ix++) {
      const i = iz * W + ix; const x = this.x0 + (ix + 0.5) * this.cs, z = this.z0 + (iz + 0.5) * this.cs;
      let y = 45, best = -999, bestClear = 0;
      for (let k = 0; k < this.layers; k++) {
        ray.origin.set(x, y, z); ray.direction.copy(DOWN);
        const h = bvh.raycastFirst(ray, FS, 0, y + 12); if (!h) break;
        const py = h.point.y;
        if (h.face.normal.y > 0.7) {
          // 头顶净空：若先碰到背面 → 在实体内部
          ray.origin.set(x, py + 0.15, z); ray.direction.copy(UPV);
          const u = bvh.raycastFirst(ray, DS, 0, 60);
          const inside = u && u.face.normal.y > 0; const cl = u ? u.distance : 99;
          if (!inside && cl >= 1.85 && !(this.solid && (this.solid(x, py + 0.3, z) || this.solid(x, py + 1.2, z)))) { best = py; bestClear = cl; }
        }
        y = py - 0.05;
      }
      if (best > -900) {
        // 四周半径检查
        let tight = false; o.set(x, best + 0.9, z);
        for (const d of side) { ray.origin.copy(o); ray.direction.copy(d); if (bvh.raycastFirst(ray, FS, 0, this.rad)) { tight = true; break; } }
        this.hgt[i] = best; clear[i] = bestClear;
        const cb = this.useClip ? this.world.clip : null;
        if (cb && !tight) {
          // 隐形墙：离它不到 0.6m（两格中心之间夹着一堵薄墙时，至少有一格会被判掉），或者人在它的体积里面（朝上先碰到背面），都不可走
          for (const d of side) { ray.origin.copy(o); ray.direction.copy(d); if (cb.raycastFirst(ray, DS, 0, Math.max(this.rad, this.cs * 0.6))) { tight = true; break; } }
          if (!tight) { ray.origin.copy(o); ray.direction.copy(UPV); const u = cb.raycastFirst(ray, DS, 0, 60); if (u && u.face.normal.y > 0) tight = true; }
        }
        if (!tight) walk[i] = 1;
        let s = 0; o.set(x, best + 1.2, z);
        for (const d of skyDirs) { ray.origin.copy(o); ray.direction.copy(d); if (!bvh.raycastFirst(ray, DS, 0, 80)) s++; }
        this.sky[i] = s / skyDirs.length;
        ray.origin.copy(o); ray.direction.copy(ATMOS.sunDir); this.sun[i] = bvh.raycastFirst(ray, DS, 0, 200) ? 0 : 1;
      }
    }
    this.walk = walk;
    // 连通域（高度差 ≤ 0.55 才相连）
    const flood = (seed, mask, out) => {
      const st = [seed]; out[seed] = 1; const res = [];
      while (st.length) {
        const c = st.pop(); res.push(c); const cx = c % W, cz = (c / W) | 0;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, nz = cz + dz; if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue; const ni = nz * W + nx;
          if (!mask[ni] || out[ni] || Math.abs(this.hgt[ni] - this.hgt[c]) > this.step) continue; out[ni] = 1; st.push(ni);
        }
      }
      return res;
    };
    const seed = this.nearestIn(seedX, seedZ, walk);
    this.list = seed >= 0 ? flood(seed, walk, this.ok) : [];
    for (const [sx, sz] of extraSeeds) { const s = this.nearestIn(sx, sz, walk, 2); if (s >= 0 && !this.ok[s]) this.list = this.list.concat(flood(s, walk, this.ok)); }
    // 机甲：距离不可走格 ≥ 3m 且净空 ≥ 6.6
    const MR = Math.round(3 / this.cs);
    const dist = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) dist[i] = this.ok[i] ? 255 : 0;
    for (let pass = 0; pass < 2; pass++) {
      for (let iz = 0; iz < H; iz++) for (let ix = 0; ix < W; ix++) { const i = iz * W + ix; if (!dist[i]) continue; let m = dist[i]; if (ix > 0) m = Math.min(m, dist[i - 1] + 1); if (iz > 0) m = Math.min(m, dist[i - W] + 1); dist[i] = m; }
      for (let iz = H - 1; iz >= 0; iz--) for (let ix = W - 1; ix >= 0; ix--) { const i = iz * W + ix; if (!dist[i]) continue; let m = dist[i]; if (ix < W - 1) m = Math.min(m, dist[i + 1] + 1); if (iz < H - 1) m = Math.min(m, dist[i + W] + 1); dist[i] = m; }
    }
    const mmask = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) mmask[i] = dist[i] >= MR && clear[i] >= 6.6 ? 1 : 0;
    this.mechList = [];
    for (const [mx, mz] of mechSeeds) { const s = this.nearestIn(mx, mz, mmask); if (s >= 0 && !this.mech[s]) this.mechList = this.mechList.concat(flood(s, mmask, this.mech)); }
    return this;
  }

  nearestIn(x, z, mask, maxR = 8) {
    const ix = Math.floor((x - this.x0) / this.cs), iz = Math.floor((z - this.z0) / this.cs); maxR = Math.ceil(maxR / this.cs);   // maxR 的单位是米
    for (let r = 0; r <= maxR; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue; const nx = ix + dx, nz = iz + dz; if (nx < 0 || nz < 0 || nx >= this.w || nz >= this.h) continue;
      const i = nz * this.w + nx; if (mask[i]) return i;
    }
    return -1;
  }
  walkable(x, z, mech = false) { const i = this.idx(x, z); return i >= 0 && (mech ? this.mech[i] : this.ok[i]) === 1; }
  height(x, z) { const i = this.idx(x, z); return i >= 0 && this.hgt[i] > -900 ? this.hgt[i] : 0; }
  skyAt(x, z) { const i = this.idx(x, z); return i >= 0 ? this.sky[i] : 1; }
  sunAt(x, z) { const i = this.idx(x, z); return i >= 0 ? this.sun[i] : 1; }
  // 平滑高度（双线性）
  heightSmooth(x, z) {
    const fx = (x - this.x0) / this.cs - 0.5, fz = (z - this.z0) / this.cs - 0.5; const ix = Math.floor(fx), iz = Math.floor(fz); const tx = fx - ix, tz = fz - iz;
    const g = (a, b) => { if (a < 0 || b < 0 || a >= this.w || b >= this.h) return null; const i = b * this.w + a; return this.ok[i] ? this.hgt[i] : null; };
    const c = this.height(x, z); const h00 = g(ix, iz) ?? c, h10 = g(ix + 1, iz) ?? c, h01 = g(ix, iz + 1) ?? c, h11 = g(ix + 1, iz + 1) ?? c;
    const fix = (h) => Math.abs(h - c) > 0.7 ? c : h;
    return (fix(h00) * (1 - tx) + fix(h10) * tx) * (1 - tz) + (fix(h01) * (1 - tx) + fix(h11) * tx) * tz;
  }
  randomPoint(mech = false) { const l = mech ? this.mechList : this.list; const i = l[(Math.random() * l.length) | 0]; return { x: this.cx(i), z: this.cz(i) }; }
  randomNear(x, z, r, mech = false) {
    for (let k = 0; k < 14; k++) { const a = Math.random() * 6.28, d = Math.sqrt(Math.random()) * r; const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d; if (this.walkable(px, pz, mech)) return { x: px, z: pz }; }
    const i = this.nearestIn(x, z, mech ? this.mech : this.ok, 12); return i >= 0 ? { x: this.cx(i), z: this.cz(i) } : null;
  }
  // 栅格直线可走性
  lineClear(ax, az, bx, bz, mech = false) {
    const d = Math.hypot(bx - ax, bz - az); const n = Math.ceil(d / (0.5 * this.cs)); const mask = mech ? this.mech : this.ok; let ph = null;
    for (let i = 0; i <= n; i++) { const t = n ? i / n : 0; const j = this.idx(ax + (bx - ax) * t, az + (bz - az) * t); if (j < 0 || !mask[j]) return false; if (ph !== null && Math.abs(this.hgt[j] - ph) > this.step) return false; ph = this.hgt[j]; }
    return true;
  }

  // 带宽度的直线可走性：中线与左右各偏 r 的两条线都可走。铁驭是真实碰撞体（半径 0.38），只查中线会在墙角被卡住
  lineClearFat(ax, az, bx, bz, r = 0.45) {
    const dx = bx - ax, dz = bz - az, d = Math.hypot(dx, dz); if (d < 1e-3) return this.lineClear(ax, az, bx, bz);
    const ox = -dz / d * r, oz = dx / d * r;
    return this.lineClear(ax, az, bx, bz) && this.lineClear(ax + ox, az + oz, bx + ox, bz + oz) && this.lineClear(ax - ox, az - oz, bx - ox, bz - oz);
  }

  // A*：返回 [{x,z}]（含终点）或 null。fat > 0：拉直路径时按带宽度的直线判断（给有碰撞体积的铁驭用）
  findPath(ax, az, bx, bz, mech = false, fat = 0) {
    const mask = mech ? this.mech : this.ok; const W = this.w, H = this.h;
    let s = this.idx(ax, az), e = this.idx(bx, bz);
    if (s < 0 || !mask[s]) s = this.nearestIn(ax, az, mask, 6); if (e < 0 || !mask[e]) e = this.nearestIn(bx, bz, mask, 10);
    if (s < 0 || e < 0) return null; if (s === e) return [{ x: bx, z: bz }];
    const id = ++this._stampId; const g = this._g, from = this._from, stamp = this._stamp, closed = this._closed;
    const ex = e % W, ez = (e / W) | 0;
    const heap = []; const push = (i, f) => { heap.push([f, i]); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
    const pop = () => { const top = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = c * 2 + 1, r = l + 1; let m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top[1]; };
    g[s] = 0; stamp[s] = id; from[s] = -1; push(s, 0);
    let found = false, iter = 0;
    const maxIter = 26000 / (this.cs * this.cs), look = Math.round(24 / this.cs);
    while (heap.length && iter++ < maxIter) {
      const c = pop(); if (closed[c] === id) continue; closed[c] = id; if (c === e) { found = true; break; }
      const cx = c % W, cz = (c / W) | 0;
      for (let k = 0; k < 8; k++) {
        const dx = NDX[k], dz = NDZ[k];
        const nx = cx + dx, nz = cz + dz; if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue; const ni = nz * W + nx;
        if (!mask[ni] || closed[ni] === id || Math.abs(this.hgt[ni] - this.hgt[c]) > this.step) continue;
        if (k >= 4 && (!mask[cz * W + nx] || !mask[nz * W + cx])) continue;
        const ng = g[c] + (k < 4 ? 1 : 1.414);
        if (stamp[ni] !== id || ng < g[ni]) { g[ni] = ng; stamp[ni] = id; from[ni] = c; const hx = Math.abs(nx - ex), hz = Math.abs(nz - ez); push(ni, ng + Math.max(hx, hz) + 0.414 * Math.min(hx, hz)); }
      }
    }
    if (!found) return null;
    const raw = []; for (let c = e; c !== -1; c = from[c]) raw.push(c); raw.reverse();
    // 拉直
    const pts = raw.map((i) => ({ x: this.cx(i), z: this.cz(i) })); pts[pts.length - 1] = { x: this.walkable(bx, bz, mech) ? bx : pts[pts.length - 1].x, z: this.walkable(bx, bz, mech) ? bz : pts[pts.length - 1].z };
    const out = []; let a = 0; let px = ax, pz = az;
    while (a < pts.length - 1) {
      let b = Math.min(pts.length - 1, a + look);
      while (b > a + 1 && !(fat ? this.lineClearFat(px, pz, pts[b].x, pts[b].z, fat) : this.lineClear(px, pz, pts[b].x, pts[b].z, mech))) b--;
      out.push(pts[b]); px = pts[b].x; pz = pts[b].z; a = b;
    }
    if (!out.length) out.push(pts[pts.length - 1]);
    return out;
  }
}
