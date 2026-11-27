// 场景：照片扫描的房间（自带环境光 + 可被动态光照亮）、门外全景天空、全景照片投影的门外地面。
// 着色模型和影片在 Blender 里的材质一一对应。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { b2t, LENS, GROUND_Z, FLOOR_Z, HDRI_P0, MODES, QS } from './config.js';
import { LV, FH, inRect, floorOfRegion, layerZ } from './level.js';
import { Pool, POOL, punchHole } from './pool.js';

THREE.Mesh.prototype.raycast = acceleratedRaycast;

// ---------------------------------------------------------------- 共享的光照 uniform
export const L = {
  uAmb: { value: 1 }, uWin: { value: 11 }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uK: { value: 1 },
  uWLPos: { value: new THREE.Vector3() }, uWLDir: { value: new THREE.Vector3(0, 0, -1) },
  uWLE: { value: new THREE.Vector3(5400, 1980, 520) },
  uWLCos: { value: new THREE.Vector3(Math.cos(THREE.MathUtils.degToRad(4.5)), Math.cos(THREE.MathUtils.degToRad(11)), Math.cos(THREE.MathUtils.degToRad(31))) },
  uWLOn: { value: 1 },
  uFlashPos: { value: [new THREE.Vector4(0, -99, 0, 0), new THREE.Vector4(0, -99, 0, 0)] },
  uFlashCol: { value: [new THREE.Vector3(1, 0.7, 0.4), new THREE.Vector3(1, 0.7, 0.4)] },
  uFlashBand: { value: [new THREE.Vector2(-1, 2), new THREE.Vector2(-1, 2)] },
  uBlob: { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, -99, 0, 0.001)) },
  uLens: { value: new THREE.Vector3(LENS.f, LENS.sw / 2, LENS.sh / 2) },
  uPuffEmit: { value: 0.42 },
  uBang: { value: new THREE.Vector4(0, -99, 0, 0) },        // 闪光弹：位置 + 能量
  uPortal: { value: new THREE.Vector4(0, -99, 0, 0) }, uPortalCol: { value: new THREE.Vector3() },      // 池核门口漏到地下室走廊里的光：位置 + 作用距离，颜色×强度
};

