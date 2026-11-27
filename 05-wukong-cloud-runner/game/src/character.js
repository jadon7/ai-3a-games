// 角色模块：齐天大圣（蒙皮身体 + 壳层毛发 + 实时布料披风 + 凤翅冠与雉鸡翎 + 金箍棒 + 姿态库/反解/动画混合）。
//
//   const wk = createCharacter(app);  await wk.ready;
//   wk.group                      THREE.Group，原点 = 脚底点，本地 -Z 为前、+Y 为上（可以被挂到任意父节点下）
//   wk.update(dt, state)          state = { speed, boost, bank, pitch, turn, flip }（缺的字段按 0 / 巡航处理）
//                                 speed 米/秒；boost 0..1；bank 弧度，>0 = 向右倾；pitch 弧度，>0 = 抬头爬升；
//                                 turn -1..1，>0 = 向右转；flip 0..1 翻筋斗进度（只做团身，整体翻转由外层做）
//   wk.play(name)                 触发一个动作：'point' 举棒前指、'staff' 耍棍花后扛肩、'laugh' 叉腰大笑、'scratch' 抓耳挠腮、
//                                 'glance' 回头看、'akimbo' 叉腰、'shoulder' 扛棒、'lookout' 搭凉棚、'hit' 受击。
//                                 如果 assets/char/anims/manifest.json 里有同名骨骼片段，优先播片段。返回是否认识这个名字。
//   wk.getHeadPosition(target)    头部中心的世界坐标（相机、景深对焦用）
//   wk.uniforms                   加载完成后可用：{ body, fur, cape } 几组着色器 uniform，调参用
//
// 资产由 tools/export_char.py 从影片的角色文件导出（assets/char/）。披风、金冠、翎子都是代码生成的。
// 内部"模型空间"：+X 前、+Y 上、+Z 右，单位米（按 1.5 m 身高建模，外层统一放大到 1.7 m）。
// 布料和翎子在"跟着角色平移、但不跟着旋转"的坐标系里解算，所以转弯、翻身时会自然甩动。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { QUALITY, QUALITY_NAME } from './common.js';

const HERO_SCALE = 1.70 / 1.50;            // 整体放大：建模身高 1.5 m → 1.7 m
const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0), AZ = new THREE.Vector3(0, 0, 1);
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _q4 = new THREE.Quaternion();
const _v1 = V3(), _v2 = V3(), _v3 = V3(), _v4 = V3(), _v5 = V3(), _v6 = V3(), _v7 = V3();
const _m1 = new THREE.Matrix4(), _m3 = new THREE.Matrix3();
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (cur, tgt, rate, dt) => cur + (tgt - cur) * (1 - Math.exp(-rate * dt));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const ease = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const hash1 = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
/** 平滑的一维值噪声，-1..1，不是固定周期的正弦 */
const vnoise = (t, seed = 0) => { const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f); return (hash1(i + seed * 57.31) * (1 - u) + hash1(i + 1 + seed * 57.31) * u) * 2 - 1; };
const fbm1 = (t, seed = 0) => (vnoise(t, seed) + 0.5 * vnoise(t * 2.13 + 7.1, seed + 3) + 0.25 * vnoise(t * 4.31 + 1.7, seed + 9)) / 1.75;

/** 把一个组里的小零件按材质合并成几个网格（省绘制调用）。调用时 group 应在原点、没有父节点 */
function mergeByMaterial(group) {
  group.updateMatrixWorld(true);
  const buckets = new Map();
  group.traverse(o => { if (o.isMesh) { let g = o.geometry.clone().applyMatrix4(o.matrixWorld); if (g.index) g = g.toNonIndexed(); for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); if (!buckets.has(o.material)) buckets.set(o.material, []); buckets.get(o.material).push(g); } });
  group.clear();
  for (const [mat, list] of buckets) { const m = new THREE.Mesh(mergeGeometries(list, false), mat); m.castShadow = true; m.receiveShadow = true; group.add(m); }
  return group;
}

const HASH_GLSL = /* glsl */`
float wkHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float wkNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wkHash(i), wkHash(i + vec2(1, 0)), f.x), mix(wkHash(i + vec2(0, 1)), wkHash(i + vec2(1, 1)), f.x), f.y); }`;

// ------------------------------------------------------------------ 身体材质：锁子黄金甲
// 用 ORM 的金属度通道认出甲片，把它推成亮丽的黄金（提高金属度、压低粗糙度、底色偏金）；红布提纯提亮；脸和毛不动。
function makeBodyMaterial(tColor, tNormal, tOrm, U) {
  const mat = new THREE.MeshStandardMaterial({ map: tColor, normalMap: tNormal, aoMap: tOrm, roughnessMap: tOrm, metalnessMap: tOrm, roughness: 1.0, metalness: 1.0, side: THREE.DoubleSide });
  mat.aoMapIntensity = 0.7;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec4 uGold; uniform vec3 uGoldTint; uniform vec2 uCloth; uniform float uBodyDbg;')
      .replace('#include <map_fragment>', /* glsl */`#include <map_fragment>
        vec3 wkOrm = texture2D(metalnessMap, vMetalnessMapUv).rgb;
        float wkMetal = smoothstep(uGold.x, uGold.y, wkOrm.b);                                   // 甲片
        float wkL = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        float wkMx = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b));
        float wkRed = smoothstep(0.66, 0.84, (diffuseColor.r - max(diffuseColor.g, diffuseColor.b)) / max(wkMx, 1e-4)) * (1.0 - wkMetal) * smoothstep(0.02, 0.06, wkMx);   // 红布
        diffuseColor.rgb = mix(diffuseColor.rgb, uGoldTint * (wkL * uGold.w + 0.02), wkMetal * uGold.z);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.80, 0.030, 0.034) * (wkL * uCloth.y + 0.06), wkRed * uCloth.x);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, clamp(roughnessFactor * 0.52, 0.20, 0.5), wkMetal * uGold.z); roughnessFactor = mix(roughnessFactor, 0.62, wkRed * 0.6);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 1.0, wkMetal * uGold.z);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\nif (uBodyDbg > 0.5) { diffuseColor.rgb = vec3(0.0); totalEmissiveRadiance = vec3(wkMetal, wkRed, wkOrm.g * 0.3); }');
  };
  mat.customProgramCacheKey = () => 'wk-body';
  return mat;
}

// ------------------------------------------------------------------ 壳层毛发
function makeFur(furBase, tColor, tOrm, U) {
  U.tFurOrm = { value: tOrm };
  const g0 = furBase.geometry;
  const g = new THREE.InstancedBufferGeometry();
  g.index = g0.index;
  for (const k of ['position', 'normal', 'uv', 'skinIndex', 'skinWeight', '_fur']) g.setAttribute(k, g0.attributes[k]);
  g.instanceCount = U.uShells.value;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 3);
  const mat = new THREE.MeshStandardMaterial({ map: tColor, roughness: 0.82, metalness: 0.0, side: THREE.FrontSide });      // 只画正面：背面的壳层基本都被挡住，省一半填充
  mat.alphaToCoverage = U.uA2C.value > 0.5;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', /* glsl */`#include <common>
        attribute vec3 _fur;
        uniform float uShells, uFurTime, uWindAmp, uWindPush, uFurScale;
        uniform vec3 uFurLen, uComb, uWindDir;
        varying float vShell; varying float vFurMask;`)
      .replace('#include <skinning_vertex>', /* glsl */`#include <skinning_vertex>
        {
          float sT = (float(gl_InstanceID) + 1.0) / uShells;
          float len = dot(_fur, uFurLen) * uFurScale;
          vec3 nrm = normalize(objectNormal);
          vec3 dir = normalize(nrm + uComb * (0.25 + 0.95 * sT));                       // 顺毛：越到梢越往后下方倒
          float ph = dot(position, vec3(41.0, 23.0, 57.0));
          vec3 side = normalize(cross(nrm, uWindDir) + vec3(1e-4));
          vec3 wob = side * sin(uFurTime * 13.0 + ph) + nrm * 0.5 * sin(uFurTime * 19.0 + ph * 1.7) + uWindDir * 0.6 * sin(uFurTime * 9.0 + ph * 0.6);
          float gust = 0.5 + 0.5 * sin(uFurTime * 3.1 + dot(position, vec3(3.0, 5.0, 2.0)));    // 沿身体扫过的阵风
          transformed += dir * len * sT + (uWindDir * uWindPush * (0.5 + gust) + wob * uWindAmp * (0.6 + 0.8 * gust)) * len * sT * sT;
          vShell = sT; vFurMask = max(_fur.x, max(_fur.y, _fur.z));
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', /* glsl */`#include <common>
        uniform float uDensity, uFurAO, uA2C; uniform vec3 uFurTrans; uniform sampler2D tFurOrm;
        varying float vShell; varying float vFurMask;` + HASH_GLSL)
      .replace('#include <map_fragment>', /* glsl */`#include <map_fragment>
        {
          vec2 suv = vMapUv * uDensity;
          float ppx = max(length(dFdx(suv)), length(dFdy(suv)));                         // 一个像素跨多少根毛的格子
          float lod = exp2(floor(max(0.0, log2(ppx * 1.6))));                            // 远了就把毛"并股"，避免闪烁
          suv /= lod;
          vec2 cell = floor(suv); vec2 f = fract(suv) - 0.5;
          float rnd = wkHash(cell);
          vec2 jit = (vec2(wkHash(cell + 17.3), wkHash(cell + 5.9)) - 0.5) * 0.5;
          float d = length(f - jit);
          float clump = wkNoise(vMapUv * uDensity * 0.11);                                // 一绺一绺的长短起伏
          float tt = vShell / (mix(0.62, 1.0, rnd) * mix(0.72, 1.0, clump));               // 每根毛长度不一
          float rad = mix(0.56, 0.20, clamp(tt, 0.0, 1.0));                               // 根粗梢细
          float aa = max(ppx / lod, 0.02);
          vec3 orm = texture2D(tFurOrm, vMapUv).rgb;                                       // 金属件、光滑件（金箍、甲片）上不长毛
          float bare = max(smoothstep(0.20, 0.42, orm.b), 1.0 - smoothstep(0.42, 0.58, orm.g));
          float cov = (1.0 - smoothstep(rad - aa, rad + aa, d)) * step(tt, 1.0) * smoothstep(0.03, 0.10, vFurMask) * (1.0 - bare);
          if (cov < mix(0.5, 0.06, uA2C)) discard;
          diffuseColor.a = mix(1.0, cov, uA2C);
          float occ = mix(uFurAO, 1.0, pow(vShell, 0.7));                                 // 毛根被遮住，暗一些
          diffuseColor.rgb *= occ * mix(0.86, 1.10, wkHash(cell + 9.1)) * mix(0.90, 1.06, clump);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.22 + vec3(0.030, 0.020, 0.008), vShell * vShell * 0.6);
        }`)
      .replace('#include <lights_physical_pars_fragment>', /* glsl */`#include <lights_physical_pars_fragment>
        // 毛发的透光：受光面包裹一点 + 逆着光看时毛边发亮
        void RE_Direct_Fur( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
          RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
          float nl = dot( geometryNormal, directLight.direction );
          float wrap = saturate( ( nl + 0.7 ) / 1.7 ) - saturate( nl );
          float back = pow( saturate( dot( -geometryViewDir, directLight.direction ) ), 2.0 );
          float rim = pow( 1.0 - saturate( abs( dot( geometryNormal, geometryViewDir ) ) ), 1.5 );
          reflectedLight.directDiffuse += directLight.color * material.diffuseColor * RECIPROCAL_PI *
            ( wrap * uFurTrans.x + back * rim * uFurTrans.y * vShell + back * uFurTrans.z * vShell );
        }
        #undef RE_Direct
        #define RE_Direct RE_Direct_Fur`);
  };
  mat.customProgramCacheKey = () => 'wk-fur';
  const mesh = new THREE.SkinnedMesh(g, mat);
  mesh.name = 'WK_FurShells';
  mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = true;
  return mesh;
}


