// 硬表面枪模载入：tools/blender/build_weapons.py 用 Blender 无界面建模导出的 GLB（assets/models/*.glb）。
// 载入失败（例如 file:// 直接打开）时返回 null，由 weapons.js 退回 gunmodels.js 里的程序化枪模。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { fetchBin, isGLB } from '../core/pack.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const MODELS = {};
export async function loadGunModels(base = 'assets/models/') {
  const loader = new GLTFLoader(); let n = 0;
  await Promise.all(['rifle', 'shotgun', 'rail', 'arms'].map(async (k) => { try { MODELS[k] = (await loader.parseAsync(await fetchBin(base + k + '.glb', isGLB), base)).scene; n++; } catch (e) { MODELS[k] = null; } }));
  return n;
}
export const hasGunModel = (k) => !!MODELS[k];

// 只保留 position/normal；按法线主轴做立方体投影 UV（统一纹素密度）；顶点色 → aGun（x = AO，y = 棱边凸度×磨损权重，z = 缝隙凹度，w = 1 - 染色权重）
function prep(src) {
  const g = src.clone(); const pos = g.attributes.position, nrm = g.attributes.normal, col = g.attributes.color, n = pos.count;
  const uv = new Float32Array(n * 2), ag = new Float32Array(n * 4), nf = new Float32Array(n * 3); const K = 11; const hasA = col && col.itemSize >= 4;
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i); const nx = nrm.getX(i), ny = nrm.getY(i), nz = nrm.getZ(i), nl = Math.hypot(nx, ny, nz) || 1; nf[i * 3] = nx / nl; nf[i * 3 + 1] = ny / nl; nf[i * 3 + 2] = nz / nl;
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    if (ax >= ay && ax >= az) { uv[i * 2] = z * K; uv[i * 2 + 1] = y * K; } else if (ay >= az) { uv[i * 2] = z * K; uv[i * 2 + 1] = x * K; } else { uv[i * 2] = x * K; uv[i * 2 + 1] = y * K; }
    ag[i * 4] = col ? col.getX(i) : 1; ag[i * 4 + 1] = col ? col.getY(i) : 0; ag[i * 4 + 2] = col ? col.getZ(i) : 0; ag[i * 4 + 3] = hasA ? col.getW(i) : 1;
  }
  for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
  g.setAttribute('normal', new THREE.BufferAttribute(nf, 3));   // GLB 里的法线是量化过的 int16（带步长的交错缓冲），这里还原成普通 float 属性，后面才能合并
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setAttribute('aGun', new THREE.BufferAttribute(ag, 4));
  return g;
}

// 把一个命名节点下的全部零件按材质合并成少量 Mesh
function bake(node, mats) {
  const grp = new THREE.Group(); grp.name = node.name; const by = new Map();
  node.updateWorldMatrix(true, true); const inv = new THREE.Matrix4().copy(node.matrixWorld).invert(), m = new THREE.Matrix4();
  node.traverse((o) => { if (!o.isMesh) return; const g = prep(o.geometry); g.applyMatrix4(m.multiplyMatrices(inv, o.matrixWorld)); const k = (o.material.name || 'metal').replace(/\.\d+$/, ''); if (!by.has(k)) by.set(k, []); by.get(k).push(g); });
  for (const [k, list] of by) { const mesh = new THREE.Mesh(mergeGeometries(list), mats[k] || mats.metal); mesh.name = k; mesh.frustumCulled = false; mesh.receiveShadow = true; grp.add(mesh); }
  grp.position.copy(node.position);
  return grp;
}

