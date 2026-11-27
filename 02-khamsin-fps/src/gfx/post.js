// 后处理管线：HDR + MSAA → SSAO → 泛光 → 体积光(径向) → 自动曝光 → ACES 调色合成
import * as THREE from 'three';
import { ATMOS } from './sky.js';
import { G } from './materials.js';
import { canvasTex } from './texgen.js';

// 太阳级联阴影的共享 uniform：体积光通道与浮尘粒子都用它判断某个世界坐标是否被太阳照到
export const SUNSH = { tShadow: { value: null }, uShMat0: { value: new THREE.Matrix4() }, uShMat1: { value: new THREE.Matrix4() }, uCas0: { value: new THREE.Vector4(-1e10, 1e9, 1e9, 0) }, uCas1: { value: new THREE.Vector4(1e9, 1e9, 1e9, 0) } };
export const SUNSH_GLSL = /* glsl */`
precision highp sampler2DShadow;
uniform sampler2DShadow tShadow; uniform mat4 uShMat0; uniform mat4 uShMat1; uniform vec4 uCas0; uniform vec4 uCas1;
float sunVisB(vec3 wp, float vd, float bias){
  if (vd >= uCas1.y) return 1.0;
  vec4 sc = vd < uCas0.y ? uShMat0 * vec4(wp, 1.0) : uShMat1 * vec4(wp, 1.0);
  sc.xyz /= sc.w;
  if (sc.x <= 0.0 || sc.x >= 1.0 || sc.y <= 0.0 || sc.y >= 1.0 || sc.z >= 1.0) return 1.0;
  return texture(tShadow, vec3(sc.xy, sc.z - bias));
}
float sunVis(vec3 wp, float vd){ return sunVisB(wp, vd, 0.0008); }
// 空气中的采样点（体积光、浮尘）没有自阴影问题，用反向的小偏移：墙背后、楼板下方的一薄层空气不会被“漏光”点亮
float sunVisAir(vec3 wp, float vd){ return sunVisB(wp, vd, -0.00025); }`;

const VERT = /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const DEPTH_FN = /* glsl */`
uniform sampler2D tDepth; uniform float uNear; uniform float uFar; uniform vec2 uProj;
float linZ(float d){ return uNear * uFar / (uFar - d * (uFar - uNear)); }
vec3 viewPos(vec2 uv){ float z = linZ(texture2D(tDepth, uv).r); return vec3((uv * 2.0 - 1.0) * uProj * z, -z); }
`;

const AO_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
${DEPTH_FN}
uniform vec2 uRes; uniform float uRadius; uniform float uIntensity;
#define TAU 6.2831853
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main(){
  float d = texture2D(tDepth, vUv).r;
  if (d >= 0.99999) { gl_FragColor = vec4(1.0); return; }
  vec2 px = 1.0 / uRes;
  vec3 P = viewPos(vUv);
  vec3 Pr = viewPos(vUv + vec2(px.x, 0.0)), Pl = viewPos(vUv - vec2(px.x, 0.0));
  vec3 Pu = viewPos(vUv + vec2(0.0, px.y)), Pd = viewPos(vUv - vec2(0.0, px.y));
  vec3 dx = abs(Pr.z - P.z) < abs(P.z - Pl.z) ? Pr - P : P - Pl;
  vec3 dy = abs(Pu.z - P.z) < abs(P.z - Pd.z) ? Pu - P : P - Pd;
  vec3 N = normalize(cross(dx, dy));
  float z = -P.z;
  float R = min(uRadius, z * 0.32);
  float rpx = clamp(R / (z * uProj.y * 2.0) * uRes.y, 3.0, 72.0);
  // 4×4 交错旋转图案：配合后面的 4×4 盒式双边模糊可以把采样噪声完全抵消
  vec2 fc = floor(gl_FragCoord.xy); float pid = mod(fc.x, 4.0) + mod(fc.y, 4.0) * 4.0;
  float rot = (mod(pid * 7.0, 16.0) + 0.5) / 16.0 * TAU; float rj = fract(pid * 0.6180339);
  float bias = 0.012 + 0.0025 * z;
  float occ = 0.0;
  const int NS = 18;
  for (int i = 0; i < NS; i++){
    float fi = (float(i) + rj) / float(NS);
    float ang = rot + float(i) * 2.39996;
    vec2 suv = vUv + vec2(cos(ang), sin(ang)) * sqrt(fi) * rpx * px;
    vec3 v = viewPos(suv) - P;
    float vv = dot(v, v); float vn = dot(v, N);
    float f = max(R * R - vv, 0.0);
    occ += f * f * f * min(max((vn - bias) / (vv + 0.0008), 0.0), 2.2 / R);   // 封顶：单个贴得很近的遮挡物不会把遮蔽直接打满
  }
  float ao = max(0.0, 1.0 - occ * 5.0 / (pow(R, 6.0) * float(NS)) * uIntensity);
  ao = 0.2 + 0.8 * ao;   // 接触处保留一点底光，不至于成墨团
  ao = mix(ao, 1.0, smoothstep(70.0, 130.0, z));
  ao = mix(1.0, ao, 0.45 + 0.55 * smoothstep(0.35, 1.2, z));
  gl_FragColor = vec4(ao, ao, ao, 1.0);
}`;

const AO_BLUR_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
${DEPTH_FN}
uniform sampler2D tAO; uniform vec2 uDir;
void main(){
  // 4 个半纹素偏移的双线性采样 = 宽度 4 的盒式滤波（两趟后为 4×4），按深度差加权避免跨物体边缘渗色
  float cz = linZ(texture2D(tDepth, vUv).r);
  float sum = 0.0, ws = 0.0;
  for (int i = 0; i < 4; i++){
    vec2 o = uDir * (float(i) - 1.5);
    float zz = linZ(texture2D(tDepth, vUv + o).r);
    float w = max(0.0, 1.0 - abs(zz - cz) / (0.05 * cz + 0.03)) + 0.001;
    sum += texture2D(tAO, vUv + o).r * w; ws += w;
  }
  gl_FragColor = vec4(sum / ws, cz, 0.0, 1.0);   // G 通道存线性深度，供材质重投影采样时做深度校验
}`;

