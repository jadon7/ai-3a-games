// 防御塔（我方外塔）。第一版是图转 3D 的模型，肋条糊成了一团、镂空里透出来的光也没了，看不出结构。
// 第二版照定稿的设计图在代码里一层一层建出来，每一层是什么、压着什么都看得清：
//
//   石座      一圈十四块收边石，和地上那圈地砖对上
//   钟形底    暗绿的青铜，上下各箍一道金边；四面各嵌一块带金框的发光饰牌
//   石芯      三段石鼓。下段两层料石；中段只留四根石柱，柱子之间镂空，里面的晶芯从缝里透出光；上段往外张开成柱头
//   四根肋    青铜的长肋从座上起来，在腰部贴近石芯，到肩部往外张，最后在塔顶弯成四只爪，拢着水晶；
//             每根肋两边镶金边，外面嵌三段发光的晶条
//   水晶      一颗切面的晶体悬在爪子中间，慢慢转
//
// 发光的只有晶体、晶芯和晶条，照明范围很小。

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { toWorld } from "../layout";
import { bentBlock, fin, skin, stoneMaterial, type Curve, type StoneTextures } from "./stone";

const TAU = Math.PI * 2;
const circle = (rm: number): Curve => ({ L: TAU * rm, at: s => { const a = s / rm; return { x: rm * Math.cos(a), z: rm * Math.sin(a), tx: -Math.sin(a), tz: Math.cos(a) }; } });

/** 一圈料石：内外半径 r0、r1，高 y0 到 y1，分成 n 块；keep 决定哪几块留着（不留的就是镂空） */
function ring(out: THREE.BufferGeometry[], r0: number, r1: number, y0: number, y1: number, n: number, phase: number, c: number, k: number, seed: number, keep?: (i: number) => boolean, gap = 0.028) {
  const rm = (r0 + r1) / 2, cv = circle(rm), da = TAU / n;
  for (let i = 0; i < n; i++) {
    if (keep && !keep(i)) continue;
    const a0 = phase + i * da;
    out.push(fin(bentBlock(cv, a0 * rm + gap / 2, (a0 + da) * rm - gap / 2, y0 + 0.004, y1 - 0.004, (r1 - r0) / 2, c, seed + i * 1.7, 0.008, 0, 0.11), k * (0.9 + ((i * 7 + Math.floor(seed)) % 5) * 0.045)));
  }
}

/** 一条旋出来的带子（钟形底、金箍、托盘）：给一串（半径, 高度） */
const lathe = (pts: [number, number][], seg = 40) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);

interface Sample { r: number; y: number; hw: number; ht: number; bo?: number; no?: number; }
/** 沿着一条在“半径—高度”平面里的曲线扫出一根条：hw 是横向的半宽，ht 是里外方向的半厚。theta 是它在塔的哪个方向上 */
function sweep(pts: Sample[], theta: number, c: number): THREE.BufferGeometry {
  const ct = Math.cos(theta), st = Math.sin(theta);
  return skin(pts.map((p, i) => {
    const a = pts[Math.max(i - 1, 0)], b = pts[Math.min(i + 1, pts.length - 1)], dl = Math.hypot(b.r - a.r, b.y - a.y) || 1, nr = (b.y - a.y) / dl, ny = -(b.r - a.r) / dl;
    const h = p.hw, t = p.ht, cc = Math.min(c, h * 0.45, t * 0.45);
    const sec = [[-h + cc, -t], [h - cc, -t], [h, -t + cc], [h, t - cc], [h - cc, t], [-h + cc, t], [-h, t - cc], [-h, -t + cc]];
    return sec.map(([l, n]) => { const L = l + (p.bo ?? 0), N = n + (p.no ?? 0), rr = p.r + nr * N, yy = p.y + ny * N; return [rr * ct + L * st, yy, rr * st - L * ct]; });
  }));
}
/** 几个关键点之间走圆滑的曲线，取 n 个点。每个关键点是 [半径, 高度, 半宽, 半厚] */
function spline(keys: number[][], n: number): Sample[] {
  const q = [keys[0], ...keys, keys[keys.length - 1]], out: Sample[] = [];
  for (let s = 0; s <= n; s++) {
    const u = (s / n) * (keys.length - 1), i = Math.min(Math.floor(u), keys.length - 2) + 1, t = u - (i - 1), t2 = t * t, t3 = t2 * t;
    const f = (k: number) => 0.5 * (2 * q[i][k] + (q[i + 1][k] - q[i - 1][k]) * t + (2 * q[i - 1][k] - 5 * q[i][k] + 4 * q[i + 1][k] - q[i + 2][k]) * t2 + (3 * q[i][k] - q[i - 1][k] - 3 * q[i + 1][k] + q[i + 2][k]) * t3);
    out.push({ r: f(0), y: f(1), hw: Math.max(f(2), 0.012), ht: Math.max(f(3), 0.012) });
  }
  return out;
}

