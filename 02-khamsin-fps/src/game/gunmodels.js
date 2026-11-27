// 第一人称枪械与手臂建模：侧面轮廓挤出 + 倒角（枪身/护木/枪托），圆管（枪管/瞄具），逐指节的手套
// 坐标：x 右，y 上，z 后（枪口朝 -z）。轮廓点写作 [f, y]，f 为沿枪管向前的距离。
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTex } from '../gfx/texgen.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _e = new THREE.Euler(), _up = new THREE.Vector3(0, 1, 0);

export class Parts {
  constructor() { this.m = new Map(); }
  _add(mat, g) { if (g.index) g = g.toNonIndexed(); for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k); if (!this.m.has(mat)) this.m.set(mat, []); this.m.get(mat).push(g); return this; }
  box(mat, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0, r = 0.006) {
    const g = new RoundedBoxGeometry(w, h, d, 2, Math.min(r, Math.min(w, h, d) * 0.45));
    _e.set(rx, ry, rz, 'YXZ'); g.applyMatrix4(new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromEuler(_e), V(1, 1, 1)));
    return this._add(mat, g);
  }
  // 直角小方块（导轨齿等重复小件，省顶点）
  pbox(mat, w, h, d, x, y, z) { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return this._add(mat, g); }
  cyl(mat, r, len, x, y, z, axis = 'z', seg = 14, r2 = null) {
    const g = new THREE.CylinderGeometry(r2 === null ? r : r2, r, len, seg);
    if (axis === 'z') g.rotateX(Math.PI / 2); else if (axis === 'x') g.rotateZ(Math.PI / 2);
    g.translate(x, y, z); return this._add(mat, g);
  }
  // 两点之间的（可变径）圆管
  tube(mat, a, b, r0, r1 = r0, seg = 12, uvs = null) {
    const d = new THREE.Vector3().subVectors(b, a); const len = d.length(); const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1);
    if (uvs) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uvs[0], uv.getY(i) * uvs[1]); }
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(_up, d.normalize()), V(1, 1, 1)));
    return this._add(mat, g);
  }
  ball(mat, p, r, ws = 10, hs = 8) { const g = new THREE.SphereGeometry(r, ws, hs); g.translate(p.x, p.y, p.z); return this._add(mat, g); }
  limb(mat, a, b, w, h) {
    const d = new THREE.Vector3().subVectors(b, a); const len = d.length(); const g = new RoundedBoxGeometry(w, h, len, 2, Math.min(w, h) * 0.35);
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), d.normalize()), V(1, 1, 1)));
    return this._add(mat, g);
  }
  // 侧面轮廓（[f,y] 点列）沿 x 方向挤出，带倒角；o.holes 为镂空孔
  profile(mat, pts, thick, o = {}) {
    const sh = new THREE.Shape(); pts.forEach(([f, y], i) => (i ? sh.lineTo(f, y) : sh.moveTo(f, y))); sh.closePath();
    if (o.holes) for (const h of o.holes) { const p = new THREE.Path(); h.forEach(([f, y], i) => (i ? p.lineTo(f, y) : p.moveTo(f, y))); p.closePath(); sh.holes.push(p); }
    const bv = o.bevel === undefined ? 0.0025 : o.bevel;
    const g = new THREE.ExtrudeGeometry(sh, { depth: Math.max(1e-4, thick - 2 * bv), bevelEnabled: bv > 0, bevelThickness: bv, bevelSize: bv, bevelOffset: -bv, bevelSegments: 2, curveSegments: 6 });
    const uv = g.attributes.uv; const k = o.uv || 5; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * k, uv.getY(i) * k);
    const m = new THREE.Matrix4().makeBasis(V(0, 0, -1), V(0, 1, 0), V(1, 0, 0)); m.setPosition((o.x || 0) - thick / 2 + bv, 0, 0);
    g.applyMatrix4(m); return this._add(mat, g);
  }
  // 正面轮廓（[x,y] 点列）沿枪管方向挤出：瞄具框等
  frame(mat, outer, inner, depth, zc, bevel = 0.0015) {
    const sh = new THREE.Shape(); outer.forEach(([x, y], i) => (i ? sh.lineTo(x, y) : sh.moveTo(x, y))); sh.closePath();
    if (inner) { const p = new THREE.Path(); inner.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y))); p.closePath(); sh.holes.push(p); }
    const g = new THREE.ExtrudeGeometry(sh, { depth: depth - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 1 });
    g.translate(0, 0, zc - depth / 2 + bevel); return this._add(mat, g);
  }
  // 手指：从 base 出发沿 dir，绕 axis 逐节弯曲
  finger(mat, base, dir, axis, lens, curls, r) {
    const p = base.clone(); const d = dir.clone().normalize(); let rad = r;
    this.ball(mat, p, rad * 1.08, 8, 6);
    for (let i = 0; i < lens.length; i++) {
      d.applyAxisAngle(axis, curls[i]); const q = p.clone().addScaledVector(d, lens[i]);
      this.tube(mat, p, q, rad, rad * 0.9, 8); rad *= 0.9; this.ball(mat, q, rad * 1.05, 8, 6); p.copy(q);
    }
    return this;
  }
  // 把另一组零件整体变换后并入
  add(other, matrix) { for (const [k, list] of other.m) for (const g of list) { if (matrix) g.applyMatrix4(matrix); if (!this.m.has(k)) this.m.set(k, []); this.m.get(k).push(g); } return this; }
  build(mats, shadow = false) {
    const grp = new THREE.Group();
    for (const [k, list] of this.m) { const mesh = new THREE.Mesh(mergeGeometries(list), mats[k]); mesh.receiveShadow = true; mesh.castShadow = shadow; mesh.frustumCulled = shadow; grp.add(mesh); }
    return grp;
  }
}

