// 机甲模型载入：tools/blender/build_mech.py 用 Blender 无界面建模导出的 assets/models/mech.glb。
// GLB 里每个关节一个空物体节点（位于静止姿态的世界位置），零件挂在节点下；这里按节点名把零件按材质合并，
// 再装到 mech.js 原有的关节层级上（root → pelvis → 大腿 → 小腿 → 脚；pelvis → torso → 双臂）。
// 载入失败（file:// 直接打开、文件缺失、?nomech）时 mechFromModel 返回 null，mech.js 退回程序化方块模型。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { fetchBin, isGLB } from '../core/pack.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

let SC = null;
export async function loadMechModel(base = 'assets/models/') {
  try { SC = (await new GLTFLoader().parseAsync(await fetchBin(base + 'mech.glb', isGLB), base)).scene; SC.updateMatrixWorld(true); } catch (e) { SC = null; }
  return !!SC;
}
export const hasMechModel = () => !!SC;

// 只保留 position / normal；按法线主轴做立方体投影 UV（K = 每米的贴图重复数）；顶点色 → aGun（x = AO，y = 棱边凸度 × 磨损权重，z = 缝隙凹度）
function prep(src, K) {
  const g = src.clone(); const pos = g.attributes.position, nrm = g.attributes.normal, col = g.attributes.color, n = pos.count;
  const uv = new Float32Array(n * 2), ag = new Float32Array(n * 4), nf = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i); const nx = nrm.getX(i), ny = nrm.getY(i), nz = nrm.getZ(i), nl = Math.hypot(nx, ny, nz) || 1; nf[i * 3] = nx / nl; nf[i * 3 + 1] = ny / nl; nf[i * 3 + 2] = nz / nl;
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    if (ax >= ay && ax >= az) { uv[i * 2] = z * K; uv[i * 2 + 1] = y * K; } else if (ay >= az) { uv[i * 2] = z * K; uv[i * 2 + 1] = x * K; } else { uv[i * 2] = x * K; uv[i * 2 + 1] = y * K; }
    ag[i * 4] = col ? col.getX(i) : 1; ag[i * 4 + 1] = col ? col.getY(i) : 0; ag[i * 4 + 2] = col ? col.getZ(i) : 0; ag[i * 4 + 3] = 1;
  }
  for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
  g.setAttribute('normal', new THREE.BufferAttribute(nf, 3));   // GLB 里的法线是量化过的 int16，还原成普通 float 属性后才能合并
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('aGun', new THREE.BufferAttribute(ag, 4));
  return g;
}

// 把一个命名节点下的全部零件按材质合并成少量 Mesh（几何体在节点局部坐标里）
function bake(name, mats, o = {}) {
  const node = SC.getObjectByName(name); const grp = new THREE.Group(); grp.name = name; if (!node) return grp;
  const by = new Map(); const inv = new THREE.Matrix4().copy(node.matrixWorld).invert(), m = new THREE.Matrix4();
  node.traverse((c) => { if (!c.isMesh) return; const g = prep(c.geometry, o.uv || 0.42); g.applyMatrix4(m.multiplyMatrices(inv, c.matrixWorld)); const k = (c.material.name || 'sec').replace(/\.\d+$/, ''); if (!by.has(k)) by.set(k, []); by.get(k).push(g); });
  for (const [k, list] of by) {
    const mat = mats[k] || mats.sec; if (!mat) continue;
    const mesh = new THREE.Mesh(mergeGeometries(list), mat); mesh.name = k; mesh.castShadow = o.shadow !== false; mesh.receiveShadow = o.shadow !== false; if (o.noCull) mesh.frustumCulled = false; grp.add(mesh);
  }
  return grp;
}
const rest = (name) => { const n = SC.getObjectByName(name); return n ? n.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(); };

