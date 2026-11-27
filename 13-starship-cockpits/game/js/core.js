// Shared render core: procedural PBR maps, cockpit hardware builders, lens/post pipeline.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { TexturePass } from 'three/addons/postprocessing/TexturePass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export { THREE, mergeGeometries };
export const PI = Math.PI, TAU = PI * 2;
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ textures */
const _cache = new Map();
export function cached(key, fn) { if (!_cache.has(key)) _cache.set(key, fn()); return _cache.get(key); }
export function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = Math.round(w); c.height = Math.round(h); return c; }

export function fbm(size, { oct = 5, base = 4, seed = 1, pers = 0.5 } = {}) {
  const out = new Float32Array(size * size), r = rng(seed);
  let amp = 1, tot = 0;
  for (let o = 0; o < oct; o++) {
    const n = base << o; if (n > size) break;
    const grid = new Float32Array(n * n); for (let i = 0; i < n * n; i++) grid[i] = r();
    const s = n / size;
    for (let y = 0; y < size; y++) {
      const fy = y * s, y0 = fy | 0, ty = fy - y0, y1 = (y0 + 1) % n, sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < size; x++) {
        const fx = x * s, x0 = fx | 0, tx = fx - x0, x1 = (x0 + 1) % n, sx = tx * tx * (3 - 2 * tx);
        const a = grid[y0 * n + x0], b = grid[y0 * n + x1], c = grid[y1 * n + x0], d = grid[y1 * n + x1];
        out[y * size + x] += amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy);
      }
    }
    tot += amp; amp *= pers;
  }
  for (let i = 0; i < out.length; i++) out[i] /= tot;
  return out;
}

function setupTex(t, { srgb = false, rep = 1, aniso = 8, clampEdge = false } = {}) {
  t.wrapS = t.wrapT = clampEdge ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.repeat.set(rep, rep);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso; t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}
export function grayTex(arr, size, opt) {
  const d = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) { const v = clamp(arr[i]) * 255; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
  return setupTex(new THREE.DataTexture(d, size, size), opt);
}
export function normalTex(h, size, strength = 1, opt) {
  const d = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const l = h[y * size + ((x - 1 + size) % size)], r = h[y * size + ((x + 1) % size)];
    const u = h[((y - 1 + size) % size) * size + x], dn = h[((y + 1) % size) * size + x];
    let nx = (l - r) * strength, ny = (u - dn) * strength, nz = 1;
    const inv = 1 / Math.hypot(nx, ny, nz); nx *= inv; ny *= inv; nz *= inv;
    const i = (y * size + x) * 4;
    d[i] = (nx * 0.5 + 0.5) * 255; d[i + 1] = (ny * 0.5 + 0.5) * 255; d[i + 2] = (nz * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  return setupTex(new THREE.DataTexture(d, size, size), opt);
}
export function canvasTex(c, opt = {}) { return setupTex(new THREE.CanvasTexture(c), { clampEdge: true, srgb: true, ...opt }); }
export function rep(tex, rx, ry = rx) { const t = tex.clone(); t.repeat.set(rx, ry); t.needsUpdate = true; return t; }

function scratchField(S, n, seed, { len = [0.02, 0.25], alpha = [0.1, 0.6], width = 1 } = {}) {
  const c = mkCanvas(S, S), g = c.getContext('2d'), r = rng(seed);
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S); g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const x = r() * S, y = r() * S, a = r() * TAU, L = S * lerp(len[0], len[1], r() * r()), bend = (r() - 0.5) * 0.3;
    g.strokeStyle = `rgba(255,255,255,${lerp(alpha[0], alpha[1], r())})`; g.lineWidth = width * (0.5 + r());
    g.beginPath(); g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(a) * L / 2 + Math.sin(a) * L * bend, y + Math.sin(a) * L / 2 - Math.cos(a) * L * bend, x + Math.cos(a) * L, y + Math.sin(a) * L);
    g.stroke();
  }
  const d = g.getImageData(0, 0, S, S).data, o = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) o[i] = d[i * 4] / 255;
  return o;
}

