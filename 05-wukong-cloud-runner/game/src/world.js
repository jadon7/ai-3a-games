// 世界模块：无限的程序化峰林（张家界式石英砂岩石峰 + 黄山松），按相机位置流式加载。
//
//   const world = await createWorld(app, opts);
//   app.onUpdate((dt) => world.update(app.camera.position, dt));
//
// 返回 { group, update(cameraPosition, dt), collide(pos, radius), nearestDistance(pos), raycast(origin, dir, maxDist),
//        corridor: { point(s, out), dir(s, out), halfWidth(s), sOf(x, z) }, ready（Promise：近景 LOD 全部加载完）, stats }
//
// 约定：
//   - 坐标是 three 的（Y 向上）。出生点在原点，朝 +X 飞；走廊先沿 +X，约 900 m 后转向太阳方位，之后蜿蜒向前。
//   - 走廊宽 80–120 m；每隔 1–2 km 有一座“山门”（两座高峰夹道，门洞约 85 m）；x≈260 处固定有第一座。
//   - 石峰网格从 Y≈38·缩放 起（云海顶面 CLOUD_TOP_Y=96 以下约 50 m）。
//   - 材质是 MeshStandardMaterial（三平面映射在 onBeforeCompile 里），吃太阳阴影和天空 IBL；不含雾、不做色调映射。
//   - 石峰 14 个变体 × 4 档 LOD（近景约 8~11 万三角形 / 中景 1.3 万 / 中远景 3 千 / 远景 600），InstancedMesh 按变体 × LOD 分批，
//     每帧自己做视锥剔除并由近到远填实例。近景石峰和 150 m 内的树投影；阴影盒往太阳方向延长线上的远处石峰用远景网格只投影不显示。
//   - 树：55 m 内是完整的松树（树干 + 叶芯 + 松针卡片），150 m 内是简化版，更远是两片交叉的公告板；最远一档石峰的树冠合并在网格里。
//   - createWorld 是异步的（要加载资产）。近景 LOD 在后台继续加载（world.ready），没到之前先用中景网格。
//   - 碰撞用导出的“方位角–高度–半径”表（world.json），精度约 ±1.5 m；树不参与碰撞。
// 资产由 tools/export_world.py 导出到 assets/world/。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CLOUD_TOP_Y, CRUISE_Y } from './common.js';

const D2R = Math.PI / 180;
const CELL = 180;                       // 摆放用的哈希网格边长（米）
const GCELL = 256;                      // 碰撞查询用的空间哈希边长
const E1 = [Math.cos(25 * D2R), -Math.sin(25 * D2R)];       // (x, z)：太阳方位（走廊的大方向）
const E2 = [Math.sin(25 * D2R), Math.cos(25 * D2R)];        // 垂直于 E1
const K0 = Math.tan(25 * D2R), S0 = 330, SL = 570;