// ------------------------------------------------------------------ 布料解算（位置动力学，CPU）
// 扇形披风：上边（领口）钉在肩背上，往下越来越宽。坐标是"跟着角色平移、不跟着旋转"的坐标系，单位米。
function createCloth(NX, NY, L, topLen, hemLen) {
  const N = NX * NY;
  const pos = new Float32Array(N * 3), old = new Float32Array(N * 3), vel = new Float32Array(N * 3), nrm = new Float32Array(N * 3);
  const theta = (hemLen - topLen) / L, r0 = topLen / theta;
  const rx = new Float32Array(N), ry = new Float32Array(N), tether = new Float32Array(N);
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const k = j * NX + i, phi = (i / (NX - 1) - 0.5) * theta, r = r0 + (j / (NY - 1)) * L;
    rx[k] = r * Math.sin(phi); ry[k] = r * Math.cos(phi) - r0; tether[k] = (j / (NY - 1)) * L * 1.03;
  }
  const ca = [], cb = [], cl = [], cs = [];
  const add = (a, b, s) => { ca.push(a); cb.push(b); cl.push(Math.hypot(rx[a] - rx[b], ry[a] - ry[b])); cs.push(s); };
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const k = j * NX + i;
    if (j + 1 < NY) add(k, k + NX, 1.0);
    if (i + 1 < NX && j > 0) add(k, k + 1, 1.0);
    if (i + 1 < NX && j + 1 < NY) { add(k, k + NX + 1, 0.5); add(k + 1, k + NX, 0.5); }
    if (j + 2 < NY) add(k, k + 2 * NX, 0.22);
    if (i + 2 < NX && j > 0) add(k, k + 2, 0.22);
  }
  const CA = new Uint16Array(ca), CB = new Uint16Array(cb), CL = new Float32Array(cl), CS = new Float32Array(cs), NC = CA.length;

  function reset(pin, bx, by, bz, sx, sy, sz) {            // 沿 b 方向铺开（b = 往后下方，s = 向右）
    for (let k = 0; k < N; k++) {
      const i = k % NX, p = i * 3, k3 = k * 3;
      pos[k3] = pin[p] + sx * (rx[k] - rx[i]) + bx * ry[k]; pos[k3 + 1] = pin[p + 1] + sy * (rx[k] - rx[i]) + by * ry[k]; pos[k3 + 2] = pin[p + 2] + sz * (rx[k] - rx[i]) + bz * ry[k];
      old[k3] = pos[k3]; old[k3 + 1] = pos[k3 + 1]; old[k3 + 2] = pos[k3 + 2]; vel[k3] = vel[k3 + 1] = vel[k3 + 2] = 0;
    }
    computeNormals();
  }

  function computeNormals() {
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const k3 = (j * NX + i) * 3;
      const a = (j * NX + Math.max(0, i - 1)) * 3, b = (j * NX + Math.min(NX - 1, i + 1)) * 3, c = (Math.max(0, j - 1) * NX + i) * 3, d = (Math.min(NY - 1, j + 1) * NX + i) * 3;
      const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
      const vx = pos[d] - pos[c], vy = pos[d + 1] - pos[c + 1], vz = pos[d + 2] - pos[c + 2];
      let nx = vy * uz - vz * uy, ny = vz * ux - vx * uz, nz = vx * uy - vy * ux;
      const il = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
      nrm[k3] = nx * il; nrm[k3 + 1] = ny * il; nrm[k3 + 2] = nz * il;
    }
  }

  function collide(E) {
    const sph = E.sph, cap = E.cap, ns = E.nsph, nc = E.ncap, fy = E.floorY;
    for (let k = NX; k < N; k++) {
      const k3 = k * 3;
      let x = pos[k3], y = pos[k3 + 1], z = pos[k3 + 2];
      const bx = x - E.bx, by = y - E.by, bz = z - E.bz, far = bx * bx + by * by + bz * bz > E.br2;
      for (let s = 0; s < (far ? 0 : ns); s++) {
        const o = s * 4, r = sph[o + 3], dx = x - sph[o], dy = y - sph[o + 1], dz = z - sph[o + 2], d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < r * r) { const f = r / (Math.sqrt(d2) || 1e-5); x = sph[o] + dx * f; y = sph[o + 1] + dy * f; z = sph[o + 2] + dz * f; }
      }
      for (let s = far ? E.ncapBody : 0; s < nc; s++) {
        const o = s * 8, r = cap[o + 6];
        const px = x - cap[o], py = y - cap[o + 1], pz = z - cap[o + 2];
        let t = (px * cap[o + 3] + py * cap[o + 4] + pz * cap[o + 5]) * cap[o + 7]; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = cap[o] + cap[o + 3] * t, qy = cap[o + 1] + cap[o + 4] * t, qz = cap[o + 2] + cap[o + 5] * t;
        const dx = x - qx, dy = y - qy, dz = z - qz, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < r * r) { const f = r / (Math.sqrt(d2) || 1e-5); x = qx + dx * f; y = qy + dy * f; z = qz + dz * f; }
      }
      if (y < fy) y = fy;
      pos[k3] = x; pos[k3 + 1] = y; pos[k3 + 2] = z;
    }
  }

  const rowS = new Float32Array(NY * 8), colS_ = new Float32Array(NX * 8);
  function step(h, E, iters) {
    const pin = E.pin, t = E.t, U = E.U;
    // 行（沿披风长度）和列（横向）的相位各算一次，质点上用和角公式合成，省掉逐质点的三角函数
    for (let j = 0; j < NY; j++) { const s = (j / (NY - 1)) * L, o = j * 8;
      rowS[o] = Math.sin(E.k1 * s - E.w1 * t); rowS[o + 1] = Math.cos(E.k1 * s - E.w1 * t); rowS[o + 2] = Math.sin(E.k2 * s - E.w2 * t); rowS[o + 3] = Math.cos(E.k2 * s - E.w2 * t);
      rowS[o + 4] = Math.sin(E.k3 * s - E.w3 * t); rowS[o + 5] = Math.cos(E.k3 * s - E.w3 * t); rowS[o + 6] = Math.sin(2.3 * t - 3.3 * s); rowS[o + 7] = Math.cos(2.3 * t - 3.3 * s); }
    for (let i = 0; i < NX; i++) { const u = i / (NX - 1), o = i * 8, ph = 1.3 * Math.sin(u * 3.1 + 0.6 * t) + 0.5 * Math.sin(u * 7.0 - 0.9 * t);
      colS_[o] = Math.sin(ph); colS_[o + 1] = Math.cos(ph); colS_[o + 2] = Math.sin(-1.7 * ph); colS_[o + 3] = Math.cos(-1.7 * ph);
      colS_[o + 4] = Math.sin(u * 9.0); colS_[o + 5] = Math.cos(u * 9.0); colS_[o + 6] = Math.sin(2.6 * (u - 0.5)); colS_[o + 7] = Math.cos(2.6 * (u - 0.5)); }
    for (let j = 1; j < NY; j++) {
      const v = j / (NY - 1), ro = j * 8, sl = v * L;
      const gust = U * (1 + 0.16 * Math.sin(1.7 * t - 0.9 * v * L));
      for (let i = 0; i < NX; i++) {
        const k3 = (j * NX + i) * 3, u = i / (NX - 1), co = i * 8;
        const nx = nrm[k3], ny = nrm[k3 + 1], nz = nrm[k3 + 2];
        // 风：主气流 + 沿披风往后传的乱流
        const tb = rowS[ro + 6] * colS_[co + 7] + rowS[ro + 7] * colS_[co + 6];
        const tu = U * E.turb * tb, ts = U * E.turb * 0.8 * (rowS[ro + 7] * colS_[co + 7] - rowS[ro + 6] * colS_[co + 6]);
        const rvx = E.wdx * gust + E.wux * tu + E.wsx * ts - vel[k3], rvy = E.wdy * gust + E.wuy * tu + E.wsy * ts - vel[k3 + 1], rvz = E.wdz * gust + E.wuz * tu + E.wsz * ts - vel[k3 + 2];
        const dn = rvx * nx + rvy * ny + rvz * nz;
        // 沿披风往下摆传播的波：大波浪（有重量感）+ 中波 + 高速时的碎抖
        const wave = E.A1 * v * (rowS[ro] * colS_[co + 1] + rowS[ro + 1] * colS_[co]) + E.A2 * v * (rowS[ro + 2] * colS_[co + 3] + rowS[ro + 3] * colS_[co + 2]) + E.A3 * v * v * (rowS[ro + 4] * colS_[co + 5] + rowS[ro + 5] * colS_[co + 4]);
        const an = dn * E.kN + wave - (vel[k3] * nx + vel[k3 + 1] * ny + vel[k3 + 2] * nz) * E.kD;      // 法向气动力 + 波浪 + 随风速增大的气动阻尼（否则高速时会自激乱甩）
        const spread = E.spread * v * (u - 0.5) + E.S2 * v * v * (rowS[ro + 2] * colS_[co + 5] + rowS[ro + 3] * colS_[co + 4]);     // 向两侧撑开 + 高速时下摆左右甩
        // 引导：目标点 = 自己那一列的钉点 + 沿目标方向铺出去（翻筋斗时拉得很紧，平时只是轻轻带一下）
        const p3 = i * 3, dxr = (rx[j * NX + i] - rx[i]) * E.gspread;
        const ex = pin[p3] + E.tdx * sl + E.wsx * dxr - pos[k3], ey = pin[p3 + 1] + E.tdy * sl + E.wsy * dxr - pos[k3 + 1], ez = pin[p3 + 2] + E.tdz * sl + E.wsz * dxr - pos[k3 + 2];
        const el = (ex * E.wsx + ey * E.wsy + ez * E.wsz) * E.glat;                // 只管横向：别让披风在高速时收成一条线
        const gx_ = ex * E.guide - vel[k3] * E.gdamp + E.wsx * el, gy_ = ey * E.guide - vel[k3 + 1] * E.gdamp + E.wsy * el, gz_ = ez * E.guide - vel[k3 + 2] * E.gdamp + E.wsz * el;
        vel[k3] = (vel[k3] + (E.gx + nx * an + rvx * E.kT + E.ax + E.wsx * spread + gx_) * h) * E.damp;
        vel[k3 + 1] = (vel[k3 + 1] + (E.gy + ny * an + rvy * E.kT + E.ay + E.wsy * spread + gy_) * h) * E.damp;
        vel[k3 + 2] = (vel[k3 + 2] + (E.gz + nz * an + rvz * E.kT + E.az + E.wsz * spread + gz_) * h) * E.damp;
        old[k3] = pos[k3]; old[k3 + 1] = pos[k3 + 1]; old[k3 + 2] = pos[k3 + 2];
        pos[k3] += vel[k3] * h; pos[k3 + 1] += vel[k3 + 1] * h; pos[k3 + 2] += vel[k3 + 2] * h;
      }
    }
    for (let i = 0; i < NX * 3; i++) pos[i] = pin[i];
    for (let it = 0; it < iters; it++) {
      for (let c = 0; c < NC; c++) {
        const ia = CA[c], a = ia * 3, b = CB[c] * 3;
        const dx = pos[b] - pos[a], dy = pos[b + 1] - pos[a + 1], dz = pos[b + 2] - pos[a + 2];
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        if (ia < NX) { const f = (len - CL[c]) / len * CS[c]; pos[b] -= dx * f; pos[b + 1] -= dy * f; pos[b + 2] -= dz * f; }
        else { const f = (len - CL[c]) / len * CS[c] * 0.5; pos[a] += dx * f; pos[a + 1] += dy * f; pos[a + 2] += dz * f; pos[b] -= dx * f; pos[b + 1] -= dy * f; pos[b + 2] -= dz * f; }
      }
      for (let k = NX; k < N; k++) {                                     // 拉绳约束：离自己那一列的钉点不能超过布长，防止被风拉成橡皮
        const k3 = k * 3, p = (k % NX) * 3;
        const dx = pos[k3] - pos[p], dy = pos[k3 + 1] - pos[p + 1], dz = pos[k3 + 2] - pos[p + 2], d2 = dx * dx + dy * dy + dz * dz, m = tether[k];
        if (d2 > m * m) { const f = m / Math.sqrt(d2); pos[k3] = pos[p] + dx * f; pos[k3 + 1] = pos[p + 1] + dy * f; pos[k3 + 2] = pos[p + 2] + dz * f; }
      }
      if (it >= iters - 1 || it === iters - 3) collide(E);
    }
    const ih = 1 / h;
    for (let k = NX * 3; k < N * 3; k++) vel[k] = (pos[k] - old[k]) * ih;
  }
  return { NX, NY, N, L, topLen, hemLen, pos, vel, nrm, reset, step, computeNormals };
}

