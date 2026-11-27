// 大气模块：空气透视雾 + 体积云海 + 屏幕空间光柱。由 app.setAtmosphere(createAtmosphere(app)) 接入。
//
// 每帧三个通道：
//   1. 光柱（1/4 分辨率）：从每个像素朝太阳的屏幕位置采样场景深度，得到“这条视线上的雾有多少被石峰挡住了阳光”。
//   2. 云海（1/2 分辨率）：在 [cloudBottom, cloudTopMax] 这一层里光线步进。云顶形状来自一张 CPU 生成的可平铺高度图
//      （和影片云海同一套“千米云丘 + 几百米云团 + 菜花折痕”的配方），再用 GPU 生成的可平铺 3D Perlin-Worley 噪声侵蚀边缘。
//      空域用高度场的安全步长跳过；自阴影沿太阳方向在高度图上取 3 个点估算；雾（云前面的那一段）在步进里一起积分。
//   3. 合成（全分辨率）：解析的指数高度雾（朝太阳发金、背光偏冷）+ 光柱调制 + 按深度加权把半分辨率云海贴回去。
//
// 云海尾波（update(dt, craft) 驱动）：一张跟着飞行器走的俯视“尾波图”（云坐标系，随风漂），每帧做一步
//   衰减 + 波动方程 + 沿航迹盖章：B = 犁出的沟（米，慢慢弥合），R/G = 向外传的云浪（高度 / 速度，飞得比波速快
//   所以自然是一个 V 形），A = 被掀起的飞沫。云海步进时把它加到云顶高度上，沟里压暗、浪的朝阳面提亮，
//   飞沫是云面上方薄薄一层雾。离云面越近、飞得越快越明显；离云面 30 m 以上不盖章，图上的东西散尽后整套关掉。
//
// 抖动用固定的屏幕空间图案（不随时间变），所以没有时间累积、也就没有拖影；噪点由深度感知上采样抹平。
//
// 对外：
//   createAtmosphere(app) → { render, setSize, update(dt, craft), uniforms, params, cloudHeightAt(x, z), inCloud(pos), wake }
//     update：每帧在 render 之前调；craft = { position（Vector3）, velocity, forward, speed, boost（0..1） }
//   fogUniforms / FOG_GLSL：其它透明物体（筋斗云、尾流…）想和雾一致时用同一套函数和 uniform。
//   getNoise3D(renderer)：共享的 128³ 可平铺噪声（R=Perlin-Worley，G/B=两档 Worley，A=Perlin）。
import * as THREE from 'three';
import { SUN_DIR, SUN_COLOR, SUN_INTENSITY, CLOUD_TOP_Y, QUALITY, QUALITY_NAME, num } from './common.js';
import { fullscreenPass } from './app.js';

// ---------------------------------------------------------------- 可调常量
export const ATMO = {
  cloudTopY: CLOUD_TOP_Y,        // 云顶高度图的基准；实际云顶 = cloudTopY + 高度图（中位数约 -6 m，见 cloudMedian）
  cloudMedian: -13.0,            // 云顶中位数相对 cloudTopY 的偏移（米）
  cloudThickness: 80.0,          // 云层厚度（云底 = cloudTopY - 这个值）
  tile: 4096.0,                  // 高度图平铺尺寸（米）
  noiseTile: 112.0,              // 3D 噪声平铺尺寸（米）
  wind: new THREE.Vector2(2.4, -1.0),   // 云海漂移（米/秒，x/z）
  sigma: 0.13,                   // 云的消光系数（1/米）
  maxDist: 3200.0,               // 云步进的最远距离（再远全是雾）
  fogDensity: 0.00120,           // 参考高度处的雾消光（1/米）
  fogRefY: CLOUD_TOP_Y,
  fogFalloff: 1.0 / 70.0,        // 雾密度随高度衰减（1/米）
  fogCool: new THREE.Color(0.36, 0.42, 0.52),   // 背光方向的雾色（线性 HDR）
  fogWarm: new THREE.Color(1.30, 1.02, 0.70),   // 朝太阳方向的雾色
  fogGlare: new THREE.Color(1.20, 0.85, 0.45),  // 太阳附近额外的金色眩光
  shaft: 0.75,                   // 光柱强度
  // ---- 云海尾波
  wakeSize: { low: 512, high: 1024, ultra: 1024 }[QUALITY_NAME] || 1024,   // 尾波图分辨率
  wakeExtent: 768.0,             // 尾波图盖多大一块（米）；飞行器偏在图的前部，身后留得多
  wakeNear: 4.0, wakeFar: 30.0,  // 离当地云顶这么近时尾波最强 / 这么远就没有了（米）
  wakeTrench: 6.5,               // 沟深（米，贴着云面飞时）
  wakeRadius: 3.4,               // 沟的半宽（米），加速时再宽 40%
  wakeLead: 3.0,                 // 盖章点比飞行器靠前多少（米，另加 0.08 × 速度）
  wakeSpeed: 11.0,               // 云浪向外传的速度（米/秒）：V 形的半张角 = asin(它 / 飞行速度)
  wakeWave: 1.0,                 // 云浪高度倍数
  wakeHeal: 6.0,                 // 沟弥合的时间常数（秒）
  wakeSpray: 1.0,                // 飞沫强度倍数
};

