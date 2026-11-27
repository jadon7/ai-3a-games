// 整张地图的地面布局图（阶段 2.4 先当占位的地面用；2.5 画地面时它就是重绘的底稿）。
// 草地、兵线的石板、塔脚下的圆、河床沿用样板间那一套（slice/guide.ts），这里补上样板间里没有的：
// 基地广场的铺地、出生点的台子、营地的土、Boss 的石台、城墙外面的山。

import { fbm, hash2, smoothstep } from "../../core/noise";
import { A_CORNER, CORE_D, fields } from "../layout";
import { GRASS2, E_GRASS2, MOSS, E_MOSS, mix, surface } from "../slice/guide";
import { DAIS_R, plateau } from "../terrain";
import { TOON_ON } from "../toon";

// 广场的颜色照 2.2 的出生点设计稿量的：我方是偏冷的浅灰白石，隔几圈嵌一圈青灰色的；对方是深灰玄武岩，隔几圈嵌一圈赤陶色的
// 画风 B：我方广场比路上的石板略暗一点的米灰（不然在卡通光下发白过曝），嵌一圈青灰；对方深灰带暖，嵌一圈赤陶。营地的土只比草地黄一点 / 比红土深一点（深了像一块污渍）；城墙外是深一档的草和灰石
const B = TOON_ON;
const PLAZA = B ? [190, 188, 170] : [174, 171, 156], E_PLAZA = B ? [118, 106, 100] : [98, 92, 90], RING = B ? [146, 174, 168] : [136, 152, 142], E_RING = B ? [176, 104, 72] : [132, 92, 72], JOINT = B ? [140, 150, 122] : [116, 120, 98], E_JOINT = B ? [84, 70, 64] : [62, 54, 52];
const DIRT = B ? [168, 172, 96] : [124, 111, 70], E_DIRT = B ? [178, 88, 56] : [142, 98, 72], ROCK = B ? [128, 136, 124] : [108, 110, 100], E_ROCK = B ? [112, 92, 84] : [96, 84, 78], ISLE = B ? [160, 172, 150] : [121, 126, 108];

/** 一圈一圈的弧形石板。rc 是到圆心的距离，ang 是角度。返回到石板边的距离和这块石板的编号 */
function rings(rc: number, ang: number, RW: number, arc: number, seed: number) {
  const k = Math.floor(rc / RW), rm = (k + 0.5) * RW, n = Math.max(6, Math.round((Math.PI * 2 * rm) / arc)), seg = (ang / (Math.PI * 2)) * n + hash2(k, 0, seed), si = Math.floor(seg), fr = seg - si;
  return { d: Math.min(rc - k * RW, (k + 1) * RW - rc, Math.min(fr, 1 - fr) * ((Math.PI * 2 * rm) / n)), tone: hash2(si, k, seed + 1), k };
}

export function worldColor(x: number, z: number): number[] {
  const f = fields(x, z), s = surface(x, z, f), foe = smoothstep(-3, 3, f.u);
  let c = s.c;
  // 营地：踩秃了的土，边是虚的
  if (f.dCamp < 1.2 && s.stone < 0.3 && s.under < 0.1) c = mix(c, mix(DIRT, E_DIRT, foe).map(q => q * (0.94 + fbm(x * 0.9, z * 0.9, 2, 63) * 0.12)), smoothstep(0.9, -1.8, f.dCamp + (fbm(x * 0.4, z * 0.4, 2, 61) - 0.5) * 1.8) * 0.72);
  // Boss 的石台：一整块灰绿的岩石，顶上有苔
  if (f.dIsland < 1) c = mix(c, mix(ISLE.map(q => q * (0.9 + fbm(x * 0.5, z * 0.5, 2, 33) * 0.2)), MOSS, smoothstep(0.5, 0.7, fbm(x * 0.8, z * 0.8, 2, 34)) * 0.5), smoothstep(0.6, -0.3, f.dIsland + (fbm(x * 0.7, z * 0.7, 2, 31) - 0.5) * 0.7));
  // 基地广场：围着水晶一圈圈铺开的大石板，比兵线上的石板白、整齐；口子的台阶底下也是石头
  const p = plateau(f.a, f.w, f.dBase);
  if (p > 0.02 && f.dEdge > -0.2) {
    const ca = A_CORNER - CORE_D, onDais = f.dSpawn < DAIS_R + 1.6;
    const r = onDais ? rings(f.dSpawn, Math.atan2(f.w, f.a - (A_CORNER - 8)), 1.5, 2.0, 95) : rings(Math.hypot(f.a - ca, f.w), Math.atan2(f.w, f.a - ca), 2.3, 2.9, 91);
    const accent = !onDais && r.k % 4 === 3;                                  // 每隔几圈有一圈嵌色的
    const slab = mix(accent ? RING : PLAZA, accent ? E_RING : E_PLAZA, foe).map(q => q * (0.93 + r.tone * 0.13) * (onDais ? 1.05 : 1));
    const creep = smoothstep(0.52, 0.72, fbm(x * 0.5, z * 0.5, 3, 97)) * smoothstep(-9, -1.5, f.dBase) * (B ? 0.3 : 0.6);     // 靠着墙根的地方有草和苔爬上来（B 少一半）
    const pc = mix(mix(mix(JOINT, E_JOINT, foe), slab, smoothstep(0.03, 0.1, r.d)), mix(MOSS, E_MOSS, foe), creep);
    c = mix(c, pc, smoothstep(0.02, 0.5, p));
  }
  // 城墙外面：暗一些的草和露出来的岩石
  if (f.dEdge < 2.4) {
    // B：墙外是深一档的草（不是灰的空地），石头只零星几块——厚涂版那片灰石在 B 的亮光下是最扎眼的一块浅灰
    const rocky = B ? smoothstep(0.56, 0.7, fbm(x * 0.085, z * 0.085, 3, 77)) * 0.7 : smoothstep(0.42, 0.6, fbm(x * 0.085, z * 0.085, 3, 77) + smoothstep(4, 16, -f.dEdge) * 0.12);
    const wild = mix(GRASS2, E_GRASS2, foe).map(q => q * ((B ? 0.8 : 0.66) + fbm(x * 0.2, z * 0.2, 2, 79) * 0.16));              // 墙外不铺石板，只有野草和石头
    const o = mix(wild, mix(ROCK, E_ROCK, foe).map(q => q * (0.85 + fbm(x * 0.3, z * 0.3, 2, 78) * 0.3)), rocky);
    c = mix(c, o, smoothstep(2.4, 0.2, f.dEdge));
  }
  return c;
}

/** 把一块地面画到画布上。cx、cz 是这块的中心，sizeM 是边长（米） */
export function renderWorldGuide(cv: HTMLCanvasElement, cx: number, cz: number, sizeM: number, px: number) {
  cv.width = cv.height = px;
  const g = cv.getContext("2d")!, img = g.createImageData(px, px), k = sizeM / px;
  for (let j = 0; j < px; j++) for (let i = 0; i < px; i++) {
    const c = worldColor(cx - sizeM / 2 + (i + 0.5) * k, cz - sizeM / 2 + (j + 0.5) * k), o = (j * px + i) * 4;
    img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}