// ---- 体积光：沿视线在空气里步进，逐点查询太阳的级联阴影 → 任意角度可见的光柱与阴影体积；
//      密度 = 贴地的指数高度分布 × 随风平移的 3D 噪声（流动的尘雾） ----
const VOL_FRAG = /* glsl */`
precision highp float; precision highp sampler3D;
varying vec2 vUv;
${DEPTH_FN}
${SUNSH_GLSL}
uniform sampler3D tNoise;
uniform mat4 uCamWorld; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform vec3 uAmbCol;
uniform float uTime; uniform float uDens; uniform float uFall; uniform float uMaxDist; uniform float uG; uniform float uIso; uniform vec3 uWind;
// 室内浮尘体：离镜头最近的 4 个房间 / 地道 / 顶棚街（xyz = 包围盒，min.w = 浓度倍率）。
// 这些地方空气不流通、尘土更重，阳光从窗洞、格栅、板条缝射进来时会被照成一道道光柱（丁达尔效应）
uniform vec4 uBoxMin[4]; uniform vec4 uBoxMax[4]; uniform float uBeam;
float boxDust(vec3 p){
  float m = 0.0;
  for (int i = 0; i < 4; i++){
    vec3 a = clamp((p - uBoxMin[i].xyz) / 0.8, 0.0, 1.0) * clamp((uBoxMax[i].xyz - p) / 0.8, 0.0, 1.0);
    m = max(m, a.x * a.y * a.z * uBoxMin[i].w);
  }
  return m;
}
float hg(float c, float g){ float g2 = g * g; return (1.0 - g2) / (12.566371 * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }
void main(){
  float d = texture2D(tDepth, vUv).r;
  vec3 Pv = viewPos(vUv); vec3 dirV = normalize(Pv);
  float tEnd = d >= 0.99999 ? uMaxDist : min(length(Pv), uMaxDist);
  vec3 ro = uCamWorld[3].xyz; vec3 rdW = mat3(uCamWorld) * dirV;
  float cosS = dot(rdW, uSunDir);
  float phase = mix(hg(cosS, uG), 0.0795775, uIso);
  // 室内浮尘的相函数更接近各向同性，并带一个美术增益：光柱从侧面、背面看也清楚，但不额外加重遮挡（不会变成一团黑雾）
  float phaseIn = mix(phase, 0.0795775, 0.7) * uBeam;
  vec2 fc = floor(gl_FragCoord.xy); float pid = mod(fc.x, 4.0) + mod(fc.y, 4.0) * 4.0; float jit = (mod(pid * 7.0, 16.0) + 0.5) / 16.0;
  const int N = 32;
  vec3 acc = vec3(0.0); float T = 1.0;
  vec3 wOff = uWind * uTime;
  for (int i = 0; i < N; i++){
    // 近处步长小、远处步长大：细光柱（板条缝、叶隙）在近处不会被跨过去
    float f0 = float(i) / float(N), f1 = float(i + 1) / float(N); float b0 = tEnd * f0 * f0, b1 = tEnd * f1 * f1;
    float t = mix(b0, b1, jit), dt = b1 - b0;
    vec3 wp = ro + rdW * t;
    float n = texture(tNoise, wp * 0.05 + wOff).r;   // 噪声贴图本身已含两个倍频
    float base = uDens * exp(-max(wp.y, 0.0) * uFall) * (0.3 + 2.1 * n * n);
    float bd = boxDust(wp);
    float dBox = uDens * bd * (0.5 + 1.4 * n);
    float dens = base + dBox;
    float vis = sunVisAir(wp, t * (-dirV.z));
    // 室内的天光散射很弱（否则暗室会蒙上一层灰雾），浮尘只被直射阳光点亮
    vec3 S = uSunCol * vis * (phase * base + phaseIn * dBox) + uAmbCol * base * (1.0 - 0.75 * min(bd, 1.0));
    float tr = exp(-dens * dt);
    acc += T * S * (1.0 - tr) / max(dens, 1e-6);
    T *= tr;
    if (T < 0.03) break;
  }
  gl_FragColor = vec4(acc, T);
}`;