// 雾：指数高度雾的解析积分 + 随视线与太阳夹角变化的颜色。其它模块 import 这两样就能和大气保持一致。
export const fogUniforms = {
  uFogA: { value: new THREE.Vector4(ATMO.fogDensity, ATMO.fogFalloff, ATMO.fogRefY, 0) },
  uFogCool: { value: ATMO.fogCool.clone() },
  uFogWarm: { value: ATMO.fogWarm.clone() },
  uFogGlare: { value: ATMO.fogGlare.clone() },
  uFogSun: { value: SUN_DIR.clone() },
  uFogUnder: { value: 0 },          // 相机在云层下面的程度（0..1）：云下没有直射阳光，雾变暗变冷
};
export const FOG_GLSL = /* glsl */`
uniform vec4 uFogA;                 // x: 参考高度处密度, y: 高度衰减(1/m), z: 参考高度
uniform vec3 uFogCool, uFogWarm, uFogGlare, uFogSun; uniform float uFogUnder;
float fogTau(vec3 ro, vec3 rd, float t) {            // 从 ro 沿 rd 走 t 米的雾光学厚度
  float a = uFogA.x * exp(-(ro.y - uFogA.z) * uFogA.y);
  float dy = rd.y * uFogA.y;
  float x = dy * t;
  float f = abs(x) < 1e-3 ? t * (1.0 - 0.5 * x) : (1.0 - exp(-x)) / dy;
  return min(a * f, 40.0);
}
vec3 fogColor(vec3 rd) {
  float mu = dot(rd, uFogSun);
  float w = pow(0.5 + 0.5 * mu, 3.0);
  vec3 c = mix(uFogCool, uFogWarm, w);
  c += uFogGlare * pow(max(mu, 0.0), 20.0);
  return mix(c, uFogCool * 0.5, uFogUnder);
}`;

// 云海对透明物体的遮挡：透明物体画在大气合成之后，钻进云里时不会自动被云盖住，
// 所以它们的着色器用这段（只查高度图，4 步）估算“相机到这一点之间隔着多少云”，再向云的颜色靠。
const _noSea = new THREE.DataTexture(new Uint16Array([THREE.DataUtils.toHalfFloat(-1e4), 0]), 1, 1, THREE.RGFormat, THREE.HalfFloatType);
_noSea.needsUpdate = true;
export const seaUniforms = {
  tSeaHeight: { value: _noSea },
  uSeaA: { value: new THREE.Vector4(ATMO.cloudTopY, 1 / ATMO.tile, ATMO.sigma, 0) },     // 云顶基准, 1/平铺, 消光, 是否启用
  uSeaWind: { value: new THREE.Vector3(ATMO.wind.x, ATMO.wind.y, 0) },                   // 风 x/z, 时间
  uSeaCol: { value: new THREE.Vector3(0.80, 0.76, 0.70) },
};
export const SEA_VEIL_GLSL = /* glsl */`
uniform sampler2D tSeaHeight; uniform vec4 uSeaA; uniform vec3 uSeaWind, uSeaCol;
float seaVeil(vec3 a, vec3 b) {                 // a（相机）到 b 之间云海的透过率
  if (uSeaA.w < 0.5) return 1.0;
  float tau = 0.0;
  for (int i = 0; i < 4; i++) {
    vec3 p = mix(a, b, (float(i) + 0.5) / 4.0);
    float top = uSeaA.x + texture2D(tSeaHeight, (p.xz - uSeaWind.xy * uSeaWind.z) * uSeaA.y).r;
    tau += smoothstep(-2.0, 6.0, top - p.y);
  }
  return exp(-tau * 0.25 * length(b - a) * uSeaA.z);
}`;

// 其它模块（筋斗云的飞沫）想知道脚下云顶有多高时用：createAtmosphere 之后 heightAt(x, z) 可用，没有大气模块时是 null
export const seaQuery = { heightAt: null };

