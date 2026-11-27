// 关卡：大厅（影片里的厂房）+ 走廊 + 两间小房间，外面一圈院子。
// 这里放关卡的"逻辑层"：分区、门窗、敌人的站位，以及可行走网格和寻路。坐标都是 Blender 约定（Z 向上）的平面 x、y。
import * as THREE from 'three';
import { FLOOR_Z, GROUND_Z } from './config.js';

export const FH = 3.65;          // 层高
// 寻路网格按"半层"分：0 地下室，1 地下室和一楼之间的楼梯平台，2 一楼，3 一楼和二楼之间的楼梯平台，4 二楼。
// 每跑楼梯下半截归下面那层、上半截归上面那层，中间有一两级台阶两层都有，就在那里接上。
export const NL = 5;
export const layerZ = (L) => FLOOR_Z - FH + L * FH / 2;
export const L_OF_FLOOR = [0, 2, 4];      // 楼层（0 地下室 / 1 一楼 / 2 二楼）对应的网格层
export const floorOfZ = (z) => (z < FLOOR_Z - FH / 2 - 0.05 ? 0 : (z < FLOOR_Z + FH / 2 + 0.05 ? 1 : 2));

const INNER = [      // 屋里的门框位（一楼的坐标；二楼、地下室同样的位置各有一套）
  { id: 'C_fromCorr', hide: [22.55, -1.85], peek: [21.75, -1.9], covers: ['C'] },
  { id: 'corr_fromC', hide: [22.6, -3.1], peek: [21.75, -3.2], covers: ['corr'] },
  { id: 'B_fromC', hide: [22.6, -6.1], peek: [21.75, -6.0], covers: ['B'] },
  { id: 'C_fromB', hide: [22.6, -7.25], peek: [21.75, -7.3], covers: ['C'] },
];
const SFX = ['0', '', '2'];
export const LV = {
  meta: null,
  // 建筑占地（含墙）。占地内的格子靠向下打射线找各层的地面；占地外是院子的平地（只有一楼）
  foot: [[16.6, -0.42, 25.8, 5.65], [16.95, -2.62, 31.45, -0.15], [20.6, -11.06, 25.92, -2.3]],
  stair: [25.9, -2.6, 31.45, -0.15],
  regions: { hall: [16.6, 0.0, 25.6, 5.6], corr: [16.95, -2.45, 25.9, -0.3], C: [20.7, -6.66, 25.8, -2.45], B: [20.7, -11.0, 25.8, -6.66] },
  // 池核：地下室走廊北墙开门进去的那片泳池空间（在院子的地面以下；南边一截压在大厅底下）
  pool: [14.0, -0.5, 32.0, 20.5],
  poolSpawns: [[15.25, 19.0], [15.25, 1.6], [29.5, 18.6], [31.0, 7.6], [19.0, 19.6], [24.5, 19.6], [29.3, 14.4]],      // 敌人在池核里冒出来的几个角落（只在玩家看不到时用）
  poolStart: [22.25, 1.3],
  tourPool: [[22.25, 1.5, 0], [22.3, 5.3, 0], [22.5, 7.4, 0], [29.4, 8.4, 0], [29.4, 13.2, 0], [24.75, 16.3, 0], [24.5, 18.9, 0], [21.2, 18.2, 0], [19.0, 16.0, 0], [17.1, 17.75, 0], [15.25, 17.75, 0], [15.25, 10.0, 0],
    [15.25, 3.25, 0], [18.6, 3.25, 0], [19.2, 5.4, 0], [19.5, 7.6, 0], [23.2, 9.4, 0], [23.2, 12.6, 0], [23.2, 9.0, 0], [22.5, 7.4, 0]],
  // 敌人在院子里出现的位置（都在建筑视线之外的远处）
  spawns: [[7.5, 9.5], [6.0, 3.0], [7.0, -4.5], [10.0, -12.0], [17.0, -18.0], [24.0, -19.0], [29.5, -16.0]],
  // 门窗外的掩护位：hide 藏在墙后，peek 探出去能看进屋里；L 是所在楼层
  slots: [
    { id: 'hallW_N', hide: [16.25, 3.86], peek: [16.25, 3.12], covers: ['hall'], kind: 'door', L: 2 },
    { id: 'hallW_S', hide: [16.25, 0.06], peek: [16.25, 0.82], covers: ['hall'], kind: 'door', L: 2 },
    { id: 'corrW_N', hide: [16.3, -0.42], peek: [16.3, -1.02], covers: ['corr'], kind: 'door', L: 2 },
    { id: 'corrW_S', hide: [16.3, -1.98], peek: [16.3, -1.56], covers: ['corr'], kind: 'door', L: 2 },
    { id: 'winC', hide: [20.2, -5.3], peek: [20.2, -4.35], covers: ['C'], kind: 'window', L: 2 },
    { id: 'winB', hide: [20.2, -8.1], peek: [20.2, -9.1], covers: ['B'], kind: 'window', L: 2 },
    { id: 'winBS', hide: [22.75, -11.5], peek: [21.9, -11.5], covers: ['B'], kind: 'window', L: 2 },
    { id: 'hallS_in', hide: [17.3, -1.1], peek: [18.1, -0.95], covers: ['hall'], kind: 'inner', L: 2 },
    { id: 'corr_fromHall', hide: [19.75, 0.75], peek: [18.9, 0.7], covers: ['corr'], kind: 'inner', L: 2 },
    ...[0, 1, 2].flatMap((f) => INNER.map((s) => ({ id: s.id + SFX[f], hide: [...s.hide], peek: [...s.peek], covers: s.covers.map((c) => c + SFX[f]), kind: 'inner', L: L_OF_FLOOR[f] }))),
  ],
  // 蹲守位：f 楼层（0 地下室 / 1 一楼 / 2 二楼），p 站的位置，watch 盯着的门口
  guards: [
    { f: 2, p: [24.6, -5.5], watch: [21.9, -2.9] }, { f: 2, p: [24.5, -9.7], watch: [21.9, -6.9] }, { f: 2, p: [18.1, -1.4], watch: [25.0, -1.4] }, { f: 2, p: [21.4, -5.9], watch: [21.9, -2.9] },
    { f: 0, p: [24.6, -5.5], watch: [21.9, -2.9] }, { f: 0, p: [24.5, -9.7], watch: [21.9, -6.9] }, { f: 0, p: [18.3, -1.4], watch: [25.0, -1.4] }, { f: 0, p: [21.4, -5.9], watch: [21.9, -2.9] },
    { f: 1, p: [24.6, -5.5], watch: [21.9, -2.9] }, { f: 1, p: [24.5, -9.7], watch: [21.9, -6.9] }, { f: 1, p: [23.9, 4.3], watch: [18.6, 0.3] },
    { f: 0, p: [24.6, 18.9], watch: [24.75, 15.3] }, { f: 0, p: [29.5, 13.0], watch: [22.5, 6.3] }, { f: 0, p: [15.25, 12.6], watch: [16.9, 3.2] },      // 池核里的
  ],
  // 自动试玩/巡场用的路线点 [x, y, 网格层]
  tour: [[23.5, 2.6, 2], [19.2, 1.6, 2], [18.5, -0.9, 2], [24.6, -1.4, 2], [26.4, -1.9, 2], [30.4, -1.4, 3], [26.4, -0.9, 4], [21.7, -1.6, 4], [23.6, -4.6, 4], [21.75, -6.4, 4], [23.2, -9.0, 4],
    [21.75, -3.0, 4], [18.5, -1.4, 4], [26.4, -0.9, 4], [30.4, -1.4, 3], [26.4, -0.9, 2], [30.4, -1.4, 1], [26.4, -1.9, 0], [21.7, -1.6, 0], [23.4, -4.6, 0], [22.6, -8.6, 0], [21.75, -3.0, 0], [18.2, -1.4, 0], [22.25, -1.2, 0], [22.25, 1.4, 0], [19.2, 5.3, 0], [22.6, 7.6, 0], [22.25, 1.2, 0], [22.25, -1.2, 0],
    [26.4, -1.9, 0], [30.4, -1.4, 1], [26.4, -1.4, 2], [19.0, -1.35, 2], [22.0, 2.8, 2]],
};

