// 实拍 HDRI 天空：载入后分析出太阳方向 / 太阳辐照度 / 天光辐照度 / 地平线雾色，
// 让实时太阳光、环境光、烘焙 GI 与雾全部来自同一张实拍天空，光比自然一致。
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { ATMOS } from './sky.js';
import { fetchHDR } from '../core/pack.js';

const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// tilt：把天空穹顶绕水平轴朝太阳一侧压低的角度（弧度），用来得到更低的太阳高度角与更长的影子
export async function loadHDRI(url, { azimuth = Math.atan2(-0.44, -0.69), groundAlbedo = [0.36, 0.31, 0.24], tilt = 9 * Math.PI / 180, ratioMin = 6.2 } = {}) {
  const loader = new HDRLoader(); loader.setDataType(THREE.FloatType);
  // 先取压缩版（无损），还原成 .hdr 字节流后照常交给 HDRLoader
  const blob = URL.createObjectURL(new Blob([await fetchHDR(url)])); let tex;
  try { tex = await loader.loadAsync(blob); } finally { URL.revokeObjectURL(blob); }
  const w = tex.image.width, h = tex.image.height, d = tex.image.data; const ch = d.length / (w * h);
  const dPhi = 2 * Math.PI / w, dTheta = Math.PI / h;
  // HDRLoader 的数据第 0 行是图像底部还是顶部取决于 flipY；用亮度重心判断：太阳必在上半球
  const rowLat = (y) => (tex.flipY ? (0.5 - (y + 0.5) / h) : ((y + 0.5) / h - 0.5)) * Math.PI;
  // 1) 找最亮点
  let maxL = 0, mx = 0, my = 0, avg = 0, avgW = 0;
  for (let y = 0; y < h; y++) {
    const lat = rowLat(y); const cw = Math.cos(lat);
    for (let x = 0; x < w; x++) { const i = (y * w + x) * ch; const L = lum(d[i], d[i + 1], d[i + 2]); if (L > maxL) { maxL = L; mx = x; my = y; } if (lat > 0.1) { avg += Math.min(L, 50) * cw; avgW += cw; } }
  }
  avg /= avgW;
  let sunLat = rowLat(my); const flipped = sunLat < 0;   // 若太阳落在下半球，说明行序相反
  const latOf = (y) => flipped ? -rowLat(y) : rowLat(y);
  sunLat = latOf(my); const sunLon = ((mx + 0.5) / w - 0.5) * 2 * Math.PI;
  const sdx = Math.cos(sunLat) * Math.cos(sunLon), sdy = Math.sin(sunLat), sdz = Math.cos(sunLat) * Math.sin(sunLon);
  // 2) 积分：太阳（最亮点 4° 以内且远亮于天空）与天空
  const thr = Math.max(avg * 12, maxL * 0.02); const cos4 = Math.cos(4 * Math.PI / 180); const envMax = avg * 10;
  const Es = [0, 0, 0], Ek = [0, 0, 0], fog = [0, 0, 0], fogS = [0, 0, 0]; let fw = 0, fsw = 0; let cx = 0, cy = 0, cz = 0, cwSum = 0;
  for (let y = 0; y < h; y++) {
    const lat = latOf(y); if (lat < -0.05) continue; const cl = Math.cos(lat), sl = Math.sin(lat); const dO = dPhi * dTheta * cl;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * ch; const r = d[i], g = d[i + 1], b = d[i + 2]; const L = lum(r, g, b);
      const lon = ((x + 0.5) / w - 0.5) * 2 * Math.PI; const vx = cl * Math.cos(lon), vz = cl * Math.sin(lon);
      const cosS = vx * sdx + sl * sdy + vz * sdz;
      if (cosS > cos4 && L > thr) { Es[0] += r * dO; Es[1] += g * dO; Es[2] += b * dO; cx += vx * L * dO; cy += sl * L * dO; cz += vz * L * dO; cwSum += L * dO; }
      else if (sl > 0) { const k = sl * dO * (L > envMax ? envMax / L : 1); Ek[0] += r * k; Ek[1] += g * k; Ek[2] += b * k; }
      if (lat >= 0 && lat < 0.14) { const c2 = Math.min(r, thr), c3 = Math.min(g, thr), c4 = Math.min(b, thr); fog[0] += c2; fog[1] += c3; fog[2] += c4; fw++; const hz = (vx * sdx + vz * sdz) / Math.max(1e-3, Math.hypot(sdx, sdz) * cl); if (hz > 0.8) { fogS[0] += c2; fogS[1] += c3; fogS[2] += c4; fsw++; } }
    }
  }
  const sd = new THREE.Vector3(cx, cy, cz).normalize(); const elevH = Math.asin(sd.y); const elev = Math.max(0.2, elevH - tilt); tilt = elevH - elev; const azH = Math.atan2(sd.z, sd.x);
  // 3) 归一化：让天光水平辐照度的亮度 = 1.6
  const s = 1.6 / Math.max(1e-4, lum(Ek[0], Ek[1], Ek[2]));
  for (let k = 0; k < 3; k++) { Es[k] *= s; Ek[k] *= s; fog[k] = fog[k] / fw * s; fogS[k] = fogS[k] / Math.max(1, fsw) * s; }
  // 太阳被裁切的 HDRI：把直射/天光比补到一个合理的晴天值
  const ratio = lum(Es[0], Es[1], Es[2]) * Math.sin(elev) / 1.6;
  let boost = 1; if (ratio < ratioMin) { boost = ratioMin / Math.max(ratio, 1e-3); for (let k = 0; k < 3; k++) Es[k] *= boost; }
  // 直射光略偏暖（实拍太阳在裁切后偏白）
  Es[0] *= 1.10; Es[1] *= 1.0; Es[2] *= 0.80;   // 低角度太阳：色温约 4500K
  const rot = azimuth - azH;
  ATMOS.sunDir.set(Math.cos(elev) * Math.cos(azimuth), Math.sin(elev), Math.cos(elev) * Math.sin(azimuth)).normalize();
  const m = Math.max(Es[0], Es[1], Es[2]);
  ATMOS.sunColor = [Es[0] / m, Es[1] / m, Es[2] / m]; ATMOS.sunIntensity = m;
  ATMOS.skyE = [Ek[0], Ek[1], Ek[2]];
  ATMOS.fogColor = fog.map((c) => c * 0.92); ATMOS.fogSunColor = fogS.map((c) => c * 1.05);
  const sinE = Math.sin(elev);
  ATMOS.groundBounce = groundAlbedo.map((a, k) => a * (Es[k] * sinE + Ek[k]) / Math.PI);
  // 4) 生成 GPU 贴图：可见天空（保留太阳亮度用于泛光）与环境光版本（钳掉太阳，避免与实时太阳光重复）
  const n = w * h; const sky = new Uint16Array(n * 4), env = new Uint16Array(n * 4); const toH = THREE.DataUtils.toHalfFloat; const clampEnv = envMax * s;
  for (let y = 0; y < h; y++) {
    const srcY = flipped ? h - 1 - y : y;
    for (let x = 0; x < w; x++) {
      const i = (srcY * w + x) * ch, o = (y * w + x) * 4;
      const r = d[i] * s, g = d[i + 1] * s, b = d[i + 2] * s; const L = lum(r, g, b); const ks = L > 400 ? 400 / L : 1; const ke = L > clampEnv ? clampEnv / L : 1;
      sky[o] = toH(r * ks); sky[o + 1] = toH(g * ks); sky[o + 2] = toH(b * ks); sky[o + 3] = toH(1);
      env[o] = toH(r * ke); env[o + 1] = toH(g * ke); env[o + 2] = toH(b * ke); env[o + 3] = toH(1);
    }
  }
  const mk = (data) => { const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.HalfFloatType); t.flipY = tex.flipY; t.colorSpace = THREE.LinearSRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true; return t; };
  tex.dispose();
  ATMOS.hdri = { sky: mk(sky), env: mk(env), rot, tilt, tiltAxis: new THREE.Vector3(-Math.sin(azimuth), 0, Math.cos(azimuth)), vFlip: tex.flipY ? 1 : 0 };
  return { elevDeg: elev * 180 / Math.PI, ratio: ratio * boost, sunE: Es, skyE: Ek, fog: ATMOS.fogColor, fogSun: ATMOS.fogSunColor, boost };
}
