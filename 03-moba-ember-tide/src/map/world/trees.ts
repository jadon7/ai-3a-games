// 树和枯木（阶段 2.6）。
//   · 树只长在城墙外面：一棵树是一根树干加几团大叶团，叶团朝光的一面亮、背光的一面暗，不做一片片的碎叶。
//     我方是圆冠的绿树，夹着几棵深色的尖冠树和开粉花的树；对方是火红的枫、暗红的树，夹着光秃的枯树。
//     离城墙越远越暗，融进背景里。北边、西边的树会把长长的影子投进地图里。
//   · 枯木在地图里面：倒在墙脚的枯树干、营地和河岸边的树桩，都贴着墙或者在角落里，不挡路；我方长苔，对方焦黑。
// 都是在代码里建的模型，按 26 米一格合并，镜头外的不画。
//
// 换画风 B（b-walls）：叶团更圆、更鼓（表面的起伏压小；小叶团没有再细分，一百多棵树每棵多四五百个面不划算），颜色换成明快的（toon.ts 的 TREE_B，开着画风 B 时覆盖 LOOK；我方鲜绿、对方亮橙红的枫），
// 叶团上的斑块对比压低，树皮换干净的贴图、颜色提亮。树、倒木、树桩的位置和随机数一个不动（倒木和树桩会挡路）。

import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { fbm, rng, smoothstep } from "../../core/noise";
import { fields, toLane, toWorld } from "../layout";
import { curveOf, stoneMaterial, texB, tint, type StoneTextures } from "../slice/stone";
import { WATER_Y, terrainHeight } from "../terrain";
import { edgeLine } from "./ramparts";
import { TOON_ON, TREE_B } from "../toon";

type G = THREE.BufferGeometry;
type RGB = [number, number, number];
const CELL = 26;
const lin = (c: RGB) => { const k = new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace); return [k.r, k.g, k.b] as RGB; };

/** 一团叶子：鼓鼓囊囊的一个球，底下压平。颜色从底下的暗色过渡到顶上的亮色 */
function leafBlob(seed: number, rx: number, ry: number, rz: number, detail: number, dark: RGB, base: RGB, hi: RGB, tone: number): G {
  // 先把重合的顶点并起来，算出来的法线才是圆润的（不然每个小三角面各亮各的，像折纸）
  const raw = new THREE.IcosahedronGeometry(1, detail); raw.deleteAttribute("uv"); raw.deleteAttribute("normal");
  const g = mergeVertices(raw), p = g.getAttribute("position"), v = new THREE.Vector3(), col = new Float32Array(p.count * 3);
  const d = lin(dark), b = lin(base), h = lin(hi);
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = fbm(v.x * 1.6 + seed * 0.37, v.y * 1.6 + v.z * 1.3 + seed, 2, seed) - 0.5, n2 = fbm(v.x * 4.2 + seed, v.z * 4.2 + v.y * 3.1, 2, seed + 7) - 0.5;
    v.multiplyScalar(1 + n * 0.3 + n2 * 0.07);      // 画风 B：起伏压小，是一个鼓鼓的圆团，不是一团乱叶
    if (v.y < -0.3) v.y = -0.3 + (v.y + 0.3) * 0.35;
    const t = smoothstep(-0.35, 0.95, v.y) * (0.9 + n2 * 0.3), k = tone * (0.95 + n * 0.16);
    for (let c = 0; c < 3; c++) col[i * 3 + c] = (t < 0.5 ? d[c] + (b[c] - d[c]) * (t / 0.5) : b[c] + (h[c] - b[c]) * ((t - 0.5) / 0.5)) * k;
    p.setXYZ(i, v.x * rx, v.y * ry, v.z * rz);
  }
  g.computeVertexNormals(); g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return g;
}
/** 一根树干或树枝：沿着几个点走的一根管子，从 r0 收到 r1 */
function limb(pts: THREE.Vector3[], r0: number, r1: number, seed: number, flare = 0, k = 1, capK = k, N = 7): G {
  const cv = new THREE.CatmullRomCurve3(pts), M = Math.max(3, pts.length * 2), pos: number[] = [], col: number[] = [];
  const ring = (t: number) => {
    const c = cv.getPoint(t), tg = cv.getTangent(t), a = new THREE.Vector3(Math.abs(tg.y) > 0.7 ? 1 : 0, Math.abs(tg.y) > 0.7 ? 0 : 1, 0).cross(tg).normalize(), b2 = tg.clone().cross(a).normalize(), r = (r0 + (r1 - r0) * t) * (1 + flare * Math.pow(1 - t, 6));
    return Array.from({ length: N }, (_, j) => { const th = (j / N) * 6.283, rr = r * (1 + (fbm(th * 1.3 + seed, t * 5 + seed * 0.3, 2, seed) - 0.5) * 0.45); return c.clone().addScaledVector(a, Math.cos(th) * rr).addScaledVector(b2, Math.sin(th) * rr); });
  };
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, kk: number) => { pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z); col.push(kk, kk, kk, kk, kk, kk, kk, kk, kk); };
  const first = ring(0); let prev = first;
  for (let i = 1; i <= M; i++) {
    const cur = ring(i / M), g0 = k * (0.72 + 0.28 * Math.min(((i - 1) / M) * 2.5, 1)), g1 = k * (0.72 + 0.28 * Math.min((i / M) * 2.5, 1));      // 贴着根的一截暗一点
    for (let j = 0; j < N; j++) { const a = prev[j], b = prev[(j + 1) % N], c = cur[j], d = cur[(j + 1) % N]; tri(a, d, c, (g0 + g1) / 2); tri(a, b, d, (g0 + g1) / 2); }
    prev = cur;
  }
  { const c0 = cv.getPoint(0), c1 = cv.getPoint(1); for (let j = 0; j < N; j++) { tri(prev[j], prev[(j + 1) % N], c1, capK); tri(first[(j + 1) % N], first[j], c0, capK); } }      // 两头封口
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals();
  return g;
}