export const Maps = {
  // matte base, rubbed/shiny patches and scratches (multiplies material roughness)
  roughWorn: (seed = 3) => cached('rw' + seed, () => {
    const S = 512, a = fbm(S, { oct: 6, base: 4, seed }), b = fbm(S, { oct: 2, base: 128, seed: seed + 9 }), sc = scratchField(S, 260, seed + 1);
    const o = new Float32Array(S * S);
    for (let i = 0; i < o.length; i++) o[i] = clamp(0.78 + (a[i] - 0.5) * 0.9 + (b[i] - 0.5) * 0.2 - sc[i] * 0.45, 0.18, 1);
    return grayTex(o, S);
  }),
  // glossy base, smudges and scratches make it rougher
  roughGloss: (seed = 5) => cached('rg' + seed, () => {
    const S = 512, a = fbm(S, { oct: 5, base: 3, seed }), sc = scratchField(S, 420, seed + 1, { alpha: [0.15, 0.9] });
    const o = new Float32Array(S * S);
    for (let i = 0; i < o.length; i++) { const p = clamp((a[i] - 0.45) * 3); o[i] = clamp(0.35 + p * p * 0.45 + sc[i] * 0.6, 0, 1); }
    return grayTex(o, S);
  }),
  micro: (strength = 2.2) => cached('mi' + strength, () => normalTex(fbm(512, { oct: 2, base: 128, seed: 11, pers: 0.6 }), 512, strength)),
  peel: (strength = 3) => cached('pe' + strength, () => normalTex(fbm(512, { oct: 3, base: 40, seed: 12, pers: 0.45 }), 512, strength)),
  grainN: (strength = 3) => cached('gn' + strength, () => normalTex(fbm(512, { oct: 1, base: 256, seed: 13 }), 512, strength)),
  scratchN: (seed = 21) => cached('sn' + seed, () => normalTex(scratchField(1024, 520, seed, { alpha: [0.2, 1] }), 1024, 2.2)),
  brushed: () => cached('br', () => {
    const S = 512, N = 6, r = rng(31), g = new Float32Array(N * S), h = new Float32Array(S * S);
    for (let i = 0; i < g.length; i++) g[i] = r();
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const fx = x / S * N, x0 = fx | 0, t = fx - x0, x1 = (x0 + 1) % N, s = t * t * (3 - 2 * t);
      h[y * S + x] = g[y * N + x0] + (g[y * N + x1] - g[y * N + x0]) * s;
    }
    const ro = new Float32Array(S * S); for (let i = 0; i < ro.length; i++) ro[i] = 0.55 + 0.45 * h[i];
    return { rough: grayTex(ro, S), normal: normalTex(h, S, 0.9) };
  }),
  // albedo multiplier: blotches, speckle, vertical drips
  grime: (seed = 41, amt = 0.5) => cached('gr' + seed + amt, () => {
    const S = 1024, c = mkCanvas(S, S), g = c.getContext('2d'), r = rng(seed);
    const a = fbm(S, { oct: 6, base: 3, seed }), b = fbm(S, { oct: 3, base: 96, seed: seed + 5 });
    const id = g.createImageData(S, S);
    for (let i = 0; i < S * S; i++) {
      const p = clamp((a[i] - 0.38) * 2.2); const v = 255 * clamp(1 - amt * (1 - p) * 0.75 - amt * (b[i] - 0.5) * 0.35);
      id.data[i * 4] = v; id.data[i * 4 + 1] = v * 0.99; id.data[i * 4 + 2] = v * 0.97; id.data[i * 4 + 3] = 255;
    }
    g.putImageData(id, 0, 0);
    for (let i = 0; i < 900 * amt; i++) { g.fillStyle = `rgba(20,16,12,${r() * 0.35})`; g.beginPath(); g.arc(r() * S, r() * S, r() * r() * 3 + 0.4, 0, TAU); g.fill(); }
    for (let i = 0; i < 60 * amt; i++) { const x = r() * S, y = r() * S, L = 20 + r() * 160; const gr = g.createLinearGradient(0, y, 0, y + L); gr.addColorStop(0, `rgba(15,12,10,${0.05 + r() * 0.18})`); gr.addColorStop(1, 'rgba(15,12,10,0)'); g.fillStyle = gr; g.fillRect(x, y, 1 + r() * 4, L); }
    return setupTex(new THREE.CanvasTexture(c), { srgb: true });
  }),
  smudge: (seed = 51) => cached('sm' + seed, () => {
    const S = 512, a = fbm(S, { oct: 5, base: 3, seed }), sc = scratchField(S, 160, seed + 3, { alpha: [0.1, 0.7], len: [0.02, 0.4] }), r = rng(seed + 8);
    const o = new Float32Array(S * S);
    for (let i = 0; i < o.length; i++) { const p = clamp((a[i] - 0.5) * 3.2); o[i] = clamp(0.1 + p * p * 0.75 + sc[i] * 0.8); }
    for (let i = 0; i < 500; i++) o[(r() * S * S) | 0] = 1;
    return grayTex(o, S);
  }),
  drops: (seed = 61) => cached('dr' + seed, () => {
    const S = 1024, h = new Float32Array(S * S), r = rng(seed);
    const add = (cx, cy, rad, sy = 1) => {
      const ry = rad * sy;
      for (let y = Math.floor(cy - ry); y <= cy + ry; y++) for (let x = Math.floor(cx - rad); x <= cx + rad; x++) {
        const d2 = ((x - cx) / rad) ** 2 + ((y - cy) / ry) ** 2; if (d2 >= 1) continue;
        const i = ((y + S) % S) * S + ((x + S) % S); h[i] = Math.max(h[i], rad * 0.11 * Math.sqrt(1 - d2));
      }
    };
    for (let i = 0; i < 1500; i++) add(r() * S, r() * S, 1.2 + r() * 2.4);
    for (let i = 0; i < 260; i++) add(r() * S, r() * S, 3.5 + r() * 5, 1 + r() * 0.3);
    for (let i = 0; i < 46; i++) add(r() * S, r() * S, 8 + r() * 8, 1 + r() * 0.5);
    const ro = new Float32Array(S * S); for (let i = 0; i < ro.length; i++) ro[i] = h[i] > 0 ? 0.08 : 1;
    return { normal: normalTex(h, S, 7), rough: grayTex(ro, S) };
  }),
  knurl: () => cached('kn', () => {
    const S = 64, h = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) h[y * S + x] = Math.abs(((x / S * 4) % 1) - 0.5) * 2;
    return normalTex(h, S, 6);
  }),
};

