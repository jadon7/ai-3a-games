import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { snowyMaterial } from './materials';

/** 按材质分组收集几何体，最后每组合并成一个网格（一次绘制）。 */
export class GeoBin {
  private bins = new Map<string, THREE.BufferGeometry[]>();
  add(key: string, g: THREE.BufferGeometry) {
    if (g.index) g = g.toNonIndexed();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    let a = this.bins.get(key); if (!a) { a = []; this.bins.set(key, a); }
    a.push(g);
  }
  box(key: string, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    if (rx) g.rotateX(rx);
    if (rz) g.rotateZ(rz);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    this.add(key, g);
  }
  cyl(key: string, rt: number, rb: number, h: number, x: number, y: number, z: number, seg = 14) {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, false);
    g.translate(x, y, z);
    this.add(key, g);
  }
  build(mats: Record<string, THREE.Material>, opts: { cast?: string[]; receive?: boolean } = {}) {
    const group = new THREE.Group();
    for (const [k, list] of this.bins) {
      const geo = mergeGeometries(list, false)!;
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mats[k]);
      mesh.name = k;
      mesh.castShadow = !!opts.cast?.includes(k);
      mesh.receiveShadow = opts.receive ?? true;
      group.add(mesh);
    }
    return group;
  }
}

/**
 * 庑殿式的屋面高度场：中间一条正脊，四面坡，檐口平缓、靠屋脊陡（凹曲面），四个角起翘。
 * 瓦垄做成真实的起伏（每 0.3 米一垄）。
 */
export function roofGeometry(hw: number, zc: number, hd: number, ridgeHalf: number, yEave: number, H: number, upturn: number, nx = 140, nz = 56) {
  const g = new THREE.PlaneGeometry(hw * 2, hd * 2, nx, nz);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const zn = Math.abs(z) / hd, xn = Math.max(0, (Math.abs(x) - ridgeHalf) / (hw - ridgeHalf));
    const t = Math.min(1, Math.max(zn, xn));
    let y = yEave + H * Math.pow(1 - t, 1.75);
    const corner = Math.pow(Math.abs(x) / hw, 7) * Math.pow(zn, 3) + Math.pow(zn, 7) * Math.pow(Math.abs(x) / hw, 3);
    y += upturn * Math.min(1, corner) * Math.pow(t, 3);
    // 瓦垄：前后坡按 x 起伏，两侧的坡按 z 起伏
    const onSide = xn > zn;
    const ripple = Math.abs(Math.sin((onSide ? z : x) * Math.PI / 0.3));
    y += 0.06 * Math.sqrt(ripple) * (1 - Math.pow(1 - t, 8));
    // 檐口向外微微甩出去
    const zz = z * (1 + 0.04 * Math.pow(Math.abs(x) / hw, 6));
    p.setXYZ(i, x * (1 + 0.025 * Math.pow(zn, 6)), y, zz + zc);
  }
  g.computeVertexNormals();
  return g;
}

/** 斗拱带：一排排错开的小方木。 */
function dougong(b: GeoBin, key: string, x0: number, x1: number, y: number, z: number, step: number) {
  for (let x = x0; x <= x1 + 1e-3; x += step) {
    b.box(key, 0.26, 0.12, 0.26, x, y, z);
    b.box(key, 0.7, 0.09, 0.13, x, y + 0.1, z);
    b.box(key, 0.13, 0.09, 0.7, x, y + 0.1, z + 0.15);
    b.box(key, 0.2, 0.1, 0.2, x, y + 0.19, z + 0.34);
    b.box(key, 0.85, 0.09, 0.12, x, y + 0.28, z + 0.34);
    b.box(key, 0.12, 0.09, 0.95, x, y + 0.28, z + 0.42);
    b.box(key, 0.16, 0.08, 0.16, x + 0.4, y + 0.36, z + 0.55);
    b.box(key, 0.16, 0.08, 0.16, x - 0.4, y + 0.36, z + 0.55);
  }
}

