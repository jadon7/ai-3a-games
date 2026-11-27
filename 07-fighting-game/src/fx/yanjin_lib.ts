import * as THREE from 'three';
import { arcGeometry, FX_FRAG_HEAD, type MeshFxHandle } from './core';
import type { FxCtx } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// 阎烬专用的火焰工具：写实火焰的几种网格（火舌片、火球 / 爆炸、火弧、螺旋火带、焦痕带、火柱、碎石）。
// 全部用“预乘透明”混合：颜色是自发光（叠加），alpha 是烟炱的遮挡——这样冷下来的火边会压暗背景，
// 不会像纯叠加那样一团橙色发糊。
// ─────────────────────────────────────────────────────────────────────────────

const R = () => Math.random();
/** 全局亮度：调整体的亮度用 */
export const GAIN = { sheet: 0.78, burst: 0.72 };
export const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** 共用的 GLSL：分层噪声和火焰色带（0 熄 → 深红 → 橙 → 黄 → 暖白） */
const FIRE_GLSL = /* glsl */ `
  float fbm3(vec2 p) {
    return texture2D(uNoise, p).r * 0.5 + texture2D(uNoise, p * 2.13 + 0.37).g * 0.32 + texture2D(uNoise, p * 4.37 + 0.71).a * 0.18;
  }
  vec3 fireRamp(float h) {
    h = clamp(h, 0.0, 1.6);
    vec3 c = vec3(0.30, 0.02, 0.004) * smoothstep(0.0, 0.18, h);
    c = mix(c, vec3(0.95, 0.16, 0.015), smoothstep(0.12, 0.42, h));
    c = mix(c, vec3(1.0, 0.45, 0.07), smoothstep(0.38, 0.68, h));
    c = mix(c, vec3(1.0, 0.72, 0.3), smoothstep(0.66, 1.0, h));
    c = mix(c, vec3(1.0, 0.95, 0.82), smoothstep(0.98, 1.45, h));
    return c;
  }
`;

/** 预乘透明：rgb 叠加发光，alpha 遮挡（烟炱） */
const PREMUL: Partial<THREE.ShaderMaterialParameters> = {
  blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
  blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
};

// 火舌片：轴向公告板（长轴固定，绕长轴转向镜头）。uv.x 横向、uv.y 根部 → 尖端
const SHEET_FRAG = FX_FRAG_HEAD + FIRE_GLSL + /* glsl */ `
  uniform vec4 uShape;   // x 尖端宽度比例, y 湍流, z 上卷速度, w 根部柔化长度
  uniform vec4 uShape2;  // x 根部宽度比例, y 沿长度的密度衰减, z 沿长度的降温, w 无
  uniform float uFade; uniform float uHeat;
  void main() {
    float x = vUv.x * 2.0 - 1.0, y = vUv.y;
    float t = uTime * uShape.z;
    vec2 w = vec2(fbm3(vec2(x * 0.22 + uSeed, y * 0.33 - t * 0.5)), fbm3(vec2(x * 0.2 + uSeed * 1.7 + 0.5, y * 0.3 - t * 0.42))) - 0.5;
    vec2 p = vec2(x, y) + w * uShape.y * vec2(1.1, 0.35) * (0.2 + y);
    float n = fbm3(vec2(p.x * 0.32 + uSeed * 2.3, p.y * 0.6 - t));
    float n2 = texture2D(uNoise, vec2(p.x * 0.9 - uSeed, p.y * 1.4 - t * 1.6)).a;
    float py = clamp(p.y, 0.0, 1.0);
    float wid = mix(uShape2.x, 1.0, smoothstep(0.0, 0.3, py)) * mix(1.0, uShape.x, pow(max(py, 0.0), 0.8));
    float prof = 1.0 - ((abs(p.x) / max(wid, 0.04)) * (abs(p.x) / max(wid, 0.04)));
    float d = prof * 0.85 + (n - 0.5) * 1.6 + (n2 - 0.5) * 0.55 - smoothstep(0.3, 1.0, y) * uShape2.y - uLife * 0.95 + 0.1;
    d -= smoothstep(0.72, 1.0, abs(x)) * 1.2 + smoothstep(0.86, 1.0, y) * 1.2;
    d *= smoothstep(0.0, uShape.w, y);
    float a = smoothstep(0.0, 0.16, d);
    if (a < 0.004) discard;
    float heat = d * 1.25 * uHeat * (1.0 - uShape2.z * y);
    vec3 col = fireRamp(heat);
    float soot = a * (1.0 - smoothstep(0.04, 0.4, heat)) * 0.65;
    gl_FragColor = vec4(col * a * uPower * uFade, soot * uFade);
  }`;

