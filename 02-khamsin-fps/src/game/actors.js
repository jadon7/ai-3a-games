// AI 单位：步兵 / 追猎者机器人 / 狙击手（刚性蒙皮骨骼 + 程序动画）与无人机
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { rayCapsule } from './player.js';
import { applyScreenAO } from '../gfx/materials.js';
import { hasSoldierModel, humanGeometry } from './soldierloader.js';
import { gaitPose } from './gait.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _e = new THREE.Euler();
const rnd = (a, b) => a + Math.random() * (b - a);
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

const BONES = [
  ['hips', -1, 0, 0.98, 0], ['spine', 0, 0, 1.10, 0], ['head', 1, 0, 1.56, 0],
  ['armL', 1, -0.21, 1.46, 0], ['foreL', 3, -0.23, 1.18, 0], ['armR', 1, 0.21, 1.46, 0], ['foreR', 5, 0.23, 1.18, 0],
  ['legL', 0, -0.1, 0.94, 0], ['shinL', 7, -0.1, 0.50, 0], ['legR', 0, 0.1, 0.94, 0], ['shinR', 9, 0.1, 0.50, 0], ['gun', 1, 0.085, 1.365, -0.2],
  ['footL', 8, -0.1, 0.09, 0], ['footR', 10, 0.1, 0.09, 0],   // 脚踝：追加在末尾，前 12 根的序号不变
];

// 各阵营配色。rgba：a = 迷彩贴图的混合权重（1 = 全迷彩布料，0 = 纯色装备，此时 rgb 即反照率）
const PAL = {
  friend: {
    cloth: [1, 1, 1, 1], vest: [0.36, 0.30, 0.21, 0.35], pouch: [0.29, 0.24, 0.165, 0.35], helmet: [0.92, 0.88, 0.80, 1], pad: [0.065, 0.06, 0.055, 0], dark: [0.035, 0.035, 0.04, 0],
    boot: [0.25, 0.19, 0.13, 0.25], glove: [0.10, 0.09, 0.075, 0], face: [0.46, 0.41, 0.31, 0.7], accent: [0.07, 0.30, 0.52, 0], gunTan: [0.33, 0.26, 0.17, 0], visor: [0.25, 1.1, 1.5],
    // 真人模型（soldier.glb）用到的槽位；human 里是对上面同名键的覆盖（程序化士兵不受影响）
    skin: [0.60, 0.37, 0.25, 0], eye: [0.40, 0.385, 0.365, 0], iris: [0.10, 0.06, 0.035, 0], lens: [0.02, 0.025, 0.03, 0], strap: [0.05, 0.045, 0.036, 0],
    human: { pad: [0.028, 0.026, 0.024, 0], dark: [0.02, 0.02, 0.022, 0], boot: [0.12, 0.085, 0.055, 0.25], glove: [0.045, 0.04, 0.034, 0] },
  },
  enemy: {
    cloth: [1.85, 1.7, 1.6, 1], vest: [0.15, 0.15, 0.165, 0.3], pouch: [0.115, 0.115, 0.13, 0.3], helmet: [0.115, 0.115, 0.13, 0.35], pad: [0.07, 0.07, 0.075, 0], dark: [0.035, 0.035, 0.04, 0],
    boot: [0.05, 0.05, 0.055, 0], glove: [0.06, 0.06, 0.065, 0], face: [0.12, 0.12, 0.135, 0], accent: [0.95, 0.07, 0.04, 0], gunTan: [0.075, 0.075, 0.08, 0], visor: [3.4, 0.5, 0.14],
    skin: [0.50, 0.305, 0.20, 0], eye: [0.40, 0.385, 0.365, 0], iris: [0.07, 0.045, 0.03, 0], lens: [0.02, 0.025, 0.03, 0], strap: [0.03, 0.03, 0.033, 0],
    human: { face: [0.50, 0.05, 0.035, 0], pad: [0.014, 0.014, 0.016, 0], dark: [0.018, 0.018, 0.02, 0], boot: [0.022, 0.022, 0.024, 0], glove: [0.028, 0.028, 0.03, 0] },   // 头巾面巾：暗红（“赤蝎”）
  },
  sniper: {
    cloth: [1.45, 1.6, 1.15, 1], vest: [0.15, 0.17, 0.10, 0.3], pouch: [0.12, 0.14, 0.085, 0.3], helmet: [1.3, 1.45, 1.05, 1], pad: [0.05, 0.05, 0.05, 0], dark: [0.03, 0.03, 0.035, 0],
    boot: [0.05, 0.05, 0.045, 0], glove: [0.06, 0.065, 0.05, 0], face: [0.10, 0.11, 0.08, 0], accent: [0.9, 0.62, 0.06, 0], gunTan: [0.13, 0.15, 0.09, 0], visor: [3.0, 2.2, 0.3],
    skin: [0.54, 0.33, 0.22, 0], eye: [0.40, 0.385, 0.365, 0], iris: [0.08, 0.05, 0.03, 0], lens: [0.02, 0.025, 0.03, 0], strap: [0.04, 0.045, 0.03, 0],
    human: { pad: [0.014, 0.015, 0.012, 0], dark: [0.018, 0.018, 0.02, 0], boot: [0.022, 0.022, 0.02, 0], glove: [0.03, 0.032, 0.025, 0] },
  },
  robot: { cloth: [0.085, 0.085, 0.095, 0.4], vest: [0.17, 0.17, 0.19, 0.6], pouch: [0.12, 0.12, 0.13, 0.5], helmet: [0.26, 0.255, 0.25, 0.7], pad: [0.07, 0.07, 0.075, 0], dark: [0.035, 0.035, 0.04, 0], accent: [0.85, 0.08, 0.04, 0], gunTan: [0.06, 0.06, 0.065, 0], visor: [3.6, 0.3, 0.1] },
};