export const LIGHT_GLSL = /* glsl */`
uniform vec3 uWLPos; uniform vec3 uWLDir; uniform vec3 uWLE; uniform vec3 uWLCos; uniform float uWLOn;
uniform vec4 uFlashPos[2]; uniform vec3 uFlashCol[2]; uniform vec2 uFlashBand[2];
uniform vec4 uBlob[6];
uniform vec3 uLens; uniform vec4 uBang; uniform vec4 uPortal; uniform vec3 uPortalCol;
// 池核那道门里透出来的光：只照门外走廊这一侧，离门越远越暗
vec3 portalLight(vec3 P, vec3 N){
  vec3 Lp = uPortal.xyz - P; float d2 = dot(Lp, Lp);
  if (uPortal.w <= 0.0 || d2 > uPortal.w * uPortal.w || P.z < uPortal.z + 0.25 || P.z > uPortal.z + 2.55) return vec3(0.0);
  float d = sqrt(d2); return uPortalCol * max(dot(N, Lp / d), 0.0) / (d2 + 0.35) * (1.0 - smoothstep(uPortal.w * 0.45, uPortal.w, d));
}
// 视空间位置 -> 成片画面里的行坐标（0 顶，1 底）。用来模拟卷帘快门只拍到一段火光
float outRow(vec3 vp){
  vec3 d = normalize(vp); float th = acos(clamp(-d.z, -1.0, 1.0)); float r = 2.0 * uLens.x * sin(th * 0.5);
  float l = max(length(d.xy), 1e-5); return 0.5 - (r * d.y / l) / (2.0 * uLens.z);
}
float flashBand(int i, float row){
  return smoothstep(uFlashBand[i].x - 0.012, uFlashBand[i].x + 0.012, row) * (1.0 - smoothstep(uFlashBand[i].y - 0.012, uFlashBand[i].y + 0.012, row));
}
// 动态光的辐照度（枪灯三层光锥 + 两个枪口火光点光）。乘 albedo/π 得到出射亮度
vec3 dynLight(vec3 P, vec3 N, vec3 vp){
  vec3 E = vec3(0.0);
  vec3 Lv = uWLPos - P; float d2 = max(dot(Lv, Lv), 1e-4); vec3 l = Lv * inversesqrt(d2);
  float ca = dot(-l, uWLDir);
  vec3 m = clamp((vec3(ca) - uWLCos) / (vec3(1.0) - uWLCos), 0.0, 1.0); m = m * m * (3.0 - 2.0 * m);
  E += vec3(1.0, 0.97, 0.92) * dot(uWLE, m) * uWLOn * max(dot(N, l), 0.0) / (12.566 * d2);
  float row = outRow(vp);
  for (int i = 0; i < 2; i++) {
    vec3 Lf = uFlashPos[i].xyz - P; float f2 = max(dot(Lf, Lf), 4e-4); vec3 lf = Lf * inversesqrt(f2);
    E += uFlashCol[i] * uFlashPos[i].w * max(dot(N, lf), 0.0) / (12.566 * f2) * flashBand(i, row);
  }
  if (uBang.w > 0.0) { vec3 Lb = uBang.xyz - P; float b2 = max(dot(Lb, Lb), 0.04); E += vec3(1.0, 0.97, 0.9) * uBang.w * max(dot(N, Lb * inversesqrt(b2)), 0.25) / (12.566 * b2); }
  return E;
}
// 烟尘这类没有固定朝向的东西：各向同性地受光
vec3 dynLightIso(vec3 P, vec3 vp){
  vec3 E = vec3(0.0);
  vec3 Lv = uWLPos - P; float d2 = max(dot(Lv, Lv), 1e-3); vec3 l = Lv * inversesqrt(d2);
  float ca = dot(-l, uWLDir);
  vec3 m = clamp((vec3(ca) - uWLCos) / (vec3(1.0) - uWLCos), 0.0, 1.0); m = m * m * (3.0 - 2.0 * m);
  E += vec3(1.0, 0.97, 0.92) * dot(uWLE, m) * uWLOn * 0.5 / (12.566 * d2);
  float row = outRow(vp);
  for (int i = 0; i < 2; i++) {
    vec3 Lf = uFlashPos[i].xyz - P; float f2 = max(dot(Lf, Lf), 0.02);
    E += uFlashCol[i] * uFlashPos[i].w * 0.5 / (12.566 * f2) * flashBand(i, row);
  }
  return E;
}
// 只算枪灯的各向同性受光（弹着烟尘用；影片里烟尘不受枪口火光影响，枪口烟也不受枪灯影响）
vec3 wlLightIso(vec3 P){
  vec3 Lv = uWLPos - P; float d2 = max(dot(Lv, Lv), 0.09); vec3 l = Lv * inversesqrt(d2);
  float ca = dot(-l, uWLDir);
  vec3 m = clamp((vec3(ca) - uWLCos) / (vec3(1.0) - uWLCos), 0.0, 1.0); m = m * m * (3.0 - 2.0 * m);
  return vec3(1.0, 0.97, 0.92) * dot(uWLE, m) * uWLOn * 0.5 / (12.566 * d2);
}
// 角色脚下的柔和接触阴影
float blobAO(vec3 P){
  float ao = 1.0;
  for (int i = 0; i < 6; i++) {
    vec3 d = P - uBlob[i].xyz; float h = smoothstep(0.6, 0.0, abs(d.y));
    float r = length(d.xz) / uBlob[i].w;
    ao *= 1.0 - 0.55 * h * (1.0 - smoothstep(0.25, 1.0, r));
  }
  return ao;
}
`;

const COMMON_VS = /* glsl */`
#ifdef USE_VC
attribute vec4 color; varying vec3 vCol;
#endif
varying vec2 vUv; varying vec3 vWP; varying vec3 vN; varying vec3 vVP;
void main(){
  vUv = uv;
  #ifdef USE_VC
  vCol = color.rgb * 2.0;
  #endif
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWP = wp.xyz; vN = normalize(mat3(modelMatrix) * normal);
  vec4 vp = viewMatrix * wp; vVP = vp.xyz;
  gl_Position = projectionMatrix * vp;
}`;