export function inRect(r, x, y) { return x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]; }
const inBld = (x, y) => LV.foot.some((r) => inRect(r, x, y));
export const inFoot = (x, y) => inBld(x, y) || inRect(LV.pool, x, y);
// 所在区域：一楼 hall/corr/C/B，二楼 corr2/C2/B2，地下室 corr0/C0/B0，楼梯间 stair，院子 out
export function regionOf(x, y, z = FLOOR_Z) {
  if (inRect(LV.stair, x, y)) return 'stair';
  const f = floorOfZ(z);
  if (f === 0 && y > -0.42 && inRect(LV.pool, x, y)) return 'pool0';
  for (const k of ['hall', 'corr', 'C', 'B']) if (inRect(LV.regions[k], x, y)) { if (k === 'hall') return f === 1 ? 'hall' : 'out'; return k + SFX[f]; }
  if (!inBld(x, y)) return 'out';
  // 人在楼里、但正好站在门洞里（墙厚的那一小段不属于任何房间）：算离得最近的那个房间，别当成院子
  let best = 'out', bd = 0.6;
  for (const k of ['hall', 'corr', 'C', 'B']) {
    if (k === 'hall' && f !== 1) continue;
    const r = LV.regions[k], d = Math.hypot(Math.max(r[0] - x, 0, x - r[2]), Math.max(r[1] - y, 0, y - r[3]));
    if (d < bd) { bd = d; best = k === 'hall' ? 'hall' : k + SFX[f]; }
  }
  return best;
}
export const floorOfRegion = (r) => (r.endsWith('0') ? 0 : (r.endsWith('2') ? 2 : 1));