const VOL_BLUR_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
${DEPTH_FN}
uniform sampler2D tSrc; uniform vec2 uDir;
void main(){
  float cz = linZ(texture2D(tDepth, vUv).r);
  vec4 sum = vec4(0.0); float ws = 0.0;
  for (int i = 0; i < 4; i++){
    vec2 o = uDir * (float(i) - 1.5);
    float zz = linZ(texture2D(tDepth, vUv + o).r);
    float w = max(0.0, 1.0 - abs(zz - cz) / (0.08 * cz + 0.05)) + 0.001;
    sum += texture2D(tSrc, vUv + o) * w; ws += w;
  }
  gl_FragColor = sum / ws;
}`;

// 镜头脏污贴图：随机的柔和圆斑、细小颗粒与几道擦痕
function makeLensDirt() {
  let seed = 9911; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const t = canvasTex(512, 288, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h); g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 90; i++) { const x = rnd() * w, y = rnd() * h, r = 5 + Math.pow(rnd(), 2.2) * 60, a = 0.03 + rnd() * 0.11; const gr = g.createRadialGradient(x, y, r * 0.2, x, y, r); gr.addColorStop(0, `rgba(255,244,225,${a})`); gr.addColorStop(0.8, `rgba(255,240,215,${a * 0.6})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(255,245,230,${0.05 + rnd() * 0.2})`; g.beginPath(); g.arc(rnd() * w, rnd() * h, 0.4 + rnd() * 1.3, 0, 7); g.fill(); }
    g.lineWidth = 0.7; for (let i = 0; i < 14; i++) { const x = rnd() * w, y = rnd() * h, a = rnd() * 6.28, l = 20 + rnd() * 90; g.strokeStyle = `rgba(255,245,230,${0.03 + rnd() * 0.05})`; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * l * 0.5 + rnd() * 10, y + Math.sin(a) * l * 0.5 + rnd() * 10, x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
  }, { srgb: false });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t;
}

// 可平铺的 3D 值噪声（两个倍频），给尘雾密度用
function makeNoise3D(n = 32) {
  let seed = 1234567; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const lat = (L) => { const a = new Float32Array(L * L * L); for (let i = 0; i < a.length; i++) a[i] = rnd(); return a; };
  const A = lat(4), B = lat(8);
  const samp = (a, L, x, y, z) => {
    const fx = x * L, fy = y * L, fz = z * L; const x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz);
    const sm = (t) => t * t * (3 - 2 * t); const tx = sm(fx - x0), ty = sm(fy - y0), tz = sm(fz - z0);
    const at = (i, j, k) => a[((i % L + L) % L) + ((j % L + L) % L) * L + ((k % L + L) % L) * L * L];
    const l = (p, q, t) => p + (q - p) * t;
    return l(l(l(at(x0, y0, z0), at(x0 + 1, y0, z0), tx), l(at(x0, y0 + 1, z0), at(x0 + 1, y0 + 1, z0), tx), ty), l(l(at(x0, y0, z0 + 1), at(x0 + 1, y0, z0 + 1), tx), l(at(x0, y0 + 1, z0 + 1), at(x0 + 1, y0 + 1, z0 + 1), tx), ty), tz);
  };
  const data = new Uint8Array(n * n * n);
  for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const x = (i + 0.5) / n, y = (j + 0.5) / n, z = (k + 0.5) / n; data[i + j * n + k * n * n] = Math.max(0, Math.min(255, Math.round((samp(A, 4, x, y, z) * 0.66 + samp(B, 8, x, y, z) * 0.34) * 255))); }
  const t = new THREE.Data3DTexture(data, n, n, n); t.format = THREE.RedFormat; t.type = THREE.UnsignedByteType; t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping; t.unpackAlignment = 1; t.needsUpdate = true; return t;
}

const DOWN_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uFirst;
vec3 S(float x, float y){ return min(texture2D(tSrc, vUv + vec2(x, y) * uTexel).rgb, vec3(120.0)); }
float kw(vec3 c){ return 1.0 / (1.0 + dot(c, vec3(0.2126, 0.7152, 0.0722))); }
void main(){
  vec3 a = S(-2.0, 2.0), b = S(0.0, 2.0), c = S(2.0, 2.0);
  vec3 d = S(-2.0, 0.0), e = S(0.0, 0.0), f = S(2.0, 0.0);
  vec3 g = S(-2.0, -2.0), h = S(0.0, -2.0), i = S(2.0, -2.0);
  vec3 j = S(-1.0, 1.0), k = S(1.0, 1.0), l = S(-1.0, -1.0), m = S(1.0, -1.0);
  vec3 col;
  if (uFirst > 0.5) {
    vec3 g0 = (a + b + d + e) * 0.25, g1 = (b + c + e + f) * 0.25, g2 = (d + e + g + h) * 0.25, g3 = (e + f + h + i) * 0.25, g4 = (j + k + l + m) * 0.25;
    float w0 = 0.125 * kw(g0), w1 = 0.125 * kw(g1), w2 = 0.125 * kw(g2), w3 = 0.125 * kw(g3), w4 = 0.5 * kw(g4);
    col = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
  } else {
    col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
}`;

const UP_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tLow; uniform sampler2D tHigh; uniform vec2 uTexel; uniform float uMix;
vec3 L(float x, float y){ return texture2D(tLow, vUv + vec2(x, y) * uTexel).rgb; }
void main(){
  vec3 t = L(0.0, 0.0) * 4.0 + (L(-1.0, 0.0) + L(1.0, 0.0) + L(0.0, -1.0) + L(0.0, 1.0)) * 2.0
         + (L(-1.0, -1.0) + L(1.0, -1.0) + L(-1.0, 1.0) + L(1.0, 1.0));
  t /= 16.0;
  gl_FragColor = vec4(mix(texture2D(tHigh, vUv).rgb, t, uMix), 1.0);
}`;

const GODMASK_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tScene; uniform sampler2D tDepth; uniform vec2 uSunUv; uniform float uAspect;
void main(){
  float d = texture2D(tDepth, vUv).r;
  vec3 c = texture2D(tScene, vUv).rgb;
  vec2 q = (vUv - uSunUv) * vec2(uAspect, 1.0);
  float w = smoothstep(1.1, 0.0, length(q));
  float sky = step(0.99999, d);
  gl_FragColor = vec4(min(c, vec3(6.0)) * sky * w * w, 1.0);
}`;

const GODBLUR_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tSrc; uniform vec2 uSunUv; uniform float uLen;
void main(){
  vec2 delta = (uSunUv - vUv) * uLen;
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 8; i++){ acc += texture2D(tSrc, vUv + delta * (float(i) / 8.0)).rgb; }
  gl_FragColor = vec4(acc / 8.0, 1.0);
}`;

const EXPOSE_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tPrev; uniform sampler2D tSmall; uniform sampler2D tDepth;
uniform float uDt; uniform vec2 uSunUv; uniform float uSunFront; uniform float uAspect;
void main(){
  vec3 avg = texture2D(tSmall, vec2(0.5, 0.5)).rgb * 0.4
    + (texture2D(tSmall, vec2(0.3, 0.4)).rgb + texture2D(tSmall, vec2(0.7, 0.4)).rgb + texture2D(tSmall, vec2(0.3, 0.65)).rgb + texture2D(tSmall, vec2(0.7, 0.65)).rgb) * 0.15;
  float lum = clamp(dot(avg, vec3(0.2126, 0.7152, 0.0722)), 0.03, 6.0);
  vec4 prev = texture2D(tPrev, vec2(0.5));
  // 人眼的明适应快、暗适应慢：走到亮处约半秒收住，走进暗处要一两秒才慢慢看清
  float k = 1.0 - exp(-uDt * (lum > prev.r ? 2.3 : 1.1));
  float adapted = prev.r + (lum - prev.r) * k;
  float vis = 0.0;
  for (int i = 0; i < 16; i++){
    float a = float(i) * 2.39996; float r = 0.004 + 0.012 * sqrt((float(i) + 0.5) / 16.0);
    vec2 uv = uSunUv + vec2(cos(a) / uAspect, sin(a)) * r;
    if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) vis += step(0.99999, texture2D(tDepth, uv).r);
  }
  vis = vis / 16.0 * uSunFront;
  float v2 = prev.g + (vis - prev.g) * (1.0 - exp(-uDt * 14.0));
  gl_FragColor = vec4(adapted, v2, lum, 1.0);   // b：当前瞬时亮度（合成时与 adapted 比较，得到“还没适应过来”的程度）
}`;

