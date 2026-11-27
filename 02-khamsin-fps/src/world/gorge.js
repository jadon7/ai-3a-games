// 第五张地图「赤岩峡」——灰盒原型（几何块 + 地形，先验证布局和手感，确认后再做成完整地图）。
//
// 按主流对战 FPS 地图的通用结构来搭（参考品类做法，不照搬任何一张现成地图）：
//   · 没有方格：一条 S 形的干河道斜穿地图中央，把两队隔开；街道顺着地势拐弯，房子跟着街道转角度，体块是不规则多边形
//   · 中心对称：绕地图中心转 180° 两边完全一样，两队拿到的地形一样；但同一条路两头的地形不同——
//       西路：我方这头是沿山坡的老城（窄巷、屋顶、近战），过了西桥是敌方的采石场（开阔、远距离）；东路正好反过来
//       中路：主街 → 渡槽广场 → 河滩台阶 → 河床，头顶是一座中段断开的古渡槽（全图地标，二段跳 / 钩爪过断口）
//   · 真正的起伏：出生区在高处（+8 m），老城一层层下到河边，钟楼在山包顶上，采石场挖到地面以下，河床 −4 m
//   · 河道是前线：西桥、渡槽（高）+ 河床（低）、东桥三处过河；河床本身是一条贯通三路的低层侧翼
//   · 边界看得见：四周是悬崖，河道两头是坝墙，没有空气墙；翻上悬崖会倒数送回
// 颜色按功能区分（COL），所有面都铺 1 m / 4 m 网格（proto 材质）。
import * as THREE from 'three';
import { M4 } from './kit.js';
import { createBlockout, frame, fw, sub, polyline, nearest, along, polySD, inPoly, clipHalf, centroid, polyHit, smooth, lerp, hash, angTo, area2 } from './blockout.js';

export const GORGE_NAME = '赤岩峡';
export const GORGE_BOUNDS = { x0: -80, x1: 80, z0: -101, z1: 101, cell: 0.5, radius: 0.4, step: 0.5, layers: 10 };

export const COL = {
  ground: [0.78, 0.66, 0.52],     // 地面（土坡）
  road: [0.63, 0.62, 0.6],        // 街道、广场、车道
  floor2: [0.76, 0.76, 0.74],     // 楼板、屋面、桥面
  wall: [0.88, 0.87, 0.84],       // 房屋体块、墙
  run: [0.42, 0.64, 0.96],        // 设计好的蹬墙跑墙面（河堤、渡槽墩、长巷墙）
  cover: [0.96, 0.8, 0.32],       // 齐腰掩体（≈1 m）
  cover2: [0.78, 0.66, 0.52],     // 高掩体：货箱、机器、船
  beam: [1.0, 0.48, 0.14],        // 钩爪点：横梁、吊机
  stair: [0.5, 0.82, 0.5],        // 楼梯、坡道、攀爬石
  river: [0.52, 0.58, 0.66],      // 河床（低层）
  rock: [0.64, 0.5, 0.43],        // 岩石、悬崖、陡坡
  obj: [0.98, 0.84, 0.42],        // 地标：古渡槽、钟楼
  spawnF: [0.46, 0.8, 0.9],       // 我方出生区
  spawnE: [0.94, 0.48, 0.42],     // 敌方出生区
  edge: [0.42, 0.42, 0.44],       // 坝墙、边界构筑物
  dark: [0.07, 0.07, 0.08],       // 涵洞里面
};
export const LEGEND = [
  ['ground', '地面 / 土坡'], ['road', '街道 / 广场'], ['wall', '房屋体块'], ['floor2', '楼板 / 屋面 / 桥面'], ['run', '蹬墙跑墙面'], ['cover', '齐腰掩体'], ['cover2', '高掩体'],
  ['beam', '钩爪点'], ['stair', '楼梯 / 坡道 / 攀爬石'], ['river', '河床（低层）'], ['rock', '岩石 / 悬崖'], ['obj', '地标：古渡槽、钟楼'], ['spawnF', '我方出生区'], ['spawnE', '敌方出生区'],
];

