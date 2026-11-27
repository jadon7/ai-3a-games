// 机甲第一人称座舱：
//   1) 视图空间里的立体内饰（挂在相机上）：三联屏仪表台（中央主屏 + 两块内收的翼屏，带边框按键、旋钮、拨杆、总保险护盖）、告警灯条、
//      遮光檐、风挡立柱、顶部仪表条、弹射拉环、随输入摆动的两根操纵杆、带划痕和积尘的风挡玻璃；屏幕 / 告警条 / 面板刻字都是画布贴图；
//   2) 全息 HUD（DOM，建在 #cockpit 里）：准星、主炮 / 火箭 / 动力拳 / 冲刺、熔毁核心、机体与护盾、罗盘带、锁定与来袭告警；
//   3) 登机时约 1.2 秒的启动序列（屏幕逐块点亮、自检文字、HUD 分块淡入），离舱 / 弹射时收起。
// 由 hud.js 的 frame() 每帧调用 frame(game, dt, pm)：pm 为正在驾驶的机甲，不在驾驶时为 null。
import * as THREE from 'three';
import { cockpitFromModel } from '../game/mechloader.js';
import { VIEW } from '../core/view.js';
import { touchText } from './touch.js';

const DASH_T = Math.atan2(0.09, 0.22);   // 没有 GLB 时简化仪表台的仰角
// 仪表面的摆放（与 tools/blender/build_mech.py 的 build_cockpit 一致）。视图空间：x 右、y 上、-z 前；面上一点 = o + ax·s + ay·t + n·d
const PSI = 10 * Math.PI / 180, ROLL = 0.16, HC = 0.205, HW = 0.185, WW = 0.36;
function mkFace(o, ax0, ay0) { const ax = ax0.clone().normalize(), ay = ay0.clone().addScaledVector(ax, -ay0.dot(ax)).normalize(), n = new THREE.Vector3().crossVectors(ax, ay).normalize(); return { o, ax, ay, n, q: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(ax, ay, n)) }; }
const FACE = { C: mkFace(new THREE.Vector3(0, -0.46, -0.5), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0.8, -0.6)) };
for (const [k, sg] of [['R', 1], ['L', -1]]) FACE[k] = mkFace(new THREE.Vector3(sg * 0.26, -0.46, -0.5), new THREE.Vector3(Math.cos(PSI), sg * ROLL, sg * Math.sin(PSI)), new THREE.Vector3(sg * 0.6 * Math.sin(PSI), 0.8, -0.6 * Math.cos(PSI)));
const BOOT = 1.25;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const damp = (c, t, r, dt) => c + (t - c) * (1 - Math.exp(-r * dt));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const setTxt = (el, v) => { if (el._v !== v) { el._v = v; el.textContent = v; } };
const setCls = (el, v) => { if (el._c !== v) { el._c = v; el.className = v; } };
const setVar = (el, k, v) => { const key = '_' + k; if (el[key] !== v) { el[key] = v; el.style.setProperty(k, v); } };

const HTML = `
<div class="ck-vig"></div>
<div class="ck-compass ck-b1"><div class="ck-tape" id="ckTape"></div><i></i><b id="ckHdg">000</b></div>
<div class="ck-ret" id="ckRet"><i class="t"></i><i class="b"></i><i class="l"></i><i class="r"></i><em></em><span class="arc"></span><small id="ckRange"></small></div>
<div class="ck-lock" id="ckLock"><i></i><i></i><i></i><i></i><span id="ckLockN"></span><div class="hp"><b id="ckLockHp"></b></div></div>
<div class="ck-warn" id="ckWarn"></div>
<div class="ck-doom" id="ckDoom">机体濒临摧毁 —— 按 <kbd>E</kbd> 弹射</div>
<div class="ck-panel l ck-b2">
  <div class="ck-row"><span class="k">机体完整度</span><b id="ckHp">100</b><small>%</small></div>
  <div class="ck-seg" id="ckHpSeg"></div>
  <div class="ck-row sub"><span class="k">护盾</span><div class="ck-bar sh"><i id="ckSh"></i></div><span id="ckShN" class="v">—</span></div>
  <div class="ck-row sub"><span class="k">冲刺 <kbd>Shift</kbd></span><span class="ck-pips" id="ckDash"><i></i><i></i></span></div>
</div>
<div class="ck-panel r ck-b3">
  <div class="ck-row"><span class="k">主炮 · 105 毫米</span><b id="ckAmmo">10</b><small>/ 10</small></div>
  <div class="ck-seg ammo" id="ckAmmoSeg"></div>
  <div class="ck-row sub"><span class="k">火箭巢 <kbd>右键</kbd></span><div class="ck-bar"><i id="ckRk"></i></div><span id="ckRkN" class="v">就绪</span></div>
  <div class="ck-row sub"><span class="k">动力拳 <kbd>F</kbd></span><div class="ck-bar"><i id="ckPu"></i></div><span id="ckPuN" class="v">就绪</span></div>
</div>
<div class="ck-core ck-b4"><span class="k">熔毁核心 <kbd>X</kbd></span><div class="ck-bar core"><i id="ckCore"></i></div><span id="ckCoreN" class="v">0%</span></div>
<div class="ck-exit ck-b4">长按 <kbd>E</kbd> 离舱<div class="ck-bar"><i id="ckExit"></i></div></div>
<div class="ck-boot" id="ckBoot"></div>`;

const BOOT_LINES = ['K-07「砂暴」 主控上线', '反应堆 ........ 稳定', '液压 / 步行机构 ... 正常', '火控 · 105 毫米机炮 ... 就绪', '神经链接 ........ 同步'];

