// 整张地图的地面高度（阶段 2.4）。纯函数：给一个位置，回答地面有多高。
//
// 高低一共五层，从低到高：
//   河床（-1.2，Boss 潭更深）→ 水面（-0.26）→ 过河的路（-0.62，只没到小腿）
//   → 平地（0 上下，野区有很缓的起伏，营地略凹）
//   → 基地高地（+2.4，三个口子各一段台阶下到平地）→ 出生点的台子（比广场再高三级台阶）
//   → 城墙外面的山（一路往上）
// 墙、台阶、石块是另外建的模型，这里只管地面本身。

import { clamp, fbm, ridge, smoothstep } from "../core/noise";
import { A_CORNER, FOUNTAIN_D, GATES, GATE_LP, GATE_RUN, L_BASE, fields, gateLocal, toLane } from "./layout";

export const WATER_Y = -0.26;                 // 水面
export const BED = -1.2, FORD = -0.62;        // 河床最深处；过河的路面
export const ISLAND_Y = 0.4;                  // Boss 站的那块石台，刚露出水面
export const DAIS_H = 0.75, DAIS_R = 4.6;     // 出生点的台子：比广场高三级台阶
export const STEP_H = 0.25, STEP_D = 0.5;     // 台子的台阶：每级高、深

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** 高地的“有多高”：0 是平地，1 是广场。口子里是一道坡（台阶垫在上面） */
export function plateau(a: number, w: number, dBase: number): number {
  let p = smoothstep(0.3, -0.3, dBase);
  for (const g of GATES) {
    const [s, l] = gateLocal(g, a, w), al = Math.abs(l);
    if (al < GATE_LP && s > -GATE_RUN - 1 && s < 5) p = s >= 0 ? 1 : clamp(1 + s / GATE_RUN, 0, 1);
  }
  return p;
}

export function terrainHeight(x: number, z: number): number {
  const f = fields(x, z);
  // 野区很缓的起伏：兵线、河边、基地、城墙脚下是平的
  const calm = smoothstep(0.5, 9, f.dLane) * smoothstep(1.5, 9, f.dRiver) * smoothstep(GATE_RUN + 1, GATE_RUN + 10, f.dBase) * smoothstep(2.4, 8, f.dEdge) * smoothstep(5.5, 9, f.dTower);
  let h = ((fbm(x * 0.042, z * 0.042, 3, 101) - 0.4) * 3.6 + (fbm(x * 0.12, z * 0.12, 2, 102) - 0.5) * 0.5) * calm * smoothstep(-2, 5, f.dCamp);
  h -= 0.3 * smoothstep(1.5, -2.5, f.dCamp) * calm;                           // 营地是一小块平的洼地
  // 河：岸边缓缓下到河床，岸线跟着噪声走；Boss 潭更深一些
  const k = smoothstep(0.9, -1.7, f.dRiver + (fbm(x * 0.35, z * 0.35, 2, 8) - 0.5) * 0.9 + (fbm(x * 0.9, z * 0.9, 2, 14) - 0.5) * 0.3);
  h = h * (1 - k) + (BED - 0.55 * smoothstep(1.5, -3.5, f.dLagoon)) * k;
  // 过河的路垫高一些，两侧是缓坡
  h += (Math.max(h, FORD) - h) * smoothstep(3.2, -0.8, f.dLane);
  // Boss 的石台
  h = mix(h, ISLAND_Y, smoothstep(0.7, -0.5, f.dIsland + (fbm(x * 0.7, z * 0.7, 2, 31) - 0.5) * 0.7));
  // 基地高地和口子里的坡
  const p = plateau(f.a, f.w, f.dBase);
  h = mix(h, L_BASE, p);
  // 出生点的台子
  if (f.dSpawn < DAIS_R + 3) h += DAIS_H * smoothstep(DAIS_R + STEP_D * 3, DAIS_R, f.dSpawn);
  // 城墙外面：一路往上的山
  if (f.dEdge < 1.1) {
    const o = -f.dEdge;
    h += smoothstep(0.4, 4, o) * 1.3 + smoothstep(2, 20, o) * (3.2 + 6.5 * fbm(x * 0.06, z * 0.06, 3, 55) + 2.4 * ridge(x * 0.09, z * 0.09, 2, 56));
  }
  return h;
}

/** 这个位置离地图中心沿哪条线量（给摆东西的代码用）：是不是在我方一侧 */
export const teamAt = (x: number, z: number): 0 | 1 => (toLane(x, z)[0] < 0 ? 0 : 1);
export const SPAWN_A = A_CORNER - FOUNTAIN_D;