// ----------------------------------------------------------------------------- 确定性随机
function hash(ix, iz, k) {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263) ^ Math.imul(k | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; h = Math.imul(h, 2246822519); h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function vnoise(x, z, seed) {
  const x0 = Math.floor(x), z0 = Math.floor(z); let fx = x - x0, fz = z - z0;
  fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
  const a = hash(x0, z0, seed), b = hash(x0 + 1, z0, seed), c = hash(x0, z0 + 1, seed), d = hash(x0 + 1, z0 + 1, seed);
  return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz;
}

// ----------------------------------------------------------------------------- 走廊（s：沿太阳方位的里程；t：横向偏移）
function centerT(s) {
  let base;
  if (s <= S0) base = K0 * s;
  else { const x = Math.min((s - S0) / SL, 1); base = K0 * (S0 + SL * (x - x * x * x + 0.5 * x * x * x * x)); }
  const a = s > 0 ? sstep(900, 2300, s) : sstep(-300, -1500, s);
  return base + a * (300 * Math.sin(s / 1750 + 1.3) + 110 * Math.sin(s / 640 + 4.1) + 28 * Math.sin(s / 270 + 0.7));
}
const halfWidth = (s) => 50 + 8 * Math.sin(s / 410 + 2.0) + 2 * Math.sin(s / 97);
const slopeT = (s) => (centerT(s + 4) - centerT(s - 4)) / 8;
function corridorInfo(x, z) {           // 点到走廊中线的（近似）垂直距离等
  const s = x * E1[0] + z * E1[1], t = x * E2[0] + z * E2[1];
  const ct = centerT(s), k = Math.sqrt(1 + slopeT(s) ** 2);
  return { s, t, ct, k, delta: Math.abs(t - ct) / k, w: halfWidth(s) };
}

const SHADER_COMMON = /* glsl */`
vec3 wkPine(float v) { return mix(vec3(0.012, 0.024, 0.010), vec3(0.040, 0.066, 0.020), v); }
`;

// ----------------------------------------------------------------------------- 岩石材质（三平面映射）
function makeRockMaterial(tex, level) {       // level: 0 近景，1 中景，2 远景
  const far = level === 2;
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0.0 });
  mat.defines = level === 2 ? { WK_FAR: 1 } : (level === 1 ? { WK_MID: 1 } : {});
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { tRockA: { value: tex.a }, tRockAN: { value: tex.an }, tRockB: { value: tex.b }, tRockBN: { value: tex.bn }, tNoise: { value: tex.noise } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec4 aData;\nvarying vec3 vWPos; varying vec3 vWNrm; varying vec4 vData; varying vec3 vInst;`)
      .replace('#include <project_vertex>', /* glsl */`#include <project_vertex>
        vec4 wkP = vec4(transformed, 1.0); vec3 wkN = objectNormal;
        #ifdef USE_INSTANCING
          wkP = instanceMatrix * wkP; wkN = mat3(instanceMatrix) * wkN;
        #endif
        vWPos = (modelMatrix * wkP).xyz; vWNrm = normalize(mat3(modelMatrix) * wkN); vData = aData;
        #ifdef USE_INSTANCING_COLOR
          vInst = instanceColor;
        #else
          vInst = vec3(0.5);
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', /* glsl */`#include <common>
        uniform sampler2D tRockA, tRockAN, tRockB, tRockBN, tNoise;
        varying vec3 vWPos; varying vec3 vWNrm; varying vec4 vData; varying vec3 vInst;
        ${SHADER_COMMON}
        vec3 wkBump = vec3(0.0); float wkRough = 0.9; float wkFoliage = 0.0;`)
      .replace('#include <color_fragment>', /* glsl */`
        {
          vec3 wn = normalize(vWNrm);
          vec3 bw = pow(abs(wn), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
          vec3 p = vWPos;
          wkFoliage = step(0.5, vData.g);
          // 宏观噪声：大尺度色差、风化面、苔藓
          vec4 nz1 = texture2D(tNoise, p.xz / 620.0 + p.y / 410.0 + vInst.z * 7.0);
          vec4 nz2 = texture2D(tNoise, vec2(p.x + p.z, p.y * 1.7) / 95.0);
          // A：层理砂岩（竖纹贴图转 90°：u 沿高度），两个尺度混合打破重复；B：灰色裂隙岩
          float sA = 1.0 / 24.0, sA2 = 1.0 / 87.0, sB = 1.0 / 21.0;
          vec3 cA = texture2D(tRockA, p.yz * sA).rgb * bw.x + texture2D(tRockA, p.xz * sA).rgb * bw.y + texture2D(tRockA, p.yx * sA).rgb * bw.z;
          vec3 cB = texture2D(tRockB, p.zy * sB).rgb * bw.x + texture2D(tRockB, p.xz * sB).rgb * bw.y + texture2D(tRockB, p.xy * sB).rgb * bw.z;
          #if !defined(WK_FAR) && !defined(WK_MID)
            vec3 cA2 = texture2D(tRockA, p.yz * sA2 + 0.37).rgb * bw.x + texture2D(tRockA, p.xz * sA2).rgb * bw.y + texture2D(tRockA, p.yx * sA2 + 0.37).rgb * bw.z;
            cA = mix(cA, cA2, smoothstep(0.35, 0.65, nz2.r) * 0.6 + 0.2);
          #endif
          float gmix = smoothstep(0.40, 0.62, nz1.g);
          vec3 c = mix(cA, cB, gmix);
          float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
          c = mix(vec3(lum), c, 0.40) * 0.20;                                         // 压暗、降饱和：晨雾里的石英砂岩
          c *= mix(vec3(1.0, 0.86, 0.76), vec3(0.86, 0.87, 0.91), vInst.x);           // 每座峰偏暖灰褐 / 偏冷灰
          float wall = smoothstep(0.55, 0.15, wn.y);
          // 黑色水渍竖纹（水平方向高频、竖向低频）
          float hx = p.z * bw.x + p.x * bw.z + (p.x + p.z) * 0.5 * bw.y;
          float st = texture2D(tNoise, vec2(hx / 14.0, p.y / 330.0)).b * texture2D(tNoise, vec2(hx / 61.0 + 0.3, p.y / 900.0)).r;
          c = mix(c, vec3(0.020, 0.019, 0.018), smoothstep(0.24, 0.42, st) * wall * 0.85);
          // 灰白风化面 + 横向层理明暗
          c = mix(c, vec3(0.235, 0.228, 0.215), smoothstep(0.52, 0.74, nz1.r) * 0.5);
          c *= 0.78 + 0.44 * texture2D(tNoise, vec2(hx / 700.0, p.y / 46.0)).g;
          // 凹处压暗（导出时烘的伪 AO）
          c *= mix(0.55, 1.12, vData.b);
          #if !defined(WK_FAR) && !defined(WK_MID)
            // 近处的细节：小尺度贴图的明暗（裂隙更深、棱面更亮）
            float sD = 1.0 / 5.3;
            float dfade = 1.0 - smoothstep(70.0, 200.0, length(vWPos - cameraPosition));
            if (dfade > 0.003) {
              float lumD = dot(texture2D(tRockB, p.zy * sD).rgb * bw.x + texture2D(tRockB, p.xz * sD).rgb * bw.y + texture2D(tRockB, p.xy * sD).rgb * bw.z, vec3(0.3333));
              c *= mix(1.0, 0.35 + 1.75 * lumD, dfade * 0.85);
            }
          #endif
          // 苔藓 / 植被：朝上的面、台肩和岩缝
          float veg = vData.r + (nz2.g - 0.5) * 0.9;
          float vm = smoothstep(0.36, 0.56, veg);
          vm = max(vm, smoothstep(0.12, 0.5, wn.y) * smoothstep(0.42, 0.58, nz2.b));
          c = mix(c, vec3(0.030, 0.045, 0.018), smoothstep(0.50, 0.66, nz2.a) * smoothstep(-0.1, 0.45, wn.y) * 0.5);
          vec3 green = wkPine(nz2.r);
          c = mix(c, green, vm);
          wkRough = mix(mix(0.76, 0.94, nz1.b), 0.95, vm);
          // 合并进网格的远景树冠
          c = mix(c, wkPine(0.25 + 0.5 * nz2.r) * (0.75 + 0.5 * vData.b), wkFoliage);
          wkRough = mix(wkRough, 0.95, wkFoliage);
          diffuseColor.rgb = c;
          #ifndef WK_FAR
            // 三平面法线（UDN 混合）
            vec3 tA = (texture2D(tRockAN, p.yz * sA).xyz * 2.0 - 1.0);
            vec3 tAy = (texture2D(tRockAN, p.xz * sA).xyz * 2.0 - 1.0);
            vec3 tAz = (texture2D(tRockAN, p.yx * sA).xyz * 2.0 - 1.0);
            vec3 bA = vec3(0.0, tA.x, tA.y) * bw.x + vec3(tAy.x, 0.0, tAy.y) * bw.y + vec3(tAz.y, tAz.x, 0.0) * bw.z;
            #ifdef WK_MID
              wkBump = bA * 1.25 * (1.0 - vm * 0.7);
            #else
              vec3 tB = (texture2D(tRockBN, p.zy * sB).xyz * 2.0 - 1.0);
              vec3 tBy = (texture2D(tRockBN, p.xz * sB).xyz * 2.0 - 1.0);
              vec3 tBz = (texture2D(tRockBN, p.xy * sB).xyz * 2.0 - 1.0);
              vec3 bB = vec3(0.0, tB.y, tB.x) * bw.x + vec3(tBy.x, 0.0, tBy.y) * bw.y + vec3(tBz.x, tBz.y, 0.0) * bw.z;
              vec3 bD = vec3(0.0);
              if (dfade > 0.003) {
                vec3 tD = (texture2D(tRockBN, p.zy * sD).xyz * 2.0 - 1.0);
                vec3 tDy = (texture2D(tRockBN, p.xz * sD).xyz * 2.0 - 1.0);
                vec3 tDz = (texture2D(tRockBN, p.xy * sD).xyz * 2.0 - 1.0);
                bD = vec3(0.0, tD.y, tD.x) * bw.x + vec3(tDy.x, 0.0, tDy.y) * bw.y + vec3(tDz.x, tDz.y, 0.0) * bw.z;
              }
              wkBump = (mix(bA, bB, gmix) * 1.25 + bD * 1.1 * dfade) * (1.0 - vm * 0.7) * (1.0 - wkFoliage);
            #endif
          #endif
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor = wkRough;`)
      .replace('#include <normal_fragment_maps>', /* glsl */`#include <normal_fragment_maps>
        #ifndef WK_FAR
          normal = normalize(normal + mat3(viewMatrix) * wkBump);
        #endif
        {   // 法线不要背对视线（掠射角会反出一圈发白的环境高光）；树冠的法线再往视线方向掰一点
          vec3 wkV = normalize(vViewPosition);
          normal = normalize(normal + wkV * (max(0.0, 0.12 - dot(normal, wkV)) + 0.6 * wkFoliage));
        }`)
      .replace('#include <lights_physical_fragment>', /* glsl */`#include <lights_physical_fragment>
        material.specularF90 = mix(0.12, 0.0, wkFoliage); material.specularColor *= mix(0.4, 0.1, wkFoliage);`);
  };
  mat.customProgramCacheKey = () => 'wk_rock_' + level;
  return mat;
}

// ----------------------------------------------------------------------------- 树材质（树皮 + 深色叶芯 + 松针卡片，同一张图集）
function makeTreeMaterial(atlas, timeUniform) {
  const mat = new THREE.MeshStandardMaterial({ map: atlas, alphaTest: 0.34, side: THREE.DoubleSide, roughness: 0.8, metalness: 0.0 });
  mat.alphaToCoverage = true;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWkTime = timeUniform;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec4 aData;\nuniform float uWkTime;\nvarying vec4 vData; varying vec3 vInst;`)
      .replace('#include <begin_vertex>', /* glsl */`#include <begin_vertex>
        vData = aData;
        #ifdef USE_INSTANCING_COLOR
          vInst = instanceColor;
        #else
          vInst = vec3(0.5);
        #endif
        {   // 风摆：越高摆得越多，松针卡片额外抖一点
          float ph = uWkTime * 1.3 + vInst.z * 40.0 + position.x * 0.35 + position.z * 0.27;
          float amp = aData.g * aData.g * 0.10 + step(0.75, aData.r) * 0.035;
          transformed.x += sin(ph) * amp; transformed.z += cos(ph * 0.83 + 1.7) * amp * 0.7;
          transformed.y += sin(ph * 2.1) * step(0.75, aData.r) * 0.015;
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec4 vData; varying vec3 vInst;\n${SHADER_COMMON}`)
      .replace('#include <color_fragment>', /* glsl */`
        {
          float kind = vData.r;
          vec3 tex = diffuseColor.rgb;
          vec3 bark = tex * vec3(0.50, 0.40, 0.34);
          vec3 core = wkPine(0.2);
          float l = dot(tex, vec3(0.3, 0.6, 0.1));
          vec3 needle = mix(wkPine(0.35), wkPine(1.25), smoothstep(0.02, 0.22, l)) * (0.85 + 0.4 * vInst.x);
          diffuseColor.rgb = kind < 0.25 ? bark : (kind < 0.75 ? core : needle);
        }`)
      .replace('#include <normal_fragment_begin>', /* glsl */`#include <normal_fragment_begin>
        {
          vec3 wkV = normalize(vViewPosition);
          if (vData.r > 0.75) normal = normalize(vNormal);       // 松针卡片不随正反面翻转法线，避免背面发黑
          float fol = step(0.25, vData.r);
          normal = normalize(normal + wkV * (max(0.0, 0.15 - dot(normal, wkV)) + 0.55 * fol));
        }`)
      .replace('#include <lights_physical_fragment>', /* glsl */`#include <lights_physical_fragment>
        { float fol = step(0.25, vData.r); material.specularF90 = mix(0.4, 0.0, fol); material.specularColor *= mix(1.0, 0.1, fol); }`);
  };
  mat.customProgramCacheKey = () => 'wk_tree';
  return mat;
}