// mode：'full' 程序化士兵；'gun' 只生成挂在枪骨骼上的步枪（真人模型用它与 GLB 里的身体合并）；
//       'shadow' 真人模型的阴影替身 —— 比身体略瘦的胶囊人 + 步枪，只用来投影（远处的兵不必把三万多面的网格再画进两级阴影）
function soldierGeometry(kind, mode = 'full') {
  const C = PAL[kind]; const robot = kind === 'robot'; const longGun = kind === 'sniper'; const full = kind === 'enemy' || kind === 'sniper';
  const parts = []; const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), UPV = new THREE.Vector3(0, 1, 0);
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  // 写入蒙皮/颜色/UV。wfn(p) 返回该顶点分给父骨骼的权重
  const add = (bone, g, col, parent = bone, wfn = null) => {
    if (g.index) g = g.toNonIndexed();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    const pos = g.attributes.position, nrm = g.attributes.normal, n = pos.count; const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), c = new Float32Array(n * 4), uv = new Float32Array(n * 2), sf = new Float32Array(n * 3); const p = new THREE.Vector3(); const ca = col.length > 3 ? col[3] : 1;
    for (let i = 0; i < n; i++) {
      p.fromBufferAttribute(pos, i); const w = wfn ? Math.max(0, Math.min(1, wfn(p))) : 0;
      si[i * 4] = bone; si[i * 4 + 1] = parent; sw[i * 4] = 1 - w; sw[i * 4 + 1] = w; sf[i * 3] = bone === 11 ? 0.2 : 1; sf[i * 3 + 1] = 0.5; c[i * 4] = col[0]; c[i * 4 + 1] = col[1]; c[i * 4 + 2] = col[2]; c[i * 4 + 3] = ca;
      const ax = Math.abs(nrm.getX(i)), ay = Math.abs(nrm.getY(i)), az = Math.abs(nrm.getZ(i)); const k = 1 / 0.5;
      if (ax >= ay && ax >= az) { uv[i * 2] = p.z * k; uv[i * 2 + 1] = p.y * k; } else if (az >= ay) { uv[i * 2] = p.x * k; uv[i * 2 + 1] = p.y * k; } else { uv[i * 2] = p.x * k; uv[i * 2 + 1] = p.z * k; }
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4)); g.setAttribute('color', new THREE.BufferAttribute(c, 4)); g.setAttribute('aSurf', new THREE.BufferAttribute(sf, 3));
    parts.push(g);
  };
  // 变径胶囊：a→b，靠近 a 端的一段与父骨骼混合蒙皮，关节弯曲更自然
  const capsule = (bone, parent, a, b, r0, r1, col, blend = 0.24) => {
    const d = new THREE.Vector3().subVectors(b, a); const len = d.length(); const dir = d.clone().normalize();
    const body = new THREE.CylinderGeometry(r1, r0, len, 12, 3, true).toNonIndexed();
    const capA = new THREE.SphereGeometry(r0, 12, 5, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).toNonIndexed(); capA.translate(0, -len / 2, 0);
    const capB = new THREE.SphereGeometry(r1, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2).toNonIndexed(); capB.translate(0, len / 2, 0);
    const g = mergeGeometries([body, capA, capB]);
    g.applyMatrix4(m4.compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), q4.setFromUnitVectors(UPV, dir), V(1, 1, 1)));
    add(bone, g, col, parent, parent === bone ? null : (p) => { const t = p.clone().sub(a).dot(dir) / len; return t < blend ? 0.5 * (1 - t / blend) : 0; });
  };
  const ell = (bone, col, x, y, z, rx, ry, rz, parent = bone, w = 0, ws = 14, hs = 10) => { const g = new THREE.SphereGeometry(1, ws, hs); g.scale(rx, ry, rz); g.translate(x, y, z); add(bone, g, col, parent, w ? () => w : null); };
  const rb = (bone, col, w, h, d, x, y, z, rx = 0, rz = 0, r = 0.02, ry = 0) => { const g = new RoundedBoxGeometry(w, h, d, 1, Math.min(r, Math.min(w, h, d) * 0.4)); _e.set(rx, ry, rz); g.applyMatrix4(m4.compose(V(x, y, z), q4.setFromEuler(_e), V(1, 1, 1))); add(bone, g, col); };
  const cyl = (bone, col, r, len, x, y, z, axis = 'z', r2 = r) => { const g = new THREE.CylinderGeometry(r2, r, len, 10); if (axis === 'z') g.rotateX(Math.PI / 2); else if (axis === 'x') g.rotateZ(Math.PI / 2); g.translate(x, y, z); add(bone, g, col); };
  const ring = (bone, col, x, y, z, rx, rz) => { const g = new THREE.TorusGeometry(1, 0.07, 6, 22); g.rotateX(Math.PI / 2); g.scale(rx, 0.13, rz); g.translate(x, y, z); add(bone, g, col); };

  if (mode === 'gun') { /* 身体来自 soldier.glb */ } else if (mode === 'shadow') {
    const c = C.dark;
    ell(0, c, 0, 0.99, 0, 0.15, 0.125, 0.1, 0, 0, 10, 8); ell(1, c, 0, 1.3, 0, 0.165, 0.2, 0.105, 0, 0, 10, 8); ell(2, c, 0, 1.7, -0.012, kind === 'friend' ? 0.103 : 0.095, 0.122, 0.112, 2, 0, 10, 8);
    if (kind === 'friend') rb(1, c, 0.2, 0.3, 0.07, 0, 1.335, 0.2, 0, 0, 0.02);
    for (const s of [-1, 1]) {
      const up = s < 0 ? 3 : 5, lo = s < 0 ? 4 : 6, lu = s < 0 ? 7 : 9, ll = s < 0 ? 8 : 10;
      capsule(up, 1, V(s * 0.208, 1.455, 0), V(s * 0.226, 1.19, 0), 0.05, 0.042, c); capsule(lo, up, V(s * 0.226, 1.19, 0), V(s * 0.236, 0.92, 0), 0.04, 0.036, c);
      capsule(lu, 0, V(s * 0.1, 0.93, 0), V(s * 0.1, 0.52, 0), 0.082, 0.062, c); capsule(ll, lu, V(s * 0.1, 0.52, 0), V(s * 0.1, 0.1, 0), 0.06, 0.046, c); rb(ll, c, 0.09, 0.075, 0.25, s * 0.1, 0.04, -0.06, 0, 0, 0.025);
    }
  } else if (robot) {
    // 追猎者：重装战斗机器人 —— 装甲外壳 + 液压骨架
    rb(0, C.vest, 0.27, 0.13, 0.17, 0, 0.955, 0, 0, 0, 0.04); rb(0, C.helmet, 0.16, 0.1, 0.05, 0, 0.95, -0.095, 0, 0, 0.02); for (const s of [-1, 1]) ell(0, C.dark, s * 0.1, 0.94, 0, 0.068, 0.068, 0.068);
    cyl(1, C.dark, 0.05, 0.2, 0, 1.11, 0, 'y'); for (const s of [-1, 1]) { cyl(1, C.cloth, 0.014, 0.2, s * 0.075, 1.11, -0.03, 'y'); cyl(1, C.cloth, 0.014, 0.2, s * 0.075, 1.11, 0.05, 'y'); }
    rb(1, C.vest, 0.4, 0.3, 0.25, 0, 1.36, 0.0, 0, 0, 0.06); rb(1, C.helmet, 0.3, 0.19, 0.05, 0, 1.395, -0.135, -0.12, 0, 0.02); rb(1, C.helmet, 0.22, 0.1, 0.05, 0, 1.255, -0.118, 0.2, 0, 0.02);
    rb(1, C.accent, 0.035, 0.15, 0.012, -0.085, 1.4, -0.166, -0.12, 0, 0.004); rb(1, C.accent, 0.035, 0.15, 0.012, -0.035, 1.4, -0.166, -0.12, 0, 0.004); rb(1, C.dark, 0.08, 0.05, 0.012, 0.08, 1.43, -0.166, -0.12, 0, 0.004);
    rb(1, C.dark, 0.28, 0.27, 0.1, 0, 1.36, 0.165, 0, 0, 0.03); for (const x of [-0.08, 0, 0.08]) rb(1, C.cloth, 0.05, 0.2, 0.02, x, 1.36, 0.222, 0, 0, 0.006); cyl(1, C.dark, 0.03, 0.12, 0.1, 1.54, 0.15, 'y'); cyl(1, C.dark, 0.006, 0.3, -0.12, 1.62, 0.15, 'y');
    for (const s of [-1, 1]) { ell(1, C.dark, s * 0.225, 1.465, 0, 0.07, 0.07, 0.07); rb(1, C.helmet, 0.13, 0.07, 0.17, s * 0.245, 1.52, 0, 0, s * -0.35, 0.03); }
    capsule(2, 1, V(0, 1.5, 0), V(0, 1.6, 0), 0.036, 0.034, C.dark); rb(2, C.helmet, 0.15, 0.125, 0.2, 0, 1.672, 0.0, 0, 0, 0.04); rb(2, C.dark, 0.125, 0.07, 0.04, 0, 1.668, -0.098, 0, 0, 0.015); rb(2, C.vest, 0.16, 0.03, 0.14, 0, 1.742, 0.02, 0, 0, 0.012);
    for (const s of [-1, 1]) { cyl(2, C.dark, 0.03, 0.03, s * 0.08, 1.665, 0.01, 'x'); rb(2, C.dark, 0.008, 0.11, 0.012, s * 0.088, 1.76, 0.05, -0.3, 0, 0.002); }
    rb(2, C.accent, 0.04, 0.012, 0.1, 0, 1.737, -0.04, 0, 0, 0.004);
    for (const s of [-1, 1]) {
      const up = s < 0 ? 3 : 5, lo = s < 0 ? 4 : 6;
      capsule(up, 1, V(s * 0.215, 1.455, 0), V(s * 0.226, 1.19, 0), 0.04, 0.036, C.cloth); rb(up, C.helmet, 0.09, 0.19, 0.1, s * 0.232, 1.335, 0.0, 0, 0, 0.03); cyl(up, C.dark, 0.012, 0.2, s * 0.2, 1.32, 0.045, 'y');
      ell(lo, C.dark, s * 0.226, 1.185, 0, 0.05, 0.05, 0.05); capsule(lo, up, V(s * 0.226, 1.18, 0), V(s * 0.236, 0.95, 0), 0.036, 0.03, C.cloth); rb(lo, C.helmet, 0.078, 0.16, 0.086, s * 0.233, 1.065, 0.0, 0, 0, 0.026);
      rb(lo, C.dark, 0.06, 0.07, 0.05, s * 0.238, 0.905, 0, 0, 0, 0.015); for (const f of [-0.018, 0, 0.018]) rb(lo, C.dark, 0.014, 0.06, 0.016, s * 0.238 + f, 0.85, -0.012, 0.25, 0, 0.004);
      const lu = s < 0 ? 7 : 9, ll = s < 0 ? 8 : 10, lf = s < 0 ? 12 : 13;
      capsule(lu, 0, V(s * 0.1, 0.93, 0), V(s * 0.1, 0.52, 0), 0.056, 0.046, C.cloth); rb(lu, C.helmet, 0.12, 0.27, 0.13, s * 0.104, 0.74, -0.012, 0, 0, 0.035); rb(lu, C.accent, 0.02, 0.1, 0.012, s * 0.14, 0.78, -0.08, 0, 0, 0.004); cyl(lu, C.dark, 0.013, 0.3, s * 0.1, 0.72, 0.065, 'y');
      ell(ll, C.dark, s * 0.1, 0.51, 0, 0.064, 0.064, 0.064); rb(ll, C.helmet, 0.09, 0.1, 0.04, s * 0.1, 0.51, -0.07, 0, 0, 0.018);
      capsule(ll, lu, V(s * 0.1, 0.5, 0), V(s * 0.1, 0.11, 0), 0.046, 0.036, C.cloth); rb(ll, C.helmet, 0.1, 0.25, 0.11, s * 0.1, 0.32, -0.016, 0, 0, 0.03); cyl(ll, C.dark, 0.012, 0.26, s * 0.1, 0.3, 0.06, 'y');
      ell(ll, C.dark, s * 0.1, 0.095, 0, 0.045, 0.045, 0.045); rb(lf, C.vest, 0.1, 0.07, 0.2, s * 0.1, 0.04, -0.06, 0, 0, 0.025); rb(lf, C.dark, 0.09, 0.05, 0.08, s * 0.1, 0.03, 0.06, 0, 0, 0.02); rb(lf, C.helmet, 0.08, 0.04, 0.07, s * 0.1, 0.065, -0.14, 0.3, 0, 0.012);
    }
  } else {
    // ---- 躯干 ----
    ell(0, C.cloth, 0, 0.965, 0.0, 0.176, 0.13, 0.122); ell(1, C.cloth, 0, 1.11, 0.0, 0.172, 0.14, 0.118, 0, 0.5); ell(1, C.cloth, 0, 1.33, 0.0, 0.19, 0.19, 0.122);
    for (const s of [-1, 1]) ell(1, C.cloth, s * 0.192, 1.462, 0, 0.082, 0.072, 0.082);
    // 战术背心：前后插板、腰封、肩带、弹匣袋、电台、背包
    rb(1, C.vest, 0.31, 0.33, 0.075, 0, 1.325, -0.114, 0, 0, 0.03); rb(1, C.vest, 0.31, 0.35, 0.065, 0, 1.325, 0.11, 0, 0, 0.03); rb(1, C.vest, 0.39, 0.15, 0.23, 0, 1.2, 0, 0, 0, 0.04);
    for (const s of [-1, 1]) rb(1, C.vest, 0.06, 0.045, 0.21, s * 0.105, 1.494, 0.0, 0, 0, 0.015);
    for (const x of [-0.094, 0, 0.094]) { rb(1, C.pouch, 0.076, 0.14, 0.052, x, 1.222, -0.172, 0, 0, 0.012); rb(1, C.dark, 0.052, 0.034, 0.03, x, 1.302, -0.17, 0, 0, 0.006); rb(1, C.vest, 0.03, 0.05, 0.008, x, 1.27, -0.2, 0, 0, 0.003); }
    rb(1, C.pouch, 0.16, 0.085, 0.036, 0, 1.405, -0.158, 0, 0, 0.012); rb(1, C.dark, 0.052, 0.105, 0.038, -0.118, 1.405, -0.152, 0, 0, 0.01); cyl(1, C.dark, 0.005, 0.26, -0.13, 1.575, -0.145, 'y'); rb(1, C.dark, 0.03, 0.04, 0.03, 0.118, 1.435, -0.155, 0, 0, 0.008);
    for (const s of [-1, 1]) rb(1, C.pouch, 0.045, 0.11, 0.11, s * 0.2, 1.2, 0.0, 0, 0, 0.014);
    rb(1, C.pouch, 0.26, 0.34, 0.11, 0, 1.335, 0.195, 0, 0, 0.04); rb(1, C.vest, 0.2, 0.12, 0.05, 0, 1.3, 0.27, 0, 0, 0.02); cyl(1, C.pouch, 0.045, 0.24, 0, 1.52, 0.2, 'x'); rb(1, C.dark, 0.02, 0.3, 0.012, -0.07, 1.34, 0.252, 0, 0, 0.004); rb(1, C.dark, 0.02, 0.3, 0.012, 0.07, 1.34, 0.252, 0, 0, 0.004);
    rb(1, C.accent, 0.085, 0.05, 0.012, 0.085, 1.45, -0.154, 0, 0, 0.004);
    // 腰带、腿挂枪套、杂物袋
    rb(0, C.dark, 0.36, 0.05, 0.25, 0, 1.03, 0, 0, 0, 0.02); rb(0, C.pad, 0.05, 0.036, 0.02, 0, 1.03, -0.128, 0, 0, 0.006);
    rb(0, C.pouch, 0.07, 0.11, 0.09, -0.19, 0.975, -0.02, 0, 0, 0.015); rb(0, C.pouch, 0.06, 0.09, 0.07, 0.19, 0.985, 0.03, 0, 0, 0.015); rb(0, C.pouch, 0.12, 0.1, 0.06, 0, 0.985, 0.14, 0, 0, 0.02);
    rb(9, C.dark, 0.046, 0.18, 0.1, 0.196, 0.77, 0.0, 0, 0, 0.015); rb(9, C.dark, 0.21, 0.028, 0.2, 0.11, 0.8, 0, 0, 0, 0.01); rb(9, C.dark, 0.21, 0.028, 0.19, 0.11, 0.71, 0, 0, 0, 0.01); rb(9, C.dark, 0.03, 0.09, 0.035, 0.212, 0.84, 0.03, 0.3, 0, 0.008);
    // ---- 头部 ----
    capsule(2, 1, V(0, 1.49, 0.005), V(0, 1.6, 0), 0.06, 0.056, C.face);
    ell(2, C.face, 0, 1.668, -0.002, 0.09, 0.112, 0.098);
    { const g = new THREE.SphereGeometry(1, 18, 9, 0, Math.PI * 2, 0, Math.PI * 0.52); g.scale(0.121, 0.123, 0.136); g.translate(0, 1.708, 0.006); add(2, g, C.helmet); }
    ring(2, C.helmet, 0, 1.701, 0.006, 0.1205, 0.1355);
    for (const s of [-1, 1]) { rb(2, C.dark, 0.034, 0.084, 0.074, s * 0.11, 1.66, 0.008, 0, 0, 0.014); rb(2, C.dark, 0.012, 0.024, 0.11, s * 0.121, 1.728, -0.004, 0, 0, 0.004); rb(2, C.dark, 0.006, 0.1, 0.016, s * 0.094, 1.625, -0.02, 0.35, 0, 0.002); }
    rb(2, C.dark, 0.05, 0.04, 0.02, 0, 1.752, -0.122, -0.25, 0, 0.006); rb(2, C.dark, 0.17, 0.064, 0.044, 0, 1.682, -0.084, 0, 0, 0.02);
    if (full) {
      // 敌军：全覆式面甲 + 呼吸器 + 护颈，头盔顶部红色识别条
      ell(2, C.helmet, 0, 1.628, -0.03, 0.09, 0.088, 0.088); cyl(2, C.dark, 0.03, 0.045, 0, 1.6, -0.115); cyl(2, C.pad, 0.022, 0.012, 0, 1.6, -0.142);
      for (const s of [-1, 1]) cyl(2, C.dark, 0.022, 0.05, s * 0.068, 1.594, -0.075, 'x');
      cyl(2, C.dark, 0.082, 0.075, 0, 1.53, 0.0, 'y', 0.07); rb(2, C.accent, 0.022, 0.012, 0.2, 0, 1.83, 0.0, 0, 0, 0.004); rb(2, C.helmet, 0.06, 0.06, 0.1, 0, 1.69, 0.13, 0, 0, 0.02);
    } else {
      // 友军：包头巾遮面 + 围巾，头盔顶识别灯
      ell(2, C.face, 0, 1.612, -0.046, 0.068, 0.06, 0.06); ell(2, C.cloth, 0, 1.532, -0.012, 0.108, 0.05, 0.102, 1, 0.5); ell(2, C.cloth, 0.03, 1.5, -0.085, 0.06, 0.05, 0.035, 1, 0.6);
      rb(2, C.accent, 0.036, 0.012, 0.046, 0, 1.829, 0.02, 0, 0, 0.004); rb(2, C.dark, 0.05, 0.03, 0.05, 0.0, 1.76, 0.128, 0, 0, 0.01);
    }
    // ---- 四肢 ----
    for (const s of [-1, 1]) {
      const up = s < 0 ? 3 : 5, lo = s < 0 ? 4 : 6;
      capsule(up, 1, V(s * 0.208, 1.455, 0), V(s * 0.226, 1.19, 0), 0.062, 0.052, C.cloth); capsule(lo, up, V(s * 0.226, 1.19, 0), V(s * 0.236, 0.955, 0), 0.05, 0.04, C.cloth);
      rb(lo, C.pad, 0.078, 0.092, 0.05, s * 0.228, 1.172, 0.04, 0, 0, 0.022); rb(up, C.accent, 0.012, 0.06, 0.055, s * 0.27, 1.37, 0, 0, 0, 0.004); rb(up, C.cloth, 0.02, 0.09, 0.08, s * 0.27, 1.3, 0, 0, 0, 0.008);
      if (full) rb(up, C.vest, 0.1, 0.11, 0.13, s * 0.232, 1.445, 0, 0, s * -0.25, 0.035);
      cyl(lo, C.glove, 0.044, 0.05, s * 0.236, 0.955, 0, 'y', 0.041); ell(lo, C.glove, s * 0.238, 0.9, -0.004, 0.04, 0.056, 0.048); rb(lo, C.glove, 0.05, 0.05, 0.07, s * 0.238, 0.865, -0.016, 0, 0, 0.018); rb(lo, C.pad, 0.03, 0.04, 0.05, s * 0.238 + s * 0.03, 0.905, -0.005, 0, 0, 0.01);
      const lu = s < 0 ? 7 : 9, ll = s < 0 ? 8 : 10, lf = s < 0 ? 12 : 13;
      capsule(lu, 0, V(s * 0.1, 0.93, 0), V(s * 0.1, 0.52, 0), 0.1, 0.076, C.cloth); capsule(ll, lu, V(s * 0.1, 0.52, 0), V(s * 0.1, 0.13, 0), 0.073, 0.054, C.cloth);
      ell(ll, C.pad, s * 0.1, 0.505, -0.06, 0.068, 0.082, 0.042); rb(ll, C.dark, 0.142, 0.022, 0.13, s * 0.1, 0.46, 0.0, 0, 0, 0.008); rb(lu, C.cloth, 0.032, 0.15, 0.12, s * 0.19, 0.7, 0.0, 0, 0, 0.012); rb(lu, C.pouch, 0.034, 0.03, 0.124, s * 0.191, 0.765, 0.0, 0, 0, 0.008);
      // 靴子：靴筒 + 鞋面 + 鞋头 + 鞋底
      capsule(ll, ll, V(s * 0.1, 0.22, 0.004), V(s * 0.1, 0.09, 0.004), 0.056, 0.058, C.boot); rb(lf, C.boot, 0.1, 0.078, 0.2, s * 0.1, 0.055, -0.06, 0, 0, 0.03); ell(lf, C.boot, s * 0.1, 0.05, -0.155, 0.05, 0.042, 0.055);
      rb(lf, C.dark, 0.106, 0.024, 0.275, s * 0.1, 0.012, -0.055, 0, 0, 0.01); rb(lf, C.dark, 0.1, 0.03, 0.07, s * 0.1, 0.02, 0.05, 0, 0, 0.01);
    }
  }
  // ---- 步枪（挂在枪骨骼上，纯色）----
  const gx = 0.085, gy = 1.37, bl = longGun ? 0.44 : 0.13; const GD = C.dark, GT = C.gunTan; const Z = (z) => z + 0.05;
  rb(11, GD, 0.036, 0.092, 0.022, gx, gy - 0.02, Z(-0.045), 0, 0, 0.008); rb(11, GT, 0.034, 0.072, 0.17, gx, gy - 0.016, Z(-0.14), 0, 0, 0.012); cyl(11, GD, 0.013, 0.2, gx, gy + 0.004, Z(-0.16));
  rb(11, GD, 0.044, 0.076, 0.27, gx, gy - 0.004, Z(-0.37), 0, 0, 0.01); rb(11, GD, 0.03, 0.155, 0.058, gx, gy - 0.1, Z(-0.44), -0.2, 0, 0.008); rb(11, GT, 0.03, 0.1, 0.042, gx, gy - 0.08, Z(-0.285), 0.35, 0, 0.012);
  rb(11, GT, 0.046, 0.058, 0.27, gx, gy, Z(-0.635), 0, 0, 0.014); rb(11, GD, 0.02, 0.012, 0.47, gx, gy + 0.039, Z(-0.535), 0, 0, 0.003);
  cyl(11, GD, 0.0095, bl, gx, gy, Z(-0.77 - bl / 2)); cyl(11, GD, 0.015, 0.06, gx, gy, Z(-0.77 - bl - 0.028)); rb(11, GD, 0.026, 0.085, 0.03, gx, gy - 0.065, Z(-0.55), 0.1, 0, 0.008); rb(11, GD, 0.028, 0.026, 0.07, gx + 0.03, gy + 0.012, Z(-0.71), 0, 0, 0.006);
  if (longGun) { cyl(11, GD, 0.019, 0.3, gx, gy + 0.075, Z(-0.42)); cyl(11, GD, 0.026, 0.07, gx, gy + 0.075, Z(-0.59)); cyl(11, GD, 0.023, 0.05, gx, gy + 0.075, Z(-0.26)); rb(11, GD, 0.02, 0.03, 0.12, gx, gy + 0.048, Z(-0.42), 0, 0, 0.004); rb(11, GD, 0.012, 0.16, 0.012, gx - 0.03, gy - 0.1, Z(-0.72), 0.5, 0, 0.003); rb(11, GD, 0.012, 0.16, 0.012, gx + 0.03, gy - 0.1, Z(-0.72), 0.5, 0, 0.003); }
  else { rb(11, GD, 0.036, 0.048, 0.07, gx, gy + 0.07, Z(-0.4), 0, 0, 0.008); rb(11, GD, 0.03, 0.014, 0.06, gx, gy + 0.045, Z(-0.4), 0, 0, 0.003); rb(11, GD, 0.012, 0.03, 0.012, gx, gy + 0.058, Z(-0.73), 0, 0, 0.003); }
  let g = mergeGeometries(parts); g = mergeVertices(g, 1e-4); g.computeBoundingSphere();
  return g;
}

