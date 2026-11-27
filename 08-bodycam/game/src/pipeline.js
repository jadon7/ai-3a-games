// 每帧流程（和影片的后期脚本 post.py 一一对应）：
// 广角透视渲染(HDR) → 鱼眼重映射+卷帘快门+色差+暗角 → 相机转动的运动模糊 → 泛光(含镜头污渍)
// → 自动曝光(GPU 内环路，有滞后) → 传感器噪点 → 色调曲线/调色 → 机内降噪+过锐化 → 屏幕
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { LENS, MODES, QS } from './config.js';

const VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

function rt(w, h, o = {}) {
  const t = new THREE.WebGLRenderTarget(Math.max(1, w | 0), Math.max(1, h | 0), {
    type: o.type ?? THREE.HalfFloatType, format: THREE.RGBAFormat, colorSpace: THREE.NoColorSpace,
    minFilter: o.mip ? THREE.LinearMipmapLinearFilter : (o.nearest ? THREE.NearestFilter : THREE.LinearFilter),
    magFilter: o.nearest ? THREE.NearestFilter : THREE.LinearFilter,
    generateMipmaps: !!o.mip, depthBuffer: !!o.depth, samples: o.samples ?? 0,
  });
  if (o.aniso) t.texture.anisotropy = o.aniso;
  return t;
}
const pass = (fs, uniforms) => new FullScreenQuad(new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false }));

const LENS_GLSL = /* glsl */`
uniform vec3 uLens; uniform vec2 uTan;
// 成片画面 uv(0..1) -> 相机空间方向（等立体角鱼眼）
vec3 lensDir(vec2 uv, float scale){
  vec2 p = (uv - 0.5) * 2.0 * uLens.yz / scale;       // 传感器上的毫米坐标
  float r = length(p); float th = 2.0 * asin(clamp(r / (2.0 * uLens.x), 0.0, 1.0));
  vec2 n = r > 1e-6 ? p / r : vec2(0.0);
  return vec3(sin(th) * n, -cos(th));
}
vec2 dirToLens(vec3 d){
  d = normalize(d); float th = acos(clamp(-d.z, -1.0, 1.0)); float r = 2.0 * uLens.x * sin(th * 0.5);
  float l = max(length(d.xy), 1e-6); return 0.5 + (r * d.xy / l) / (2.0 * uLens.yz);
}
vec2 dirToPersp(vec3 d){ return 0.5 + 0.5 * (d.xy / -d.z) / uTan; }
`;

export class Pipeline {
  constructor(renderer) {
    this.r = renderer;
    this.frame = 0;
    this.internalScale = QS.scale ?? ((QS.shots || QS.auto != null) ? 2.0 : 1.5);      // 截图比对用 2 倍；实时游玩从 1.5 倍起步，再按帧时间自动升降
    this.prevQuat = new THREE.Quaternion(); this.hasPrev = false;
    this.mode = MODES[QS.mode];
    this.raw = QS.raw;
    this.lensU = { uLens: { value: new THREE.Vector3(LENS.f, LENS.sw / 2, LENS.sh / 2) }, uTan: { value: new THREE.Vector2(LENS.tanH, LENS.tanV) } };
    this._init();
  }

  setMode(M) { this.mode = M; }

