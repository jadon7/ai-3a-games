// 车辆模型：加载 GLB、按清单修正物理尺寸、每帧把物理状态同步到模型
import * as THREE from 'three/webgpu';
import { uv, vec2, vec3, vec4, float, smoothstep, length, mrt } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CAR_SPECS } from './physics.js';
import { extractSteering, Arms, loadArms, armsReady, loadSteeringWheel, HAND_FOLLOW } from './cockpit.js';

// 车辆按需加载：开局只加载菜单展示用的几台，选到别的车 / 对手时再加载（13 台全部加载约 110 MB）
export async function loadCars(ids, onProgress) {
  const info = await (await fetch('assets/cars/cars.json')).json();
  const loader = new GLTFLoader(), assets = {}, pending = {};
  const loadOne = (id) => pending[id] || (pending[id] = (async () => {
    const meta = info[id], gltf = await loader.loadAsync('assets/cars/' + meta.file);
    const root = gltf.scene;
    root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
    // 物理尺寸跟模型对齐
    const sp = CAR_SPECS[id], ratio = sp.cgFront / sp.wheelbase;
    sp.wheelbase = meta.wheelbase; sp.cgFront = meta.wheelbase * ratio; sp.trackF = meta.trackFront; sp.trackR = meta.trackRear;
    sp.wheelR = meta.wheelRadiusRear; sp.wheelRF = meta.wheelRadiusFront; sp.length = meta.length; sp.width = meta.width;
    sp.frontOverhang = meta.frontAxleToNose; sp.rearOverhang = meta.rearAxleToTail; sp.height = meta.height;
    let steer = null;
    try { steer = extractSteering(root, new THREE.Vector3(...(EYES[id] || [0.33, meta.height - 0.3, -0.15])), STEER_FIX[id] || null); } catch (e) { console.warn('steering', id, e); }
    assets[id] = { id, meta, root, steer };
    onProgress && onProgress(id);
    return assets[id];
  })());
  // 不可枚举：遍历 assets 时只看到已加载的车
  Object.defineProperty(assets, 'load', { value: (list) => Promise.all([...new Set(list)].map(loadOne)) });
  Object.defineProperty(assets, 'has', { value: (list) => list.every(id => assets[id]) });
  loadArms();                                       // 驾驶位视角用的手臂，后台加载
  await loadSteeringWheel();                        // 原车方向盘用不了时装的方向盘（要在识别方向盘之前就绪）
  await assets.load(ids);
  return assets;
}

// 把涂装贴图做色相旋转，得到不同配色的对手车
function hueShiftTexture(tex, deg, satMul = 1) {
  const img = tex.image, cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
  const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
  const id = g.getImageData(0, 0, cv.width, cv.height), d = id.data, a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  // YIQ 空间旋转色相
  const m = [0.299 + 0.701 * c + 0.168 * s, 0.587 - 0.587 * c + 0.330 * s, 0.114 - 0.114 * c - 0.497 * s, 0.299 - 0.299 * c - 0.328 * s, 0.587 + 0.413 * c + 0.035 * s, 0.114 - 0.114 * c + 0.292 * s, 0.299 - 0.3 * c + 1.25 * s, 0.587 - 0.588 * c - 1.05 * s, 0.114 + 0.886 * c - 0.203 * s];
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], gg = d[i + 1], b = d[i + 2];
    let nr = m[0] * r + m[1] * gg + m[2] * b, ng = m[3] * r + m[4] * gg + m[5] * b, nb = m[6] * r + m[7] * gg + m[8] * b;
    if (satMul !== 1) { const l = 0.299 * nr + 0.587 * ng + 0.114 * nb; nr = l + (nr - l) * satMul; ng = l + (ng - l) * satMul; nb = l + (nb - l) * satMul; }
    d[i] = nr; d[i + 1] = ng; d[i + 2] = nb;
  }
  g.putImageData(id, 0, 0);
  const t = new THREE.CanvasTexture(cv); t.flipY = tex.flipY; t.colorSpace = tex.colorSpace; t.wrapS = tex.wrapS; t.wrapT = tex.wrapT; t.anisotropy = 8; t.channel = tex.channel;
  return t;
}

