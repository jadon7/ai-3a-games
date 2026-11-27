// 第三张地图「风歇驿堡」：一座由多进院落、回廊和塔楼组成的沙漠驿站堡垒（消耗战）。
//   地形（墙、楼板、台阶、起伏的地面）来自导入的灰盒，见 assets/maps/yard.kmap 和 tools/vmf2map.py；
//   灰盒只有体块，没有任何材质和陈设——这里按本作的做法给它上材质、做旧、摆陈设、布光：
//     buildYard   每个面按朝向 / 尺寸 / 所处位置分派材质：灰泥墙（露砖）、砂岩、石板铺地、屋面、木梁、铁件、沙土地形；
//                 墙脚返潮、墙头雨痕、成片的色差；地面按位置积沙；被灰盒标成「不渲染」但实际露在外面的面补画出来
//     dressYard   拿到导航网格之后摆陈设：货箱、油桶、陶罐、麻袋、沙堆、沙袋掩体、棕榈、草丛、遮阳棚、彩旗、屋顶杂物；
//                 灰盒里的灯位换成灯笼（烘进光照），室内再补一些；室内登记成浮尘体（丁达尔光柱）
//     finishYard  从可走区域里算出两队空降点、重生点、交战点、机甲投放点、狙击位、菜单与开场镜头
import * as THREE from 'three';
import { M4, PLASTER, CLOTH } from './kit.js';

// 导航：0.5m 的格子、四周净距 0.34m（灰盒的门洞只有 1.2m 宽）；相邻格允许 0.45m 高差（台阶 0.2m 一级、坡度约 34°）；
// 每格最多看 14 层表面（屋檐、梁、楼板叠得多）
export const YARD_BOUNDS = { x0: -70, x1: 66, z0: -72, z1: 68, cell: 0.5, radius: 0.34, step: 0.45, layers: 14 };
// 灰盒原本靠三百多块隐形墙（屋顶上方的「盖子」、四周的挡板）把人圈在里面——本作的铁驭会二段跳、蹬墙、钩爪，到处撞上看不见的东西。
// 现在的做法：隐形墙只留楼梯上的平滑坡（贴着台阶、不挡人）；通往堡外的三处出口砌成关着的城门（看得见的建筑）；
// 屋顶随便上，翻出堡外或掉下去的，几秒后送回战区（见 game.js 的 checkOOB）。
//   城门：[展开方向, 门面所在坐标, 起, 止, 地面高, 顶高, 朝堡内的方向]
const GATES = [
  ['z', -49.0, -36.0, -27.0, 0.0, 5.35, 1],     // 西门：堵在券洞口，顶到券洞的天花
  ['z', -47.75, 41.9, 47.6, 3.1, 7.9, 1],       // 西南门：巷口两根壁柱之间
  ['x', -54.2, 40.3, 47.2, 3.2, 6.75, 1],       // 东北门：断墙之间（原来那对半开的门板留在门后）
];
// 战区范围：出了这个框（或者掉到 y0 以下）就算离开战区
export const YARD_OOB = { x0: -52.5, x1: 63.5, z0: -58, z1: 57.5, y0: -7.5 };
export const YARD_NAME = '风歇驿堡';
const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
const vnoise = (x, z) => { const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz; const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz); return (hash(ix, iz) * (1 - u) + hash(ix + 1, iz) * u) * (1 - v) + (hash(ix, iz + 1) * (1 - u) + hash(ix + 1, iz + 1) * u) * v; };
const clamp01 = (v) => Math.min(1, Math.max(0, v));

function faceNormal(P) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]); }
  const l = Math.hypot(nx, ny, nz) || 1; return [nx / l, ny / l, nz / l, l / 2];   // 第四项是面积
}

