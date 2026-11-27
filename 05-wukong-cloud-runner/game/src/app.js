// 引擎外壳：渲染器、帧流程、太阳/天空、测试（截图）模式。游戏本体和各模块的测试页都用它。
//
// 每帧流程：
//   1. scene（不透明物体：石峰、树、角色…）        → rtScene（HDR 线性颜色 + 深度图）
//   2. 大气合成（雾 + 体积云海，全屏）              → rtAtmo        由 app.setAtmosphere() 提供，没有就用内置的简单雾
//   3. sceneFx（透明/体积物体：筋斗云、尾迹、光环…） → 叠到 rtAtmo   着色器自己用 app.fx.uniforms 的场景深度做遮挡
//   4. 后期（景深/泛光/调色/颗粒…）                 → 屏幕          由 app.setPost() 提供，没有就用内置的色调映射
//
// 测试模式（URL 带 ?shot=1）：用固定步长把模拟推进到 t 秒（?t=3.5），画几帧后设 window.__READY = true，供 tools/shot.mjs 截图。
//   相机可用 ?cam=x,y,z&look=x,y,z&fov=50 指定（three 坐标）。
import * as THREE from 'three';
import { SUN_DIR, SUN_COLOR, SUN_INTENSITY, SKY_INTENSITY, PARAMS, SHOT_MODE, QUALITY, QUALITY_NAME, num, vec } from './common.js';

const FS_VERT = /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const _fsScene = new THREE.Scene();
const _fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const _fsMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
_fsMesh.frustumCulled = false;
_fsScene.add(_fsMesh);

/** 全屏着色器通道。fragmentShader 里用 varying vec2 vUv。返回 { material, uniforms, render(renderer, target) }。 */
export function fullscreenPass(fragmentShader, uniforms = {}, extra = {}) {
  const material = new THREE.ShaderMaterial({ vertexShader: FS_VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false, ...extra });
  return {
    material, uniforms: material.uniforms,
    render(renderer, target = null) {
      _fsMesh.material = material;
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      renderer.render(_fsScene, _fsCam);
      renderer.setRenderTarget(prev);
    },
  };
}

export const AGX_GLSL = /* glsl */`
vec3 agxContrast(vec3 x) { vec3 x2 = x * x; vec3 x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232; }
// 线性场景值 → 显示值（已含显示伽马），近似 Blender 的 AgX
vec3 agxTonemap(vec3 v) {
  const mat3 m = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051, 0.0784335999999992, 0.878468636469772, 0.0784336, 0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  const mat3 mi = mat3(1.19687900512017, -0.0528968517574562, -0.0529716355144438, -0.0980208811401368, 1.15190312990417, -0.0980434501171241, -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  v = m * max(v, vec3(1e-10));
  v = clamp(log2(v), -12.47393, 4.026069);
  v = (v + 12.47393) / 16.499999;
  v = agxContrast(v);
  return clamp(mi * v, 0.0, 1.0);
}`;

const SKY_GLSL = /* glsl */`
uniform vec3 uSunDir;
vec3 fallbackSky(vec3 d) {
  float h = max(d.y, 0.0);
  float t = pow(1.0 - h, 3.0);
  vec3 c = mix(vec3(0.15, 0.29, 0.56), vec3(0.74, 0.76, 0.76), t);
  float mu = max(dot(d, uSunDir), 0.0);
  c += vec3(1.0, 0.72, 0.42) * (0.5 * pow(mu, 6.0) + 2.0 * pow(mu, 40.0)) * (0.3 + 0.7 * t);
  c = mix(c, vec3(0.60, 0.61, 0.60), smoothstep(0.0, -0.12, d.y));
  return c;
}`;