const slot = (fc, yc, w, h) => { const a = w / 2, b = h / 2, c = Math.min(a, b) * 0.6; return [[fc - a + c, yc - b], [fc + a - c, yc - b], [fc + a, yc - b + c], [fc + a, yc + b - c], [fc + a - c, yc + b], [fc - a + c, yc + b], [fc - a, yc + b - c], [fc - a, yc - b + c]]; };
const GRIP = [[-0.088, -0.046], [-0.044, -0.05], [-0.07, -0.15], [-0.115, -0.146], [-0.106, -0.085]];
const TGUARD = [[-0.046, -0.05], [0.032, -0.05], [0.032, -0.058], [-0.03, -0.084], [-0.052, -0.078]];
const TGUARD_H = [[-0.041, -0.054], [0.027, -0.054], [0.027, -0.056], [-0.031, -0.078], [-0.046, -0.073]];

// 皮卡汀尼导轨：底座 + 一排齿
function rail(P, f0, f1, y, w = 0.021) {
  P.pbox('metal', w, 0.005, f1 - f0, 0, y + 0.0025, -(f0 + f1) / 2);
  for (let f = f0 + 0.004; f < f1 - 0.004; f += 0.0104) P.pbox('metal', w, 0.0042, 0.0056, 0, y + 0.007, -f);
}
// 握把、扳机护圈、扳机（三把枪共用同一握持位置）
function gripGroup(P) {
  P.profile('tan', GRIP, 0.034, { bevel: 0.005 }).profile('metal', TGUARD, 0.012, { holes: [TGUARD_H], bevel: 0.001 })
    .box('metalBare', 0.006, 0.024, 0.007, 0, -0.064, 0.012, 0.35, 0, 0, 0.002);
  for (let i = 0; i < 5; i++) P.pbox('dark', 0.0352, 0.0025, 0.03, 0, -0.07 - i * 0.014, 0.076 + i * 0.0036);
}

// 机身铭文贴花
function markings(text1, text2) {
  return canvasTex(256, 64, (g) => {
    g.clearRect(0, 0, 256, 64); g.fillStyle = 'rgba(235,235,230,0.92)'; g.font = '700 22px "Helvetica Neue", Arial, sans-serif'; g.textBaseline = 'middle';
    g.fillText(text1, 6, 20); g.font = '600 13px "Helvetica Neue", Arial, sans-serif'; g.fillText(text2, 6, 46);
    g.strokeStyle = 'rgba(235,235,230,0.9)'; g.lineWidth = 2; g.strokeRect(196, 8, 50, 48); g.fillStyle = 'rgba(210,60,40,0.95)'; g.beginPath(); g.arc(221, 32, 6, 0, 7); g.fill();
  });
}
function decalMesh(tex, w, h) { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.6, metalness: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })); m.frustumCulled = false; m.renderOrder = 2; return m; }

// 步枪上由 three.js 生成的附件：全息准星、镜片、弹药计数屏、机身铭文（程序化枪模与 GLB 枪模共用）
// 文字 / 标牌贴花
function textDecal(lines, w, h, { px = 256, py = 64, color = 'rgba(232,232,226,0.9)', bg = null, font = '600 20px "Helvetica Neue", Arial, sans-serif', align = 'left', border = null } = {}) {
  const tex = canvasTex(px, py, (g) => {
    g.clearRect(0, 0, px, py); if (bg) { g.fillStyle = bg; g.fillRect(0, 0, px, py); }
    if (border) { g.strokeStyle = border; g.lineWidth = 3; g.strokeRect(3, 3, px - 6, py - 6); }
    g.fillStyle = color; g.textBaseline = 'middle'; g.textAlign = align; const n = lines.length;
    lines.forEach((ln, i) => { const [t, f] = Array.isArray(ln) ? ln : [ln, font]; g.font = f; g.fillText(t, align === 'center' ? px / 2 : 8, py * (i + 0.5) / n + 1); });
  });
  return decalMesh(tex, w, h);
}
const leftSide = (m, x, y, z) => { m.position.set(x, y, z); m.rotation.y = -Math.PI / 2; return m; };