// 火球 / 爆炸：正对镜头的方片，用球面坐标滚动噪声，uCool 从 0（白热）到 1（冷成黑烟）
const BALL_FRAG = FX_FRAG_HEAD + FIRE_GLSL + /* glsl */ `
  uniform float uCool; uniform float uRoll; uniform float uFade; uniform float uBack; uniform float uCore;
  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p);
    if (r > 1.0) discard;
    float z = sqrt(max(0.0, 1.0 - r * r));
    vec2 sp = p / (z + 0.45);
    float t = uTime;
    float n = fbm3(sp * 0.28 + vec2(uSeed - t * uRoll * 0.55, uSeed * 0.7 - t * 0.12));
    float n2 = fbm3(sp * 0.6 + vec2(-t * uRoll * 0.9 + uSeed * 1.3, t * 0.25));
    float back = max(0.0, -p.x * sign(uRoll + 1e-4)) * uBack;
    float rr = r - (n - 0.5) * 0.62 - back * n2 * 0.5 + uCool * 0.12;
    float d = 1.0 - rr / 0.66;
    d -= smoothstep(0.82, 1.0, r) * 0.8;
    float core = smoothstep(0.5, 0.0, r) * uCore;
    float heat = (clamp(d, 0.0, 1.0) * 0.95 + core * 0.75 + (n2 - 0.5) * 0.5) * (1.0 - uCool * 0.9);
    float a = smoothstep(0.0, 0.18, d - uCool * 0.35 * (1.0 - n));
    if (a < 0.004) discard;
    vec3 col = fireRamp(heat) * (1.0 - uCool * 0.75);
    float soot = a * (1.0 - smoothstep(0.05, 0.45, heat)) * mix(0.4, 0.7, uCool);
    gl_FragColor = vec4(col * a * uPower * uFade, soot * uFade);
  }`;

// 火弧：arcGeometry（uv.x 沿弧 0 尾 → 1 头，uv.y 内 → 外）
const ARC_FRAG = FX_FRAG_HEAD + FIRE_GLSL + /* glsl */ `
  uniform float uFade; uniform float uReveal;
  void main() {
    float s = vUv.x, rad = vUv.y;
    float n = fbm3(vec2(s * 1.6 - uTime * 0.8 + uSeed, rad * 0.55 - uTime * 0.7));
    float n2 = texture2D(uNoise, vec2(s * 4.0 - uTime * 2.2, rad * 1.4 + uSeed)).a;
    float shown = smoothstep(uReveal + 0.02, uReveal - 0.12, s);
    float headK = smoothstep(uReveal - 0.3, uReveal, s) * shown;
    float prof = 1.0 - ((abs(rad - 0.6) / 0.48) * (abs(rad - 0.6) / 0.48));
    float tail = smoothstep(0.0, 0.45, s);
    float d = prof * 0.8 * tail + (n - 0.5) * 1.5 + (n2 - 0.5) * 0.5 - uLife * 0.9 - (1.0 - s) * uLife * 0.6 + 0.02;
    d -= smoothstep(0.85, 1.0, rad) * 0.9 + smoothstep(0.18, 0.0, rad) * 0.9;
    d *= shown;
    float a = smoothstep(0.0, 0.16, d);
    if (a < 0.004) discard;
    float heat = d * 1.15 + headK * 0.35 * (1.0 - uLife);
    vec3 col = fireRamp(heat);
    float soot = a * (1.0 - smoothstep(0.04, 0.38, heat)) * 0.5;
    gl_FragColor = vec4(col * a * uPower * uFade, soot * uFade);
  }`;

