// 屏幕级的演出（新刺客伊缇第四阶段 iti-fx3 新加；现在只有伊缇用，但写成通用的，别的英雄以后也能调）。
// 全部按“真实时间”走：顿帧的时候世界停了，这里的压暗、推镜头、打击帧照样在动——“停住的那一拍”才有东西看。
//
// 分三类，开销不一样：
//   一、画在场景里的（不多画一遍画面）
//     dim      压暗：地面、墙、树、水乘上一个颜色（可以带色：压成暗绯），人物和特效不压——“只留人亮着”。
//              做法：一张盖满屏幕的三角形排在不透明物体里、世界之后人物之前（renderOrder 1），用“乘”的混合；
//              人物（名字叫 hero / units 的组下面的网格）在压暗开始时挪到 renderOrder 2，所以不受影响。
//              水面是半透明的、排在后面画，另用一张贴着水面高度的大平面压它（深度测试开着：只压到看得见水面的像素）。
//     zoom     镜头推拉：主循环算镜头位置时把距离乘上 zoomK()
//   二、特效自己的泛光（多画一遍“只有特效”的小图，再模糊几次叠回去）
//     glow     登记一个组（伊缇特效的根）。有东西在放时，把这个组单独画进一张半分辨率的图，降采样、模糊三级，按绯红重新上色后叠回画面：
//              光晕之间会互相晕到一起（上一轮每个形状各画各的光晕，叠不到一块）。只晕特效，场景和别的英雄一点不变。手机档不开。
//   三、取一次画面再整屏画一遍的（只在用到的那零点几秒里开）
//     radial   径向模糊（往一个点冲）        chroma  色差（红蓝错位）          wave  冲击波把画面拱一圈（折射）
//     cut      屏幕被斩开：沿一条线两边的画面错开，线上一道白热的光              impact 打击帧：一两帧黑白绯三色的剪影（动画里最重那一刀的画法）
//     lines    集中线（往一个点聚的速度线）   cutin   大招切入：一条斜着的横幅划过屏幕，里面是角色的眼部特写
//     flash    全屏闪（只有它的时候不取画面，直接叠一张）
//
// 主循环（world/main.ts）里只有三处：每帧 update(真实 dt)；镜头距离乘 zoomK()；画完场景以后 post(camera)。都不调的话什么都不发生。
import * as THREE from "three";

export type V3 = { x: number; y: number; z: number };
export interface ScreenFx {
  /** 压暗到 1-k（k=0.7 就是只剩三成亮），tint 是压成什么颜色（默认偏冷的暗紫；大招用绯黑）。
   *  分两层，画的时候取深的那一层：hold ≥ 10 是“一直压着”的那一层（大招整段），要调 dim(0, 多少秒) 才收；别的是“很短的一下”，自己到时间就退。
   *  这样大招压着的时候，中间插进来的一下（比如被动引爆）不会把它冲掉 */
  dim: (k: number, fadeIn?: number, hold?: number, fadeOut?: number, tint?: number) => void;
  /** 全屏闪一下：k 多亮（0～1），dur 秒 */
  flash: (k: number, dur?: number, color?: number) => void;
  /** 镜头推拉：距离乘 k（0.85 是推近），tIn 秒到位、停 hold 秒、tOut 秒回去 */
  zoom: (k: number, tIn?: number, hold?: number, tOut?: number) => void;
  zoomK: () => number;
  /** 现在世界被压暗了多少（0～1）。特效按它调自己的光晕：暗的时候光晕大，亮地面上收小（亮地面上的红色柔光就是一团粉） */
  dimK: () => number;
  /** 世界里的一个点现在在不在画面里（pad：画面外再宽出多少，按画面半宽半高的比例）。屏幕级的演出只给“玩家屏幕里看得见的那一次”用它判断；主循环还没画过第一帧时回 true */
  inView: (p: V3, pad?: number) => boolean;
  /** 镜头的“右边”在地面上是哪个方向（单位向量）。要在屏幕上摆成固定样子的东西（大招的 X 要是 X 不是 +）按它转；还没画过第一帧时回 (1, 0) */
  camRight: () => { x: number; z: number };
  /** 径向模糊：k 0～0.25（往中心拉多少），at 是世界里的中心点（不给就是屏幕正中） */
  radial: (k: number, dur?: number, at?: V3) => void;
  /** 色差：k 0～1 */
  chroma: (k: number, dur?: number) => void;
  /** 冲击波折射：地面上以 at 为圆心、半径从 r0 推到 r1（米），amp 拱多少（0.01～0.04） */
  wave: (at: V3, r0: number, r1: number, dur?: number, amp?: number) => void;
  /** 屏幕被斩开：过地面上的 at 点、朝 yaw 方向的一条线；shift 两边错开多少（屏幕高的比例，0.01～0.03），dur 秒收回。glow 线上的光多亮 */
  cut: (at: V3, yaw: number, dur?: number, shift?: number, glow?: number) => void;
  /** 打击帧：dur 秒（一般 0.05～0.1），mode 1 黑底白人，2 白底黑人；绯红的地方两种都留成绯红 */
  impact: (dur?: number, mode?: 1 | 2) => void;
  /** 集中线：k 多浓，at 聚到哪 */
  lines: (k: number, dur?: number, at?: V3) => void;
  /** 大招切入：tex 是横幅图（宽图），dur 秒。y 横幅中心在屏幕上多高（0 底 1 顶），h 横幅半高（屏幕高的比例），v 取图上从上往下哪一条（0～1），slope 斜多少 */
  cutin: (tex: THREE.Texture, dur?: number, o?: { y?: number; h?: number; v?: number; slope?: number; scale?: number; from?: number }) => void;
  /** 登记一个要泛光的组；live 返回 false 的帧不画。k 泛光多强 */
  glow: (group: THREE.Object3D, live: () => boolean, k?: number | (() => number)) => void;
  /** 这些东西压暗时不跟着暗（放到人物那一档）。场景里名字叫 hero、units 的组每次压暗开始时自动处理，别的要亮着的东西用这个登记 */
  keep: (obj: THREE.Object3D) => void;
  update: (realDt: number) => void;
  post: (camera: THREE.Camera) => void;
  /** 接下来画的不是主画面（左上角的头像那一遍）：压暗那张先藏起来；false 恢复 */
  offscreen: (on: boolean) => void;
  /** 全部收掉（切场景、重放） */
  reset: () => void;
  /** 这一帧多画了几遍、哪些在开着（量性能用） */
  stats: () => { passes: number; on: string };
}

