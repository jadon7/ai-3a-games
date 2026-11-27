// 薄墙、石块、枯木：都在代码里直接建模（不用现成模型），材质是手绘贴图按三个方向投上去。
//
// 第二版的墙照设计稿重做，讲结构，不再是随手码的一排方块：
//   · 墙身是一条缓缓的弧；
//   · 从下到上：宽出一圈的墙脚石 → 两层大块料石（上下错缝，每块顺着墙弯）→ 出檐的压顶；
//   · 两段墙相接、或者高墙转矮墙的地方立一根八角墩柱：柱础、柱身、一圈青铜箍、柱帽；
//   · 完好的一头用青铜卡子收住，抵着比墙还高的大石头；另一头是矮一截的残墙，塌成乱石。
// 墙身厚 1.3 米、高 2 米出头，是薄的一片。
//
// 换画风 B（明快卡通，设计稿 art/concepts22/env_me_b.png、env_foe_b.png）：形状改成圆润干净的厚板，位置和挡路的范围一点不动。
//   · 我方：铜绿的墙脚 → 一整条浅灰白的墙身（三四米一块，缝很浅）→ 一道铜绿的腰带 → 出檐的压顶，顶上长几块亮绿的苔；
//   · 对方：宽出一圈的墙脚 → 一人高的大块玄武岩（两米一块、圆角、缝看得清），没有压顶；墩柱是方的，两道暗铁箍从顶上箍下来；
//   · 所有的块都是圆角（截面是圆角长方形，两头也圆），法线是平滑的，分阶光下每条圆角是一道干净的亮边；
//   · 不要残墙、塌下来的乱石和墙头的卡子（B 不要破败感）：残墙那一截改成矮一截的整墙；
//   · 墙头石头和墩柱会挡路（game/nav.ts 拿它们的位置和半径），所以位置、大小、随机数一个都不能变：
//     先照原来的写法把随机数原样耗一遍（只排位置、不出形状），形状另用一串随机数出。改前改后的证明见 docs/style_b/b-walls/。

import { TOON_ON, T } from "../toon";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { mergeGeometries, mergeVertices, toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { fbm, hash2, rng } from "../../core/noise";
import { BRUSH, WALLS, toWorld } from "../layout";
import { PAINT_HALF, SLICE_X, SLICE_Z } from "./def";
import { WATER_Y, groundHeight } from "./ground";

/** 墙和石头落在哪个地面上：样板间用自己的那块地，整张地图换成全图的地形 */
let groundH: (x: number, z: number) => number = groundHeight;
export const useGround = (fn: (x: number, z: number) => number) => { groundH = fn; };

export interface StoneOpts { scale?: number; moss?: number; mossColor?: number; color?: number; rough?: number; metal?: number; mean?: number; texK?: number; gain?: number; dirt?: number; chroma?: number; waterY?: number;
  /** 画风 B：mottle 一米来大的深浅斑留多少（不给就是原来的）；rim 圆角朝上那一圈提亮多少（厚涂里石头上沿那道亮边）；
   *  mossEdge 给了就换成 B 的苔：只长在朝天的面上、低频的大块，两个数是噪声的阈值（越高长得越少，靠得越近边越干净）；keepTex 贴图的明暗不跟着卡通档压（干净的贴图本来就淡） */
  mottle?: number; rim?: number; mossEdge?: [number, number]; keepTex?: boolean; }
/** 三向投影的手绘材质：不用展 UV，石头怎么摆纹理都连续。color 是想要的颜色，贴图只负责在它上面加笔触（mean 是贴图自己的平均亮度）。朝上的面按噪声长一层苔 */
export function stoneMaterial(tex: THREE.Texture | null, o: StoneOpts = {}): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ map: tex ?? undefined, color: o.color ?? 0xffffff, vertexColors: true, roughness: o.rough ?? 0.92, metalness: o.metal ?? 0 });
  const scale = o.scale ?? 0.32, moss = o.moss ?? 0, mc = new THREE.Color(o.mossColor ?? 0x74873a), mean = o.mean ?? 0.3, texK = (o.texK ?? 1) * (TOON_ON && !o.keepTex ? T.stoneTex : 1),      /* stylecost 试验：卡通档把石纹的明暗压掉一大半，石头是干净的色块 */ gain = o.gain ?? 1, dirt = o.dirt ?? 0;
  mat.onBeforeCompile = sh => {
    sh.vertexShader = ("varying vec3 vWP; varying vec3 vWN;\n" + sh.vertexShader).replace("#include <begin_vertex>", `#include <begin_vertex>
      vWP = (modelMatrix * vec4(transformed, 1.0)).xyz; vWN = normalize(mat3(modelMatrix) * objectNormal);`);
    sh.fragmentShader = ("varying vec3 vWP; varying vec3 vWN;\nfloat sn_(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); float a = fract(sin(dot(i, vec2(127.1,311.7)))*43758.5453), b = fract(sin(dot(i+vec2(1,0), vec2(127.1,311.7)))*43758.5453), c = fract(sin(dot(i+vec2(0,1), vec2(127.1,311.7)))*43758.5453), d = fract(sin(dot(i+vec2(1,1), vec2(127.1,311.7)))*43758.5453); return mix(mix(a,b,f.x), mix(c,d,f.x), f.y); }\n" + sh.fragmentShader)
      .replace("#include <map_fragment>", `
        vec3 wn_ = normalize(vWN);
        #ifdef USE_MAP
          vec3 bw_ = pow(abs(wn_), vec3(5.0)); bw_ /= (bw_.x + bw_.y + bw_.z);
          vec3 t_ = texture2D(map, vWP.zy * ${scale.toFixed(3)}).rgb * bw_.x + texture2D(map, vWP.xz * ${scale.toFixed(3)}).rgb * bw_.y + texture2D(map, vWP.xy * ${scale.toFixed(3)}).rgb * bw_.z;
          { vec3 tm_ = t_ / ${mean.toFixed(3)}; tm_ = mix(vec3(dot(tm_, vec3(0.2126, 0.7152, 0.0722))), tm_, ${(o.chroma ?? 0.3).toFixed(2)});      // 贴图主要管明暗的笔触，颜色由 color 定
            diffuseColor.rgb *= mix(vec3(1.0), clamp(1.0 + (tm_ - 1.0) * ${gain.toFixed(2)}, 0.3, 1.8), ${texK.toFixed(2)}); }
        #endif
        { // 手绘的感觉：一米来大的深浅斑，偏暖偏冷也跟着变；贴地的一截发暗发绿
          float b1_ = sn_(vWP.xz * 0.55 + vWP.y * 0.9) * 0.6 + sn_(vWP.xz * 1.7 + vWP.y * 2.3 + 7.0) * 0.4;
          diffuseColor.rgb *= ${o.mottle !== undefined ? `mix(vec3(${(1 - 0.16 * o.mottle).toFixed(3)}, ${(1 - 0.1 * o.mottle).toFixed(3)}, ${(1 - 0.06 * o.mottle).toFixed(3)}), vec3(${(1 + 0.1 * o.mottle).toFixed(3)}, ${(1 + 0.08 * o.mottle).toFixed(3)}, ${(1 + 0.02 * o.mottle).toFixed(3)}), b1_)` : TOON_ON ? "mix(vec3(0.97, 0.99, 1.0), vec3(1.12, 1.11, 1.08), b1_)" : "mix(vec3(0.84, 0.9, 0.94), vec3(1.1, 1.08, 1.02), b1_)"};
          ${o.rim ? `diffuseColor.rgb *= 1.0 + ${o.rim.toFixed(3)} * smoothstep(0.28, 0.5, wn_.y) * (1.0 - smoothstep(0.82, 0.96, wn_.y));` : ""}
          ${o.waterY === undefined ? "" : `{ float wd_ = ${o.waterY.toFixed(3)} - vWP.y;      // 泡在水里的部分跟河底一样偏青绿；水面上一掌高是湿的、发暗
            diffuseColor.rgb *= mix(vec3(1.0), vec3(0.7), smoothstep(0.2, 0.0, -wd_) * step(wd_, 0.0));
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.16, 0.38, 0.33), smoothstep(-0.02, 0.3, wd_)); }`}
          float gd_ = smoothstep(0.75, 0.0, vWP.y) * ${dirt.toFixed(2)};
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.5, 0.62, 0.42), gd_); }
        { float m_ = ${o.mossEdge ? `smoothstep(0.8, 0.95, wn_.y) * smoothstep(${o.mossEdge[0].toFixed(3)}, ${o.mossEdge[1].toFixed(3)}, sn_(vWP.xz * 0.55) * 0.6 + sn_(vWP.xz * 1.9 + 3.0) * 0.3 + sn_(vWP.xz * 6.5) * 0.1)` : "smoothstep(0.5, 0.92, wn_.y) * smoothstep(0.5, 0.66, sn_(vWP.xz * 0.8) * 0.42 + sn_(vWP.xz * 3.1) * 0.3 + sn_(vWP.xz * 11.0) * 0.18 + sn_(vWP.xz * 37.0) * 0.1)"} * ${moss.toFixed(2)};      // 画风 B 的苔（给了 mossEdge）：只长在朝天的面上，一块块边缘干净的亮绿，不是满面的碎斑
          float l_ = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${mc.r.toFixed(3)}, ${mc.g.toFixed(3)}, ${mc.b.toFixed(3)}) * (0.8 + l_ * 0.5), m_); }`);
  };
  mat.customProgramCacheKey = () => `stone:${scale}:${moss}:${mc.getHexString()}:${mean}:${texK}:${gain}:${dirt}:${o.chroma ?? 0.3}:${o.waterY ?? "n"}:${o.mottle ?? "d"}:${o.rim ?? 0}:${o.mossEdge?.join("/") ?? "d"}`;
  return mat;
}

