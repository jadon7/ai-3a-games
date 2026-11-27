// 材质库：程序化 PBR 贴图 + 着色器注入（宏观变化 / 双层混合 / 顶点烘焙 GI / 风动）
import * as THREE from 'three';
import { avifSupported } from '../core/pack.js';
import { TexGen, canvasTex, mulberry32 } from './texgen.js';

// 全局共享 uniform。uAOTex/uPrevVP：上一帧的屏幕空间 AO（R=遮蔽，G=线性深度）与其视图投影矩阵，
// 材质里按世界坐标重投影采样，只用来压暗间接光（直射阳光不受影响）
export const G = { uTime: { value: 0 }, uAOTex: { value: null }, uPrevVP: { value: new THREE.Matrix4() }, uAOTexel: { value: new THREE.Vector2(1, 1) }, uAOAmt: { value: 1 }, uSkyTint: { value: new THREE.Vector3(1, 1, 1) } };   // uSkyTint：天光 / 环境反射的整体染色（两界切换时改）

export function buildTextures(renderer, hi = true) {
  const tg = new TexGen(renderer, 8);
  const big = hi ? 2048 : 1024, mid = hi ? 1024 : 512;
  const T = {};
  T.macro = tg.make('macro', { size: 512, normal: 1 });
  T.plaster = tg.make('plaster', { size: big, normal: 2.2 });
  T.brick = tg.make('brick', { size: mid, normal: 3.0 });
  T.sandstone = tg.make('sandstone', { size: big, normal: 2.6 });
  T.sand = tg.make('sand', { size: big, normal: 2.0 });
  T.dirt = tg.make('dirt', { size: mid, normal: 3.0 });
  T.paving = tg.make('paving', { size: big, normal: 3.2 });
  T.concrete = tg.make('concrete', { size: mid, normal: 2.0 });
  T.wood = tg.make('wood', { size: mid, normal: 2.6, colA: [0.46, 0.33, 0.21], colB: [0.64, 0.50, 0.33] });
  T.woodPaint = tg.make('wood', { size: mid, normal: 2.2, colA: [0.80, 0.80, 0.78], colB: [0.95, 0.95, 0.92], seed: 3 });
  T.metalPaint = tg.make('metalPaint', { size: mid, normal: 1.6, p: [0.35, 0, 2] });
  T.metalRusty = tg.make('metalPaint', { size: mid, normal: 1.8, p: [0.85, 0, 0], seed: 2 });
  T.corrugated = tg.make('metalPaint', { size: mid, normal: 2.4, p: [0.55, 24, 0], seed: 5 });
  T.steel = tg.make('steel', { size: mid, normal: 1.2, colA: [0.42, 0.43, 0.45], p: [0.5, 0.34] });
  T.fabric = tg.make('fabric', { size: 512, normal: 1.6, colA: [0.93, 0.92, 0.88], colB: [0.93, 0.92, 0.88] });
  T.fabricStripe = tg.make('fabric', { size: 512, normal: 1.6, colA: [0.94, 0.92, 0.86], colB: [0.42, 0.42, 0.42], p: [5] });
  T.tiles = tg.make('tiles', { size: mid, normal: 1.4, colA: [0.10, 0.27, 0.56], colB: [0.10, 0.55, 0.58] });
  T.rugRed = tg.make('rug', { size: 512, normal: 1.0, colA: [0.56, 0.12, 0.10], colB: [0.10, 0.14, 0.30], clampUV: true });
  T.rugBlue = tg.make('rug', { size: 512, normal: 1.0, colA: [0.12, 0.26, 0.42], colB: [0.50, 0.14, 0.10], clampUV: true, seed: 4 });
  T.rock = tg.make('rock', { size: mid, normal: 3.4 });
  T.gunmetal = tg.make('gunmetal', { size: 512, normal: 0.8, colA: [0.10, 0.105, 0.11], colB: [0.34, 0.34, 0.35], p: [0.40, 1.0] });
  T.polymer = tg.make('polymer', { size: 512, normal: 1.0, colA: [0.235, 0.24, 0.25], colB: [0.33, 0.33, 0.335], p: [0.58] });
  T.armor = tg.make('armor', { size: mid, normal: 1.0, p: [0.5] });
  T.polymerLight = tg.make('polymer', { size: 512, normal: 1.0, colA: [0.84, 0.84, 0.84], colB: [0.92, 0.92, 0.92], p: [0.62], seed: 6 });
  T.camoDesert = tg.make('camo', { size: 1024, normal: 2.2, colA: [0.66, 0.59, 0.46], colB: [0.43, 0.35, 0.26], p: [0.80, 0.75, 0.63, 0], seed: 1 });
  T.camoDark = tg.make('camo', { size: 1024, normal: 2.2, colA: [0.25, 0.25, 0.27], colB: [0.13, 0.13, 0.145], p: [0.36, 0.36, 0.38, 0], seed: 2 });
  T.armorClean = tg.make('armor', { size: 512, normal: 0.7, p: [0.05], seed: 3 });
  T.gunmetalClean = tg.make('gunmetal', { size: 512, normal: 0.6, colA: [0.47, 0.48, 0.51], colB: [0.70, 0.70, 0.72], p: [0.42, 1.0], seed: 2 });
  tg.dispose();

  // ---- Canvas 贴图 ----
  // 棕榈叶（带透明通道的羽状叶片）
  T.palmLeaf = canvasTex(512, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    // 羽状复叶：密集的披针形小叶，远看是一整片
    for (let i = 0; i < 44; i++) {
      const t = i / 43; const x = 10 + t * (w - 40);
      const len = (h * 0.47) * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.1)) * (1 - t * 0.2);
      const bw = 13 - t * 5; const shade = 0.82 + 0.18 * Math.sin(i * 1.7);
      for (const s of [-1, 1]) {
        g.fillStyle = `rgb(${Math.round(92 * shade + t * 40)},${Math.round(132 * shade + t * 22)},${Math.round(46 * shade + t * 20)})`;
        g.beginPath(); g.moveTo(x, h / 2); g.quadraticCurveTo(x + bw * 0.9, h / 2 + s * len * 0.45, x + 20 + t * 10, h / 2 + s * len);
        g.quadraticCurveTo(x + bw * 1.9, h / 2 + s * len * 0.4, x + bw, h / 2); g.closePath(); g.fill();
      }
    }
    g.strokeStyle = '#8a9148'; g.lineWidth = 5; g.lineCap = 'round'; g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w - 12, h / 2); g.stroke();
  });
  // 干草丛（alpha 贴图）
  T.grass = canvasTex(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h); const R = mulberry32(21); g.lineCap = 'round';
    for (let i = 0; i < 46; i++) {
      const x0 = w * (0.18 + R() * 0.64), lean = (R() - 0.5) * 150, len = h * (0.45 + R() * 0.5);
      const gr = g.createLinearGradient(0, h, 0, h - len); const green = R() < 0.3;
      gr.addColorStop(0, green ? '#5b6a2c' : '#7a6a34'); gr.addColorStop(1, green ? '#a8ad5c' : '#e0cd8a');
      g.strokeStyle = gr; g.lineWidth = 2.2 + R() * 2.6;
      g.beginPath(); g.moveTo(x0, h); g.quadraticCurveTo(x0 + lean * 0.25, h - len * 0.6, x0 + lean, h - len); g.stroke();
    }
  });
  // 海报 / 招贴（抽象图形，不含真实文字）
  const rnd = mulberry32(77);
  T.posters = canvasTex(1024, 512, (g, w, h) => {
    const cols = ['#b4442f', '#2d5f7c', '#c9a23a', '#3e6b4f', '#7c4a2a', '#d8cfb8', '#1f2a36', '#a8402e'];
    for (let i = 0; i < 8; i++) {
      const x = (i % 4) * 256, y = Math.floor(i / 4) * 256;
      g.fillStyle = '#d9cfb6'; g.fillRect(x, y, 256, 256);
      g.fillStyle = cols[i]; g.fillRect(x + 10, y + 10, 236, 236);
      g.fillStyle = cols[(i + 3) % 8];
      if (i % 3 === 0) { g.beginPath(); g.arc(x + 128, y + 105, 62, 0, 7); g.fill(); }
      else if (i % 3 === 1) { g.beginPath(); g.moveTo(x + 128, y + 34); g.lineTo(x + 206, y + 170); g.lineTo(x + 50, y + 170); g.fill(); }
      else { g.fillRect(x + 54, y + 44, 148, 110); g.fillStyle = cols[(i + 5) % 8]; g.fillRect(x + 78, y + 68, 100, 62); }
      g.fillStyle = '#e9e1cc';
      for (let k = 0; k < 4; k++) { const lw = 60 + rnd() * 130; g.fillRect(x + 128 - lw / 2, y + 186 + k * 13, lw, 6); }
      // 做旧
      for (let k = 0; k < 500; k++) { g.fillStyle = `rgba(${200 + rnd() * 40 | 0},${185 + rnd() * 40 | 0},${150 + rnd() * 40 | 0},${rnd() * 0.25})`; g.fillRect(x + rnd() * 256, y + rnd() * 256, 2 + rnd() * 10, 1 + rnd() * 3); }
      g.fillStyle = 'rgba(217,207,182,0.9)';
      for (let k = 0; k < 5; k++) { g.beginPath(); const ex = x + (rnd() < 0.5 ? rnd() * 30 : 226 + rnd() * 30), ey = y + rnd() * 256; g.arc(ex, ey, 8 + rnd() * 18, 0, 7); g.fill(); }
    }
  });
  // 墙面喷漆标记：A / B / 箭头 / 编号
  T.signs = canvasTex(1024, 512, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    const stencil = (txt, x, y, size, col) => {
      g.font = `900 ${size}px "Arial Black", "Helvetica Neue", Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = col; g.fillText(txt, x, y);
      g.globalCompositeOperation = 'destination-out';
      for (let k = 0; k < 900; k++) { g.fillStyle = `rgba(0,0,0,${rnd() * 0.5})`; g.fillRect(x - size + rnd() * size * 2, y - size * 0.6 + rnd() * size * 1.2, 1 + rnd() * 6, 1 + rnd() * 2); }
      g.globalCompositeOperation = 'source-over';
    };
    stencil('A', 128, 128, 210, '#e9e2d2'); stencil('B', 384, 128, 210, '#e9e2d2');
    stencil('➔', 640, 128, 170, '#e9e2d2'); stencil('⬅', 896, 128, 150, '#e9e2d2');
    stencil('07', 128, 384, 150, '#1c1c1c'); stencil('12', 384, 384, 150, '#1c1c1c');
    stencil('✕', 640, 384, 170, '#b03a26'); stencil('◎', 896, 384, 170, '#e9e2d2');
  });
  return T;
}

// ---- 实拍 PBR 贴图（Poly Haven CC0）：覆盖对应的程序化贴图槽位 ----
export const PHOTO_SLOTS = ['plaster', 'brick', 'sandstone', 'sand', 'dirt', 'paving', 'concrete', 'wood', 'woodPaint', 'metalPaint', 'metalRusty', 'corrugated', 'shutter', 'rock'];
// cap = { color, data }：贴图边长上限（手机低画质用，省显存）：颜色 / 法线图用 color，AO-粗糙度-金属度和高度图用 data
export async function loadPhotoTextures(T, renderer, base = 'assets/tex/', onProgress = null, cap = null) {
  const loader = new THREE.TextureLoader(); const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  let done = 0; const total = PHOTO_SLOTS.length * 3;
  // 每张贴图有 AVIF 和 JPEG 两份（内容一样，AVIF 小得多）：浏览器能解 AVIF 就取它，取不到再退回 JPEG
  const avif = await avifSupported();
  const fetchTex = (name) => avif ? loader.loadAsync(name + '.avif').catch(() => loader.loadAsync(name + '.jpg')) : loader.loadAsync(name + '.jpg');
  const shrink = (t, max) => { const im = t.image; if (!max || !im || !(im.width > max)) return; const c = document.createElement('canvas'); c.width = max; c.height = Math.max(1, Math.round(im.height * max / im.width)); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); t.image = c; };
  const load = (url, srgb, max = 0) => fetchTex(url).then((t) => {
    shrink(t, max);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso;
    t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; done++; if (onProgress) onProgress(done / total); return t;
  });
  let ok = 0;
  await Promise.all(PHOTO_SLOTS.map(async (s) => {
    try { const [map, normalMap, ormMap] = await Promise.all([load(base + s + '_diff', true, cap && cap.color), load(base + s + '_nor', false, cap && cap.color), load(base + s + '_arm', false, cap && cap.data)]); T[s] = { map, normalMap, ormMap, photo: true }; ok++; }
    catch (e) { console.warn('[khamsin] 实拍贴图缺失，回退到程序化材质：', s); }
  }));
  // 高度图（视差遮蔽用，可选）
  await Promise.all(['paving', 'sandstone'].map(async (s) => { if (!T[s] || !T[s].photo) return; try { const t = await fetchTex(base + s + '_disp'); shrink(t, cap && cap.data); t.colorSpace = THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; T[s].dispMap = t; } catch (e) { /* 没有高度图就不做视差 */ } }));
  return ok;
}

// ---- 着色器注入 ----
// ---- 屏幕空间 AO 的共享着色器片段（场景材质与动态物体材质共用）----
const AO_GLSL = /* glsl */`
uniform sampler2D uAOTex; uniform mat4 uPrevVP; uniform vec2 uAOTexel; uniform float uAOAmt; uniform vec3 uSkyTint;
// 上一帧屏幕空间 AO：按世界坐标重投影；深度不一致（遮挡边缘 / 新露出的区域）时取深度最接近的邻近纹素
float screenAO( vec3 wpos ) {
  vec4 pc = uPrevVP * vec4( wpos, 1.0 );
  if ( pc.w < 0.05 ) return 1.0;
  vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
  vec2 eb = min( puv, 1.0 - puv ); float edge = smoothstep( 0.0, 0.02, min( eb.x, eb.y ) );
  if ( edge <= 0.0 ) return 1.0;
  vec2 a = texture2D( uAOTex, puv ).rg;
  float tol = 0.04 * pc.w + 0.05; float ao = a.r;
  if ( abs( a.g - pc.w ) > tol ) {
    vec2 b = floor( puv / uAOTexel - 0.5 ); float best = 1e9; ao = 1.0;
    for ( int j = 0; j < 2; j ++ ) for ( int i = 0; i < 2; i ++ ) {
      vec2 sv = texture2D( uAOTex, ( b + vec2( float( i ), float( j ) ) + 0.5 ) * uAOTexel ).rg;
      float dz = abs( sv.g - pc.w ); if ( dz < best ) { best = dz; ao = sv.r; }
    }
    if ( best > tol * 3.0 ) ao = 1.0;
  }
  return mix( 1.0, ao, edge );
}
// GTAO 多次反弹近似（Jimenez 2016）：浅色表面的遮蔽区会被相互反弹的光提亮
vec3 aoMultiBounce( float v, vec3 albedo ) {
  vec3 a = 2.0404 * albedo - 0.3324; vec3 b = - 4.7951 * albedo + 0.6417; vec3 c = 2.7552 * albedo + 0.6903;
  return max( vec3( v ), ( ( v * a + b ) * v + c ) * v );
}`;

// 给普通的 MeshStandardMaterial（士兵、机甲等动态物体）加上"屏幕空间 AO 只压间接光"
export function applyScreenAO(mat) {
  const prev = mat.onBeforeCompile; const key = mat.customProgramCacheKey ? mat.customProgramCacheKey() : '';
  mat.onBeforeCompile = (shader, renderer) => {
    if (prev) prev(shader, renderer);
    shader.uniforms.uAOTex = G.uAOTex; shader.uniforms.uPrevVP = G.uPrevVP; shader.uniforms.uAOTexel = G.uAOTexel; shader.uniforms.uAOAmt = G.uAOAmt; shader.uniforms.uSkyTint = G.uSkyTint;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPosAO;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n  { vec4 wpa = vec4( transformed, 1.0 );\n  #ifdef USE_INSTANCING\n    wpa = instanceMatrix * wpa;\n  #endif\n    vWPosAO = ( modelMatrix * wpa ).xyz; }');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPosAO;\n' + AO_GLSL)
      .replace('#include <aomap_fragment>', /* glsl */`#include <aomap_fragment>
  { float sao = mix( 1.0, screenAO( vWPosAO ), uAOAmt );
    reflectedLight.indirectDiffuse *= aoMultiBounce( sao, clamp( material.diffuseContribution, 0.0, 1.0 ) );
    reflectedLight.indirectDiffuse *= uSkyTint; reflectedLight.indirectSpecular *= uSkyTint;
    float saoNV = saturate( dot( normal, normalize( vViewPosition ) ) );
    reflectedLight.indirectSpecular *= saturate( pow( saoNV + sao, exp2( - 16.0 * material.roughness - 1.0 ) ) - 1.0 + sao ); }`);
  };
  mat.customProgramCacheKey = () => key + '|sao';
  return mat;
}

function enhance(mat, T, { key, layer2 = null, bake = true, wind = false, texAlpha = false, uv2 = 2.0, maskScale = 0.045, macroAmp = 0.34, gain = [1, 1, 1], gain2 = [1, 1, 1], soft = 0.05, edge = 0.5, pom = null, dirt = 0, stain = 0 } = {}) {
  mat.defines = mat.defines || {};
  if (texAlpha) mat.defines.USE_TEXALPHA = '';
  if (layer2) mat.defines.USE_LAYER2 = '';
  if (pom) mat.defines.USE_POM = '';
  if (bake) mat.defines.USE_BAKE = '';
  if (wind) { mat.defines.USE_WIND = ''; mat.defines.USE_TRANSLUCENT = ''; }
  mat.customProgramCacheKey = () => 'enh|' + key;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNoiseTex = { value: T.macro.map };
    shader.uniforms.uTime = G.uTime;
    shader.uniforms.uAOTex = G.uAOTex; shader.uniforms.uPrevVP = G.uPrevVP; shader.uniforms.uAOTexel = G.uAOTexel; shader.uniforms.uAOAmt = G.uAOAmt; shader.uniforms.uSkyTint = G.uSkyTint;
    shader.uniforms.uMaskScale = { value: maskScale };
    shader.uniforms.uMacroAmp = { value: macroAmp };
    shader.uniforms.uGain = { value: new THREE.Vector3(gain[0], gain[1], gain[2]) };
    shader.uniforms.uDirt = { value: dirt }; shader.uniforms.uStain = { value: stain };
    if (pom) { shader.uniforms.uDisp = { value: pom.tex }; shader.uniforms.uPomScale = { value: pom.depth }; }
    if (layer2) {
      shader.uniforms.uMap2 = { value: layer2.map };
      shader.uniforms.uNormal2 = { value: layer2.normalMap };
      shader.uniforms.uOrm2 = { value: layer2.ormMap };
      shader.uniforms.uUv2 = { value: uv2 };
      shader.uniforms.uGain2 = { value: new THREE.Vector3(gain2[0], gain2[1], gain2[2]) };
      shader.uniforms.uSoft = { value: new THREE.Vector2(soft, edge) };
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', /* glsl */`#include <common>
varying vec3 vWPos;
#ifdef USE_BAKE
  attribute vec4 aGI; varying vec4 vGI;
#endif
#ifdef USE_WIND
  attribute float aWind; uniform float uTime;
#endif`)
      .replace('#include <begin_vertex>', /* glsl */`#include <begin_vertex>
#ifdef USE_WIND
  { float wph = uTime * 1.9 + position.x * 0.43 + position.z * 0.31;
    transformed.y += (sin(wph) * 0.09 + sin(wph * 2.3 + 1.3) * 0.035) * aWind;
    transformed.x += cos(wph * 0.8) * 0.05 * aWind; transformed.z += sin(wph * 1.1 + 0.7) * 0.04 * aWind; }
#endif`)
      .replace('#include <project_vertex>', /* glsl */`#include <project_vertex>
  { vec4 wp4 = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    wp4 = instanceMatrix * wp4;
  #endif
    vWPos = ( modelMatrix * wp4 ).xyz; }
#ifdef USE_BAKE
  vGI = aGI;
#endif`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <shadowmap_pars_fragment>', '#include <shadowmap_pars_fragment>\n#ifdef USE_TRANSLUCENT\n#include <shadowmask_pars_fragment>\n#endif')
      .replace('#include <common>', /* glsl */`#include <common>
varying vec3 vWPos;
uniform sampler2D uNoiseTex; uniform float uMaskScale; uniform float uMacroAmp; uniform vec3 uGain; uniform float uDirt; uniform float uStain;
vec2 gUv; vec2 gDx; vec2 gDy;   // 视差偏移后的贴图坐标及其屏幕导数
#ifdef USE_POM
  uniform sampler2D uDisp; uniform float uPomScale;
  #define TEXG( s, uv ) textureGrad( s, uv, gDx, gDy )
  #define TEXG2( s, uv ) textureGrad( s, uv, gDx * uUv2, gDy * uUv2 )
#else
  #define TEXG( s, uv ) texture2D( s, uv )
  #define TEXG2( s, uv ) texture2D( s, uv )
#endif
${AO_GLSL}
#ifdef USE_BAKE
  varying vec4 vGI;
#endif
#ifdef USE_LAYER2
  uniform sampler2D uMap2; uniform sampler2D uNormal2; uniform sampler2D uOrm2; uniform float uUv2; uniform vec3 uGain2; uniform vec2 uSoft;
#endif`)
      .replace('#include <map_fragment>', /* glsl */`
  gUv = vMapUv; gDx = dFdx( vMapUv ); gDy = dFdy( vMapUv );
#ifdef USE_POM
  // 视差遮蔽映射：沿视线在高度场里步进求交，让石缝有真实的凹凸与遮挡
  { vec3 pv = - vViewPosition; float pfade = 1.0 - smoothstep( 14.0, 26.0, length( pv ) );
    if ( pfade > 0.0 ) {
      vec3 Ng = normalize( vNormal );
      vec3 dp1 = dFdx( pv ), dp2 = dFdy( pv ); vec3 dp2p = cross( dp2, Ng ), dp1p = cross( Ng, dp1 );
      vec3 Tg = dp2p * gDx.x + dp1p * gDy.x; vec3 Bg = dp2p * gDx.y + dp1p * gDy.y;
      float tinv = inversesqrt( max( max( dot( Tg, Tg ), dot( Bg, Bg ) ), 1e-12 ) ); Tg *= tinv; Bg *= tinv;
      vec3 Vv = normalize( vViewPosition );
      vec3 vt = vec3( dot( Vv, Tg ), dot( Vv, Bg ), max( dot( Vv, Ng ), 0.14 ) );
      float nSteps = floor( mix( 18.0, 7.0, vt.z ) );
      vec2 dUv = vt.xy / vt.z * uPomScale * pfade / nSteps;
      float plod = max( 0.0, log2( max( length( gDx ), length( gDy ) ) * 1024.0 ) );
      float layer = 1.0 / nSteps, cur = 0.0; vec2 pp = vMapUv; float dep = 1.0 - textureLod( uDisp, pp, plod ).r; float prevDep = dep;
      for ( int i = 0; i < 18; i ++ ) { if ( cur >= dep ) break; pp -= dUv; prevDep = dep; dep = 1.0 - textureLod( uDisp, pp, plod ).r; cur += layer; }
      float after = dep - cur, before = prevDep - ( cur - layer );
      gUv = pp + dUv * clamp( after / min( after - before, - 1e-5 ), 0.0, 1.0 );
    } }
#endif
  vec4 texel1 = TEXG( map, gUv );
  vec4 macroN = texture2D( uNoiseTex, vWPos.xz * 0.021 + vWPos.y * vec2( 0.013, 0.017 ) );
  float layerMask = 0.0;
  vec3 baseCol = texel1.rgb * uGain;
#ifdef USE_TEXALPHA
  diffuseColor.a *= texel1.a;
#endif`)
      .replace('#include <color_fragment>', /* glsl */`
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
  baseCol *= vColor.rgb;
#endif
#if defined( USE_LAYER2 ) && defined( USE_COLOR_ALPHA )
  { vec2 uvL = gUv * uUv2;
    vec4 texel2 = TEXG2( uMap2, uvL );
    float nz = texture2D( uNoiseTex, vWPos.xz * uMaskScale + vWPos.y * vec2( 0.37, 0.61 ) * uMaskScale ).g;
    float raw = vColor.a + ( nz - 0.5 ) * 1.5 + ( macroN.b - 0.5 ) * 0.6 + ( 0.5 - dot( texel1.rgb, vec3( 0.3333 ) ) ) * 0.5;
    layerMask = smoothstep( 0.50, 0.50 + uSoft.x, raw ) * step( 0.02, vColor.a );
    vec3 c2 = texel2.rgb * uGain2 * mix( uSoft.y, 1.0, smoothstep( 0.55, 0.72, raw ) );
    baseCol = mix( baseCol, c2, layerMask ); }
#endif
  // 墙脚积尘：竖直面贴近地面的一圈更暗更黄，上沿用噪声打散
  if ( uDirt > 0.0 ) {
    vec3 nW = inverseTransformDirection( normalize( vNormal ), viewMatrix );
    float sk = ( 1.0 - smoothstep( 0.35, 0.7, abs( nW.y ) ) ) * ( 1.0 - smoothstep( 0.04, 0.45 + macroN.g * 1.2, vWPos.y ) ) * step( - 0.6, vWPos.y );
    baseCol = mix( baseCol, baseCol * vec3( 0.58, 0.53, 0.45 ) + vec3( 0.022, 0.018, 0.012 ), sk * uDirt );
  }
  baseCol *= ( 1.0 - uMacroAmp * 0.5 ) + uMacroAmp * macroN.r;
  // 大块污渍：两三米尺度的不规则深色斑
  baseCol *= 1.0 - uStain * smoothstep( 0.5, 0.78, macroN.b ) * ( 0.6 + 0.4 * macroN.g );
  diffuseColor.rgb *= baseCol;`)
      .replace('#include <roughnessmap_fragment>', /* glsl */`
  float roughnessFactor = roughness;
  vec4 orm1 = TEXG( roughnessMap, gUv );
#ifdef USE_LAYER2
  orm1 = mix( orm1, TEXG2( uOrm2, gUv * uUv2 ), layerMask );
#endif
  roughnessFactor *= orm1.g;`)
      .replace('#include <metalnessmap_fragment>', /* glsl */`
  float metalnessFactor = metalness * orm1.b;`)
      .replace('#include <normal_fragment_maps>', /* glsl */`
  vec3 mapN = TEXG( normalMap, gUv ).xyz * 2.0 - 1.0;
#ifdef USE_LAYER2
  mapN = normalize( mix( mapN, TEXG2( uNormal2, gUv * uUv2 ).xyz * 2.0 - 1.0, layerMask ) );
#endif
  mapN.xy *= normalScale;
  normal = normalize( tbn * mapN );`)
      .replace('#include <aomap_fragment>', /* glsl */`
#if defined( USE_TRANSLUCENT ) && NUM_SUN_LIGHTS > 0
  { float backL = max( dot( - normal, sunLights[ 0 ].direction ), 0.0 );
    reflectedLight.directDiffuse += sunLights[ 0 ].color * ( backL * getShadowMask() * 0.8 ) * material.diffuseContribution * RECIPROCAL_PI * vec3( 1.0, 0.93, 0.80 ); }
#endif
#ifdef USE_BAKE
  reflectedLight.indirectDiffuse *= vGI.a * uSkyTint;
  // 反射探针归一化的近似：天空反射按天空可见度衰减，再补上周围受光表面的平均反弹光
  reflectedLight.indirectSpecular *= mix( 0.06, 1.0, vGI.a * vGI.a ) * uSkyTint;
  reflectedLight.indirectSpecular += vGI.rgb * RECIPROCAL_PI * material.specularColor * ( 1.0 - 0.6 * material.roughness );
  reflectedLight.indirectDiffuse += vGI.rgb * material.diffuseContribution * RECIPROCAL_PI;
#endif
  float ambientOcclusion = ( orm1.r - 1.0 ) * aoMapIntensity + 1.0;
  // 间接光遮蔽 = 贴图 AO × 屏幕空间 AO；只作用于间接漫反射 / 间接高光
  float aoAll = ambientOcclusion * mix( 1.0, screenAO( vWPos ), uAOAmt );
  reflectedLight.indirectDiffuse *= aoMultiBounce( aoAll, clamp( material.diffuseContribution, 0.0, 1.0 ) );
  float aoNV = saturate( dot( normal, normalize( vViewPosition ) ) );
  reflectedLight.indirectSpecular *= saturate( pow( aoNV + aoAll, exp2( - 16.0 * material.roughness - 1.0 ) ) - 1.0 + aoAll );
  reflectedLight.directDiffuse *= mix( 1.0, ambientOcclusion, 0.5 );`);
  };
  return mat;
}

// 平均反照率（线性），GI 烘焙时用于估算反弹光颜色
export const ALBEDO = {
  plaster: [0.52, 0.49, 0.44], sandstone: [0.44, 0.39, 0.31], paving: [0.33, 0.30, 0.26], concrete: [0.30, 0.29, 0.27],
  wood: [0.20, 0.18, 0.16], woodPaint: [0.62, 0.60, 0.56], metalPaint: [0.52, 0.52, 0.48], metalRusty: [0.42, 0.30, 0.20], corrugated: [0.45, 0.44, 0.42], shutter: [0.5, 0.5, 0.5],
  steel: [0.20, 0.20, 0.21], fabric: [0.78, 0.76, 0.70], fabricStripe: [0.50, 0.48, 0.44], tiles: [0.30, 0.40, 0.50],
  rugRed: [0.22, 0.06, 0.05], rugBlue: [0.08, 0.12, 0.20], rock: [0.34, 0.23, 0.14], terrain: [0.41, 0.35, 0.26], glass: [0.05, 0.06, 0.08],
  proto: [0.5, 0.5, 0.5], brick: [0.25, 0.16, 0.11], leaf: [0.14, 0.22, 0.05], grass: [0.4, 0.35, 0.15], emissive: [0.9, 0.7, 0.4], dark: [0.03, 0.03, 0.03], poster: [0.5, 0.45, 0.38],
};

// 每种材质的默认平铺尺寸（米/重复）与表面类型（脚步声、弹孔特效）
export const MATINFO = {
  plaster: { ts: 2.6, surf: 'stone', a: 0.16 }, sandstone: { ts: 3, surf: 'stone' }, paving: { ts: 2.4, surf: 'stone', a: 0.3 }, concrete: { ts: 3, surf: 'stone' },
  wood: { ts: 1.5, surf: 'wood' }, woodPaint: { ts: 1.8, surf: 'wood' }, metalPaint: { ts: 2, surf: 'metal' }, metalRusty: { ts: 1.5, surf: 'metal' }, corrugated: { ts: 1.8, surf: 'metal' }, shutter: { ts: 1.6, surf: 'metal' },
  steel: { ts: 1, surf: 'metal' }, fabric: { ts: 1, surf: 'cloth' }, fabricStripe: { ts: 1.6, surf: 'cloth' }, tiles: { ts: 1, surf: 'stone' },
  rugRed: { ts: 1, surf: 'cloth' }, rugBlue: { ts: 1, surf: 'cloth' }, rock: { ts: 2, surf: 'stone' }, terrain: { ts: 3, surf: 'sand', a: 0 }, glass: { ts: 1, surf: 'glass' },
  proto: { ts: 4, surf: 'stone' }, leaf: { ts: 1, surf: 'cloth' }, grass: { ts: 1, surf: 'cloth' }, emissive: { ts: 1, surf: 'stone' }, dark: { ts: 1, surf: 'metal' }, poster: { ts: 1, surf: 'stone' }, sign: { ts: 1, surf: 'stone' },
};

export function buildMaterials(T, env) {
  const M = {};
  const std = (name, t, o = {}, e = {}) => {
    const m = new THREE.MeshStandardMaterial({
      map: t.map, normalMap: t.normalMap, roughnessMap: t.ormMap, metalnessMap: t.ormMap, aoMap: t.ormMap,
      roughness: 1, metalness: 1, vertexColors: true, envMap: env.skyOnly, envMapIntensity: 1.0, ...o,
    });
    m.name = name;
    M[name] = enhance(m, T, { key: name, ...e });
    return m;
  };
  const ph = (slot) => !!(T[slot] && T[slot].photo);
  std('plaster', T.plaster, { normalScale: new THREE.Vector2(1.0, 1.0) }, { stain: 0.2, dirt: 0.8, layer2: T.brick, uv2: ph('plaster') ? 1.73 : 2.0, gain: ph('plaster') ? [1.95, 2.02, 2.25] : [1, 1, 1], gain2: ph('brick') ? [1.05, 1.25, 1.7] : [1, 1, 1], macroAmp: 0.3 });
  std('sandstone', T.sandstone, {}, { stain: 0.22, dirt: 0.7, gain: ph('sandstone') ? [1.17, 1.35, 1.76] : [1, 1, 1], macroAmp: 0.3, pom: T.sandstone.dispMap ? { tex: T.sandstone.dispMap, depth: 0.05 / MATINFO.sandstone.ts } : null });
  std('paving', T.paving, {}, { stain: 0.34, layer2: T.sand, uv2: 1.3, maskScale: 0.016, soft: 0.3, edge: 0.82, gain2: ph('sand') ? [1.32, 1.9, 2.55] : [1, 1, 1], gain: ph('paving') ? [1.56, 1.95, 2.6] : [1, 1, 1], macroAmp: 0.34, pom: T.paving.dispMap ? { tex: T.paving.dispMap, depth: 0.035 / MATINFO.paving.ts } : null });
  std('concrete', T.concrete, {}, { stain: 0.28, dirt: 0.8, gain: ph('concrete') ? [1.18, 1.25, 1.4] : [1, 1, 1] });
  std('wood', T.wood, {}, { gain: ph('wood') ? [1.2, 1.25, 1.3] : [1, 1, 1], macroAmp: 0.2 });
  std('woodPaint', T.woodPaint, {}, { stain: 0.15, dirt: 0.8, gain: ph('woodPaint') ? [1.2, 1.35, 1.45] : [1, 1, 1], macroAmp: 0.2 });
  std('metalPaint', T.metalPaint, {}, { stain: 0.2, dirt: 0.8, gain: ph('metalPaint') ? [1.6, 1.8, 2.6] : [1, 1, 1], macroAmp: 0.2 });
  std('metalRusty', T.metalRusty, {}, { macroAmp: 0.2 });
  std('corrugated', T.corrugated, {}, { dirt: 0.8, gain: ph('corrugated') ? [1.6, 1.6, 1.6] : [1, 1, 1], macroAmp: 0.2 });
  std('shutter', T.shutter || T.corrugated, {}, { dirt: 0.8, gain: ph('shutter') ? [1.5, 1.5, 1.5] : [1, 1, 1], macroAmp: 0.2 });
  std('steel', T.steel);
  std('fabric', T.fabric, { side: THREE.DoubleSide }, { wind: true, macroAmp: 0.1 });
  std('fabricStripe', T.fabricStripe, { side: THREE.DoubleSide }, { wind: true, macroAmp: 0.1 });
  std('tiles', T.tiles, {}, { macroAmp: 0.15 });
  std('rugRed', T.rugRed, {}, { macroAmp: 0.1 });
  std('rugBlue', T.rugBlue, {}, { macroAmp: 0.1 });
  std('rock', T.rock, {}, { gain: ph('rock') ? [1.6, 2.5, 4.2] : [1, 1, 1], macroAmp: 0.3 });
  std('terrain', T.sand, {}, { stain: 0.22, layer2: T.dirt, uv2: ph('sand') ? 1.45 : 1.0, maskScale: 0.02, macroAmp: 0.3, gain: ph('sand') ? [1.32, 1.9, 2.55] : [1, 1, 1], gain2: ph('dirt') ? [0.64, 0.95, 1.4] : [1, 1, 1] });

  // 灰盒（地图原型）：浅灰底 + 1 米细线 + 4 米粗线的网格，颜色全靠顶点色（按功能分色，见 world/refinery.js）。
  // 一张贴图覆盖 4×4 米（MATINFO.proto.ts = 4），世界坐标对齐，所以随便哪个面上数格子都能读出尺寸
  {
    const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
    g.fillStyle = '#e4e4e2'; g.fillRect(0, 0, 512, 512);
    g.fillStyle = 'rgba(0,0,0,0.035)'; for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if ((i + j) & 1) g.fillRect(i * 128, j * 128, 128, 128);   // 隔格略深，远处也看得出格子
    g.fillStyle = 'rgba(40,40,40,0.30)'; for (let k = 0; k < 4; k++) { g.fillRect(k * 128, 0, 2, 512); g.fillRect(0, k * 128, 512, 2); }
    g.fillStyle = 'rgba(30,30,30,0.55)'; g.fillRect(0, 0, 5, 512); g.fillRect(0, 0, 512, 5);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
    const m = new THREE.MeshStandardMaterial({ map: t, normalMap: T.plaster.normalMap, normalScale: new THREE.Vector2(0.08, 0.08), roughnessMap: T.concrete.ormMap, metalnessMap: T.concrete.ormMap, aoMap: T.concrete.ormMap, roughness: 0.9, metalness: 0, vertexColors: true, envMap: env.skyOnly, envMapIntensity: 0.8 });
    m.name = 'proto'; M.proto = enhance(m, T, { key: 'proto', macroAmp: 0.06 });
  }

  // 玻璃：使用完整环境贴图（反射天空与地面）
  M.glass = enhance(new THREE.MeshStandardMaterial({
    color: 0xffffff, map: T.steel.map, normalMap: T.plaster.normalMap, normalScale: new THREE.Vector2(0.06, 0.06),
    roughnessMap: T.steel.ormMap, metalnessMap: T.steel.ormMap, aoMap: T.steel.ormMap,
    roughness: 0.22, metalness: 0.0, vertexColors: true, envMap: env.full, envMapIntensity: 1.5,
  }), T, { key: 'glass', macroAmp: 0.5 });
  M.glass.name = 'glass';

  // 叶片（alpha test，双面）
  M.leaf = enhance(new THREE.MeshStandardMaterial({
    map: T.palmLeaf, normalMap: T.fabric.normalMap, roughnessMap: T.fabric.ormMap, metalnessMap: T.fabric.ormMap, aoMap: T.fabric.ormMap,
    alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.7, metalness: 0, vertexColors: true, envMap: env.skyOnly,
  }), T, { key: 'leaf', wind: true, texAlpha: true, macroAmp: 0.2 });
  M.leaf.name = 'leaf';
  M.leafDepth = new THREE.MeshDepthMaterial({ map: T.palmLeaf, alphaTest: 0.35, side: THREE.DoubleSide });
  M.grass = enhance(new THREE.MeshStandardMaterial({
    map: T.grass, normalMap: T.fabric.normalMap, roughnessMap: T.fabric.ormMap, metalnessMap: T.fabric.ormMap, aoMap: T.fabric.ormMap,
    alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.9, metalness: 0, vertexColors: true, envMap: env.skyOnly,
  }), T, { key: 'grass', wind: true, texAlpha: true, macroAmp: 0.25 });
  M.grass.name = 'grass';

  // 海报 / 喷漆标记（贴花，轻微偏移避免 Z 冲突）
  const decal = (name, tex, alphaTest) => {
    const m = new THREE.MeshStandardMaterial({
      map: tex, normalMap: T.plaster.normalMap, roughnessMap: T.plaster.ormMap, metalnessMap: T.plaster.ormMap, aoMap: T.plaster.ormMap,
      roughness: 1, metalness: 0, vertexColors: true, envMap: env.skyOnly, transparent: alphaTest === 0, alphaTest,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false,
    });
    m.name = name;
    M[name] = enhance(m, T, { key: name, texAlpha: true, macroAmp: 0.3 });
  };
  decal('poster', T.posters, 0);
  decal('sign', T.signs, 0);

  // 自发光（灯笼、指示灯）：HDR 亮度，触发泛光
  M.emissive = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, fog: true });
  M.emissive.name = 'emissive';
  M.dark = new THREE.MeshStandardMaterial({ color: 0x0b0b0c, roughness: 0.7, metalness: 0.3, vertexColors: true, envMap: env.skyOnly });
  M.dark.name = 'dark';
  return M;
}