// 螺旋火带：uv.x 沿螺旋 0 → 1（下 → 上），uv.y 横向；uReveal 是拳头已经走到的位置
const HELIX_FRAG = FX_FRAG_HEAD + FIRE_GLSL + /* glsl */ `
  uniform float uReveal; uniform float uFade; uniform float uLen;
  void main() {
    float s = vUv.x, y = vUv.y * 2.0 - 1.0;
    float sm = s * uLen, t = uTime;
    vec2 w = vec2(fbm3(vec2(sm * 0.25 + uSeed, y * 0.2 - t * 0.6)), fbm3(vec2(sm * 0.22 - uSeed, y * 0.2 - t * 0.5) + 0.5)) - 0.5;
    vec2 p = vec2(sm, y) + w * vec2(0.6, 1.0);
    float n = fbm3(vec2(p.x * 0.35 + uSeed, p.y * 0.3 - t * 1.4));
    float n2 = texture2D(uNoise, vec2(p.x * 1.1 - t * 0.5, p.y * 0.6 - t * 2.0 + uSeed)).a;
    float prof = 1.0 - p.y * p.y;
    float shown = smoothstep(uReveal + 0.02, uReveal - 0.06, s);
    float headK = smoothstep(uReveal - 0.2, uReveal, s) * shown;
    float d = prof * 0.7 + (n - 0.5) * 2.0 + (n2 - 0.5) * 0.6 - uLife * 1.0 + 0.02 - smoothstep(0.6, 1.0, abs(y)) * 0.9;
    d *= shown * smoothstep(0.0, 0.06, s);
    float a = smoothstep(0.0, 0.15, d);
    if (a < 0.004) discard;
    float heat = d * 1.15 + headK * 0.35;
    vec3 col = fireRamp(heat);
    float soot = a * (1.0 - smoothstep(0.04, 0.38, heat)) * 0.45;
    gl_FragColor = vec4(col * a * uPower * uFade, soot * uFade);
  }`;

// 贴地焦痕带：uv.x 沿长度（米数由 uLen 给）、uv.y 横向。烧黑的地面 + 还没熄的余烬
const STRIP_FRAG = FX_FRAG_HEAD + FIRE_GLSL + /* glsl */ `
  uniform float uLen; uniform float uGlow; uniform float uAlpha;
  void main() {
    float xm = vUv.x * uLen, y = vUv.y * 2.0 - 1.0;
    float n = fbm3(vec2(xm * 0.22 + uSeed, y * 0.18 + uSeed));
    float n2 = fbm3(vec2(xm * 0.7 - uSeed, y * 0.5));
    float edge = 1.0 - smoothstep(0.25 + n * 0.45, 1.0, abs(y));
    float ends = smoothstep(0.0, 0.35, xm) * smoothstep(uLen, uLen - 0.35, xm);
    float dark = edge * ends * (0.55 + 0.45 * n2);
    float e = texture2D(uNoise, vec2(xm * 0.55 + uSeed * 3.0, y * 0.45 + uTime * 0.05)).b;
    float ember = smoothstep(0.3, 0.06, e) * edge * ends * uGlow * (0.6 + 0.6 * n2);
    float line = pow(max(0.0, 1.0 - abs(y + (n - 0.5) * 0.5)), 3.0) * ends * uGlow * uGlow * smoothstep(0.35, 0.6, n2) * 0.9;
    ember = max(ember, line);
    vec3 col = fireRamp(0.3 + ember * 0.75) * ember * 2.6;
    gl_FragColor = vec4(col * uAlpha, clamp(dark * 0.82, 0.0, 1.0) * uAlpha);
  }`;