// ------------------------------------------------------------------ 披风的刺绣纹样（画布生成）：R = 金线，G = 暗纹
function makeCapePattern(topLen, hemLen, L) {
  const W = 1024, H = 2048;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  c.fillStyle = '#000'; c.fillRect(0, 0, W, H);
  c.globalCompositeOperation = 'lighter';
  c.lineCap = 'round'; c.lineJoin = 'round';
  const GOLD = '#ff0000', DAM = '#00a000';
  const widthAt = (v) => topLen + (hemLen - topLen) * v;
  // 在 (u, v) 处以"米"为单位画图：横向按当地布宽换算，图案不会被扇形拉扁
  const at = (u, v, rot, fn) => { c.save(); c.translate(u * W, v * H); c.scale(W / widthAt(v), H / L); if (rot) c.rotate(rot); fn(); c.restore(); };
  let seed = 20251; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const spiral = (cx, cy, r, dir, a0, turns = 1.3) => { c.beginPath(); for (let k = 0; k <= 36; k++) { const t = k / 36, ang = a0 + dir * t * Math.PI * 2 * turns, rr = r * (1 - 0.8 * t); const x = cx + Math.cos(ang) * rr, y = cy + Math.sin(ang) * rr; if (k) c.lineTo(x, y); else c.moveTo(x, y); } c.stroke(); };
  const cloud = (s, lw) => {                                              // 如意云头：三个卷 + 两条云尾
    c.lineWidth = lw;
    spiral(-0.30 * s, 0.02 * s, 0.25 * s, 1, Math.PI * 0.95); spiral(0.30 * s, 0.02 * s, 0.25 * s, -1, Math.PI * 0.05); spiral(0, -0.24 * s, 0.30 * s, 1, Math.PI * 1.5);
    c.beginPath(); c.moveTo(-0.55 * s, 0.10 * s); c.bezierCurveTo(-0.2 * s, 0.36 * s, 0.25 * s, 0.30 * s, 0.80 * s, 0.44 * s); c.stroke();
    c.beginPath(); c.moveTo(0.55 * s, 0.10 * s); c.bezierCurveTo(0.65 * s, 0.22 * s, 0.9 * s, 0.26 * s, 1.10 * s, 0.33 * s); c.stroke();
  };
  const fret = (a, lw) => {                                               // 回纹：方形内卷
    c.lineWidth = lw; const g = a * 0.5;
    c.beginPath(); c.moveTo(-a, a); c.lineTo(-a, -a); c.lineTo(a, -a); c.lineTo(a, a - g * 0.2); c.lineTo(-a + g, a - g * 0.2); c.lineTo(-a + g, -a + g); c.lineTo(a - g, -a + g); c.lineTo(a - g, a - g * 1.3); c.stroke();
  };
  // ---- 暗纹（同色提花）：满地小云卷
  c.strokeStyle = DAM;
  for (let v = 0.03; v < 1.0; v += 0.13 / L) {
    const wv = widthAt(v), n = Math.max(2, Math.round(wv / 0.15)), off = (Math.round(v * L / 0.13) % 2) * 0.5;
    for (let i = 0; i < n; i++) at((i + 0.5 + off * 0.999) / n % 1, v, 0, () => { c.lineWidth = 0.006; spiral(-0.022, 0, 0.026, 1, 0, 1.1); spiral(0.022, 0, 0.026, -1, Math.PI, 1.1); });
  }
  // ---- 金线
  c.strokeStyle = GOLD; c.fillStyle = GOLD;
  const band = (d0, d1) => {                                              // 距两侧边和下摆 d0~d1 米的一条带
    c.beginPath();
    for (let k = 0; k <= 64; k++) { const v = k / 64; c.lineTo((d0 / widthAt(v)) * W, v * H); }
    for (let k = 64; k >= 0; k--) { const v = k / 64; c.lineTo((d1 / widthAt(v)) * W, v * H); }
    c.closePath(); c.fill();
    c.beginPath();
    for (let k = 0; k <= 64; k++) { const v = k / 64; c.lineTo((1 - d0 / widthAt(v)) * W, v * H); }
    for (let k = 64; k >= 0; k--) { const v = k / 64; c.lineTo((1 - d1 / widthAt(v)) * W, v * H); }
    c.closePath(); c.fill();
    c.fillRect(0, (1 - d1 / L) * H, W, (d1 - d0) / L * H);
  };
  band(0, 0.020); band(0.030, 0.036); band(0.118, 0.126);                // 滚边 + 回纹带的两道框线
  c.fillRect(0, 0, W, 0.050 / L * H); c.fillRect(0, 0.062 / L * H, W, 0.008 / L * H);    // 领口金边
  for (let v = 0.07 / L; v < 1 - 0.13 / L; v += 0.074 / L) {             // 两侧的回纹
    at(0.077 / widthAt(v), v, 0, () => fret(0.026, 0.0085)); at(1 - 0.077 / widthAt(v), v, 0, () => { c.scale(-1, 1); fret(0.026, 0.0085); });
  }
  { const n = Math.round(hemLen / 0.074), v = 1 - 0.077 / L; for (let i = 0; i < n; i++) at((i + 0.5) / n, v, Math.PI / 2, () => fret(0.026, 0.0085)); }      // 下摆的回纹
  // 团纹：背心一个大的"日轮祥云"
  at(0.5, 0.40, 0, () => {
    const R = 0.30;
    c.lineWidth = 0.014; c.beginPath(); c.arc(0, 0, R, 0, Math.PI * 2); c.stroke();
    c.lineWidth = 0.006; c.beginPath(); c.arc(0, 0, R - 0.028, 0, Math.PI * 2); c.stroke();
    for (let k = 0; k < 12; k++) { c.save(); c.rotate(k * Math.PI / 6); c.translate(0, -(R - 0.085)); cloud(0.085, 0.009); c.restore(); }
    c.beginPath(); c.arc(0, 0, 0.072, 0, Math.PI * 2); c.fill();
    for (let k = 0; k < 16; k++) { c.save(); c.rotate(k * Math.PI / 8 + 0.2); c.beginPath(); c.moveTo(0.088, -0.012); c.quadraticCurveTo(0.150, -0.030, 0.165 + (k % 2) * 0.02, 0.0); c.quadraticCurveTo(0.130, 0.012, 0.088, 0.012); c.closePath(); c.fill(); c.restore(); }
  });
  // 散布的云纹（左右对称），越往下越大
  const spots = [[0.30, 0.13, 0.085], [0.24, 0.26, 0.10], [0.17, 0.44, 0.12], [0.31, 0.62, 0.13], [0.14, 0.66, 0.13], [0.40, 0.74, 0.12], [0.22, 0.82, 0.14], [0.08, 0.84, 0.12], [0.36, 0.89, 0.12], [0.50, 0.70, 0.13], [0.50, 0.86, 0.14], [0.50, 0.13, 0.08]];
  for (const [u, v, s] of spots) { const r = (rnd() - 0.5) * 0.7; at(u, v, r, () => cloud(s, s * 0.085)); if (Math.abs(u - 0.5) > 0.01) at(1 - u, v, -r, () => { c.scale(-1, 1); cloud(s, s * 0.085); }); }
  const tex = new THREE.CanvasTexture(cv);
  tex.flipY = false; tex.colorSpace = THREE.NoColorSpace; tex.anisotropy = 8; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

// ------------------------------------------------------------------ 披风的网格和材质（顶点着色器里对解算结果做双三次插值）
function clothVertexPatch(sh, U) {
  Object.assign(sh.uniforms, U);
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', /* glsl */`#include <common>
      uniform highp sampler2D tCloth; uniform vec2 uClothSize;
      varying vec2 vCapeUv;
      vec3 clothFetch(ivec2 p) { return texelFetch(tCloth, clamp(p, ivec2(0), ivec2(uClothSize) - 1), 0).xyz; }
      void clothW(float t, out vec4 w, out vec4 d) { float t2 = t * t, t3 = t2 * t;
        w = vec4(-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1.0, -1.5 * t3 + 2.0 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2);
        d = vec4(-1.5 * t2 + 2.0 * t - 0.5, 4.5 * t2 - 5.0 * t, -4.5 * t2 + 4.0 * t + 0.5, 1.5 * t2 - t); }
      void clothEval(vec2 c, out vec3 P, out vec3 dU, out vec3 dV) {
        vec2 g = clamp(c, 0.0, 1.0) * (uClothSize - 1.0); vec2 f0 = min(floor(g), uClothSize - 2.0); vec2 fr = g - f0; ivec2 b = ivec2(f0);
        vec4 wx, dx, wy, dy; clothW(fr.x, wx, dx); clothW(fr.y, wy, dy);
        P = vec3(0.0); dU = vec3(0.0); dV = vec3(0.0);
        for (int j = 0; j < 4; j++) { vec3 row = vec3(0.0), drow = vec3(0.0);
          for (int i = 0; i < 4; i++) { vec3 q = clothFetch(b + ivec2(i - 1, j - 1)); row += q * wx[i]; drow += q * dx[i]; }
          P += row * wy[j]; dU += drow * wy[j]; dV += row * dy[j]; }
      }`)
    .replace('#include <beginnormal_vertex>', /* glsl */`
      vCapeUv = uv;
      vec3 clP, clU, clV; clothEval(uv, clP, clU, clV);
      vec3 objectNormal = normalize(cross(clV, clU));`)
    .replace('#include <begin_vertex>', /* glsl */`
      #ifdef WK_CLOTH_DEPTH
        vec3 clP, clU, clV; clothEval(uv, clP, clU, clV);
      #endif
      vec3 transformed = clP;`);
}

function makeCapeMesh(cloth, tPattern) {
  const { NX, NY, N } = cloth;
  const data = new Float32Array(N * 4);
  const tex = new THREE.DataTexture(data, NX, NY, THREE.RGBAFormat, THREE.FloatType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
  const RX = Math.min(96, (NX - 1) * 3), RY = Math.min(150, (NY - 1) * 3);
  const uv = new Float32Array((RX + 1) * (RY + 1) * 2), idx = [];
  for (let j = 0; j <= RY; j++) for (let i = 0; i <= RX; i++) { const k = j * (RX + 1) + i; uv[k * 2] = i / RX; uv[k * 2 + 1] = j / RY; }
  for (let j = 0; j < RY; j++) for (let i = 0; i < RX; i++) { const a = j * (RX + 1) + i, b = a + 1, d = a + RX + 1, e = d + 1; idx.push(a, d, b, b, d, e); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((RX + 1) * (RY + 1) * 3), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array((RX + 1) * (RY + 1) * 3), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.boundingSphere = new THREE.Sphere(V3(0, 1, 1), 5);
  const U = {
    tCloth: { value: tex }, uClothSize: { value: new THREE.Vector2(NX, NY) }, tCapePat: { value: tPattern },
    uCapeDims: { value: V3(cloth.topLen, cloth.hemLen, cloth.L) }, uOuterFront: { value: 1.0 }, uCapeTrans: { value: 0.40 },
    uSilkA: { value: new THREE.Color(0.52, 0.016, 0.024) }, uSilkB: { value: new THREE.Color(0.30, 0.007, 0.016) },
    uLiningA: { value: new THREE.Color(0.20, 0.010, 0.018) }, uLiningB: { value: new THREE.Color(0.40, 0.23, 0.06) }, uThread: { value: new THREE.Color(1.0, 0.68, 0.24) },
  };
  const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.0, side: THREE.DoubleSide, sheen: 0.6, sheenRoughness: 0.45, sheenColor: new THREE.Color(1.0, 0.24, 0.17), specularIntensity: 0.40 });
  mat.onBeforeCompile = (sh) => {
    clothVertexPatch(sh, U);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', /* glsl */`#include <common>
        varying vec2 vCapeUv; uniform sampler2D tCapePat; uniform vec3 uCapeDims; uniform float uOuterFront, uCapeTrans;
        uniform vec3 uSilkA, uSilkB, uLiningA, uLiningB, uThread; float gCapeGold = 0.0;` + HASH_GLSL)
      .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
        vec4 cPat = texture2D(tCapePat, vCapeUv);
        bool cOuter = (gl_FrontFacing ? 1.0 : 0.0) == uOuterFront;
        float cW = uCapeDims.x + (uCapeDims.y - uCapeDims.x) * vCapeUv.y;
        float cEdge = min(min(vCapeUv.x, 1.0 - vCapeUv.x) * cW, (1.0 - vCapeUv.y) * uCapeDims.z);              // 到侧边/下摆的距离（米）
        float cPipe = 1.0 - smoothstep(0.018, 0.022, cEdge);
        float cGold = cOuter ? cPat.r : max(cPipe, step(vCapeUv.y * uCapeDims.z, 0.05));
        float cThread = 0.80 + 0.35 * wkNoise(vCapeUv * vec2(cW, uCapeDims.z) * 900.0);                        // 金线的丝缕闪烁
        float cWeave = 0.93 + 0.07 * wkNoise(vCapeUv * vec2(cW, uCapeDims.z) * vec2(420.0, 60.0));             // 缎面的经纬
        vec3 cSilk = cOuter ? mix(uSilkA, uSilkB, cPat.g * 0.85) : mix(uLiningA, uLiningB, cPat.g * 0.55);
        gCapeGold = cGold;
        diffuseColor.rgb = mix(cSilk * cWeave, uThread * cThread, cGold);`)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = cGold * 0.9;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(cOuter ? 0.64 : 0.66, 0.40, cGold);')
      .replace('#include <lights_physical_pars_fragment>', /* glsl */`#include <lights_physical_pars_fragment>
        // 厚绸逆光：光从背面打过来时透出一层朱红
        void RE_Direct_Cape( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
          RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
          float through = saturate( dot( -geometryNormal, directLight.direction ) );
          reflectedLight.directDiffuse += directLight.color * vec3(0.85, 0.045, 0.035) * RECIPROCAL_PI * through * uCapeTrans * (1.0 - gCapeGold);
        }
        #undef RE_Direct
        #define RE_Direct RE_Direct_Cape`);
  };
  mat.customProgramCacheKey = () => 'wk-cape2';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'WK_Cape'; mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true;
  const dmat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  dmat.defines = { WK_CLOTH_DEPTH: 1 };
  dmat.onBeforeCompile = (sh) => clothVertexPatch(sh, U);
  dmat.customProgramCacheKey = () => 'wk-cape2-depth';
  mesh.customDepthMaterial = dmat;
  return { mesh, U, tex, data };
}

// ------------------------------------------------------------------ 凤翅紫金冠（代码建模）。局部坐标：原点 = 头顶落点，+Y 上，+X 前，单位米（1.5 m 身高的尺寸）
function makeCrown() {
  const g = new THREE.Group(); g.name = 'WK_Crown';
  const gold = new THREE.MeshStandardMaterial({ color: new THREE.Color(1.0, 0.66, 0.22), metalness: 1.0, roughness: 0.24 });
  const purple = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.34, 0.07, 0.36), metalness: 0.9, roughness: 0.28 });
  const red = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.78, 0.03, 0.04), metalness: 0.0, roughness: 0.6 });
  const gem = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.9, 0.04, 0.06), metalness: 0.2, roughness: 0.12, emissive: new THREE.Color(0.10, 0.0, 0.0) });
  const add = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; g.add(m); return m; };
  // 冠体：束腰、上口外翻
  const prof = [[0.060, 0.0], [0.064, 0.010], [0.057, 0.024], [0.049, 0.046], [0.052, 0.066], [0.062, 0.082], [0.066, 0.088], [0.062, 0.093], [0.040, 0.100], [0.018, 0.110], [0.0, 0.112]].map(p => new THREE.Vector2(p[0], p[1]));
  add(new THREE.LatheGeometry(prof, 36), gold);
  const band = add(new THREE.TorusGeometry(0.0615, 0.0075, 10, 40), gold, 0, 0.010, 0); band.rotation.x = Math.PI / 2;
  const waist = add(new THREE.TorusGeometry(0.050, 0.0045, 8, 36), purple, 0, 0.047, 0); waist.rotation.x = Math.PI / 2;
  const beadG = new THREE.SphereGeometry(0.0062, 10, 8);
  for (let k = 0; k < 18; k++) { const a = k / 18 * Math.PI * 2; add(beadG, gold, Math.cos(a) * 0.066, 0.026, Math.sin(a) * 0.066); }
  // 额前牌饰：火焰形金牌 + 红宝石
  const flame = new THREE.Shape(); flame.moveTo(0, 0); flame.bezierCurveTo(0.036, 0.012, 0.030, 0.058, 0.0, 0.098); flame.bezierCurveTo(-0.030, 0.058, -0.036, 0.012, 0, 0);
  const plaqueG = new THREE.ExtrudeGeometry(flame, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 2, curveSegments: 10 });
  const plaque = add(plaqueG, gold, 0.060, 0.010, 0); plaque.rotation.set(0, Math.PI / 2, 0); plaque.rotateX(-0.16); plaque.scale.setScalar(1.15);
  add(new THREE.SphereGeometry(0.0135, 16, 12), gem, 0.076, 0.056, 0);
  for (let k = 1; k < 12; k++) {                                              // 冠沿一圈莲瓣（正前方那片是牌饰）
    const a = k / 12 * Math.PI * 2, pt = add(plaqueG, k % 2 ? gold : purple, Math.cos(a) * 0.066, 0.078, -Math.sin(a) * 0.066);
    pt.rotation.set(0, a + Math.PI / 2, 0); pt.rotateX(-0.42); pt.scale.set(0.50, 0.46, 0.6);
  }
  // 凤翅：每侧四片羽状金片，自下而上向后展开；片心嵌紫金
  const wing = new THREE.Shape(); wing.moveTo(0, 0); wing.bezierCurveTo(0.03, 0.026, 0.11, 0.030, 0.17, 0.004); wing.bezierCurveTo(0.11, -0.006, 0.04, -0.014, 0, 0);
  const wingG = new THREE.ExtrudeGeometry(wing, { depth: 0.004, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0015, bevelSegments: 1, curveSegments: 10 });
  for (const sd of [-1, 1]) for (let k = 0; k < 4; k++) {
    const piv = new THREE.Group(); piv.position.set(0.012 - 0.008 * k, 0.026 + 0.014 * k, sd * 0.058);
    piv.rotation.order = 'YZX'; piv.rotation.y = Math.PI - sd * (0.42 + 0.05 * k);                // 朝后并向外撇开
    piv.rotation.z = 0.16 + 0.27 * k;                                                               // 层层上扬
    const sc = 1.0 - 0.10 * k;
    const a = new THREE.Mesh(wingG, gold); a.scale.set(sc, sc, 1); a.position.z = -0.002; a.castShadow = true; piv.add(a);
    const b = new THREE.Mesh(wingG, purple); b.scale.set(sc * 0.62, sc * 0.52, 1.5); b.position.set(0.028 * sc, 0.002, -0.003); piv.add(b);
    g.add(piv);
  }
  // 顶珠
  add(new THREE.SphereGeometry(0.016, 16, 12), gold, 0, 0.126, 0);
  add(new THREE.ConeGeometry(0.007, 0.03, 10), gold, 0, 0.152, 0);
  // 翎管和绒球（翎子从这里出来）
  const roots = [];
  for (const sd of [-1, 1]) {
    const dir = V3(-0.30, 0.88, sd * 0.33).normalize();
    const base = V3(-0.022, 0.080, sd * 0.050);
    const tube = add(new THREE.CylinderGeometry(0.008, 0.011, 0.06, 10), gold, base.x + dir.x * 0.03, base.y + dir.y * 0.03, base.z + dir.z * 0.03);
    tube.quaternion.setFromUnitVectors(AY, dir);
    add(new THREE.SphereGeometry(0.0145, 14, 10), red, base.x - 0.002, base.y + 0.002, base.z + sd * 0.014);
    roots.push({ pos: base.clone().addScaledVector(dir, 0.055), dir, side: sd });
  }
  mergeByMaterial(g);
  return { group: g, roots };
}