export function gunFromModel(key, mats) {
  const sc = MODELS[key]; if (!sc) return null;
  const group = new THREE.Group(); const out = { group, mag: null, bolt: null }; const coils = [];
  const at = (name, d) => { const o = sc.getObjectByName(name); return o ? o.position.clone() : d; };
  for (const node of sc.children) {
    if (node.name === 'body') group.add(bake(node, mats));
    else if (node.name === 'mag') { out.mag = bake(node, mats); group.add(out.mag); }
    else if (node.name === 'bolt' || node.name === 'pump') { out.bolt = bake(node, mats); group.add(out.bolt); }
    else if (/^coil\d+$/.test(node.name)) { const c = bake(node, { ...mats, coil: mats.coil.clone() }); group.add(c); coils.push([+node.name.slice(4), c.children.find((ch) => ch.name === 'coil') || c.children[0]]); }
  }
  if (coils.length) out.coils = coils.sort((a, b) => a[0] - b[0]).map((c) => c[1]);
  out.muzzle = new THREE.Object3D(); out.muzzle.position.copy(at('muzzle', new THREE.Vector3(0, 0.026, -0.7))); group.add(out.muzzle);
  out.eject = new THREE.Object3D(); out.eject.position.copy(at('eject', new THREE.Vector3(0.03, 0.03, -0.03))); group.add(out.eject);
  out.gripL = at('gripL', new THREE.Vector3(0, 0, -0.331)); out.sightY = at('sight', new THREE.Vector3(0, 0.1, 0)).y;
  return out;
}

export function armsFromModel(mats) {
  const sc = MODELS.arms; if (!sc) return null;
  const r = sc.getObjectByName('armR'), l = sc.getObjectByName('armL'); if (!r || !l) return null;
  const g = sc.getObjectByName('grapple'), d = sc.getObjectByName('grDisp');
  return { armR: bake(r, mats), armL: bake(l, mats), grapple: g ? g.position.clone() : null, disp: d ? { pos: d.position.clone(), quat: d.quaternion.clone() } : null };
}