/** 大殿整组（台阶、台基、殿身）的平移：往里推、往右偏，左边让出月亮。 */
export const HALL_OFFSET = new THREE.Vector3(3.0, 0, -3.9);
/** Tripo 大殿的摆放：中心 x、z，整体下沉 y，宽度 w（米）。模型正面朝它自己的 +x。 */
export const HALL = { x: 3.0, z: -23.0, y: -0.3, w: 21 };

export interface Architecture {
  group: THREE.Group;
  /** 大殿那部分（拿 Tripo 的模型换掉时整组隐藏） */
  hall: THREE.Group;
  /** 台阶、台基（Tripo 大殿自带台基，换掉时一起隐藏） */
  base: THREE.Group;
  /** 灯笼挂点（世界坐标） */
  lanternHooks: THREE.Vector3[];
  /** 门缝、窗格里透出来的暖光材质（setDim 要压） */
  glowMat: THREE.MeshStandardMaterial;
}

export interface WallSpec { z: number; inner: [number, number] }

export function createArchitecture(opts: { skipHall?: boolean; wall?: WallSpec } = {}): Architecture {
  const stone = snowyMaterial({ color: 0x7c7f84, roughness: 0.86, snow: 0.95, grime: 0.7 });
  const stoneDark = snowyMaterial({ color: 0x4f5156, roughness: 0.9, snow: 0.9, grime: 0.6 });
  const red = snowyMaterial({ color: 0x6a1a12, roughness: 0.72, snow: 0.5, grime: 0.55, peel: true });
  const wood = snowyMaterial({ color: 0x2a1c15, roughness: 0.85, snow: 0.7, grime: 0.5 });
  const paint = snowyMaterial({ color: 0x18211f, roughness: 0.8, snow: 0.7, grime: 0.6 }); // 斗拱上褪色的青绿彩画
  const tile = snowyMaterial({ color: 0x2b2e33, roughness: 0.6, snow: 1.0, grime: 0.4, side: THREE.DoubleSide });
  const plaster = snowyMaterial({ color: 0x5e2a20, roughness: 0.92, snow: 0.9, grime: 0.8, brick: true });
  const drift = snowyMaterial({ color: 0x9aa3b0, roughness: 0.85, snow: 1.0, grime: 0.15 });
  const glowMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff7a30, emissiveIntensity: 0.13, roughness: 1 });
  // 屋面背面（从下往上看到的檐下）是深色木椽
  tile.onBeforeCompile = ((orig) => (s: any, r: any) => {
    orig(s, r);
    s.fragmentShader = s.fragmentShader.replace('#include <lights_physical_fragment>', `
      if (!gl_FrontFacing) { diffuseColor.rgb = vec3(0.045, 0.032, 0.026); roughnessFactor = 0.9; }
      #include <lights_physical_fragment>`);
  })(tile.onBeforeCompile);
  tile.customProgramCacheKey = () => 'temple-tile';

  const b = new GeoBin();   // 台阶、台基（跟大殿一起平移）
  const hb = new GeoBin();  // 大殿本身
  const wb = new GeoBin();  // 两侧院墙（世界坐标）

  // 大殿这一组的本地坐标：台阶底在 z = -9.45，台基前沿 z = -10.9，前檐柱 z = -12.7。整组平移到 HALL_OFFSET。
  // ---- 台阶和台基 ----
  const PZ = -10.9, TOP = 0.78;
  for (let i = 0; i < 5; i++) {
    const h = ((i + 1) * TOP) / 5;
    b.box('stone', 7.0, h, 0.3, 0, h / 2, -9.45 - i * 0.3);
  }
  // 台阶两侧的垂带石
  for (const s of [-1, 1]) {
    const g = new THREE.BoxGeometry(0.55, TOP + 0.1, 1.9);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 0 && p.getZ(i) > 0) p.setY(i, -0.3);
    g.translate(s * 3.78, (TOP + 0.1) / 2, -10.0);
    b.add('stone', g);
  }
  b.box('stoneDark', 22, TOP, 11.5, 0, TOP / 2, PZ - 5.75);
  b.box('stone', 22.3, 0.14, 11.8, 0, TOP + 0.07, PZ - 5.75); // 压沿石
  // 台基前沿的栏板（台阶两侧）
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const x = s * (4.6 + i * 1.5);
      b.box('stone', 0.2, 0.75, 0.2, x, TOP + 0.5, PZ - 0.25);
      b.box('stone', 1.3, 0.45, 0.1, x + s * 0.75, TOP + 0.42, PZ - 0.25);
    }
  }

  // ---- 大殿（程序化版本；有 Tripo 的模型时可以换掉） ----
  const HZ = -12.7;
  const cols = [-6.0, -2.2, 2.2, 6.0];
  const CH = 4.4; // 柱高
  for (const x of cols) {
    hb.cyl('red', 0.28, 0.31, CH, x, TOP + CH / 2, HZ, 18);
    hb.cyl('stone', 0.46, 0.5, 0.3, x, TOP + 0.15, HZ, 12); // 柱础
  }
  for (const x of [-9.2, 9.2]) hb.cyl('red', 0.28, 0.31, CH, x, TOP + CH / 2, HZ - 0.4, 18);
  hb.box('red', 19.6, 0.4, 0.46, 0, TOP + CH - 0.1, HZ);          // 额枋
  hb.box('paint', 19.6, 0.24, 0.4, 0, TOP + CH + 0.22, HZ);       // 平板枋
  dougong(hb, "paint", -9.0, 9.0, TOP + CH + 0.45, HZ - 0.15, 0.75);
  hb.box('wood', 20.4, 0.3, 2.2, 0, TOP + CH + 1.1, HZ + 0.4);     // 檐下
  // 墙、门、窗（往里缩一点）
  const WZ = HZ - 0.9;
  hb.box('wood', 20.4, CH + 0.1, 0.3, 0, TOP + CH / 2, WZ - 0.2);
  for (const [x0, x1] of [[-6.0, -2.2], [2.2, 6.0], [-9.2, -6.0], [6.0, 9.2]] as const) {
    const cx = (x0 + x1) / 2, w = x1 - x0 - 0.6;
    // 格窗：密的竖棂和横棂，窗纸后面透出很暗的暖光
    hb.box('glow', w, 1.9, 0.05, cx, TOP + 2.5, WZ - 0.02);
    const nv = 16, nh = 9;
    for (let i = 0; i <= nv; i++) hb.box('wood', 0.05, 2.0, 0.1, cx - w / 2 + (w * i) / nv, TOP + 2.5, WZ + 0.06);
    for (let j = 0; j <= nh; j++) hb.box('wood', w, 0.05, 0.1, cx, TOP + 1.55 + (j * 1.9) / nh, WZ + 0.06);
    hb.box('red', w + 0.4, 0.22, 0.2, cx, TOP + 3.55, WZ + 0.08);
    hb.box('red', w + 0.4, 0.22, 0.2, cx, TOP + 1.45, WZ + 0.08);
    hb.box('wood', w + 0.4, 1.3, 0.2, cx, TOP + 0.7, WZ + 0.08);
  }
  // 中间两扇大门，门缝透一线光
  hb.box('glow', 0.04, 3.5, 0.05, 0, TOP + 1.75, WZ + 0.02);
  for (const s of [-1, 1]) {
    hb.box('red', 1.75, 3.5, 0.16, s * 0.92, TOP + 1.75, WZ + 0.1);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 8; j++) hb.box('wood', 0.08, 0.08, 0.06, s * (0.35 + i * 0.36), TOP + 0.45 + j * 0.38, WZ + 0.2); // 门钉
  }
  hb.box('red', 4.4, 0.36, 0.3, 0, TOP + 3.7, WZ + 0.1);
  // 门匾
  hb.box('wood', 2.3, 0.95, 0.12, 0, TOP + CH + 0.75, HZ + 0.38);
  // 屋面：下檐 + 上檐（重檐）
  const E1 = TOP + CH + 1.2;
  hb.add('tile', roofGeometry(11.2, HZ - 3.6, 5.6, 7.6, E1, 1.6, 0.85));
  hb.box('wood', 15, 1.6, 5.2, 0, E1 + 1.4, HZ - 4.0);  // 上下檐之间的墙
  dougong(hb, "paint", -7.2, 7.2, E1 + 1.95, HZ - 1.5, 0.8);
  const E2 = E1 + 2.55;
  hb.add('tile', roofGeometry(9.4, HZ - 4.2, 4.6, 5.0, E2, 3.3, 0.7));
  hb.box('tile', 10.6, 0.5, 0.4, 0, E2 + 3.5, HZ - 4.2);  // 正脊
  for (const s of [-1, 1]) {
    hb.box('tile', 0.45, 1.3, 0.45, s * 5.4, E2 + 4.0, HZ - 4.2, 0, 0, s * 0.25); // 鸱吻（简化）
    hb.box('tile', 0.65, 0.45, 0.42, s * 5.05, E2 + 4.4, HZ - 4.2, 0, 0, -s * 0.5);
  }

  // ---- 两侧的院墙 ----
  buildWalls(wb, opts.wall ?? { z: HALL_OFFSET.z - 10.9 + 0.3, inner: [HALL_OFFSET.x - 11.2, HALL_OFFSET.x + 11.2] });

  const mats = { stone, stoneDark, red, wood, paint, tile, plaster, drift, glow: glowMat };
  const group = new THREE.Group();
  const complex = opts.skipHall ? new THREE.Group() : b.build(mats, { cast: [] });
  const hall = opts.skipHall ? new THREE.Group() : hb.build(mats, { cast: [] });
  complex.position.copy(HALL_OFFSET); hall.position.copy(HALL_OFFSET);
  group.add(complex, hall, wb.build(mats, { cast: [] }));
  const lanternHooks = [new THREE.Vector3(-4.1, TOP + CH + 0.55, HZ + 1.0), new THREE.Vector3(4.1, TOP + CH + 0.55, HZ + 1.0)].map((v) => v.add(HALL_OFFSET));
  return { group, hall, base: complex, lanternHooks, glowMat };
}

