// 紧凑版三路地图的布局（阶段 2.1）。全部是纯函数：给一个位置，回答“这里是什么、多高、能不能走”。
//
// 坐标：世界坐标 x 朝右、z 朝屏幕下方。我方（绿）在左下角，对方（红）在右上角。
// 路向坐标 u、v：u 沿中路从我方指向对方（左下 → 右上），v 沿河道（左上 → 右下）。
// 地图关于河道（u → -u）和中路（v → -v）都对称，所以大部分计算在 a = |u|、w = |v| 的四分之一里做。
//
// 结构参考王者峡谷（第三稿）：整张图是一片开阔的地面，默认哪里都能走；
// 挡路的是一段段窄长的矮墙（片状薄墙），营地窝在弧形墙围出的凹口里，草丛贴着墙长，基地和地图边缘是一圈薄城墙。

import { clamp, fbm, smoothstep } from "../core/noise";

const SQ2 = Math.SQRT2;
const RAD = Math.PI / 180;

// ---- 尺寸（米）----
export const HALF = 78;                       // 可活动的方形区域半边长：整张图 156 米见方（上一版是 300 米）
export const WORLD_HALF = 92;                 // 连同外围一圈背景
export const A_CORNER = HALF * SQ2;           // 中心到基地角的距离
export const BASE_R = 44;                     // 基地高地（四分之一圆）的半径
export const FOUNTAIN_D = 8;                  // 出生点离地图角
export const CORE_D = 20;                     // 水晶离地图角：紧挨着出生点，复活出来两秒就到，好守家
export const CORE_R = 4.4;                    // 水晶底座的半径（走不过去）
export const TOWER_R = 1.9;                   // 防御塔脚下走不过去的半径
export const LANE_HW = 5;                     // 兵线半宽
export const TRAIL_HW = 1.6;                  // 野区里踩出来的土路半宽（只是地面的样子，不挡路）
export const WALL_HW = 1.1;                   // 薄墙的半宽：墙厚 2.2 米
export const SIDE_INSET = 10;                 // 边路中线离地图边
export const SIDE_C = (HALF - SIDE_INSET) * SQ2;
export const SIDE_K = 14;                     // 边路在左上角、右下角拐弯的圆滑程度
export const OUTER = 12;                      // 边路拐角处，中线往外多远是城墙
export const L_BASE = 2.4, L_RIVER = -0.9, L_WALL = 3.0;
export const HERO_SPEED = 5;                  // 参考移速（米/秒），只用来估算走路时间；英雄的真实移速阶段 3 再定

export const toLane = (x: number, z: number): [number, number] => [(x - z) / SQ2, (x + z) / SQ2];
export const toWorld = (u: number, v: number): [number, number] => [(u + v) / SQ2, (v - u) / SQ2];

/** 边路中线：给 a 求 w */
export const sideLaneW = (a: number) => SIDE_C - Math.hypot(a, SIDE_K);
const sideSlope = (a: number) => -a / Math.hypot(a, SIDE_K);
/** 到边路中线的距离（近似）。正数在中线外侧（靠地图边），负数在内侧 */
const sSideLane = (a: number, w: number) => (w - sideLaneW(a)) / Math.hypot(1, sideSlope(a));

const BASE_EDGE_A = A_CORNER - BASE_R;        // 中路上，高地边缘的位置
export const RIVER_END = sideLaneW(0);        // 河道两头接到边路的位置
const riverHW = (w: number) => 6.6 + 1.3 * Math.cos(w * 0.105) + 0.9 * Math.cos(w * 0.23 + 1.0);