  _init() {
    const dirt = new THREE.TextureLoader().load('./assets/fx/lens_dirt.png');
    dirt.colorSpace = THREE.NoColorSpace;
    // 1) 鱼眼重映射 + 卷帘快门 + 色差 + 暗角
    this.pDistort = pass(/* glsl */`
      uniform sampler2D tScene; uniform sampler2D tMask; uniform mat3 uRS; uniform float uRSOn;
      varying vec2 vUv; ${LENS_GLSL}
      vec3 samp(float sc){
        vec3 d = lensDir(vUv, sc);
        // 卷帘快门：越靠下的行曝光越晚，相机转动时画面会斜
        d = mix(d, uRS * d, uRSOn * (vUv.y - 0.5));
        vec2 uv = dirToPersp(d);
        return texture2D(tScene, uv).rgb;
      }
      void main(){
        vec3 c = vec3(samp(1.0022).r, samp(1.0).g, samp(0.9980).b);   // 轻微的横向色差
        vec2 q = (vUv - 0.5) * vec2(2.0, 2.0 * 9.0 / 16.0);
        float vig = 1.0 - 0.30 * pow(clamp(length(q) / 1.15, 0.0, 1.0), 2.6);
        float m = texture2D(tMask, dirToPersp(lensDir(vUv, 1.0))).r;
        gl_FragColor = vec4(c * vig, m);
      }`, { tScene: { value: null }, tMask: { value: null }, uRS: { value: new THREE.Matrix3() }, uRSOn: { value: 0 }, ...this.lensU });
    // 2) 相机转动的运动模糊（持枪手臂跟着相机走，不参与）
    this.pBlur = pass(/* glsl */`
      uniform sampler2D tSrc; uniform mat3 uRot; uniform float uOn;
      varying vec2 vUv; ${LENS_GLSL}
      void main(){
        vec4 c0 = texture2D(tSrc, vUv);
        if (uOn < 0.5) { gl_FragColor = c0; return; }
        vec3 d = lensDir(vUv, 1.0);
        vec2 uv1 = dirToLens(uRot * d);
        vec2 v = uv1 - vUv;
        vec3 acc = vec3(0.0); float wsum = 0.0;
        for (int i = 0; i < 12; i++) {
          float t = (float(i) + 0.5) / 12.0 - 0.5;
          vec4 s = texture2D(tSrc, vUv + v * t);
          float w = mix(1.0, 1.0 - s.a, 1.0 - c0.a) + 1e-3;   // 背景模糊时不把手臂抹进来
          acc += s.rgb * w; wsum += w;
        }
        vec3 bl = acc / wsum;
        gl_FragColor = vec4(mix(bl, c0.rgb, c0.a * 0.85), c0.a);
      }`, { tSrc: { value: null }, uRot: { value: new THREE.Matrix3() }, uOn: { value: 0 }, ...this.lensU });
    // 3) 测光缩略图 + 曝光环路
    this.pMeter = pass(/* glsl */`
      uniform sampler2D tSrc; uniform vec2 uPx; varying vec2 vUv;
      void main(){
        vec3 a = vec3(0.0);
        for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++) a += texture2D(tSrc, vUv + (vec2(float(x), float(y)) - 1.5) * uPx).rgb;
        gl_FragColor = vec4(a / 16.0, 1.0);
      }`, { tSrc: { value: null }, uPx: { value: new THREE.Vector2() } });
    this.pExpose = pass(/* glsl */`
      uniform sampler2D tMeter; uniform sampler2D tPrev; uniform float uTarget; uniform float uKDown; uniform float uKUp; uniform float uMaxGain; uniform float uInit;
      void main(){
        float g = texture2D(tPrev, vec2(0.5)).r; if (uInit > 0.5 || g <= 0.0) g = 1.5;
        float m = 0.0; float ws = 0.0;
        for (int y = 0; y < 18; y++) for (int x = 0; x < 32; x++) {
          vec2 uv = (vec2(float(x), float(y)) + 0.5) / vec2(32.0, 18.0);
          vec3 c = texture2D(tMeter, uv).rgb; float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
          vec2 q = vec2((uv.x - 0.5) / 0.38, ((1.0 - uv.y) - 0.52) / 0.42);    // 中央重点测光
          float w = exp(-dot(q, q)); m += min(lum * g, 1.0) * w; ws += w;
        }
        m /= ws;
        float ratio = uTarget / max(m, 1e-4);
        g *= pow(ratio, ratio < 1.0 ? uKDown : uKUp);
        gl_FragColor = vec4(clamp(g, 0.25, uMaxGain));
      }`, { tMeter: { value: null }, tPrev: { value: null }, uTarget: { value: 0.215 }, uKDown: { value: 0.22 }, uKUp: { value: 0.07 }, uMaxGain: { value: 24 }, uInit: { value: 1 } });
    // 4) 泛光
    this.pBright = pass(/* glsl */`
      uniform sampler2D tSrc; uniform sampler2D tExp; uniform vec2 uPx; varying vec2 vUv;
      void main(){
        float g = texture2D(tExp, vec2(0.5)).r; vec3 a = vec3(0.0);
        for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++) a += clamp(texture2D(tSrc, vUv + (vec2(float(x), float(y)) - 1.5) * uPx).rgb * g - 1.1, 0.0, 40.0);
        gl_FragColor = vec4(a / 16.0, 1.0);
      }`, { tSrc: { value: null }, tExp: { value: null }, uPx: { value: new THREE.Vector2() } });
    this.pGauss = pass(/* glsl */`
      uniform sampler2D tSrc; uniform vec2 uDir; uniform float uSigma; varying vec2 vUv;
      void main(){
        vec3 a = vec3(0.0); float ws = 0.0;
        for (int i = -9; i <= 9; i++) { float x = float(i) * uSigma / 3.0; float w = exp(-0.5 * x * x / (uSigma * uSigma)); a += texture2D(tSrc, vUv + uDir * x).rgb * w; ws += w; }
        gl_FragColor = vec4(a / ws, 1.0);
      }`, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() }, uSigma: { value: 3 } });
    this.pCopy = pass(`uniform sampler2D tSrc; varying vec2 vUv; void main(){ gl_FragColor = texture2D(tSrc, vUv); }`, { tSrc: { value: null } });
    // 5) 合成：泛光 + 曝光 + 噪点 + 色调曲线 + 调色
    this.pTone = pass(/* glsl */`
      uniform sampler2D tSrc; uniform sampler2D tB1; uniform sampler2D tB2; uniform sampler2D tB3; uniform sampler2D tDirt; uniform sampler2D tExp;
      uniform float uFrame; uniform vec2 uRes; uniform float uRaw; uniform float uWhite;
      varying vec2 vUv;
      float hash(vec3 p){ p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
      float gauss(vec3 p){ return (hash(p) + hash(p + 17.3) + hash(p + 41.7) + hash(p + 71.1) - 2.0) * 1.732; }   // 近似高斯
      vec3 chroma(vec2 px){   // 2 像素相关的色度噪点
        vec2 i = floor(px / 2.0), f = fract(px / 2.0); f = f * f * (3.0 - 2.0 * f);
        vec3 r = vec3(0.0);
        for (int k = 0; k < 3; k++) {
          float o = float(k) * 13.7 + uFrame;
          float a = gauss(vec3(i, o)), b = gauss(vec3(i + vec2(1, 0), o)), c = gauss(vec3(i + vec2(0, 1), o)), d = gauss(vec3(i + vec2(1, 1), o));
          r[k] = mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }
        return r;
      }
      vec3 srgb(vec3 x){ x = clamp(x, 0.0, 1.0); return mix(12.92 * x, 1.055 * pow(x, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, x)); }
      void main(){
        float g = texture2D(tExp, vec2(0.5)).r;
        vec3 lin = texture2D(tSrc, vUv).rgb;
        if (uRaw > 0.5) { gl_FragColor = vec4(srgb(lin * 1.1), 1.0); return; }
        float dirt = texture2D(tDirt, vec2(vUv.x, 1.0 - vUv.y)).r;
        vec3 b1 = texture2D(tB1, vUv).rgb, b2 = texture2D(tB2, vUv).rgb, b3 = texture2D(tB3, vUv).rgb;
        vec3 x = lin * g + b1 * 0.10 + b2 * 0.07 + b3 * 0.05 + (b2 * 0.10 + b3 * 0.16) * dirt;
        x = x * (1.0 + 5.0 * uWhite) + vec3(uWhite * uWhite * 16.0);      // 被闪光弹晃到：整幅过曝，再慢慢退回来
        vec2 px = vUv * uRes;
        float ns = 0.012 + 0.006 * min(g, 4.0);
        vec3 n = vec3(gauss(vec3(px, uFrame))) * ns + chroma(px) * ns * 0.9;
        x = max(x + n * sqrt(clamp(x, 0.002, 1.0) + 0.01), 0.0);
        const float wp = 2.1;
        vec3 y = x * (1.0 + x / (wp * wp)) / (1.0 + x);       // 动态范围有限，高光偏硬
        y = srgb(clamp(y * 1.06, 0.0, 1.0));
        y = clamp((y - 0.5) * 1.10 + 0.5 + 0.012, 0.0, 1.0);
        float l = dot(y, vec3(0.2126, 0.7152, 0.0722));
        y = l + (y - l) * 0.84;
        y = y * vec3(0.975, 1.0, 0.975) + vec3(0.0, 0.004, 0.006);
        gl_FragColor = vec4(clamp(y, 0.0, 1.0), 1.0);
      }`, { tSrc: { value: null }, tB1: { value: null }, tB2: { value: null }, tB3: { value: null }, tDirt: { value: dirt }, tExp: { value: null },
        uFrame: { value: 0 }, uRes: { value: new THREE.Vector2() }, uRaw: { value: this.raw ? 1 : 0 }, uWhite: { value: 0 } });
    // 6) 机内降噪 + 过锐化 + 细颗粒
    this.pFinal = pass(/* glsl */`
      uniform sampler2D tSrc; uniform vec2 uPx; uniform float uFrame; uniform vec2 uRes; uniform float uRaw; varying vec2 vUv;
      float hash(vec3 p){ p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
      void main(){
        vec3 c = texture2D(tSrc, vUv).rgb;
        if (uRaw > 0.5) { gl_FragColor = vec4(c, 1.0); return; }
        vec3 den = c * 0.30, wide = c * 0.11; float wd = 0.30, ww = 0.11;
        for (int y = -3; y <= 3; y++) for (int x = -3; x <= 3; x++) {
          if (x == 0 && y == 0) continue;
          vec2 o = vec2(float(x), float(y)); float r2 = dot(o, o);
          vec3 s = texture2D(tSrc, vUv + o * uPx).rgb;
          float a = exp(-r2 / (2.0 * 0.64)) * 0.30; den += s * a; wd += a;         // σ = 0.8
          float b = exp(-r2 / (2.0 * 3.2)) * 0.11; wide += s * b; ww += b;        // σ ≈ 1.79
        }
        den /= wd; wide /= ww;
        vec3 y = den + (den - wide) * 0.85;
        float n = (hash(vec3(vUv * uRes, uFrame + 7.0)) + hash(vec3(vUv * uRes, uFrame + 19.0)) - 1.0) * 1.2247;
        gl_FragColor = vec4(clamp(y + n * 0.010 * 1.4, 0.0, 1.0), 1.0);
      }`, { tSrc: { value: null }, uPx: { value: new THREE.Vector2() }, uFrame: { value: 0 }, uRes: { value: new THREE.Vector2() }, uRaw: { value: this.raw ? 1 : 0 } });
    this.expA = rt(1, 1, { type: THREE.FloatType, nearest: true }); this.expB = rt(1, 1, { type: THREE.FloatType, nearest: true });
    this.meter = rt(32, 18);
    this.maskMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  }

  // 只换场景那一层的分辨率（动态分辨率用），其余缓冲和曝光状态都不动
  setInternalScale(s) {
    this.internalScale = s;
    const maxTex = Math.min(this.r.capabilities.maxTextureSize, 6144);
    let iw = Math.round(this.w * s), ih = Math.round(this.h * s);
    if (iw > maxTex) { ih = Math.round(ih * maxTex / iw); iw = maxTex; }
    if (iw === this.iw && ih === this.ih && this.rtScene) return;
    this.rtScene?.dispose(); this.mask?.dispose();
    this.rtScene = rt(iw, ih, { depth: true, samples: 4, mip: true, aniso: 8 });
    this.mask = rt(iw >> 2, ih >> 2, { type: THREE.UnsignedByteType, depth: false });
    this.iw = iw; this.ih = ih;
  }
  resize(w, h) {
    this.w = w; this.h = h; this.iw = this.ih = 0;
    this.setInternalScale(this.internalScale);
    const iw = this.iw, ih = this.ih;
    for (const k of ['a', 'b', 'br', 'bl1a', 'bl1b', 'bl2a', 'bl2b', 'bl3a', 'bl3b', 'ldr']) this[k]?.dispose();
    this.a = rt(w, h); this.b = rt(w, h);
    const q = [w >> 2, h >> 2];
    this.br = rt(q[0], q[1]); this.bl1a = rt(q[0], q[1]); this.bl1b = rt(q[0], q[1]);
    this.bl2a = rt(q[0] >> 1, q[1] >> 1); this.bl2b = rt(q[0] >> 1, q[1] >> 1);
    this.bl3a = rt(q[0] >> 3, q[1] >> 3); this.bl3b = rt(q[0] >> 3, q[1] >> 3);
    this.ldr = rt(w, h, { type: THREE.UnsignedByteType });
  }

  _blur(src, tmp, dst, sigma) {
    const u = this.pGauss.material.uniforms;
    u.uSigma.value = sigma;
    u.tSrc.value = src.texture; u.uDir.value.set(1 / tmp.width, 0); this.r.setRenderTarget(tmp); this.pGauss.render(this.r);
    u.tSrc.value = tmp.texture; u.uDir.value.set(0, 1 / dst.height); this.r.setRenderTarget(dst); this.pGauss.render(this.r);
  }

  _expose(init, kDown, kUp) {
    const u = this.pExpose.material.uniforms;
    u.tMeter.value = this.meter.texture; u.tPrev.value = this.expA.texture; u.uInit.value = init ? 1 : 0;
    u.uTarget.value = this.mode.aeTarget; u.uMaxGain.value = this.mode.maxGain; u.uKDown.value = kDown; u.uKUp.value = kUp;
    this.r.setRenderTarget(this.expB); this.pExpose.render(this.r);
    [this.expA, this.expB] = [this.expB, this.expA];
  }

  // camera：广角透视相机（视场由 LENS.tanV 决定）。opts.converge=true 时让曝光直接收敛（截图比对用）
  render(scene, camera, opts = {}) {
    const r = this.r; this.frame++;
    // --- 场景
    r.setRenderTarget(this.rtScene); r.setClearColor(0x000000, 1); r.clear();
    r.render(scene, camera);
    // --- 持枪手臂的遮罩（运动模糊时保持清晰）
    r.setRenderTarget(this.mask); r.setClearColor(0x000000, 1); r.clear();
    if (opts.maskLayer != null) {
      const old = camera.layers.mask, om = scene.overrideMaterial, ob = scene.background;
      camera.layers.set(opts.maskLayer); scene.overrideMaterial = this.maskMat;
      r.render(scene, camera);
      camera.layers.mask = old; scene.overrideMaterial = om;
    }
    // --- 相机相邻两帧之间的相对旋转（给运动模糊和卷帘快门用）
    const q = camera.getWorldQuaternion(new THREE.Quaternion());
    const rel = new THREE.Matrix4();
    let moving = 0;
    if (this.hasPrev && !opts.noBlur) {
      // 当前相机空间方向 d -> 上一帧相机空间方向 = Rprev^-1 * Rcur * d
      const dq = this.prevQuat.clone().invert().multiply(q);
      const half = new THREE.Quaternion().slerp(dq, opts.shutter ?? 0.5);        // 快门 0.5 帧
      rel.makeRotationFromQuaternion(half);
      moving = 2 * Math.acos(Math.min(1, Math.abs(dq.w))) > 0.0015 ? 1 : 0;
      const rs = new THREE.Quaternion().slerp(dq, 0.35);
      this.pDistort.material.uniforms.uRS.value.setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(rs));
      this.pDistort.material.uniforms.uRSOn.value = moving;
    } else this.pDistort.material.uniforms.uRSOn.value = 0;
    this.prevQuat.copy(q); this.hasPrev = true;
    // --- 鱼眼
    let u = this.pDistort.material.uniforms; u.tScene.value = this.rtScene.texture; u.tMask.value = this.mask.texture;
    r.setRenderTarget(this.a); this.pDistort.render(r);
    // --- 运动模糊
    u = this.pBlur.material.uniforms; u.tSrc.value = this.a.texture; u.uRot.value.setFromMatrix4(rel); u.uOn.value = moving;
    r.setRenderTarget(this.b); this.pBlur.render(r);
    // --- 测光 + 曝光
    u = this.pMeter.material.uniforms; u.tSrc.value = this.b.texture; u.uPx.value.set(1 / this.w * 8, 1 / this.h * 8);
    r.setRenderTarget(this.meter); this.pMeter.render(r);
    if (opts.converge) { this._expose(true, 0.5, 0.5); for (let i = 0; i < 60; i++) this._expose(false, 0.5, 0.5); }
    else if (opts.fixedGain == null) this._expose(this.frame < 3, 0.22 * (opts.aeRate ?? 1), 0.07 * (opts.aeRate ?? 1));
    // --- 泛光
    u = this.pBright.material.uniforms; u.tSrc.value = this.b.texture; u.tExp.value = this.expA.texture; u.uPx.value.set(1 / this.w, 1 / this.h);
    r.setRenderTarget(this.br); this.pBright.render(r);
    this._blur(this.br, this.bl1a, this.bl1b, 3.0);
    this.pCopy.material.uniforms.tSrc.value = this.bl1b.texture; r.setRenderTarget(this.bl2a); this.pCopy.render(r);
    this._blur(this.bl2a, this.bl2b, this.bl2a, 5.3);
    this.pCopy.material.uniforms.tSrc.value = this.bl2a.texture; r.setRenderTarget(this.bl3a); this.pCopy.render(r);
    this._blur(this.bl3a, this.bl3b, this.bl3a, 3.8);
    // --- 合成
    u = this.pTone.material.uniforms; u.tSrc.value = this.b.texture; u.tB1.value = this.bl1b.texture; u.tB2.value = this.bl2a.texture; u.tB3.value = this.bl3a.texture;
    u.tExp.value = this.expA.texture; u.uFrame.value = this.frame % 1024; u.uRes.value.set(this.w, this.h); u.uWhite.value = opts.white ?? 0;
    r.setRenderTarget(this.ldr); this.pTone.render(r);
    u = this.pFinal.material.uniforms; u.tSrc.value = this.ldr.texture; u.uPx.value.set(1 / this.w, 1 / this.h); u.uFrame.value = this.frame % 1024; u.uRes.value.set(this.w, this.h);
    r.setRenderTarget(null); this.pFinal.render(r);
  }
}
