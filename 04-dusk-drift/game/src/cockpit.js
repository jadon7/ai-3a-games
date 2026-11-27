// 驾驶舱：从车模里自动分离出方向盘（让它随打方向转动），没有方向盘的车补一个；再加一双握着方向盘的手臂（两段反向动力学）
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// 3x3 对称矩阵的特征分解（雅可比法），返回按特征值从小到大排的特征向量
function eigSym(A) {
  const a = A.map(r => r.slice()), v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let it = 0; it < 30; it++) {
    let p = 0, q = 1;
    for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) if (Math.abs(a[i][j]) > Math.abs(a[p][q])) { p = i; q = j; }
    if (Math.abs(a[p][q]) < 1e-12) break;
    const th = 0.5 * Math.atan2(2 * a[p][q], a[q][q] - a[p][p]), c = Math.cos(th), s = Math.sin(th);
    for (let k = 0; k < 3; k++) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
    for (let k = 0; k < 3; k++) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
    for (let k = 0; k < 3; k++) { const vkp = v[k][p], vkq = v[k][q]; v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq; }
  }
  return [0, 1, 2].map(i => ({ val: a[i][i], vec: V(v[0][i], v[1][i], v[2][i]) })).sort((x, y) => x.val - y.val);
}

function pca(pts) {
  const c = V(); for (const p of pts) c.add(p); c.divideScalar(pts.length);
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of pts) { const d = [p.x - c.x, p.y - c.y, p.z - c.z]; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i][j] += d[i] * d[j]; }
  return { c, e: eigSym(C) };
}

/**
 * 在车身网格里找方向盘：按位置合并顶点求连通块，取眼睛前下方、尺寸像方向盘的那些块，
 * 拟合出盘面和轮心，把这些三角形挪进一个可以绕转向柱转的节点。只对共享的模型做一次（各台车克隆时共用）。
 * 返回 { center, axis, up, radius, found }（车身坐标）
 */