// albedo：扫描贴图（自带烘死的日光）。opt.win：贴图里过曝成白的地方当窗户处理；opt.vc：乘上顶点色（走廊各处相对原房间的受光）；opt.gain：整体亮度
function roomMaterial(albedo, spill, opt = {}) {
  const m = new THREE.ShaderMaterial({
    uniforms: { ...L, tAlbedo: { value: albedo }, tSpill: { value: spill }, uSpillK: { value: spill ? 1 : 0 }, uWinOn: { value: opt.win === false ? 0 : 1 }, uGainS: { value: opt.gain ?? 1 },
      uHS: { value: new THREE.Vector2(opt.hue ?? 0, opt.sat ?? 1) }, uZF: { value: new THREE.Vector4(...(opt.zf || [0, 1, 0, 1])) } },
    defines: { ...(opt.vc ? { USE_VC: 1 } : {}), ...((opt.hue || (opt.sat ?? 1) !== 1 || opt.zf) ? { USE_HS: 1 } : {}), ...(opt.zf ? { USE_ZF: 1 } : {}) },
    vertexShader: COMMON_VS,
    fragmentShader: /* glsl */`
      uniform sampler2D tAlbedo; uniform sampler2D tSpill; uniform float uAmb; uniform float uWin; uniform float uSpillK; uniform float uK; uniform vec3 uTint; uniform float uWinOn; uniform float uGainS; uniform vec2 uHS; uniform vec4 uZF;
      varying vec2 vUv; varying vec3 vWP; varying vec3 vN; varying vec3 vVP;
      #ifdef USE_VC
      varying vec3 vCol;
      #endif
      ${LIGHT_GLSL}
      void main(){
        vec3 alb = texture2D(tAlbedo, vUv).rgb;
        float sat = uHS.y;
        #ifdef USE_ZF
        // 楼梯间通往地下室的那一层：越往下越暗、越没颜色（uZF = 起止高度、顶上的环境光下限、顶上的饱和度）
        float zk = smoothstep(uZF.x, uZF.y, vWP.y);
        sat = mix(uHS.y, uZF.w, zk);
        #endif
        #ifdef USE_HS
        {   // 换一种漆色：在 YIQ 里转色相、调饱和度（别的楼层用同一套扫描，看起来是另一种颜色的房间）
          float Y = dot(alb, vec3(0.299, 0.587, 0.114)), I = dot(alb, vec3(0.596, -0.274, -0.322)), Q = dot(alb, vec3(0.211, -0.523, 0.312));
          float c = cos(uHS.x) * sat, s_ = sin(uHS.x) * sat, I2 = I * c - Q * s_, Q2 = I * s_ + Q * c;
          alb = max(vec3(Y + 0.956 * I2 + 0.621 * Q2, Y - 0.272 * I2 - 0.647 * Q2, Y - 1.106 * I2 + 1.703 * Q2), 0.0);
        }
        #endif
        float lum = dot(alb, vec3(0.2126, 0.7152, 0.0722));
        float wm = smoothstep(0.86, 0.985, lum) * uWinOn;            // 过曝成纯白的窗玻璃
        vec3 em = alb * uTint * mix(uAmb, uWin, wm) * uGainS;        // 扫描贴图里烘死的日光
        #ifdef USE_VC
          #ifdef USE_ZF
          em *= max(vCol, vec3(uZF.z * zk * zk));
          #else
          em *= vCol;
          #endif
        #endif
        vec3 dalb = mix(alb, vec3(0.015, 0.018, 0.02), wm);
        vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
        vec3 E = dynLight(vWP, N, vVP) + portalLight(vWP, N);
        vec3 spill = uSpillK > 0.0 ? texture2D(tSpill, vUv).rgb * uSpillK * uK * uTint : vec3(0.0);  // 门外天光漏进来的部分（已含 1/π）
        float ao = blobAO(vWP);
        gl_FragColor = vec4(em * mix(1.0, ao, 0.6) + dalb * (spill * ao + E * 0.31831), 1.0);
      }`,
    side: THREE.DoubleSide,
  });
  return m;
}

// 只保留三个顶点都落在 x0..x1 之间的三角形（几何体自己的坐标），返回新的几何体（顶点数据共用）
function clipGeomX(geo, x0, x1) {
  const g = geo.clone(), pos = g.attributes.position, idx = g.index, keep = [];
  const n = idx ? idx.count : pos.count;
  for (let t = 0; t < n; t += 3) {
    const a = idx ? idx.getX(t) : t, b = idx ? idx.getX(t + 1) : t + 1, c = idx ? idx.getX(t + 2) : t + 2;
    const xa = pos.getX(a), xb = pos.getX(b), xc = pos.getX(c);
    if (Math.min(xa, xb, xc) >= x0 && Math.max(xa, xb, xc) <= x1) keep.push(a, b, c);
  }
  g.setIndex(keep);
  return g;
}

const EQUIRECT_GLSL = /* glsl */`
// three 方向 -> Blender 世界方向 -> 全景图 UV（和 Cycles 的环境贴图映射一致）
vec2 equirectUV(vec3 dt){
  vec3 d = normalize(vec3(dt.x, -dt.z, dt.y));
  return vec2(0.5 - atan(d.y, d.x) / 6.2831853, 0.5 + asin(clamp(d.z, -1.0, 1.0)) / 3.14159265);
}`;

export class World {
  constructor() {
    this.scene = new THREE.Scene();
    this.roomMeshes = [];
    this.collider = null;
    this.mode = QS.mode;
  }

