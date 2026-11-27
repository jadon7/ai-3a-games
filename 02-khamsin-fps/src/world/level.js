// 原创地图「卡姆辛旧城」：三路两点结构
//   西路  运河道：下沉河床（-3.4m）→ 水门 → 涵洞 → 涵洞台阶上到 B 点西拱门；上层是被闸墙截断的运河路
//   中路  南大道 → 广场 → 中门（半开的双开木门）→ 巴扎十字 → 北大道（西侧 B 门、东侧 A 西阶）
//   东路  长街：断拱门 → 塌陷弹坑 → A 坡道；全程可通行机甲
//   A 点  东北角的货栈高台（+2.6m）：东坡道 / 南短阶（巴扎）/ 西阶（北大道）/ 北阶（敌方出生区）
//   B 点  西北角的泵站院（四面围墙）：西拱门（涵洞）/ 东侧 B 门 / 北缺口 / 南墙窗洞（只有铁驭能翻）
//   其余  西南街区底层打通成「暗道」，各条巷子两端加了拱门墙
import * as THREE from 'three';
import { M4, PLASTER, ACCENT, CLOTH, archRise } from './kit.js';

export const BOUNDS = { x0: -76, x1: 70, z0: -77, z1: 77 };
const CRATER = { x: 49, z: 2, rx: 6.2, rz: 10.5, d: 1.6 };
const A_Y = 2.6;   // A 点高台的台面高度
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function dune(x, z) {
  const a = Math.sin(x * 0.021 + Math.sin(z * 0.013) * 2.2) * 0.5 + 0.5;
  const b = Math.sin(z * 0.017 + Math.sin(x * 0.011 + 1.3) * 1.8 + 2.0) * 0.5 + 0.5;
  return Math.pow(a, 1.6) * 0.6 + Math.pow(b, 2.0) * 0.4;
}
export function terrainH(x, z) {
  let h = 0;
  if (x > -62 && x < -50) { let depth = 3.4; const az = Math.abs(z); if (az > 56) depth *= Math.max(0, 1 - (az - 56) / 12); h = -depth; }
  // 长街中段的塌陷弹坑：平底 + 缓坡，步兵和机甲都能走下去
  { const u = (x - CRATER.x) / CRATER.rx, v = (z - CRATER.z) / CRATER.rz; const r = Math.hypot(u, v); if (r < 1) h -= CRATER.d * Math.min(1, (1 - r) / 0.6); }
  const d = Math.max(Math.abs(x + 3) - 79, Math.abs(z) - 84, 0);
  if (d > 0) h += sstep(0, 90, d) * (2 + 15 * dune(x, z));
  return h;
}
const ROADS = [[-6, -76, 6, -34], [-6, 34, 6, 76], [42, -76, 56, 76], [-44, 26, 42, 34], [-50, -76, -44, 76], [-44, -5, -20, 5], [20, -5, 42, 5], [-61, -70, -51, 70], [-44, -74, 42, -62], [-30, 62, 30, 74]];
function dirtW(x, z) {
  let w = 0.08;
  for (const r of ROADS) { const dx = Math.max(r[0] - x, 0, x - r[2]), dz = Math.max(r[1] - z, 0, z - r[3]); w = Math.max(w, 0.8 * (1 - sstep(0, 3, Math.hypot(dx, dz)))); }
  return w;
}

