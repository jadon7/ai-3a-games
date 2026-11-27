// 电影感后期：运动模糊 → 景深 → 泛光 → 曝光/AgX → 调色（照搬影片合成脚本的配方：暖色光晕、太阳眩光、红色光渗、
// S 曲线、分离色调、轻抬黑位、边缘色散、暗角、胶片颗粒）→ 可选 2.39:1 遮幅。
import * as THREE from 'three';
import { fullscreenPass, AGX_GLSL } from './app.js';
import { SUN_DIR, QUALITY_NAME } from './common.js';

const RECON = /* glsl */`
uniform sampler2D tDepth; uniform mat4 uProjInv, uViewInv; uniform float uCamNear, uCamFar;
vec3 worldPos(vec2 uv, float d) { vec4 v = uProjInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); v /= v.w; return (uViewInv * v).xyz; }
float viewDist(float d) { float z = d * 2.0 - 1.0; return (2.0 * uCamNear * uCamFar) / (uCamFar + uCamNear - z * (uCamFar - uCamNear)); }
`;

const MB_FRAG = RECON + /* glsl */`
uniform sampler2D tColor; uniform mat4 uPrevViewProj; uniform float uMbScale, uRadial, uAspect, uCharDist, uMbMax; uniform vec3 uProtect; varying vec2 vUv;
void main() {
  float d = texture2D(tDepth, vUv).x;
  vec3 wp = worldPos(vUv, min(d, 0.9999995));
  vec4 pc = uPrevViewProj * vec4(wp, 1.0);
  vec2 vel = (vUv - (pc.xy / pc.w * 0.5 + 0.5)) * uMbScale * step(0.0, pc.w);
  vec2 cc = vUv - 0.5;
  vel += cc * uRadial * smoothstep(0.12, 0.70, length(cc * vec2(uAspect, 1.0)));
  float len = length(vel); if (len > uMbMax) vel *= uMbMax / len;
  // 角色所在的区域不糊（角色相对镜头基本静止，按静态世界重投影会把他糊掉）
  vec2 pd = (vUv - uProtect.xy) * vec2(uAspect, 1.0);
  float inside = 1.0 - smoothstep(uProtect.z * 0.75, uProtect.z * 1.35, length(pd * vec2(1.25, 0.8)));
  float nearChar = 1.0 - smoothstep(uCharDist + 1.5, uCharDist + 7.0, viewDist(d));
  vel *= 1.0 - inside * nearChar;
  vec3 acc = vec3(0.0); float wsum = 0.0;
  float jit = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  for (int i = 0; i < 14; i++) {
    float t = (float(i) + jit) / 14.0 - 0.5;
    vec2 uv = vUv + vel * t;
    acc += texture2D(tColor, uv).rgb; wsum += 1.0;
  }
  gl_FragColor = vec4(acc / wsum, 1.0);
}`;

const DOF_FRAG = RECON + /* glsl */`
uniform sampler2D tColor; uniform vec2 uTexel; uniform float uFocus, uCocScale, uMaxCoc; varying vec2 vUv;
float coc(float dist) { return clamp(uCocScale * abs(dist - uFocus) / max(dist, 0.2), 0.0, uMaxCoc); }
void main() {
  float cd = viewDist(texture2D(tDepth, vUv).x); float cs = coc(cd);
  vec3 col = texture2D(tColor, vUv).rgb; float tot = 1.0; float radius = 0.7;
  float rot = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) * 6.2831853;      // 每像素转一个随机角，避免采样花纹
  for (int i = 0; i < 44; i++) {
    if (radius > uMaxCoc) break;
    float ang = float(i) * 2.39996323 + rot;
    vec2 tc = vUv + vec2(cos(ang), sin(ang)) * uTexel * radius;
    vec3 sc = texture2D(tColor, tc).rgb; float sd = viewDist(texture2D(tDepth, tc).x); float ss = coc(sd);
    if (sd > cd) ss = clamp(ss, 0.0, cs * 2.0);
    float m = smoothstep(radius - 0.5, radius + 0.5, ss);
    col += mix(col / tot, sc, m); tot += 1.0; radius += 0.7 / radius;
  }
  gl_FragColor = vec4(col / tot, cs);
}`;

