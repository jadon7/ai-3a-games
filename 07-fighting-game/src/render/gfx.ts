import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, SMAAEffect, SMAAPreset, VignetteEffect, NoiseEffect,
  ToneMappingEffect, ToneMappingMode, DepthOfFieldEffect, BlendFunction, Effect, EffectAttribute, ShaderPass,
} from 'postprocessing';
// @ts-expect-error n8ao 没有类型声明
import { N8AOPostPass } from 'n8ao';
import { DEBUG, QUALITY } from '../core/config';
import { damp } from '../core/math';

/** 屏幕扭曲：冲击波环（最多 4 个）、径向模糊、色散。都在一个后处理里做，省一次全屏采样。 */
class WarpEffect extends Effect {
  constructor() {
    super('WarpEffect', /* glsl */ `
      uniform vec4 rings[4];      // xy 屏幕坐标(0..1)，z 半径，w 强度
      uniform float ringW[4];
      uniform vec3 radial;        // xy 中心，z 强度
      uniform float chroma;       // 色散强度
      uniform float aspect;
      vec2 warpUv(vec2 uv) {
        for (int i = 0; i < 4; i++) {
          vec4 r = rings[i];
          if (r.w != 0.0) {
            vec2 d = uv - r.xy; d.x *= aspect;
            float dist = length(d) + 1e-5;
            float k = (dist - r.z) / ringW[i];
            float f = exp(-k * k) * r.w;
            uv -= (d / dist) * f * vec2(1.0 / aspect, 1.0);
          }
        }
        return uv;
      }
      void mainImage(const in vec4 inputColor, const in vec2 uv0, out vec4 outputColor) {
        vec2 uv = warpUv(uv0);
        vec3 c = texture2D(inputBuffer, uv).rgb;
        if (radial.z > 0.0005) {
          vec2 dir = (radial.xy - uv) * radial.z;
          vec3 acc = c;
          for (int i = 1; i < 10; i++) acc += texture2D(inputBuffer, uv + dir * (float(i) / 10.0)).rgb;
          c = acc / 10.0;
        }
        if (chroma > 0.0002) {
          vec2 d = (uv - 0.5);
          float l = dot(d, d) * 2.0 + 0.15;
          vec2 off = d * chroma * l;
          float r = texture2D(inputBuffer, uv + off).r;
          float b = texture2D(inputBuffer, uv - off).b;
          c = vec3(mix(c.r, r, 0.85), c.g, mix(c.b, b, 0.85));
        }
        outputColor = vec4(c, inputColor.a);
      }`, {
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map<string, THREE.Uniform>([
        ['rings', new THREE.Uniform([0, 1, 2, 3].map(() => new THREE.Vector4()))],
        ['ringW', new THREE.Uniform([0.05, 0.05, 0.05, 0.05])],
        ['radial', new THREE.Uniform(new THREE.Vector3(0.5, 0.5, 0))],
        ['chroma', new THREE.Uniform(0)],
        ['aspect', new THREE.Uniform(1.6)],
      ]),
    });
  }
}

/**
 * 清洗坏像素：场景里只要有一个像素是无效值（NaN、无穷大），或者亮到超出半浮点上限，
 * 泛光的逐级缩小、放大就会把它扩散成一整块黑色方块，在画面上闪来闪去。
 * 放在泛光和景深之前：无效值改成 0，过亮的压到上限。
 *
 * 注意不能写成 postprocessing 的 Effect：Effect 的输出还要和原画面按混合函数再混一次（mix(原, 新, 不透明度)），
 * 原画面是 NaN 的话，NaN × 0 还是 NaN，等于白洗。所以这里是一个独立的全屏通道，直接覆盖输出。
 */