export function buildYard(B, K, km) {
  const { rr } = K;
  // ---------- 1) 按笔刷归组 ----------
  const brushes = new Map();
  for (const f of km.faces) {
    f.n = faceNormal(f.P);
    let b = brushes.get(f.brush); if (!b) { b = { faces: [], lo: [1e9, 1e9, 1e9], hi: [-1e9, -1e9, -1e9], clip: f.kind === 2 }; brushes.set(f.brush, b); }
    b.faces.push(f); for (const p of f.P) for (let k = 0; k < 3; k++) { if (p[k] < b.lo[k]) b.lo[k] = p[k]; if (p[k] > b.hi[k]) b.hi[k] = p[k]; }
  }
  const solid = [], clips = []; for (const b of brushes.values()) (b.clip ? clips : solid).push(b);
  // 每 2m 一格的高度表：gmap 记这一格里朝上大面的最低高度（当作「地面」），tmap 记所有朝上大面的高度（判断头顶有没有东西）
  const GC = 2, gmap = new Map(), tmap = new Map(); const gkey = (x, z) => Math.floor(x / GC) + '|' + Math.floor(z / GC);
  const gput = (x, z, y) => { const k = gkey(x, z); const v = gmap.get(k); if (v === undefined || y < v) gmap.set(k, y); let a = tmap.get(k); if (!a) tmap.set(k, a = []); a.push(y); };
  for (const d of km.disps) if (d.nrm[1] > 0.6) for (let i = 0; i < d.G.length; i += 3) gput(d.G[i], d.G[i + 2], d.G[i + 1]);
  for (const b of solid) for (const f of b.faces) if (f.n[1] > 0.7 && f.n[3] > 5) { for (let x = b.lo[0] + 0.5; x < b.hi[0]; x += GC) for (let z = b.lo[2] + 0.5; z < b.hi[2]; z += GC) gput(x, z, f.P[0][1]); }
  const groundAt = (x, z) => { let best = 1e9; for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const v = gmap.get(gkey(x + dx * GC, z + dz * GC)); if (v !== undefined && v < best) best = v; } return best < 1e8 ? best : 0; };
  const roofed = (x, y, z) => { const a = tmap.get(gkey(x, z)); if (!a) return false; for (const v of a) if (v > y + 2.1) return true; return false; };   // 头顶 2.1m 以上还有楼板 / 屋面：算室内

  // ---------- 2) 补画露在外面的「不渲染」面 ----------
  // 灰盒里被标成不渲染的面（kind 1）：原作者假定玩家到不了屋顶和墙背后。本作的铁驭会蹬墙上房、机甲视点也高，这些面只要露在外面就得画出来。
  // 判断办法：在面上取 5 个点、沿法线挪出 6cm，只要有一个点不在任何别的笔刷里面，这个面就算露在外面
  const HC = 4, hmap = new Map(); const hk = (ix, iz) => ix + '|' + iz;
  for (const b of solid) {
    b.planes = b.faces.map((f) => [f.n[0], f.n[1], f.n[2], f.n[0] * f.P[0][0] + f.n[1] * f.P[0][1] + f.n[2] * f.P[0][2]]);
    for (let ix = Math.floor(b.lo[0] / HC); ix <= Math.floor(b.hi[0] / HC); ix++) for (let iz = Math.floor(b.lo[2] / HC); iz <= Math.floor(b.hi[2] / HC); iz++) { const k = hk(ix, iz); let a = hmap.get(k); if (!a) hmap.set(k, a = []); a.push(b); }
  }
  const inside = (x, y, z, self) => {
    const a = hmap.get(hk(Math.floor(x / HC), Math.floor(z / HC))); if (!a) return false;
    for (const b of a) { if (b === self || y < b.lo[1] - 0.01 || y > b.hi[1] + 0.01 || x < b.lo[0] - 0.01 || x > b.hi[0] + 0.01 || z < b.lo[2] - 0.01 || z > b.hi[2] + 0.01) continue; let ok = true; for (const pl of b.planes) if (pl[0] * x + pl[1] * y + pl[2] * z - pl[3] > 0.004) { ok = false; break; } if (ok) return true; }
    return false;
  };
  // 位移地形的高度表（0.5m 一格，记格内的最低高度）：朝上的面只有整个低于地形才算被盖住——
  // 宁可多画几块埋在沙里的面，也不留下「看不见却踩得到」的台子
  const TC = 0.5, tlow = new Map(); const tk = (x, z) => Math.floor(x / TC) + '|' + Math.floor(z / TC);
  for (const d of km.disps) {
    if (d.nrm[1] <= 0.5) continue; const S = d.size, G = d.G;
    for (let i = 0; i < S - 1; i++) for (let j = 0; j < S - 1; j++) {
      const a = (i * S + j) * 3, b2 = (i * S + j + 1) * 3, c = ((i + 1) * S + j) * 3, e = ((i + 1) * S + j + 1) * 3;
      const len = Math.max(Math.hypot(G[b2] - G[a], G[b2 + 2] - G[a + 2]), Math.hypot(G[c] - G[a], G[c + 2] - G[a + 2])), n = Math.max(2, Math.ceil(len / 0.22));
      for (let u = 0; u <= n; u++) for (let v = 0; v <= n; v++) { const fu = u / n, fv = v / n, w0 = (1 - fu) * (1 - fv), w1 = (1 - fu) * fv, w2 = fu * (1 - fv), w3 = fu * fv; const x = G[a] * w0 + G[b2] * w1 + G[c] * w2 + G[e] * w3, y = G[a + 1] * w0 + G[b2 + 1] * w1 + G[c + 1] * w2 + G[e + 1] * w3, z = G[a + 2] * w0 + G[b2 + 2] * w1 + G[c + 2] * w2 + G[e + 2] * w3; const k = tk(x, z), q = tlow.get(k); if (q === undefined || y < q) tlow.set(k, y); }
    }
  }
  const underTerrain = (x, y, z) => { const v = tlow.get(tk(x, z)); return v !== undefined && y < v - 0.03; };
  // 面上取一批点：面心、朝各顶点的 0.5 / 0.88 / 0.97 处、各边中点略往里；四边形再按 0.5m 左右的间距铺满（每个方向最多 16 格）——
  // 窗洞上沿、挑檐底面这种只露出一小条的面也查得到
  const samples = (P, cx, cy, cz) => {
    const out = [[cx, cy, cz]]; const m = P.length;
    if (m === 4) {
      const nu = Math.min(16, Math.max(1, Math.ceil(Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1], P[1][2] - P[0][2]) / 0.5))), nv = Math.min(16, Math.max(1, Math.ceil(Math.hypot(P[3][0] - P[0][0], P[3][1] - P[0][1], P[3][2] - P[0][2]) / 0.5)));
      for (let u = 0; u < nu; u++) for (let v = 0; v < nv; v++) { const fu = (u + 0.5) / nu, fv = (v + 0.5) / nv; out.push([0, 1, 2].map((k) => (P[0][k] * (1 - fu) + P[1][k] * fu) * (1 - fv) + (P[3][k] * (1 - fu) + P[2][k] * fu) * fv)); }
    }
    for (let i = 0; i < m; i++) { const p = P[i], q = P[(i + 1) % m]; for (const t of [0.5, 0.88, 0.97]) out.push([cx + (p[0] - cx) * t, cy + (p[1] - cy) * t, cz + (p[2] - cz) * t]); const ex = (p[0] + q[0]) / 2, ey = (p[1] + q[1]) / 2, ez = (p[2] + q[2]) / 2; out.push([cx + (ex - cx) * 0.9, cy + (ey - cy) * 0.9, cz + (ez - cz) * 0.9]); }
    return out;
  };
  let shown = 0;
  for (const b of solid) for (const f of b.faces) {
    if (f.kind !== 1) continue; const P = f.P, n = f.n; let cx = 0, cy = 0, cz = 0; for (const p of P) { cx += p[0]; cy += p[1]; cz += p[2]; } cx /= P.length; cy /= P.length; cz /= P.length;
    if (cy < -9.2 && n[1] < 0) continue;   // 整个场景的底面
    let open = false; for (const q of samples(P, cx, cy, cz)) { if (!inside(q[0] + n[0] * 0.06, q[1] + n[1] * 0.06, q[2] + n[2] * 0.06, b) && !(n[1] > 0.5 && underTerrain(q[0], q[1], q[2]))) { open = true; break; } }
    if (open) { f.kind = 0; f.was = 1; shown++; }
  }

  // ---------- 3) 材质分派 ----------
  // 墙面色差：按 14m 左右的街区取色，同一段墙颜色一致，隔一个院子换一种
  const wallTint = (x, z) => { const c = PLASTER[Math.floor(hash(Math.floor((x + 5) / 15), Math.floor((z - 3) / 13)) * PLASTER.length) % PLASTER.length]; const k = 0.95 + 0.09 * vnoise(x * 0.11, z * 0.11); return [c[0] * k, c[1] * k, c[2] * k]; };
  const sandOut = (x, y, z) => clamp01(0.3 + (vnoise(x * 0.2, z * 0.2) - 0.45) * 1.0);    // 露天铺地：风吹进来的沙，成片地盖住石板
  const sandIn = (x, y, z) => clamp01(0.02 + (vnoise(x * 0.3, z * 0.3) - 0.62) * 0.9);    // 室内只在局部有一点
  const roofs = []; let nVis = 0, nCol = 0;
  for (const [id, b] of brushes) {
    if (b.clip) continue;   // 隐形墙不在这里加：dressYard 里只挑出楼梯上的平滑坡
    const dx = b.hi[0] - b.lo[0], dy = b.hi[1] - b.lo[1], dz = b.hi[2] - b.lo[2]; const cx = (b.lo[0] + b.hi[0]) / 2, cz = (b.lo[2] + b.hi[2]) / 2;
    const dims = [dx, dy, dz].sort((p, q) => p - q); const g0 = groundAt(cx, cz); const above = b.lo[1] - g0;   // 离地高度
    // 形状分类
    let role = 'mass';
    if (dims[1] < 0.14 && dims[2] > 0.5) role = 'iron';                          // 两个方向都很细：栏杆、立柱、铁条
    else if (dims[1] < 0.42 && dims[2] > 1.2) role = 'beam';                     // 细长条：木梁、门框、窗框、椽子
    else if (dims[2] < 1.7 && dims[0] > 0.45 && above < 0.6 && dy > 0.45) role = 'crate';   // 落地的小方块：箱子
    else if (dy < 0.5 && Math.min(dx, dz) < 0.75) role = 'step';                 // 又矮又窄：台阶、门槛、压顶
    else if (dy <= 1.35 && Math.min(dx, dz) < 0.8) role = 'low';                 // 矮墙、花池沿、栏板
    const tint = wallTint(cx, cz); const big = dy >= 2 && Math.max(dx, dz) >= 0.5; const h1 = hash(id, 3), h2 = hash(id, 7);
    const small = dims[2] < 1.3; const prev = B.curProbe; if (small) B.curProbe = B.addProbe(cx, b.hi[1] + 0.1, cz);
    const crateC = [rr(0.78, 1.0), rr(0.72, 0.9), rr(0.6, 0.78)], woodC = [0.56 + h1 * 0.14, 0.47 + h1 * 0.1, 0.38 + h1 * 0.08];
    for (const f of b.faces) {
      const n = f.n, up = n[1] > 0.7, down = n[1] < -0.7; let mat = 'plaster', cmat = 'plaster', cc = tint; const o = { rays: small ? 8 : 20 };
      const fy = f.P[0][1]; let fx = 0, fz = 0; for (const p of f.P) { fx += p[0]; fz += p[2]; } fx /= f.P.length; fz /= f.P.length;
      if (role === 'iron') { mat = cmat = 'metalPaint'; o.c = cc = [0.2, 0.2, 0.21]; }
      else if (role === 'beam') { mat = cmat = 'wood'; o.c = cc = woodC; }
      else if (role === 'crate') { mat = cmat = 'wood'; o.c = cc = crateC; }
      else if (role === 'step') { mat = cmat = 'sandstone'; o.c = cc = [0.96, 0.92, 0.86]; }
      else if (up) {
        const h = fy - groundAt(fx, fz), indoor = roofed(fx, fy, fz);
        if (h < 1.0 || indoor) { mat = cmat = 'paving'; o.af = indoor ? sandIn : sandOut; o.c = cc = indoor ? [0.9, 0.87, 0.84] : [0.97, 0.94, 0.9]; }   // 地面、室内楼板：石板
        else if (role === 'low' || f.n[3] < 3) { mat = cmat = 'sandstone'; o.c = cc = [0.95, 0.9, 0.84]; }                                               // 矮墙顶、窗台、压顶
        else {
          // 屋面：抹灰平顶，颜色比墙面深一档
          mat = cmat = 'plaster'; o.c = cc = [tint[0] * 0.8, tint[1] * 0.78, tint[2] * 0.74]; o.a = 0.02; o.ts = 4.2;
          if (f.P.length === 4 && f.n[3] > 34) roofs.push([b.lo[0], b.lo[2], b.hi[0], b.hi[2], fy]);
        }
      } else if (down) { mat = 'plaster'; o.c = [tint[0] * 0.9, tint[1] * 0.9, tint[2] * 0.9]; o.a = 0.04; }
      else if (role === 'low') { mat = cmat = 'sandstone'; o.c = cc = [0.96, 0.91, 0.85]; o.grime = { h: 0.5, m: 0.8 }; }
      else {
        // 墙：落地的墙，墙脚返潮发暗、灰泥剥落露出砖；架在高处的墙只做墙头雨痕。每段墙的破损程度不同
        o.c = tint; o.a = 0.06 + 0.2 * h1 * h1;
        if (above < 0.8) o.grime = { h: 0.9 + h2 * 0.7, m: 0.76, a: 0.22 + 0.3 * h2 };
        if (dy > 2.4) o.top = { h: 0.7, m: 0.87 };
      }
      if (f.was) { o.cell = 4.4; if (o.rays > 14) o.rays = 14; }   // 补画出来的面（屋顶、墙背后）是次要表面：细分粗一些、采样少一些，省烘焙时间
      if (f.kind === 0) { B.poly(mat, f.P, n, o); nVis++; }
      B.colPoly(f.P, cmat, cc, big || (up && f.n[3] > 4), null); nCol++;
    }
    B.curProbe = prev;
  }
  // 位移地形：朝上的是沙土地面（低洼处、陡坡多土），陡的当岩石
  for (const d of km.disps) {
    if (d.nrm[1] > 0.5) B.dispGrid('terrain', d.size, d.G, d.nrm, { surf: 'sand', mech: true, af: (x, y, z, ny) => clamp01(0.12 + (vnoise(x * 0.15, z * 0.15) - 0.4) * 1.3 + (1 - ny) * 2.2), cf: (x, y, z) => { const k = 0.9 + 0.14 * vnoise(x * 0.07 + 9, z * 0.07); return [k, k * 0.985, k * 0.96]; } });
    else B.dispGrid('rock', d.size, d.G, d.nrm, { c: [0.93, 0.84, 0.74], ts: 5, mech: true, double: true });   // 立着的岩壁：两面都画
  }

  // ---------- 3.5) 城门：把通往堡外的出口砌成关着的门 ----------
  // 砂岩门墩 + 过梁 + 两扇带铁箍、门钉的厚木门（朝堡内的一面横着一根门闩），门上方砌墙压顶
  const gateBoxes = [];   // 城门各部件的实心范围：导航判断「这个点是不是在实心体里」时要算上（上下叠放的盒子，光靠射线判断不准）
  for (const [axis, p, c0, c1, y0, top, inS] of GATES) {
    const box = (mat, a0, ya, a1, yb, d0, d1, o) => {
      const q = axis === 'x' ? [a0, ya, p + Math.min(d0, d1), a1, yb, p + Math.max(d0, d1)] : [p + Math.min(d0, d1), ya, a0, p + Math.max(d0, d1), yb, a1];
      if (!o || o.collide !== false) gateBoxes.push(q); B.box(mat, q[0], q[1], q[2], q[3], q[4], q[5], o);
    };
    const W = c1 - c0, pier = Math.min(1.0, W * 0.13), doorH = Math.min(3.7, top - y0 - 1.0), mid = (c0 + c1) / 2, yb = y0 - 0.35;
    const tint = wallTint(axis === 'x' ? mid : p, axis === 'x' ? p : mid), stone = [0.95, 0.9, 0.83], wood = [0.74, 0.62, 0.5], iron = [0.2, 0.2, 0.21];
    box('sandstone', c0, yb, c0 + pier, top, -0.5, 0.5, { c: stone, grime: { h: 0.8, m: 0.78 }, bottom: false }); box('sandstone', c1 - pier, yb, c1, top, -0.5, 0.5, { c: stone, grime: { h: 0.8, m: 0.78 }, bottom: false });
    box('sandstone', c0 + pier, y0 + doorH, c1 - pier, y0 + doorH + 0.5, -0.42, 0.42, { c: stone });                                              // 过梁
    if (top - (y0 + doorH + 0.5) > 0.1) box('plaster', c0 + pier, y0 + doorH + 0.5, c1 - pier, top, -0.3, 0.3, { c: tint, a: 0.14, top: { h: 0.5, m: 0.86 } });   // 门上方的墙
    box('sandstone', c0 - 0.12, top, c1 + 0.12, top + 0.2, -0.6, 0.6, { c: [0.9, 0.85, 0.78] });                                                    // 压顶
    for (const [a, b2] of [[c0 + pier, mid - 0.015], [mid + 0.015, c1 - pier]]) {
      box('wood', a, yb, b2, y0 + doorH, -0.1, 0.1, { c: wood, bottom: false, mech: true });
      for (const hh of [0.5, doorH * 0.5, doorH - 0.5]) box('metalPaint', a + 0.04, y0 + hh - 0.08, b2 - 0.04, y0 + hh + 0.08, -0.13, 0.13, { c: iron, collide: false, rays: 8 });   // 铁箍
      const nS = Math.max(3, Math.round((b2 - a) / 0.55));
      for (let k = 0; k < nS; k++) for (const hh of [0.5, doorH * 0.5, doorH - 0.5]) { const x = a + (b2 - a) * (k + 0.5) / nS; box('metalPaint', x - 0.045, y0 + hh - 0.045, x + 0.045, y0 + hh + 0.045, -0.165, 0.165, { c: [0.3, 0.29, 0.27], collide: false, rays: 0 }); }   // 门钉
    }
    box('wood', mid - W * 0.3, y0 + 1.2, mid + W * 0.3, y0 + 1.4, inS * 0.12, inS * 0.3, { c: [0.82, 0.7, 0.56], rays: 8 });                       // 门闩
    for (const m of [mid - W * 0.22, mid + W * 0.22]) box('metalPaint', m - 0.07, y0 + 1.1, m + 0.07, y0 + 1.5, inS * 0.1, inS * 0.34, { c: iron, collide: false, rays: 0 });   // 门闩的铁托
  }

  // ---------- 4) 城外：一圈沙地和远山，让堡垒不是悬在半空 ----------
  {
    const R = 620, seg = 40; const g = new THREE.PlaneGeometry(R * 2, R * 2, seg, seg); g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position; const lo = km.head.min, hi = km.head.max;
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), z = pos.getZ(i); const d = Math.max(lo[0] - x, x - hi[0], lo[2] - z, z - hi[2], 0); pos.setY(i, -9.4 + Math.min(1, d / 160) * (3 + 16 * vnoise(x * 0.008 + 3, z * 0.008))); }
    g.computeVertexNormals(); B.addGeo('terrain', g, new THREE.Matrix4(), { uv: 'world', rays: 0, a: 0.05 });   // 只渲染、不参与碰撞：它铺在整座堡垒底下，进了碰撞体会被导航当成「最低的一层地面」
    for (let i = 0; i < 14; i++) {
      const a = i / 14 * 6.28 + rr(-0.15, 0.15), dd = rr(420, 600), x = Math.cos(a) * dd, z = Math.sin(a) * dd, r = rr(50, 120), h = rr(60, 130); let y = 2, rad = r;
      for (let k = 0; k < 3; k++) { const hh = h * [0.42, 0.33, 0.25][k]; let gg = new THREE.CylinderGeometry(rad * rr(0.78, 0.9), rad, hh, 11, 2); gg = gg.toNonIndexed(); gg.computeVertexNormals(); B.addGeo('rock', gg, M4(x, y + hh / 2, z, 0, k * 0.7, 0), { uv: 'world', ts: 40, rays: 0, c: [0.92, 0.8, 0.7] }); y += hh; rad *= rr(0.6, 0.78); }
    }
  }

  // ---------- 5) 关卡数据（其余在 dressYard / finishYard 里由导航网格补全）----------
  const sp = km.head.spawns[0] || { p: [0, 0, 40], yaw: 0 };
  const L = {
    name: YARD_NAME, playerSpawn: { x: sp.p[0], y: sp.p[1] + 0.1, z: sp.p[2], yaw: 0 },
    friendlyPods: [], enemyPods: [], mechDrops: [], nests: [], zones: null, combatPoints: [], respawns: [],
    ziplines: [], shafts: [], smokes: [], flyover: [], dustVolumes: [], lights: km.head.lights, roofs, mapLow: -99, oob: YARD_OOB, clips,
    stats: { brushes: brushes.size, visible: nVis, exposed: shown, collide: nCol, disps: km.disps.length },
  };
  // 给导航用：这个点是不是在某个实心笔刷（或城门）里面
  L.solidAt = (x, y, z) => { if (inside(x, y, z, null)) return true; for (const q of gateBoxes) if (x > q[0] && x < q[3] && y > q[1] && y < q[4] && z > q[2] && z < q[5]) return true; return false; };
  // 调试：查某个点落在哪些笔刷里（控制台里用 __dbg.level.dbg.at(x, y, z)）
  L.dbgFaces = (id) => { const b = brushes.get(id); return b ? b.faces.map((f) => ({ kind: f.kind, was: f.was || 0, n: f.n.map((v) => +v.toFixed(2)), P: f.P.map((p) => p.map((v) => +v.toFixed(2))) })) : null; };
  L.dbg = { at: (x, y, z, r = 0.05) => { const out = []; for (const [id, b] of brushes) { if (b.clip || x < b.lo[0] - r || x > b.hi[0] + r || y < b.lo[1] - r || y > b.hi[1] + r || z < b.lo[2] - r || z > b.hi[2] + r) continue; let ok = true; for (const pl of b.planes) if (pl[0] * x + pl[1] * y + pl[2] * z - pl[3] > r) { ok = false; break; } if (ok) out.push({ id, lo: b.lo.map((v) => +v.toFixed(2)), hi: b.hi.map((v) => +v.toFixed(2)), kinds: b.faces.map((f) => f.kind + (f.was ? '*' : '')).join('') }); } return out; } };
  return L;
}