/** 一颗切面的晶体：上尖、下尖，中间一圈腰 */
function gem(): THREE.BufferGeometry {
  const N = 6, top = [0, 0.66, 0], bot = [0, -0.56, 0], U: number[][] = [], D: number[][] = [], pos: number[] = [];
  for (let i = 0; i < N; i++) { const a = (i / N) * TAU, b = a + TAU / N / 2; U.push([Math.cos(a) * 0.37, 0.16, Math.sin(a) * 0.37]); D.push([Math.cos(b) * 0.29, -0.12, Math.sin(b) * 0.29]); }
  const tri = (a: number[], b: number[], c: number[]) => pos.push(...a, ...b, ...c);
  for (let i = 0; i < N; i++) { const j = (i + 1) % N; tri(top, U[j], U[i]); tri(U[i], U[j], D[i]); tri(U[j], D[j], D[i]); tri(bot, D[i], D[j]); }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
  return g;
}

export function createTower(tex: StoneTextures, u: number, v: number, groundY: number): THREE.Group {
  const group = new THREE.Group(); group.name = "tower";
  const stone: THREE.BufferGeometry[] = [], bronze: THREE.BufferGeometry[] = [], gold: THREE.BufferGeometry[] = [], glow: THREE.BufferGeometry[] = [];

  // ---- 石座 ----
  ring(stone, 1.3, 1.76, 0, 0.32, 14, 0.1, 0.045, 0.96, 11);

  // ---- 钟形底 ----
  bronze.push(fin(lathe([[1.3, 0.06], [1.47, 0.1], [1.47, 0.44], [1.41, 0.56], [1.25, 1.06], [1.09, 1.5], [1.0, 1.72], [0.6, 1.74]]), 1, 0.35));
  gold.push(fin(lathe([[1.44, 0.26], [1.53, 0.29], [1.53, 0.43], [1.44, 0.46]]), 1));
  gold.push(fin(lathe([[0.99, 1.64], [1.08, 1.67], [1.08, 1.8], [0.99, 1.83], [0.7, 1.84]]), 1.04));
  gold.push(fin(lathe([[1.3, 0.86], [1.345, 0.88], [1.33, 0.95], [1.28, 0.96]]), 0.96));
  // 四面的饰牌：尖顶的金框，里面一块发光的晶片。贴在钟面上，跟着钟面往里斜
  for (let k = 0; k < 4; k++) {
    const theta = k * (TAU / 4), outline = (s: number) => { const sh = new THREE.Shape(); sh.moveTo(0, 0.62 * s); sh.lineTo(0.3 * s, 0.2 * s); sh.lineTo(0.24 * s, -0.5 * s); sh.lineTo(0, -0.62 * s); sh.lineTo(-0.24 * s, -0.5 * s); sh.lineTo(-0.3 * s, 0.2 * s); sh.closePath(); return sh; };
    const frame = outline(1); frame.holes.push(outline(0.66));
    const put = (g: THREE.BufferGeometry, dz: number) => { g.rotateX(-0.33); g.translate(0, 1.0, 1.265 + dz); g.rotateY(Math.PI / 2 - theta); return g; };
    gold.push(fin(put(new THREE.ExtrudeGeometry(frame, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 1 }), 0.01), 1.02));
    glow.push(fin(put(new THREE.ExtrudeGeometry(outline(0.68), { depth: 0.035, bevelEnabled: false }), 0.01), 1));
    bronze.push(fin(put(new THREE.ExtrudeGeometry(outline(1.0), { depth: 0.03, bevelEnabled: false }), -0.015), 0.8));
  }

  // ---- 石芯 ----
  ring(stone, 0.5, 0.97, 1.8, 2.42, 8, 0.0, 0.04, 1.0, 21);
  ring(stone, 0.5, 0.9, 2.42, 3.0, 7, 0.45, 0.04, 1.02, 22);
  // 中段：只留对着四根肋的四根石柱，柱子之间是空的，晶芯从这里透出来
  ring(stone, 0.38, 0.72, 3.2, 4.5, 8, TAU / 16, 0.045, 1.0, 23, i => i % 2 === 0, 0.05);
  ring(stone, 0.5, 1.0, 4.5, 4.76, 10, 0.2, 0.05, 1.05, 24);
  ring(stone, 0.5, 0.78, 4.76, 5.3, 7, 0.1, 0.04, 1.0, 25);
  ring(stone, 0.5, 0.86, 5.3, 5.84, 7, 0.55, 0.04, 1.02, 26);
  ring(stone, 0.5, 1.1, 5.84, 6.2, 9, 0.3, 0.07, 1.07, 27);
  // 晶芯：石鼓里面的一根发光柱。平时被石头挡着，只在两段石鼓之间的缝和中段的镂空里露出来
  { const g = new THREE.CylinderGeometry(0.5, 0.6, 1.4, 7, 1, true); g.translate(0, 3.85, 0); glow.push(fin(g, 1.05, 0.5)); }
  { const g = new THREE.CylinderGeometry(0.69, 0.69, 0.2, 24, 1, true); g.translate(0, 3.1, 0); glow.push(fin(g, 0.85)); }
  // 托盘：青铜的浅盘，金边，托着水晶
  ring(stone, 0.4, 0.9, 6.2, 6.36, 9, 0.65, 0.05, 1.08, 28);
  bronze.push(fin(lathe([[0.62, 6.3], [0.64, 6.42], [0.5, 6.5], [0.36, 6.52], [0.3, 6.62], [0.02, 6.64]]), 1.05));
  gold.push(fin(lathe([[0.6, 6.34], [0.67, 6.36], [0.67, 6.44], [0.6, 6.46]]), 1.05));
  { const g = new THREE.CylinderGeometry(0.2, 0.27, 0.07, 12); g.translate(0, 6.66, 0); glow.push(fin(g, 1.1)); }

  // ---- 四根肋 ----
  const RIB = [[1.53, 0.3, 0.3, 0.11], [1.47, 0.95, 0.42, 0.12], [1.28, 1.9, 0.4, 0.11], [1.1, 3.0, 0.25, 0.1], [1.02, 4.0, 0.16, 0.1], [1.12, 5.0, 0.24, 0.1], [1.26, 5.9, 0.31, 0.1], [1.28, 6.62, 0.22, 0.095], [1.14, 7.25, 0.15, 0.085], [0.88, 7.52, 0.1, 0.07], [0.68, 7.4, 0.04, 0.04]];
  const path = spline(RIB, 60);
  for (let k = 0; k < 4; k++) {
    const theta = TAU / 8 + k * (TAU / 4);
    bronze.push(fin(sweep(path, theta, 0.035), 0.96 + (k % 2) * 0.06, 0.25));
    // 两边的金边：贴着肋的外沿，到爪尖之前收掉
    for (const sd of [-1, 1]) gold.push(fin(sweep(path.slice(0, 53).map(p => ({ r: p.r, y: p.y, hw: 0.036, ht: 0.036, bo: sd * (p.hw - 0.03), no: p.ht + 0.004 })), theta, 0.012), 1));
    // 外面嵌的三段晶条
    for (const [a, b] of [[7, 16], [22, 29], [34, 39]]) glow.push(fin(sweep(path.slice(a, b + 1).map((p, i, arr) => { const e = Math.min(i, arr.length - 1 - i) / 2; return { r: p.r, y: p.y, hw: p.hw * 0.2 * Math.min(0.3 + e, 1), ht: 0.02, no: p.ht + 0.07 }; }), theta, 0.008), 1, 0.45));
    // 下半截外面再叠一片小一号的叶片（暗青铜、金边），一层压一层
    { const leaf = path.slice(3, 21).map((p, i, arr) => { const t = i / (arr.length - 1), k = Math.sin(Math.PI * Math.min(t * 1.15, 1)) ; return { r: p.r, y: p.y, hw: Math.max(p.hw * 0.62 * k, 0.03), ht: 0.03, no: p.ht + 0.03 }; });
      bronze.push(fin(sweep(leaf, theta, 0.012), 1.18));
      for (const sd of [-1, 1]) gold.push(fin(sweep(leaf.map(p => ({ r: p.r, y: p.y, hw: 0.022, ht: 0.024, bo: sd * p.hw, no: (p.no ?? 0) + 0.012 })), theta, 0.008), 1.05)); }
    // 腰上和肩上各一道金箍，把肋“扣”在石芯上
    for (const i of [19, 31]) gold.push(fin(sweep(path.slice(i - 1, i + 2).map(p => ({ r: p.r, y: p.y, hw: p.hw + 0.035, ht: p.ht + 0.03 })), theta, 0.02), 1.02));
    // 肋脚：压在石座上的一块青铜靴
    { const g = sweep([{ r: 1.56, y: 0.3, hw: 0.4, ht: 0.15 }, { r: 1.55, y: 0.5, hw: 0.4, ht: 0.15 }, { r: 1.5, y: 0.62, hw: 0.36, ht: 0.13 }], theta, 0.04); bronze.push(fin(g, 0.9)); }
    { const g = sweep([{ r: 1.56, y: 0.47, hw: 0.42, ht: 0.165 }, { r: 1.54, y: 0.56, hw: 0.42, ht: 0.165 }], theta, 0.02); gold.push(fin(g, 1)); }
  }

  const merged = (list: THREE.BufferGeometry[], mat: THREE.Material, name: string, shadow = true) => { const m = new THREE.Mesh(mergeGeometries(list)!, mat); m.castShadow = shadow; m.receiveShadow = shadow; m.name = name; group.add(m); return m; };
  merged(stone, stoneMaterial(tex.stone[0], { scale: 0.42, mean: 0.454, gain: 2.4, color: 0xb1b1a5, moss: 0.4, mossColor: 0x5f7030, dirt: 0.5 }), "tower-stone");
  merged(bronze, stoneMaterial(tex.trim[0], { scale: 0.6, mean: 0.155, gain: 2.2, chroma: 0.1, color: 0x466a5b, rough: 0.46 }), "tower-bronze");
  merged(gold, stoneMaterial(tex.trim[0], { scale: 0.8, mean: 0.155, gain: 1.2, chroma: 0, color: 0xb59c5c, rough: 0.38 }), "tower-gold");
  merged(glow, new THREE.MeshStandardMaterial({ color: 0x0c3c3a, emissive: new THREE.Color(0.1, 0.78, 0.7), emissiveIntensity: 1.0, roughness: 0.3, metalness: 0, vertexColors: true, flatShading: true }), "tower-glow", false);

  // ---- 水晶 ----
  const CY = 7.2;
  const crystal = new THREE.Mesh(gem(), new THREE.MeshStandardMaterial({ color: 0x55d8cf, emissive: 0x12a79c, emissiveIntensity: 0.6, roughness: 0.12, metalness: 0, flatShading: true, transparent: true, opacity: 0.8 }));
  crystal.scale.setScalar(1.5); crystal.renderOrder = 7;
  // 晶体里面一颗更亮的芯：隔着外面那层切面看进去，亮的在里头，不是一整块发白
  { const core = new THREE.Mesh(gem(), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.72, 1.0, 0.95) })); core.scale.set(0.52, 0.62, 0.52); core.rotation.y = 0.5; crystal.add(core); }
  crystal.position.y = CY; crystal.castShadow = true; crystal.name = "tower-crystal"; group.add(crystal);
  // 晶体外面一小圈柔光。半径很小，只让晶体自己亮，不把周围染一片
  { const cv = document.createElement("canvas"); cv.width = cv.height = 128; const g = cv.getContext("2d")!, gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, "rgba(255,255,255,0.85)"); gr.addColorStop(0.25, "rgba(255,255,255,0.3)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), color: 0x6ff0e6, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.42 }));
    sp.scale.setScalar(2.3); sp.position.set(0, CY, 0); sp.renderOrder = 8; group.add(sp); }
  // 晶体的一点点光照在爪子、柱头和脚下的地砖上
  const lamp = new THREE.PointLight(0x58e6e0, 9, 8, 2); lamp.position.set(0, CY, 0); group.add(lamp);

  const [x, z] = toWorld(u, v);
  group.position.set(x, groundY, z);
  // 镜头是从正前方偏上看过来的：把塔转到两根肋在前、两根在后，中间那面镂空正对镜头
  group.rotation.y = 0;
  (group.userData as any).update = (t: number) => { crystal.rotation.y = t * 0.5; crystal.position.y = CY + Math.sin(t * 1.3) * 0.05; };
  return group;
}
