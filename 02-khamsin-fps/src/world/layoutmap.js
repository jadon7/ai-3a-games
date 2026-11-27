// 从「俯视布局图」搭地图：tools/layout2map.py 把一张按固定配色画的平面图（比如 AI 生图生成的）转成 JSON，这里把它搭成灰盒。
//   · 地面：每 0.5 m 一格（地面 0 / 高台 +3.2 / 下沉 −3.2），合并成大块
//   · 实心区域：轮廓多边形直接挤出成墙体（斜墙就是斜的，不会变成锯齿），高度按大小和旁边的地面定
//   · 楼梯：按两头的地面高度自动定方向，做成坡道
//   · 掩体：旋转矩形，大的高掩体、小的齐腰
// 图的上方 = 北（−z）= 防守方，下方 = 南 = 进攻方（我方）。
import * as THREE from 'three';
import { M4 } from './kit.js';
import { createBlockout, hash } from './blockout.js';

export const COL = {
  ground: [0.66, 0.64, 0.6], high: [0.62, 0.7, 0.5], low: [0.42, 0.5, 0.6], wall: [0.88, 0.87, 0.84], edge: [0.74, 0.72, 0.68],
  run: [0.42, 0.64, 0.96], cover: [0.96, 0.8, 0.32], cover2: [0.78, 0.66, 0.52], stair: [0.96, 0.82, 0.36],
  siteA: [1.0, 0.66, 0.38], siteB: [0.98, 0.56, 0.72], spawnF: [0.46, 0.8, 0.9], spawnE: [0.94, 0.48, 0.42], dark: [0.2, 0.19, 0.18],
};
export const LEGEND = [
  ['siteA', 'A 点'], ['siteB', 'B 点'], ['ground', '地面'], ['high', '高台（+3.2 m）'], ['low', '下沉区（−3.2 m）'], ['stair', '楼梯 / 坡道'],
  ['wall', '房屋 / 墙体（走不进去）'], ['cover', '齐腰掩体'], ['cover2', '高掩体'], ['spawnF', '我方出生区（进攻）'], ['spawnE', '敌方出生区（防守）'],
];
const LV = [0, 0, 3.2, -3.2];

export async function loadLayout(url) { const r = await fetch(url); if (!r.ok) throw new Error('布局数据载入失败：' + url); return r.json(); }
const unrle = (s, n) => { const a = new Uint8Array(n); let k = 0; for (const t of s.split(',')) { const [v, c] = t.split('x').map(Number); a.fill(v, k, k + c); k += c; } return a; };

export function layoutBounds(D) { return { x0: D.x0, x1: D.x0 + D.w * D.cs, z0: D.z0, z1: D.z0 + D.h * D.cs, cell: 0.5, radius: 0.4, step: 0.5, layers: 8 }; }