// 地面裂痕：从中心放射、带分叉的裂缝，缝里透红光（uGlow 慢慢暗下去），裂缝两边压暗
const CRACK_FRAG = FX_FRAG_HEAD + FIRE_GLSL + /* glsl */ `
  uniform float uGlow; uniform float uAlpha; uniform float uRays;
  float rays(vec2 p, float r, float ang, float n, float w0, float rmin, float seed, out float dark) {
    float wob = (fbm3(vec2(r * 0.5 + seed, ang * 0.4 + seed)) - 0.5) * 1.2;
    float k = ang / 6.2832 * n + wob + seed;
    float id = floor(k);
    float d = abs(fract(k) - 0.5);
    float pd = d * 6.2832 * max(r, 0.02) / n;
    float len = 0.45 + 0.55 * texture2D(uNoise, vec2(id * 0.173 + seed, 0.31)).r;
    float m = smoothstep(len, len - 0.2, r) * smoothstep(rmin, rmin + 0.08, r);
    float w = w0 * (1.15 - r * 0.8);
    dark = smoothstep(w * 4.0, 0.0, pd) * m;
    return smoothstep(w, w * 0.2, pd) * m;
  }
  void main() {
    vec2 p = (vUv - 0.5) * 2.0;
    float r = length(p), ang = atan(p.y, p.x);
    float d1, d2;
    float l1 = rays(p, r, ang, uRays, 0.016, 0.06, uSeed, d1);
    float l2 = rays(p, r, ang, uRays * 2.3, 0.01, 0.3, uSeed + 3.7, d2) * 0.8;
    float line = max(l1, l2);
    float crater = smoothstep(0.16, 0.05, r + (fbm3(p * 0.8 + uSeed) - 0.5) * 0.1);
    float g = uGlow * (1.0 - r * 0.55);
    float hot = line * g + crater * g * 0.6;
    vec3 col = fireRamp(0.25 + hot * 0.9) * hot * 3.0;
    float a = clamp(max(d1, d2 * 0.7) * 0.7 + crater * 0.75, 0.0, 1.0);
    gl_FragColor = vec4(col * uAlpha, a * uAlpha);
  }`;

// 火柱的圆柱外壳：uv.x 绕一圈、uv.y 下 → 上。uHeight 米。外层旋转翻卷，uCoreK 越大越白亮
const COLUMN_FRAG = FX_FRAG_HEAD + FIRE_GLSL + /* glsl */ `
  uniform float uHeight; uniform float uFade; uniform float uCoreK; uniform float uSpin;
  void main() {
    float h = vUv.y * uHeight;
    float ang = vUv.x;
    float n = fbm3(vec2(ang * 1.5 + h * 0.05 + uTime * uSpin * 0.5 + uSeed, h * 0.16 - uTime * 1.4));
    float n2 = texture2D(uNoise, vec2(ang * 2.5 - uTime * uSpin * 0.8 + uSeed * 2.0, h * 0.3 - uTime * 2.6)).g;
    float face = abs(dot((dot(vNormalW, vNormalW) > 1e-12 ? normalize(vNormalW) : vec3(0.0, 1.0, 0.0)), vView));
    float base = smoothstep(0.0, 0.5, h);
    float topFade = 1.0 - smoothstep(uHeight * 0.55, uHeight, h + (n - 0.5) * 3.0);
    float d = (n - 0.5) * 1.9 + (n2 - 0.5) * 0.8 + 0.3 * face + uCoreK * 0.45 - uLife * 1.1 + 0.05;
    d *= base * topFade;
    float a = smoothstep(0.0, 0.2, d);
    if (a < 0.004) discard;
    float heat = d * 1.05 + uCoreK * 0.45 * face;
    vec3 col = fireRamp(heat);
    float soot = a * (1.0 - smoothstep(0.04, 0.4, heat)) * 0.5 * (1.0 - uCoreK);
    gl_FragColor = vec4(col * a * uPower * uFade, soot * uFade);
  }`;

const _ax = new THREE.Vector3(), _vw = new THREE.Vector3(), _sd = new THREE.Vector3(), _nm = new THREE.Vector3();
const _m4 = new THREE.Matrix4();

export interface SheetOpts {
  pos: THREE.Vector3; axis: THREE.Vector3; len: number; width: number; life: number;
  power?: number; heat?: number; taper?: number; turb?: number; speed?: number; soft?: number;
  /** 出生多快长到全长（寿命比例） */
  grow?: number;
  /** 淡入比例 */
  fadeIn?: number;
  /** 每帧可以改 pos / axis（跟着骨骼走），返回 false 就不动 */
  follow?: (k: number, pos: THREE.Vector3, axis: THREE.Vector3) => void;
  /** 寿命曲线偏移：k 先乘这个再进 uLife（小于 1 侵蚀得晚） */
  erode?: number;
  delay?: number;
  /** 根部宽度比例（拖尾用小于 1）、沿长度的密度衰减、沿长度降温 */
  root?: number; fall?: number; cool?: number;
}

export interface Rock { m: THREE.Mesh; vx: number; vy: number; vz: number; sx: number; sy: number; sz: number; s: number }