// 车灯位置（模型坐标：+Z 车头、+X 左、Y 向上，单位米；x 取正值，左右对称各放一个）
// z 为 null 时按车头 / 车尾位置自动推算
const LAMPS = {
  e30: { head: [[0.565, 0.595, 1.955, 1], [0.375, 0.595, 1.955, 0.55]], tail: [[0.60, 0.64, -2.215, 1]], headSize: 0.34, tailSize: 0.30 },
  capri: { head: [[0.60, 0.365, 2.06, 1]], tail: [[0.59, 0.535, -2.115, 1]], headSize: 0.36, tailSize: 0.30 },
  stratos: { head: [[0.50, 0.40, null, 1]], tail: [[0.60, 0.615, null, 1]], headSize: 0.32, tailSize: 0.28 },
  escort: { head: [[0.56, 0.62, 1.95, 1], [0.37, 0.62, 1.95, 0.6]], tail: [[0.66, 0.84, -2.07, 1]], headSize: 0.32, tailSize: 0.28 },
  p917: { head: [[0.79, 0.46, 1.60, 1], [0.67, 0.34, 1.82, 0.6]], tail: [[0.72, 0.60, null, 1]], headSize: 0.32, tailSize: 0.26 },
  l037: { head: [[0.58, 0.50, 1.99, 1], [0.39, 0.50, 1.99, 0.7]], tail: [[0.62, 0.62, null, 1]], headSize: 0.30, tailSize: 0.28 },
  delta: { head: [[0.62, 0.62, null, 1], [0.44, 0.62, null, 0.7]], tail: [[0.62, 0.70, -1.80, 1]], headSize: 0.30, tailSize: 0.28 },
  gt40: { head: [[0.58, 0.60, 1.80, 1]], tail: [[0.60, 0.70, null, 1]], headSize: 0.32, tailSize: 0.28 },
  mustang: { head: [[0.64, 0.66, 2.24, 1]], tail: [[0.47, 0.66, -2.40, 1]], headSize: 0.34, tailSize: 0.30 },
  countach: { head: [[0.56, 0.58, 1.98, 1]], tail: [[0.64, 0.64, null, 1]], headSize: 0.30, tailSize: 0.28 },
  z280: { head: [[0.62, 0.60, 1.80, 1]], tail: [[0.52, 0.64, -2.09, 1]], headSize: 0.32, tailSize: 0.30 },
  s15: { head: [[0.62, 0.62, 2.05, 1]], tail: [[0.60, 0.75, -2.16, 1]], headSize: 0.30, tailSize: 0.28 },
  m190: { head: [[0.55, 0.575, null, 1]], tail: [[0.50, 0.72, null, 1]], headSize: 0.32, tailSize: 0.30 },
};
// 驾驶位视角的眼睛位置（模型坐标：+Z 车头、+X 左、Y 向上；x 为正 = 左舵）。按方向盘 / 头盔 / 仪表的位置估，再对着截图调
const EYES = {
  e30: [0.31, 1.03, -0.22], capri: [0.335, 0.94, -0.2], stratos: [0.33, 0.95, 0.0],
  escort: [0.36, 1.04, -0.2], p917: [-0.25, 0.9, 0.2], l037: [0.32, 0.96, -0.25],
  delta: [0.35, 1.08, -0.08], gt40: [-0.33, 0.9, 0.0], mustang: [0.38, 1.04, -0.32],
  countach: [0.33, 0.84, 0.05], z280: [0.33, 1.02, -0.3], s15: [-0.36, 1.00, -0.15], m190: [0.33, 1.07, -0.12],
};
// 自动识别不出方向盘的车：离线用"细圆环里的顶点数"搜出来的轮缘（车身坐标中心、半径、转向柱仰角）
const STEER_FIX = {
  stratos: { c: [0.33, 0.66, 0.31], r: 0.17, el: 25 },
  mustang: { c: [0.33, 0.81, 0.055], r: 0.14, el: 12 },
  p917: { replace: true, c: [-0.25, 0.69, 0.62], r: 0.165, el: 22 },   // 原模型的方向盘零件是坏的（缩成 2 cm 堆在原点）：装真实方向盘
  z280: { replace: true, c: [0.33, 0.80, 0.12], r: 0.17, el: 22 },     // 原模型没有方向盘
};
export const DRIVER_RE = /helm|visor|suit|driver|pilot/i;      // 车里坐着的车手：驾驶位视角时藏起来（镜头就在他头里）