const COMPOSITE_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
${DEPTH_FN}
uniform sampler2D tScene; uniform sampler2D tAO; uniform sampler2D tBloom; uniform sampler2D tGod; uniform sampler2D tExpo; uniform sampler2D tVol; uniform float uVol; uniform float uHeat; uniform sampler2D tDirt; uniform float uLensDirt; uniform vec2 uVolRes;
uniform vec2 uRes; uniform float uTime;
uniform float uAO; uniform float uBloom; uniform float uGod; uniform float uExposure; uniform float uKey; uniform float uIndoor;
uniform float uCA; uniform float uSpeed; uniform float uSharpen; uniform float uVignette; uniform float uGrain;
uniform float uHurt; uniform float uLowHP; uniform float uFlash; uniform float uFade; uniform float uADS; uniform float uSat; uniform float uContrast;
uniform float uFlare; uniform vec2 uSunUv; uniform float uAspect; uniform int uDebug; uniform vec3 uTint; uniform float uShift; uniform vec3 uShiftCol;

float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
vec3 RRTAndODTFit(vec3 v){ vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 aces(vec3 c){
  const mat3 inM = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 outM = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  return clamp(outM * RRTAndODTFit(inM * c), 0.0, 1.0);
}
vec3 agxContrast(vec3 x){ vec3 x2 = x * x; vec3 x4 = x2 * x2; return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232; }
vec3 agx(vec3 color){
  const mat3 inset = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995), vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903), vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
  const mat3 outset = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826), vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294), vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
  const mat3 toRec2020 = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
  const mat3 fromRec2020 = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
  color = inset * (toRec2020 * color);
  color = clamp((log2(max(color, 1e-10)) + 12.47393) / 16.5, 0.0, 1.0);
  color = outset * agxContrast(color);
  color = pow(max(vec3(0.0), color), vec3(2.2));
  return clamp(fromRec2020 * color, 0.0, 1.0);
}
vec3 toSRGB(vec3 c){ return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }

vec3 sceneCA(vec2 uv, vec2 c, float ca){
  return vec3(texture2D(tScene, uv - c * ca).r, texture2D(tScene, uv).g, texture2D(tScene, uv + c * ca).b);
}