// ---- 四分之一地图里的东西（a、w 坐标）----
type P = [number, number];
/** 两个 Boss 的河心岛：河道在这里鼓成一个圆潭，中间一块台地；两岸各有一道弧形墙把它围成一个坑 */
export const LAGOON = { w: 46, r: 12.5, island: 6.2 };
/** 野怪营地：一个大的（增益怪）在野区正中，两个小的分别靠河、靠基地 */
export const CAMPS: { a: number; w: number; r: number; kind: "buff" | "small"; face: number }[] = [      // face：凹口朝哪边开（角度，0° 朝基地，90° 朝边路），野怪面朝这边站
  { a: 32, w: 30, r: 6.5, kind: "buff", face: 196 },
  { a: 20, w: 57, r: 4.6, kind: "small", face: 269 },
  { a: 54, w: 19, r: 4.6, kind: "small", face: 178 },
];
const sideEdge = (a: number, inset = LANE_HW - 0.5): P => [a, sideLaneW(a) - inset];
/** 野区里踩出来的土路：只画在地面上，告诉人常走哪里，不挡路 */
export const TRAILS: P[][] = [
  [[20, 4.5], [25, 15], [28, 24]],                       // 中路外塔旁 → 增益怪
  [[6, 29], [16, 30], [25.5, 30]],                       // 河道 → 增益怪
  [[35, 38.5], [38, 44], sideEdge(42)],                  // 增益怪 → 边路
  [[38, 26], [45, 20], [49.5, 19], [50, 4.5]],           // 增益怪 → 靠基地的小营地 → 中路内塔旁
  [[6, 63], [13, 60.5], [16, 58]],                       // 河道 → 靠河的小营地
  [[20, 52.5], [24, 44], [26, 36]],                      // 靠河的小营地 → 增益怪
];

const arc = (ca: number, cw: number, r: number, deg0: number, deg1: number, n = 10): P[] =>
  Array.from({ length: n + 1 }, (_, i) => { const t = (deg0 + ((deg1 - deg0) * i) / n) * RAD; return [ca + r * Math.cos(t), cw + r * Math.sin(t)] as P; });
