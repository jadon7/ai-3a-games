// 读取 tools/vmf2map.py 生成的 .kmap 地形数据（格式说明见那个脚本开头）：
//   faces：实心笔刷的每个面（凸多边形）——kind 0 可见、1 仅碰撞、2 只挡人的隐形墙；brush 是它所属笔刷的编号
//   disps：位移地形块（size×size 的顶点网格）
import { fetchBin } from '../core/pack.js';

export const isKMAP = (u8) => u8.length > 12 && u8[0] === 0x4b && u8[1] === 0x4d && u8[2] === 0x41 && u8[3] === 0x50;   // 'KMAP'

export function parseKmap(buf) {
  const u8 = new Uint8Array(buf); if (!isKMAP(u8)) throw new Error('不是 KMAP 文件');
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); const ver = dv.getUint32(4, true), hl = dv.getUint32(8, true);
  if (ver !== 2) throw new Error('KMAP 版本不符：' + ver);
  const head = JSON.parse(new TextDecoder().decode(u8.subarray(12, 12 + hl))); const base = 12 + hl;
  const faces = []; let o = base + head.seg.faces[0]; const fe = o + head.seg.faces[1];
  while (o < fe) {
    const n = dv.getUint8(o), kind = dv.getUint8(o + 1), brush = dv.getUint32(o + 2, true); o += 6; const P = new Array(n);
    for (let i = 0; i < n; i++) { P[i] = [dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true)]; o += 12; }
    faces.push({ kind, brush, P });
  }
  const disps = []; o = base + head.seg.disps[0]; const de = o + head.seg.disps[1];
  while (o < de) {
    const power = dv.getUint8(o); const nrm = [dv.getFloat32(o + 1, true), dv.getFloat32(o + 5, true), dv.getFloat32(o + 9, true)]; o += 13;
    const size = (1 << power) + 1, G = new Float32Array(size * size * 3); for (let i = 0; i < G.length; i++, o += 4) G[i] = dv.getFloat32(o, true);
    disps.push({ size, nrm, G });
  }
  return { head, faces, disps };
}

export async function loadKmap(url) { return parseKmap(await fetchBin(url, (b) => isKMAP(new Uint8Array(b)))); }
