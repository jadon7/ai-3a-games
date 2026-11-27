// 天空与光照：HDRI 做背景和环境光；把 HDRI 里的太阳"挖"出来换成一盏能投影的平行光
import * as THREE from 'three/webgpu';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js';
import { PROBE } from './materials.js';
import { normalWorld, fog, positionWorld, cameraPosition, uniform, float, vec2, vec3, vec4, length, dot, exp, pow, saturate, mix, select, abs, min, texture, equirectUV, normalWorldGeometry, smoothstep, cos, sin } from 'three/tsl';

export async function setupEnvironment(scene, camera, quality, opts = {}) {
  const sunAz = (opts.sunAz ?? -28) * Math.PI / 180;       // 平面坐标里太阳所在方位（从 +x 逆时针）
  const loader = new HDRLoader(); loader.setDataType(THREE.FloatType);
  const small = await loader.loadAsync('assets/hdri/sky_1k.hdr');
  const { data, width: w, height: h } = small.image, st = data.length / (w * h);
  const lum = i => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  // ---- 找太阳 ----
  let mx = 0, mi = 0, mean = 0, cnt = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * st, l = lum(i); if (l > mx) { mx = l; mi = y * w + x; } if (y < h / 2) { mean += l; cnt++; } }
  mean /= cnt;
  const sx0 = mi % w, sy0 = Math.floor(mi / w);
  let cx = 0, cy = 0, cw = 0;
  for (let dy = -10; dy <= 10; dy++) for (let dx = -10; dx <= 10; dx++) { const x = (sx0 + dx + w) % w, y = Math.min(h - 1, Math.max(0, sy0 + dy)); const l = lum((y * w + x) * st); const wt = l * l; cx += (sx0 + dx) * wt; cy += y * wt; cw += wt; }
  cx /= cw; cy /= cw;
  const rowTop = small.flipY !== false;     // HDRLoader 默认 flipY：数据第 0 行是图像顶部
  const u = (cx + 0.5) / w, v = rowTop ? 1 - (cy + 0.5) / h : (cy + 0.5) / h;
  const lon = (u - 0.5) * 2 * Math.PI, lat = (v - 0.5) * Math.PI;
  const dH = new THREE.Vector3(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
  // ---- 把太阳从环境光里削掉，统计削掉的能量 ----
  const Lc = Math.max(mean * (opts.clampMul ?? 14), 4);
  const env = new Float32Array(w * h * 4), E = [0, 0, 0];
  for (let y = 0; y < h; y++) {
    const la = ((rowTop ? 1 - (y + 0.5) / h : (y + 0.5) / h) - 0.5) * Math.PI, dO = (2 * Math.PI / w) * (Math.PI / h) * Math.cos(la);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * st, o = (y * w + x) * 4, l = lum(i), k = l > Lc ? Lc / l : 1;
      env[o] = data[i] * k; env[o + 1] = data[i + 1] * k; env[o + 2] = data[i + 2] * k; env[o + 3] = 1;
      if (la < 0) {      // 地平线以下：赛道上真实的地面是深色沥青，不是原图里被夕阳照黄的草地
        const t = Math.min(1, -la / 0.14) * 0.9, g = (0.2126 * env[o] + 0.7152 * env[o + 1] + 0.0722 * env[o + 2]) * 0.42;
        env[o] += (g - env[o]) * t; env[o + 1] += (g - env[o + 1]) * t; env[o + 2] += (g * 1.05 - env[o + 2]) * t;
      }
      if (k < 1) { E[0] += data[i] * (1 - k) * dO; E[1] += data[i + 1] * (1 - k) * dO; E[2] += data[i + 2] * (1 - k) * dO; }
    }
  }
  // 把"让太阳转到指定方位"的旋转直接烘进环境光贴图（按列平移），之后环境光贴图的方向就是世界方向
  const dT = new THREE.Vector3(Math.cos(sunAz), 0, -Math.sin(sunAz));
  const alpha = Math.atan2(dT.x, dT.z) - Math.atan2(dH.x, dH.z);
  const envRot = new Float32Array(w * h * 4), shift = alpha / (2 * Math.PI) * w;
  for (let x = 0; x < w; x++) {
    const fx = x + shift, x0 = Math.floor(fx), t = fx - x0, a0 = ((x0 % w) + w) % w, a1 = (a0 + 1) % w;
    for (let y = 0; y < h; y++) { const o = (y * w + x) * 4, i0 = (y * w + a0) * 4, i1 = (y * w + a1) * 4; for (let c = 0; c < 4; c++) envRot[o + c] = env[i0 + c] * (1 - t) + env[i1 + c] * t; }
  }
  const envTex = new THREE.DataTexture(envRot, w, h, THREE.RGBAFormat, THREE.FloatType);
  envTex.mapping = THREE.EquirectangularReflectionMapping; envTex.colorSpace = THREE.LinearSRGBColorSpace; envTex.flipY = small.flipY;
  envTex.minFilter = envTex.magFilter = THREE.LinearFilter; envTex.needsUpdate = true;

  // ---- 太阳的世界方向 ----
  const sunDir = dH.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), alpha).normalize();
  scene.environment = envTex; scene.environmentIntensity = opts.envIntensity ?? 0.9;
  // 背景自己采样（先用小图顶上，4k 异步换入），这样能在地平线附近混入和场景一致的雾
  const bgSmall = new THREE.DataTexture(env, w, h, THREE.RGBAFormat, THREE.FloatType); bgSmall.flipY = small.flipY; bgSmall.wrapS = THREE.RepeatWrapping; bgSmall.minFilter = bgSmall.magFilter = THREE.LinearFilter; bgSmall.needsUpdate = true;
  const bgTex = texture(bgSmall, vec2(0, 0));
  const bgLoader = new HDRLoader();
  bgLoader.loadAsync('assets/hdri/sky_4k.hdr').then(t => { t.wrapS = THREE.RepeatWrapping; t.minFilter = t.magFilter = THREE.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true; bgTex.value = t; });

  // ---- 太阳光 ----
  const eMax = Math.max(E[0], E[1], E[2], 1e-6);
  const sunCol = new THREE.Color(E[0] / eMax, E[1] / eMax, E[2] / eMax);
  const warm = new THREE.Color(1.0, 0.70, 0.42);
  sunCol.lerp(warm, opts.warmMix ?? 0.65);
  const sun = new THREE.DirectionalLight(sunCol, eMax * (opts.sunScale ?? 1) + (opts.sunExtra ?? 4.6));
  sun.position.copy(sunDir).multiplyScalar(300); sun.target.position.set(0, 0, 0);
  scene.add(sun); scene.add(sun.target);
  let csm = null;
  if (quality.shadows > 0) {
    sun.castShadow = true; sun.shadow.mapSize.set(quality.shadowRes, quality.shadowRes);
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 700; sun.shadow.bias = -0.00025; sun.shadow.normalBias = 0.04; sun.shadow.radius = 1.6;
    csm = new CSMShadowNode(sun, { cascades: quality.shadows, maxFar: quality.shadowFar, mode: 'practical', lightMargin: 160 });
    csm.fade = true;
    sun.shadow.shadowNode = csm;
  }
  // ---- 大气雾：颜色取自天空贴图的地平线（朝太阳一侧更亮更暖），浓度随距离和高度变化 ----
  // 这样远处的东西会正好"融"进它背后那片天的颜色里，而不是整屏蒙一层灰
  const hz = (pred) => { const c = [0, 0, 0]; let n = 0; for (let y = 0; y < h; y++) { const la = ((rowTop ? 1 - (y + 0.5) / h : (y + 0.5) / h) - 0.5) * 180; if (la < 13 || la > 30) continue; /* 取树线以上的天空 */ for (let x = 0; x < w; x++) { let dl = ((x + 0.5) / w - 0.5) * 360 - lon * 180 / Math.PI; dl = ((dl + 540) % 360) - 180; if (!pred(Math.abs(dl))) continue; const o = (y * w + x) * 4; c[0] += env[o]; c[1] += env[o + 1]; c[2] += env[o + 2]; n++; } } return c.map(v => v / Math.max(1, n)); };
  const hazeSun = hz(d => d < 30), hazeBase = hz(d => d > 75);
  const lumB = 0.2126 * hazeBase[0] + 0.7152 * hazeBase[1] + 0.0722 * hazeBase[2];
  const F = { density: uniform(opts.fogDensity ?? 0.0005), falloff: uniform(0.028), sunBoost: uniform(1.3), sunPow: uniform(5), max: uniform(0.8), bgHaze: uniform(0.5), bgTop: uniform(0.13),
    colSun: uniform(new THREE.Color(hazeSun[0] * 0.59, hazeSun[1] * 0.56, hazeSun[2] * 0.51)),                                   // 朝太阳一侧：比天空本身暗一些、偏暖
    colBase: uniform(new THREE.Color(lumB * 0.6 + hazeBase[0] * 0.4, lumB * 0.6 + hazeBase[1] * 0.4, lumB * 0.6 + hazeBase[2] * 0.4)), sunDir: uniform(sunDir.clone()) };
  if ((quality.fog ?? 1) > 0) {
    const toP = positionWorld.sub(cameraPosition), dist = length(toP).max(1e-3), dir = toP.div(dist);
    const t = F.falloff.mul(dist).mul(dir.y);
    const integ = select(abs(t).lessThan(1e-3), float(1).sub(t.mul(0.5)), float(1).sub(exp(t.negate())).div(t));      // 指数高度雾沿视线的解析积分
    const s = pow(saturate(dot(dir, F.sunDir)), F.sunPow);
    const od = F.density.mul(quality.fog ?? 1).mul(exp(F.falloff.mul(cameraPosition.y).negate())).mul(dist).mul(integ).mul(float(1).add(s.mul(F.sunBoost)));
    scene.fogNode = fog(mix(F.colBase, F.colSun, s), min(float(1).sub(exp(od.negate())), F.max));
  }
  {
    const d = normalWorldGeometry, ca = Math.cos(alpha), sa = Math.sin(alpha);
    const dh = vec3(d.x.mul(ca).sub(d.z.mul(sa)), d.y, d.x.mul(sa).add(d.z.mul(ca)));            // 世界方向 → 天空贴图自己的方向（绕 Y 转 -alpha）
    const sky = bgTex.sample(equirectUV(dh)).rgb.mul(opts.bgIntensity ?? 1.0).min(mix(float(1e5), float(Lc), PROBE.on));     // 拍反射探针时把太阳圆盘压掉（太阳的高光由平行光负责）
    const s = pow(saturate(dot(d, F.sunDir)), F.sunPow);
    const wide = pow(saturate(dot(d, F.sunDir).mul(0.5).add(0.5)), 1.5);                                   // 背对太阳的方向几乎没有逆光雾气，远处的树林应保持深色
    const haze = (quality.fog ?? 1) > 0 ? F.bgHaze.mul(mix(float(0.22), float(1), wide)).mul(float(1).sub(smoothstep(0.0, F.bgTop, d.y))) : float(0);
    scene.backgroundNode = vec4(mix(sky, mix(F.colBase, F.colSun, s), haze), 1);
  }
  // ---- 给草、树叶这类纯漫反射材质用的天光 ----
  // 引擎里这类材质不吃环境贴图的漫反射，不补这一项的话，它们在阴影里是纯黑的
  const Eu = [0, 0, 0], Ed = [0, 0, 0];
  for (let y = 0; y < h; y++) {
    const la = ((rowTop ? 1 - (y + 0.5) / h : (y + 0.5) / h) - 0.5) * Math.PI, dO = (2 * Math.PI / w) * (Math.PI / h) * Math.cos(la), sl = Math.sin(la), tgt = sl > 0 ? Eu : Ed, wgt = Math.abs(sl) * dO;
    for (let x = 0; x < w; x++) { const o = (y * w + x) * 4; tgt[0] += env[o] * wgt; tgt[1] += env[o + 1] * wgt; tgt[2] += env[o + 2] * wgt; }
  }
  const eI = scene.environmentIntensity;
  const ambientIrr = mix(vec3(Ed[0] * eI, Ed[1] * eI, Ed[2] * eI), vec3(Eu[0] * eI, Eu[1] * eI, Eu[2] * eI), normalWorld.y.mul(0.5).add(0.5));     // 按法线朝上的程度，在"地面反光"和"天空光"之间插值
  const info = { skyE: Eu, groundE: Ed, maxLum: mx, meanLum: mean, clamp: Lc, removed: E, sunPixel: [cx, cy], elevDeg: Math.asin(sunDir.y) * 180 / Math.PI, alpha, hazeSun, hazeBase, sunI: sun.intensity, sunCol: sunCol.toArray() };
  return { sun, sunDir, csm, envTex, info, fog: F, ambientIrr };
}