const DOF_MIX = RECON + /* glsl */`
uniform sampler2D tColor, tBlur; uniform float uFocus, uCocScale, uMaxCoc; varying vec2 vUv;
void main() {
  vec3 sharp = texture2D(tColor, vUv).rgb; vec4 b = texture2D(tBlur, vUv);
  float cs = clamp(uCocScale * abs(viewDist(texture2D(tDepth, vUv).x) - uFocus) / max(viewDist(texture2D(tDepth, vUv).x), 0.2), 0.0, uMaxCoc);
  gl_FragColor = vec4(mix(sharp, b.rgb, smoothstep(0.35, 1.6, max(cs, b.a * 0.6))), 1.0);
}`;

const BLOOM_PRE = /* glsl */`
uniform sampler2D tColor; uniform float uExposure, uThreshold; uniform vec2 uTexel; varying vec2 vUv;
void main() {
  vec3 c = (texture2D(tColor, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tColor, vUv + uTexel * vec2(1.0, -1.0)).rgb
          + texture2D(tColor, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tColor, vUv + uTexel * vec2(1.0, 1.0)).rgb) * 0.25 * uExposure;
  float l = max(c.r, max(c.g, c.b));
  float k = clamp((l - uThreshold) / max(l, 1e-4), 0.0, 1.0);
  gl_FragColor = vec4(min(c * k, vec3(40.0)), 1.0);
}`;
const BLOOM_DOWN = /* glsl */`
uniform sampler2D tColor; uniform vec2 uTexel; varying vec2 vUv;
void main() {
  vec3 c = texture2D(tColor, vUv).rgb * 4.0;
  c += texture2D(tColor, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tColor, vUv + uTexel * vec2(1.0, -1.0)).rgb
     + texture2D(tColor, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tColor, vUv + uTexel * vec2(1.0, 1.0)).rgb;
  gl_FragColor = vec4(c / 8.0, 1.0);
}`;
const BLOOM_UP = /* glsl */`
uniform sampler2D tColor; uniform vec2 uTexel; uniform float uGain; varying vec2 vUv;
void main() {
  vec3 c = texture2D(tColor, vUv + uTexel * vec2(-2.0, 0.0)).rgb + texture2D(tColor, vUv + uTexel * vec2(2.0, 0.0)).rgb
         + texture2D(tColor, vUv + uTexel * vec2(0.0, -2.0)).rgb + texture2D(tColor, vUv + uTexel * vec2(0.0, 2.0)).rgb;
  c += 2.0 * (texture2D(tColor, vUv + uTexel * vec2(-1.0, 1.0)).rgb + texture2D(tColor, vUv + uTexel * vec2(1.0, 1.0)).rgb
            + texture2D(tColor, vUv + uTexel * vec2(-1.0, -1.0)).rgb + texture2D(tColor, vUv + uTexel * vec2(1.0, -1.0)).rgb);
  gl_FragColor = vec4(c / 12.0 * uGain, 1.0);
}`;