export function extractSteering(assetRoot, eye, fix = null) {
  const body = assetRoot.getObjectByName('body');
  assetRoot.updateMatrixWorld(true);
  const toBody = new THREE.Matrix4().copy(body.matrixWorld).invert();
  const guess = V(eye.x, eye.y - 0.2, eye.z + 0.5);
  const meshes = []; body.traverse(o => { if (o.isMesh && o.geometry.index) meshes.push(o); });
  // 1. 位置相同（1 毫米）的顶点视为同一点，三角形按共点合并成连通块
  const keyId = new Map(), parent = [];
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const tri = [];   // [meshIdx, triIdx, k0, k1, k2]
  const tmp = V();
  const posKey = [];
  meshes.forEach((m, mi) => {
    const M = new THREE.Matrix4().multiplyMatrices(toBody, m.matrixWorld), P = m.geometry.attributes.position, I = m.geometry.index.array;
    const ids = new Int32Array(P.count), pts = new Array(P.count);
    for (let i = 0; i < P.count; i++) {
      tmp.fromBufferAttribute(P, i).applyMatrix4(M); pts[i] = tmp.clone();
      // 只关心猜测位置附近的点，远处的顶点不建表，省时间
      if (tmp.distanceTo(guess) > 0.6) { ids[i] = -1; continue; }
      const k = Math.round(tmp.x * 1000) + ',' + Math.round(tmp.y * 1000) + ',' + Math.round(tmp.z * 1000);
      let id = keyId.get(k); if (id === undefined) { id = parent.length; keyId.set(k, id); parent.push(id); posKey.push(tmp.clone()); }
      ids[i] = id;
    }
    for (let t = 0; t < I.length; t += 3) {
      const a = ids[I[t]], b = ids[I[t + 1]], c = ids[I[t + 2]];
      if (a < 0 || b < 0 || c < 0) continue;
      tri.push([mi, t / 3, a, b, c]);
      const ra = find(a), rb = find(b), rc = find(c); parent[rb] = ra; parent[find(rc)] = ra;
    }
  });
  // 2. 连通块统计
  const comps = new Map();
  for (const t of tri) {
    const r = find(t[2]); let c = comps.get(r);
    if (!c) comps.set(r, c = { tris: [], min: V(1e9, 1e9, 1e9), max: V(-1e9, -1e9, -1e9), pts: new Set(), mats: new Set() });
    c.tris.push(t); c.mats.add(meshes[t[0]].material.name || ''); for (const k of [t[2], t[3], t[4]]) { c.pts.add(k); c.min.min(posKey[k]); c.max.max(posKey[k]); }
  }
  // 3. 盘面拟合：在"转向柱仰角 5–60°、左右偏 ±12°"里搜索，外圈（轮缘）最薄、最圆的方向就是转向柱
  //    （直接取主成分会被转向柱、轮毂和旁边的仪表带偏）
  const fit = (pts) => {
    let best = null;
    const tryAx = (el, yw) => {
      const ax = V(Math.sin(yw) * Math.cos(el), Math.sin(el), -Math.cos(yw) * Math.cos(el));
      const upv = V(0, 1, 0).addScaledVector(ax, -ax.y).normalize(), sd = V().crossVectors(ax, upv);
      let u0 = 1e9, u1 = -1e9, s0 = 1e9, s1 = -1e9;
      const pr = pts.map(p => { const u = p.dot(upv), s2 = p.dot(sd), t = p.dot(ax); u0 = Math.min(u0, u); u1 = Math.max(u1, u); s0 = Math.min(s0, s2); s1 = Math.max(s1, s2); return [u, s2, t]; });
      const cu = (u0 + u1) / 2, cs = (s0 + s1) / 2; let rmax = 0;
      for (const q of pr) { q.push(Math.hypot(q[0] - cu, q[1] - cs)); rmax = Math.max(rmax, q[3]); }
      let n = 0, m = 0, m2 = 0; for (const q of pr) if (q[3] > 0.65 * rmax) { n++; m += q[2]; m2 += q[2] * q[2]; }
      const sdv = Math.sqrt(Math.max(0, m2 / n - (m / n) * (m / n))), round = Math.abs((u1 - u0) - (s1 - s0));
      const cost = sdv + 0.15 * round;
      if (!best || cost < best.cost) { const rs = pr.map(q => q[3]).sort((p1, p2) => p1 - p2); best = { cost, sdv, round, ax, c: upv.clone().multiplyScalar(cu).addScaledVector(sd, cs).addScaledVector(ax, m / n), r: rmax, r90: rs[Math.floor(rs.length * 0.9)] }; }
    };
    for (let el = 5; el <= 60; el += 2.5) for (let yw = -12; yw <= 12; yw += 4) tryAx(el * Math.PI / 180, yw * Math.PI / 180);
    const e0 = Math.asin(best.ax.y), y0 = Math.atan2(best.ax.x, -best.ax.z);
    for (let de = -2; de <= 2; de += 0.5) for (let dy = -3; dy <= 3; dy += 1) tryAx(e0 + de * Math.PI / 180, y0 + dy * Math.PI / 180);
    if (best.ax.dot(eye.clone().sub(best.c)) < 0) best.ax.negate();
    return best;
  };
  const ptsOf = (list) => { const o = []; for (const c of list) for (const k of c.pts) o.push(posKey[k]); return o; };
  const near = [...comps.values()].filter(c => c.min.clone().add(c.max).multiplyScalar(0.5).distanceTo(guess) <= 0.32 && c.max.z > eye.z + 0.15);
  // 先看材质名：很多模型的方向盘有自己的材质（Volante、SteeringWheel、SW_…）
  const HINT = /volant|steer|lenkrad|sw_/i;
  const hintRe = fix && fix.mats ? new RegExp('^(' + fix.mats.join('|') + ')$') : HINT;
  let rim = near.filter(c => [...c.mats].some(n => hintRe.test(n)));
  if (fix && fix.mats) fix = null;      // 按指定材质找到后走正常的拟合流程
  let F = null;
  if (rim.length) { F = fit(ptsOf(rim)); if (F.r < 0.12 || F.r > 0.26) F = null; }      // 材质名只命中了轮毂之类的小件：改用下面的形状判断
  if (!F) {
    // 没有材质名可用：逐块打分，找最像轮缘的那一块（圆、薄、半径 13–22 cm）
    let bestS = 1e9;
    for (const c of near) {
      const sz = c.max.clone().sub(c.min), md = Math.max(sz.x, sz.y, sz.z);
      if (md < 0.24 || md > 0.5 || c.pts.size < 30) continue;
      const f = fit(ptsOf([c]));
      if (f.r < 0.12 || f.r > 0.23 || f.round > 0.05 || f.sdv > 0.03) continue;
      const sc = f.sdv + f.round * 0.5 + f.c.distanceTo(guess) * 0.05;
      if (sc < bestS) { bestS = sc; F = f; rim = [c]; }
    }
  }
  let found = false, center = guess.clone(), axis = V(0, 0.4, -1).normalize(), radius = 0.18, cand = [];
  let triSel = null;
  if (fix && fix.replace) {
    const e = fix.el * Math.PI / 180; axis = V(0, Math.sin(e), -Math.cos(e)); center = V(...fix.c); radius = fix.r; F = null;
    fix = { none: true };
  } else if (fix) {
    // 方向盘和仪表台连成一片、自动找不出来的车：用离线圆环搜索得到的位置，按三角形把轮缘圆柱里的部分切出来
    const e = fix.el * Math.PI / 180; axis = V(0, Math.sin(e), -Math.cos(e)); center = V(...fix.c); radius = fix.r; found = true; F = null;
    triSel = tri.filter(t => [t[2], t[3], t[4]].every(k => { const d = posKey[k].clone().sub(center); const ax = d.dot(axis); return Math.abs(ax) < (fix.depth || 0.045) && d.addScaledVector(axis, -ax).length() < radius + 0.025; }));
  }
  if (!fix && F && F.r >= 0.12 && F.r <= 0.26) {
    axis = F.ax; center = F.c; radius = Math.min(0.21, F.r90 || F.r); found = true;     // 轮缘中线：取 90% 分位，最外沿的毛刺不算
    // 轮缘以内、贴着盘面的其它块（轮辐、轮毂、按钮、喇叭盖）一起转
    cand = near.filter(cp => { if (rim.includes(cp)) return true; for (const k of cp.pts) { const d = posKey[k].clone().sub(center); const ax = d.dot(axis); const rad = d.addScaledVector(axis, -ax).length(); if (ax > 0.05 || ax < -0.1 || rad > radius + 0.02) return false; } return true; });
  }
  const up = V(0, 1, 0).addScaledVector(axis, -axis.y).normalize();
  // 4. 建立转动节点：局部 Z = 转向柱方向（指向车手），局部 Y = 盘面里的"上"
  const pivot = new THREE.Group(); pivot.name = 'steer_pivot';
  const basis = new THREE.Matrix4().makeBasis(V().crossVectors(up, axis), up, axis);
  pivot.quaternion.setFromRotationMatrix(basis); pivot.position.copy(center);
  body.add(pivot); pivot.updateMatrixWorld(true);
  const pivInv = new THREE.Matrix4().copy(pivot.matrixWorld).invert();
  if (found) {
    const byMesh = new Map();
    const tris = triSel || cand.flatMap(c => c.tris);
    for (const t of tris) { let s = byMesh.get(t[0]); if (!s) byMesh.set(t[0], s = new Set()); s.add(t[1]); }
    for (const [mi, set] of byMesh) {
      const m = meshes[mi], g = m.geometry, I = g.index.array, keep = [], take = [];
      for (let t = 0; t < I.length / 3; t++) (set.has(t) ? take : keep).push(I[t * 3], I[t * 3 + 1], I[t * 3 + 2]);
      const g2 = new THREE.BufferGeometry(); for (const [n, at] of Object.entries(g.attributes)) g2.setAttribute(n, at);
      g2.setIndex(take); g2.computeBoundingSphere();
      g.setIndex(keep); g.computeBoundingSphere();
      const m2 = new THREE.Mesh(g2, m.material); m2.castShadow = false; m2.receiveShadow = true; m2.frustumCulled = false; m2.name = 'steer_part';
      m2.matrix.multiplyMatrices(pivInv, m.matrixWorld); m2.matrix.decompose(m2.position, m2.quaternion, m2.scale);
      pivot.add(m2);
    }
  } else {
    // 模型里没有可用的方向盘：装一个真实的赛车方向盘模型（皮质三辐，Sketchfab「Steering Wheel (Racing)」，作者 Cakeservant，CC BY 4.0）
    if (wheelTpl) {
      const w = wheelTpl.clone(true); w.scale.setScalar(radius / 0.16);   // 模型轮缘中线半径约 16 cm
      w.traverse(o => { if (o.isMesh) { o.name = 'steer_part'; o.castShadow = false; o.receiveShadow = true; o.frustumCulled = false; } });
      pivot.add(w);
    }
  }
  let refine = null;
  if (found) {
    // 5. 用切出来的方向盘自身校正转轴：外轮廓拟合圆心和盘面（自动找 / 手填的中心偏几厘米时，方向盘会偏心晃、手也握不准）
    const R = refine = refinePivot(pivot);
    if (R) { radius = R.radius; pivot.updateMatrixWorld(true); center.copy(pivot.position); axis.set(0, 0, 1).applyQuaternion(pivot.quaternion); up.set(0, 1, 0).applyQuaternion(pivot.quaternion); }
  }
  pivot.userData = { found, radius, center: center.clone(), axis: axis.clone(), up: up.clone(), refine };
  return pivot.userData;
}

