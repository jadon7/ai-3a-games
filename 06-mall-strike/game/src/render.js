// Frame pipeline: sun shadow maps -> planar floor reflection -> HDR world (MSAA) -> volumetric haze ->
// combine + camera motion blur -> viewmodel -> Blender AgX LUT -> video-matched bloom/CA/sharpen/grade/vignette/grain.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { G, SUN_EFF, GLSL_SHADOW } from './materials.js';
import { LAYER } from './world.js';

const QUAD_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

function rt(w, h, o = {}) {
  const opt = {
    type: o.type ?? THREE.HalfFloatType, format: THREE.RGBAFormat, colorSpace: THREE.NoColorSpace,
    minFilter: o.mip ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter, magFilter: THREE.LinearFilter,
    generateMipmaps: !!o.mip, depthBuffer: o.depth ?? false, samples: o.samples ?? 0,
  };
  if (o.depthTexture) opt.depthTexture = o.depthTexture;
  return new THREE.WebGLRenderTarget(w, h, opt);
}

export class Pipeline {
  constructor(renderer, world) {
    this.r = renderer;
    this.world = world;
    this.frame = 0;
    this.scale = 1;
    this.prevVP = new THREE.Matrix4();
    this.hasPrev = false;
    this.mbStrength = 1;
    this._initShadows();
    this._initPasses();
    this.resize(window.innerWidth, window.innerHeight);
  }