  async load(onProgress) {
    const tl = new THREE.TextureLoader(), gl = new GLTFLoader(), hl = new HDRLoader();
    const P = (p) => new Promise((res, rej) => p.load ? null : null);
    const loadTex = (u) => new Promise((res, rej) => tl.load(u, res, undefined, rej));
    const loadHDR = (u) => new Promise((res, rej) => hl.load(u, res, undefined, rej));
    const loadGLTF = (u) => new Promise((res, rej) => gl.load(u, res, undefined, rej));
    const tdir = QS.tex === '4k' ? 'textures4k' : 'textures';
    const LVTEX = QS.tex === '4k' ? 'textures2k' : 'textures';
    const RN = ['u1_v1', 'u1_v2', 'u1_v3', 'u2_v1', 'u2_v2', 'u2_v3', 'u3_v1', 'u3_v2'];
    let done = 0; const total = 10 + RN.length; const tick = (m) => onProgress && onProgress(++done / total, m);
    const [gltf, a1, a2, s1, s2, hdr, gRooms, gCorr, meta, ...rt] = await Promise.all([
      loadGLTF('./assets/room/scene.gltf').then((v) => (tick('大厅模型'), v)),
      loadTex(`./assets/room/${tdir}/tex_u1_v1_baseColor.jpg`).then((v) => (tick('大厅贴图 1'), v)),
      loadTex(`./assets/room/${tdir}/tex_u2_v1_baseColor.jpg`).then((v) => (tick('大厅贴图 2'), v)),
      loadHDR('./assets/room/spill_tex_u1_v1.hdr').then((v) => (tick('光照贴图 1'), v)),
      loadHDR('./assets/room/spill_tex_u2_v1.hdr').then((v) => (tick('光照贴图 2'), v)),
      loadHDR('./assets/hdri/exterior_4k.hdr').then((v) => (tick('门外全景'), v)),
      loadGLTF('./assets/level/rooms.gltf').then((v) => (tick('小房间模型'), v)),
      loadGLTF('./assets/level/corridor.gltf').then((v) => (tick('走廊模型'), v)),
      fetch('./assets/level/level.json').then((r) => r.json()).then((v) => (tick('关卡数据'), v)),
      ...RN.map((n, i) => loadTex(`./assets/level/${LVTEX}/R_tex_${n}.jpg`).then((v) => (tick(`小房间贴图 ${i + 1}`), v))),
    ]);
    LV.meta = meta;
    for (const t of [a1, a2, s1, s2, ...rt]) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; }      // 扫描贴图是分块的（UV 落在 0..1 之外的整数格里）
    for (const t of [a1, a2, ...rt]) { t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; t.anisotropy = 16; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.needsUpdate = true; }
    for (const t of [s1, s2]) { t.flipY = false; t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true; }
    hdr.minFilter = THREE.LinearFilter; hdr.magFilter = THREE.LinearFilter; hdr.generateMipmaps = false; hdr.wrapS = THREE.RepeatWrapping; hdr.needsUpdate = true;
    this.hdr = hdr;
    const mats = { tex_u1_v1: roomMaterial(a1, s1), tex_u2_v1: roomMaterial(a2, s2) };
    this.roomMats = Object.values(mats);
    gltf.scene.updateMatrixWorld(true);
    const geos = [];
    const floorMeshes = this.floorMeshes = { 0: [], 1: [], 2: [] };      // 只在某一层才看得到的网格（大厅、各层的两间小房间），按楼层开关显示
    const addCollider = (o) => {
      const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld);
      for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
      geos.push(g.index ? g.toNonIndexed() : g);
    };
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.material = mats[o.material.name] || this.roomMats[0];
      o.frustumCulled = false;
      this._cutDoorPanel(o);
      this.roomMeshes.push(o);
      addCollider(o);
      floorMeshes[1].push(o);
    });
    this.scene.add(gltf.scene);
    // 小房间（另一套扫描）和走廊/楼梯间（用小房间的墙、地、顶克隆拼出来的，亮度按烘焙的顶点色缩放）。
    // 二楼、地下室的两间小房间是同一套扫描上下各放一份：二楼换一种漆色；地下室去色、压得很暗（窗封死了，只有枪灯）。
    const RG = QS.rgain ?? 1.0;
    const VAR = { 1: { hue: 0, sat: 1, gain: RG }, 2: { hue: -0.55, sat: 0.8, gain: RG }, 0: { hue: 0, sat: 0.22, gain: RG * 0.03 } };
    const mk = (f, vc, gk = 1, zf = null) => { const t = {}; RN.forEach((n, i) => { t['R_tex_' + n] = roomMaterial(rt[i], null, { win: false, vc, zf, hue: VAR[f].hue, sat: VAR[f].sat, gain: (vc && f === 0 ? RG : VAR[f].gain) * gk }); }); return t; };
    // 楼梯间里一楼地面以下的那些墙和台阶：烘焙里没有给环境光下限（地下室该黑），和一楼的墙接缝处会是一条硬线，这里按高度渐变过去
    const smat = mk(0, true, 1, [FLOOR_Z - 2.7, FLOOR_Z + 0.02, 0.05, 1.0]);
    const isStairLow = (nm) => /-1(_|$)/.test(nm) || /^(CloB1|Sp[SNWE]0|StE_lo0)$/.test(nm);
    const rmat = { 0: mk(0, false), 1: mk(1, false), 2: mk(2, false) }, cmat = { 0: mk(0, true), 1: mk(1, true), 2: mk(2, true) }, xmat = mk(1, true, 2.5), xmat2 = mk(2, true, 2.5);
    for (const f of [0, 1, 2]) { cmat[f].H_tex_u1_v1 = roomMaterial(a1, null, { win: false, vc: true }); cmat[f].H_tex_u2_v1 = roomMaterial(a2, null, { win: false, vc: true }); }
    const black = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.DoubleSide });
    this.levelMats = [0, 1, 2].flatMap((f) => [...Object.values(rmat[f]), ...Object.values(cmat[f])]).concat(Object.values(xmat), Object.values(xmat2), Object.values(smat));
    const extra = [];
    gRooms.scene.updateMatrixWorld(true); gCorr.scene.updateMatrixWorld(true);
    // 池核：地下室走廊北墙上开一道门（扫描墙和它背后垫的那层都要开洞），门后是用代码搭的泳池空间
    const pool = this.pool = new Pool(L, LIGHT_GLSL), [hx0, hx1, hh] = POOL.DOOR, HOLE = [hx0 - 0.03, POOL.Z0 + 0.02, 0.30, hx1 + 0.03, POOL.Z0 + hh + 0.03, 0.52];
    gRooms.scene.traverse((o) => {
      if (!o.isMesh) return;
      const nm = o.material.name; o.material = rmat[1][nm] || black;
      this.roomMeshes.push(o); addCollider(o); floorMeshes[1].push(o);
      for (const f of [0, 2]) { const c = o.clone(); c.material = rmat[f][nm] || black; c.position.y += (f - 1) * FH; extra.push([o.parent, c]); floorMeshes[f].push(c); }
    });
    gCorr.scene.traverse((o) => {
      if (!o.isMesh) return;
      // 构件名要取 glTF 节点的名字：多材质的构件加载后是"一个组 + 每种材质一个子网格"，子网格的名字是网格数据名，不是构件名
      const pn = o.userData.name || (o.parent && o.parent.userData && o.parent.userData.name) || o.name;
      const nm = o.material.name, f = /_2$/.test(pn) ? 2 : (/_0$/.test(pn) || /^Seal/.test(pn) ? 0 : 1), isExt = /^Ext/.test(pn);
      // 地下室封窗的板和房门的门套：烘焙时地下室的两间房不在场景里，它们是露天受光的，顶点色不能用；和地下室的房间一样按"很暗"处理
      const flat0 = /^Seal/.test(pn) || /^LinC_.*_0$/.test(pn);
      o.material = (isExt && (f === 2 ? xmat2 : xmat)[nm]) || (flat0 && rmat[0][nm]) || (isStairLow(pn) && smat[nm]) || cmat[f][nm] || black;
      punchHole(o, HOLE);
      this.roomMeshes.push(o); addCollider(o);
      // 外立面是克隆的扫描墙，墙上有没扫到的破洞；后面再垫两层错开一米多的同款墙面，洞里露出来的就还是墙而不是黑底
      // 垫的这两层只留在外墙自己的范围里：整块平移过去的话，多出来的一截会伸进走廊通小房间的门洞（看得见、却没有碰撞，人能穿过去）
      if (isExt) {
        const x0 = 16.44, x1 = 20.7;      // 走廊南侧那段外墙：从西墙角到小房间 C 的西墙
        for (const [dx, dy, dz] of [[1.6, -0.5, -0.015], [-1.3, 0.4, -0.02]]) {
          const b = o.clone(); b.geometry = clipGeomX(o.geometry, x0 - dx, x1 - dx); b.position.x += dx; b.position.y += dy; b.position.z += dz; extra.push([o.parent, b, true]);
        }
      }
    });
    for (const [par, c, noCol] of extra) { par.add(c); c.updateMatrixWorld(true); if (!noCol) { this.roomMeshes.push(c); addCollider(c); } }
    this.scene.add(gRooms.scene); this.scene.add(gCorr.scene);
    const poolTri0 = geos.reduce((s, g) => s + g.attributes.position.count / 3, 0);
    geos.push(...pool.build()); this.scene.add(pool.group);
    // 碰撞/射线用的合并网格
    const merged = mergeGeometries(geos, false);
    merged.boundsTree = new MeshBVH(merged);
    if (onProgress) { onProgress(0.99, '池核的光照（第一次要算几秒）'); await new Promise((r) => setTimeout(r, 30)); }
    const tb = performance.now(), rays = pool.bake(merged, poolTri0); this.poolBake = `pool bake: ${pool.geo.attributes.position.count} verts, ${pool.nTileTris} tris, ${rays} rays, ${(performance.now() - tb).toFixed(0)} ms`;
    if (QS.tag) fetch('/__shot/poolbake', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: this.poolBake }).catch(() => {});
    this.collider = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    this.collider.visible = false;
    this.collider.updateMatrixWorld(true);

    this._buildSky(hdr);
    this._buildGround(hdr);
    this.setMode(this.mode);
  }

  // 大厅南墙那扇关着的双开门：把门板的三角形拿掉，门洞通向走廊（和 Blender 里搭关卡时用的是同一条判据）
  _cutDoorPanel(o) {
    const g = o.geometry, pos = g.attributes.position, idx = g.index; if (!idx) return;
    const m = o.matrixWorld, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), keep = [];
    let cut = 0;
    for (let t = 0; t < idx.count; t += 3) {
      const ia = idx.getX(t), ib = idx.getX(t + 1), ic = idx.getX(t + 2);
      a.fromBufferAttribute(pos, ia).applyMatrix4(m); b.fromBufferAttribute(pos, ib).applyMatrix4(m); c.fromBufferAttribute(pos, ic).applyMatrix4(m);
      const cx = (a.x + b.x + c.x) / 3, cy = (a.y + b.y + c.y) / 3, cz = (a.z + b.z + c.z) / 3;      // three 坐标：y 向上，z = -Blender y
      n.subVectors(b, a).cross(c.sub(a)).normalize();
      if (cx > 17.744 && cx < 19.246 && cz > 0.12 && cy > 0.43 && cy < 2.54 && Math.abs(n.z) > 0.5) { cut++; continue; }
      keep.push(ia, ib, ic);
    }
    if (cut) g.setIndex(keep);
  }

  _buildSky(hdr) {
    this.skyU = { tEnv: { value: hdr }, uGain: { value: 7 }, uTint: L.uTint };
    const m = new THREE.ShaderMaterial({
      uniforms: this.skyU, side: THREE.BackSide, depthWrite: false, depthTest: false,
      vertexShader: `varying vec3 vDir; void main(){ vDir = mat3(modelMatrix) * position; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform sampler2D tEnv; uniform float uGain; uniform vec3 uTint; varying vec3 vDir; ${EQUIRECT_GLSL}
        void main(){ gl_FragColor = vec4(texture2D(tEnv, equirectUV(vDir)).rgb * uGain * uTint, 1.0); }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(150, 48, 24), m);
    this.sky.renderOrder = -10; this.sky.frustumCulled = false;
    this.scene.add(this.sky);
  }

  _buildGround(hdr) {
    this.groundU = {
      ...L, tEnv: { value: hdr }, uP0: { value: b2t(...HDRI_P0) }, uDoor: { value: b2t(16.9, 2.0, GROUND_Z) },
      uEm: { value: 1.5 }, uSunE: { value: 7.5 * 0.9176 }, uAmbE: { value: 1.0 },
    };
    const m = new THREE.ShaderMaterial({
      uniforms: this.groundU, transparent: true, side: THREE.DoubleSide,
      vertexShader: COMMON_VS,
      fragmentShader: /* glsl */`
        uniform sampler2D tEnv; uniform vec3 uP0; uniform vec3 uDoor; uniform float uEm; uniform float uSunE; uniform float uAmbE; uniform float uK; uniform vec3 uTint;
        varying vec2 vUv; varying vec3 vWP; varying vec3 vN; varying vec3 vVP;
        ${EQUIRECT_GLSL}
        ${LIGHT_GLSL}
        void main(){
          vec3 c = texture2D(tEnv, equirectUV(vWP - uP0)).rgb;       // 全景照片的地面部分投影到这块平面上
          vec3 N = vec3(0.0, 1.0, 0.0);
          float ao = blobAO(vWP);
          vec3 E = dynLight(vWP, N, vVP);
          vec3 alb = min(c * 1.8, vec3(0.95));
          vec3 col = c * uEm * uK * uTint + alb * ((uSunE * ao + uAmbE * mix(0.6, 1.0, ao)) * uK * uTint * 0.31831 + E * 0.31831);
          vec2 q = max(abs(vWP.xz - vec2(21.3, 2.7)) - vec2(4.7, 8.4), 0.0);      // 到建筑占地的距离
          float fade = 1.0 - smoothstep(22.0, 34.0, length(q));
          gl_FragColor = vec4(col, fade);
        }`,
    });
    // 院子：一大块平面，挖掉建筑占地（大厅、走廊+楼梯间、小房间；它们脚下不铺，地下室在地面以下）
    const holes = [[17.0, -0.42, 25.98, 5.75], [17.0, -2.62, 31.5, -0.15], [20.78, -10.92, 25.98, -2.42]];
    const xs = [...new Set([-70, 100, ...holes.flatMap((h) => [h[0], h[2]])])].sort((p, q) => p - q), ys = [...new Set([-90, 90, ...holes.flatMap((h) => [h[1], h[3]])])].sort((p, q) => p - q);
    const rects = [];
    for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < ys.length - 1; j++) {
      const cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2;
      if (!holes.some((h) => cx > h[0] && cx < h[2] && cy > h[1] && cy < h[3])) rects.push([xs[i], ys[j], xs[i + 1], ys[j + 1]]);
    }
    const pos = [], idx = [];
    for (const [x0, y0, x1, y1] of rects) {
      const b = pos.length / 3;
      for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) { const v = b2t(x, y, GROUND_Z); pos.push(v.x, v.y, v.z); }
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length / 3).fill([0, 1, 0]).flat(), 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(pos.length / 3 * 2).fill(0), 2));
    this.ground = new THREE.Mesh(g, m);
    this.ground.frustumCulled = false;
    this.ground.renderOrder = -5;
    this.scene.add(this.ground);
  }

  setMode(name) {
    const M = MODES[name]; this.mode = name; this.M = M;
    L.uAmb.value = M.amb; L.uWin.value = M.win; L.uK.value = M.K; L.uTint.value.set(...M.tint);
    L.uPuffEmit.value = M.puffEmit;
    this.skyU.uGain.value = 7.0 * M.K;
    if (this.pool) {
      this.pool.setMode(M);
      L.uPortal.value.set((POOL.DOOR[0] + POOL.DOOR[1]) / 2, POOL.Z0 + 1.5, 0.2, 5.5);
      L.uPortalCol.value.set(M.tint[0], M.tint[1], M.tint[2]).multiplyScalar(4.2 * M.K).add(new THREE.Vector3(0.05, 0.075, 0.07));
    }
  }

  update(camera) { this.sky.position.copy(camera.position); this._syncLights(); if (this.pool) this.pool.update(this.renderer, this.scene, camera); }

  // ---------------- 给标准材质（手臂、枪、敌人、弹壳）用的光：环境探针 + 与着色器同步的枪灯/火光
  initLighting(renderer) {
    this.renderer = renderer;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.cubeRT = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType });
    this.cubeCam = new THREE.CubeCamera(0.05, 300, this.cubeRT);
    // 标准材质上每多一盏灯都要多算一遍：枪灯的内两层光锥合成一盏，我方枪口火光不照标准材质（影片里手臂大半在手和枪的阴影里）
    const ang = [11, 31].map((d) => THREE.MathUtils.degToRad(d));
    this.spots = ang.map((a) => { const s = new THREE.SpotLight(0xfff7eb, 0, 0, a, 1, 2); this.scene.add(s); this.scene.add(s.target); return s; });
    this.points = [1].map((idx) => { const p = new THREE.PointLight(0xffb366, 0, 60, 2); p.userData.idx = idx; this.scene.add(p); return p; });      // 有截止距离的是火光（敌人材质靠这个把它和枪灯区分开）
  }
  _syncLights() {
    if (!this.spots) return;
    const e = [L.uWLE.value.x + L.uWLE.value.y, L.uWLE.value.z];
    this.spots.forEach((s, i) => {
      s.position.copy(L.uWLPos.value); s.target.position.copy(L.uWLPos.value).add(L.uWLDir.value);
      s.intensity = e[i] * L.uWLOn.value / (4 * Math.PI);
    });
    this.points.forEach((p) => {
      const i = p.userData.idx, f = L.uFlashPos.value[i]; p.position.set(f.x, f.y, f.z); p.intensity = f.w / (4 * Math.PI) * 0.4;
      p.color.setRGB(L.uFlashCol.value[i].x, L.uFlashCol.value[i].y, L.uFlashCol.value[i].z);
    });
  }
  // 各区域的环境探针（给手臂、枪、敌人、弹壳用）。加载时和切换光线时各拍一遍，运行时按位置挑最近的
  // 只画看得到的楼层：两间小房间每层各有一份（每份约 30 万面），加上大厅；隔着楼板看不到的就不画。
  // z 是玩家脚底的高度（Blender 坐标）；在楼梯上走到两层中间时，上下两层都画。传 null 全部显示（拍环境探针时用）
  cullFloors(z) {
    if (!this.floorMeshes) return;
    if (this.pool) this.pool.group.visible = z == null || z < FLOOR_Z - 1.3;        // 池核只在人到了地下室那一层（或者正往下走）时才画
    for (const f of [0, 1, 2]) {
      const vis = z == null || Math.abs(z - (FLOOR_Z + (f - 1) * FH)) < 2.3;
      if (this._floorVis && this._floorVis[f] === vis) continue;
      for (const o of this.floorMeshes[f]) o.visible = vis;
      (this._floorVis || (this._floorVis = {}))[f] = vis;
    }
  }
  buildProbes() {
    this.cullFloors(null);
    const P = [];
    for (const x of [18.6, 21.2, 23.8]) for (const y of [1.4, 3.9]) P.push([x, y, 'hall', 1]);
    for (const f of [1, 2, 0]) {
      const sfx = ['0', '', '2'][f];
      for (const x of (f === 0 ? [19.0, 23.5] : [18.4, 21.7, 24.2])) P.push([x, -1.37, 'corr' + sfx, f]);
      P.push([23.2, -4.6, 'C' + sfx, f], [23.2, -8.8, 'B' + sfx, f]);
      P.push([26.5, -1.4, 'stair', f]);
    }
    P.push([30.3, -1.4, 'stair', 1.5, 0.3], [30.3, -1.4, 'stair', 0.5]);      // 上面那个转角平台紧挨着高窗，手臂会被照得发白，环境光压低（第 5 项）
    for (const [x, y] of [[22.25, 3.2], [22.5, 7.8], [23.3, 12.0], [15.25, 6.0], [15.25, 14.0], [19.0, 18.0], [24.5, 17.8], [29.5, 17.8], [31.0, 11.0]]) P.push([x, y, 'pool0', 0]);
    P.push([16.1, 2.4, 'out', 1], [16.0, -1.4, 'out', 1], [19.6, -4.4, 'out', 1], [19.6, -9.0, 'out', 1], [22.0, -11.9, 'out', 1], [11.0, 0.0, 'out', 1]);
    if (!this.probes) this.probes = P.map(([x, y, reg, f, vmK]) => ({ x, y, reg, f, vmK, z: layerZ(2) + (f - 1) * FH, p: b2t(x, y, layerZ(2) + (f - 1) * FH + 1.2) }));
    // 大厅和院子的探针保持和影片标定时一样；别的地方的窗是真洞，窗外的天按稍低的亮度算
    if (this.pool) this.pool.water.visible = false;        // 水面的倒影是给主镜头算的，拍探针时先不画
    for (const pr of this.probes) pr.rt = this.captureProbe(pr.p, pr.rt, (pr.reg === 'hall' || pr.reg === 'out') ? 7.0 : 4.5);
    if (this.pool) this.pool.water.visible = true;
  }
  // 离 (x,y,z)（Blender 坐标，z 是脚底高度）最近、且同在屋里/屋外的探针
  probeAt(x, y, reg, prev, z = layerZ(2)) {
    let best = null, bd = 1e9;
    for (const pr of this.probes) {
      if ((pr.reg === 'out') !== (reg === 'out')) continue;
      let d = (pr.x - x) ** 2 + (pr.y - y) ** 2 + 4 * (pr.z - z) ** 2; if (pr.reg !== reg) d += 9; if (pr === prev) d -= 0.5;
      if (d < bd) { bd = d; best = pr; }
    }
    return best;
  }
  // 在某个位置拍一张环境立方体并预滤波，返回可直接当 envMap 用的渲染目标（旧的会被释放）
  captureProbe(pos, prev, skyGain = 7.0) {
    this.cubeCam.position.copy(pos); this.sky.position.copy(pos);
    const g0 = this.skyU.uGain.value; this.skyU.uGain.value = g0 * skyGain / 7.0;
    this.cubeCam.update(this.renderer, this.scene);
    this.skyU.uGain.value = g0;
    const rt = this.pmrem.fromCubemap(this.cubeRT.texture);
    if (prev) prev.dispose();
    return rt;
  }

  // 沿射线的所有交点，由近到远（建多层寻路网格时用）
  raycastAll(origin, dir, far = 80) {
    const rc = this._rcAll || (this._rcAll = new THREE.Raycaster());
    rc.set(origin, dir); rc.far = far; rc.firstHitOnly = false;
    return rc.intersectObject(this.collider, false).sort((p, q) => p.distance - q.distance);
  }
  // 射线打到房间的最近交点（three 坐标）
  raycast(origin, dir, far = 80) {
    const rc = this._rc || (this._rc = new THREE.Raycaster());
    rc.set(origin, dir); rc.far = far; rc.firstHitOnly = true;
    const h = rc.intersectObject(this.collider, false);
    return h.length ? h[0] : null;
  }
}
