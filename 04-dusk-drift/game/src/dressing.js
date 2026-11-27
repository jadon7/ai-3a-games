// 场边设施：维修区建筑、看台、照明灯柱、防护网、刹车距离牌。只是布景，不参与碰撞
// 局部坐标约定（和龙门架一致）：+Z = 赛道前进方向，+X = 赛道左侧
import * as THREE from 'three/webgpu';
import { texture, uv, vec3, vec4, float, mrt } from 'three/tsl';
import { HALF_W } from './track.js';
import { rng } from './world.js';

const BRANDS = ['KESTREL', 'NORDWIND', 'VELOCE', 'HALDEN', 'ORBIT', 'DASHI', 'MERIDIAN', 'CORSA 76'];

export function buildDressing(T, M, scene, W, quality) {
  const grp = new THREE.Group(); scene.add(grp);
  const L = T.L, wrap = s => ((s % L) + L) % L, rnd = rng(4242);
  const frame = (s, d) => { const p = T.offset(wrap(s), d); return { x: p.x, z: -p.y, ry: p.h + Math.PI / 2 }; };
  const place = (obj, s, d, yaw = 0) => { const f = frame(s, d); obj.position.set(f.x, 0, f.z); obj.rotation.y = f.ry + yaw; grp.add(obj); return obj; };
  const box = (parent, w, h, dp, mat, x, y, z, cast = true) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, dp), mat); m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = true; parent.add(m); return m; };
  const canvasTex = (w, h, draw, srgb = true) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8; return t; };
  const bar = (s, side) => side > 0 ? T.barrierL(wrap(s)) : T.barrierR(wrap(s));
  const zones = [];        // 这些范围内不种树：{ s0, s1, side, out }

  // ---------- 维修区建筑（发车直道右侧）----------
  {
    const len = 112, dep = 10, hgt = 7.6, sC = 78, side = -1, b = bar(sC, side), g = new THREE.Group();
    const bays = 16, bw = len / bays;
    // 门洞开合、哪些窗亮着：先定好一份数据，颜色贴图和发光贴图都按它画，才对得上
    const r = rng(77), data = [];
    for (let k = 0; k < bays; k++) data.push({ open: r() < 0.55 ? 0.35 + r() * 0.5 : 0, glow: 0.05 + r() * 0.09, wins: [0, 1, 2, 3].map(() => ({ on: r() < 0.78, a: 0.55 + r() * 0.45, g: 200 + Math.round(r() * 30), b: 140 + Math.round(r() * 40) })) });
    const face = (g2, w, h, lit) => {
      if (!lit) { g2.fillStyle = '#8f8d88'; g2.fillRect(0, 0, w, h); for (let i = 0; i < 900; i++) { const v = rnd() < 0.5 ? 0 : 255; g2.fillStyle = `rgba(${v},${v},${v},${0.02 + rnd() * 0.03})`; g2.fillRect(rnd() * w, rnd() * h, 8 + rnd() * 90, 2 + rnd() * 26); } }
      else { g2.fillStyle = '#000'; g2.fillRect(0, 0, w, h); }
      const pw = w / bays, y1 = h * 0.50, y2 = h * 0.94;                         // 一层车库门：y1..y2；二层窗带：h*0.16..h*0.40
      data.forEach((d, k) => {
        const x0 = k * pw + pw * 0.10, ww = pw * 0.80, open = d.open;
        if (!lit) {
          g2.fillStyle = '#b9b6ae'; g2.fillRect(x0, y1, ww, y2 - y1);              // 卷帘门
          g2.strokeStyle = 'rgba(0,0,0,0.25)'; g2.lineWidth = 1; for (let yy = y1; yy < y2; yy += 6) { g2.beginPath(); g2.moveTo(x0, yy); g2.lineTo(x0 + ww, yy); g2.stroke(); }
          g2.fillStyle = '#0c0d10'; g2.fillRect(x0, y2 - (y2 - y1) * open, ww, (y2 - y1) * open);   // 半开的门洞
          g2.fillStyle = '#16181c'; g2.font = `700 ${Math.round(h * 0.07)}px Helvetica, Arial, sans-serif`; g2.textAlign = 'center'; g2.fillText(String(k + 1).padStart(2, '0'), x0 + ww / 2, y1 - h * 0.025);
        } else if (open > 0) { g2.fillStyle = `rgba(255,214,160,${d.glow})`; g2.fillRect(x0, y2 - (y2 - y1) * open, ww, (y2 - y1) * open * 0.6); }      // 车库里透出的灯光
        const wy = h * 0.16, wh = h * 0.24;
        d.wins.forEach((wn, j) => {
          const wx = k * pw + pw * (0.06 + j * 0.225), w2 = pw * 0.2;
          if (!lit) { g2.fillStyle = '#1a2026'; g2.fillRect(wx, wy, w2, wh); }
          else if (wn.on) { g2.fillStyle = `rgba(255,${wn.g},${wn.b},${wn.a})`; g2.fillRect(wx, wy, w2, wh); }
        });
      });
      if (!lit) {                                                              // 顶部的赞助商横幅
        g2.fillStyle = '#14324d'; g2.fillRect(0, 0, w, h * 0.105);
        g2.fillStyle = '#f1efe9'; g2.font = `800 ${Math.round(h * 0.078)}px Helvetica, Arial, sans-serif`; g2.textAlign = 'center';
        for (let k = 0; k < 8; k++) g2.fillText(BRANDS[(k * 3) % BRANDS.length].split('').join(' '), (k + 0.5) * w / 8, h * 0.082);
      }
    };
    const mat = new THREE.MeshStandardNodeMaterial();
    const tA = canvasTex(4096, 288, (g2, w, h) => face(g2, w, h, false));
    const tB = canvasTex(4096, 288, (g2, w, h) => face(g2, w, h, true));
    mat.colorNode = texture(tA, uv()).rgb.mul(0.8); mat.emissiveNode = texture(tB, uv()).rgb.mul(2.6); mat.roughnessNode = float(0.75); mat.metalnessNode = float(0);
    box(g, dep, hgt, len, M.concrete, 0, hgt / 2, 0);
    box(g, dep + 1.6, 0.3, len + 1.2, M.steelDark, 0.4, hgt + 0.15, 0);
    const fp = new THREE.Mesh(new THREE.PlaneGeometry(len, hgt), mat); fp.rotation.y = Math.PI / 2; fp.position.set(dep / 2 + 0.03, hgt / 2, 0); fp.receiveShadow = true; g.add(fp);
    place(g, sC, side * (b + 7 + dep / 2));
    zones.push({ s0: sC - len / 2 - 8, s1: sC + len / 2 + 8, side, out: 30 });
  }

  // ---------- 看台（发车直道左侧）----------
  {
    const len = 96, sC = 92, side = 1, b = bar(sC, side), g = new THREE.Group(), rows = 9;
    for (let k = 0; k < rows; k++) box(g, 0.96, 0.46 * (k + 1), len, M.concrete, -4 + k * 0.95, 0.23 * (k + 1), 0, k === rows - 1);
    box(g, 0.3, 7.4, len, M.concrete, 4.75, 3.7, 0);
    const roof = box(g, 10.6, 0.22, len + 2, M.steelDark, 0.2, 7.9, 0); roof.rotation.z = -0.08;
    for (let z = -len / 2 + 2; z <= len / 2 - 2; z += (len - 4) / 8) box(g, 0.22, 7.6, 0.22, M.steelDark, -4.3, 3.8, z);
    // 观众：每排台阶上立一条带透明底的"人像带"，面朝赛道；每排错开一点，避免整齐得像贴纸
    const crowd = canvasTex(2048, 128, (g2, w, h) => {
      g2.clearRect(0, 0, w, h);
      const pal = ['#b9b4a8', '#7d1d1a', '#1d3a7c', '#b8901a', '#2b2d33', '#d6d2c8', '#35603f', '#9c4d27', '#626b78', '#1b1c20', '#4a4f58', '#8a8f96'], skin = ['#c9a184', '#a97c5f', '#e0bfa3', '#7b563f'];
      const r = rng(9);
      for (let x = 14; x < w - 14; x += 24 + r() * 8) {
        if (r() < 0.2) { x += 10; continue; }
        const bw = 17 + r() * 6, bh = 62 + r() * 16, sit = h - bh;
        g2.fillStyle = pal[Math.floor(r() * pal.length)]; g2.beginPath(); g2.roundRect(x - bw / 2, sit + 22, bw, bh, 6); g2.fill();
        g2.fillStyle = skin[Math.floor(r() * skin.length)]; g2.beginPath(); g2.arc(x, sit + 13, 9.5, 0, 6.3); g2.fill();
        if (r() < 0.3) { g2.fillStyle = pal[Math.floor(r() * pal.length)]; g2.fillRect(x - 10, sit + 2, 20, 8); }      // 帽子
      }
    });
    crowd.wrapS = THREE.RepeatWrapping;
    const cm = new THREE.MeshStandardNodeMaterial(); const ct = texture(crowd, uv());
    cm.colorNode = ct.rgb.mul(0.8); cm.opacityNode = ct.a; cm.alphaTest = 0.5; cm.roughnessNode = float(0.9); cm.metalnessNode = float(0); cm.side = THREE.DoubleSide;
    const cp = [], cu = [], ci = [], rep = len / 9.5, r2 = rng(31);
    for (let k = 0; k < rows; k++) {
      const x = -4 + k * 0.95 - 0.1, y0 = 0.46 * (k + 1), y1 = y0 + 0.78, off = r2() * 3, v0 = cp.length / 3;
      cp.push(x, y0, -len / 2, x, y0, len / 2, x, y1, len / 2, x, y1, -len / 2); cu.push(off, 0, off + rep, 0, off + rep, 1, off, 1); ci.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3);
    }
    const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3)); cg.setAttribute('uv', new THREE.Float32BufferAttribute(cu, 2)); cg.setIndex(ci); cg.computeVertexNormals();
    const cmesh = new THREE.Mesh(cg, cm); cmesh.receiveShadow = true; g.add(cmesh);
    place(g, sC, side * (b + 5.5 + 4.5));
    zones.push({ s0: sC - len / 2 - 8, s1: sC + len / 2 + 8, side, out: 26 });
  }

  // ---------- 照明灯柱：黄昏时已经亮着，辉光会把灯头晕开 ----------
  {
    const pole = new THREE.CylinderGeometry(0.13, 0.2, 16.6, 8); pole.translate(0, 8.3, 0);
    const head = new THREE.BoxGeometry(2.9, 1.5, 0.34); head.rotateX(0.5); head.translate(0, 16.7, 0.3);
    const armG = new THREE.BoxGeometry(0.14, 0.14, 1.1); armG.translate(0, 16.5, -0.1);
    const merge = (list) => { let nv = 0, ni = 0; for (const q of list) { nv += q.attributes.position.count; ni += q.index.count; } const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3), I = new Uint32Array(ni); let vo = 0, io = 0; for (const q of list) { P.set(q.attributes.position.array, vo * 3); N.set(q.attributes.normal.array, vo * 3); for (let i = 0; i < q.index.count; i++) I[io + i] = q.index.array[i] + vo; vo += q.attributes.position.count; io += q.index.count; } const o = new THREE.BufferGeometry(); o.setAttribute('position', new THREE.BufferAttribute(P, 3)); o.setAttribute('normal', new THREE.BufferAttribute(N, 3)); o.setIndex(new THREE.BufferAttribute(I, 1)); return o; };
    const body = merge([pole, head, armG]);
    const panel = new THREE.PlaneGeometry(2.7, 1.3); panel.translate(0, 0, 0.18); panel.rotateX(0.5); panel.translate(0, 16.7, 0.3);
    const lampM = new THREE.MeshBasicNodeMaterial(); lampM.colorNode = vec3(1.0, 0.92, 0.78).mul(15);
    const spots = [];
    for (let s = 30, k = 0; s < L - 20; s += 92, k++) { const side = k % 2 ? 1 : -1; if (zones.some(z => z.side === side && s > z.s0 && s < z.s1)) continue; spots.push([s, side]); }
    const im = new THREE.InstancedMesh(body, M.steelDark, spots.length), ip = new THREE.InstancedMesh(panel, lampM, spots.length), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), p3 = new THREE.Vector3();
    spots.forEach(([s, side], k) => { const f = frame(s, side * (bar(s, side) + 6.5)); q.setFromAxisAngle(up, f.ry - side * Math.PI / 2); p3.set(f.x, 0, f.z); m4.compose(p3, q, one); im.setMatrixAt(k, m4); ip.setMatrixAt(k, m4); });
    im.castShadow = false; im.receiveShadow = false; im.frustumCulled = false; ip.frustumCulled = false; grp.add(im); grp.add(ip);
  }

  // ---------- 防护网（发车直道两侧，护栏后面）----------
  {
    const mesh = canvasTex(64, 64, (g2, w, h) => { g2.clearRect(0, 0, w, h); g2.strokeStyle = '#fff'; g2.lineWidth = 3.2; for (let k = -1; k <= 2; k++) { g2.beginPath(); g2.moveTo(k * w, 0); g2.lineTo((k + 1) * w, h); g2.stroke(); g2.beginPath(); g2.moveTo((k + 1) * w, 0); g2.lineTo(k * w, h); g2.stroke(); } }, false);
    mesh.wrapS = mesh.wrapT = THREE.RepeatWrapping;
    const fm = new THREE.MeshBasicNodeMaterial(); fm.transparent = true; fm.depthWrite = false; fm.side = THREE.DoubleSide;
    fm.colorNode = vec3(0.13, 0.135, 0.14); fm.opacityNode = texture(mesh, uv()).a.mul(0.62); fm.mrtNode = mrt({ velocity: vec4(0, 0, 0, 0) });
    const pos = [], uvs = [], idx = [], posts = [];
    for (const side of [1, -1]) {
      let prev = null, acc = 0;
      for (let s = L - 96; s <= L + 204; s += 4) {
        const f = frame(s, side * (bar(s, side) + 0.6));
        if (prev) { acc += Math.hypot(f.x - prev.x, f.z - prev.z); const v0 = pos.length / 3; pos.push(prev.x, 0.35, prev.z, f.x, 0.35, f.z, f.x, 3.5, f.z, prev.x, 3.5, prev.z); const u0 = (acc - 4) / 0.36, u1 = acc / 0.36; uvs.push(u0, 0.97, u1, 0.97, u1, 9.72, u0, 9.72); idx.push(v0, v0 + 1, v0 + 2, v0, v0 + 2, v0 + 3); }
        posts.push(f); prev = f;
      }
    }
    const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); fg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); fg.setIndex(idx);
    const fence = new THREE.Mesh(fg, fm); fence.layers.set(1); fence.renderOrder = 1; fence.frustumCulled = false; grp.add(fence);
    const pg = new THREE.CylinderGeometry(0.045, 0.045, 3.7, 6); pg.translate(0, 1.85, 0);
    const pim = new THREE.InstancedMesh(pg, M.post, posts.length), m4 = new THREE.Matrix4();
    posts.forEach((f, k) => { m4.makeTranslation(f.x, 0, f.z); pim.setMatrixAt(k, m4); }); pim.castShadow = false; pim.frustumCulled = false; grp.add(pim);
  }

  // ---------- 刹车距离牌（一号弯、发卡弯前）----------
  {
    const nums = ['150', '100', '50'];
    const atlas = canvasTex(768, 300, (g2, w, h) => { nums.forEach((n, k) => { g2.fillStyle = '#ece9df'; g2.fillRect(k * 256 + 6, 6, 244, h - 12); g2.fillStyle = '#111'; g2.font = '900 150px Helvetica, Arial, sans-serif'; g2.textAlign = 'center'; g2.textBaseline = 'middle'; g2.fillText(n, k * 256 + 128, h / 2 + 8, 220); }); });
    const bm = new THREE.MeshStandardNodeMaterial(); bm.colorNode = texture(atlas, uv()).rgb.mul(0.85); bm.roughnessNode = float(0.6); bm.metalnessNode = float(0);
    const corners = [];
    for (const r of (T.ranges || [])) if (r && (r.name || '').match(/T1|T6/)) corners.push(r);
    for (const r of corners) nums.forEach((n, k) => {
      const s = r.s0 - (+n), side = (r.ang ?? -1) < 0 ? 1 : -1, b = bar(s, side); if (b - HALF_W < 2.4) return;
      const g = new THREE.Group(), pg = new THREE.PlaneGeometry(0.95, 1.1), u = pg.attributes.uv; for (let i = 0; i < u.count; i++) u.setX(i, (k + u.getX(i)) / 3);
      const pl = new THREE.Mesh(pg, bm); pl.rotation.y = Math.PI; pl.position.set(0, 1.05, 0); pl.castShadow = true; g.add(pl);
      box(g, 0.05, 0.6, 0.05, M.post, 0, 0.3, 0.02);
      place(g, s, side * (HALF_W + 1.7));
    });
  }

  // 建筑范围内不种树
  W.treeSpots = W.treeSpots.filter(t => {
    const tc = T.toTrack(t.x, t.y, -1), s = tc.i * T.ds, side = tc.d > 0 ? 1 : -1;
    return !zones.some(z => z.side === side && s > z.s0 && s < z.s1 && t.out < z.out);
  });
  return { group: grp, zones };
}
