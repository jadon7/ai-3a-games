// 真人士兵模型载入：assets/models/soldier.glb（tools/blender/build_soldier.py 以 Blender 基金会 CC0 人体基础网格为底生成）。
// GLB 里有 5 个蒙皮网格：base（作战服、靴子、手套、通用装备）、head（头颈皮肤与眼球）、kit_friend / kit_enemy / kit_sniper（各阵营的头部装备与胸挂）。
// 关节顺序与 actors.js 的 BONES 完全一致，所以 JOINTS_0 直接就是 BONES 下标，绑到游戏自己建的骨架上即可。
// 顶点色不是最终颜色：R = (槽位 + 0.5) / 16，G = 烘焙 AO × 明暗，B = 建议粗糙度，A = 布纹法线权重。
// 载入失败（例如 file:// 直接打开）时 hasSoldierModel() 为 false，actors.js 退回程序化士兵。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { fetchBin, isGLB } from '../core/pack.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// 槽位表：前 11 个与 actors.js 的 PAL 键同名，后 5 个是真人模型新增的
export const SLOTS = ['cloth', 'vest', 'pouch', 'helmet', 'pad', 'dark', 'boot', 'glove', 'face', 'accent', 'gunTan', 'skin', 'eye', 'iris', 'lens', 'strap'];
let PARTS = null;

export async function loadSoldierModel(url = 'assets/models/soldier.glb') {
  PARTS = null;
  try {
    const sc = (await new GLTFLoader().parseAsync(await fetchBin(url, isGLB), '')).scene; const P = {};
    // 网格 head 与骨骼 head 重名，GLTFLoader 会把它改成 head_1，这里去掉后缀
    sc.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.attributes.skinIndex) P[o.name.replace(/_\d+$/, '')] = o.geometry; });
    if (P.base && P.head && P.kit_friend && P.kit_enemy && P.kit_sniper) PARTS = P;
  } catch (e) { PARTS = null; }
  return !!PARTS;
}
export const hasSoldierModel = () => !!PARTS;

// GLB 网格 → 与 soldierGeometry() 相同的属性集（全部还原成普通的 Float32 / Uint16 属性，才能与程序化的枪合并）
//   color = PAL[槽位].rgb × G，alpha = PAL[槽位] 的迷彩权重
//   aSurf = (布纹法线权重, 非布料表面的粗糙度, 是否皮肤)
function bake(src, pal) {
  const P = src.attributes.position, N = src.attributes.normal, U = src.attributes.uv, C = src.attributes.color, J = src.attributes.skinIndex, W = src.attributes.skinWeight; const n = P.count;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2), col = new Float32Array(n * 4), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), sf = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = P.getX(i); pos[i * 3 + 1] = P.getY(i); pos[i * 3 + 2] = P.getZ(i);
    const nx = N.getX(i), ny = N.getY(i), nz = N.getZ(i), nl = Math.hypot(nx, ny, nz) || 1; nrm[i * 3] = nx / nl; nrm[i * 3 + 1] = ny / nl; nrm[i * 3 + 2] = nz / nl;
    uv[i * 2] = U.getX(i); uv[i * 2 + 1] = U.getY(i);
    const slot = SLOTS[Math.min(15, Math.floor(C.getX(i) * 16))]; const c = pal[slot] || pal.dark; const g = C.getY(i);
    col[i * 4] = c[0] * g; col[i * 4 + 1] = c[1] * g; col[i * 4 + 2] = c[2] * g; col[i * 4 + 3] = c.length > 3 ? c[3] : 0;
    sf[i * 3] = C.getW(i); sf[i * 3 + 1] = C.getZ(i); sf[i * 3 + 2] = slot === 'skin' ? 1 : 0;
    let s = 0; for (let k = 0; k < 4; k++) { si[i * 4 + k] = J.getComponent(i, k); const w = W.getComponent(i, k); sw[i * 4 + k] = w; s += w; }
    if (s > 0) for (let k = 0; k < 4; k++) sw[i * 4 + k] /= s; else sw[i * 4] = 1;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4)); g.setAttribute('color', new THREE.BufferAttribute(col, 4)); g.setAttribute('aSurf', new THREE.BufferAttribute(sf, 3));
  g.setIndex(Array.from(src.index.array));
  return g;
}

// kind：friend / enemy / sniper；pal：该阵营的调色板；extra：要一起合并的几何体（挂在枪骨骼上的步枪）
export function humanGeometry(kind, pal, extra = null) {
  if (!PARTS || !PARTS['kit_' + kind]) return null;
  const list = [bake(PARTS.base, pal), bake(PARTS.head, pal), bake(PARTS['kit_' + kind], pal)];
  if (extra) list.push(extra);
  const g = mergeGeometries(list); if (!g) return null;
  g.computeBoundingSphere();
  return g;
}