const along = (a0: number, a1: number, inset: number, n = 6): P[] => Array.from({ length: n + 1 }, (_, i) => sideEdge(a0 + ((a1 - a0) * i) / n, inset));
/** 片状薄墙：每段是一串点。角度 0° 朝基地，90° 朝边路 */
export const WALLS: { pts: P[]; note: string }[] = [
  { pts: [[8.5, 11.8], [18.5, 11.8]], note: "中路河道口草丛背后" },
  { pts: [[13.3, 13.2], [13.3, 23.5]], note: "河岸草丛背后，和上一段连成拐角" },
  { pts: [[28, 11.8], [40.5, 11.8]], note: "中路外塔和内塔之间的草丛背后" },
  { pts: [[52.5, 12.6], [61, 13.6]], note: "内塔旁蹲伏草丛背后" },
  { pts: along(28, 39, 11.8), note: "边路内侧草丛背后" },
  { pts: along(45, 55, 11.8), note: "边路内侧草丛背后" },
  { pts: [[13.3, 64.5], [13.3, 74]], note: "靠边路的河岸草丛背后" },
  { pts: arc(0, LAGOON.w, 19.2, -40, 12), note: "Boss 坑的弧形墙" },
  { pts: arc(32, 30, 8.7, -52, 84), note: "增益怪的凹口" },
  { pts: arc(20, 57, 6.5, 28, 150), note: "靠河小营地的凹口" },
  { pts: arc(54, 19, 6.5, -72, 68), note: "靠基地小营地的凹口" },
  { pts: [[21, 20.2], [29, 18.6]], note: "中路和增益怪之间的一段" },
  { pts: [[42, 22], [47, 30]], note: "增益怪和靠基地小营地之间的一段" },
];
/** 草丛：每块是一段胶囊形（两个端点加半宽）。special 是专门用来蹲伏的位置 */
export const BRUSH: { p: P; q: P; hw: number; special?: boolean }[] = [
  { p: [9, 7.6], q: [17, 7.6], hw: 2.3 },                // 中路河道口两侧
  { p: [30, 7.6], q: [39, 7.6], hw: 2.3 },               // 中路外塔和内塔之间
  { p: [9.5, 14], q: [9.5, 23], hw: 2.3 },               // 河岸，靠中路
  { p: [9.5, 66], q: [9.5, 73], hw: 2.3 },               // 河岸，靠边路
  { p: sideEdge(30, 7.6), q: sideEdge(37, 7.6), hw: 2.3 },   // 边路内侧
  { p: sideEdge(47, 7.6), q: sideEdge(53, 7.6), hw: 2.3 },
  { p: [26, 38.5], q: [29.5, 42], hw: 2.3 },             // 增益怪凹口的墙头外
  // ---- 特殊位置：蹲人用 ----
  { p: [15.2, 43], q: [15.2, 49.5], hw: 2.2, special: true },            // Boss 坑里，弧形墙内侧：蹲抢 Boss 的人
  { p: [23, 35.5], q: [24, 39.5], hw: 2.1, special: true },              // 野区岔路口：河道进野区的必经之路
  { p: [55, 7.4], q: [58.5, 8.6], hw: 2.1, special: true },              // 内塔旁，小路拐进中路的口子
  { p: [0, sideLaneW(0) + 7.3], q: [7, sideLaneW(7) + 7.3], hw: 2.2, special: true },   // 边路拐角的外侧：蹲从河道上线的人
  { p: [64.3, 16.5], q: [64.3, 21.5], hw: 2.0, special: true },          // 靠基地的小营地墙后
];
/** 防御塔在四分之一地图里的位置：每条线外塔、内塔、高地塔 */
const sidePt = (a: number): P => [a, sideLaneW(a)];
// ---- 基地高地的三个口子（阶段 2.4）----
// 每个口子是一段台阶：从高地的边线往外伸 GATE_RUN 米，落到平地；台阶和兵线一样宽，垂直于兵线。两侧各一道护墙、一根门墩。
export const GATE_HW = 5.3;                   // 台阶半宽
export const GATE_RUN = 5.6;                  // 台阶往外伸多远：8 级，每级高 0.3 米、深 0.7 米
export const GATE_LP = GATE_HW + 1.0;         // 门墩离口子中线多远
export interface Gate { o: P; t: P; n: P; mid: boolean; sp: [number, number]; }
function makeGate(a0: number, mid: boolean): Gate {
  const o: P = [a0, mid ? 0 : sideLaneW(a0)], k = mid ? 0 : sideSlope(a0), tl = Math.hypot(1, k), t: P = [1 / tl, k / tl], n: P = [-t[1], t[0]];
  // 门墩立在高地的边线上：在口子两侧各找一个点，离中线 GATE_LP 远、离基地中心 BASE_R 远
  const sp = [-1, 1].map(sd => { let lo = -8, hi = 8; for (let i = 0; i < 40; i++) { const s = (lo + hi) / 2, x = o[0] + t[0] * s + n[0] * sd * GATE_LP, y = o[1] + t[1] * s + n[1] * sd * GATE_LP; if (Math.hypot(A_CORNER - x, y) > BASE_R) lo = s; else hi = s; } return (lo + hi) / 2; }) as [number, number];
  return { o, t, n, mid, sp };
}
/** 口子里的局部坐标：s 沿兵线往基地里走（0 在高地边线上），l 是横向 */
export const gateLocal = (g: Gate, a: number, w: number): [number, number] => [(a - g.o[0]) * g.t[0] + (w - g.o[1]) * g.t[1], (a - g.o[0]) * g.n[0] + (w - g.o[1]) * g.n[1]];
export const TOWERS_Q: { p: P; tier: 1 | 2 | 3; lane: "mid" | "side" }[] = [
  { p: [22, 0], tier: 1, lane: "mid" }, { p: [45, 0], tier: 2, lane: "mid" }, { p: [BASE_EDGE_A + 7, 0], tier: 3, lane: "mid" },
  { p: sidePt(25), tier: 1, lane: "side" }, { p: sidePt(51), tier: 2, lane: "side" }, { p: sidePt(77), tier: 3, lane: "side" },
];

const sideGateA = (() => { let lo = 60, hi = 80; for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (Math.hypot(A_CORNER - m, sideLaneW(m)) > BASE_R) lo = m; else hi = m; } return (lo + hi) / 2; })();
export const GATES: Gate[] = [makeGate(BASE_EDGE_A, true), makeGate(sideGateA, false)];

