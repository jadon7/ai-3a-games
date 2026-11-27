// 草丛和地表的草：一片片叶子都是真的几何体（不是贴图面片），放大了看也是利落的。
//
// 第二版照设计稿调：
//   · 草丛的颜色跟着环境走：根部是暗的青绿（和它投在地上的影子连成一片），中段是比草地深一档的橄榄绿，
//     只有受光的叶尖亮成草地那种黄绿。不再是一整块鲜艳的翠绿。
//   · 草丛的边不是一刀切的：轮廓有进有出，边上的矮、中间的高，外面还有一圈半高的草，慢慢过渡到地表的短草；
//     草丛和背后的墙之间不留空，一直长到墙脚。
//   · 地表的草按画好的地面来长：画的是草的地方才长，石板缝里、路边长得密，把石板“缝”进草地里。
// 颜色跟着两侧走：我方青绿，对方红褐。

import * as THREE from "three";
import { fbm, rng, smoothstep } from "../../core/noise";
import { BRUSH, fields, toWorld } from "../layout";
import { PAINT_HALF, SLICE_X, SLICE_Z } from "./def";
import { WATER_Y, groundHeight, type Ground } from "./ground";
import type { Tuft } from "./stone";
import { TOON_ON } from "../toon";

/** 一片叶子：下面三分之一慢慢变宽，往上收成尖，整片往一边弯。高度是 1，摆的时候再放大 */
export function blade(segs: number, width: number, bend: number, curl = 2): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, prof = t < 0.3 ? 0.6 + 0.4 * (t / 0.3) : 1 - Math.pow((t - 0.3) / 0.7, 1.7), w = width * 0.5 * Math.max(prof, 0.015), z = bend * Math.pow(t, curl);
    pos.push(-w, t, z, w, t, z); uv.push(0, t, 1, t);
    if (i < segs) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  // 法线一律朝上：叶子受光均匀，明暗靠从根到梢的渐变，不会一片亮一片黑
  const n = new Float32Array((segs + 1) * 2 * 3); for (let i = 0; i < n.length; i += 3) n[i + 1] = 1;
  g.setAttribute("normal", new THREE.BufferAttribute(n, 3));
  return g;
}