// ------------------------------------------------------------------
// 院墙：石墙基 + 红灰泥墙身（剥落露砖、返潮、水渍在材质里）+ 隔一段一个墙垛 + 瓦顶墙帽（真的瓦垄和瓦当）+ 墙根积雪。
// 一边一段塌了，碎砖碎瓦散在地上。
// ------------------------------------------------------------------
let wseed = 11;
const wr = () => { wseed = (wseed * 16807) % 2147483647; return wseed / 2147483647; };

/** 墙帽：两坡的小瓦顶，沿 x 方向一垄一垄（每 0.24 米），檐口往外挑。中心在原点，顶在 y = rise。 */
function wallCapGeometry(len: number, half: number, rise: number) {
  const nx = Math.max(8, Math.round(len / 0.06)), nz = 8;
  const g = new THREE.PlaneGeometry(len, half * 2, nx, nz);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const t = Math.min(1, Math.abs(z) / half);
    let y = rise * Math.pow(1 - t, 1.25);
    // 瓦垄：筒瓦凸、板瓦凹
    const ph = (x / 0.24) * Math.PI * 2;
    y += 0.035 * Math.max(0, Math.cos(ph)) - 0.012;
    p.setY(i, y);
  }
  g.computeVertexNormals();
  return g;
}

function buildWalls(wb: GeoBin, spec: WallSpec) {
  const Z = spec.z, H = 3.4, SEG = 4.8, N = 6;
  for (const s of [-1, 1]) {
    const start = s < 0 ? spec.inner[0] : spec.inner[1];
    for (let k = 0; k < N; k++) {
      const x0 = start + s * k * SEG, x1 = x0 + s * SEG, cx = (x0 + x1) / 2;
      const broken = (k === 1 && s > 0) || (k === 3 && s < 0); // 右边近处、左边远处各塌一段
      const h = broken ? (s > 0 ? 1.7 : 1.1) : H;
      wb.box('stoneDark', SEG, 0.62, 0.95, cx, 0.31, Z);
      if (!broken) wb.box('plaster', SEG, h - 0.62, 0.72, cx, 0.62 + (h - 0.62) / 2, Z);
      else {
        // 塌口：墙身参差，上沿是锯齿
        const n = 7;
        for (let i = 0; i < n; i++) {
          const w = SEG / n, hx = cx - SEG / 2 + (i + 0.5) * w;
          const hh = h * (0.55 + 0.45 * wr()) + (i === 0 || i === n - 1 ? 1.2 : 0);
          wb.box('plaster', w + 0.02, hh - 0.62, 0.72, hx, 0.62 + (hh - 0.62) / 2, Z);
        }
        // 碎砖、碎瓦散在墙前
        for (let i = 0; i < 26; i++) {
          const rx = cx + (wr() - 0.5) * SEG * 1.1, rz = Z + 0.5 + wr() * 2.2 * wr();
          const sz = 0.18 + wr() * 0.35;
          wb.box(wr() < 0.6 ? 'stoneDark' : 'tile', sz, sz * (0.35 + wr() * 0.4), sz * (0.6 + wr() * 0.5), rx, sz * 0.12, rz, wr() * 3, (wr() - 0.5) * 0.6, (wr() - 0.5) * 0.6);
        }
        // 半截掉下来的墙帽斜靠在墙根
        const cap = wallCapGeometry(SEG * 0.4, 0.7, 0.3);
        cap.rotateZ(s * 0.5); cap.rotateX(-0.35);
        cap.translate(cx + s * 0.6, 0.45, Z + 0.9);
        wb.add('tile', cap);
      }
      // 墙垛（每段起点一个，比墙身厚一点、高一点）
      wb.box('stoneDark', 0.85, 0.7, 1.15, x0, 0.35, Z);
      wb.box('plaster', 0.7, H + 0.1 - 0.7, 0.92, x0, 0.7 + (H + 0.1 - 0.7) / 2, Z);
      if (!broken) {
        const cap = wallCapGeometry(SEG + 0.02, 0.78, 0.34);
        cap.translate(cx, h + 0.04, Z);
        wb.add('tile', cap);
        wb.box('tile', SEG + 0.02, 0.16, 0.2, cx, h + 0.42, Z);           // 屋脊
        wb.box('wood', SEG + 0.02, 0.14, 0.86, cx, h - 0.03, Z);          // 墙帽下的檐板（暗）
        // 瓦当：檐口一排小圆筒（前面一排，后面看不见不做）
        for (let x = -SEG / 2 + 0.12; x < SEG / 2; x += 0.24) {
          const c = new THREE.CylinderGeometry(0.055, 0.055, 0.12, 6);
          c.rotateX(Math.PI / 2 - 0.35);
          c.translate(cx + x, h + 0.02, Z + 0.8);
          wb.add('tile', c);
        }
      }
      // 墙根积雪：贴着墙前面的一道雪坡，高低起伏
      if (!broken || s > 0) wb.add('drift', snowDrift(SEG + 0.9, cx, Z + 0.47, broken ? 0.18 : 0.42));
      // 墙垛顶的小帽
      const pc = wallCapGeometry(0.95, 0.62, 0.3); pc.translate(x0, H + 0.12, Z); wb.add('tile', pc);
    }
  }
}

/** 墙根的雪坡：沿 x 的一条，截面是贴墙高、往外低的弧，高度带噪声。 */
function snowDrift(len: number, cx: number, z0: number, hmax: number) {
  const nx = Math.round(len / 0.15), nz = 6;
  const g = new THREE.PlaneGeometry(len, 1, nx, nz);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position as THREE.BufferAttribute;
  const ph = wr() * 100;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), v = p.getZ(i) + 0.5; // 0 贴墙，1 外沿
    const n = 0.6 + 0.4 * Math.sin(x * 1.7 + ph) * Math.sin(x * 0.63 + ph * 2) + 0.15 * Math.sin(x * 5.3 + ph);
    const reach = 0.9 + 0.6 * n;
    p.setXYZ(i, x + cx, hmax * n * Math.pow(Math.max(0, 1 - v), 1.6) - 0.02, z0 + v * reach);
  }
  g.computeVertexNormals();
  return g;
}