function solve3(A, b) {     // 3x3 线性方程（克拉默法则）
  const d = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = d(A); if (Math.abs(D) < 1e-14) return null;
  return [0, 1, 2].map(i => d(A.map((r, j) => r.map((x, k) => (k === i ? b[j] : x)))) / D);
}
function lsq(rows, ys) {    // 最小二乘：rows[i]·x ≈ ys[i]
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
  rows.forEach((r, i) => { for (let j = 0; j < 3; j++) { b[j] += r[j] * ys[i]; for (let k = 0; k < 3; k++) A[j][k] += r[j] * r[k]; } });
  return solve3(A, b);
}
function refinePivot(pivot) {
  pivot.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(pivot.matrixWorld).invert(), m = new THREE.Matrix4(), pts = [];
  pivot.traverse(o => {
    if (!o.isMesh) return;
    m.multiplyMatrices(inv, o.matrixWorld);
    const P = o.geometry.attributes.position, I = o.geometry.index, n = I ? I.count : P.count, seen = new Set();
    for (let t = 0; t < n; t++) { const k = I ? I.getX(t) : t; if (seen.has(k)) continue; seen.add(k); pts.push(V().fromBufferAttribute(P, k).applyMatrix4(m)); }
  });
  if (pts.length < 60) return null;
  let cx = 0, cy = 0, R = 0, sil = [];
  for (let it = 0; it < 5; it++) {
    const S = new Array(48).fill(null);       // 每 7.5° 取离圆心最远的点 = 轮缘外轮廓
    for (const q of pts) { const dx = q.x - cx, dy = q.y - cy, r = Math.hypot(dx, dy), k = Math.floor((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI) * 48) % 48; if (!S[k] || r > S[k].r) S[k] = { q, r }; }
    sil = S.filter(Boolean).map(x => x.q);
    for (let pass = 0; pass < 2; pass++) {
      const f = lsq(sil.map(q => [q.x, q.y, 1]), sil.map(q => -(q.x * q.x + q.y * q.y))); if (!f) return null;
      cx = -f[0] / 2; cy = -f[1] / 2; R = Math.sqrt(Math.max(0, cx * cx + cy * cy - f[2]));
      const res = sil.map(q => Math.abs(Math.hypot(q.x - cx, q.y - cy) - R)), med = [...res].sort((a, b) => a - b)[res.length >> 1];
      sil = sil.filter((q, i) => res[i] < Math.max(0.004, med * 2.5));      // 去掉拨杆之类伸出轮缘的东西
    }
  }
  const rms = Math.sqrt(sil.reduce((s, q) => s + (Math.hypot(q.x - cx, q.y - cy) - R) ** 2, 0) / sil.length);
  const pl = lsq(sil.map(q => [q.x, q.y, 1]), sil.map(q => q.z)); if (!pl) return null;
  const nrm = V(-pl[0], -pl[1], 1).normalize(), off = V(cx, cy, pl[0] * cx + pl[1] * cy + pl[2]);
  if (sil.length < 24 || R < 0.09 || R > 0.25 || rms > 0.006 || off.length() > 0.08 || nrm.z < Math.cos(0.35)) return null;
  // 新的转动坐标系（在旧坐标系里）：原点挪到拟合圆心，Z 轴换成拟合盘面法线
  const y = V(0, 1, 0).addScaledVector(nrm, -nrm.y).normalize(), x = V().crossVectors(y, nrm);
  const L = new THREE.Matrix4().makeBasis(x, y, nrm).setPosition(off), Linv = L.clone().invert();
  pivot.updateMatrix(); pivot.matrix.multiply(L); pivot.matrix.decompose(pivot.position, pivot.quaternion, pivot.scale);
  for (const c of pivot.children) { c.updateMatrix(); c.matrix.premultiply(Linv); c.matrix.decompose(c.position, c.quaternion, c.scale); }
  pivot.updateMatrixWorld(true);
  return { radius: R - 0.012, shift: off.length(), tilt: Math.acos(nrm.z), rms };
}