export const tint = (g: THREE.BufferGeometry, k: number, grad = 0) => {
  // 顶点色：整块的明暗差一点；grad > 0 时底下暗、上面亮（接地的那圈脏）
  const p = g.getAttribute("position"), c = new Float32Array(p.count * 3); g.computeBoundingBox(); const bb = g.boundingBox!;
  for (let i = 0; i < p.count; i++) { const t = (p.getY(i) - bb.min.y) / Math.max(bb.max.y - bb.min.y, 1e-3); c.fill(k * (1 - grad + grad * Math.min(t * 1.6, 1)), i * 3, i * 3 + 3); }
  g.setAttribute("color", new THREE.BufferAttribute(c, 3)); return g;
};
/** 收尾：统一成不带索引、只有位置、法线、顶点色的几何体，才能合并 */
export const fin = (g: THREE.BufferGeometry, k = 1, grad = 0) => { const o = g.index ? g.toNonIndexed() : g; o.deleteAttribute("uv"); if (!o.getAttribute("normal")) o.computeVertexNormals(); return tint(o, k, grad); };
export const box = (w: number, h: number, d: number, r: number) => new RoundedBoxGeometry(w, h, d, 2, r);
/** 八棱柱（或八棱台），每个面是平的 */
export const oct = (rt: number, rb: number, h: number) => { const g = new THREE.CylinderGeometry(rt, rb, h, 8, 1).toNonIndexed(); g.computeVertexNormals(); g.rotateY(Math.PI / 8); return g; };

/** 一块大石头：球上压十来刀平面，留下一个个利落的大面，面和面之间的棱是清楚的 */
export function rockGeometry(seed: number, rx: number, ry: number, rz: number, cut = 0.93): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 6), p = g.getAttribute("position"), rd = rng(seed), v = new THREE.Vector3();
  const planes = Array.from({ length: 11 }, () => ({ n: new THREE.Vector3(rd() * 2 - 1, rd() * 1.7 - 0.55, rd() * 2 - 1).normalize(), d: 0.58 + rd() * 0.3 }));
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    for (const pl of planes) { const e = v.dot(pl.n) - pl.d; if (e > 0) v.addScaledVector(pl.n, -e * cut); }
    const n = fbm(v.x * 1.1 + seed * 0.13 + v.z * 0.5, v.y * 1.1 + v.z * 0.9, 2, seed) - 0.5;
    v.multiplyScalar(1 + n * 0.13); if (v.y < -0.45) v.y = -0.45 - (v.y + 0.45) * 0.1;
    p.setXYZ(i, v.x * rx, v.y * ry, v.z * rz);
  }
  const o = toCreasedNormals(g, cut > 0.8 ? 0.6 : 1.2); o.deleteAttribute("uv");
  return tint(o, 1, 0.34);
}

/** 画风 B 的干净平铺贴图（tools/bwalls_tex.py 用代码画的 *_b.webp，只有很淡的大斑和偶尔一道浅裂纹）。
 *  墙、台阶、城墙、大石头、树皮用这一套；塔、水晶、出生点（kit/materials.ts）还用原来的贴图，第二批换建筑时再说。
 *  在这里自己同步载入（先给一张空的贴图，图到了自动换上），入口不用改；在 node 里跑（证明挡路范围的脚本）没有 document，就不要贴图 */
const bTexCache = new Map<string, THREE.Texture | null>();
export function texB(name: string): THREE.Texture | null {
  if (typeof document === "undefined") return null;
  if (!bTexCache.has(name)) { const t = new THREE.TextureLoader().load(`/assets/slice/tex/${name}.webp`); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; bTexCache.set(name, t); }
  return bTexCache.get(name)!;
}
/** 贴图的平均亮度（tools/bwalls_tex.py 打出来的），材质拿它把贴图归一成“只管明暗起伏” */
const B_MEAN: Record<string, number> = { stone_me_b: 0.72, stone_foe_b: 0.718, rock_me_b: 0.7, rock_foe_b: 0.7, bronze_me_b: 0.633, iron_foe_b: 0.5, bark_b: 0.55 };
const bTex = (name: string) => ({ tex: texB(name), mean: B_MEAN[name] });

