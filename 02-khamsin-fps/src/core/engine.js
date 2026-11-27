// 渲染引擎：渲染器、场景、太阳级联阴影、天空、环境光、后处理
import * as THREE from 'three';
import { SunLight } from 'three/addons/lights/SunLight.js';
import { Sky, ATMOS, installAtmosphereFog } from '../gfx/sky.js';
import { PostFX } from '../gfx/post.js';
import { buildTextures, buildMaterials, loadPhotoTextures, G } from '../gfx/materials.js';

export const QUALITY = {
  low: { maxW: 1280, msaa: 0, shadow: 1024, ao: false, god: false, hiTex: false, bloomLevels: 5, shadowFar: 70 },
  medium: { maxW: 1600, msaa: 2, shadow: 2048, ao: true, god: true, hiTex: false, bloomLevels: 6, shadowFar: 100 },
  high: { maxW: 2560, msaa: 4, shadow: 4096, ao: true, god: true, hiTex: true, bloomLevels: 6, shadowFar: 130 },
  ultra: { maxW: 3360, msaa: 4, shadow: 4096, ao: true, god: true, hiTex: true, bloomLevels: 7, shadowFar: 150 },
};

export class Engine {
  constructor(canvas, qualityName = 'high', opts = {}) {
    this.canvas = canvas;
    this.mobile = !!opts.mobile;   // 手机 / 平板：起始渲染分辨率低一档，动态分辨率可以降得更低，低画质下贴图减半
    this.qualityName = qualityName;
    this.q = QUALITY[qualityName] || QUALITY.high;
    installAtmosphereFog();
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false, stencil: false });
    r.setPixelRatio(1);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NoToneMapping;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.info.autoReset = false;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(new THREE.Color(ATMOS.fogColor[0], ATMOS.fogColor[1], ATMOS.fogColor[2]), ATMOS.fogDensity);
    this.camera = new THREE.PerspectiveCamera(74, 16 / 9, 0.03, 1400);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.sky = new Sky();
    this.scene.add(this.sky.mesh);

    const sun = this.sun = new SunLight(new THREE.Color(ATMOS.sunColor[0], ATMOS.sunColor[1], ATMOS.sunColor[2]), ATMOS.sunIntensity);
    sun.position.copy(ATMOS.sunDir);
    sun.castShadow = true;
    sun.shadow.mapSize.set(this.q.shadow, this.q.shadow);
    sun.shadow.camera.far = this.q.shadowFar;
    sun.shadow.bias = -0.00035;
    sun.shadow.normalBias = 0.035;
    sun.shadow.radius = 2.2;
    this.scene.add(sun);

    this.post = new PostFX(r, { msaa: this.q.msaa, ao: this.q.ao, god: this.q.god, vol: this.q.god, bloomLevels: this.q.bloomLevels });
    this.post.sun = sun;
    this.time = 0;
    this.T = null; this.M = null; this.env = null;
    this.renderScale = this.mobile ? 0.8 : 1; this.minScale = this.mobile ? 0.5 : 0.6;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  // 生成贴图 / 环境贴图 / 材质
  async initAssets(onProgress = null) {
    this.T = buildTextures(this.renderer, this.q.hiTex);
    this.photoCount = await loadPhotoTextures(this.T, this.renderer, 'assets/tex/', onProgress, this.mobile && this.qualityName === 'low' ? { color: 1024, data: 512 } : null);
    this.env = this.sky.buildEnvironments(this.renderer);
    this.scene.environment = this.env.full;
    this.scene.environmentIntensity = 1.0;
    this.M = buildMaterials(this.T, this.env);
  }

  resize() {
    const cw = this.canvas.clientWidth || window.innerWidth, ch = this.canvas.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = cw * dpr, h = ch * dpr;
    const maxW = this.q.maxW * this.renderScale;
    if (w > maxW) { const s = maxW / w; w *= s; h *= s; }
    w = Math.max(16, Math.round(w)); h = Math.max(16, Math.round(h));
    this.renderer.setSize(w, h, false);
    this.post.setSize(w, h);
    this.camera.aspect = cw / ch;
    this.camera.updateProjectionMatrix();
    this.width = w; this.height = h;
  }

  // 切换一套大气参数（两界切换）：太阳、天光染色、雾、天空亮度、调色。传 null 恢复默认
  //   sunColor [r,g,b]、sunK 太阳强度倍率、skyK [r,g,b] 天光 / 环境反射染色、fogColor、fogK 雾浓度倍率、skyGain 天空穹顶亮度倍率、tint 调色、bloomK、keyK 自动曝光的目标亮度倍率（< 1 整体更暗）
  setAtmos(p) {
    const fx = this.post.fx, su = this.sky.uniforms;
    const b = this._atmos0 || (this._atmos0 = { sunColor: ATMOS.sunColor.slice(), sunIntensity: ATMOS.sunIntensity, skyE: ATMOS.skyE.slice(), fogColor: ATMOS.fogColor.slice(), fogDensity: this.scene.fog.density,
      skyGain: su.uGain ? su.uGain.value : 1, tint: fx.uTint.value.clone(), bloom: fx.uBloom.value, key: fx.uKey.value });
    const q = Object.assign({ sunColor: b.sunColor, sunK: 1, skyK: [1, 1, 1], fogColor: b.fogColor, fogK: 1, skyGain: 1, tint: [1, 1, 1], bloomK: 1, keyK: 1 }, p || {});
    ATMOS.sunColor = q.sunColor.slice(); ATMOS.sunIntensity = b.sunIntensity * q.sunK; ATMOS.skyE = b.skyE.map((v, i) => v * q.skyK[i]);
    this.sun.color.setRGB(q.sunColor[0], q.sunColor[1], q.sunColor[2]); this.sun.intensity = ATMOS.sunIntensity;
    this.scene.fog.color.setRGB(q.fogColor[0], q.fogColor[1], q.fogColor[2]); this.scene.fog.density = b.fogDensity * q.fogK;
    if (su.uGain) su.uGain.value = b.skyGain * q.skyGain; if (su.uHaze) su.uHaze.value.set(q.fogColor[0], q.fogColor[1], q.fogColor[2]);
    G.uSkyTint.value.set(q.skyK[0], q.skyK[1], q.skyK[2]);
    fx.uTint.value.set(b.tint.x * q.tint[0], b.tint.y * q.tint[1], b.tint.z * q.tint[2]); fx.uBloom.value = b.bloom * q.bloomK; fx.uKey.value = b.key * q.keyK;
    this.envK = Math.max(q.skyK[0], q.skyK[1], q.skyK[2]);   // 第一人称武器按它缩放环境反射
    this.atmos = q;
  }

  render(dt) {
    this.time += dt;
    G.uTime.value = this.time;
    this.sky.update(this.camera, this.time);
    this.renderer.info.reset();
    this.post.render(this.scene, this.camera, dt, this.time);
  }
}