let ASSETS = null;
function assets(game) {
  if (ASSETS) return ASSETS;
  const T = game.engine.T;
  // 顶点色 alpha 控制迷彩贴图权重：布料吃迷彩，装备（枪、靴、护具）保持纯色
  const patch = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', '#ifdef USE_MAP\n\tvec4 sampledDiffuseColor = texture2D( map, vMapUv );\n\t#ifdef USE_COLOR_ALPHA\n\t\tdiffuseColor.rgb *= mix( vec3( 1.0 ), sampledDiffuseColor.rgb, vColor.a );\n\t#else\n\t\tdiffuseColor.rgb *= sampledDiffuseColor.rgb;\n\t#endif\n#endif'); };
  // 真人模型：aSurf = (布纹法线权重, 非布料表面的粗糙度, 是否皮肤) —— 皮肤、眼球、镜片、硬壳装备不吃布料的法线与粗糙度
  const patchH = (sh) => {
    patch(sh);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aSurf;\nvarying vec3 vSurf;').replace('#include <begin_vertex>', '#include <begin_vertex>\n  vSurf = aSurf;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vSurf;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor = mix( vSurf.y, roughnessFactor, vSurf.x );')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  metalnessFactor *= vSurf.x;')
      .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace('mapN.xy *= normalScale;', 'mapN.xy *= normalScale * vSurf.x;'));
  };
  const human = hasSoldierModel();
  const mk = (t, h = false) => () => { const m = new THREE.MeshStandardMaterial({ map: t.map, normalMap: t.normalMap, roughnessMap: t.ormMap, metalnessMap: t.ormMap, roughness: 1, metalness: 1, vertexColors: true, normalScale: new THREE.Vector2(0.8, 0.8) }); m.onBeforeCompile = h ? patchH : patch; m.customProgramCacheKey = () => (h ? 'soldierH' : 'soldier'); return applyScreenAO(m); };
  // 真人士兵：GLB 的身体 + 程序化的步枪；取不到 GLB 时退回程序化士兵
  const geo = (k) => { if (human) { const pal = { ...PAL[k], ...(PAL[k].human || {}) }; const g = humanGeometry(k, pal, soldierGeometry(k, 'gun')); if (g) return g; } return soldierGeometry(k); };
  ASSETS = {
    human, shadowGeo: human ? { friend: soldierGeometry('friend', 'shadow'), enemy: soldierGeometry('enemy', 'shadow'), sniper: soldierGeometry('sniper', 'shadow') } : null,
    shadowMat: new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
    geo: { friend: geo('friend'), enemy: geo('enemy'), robot: soldierGeometry('robot'), sniper: geo('sniper') },
    mat: { friend: mk(T.camoDesert, human), enemy: mk(T.camoDark, human), sniper: mk(T.camoDark, human), robot: mk(T.armorClean) },
    visorGeo: new THREE.BoxGeometry(0.135, 0.036, 0.012), iffGeo: new THREE.BoxGeometry(0.058, 0.034, 0.005), eyeGeo: new THREE.BoxGeometry(0.07, 0.03, 0.012),
    visorMat: {}, laserMat: new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.2, 0.1), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }),
  };
  for (const k in PAL) ASSETS.visorMat[k] = new THREE.MeshBasicMaterial({ color: new THREE.Color(PAL[k].visor[0], PAL[k].visor[1], PAL[k].visor[2]), fog: false });
  return ASSETS;
}