// ---------- 陈设与灯光（需要导航网格 nav 和不含陈设的碰撞体 world）----------
export function dressYard(B, K, L, nav, world) {
  const { rr, pick, chance, rng } = K; const W = nav.w, H = nav.h, cs = nav.cs, N = W * H; const bvh = world.bvh;
  const ray = new THREE.Ray(), DS = THREE.DoubleSide, FS = THREE.FrontSide, _o = new THREE.Vector3(), _dn = new THREE.Vector3(0, -1, 0);
  const cast = (x, y, z, dx, dy, dz, max, side = DS) => { ray.origin.set(x, y, z); ray.direction.set(dx, dy, dz); return bvh.raycastFirst(ray, side, 0, max); };
  // 0) 隐形墙里只留楼梯上的平滑坡：有一个斜面、且斜面紧贴着下面的台阶（往下 0.5m 内就是实体）。其余的盖子、挡板全部不要
  let ramps = 0;
  for (const b of L.clips) {
    if (b.hi[1] - b.lo[1] > 4.6) continue; const f = b.faces.find((q) => q.n[1] > 0.3 && q.n[1] < 0.97); if (!f) continue;
    let cx = 0, cy = 0, cz = 0; for (const p of f.P) { cx += p[0]; cy += p[1]; cz += p[2]; } cx /= f.P.length; cy /= f.P.length; cz /= f.P.length;
    const pts = [[cx, cy, cz]]; for (const p of f.P) pts.push([cx + (p[0] - cx) * 0.6, cy + (p[1] - cy) * 0.6, cz + (p[2] - cz) * 0.6]);
    let near = 0; for (const q of pts) { const h = cast(q[0], q[1] + 0.05, q[2], 0, -1, 0, 0.6, FS); if (h) near++; }
    if (near >= pts.length * 0.6) { B.clipPoly(f.P); ramps++; }   // 只留斜面本身：侧面和背面不要，免得楼梯两侧多出看不见的小墙
  }
  // 离不可走格的距离（米）
  const D = new Float32Array(N); for (let i = 0; i < N; i++) D[i] = nav.ok[i] ? 1e4 : 0;
  for (let iz = 0; iz < H; iz++) for (let ix = 0; ix < W; ix++) { const i = iz * W + ix; if (!D[i]) continue; let m = D[i]; if (ix > 0) m = Math.min(m, D[i - 1] + 1); if (iz > 0) m = Math.min(m, D[i - W] + 1); if (ix > 0 && iz > 0) m = Math.min(m, D[i - W - 1] + 1.414); if (ix < W - 1 && iz > 0) m = Math.min(m, D[i - W + 1] + 1.414); D[i] = m; }
  for (let iz = H - 1; iz >= 0; iz--) for (let ix = W - 1; ix >= 0; ix--) { const i = iz * W + ix; if (!D[i]) continue; let m = D[i]; if (ix < W - 1) m = Math.min(m, D[i + 1] + 1); if (iz < H - 1) m = Math.min(m, D[i + W] + 1); if (ix < W - 1 && iz < H - 1) m = Math.min(m, D[i + W + 1] + 1.414); if (ix > 0 && iz < H - 1) m = Math.min(m, D[i + W - 1] + 1.414); D[i] = m; }
  for (let i = 0; i < N; i++) D[i] *= cs;
  const cellOf = (i) => { const x = nav.cx(i), z = nav.cz(i); const ix = i % W, iz = (i / W) | 0; const gx = (ix < W - 1 ? D[i + 1] : D[i]) - (ix > 0 ? D[i - 1] : D[i]), gz = (iz < H - 1 ? D[i + W] : D[i]) - (iz > 0 ? D[i - W] : D[i]); const gl = Math.hypot(gx, gz) || 1; return { i, x, z, y: nav.hgt[i], d: D[i], nx: gx / gl, nz: gz / gl, sky: nav.sky[i] }; };
  // 附近有多宽敞：半径 r 内离墙最远的距离
  const roomAt = (i, r = 4) => { const ix = i % W, iz = (i / W) | 0, k = Math.round(r / cs); let m = 0; for (let dz = -k; dz <= k; dz += 2) for (let dx = -k; dx <= k; dx += 2) { const x = ix + dx, z = iz + dz; if (x < 0 || z < 0 || x >= W || z >= H) continue; const v = D[z * W + x]; if (v < 1e3 && v > m) m = v; } return m; };
  const surfAt = (x, y, z) => { const h = world.raycast(_o.set(x, y + 1.2, z), _dn, 3); return h ? { y: h.point.y, surf: h.surf } : null; };
  const order = nav.list.slice(); for (let i = order.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; const t = order[i]; order[i] = order[j]; order[j] = t; }   // 打乱（随机数有种子，每次结果一样）
  // 出生点和开场镜头的落点周围不摆东西
  const taken = [[L.playerSpawn.x, L.playerSpawn.z, 5], [L.playerSpawn.x + 5, L.playerSpawn.z + 9, 4.5]]; const far = (x, z, r) => { for (const t of taken) if (!t[3] && Math.hypot(t[0] - x, t[1] - z) < r + t[2]) return false; return true; };
  const blocks = [];   // 有碰撞的陈设：摆完后把它们脚下的导航格标成不可走
  const stat = { cluster: 0, palm: 0, bunting: 0, awning: 0, lantern: 0, dust: 0, roof: 0, ramps, clipsDropped: L.clips.length - ramps };

  // 1) 靠墙的一堆堆杂物：只摆在宽敞处的墙根（离墙 1m 左右、附近有 3m 以上的空地），互相隔开 8m 以上
  for (const i of order) {
    if (D[i] < 0.9 || D[i] > 1.3) continue; const c = cellOf(i); if (!far(c.x, c.z, 7.5) || roomAt(i) < 3.2) continue;
    const bx = c.x - c.nx * 0.5, bz = c.z - c.nz * 0.5; const s = surfAt(bx, c.y, bz); if (!s || Math.abs(s.y - c.y) > 0.35) continue;
    const y = s.y, tx = -c.nz, tz = c.nx, indoor = c.sky < 0.25, sand = s.surf === 'sand'; const k = rng();
    if (sand && k < 0.45) { K.sandPile(bx - c.nx * 0.4, bz - c.nz * 0.4, rr(1.3, 2.3), rr(0.3, 0.6), y); K.tufts(c.x + tx * 1.2, c.z + tz * 1.2, 3, 0.9, y); if (chance(0.5)) K.rock(c.x - tx * 1.4, c.z - tz * 1.4, rr(0.25, 0.5), y); taken.push([c.x, c.z, 2]); }
    else if (k < 0.3) { K.crateStack(bx, bz, 2 + ((rng() * 2) | 0), 0.8, y); if (chance(0.5)) K.barrel(bx + tx * 1.6, y, bz + tz * 1.6); blocks.push([bx, bz, 1.7]); taken.push([c.x, c.z, 2.5]); }
    else if (k < 0.5) { const n = 2 + ((rng() * 2) | 0); for (let j = 0; j < n; j++) K.barrel(bx + tx * (j - (n - 1) / 2) * 0.72 + rr(-0.08, 0.08), y, bz + tz * (j - (n - 1) / 2) * 0.72 + rr(-0.08, 0.08)); if (chance(0.4)) K.barrel(bx + c.nx * 0.75, y, bz + c.nz * 0.75, null, { lying: true, ry: rng() * 3 }); blocks.push([bx, bz, 1.4]); taken.push([c.x, c.z, 2.2]); }
    else if (k < 0.68) { K.pots(bx, bz, 3 + ((rng() * 2) | 0), 0.7, y); if (!sand && chance(0.6)) K.rug(c.x + c.nx * 0.5, y + 0.02, c.z + c.nz * 0.5, rr(1.4, 2), rr(2, 2.8), Math.atan2(c.nx, c.nz)); blocks.push([bx, bz, 1.1]); taken.push([c.x, c.z, 2]); }
    else if (k < 0.84) { K.sacks(bx, bz, 4 + ((rng() * 3) | 0), y); if (chance(0.5)) K.crate(bx + tx * 1.3, y, bz + tz * 1.3, rr(0.7, 1), rng() * 3); blocks.push([bx, bz, 1.4]); taken.push([c.x, c.z, 2.2]); }
    else if (!indoor && roomAt(i, 5) > 4.2) { const px = c.x + c.nx * 1.6, pz = c.z + c.nz * 1.6; const sy = surfAt(px, c.y, pz); if (sy && Math.abs(sy.y - c.y) < 0.3) { K.sandbags(px, pz, 2.6, Math.atan2(tx, tz) + Math.PI / 2, 3, sy.y); blocks.push([px, pz, 1.6]); taken.push([px, pz, 3]); } }
    else { K.rubble(bx, bz, 1.1, 7, y); taken.push([c.x, c.z, 1.5]); }
    if (++stat.cluster >= 70) break;
  }
  // 2) 沙地上的棕榈和草丛：棕榈只种在露天的沙土上、离墙 2m 以上；草丛到处撒
  const palms = [];
  for (const i of order) {
    if (D[i] < 1.8 || nav.sky[i] < 0.8) continue; const c = cellOf(i); if (!far(c.x, c.z, 1.5) || palms.some((p) => Math.hypot(p[0] - c.x, p[1] - c.z) < 8.5)) continue;
    const s = surfAt(c.x, c.y, c.z); if (!s || s.surf !== 'sand') continue;
    K.palm(c.x, c.z, rr(6.5, 10), { y: s.y }); K.tufts(c.x + rr(-1, 1), c.z + rr(-1, 1), 3, 1.0, s.y); blocks.push([c.x, c.z, 0.7]); palms.push([c.x, c.z]); taken.push([c.x, c.z, 2]); if (++stat.palm >= 18) break;
  }
  { let n = 0; for (const i of order) { if (nav.sky[i] < 0.6 || D[i] < 0.5) continue; const x = nav.cx(i) + rr(-0.2, 0.2), z = nav.cz(i) + rr(-0.2, 0.2); const s = surfAt(x, nav.hgt[i], z); if (!s || s.surf !== 'sand') continue; if (chance(0.82)) K.tufts(x, z, 2, 0.6, s.y); else K.rock(x, z, rr(0.12, 0.3), s.y); if (++n >= 260) break; } }
  // 3) 彩旗：院子上空，从一面墙拉到对面的墙
  for (const i of order) {
    if (nav.sky[i] < 0.8 || D[i] < 0.7 || D[i] > 1.2) continue; const c = cellOf(i); const y = c.y + rr(4.0, 5.2);
    const a = cast(c.x, y, c.z, -c.nx, 0, -c.nz, 2.5, FS), b = cast(c.x, y, c.z, c.nx, 0, c.nz, 26, FS); if (!a || !b || b.distance < 7) continue;
    const pa = [a.point.x + c.nx * 0.05, y, a.point.z + c.nz * 0.05], pb = [b.point.x - c.nx * 0.05, y + rr(-0.5, 0.5), b.point.z - c.nz * 0.05];
    let ok = true; for (const t of taken) if (t[3] === 'b' && Math.hypot(t[0] - (pa[0] + pb[0]) / 2, t[1] - (pa[2] + pb[2]) / 2) < 9) { ok = false; break; } if (!ok) continue;
    K.bunting(pa, pb, 0.5 + b.distance * 0.03); taken.push([(pa[0] + pb[0]) / 2, (pa[2] + pb[2]) / 2, 0, 'b']); if (++stat.bunting >= 12) break;
  }
  // 4) 遮阳棚：露天铺地旁一段 3m 以上的平直墙面
  for (const i of order) {
    if (nav.sky[i] < 0.8 || D[i] < 0.7 || D[i] > 1.1) continue; const c = cellOf(i); const tx = -c.nz, tz = c.nx; const y = c.y + rr(2.5, 2.9), len = rr(2.6, 3.8);
    const hs = []; for (const k of [-0.5, 0, 0.5]) { const h = cast(c.x + tx * len * k, y, c.z + tz * len * k, -c.nx, 0, -c.nz, 2.2, FS); if (!h) break; hs.push({ d: h.distance, x: h.point.x, z: h.point.z }); } if (hs.length < 3) continue;
    if (Math.abs(hs[0].d - hs[1].d) > 0.05 || Math.abs(hs[2].d - hs[1].d) > 0.05) continue;
    if (cast(c.x, y + 0.2, c.z, c.nx, 0, c.nz, 2.4, FS)) continue;   // 对面太近
    const wx = hs[1].x + c.nx * 0.03, wz = hs[1].z + c.nz * 0.03; let ok = true; for (const t of taken) if (t[3] === 'a' && Math.hypot(t[0] - wx, t[1] - wz) < 12) { ok = false; break; } if (!ok) continue;
    // K.awning 朝 a→b 的右手边伸出：让它背向墙
    const ax = wx - tx * len / 2, az = wz - tz * len / 2, bx2 = wx + tx * len / 2, bz2 = wz + tz * len / 2;
    if (tz * c.nx - tx * c.nz > 0) K.awning(ax, az, bx2, bz2, y, rr(1.4, 1.9), pick(CLOTH)); else K.awning(bx2, bz2, ax, az, y, rr(1.4, 1.9), pick(CLOTH));
    taken.push([wx, wz, 0, 'a']); if (++stat.awning >= 9) break;
  }
  // 5) 灯：灰盒里的灯位换成灯笼（有顶就吊在顶下，没顶就挂在最近的墙上）；室内再按 8m 间距补一些。都烘进光照
  const lamps = [];
  const hang = (x, y, z, power, radius) => {
    const up = cast(x, y, z, 0, 1, 0, 6), dn = cast(x, y, z, 0, -1, 0, 8, FS); const fl = dn ? dn.point.y : y - 2.5;
    if (up && up.face.normal.y < 0) { const cy = y + up.distance; const ly = Math.min(Math.max(fl + 2.25, cy - 1.1), cy - 0.3); K.lantern(x, ly, z, { drop: Math.max(0.05, cy - ly), power, radius }); lamps.push([x, z]); return true; }
    let best = null; for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, h = cast(x, y, z, Math.cos(a), 0, Math.sin(a), 3.2, FS); if (h && (!best || h.distance < best.d)) best = { d: h.distance, x: h.point.x, z: h.point.z, dx: Math.cos(a), dz: Math.sin(a) }; }
    if (!best) return false;
    const ly = Math.max(fl + 2.5, Math.min(y, fl + 3.4)), lx = best.x - best.dx * 0.38, lz = best.z - best.dz * 0.38;
    K.tube('dark', [best.x, ly + 0.32, best.z], [lx, ly + 0.3, lz], 0.014, { rays: 0 }); K.lantern(lx, ly, lz, { drop: 0.3, power, radius }); lamps.push([lx, lz]); return true;
  };
  for (const l of L.lights) { if (hang(l.p[0], l.p[1], l.p[2], l.spot ? 28 : 22, l.spot ? 11 : 9)) stat.lantern++; }
  for (const i of order) {
    if (nav.sky[i] > 0.12 || D[i] < 0.9) continue; const x = nav.cx(i), z = nav.cz(i); let ok = true; for (const p of lamps) if (Math.hypot(p[0] - x, p[1] - z) < 7.5) { ok = false; break; } if (!ok) continue;
    if (hang(x, nav.hgt[i] + 1.8, z, 22, 9)) stat.lantern++;
  }
  // 6) 室内浮尘体：把不见天的可走格连成片，每片取包围盒；形状不规整（包围盒里一半以上是空的）就对半切开再取，直到贴合
  {
    const seen = new Uint8Array(N); const vols = [];
    const fit = (cells, depth) => {
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, y0 = 1e9, y1 = -1e9; for (const c of cells) { const cx = c % W, cz = (c / W) | 0; x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); z0 = Math.min(z0, cz); z1 = Math.max(z1, cz); y0 = Math.min(y0, nav.hgt[c]); y1 = Math.max(y1, nav.hgt[c]); }
      const area = cells.length * cs * cs, bw = (x1 - x0 + 1) * cs, bd = (z1 - z0 + 1) * cs; if (area < 12) return;
      if (area >= bw * bd * 0.5 || depth >= 4) { vols.push([nav.x0 + x0 * cs, y0, nav.z0 + z0 * cs, nav.x0 + (x1 + 1) * cs, y1 + 4.2, nav.z0 + (z1 + 1) * cs, 5, cells.length]); return; }
      const byX = bw >= bd, mid = byX ? (x0 + x1) / 2 : (z0 + z1) / 2; const a = [], b = []; for (const c of cells) ((byX ? c % W : (c / W) | 0) <= mid ? a : b).push(c);
      fit(a, depth + 1); fit(b, depth + 1);
    };
    for (const s of nav.list) {
      if (seen[s] || nav.sky[s] > 0.2) continue; const st = [s], cells = []; seen[s] = 1;
      while (st.length) { const c = st.pop(); cells.push(c); const cz = (c / W) | 0; for (const dd of [1, -1, W, -W]) { const ni = c + dd; if (ni < 0 || ni >= N || seen[ni] || !nav.ok[ni] || nav.sky[ni] > 0.2) continue; if ((dd === 1 || dd === -1) && ((ni / W) | 0) !== cz) continue; seen[ni] = 1; st.push(ni); } }
      fit(cells, 0);
    }
    vols.sort((p, q) => q[7] - p[7]); L.dustVolumes = vols.slice(0, 14).map((v) => v.slice(0, 7)); stat.dust = L.dustVolumes.length;
  }
  // 7) 屋顶杂物：大块平屋面上摆水箱、天线锅、空调外机（只取露天的、够大的矩形屋面）
  for (const r of L.roofs) { if (r[2] - r[0] < 5 || r[3] - r[1] < 5 || !chance(0.7)) continue; const mx = (r[0] + r[2]) / 2, mz = (r[1] + r[3]) / 2; if (cast(mx, r[4] + 0.3, mz, 0, 1, 0, 30)) continue; K.roofProps(r[0] + 1, r[1] + 1, r[2] - 1, r[3] - 1, r[4], 0.5); stat.roof++; }

  // 有碰撞的陈设脚下不可走（不重新泛洪：摆放规则保证了它们只占宽敞处的墙根，不会把路堵死）；机甲离它们 3m 以上
  for (const [x, z, r] of blocks) {
    const k = Math.ceil((r + 3) / cs), ix = Math.floor((x - nav.x0) / cs), iz = Math.floor((z - nav.z0) / cs);
    for (let dz = -k; dz <= k; dz++) for (let dx = -k; dx <= k; dx++) { const px = ix + dx, pz = iz + dz; if (px < 0 || pz < 0 || px >= W || pz >= H) continue; const dd = Math.hypot(dx, dz) * cs, j = pz * W + px; if (dd <= r + 0.2) { nav.ok[j] = 0; nav.walk[j] = 0; } if (dd <= r + 3) nav.mech[j] = 0; }
  }
  nav.list = nav.list.filter((i) => nav.ok[i]); nav.mechList = nav.mechList.filter((i) => nav.mech[i]);
  L.stats.dress = stat;
  return L;
}