interface TreeLook { dark: RGB; base: RGB; hi: RGB; }
const LOOK = {
  round: [{ dark: [0.07, 0.17, 0.13], base: [0.2, 0.33, 0.17], hi: [0.42, 0.52, 0.24] }, { dark: [0.06, 0.16, 0.15], base: [0.15, 0.3, 0.21], hi: [0.32, 0.47, 0.28] }] as TreeLook[],
  spire: [{ dark: [0.04, 0.11, 0.11], base: [0.1, 0.22, 0.17], hi: [0.22, 0.36, 0.23] }] as TreeLook[],
  bloom: [{ dark: [0.36, 0.22, 0.31], base: [0.66, 0.47, 0.55], hi: [0.86, 0.7, 0.75] }] as TreeLook[],
  maple: [{ dark: [0.26, 0.08, 0.06], base: [0.56, 0.23, 0.11], hi: [0.8, 0.47, 0.19] }, { dark: [0.19, 0.05, 0.06], base: [0.4, 0.12, 0.1], hi: [0.64, 0.26, 0.15] }] as TreeLook[],
};
if (TOON_ON) Object.assign(LOOK, TREE_B);      // 画风 B 的树叶颜色（toon.ts 里）：更亮更清爽，粉树不再被冷色天光照成紫球


export interface Trees { group: THREE.Group; contact: { lines: { pts: [number, number][]; w: number; a: number }[]; circles: { x: number; z: number; r: number; a: number }[] }; count: { trees: number; logs: number; stumps: number }; }