// ---------------------------------------------------------------- 3D 噪声（GPU 生成，可平铺）
const NOISE3D_FRAG = /* glsl */`
uniform float uZ; varying vec2 vUv;
vec3 hash33(vec3 p, float per) {
  p = mod(p, per);
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453123);
}
float worley(vec3 x, float freq) {
  x *= freq; vec3 id = floor(x), f = fract(x); float md = 8.0;
  for (int k = -1; k <= 1; k++) for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec3 g = vec3(float(i), float(j), float(k));
    vec3 r = g + hash33(id + g, freq) - f;
    md = min(md, dot(r, r));
  }
  return 1.0 - clamp(sqrt(md), 0.0, 1.0);
}
float gnoise(vec3 x, float freq) {
  x *= freq; vec3 id = floor(x), f = fract(x); vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float v[8];
  for (int n = 0; n < 8; n++) {
    vec3 g = vec3(float(n & 1), float((n >> 1) & 1), float((n >> 2) & 1));
    vec3 gr = normalize(hash33(id + g, freq) * 2.0 - 1.0);
    v[n] = dot(gr, f - g);
  }
  return mix(mix(mix(v[0], v[1], u.x), mix(v[2], v[3], u.x), u.y), mix(mix(v[4], v[5], u.x), mix(v[6], v[7], u.x), u.y), u.z);
}
float worleyFbm(vec3 p, float f) { return worley(p, f) * 0.625 + worley(p, f * 2.0) * 0.25 + worley(p, f * 4.0) * 0.125; }
float perlinFbm(vec3 p, float f) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 5; i++) { s += a * gnoise(p, f); n += a; a *= 0.5; f *= 2.0; }
  return clamp(0.5 + 0.9 * s / n, 0.0, 1.0);
}
float remap(float x, float a, float b, float c, float d) { return c + (x - a) / (b - a) * (d - c); }
void main() {
  vec3 p = vec3(vUv, uZ);
  float pf = perlinFbm(p, 4.0);
  float wf = worleyFbm(p, 4.0);
  float pw = clamp(remap(pf, wf - 1.0, 1.0, 0.0, 1.0), 0.0, 1.0);
  gl_FragColor = vec4(pw, worleyFbm(p, 8.0), worleyFbm(p, 16.0), pf);
}`;
const _noiseCache = new WeakMap();
export function getNoise3D(renderer, size = 128) {
  if (_noiseCache.has(renderer)) return _noiseCache.get(renderer);
  const rt = new THREE.WebGL3DRenderTarget(size, size, size, { format: THREE.RGBAFormat, type: THREE.UnsignedByteType, depthBuffer: false });
  const tex = rt.texture;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uZ: { value: 0 } }, depthTest: false, depthWrite: false,
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`, fragmentShader: NOISE3D_FRAG,
  });
  const sc = new THREE.Scene(), cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); quad.frustumCulled = false; sc.add(quad);
  const prev = renderer.getRenderTarget();
  for (let z = 0; z < size; z++) {
    mat.uniforms.uZ.value = (z + 0.5) / size;
    renderer.setRenderTarget(rt, z);
    renderer.render(sc, cam);
  }
  renderer.setRenderTarget(prev);
  mat.dispose(); quad.geometry.dispose();
  _noiseCache.set(renderer, tex);
  return tex;
}

// ---------------------------------------------------------------- 云顶高度图（CPU 生成，可平铺）
function makePerlin2(seed) {
  const p = new Uint8Array(512), perm = new Uint8Array(256);
  for (let i = 0; i < 256; i++) perm[i] = i;
  let s = seed >>> 0;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = perm[i]; perm[i] = perm[j]; perm[j] = t; }
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  const GX = [1, -1, 1, -1, 1, -1, 0, 0], GY = [1, 1, -1, -1, 0, 0, 1, -1];
  const g = (h, x, y) => GX[h & 7] * x + GY[h & 7] * y;
  return (x, y, per) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const x0 = ((xi % per) + per) % per, x1 = (x0 + 1) % per, y0 = ((yi % per) + per) % per, y1 = (y0 + 1) % per;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const a = g(p[p[x0] + y0], xf, yf), b = g(p[p[x1] + y0], xf - 1, yf), c = g(p[p[x0] + y1], xf, yf - 1), d = g(p[p[x1] + y1], xf - 1, yf - 1);
    return a + u * (b - a) + v * (c - a) + u * v * (a - b - c + d);
  };
}
function buildHeightMap(N = 1024) {
  // 波段（每个平铺周期里的圈数，权重）：U 千米级起伏、n0 云丘、n1 云团、n2 小团、n3 细碎；M 是“翻涌程度”（0 平滑层云，1 积云）
  const bands = [
    { f: [[2, 0.65], [3, 0.35]], seed: 11 }, { f: [[4, 0.6], [6, 0.4]], seed: 17 }, { f: [[8, 0.6], [13, 0.4]], seed: 12 },
    { f: [[18, 0.6], [27, 0.4]], seed: 13 }, { f: [[40, 0.6], [58, 0.4]], seed: 14 }, { f: [[2, 0.7], [3, 0.3]], seed: 15 },
  ];
  const arr = bands.map(b => {
    const noises = b.f.map((_, i) => makePerlin2(b.seed * 31 + i));
    const a = new Float32Array(N * N); let sum = 0, sum2 = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      let v = 0;
      for (let k = 0; k < b.f.length; k++) { const fr = b.f[k][0]; v += b.f[k][1] * noises[k]((i + 0.5) / N * fr, (j + 0.5) / N * fr, fr); }
      a[j * N + i] = v; sum += v; sum2 += v * v;
    }
    const mean = sum / (N * N), sd = Math.sqrt(sum2 / (N * N) - mean * mean) || 1;
    for (let i = 0; i < a.length; i++) a[i] = (a[i] - mean) / sd;
    return a;
  });
  const puff = n => 0.35 * Math.abs(n) + 0.95 * Math.pow(Math.max(n, 0), 1.15);     // 圆顶 + 尖谷（菜花折痕）
  const sm = x => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
  const H = new Float32Array(N * N), M = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) {
    const m = sm(arr[5][i] * 0.45 + 0.55);
    M[i] = m;
    H[i] = 4.5 * arr[0][i] + 7.0 * puff(arr[1][i]) * (0.5 + 0.5 * m) + 11.5 * puff(arr[2][i]) * (0.55 + 0.45 * m)
      + 8.0 * puff(arr[3][i]) * (0.22 + 0.78 * m) + 4.6 * puff(arr[4][i]) * (0.08 + 0.92 * m);
  }
  const samp = []; for (let i = 0; i < N * N; i += 37) samp.push(H[i]);
  samp.sort((a, b) => a - b);
  const med = samp[samp.length >> 1];
  let max = -1e9;
  for (let i = 0; i < N * N; i++) { H[i] += ATMO.cloudMedian - med; if (H[i] > max) max = H[i]; }
  const p95 = samp[Math.floor(samp.length * 0.95)] + ATMO.cloudMedian - med;
  const data = new Uint16Array(N * N * 2);
  for (let i = 0; i < N * N; i++) { data[i * 2] = THREE.DataUtils.toHalfFloat(H[i]); data[i * 2 + 1] = THREE.DataUtils.toHalfFloat(M[i]); }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGFormat, THREE.HalfFloatType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
  return { tex, H, N, max, p95 };
}

// ---------------------------------------------------------------- 着色器
const RAY_GLSL = /* glsl */`
uniform mat4 uProjInv, uViewInv; uniform vec3 uCamPos;
vec3 viewRay(vec2 uv) {                         // 世界空间视线方向
  vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  return normalize(mat3(uViewInv) * (v.xyz / v.w));
}
float viewDist(vec2 uv, float d) {              // 深度值 → 到相机的直线距离（米）；天空返回很大的数
  if (d >= 1.0) return 1e9;
  vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return length(v.xyz / v.w);
}
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }`;

const SHAFT_FRAG = RAY_GLSL + /* glsl */`
uniform sampler2D tDepth; uniform vec2 uSunUV; uniform float uShaftOn; varying vec2 vUv;
void main() {
  // 朝太阳的屏幕位置走 28 步：路上被近处不透明物体挡住的比例 → 这条视线上的雾有多少处在阴影里
  vec2 delta = (uSunUV - vUv);
  float len = length(delta);
  delta *= min(1.0, 0.85 / max(len, 1e-4)) / 28.0;
  float j = ign(gl_FragCoord.xy);
  float lit = 0.0, wsum = 0.0, w = 1.0;
  vec2 uv = vUv + delta * j;
  for (int i = 0; i < 28; i++) {
    vec2 q = clamp(uv, vec2(0.001), vec2(0.999));
    float d = texture2D(tDepth, q).x;
    float open = d >= 1.0 ? 1.0 : 0.6 * smoothstep(1500.0, 4500.0, viewDist(q, d));
    lit += open * w; wsum += w; w *= 0.965;
    uv += delta;
  }
  gl_FragColor = vec4(mix(1.0, lit / wsum, uShaftOn));
}`;

// 尾波图的一步模拟。R: 云浪高度(米)  G: 云浪速度(米/秒)  B: 沟深(米)  A: 飞沫
const WAKE_FRAG = /* glsl */`
uniform sampler2D tPrev;
uniform vec2 uShift, uTexel;      // 图的中心这一帧挪了多少（uv）, 一个像素（uv）
uniform vec4 uK;                  // x: c²·dt/dx², y: 浪速度的衰减, z: 沟的衰减, w: 飞沫的衰减
uniform vec4 uMix;                // x: dt, y: 沟的扩散, z: 飞沫的扩散, w: 浪高的衰减
uniform vec4 uSeg;                // 这一帧飞过的线段 a.xz → b.xz（相对图中心，米）
uniform vec4 uStamp;              // x: 沟深(米), y: 推开云浪的力度, z: 飞沫, w: 半宽(米)
uniform float uExtent; uniform vec2 uOrigin;      // 图盖多大（米）, 图中心（云坐标系，米）
varying vec2 vUv;
float vnoise(vec2 p) {            // 便宜的值噪声：让飞沫一块有一块没有
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  vec4 h = fract(sin(vec4(dot(i, vec2(127.1, 311.7)), dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7)), dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7)), dot(i + vec2(1.0, 1.0), vec2(127.1, 311.7)))) * 43758.5453);
  return mix(mix(h.x, h.y, f.x), mix(h.z, h.w, f.x), f.y);
}
vec4 prev(vec2 uv) { vec2 e = min(uv, 1.0 - uv); return min(e.x, e.y) < 0.0 ? vec4(0.0) : texture2D(tPrev, uv); }
void main() {
  vec2 uv = vUv + uShift;
  vec4 c = prev(uv), l = prev(uv - vec2(uTexel.x, 0.0)), r = prev(uv + vec2(uTexel.x, 0.0)), d = prev(uv - vec2(0.0, uTexel.y)), u = prev(uv + vec2(0.0, uTexel.y));
  vec4 avg = 0.25 * (l + r + d + u);
  float v = (c.g + uK.x * (avg.r - c.r) * 4.0) * uK.y;
  float h = clamp(mix(c.r, avg.r, 0.02) * uMix.w + v * uMix.x, -5.0, 7.0);
  float T = mix(c.b, avg.b, uMix.y) * uK.z;
  float S = mix(c.a, avg.a, uMix.z) * uK.w;
  if (uStamp.w > 0.0) {
    vec2 p = (vUv - 0.5) * uExtent, pa = p - uSeg.xy, ba = uSeg.zw - uSeg.xy;
    float dist = length(pa - ba * clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0)), q = dist / uStamp.w;
    T = max(T, uStamp.x * (1.0 - smoothstep(0.35, 1.7, q)));
    v += uStamp.y * (0.5 * exp(-0.5 * q * q) - exp(-q * q));                    // 中间往下压、两侧往上拱（总量为零）→ 向外传的是先峰后谷的浪
    // 沟两侧甩起的飞沫：按位置成团成簇（两层噪声相乘再卡阈值），不是两条连续的线
    vec2 pc = p + uOrigin;
    float patchy = smoothstep(0.30, 0.62, vnoise(pc * 0.11) * 0.65 + vnoise(pc * 0.31 + 7.3) * 0.5);
    S = min(S + uStamp.z * 2.2 * patchy * exp(-(q - 1.15) * (q - 1.15) / 0.30), 2.0);
  }
  gl_FragColor = vec4(h, v, T, S);
}`;

const CLOUD_FRAG = RAY_GLSL + FOG_GLSL + /* glsl */`
precision highp sampler3D;
uniform sampler2D tDepth, tHeight; uniform sampler3D tNoise;
uniform vec3 uSunDir, uSunLight, uAmbTop, uAmbBot;
uniform vec4 uLayer;        // x: 云顶基准高度, y: 云底, z: 云顶最高处, w: 消光系数
uniform vec4 uScale;        // x: 1/高度图平铺, y: 1/噪声平铺, z: 最远距离, w: 时间
uniform vec2 uWind;
uniform sampler2D tWake; uniform vec4 uWake;   // 尾波图；xy: 图中心（云坐标系 = 世界 xz 减去风的漂移）, z: 1/范围, w: 强度（0 = 关）
varying vec2 vUv;
const float MARGIN = 13.0;  // 噪声侵蚀能把云面最多抬高这么多（米）
const float SPRAY_H = 9.0;  // 飞沫最高能到云面上方这么多（米）
vec2 hmap(vec2 xz) { return texture2D(tHeight, (xz - uWind * uScale.w) * uScale.x).rg; }
// 尾波：x = 云顶高度的偏移（米：沟为负、浪为正）, y = 飞沫, z = 沟深（米）
vec3 wakeAt(vec2 xz) {
  vec2 uv = (xz - uWind * uScale.w - uWake.xy) * uWake.z + 0.5, e = min(uv, 1.0 - uv);
  float m = min(e.x, e.y);
  if (m <= 0.0) return vec3(0.0);
  vec4 w = texture2D(tWake, uv) * (smoothstep(0.0, 0.05, m) * uWake.w);
  return vec3(w.r - w.b, w.a, w.b);
}
float densityAt(vec3 p, vec2 hm, float dist, float spray, float trench, out float cav, out float e) {
  float s = uLayer.x + hm.x - p.y;                                   // 云面以下的深度（米）
  vec3 q = p * uScale.y + vec3(-uWind.x, 0.25, -uWind.y) * (uScale.w * uScale.y * 1.25);
  vec4 n = texture(tNoise, q);
  e = (n.r * 0.46 + n.g * 0.42 + n.b * 0.12) * 2.0 - 1.0;
  cav = clamp(0.5 + 0.9 * e, 0.0, 1.0);                               // 鼓包亮、凹缝暗
  s += e * mix(5.0, MARGIN, hm.y) * (1.0 - 0.45 * trench);                // 刚犁过的沟里云面平整一些，沟的形状才看得出来
  float d = smoothstep(0.0, mix(5.5, 1.8, hm.y), s);
  // 近处再用高频 Worley 把边缘咬碎一点
  float edge = 4.0 * d * (1.0 - d);
  d *= clamp(1.0 + edge * (n.b * 2.0 - 1.2) * smoothstep(420.0, 60.0, dist), 0.0, 1.3);
  d *= smoothstep(uLayer.y, uLayer.y + 14.0, p.y);                    // 云底淡出
  // 飞沫：云面上方被掀起来的一层稀薄的雾，一缕一缕的，越高越淡
  if (spray > 0.01) d = max(d, min(spray, 1.0) * 0.85 * (1.0 - smoothstep(-1.0, 2.5 + SPRAY_H * min(spray, 1.0), -s)) * smoothstep(0.30, 0.62, n.g + 0.25 * spray));
  return d;
}
float densityLite(vec3 p, vec2 hm, out float e) {                                   // 只算形状（给朝太阳的阴影采样用）
  float s = uLayer.x + hm.x - p.y;
  vec3 q = p * uScale.y + vec3(-uWind.x, 0.25, -uWind.y) * (uScale.w * uScale.y * 1.25);
  vec4 n = texture(tNoise, q);
  e = (n.r * 0.46 + n.g * 0.42 + n.b * 0.12) * 2.0 - 1.0;
  s += e * mix(5.0, MARGIN, hm.y);
  return smoothstep(0.0, mix(5.5, 1.8, hm.y), s);
}
void main() {
  vec3 ro = uCamPos, rd = viewRay(vUv);
  float tScene = viewDist(vUv, texture2D(tDepth, vUv).x);
  float tMax = min(tScene, uScale.z);
  float ta = (uLayer.y - ro.y) / rd.y, tb = (uLayer.z - ro.y) / rd.y;
  float t0 = max(min(ta, tb), 0.0), t1 = min(max(ta, tb), tMax);
  if (abs(rd.y) < 1e-5) { t0 = 0.0; t1 = (ro.y > uLayer.y && ro.y < uLayer.z) ? tMax : -1.0; }
  vec3 col = vec3(0.0); float T = 1.0;
  if (t1 > t0) {
    float mu = dot(rd, uSunDir);
    float fwd = pow(max(mu, 0.0), 2.5);
    vec3 fogc = fogColor(rd);
    float hlen = length(rd.xz);
    float jit = ign(gl_FragCoord.xy);
    float jscale = 0.72 + 0.56 * jit;
    float t = t0 + jit * max(1.3, t0 * STEP_K);
    bool done = false; float lastAbove = 1e9;
    for (int i = 0; i < CLOUD_STEPS; i++) {
      if (t >= t1 || T < 0.015) { done = true; break; }
      vec3 p = ro + rd * t;
      vec2 hm = hmap(p.xz);
      vec3 wk = uWake.w > 0.0 ? wakeAt(p.xz) : vec3(0.0);
      float hbase = hm.x; hm.x += wk.x;                                 // 尾波：沟把云面压低、浪把云面抬高
      float above = p.y - (uLayer.x + hm.x);
      float dt = max(1.3, t * STEP_K) * jscale * (1.0 + clamp(-above - 6.0, 0.0, 40.0) * 0.12);
      lastAbove = above;
      float margin = MARGIN + SPRAY_H * min(wk.y, 1.0);
      if (above > margin) {            // 还在云面上方：按高度场的安全步长跳
        t += max(dt, (above - margin) * (0.62 + 0.2 * jit) / max(0.75 * hlen - rd.y, 0.08));
        continue;
      }
      float cav, e0, e1;
      float trench = clamp(wk.z / 7.0, 0.0, 1.0);
      float d = densityAt(p, hm, t, wk.y, trench, cav, e0);
      if (d > 0.004) {
        // 自阴影：沿太阳方向在高度图上取 3 点，看头顶压着多厚的云；第 1 个点顺便给出朝阳/背阳的坡度
        vec3 q1 = p + uSunDir * 14.0, q2 = p + uSunDir * 42.0, q3 = p + uSunDir * 110.0;
        float h1 = hmap(q1.xz).x;
        float occ = smoothstep(-1.0, 5.0, uLayer.x + h1 - q1.y) * 14.0;
        occ += smoothstep(-1.0, 6.0, uLayer.x + hmap(q2.xz).x - q2.y) * 28.0;
        occ += smoothstep(-1.0, 8.0, uLayer.x + hmap(q3.xz).x - q3.y) * 68.0;
        float dnear = densityLite(p + uSunDir * 7.0, hm, e1);
        float slope = (h1 - hbase) / 14.0 + (e1 - e0) * mix(5.0, MARGIN, hm.y) / 7.0 * 0.6;       // 朝太阳方向云面的坡度（大形 + 细节）
        float crest = 0.0;
        if (uWake.w > 0.0 && (wk.z > 0.02 || abs(wk.x) > 0.02 || wk.y > 0.02)) {                    // 尾波自己的坡度：沟壁和浪的朝阳面亮、背阳面暗
          slope += (wakeAt(p.xz + uSunDir.xz * 3.5).x - wk.x) / 3.5 * 0.9;
          crest = clamp((wk.x + wk.z) / 2.5, -1.0, 1.0);                                             // 浪本身的高度（不含沟）
        }
        float facing = clamp(0.55 - slope * 2.4, 0.06, 1.7);
        float depth = max(-above, 0.0);
        float tau = dnear * uLayer.w * 9.0 + occ * uLayer.w * 0.7 + depth * uLayer.w * 0.5;
        float sunT = 0.85 * exp(-tau) + 0.15 * exp(-tau * 0.2);           // 第二项近似多次散射
        float thin = exp(-depth * 0.16) * (1.0 - 0.65 * d);
        vec3 L = uSunLight * sunT * facing * (0.40 + 2.0 * fwd * thin);     // 逆光时薄边透亮
        L += mix(uAmbBot, uAmbTop, exp(-depth * 0.055)) * (0.55 + 0.45 * exp(-occ * 0.02));
        L *= mix(0.50, 1.25, cav) * (1.0 - 0.30 * trench) * (1.0 + (crest > 0.0 ? 0.40 : 0.22) * crest + 0.30 * min(wk.y, 1.0));   // 沟底照不到多少天光；浪峰和飞沫更亮
        float a = 1.0 - exp(-d * uLayer.w * min(dt, t1 - t));
        float tf = exp(-fogTau(ro, rd, t));
        col += T * a * (L * tf + fogc * (1.0 - tf));
        T *= 1.0 - a;
      }
      t += dt;
    }
    if (!done && lastAbove < 0.0 && T > 0.015) {          // 步数用完时还埋在云里：后面当作不透明的云深处
      float tf = exp(-fogTau(ro, rd, t));
      col += T * (mix(uAmbBot, uAmbTop, 0.3) * tf + fogc * (1.0 - tf));
      T = 0.0;
    }
  }
  gl_FragColor = vec4(col, T < 0.02 ? 0.0 : T);
}`;

// 云海缓冲的 3x3 深度感知滤波：步进抖动用的是 IGN，任意 3x3 邻域平均后接近均匀分布，所以这一步基本能把颗粒抹平
const DENOISE_FRAG = RAY_GLSL + /* glsl */`
uniform sampler2D tCloudRaw, tDepth; uniform vec2 uLowSize; varying vec2 vUv;
void main() {
  vec2 px = 1.0 / uLowSize;
  float d0 = min(viewDist(vUv, texture2D(tDepth, vUv).x), 5000.0);
  vec4 acc = vec4(0.0); float ws = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 q = vUv + vec2(float(i), float(j)) * px * 1.5;          // 采样点落在像素之间，双线性再帮着平均一圈
    float dq = min(viewDist(q, texture2D(tDepth, q).x), 5000.0);
    float dd = abs(dq - d0);
    float w = (i == 0 ? 1.4 : 1.0) * (j == 0 ? 1.4 : 1.0) / (1.0 + dd * dd / (0.0025 * d0 * d0 + 1.0));
    acc += texture2D(tCloudRaw, q) * w; ws += w;
  }
  gl_FragColor = acc / ws;
}`;

const COMPOSITE_FRAG = RAY_GLSL + FOG_GLSL + /* glsl */`
uniform sampler2D tColor, tDepth, tCloud, tShaft, tHeight;
uniform vec2 uLowSize, uWind; uniform float uShaft; uniform vec3 uSunDir; uniform vec4 uLayer, uScale;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tColor, vUv).rgb;
  float d = texture2D(tDepth, vUv).x;
  vec3 rd = viewRay(vUv);
  float dist = viewDist(vUv, d);
  // 埋在云海里 / 云海下面的不透明物体照不到直射阳光（场景灯光不知道有云），这里按“在云顶以下多深”压暗
  if (d < 1.0) {
    vec3 wp = uCamPos + rd * dist;
    float top = uLayer.x + texture2D(tHeight, (wp.xz - uWind * uScale.w) * uScale.x).r;
    c *= mix(1.0, 0.42, smoothstep(2.0, 26.0, top - wp.y));
  }
  // ---- 雾
  float tau = fogTau(uCamPos, rd, min(dist, 60000.0));
  if (d >= 1.0) tau = rd.y > 0.0 ? min(40.0, uFogA.x * exp(-(uCamPos.y - uFogA.z) * uFogA.y) / max(rd.y * uFogA.y, 1e-5)) : 40.0;
  float tf = exp(-tau);
  vec3 fogc = fogColor(rd);
  // 光柱：只调制朝太阳一侧的雾（被石峰挡住的方向变暗，漏光的方向更亮）
  float mu = dot(rd, uSunDir);
  float sh = texture2D(tShaft, vUv).r;
  float k = uShaft * smoothstep(0.0, 0.85, mu);
  fogc *= mix(1.0, 0.25 + 1.12 * sh, k);
  c = c * tf + fogc * (1.0 - tf);
  // ---- 云海：半分辨率结果按深度加权上采样（避免石峰轮廓处的光晕）
  vec2 p = vUv * uLowSize - 0.5; vec2 f = fract(p); vec2 b = (floor(p) + 0.5) / uLowSize; vec2 px = 1.0 / uLowSize;
  vec4 acc = vec4(0.0); float wsum = 0.0;
  for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
    vec2 q = b + vec2(float(i), float(j)) * px;
    float dq = min(viewDist(q, texture2D(tDepth, q).x), 5000.0);
    float wb = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y);
    float dd = abs(dq - min(dist, 5000.0));
    float w = (wb + 0.02) / (1.0 + dd * dd / (0.0025 * dq * dq + 1.0));
    acc += texture2D(tCloud, q) * w; wsum += w;
  }
  vec4 cl = acc / wsum;
  c = c * cl.a + cl.rgb;
  gl_FragColor = vec4(c, 1.0);
}`;

// ---------------------------------------------------------------- 模块
export function createAtmosphere(app) {
  const renderer = app.renderer;
  const steps = num('cloudSteps', app.quality.cloudSteps || QUALITY.cloudSteps || 48);
  const noise = getNoise3D(renderer);
  const hm = buildHeightMap(1024);
  const topMax = ATMO.cloudTopY + hm.max + 13.5;
  const bottom = ATMO.cloudTopY - ATMO.cloudThickness;
  let W = 2, H = 2;
  const rtOpt = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
  const rtCloudRaw = new THREE.WebGLRenderTarget(2, 2, rtOpt), rtCloud = new THREE.WebGLRenderTarget(2, 2, rtOpt);
  const rtShaft = new THREE.WebGLRenderTarget(2, 2, { type: THREE.UnsignedByteType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const cam = { uProjInv: { value: new THREE.Matrix4() }, uViewInv: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() } };
  const sunLight = new THREE.Vector3(SUN_COLOR.r, SUN_COLOR.g, SUN_COLOR.b).multiplyScalar(SUN_INTENSITY * 0.48);
  const uniforms = {
    ...cam, ...fogUniforms,
    tColor: { value: null }, tDepth: { value: null }, tHeight: { value: hm.tex }, tNoise: { value: noise },
    tCloud: { value: rtCloud.texture }, tCloudRaw: { value: rtCloudRaw.texture }, tShaft: { value: rtShaft.texture },
    uSunDir: { value: SUN_DIR.clone() }, uSunLight: { value: sunLight },
    uAmbTop: { value: new THREE.Vector3(0.17, 0.185, 0.225) }, uAmbBot: { value: new THREE.Vector3(0.06, 0.066, 0.085) },
    uLayer: { value: new THREE.Vector4(ATMO.cloudTopY, bottom, topMax, ATMO.sigma) },
    uScale: { value: new THREE.Vector4(1 / ATMO.tile, 1 / ATMO.noiseTile, ATMO.maxDist, 0) },
    uWind: { value: ATMO.wind.clone() },
    uSunUV: { value: new THREE.Vector2(0.5, 0.5) }, uShaftOn: { value: 1 }, uShaft: { value: num('shaft', ATMO.shaft) },
    uLowSize: { value: new THREE.Vector2(1, 1) },
    tWake: { value: null }, uWake: { value: new THREE.Vector4(0, 0, 1 / ATMO.wakeExtent, 0) },
  };
  const stepK = { low: 0.032, high: 0.021, ultra: 0.015 }[QUALITY_NAME] || 0.021;
  const cloudScale = num('cloudScale', { low: 0.5, high: 0.75, ultra: 1.0 }[QUALITY_NAME] || 0.75);   // 云海通道相对全分辨率的比例
  const shaftPass = fullscreenPass(SHAFT_FRAG, uniforms);
  const cloudPass = fullscreenPass(CLOUD_FRAG, uniforms, { defines: { CLOUD_STEPS: steps, STEP_K: stepK.toFixed(4) } });
  const denoisePass = fullscreenPass(DENOISE_FRAG, uniforms);
  const compPass = fullscreenPass(COMPOSITE_FRAG, uniforms);
  const _v = new THREE.Vector3(), _fwd = new THREE.Vector3();
  let now = 0;
  seaUniforms.tSeaHeight.value = hm.tex; seaUniforms.uSeaA.value.w = 1;

  // ---- 云海尾波：两张来回倒的尾波图 + 一步模拟
  const WN = num('wakeSize', ATMO.wakeSize), WE = ATMO.wakeExtent, wdx = WE / WN;
  const wakeOpt = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping };
  let wakeA = new THREE.WebGLRenderTarget(WN, WN, wakeOpt), wakeB = new THREE.WebGLRenderTarget(WN, WN, wakeOpt);
  const wakeU = {
    tPrev: { value: wakeA.texture }, uShift: { value: new THREE.Vector2() }, uTexel: { value: new THREE.Vector2(1 / WN, 1 / WN) },
    uK: { value: new THREE.Vector4() }, uMix: { value: new THREE.Vector4() }, uSeg: { value: new THREE.Vector4() }, uStamp: { value: new THREE.Vector4() },
    uExtent: { value: WE }, uOrigin: { value: new THREE.Vector2() },
  };
  const wakePass = fullscreenPass(WAKE_FRAG, wakeU);
  const wake = { on: num('wake', 1) > 0, active: 0, center: new THREE.Vector2(), last: new THREE.Vector2(), has: false, prox: 0, alt: 0, cleared: false };
  uniforms.tWake.value = wakeA.texture;
  const _c0 = new THREE.Color();
  function clearWake() {
    const rt0 = renderer.getRenderTarget(), a0 = renderer.getClearAlpha(); renderer.getClearColor(_c0);
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(wakeA); renderer.clear(); renderer.setRenderTarget(wakeB); renderer.clear();
    renderer.setRenderTarget(rt0); renderer.setClearColor(_c0, a0);
    wake.cleared = true;
  }

  /** 每帧在 render 之前调：飞行器贴近云面时在尾波图上盖章，并把尾波图向前推一步。
   *  craft = { position, velocity, forward, speed, boost }（世界坐标；forward 可省，用 velocity 的方向） */
  function update(dt, craft) {
    if (!wake.on || !craft || !craft.position || !(dt > 0)) return;
    const t = app.time, P = craft.position;
    const speed = craft.speed !== undefined ? craft.speed : (craft.velocity ? craft.velocity.length() : 0), boost = craft.boost || 0;
    let fx = craft.forward ? craft.forward.x : (craft.velocity ? craft.velocity.x : 0), fz = craft.forward ? craft.forward.z : (craft.velocity ? craft.velocity.z : 0);
    const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
    // 盖章的位置比飞行器靠前一点：云在它到之前就被顶开，浪峰正好在它两侧翻起来（追尾视角看得到）
    const lead = ATMO.wakeLead + speed * 0.08;
    const cx = P.x + fx * lead - ATMO.wind.x * t, cz = P.z + fz * lead - ATMO.wind.y * t;                 // 云坐标系（跟着云一起漂）
    const alt = P.y - cloudHeightAt(P.x, P.z);
    const sm = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
    const prox = (1 - sm(ATMO.wakeNear, ATMO.wakeFar, alt)) * sm(6, 30, speed);     // 离云面越近越强；悬停时不犁
    wake.prox = prox; wake.alt = alt;
    if (prox > 0.004) wake.active = 16; else wake.active = Math.max(0, wake.active - dt);
    if (wake.active <= 0) { uniforms.uWake.value.w = 0; wake.has = false; return; }   // 图上的东西都散尽了：整套关掉
    if (!wake.cleared) clearWake();
    // 图的中心：飞行器偏在前 1/4 处（身后留得多），对齐到像素格
    const ncx = Math.round((cx - fx * WE * 0.27) / wdx) * wdx, ncz = Math.round((cz - fz * WE * 0.27) / wdx) * wdx;
    const moved = wake.has ? Math.hypot(cx - wake.last.x, cz - wake.last.y) : 0;
    if (!wake.has || moved > 90 || Math.abs(ncx - wake.center.x) > WE * 0.5 || Math.abs(ncz - wake.center.y) > WE * 0.5) {      // 刚开始 / 瞬移：从这里重新起头
      if (wake.has) clearWake();
      wake.center.set(ncx, ncz); wake.last.set(cx, cz); wake.has = true;
    }
    wakeU.uShift.value.set((ncx - wake.center.x) / WE, (ncz - wake.center.y) / WE);
    wake.center.set(ncx, ncz);
    const h = Math.min(dt, 1 / 30);                                                 // 步长封顶，保证波动方程稳定
    const c = ATMO.wakeSpeed;
    wakeU.uK.value.set(c * c * h / (wdx * wdx), Math.exp(-h / 2.4), Math.exp(-h / ATMO.wakeHeal), Math.exp(-h / 2.3));
    wakeU.uMix.value.set(h, Math.min(0.5, 2.2 * h), Math.min(0.6, 9 * h), Math.exp(-h / 7));
    wakeU.uSeg.value.set(wake.last.x - ncx, wake.last.y - ncz, cx - ncx, cz - ncz); wakeU.uOrigin.value.set(ncx, ncz);
    const rad = ATMO.wakeRadius * (1 + 0.4 * boost), spd = 0.55 + speed / 80;
    const deep = ATMO.wakeTrench + Math.min(24, Math.max(0, -alt));                 // 钻进云里：沟要一直开到飞行器所在的深度
    const close = 1 - sm(2, 13, alt);
    wakeU.uStamp.value.set(prox > 0.004 ? deep * Math.pow(prox, 1.3) : 0, 900 * prox * spd * ATMO.wakeWave * h, 8.0 * prox * close * spd * ATMO.wakeSpray * h, prox > 0.004 ? rad : 0);
    wake.last.set(cx, cz);
    wakeU.tPrev.value = wakeA.texture;
    wakePass.render(renderer, wakeB);
    const tmp = wakeA; wakeA = wakeB; wakeB = tmp;
    uniforms.tWake.value = wakeA.texture;
    uniforms.uWake.value.set(ncx, ncz, 1 / WE, sm(0, 2.5, wake.active));
  }

  function setSize(w, h) {
    W = w; H = h;
    const lw = Math.max(2, Math.ceil(w * cloudScale)), lh = Math.max(2, Math.ceil(h * cloudScale));
    rtCloudRaw.setSize(lw, lh); rtCloud.setSize(lw, lh); uniforms.uLowSize.value.set(lw, lh);
    rtShaft.setSize(Math.max(2, Math.ceil(w / 4)), Math.max(2, Math.ceil(h / 4)));
  }

  function render(rendererIn, src, camera, outTarget, time /*, dt */) {
    if (src.width !== W || src.height !== H) setSize(src.width, src.height);
    now = time;
    uniforms.tColor.value = src.color; uniforms.tDepth.value = src.depth;
    uniforms.uProjInv.value.copy(camera.projectionMatrixInverse); uniforms.uViewInv.value.copy(camera.matrixWorld);
    uniforms.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
    uniforms.uScale.value.w = time; seaUniforms.uSeaWind.value.z = time;
    // 太阳在屏幕上的位置；太阳转到相机背后时光柱淡出
    camera.getWorldDirection(_fwd);
    const facing = _fwd.dot(SUN_DIR);
    _v.copy(uniforms.uCamPos.value).addScaledVector(SUN_DIR, 1000).project(camera);
    uniforms.uSunUV.value.set(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5);
    const camY = uniforms.uCamPos.value.y, topHere = cloudHeightAt(uniforms.uCamPos.value.x, uniforms.uCamPos.value.z);
    const under = 1 - THREE.MathUtils.smoothstep(camY, topHere - 45, topHere - 8);
    fogUniforms.uFogUnder.value = under;
    uniforms.uShaftOn.value = THREE.MathUtils.smoothstep(facing, 0.05, 0.35) * (1 - under);
    shaftPass.render(rendererIn, rtShaft);
    cloudPass.render(rendererIn, rtCloudRaw);
    denoisePass.render(rendererIn, rtCloud);
    compPass.render(rendererIn, outTarget);
  }

  /** 世界坐标 (x, z) 处当前的云顶高度（米，不含 3D 噪声的 ±9 m 侵蚀）。给玩法判断“是否贴云 / 钻云”用。 */
  function cloudHeightAt(x, z) {
    const N = hm.N, s = N / ATMO.tile;
    let u = (x - ATMO.wind.x * now) * s - 0.5, v = (z - ATMO.wind.y * now) * s - 0.5;
    const i0 = Math.floor(u), j0 = Math.floor(v), fu = u - i0, fv = v - j0;
    const w = k => ((k % N) + N) % N;
    const a = hm.H[w(j0) * N + w(i0)], b = hm.H[w(j0) * N + w(i0 + 1)], c = hm.H[w(j0 + 1) * N + w(i0)], d = hm.H[w(j0 + 1) * N + w(i0 + 1)];
    return ATMO.cloudTopY + a + fu * (b - a) + fv * (c - a) + fu * fv * (a - b - c + d);
  }

  seaQuery.heightAt = cloudHeightAt;
  return {
    render, setSize, update, uniforms, params: ATMO, cloudHeightAt,
    wake,          // 尾波的当前状态（调试用）：prox = 盖章强度 0..1, alt = 离云顶的高度, active = 还要保留多少秒
    inCloud(pos) { return pos.y > bottom && pos.y < cloudHeightAt(pos.x, pos.z); },
    stats: { cloudSteps: steps, topMax, bottom, p95: ATMO.cloudTopY + hm.p95, median: ATMO.cloudTopY + ATMO.cloudMedian },
  };
}