// 座舱内饰材质的补丁：深度压到最前面（不会被贴脸的墙挡住）、顶点 AO 压暗
function ckPatch(m) {
  m.customProgramCacheKey = () => 'cockpit';
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aGun; varying float vAO;').replace('#include <begin_vertex>', '#include <begin_vertex>\n  vAO = aGun.x;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n  gl_Position.z = gl_Position.z * 0.02 - gl_Position.w * 0.98;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vAO;').replace('#include <color_fragment>', '#include <color_fragment>\n  diffuseColor.rgb *= 0.35 + 0.65 * vAO;');
  };
  return m;
}
const front = (m) => { m.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n  gl_Position.z = gl_Position.z * 0.02 - gl_Position.w * 0.98;'); }; m.customProgramCacheKey = () => 'ckfront'; return m; };

export class Cockpit {
  constructor(hud) {
    this.hud = hud; this.root = document.getElementById('cockpit'); this.root.innerHTML = VIEW.touch ? HTML.replace('按 <kbd>E</kbd> 弹射', '长按「离舱」弹射') : HTML;   // 整块替换 index.html 里原来的座舱 DOM
    const $ = (id) => document.getElementById(id);
    this.el = {}; for (const id of ['ckTape', 'ckHdg', 'ckRet', 'ckRange', 'ckLock', 'ckLockN', 'ckLockHp', 'ckWarn', 'ckDoom', 'ckHp', 'ckHpSeg', 'ckSh', 'ckShN', 'ckDash', 'ckAmmo', 'ckAmmoSeg', 'ckRk', 'ckRkN', 'ckPu', 'ckPuN', 'ckCore', 'ckCoreN', 'ckExit', 'ckBoot']) this.el[id] = $(id);
    const seg = (el, n) => { el.innerHTML = '<i></i>'.repeat(n); return el.querySelectorAll('i'); };
    this.hpSeg = seg(this.el.ckHpSeg, 20); this.ammoSeg = seg(this.el.ckAmmoSeg, 10); this.dashPips = this.el.ckDash.querySelectorAll('i');
    // 罗盘带：每 15° 一格，360° 之外两端各多画半圈以便循环
    let tape = ''; const N = { 0: '北', 90: '东', 180: '南', 270: '西' };
    for (let a = -180; a <= 540; a += 15) { const d = ((a % 360) + 360) % 360; tape += `<span class="${d % 90 === 0 ? 'm' : d % 45 === 0 ? 's' : ''}" style="left:${(a + 180) * 4}px">${N[d] || (d % 45 === 0 ? d : '')}</span>`; }
    this.el.ckTape.innerHTML = tape;
    this.on = false; this.bootT = -1; this.g3 = null; this.t = 0; this.scrT = 0; this.sway = new THREE.Vector3(); this.rollK = 0; this.gap = 0; this.lockT = 0; this.lock = null; this.lastHp = 1; this.hitK = 0; this.frameN = 0; this.range = 0;
  }

  // ---------- 立体内饰 ----------
  build3D(game) {
    const eng = game.engine, T = eng.T; const grp = this.g3 = new THREE.Group(); grp.visible = false; grp.renderOrder = 20;
    const std = (o) => ckPatch(new THREE.MeshStandardMaterial(o));
    const lamp = (r, g, b) => front(new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), fog: false }));
    const mats = this.mats = {
      ckDark: std({ color: 0x0b0c0e, roughness: 0.95, metalness: 0 }),   // 仪表台的哑光防眩涂层：阳光直射也不泛白
      ckFrame: std({ color: 0x1d1f21, roughness: 0.6, metalness: 0.55, map: T.armor.map }),
      ckTrim: std({ color: 0x6c6f74, roughness: 0.4, metalness: 1 }), warn: std({ color: 0x9a7414, roughness: 0.7, metalness: 0.1 }), dark: std({ color: 0x060607, roughness: 0.7, metalness: 0.2 }),
      ckRed: std({ color: 0x8a1410, roughness: 0.55, metalness: 0.15 }),
      // 指示灯：常亮的压得比较暗（满板都亮会像圣诞树），主警告灯由 frame() 按机体状态点亮
      ckLampA: lamp(1.25, 0.66, 0.14), ckLampC: lamp(0.2, 1.0, 1.35), ckLampR: lamp(1.5, 0.2, 0.12), ckLampG: lamp(0.22, 1.2, 0.42), ckLampW: lamp(0.2, 0.03, 0.02),
    };
    mats.sec = mats.ckFrame;
    const model = cockpitFromModel(mats);
    this.sticks = null;
    if (model) { model.traverse((o) => { if (o.isMesh) { o.renderOrder = 20; o.castShadow = false; o.receiveShadow = false; } }); grp.add(model); this.sticks = model.userData.sticks || null; }
    else {   // 没有 GLB 时的简化内饰：仪表台 + 两根立柱 + 顶条
      const box = (w, h, d, x, y, z, rx = 0, rz = 0, m = mats.ckDark) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.geometry.setAttribute('aGun', new THREE.BufferAttribute(new Float32Array(b.geometry.attributes.position.count * 4).fill(1), 4)); b.position.set(x, y, z); b.rotation.set(rx, 0, rz); b.renderOrder = 20; grp.add(b); };
      box(2.1, 0.3, 0.34, 0, -0.5735, -0.609, DASH_T); box(0.34, 0.36, 0.7, -0.9, -0.5, -0.5, 0.25); box(0.34, 0.36, 0.7, 0.9, -0.5, -0.5, 0.25); box(1.7, 0.14, 0.3, 0, 0.66, -0.64, -0.28);
      box(0.045, 1.1, 0.045, -0.85, 0.07, -0.72, -0.16, -0.36, mats.ckFrame); box(0.045, 1.1, 0.045, 0.85, 0.07, -0.72, -0.16, 0.36, mats.ckFrame);
    }
    // 画布贴图：三块屏幕、告警灯条、面板刻字。都按仪表面的局部坐标 (s, t, d) 摆放
    const panel = (F, sc, tc, d, w, h, cw, ch, o = {}) => {
      const c = document.createElement('canvas'); c.width = cw; c.height = ch; const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
      const k = o.k || 1.5; const mat = front(new THREE.MeshBasicMaterial({ map: tex, fog: false, toneMapped: false, transparent: !!o.alpha, depthWrite: !o.alpha, color: new THREE.Color(k, k, k) }));
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); mesh.position.copy(F.o).addScaledVector(F.ax, sc).addScaledVector(F.ay, tc).addScaledVector(F.n, d); mesh.quaternion.copy(F.q); mesh.renderOrder = o.alpha ? 22 : 21; grp.add(mesh);
      return { c, g: c.getContext('2d'), tex, mat, w: cw, h: ch, k };
    };
    if (model) {
      this.scr = [panel(FACE.C, 0, 0.082, 0.0125, 0.356, 0.134, 640, 240), panel(FACE.L, -0.158, 0.078, 0.0125, 0.248, 0.126, 448, 228), panel(FACE.R, 0.158, 0.078, 0.0125, 0.248, 0.126, 448, 228)];
      this.ann = panel(FACE.C, 0, 0.182, 0.0082, 0.336, 0.026, 672, 52, { k: 1.7 });
      this.legends(panel(FACE.C, 0, HC / 2, 0.0007, 0.524, HC, 1048, 410, { alpha: true, k: 0.75 }), panel(FACE.L, -WW / 2, HW / 2, 0.0031, WW, HW, 720, 370, { alpha: true, k: 0.75 }), panel(FACE.R, WW / 2, HW / 2, 0.0031, WW, HW, 720, 370, { alpha: true, k: 0.75 }));
    } else {   // 简化内饰：三块屏幕贴在斜面上
      const n = new THREE.Vector3(0, Math.cos(DASH_T), Math.sin(DASH_T)); const F0 = { o: new THREE.Vector3(0, -0.43, -0.55).addScaledVector(n, 0.0175), ax: new THREE.Vector3(1, 0, 0), ay: new THREE.Vector3(0, Math.sin(DASH_T), -Math.cos(DASH_T)), n, q: new THREE.Quaternion().setFromEuler(new THREE.Euler(DASH_T - Math.PI / 2, 0, 0)) };
      this.scr = [panel(F0, 0, 0, 0, 0.40, 0.15, 640, 240), panel(F0, -0.44, 0, 0, 0.29, 0.148, 448, 228), panel(F0, 0.44, 0, 0, 0.29, 0.148, 448, 228)]; this.ann = null;
    }
    // 风挡玻璃：一整块弧面，着色器画色调、边缘积尘、逆光时才显出来的划痕、仪表反光、受损裂纹
    const gg = new THREE.PlaneGeometry(4.2, 2.4, 1, 1); gg.translate(0, 0.05, -0.93);
    this.glass = new THREE.Mesh(gg, new THREE.ShaderMaterial({
      uniforms: { uSun: { value: new THREE.Vector3(0, 1, 0) }, uTime: { value: 0 }, uCrack: { value: 0 }, uBoot: { value: 1 }, uHit: { value: 0 }, uTint: { value: new THREE.Color(0.2, 0.9, 1.0) }, uAlarm: { value: 0 } },
      vertexShader: /* glsl */`varying vec2 vUv; varying vec3 vView; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vView = mv.xyz; gl_Position = projectionMatrix * mv; gl_Position.z = gl_Position.z * 0.02 - gl_Position.w * 0.98; }`,
      fragmentShader: /* glsl */`
        uniform vec3 uSun; uniform float uTime, uCrack, uBoot, uHit, uAlarm; uniform vec3 uTint; varying vec2 vUv; varying vec3 vView;
        float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
        float scratch(vec2 uv, float ang, float dens){ float c = cos(ang), s = sin(ang); vec2 q = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y); float id = floor(q.y * dens); float r = h21(vec2(id, ang)); float line = smoothstep(0.035, 0.0, abs(fract(q.y * dens) - 0.5)); float seg = smoothstep(0.55, 0.9, vn(vec2(q.x * 3.0 + r * 40.0, id))); return line * seg * step(0.72, r); }
        void main(){
          vec3 V = normalize(vView); float sun = max(0.0, dot(V, uSun)); float glare = pow(sun, 6.0);
          vec2 p = vUv * vec2(4.2, 2.4);
          float sc = scratch(p, 0.35, 34.0) + scratch(p, -0.9, 26.0) + scratch(p, 1.4, 22.0) * 0.7 + scratch(p, 0.05, 48.0) * 0.5;
          float dust = vn(p * 2.3) * 0.6 + vn(p * 9.0) * 0.4; float edge = smoothstep(0.25, 0.62, length((vUv - 0.5) * vec2(1.0, 1.25)));
          float grime = smoothstep(0.35, 0.9, dust) * (0.25 + 0.75 * edge);
          // 裂纹：机体受损越重越多
          float cr = 0.0; for (int i = 0; i < 3; i++) { vec2 c0 = vec2(0.18 + 0.32 * float(i), 0.3 + 0.2 * h21(vec2(float(i), 7.0))); vec2 d = (vUv - c0) * vec2(1.75, 1.0); float a = atan(d.y, d.x), r = length(d);
            float ray = smoothstep(0.012, 0.0, abs(fract(a * 1.9 + vn(vec2(r * 9.0, float(i))) * 0.5) - 0.5) * r) * smoothstep(0.2, 0.01, r); float ringc = smoothstep(0.003, 0.0, abs(r - 0.05 - 0.03 * vn(vec2(a * 3.0, float(i))))) * smoothstep(0.2, 0.05, r); cr += (ray + ringc * 0.6) * step(float(i) * 0.3 + 0.12, uCrack); }
          vec3 add = vec3(1.0, 0.93, 0.8) * (sc * (0.03 + 1.6 * glare) + grime * (0.012 + 0.22 * glare)) + vec3(0.9, 0.95, 1.0) * cr * (0.07 + 0.9 * glare);
          add += uTint * 0.012 * smoothstep(0.42, 0.0, vUv.y) * uBoot;                    // 仪表在玻璃下沿的反光
          add += uTint * uHit * 0.06 * edge + vec3(1.0, 0.1, 0.04) * uAlarm * (0.05 + 0.05 * sin(uTime * 9.0)) * edge;   // 受击 / 警报时玻璃边缘泛光
          float a = 0.045 + grime * 0.1 + cr * 0.12 + 0.05 * edge;                          // 轻微着色与脏污压暗
          gl_FragColor = vec4(add, a);
        }`,
      transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, fog: false,
    }));
    this.glass.renderOrder = 19; this.glass.frustumCulled = false; grp.add(this.glass);
    eng.camera.add(grp);
  }

  hide() { if (this.on) this.frame(null, 0, null); }

  // ---------- 面板刻字（静态，建好后画一次）----------
  // 三张透明画布盖在三块面板上：旋钮的刻度与名称、拨杆 / 指示灯的标签。坐标换算：2 像素 = 1 毫米
  legends(C, L, R) {
    const ink = 'rgba(214,220,226,0.92)', dim = 'rgba(214,220,226,0.5)';
    const txt = (g, t, x, y, size = 11, col = ink, al = 'center') => { g.fillStyle = col; g.font = `600 ${size}px "PingFang SC", "Helvetica Neue", Arial, sans-serif`; g.textAlign = al; g.textBaseline = 'middle'; g.fillText(t, x, y); };
    const ticks = (g, x, y, r) => { g.strokeStyle = dim; g.lineWidth = 1.2; for (let a = -135; a <= 135; a += 30) { const c = Math.cos((a - 90) * Math.PI / 180), sn = Math.sin((a - 90) * Math.PI / 180); g.beginPath(); g.moveTo(x + c * r, y + sn * r); g.lineTo(x + c * (r + 5), y + sn * (r + 5)); g.stroke(); } };
    { const g = C.g, X = (sv) => (sv + 0.262) * 2000, Y = (tv) => (HC - tv) * 2000;
      const names = { '-1': ['亮度', '对比', '增益'], '1': ['音量', '频道', '静噪'] };
      for (const sd of [-1, 1]) [0.030, 0.078, 0.126].forEach((tv, j) => { ticks(g, X(sd * 0.232), Y(tv), 31); txt(g, names[sd][j], X(sd * 0.232), Y(tv) - 41, 10); });
      txt(g, '主警告', X(-0.222), Y(0.160), 10, 'rgba(255,150,130,0.9)'); txt(g, '主注意', X(0.222), Y(0.160), 10, 'rgba(255,200,120,0.9)');
      g.strokeStyle = 'rgba(214,220,226,0.22)'; g.lineWidth = 1; for (const sd of [-1, 1]) g.strokeRect(X(sd * 0.232) - 44, Y(0.150), 88, Y(0.008) - Y(0.150));
      C.tex.needsUpdate = true; }
    for (const [P, sg] of [[R, 1], [L, -1]]) {
      const g = P.g, X = (sv) => (sg > 0 ? sv : sv + WW) * 2000, Y = (tv) => (HW - tv) * 2000;
      ['PWR', 'HYD', 'NAV', 'COM'].forEach((n, i) => txt(g, n, X(sg * (0.034 + i * 0.031)), Y(0.1565), 9, dim));
      if (sg > 0) { ['照明', '冷却', '液压'].forEach((n, i) => txt(g, n, X(0.335) - 16, Y([0.028, 0.056, 0.084][i]) - 19, 9)); txt(g, '总保险', X(0.335), Y(0.0975), 10, 'rgba(255,150,130,0.95)'); }
      else { ['量程', '增益'].forEach((n, i) => { ticks(g, X(-0.335), Y([0.034, 0.076][i]), 35); }); txt(g, '量程', X(-0.335) + 2, Y(0.055), 9); txt(g, '增益', X(-0.335) + 2, Y(0.097), 9); txt(g, '主动', X(-0.335) + 2, Y(0.1225), 9); txt(g, '敌我', X(-0.335) + 2, Y(0.146), 9); }
      P.tex.needsUpdate = true;
    }
  }

  // ---------- 屏幕内容（10 Hz）----------
  drawScreens(game, pm, boot) {
    const [C, L, R] = this.scr; const cy = '#58e0ff', am = '#ffb347', rd = '#ff5a36', gy = 'rgba(160,230,255,0.85)', fa = 'rgba(88,224,255,0.14)';
    const F = (n, w = 700) => `${w} ${n}px ui-monospace, Menlo, "PingFang SC", monospace`;
    const clear = (s) => { const g = s.g; g.fillStyle = '#031016'; g.fillRect(0, 0, s.w, s.h); g.strokeStyle = 'rgba(88,224,255,0.07)'; g.lineWidth = 1; for (let y = 0.5; y < s.h; y += 6) { g.beginPath(); g.moveTo(0, y); g.lineTo(s.w, y); g.stroke(); } g.textAlign = 'left'; g.textBaseline = 'alphabetic'; };
    // 边框按键旁的小标签（和 GLB 里按键的位置对齐）
    const keys = (s, left, right, n) => { const g = s.g; g.font = F(10, 600); g.fillStyle = 'rgba(160,230,255,0.55)'; for (let i = 0; i < n; i++) { const y = s.h * (0.5 + ((n - 1) / 2 - i) / (n - 1) * (1 - 2 * 0.07)); g.textAlign = 'left'; g.fillText('‹' + left[i], 4, y + 3); g.textAlign = 'right'; g.fillText(right[i] + '›', s.w - 4, y + 3); } g.textAlign = 'left'; };
    const hp = pm.hp / pm.maxHp, doom = pm.state === 'doomed', blink = (this.t * 4 % 1) < 0.5;
    // —— 中屏：机体 ——
    { const s = C, g = s.g; clear(s);
      if (boot < 0.25) { g.fillStyle = cy; g.font = F(22); g.fillText('K-07 SYSTEM BOOT', 150, 110); g.strokeStyle = cy; g.strokeRect(150, 128, 340, 12); g.fillRect(152, 130, 336 * boot / 0.25, 8); }
      else {
        const st = doom ? '反应堆临界' : hp < 0.3 ? '严重受损' : hp < 0.6 ? '受损' : '系统正常', sc = doom || hp < 0.3 ? rd : hp < 0.6 ? am : cy;
        g.fillStyle = 'rgba(88,224,255,0.1)'; g.fillRect(0, 0, s.w, 22); g.font = F(12); g.fillStyle = gy; g.fillText('K-07「砂暴」 · 机体', 44, 16); g.fillStyle = sc; g.textAlign = 'right'; if (!(doom && !blink)) g.fillText(st, s.w - 44, 16); g.textAlign = 'left';
        keys(s, ['DMG', 'WPN', 'COM', 'NAV', 'SYS'], ['CFG', 'LOG', 'MAP', '▼', '▲'], 5);
        // 机体示意图：各部位按完整度变色
        const col = (k) => doom ? rd : hp > k ? cy : hp > k * 0.5 ? am : rd; const x0 = 138, y0 = 34; g.lineWidth = 1.6; g.lineJoin = 'round';
        const part = (pts, k) => { const c = col(k); g.strokeStyle = c; g.fillStyle = c === cy ? 'rgba(88,224,255,0.15)' : c === am ? 'rgba(255,179,71,0.24)' : 'rgba(255,90,54,0.32)'; g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x0 + x, y0 + y) : g.moveTo(x0 + x, y0 + y)); g.closePath(); g.fill(); g.stroke(); };
        part([[-30, 26], [-22, 16], [22, 16], [30, 26], [30, 70], [20, 82], [-20, 82], [-30, 70]], 0.25);                 // 躯干
        part([[-11, 2], [11, 2], [14, 14], [-14, 14]], 0.55);                                                              // 传感器头
        part([[-66, 18], [-34, 14], [-34, 40], [-62, 44]], 0.7); part([[34, 14], [66, 18], [62, 44], [34, 40]], 0.7);       // 肩甲
        part([[-68, 48], [-48, 48], [-46, 96], [-56, 108], [-70, 96]], 0.8);                                               // 左臂 · 动力拳
        part([[46, 48], [66, 48], [68, 86], [46, 86]], 0.8); part([[50, 86], [64, 86], [62, 132], [52, 132]], 0.85);       // 右臂 · 机炮
        part([[-74, -2], [-40, -2], [-40, 12], [-74, 12]], 0.9);                                                           // 火箭巢
        part([[-24, 84], [24, 84], [20, 100], [-20, 100]], 0.4);                                                           // 髋
        part([[-32, 102], [-12, 102], [-14, 146], [-30, 146]], 0.6); part([[12, 102], [32, 102], [30, 146], [14, 146]], 0.6);
        part([[-38, 148], [-8, 148], [-6, 162], [-42, 162]], 0.9); part([[8, 148], [38, 148], [42, 162], [6, 162]], 0.9);
        // 完整度
        g.fillStyle = gy; g.font = F(12); g.fillText('机体完整度', 262, 50); g.fillStyle = sc; g.font = F(50); g.fillText(Math.ceil(hp * 100) + '%', 258, 100);
        for (let i = 0; i < 20; i++) { g.fillStyle = i < Math.ceil(hp * 20) ? sc : fa; g.fillRect(262 + i * 8, 110, 6, 10); }
        g.font = F(12); g.fillStyle = pm.bubbleT > 0 ? cy : 'rgba(160,230,255,0.45)'; g.fillText(pm.bubbleT > 0 ? '护盾 ' + pm.bubbleT.toFixed(1) + 's' : '护盾 离线', 262, 144);
        g.fillStyle = gy; g.fillText('冲刺', 262, 166); for (let i = 0; i < 2; i++) { g.fillStyle = fa; g.fillRect(300 + i * 44, 156, 38, 10); g.fillStyle = cy; g.fillRect(300 + i * 44, 156, 38 * clamp(pm.dash - i, 0, 1), 10); }
        // 右栏：速度 / 航向 / 反应堆 / 步行机构
        const bx = 452; g.fillStyle = gy; g.fillText('速度', bx, 50); g.textAlign = 'right'; g.fillStyle = '#dff6ff'; g.fillText(pm.moveSp.toFixed(1) + ' m/s', 596, 50); g.textAlign = 'left'; g.fillStyle = fa; g.fillRect(bx, 56, 144, 8); g.fillStyle = cy; g.fillRect(bx, 56, 144 * clamp(pm.moveSp / 8, 0, 1), 8);
        g.fillStyle = gy; g.fillText('航向', bx, 88); g.textAlign = 'right'; g.fillStyle = '#dff6ff'; g.fillText(String(Math.round(((-game.player.yaw * 57.2958) % 360 + 360) % 360)).padStart(3, '0') + '°', 596, 88); g.textAlign = 'left';
        g.fillStyle = gy; g.fillText('反应堆', bx, 122); g.textAlign = 'right'; g.fillStyle = pm.laserT >= 0 ? am : '#dff6ff'; g.fillText(pm.laserT >= 0 ? '核心释放' : Math.round(62 + pm.moveSp * 3 + (pm.dashT > 0 ? 20 : 0)) + '%', 596, 122); g.textAlign = 'left'; g.fillStyle = fa; g.fillRect(bx, 128, 144, 8); g.fillStyle = pm.laserT >= 0 ? am : cy; g.fillRect(bx, 128, 144 * clamp(0.62 + pm.moveSp * 0.03 + (pm.dashT > 0 ? 0.2 : 0) + (pm.laserT >= 0 ? 0.4 : 0), 0, 1), 8);
        const G = pm.gait; g.fillStyle = gy; g.fillText('步行机构', bx, 160); if (G && G.foot) for (let i = 0; i < 2; i++) { g.fillStyle = G.foot[i].planted ? cy : fa; g.fillRect(bx + 76 + i * 36, 150, 30, 10); }
        if (doom && blink) { g.fillStyle = rd; g.fillRect(40, 196, s.w - 80, 30); g.fillStyle = '#000'; g.font = F(18); g.textAlign = 'center'; g.fillText(touchText('!! 反应堆临界 —— 按 E 弹射 !!'), s.w / 2, 217); g.textAlign = 'left'; }
        else { g.fillStyle = 'rgba(160,230,255,0.5)'; g.font = F(11, 600); g.fillText(touchText('长按 E 离舱 · X 熔毁核心 · Shift 冲刺 · F 动力拳'), 138, 216); }
      }
      s.tex.needsUpdate = true; }
    // —— 左屏：雷达（正上方 = 机头方向）——
    { const s = L, g = s.g; clear(s);
      if (boot > 0.45) {
        const cx = s.w / 2 - 6, cyy = 124, R0 = 92, p = game.player; g.strokeStyle = 'rgba(88,224,255,0.45)'; g.lineWidth = 1.4;
        for (const r of [R0, R0 * 0.66, R0 * 0.33]) { g.beginPath(); g.arc(cx, cyy, r, 0, 6.3); g.stroke(); }
        g.beginPath(); g.moveTo(cx, cyy - R0); g.lineTo(cx, cyy + R0); g.moveTo(cx - R0, cyy); g.lineTo(cx + R0, cyy); g.stroke();
        for (let a = 0; a < 360; a += 30) { const c = Math.cos(a * Math.PI / 180), sn = Math.sin(a * Math.PI / 180); g.beginPath(); g.moveTo(cx + c * R0, cyy + sn * R0); g.lineTo(cx + c * (R0 + 5), cyy + sn * (R0 + 5)); g.stroke(); }
        const sw = this.t * 2.2; const grd = g.createConicGradient ? g.createConicGradient(sw - 1.0, cx, cyy) : null;
        if (grd) { grd.addColorStop(0, 'rgba(88,224,255,0)'); grd.addColorStop(0.159, 'rgba(88,224,255,0.28)'); grd.addColorStop(0.16, 'rgba(88,224,255,0)'); grd.addColorStop(1, 'rgba(88,224,255,0)'); g.fillStyle = grd; g.beginPath(); g.arc(cx, cyy, R0, 0, 6.3); g.fill(); }
        g.strokeStyle = 'rgba(88,224,255,0.9)'; g.beginPath(); g.moveTo(cx, cyy); g.lineTo(cx + Math.cos(sw) * R0, cyy + Math.sin(sw) * R0); g.stroke();
        const cs = Math.cos(p.yaw), sn = Math.sin(p.yaw); let ne = 0, nf = 0;
        const plot = (x, z, colr, size) => { const dx = x - pm.pos.x, dz = z - pm.pos.z; const rx = dx * cs - dz * sn, rz = dx * sn + dz * cs; const k = R0 / 80; let px = rx * k, py = rz * k; const d = Math.hypot(px, py); if (d > R0 - 3) { px *= (R0 - 3) / d; py *= (R0 - 3) / d; } g.fillStyle = colr; g.fillRect(cx + px - size / 2, cyy + py - size / 2, size, size); };
        for (const a of game.actors) if (a.alive) { plot(a.pos.x, a.pos.z, a.team === 0 ? cy : rd, a.kind === 'grunt' ? 4 : 6); if (a.team === 0) nf++; else ne++; }
        for (const m of game.mechs) if (m.alive && m !== pm) { plot(m.pos.x, m.pos.z, m.team === 0 ? cy : am, 10); if (m.team !== 0) ne++; }
        g.fillStyle = '#fff'; g.beginPath(); g.moveTo(cx, cyy - 8); g.lineTo(cx + 6, cyy + 6); g.lineTo(cx - 6, cyy + 6); g.fill();
        g.fillStyle = gy; g.font = F(12); g.fillText('雷达 · 80 m', 30, 18); g.textAlign = 'right'; g.fillStyle = rd; g.fillText('敌 ' + ne, s.w - 30, 18); g.fillStyle = cy; g.fillText('友 ' + nf, s.w - 30, 36); g.textAlign = 'left';
        keys(s, ['RNG-', 'RNG+', 'IFF', 'TWS'], ['GND', 'AIR', 'MAP', 'OFF'], 4);
      }
      s.tex.needsUpdate = true; }
    // —— 右屏：武器 ——
    { const s = R, g = s.g; clear(s);
      if (boot > 0.7) {
        const x0 = 34, x1 = s.w - 34, rl = pm.reloadT >= 0, ht = pm.heat || 0;
        g.font = F(12); g.fillStyle = gy; g.fillText('主炮 · 105 毫米', x0, 20); g.textAlign = 'right'; g.fillStyle = rl ? am : '#dff6ff'; g.fillText(rl ? '装填 ' + Math.round(pm.reloadT / 2.3 * 100) + '%' : pm.mag + ' / 10', x1, 20); g.textAlign = 'left';
        for (let i = 0; i < 10; i++) { const on = rl ? i < Math.floor(pm.reloadT / 2.3 * 10) : i < pm.mag; const x = x0 + i * 38; g.fillStyle = on ? (rl ? am : cy) : fa; g.beginPath(); g.moveTo(x, 54); g.lineTo(x, 36); g.quadraticCurveTo(x + 13, 22, x + 26, 36); g.lineTo(x + 26, 54); g.closePath(); g.fill(); g.fillRect(x - 2, 56, 30, 4); }
        g.fillStyle = gy; g.fillText('炮温', x0, 82); g.fillStyle = fa; g.fillRect(x0 + 40, 73, 250, 9); g.fillStyle = ht > 0.7 ? rd : am; g.fillRect(x0 + 40, 73, 250 * clamp(ht, 0, 1), 9); g.fillStyle = '#dff6ff'; g.textAlign = 'right'; g.fillText(Math.round(180 + ht * 620) + '°C', x1, 82); g.textAlign = 'left';
        // 火箭巢：2×4 发射筒
        const cd = pm.rocketCD > 0, n = pm.salvo > 0 ? pm.salvo : cd ? Math.floor(clamp(1 - pm.rocketCD / 9, 0, 1) * 8) : 8;
        g.fillStyle = gy; g.fillText('火箭巢', x0, 112); g.fillStyle = pm.salvo > 0 ? am : cd ? 'rgba(160,230,255,0.6)' : cy; g.fillText(pm.salvo > 0 ? '发射' : cd ? '装填 ' + pm.rocketCD.toFixed(1) + 's' : touchText('就绪 · 右键'), x0, 130);
        for (let i = 0; i < 8; i++) { const cxx = 190 + (i % 4) * 30, cyy = 108 + Math.floor(i / 4) * 26; g.strokeStyle = 'rgba(88,224,255,0.5)'; g.lineWidth = 1.5; g.beginPath(); g.arc(cxx, cyy, 10, 0, 6.3); g.stroke(); if (i < n) { g.fillStyle = cd ? 'rgba(88,224,255,0.45)' : cy; g.beginPath(); g.arc(cxx, cyy, 6.5, 0, 6.3); g.fill(); } }
        // 动力拳 / 熔毁核心
        g.fillStyle = gy; g.fillText('动力拳', 320, 112); g.fillStyle = pm.punchT >= 0 ? am : cy; g.fillText(pm.punchT >= 0 ? '回收' : '就绪 · F', 320, 130);
        const core = pm.laserT >= 0 ? clamp(1 - pm.laserT / 5, 0, 1) : pm.core; g.fillStyle = gy; g.fillText('熔毁核心', x0, 176); g.fillStyle = fa; g.fillRect(x0 + 70, 166, 220, 11); g.fillStyle = pm.laserT >= 0 || pm.core >= 1 ? am : 'rgba(255,179,71,0.55)'; g.fillRect(x0 + 70, 166, 220 * core, 11);
        g.textAlign = 'right'; g.fillStyle = pm.core >= 1 && blink ? am : '#dff6ff'; g.fillText(pm.laserT >= 0 ? '释放中' : pm.core >= 1 ? '就绪 · X' : Math.floor(pm.core * 100) + '%', x1, 176); g.textAlign = 'left';
        g.fillStyle = 'rgba(160,230,255,0.5)'; g.font = F(11, 600); g.fillText('总保险 开 · 火控 自动', x0, 208);
        keys(s, ['SAFE', 'PUN', 'RKT', 'GUN'], ['JETT', 'CORE', 'LOCK', 'ARM'], 4);
      }
      s.tex.needsUpdate = true; }
    // —— 告警灯条：八格，亮起的才有底色 ——
    if (this.ann) {
      const s = this.ann, g = s.g, W = s.w / 8; g.fillStyle = '#05080a'; g.fillRect(0, 0, s.w, s.h); g.font = `700 21px "PingFang SC", "Helvetica Neue", Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      let locked = false; for (const m of game.mechs) if (m.alive && m.team !== pm.team && m.target === pm && m.state !== 'drop') { locked = true; break; }
      const cells = [['装填', pm.reloadT >= 0, am], ['火箭', pm.rocketCD <= 0 && pm.salvo <= 0, '#59e08a'], ['过热', (pm.heat || 0) > 0.7, rd], ['护盾', pm.bubbleT > 0, cy], ['冲刺', pm.dash >= 1, '#59e08a'], ['受损', hp < 0.6, hp < 0.3 ? rd : am], ['锁定', locked && blink, rd], ['弹射', doom && blink, rd]];
      cells.forEach(([name, on, colr], i) => { const x = i * W; if (boot > 0.3 && on) { g.fillStyle = colr; g.fillRect(x + 3, 4, W - 6, s.h - 8); g.fillStyle = '#04080a'; } else { g.strokeStyle = 'rgba(160,200,215,0.18)'; g.lineWidth = 1; g.strokeRect(x + 3.5, 4.5, W - 7, s.h - 9); g.fillStyle = 'rgba(160,200,215,0.3)'; } g.fillText(name, x + W / 2, s.h / 2 + 1); });
      s.tex.needsUpdate = true;
    }
  }

  // ---------- 每帧 ----------
  frame(game, dt, pm) {
    const on = !!pm; this.t += dt; this.frameN++;
    if (on !== this.on) {
      this.on = on;
      if (on) { if (!this.g3) this.build3D(game); this.bootT = 0; this.el.ckBoot.innerHTML = ''; this.bootN = 0; this.sway.set(0, 0, 0); this.lastHp = pm.hp / pm.maxHp; this.hitK = 0; this.scrT = 0; }
      else { this.root.className = ''; this.root._c = ''; }
      if (this.g3) this.g3.visible = on;
    }
    if (!on) return;
    const e = this.el, p = game.player, cam = game.engine.camera, g3 = this.g3;
    // 启动序列
    if (this.bootT >= 0) {
      this.bootT += dt; const k = this.bootT / BOOT;
      const want = Math.min(BOOT_LINES.length, Math.floor(k * (BOOT_LINES.length + 0.5)) + 1);
      while (this.bootN < want) { const d = document.createElement('div'); d.textContent = '> ' + BOOT_LINES[this.bootN++]; e.ckBoot.appendChild(d); }
      if (k >= 1) this.bootT = -1;
    }
    const boot = this.bootT < 0 ? 1 : this.bootT / BOOT;
    // 内饰相对视线的晃动：走路的沉浮与侧摆、受击抖动、开炮后坐、舱盖合上时从上方落下
    const G = pm.gait; const sh = p.shake * p.shake, t = this.t * 37;
    const ty = G ? clamp((G.pelY + G.dip - 2.66) * -0.16, -0.03, 0.03) : 0, tx = G ? -G.sway * 0.22 : 0;
    this.sway.x = damp(this.sway.x, tx, 9, dt); this.sway.y = damp(this.sway.y, ty, 9, dt); this.rollK = damp(this.rollK, G ? G.roll * 0.8 : 0, 8, dt);
    const close = 1 - Math.min(1, boot / 0.32); const drop = close * close;
    g3.position.set(this.sway.x + Math.sin(t) * sh * 0.012, this.sway.y + Math.sin(t * 1.3) * sh * 0.012 - (pm.recoil || 0) * 0.006 + drop * 0.5, (pm.recoil || 0) * 0.012);
    g3.rotation.set(-drop * 0.5 + (pm.recoil || 0) * 0.004, 0, this.rollK + Math.sin(t * 0.7) * sh * 0.006);
    // 玻璃
    const hp = pm.hp / pm.maxHp, doom = pm.state === 'doomed';
    if (hp < this.lastHp - 1e-4) this.hitK = Math.min(1, this.hitK + (this.lastHp - hp) * 14 + 0.25); this.lastHp = hp; this.hitK = damp(this.hitK, 0, 4, dt);
    const gu = this.glass.material.uniforms; gu.uTime.value = this.t; gu.uCrack.value = doom ? 1 : clamp((0.62 - hp) / 0.5, 0, 0.99); gu.uBoot.value = boot; gu.uHit.value = this.hitK; gu.uAlarm.value = doom ? 1 : 0;
    const sun = game.engine.sun; if (sun) { _v.copy(sun.position); if (sun.target) _v.sub(sun.target.position); _v.normalize().transformDirection(cam.matrixWorldInverse); gu.uSun.value.copy(_v); }
    // 屏幕：10 Hz 重画，启动时逐块点亮
    this.scrT -= dt; if (this.scrT <= 0) { this.scrT = 0.1; this.drawScreens(game, pm, boot); }
    const fl = doom ? 0.7 + 0.3 * Math.sin(this.t * 31) : 1; for (let i = 0; i < 3; i++) { const b = clamp((boot - [0.05, 0.4, 0.65][i]) / 0.12, 0, 1) * 1.5 * fl; this.scr[i].mat.color.setRGB(b, b, b); }
    if (this.ann) { const b = clamp((boot - 0.3) / 0.12, 0, 1) * this.ann.k; this.ann.mat.color.setRGB(b, b, b); }
    // 主警告灯：受损变红，濒毁时快闪
    { const w = doom ? ((this.t * 5 % 1) < 0.5 ? 3.2 : 0.3) : hp < 0.3 ? 1.6 + Math.sin(this.t * 7) * 0.6 : this.hitK > 0.3 ? 2.2 : 0.14; this.mats.ckLampW.color.setRGB(1.0 * w, 0.13 * w, 0.07 * w); }
    // 操纵杆：左手杆跟着移动方向，右手杆跟着转向 / 俯仰的角速度，开炮时一顿
    if (this.sticks) {
      const [sl, sr] = this.sticks; const f = p.fwd, r = p.right, v = pm.vel || _v2.set(0, 0, 0); const mf = clamp((v.x * f.x + v.z * f.z) / 6.6, -1, 1), ms = clamp((v.x * r.x + v.z * r.z) / 6.6, -1, 1);
      let yr = (p.yaw - (this._py === undefined ? p.yaw : this._py)) / Math.max(dt, 1e-3); if (Math.abs(yr) > 30) yr = 0; const pr = (p.pitch - (this._pp === undefined ? p.pitch : this._pp)) / Math.max(dt, 1e-3); this._py = p.yaw; this._pp = p.pitch;
      this.stk = this.stk || [0, 0, 0, 0]; const k = 1 - Math.exp(-10 * dt); const S = this.stk; S[0] += (-0.3 * mf - S[0]) * k; S[1] += (-0.3 * ms - S[1]) * k; S[2] += (clamp(pr * 0.12, -0.3, 0.3) - S[2]) * k; S[3] += (clamp(yr * 0.1, -0.32, 0.32) - S[3]) * k;
      if (sl) sl.rotation.set(S[0], 0, S[1]); if (sr) sr.rotation.set(S[2] + (pm.recoil || 0) * 0.08, 0, S[3]);
    }

    // ---------- 全息 HUD ----------
    // 罗盘带（4px / 度）
    const hdg = ((-p.yaw * 57.2958) % 360 + 360) % 360; e.ckTape.style.transform = `translateX(${(-(hdg + 180) * 4).toFixed(1)}px)`; setTxt(e.ckHdg, String(Math.round(hdg) % 360).padStart(3, '0'));
    // 准星：主炮后坐与行走让准星张开；装填时显示进度弧
    const gapT = 9 + (pm.recoil || 0) * 16 + Math.min(8, pm.moveSp * 1.1) + (pm.dashT > 0 ? 10 : 0); this.gap = damp(this.gap, gapT, 16, dt); setVar(e.ckRet, '--gap', this.gap.toFixed(1) + 'px');
    setVar(e.ckRet, '--rl', pm.reloadT >= 0 ? (pm.reloadT / 2.3).toFixed(3) : '0'); setCls(e.ckRet, 'ck-ret' + (pm.reloadT >= 0 ? ' rl' : '') + (pm.laserT >= 0 ? ' beam' : '') + (pm.mag <= 0 && pm.reloadT < 0 ? ' empty' : ''));
    // 锁定框：离准星最近的敌人（每 3 帧找一次），显示名称、距离与血量
    if (this.frameN % 3 === 0) {
      let best = null, bs = 0.985; const cp = cam.position;
      for (const c of game.enemiesOf(0)) { if (c.alive === false) continue; c.aimPoint(_v); _v2.subVectors(_v, cp); const d = _v2.length(); if (d > 160 || d < 2) continue; const dot = _v2.dot(p.look) / d; if (dot > bs && !game.world.blocked(cp, _v)) { bs = dot; best = c; this.range = d; } }
      this.lock = best;
    }
    const lk = this.lock && this.lock.alive !== false ? this.lock : null;
    if (lk) {
      lk.aimPoint(_v).project(cam); const vis = _v.z < 1 && Math.abs(_v.x) < 1 && Math.abs(_v.y) < 1;
      if (vis) { const sz = clamp((lk.kind === 'mech' ? 520 : 150) / Math.max(4, this.range), 26, 240); e.ckLock.style.transform = `translate(${((_v.x * 0.5 + 0.5) * VIEW.w / VIEW.ui).toFixed(1)}px, ${((0.5 - _v.y * 0.5) * VIEW.h / VIEW.ui).toFixed(1)}px)`; setVar(e.ckLock, '--s', sz.toFixed(0) + 'px');
        setTxt(e.ckLockN, (lk.kind === 'mech' ? '机甲' : lk.kind === 'drone' ? '无人机' : lk.kind === 'pilot' ? '铁驭' : lk.kind === 'sniper' ? '狙击手' : '步兵') + ' · ' + Math.round(this.range) + 'm'); if (lk.maxHp) setVar(e.ckLockHp, '--w', (clamp(lk.hp / lk.maxHp, 0, 1) * 100).toFixed(0) + '%'); }
      setCls(e.ckLock, 'ck-lock' + (vis ? ' on' : '') + (lk.kind === 'mech' ? ' mech' : ''));
    } else setCls(e.ckLock, 'ck-lock');
    setTxt(e.ckRange, lk ? Math.round(this.range) + ' m' : '');
    // 告警：被敌方机甲锁定 / 弹药来袭
    let warn = '';
    for (const m of game.mechs) if (m.alive && m.team !== pm.team && m.target === pm && m.state !== 'drop') { warn = '⚠ 被敌方机甲锁定'; break; }
    for (const q of game.projectiles) { if (q.team === pm.team || q.kind === 'bolt') continue; const dx = pm.pos.x - q.pos.x, dy = pm.pos.y + 3 - q.pos.y, dz = pm.pos.z - q.pos.z; const d = Math.hypot(dx, dy, dz); if (d < 70 && (q.vel.x * dx + q.vel.y * dy + q.vel.z * dz) / (d * Math.max(1, q.vel.length())) > 0.9) { warn = q.kind === 'rocket' ? '⚠ 火箭来袭' : '⚠ 炮弹来袭'; break; } }
    if (game.sniperWarn > 0.05) warn = warn || '⚠ 被狙击手锁定';
    setTxt(e.ckWarn, warn); setCls(e.ckWarn, 'ck-warn' + (warn ? ' on' : ''));
    setCls(e.ckDoom, 'ck-doom' + (doom ? ' on' : ''));
    // 机体 / 护盾 / 冲刺
    setTxt(e.ckHp, String(Math.ceil(hp * 100))); const nh = Math.ceil(hp * 20); for (let i = 0; i < 20; i++) setCls(this.hpSeg[i], i < nh ? (hp < 0.3 ? 'on low' : 'on') : '');
    setVar(e.ckSh, '--w', (clamp(pm.bubbleT / 9, 0, 1) * 100).toFixed(0) + '%'); setTxt(e.ckShN, pm.bubbleT > 0 ? pm.bubbleT.toFixed(1) + 's' : '离线');
    for (let i = 0; i < 2; i++) setVar(this.dashPips[i], '--p', clamp(pm.dash - i, 0, 1).toFixed(2));
    // 武器
    const rl = pm.reloadT >= 0; setTxt(e.ckAmmo, rl ? '装填' : String(pm.mag)); for (let i = 0; i < 10; i++) setCls(this.ammoSeg[i], rl ? (i < Math.floor(pm.reloadT / 2.3 * 10) ? 'on rl' : '') : (i < pm.mag ? 'on' : ''));
    setVar(e.ckRk, '--w', ((pm.rocketCD > 0 ? clamp(1 - pm.rocketCD / 9, 0, 1) : 1) * 100).toFixed(0) + '%'); setTxt(e.ckRkN, pm.salvo > 0 ? '发射' : pm.rocketCD > 0 ? pm.rocketCD.toFixed(1) + 's' : '就绪'); setCls(e.ckRkN, 'v' + (pm.rocketCD > 0 ? '' : ' ok'));
    setVar(e.ckPu, '--w', ((pm.punchT >= 0 ? clamp(pm.punchT / 0.7, 0, 1) : 1) * 100).toFixed(0) + '%'); setTxt(e.ckPuN, pm.punchT >= 0 ? '回收' : '就绪'); setCls(e.ckPuN, 'v' + (pm.punchT >= 0 ? '' : ' ok'));
    // 核心 / 离舱
    setVar(e.ckCore, '--w', ((pm.laserT >= 0 ? clamp(1 - pm.laserT / 5, 0, 1) : pm.core) * 100).toFixed(1) + '%'); setTxt(e.ckCoreN, pm.laserT >= 0 ? '释放中' : pm.core >= 1 ? touchText('就绪 · 按 X') : Math.floor(pm.core * 100) + '%'); setCls(e.ckCoreN, 'v' + (pm.core >= 1 ? ' ok' : pm.laserT >= 0 ? ' hot' : ''));
    setVar(e.ckExit, '--w', (clamp(pm.exitHold / 0.45, 0, 1) * 100).toFixed(0) + '%');
    if (this.bootT >= 0) for (let i = 0; i < 5; i++) setVar(this.root, '--o' + (i + 1), clamp((boot - [0.3, 0.46, 0.6, 0.74, 0.84][i]) / 0.1, 0, 1).toFixed(2));   // 启动时 HUD 分块点亮
    setVar(this.root, '--ob', this.bootT >= 0 ? clamp((1 - boot) / 0.12, 0, 1).toFixed(2) : '0');   // 自检文字在启动结束前淡出
    setCls(this.root, (this.bootT >= 0 ? 'boot' : 'live') + (doom ? ' doom' : '') + (this.hitK > 0.3 ? ' hit' : ''));
  }
}