// 双骨骼手臂 IK：让手落在枪骨骼局部坐标 (lx,ly,lz) 处（肩、枪骨骼同以脊柱为父骨骼）
const _ik = { t: new THREE.Vector3(), d: new THREE.Vector3(), n: new THREE.Vector3(), u: new THREE.Vector3(), e: new THREE.Vector3(), f: new THREE.Vector3(), q: new THREE.Quaternion(), down: new THREE.Vector3(0, -1, 0) };
function armIK(up, lo, gun, lx, ly, lz, side) {
  const L1 = 0.281, L2 = 0.285;
  const t = _ik.t.set(lx, ly, lz).applyQuaternion(gun.quaternion).add(gun.position);
  const d = _ik.d.subVectors(t, up.position); const dist = Math.max(0.08, Math.min(d.length(), L1 + L2 - 0.004)); const n = _ik.n.copy(d).normalize();
  const al = Math.acos(Math.max(-1, Math.min(1, (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist))));
  const u = _ik.u.set(side * 0.6, -1, 0.3); u.addScaledVector(n, -u.dot(n)).normalize();   // 肘部朝外下方
  const e = _ik.e.copy(n).multiplyScalar(Math.cos(al) * L1).addScaledVector(u, Math.sin(al) * L1);
  up.quaternion.setFromUnitVectors(_ik.down, _ik.f.copy(e).normalize());
  const f = _ik.f.copy(n).multiplyScalar(dist).sub(e).normalize().applyQuaternion(_ik.q.copy(up.quaternion).invert());
  lo.quaternion.setFromUnitVectors(_ik.down, f);
}
const BLADE = 0.3;   // 持枪侧身角

