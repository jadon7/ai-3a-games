// 寻路（阶段 3）：把整张地图切成半米一格，标出哪些格子能走，在格子上找最短路，再把路拉直。
// 能不能走以布局（layout.ts 的 sample）为准，再加上布局里没有、但画面上确实挡着的东西：
// 台阶两侧的护墙和门墩、倒木、树桩、墙头的大石头。英雄有半径，所以障碍都往外胀一圈。

import { GATES, GATE_HW, GATE_LP, GATE_RUN, HALF, sample, toWorld } from "../layout";

export const CELL = 0.5;
const R = HALF + 3, N = Math.round((R * 2) / CELL) + 1;

export interface Solid { circles: { x: number; z: number; r: number }[]; lines: { pts: [number, number][]; w: number }[]; }
export interface Nav {
  walkable: (x: number, z: number) => boolean;
  /** 从 a 走到 b 的路（世界坐标的拐点，不含起点）。b 走不到就走到离它最近的能走的地方 */
  path: (ax: number, az: number, bx: number, bz: number) => [number, number][];
  /** 两点之间能不能直着走过去 */
  clear: (ax: number, az: number, bx: number, bz: number) => boolean;
  nearest: (x: number, z: number) => [number, number];
  blockedCells: number;
}

/** 六个口子上台阶两侧的护墙（线段）和门墩（圆） */
export function gateSolids(): Solid {
  const s: Solid = { circles: [], lines: [] };
  for (const su of [-1, 1]) for (const [g, sv] of [[GATES[0], 1], [GATES[1], 1], [GATES[1], -1]] as const) {
    const L = (a: number, l: number) => toWorld(su * (g.o[0] + g.t[0] * a + g.n[0] * l), sv * (g.o[1] + g.t[1] * a + g.n[1] * l));
    for (const sd of [-1, 1]) {
      s.lines.push({ pts: [L(0.6, sd * (GATE_HW + 0.55)), L(-GATE_RUN - 1.0, sd * (GATE_HW + 0.55))], w: 0.9 });
      const [px, pz] = L(g.sp[sd < 0 ? 0 : 1], sd * GATE_LP); s.circles.push({ x: px, z: pz, r: 1.0 });
    }
  }
  return s;
}

