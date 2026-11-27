// 战争迷雾（阶段 4，第九轮重做）：照 Dota 2 的做法——看不见的地方地形还在、看得清，只是没被照亮：暗下去、饱和度降低、偏冷；
// 我方单位周围一圈是正常亮度，边缘是几米宽的柔和过渡。对方的单位在暗处不显示（那是规则那边算的，这里不管）。
//
// 做法：
//   · 一张 192×192 的小图盖住整张地图，每秒十次把我方单位的视野画成一个个圆（新旧叠着，边慢慢亮、慢慢暗）。
//     着色器里同时拿着“上一次”和“这一次”两张图，按时间在两张之间插值，视野跟着人走时边缘是平滑地挪过去的，不会一跳一跳。
//   · 不再在画面最后盖一层黑（盖一层只能压暗、做不了去饱和；而且落点按固定高度算，塔和树的上半截会偏出去）。
//     改成做进场景材质里：每个地面、墙、树、草、建筑的材质在算完颜色（色调映射之后）加一小段——
//     用这个像素的深度反推出它在世界里的位置，查小图，看不见就压暗、去饱和、往冷色偏。立起来的东西按它自己的位置算，和地面一起暗。
//     代价是每个像素一次矩阵乘法加一次贴图采样，手机上也付得起。
//   · 材质是“包一层”的（和 kit/materials.ts 的镂空同一个做法）：原来的着色器标识取出来加后缀，不同材质不会错用同一份着色器。
//     后来才建出来的材质（地面的细图是边走边载的）每帧扫一遍场景补上，扫的只是还没包过的。
//   · 血条、单位、英雄不包：单位在迷雾里本来就不显示。
//   · 特效（fx、fxlib 两个组下面的东西）另包一种（第九轮 polish-lib，照 Dota 2 / LoL）：玩家这一队看不见的地方，特效不画。
//     不是压暗，而是按同一张视野图把那个像素的不透明度乘掉——和地面压暗用的是同一张图、同一个反推位置的办法，所以特效正好在地面变暗的地方消失；
//     持续的特效（铁链、火场、磷潮、跟着人的火圈）每个像素每帧都在查，人走进视野、视野挪开都跟着变，不用技能自己管。
//     十个英雄的特效都挂在 fxlib 的组下面（fx.group.add），所以一个文件都不用改。判断只按位置：视野半径 15 米比最远的技能（13 米）大，
//     自己这一队的特效几乎不会落在自己看不见的地方。施法指示、点地面的标记、飘字是玩家自己的，材质上标了 userData.fowKeep，不藏。
//     分出胜负以后（结束演出要在水晶上炸，那里可能已经没有自己的单位了）、观战、?nofog=1 都不藏。
// 观战（director=1）和 ?nofog=1 不开，但小图照样画（小地图要用）。
// 视野现在只按距离算，墙不挡视野。

import * as THREE from "three";
import type { Sim } from "./sim";
import { FOG } from "./fxlib";

export interface Fow {
  /** 以前是盖在画面上的那一层；现在是个空的占位（主程序还会把它加进场景、设 visible），留着接口不变 */
  mesh: THREE.Object3D;
  canvas: HTMLCanvasElement;
  /** 每帧调：画视野、把镜头的矩阵交给材质。on=false 时这一帧不压暗（正俯视截图、观战） */
  update: (dt: number, camera: THREE.Camera, renderer?: THREE.WebGLRenderer, on?: boolean) => void;
  /** 把场景里还没包过的材质包上（每帧调一次，只处理新出现的） */
  patch: (scene: THREE.Scene) => void;
  /** 下一次画面要不要压暗（画头像那一遍要关掉：那一遍的镜头不是主镜头） */
  enable: (on: boolean) => void;
  /** 第九轮 polish-lib：玩家这一队（0 队）看不看得见 (x,z)。和视野图一个算法（只按距离、视野图的软边算到 1.1 倍半径），所以稍微宽一点：只有明摆着在迷雾里的才算看不见 */
  sees: (x: number, z: number) => boolean;
}

/** 包不包：这几个组下面的东西不压暗（fx、fxlib 两个组换成“看不见就不画”的那一种，见 wrap） */
const SKIP = new Set(["units", "hero", "fxlib", "fx", "fow"]);

