// 建筑与道具"零件库"：立面、建筑、拱廊、集市摊位、棕榈树、灯笼、电缆等程序化生成器
import * as THREE from 'three';
import { mulberry32 } from '../gfx/texgen.js';

const cache = new Map();
const geo = (key, make) => { let g = cache.get(key); if (!g) { g = make(); cache.set(key, g); } return g; };
const _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler();
export function M4(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

export const PLASTER = [
  [0.93, 0.89, 0.81], [0.86, 0.78, 0.64], [0.82, 0.71, 0.62], [0.92, 0.92, 0.90], [0.86, 0.82, 0.72],
  [0.90, 0.84, 0.68], [0.76, 0.69, 0.63], [0.74, 0.74, 0.72], [0.88, 0.80, 0.68], [0.94, 0.91, 0.85],
];
export const ACCENT = [[0.14, 0.46, 0.48], [0.17, 0.32, 0.60], [0.24, 0.44, 0.27], [0.52, 0.21, 0.15], [0.80, 0.62, 0.20], [0.30, 0.52, 0.66]];
export const CLOTH = [[0.74, 0.16, 0.11], [0.15, 0.24, 0.52], [0.88, 0.57, 0.12], [0.90, 0.86, 0.76], [0.20, 0.44, 0.32], [0.55, 0.20, 0.42], [0.85, 0.42, 0.14]];

// 拱形开口上方的墙体（圆拱 / 尖拱）
function archGeo(w, Ht, depth, pointed) {
  return geo(`arch|${w.toFixed(3)}|${Ht.toFixed(3)}|${depth.toFixed(3)}|${pointed ? 1 : 0}`, () => {
    const sh = new THREE.Shape(); const R = w / 2;
    sh.moveTo(0, 0);
    if (pointed) {
      const off = R * 0.35, r2 = R + off;
      sh.absarc(R + off, 0, r2, Math.PI, Math.acos(-off / r2), true);
      sh.absarc(R - off, 0, r2, Math.acos(off / r2), 0, true);
    } else sh.absarc(R, 0, R, Math.PI, 0, true);
    sh.lineTo(w, Ht); sh.lineTo(0, Ht); sh.lineTo(0, 0);
    return new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false, curveSegments: 9 });
  });
}
export const archRise = (w, pointed) => pointed ? (w / 2) * 1.304 : w / 2;