// ------------------------------------------------------------------ 雉鸡翎：两根带弹性的长翎子
function makeFeathers(count, NODES) {
  const SEG = 4, M = (NODES - 1) * SEG + 1;                     // 渲染时每段再细分
  const pos = new Float32Array(count * M * 3 * 3), nor = new Float32Array(count * M * 3 * 3), uv = new Float32Array(count * M * 3 * 2), idx = [];
  for (let f = 0; f < count; f++) for (let k = 0; k < M; k++) {
    const b = (f * M + k) * 3;
    for (let e = 0; e < 3; e++) { uv[(b + e) * 2] = e * 0.5; uv[(b + e) * 2 + 1] = k / (M - 1); }
    if (k < M - 1) { const n = b + 3; idx.push(b, n, b + 1, b + 1, n, n + 1, b + 1, n + 1, b + 2, b + 2, n + 1, n + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx); geo.boundingSphere = new THREE.Sphere(V3(0, 2, 0.5), 5);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0.0, side: THREE.DoubleSide });
  mat.alphaToCoverage = (QUALITY.msaa || 0) > 0;
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vFUv;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvFUv = uv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFUv;\n' + HASH_GLSL)
      .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
        float fx = abs(vFUv.x - 0.5) * 2.0, fv = vFUv.y;
        float fBarb = wkNoise(vec2(vFUv.x * 6.0 + fv * 900.0, fv * 260.0 - fx * 40.0));                       // 羽枝
        float fCut = step(0.86, wkNoise(vec2(fv * 55.0, floor(vFUv.x * 2.0)))) * smoothstep(0.35, 0.9, fx);     // 偶尔的豁口
        float fAlpha = (1.0 - smoothstep(0.74 + 0.22 * fBarb, 0.98, fx)) * (1.0 - fCut) * (1.0 - smoothstep(0.985, 1.0, fv));
        if (fAlpha < 0.35) discard;
        diffuseColor.a = fAlpha;
        float fBar = fract(fv * 46.0 - fx * 0.42);                                                             // 人字形的横斑
        float fDark = smoothstep(0.50, 0.60, fBar) * (1.0 - smoothstep(0.90, 0.98, fBar));
        vec3 fBase = mix(vec3(0.50, 0.30, 0.10), vec3(0.92, 0.80, 0.56), smoothstep(0.0, 0.9, fv));            // 根部棕黄，往梢部变浅
        fBase *= 0.86 + 0.28 * fBarb;
        vec3 fCol = mix(fBase, vec3(0.045, 0.028, 0.018), fDark * 0.92);
        fCol = mix(fCol, vec3(0.93, 0.86, 0.66), 1.0 - smoothstep(0.03, 0.09, fx));                            // 羽轴
        diffuseColor.rgb = fCol;`)
      .replace('#include <lights_physical_pars_fragment>', /* glsl */`#include <lights_physical_pars_fragment>
        void RE_Direct_Feather( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
          RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
          reflectedLight.directDiffuse += directLight.color * material.diffuseColor * RECIPROCAL_PI * saturate( dot( -geometryNormal, directLight.direction ) ) * 0.7;
        }
        #undef RE_Direct
        #define RE_Direct RE_Direct_Feather`);
  };
  mat.customProgramCacheKey = () => 'wk-feather';
  const mesh = new THREE.Mesh(geo, mat); mesh.name = 'WK_Feathers'; mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = false;
  const sim = [];
  for (let f = 0; f < count; f++) sim.push({ p: new Float32Array(NODES * 3), v: new Float32Array(NODES * 3), restLocal: [], seg: new Float32Array(NODES), tgt: new Float32Array(NODES * 3), side: 1 });
  return { mesh, geo, sim, NODES, SEG, M };
}

// ------------------------------------------------------------------ 两段骨骼的反解（世界空间）。调用前相关骨骼的 matrixWorld 要是新的
const _ia = V3(), _ib = V3(), _ic = V3(), _id = V3(), _ip = V3(), _ik = V3(), _in1 = V3(), _in2 = V3(), _it = V3();
const _iq1 = new THREE.Quaternion(), _iq2 = new THREE.Quaternion(), _iwu = new THREE.Quaternion(), _iwl = new THREE.Quaternion(), _iwe = new THREE.Quaternion(), _iwp = new THREE.Quaternion();
/** upper/lower/end：三根骨骼；target：末端目标（世界）；pole：肘/膝的朝向提示（世界方向）；w：0..1 混合；keepEnd：末端骨骼保持原来的世界朝向（脚掌不跟着小腿转） */
function ik2(upper, lower, end, target, pole, w, keepEnd) {
  if (w <= 0.001) return;
  _ia.setFromMatrixPosition(upper.matrixWorld); _ib.setFromMatrixPosition(lower.matrixWorld); _ic.setFromMatrixPosition(end.matrixWorld);
  const l1 = _ia.distanceTo(_ib), l2 = _ib.distanceTo(_ic);
  _it.copy(_ic).lerp(target, w);
  _id.subVectors(_it, _ia); let dist = _id.length(); _id.multiplyScalar(1 / (dist || 1e-6));
  dist = clamp(dist, Math.abs(l1 - l2) * 1.02 + 1e-4, (l1 + l2) * 0.998);
  // 现有的肘方向（相对肩-腕连线的垂直分量）与提示方向混合
  _in1.subVectors(_ic, _ia).normalize(); _ip.subVectors(_ib, _ia); _ip.addScaledVector(_in1, -_ip.dot(_in1));
  if (_ip.lengthSq() < 1e-8) _ip.copy(pole); _ip.normalize();
  _ip.lerp(pole, w); _ip.addScaledVector(_id, -_ip.dot(_id));
  if (_ip.lengthSq() < 1e-8) { _ip.set(0, 1, 0).addScaledVector(_id, -_id.y); } _ip.normalize();
  const x = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist), hh = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  _ik.copy(_ia).addScaledVector(_id, x).addScaledVector(_ip, hh);
  upper.getWorldQuaternion(_iwu); lower.getWorldQuaternion(_iwl); end.getWorldQuaternion(_iwe); upper.parent.getWorldQuaternion(_iwp);
  _in1.subVectors(_ib, _ia).normalize(); _in2.subVectors(_ik, _ia).normalize();
  _iq1.setFromUnitVectors(_in1, _in2);
  _in1.subVectors(_ic, _ib).applyQuaternion(_iq1).normalize(); _in2.copy(_ia).addScaledVector(_id, dist).sub(_ik).normalize();
  _iq2.setFromUnitVectors(_in1, _in2);
  _iwu.premultiply(_iq1);                                          // 新的上段世界朝向
  upper.quaternion.copy(_iwp).invert().multiply(_iwu);
  _iwl.premultiply(_iq1).premultiply(_iq2);                        // 新的下段世界朝向
  lower.quaternion.copy(_iwu).invert().multiply(_iwl);
  if (keepEnd) end.quaternion.copy(_iwl).invert().multiply(_iwe);
}

