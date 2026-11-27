// 贴图压缩的画质对比台（开发用）：同一会话、同一冻结画面里把贴图换成另一套，逐像素比较渲染结果。
// 用法（开发服务器，页面带 ?mute）：控制台里 `await import('/tools/tex_ab.js')`，然后
//   await __ab.compare('assets_exp/B/', 'avif')     → 每个机位的 PSNR、平均 / 99.9% / 最大差值、差值超过 3 级和 8 级的像素占比
//   await __ab.compare('assets/tex/', 'jpg')        → 噪声底（原图对原图，应为完全一致）
//   await __ab.diffTile('assets_exp/A/', 'avif', 机位序号, 放大倍数)   → 屏幕左半原图、右半差值放大图
const d = window.__dbg, T = d.engine.T, gl = d.engine.renderer.domElement;
const SLOTS = ['plaster', 'brick', 'sandstone', 'sand', 'dirt', 'paving', 'concrete', 'wood', 'woodPaint', 'metalPaint', 'metalRusty', 'corrugated', 'shutter', 'rock'];
const KEYS = { diff: 'map', nor: 'normalMap', arm: 'ormMap', disp: 'dispMap' };
const orig = new Map();
for (const s of SLOTS) for (const k of Object.keys(KEYS)) { const t = T[s] && T[s][KEYS[k]]; if (t && T[s].photo) orig.set(s + '_' + k, t.image); }
const loadImg = async (url, type) => { const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status); const b = new Blob([await r.arrayBuffer()], { type }); const img = new Image(); await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('解码失败 ' + url)); img.src = URL.createObjectURL(b); }); return img; };   // 用 onload 而不是 img.decode()：页面不在前台渲染时 decode() 的 Promise 不会兑现
async function use(base, ext) {
  let n = 0, bytes = 0;
  await Promise.all([...orig.keys()].map(async (key) => { const [s, k] = key.split('_'); const t = T[s][KEYS[k]]; t.image = base ? await loadImg(base + key + '.' + ext, ext === 'avif' ? 'image/avif' : ext === 'webp' ? 'image/webp' : 'image/jpeg') : orig.get(key); t.needsUpdate = true; n++; }));
  return n;
}
// 机位：街景、贴地掠射、贴墙、长街、运河、A 点高台、屋顶俯瞰
const VIEWS = [
  { n: '南大道街景', pos: [0, 1.7, 44], look: [0, 1.6, 0], fov: 70 }, { n: '铺地掠射', pos: [1.5, 0.45, 30], look: [0, 0.0, 25], fov: 50 }, { n: '长街沙地', pos: [49, 1.2, 44], look: [49, 0.2, 30], fov: 60 },
  { n: '运河', pos: [-47, -1.6, 22], look: [-47, -2.4, -8], fov: 70 }, { n: 'A 点高台', pos: [31, 4.4, -43], look: [20, 3.2, -53], fov: 70 }, { n: '屋顶俯瞰', pos: [0, 15, 52], look: [0, 0, 0], fov: 60 },
];
{ // 贴墙：从南大道朝东找最近的墙，贴近斜看
  const V = d.game.player.pos.constructor; const o = new V(0, 1.6, 30), dir = new V(1, 0, 0); const h = d.world.raycast(o, dir, 60);
  if (h) VIEWS.push({ n: '贴墙斜看', pos: [h.point.x - 1.3, 1.6, h.point.z + 1.6], look: [h.point.x, 1.7, h.point.z - 1.2], fov: 55 });
}
const c2 = document.createElement('canvas'); const g2 = c2.getContext('2d', { willReadFrequently: true });
function shot(v) { d.view = { pos: v.pos, look: v.look, fov: v.fov }; d.draw(3); c2.width = gl.width; c2.height = gl.height; g2.drawImage(gl, 0, 0); return g2.getImageData(0, 0, c2.width, c2.height); }
function stats(a, b) {
  const A = a.data, B = b.data, n = A.length / 4; let se = 0, sa = 0, mx = 0, c3 = 0, c8 = 0; const hist = new Uint32Array(256);
  for (let i = 0; i < A.length; i += 4) { const dr = Math.abs(A[i] - B[i]), dg = Math.abs(A[i + 1] - B[i + 1]), db = Math.abs(A[i + 2] - B[i + 2]); se += dr * dr + dg * dg + db * db; sa += dr + dg + db; const m = Math.max(dr, dg, db); hist[m]++; if (m > mx) mx = m; if (m > 3) c3++; if (m > 8) c8++; }
  let acc = 0, p999 = 0; for (let k = 255; k >= 0; k--) { acc += hist[k]; if (acc >= n * 0.001) { p999 = k; break; } }
  const mse = se / (n * 3); return { psnr: mse === 0 ? 99 : +(10 * Math.log10(65025 / mse)).toFixed(1), mean: +(sa / (n * 3)).toFixed(3), p999, max: mx, over3: +(c3 / n * 100).toFixed(3), over8: +(c8 / n * 100).toFixed(4) };
}
let base0 = null;
async function compare(base, ext) {
  await use(null); if (!base0) base0 = VIEWS.map(shot);
  await use(base, ext); const out = VIEWS.map((v, i) => ({ view: v.n, ...stats(base0[i], shot(v)) })); await use(null); d.draw(2);
  return out;
}
async function diffTile(base, ext, i = 0, gain = 16) {
  await use(null); const a = shot(VIEWS[i]); await use(base, ext); const b = shot(VIEWS[i]); await use(null);
  let cv = document.getElementById('__st'); if (!cv) { cv = document.createElement('canvas'); cv.id = '__st'; document.body.appendChild(cv); }
  cv.width = a.width; cv.height = a.height; cv.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:99999;background:#000'; const g = cv.getContext('2d');
  const o = g.createImageData(a.width, a.height); const half = a.width >> 1;
  for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) { const p = (y * a.width + x) * 4;
    if (x < half) { o.data[p] = a.data[p]; o.data[p + 1] = a.data[p + 1]; o.data[p + 2] = a.data[p + 2]; }
    else { const q = (y * a.width + x - half) * 4; o.data[p] = Math.min(255, Math.abs(a.data[q] - b.data[q]) * gain); o.data[p + 1] = Math.min(255, Math.abs(a.data[q + 1] - b.data[q + 1]) * gain); o.data[p + 2] = Math.min(255, Math.abs(a.data[q + 2] - b.data[q + 2]) * gain); }
    o.data[p + 3] = 255; }
  g.putImageData(o, 0, 0); return stats(a, b);
}
window.__ab = { VIEWS, use, shot, stats, compare, diffTile };