export class FireKit {
  private quadUp = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  private quad = new THREE.PlaneGeometry(1, 1);
  private stripGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0.5, 0, 0);
  private rockGeo: THREE.BufferGeometry;
  private rockHot: THREE.MeshStandardMaterial; private rockCold: THREE.MeshStandardMaterial;

  constructor(readonly ctx: FxCtx) {
    const g = new THREE.IcosahedronGeometry(1, 0);
    // 压扁一点，像碎石块
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (0.8 + 0.4 * ((i * 7) % 5) / 5), p.getY(i) * 0.7, p.getZ(i));
    g.computeVertexNormals();
    this.rockGeo = g;
    this.rockHot = new THREE.MeshStandardMaterial({ color: 0x2b2420, roughness: 0.92, metalness: 0, emissive: 0xff3a08, emissiveIntensity: 0.22, flatShading: true });
    this.rockCold = new THREE.MeshStandardMaterial({ color: 0x3a3632, roughness: 0.95, metalness: 0, flatShading: true });
    this.prewarm();
  }

  /** 预编译所有着色器，避免第一次放招时卡一下 */
  private prewarm() {
    try {
      const scene = new THREE.Scene();
      const mats = [
        this.mat(SHEET_FRAG, 1, { uShape: { value: new THREE.Vector4() }, uShape2: { value: new THREE.Vector4() }, uFade: { value: 0 }, uHeat: { value: 1 } }),
        this.mat(BALL_FRAG, 1, { uCool: { value: 0 }, uRoll: { value: 0 }, uFade: { value: 0 }, uBack: { value: 0 }, uCore: { value: 0 } }),
        this.mat(ARC_FRAG, 1, { uFade: { value: 0 }, uReveal: { value: 0 } }),
        this.mat(HELIX_FRAG, 1, { uReveal: { value: 0 }, uFade: { value: 0 }, uLen: { value: 1 } }),
        this.ctx.fx.material(STRIP_FRAG, 0xffffff, 0xffffff, 1, { uLen: { value: 1 }, uGlow: { value: 0 }, uAlpha: { value: 0 } }, { ...PREMUL }),
        this.mat(COLUMN_FRAG, 1, { uHeight: { value: 1 }, uFade: { value: 0 }, uCoreK: { value: 0 }, uSpin: { value: 0 } }),
        this.ctx.fx.material(CRACK_FRAG, 0xffffff, 0xffffff, 1, { uGlow: { value: 1 }, uAlpha: { value: 0 }, uRays: { value: 9 } }, { ...PREMUL }),
        this.rockHot, this.rockCold,
      ];
      for (const m of mats) scene.add(new THREE.Mesh(this.quad, m));
      const cm = mats[5].clone() as THREE.ShaderMaterial; cm.side = THREE.FrontSide; scene.add(new THREE.Mesh(this.quad, cm));
      this.ctx.gfx.renderer.compile(scene, this.ctx.gfx.camera, this.ctx.gfx.scene);
      for (const m of mats) if (m !== this.rockHot && m !== this.rockCold) m.dispose();
      cm.dispose();
    } catch { /* 预编译失败不影响 */ }
  }

  get cam() { return this.ctx.gfx.camera; }

  private mat(frag: string, power: number, extra: Record<string, THREE.IUniform>) {
    return this.ctx.fx.material(frag, 0xffffff, 0xffffff, power, extra, PREMUL);
  }

  /** 轴向公告板：长轴固定，面转向镜头 */
  orient(mesh: THREE.Object3D, base: THREE.Vector3, axis: THREE.Vector3, width: number, len: number) {
    _ax.copy(axis); const l = _ax.length(); if (l < 1e-5) _ax.set(0, 1, 0); else _ax.multiplyScalar(1 / l);
    _vw.subVectors(this.cam.position, base).normalize();
    _sd.crossVectors(_ax, _vw); if (_sd.lengthSq() < 1e-6) _sd.set(1, 0, 0); _sd.normalize();
    _nm.crossVectors(_sd, _ax);
    _m4.makeBasis(_sd.multiplyScalar(width), _ax.multiplyScalar(Math.max(1e-4, len)), _nm);
    _m4.setPosition(base);
    mesh.matrix.copy(_m4); mesh.matrixWorldNeedsUpdate = true;
  }

  /** 一条火舌（轴向公告板）。 */
  sheet(o: SheetOpts): MeshFxHandle {
    const mat = this.mat(SHEET_FRAG, (o.power ?? 1.8) * GAIN.sheet, {
      uShape: { value: new THREE.Vector4(o.taper ?? 0.18, o.turb ?? 0.8, o.speed ?? 1.4, o.soft ?? 0.12) },
      uShape2: { value: new THREE.Vector4(o.root ?? 1, o.fall ?? 0.75, o.cool ?? 0.55, 0) },
      uFade: { value: 0 }, uHeat: { value: o.heat ?? 1 },
    });
    const m = new THREE.Mesh(this.quadUp, mat);
    m.matrixAutoUpdate = false; m.renderOrder = 19; m.visible = false;
    const pos = o.pos.clone(), axis = o.axis.clone();
    const grow = o.grow ?? 0.12, fin = o.fadeIn ?? 0.06, er = o.erode ?? 1;
    const delay = o.delay ?? 0, life = o.life;
    const h = this.ctx.fx.addMesh(m, life + delay, (_k, _dt, hh) => {
      const t = hh.age - delay; if (t < 0) return;
      const k = Math.min(1, t / life);
      m.visible = true;
      o.follow?.(k, pos, axis);
      const g = 1 - Math.pow(1 - Math.min(1, k / grow), 3);
      this.orient(m, pos, axis, o.width * (0.55 + 0.45 * g), o.len * (0.25 + 0.75 * g));
      mat.uniforms.uLife.value = Math.pow(k, 1.3) * er; mat.uniforms.uTime.value = this.ctx.fx.time;
      mat.uniforms.uFade.value = Math.min(1, k / fin) * (1 - smoothstep(0.8, 1, k));
    });
    h.geos.length = 0;
    return h;
  }

  /** 正对镜头的火球（滚动的火焰外壳 + 亮核）。返回句柄，自己每帧设位置。 */
  ball(pos: THREE.Vector3, size: number, roll: number, power = 2.4): { h: MeshFxHandle; mat: THREE.ShaderMaterial; mesh: THREE.Mesh } {
    const mat = this.mat(BALL_FRAG, power, { uCool: { value: 0 }, uRoll: { value: roll }, uFade: { value: 1 }, uBack: { value: 1 }, uCore: { value: 1 } });
    const m = new THREE.Mesh(this.quad, mat); m.position.copy(pos); m.scale.setScalar(size); m.renderOrder = 21;
    const h = this.ctx.fx.addMesh(m, 999, () => { m.quaternion.copy(this.cam.quaternion); mat.uniforms.uTime.value = this.ctx.fx.time; });
    h.geos.length = 0;
    return { h, mat, mesh: m };
  }

  /** 爆炸火球：长大、冷却成黑烟。 */
  burst(pos: THREE.Vector3, s0: number, s1: number, life: number, power = 2.6, roll = 0, delay = 0) {
    const mat = this.mat(BALL_FRAG, power * GAIN.burst, { uCool: { value: 0 }, uRoll: { value: roll }, uFade: { value: 0 }, uBack: { value: roll ? 0.6 : 0 }, uCore: { value: 1 } });
    const m = new THREE.Mesh(this.quad, mat); m.position.copy(pos); m.renderOrder = 21; m.visible = false;
    const h = this.ctx.fx.addMesh(m, life + delay, (_k, _dt, hh) => {
      const t = hh.age - delay; if (t < 0) return;
      const k = Math.min(1, t / life);
      m.visible = true;
      m.quaternion.copy(this.cam.quaternion);
      const e = 1 - Math.pow(1 - k, 3);
      m.scale.setScalar(s0 + (s1 - s0) * e);
      m.position.y += 0.35 * (_dt);  // 热气上浮
      mat.uniforms.uTime.value = this.ctx.fx.time;
      mat.uniforms.uCool.value = smoothstep(0.03, 0.62, k);
      mat.uniforms.uCore.value = 1 - smoothstep(0.0, 0.2, k);
      mat.uniforms.uFade.value = Math.min(1, k / 0.04) * (1 - smoothstep(0.7, 1, k));
    });
    h.geos.length = 0;
    return h;
  }

  /** 火弧：center 圆心，在 XY 平面里从 a0 扫到 a1（弧度，朝右为准），facing 镜像。 */
  arc(center: THREE.Vector3, radius: number, a0: number, a1: number, facing: number, life = 0.4, power = 2.4, width = 0.5, tiltY = 0) {
    const geo = arcGeometry(radius * (1 - width), radius, a0, a1, 48);
    const mat = this.mat(ARC_FRAG, power * GAIN.sheet, { uFade: { value: 1 }, uReveal: { value: 0 } });
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(center); m.scale.x = facing; m.rotation.y = tiltY * facing; m.renderOrder = 22;
    return this.ctx.fx.addMesh(m, life, (k) => {
      mat.uniforms.uLife.value = smoothstep(0.15, 1, k); mat.uniforms.uTime.value = this.ctx.fx.time;
      mat.uniforms.uReveal.value = 1.15 * (1 - Math.pow(1 - Math.min(1, k / 0.3), 2));
      mat.uniforms.uFade.value = 1 - smoothstep(0.75, 1, k);
      const s = 1 + 0.1 * k; m.scale.set(facing * s, s, s);
    });
  }

  /** 螺旋上升的火带。返回句柄，reveal(0..1) 由调用方每帧给（跟着拳头）。 */
  helix(x: number, z: number, y0: number, height: number, radius: number, turns: number, width: number, life: number, facing: number, power = 2.4) {
    const segs = 90, pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let i = 0; i <= segs; i++) {
      const s = i / segs, a = s * turns * Math.PI * 2 * facing, r = radius * (1 - 0.35 * s);
      const cx = Math.cos(a) * r, cz = Math.sin(a) * r, y = s * height;
      const w = width * (0.6 + 0.4 * (1 - s));
      pos.push(cx, y - w / 2, cz, cx, y + w / 2, cz); uv.push(s, 0, s, 1);
      if (i < segs) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx);
    geo.computeVertexNormals();
    const L = Math.hypot(Math.PI * 2 * radius * 0.82 * turns, height);
    const mat = this.mat(HELIX_FRAG, power * GAIN.sheet, { uReveal: { value: 0 }, uFade: { value: 1 }, uLen: { value: L } });
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y0, z); m.renderOrder = 22;
    const st = { reveal: 0, lifeK: 0 };
    const h = this.ctx.fx.addMesh(m, life, (k) => {
      mat.uniforms.uReveal.value = st.reveal; mat.uniforms.uTime.value = this.ctx.fx.time;
      mat.uniforms.uLife.value = smoothstep(0.25, 1, k);
      mat.uniforms.uFade.value = 1 - smoothstep(0.8, 1, k);
      m.rotation.y += 0.0; // 静止的螺旋，火在上面卷
    });
    return { h, st };
  }

  /** 贴地焦痕带：从 x0 开始，len 由调用方每帧改（燃烧的线越拉越长）。 */
  strip(x0: number, z: number, width: number, dir: number, life: number, glowLife: number) {
    const mat = this.ctx.fx.material(STRIP_FRAG, 0xffffff, 0xffffff, 1, { uLen: { value: 0.01 }, uGlow: { value: 1 }, uAlpha: { value: 0 } },
      { ...PREMUL, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const m = new THREE.Mesh(this.stripGeo, mat); m.position.set(x0, 0.014, z); m.scale.set(0.01 * dir, 1, width); m.renderOrder = 6;
    const st = { len: 0.01 };
    const h = this.ctx.fx.addMesh(m, life, (_k, _dt, hh) => {
      const L = Math.max(0.01, st.len);
      m.scale.x = L * dir; mat.uniforms.uLen.value = L; mat.uniforms.uTime.value = this.ctx.fx.time;
      mat.uniforms.uGlow.value = Math.max(0, 1 - hh.age / glowLife);
      mat.uniforms.uAlpha.value = Math.min(1, hh.age / 0.05) * (1 - smoothstep(life * 0.6, life, hh.age));
    });
    h.geos.length = 0;
    return { h, st };
  }

  /** 地面裂痕贴花：缝里的红光在 glowLife 秒里暗下去，整体 life 秒后淡掉。 */
  crack(x: number, z: number, size: number, life: number, glowLife: number, rays = 9) {
    const mat = this.ctx.fx.material(CRACK_FRAG, 0xffffff, 0xffffff, 1, { uGlow: { value: 1 }, uAlpha: { value: 0 }, uRays: { value: rays } },
      { ...PREMUL, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const m = new THREE.Mesh(this.stripGeo, mat); m.position.set(x - size / 2, 0.016, z); m.scale.set(size, 1, size); m.rotation.y = 0; m.renderOrder = 7;
    const h = this.ctx.fx.addMesh(m, life, (_k, _dt, hh) => {
      mat.uniforms.uTime.value = this.ctx.fx.time;
      mat.uniforms.uGlow.value = Math.pow(Math.max(0, 1 - hh.age / glowLife), 1.5) * (0.85 + 0.15 * Math.sin(hh.age * 23));
      mat.uniforms.uAlpha.value = Math.min(1, hh.age / 0.04) * (1 - smoothstep(life * 0.65, life, hh.age));
    });
    h.geos.length = 0;
    return h;
  }

  /** 火柱的圆柱外壳（大招用）。 */
  column(x: number, z: number, radius: number, height: number, life: number, coreK: number, power: number, spin: number) {
    const geo = new THREE.CylinderGeometry(radius * 0.85, radius, height, 40, 24, true); geo.translate(0, height / 2, 0);
    const mat = this.mat(COLUMN_FRAG, power, { uHeight: { value: height }, uFade: { value: 0 }, uCoreK: { value: coreK }, uSpin: { value: spin } });
    if (coreK < 0.9) mat.side = THREE.FrontSide;
    const m = new THREE.Mesh(geo, mat); m.position.set(x, 0, z); m.renderOrder = coreK > 0.5 ? 20 : 19;
    return this.ctx.fx.addMesh(m, life, (k) => {
      mat.uniforms.uTime.value = this.ctx.fx.time;
      mat.uniforms.uLife.value = smoothstep(0.35, 1, k);
      mat.uniforms.uFade.value = Math.min(1, k / 0.03) * (1 - smoothstep(0.8, 1, k));
      const g = 1 - Math.pow(1 - Math.min(1, k / 0.08), 3);
      m.scale.set(0.5 + 0.5 * g + k * 0.25, 0.08 + 0.92 * g, 0.5 + 0.5 * g + k * 0.25);
      m.rotation.y += 0.016 * spin;
    });
  }

  /** 碎石：真的有体积、受光的小石块，带着余温，弹两下落地。 */
  debris(x: number, y: number, z: number, n: number, power: number, dir = 0, hot = 0.5, life = 1.5) {
    const g = new THREE.Group();
    const rocks: Rock[] = [];
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.rockGeo, R() < hot ? this.rockHot : this.rockCold);
      const s = rnd(0.04, 0.1) * (0.7 + 0.3 * power);
      m.scale.setScalar(s); m.position.set(x + rnd(-0.25, 0.25), y + 0.04, z + rnd(-0.25, 0.25));
      m.rotation.set(R() * 6, R() * 6, R() * 6);
      m.castShadow = false; m.receiveShadow = false;
      const a = rnd(-0.9, 0.9) + (dir ? (dir > 0 ? -0.5 : 0.5) : 0), sp = rnd(1.5, 4.5) * power;
      rocks.push({ m, vx: Math.sin(a) * sp * 0.8, vy: rnd(3, 7.5) * power, vz: rnd(-1.2, 1.2) * power, sx: rnd(-12, 12), sy: rnd(-12, 12), sz: rnd(-12, 12), s });
      g.add(m);
    }
    const h = this.ctx.fx.addMesh(g, life, (k, dt) => {
      for (const r of rocks) {
        r.vy -= 13 * dt;
        r.m.position.x += r.vx * dt; r.m.position.y += r.vy * dt; r.m.position.z += r.vz * dt;
        if (r.m.position.y < r.s * 0.6) { r.m.position.y = r.s * 0.6; if (r.vy < 0) r.vy = -r.vy * 0.3; r.vx *= 0.55; r.vz *= 0.55; r.sx *= 0.5; r.sy *= 0.5; r.sz *= 0.5; }
        r.m.rotation.x += r.sx * dt; r.m.rotation.y += r.sy * dt; r.m.rotation.z += r.sz * dt;
        if (k > 0.75) r.m.scale.setScalar(r.s * (1 - (k - 0.75) / 0.25));
      }
    });
    h.mats.length = 0; h.geos.length = 0;   // 共用的几何和材质不释放
    return h;
  }

  dispose() { /* 共用资源跟着页面走，不单独释放 */ }
}

export function smoothstep(a: number, b: number, x: number) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