export function rifleExtras(group, ammoTex, decalX = -0.0222, detail = false) {
  // 全息准星：细环 + 小中心点 + 四个外刻度（约 2° 视角的环、1 角分量级的点），不挡目标
  const retTex = canvasTex(128, 128, (g) => {
    g.clearRect(0, 0, 128, 128); g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineCap = 'butt';
    g.lineWidth = 2.4; g.beginPath(); g.arc(64, 64, 39, 0, 7); g.stroke();
    g.beginPath(); g.arc(64, 64, 4.0, 0, 7); g.fill();
    g.lineWidth = 2.4; for (const [x0, y0, x1, y1] of [[64, 19, 64, 10], [64, 109, 64, 118], [19, 64, 10, 64], [109, 64, 118, 64]]) { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }
  }, { srgb: false });
  retTex.anisotropy = 4;
  const ret = new THREE.Mesh(new THREE.PlaneGeometry(0.0125, 0.0125), new THREE.MeshBasicMaterial({ map: retTex, color: new THREE.Color(1.25, 0.035, 0.02), transparent: true, depthWrite: false, fog: false }));   // 普通混合 + 不过曝：背景再亮准星也保持饱和的红色
  ret.position.set(0, 0.1, -0.0); ret.renderOrder = 9; group.add(ret);
  const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.038, 0.034), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.03, 0.08, 0.09), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  lens.position.set(0, 0.1, -0.002); group.add(lens);
  const disp = new THREE.Mesh(new THREE.PlaneGeometry(0.028, 0.016), new THREE.MeshBasicMaterial({ map: ammoTex, color: new THREE.Color(2.2, 2.2, 2.2), fog: false }));
  disp.position.set(0, 0.0805, -0.1976); disp.rotation.x = -1.22; disp.name = 'ammoDisp'; group.add(disp);
  group.add(gunDecal('KH-27', 'CAL 5.8×42  KHAMSIN ARMS', 0.085, 0.021, decalX, 0.03, 0.03));
  if (detail) {   // 硬表面枪模上的小标识：序列号、保险标记、激光警示牌、瞄具型号、枪托厂牌
    const small = '600 30px "Helvetica Neue", Arial, sans-serif';
    group.add(leftSide(textDecal([['SN  KA-204771', small]], 0.044, 0.0066, { py: 38 }), -0.01938, -0.0170, 0.098));
    group.add(leftSide(textDecal([['SAFE', '700 34px "Helvetica Neue", Arial, sans-serif']], 0.0130, 0.0050, { px: 128, py: 48, align: 'center' }), -0.02012, -0.0105, 0.0235));
    group.add(leftSide(textDecal([['AUTO', '700 34px "Helvetica Neue", Arial, sans-serif']], 0.0130, 0.0050, { px: 128, py: 48, align: 'center', color: 'rgba(225,70,50,0.95)' }), -0.02012, -0.0245, 0.060));
    group.add(leftSide(textDecal([['DANGER', '800 30px "Helvetica Neue", Arial, sans-serif'], ['LASER  CLASS 3B', '700 20px "Helvetica Neue", Arial, sans-serif']], 0.0300, 0.0140, { px: 256, py: 120, align: 'center', color: 'rgba(20,18,12,0.95)', bg: 'rgba(214,170,40,0.95)', border: 'rgba(20,18,12,0.9)' }), -0.05512, 0.0310, -0.378));
    group.add(leftSide(textDecal([['KA  HOLO-2   1×', '600 30px "Helvetica Neue", Arial, sans-serif']], 0.0340, 0.0056, { py: 42 }), -0.02672, 0.1085, 0.003));
    group.add(leftSide(textDecal([['KHAMSIN ARMS', '800 34px "Helvetica Neue", Arial, sans-serif']], 0.0520, 0.0090, { py: 44, color: 'rgba(52,40,26,0.8)' }), -0.02005, 0.0300, 0.262));
  }
}
export function gunDecal(t1, t2, w, h, x, y, z) { const dec = decalMesh(markings(t1, t2), w, h); dec.position.set(x, y, z); dec.rotation.y = -Math.PI / 2; return dec; }