const segDist = (px: number, py: number, a: P, b: P) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], t = clamp(((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(px - a[0] - dx * t, py - a[1] - dy * t);
};
const polyDist = (px: number, py: number, pts: P[]) => { let d = 1e9; for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, segDist(px, py, pts[i], pts[i + 1])); return d; };

export type Zone = "out" | "wall" | "grass" | "lane" | "trail" | "camp" | "river" | "island" | "base" | "ramp";
export interface Cell {
  zone: Zone;
  walk: boolean;          // 能不能走
  brush: boolean;         // 是不是草丛（能走，站进去别人看不见）
  h: number;              // 地面高度
  team: 0 | 1;            // 0 = 我方（绿，左下），1 = 对方（红，右上）
  side: number;           // 0..1，越靠近对方越大，河道正中是 0.5（给两侧配色过渡用）
}

/** 这个位置是什么 */
export function sample(x: number, z: number): Cell {
  const [u, v] = toLane(x, z), a = Math.abs(u), w = Math.abs(v);
  const team: 0 | 1 = u < 0 ? 0 : 1, side = smoothstep(-9, 9, u);
  // 水晶底座和防御塔脚下走不过去（地面的类型不变，只是不能走）
  let solid = Math.hypot(a - (A_CORNER - CORE_D), w) < CORE_R;
  for (const t of TOWERS_Q) if (Math.hypot(a - t.p[0], w - t.p[1]) < TOWER_R) solid = true;
  const cell = (zone: Zone, h: number, o: Partial<Cell> = {}): Cell => ({ zone, walk: zone !== "wall" && zone !== "out" && !solid, brush: false, h, team, side, ...o });

  // 地图边缘：一圈薄城墙。直边上贴着方形区域的边，左上角和右下角跟着边路的弯走
  const sSide = sSideLane(a, w);
  const dEdge = Math.min((A_CORNER - a - w) / SQ2, OUTER - sSide);
  if (dEdge < 0) return cell("out", L_WALL + 1.2);
  if (dEdge < WALL_HW * 2) return cell("wall", L_WALL + 0.6);

  // 基地高地：四分之一圆的铺地广场，边上一圈薄城墙，三条线各开一个口，口子是坡道
  const dc = Math.hypot(A_CORNER - a, w);
  const dMid = w, dSide = Math.abs(sSide);
  const onLaneAxis = Math.min(dMid, dSide) < LANE_HW + 0.6;
  if (dc < BASE_R + GATE_RUN && onLaneAxis) return dc < BASE_R ? cell("base", L_BASE) : cell("ramp", L_BASE * clamp(1 - (dc - BASE_R) / GATE_RUN, 0, 1));     // 台阶在墙线外面（2.4 改的，原来是骑在墙线上的一道坡）
  if (dc < BASE_R - WALL_HW) return cell("base", L_BASE);
  if (dc < BASE_R + WALL_HW) return cell("wall", L_BASE + 1.4);

  // 河道和河心岛
  const dLagoon = Math.hypot(a, w - LAGOON.w);
  if (dLagoon < LAGOON.island) return cell("island", -0.15);
  const inRiver = (a < riverHW(w) && w < RIVER_END - LANE_HW + 1) || dLagoon < LAGOON.r;
  // 兵线和防御塔脚下的一圈铺地
  let lane = (dMid < LANE_HW && a < BASE_EDGE_A + 4) || dSide < LANE_HW;
  for (const t of TOWERS_Q) if (Math.hypot(a - t.p[0], w - t.p[1]) < 6.2) lane = true;
  if (lane) return cell("lane", inRiver ? -0.62 : 0);     // 兵线过河的地方沉在浅水下面：水面连续地盖过路（用户点名要保留的特征）
  if (inRiver) return cell("river", L_RIVER);

  // 片状薄墙
  let dWall = 1e9; for (const wl of WALLS) dWall = Math.min(dWall, polyDist(a, w, wl.pts) - WALL_HW);
  if (dWall < 0) return cell("wall", L_WALL + (fbm(a * 0.2, w * 0.2, 2, 5) - 0.5) * 0.8);

  // 其余全是开阔的地面，都能走。草丛、营地、土路只是地面上的东西
  // 草丛贴着墙的那一侧一直算到墙脚（2.6 改的）：画面上草丛是长到墙脚的，看起来能藏人的地方就必须真的能藏人
  for (const b of BRUSH) { const d = segDist(a, w, b.p, b.q); if (d < b.hw || (d < b.hw * 1.7 && dWall < 0.8)) return cell("grass", 0, { brush: true }); }
  for (const c of CAMPS) if (Math.hypot(a - c.a, w - c.w) < c.r) return cell("camp", 0);
  const wob = (fbm(a * 0.16 + 9, w * 0.16 + 9, 2, 71) - 0.5) * 0.9;
  for (const t of TRAILS) if (polyDist(a, w, t) < TRAIL_HW + wob) return cell("trail", 0);
  return cell("grass", 0);
}

export const heightAt = (x: number, z: number) => sample(x, z).h;

// ---- 建筑和标记的世界坐标 ----
const four = (a: number, w: number): { x: number; z: number; team: 0 | 1; top: boolean }[] => {
  const out = [];
  for (const su of [-1, 1]) for (const sv of w === 0 ? [1] : [-1, 1]) { const [x, z] = toWorld(su * a, sv * w); out.push({ x, z, team: (su < 0 ? 0 : 1) as 0 | 1, top: sv < 0 }); }
  return out;
};
export const towerSpots = () => TOWERS_Q.flatMap(t => four(t.p[0], t.p[1]).map(s => ({ ...s, tier: t.tier, lane: t.lane === "mid" ? "mid" as const : s.top ? "top" as const : "bot" as const })));
export const coreSpots = () => four(A_CORNER - CORE_D, 0);
export const fountainSpots = () => four(A_CORNER - FOUNTAIN_D, 0);
/** 营地的位置。i 是 CAMPS 里的第几个；fx、fz 是凹口朝外的方向（世界坐标的单位向量） */
export const campSpots = () => CAMPS.flatMap((c, i) => four(c.a, c.w).map(s => { const su = s.team === 0 ? -1 : 1, sv = s.top ? -1 : 1, [fx, fz] = toWorld(su * Math.cos(c.face * RAD), sv * Math.sin(c.face * RAD)); return { ...s, r: c.r, kind: c.kind, i, fx, fz }; }));
export const bossSpots = () => [-1, 1].map(sv => { const [x, z] = toWorld(0, sv * LAGOON.w); return { x, z, top: sv < 0 }; });

// ---- 尺度 ----
export function metrics() {
  let walk = 0, total = 0, wall = 0;
  for (let z = -HALF; z < HALF; z += 1) for (let x = -HALF; x < HALF; x += 1) { const c = sample(x + 0.5, z + 0.5); if (c.zone === "out") continue; total++; if (c.walk) walk++; if (c.zone === "wall") wall++; }
  const wallLen = (pts: P[]) => { let l = 0; for (let i = 0; i < pts.length - 1; i++) l += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]); return l; };
  return {
    size: HALF * 2, laneWidth: LANE_HW * 2, wallThickness: WALL_HW * 2, wallHeight: L_WALL,
    coreToCore: (A_CORNER - CORE_D) * 2, fountainToCore: CORE_D - FOUNTAIN_D,
    towersPerTeam: towerSpots().filter(t => t.team === 0).length, campsPerTeam: campSpots().filter(c => c.team === 0).length,
    brushPerTeam: BRUSH.length * 2, specialBrushPerTeam: BRUSH.filter(b => b.special).length * 2,
    wallsPerTeam: WALLS.length * 2, wallLengths: WALLS.map(wl => Math.round(wallLen(wl.pts))),
    walkable: walk / total, wallShare: wall / total, speed: HERO_SPEED,
  };
}