export function buildLayoutMap(B, K, D, meta = {}) {
  const O = createBlockout(B, COL); const { cs, w: GW, h: GH } = D; const N = GW * GH;
  const lvl = unrle(D.lvl, N), tag = unrle(D.tag, N), sol = unrle(D.sol, N), outside = D.out ? unrle(D.out, N) : new Uint8Array(N);
  const ix = (x) => Math.floor((x - D.x0) / cs), iz = (z) => Math.floor((z - D.z0) / cs);
  const at = (a, x, z) => { const i = ix(x), j = iz(z); return i < 0 || j < 0 || i >= GW || j >= GH ? 0 : a[j * GW + i]; };
  const L = {
    name: meta.name || '布局图地图', proto: true, colors: COL, legend: LEGEND,
    playerSpawn: { x: 0, y: 0.1, z: 0, yaw: 0 }, friendlyPods: [], enemyPods: [], mechDrops: [], nests: [], combatPoints: [], respawns: [],
    zones: null, ziplines: [], shafts: [], smokes: [], flyover: [], dustVolumes: [], labels: [], stats: {},
  };

  // 楼梯底下的格子统一压到低的那一层（坡道盖在上面）；先算每段楼梯的方向和两头高度
  const ramps = [], stairMask = new Uint8Array(N);
  for (const s of D.stairs) {
    const c = Math.cos(s.ang), sn = Math.sin(s.ang); const ux = [c, -sn], uz = [sn, c];   // 本地 x、z 在世界里的方向（和 obox 一致）
    const lvAt = (u, v) => { const x = s.cx + ux[0] * u + uz[0] * v, z = s.cz + ux[1] * u + uz[1] * v; const k = at(lvl, x, z); return k ? LV[k] : null; };
    const ex = [lvAt(-s.sx / 2 - 0.9, 0), lvAt(s.sx / 2 + 0.9, 0)], ez = [lvAt(0, -s.sz / 2 - 0.9), lvAt(0, s.sz / 2 + 0.9)];
    const dx = ex[0] !== null && ex[1] !== null ? Math.abs(ex[0] - ex[1]) : -1, dz = ez[0] !== null && ez[1] !== null ? Math.abs(ez[0] - ez[1]) : -1;
    if (Math.max(dx, dz) < 0.5) continue;
    const alongX = dx >= dz; const [a, b] = alongX ? ex : ez;
    // 画得太短（太陡）的楼梯往低的那头加长：坡度不超过 0.62（约 32°），人和 AI 都走得上去
    const need = Math.abs(b - a) / 0.62, have = alongX ? s.sx : s.sz;
    if (need > have) { const ext = need - have, sgn = a < b ? -1 : 1, d = (alongX ? ux : uz); s.cx += d[0] * sgn * ext / 2; s.cz += d[1] * sgn * ext / 2; if (alongX) s.sx = need; else s.sz = need; }
    ramps.push({ s, alongX, y0: a, y1: b, ux, uz });
    const lo = Math.min(a, b), loK = lo > 1 ? 2 : lo < -1 ? 3 : 1;   // 注意 LV[0] 和 LV[1] 都是 0：低端是地面时类别要用 1
    for (let u = -s.sx / 2; u <= s.sx / 2; u += cs * 0.5) for (let v = -s.sz / 2; v <= s.sz / 2; v += cs * 0.5) { const x = s.cx + ux[0] * u + uz[0] * v, z = s.cz + ux[1] * u + uz[1] * v; const i = ix(x), j = iz(z); if (i >= 0 && j >= 0 && i < GW && j < GH && lvl[j * GW + i]) { lvl[j * GW + i] = loK; stairMask[j * GW + i] = 1; } }
  }
  // 地面往墙底下多铺两格（矢量墙边和 0.5 m 的格子对不齐，铺进去才不会露缝）
  const fl = lvl.slice();
  for (let pass = 0; pass < 3; pass++) { const src = fl.slice(); for (let j = 1; j < GH - 1; j++) for (let i = 1; i < GW - 1; i++) { const k = j * GW + i; if (src[k]) continue; const n = src[k - 1] || src[k + 1] || src[k - GW] || src[k + GW]; if (n) fl[k] = n; } }
  // 合并成块
  {
    const kindOf = (k) => { const t = tag[k]; if (t === 1) return 'siteA'; if (t === 2) return 'siteB'; if (t === 3) return 'spawnF'; if (t === 4) return 'spawnE'; return ['', 'ground', 'high', 'low'][fl[k]]; };
    const key = new Array(N); for (let k = 0; k < N; k++) key[k] = fl[k] ? kindOf(k) + '|' + fl[k] : null;
    const used = new Uint8Array(N);
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
      const k0 = j * GW + i; if (used[k0] || !key[k0]) continue; const kk = key[k0];
      let i1 = i; while (i1 + 1 < GW && !used[j * GW + i1 + 1] && key[j * GW + i1 + 1] === kk) i1++;
      let j1 = j; for (;;) { const jj = j1 + 1; if (jj >= GH) break; let ok = true; for (let q = i; q <= i1; q++) { const c = jj * GW + q; if (used[c] || key[c] !== kk) { ok = false; break; } } if (!ok) break; j1 = jj; }
      for (let jj = j; jj <= j1; jj++) for (let q = i; q <= i1; q++) used[jj * GW + q] = 1;
      const [kind, lv] = kk.split('|'); B.box('proto', D.x0 + i * cs, -4.6, D.z0 + j * cs, D.x0 + (i1 + 1) * cs, LV[+lv], D.z0 + (j1 + 1) * cs, { c: COL[kind], mech: true });
    }
  }
  // 坡道
  for (const r of ramps) {
    const { s, alongX, y0, y1, ux, uz } = r; const P = (u, v, y) => [s.cx + ux[0] * u + uz[0] * v, y, s.cz + ux[1] * u + uz[1] * v];
    const hu = s.sx / 2, hv = s.sz / 2; const yb = Math.min(y0, y1) - 0.05;
    const top = alongX ? [P(-hu, -hv, y0), P(hu, -hv, y1), P(hu, hv, y1), P(-hu, hv, y0)] : [P(-hu, -hv, y0), P(hu, -hv, y0), P(hu, hv, y1), P(-hu, hv, y1)];
    O.slab('stair', top, yb, { mech: true });
  }
  L.stats.ramps = ramps.length; L.stats.stairs = D.stairs.length;

  // 实心区域 → 墙体：多边形挤出。高度：边上那圈 11 m；里面按面积 4.5–10 m，底下算到旁边最高的地面
  const adjLevel = (poly) => { let m = -9; for (let i = 0; i < poly.length; i++) { const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length]; const len = Math.hypot(bx - ax, bz - az); const n = Math.max(1, Math.ceil(len / 1.5)); for (let t = 0; t <= n; t++) { const x = ax + (bx - ax) * t / n, z = az + (bz - az) * t / n; for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const k = at(lvl, x + ox * 1.2, z + oz * 1.2); if (k) m = Math.max(m, LV[k]); } } } return m < -5 ? 0 : m; };
  let si = 0; const walls = [];
  for (const S of D.solids) {
    si++; const base = adjLevel(S.outer); const hh = hash(si * 3.7);
    const h = S.border ? 8 : S.area > 20 ? 7.5 : 3.6 + hh * 1.2; const top = base + h;   // 沿边一圈先统一高度，里面的楼再一块块往上加（见下面）
    const sh = new THREE.Shape(S.outer.map(([x, z]) => new THREE.Vector2(x, -z)));
    for (const H of S.holes) sh.holes.push(new THREE.Path(H.map(([x, z]) => new THREE.Vector2(x, -z))));
    const g = new THREE.ExtrudeGeometry(sh, { depth: top + 4.6, bevelEnabled: false, curveSegments: 1 }); g.rotateX(-Math.PI / 2); g.translate(0, -4.6, 0);
    const tone = 0.92 + hh * 0.1; const c = (S.border ? COL.edge : COL.wall).map((v) => Math.min(1, v * tone));
    B.addGeo('proto', g, new THREE.Matrix4(), { c, uv: 'world', ts: 4, collide: true, mech: true, rays: 20 });
    walls.push({ S, top, base });
  }
  // 往里缩进 1 m 以后，按 ~12 m 一块分成「楼」，每栋往上加 0–6 m：屋顶高低错落，墙头一圈是退台
  {
    const deep = new Uint8Array(N); for (let j = 2; j < GH - 2; j++) for (let i = 2; i < GW - 2; i++) { let ok = 1; for (let dj = -2; dj <= 2 && ok; dj++) for (let di = -2; di <= 2; di++) if (!sol[(j + dj) * GW + i + di]) { ok = 0; break; } deep[j * GW + i] = ok; }
    const LOT = 24, lots = new Map();   // 格子数（12 m）
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) { if (!deep[j * GW + i]) continue; const key = Math.floor((i + (Math.floor(j / LOT) % 2) * 9) / LOT) + ',' + Math.floor(j / LOT); let l = lots.get(key); if (!l) { l = { i0: 1e9, j0: 1e9, i1: -1, j1: -1, n: 0 }; lots.set(key, l); } l.i0 = Math.min(l.i0, i); l.j0 = Math.min(l.j0, j); l.i1 = Math.max(l.i1, i); l.j1 = Math.max(l.j1, j); l.n++; }
    let li = 0;
    for (const l of lots.values()) {
      li++; let { i0, j0, i1, j1 } = l; const full = () => { for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (!deep[j * GW + i]) return false; return true; };
      for (let it = 0; it < 60 && i1 > i0 && j1 > j0 && !full(); it++) { const cnt = (a, b, c, d) => { let n = 0; for (let j = b; j <= d; j++) for (let i = a; i <= c; i++) if (!deep[j * GW + i]) n++; return n; }; const e = [cnt(i0, j0, i0, j1), cnt(i1, j0, i1, j1), cnt(i0, j0, i1, j0), cnt(i0, j1, i1, j1)]; const m = e.indexOf(Math.max(...e)); if (m === 0) i0++; else if (m === 1) i1--; else if (m === 2) j0++; else j1--; }
      if (i1 - i0 < 5 || j1 - j0 < 5 || !full()) continue;
      const x0 = D.x0 + i0 * cs + 0.25, z0 = D.z0 + j0 * cs + 0.25, x1 = D.x0 + (i1 + 1) * cs - 0.25, z1 = D.z0 + (j1 + 1) * cs - 0.25; const hh = hash(li * 5.3 + 0.7);
      const base = 7.5, add = [0, 2, 3, 4.5, 6][Math.floor(hh * 5)]; if (add <= 0) continue; const tone = 0.9 + hash(li * 2.1) * 0.12;
      B.box('proto', x0, base - 0.2, z0, x1, base + add, z1, { c: COL.wall.map((v) => Math.min(1, v * tone)), mech: true, rays: 20 });
      if ((x1 - x0) * (z1 - z0) > 40 && hash(li * 7.7) < 0.4) B.box('proto', x0 + 0.8, base + add, z0 + 0.8, x0 + 3.4, base + add + 2.4, z0 + 3.4, { c: COL.wall, mech: false, rays: 8 });
    }
  }
  // 两边基本都是墙的下沉通道封顶，做成隧道（楼梯那几格不封，不然顶头）
  {
    const seen = new Uint8Array(N); let tunnels = 0;
    for (let k0 = 0; k0 < N; k0++) {
      if (seen[k0] || lvl[k0] !== 3) continue; const comp = [k0]; seen[k0] = 1; let wallN = 0, floorN = 0;
      for (let q = 0; q < comp.length; q++) { const k = comp[q], i = k % GW, j = (k / GW) | 0; for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= GW || jj >= GH) continue; const kk = jj * GW + ii; if (lvl[kk] === 3) { if (!seen[kk]) { seen[kk] = 1; comp.push(kk); } } else if (sol[kk] || !lvl[kk]) wallN++; else floorN++; } }
      if (wallN < (wallN + floorN) * 0.6) continue; tunnels++;
      const roof = new Uint8Array(N); for (const k of comp) { if (stairMask[k]) continue; const i = k % GW, j = (k / GW) | 0; let nearStair = false; for (let dj = -3; dj <= 3 && !nearStair; dj++) for (let di = -3; di <= 3; di++) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < GW && jj < GH && stairMask[jj * GW + ii]) { nearStair = true; break; } } if (!nearStair) roof[k] = 1; }
      const used = new Uint8Array(N);
      for (const k of comp) { if (!roof[k] || used[k]) continue; const i = k % GW, j = (k / GW) | 0; let i1 = i; while (i1 + 1 < GW && roof[j * GW + i1 + 1] && !used[j * GW + i1 + 1]) i1++; let j1 = j; for (;;) { const jj = j1 + 1; if (jj >= GH) break; let ok = true; for (let q = i; q <= i1; q++) if (!roof[jj * GW + q] || used[jj * GW + q]) { ok = false; break; } if (!ok) break; j1 = jj; } for (let jj = j; jj <= j1; jj++) for (let q = i; q <= i1; q++) used[jj * GW + q] = 1;
        B.box('proto', D.x0 + i * cs, -0.5, D.z0 + j * cs, D.x0 + (i1 + 1) * cs, 7.5, D.z0 + (j1 + 1) * cs, { c: COL.wall, mech: true, bottom: true });
        for (let jj = j; jj <= j1; jj++) for (let q = i; q <= i1; q++) sol[jj * GW + q] = 1; }
      const c = comp[(comp.length / 2) | 0]; B.light(D.x0 + (c % GW) * cs, -1.0, D.z0 + ((c / GW) | 0) * cs, [1.0, 0.86, 0.66], 22, 9);
    }
    L.stats.tunnels = tunnels;
  }
  // 朝向可走区域的墙面开门窗（深色贴片）
  {
    let sd = 1; const rnd = () => hash(sd++ * 1.618 + 0.21);
    for (const { S, top } of walls) for (const poly of [S.outer, ...S.holes]) for (let i = 0; i < poly.length; i++) {
      const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length]; const len = Math.hypot(bx - ax, bz - az); if (len < 3.2) continue;
      const tx = (bx - ax) / len, tz = (bz - az) / len; let nx = tz, nz = -tx;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2; let kOut = at(lvl, mx + nx * 1.0, mz + nz * 1.0); if (!kOut) { nx = -nx; nz = -nz; kOut = at(lvl, mx + nx * 1.0, mz + nz * 1.0); } if (!kOut) continue;
      const y0 = LV[kOut]; if (top - y0 < 3.2) continue; const ang = Math.atan2(-tz, tx);
      for (let u = 1.6; u < len - 1.2; u += 3.4) {
        const x = ax + tx * u + nx * 0.03, z = az + tz * u + nz * 0.03; const door = rnd() < 0.18;
        if (door) B.obox('proto', x, y0 + 1.2, z, 1.3, 2.4, 0.06, [0, ang, 0], { c: COL.dark, collide: false, rays: 0 });
        else if (rnd() < 0.8) B.obox('proto', x, y0 + 2.15, z, 1.0, 1.1, 0.06, [0, ang, 0], { c: COL.dark, collide: false, rays: 0 });
        if (top - y0 > 6.4 && rnd() < 0.7) B.obox('proto', x, y0 + 5.05, z, 1.0, 1.1, 0.06, [0, ang, 0], { c: COL.dark, collide: false, rays: 0 });
      }
    }
  }
  // 掩体
  for (const c of D.covers) {
    const k = at(lvl, c.cx, c.cz); const y = k ? LV[k] : 0; const big = Math.max(c.sx, c.sz) >= 2.4 && Math.min(c.sx, c.sz) >= 1.4; const h = big ? 2.2 : 1.1;
    B.obox('proto', c.cx, y + h / 2, c.cz, Math.max(0.5, c.sx), h, Math.max(0.5, c.sz), [0, c.ang, 0], { c: big ? COL.cover2 : COL.cover, mech: false });
  }

  // ---------- 出生区的影壁：从出生区中心往 24 个方向看出去，出了出生区还能看出 20 m 以上的方向，就在那条视线上（出生区边界往里 3.5 m）立一道墙 ----------
  {
    let n = 0; const shots = [];
    const walkC = (x, z) => { const k = at(lvl, x, z); return k > 0 && !at(sol, x, z); };
    for (const t of [3, 4]) {
      let sx = 0, sz = 0, c = 0; for (let k = 0; k < N; k++) if (tag[k] === t) { sx += k % GW; sz += (k / GW) | 0; c++; } if (!c) continue;
      const cx = D.x0 + (sx / c + 0.5) * cs, cz = D.z0 + (sz / c + 0.5) * cs; const placed = [];
      for (let a = 0; a < 24; a++) {
        const th = a / 24 * Math.PI * 2, dx = Math.cos(th), dz = Math.sin(th);
        let r = 0, exitR = -1, open = 0;
        for (r = 0; r < 90; r += 0.5) { const x = cx + dx * r, z = cz + dz * r; if (!walkC(x, z)) break; if (exitR < 0 && at(tag, x, z) !== t) exitR = r; if (exitR >= 0) open = r - exitR; }
        if (exitR < 0 || open < 20) continue;
        // 出口有多宽：在出口处沿垂直方向往两边量到墙
        const ex = cx + dx * (exitR + 1), ez = cz + dz * (exitR + 1); let wl = 0, wr = 0; while (wl < 12 && walkC(ex - dz * (wl + 0.5), ez + dx * (wl + 0.5))) wl += 0.5; while (wr < 12 && walkC(ex + dz * (wr + 0.5), ez - dx * (wr + 0.5))) wr += 0.5;
        const len = Math.min(14, Math.max(6, wl + wr + 2.5)), off = (wr - wl) / 2;   // 影壁比开口宽一点，并对准开口中心
        const pr = Math.max(2, exitR - 3), px = cx + dx * pr + dz * off, pz = cz + dz * pr - dx * off;
        if (placed.some(([qx, qz]) => Math.hypot(qx - px, qz - pz) < 5)) continue; placed.push([px, pz]);
        B.obox('proto', px, 1.8, pz, len, 3.6, 0.8, [0, Math.atan2(-dz, dx) + Math.PI / 2, 0], { c: COL.wall, mech: true }); n++; shots.push([+px.toFixed(1), +pz.toFixed(1), +open.toFixed(0), +len.toFixed(1)]);
      }
    }
    L.stats.spawnScreens = n; L.stats.screenAt = shots;
  }

  // ---------- 玩法数据 ----------
  const SP = D.spawns || {}; const att = SP.att, def = SP.def;
  if (att) L.playerSpawn = { x: att.x, y: 0.1, z: att.z, yaw: 0 };
  const inBox = (b, f) => { const out = []; if (!b) return out; const [x0, z0, x1, z1] = b.box; for (let x = x0 + 1; x <= x1 - 1; x += 3) for (let z = z0 + 1; z <= z1 - 1; z += 3) if (f(x, z)) out.push([+x.toFixed(2), +z.toFixed(2)]); return out; };
  const walkAt = (x, z) => at(lvl, x, z) > 0 && !at(sol, x, z);
  L.friendlyPods = inBox(att, walkAt).filter((p, i) => i % 2 === 0).slice(0, 10); L.enemyPods = inBox(def, walkAt).filter((p, i) => i % 2 === 0).slice(0, 10);
  L.respawns = inBox(att, walkAt).filter((p, i) => i % 3 === 0).slice(0, 6);
  const S = D.sites || {}; if (S.A && S.B) L.zones = { A: { x: S.A.x, z: S.A.z, r: Math.min(14, S.A.r) }, B: { x: S.B.x, z: S.B.z, r: Math.min(14, S.B.r) } };
  const X0 = D.x0, X1 = D.x0 + GW * cs, lane = (x) => (x < X0 + (X1 - X0) / 3 ? 'W' : x > X1 - (X1 - X0) / 3 ? 'E' : 'M');
  for (let x = X0 + 4; x < X1 - 4; x += 9) for (let z = D.z0 + 4; z < D.z0 + GH * cs - 4; z += 9) { if (!walkAt(x, z)) continue; const t = at(tag, x, z); if (t === 3 || t === 4) continue; L.combatPoints.push([+x.toFixed(1), +z.toFixed(1), lane(x)]); }
  for (const k of ['A', 'B']) if (S[k]) L.combatPoints.push([S[k].x, S[k].z, lane(S[k].x)]);
  // 敌方的狙位：北半边的高台
  { const cand = []; for (let x = X0 + 2; x < X1 - 2; x += 3) for (let z = D.z0 + 2; z < 0; z += 3) if (at(lvl, x, z) === 2 && !at(sol, x, z) && at(tag, x, z) !== 4) cand.push([x, LV[2] + 0.05, z]); for (let i = 0; i < cand.length && L.nests.length < 5; i += Math.max(1, Math.floor(cand.length / 5))) L.nests.push(cand[i]); }
  // 离开战区：站到墙体顶上（格子是实心、而且比旁边地面高出 3 m 以上）就倒数送回
  L.oob = { x0: X0 + 1, x1: X1 - 1, z0: D.z0 + 1, z1: D.z0 + GH * cs - 1, y0: -9, test: (x, y, z) => { if (at(outside, x, z)) return true; if (!at(sol, x, z) || !at(sol, x + 1, z) || !at(sol, x - 1, z) || !at(sol, x, z + 1) || !at(sol, x, z - 1)) return false; return y > 3.4 + 2.5 || (y > 2.5 && at(fl, x, z) !== 2); } };
  L.droneSpawn = def ? { x0: def.box[0], x1: def.box[2], z: def.z } : { x0: -20, x1: 20, z: D.z0 + 8 };
  // 标注：两个点位、两个出生区
  if (S.A) L.labels.push({ text: 'A 点', x: S.A.x, y: 7.5, z: S.A.z, big: true }); if (S.B) L.labels.push({ text: 'B 点', x: S.B.x, y: 7.5, z: S.B.z, big: true });
  if (att) L.labels.push({ text: '我方出生区（进攻）', x: att.x, y: 6, z: att.z, big: true }); if (def) L.labels.push({ text: '敌方出生区（防守）', x: def.x, y: 6, z: def.z, big: true });
  for (const n of D.names || []) { const k = at(lvl, n.x, n.z); L.labels.push({ text: n.text, x: n.x, y: (k ? LV[k] : 0) + 3.4, z: n.z }); }
  for (const lb of meta.labels || []) L.labels.push(lb);
  const ext = Math.max(X1 - X0, GH * cs);
  L.menuCam = { x: 0, y: ext * 0.34, z: 0, rx: ext * 0.7, rz: ext * 0.8, dy: 6, look: [0, 0, 0] };
  L.flyover = [{ from: [ext * 0.55, ext * 0.45, ext * 0.75], to: [ext * 0.2, ext * 0.25, ext * 0.35], look: [0, 0, 0], t: 4.4 }, ...(att ? [{ from: [att.x + 8, 12, att.z + 22], to: [att.x, 4.5, att.z + 8], look: [att.x, 1.6, att.z - 20], t: 3.4 }] : [])];

  // 外面：沙丘和远山（只渲染）
  {
    const hx = (X1 - X0) / 2, hz = (GH * cs) / 2, cx = (X0 + X1) / 2, cz = D.z0 + (GH * cs) / 2;   // 远景从网格边上直接接上，不留缝
    const hgt = (x, z) => { const d = Math.max(Math.abs(x - cx) - hx, Math.abs(z - cz) - hz, 0); return -0.3 + Math.min(1, d / 60) * (6 + 8 * Math.abs(Math.sin(x * 0.021) * Math.cos(z * 0.017))); };
    for (const [x0, z0, x1, z1] of [[-700, -700, 700, cz - hz], [-700, cz + hz, 700, 700], [-700, cz - hz, cx - hx, cz + hz], [cx + hx, cz - hz, 700, cz + hz]]) O.farTerrain(hgt, x0, z0, x1, z1, 16, () => [0.78, 0.68, 0.55]);
    // 镇子外面的沙地：只铺在外墙外侧（不能整块铺，会横穿矿道、坑这些下沉区）
    { const used = new Uint8Array(N); for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) { const k = j * GW + i; if (!outside[k] || used[k]) continue; let i1 = i; while (i1 + 1 < GW && outside[k + i1 + 1 - i] && !used[k + i1 + 1 - i]) i1++; let j1 = j; for (;;) { const jj = j1 + 1; if (jj >= GH) break; let ok = true; for (let q = i; q <= i1; q++) if (!outside[jj * GW + q] || used[jj * GW + q]) { ok = false; break; } if (!ok) break; j1 = jj; } for (let jj = j; jj <= j1; jj++) for (let q = i; q <= i1; q++) used[jj * GW + q] = 1;
      B.box('proto', D.x0 + i * cs, -0.5, D.z0 + j * cs, D.x0 + (i1 + 1) * cs, -0.2, D.z0 + (j1 + 1) * cs, { c: [0.8, 0.7, 0.56], rays: 8 }); } }
    const { rr } = K;
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * 6.28 + rr(-0.15, 0.15), dd = rr(420, 600), x = Math.cos(a) * dd, z = Math.sin(a) * dd, r = rr(50, 110), h = rr(60, 120); let y = 2, rad = r;
      for (let k = 0; k < 3; k++) { const hh = h * [0.42, 0.33, 0.25][k]; let gg = new THREE.CylinderGeometry(rad * rr(0.78, 0.9), rad, hh, 11, 2); gg = gg.toNonIndexed(); gg.computeVertexNormals(); B.addGeo('rock', gg, M4(x, y + hh / 2, z, 0, k * 0.7, 0), { uv: 'world', ts: 40, rays: 0, c: [0.92, 0.8, 0.7] }); y += hh; rad *= rr(0.6, 0.78); }
    }
  }
  return L;
}