/** 画风 B 的颜色（反照率，sRGB）。从设计稿量的是受光面的颜色：我方压顶 234,234,213、墙身 193,195,174、铜绿 107,176,146、苔 160,189,80；
 *  对方顶面 127,126,122、背光的墙面 59,58,64、铁箍 91,73,73。反照率要比它们暗一截（还要乘太阳和天光），数是对着设计稿截图调的 */
export const B_LOOK = {
  stone: [0xd6d5c4, 0x6c6764], step: [0xdedcc9, 0x7a7572], trim: [0x4f9c84, 0x4c3d3d], rock: [0xc0c2b4, 0x7a716c], moss: [0x7da234, 0x9a5a2c],
  mossWall: [0x93b030, 0x9a5a2c],      // 墙和墙头大石头上的苔（b-polish）：比 moss 偏黄一点。苔压淡以后一半是石头的白透上来，照 moss 混出来发薄荷色、像一块水渍；试过暗一点的橄榄绿（0x7a9230），淡了以后是一块灰绿的脏印子。设计稿压顶上的苔是黄绿 141–159,174–187,84–88
};

const matCache = new Map<string, THREE.MeshStandardMaterial>();
/** 墙体的材质（料石、包边的金属、大石头、台阶），按阵营取。全图的墙、台阶、城墙都用这一套。
 *  画风 B：贴图换成干净的、明暗起伏只留一点；斑和脏压到很淡；我方压顶上淡淡几块黄绿的苔（b-polish 压过，见下面 base），对方几乎不长；圆角朝上那一圈提亮一点 */
export function wallMaterials(_tex: StoneTextures, team: number) {
  const get = (k: string, make: () => THREE.MeshStandardMaterial) => { const key = k + team; if (!matCache.has(key)) matCache.set(key, make()); return matCache.get(key)!; };
  const me = team === 0, st = bTex(me ? "stone_me_b" : "stone_foe_b"), tr = bTex(me ? "bronze_me_b" : "iron_foe_b"), rk = bTex(me ? "rock_me_b" : "rock_foe_b"), L = (k: keyof typeof B_LOOK) => B_LOOK[k][team];
  const base = { keepTex: true, gain: me ? 0.6 : 1.0, mottle: me ? 0.18 : 0.22, mossEdge: (me ? [0.7, 0.8] : [0.63, 0.67]) as [number, number] };      // 贴图的起伏再压一点：设计稿 B 的压顶几乎是一整块干净的色
  // 我方的苔（b-polish 压淡）：原来阈值 0.63–0.67、浓度 0.8，压顶上四成是边缘很硬的亮绿斑，像迷彩（docs/style_b/merged2/sheet.jpg）；设计稿 B 只在压顶上淡淡几块。
  // 阈值抬到 0.7–0.8：长苔的地方少一大半，边也软了；浓度压到 0.55、颜色偏黄一点（B_LOOK.mossWall），是石头上淡淡一层苔，不是一块绿漆。对方的参数没动（对方的颜色两个键一样）
  return {
    stone: get("stone", () => stoneMaterial(st.tex, { ...base, scale: 0.21, mean: st.mean, chroma: 0.6, color: L("stone"), moss: me ? 0.55 : 0.0, mossColor: L("mossWall"), dirt: me ? 0.18 : 0.1, rim: me ? 0.1 : 0.22 })),      // 对方的玄武岩留多一点石纹（设计稿上看得出凿痕），上沿的亮边也强一点
    // 台阶和广场上的石头：天天有人踩，没有苔，颜色浅一点
    step: get("step", () => stoneMaterial(st.tex, { ...base, scale: 0.21, mean: st.mean, chroma: 0.6, color: L("step"), moss: 0, dirt: 0.08, rim: 0.08 })),
    trim: get("trim", () => stoneMaterial(tr.tex, { ...base, scale: 0.35, mean: tr.mean, chroma: 0.9, color: L("trim"), rough: 0.6, mottle: 0.15, rim: me ? 0.14 : 0.1 })),
    rock: get("rock", () => stoneMaterial(rk.tex, { ...base, mossEdge: me ? [0.64, 0.76] : base.mossEdge, scale: 0.18, mean: rk.mean, chroma: 0.5, color: L("rock"), moss: me ? 0.55 : 0.15, mossColor: L("mossWall"), dirt: me ? 0.2 : 0.12, rim: 0.1 })),      // 我方的石头顶上苔多一些，和草地连成一片
  };
}

export interface StoneTextures { stone: (THREE.Texture | null)[]; trim: (THREE.Texture | null)[]; rock: (THREE.Texture | null)[]; bark: THREE.Texture | null; }

// ---- 墙的中线 ----
type P2 = [number, number];
export interface CPoint { x: number; z: number; tx: number; tz: number; }
export interface Curve { L: number; at: (s: number) => CPoint; }