function makeFallbackSky() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uSunDir: { value: SUN_DIR.clone() }, uSunDisc: { value: 1.0 } },
    vertexShader: /* glsl */`varying vec3 vDir; void main() { vDir = position; vec4 p = projectionMatrix * mat4(mat3(modelViewMatrix)) * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: SKY_GLSL + /* glsl */`
      uniform float uSunDisc; varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 c = fallbackSky(d);
        float mu = dot(d, uSunDir);
        c += uSunDisc * vec3(1.0, 0.85, 0.62) * 60.0 * smoothstep(0.999985, 0.99999, mu);     // 日轮（视直径约 0.53°）
        gl_FragColor = vec4(c, 1.0);
      }`,
    side: THREE.BackSide, depthWrite: false, depthTest: true,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
  mesh.frustumCulled = false; mesh.renderOrder = -1000; mesh.name = 'Sky';
  return mesh;
}

const FALLBACK_ATMO = /* glsl */`
uniform sampler2D tColor; uniform sampler2D tDepth; uniform mat4 uProjInv, uViewInv; uniform vec3 uCamPos, uSunDir; varying vec2 vUv;
void main() {
  vec4 c = texture2D(tColor, vUv); float d = texture2D(tDepth, vUv).x;
  if (d < 1.0) {
    vec4 v = uProjInv * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); v /= v.w;
    vec3 wp = (uViewInv * v).xyz; float dist = length(wp - uCamPos); vec3 rd = (wp - uCamPos) / dist;
    float f = 1.0 - exp(-dist * 0.0020);
    vec3 fogc = mix(vec3(0.62, 0.67, 0.74), vec3(1.0, 0.82, 0.60) * 1.4, pow(max(dot(rd, uSunDir), 0.0), 4.0));
    c.rgb = mix(c.rgb, fogc, f);
  }
  gl_FragColor = c;
}`;

const FALLBACK_POST = AGX_GLSL + /* glsl */`
uniform sampler2D tColor; uniform float uExposure; varying vec2 vUv;
void main() { vec3 c = texture2D(tColor, vUv).rgb * uExposure; gl_FragColor = vec4(agxTonemap(c), 1.0); }`;

export async function createApp(opts = {}) {
  const canvas = opts.canvas || document.getElementById('view');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;       // 最终通道自己输出显示值
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = false;

  const scene = new THREE.Scene();
  const sceneFx = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(num('fov', 50), 16 / 9, 0.3, 60000);
  camera.position.copy(vec('cam', new THREE.Vector3(0, 115, 12)));
  camera.lookAt(vec('look', new THREE.Vector3(0, 113, 0)));

  // ---- 太阳 + 天空
  const sunLight = new THREE.DirectionalLight(SUN_COLOR, SUN_INTENSITY);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(QUALITY.shadow, QUALITY.shadow);
  sunLight.shadow.bias = -1.0e-5; sunLight.shadow.normalBias = 0.025;
  scene.add(sunLight, sunLight.target);
  const shadowFocus = new THREE.Vector3(0, 112, 0);
  let shadowRange = 24;                                            // 阴影覆盖半径（米）：以角色为中心的一根朝向太阳的"管子"，管内的石峰都会把影子投到角色身上
  function updateSun() {
    const sc = sunLight.shadow.camera;
    sc.left = -shadowRange; sc.right = shadowRange; sc.top = shadowRange; sc.bottom = -shadowRange; sc.near = 1; sc.far = 2900; sc.updateProjectionMatrix();
    // 把焦点对齐到阴影纹素网格上，避免移动时阴影边缘闪烁
    const texel = (2 * shadowRange) / QUALITY.shadow;
    const f = shadowFocus.clone();
    f.x = Math.round(f.x / texel) * texel; f.y = Math.round(f.y / texel) * texel; f.z = Math.round(f.z / texel) * texel;
    sunLight.target.position.copy(f);
    sunLight.position.copy(f).addScaledVector(SUN_DIR, 2700);
    sunLight.target.updateMatrixWorld();
  }
  let sky = makeFallbackSky();
  scene.add(sky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  function bakeEnvFromSky() {
    const s = new THREE.Scene();
    const m = makeFallbackSky(); m.material.uniforms.uSunDisc.value = 0.0; m.scale.setScalar(100); s.add(m);
    const rt = pmrem.fromScene(s, 0, 0.1, 1000);
    scene.environment = rt.texture;
    return rt.texture;
  }
  let envMap = bakeEnvFromSky();
  scene.environmentIntensity = SKY_INTENSITY;

  // ---- 渲染目标
  let W = 2, H = 2;
  let dynScale = 1.0, slowWindows = 0;                               // 帧率持续不足时自动降一点渲染分辨率（只降不升）
  const depthTex = new THREE.DepthTexture(W, H, THREE.FloatType);
  const rtScene = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, depthTexture: depthTex, samples: QUALITY.msaa, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const rtAtmo = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });

  const fx = {
    uniforms: {
      tSceneDepth: { value: depthTex }, uResolution: { value: new THREE.Vector2(W, H) }, uCamNear: { value: camera.near }, uCamFar: { value: camera.far },
      uTime: { value: 0 }, uSunDir: { value: SUN_DIR.clone() }, uCamPos: { value: new THREE.Vector3() },
    },
  };
  const fallbackAtmo = fullscreenPass(FALLBACK_ATMO, { tColor: { value: null }, tDepth: { value: null }, uProjInv: { value: new THREE.Matrix4() }, uViewInv: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() }, uSunDir: { value: SUN_DIR.clone() } });
  const fallbackPost = fullscreenPass(FALLBACK_POST, { tColor: { value: null }, uExposure: { value: num('exp', 1.0) } });
  let atmosphere = null, post = null;
  const sizeListeners = [];

  function resize() {
    const cssW = canvas.clientWidth || innerWidth, cssH = canvas.clientHeight || innerHeight;
    const dpr = SHOT_MODE ? 1 : Math.min(window.devicePixelRatio || 1, num('pr', { low: 1.0, high: 1.25, ultra: 2.0 }[QUALITY_NAME] || 1.25)) * dynScale;
    const w = Math.max(2, Math.round(cssW * dpr)), h = Math.max(2, Math.round(cssH * dpr));
    if (w === W && h === H) return;
    W = w; H = h;
    renderer.setPixelRatio(1); renderer.setSize(W, H, false);
    rtScene.setSize(W, H); rtAtmo.setSize(W, H);
    fx.uniforms.uResolution.value.set(W, H);
    camera.aspect = W / H; camera.updateProjectionMatrix();
    for (const fn of sizeListeners) fn(W, H);
    if (atmosphere && atmosphere.setSize) atmosphere.setSize(W, H);
    if (post && post.setSize) post.setSize(W, H);
  }
  addEventListener('resize', resize);

  const updaters = [];
  let time = 0, frame = 0;
  const stats = { fps: 0, ms: 0, calls: 0, tris: 0, w: 0, h: 0, quality: QUALITY_NAME };
  window.__STATS = stats;

  function render(dt) {
    resize();
    updateSun();
    camera.updateMatrixWorld();
    sky.position.copy(camera.position); sky.scale.setScalar(camera.far * 0.5);
    fx.uniforms.uTime.value = time; fx.uniforms.uCamPos.value.copy(camera.position);
    fx.uniforms.uCamNear.value = camera.near; fx.uniforms.uCamFar.value = camera.far;
    renderer.info.reset();
    // 1. 不透明场景
    renderer.setRenderTarget(rtScene); renderer.setClearColor(0x000000, 1); renderer.clear();
    renderer.render(scene, camera);
    // 2. 大气
    const src = { color: rtScene.texture, depth: depthTex, width: W, height: H };
    if (atmosphere) atmosphere.render(renderer, src, camera, rtAtmo, time, dt);
    else {
      const u = fallbackAtmo.uniforms;
      u.tColor.value = src.color; u.tDepth.value = src.depth; u.uProjInv.value.copy(camera.projectionMatrixInverse); u.uViewInv.value.copy(camera.matrixWorld); u.uCamPos.value.copy(camera.position);
      fallbackAtmo.render(renderer, rtAtmo);
    }
    // 3. 透明/体积物体
    if (sceneFx.children.length) {
      renderer.setRenderTarget(rtAtmo);
      const ac = renderer.autoClear; renderer.autoClear = false;
      renderer.render(sceneFx, camera);
      renderer.autoClear = ac;
    }
    // 4. 后期 → 屏幕
    renderer.setRenderTarget(null);
    if (post) post.render(renderer, { color: rtAtmo.texture, depth: depthTex, width: W, height: H }, camera, time, dt);
    else { fallbackPost.uniforms.tColor.value = rtAtmo.texture; fallbackPost.render(renderer, null); }
    stats.calls = renderer.info.render.calls; stats.tris = renderer.info.render.triangles; stats.w = W; stats.h = H;
    frame++;
  }

  function step(dt) {
    time += dt;
    for (const fn of updaters) fn(dt, time);
  }

  const app = {
    renderer, scene, sceneFx, camera, sunLight, fx, shadowFocus, stats, canvas,
    get envMap() { return envMap; },
    get time() { return time; },
    get size() { return { width: W, height: H }; },
    quality: QUALITY, qualityName: QUALITY_NAME,
    assets: './assets/',
    onUpdate(fn) { updaters.push(fn); },
    onResize(fn) { sizeListeners.push(fn); },
    setShadowRange(r) { shadowRange = r; },
    /** 换天空：skyMesh 是跟着相机的天空球/天空盒（不写深度），env 是给 IBL 用的贴图（equirect 或已经过 PMREM 的都行） */
    setSky(skyMesh, env) {
      scene.remove(sky); sky = skyMesh; sky.frustumCulled = false; sky.renderOrder = -1000; scene.add(sky);
      if (env) { envMap = env.mapping === THREE.CubeUVReflectionMapping ? env : pmrem.fromEquirectangular(env).texture; scene.environment = envMap; }
    },
    /** 大气合成模块：{ render(renderer, src{color,depth,width,height}, camera, outTarget, time, dt), setSize?(w,h) } */
    setAtmosphere(a) { atmosphere = a; if (a && a.setSize) a.setSize(W, H); },
    /** 后期模块：{ render(renderer, src{color,depth,width,height}, camera, time, dt)（画到屏幕）, setSize?(w,h) } */
    setPost(p) { post = p; if (p && p.setSize) p.setSize(W, H); },
    step, render,
    /** 开始运行。测试模式下推进到 ?t 秒后画几帧并置 __READY；否则进入 requestAnimationFrame 循环。 */
    async start() {
      resize();
      if (SHOT_MODE) {
        const T = num('t', 0), fdt = 1 / 60;
        for (let i = 0, n = Math.round(T / fdt); i < n; i++) step(fdt);
        for (let i = 0, n = num('frames', 3); i < n; i++) { step(fdt); render(fdt); }
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        // 用真实渲染粗测一下帧耗时（含 GPU 排队，仅供参考）
        const gl = renderer.getContext(); const t0 = performance.now(); const N = num('bench', 0);
        const px = new Uint8Array(4);
        if (N) { gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }                     // 先清空排队的 GPU 工作
        const t1 = performance.now();
        for (let i = 0; i < N; i++) { step(fdt); render(fdt); }
        if (N) { gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); stats.ms = +((performance.now() - t1) / N).toFixed(2); }       // 读回一个像素强制等 GPU 画完
        // 逐帧推进接口（录制工具用）：推进 n 个固定步长并渲染最后一帧
        window.__advance = (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) { step(dt); if (i === n - 1) render(dt * n > 0.02 ? dt : dt); } return time; };
        window.__READY = true;
        return;
      }
      let last = performance.now(), acc = 0, n = 0;
      const loop = (now) => {
        const dt = Math.min(0.05, Math.max(0.0005, (now - last) / 1000)); last = now;
        step(dt); render(dt);
        acc += dt; n++;
        if (acc >= 0.5) {
          stats.fps = Math.round(n / acc); stats.ms = +(1000 * acc / n).toFixed(1); acc = 0; n = 0;
          slowWindows = (stats.fps < 54 && !document.hidden && time > 8) ? slowWindows + 1 : 0;     // 开头几秒在编译着色器/加载细节模型，不算
          if (slowWindows >= 5 && dynScale > 0.62 && !PARAMS.has('pr')) { dynScale = Math.max(0.6, dynScale - 0.1); slowWindows = 0; stats.scale = +dynScale.toFixed(2); resize(); }
        }
        if (!window.__READY) window.__READY = true;
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    },
  };
  return app;
}