// 涂装装甲补丁：顶点 AO 压暗缝隙；烘焙的棱边凸度 × 噪声做掉漆露钢；凹处和朝上的面积沙
const NOISE = /* glsl */`
float mHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float mNoise( vec2 p ) { vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mHash( i ), mHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( mHash( i + vec2( 0.0, 1.0 ) ), mHash( i + vec2( 1.0, 0.0 ) + vec2( 0.0, 1.0 ) ), f.x ), f.y ); }`;
export function mechPatch(src, key, o) {
  const m = src.clone(); const ec = new THREE.Color(o.color);
  if (m.normalScale && o.nrm !== undefined) m.normalScale.set(o.nrm, o.nrm);
  m.customProgramCacheKey = () => 'mech|' + key;
  const U = m.userData.mechU = { uEdge: { value: new THREE.Vector4(ec.r, ec.g, ec.b, o.amount) }, uEdgeMR: { value: new THREE.Vector2(o.metal, o.rough) }, uFlat: { value: new THREE.Vector2(o.flat || 0, o.avg || 0.5) }, uDust: { value: o.dust === undefined ? 0.5 : o.dust }, uHeat: { value: new THREE.Vector3() }, uBase: { value: new THREE.Vector2(o.bm === undefined ? 0.3 : o.bm, o.br === undefined ? 0.5 : o.br) } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aGun; varying vec4 vGun; varying float vUp;').replace('#include <begin_vertex>', '#include <begin_vertex>\n  vGun = aGun; vUp = normalize( mat3( modelMatrix ) * normal ).y;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vGun; varying float vUp; uniform vec4 uEdge; uniform vec2 uEdgeMR; uniform vec2 uFlat; uniform vec2 uBase; uniform float uDust; uniform vec3 uHeat; float gEdge; float gDust;' + NOISE)
      .replace('#include <map_fragment>', /* glsl */`#include <map_fragment>
#ifdef USE_MAP
  diffuseColor.rgb = mix( diffuseColor.rgb, diffuse * uFlat.y, uFlat.x );   // 压低平铺贴图的对比，大块装甲上不出现重复花纹
  { float gW = 0.3 + 0.7 * smoothstep( 0.30, 0.75, mNoise( vMapUv * 60.0 ) * 0.55 + mNoise( vMapUv * 14.0 ) * 0.45 );
    gEdge = smoothstep( 0.5, 1.0, vGun.y * ( 0.4 + 1.0 * gW ) ) * uEdge.a;                       // 只有棱线上、噪声高的地方才磨穿露钢
    diffuseColor.rgb = mix( diffuseColor.rgb, uEdge.rgb, gEdge );
    gDust = smoothstep( 0.12, 0.6, vGun.z * 1.4 + ( 1.0 - vGun.x ) * 0.6 + max( 0.0, vUp ) * 0.22 - 0.3 + 0.4 * mNoise( vMapUv * 7.0 ) ) * uDust;
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.34, 0.28, 0.19 ), gDust * 0.6 );          // 缝隙、凹角和朝上的面积着沙尘
    diffuseColor.rgb *= 0.62 + 0.38 * vGun.x; }
#endif`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n#ifdef USE_MAP\n  roughnessFactor = mix( roughnessFactor, uBase.y, uFlat.x );\n  roughnessFactor = mix( mix( roughnessFactor, uEdgeMR.y, gEdge ), 0.92, gDust * 0.75 );\n#endif')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n#ifdef USE_MAP\n  metalnessFactor = mix( metalnessFactor, uBase.x, uFlat.x );\n  metalnessFactor = mix( mix( metalnessFactor, uEdgeMR.x, gEdge ), 0.0, gDust * 0.75 );\n#endif')
      .replace('#include <aomap_fragment>', /* glsl */`#include <aomap_fragment>
  { float gAO = vGun.x; reflectedLight.indirectDiffuse *= gAO; reflectedLight.indirectSpecular *= gAO * gAO;
    reflectedLight.directDiffuse *= 0.6 + 0.4 * gAO; reflectedLight.directSpecular *= 0.35 + 0.65 * gAO; }`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += uHeat;');   // 炮口过热发红（只有 heat 材质会用到）
  };
  return m;
}
// flat / avg：把平铺贴图压平多少、压平后的亮度；bm / br：压平后的金属度与粗糙度（涂装面偏哑光，关节钢件偏亮）
const EDGE = {
  main: { color: 0x8f9298, amount: 0.9, metal: 1.0, rough: 0.3, flat: 0.8, avg: 0.86, bm: 0.25, br: 0.52, nrm: 0.5, dust: 0.6 }, accent: { color: 0x9a9da3, amount: 0.9, metal: 1.0, rough: 0.3, flat: 0.8, avg: 0.86, bm: 0.25, br: 0.5, nrm: 0.5, dust: 0.5 },
  warn: { color: 0x85888e, amount: 0.9, metal: 1.0, rough: 0.3, flat: 0.8, avg: 0.86, bm: 0.2, br: 0.55, nrm: 0.5, dust: 0.5 }, sec: { color: 0xa2a5ab, amount: 0.8, metal: 1.0, rough: 0.28, flat: 0.75, avg: 0.86, bm: 0.45, br: 0.5, nrm: 0.5, dust: 0.7 },
  joint: { color: 0xd6d8dc, amount: 0.6, metal: 1.0, rough: 0.2, flat: 0.3, avg: 0.3, bm: 1.0, br: 0.36, nrm: 0.6, dust: 0.55 }, heat: { color: 0xd6d8dc, amount: 0.5, metal: 1.0, rough: 0.22, flat: 0.3, avg: 0.3, bm: 1.0, br: 0.36, nrm: 0.6, dust: 0.2 },
};
// 一个阵营共用的带补丁材质：M 为 mech.js 的 mats()[team]
export function mechMaterials(M) {
  const out = { ...M };
  for (const k of Object.keys(EDGE)) { const src = k === 'heat' ? M.joint : M[k]; if (src) out[k] = mechPatch(src, k, EDGE[k]); }
  return out;
}

// 每台机甲独有的动画材质：核心发射口亮度、炮口过热、传感器、排气口
export function mechOwnMaterials(M) {
  return { core: new THREE.MeshBasicMaterial({ color: 0x000000, fog: false }), eye: M.glow.clone(), vent: M.vent.clone(), heat: mechPatch(M.joint, 'heat', EDGE.heat) };
}

// 单位编号贴花（画布贴图）：友军 K-07 深色漏喷字，敌军 R-13 浅色字
const DECALS = [null, null];
function decalMat(team) {
  if (DECALS[team]) return DECALS[team];
  const c = document.createElement('canvas'); c.width = 512; c.height = 128; const g = c.getContext('2d');
  const ink = team === 0 ? 'rgba(24,22,18,0.92)' : 'rgba(232,214,170,0.92)';
  g.fillStyle = ink; g.font = '900 96px "Arial Narrow", "Helvetica Neue", Arial, sans-serif'; g.textBaseline = 'middle'; g.fillText(team === 0 ? 'K-07' : 'R-13', 96, 68);
  g.strokeStyle = ink; g.lineWidth = 9; g.beginPath(); g.moveTo(20, 104); g.lineTo(46, 24); g.lineTo(72, 104); g.closePath(); g.stroke();   // 阵营标：三角
  g.font = '700 22px Arial, sans-serif'; g.fillText(team === 0 ? 'HVY ASSAULT' : 'SCORPION', 330, 40); g.fillText(team === 0 ? 'KHAMSIN 3RD' : 'ARMORED CO.', 330, 72); g.fillRect(330, 92, 150, 6);
  g.globalCompositeOperation = 'destination-out';   // 漏喷字的断口与磨损
  for (const x of [150, 236, 318]) g.fillRect(x, 0, 5, 128);
  for (let i = 0; i < 140; i++) { g.globalAlpha = Math.random() * 0.8; g.fillRect(Math.random() * 512, Math.random() * 128, 1 + Math.random() * 5, 1 + Math.random() * 3); }
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return (DECALS[team] = new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, roughness: 0.7, metalness: 0.1 }));
}