// ---------------- 突击步枪 ----------------
export function buildRifle(mats, ammoTex) {
  const P = new Parts();
  // 上机匣 / 下机匣
  P.profile('metal', [[-0.165, 0.012], [-0.165, 0.048], [-0.145, 0.060], [0.205, 0.060], [0.205, 0.006], [0.078, 0.006], [0.07, -0.002], [-0.115, -0.002], [-0.135, 0.012]], 0.044);
  P.profile('metal', [[-0.135, -0.002], [0.078, -0.002], [0.078, -0.046], [0.034, -0.05], [0.03, -0.03], [-0.034, -0.03], [-0.046, -0.046], [-0.09, -0.05], [-0.135, -0.022]], 0.040);
  P.box('metal', 0.047, 0.012, 0.05, 0, -0.049, -0.056, 0, 0, 0, 0.004);
  gripGroup(P);
  // 镂空护木 + 内部枪管 / 导气管
  const slots = []; for (let i = 0; i < 5; i++) slots.push(slot(0.245 + i * 0.046, 0.031, 0.032, 0.013));
  P.profile('tan', [[0.205, 0.058], [0.475, 0.058], [0.475, 0.012], [0.455, 0.002], [0.225, 0.002], [0.205, 0.010]], 0.048, { holes: slots, bevel: 0.003 });
  P.tube('metalBare', V(0, 0.026, -0.205), V(0, 0.026, -0.575), 0.0085, 0.0085, 12).tube('metalBare', V(0, 0.046, -0.21), V(0, 0.046, -0.445), 0.004, 0.004, 8);
  P.box('metal', 0.022, 0.03, 0.03, 0, 0.036, -0.455, 0, 0, 0, 0.004);
  // 枪口装置
  P.tube('metal', V(0, 0.026, -0.572), V(0, 0.026, -0.648), 0.0135, 0.0135, 14).tube('metalBare', V(0, 0.026, -0.648), V(0, 0.026, -0.656), 0.0115, 0.0115, 12).tube('dark', V(0, 0.026, -0.6565), V(0, 0.026, -0.657), 0.007, 0.007, 10);
  for (const f of [0.592, 0.61, 0.628]) { P.pbox('dark', 0.0285, 0.006, 0.009, 0, 0.026, -f); P.pbox('dark', 0.006, 0.0285, 0.009, 0, 0.026, -f); }
  // 全长导轨
  rail(P, -0.145, 0.475, 0.060);
  // 枪托：缓冲管 + 镂空托体 + 托底板
  P.tube('metal', V(0, 0.03, 0.165), V(0, 0.03, 0.405), 0.0135, 0.0135, 12);
  P.profile('tan', [[-0.235, 0.050], [-0.40, 0.050], [-0.418, 0.036], [-0.418, -0.078], [-0.398, -0.092], [-0.37, -0.05], [-0.31, -0.008], [-0.235, 0.006]], 0.038, { holes: [[[-0.335, 0.004], [-0.385, 0.004], [-0.398, -0.03], [-0.386, -0.05]]], bevel: 0.004 });
  P.box('dark', 0.04, 0.132, 0.012, 0, -0.022, 0.424, 0, 0, 0, 0.005).box('metal', 0.03, 0.02, 0.03, 0, 0.03, 0.21, 0, 0, 0, 0.004);
  // 细节：抛壳窗、防尘盖、辅助推机柄、快慢机、销钉、空仓挂机
  P.pbox('dark', 0.003, 0.02, 0.062, 0.0225, 0.03, -0.035).box('metalBare', 0.002, 0.014, 0.056, 0.0222, 0.03, -0.035, 0, 0, 0, 0.001).box('metal', 0.004, 0.006, 0.066, 0.024, 0.017, -0.035, 0, 0, 0.5, 0.001);
  P.cyl('metal', 0.007, 0.016, 0.027, 0.038, 0.085, 'x', 10).cyl('metalBare', 0.0045, 0.045, 0, 0.004, 0.06, 'x', 8).cyl('metalBare', 0.0045, 0.045, 0, 0.004, -0.068, 'x', 8);
  P.cyl('metalBare', 0.0055, 0.006, -0.0225, -0.012, 0.045, 'x', 10).box('metal', 0.004, 0.006, 0.022, -0.0245, -0.012, 0.034, 0, 0, 0, 0.001).box('metal', 0.004, 0.022, 0.012, -0.0235, 0.012, -0.02, 0, 0, 0, 0.001)
    .cyl('metal', 0.005, 0.006, 0.0225, -0.012, -0.03, 'x', 10).box('metal', 0.048, 0.008, 0.012, 0, 0.052, 0.158, 0, 0, 0, 0.002);
  // 垂直前握把
  P.profile('poly', [[0.30, 0.002], [0.362, 0.002], [0.35, -0.072], [0.312, -0.078]], 0.03, { bevel: 0.004 }).box('poly', 0.034, 0.008, 0.07, 0, 0.0, -0.331, 0, 0, 0, 0.003);
  // 右侧战术灯
  P.box('metal', 0.012, 0.022, 0.05, 0.032, 0.03, -0.39, 0, 0, 0, 0.003).tube('poly', V(0.046, 0.03, -0.35), V(0.046, 0.03, -0.44), 0.012, 0.012, 12).tube('metal', V(0.046, 0.03, -0.44), V(0.046, 0.03, -0.456), 0.0145, 0.0145, 12).tube('glow', V(0.046, 0.03, -0.4562), V(0.046, 0.03, -0.4566), 0.0105, 0.0105, 10);
  // 全息瞄具：底座 + 镜框
  P.box('metal', 0.03, 0.012, 0.062, 0, 0.074, -0.0, 0, 0, 0, 0.003).box('metal', 0.036, 0.006, 0.02, 0, 0.069, 0.022, 0, 0, 0, 0.002);
  const ow = 0.023, oh = 0.041, iw = 0.0185, ih = 0.0345, y0 = 0.079;
  P.frame('metal', [[-ow, y0], [ow, y0], [ow, y0 + oh - 0.006], [ow - 0.006, y0 + oh], [-ow + 0.006, y0 + oh], [-ow, y0 + oh - 0.006]], [[-iw, y0 + 0.004], [iw, y0 + 0.004], [iw, y0 + ih - 0.003], [iw - 0.004, y0 + ih + 0.001], [-iw + 0.004, y0 + ih + 0.001], [-iw, y0 + ih - 0.003]], 0.05, -0.0);
  P.box('metal', 0.004, 0.02, 0.03, 0.0255, 0.09, 0.0, 0, 0, 0, 0.001).cyl('metal', 0.004, 0.006, -0.026, 0.092, 0.008, 'x', 8).cyl('metal', 0.004, 0.006, -0.026, 0.092, -0.006, 'x', 8);
  // 弹药计数屏底座（护木导轨上，瞄准时被瞄具遮住）
  P.box('metal', 0.034, 0.012, 0.028, 0, 0.073, -0.2, -0.35, 0, 0, 0.003);
  const group = P.build(mats);
  // 弹匣（活动件）
  const M = new Parts().profile('tan', [[0.036, -0.04], [0.076, -0.04], [0.094, -0.168], [0.05, -0.182]], 0.026, { bevel: 0.003 }).box('dark', 0.03, 0.008, 0.05, 0, -0.178, -0.072, -0.13, 0, 0, 0.002);
  for (let i = 0; i < 4; i++) M.pbox('dark', 0.0268, 0.003, 0.03, 0, -0.07 - i * 0.024, -(0.062 + i * 0.0034));
  const mag = M.build(mats); group.add(mag);
  // 拉机柄 + 枪机（活动件）
  const bolt = new Parts().box('metal', 0.05, 0.008, 0.02, 0, 0.056, 0.162, 0, 0, 0, 0.002).box('metal', 0.012, 0.01, 0.012, -0.024, 0.056, 0.168, 0, 0, 0, 0.002).build(mats); group.add(bolt);
  rifleExtras(group, ammoTex);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.026, -0.70); group.add(muzzle);
  const eject = new THREE.Object3D(); eject.position.set(0.03, 0.03, -0.035); group.add(eject);
  return { group, mag, bolt, muzzle, eject, gripL: V(0, 0, -0.331), sightY: 0.1 };
}