void main(){
  vec2 uv = vUv;
  // 两界切换（uShift 从 1 衰减到 0）：一圈折射波从画面中心向外扩散，带色散和一次闪光
  float shiftRing = 0.0;
  if (uShift > 0.001) { vec2 sc = vUv - 0.5; float sr = length(sc * vec2(uAspect, 1.0)); shiftRing = exp(-pow((sr - (1.0 - uShift) * 1.05) * 6.0, 2.0)); uv -= sc * (0.11 * shiftRing + 0.03 * uShift); }
  float zPix = linZ(texture2D(tDepth, vUv).r);
  // 热浪：远处（不含天空）的画面做极轻微的抖动折射
  float hzK = uHeat * smoothstep(28.0, 120.0, zPix) * (1.0 - smoothstep(500.0, 1000.0, zPix));
  if (hzK > 0.001) { float ph = uTime * 5.0; uv += vec2(sin(vUv.y * 310.0 + ph * 1.3 + sin(vUv.x * 61.0 + ph)), cos(vUv.x * 270.0 - ph + sin(vUv.y * 83.0 - ph * 0.7))) * 0.0005 * hzK; }
  vec2 c = uv - 0.5; float r2 = dot(c, c);
  float ca = uCA * (0.4 + r2 * 4.0) + uShift * (0.004 + 0.02 * shiftRing);
  vec3 col;
  if (uSpeed > 0.002) {
    float amt = uSpeed * 0.10 * smoothstep(0.02, 0.30, r2);
    vec3 acc = vec3(0.0);
    float jit = ign(gl_FragCoord.xy + uTime * 60.0);
    for (int i = 0; i < 7; i++){ float t = (float(i) + jit) / 7.0; acc += sceneCA(uv - c * amt * t, c, ca); }
    col = acc / 7.0;
  } else {
    col = sceneCA(uv, c, ca);
  }
  vec2 px = 1.0 / uRes;
  if (uSharpen > 0.001) {
    vec3 n = (texture2D(tScene, uv + vec2(px.x, 0.0)).rgb + texture2D(tScene, uv - vec2(px.x, 0.0)).rgb
            + texture2D(tScene, uv + vec2(0.0, px.y)).rgb + texture2D(tScene, uv - vec2(0.0, px.y)).rgb) * 0.25;
    float lc = luma(texture2D(tScene, uv).rgb), ln = luma(n);
    col *= 1.0 + clamp((lc - ln) / (lc + ln + 0.02), -0.25, 0.25) * uSharpen;
  }

  // AO：联合双边上采样
  float ao = 1.0;
  if (uAO > 0.001) {
    vec2 hres = floor(uRes * 0.5);
    vec2 f = uv * hres - 0.5; vec2 base = (floor(f) + 0.5) / hres; vec2 fr = fract(f);
    float z0 = linZ(texture2D(tDepth, uv).r); float sum = 0.0, ws = 0.0;
    for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++){
      vec2 suv = base + vec2(float(i), float(j)) / hres;
      float zs = linZ(texture2D(tDepth, suv).r);
      float bw = (i == 0 ? 1.0 - fr.x : fr.x) * (j == 0 ? 1.0 - fr.y : fr.y);
      float w = (bw + 0.02) * max(0.02, 1.0 - abs(zs - z0) / (0.05 * z0 + 0.02));
      sum += texture2D(tAO, suv).r * w; ws += w;
    }
    ao = sum / ws;
    float aoK = mix(1.0, ao, uAO);
    // 多次反弹近似：亮处的 AO 减弱并带一点暖色
    col *= mix(vec3(aoK), vec3(1.0), 0.0) * mix(vec3(1.0), vec3(1.0, 0.97, 0.93), (1.0 - aoK) * 0.6);
  }
  if (uDebug == 1) { gl_FragColor = vec4(vec3(ao), 1.0); return; }

  // 体积光：半分辨率结果按深度做联合双边上采样；场景先乘透射率，再加上空气散射进来的光
  if (uVol > 0.001) {
    vec2 hres = uVolRes;
    vec2 f = vUv * hres - 0.5; vec2 base = (floor(f) + 0.5) / hres; vec2 fr = fract(f);
    vec4 vsum = vec4(0.0); float vws = 0.0;
    for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++){
      vec2 suv = base + vec2(float(i), float(j)) / hres;
      float zs = linZ(texture2D(tDepth, suv).r);
      float bw = (i == 0 ? 1.0 - fr.x : fr.x) * (j == 0 ? 1.0 - fr.y : fr.y);
      float w = (bw + 0.02) * max(0.02, 1.0 - abs(zs - zPix) / (0.08 * zPix + 0.05));
      vsum += texture2D(tVol, suv) * w; vws += w;
    }
    vec4 vol = vsum / vws;
    if (uDebug == 4) { gl_FragColor = vec4(toSRGB(vol.rgb * 0.6), 1.0); return; }
    col = col * mix(1.0, vol.a, uVol) + vol.rgb * uVol;
  }

  vec3 bloom = texture2D(tBloom, uv).rgb;
  vec4 ex = texture2D(tExpo, vec2(0.5));
  // 明暗适应的过渡：stops > 0 = 眼睛还停留在暗处的状态（刚走到亮处，眩光）；< 0 = 还停留在亮处的状态（刚走进暗处）
  float stops = log2(max(ex.b, 0.001) / max(ex.r, 0.001));
  // 主要作用在进出室内的时候；在室外只是转头看亮处 / 暗处时，眩光减弱、不做去色
  float glare = clamp(stops * 0.4, 0.0, 1.0) * mix(0.3, 1.0, uIndoor), dim = clamp(-stops * 0.4, 0.0, 1.0) * uIndoor;
  col = mix(col, bloom, min(0.6, uBloom * (1.0 + 4.0 * glare)));
  col += bloom * texture2D(tDirt, vUv).rgb * uLensDirt * (1.0 + 2.0 * glare);   // 镜头脏污：强光附近的灰尘与油渍被泛光点亮
  if (uDebug == 2) { gl_FragColor = vec4(toSRGB(aces(bloom * uExposure)), 1.0); return; }
  vec3 god = texture2D(tGod, uv).rgb;
  // 体积光是屏幕空间近似：近处表面上基本不叠加，避免近景物体的“阴影条纹”被拖到地面上
  col += god * uGod * mix(0.12, 1.0, smoothstep(5.0, 55.0, linZ(texture2D(tDepth, uv).r)));
  if (uDebug == 3) { gl_FragColor = vec4(god, 1.0); return; }

  // 镜头光晕
  if (uFlare > 0.001 && ex.g > 0.003) {
    vec2 asp = vec2(uAspect, 1.0);
    vec2 sp = (uSunUv - 0.5) * asp; vec2 p = c * asp;
    vec3 fl = vec3(0.0);
    float d;
    d = length(p + sp * 0.35); fl += vec3(1.0, 0.55, 0.25) * smoothstep(0.09, 0.0, d) * 0.22;
    d = length(p + sp * 0.62); fl += vec3(0.35, 0.8, 0.6) * smoothstep(0.045, 0.02, d) * 0.16;
    d = length(p + sp * 1.05); fl += vec3(0.4, 0.5, 1.0) * smoothstep(0.16, 0.0, d) * 0.10;
    d = length(p - sp * 0.45); fl += vec3(1.0, 0.75, 0.4) * smoothstep(0.03, 0.01, d) * 0.20;
    d = abs(length(p + sp * 1.6) - 0.34); fl += vec3(0.6, 0.4, 1.0) * smoothstep(0.03, 0.0, d) * 0.07;
    vec2 q = p - sp;
    fl += vec3(0.45, 0.65, 1.0) * exp(-abs(q.y) * 90.0) * exp(-abs(q.x) * 2.4) * 0.55;
    fl += vec3(1.0, 0.8, 0.55) * exp(-length(q) * 5.5) * 0.5;
    col += fl * ex.g * uFlare;
  }

  // 曝光
  // 室外沿用原来的补偿幅度；镜头在室内时（uIndoor→1）补偿更足，暗处最终能看清，但要等眼睛适应过来
  float autoE = clamp(pow(uKey / max(ex.r, 0.001), mix(0.55, 0.62, uIndoor)), 0.55, mix(2.4, 3.4, uIndoor));
  col *= uExposure * autoE;
  // 刚进暗处时色彩感知变弱，适应后颜色才慢慢回来
  col = mix(col, vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))) * vec3(0.94, 1.0, 1.08), dim * 0.4);
  col += uFlash * vec3(1.0, 0.92, 0.8) * 2.0;
  col += uShiftCol * (uShift * uShift * 0.55 + shiftRing * uShift * 1.3);

  col = agx(col * uTint);
  col = toSRGB(col);

  // 调色：AgX 之后只做很轻的对比与饱和补偿，保持照片般的自然影调
  float l = luma(col);
  col = mix(vec3(l), col, uSat);
  col = mix(col, col * col * (3.0 - 2.0 * col), uContrast);
  vec3 sh = vec3(0.972, 1.0, 1.035), hi = vec3(1.028, 1.0, 0.962);   // 分离色调：暗部偏冷、亮部偏暖
  col *= mix(sh, hi, smoothstep(0.1, 0.75, l));

  // 受伤 / 低血量
  float edge = smoothstep(0.08, 0.55, r2);
  if (uLowHP > 0.001) { float g2 = luma(col); col = mix(col, vec3(g2) * vec3(1.0, 0.86, 0.84), uLowHP * 0.55); col = mix(col, col * vec3(0.9, 0.25, 0.2), edge * uLowHP * 0.8); }
  col = mix(col, vec3(0.75, 0.04, 0.02), edge * uHurt * 0.65);

  // 暗角
  float vig = 1.0 - smoothstep(0.12, 0.78, r2) * (uVignette + uADS * 0.5);
  col *= vig;

  col += (ign(gl_FragCoord.xy + fract(uTime) * 311.0) - 0.5) * uGrain * (1.0 - l * 0.6);
  col *= 1.0 - uFade;
  col += (ign(gl_FragCoord.xy * 1.7 + 13.0) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}`;

export class PostFX {
  constructor(renderer, quality = {}) {
    this.r = renderer;
    this.q = Object.assign({ msaa: 4, ao: true, god: true, vol: true, bloomLevels: 6 }, quality);
    this.sun = null;   // 由引擎注入：体积光要读它的级联阴影
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.mesh = new THREE.Mesh(this.geo);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.mesh);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const mk = (frag, uniforms) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
    const depthU = () => ({ tDepth: { value: null }, uNear: { value: 0.05 }, uFar: { value: 1000 }, uProj: { value: new THREE.Vector2(1, 1) } });

    this.mAO = mk(AO_FRAG, { ...depthU(), uRes: { value: new THREE.Vector2() }, uRadius: { value: 1.15 }, uIntensity: { value: 1.25 } });
    this.mAOBlur = mk(AO_BLUR_FRAG, { ...depthU(), tAO: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.mVol = mk(VOL_FRAG, { ...depthU(), ...SUNSH, tNoise: { value: makeNoise3D(32) },
      uCamWorld: { value: new THREE.Matrix4() }, uSunDir: { value: new THREE.Vector3() }, uSunCol: { value: new THREE.Vector3() }, uAmbCol: { value: new THREE.Vector3() },
      uTime: { value: 0 }, uDens: { value: 0.0038 }, uFall: { value: 0.075 }, uMaxDist: { value: 110 }, uG: { value: 0.35 }, uIso: { value: 0.5 }, uWind: { value: new THREE.Vector3(0.021, 0.004, 0.013) },
      uBeam: { value: 3.0 }, uBoxMin: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) }, uBoxMax: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) } });
    this.mVolBlur = mk(VOL_BLUR_FRAG, { ...depthU(), tSrc: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.mDown = mk(DOWN_FRAG, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uFirst: { value: 0 } });
    this.mUp = mk(UP_FRAG, { tLow: { value: null }, tHigh: { value: null }, uTexel: { value: new THREE.Vector2() }, uMix: { value: 0.62 } });
    this.mGodMask = mk(GODMASK_FRAG, { tScene: { value: null }, tDepth: { value: null }, uSunUv: { value: new THREE.Vector2() }, uAspect: { value: 1 } });
    this.mGodBlur = mk(GODBLUR_FRAG, { tSrc: { value: null }, uSunUv: { value: new THREE.Vector2() }, uLen: { value: 1 } });
    this.mExpo = mk(EXPOSE_FRAG, { tPrev: { value: null }, tSmall: { value: null }, tDepth: { value: null }, uDt: { value: 0.016 }, uSunUv: { value: new THREE.Vector2() }, uSunFront: { value: 0 }, uAspect: { value: 1 } });
    this.mComp = mk(COMPOSITE_FRAG, {
      ...depthU(), tScene: { value: null }, tAO: { value: null }, tBloom: { value: null }, tGod: { value: null }, tExpo: { value: null },
      uRes: { value: new THREE.Vector2() }, uTime: { value: 0 },
      uAO: { value: 0.22 }, uBloom: { value: 0.045 }, uGod: { value: 0.09 }, uExposure: { value: 0.54 }, uKey: { value: 0.75 }, uIndoor: { value: 0 },
      uCA: { value: 0.0007 }, uSpeed: { value: 0 }, uSharpen: { value: 0.5 }, uVignette: { value: 0.20 }, uGrain: { value: 0.018 },
      uHurt: { value: 0 }, uLowHP: { value: 0 }, uFlash: { value: 0 }, uFade: { value: 0 }, uADS: { value: 0 }, uSat: { value: 1.06 }, uContrast: { value: 0.58 },
      uFlare: { value: 0.65 }, uSunUv: { value: new THREE.Vector2() }, uAspect: { value: 1 }, uDebug: { value: 0 }, tVol: { value: null }, uVol: { value: 1 }, uHeat: { value: 1 }, tDirt: { value: makeLensDirt() }, uLensDirt: { value: 0.22 }, uVolRes: { value: new THREE.Vector2(1, 1) },
      uTint: { value: new THREE.Vector3(1, 1, 1) }, uShift: { value: 0 }, uShiftCol: { value: new THREE.Vector3(0.35, 0.95, 1.0) },
    });
    this.fx = this.mComp.uniforms;   // 外部直接改 this.fx.uHurt.value 等
    this.rt = {};
    this.w = 0; this.h = 0;
    this._sun = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this.expoIdx = 0;
    this._prevVP = new THREE.Matrix4();
  }

  setSize(w, h) {
    w = Math.max(8, Math.floor(w)); h = Math.max(8, Math.floor(h));
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    for (const k in this.rt) { const t = this.rt[k]; if (Array.isArray(t)) t.forEach((x) => x.dispose()); else t.dispose(); }
    const hf = THREE.HalfFloatType;
    const lin = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, generateMipmaps: false };
    const scene = new THREE.WebGLRenderTarget(w, h, { type: hf, samples: this.q.msaa, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
    scene.depthTexture = new THREE.DepthTexture(w, h);
    scene.depthTexture.minFilter = scene.depthTexture.magFilter = THREE.NearestFilter;
    const hw = Math.floor(w / 2), hh = Math.floor(h / 2);
    const ao = [new THREE.WebGLRenderTarget(hw, hh, { ...lin, type: hf }), new THREE.WebGLRenderTarget(hw, hh, { ...lin, type: hf })];
    const down = [], up = [];
    let bw = hw, bh = hh;
    for (let i = 0; i < this.q.bloomLevels; i++) {
      down.push(new THREE.WebGLRenderTarget(bw, bh, { ...lin, type: hf }));
      up.push(new THREE.WebGLRenderTarget(bw, bh, { ...lin, type: hf }));
      bw = Math.max(2, Math.floor(bw / 2)); bh = Math.max(2, Math.floor(bh / 2));
    }
    const qw = Math.floor(w / 4), qh = Math.floor(h / 4);
    const god = [new THREE.WebGLRenderTarget(qw, qh, { ...lin, type: hf }), new THREE.WebGLRenderTarget(qw, qh, { ...lin, type: hf })];
    const expo = this.rt.expo && false ? this.rt.expo : [new THREE.WebGLRenderTarget(1, 1, { ...lin, type: hf }), new THREE.WebGLRenderTarget(1, 1, { ...lin, type: hf })];
    const vw = Math.max(4, Math.floor(w / 4)), vh = Math.max(4, Math.floor(h / 4));   // 体积光用 1/4 分辨率：它本来就是低频的，按深度上采样后看不出差别
    const volRT = [new THREE.WebGLRenderTarget(vw, vh, { ...lin, type: hf }), new THREE.WebGLRenderTarget(vw, vh, { ...lin, type: hf })];
    this.rt = { scene, ao, down, up, god, expo, vol: volRT };
    // 初始化曝光缓冲
    const cc = new THREE.Color(); this.r.getClearColor(cc); const ca = this.r.getClearAlpha();
    this.r.setClearColor(new THREE.Color(0.75, 0, 0), 1);
    for (const e of expo) { this.r.setRenderTarget(e); this.r.clear(true, false, false); }
    this.r.setClearColor(new THREE.Color(1, 1e4, 0), 1);
    for (const e of ao) { this.r.setRenderTarget(e); this.r.clear(true, false, false); }
    this.r.setClearColor(cc, ca);
    this.r.setRenderTarget(null);
  }

  // 设置室内浮尘体：[[x0,y0,z0,x1,y1,z1,倍率], ...]
  setDust(boxes) { this.dustBoxes = (boxes || []).map((b) => ({ lo: new THREE.Vector3(b[0], b[1], b[2]), hi: new THREE.Vector3(b[3], b[4], b[5]), k: b[6] || 6, d: 0 })); }
  _pickDust(cam, lo, hi) {
    const L = this.dustBoxes || [];
    for (const b of L) { const dx = Math.max(b.lo.x - cam.x, 0, cam.x - b.hi.x), dy = Math.max(b.lo.y - cam.y, 0, cam.y - b.hi.y), dz = Math.max(b.lo.z - cam.z, 0, cam.z - b.hi.z); b.d = dx * dx + dy * dy + dz * dz; }
    L.sort((p, q) => p.d - q.d);
    // 着色器里盒边有 0.8m 的渐变：四周和底面外扩同样的量，让室内处于满浓度；顶面不外扩（浮尘到天花板前就淡出）
    for (let i = 0; i < 4; i++) { const b = L[i]; if (b && b.d < 90 * 90) { lo[i].set(b.lo.x - 0.8, b.lo.y - 0.8, b.lo.z - 0.8, b.k); hi[i].set(b.hi.x + 0.8, b.hi.y, b.hi.z + 0.8, 0); } else { lo[i].set(0, 0, 0, 0); hi[i].set(0, 0, 0, 0); } }
  }

  _pass(mat, target) {
    this.mesh.material = mat;
    this.r.setRenderTarget(target);
    this.r.render(this.scene, this.cam);
  }

  render(scene, camera, dt, time) {
    const r = this.r, rt = this.rt, w = this.w, h = this.h;
    const aspect = w / h;
    // 1) 场景（材质会采样上一帧的 AO）
    G.uAOTex.value = rt.ao[0].texture; G.uAOTexel.value.set(1 / rt.ao[0].width, 1 / rt.ao[0].height); G.uPrevVP.value.copy(this._prevVP);
    r.setRenderTarget(rt.scene);
    r.clear();
    r.render(scene, camera);
    this._prevVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);

    const tanY = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
    const proj = [tanY * camera.aspect, tanY];
    const setDepth = (m) => { m.uniforms.tDepth.value = rt.scene.depthTexture; m.uniforms.uNear.value = camera.near; m.uniforms.uFar.value = camera.far; m.uniforms.uProj.value.set(proj[0], proj[1]); };

    // 太阳屏幕位置
    this._sun.copy(camera.position).addScaledVector(ATMOS.sunDir, 500).project(camera);
    camera.getWorldDirection(this._fwd);
    const front = this._fwd.dot(ATMOS.sunDir);
    const sunUv = [this._sun.x * 0.5 + 0.5, this._sun.y * 0.5 + 0.5];
    const sunFront = front > 0 ? 1 : 0;
    const sunFade = THREE.MathUtils.smoothstep(front, 0.05, 0.45);

    // 2) AO
    if (this.q.ao) {
      setDepth(this.mAO); this.mAO.uniforms.uRes.value.set(rt.ao[0].width, rt.ao[0].height);
      this._pass(this.mAO, rt.ao[0]);
      setDepth(this.mAOBlur);
      this.mAOBlur.uniforms.tAO.value = rt.ao[0].texture; this.mAOBlur.uniforms.uDir.value.set(1 / rt.ao[0].width, 0);
      this._pass(this.mAOBlur, rt.ao[1]);
      this.mAOBlur.uniforms.tAO.value = rt.ao[1].texture; this.mAOBlur.uniforms.uDir.value.set(0, 1 / rt.ao[0].height);
      this._pass(this.mAOBlur, rt.ao[0]);
    }

    // 2.5) 体积光
    let volOn = false;
    const sunSh = this.sun && this.sun.shadow; const shTex = sunSh && sunSh.map ? (sunSh.map.depthTexture || null) : null;
    if (this.q.vol && shTex) {
      const vu = this.mVol.uniforms; setDepth(this.mVol);
      SUNSH.tShadow.value = shTex; SUNSH.uShMat0.value.copy(sunSh.getMatrix(0)); SUNSH.uShMat1.value.copy(sunSh.getMatrix(1)); SUNSH.uCas0.value.copy(sunSh._cascadeData[0]); SUNSH.uCas1.value.copy(sunSh._cascadeData[1]);
      vu.uCamWorld.value.copy(camera.matrixWorld); vu.uSunDir.value.copy(ATMOS.sunDir); vu.uTime.value = time;
      this._pickDust(camera.position, vu.uBoxMin.value, vu.uBoxMax.value);
      vu.uSunCol.value.set(ATMOS.sunColor[0], ATMOS.sunColor[1] * 0.9, ATMOS.sunColor[2] * 0.74).multiplyScalar(ATMOS.sunIntensity);   // 乘上沙尘的反照率色：散射出来的是金黄色而不是白色
      vu.uAmbCol.value.set(ATMOS.skyE[0], ATMOS.skyE[1], ATMOS.skyE[2]).multiplyScalar(0.3 / Math.PI);
      this._pass(this.mVol, rt.vol[0]);
      const vb = this.mVolBlur.uniforms; setDepth(this.mVolBlur);
      vb.tSrc.value = rt.vol[0].texture; vb.uDir.value.set(1 / rt.vol[0].width, 0); this._pass(this.mVolBlur, rt.vol[1]);
      vb.tSrc.value = rt.vol[1].texture; vb.uDir.value.set(0, 1 / rt.vol[0].height); this._pass(this.mVolBlur, rt.vol[0]);
      volOn = true;
    }

    // 3) 泛光：下采样链 + 上采样链
    const n = rt.down.length;
    let src = rt.scene.texture, sw = w, sh = h;
    for (let i = 0; i < n; i++) {
      this.mDown.uniforms.tSrc.value = src; this.mDown.uniforms.uTexel.value.set(1 / sw, 1 / sh); this.mDown.uniforms.uFirst.value = i === 0 ? 1 : 0;
      this._pass(this.mDown, rt.down[i]);
      src = rt.down[i].texture; sw = rt.down[i].width; sh = rt.down[i].height;
    }
    let low = rt.down[n - 1];
    for (let i = n - 2; i >= 0; i--) {
      this.mUp.uniforms.tLow.value = low.texture; this.mUp.uniforms.tHigh.value = rt.down[i].texture;
      this.mUp.uniforms.uTexel.value.set(1 / low.width, 1 / low.height);
      this._pass(this.mUp, rt.up[i]);
      low = rt.up[i];
    }

    // 4) 曝光 + 太阳可见度
    const prev = rt.expo[this.expoIdx], next = rt.expo[1 - this.expoIdx];
    const eu = this.mExpo.uniforms;
    eu.tPrev.value = prev.texture; eu.tSmall.value = rt.down[n - 1].texture; eu.tDepth.value = rt.scene.depthTexture;
    eu.uDt.value = Math.min(dt, 0.1); eu.uSunUv.value.set(sunUv[0], sunUv[1]); eu.uSunFront.value = sunFront; eu.uAspect.value = aspect;
    this._pass(this.mExpo, next);
    this.expoIdx = 1 - this.expoIdx;

    // 5) 体积光（径向模糊）
    let godOn = this.q.god && sunFade > 0.001;
    if (godOn) {
      const gm = this.mGodMask.uniforms;
      gm.tScene.value = rt.scene.texture; gm.tDepth.value = rt.scene.depthTexture; gm.uSunUv.value.set(sunUv[0], sunUv[1]); gm.uAspect.value = aspect;
      this._pass(this.mGodMask, rt.god[0]);
      const gb = this.mGodBlur.uniforms; gb.uSunUv.value.set(sunUv[0], sunUv[1]);
      gb.tSrc.value = rt.god[0].texture; gb.uLen.value = 0.85; this._pass(this.mGodBlur, rt.god[1]);
      gb.tSrc.value = rt.god[1].texture; gb.uLen.value = 0.85 / 8; this._pass(this.mGodBlur, rt.god[0]);
      gb.tSrc.value = rt.god[0].texture; gb.uLen.value = 0.85 / 64; this._pass(this.mGodBlur, rt.god[1]);
    }

    // 6) 合成
    const cu = this.mComp.uniforms;
    setDepth(this.mComp);
    cu.tScene.value = rt.scene.texture; cu.tAO.value = rt.ao[0].texture; cu.tBloom.value = rt.up[0].texture;
    cu.tGod.value = rt.god[1].texture; cu.tExpo.value = next.texture;
    cu.uRes.value.set(w, h); cu.uTime.value = time; cu.uSunUv.value.set(sunUv[0], sunUv[1]); cu.uAspect.value = aspect;
    const godBase = this._godBase !== undefined ? this._godBase : (this._godBase = cu.uGod.value);
    cu.uGod.value = godOn ? godBase * sunFade : 0;
    const aoBase = this._aoBase !== undefined ? this._aoBase : (this._aoBase = cu.uAO.value);
    cu.uAO.value = this.q.ao ? aoBase : 0;
    const volBase = cu.uVol.value; cu.tVol.value = rt.vol[0].texture; cu.uVolRes.value.set(rt.vol[0].width, rt.vol[0].height); if (!volOn) cu.uVol.value = 0;
    this._pass(this.mComp, null);
    cu.uGod.value = godBase; cu.uAO.value = aoBase; cu.uVol.value = volBase;
  }
}