// ---------------- 手臂 ----------------
// 写实的带手套手臂（Sketchfab「Fps arms」，作者 bumstrum，CC BY 4.0；骨骼是在 Blender 里另外绑的：上臂 / 前臂 / 手）
// 每帧用两段反向动力学把手腕送到方向盘边缘，手掌包住轮缘、手背朝外，随方向盘转动

let armsTpl = null, armsPromise = null, wheelTpl = null, wheelPromise = null;
export function loadSteeringWheel() {
  return wheelPromise || (wheelPromise = new GLTFLoader().loadAsync('assets/driver/steering_wheel.glb').then(g => (wheelTpl = g.scene)).catch(e => { console.warn('wheel', e); return null; }));
}
export function loadArms() {
  return armsPromise || (armsPromise = new GLTFLoader().loadAsync('assets/driver/arms.glb').then(g => {
    armsTpl = g.scene;
    armsTpl.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.castShadow = false; o.receiveShadow = true; if (o.material) o.material.envMapIntensity = 1; } });
    return armsTpl;
  }).catch(e => { console.warn('arms', e); return null; }));
}
export const armsReady = () => !!armsTpl;

const _m0 = new THREE.Matrix4(), _m1 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _qp = new THREE.Quaternion();
function frame(aim, ref, out) {         // 以 aim 为 Y、ref（正交化后）为 Z 的旋转矩阵
  const y = aim.clone().normalize(), z = ref.clone().addScaledVector(y, -ref.dot(y)).normalize(), x = V().crossVectors(y, z);
  return out.makeBasis(x, y, z);
}