/* ------------------------------------------------------------------ canvas drawing helpers */
const SEG = { '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcfgd', '-': 'g', ' ': '', 'E': 'afged', 'H': 'fegbc', 'L': 'fed', 'P': 'abgfe', 'C': 'afed', 'A': 'abcefg', 'F': 'afge', 'o': 'gcde', 'r': 'eg', 'n': 'egc', 'd': 'bcdeg', 'b': 'cdefg', 'U': 'bcdef', 't': 'defg' };
const SEGP = { a: [0, 0, 1, 0], b: [1, 0, 1, .5], c: [1, .5, 1, 1], d: [0, 1, 1, 1], e: [0, .5, 0, 1], f: [0, 0, 0, .5], g: [0, .5, 1, .5] };
export function seg7Width(str, h, gap = 0.26) { let w = 0; for (const ch of str) w += (ch === ':' || ch === '.') ? h * 0.22 : h * (0.5 + gap); return w - h * gap; }
export function seg7(g, str, x, y, h, { color = '#fff', off = null, thick = 0.12, skew = -0.07, gap = 0.26, glow = 0, align = 'left' } = {}) {
  const w = h * 0.5, t = h * thick, total = seg7Width(str, h, gap);
  if (align === 'center') x -= total / 2; else if (align === 'right') x -= total;
  g.save(); g.transform(1, 0, skew, 1, x - skew * (y + h / 2), y);
  const seg = (s, col) => {
    const [x0, y0, x1, y1] = SEGP[s]; const ax = x0 * w, ay = y0 * h, bx = x1 * w, by = y1 * h, hz = ay === by, k = t * 0.55, e = t * 0.18;
    g.fillStyle = col; g.beginPath();
    if (hz) { g.moveTo(ax + e, ay); g.lineTo(ax + k + e, ay - t / 2); g.lineTo(bx - k - e, ay - t / 2); g.lineTo(bx - e, ay); g.lineTo(bx - k - e, ay + t / 2); g.lineTo(ax + k + e, ay + t / 2); }
    else { g.moveTo(ax, ay + e); g.lineTo(ax + t / 2, ay + k + e); g.lineTo(ax + t / 2, by - k - e); g.lineTo(ax, by - e); g.lineTo(ax - t / 2, by - k - e); g.lineTo(ax - t / 2, ay + k + e); }
    g.closePath(); g.fill();
  };
  let cx = 0;
  for (const ch of str) {
    if (ch === ':' || ch === '.') {
      g.fillStyle = color; if (glow) { g.shadowColor = color; g.shadowBlur = glow; }
      if (ch === ':') { g.fillRect(cx - t * 0.1, h * 0.28, t, t); g.fillRect(cx - t * 0.1, h * 0.68, t, t); } else g.fillRect(cx - t * 0.1, h - t * 0.5, t, t);
      g.shadowBlur = 0; cx += h * 0.22; continue;
    }
    g.save(); g.translate(cx, 0);
    if (off) for (const s of 'abcdefg') seg(s, off);
    if (glow) { g.shadowColor = color; g.shadowBlur = glow; }
    for (const s of (SEG[ch] || '')) seg(s, color);
    g.restore(); cx += h * (0.5 + gap);
  }
  g.restore();
}
export function glow(g, color, blur, fn) { g.save(); g.shadowColor = color; g.shadowBlur = blur; fn(); g.restore(); }
// ticks around a dial; angles in degrees, math convention (0=+x, CCW), canvas y is flipped inside
export function ticks(g, cx, cy, r0, r1, a0, a1, n, { w = 2, color = '#fff' } = {}) {
  g.strokeStyle = color; g.lineWidth = w; g.beginPath();
  for (let i = 0; i <= n; i++) { const a = (a0 + (a1 - a0) * i / n) * PI / 180, c = Math.cos(a), s = -Math.sin(a); g.moveTo(cx + c * r0, cy + s * r0); g.lineTo(cx + c * r1, cy + s * r1); }
  g.stroke();
}
export function arc(g, cx, cy, r, a0, a1, { w = 2, color = '#fff', dash = null, cap = 'butt' } = {}) {
  g.strokeStyle = color; g.lineWidth = w; g.lineCap = cap; if (dash) g.setLineDash(dash);
  g.beginPath(); g.arc(cx, cy, r, -a0 * PI / 180, -a1 * PI / 180, a1 > a0); g.stroke(); g.setLineDash([]);
}
export function dialNums(g, cx, cy, r, a0, a1, vals, font, color = '#fff') {
  g.font = font; g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
  vals.forEach((v, i) => { const a = (a0 + (a1 - a0) * i / (vals.length - 1)) * PI / 180; g.fillText(String(v), cx + Math.cos(a) * r, cy - Math.sin(a) * r); });
}
export function microText(g, x, y, w, rows, r, color, lh = 7) {
  g.fillStyle = color;
  for (let j = 0; j < rows; j++) { let cx = x; while (cx < x + w * (0.5 + r() * 0.5)) { const l = 3 + r() * 16; g.fillRect(cx, y + j * lh, l, 2); cx += l + 3; } }
}
// erode painted markings: destination-out specks and scuffs
export function wear(g, W, H, amount = 0.3, seed = 1) {
  const r = rng(seed); g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'destination-out';
  const n = W * H / 900 * amount;
  for (let i = 0; i < n; i++) { g.globalAlpha = r() * 0.9; g.beginPath(); g.arc(r() * W, r() * H, r() * r() * 2.6 + 0.3, 0, TAU); g.fill(); }
  g.lineCap = 'round';
  for (let i = 0; i < n / 14; i++) { g.globalAlpha = r() * 0.5; g.lineWidth = 0.5 + r() * 2.5; const x = r() * W, y = r() * H, a = r() * TAU, L = 6 + r() * 50; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); g.stroke(); }
  g.restore();
}