// ====================== 地形 ======================
// 下面的坐标都是「南半边」（我方，+z）；北半边是它绕原点转 180°：(x, z) → (−x, −z)
const FLOOR = -4.2, WF = 7, PH = 0.6, SPH = 8.3;   // 河床高、河床半宽、渡槽广场高、出生区高
// 河道中线（本身中心对称），Catmull-Rom 加密成折线
const RIV_PTS = [[-112, 1], [-94, -1], [-80, -4], [-67, -9], [-55, -15], [-43, -19.5], [-32, -20.5], [-21, -15], [-10.5, -7.6], [0, 0], [10.5, 7.6], [21, 15], [32, 20.5], [43, 19.5], [55, 15], [67, 9], [80, 4], [94, 1], [112, -1]];
const RIV = polyline(new THREE.CatmullRomCurve3(RIV_PTS.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal').getSpacedPoints(448).map((v) => [v.x, v.z]));
// 战区边界（南半边那条链 + 转过来的北半边），外面是悬崖
const BOUND_S = [[75, 14], [73, 28], [70, 42], [65, 56], [58, 68], [48, 78], [35, 87], [20, 95], [4, 99], [-10, 96], [-22, 88], [-34, 82], [-48, 74], [-60, 63], [-69, 48], [-74, 32], [-77, 16], [-78, 5]];
export const BOUND = [...BOUND_S, ...BOUND_S.map(([x, z]) => [-x, -z])];
// 河岸类型（南岸，按最近河道点的 x）：返回岸坡宽度（米），−1 = 河滩台阶。北岸取 bankW(−x)
const bankW = (px) => {
  if (px < -70) return 2.8; if (px < -66) return lerp(2.8, 0.7, (px + 70) / 4); if (px < -13) return 0.7;   // 老城：竖直的石砌河堤
  if (px < 9) return -1;                                                                                    // 渡槽下：宽台阶
  if (px < 21) return 2.8; if (px < 25) return lerp(2.8, 8.5, (px - 21) / 4); if (px < 60) return 8.5;     // 小庙土丘下的陡岩 / 采石场的缓坡（机甲能下河）
  if (px < 64) return lerp(8.5, 2.8, (px - 60) / 4); return 2.8;
};
const noise = (x, z) => 0.35 * Math.cos(0.13 * x + 0.05 * z) * Math.cos(0.11 * z - 0.03 * x) + 0.25 * Math.sin(0.07 * x) * Math.sin(0.09 * z);
const HILLS = [{ x: -38, z: 35, r: 19, h: 2.8 }, { x: 13, z: 40, r0: 6, r: 15, h: 4.6 }, { x: 64, z: 34, r: 12, h: 2.5 }];
const hillAt = (x, z) => { let h = 0; for (const f of HILLS) { const d = Math.hypot(x - f.x, z - f.z); if (f.r0 !== undefined) h += f.h * (1 - smooth(f.r0, f.r, d)); else if (d < f.r) { const c = Math.cos(d / f.r * Math.PI / 2); h += f.h * c * c; } } return h; };
// 采石场：椭圆形的坑，坑底 −1.4，一圈 +1.2 的台阶（只在原地面比它高的地方出现）
const PIT = { x: 44, z: 56, rx: 17, rz: 13, a: 0.26, floor: -1.4, bench: 1.2 };
const pitQ = (x, z) => { const dx = x - PIT.x, dz = z - PIT.z, c = Math.cos(PIT.a), s = Math.sin(PIT.a); return Math.hypot((dx * c + dz * s) / PIT.rx, (-dx * s + dz * c) / PIT.rz); };
const pitCap = (x, z) => { const q = pitQ(x, z); if (q >= 0.95) return 1e9; if (q < 0.66) return PIT.floor; if (q < 0.71) return lerp(PIT.floor, PIT.bench, smooth(0.66, 0.71, q)); if (q < 0.88) return PIT.bench; return PIT.bench + (q - 0.88) / 0.07 * 18; };
// 街道（压平横截面、纵向顺滑）
const ROADS = [
  { k: 'M', pts: [[-1, 70], [-4, 61], [-3, 51], [-8, 41], [-12, 32], [-15, 25]], hw: 5, bl: 3.5 },                    // 主街：出生区北门 → 渡槽广场（机甲能走）
  { k: 'U', pts: [[-14, 79], [-25, 76], [-35, 69], [-42, 59], [-41, 47], [-39, 40]], hw: 2.8, bl: 2.5 },             // 上城巷：出生区西门 → 钟楼
  { k: 'A1', pts: [[-34, 31], [-30, 25], [-26, 18]], hw: 2.2, bl: 2 },                                              // 台阶巷：钟楼 → 广场
  { k: 'A2', pts: [[-43, 31], [-49, 24], [-50, 13], [-47, 4]], hw: 2.6, bl: 2.2 },                                  // 集市巷：钟楼 → 集市
  { k: 'A3', pts: [[-5, 52], [-14, 51], [-23, 47], [-32, 41]], hw: 2.0, bl: 2 },                                    // 横巷：主街 → 钟楼
  { k: 'Q', pts: [[-25, 5], [-31, -2], [-38, -5.5], [-45, -3]], hw: 3.2, bl: 2 },                                   // 河堤路
  { k: 'O', pts: [[-52, 1], [-60, 10], [-64, 24], [-61, 38], [-53, 48], [-44, 56]], hw: 2.6, bl: 2.2 },             // 外环巷：贴着西边悬崖
  { k: 'QR', pts: [[19, 75], [30, 76], [38, 71], [40, 62], [39, 52], [37, 42], [34, 33]], hw: 4.5, bl: 3 },         // 采石场车道：出生区东门 → 坑底 → 河岸（机甲能走）
  { k: 'SH', pts: [[-3, 44], [5, 43], [10, 41]], hw: 2, bl: 2 },                                                    // 上小庙的土路
];
// 压平的场地：出生区、广场、集市、钟楼前、小庙、可以进去的房子（auto = 按原地形取平均）
const SPAWN = [[-11, 72], [-3, 68], [11, 68], [19, 73], [21, 82], [15, 90], [1, 92], [-9, 88], [-14, 80]];
const PLAZA = [[-22.5, 4.7], [-3.1, 18.8], [-11.3, 30.1], [-30.7, 16.0]];
const PADS = [
  { k: 'spawn', poly: SPAWN, h: SPH, bl: 3, grow: 1.2 },
  { k: 'plaza', poly: PLAZA, h: PH, bl: 3 },
  { k: 'market', x: -45, z: -1, r: 8.5, h: 'auto', bl: 3 },
  { k: 'bell', x: -38, z: 36, r: 6.5, h: 'auto', bl: 3 },
  { k: 'shrine', x: 13, z: 40, r: 5.5, h: 'auto', bl: 2.5 },
];
// 可以进去的房子（南半边）：中心、正门朝向（世界方向）、宽、深、层数
const HOUSES = [
  { k: 'tea', name: '茶馆', x: -39, z: 18, dir: [0.35, -0.94], w: 10, d: 8, fl: 2 },
  { k: 'inn', name: '客栈', x: 8, z: 56, dir: [-1, 0.05], w: 12, d: 8, fl: 2 },
  { k: 'ware', name: '货栈', x: 4, z: 32, dir: [-0.8, -0.6], w: 14, d: 9, fl: 1, tall: 7 },
  { k: 'pump', name: '泵站', x: 24, z: 47, dir: [0.42, -0.91], w: 12, d: 8, fl: 2 },
];
for (const h of HOUSES) { h.a = angTo(h.dir[0], h.dir[1]); const F = frame(h.x, h.z, h.a); h.poly = [[-h.w / 2, -h.d / 2], [h.w / 2, -h.d / 2], [h.w / 2, h.d / 2], [-h.w / 2, h.d / 2]].map(([u, v]) => fw(F, u, v)); PADS.push({ k: 'house', poly: h.poly, h: 'auto', bl: 2.5, grow: 1.0, house: h }); }

const NR = {}, NQ = {};
const pre0 = (x, z) => { nearest(RIV, x, z, NR); let h = 8.2 * smooth(13, 84, NR.d) + noise(x, z) + hillAt(x, z) + hillAt(-x, -z); return Math.min(h, pitCap(x, z), pitCap(-x, -z)); };
const padW = (P, x, z) => (P.poly ? 1 - smooth(0, P.bl, polySD(P.poly, x, z) - (P.grow || 0)) : 1 - smooth(P.r, P.r + P.bl, Math.hypot(x - P.x, z - P.z)));
const inPad = (P, x, z, m = 0) => (P.poly ? polySD(P.poly, x, z) < (P.grow || 0) + m : Math.hypot(x - P.x, z - P.z) < P.r + m);
// 场地的 auto 高度：区域里原地形的平均
for (const P of PADS) if (P.h === 'auto') {
  let s = 0, n = 0; const bb = P.poly ? P.poly.reduce((b, [x, z]) => [Math.min(b[0], x), Math.min(b[1], z), Math.max(b[2], x), Math.max(b[3], z)], [1e9, 1e9, -1e9, -1e9]) : [P.x - P.r, P.z - P.r, P.x + P.r, P.z + P.r];
  for (let x = bb[0]; x <= bb[2]; x += 0.7) for (let z = bb[1]; z <= bb[3]; z += 0.7) if (inPad(P, x, z)) { s += pre0(x, z); n++; }
  P.h = n ? s / n + 0.05 : pre0(P.x, P.z);
}
const applyPads = (h, x, z, tag) => { for (const P of PADS) for (const [qx, qz, sg] of [[x, z, 1], [-x, -z, -1]]) { const w = padW(P, qx, qz); if (w > 0) { h = lerp(h, P.h, w); if (w > 0.6 && tag) { if (P.k === 'spawn') tag.spawn = sg; else if (P.k !== 'shrine') tag.road = true; } } } return h; };
// 街道的纵断面：沿中线取（含场地的）原地形，再滑动平均
for (const R of ROADS) {
  R.pl = polyline(R.pts); const n = Math.max(2, Math.ceil(R.pl.len)); const raw = [];
  for (let i = 0; i <= n; i++) { const p = along(R.pl, (i * R.pl.len) / n); raw.push(applyPads(pre0(p.x, p.z), p.x, p.z)); }
  const W = 6, prof = []; for (let i = 0; i <= n; i++) { let s = 0, c = 0; for (let j = Math.max(0, i - W); j <= Math.min(n, i + W); j++) { const wt = 1 - Math.abs(j - i) / (W + 1); s += raw[j] * wt; c += wt; } prof.push(s / c); }
  R.prof = prof; R.dt = R.pl.len / n; const b = R.pl.box, m = R.hw + R.bl + 0.5; R.bb = [b[0] - m, b[1] - m, b[2] + m, b[3] + m];
}
const roadH = (R, t) => { const f = t / R.dt, i = Math.min(R.prof.length - 2, Math.floor(f)), u = f - i; return lerp(R.prof[i], R.prof[i + 1], u); };
const applyRoads = (h, x, z, tag) => {
  for (const R of ROADS) for (const [qx, qz] of [[x, z], [-x, -z]]) {
    if (qx < R.bb[0] || qx > R.bb[2] || qz < R.bb[1] || qz > R.bb[3]) continue; nearest(R.pl, qx, qz, NQ);
    const w = 1 - smooth(R.hw, R.hw + R.bl, NQ.d); if (w > 0) { h = lerp(h, roadH(R, NQ.t), w); if (w > 0.6 && tag) tag.road = true; }
  }
  return h;
};
const river = (h, x, z, tag) => {
  nearest(RIV, x, z, NR); const a = NR.d; if (a > 20) return h; const w = bankW(NR.side > 0 ? NR.px : -NR.px);
  if (a < WF) { if (tag) tag.river = true; return FLOOR + 0.12 * Math.cos(0.4 * x) * Math.cos(0.33 * z); }
  if (w < 0) return a < 17 ? lerp(FLOOR, PH, (a - WF) / 10) - 0.12 : h;
  // 石砌河堤：地形在墙体内部（7.6–8.0 m）陡升，墙前后各留 1.4 m 以上，1 m 网格的斜三角不会从墙面戳出来
  const t = w < 1 ? smooth(7.6, 8.0, a) : smooth(WF, WF + w, a); if (t < 0.25 && tag) tag.river = true; return lerp(FLOOR, h, t);
};
const cliff = (h, x, z, tag) => {
  const d = polySD(BOUND, x, z); if (d < -0.3) return h; if (tag) tag.out = d;
  const k = 0.5 + 0.5 * Math.cos(0.19 * x + 0.07 * z) * Math.cos(0.15 * z - 0.05 * x);   // 有的地方是陡崖，有的地方是两级台地
  return h + 24 * smooth(-0.3, 4.5 + 3 * k, d) * (0.8 + 0.2 * Math.cos(0.21 * x) * Math.cos(0.17 * z)) + smooth(8, 16, d) * (6 + 4 * Math.cos(0.09 * x + 0.04 * z) * Math.cos(0.07 * z));
};
// 最终地形高度（tag 可选：顺便记下这一点是什么地面，给顶点上色用）
export const terrainH = (x, z, tag) => cliff(river(applyPads(applyRoads(pre0(x, z), x, z, tag), x, z, tag), x, z, tag), x, z, tag);
const tcol = (x, y, z, ny) => {
  const tag = {}; terrainH(x, z, tag);
  if ((tag.out || 0) > 0.6 || ny < 0.74) return COL.rock; if (tag.spawn) return tag.spawn > 0 ? COL.spawnF : COL.spawnE;
  if (tag.river) return COL.river; if (tag.road) return COL.road; return COL.ground;
};
// 区域里地形的最低 / 最高 / 平均
const hRange = (P, step = 1) => {
  let lo = 1e9, hi = -1e9, s = 0, n = 0; const xs = P.map((p) => p[0]), zs = P.map((p) => p[1]);
  const pts = [...P]; for (let x = Math.min(...xs); x <= Math.max(...xs); x += step) for (let z = Math.min(...zs); z <= Math.max(...zs); z += step) if (inPoly(P, x, z)) pts.push([x, z]);
  for (const [x, z] of pts) { const h = terrainH(x, z); lo = Math.min(lo, h); hi = Math.max(hi, h); s += h; n++; }
  return { lo, hi, mean: s / n };
};

// ====================== 街区：在抖动网格上撒点切 Voronoi，单元之间留窄巷（有的不留，连成一片），再被街道、河岸、场地、边界切掉 ======================
// 这样街面是连续的（房子的边贴着街走），巷子是斜的、宽窄不一，不会出现方格
const KEEP_C = [[13, 40, 9.5], [-38, 36, 7.8], [-12.9, 17.8, 6]];   // 小庙土丘、钟楼前、南塔（圆形禁区）
// 各处的房子密度：老城最密，主街东侧次之，采石场一带只有零星工棚
// 房子离河道中线至少多远：河滩台阶、采石场缓坡整段留空（机甲要从这里下河），石砌河堤后面留一条河堤路
const riverKeep = (px) => { const w = bankW(px); return w < 0 ? 18.6 : w > 4 ? 17 : 11.5; };
const density = (x, z) => {
  if (x < -9 && z < 80) return 0.97;
  if (x < 16 && z > 44 && z < 68) return 0.85;
  if (z > 66) return 0.45;
  if (x > 16) return pitQ(x, z) < 1.5 ? 0 : 0.3;
  return 0.55;
};
export function townCells() {
  const sp = 8.6, sites = [];
  for (let gz = -14, row = 0; gz <= 100; gz += sp * 0.87, row++) for (let gx = -82; gx <= 82; gx += sp) {
    const x = gx + (row % 2) * sp * 0.5 + (hash(gx * 1.3 + gz * 7.1) - 0.5) * sp * 0.6, z = gz + (hash(gx * 5.7 - gz * 2.9) - 0.5) * sp * 0.6; sites.push([x, z]);
  }
  const placed = HOUSES.map((h) => ({ P: h.poly, house: true })), out = [];
  const gapOf = (p, q) => { const h = hash(Math.round((p[0] + q[0]) * 7) * 0.13 + Math.round((p[1] + q[1]) * 7) * 0.71); return h < 0.38 ? 0.0 : 1.9 + h * 1.4; };
  // 先给每个点定性：能盖房子的（cand）/ 故意留空的（open，仍然参与切分，空地才留得住）/ 落在街上、河里、界外的（丢掉，邻居的街区长过来填满）
  const kind = sites.map(([x, z]) => {
    nearest(RIV, x, z, NR); if (NR.side < 0 || NR.d < riverKeep(NR.px) + 0.5) return 'x'; if (polySD(BOUND, x, z) > -2.5 || pitQ(x, z) < 1.15) return 'x';
    for (const R of ROADS) { nearest(R.pl, x, z, NQ); if (NQ.d < R.hw * 0.6) return 'x'; }
    for (const P2 of PADS) if (inPad(P2, x, z, -1.5)) return 'x';
    for (const [cx, cz, r] of KEEP_C) if (Math.hypot(x - cx, z - cz) < r * 0.7) return 'x';
    return hash(x * 0.71 + z * 1.37) > density(x, z) ? 'open' : 'cand';
  });
  const nb = sites.filter((q, i) => kind[i] !== 'x');
  for (let si = 0; si < sites.length; si++) {
    if (kind[si] !== 'cand') continue; const p = sites[si], [x, z] = p; nearest(RIV, x, z, NR);
    let P = [[x - 8.5, z - 8.5], [x + 8.5, z - 8.5], [x + 8.5, z + 8.5], [x - 8.5, z + 8.5]];
    const keepAway = (nx, nz, d) => { P = clipHalf(P, -nx, -nz, -d); };   // 保留 n·X ≥ d
    for (const q of nb) { if (q === p) continue; const dx = q[0] - x, dz = q[1] - z, l = Math.hypot(dx, dz); if (l > 19 || l < 0.01) continue; const nx = dx / l, nz = dz / l; P = clipHalf(P, nx, nz, nx * (x + q[0]) / 2 + nz * (z + q[1]) / 2 - gapOf(p, q) / 2); }
    // 街道：贴着街边切（线段两头按圆头切）
    let roadDir = null, rd = 1e9;
    for (const R of ROADS) for (const sg of R.pl.segs) {
      const ux = x - sg.ax, uz = z - sg.az, u = ux * sg.dx + uz * sg.dz, m = R.hw + 0.6;
      if (u >= 0 && u <= sg.L) { const px = sg.ax + sg.dx * u, pz = sg.az + sg.dz * u, d = Math.hypot(x - px, z - pz); if (d > m + 12) continue; const nx = (x - px) / d, nz = (z - pz) / d; keepAway(nx, nz, nx * px + nz * pz + m); if (d < rd) { rd = d; roadDir = [sg.dx, sg.dz]; } }
      else { const ex = u < 0 ? sg.ax : sg.ax + sg.dx * sg.L, ez = u < 0 ? sg.az : sg.az + sg.dz * sg.L, d = Math.hypot(x - ex, z - ez); if (d > m + 12) continue; const nx = (x - ex) / d, nz = (z - ez) / d; keepAway(nx, nz, nx * ex + nz * ez + m); }
    }
    // 河岸、场地、圆形禁区、边界、采石坑
    { const nx = x - NR.px, nz = z - NR.pz, l = Math.hypot(nx, nz); keepAway(nx / l, nz / l, (nx * NR.px + nz * NR.pz) / l + riverKeep(NR.px)); }
    // 单元跨过两种河岸的交界时，按每个顶点自己最近的那段河再切一次
    for (let it = 0; it < 2 && P.length > 2; it++) for (const v of [...P]) { nearest(RIV, v[0], v[1], NQ); const need = riverKeep(NQ.side > 0 ? NQ.px : -NQ.px); if (NQ.side > 0 && NQ.d >= need - 0.05) continue; const qx = x - NQ.px, qz = z - NQ.pz, l = Math.hypot(qx, qz); keepAway(qx / l, qz / l, (qx * NQ.px + qz * NQ.pz) / l + need); }
    for (const P2 of PADS) {
      if (P2.poly) { if (polySD(P2.poly, x, z) > 18) continue; let best = null, bd = -1e9; const [cx, cz] = centroid(P2.poly); for (let i = 0; i < P2.poly.length; i++) { const a = P2.poly[i], b = P2.poly[(i + 1) % P2.poly.length]; let nx = b[1] - a[1], nz = a[0] - b[0]; const l = Math.hypot(nx, nz); nx /= l; nz /= l; if ((a[0] - cx) * nx + (a[1] - cz) * nz < 0) { nx = -nx; nz = -nz; } const sd = (x - a[0]) * nx + (z - a[1]) * nz; if (sd > bd) { bd = sd; best = [nx, nz, a]; } } keepAway(best[0], best[1], best[0] * best[2][0] + best[1] * best[2][1] + (P2.grow || 0) + 1.2); }
      else { const dx = x - P2.x, dz = z - P2.z, l = Math.hypot(dx, dz); if (l > P2.r + 18) continue; keepAway(dx / l, dz / l, (dx * P2.x + dz * P2.z) / l + P2.r + 1.4); }
    }
    for (const [cx, cz, r] of KEEP_C) { const dx = x - cx, dz = z - cz, l = Math.hypot(dx, dz); if (l < r + 16) keepAway(dx / l, dz / l, (dx * cx + dz * cz) / l + r); }
    { const E = BOUND.map((a, i) => { const b = BOUND[(i + 1) % BOUND.length]; const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz); let u = ((x - a[0]) * dx + (z - a[1]) * dz) / (L * L); u = Math.max(0, Math.min(1, u)); return [Math.hypot(a[0] + dx * u - x, a[1] + dz * u - z), a, dx / L, dz / L]; }).sort((m, n) => m[0] - n[0]);
      for (const [, a, tx, tz] of E.slice(0, 2)) { let nx = -tz, nz = tx; if ((x - a[0]) * nx + (z - a[1]) * nz < 0) { nx = -nx; nz = -nz; } keepAway(nx, nz, nx * a[0] + nz * a[1] + 2.0); } }
    { const q = pitQ(x, z); if (q < 1.8) { const dx = x - PIT.x, dz = z - PIT.z, l = Math.hypot(dx, dz); keepAway(dx / l, dz / l, (dx * PIT.x + dz * PIT.z) / l + l / q * 1.08); } }
    if (P.length < 3) continue; const A = Math.abs(area2(P)); let per = 0; for (let i = 0; i < P.length; i++) per += Math.hypot(P[(i + 1) % P.length][0] - P[i][0], P[(i + 1) % P.length][1] - P[i][1]);
    if (A < 14 || A / per < 0.9) continue;
    if (placed.some((Q) => Q.house && polyHit(P, Q.P, 1.2))) continue;
    const [cx, cz] = centroid(P); const rdir = roadDir || [1, 0]; const a = Math.atan2(-rdir[1], rdir[0]);
    const hf = hash(cx * 0.91 + cz * 0.33); const fl = x < -9 ? (hf < 0.42 ? 2 : 1) : (hf < 0.25 ? 2 : 1);
    const b = { P, x: cx, z: cz, a, fl, o: A > 55 && hash(cx + cz * 3.3) < 0.4 && rd < 14 ? { t: 0 } : {} };
    placed.push(b); out.push(b);
  }
  return out;
}

// ====================== 搭建 ======================
export function buildGorge(B, K) {
  const O = createBlockout(B, COL);
  const L = {
    name: GORGE_NAME, proto: true, colors: COL, legend: LEGEND,
    playerSpawn: { x: 4, y: SPH + 0.1, z: 71, yaw: 0 },   // 北门里、影壁前：一进图就能顺着门洞看到主街
    friendlyPods: [], enemyPods: [], mechDrops: [], nests: [], zones: null, combatPoints: [], respawns: [],
    ziplines: [], shafts: [], smokes: [], flyover: [], dustVolumes: [], labels: [],
    oob: { x0: -79, x1: 79, z0: -100, z1: 100, y0: -10, poly: BOUND },
    droneSpawn: { x0: -24, x1: 16, z: -80 },
  };
  const blocks = townCells(); L.stats = { blocks: blocks.length };

  // ---------- 地形：战区里 1 m 网格，悬崖外圈稀一点的采样也够；再外面是只渲染的远景 ----------
  const RX = 102, RZ = 124;
  O.terrain(terrainH, -RX, -RZ, RX, RZ, 1, 24, tcol, { skip: (x0, z0, x1, z1) => polySD(BOUND, (x0 + x1) / 2, (z0 + z1) / 2) > 30 });
  O.terrain(terrainH, -RX, -RZ, RX, RZ, 4, 6, tcol, { skip: (x0, z0, x1, z1) => polySD(BOUND, (x0 + x1) / 2, (z0 + z1) / 2) <= 30, rays: 6 });
  for (const [x0, z0, x1, z1] of [[-700, -700, 700, -RZ], [-700, RZ, 700, 700], [-700, -RZ, -RX, RZ], [RX, -RZ, 700, RZ]]) O.farTerrain(terrainH, x0, z0, x1, z1, 24, () => COL.rock);
  {
    const { rr } = K;
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * 6.28 + rr(-0.15, 0.15), dd = rr(420, 600), x = Math.cos(a) * dd, z = Math.sin(a) * dd, r = rr(50, 110), h = rr(60, 120); let y = 20, rad = r;
      for (let k = 0; k < 3; k++) { const hh = h * [0.42, 0.33, 0.25][k]; let gg = new THREE.CylinderGeometry(rad * rr(0.78, 0.9), rad, hh, 11, 2); gg = gg.toNonIndexed(); gg.computeVertexNormals(); B.addGeo('rock', gg, M4(x, y + hh / 2, z, 0, k * 0.7, 0), { uv: 'world', ts: 40, rays: 0, c: [0.92, 0.8, 0.7] }); y += hh; rad *= rr(0.6, 0.78); }
    }
  }

  // 河道上的点：南岸按 x 找最近的河道点，返回点、切向、朝南的法向
  const rivAt = (x) => { let best = null, bd = 1e9; for (const p of RIV.pts) { const d = Math.abs(p[0] - x); if (d < bd) { bd = d; best = p; } } nearest(RIV, best[0], best[1], NR); const tx = NR.tx, tz = NR.tz; return { x: NR.px, z: NR.pz, tx, tz, nx: -tz, nz: tx }; };
  // 本地 +x 沿 (dx, dz) 的帧
  const axisFrame = (x, z, dx, dz) => frame(x, z, Math.atan2(-dz, dx));

  // ====================== 半边（南半边写一遍，北半边绕原点转 180°）======================
  for (const sg of [1, -1]) {
    const S = (x, z) => (sg > 0 ? [x, z] : [-x, -z]);
    const Fr = (F) => (sg > 0 ? F : frame(-F.x, -F.z, F.a + Math.PI));
    const SP = (P) => P.map(([x, z]) => S(x, z));
    const nm = (t) => (sg > 0 ? t : t.replace(/南/g, '\u0001').replace(/北/g, '南').replace(/\u0001/g, '北').replace(/西/g, '\u0002').replace(/东/g, '西').replace(/\u0002/g, '东').replace(/我方/g, '敌方'));
    const label = (t, x, y, z, o = {}) => { const [wx, wz] = S(x, z); L.labels.push({ text: nm(t), x: wx, y: y === null ? terrainH(x, z) + (o.up || 3.2) : y, z: wz, ...o }); };
    const lamp = (F, lx, y, lz, power = 30, radius = 11) => { const G = Fr(F); O.box('wall', G, lx - 0.4, y - 0.08, lz - 0.14, lx + 0.4, y, lz + 0.14, { collide: false, rays: 0, bottom: true }); const [x, z] = fw(G, lx, lz); B.box('emissive', x - 0.35, y - 0.1, z - 0.1, x + 0.35, y - 0.08, z + 0.1, { c: [1.5, 1.42, 1.25], collide: false, rays: 0, bottom: true }); B.light(x, y - 0.4, z, [1.0, 0.86, 0.66], power, radius); };
    const prism = (kind, P, y0, y1, o) => O.prism(kind, SP(P), y0, y1, { mech: true, ...o });
    const zip = (a, b) => { const A = [...S(a[0], a[2])], Bq = [...S(b[0], b[2])]; const pa = [A[0], a[1], A[1]], pb = [Bq[0], b[1], Bq[1]]; K.cable(pa, pb, 0.5, 0.03); L.ziplines.push({ a: pa, b: pb }); for (const p of [pa, pb]) K.tube('steel', [p[0], p[1] - 2.3, p[2]], [p[0], p[1] + 0.15, p[2]], 0.05); };

    // 可以进去的房子：帧 F 本地 +z 是正门；w × d，fl 层（每层 4 m），y0 地面
    const house = (F, w, d, fl, y0, o = {}) => {
      const t = 0.35, FH = o.tall || 4, hw = w / 2, hd = d / 2, top = y0 + fl * FH, k = o.kind || 'wall';
      const door = (c, wd = 2.2) => [c, wd, 0, 2.7], win = (c, f = 0, wd = 1.4) => [c, wd, f * FH + 1.15, f * FH + 2.45];
      const up = (xs) => (fl > 1 ? xs.map((c) => win(c, 1)) : []);
      O.wall(k, F, -hw, hd - t / 2, hw, hd - t / 2, y0, top, t, o.front || [door(hw), win(1.8), win(w - 1.8), ...up([1.6, hw, w - 1.6])]);
      O.wall(o.backKind || k, F, hw, -hd + t / 2, -hw, -hd + t / 2, y0, top, t, o.back || [door(w * 0.3, 1.8), win(w * 0.75), ...up([1.8, w - 1.8])]);
      O.wall(k, F, -hw + t / 2, -hd + t, -hw + t / 2, hd - t, y0, top, t, o.left || [win(d / 2 - t), ...up([d / 2 - t])]);
      O.wall(k, F, hw - t / 2, hd - t, hw - t / 2, -hd + t, y0, top, t, o.right || [door(d / 2 - t, 1.8), ...up([d / 2 - t])]);
      if (fl > 1) {
        const run = Math.min(6, w - 1.8), sx0 = -hw + t + 0.15, zc = -hd + t + 0.6, y = y0 + FH;
        O.stairs('stair', sub(F, sx0, zc, 1, 0), 0, 0, y0, FH, run, 1.2);
        O.box('floor2', F, -hw + t, y - 0.3, -hd + t + 1.2, hw - t, y, hd - t, { bottom: true });
        O.box('floor2', F, sx0 + run, y - 0.3, -hd + t, hw - t, y, -hd + t + 1.2, { bottom: true });
        O.box('cover', F, sx0 + 1.4, y, -hd + t + 1.15, sx0 + run, y + 1.0, -hd + t + 1.35);
      }
      O.box('floor2', F, -hw, top, -hd, hw, top + 0.3, hd, { bottom: true });
      if (o.parapet !== false) { O.box('cover', F, -hw, top + 0.3, hd - 0.3, hw, top + 1.0, hd); O.box('cover', F, -hw, top + 0.3, -hd, -hw + 0.3, top + 1.0, hd - 0.3); }
      return top + 0.3;
    };
    // 塔里沿四面墙盘上去的楼梯：内净空 [−e, e]²，梯段宽 w，从 y0 到 y1，从 (−e, −e) 角出发沿本地 +z 走。顶层楼板留出最后两段梯子的位置
    const spiral = (F, e, w, y0, y1) => {
      const Lf = 2 * e - 2 * w, n = Math.ceil((y1 - y0) / (Lf * 0.62)), r = (y1 - y0) / n; const C = [[-e, -e], [-e, e], [e, e], [e, -e]];
      for (let i = 0; i < n; i++) {
        const a = C[i % 4], b = C[(i + 1) % 4]; const ux = Math.sign(b[0] - a[0]), uz = Math.sign(b[1] - a[1]); const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2, ml = Math.hypot(mx, mz); const vx = -mx / ml, vz = -mz / ml;
        O.stairs('stair', sub(F, a[0] + ux * w + vx * w / 2, a[1] + uz * w + vz * w / 2, ux, uz), 0, 0, y0 + r * i, r, Lf, w, { solid: false });
        const yl = y0 + r * (i + 1), c0 = [b[0] - ux * w, b[1] - uz * w], c1 = [b[0] + vx * w, b[1] + vz * w];
        if (i < n - 1) O.box('stair', F, Math.min(c0[0], c1[0], b[0]), yl - 0.25, Math.min(c0[1], c1[1], b[1]), Math.max(c0[0], c1[0], b[0]), yl, Math.max(c0[1], c1[1], b[1]), { bottom: true });
      }
      let x0 = -e, x1 = e, z0 = -e, z1 = e; for (const i of [n - 1, n - 2]) { const s = ((i % 4) + 4) % 4; if (s === 0) x0 = -e + w; if (s === 1) z1 = e - w; if (s === 2) x1 = e - w; if (s === 3) z0 = -e + w; }
      O.box('floor2', F, x0, y1 - 0.3, z0, x1, y1, z1, { bottom: true });
      const b = C[n % 4]; const s = Math.sign(b[0]), q = Math.sign(b[1]); O.box('floor2', F, b[0], y1 - 0.3, b[1], b[0] - s * w, y1, b[1] - q * w, { bottom: true });
      return { n, r };
    };
    // 方塔：外边长 2(e+t)，中心在帧原点；holes[side] = 墙上的洞（side 0 左 −x / 1 前 +z / 2 右 +x / 3 后 −z）
    const towerShell = (kind, F, e, t, y0, y1, holes = {}) => {
      const E = e + t;
      O.wall(kind, F, -E + t / 2, -E, -E + t / 2, E, y0, y1, t, holes[0] || []);
      O.wall(kind, F, -E + t, E - t / 2, E - t, E - t / 2, y0, y1, t, holes[1] || []);
      O.wall(kind, F, E - t / 2, E, E - t / 2, -E, y0, y1, t, holes[2] || []);
      O.wall(kind, F, E - t, -E + t / 2, -E + t, -E + t / 2, y0, y1, t, holes[3] || []);
    };

    // ---------- 出生区：高台上的营地，三个出口（北门 → 主街，西门 → 上城巷，东门 → 采石场车道）----------
    {
      const P = SPAWN, n = P.length; const y0 = SPH - 0.6, y1 = SPH + 4.5;
      const gates = { 1: [7, 6.5], 8: [4.3, 3.4], 3: [4.6, 4.2] };   // 边序号 → [沿边距离, 宽]
      for (let i = 0; i < n; i++) {
        const [ax, az] = S(...P[i]), [bx, bz] = S(...P[(i + 1) % n]); const g = gates[i];
        O.wall('wall', frame(0, 0, 0), ax, az, bx, bz, y0, y1, 0.8, g ? [[g[0], g[1], 0, 3.8]] : []);
      }
      // 三个门里各一道影壁：挡住从外面直看进营地的视线
      prism('wall', [[-1, 73.5], [9.5, 73.5], [9.5, 74.3], [-1, 74.3]], y0, SPH + 3.2);
      for (const [gx, gz] of [[-12.5, 76], [20, 77.5]]) { const dx = 3 - gx, dz = 80 - gz, l = Math.hypot(dx, dz), ux = dx / l, uz = dz / l, cx = gx + ux * 5, cz = gz + uz * 5, tx = -uz, tz = ux;
        prism('wall', [[cx - tx * 3.8 - ux * 0.4, cz - tz * 3.8 - uz * 0.4], [cx + tx * 3.8 - ux * 0.4, cz + tz * 3.8 - uz * 0.4], [cx + tx * 3.8 + ux * 0.4, cz + tz * 3.8 + uz * 0.4], [cx - tx * 3.8 + ux * 0.4, cz - tz * 3.8 + uz * 0.4]], y0, SPH + 3.2); }
      // 营地后半截的顶棚（钟楼、渡槽塔看不到棚下）
      const Fs = Fr(frame(3, 85, 0)); O.box('floor2', Fs, -10, SPH + 4.3, -3.5, 10, SPH + 4.7, 4, { bottom: true });
      for (const lx of [-9.6, 9.2]) for (const lz of [-3.1, 3.2]) O.box('beam', Fs, lx, SPH, lz, lx + 0.4, SPH + 4.3, lz + 0.4);
      lamp(frame(3, 85, 0), -5, SPH + 4.25, 0, 22, 9); lamp(frame(3, 85, 0), 5, SPH + 4.25, 0, 22, 9);
      prism('cover', [[-7, 76], [-3.5, 76], [-3.5, 77], [-7, 77]], SPH - 0.2, SPH + 1.1); prism('cover', [[10, 77], [13.5, 78], [13.2, 79], [9.8, 78]], SPH - 0.2, SPH + 1.1);
      label('我方营地（出生区）', 3, SPH + 6.6, 82);
    }

    // ---------- 河道：老城段的石砌河堤（竖直，蓝色 = 能蹬墙跑），渡槽下的宽台阶，台阶两端的挡墙 ----------
    {
      const quay = []; for (const p of RIV.pts) { if (p[0] < -66 || p[0] > -13) continue; nearest(RIV, p[0], p[1], NR); quay.push([NR.px - NR.tz * 7.8, NR.pz + NR.tx * 7.8, NR.px - NR.tz * 9.9, NR.pz + NR.tx * 9.9]); }
      const pts = []; for (let i = 0; i < quay.length; i += 5) pts.push(quay[i]); if (pts[pts.length - 1] !== quay[quay.length - 1]) pts.push(quay[quay.length - 1]);
      const topAt = (x, z) => { let best = pts[0], bd = 1e9; for (const q of pts) { const d = Math.hypot(q[0] - x, q[1] - z); if (d < bd) { bd = d; best = q; } } return terrainH(best[2], best[3]) + 0.02; };
      O.wallPath('run', SP(pts.map((q) => [q[0], q[1]])), FLOOR - 0.4, (x, z) => topAt(...S(x, z)), 3.2, { mech: true, ext: 1.0 });
      // 河堤上一段一段的矮墙（齐腰掩体），中间留缺口
      for (let i = 2; i < pts.length - 2; i += 3) {
        const a = pts[i], b = pts[i + 1]; const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz); const nx = -dz / l * 0.5, nz = dx / l * 0.5; const y = topAt(a[0], a[1]);
        prism('cover', [[a[0] + nx, a[1] + nz], [b[0] + nx, b[1] + nz], [b[0] + nx * 1.6, b[1] + nz * 1.6], [a[0] + nx * 1.6, a[1] + nz * 1.6]], y - 0.3, y + 1.0);
      }
      // 河堤上下河床的梯子（贴着河堤，在河床一侧）
      for (const px of [-30, -55]) {
        const r = rivAt(px); const F = Fr(axisFrame(r.x + r.nx * 5.15, r.z + r.nz * 5.15, r.tx, r.tz)); const top = terrainH(r.x + r.nx * 9.9, r.z + r.nz * 9.9);
        O.stairs('stair', sub(F, 0, 0, -1, 0), 0, 0, FLOOR, top - FLOOR, (top - FLOOR) / 0.62, 1.8);
      }
      // 宽台阶（渡槽下，−13 ≤ x ≤ 9）
      const r = rivAt(-2), G = Fr(frame(r.x, r.z, angTo(r.nx, r.nz)));
      O.stairs('stair', G, 0, 7, FLOOR, PH - FLOOR, 10, 22);
      for (const lx of [-11, 11]) O.box('wall', G, lx - 0.6, FLOOR - 0.4, 6.4, lx + 0.6, PH + 1.0, 17.6, { mech: true });
      O.box('cover', G, 5.2, PH - 0.2, 17.1, 10.4, PH + 1.0, 17.6);   // 台阶顶上的矮墙只在东半边：西半边整段敞开，是机甲从广场下河的路
      { const [x, z] = fw(frame(r.x, r.z, angTo(r.nx, r.nz)), 0, 12); label('河滩台阶', x, PH + 1.4, z); }
    }

    // ---------- 古渡槽：南塔 → 断口（中段塌了）→ 北塔。槽顶 +9.5，墩子之间是拱 ----------
    {
      const t = [10.5, 7.6], tl = Math.hypot(...t), dx = t[1] / tl, dz = -t[0] / tl;    // 渡槽方向（南 → 北）：垂直于中段河道
      const A = Fr(axisFrame(0, 0, dx, dz)), D = 4.4, DECK = 9.5;
      // 墩子（蓝色：蹬墙跑）、拱上墙
      for (const k of [-8, -15]) O.box('run', A, k - 1, FLOOR - 0.4, -D / 2, k + 1, DECK - 0.8, D / 2, { mech: true });
      O.extrude('obj', A, [...O.arc(-11.5, 2.5, 3.0), [-9, DECK - 0.8], [-14, DECK - 0.8]], D);
      O.extrude('obj', A, [...O.arc(-17.25, 1.25, 2.6), [-16, DECK - 0.8], [-18.5, DECK - 0.8]], D);   // 南塔和墩子之间的小拱：广场上的人从这里钻过渡槽
      // 中间的大拱只剩靠岸的半截（断口在 |k| < 2.4）
      const g = Math.acos(-2.4 / 7); const arcL = []; for (let i = 0; i <= 12; i++) { const a = Math.PI + (g - Math.PI) * i / 12; arcL.push([7 * Math.cos(a), 0.5 + 7 * Math.sin(a)]); }
      O.extrude('obj', A, [...arcL, [-2.4, DECK - 0.8], [-7, DECK - 0.8]], D);
      // 槽身：槽底（走人）+ 两边 1.1 m 的槽壁（齐腰掩体）
      O.box('obj', A, -18.5, DECK - 0.8, -D / 2, -2.4, DECK, D / 2, { bottom: true, mech: false });
      for (const s of [-1, 1]) O.box('cover', A, -18.5, DECK, s > 0 ? D / 2 - 0.5 : -D / 2, -2.4, DECK + 1.1, s > 0 ? D / 2 : -D / 2 + 0.5);
      // 断口处的碎块
      for (let i = 0; i < 4; i++) { const [x, z] = fw(A, -2.6 - hash(i + sg) * 0.6, (hash(i * 3 + 1) - 0.5) * 3.4); O.rock(x, DECK - 0.4 + hash(i + 7) * 0.5, z, 0.5, 0.35, 0.45, i, i + sg * 11, { kind: 'obj', collide: false }); }
      // 塌下来的一截槽身斜躺在河床里（掩体）
      { const [x, z] = fw(A, -1.2, 3.6); const G = frame(x, z, A.a + 0.5); const P3 = [[-3.2, FLOOR + 0.2, -1.9], [3.2, FLOOR + 2.4, -1.9], [3.2, FLOOR + 2.4, 1.9], [-3.2, FLOOR + 0.2, 1.9]].map(([u, y, v]) => { const [wx, wz] = fw(G, u, v); return [wx, y, wz]; }); O.slab('obj', P3, FLOOR - 0.2, { mech: true }); }
      // 南塔：7 × 7，地面 → 槽顶的盘梯，槽顶高度开门上渡槽，屋顶 +13.5（从槽壁二段跳 + 攀上去）
      const T = sub(A, -22, 0, 1, 0), y0 = PH, e = 3.1, top = 13.5;
      towerShell('obj', T, e, 0.4, y0, top, {
        0: [[3.5, 1.0, 1.4, 2.6], [3.5, 1.0, 9.6, 10.8]], 1: [[3.1, 1.8, DECK - y0, DECK - y0 + 2.4], [0.6, 1.0, 3.0, 4.2], [5.6, 1.0, 5.2, 6.4]],
        2: [[3.5, 1.6, 0, 2.6], [5.8, 1.0, 7.4, 8.6]], 3: [[1.5, 1.4, 0, 2.6], [3.1, 1.0, 9.8, 11.0]],
      });
      spiral(T, e, 1.2, y0, DECK);
      O.box('floor2', T, -e - 0.4, top, -e - 0.4, e + 0.4, top + 0.35, e + 0.4, { bottom: true });
      for (const [a0, b0] of [[-3.5, -2.3], [-0.6, 0.6], [2.3, 3.5]]) for (const s of [-1, 1]) { O.box('cover', T, a0, top + 0.35, s > 0 ? 3.1 : -3.5, b0, top + 1.3, s > 0 ? 3.5 : -3.1); O.box('cover', T, s > 0 ? 3.1 : -3.5, top + 0.35, a0, s > 0 ? 3.5 : -3.1, top + 1.3, b0); }
      lamp(sub(A, -22, 0, 1, 0), 0, DECK - 0.35, 0, 22, 8);
      const [lx, lz] = fw(A, -22, 0); L.labels.push({ text: nm('南塔'), x: lx, y: top + 2.4, z: lz });
      if (sg > 0) L.labels.push({ text: '古渡槽 · 断口', x: 0, y: DECK + 3.2, z: 0, big: true });
    }

    // ---------- 渡槽广场：南塔脚下的不规则广场，北面是台阶下河 ----------
    {
      prism('cover', [[-24, 21], [-21.5, 21.5], [-21.8, 22.5], [-24.3, 22]], PH - 0.2, PH + 1.1);
      prism('cover2', [[-7, 23], [-4.2, 24.6], [-5.2, 26.4], [-8, 24.8]], PH - 0.2, PH + 2.2);
      prism('cover', [[-8.6, 17.6], [-6.2, 19.4], [-6.8, 20.2], [-9.2, 18.4]], PH - 0.2, PH + 1.1);
      // 老井：圆形矮墙
      { const [wx, wz] = S(-8.8, 23.3); K.cyl('proto', wx, PH - 0.2, wz, 1.3, 1.25, { c: COL.cover, collide: true, seg: 14, ts: 4, rays: 12 }); }
      label('渡槽广场', -16, PH + 4.2, 19);
    }

    // ---------- 钟楼：老城山包顶上，盘梯上到 +11 的钟层（四面开大窗），全图最高的人能站的地方 ----------
    {
      const P = PADS.find((p) => p.k === 'bell'); const y0 = P.h, F = Fr(frame(-37.5, 37.5, angTo(0.55, -0.83))), e = 2.4, t = 0.4, top = y0 + 11;
      towerShell('obj', F, e, t, y0, top + 3.6, {
        1: [[e, 2.2, 11, 13.6], [e, 0.9, 6.0, 7.2]], 3: [[e, 1.4, 0, 2.6], [e, 2.2, 11, 13.6]], 0: [[e + t, 2.2, 11, 13.6], [e + t, 0.9, 7.5, 8.7]], 2: [[e + t, 2.2, 11, 13.6], [e + t, 0.9, 3, 4.2]],
      });
      spiral(F, e, 1.1, y0, top);
      O.box('floor2', F, -e - t - 0.2, top + 3.6, -e - t - 0.2, e + t + 0.2, top + 4.0, e + t + 0.2, { bottom: true });
      O.box('obj', F, -1.2, top + 4.0, -1.2, 1.2, top + 6.5, 1.2);
      lamp(F, 0, top + 3.55, 0, 20, 8);
      const [x, z] = fw(F, 0, 0); L.labels.push({ text: nm('钟楼 · 钟层 11 m'), x, y: top + 8, z, big: sg > 0 });
      // 钟楼前的小广场：几块掩体
      prism('cover', [[-43, 39], [-41, 40.5], [-41.6, 41.3], [-43.6, 39.8]], y0 - 0.2, y0 + 1.1);
      prism('cover2', [[-33.5, 39.5], [-31.8, 40.2], [-32.6, 42], [-34.3, 41.3]], y0 - 0.2, y0 + 1.9);
    }

    // ---------- 老城体块：不规则多边形的房子，有的中间穿一条拱道；两层的屋顶有女儿墙 ----------
    for (const b of blocks) {
      const P = b.P; const r = hRange(P, 1.2); const hh = b.fl > 1 ? 8.0 : 4.2; const top = Math.max(r.hi + 2.6, terrainH(b.x, b.z) + hh), y0 = r.lo - 0.5;
      if (b.o.t !== undefined) {
        const ang = b.a + (b.o.t ? Math.PI / 2 : 0); const dx = Math.sin(ang), dz = Math.cos(ang); const mx = -dz, mz = dx; const c = b.x * mx + b.z * mz, hw = 1.4;
        const left = clipHalf(P, mx, mz, c - hw), right = clipHalf(P, -mx, -mz, -(c + hw)), mid = clipHalf(clipHalf(P, mx, mz, c + hw), -mx, -mz, -(c - hw));
        let th = -1e9; for (let u = -12; u <= 12; u += 1) { const x = b.x + dx * u, z = b.z + dz * u; if (inPoly(P, x, z)) th = Math.max(th, terrainH(x, z)); }
        if (left.length > 2) prism('wall', left, y0, top); if (right.length > 2) prism('wall', right, y0, top); if (mid.length > 2) prism('wall', mid, th + 3.0, top, { bottom: true });
      } else if (hash(b.x * 1.3 + b.z * 0.7) < 0.55 && Math.abs(area2(P)) > 28) {
        // 高低错落：沿本地 x 切一刀，一半高一层（或矮一层），屋顶之间是能攀上去的台阶
        const ux = Math.cos(b.a), uz = -Math.sin(b.a), c = b.x * ux + b.z * uz + (hash(b.z * 2.1) - 0.5) * 2.4;
        const A = clipHalf(P, ux, uz, c), Bp = clipHalf(P, -ux, -uz, -c); const other = b.fl > 1 ? top - 3.8 : top + 3.8;
        if (A.length > 2) prism('wall', A, y0, hash(b.x) < 0.5 ? top : other); if (Bp.length > 2) prism('wall', Bp, y0, hash(b.x) < 0.5 ? other : top);
      } else prism('wall', P, y0, top);
      if (b.fl > 1) for (let i = 0; i < P.length; i++) {
        const a = P[i], q = P[(i + 1) % P.length]; const l = Math.hypot(q[0] - a[0], q[1] - a[1]); if (l < 3.5 || hash(i + b.x) < 0.45) continue;
        const [cx, cz] = centroid(P); let nx = -(q[1] - a[1]) / l, nz = (q[0] - a[0]) / l; if ((a[0] - cx) * nx + (a[1] - cz) * nz < 0) { nx = -nx; nz = -nz; }
        prism('cover', [a, q, [q[0] - nx * 0.35, q[1] - nz * 0.35], [a[0] - nx * 0.35, a[1] - nz * 0.35]], top, top + 0.8);
      }
    }

    // ---------- 可以进去的房子 ----------
    for (const h of HOUSES) {
      const P = PADS.find((p) => p.house === h); const F = Fr(frame(h.x, h.z, h.a));
      const roof = house(F, h.w, h.d, h.fl, P.h, { tall: h.tall, kind: h.k === 'pump' || h.k === 'ware' ? 'cover2' : 'wall' });
      const [x, z] = fw(F, 0, 0); L.labels.push({ text: nm(h.name), x, y: roof + 2, z }); h.roof = roof; h.floor = P.h;
      lamp(frame(h.x, h.z, h.a), 0, P.h + (h.tall || 4) - 0.35, 0, 24, 8); if (h.fl > 1) lamp(frame(h.x, h.z, h.a), 0, P.h + 7.65, 0, 22, 8);
    }
    // 货栈里：货箱和半层的夹层（从箱子攀上去）
    {
      const h = HOUSES.find((q) => q.k === 'ware'), F = Fr(frame(h.x, h.z, h.a)), y = h.floor;
      O.box('cover2', F, -4.5, y, -1.5, -2, y + 2.4, 1.5); O.box('cover2', F, 1, y, 0, 3.5, y + 1.6, 2.6); O.box('cover', F, -1, y, -3.5, 1.6, y + 1.1, -2.6);
      O.box('floor2', F, 3.6, y + 3.2, -4.15, 6.65, y + 3.5, 4.15, { bottom: true }); O.box('cover', F, 3.6, y + 3.5, -4.15, 3.9, y + 4.4, 4.15);
      O.box('stair', F, 2.2, y, -3.9, 3.6, y + 1.7, -2.6);
    }
    // 泵站：一根粗水管从泵站伸进河里（顶上能走，钩爪能挂）
    {
      const r = rivAt(26); const a0 = [r.x + r.nx * 16, r.z + r.nz * 16], a1 = [r.x + r.nx * 2, r.z + r.nz * 2]; const y = 2.4;
      const [p0x, p0z] = S(...a0), [p1x, p1z] = S(...a1); K.tube('proto', [p0x, y, p0z], [p1x, y - 3.2, p1z], 0.9, { c: COL.beam, collide: true });
      for (const f of [0.25, 0.6]) { const x = lerp(a0[0], a1[0], f), z = lerp(a0[1], a1[1], f); const [wx, wz] = S(x, z); B.box('proto', wx - 0.3, terrainH(wx, wz) - 0.5, wz - 0.3, wx + 0.3, y - f * 3.2 - 0.8, wz + 0.3, { c: COL.beam }); }
    }

    // ---------- 西桥：老城河堤 → 对岸采石场的缓坡，三孔石桥（桥下人能钻过去，机甲走桥面）----------
    {
      const r = rivAt(-45); const F = Fr(axisFrame(r.x, r.z, r.nx, r.nz)); const gN = terrainH(r.x - r.nx * 17, r.z - r.nz * 17), gS = terrainH(r.x + r.nx * 9.5, r.z + r.nz * 9.5);
      const yd = 1.0, W = 7;
      const outer = [[-17.5, FLOOR - 0.6], [9.8, FLOOR - 0.6], [9.8, gS - 0.05], [7, yd], [-13.5, yd], [-17.5, gN - 0.05]];
      const sh = new THREE.Shape(); sh.moveTo(...outer[0]); for (const p of outer.slice(1)) sh.lineTo(...p); sh.closePath();
      const hole = (pts) => { const h = new THREE.Path(); h.moveTo(...pts[0]); for (const p of pts.slice(1)) h.lineTo(...p); h.closePath(); sh.holes.push(h); };
      hole([[-3.2, FLOOR - 0.5], [3.2, FLOOR - 0.5], ...O.arc(0, 3.2, -3.0, 0, Math.PI, 12)]);
      hole([[-12, FLOOR - 0.5], [-4.8, FLOOR - 0.5], ...O.arc(-8.4, 3.6, -3.4, 0, Math.PI, 12)]);
      const g = new THREE.ExtrudeGeometry(sh, { depth: W, bevelEnabled: false, curveSegments: 1 }); g.translate(0, 0, -W / 2);
      B.addGeo('proto', g, M4(F.x, 0, F.z, 0, F.a, 0), { c: COL.floor2, uv: 'world', ts: 4, collide: true, mech: true, rays: 20 });
      for (const s of [-1, 1]) for (const [a, b] of [[-13, -6], [-4, 3], [5, 7.5]]) O.box('cover', F, a, yd, s > 0 ? W / 2 - 0.45 : -W / 2, b, yd + 0.95, s > 0 ? W / 2 : -W / 2 + 0.45);
      lamp(axisFrame(r.x, r.z, r.nx, r.nz), 0, -0.05, 0, 24, 9);
      label('西桥', r.x, 3.4, r.z);
    }

    // ---------- 集市：河堤路尽头的小广场，几个摊棚（棚顶能跳上去）----------
    {
      const y = PADS.find((p) => p.k === 'market').h;
      for (const [x, z, a] of [[-45, 3, 0.3], [-40.5, 0.5, -0.4], [-48.5, -2, 0.9]]) {
        const F = Fr(frame(x, z, a)); for (const [u, v] of [[-1.4, -1.1], [1.4, -1.1], [-1.4, 1.1], [1.4, 1.1]]) O.box('beam', F, u - 0.08, y, v - 0.08, u + 0.08, y + 2.6, v + 0.08);
        O.box('floor2', F, -1.6, y + 2.6, -1.3, 1.6, y + 2.8, 1.3, { bottom: true }); O.box('cover', F, -1.2, y, -0.4, 1.2, y + 0.95, 0.4);
      }
      prism('cover2', [[-42, -6.5], [-39.5, -5.6], [-40, -4.2], [-42.5, -5.1]], y - 0.2, y + 1.6); prism('cover2', [[-41.6, -5.7], [-40.3, -5.2], [-40.6, -4.4], [-41.9, -4.9]], y + 1.6, y + 2.9);
      label('集市', -45, y + 4.6, 0);
    }

    // ---------- 小庙（土丘顶）：残墙围出的高地，俯瞰河滩台阶和渡槽 ----------
    {
      const y = PADS.find((p) => p.k === 'shrine').h; const F = Fr(frame(13, 40, angTo(-0.5, -0.86)));
      O.wall('wall', F, -3.5, 3, -3.5, -2.5, y - 0.3, y + 3.0, 0.6, [[2.5, 1.6, 1.1, 2.2]]); O.wall('wall', F, 3.5, -2.5, 3.5, 3, y - 0.3, y + 2.2, 0.6);
      O.wall('wall', F, -3.5, -2.8, -0.8, -2.8, y - 0.3, y + 3.0, 0.6); O.wall('wall', F, 1.2, -2.8, 3.8, -2.8, y - 0.3, y + 1.1, 0.6);
      O.box('cover', F, -1, y - 0.2, 1, 1.4, y + 1.0, 1.8);
      label('小庙（土丘）', 13, y + 5, 40);
    }

    // ---------- 采石场：挖下去的坑、坑里一座没采完的孤岩（中间有岩洞，岩顶能上），坑边的吊机 ----------
    {
      const yb = PIT.floor; const MESA = [[44, 52.5], [50, 49.5], [56.5, 52.5], [57.5, 60], [52.5, 64.5], [45.5, 62.5]]; const top = 8.0;
      const dir = [0.94, 0.34], mx = -dir[1], mz = dir[0], c = 50.5 * mx + 57 * mz, hw = 1.7;
      const Lp = clipHalf(MESA, mx, mz, c - hw), Rp = clipHalf(MESA, -mx, -mz, -(c + hw)), Mp = clipHalf(clipHalf(MESA, mx, mz, c + hw), -mx, -mz, -(c - hw));
      prism('rock', Lp, yb - 0.6, top); prism('rock', Rp, yb - 0.6, top - 0.6); prism('rock', Mp, yb + 3.4, top - 0.3, { bottom: true });
      lamp(frame(50.5, 57, angTo(dir[0], dir[1])), 0, yb + 3.35, 0, 22, 8);
      // 攀爬石：从坑底一级一级攀上孤岩顶（每级 ≤ 2.4 m，跳起来能攀上去）
      for (const [x, z, y, s] of [[42.4, 56.5, yb + 1.0, 1.5], [42.6, 59.6, yb + 3.2, 1.3], [44.3, 62.6, yb + 5.4, 1.2], [46.8, 64.4, top - 0.9, 1.1]]) {
        const P = [[x - s, z - s * 0.8], [x + s * 0.9, z - s], [x + s, z + s * 0.7], [x - s * 0.7, z + s]]; prism('stair', P, yb - 0.6, y);
      }
      // 坑里的散石、矿车（掩体）
      for (const [x, z, s, i] of [[36, 52, 1.4, 1], [41, 47, 1.1, 2], [54, 46.5, 1.6, 3], [37.5, 60, 1.2, 4], [58.5, 50, 1.1, 5]]) { const [wx, wz] = S(x, z); O.rock(wx, yb + s * 0.45, wz, s * 1.3, s, s * 1.1, i, i * 5 + sg); }
      prism('cover2', [[46, 46.5], [49.5, 47.6], [49, 49.2], [45.5, 48.1]], yb - 0.2, yb + 1.8);
      // 吊机（地标 / 钩爪点）：立在坑底，吊臂伸向孤岩。整个在地面以下起算，站上吊臂也高不过营地的围墙，看不进出生区
      const cx = 34.5, cz = 57, cy = terrainH(...S(cx, cz)); O.box('beam', Fr(frame(cx, cz, 0)), -0.7, cy - 0.5, -0.7, 0.7, cy + 12.5, 0.7);
      { const G = Fr(frame(cx, cz, angTo(0.97, 0.24))); O.box('beam', G, -0.45, cy + 11.7, -4, 0.45, cy + 12.7, 15); O.box('cover2', G, -1.3, cy + 10.3, -4.8, 1.3, cy + 11.7, -2.2); }
      label('采石场', 44, 4.0, 44); label('孤岩 · 岩洞', 50.5, top + 2.2, 57); label('吊机', cx, cy + 19, cz);
    }

    // ---------- 坝墙：河道东头（转过去就是西头）出图的地方，一道带涵洞的坝 ----------
    {
      const r = rivAt(73.5); const F = Fr(axisFrame(r.x, r.z, r.nx, r.nz));
      O.wall('edge', F, -16, 0, 16, 0, FLOOR - 0.6, 11, 3, [[16, 5, 0.6, 3.6]]);
      O.box('dark', F, -2.5, FLOOR, 1.5, 2.5, FLOOR + 3, 3.5, { collide: true, rays: 0 });
      for (let i = -2; i <= 2; i++) O.box('beam', F, i - 0.08, FLOOR, -1.6, i + 0.08, FLOOR + 3.0, -1.4);
      label('坝墙', r.x, 13, r.z);
    }

    // ---------- 河床里的掩体：大石头、搁浅的驳船 ----------
    {
      for (const [px, s, i] of [[-58, 2.2, 1], [-36, 1.6, 2], [-22, 1.3, 3], [30, 1.8, 4], [50, 1.5, 5], [62, 2.0, 6]]) {
        const r = rivAt(px); const off = (hash(i * 9.1) - 0.5) * 6; const [x, z] = S(r.x + r.nx * off, r.z + r.nz * off); O.rock(x, FLOOR + s * 0.4, z, s * 1.4, s, s, i, i * 13 + sg);
      }
      const r = rivAt(-12); const F = Fr(axisFrame(r.x - r.nx * 2.5, r.z - r.nz * 2.5, r.tx, r.tz));
      O.box('cover2', F, -4.5, FLOOR - 0.2, -1.4, 4.5, FLOOR + 1.9, 1.4, { mech: true }); O.box('cover2', F, 1.5, FLOOR + 1.9, -1.0, 3.8, FLOOR + 3.3, 1.0);
      { const q = rivAt(-30); label('河床', q.x, FLOOR + 3, q.z); }
    }

    // ---------- 区域名 ----------
    label('主街', -5.5, null, 52); label('上城巷', -36, null, 67); label('台阶巷', -30, null, 25); label('横巷', -18, null, 50); label('河堤路', -34, null, -5);
    label('南老城', -52, null, 30, { big: true, up: 12 }); label('外环巷', -63, null, 26); label('采石场车道', 33, null, 73);
    // 滑索：钟楼钟层 → 南塔塔顶；孤岩顶 → 泵站屋顶
    { const by = PADS.find((p) => p.k === 'bell').h + 11, bx = -37.5, bz = 37.5, tx = -12.9, tz = 17.8; const dx = tx - bx, dz = tz - bz, l = Math.hypot(dx, dz); zip([bx + dx / l * 3.4, by + 2.3, bz + dz / l * 3.4], [tx - dx / l * 1.5, 13.85 + 2.3, tz - dz / l * 1.5]); }
    { const h = HOUSES.find((q) => q.k === 'pump'); zip([47.2, 8.0 + 2.2, 58.5], [h.x + 2, h.roof + 2.2, h.z + 1]); }
  }

  // ====================== 玩法数据（南半边写，敌方的转 180°）======================
  const R = ([x, z, ...r]) => [-x, -z, ...r];
  const swapLane = (l) => (l === 'W' ? 'E' : l === 'E' ? 'W' : l);
  L.friendlyPods = [[0, 76], [8, 76], [-6, 80], [12, 82], [-20, 77], [-30, 72], [-40, 62], [24, 74], [33, 75], [-5, 60], [6, 64]];
  L.enemyPods = L.friendlyPods.map(R);
  L.respawns = [[3, 78], [-4, 82], [10, 84], [-20, 77], [24, 73]];
  const CP = [
    [-45, 1, 'W'], [-38, 12, 'W'], [-50, 22, 'W'], [-62, 24, 'W'], [-38, 33, 'W'], [-34, -6, 'W'],
    [-14, 20, 'M'], [-5, 50, 'M'], [-5, 30, 'M'], [13, 40, 'M'], [-2, 10, 'M'],
    [40, 58, 'E'], [33, 33, 'E'], [26, 41, 'E'], [50, 31, 'E'],
    [-22, 46, 'C'], [-30, 24, 'C'], [21, 64, 'C'],
  ];
  L.combatPoints = [...CP, ...CP.map(([x, z, l]) => [-x, -z, swapLane(l)]), [0, 0, 'M'], [-30, -20.5, 'W'], [30, 20.5, 'E'], [-45, -19.5, 'W'], [45, 19.5, 'E']];
  const bellH = PADS.find((p) => p.k === 'bell').h + 11.05, shrineH = PADS.find((p) => p.k === 'shrine').h + 0.05, hs = (k) => HOUSES.find((q) => q.k === k);
  L.nests = [[37.5, bellH, -37.5], [12.9, 13.9, -17.8], [-hs('pump').x, hs('pump').roof + 0.05, -hs('pump').z], [-50, 8.05, -57], [-13, shrineH, -40], [-hs('inn').x, hs('inn').roof + 0.05, -hs('inn').z]];
  L.menuCam = { x: 0, y: 46, z: 0, rx: 104, rz: 122, dy: 8, look: [0, 2, 0] };
  L.flyover = [
    { from: [-120, 64, 96], to: [-46, 36, 44], look: [0, 6, 0], t: 4.4 },
    { from: [22, SPH + 16, 106], to: [4, SPH + 5, 93], look: [-2, SPH + 1, 62], t: 3.4 },
  ];
  return L;
}

