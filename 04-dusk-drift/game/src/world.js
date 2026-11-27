// 静态场景几何：路面、路肩、砾石区、草地、护栏、轮胎墙、广告牌、起点龙门架、草丛
// 平面坐标 (x, y) → three 坐标 (x, 高度, -y)
import * as THREE from 'three/webgpu';
import { texture, uv, vec2, vec3, float, mix, attribute, positionLocal, positionGeometry, time, sin, instanceIndex, hash, normalMap, smoothstep } from 'three/tsl';
import { HALF_W, TRACK_W } from './track.js';
import { makeAdAtlas, backlit, soft } from './materials.js';

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// rows: [[{x,y,h,u,v,a?}, ...], ...] → 带索引的网格，自动保证法线朝上
function ribbon(rows, extraName, extraName2) {
  const R = rows.length, C = rows[0].length;
  const pos = new Float32Array(R * C * 3), uvs = new Float32Array(R * C * 2), ext = extraName ? new Float32Array(R * C) : null, ext2 = extraName2 ? new Float32Array(R * C) : null;
  let k = 0;
  for (const row of rows) for (const p of row) { pos[k * 3] = p.x; pos[k * 3 + 1] = p.h || 0; pos[k * 3 + 2] = -p.y; uvs[k * 2] = p.u; uvs[k * 2 + 1] = p.v; if (ext) ext[k] = p.a || 0; if (ext2) ext2[k] = p.b || 0; k++; }
  const idx = [];
  for (let r = 0; r < R - 1; r++) for (let c = 0; c < C - 1; c++) { const a = r * C + c, b = a + 1, d = a + C, e = d + 1; idx.push(a, b, d, b, e, d); }
  // 检查第一个三角形朝向
  const ax = pos[3] - pos[0], az = pos[5] - pos[2], bx = pos[C * 3] - pos[0], bz = pos[C * 3 + 2] - pos[2];
  if (az * bx - ax * bz < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  if (ext) g.setAttribute(extraName, new THREE.BufferAttribute(ext, 1));
  if (ext2) g.setAttribute(extraName2, new THREE.BufferAttribute(ext2, 1));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
const mergeGeos = (list) => {
  let nv = 0, ni = 0; for (const g of list) { nv += g.attributes.position.count; ni += g.index.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uvs = new Float32Array(nv * 2), idx = new Uint32Array(ni);
  const hasCol = list.every(g => g.attributes.color); const col = hasCol ? new Float32Array(nv * 3) : null;
  let vo = 0, io = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, vo * 3); nor.set(g.attributes.normal.array, vo * 3); if (g.attributes.uv) uvs.set(g.attributes.uv.array, vo * 2); if (col) col.set(g.attributes.color.array, vo * 3);
    const gi = g.index.array; for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
    vo += g.attributes.position.count; io += gi.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); out.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
};

export function buildWorld(T, M, scene, quality) {
  const W = { group: new THREE.Group(), lights: [], grassChunks: [], treeSpots: [] };
  scene.add(W.group);
  const add = (geo, mat, { cast = false, recv = true, layer = 0, order = 0 } = {}) => { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = recv; if (layer) m.layers.set(layer); m.renderOrder = order; m.matrixAutoUpdate = false; W.group.add(m); return m; };
  const { N, ds, L, px, py, hx, hy } = T;
  const P = (i, d) => ({ x: px[i] - hy[i] * d, y: py[i] + hx[i] * d });

  // ---------- 路面 ----------
  {
    const cols = 15, rows = [];
    // 胎胶强度：弯道里和弯前刹车区更重（向前看 70 m 内的最大曲率）
    const rub = new Float32Array(N), look = Math.round(70 / ds);
    for (let i = 0; i < N; i++) { let mk = 0; for (let j = 0; j <= look; j += 2) { const k = Math.abs(T.k[(i + j) % N]) * (1 - j / (look * 1.15)); if (k > mk) mk = k; } rub[i] = Math.min(1, 0.26 + mk * 30); }
    for (let r = 0; r <= N; r++) {
      const i = r % N, row = [];
      for (let c = 0; c < cols; c++) { const d = (HALF_W + 0.12) - c / (cols - 1) * (TRACK_W + 0.24); const p = P(i, d); row.push({ x: p.x, y: p.y, h: 0, u: d, v: r * ds, a: d - T.lineD[i], b: rub[i] }); }
      rows.push(row);
    }
    W.road = add(ribbon(rows, 'lineDist', 'rub'), M.road);
  }
  // ---------- 草地（大平面）----------
  {
    const g = new THREE.PlaneGeometry(2600, 2200, 1, 1); g.rotateX(-Math.PI / 2); g.translate(0, -0.035, 0);
    W.ground = add(g, M.grass);
  }
  // ---------- 路边草带（路缘到护栏外 1 m，贴图坐标沿赛道走，割草条纹才会顺着路）----------
  {
    const geos = [];
    for (const side of [1, -1]) {
      const rows = [];
      for (let s = 0; s <= L + 1e-6; s += 2) {
        const i = T.idx(s), bar = side > 0 ? T.barrierL(s) : T.barrierR(s), d0 = HALF_W + 0.04, d1 = bar + 1.0, row = [];
        for (const t of [0, 0.12, 0.4, 0.75, 1]) { const d = side * (d0 + (d1 - d0) * t); const p = P(i, d); row.push({ x: p.x, y: p.y, h: -0.03, u: d, v: s }); }
        rows.push(row);
      }
      geos.push(ribbon(rows));
    }
    W.verge = add(mergeGeos(geos), M.verge);
  }
  // ---------- 路肩 ----------
  {
    const geos = [];
    for (const kb of T.kerbs) {
      const rows = [];
      for (let s = kb.s0; s <= kb.s1 + 1e-6; s += 1) {
        const i = T.idx(s), w = smooth(0, 5, s - kb.s0) * smooth(0, 5, kb.s1 - s), row = [];
        const prof = [[0, 0.003], [0.3, 0.03], [0.75, 0.05], [1, 0.012]];
        for (const [t, h] of prof) { const d = kb.side * (HALF_W - 0.06 + t * T.KERB_W * (0.35 + 0.65 * w)); const p = P(i, d); row.push({ x: p.x, y: p.y, h: h * (0.25 + 0.75 * w) + 0.002, u: t, v: s }); }
        rows.push(row);
      }
      geos.push(ribbon(rows));
    }
    W.kerbs = add(mergeGeos(geos), M.kerb);
  }
  // ---------- 砾石缓冲区 ----------
  {
    const geos = [];
    for (const g of T.gravel) {
      const rows = [];
      for (let s = g.s0; s <= g.s1 + 1e-6; s += 2) {
        const i = T.idx(s), bar = g.side > 0 ? T.barrierL(s) : T.barrierR(s);
        const inner = HALF_W + T.GRASS_STRIP, outer = Math.max(inner, bar - 1.1), row = [];
        for (let c = 0; c <= 4; c++) { const d = g.side * (inner + (outer - inner) * c / 4); const p = P(i, d); row.push({ x: p.x, y: p.y, h: -0.012, u: d, v: s }); }
        rows.push(row);
      }
      geos.push(ribbon(rows));
    }
    W.gravel = add(mergeGeos(geos), M.gravel);
  }
  // ---------- 护栏 ----------
  {
    const prof = [[0.0, 0.0], [0.05, 0.05], [0.05, 0.10], [0.012, 0.155], [0.05, 0.21], [0.05, 0.26], [0.0, 0.31]];
    const geos = [], postM = new THREE.Matrix4(), posts = [];
    for (const side of [1, -1]) {
      const pts = [];
      for (let r = 0; r <= N / 2; r++) { const s = r * 2 * ds, i = T.idx(s), bar = side > 0 ? T.barrierL(s) : T.barrierR(s); const p = P(i, side * bar); pts.push({ x: p.x, y: p.y, nx: -hy[i] * side, ny: hx[i] * side, s }); }
      for (const base of [0.22, 0.58]) {
        const rows = [];
        for (const q of pts) { const row = []; for (const [o, h] of prof) row.push({ x: q.x - q.nx * (o + 0.02), y: q.y - q.ny * (o + 0.02), h: base + h, u: q.s, v: h * 3 + base }); rows.push(row); }
        geos.push(ribbon(rows));
      }
      for (let r = 0; r < pts.length - 1; r += 2) posts.push(pts[r]);
    }
    W.armco = add(mergeGeos(geos), M.armco, { cast: true });
    const pg = new THREE.BoxGeometry(0.09, 0.95, 0.13); pg.translate(0, 0.475, 0);
    const pm = new THREE.InstancedMesh(pg, M.post, posts.length);
    posts.forEach((q, k) => { postM.makeRotationY(Math.atan2(q.nx, -q.ny)); postM.setPosition(q.x + q.nx * 0.06, 0, -(q.y + q.ny * 0.06)); pm.setMatrixAt(k, postM); });
    pm.castShadow = true; pm.receiveShadow = true; pm.frustumCulled = false; W.group.add(pm); W.posts = pm;
  }
  // ---------- 轮胎墙（按缓冲区分组，便于视锥剔除）----------
  {
    const R0 = 0.31, w = 0.205;
    const shape = [[0.19, -w / 2], [0.275, -w / 2], [R0, -w * 0.22], [R0, w * 0.22], [0.275, w / 2], [0.19, w / 2], [0.19, -w / 2]].map(p => new THREE.Vector2(p[0], p[1]));
    const tg = new THREE.LatheGeometry(shape, 10); tg.computeVertexNormals();
    const rnd = rng(7), layers = 4, m4 = new THREE.Matrix4(), col = new THREE.Color();
    W.tyres = [];
    for (const g of T.gravel) {
      const spots = []; let acc = 0, prev = null;
      for (let s = g.s0 + 4; s <= g.s1 - 4; s += 0.25) {
        const bar = g.side > 0 ? T.barrierL(s) : T.barrierR(s); if (bar < 12.5) { prev = null; continue; }
        const q = T.offset(s, g.side * (bar - 0.42));
        if (prev) acc += Math.hypot(q.x - prev.x, q.y - prev.y); prev = q;
        if (acc >= 0.635) { acc = 0; spots.push({ x: q.x, y: q.y, k: spots.length }); }
      }
      if (!spots.length) continue;
      const im = new THREE.InstancedMesh(tg, M.tyre, spots.length * layers); let n = 0;
      for (const sp of spots) for (let l = 0; l < layers; l++) {
        const jx = (rnd() - 0.5) * 0.03, jy = (rnd() - 0.5) * 0.03;
        m4.makeRotationY(rnd() * 6.28); m4.setPosition(sp.x + jx, w / 2 + l * (w + 0.004), -(sp.y + jy)); im.setMatrixAt(n, m4);
        const band = Math.floor(sp.k / 7) % 4, painted = band === 0 ? 0xb8b5ac : band === 2 ? 0x8f1512 : 0x0d0d0e;
        col.setHex(painted); col.multiplyScalar(0.8 + rnd() * 0.35); im.setColorAt(n, col); n++;
      }
      im.castShadow = false; im.receiveShadow = true; im.instanceColor.needsUpdate = true; im.computeBoundingSphere(); im.layers.set(1);
      W.group.add(im); W.tyres.push(im);
    }
  }
  // ---------- 广告牌 ----------
  {
    const atlas = makeAdAtlas(), rnd = rng(21);
    const pos = [], uvs = [], idx = [], bpos = [], bidx = [];
    const BW = 5.0, BH = 1.05, Y0 = 0.18;
    for (const side of [1, -1]) {
      let s = 6 + (side > 0 ? 0 : 2.6), brand = 0, run = 0, skip = 0;
      while (s < L - 8) {
        if (run <= 0) { brand = Math.floor(rnd() * atlas.count); run = 3 + Math.floor(rnd() * 3); skip = rnd() < 0.28 ? 2 + Math.floor(rnd() * 4) : 0; }
        if (skip > 0) { skip--; s += BW + 0.25; continue; }
        const bar0 = side > 0 ? T.barrierL(s) : T.barrierR(s), bar1 = side > 0 ? T.barrierL(s + BW) : T.barrierR(s + BW);
        const a = T.offset(s, side * (bar0 + 1.0)), b = T.offset(s + BW, side * (bar1 + 1.0));
        // 面向赛道：左侧护栏外的牌子，从赛道看过去文字要正，所以起止点按侧别交换
        const p0 = side > 0 ? a : b, p1 = side > 0 ? b : a;
        const v0 = pos.length / 3, t0 = brand / atlas.count, t1 = (brand + 1) / atlas.count;
        pos.push(p0.x, Y0, -p0.y, p1.x, Y0, -p1.y, p1.x, Y0 + BH, -p1.y, p0.x, Y0 + BH, -p0.y);
        uvs.push(0, 1 - t1, 1, 1 - t1, 1, 1 - t0, 0, 1 - t0); idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
        // 背板 + 支腿
        const nx = (p1.y - p0.y), ny = -(p1.x - p0.x), nl = Math.hypot(nx, ny), ox = nx / nl * 0.05, oy = ny / nl * 0.05;
        const w0 = bpos.length / 3;
        bpos.push(p0.x + ox, 0, -(p0.y + oy), p1.x + ox, 0, -(p1.y + oy), p1.x + ox, Y0 + BH + 0.03, -(p1.y + oy), p0.x + ox, Y0 + BH + 0.03, -(p0.y + oy));
        bidx.push(w0, w0 + 2, w0 + 1, w0, w0 + 3, w0 + 2);
        s += BW + 0.25; run--;
      }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.MeshStandardNodeMaterial(); m.colorNode = texture(atlas.tex, uv()).rgb.mul(0.86); m.roughnessNode = float(0.5); m.metalnessNode = float(0); m.side = THREE.DoubleSide;
    W.boards = add(g, m, { cast: true });
    const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(bpos, 3)); bg.setIndex(bidx); bg.computeVertexNormals();
    const bm = M.steelDark.clone(); bm.side = THREE.DoubleSide; add(bg, bm, { cast: true });
  }
  // ---------- 起终点线与发车格 ----------
  {
    const quads = [], cols = [];
    const quad = (s0, s1, d0, d1, c) => { const a = T.offset(s0, d0), b = T.offset(s0, d1), e = T.offset(s1, d1), f = T.offset(s1, d0); quads.push([a, b, e, f]); cols.push(c); };
    const white = [0.82, 0.82, 0.78];
    for (let k = 0; k < 22; k++) for (let r = 0; r < 2; r++) quad(-0.5 + r * 0.5, r * 0.5, -HALF_W + k * 0.5, -HALF_W + (k + 1) * 0.5, (k + r) % 2 ? white : [0.02, 0.02, 0.02]);
    for (let n = 0; n < 8; n++) { const g = T.gridSlot(n), s = g.s + 2.3; quad(s, s + 0.14, g.d - 1.25, g.d + 1.25, white); quad(s - 1.4, s, g.d - 1.25, g.d - 1.11, white); quad(s - 1.4, s, g.d + 1.11, g.d + 1.25, white); }
    const pos = [], col = [], idx = [];
    quads.forEach((q, k) => { const v0 = pos.length / 3; for (const p of q) { pos.push(p.x, 0.004, -p.y); col.push(...cols[k]); } idx.push(v0, v0 + 2, v0 + 1, v0, v0 + 3, v0 + 2); });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
    if (g.attributes.normal.array[1] < 0) { const ia = g.index.array; for (let i = 0; i < ia.length; i += 3) { const t = ia[i + 1]; ia[i + 1] = ia[i + 2]; ia[i + 2] = t; } g.computeVertexNormals(); }
    W.paint = add(g, M.paint, { order: 2 });
  }
  // ---------- 起点龙门架 + 发车灯 ----------
  {
    const grp = new THREE.Group(); const c = T.offset(0, 0);
    grp.position.set(c.x, 0, -c.y); grp.rotation.y = c.h + Math.PI / 2;      // 局部 +Z = 赛道前进方向，+X = 左
    const span = 2 * 9.0, Hh = 6.4;
    const box = (w, h, d, x, y, z, mat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; grp.add(m); return m; };
    for (const sx of [-1, 1]) { box(0.32, Hh, 0.32, sx * span / 2, Hh / 2, 0, M.steelDark); box(0.9, 0.25, 0.9, sx * span / 2, 0.125, 0, M.concrete); }
    box(span + 0.32, 0.5, 0.36, 0, Hh, 0, M.steelDark); box(span + 0.32, 0.09, 0.36, 0, Hh - 0.75, 0, M.steelDark);
    for (let k = -8; k <= 8; k++) box(0.06, 0.75, 0.06, k * (span / 17), Hh - 0.37, 0, M.steelDark);
    for (let k = 0; k < 5; k++) {
      const x = (k - 2) * 1.05; box(0.62, 1.05, 0.3, x, Hh - 1.45, 0, M.steelDark);
      const lm = new THREE.MeshStandardNodeMaterial(); lm.colorNode = vec3(0.05, 0.005, 0.005); lm.emissive = new THREE.Color(1, 0.06, 0.02); lm.emissiveIntensity = 0; lm.roughnessNode = float(0.3);
      for (const yy of [Hh - 1.2, Hh - 1.7]) { const s = new THREE.Mesh(new THREE.CircleGeometry(0.17, 20), lm); s.position.set(x, yy, -0.16); s.rotation.y = Math.PI; grp.add(s); }
      W.lights.push(lm);
    }
    W.group.add(grp); W.gantry = grp;
  }
  // ---------- 草丛（按赛段分块，近处才显示）----------
  // 修剪过的草带：一丛 14 片、5–12 cm 高的细草叶，密度约 9 丛/m²；护栏根部和护栏外是没人修的长草
  if (quality.grass > 0) {
    const blades = 16, pos = [], col = [], idx = [], nor = [], r0 = rng(3);
    for (let b = 0; b < blades; b++) {
      const ang = r0() * 6.28, h = 0.055 + r0() * 0.065, lean = (0.15 + r0() * 0.4) * h, rad = Math.sqrt(r0()) * 0.26, pa = r0() * 6.28, ox = Math.cos(pa) * rad, oz = Math.sin(pa) * rad, wv = 0.0048 + r0() * 0.0035;
      const dx = Math.cos(ang), dz = Math.sin(ang), v0 = pos.length / 3;
      const pts = [[-wv, 0, 0], [wv, 0, 0], [-wv * 0.7, h * 0.55, lean * 0.35], [wv * 0.7, h * 0.55, lean * 0.35], [0, h, lean]];
      for (const [a, y, f] of pts) { pos.push(ox + dx * f - dz * a, y, oz + dz * f + dx * a); nor.push(dx * 0.2, 0.96, dz * 0.2); const t = y / h; col.push(0.5 + 0.5 * t, 0.5 + 0.5 * t, 0.5 + 0.42 * t); }
      idx.push(v0, v0 + 1, v0 + 2, v0 + 1, v0 + 3, v0 + 2, v0 + 2, v0 + 3, v0 + 4);
    }
    const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); tg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); tg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); tg.setIndex(idx);
    const gm = soft(new THREE.MeshLambertNodeMaterial()); gm.side = THREE.DoubleSide;
    const ph = hash(instanceIndex).mul(6.28), yy = positionGeometry.y.div(0.1), vc = attribute('color', 'vec3');
    gm.positionNode = positionLocal.add(vec3(sin(time.mul(1.9).add(ph)).mul(yy).mul(yy).mul(0.011), 0, sin(time.mul(1.3).add(ph.mul(1.7))).mul(yy).mul(yy).mul(0.008)));
    const tip = vc.r.sub(0.5).mul(2);
    gm.colorNode = vc.mul(vec3(0.082, 0.126, 0.038)).mul(float(1).add(backlit(3).mul(tip).mul(1.5)));      // 逆光时叶尖被打透发亮
    W.grassMat = gm;
    const CH = 24, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p3 = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), c3 = new THREE.Color();
    const rnd = rng(99);
    for (let s0 = 0; s0 < L; s0 += CH) {
      const list = [];
      for (const side of [1, -1]) for (let s = s0; s < Math.min(L, s0 + CH); s += 0.5) {
        const i = T.idx(s), bit = side > 0 ? 1 : 2, bar = side > 0 ? T.barrierL(s) : T.barrierR(s);
        const kerb = (T.kerbMask[i] & bit) ? T.KERB_W : 0, grav = (T.gravelMask[i] & bit) && bar > 12.5;
        const d0 = HALF_W + kerb + 0.1, d1 = grav ? HALF_W + T.GRASS_STRIP + 0.3 : bar - 0.2;
        const n1 = Math.round((d1 - d0) * 4.5 * quality.grass);
        for (let k = 0; k < n1; k++) { const d = d0 + rnd() * (d1 - d0); list.push([s + rnd() * 0.5, side * d, !grav && bar - d < 0.55 ? 1 : 0]); }
        const n2 = Math.round(8 * quality.grass);                     // 护栏外侧没人修的一条
        for (let k = 0; k < n2; k++) list.push([s + rnd() * 0.5, side * (bar + 0.3 + rnd() * rnd() * 7), 2]);
      }
      for (let k = list.length - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); const t = list[k]; list[k] = list[j]; list[j] = t; }   // 打乱顺序：远处只画前一部分也能均匀变稀
      const im = new THREE.InstancedMesh(tg, gm, list.length);
      list.forEach(([s, d, kind], k) => {
        const p = T.offset(s, d), sx = kind ? 1.0 + rnd() * 0.5 : 0.7 + rnd() * 0.6, sy = kind === 1 ? 2.2 + rnd() * 2.6 : kind === 2 ? 1.2 + rnd() * rnd() * 3.2 : sx * (0.75 + rnd() * 0.5);
        q.setFromAxisAngle(up, rnd() * 6.28); sc.set(sx, sy, sx); p3.set(p.x, -0.025, -p.y); m4.compose(p3, q, sc); im.setMatrixAt(k, m4);
        const v = (0.78 + rnd() * 0.44) * (kind ? 1 : (Math.floor(Math.abs(d) / 2.2) % 2 ? 1.07 : 0.93)), dry = kind ? rnd() * 0.5 : rnd() * rnd() * 0.3;      // 长草偏黄
        c3.setRGB(v * (0.92 + dry * 0.7), v * (1 + dry * 0.25), v * (0.85 - dry * 0.3)); im.setColorAt(k, c3);
      });
      im.instanceColor.needsUpdate = true; im.receiveShadow = true; im.castShadow = false; im.layers.set(3);      // 第 3 层：不进倒影，也不参与环境光遮蔽（细草叶会把草皮压得发黑）
      const mid = T.offset(s0 + CH / 2, 0); im.userData.cx = mid.x; im.userData.cz = -mid.y; im.userData.n = list.length; im.frustumCulled = false;
      W.group.add(im); W.grassChunks.push(im);
    }
  }
  // ---------- 树的位置（网格在 trees.js 里实例化）----------
  {
    const rnd = rng(1234), b = T.bounds, pad = 150, cell = 12.5;
    for (let gx = b.minx - pad; gx < b.maxx + pad; gx += cell) for (let gy = b.miny - pad; gy < b.maxy + pad; gy += cell) {
      const x = gx + rnd() * cell, y = gy + rnd() * cell;
      const tc = T.toTrack(x, y, -1); const bar = tc.d > 0 ? T.dL[tc.i] : T.dR[tc.i];
      const out = Math.abs(tc.d) - bar; if (out < 7.5) continue;
      const cluster = Math.sin(x * 0.021 + 1.3) * Math.sin(y * 0.027 + 0.4) + Math.sin(x * 0.007 - y * 0.011) * 0.6;
      const belt = out < 32 ? 0.62 : 0;                               // 护栏后面的树带更密
      if (rnd() > 0.28 + cluster * 0.3 + belt) continue;
      W.treeSpots.push({ x, y, s: 0.75 + rnd() * 0.6, rot: rnd() * 6.28, kind: rnd(), tone: 0.8 + rnd() * 0.35, out });
    }
  }

  // 每帧：草丛分块显隐
  W.update = (cam) => {
    const R = quality.grassDist;
    for (const c of W.grassChunks) {
      const d = Math.hypot(c.userData.cx - cam.position.x, c.userData.cz - cam.position.z);
      c.visible = d < R; if (c.visible) c.count = Math.max(1, Math.round(c.userData.n * (d < R * 0.42 ? 1 : d < R * 0.7 ? 0.55 : 0.28)));     // 越远越稀
    }
  };
  return W;
}