/* ------------------------------------------------------------------ geometry builders */
export function sh(m, cast = true, recv = true) { m.castShadow = cast; m.receiveShadow = recv; return m; }
export function rr(w, h, r = 0.004, cx = 0, cy = 0, P = THREE.Shape) {
  r = Math.max(1e-5, Math.min(r, w / 2 - 1e-5, h / 2 - 1e-5)); const s = new P(), x = cx - w / 2, y = cy - h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.absarc(x + w - r, y + r, r, -PI / 2, 0, false);
  s.lineTo(x + w, y + h - r); s.absarc(x + w - r, y + h - r, r, 0, PI / 2, false);
  s.lineTo(x + r, y + h); s.absarc(x + r, y + h - r, r, PI / 2, PI, false);
  s.lineTo(x, y + r); s.absarc(x + r, y + r, r, PI, PI * 1.5, false);
  return s;
}
export const rrHole = (w, h, r, cx, cy) => rr(w, h, r, cx, cy, THREE.Path);
export const circHole = (cx, cy, r) => new THREE.Path().absarc(cx, cy, r, 0, TAU, false);
export function circ(r, cx = 0, cy = 0) { return new THREE.Shape().absarc(cx, cy, r, 0, TAU, false); }
export function poly(pts, r = 0.01, P = THREE.Shape) {
  const s = new P(), n = pts.length;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i + n - 1) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
    const l1 = Math.hypot(p0[0] - p1[0], p0[1] - p1[1]), l2 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const d1 = Math.min(r, l1 / 2), d2 = Math.min(r, l2 / 2);
    const ax = p1[0] + (p0[0] - p1[0]) / l1 * d1, ay = p1[1] + (p0[1] - p1[1]) / l1 * d1;
    const bx = p1[0] + (p2[0] - p1[0]) / l2 * d2, by = p1[1] + (p2[1] - p1[1]) / l2 * d2;
    if (i === 0) s.moveTo(ax, ay); else s.lineTo(ax, ay);
    s.quadraticCurveTo(p1[0], p1[1], bx, by);
  }
  s.closePath(); return s;
}
// extruded plate: back at z, front at z+d. mat = face paint, edge = bevel/side material
export function plate(shape, { d = 0.008, bevel = 0.0012, seg = 2, mat, edge, curve = 16, z = 0, x = 0, y = 0 } = {}) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(d - 2 * bevel, 1e-4), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: seg, curveSegments: curve });
  g.translate(0, 0, bevel);
  const m = new THREE.Mesh(g, edge ? [mat, edge] : mat); m.position.set(x, y, z); return sh(m);
}
export function box(w, h, d, mat, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); return sh(m); }
export function cyl(r0, r1, h, mat, seg = 32) { const g = new THREE.CylinderGeometry(r0, r1, h, seg); g.rotateX(PI / 2); g.translate(0, 0, h / 2); return sh(new THREE.Mesh(g, mat)); } // axis +Z, base at z=0, r0 = top
export function lathe(pts, mat, seg = 72) { const g = new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p[0], p[1])), seg); g.rotateX(PI / 2); return sh(new THREE.Mesh(g, mat)); }
export function bezelRing(rIn, w, h, depth, mat, seg = 80) {
  const R = rIn + w;
  return lathe([[R, 0], [R, h * 0.4], [R - w * 0.12, h * 0.8], [R - w * 0.3, h], [rIn + w * 0.3, h], [rIn + w * 0.1, h * 0.86], [rIn, h * 0.55], [rIn, -depth]], mat, seg);
}
export function dome(r, bulge, mat) {
  const Rs = (r * r + bulge * bulge) / (2 * bulge), th = Math.asin(Math.min(1, r / Rs));
  const g = new THREE.SphereGeometry(Rs, 48, 10, 0, TAU, 0, th); g.rotateX(PI / 2); g.translate(0, 0, -(Rs - bulge));
  const m = new THREE.Mesh(g, mat); m.renderOrder = 5; return m;
}
export function needleMesh(len, w, mat, { tail = 0.18, thick = 0.0015, tip = 0.25 } = {}) {
  const s = new THREE.Shape(); s.moveTo(-w / 2, -len * tail); s.lineTo(w / 2, -len * tail); s.lineTo(w * tip / 2, len); s.lineTo(-w * tip / 2, len); s.closePath();
  const m = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false }), mat); m.castShadow = true; return m;
}
export function quad(w, h, mat, r = 0) {
  let g;
  if (r > 0) { g = new THREE.ShapeGeometry(rr(w, h, r), 10); const p = g.attributes.position, uv = g.attributes.uv; for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / w + 0.5, p.getY(i) / h + 0.5); }
  else g = new THREE.PlaneGeometry(w, h);
  return new THREE.Mesh(g, mat);
}
export function disc(r, mat, seg = 64) { return new THREE.Mesh(new THREE.CircleGeometry(r, seg), mat); }
export function cable(points, radius, mat, seg = 80) {
  const c = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), false, 'catmullrom', 0.5);
  return sh(new THREE.Mesh(new THREE.TubeGeometry(c, seg, radius, 10, false), mat));
}