/** 从一个点出发，沿可走的地面走到各个目标点的最短路程（米）。按 1 米的格子、八个方向算，斜着走的路会略微偏长（最多约 8%） */
export function pathLengths(from: [number, number], targets: [number, number][]): number[] {
  const R = HALF + 2, W = R * 2 + 1, idx = (x: number, z: number) => (Math.round(z) + R) * W + (Math.round(x) + R);
  const walk = new Uint8Array(W * W), d = new Float32Array(W * W).fill(1e9);
  for (let z = -R; z <= R; z++) for (let x = -R; x <= R; x++) walk[idx(x, z)] = sample(x, z).walk ? 1 : 0;
  // 简单的桶队列：距离乘 10 取整当桶号
  const buckets: number[][] = []; const push = (k: number, v: number) => { d[k] = v; (buckets[Math.round(v * 10)] ??= []).push(k); };
  push(idx(from[0], from[1]), 0);
  for (let b = 0; b < buckets.length; b++) { const q = buckets[b]; if (!q) continue;
    for (let n = 0; n < q.length; n++) { const k = q[n]; if (Math.round(d[k] * 10) !== b) continue;
      const kx = k % W, kz = (k - kx) / W;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dz) continue;
        const nx = kx + dx, nz = kz + dz; if (nx < 0 || nz < 0 || nx >= W || nz >= W) continue;
        const nk = nz * W + nx; if (!walk[nk]) continue;
        if (dx && dz && (!walk[kz * W + nx] || !walk[nz * W + kx])) continue;       // 不许斜着穿墙角
        const nd = d[k] + (dx && dz ? SQ2 : 1); if (nd < d[nk] - 1e-4) push(nk, nd);
      } } }
  return targets.map(t => d[idx(t[0], t[1])]);
}