export class Nav {
  constructor() { this.s = 0.1; this.x0 = 3.0; this.y0 = -23.0; this.nx = 300; this.ny = 445; }
  ix(x) { return Math.round((x - this.x0) / this.s); }
  iy(y) { return Math.round((y - this.y0) / this.s); }
  inb(i, j) { return i >= 0 && j >= 0 && i < this.nx && j < this.ny; }

  // 多层可行走网格。每层一张 0.1m 的格子图：地面高度 H、是否有墙 blocked、到墙的距离 D、玩家/敌人各自的可走掩码。
  // 楼梯的每一跑整段落在某一层的高度范围里；半层平台同时属于上下两层，两层就在那里接上。
  build(world) {
    const { nx, ny, s, x0, y0 } = this, N = nx * ny;
    const Ls = this.Ls = Array.from({ length: NL }, () => ({ H: new Float32Array(N).fill(NaN), blocked: new Uint8Array(N), indoor: new Uint8Array(N) }));
    const band = (L) => [layerZ(L) - FH / 4 - 0.12, layerZ(L) + FH / 4 + 0.12];
    // 1) 地面：占地内每个格子从上往下打一条穿透的射线，凡是"上方有 1.75m 以上净空、且头顶有顶"的面就是能站的地面，按高度归到各层
    const o = new THREE.Vector3(), d = new THREE.Vector3(0, -1, 0), TOP = FLOOR_Z + 2 * FH + 0.6;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const x = x0 + i * s, y = y0 + j * s, k = j * nx + i;
      const bld = inBld(x, y);
      if (!bld && !inRect(LV.pool, x, y)) { Ls[2].H[k] = GROUND_Z; continue; }
      if (!bld) Ls[2].H[k] = GROUND_Z;        // 池核在院子的地面以下：它头顶的院子照常能走，底下只找地下那两层
      o.set(x, TOP, -y);
      const hits = world.raycastAll(o, d, 3 * FH + 2.4);
      let prev = Infinity;
      for (let h = 0; h < hits.length; h++) {
        const z = hits[h].point.y; if (prev - z < 0.02) continue;
        const clear = prev - z; prev = z;
        if (h === 0 || clear < 1.75) continue;          // 最上面那一下是屋顶的外表面，不算
        for (let L = 0; L < (bld ? NL : 2); L++) { const [b0, b1] = band(L); if (z >= b0 && z < b1 && Number.isNaN(Ls[L].H[k])) { Ls[L].H[k] = z; Ls[L].indoor[k] = 1; } }
      }
    }
    // 2) 墙：腰到头这段高度里出现的陡面（墙、门框、窗台下的墙、柱子、矮墙……），所在格子在那一层不可走
    const pos = world.collider.geometry.attributes.position, idx = world.collider.geometry.index;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    const nt = idx ? idx.count / 3 : pos.count / 3;
    for (let t = 0; t < nt; t++) {
      const ia = idx ? idx.getX(t * 3) : t * 3, ib = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, ic = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      a.fromBufferAttribute(pos, ia); b.fromBufferAttribute(pos, ib); c.fromBufferAttribute(pos, ic);
      e1.subVectors(b, a); e2.subVectors(c, a); n.crossVectors(e1, e2); const len = n.length(); if (len < 1e-10) continue;
      if (Math.abs(n.y) / len > 0.72) continue;                  // 接近水平的面不算墙
      const m = Math.max(1, Math.ceil(Math.max(e1.length(), e2.length(), b.distanceTo(c)) / (s * 0.5)));
      for (let u = 0; u <= m; u++) for (let v = 0; v <= m - u; v++) {
        const fu = u / m, fv = v / m, py = a.y + e1.y * fu + e2.y * fv;
        const i = this.ix(a.x + e1.x * fu + e2.x * fv), j = this.iy(-(a.z + e1.z * fu + e2.z * fv)); if (!this.inb(i, j)) continue;
        const k = j * nx + i;
        for (let L = 0; L < NL; L++) { const h = Ls[L].H[k]; if (py > h + 0.62 && py < h + 1.5) Ls[L].blocked[k] = 1; }
      }
    }
    // 3) 每层：没有地面的格子算墙；到最近障碍的距离（两遍倒角距离变换，单位：格）；可走掩码
    const R2 = Math.SQRT2;
    for (const Ly of Ls) {
      const { H, blocked } = Ly, D = Ly.D = new Float32Array(N).fill(1e3);
      for (let k = 0; k < N; k++) { if (Number.isNaN(H[k])) blocked[k] = 1; if (blocked[k]) D[k] = 0; }
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        const k = j * nx + i; let v = D[k];
        if (i > 0) v = Math.min(v, D[k - 1] + 1); if (j > 0) v = Math.min(v, D[k - nx] + 1);
        if (i > 0 && j > 0) v = Math.min(v, D[k - nx - 1] + R2); if (i < nx - 1 && j > 0) v = Math.min(v, D[k - nx + 1] + R2);
        D[k] = v;
      }
      for (let j = ny - 1; j >= 0; j--) for (let i = nx - 1; i >= 0; i--) {
        const k = j * nx + i; let v = D[k];
        if (i < nx - 1) v = Math.min(v, D[k + 1] + 1); if (j < ny - 1) v = Math.min(v, D[k + nx] + 1);
        if (i < nx - 1 && j < ny - 1) v = Math.min(v, D[k + nx + 1] + R2); if (i > 0 && j < ny - 1) v = Math.min(v, D[k + nx - 1] + R2);
        D[k] = v;
      }
      // 玩家：身体半径 0.2m，只能在屋里走；敌人：半径 0.22m，屋里屋外都能走
      Ly.maskP = new Uint8Array(N); Ly.maskA = new Uint8Array(N);
      for (let k = 0; k < N; k++) { if (blocked[k]) continue; if (Ly.indoor[k] && D[k] >= 2.0) Ly.maskP[k] = 1; if (D[k] >= 2.2) Ly.maskA[k] = 1; }
    }
    return this;
  }

  _k(x, y) { const i = this.ix(x), j = this.iy(y); return this.inb(i, j) ? j * this.nx + i : -1; }
  floor(L, x, y) { const k = this._k(x, y); if (k < 0) return GROUND_Z; const h = this.Ls[L].H[k]; return Number.isNaN(h) ? layerZ(L) : h; }
  // 周围 3x3 格的平均地面高度（走过碎石、上下楼梯时镜头不会一格一跳）
  floorSmooth(L, x, y) {
    const i0 = this.ix(x), j0 = this.iy(y), Ly = this.Ls[L]; let sum = 0, n = 0;
    const h0 = this.floor(L, x, y);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const i = i0 + di, j = j0 + dj; if (!this.inb(i, j)) continue; const k = j * this.nx + i; if (Ly.blocked[k]) continue;
      if (Math.abs(Ly.H[k] - h0) > 0.45) continue;        // 同一层里相邻格也可能差一大截（楼梯平台边上，底下是另一跑楼梯），不能平均进来
      sum += Ly.H[k]; n++;
    }
    return n ? sum / n : h0;
  }
  okP(L, x, y) { const k = this._k(x, y); return k >= 0 && this.Ls[L].maskP[k] === 1; }
  okA(L, x, y) { const k = this._k(x, y); return k >= 0 && this.Ls[L].maskA[k] === 1; }
  wallDist(L, x, y) { const k = this._k(x, y); return k >= 0 ? this.Ls[L].D[k] * this.s : 0; }
  // 脚在高度 z 的人想站到 (x,y)：哪一层在那里有能踩上去的地面（不高出 up、不低于 down）。返回层号，没有返回 -1
  stand(x, y, z, up, down, mask = 'maskP') {
    const k = this._k(x, y); if (k < 0) return -1; let best = -1, bd = 1e9;
    for (let L = 0; L < NL; L++) { if (!this.Ls[L][mask][k]) continue; const dh = this.Ls[L].H[k] - z; if (dh <= up && dh >= -down && Math.abs(dh) < bd) { bd = Math.abs(dh); best = L; } }
    return best;
  }
  // 子弹壳、碎屑落到哪：(x,y) 处、高度 z 以下最近的那层地面
  floorBelow(x, y, z) { const k = this._k(x, y); let h = -1e9; if (k >= 0) for (let L = 0; L < NL; L++) { const v = this.Ls[L].H[k]; if (v <= z + 0.3 && v > h) h = v; } return h > -1e8 ? h : GROUND_Z; }

  // 最近的可走格（给"目标点落在墙里"时用）
  nearest(L, x, y, maxR = 12, key = 'maskA') {
    const M = this.Ls[L][key], i0 = this.ix(x), j0 = this.iy(y);
    if (this.inb(i0, j0) && M[j0 * this.nx + i0]) return [x, y];
    for (let r = 1; r <= maxR; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      const i = i0 + di, j = j0 + dj; if (this.inb(i, j) && M[j * this.nx + i]) return [this.x0 + i * this.s, this.y0 + j * this.s];
    }
    return null;
  }
  // 同一层两点之间在可走格上是否直线可达
  clear(L, ax, ay, bx, by, key = 'maskA') {
    const M = this.Ls[L][key], H = this.Ls[L].H, n = Math.ceil(Math.hypot(bx - ax, by - ay) / (this.s * 0.5)); let ph = NaN;
    for (let t = 0; t <= n; t++) {
      const f = n ? t / n : 0, k = this._k(ax + (bx - ax) * f, ay + (by - ay) * f); if (k < 0 || !M[k]) return false;
      if (!Number.isNaN(ph) && Math.abs(H[k] - ph) > 0.28) return false; ph = H[k];
    }
    return true;
  }
  // 粗网格（0.2m 一格，每格取 2x2 细格里一个可走的做代表点）：A* 在它上面跑，比细网格快一个量级
  _coarse(key) {
    const ck = '_c' + key; if (this[ck]) return this[ck];
    const { nx, ny } = this, cx = nx >> 1, cy = ny >> 1, NC = cx * cy, rep = new Int32Array(NC * NL).fill(-1);
    for (let L = 0; L < NL; L++) { const M = this.Ls[L][key]; for (let J = 0; J < cy; J++) for (let I = 0; I < cx; I++) {
      const i = I * 2, j = J * 2;
      for (const [di, dj] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const k = (j + dj) * nx + i + di; if (M[k]) { rep[L * NC + J * cx + I] = k; break; } }
    } }
    const N = NC * NL;
    return (this[ck] = { cx, cy, NC, rep, g: new Float32Array(N), from: new Int32Array(N), stamp: new Uint32Array(N), closed: new Uint32Array(N), gen: 0, hk: new Float32Array(N * 8), hv: new Int32Array(N * 8) });
  }
  // A*：从 a={x,y,L} 到 b={x,y,L}，返回拉直后的路径点 [[x,y,L],...]，走不通返回 null。avoid=[x,y,L]：这一带堵住了，绕开
  path(a, b, forPlayer = false, avoid = null) {
    const key = forPlayer ? 'maskP' : 'maskA';
    const A = this.nearest(a.L, a.x, a.y, 12, key), B = this.nearest(b.L, b.x, b.y, 12, key); if (!A || !B) return null;
    const C = this._coarse(key), { cx, cy, NC, rep, g, from, stamp, closed, hk, hv } = C, { nx, s } = this;
    const cOf = (L, x, y) => {
      const I = this.ix(x) >> 1, J = this.iy(y) >> 1;
      for (let r = 0; r <= 3; r++) for (let dJ = -r; dJ <= r; dJ++) for (let dI = -r; dI <= r; dI++) { const I2 = I + dI, J2 = J + dJ; if (I2 >= 0 && J2 >= 0 && I2 < cx && J2 < cy && rep[L * NC + J2 * cx + I2] >= 0) return L * NC + J2 * cx + I2; }
      return -1;
    };
    const S = cOf(a.L, A[0], A[1]), T = cOf(b.L, B[0], B[1]); if (S < 0 || T < 0) return null;
    if (S === T) return [[B[0], B[1], b.L]];
    const gen = ++C.gen, tc = T % NC, ti = tc % cx, tj = (tc - ti) / cx, tL = (T - tc) / NC;
    const hfn = (q) => { const c = q % NC, L = (q - c) / NC, i = c % cx, j = (c - i) / cx, dx = Math.abs(i - ti), dy = Math.abs(j - tj); return (Math.max(dx, dy) + 0.4142 * Math.min(dx, dy) + Math.abs(L - tL) * 6) * 1.2; };
    let hn = 0;        // 二叉堆（两个类型化数组，不产生垃圾）
    const push = (kk, v) => { let i = hn++; while (i > 0) { const p = (i - 1) >> 1; if (hk[p] <= kk) break; hk[i] = hk[p]; hv[i] = hv[p]; i = p; } hk[i] = kk; hv[i] = v; };
    const pop = () => { const top = hv[0]; hn--; if (hn > 0) { const kk = hk[hn], v = hv[hn]; let i = 0; for (;;) { let c = i * 2 + 1; if (c >= hn) break; if (c + 1 < hn && hk[c + 1] < hk[c]) c++; if (hk[c] >= kk) break; hk[i] = hk[c]; hv[i] = hv[c]; i = c; } hk[i] = kk; hv[i] = v; } return top; };
    g[S] = 0; stamp[S] = gen; from[S] = -1; push(hfn(S), S);
    const DI = [1, -1, 0, 0, 1, 1, -1, -1], DJ = [0, 0, 1, -1, 1, -1, 1, -1], cap = hk.length - 12;
    let found = false;
    const relax = (q, q2, ng) => { if (stamp[q2] !== gen || ng < g[q2]) { g[q2] = ng; stamp[q2] = gen; from[q2] = q; push(ng + hfn(q2), q2); } };
    while (hn > 0 && hn < cap) {
      const q = pop(); if (closed[q] === gen) continue; closed[q] = gen;
      if (q === T) { found = true; break; }
      const c = q % NC, L = (q - c) / NC, i = c % cx, j = (c - i) / cx, rk = rep[q], H = this.Ls[L].H, D = this.Ls[L].D, base = L * NC;
      for (let n = 0; n < 8; n++) {
        const i2 = i + DI[n], j2 = j + DJ[n]; if (i2 < 0 || j2 < 0 || i2 >= cx || j2 >= cy) continue;
        const q2 = base + j2 * cx + i2, r2 = rep[q2]; if (r2 < 0 || closed[q2] === gen) continue;
        if (n >= 4 && (rep[base + j * cx + i2] < 0 || rep[base + j2 * cx + i] < 0)) continue;      // 不斜着擦墙角
        if (Math.abs(H[r2] - H[rk]) > 0.42) continue;                                           // 粗格相隔 0.2m，楼梯上最多差两级
        const w = n >= 4 ? 1.4142 : 1, dd = D[r2];
        let ng = g[q] + w * (1 + (dd < 6 ? (6 - dd) * 0.22 : 0));                               // 贴墙走的代价高一点，路线自然居中
        if (avoid && avoid[2] === L) { const ddx = (this.x0 + (r2 % nx) * s) - avoid[0], ddy = (this.y0 + Math.floor(r2 / nx) * s) - avoid[1]; if (ddx * ddx + ddy * ddy < 5.0) ng += w * 8; }
        relax(q, q2, ng);
      }
      for (const L2 of [L - 1, L + 1]) {      // 半层平台：同一个位置上下两层的地面一样高，就能换层
        if (L2 < 0 || L2 >= NL) continue; const q2 = L2 * NC + c, r2 = rep[q2];
        if (r2 >= 0 && closed[q2] !== gen && Math.abs(this.Ls[L2].H[r2] - H[rk]) < 0.2) relax(q, q2, g[q] + 0.01);
      }
    }
    if (!found) return null;
    const pts = []; for (let q = T; q !== -1; q = from[q]) { const r = rep[q]; pts.push([this.x0 + (r % nx) * s, this.y0 + Math.floor(r / nx) * s, Math.floor(q / NC)]); }
    pts.reverse();
    // 拉直：同一层里能直线走到的中间点都去掉（先试远的，按折半往回找）
    const out = []; let cur = 0;
    while (cur < pts.length - 1) {
      const L = pts[cur][2]; let far = cur + 1, lim = cur; while (lim + 1 < pts.length && pts[lim + 1][2] === L && lim - cur < 64) lim++;
      let step = lim - cur;
      while (step > 1) { const t = cur + step; if (this.clear(L, pts[cur][0], pts[cur][1], pts[t][0], pts[t][1], key)) { far = t; break; } step = Math.max(1, step >> 1); }
      out.push(pts[far]); cur = far;
    }
    out[out.length - 1] = [B[0], B[1], b.L];
    return out;
  }

  // 调试：把某一层的网格画成图
  debugCanvas(L = 2) {
    const Ly = this.Ls[L], cv = document.createElement('canvas'); cv.width = this.nx * 3; cv.height = this.ny * 3; const g = cv.getContext('2d');
    for (let j = 0; j < this.ny; j++) for (let i = 0; i < this.nx; i++) {
      const k = j * this.nx + i; let col = '#101010';
      if (Ly.blocked[k]) col = Ly.indoor[k] ? '#803030' : (Number.isNaN(Ly.H[k]) ? '#181818' : '#602020');
      else if (Ly.maskP[k]) { const h = Math.max(0, Math.min(1, (Ly.H[k] - layerZ(L) + FH / 4) / (FH / 2))); col = `rgb(${Math.round(40 + 200 * h)},${Math.round(170 - 60 * h)},${90})`; }
      else if (Ly.maskA[k]) col = Ly.indoor[k] ? '#356' : '#2a3a2a';
      else if (Ly.indoor[k]) col = '#553';
      g.fillStyle = col; g.fillRect(i * 3, (this.ny - 1 - j) * 3, 3, 3);
    }
    return cv;
  }
}