export class Instancer {
  constructor(geo, mat) { this.geo = geo; this.mat = mat; this.list = []; }
  add(x, y, z, s = 1, rz = Math.random() * TAU, rx = 0) { this.list.push([x, y, z, s, rz, rx]); return this; }
  corners(cx, cy, w, h, inset, z, s) { for (const sx of [-1, 1]) for (const sy of [-1, 1]) this.add(cx + sx * (w / 2 - inset), cy + sy * (h / 2 - inset), z, s); return this; }
  ring(cx, cy, r, n, z, s, a0 = 0) { for (let i = 0; i < n; i++) { const a = a0 + i / n * TAU; this.add(cx + Math.cos(a) * r, cy + Math.sin(a) * r, z, s); } return this; }
  build(parent) {
    if (!this.list.length) return null;
    const m = new THREE.InstancedMesh(this.geo, this.mat, this.list.length), o = new THREE.Object3D();
    this.list.forEach((a, i) => { o.position.set(a[0], a[1], a[2]); o.scale.setScalar(a[3]); o.rotation.set(a[5], 0, a[4]); o.updateMatrix(); m.setMatrixAt(i, o.matrix); });
    m.castShadow = m.receiveShadow = true; parent.add(m); return m;
  }
}
// unit screw head (radius 1), axis +Z. kind: 'slot' | 'hex' | 'cross'
export function screwKit(kind, metal) {
  const c = mkCanvas(64, 64), g = c.getContext('2d');
  const gr = g.createRadialGradient(26, 22, 2, 32, 32, 34); gr.addColorStop(0, '#fff'); gr.addColorStop(1, '#8a8a8a'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#0a0a0a';
  if (kind === 'slot') g.fillRect(4, 27, 56, 10);
  else if (kind === 'cross') { g.fillRect(10, 28, 44, 8); g.fillRect(28, 10, 8, 44); }
  else { g.beginPath(); for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; g.lineTo(32 + Math.cos(a) * 17, 32 + Math.sin(a) * 17); } g.fill(); }
  const top = metal.clone(); top.map = canvasTex(c); top.needsUpdate = true;
  const geo = new THREE.CylinderGeometry(0.82, 1, 0.42, 20); geo.rotateX(PI / 2); geo.translate(0, 0, 0.21);
  return new Instancer(geo, [metal, top, metal]);
}
// unit toggle switch (nut radius 1), lever tilted up (dir=1) or down (-1)
export function toggleKit(mat, dir = 1) {
  const nut = new THREE.CylinderGeometry(1, 1, 0.4, 6); nut.rotateX(PI / 2); nut.translate(0, 0, 0.2);
  const col = new THREE.CylinderGeometry(0.6, 0.72, 0.55, 18); col.rotateX(PI / 2); col.translate(0, 0, 0.6);
  const lev = new THREE.CylinderGeometry(0.36, 0.2, 2.5, 14); lev.translate(0, 1.25, 0);
  const tip = new THREE.SphereGeometry(0.36, 14, 10); tip.translate(0, 2.5, 0);
  for (const p of [lev, tip]) { p.rotateX(PI / 2 - dir * 0.42); p.translate(0, 0, 0.7); }
  return new Instancer(mergeGeometries([nut, col, lev, tip]), mat);
}
export function knob(r, h, mat, markMat, angle = 0, { skirt = 1.25, flute = 14 } = {}) {
  const g = new THREE.Group();
  const side = mat.clone(); side.normalMap = rep(Maps.knurl(), flute, 1); side.normalScale = new THREE.Vector2(1.2, 0); side.needsUpdate = true;
  g.add(lathe([[r * skirt, 0], [r * skirt, h * 0.12], [r * 1.02, h * 0.2]], mat, 40));
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.88, r, h * 0.8, 40, 1, true), side); body.rotation.x = PI / 2; body.position.z = h * 0.6; g.add(sh(body));
  g.add(lathe([[r * 0.88, h], [r * 0.74, h * 1.06], [0.0001, h * 1.07]], mat, 40));
  const mk = new THREE.Mesh(new THREE.BoxGeometry(r * 0.16, r * 0.8, h * 0.04), markMat); mk.position.set(0, r * 0.52, h * 1.065); g.add(mk);
  const mk2 = new THREE.Mesh(new THREE.BoxGeometry(r * 0.14, h * 0.03, h * 0.75), markMat); mk2.position.set(0, r * 0.95, h * 0.6); g.add(mk2);
  g.rotation.z = angle; return g;
}
export function lamp(r, color, intensity, bezelMat, on = true) {
  const g = new THREE.Group();
  g.add(lathe([[r * 1.5, 0], [r * 1.5, r * 0.35], [r * 1.25, r * 0.6], [r * 1.02, r * 0.6], [r * 1.0, r * 0.2]], bezelMat, 28));
  const c = new THREE.Color(color);
  const m = new THREE.MeshStandardMaterial({ color: on ? c.clone().multiplyScalar(0.6) : c.clone().multiplyScalar(0.12), roughness: 0.25, emissive: c, emissiveIntensity: on ? intensity : 0.0 });
  const d = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 10, 0, TAU, 0, PI / 2), m); d.rotation.x = PI / 2; d.scale.z = 0.8; d.position.z = r * 0.15; g.add(d);
  g.userData.mat = m; return g;
}