/** 一串密的点 → 能按“沿墙走了多远”取位置和方向的曲线。s 超出两头时沿着端头的方向直着延出去 */
export function curveOf(P: P2[]): Curve {
  const S = [0]; for (let i = 1; i < P.length; i++) S.push(S[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const L = S[S.length - 1];
  const at = (s: number): CPoint => {
    const c = Math.min(Math.max(s, 0), L); let i = 1; while (i < S.length - 1 && S[i] < c) i++;
    const a = P[i - 1], b = P[i], t = (c - S[i - 1]) / Math.max(S[i] - S[i - 1], 1e-6);
    const j0 = Math.max(i - 2, 0), j1 = Math.min(i + 1, P.length - 1), dx = P[j1][0] - P[j0][0], dz = P[j1][1] - P[j0][1], dn = Math.hypot(dx, dz) || 1, tx = dx / dn, tz = dz / dn, e = s - c;
    return { x: a[0] + (b[0] - a[0]) * t + tx * e, z: a[1] + (b[1] - a[1]) * t + tz * e, tx, tz };
  };
  return { L, at };
}
/** 把布局里的折线磨成弧：两个点的直墙往一侧鼓出 bow 那么多；三个点以上的顺着点走圆滑的曲线 */
function smoothLine(pts: P2[], bow: P2): P2[] {
  const out: P2[] = [];
  if (pts.length === 2) {
    const [a, b] = pts, cx = (a[0] + b[0]) / 2 + bow[0] * 2, cy = (a[1] + b[1]) / 2 + bow[1] * 2;
    for (let i = 0; i <= 40; i++) { const t = i / 40, k0 = (1 - t) * (1 - t), k1 = 2 * t * (1 - t), k2 = t * t; out.push([a[0] * k0 + cx * k1 + b[0] * k2, a[1] * k0 + cy * k1 + b[1] * k2]); }
    return out;
  }
  const q = [pts[0], ...pts, pts[pts.length - 1]];
  for (let i = 1; i < q.length - 2; i++) for (let s = 0; s < 10; s++) {
    const t = s / 10, t2 = t * t, t3 = t2 * t;
    const f = (k: 0 | 1) => 0.5 * (2 * q[i][k] + (q[i + 1][k] - q[i - 1][k]) * t + (2 * q[i - 1][k] - 5 * q[i][k] + 4 * q[i + 1][k] - q[i + 2][k]) * t2 + (3 * q[i][k] - q[i - 1][k] - 3 * q[i + 1][k] + q[i + 2][k]) * t3);
    out.push([f(0), f(1)]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}
function closest(p: P2, pts: P2[]) {
  let d = 1e9, s = 0, acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz, t = Math.min(Math.max(((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2, 0), 1), e = Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t), len = Math.sqrt(l2);
    if (e < d) { d = e; s = acc + t * len; } acc += len;
  }
  return { d, s, L: acc };
}

interface WallPlan { line: P2[]; piers: number[]; join: [boolean, boolean]; }
/** 在布局坐标里把每段墙排好：哪一头接在别的墙上（接的地方立墩柱）、弧往哪边鼓（背着草丛鼓，凹的一面把草丛兜住） */
function planWalls(): WallPlan[] {
  const join = WALLS.map(() => [-1, -1]), joinF = WALLS.map(() => [0, 0]), pierF: number[][] = WALLS.map(() => []);
  WALLS.forEach((wl, i) => [0, 1].forEach(end => {
    const p = wl.pts[end ? wl.pts.length - 1 : 0];
    WALLS.forEach((o, j) => { if (j === i || join[i][end] >= 0) return; const c = closest(p, o.pts); if (c.d < 2.7 && c.s > 2.4 && c.s < c.L - 2.4) { join[i][end] = j; joinF[i][end] = c.s / c.L; pierF[j].push(c.s / c.L); } });
  }));
  const bowOf = (pts: P2[], i: number): P2 => {
    if (pts.length !== 2) return [0, 0];
    const [a, b] = pts, mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), nx = -dy / L, ny = dx / L;
    let best = 9, sign = hash2(i, 3, 77) < 0.5 ? -1 : 1;
    for (const br of BRUSH) { const bx = (br.p[0] + br.q[0]) / 2, by = (br.p[1] + br.q[1]) / 2, d = Math.hypot(bx - mx, by - my); if (d < best) { best = d; sign = (mx - bx) * nx + (my - by) * ny >= 0 ? 1 : -1; } }
    const m = Math.min(0.5, L * 0.045) * sign; return [nx * m, ny * m];
  };
  const lines: (P2[] | null)[] = WALLS.map((wl, i) => (join[i][0] < 0 && join[i][1] < 0 ? smoothLine(wl.pts, bowOf(wl.pts, i)) : null));
  WALLS.forEach((wl, i) => {
    if (lines[i]) return;
    const pts = wl.pts.map(p => [p[0], p[1]] as P2);
    [0, 1].forEach(end => { const j = join[i][end]; if (j < 0) return; const cj = curveOf(lines[j] ?? smoothLine(WALLS[j].pts, bowOf(WALLS[j].pts, j))), q = cj.at(joinF[i][end] * cj.L); pts[end ? pts.length - 1 : 0] = [q.x, q.z]; });
    lines[i] = smoothLine(pts, bowOf(pts, i));
  });
  return WALLS.map((_, i) => ({ line: lines[i]!, piers: pierF[i], join: [join[i][0] >= 0, join[i][1] >= 0] }));
}

/** 把一圈圈截面（每圈八个点）蒙成一个实心的块，两头封口 */
export function skin(rings: number[][][]): THREE.BufferGeometry {
  const pos: number[] = [], tri = (a: number[], b: number[], d: number[]) => pos.push(a[0], a[1], a[2], b[0], b[1], b[2], d[0], d[1], d[2]);
  for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < 8; j++) { const a = rings[i][j], b = rings[i][(j + 1) % 8], e = rings[i + 1][j], d = rings[i + 1][(j + 1) % 8]; tri(a, e, d); tri(a, d, b); }
  const first = rings[0], last = rings[rings.length - 1];
  for (let j = 1; j < 7; j++) { tri(first[0], first[j], first[j + 1]); tri(last[0], last[j + 1], last[j]); }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
  return g;
}

/** 一块顺着墙弯的料石：截面是切了角的长方形，两头也切角。沿墙从 s0 到 s1，侧向正负 hT，高 y0 到 y1。base 不给就落在地面上 */
export function bentBlock(cv: Curve, s0: number, s1: number, y0: number, y1: number, hT: number, c: number, seed = 0, wob = 0.012, base?: number, step = 0.42): THREE.BufferGeometry {
  const mid = cv.at((s0 + s1) / 2), g0 = base ?? groundH(mid.x, mid.z), inner = Math.max(s1 - s0 - 2 * c, 0.02), n = Math.max(1, Math.round(inner / step));
  const ss: [number, number][] = [[s0, c]];                                    // [沿墙的位置, 这一圈往里收多少]
  for (let i = 0; i <= n; i++) ss.push([s0 + c + (inner * i) / n, 0]);
  ss.push([s1, c]);
  return skin(ss.map(([s, inset]) => {
    const p = cv.at(s), h = hT - inset, ya = y0 + inset, yb = y1 - inset, cc = Math.max(c - inset, 0.004);
    const sec: P2[] = [[-h + cc, ya], [h - cc, ya], [h, ya + cc], [h, yb - cc], [h - cc, yb], [-h + cc, yb], [-h, yb - cc], [-h, ya + cc]];
    return sec.map(([t, y], j) => {
      // 手凿出来的料石，面不是绝对平的
      const w = (fbm(s * 1.9 + seed, y * 2.1 + j * 0.7 + seed * 0.37, 2, 5) - 0.5) * 2 * wob, tt = t + Math.sign(t) * w, yy = y + (j === 4 || j === 5 ? w : 0);
      return [p.x - p.tz * tt, g0 + yy, p.z + p.tx * tt];
    });
  }));
}

// ---- 画风 B 的零件：圆角的块 ----
/** 圆角长方形的截面（侧向 t、高 y，逆时针，和 bentBlock 的八角截面同一个走向）：半宽 h，高 y0..y1，圆角半径 r，每个角 K 段。
 *  每个角前后各多放一个贴着角的点（离 1 厘米）：大平面两边的法线就是正的，不会被角上斜着的法线带歪（分阶光下平面中间会冒出一道明暗线） */
function rrect(h: number, y0: number, y1: number, r: number, K: number): P2[] {
  r = Math.max(0.002, Math.min(r, h - 0.002, (y1 - y0) / 2 - 0.002)); const e = Math.min(0.01, r * 0.25), out: P2[] = [];
  for (const [cx, cy, a0] of [[h - r, y0 + r, -Math.PI / 2], [h - r, y1 - r, 0], [-h + r, y1 - r, Math.PI / 2], [-h + r, y0 + r, Math.PI]] as [number, number, number][]) {
    out.push([cx + r * Math.cos(a0) + e * Math.sin(a0), cy + r * Math.sin(a0) - e * Math.cos(a0)]);
    for (let k = 0; k <= K; k++) { const a = a0 + (k / K) * (Math.PI / 2); out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    const a1 = a0 + Math.PI / 2; out.push([cx + r * Math.cos(a1) - e * Math.sin(a1), cy + r * Math.sin(a1) + e * Math.cos(a1)]);
  }
  return out;
}
export interface RoundOpts { K?: number; step?: number; base?: number; follow?: boolean; endR?: number; }
/** 一块圆角的料石，顺着曲线弯：沿线 s0..s1，侧向 ±hT，高 y0..y1（离地），圆角半径 r，两头也是圆角（endR，默认同 r）。
 *  base 给了就是绝对的地面高度；不给时 follow 为真就每一圈各自贴着地面走（一整条墙顺着地形起伏，不会一块高一块低），否则按中点的地面。
 *  带索引、法线平滑：圆角是一道渐变的亮边，不是一个个折面 */
export function roundBlock(cv: Curve, s0: number, s1: number, y0: number, y1: number, hT: number, r: number, o: RoundOpts = {}): THREE.BufferGeometry {
  const K = o.K ?? 2, len = s1 - s0, er = Math.max(0.004, Math.min(o.endR ?? r, len / 2 - 0.002, hT * 0.9, (y1 - y0) * 0.45)), rc = Math.min(r, hT - 0.002, (y1 - y0) / 2 - 0.002);
  const mid = cv.at((s0 + s1) / 2), g0 = o.base ?? groundH(mid.x, mid.z);
  const ss: [number, number][] = [];                                                  // [沿线的位置, 这一圈往里收多少]
  for (let k = K; k >= 1; k--) { const f = (k / K) * (Math.PI / 2); ss.push([s0 + er * (1 - Math.sin(f)), er * (1 - Math.cos(f))]); }
  const inner = Math.max(len - 2 * er, 0.001), n = Math.max(1, Math.round(inner / (o.step ?? 0.7)));
  for (let i = 0; i <= n; i++) ss.push([s0 + er + (inner * i) / n, 0]);
  for (let k = 1; k <= K; k++) { const f = (k / K) * (Math.PI / 2); ss.push([s1 - er * (1 - Math.sin(f)), er * (1 - Math.cos(f))]); }
  const pos: number[] = []; let M = 0;
  for (const [s, d] of ss) {
    const p = cv.at(s), g = o.base !== undefined || !o.follow ? g0 : groundH(p.x, p.z), sec = rrect(hT - d, y0 + d, y1 - d, Math.max(rc - d, rc * 0.2), K); M = sec.length;
    for (const [t, y] of sec) pos.push(p.x - p.tz * t, g + y, p.z + p.tx * t);
  }
  const R = ss.length, idx: number[] = [];
  for (let i = 0; i < R - 1; i++) for (let j = 0; j < M; j++) { const a = i * M + j, b = i * M + ((j + 1) % M), e = (i + 1) * M + j, d = (i + 1) * M + ((j + 1) % M); idx.push(a, e, d, a, d, b); }
  for (let j = 1; j < M - 1; j++) { idx.push(0, j, j + 1); const L0 = (R - 1) * M; idx.push(L0, L0 + j + 1, L0 + j); }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
/** 一个方墩（也是圆角块）：中心 (x, z)，沿着 (tx, tz) 的方向长 la、横向半宽 hw，高 y0..y1（相对 base） */
export function post(x: number, z: number, tx: number, tz: number, la: number, hw: number, y0: number, y1: number, r: number, base: number, K = 2): THREE.BufferGeometry {
  const cv = curveOf([[x - tx * la / 2, z - tz * la / 2], [x + tx * la / 2, z + tz * la / 2]]);
  return roundBlock(cv, 0, la, y0, y1, hw, r, { K, base, step: 9 });
}
/** 一节圆柱（画风 B 我方的墩柱）：半径 r，高 y0..y1，上下沿是半径 rr 的圆角，转出来的，法线平滑。中心在原点 */
export function roundCol(r: number, y0: number, y1: number, rr: number, segs = 14): THREE.BufferGeometry {
  rr = Math.min(rr, r * 0.5, (y1 - y0) / 2 - 0.002); const pr: THREE.Vector2[] = [new THREE.Vector2(0.001, y0)];      // 圆角每个两段就够（法线是平滑的）：城墙上几十根柱子，面数要省
  for (let k = 0; k <= 2; k++) { const a = -Math.PI / 2 + (k / 2) * (Math.PI / 2); pr.push(new THREE.Vector2(r - rr + Math.cos(a) * rr, y0 + rr + Math.sin(a) * rr)); }
  for (let k = 0; k <= 2; k++) { const a = (k / 2) * (Math.PI / 2); pr.push(new THREE.Vector2(r - rr + Math.cos(a) * rr, y1 - rr + Math.sin(a) * rr)); }
  pr.push(new THREE.Vector2(0.001, y1));
  const g = new THREE.LatheGeometry(pr, segs); g.deleteAttribute("uv"); g.deleteAttribute("normal"); const o = mergeVertices(g); o.computeVertexNormals();
  return o;
}
export interface SlabOpts { len: number; lv?: number; r?: number; K?: number; gap?: number; base?: number; follow?: boolean; step?: number; k?: number; kv?: number; grad?: number; topVar?: number; seed?: number; endR?: number; }
/** 一层圆角料石（画风 B）：从 a 铺到 b，每块 len 上下 lv 那么长，块和块之间留 gap 的缝；起头错开一点，上下两层的缝不对齐。
 *  用自己的一串随机数（seed 和位置算出来的），不碰排位置的那一串 */
export function slabs(out: THREE.BufferGeometry[], cv: Curve, a: number, b: number, y0: number, y1: number, hT: number, o: SlabOpts) {
  const rv = rng(Math.floor(Math.abs((o.seed ?? 0) * 7919 + a * 131.7 + b * 17.3 + y0 * 1009.1 + hT * 77.7)) % 2147483 + 11), lv = o.lv ?? o.len * 0.4, gap = o.gap ?? 0.03;
  let s = a - (b - a > o.len * 1.4 ? rv() * o.len * 0.55 : 0);
  while (s < b - 0.01) {
    let en = s + o.len + (rv() - 0.5) * 2 * lv; if (b - en < o.len * 0.45) en = b;
    const s0 = Math.max(s, a), s1 = Math.min(en, b);
    if (s1 - s0 > 0.2) out.push(fin(roundBlock(cv, s0 + (s0 > a ? gap / 2 : 0), s1 - (s1 < b ? gap / 2 : 0), y0, y1 + (rv() - 0.5) * (o.topVar ?? 0), hT, o.r ?? 0.08, { K: o.K, base: o.base, follow: o.follow ?? o.base === undefined, step: o.step, endR: o.endR }), (o.k ?? 1) * (1 - (o.kv ?? 0.05) + rv() * (o.kv ?? 0.05) * 2), o.grad ?? 0));
    s = en;
  }
}
/** 画风 B 的大石头：圆鼓鼓的，削几刀大面（王者那种圆润、但看得出几个面的石头）；尺寸和原来的 rockGeometry 对齐（同样的 rx、ry、rz 摆出来一样大） */
export function boulderGeometry(seed: number, rx: number, ry: number, rz: number, flat = 0.72): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 4), p = g.getAttribute("position"), rd = rng(seed * 3 + 17), v = new THREE.Vector3();
  const planes = Array.from({ length: 6 }, () => ({ n: new THREE.Vector3(rd() * 2 - 1, rd() * 1.4 - 0.2, rd() * 2 - 1).normalize(), d: 0.7 + rd() * 0.18 }));
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    for (const pl of planes) { const e = v.dot(pl.n) - pl.d; if (e > 0) v.addScaledVector(pl.n, -e * flat); }      // 只削掉一半，面是缓的
    v.multiplyScalar(1 + (fbm(v.x * 0.9 + seed * 0.13, v.y * 0.9 + v.z * 0.7, 2, seed) - 0.5) * 0.12); if (v.y < -0.45) v.y = -0.45 - (v.y + 0.45) * 0.1;
    p.setXYZ(i, v.x * rx * 0.86, v.y * ry * 0.9, v.z * rz * 0.86);      // 原来的石头削掉的多、实际只有半径的八成多，这里缩回去，看上去一样大
  }
  g.deleteAttribute("uv"); const o = toCreasedNormals(g, 0.42);      // 缓的地方是圆的，削出来的大面边上留一道利落的棱（全平滑就成了一颗蛋）
  return tint(o, 1, 0.22);
}

export interface Tuft { x: number; y: number; z: number; h: number; team: number; top: boolean; }

/** 原来那一层料石用了多少随机数，照原样耗一遍（只耗、不出形状）。墙头大石头的位置和大小接在同一串随机数的后面（它们会挡路），少耗一个都会挪 */
function burnCourse(rd: () => number, a: number, b: number, lmin: number, lvar: number, keep?: (s: number) => boolean) {
  let s = a - rd() * lmin * 0.7;
  while (s < b - 0.01) {
    let en = s + lmin + rd() * lvar; if (b - en < 0.6) en = b;
    const s0 = Math.max(s, a), s1 = Math.min(en, b);
    if (s1 - s0 > 0.3 && (!keep || keep((s0 + s1) / 2))) { rd(); rd(); rd(); }      // 原来每块料石三个：顶面高低、厚薄、明暗
    s = en;
  }
}
/** 墙的身份（画风 B，只管高矮，不管位置）：营地和 Boss 坑的弧墙是一屏的主角，高一点；营地之间的两段短连接墙矮一截；草丛背后的照常。
 *  地图评估说“一屏四到六段一模一样的墙”，位置动不了，就让它们高矮有主次 */
const wallRole = (wi: number) => (wi >= 7 && wi <= 10 ? 1.08 : wi >= 11 ? 0.82 : 1.0);

export function createWalls(tex: StoneTextures, opts: { inside?: (p: [number, number]) => boolean; cell?: number } = {}): THREE.Group {
  const group = new THREE.Group(); group.name = "walls";
  // 按（阵营、格子）分桶：cell 不给就是每个阵营一桶
  type Bucket = { team: number; stone: THREE.BufferGeometry[]; trim: THREE.BufferGeometry[]; rock: THREE.BufferGeometry[] };
  const buckets = new Map<string, Bucket>();
  const bucketAt = (team: number, x: number, z: number) => { const key = opts.cell ? `${team}:${Math.floor(x / opts.cell)},${Math.floor(z / opts.cell)}` : `${team}`; if (!buckets.has(key)) buckets.set(key, { team, stone: [], trim: [], rock: [] }); return buckets.get(key)!; };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
  const footprints: { x: number; z: number; r: number }[] = [], lines: P2[][] = [], tufts: Tuft[] = [];
  const inside = opts.inside ?? (([x, z]: P2) => Math.abs(x - SLICE_X) < PAINT_HALF - 1 && Math.abs(z - SLICE_Z) < PAINT_HALF - 1);

  planWalls().forEach((pl, wi) => { for (const su of [-1, 1]) for (const sv of [-1, 1]) {
    const P = pl.line.map(([a, w]) => toWorld(su * a, sv * w) as P2);
    if (!P.some(inside)) continue;
    lines.push(P);
    const cv = curveOf(P), L = cv.L, team = su < 0 ? 0 : 1, me = team === 0, seedI = wi * 97 + (su + 2) * 13 + (sv + 2) * 5 + 1, rd = rng(seedI), seed = seedI * 0.731;
    const mp = cv.at(L / 2), bk = bucketAt(team, mp.x, mp.z), stone = bk.stone, trim = bk.trim;

    // ---- 1. 排位置（会挡路的墩柱和墙头石头）：随机数和原来一个不差地耗 ----
    // 墩柱的位置：别的墙接过来的地方；没有的话，够长的墙自己在中间立一根
    const piers = pl.piers.map(f => f * L).sort((a, b) => a - b), free = [!pl.join[0], !pl.join[1]];
    if (!piers.length && L >= 9.5) piers.push(L * (free[1] ? 0.52 + rd() * 0.1 : 0.38 + rd() * 0.1));
    // 哪一段是矮的：最外面一根墩柱到自由的那一头（原来是塌了一半的残墙，画风 B 改成矮一截的整墙，最外头一截再矮一级）
    let low: P2 | null = null, lowEnd = -1;
    if (piers.length) {
      const cand: number[] = []; if (free[0] && piers[0] >= 3.2) cand.push(0); if (free[1] && L - piers[piers.length - 1] >= 3.2) cand.push(1);
      if (cand.length) { lowEnd = cand[Math.floor(rd() * cand.length)]; low = lowEnd === 0 ? [0, piers[0]] : [piers[piers.length - 1], L]; }
    }
    const ruinLen = low ? Math.min(3.0, (low[1] - low[0]) * 0.5) : 0;
    const bounds = [0, ...piers, L];
    for (let k = 0; k < bounds.length - 1; k++) {
      const a = bounds[k], b = bounds[k + 1];
      if (!(low && a === low[0] && b === low[1])) { burnCourse(rd, a, b, 1.7, 0.9); burnCourse(rd, a, b, 1.3, 0.9); burnCourse(rd, a, b, 1.1, 0.9); burnCourse(rd, a, b, 1.5, 0.9); }
      else {
        const r0 = lowEnd === 1 ? b - ruinLen : a, r1 = lowEnd === 1 ? b : a + ruinLen, sa = lowEnd === 1 ? a : r1, sb = lowEnd === 1 ? r0 : b, dEnd = (s: number) => (lowEnd === 1 ? b - s : s - a);
        burnCourse(rd, a + (lowEnd === 0 ? 0.5 : 0), b - (lowEnd === 1 ? 0.5 : 0), 1.7, 0.9); burnCourse(rd, sa, sb, 1.3, 0.9); burnCourse(rd, sa, sb, 1.5, 0.9);
        burnCourse(rd, r0, r1, 1.0, 0.5, s => rd() < (dEnd(s) / ruinLen) * 1.25 - 0.12);
        for (let j = 0; j < 12; j++) rd();      // 原来墙脚掉的两块料石，每块六个随机数
      }
    }
    for (const s of piers) { const p = cv.at(s); footprints.push({ x: p.x, z: p.z, r: 1.15 }); }
    // 两头的石头：位置、大小、朝向照旧（会挡路），形状换成圆润的卵石
    const rocksAt = (end: number, big: boolean) => {
      const n = big ? 2 + (rd() < 0.6 ? 1 : 0) : 2; let r0 = 1;
      for (let k = 0; k < n; k++) {
        const r = big ? (k === 0 ? 1.5 + rd() * 0.3 : 0.65 + rd() * 0.4) : k === 0 ? 0.85 + rd() * 0.25 : 0.42 + rd() * 0.22; if (k === 0) r0 = r;
        const along = k === 0 ? r * 0.6 : r0 * (0.2 + rd() * 0.9), side = k === 0 ? (rd() - 0.5) * 0.5 : (k === 1 ? 1 : -1) * (r0 * 0.72 + r * 0.45 + rd() * 0.3);
        const p = cv.at(end ? L + along : -along), x = p.x - p.tz * side, z = p.z + p.tx * side, ry = r * (big && k === 0 ? 1.08 : 0.8) * (big && k === 0 ? 0.66 : 0.8);      // 画风 B：占地一样大（挡路的圆不变），只是压矮一截，像半埋在地里的石头，不再和墙一样高、一头一堆
        const g = boulderGeometry(seedI * 31 + k * 7 + end * 3, r * (1 + rd() * 0.15), ry, r * (0.86 + rd() * 0.14));
        g.applyMatrix4(m4.compose(new THREE.Vector3(x, groundH(x, z) + ry * 0.4, z), q.setFromEuler(e.set(0, rd() * 6.28, 0)), one));
        bk.rock.push(g); footprints.push({ x, z, r: r * 0.95 });
      }
    };
    [0, 1].forEach(end => { if (!free[end]) return; rocksAt(end, end !== lowEnd); });

    // ---- 2. 出形状（画风 B）：另用一串随机数 ----
    const rv = rng(seedI * 13 + 5), hf = wallRole(wi);
    // 高度：完好的墙、矮的那段、最外头再矮一级的那截。我方：墙身顶、压顶顶；对方没有压顶，两个数一样
    const H = me ? { body: 1.8 * hf, top: 2.12 * hf } : { body: 2.06 * hf, top: 2.06 * hf }, HL = me ? { body: 1.14, top: 1.46 } : { body: 1.42, top: 1.42 }, HB = me ? { body: 0.64, top: 0.94 } : { body: 0.9, top: 0.9 };
    const PL = me ? 0.34 : 0.36;
    /** 墙脚：比墙身宽出一圈、埋进地里一截。自由的那头多伸出一点，像设计稿里墙脚包住墙头 */
    const plinth = (a: number, b: number) => slabs(me ? trim : stone, cv, a - (a <= 0 && free[0] ? 0.14 : 0), b + (b >= L && free[1] ? 0.14 : 0), -0.3, PL, me ? 0.9 : 0.94, { len: me ? 4.4 : 2.5, lv: me ? 1.2 : 0.6, r: 0.07, seed: seed + 1, k: me ? 0.95 : 0.9, grad: 0.25, gap: me ? 0.02 : 0.045 });
    /** 一段墙身：我方是长板墙身 + 铜绿腰带 + 出檐压顶；对方是一人高的大块，缝看得清。后面垫一条深色的芯，缝里看进去是暗的 */
    const body = (a: number, b: number, h: { body: number; top: number }) => {
      if (me) {
        slabs(stone, cv, a, b, PL - 0.04, h.body, 0.78, { len: 3.4, lv: 1.0, r: 0.1, seed: seed + 2, k: 1.0, kv: 0.03, grad: 0.1, gap: 0.025 });
        slabs(trim, cv, a, b, h.body - 0.08, h.body + 0.11, 0.87, { len: 5.5, lv: 1.0, r: 0.04, K: 1, seed: seed + 3, gap: 0.015 });      // 腰带比压顶只收进一点，斜着往下看也露得出一道青
        slabs(stone, cv, a - 0.05, b + 0.05, h.body + 0.09, h.top, 0.92, { len: 2.8, lv: 0.8, r: 0.1, K: 3, seed: seed + 4, k: 1.06, kv: 0.03, topVar: 0.02, gap: 0.03 });
      } else slabs(stone, cv, a, b, PL - 0.04, h.top, 0.8, { len: 2.1, lv: 0.5, r: 0.14, K: 3, seed: seed + 2, k: 1.0, kv: 0.08, grad: 0.15, topVar: 0.05, gap: 0.045 });
      for (let s0 = a + 0.04; s0 < b - 0.3; s0 += 1.5) stone.push(fin(bentBlock(cv, s0, Math.min(s0 + 1.5, b - 0.04), 0.02, h.top - 0.32, 0.7, 0.01, 0, 0, undefined, 2), 0.4));
    };
    for (let k = 0; k < bounds.length - 1; k++) {
      const a = bounds[k], b = bounds[k + 1];
      plinth(a, b);
      if (!(low && a === low[0] && b === low[1])) body(a, b, H);
      else { const r0 = lowEnd === 1 ? b - ruinLen : a, r1 = lowEnd === 1 ? b : a + ruinLen, sa = lowEnd === 1 ? a : r1, sb = lowEnd === 1 ? r0 : b; body(sa, sb, HL); body(r0, r1, HB); }
    }
    /** 墙顶在 s 处有多高 */
    const topAt = (s: number) => (!low || s < low[0] || s > low[1] ? H.top : (lowEnd === 1 ? low[1] - s : s - low[0]) < ruinLen ? HB.top : HL.top);
    // 墩柱：我方是比墙高一点、宽一圈的方墩（铜绿墩脚、浅色墩身、一道铜箍、出檐的帽，和墙身是一套做法）；对方是比墙高一截的大方块，两道暗铁箍从顶上箍下来（设计稿的墙头）
    for (const s of piers) {
      const p = cv.at(s), g = groundH(p.x, p.z), top = topAt(s + 1.2) > topAt(s - 1.2) ? topAt(s + 1.2) : topAt(s - 1.2);
      const P = (list: THREE.BufferGeometry[], la: number, hw: number, y0: number, y1: number, r: number, k: number, grad: number, K = 2) => list.push(fin(post(p.x, p.z, p.tx, p.tz, la, hw, y0, y1, r, g, K), k, grad));
      if (me) {
        P(trim, 2.0, 1.12, -0.3, 0.44, 0.08, 0.95, 0.25);
        P(stone, 1.62, 1.0, 0.38, top + 0.14, 0.12, 1.0, 0.1);
        P(trim, 1.7, 1.05, top - 0.06, top + 0.12, 0.04, 1.0, 0, 1);
        P(stone, 1.9, 1.14, top + 0.1, top + 0.36, 0.1, 1.07, 0, 3);
      } else {
        P(stone, 2.0, 1.1, -0.3, 0.46, 0.08, 0.88, 0.25);
        P(stone, 1.6, 0.98, 0.4, top + 0.42, 0.15, 1.0, 0.12, 3);
        for (const sd of [-1, 1]) trim.push(fin(post(p.x + p.tx * sd * 0.47, p.z + p.tz * sd * 0.47, p.tx, p.tz, 0.22, 1.02, 0.52, top + 0.46, 0.04, g, 1), 1, 0));
      }
    }
    // 给植被留的位置：墙脚两侧一溜矮草，把墙“缝”进草地；墙顶上：我方零星几丛小草（苔在材质里），对方成片的枯草（设计稿里墙头一丛丛的）
    for (let s = 0.2; s < L; s += 0.26) for (const sd of [-1, 1]) {
      if (rv() > 0.72) continue;
      const p = cv.at(s), lz = sd * (1.0 + rv() * 0.34), x = p.x - p.tz * lz, z = p.z + p.tx * lz;
      tufts.push({ x, z, y: groundH(x, z), h: 0.2 + rv() * 0.3, team, top: false });
    }
    for (let s = 0.5; s < L - 0.5; s += 0.2) {
      const top = topAt(s), m = fbm(s * (me ? 0.45 : 0.3) + seed, seed * 1.7, 2, 3);
      if (m < (me ? 0.55 : 0.5) || rv() > (me ? 0.45 : 0.75) || piers.some(ps => Math.abs(ps - s) < 1.15)) continue;
      const p = cv.at(s), lz = (rv() - 0.5) * (me ? 1.3 : 1.1), x = p.x - p.tz * lz, z = p.z + p.tx * lz;
      tufts.push({ x, z, y: groundH(p.x, p.z) + top - 0.02, h: 0.12 + rv() * 0.2, team, top: true });
    }
  } });

  for (const bk of buckets.values()) {
    const mats = wallMaterials(tex, bk.team);
    const add = (list: THREE.BufferGeometry[], mat: THREE.Material, name: string) => { if (!list.length) return; const m = new THREE.Mesh(mergeGeometries(list)!, mat); m.castShadow = true; m.receiveShadow = true; m.name = name; group.add(m); };
    add(bk.stone, mats.stone, "wall-stone"); add(bk.trim, mats.trim, "wall-trim"); add(bk.rock, mats.rock, "wall-rock");
  }
  (group.userData as any).contact = { lines, circles: footprints };
  (group.userData as any).tufts = tufts;
  return group;
}

/** 河里的几块石头：半泡在水里，三两块一组，避开过河的路 */
export function createRiverRocks(tex: StoneTextures): THREE.Group {
  const group = new THREE.Group(); group.name = "rocks";
  const geo: THREE.BufferGeometry[][] = [[], []], circles: { x: number; z: number; r: number }[] = [], rd = rng(606), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  for (const [u, v, n] of [[-3.6, 10.5, 3], [2.8, 14, 2], [-1.2, -11.5, 2], [4.2, -9, 3], [-4.6, -17, 2], [0.8, 20.5, 2]] as [number, number, number][]) for (let k = 0; k < n; k++) {
    // 石头都靠着岸边的浅水：从给的位置往岸那一侧挪，挪到水只有小腿深的地方，大半截露在水面上（设计稿里的石头就是这样蹲在岸边的）
    let pu = u + (k ? (rd() - 0.5) * 2.2 : 0); const pv = v + (k ? (rd() - 0.5) * 2.6 : 0), dirU = Math.sign(u) || 1;
    for (let i = 0; i < 40; i++) { const [tx, tz] = toWorld(pu, pv); if (groundH(tx, tz) > WATER_Y - 0.42 - (k ? 0.12 : 0)) break; pu += dirU * 0.2; }
    const [x, z] = toWorld(pu, pv), r = k === 0 ? 0.95 + rd() * 0.4 : 0.4 + rd() * 0.3, g = boulderGeometry(900 + geo[0].length * 3 + geo[1].length * 5 + k, r * 1.1, r * 0.74, r * 0.95, 0.4);      // 河里的石头被水磨圆了
    g.applyMatrix4(m4.compose(new THREE.Vector3(x, groundH(x, z) + r * 0.32, z), q.setFromEuler(e.set(0, rd() * 6.28, 0)), new THREE.Vector3(1, 1, 1)));
    geo[u < 0 ? 0 : 1].push(g); circles.push({ x, z, r: r * 0.9 });
  }
  for (const team of [0, 1]) { if (!geo[team].length) continue;
    const rk = bTex(team === 0 ? "rock_me_b" : "rock_foe_b");
    const m = new THREE.Mesh(mergeGeometries(geo[team])!, stoneMaterial(rk.tex, { scale: 0.18, mean: rk.mean, keepTex: true, mottle: 0.25, rim: 0.1, mossEdge: team === 0 ? [0.64, 0.76] : [0.55, 0.6], color: team === 0 ? 0xb0b2a4 : 0x6a6462, moss: team === 0 ? 0.55 : 0.15, mossColor: B_LOOK.mossWall[team], waterY: WATER_Y }));      // 我方的苔和墙头大石头一样压淡（b-polish，原来 0.55–0.6、0.8）
    m.castShadow = true; m.receiveShadow = true; group.add(m); }
  (group.userData as any).circles = circles;
  return group;
}

/** 一根倒在地上的枯木，躺在墙脚 */
export function createLog(tex: StoneTextures, x: number, z: number, yaw: number, len = 3.6): THREE.Mesh {
  const g = new THREE.CylinderGeometry(0.3, 0.38, len, 14, 10), p = g.getAttribute("position");
  for (let i = 0; i < p.count; i++) { const y = p.getY(i), a = Math.atan2(p.getZ(i), p.getX(i)), k = 1 + (fbm(a * 1.4 + 3, y * 1.2, 3, 9) - 0.5) * 0.42; p.setX(i, p.getX(i) * k + Math.sin(y * 0.9) * 0.08); p.setZ(i, p.getZ(i) * k); }
  const stub = new THREE.CylinderGeometry(0.07, 0.13, 0.9, 8, 1); stub.rotateZ(0.9); stub.translate(0.42, len * 0.12, 0.05);
  const geo = mergeGeometries([tint(g, 1), tint(stub, 0.92)])!; geo.computeVertexNormals();
  const bk = bTex("bark_b"), m = new THREE.Mesh(geo, stoneMaterial(bk.tex ?? tex.bark, { scale: 0.34, mean: bk.tex ? bk.mean : 0.082, keepTex: true, mottle: 0.3, color: 0x8f6e50, moss: 0.55, mossColor: B_LOOK.moss[0], mossEdge: [0.55, 0.6] }));
  m.rotation.set(0, yaw, Math.PI / 2 - 0.04); m.position.set(x, groundH(x, z) + 0.26, z); m.castShadow = true; m.receiveShadow = true; m.name = "log";
  return m;
}