const THIGH = 1.25, SHIN = 1.25;
// M：mechMaterials() 的结果；own：这台机甲独有的动画材质 { core, heat, eye, vent }
export function mechFromModel(M, own, team = 0) {
  if (!SC || !SC.getObjectByName('torso')) return null;
  const mats = { ...M, ...own, glow: M.glow };
  const root = new THREE.Group(); const pelvis = bake('pelvis', mats); root.add(pelvis);
  const legs = [];
  for (const [s, n] of [[-1, 'L'], [1, 'R']]) {
    const thigh = bake('thigh' + n, mats); thigh.position.set(s * 0.95, 0, 0); pelvis.add(thigh);
    const shin = bake('shin' + n, mats); shin.position.set(0, -THIGH, 0); thigh.add(shin);
    const foot = bake('foot' + n, mats); foot.position.set(0, -SHIN, 0); shin.add(foot);
    legs.push({ thigh, shin, foot, side: s });
  }
  const torso = bake('torso', mats); torso.position.set(0, 0.4, 0); pelvis.add(torso);
  const armR = bake('armR', mats); armR.position.set(1.5, 1.75, 0); torso.add(armR);
  const armL = bake('armL', mats); armL.position.set(-1.5, 1.75, 0); torso.add(armL);
  const T0 = rest('torso'), R0 = rest('armR'), L0 = rest('armL');
  const sub = (name, parent, p0) => { const g = bake(name, mats); g.position.copy(rest(name)).sub(p0); parent.add(g); return g; };
  const barrel = sub('barrel', armR, R0), foreL = sub('foreL', armL, L0), fistL = sub('fistL', foreL, rest('foreL'));
  const hatch = sub('hatch', torso, T0), head = sub('head', torso, T0), lidA = sub('lidA', torso, T0), lidB = sub('lidB', torso, T0);
  const at = (name, parent, p0) => { const o = new THREE.Object3D(); o.position.copy(rest(name)).sub(p0); parent.add(o); return o; };
  const muzzle = new THREE.Object3D(); muzzle.position.set(0.4, -1.0, -3.65); armR.add(muzzle);
  const pod = new THREE.Object3D(); pod.position.set(-1.5, 2.72, -0.6); torso.add(pod);
  const eye = new THREE.Object3D(); eye.position.set(0, 1.75, -1.36); torso.add(eye);
  const anchors = { core: at('core', torso, T0), eject: at('eject', armR, R0), jetL: at('jetL', torso, T0), jetR: at('jetR', torso, T0), exhL: at('exhL', torso, T0), exhR: at('exhR', torso, T0), fist: at('fist', fistL, rest('fistL')) };
  // 单位编号：右肩甲外侧、火箭巢外侧
  const dm = decalMat(team);
  const dA = new THREE.Mesh(new THREE.PlaneGeometry(0.82, 0.2), dm); dA.position.copy(rest('decalA')).sub(T0); dA.position.x += 0.004; dA.rotation.y = Math.PI / 2; torso.add(dA);
  const dB = new THREE.Mesh(new THREE.PlaneGeometry(0.84, 0.21), dm); dB.position.copy(rest('decalB')).sub(T0); dB.position.x -= 0.004; dB.rotation.y = -Math.PI / 2; torso.add(dB);
  return { root, pelvis, legs, torso, armR, armL, muzzle, pod, eye, barrel, foreL, fistL, hatch, head, lidA, lidB, anchors, glb: true };
}

// 第一人称座舱内饰（视图空间：原点 = 眼睛，-Z = 视线方向），由 src/ui/cockpit.js 挂到相机上
export function cockpitFromModel(mats) {
  if (!SC || !SC.getObjectByName('cockpit')) return null;
  const g = bake('cockpit', mats, { uv: 3, shadow: false, noCull: true }), c0 = rest('cockpit');
  // 操纵杆是独立节点（原点 = 底座球铰），座舱里按输入倾斜
  g.userData.sticks = ['ckStickL', 'ckStickR'].map((n) => { if (!SC.getObjectByName(n)) return null; const st = bake(n, mats, { uv: 3, shadow: false, noCull: true }); st.position.copy(rest(n)).sub(c0); g.add(st); return st; });
  return g;
}