interface Track { v: number; from: number; to: number; t: number; tin: number; hold: number; tout: number; on: boolean; rest: number }
const track = (rest = 0): Track => ({ v: rest, from: rest, to: rest, t: 0, tin: 0, hold: 0, tout: 0, on: false, rest });
const fire = (T: Track, to: number, tin: number, hold: number, tout: number) => { T.from = T.v; T.to = to; T.t = 0; T.tin = tin; T.hold = hold; T.tout = tout; T.on = true; };
const sm = (x: number) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
function tick(T: Track, dt: number) {
  if (!T.on) { T.v = T.rest; return; }
  T.t += dt; const t = T.t;
  T.v = t < T.tin ? T.from + (T.to - T.from) * sm(t / Math.max(T.tin, 1e-4)) : t < T.tin + T.hold ? T.to : T.to + (T.rest - T.to) * sm((t - T.tin - T.hold) / Math.max(T.tout, 1e-4));
  if (t >= T.tin + T.hold + T.tout) { T.on = false; T.v = T.rest; }
}

const VS = /* glsl */ `varying vec2 vUv; void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export function createScreenFx(o: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; lite?: boolean; waterY?: number }): ScreenFx {
  const { renderer, scene } = o, lite = !!o.lite;
  const tri = new THREE.BufferGeometry(); tri.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(tri); quad.frustumCulled = false;
  let passes = 0;
  const draw = (mat: THREE.Material, target: THREE.WebGLRenderTarget | null) => { quad.material = mat; renderer.setRenderTarget(target); renderer.render(quad, fsCam); passes++; };

  // ---------------------------------------------------------------- 压暗（画在场景里）
  const dimT = track(), dimP = track(), dimTint = new THREE.Color(0.36, 0.32, 0.46);      // dimT 一直压着的那一层，dimP 很短的一下
  const dimMat = new THREE.ShaderMaterial({
    uniforms: { uK: { value: 0 }, uTint: { value: dimTint } },
    vertexShader: `varying vec2 vP; void main() { vP = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    // 四角再暗一点（暗角把视线往中间收）
    fragmentShader: `uniform float uK; uniform vec3 uTint; varying vec2 vP;
      void main() { float vig = smoothstep(0.35, 1.45, length(vP * vec2(1.0, 0.9))); pc_fragColor = vec4(mix(vec3(1.0), uTint * (1.0 - 0.5 * vig), uK), 1.0); }`,      // 故意写 pc_fragColor 不写 gl_FragColor：迷雾（fow.ts）会给场景里每个材质的着色器末尾加一段“看不见的地方压暗”，它只认写 gl_FragColor 的；这张是“乘”上去的系数，被它再加工一遍颜色就错了
    depthTest: false, depthWrite: false, transparent: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor, toneMapped: false,
  });
  const dimMesh = new THREE.Mesh(tri, dimMat); dimMesh.frustumCulled = false; dimMesh.renderOrder = 1; dimMesh.visible = false; dimMesh.name = "screenfx-dim"; scene.add(dimMesh);
  (dimMat.userData as any).fowKeep = true;
  // 水面：半透明，画在压暗那张之后，所以另压一次——一张贴着水面的大平面，深度测试开着，只有看得见水面的像素会被它盖到
  let waterDim: THREE.Mesh | null = null;
  if (o.waterY !== undefined) {
    const wm = new THREE.ShaderMaterial({ uniforms: dimMat.uniforms, vertexShader: `void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform float uK; uniform vec3 uTint; void main() { pc_fragColor = vec4(mix(vec3(1.0), uTint, uK), 1.0); }`,      // 同上：写 pc_fragColor，迷雾不包
      depthTest: true, depthWrite: false, transparent: true, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor, toneMapped: false });
    (wm.userData as any).fowKeep = true;
    waterDim = new THREE.Mesh(new THREE.PlaneGeometry(600, 600).rotateX(-Math.PI / 2), wm); waterDim.position.y = o.waterY + 0.03; waterDim.renderOrder = 5.01; waterDim.frustumCulled = false; waterDim.visible = false; waterDim.name = "screenfx-dim-water"; scene.add(waterDim);
  }
  const lift = (obj: THREE.Object3D) => obj.traverse(n => { const m = n as THREE.Mesh; if (!m.isMesh || m.renderOrder !== 0) return;      // 只动还没人管过顺序的（脚下的圈、血条自己有顺序，不碰）
    const mt = m.material as THREE.Material | THREE.Material[]; if (Array.isArray(mt) ? mt.some(x => x.transparent) : mt.transparent) return;      // 半透明的本来就排在压暗那张后面画，不用动（动了反而会改它和别的半透明东西的先后）
    m.renderOrder = 2; });
  const kept: THREE.Object3D[] = [];
  const liftAll = () => { for (const c of scene.children) if (c.name === "hero" || c.name === "units") lift(c); for (const k of kept) lift(k); };

  // ---------------------------------------------------------------- 镜头推拉
  const zoomT = track(1);

  // ---------------------------------------------------------------- 泛光：只有特效的小图
  const glows: { g: THREE.Object3D; live: () => boolean; k: number | (() => number) }[] = [];
  const rtOpt = { depthBuffer: false, stencilBuffer: false, type: THREE.UnsignedByteType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false } as const;
  let rtFx: THREE.WebGLRenderTarget | null = null; const pyr: { a: THREE.WebGLRenderTarget; b: THREE.WebGLRenderTarget }[] = [];
  let grab: THREE.FramebufferTexture | null = null, bw = 0, bh = 0;
  const size = new THREE.Vector2();
  function fit() {
    renderer.getDrawingBufferSize(size); const w = Math.max(2, Math.round(size.x)), h = Math.max(2, Math.round(size.y)); if (w === bw && h === bh) return; bw = w; bh = h;
    rtFx?.dispose(); for (const p of pyr) { p.a.dispose(); p.b.dispose(); } pyr.length = 0; grab?.dispose(); grab = null;
    // 特效那一遍按整分辨率画：这些材质在对局里被迷雾（fow.ts）包过一层“看不见就不画”，它按屏幕分辨率和 gl_FragCoord 反推这个像素在世界里的位置；
    // 画进半分辨率的小图的话 gl_FragCoord 对不上，位置全错（第一步在试验页里是半分辨率，没有迷雾看不出来）。画完马上降到四分之一再模糊，后面的开销不变
    if (!lite) { rtFx = new THREE.WebGLRenderTarget(w, h, rtOpt); for (const d of [4, 8, 16]) pyr.push({ a: new THREE.WebGLRenderTarget(Math.max(2, Math.round(w / d)), Math.max(2, Math.round(h / d)), rtOpt), b: new THREE.WebGLRenderTarget(Math.max(2, Math.round(w / d)), Math.max(2, Math.round(h / d)), rtOpt) }); }
  }
  const raw = (fs: string, uniforms: Record<string, THREE.IUniform>, extra: THREE.ShaderMaterialParameters = {}) => new THREE.ShaderMaterial({ uniforms, vertexShader: VS, fragmentShader: fs, depthTest: false, depthWrite: false, toneMapped: false, ...extra });
  // 降采样：四个点取平均；第一级顺手做“只留亮的”（柔的门槛），暗的身子不晕
  const downMat = raw(/* glsl */ `uniform sampler2D tSrc; uniform vec2 uPx; uniform float uKnee, uOff; varying vec2 vUv;
    void main() { vec3 c = (texture2D(tSrc, vUv + uPx * vec2(-uOff, -uOff)).rgb + texture2D(tSrc, vUv + uPx * vec2(uOff, -uOff)).rgb + texture2D(tSrc, vUv + uPx * vec2(-uOff, uOff)).rgb + texture2D(tSrc, vUv + uPx * vec2(uOff, uOff)).rgb) * 0.25;
      float I = max(c.r, max(c.g, c.b)); c *= mix(1.0, smoothstep(0.3, 0.92, I), uKnee); gl_FragColor = vec4(c, 1.0); }`, { tSrc: { value: null }, uPx: { value: new THREE.Vector2() }, uKnee: { value: 0 }, uOff: { value: 0.5 } });
  const blurMat = raw(/* glsl */ `uniform sampler2D tSrc; uniform vec2 uDir; varying vec2 vUv;
    void main() { vec3 c = texture2D(tSrc, vUv).rgb * 0.2270270;
      c += (texture2D(tSrc, vUv + uDir * 1.3846154).rgb + texture2D(tSrc, vUv - uDir * 1.3846154).rgb) * 0.3162162;
      c += (texture2D(tSrc, vUv + uDir * 3.2307692).rgb + texture2D(tSrc, vUv - uDir * 3.2307692).rgb) * 0.0702703;
      gl_FragColor = vec4(c, 1.0); }`, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } });
  // 叠回画面：三级加起来，按亮度重新上色（暗处深绯、亮处亮绯、最亮才发白——白芯晕出来的也是红光，不是一团白粉）。
  // 预乘透明：留一部分“盖住”，亮草地上红光是把地面染红，不是加成土黄 / 粉
  const compMat = raw(/* glsl */ `uniform sampler2D t1, t2, t3; uniform float uK; varying vec2 vUv;
    void main() { vec3 b = texture2D(t1, vUv).rgb * 0.7 + texture2D(t2, vUv).rgb * 0.6 + texture2D(t3, vUv).rgb * 0.5;
      float I = max(b.r, max(b.g, b.b)) * uK;
      vec3 tint = mix(vec3(0.70, 0.01, 0.11), vec3(0.98, 0.09, 0.22), smoothstep(0.2, 1.1, I)); tint = mix(tint, vec3(1.0, 0.42, 0.44), smoothstep(1.6, 3.2, I));
      float g = 1.0 - exp(-I * 0.85);
      gl_FragColor = vec4(tint * g * 0.85, g * 0.36); }`, { t1: { value: null }, t2: { value: null }, t3: { value: null }, uK: { value: 1 } },
    { transparent: true, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor });

  // ---------------------------------------------------------------- 取一次画面再画一遍的那一类
  const radT = track(), chrT = track(), impT = track(), linT = track(), flashT = track(), cutinT = track();
  const radAt = new THREE.Vector3(), linAt = new THREE.Vector3(); let radHas = false, linHas = false, impMode = 1, linSeed = 0;
  const flashC = new THREE.Color(1, 0.86, 0.9);
  const waves = [0, 1].map(() => ({ on: false, at: new THREE.Vector3(), r0: 0, r1: 1, t: 0, dur: 0.4, amp: 0.02 }));
  const cuts = [0, 1].map(() => ({ on: false, at: new THREE.Vector3(), yaw: 0, t: 0, dur: 0.25, shift: 0.015, glow: 1 }));
  let cutinTex: THREE.Texture | null = null, cutinDur = 0.5; const cutinO = { y: 0.62, h: 0.15, v: 0.42, slope: -0.08, scale: 1.12, from: 1 };
  const U = {
    tScene: { value: null as THREE.Texture | null }, tCutin: { value: null as THREE.Texture | null }, uAspect: { value: 1 }, uTime: { value: 0 },
    uRadial: { value: new THREE.Vector4(0.5, 0.5, 0, 0) }, uChroma: { value: 0 },
    uWaveA: { value: [new THREE.Vector4(), new THREE.Vector4()] }, uWaveB: { value: [new THREE.Vector4(), new THREE.Vector4()] },
    uCutA: { value: [new THREE.Vector4(), new THREE.Vector4()] }, uCutB: { value: [new THREE.Vector4(), new THREE.Vector4()] },
    uImpact: { value: new THREE.Vector4() }, uFlash: { value: new THREE.Vector4() }, uLines: { value: new THREE.Vector4(0.5, 0.5, 0, 0) },
    uCutin: { value: new THREE.Vector4() }, uCutin2: { value: new THREE.Vector4() }, uCutin3: { value: new THREE.Vector4(2.357, 0, 0, 0) },
  };
  const finalMat = raw(/* glsl */ `
    #define TAPS ${lite ? 6 : 12}
    uniform sampler2D tScene, tCutin; uniform float uAspect, uTime, uChroma;
    uniform vec4 uRadial, uWaveA[2], uWaveB[2], uCutA[2], uCutB[2], uImpact, uFlash, uLines, uCutin, uCutin2, uCutin3; varying vec2 vUv;
    float hash(float n) { return fract(sin(n * 127.1) * 43758.5453); }
    void main() {
      vec2 uv = vUv, asp = vec2(uAspect, 1.0); vec4 seam = vec4(0.0);
      // 屏幕被斩开：线两边的画面顺着线错开；线上一道白热的光，从一头刷到另一头
      for (int i = 0; i < 2; i++) { vec4 A = uCutA[i], B = uCutB[i]; if (B.w < 0.5) continue;
        vec2 p = (vUv - A.xy) * asp, d = A.zw, n = vec2(-d.y, d.x); float s = dot(p, n), al = dot(p, d);
        uv += d / asp * B.x * (s > 0.0 ? 1.0 : -1.0) * (1.0 - smoothstep(0.0, 0.5, abs(s)));
        float rev = 1.0 - smoothstep(B.z * 3.2 - 1.6 - 0.05, B.z * 3.2 - 1.6, al);
        float core = exp(-pow(s / 0.0016, 2.0)), mid = exp(-pow(s / 0.006, 2.0)), halo = exp(-pow(s / 0.03, 2.0));
        float sa = clamp(core * 1.2 + mid * 0.75 + halo * 0.35, 0.0, 1.0) * min(B.y, 1.0) * rev;      // 盖上去，不是加上去：红光加在绿草上是橙黄
        vec3 sc = mix(mix(vec3(0.80, 0.02, 0.16), vec3(1.0, 0.16, 0.32), mid), vec3(1.0, 0.97, 0.95), min(core * B.y, 1.0));
        seam = vec4(mix(seam.rgb, sc, sa), max(seam.a, sa)); }
      // 冲击波：圆环经过的地方把画面往圆心拱一下（地面上的圆在屏幕上是个椭圆）
      for (int i = 0; i < 2; i++) { vec4 A = uWaveA[i], B = uWaveB[i]; if (B.x == 0.0) continue;
        vec2 q = (uv - A.xy) / A.zw; float rho = length(q), f = (rho - 1.0) / B.y;
        uv -= normalize(q + 1e-5) * A.zw * B.x * exp(-f * f) * (f > 0.0 ? 0.45 : 1.0); }
      // 径向模糊 + 色差：朝中心一路采样，红蓝各偏一头
      vec2 c = uRadial.xy, dv = uv - c; float rs = uRadial.z, ca = uChroma * 0.022; vec3 col;
      if (rs > 0.0005 || ca > 0.00005) { vec3 acc = vec3(0.0), ws = vec3(0.0);
        for (int i = 0; i < TAPS; i++) { float f = float(i) / float(TAPS - 1);
          vec3 w = ca > 0.00005 ? vec3(1.0 - smoothstep(0.2, 0.9, f), 1.0 - abs(f - 0.5) * 1.6, smoothstep(0.1, 0.8, f)) + 0.08 : vec3(1.0);
          acc += texture2D(tScene, c + dv * (1.0 - rs * f + (f - 0.5) * ca)).rgb * w; ws += w; }
        col = acc / ws; }
      else col = texture2D(tScene, uv).rgb;
      // 打击帧：按亮度切成墨和纸两色，饱和的红留成绯红
      if (uImpact.y > 0.001) { float l = dot(col, vec3(0.299, 0.587, 0.114)), red = clamp((col.r - max(col.g, col.b)) * 2.6 - 0.25, 0.0, 1.0) * (1.0 - smoothstep(0.72, 0.92, l));
        float w = smoothstep(0.40, 0.47, l);
        vec3 ink = vec3(0.035, 0.0, 0.015), paper = vec3(1.0, 0.965, 0.95), p = uImpact.x < 1.5 ? mix(ink, paper, w) : mix(paper, ink, w);
        p = mix(p, vec3(0.93, 0.05, 0.20), red);
        col = mix(col, p, uImpact.y); }
      // 集中线
      if (uLines.z > 0.001) { vec2 p = (vUv - uLines.xy) * asp; float a = atan(p.y, p.x) + 3.14159, r = length(p), N = 72.0;
        float id = floor(a / 6.28318 * N), fr = fract(a / 6.28318 * N), h = hash(id + uLines.w), h2 = hash(id * 1.73 + uLines.w + 5.0);
        float wd = 0.06 + 0.3 * h2 * h2, ln = (1.0 - smoothstep(wd * 0.4, wd, abs(fr - 0.5) * 2.0)) * step(0.5, h);
        float st = 0.26 + 0.34 * hash(id * 2.31 + uLines.w), m = smoothstep(st, st + 0.35, r);
        col = mix(col, h > 0.82 ? vec3(0.93, 0.05, 0.2) : vec3(1.0, 0.96, 0.95), ln * m * uLines.z); }
      col = mix(col, seam.rgb, seam.a);
      // 大招切入：斜着的一条横幅，里面是角色的眼部特写，带横着飞的速度线；上下各一道白热的边
      if (uCutin.x > 0.001) { float yc = uCutin.z + uCutin2.x * (vUv.x - 0.5), hh = uCutin.w * uCutin.x, d = vUv.y - yc, ad = abs(d);
        float inside = 1.0 - smoothstep(hh - 0.0015, hh + 0.0005, ad);
        float hImg = uCutin2.z * uAspect / uCutin3.x;      // 图在屏幕上多高（屏幕高的比例）
        vec2 iuv = vec2((vUv.x - 0.5) / uCutin2.z + 0.5 + uCutin.y, 1.0 - (uCutin2.y - d / hImg));
        vec3 img = texture2D(tCutin, clamp(iuv, 0.0, 1.0)).rgb * step(0.0, iuv.x) * step(iuv.x, 1.0);
        float row = floor(vUv.y * 260.0), sp = 3.0 + 9.0 * hash(row), sl = step(0.86, hash(row + 7.0)) * smoothstep(0.82, 1.0, fract(vUv.x * (0.6 + hash(row * 3.1)) - uTime * sp + hash(row * 1.3)));
        img += vec3(1.0, 0.9, 0.92) * sl * 0.55;
        img *= 0.82 + 0.18 * smoothstep(hh, hh * 0.5, ad);
        float edge = exp(-pow((ad - hh) / 0.0022, 2.0)), eh = exp(-pow(max(ad - hh, 0.0) / 0.03, 2.0)) * (1.0 - inside);
        col = mix(col * (1.0 - 0.35 * uCutin2.w * (1.0 - inside)), img, inside * uCutin2.w);
        col += (vec3(1.0, 0.96, 0.95) * edge + vec3(0.9, 0.04, 0.2) * eh * 0.7) * uCutin2.w; }
      col += uFlash.rgb * uFlash.w * (1.0 - 0.4 * smoothstep(0.2, 0.9, length((vUv - 0.5) * asp)));
      gl_FragColor = vec4(col, 1.0);
    }`, U);
  const flashMat = raw(`uniform vec4 uFlash; uniform float uAspect; varying vec2 vUv; void main() { gl_FragColor = vec4(uFlash.rgb * uFlash.w * (1.0 - 0.4 * smoothstep(0.2, 0.9, length((vUv - 0.5) * vec2(uAspect, 1.0)))), 1.0); }`, { uFlash: U.uFlash, uAspect: U.uAspect }, { transparent: true, blending: THREE.AdditiveBlending });

  const v = new THREE.Vector3(), v2 = new THREE.Vector3(), right = new THREE.Vector3(), fwd = new THREE.Vector3();
  const toUv = (p: THREE.Vector3, cam: THREE.Camera, out: THREE.Vector2) => { v.copy(p).project(cam); return out.set(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5); };
  const a2 = new THREE.Vector2(), b2 = new THREE.Vector2(), c2 = new THREE.Vector2();
  let realT = 0, on = "", lastCam: THREE.Camera | null = null;

  const api: ScreenFx = {
    dim(k, fadeIn = 0.1, hold = 0.5, fadeOut = 0.3, tint) { if (tint !== undefined) dimTint.set(tint).convertLinearToSRGB(); else if (k > 0) dimTint.setRGB(0.36, 0.32, 0.46);      /* 颜色按屏幕上看到的值算（十六进制色就是乘上去的颜色）；k=0 是收掉：颜色不动，免得淡出时变色 */ if (k > 0) liftAll(); fire(hold >= 10 || k <= 0 ? dimT : dimP, k, fadeIn, hold, fadeOut); },
    flash(k, dur = 0.12, color = 0xffdbe6) { flashC.set(color).convertLinearToSRGB(); fire(flashT, k, 0.0, 0.0, dur); flashT.v = k; },
    zoom(k, tIn = 0.1, hold = 0.2, tOut = 0.3) { fire(zoomT, k, tIn, hold, tOut); },
    zoomK: () => zoomT.v,
    dimK: () => Math.min(1, Math.max(dimT.v, dimP.v) / 0.6),
    camRight() { if (!lastCam) return { x: 1, z: 0 }; right.setFromMatrixColumn(lastCam.matrixWorld, 0); const l = Math.hypot(right.x, right.z) || 1; return { x: right.x / l, z: right.z / l }; },
    inView(p, pad = 0.05) { if (!lastCam) return true; v.set(p.x, p.y, p.z).project(lastCam); return v.z > -1 && v.z < 1 && Math.abs(v.x) <= 1 + pad && Math.abs(v.y) <= 1 + pad; },
    radial(k, dur = 0.25, at) { radHas = !!at; if (at) radAt.set(at.x, at.y, at.z); fire(radT, k, 0.0, 0.0, dur); radT.v = k; },
    chroma(k, dur = 0.2) { if (k >= chrT.v) { fire(chrT, k, 0.0, 0.0, dur); chrT.v = k; } },
    wave(at, r0, r1, dur = 0.4, amp = 0.02) { const w = waves.find(x => !x.on) ?? waves[0]; w.on = true; w.at.set(at.x, at.y, at.z); w.r0 = r0; w.r1 = r1; w.t = 0; w.dur = dur; w.amp = amp; },
    cut(at, yaw, dur = 0.25, shift = 0.015, glow = 1) { const c = cuts.find(x => !x.on) ?? cuts[0]; c.on = true; c.at.set(at.x, at.y, at.z); c.yaw = yaw; c.t = 0; c.dur = dur; c.shift = shift; c.glow = glow; },
    impact(dur = 0.07, mode = 1) { impMode = mode; fire(impT, 1, 0, dur, 0.0001); impT.v = 1; },      // 不淡出：打击帧是“切”进来、“切”出去的，淡一下就成了一张糊的中间帧
    lines(k, dur = 0.2, at) { linHas = !!at; if (at) linAt.set(at.x, at.y, at.z); linSeed = Math.random() * 50; fire(linT, k, 0.02, dur * 0.4, dur * 0.6); },
    cutin(tex, dur = 0.5, oo = {}) { cutinTex = tex; cutinDur = dur; Object.assign(cutinO, { y: 0.62, h: 0.15, v: 0.42, slope: -0.08, scale: 1.12, from: 1 }, oo); fire(cutinT, 1, dur, 0, 0.001); cutinT.v = 0; cutinT.from = 0; },
    glow(g, live, k = 1) { glows.push({ g, live, k }); },
    keep(obj) { kept.push(obj); lift(obj); },
    update(dt) {
      realT += dt; tick(dimT, dt); tick(dimP, dt); tick(zoomT, dt); tick(radT, dt); tick(chrT, dt); tick(impT, dt); tick(linT, dt); tick(flashT, dt);
      if (cutinT.on) { cutinT.t += dt; if (cutinT.t >= cutinDur) { cutinT.on = false; cutinT.t = 0; } }
      for (const w of waves) if (w.on) { w.t += dt; if (w.t >= w.dur) w.on = false; }
      for (const c of cuts) if (c.on) { c.t += dt; if (c.t >= c.dur) c.on = false; }
      const dv = Math.max(dimT.v, dimP.v); dimMat.uniforms.uK.value = dv; dimMesh.visible = dv > 0.003; if (waterDim) waterDim.visible = dimMesh.visible;
    },
    post(camera) {
      lastCam = camera; passes = 0; on = dimMesh.visible ? "dim " : "";
      const live = lite ? [] : glows.filter(g => g.live());
      if (!live.length && !(radT.v > 0.0005 || chrT.v > 0.002 || impT.v > 0.001 || linT.v > 0.001 || cutinT.on || flashT.v > 0.002 || waves.some(w => w.on) || cuts.some(c => c.on))) return;      // 没有在放的：什么都不做（那几张小图也是第一次用到才建）
      const pc = camera as THREE.PerspectiveCamera; fit(); U.uAspect.value = bw / bh; U.uTime.value = realT;
      const prevAuto = renderer.autoClear, prevTarget = renderer.getRenderTarget(), prevInfo = renderer.info.autoReset;
      renderer.info.autoReset = false;      // 这里多画的几遍接着场景那一遍往上数（不然每画一遍就清零，主程序最后读到的“绘制次数”只剩最后一张全屏片的 1 次）
      // ---- 泛光
      if (live.length && rtFx) {
        on += "bloom ";
        const cc = renderer.getClearColor(new THREE.Color()), ca = renderer.getClearAlpha(), su = renderer.shadowMap.autoUpdate;
        renderer.shadowMap.autoUpdate = false; renderer.setClearColor(0x000000, 0); renderer.autoClear = true;
        renderer.setRenderTarget(rtFx); renderer.clear();
        renderer.autoClear = false; for (const g of live) { renderer.render(g.g, camera); passes++; } renderer.autoClear = true;
        let src: THREE.Texture = rtFx.texture, sw = rtFx.width, sh = rtFx.height;
        for (let i = 0; i < pyr.length; i++) { const p = pyr[i];
          downMat.uniforms.tSrc.value = src; downMat.uniforms.uPx.value.set(1 / sw, 1 / sh); downMat.uniforms.uKnee.value = i === 0 ? 1 : 0; downMat.uniforms.uOff.value = i === 0 ? 1 : 0.5;      /* 第一级是一下降四倍：四个采样点各往外挪一个像素（每个点是 2×2 的平均，合起来正好 4×4） */ draw(downMat, p.a);
          blurMat.uniforms.tSrc.value = p.a.texture; blurMat.uniforms.uDir.value.set(1 / p.a.width, 0); draw(blurMat, p.b);
          blurMat.uniforms.tSrc.value = p.b.texture; blurMat.uniforms.uDir.value.set(0, 1 / p.a.height); draw(blurMat, p.a);
          src = p.a.texture; sw = p.a.width; sh = p.a.height; }
        renderer.setClearColor(cc, ca); renderer.shadowMap.autoUpdate = su;
        renderer.autoClear = false;
        compMat.uniforms.t1.value = pyr[0].a.texture; compMat.uniforms.t2.value = pyr[1].a.texture; compMat.uniforms.t3.value = pyr[2].a.texture; compMat.uniforms.uK.value = Math.max(...live.map(g => (typeof g.k === "function" ? g.k() : g.k)));
        draw(compMat, null);
      }
      // ---- 取画面再画一遍的那一类
      const anyWave = waves.some(w => w.on), anyCut = cuts.some(c => c.on), needGrab = radT.v > 0.0005 || chrT.v > 0.002 || impT.v > 0.001 || linT.v > 0.001 || cutinT.on || anyWave || anyCut;
      U.uFlash.value.set(flashC.r, flashC.g, flashC.b, flashT.v);
      if (needGrab) {
        if (radT.v > 0.0005) on += "radial "; if (chrT.v > 0.002) on += "chroma "; if (impT.v > 0.001) on += "impact "; if (linT.v > 0.001) on += "lines "; if (cutinT.on) on += "cutin "; if (anyWave) on += "wave "; if (anyCut) on += "cut "; if (flashT.v > 0.002) on += "flash ";
        if (!grab) { grab = new THREE.FramebufferTexture(bw, bh); grab.minFilter = grab.magFilter = THREE.LinearFilter; grab.generateMipmaps = false; }
        renderer.setRenderTarget(null); renderer.copyFramebufferToTexture(grab); U.tScene.value = grab; passes++;
        if (radHas) { toUv(radAt, pc, a2); U.uRadial.value.set(a2.x, a2.y, radT.v, 0); } else U.uRadial.value.set(0.5, 0.5, radT.v, 0);
        U.uChroma.value = chrT.v;
        if (linHas) { toUv(linAt, pc, a2); U.uLines.value.set(a2.x, a2.y, linT.v, linSeed); } else U.uLines.value.set(0.5, 0.5, linT.v, linSeed);
        U.uImpact.value.set(impMode, impT.v, 0, 0);
        right.setFromMatrixColumn(pc.matrixWorld, 0); right.y = 0; right.normalize(); fwd.set(-right.z, 0, right.x);
        waves.forEach((w, i) => { const A = U.uWaveA.value[i], B = U.uWaveB.value[i]; if (!w.on) { B.set(0, 1, 0, 0); return; }
          const k = w.t / w.dur, e = 1 - Math.pow(1 - k, 2.2), r = w.r0 + (w.r1 - w.r0) * e;
          toUv(w.at, pc, a2); toUv(v2.copy(w.at).addScaledVector(right, r), pc, b2); toUv(v2.copy(w.at).addScaledVector(fwd, r), pc, c2);
          A.set(a2.x, a2.y, Math.max(1e-4, b2.distanceTo(a2)), Math.max(1e-4, c2.distanceTo(a2))); B.set(w.amp * Math.pow(1 - k, 1.3), Math.max(0.05, 0.9 / Math.max(r, 0.5)), 0, 0); });
        cuts.forEach((c, i) => { const A = U.uCutA.value[i], B = U.uCutB.value[i]; if (!c.on) { B.set(0, 0, 0, 0); return; }
          const k = c.t / c.dur; toUv(c.at, pc, a2); toUv(v2.copy(c.at).add(v.set(Math.sin(c.yaw), 0, Math.cos(c.yaw))), pc, b2);
          const dx = (b2.x - a2.x) * U.uAspect.value, dy = b2.y - a2.y, L = Math.hypot(dx, dy) || 1;
          A.set(a2.x, a2.y, dx / L, dy / L); B.set(c.shift * Math.pow(1 - k, 2) * (k < 0.08 ? k / 0.08 : 1), c.glow * (1 - sm((k - 0.35) / 0.65)), Math.min(1, k / 0.12), 1); });
        if (cutinT.on && cutinTex) { const k = cutinT.t / cutinDur, open = k < 0.1 ? 1 - Math.pow(1 - k / 0.1, 3) : k > 0.86 ? Math.pow(1 - (k - 0.86) / 0.14, 2) : 1, slide = cutinO.from * (0.16 * Math.pow(1 - Math.min(1, k / 0.22), 3) - 0.035 * k);
          U.tCutin.value = cutinTex; U.uCutin.value.set(open, slide, cutinO.y, cutinO.h); U.uCutin2.value.set(cutinO.slope, cutinO.v, cutinO.scale, k > 0.86 ? open : 1);
          const im = cutinTex.image as { width?: number; height?: number } | undefined; U.uCutin3.value.x = im && im.width && im.height ? im.width / im.height : 2.357; }
        else U.uCutin.value.set(0, 0, 0, 0);
        renderer.autoClear = false; draw(finalMat, null);
      } else if (flashT.v > 0.002) { on += "flash "; renderer.autoClear = false; draw(flashMat, null); }
      renderer.setRenderTarget(prevTarget); renderer.autoClear = prevAuto; renderer.info.autoReset = prevInfo;
    },
    offscreen(hide) { const vis = !hide && Math.max(dimT.v, dimP.v) > 0.003; dimMesh.visible = vis; if (waterDim) waterDim.visible = vis; },
    reset() { for (const T of [dimT, dimP, zoomT, radT, chrT, impT, linT, flashT, cutinT]) { T.on = false; T.v = T.rest; T.t = 0; } for (const w of waves) w.on = false; for (const c of cuts) c.on = false; dimMesh.visible = false; if (waterDim) waterDim.visible = false; },
    stats: () => ({ passes, on: on.trim() }),
  };
  return api;
}