let poolMat = null;
function getPoolMat() {      // 近光灯打在路面上的光斑：两团椭圆的加色渐变
  if (poolMat) return poolMat;
  const m = new THREE.MeshBasicNodeMaterial(); m.transparent = true; m.depthWrite = false; m.blending = THREE.AdditiveBlending; m.fog = false;
  const u = uv(), along = u.y, side = u.x.sub(0.5).mul(2);
  const blob = (cx) => { const dx = side.sub(cx).div(float(0.34).add(along.mul(0.5))); return float(1).sub(smoothstep(0.0, 1.0, dx.mul(dx))); };
  const f = blob(0.34).add(blob(-0.34)).mul(smoothstep(0.0, 0.10, along)).mul(float(1).sub(smoothstep(0.12, 1.0, along)).pow(1.6));
  m.colorNode = vec3(1.0, 0.86, 0.64).mul(f).mul(0.34); m.opacityNode = float(1);
  m.mrtNode = mrt({ velocity: vec4(0, 0, 0, 0) });
  m.polygonOffset = true; m.polygonOffsetFactor = -5; m.polygonOffsetUnits = -5;
  return poolMat = m;
}

let carEnvNode = null;
export function setCarEnvNode(n) { carEnvNode = n; }      // 反射探针的环境节点（见 probe.js）

const _v = new THREE.Vector3(), _qz = new THREE.Quaternion(), _zAxis = new THREE.Vector3(0, 0, 1);
let blobMat = null;
function getBlobMat() {
  if (blobMat) return blobMat;
  const m = new THREE.MeshBasicNodeMaterial(); m.transparent = true; m.depthWrite = false;
  const p = uv().sub(0.5).mul(2), q = p.mul(p), d4 = q.x.mul(q.x).add(q.y.mul(q.y)).pow(0.25);
  const a = float(1).sub(smoothstep(0.3, 1.0, d4));
  m.colorNode = vec3(0, 0, 0); m.opacityNode = a.mul(0.62);
  m.polygonOffset = true; m.polygonOffsetFactor = -3; m.polygonOffsetUnits = -3;
  return blobMat = m;
}