function createSanitizePass() {
  const mat = new THREE.ShaderMaterial({
    name: 'Sanitize',
    uniforms: { inputBuffer: { value: null }, maxLum: { value: 120 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 1.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D inputBuffer; uniform float maxLum; varying vec2 vUv;
      // 按位判断：指数位全 1 就是 NaN 或无穷大。不用 isnan / x != x，那两种写法会被有的驱动的“快速数学”优化掉
      bool badf(float x) { return (floatBitsToUint(x) & 0x7F800000u) == 0x7F800000u; }
      void main() {
        vec3 c = texture2D(inputBuffer, vUv).rgb;
        if (badf(c.r) || badf(c.g) || badf(c.b)) c = vec3(0.0);
        // 常数写在前面：max(0, NaN) 在按“x < y ? y : x”实现的驱动上取到 0
        c = min(vec3(maxLum), max(vec3(0.0), c));
        gl_FragColor = vec4(c, 1.0);
      }`,
    depthTest: false, depthWrite: false, blending: THREE.NoBlending, toneMapped: false,
  });
  return new ShaderPass(mat, 'inputBuffer');
}

/** 调色：曝光、饱和度、对比度、色调、闪白。放在色调映射之前，在线性高动态范围里算。 */
class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', /* glsl */ `
      uniform float exposure; uniform float saturation; uniform float contrast;
      uniform vec3 tint; uniform vec3 flashColor; uniform float flash;
      uniform vec3 shadowTint; uniform vec3 highTint;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = inputColor.rgb * exposure;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, saturation);
        c = max((c - 0.18) * contrast + 0.18, 0.0);
        // 分离色调：暗部偏冷、亮部偏暖（电影调色里最常见的那种）
        float w = smoothstep(0.0, 0.6, l);
        c *= mix(shadowTint, highTint, w);
        c *= tint;
        c = mix(c, flashColor, flash);
        outputColor = vec4(c, inputColor.a);
      }`, {
      uniforms: new Map<string, THREE.Uniform>([
        ['exposure', new THREE.Uniform(1)],
        ['saturation', new THREE.Uniform(1)],
        ['contrast', new THREE.Uniform(1)],
        ['tint', new THREE.Uniform(new THREE.Color(1, 1, 1))],
        ['shadowTint', new THREE.Uniform(new THREE.Color(1, 1, 1))],
        ['highTint', new THREE.Uniform(new THREE.Color(1, 1, 1))],
        ['flashColor', new THREE.Uniform(new THREE.Color(1, 1, 1))],
        ['flash', new THREE.Uniform(0)],
      ]),
    });
  }
}

interface Ring { x: number; y: number; r: number; speed: number; width: number; strength: number; life: number; age: number }

export class Gfx {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(32, 16 / 9, 0.1, 400);
  readonly composer: EffectComposer;
  readonly bloom: BloomEffect;
  readonly dof: DepthOfFieldEffect;
  readonly dofPass: EffectPass;
  readonly sanitizePass: ShaderPass;
  readonly vignette: VignetteEffect;
  readonly warp = new WarpEffect();
  readonly grade = new GradeEffect();
  readonly ao: any;
  width = 1; height = 1;

  // 屏幕效果的瞬时量（每帧衰减）
  private flashK = 0; private flashDecay = 8;
  private chromaK = 0; private radialK = 0;
  private rings: Ring[] = [];
  /** 调色目标值，平滑趋近 */
  look = { exposure: 1, saturation: 1, contrast: 1.04, vignette: 0.42 };
  private cur = { exposure: 1, saturation: 1, contrast: 1.04, vignette: 0.42 };

  constructor(readonly canvas: HTMLCanvasElement) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: false, alpha: false });
    renderer.setPixelRatio(QUALITY.dpr);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.info.autoReset = false;
    this.renderer = renderer;

    const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    composer.addPass(new RenderPass(this.scene, this.camera));

    this.ao = new N8AOPostPass(this.scene, this.camera, 1, 1);
    this.ao.configuration.aoRadius = 0.55;
    this.ao.configuration.distanceFalloff = 0.9;
    this.ao.configuration.intensity = 2.6;
    this.ao.configuration.halfRes = true;
    this.ao.configuration.depthAwareUpsampling = true;
    this.ao.configuration.aoSamples = 12;
    this.ao.configuration.denoiseSamples = 6;
    this.ao.configuration.denoiseRadius = 10;
    this.ao.configuration.color = new THREE.Color(0, 0, 0);
    this.ao.enabled = QUALITY.ao;
    composer.addPass(this.ao);

    // 坏像素清洗（见 SanitizeEffect），地址栏加 nosanitize 可以关掉对比
    this.sanitizePass = createSanitizePass();
    this.sanitizePass.enabled = !DEBUG.has('nosanitize');
    composer.addPass(this.sanitizePass);

    this.dof = new DepthOfFieldEffect(this.camera, { focusDistance: 0.02, focalLength: 0.05, bokehScale: 3.0, resolutionScale: 0.5 });
    this.dofPass = new EffectPass(this.camera, this.dof);
    this.dofPass.enabled = false;
    composer.addPass(this.dofPass);

    this.bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 1.0, luminanceSmoothing: 0.25, intensity: 0.85, radius: 0.78, levels: 7 });
    composer.addPass(new EffectPass(this.camera, this.bloom));
    composer.addPass(new EffectPass(this.camera, this.warp));

    this.vignette = new VignetteEffect({ offset: 0.32, darkness: 0.42 });
    const noise = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });
    noise.blendMode.opacity.value = 0.11;
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    composer.addPass(new EffectPass(this.camera, this.grade, tone, this.vignette, noise));
    composer.addPass(new EffectPass(this.camera, new SMAAEffect({ preset: SMAAPreset.HIGH })));
    this.composer = composer;

    this.grade.uniforms.get('shadowTint')!.value.setRGB(0.94, 0.99, 1.08);
    this.grade.uniforms.get('highTint')!.value.setRGB(1.05, 1.0, 0.95);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    if (w === this.width && h === this.height) return;
    this.width = w; this.height = h;
    this.renderer.setPixelRatio(QUALITY.dpr);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.warp.uniforms.get('aspect')!.value = w / h;
  }

  /** 闪白（或带颜色的闪光）。k 0..1。 */
  flash(k: number, color = 0xffffff, decay = 9) {
    if (k >= this.flashK) { this.flashK = k; this.flashDecay = decay; (this.grade.uniforms.get('flashColor')!.value as THREE.Color).set(color); }
  }
  /** 色散脉冲，k 约 0.005 到 0.04。 */
  chroma(k: number) { this.chromaK = Math.max(this.chromaK, k); }
  /** 径向模糊脉冲，以世界坐标的某点为中心。k 约 0.05 到 0.3。 */
  radialBlur(k: number, world?: THREE.Vector3) {
    this.radialK = Math.max(this.radialK, k);
    if (world) { const s = this.toScreen(world); (this.warp.uniforms.get('radial')!.value as THREE.Vector3).set(s.x, s.y, this.radialK); }
  }
  /** 屏幕冲击波环：从世界坐标的某点向外扩散的折射环。 */
  shockRing(world: THREE.Vector3, strength = 0.03, speed = 1.4, life = 0.45, width = 0.06) {
    const s = this.toScreen(world);
    if (this.rings.length >= 4) this.rings.shift();
    this.rings.push({ x: s.x, y: s.y, r: 0.01, speed, width, strength, life, age: 0 });
  }

  private _v = new THREE.Vector3();
  toScreen(world: THREE.Vector3) {
    this._v.copy(world).project(this.camera);
    return { x: this._v.x * 0.5 + 0.5, y: this._v.y * 0.5 + 0.5 };
  }

  /** 大招特写时开景深。focusWorldDist 是镜头到焦点的距离（米）。 */
  setDof(on: boolean, focusWorldDist = 5, bokeh = 3) {
    this.dofPass.enabled = on;
    if (on) {
      const cam = this.camera;
      const cm = (this.dof as any).cocMaterial ?? (this.dof as any).circleOfConfusionMaterial;
      if (cm) {
        // postprocessing 6.3x：focusDistance 是 0..1 的线性深度；新版本有 worldFocusDistance
        if ('worldFocusDistance' in cm) { cm.worldFocusDistance = focusWorldDist; cm.worldFocusRange = 2.2; }
        else { cm.focusDistance = (focusWorldDist - cam.near) / (cam.far - cam.near); cm.focalLength = 0.012; }
      }
      this.dof.bokehScale = bokeh;
    }
  }

  render(dt: number) {
    // 瞬时量衰减
    this.flashK = Math.max(0, this.flashK - this.flashDecay * dt * Math.max(this.flashK, 0.25));
    this.chromaK = damp(this.chromaK, 0, 9, dt);
    this.radialK = damp(this.radialK, 0, 10, dt);
    this.grade.uniforms.get('flash')!.value = this.flashK;
    this.warp.uniforms.get('chroma')!.value = this.chromaK < 0.0003 ? 0 : this.chromaK;
    (this.warp.uniforms.get('radial')!.value as THREE.Vector3).z = this.radialK < 0.001 ? 0 : this.radialK;

    const ru = this.warp.uniforms.get('rings')!.value as THREE.Vector4[];
    const rw = this.warp.uniforms.get('ringW')!.value as number[];
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]; r.age += dt; r.r += r.speed * dt;
      if (r.age >= r.life) this.rings.splice(i, 1);
    }
    for (let i = 0; i < 4; i++) {
      const r = this.rings[i];
      if (r) { const k = 1 - r.age / r.life; ru[i].set(r.x, r.y, r.r, r.strength * k * k); rw[i] = r.width * (1 + r.age * 2); }
      else ru[i].set(0, 0, 0, 0);
    }

    const c = this.cur, l = this.look;
    c.exposure = damp(c.exposure, l.exposure, 6, dt);
    c.saturation = damp(c.saturation, l.saturation, 6, dt);
    c.contrast = damp(c.contrast, l.contrast, 6, dt);
    c.vignette = damp(c.vignette, l.vignette, 6, dt);
    this.grade.uniforms.get('exposure')!.value = c.exposure;
    this.grade.uniforms.get('saturation')!.value = c.saturation;
    this.grade.uniforms.get('contrast')!.value = c.contrast;
    this.vignette.darkness = c.vignette;

    this.renderer.info.reset();
    this.composer.render(dt);
  }
}