// ---------------- 霰弹枪 ----------------
export function buildShotgun(mats) {
  const P = new Parts();
  P.profile('metal', [[-0.14, -0.018], [-0.14, 0.044], [-0.112, 0.058], [0.165, 0.058], [0.165, -0.012], [0.03, -0.03], [-0.09, -0.03]], 0.046);
  gripGroup(P);
  P.tube('metalBare', V(0, 0.04, -0.165), V(0, 0.04, -0.60), 0.0125, 0.0125, 14).tube('metal', V(0, 0.012, -0.165), V(0, 0.012, -0.53), 0.0125, 0.0125, 14).tube('metal', V(0, 0.012, -0.53), V(0, 0.012, -0.545), 0.014, 0.014, 12);
  P.tube('metal', V(0, 0.04, -0.60), V(0, 0.04, -0.63), 0.016, 0.016, 14).tube('dark', V(0, 0.04, -0.6305), V(0, 0.04, -0.631), 0.0105, 0.0105, 12);
  P.box('metal', 0.02, 0.05, 0.016, 0, 0.026, -0.50, 0, 0, 0, 0.003).box('metal', 0.02, 0.05, 0.016, 0, 0.026, -0.21, 0, 0, 0, 0.003);
  // 打孔散热护板
  const hs = []; for (let i = 0; i < 7; i++) hs.push(slot(0.215 + i * 0.04, 0.062, 0.024, 0.006));
  P.profile('metal', [[0.19, 0.050], [0.48, 0.050], [0.48, 0.074], [0.19, 0.074]], 0.032, { holes: hs, bevel: 0.002 });
  // 枪托
  P.profile('tan', [[-0.14, 0.040], [-0.40, 0.022], [-0.412, 0.008], [-0.412, -0.086], [-0.39, -0.098], [-0.30, -0.04], [-0.14, -0.018]], 0.04, { bevel: 0.005 }).box('dark', 0.042, 0.12, 0.012, 0, -0.036, 0.418, -0.05, 0, 0, 0.005);
  // 机匣细节：抛壳口、短导轨、照门、侧面弹夹板
  P.pbox('dark', 0.003, 0.022, 0.07, 0.0235, 0.028, -0.03).box('metalBare', 0.002, 0.016, 0.064, 0.0232, 0.028, -0.03, 0, 0, 0, 0.001);
  rail(P, -0.10, 0.12, 0.058);
  // 觇孔照门（环形）+ 带护翼的准星（红色光纤）
  const SY = 0.092; const oct = (r) => { const a = []; for (let i = 0; i < 12; i++) { const t = i / 12 * Math.PI * 2; a.push([Math.cos(t) * r, SY + Math.sin(t) * r]); } return a; };
  P.frame('metal', oct(0.0135), oct(0.0092), 0.006, 0.075, 0.001).box('metal', 0.022, 0.012, 0.022, 0, 0.073, 0.075, 0, 0, 0, 0.002).box('metal', 0.008, 0.012, 0.006, 0, 0.081, 0.075, 0, 0, 0, 0.001);
  P.box('metal', 0.022, 0.01, 0.022, 0, 0.061, -0.59, 0, 0, 0, 0.002).box('metal', 0.0032, 0.03, 0.006, 0, 0.0765, -0.59, 0, 0, 0, 0.001).cyl('red', 0.0024, 0.01, 0, SY, -0.588, 'z', 8);
  for (const sx of [-1, 1]) P.box('metal', 0.0025, 0.03, 0.016, sx * 0.0095, 0.079, -0.59, 0, 0, sx * -0.22, 0.001);
  P.box('poly', 0.01, 0.036, 0.15, -0.0275, 0.016, -0.04, 0, 0, 0, 0.003);
  for (let i = 0; i < 5; i++) { P.cyl('shell', 0.0095, 0.046, -0.037, 0.012, -0.095 + i * 0.027, 'y', 12).cyl('brass', 0.0098, 0.01, -0.037, 0.04, -0.095 + i * 0.027, 'y', 12); }
  P.cyl('metalBare', 0.0045, 0.047, 0, -0.004, 0.02, 'x', 8).cyl('metal', 0.005, 0.006, 0.0235, -0.01, -0.04, 'x', 10);
  const group = P.build(mats);
  // 泵动护木（活动件），带垂直握把
  const pm = new Parts().profile('tan', [[0.225, 0.002], [0.405, 0.002], [0.405, -0.02], [0.385, -0.032], [0.245, -0.032], [0.225, -0.02]], 0.052, { bevel: 0.004 }).profile('poly', [[0.30, -0.03], [0.36, -0.03], [0.35, -0.098], [0.312, -0.104]], 0.03, { bevel: 0.004 });
  for (let i = 0; i < 7; i++) pm.pbox('dark', 0.0535, 0.012, 0.004, 0, -0.014, -(0.25 + i * 0.022));
  const pump = pm.build(mats); group.add(pump);
  const dec = decalMesh(markings('SG-8', '12 GA  KHAMSIN ARMS'), 0.08, 0.02); dec.position.set(-0.0232, 0.038, 0.07); dec.rotation.y = -Math.PI / 2; group.add(dec);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.04, -0.66); group.add(muzzle);
  const eject = new THREE.Object3D(); eject.position.set(0.03, 0.028, -0.03); group.add(eject);
  return { group, mag: null, bolt: pump, muzzle, eject, gripL: V(0, -0.03, -0.331), sightY: 0.092 };
}