const NAMES_F = ['渡鸦', '灰隼', '夜枭', '沙狐', '铁砧', '雨燕', '黑曜', '烛龙', '白桦', '孤星', '青鸟', '北辰', '苍鹭', '磐石'];
const KIND_NAME = { grunt: '步兵', stalker: '追猎者', sniper: '狙击手', drone: '无人机', mech: '机甲', pilot: '飞行员' };
export { KIND_NAME };
export { assets as soldierAssets };   // AI 铁驭（aipilot.js）复用同一套模型 / 材质

export class Soldier {
  constructor(game, kind, team, x, z, opts = {}) {
    this.game = game; this.kind = kind; this.team = team; this.robot = kind === 'stalker';
    const A = assets(game); const variant = kind === 'stalker' ? 'robot' : kind === 'sniper' ? 'sniper' : team === 0 ? 'friend' : 'enemy';
    this.pos = new THREE.Vector3(x, opts.y !== undefined ? opts.y : game.nav.heightSmooth(x, z), z);
    this.yaw = opts.yaw || Math.random() * 6.28; this.aimYaw = this.yaw; this.aimPitch = 0;
    this.maxHp = kind === 'stalker' ? 150 : team === 0 ? 85 : 60; this.hp = this.maxHp; this.alive = true; this.dead = 0;
    this.name = team === 0 ? NAMES_F[(Math.random() * NAMES_F.length) | 0] : '赤蝎' + KIND_NAME[kind];
    this.speed = kind === 'stalker' ? 3.5 : 4.3; this.radius = 0.38; this.height = 1.8;
    this.path = null; this.pathI = 0; this.repath = rnd(0, 1); this.goal = null; this.target = null; this.think = rnd(0, 0.4); this.seeT = 0; this.lostT = 0;
    this.burst = 0; this.shotT = 0; this.pauseT = rnd(0.3, 1.2); this.strafeT = 0; this.crouch = 0; this.crouchW = 0; this.meleeT = 0; this.alert = null;
    this.animT = Math.random() * 6; this.moveSp = 0; this.flinch = 0; this.fallDir = 1; this.fallYaw = 0; this.static = kind === 'sniper'; this.charge = 0; this.sniperCD = rnd(1, 3);
    this.vx = 0; this.vz = 0; this.ambient = 1; this.react = 0.5; this.hasLOS = false;
    this.slideT = 0; this.slideD = 1; this.slideCD = rnd(3, 9); this.slideW = 0; this.dodgeT = 0;   // 步兵的轻量动作：滑铲 / 受击侧滑
    // 模型
    const bones = BONES.map((b) => { const bn = new THREE.Bone(); bn.name = b[0]; return bn; });
    BONES.forEach((b, i) => { if (b[1] >= 0) { const p = BONES[b[1]]; bones[b[1]].add(bones[i]); bones[i].position.set(b[2] - p[2], b[3] - p[3], b[4] - p[4]); } else bones[i].position.set(b[2], b[3], b[4]); });
    this.mat = A.mat[variant]();
    const mesh = this.mesh = new THREE.SkinnedMesh(A.geo[variant], this.mat);
    mesh.add(bones[0]); mesh.bind(new THREE.Skeleton(bones));
    // 真人模型：共用骨架的阴影替身。离镜头近时由本体投影（保留头盔檐、装备的自阴影），远了换替身
    if (A.human && A.shadowGeo[variant]) { const sh = this.shadowMesh = new THREE.SkinnedMesh(A.shadowGeo[variant], A.shadowMat); mesh.add(sh); sh.bind(mesh.skeleton, mesh.bindMatrix); sh.castShadow = false; sh.visible = false; sh.frustumCulled = false; }
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.bones = bones;
    // 发光面罩：机器人和程序化士兵才有；真人露着眼睛，敌我靠臂章、头巾和制服颜色区分
    if (this.robot || !A.human) { const visor = new THREE.Mesh(this.robot ? A.eyeGeo : A.visorGeo, A.visorMat[variant]); visor.position.set(0, this.robot ? 0.108 : 0.122, this.robot ? -0.118 : -0.107); bones[2].add(visor); }
    // 真人友军：胸章和头盔后的识别灯发青色微光，远处也能一眼认出自己人
    else if (variant === 'friend') { const m = A.visorMat.friend; const chest = new THREE.Mesh(A.iffGeo, m); chest.position.set(0.042, 0.316, -0.1665); bones[1].add(chest); const strobe = new THREE.Mesh(A.iffGeo, m); strobe.scale.set(0.5, 0.45, 5); strobe.position.set(0, 0.2675, 0.056); bones[2].add(strobe); }
    mesh.position.copy(this.pos); mesh.rotation.y = this.yaw;
    this.phase = game.ctx || 0; game.entRoot.add(mesh);   // 多空间：属于创建时上下文所在的那一界
    if (kind === 'sniper') { this.laser = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), A.laserMat.clone()); this.laser.frustumCulled = false; this.laser.visible = false; this.laser.renderOrder = 7; game.entRoot.add(this.laser); this.maxHp = this.hp = 70; }
    this.pose(0, 0);
  }

  aimPoint(out) { return out.set(this.pos.x, this.pos.y + (this.crouchW > 0.5 ? 0.85 : 1.25), this.pos.z); }
  eye(out) { return out.set(this.pos.x, this.pos.y + (this.crouchW > 0.5 ? 1.15 : 1.58), this.pos.z); }
  hitTest(o, d, maxDist) {
    if (!this.alive) return -1;
    const h = this.crouchW > 0.5 ? 1.25 : 1.78;
    const t = rayCapsule(o, d, this.pos.x, this.pos.y + 0.36, this.pos.z, h - 0.72, 0.36, maxDist);
    if (t < 0) return -1;
    this._head = (o.y + d.y * t) > this.pos.y + h - 0.34;
    return t;
  }

  takeDamage(amount, from, info = {}) {
    if (!this.alive) return false;
    this.hp -= amount; this.flinch = 1;
    if (from && from.alive !== false && from.team !== this.team && !this.target) { this.alert = from.pos.clone(); this.target = from; this.seeT = 0.4; }
    if (this.hp <= 0) {
      this.alive = false; this.dead = 0; this.target = null;
      const d = info.dir; if (d) { const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw); this.fallDir = (d.x * fx + d.z * fz) > 0 ? -1 : 1; } else this.fallDir = Math.random() < 0.5 ? 1 : -1;
      this.fallYaw = rnd(-0.5, 0.5);
      if (this.laser) this.laser.visible = false;
      this.game.audio.play(this.robot ? 'robot_die' : 'impact_flesh', { x: this.pos.x, y: this.pos.y + 1, z: this.pos.z, volume: 0.8 });
      if (this.robot) this.game.fx.sparks(this.aimPoint(_v), null, 14, [1.5, 1.2, 0.8], 6);
      this.game.onKill(this, from, info);
      return true;
    }
    // 步兵受击反应：短促侧滑离开弹道，或就地蹲下
    if (this.kind === 'grunt' && from && from.pos && this.game.time > this.dodgeT) {
      this.dodgeT = this.game.time + rnd(2.5, 4.5); const nav = this.game.nav;
      const dx = this.pos.x - from.pos.x, dz = this.pos.z - from.pos.z, d = Math.hypot(dx, dz) || 1, sd = Math.random() < 0.5 ? 1 : -1;
      const x = this.pos.x - dz / d * sd * 3.2, z = this.pos.z + dx / d * sd * 3.2;
      if (Math.random() < 0.6 && nav.walkable(x, z) && nav.lineClear(this.pos.x, this.pos.z, x, z)) { this.path = [{ x, z }]; this.pathI = 0; this.slideT = this.slideD = 0.5; this.crouch = 0; this.strafeT = 1.1; this.slideFx = true; }
      else { this.crouch = 1; this.strafeT = rnd(1.0, 1.6); this.path = null; }
    }
    return false;
  }

  remove() { this.mesh.removeFromParent(); if (this.laser) this.laser.removeFromParent(); this.mat.dispose(); this.mesh.skeleton.dispose(); }

  update(dt, camDist) {
    const g = this.game, nav = g.nav;
    if (!this.alive) { this.dead += dt; this.animateDeath(dt); return this.dead < 9; }
    this.think -= dt; this.repath -= dt; this.pauseT -= dt; this.flinch = Math.max(0, this.flinch - dt * 4); this.meleeT -= dt;
    // —— 感知 ——
    if (this.think <= 0) { this.think = rnd(0.22, 0.4); this.perceive(); }
    const tgt = this.target;
    let wantX = 0, wantZ = 0, moving = false, speed = this.speed;
    if (tgt && tgt.alive !== false) {
      tgt.aimPoint(_v); const dx = _v.x - this.pos.x, dz = _v.z - this.pos.z; const dist = Math.hypot(dx, dz);
      this.aimYaw = Math.atan2(-dx, -dz); this.aimPitch = Math.atan2(_v.y - (this.pos.y + 1.4), Math.max(1, dist));
      this.seeT += dt;
      if (this.kind === 'sniper') this.updateSniper(dt, tgt, dist);
      else {
        // 站位：保持交战距离
        const far = this.kind === 'stalker' ? 9 : 30, near = this.kind === 'stalker' ? 0 : 7;
        this.strafeT -= dt;
        if (dist > far || !this.hasLOS) { if (this.repath <= 0) { this.setPath(_v.x, _v.z); this.repath = rnd(0.8, 1.5); } moving = this.followPath(dt); speed = this.speed * (this.kind === 'stalker' ? 1 : 0.85); }
        else if (dist < near && this.strafeT <= 0) { const p = nav.randomNear(this.pos.x - dx / dist * 6, this.pos.z - dz / dist * 6, 4); if (p) this.setPath(p.x, p.z); this.strafeT = rnd(1.5, 3); }
        else if (this.strafeT <= 0) {
          this.strafeT = rnd(1.6, 4.2); this.crouch = Math.random() < 0.3 && this.kind === 'grunt' ? 1 : 0;
          if (!this.crouch && Math.random() < 0.75) { const p = nav.randomNear(this.pos.x, this.pos.z, 4.5); if (p) this.setPath(p.x, p.z); } else this.path = null;
        }
        if (!moving && this.path && !this.crouch) { moving = this.followPath(dt); speed = this.speed * 0.6; }
        // 开火
        if (this.kind === 'stalker' && dist < 2.3) { if (this.meleeT <= 0) { this.meleeT = 1.1; tgt.takeDamage(tgt.isPlayer ? 34 : 60, this, { melee: true, dir: _v2.set(dx / dist, 0, dz / dist) }); g.audio.play('melee_hit', { x: this.pos.x, y: this.pos.y + 1, z: this.pos.z }); } }
        else if (this.hasLOS && this.seeT > this.react) this.shoot(dt, tgt, dist);
      }
    } else {
      this.target = null; this.seeT = 0; this.crouch = 0; this.charge = 0; if (this.laser) this.laser.visible = false;
      if (!this.static) {
        if (!this.path || this.repath <= 0 && this.pathI >= (this.path ? this.path.length : 0)) this.pickGoal();
        moving = this.followPath(dt);
        if (moving) this.aimYaw = Math.atan2(-this.vx, -this.vz); this.aimPitch *= 0.9;
      }
    }
    // 步兵滑铲：转移 / 冲向交战点的长直路上偶尔来一段（姿态 + 先快后慢的速度曲线）
    if (this.kind === 'grunt') {
      this.slideCD -= dt;
      if (this.slideT <= 0 && moving && this.slideCD <= 0 && !this.crouch && this.path && (!tgt || !this.hasLOS)) {
        const wp = this.path[this.pathI]; if (wp && Math.hypot(wp.x - this.pos.x, wp.z - this.pos.z) > 6.5) { this.slideT = this.slideD = rnd(0.7, 0.95); this.slideFx = true; }
        this.slideCD = rnd(6, 13);
      }
      if (this.slideT > 0) {
        if (this.slideFx) { this.slideFx = false; if (camDist < 60) { g.fx.dustPuff(this.pos, 4, 0.5); g.audio.play('slide_start', { x: this.pos.x, y: this.pos.y + 0.3, z: this.pos.z, volume: 0.5 }); } }
        this.slideT -= dt; if (!moving) this.slideT = 0; else speed = this.speed * (1.0 + 1.15 * Math.max(0, this.slideT / this.slideD));
      }
    }
    this.slideW += ((this.slideT > 0 ? 1 : 0) - this.slideW) * Math.min(1, dt * 11);
    // —— 移动 ——
    if (moving && !this.static) {
      let mx = this.vx * speed * dt, mz = this.vz * speed * dt;
      // 与其他单位分离
      for (const o of g.actors) { if (o === this || !o.alive || o.kind === 'drone' || (o.phase || 0) !== this.phase) continue; const ox = this.pos.x - o.pos.x, oz = this.pos.z - o.pos.z; const d2 = ox * ox + oz * oz; if (d2 < 0.8 && d2 > 1e-4) { const d = Math.sqrt(d2); mx += ox / d * (0.9 - d) * 2.5 * dt; mz += oz / d * (0.9 - d) * 2.5 * dt; } }
      { const pl = g.player; if (pl.alive && !pl.inMech && this.kind !== 'stalker' && this.phase === g.phase) { const ox = this.pos.x - pl.pos.x, oz = this.pos.z - pl.pos.z; const d2 = ox * ox + oz * oz; if (d2 < 2.0 && d2 > 1e-4 && Math.abs(pl.pos.y - this.pos.y) < 2) { const d = Math.sqrt(d2); mx += ox / d * (1.45 - d) * 5 * dt; mz += oz / d * (1.45 - d) * 5 * dt; } } }
      const nx = this.pos.x + mx, nz = this.pos.z + mz;
      if (nav.walkable(nx, nz)) { this.pos.x = nx; this.pos.z = nz; } else if (nav.walkable(nx, this.pos.z)) this.pos.x = nx; else if (nav.walkable(this.pos.x, nz)) this.pos.z = nz; else this.repath = 0;
      this.pos.y += (nav.heightSmooth(this.pos.x, this.pos.z) - this.pos.y) * Math.min(1, dt * 14);
      this.moveSp += (speed - this.moveSp) * Math.min(1, dt * 8);
      wantX = this.vx; wantZ = this.vz;
    } else this.moveSp += (0 - this.moveSp) * Math.min(1, dt * 10);
    // 身体朝向：有目标朝目标，否则朝移动方向
    const faceYaw = this.target ? this.aimYaw : (moving ? Math.atan2(-wantX, -wantZ) : this.yaw);
    this.yaw += angDiff(faceYaw, this.yaw) * Math.min(1, dt * 9);
    this.crouchW += ((this.crouch && !moving ? 1 : 0) - this.crouchW) * Math.min(1, dt * 8);
    this.animT += dt * (2.4 + this.moveSp * 1.9);
    this.mesh.position.copy(this.pos); this.mesh.rotation.y = this.yaw;
    if (camDist < 90) this.pose(this.moveSp / 4.3, dt);
    this.shadowLOD(camDist);
    // 环境光
    if ((g.frame + (this.mesh.id & 15)) % 16 === 0) { const s = 0.3 + 0.7 * nav.skyAt(this.pos.x, this.pos.z); if (Math.abs(s - this.ambient) > 0.02) { this.ambient = s; this.mat.envMapIntensity = s; } }
    return true;
  }

  perceive() {
    const g = this.game; this.eye(_v);
    let best = null, bestS = 1e9, bestLOS = false; const range = this.kind === 'sniper' ? 150 : this.home ? 24 : 75;   // 有驻地的守卫只管自己这一片
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const cands = g.enemiesOf(this.team);
    for (const c of cands) {
      if (c.alive === false) continue;
      c.aimPoint(_v2); const dx = _v2.x - _v.x, dy = _v2.y - _v.y, dz = _v2.z - _v.z; const d = Math.hypot(dx, dy, dz);
      if (d > range) continue;
      const facing = (dx * fx + dz * fz) / Math.max(d, 0.01);
      if (facing < -0.25 && d > 14 && c !== this.target && !this.alert) continue;
      let s = d * (c.isPlayer ? (this.kind === 'sniper' ? 0.6 : 1.2) : 1) * (c.kind === 'mech' ? 1.6 : 1) * (c === this.target ? 0.6 : 1) * (c.kind === 'drone' ? 1.5 : 1);
      if (s >= bestS) continue;
      const los = !g.world.blocked(_v, _v2);
      if (!los && c !== this.target) continue;
      best = c; bestS = s; bestLOS = los;
    }
    if (best) { if (best !== this.target) { this.seeT = 0; this.react = rnd(0.35, 0.8) * (best.isPlayer ? 1.15 : 1); } this.target = best; this.hasLOS = bestLOS; if (bestLOS) this.lostT = 0; else if ((this.lostT += 0.3) > 4) { this.target = null; } }
    else if (this.target && (this.lostT += 0.3) > 2.5) this.target = null;
    if (!this.target && this.alert && !this.static) { this.setPath(this.alert.x, this.alert.z); this.alert = null; }
  }

  shoot(dt, tgt, dist) {
    const g = this.game;
    if (this.burst <= 0) { if (this.pauseT > 0) return; this.burst = (3 + Math.random() * 3) | 0; this.shotT = 0; }
    this.shotT -= dt; if (this.shotT > 0) return;
    this.shotT = 0.105; this.burst--; if (this.burst <= 0) this.pauseT = rnd(0.7, 1.7) * (this.kind === 'stalker' ? 0.7 : 1);
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const mz = _v.set(this.pos.x + fx * 0.8 + fz * -0.12, this.pos.y + (this.crouchW > 0.5 ? 0.98 : 1.38), this.pos.z + fz * 0.8 - fx * -0.12);
    tgt.aimPoint(_v2); if (tgt.isPlayer) _v2.y += 0.1;
    const tsp = tgt.isPlayer ? Math.hypot(tgt.vel.x, tgt.vel.z) + Math.abs(tgt.vel.y) * 0.5 : (tgt.moveSp || 0);
    let sig = (this.kind === 'stalker' ? 0.024 : 0.036) * (1 + tsp / (tgt.isPlayer ? 4.5 : 9)) * (tgt.kind === 'mech' ? 0.5 : 1) * g.aiAccuracy;
    const dir = _v3.subVectors(_v2, mz).normalize(); dir.x += (Math.random() + Math.random() - 1) * sig; dir.y += (Math.random() + Math.random() - 1) * sig * 0.7; dir.z += (Math.random() + Math.random() - 1) * sig; dir.normalize();
    const h = g.hitscan(mz, dir, 110, this);
    const cam = g.engine.camera.position; const near = cam.distanceToSquared(mz) < 95 * 95;
    if (h) {
      if (h.ent) { const dmg = h.ent.isPlayer ? (this.kind === 'stalker' ? 10 : 7.5) : h.ent.kind === 'mech' ? 4 : 6.5; h.ent.takeDamage(dmg, this, { point: h.point, dir, head: false }); if (near && !h.ent.isPlayer) g.fx.hitFlesh(h.point, dir, h.ent.robot || h.ent.kind === 'mech'); }
      else if (near) g.fx.impact(h.point, h.normal, h.surf, 1, Math.random() < 0.5);
      if (near) g.fx.tracer(mz, h.point, this.team === 0 ? 0xbfe8ff : 0xffb070, 260, 0.03, 6);
    } else if (near) g.fx.tracer(mz, _v2.copy(mz).addScaledVector(dir, 100), this.team === 0 ? 0xbfe8ff : 0xffb070, 260, 0.03, 6);
    if (near) { g.fx.muzzleFlash(mz, dir, 0.7); g.audio.play('enemy_fire', { x: mz.x, y: mz.y, z: mz.z, volume: 0.75 }); }
    // 子弹从玩家耳边飞过
    if (tgt.isPlayer && (!h || !h.ent) && Math.random() < 0.3) g.audio.play('bullet_whiz', { volume: 0.5 });
  }

  updateSniper(dt, tgt, dist) {
    const g = this.game; this.sniperCD -= dt;
    const mz = _v.set(this.pos.x - Math.sin(this.yaw) * 1.0, this.pos.y + 1.4, this.pos.z - Math.cos(this.yaw) * 1.0);
    tgt.aimPoint(_v2);
    if (!this.hasLOS || this.sniperCD > 0) { this.charge = Math.max(0, this.charge - dt); this.laser.visible = false; return; }
    if (this.charge === 0) g.audio.play('sniper_charge', { x: mz.x, y: mz.y, z: mz.z, volume: 1 });
    this.charge += dt / 2.3;
    // 激光瞄准线
    const L = this.laser; L.visible = true; const d = _v3.subVectors(_v2, mz); const len = d.length(); d.multiplyScalar(1 / len);
    g.fx._orient(L, new THREE.Vector3().copy(mz).addScaledVector(d, len / 2), d, len, 0.02 + this.charge * 0.05, g.engine.camera);
    L.material.color.setRGB(2 + this.charge * 6, 0.15 + this.charge * 0.4, 0.1); L.material.opacity = 0.35 + 0.65 * this.charge;
    if (tgt.isPlayer) g.sniperWarn = Math.max(g.sniperWarn, this.charge);
    if (this.charge >= 1) {
      this.charge = 0; this.sniperCD = rnd(2.6, 4); L.visible = false;
      const tsp = tgt.isPlayer ? Math.hypot(tgt.vel.x, tgt.vel.y, tgt.vel.z) : (tgt.moveSp || 0);
      const pHit = Math.max(0.12, Math.min(0.95, 1.15 - tsp / 10));
      const hit = Math.random() < pHit && !g.world.blocked(mz, _v2);
      const end = hit ? _v2 : _v2.addScaledVector(new THREE.Vector3(rnd(-1, 1), rnd(-0.3, 0.6), rnd(-1, 1)), 1.2);
      g.fx.beam(mz, end, [1, 0.35, 0.15], 0.09, 0.35, 8); g.fx.muzzleFlash(mz, d, 1.6);
      g.audio.play('sniper_fire', { x: mz.x, y: mz.y, z: mz.z, volume: 1 });
      if (hit) tgt.takeDamage(tgt.isPlayer ? 62 : tgt.kind === 'mech' ? 90 : 200, this, { point: end, dir: d });
      else { const h = g.world.raycast(mz, d, 200); if (h) g.fx.impact(h.point, h.normal, h.surf, 1.6); }
    }
  }

  pickGoal() {
    const g = this.game; const pts = g.combatPoints; const bias = this.team === 0 ? -1 : 1;
    // 有驻地的守卫（双界试炼）：只在驻地附近巡逻
    if (this.home) { const q = g.nav.randomNear(this.home.x, this.home.z, this.home.r); if (q) this.setPath(q.x, q.z); this.repath = rnd(3, 7); return; }
    // 每个兵出生时认定一条路线（东 / 中 / 西），优先去这条路上的交战点：三条路都有人走，而不是全挤在中路
    if (!this.lane) this.lane = 'MEW'[(Math.random() * 3) | 0];
    let best = null, bs = -1e9;
    for (let i = 0; i < 6; i++) { const p = pts[(Math.random() * pts.length) | 0]; if (p[1] * bias > 46) continue; const s = p[1] * bias * 0.02 + Math.random() - Math.hypot(p[0] - this.pos.x, p[1] - this.pos.z) * 0.006 + (p[2] === this.lane ? 0.9 : p[2] === 'C' ? 0.25 : 0); if (s > bs) { bs = s; best = p; } }
    if (!best) best = pts[0];
    const q = g.nav.randomNear(best[0], best[1], 7); if (q) this.setPath(q.x, q.z);
    this.repath = rnd(3, 6);
  }
  setPath(x, z) { const p = this.game.nav.findPath(this.pos.x, this.pos.z, x, z); this.path = p; this.pathI = 0; }
  followPath(dt) {
    if (!this.path || this.pathI >= this.path.length) { this.path = null; return false; }
    const w = this.path[this.pathI]; const dx = w.x - this.pos.x, dz = w.z - this.pos.z; const d = Math.hypot(dx, dz);
    if (d < 0.5) { this.pathI++; if (this.pathI >= this.path.length) { this.path = null; return false; } return this.followPath(dt); }
    const k = Math.min(1, dt * 10); this.vx += (dx / d - this.vx) * k; this.vz += (dz / d - this.vz) * k;
    const l = Math.hypot(this.vx, this.vz) || 1; this.vx /= l; this.vz /= l;
    return true;
  }

  shadowLOD(camDist) { const sh = this.shadowMesh; if (!sh) return; const far = camDist > (this.mesh.castShadow ? 15 : 13); if (far === this.mesh.castShadow) { this.mesh.castShadow = !far; sh.castShadow = far; sh.visible = far; } }

  // 程序姿态：run ∈ [0,1]
  pose(run, dt) {
    const b = this.bones; const cw = this.crouchW;
    const twist = this.target ? Math.max(-0.9, Math.min(0.9, angDiff(this.aimYaw, this.yaw))) : 0;
    // 下半身：步态（骨盆起伏 / 旋转 + 双腿反解 + 脚掌），按实际位移推进，见 gait.js
    const G = gaitPose(this, b, dt, { grounded: this.grounded !== false });
    const mv = Math.min(1, G.sp / 4.3) * G.amp;
    // 上半身：反向抵消骨盆的转动与侧倾，肩线和枪口保持稳定；前倾随速度增加，头抬回来看前方
    b[1].rotation.set(-G.lean * 0.9 + this.aimPitch * 0.5 - this.flinch * 0.25 - cw * 0.15, twist - BLADE - G.yawP * 0.85, -G.rollP * 0.8);
    b[2].rotation.set(this.aimPitch * 0.3 + G.lean * 1.1, twist * 0.3 + BLADE - G.yawP * 0.1, 0);
    // 双臂持枪
    const rise = this.robot && this.meleeT > 0.7 ? 1 : 0;
    b[11].rotation.set(this.aimPitch * 0.5 + this.flinch * 0.2 - 0.05 - (this.target ? 0 : 0.22) * (1 - mv * 0.5), BLADE, 0);
    b[11].position.y = 0.265 + 0.011 * G.amp * Math.sin(Math.PI * 4 * G.ph + 0.6);
    if (rise) { b[5].rotation.set(0.55 + rise * 1.2, 0, -0.2); b[6].rotation.set(1.0, 0, 0.1); b[3].rotation.set(0.9 + rise * 1.2, 0, 0.5); b[4].rotation.set(0.6, 0, -0.3); }
    else { armIK(b[5], b[6], b[11], 0.004, -0.092, -0.03, 1); armIK(b[3], b[4], b[11], -0.004, -0.085, -0.30, -1); }
    // 滑铲：身体后仰压低，一腿前伸一腿收起
    const sl = this.slideW; if (sl > 0.01) { const m = (bn, x) => { bn.rotation.x += (x - bn.rotation.x) * sl; }; b[0].position.y += (0.42 - b[0].position.y) * sl; m(b[0], 0.62); m(b[1], -0.55); m(b[7], 0.74); m(b[8], -0.16); m(b[9], 0.95); m(b[10], -1.8); if (b[12]) { m(b[12], -0.3); m(b[13], -0.3); } }
  }

  animateDeath(dt) {
    const b = this.bones; const u = Math.min(1, this.dead / 0.5); const e = u * u;
    b[0].rotation.x = this.fallDir * e * 1.5; b[0].rotation.y = this.fallYaw * e; b[0].position.y = 0.98 - e * 0.76;
    b[1].rotation.x = this.fallDir * e * 0.12; b[2].rotation.x = -this.fallDir * e * 0.3;
    b[3].rotation.set(0.3 * (1 - e) + this.fallDir * e * 0.5, 0, 0.6 + e * 0.6); b[5].rotation.set(0.3 * (1 - e) + this.fallDir * e * 0.3, 0, -0.25 - e * 0.9);
    b[4].rotation.x = 0.45 * (1 - e) + 0.2; b[6].rotation.x = 1.05 * (1 - e) + 0.3;
    b[7].rotation.x = e * 0.25; b[9].rotation.x = -e * 0.2; b[8].rotation.x = -e * 0.5; b[10].rotation.x = -e * 0.15;
    if (this.dead > 7) this.mesh.position.y = this.pos.y - (this.dead - 7) * 0.25;
  }
}