// 导航网格和陈设都定下来之后：挑出两队的空降点、交战点、机甲投放点、重生点、狙击位，定好镜头
export function finishYard(L, nav, world) {
  const list = nav.list; const cells = []; for (let k = 0; k < list.length; k += 2) { const i = list[k]; cells.push({ i, x: nav.cx(i), z: nav.cz(i), y: nav.hgt[i], sky: nav.sky[i], mech: nav.mech[i] }); }
  // 最远点采样：从候选里挑 n 个互相离得尽量远的点
  const spread = (cand, n, minD) => {
    const out = [];
    while (out.length < n && cand.length) {
      let best = null, bd = -1; for (const c of cand) { let d = 1e9; for (const o of out) d = Math.min(d, Math.hypot(o.x - c.x, o.z - c.z)); if (!out.length) d = 1e6 - Math.abs(c.x); if (d > bd) { bd = d; best = c; } }
      if (!best || (out.length && bd < minD)) break; out.push(best);
    }
    return out;
  };
  let z0 = 1e9, z1 = -1e9, x0 = 1e9, x1 = -1e9; for (const c of cells) { if (c.z < z0) z0 = c.z; if (c.z > z1) z1 = c.z; if (c.x < x0) x0 = c.x; if (c.x > x1) x1 = c.x; }
  const open = cells.filter((c) => c.sky >= 0.8);   // 露天：空降舱要从天上落下来
  const fz = z1 - (z1 - z0) * 0.26, ez = z0 + (z1 - z0) * 0.26;
  L.friendlyPods = spread(open.filter((c) => c.z > fz), 8, 7).map((c) => [c.x, c.z]);
  L.enemyPods = spread(open.filter((c) => c.z < ez), 8, 7).map((c) => [c.x, c.z]);
  L.respawns = spread(open.filter((c) => c.z > fz && c.mech), 5, 8).map((c) => [c.x, c.z]);
  L.mechDrops = spread(open.filter((c) => c.mech), 9, 14).map((c) => [c.x, c.z]);
  const cp = spread(cells.filter((c) => c.z > ez - 4 && c.z < fz + 4), 30, 9);
  L.combatPoints = cp.map((c, k) => { const t = (c.x - x0) / Math.max(1, x1 - x0); return [c.x, c.z, k % 5 === 4 ? 'C' : t < 0.36 ? 'W' : t > 0.64 ? 'E' : 'M']; });
  L.navRange = { z0, z1, x0, x1 };
  L.droneSpawn = { x0: x0 * 0.6, x1: x1 * 0.6, z: z0 + 3 };
  // 狙击位：主连通区之外、离地 5–11m 的露天屋面，要能看见一批交战点
  {
    const ray = new THREE.Ray(), W = nav.w, cand = [];
    for (let iz = 2; iz < nav.h - 2; iz += 4) for (let ix = 2; ix < W - 2; ix += 4) {
      const i = iz * W + ix; if (!nav.walk[i] || nav.ok[i] || nav.sky[i] < 0.9) continue; const y = nav.hgt[i]; if (y < 5 || y > 11) continue; const x = nav.cx(i), z = nav.cz(i); if (z > 20) continue;
      let see = 0; for (const p of cp) { const dx = p.x - x, dy = p.y + 1.2 - (y + 1.5), dz = p.z - z, d = Math.hypot(dx, dy, dz); if (d < 12 || d > 70) continue; ray.origin.set(x, y + 1.5, z); ray.direction.set(dx / d, dy / d, dz / d); if (!world.bvh.raycastFirst(ray, THREE.DoubleSide, 0, d - 0.5)) see++; }
      if (see >= 4) cand.push({ x, y, z, see });
    }
    cand.sort((p, q) => q.see - p.see); const picked = []; for (const c of cand) { if (picked.every((p) => Math.hypot(p.x - c.x, p.z - c.z) > 18)) picked.push(c); if (picked.length >= 5) break; }
    L.nests = picked.map((c) => [c.x, c.y, c.z]);
  }
  // 主菜单的环绕镜头、开场的两段飞越（先俯瞰全堡，再落向出生的院子）
  const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, sp = L.playerSpawn;
  L.menuCam = { x: mx, y: 30, z: mz, rx: (x1 - x0) * 0.62 + 14, rz: (z1 - z0) * 0.6 + 14, dy: 6, look: [mx, 3, mz] };
  L.flyover = [
    { from: [mx - 60, 46, z0 - 30], to: [mx + 30, 34, mz - 10], look: [mx, 2, mz + 10], t: 4.2 },
    { from: [sp.x + 26, 22, sp.z + 30], to: [sp.x + 5, sp.y + 4.5, sp.z + 9], look: [sp.x, sp.y + 1.4, sp.z - 8], t: 3.6 },
  ];
  return L;
}
