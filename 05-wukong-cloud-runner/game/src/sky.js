// 天空：影片里的物理天空（Blender 多次散射天空模型，不带日轮）烘成的 equirect HDR + 解析日轮和近日光晕。
//   const sky = await createSky(app);      // 内部调用 app.setSky(mesh, env)，同时提供 IBL
// 贴图由 tools/export_world.py 烘出，方位已对齐 common.js 的 SUN_DIR（导出时校验过，误差 0.2°）。
// 贴图是场景参考的线性值，和影片同一标定（SUN_INTENSITY=6 的太阳配这张天空，SKY_INTENSITY=1）。
import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { SUN_DIR, SUN_COLOR, CLOUD_TOP_Y } from './common.js';

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() { vDir = position; vec4 p = projectionMatrix * mat4(mat3(modelViewMatrix)) * vec4(position, 1.0); gl_Position = p.xyww; }`;

const SKY_FRAG = /* glsl */`
uniform sampler2D tSky;
uniform vec3 uSunDir, uSunColor, uCloudColor;
uniform float uSunDisc, uGlow, uIntensity;
varying vec3 vDir;
vec3 skyTex(vec3 d) {
  vec2 uv = vec2(atan(d.z, d.x) * 0.15915494 + 0.5, asin(clamp(d.y, -1.0, 1.0)) * 0.31830989 + 0.5);
  return texture2D(tSky, uv).rgb;
}
void main() {
  vec3 d = normalize(vDir);
  // 地平线以下：贴图里是暗的地面，这里换成被太阳照亮的云海 / 雾的颜色（最终画面里这部分会被云海盖住）
  vec3 dUp = normalize(vec3(d.x, max(d.y, 0.004), d.z));
  vec3 c = skyTex(dUp);
  float below = smoothstep(0.0, -0.10, d.y);
  float az = max(dot(normalize(d.xz), normalize(uSunDir.xz)), 0.0);
  c = mix(c, uCloudColor * (1.0 + 0.9 * az * az * az), below);
  // 日轮（视直径 0.53°，带一点临边昏暗）+ 近日光晕
  float mu = dot(d, uSunDir);
  float ang = acos(clamp(mu, -1.0, 1.0));
  float disc = smoothstep(0.00490, 0.00445, ang);
  float limb = 0.55 + 0.45 * sqrt(max(1.0 - (ang / 0.00475) * (ang / 0.00475), 0.0));
  c += uSunDisc * uSunColor * 160.0 * disc * limb;
  c += uGlow * uSunColor * (1.6 * exp(-ang / 0.018) + 0.35 * exp(-ang / 0.075)) * (1.0 - below);
  gl_FragColor = vec4(c * uIntensity, 1.0);
}`;

/**
 * @param {object} app   createApp() 的返回值
 * @param {object} [opts] { url, sunDisc=1, glow=1, intensity=1, setSky=true }
 * @returns {Promise<{mesh, material, uniforms, texture, envTexture, setSunDisc(v), setGlow(v)}>}
 */
export async function createSky(app, opts = {}) {
  const url = opts.url || (app.assets + 'sky/sky_2k.hdr');
  const tex = await new RGBELoader().setDataType(THREE.FloatType).loadAsync(url);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  tex.needsUpdate = true;

  // 云海顶面被低角度太阳 + 天光照亮后的漫反射亮度（线性）：0.85/π × (6·sin13°·太阳色 + 天空辐照度)
  const cloud = new THREE.Color(0.57, 0.51, 0.44);
  const uniforms = {
    tSky: { value: tex }, uSunDir: { value: SUN_DIR.clone() }, uSunColor: { value: new THREE.Color().copy(SUN_COLOR) },
    uCloudColor: { value: cloud }, uSunDisc: { value: opts.sunDisc ?? 1.0 }, uGlow: { value: opts.glow ?? 1.0 }, uIntensity: { value: opts.intensity ?? 1.0 },
  };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, depthTest: true });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), material);
  mesh.name = 'Sky'; mesh.frustumCulled = false; mesh.renderOrder = -1000;

  // IBL 用的环境图：上半球 = 天空贴图；下半球 = 云海的反光（石峰的暗面主要靠它托亮），降到 512×256
  const src = tex.image, W = 512, H = 256;
  const out = new Float32Array(W * H * 4);
  const sunAz = Math.atan2(SUN_DIR.z, SUN_DIR.x);
  for (let y = 0; y < H; y++) {            // 行 0 = 图像顶部（flipY 贴图的数据顺序）
    const v = 1 - (y + 0.5) / H, lat = (v - 0.5) * Math.PI;
    const sy = Math.min(src.height - 1, Math.floor((1 - Math.max(v, 0.502)) * src.height));
    for (let x = 0; x < W; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x + 0.5) / W * src.width));
      const si = (sy * src.width + sx) * 4, oi = (y * W + x) * 4;
      let r = src.data[si], g = src.data[si + 1], b = src.data[si + 2];
      if (lat < 0) {
        const az = Math.max(Math.cos(((x + 0.5) / W - 0.5) * 2 * Math.PI - sunAz), 0);
        const k = 1 + 0.9 * az * az * az, t = Math.min(1, -lat / 0.17);
        r += (cloud.r * k - r) * t; g += (cloud.g * k - g) * t; b += (cloud.b * k - b) * t;
      }
      out[oi] = r; out[oi + 1] = g; out[oi + 2] = b; out[oi + 3] = 1;
    }
  }
  const env = new THREE.DataTexture(out, W, H, THREE.RGBAFormat, THREE.FloatType);
  env.mapping = THREE.EquirectangularReflectionMapping; env.flipY = true;
  env.minFilter = THREE.LinearFilter; env.magFilter = THREE.LinearFilter; env.needsUpdate = true;

  if (opts.setSky !== false) app.setSky(mesh, env);
  return {
    mesh, material, uniforms, texture: tex, envTexture: env, cloudTopY: CLOUD_TOP_Y,
    setSunDisc(v) { uniforms.uSunDisc.value = v; },
    setGlow(v) { uniforms.uGlow.value = v; },
  };
}