// ------------------------------------------------------------------ 主入口
export function createCharacter(app) {
  const group = new THREE.Group(); group.name = 'Wukong';
  const inner = new THREE.Group(); inner.rotation.y = Math.PI / 2; inner.scale.setScalar(HERO_SCALE);      // 模型的 +X（前）转到外层的 -Z，并整体放大
  group.add(inner);
  app.scene.add(group);

  const base = app.assets + 'char/';
  const hi = QUALITY_NAME !== 'low';
  const tl = new THREE.TextureLoader();
  const loadTex = (file, srgb) => tl.loadAsync(base + file).then(t => {
    t.flipY = false; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8; t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  });

  // 平滑后的输入状态
  const S = { speed: 45, boost: 0, bank: 0, pitch: 0, turn: 0, flip: 0, accel: 0 };
  let time = 0, furTime = 0, loaded = false, lastSpeed = 45;
  let root = null, armNode = null, bones = null, rest = null, headBone = null, staffNode = null;
  let bodyU = null, furU = null, cape = null, cloth = null, feathers = null, crown = null, furMesh = null, furMax = 18;
  const headLocal = V3();
  const armQ = new THREE.Quaternion(), armQInv = new THREE.Quaternion();
  let armScale = 1;
  const A = {};                                 // 姿态库用到的挂点（骨骼局部坐标）
  let seed = 20261; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  // ---- 动作导演：在几个关键姿态之间缓动切换
  const ACTS = {
    lookout: { dur: [3.5, 7.0] }, akimbo: { dur: [3.0, 5.5] }, shoulder: { dur: [4.0, 7.0] }, scratch: { dur: [1.9, 2.7] }, glance: { dur: [1.5, 2.3] },
    laugh: { dur: [2.3, 3.2] }, point: { dur: [1.3, 1.5], once: true }, staff: { dur: [2.5, 2.5], once: true },
  };
  const CLIP_ALIAS = { lookout: 'look', laugh: 'proud' };       // 姿态名 → 清单里的片段名
  const W = { lookout: 1, akimbo: 0, shoulder: 0, scratch: 0, glance: 0, laugh: 0, point: 0, staff: 0, surf: 0 };
  const dir8 = { act: 'lookout', t: 0, dur: 5, side: 1, prev: 'lookout' };
  const PT = {}, PD = {}; for (const n in ACTS) { PT[n] = 0; PD[n] = 3; }     // 每个姿态自己的计时和时长（淡出过程中不被下一个动作改掉）
  let glanceSide = 1;
  let hitT = 9, hitSide = 1;
  function setAct(name, dur) {
    const a = ACTS[name]; if (!a) return false;
    dir8.prev = dir8.act; dir8.act = name; dir8.t = 0; dir8.dur = dur ?? lerp(a.dur[0], a.dur[1], rnd()); dir8.side = rnd() < 0.5 ? -1 : 1;
    if (W[name] < 0.05) { PT[name] = 0; if (name === 'glance') glanceSide = dir8.side; } PD[name] = Math.max(PT[name] + 1.2, dir8.dur);
    anim.onAct(name);
    return true;
  }
  function nextAct() {
    if (dir8.act === 'staff') return setAct('shoulder');
    if (dir8.act !== 'lookout' && rnd() < 0.62) return setAct('lookout');
    const pool = [['glance', 0.26], ['akimbo', 0.20], ['shoulder', 0.18], ['scratch', 0.18], ['laugh', 0.09], ['staff', 0.09]].filter(p => p[0] !== dir8.act && p[0] !== dir8.prev);
    let r = rnd() * pool.reduce((s, p) => s + p[1], 0);
    for (const p of pool) { r -= p[1]; if (r <= 0) return setAct(p[0]); }
    return setAct('lookout');
  }
  function play(name) {
    if (name === 'hit') { hitT = 0; hitSide = rnd() < 0.5 ? -1 : 1; if (cloth) for (let k = cloth.NX * 3; k < cloth.N * 3; k++) cloth.vel[k] *= -0.4; return true; }
    const al = { look: 'lookout', proud: 'laugh' }[name] || name;
    return setAct(al);
  }

  // ---- 骨骼片段（可选）：assets/char/anims/manifest.json 里列出的片段按名字和姿态对应，有就播片段，没有就用程序化姿态
  const anim = {
    mixer: null, actions: new Map(), cur: null, w: 0, target: 0, pending: undefined,
    add(clip, loop = true) {
      if (!root) return;
      if (!this.mixer) this.mixer = new THREE.AnimationMixer(root);
      clip.tracks = clip.tracks.filter(t => t.name.endsWith('.quaternion'));                    // 只要旋转：位移/缩放轨会和我们的骨架比例打架
      for (const t of clip.tracks) t.name = t.name.replace(/[:\s]/g, '');
      const act = this.mixer.clipAction(clip);
      act.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); act.clampWhenFinished = true;
      this.actions.set(clip.name, act);
    },
    has(name) { return this.actions.has(name) || this.actions.has(CLIP_ALIAS[name]); },
    onAct(name) { this.pending = name; },
    apply(name) {
      const act = this.actions.get(name) || this.actions.get(CLIP_ALIAS[name]) || null;
      if (act === this.cur) { if (act) act.reset(); return; }
      if (act) { act.reset().setEffectiveWeight(1).play(); if (this.cur) this.cur.crossFadeTo(act, 0.5, false); else act.fadeIn(0.5); }
      else if (this.cur) this.cur.fadeOut(0.5);
      this.cur = act; this.target = act ? 1 : 0;
    },
  };
  async function loadClips() {
    try {
      const r = await fetch(base + 'anims/manifest.json'); if (!r.ok) return;
      const man = await r.json(); const list = Array.isArray(man) ? man : (man.clips || []);
      const files = new Set(list.map(c => c.file || man.file).filter(Boolean));
      for (const f of files) {
        const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
        const g = await loader.loadAsync(base + 'anims/' + f);
        for (const clip of g.animations) {
          const info = list.find(c => c.name === clip.name && (c.file || man.file) === f); if (!info) continue;
          anim.add(clip, info.loop !== false);
        }
      }
    } catch (e) { console.warn('角色动作片段没有加载（改用程序化姿态）：', e.message); }
  }

  const ready = (async () => {
    const [gltf, tColor, tNormal, tOrm, meta] = await Promise.all([
      new GLTFLoader().loadAsync(base + 'wukong.glb'),
      loadTex(hi ? 'body_color_4k.jpg' : 'body_color_2k.jpg', true),
      loadTex(hi ? 'body_normal_4k.jpg' : 'body_normal_2k.jpg', false),
      loadTex('body_orm_2k.jpg', false),
      fetch(base + 'meta.json').then(r => r.json()),
    ]);
    root = gltf.scene;
    root.updateMatrixWorld(true);                                     // 此时 root 在原点：matrixWorld 就是模型空间
    let body = null, furBase = null;
    root.traverse(o => {
      if (o.isSkinnedMesh && o.name === 'WK_Body') body = o;
      else if (o.isSkinnedMesh && o.name === 'WK_FurBase') furBase = o;
      else if (o.name === 'WK_Staff') staffNode = o;
    });
    armNode = root.getObjectByName('WK_Armature');
    armNode.getWorldQuaternion(armQ); armQInv.copy(armQ).invert();
    armScale = armNode.getWorldScale(_v1).x;

    // ---- 身体（黄金甲）
    bodyU = { uGold: { value: new THREE.Vector4(0.20, 0.46, 0.92, 2.5) }, uGoldTint: { value: new THREE.Color(1.0, 0.70, 0.27) }, uCloth: { value: new THREE.Vector2(0.75, 3.6) }, uBodyDbg: { value: 0 } };
    body.material = makeBodyMaterial(tColor, tNormal, tOrm, bodyU);
    body.castShadow = true; body.receiveShadow = true; body.frustumCulled = false;

    // ---- 毛发壳层
    const toLocal = (x, y, z) => V3(x, y, z).applyQuaternion(armQInv);
    const fl = meta.fur_len;
    furU = {
      uShells: { value: QUALITY.furShells || 18 }, uFurTime: { value: 0 }, uWindAmp: { value: 0.2 }, uWindPush: { value: 0.3 }, uFurScale: { value: 1 / armScale },
      uFurLen: { value: V3(fl.arm, fl.tiger, fl.head).multiplyScalar(1.05) },
      uComb: { value: toLocal(-0.38, -0.24, 0.0) }, uWindDir: { value: toLocal(-1, -0.12, 0).normalize() },
      uDensity: { value: (QUALITY.msaa || 0) > 0 ? 3400 : 2200 }, uFurAO: { value: 0.38 }, uA2C: { value: (QUALITY.msaa || 0) > 0 ? 1 : 0 }, uFurTrans: { value: V3(0.9, 5.0, 0.7) },
    };
    const fur = makeFur(furBase, tColor, tOrm, furU);
    furMesh = fur; furMax = furU.uShells.value;
    furBase.parent.add(fur);
    fur.bind(body.skeleton, body.bindMatrix);
    furBase.parent.remove(furBase);

    // ---- 金箍棒：乌铁身、亮金箍
    if (staffNode) {
      const iron = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.020, 0.018, 0.020), metalness: 0.92, roughness: 0.42 });
      const gold = new THREE.MeshStandardMaterial({ color: new THREE.Color(1.0, 0.70, 0.26), metalness: 1.0, roughness: 0.24 });
      let k = 0;
      staffNode.traverse(o => { if (o.isMesh) { o.material = (k++ === 0) ? iron : gold; o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
    }

    // ---- 骨骼与静止姿态（模型空间）
    bones = {}; rest = {};
    for (const b of body.skeleton.bones) {
      const n = b.name.replace(/^mixamorig[:_]?/, '');
      bones[n] = b;
      const wq = b.getWorldQuaternion(new THREE.Quaternion());
      rest[n] = { q: b.quaternion.clone(), qi: b.quaternion.clone().invert(), p: b.position.clone(), wq, wqi: wq.clone().invert(), wp: b.getWorldPosition(V3()) };
    }
    headBone = bones.Head;
    headLocal.fromArray(meta.head_center); headBone.worldToLocal(headLocal);
    const anchor = (bone, x, y, z) => bones[bone].worldToLocal(V3(x, y, z));           // 模型空间的点 → 骨骼局部坐标

    // ---- 头部形状（给金冠定位）：取受 Head 骨骼控制的顶点
    const hIdx = body.skeleton.bones.indexOf(bones.Head), tIdx = body.skeleton.bones.indexOf(bones.HeadTop_End);
    const P = body.geometry.attributes.position, SI = body.geometry.attributes.skinIndex, SW = body.geometry.attributes.skinWeight;
    const hv = [];
    body.skeleton.update();
    for (let i = 0; i < P.count; i += 2) {
      let w = 0; for (let k = 0; k < 4; k++) { const id = SI.getComponent(i, k); if (id === hIdx || id === tIdx) w += SW.getComponent(i, k); }
      if (w > 0.85) hv.push(body.getVertexPosition(i, V3()).applyMatrix4(body.matrixWorld));        // 蒙皮后的位置（模型空间）
    }
    hv.sort((a, b) => b.y - a.y);
    const topN = hv.slice(0, Math.max(8, Math.floor(hv.length * 0.04)));
    const headTop = topN.reduce((s, v) => s.add(v), V3()).multiplyScalar(1 / topN.length);
    const headC = hv.reduce((s, v) => s.add(v), V3()).multiplyScalar(1 / hv.length);
    const headInfo = { top: headTop.toArray().map(v => +v.toFixed(3)), center: headC.toArray().map(v => +v.toFixed(3)), n: hv.length, maxY: +hv[0].y.toFixed(3) };

    // ---- 金冠 + 翎子
    crown = makeCrown();
    {
      const up = V3(-0.20, 1.0, 0.0).normalize();                                        // 冠略向后仰
      const fwd = V3(1, 0, 0).addScaledVector(up, -up.x).normalize(), right = V3().crossVectors(fwd, up).normalize();
      const M = new THREE.Matrix4().makeBasis(fwd, up, right).scale(V3(1.32, 1.32, 1.32));
      M.setPosition(headTop.x - 0.016, hv[0].y - 0.044, headC.z * 0.5 + headTop.z * 0.5);
      crown.group.applyMatrix4(_m1.copy(headBone.matrixWorld).invert().multiply(M));
      headBone.add(crown.group);
      crown.M = M;
    }
    const FN = 16, FLEN = 1.30;                                                           // 翎子长度（模型尺度；放大后约 1.47 m）
    feathers = makeFeathers(2, FN);
    feathers.mesh.matrixAutoUpdate = true; group.add(feathers.mesh);
    crown.roots.forEach((r, f) => {
      const sim = feathers.sim[f]; sim.side = r.side;
      const p = r.pos.clone().applyMatrix4(crown.M), d = r.dir.clone().transformDirection(crown.M);
      // 静止形状：先向上向外，再朝后弯成一道弧
      const bend = V3(-1, -0.42, r.side * 0.10).normalize();
      for (let i = 0; i < FN; i++) {
        sim.restLocal.push(headBone.worldToLocal(p.clone()));
        const s = i / (FN - 1);
        const dd = d.clone().lerp(bend, Math.pow(s, 1.25) * 0.92).normalize();
        sim.seg[i] = FLEN / (FN - 1);
        p.addScaledVector(dd, FLEN / (FN - 1));
      }
    });

    // ---- 披风：钉在肩背上的一条弧线（Spine2 局部坐标）
    const NXc = hi ? 23 : 19, NYc = hi ? 37 : 29;
    const sL = rest.LeftArm.wp, sR = rest.RightArm.wp;
    const across = V3().subVectors(sR, sL), span = across.length(); across.normalize();
    const back = V3().crossVectors(across, AY).normalize();                               // 指向背后
    const pinsModel = [];
    for (let i = 0; i < NXc; i++) {
      const u = i / (NXc - 1), arc = 4 * u * (1 - u);
      pinsModel.push(V3().lerpVectors(sL, sR, u).addScaledVector(across, (u - 0.5) * 0.085).addScaledVector(back, 0.075 + 0.105 * arc).addScaledVector(AY, 0.045 + 0.030 * arc));
    }
    let topLen = 0; for (let i = 1; i < NXc; i++) topLen += pinsModel[i].distanceTo(pinsModel[i - 1]);
    topLen *= HERO_SCALE;
    const pinsLocal = pinsModel.map(p => bones.Spine2.worldToLocal(p.clone()));
    cloth = createCloth(NXc, NYc, 2.02, topLen, 2.55);
    cape = makeCapeMesh(cloth, makeCapePattern(topLen, 2.55, 2.02));
    cape.pinsLocal = pinsLocal;
    group.add(cape.mesh);
    // 肩扣（兽面圆护）+ 领口金链，把披风"扣"在甲上
    {
      const gold = new THREE.MeshStandardMaterial({ color: new THREE.Color(1.0, 0.68, 0.24), metalness: 1.0, roughness: 0.25 });
      const gem = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.85, 0.04, 0.05), metalness: 0.2, roughness: 0.15 });
      const g = new THREE.Group(); g.name = 'WK_CapeClasp';
      for (const i of [1, NXc - 2]) {
        const p = pinsModel[i], out = V3().subVectors(p, V3().lerpVectors(sL, sR, 0.5)).setY(0.25).normalize().addScaledVector(back, 0.5).normalize();
        const boss = new THREE.Group(); boss.position.copy(p).addScaledVector(out, 0.012); boss.quaternion.setFromUnitVectors(AZ, out);
        const disc = new THREE.Mesh(new THREE.SphereGeometry(0.052, 24, 14), gold); disc.scale.set(1, 1, 0.42); boss.add(disc);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.008, 10, 28), gold); boss.add(ring);
        const jw = new THREE.Mesh(new THREE.SphereGeometry(0.017, 14, 10), gem); jw.position.z = 0.020; boss.add(jw);
        for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2, s = new THREE.Mesh(new THREE.SphereGeometry(0.0075, 8, 6), gold); s.position.set(Math.cos(a) * 0.034, Math.sin(a) * 0.034, 0.016); boss.add(s); }
        boss.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        g.add(boss);
      }
      const curve = new THREE.CatmullRomCurve3(pinsModel.filter((_, i) => i % 3 === 0 || i === NXc - 1).map(p => p.clone().addScaledVector(AY, 0.004)));
      const collar = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.013, 8, false), gold); collar.castShadow = true; g.add(collar);
      mergeByMaterial(g);
      g.applyMatrix4(_m1.copy(bones.Spine2.matrixWorld).invert());
      bones.Spine2.add(g);
    }

    // ---- 布料的碰撞体（跟着骨骼）。半径是模型尺度的米
    const colS = [], colC = [];
    const sphere = (bone, x, y, z, r) => colS.push({ bone: bones[bone], local: anchor(bone, x, y, z), r: r * HERO_SCALE });
    const capsule = (a, b, r, la, lb) => colC.push({ a: bones[a], b: bones[b], la: la || V3(), lb: lb || V3(), r: r * HERO_SCALE });
    sphere('Hips', -0.10, 0.74, 0.02, 0.205); sphere('Hips', -0.16, 0.62, 0.0, 0.205); sphere('Spine', -0.07, 0.87, 0.01, 0.195); sphere('Spine1', -0.05, 0.99, 0.0, 0.205); sphere('Spine2', -0.035, 1.10, 0.0, 0.205);
    sphere('Head', meta.head_center[0] - 0.02, meta.head_center[1], meta.head_center[2], 0.150);
    capsule('LeftArm', 'RightArm', 0.105); capsule('LeftUpLeg', 'LeftLeg', 0.115); capsule('RightUpLeg', 'RightLeg', 0.115); capsule('LeftLeg', 'LeftFoot', 0.095); capsule('RightLeg', 'RightFoot', 0.095);
    capsule('RightArm', 'RightForeArm', 0.085); capsule('RightForeArm', 'RightHand', 0.07); capsule('LeftArm', 'LeftForeArm', 0.085);
    cloth.colS = colS; cloth.colC = colC;
    cloth.E = {
      pin: new Float32Array(NXc * 3), pinA: new Float32Array(NXc * 3), pinB: new Float32Array(NXc * 3), sph: new Float32Array(colS.length * 4), nsph: colS.length,
      cap: new Float32Array((colC.length + 1) * 8), ncap: colC.length + (staffNode ? 1 : 0),
      bx: 0, by: 0, bz: 0, br2: 1.7, ncapBody: colC.length, S2: 0, kD: 0, guide: 0, gdamp: 0, glat: 0, gspread: 0.9, tdx: 0, tdy: 0, tdz: 1,
      t: 0, U: 10, turb: 0.1, kN: 1.6, kT: 0.22, damp: 1, gx: 0, gy: -9.0, gz: 0, ax: 0, ay: 0, az: 0, cx: 0, cy: 0, cz: 0, spread: 0, floorY: -10,
      wdx: 0, wdy: 0, wdz: 1, wux: 0, wuy: 1, wuz: 0, wsx: 1, wsy: 0, wsz: 0, A1: 0, A2: 0, A3: 0, k1: 5, k2: 11, k3: 21, w1: 7, w2: 15, w3: 40,
    };

    // ---- 姿态库的挂点（数值是模型空间的点，按静止姿态换算进骨骼局部）
    A.handInHead = headBone.worldToLocal(rest.LeftHand.wp.clone());                       // 搭凉棚：左腕相对头的位置
    A.hipL = anchor('Hips', -0.015, 0.875, -0.235);                                       // 叉腰：左腕落在左胯
    A.shoulderR = anchor('Spine2', 0.175, 1.215, 0.225);                                  // 扛棒：右腕在右肩前
    A.scratch = anchor('Head', 0.19, 1.435, -0.155);                                      // 挠头：左腕到左耳上方
    A.surfL = anchor('Spine2', 0.40, 1.00, -0.36); A.surfR = anchor('Hips', -0.20, 0.87, 0.36);
    A.pointR = anchor('Spine2', 0.52, 1.07, 0.36); A.spinR = anchor('Spine2', 0.26, 1.03, 0.52);
    A.footL = rest.LeftFoot.wp.clone(); A.footR = rest.RightFoot.wp.clone();              // 脚踝（模型空间，固定在云面上）
    A.poleLegL = V3().subVectors(rest.LeftLeg.wp, rest.LeftUpLeg.wp).add(V3().subVectors(rest.LeftLeg.wp, rest.LeftFoot.wp)).normalize();
    A.poleLegR = V3().subVectors(rest.RightLeg.wp, rest.RightUpLeg.wp).add(V3().subVectors(rest.RightLeg.wp, rest.RightFoot.wp)).normalize();
    A.poleArmL = V3().subVectors(rest.LeftForeArm.wp, rest.LeftArm.wp).add(V3().subVectors(rest.LeftForeArm.wp, rest.LeftHand.wp)).normalize();
    if (staffNode) { staffNode.updateWorldMatrix(true, false); A.staffAxis0 = V3(0, 1, 0).transformDirection(staffNode.matrixWorld); A.staffLen = 0.975 * staffNode.getWorldScale(_v1).z; }

    inner.add(root);
    loaded = true;
    await loadClips();
    wkDebug = { headInfo, topLen, bones, rest, anim, cloth, feathers, crown, body, bodyU, perf, CAPE,
      /** 披风现状：与水平面的夹角（度，领口中点 → 下摆中点）、下摆宽度、下摆相对脚底的高度（米） */
      capeStats() {
        const P = cloth.pos, NX = cloth.NX, NY = cloth.NY, m = Math.floor(NX / 2), a = m * 3, b = ((NY - 1) * NX + m) * 3, l = (NY - 1) * NX * 3, r = ((NY - 1) * NX + NX - 1) * 3;
        const dx = P[b] - P[a], dy = P[b + 1] - P[a + 1], dz = P[b + 2] - P[a + 2];
        return { angle: +(Math.atan2(-dy, Math.hypot(dx, dz)) * 180 / Math.PI).toFixed(1), hemWidth: +Math.hypot(P[r] - P[l], P[r + 1] - P[l + 1], P[r + 2] - P[l + 2]).toFixed(2), hemY: +P[b + 1].toFixed(2), reach: +Math.hypot(dx, dy, dz).toFixed(2) };
      } };
  })();
  let wkDebug = null;
  const CAPE = { windGain: 1.5, wave: 1.0 };                                // 披风总调节：风力倍率、波浪倍率
  const perf = { pose: 0, ik: 0, sim: 0 };

  // 在模型空间里给骨骼叠一个增量旋转：lean = 前倾（弧度），roll = 向右侧倾，yaw = 向左转。叠在骨骼当前的局部旋转上（片段或静止姿态）
  function rot(name, lean, roll, yaw) {
    const b = bones[name], r = rest[name];
    if (!b || (lean === 0 && roll === 0 && yaw === 0)) return;
    _q1.setFromAxisAngle(AZ, -lean); _q2.setFromAxisAngle(AX, roll); _q3.setFromAxisAngle(AY, yaw);
    _q1.multiply(_q2).multiply(_q3);
    _q4.copy(r.q).multiply(r.wqi).multiply(_q1).multiply(r.wq).multiply(r.qi);
    b.quaternion.premultiply(_q4);
  }

  // 姿态累加器
  const ROT_BONES = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head'];
  const acc = { hip: V3(), rots: {}, L: [], R: [], axis: V3(), axisW: 0 };
  for (const n of ROT_BONES) acc.rots[n] = [0, 0, 0];
  const addRot = (n, w, l, r = 0, y = 0) => { const a = acc.rots[n]; a[0] += l * w; a[1] += r * w; a[2] += y * w; };
  const addArm = (side, w, bone, local, px, py, pz, ox = 0, oy = 0, oz = 0) => { if (w > 0.001) acc[side].push([w, bones[bone], local, px, py, pz, ox, oy, oz]); };
  const addAxis = (w, x, y, z) => { if (w > 0.001) { acc.axis.addScaledVector(_v1.set(x, y, z).normalize(), w); acc.axisW += w; } };

  const ikTmp = { tgt: V3(), pole: V3() };
  function solveArm(side, upper, lower, end, items, extraW) {
    let ws = 0; ikTmp.tgt.set(0, 0, 0); ikTmp.pole.set(0, 0, 0);
    for (const it of items) {
      ws += it[0];
      _v1.copy(it[2]).applyMatrix4(it[1].matrixWorld); if (it[6] || it[7] || it[8]) _v1.add(_v2.set(it[6], it[7], it[8]).transformDirection(root.matrixWorld).multiplyScalar(_v3.set(it[6], it[7], it[8]).length() * HERO_SCALE));
      ikTmp.tgt.addScaledVector(_v1, it[0]);
      ikTmp.pole.addScaledVector(_v2.set(it[3], it[4], it[5]).normalize().transformDirection(root.matrixWorld), it[0]);
    }
    if (ws < 0.002) return 0;
    const w = Math.min(1, ws) * extraW;
    ikTmp.tgt.multiplyScalar(1 / ws); ikTmp.pole.normalize();
    ik2(upper, lower, end, ikTmp.tgt, ikTmp.pole, w, false);
    return w;
  }

  const simO = V3(), simOPrev = V3(), vWorld = V3(), vPrev = V3(), aFrame = V3();
  const G3 = new THREE.Matrix3(), G3i = new THREE.Matrix3();
  let simInit = false, flipHold = 0, extFwd = null;
  const heading = V3(0, 0, -1);

  function update(dt, st = {}) {
    if (!loaded) return;
    const tu0 = performance.now();
    dt = Math.min(dt, 0.05);
    time += dt;
    const spIn = st.speed ?? 45;
    S.accel = smooth(S.accel, (spIn - lastSpeed) / Math.max(dt, 1e-4), 6, dt); lastSpeed = spIn;
    S.speed = smooth(S.speed, spIn, 4, dt);
    S.boost = smooth(S.boost, st.boost ?? 0, 5, dt);
    S.bank = smooth(S.bank, st.bank ?? 0, 6, dt);
    S.pitch = smooth(S.pitch, st.pitch ?? 0, 6, dt);
    S.turn = smooth(S.turn, st.turn ?? 0, 5, dt);
    S.flip = st.flip ?? 0;
    extFwd = st.forward || (st.velocity && st.velocity.lengthSq() > 1 ? st.velocity : null);
    const sp = S.speed, spN = Math.min(1.6, sp / 45), bo = S.boost, bank = S.bank, pit = S.pitch;
    const tuck = Math.pow(Math.sin(Math.PI * clamp(S.flip, 0, 1)), 0.8);                  // 翻筋斗中段团身最紧
    const shake = (0.25 + 0.75 * bo) * Math.min(1, sp / 60);

    // ---- 导演：选姿态、算权重
    dir8.t += dt; for (const n in PT) PT[n] += dt;
    if (dir8.t > dir8.dur) nextAct();
    W.surf = smooth(W.surf, sstep(0.25, 0.8, bo), 5, dt);
    anim.w = smooth(anim.w, anim.target, 4, dt);
    const calm = (1 - W.surf) * (1 - tuck) * (1 - anim.w);                                // 冲刺/翻筋斗/播片段时，姿态库让位
    const calmAct = (1 - tuck) * (1 - anim.w);                                            // 一次性动作（举棒、棍花）冲刺时也能做
    for (const n in ACTS) W[n] = smooth(W[n], n === dir8.act ? 1 : 0, n === dir8.act ? 4.2 : 5.2, dt);
    hitT += dt;
    const hitIn = 1 - Math.exp(-38 * hitT);                                               // 受击也要有两三帧的起势，否则像穿帮
    const hit = hitT < 1.2 ? hitIn * Math.exp(-5.5 * hitT) * Math.cos(13 * hitT) : 0, hitE = hitT < 1.2 ? hitIn * Math.exp(-4 * hitT) : 0;

    // ---- 骨骼回到静止姿态，再让片段（如果有）写入
    for (const n in rest) { const b = bones[n]; b.quaternion.copy(rest[n].q); }
    bones.Hips.position.copy(rest.Hips.p);
    // 冲刺时切到驾云片段 surf（有的话），冲刺结束回到当前待机动作；翻筋斗时片段淡出交给团身
    if (anim.actions.has('surf')) {
      const wantSurf = bo > 0.45 && tuck < 0.05 && !(ACTS[dir8.act] && ACTS[dir8.act].once && W[dir8.act] > 0.3);
      if (wantSurf && !anim.surfOn) { anim.surfOn = true; anim.pending = 'surf'; }
      else if (!wantSurf && anim.surfOn) { anim.surfOn = false; anim.pending = dir8.act; }
      else if (anim.surfOn && anim.pending !== undefined && anim.pending !== 'surf') anim.pending = undefined;     // 冲刺中不被待机轮换打断
    }
    if (anim.pending !== undefined) { const n = anim.pending; anim.pending = undefined; anim.apply(n); }
    if (tuck > 0.05 && anim.cur) { anim.cur.fadeOut(0.25); anim.cur = null; anim.target = 0; anim.surfOn = false; }
    if (anim.mixer) anim.mixer.update(dt);

    // ---- 第一阶段：躯干（挺拔的基础体态 + 待机 + 飞行状态 + 姿态库）
    acc.hip.set(0, 0, 0); for (const n of ROT_BONES) { const a = acc.rots[n]; a[0] = a[1] = a[2] = 0; }
    acc.L.length = 0; acc.R.length = 0; acc.axis.set(0, 0, 0); acc.axisW = 0;
    const t = time, ta = dir8.t, up = 1 - 0.6 * W.surf - 0.8 * tuck;
    // 基础体态：挺胸、抬头、站高一点
    acc.hip.y += 0.050 * up;
    addRot('Hips', up, -0.02); addRot('Spine', up, -0.065); addRot('Spine1', up, -0.085); addRot('Spine2', up, -0.075); addRot('Neck', up, 0.05); addRot('Head', up, 0.085);
    // 待机：呼吸、重心左右换脚（非周期）、身体慢慢晃
    const br = Math.sin(t * 1.85) + 0.3 * Math.sin(t * 3.1 + 1), sway = fbm1(t * 0.19, 3), sway2 = fbm1(t * 0.27, 8);
    acc.hip.z += 0.040 * sway * calm; acc.hip.y += 0.006 * Math.sin(t * 0.9) - 0.012 * Math.abs(sway) * calm; acc.hip.x += 0.012 * sway2 * calm;
    addRot('Hips', 1, 0.015 * sway2, -0.045 * sway * calm + 0.10 * bank, 0.03 * fbm1(t * 0.21, 14) - 0.10 * S.turn);
    addRot('Spine', 1, 0.008 * br + 0.10 * pit + 0.006 * shake * Math.sin(t * 23), 0.030 * sway * calm + 0.14 * bank, -0.05 * S.turn);
    addRot('Spine1', 1, 0.012 * br + 0.06 * pit, 0.025 * sway * calm + 0.10 * bank + 0.006 * shake * Math.sin(t * 19 + 1), -0.04 * S.turn);
    addRot('Spine2', 1, 0.014 * br, 0.06 * bank, -0.03 * S.turn + 0.03 * fbm1(t * 0.33, 21));
    addRot('Neck', 1, -0.08 * pit, -0.08 * bank, -0.10 * S.turn);
    addRot('Head', 1, -0.10 * pit + 0.025 * fbm1(t * 0.41, 31), -0.14 * bank + 0.02 * fbm1(t * 0.29, 33), -0.16 * S.turn);
    acc.hip.z += -0.045 * bank;
    // 翻筋斗团身
    if (tuck > 0.001) { acc.hip.y += -0.04 * tuck; addRot('Hips', tuck, 0.15); addRot('Spine', tuck, 0.22); addRot('Spine1', tuck, 0.20); addRot('Spine2', tuck, 0.16); addRot('Neck', tuck, 0.14); addRot('Head', tuck, 0.16); }
    // 受击：猛地后仰、歪一下，再弹回来
    if (hitE > 0.001) { acc.hip.y += -0.07 * hitE; acc.hip.x += -0.05 * hit; addRot('Spine', 1, -0.30 * hit, 0.16 * hit * hitSide); addRot('Spine1', 1, -0.22 * hit, 0.10 * hit * hitSide); addRot('Head', 1, -0.28 * hit, -0.12 * hit * hitSide, 0.2 * hit * hitSide); }
    // 冲刺：压低重心、前探（驾云的架势）
    { const w = W.surf * (1 - tuck); const wa = w * (1 - Math.min(1, W.point + W.staff)); if (w > 0.001) {
      acc.hip.y += -0.145 * w; acc.hip.x += 0.03 * w;
      addRot('Hips', w, 0.10); addRot('Spine', w, 0.20); addRot('Spine1', w, 0.15); addRot('Spine2', w, 0.08); addRot('Neck', w, -0.13); addRot('Head', w, -0.20);
      addArm('L', w, 'Spine2', A.surfL, -0.2, -0.5, -1, 0, 0.02 * Math.sin(t * 7), 0); addArm('R', wa, 'Hips', A.surfR, -0.3, -0.2, 1); addAxis(wa, 0.95, 0.24, -0.10);
    } }
    // 姿态库
    { const w = W.lookout * calm; if (w > 0.001) {                                         // 搭凉棚远眺：头慢慢扫视，手跟着头
      const scan = 0.40 * fbm1(t * 0.22, 41);
      addRot('Spine2', w, 0, 0, scan * 0.20); addRot('Neck', w, 0, 0, scan * 0.28); addRot('Head', w, 0.02 * fbm1(t * 0.3, 43), 0, scan * 0.52);
      addArm('L', w, 'Head', A.handInHead, A.poleArmL.x, A.poleArmL.y, A.poleArmL.z);
    } }
    { const w = W.akimbo * calm; if (w > 0.001) {                                          // 放下手叉腰
      acc.hip.z += -0.020 * w; addRot('Hips', w, 0, -0.04); addRot('Spine1', w, -0.04); addRot('Spine2', w, -0.05); addRot('Head', w, -0.03, 0, 0.14 * fbm1(t * 0.35, 51));
      addArm('L', w, 'Hips', A.hipL, -0.45, 0.05, -1);
    } }
    { const w = W.shoulder * calm; if (w > 0.001) {                                        // 把棒子扛上肩
      addRot('Spine2', w, 0, 0.03, -0.05); addRot('Head', w, 0, 0, 0.10 + 0.12 * fbm1(t * 0.3, 61));
      addArm('R', w, 'Spine2', A.shoulderR, 0.35, -1, 0.45); addAxis(w, 0.86, -0.36, 0.12);
      addArm('L', w, 'Head', A.handInHead, A.poleArmL.x, A.poleArmL.y, A.poleArmL.z);
    } }
    { const w = W.scratch * calm; if (w > 0.001) {                                         // 抓耳挠腮
      const burst = sstep(0.25, 0.5, PT.scratch) * (1 - sstep(PD.scratch - 0.45, PD.scratch - 0.15, PT.scratch)), f = 21;
      addRot('Head', w, 0.07, -0.13, 0.10); addRot('Neck', w, 0.02, -0.05); addRot('Spine2', w, 0.03, -0.04);
      addArm('L', w, 'Head', A.scratch, 0.1, 0.35, -1, 0.016 * Math.cos(t * f) * burst, 0.022 * Math.sin(t * f) * burst, 0);
    } }
    { const w = W.glance * calm; if (w > 0.001) {                                          // 回头看一眼
      const s = glanceSide;
      addRot('Hips', w, 0, 0, 0.10 * s); addRot('Spine', w, 0, 0, 0.12 * s); addRot('Spine1', w, 0, 0, 0.13 * s); addRot('Spine2', w, 0, 0, 0.10 * s); addRot('Neck', w, 0, 0, 0.24 * s); addRot('Head', w, 0.04, 0, 0.46 * s);
      addArm('L', w, 'Head', A.handInHead, A.poleArmL.x, A.poleArmL.y, A.poleArmL.z);
    } }
    { const w = W.laugh * calm; if (w > 0.001) {                                           // 叉腰挺胸大笑
      const tl = PT.laugh, hb = Math.sin(tl * 11.5), env = sstep(0.3, 0.7, tl) * (1 - sstep(PD.laugh - 0.5, PD.laugh - 0.1, tl));
      acc.hip.y += 0.006 * hb * env * w;
      addRot('Spine1', w, -0.09); addRot('Spine2', w, -0.08 + 0.022 * hb * env); addRot('Neck', w, -0.06); addRot('Head', w, -0.20 + 0.035 * Math.sin(tl * 11.5 + 0.7) * env);
      addArm('L', w, 'Hips', A.hipL, -0.45, 0.05, -1);
    } }
    { const w = W.point * calmAct; if (w > 0.001) {                                           // 举棒向前一指
      addRot('Spine1', w, 0.06, 0, 0.13); addRot('Spine2', w, 0.05, 0, 0.12); addRot('Head', w, -0.04, 0, -0.10);
      addArm('R', w, 'Spine2', A.pointR, 0.2, -1, 0.6); addAxis(w, 0.95, 0.30, 0.10);
      addArm('L', w, 'Head', A.handInHead, A.poleArmL.x, A.poleArmL.y, A.poleArmL.z);
    } }
    { const w = W.staff * calmAct; if (w > 0.001) {                                           // 耍棍花：棒子在身侧竖直面里转两圈，然后扛上肩
      const k = ease((PT.staff - 1.55) / 0.6), th = Math.PI * 4 * ease(PT.staff / 1.55) + 0.12;
      _v4.lerpVectors(A.spinR, A.shoulderR, k);
      addArm('R', w, 'Spine2', _v4.clone(), lerp(0.2, 0.35, k), lerp(-0.6, -1, k), lerp(1, 0.45, k));
      _v5.set(Math.cos(th), Math.sin(th), 0.05).lerp(_v6.set(0.86, -0.36, 0.12), k); addAxis(w, _v5.x, _v5.y, _v5.z);
      addRot('Head', w, 0, 0, -0.12 * (1 - k)); addRot('Spine2', w, 0, 0, -0.08 * (1 - k));
      addArm('L', w, 'Head', A.handInHead, A.poleArmL.x, A.poleArmL.y, A.poleArmL.z);
    } }
    // 写入躯干
    bones.Hips.position.x += (acc.hip.x * armQInv_x.x + acc.hip.y * armQInv_y.x + acc.hip.z * armQInv_z.x) / armScale;
    bones.Hips.position.y += (acc.hip.x * armQInv_x.y + acc.hip.y * armQInv_y.y + acc.hip.z * armQInv_z.y) / armScale;
    bones.Hips.position.z += (acc.hip.x * armQInv_x.z + acc.hip.y * armQInv_y.z + acc.hip.z * armQInv_z.z) / armScale;
    for (const n of ROT_BONES) { const a = acc.rots[n]; rot(n, a[0], a[1], a[2]); }
    // 手臂的小动作（没有被反解接管时）
    rot('LeftArm', 0.012 * fbm1(t * 0.5, 71), 0.010 * Math.sin(t * 1.3 + 2) + 0.004 * shake * Math.sin(t * 27), 0);
    rot('RightArm', 0.03 * fbm1(t * 0.37, 73) + 0.20 * tuck, -0.02 * fbm1(t * 0.31, 75), 0.03 * fbm1(t * 0.26, 77));
    rot('RightForeArm', 0.03 * fbm1(t * 0.43, 79), 0, 0);
    if (tuck > 0.001) rot('LeftArm', 0.25 * tuck, 0, 0);

    group.updateWorldMatrix(true, true);
    const tp0 = performance.now();

    // ---- 第二阶段：反解。脚钉在云面上；手按姿态库的目标走
    const legW = (1 - anim.w);
    for (const sd of ['Left', 'Right']) {
      const foot = sd === 'Left' ? A.footL : A.footR, pole = sd === 'Left' ? A.poleLegL : A.poleLegR;
      _v4.copy(foot);
      if (tuck > 0.001) { _v5.setFromMatrixPosition(bones[sd + 'UpLeg'].matrixWorld); root.worldToLocal(_v5); _v5.x += 0.10; _v5.y -= 0.24; _v4.lerp(_v5, tuck); }
      _v4.applyMatrix4(root.matrixWorld);
      _v6.copy(pole).transformDirection(root.matrixWorld);
      ik2(bones[sd + 'UpLeg'], bones[sd + 'Leg'], bones[sd + 'Foot'], _v4, _v6, legW, tuck < 0.5);
    }
    solveArm('L', bones.LeftArm, bones.LeftForeArm, bones.LeftHand, acc.L, 1 - anim.w);
    const rw = solveArm('R', bones.RightArm, bones.RightForeArm, bones.RightHand, acc.R, 1 - anim.w);
    // 棒子的指向：转右手，让棒的轴线对到姿态要求的方向
    if (staffNode && acc.axisW > 0.002) {
      bones.RightArm.updateWorldMatrix(false, true);
      _v1.set(0, 1, 0).transformDirection(staffNode.matrixWorld);                          // 棒的长轴是节点的局部 Y（+Y 是前端）
      _v2.copy(acc.axis).normalize().transformDirection(root.matrixWorld);
      _v2.lerp(_v1, 1 - Math.min(1, acc.axisW) * (1 - anim.w)).normalize();
      _q1.setFromUnitVectors(_v1, _v2);
      bones.RightHand.getWorldQuaternion(_q2).premultiply(_q1); bones.RightForeArm.getWorldQuaternion(_q3);
      bones.RightHand.quaternion.copy(_q3.invert()).multiply(_q2);
    }
    armNode.updateWorldMatrix(false, true);

    const tp1 = performance.now();
    simulate(dt, sp, spN, bo, tuck, hitE);
    const tp2 = performance.now();
    perf.ik += (tp1 - tp0 - perf.ik) * 0.05; perf.sim += (tp2 - tp1 - perf.sim) * 0.05; perf.pose += (tp0 - tu0 - perf.pose) * 0.05;

    // ---- 毛发：按角色在屏幕上的大小增减壳层数（追尾视角里角色很小，用不着满层；特写时用满）
    {
      const dist = _v1.setFromMatrixPosition(group.matrixWorld).distanceTo(app.camera.position);
      const px = (1.7 / (2 * Math.max(0.5, dist) * Math.tan(THREE.MathUtils.degToRad(app.camera.fov) * 0.5))) * app.size.height;
      const want = Math.max(5, Math.round(lerp(0.34, 1.0, sstep(140, 560, px)) * furMax));
      if (want !== furMesh.geometry.instanceCount) { furMesh.geometry.instanceCount = want; furU.uShells.value = want; }
    }
    // ---- 毛发的风
    furTime += dt * (0.55 + 0.75 * spN + 0.9 * bo);
    furU.uFurTime.value = furTime;
    furU.uWindAmp.value = 0.10 + 0.20 * Math.min(1, spN) + 0.28 * bo;
    furU.uWindPush.value = 0.10 + 0.30 * Math.min(1.2, spN) + 0.35 * bo;
  }
  const armQInv_x = V3(), armQInv_y = V3(), armQInv_z = V3();
  ready.then(() => { armQInv_x.set(1, 0, 0).applyQuaternion(armQInv); armQInv_y.set(0, 1, 0).applyQuaternion(armQInv); armQInv_z.set(0, 0, 1).applyQuaternion(armQInv); });

  // ---- 披风和翎子的解算（在"跟随平移、不跟随旋转"的坐标系里）
  const wd = V3(), wu = V3(), ws = V3(), fwd = V3();
  function simulate(dt, sp, spN, bo, tuck, hitE) {
    const E = cloth.E, gm = group.matrixWorld;
    simO.setFromMatrixPosition(gm);
    G3.setFromMatrix4(gm); G3i.copy(G3).invert();
    // 气流方向：有实际位移时用位移方向（翻筋斗时身体在转，但气流方向不变），否则用角色朝向
    // 气流方向：state.forward / state.velocity（世界空间，可选）优先；否则用角色朝向，并在翻筋斗期间冻结（身体在翻，航向没变）
    _v1.set(-gm.elements[8], -gm.elements[9], -gm.elements[10]).normalize();
    if (extFwd) heading.copy(extFwd).normalize();
    else if (!simInit) heading.copy(_v1);
    else if (S.flip <= 0.0005) heading.lerp(_v1, 1 - Math.exp(-(flipHold > 0.05 ? 40 : 14) * dt)).normalize();
    fwd.copy(heading);
    flipHold = S.flip > 0.0005 ? 1 : flipHold * Math.exp(-dt / 0.10);                     // 翻筋斗及落地后 0.3 秒内的余量
    _v1.copy(fwd).multiplyScalar(sp);                                                     // 坐标系的速度（用于惯性力）
    if (simInit) aFrame.lerp(_v2.subVectors(_v1, vPrev).multiplyScalar(1 / dt).clampLength(0, 45), 1 - Math.exp(-9 * dt)); vPrev.copy(_v1);
    wd.copy(fwd).negate(); ws.crossVectors(AY, wd); if (ws.lengthSq() < 1e-4) ws.set(1, 0, 0); ws.normalize(); wu.crossVectors(wd, ws).normalize();
    // 披风与水平面的目标夹角：悬停 90°（垂落）→ 20 m/s 约 45° → 巡航 45 m/s 约 14° → 110 m/s 约 5° → 165 m/s 约 3°
    const alpha = THREE.MathUtils.degToRad(sp >= 45 ? 2.5 + 11.5 * Math.exp(-(sp - 45) / 42) - 1.5 * bo : 14 + 76 * Math.pow(1 - sstep(0, 45, sp), 1.5));
    const KN = 1.55, G = 9.0;
    const U = Math.min(170, G / (KN * Math.tan(Math.max(alpha, 0.03))) * CAPE.windGain);        // 法向气动力与重力平衡时正好是这个夹角
    const hs = Math.max(sstep(70, 125, sp), 0.75 * bo);                                   // 高速段：大波浪让位给碎抖和甩尾
    E.t = time; E.U = U; E.turb = Math.min(0.11, (1.5 + 1.2 * hs) / Math.max(U, 1));
    E.wdx = wd.x; E.wdy = wd.y; E.wdz = wd.z; E.wux = wu.x; E.wuy = wu.y; E.wuz = wu.z; E.wsx = ws.x; E.wsy = ws.y; E.wsz = ws.z;
    E.kN = KN; E.kT = 0.16; E.kD = 0.065 * U;
    E.ax = -aFrame.x * 0.35; E.ay = -aFrame.y * 0.35; E.az = -aFrame.z * 0.35;
    const big = sstep(4, 40, sp);                                                         // 低速时没什么波浪
    E.A1 = CAPE.wave * 30 * big * (1 - 0.72 * hs); E.k1 = 2 * Math.PI / 1.30; E.w1 = 7.6 + 3.0 * hs;         // 大波浪：约 1.2 Hz，沿布面向后传
    E.A2 = CAPE.wave * 11 * big * (1 - 0.35 * hs); E.k2 = 2 * Math.PI / 0.62; E.w2 = 15.5 + 7.0 * hs;
    E.A3 = CAPE.wave * (3 + 130 * hs) * big; E.k3 = 2 * Math.PI / 0.33; E.w3 = 38 + 26 * hs;                  // 高速碎抖（下摆最强）
    E.S2 = CAPE.wave * (1.5 + 42 * hs) * big;                                                                              // 下摆左右甩
    E.spread = 3.0 * big + 0.08 * U;
    // 引导弹簧：平时很弱（只防止布跑到身前、缠住），翻筋斗期间和落地后一小段时间拉紧，让披风跟着身体走、顺着气流向后
    const ca = Math.cos(alpha), sa = Math.sin(alpha);
    E.tdx = wd.x * ca; E.tdy = wd.y * ca - sa; E.tdz = wd.z * ca;
    { const l = Math.hypot(E.tdx, E.tdy, E.tdz) || 1; E.tdx /= l; E.tdy /= l; E.tdz /= l; }
    E.guide = (1.2 + 16 * hs) * big + 150 * flipHold; E.gdamp = 1.2 * hs + 9 * flipHold; E.gspread = 0.92; E.glat = (2.5 + 0.20 * U) * big;     // 高速段拉紧一些：披风贴着水平面抖，不乱甩
    E.floorY = hitE > 0.5 ? -50 : lerp(0.30 * HERO_SCALE, -3.0, Math.min(1, flipHold * 1.5));    // 云面：别让下摆被云吃掉（翻筋斗时不算，落地后平滑恢复）
    // 钉点、碰撞体（世界 → 解算坐标系）
    const pb = E.pinB, pa = E.pinA, sm = bones.Spine2.matrixWorld, pl = cape.pinsLocal;
    for (let i = 0; i < pl.length; i++) { pa[i * 3] = pb[i * 3]; pa[i * 3 + 1] = pb[i * 3 + 1]; pa[i * 3 + 2] = pb[i * 3 + 2]; _v1.copy(pl[i]).applyMatrix4(sm).sub(simO); pb[i * 3] = _v1.x; pb[i * 3 + 1] = _v1.y; pb[i * 3 + 2] = _v1.z; }
    const mid = Math.floor(pl.length / 2) * 3; E.cx = pb[mid]; E.cy = pb[mid + 1]; E.cz = pb[mid + 2];
    _v1.setFromMatrixPosition(bones.Spine.matrixWorld).sub(simO); E.bx = _v1.x; E.by = _v1.y; E.bz = _v1.z; E.br2 = Math.pow(1.05 * HERO_SCALE, 2);
    cloth.colS.forEach((c, i) => { _v1.copy(c.local).applyMatrix4(c.bone.matrixWorld).sub(simO); E.sph[i * 4] = _v1.x; E.sph[i * 4 + 1] = _v1.y; E.sph[i * 4 + 2] = _v1.z; E.sph[i * 4 + 3] = c.r; });
    const setCap = (i, a, b, r) => { const o = i * 8; E.cap[o] = a.x; E.cap[o + 1] = a.y; E.cap[o + 2] = a.z; E.cap[o + 3] = b.x - a.x; E.cap[o + 4] = b.y - a.y; E.cap[o + 5] = b.z - a.z; E.cap[o + 6] = r; E.cap[o + 7] = 1 / Math.max(1e-6, a.distanceToSquared(b)); };
    cloth.colC.forEach((c, i) => { _v1.setFromMatrixPosition(c.a.matrixWorld).sub(simO); _v2.setFromMatrixPosition(c.b.matrixWorld).sub(simO); setCap(i, _v1, _v2, c.r); });
    E.nsph = CAPE.dbg === 'nocol' ? 0 : cloth.colS.length; E.ncap = CAPE.dbg === 'nocol' ? 0 : cloth.colC.length + (staffNode && CAPE.dbg !== 'nostaff' ? 1 : 0); E.ncapBody = CAPE.dbg === 'nocol' ? 0 : cloth.colC.length;
    if (staffNode) { _v1.set(0, 1.1, 0).applyMatrix4(staffNode.matrixWorld).sub(simO); _v2.set(0, -1.1, 0).applyMatrix4(staffNode.matrixWorld).sub(simO); setCap(cloth.colC.length, _v1, _v2, 0.05); }

    if (!simInit) {
      pa.set(pb); E.pin.set(pb);
      _v1.copy(wd).multiplyScalar(0.9).addScaledVector(AY, -0.45).normalize();
      cloth.reset(pb, _v1.x, _v1.y, _v1.z, ws.x, ws.y, ws.z);
      E.damp = Math.exp(-0.9 / 120);
      for (let k = 0; k < 150; k++) { E.t = time - (150 - k) / 120; cloth.step(1 / 120, E, 6); if (k % 2) cloth.computeNormals(); }
      E.t = time;
      feathers.sim.forEach(s => { for (let i = 0; i < feathers.NODES; i++) { _v1.copy(s.restLocal[i]).applyMatrix4(headBone.matrixWorld).sub(simO); s.p[i * 3] = _v1.x; s.p[i * 3 + 1] = _v1.y; s.p[i * 3 + 2] = _v1.z; } });
      simInit = true;
    }
    // 布料子步
    const n = clamp(Math.ceil(dt * 58), 1, 3), h = dt / n;
    E.damp = Math.exp(-0.9 * h);
    cloth.computeNormals();
    for (let s = 0; s < n; s++) {
      const a = (s + 1) / n;
      for (let i = 0; i < pb.length; i++) E.pin[i] = pa[i] + (pb[i] - pa[i]) * a;
      E.t = time - dt + h * (s + 1);
      cloth.step(h, E, 6);
    }
    // 写回贴图（转成 group 局部坐标）
    const e = G3i.elements, P = cloth.pos, D = cape.data;
    for (let k = 0, N = cloth.N; k < N; k++) {
      const x = P[k * 3], y = P[k * 3 + 1], z = P[k * 3 + 2];
      D[k * 4] = e[0] * x + e[3] * y + e[6] * z; D[k * 4 + 1] = e[1] * x + e[4] * y + e[7] * z; D[k * 4 + 2] = e[2] * x + e[5] * y + e[8] * z;
    }
    cape.tex.needsUpdate = true;

    // ---- 翎子：每个节点被弹簧拉向"随头部刚性转动的静止形状"，越到梢部越软；风把它们往后压
    const NF = feathers.NODES, hm = headBone.matrixWorld, FP = feathers.geo.attributes.position.array, FNr = feathers.geo.attributes.normal.array;
    const sub = clamp(Math.ceil(dt * 115), 1, 4), fh = dt / sub;
    _v7.set(0, 0, 1).transformDirection(root.matrixWorld); const latx = _v7.x, laty = _v7.y, latz = _v7.z;     // 身体的左右方向
    feathers.sim.forEach((s, f) => {
      for (let i = 0; i < NF; i++) { _v1.copy(s.restLocal[i]).applyMatrix4(hm).sub(simO); s.tgt[i * 3] = _v1.x; s.tgt[i * 3 + 1] = _v1.y; s.tgt[i * 3 + 2] = _v1.z; }
      for (let q = 0; q < sub; q++) {
        s.p[0] = s.tgt[0]; s.p[1] = s.tgt[1]; s.p[2] = s.tgt[2];
        for (let i = 1; i < NF; i++) {
          const i3 = i * 3, sN = i / (NF - 1), k = 420 * Math.pow(1 - sN, 1.6) + 26, c = 2 * 0.42 * Math.sqrt(k), cd = 0.90 * (0.15 + sN);
          const fl = Math.sin(time * 8.5 + i * 0.7 + f * 2.1) * U * 0.16 * sN * sN + Math.sin(time * 15.0 + i * 1.3 + f) * U * 0.07 * sN * sN * (0.4 + bo);
          for (let a = 0; a < 3; a++) {
            const wv = (a === 0 ? wd.x : a === 1 ? wd.y : wd.z) * U, sdv = a === 0 ? ws.x : a === 1 ? ws.y : ws.z, fr = a === 0 ? aFrame.x : a === 1 ? aFrame.y : aFrame.z;
            const acc_ = (s.tgt[i3 + a] - s.p[i3 + a]) * k - s.v[i3 + a] * c + (wv - s.v[i3 + a]) * cd + sdv * fl - fr * 0.5 * sN + (a === 1 ? -2.5 * sN : 0);
            s.v[i3 + a] += acc_ * fh; s.p[i3 + a] += s.v[i3 + a] * fh;
          }
          // 保持节长
          const j3 = i3 - 3, dx = s.p[i3] - s.p[j3], dy = s.p[i3 + 1] - s.p[j3 + 1], dz = s.p[i3 + 2] - s.p[j3 + 2], len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6, L0 = s.seg[i] * HERO_SCALE, fz = L0 / len;
          const nx = s.p[j3] + dx * fz, ny = s.p[j3 + 1] + dy * fz, nz = s.p[j3 + 2] + dz * fz;
          s.v[i3] += (nx - s.p[i3]) / fh * 0.9; s.v[i3 + 1] += (ny - s.p[i3 + 1]) / fh * 0.9; s.v[i3 + 2] += (nz - s.p[i3 + 2]) / fh * 0.9;
          s.p[i3] = nx; s.p[i3 + 1] = ny; s.p[i3 + 2] = nz;
        }
      }
      // 生成带状网格（三点 V 形截面，Catmull-Rom 细分），转成 group 局部坐标
      const M = feathers.M, SEG = feathers.SEG, P3 = s.p;
      const cr = (a, b, c2, d, u) => 0.5 * ((2 * b) + (-a + c2) * u + (2 * a - 5 * b + 4 * c2 - d) * u * u + (-a + 3 * b - 3 * c2 + d) * u * u * u);
      for (let m = 0; m < M; m++) {
        const g = m / SEG, i1 = Math.min(NF - 2, Math.floor(g)), u = g - i1, i0 = Math.max(0, i1 - 1), i2 = i1 + 1, i3 = Math.min(NF - 1, i1 + 2);
        const x = cr(P3[i0 * 3], P3[i1 * 3], P3[i2 * 3], P3[i3 * 3], u), y = cr(P3[i0 * 3 + 1], P3[i1 * 3 + 1], P3[i2 * 3 + 1], P3[i3 * 3 + 1], u), z = cr(P3[i0 * 3 + 2], P3[i1 * 3 + 2], P3[i2 * 3 + 2], P3[i3 * 3 + 2], u);
        _v1.set(P3[i2 * 3] - P3[i1 * 3], P3[i2 * 3 + 1] - P3[i1 * 3 + 1], P3[i2 * 3 + 2] - P3[i1 * 3 + 2]).normalize();        // 切线
        _v2.set(latx, laty, latz).addScaledVector(_v1, -(latx * _v1.x + laty * _v1.y + latz * _v1.z)).normalize();             // 羽片的宽度方向 ≈ 头的左右方向
        _v3.crossVectors(_v1, _v2).normalize();                                                                                // 羽片法线
        _v2.addScaledVector(_v3, 0.75 * s.side).normalize(); _v3.crossVectors(_v1, _v2).normalize();                           // 拧一个角度：从后面和侧面都看得到宽度
        const sN = m / (M - 1), wdt = (0.010 + 0.030 * Math.sin(Math.PI * Math.pow(sN, 0.55)) * (1 - 0.35 * sN)) * HERO_SCALE;
        const b = (f * M + m) * 9;
        for (let eI = 0; eI < 3; eI++) {
          const o = eI - 1, px = x + _v2.x * wdt * o + _v3.x * wdt * 0.38 * Math.abs(o), py = y + _v2.y * wdt * o + _v3.y * wdt * 0.38 * Math.abs(o), pz = z + _v2.z * wdt * o + _v3.z * wdt * 0.38 * Math.abs(o);
          FP[b + eI * 3] = e[0] * px + e[3] * py + e[6] * pz; FP[b + eI * 3 + 1] = e[1] * px + e[4] * py + e[7] * pz; FP[b + eI * 3 + 2] = e[2] * px + e[5] * py + e[8] * pz;
          const nx = _v3.x - _v2.x * 0.35 * o, ny = _v3.y - _v2.y * 0.35 * o, nz = _v3.z - _v2.z * 0.35 * o;
          FNr[b + eI * 3] = e[0] * nx + e[3] * ny + e[6] * nz; FNr[b + eI * 3 + 1] = e[1] * nx + e[4] * ny + e[7] * nz; FNr[b + eI * 3 + 2] = e[2] * nx + e[5] * ny + e[8] * nz;
        }
      }
    });
    feathers.geo.attributes.position.needsUpdate = true; feathers.geo.attributes.normal.needsUpdate = true;
  }

  function getHeadPosition(target) {
    if (!loaded) return target.copy(group.position).add(_v1.set(0, 1.5, 0));
    headBone.updateWorldMatrix(true, false);
    return target.copy(headLocal).applyMatrix4(headBone.matrixWorld);
  }

  return {
    group, update, getHeadPosition, ready, play,
    get uniforms() { return loaded ? { body: bodyU, fur: furU, cape: cape.U } : null; },
    get debug() { return wkDebug; },
  };
}