// 导航网格建好之后：悬崖上（战区外）的格子剔掉；空降点、交战点挪到最近的可走格；机甲投放点从机甲能走的露天格子里挑
export function finishGorge(L, nav) {
  for (let i = 0; i < nav.w * nav.h; i++) if ((nav.ok[i] || nav.mech[i]) && polySD(BOUND, nav.cx(i), nav.cz(i)) > -0.5) { nav.ok[i] = 0; nav.mech[i] = 0; }
  nav.list = nav.list.filter((i) => nav.ok[i]); nav.mechList = nav.mechList.filter((i) => nav.mech[i]);
  const fix = (p, r = 6) => { if (nav.walkable(p[0], p[1])) return p; const i = nav.nearestIn(p[0], p[1], nav.ok, r); return i >= 0 ? [nav.cx(i), nav.cz(i), ...p.slice(2)] : null; };
  L.friendlyPods = L.friendlyPods.map((p) => fix(p)).filter(Boolean); L.enemyPods = L.enemyPods.map((p) => fix(p)).filter(Boolean);
  L.respawns = L.respawns.map((p) => fix(p)).filter(Boolean); L.combatPoints = L.combatPoints.map((p) => fix(p)).filter(Boolean);
  const cand = []; for (let k = 0; k < nav.mechList.length; k += 3) { const i = nav.mechList[k]; if (nav.sky[i] >= 0.9 && nav.cz(i) > 8) cand.push([nav.cx(i), nav.cz(i)]); }
  const out = []; while (out.length < 6 && cand.length) { let best = null, bd = -1; for (const c of cand) { let d = 1e9; for (const o of out) d = Math.min(d, Math.hypot(o[0] - c[0], o[1] - c[1])); if (!out.length) d = c[1]; if (d > bd) { bd = d; best = c; } } if (!best || (out.length && bd < 14)) break; out.push(best); }
  L.mechDrops = out.flatMap((p) => [p, [-p[0], -p[1]]]);
  return L;
}
