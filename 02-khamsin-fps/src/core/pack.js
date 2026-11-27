// 压缩版优先的资源载入：让首次打开要下载的体积尽量小，画质不变。
//   模型 .glb / 天空 .hdr：发行版里旁边有一份 .gz（tools/build.mjs 生成，无损），浏览器端用 DecompressionStream 解压；
//   贴图：assets/tex/ 里每张 JPEG 旁边有一份 AVIF（tools/pack_textures.py 生成），支持 AVIF 的浏览器取它。
// 没有压缩版（开发目录）、浏览器不支持、或者取回来的东西不对，都退回原文件，功能和画质不受影响。

const magic = (buf, s) => { const u = new Uint8Array(buf, 0, Math.min(4, buf.byteLength)); for (let i = 0; i < s.length; i++) if (u[i] !== s.charCodeAt(i)) return false; return true; };

async function gunzip(buf) {
  const u = new Uint8Array(buf); if (!(u[0] === 0x1f && u[1] === 0x8b)) return buf;   // 不是 gzip：服务器带了 Content-Encoding，浏览器已经解开
  return await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}

// 取二进制文件：先试 url + '.gz'，ok(buf) 判断解出来的内容对不对（比如文件头）
export async function fetchBin(url, ok = () => true) {
  if (typeof DecompressionStream !== 'undefined') {
    try { const r = await fetch(url + '.gz'); if (r.ok) { const b = await gunzip(await r.arrayBuffer()); if (ok(b)) return b; } } catch (e) { /* 退回原文件 */ }
  }
  const r = await fetch(url); if (!r.ok) throw new Error(url + ' ' + r.status); return await r.arrayBuffer();
}
export const isGLB = (buf) => magic(buf, 'glTF');

// 天空：.gz 里不是原样的 .hdr，而是重排过的 RGBE（见 tools/build.mjs 的 packHDR）——
// 'KHDR' + 宽 + 高 + 四个平面 [R−G, G, B−G, E]，每个平面逐行做水平差分。这样 gzip 后只有原文件的三分之一，完全无损。
// 这里还原成不带行程编码的 Radiance .hdr 字节流，交给原来的 HDRLoader。
export async function fetchHDR(url) {
  const buf = await fetchBin(url, (b) => magic(b, 'KHDR') || magic(b, '#?'));
  if (!magic(buf, 'KHDR')) return buf;
  const dv = new DataView(buf), w = dv.getUint32(4, true), h = dv.getUint32(8, true), n = w * h, src = new Uint8Array(buf, 12);
  const head = new TextEncoder().encode(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${h} +X ${w}\n`); const out = new Uint8Array(head.length + n * 4); out.set(head);
  const P = [src.subarray(0, n), src.subarray(n, 2 * n), src.subarray(2 * n, 3 * n), src.subarray(3 * n, 4 * n)];
  for (const p of P) for (let y = 0; y < h; y++) { let a = 0; for (let x = 0, i = y * w; x < w; x++, i++) { a = (a + p[i]) & 255; p[i] = a; } }   // 还原水平差分
  for (let i = 0, o = head.length; i < n; i++, o += 4) { const g = P[1][i]; out[o] = (P[0][i] + g) & 255; out[o + 1] = g; out[o + 2] = (P[2][i] + g) & 255; out[o + 3] = P[3][i]; }
  return out.buffer;
}

// 浏览器能不能解 AVIF（解一张内嵌的 2×2 小图试试）。网址带 ?jpg 时强制用 JPEG 原图
let AVIF = null;
const PROBE = 'data:image/avif;base64,AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAADrbWV0YQAAAAAAAAAhaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAAAAAAAOcGl0bQAAAAAAAQAAAB5pbG9jAAAAAEQAAAEAAQAAAAEAAAETAAAAHgAAAChpaW5mAAAAAAABAAAAGmluZmUCAAAAAAEAAGF2MDFDb2xvcgAAAABqaXBycAAAAEtpcGNvAAAAFGlzcGUAAAAAAAAAAgAAAAIAAAAQcGl4aQAAAAADCAgIAAAADGF2MUOBAAwAAAAAE2NvbHJuY2x4AAEADQAGgAAAABdpcG1hAAAAAAAAAAEAAQQBAoMEAAAAJm1kYXQSAAoIGAA2iAhoNCAyEBlHh4Yhh5555oJIAJBAzeg=';
export function avifSupported() {
  if (AVIF) return AVIF;
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('jpg')) return (AVIF = Promise.resolve(false));
  return (AVIF = new Promise((res) => { const im = new Image(); im.onload = () => res(im.width === 2); im.onerror = () => res(false); im.src = PROBE; }));
}