// 远处的树：两片交叉的公告板（贴图是影片级黄山松的正交渲染）
function makeImpostorMaterial(atlas) {
  const mat = new THREE.MeshStandardMaterial({ map: atlas, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.95, metalness: 0.0 });
  mat.alphaToCoverage = true;
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vInst;`)
      .replace('#include <begin_vertex>', /* glsl */`#include <begin_vertex>
        #ifdef USE_INSTANCING_COLOR
          vInst = instanceColor;
        #else
          vInst = vec3(0.5);
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vInst;`)
      .replace('#include <color_fragment>', `diffuseColor.rgb *= vec3(0.105, 0.16, 0.09) * (0.8 + 0.45 * vInst.x) * (0.62 + 0.75 * fract(vMapUv.y * 2.0 > 1.0 ? 2.0 - vMapUv.y * 2.0 : 1.0 - vMapUv.y * 2.0));`)
      .replace('#include <normal_fragment_begin>', /* glsl */`#include <normal_fragment_begin>
        normal = normalize(mat3(viewMatrix) * vec3(0.0, 1.0, 0.0) + normalize(vViewPosition) * 0.9);`)
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>\nmaterial.specularF90 = 0.0; material.specularColor *= 0.1;`);
  };
  mat.customProgramCacheKey = () => 'wk_impostor';
  return mat;
}

function b64ToU16(s) {
  const bin = atob(s), n = bin.length, u8 = new Uint8Array(n);
  for (let i = 0; i < n; i++) u8[i] = bin.charCodeAt(i);
  return new Uint16Array(u8.buffer);
}

function fixGeometry(geo) {
  if (geo.getAttribute('_data')) { geo.setAttribute('aData', geo.getAttribute('_data')); geo.deleteAttribute('_data'); }
  return geo;
}

function makeBatch(geo, mat, cap, cast, receive, name) {
  const m = new THREE.InstancedMesh(geo, mat, cap);
  m.name = name; m.count = 0; m.frustumCulled = false; m.castShadow = cast; m.receiveShadow = receive;
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
  m.instanceColor.setUsage(THREE.DynamicDrawUsage);
  return m;
}

/**
 * @param {object} app
 * @param {object} [opts] { radius=3600 可见半径, lod0=150, lod1=430, lod2=1150（石峰 LOD 切换距离）, shadowRange=160, addToScene=true, camera }
 */