// ---------------- 轨道步枪 ----------------
export function buildRail(mats) {
  const P = new Parts();
  P.profile('metal', [[-0.16, -0.02], [-0.16, 0.05], [-0.125, 0.066], [0.22, 0.066], [0.262, 0.04], [0.262, -0.01], [0.10, -0.03], [-0.09, -0.03]], 0.052);
  gripGroup(P);
  // 护罩（镂空）
  const hs = []; for (let i = 0; i < 4; i++) hs.push(slot(0.275 + i * 0.045, 0.03, 0.03, 0.016));
  P.profile('tan', [[0.225, 0.072], [0.44, 0.072], [0.462, 0.056], [0.462, -0.014], [0.245, -0.014], [0.225, 0.0]], 0.06, { holes: hs, bevel: 0.004 });
  // 上下四根导轨 + 末端发射口
  for (const sx of [-1, 1]) {
    P.profile('metal', [[0.26, 0.052], [0.845, 0.052], [0.862, 0.042], [0.862, 0.034], [0.26, 0.034]], 0.011, { x: sx * 0.0175, bevel: 0.0015 });
    P.profile('metal', [[0.26, 0.012], [0.862, 0.012], [0.862, 0.004], [0.845, -0.006], [0.26, -0.006]], 0.011, { x: sx * 0.0175, bevel: 0.0015 });
  }
  for (let i = 0; i < 6; i++) { const f = 0.50 + i * 0.058; P.box('tan', 0.05, 0.066, 0.008, 0, 0.023, -f, 0, 0, 0, 0.002); }
  P.box('metal', 0.054, 0.07, 0.022, 0, 0.023, -0.868, 0, 0, 0, 0.004).pbox('dark', 0.02, 0.02, 0.002, 0, 0.023, -0.8795);
  // 枪托（拇指孔式）
  P.profile('tan', [[-0.16, 0.05], [-0.42, 0.05], [-0.44, 0.03], [-0.44, -0.088], [-0.414, -0.1], [-0.36, -0.034], [-0.16, -0.02]], 0.042, { holes: [[[-0.25, 0.022], [-0.36, 0.022], [-0.39, -0.02], [-0.3, -0.012]]], bevel: 0.005 }).box('dark', 0.044, 0.142, 0.012, 0, -0.022, 0.446, 0, 0, 0, 0.005);
  P.box('tan', 0.036, 0.016, 0.13, 0, 0.058, 0.3, 0, 0, 0, 0.005);
  // 前握把
  P.profile('poly', [[0.30, -0.014], [0.362, -0.014], [0.35, -0.086], [0.312, -0.092]], 0.03, { bevel: 0.004 });
  // 瞄准镜：镜筒 / 物镜 / 目镜 / 调节旋钮 / 镜环
  const sy = 0.108;
  P.tube('metal', V(0, sy, 0.08), V(0, sy, -0.14), 0.0205, 0.0205, 18).tube('metal', V(0, sy, -0.14), V(0, sy, -0.165), 0.0205, 0.028, 18).tube('metal', V(0, sy, -0.165), V(0, sy, -0.20), 0.028, 0.028, 18)
    .tube('metal', V(0, sy, 0.08), V(0, sy, 0.095), 0.0205, 0.0255, 18).tube('metal', V(0, sy, 0.095), V(0, sy, 0.13), 0.0255, 0.0255, 18).tube('dark', V(0, sy, 0.1301), V(0, sy, 0.1305), 0.022, 0.022, 16)
    .tube('glow', V(0, sy, -0.2002), V(0, sy, -0.2006), 0.0235, 0.0235, 16).cyl('metal', 0.012, 0.018, 0, sy + 0.027, -0.03, 'y', 12).cyl('metal', 0.012, 0.018, 0.027, sy, -0.03, 'x', 12);
  for (const f of [-0.05, 0.085]) P.box('metal', 0.05, 0.024, 0.018, 0, sy - 0.006, -f, 0, 0, 0, 0.004).box('metal', 0.026, 0.03, 0.018, 0, sy - 0.03, -f, 0, 0, 0, 0.003);
  rail(P, -0.12, 0.2, 0.066);
  // 细节
  P.cyl('metalBare', 0.0045, 0.053, 0, 0.0, 0.06, 'x', 8).cyl('metalBare', 0.0045, 0.053, 0, 0.0, -0.1, 'x', 8).box('metal', 0.004, 0.03, 0.07, 0.0275, 0.02, -0.02, 0, 0, 0, 0.001).tube('dark', V(0.02, -0.03, -0.1), V(0.03, -0.01, -0.27), 0.004, 0.004, 6);
  const group = P.build(mats);
  const coils = []; const cg = new RoundedBoxGeometry(0.024, 0.02, 0.022, 1, 0.004);
  for (let i = 0; i < 6; i++) { const c = new THREE.Mesh(cg, mats.coil.clone()); c.position.set(0, 0.023, -0.529 - i * 0.058); c.frustumCulled = false; group.add(c); coils.push(c); }
  const mag = new Parts().box('poly', 0.036, 0.066, 0.1, 0, -0.058, -0.02, 0, 0, 0, 0.006).box('glow', 0.0375, 0.008, 0.066, 0, -0.07, -0.02, 0, 0, 0, 0.002).box('metal', 0.03, 0.012, 0.08, 0, -0.094, -0.02, 0, 0, 0, 0.003).build(mats); group.add(mag);
  const dec = decalMesh(markings('RG-1', 'RAIL  1.2 MJ  KHAMSIN ARMS'), 0.085, 0.021); dec.position.set(-0.0262, 0.03, 0.03); dec.rotation.y = -Math.PI / 2; group.add(dec);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.023, -0.89); group.add(muzzle);
  const eject = new THREE.Object3D(); eject.position.set(0.03, 0.03, -0.02); group.add(eject);
  return { group, mag, bolt: null, muzzle, eject, coils, gripL: V(0, -0.016, -0.331), sightY: sy };
}