export function createKit(B, seed = 7) {
  const rng = mulberry32(seed);
  const rr = (a, b) => a + (b - a) * rng();
  const pick = (arr) => arr[Math.floor(rng() * arr.length) % arr.length];
  const chance = (p) => rng() < p;
  const K = { B, rng, rr, pick, chance };

  const cyl = (rt, rb, h, seg = 12, open = false) => geo(`cyl|${rt}|${rb}|${h}|${seg}|${open}`, () => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open));
  const sph = (r, ws = 12, hs = 8) => geo(`sph|${r}|${ws}|${hs}`, () => new THREE.SphereGeometry(r, ws, hs));
  const dome = (r, ws = 20, hs = 10) => geo(`dome|${r}|${ws}|${hs}`, () => new THREE.SphereGeometry(r, ws, hs, 0, Math.PI * 2, 0, Math.PI / 2));

  // ---------- 基础零件 ----------
  K.cyl = (mat, x, y, z, r, h, o = {}) => B.addGeo(mat, cyl(o.rt !== undefined ? o.rt : r, r, h, o.seg || 12), M4(x, y + h / 2, z, o.rx || 0, o.ry || 0, o.rz || 0), { uvScale: [Math.max(1, Math.round(r * 6.28 / (o.ts || 2))), h / (o.ts || 2)], rays: 12, ...o });
  // 沿任意方向的圆柱（两端点）
  K.tube = (mat, a, b, r, o = {}) => {
    const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]); const len = d.length(); d.normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    const m = new THREE.Matrix4().compose(new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), q, new THREE.Vector3(1, 1, 1));
    B.addGeo(mat, cyl(r, r, 1, o.seg || 8).clone().scale(1, len, 1), m, { uvScale: [1, len / (o.ts || 2)], rays: 8, ...o });
  };

  // 悬链线电缆
  K.cable = (a, b, sag = 0.6, r = 0.018, mat = 'dark', o = {}) => {
    const mid = new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - sag * 2, (a[2] + b[2]) / 2);
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(...a), mid, new THREE.Vector3(...b));
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    B.addGeo(mat, new THREE.TubeGeometry(curve, Math.max(6, Math.round(len / 1.5)), r, 4, false), new THREE.Matrix4(), { rays: 0, c: [0.3, 0.3, 0.3], ...o });
    return curve;
  };

  // 彩旗串
  K.bunting = (a, b, sag = 0.8) => {
    const curve = K.cable(a, b, sag, 0.012);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]); const n = Math.floor(len / 0.55);
    const dir = new THREE.Vector3(b[0] - a[0], 0, b[2] - a[2]).normalize(); const ry = Math.atan2(-dir.z, dir.x);
    const tri = geo('flag', () => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([-0.17, 0, 0, 0.17, 0, 0, 0, -0.42, 0], 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 0.3, 1, 0.15, 0.6], 2));
      g.setAttribute('aWind', new THREE.Float32BufferAttribute([0, 0, 1.6], 1));
      return g;
    });
    for (let i = 1; i < n; i++) { const p = curve.getPoint(i / n); B.addGeo('fabric', tri, M4(p.x, p.y, p.z, 0, ry, 0), { c: pick(CLOTH), rays: 0 }); }
  };

  // 灯笼（自发光 + 烘焙点光源）
  K.lantern = (x, y, z, o = {}) => {
    const drop = o.drop !== undefined ? o.drop : 0.5;
    if (drop > 0) B.box('dark', x - 0.008, y, z - 0.008, x + 0.008, y + drop, z + 0.008, { collide: false, rays: 0, bottom: true });
    B.box('steel', x - 0.11, y - 0.02, z - 0.11, x + 0.11, y + 0.02, z + 0.11, { collide: false, rays: 0, bottom: true });
    B.box('steel', x - 0.11, y - 0.34, z - 0.11, x + 0.11, y - 0.30, z + 0.11, { collide: false, rays: 0, bottom: true });
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) B.box('steel', x + sx * 0.1 - 0.012, y - 0.3, z + sz * 0.1 - 0.012, x + sx * 0.1 + 0.012, y, z + sz * 0.1 + 0.012, { collide: false, rays: 0 });
    const col = o.color || [1.0, 0.60, 0.26]; const hdr = o.hdr || 7;
    B.addGeo('emissive', geo('lcore', () => new THREE.BoxGeometry(0.15, 0.24, 0.15)), M4(x, y - 0.16, z), { c: col, hdr, rays: 0 });
    if (o.light !== false) B.light(x, y - 0.2, z, [Math.pow(col[0], 2.2), Math.pow(col[1], 2.2), Math.pow(col[2], 2.2)], o.power || 16, o.radius || 8);
  };

  // 木箱
  K.crate = (x, y, z, s = 1, ry = 0, o = {}) => B.group(x, y + (o.h || s) + 0.12, z, () => K._crate(x, y, z, s, ry, o));
  K._crate = (x, y, z, s = 1, ry = 0, o = {}) => {
    const h = o.h || s; const tint = o.c || [0.9 + rng() * 0.1, 0.86 + rng() * 0.1, 0.8 + rng() * 0.1];
    B.obox('wood', x, y + h / 2, z, s, h, s, [0, ry, 0], { c: tint, bottom: false });
    const bt = 0.07 * Math.max(0.8, s), e = s / 2 + 0.012;
    const dark = [tint[0] * 0.78, tint[1] * 0.76, tint[2] * 0.72];
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const loc = (lx, lz) => [x + lx * cs + lz * sn, z - lx * sn + lz * cs];
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const [wx, wz] = loc(sx * (e - bt / 2), sz * (e - bt / 2)); B.obox('wood', wx, y + h / 2, wz, bt, h + 0.02, bt, [0, ry, 0], { c: dark, collide: false, rays: 6, bottom: false }); }
    for (const yy of [bt / 2, h - bt / 2]) {
      for (const sz of [-1, 1]) { const [wx, wz] = loc(0, sz * (e - bt * 0.3)); B.obox('wood', wx, y + yy, wz, s, bt, bt * 0.6, [0, ry, 0], { c: dark, collide: false, rays: 6, bottom: true }); }
      for (const sx of [-1, 1]) { const [wx, wz] = loc(sx * (e - bt * 0.3), 0); B.obox('wood', wx, y + yy, wz, bt * 0.6, bt, s, [0, ry, 0], { c: dark, collide: false, rays: 6, bottom: true }); }
    }
  };
  K.crateStack = (x, z, n = 3, spread = 1.4, y = 0) => {
    for (let i = 0; i < n; i++) {
      const s = rr(0.8, 1.25); const px = x + rr(-spread, spread) * (i ? 1 : 0), pz = z + rr(-spread, spread) * (i ? 1 : 0);
      K.crate(px, y, pz, s, rr(0, 1.5));
      if (chance(0.4)) K.crate(px + rr(-0.1, 0.1), y + s, pz + rr(-0.1, 0.1), s * rr(0.6, 0.85), rr(0, 1.5));
    }
  };

  // 油桶
  K.barrel = (x, y, z, c = null, o = {}) => {
    c = c || pick([[0.25, 0.42, 0.55], [0.62, 0.20, 0.14], [0.28, 0.40, 0.26], [0.78, 0.62, 0.2], [0.35, 0.35, 0.36]]);
    const m = o.lying ? M4(x, y + 0.31, z, 0, o.ry || 0, Math.PI / 2) : M4(x, y + 0.45, z, 0, rng() * 6, 0);
    B.addGeo('metalPaint', cyl(0.3, 0.3, 0.9, 14), m, { c, uvScale: [1, 0.45], collide: true, rays: 10 });
    for (const yy of [-0.3, 0, 0.3]) B.addGeo('metalPaint', cyl(0.315, 0.315, 0.03, 14, true), o.lying ? M4(x, y + 0.31, z, 0, o.ry || 0, Math.PI / 2).multiply(M4(0, yy, 0)) : M4(x, y + 0.45 + yy, z), { c: [c[0] * 0.8, c[1] * 0.8, c[2] * 0.8], uvScale: [1, 0.05], rays: 0 });
  };

  // 沙袋墙
  K.sandbags = (x, z, len, ry = 0, rows = 3, y = 0) => B.group(x, y + rows * 0.2 + 0.15, z, () => K._sandbags(x, z, len, ry, rows, y));
  K._sandbags = (x, z, len, ry = 0, rows = 3, y = 0) => {
    const bagL = 0.62, bagH = 0.2, bagW = 0.34; const n = Math.max(1, Math.round(len / bagL));
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const g = geo('bag', () => new THREE.SphereGeometry(0.5, 8, 6));
    for (let r = 0; r < rows; r++) for (let i = 0; i < n - (r % 2); i++) {
      const lx = (i - (n - 1) / 2 + (r % 2) * 0.5) * bagL + rr(-0.03, 0.03);
      B.addGeo('fabric', g, M4(x + lx * cs, y + bagH / 2 + r * bagH * 0.88, z - lx * sn, rr(-0.06, 0.06), ry + rr(-0.08, 0.08), 0, bagL * 1.08, bagH * 1.25, bagW * 1.1), { c: [0.62 + rng() * 0.1, 0.54 + rng() * 0.08, 0.38 + rng() * 0.06], uvScale: [2, 1], rays: 8 });
    }
    B.obox('fabric', x, y + rows * bagH * 0.44, z, len, rows * bagH * 0.88, bagW, [0, ry, 0], { skip: 'EWUDSN', surf: 'sand' });
  };

  // 陶罐
  const potGeo = geo('pot', () => {
    const pts = [[0.0, 0], [0.16, 0], [0.27, 0.12], [0.33, 0.32], [0.30, 0.52], [0.20, 0.68], [0.13, 0.76], [0.15, 0.84], [0.19, 0.88], [0.17, 0.90], [0.11, 0.86]].map((p) => new THREE.Vector2(p[0], p[1]));
    return new THREE.LatheGeometry(pts, 14);
  });
  K.pot = (x, y, z, s = 1, c = null) => {
    B.addGeo(chance(0.25) ? 'tiles' : 'plaster', potGeo, M4(x, y, z, 0, rng() * 6, 0, s, s * rr(0.9, 1.25), s), { c: c || pick([[0.74, 0.44, 0.30], [0.66, 0.38, 0.26], [0.82, 0.62, 0.42], [0.55, 0.36, 0.28]]), a: 0, uvScale: [2, 1], rays: 8 });
    B.colBox(x - 0.25 * s, y, z - 0.25 * s, x + 0.25 * s, y + 0.85 * s, z + 0.25 * s, 'plaster', [0.7, 0.45, 0.3]);
  };
  K.pots = (x, z, n = 3, spread = 0.8, y = 0) => { for (let i = 0; i < n; i++) K.pot(x + rr(-spread, spread), y, z + rr(-spread, spread), rr(0.6, 1.25)); };

  // 麻袋堆
  K.sacks = (x, z, n = 4, y = 0) => {
    const g = geo('bag', () => new THREE.SphereGeometry(0.5, 8, 6));
    for (let i = 0; i < n; i++) B.addGeo('fabric', g, M4(x + rr(-0.5, 0.5), y + 0.16 + (i > 2 ? 0.28 : 0), z + rr(-0.4, 0.4), rr(-0.2, 0.2), rng() * 6, 0, 0.8, 0.42, 0.55), { c: [0.70, 0.60, 0.42], uvScale: [2, 1], rays: 8 });
    B.colBox(x - 0.52, y, z - 0.42, x + 0.52, y + 0.36, z + 0.42, 'fabric', [0.7, 0.6, 0.42], 'sand');   // 比麻袋堆的外形略小：四角不留看不见的棱
  };

  // 地毯（平铺或挂墙）
  K.rug = (x, y, z, w, l, ry = 0, kind = null, hang = false) => {
    const g = geo('rugq', () => new THREE.PlaneGeometry(1, 1, 3, 4));
    B.addGeo(kind || (chance(0.5) ? 'rugRed' : 'rugBlue'), g, hang ? M4(x, y, z, 0, ry, 0, w, l, 1) : M4(x, y, z, -Math.PI / 2, ry, 0, w, l, 1), { rays: 8, c: [0.95, 0.92, 0.88] });
  };

  // 遮阳篷（a→b 沿墙，向外伸出 depth）
  K.awning = (ax, az, bx, bz, y, depth = 1.6, c = null, o = {}) => {
    const len = Math.hypot(bx - ax, bz - az); const dx = (bx - ax) / len, dz = (bz - az) / len; const nx = dz, nz = -dx;
    const drop = o.drop !== undefined ? o.drop : 0.55;
    const g = new THREE.PlaneGeometry(len, 1, Math.max(2, Math.round(len / 0.6)), 4);
    const pos = g.attributes.position; const wind = [];
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i) + len / 2, t = 0.5 - pos.getY(i);   // t: 0 贴墙 → 1 外缘
      const sag = Math.sin(Math.PI * (u / len)) * 0.0 + Math.sin(t * Math.PI) * 0.10;
      pos.setXYZ(i, ax + dx * u + nx * depth * t, y - drop * t - sag, az + dz * u + nz * depth * t);
      wind.push(t * t * 1.2);
    }
    g.computeVertexNormals(); g.setAttribute('aWind', new THREE.Float32BufferAttribute(wind, 1));
    B.addGeo(o.plain ? 'fabric' : 'fabricStripe', g, new THREE.Matrix4(), { c: c || pick(CLOTH), uvScale: [len / 1.6, depth / 1.6], rays: 10 });
    // 支撑杆
    for (const u of [0.04, len - 0.04]) {
      const ox = ax + dx * u + nx * depth, oz = az + dz * u + nz * depth;
      if (o.poles !== false) K.tube('wood', [ox, o.poleBase || 0, oz], [ox, y - drop + 0.02, oz], 0.035, { c: [0.7, 0.6, 0.5] });
      else K.tube('steel', [ax + dx * u, y - 0.9, az + dz * u], [ox, y - drop, oz], 0.02);
    }
    B.obox('wood', (ax + bx) / 2 + nx * depth, y - drop, (az + bz) / 2 + nz * depth, len, 0.05, 0.05, [0, Math.atan2(-dz, dx), 0], { collide: false, rays: 0, bottom: true, c: [0.7, 0.6, 0.5] });
  };

  // 沙堆（贴墙根，打破墙地交线）
  K.sandPile = (x, z, r = 1.5, h = 0.4, y = 0) => {
    B.addGeo('terrain', geo('pile', () => new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2)), M4(x, y - 0.03, z, 0, rng() * 6, 0, r, h, r * rr(0.6, 1)), { uv: 'world', a: 0.0, rays: 8, c: [1, 0.98, 0.94] });
  };
  // 碎石瓦砾
  // 闷烧的轮胎堆：焦黑轮胎 + 碎块 + 发光余烬 + 一盏烘进 GI 的暖色小灯（黑烟由特效层生成）
  K.burnPile = (x, z) => {
    K.rubble(x, z, 1.2, 6); K.tires(x + 0.25, z - 0.15, 3); K.tires(x - 0.5, z + 0.3, 2);
    B.addGeo('emissive', geo('ember', () => new THREE.BoxGeometry(0.44, 0.1, 0.38)), M4(x - 0.08, 0.15, z + 0.05, 0, 0.5, 0), { c: [1.0, 0.42, 0.10], hdr: 6, rays: 0 });
    B.light(x, 0.5, z, [1.0, 0.25, 0.04], 10, 5);
  };
  K.rubble = (x, z, r = 1.2, n = 8, y = 0) => {
    for (let i = 0; i < n; i++) {
      const s = rr(0.12, 0.42); const a = rng() * 6.28, d = Math.sqrt(rng()) * r;
      B.obox(chance(0.5) ? 'sandstone' : 'plaster', x + Math.cos(a) * d, y + s * 0.3, z + Math.sin(a) * d, s * rr(0.8, 1.6), s * rr(0.5, 1), s * rr(0.8, 1.4), [rr(-0.5, 0.5), rng() * 3, rr(-0.5, 0.5)], { collide: false, rays: 6, c: [0.85, 0.78, 0.66], a: 0.9, bottom: false });
    }
    K.sandPile(x, z, r * 1.1, 0.25, y);
  };

  // ---------- 立面 ----------
  // a→b 为墙线（外法线 = (dz,0,-dx)），y0 起，o.floors = 每层高度数组
  K.facade = (ax, az, bx, bz, y0, o) => {
    const len = Math.hypot(bx - ax, bz - az); const dx = (bx - ax) / len, dz = (bz - az) / len; const nx = dz, nz = -dx;
    const t = o.t || 0.25; const c = o.c; const st = o.style || {};
    const accent = st.accent || [0.2, 0.4, 0.5];
    const P = (u, v, w) => [ax + dx * u - nx * w, y0 + v, az + dz * u - nz * w];
    const bx3 = (mat, u0, v0, w0, u1, v1, w1, oo) => { const a = P(u0, v0, w0), b = P(u1, v1, w1); B.box(mat, a[0], a[1], a[2], b[0], b[1], b[2], oo); };
    const wallA = o.a !== undefined ? o.a : 0.16;
    const total = o.floors.reduce((s, f) => s + f, 0);
    const ryWall = Math.atan2(-dz, dx);
    const letter = (vx, vz) => vx > 0.5 ? 'E' : vx < -0.5 ? 'W' : vz > 0.5 ? 'S' : 'N';
    const LI = letter(-nx, -nz), LP = letter(dx, dz), LM = letter(-dx, -dz);
    let v = 0;
    const doorSet = new Set();
    const margin = o.margin !== undefined ? o.margin : 1.1; const usable = len - 2 * margin;
    const nb = usable > 1.6 ? Math.max(1, Math.floor(usable / (o.bay || 3.3))) : 0; const bw = nb ? usable / nb : 0;
    if (o.doors && nb) { const want = Math.min(nb, o.doors); while (doorSet.size < want) doorSet.add(Math.floor(rng() * nb)); }
    if (o.doorAt !== undefined && nb) { doorSet.clear(); for (const d of [].concat(o.doorAt)) doorSet.add(Math.max(0, Math.min(nb - 1, d))); }

    o.floors.forEach((fh, fi) => {
      const b0 = v, b1 = v + fh;
      const ops = [];
      if (!o.plain && !(o.noAuto && o.noAuto.includes(fi))) for (let i = 0; i < nb; i++) {
        const uc = margin + (i + 0.5) * bw;
        let kind = 'none';
        if (fi === 0) { if (doorSet.has(i)) kind = 'door'; else if (o.shops) kind = chance(0.85) ? 'shop' : 'none'; else if (o.groundWin !== false) kind = chance(0.7) ? 'win' : 'none'; }
        else kind = chance(o.winChance !== undefined ? o.winChance : 0.86) ? 'win' : 'none';
        if (kind === 'win') {
          const ww = st.ww || 1.1; const sill = fi === 0 ? 1.2 : 0.95; const wh = Math.min(st.wh || 1.5, fh - sill - 0.5);
          if (wh > 0.7) ops.push({ kind, u0: uc - ww / 2, u1: uc + ww / 2, v0: b0 + sill, v1: b0 + sill + wh, arch: !!st.arch && wh > 1.2, fi });
        } else if (kind === 'door') {
          const dw = 1.4; const rise = archRise(dw, st.pointed); const dh = Math.min(2.1 + rise, fh - 0.35);
          ops.push({ kind, u0: uc - dw / 2, u1: uc + dw / 2, v0: b0, v1: b0 + dh, arch: true, pointed: st.pointed, fi });
        } else if (kind === 'shop') {
          const sw = Math.min(bw - 0.7, 2.9); ops.push({ kind, u0: uc - sw / 2, u1: uc + sw / 2, v0: b0, v1: b0 + Math.min(2.7, fh - 0.45), fi });
        }
      }
      if (o.openings && o.openings[fi]) for (const e of o.openings[fi]) ops.push({ fi, ...e, v0: b0 + e.v0, v1: b0 + e.v1 });
      ops.sort((p, q) => p.u0 - q.u0);
      const grime = fi === 0 ? { h: st.grimeH || 1.7, m: 0.70, a: Math.min(0.75, wallA + 0.42) } : undefined;
      const topG = fi === o.floors.length - 1 ? { h: 0.9, m: 0.86 } : undefined;
      const piece = (u0, u1, v0, v1, kind = 'strip') => {
        if (u1 - u0 < 0.01 || v1 - v0 < 0.01) return;
        let skip = '';
        if (!o.collide) { skip = LI + (kind === 'strip' ? 'UD' : kind === 'below' ? LP + LM + 'D' : LP + LM + 'U'); }
        bx3(o.mat || 'plaster', u0, v0, 0, u1, v1, t, { c, a: wallA, collide: !!o.collide, grime: v0 === 0 ? grime : undefined, top: v1 >= total - 0.01 ? topG : undefined, bottom: o.collide ? v0 > 0.01 : kind === 'above', skip });
        if (fi === 0 && v0 === 0 && v1 - v0 > 2.6 && u1 - u0 > 1.7 && !o.plain && o.posters !== false && chance(0.2)) {
          const n = chance(0.4) ? 2 : 1; const uc = (u0 + u1) / 2 + rr(-0.2, 0.2);
          for (let k = 0; k < n; k++) { const s = rr(0.7, 1.05); const p = P(uc + (k - (n - 1) / 2) * 1.0, rr(1.5, 2.0), -0.012); K.poster(p[0], p[1], p[2], Math.atan2(nx, nz), s, s * rr(1.0, 1.25)); }
        }
        if (fi === 0 && v0 === 0 && st.plinth && v1 - v0 >= 0.8) {
          const ph = Math.min(st.plinthH || 0.95, v1 - v0);
          if (st.plinth === 'stone') bx3('sandstone', u0, 0, -0.04, u1, ph, 0.0, { collide: false, rays: 10, skip: 'D' });
          else bx3('plaster', u0, 0, -0.03, u1, ph, 0.0, { c: st.plinthC || [accent[0] * 0.8 + 0.15, accent[1] * 0.8 + 0.15, accent[2] * 0.8 + 0.15], a: 0.5, collide: false, rays: 10, grime: { h: 0.9, m: 0.6, a: 0.8 } });
        }
      };
      let cur = 0;
      for (const op of ops) {
        if (op.u0 < cur - 0.001) continue;
        piece(cur, op.u0, b0, b1);
        piece(op.u0, op.u1, b0, op.v0, 'below');
        if (op.arch) {
          const w = op.u1 - op.u0; const rise = archRise(w, op.pointed); const spring = op.v1 - rise;
          const Ht = b1 - spring;
          const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(dx, 0, dz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-nx, 0, -nz));
          const p0 = P(op.u0, spring, 0); m.setPosition(p0[0], p0[1], p0[2]);
          B.addGeo(o.mat || 'plaster', archGeo(w, Ht, t, op.pointed), m, { c, a: wallA, uv: 'world', rays: 16, collide: !!o.collide });
          op.spring = spring;
        } else piece(op.u0, op.u1, op.v1, b1, 'above');
        cur = op.u1;
        { const pp = P((op.u0 + op.u1) / 2, (op.v0 + op.v1) / 2, -0.4); B.group(pp[0], pp[1], pp[2], () => K._opening(op, { P, bx3, t, st, accent, dx, dz, nx, nz, ryWall, c, hollow: !!o.collide, y0 })); }
      }
      piece(cur, len, b0, b1);
      // 层间线脚
      if (!o.plain && st.course !== false && fi < o.floors.length - 1) bx3('plaster', -0.02, b1 - 0.07, -0.05, len + 0.02, b1 + 0.07, 0.02, { c: [c[0] * 0.92, c[1] * 0.92, c[2] * 0.92], a: 0.1, collide: false, rays: 10, bottom: true });
      v = b1;
    });
    // 檐口
    if (!o.plain && st.cornice !== false) bx3('plaster', -0.05, total - 0.22, -0.09, len + 0.05, total - 0.04, 0.02, { c: [c[0] * 0.95, c[1] * 0.95, c[2] * 0.95], a: 0.08, collide: false, rays: 10, bottom: true });
    // 木梁头
    if (!o.plain && st.vigas) for (let u = 0.6; u < len - 0.4; u += 0.95) { const p = P(u, total - 0.62, -0.18); B.obox('wood', p[0], p[1], p[2], 0.13, 0.13, 0.6, [0, ryWall + Math.PI / 2, 0], { collide: false, rays: 6, bottom: true, c: [0.8, 0.7, 0.6] }); }
    return { P, len, nb, bw, margin, total };
  };

  // 门窗组件
  K._opening = (op, f) => {
    const { P, bx3, t, st, accent, dx, dz, nx, nz, ryWall } = f;
    const { u0, u1, v0, v1 } = op; const w = u1 - u0;
    const frameMat = st.frame === 'wood' ? 'wood' : 'woodPaint';
    const fc = st.frame === 'wood' ? [0.85, 0.8, 0.75] : accent;
    const nc = { collide: false, rays: 6, bottom: true };
    if (op.kind === 'win' && f.hollow) {
      // 可进入建筑：无玻璃的敞开窗洞 + 石窗台
      bx3('sandstone', u0 - 0.09, v0 - 0.09, -0.09, u1 + 0.09, v0, t + 0.05, { ...nc, rays: 8 });
      const pw = w / 2, sh = v1 - v0;
      if (!op.arch) for (const side of [0, 1]) {
        const th = rr(2.6, 2.95); const hu = side ? u1 : u0; const sgn = side ? -1 : 1;
        const px = sgn * dx * Math.cos(th) + nx * Math.sin(th), pz = sgn * dz * Math.cos(th) + nz * Math.sin(th);
        const h0 = P(hu, v0 + sh / 2, 0);
        B.obox(frameMat, h0[0] + px * pw / 2 + nx * 0.03, h0[1], h0[2] + pz * pw / 2 + nz * 0.03, pw, sh, 0.04, [0, Math.atan2(-pz, px), 0], { c: fc, collide: false, rays: 8, bottom: true });
      }
    } else if (op.kind === 'win') {
      bx3('glass', u0, v0, t - 0.07, u1, v1, t - 0.04, { c: [0.30, 0.36, 0.42], collide: false, rays: 0, skip: 'D' });
      const fw = 0.06;
      bx3(frameMat, u0, v0, t - 0.13, u0 + fw, v1, t - 0.06, { c: fc, ...nc }); bx3(frameMat, u1 - fw, v0, t - 0.13, u1, v1, t - 0.06, { c: fc, ...nc });
      bx3(frameMat, u0, v0, t - 0.13, u1, v0 + fw, t - 0.06, { c: fc, ...nc }); bx3(frameMat, u0, v1 - fw, t - 0.13, u1, v1, t - 0.06, { c: fc, ...nc });
      bx3(frameMat, (u0 + u1) / 2 - 0.025, v0, t - 0.12, (u0 + u1) / 2 + 0.025, v1, t - 0.07, { c: fc, ...nc });
      if (op.arch) bx3(frameMat, u0, op.spring - 0.025, t - 0.12, u1, op.spring + 0.025, t - 0.07, { c: fc, ...nc });
      else bx3(frameMat, u0, v0 + (v1 - v0) * 0.62, t - 0.12, u1, v0 + (v1 - v0) * 0.62 + 0.04, t - 0.07, { c: fc, ...nc });
      bx3('sandstone', u0 - 0.09, v0 - 0.09, -0.09, u1 + 0.09, v0, t - 0.04, { ...nc, rays: 8 });
      if (st.lintel && !op.arch) bx3('sandstone', u0 - 0.14, v1, -0.035, u1 + 0.14, v1 + 0.17, 0.02, { ...nc, rays: 8 });
      const mode = rng();
      if (op.fi === 0 && st.bars !== false && mode < 0.55) {
        for (let i = 1; i <= 4; i++) { const u = u0 + w * i / 5; bx3('steel', u - 0.012, v0, 0.05, u + 0.012, v1, 0.075, { collide: false, rays: 0 }); }
        bx3('steel', u0, v0 + (v1 - v0) * 0.33, 0.045, u1, v0 + (v1 - v0) * 0.33 + 0.02, 0.08, { collide: false, rays: 0, bottom: true });
        bx3('steel', u0, v0 + (v1 - v0) * 0.66, 0.045, u1, v0 + (v1 - v0) * 0.66 + 0.02, 0.08, { collide: false, rays: 0, bottom: true });
      } else if (!op.arch && mode < (st.shutters !== undefined ? st.shutters : 0.7)) {
        // 百叶窗：左右两扇，随机开合角度
        const pw = w / 2; const sh = v1 - v0;
        for (const side of [0, 1]) {
          const th = chance(0.3) ? rr(0.05, 0.4) : rr(2.5, 2.95);
          const hu = side ? u1 : u0; const sgn = side ? -1 : 1;
          const px = sgn * dx * Math.cos(th) + nx * Math.sin(th), pz = sgn * dz * Math.cos(th) + nz * Math.sin(th);
          const h0 = P(hu, v0 + sh / 2, 0);
          B.obox(frameMat, h0[0] + px * pw / 2 + nx * 0.03, h0[1], h0[2] + pz * pw / 2 + nz * 0.03, pw, sh, 0.04, [0, Math.atan2(-pz, px), 0], { c: fc, collide: false, rays: 8, bottom: true });
        }
      } else if (mode > 0.9 && op.fi > 0) {
        const p = P((u0 + u1) / 2, v0 - 0.75, -0.2); K.acUnit(p[0], p[1], p[2], ryWall);
      }
      if (op.fi > 0 && chance(st.awnings !== undefined ? st.awnings : 0.12)) { const a = P(u0 - 0.15, v1 + 0.12, 0), b = P(u1 + 0.15, v1 + 0.12, 0); K.awning(a[0], a[2], b[0], b[2], a[1], 0.9, null, { poles: false, drop: 0.45 }); }
    } else if (op.kind === 'door') {
      const dc = st.door || accent;
      bx3('woodPaint', u0, v0, t - 0.10, u1, v1, t - 0.04, { c: dc, collide: false, rays: 8, skip: 'D' });
      bx3('steel', (u0 + u1) / 2 - 0.012, v0, t - 0.115, (u0 + u1) / 2 + 0.012, v1 - 0.4, t - 0.095, { collide: false, rays: 0 });
      for (const s of [-1, 1]) { const p = P((u0 + u1) / 2 + s * 0.12, v0 + 1.1, t - 0.13); B.addGeo('steel', geo('ring', () => new THREE.TorusGeometry(0.05, 0.012, 5, 10)), M4(p[0], p[1], p[2], 0, ryWall, 0), { rays: 0 }); }
      bx3('sandstone', u0 - 0.2, v0 - 0.02, -0.42, u1 + 0.2, v0 + 0.13, 0.0, { collide: false, rays: 10 });
      // 门套（石质）
      bx3('sandstone', u0 - 0.16, v0, -0.04, u0, op.spring, 0.03, { ...nc, rays: 8 }); bx3('sandstone', u1, v0, -0.04, u1 + 0.16, op.spring, 0.03, { ...nc, rays: 8 });
      if (chance(0.55)) { const p = P(u1 + 0.45, v0 + 2.55, -0.28); K.lantern(p[0], p[1], p[2], { drop: 0.0, power: 9, radius: 6 }); const q = P(u1 + 0.45, v0 + 2.57, 0); K.tube('steel', [q[0], q[1], q[2]], [p[0], p[1] + 0.02, p[2]], 0.012); }
      if (chance(0.35)) { const a = P(u0 - 0.5, v1 + 0.45, 0), b = P(u1 + 0.5, v1 + 0.45, 0); K.awning(a[0], a[2], b[0], b[2], a[1], 1.3, null, { poles: false, drop: 0.5 }); }
    } else if (op.kind === 'shop') {
      const openAmt = chance(0.45) ? rr(0.45, 1.0) : 0; const sh = v1 - v0;
      const sc = chance(0.5) ? accent : pick(ACCENT);
      if (openAmt < 0.99) bx3('shutter', u0, v0 + sh * openAmt, t - 0.12, u1, v1, t - 0.08, { c: [sc[0] * 0.6 + 0.32, sc[1] * 0.6 + 0.32, sc[2] * 0.6 + 0.32], collide: false, rays: 8, bottom: true });
      bx3('steel', u0 - 0.02, v1 - 0.22, t - 0.16, u1 + 0.02, v1, t - 0.06, { collide: false, rays: 6, bottom: true });
      if (openAmt > 0) {
        // 店铺内凹空间
        const d = 2.2; const ic = [0.62, 0.56, 0.48];
        bx3('plaster', u0 - 0.1, v0, t + d, u1 + 0.1, v1 + 0.3, t + d + 0.1, { c: ic, collide: false, rays: 8 });
        bx3('plaster', u0 - 0.2, v0, t, u0 - 0.1, v1 + 0.3, t + d, { c: ic, collide: false, rays: 8 }); bx3('plaster', u1 + 0.1, v0, t, u1 + 0.2, v1 + 0.3, t + d, { c: ic, collide: false, rays: 8 });
        bx3('plaster', u0 - 0.2, v1 + 0.3, t, u1 + 0.2, v1 + 0.4, t + d + 0.1, { c: ic, collide: false, rays: 8, bottom: true });
        bx3('paving', u0 - 0.1, v0 - 0.1, t, u1 + 0.1, v0 + 0.03, t + d, { collide: false, rays: 8 });
        const p = P((u0 + u1) / 2, v0, t + d * 0.6);
        if (chance(0.5)) K.pots(p[0], p[2], 3, 0.6, f.y0 + 0.03); else { K.crate(p[0] + rr(-0.5, 0.5), f.y0 + 0.03, p[2] + rr(-0.3, 0.3), rr(0.6, 0.9), rng()); K.sacks(p[0] + rr(-0.5, 0.5), p[2] + rr(-0.3, 0.3), 3, f.y0 + 0.03); }
        if (chance(0.6)) { const q = P((u0 + u1) / 2, v1 + 0.12, t + d * 0.45); K.lantern(q[0], q[1], q[2], { drop: 0.18, power: 12, radius: 6 }); }
        if (chance(0.5)) { const q = P(u0 + 0.5, v0 + 1.5, t + d - 0.03); K.rug(q[0], q[1], q[2], 1.2, 1.9, ryWall + Math.PI, null, true); }
      }
      bx3('sandstone', u0 - 0.1, v0 - 0.02, -0.3, u1 + 0.1, v0 + 0.1, 0.0, { collide: false, rays: 8 });
      if (chance(0.75)) { const a = P(u0 - 0.2, v1 + 0.35, 0), b = P(u1 + 0.2, v1 + 0.35, 0); K.awning(a[0], a[2], b[0], b[2], a[1], rr(1.5, 2.2), null, { poles: chance(0.5), poleBase: f.y0, drop: rr(0.5, 0.8) }); }
    } else if (op.kind === 'hole') {
      // 纯开口（可通行），四周加石框
      if (op.frame !== false) { bx3('sandstone', u0 - 0.12, v0, -0.03, u0, v1, t + 0.03, { ...nc, rays: 8, collide: false }); bx3('sandstone', u1, v0, -0.03, u1 + 0.12, v1, t + 0.03, { ...nc, rays: 8, collide: false }); }
    }
  };

  K.acUnit = (x, y, z, ry) => {
    B.obox('metalPaint', x, y, z, 0.85, 0.55, 0.32, [0, ry, 0], { collide: false, rays: 8, bottom: true, c: [0.82, 0.82, 0.78] });
    const nx = Math.sin(ry), nz = Math.cos(ry);
    B.obox('dark', x - nx * 0.165, y, z - nz * 0.165, 0.5, 0.42, 0.02, [0, ry, 0], { collide: false, rays: 0, bottom: true });
  };

  // ---------- 建筑 ----------
  K.style = (o = {}) => ({
    accent: pick(ACCENT), arch: chance(0.35), pointed: chance(0.6), shutters: rr(0.4, 0.9), frame: chance(0.3) ? 'wood' : 'paint',
    lintel: chance(0.5), vigas: chance(0.4), plinth: pick(['stone', 'paint', 'paint', null]), ww: rr(1.0, 1.25), wh: rr(1.4, 1.75), awnings: 0.12, ...o,
  });

  // x0,z0,x1,z1 为占地；h 为屋面高度；o.faces 需要细节的面；o.hollow 可进入
  K.building = (x0, z0, x1, z1, h, o = {}) => {
    const y0 = o.y0 || 0, t = 0.25;
    const c = o.c || pick(PLASTER); const st = o.style || K.style();
    const nf = o.nf || Math.max(1, Math.round(h / 3.25)); const floors = o.floors || Array(nf).fill(h / nf);
    const faces = o.faces !== undefined ? o.faces : 'NESW'; const omit = o.omit || '';
    const lines = { N: [x0, z0, x1, z0], E: [x1, z0, x1, z1], S: [x1, z1, x0, z1], W: [x0, z1, x0, z0] };
    const res = {};
    for (const f of 'NESW') {
      if (omit.includes(f)) continue;
      const [ax, az, bx, bz] = lines[f];
      res[f] = K.facade(ax, az, bx, bz, y0, {
        floors, c, style: st, plain: !faces.includes(f), collide: !!o.hollow, a: o.a,
        doors: o.doors && o.doors[f], doorAt: o.doorAt && o.doorAt[f], shops: o.shops && o.shops.includes(f),
        openings: o.openings && o.openings[f], bay: o.bay, groundWin: o.groundWin, winChance: o.winChance, margin: o.margin, noAuto: o.noAuto,
      });
    }
    const rc = o.roofC || [0.90, 0.84, 0.72];
    B.box('plaster', x0 + t, y0 + h - 0.22, z0 + t, x1 - t, y0 + h, z1 - t, { c: rc, a: 0.3, collide: !!o.hollow, bottom: !!o.hollow });
    if (!o.hollow) B.colBox(x0, y0, z0, x1, y0 + h, z1, 'plaster', c);
    // 女儿墙
    const ph = o.parapet !== undefined ? o.parapet : 0.65;
    if (ph > 0) {
      const po = { c, a: 0.12, top: { h: 0.3, m: 0.9 } };
      const yb = y0 + h, yt = y0 + h + ph;
      B.box('plaster', x0, yb, z0, x1, yt, z0 + t, po); B.box('plaster', x0, yb, z1 - t, x1, yt, z1, po);
      B.box('plaster', x0, yb, z0 + t, x0 + t, yt, z1 - t, po); B.box('plaster', x1 - t, yb, z0 + t, x1, yt, z1 - t, po);
      const cc = { collide: false, rays: 8, bottom: true };
      B.box('sandstone', x0 - 0.04, yt, z0 - 0.04, x1 + 0.04, yt + 0.07, z0 + t + 0.04, cc); B.box('sandstone', x0 - 0.04, yt, z1 - t - 0.04, x1 + 0.04, yt + 0.07, z1 + 0.04, cc);
      B.box('sandstone', x0 - 0.04, yt, z0 + t, x0 + t + 0.04, yt + 0.07, z1 - t, cc); B.box('sandstone', x1 - t - 0.04, yt, z0 + t, x1 + 0.04, yt + 0.07, z1 - t, cc);
      if (o.crenel) for (const f of 'NESW') {
        const [ax, az, bx, bz] = lines[f]; const len = Math.hypot(bx - ax, bz - az); const dx = (bx - ax) / len, dz = (bz - az) / len; const nx = dz, nz = -dx;
        for (let u = 0.5; u < len - 0.5; u += 1.6) B.obox('plaster', ax + dx * u - nx * t / 2, yt + 0.3, az + dz * u - nz * t / 2, 0.8, 0.46, t, [0, Math.atan2(-dz, dx), 0], { c, collide: false, rays: 8 });
      }
    }
    if (o.roofProps !== false) K.roofProps(x0 + 0.8, z0 + 0.8, x1 - 0.8, z1 - 0.8, y0 + h, o.roofDensity !== undefined ? o.roofDensity : 1);
    // 墙根杂草与碎石
    if (y0 === 0 && o.weeds !== false) for (const f of faces) {
      const [ax, az, bx, bz] = lines[f]; const len = Math.hypot(bx - ax, bz - az); const dx = (bx - ax) / len, dz = (bz - az) / len; const nx = dz, nz = -dx;
      const n = Math.floor(len / 9 + rng() * 1.5);
      for (let i = 0; i < n; i++) { const u = rr(0.8, len - 0.8), w = rr(0.12, 0.35); if (chance(0.7)) K.tuft(ax + dx * u + nx * w, az + dz * u + nz * w, rr(0.4, 0.8), 0.03); else K.rock(ax + dx * u + nx * w, az + dz * u + nz * w, rr(0.06, 0.16), 0.03); }
    }
    // 落水管
    if (faces.length && chance(0.6)) { const f = faces[Math.floor(rng() * faces.length)]; const [ax, az, bx, bz] = lines[f]; const len = Math.hypot(bx - ax, bz - az); const dx = (bx - ax) / len, dz = (bz - az) / len; const nx = dz, nz = -dx; const u = chance(0.5) ? 0.35 : len - 0.35; K.tube('metalRusty', [ax + dx * u + nx * 0.07, y0, az + dz * u + nz * 0.07], [ax + dx * u + nx * 0.07, y0 + h - 0.1, az + dz * u + nz * 0.07], 0.05, { c: [0.6, 0.55, 0.5] }); }
    return { x0, z0, x1, z1, h, y0, c, st, faces: res };
  };

  // 屋顶杂物
  K.roofProps = (x0, z0, x1, z1, y, density = 1) => {
    const area = (x1 - x0) * (z1 - z0); if (area < 12) return;
    const n = Math.floor(area / 38 * density + rng() * 1.5);
    for (let i = 0; i < n; i++) {
      const x = rr(x0 + 0.5, x1 - 0.5), z = rr(z0 + 0.5, z1 - 0.5); const k = rng();
      if (k < 0.22) K.roofTank(x, y, z);
      else if (k < 0.42) K.satDish(x, y, z, rng() * 6.28);
      else if (k < 0.62) { B.obox('metalPaint', x, y + 0.35, z, 1.0, 0.7, 0.7, [0, rng() * 3, 0], { c: [0.8, 0.8, 0.76], bottom: false }); B.obox('dark', x, y + 0.71, z, 0.6, 0.02, 0.4, [0, 0, 0], { collide: false, rays: 0 }); }
      else if (k < 0.78) K.crate(x, y, z, rr(0.6, 1.0), rng() * 3);
      else if (k < 0.9) K.pots(x, z, 2, 0.5, y);
      else { B.obox('concrete', x, y + 0.25, z, 0.7, 0.5, 0.7, [0, rng(), 0], { bottom: false }); K.cyl('metalRusty', x, y + 0.5, z, 0.12, 0.9, { collide: false }); }
    }
    if (area > 60 && chance(0.5 * density)) {
      const ax = rr(x0 + 0.5, x0 + (x1 - x0) * 0.4), bx = rr(x0 + (x1 - x0) * 0.6, x1 - 0.5), z = rr(z0 + 1, z1 - 1);
      K.clothesline([ax, y + 1.9, z], [bx, y + 1.9, z + rr(-1, 1)]);
    }
  };
  K.roofTank = (x, y, z) => {
    const c = pick([[0.12, 0.12, 0.13], [0.2, 0.34, 0.6], [0.82, 0.82, 0.8]]);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) B.box('steel', x + sx * 0.45 - 0.03, y, z + sz * 0.45 - 0.03, x + sx * 0.45 + 0.03, y + 0.55, z + sz * 0.45 + 0.03, { collide: false, rays: 0 });
    B.addGeo('metalPaint', cyl(0.62, 0.62, 1.15, 14), M4(x, y + 0.55 + 0.575, z), { c, uvScale: [2, 0.6], rays: 10 });
    B.addGeo('metalPaint', cyl(0.2, 0.62, 0.18, 14), M4(x, y + 1.79, z), { c, uvScale: [2, 0.2], rays: 6 });
    B.colBox(x - 0.55, y, z - 0.55, x + 0.55, y + 1.8, z + 0.55, 'metalPaint', c);
  };
  K.satDish = (x, y, z, ry) => {
    K.cyl('steel', x, y, z, 0.035, 0.9, { collide: false });
    const g = geo('dish', () => { const pts = []; for (let i = 0; i <= 6; i++) { const r = i / 6 * 0.55; pts.push(new THREE.Vector2(r, r * r * 0.55)); } const l = new THREE.LatheGeometry(pts, 14); return l; });
    const m = M4(x, y + 0.95, z, -1.05, ry, 0);
    B.addGeo('metalPaint', g, m, { c: [0.85, 0.85, 0.82], rays: 6 });
    const m2 = M4(x, y + 0.95, z, -1.05 + Math.PI, ry, 0, 1, -1, 1);
    B.addGeo('metalPaint', g, M4(x, y + 0.95, z, 2.09, ry + Math.PI, 0), { c: [0.6, 0.6, 0.58], rays: 0 });
  };
  K.clothesline = (a, b) => {
    for (const p of [a, b]) K.tube('wood', [p[0], p[1] - 1.9, p[2]], p, 0.03, { c: [0.7, 0.6, 0.5] });
    const curve = K.cable(a, b, 0.12, 0.008);
    const len = Math.hypot(b[0] - a[0], b[2] - a[2]); const n = Math.floor(len / 0.9);
    const dir = new THREE.Vector3(b[0] - a[0], 0, b[2] - a[2]).normalize(); const ry = Math.atan2(-dir.z, dir.x);
    for (let i = 1; i < n; i++) {
      if (chance(0.25)) continue;
      const p = curve.getPoint(i / n); const w = rr(0.45, 0.8), h = rr(0.6, 1.1);
      const g = new THREE.PlaneGeometry(w, h, 2, 3); const wind = []; const pos = g.attributes.position;
      for (let k = 0; k < pos.count; k++) wind.push((0.5 - pos.getY(k) / h) * 1.3);
      g.setAttribute('aWind', new THREE.Float32BufferAttribute(wind, 1));
      B.addGeo('fabric', g, M4(p.x, p.y - h / 2, p.z, 0, ry, 0), { c: pick([[0.9, 0.9, 0.86], [0.6, 0.2, 0.18], [0.25, 0.35, 0.6], [0.85, 0.75, 0.5], [0.3, 0.5, 0.45]]), rays: 6 });
    }
  };

  // ---------- 拱廊 ----------
  // 沿 a→b 的一排柱 + 尖拱；外法线同立面约定。返回柱位
  K.arches = (ax, az, bx, bz, y0, h, o = {}) => {
    const len = Math.hypot(bx - ax, bz - az); const dx = (bx - ax) / len, dz = (bz - az) / len; const nx = dz, nz = -dx;
    const cw = o.colW || 0.6; const n = o.n || Math.max(1, Math.round((len - cw) / (o.span || 3.6))); const span = (len - cw) / n;
    const P = (u, v, w) => [ax + dx * u - nx * w, y0 + v, az + dz * u - nz * w];
    const mat = o.mat || 'sandstone'; const c = o.c || [1, 1, 1];
    const wo = span - cw; const rise = archRise(wo, o.pointed !== false); const spring = Math.max(o.minSpring !== undefined ? o.minSpring : 1.6, h - rise - (o.above || 0.5)); h = Math.max(h, spring + rise + 0.15);
    for (let i = 0; i <= n; i++) {
      const u = i * span; const a = P(u, 0, 0), b = P(u + cw, spring, cw);
      B.box(mat, a[0], a[1], a[2], b[0], b[1], b[2], { c, grime: { h: 1.2, m: 0.75 } });
      // 柱头 / 柱础
      const a2 = P(u - 0.07, spring - 0.22, -0.07), b2 = P(u + cw + 0.07, spring, cw + 0.07); B.box(mat, a2[0], a2[1], a2[2], b2[0], b2[1], b2[2], { c, collide: false, rays: 8, bottom: true });
      const a3 = P(u - 0.07, 0, -0.07), b3 = P(u + cw + 0.07, 0.28, cw + 0.07); B.box(mat, a3[0], a3[1], a3[2], b3[0], b3[1], b3[2], { c, collide: false, rays: 8 });
      if (i < n) {
        const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(dx, 0, dz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-nx, 0, -nz));
        const p0 = P(u + cw, spring, 0); m.setPosition(p0[0], p0[1], p0[2]);
        B.addGeo(mat, archGeo(wo, h - spring, cw, o.pointed !== false), m, { c, uv: 'world', rays: 16 });
        const ca = P(u + cw, spring + rise, 0), cb = P(u + span, h, cw); B.colBox(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2], mat);
      }
    }
    return { n, span, cw, spring, P };
  };

  // 带顶的拱廊（占地 x0..x1, z0..z1；open = 开敞的面 'N' 'S' 'E' 'W' 的组合）
  K.arcade = (x0, z0, x1, z1, h, open, o = {}) => {
    const lines = { N: [x0, z0, x1, z0], E: [x1, z0, x1, z1], S: [x1, z1, x0, z1], W: [x0, z1, x0, z0] };
    for (const f of open) { const [ax, az, bx, bz] = lines[f]; K.arches(ax, az, bx, bz, o.y0 || 0, h - 0.3, o); }
    const y = (o.y0 || 0) + h;
    B.box('plaster', x0, y - 0.3, z0, x1, y, z1, { c: [0.90, 0.84, 0.72], a: 0.3, bottom: true });
    // 天花木梁
    const alongX = (x1 - x0) > (z1 - z0);
    if (alongX) for (let x = x0 + 1.2; x < x1 - 0.6; x += 1.8) B.box('wood', x - 0.08, y - 0.48, z0 + 0.3, x + 0.08, y - 0.3, z1 - 0.3, { collide: false, rays: 6, bottom: true });
    else for (let z = z0 + 1.2; z < z1 - 0.6; z += 1.8) B.box('wood', x0 + 0.3, y - 0.48, z - 0.08, x1 - 0.3, y - 0.3, z + 0.08, { collide: false, rays: 6, bottom: true });
    const ph = o.parapet !== undefined ? o.parapet : 0.5;
    if (ph > 0) for (const f of open) {
      const t = 0.25; const po = { c: o.pc || [0.9, 0.82, 0.68], a: 0.1 };
      if (f === 'N') B.box('plaster', x0, y, z0, x1, y + ph, z0 + t, po);
      else if (f === 'S') B.box('plaster', x0, y, z1 - t, x1, y + ph, z1, po);
      else if (f === 'W') B.box('plaster', x0, y, z0, x0 + t, y + ph, z1, po);
      else B.box('plaster', x1 - t, y, z0, x1, y + ph, z1, po);
    }
  };

  // ---------- 集市摊位 ----------
  K.stall = (x, z, ry = 0, o = {}) => B.group(x, (o.y || 0) + 1.5, z, () => K._stall(x, z, ry, o));
  K._stall = (x, z, ry = 0, o = {}) => {
    const w = o.w || 3.0, d = o.d || 2.2, h = o.h || 2.5; const y = o.y || 0;
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const L = (lx, lz) => [x + lx * cs + lz * sn, z - lx * sn + lz * cs];
    const cc = o.c || pick(CLOTH);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const [px, pz] = L(sx * w / 2, sz * d / 2); K.tube('wood', [px, y, pz], [px, y + h + (sz < 0 ? 0.35 : 0), pz], 0.045, { c: [0.75, 0.66, 0.55] }); }
    // 篷布
    const g = new THREE.PlaneGeometry(w + 0.5, d + 0.7, 6, 5); const pos = g.attributes.position; const wind = [];
    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i), lz = pos.getY(i); const ex = Math.abs(lx) / (w / 2 + 0.25), ez = Math.abs(lz) / (d / 2 + 0.35);
      const sag = (1 - ex * ex) * (1 - ez * ez) * 0.22; const slope = (lz / (d + 0.7) + 0.5) * -0.35 + 0.35;
      const [wx, wz] = L(lx, lz); pos.setXYZ(i, wx, y + h + slope - sag, wz); wind.push(Math.max(0, 1 - Math.max(ex, ez)) * 0.6 + (ex > 0.9 || ez > 0.9 ? 0.5 : 0));
    }
    g.computeVertexNormals(); g.setAttribute('aWind', new THREE.Float32BufferAttribute(wind, 1));
    B.addGeo(chance(0.6) ? 'fabricStripe' : 'fabric', g, new THREE.Matrix4(), { c: cc, uvScale: [2, 1.5], rays: 12 });
    // 货台
    const [tx, tz] = L(0, 0.1);
    B.obox('wood', tx, y + 0.42, tz, w - 0.3, 0.84, d * 0.5, [0, ry, 0], { c: [0.9, 0.85, 0.78], bottom: false });
    // 货物
    const kind = o.kind || pick(['fruit', 'pots', 'cloth', 'spice']);
    if (kind === 'fruit' || kind === 'spice') {
      const cols = kind === 'fruit' ? [[0.9, 0.5, 0.1], [0.75, 0.15, 0.1], [0.5, 0.65, 0.15], [0.9, 0.8, 0.2]] : [[0.8, 0.3, 0.1], [0.85, 0.65, 0.15], [0.45, 0.25, 0.12], [0.6, 0.12, 0.1]];
      for (let i = 0; i < 4; i++) {
        const [bx_, bz_] = L((i - 1.5) * (w - 0.7) / 4, 0.1);
        B.obox('wood', bx_, y + 0.9, bz_, 0.55, 0.12, 0.6, [0, ry, 0], { collide: false, rays: 6, bottom: false, c: [0.8, 0.7, 0.6] });
        const cc2 = cols[i % 4];
        if (kind === 'fruit') for (let k = 0; k < 9; k++) B.addGeo('fabric', sph(0.07, 6, 4), M4(bx_ + rr(-0.2, 0.2), y + 0.99 + rr(0, 0.08), bz_ + rr(-0.22, 0.22)), { c: [cc2[0] * rr(0.85, 1), cc2[1] * rr(0.85, 1), cc2[2]], rays: 0 });
        else B.addGeo('fabric', geo('cone', () => new THREE.ConeGeometry(0.24, 0.26, 10)), M4(bx_, y + 1.08, bz_), { c: cc2, rays: 6 });
      }
    } else if (kind === 'pots') { for (let i = 0; i < 5; i++) { const [px, pz] = L(rr(-w / 2 + 0.4, w / 2 - 0.4), rr(-0.15, 0.4)); B.addGeo('plaster', potGeo, M4(px, y + 0.84, pz, 0, rng() * 6, 0, rr(0.35, 0.6), rr(0.35, 0.6), rr(0.35, 0.6)), { c: pick([[0.74, 0.44, 0.30], [0.3, 0.5, 0.6], [0.82, 0.62, 0.42]]), a: 0, rays: 6 }); } }
    else { for (let i = 0; i < 5; i++) { const [px, pz] = L((i - 2) * (w - 0.8) / 5, 0.1 + rr(-0.1, 0.1)); B.obox('fabric', px, y + 0.9 + rr(0, 0.05), pz, 0.45, 0.14 + rng() * 0.14, 0.7, [0, ry + rr(-0.1, 0.1), 0], { c: pick(CLOTH), collide: false, rays: 6, bottom: false }); } }
    // 背后挂毯
    if (chance(0.6)) { const [rx_, rz_] = L(rr(-0.5, 0.5), -d / 2 + 0.02); K.rug(rx_, y + 1.55, rz_, 1.3, 1.9, ry, null, true); }
    if (chance(0.5)) { const [lx_, lz_] = L(0, 0.3); K.lantern(lx_, y + h - 0.1, lz_, { drop: 0.25, power: 9, radius: 5 }); }
  };

  // ---------- 棕榈树 ----------
  K.palm = (x, z, h = 8, o = {}) => {
    const y = o.y || 0; const lean = o.lean !== undefined ? o.lean : rr(0.3, 1.6); const la = rng() * 6.28;
    const pts = []; const seg = 6;
    for (let i = 0; i <= seg; i++) { const t = i / seg; pts.push(new THREE.Vector3(x + Math.cos(la) * lean * t * t, y + h * t - 0.2, z + Math.sin(la) * lean * t * t)); }
    const curve = new THREE.CatmullRomCurve3(pts);
    const tg = new THREE.TubeGeometry(curve, 10, 0.2, 7, false);
    // 树干上细下粗
    const tp = tg.attributes.position; const tmp = new THREE.Vector3();
    for (let i = 0; i < tp.count; i++) { const ring = Math.floor(i / 8); const t = ring / 10; const cp = curve.getPoint(t); tmp.fromBufferAttribute(tp, i).sub(cp).multiplyScalar(1.35 - 0.6 * t + (ring % 2 ? 0.08 : 0)).add(cp); tp.setXYZ(i, tmp.x, tmp.y, tmp.z); }
    tg.computeVertexNormals();
    B.addGeo('wood', tg, new THREE.Matrix4(), { c: [1.0, 0.9, 0.78], uvScale: [3, h * 1.2], rays: 16, collide: true });
    const top = curve.getPoint(1);
    B.addGeo('wood', sph(0.42, 8, 6), M4(top.x, top.y, top.z, 0, 0, 0, 1, 1.2, 1), { c: [0.8, 0.7, 0.55], rays: 6 });
    const nl = o.leaves || 15;
    B.group(top.x, top.y + 0.6, top.z, () => { for (let i = 0; i < nl; i++) {
      const ang = i / nl * 6.28 + rr(-0.2, 0.2); const droop = rr(0.5, 1.3); const L = rr(2.8, 3.8) * (h / 8 * 0.4 + 0.6); const up = rr(0.2, 0.9);
      const g = new THREE.PlaneGeometry(L, 1.1, 7, 2); const pos = g.attributes.position; const wind = [];
      for (let k = 0; k < pos.count; k++) {
        const u = (pos.getX(k) + L / 2) / L; const v = pos.getY(k);
        const r = u * L; const yy = up * r * 0.5 - droop * u * u * L * 0.55 - Math.abs(v) * 0.35;
        pos.setXYZ(k, r * 0.92, yy, v); wind.push(u * u * 1.4);
      }
      g.computeVertexNormals(); g.setAttribute('aWind', new THREE.Float32BufferAttribute(wind, 1));
      const dry = i % 5 === 4;
      B.addGeo('leaf', g, M4(top.x, top.y + 0.1, top.z, 0, ang, 0), { c: dry ? [0.75, 0.62, 0.38] : [0.82 + rng() * 0.18, 0.9 + rng() * 0.1, 0.8], rays: 6 });
    } });
  };

  // ---------- 杂项 ----------
  K.container = (x, z, ry = 0, c = null, y = 0) => B.group(x, y + 2.8, z, () => K._container(x, z, ry, c, y));
  K._container = (x, z, ry = 0, c = null, y = 0) => {
    c = c || pick([[0.20, 0.36, 0.52], [0.58, 0.20, 0.14], [0.25, 0.42, 0.30], [0.70, 0.52, 0.18], [0.5, 0.5, 0.48]]);
    B.obox('corrugated', x, y + 1.3, z, 6.06, 2.6, 2.44, [0, ry, 0], { c, bottom: y > 0.1, rays: 20 });
    const cs = Math.cos(ry), sn = Math.sin(ry); const L = (lx, lz) => [x + lx * cs + lz * sn, z - lx * sn + lz * cs];
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const [px, pz] = L(sx * 3.0, sz * 1.19); B.obox('metalPaint', px, y + 1.3, pz, 0.14, 2.64, 0.14, [0, ry, 0], { c: [c[0] * 0.8, c[1] * 0.8, c[2] * 0.8], collide: false, rays: 6 }); }
    for (const sz of [-0.6, -0.2, 0.2, 0.6]) { const [px, pz] = L(3.05, sz); B.obox('steel', px, y + 1.3, pz, 0.04, 2.3, 0.04, [0, ry, 0], { collide: false, rays: 0 }); }
    for (const yy of [0.06, 2.56]) for (const sz of [-1, 1]) { const [px, pz] = L(0, sz * 1.2); B.obox('metalPaint', px, y + yy, pz, 6.1, 0.12, 0.1, [0, ry, 0], { c: [c[0] * 0.8, c[1] * 0.8, c[2] * 0.8], collide: false, rays: 6, bottom: true }); }
  };
  K.barrier = (x, z, ry = 0, y = 0) => {
    B.obox('concrete', x, y + 0.2, z, 2.4, 0.4, 0.62, [0, ry, 0], { bottom: false });
    B.obox('concrete', x, y + 0.65, z, 2.4, 0.5, 0.3, [0, ry, 0], { bottom: false });
  };
  K.tires = (x, z, n = 3, y = 0) => { const g = geo('tire', () => new THREE.TorusGeometry(0.33, 0.13, 6, 12)); for (let i = 0; i < n; i++) B.addGeo('dark', g, M4(x + rr(-0.04, 0.04), y + 0.13 + i * 0.25, z + rr(-0.04, 0.04), Math.PI / 2, 0, 0), { c: [1.4, 1.4, 1.4], rays: 6 }); B.colBox(x - 0.42, y, z - 0.42, x + 0.42, y + n * 0.25, z + 0.42, 'dark'); };
  K.ladder = (x, z, ry, h, y = 0) => {
    const cs = Math.cos(ry), sn = Math.sin(ry);
    for (const s of [-0.24, 0.24]) K.tube('wood', [x + s * cs, y, z - s * sn], [x + s * cs, y + h, z - s * sn], 0.03, { c: [0.75, 0.66, 0.55] });
    for (let yy = 0.3; yy < h; yy += 0.32) K.tube('wood', [x - 0.24 * cs, y + yy, z + 0.24 * sn], [x + 0.24 * cs, y + yy, z - 0.24 * sn], 0.02, { c: [0.75, 0.66, 0.55], rays: 0 });
  };
  // 楼梯：从 (x,z) 沿 dir 上升，可见踏步 + 碰撞斜坡
  K.stairs = (x, y, z, dir, width, rise, run, mat = 'sandstone', o = {}) => {
    const steps = Math.max(2, Math.round(rise / 0.19)); const sh = rise / steps, sd = run / steps;
    const D = { '+x': [1, 0], '-x': [-1, 0], '+z': [0, 1], '-z': [0, -1] }[dir]; const R = [-D[1], D[0]];
    const hw = width / 2;
    for (let i = 0; i < steps; i++) {
      const c0 = [x + D[0] * sd * i - R[0] * hw, z + D[1] * sd * i - R[1] * hw], c1 = [x + D[0] * (o.solid === false ? sd * (i + 1) : run) + R[0] * hw, z + D[1] * (o.solid === false ? sd * (i + 1) : run) + R[1] * hw];
      B.box(mat, c0[0], o.solid === false ? y + sh * i : y + (i ? sh * i : 0), c0[1], c1[0], y + sh * (i + 1), c1[1], { collide: false, rays: 10, bottom: o.solid === false, c: o.c });
    }
    const A0 = [x - R[0] * hw, y, z - R[1] * hw], A1 = [x + R[0] * hw, y, z + R[1] * hw];
    const ex = x + D[0] * run, ez = z + D[1] * run;
    const B0 = [ex - R[0] * hw, y + rise, ez - R[1] * hw], B1 = [ex + R[0] * hw, y + rise, ez + R[1] * hw];
    const C0 = [ex - R[0] * hw, y, ez - R[1] * hw], C1 = [ex + R[0] * hw, y, ez + R[1] * hw];
    B.colQuadN(A0, A1, B1, B0, -D[0] * 0.5, 1, -D[1] * 0.5, mat);
    if (o.solid !== false) { B.colTriN(A0, C0, B0, -R[0], 0, -R[1], mat); B.colTriN(A1, B1, C1, R[0], 0, R[1], mat); B.colQuadN(C0, C1, B1, B0, D[0], 0, D[1], mat); }
  };
  // 实心坡道（楔形体）：从 (x,z) 沿 dir 上升 rise，水平长度 run；坡面按 ~2m 细分以获得足够的烘焙分辨率
  K.ramp = (x, y, z, dir, width, rise, run, mat = 'sandstone', o = {}) => {
    const D = { '+x': [1, 0], '-x': [-1, 0], '+z': [0, 1], '-z': [0, -1] }[dir]; const R = [-D[1], D[0]]; const hw = width / 2;
    const at = (u, v, top) => [x + D[0] * run * u + R[0] * hw * v, y + (top ? rise * u : 0), z + D[1] * run * u + R[1] * hw * v];   // u∈[0,1] 沿坡，v∈[-1,1] 横向
    const P = [], N = [];
    const tri = (a, b, c, n) => {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      let cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx; const l = Math.hypot(cx, cy, cz); if (l < 1e-9) return; cx /= l; cy /= l; cz /= l;
      const flip = cx * n[0] + cy * n[1] + cz * n[2] < 0; const q = flip ? [a, c, b] : [a, b, c];
      for (const p of q) { P.push(p[0], p[1], p[2]); N.push(flip ? -cx : cx, flip ? -cy : cy, flip ? -cz : cz); }
    };
    const quad = (a, b, c, d, n) => { tri(a, b, c, n); tri(a, c, d, n); };
    const nu = Math.max(1, Math.round(Math.hypot(run, rise) / 2)), nv = Math.max(1, Math.round(width / 2));
    const nS = [-D[0] * rise, run, -D[1] * rise];
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      const u0 = i / nu, u1 = (i + 1) / nu, v0 = -1 + 2 * j / nv, v1 = -1 + 2 * (j + 1) / nv;
      quad(at(u0, v0, 1), at(u0, v1, 1), at(u1, v1, 1), at(u1, v0, 1), nS);
    }
    for (let j = 0; j < nv; j++) { const v0 = -1 + 2 * j / nv, v1 = -1 + 2 * (j + 1) / nv; quad(at(1, v0, 0), at(1, v1, 0), at(1, v1, 1), at(1, v0, 1), [D[0], 0, D[1]]); }   // 背面
    for (const s of [-1, 1]) for (let i = 0; i < nu; i++) { const u0 = i / nu, u1 = (i + 1) / nu; quad(at(u0, s, 0), at(u1, s, 0), at(u1, s, 1), at(u0, s, 1), [R[0] * s, 0, R[1] * s]); }   // 两侧
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    B.addGeo(mat, g, new THREE.Matrix4(), { uv: 'world', collide: true, mech: true, rays: 20, c: o.c, ts: o.ts, a: o.a });
  };
  // 木门扇：铰链在 (hx,hz)，门扇沿水平角 ang（弧度，方向 = (cos, sin) 于 x-z 平面）伸出 w
  K.doorLeaf = (hx, hz, y, w, h, ang, o = {}) => {
    const cs = Math.cos(ang), sn = Math.sin(ang); const t = o.t || 0.14; const ry = -ang;
    const cx = hx + cs * w / 2, cz = hz + sn * w / 2;
    B.obox('wood', cx, y + h / 2, cz, w, h, t, [0, ry, 0], { c: o.c || [0.62, 0.5, 0.38], bottom: true, surf: 'wood' });
    for (const v of [0.1, 0.5, 0.9]) B.obox('metalRusty', cx, y + h * v, cz, w + 0.02, 0.16, t + 0.05, [0, ry, 0], { collide: false, rays: 0, bottom: true, c: [0.42, 0.38, 0.34] });
    for (const u of [0.03, 0.97]) B.obox('wood', hx + cs * w * u, y + h / 2, hz + sn * w * u, 0.12, h, t + 0.03, [0, ry, 0], { collide: false, rays: 0, bottom: true, c: [0.5, 0.4, 0.3] });
    // 铆钉
    const sg = sph(0.035, 6, 4);
    for (const v of [0.1, 0.5, 0.9]) for (let u = 0.12; u < 0.95; u += 0.19) for (const s of [-1, 1]) B.addGeo('steel', sg, M4(hx + cs * w * u - sn * s * (t / 2 + 0.035), y + h * v, hz + sn * w * u + cs * s * (t / 2 + 0.035)), { rays: 0, c: [0.5, 0.48, 0.45] });
  };
  // 脚手架
  K.scaffold = (x, z, w, d, levels, ry = 0, y = 0) => {
    const cs = Math.cos(ry), sn = Math.sin(ry); const L = (lx, lz) => [x + lx * cs + lz * sn, z - lx * sn + lz * cs];
    const lh = 2.1; const H = levels * lh;
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const [px, pz] = L(sx * w / 2, sz * d / 2); K.tube('steel', [px, y, pz], [px, y + H + 1.0, pz], 0.03); }
    for (let l = 1; l <= levels; l++) {
      const yy = y + l * lh;
      B.obox('wood', x, yy - 0.03, z, w + 0.2, 0.06, d, [0, ry, 0], { bottom: true, c: [0.9, 0.84, 0.74] });
      for (const sz of [-1, 1]) { const [ax, az] = L(-w / 2, sz * d / 2), [bx, bz] = L(w / 2, sz * d / 2); K.tube('steel', [ax, yy + 0.95, az], [bx, yy + 0.95, bz], 0.022, { rays: 0 }); K.tube('steel', [ax, yy - lh + 0.2, az], [bx, yy - 0.1, bz], 0.018, { rays: 0 }); }
    }
  };
  // 水塔 / 储罐
  K.waterTower = (x, z, r = 3, legH = 6, tankH = 4.5, y = 0) => {
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; const px = x + Math.cos(a) * r * 0.85, pz = z + Math.sin(a) * r * 0.85; B.box('steel', px - 0.14, y, pz - 0.14, px + 0.14, y + legH, pz + 0.14, {}); }
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4, b = a + Math.PI / 2; const p = [x + Math.cos(a) * r * 0.85, z + Math.sin(a) * r * 0.85], q = [x + Math.cos(b) * r * 0.85, z + Math.sin(b) * r * 0.85];
      K.tube('steel', [p[0], y + 0.4, p[1]], [q[0], y + legH * 0.5, q[1]], 0.05); K.tube('steel', [q[0], y + 0.4, q[1]], [p[0], y + legH * 0.5, p[1]], 0.05);
      K.tube('steel', [p[0], y + legH * 0.5, p[1]], [q[0], y + legH - 0.2, q[1]], 0.05); K.tube('steel', [q[0], y + legH * 0.5, q[1]], [p[0], y + legH - 0.2, p[1]], 0.05);
      K.tube('steel', [p[0], y + legH * 0.5, p[1]], [q[0], y + legH * 0.5, q[1]], 0.05);
    }
    B.addGeo('steel', cyl(r * 1.02, r * 1.02, 0.25, 20), M4(x, y + legH + 0.12, z), { uvScale: [6, 0.2], rays: 10, collide: true });
    B.addGeo('metalRusty', cyl(r, r, tankH, 24), M4(x, y + legH + 0.25 + tankH / 2, z), { c: [0.80, 0.74, 0.62], uvScale: [8, 2], rays: 16, collide: true });
    for (const yy of [0.4, tankH / 2, tankH - 0.4]) B.addGeo('steel', cyl(r + 0.03, r + 0.03, 0.12, 24, true), M4(x, y + legH + 0.25 + yy, z), { uvScale: [8, 0.1], rays: 0 });
    B.addGeo('metalRusty', cyl(0.3, r + 0.1, 1.2, 24), M4(x, y + legH + 0.25 + tankH + 0.6, z), { c: [0.72, 0.62, 0.5], uvScale: [8, 1], rays: 12, collide: true });
    K.tube('metalRusty', [x + r * 0.3, y, z + r * 0.3], [x + r * 0.3, y + legH + 0.2, z + r * 0.3], 0.16, { c: [0.7, 0.66, 0.6], collide: true });
    K.ladder(x + r + 0.12, z, 0, legH + tankH, y);
  };
  // 穹顶
  K.dome = (x, y, z, r, c = [0.95, 0.93, 0.88], mat = 'plaster', drumH = 0) => {
    if (drumH > 0) B.addGeo(mat, cyl(r * 1.02, r * 1.02, drumH, 24), M4(x, y + drumH / 2, z), { c, a: 0.05, uvScale: [Math.round(r * 2), drumH / 3], rays: 14, collide: true });
    B.addGeo(mat, dome(r, 24, 10), M4(x, y + drumH, z, 0, 0, 0, 1, 1.05, 1), { c, a: 0.02, uvScale: [Math.round(r * 2), r / 2], rays: 14, collide: true });
    B.addGeo('steel', cyl(0.03, 0.06, r * 0.5, 6), M4(x, y + drumH + r * 1.05 + r * 0.25, z), { rays: 0 });
    B.addGeo('steel', sph(0.14, 8, 6), M4(x, y + drumH + r * 1.05 + r * 0.2, z), { rays: 0 });
  };
  // 城墙段（带垛口）
  K.cityWall = (x0, z0, x1, z1, h, o = {}) => {
    B.box('sandstone', x0, 0, z0, x1, h, z1, { grime: { h: 2, m: 0.7 }, top: { h: 1, m: 0.85 }, c: o.c });
    const alongX = (x1 - x0) > (z1 - z0);
    if (alongX) for (let x = x0 + 0.6; x < x1 - 1; x += 2.2) { B.box('sandstone', x, h, z0, x + 1.2, h + 0.9, z0 + 0.5, { c: o.c, collide: false, rays: 10 }); B.box('sandstone', x, h, z1 - 0.5, x + 1.2, h + 0.9, z1, { c: o.c, collide: false, rays: 10 }); }
    else for (let z = z0 + 0.6; z < z1 - 1; z += 2.2) { B.box('sandstone', x0, h, z, x0 + 0.5, h + 0.9, z + 1.2, { c: o.c, collide: false, rays: 10 }); B.box('sandstone', x1 - 0.5, h, z, x1, h + 0.9, z + 1.2, { c: o.c, collide: false, rays: 10 }); }
  };
  // 干草丛：三片交叉的草叶面片，随风摆动
  const tuftGeo = geo('tuft', () => {
    const P = [], N = [], U = [], W = [], I = [];
    for (let k = 0; k < 3; k++) { const a = k * Math.PI / 3, c = Math.cos(a) * 0.5, s = Math.sin(a) * 0.5; const b = k * 4;
      P.push(-c, 0, -s, c, 0, s, c, 0.8, s, -c, 0.8, -s); N.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0); U.push(0, 0, 1, 0, 1, 1, 0, 1); W.push(0, 0, 0.8, 0.8); I.push(b, b + 1, b + 2, b, b + 2, b + 3); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setAttribute('aWind', new THREE.Float32BufferAttribute(W, 1)); g.setIndex(I); return g;
  });
  K.tuft = (x, z, s = 1, y = 0) => B.addGeo('grass', tuftGeo, M4(x, y - 0.02, z, 0, rng() * 3.14, 0, s * rr(0.7, 1.1), s * rr(0.6, 1.15), s * rr(0.7, 1.1)), { c: [rr(0.85, 1), rr(0.85, 1), rr(0.7, 0.9)], rays: 6 });
  K.tufts = (x, z, n = 3, spread = 0.8, y = 0) => { for (let i = 0; i < n; i++) K.tuft(x + rr(-spread, spread), z + rr(-spread, spread), rr(0.45, 1.0), y); };
  // 散落的小石块
  const rockGeo = geo('rockS', () => { const g = new THREE.DodecahedronGeometry(1, 0); g.computeVertexNormals(); return g; });
  K.rock = (x, z, s = 0.2, y = 0) => B.addGeo('rock', rockGeo, M4(x, y + s * 0.25, z, rng() * 3, rng() * 3, rng() * 3, s * rr(0.7, 1.3), s * rr(0.45, 0.8), s * rr(0.7, 1.3)), { uv: 'world', ts: 1.5, c: [rr(0.8, 1), rr(0.74, 0.9), rr(0.62, 0.8)], rays: 6 });
  // 海报 / 标记贴花：贴在以 (x,y,z) 为中心、朝向 ry 的墙面上
  K.poster = (x, y, z, ry, w = 0.9, h = 0.9, idx = -1) => {
    const i = idx < 0 ? Math.floor(rng() * 8) : idx;
    B.addGeo('poster', geo('q1', () => new THREE.PlaneGeometry(1, 1)), M4(x, y, z, 0, ry, rr(-0.06, 0.06), w, h, 1), { uvScale: [0.25, 0.5], uvOff: [(i % 4) * 0.25, Math.floor(i / 4) * 0.5], rays: 6 });
  };
  K.sign = (x, y, z, ry, idx, s = 1.6, c = [1, 1, 1]) => {
    B.addGeo('sign', geo('q1', () => new THREE.PlaneGeometry(1, 1)), M4(x, y, z, 0, ry, 0, s, s, 1), { uvScale: [0.25, 0.5], uvOff: [(idx % 4) * 0.25, (1 - Math.floor(idx / 4)) * 0.5], rays: 6, c });
  };
  return K;
}