const FINAL = AGX_GLSL + /* glsl */`
uniform sampler2D tColor, tBloom, tBloomWide;
uniform float uExposure, uBloom, uTime, uAspect, uLetterbox, uFade, uFlash, uWhiteout, uGrain, uGlare, uSat, uContrast, uVignette;
uniform vec3 uSunScreen;            // xy = 太阳的屏幕 uv，z = 可见度（在镜头前方为 1）
uniform vec3 uTint; uniform float uCA, uLines;
varying vec2 vUv;
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 curve(vec3 x, float c, float p) {
  x = clamp(x, 0.0, 1.0);
  vec3 lo = p * pow(x / p, vec3(c)); vec3 hi = 1.0 - (1.0 - p) * pow((1.0 - x) / (1.0 - p), vec3(c));
  return mix(lo, hi, step(p, x));
}
void main() {
  // 边缘色散：红蓝通道各缩放一点点
  vec2 cc = vUv - 0.5; float ca = uCA;
  vec3 hdr = vec3(texture2D(tColor, 0.5 + cc * (1.0 - ca)).r, texture2D(tColor, vUv).g, texture2D(tColor, 0.5 + cc * (1.0 + ca)).b);
  vec3 bloom = texture2D(tBloom, vUv).rgb; vec3 wide = texture2D(tBloomWide, vUv).rgb;
  hdr = hdr * uExposure + (bloom * 0.65 + wide * 0.75) * uBloom * vec3(1.0, 0.88, 0.70);
  hdr = mix(hdr, vec3(1.0, 0.98, 0.94) * 1.6, uWhiteout);
  vec3 x = agxTonemap(hdr * uTint);
  // 太阳眩光光幕（太阳在画外一点也有）
  if (uSunScreen.z > 0.0) {
    float r = length((vUv - uSunScreen.xy) * vec2(uAspect, 1.0)) / uAspect;
    float veil = uGlare * uSunScreen.z * (0.75 / (1.0 + pow(r / 0.16, 2.0)) + 0.25 / (1.0 + pow(r / 0.55, 2.0)));
    x = 1.0 - (1.0 - x) * (1.0 - clamp(veil * vec3(1.0, 0.80, 0.50), 0.0, 1.0));
  }
  // 红色光渗
  x.r = 1.0 - (1.0 - x.r) * (1.0 - clamp(bloom.r * 0.10, 0.0, 0.5));
  // 对比度、饱和度、分离色调（暗部偏青蓝、亮部偏暖金）、轻抬黑位
  x = curve(x, uContrast, 0.40);
  float l = dot(x, vec3(0.2126, 0.7152, 0.0722));
  x = l + (x - l) * uSat;
  float wsh = pow(clamp(1.0 - l / 0.45, 0.0, 1.0), 1.5), whi = pow(clamp((l - 0.45) / 0.55, 0.0, 1.0), 1.2);
  x *= (1.0 + (vec3(0.93, 1.00, 1.06) - 1.0) * wsh) * (1.0 + (vec3(1.06, 0.985, 0.90) - 1.0) * whi);
  x = x * 0.985 + 0.012;
  // 速度流光：按角度分扇区的两层放射细线，从中间往四周飞；画面中心一圈不画，主角保持清楚
  if (uLines > 0.002) {
    vec2 p = cc * vec2(uAspect, 1.0); float r = length(p); float a = atan(p.y, p.x) / 6.2831853 + 0.5;
    float mask = smoothstep(0.24, 0.50, r); float acc = 0.0;
    for (int k = 0; k < 2; k++) {
      float n = k == 0 ? 130.0 : 48.0; float seg = floor(a * n); float fa = fract(a * n);
      float h = hash(vec2(seg, float(k) * 17.0 + 3.0));
      float lit = step(1.0 - uLines * 0.36, h);
      float tt = fract(h * 9.0 + uTime * (1.6 + h * 2.4));
      float head = mix(0.22, 1.25, tt), tail = head - (k == 0 ? 0.22 : 0.34);
      float band = smoothstep(tail, head, r) * (1.0 - smoothstep(head, head + 0.015, r));
      float line = 1.0 - smoothstep(0.0, k == 0 ? 0.13 : 0.20, abs(fa - 0.5));
      acc += lit * line * band * (k == 0 ? 0.50 : 0.32);
    }
    x += vec3(1.0, 0.95, 0.86) * acc * mask * uLines * 0.42;
  }
  // 暗角
  float rr = length(cc * vec2(uAspect, 1.0)) / (uAspect * 0.5) * 0.5;
  x *= 1.0 - uVignette * pow(clamp((rr - 0.35) / 0.85, 0.0, 1.0), 2.0);
  // 胶片颗粒（中间调最明显）
  l = clamp(dot(x, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
  float g = (hash(gl_FragCoord.xy + fract(uTime * 7.31) * 913.0) + hash(gl_FragCoord.xy * 0.5 + fract(uTime * 3.17) * 517.0) - 1.0);
  x += g * uGrain * (0.35 + 2.6 * sqrt(l) * (1.0 - l));
  x = mix(x, vec3(1.0), uFlash);
  x *= 1.0 - uFade;
  // 2.39:1 遮幅
  float barH = max(0.0, (1.0 - uAspect / 2.39) * 0.5) * uLetterbox;
  x *= step(barH, vUv.y) * step(vUv.y, 1.0 - barH);
  gl_FragColor = vec4(clamp(x, 0.0, 1.0), 1.0);
}`;