  // ------------------------------------------------------------ shadows
  _initShadows() {
    const mk = (s) => {
      const dt = new THREE.DepthTexture(s, s); dt.type = THREE.FloatType;
      return new THREE.WebGLRenderTarget(s, s, { depthTexture: dt, depthBuffer: true, colorSpace: THREE.NoColorSpace });
    };
    this.statRT = mk(4096);
    this.dynRT = mk(2048);
    G.uStatShadow.value = this.statRT.depthTexture;
    G.uDynShadow.value = this.dynRT.depthTexture;
    this.depthMat = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
    this.statCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 400);
    this.dynCam = new THREE.OrthographicCamera(-25, 25, 25, -25, 0.1, 400);
    this.statCam.layers.set(LAYER.STATIC);
    this.dynCam.layers.set(LAYER.DYN);
    this.bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.statDirty = true;
  }

  _fitSunCam(cam, center, half) {
    const L = G.uSunDir.value;
    cam.position.copy(center).addScaledVector(L, 150);
    cam.up.set(0, 0, -1);
    cam.lookAt(center);
    cam.updateMatrixWorld();
    if (half) {
      cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
    } else {
      // fit the mall AABB in light space
      const inv = cam.matrixWorldInverse;
      const box = new THREE.Box3();
      for (const x of [-17.5, 17.5]) for (const y of [-0.6, 11.2]) for (const z of [-62.5, 12.5])
        box.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(inv));
      cam.left = box.min.x; cam.right = box.max.x; cam.bottom = box.min.y; cam.top = box.max.y;
      cam.near = -box.max.z - 1; cam.far = -box.min.z + 1;
    }
    if (half) { cam.near = 100; cam.far = 220; }
    cam.updateProjectionMatrix();
    return new THREE.Matrix4().multiplyMatrices(this.bias, cam.projectionMatrix).multiply(cam.matrixWorldInverse);
  }

  renderShadows(scene, playerPos) {
    const r = this.r;
    const prevOverride = scene.overrideMaterial;
    scene.overrideMaterial = this.depthMat;
    if (this.statDirty) {
      G.uStatShadowMat.value.copy(this._fitSunCam(this.statCam, new THREE.Vector3(0, 5, -25), 0));
      r.setRenderTarget(this.statRT); r.clear(); r.render(scene, this.statCam);
      this.statDirty = false;
    }
    const c = new THREE.Vector3(Math.round(playerPos.x), 1, Math.round(playerPos.z));
    G.uDynShadowMat.value.copy(this._fitSunCam(this.dynCam, c, 25));
    r.setRenderTarget(this.dynRT); r.clear(); r.render(scene, this.dynCam);
    scene.overrideMaterial = prevOverride;
  }

  // ------------------------------------------------------------ passes
  _initPasses() {
    const u = (o) => o;
    // volumetric haze
    this.volMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VS,
      fragmentShader: /* glsl */`
        #define PI 3.141592653589793
        ${GLSL_SHADOW}
        varying vec2 vUv;
        uniform sampler2D tDepth; uniform mat4 uInvProj, uCamWorld; uniform vec3 uCamPos;
        uniform vec3 uSunDir, uSunE; uniform float uDensity, uG, uFrame; uniform vec3 uBoxMin, uBoxMax;
        uniform vec3 uAmb[10];
        float ign(vec2 p){ return fract(52.9829189*fract(dot(p, vec2(0.06711056,0.00583715)))); }
        vec3 amb(float bz){ float by = -bz; float f = clamp((by + 10.0)/8.0, 0.0, 8.99); int i = int(f); return mix(uAmb[i], uAmb[min(i+1,9)], f-float(i)); }
        void main(){
          float d = texture(tDepth, vUv).r;
          vec4 vp = uInvProj * vec4(vUv*2.0-1.0, d*2.0-1.0, 1.0); vp /= vp.w;
          vec3 wp = (uCamWorld * vp).xyz;
          vec3 ro = uCamPos; vec3 rd = wp - ro; float dist = length(rd); rd /= dist;
          if (d >= 0.99999) dist = 300.0;
          vec3 inv = 1.0/rd; vec3 t0 = (uBoxMin-ro)*inv, t1 = (uBoxMax-ro)*inv;
          vec3 tmn = min(t0,t1), tmx = max(t0,t1);
          float tn = max(max(tmn.x, tmn.y), max(tmn.z, 0.0)); float tf = min(min(tmx.x, tmx.y), tmx.z); tf = min(tf, dist);
          vec3 L = vec3(0.0); float T = 1.0;
          if (tf > tn) {
            const int N = 36;
            float dt = (tf - tn) / float(N);
            float j = ign(gl_FragCoord.xy + mod(uFrame, 64.0)*vec2(5.588, 7.17));
            float ct = dot(rd, uSunDir); float g = uG;
            float ph = (1.0-g*g) / (4.0*PI*pow(1.0+g*g-2.0*g*ct, 1.5));
            float ext = exp(-uDensity*dt);
            for (int i=0;i<N;i++){
              vec3 p = ro + rd*(tn + (float(i)+j)*dt);
              float vis = statVis(p) * dynVis(p);
              vec3 S = uDensity * vec3(0.95,0.93,0.9) * (uSunE*ph*vis + amb(p.z));
              L += T * S * dt;
              T *= ext;
            }
          }
          gl_FragColor = vec4(L, T);
        }`,
      uniforms: {
        tDepth: { value: null }, uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
        uCamPos: { value: new THREE.Vector3() }, uSunDir: G.uSunDir,
        uSunE: { value: new THREE.Vector3(1, 0.95, 0.88).multiplyScalar(Math.PI * SUN_EFF) },
        uDensity: { value: 0.0055 }, uG: { value: 0.55 }, uFrame: { value: 0 },
        uBoxMin: { value: new THREE.Vector3(-10.8, 0.02, -61.6) }, uBoxMax: { value: new THREE.Vector3(10.8, 10.35, 11.6) },
        uAmb: { value: Array.from({ length: 10 }, () => new THREE.Vector3(0.6, 0.6, 0.6)) },
        uStatShadow: G.uStatShadow, uStatShadowMat: G.uStatShadowMat, uDynShadow: G.uDynShadow, uDynShadowMat: G.uDynShadowMat,
      },
      depthTest: false, depthWrite: false,
    });
    const pm = this.world.probeMeta.probes;
    for (let i = 0; i < 10; i++) { const p = pm[i * 3 + 1].mean; this.volMat.uniforms.uAmb.value[i].set(p[0], p[1], p[2]); }
    this.volQuad = new FullScreenQuad(this.volMat);

    // combine (haze, depth-aware upsample) + camera motion blur
    this.combMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VS,
      fragmentShader: /* glsl */`
        varying vec2 vUv;
        uniform sampler2D tColor, tVol, tDepth; uniform mat4 uInvProj, uCamWorld, uPrevVP; uniform float uMB; uniform vec2 uTexel;
        vec3 shade(vec2 uv){ vec4 v = texture(tVol, uv); return texture(tColor, uv).rgb * v.a + v.rgb; }
        void main(){
          float d = texture(tDepth, vUv).r;
          vec4 vp = uInvProj * vec4(vUv*2.0-1.0, d*2.0-1.0, 1.0); vp /= vp.w;
          vec3 wp = (uCamWorld * vp).xyz;
          if (d >= 0.99999) wp = uCamWorld[3].xyz + normalize(wp - uCamWorld[3].xyz) * 1000.0;
          vec4 pc = uPrevVP * vec4(wp, 1.0);
          vec2 puv = pc.xy / pc.w * 0.5 + 0.5;
          vec2 vel = (vUv - puv) * uMB;
          float vl = length(vel); if (vl > 0.05) vel *= 0.05 / vl;
          vec3 acc = vec3(0.0);
          const int N = 10;
          for (int i=0;i<N;i++){ float t = (float(i)+0.5)/float(N) - 0.5; acc += shade(vUv + vel*t); }
          gl_FragColor = vec4(acc / float(N), 1.0);
        }`,
      uniforms: { tColor: { value: null }, tVol: { value: null }, tDepth: { value: null }, uInvProj: { value: new THREE.Matrix4() },
        uCamWorld: { value: new THREE.Matrix4() }, uPrevVP: { value: new THREE.Matrix4() }, uMB: { value: 0 }, uTexel: { value: new THREE.Vector2() } },
      depthTest: false, depthWrite: false,
    });
    this.combQuad = new FullScreenQuad(this.combMat);

    // Blender view transform LUT
    this.lutMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VS,
      fragmentShader: /* glsl */`
        precision highp sampler3D;
        varying vec2 vUv; uniform sampler2D tColor; uniform sampler3D tLut; uniform float uN, uExp;
        void main(){
          vec3 c = max(texture(tColor, vUv).rgb * uExp, vec3(1e-7));
          vec3 x = clamp((log2(c) + 12.0) / 19.0, 0.0, 1.0);
          x = x * (uN - 1.0) / uN + 0.5 / uN;
          gl_FragColor = vec4(texture(tLut, x).rgb, 1.0);
        }`,
      uniforms: { tColor: { value: null }, tLut: { value: null }, uN: { value: 48 }, uExp: { value: 1 } },
      depthTest: false, depthWrite: false,
    });
    this.lutQuad = new FullScreenQuad(this.lutMat);

    // bloom (display space, as composite.py)
    this.thrMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VS,
      fragmentShader: `varying vec2 vUv; uniform sampler2D t; uniform vec2 uTexel;
        vec3 f(vec2 uv){ vec3 c = texture(t, uv).rgb; float m = clamp((max(max(c.r,c.g),c.b) - 0.78)/0.22, 0.0, 1.0); return c*m; }
        void main(){ vec3 s = f(vUv + uTexel*vec2(-1.,-1.)) + f(vUv + uTexel*vec2(1.,-1.)) + f(vUv + uTexel*vec2(-1.,1.)) + f(vUv + uTexel*vec2(1.,1.));
          gl_FragColor = vec4(s*0.25, 1.0); }`,
      uniforms: { t: { value: null }, uTexel: { value: new THREE.Vector2() } }, depthTest: false, depthWrite: false,
    });
    this.blurMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VS,
      fragmentShader: `varying vec2 vUv; uniform sampler2D t; uniform vec2 uDir; uniform float uSigma;
        void main(){ vec3 s = vec3(0.0); float ws = 0.0;
          for (int i=-12;i<=12;i++){ float x = float(i); float w = exp(-x*x/(2.0*uSigma*uSigma)); s += texture(t, vUv + uDir*x).rgb * w; ws += w; }
          gl_FragColor = vec4(s/ws, 1.0); }`,
      uniforms: { t: { value: null }, uDir: { value: new THREE.Vector2() }, uSigma: { value: 3 } }, depthTest: false, depthWrite: false,
    });
    this.copyMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VS, fragmentShader: `varying vec2 vUv; uniform sampler2D t; void main(){ gl_FragColor = texture(t, vUv); }`,
      uniforms: { t: { value: null } }, depthTest: false, depthWrite: false,
    });
    this.finalMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VS,
      fragmentShader: /* glsl */`
        varying vec2 vUv; uniform sampler2D tLdr, tB1, tB2; uniform vec2 uTexel, uRes; uniform float uFrame, uFlash, uDamage;
        vec3 img(vec2 uv){ return texture(tLdr, uv).rgb + texture(tB1, uv).rgb*0.35 + texture(tB2, uv).rgb*0.3; }
        float h12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        float gauss(vec2 p){ float u1 = max(h12(p), 1e-6), u2 = h12(p + 17.31); return sqrt(-2.0*log(u1))*cos(6.2831853*u2); }
        void main(){
          vec2 c = vUv - 0.5;
          vec3 base = img(vUv);
          vec3 col = vec3(img(0.5 + c/1.0012).r, base.g, img(0.5 + c/0.9988).b);
          // unsharp mask sigma ~1.1 px, amount 0.45
          vec3 bl = base;
          vec3 e = img(vUv+vec2(uTexel.x,0.)) + img(vUv-vec2(uTexel.x,0.)) + img(vUv+vec2(0.,uTexel.y)) + img(vUv-vec2(0.,uTexel.y));
          vec3 k = img(vUv+uTexel) + img(vUv-uTexel) + img(vUv+vec2(uTexel.x,-uTexel.y)) + img(vUv+vec2(-uTexel.x,uTexel.y));
          bl = (base + e*0.662 + k*0.438) / 5.4;
          col += (base - bl) * 0.45;
          col = clamp(col, 0.0, 1.2);
          vec3 x = clamp(col, 0.0, 1.0); vec3 s = x*x*(3.0-2.0*x);
          col = col*0.8 + s*0.2;
          float lv = (col.r+col.g+col.b)/3.0;
          col += (0.5 - lv) * vec3(-0.012, 0.0, 0.018) * 0.6;
          float r2 = (c.x*2.0)*(c.x*2.0) + (c.y*2.0)*(c.y*2.0);
          col *= 1.0 - 0.16*r2;
          vec2 px = floor(vUv*uRes) + mod(uFrame, 997.0)*vec2(13.7, 71.3);
          col += gauss(px)*0.011 + vec3(gauss(px+1.3), gauss(px+2.7), gauss(px+5.1))*0.004;
          gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
        }`,
      uniforms: { tLdr: { value: null }, tB1: { value: null }, tB2: { value: null }, uTexel: { value: new THREE.Vector2() },
        uRes: { value: new THREE.Vector2() }, uFrame: { value: 0 }, uFlash: { value: 0 }, uDamage: { value: 0 } },
      depthTest: false, depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.copyMat);

    // planar reflection
    this.reflCam = new THREE.PerspectiveCamera();
    this.reflCam.layers.set(0); this.reflCam.layers.enable(LAYER.DYN);
  }

  setLUT(data, N) {
    const t = new THREE.Data3DTexture(data, N, N, N);
    t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
    t.minFilter = t.magFilter = THREE.LinearFilter; t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping;
    t.unpackAlignment = 1; t.needsUpdate = true;
    this.lutMat.uniforms.tLut.value = t; this.lutMat.uniforms.uN.value = N;
  }

  resize(w, h) {
    // cap the internal resolution near 1080p-class pixel counts (the video's resolution); the browser upscales
    const maxPx = 2.1e6;
    let dpr = Math.min(window.devicePixelRatio || 1, 2) * this.scale;
    if (w * h * dpr * dpr > maxPx) dpr = Math.sqrt(maxPx / (w * h));
    const W = Math.round(w * dpr), H = Math.round(h * dpr);
    this.W = W; this.H = H;
    this.r.setPixelRatio(dpr);
    this.r.setSize(w, h, false);
    for (const k of ['worldRT', 'volRT', 'combRT', 'ldrRT', 'q1', 'q2', 'q3', 's1', 's2', 'reflRT']) this[k]?.dispose();
    const dt = new THREE.DepthTexture(W, H); dt.type = THREE.FloatType;
    this.worldRT = rt(W, H, { depth: true, samples: 4, depthTexture: dt });
    this.volRT = rt(W >> 1, H >> 1);
    this.combRT = rt(W, H, { depth: true, samples: 4 });
    this.ldrRT = rt(W, H, { type: THREE.UnsignedByteType });
    const qw = Math.max(1, W >> 2), qh = Math.max(1, H >> 2);
    this.q1 = rt(qw, qh); this.q2 = rt(qw, qh); this.q3 = rt(qw, qh);
    this.s1 = rt(Math.max(1, qw >> 2), Math.max(1, qh >> 2)); this.s2 = rt(Math.max(1, qw >> 2), Math.max(1, qh >> 2));
    this.reflRT = rt(W >> 1, H >> 1, { depth: true, mip: true });
    G.uRefl.value = this.reflRT.texture;
  }

  _blit(mat, target) { this.quad.material = mat; this.r.setRenderTarget(target); this.quad.render(this.r); }

  renderReflection(scene, cam) {
    // mirror camera about the floor plane y = 0 (three.js Reflector math)
    const rc = this.reflCam;
    const n = new THREE.Vector3(0, 1, 0);
    const camPos = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
    const rot = new THREE.Matrix4().extractRotation(cam.matrixWorld);
    const look = new THREE.Vector3(0, 0, -1).applyMatrix4(rot).add(camPos);
    const view = camPos.clone(); view.y = -view.y;
    const target = look.clone(); target.y = -target.y;
    rc.position.copy(view);
    rc.up.set(0, 1, 0).applyMatrix4(rot); rc.up.y = -rc.up.y;
    rc.lookAt(target);
    rc.far = cam.far; rc.near = cam.near;
    rc.updateMatrixWorld();
    rc.projectionMatrix.copy(cam.projectionMatrix);
    G.uReflMat.value.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(rc.projectionMatrix).multiply(rc.matrixWorldInverse);
    // oblique near plane
    const plane = new THREE.Plane(n, 0).applyMatrix4(rc.matrixWorldInverse);
    const cp = new THREE.Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const pm = rc.projectionMatrix; const q = new THREE.Vector4();
    q.x = (Math.sign(cp.x) + pm.elements[8]) / pm.elements[0];
    q.y = (Math.sign(cp.y) + pm.elements[9]) / pm.elements[5];
    q.z = -1.0; q.w = (1.0 + pm.elements[10]) / pm.elements[14];
    cp.multiplyScalar(2.0 / cp.dot(q));
    pm.elements[2] = cp.x; pm.elements[6] = cp.y; pm.elements[10] = cp.z + 1.0; pm.elements[14] = cp.w;
    rc.projectionMatrixInverse.copy(pm).invert();
    this.r.setRenderTarget(this.reflRT); this.r.clear(); this.r.render(scene, rc);
  }

  render(scene, vmScene, cam, dt, playerPos) {
    const r = this.r;
    this.frame++;
    G.uTime.value += dt;
    r.autoClear = false;
    this.renderShadows(scene, playerPos);
    this.renderReflection(scene, cam);
    // world
    r.setRenderTarget(this.worldRT); r.clear(); r.render(scene, cam);
    // volumetric haze (half res)
    const vu = this.volMat.uniforms;
    vu.tDepth.value = this.worldRT.depthTexture;
    vu.uInvProj.value.copy(cam.projectionMatrixInverse); vu.uCamWorld.value.copy(cam.matrixWorld);
    vu.uCamPos.value.setFromMatrixPosition(cam.matrixWorld); vu.uFrame.value = this.frame;
    r.setRenderTarget(this.volRT); this.volQuad.render(r);
    // combine + motion blur
    const cu = this.combMat.uniforms;
    cu.tColor.value = this.worldRT.texture; cu.tVol.value = this.volRT.texture; cu.tDepth.value = this.worldRT.depthTexture;
    cu.uInvProj.value.copy(cam.projectionMatrixInverse); cu.uCamWorld.value.copy(cam.matrixWorld);
    const vp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    cu.uPrevVP.value.copy(this.hasPrev ? this.prevVP : vp);
    // shutter 0.45 of a 30 fps frame (= 15 ms) like the video, scaled to this frame's duration
    cu.uMB.value = this.mbStrength * Math.min(1.5, 0.015 / Math.max(dt, 1e-3));
    this.prevVP.copy(vp); this.hasPrev = true;
    r.setRenderTarget(this.combRT); r.clear(); this.combQuad.render(r);
    // viewmodel on top (own depth)
    if (vmScene) { r.clearDepth(); r.render(vmScene, cam); }
    // tonemap
    this.lutMat.uniforms.tColor.value = this.combRT.texture;
    r.setRenderTarget(this.ldrRT); this.lutQuad.render(r);
    // bloom
    this.thrMat.uniforms.t.value = this.ldrRT.texture; this.thrMat.uniforms.uTexel.value.set(1 / this.W, 1 / this.H);
    this._blit(this.thrMat, this.q1);
    const bm = this.blurMat.uniforms; const qw = this.q1.width, qh = this.q1.height;
    bm.uSigma.value = 3; bm.t.value = this.q1.texture; bm.uDir.value.set(1 / qw, 0); this._blit(this.blurMat, this.q2);
    bm.t.value = this.q2.texture; bm.uDir.value.set(0, 1 / qh); this._blit(this.blurMat, this.q3);
    this.copyMat.uniforms.t.value = this.q1.texture; this._blit(this.copyMat, this.s1);
    const sw = this.s1.width, sh = this.s1.height;
    bm.t.value = this.s1.texture; bm.uDir.value.set(1 / sw, 0); this._blit(this.blurMat, this.s2);
    bm.t.value = this.s2.texture; bm.uDir.value.set(0, 1 / sh); this._blit(this.blurMat, this.s1);
    // final
    const fu = this.finalMat.uniforms;
    fu.tLdr.value = this.ldrRT.texture; fu.tB1.value = this.q3.texture; fu.tB2.value = this.s1.texture;
    fu.uTexel.value.set(1 / this.W, 1 / this.H); fu.uRes.value.set(this.W, this.H); fu.uFrame.value = this.frame;
    this._blit(this.finalMat, null);
    r.autoClear = true;
  }
}