// 握姿：手指已在 Blender 里按"握住一根半径 1.6 cm 的圆杆"摆好并烘焙进模型（逐关节弯到贴住杆面为止）。
// 这根杆在模型静止坐标里的位置 / 方向（Blender 里 C=(±0.148,-0.338,-0.03)，杆向前倾 27°，转成 glTF 的 Y 朝上）
const GRIP_T = 27 * Math.PI / 180, GRIP_R = 0.016;
export const HAND_FOLLOW = 0.6;   // 手跟着方向盘转的范围（±34°）；方向盘显示的最大转角也取这个值，手始终握在轮缘上
const GRIP_C = (sx) => V(sx * 0.148, -0.03, 0.338), GRIP_K = V(0, Math.cos(GRIP_T), Math.sin(GRIP_T));

// 量方向盘轮缘的实际截面：在握点角度附近取最外圈的顶点，得到轮缘管的中线半径、管在盘轴方向的位置和管粗
function measureRim(pivot, a0, rOut = null) {     // rOut：拟合出的轮缘外半径，比它还远的点（拨杆、仪表台碎片）不算
  pivot.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(pivot.matrixWorld).invert(), m = new THREE.Matrix4(), p = V(), pts = [];
  pivot.traverse(o => {
    if (!o.isMesh) return;
    m.multiplyMatrices(inv, o.matrixWorld);
    const P = o.geometry.attributes.position, I = o.geometry.index;
    const n = I ? I.count : P.count, seen = new Set();
    for (let t = 0; t < n; t++) {
      const k = I ? I.getX(t) : t; if (seen.has(k)) continue; seen.add(k);
      p.fromBufferAttribute(P, k).applyMatrix4(m);
      let da = Math.atan2(p.y, p.x) - a0; da = Math.atan2(Math.sin(da), Math.cos(da));
      const r = Math.hypot(p.x, p.y); if (Math.abs(da) < 0.14 && (!rOut || r < rOut + 0.006)) pts.push([r, p.z]);
    }
  });
  if (pts.length < 8) return null;
  const rMax = Math.max(...pts.map(q => q[0])), outer = pts.filter(q => q[0] > rMax - 0.02);     // 只看轮缘外半圈，避开轮辐接头
  let zMin = Infinity, zMax = -Infinity; for (const q of outer) { zMin = Math.min(zMin, q[1]); zMax = Math.max(zMax, q[1]); }
  const tube = THREE.MathUtils.clamp((zMax - zMin) / 2, 0.008, 0.024);
  return { r: rMax - tube, z: (zMin + zMax) / 2, tube };
}