export function createNav(solids: Solid[], radius = 0.5): Nav {
  const at = (i: number, j: number) => j * N + i, toI = (x: number) => Math.round((x + R) / CELL), toX = (i: number) => i * CELL - R;
  const raw = new Uint8Array(N * N);                          // 1 = 被挡住
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (!sample(toX(i), toX(j)).walk) raw[at(i, j)] = 1;
  const stamp = (x: number, z: number, r: number) => { const i0 = toI(x - r), i1 = toI(x + r), j0 = toI(z - r), j1 = toI(z + r);
    for (let j = Math.max(0, j0); j <= Math.min(N - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(N - 1, i1); i++) if (Math.hypot(toX(i) - x, toX(j) - z) <= r) raw[at(i, j)] = 1; };
  for (const s of solids) {
    for (const c of s.circles) stamp(c.x, c.z, c.r);
    for (const l of s.lines) for (let k = 0; k + 1 < l.pts.length; k++) { const [x0, z0] = l.pts[k], [x1, z1] = l.pts[k + 1], n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / (CELL * 0.5))); for (let t = 0; t <= n; t++) stamp(x0 + ((x1 - x0) * t) / n, z0 + ((z1 - z0) * t) / n, l.w / 2); }
  }
  // 往外胀一圈（英雄的半径）
  const blk = new Uint8Array(N * N), k = Math.ceil(radius / CELL);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { if (!raw[at(i, j)]) continue;
    for (let dj = -k; dj <= k; dj++) for (let di = -k; di <= k; di++) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < N && jj < N && Math.hypot(di, dj) * CELL <= radius + 1e-6) blk[at(ii, jj)] = 1; } }
  let blockedCells = 0; for (let n = 0; n < blk.length; n++) blockedCells += blk[n];
  const inb = (i: number, j: number) => i >= 0 && j >= 0 && i < N && j < N;
  const free = (i: number, j: number) => inb(i, j) && !blk[at(i, j)];
  const walkable = (x: number, z: number) => free(toI(x), toI(z));
  const clear = (ax: number, az: number, bx: number, bz: number) => { const d = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(d / (CELL * 0.4)));
    for (let t = 0; t <= n; t++) if (!walkable(ax + ((bx - ax) * t) / n, az + ((bz - az) * t) / n)) return false; return true; };
  const nearestCell = (i: number, j: number): [number, number] => { if (free(i, j)) return [i, j];
    for (let r = 1; r < 60; r++) { let best: [number, number] | null = null, bd = 1e9;
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue; if (free(i + di, j + dj)) { const d = Math.hypot(di, dj); if (d < bd) { bd = d; best = [i + di, j + dj]; } } }
      if (best) return best; }
    return [i, j]; };
  const nearest = (x: number, z: number): [number, number] => { const [i, j] = nearestCell(toI(x), toI(z)); return [toX(i), toX(j)]; };

  // A*：八个方向，不许斜着擦墙角
  const g = new Float32Array(N * N), came = new Int32Array(N * N), stampId = new Uint32Array(N * N); let run = 0;
  const path = (ax: number, az: number, bx: number, bz: number): [number, number][] => {
    const [si, sj] = nearestCell(toI(ax), toI(az)), [ti, tj] = nearestCell(toI(bx), toI(bz));
    const exact = walkable(bx, bz), end: [number, number] = exact ? [bx, bz] : [toX(ti), toX(tj)];
    if (clear(ax, az, end[0], end[1])) return [end];
    run++; const heap: number[] = [], f: number[] = []; const s = at(si, sj), t = at(ti, tj);
    const h = (i: number, j: number) => { const dx = Math.abs(i - ti), dz = Math.abs(j - tj); return Math.max(dx, dz) + 0.4142 * Math.min(dx, dz); };
    const push = (n: number, fv: number) => { heap.push(n); f.push(fv); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (f[p] <= f[c]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; [f[p], f[c]] = [f[c], f[p]]; c = p; } };
    const pop = () => { const top = heap[0], ln = heap.pop()!, lf = f.pop()!; if (heap.length) { heap[0] = ln; f[0] = lf; let c = 0; for (;;) { const l = c * 2 + 1, r = l + 1; let m = c; if (l < heap.length && f[l] < f[m]) m = l; if (r < heap.length && f[r] < f[m]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; [f[m], f[c]] = [f[c], f[m]]; c = m; } } return top; };
    g[s] = 0; came[s] = -1; stampId[s] = run; push(s, h(si, sj)); let found = false, guard = 0;
    while (heap.length && guard++ < 400000) { const n = pop(); if (n === t) { found = true; break; } const i = n % N, j = (n - i) / N;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { if (!di && !dj) continue; const ii = i + di, jj = j + dj; if (!free(ii, jj)) continue;
        if (di && dj && (!free(ii, j) || !free(i, jj))) continue;
        const m = at(ii, jj), ng = g[n] + (di && dj ? 1.4142 : 1); if (stampId[m] === run && ng >= g[m] - 1e-5) continue;
        g[m] = ng; came[m] = n; stampId[m] = run; push(m, ng + h(ii, jj)); } }
    if (!found) return [];
    const cells: [number, number][] = []; for (let n = t; n !== -1; n = came[n]) { const i = n % N, j = (n - i) / N; cells.push([toX(i), toX(j)]); }
    cells.reverse(); cells[0] = [ax, az]; if (exact) cells[cells.length - 1] = [bx, bz];
    // 拉直：从当前点往后找最远的、能直着走到的拐点
    const out: [number, number][] = []; let c = 0;
    while (c < cells.length - 1) { let n = cells.length - 1; while (n > c + 1 && !clear(cells[c][0], cells[c][1], cells[n][0], cells[n][1])) n--; out.push(cells[n]); c = n; }
    return out;
  };
  return { walkable, path, clear, nearest, blockedCells };
}