// ---------------- 手臂与手套 ----------------
// 握住一根竖直握把的拳头。sx=+1：手掌在握把右侧（右手）；sx=-1：左手。局部原点 = 握把中心，y 轴 = 握把轴。
function fist(sx) {
  const P = new Parts(); const ax = V(0, sx, 0);
  P.box('glove', 0.03, 0.09, 0.08, sx * 0.032, 0, 0.006, 0, 0, 0, 0.013);                        // 手掌 / 手背
  P.box('plate', 0.014, 0.072, 0.03, sx * 0.047, 0.004, -0.012, 0, 0, 0, 0.005).box('plate', 0.012, 0.056, 0.03, sx * 0.048, 0.0, 0.026, 0, 0, 0, 0.005);   // 手背硬壳
  for (let k = 0; k < 4; k++) { const y = 0.033 - k * 0.022, r = k === 3 ? 0.0088 : 0.0098; P.finger('glove', V(sx * (0.018 + r), y, 0.0), V(0, 0, -1), ax, [0.03, 0.05, 0.024], [0, 1.45, 1.5], r); P.box('plate', 0.012, 0.016, 0.02, sx * 0.03, y, -0.036, 0, 0, 0, 0.004); }
  P.finger('glove', V(sx * 0.02, 0.044, 0.032), V(-sx, 0.1, 0.25).normalize(), V(0, -sx, 0), [0.038, 0.03], [0, 1.25], 0.0108);   // 拇指绕到对侧
  P.tube('glove', V(sx * 0.03, -0.02, 0.04), V(sx * 0.034, -0.035, 0.085), 0.031, 0.033, 14);    // 手腕
  P.tube('dark', V(sx * 0.034, -0.035, 0.083), V(sx * 0.035, -0.038, 0.097), 0.036, 0.036, 14);   // 袖口束带
  return P;
}
export function buildArms(mats) {
  // 右手：握在握把上（握把向后倾约 14.5°）
  const R = new Parts();
  R.add(fist(1), new THREE.Matrix4().compose(V(0, -0.098, 0.082), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.253, 0, 0)), V(1, 1, 1)));
  const rw = V(0.036, -0.112, 0.182), re = V(0.215, -0.335, 0.52);
  R.tube('sleeve', rw, re, 0.036, 0.05, 16, [2, 3]).limb('plate', V(0.068, -0.15, 0.2), V(0.15, -0.238, 0.36), 0.05, 0.02).box('dark', 0.052, 0.004, 0.012, 0.085, -0.158, 0.232, 0.5, 0.4, 0.3, 0.001).box('dark', 0.052, 0.004, 0.012, 0.132, -0.208, 0.325, 0.5, 0.4, 0.3, 0.001);
  const armR = R.build(mats);
  // 左手：握在前握把上（局部原点 = 握把顶部中心）
  const L = new Parts();
  L.add(fist(-1), new THREE.Matrix4().makeTranslation(0, -0.04, 0));
  const lw = V(-0.036, -0.078, 0.092), le = V(-0.30, -0.30, 0.56);
  L.tube('sleeve', lw, le, 0.036, 0.05, 16, [2, 3.4]).limb('plate', V(-0.075, -0.098, 0.135), V(-0.2, -0.205, 0.36), 0.052, 0.02)
    .box('metal', 0.05, 0.03, 0.085, -0.118, -0.118, 0.215, 0.45, -0.42, -0.5, 0.008).box('glow', 0.03, 0.005, 0.045, -0.128, -0.103, 0.228, 0.45, -0.42, -0.5, 0.002).tube('dark', V(-0.1, -0.1, 0.165), V(-0.075, -0.085, 0.13), 0.006, 0.006, 6);
  const armL = L.build(mats);
  return { armR, armL };
}