// 枪材质补丁：顶点 AO 压暗缝隙；烘焙的棱边凸度（辅以屏幕空间曲率）做磨损露底（金属露亮钢，聚合物发白）；缝隙里积沙尘
const NOISE = /* glsl */`
float gHash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float gNoise( vec2 p ) { vec2 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( gHash( i ), gHash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( gHash( i + vec2( 0.0, 1.0 ) ), gHash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y ); }`;
function patch(src, key, o) {
  const m = src.clone(); const ec = new THREE.Color(o.color);
  if (m.normalScale && o.nrm !== undefined) m.normalScale.set(o.nrm, o.nrm);
  m.customProgramCacheKey = () => 'gun|' + key;
  const GU = m.userData.gunU = { uEdge: { value: new THREE.Vector4(ec.r, ec.g, ec.b, o.amount) }, uEdgeMR: { value: new THREE.Vector2(o.metal, o.rough) }, uFlat: { value: new THREE.Vector2(o.flat || 0, o.avg || 0.5) }, uDust: { value: o.dust === undefined ? 0.5 : o.dust }, uWearT: { value: new THREE.Vector2(0.55, 1.0) }, uTint: { value: new THREE.Vector4(...new THREE.Color(o.tint === undefined ? 0xffffff : o.tint).toArray(), o.tintRough === undefined ? -1 : o.tintRough) } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, GU);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aGun; varying vec4 vGun;').replace('#include <begin_vertex>', '#include <begin_vertex>\n  vGun = aGun;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vGun; uniform vec4 uEdge; uniform vec2 uEdgeMR; uniform vec2 uFlat; uniform float uDust; uniform vec2 uWearT; uniform vec4 uTint; float gEdge; float gDust; float gTint;' + NOISE)
      .replace('#include <map_fragment>', /* glsl */`#include <map_fragment>
#ifdef USE_MAP
  diffuseColor.rgb = mix( diffuseColor.rgb, diffuse * uFlat.y, uFlat.x );   // 压低平铺贴图的对比，避免大平面上出现织物状纹路
#endif
  gTint = smoothstep( 0.35, 0.65, 1.0 - vGun.w ); diffuseColor.rgb = mix( diffuseColor.rgb, uTint.rgb * ( 0.75 + 0.5 * dot( diffuseColor.rgb, vec3( 0.333 ) ) / max( 0.05, dot( diffuse, vec3( 0.333 ) ) ) ), gTint );   // 手套掌面：换成深色合成革
  { vec3 gN = normalize( vNormal ); vec3 gP = - vViewPosition;
    vec3 gPx = dFdx( gP ), gPy = dFdy( gP );
    float gC = ( dot( dFdx( gN ), gPx ) + dot( dFdy( gN ), gPy ) ) / ( dot( gPx, gPx ) + dot( gPy, gPy ) + 1e-12 );
    float gW = 0.35 + 0.65 * smoothstep( 0.30, 0.75, gNoise( vMapUv * 34.0 ) * 0.6 + gNoise( vMapUv * 9.0 ) * 0.4 );
    float gGeo = smoothstep( uWearT.x, uWearT.y, vGun.y * ( 0.35 + 1.0 * gW ) );                 // 烘焙的几何凸度 × 噪声打散：只有棱线上、噪声高的地方才磨穿
    gEdge = clamp( gGeo + 0.25 * smoothstep( 1800.0, 3600.0, gC ) * gW, 0.0, 1.0 ) * uEdge.a;
    diffuseColor.rgb = mix( diffuseColor.rgb, uEdge.rgb, gEdge );
    // 缝隙与凹角里积着沙尘：发黄、更粗糙、不反光
    gDust = smoothstep( 0.10, 0.55, vGun.z * 1.4 + ( 1.0 - vGun.x ) * 0.55 - 0.25 + 0.35 * gNoise( vMapUv * 5.0 ) ) * uDust;
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.30, 0.25, 0.18 ), gDust * 0.6 );
    diffuseColor.rgb *= ( 0.70 + 0.30 * vGun.x ) * mix( 0.3, 1.0, smoothstep( 0.012, 0.045, length( vViewPosition ) ) ); }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  if ( uTint.a >= 0.0 ) roughnessFactor = mix( roughnessFactor, uTint.a, gTint );\n  roughnessFactor = mix( mix( roughnessFactor, uEdgeMR.y, gEdge ), 0.92, gDust * 0.75 );')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  metalnessFactor = mix( mix( metalnessFactor, uEdgeMR.x, gEdge ), 0.0, gDust * 0.75 );')
      .replace('#include <aomap_fragment>', /* glsl */`#include <aomap_fragment>
  { float gAO = vGun.x; reflectedLight.indirectDiffuse *= gAO; reflectedLight.indirectSpecular *= gAO * gAO;
    reflectedLight.directDiffuse *= 0.6 + 0.4 * gAO; reflectedLight.directSpecular *= 0.35 + 0.65 * gAO;
    float gNear = mix( 0.15, 1.0, smoothstep( 0.012, 0.045, length( vViewPosition ) ) ); reflectedLight.indirectSpecular *= gNear; reflectedLight.directSpecular *= gNear; }`);
  };
  return m;
}
const EDGE = {
  metal: { color: 0xb4b7be, amount: 0.85, metal: 1.0, rough: 0.24, flat: 0.6, avg: 0.55, nrm: 0.4, dust: 0.7 }, metalBare: { color: 0xd2d4d9, amount: 0.5, metal: 1.0, rough: 0.2, flat: 0.5, avg: 0.55, nrm: 0.45, dust: 0.45 },
  tanMetal: { color: 0xa9abb0, amount: 0.75, metal: 1.0, rough: 0.26, flat: 0.6, avg: 0.55, nrm: 0.4, dust: 0.55 },
  tan: { color: 0xc9b188, amount: 0.5, metal: 0.0, rough: 0.45, flat: 0.35, avg: 0.86, dust: 0.45 }, poly: { color: 0x55565a, amount: 0.55, metal: 0.0, rough: 0.38, flat: 0.3, avg: 0.27, dust: 0.65 },
  plate: { color: 0xb7a37c, amount: 0.5, metal: 0.0, rough: 0.45, dust: 0.4 }, rubber: { color: 0x3a3a3d, amount: 0.3, metal: 0.0, rough: 0.6, dust: 0.6 },
  glove: { color: 0x000000, amount: 0.0, metal: 0.0, rough: 0.8, dust: 0.3 }, gloveFab: { color: 0x000000, amount: 0.0, metal: 0.0, rough: 0.9, dust: 0.22, tint: 0x1b1a19, tintRough: 0.62, nrm: 1.4 }, sleeve: { color: 0x000000, amount: 0.0, metal: 0.0, rough: 0.9, dust: 0.0 },
};
// 返回一套给 GLB 枪模用的材质：带补丁的克隆 + 其余原样引用
export function gunMaterials(mats) {
  const out = { ...mats };
  for (const k of Object.keys(EDGE)) if (mats[k]) out[k] = patch(mats[k], k, EDGE[k]);
  return out;
}
