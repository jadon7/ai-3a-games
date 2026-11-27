// 样板间（阶段 2.3）的范围：中路外塔到河边。
// 地面按世界坐标画成一个 60 米见方的正方形，中心就是防御塔：这样塔脚下那圈同心圆地砖完整地落在正中那块重绘图里，不会被接缝切开。
// 镜头只在中间三十米里活动，看不到画的边。
import { toWorld } from "../layout";

export const [SLICE_X, SLICE_Z] = toWorld(-22, 0);
export const PAINT_HALF = 30;                 // 画出来的地面半边长
export const CAM_HALF = 16;                   // 镜头目标能移动的半边长
export const TILE_M = 24, STRIDE_M = 18, TILES = 3;   // 重绘时切成 3×3 块，每块 24 米、相邻重叠 6 米
export const tileCenter = (i: number, j: number): [number, number] => [SLICE_X + (i - 1) * STRIDE_M, SLICE_Z + (j - 1) * STRIDE_M];