// 导航建好之后：空降点、交战点挪到最近的可走格；机甲投放点两边各挑几个
export function finishLayoutMap(L, nav) {
  const fix = (p, r = 6) => { if (nav.walkable(p[0], p[1])) return p; const i = nav.nearestIn(p[0], p[1], nav.ok, r); return i >= 0 ? [nav.cx(i), nav.cz(i), ...p.slice(2)] : null; };
  L.friendlyPods = L.friendlyPods.map((p) => fix(p)).filter(Boolean); L.enemyPods = L.enemyPods.map((p) => fix(p)).filter(Boolean);
  L.respawns = L.respawns.map((p) => fix(p)).filter(Boolean); L.combatPoints = L.combatPoints.map((p) => fix(p)).filter(Boolean);
  if (!L.friendlyPods.length) { const i = nav.nearestIn(L.playerSpawn.x, L.playerSpawn.z, nav.ok, 20); if (i >= 0) L.friendlyPods = [[nav.cx(i), nav.cz(i)]]; }
  if (!L.respawns.length) L.respawns = L.friendlyPods.slice(0, 3);
  { const i = nav.nearestIn(L.playerSpawn.x, L.playerSpawn.z, nav.ok, 20); if (i >= 0) { L.playerSpawn.x = nav.cx(i); L.playerSpawn.z = nav.cz(i); L.playerSpawn.y = nav.hgt[i] + 0.1; } }
  const pick = (test, n) => {
    const cand = []; for (let k = 0; k < nav.mechList.length; k += 3) { const i = nav.mechList[k]; if (nav.sky[i] >= 0.9 && test(nav.cz(i))) cand.push([nav.cx(i), nav.cz(i)]); }
    const out = []; while (out.length < n && cand.length) { let best = null, bd = -1; for (const c of cand) { let d = 1e9; for (const o of out) d = Math.min(d, Math.hypot(o[0] - c[0], o[1] - c[1])); if (!out.length) d = Math.abs(c[1]); if (d > bd) { bd = d; best = c; } } if (!best || (out.length && bd < 14)) break; out.push(best); }
    return out;
  };
  L.mechDrops = [...pick((z) => z > 12, 4), ...pick((z) => z < -12, 4)];
  return L;
}