export function createFow(sim: Sim, half = 96, active = true): Fow {
  const N = 192, mk = () => { const c = document.createElement("canvas"); c.width = c.height = N; return c; };
  const cur = mk(), disp = mk(), prev = mk(), cc = cur.getContext("2d")!, dc = disp.getContext("2d")!, pc = prev.getContext("2d")!, k = N / (2 * half);
  const texOf = (cv: HTMLCanvasElement) => { const t = new THREE.CanvasTexture(cv); t.minFilter = t.magFilter = THREE.LinearFilter; t.generateMipmaps = false; return t; };
  const tex = texOf(disp), texP = texOf(prev);
  // 所有包过的材质共用这一份
  const U = { uFowA: { value: texP }, uFowB: { value: tex }, uFowK: { value: 1 }, uFowInv: { value: new THREE.Matrix4() }, uFowRes: { value: new THREE.Vector2(1, 1) }, uFowP: { value: new THREE.Vector4(half, active ? 1 : 0, 0, 0) } };
  // 迷雾里的样子：亮度剩多少、饱和度剩多少、往哪个颜色偏（对着 Dota 2 夜里和迷雾边上的截图调的）
  const CODE = /* glsl */ `
    if (uFowP.y > 0.5) {
      vec4 fw_ = uFowInv * vec4(gl_FragCoord.xy / uFowRes * 2.0 - 1.0, gl_FragCoord.z * 2.0 - 1.0, 1.0); fw_.xyz /= fw_.w;
      vec2 fu_ = vec2(fw_.x / (2.0 * uFowP.x) + 0.5, 0.5 - fw_.z / (2.0 * uFowP.x));      /* 画布贴图是上下翻过的：画布第一行（z 最小）在 v=1 */
      float fv_ = (fu_.x < 0.0 || fu_.x > 1.0 || fu_.y < 0.0 || fu_.y > 1.0) ? 0.0 : mix(texture2D(uFowA, fu_).a, texture2D(uFowB, fu_).a, uFowK);
      float fd_ = 1.0 - smoothstep(0.08, 0.75, fv_);
      vec3 fc_ = gl_FragColor.rgb; float fl_ = dot(fc_, vec3(0.2126, 0.7152, 0.0722));
      vec3 fg_ = mix(vec3(fl_), fc_, 0.5) * vec3(0.76, 0.9, 1.16) * 0.48 + vec3(0.003, 0.008, 0.02);
      gl_FragColor.rgb = mix(fc_, fg_, fd_);
    }`;
  // 特效那一种（第九轮 polish-lib）：同样反推这个像素在世界里的位置、查同一张视野图，看不见就把不透明度乘掉（不压暗）。
  // 门槛按“单位还看得见的地方特效也看得见”定：规则那边单位在视野半径以内就显示，视野图在半径处大约还剩 0.23，所以 0.08～0.22 之间过渡。
  // 叠加发光的材质（混合 SrcAlpha、One）和普通半透明一样乘不透明度就淡；预乘、自定义混合的连颜色一起乘
  const HIDE = (rgb: boolean) => /* glsl */ `
    if (uFowP.z > 0.5 && uFowKeep < 0.5) {
      vec4 fw_ = uFowInv * vec4(gl_FragCoord.xy / uFowRes * 2.0 - 1.0, gl_FragCoord.z * 2.0 - 1.0, 1.0); fw_.xyz /= fw_.w;
      vec2 fu_ = vec2(fw_.x / (2.0 * uFowP.x) + 0.5, 0.5 - fw_.z / (2.0 * uFowP.x));
      float fv_ = (fu_.x < 0.0 || fu_.x > 1.0 || fu_.y < 0.0 || fu_.y > 1.0) ? 0.0 : mix(texture2D(uFowA, fu_).a, texture2D(uFowB, fu_).a, uFowK);
      float fs_ = smoothstep(0.08, 0.22, fv_); if (fs_ < 0.004) discard;
      gl_FragColor.a *= fs_; ${rgb ? "gl_FragColor.rgb *= fs_;" : ""}
    }`;
  const DECL = "uniform sampler2D uFowA, uFowB; uniform float uFowK; uniform mat4 uFowInv; uniform vec2 uFowRes; uniform vec4 uFowP;\n";
  const done = new WeakSet<THREE.Material>();
  const wrap = (m: THREE.Material, fx = false) => {
    if (done.has(m)) return; done.add(m);
    if ((m as THREE.ShaderMaterial).isShaderMaterial && !/gl_FragColor/.test((m as THREE.ShaderMaterial).fragmentShader)) return;      // 只写 pc_fragColor 的原始着色器不认识
    const prevFn = m.onBeforeCompile, key = m.customProgramCacheKey(), rgb = fx && (m.premultipliedAlpha || m.blending === THREE.CustomBlending);
    const keep = { get value() { return m.userData.fowKeep ? 1 : 0; } };      // 每帧现读：池子里的贴花后来被拿去当施法指示时才标上 fowKeep
    const code = fx ? HIDE(rgb) : CODE;
    m.onBeforeCompile = (sh, r) => { prevFn.call(m, sh, r); Object.assign(sh.uniforms, U); if (fx) sh.uniforms.uFowKeep = keep;
      let f = sh.fragmentShader;
      if (f.includes("#include <tonemapping_fragment>")) f = f.replace("#include <tonemapping_fragment>", "#include <tonemapping_fragment>\n" + code);      // 色调映射之后、转成 sRGB 之前
      else { const i = f.lastIndexOf("}"); f = f.slice(0, i) + code + "\n" + f.slice(i); }
      sh.fragmentShader = DECL + (fx ? "uniform float uFowKeep;\n" : "") + f; };
    m.customProgramCacheKey = () => key + (fx ? "-fowfx" + (rgb ? "c" : "") : "-fow");
    m.needsUpdate = true;
  };
  const visit = (o: THREE.Object3D, fx = false) => {
    if (!fx && SKIP.has(o.name)) { if (o.name === "fx" || o.name === "fxlib") visit(o, true); return; }      // 特效的两个组换另一种包法
    const mm = (o as THREE.Mesh).material; if (mm) { if (Array.isArray(mm)) mm.forEach(x => wrap(x, fx)); else wrap(mm, fx); }
    for (const c of o.children) visit(c, fx);
  };
  let acc = 1, since = 0;
  const eyes: number[] = [];      // 0 队的眼睛：x、z、半径的平方（视野图的软边到 1.1 倍半径），和视野图一起每秒更新十次
  const sees = (x: number, z: number) => { for (let i = 0; i < eyes.length; i += 3) { const dx = x - eyes[i], dz = z - eyes[i + 1]; if (dx * dx + dz * dz < eyes[i + 2]) return true; } return false; };
  if (active) FOG.sees = (x, z) => !!sim.over || sees(x, z);      // 分出胜负以后都放（结束演出）
  function draw() {
    cc.clearRect(0, 0, N, N); eyes.length = 0;
    for (const e of sim.ents) { if (!e.alive || e.team !== 0 || e.sight <= 0) continue; const x = (e.x + half) * k, y = (e.z + half) * k, r = e.sight * k; eyes.push(e.x, e.z, (e.sight * 1.1) ** 2);
      const g = cc.createRadialGradient(x, y, r * 0.5, x, y, r * 1.1); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(0.6, "rgba(255,255,255,0.55)"); g.addColorStop(1, "rgba(255,255,255,0)"); cc.fillStyle = g; cc.beginPath(); cc.arc(x, y, r * 1.1, 0, 6.283); cc.fill(); }
    pc.clearRect(0, 0, N, N); pc.drawImage(disp, 0, 0);      // 上一次的留一份：着色器在两次之间插值
    // 新旧各占一部分：视野的边是慢慢亮起来、慢慢暗下去的
    dc.globalCompositeOperation = "destination-out"; dc.fillStyle = "rgba(0,0,0,0.4)"; dc.fillRect(0, 0, N, N);
    dc.globalCompositeOperation = "lighter"; dc.globalAlpha = 0.4; dc.drawImage(cur, 0, 0); dc.globalAlpha = 1;
    tex.needsUpdate = true; texP.needsUpdate = true;
  }
  for (let i = 0; i < 12; i++) draw();
  const pv = new THREE.Matrix4(), mesh = new THREE.Object3D(); mesh.name = "fow";
  return { mesh, canvas: disp,
    update(dt, camera, renderer, on = true) {
      acc += dt; since += dt; if (acc >= 0.1) { acc = 0; since = 0; draw(); }
      U.uFowK.value = Math.min(1, since / 0.1);
      pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); U.uFowInv.value.copy(pv).invert();
      if (renderer) renderer.getDrawingBufferSize(U.uFowRes.value);
      U.uFowP.value.y = active && on ? 1 : 0; U.uFowP.value.z = active && on && !sim.over ? 1 : 0;      // z：藏迷雾里的特效（分出胜负以后不藏）
    },
    patch(scene) { if (active) visit(scene); },
    enable(on) { U.uFowP.value.y = active && on ? 1 : 0; U.uFowP.value.z = active && on && !sim.over ? 1 : 0; },
    sees,
  };
}