export class Arms {
  constructor(view) {
    this.view = view;
    this.root = SkeletonUtils.clone(armsTpl); this.root.name = 'driver_arms';
    view.body.add(this.root);
    this.root.updateMatrixWorld(true);
    const rootInv = new THREE.Matrix4().copy(this.root.matrixWorld).invert();
    const rel = (o) => new THREE.Matrix4().multiplyMatrices(rootInv, o.matrixWorld);
    const P = view.steerInfo, R0 = P.radius * 0.93;
    this.sides = ['L', 'R'].map((n, i) => {
      const up = this.root.getObjectByName('upper_' + n), fo = this.root.getObjectByName('fore_' + n), ha = this.root.getObjectByName('hand_' + n);
      const pU = V().setFromMatrixPosition(rel(up)), pF = V().setFromMatrixPosition(rel(fo)), pH = V().setFromMatrixPosition(rel(ha));
      const qU = new THREE.Quaternion().setFromRotationMatrix(rel(up)), qF = new THREE.Quaternion().setFromRotationMatrix(rel(fo)), qH = new THREE.Quaternion().setFromRotationMatrix(rel(ha));
      const sx = i === 0 ? 1 : -1, a0 = sx > 0 ? Math.PI - 0.3 : 0.3;
      // 静止姿势里"握杆"的坐标系：杆外侧（手背那边）、杆方向（指向食指 / 拇指）、朝车手
      const C = GRIP_C(sx), K = GRIP_K.clone();
      const restGrip = new THREE.Matrix4().makeBasis(V(sx, 0, 0), K, V(0, Math.sin(GRIP_T), -Math.cos(GRIP_T)));
      const ref = view.steerPivot && view.steerPivot.userData.refine, rOut = ref ? ref.radius + 0.012 : null;
      const rim = (view.steerPivot && measureRim(view.steerPivot, a0, rOut)) || { r: R0, z: 0, tube: GRIP_R };
      return {
        upPos0: up.position.clone(), upParentInv: new THREE.Matrix3().setFromMatrix4(rel(up.parent)).invert(), haQ0: ha.quaternion.clone(), foQ0: fo.quaternion.clone(),
        sx, a0, up, fo, ha, L1: pU.distanceTo(pF), L2: pF.distanceTo(pH), shoulderRest: pU, rim,
        handOff: pH.clone().sub(C),                 // 手骨根部相对杆中心
        restGripT: restGrip.clone().transpose(),
        rest: { U: { q: qU, aim: pF.clone().sub(pU), ref: V(0, 1, 0) }, F: { q: qF, aim: pH.clone().sub(pF), ref: V(0, 1, 0) }, qH },
      };
    });
    this.root.visible = false;
  }
  // 把骨骼 b 摆成：指向 aim、参考方向 ref（都在车身坐标），rest 是它静止时的朝向数据，parentQ 是父骨骼此刻在车身坐标里的朝向
  _aim(b, rest, aim, ref, parentQ) {
    frame(rest.aim, rest.ref, _m0); frame(aim, ref, _m1);
    const qAlign = new THREE.Quaternion().setFromRotationMatrix(_m1.multiply(_m0.transpose()));
    const qWorld = qAlign.multiply(rest.q);
    b.quaternion.copy(parentQ.clone().invert().multiply(qWorld));
    return qWorld;
  }
  update(wheelRot) {
    const v = this.view, P = v.steerInfo; if (!P) return;
    const eye = v.eye, base = P.base;
    const axis = P.axis.clone().normalize();
    // 先算两只手要到的位置和朝向：握姿坐标系对齐到握点处的轮缘（杆方向 = 轮缘切线，手背朝外偏车手）
    const tgt = this.sides.map(s => {
      const a = s.a0 + THREE.MathUtils.clamp(wheelRot, -HAND_FOLLOW, HAND_FOLLOW);   // 转太多时手在轮缘上滑，不再跟
      const c = Math.cos(a), sn = Math.sin(a);
      const g = V(c * s.rim.r, sn * s.rim.r, s.rim.z).applyMatrix4(base);   // 轮缘管中心
      const ro = V(c, sn, 0).transformDirection(base);
      const tg = V(-sn, c, 0).transformDirection(base);
      const along = s.sx > 0 ? tg.clone().negate() : tg.clone();             // 沿轮缘指向食指那头
      const M = new THREE.Matrix4().makeBasis(ro, along, axis).multiply(s.restGripT);   // axis：盘面法线，朝车手
      const Q = new THREE.Quaternion().setFromRotationMatrix(M);
      const qH = Q.clone().multiply(s.rest.qH);
      // 管比 1.6 cm 细（粗）时，手往杆心靠（离开）一点，保证手掌贴住
      const n = s.handOff.clone().addScaledVector(GRIP_K, -s.handOff.dot(GRIP_K)).normalize().applyQuaternion(Q);
      const wrist = g.clone().add(s.handOff.clone().applyQuaternion(Q)).addScaledVector(n, (s.rim.tube - GRIP_R) * 0.7);
      return { wrist, qH, Q };
    });
    // 肩膀位置（根节点按左肩放）；手臂伸不到时这一侧的肩膀往手的方向探出去（最多 12 cm，和真人送肩一样）
    const shL = V(eye.x + 0.208, eye.y - 0.31, eye.z - 0.04);
    const s0 = this.sides[0];
    this.root.position.copy(shL).sub(s0.shoulderRest);
    this.root.quaternion.identity(); this.root.updateMatrixWorld(true);
    const rootQ = new THREE.Quaternion();   // 根节点在车身坐标里没有旋转
    this.sides.forEach((s, i) => {
      const sh0 = this.root.position.clone().add(s.shoulderRest);
      const toW = tgt[i].wrist.clone().sub(sh0), need = toW.length() - (s.L1 + s.L2) * 0.97;
      const push = need > 0 ? toW.normalize().multiplyScalar(Math.min(0.12, need)) : V();
      s.up.position.copy(s.upPos0).add(push.clone().applyMatrix3(s.upParentInv));
      const sh = sh0.add(push);
      let wrist = tgt[i].wrist.clone();
      // 两段反向动力学：肩 → 肘 → 腕，肘往外、往下张
      let d = wrist.clone().sub(sh), dist = d.length();
      const maxL = s.L1 + s.L2 - 0.002; s.reach = dist / maxL; if (dist > maxL) { wrist = sh.clone().addScaledVector(d.normalize(), maxL); d = wrist.clone().sub(sh); dist = maxL; }
      const dir = d.clone().divideScalar(dist);
      const pole = V(s.sx * 0.8, -1, 0.15).normalize(), bend = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
      const x = (s.L1 * s.L1 - s.L2 * s.L2 + dist * dist) / (2 * dist), h = Math.sqrt(Math.max(0, s.L1 * s.L1 - x * x));
      const elbow = sh.clone().addScaledVector(dir, x).addScaledVector(bend, h);
      const qU = this._aim(s.up, s.rest.U, elbow.clone().sub(sh), bend.clone().negate().add(V(0, 0.6, 0)), rootQ);
      // 前臂的滚转跟着手走（前臂静止时的"上"方向经过同样的旋转），手腕不会拧麻花
      const foreRef = V(0, 1, 0).applyQuaternion(tgt[i].Q).add(V(0, 0.3, 0));
      const qF = this._aim(s.fo, s.rest.F, wrist.clone().sub(elbow), foreRef, qU);
      s.ha.quaternion.copy(qF.clone().invert().multiply(tgt[i].qH));
    });
  }
}