const srgb = (c: number[]) => new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
/** 叶子的材质：根部一个颜色（暗），中段是每片叶子自己的颜色，叶尖按“这片叶子晒到多少太阳”往亮色走 */
export function bladeMaterial(time: { value: number }, sway: number, root: number[], tip: number[]): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 1, metalness: 0 }), uRoot = { value: srgb(root) }, uTip = { value: srgb(tip) };
  mat.onBeforeCompile = sh => {
    sh.uniforms.uTime = time; sh.uniforms.uRoot = uRoot; sh.uniforms.uTip = uTip;
    sh.vertexShader = ("uniform float uTime; attribute float aLit; varying float vT; varying float vLit;\n" + sh.vertexShader).replace("#include <begin_vertex>", `#include <begin_vertex>
      vT = uv.y; vLit = aLit;
      { vec3 ip_ = instanceMatrix[3].xyz; float ph_ = ip_.x * 0.71 + ip_.z * 0.53;
        float k_ = uv.y * uv.y * ${sway.toFixed(3)};
        transformed.x += (sin(uTime * 1.3 + ph_) + 0.5 * sin(uTime * 2.9 + ph_ * 1.7)) * k_;
        transformed.z += cos(uTime * 1.1 + ph_ * 1.3) * k_ * 0.6; }`);
    sh.fragmentShader = ("varying float vT; varying float vLit; uniform vec3 uRoot, uTip;\n" + sh.fragmentShader).replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\nnormal = normalize(vNormal);").replace("#include <color_fragment>", `#include <color_fragment>
      { vec3 c_ = mix(uRoot, diffuseColor.rgb, smoothstep(0.05, 0.62, vT));
        diffuseColor.rgb = mix(c_, uTip, smoothstep(0.45, 1.0, vT) * vLit); }`);
  };
  mat.customProgramCacheKey = () => `blade2:${sway}`;
  return mat;
}

const inSlice = (x: number, z: number, pad = 0) => Math.abs(x - SLICE_X) < PAINT_HALF - pad && Math.abs(z - SLICE_Z) < PAINT_HALF - pad;
// 颜色按屏幕上看到的颜色（sRGB）写，是照着设计稿量的：草丛暗部 (46,85,59)，中段 (64,99,62)，受光的叶尖 (144,168,89)；草地 (128,140,66)
export interface Look { root: number[]; mid: number[][]; tip: number[]; }
// 画风 B：照设计稿 B 量的颜色。草丛比草地暗一档（B 里草丛中段 (81,136,77)、根 (49,102,68)、受光的叶尖 (127,182,85)；草地是 (120,186,74)），
// 根偏青、叶尖偏黄绿，一丛里从下到上一条干净的渐变。对方草丛中段 (149,68,44)、根 (87,43,23)、叶尖 (202,118,68)
const BRUSH_B: Look[] = [
  { root: [0.13, 0.32, 0.23], mid: [[0.26, 0.5, 0.24], [0.3, 0.54, 0.25], [0.23, 0.46, 0.25], [0.33, 0.57, 0.24]], tip: [0.56, 0.74, 0.32] },
  { root: [0.32, 0.13, 0.08], mid: [[0.58, 0.26, 0.15], [0.63, 0.3, 0.16], [0.53, 0.23, 0.14], [0.68, 0.34, 0.18]], tip: [0.84, 0.5, 0.27] },
];
const GRASS_B: Look[] = [
  { root: [0.40, 0.62, 0.22], mid: [[0.48, 0.70, 0.28], [0.52, 0.73, 0.29], [0.45, 0.67, 0.27]], tip: [0.64, 0.80, 0.35] },
  { root: [0.62, 0.30, 0.16], mid: [[0.74, 0.38, 0.20], [0.78, 0.42, 0.22], [0.70, 0.35, 0.19]], tip: [0.86, 0.52, 0.28] },
];
export const BRUSH_LOOK: Look[] = TOON_ON ? BRUSH_B : [
  { root: [0.07, 0.2, 0.18], mid: [[0.2, 0.36, 0.24], [0.25, 0.4, 0.24], [0.17, 0.33, 0.26], [0.29, 0.42, 0.23]], tip: [0.62, 0.7, 0.36] },
  // 对方的草丛照 2.2 的对方野区设计稿（jungle_foe）调过：根是暗红褐，中段锈红，只有叶尖是橙黄，整体比红土地深一档
  { root: [0.15, 0.06, 0.07], mid: [[0.37, 0.16, 0.13], [0.43, 0.2, 0.14], [0.32, 0.13, 0.12], [0.47, 0.24, 0.15]], tip: [0.72, 0.42, 0.24] },
];
export const GRASS_LOOK: Look[] = TOON_ON ? GRASS_B : [
  { root: [0.34, 0.41, 0.17], mid: [[0.45, 0.52, 0.23], [0.5, 0.55, 0.25], [0.41, 0.49, 0.22]], tip: [0.63, 0.68, 0.33] },
  { root: [0.46, 0.25, 0.16], mid: [[0.64, 0.38, 0.25], [0.7, 0.43, 0.27], [0.58, 0.34, 0.23]], tip: [0.84, 0.58, 0.35] },
];

export type Inst = { x: number; y: number; z: number; yaw: number; lean: number; h: number; w: number; c: number[]; k: number; lit: number };
/** 一块草丛的全部叶子。P、Q 是这块草丛中线的两个端点，hw 是半宽。样板间和整张地图都用这一个函数，长出来的样子是一样的 */
export function brushBlades(out: Inst[], P: [number, number], Q: [number, number], hw: number, team: number, rd: () => number, heightAt: (x: number, z: number) => number) {
  const STEP = 0.42, RIM = 1.5, b = { hw }, look = BRUSH_LOOK[team];
  const dx = Q[0] - P[0], dz = Q[1] - P[1], L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L;
    for (let s = -b.hw - RIM; s <= L + b.hw + RIM; s += STEP) for (let t = -b.hw - RIM; t <= b.hw + RIM; t += STEP) {
      const js = s + (rd() - 0.5) * STEP * 0.9, jt = t + (rd() - 0.5) * STEP * 0.9, cs = Math.min(Math.max(js, 0), L), d = Math.hypot(js - cs, jt) / b.hw;   // 0 在中线，1 在草丛的边
      const x = P[0] + ux * js - uz * jt, z = P[1] + uz * js + ux * jt;
      // 轮廓有进有出
      let k = d / (0.88 + (fbm(x * 0.55, z * 0.55, 2, 33) - 0.5) * 0.46);
      // 贴着墙的那一侧一直长到墙脚，草丛和墙之间不留一条空地
      if (k > 0.85 && d < 1.7) { const f = fields(x, z); if (f.dWall < 0.8 && f.dWall > -0.28) k = Math.min(k, 0.8); else if (f.dWall <= -0.28) continue; }
      if (k > 1.32) continue;
      const y = heightAt(x, z); if (y < WATER_Y + 0.04) continue;
      const fringe = k > 1;
      if (fringe && rd() > 0.62 - (k - 1) * 1.4) continue;
      // 晒到太阳的多少：两三米大的斑，加上草丛边上的叶子比中间的亮
      const sun = 0.14 + smoothstep(0.4, 0.68, fbm(x * 0.33, z * 0.33, 2, 57)) * 0.6 + smoothstep(0.55, 1.0, k) * 0.2;
      const hgt = fringe ? 0.32 + rd() * 0.42 : (1.3 + rd() * 0.75) * (1 - smoothstep(0.5, 1.0, k) * 0.5), c = look.mid[Math.floor(rd() * look.mid.length)], tone = 0.86 + rd() * 0.26, n = fringe ? 4 + Math.floor(rd() * 2) : 7 + Math.floor(rd() * 3);
      for (let i = 0; i < n; i++) out.push({ x: x + (rd() - 0.5) * 0.12, y: y - 0.03, z: z + (rd() - 0.5) * 0.12, yaw: (i / n) * 6.283 + rd(), lean: i === 0 ? 0.03 + rd() * 0.08 : 0.08 + rd() * 0.34, h: hgt * (i === 0 ? 1.1 : 0.68 + rd() * 0.4), w: fringe ? 0.5 + rd() * 0.3 : 0.85 + rd() * 0.55, c, k: tone * (0.92 + rd() * 0.16), lit: Math.min(Math.max(sun * (0.5 + rd() * 0.9), 0.04), 1) });
    }
}

export function createFlora(time: { value: number }, ground: Ground, wallTufts: Tuft[]): THREE.Group {
  const group = new THREE.Group(); group.name = "flora";
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color();
  const build = (list: Inst[], geo: THREE.BufferGeometry, mat: THREE.Material, shadow: boolean, name: string) => {
    if (!list.length) return;
    const g = geo.clone(), lit = new Float32Array(list.length), im = new THREE.InstancedMesh(g, mat, list.length);
    list.forEach((b, i) => { im.setMatrixAt(i, m4.compose(new THREE.Vector3(b.x, b.y, b.z), q.setFromEuler(e.set(b.lean, b.yaw, 0, "YXZ")), new THREE.Vector3(b.w, b.h, b.h))); im.setColorAt(i, col.setRGB(b.c[0], b.c[1], b.c[2], THREE.SRGBColorSpace).multiplyScalar(b.k)); lit[i] = b.lit; });
    g.setAttribute("aLit", new THREE.InstancedBufferAttribute(lit, 1));
    // 草丛自己不接影子（不然叶子互相遮得发黑），明暗靠从根到梢的渐变
    im.castShadow = shadow; im.receiveShadow = !shadow; im.name = name; im.frustumCulled = false; group.add(im);
  };

  // ---- 草丛 ----
  const tall: Inst[][] = [[], []], rd = rng(4242);
  for (const b of BRUSH) for (const su of [-1, 1]) for (const sv of [-1, 1]) {
    const P = toWorld(su * b.p[0], sv * b.p[1]), Q = toWorld(su * b.q[0], sv * b.q[1]);
    if (!inSlice(P[0], P[1], -4) && !inSlice(Q[0], Q[1], -4)) continue;
    const team = su < 0 ? 0 : 1;
    brushBlades(tall[team], P, Q, b.hw, team, rd, groundHeight);
  }

  // ---- 地表的草 ----
  const short: Inst[][] = [[], []], r2 = rng(777), GSTEP = 0.3;
  const tuft = (x: number, y: number, z: number, hgt: number, team: number, lit: number, tone = 1) => {
    const look = GRASS_LOOK[team], c = look.mid[Math.floor(r2() * look.mid.length)], n = 4 + Math.floor(r2() * 4);
    for (let i = 0; i < n; i++) short[team].push({ x: x + (r2() - 0.5) * 0.1, y: y - 0.01, z: z + (r2() - 0.5) * 0.1, yaw: r2() * 6.283, lean: 0.12 + r2() * 0.6, h: hgt * (0.7 + r2() * 0.5), w: 0.55 + r2() * 0.4, c, k: tone * (0.9 + r2() * 0.22), lit: Math.min(lit * (0.5 + r2() * 0.9), 1) });
  };
  for (let z = SLICE_Z - PAINT_HALF + 1; z < SLICE_Z + PAINT_HALF - 1; z += GSTEP) for (let x = SLICE_X - PAINT_HALF + 1; x < SLICE_X + PAINT_HALF - 1; x += GSTEP) {
    const px = x + (r2() - 0.5) * GSTEP, pz = z + (r2() - 0.5) * GSTEP;
    if (ground.grassAt(px, pz) < 0.6) continue;                               // 画的不是草的地方不长
    const f = fields(px, pz);
    if (f.dRiver < 0.3 || f.dWall < -0.25 || f.dBrush < 0.25) continue;
    // 石板缝里、路边、塔脚下那圈石板之间：密而矮。草地上：按斑块稀稀地长，高一点
    const paved = Math.max(smoothstep(1.6, 0.2, f.dLane), smoothstep(7.5, 5.5, f.dTower)), patch = smoothstep(0.48, 0.7, fbm(px * 0.22, pz * 0.22, 3, 91));
    let prob = 0.035 + paved * 0.42 + patch * 0.3; if (f.dTrail < 0.4) prob *= 0.3;
    if (r2() > prob) continue;
    tuft(px, groundHeight(px, pz), pz, (paved > 0.5 ? 0.1 + r2() * 0.12 : 0.15 + r2() * 0.2) + patch * 0.07, f.u < 0 ? 0 : 1, 0.25 + patch * 0.5);
  }
  // 墙脚的一溜草和墙顶的几丛
  for (const t of wallTufts) {
    if (t.top && r2() < 0.3) {
      // 墙顶上隔一段冒出一小丛阔叶草：叶子短而宽，颜色跟草丛是一家
      const look = BRUSH_LOOK[t.team], n = 7 + Math.floor(r2() * 4), hgt = 0.3 + r2() * 0.28, c = look.mid[Math.floor(r2() * look.mid.length)];
      for (let i = 0; i < n; i++) tall[t.team].push({ x: t.x + (r2() - 0.5) * 0.1, y: t.y - 0.02, z: t.z + (r2() - 0.5) * 0.1, yaw: (i / n) * 6.283 + r2(), lean: 0.25 + r2() * 0.7, h: hgt * (0.7 + r2() * 0.5), w: 1.5 + r2() * 0.9, c, k: 1.0 + r2() * 0.2, lit: 0.45 + r2() * 0.5 });
    } else if (t.top || ground.grassAt(t.x, t.z) > 0.4) tuft(t.x, t.y, t.z, t.h, t.team, t.top ? 0.75 : 0.35, t.top ? 1.04 : 0.92);
  }
  const bladeTall = blade(6, 0.135, 0.46, 2.4);
  for (const team of [0, 1]) build(tall[team], bladeTall, bladeMaterial(time, 0.07, BRUSH_LOOK[team].root, BRUSH_LOOK[team].tip), true, "brush");
  const bladeShort = blade(3, 0.085, 0.32, 2);
  for (const team of [0, 1]) build(short[team], bladeShort, bladeMaterial(time, 0.022, GRASS_LOOK[team].root, GRASS_LOOK[team].tip), false, "grass");

  (group.userData as any).counts = { brush: tall[0].length + tall[1].length, grass: short[0].length + short[1].length };
  (group.userData as any).brush = BRUSH.flatMap(b => [-1, 1].flatMap(su => [-1, 1].map(sv => ({ p: toWorld(su * b.p[0], sv * b.p[1]), q: toWorld(su * b.q[0], sv * b.q[1]), hw: b.hw }))));
  return group;
}
