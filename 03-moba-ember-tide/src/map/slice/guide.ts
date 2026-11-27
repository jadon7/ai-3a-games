// 地面的布局图：告诉重绘“哪里是草、哪里是石板、石板怎么分块、哪里是河床”。
// 第二版照设计稿改了三件事：
//   1. 石板是磨圆了角的旧石板（一排一排、大小不一），不是一块块尖角的多边形；
//   2. 石板的颜色压到和草地接近（橄榄灰），不再是一条发白的路；
//   3. 草和苔从缝里、从路边爬上石板：路中间只有零星几块苔斑，越靠边盖得越多，最外面的石板半埋在草里。
// 建筑和地面的对应关系也在这里定：塔脚下一圈大石板加一圈窄的收边石，再往外散成路上那种石板。

import { hash2, fbm, smoothstep } from "../../core/noise";
import { fields } from "../layout";
import { TOON_ON } from "../toon";

export const mix = (a: number[], b: number[], t: number) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
// 颜色是从设计稿上量的：草 (128,140,66)，石板 (134,130,93)～(164,154,117)，缝里就是草的颜色
// 画风 B（换画风 B · b-toon）：颜色从 B 的两张设计稿量（art/concepts22/env_me_b.png、env_foe_b.png）。我方草地受光 (120,186,74)、阳光最足处 (181,215,92)；
// 石板是干净的浅米灰 (200,200,172)；水下的河底是浅灰蓝的大石板。对方红土 (197,98,61)～(212,117,69)，石板暖灰 (155,132,107)。
// 地面贴图拼接时大色块会拉回这张布局图的颜色（tools/map_ground_b.py），所以这里的颜色就是游戏里地面的底色
const B = TOON_ON;
export const GRASS = B ? [124, 186, 74] : [128, 140, 66], GRASS2 = B ? [104, 168, 70] : [113, 131, 60], STONE = B ? [198, 197, 172] : [154, 147, 110], MOSS = B ? [118, 172, 70] : [106, 124, 58], BANK = B ? [98, 150, 68] : [88, 106, 58];
const BED_SAND = B ? [112, 146, 146] : [82, 98, 98], BED_STONE = B ? [168, 190, 188] : [124, 138, 136], WET_STONE = B ? [168, 182, 172] : [126, 132, 116];
// 对方一侧：红土地、红褐矮草、偏暗偏暖的石板
export const E_GRASS = B ? [200, 102, 62] : [170, 102, 70], E_GRASS2 = B ? [186, 92, 58] : [152, 90, 64], E_STONE = B ? [158, 136, 110] : [158, 134, 114], E_MOSS = B ? [176, 92, 54] : [138, 88, 60], E_BANK = B ? [156, 82, 52] : [116, 76, 56];

/** 两条边各自的“离边多远”合成一个圆角：离角远的地方就是较近那条边的距离 */
const roundIn = (a: number, b: number, r: number) => (a > r && b > r ? Math.min(a, b) : r - Math.hypot(Math.max(r - a, 0), Math.max(r - b, 0)));

/** 路上的旧石板：沿着路一排一排铺，每排的宽窄、每块的长短都不一样，有的一块裂成两块。d 是到石板边的距离（里面为正） */
function flag(u: number, v: number) {
  const RH = 2.05, GAP = 0.06;
  const vb = (k: number) => k * RH + (hash2(k, 7, 31) - 0.5) * 0.8;
  let k = Math.floor(v / RH); if (v < vb(k)) k--; else if (v >= vb(k + 1)) k++;
  let v0 = vb(k), v1 = vb(k + 1);
  const L = 2.0 + hash2(k, 3, 32) * 1.2, off = hash2(k, 5, 33) * L;
  const ub = (m: number) => m * L + off + (hash2(k, m, 34) - 0.5) * L * 0.5;
  let m = Math.floor((u - off) / L); if (u < ub(m)) m--; else if (u >= ub(m + 1)) m++;
  let u0 = ub(m), u1 = ub(m + 1), sub = 0;
  const pick = hash2(k, m, 36);
  if (pick < 0.3 && u1 - u0 > 1.5) { const mid = (v0 + v1) / 2 + (hash2(k, m, 37) - 0.5) * 0.3; if (v < mid) { v1 = mid; sub = 1; } else { v0 = mid; sub = 2; } }
  else if (pick > 0.72 && u1 - u0 > 2.2) { const mid = (u0 + u1) / 2 + (hash2(k, m, 38) - 0.5) * 0.4; if (u < mid) { u1 = mid; sub = 3; } else { u0 = mid; sub = 4; } }
  const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2, id = hash2(k * 131 + m, sub, 35);
  const d = roundIn((u1 - u0) / 2 - GAP - Math.abs(u - cu), (v1 - v0) / 2 - GAP - Math.abs(v - cv), 0.2 + id * 0.22);
  return { d, id, cu, cv };
}