export function createPost(app) {
  const RT = (w, h, type = THREE.HalfFloatType) => new THREE.WebGLRenderTarget(w, h, { type, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  let W = 2, H = 2;
  const rtMB = RT(2, 2), rtDofHalf = RT(2, 2), rtDof = RT(2, 2);
  const mips = []; const MIPS = 6;
  for (let i = 0; i < MIPS; i++) mips.push({ down: RT(2, 2), up: RT(2, 2) });
  const U = (v) => ({ value: v });
  const recon = () => ({ tDepth: U(null), uProjInv: U(new THREE.Matrix4()), uViewInv: U(new THREE.Matrix4()), uCamNear: U(0.3), uCamFar: U(60000) });
  const mb = fullscreenPass(MB_FRAG, { ...recon(), tColor: U(null), uPrevViewProj: U(new THREE.Matrix4()), uMbScale: U(0.5), uRadial: U(0), uAspect: U(1.78), uCharDist: U(9), uMbMax: U(0.03), uProtect: U(new THREE.Vector3(0.5, 0.5, 0.2)) });
  const dof = fullscreenPass(DOF_FRAG, { ...recon(), tColor: U(null), uTexel: U(new THREE.Vector2()), uFocus: U(9), uCocScale: U(0), uMaxCoc: U(9) });
  const dofMix = fullscreenPass(DOF_MIX, { ...recon(), tColor: U(null), tBlur: U(null), uFocus: U(9), uCocScale: U(0), uMaxCoc: U(18) });
  const pre = fullscreenPass(BLOOM_PRE, { tColor: U(null), uExposure: U(1), uThreshold: U(1.0), uTexel: U(new THREE.Vector2()) });
  const down = fullscreenPass(BLOOM_DOWN, { tColor: U(null), uTexel: U(new THREE.Vector2()) });
  const up = fullscreenPass(BLOOM_UP, { tColor: U(null), uTexel: U(new THREE.Vector2()), uGain: U(1) }, { blending: THREE.AdditiveBlending, transparent: true });
  const fin = fullscreenPass(FINAL, {
    tColor: U(null), tBloom: U(null), tBloomWide: U(null), uExposure: U(1), uBloom: U(0.55), uTime: U(0), uAspect: U(1.78), uLetterbox: U(0), uFade: U(0), uFlash: U(0),
    uWhiteout: U(0), uGrain: U(0.017), uGlare: U(0.30), uSat: U(0.92), uContrast: U(1.16), uVignette: U(0.30), uSunScreen: U(new THREE.Vector3()), uTint: U(new THREE.Vector3(1, 1, 1)), uCA: U(0.0007), uLines: U(0),
  });
  const prevVP = new THREE.Matrix4(); let havePrev = false;
  const _vp = new THREE.Matrix4(), _v = new THREE.Vector3();
  // 可调参数（游戏逻辑每帧写）
  const params = {
    exposure: 1.0, bloom: 0.55, motionBlur: QUALITY_NAME === 'low' ? 0 : 0.4, mbMax: 0.03, ca: 0.0007, lines: 0, radial: 0, dof: QUALITY_NAME === 'low' ? 0 : 1, focus: 9, fstop: 5.6,
    protect: new THREE.Vector3(0.5, 0.5, 0.2), charDist: 9, letterbox: 0, fade: 0, flash: 0, whiteout: 0, grain: 0.017, glare: 0.30,
    saturation: 0.92, contrast: 1.16, vignette: 0.30, tint: new THREE.Vector3(1, 1, 1),
  };

  function setSize(w, h) {
    W = w; H = h;
    rtMB.setSize(w, h); rtDof.setSize(w, h); rtDofHalf.setSize(Math.ceil(w / 2), Math.ceil(h / 2));
    let mw = Math.ceil(w / 2), mh = Math.ceil(h / 2);
    for (const m of mips) { m.down.setSize(mw, mh); m.up.setSize(mw, mh); mw = Math.max(2, Math.ceil(mw / 2)); mh = Math.max(2, Math.ceil(mh / 2)); }
  }

  function setRecon(u, src, camera) {
    u.tDepth.value = src.depth; u.uProjInv.value.copy(camera.projectionMatrixInverse); u.uViewInv.value.copy(camera.matrixWorld);
    u.uCamNear.value = camera.near; u.uCamFar.value = camera.far;
  }

  function render(renderer, src, camera, time, dt) {
    const aspect = W / H;
    let color = src.color;
    _vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    // ---- 运动模糊（按相机运动重投影）
    if (params.motionBlur > 0 && havePrev) {
      const u = mb.uniforms; setRecon(u, src, camera);
      u.tColor.value = color; u.uPrevViewProj.value.copy(prevVP); u.uMbScale.value = params.motionBlur * Math.min(2.0, (1 / 60) / Math.max(dt, 1e-3));
      u.uRadial.value = params.radial; u.uMbMax.value = params.mbMax; u.uAspect.value = aspect; u.uProtect.value.copy(params.protect); u.uCharDist.value = params.charDist;
      mb.render(renderer, rtMB); color = rtMB.texture;
    }
    prevVP.copy(_vp); havePrev = true;
    // ---- 景深
    if (params.dof > 0) {
      const sensorH = 0.024 * (aspect > 1.5 ? 0.844 : 1.0);                                     // 等效全画幅
      const f = (sensorH * 0.5) / Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
      const cocScale = (f * f / (params.fstop * Math.max(params.focus - f, 0.1))) / sensorH * H * params.dof;   // 像素（全分辨率）
      if (cocScale > 0.4) {
        let u = dof.uniforms; setRecon(u, src, camera);
        u.tColor.value = color; u.uTexel.value.set(2 / W, 2 / H); u.uFocus.value = params.focus; u.uCocScale.value = cocScale * 0.5; u.uMaxCoc.value = 9;
        dof.render(renderer, rtDofHalf);
        u = dofMix.uniforms; setRecon(u, src, camera);
        u.tColor.value = color; u.tBlur.value = rtDofHalf.texture; u.uFocus.value = params.focus; u.uCocScale.value = cocScale; u.uMaxCoc.value = 18;
        dofMix.render(renderer, rtDof); color = rtDof.texture;
      }
    }
    // ---- 泛光
    pre.uniforms.tColor.value = color; pre.uniforms.uExposure.value = params.exposure; pre.uniforms.uTexel.value.set(0.5 / W, 0.5 / H);
    pre.render(renderer, mips[0].down);
    for (let i = 1; i < MIPS; i++) {
      down.uniforms.tColor.value = mips[i - 1].down.texture; down.uniforms.uTexel.value.set(1 / mips[i - 1].down.width, 1 / mips[i - 1].down.height);
      down.render(renderer, mips[i].down);
    }
    const ac = renderer.autoClear;
    let prevTex = mips[MIPS - 1].down.texture, pw = mips[MIPS - 1].down.width, ph = mips[MIPS - 1].down.height;
    for (let i = MIPS - 2; i >= 0; i--) {
      // up[i] = down[i] + 上采样(上一级)
      renderer.autoClear = true; down.uniforms.tColor.value = mips[i].down.texture; down.uniforms.uTexel.value.set(0, 0); down.render(renderer, mips[i].up);
      renderer.autoClear = false; up.uniforms.tColor.value = prevTex; up.uniforms.uTexel.value.set(1 / pw, 1 / ph); up.uniforms.uGain.value = 1.0; up.render(renderer, mips[i].up);
      prevTex = mips[i].up.texture; pw = mips[i].up.width; ph = mips[i].up.height;
    }
    renderer.autoClear = ac;
    // ---- 最终合成
    const u = fin.uniforms;
    u.tColor.value = color; u.tBloom.value = mips[1].up.texture; u.tBloomWide.value = mips[3].up.texture;
    u.uExposure.value = params.exposure; u.uBloom.value = params.bloom / (MIPS - 1); u.uTime.value = time; u.uAspect.value = aspect;
    u.uLetterbox.value = params.letterbox; u.uFade.value = params.fade; u.uFlash.value = params.flash; u.uWhiteout.value = params.whiteout;
    u.uGrain.value = params.grain; u.uGlare.value = params.glare; u.uSat.value = params.saturation; u.uContrast.value = params.contrast; u.uVignette.value = params.vignette;
    u.uTint.value.copy(params.tint); u.uCA.value = params.ca; u.uLines.value = params.lines;
    _v.copy(SUN_DIR).multiplyScalar(1e5).add(camera.position).project(camera);
    const front = _v.z < 1 && Math.abs(_v.x) < 4 && Math.abs(_v.y) < 4;
    u.uSunScreen.value.set(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5, front ? 1 : 0);
    fin.render(renderer, null);
  }

  return { render, setSize, params };
}