/* ------------------------------------------------------------------ screens & painted sheets */
export class Screen {
  constructor(W, H, draw, { fps = 10, intensity = 2, basic = true } = {}) {
    this.c = mkCanvas(W, H); this.g = this.c.getContext('2d'); this.draw = draw; this.fps = fps; this.next = Math.random() * 0.2; this.done = false;
    this.tex = canvasTex(this.c);
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, color: new THREE.Color(intensity, intensity, intensity) });
  }
  update(t) {
    if (this.done && (this.fps === 0 || t < this.next)) return;
    this.next = t + 1 / Math.max(this.fps, 0.001); this.draw(this.g, t, this.c.width, this.c.height); this.tex.needsUpdate = true; this.done = true;
  }
}
// transparent painted layer in dash coordinates (meters, y up). draw(g, T) where T(text,x,y,size,opts)
export function sheet(x0, y0, x1, y1, ppm, draw, { z = 0, emissive = 0, rough = 0.65, wearAmt = 0, seed = 1, additive = false, metal = 0 } = {}) {
  const W = Math.round((x1 - x0) * ppm), H = Math.round((y1 - y0) * ppm), c = mkCanvas(W, H), g = c.getContext('2d');
  g.setTransform(ppm, 0, 0, -ppm, -x0 * ppm, y1 * ppm);
  const T = (text, x, y, size, { font = 'sans-serif', weight = 600, color = '#fff', align = 'center', ls = 0, base = 'middle', rot = 0 } = {}) => {
    g.save(); g.translate(x, y); g.rotate(rot); g.scale(1 / ppm, -1 / ppm);
    g.font = `${weight} ${size * ppm}px ${font}`; g.fillStyle = color; g.textAlign = align; g.textBaseline = base;
    try { g.letterSpacing = (ls * size * ppm) + 'px'; } catch (e) { /* older engines */ }
    g.fillText(text, 0, 0); g.restore();
  };
  draw(g, T, ppm);
  if (wearAmt > 0) wear(g, W, H, wearAmt, seed);
  const tex = canvasTex(c);
  const mat = emissive > 0
    ? new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, color: new THREE.Color(emissive, emissive, emissive), blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending })
    : new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: rough, metalness: metal });
  mat.polygonOffset = true; mat.polygonOffsetFactor = -2; mat.polygonOffsetUnits = -2;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, y1 - y0), mat); m.position.set((x0 + x1) / 2, (y0 + y1) / 2, z); m.receiveShadow = emissive === 0; m.renderOrder = 2;
  return m;
}
// small standalone painted/emissive decal drawn in pixel space
export function decal(w, h, pxW, pxH, draw, { emissive = 0, rough = 0.6, additive = false, wearAmt = 0, seed = 1 } = {}) {
  const c = mkCanvas(pxW, pxH), g = c.getContext('2d'); draw(g, pxW, pxH); if (wearAmt) wear(g, pxW, pxH, wearAmt, seed);
  const tex = canvasTex(c);
  const mat = emissive > 0
    ? new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, color: new THREE.Color(emissive, emissive, emissive), blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending })
    : new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: rough });
  mat.polygonOffset = true; mat.polygonOffsetFactor = -2; mat.polygonOffsetUnits = -2;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); m.renderOrder = 2; m.receiveShadow = emissive === 0; return m;
}
export function glassMat({ opacity = 0.1, rough = 0.07, tint = 0x000000, env = 1, smudgeRep = 1 } = {}) {
  return new THREE.MeshPhysicalMaterial({
    color: tint, roughness: rough * 2.2, roughnessMap: rep(Maps.smudge(), smudgeRep), metalness: 0, ior: 1.52, envMapIntensity: env,
    transparent: true, opacity, depthWrite: false, premultipliedAlpha: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
}

/* ------------------------------------------------------------------ environment */
export function makeEnv(renderer, build, sigma = 0.02) {
  const s = new THREE.Scene();
  const card = (w, h, color, intensity, pos, target = [0, 0, 0]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(...target); s.add(m); return m;
  };
  const sky = (stops, intensity = 1) => { // vertical gradient dome; stops: [[t, css], ...] top→bottom
    const c = mkCanvas(8, 256), g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256);
    stops.forEach(([t, col]) => gr.addColorStop(t, col)); g.fillStyle = gr; g.fillRect(0, 0, 8, 256);
    const m = new THREE.Mesh(new THREE.SphereGeometry(40, 32, 16), new THREE.MeshBasicMaterial({ map: canvasTex(c), side: THREE.BackSide, color: new THREE.Color(intensity, intensity, intensity) }));
    s.add(m); return m;
  };
  build({ scene: s, card, sky });
  const pm = new THREE.PMREMGenerator(renderer), rt = pm.fromScene(s, sigma, 0.1, 100); pm.dispose();
  return rt.texture;
}

/* ------------------------------------------------------------------ post shaders */
const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const DofShader = {
  uniforms: { tDiffuse: { value: null }, tDepth: { value: null }, px: { value: new THREE.Vector2() }, near: { value: 0.1 }, far: { value: 60 }, focus: { value: 2 }, aperture: { value: 2 }, maxBlur: { value: 16 }, seed: { value: 0 } },
  vertexShader: VERT,
  fragmentShader: `
    #define TAPS 72
    uniform sampler2D tDiffuse; uniform sampler2D tDepth; uniform vec2 px; uniform float near, far, focus, aperture, maxBlur, seed; varying vec2 vUv;
    float viewZ(vec2 uv){ float z = texture2D(tDepth, uv).x * 2.0 - 1.0; return 2.0 * near * far / (far + near - z * (far - near)); }
    float coc(float z){ return clamp((1.0 / focus - 1.0 / z) * aperture, -1.0, 1.0) * maxBlur; }
    void main(){
      float zc = viewZ(vUv), ac = abs(coc(zc));
      vec3 col = texture2D(tDiffuse, vUv).rgb; float tot = 1.0;
      float rnd = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + seed) * 43758.5453) * 6.2831853;
      for (int i = 1; i <= TAPS; i++) {
        float fi = float(i), rad = sqrt(fi / float(TAPS)) * maxBlur, ang = fi * 2.39996323 + rnd;
        vec2 uv = vUv + vec2(cos(ang), sin(ang)) * rad * px;
        vec3 s = texture2D(tDiffuse, uv).rgb; float zs = viewZ(uv), cs = abs(coc(zs));
        if (zs > zc) cs = clamp(cs, 0.0, ac * 2.0);
        float m = smoothstep(rad - 0.5, rad + 0.5, cs);
        col += mix(col / tot, s, m); tot += 1.0;
      }
      gl_FragColor = vec4(col / tot, 1.0);
    }`,
};
const LensShader = {
  uniforms: { tDiffuse: { value: null }, distort: { value: 0.04 }, ca: { value: 0.006 }, vig: { value: 0.6 }, aspect: { value: 1.78 }, tint: { value: new THREE.Vector3(1, 1, 1) }, streakTex: { value: null } },
  vertexShader: VERT,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float distort, ca, vig, aspect; uniform vec3 tint; varying vec2 vUv;
    vec2 warp(vec2 uv, float k){ vec2 c = uv - 0.5; c.x *= aspect; float r2 = dot(c, c), rm = aspect * aspect * 0.25 + 0.25; c *= (1.0 + k * r2) / (1.0 + k * rm); c.x /= aspect; return c + 0.5; }
    void main(){
      vec3 col;
      col.r = texture2D(tDiffuse, warp(vUv, distort + ca)).r;
      col.g = texture2D(tDiffuse, warp(vUv, distort)).g;
      col.b = texture2D(tDiffuse, warp(vUv, distort - ca)).b;
      vec2 c = vUv - 0.5; c.x *= aspect; float r2 = dot(c, c);
      float v = 1.0 / (1.0 + r2 * 1.35); col *= mix(1.0, v * v, vig);
      gl_FragColor = vec4(col * tint, 1.0);
    }`,
};
const GrainShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, amount: { value: 0.05 }, lift: { value: 0.008 }, contrast: { value: 1 }, sat: { value: 1 }, sharp: { value: 0.4 }, px: { value: new THREE.Vector2() } },
  vertexShader: VERT,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time, amount, lift, contrast, sat, sharp; uniform vec2 px; varying vec2 vUv;
    float h(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb; vec2 p = gl_FragCoord.xy; float t = floor(time * 24.0);
      vec3 nb = texture2D(tDiffuse, vUv + vec2(px.x, 0.0)).rgb + texture2D(tDiffuse, vUv - vec2(px.x, 0.0)).rgb + texture2D(tDiffuse, vUv + vec2(0.0, px.y)).rgb + texture2D(tDiffuse, vUv - vec2(0.0, px.y)).rgb;
      c = max(c + (c - nb * 0.25) * sharp, 0.0);
      float l0 = dot(c, vec3(0.2126, 0.7152, 0.0722)); c = mix(vec3(l0), c, sat);
      c = clamp((c - 0.5) * contrast + 0.5, 0.0, 1.0);
      float n = h(p + t * 17.13) + h(p * 0.5 + t * 31.7 + 7.0) - 1.0;
      vec3 nc = vec3(h(p + t * 13.1 + 1.0), h(p + t * 19.3 + 2.0), h(p + t * 23.9 + 3.0)) - 0.5;
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = c * (1.0 - lift) + lift;
      c += (n * 0.75 + nc * 0.4) * amount * (1.0 - 0.55 * l);
      gl_FragColor = vec4(c, 1.0);
    }`,
};

/* ------------------------------------------------------------------ app */
export class App {
  constructor(canvas) {
    this.canvas = canvas;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap; r.setClearColor(0x000000, 1);
    this.camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.1, 60);
    this.msaa = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(r, new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType }));
    this.copy = new TexturePass(this.msaa.texture);
    this.gtao = new GTAOPass(new THREE.Scene(), this.camera, 4, 4);
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    this.dof = new ShaderPass(DofShader);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.6, 0.7, 1.0);
    this.lens = new ShaderPass(LensShader);
    this.out = new OutputPass();
    this.grain = new ShaderPass(GrainShader);
    for (const p of [this.copy, this.gtao, this.dof, this.bloom, this.lens, this.out, this.grain]) this.composer.addPass(p);
    this.dof.uniforms.tDepth.value = this.gtao.depthTexture;
    this.dof.uniforms.near.value = this.camera.near; this.dof.uniforms.far.value = this.camera.far;
    this.cur = null; this.scale = 1; this.mx = 0; this.my = 0; this.sx = 0; this.sy = 0; this.acc = 0; this.frames = 0; this.last = performance.now(); this.motion = true;
    addEventListener('pointermove', e => { this.mx = (e.clientX / innerWidth) * 2 - 1; this.my = (e.clientY / innerHeight) * 2 - 1; });
    addEventListener('resize', () => this.resize());
  }
  use(s) {
    this.cur = s; const L = s.look;
    this.renderer.toneMapping = L.tone ?? THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = L.exposure ?? 1;
    this.gtao.scene = s.scene; this.gtao.blendIntensity = L.ao?.intensity ?? 1;
    this.gtao.updateGtaoMaterial({ radius: L.ao?.radius ?? 0.05, distanceExponent: 1.2, thickness: 1.2, scale: 1.1, samples: 16, distanceFallOff: 1, screenSpaceRadius: false });
    [this.bloom.strength, this.bloom.radius, this.bloom.threshold] = L.bloom ?? [0.5, 0.7, 1];
    const d = this.dof.uniforms; d.focus.value = L.focus ?? 2; d.aperture.value = L.aperture ?? 2; d.maxBlur.value = L.maxBlur ?? 16;
    const l = this.lens.uniforms; l.distort.value = L.distort ?? 0.04; l.ca.value = L.ca ?? 0.005; l.vig.value = L.vig ?? 0.6; l.tint.value.set(...(L.tint ?? [1, 1, 1]));
    const gu = this.grain.uniforms; gu.amount.value = L.grain ?? 0.05; gu.lift.value = L.lift ?? 0.008; gu.contrast.value = L.contrast ?? 1; gu.sat.value = L.sat ?? 1; gu.sharp.value = L.sharp ?? 0.4;
    this.resize();
    this.renderer.compile(s.scene, this.camera);
  }
  resize() {
    const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight;
    let dpr = Math.min(devicePixelRatio || 1, 2); dpr = Math.min(dpr, Math.sqrt(3.7e6 / (w * h))) * this.scale;
    this.renderer.setPixelRatio(dpr); this.renderer.setSize(w, h, false);
    const W = Math.max(2, Math.round(w * dpr)), H = Math.max(2, Math.round(h * dpr));
    this.msaa.setSize(W, H); this.composer.setPixelRatio(1); this.composer.setSize(W, H);
    this.dof.uniforms.px.value.set(1 / W, 1 / H); this.grain.uniforms.px.value.set(1 / W, 1 / H); this.lens.uniforms.aspect.value = w / h; this.blurScale = H / 1080;
    if (this.cur) {
      const L = this.cur.look, a = w / h, D = L.dist ?? 2, fw = L.frameW ?? 2, fh = L.frameH ?? 1.125;
      this.camera.aspect = a; this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.max(fh / 2 / D, fw / 2 / D / a))); this.camera.updateProjectionMatrix();
      this.dof.uniforms.maxBlur.value = (L.maxBlur ?? 16) * this.blurScale;
    }
  }
  frame(now) {
    const s = this.cur; if (!s) return;
    const t = now / 1000, dt = Math.min(0.1, (now - this.last) / 1000); this.last = now;
    s.update(t, dt);
    const L = s.look, k = 1 - Math.exp(-dt * 2.2); this.sx += (this.mx - this.sx) * k; this.sy += (this.my - this.sy) * k;
    const cp = L.cam ?? [0, 0, 2], ct = L.target ?? [0, 0, 0], m = this.motion ? 1 : 0, pr = L.parallax ?? [0.14, 0.07];
    this.camera.position.set(cp[0] + this.sx * pr[0] + m * (Math.sin(t * 0.31) * 0.004 + Math.sin(t * 0.83 + 1) * 0.0015), cp[1] - this.sy * pr[1] + m * (Math.sin(t * 0.27 + 2) * 0.003 + Math.sin(t * 0.71) * 0.0012), cp[2] + m * Math.sin(t * 0.19) * 0.004);
    this.camera.lookAt(ct[0] + this.sx * 0.02, ct[1] - this.sy * 0.01, ct[2]);
    this.camera.rotation.z += m * (Math.sin(t * 0.23 + 0.5) * 0.0022 + Math.sin(t * 0.61) * 0.0008);
    this.camera.updateMatrixWorld();
    const r = this.renderer;
    r.setRenderTarget(this.msaa); r.clear(); r.render(s.scene, this.camera); r.setRenderTarget(null);
    for (const o of s.hide) o.visible = false;
    this.dof.uniforms.seed.value = (t * 60 % 97); this.grain.uniforms.time.value = t;
    this.composer.render(dt);
    for (const o of s.hide) o.visible = true;
    // adaptive resolution: step down on sustained slow frames; retry full size a couple of times after a long smooth run.
    // Throttled / hidden frames (huge dt) are not evidence of a slow GPU, so they reset the window instead of counting.
    if (dt > 0.09 || document.visibilityState !== 'visible') { this.acc = 0; this.frames = 0; this.good = 0; }
    else {
      this.acc += dt; this.frames++;
      if (this.frames >= 50) {
        const avg = this.acc / this.frames; this.acc = 0; this.frames = 0;
        if (this.lockScale) return;
        if (avg > 0.036 && this.scale > 0.5) { this.scale *= 0.84; this.good = 0; this.resize(); }
        else if (avg < 0.019 && this.scale < 1 && (this.upTries ?? 0) < 2) { this.good = (this.good ?? 0) + 1; if (this.good >= 8) { this.good = 0; this.upTries = (this.upTries ?? 0) + 1; this.scale = Math.min(1, this.scale / 0.84); this.resize(); } }
      }
    }
  }
}