export function buildLevel(B, K) {
  const { rr, pick, chance, rng } = K;
  const L = {
    playerSpawn: { x: 0, y: 0.1, z: 67, yaw: 0 },
    friendlyPods: [[-12, 58], [12, 58], [0, 44], [-26, 56], [49, 52], [-47, 44], [0, 30], [49, 30]],
    enemyPods: [[0, -66], [-47, -47], [49, -56], [-26, -68], [16, -68], [0, -46], [-24, -44], [27, -50]],
    mechDrops: [[49, 40], [49, -36], [0, 48], [0, -52], [-24, 58], [10, -68], [0, 12]],
    nests: [[-25.5, 10.5, -20.5], [14.5, A_Y + 4.4, -55.2], [63, 12.5, -52], [-70, 12.5, -15], [24, 8.4, 57], [0, 6.8, -24.9]],
    zones: { A: { x: 26, z: -49, r: 11 }, B: { x: -25, z: -48, r: 10 } },
    // 交战点：路口、门洞、坡道、据点（AI 的巡逻目标）。第三项是所属路线：M 中 / E 东 / W 西 / C 连接处
    combatPoints: [
      ...[[0, 8], [0, -10], [0, 30], [0, 50], [0, -30], [0, -46]].map((p) => [...p, 'M']),                                   // 中路：广场 / 南口 / 南大道 / 巴扎十字（中门后）/ 北大道
      ...[[49, 30], [49, 16], [49, 2], [48, -22], [47, -45], [26, -45], [25, -30], [49, 46]].map((p) => [...p, 'E']),         // 东路：断拱门 / 弹坑 / A 坡道口 / A 点 / 短阶下
      ...[[-47, 30], [-56, 12], [-56, -10], [-56, -34], [-47, -45], [-24, -44], [-25, -30], [-56, 44]].map((p) => [...p, 'W']),   // 西路：运河路 / 河床 / 水门 / 涵洞 / B 点
      ...[[-32, 0], [31, 0], [-38, 15], [-30, 30], [25, 30], [24, 48], [-25, 46]].map((p) => [...p, 'C']),                    // 连接：东西巷 / 暗道 / 市集街 / 驿站 / 废墟花园
    ],
    ziplines: [], shafts: [], flyover: [], lanterns: [],
  };

  // ============ 地形 ============
  {
    const g = new THREE.PlaneGeometry(164, 176, 164, 176); g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position; const layer = [], col = [];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i); pos.setY(i, terrainH(x, z));
      layer.push(dirtW(x, z)); const t = 0.92 + 0.08 * Math.sin(x * 0.31 + z * 0.17) * Math.sin(z * 0.23 - x * 0.11); col.push(t, t, t);
    }
    g.computeVertexNormals();
    g.setAttribute('aLayer', new THREE.Float32BufferAttribute(layer, 1)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    B.addGeo('terrain', g, new THREE.Matrix4(), { uv: 'world', collide: true, mech: true, rays: 14, surf: 'sand' });
    // 外围沙丘（低精度环）
    const P = [], N = [], U = [], I = []; const step = 10, R = 520;
    const idx = new Map(); const vid = (ix, iz) => { const k = ix + '|' + iz; let v = idx.get(k); if (v === undefined) { const x = ix * step - 3, z = iz * step; v = P.length / 3; P.push(x, terrainH(x, z) - 0.05, z); N.push(0, 1, 0); U.push(x, z); idx.set(k, v); } return v; };
    for (let iz = -R / step; iz < R / step; iz++) for (let ix = -R / step; ix < R / step; ix++) {
      const cx = (ix + 0.5) * step - 3, cz = (iz + 0.5) * step;
      if (Math.abs(cx + 3) < 74 && Math.abs(cz) < 80) continue;
      const a = vid(ix, iz), b = vid(ix + 1, iz), c = vid(ix + 1, iz + 1), d = vid(ix, iz + 1); I.push(a, d, c, a, c, b);
    }
    const og = new THREE.BufferGeometry(); og.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); og.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); og.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); og.setIndex(I); og.computeVertexNormals();
    B.addGeo('terrain', og, new THREE.Matrix4(), { uv: 'world', rays: 0, a: 0.05 });
  }

  // 远景：平顶山 + 城外建筑群
  {
    const mesa = (x, z, r, h) => {
      // 不规则平顶山：多层收分的多边形棱柱，逐顶点扰动 + 平面着色
      const layers = 3; let y = terrainH(x, z) - 6, rad = r; const ox = rr(-0.2, 0.2) * r, oz = rr(-0.2, 0.2) * r;
      for (let i = 0; i < layers; i++) {
        const hh = h * [0.42, 0.33, 0.25][i];
        let g = new THREE.CylinderGeometry(rad * rr(0.78, 0.9), rad, hh, 11, 2);
        const pos = g.attributes.position;
        for (let k = 0; k < pos.count; k++) { const px = pos.getX(k), pz = pos.getZ(k); const a = Math.atan2(pz, px); const f = 1 + 0.16 * Math.sin(a * 3 + i * 1.7 + x) + 0.10 * Math.sin(a * 7 + z) + 0.05 * Math.sin(pos.getY(k) * 0.3 + a * 5); pos.setX(k, px * f); pos.setZ(k, pz * f * 0.8); }
        g = g.toNonIndexed(); g.computeVertexNormals();
        B.addGeo('rock', g, M4(x + ox * i, y + hh / 2, z + oz * i, 0, i * 0.7, 0), { uv: 'world', ts: 40, rays: 0, c: [0.92, 0.80, 0.70] });
        y += hh; rad *= rr(0.6, 0.78);
      }
    };
    for (let i = 0; i < 16; i++) { const a = i / 16 * 6.28 + rr(-0.15, 0.15); const d = rr(430, 640); mesa(Math.cos(a) * d, Math.sin(a) * d, rr(50, 120), rr(60, 130)); }
    for (let i = 0; i < 120; i++) {
      const a = rng() * 6.28; const d = rr(105, 250); const x = Math.cos(a) * d - 3, z = Math.sin(a) * d * 1.05;
      if (Math.abs(x + 3) < 86 && Math.abs(z) < 92) continue;
      const w = rr(7, 16), dp = rr(7, 16), h = rr(4, 12); const y = terrainH(x, z);
      const fc = pick(PLASTER);
      B.box('plaster', x - w / 2, y - 1, z - dp / 2, x + w / 2, y + h, z + dp / 2, { c: fc, collide: false, rays: 0, a: 0.1, cell: 50, bottom: false });
      // 远景建筑的屋顶女儿墙与成排的窗洞（仅剪影级细节）
      B.box('plaster', x - w / 2 + 0.4, y + h, z - dp / 2 + 0.4, x + w / 2 - 0.4, y + h + 0.5, z + dp / 2 - 0.4, { c: [fc[0] * 0.8, fc[1] * 0.78, fc[2] * 0.72], collide: false, rays: 0, cell: 50, skip: 'D' });
      const floorsN = Math.max(1, Math.round(h / 3.4));
      for (let fl = 0; fl < floorsN; fl++) { const wy = y + 1.2 + fl * (h / floorsN);
        for (let wx = x - w / 2 + 1.6; wx < x + w / 2 - 1; wx += 3.1) { B.box('dark', wx, wy, z - dp / 2 - 0.03, wx + 1.0, wy + 1.4, z - dp / 2 + 0.02, { collide: false, rays: 0, skip: 'UDEWS' }); B.box('dark', wx, wy, z + dp / 2 - 0.02, wx + 1.0, wy + 1.4, z + dp / 2 + 0.03, { collide: false, rays: 0, skip: 'UDEWN' }); }
        for (let wz = z - dp / 2 + 1.6; wz < z + dp / 2 - 1; wz += 3.1) { B.box('dark', x - w / 2 - 0.03, wy, wz, x - w / 2 + 0.02, wy + 1.4, wz + 1.0, { collide: false, rays: 0, skip: 'UDNSE' }); B.box('dark', x + w / 2 - 0.02, wy, wz, x + w / 2 + 0.03, wy + 1.4, wz + 1.0, { collide: false, rays: 0, skip: 'UDNSW' }); } }
      if (chance(0.12)) K.dome(x, y + h, z, Math.min(w, dp) * 0.32, [0.92, 0.9, 0.85], 'plaster', 0.6);
      if (chance(0.06)) { K.cyl('plaster', x + w / 2, y, z + dp / 2, 1.3, h + rr(10, 16), { c: [0.9, 0.84, 0.72], a: 0.05, rays: 0 }); }
    }
  }

  // ============ 铺装 ============
  const pave = (x0, z0, x1, z1, y = 0.05, mat = 'paving', o = {}) => B.box(mat, x0, y - 0.35, z0, x1, y, z1, { skip: 'D', ...o });
  pave(-20, -18, 20, 18);                       // 广场
  pave(-44, -34, 42, -26, 0.045);               // 巴扎街
  pave(-6, -26, 6, -18, 0.04); pave(-6, 18, 6, 26, 0.04);
  pave(-20, -21, -6, -18, 0.06); pave(6, -21, 20, -18, 0.06); pave(-20, 18, -6, 21, 0.06); pave(6, 18, 20, 21, 0.06);
  pave(14, 42, 34, 54, 0.05);                   // A 点院落
  pave(21.5, 34, 26.5, 42, 0.045); pave(6, 45.5, 14, 50.5, 0.045); pave(34, 45.5, 42, 50.5, 0.045);
  pave(-37, -59, -11, -37, 0.05, 'concrete', { c: [0.9, 0.86, 0.8] });   // B 点混凝土地坪

  // ============ 运河（西路下层）============
  {
    const wo = { grime: { h: 1.4, m: 0.62 }, top: { h: 0.8, m: 0.85 } };
    B.box('sandstone', -51, -3.7, -68, -50, 0.0, 68, wo);
    B.box('sandstone', -62, -3.7, -68, -61, 0.0, 68, wo);
    // 路缘（涵洞盖板与水门处不设）
    for (const [a, b] of [[-62, -50], [-22, -17], [-15, -5.5], [-2.5, 25], [31, 62]]) B.box('sandstone', -50.45, 0, a, -50, 0.5, b, {});
    for (const [a, b] of [[-66, -50], [-22, -17], [-15, 25], [31, 66]]) B.box('sandstone', -62, 0, a, -61.6, 0.45, b, {});
    // 南石桥
    for (const zc of [28]) {
      const z0 = zc - 2.2, z1 = zc + 2.2;
      B.box('sandstone', -62, -0.5, z0, -50, 0.05, z1, { bottom: true });
      K.arches(-61, z0, -51, z0, -3.4, 2.9, { n: 2, colW: 0.9, pointed: false, above: 0.25, minSpring: 0.5 });
      K.arches(-51, z1, -61, z1, -3.4, 2.9, { n: 2, colW: 0.9, pointed: false, above: 0.25, minSpring: 0.5 });
      B.box('sandstone', -62, 0.05, z0, -50, 0.75, z0 + 0.3, {}); B.box('sandstone', -62, 0.05, z1 - 0.3, -50, 0.75, z1, {});
      K.lantern(-56, 0.75 + 1.9, z0 + 0.15, { drop: 0 }); K.tube('steel', [-56, 0.75, z0 + 0.15], [-56, 2.65, z0 + 0.15], 0.03);
    }
    K.stairs(-51.7, -3.4, 4, '-z', 1.4, 3.4, 8, 'sandstone');
    K.stairs(-60.3, -3.4, -8, '+z', 1.4, 3.4, 8, 'sandstone');

    // —— 水门：横跨运河的闸墙（z -17..-15），河床从大拱下穿过；东端在运河路上只留一道小拱门，西岸封死 ——
    {
      const so = { floors: [8.2], c: [1, 1, 1], mat: 'sandstone', t: 2.0, plain: true, collide: true, a: 0 };
      K.facade(-62, -17, -50, -17, -3.4, { ...so, openings: [[{ kind: 'hole', u0: 2.6, u1: 9.4, v0: 0, v1: 5.2, arch: true, pointed: false, frame: false }]] });
      K.facade(-50, -17, -44, -17, 0, { ...so, floors: [4.8], openings: [[{ kind: 'hole', u0: 1.3, u1: 4.7, v0: 0, v1: 3.6, arch: true, pointed: true, frame: false }]] });
      B.box('sandstone', -65, 0, -17, -62, 4.8, -15, wo);
      for (let x = -64.7; x < -44.8; x += 1.6) for (const z of [-17, -15.45]) B.box('sandstone', x, 4.8, z, x + 0.9, 5.5, z + 0.45, { collide: false, rays: 8 });
      K.lantern(-47, 3.3, -17.25, { drop: 0, power: 10, radius: 6 }); K.lantern(-56, 1.2, -17.3, { drop: 0.4, power: 12, radius: 8 });
    }

    // —— 涵洞：运河北段加盖（z -50..-22），盖板与街面齐平；留出台阶井和两处透光格栅 ——
    {
      const z0 = -50, z1 = -22; const stair = [-52.6, -46, -51, -40]; const grates = [[-58.6, -37.5, -56.4, -35.3], [-55.6, -29.5, -53.4, -27.3]];   // [x0,z0,x1,z1]
      const holes = [stair, ...grates];
      const uniq = (arr) => [...new Set(arr)].sort((p, q) => p - q);
      const xs = uniq([-61.2, -50.8, ...holes.flatMap((h) => [h[0], h[2]])]), zs = uniq([z0, z1, ...holes.flatMap((h) => [h[1], h[3]])]);
      for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++) {
        const cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2;
        if (holes.some((h) => cx > h[0] && cx < h[2] && cz > h[1] && cz < h[3])) continue;
        B.box('sandstone', xs[i], -0.55, zs[j], xs[i + 1], -0.02, zs[j + 1], { bottom: true, skip: 'U' });
        B.box('paving', xs[i], -0.02, zs[j], xs[i + 1], 0.05, zs[j + 1], { skip: 'D' });
      }
      // 洞口门楣（兼作盖板边缘的矮墙）
      const po = { floors: [4.3], c: [1, 1, 1], mat: 'sandstone', t: 0.8, plain: true, collide: true, a: 0, openings: [[{ kind: 'hole', u0: 0.5, u1: 9.5, v0: 0, v1: 2.85, frame: false }]] };
      K.facade(-51, z1, -61, z1, -3.4, po); K.facade(-61, z0, -51, z0, -3.4, po);
      // 中柱
      for (const z of [-46.5, -41, -32.5, -24.5]) B.box('sandstone', -56.45, -3.4, z - 0.45, -55.55, -0.55, z + 0.45, { grime: { h: 1.2, m: 0.6 } });
      // 格栅：钢条 + 可行走的薄碰撞板
      for (const [gx0, gz0, gx1, gz1] of grates) {
        for (let z = gz0 + 0.11; z < gz1; z += 0.22) K.tube('steel', [gx0, 0.0, z], [gx1, 0.0, z], 0.022, { rays: 0 });
        for (const x of [gx0, (gx0 + gx1) / 2, gx1]) K.tube('steel', [x, -0.03, gz0], [x, -0.03, gz1], 0.03, { rays: 0 });
        B.colBox(gx0, -0.06, gz0, gx1, 0.03, gz1, 'steel', null, 'metal');
      }
      // 涵洞台阶：沿东壁向北上到街面，正对 B 点西拱门
      K.stairs(-51.7, -3.4, -38, '-z', 1.4, 3.4, 7, 'sandstone');
      B.box('sandstone', -52.4, -3.4, -46, -51, 0.0, -45, {});
      B.box('sandstone', -52.85, 0.05, -46, -52.6, 0.95, -40, {}); B.box('sandstone', -52.85, 0.05, -40.25, -51, 0.95, -40, {}); B.box('sandstone', -51, 0, -44.4, -50.75, 0.9, -40, {});
      K.lantern(-56, -0.85, -43.6, { drop: 0.25, power: 14, radius: 9 }); K.lantern(-56, -0.85, -30, { drop: 0.25, power: 12, radius: 8 });
      K.crateStack(-58.6, -31, 3, 0.8, -3.4); K.barrel(-53, -3.4, -25.5); K.barrel(-53.7, -3.4, -26.1); K.sacks(-59.2, -45, 4, -3.4);
      // 盖板上：集装箱与路障（西岸与运河路在这里连通）
      K.container(-58.5, -43, Math.PI / 2 + 0.06, [0.25, 0.42, 0.30], 0.05); K.barrier(-55, -33, 0.2, 0.05); K.barrier(-58.5, -25.5, -0.15, 0.05); K.crateStack(-54.5, -24.5, 3, 0.9, 0.05);
    }

    // 跨河管道与杂物
    K.tube('metalRusty', [-62, 1.6, 12], [-50, 1.6, 12], 0.28, { c: [0.75, 0.7, 0.62], collide: true, ts: 2 });
    K.tube('metalRusty', [-62, 2.3, 12.7], [-50, 2.3, 12.7], 0.16, { c: [0.55, 0.6, 0.62], collide: true });
    for (const x of [-61.5, -50.5]) { B.box('concrete', x - 0.4, 0, 11.6, x + 0.4, 1.3, 13.1, {}); }
    K.tube('metalRusty', [-60.8, -1.2, -44], [-60.8, -1.2, -19], 0.22, { c: [0.7, 0.66, 0.6] });
    for (let i = 0; i < 9; i++) K.sandPile(rr(-60.5, -53), rr(-60, 60), rr(1.2, 3), rr(0.25, 0.6), -3.4);
    K.rubble(-58, 18, 1.6, 10, -3.4); K.rubble(-58.5, -9, 1.4, 8, -3.4);
    K.crate(-59.5, -3.4, 30, 1.1, 0.3); K.barrel(-53, -3.4, 44); K.barrel(-53.7, -3.4, 44.5); K.barrel(-59.8, -3.4, -20, null, { lying: true, ry: 0.4 });
    K.tires(-59.6, 6, 3, -3.4);
    // 河床掩体：长直线上的几处遮挡
    K.crateStack(-54, 15, 4, 1.1, -3.4); K.sandbags(-57, 22, 4, 0.25, 3, -3.4); K.sandbags(-55, -9.5, 3.6, -0.3, 3, -3.4); K.crateStack(-58, 40, 3, 0.9, -3.4); K.barrier(-54.5, 50, 0.1, -3.4);
  }

  const S = () => K.style();

  // ============ 西侧外围（运河西岸建筑立面） ============
  {
    const segs = [[-76, -58, 9], [-58, -40, 3.7], [-40, -24, 4.0], [-24, -6, 12.5],   // 涵洞西侧两栋压成单层：让西晒的阳光能照到盖板上的格栅
      [-6, 10, 9.5], [10, 28, 11], [28, 46, 8.5], [46, 62, 12], [62, 76, 9]];
    for (const [z0, z1, h] of segs) {
      K.building(-76, z0, -65, z1, h, { faces: 'E', omit: 'W', doors: { E: 1 }, roofDensity: 0.6, style: K.style({ awnings: 0.3 }) });
      if (chance(0.6)) K.sandPile(-64.6, rr(z0 + 2, z1 - 2), rr(1, 2), rr(0.2, 0.45));
    }
    // 细长瞭望塔
    K.cyl('plaster', -71, 12.5, -15, 1.7, 13, { c: [0.93, 0.88, 0.76], a: 0.08, seg: 14, collide: true, uvScale: [3, 4] });
    K.cyl('sandstone', -71, 22.5, -15, 2.5, 0.35, { seg: 14 });
    K.cyl('plaster', -71, 25.5, -15, 1.3, 3.2, { c: [0.93, 0.88, 0.76], a: 0.05, seg: 14 });
    B.addGeo('tiles', new THREE.ConeGeometry(1.75, 3.2, 14), M4(-71, 30.3, -15), { uvScale: [6, 2], rays: 8 });
  }

  // ============ 东侧外围 ============
  {
    const segs = [[-76, -60, 10, 56], [-60, -44, 12.5, 57], [-44, -30, 8.5, 56], [-30, -12, 11, 58], [-12, 4, 9, 56], [4, 20, 13, 57], [20, 36, 8, 56], [36, 54, 11.5, 57.5], [54, 76, 9.5, 56]];
    for (const [z0, z1, h, x0] of segs) {
      K.building(x0, z0, 70, z1, h, { faces: 'WNS', omit: 'E', doors: { W: chance(0.7) ? 2 : 1 }, shops: chance(0.4) ? 'W' : '', roofDensity: 0.6, style: K.style({ awnings: 0.3 }) });
      if (x0 > 56) { B.box('sandstone', 56, 0, z0, x0, 0.3, z1, {}); K.pots(56.6, z0 + 2, 2, 0.3, 0.3); }
    }
    K.dome(64, 11, -21, 5.2, [0.95, 0.94, 0.9], 'plaster', 1.6);
    for (const [dx, dz] of [[-4.5, -7], [4.5, -7], [-4.5, 7], [4.5, 7]]) K.dome(64 + dx, 11, -21 + dz, 1.3, [0.3, 0.62, 0.68], 'tiles', 0.5);
  }

  // ============ 南北城墙 ============
  {
    K.cityWall(-65, -76, -11, -74, 8.5); K.cityWall(11, -76, 56, -74, 8.5);
    for (const sx of [-1, 1]) { const x0 = sx < 0 ? -11 : 7, x1 = x0 + 4; B.box('sandstone', x0, 0, -77, x1, 12.5, -72, { grime: { h: 2, m: 0.7 }, top: { h: 1, m: 0.85 } }); for (let x = x0; x < x1 - 0.2; x += 1.45) for (const z of [-77, -72.5]) B.box('sandstone', x, 12.5, z, x + 0.85, 13.3, z + 0.5, { collide: false, rays: 8 }); }
    // 北门拱
    K.facade(-7, -76, 7, -76, 0, { floors: [10.5], c: [1, 1, 1], mat: 'sandstone', t: 2.0, plain: true, collide: true, a: 0, openings: [[{ kind: 'hole', u0: 1.6, u1: 12.4, v0: 0, v1: 8.2, arch: true, pointed: true, frame: false }]] });
    K.cityWall(-65, 74, 56, 76, 9);
    for (const x of [-44, -22, 0, 22, 44]) B.box('sandstone', x - 1.4, 0, 73.2, x + 1.4, 9.6, 74, { grime: { h: 2, m: 0.7 } });
  }

  // ============ 中央广场 ============
  {
    // 喷泉（干涸）与方尖碑
    const pts = [[3.5, 0.05], [4.3, 0.05], [4.36, 0.62], [4.1, 0.70], [3.75, 0.70], [3.6, 0.55], [3.6, 0.2]].map((p) => new THREE.Vector2(p[0], p[1]));
    B.addGeo('sandstone', new THREE.LatheGeometry(pts, 8), M4(0, 0, 0, 0, Math.PI / 8, 0), { uvScale: [8, 1], rays: 16, collide: true });
    const disc = new THREE.CircleGeometry(3.62, 8); disc.rotateX(-Math.PI / 2);
    B.addGeo('tiles', disc, M4(0, 0.22, 0, 0, Math.PI / 8, 0), { uvScale: [7.2, 7.2], rays: 16, collide: true });
    K.cyl('sandstone', 0, 0.2, 0, 1.0, 1.1, { seg: 8, collide: true, ts: 1.5 });
    const bowl = [[0.3, 0], [1.2, 0.18], [1.75, 0.5], [1.8, 0.62], [1.6, 0.62], [1.1, 0.34], [0.3, 0.22]].map((p) => new THREE.Vector2(p[0], p[1]));
    B.addGeo('sandstone', new THREE.LatheGeometry(bowl, 16), M4(0, 1.3, 0), { uvScale: [4, 1], rays: 12, collide: true });
    K.cyl('sandstone', 0, 1.5, 0, 0.42, 5.2, { rt: 0.24, seg: 4, collide: true, ts: 1.5, ry: Math.PI / 4 }); B.colBox(-1.2, 0, -1.2, 1.2, 6.5, 1.2, 'sandstone');
    B.addGeo('steel', new THREE.SphereGeometry(0.3, 12, 8), M4(0, 6.95, 0), { rays: 6, c: [1.6, 1.3, 0.7] });
    for (let i = 0; i < 5; i++) K.sandPile(rr(-2.6, 2.6), rr(-2.6, 2.6), rr(0.8, 1.6), rr(0.15, 0.3), 0.22);
    // 棕榈花坛
    for (const [px, pz] of [[-11, -9], [11, -9], [-11, 9], [11, 9]]) {
      for (const [a, b, c, d] of [[-1.3, -1.3, 1.3, -1.0], [-1.3, 1.0, 1.3, 1.3], [-1.3, -1.0, -1.0, 1.0], [1.0, -1.0, 1.3, 1.0]]) B.box('sandstone', px + a, 0.05, pz + b, px + c, 0.55, pz + d, {});
      B.box('terrain', px - 1.0, 0.05, pz - 1.0, px + 1.0, 0.42, pz + 1.0, { a: 0.6, collide: true, skip: 'EWNSD' });
      K.palm(px, pz, rr(8.5, 10.5), { y: 0.4, lean: rr(0.3, 1.2) });
    }
    // 长凳
    for (const [bx, bz, ry] of [[-6.5, 0, 1.57], [6.5, 0, 1.57], [0, -6.8, 0], [0, 6.8, 0]]) { B.obox('sandstone', bx, 0.32, bz, 2.4, 0.14, 0.6, [0, ry, 0], { bottom: true }); for (const s of [-0.9, 0.9]) B.obox('sandstone', bx + Math.cos(ry) * s, 0.15, bz - Math.sin(ry) * s, 0.3, 0.3, 0.5, [0, ry, 0], {}); }
    // 灯柱
    for (const [lx, lz] of [[-17, -15], [17, -15], [-17, 15], [17, 15], [-5.2, -15.5], [5.2, 15.5]]) {
      K.tube('steel', [lx, 0, lz], [lx, 4.2, lz], 0.06); B.box('steel', lx - 0.16, 0, lz - 0.16, lx + 0.16, 0.5, lz + 0.16, {});
      K.tube('steel', [lx, 4.2, lz], [lx + 0.5, 4.45, lz], 0.03); K.lantern(lx + 0.5, 4.42, lz, { drop: 0.1, power: 10, radius: 7 });
    }
    // 摊位、货物、地毯
    K.stall(-13.5, -14.8, 0, { kind: 'fruit' }); K.stall(13, -14.8, 0, { kind: 'cloth' }); K.stall(-13, 14.6, Math.PI, { kind: 'pots' }); K.stall(14, 14.2, Math.PI, { kind: 'spice' });
    K.stall(17.2, -2.5, -Math.PI / 2, { kind: 'fruit' });
    K.rug(-9, 0.06, 14.5, 2, 3, 0.2); K.rug(8.5, 0.06, -13.5, 2, 3, 1.4); K.pots(-16.5, 9.5, 4, 0.8, 0.05); K.pots(16.5, -9.5, 3, 0.7, 0.05);
    K.crateStack(-17, 3.5, 3, 1.0, 0.05); K.crateStack(16.5, 8.5, 3, 1.1, 0.05); K.sacks(-15.5, -3.5, 5, 0.05); K.barrel(15, 3.6, 0); K.barrel(15.7, 3.0, 0);
    // 手推车
    { const cx = 7.5, cz = 8.5, ry = 0.5; B.obox('wood', cx, 0.72, cz, 1.9, 0.12, 1.1, [0, ry, 0], { bottom: true }); B.obox('wood', cx, 0.95, cz - 0.5, 1.9, 0.34, 0.06, [0, ry, 0], { bottom: true, collide: false }); B.obox('wood', cx, 0.95, cz + 0.5, 1.9, 0.34, 0.06, [0, ry, 0], { bottom: true, collide: false });
      const wg = new THREE.TorusGeometry(0.42, 0.05, 6, 14); for (const s of [-0.62, 0.62]) B.addGeo('wood', wg, M4(cx + Math.sin(ry) * s, 0.47, cz + Math.cos(ry) * s, 0, ry, 0), { rays: 6, c: [0.7, 0.6, 0.5] });
      K.sacks(cx, cz, 3, 0.78); }
    // 彩旗：方尖碑顶 → 四角
    for (const [tx, ty, tz] of [[-19.8, 6.2, -17.8], [19.8, 6.6, -17.8], [-19.8, 5.0, 17.8], [19.8, 6.4, 17.6]]) K.bunting([0, 6.7, 0], [tx, ty, tz], 1.4);
    for (let i = 0; i < 7; i++) K.sandPile(rr(-19, 19), chance(0.5) ? rr(-17.5, -16) : rr(16, 17.5), rr(1, 2.4), rr(0.12, 0.3), 0.05);
  }

  // ============ 广场四周拱廊楼 ============
  const stArc = K.style({ plinth: 'stone', arch: true, pointed: true, vigas: true, awnings: 0.05 });
  K.building(-20, -26, -6, -21, 6.8, { c: PLASTER[0], style: stArc, shops: 'N', doors: { S: 1 }, nf: 2 });
  K.arcade(-20, -21, -6, -18, 4.6, 'SE', { pointed: true });
  K.building(6, -26, 20, -21, 6.8, { c: PLASTER[4], style: K.style({ plinth: 'stone', arch: true, pointed: true }), shops: 'N', doors: { S: 1 }, nf: 2 });
  K.arcade(6, -21, 20, -18, 4.6, 'SW', { pointed: true });
  K.building(-20, 21, -6, 26, 6.4, { c: PLASTER[5], style: K.style({ plinth: 'paint', arch: true }), shops: 'S', doors: { N: 1 }, nf: 2 });
  K.arcade(-20, 18, -6, 21, 4.4, 'NE', { pointed: true });
  K.building(6, 21, 20, 26, 7.0, { c: PLASTER[9], style: K.style({ plinth: 'stone', arch: true }), shops: 'S', doors: { N: 1 }, nf: 2 });
  K.arcade(6, 18, 20, 21, 4.6, 'NW', { pointed: true });
  for (const [x0, x1, z, s] of [[-20, -6, -19.5, 1], [6, 20, -19.5, 1], [-20, -6, 19.5, -1], [6, 20, 19.5, -1]]) for (let x = x0 + 3.5; x < x1 - 2; x += 5.5) { K.lantern(x, 3.9, z, { drop: 0.25, power: 12, radius: 6 }); if (chance(0.6)) K.rug(x + 1.5, 0.07, z, 1.4, 2.2, 1.57); }
  // 中门：广场北口的门楼，双开木门一扇大开、一扇虚掩（步兵只能从门缝过，机甲过不去）
  {
    const h = 6.8, c = PLASTER[0];
    K.facade(-6, -26, 6, -26, 0, { floors: [h], c, t: 2.2, plain: true, collide: true, style: { plinth: 'stone' }, openings: [[{ kind: 'hole', u0: 3.4, u1: 8.6, v0: 0, v1: 4.5, frame: false }]] });
    B.box('wood', -3.05, 4.28, -26.1, 3.05, 4.72, -23.7, { bottom: true, collide: false, rays: 8, c: [0.62, 0.5, 0.38] });
    for (const x of [-2.72, 2.6]) B.box('sandstone', x, 0, -26.06, x + 0.12, 4.28, -23.74, { collide: false, rays: 8 });
    for (const z of [-26, -24.05]) B.box('plaster', -6, h, z, 6, h + 0.65, z + 0.25, { c, a: 0.12, top: { h: 0.3, m: 0.9 } });
    K.doorLeaf(-2.6, -24.9, 0.04, 2.6, 4.24, Math.PI * 75 / 180); K.doorLeaf(2.6, -24.9, 0.04, 2.6, 4.24, Math.PI * 156 / 180);
    for (const x of [-4.4, 4.4]) { K.lantern(x, 4.0, -23.55, { drop: 0, power: 12, radius: 7 }); K.lantern(x, 4.0, -26.25, { drop: 0, power: 10, radius: 6 }); }
    K.sign(0, 5.75, -23.76, Math.PI, 2, 1.5);
  }
  // 广场东西两侧的屏风拱
  K.arches(-20, -5, -20, -15, 0, 4.4, { n: 3, pointed: true }); B.box('sandstone', -20.6, 4.4, -15, -20, 4.9, -5, { bottom: true });
  K.arches(-20, 13, -20, 5, 0, 4.4, { n: 2, pointed: true }); B.box('sandstone', -20.6, 4.4, 5, -20, 4.9, 13, { bottom: true });
  K.arches(20, -13, 20, -5, 0, 4.4, { n: 2, pointed: true }); B.box('sandstone', 20, 4.4, -13, 20.6, 4.9, -5, { bottom: true });

  // ============ 西北街区 ============
  K.building(-44, -26, -31, -13, 7.2, { c: PLASTER[1], faces: 'NWS', shops: 'N', doors: { W: 1 }, nf: 2, style: K.style({ vigas: true, plinth: 'stone' }) });
  K.building(-31, -26, -20, -15, 10.5, { c: PLASTER[3], nf: 3, faces: 'NESW', shops: 'N', doors: { S: 1 }, style: K.style({ accent: ACCENT[1], plinth: 'paint' }) });
  K.building(-44, -13, -33, -5, 4.6, { c: PLASTER[2], faces: 'WSE', doors: { S: 1, E: 1 }, nf: 1 });
  K.crateStack(-31.5, -11, 3, 0.9); K.crate(-32.2, 0, -7.2, 1.3, 0.1); K.crate(-32.1, 1.3, -7.3, 1.0, 0.5); K.palm(-25, -9.5, 9, { lean: 1.4 });
  K.stall(-24, -12.6, 0, { kind: 'pots' }); K.pots(-28.5, -13.6, 4, 0.7); K.sandPile(-31, -14.2, 2, 0.4); K.barrel(-21.5, -6.2, 0);
  K.awning(-33, -5.6, -33, -11.5, 3.2, 2.2, CLOTH[2]);

  // ============ 东北街区（茶馆可进入） ============
  {
    // 茶馆：底层大厅可进入，二层实心
    const x0 = 20, z0 = -26, x1 = 33, z1 = -13, h = 7.4;
    K.building(x0, z0, x1, z1, h, {
      c: PLASTER[8], hollow: true, floors: [3.8, 3.6], style: K.style({ plinth: 'stone', accent: ACCENT[0], shutters: 0.9 }),
      openings: {
        N: [[{ kind: 'hole', u0: 4.6, u1: 8.4, v0: 0, v1: 3.2, arch: true, pointed: true }], null],
        W: [[{ kind: 'hole', u0: 2.2, u1: 4.6, v0: 0, v1: 3.0, arch: true, pointed: true }], null],
        S: [[{ kind: 'hole', u0: 5.0, u1: 7.6, v0: 0, v1: 3.0, arch: true, pointed: true }], null],
      },
    });
    B.box('plaster', x0 + 0.25, 3.6, z0 + 0.25, x1 - 0.25, 3.8, z1 - 0.25, { bottom: true, c: [0.9, 0.84, 0.72] });
    B.colBox(x0 + 0.25, 3.8, z0 + 0.25, x1 - 0.25, h, z1 - 0.25, 'plaster');
    pave(x0 + 0.25, z0 + 0.25, x1 - 0.25, z1 - 0.25, 0.06, 'tiles', { ts: 2 });
    for (const [px, pz] of [[24.5, -21.5], [28.5, -17.5]]) { B.box('sandstone', px - 0.3, 0.06, pz - 0.3, px + 0.3, 3.6, pz + 0.3, {}); }
    for (const [tx, tz] of [[23, -16], [29.5, -22.5], [30, -16]]) { K.cyl('wood', tx, 0.06, tz, 0.5, 0.06, { collide: false, c: [0.8, 0.7, 0.6] }); K.cyl('wood', tx, 0.06, tz, 0.06, 0.7, { collide: false }); B.box('wood', tx - 0.5, 0.7, tz - 0.5, tx + 0.5, 0.76, tz + 0.5, { bottom: true }); K.pot(tx + 0.1, 0.76, tz, 0.3); }
    K.rug(26.5, 0.07, -19.5, 3, 4.5, 0, 'rugRed'); K.lantern(26.5, 3.5, -19.5, { drop: 0.5, power: 22, radius: 9 }); K.lantern(22.5, 3.5, -23, { drop: 0.5, power: 14, radius: 7 }); K.lantern(30.5, 3.5, -15.5, { drop: 0.5, power: 14, radius: 7 });
    B.box('wood', 31.2, 0.06, -25, 32.6, 1.1, -19, {}); K.pots(31.9, -22, 3, 0.5, 1.1);
  }
  K.building(33, -26, 42, -5, 6.7, { c: PLASTER[6], faces: 'NESW', shops: 'N', doors: { E: 1, W: 1 }, nf: 2 });
  K.stall(24, -8.2, Math.PI, { kind: 'cloth' }); K.crateStack(30, -7.5, 3, 1.0); K.palm(22.5, -11, 8.5); K.scaffold(31.6, -9, 2.4, 1.2, 2, Math.PI / 2);

  // ============ 西南街区（工坊可进入） ============
  // 西南楼：底层打通成「暗道」—— 市集街 / 运河路 / 西巷 / 工坊四个口，楼上实心
  {
    const x0 = -44, z0 = 5, x1 = -32, z1 = 26, h = 8.6, f0 = 3.6;
    K.building(x0, z0, x1, z1, h, {
      c: PLASTER[7], hollow: true, floors: [f0, 2.5, 2.5], faces: 'NWSE', style: K.style({ vigas: true, plinth: 'stone' }), noAuto: [0],
      openings: {
        S: [[{ kind: 'hole', u0: 5.0, u1: 8.0, v0: 0, v1: 3.0, arch: true, pointed: true }], null, null],
        W: [[{ kind: 'hole', u0: 3.4, u1: 4.6, v0: 1.75, v1: 2.95, frame: false }, { kind: 'hole', u0: 7.6, u1: 8.8, v0: 1.75, v1: 2.95, frame: false }, { kind: 'hole', u0: 14.0, u1: 17.0, v0: 0, v1: 3.0, arch: true, pointed: true }, { kind: 'hole', u0: 18.8, u1: 20.0, v0: 1.75, v1: 2.95, frame: false }], null, null],   // 高窗：西晒的光柱斜射进暗道
        N: [[{ kind: 'hole', u0: 6.0, u1: 8.6, v0: 0, v1: 3.0, arch: true, pointed: true }], null, null],
        E: [[{ kind: 'hole', u0: 12.0, u1: 15.0, v0: 0, v1: 3.0, arch: true, pointed: false }], null, null],
      },
    });
    B.box('plaster', x0 + 0.25, f0 - 0.2, z0 + 0.25, x1 - 0.25, f0, z1 - 0.25, { bottom: true, c: [0.9, 0.84, 0.72] });
    B.colBox(x0 + 0.25, f0, z0 + 0.25, x1 - 0.25, h, z1 - 0.25, 'plaster');
    pave(x0 + 0.25, z0 + 0.25, x1 - 0.25, z1 - 0.25, 0.06, 'concrete');
    // 隔墙：把直通改成折线
    B.box('plaster', x0 + 0.25, 0.06, 15.3, -38.5, f0 - 0.2, 15.6, { c: PLASTER[7], a: 0.3 });
    B.box('plaster', -36.4, 0.06, 18.5, -36.1, f0 - 0.2, z1 - 0.25, { c: PLASTER[7], a: 0.3 });
    for (const [px, pz] of [[-40.2, 10.6], [-34.2, 12.4]]) B.box('sandstone', px - 0.3, 0.06, pz - 0.3, px + 0.3, f0 - 0.2, pz + 0.3, {});
    K.crateStack(-41.8, 18.4, 3, 0.8, 0.06); K.crateStack(-33.6, 7.4, 3, 0.8, 0.06); K.barrel(-42.8, 0.06, 24.8); K.sacks(-33.4, 24.6, 4, 0.06); B.box('wood', -43.6, 0.06, 5.6, -42.5, 0.95, 8.6, {});
    K.lantern(-39.5, 3.3, 10.5, { drop: 0.5, power: 16, radius: 8 }); K.lantern(-41, 3.3, 21.5, { drop: 0.5, power: 14, radius: 7 }); K.lantern(-34.4, 3.3, 17.5, { drop: 0.5, power: 12, radius: 7 });
  }
  {
    const x0 = -32, z0 = 13, x1 = -20, z1 = 26, h = 5.2;
    K.building(x0, z0, x1, z1, h, {
      c: PLASTER[2], hollow: true, floors: [h], nf: 1, style: K.style({ plinth: 'paint', accent: ACCENT[3] }), omit: 'W',
      openings: {
        N: [[{ kind: 'hole', u0: 4.5, u1: 7.5, v0: 0, v1: 3.1, arch: true, pointed: false }]],
        E: [[{ kind: 'hole', u0: 1.2, u1: 3.8, v0: 0, v1: 3.0, arch: true, pointed: true }]],
        S: [[{ kind: 'hole', u0: 4.0, u1: 7.0, v0: 0, v1: 3.1, arch: true, pointed: false }]],
      },
    });
    pave(x0, z0 + 0.25, x1 - 0.25, z1 - 0.25, 0.06, 'concrete');
    K.crateStack(-29.5, 16, 3, 0.8, 0.06); B.box('wood', -31.6, 0.06, 20.8, -30.4, 0.95, 25.2, {}); K.barrel(-22, 0.06, 24); K.barrel(-22.8, 0.06, 24.4);
    K.lantern(-26, 4.8, 19.5, { drop: 0.9, power: 20, radius: 9 }); K.tires(-21.5, 15.2, 4, 0.06); K.sacks(-27, 24.2, 4, 0.06);
  }
  K.crateStack(-29, 8.5, 4, 1.4); K.palm(-23, 9, 8); K.barrier(-26, 5.6, 0); K.pots(-21.5, 11.6, 3, 0.5); K.sandPile(-31, 12.4, 2.2, 0.45);

  // ============ 东南街区 + 钟楼 ============
  K.building(20, 5, 31, 13, 9.2, { c: PLASTER[4], faces: 'NWES', doors: { N: 1, W: 1 }, nf: 3, style: K.style({ accent: ACCENT[5] }) });
  K.building(31, 5, 42, 26, 6.6, { c: PLASTER[1], faces: 'NESW', doors: { E: 1, N: 1 }, shops: 'S', nf: 2 });
  K.building(25.5, 18.5, 31, 26, 5.4, { c: PLASTER[9], faces: 'SW', shops: 'S', nf: 1 });
  K.building(20, 18.5, 25.5, 26, 5.4, { c: PLASTER[9], faces: 'S', omit: 'N', nf: 1, roofProps: false });
  {
    // 塔身
    const x0 = 20, z0 = 13, x1 = 25.5, z1 = 18.5, h = 19, cx = 22.75, cz = 15.75;
    K.building(x0, z0, x1, z1, h, { c: [0.93, 0.87, 0.74], nf: 5, faces: 'NESW', parapet: 0, roofProps: false, margin: 1.4, bay: 4, winChance: 0.75, groundWin: false, style: K.style({ arch: true, ww: 0.8, wh: 1.5, plinth: 'stone', vigas: false, shutters: 0, awnings: 0 }) });
    B.box('sandstone', x0 - 0.3, h - 0.3, z0 - 0.3, x1 + 0.3, h + 0.1, z1 + 0.3, { bottom: true });
    // 观景亭
    const lines = [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]];
    for (const [ax, az, bx, bz] of lines) K.arches(ax, az, bx, bz, h + 0.1, 3.7, { n: 1, colW: 0.7, pointed: true, above: 0.4 });
    for (const [ax, az, bx, bz] of lines) { const mx = (ax + bx) / 2, mz = (az + bz) / 2; const along = ax === bx; B.box('sandstone', along ? ax - 0.12 : mx - 1.9, h + 0.1, along ? mz - 1.9 : az - 0.12, along ? ax + 0.12 : mx + 1.9, h + 0.75, along ? mz + 1.9 : az + 0.12, {}); }
    B.box('sandstone', x0 - 0.35, h + 3.8, z0 - 0.35, x1 + 0.35, h + 4.2, z1 + 0.35, { bottom: true });
    K.dome(cx, h + 4.2, cz, 2.5, [0.22, 0.56, 0.62], 'tiles', 0.5);
    K.lantern(cx, h + 3.7, cz, { drop: 0.5, power: 14, radius: 7 });
    L.towerTop = { x: cx, y: h + 0.1, z: cz };
    // 滑索
    const zl = (a, b) => { K.cable(a, b, 0.5, 0.03); L.ziplines.push({ a, b }); for (const p of [a, b]) K.tube('steel', [p[0], p[1] - 2.2, p[2]], [p[0], p[1] + 0.15, p[2]], 0.05); };
    zl([x0 - 0.2, h + 2.5, z0 - 0.2], [-24, 10.5 + 2.4, -19]);
    zl([x1 + 0.2, h + 2.5, z1 + 0.2], [30, 7.2 + 2.4, 45]);
  }

  // ============ 巴扎（顶棚集市街） ============
  {
    // 北侧：B 点院墙（西段）与商铺排（东段）
    const wc = PLASTER[5];
    for (const [a, b] of [[-44, -28], [-22, -7]]) K.facade(b, -34, a, -34, 0, { floors: [6.9], c: wc, t: 0.6, plain: true, collide: true, style: { plinth: 'stone', vigas: true }, a: 0.3 });
    for (const [a, b] of [[-44, -28], [-22, -7]]) K.facade(a, -34.6, b, -34.6, 0, { floors: [6.9], c: wc, t: 0.02, plain: true, a: 0.3, style: {} });
    for (const x of [-28.5, -21.5]) { B.box('sandstone', x - 0.5, 0, -34.9, x + 0.5, 7.4, -33.7, { grime: { h: 1.5, m: 0.7 } }); K.lantern(x, 3.4, -33.4, { drop: 0, power: 10, radius: 6 }); }
    B.box('sandstone', -28, 6.4, -34.7, -22, 7.1, -33.9, { bottom: true });
    // 原院门砌成半墙，只留一个窗洞：铁驭可以翻进 B 点，步兵过不去
    K.facade(-22, -34, -28, -34, 0, { floors: [6.4], c: wc, t: 0.6, plain: true, collide: true, a: 0.3, style: { plinth: 'stone' }, openings: [[{ kind: 'hole', u0: 1.3, u1: 4.7, v0: 1.2, v1: 3.4, frame: false }]] });
    B.box('sandstone', -27.0, 1.12, -34.75, -23.0, 1.22, -33.85, { bottom: true, collide: false, rays: 8 });
    K.crate(-25.6, 0.045, -32.9, 1.0, 0.15); K.crate(-24.2, 0.05, -35.6, 1.1, -0.2);
    K.sign(-25, 7.9, -33.85, 0, 1, 1.5); K.sign(-31.5, 3.6, -33.38, 0, 1, 2.2, [1, 1, 1]); K.sign(-34.5, 3.6, -33.38, 0, 3, 1.5);
    K.building(7, -39.5, 19, -34, 6.9, { c: PLASTER[2], faces: 'SW', shops: 'S', nf: 2, style: K.style({ vigas: true, plinth: 'stone' }), roofDensity: 0.5 });
    K.building(31, -39.5, 42, -34, 6.9, { c: PLASTER[0], faces: 'SE', shops: 'S', nf: 2, style: K.style({ vigas: true }), roofDensity: 0.5 });
    // 短阶：从巴扎穿过拱门上到 A 点高台（两侧是窄塔楼）
    {
      const c = PLASTER[3]; const st = K.style({ accent: ACCENT[4], plinth: 'stone' });
      K.building(19, -39.5, 22, -34, 7.8, { c, style: st, faces: '', nf: 2, roofProps: false }); K.building(28, -39.5, 31, -34, 7.8, { c, style: st, faces: '', nf: 2, roofProps: false });
      K.facade(28, -34, 22, -34, 0, { floors: [7.8], c, style: st, plain: true, collide: true, t: 0.6, openings: [[{ kind: 'hole', u0: 0.4, u1: 5.6, v0: 0, v1: 5.6, arch: true, pointed: true, frame: false }]] });
      K.stairs(25, 0.045, -34.6, '-z', 6, A_Y - 0.045, 4.9, 'sandstone');
      K.lantern(25, 4.9, -34.9, { drop: 0.6, power: 16, radius: 8 }); K.sign(25, 6.6, -33.96, 0, 0, 1.4);
    }
    // 顶棚：横梁 + 纵向木条 + 垂布
    const roof = (xa, xb) => {
      const y = 6.35;
      for (let x = xa; x <= xb + 0.01; x += 2.0) B.box('wood', x - 0.09, y - 0.22, -34, x + 0.09, y, -26, { collide: false, rays: 8, bottom: true, c: [0.8, 0.72, 0.62] });
      for (let z = -33.6; z < -26.2; z += 0.78) B.box('wood', xa, y, z, xb, y + 0.05, z + 0.34, { collide: false, rays: 0, bottom: true, cell: 4, c: [0.9, 0.82, 0.7] });
      B.colBox(xa, y, -34, xb, y + 0.06, -26, 'wood', null, 'wood');
      for (let x = xa + 3; x < xb - 3; x += rr(5, 8)) {
        // 垂挂的布幔
        const w = rr(2.2, 3.4); const g = new THREE.PlaneGeometry(w, 7.4, 4, 8); const pos = g.attributes.position; const wind = [];
        for (let i = 0; i < pos.count; i++) { const u = pos.getY(i) / 7.4; const sag = (1 - 4 * u * u) * rr(0.9, 1.0) * 0.9; pos.setXYZ(i, x + pos.getX(i), y - 0.25 - sag, -30 + pos.getY(i)); wind.push((1 - 4 * u * u) * 0.9); }
        g.computeVertexNormals(); g.setAttribute('aWind', new THREE.Float32BufferAttribute(wind, 1));
        B.addGeo(chance(0.5) ? 'fabricStripe' : 'fabric', g, new THREE.Matrix4(), { c: pick(CLOTH), uvScale: [2, 4], rays: 10 });
      }
      for (let x = xa + 2.5; x < xb - 1; x += 5.2) { K.lantern(x, y - 0.25, -30 + rr(-0.6, 0.6), { drop: rr(1.1, 1.7), power: 20, radius: 9 }); }
      L.shafts.push({ x0: xa, x1: xb, z0: -34, z1: -26, y });
    };
    roof(-40, -8); roof(8, 38);
    // 北侧摊位（西段靠院墙）
    const kinds = ['fruit', 'cloth', 'pots', 'spice'];
    let i = 0; for (const x of [-41, -36.8, -32.4, -18.5, -14.2, -10]) K.stall(x, -32.3, 0, { kind: kinds[i++ % 4], w: 3.2, d: 2.0, h: 2.6, y: 0.045 });
    K.rug(-38.8, 2.6, -33.36, 1.6, 2.4, 0, 'rugRed', true); K.rug(-16.3, 2.6, -33.36, 1.6, 2.4, 0, 'rugBlue', true); K.rug(-12, 2.5, -33.36, 1.4, 2.2, 0, 'rugRed', true);
    for (let k = 0; k < 9; k++) { const x = rr(-42, 40); if (Math.abs(x) < 8) continue; if (chance(0.5)) K.pots(x, -27.6, 2, 0.4, 0.045); else K.sacks(x, -27.5, 3, 0.045); }
    K.crateStack(-4.2, -32.6, 2, 0.5, 0.045); K.crateStack(4.4, -27.4, 2, 0.5, 0.045); K.rug(20, 0.055, -30, 2.2, 3.4, 1.57); K.rug(-27, 0.055, -29.5, 2.2, 3.4, 1.4);
  }

  // ============ 北区：B 点泵站 ============
  {
    B.box('plaster', -6.6, 0, -62, -6, 4.6, -50, { c: PLASTER[5], a: 0.4, grime: { h: 1.5, m: 0.7, a: 0.8 } }); B.box('plaster', -6.6, 0, -44, -6, 4.6, -34.6, { c: PLASTER[5], a: 0.4, grime: { h: 1.5, m: 0.7, a: 0.8 } });
    for (const z of [-50.3, -43.7]) B.box('sandstone', -6.9, 0, z - 0.4, -5.7, 5.1, z + 0.4, {});
    B.box('plaster', -44, 0, -62.6, -20, 4.6, -62, { c: PLASTER[5], a: 0.4, grime: { h: 1.5, m: 0.7, a: 0.8 } }); B.box('plaster', -15, 0, -62.6, -6, 4.6, -62, { c: PLASTER[5], a: 0.4, grime: { h: 1.5, m: 0.7, a: 0.8 } });
    // 西墙：整面围墙，只留一道拱门正对涵洞台阶
    K.facade(-44, -34.6, -44, -62, 0, { floors: [4.6], c: PLASTER[5], t: 0.6, plain: true, collide: true, a: 0.4, style: { plinth: 'stone' }, openings: [[{ kind: 'hole', u0: 10.9, u1: 14.9, v0: 0, v1: 3.7, arch: true, pointed: true, frame: false }]] });
    for (const z of [-50.0, -45.0]) B.box('sandstone', -44.35, 0, z - 0.4, -43.2, 5.0, z + 0.4, { grime: { h: 1.5, m: 0.7 } });
    K.lantern(-44.4, 3.4, -47.5, { drop: 0, power: 10, radius: 6 });
    // 东侧 B 门：门框 + 半开的双开木门（北扇向院内大开，南扇虚掩）
    B.box('sandstone', -6.9, 4.0, -50.7, -5.7, 5.1, -43.3, { bottom: true });
    K.doorLeaf(-6.3, -49.85, 0, 2.85, 3.9, Math.PI * 160 / 180); K.doorLeaf(-6.3, -44.15, 0, 2.85, 3.9, -Math.PI * 62 / 180);
    K.waterTower(-30.5, -50, 2.9, 6.6, 4.3);
    // 泵房棚
    const sx0 = -19, sx1 = -8.5, sz0 = -60.5, sz1 = -53;
    for (const x of [sx0, (sx0 + sx1) / 2, sx1]) for (const z of [sz0, sz1]) B.box('steel', x - 0.09, 0, z - 0.09, x + 0.09, 3.5, z + 0.09, {});
    B.obox('corrugated', (sx0 + sx1) / 2, 3.75, (sz0 + sz1) / 2, sx1 - sx0 + 1.2, 0.08, sz1 - sz0 + 1.4, [0.09, 0, 0], { bottom: true, c: [0.8, 0.78, 0.72] });
    B.box('corrugated', sx0, 0, sz0 - 0.05, sx1, 3.3, sz0, { c: [0.75, 0.72, 0.66] }); B.box('corrugated', sx1, 0, sz0, sx1 + 0.05, 3.3, sz1 - 2.5, { c: [0.75, 0.72, 0.66] });
    B.box('metalPaint', -17.5, 0.05, -59.5, -14.5, 1.5, -57.6, { c: [0.25, 0.42, 0.34] }); K.cyl('metalRusty', -16, 1.5, -58.5, 0.35, 1.0, { collide: true }); K.cyl('metalRusty', -12.2, 0.05, -58.6, 0.8, 1.6, { collide: true, c: [0.8, 0.5, 0.2], seg: 16 });
    K.tube('metalRusty', [-27.5, 0.45, -50], [-19, 0.45, -57], 0.22, { c: [0.72, 0.68, 0.6], collide: true }); K.tube('metalRusty', [-19, 0.45, -57], [-14.5, 0.45, -57], 0.22, { c: [0.72, 0.68, 0.6] });
    K.tube('metalRusty', [-33.2, 0.3, -51.5], [-43.4, 0.3, -53.5], 0.16, { c: [0.72, 0.68, 0.6] });
    K.container(-37.5, -40.2, 0, [0.20, 0.36, 0.52]); K.container(-36.8, -43.4, 0.06, [0.58, 0.20, 0.14]); K.container(-37.2, -41.6, 0.03, [0.70, 0.52, 0.18], 2.6);
    K.container(-13.5, -42.5, Math.PI / 2, [0.25, 0.42, 0.30]);
    for (const [bx, bz] of [[-23, -57.5], [-23.8, -57.1], [-23.3, -56.4], [-24.5, -58.0]]) K.barrel(bx, 0.05, bz);
    K.barrier(-25, -37.5, 0, 0.05); K.barrier(-18, -47, 0.5, 0.05); K.barrier(-28, -44, -0.3, 0.05); K.tires(-11, -37.6, 4, 0.05); K.crateStack(-21, -40, 3, 1.2, 0.05); K.crateStack(-34, -55, 3, 1.0, 0.05);
    K.sandbags(-22, -50.5, 3.6, 0.2, 3, 0.05); K.sandbags(-16, -48.5, 3.0, -0.6, 3, 0.05);
    K.sign(-6.65, 2.6, -39, -Math.PI / 2, 1, 2.2); K.sign(-25, 2.4, -61.97, 0, 1, 2.4);
    K.rubble(-40, -57, 1.6, 10); K.sandPile(-42, -36, 2.2, 0.5); K.sandPile(-8, -60, 2.2, 0.5); K.palm(-41, -58, 9.5);
  }

  // ============ 北区：A 点货栈高台 ============
  {
    const Y = A_Y; const wo = { grime: { h: 1.3, m: 0.68 }, top: { h: 0.5, m: 0.86 } };
    // 台体：留出东坡道槽 (34..42, -50..-42) 与西阶槽 (8..13.5, -50..-46)
    for (const [x0, z0, x1, z1] of [[13.5, -60, 34, -39.5], [8, -60, 13.5, -50], [8, -46, 13.5, -39.5], [34, -60, 42, -50], [34, -42, 42, -39.5]]) {
      B.box('sandstone', x0, 0, z0, x1, Y, z1, { grime: { h: 1.3, m: 0.68 }, skip: 'U', mech: true });   // 实心台体（碰撞用一整块，避免内部重合面干扰导航探测）
      B.box('paving', x0, Y - 0.3, z0, x1, Y, z1, { skip: 'DEWNS', collide: false });                     // 台面铺装只画顶面
    }
    // 四条上台路线
    K.ramp(42, 0, -46, '-x', 8, Y, 8, 'sandstone');                       // 东坡道：长街 → A（机甲可上）
    K.stairs(8, 0, -48, '+x', 4, Y, 5.5, 'sandstone');                    // 西阶：北大道 → A
    K.stairs(25, 0, -65.4, '+z', 6, Y, 5.4, 'sandstone');                 // 北阶：敌方出生区 → A
    // 护墙（高 1m，兼作掩体）：台缘与各槽口两侧
    const pw = (x0, z0, x1, z1, h = 1.0) => B.box('sandstone', x0, Y, z0, x1, Y + h, z1, { top: { h: 0.4, m: 0.86 } });
    pw(8, -60, 22, -59.6); pw(28, -60, 42, -59.6);                         // 北缘（北阶口留空）
    pw(8, -59.6, 8.4, -50); pw(8, -46, 8.4, -39.5); pw(8.4, -50.4, 13.5, -50); pw(8.4, -46, 13.5, -45.6);   // 西缘 + 西阶两侧
    pw(41.6, -59.6, 42, -50); pw(41.6, -42, 42, -39.5); pw(34, -50.4, 41.6, -50); pw(34, -42, 41.6, -41.6);   // 东缘 + 坡道两侧
    for (const [x, z] of [[8.2, -50.2], [8.2, -45.8], [41.8, -50.2], [41.8, -41.8], [22, -59.8], [28, -59.8]]) B.box('sandstone', x - 0.35, 0, z - 0.35, x + 0.35, Y + 1.45, z + 0.35, wo);
    // 货栈：台上唯一可进入的小屋（屋顶是狙击位）
    K.building(9, -59.2, 20, -51, 4.4, {
      y0: Y, c: PLASTER[7], hollow: true, floors: [4.4], nf: 1, weeds: false, roofDensity: 0.5,
      style: K.style({ plinth: 'stone', frame: 'wood', shutters: 0.3, arch: false, ww: 1.3, wh: 1.2 }), noAuto: [0],
      openings: {
        E: [[{ kind: 'hole', u0: 2.4, u1: 5.4, v0: 0, v1: 3.2, arch: true, pointed: false }]],
        S: [[{ kind: 'hole', u0: 1.6, u1: 4.4, v0: 0, v1: 3.0, arch: true, pointed: false }, { kind: 'hole', u0: 6.6, u1: 8.4, v0: 1.1, v1: 2.4 }]],
        N: [[{ kind: 'hole', u0: 4.4, u1: 6.6, v0: 1.1, v1: 2.4 }]],
      },
    });
    K.crateStack(11.5, -57, 3, 0.9, Y); B.box('wood', 9.6, Y, -53.4, 12.6, Y + 0.95, -52.2, {}); K.pots(11, -52.8, 3, 0.5, Y + 0.95); K.lantern(14.5, Y + 4.0, -55, { drop: 0.7, power: 20, radius: 9 }); K.sacks(18.2, -57.8, 4, Y);
    // 残存的柱廊（东北角）
    K.arches(29.5, -58.6, 40.5, -58.6, Y, 4.3, { n: 3, pointed: true }); B.box('sandstone', 29.5, Y + 4.3, -58.6, 40.5, Y + 4.75, -58.0, { bottom: true });
    for (const [x, z, h] of [[39.8, -54.5, 2.1], [39.8, -51.6, 0.9]]) K.cyl('sandstone', x, Y, z, 0.3, h, { collide: true, seg: 10 });
    // 掩体：箱堆 / 集装箱 / 沙袋 / 油桶
    K.container(26.5, -55.2, 0.12, [0.20, 0.36, 0.52], Y); K.crateStack(24, -47, 5, 1.6, Y); K.crateStack(35, -54.2, 3, 1.0, Y); K.crateStack(18, -42.5, 4, 1.2, Y); K.crate(30.6, Y, -41.0, 1.4, 0.3); K.crate(30.5, Y + 1.4, -41.1, 1.0, 0.7);
    K.sandbags(30.8, -51.3, 4.4, 0.05, 3, Y); K.sandbags(15.6, -48, 3.6, Math.PI / 2, 3, Y); K.sandbags(25, -58, 4.5, 0.05, 3, Y);
    for (const [bx, bz] of [[36.5, -41.2], [37.3, -40.8], [20.5, -44.5]]) K.barrel(bx, Y, bz);
    K.tires(13, -41, 4, Y); K.pots(40.6, -40.6, 3, 0.4, Y); K.rug(21.5, Y + 0.01, -51.5, 1.8, 2.6, 0.2);
    K.palm(37.2, -56.6, 8.5, { y: Y, lean: 0.9 }); K.palm(10.6, -42, 8, { y: Y, lean: 0.7 });
    // 灯柱
    for (const [lx, lz] of [[33.2, -57.2], [14.6, -40.6], [33.2, -40.6]]) { K.tube('steel', [lx, Y, lz], [lx, Y + 4.2, lz], 0.06); K.tube('steel', [lx, Y + 4.2, lz], [lx + 0.5, Y + 4.45, lz], 0.03); K.lantern(lx + 0.5, Y + 4.42, lz, { drop: 0.1, power: 12, radius: 8 }); }
    K.bunting([22, 7.6, -39.6], [14.6, Y + 4.2, -40.6], 0.6); K.sandPile(41, -43, 1.6, 0.3, Y); K.sandPile(9.2, -47, 1.4, 0.3, Y);
    // 台脚（长街一侧与北侧）的杂物
    K.sandPile(42.6, -55, 2.2, 0.5); K.sandPile(20, -60.6, 2.0, 0.45); K.crateStack(31, -61.4, 3, 0.9); K.barrel(43, 0, -40.8);
  }
  // 北端集结区
  K.barrier(-14, -66, 0.2); K.barrier(14, -70, -0.1); K.container(-34, -69.5, 0.1, [0.5, 0.5, 0.48]); K.container(30, -70.5, -0.05, [0.58, 0.20, 0.14]); K.crateStack(-20, -71, 4, 1.6);
  K.sandbags(-7.5, -63.5, 4.2, 0.3, 3); K.sandbags(8, -64, 4.2, -0.3, 3); K.palm(-9, -70, 9); K.palm(9.5, -66, 8.5); K.rubble(15, -65, 2, 12); K.tires(38, -66, 3);

  // ============ 南区：A 点驿站 ============
  {
    const h = 7.2; const stA = K.style({ plinth: 'stone', arch: true, pointed: true, accent: ACCENT[0], vigas: true, awnings: 0.1 });
    const cA = PLASTER[0];
    K.building(8, 36, 21.5, 42, h, { c: cA, style: stA, faces: 'NWS', nf: 2, doors: { N: 1 } });
    K.building(26.5, 36, 40, 42, h, { c: cA, style: stA, faces: 'NES', nf: 2, doors: { N: 1 } });
    K.building(8, 42, 14, 45.5, h, { c: cA, style: stA, faces: 'WE', omit: 'N', nf: 2, roofProps: false });
    K.building(8, 50.5, 14, 54, h, { c: cA, style: stA, faces: 'WE', omit: 'S', nf: 2, roofProps: false });
    K.building(34, 42, 40, 45.5, h, { c: cA, style: stA, faces: 'WE', omit: 'N', nf: 2, roofProps: false });
    K.building(34, 50.5, 40, 54, h, { c: cA, style: stA, faces: 'WE', omit: 'S', nf: 2, roofProps: false });
    K.building(8, 54, 40, 60, 8.6, { c: cA, style: stA, faces: 'NSEW', nf: 2, doors: { N: 2 } });
    // 三座门洞（拱 + 过街楼）
    const gate = (ax, az, bx, bz) => K.facade(ax, az, bx, bz, 0, { floors: [h], c: cA, plain: true, collide: true, style: stA, openings: [[{ kind: 'hole', u0: 0.45, u1: 4.55, v0: 0, v1: 5.0, arch: true, pointed: true }]] });
    gate(21.5, 36, 26.5, 36); gate(26.5, 42, 21.5, 42); B.box('plaster', 21.5, 5.15, 36.25, 26.5, h, 41.75, { bottom: true, c: [0.9, 0.84, 0.72], mat2: 1 });
    gate(8, 50.5, 8, 45.5); gate(14, 45.5, 14, 50.5); B.box('plaster', 8.25, 5.15, 45.5, 13.75, h, 50.5, { bottom: true, c: [0.9, 0.84, 0.72], mat2: 1 });
    gate(34, 50.5, 34, 45.5); gate(40, 45.5, 40, 50.5); B.box('plaster', 34.25, 5.15, 45.5, 39.75, h, 50.5, { bottom: true, c: [0.9, 0.84, 0.72], mat2: 1 });
    for (const [a, b, c2, d] of [[21.5, 36, 26.5, 42], [8, 45.5, 14, 50.5], [34, 45.5, 40, 50.5]]) { const al = (c2 - a) > (d - b) ? 0 : 1; const t = 0.25; if (al === 0) { B.box('plaster', a, h, b, c2, h + 0.65, b + t, { c: cA }); B.box('plaster', a, h, d - t, c2, h + 0.65, d, { c: cA }); } else { B.box('plaster', a, h, b, a + t, h + 0.65, d, { c: cA }); B.box('plaster', c2 - t, h, b, c2, h + 0.65, d, { c: cA }); } }
    K.lantern(24, 4.6, 39, { drop: 0.5, power: 18, radius: 8 }); K.lantern(11, 4.6, 48, { drop: 0.5, power: 18, radius: 8 }); K.lantern(37, 4.6, 48, { drop: 0.5, power: 18, radius: 8 });
    // 院内拱廊
    K.arcade(14, 42, 34, 45, 4.1, 'S', { pointed: true, parapet: 0.45 }); K.arcade(14, 51, 34, 54, 4.1, 'N', { pointed: true, parapet: 0.45 });
    // 水井
    { const wp = [[1.0, 0], [1.35, 0], [1.38, 0.8], [1.2, 0.86], [1.0, 0.86]].map((p) => new THREE.Vector2(p[0], p[1])); B.addGeo('sandstone', new THREE.LatheGeometry(wp, 12), M4(24, 0.05, 48), { uvScale: [4, 1], rays: 12, collide: true });
      for (const s of [-1.15, 1.15]) K.tube('wood', [24 + s, 0.05, 48], [24 + s, 2.7, 48], 0.07); K.tube('wood', [22.7, 2.7, 48], [25.3, 2.7, 48], 0.07); K.tube('wood', [24, 2.7, 48], [24, 1.6, 48], 0.015, { rays: 0 }); K.cyl('wood', 24, 1.3, 48, 0.18, 0.32, { collide: false }); }
    K.palm(17.5, 47.5, 9.5, { y: 0.05 }); K.palm(31, 49, 8.5, { y: 0.05 });
    K.container(29.5, 46.8, 0.12, [0.70, 0.52, 0.18], 0.05); K.crateStack(19, 50, 4, 1.3, 0.05); K.crateStack(28, 51.5, 3, 1.0, 0.05); K.sacks(20.5, 44, 5, 0.05); K.barrel(32.5, 43.5, 0.05); K.barrel(33, 44.3, 0.05);
    K.rug(17, 0.06, 43.5, 1.8, 2.6, 1.57); K.rug(30, 0.06, 52.5, 1.8, 2.6, 1.57); K.pots(15.3, 52.6, 4, 0.5, 0.05); K.sandbags(22, 45.5, 3.2, 0.9, 3, 0.05);
    for (const x of [17, 24, 31]) { K.lantern(x, 3.5, 43.5, { drop: 0.3, power: 11, radius: 6 }); K.lantern(x, 3.5, 52.5, { drop: 0.3, power: 11, radius: 6 }); }
    K.sign(24, 6.0, 35.96, Math.PI, 0, 1.6); K.sign(18.5, 2.4, 35.72, Math.PI, 0, 2.2); K.sign(7.72, 2.4, 43.6, -Math.PI / 2, 0, 2.0); K.sign(13, 2.4, 33.9, 0, 2, 1.4);
    K.awning(17, 54, 22, 54, 3.6, 2.4, CLOTH[0]);
  }

  // ============ 南区：西南花园废墟 ============
  {
    for (const [a, b] of [[-44, -30], [-25, -12]]) B.box('sandstone', a, 0, 34, b, 1.1, 34.5, {});
    for (const [a, b] of [[36, 46], [52, 62]]) B.box('sandstone', -6.5, 0, a, -6, 1.1, b, {});
    // 废墟外壳
    const c = PLASTER[7]; const st = K.style({ plinth: null, shutters: 0, awnings: 0, vigas: false, cornice: false });
    const fo = (ops) => ({ floors: [3.3, 1.9], c, style: st, collide: true, a: 0.55, posters: false, noAuto: [0, 1], openings: ops });
    K.facade(-38, 40, -26, 40, 0, fo([[{ kind: 'hole', u0: 2, u1: 3.4, v0: 1.0, v1: 2.5 }, { kind: 'hole', u0: 5.2, u1: 7.0, v0: 0, v1: 2.7, arch: true }, { kind: 'hole', u0: 9, u1: 10.4, v0: 1.0, v1: 2.5 }], [{ kind: 'hole', u0: 6.5, u1: 12, v0: 0.5, v1: 1.9, frame: false }]]));
    K.facade(-26, 40, -26, 50, 0, fo([[{ kind: 'hole', u0: 3.6, u1: 6.4, v0: 0, v1: 3.3, frame: false }], [{ kind: 'hole', u0: 2.4, u1: 10, v0: 0.0, v1: 1.9, frame: false }]]));
    K.facade(-26, 50, -38, 50, 0, fo([[{ kind: 'hole', u0: 1.5, u1: 2.9, v0: 1.0, v1: 2.5 }, { kind: 'hole', u0: 8, u1: 9.4, v0: 1.0, v1: 2.5 }], [{ kind: 'hole', u0: 0, u1: 4.5, v0: 0.6, v1: 1.9, frame: false }]]));
    K.facade(-38, 50, -38, 40, 0, fo([[{ kind: 'hole', u0: 4, u1: 5.6, v0: 0, v1: 2.6, arch: true }], null]));
    B.box('plaster', -37.75, 3.1, 40.25, -31.5, 3.3, 49.75, { bottom: true, c: [0.9, 0.84, 0.72], mat2: 1 });
    K.stairs(-30.2, 0, 48.6, '-z', 1.2, 3.3, 5.2, 'sandstone', { solid: false });
    K.rubble(-28.5, 43, 1.8, 14); K.rubble(-24.5, 46, 1.5, 10); K.rubble(-33, 52, 1.6, 10); K.sandPile(-30, 47, 3, 0.6); K.crateStack(-35.5, 43, 2, 0.6);
    for (const [px, pz, ph] of [[-12, 40, 9], [-18, 52, 10.5], [-40, 56, 8.5], [-22, 37, 8], [-10, 58, 9.5], [-42, 37.5, 10], [-33, 58, 9], [-15, 46, 8]]) K.palm(px, pz, ph);
    // 干涸水池
    { const rp = [[3.0, 0], [3.5, 0], [3.52, 0.42], [3.3, 0.46], [3.05, 0.46], [3.0, 0.3]].map((p) => new THREE.Vector2(p[0], p[1])); B.addGeo('sandstone', new THREE.LatheGeometry(rp, 20), M4(-17, 0, 46), { uvScale: [7, 1], rays: 12, collide: true }); K.sandPile(-17, 46, 2.9, 0.18); K.pots(-17, 46, 2, 0.8); }
    // 帐篷
    const tent = (x, z, ry, w, l, h, c2) => {
      const cs = Math.cos(ry), sn = Math.sin(ry); const Lw = (lx, lz) => [x + lx * cs + lz * sn, z - lx * sn + lz * cs];
      for (const s of [-1, 1]) {
        const g = new THREE.PlaneGeometry(l, 1, 6, 4); const pos = g.attributes.position; const wind = [];
        for (let i = 0; i < pos.count; i++) { const t = pos.getY(i) + 0.5; const lz = pos.getX(i); const lx = s * (w / 2) * (1 - t); const [wx, wz] = Lw(lx, lz); pos.setXYZ(i, wx, h * t - Math.sin(t * Math.PI) * 0.12, wz); wind.push(Math.sin(t * Math.PI) * 0.5); }
        g.computeVertexNormals(); g.setAttribute('aWind', new THREE.Float32BufferAttribute(wind, 1));
        B.addGeo('fabric', g, new THREE.Matrix4(), { c: c2, uvScale: [l, 2.5], rays: 10 });
      }
      for (const lz of [-l / 2, l / 2]) { const [px, pz] = Lw(0, lz); K.tube('wood', [px, 0, pz], [px, h + 0.15, pz], 0.04); }
      const [bx_, bz_] = Lw(0, -l / 2); const tri = new THREE.BufferGeometry(); const [p1x, p1z] = Lw(-w / 2, -l / 2), [p2x, p2z] = Lw(w / 2, -l / 2);
      tri.setAttribute('position', new THREE.Float32BufferAttribute([p1x, 0, p1z, p2x, 0, p2z, bx_, h, bz_], 3)); tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 1, 2], 2)); tri.computeVertexNormals();
      B.addGeo('fabric', tri, new THREE.Matrix4(), { c: [c2[0] * 0.9, c2[1] * 0.9, c2[2] * 0.9], rays: 6 });
      B.obox('fabric', x, h * 0.3, z, w * 0.55, h * 0.6, l, [0, ry, 0], { skip: 'EWUDSN', surf: 'cloth' });
    };
    tent(-13, 67.5, 0.2, 3.6, 5, 2.5, [0.55, 0.56, 0.40]); tent(-21, 68.5, -0.15, 3.6, 5, 2.5, [0.62, 0.58, 0.44]); tent(-36, 62, 1.2, 3.2, 4.4, 2.3, [0.7, 0.62, 0.48]);
    K.stall(-20, 36.5, Math.PI, { kind: 'fruit' }); K.stall(-33, 36.8, Math.PI, { kind: 'cloth' }); K.crateStack(-9.5, 38, 3, 0.9); K.rug(-14, 0.02, 53, 2, 3, 0.5);
  }

  // ============ 南端出生点营地 ============
  {
    K.sandbags(-7, 61.5, 5.5, 0.25, 4); K.sandbags(7, 61.5, 5.5, -0.25, 4); K.sandbags(-16, 63.5, 4, 0.9, 3); K.sandbags(16.5, 63.5, 4, -0.9, 3);
    K.crateStack(6, 70.5, 5, 2.0); K.crateStack(-6, 71.5, 4, 1.6); K.container(24, 70.2, 0.04, [0.25, 0.42, 0.30]); K.container(24.3, 67.4, -0.03, [0.20, 0.36, 0.52]);
    for (const [bx, bz] of [[11, 71.5], [11.8, 71.9], [11.3, 72.6]]) K.barrel(bx, 0, bz, [0.28, 0.40, 0.26]);
    // 通讯塔
    { const mx = 15.5, mz = 70.5, mh = 15; const base = [[-0.9, -0.9], [0.9, -0.9], [0.9, 0.9], [-0.9, 0.9]];
      for (const [a, b] of base) K.tube('steel', [mx + a, 0, mz + b], [mx + a * 0.15, mh, mz + b * 0.15], 0.045);
      for (let i = 0; i < 6; i++) { const t0 = i / 6, t1 = (i + 1) / 6; for (let k = 0; k < 4; k++) { const [a, b] = base[k], [c2, d] = base[(k + 1) % 4]; const s0 = 1 - 0.85 * t0, s1 = 1 - 0.85 * t1; K.tube('steel', [mx + a * s0, mh * t0, mz + b * s0], [mx + c2 * s1, mh * t1, mz + d * s1], 0.022, { rays: 0 }); K.tube('steel', [mx + a * s1, mh * t1, mz + b * s1], [mx + c2 * s1, mh * t1, mz + d * s1], 0.02, { rays: 0 }); } }
      K.tube('steel', [mx, mh, mz], [mx, mh + 3.5, mz], 0.025); B.addGeo('emissive', new THREE.SphereGeometry(0.09, 8, 6), M4(mx, mh + 3.5, mz), { c: [1, 0.1, 0.05], hdr: 14, rays: 0 });
      B.addGeo('metalPaint', new THREE.CylinderGeometry(0.5, 0.5, 0.12, 14), M4(mx + 0.5, mh - 1.5, mz, 0, 0, Math.PI / 2), { c: [0.85, 0.85, 0.82], rays: 0 }); B.colBox(mx - 0.9, 0, mz - 0.9, mx + 0.9, 3, mz + 0.9, 'steel'); }
    B.box('metalPaint', -4, 0, 73.0, -1.5, 1.2, 73.9, { c: [0.3, 0.36, 0.28] }); K.tires(-9.5, 73, 3); K.barrier(-12, 62.5, 0.1); K.barrier(12, 62, -0.1);
    K.palm(-28, 70, 9.5); K.palm(30, 64, 9); K.palm(-4.8, 56, 8.5); K.palm(4.9, 46, 9); K.palm(-4.9, 40, 8); K.palm(5, -40, 8.5); K.palm(-4.8, -56, 9); K.palm(5.2, -58, 9.5);
  }

  // ============ 东大街 ============
  {
    // 废弃卡车
    const truck = (x, z, ry, c) => {
      const cs = Math.cos(ry), sn = Math.sin(ry); const Lw = (lx, lz) => [x + lx * cs + lz * sn, z - lx * sn + lz * cs];
      B.obox('metalPaint', x, 1.0, z, 6.4, 0.5, 2.3, [0, ry, 0], { c: [0.3, 0.3, 0.3], bottom: true });
      { const [px, pz] = Lw(-1.2, 0); B.obox('metalRusty', px, 2.15, pz, 3.9, 1.9, 2.4, [0, ry, 0], { c: [0.62, 0.6, 0.5], bottom: true }); }
      { const [px, pz] = Lw(2.25, 0); B.obox('metalPaint', px, 1.95, pz, 1.8, 1.5, 2.3, [0, ry, 0], { c, bottom: true }); const [gx, gz] = Lw(3.16, 0); B.obox('glass', gx, 2.2, gz, 0.04, 0.7, 1.9, [0, ry, 0], { c: [0.25, 0.3, 0.34], collide: false, rays: 0, bottom: true }); const [hx, hz] = Lw(3.1, 0); B.obox('metalPaint', hx, 1.35, hz, 0.4, 0.5, 2.2, [0, ry, 0], { c: [c[0] * 0.7, c[1] * 0.7, c[2] * 0.7], bottom: true }); }
      const wg = new THREE.CylinderGeometry(0.52, 0.52, 0.36, 14);
      for (const lx of [-2.3, -1.1, 2.3]) for (const s of [-1, 1]) { const [px, pz] = Lw(lx, s * 1.05); B.addGeo('dark', wg, M4(px, 0.52, pz, Math.PI / 2, ry, 0), { c: [1.5, 1.5, 1.5], rays: 6 }); }
      B.obox('dark', x, 0.5, z, 6, 1, 2.2, [0, ry, 0], { skip: 'EWUDSN' });
    };
    truck(49.5, -18, 1.35, [0.5, 0.42, 0.26]); truck(46, 62, 0.1, [0.3, 0.36, 0.28]);
    K.container(53.2, 44, Math.PI / 2, [0.58, 0.20, 0.14]); K.container(53.0, 30, Math.PI / 2 + 0.05, [0.20, 0.36, 0.52]); K.container(53.3, 37.1, Math.PI / 2, [0.5, 0.5, 0.48], 0); K.container(44.4, -62, Math.PI / 2, [0.70, 0.52, 0.18]);
    for (const [bx, bz, ry] of [[45.5, 14.6, 0], [48, 14.9, 0.1], [50.5, -11, 0], [53, -10.6, -0.1], [46, -34, 0.2], [52, 21, 1.57], [44, 50, 1.57], [50.5, -39, 0]]) K.barrier(bx, bz, ry);
    for (const z of [-66, -50, -36, -13, 17, 29.5, 50, 68]) { K.palm(54.6, z + rr(-1, 1), rr(8, 10.5)); }
    for (const z of [-58, -26, 4, 34, 60]) { K.tube('steel', [42.8, 0, z], [42.8, 5.0, z], 0.07); K.tube('steel', [42.8, 5.0, z], [44.2, 5.3, z], 0.035); K.lantern(44.2, 5.28, z, { drop: 0.12, power: 14, radius: 8 }); B.box('steel', 42.6, 0, z - 0.2, 43.0, 0.6, z + 0.2, {}); }
    K.sandbags(47.5, -54.5, 4.5, 0.4, 3); K.sandbags(51, 56, 4.5, -0.3, 3); K.crateStack(44, 20, 3, 1.0); K.crateStack(53.5, -44, 4, 1.2); K.tires(43.5, -12, 4); K.rubble(54, 16, 1.6, 10); K.rubble(44.6, -38, 1.4, 8);
    K.stall(53.4, -30, -Math.PI / 2, { kind: 'spice' }); K.stall(53.4, 20.5, -Math.PI / 2, { kind: 'cloth' });
    for (const z of [-42, -8, 20, 46]) K.bunting([42.1, rr(5.6, 6.4), z], [56.2, rr(6.5, 7.6), z + rr(-3, 3)], 1.3);
    for (const z of [-64, -22, 30, 58]) K.cable([42.1, rr(6, 6.5), z], [57, rr(7, 8), z + rr(-4, 4)], 0.9);
    for (let i = 0; i < 14; i++) { const x = chance(0.5) ? rr(42.4, 43.4) : rr(54.4, 55.6), z = rr(-70, 70), r = rr(1.2, 2.6), hh = rr(0.2, 0.5); if ((z > 21.5 && z < 28) || (x < 44 && ((z > -52 && z < -40) || Math.abs(z) < 4))) continue; K.sandPile(x, z, r, hh, terrainH(x, z)); }
    // —— 断拱门：长街南口的旧城门，只剩两侧门墩和半截拱，净宽 9m，机甲可过 ——
    {
      const wo = { grime: { h: 2, m: 0.7 }, top: { h: 1, m: 0.85 } };
      for (const [x0, x1] of [[42, 44.5], [53.5, 56]]) { B.box('sandstone', x0, 0, 23.5, x1, 9.2, 26, wo); for (let x = x0 + 0.1; x < x1 - 0.5; x += 1.25) for (const z of [23.5, 25.5]) B.box('sandstone', x, 9.2, z, x + 0.75, 9.95, z + 0.5, { collide: false, rays: 8 }); }
      B.obox('sandstone', 45.8, 8.75, 24.75, 3.1, 1.2, 2.3, [0, 0, 0.52], { bottom: true }); B.obox('sandstone', 52.6, 8.5, 24.75, 2.2, 1.2, 2.3, [0, 0, -0.6], { bottom: true });
      B.obox('sandstone', 50.6, 0.42, 28.2, 2.4, 0.9, 1.5, [0.1, 0.5, 0.06], {}); B.obox('sandstone', 47.2, 0.3, 21.6, 1.6, 0.7, 1.2, [0.05, -0.4, 0.1], {});
      K.rubble(45.6, 27.2, 1.7, 12); K.rubble(52.6, 22.4, 1.5, 10); K.sandPile(44.8, 22.6, 2.2, 0.5); K.sandPile(53.2, 26.9, 2.0, 0.45);
      K.lantern(44.7, 5.2, 24.75, { drop: 0, power: 14, radius: 8 }); K.bunting([44.5, 7.4, 24.2], [53.5, 6.9, 25.2], 1.2);
    }
    // —— 弹坑：塌陷路面的碎板、坑沿碎石、坑底掩体 ——
    {
      for (const [x, z, sx, sz, rx, ry, rz] of [[45.4, -6.4, 2.8, 2.0, 0.16, 0.5, -0.22], [53.2, -5.2, 2.4, 1.8, -0.14, -0.3, 0.24], [44.9, 9.6, 2.6, 1.9, -0.2, 1.0, -0.16], [53.4, 10.4, 2.6, 2.2, 0.18, 0.2, 0.2], [49, -8.2, 3.0, 1.6, 0.26, 0.1, 0.03], [49.4, 12.4, 2.8, 1.6, -0.26, -0.1, 0.02]]) B.obox('concrete', x, terrainH(x, z) + 0.12, z, sx, 0.22, sz, [rx, ry, rz], { bottom: true, c: [0.86, 0.82, 0.76] });
      for (const [x, z] of [[44.3, -3.5], [54.4, 3.2], [45.2, 6.2], [53.6, -1.8], [47.5, -7.6], [51, 11.4]]) K.rubble(x, z, rr(1.0, 1.6), 8, terrainH(x, z));
      K.tube('metalRusty', [42.9, -0.75, 6.4], [45.3, -1.0, 6.9], 0.3, { c: [0.6, 0.55, 0.5], collide: true }); K.tube('metalRusty', [55.1, -0.7, -3.2], [53.3, -1.05, -3.6], 0.26, { c: [0.6, 0.55, 0.5], collide: true });
      K.barrier(47.2, 5.2, 0.5, -CRATER.d); K.tires(51.2, -2.6, 3, -CRATER.d); K.crate(50.6, -CRATER.d, 4.6, 1.1, 0.4); K.sandPile(49, 1, 3.2, 0.35, -CRATER.d);
    }
  }

  // ============ 街巷杂物 / 电缆 / 彩旗 ============
  {
    // 南市集街（露天，遮阳篷与摊位）
    let i = 0; const kinds = ['pots', 'fruit', 'spice', 'cloth'];
    for (const x of [-38, -27, -14, 10, 17.5, 36]) K.stall(x, 32.2, Math.PI, { kind: kinds[i++ % 4], w: 3.2 });
    for (const x of [-30, -8, 14, 34]) K.bunting([x, 6.0, 26.1], [x + rr(-2, 2), 5.6, 34.4 + (x > 6 ? 1.6 : 0)], 0.9);
    K.crateStack(-22, 27.6, 3, 0.8); K.crateStack(28, 27.4, 3, 0.9); K.sacks(1.5, 27.2, 4); K.barrel(-4.4, 27, 0); K.rug(22, 0.02, 30, 2, 3, 1.57); K.rug(-5, 0.02, 31, 2, 3, 0.3);
    // 巷口拱门墙：把四通八达的街口收成一个个门洞
    {
      const aw = (ax, az, bx, bz, h, u0, u1, v1, c) => K.facade(ax, az, bx, bz, 0, { floors: [h], c, t: 0.7, plain: true, collide: true, a: 0.35, style: { plinth: 'stone' }, openings: [[{ kind: 'hole', u0, u1, v0: 0, v1, arch: true, pointed: true, frame: false }]] });
      aw(-44, 34, -44, 26, 5.6, 2.0, 6.0, 4.3, PLASTER[7]);     // 西门：市集街 ↔ 运河路
      aw(-44, 5, -44, -5, 5.2, 3.0, 7.0, 4.2, PLASTER[2]);      // 西巷口：巷子 ↔ 运河路
      aw(42, -5, 42, 5, 5.2, 3.0, 7.0, 4.2, PLASTER[6]);        // 东巷口：出门就是长街的弹坑
      K.lantern(-44.9, 3.9, 30, { drop: 0, power: 10, radius: 6 }); K.lantern(-44.9, 3.8, 0, { drop: 0, power: 10, radius: 6 }); K.lantern(42.9, 3.8, 0, { drop: 0, power: 10, radius: 6 });
    }
    // 东西小巷
    K.crateStack(-36, -3.2, 3, 1.0); K.barrier(-28, 3.2, 0.1); K.pots(-40, 3.8, 3, 0.5); K.sandbags(30, 2.5, 3.6, 0.2, 3); K.crateStack(37, -3, 3, 0.9); K.barrel(26, 0, -3.8); K.tires(40.2, 3.8, 3);
    for (const x of [-38, -28, 26, 36]) K.cable([x, rr(4.2, 6), -5], [x + rr(-2, 2), rr(4.5, 6.2), 5], 0.7);
    K.bunting([-42, 4.4, -5.1], [-44, 5.0, 5.1], 0.7); K.bunting([22, 6.2, -5.1], [24, 6.2, 5.1], 0.9);
    // 运河路
    for (const z of [-66, -38, -10, 19, 40, 66]) { K.palm(-45.3, z + rr(-1.5, 1.5), rr(8, 10)); }
    K.crateStack(-46.5, -20, 3, 0.8); K.barrier(-47, 22, 1.57); K.stall(-45.6, -9.6, Math.PI / 2, { kind: 'fruit' }); K.sandbags(-47, -58, 4, 1.2, 3); K.tires(-49, 36, 3); K.barrel(-45.2, 0, 35.6);
    for (const z of [-48, -8, 18, 52]) K.cable([-44.1, rr(5, 7), z], [-65.2, rr(7.5, 9), z + rr(-5, 5)], 1.6);
    // 沙堆（墙根）
    const piles = [[-43.5, -20], [-43.4, 12], [-20.6, -10], [20.6, -9], [-19.4, 9], [41.4, -15], [41.5, 15], [-5.6, -40], [-5.5, -56], [6.5, 40], [-5.6, 44], [7.4, 55], [41.6, 40], [41.6, 57], [-31.6, 20], [31.5, -3.6], [-19.6, 3.6], [19.5, 3.4], [-43.4, -60]];
    for (const [px, pz] of piles) K.sandPile(px, pz, rr(1.4, 2.8), rr(0.25, 0.55));
    for (let k = 0; k < 14; k++) K.sandPile(rr(-5, 5), chance(0.5) ? rr(-60, -36) : rr(36, 60), rr(1, 2), rr(0.08, 0.2));
    // 方向标记
    K.sign(-5.98, 2.3, 40.5, Math.PI / 2, 2, 1.3); K.sign(42.02, 2.3, 12, -Math.PI / 2, 5, 1.2, [0.4, 0.4, 0.4]);
  }

  // ============ 近景散布：干草丛与碎石 ============
  {
    const zones = [[-43, 35, -7, 61, 90, 40], [-40, 62.5, 40, 73, 60, 30], [-43, -73.5, 41, -62.6, 45, 30], [-64.8, -70, -62.2, 70, 40, 14], [-49.8, -70, -44.4, 70, 36, 20], [42.3, -70, 43.3, 70, 26, 12], [54.5, -70, 55.8, 70, 30, 14], [-5.6, 35, 5.6, 61, 10, 14], [-5.6, -61, 5.6, -35, 10, 14]];
    for (const [x0, z0, x1, z1, nt, nr] of zones) {
      for (let i = 0; i < nt; i++) { const x = rr(x0, x1), z = rr(z0, z1); K.tufts(x, z, 1 + Math.floor(rng() * 3), 0.5, terrainH(x, z)); }
      for (let i = 0; i < nr; i++) { const x = rr(x0, x1), z = rr(z0, z1); K.rock(x, z, rr(0.05, 0.22), terrainH(x, z)); }
    }
    // 运河底：杂草更茂密
    for (let i = 0; i < 70; i++) { const x = chance(0.7) ? (chance(0.5) ? rr(-60.8, -59.6) : rr(-52.4, -51.2)) : rr(-60.5, -51.5), z = rr(-56, 56); K.tufts(x, z, 2, 0.4, -3.4); if (chance(0.4)) K.rock(x + rr(-1, 1), z + rr(-1, 1), rr(0.08, 0.3), -3.4); }
  }

  // ============ 玩家边界（隐形墙） ============
  B.clipBox(BOUNDS.x0 - 1, -6, BOUNDS.z0 - 1, BOUNDS.x0, 90, BOUNDS.z1 + 1); B.clipBox(BOUNDS.x1, -6, BOUNDS.z0 - 1, BOUNDS.x1 + 1, 90, BOUNDS.z1 + 1);
  B.clipBox(BOUNDS.x0, -6, BOUNDS.z0 - 1, BOUNDS.x1, 90, BOUNDS.z0); B.clipBox(BOUNDS.x0, -6, BOUNDS.z1, BOUNDS.x1, 90, BOUNDS.z1 + 1);
  B.clipBox(BOUNDS.x0, 62, BOUNDS.z0, BOUNDS.x1, 63, BOUNDS.z1);

  // 过场镜头路径
  L.flyover = [
    { from: [-34, 16, 62], to: [-6, 9, 30], look: [0, 3, 0], t: 5 },
    { from: [36, 3.2, -30], to: [-30, 3.6, -30], look: [-60, 3, -30], t: 5 },
    { from: [48.1, 3.0, 44], to: [48.1, 2.4, 8], look: [46, 2.5, -46], t: 5 },
    { from: [38, 24, 34], to: [22, 30, 6], look: [0, 2, -6], t: 5 },
  ];
  // ============ 闷烧点（放在最后，不打乱前面的随机序列）============
  // 室内浮尘体（阳光射进来会照出光柱）：[x0,y0,z0, x1,y1,z1, 浓度倍率]。
  // 顶面取在天花板下方 0.2~0.3m：阴影贴图在薄楼板背面会有少量漏光，浮尘不贴到天花板就不会把它显出来
  L.dustVolumes = [
    [-61, -3.4, -50, -51, -0.75, -22, 12],        // 涵洞
    [-44, 0, 5, -32, 3.15, 26, 7],                // 暗道
    [-32, 0, 13, -20, 4.7, 26, 6],                // 工坊
    [9, A_Y, -59.2, 20, A_Y + 3.9, -51, 7],       // 货栈
    [20, 0, -26, 33, 3.3, -13, 6],                // 茶馆
    [-40, 0, -34, -8, 6.3, -26, 5],               // 巴扎西段（板条顶棚，光柱从顶上漏下来）
    [8, 0, -34, 38, 6.3, -26, 5],                 // 巴扎东段
    [-6, 0, -26, 6, 4.0, -23.8, 4],               // 中门门洞
    [-37.75, 0, 40.25, -26.25, 2.8, 49.75, 4],    // 废墟
  ];
  L.smokes = [[46.2, 17], [-45, 39], [37.5, 31]];
  for (const [sx, sz] of L.smokes) K.burnPile(sx, sz);

  return L;
}