export function createTrees(tex: StoneTextures, time: { value: number }, solids: { x: number; z: number; r: number }[], wallLines: [number, number][][]): Trees {
  const group = new THREE.Group(); group.name = "trees";
  const leaf = new Map<string, G[]>(), bark = new Map<string, G[]>();
  const into = (m: Map<string, G[]>, team: number, x: number, z: number) => { const key = `${team}:${Math.floor(x / CELL)},${Math.floor(z / CELL)}`; if (!m.has(key)) m.set(key, []); return m.get(key)!; };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
  const lines: Trees["contact"]["lines"] = [], circles: Trees["contact"]["circles"] = []; const count = { trees: 0, logs: 0, stumps: 0 };
  const place = (g: G, x: number, y: number, z: number, yaw: number) => g.applyMatrix4(m4.compose(new THREE.Vector3(x, y, z), q.setFromEuler(e.set(0, yaw, 0)), one));

  // ---------------------------------------------------------------- 城墙外面的树
  function tree(x: number, z: number, team: number, rd: () => number, shade: number) {
    const y = terrainHeight(x, z), yaw = rd() * 6.283, roll = rd(), seed = Math.floor(rd() * 1e5);
    const kind = team === 0 ? (roll < 0.1 ? "bloom" : roll < 0.3 ? "spire" : "round") : roll < 0.3 ? "snag" : "maple";
    const H = kind === "spire" ? 7.5 + rd() * 3.5 : 5.2 + rd() * 3.2, R = kind === "spire" ? 1.6 + rd() * 0.5 : 2.3 + rd() * 1.2, lean = (rd() - 0.5) * 0.9;
    const tr = into(bark, team, x, z), lf = into(leaf, team, x, z), tk = shade * (team === 0 ? 1 : kind === "snag" ? 1.25 : 0.85);
    // 树干：根部撇开，略歪
    const top = kind === "snag" ? H * 0.95 : H - R * 0.2;
    tr.push(place(limb([new THREE.Vector3(0, -0.3, 0), new THREE.Vector3(lean * 0.25, top * 0.4, 0.1), new THREE.Vector3(lean * 0.7, top * 0.75, -0.1), new THREE.Vector3(lean, top, 0)], 0.36 + R * 0.06, kind === "snag" ? 0.07 : 0.16, seed, 0.9, tk), x, y, z, yaw));
    if (kind === "snag") {
      // 枯树：光秃的树干上几根断枝
      for (let k = 0; k < 3 + Math.floor(rd() * 2); k++) { const h0 = H * (0.42 + rd() * 0.4), a = rd() * 6.283, len = 1.3 + rd() * 1.6, bx = lean * (h0 / top); tr.push(place(limb([new THREE.Vector3(bx, h0, 0), new THREE.Vector3(bx + Math.cos(a) * len * 0.55, h0 + len * 0.45, Math.sin(a) * len * 0.55), new THREE.Vector3(bx + Math.cos(a) * len, h0 + len * (0.6 + rd() * 0.5), Math.sin(a) * len)], 0.13, 0.03, seed + k, 0, tk), x, y, z, yaw)); }
    } else {
      const lk = LOOK[kind as keyof typeof LOOK], look = lk[Math.floor(rd() * lk.length)], tone = shade * (0.88 + rd() * 0.24);
      const blob = (ox: number, oy: number, oz: number, r: number, ry: number, det: number) => { const g = leafBlob(seed + lf.length, r, ry, r * (0.85 + rd() * 0.3), det, look.dark, look.base, look.hi, tone); g.rotateY(rd() * 6.283); lf.push(place(g.translate(ox + lean, oy, oz), x, y, z, yaw)); };
      if (kind === "spire") { blob(0, H * 0.42, 0, R * 1.0, H * 0.3, 2); blob(0, H * 0.68, 0, R * 0.78, H * 0.26, 2); blob(0, H * 0.92, 0, R * 0.5, H * 0.22, 1); }
      else {
        blob(0, H, 0, R, R * 0.82, 2); blob((rd() - 0.5) * R * 0.5, H + R * 0.55, (rd() - 0.5) * R * 0.5, R * 0.62, R * 0.52, 2);
        const n = 4 + Math.floor(rd() * 2); for (let k = 0; k < n; k++) { const a = (k / n) * 6.283 + rd() * 0.6, d = R * (0.68 + rd() * 0.2), r = R * (0.5 + rd() * 0.22); blob(Math.cos(a) * d, H - R * (0.05 + rd() * 0.35), Math.sin(a) * d, r, r * 0.78, 1); }
      }
    }
    count.trees++;
  }
  const edge = edgeLine();
  for (const su of [-1, 1]) for (const sv of [-1, 1]) {
    const cv = curveOf(edge.map(([a, w]) => toWorld(su * a, sv * w) as [number, number])), rd = rng(7300 + (su + 1) * 31 + (sv + 1) * 17);
    for (let s = 5; s < cv.L - 2; s += 2.6 + rd() * 2.2) for (let row = 0; row < 2; row++) {
      if (row === 1 && rd() < 0.3) continue;
      const p = cv.at(s + (rd() - 0.5) * 2), f0 = fields(p.x, p.z); if (f0.a < 15 || f0.dSpawn < 15) continue;      // 河道两头是山崖，基地的角留给 2.7
      const sign = fields(p.x - p.tz * 2, p.z + p.tx * 2).dEdge < f0.dEdge ? 1 : -1, south = p.tx * sign > 0.5;      // 墙外的方向朝南（朝着镜头）
      if (south && row === 0) continue;                                         // 镜头朝北看：南墙外贴墙的一排树会挡住下路的画面，不种
      const off = row === 0 ? 3.4 + rd() * 4.2 : (south ? 13 : 9) + rd() * 7.5, x = p.x - p.tz * sign * off, z = p.z + p.tx * sign * off;
      if (solids.some(c => Math.hypot(c.x - x, c.z - z) < c.r * 0.9 + 1.6)) continue;
      tree(x, z, toLane(x, z)[0] < 0 ? 0 : 1, rd, 1 - smoothstep(6, 19, off) * 0.5);
    }
  }

  // ---------------------------------------------------------------- 地图里面的枯木
  /** 一根倒在地上的枯树干：一头是断口，带一两根断枝 */
  function log(x: number, z: number, yaw: number, len: number, r: number, team: number, rd: () => number) {
    const y = terrainHeight(x, z), seed = Math.floor(rd() * 1e5), tr = into(bark, team, x, z), h = len / 2, k = team === 0 ? 1 : 0.95;
    tr.push(place(limb([new THREE.Vector3(-h, r * 0.86, 0), new THREE.Vector3(-h * 0.3, r * 0.92, 0.12), new THREE.Vector3(h * 0.4, r * 0.84, -0.08), new THREE.Vector3(h, r * 0.74, 0.05)], r, r * 0.74, seed, 0, k, k * 2.2, 11), x, y, z, yaw));
    for (let j = 0; j < 1 + Math.floor(rd() * 2); j++) { const t = (rd() - 0.5) * len * 0.6, sd = rd() < 0.5 ? -1 : 1, bl = 0.5 + rd() * 0.6; tr.push(place(limb([new THREE.Vector3(t, r * 0.9, 0), new THREE.Vector3(t + 0.15, r * 1.3 + bl * 0.4, sd * bl * 0.5), new THREE.Vector3(t + 0.3, r * 1.4 + bl * 0.7, sd * bl)], r * 0.3, 0.035, seed + j + 1, 0, k), x, y, z, yaw)); }
    const c = Math.cos(yaw), s = Math.sin(yaw); lines.push({ pts: [[x - c * h, z + s * h], [x + c * h, z - s * h]], w: r * 2.6, a: 0.42 }); count.logs++;
  }
  /** 一个树桩：短短一截，根往四面撇开 */
  function stump(x: number, z: number, team: number, rd: () => number) {
    const y = terrainHeight(x, z), seed = Math.floor(rd() * 1e5), r = 0.42 + rd() * 0.28, hgt = 0.4 + rd() * 0.45, tr = into(bark, team, x, z), k = team === 0 ? 1 : 0.95;
    tr.push(place(limb([new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(0.02, hgt * 0.5, 0), new THREE.Vector3(0.05, hgt, 0.02)], r * 1.05, r * 0.86, seed, 1.5, k, k * 2.4), x, y, z, rd() * 6.283));
    circles.push({ x, z, r: r * 2.4, a: 0.4 }); count.stumps++;
  }
  // 倒木：每隔两段墙放一根，贴着墙脚、顺着墙的走向，躺在背着草丛和路的那一侧
  wallLines.forEach((P, wi) => {
    if (wi % 2 !== 1) return;
    const rd = rng(8100 + wi * 13), cv = curveOf(P); if (cv.L < 7) return;
    const s = cv.L * (0.3 + rd() * 0.4), p = cv.at(s);
    for (const sd of rd() < 0.5 ? [1, -1] : [-1, 1]) {
      const x = p.x - p.tz * sd * 1.6, z = p.z + p.tx * sd * 1.6, f = fields(x, z);
      if (f.dBrush < 1.0 || f.dLane < 1.5 || f.dTrail < 0.6 || f.dCamp < -2.5 || f.dRiver < 1.5 || terrainHeight(x, z) < WATER_Y + 0.2) continue;
      const len = 3.6 + rd() * 1.8, e0 = fields(x + p.tx * len * 0.5, z + p.tz * len * 0.5), e1 = fields(x - p.tx * len * 0.5, z - p.tz * len * 0.5);
      if (e0.dWall < 0.45 || e1.dWall < 0.45 || e0.dBrush < 0.6 || e1.dBrush < 0.6) continue;      // 两头不能顶进别的墙或草丛里
      log(x, z, -Math.atan2(p.tz, p.tx) + (rd() - 0.5) * 0.24, len, 0.36 + rd() * 0.12, f.u < 0 ? 0 : 1, rd); break;
    }
  });
  // 树桩：营地的外沿、河岸上、墙头旁边，零星几个
  { const rd = rng(8800); let tries = 0;
    while (count.stumps < 28 && tries++ < 6000) {
      const x = (rd() - 0.5) * 150, z = (rd() - 0.5) * 150, f = fields(x, z);
      if (f.dEdge < 4 || f.dBase < 6 || f.dLane < 2 || f.dTrail < 1.2 || f.dBrush < 1.2 || f.dWall < 0.5 || f.dTower < 7 || f.dRiver < 1.2 || f.dIsland < 2) continue;
      const near = (f.dCamp > 0.5 && f.dCamp < 3) || (f.dRiver < 3.5) || (f.dWall < 1.8);
      if (!near || circles.some(c => Math.hypot(c.x - x, c.z - z) < 14)) continue;
      stump(x, z, f.u < 0 ? 0 : 1, rd);
    } }

  // ---------------------------------------------------------------- 合并成网格
  // 树皮（画风 B）：干净的竖纹贴图，颜色亮一档的暖棕；我方的倒木树桩上少量亮绿的苔，对方的是深一点的灰棕
  const bk = texB("bark_b") ?? tex.bark, bMean = texB("bark_b") ? 0.55 : 0.082;
  const barkMat = [stoneMaterial(bk, { scale: 0.34, mean: bMean, keepTex: true, gain: 0.55, mottle: 0.3, color: 0xa47a52, moss: 0.35, mossColor: 0x86ad3a, mossEdge: [0.62, 0.68], dirt: 0.2 }), stoneMaterial(bk, { scale: 0.34, mean: bMean, keepTex: true, gain: 0.55, mottle: 0.3, color: 0x6a564b, moss: 0.1, mossColor: 0x9a5a2c, dirt: 0.15 })];
  const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  // 叶团随风很慢地晃一点（越高晃得越多），不然一圈树像摆件
  leafMat.onBeforeCompile = sh => {
    sh.uniforms.uTime = time;
    sh.vertexShader = ("uniform float uTime; varying vec3 vLP; varying float vUp;\n" + sh.vertexShader).replace("#include <begin_vertex>", "#include <begin_vertex>\nvLP = position; vUp = normal.y;\n{ float k_ = smoothstep(2.5, 9.0, position.y) * 0.07; transformed.x += sin(uTime * 0.7 + position.x * 0.31 + position.z * 0.23) * k_; transformed.z += cos(uTime * 0.55 + position.x * 0.19 - position.z * 0.27) * k_ * 0.7; }");
    // 叶团上的笔触：半米大小的叶斑一块深一块浅，边是硬的（像厚涂的一笔）；朝上的面再点一些更小更亮的叶尖
    sh.fragmentShader = ("varying vec3 vLP; varying float vUp;\nfloat lh_(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }\nfloat ln_(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(mix(lh_(i), lh_(i + vec3(1,0,0)), f.x), mix(lh_(i + vec3(0,1,0)), lh_(i + vec3(1,1,0)), f.x), f.y), mix(mix(lh_(i + vec3(0,0,1)), lh_(i + vec3(1,0,1)), f.x), mix(lh_(i + vec3(0,1,1)), lh_(i + vec3(1,1,1)), f.x), f.y), f.z); }\n" + sh.fragmentShader)
      .replace("#include <color_fragment>", `#include <color_fragment>
        { float a_ = ln_(vLP * 1.9) * 0.6 + ln_(vLP * 4.3 + 7.0) * 0.4, b_ = ln_(vLP * 8.5 + 3.0);
          diffuseColor.rgb *= mix(0.88, 1.07, smoothstep(0.44, 0.56, a_));      // 画风 B：叶斑的对比压低一大半，团是干净的一块色
          diffuseColor.rgb *= 1.0 + smoothstep(0.62, 0.7, b_) * smoothstep(0.1, 0.7, vUp) * 0.14; }`);
  };
  for (const list of leaf.values()) { if (!list.length) continue; const m = new THREE.Mesh(mergeGeometries(list)!, leafMat); m.castShadow = true; m.receiveShadow = true; group.add(m); }
  for (const [key, list] of bark) { if (!list.length) continue; const m = new THREE.Mesh(mergeGeometries(list)!, barkMat[Number(key[0])]); m.castShadow = true; m.receiveShadow = true; group.add(m); }
  return { group, contact: { lines, circles }, count };
}