/** 河底的大扁石：一块挨一块，圆的 */
function cobble(u: number, v: number, size: number) {
  const x = u / size, y = v / size, xi = Math.floor(x), yi = Math.floor(y);
  let d1 = 9, d2 = 9, id = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const px = xi + i + 0.18 + hash2(xi + i, yi + j, 11) * 0.64, py = yi + j + 0.18 + hash2(xi + i, yi + j, 12) * 0.64, d = Math.hypot(x - px, y - py);
    if (d < d1) { d2 = d1; d1 = d; id = hash2(xi + i, yi + j, 13); } else if (d < d2) d2 = d;
  }
  return { edge: (d2 - d1) * size, id };
}

export interface Surface { c: number[]; stone: number; under: number; }

/** 地面上一点是什么：颜色、露出来的石板有多少（0 草 ～ 1 石板）、是不是在水下 */
export function surface(x: number, z: number, f = fields(x, z)): Surface {
  const foe = smoothstep(-3, 3, f.u);                       // 0 = 我方一侧，1 = 对方一侧，隔着河道换色
  // 草地：两种绿之间很缓的变化
  const gn = smoothstep(0.3, 0.7, fbm(x * 0.06, z * 0.06, 3, 21));
  const grass = mix(mix(GRASS, GRASS2, gn), mix(E_GRASS, E_GRASS2, gn), foe);
  // 河岸：草越靠水越深、越湿，没有一条沙带（设计稿里岸边是深色的苔）
  const bankD = f.dRiver + (fbm(x * 0.35, z * 0.35, 2, 8) - 0.5) * 0.9;
  let base = mix(grass, mix(BANK, E_BANK, foe), smoothstep(1.25, 0.25, bankD) * 0.8);
  const under = smoothstep(0.3, -0.1, f.dRiver + (fbm(x * 0.9, z * 0.9, 2, 14) - 0.5) * 0.35);
  // 河底：细沙上一块挨一块的大扁石，靠岸的浅处石头小而稀
  if (under > 0) {
    const cb = cobble(f.u + 40, f.v, 1.75), deep = smoothstep(0.1, -1.3, f.dRiver);
    const st = smoothstep(0.05, 0.2, cb.edge + (fbm(x * 2.1, z * 2.1, 2, 9) - 0.5) * 0.1) * (0.5 + deep * 0.5) * (cb.id < 0.45 + deep * 0.5 ? 1 : 0) * smoothstep(-0.6, 1.2, f.dLane);
    const bed = mix(BED_SAND, BED_STONE.map(q => q * (0.86 + cb.id * 0.26)), st);
    base = mix(base, bed, under);
  }

  // 石板。每块算不算“路”看它的中心：路中间全是，路的边是弯弯曲曲的，最外面几块散在草里
  const wob = (fbm(f.u * 2.3, f.v * 2.3, 2, 61) - 0.5) * 0.15;
  const wander = (fbm(x * 0.16, z * 0.16, 2, 44) - 0.5) * 2.4;
  // 石板的格子先揉一下再用：排不是笔直的，块也不是正方正的
  const wu = (fbm(x * 0.22, z * 0.22, 2, 81) - 0.5) * 1.5, wv = (fbm(x * 0.22, z * 0.22, 2, 82) - 0.5) * 1.5;
  const s = flag(f.u + wu, f.v + wv), [cx, cz] = [(s.cu - wu + s.cv - wv) / Math.SQRT2, (s.cv - wv - s.cu + wu) / Math.SQRT2], fc = fields(cx, cz);
  const keep = Math.max(smoothstep(1.5, -0.6, fc.dLane + (fbm(cx * 0.16, cz * 0.16, 2, 44) - 0.5) * 2.4), smoothstep(7.6, 4.6, fc.dTower) * 0.9);
  let on = s.id * 0.999 < keep, d = s.d + wob, tone = s.id;
  let edgeAmt = smoothstep(-1.7, 0.9, f.dLane + wander);                      // 0 = 路中间，1 = 路边和路外
  // 塔脚下：正中一块垫着塔座，一圈十块大石板，一圈窄窄的收边石，再往外一圈缺了几块、被草盖住大半
  if (f.dTower < 3.78) {
    const [tu, tv] = [f.a - f.tower[0], f.w - f.tower[1]], r = f.dTower, ang = Math.atan2(tv, tu);
    const rings = [1.95, 3.3, 3.74], counts = [1, 10, 26], gaps = [0.05, 0.06, 0.035], rads = [0.1, 0.18, 0.05];
    let k = rings.findIndex(q => r < q); if (k < 0) k = 2;
    const n = counts[k], seg = (ang / (Math.PI * 2) + 0.5) * n + k * 0.37, si = Math.floor(seg), fr = seg - si;
    const a = Math.min(r - (k ? rings[k - 1] : -9), rings[k] - r) - gaps[k], b = k === 0 ? 9 : Math.min(fr, 1 - fr) * ((Math.PI * 2 * r) / n) - gaps[k];
    d = roundIn(a, b, rads[k]) + wob * (k === 2 ? 0.3 : 0.7); tone = hash2(si, k, 17); on = true;
    edgeAmt = 0.12;
  } else if (f.dTower < 7.6) {
    // 圈外面是散开的石板：离塔越远越少、被草盖得越多，圆和路之间没有一条硬边
    d = Math.min(d, f.dTower - 3.78 - 0.08); edgeAmt = Math.min(edgeAmt + 0.2, smoothstep(3.9, 7.0, f.dTower));
  }
  // 爬上石板的草和苔：一两米大的斑。路中间很少，越靠边越多
  const g1 = fbm(x * 0.5, z * 0.5, 3, 51), th = B ? 0.9 - edgeAmt * 0.38 : 0.78 - edgeAmt * 0.4;      // B：路中间的石板几乎不长苔，只有路边散进草里的几块被草盖住
  const over = smoothstep(th - 0.09, th + 0.09, g1 + (fbm(x * 2.6, z * 2.6, 2, 52) - 0.5) * 0.12) * (1 - under * 0.8);
  const stone = on ? smoothstep(0.0, 0.1 + edgeAmt * 0.22, d) * (1 - over * 0.94) : 0;
  let c = base;
  if (on) {
    let sc = mix(STONE, E_STONE, foe).map(q => q * (0.9 + tone * 0.2));
    sc = mix(sc, mix(MOSS, E_MOSS, foe), smoothstep(0.42, 0.72, fbm(x * 1.2, z * 1.2, 2, 71)) * (B ? 0.06 : 0.34));        // 石板自己也带一点苔色，和草地是一家（B 的石板是干净的）
    sc = mix(sc, WET_STONE.map(q => q * (0.88 + tone * 0.2)), under * 0.8);
    c = mix(mix(base, base.map(q => q * (B ? 0.94 : 0.86)), smoothstep(0.25, 0.0, d) * (1 - under)), sc, stone);            // 缝里的草比外面暗一点（B 的缝里是亮绿的草）
  }
  return { c, stone, under };
}

export const guideColor = (x: number, z: number) => surface(x, z).c;

/** 把一块地面画到画布上。cx、cz 是这块的中心，sizeM 是边长（米） */
export function renderGuide(cv: HTMLCanvasElement, cx: number, cz: number, sizeM: number, px: number) {
  cv.width = cv.height = px;
  const g = cv.getContext("2d")!, img = g.createImageData(px, px), k = sizeM / px;
  for (let j = 0; j < px; j++) for (let i = 0; i < px; i++) {
    const c = guideColor(cx - sizeM / 2 + (i + 0.5) * k, cz - sizeM / 2 + (j + 0.5) * k), o = (j * px + i) * 4;
    img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}