// ---------- 无人机 ----------
let DRONE = null;
export class Drone {
  constructor(game, team, x, z) {
    this.game = game; this.kind = 'drone'; this.team = team; this.robot = true; this.alive = true; this.dead = 0; this.hp = 48; this.maxHp = 48; this.name = '赤蝎无人机';
    this.pos = new THREE.Vector3(x, game.nav.height(x, z) + 30, z); this.vel = new THREE.Vector3(); this.yaw = 0; this.target = null; this.think = 0; this.shotT = rnd(1, 2); this.burst = 0; this.orbit = Math.random() * 6.28; this.orbitDir = Math.random() < 0.5 ? 1 : -1; this.hover = rnd(6.5, 10); this.moveSp = 5; this.hasLOS = false;
    if (!DRONE) {
      const T = game.engine.T; const mk = (c) => new THREE.MeshStandardMaterial({ map: T.armor.map, normalMap: T.armor.normalMap, roughnessMap: T.armor.ormMap, metalnessMap: T.armor.ormMap, roughness: 1, metalness: 1, color: c });
      const body = []; const add = (g) => body.push(g.index ? g.toNonIndexed() : g);
      const rb = (w, h, d, x, y, z, ry = 0) => { const g = new RoundedBoxGeometry(w, h, d, 1, Math.min(w, h, d) * 0.3); g.rotateY(ry); g.translate(x, y, z); add(g); };
      rb(0.5, 0.2, 0.62, 0, 0, 0); rb(0.3, 0.14, 0.3, 0, -0.14, -0.1); rb(1.5, 0.05, 0.1, 0, 0.03, 0, Math.PI / 4); rb(1.5, 0.05, 0.1, 0, 0.03, 0, -Math.PI / 4);
      const barrel = new THREE.CylinderGeometry(0.03, 0.03, 0.4, 8); barrel.rotateX(Math.PI / 2); barrel.translate(0, -0.16, -0.38); add(barrel);
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const m = new THREE.CylinderGeometry(0.06, 0.06, 0.1, 8); m.translate(sx * 0.53, 0.08, sz * 0.53); add(m); }
      DRONE = { body: mergeGeometries(body), mat: mk(0x2a2a2e), rotor: new THREE.CylinderGeometry(0.3, 0.3, 0.012, 14), rotorMat: new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.35, depthWrite: false }), eye: new THREE.BoxGeometry(0.2, 0.05, 0.03), eyeMat: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.4, 0.4, 0.12), fog: false }) };
    }
    const grp = this.mesh = new THREE.Group();
    const b = new THREE.Mesh(DRONE.body, DRONE.mat); b.castShadow = true; grp.add(b);
    this.rotors = []; for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const r = new THREE.Mesh(DRONE.rotor, DRONE.rotorMat); r.position.set(sx * 0.53, 0.14, sz * 0.53); grp.add(r); this.rotors.push(r); }
    const eye = new THREE.Mesh(DRONE.eye, DRONE.eyeMat); eye.position.set(0, 0.02, -0.32); grp.add(eye);
    grp.position.copy(this.pos); game.engine.scene.add(grp);
  }
  aimPoint(out) { return out.copy(this.pos); }
  hitTest(o, d, maxDist) {
    if (!this.alive) return -1; const ox = o.x - this.pos.x, oy = o.y - this.pos.y, oz = o.z - this.pos.z; const b = ox * d.x + oy * d.y + oz * d.z, c = ox * ox + oy * oy + oz * oz - 0.55 * 0.55; const disc = b * b - c;
    if (disc < 0) return -1; const t = -b - Math.sqrt(disc); this._head = false; return t >= 0 && t <= maxDist ? t : -1;
  }
  takeDamage(amount, from, info) {
    if (!this.alive) return false; this.hp -= amount; this.game.fx.sparks(this.pos, null, 4, [1.5, 1.2, 0.8], 4);
    if (this.hp <= 0) { this.alive = false; this.dead = 0; this.vel.set(rnd(-3, 3), 2, rnd(-3, 3)); this.game.audio.play('drone_die', { x: this.pos.x, y: this.pos.y, z: this.pos.z }); this.game.audio.loop('drone_hum', false, { id: this.mesh.id }); this.game.onKill(this, from, info || {}); return true; }
    return false;
  }
  remove() { this.game.engine.scene.remove(this.mesh); this.game.audio.loop('drone_hum', false, { id: this.mesh.id }); }
  update(dt) {
    const g = this.game;
    if (!this.alive) {
      this.dead += dt; this.vel.y -= 14 * dt; this.pos.addScaledVector(this.vel, dt); this.mesh.rotation.x += 5 * dt; this.mesh.rotation.z += 7 * dt; this.mesh.position.copy(this.pos);
      if (Math.random() < 0.6) g.fx.alpha.spawn({ x: this.pos.x, y: this.pos.y, z: this.pos.z, vx: 0, vy: 1, vz: 0, life: 0.8, s0: 0.3, s1: 1.1, r: 0.12, g: 0.12, b: 0.12, a: 0.6, tile: 1, drag: 1 });
      const gy = g.nav.height(this.pos.x, this.pos.z);
      if (this.pos.y <= gy + 0.3 || this.dead > 4) { g.fx.explosion(_v.set(this.pos.x, Math.max(gy, this.pos.y), this.pos.z), 0.55, { scorch: this.pos.y <= gy + 0.5 }); g.audio.play('explosion', { x: this.pos.x, y: this.pos.y, z: this.pos.z, volume: 0.5, pitch: 1.4 }); return false; }
      return true;
    }
    this.think -= dt;
    if (this.think <= 0) {
      this.think = rnd(0.3, 0.5); let best = null, bd = 1e9;
      for (const c of g.enemiesOf(this.team)) { if (c.alive === false) continue; const d = c.pos.distanceTo(this.pos) * (c.isPlayer ? 0.8 : 1); if (d < bd && d < 80) { bd = d; best = c; } }
      this.target = best; if (best) { best.aimPoint(_v); this.hasLOS = !g.world.blocked(this.pos, _v); }
    }
    let tx, tz;
    if (this.target && this.target.alive !== false) {
      this.orbit += this.orbitDir * dt * 0.45; const r = 15;
      tx = this.target.pos.x + Math.cos(this.orbit) * r; tz = this.target.pos.z + Math.sin(this.orbit) * r;
      this.target.aimPoint(_v); this.yaw += angDiff(Math.atan2(-(_v.x - this.pos.x), -(_v.z - this.pos.z)), this.yaw) * Math.min(1, dt * 5);
      this.shotT -= dt;
      if (this.hasLOS && this.shotT <= 0) {
        if (this.burst <= 0) this.burst = 3; this.burst--; this.shotT = this.burst > 0 ? 0.16 : rnd(1.5, 2.4);
        const lead = _v2.copy(_v); if (this.target.isPlayer) lead.addScaledVector(this.target.vel, _v.distanceTo(this.pos) / 60 * 0.6);
        const dir = _v3.subVectors(lead, this.pos).normalize(); dir.x += rnd(-0.03, 0.03); dir.y += rnd(-0.02, 0.02); dir.z += rnd(-0.03, 0.03); dir.normalize();
        g.spawnProjectile({ kind: 'bolt', pos: _v.copy(this.pos).addScaledVector(dir, 0.6), vel: dir.clone().multiplyScalar(60), team: this.team, owner: this, dmg: 9, life: 2.5 });
        g.audio.play('drone_fire', { x: this.pos.x, y: this.pos.y, z: this.pos.z, volume: 0.8 });
      }
    } else { this.orbit += dt * 0.2; tx = Math.cos(this.orbit) * 30; tz = Math.sin(this.orbit) * 30; }
    const ty = Math.max(g.nav.height(this.pos.x, this.pos.z), g.nav.height(tx, tz)) + this.hover + Math.sin(g.time * 1.3 + this.orbit) * 0.5;
    _v.set(tx - this.pos.x, ty - this.pos.y, tz - this.pos.z); const d = _v.length(); if (d > 0.01) _v.multiplyScalar(Math.min(7.5, d * 1.2) / d);
    this.vel.lerp(_v, Math.min(1, dt * 2.2)); this.pos.addScaledVector(this.vel, dt);
    this.mesh.position.copy(this.pos); this.mesh.rotation.set(-this.vel.z * 0.03, this.yaw, 0, 'YXZ');
    for (const r of this.rotors) r.rotation.y += 50 * dt;
    g.audio.loop('drone_hum', true, { id: this.mesh.id, x: this.pos.x, y: this.pos.y, z: this.pos.z, volume: 0.5 });
    return true;
  }
}