export async function createWorld(app, opts = {}) {
  const base = (opts.assets || app.assets) + 'world/';
  // 画质档位只影响距离阈值（low 档近景更少、可见半径更小）
  const QS = { low: 0.72, high: 1.0, ultra: 1.3 }[app.qualityName] ?? 1.0;
  const RADIUS = opts.radius ?? (app.qualityName === 'low' ? 3000 : 3600);
  const LOD_D = [opts.lod0 ?? 150 * QS, opts.lod1 ?? 430 * QS, opts.lod2 ?? 1150 * QS];        // 石峰 LOD0/1/2 的最远距离（之外是 LOD3）
  const TREE0_D = 55 * QS, TREE1_D = 150 * QS, BUSH_D = 150 * QS;
  const SHADOW_R = (opts.shadowRange ?? 160) + 30;      // 和 app.setShadowRange 的值保持一致（app 目前没有读取接口）
  const camera = opts.camera || app.camera;
  const group = new THREE.Group(); group.name = 'World';
  const loader = new GLTFLoader();
  const tl = new THREE.TextureLoader();
  const maxAniso = app.renderer.capabilities.getMaxAnisotropy();
  const loadTex = async (file, srgb, aniso = 8) => {
    const t = await tl.loadAsync(base + file);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = Math.min(aniso, maxAniso); t.flipY = false; t.needsUpdate = true;
    return t;
  };
  const [meta, gl12, glTrees, ta, tan, tb, tbn, tnoise, atlas, impAtlas] = await Promise.all([
    fetch(base + 'world.json').then(r => r.json()), loader.loadAsync(base + 'rocks_lod123.glb'), loader.loadAsync(base + 'trees.glb'),
    loadTex('rock_a_color.jpg', true), loadTex('rock_a_normal.jpg', false), loadTex('rock_b_color.jpg', true), loadTex('rock_b_normal.jpg', false),
    loadTex('noise.png', false, 2), loadTex('tree_atlas.webp', true, 4), loadTex('tree_impostors.webp', true, 4),
  ]);
  atlas.wrapS = atlas.wrapT = THREE.ClampToEdgeWrapping; impAtlas.wrapS = impAtlas.wrapT = THREE.ClampToEdgeWrapping;
  const rockTex = { a: ta, an: tan, b: tb, bn: tbn, noise: tnoise };
  const matRock = makeRockMaterial(rockTex, 0), matRockMid = makeRockMaterial(rockTex, 1), matRockFar = makeRockMaterial(rockTex, 2);
  const matTree = makeTreeMaterial(atlas, app.fx.uniforms.uTime);
  const matImp = makeImpostorMaterial(impAtlas);
  const matShadowOnly = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });

  // ---- 变体数据
  const NA = meta.profile.na, DY = meta.profile.dy;
  const V = meta.variants.map((mv, i) => {
    const u16 = b64ToU16(mv.profile), ny = mv.ny, prof = new Float32Array(u16.length);
    for (let k = 0; k < u16.length; k++) prof[k] = u16[k] * 0.1;
    // 飞行高度带（云顶到 +150 m）内各方位的最大半径；最“胖”的方位（给山门定朝向用）
    const y0 = Math.floor(CLOUD_TOP_Y / DY), y1 = Math.min(ny - 1, Math.floor((CLOUD_TOP_Y + 150) / DY));
    let rfly = 0, fat = 0, fatR = 0;
    const rdir = new Float32Array(NA);
    for (let a = 0; a < NA; a++) { let m = 0; for (let y = y0; y <= y1; y++) m = Math.max(m, prof[a * ny + y]); rdir[a] = m; rfly = Math.max(rfly, m); if (m > fatR) { fatR = m; fat = a; } }
    const find = (n) => gl12.scene.getObjectByName(n);
    const trees = [], bushes = [];
    for (let k = 0; k < mv.trees.length; k += 6) trees.push(mv.trees.slice(k, k + 6));
    for (let k = 0; k < mv.bushes.length; k += 5) bushes.push(mv.bushes.slice(k, k + 5));
    return { i, name: mv.name, style: mv.style, gate: mv.gate, top: mv.top, rmax: mv.rmax, rfly, rdir, fatAngle: (fat + 0.5) / NA * 2 * Math.PI - Math.PI, ny, prof,
      geo: [null, fixGeometry(find(mv.name + '_lod1').geometry), fixGeometry(find(mv.name + '_lod2').geometry), fixGeometry(find(mv.name + '_lod3').geometry)], trees, bushes };
  });
  const NV = V.length;
  const idsGate = V.filter(v => v.gate).map(v => v.i), idsHS = V.filter(v => v.style === 'hs').map(v => v.i);
  const idsNormal = V.filter(v => v.style !== 'hs').map(v => v.i);

  // ---- 批次
  const batch = V.map((v) => [
    null,                                                                    // [0] LOD0 近景，在阴影范围内（投影 + 受影）
    makeBatch(v.geo[1], matRockMid, 96, false, true, v.name + '_L1'),         // [1] LOD1 中景
    makeBatch(v.geo[2], matRockFar, 256, false, false, v.name + '_L2'),       // [2] LOD2 中远景
    makeBatch(v.geo[3], matShadowOnly, 64, true, false, v.name + '_shadow'),  // [3] 只投影的替身（主通道不可见）
    null,                                                                    // [4] LOD0 近景，阴影范围外（只受影）
    makeBatch(v.geo[3], matRockFar, 640, false, false, v.name + '_L3'),       // [5] LOD3 远景
  ]);
  for (const b of batch) { b[1].renderOrder = 3; b[2].renderOrder = 4; b[5].renderOrder = 5; group.add(b[1], b[2], b[3], b[5]); }
  const treeGeo = [];
  for (let t = 0; t < 3; t++) treeGeo.push([fixGeometry(glTrees.scene.getObjectByName(`tree_${t}_lod0`).geometry), fixGeometry(glTrees.scene.getObjectByName(`tree_${t}_lod1`).geometry)]);
  const treeBatch = treeGeo.map((g, t) => [makeBatch(g[0], matTree, 96, true, true, `tree${t}_L0`), makeBatch(g[1], matTree, 512, true, true, `tree${t}_L1`)]);
  // 远处的树：两片交叉的公告板
  const impBatch = meta.trees.map((mt, t) => {
    const h = mt.impostorHalf, u0 = t / 3, u1 = (t + 1) / 3;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-h, 0, 0, h, 0, 0, h, 2 * h, 0, -h, 2 * h, 0, 0, 0, h, 0, 0, -h, 0, 2 * h, -h, 0, 2 * h, h], 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([u0, 0.5, u1, 0.5, u1, 0, u0, 0, u0, 1, u1, 1, u1, 0.5, u0, 0.5], 2));
    g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
    return makeBatch(g, matImp, 8192, false, false, `tree${t}_imp`);
  });
  const bushBatch = makeBatch(fixGeometry(glTrees.scene.getObjectByName('bush').geometry), matTree, 4096, false, true, 'bush');
  for (const tb_ of treeBatch) { tb_[0].renderOrder = 2; tb_[1].renderOrder = 2; group.add(tb_[0], tb_[1]); }
  for (const b of impBatch) { b.renderOrder = 6; group.add(b); }
  bushBatch.renderOrder = 2; group.add(bushBatch);
  if (opts.addToScene !== false) app.scene.add(group);

  // ---- 近景 LOD 后台加载（没到之前先用中景网格顶着）
  let lod0Loaded = 0;
  const ready = Promise.all(V.map(async (v) => {
    const g = await loader.loadAsync(`${base}${v.name}_lod0.glb`);
    v.geo[0] = fixGeometry(g.scene.getObjectByName(v.name + '_lod0').geometry);
    batch[v.i][0] = makeBatch(v.geo[0], matRock, 12, true, true, v.name + '_L0');
    batch[v.i][4] = makeBatch(v.geo[0], matRock, 12, false, true, v.name + '_L0n');
    batch[v.i][0].renderOrder = 1; batch[v.i][4].renderOrder = 1;
    group.add(batch[v.i][0], batch[v.i][4]);
    lod0Loaded++;
  })).then(() => true);

  // ---- 布局：每个网格单元确定性地生成 0~2 座石峰；压进走廊的推到走廊边上或丢弃；山门单独生成
  function gateAt(s, key, forced) {
    const ct = centerT(s), sl = slopeT(s), k = Math.sqrt(1 + sl * sl);
    const gap = forced ? 42 : 40 + 9 * hash(key, 3, 77);
    const out = [];
    for (const side of [1, -1]) {
      const vi = idsGate[Math.floor(hash(key, side, 78) * idsGate.length) % idsGate.length], v = V[vi];
      const scale = 1.12 + 0.22 * hash(key, side, 79);
      // 朝走廊的一面用这座峰最胖的方位，这样门洞宽度是确定的
      const t = ct + side * (gap + v.rfly * scale) * k;
      const x = s * E1[0] + t * E2[0], z = s * E1[1] + t * E2[1];
      const cx = s * E1[0] + ct * E2[0], cz = s * E1[1] + ct * E2[1];
      const toC = Math.atan2(cz - z, cx - x);                 // 世界里指向走廊中心的方位（atan2(z, x)）
      out.push({ x, z, v: vi, scale, rot: v.fatAngle - toC, pri: 2 + hash(key, side, 80), gate: true, id: `g${key}_${side}` });
    }
    return out;
  }
  function gatesInCell(ix, iz) {
    const cx = (ix + 0.5) * CELL, cz = (iz + 0.5) * CELL, sc = cx * E1[0] + cz * E1[1];
    const out = [];
    const consider = (g) => { for (const p of g) if (Math.floor(p.x / CELL) === ix && Math.floor(p.z / CELL) === iz) out.push(p); };
    if (Math.abs(sc - 236) < CELL * 2) consider(gateAt(236, 100000, true));          // 出生点前方 x≈260 的第一座山门
    const k0 = Math.round((sc - 1500) / 1500);
    for (let k = k0 - 1; k <= k0 + 1; k++) {
      if (k < 0 && k > -2) continue;
      if (hash(k, 5, 81) > 0.8) continue;
      const s = 1500 + k * 1500 + (hash(k, 6, 82) - 0.5) * 600;
      if (Math.abs(s - 236) < 500) continue;
      consider(gateAt(s, k, false));
    }
    return out;
  }
  const rawCache = new Map(), cellCache = new Map();
  function rawCell(ix, iz) {
    const key = ix + ',' + iz;
    let out = rawCache.get(key);
    if (out) return out;
    out = [];
    const cx = (ix + 0.5) * CELL, cz = (iz + 0.5) * CELL, ci = corridorInfo(cx, cz);
    const edge = ci.delta - ci.w;
    let p = 0.42 + 1.05 * vnoise(cx / 1500, cz / 1500, 11) * (0.6 + 0.8 * vnoise(cx / 520, cz / 520, 12));
    if (edge < 330) p += 0.15;
    const n = Math.floor(p) + (hash(ix, iz, 1) < p - Math.floor(p) ? 1 : 0);
    for (let k = 0; k < n; k++) {
      let x = (ix + hash(ix, iz, 10 + k * 7)) * CELL, z = (iz + hash(ix, iz, 11 + k * 7)) * CELL;
      const hv = hash(ix, iz, 12 + k * 7), h2 = hash(ix, iz, 13 + k * 7);
      let vi;
      if (hv < 0.12 && edge > 260) vi = idsHS[Math.floor(h2 * idsHS.length) % idsHS.length];
      else vi = idsNormal[Math.floor(h2 * idsNormal.length) % idsNormal.length];
      const v = V[vi];
      const hs_ = hash(ix, iz, 14 + k * 7);
      const scale = v.style === 'hs' ? 0.8 + 0.3 * hs_ : 0.8 + 0.5 * hs_ * hs_;
      const rr = v.rfly * scale;
      const c = corridorInfo(x, z);
      if (v.style === 'hs' && c.delta - c.w - rr < 280) continue;           // 大锥峰只放在离走廊远的地方
      if (c.delta < c.w + rr + 5) {
        if (hash(ix, iz, 15 + k * 7) > 0.78) continue;
        const side = c.t === c.ct ? (hash(ix, iz, 16 + k * 7) < 0.5 ? -1 : 1) : Math.sign(c.t - c.ct);
        const t = c.ct + side * (c.w + rr + 5 + 40 * hash(ix, iz, 17 + k * 7) ** 2) * c.k;
        x = c.s * E1[0] + t * E2[0]; z = c.s * E1[1] + t * E2[1];
      }
      out.push({ x, z, v: vi, scale, rot: hash(ix, iz, 18 + k * 7) * Math.PI * 2, pri: hash(ix, iz, 19 + k * 7), gate: false, id: `${ix}_${iz}_${k}` });
    }
    // 走廊两侧的石峰列：每 85 m 一个槽位，贴边一排（74%）+ 外侧一排（50%），把走廊夹成峡谷
    if (edge < 560) {
      const sc = ci.s, k0 = Math.floor((sc - 200) / 85), k1 = Math.ceil((sc + 200) / 85);
      for (let k = k0; k <= k1; k++) for (const side of [1, -1]) for (let row = 0; row < 2; row++) {
        const hk = side * 3 + row;
        if (hash(k, hk, 91) > (row === 0 ? 0.74 : 0.5)) continue;
        const s = k * 85 + (hash(k, hk, 92) - 0.5) * 70;
        const vi = idsNormal[Math.floor(hash(k, hk, 93) * idsNormal.length) % idsNormal.length], v = V[vi];
        const scale = 0.85 + 0.45 * hash(k, hk, 94), rr = v.rfly * scale;
        const kk = Math.sqrt(1 + slopeT(s) ** 2);
        const off = halfWidth(s) + rr + 3 + (row === 0 ? 26 * hash(k, hk, 95) ** 2 : 70 + 110 * hash(k, hk, 95));
        const t = centerT(s) + side * off * kk;
        const x = s * E1[0] + t * E2[0], z = s * E1[1] + t * E2[1];
        if (Math.floor(x / CELL) !== ix || Math.floor(z / CELL) !== iz) continue;
        const c = corridorInfo(x, z);
        if (c.delta < c.w + rr + 1) continue;                    // 弯道内侧会挤进走廊的不要
        out.push({ x, z, v: vi, scale, rot: hash(k, hk, 96) * Math.PI * 2, pri: 1.2 + 0.5 * hash(k, hk, 97), gate: false, id: `w${k}_${hk}` });
      }
    }
    for (const g of gatesInCell(ix, iz)) out.push(g);
    rawCache.set(key, out);
    return out;
  }
  function finalCell(ix, iz) {
    const key = ix + ',' + iz;
    let out = cellCache.get(key);
    if (out) return out;
    out = [];
    const mine = rawCell(ix, iz);
    for (const p of mine) {
      let ok = true;
      const rp = V[p.v].rfly * p.scale;
      for (let dx = -1; dx <= 1 && ok; dx++) for (let dz = -1; dz <= 1 && ok; dz++) {
        for (const q of rawCell(ix + dx, iz + dz)) {
          if (q === p || q.pri <= p.pri) continue;
          const d = Math.hypot(q.x - p.x, q.z - p.z), rq = V[q.v].rfly * q.scale;
          if (d < (q.gate ? rp + rq + 12 : 0.6 * (rp + rq))) { ok = false; break; }
        }
      }
      if (!ok) continue;
      const v = V[p.v], c = Math.cos(p.rot), s = Math.sin(p.rot);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(p.x, 0, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot), new THREE.Vector3(p.scale, p.scale, p.scale));
      out.push({ ...p, c, s, m, top: v.top * p.scale, rw: v.rmax * p.scale, lod: 3, tint: [hash(ix * 7 + 1, iz, 31 + out.length), hash(ix, iz * 5 + 2, 32 + out.length), hash(ix + 3, iz + 9, 33 + out.length)], treeCache: null });
    }
    cellCache.set(key, out);
    return out;
  }

  // ---- 流式：相机周围 RADIUS 内的单元
  let active = [], grid = new Map(), lastCenter = null, lastSort = null;
  function rebuildActive(cam) {
    const r = Math.ceil(RADIUS / CELL), cx0 = Math.floor(cam.x / CELL), cz0 = Math.floor(cam.z / CELL);
    active = []; grid = new Map();
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (dx * dx + dz * dz > r * r) continue;
      for (const p of finalCell(cx0 + dx, cz0 + dz)) {
        active.push(p);
        const gk = Math.floor(p.x / GCELL) + ',' + Math.floor(p.z / GCELL);
        let a = grid.get(gk); if (!a) grid.set(gk, a = []); a.push(p);
      }
    }
    if (cellCache.size > 9000) { cellCache.clear(); rawCache.clear(); }          // 飞出很远后清一次缓存（内容是确定性的，可重建）
    lastCenter = cam.clone();
  }

  // ---- 每帧：LOD 分配 + 视锥剔除 + 填实例缓冲
  const frustum = new THREE.Frustum(), psm = new THREE.Matrix4(), sph = new THREE.Sphere(), tmpV = new THREE.Vector3(), tmpM = new THREE.Matrix4(), tmpM2 = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), AXY = new THREE.Vector3(0, 1, 0);
  const stats = { pillars: 0, lod0: 0, lod1: 0, lod2: 0, lod3: 0, shadowProxies: 0, trees0: 0, trees1: 0, impostors: 0, bushes: 0, lod0Loaded: 0 };
  function push(b, m, tint) {
    if (!b || b.count >= b.instanceMatrix.count) return;
    const i = b.count++;
    m.toArray(b.instanceMatrix.array, i * 16);
    const c = b.instanceColor.array; c[i * 3] = tint[0]; c[i * 3 + 1] = tint[1]; c[i * 3 + 2] = tint[2];
  }
  function buildTreeCache(p, withBushes) {
    const v = V[p.v], T = [], B = [];
    for (const t of v.trees) {
      tmpM2.compose(tmpV.set(t[0], t[1], t[2]), tmpQ.setFromAxisAngle(AXY, t[4]), tmpS.setScalar(t[3] / p.scale * Math.min(p.scale, 1.15)));
      const m = new THREE.Matrix4().multiplyMatrices(p.m, tmpM2);
      T.push({ m, x: m.elements[12], y: m.elements[13], z: m.elements[14], type: t[5] | 0, tint: [hash(t[0] * 10, t[2] * 10, 5), 0.5, hash(t[0] * 10, t[2] * 10, 6)] });
    }
    if (withBushes) for (const t of v.bushes) {
      tmpM2.compose(tmpV.set(t[0], t[1], t[2]), tmpQ.setFromAxisAngle(AXY, t[4]), tmpS.setScalar(t[3] / p.scale * Math.min(p.scale, 1.15)));
      const m = new THREE.Matrix4().multiplyMatrices(p.m, tmpM2);
      B.push({ m, x: m.elements[12], y: m.elements[13], z: m.elements[14], tint: [hash(t[0] * 10, t[2] * 10, 7), 0.5, hash(t[0] * 10, t[2] * 10, 8)] });
    }
    p.treeCache = { T, B, full: withBushes };
  }
  function update(camPos, dt) {
    if (!lastCenter || lastCenter.distanceToSquared(camPos) > 160 * 160) { rebuildActive(camPos); lastSort = null; }
    if (!lastSort || lastSort.distanceToSquared(camPos) > 50 * 50) {          // 近 → 远排序（同一批实例里也让近的先画）
      for (const p of active) p.d2 = (p.x - camPos.x) ** 2 + (p.z - camPos.z) ** 2;
      active.sort((a, b) => a.d2 - b.d2); lastSort = (lastSort || new THREE.Vector3()).copy(camPos);
    }
    camera.updateMatrixWorld();
    psm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(psm);
    for (const b of batch) for (const m of b) if (m) m.count = 0;
    for (const tb_ of treeBatch) { tb_[0].count = 0; tb_[1].count = 0; }
    for (const b of impBatch) b.count = 0;
    bushBatch.count = 0;
    const focus = app.shadowFocus, sd = app.sunLight.position.clone().sub(app.sunLight.target.position).normalize();
    const sRange = SHADOW_R;
    let n0 = 0, n1 = 0, n2 = 0, n3 = 0, ns = 0, t0 = 0, t1 = 0, tb = 0, bb = 0;
    for (const p of active) {
      const dx = p.x - camPos.x, dz = p.z - camPos.z;
      const d = Math.hypot(dx, dz) - p.rw;
      // 带滞回的 LOD
      let lod = p.lod;
      while (lod < 3 && d > LOD_D[lod] * 1.1) lod++;
      while (lod > 0 && d < LOD_D[lod - 1]) lod--;
      p.lod = lod;
      const hasL0 = !!batch[p.v][0];
      sph.center.set(p.x, p.top * 0.5 + 20, p.z); sph.radius = Math.hypot(p.top * 0.5, p.rw) + 30;
      const vis = frustum.intersectsSphere(sph);
      if (lod === 0) {
        const inShadow = Math.hypot(p.x - focus.x, p.z - focus.z) - p.rw < sRange;
        if (hasL0) { if (inShadow) push(batch[p.v][0], p.m, p.tint); else if (vis) push(batch[p.v][4], p.m, p.tint); }
        else if (vis) push(batch[p.v][1], p.m, p.tint);
        if (hasL0 && !inShadow) { tmpV.set(p.x - focus.x, 0, p.z - focus.z); const al = tmpV.x * sd.x + tmpV.z * sd.z, la = Math.abs(tmpV.x * -sd.z + tmpV.z * sd.x); if (la < sRange + p.rw && al > 0 && al < 2600) { push(batch[p.v][3], p.m, p.tint); ns++; } }
        n0++;
        if (!p.treeCache || !p.treeCache.full) buildTreeCache(p, true);
        for (const t of p.treeCache.T) {
          const td = Math.hypot(t.x - camPos.x, t.y + 4 - camPos.y, t.z - camPos.z);
          sph.center.set(t.x, t.y + 4, t.z); sph.radius = 22;
          if (!frustum.intersectsSphere(sph)) continue;
          if (td < TREE0_D) { push(treeBatch[t.type][0], t.m, t.tint); t0++; } else if (td < TREE1_D) { push(treeBatch[t.type][1], t.m, t.tint); t1++; } else { push(impBatch[t.type], t.m, t.tint); tb++; }
        }
        for (const t of p.treeCache.B) {
          const td = Math.hypot(t.x - camPos.x, t.y - camPos.y, t.z - camPos.z);
          if (td > BUSH_D) continue;
          sph.center.set(t.x, t.y + 1, t.z); sph.radius = 4;
          if (frustum.intersectsSphere(sph)) { push(bushBatch, t.m, t.tint); bb++; }
        }
      } else {
        if (lod === 3) p.treeCache = null;
        if (vis) {
          push(batch[p.v][lod === 3 ? 5 : lod], p.m, p.tint); if (lod === 1) n1++; else if (lod === 2) n2++; else n3++;
          if (lod < 3) {                   // 中景 / 中远景：树全部用公告板
            if (!p.treeCache) buildTreeCache(p, false);
            for (const t of p.treeCache.T) { push(impBatch[t.type], t.m, t.tint); tb++; }
          }
        }
        // 远处石峰的影子：只要它在“阴影盒往太阳方向的延长线”里，就用远景网格投影（主通道里不可见）
        tmpV.set(p.x - focus.x, 0, p.z - focus.z);
        const along = tmpV.x * sd.x + tmpV.z * sd.z, lat = Math.abs(tmpV.x * -sd.z + tmpV.z * sd.x);
        if (lat < sRange + p.rw && along > -sRange - p.rw && along < 2600) { push(batch[p.v][3], p.m, p.tint); ns++; }
      }
    }
    for (const b of batch) for (const m of b) if (m) { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; }
    for (const tb_ of treeBatch) for (const m of tb_) { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; }
    for (const m of impBatch) { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; }
    bushBatch.instanceMatrix.needsUpdate = true; bushBatch.instanceColor.needsUpdate = true;
    Object.assign(stats, { pillars: active.length, lod0: n0, lod1: n1, lod2: n2, lod3: n3, shadowProxies: ns, trees0: t0, trees1: t1, impostors: tb, bushes: bb, lod0Loaded });
  }

  // ---- 碰撞（方位角–高度–半径表）
  function sampleProf(v, th, y) {
    const fa = (th + Math.PI) / (2 * Math.PI) * NA - 0.5, fy = y / DY - 0.5;
    const a0 = ((Math.floor(fa) % NA) + NA) % NA, a1 = (a0 + 1) % NA, ta_ = fa - Math.floor(fa);
    let y0 = Math.floor(fy); const ty = fy - y0;
    if (y0 >= v.ny - 1) return 0;
    if (y0 < 0) y0 = 0;
    const p = v.prof, ny = v.ny;
    const r00 = p[a0 * ny + y0], r10 = p[a1 * ny + y0], r01 = p[a0 * ny + y0 + 1], r11 = p[a1 * ny + y0 + 1];
    const lo = r00 + (r10 - r00) * ta_, hi = r01 + (r11 - r01) * ta_;
    if (hi <= 0) return lo > 0 && ty < 0.5 ? lo : 0;          // 到顶了：半格以内还算实心
    return lo + (hi - lo) * ty;
  }
  function topAt(v, th, d) {           // 这个方位、离轴 d 处的岩石顶面高度（没有岩石返回 -Infinity）
    const fa = (th + Math.PI) / (2 * Math.PI) * NA - 0.5;
    const a0 = ((Math.floor(fa) % NA) + NA) % NA, a1 = (a0 + 1) % NA, ta_ = fa - Math.floor(fa), p = v.prof, ny = v.ny;
    let prev = 0;
    for (let y = ny - 1; y >= 0; y--) {
      const r = p[a0 * ny + y] + (p[a1 * ny + y] - p[a0 * ny + y]) * ta_;
      if (r >= d) { const f = r > prev ? (r - d) / (r - prev) : 1; return (y + 0.5 + Math.min(f, 1)) * DY; }
      prev = r;
    }
    return -Infinity;
  }
  const near = [];
  function gather(x, z, reach) {
    near.length = 0;
    const x0 = Math.floor((x - reach) / GCELL), x1 = Math.floor((x + reach) / GCELL), z0 = Math.floor((z - reach) / GCELL), z1 = Math.floor((z + reach) / GCELL);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) { const a = grid.get(ix + ',' + iz); if (a) for (const p of a) near.push(p); }
    return near;
  }
  const _n = new THREE.Vector3();
  /** 球（pos, radius）与石峰相交则返回 { normal（世界，指向推开的方向）, depth（米） }，否则 null。 */
  function collide(pos, radius) {
    let best = null, bestDepth = 0;
    for (const p of gather(pos.x, pos.z, 150 + radius)) {
      const dx = pos.x - p.x, dz = pos.z - p.z;
      if (dx * dx + dz * dz > (p.rw + radius + 2) ** 2 || pos.y > p.top + radius + 2) continue;
      const v = V[p.v], lx = (dx * p.c - dz * p.s) / p.scale, lz = (dx * p.s + dz * p.c) / p.scale, ly = pos.y / p.scale, R = radius / p.scale;
      const d = Math.hypot(lx, lz), th = Math.atan2(lz, lx);
      const r = sampleProf(v, th, ly);
      const penH = r > 0 ? r + R - d : -1;
      const top = topAt(v, th, d);
      const penV = top > -1e8 ? top + R - ly : -1;
      if (penH <= 0 && penV <= 0) continue;
      let pen, nx, ny, nz;
      if (penH > 0 && (penV <= 0 || penH <= penV)) {
        const dr = (sampleProf(v, th, ly + DY * 0.5) - sampleProf(v, th, ly - DY * 0.5)) / DY;
        const inv = d > 1e-4 ? 1 / d : 0;
        nx = lx * inv; nz = lz * inv; ny = Math.max(-1.5, Math.min(1.5, -dr)); pen = penH;
      } else { nx = d > 1e-4 ? lx / d * 0.15 : 0; nz = d > 1e-4 ? lz / d * 0.15 : 0; ny = 1; pen = penV; }
      const depth = pen * p.scale;
      if (depth > bestDepth) {
        bestDepth = depth;
        const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
        best = best || { normal: new THREE.Vector3(), depth: 0, pillar: null };
        best.normal.set(nx * p.c + nz * p.s, ny, -nx * p.s + nz * p.c); best.depth = depth; best.pillar = p;
      }
    }
    return best;
  }
  /** 点到某一座石峰表面的（近似）距离，米；在岩石内部为负。 */
  function distanceTo(p, pos) {
    const dx = pos.x - p.x, dz = pos.z - p.z;
    const v = V[p.v], lx = (dx * p.c - dz * p.s) / p.scale, lz = (dx * p.s + dz * p.c) / p.scale, ly = pos.y / p.scale;
    const d = Math.hypot(lx, lz), th = Math.atan2(lz, lx);
    const r = sampleProf(v, th, ly);
    let dist;
    if (r > 0) dist = d - r;
    else {
      const top = topAt(v, th, d);
      if (top > -1e8) dist = ly - top;
      else { const rt = sampleProf(v, th, v.top - 3 * DY); dist = Math.hypot(Math.max(d - rt, 0), Math.max(ly - v.top, 0)); }
    }
    return dist * p.scale;
  }
  /** 到最近石峰表面的距离（米，≥0；在岩石里返回 0；400 m 内没有石峰返回 Infinity）。给擦身而过的音效用。 */
  function nearestDistance(pos) {
    let best = Infinity;
    for (const p of gather(pos.x, pos.z, 400)) {
      if (Math.hypot(pos.x - p.x, pos.z - p.z) - p.rw > best) continue;
      best = Math.min(best, Math.max(0, distanceTo(p, pos)));
    }
    return best;
  }
  /** 射线与石峰求交（球面步进，精度约 1 m）。返回 { point, distance, normal } 或 null。 */
  function raycast(origin, dir, maxDist = 2000) {
    const p = new THREE.Vector3(); let t = 0;
    for (let i = 0; i < 200 && t < maxDist; i++) {
      p.copy(origin).addScaledVector(dir, t);
      const d = nearestDistance(p);
      if (d < 0.5) { const c = collide(p, 1.5); return { point: p, distance: t, normal: c ? c.normal.clone() : dir.clone().negate() }; }
      t += d === Infinity ? 150 : Math.max(d * 0.6, 0.6);
    }
    return null;
  }

  const corridor = {
    /** 走廊中线上的点（s 是沿太阳方位的里程，出生点 s=0）。高度给巡航高度。 */
    point(s, out = new THREE.Vector3()) { const t = centerT(s); return out.set(s * E1[0] + t * E2[0], CRUISE_Y, s * E1[1] + t * E2[1]); },
    dir(s, out = new THREE.Vector3()) { const sl = slopeT(s); return out.set(E1[0] + sl * E2[0], 0, E1[1] + sl * E2[1]).normalize(); },
    halfWidth,
    sOf(x, z) { return x * E1[0] + z * E1[1]; },
    offset(x, z) { const c = corridorInfo(x, z); return (c.t - c.ct) / c.k; },
  };
  /** 调试 / 关卡逻辑用：pos 周围 reach 米内的石峰（{ x, z, scale, rot, v（变体序号）, top, rw（最大半径）, gate }）。 */
  function pillarsNear(pos, reach = 300) { return gather(pos.x, pos.z, reach).filter(p => Math.hypot(p.x - pos.x, p.z - pos.z) - p.rw < reach).slice(); }
  return { group, update, collide, nearestDistance, distanceTo, raycast, pillarsNear, corridor, ready, stats, variants: V, materials: { rock: matRock, rockMid: matRockMid, rockFar: matRockFar, tree: matTree, impostor: matImp } };
}