/** 几条有代表性的路线，从我方出生点（或中路河道正中）出发 */
export function routes() {
  const W = (u: number, v: number) => toWorld(u, v) as [number, number];
  const home = W(-(A_CORNER - FOUNTAIN_D - 5.9), 0), center = W(0, 0);
  const a = pathLengths(home, [center, W(-22, 4), W(0, -RIVER_END), W(-29, -27), W(-20, -54), W(0, -(LAGOON.w - LAGOON.island + 1.5)), W(A_CORNER - CORE_D - 6.5, 0)]);
  const b = pathLengths(center, [W(0, -(LAGOON.w - LAGOON.island + 1.5)), W(-29, -27), W(0, -RIVER_END)]);
  const row = (name: string, m: number) => ({ name, meters: Math.round(m), seconds: Math.round((m / HERO_SPEED) * 10) / 10 });
  return [
    row("出生点 → 中路河道正中", a[0]), row("出生点 → 中路外塔", a[1]), row("出生点 → 上路河道口", a[2]),
    row("出生点 → 我方上野增益怪", a[3]), row("出生点 → 靠河的小营地", a[4]), row("出生点 → Boss 一", a[5]), row("出生点 → 对方水晶跟前", a[6]),
    row("中路河道正中 → Boss 一", b[0]), row("中路河道正中 → 我方上野增益怪", b[1]), row("中路河道正中 → 上路河道口", b[2]),
  ];
}

/** 给画地面和摆东西用的距离场（米）。负数表示在里面 */
export function fields(x: number, z: number) {
  const [u, v] = toLane(x, z), a = Math.abs(u), w = Math.abs(v);
  let dWall = 1e9; for (const wl of WALLS) dWall = Math.min(dWall, polyDist(a, w, wl.pts) - WALL_HW);
  let dBrush = 1e9; for (const b of BRUSH) dBrush = Math.min(dBrush, segDist(a, w, b.p, b.q) - b.hw);
  let dTrail = 1e9; for (const t of TRAILS) dTrail = Math.min(dTrail, polyDist(a, w, t) - TRAIL_HW);
  let dTower = 1e9, tower: P = [0, 0]; for (const t of TOWERS_Q) { const d = Math.hypot(a - t.p[0], w - t.p[1]); if (d < dTower) { dTower = d; tower = t.p; } }
  const sSide = sSideLane(a, w), dLagoon = Math.hypot(a, w - LAGOON.w) - LAGOON.r;
  // 河道到边路的内侧就收住（边路不过河）；中路一带离边路很远，这一项不起作用
  const dRiver = Math.min(Math.max(a - riverHW(w), sSide + LANE_HW - 0.6), dLagoon);
  const dLane = Math.min(w, Math.abs(sSide)) - LANE_HW;
  let dCamp = 1e9; for (const c of CAMPS) dCamp = Math.min(dCamp, Math.hypot(a - c.a, w - c.w) - c.r);
  return {
    u, v, a, w, dWall, dBrush, dTrail, dTower, tower, dRiver, dLane, dBase: Math.hypot(A_CORNER - a, w) - BASE_R,
    sSide, dLagoon, dCamp, dIsland: Math.hypot(a, w - LAGOON.w) - LAGOON.island,
    dEdge: Math.min((A_CORNER - a - w) / SQ2, OUTER - sSide),             // 到地图边缘城墙外沿的距离，负数在城墙外面
    dCore: Math.hypot(a - (A_CORNER - CORE_D), w) - CORE_R, dSpawn: Math.hypot(a - (A_CORNER - FOUNTAIN_D), w),
  };
}