export class CarView {
  constructor(asset, car, opts = {}) {
    this.car = car; this.asset = asset;
    const meta = asset.meta;
    this.root = new THREE.Group();
    const model = asset.root.clone(true);
    this.root.add(model);
    this.body = model.getObjectByName('body');
    this.wheels = ['FL', 'FR', 'RL', 'RR'].map(n => { const w = model.getObjectByName('wheel_' + n); return { node: w, spin: w.getObjectByName(`wheel_${n}_spin`) || null, baseY: w.position.y, x0: 0 }; });
    for (const w of this.wheels) {
      if (!w.spin) { w.node.rotation.order = 'YXZ'; continue; }
      // 自转节点可能带外倾角：换成 ZYX 顺序后 x 是最内层，改 x 就是绕车轮自己的轴转
      const e = new THREE.Euler().setFromQuaternion(w.spin.quaternion, 'ZYX'); w.spin.rotation.copy(e); w.x0 = e.x;
    }
    // 每台车独立的材质：涂装改色、刹车灯
    this.brakeMats = [];
    const cache = new Map();
    const hue = opts.hue || 0;
    model.traverse(o => {
      if (!o.isMesh) return;
      const fix = (mat) => {
        if (cache.has(mat)) return cache.get(mat);
        let m = mat;
        if (hue && meta.bodyPaintMaterials.includes(mat.name) && mat.map && mat.map.image) { m = mat.clone(); m.map = hueShiftTexture(mat.map, hue, opts.sat ?? 1); }
        if ((meta.brakelightMaterials || []).includes(mat.name)) { m = mat.clone(); m.userData.onI = Math.min(6, mat.emissiveIntensity || 3); this.brakeMats.push(m); }
        if (meta.bodyPaintMaterials.includes(mat.name) && !m.isMeshPhysicalMaterial) {     // 没有清漆的车漆补一层
          const p = new THREE.MeshPhysicalMaterial(); THREE.MeshStandardMaterial.prototype.copy.call(p, m); p.clearcoat = 1; p.clearcoatRoughness = 0.07; p.metalness = Math.min(p.metalness, 0.12); m = p;     // 白色车漆不是金属：否则在树荫里只会照出一身暗灰
        }
        if (carEnvNode && (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial)) m.envNode = carEnvNode;
        cache.set(mat, m); return m;
      };
      o.material = Array.isArray(o.material) ? o.material.map(fix) : fix(o.material);
    });
    // 刹车灯网格是叠在尾灯上的"点亮版"，不刹车时隐藏（影片里也是这么处理的）
    this.brakeNodes = (meta.brakelightNodes || []).map(n => model.getObjectByName(n)).filter(Boolean);
    // 车底的环境遮蔽"影子"
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(meta.width * 1.28, meta.length * 1.14), getBlobMat());
    blob.rotation.x = -Math.PI / 2; blob.position.y = 0.012; blob.renderOrder = 3; blob.layers.set(1);
    this.root.add(blob); this.blob = blob;
    this.meshes = []; model.traverse(o => { if (o.isMesh) this.meshes.push(o); }); this.casting = true;
    this.driverMeshes = this.meshes.filter(o => (Array.isArray(o.material) ? o.material : [o.material]).some(m => DRIVER_RE.test(m.name || '')));
    this.eye = new THREE.Vector3(...(EYES[asset.id] || [0.33, (meta.height || 1.3) - 0.3, -0.15])); this.cockpit = false;
    // 方向盘：转动节点和它没转时的姿态（克隆后 userData 里的向量会变成普通对象，这里重新算）
    this.steerPivot = model.getObjectByName('steer_pivot') || null; this.arms = null; this.steerRot = 0;
    if (this.steerPivot) {
      const pv = this.steerPivot, q0 = pv.quaternion.clone();
      this.steerQ0 = q0;
      this.steerInfo = { radius: pv.userData.radius || 0.18, center: pv.position.clone(), axis: new THREE.Vector3(0, 0, 1).applyQuaternion(q0), base: new THREE.Matrix4().compose(pv.position, q0, new THREE.Vector3(1, 1, 1)), found: !!pv.userData.found };
    }
    this.cgOffset = car.a - car.spec.wheelbase / 2;      // 模型原点在轴距中点，物理位置在重心
    this.braking = 0;
    // 车灯：光晕贴片的位置表 + 路面上的近光光斑
    const L = LAMPS[asset.id] || LAMPS.e30, nose = meta.wheelbase / 2 + meta.frontAxleToNose, tail = -(meta.wheelbase / 2 + meta.rearAxleToTail);
    this.lamps = [];
    for (const [x, y, z, k] of L.head) for (const sx of [1, -1]) this.lamps.push({ p: new THREE.Vector3(sx * x, y, z ?? nose - 0.06), head: true, k, size: L.headSize });
    for (const [x, y, z, k] of L.tail) for (const sx of [1, -1]) this.lamps.push({ p: new THREE.Vector3(sx * x, y, z ?? tail - 0.02), head: false, k, size: L.tailSize });
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 13), getPoolMat());
    pool.rotation.x = -Math.PI / 2; pool.rotation.z = Math.PI; pool.position.set(0, 0.03, nose + 6.2); pool.renderOrder = 5; pool.layers.set(1);   // 贴图 v 方向从车头指向前方
    this.root.add(pool); this.pool = pool;
  }
  // 把这台车的车灯光晕写进特效批次（cam：镜头位置，用来按朝向淡出、远处保持最小尺寸）
  writeLamps(fx, cam) {
    if (this.cockpit) return;                                                  // 坐在车里看不到自己的车灯光晕
    const m = this.root.matrixWorld.elements, fwx = m[8], fwz = m[10];        // 模型 +Z（车头方向）在世界里的朝向
    for (const l of this.lamps) {
      const p = _v.copy(l.p).applyMatrix4(this.root.matrixWorld);
      const dx = cam.x - p.x, dy = cam.y - p.y, dz = cam.z - p.z, d = Math.hypot(dx, dy, dz) || 1;
      let face = (dx * fwx + dz * fwz) / d; if (!l.head) face = -face;          // 只有从灯的正面方向才看得到
      if (face <= 0.2) continue;
      const t = Math.min(1, (face - 0.2) / 0.45), vis = t * t * (3 - 2 * t), size = Math.max(l.size, d * 0.0055);      // 侧面看不到光晕
      if (l.head) { const I = 9 * l.k * vis; fx.addLamp(p.x, p.y, p.z, size * 1.2, I, I * 0.87, I * 0.66); }
      else { const I = (0.5 + 8 * this.braking) * l.k * vis; fx.addLamp(p.x, p.y, p.z, size * (1 + 0.5 * this.braking), I, I * 0.05, I * 0.018); }
    }
  }
  setCockpit(on) {
    if (on === this.cockpit) return; this.cockpit = on; for (const m of this.driverMeshes) m.visible = !on; this.pool.visible = !on;
    if (on && !this.arms && this.steerInfo && armsReady()) this.arms = new Arms(this);
    if (this.arms) this.arms.root.visible = on;
  }
  setCastShadow(on) { if (on === this.casting) return; this.casting = on; for (const m of this.meshes) m.castShadow = on; }
  update(dt) {
    const c = this.car, cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
    this.root.position.set(c.x + cy * this.cgOffset, 0, -(c.y + sy * this.cgOffset));
    this.root.rotation.y = c.yaw + Math.PI / 2;
    // 路肩/草地上的抖动
    let bump = 0; for (const w of c.wheels) bump += w.surf === 0 ? 0 : (w.surf === 1 ? 0.010 : 0.022);
    const jit = bump * Math.min(1, c.speed / 12);
    this.body.rotation.z = -c.roll + (Math.random() - 0.5) * jit * 0.5; this.body.rotation.x = c.pitch + (Math.random() - 0.5) * jit * 0.35;
    this.body.position.y = (Math.random() - 0.5) * jit * 0.6;
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i], pw = c.wheels[i];
      if (w.spin) { w.spin.rotation.x = w.x0 + pw.angle % (Math.PI * 2); if (i < 2) w.node.rotation.y = c.steer; }
      else { w.node.rotation.x = pw.angle % (Math.PI * 2); if (i < 2) w.node.rotation.y = c.steer; }
    }
    // 方向盘：没漂起来（侧滑角 < 6°）时只跟玩家的输入走，不显示稳定辅助的细小修正（高速时那些修正会让方向盘来回甩）；
    // 侧滑角超过 11° 才完整显示真实前轮转角（漂移反打）。最大只转到手能跟住的 ±34°（HAND_FOLLOW），中间段放大、接近打满时收住，
    // 高速时前轮只转几度也看得出方向盘在动（7.5° → 约 17°）；再做 45 ms 的平滑
    if (this.steerPivot) {
      const wReal = THREE.MathUtils.smoothstep(Math.abs(c.beta), 0.1, 0.2), sv = (c.steerCmd ?? c.steer) * (1 - wReal) + c.steer * wReal;
      const want = HAND_FOLLOW * Math.tanh(4 * sv) / Math.tanh(4 * c.steerMax);
      this.steerRot += (THREE.MathUtils.clamp(want, -HAND_FOLLOW, HAND_FOLLOW) - this.steerRot) * (1 - Math.exp(-dt / 0.045));
      this.steerPivot.quaternion.copy(this.steerQ0).multiply(_qz.setFromAxisAngle(_zAxis, this.steerRot));
      if (this.cockpit && !this.arms && this.steerInfo && armsReady()) { this.arms = new Arms(this); this.arms.root.visible = true; }
      if (this.arms && this.cockpit) this.arms.update(this.steerRot);
    }
    const brk = c.brake > 0.05 && !c.reverse ? 1 : 0; this.braking += (brk - this.braking) * Math.min(1, dt * 20);
    for (const m of this.brakeMats) m.emissiveIntensity = m.userData.onI * (0.4 + 0.6 * this.braking);
    const on = this.braking > 0.3; for (const n of this.brakeNodes) n.visible = on;
  }
}
