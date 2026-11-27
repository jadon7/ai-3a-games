// 伊缇 · 绯刃 的特效试验页（第二阶段 iti-fx2，Opus 自己做的“王者那一档”）。
// 从 lab/fx_codex/main.ts 复制过来改的：场景、光照、地面、镜头、站位和 Codex 那一版完全一样（同一时刻能并排比），
// 加了四样屏幕上的东西——顿帧、镜头抖、受击整个人闪白、画面压暗（和全屏闪一下）——接口照游戏 fxlib.ts 的 hitstop / shake 写，第四阶段直接接。
//
// 网址参数：
//   play=r|q|passive        载入后自动播这一段（loop=1 每隔一会儿重放）
//   cam=top|mid|close|side  镜头：top 游戏镜头（27 米、56 度），mid 中镜头（18 米），close 近镜头（12 米），side 侧面平视
//                           也可以写 cam=距离,俯角,转角,看向x,看向y,看向z
//   ground=me|foe           我方草地 / 对方红土
//   q=lite                  手机档
//   speed=0.25              慢放
//   nohud=1                 不显示按钮和统计
//   cap=1                   录像模式：时间由 window.__lab.step(dt) 一帧一帧推（tools/rec.mjs 用）
//   nofx2=1                 关掉压暗、闪白、顿帧、镜头抖（看这四样各占多少分量用）
import * as THREE from "three";
import { TOON_ON, T } from "../../src/map/toon";
import { loadHero, type Hero } from "../../src/map/hero/hero";
import { glb, LITE } from "../../src/map/quality";
import type { Demo, FxCtx, FxHandle, LabActor } from "./api";
import { DEMOS } from "./fx/index";
import { prepareKit, kitStats } from "./fx/kit";

const P = new URLSearchParams(location.search);
const CAP = P.get("cap") === "1";
const NOFX2 = P.get("nofx2") === "1";
const num = (k: string, d: number) => (P.has(k) && Number.isFinite(+P.get(k)!) ? +P.get(k)! : d);
if (P.get("nohud") === "1") document.body.classList.add("nohud");

// ---------- 渲染器、调色（照 src/map/world/main.ts 的 B 设置，和 fx_codex 一样） ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: CAP, powerPreference: "high-performance" });
renderer.setPixelRatio(CAP ? 1 : Math.min(devicePixelRatio, num("dpr", 2)));
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.prepend(renderer.domElement);
if (TOON_ON) {
  THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace("vec3 CustomToneMapping( vec3 color ) { return color; }", `vec3 CustomToneMapping( vec3 color ) {
    color = NeutralToneMapping( color );
    float l = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );
    color = mix( vec3( l ), color, ${T.sat.toFixed(3)} );
    float sh = 1.0 - smoothstep( 0.0, ${T.shl.toFixed(3)}, l ), hi = smoothstep( 0.42, 0.95, l );
    color *= mix( vec3( 1.0 ), vec3( 0.84, 1.0, 1.13 ), sh * ${T.shc.toFixed(3)} ) * mix( vec3( 1.0 ), vec3( 1.06, 1.0, 0.92 ), hi * 0.2 );
    float yg = clamp( ( color.g - color.b ) * 3.0, 0.0, 1.0 ) * clamp( 1.0 - abs( color.r - color.g ) * 5.0, 0.0, 1.0 );
    color.r *= 1.0 - ${T.yg.toFixed(3)} * yg;
    color += sh * 0.014 * vec3( 0.45, 0.8, 1.0 );
    return clamp( color, 0.0, 1.0 );
  }`);
  renderer.toneMapping = THREE.CustomToneMapping;
} else renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = TOON_ON ? T.exp : 1.0;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1d3324);

// ---------- 光 ----------
const sunDir = new THREE.Vector3(-0.7, 0.72, -0.3).normalize();
const sun = new THREE.DirectionalLight(new THREE.Color(0xffffff).lerp(new THREE.Color(0xffe2b8), T.warm), T.sun);
sun.position.copy(sunDir).multiplyScalar(60); sun.target.position.set(0, 0, 0);
sun.castShadow = true; sun.shadow.mapSize.set(LITE ? 2048 : 4096, LITE ? 2048 : 4096); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; sun.shadow.radius = LITE ? 1.6 : 3.2;
{ const sc = sun.shadow.camera as THREE.OrthographicCamera; sc.left = -26; sc.right = 26; sc.top = 26; sc.bottom = -26; sc.near = 1; sc.far = 160; }
const hemi = new THREE.HemisphereLight(0xa4d8f0, 0x8a9a62, T.hemi);
const rim = new THREE.DirectionalLight(0xe8f0ff, 0.5); rim.position.set(0.45, 0.6, 0.8);
scene.add(sun, sun.target, hemi, rim);

// ---------- 地面（renderOrder 0；压暗那一层是 1；人物是 2——见下面“屏幕压暗”） ----------
const GROUND = P.get("ground") === "foe" ? { ci: 5, cj: 2 } : { ci: 2, cj: 5 };
let groundLoaded = 0;
{
  const tl = new THREE.TextureLoader(), geo = new THREE.PlaneGeometry(25, 25).rotateX(-Math.PI / 2);
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
    tl.load(`/assets/map/ground/c_${GROUND.ci + di}_${GROUND.cj + dj}.webp`, t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; mat.map = t; mat.needsUpdate = true; groundLoaded++; });
    const m = new THREE.Mesh(geo, mat); m.position.set(di * 25, 0, dj * 25); m.receiveShadow = true; scene.add(m);
  }
}

// ---------- 镜头（照游戏） ----------
const camera = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, 0.3, 400);
const CAMS: Record<string, [number, number, number, number, number, number]> = {
  top: [27, 56, 0, 0, 0, 0],
  close: [12, 48, 0, 0, 1.0, 0],
  mid: [18, 52, 0, 0, 0.5, 0],
  side: [16, 12, 0, 0, 1.6, 0],
};
let camSpec = CAMS.top;
function setCam(c: string) {
  if (CAMS[c]) camSpec = CAMS[c];
  else { const v = c.split(",").map(Number); if (v.length >= 2 && v.every(Number.isFinite)) camSpec = [v[0], v[1], v[2] ?? 0, v[3] ?? 0, v[4] ?? 0, v[5] ?? 0]; }
}
setCam(P.get("cam") ?? "top");

// ---------- 镜头抖（照游戏 fxlib.shake / shakeOffset：平方衰减，三个方向不同频率的正弦；只挪位置不改朝向） ----------
let realT = 0;
const sh = { amp: 0, t: 0, dur: 0 };
function shake(amp: number, dur = 0.25) { if (NOFX2) return; if (amp >= sh.amp * (1 - sh.t / (sh.dur || 1))) { sh.amp = amp; sh.t = 0; sh.dur = dur; } }
const shakeOff = new THREE.Vector3();
function shakeOffset(out: THREE.Vector3) { const k = sh.dur > 0 && sh.t < sh.dur ? sh.amp * Math.pow(1 - sh.t / sh.dur, 2) : 0; return out.set(Math.sin(realT * 61) * k, Math.sin(realT * 83 + 1.3) * k * 0.7, Math.cos(realT * 71) * k); }
function placeCam() {
  const [d, p, y, tx, ty, tz] = camSpec, pr = THREE.MathUtils.degToRad(p), yr = THREE.MathUtils.degToRad(y), h = d * Math.cos(pr);
  camera.position.set(tx + Math.sin(yr) * h, ty + d * Math.sin(pr), tz + Math.cos(yr) * h); camera.lookAt(tx, ty, tz);
  camera.position.add(shakeOffset(shakeOff));
}
function fit() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener("resize", fit);

// ---------- 屏幕压暗：一张盖满屏幕的三角形，排在不透明物体里、地面之后人物之前（renderOrder 1），用“乘”的混合把已经画好的地面压暗。
// 人物（renderOrder 2）和特效（透明物体，最后画）都在它后面画，所以不受影响——就是王者大招“只留人亮着”的那一下。
// 接进游戏：地形 renderOrder 0，英雄、小兵、塔的网格设成 2，这张三角形放 1；迷雾、血条照旧。
const fsGeo = new THREE.BufferGeometry(); fsGeo.setAttribute("position", new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
const dimMat = new THREE.ShaderMaterial({
  uniforms: { uK: { value: 0 } },
  vertexShader: `varying vec2 vP; void main() { vP = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  // 压暗带一点冷紫（绯红在冷暗的底子上最跳），四角再暗一点（暗角把视线往中间收）
  fragmentShader: `uniform float uK; varying vec2 vP;
    void main() { float vig = smoothstep(0.35, 1.45, length(vP * vec2(1.0, 0.9)));
      vec3 tint = vec3(0.36, 0.32, 0.46) * (1.0 - 0.45 * vig);
      gl_FragColor = vec4(mix(vec3(1.0), tint, uK), 1.0); }`,
  depthTest: false, depthWrite: false, transparent: false,
  blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.SrcColorFactor,
});
const dimMesh = new THREE.Mesh(fsGeo, dimMat); dimMesh.frustumCulled = false; dimMesh.renderOrder = 1; dimMesh.visible = false; scene.add(dimMesh);
const dimS = { from: 0, k: 0, t: 0, fin: 0, hold: 0, fout: 0, on: false, v: 0 };
function dim(k: number, fadeIn: number, hold: number, fadeOut: number) { if (NOFX2) return; Object.assign(dimS, { from: dimS.v, k, t: 0, fin: fadeIn, hold, fout: fadeOut, on: true }); }
function tickDim(rdt: number) {
  if (!dimS.on) { dimS.v = 0; dimMesh.visible = false; return; }
  dimS.t += rdt; const { t, fin, hold, fout } = dimS;
  dimS.v = t < fin ? THREE.MathUtils.lerp(dimS.from, dimS.k, t / Math.max(fin, 1e-4)) : t < fin + hold ? dimS.k : THREE.MathUtils.lerp(dimS.k, 0, Math.min(1, (t - fin - hold) / Math.max(fout, 1e-4)));
  if (t > fin + hold + fout) { dimS.on = false; dimS.v = 0; }
  dimMat.uniforms.uK.value = dimS.v; dimMesh.visible = dimS.v > 0.002;
}
// ---------- 全屏闪一下（加法，最后画） ----------
const flashMat = new THREE.ShaderMaterial({
  uniforms: { uK: { value: 0 }, uC: { value: new THREE.Color(1, 0.85, 0.9) } },
  vertexShader: `varying vec2 vP; void main() { vP = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: `uniform float uK; uniform vec3 uC; varying vec2 vP; void main() { float c = 1.0 - 0.45 * smoothstep(0.2, 1.4, length(vP)); gl_FragColor = vec4(uC * uK * c, 1.0); }`,
  depthTest: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending,
});
const flashMesh = new THREE.Mesh(fsGeo, flashMat); flashMesh.frustumCulled = false; flashMesh.renderOrder = 1000; flashMesh.visible = false; scene.add(flashMesh);
const flS = { k: 0, t: 0, dur: 0 };
function flash(k: number, dur: number, color = 0xffd8e4) { if (NOFX2) return; flS.k = k; flS.t = 0; flS.dur = dur; (flashMat.uniforms.uC.value as THREE.Color).set(color); }
function tickFlash(rdt: number) { flS.t += rdt; const v = flS.t < flS.dur ? flS.k * Math.pow(1 - flS.t / flS.dur, 2) : 0; flashMat.uniforms.uK.value = v; flashMesh.visible = v > 0.002; }

// ---------- 人 ----------
type Spot = { file: string; dir: "hero" | "unit"; name: string; team: number; height: number; radius: number; isHero: boolean; x: number; z: number; yaw?: number; look?: Record<string, number> };
const SPOTS: Spot[] = [
  { file: "lan", dir: "hero", name: "伊缇（占位）", team: 0, height: 3.3, radius: 0.7, isHero: true, x: -5.2, z: 2.9 },
  { file: "moko", dir: "hero", name: "摩珂", team: 1, height: 3.3, radius: 0.7, isHero: true, x: 2.1, z: -1.3 },
  { file: "torg", dir: "hero", name: "托尔格", team: 1, height: 2.8, radius: 0.8, isHero: true, x: -2.4, z: 1.7 },
  { file: "melee", dir: "unit", name: "近战兵", team: 1, height: 1.45, radius: 0.45, isHero: false, x: 3.7, z: 2.5, look: { lift: 1.2, sat: 1.05, fill: 0.36, rim: 0.6 } },
  { file: "melee", dir: "unit", name: "近战兵", team: 1, height: 1.45, radius: 0.45, isHero: false, x: -0.6, z: -3.5, look: { lift: 1.2, sat: 1.05, fill: 0.36, rim: 0.6 } },
  { file: "melee", dir: "unit", name: "近战兵", team: 1, height: 1.45, radius: 0.45, isHero: false, x: -4.1, z: -1.4, look: { lift: 1.2, sat: 1.05, fill: 0.36, rim: 0.6 } },
  { file: "melee", dir: "unit", name: "近战兵", team: 1, height: 1.45, radius: 0.45, isHero: false, x: 0.9, z: 3.6, look: { lift: 1.2, sat: 1.05, fill: 0.36, rim: 0.6 } },
];
const actors: LabActor[] = [];
const whites: { mat: THREE.MeshBasicMaterial; meshes: THREE.Object3D[]; v: number }[] = [];
async function makeActor(s: Spot): Promise<LabActor> {
  const hero: Hero = await loadHero(glb(s.dir, s.file), s.team, { height: s.height, ...(s.look ?? {}) });
  scene.add(hero.group);
  hero.tag?.(s.isHero ? s.name : "", () => s.team === 0);
  hero.setLife(s.team === 0 ? 1 : 0.72, s.isHero ? 2400 : 500, s.isHero ? 9 : 0);
  if (!s.isHero) hero.group.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = false; });
  hero.group.traverse(o => { if ((o as THREE.Mesh).isMesh) o.renderOrder = 2; });      // 排在压暗那一层后面：压暗时人物不变暗
  // 整个人闪白：每个蒙皮网格再挂一份同骨骼的白色网格（和 hero.ts 的描边同一个做法），平时藏着
  const wm = new THREE.MeshBasicMaterial({ color: 0xfff4f6, transparent: true, opacity: 0, depthWrite: false, depthFunc: THREE.LessEqualDepth }), list: THREE.SkinnedMesh[] = [];
  hero.model.traverse(o => { const sm = o as THREE.SkinnedMesh; if (sm.isSkinnedMesh && sm.name !== "outline") list.push(sm); });
  const meshes = list.map(sm => { const o = new THREE.SkinnedMesh(sm.geometry, wm); o.bind(sm.skeleton, sm.bindMatrix); o.frustumCulled = false; o.castShadow = false; o.renderOrder = 3; o.visible = false; o.name = "white"; sm.add(o); return o; });
  const W = { mat: wm, meshes, v: 0 }; whites.push(W);
  const a: LabActor = {
    name: s.name, hero, obj: hero.group, height: s.height, radius: s.radius, team: s.team, isHero: s.isHero,
    home: { x: s.x, z: s.z, yaw: s.yaw ?? 0 },
    setPos: (x, z, y = 0) => hero.group.position.set(x, y, z),
    face: yaw => { hero.group.rotation.y = yaw; },
    faceTo: (x, z) => { const p = hero.group.position; hero.group.rotation.y = Math.atan2(x - p.x, z - p.z); },
    play: (clip, o = {}) => hero.play(clip, o),
    setHide: k => { hero.setHide(k); hero.group.visible = k < 0.999; },
    hit: (k = 1) => { hero.hit?.(Math.min(1, k)); if (!NOFX2) W.v = Math.max(W.v, k); },
  };
  return a;
}
function tickWhites(dt: number) {
  for (const W of whites) { if (W.v <= 0) continue; W.v = Math.max(0, W.v - dt / 0.11); const on = W.v > 0.01; W.mat.opacity = 0.92 * Math.pow(W.v, 0.7); for (const m of W.meshes) m.visible = on; }
}

// ---------- 时间、特效、顿帧（照游戏：顿帧时世界时间 ×0.06） ----------
let active: FxHandle[] = [], worldT = 0, stopLeft = 0, speed = num("speed", 1), playing = "";
const ctx: FxCtx = {
  THREE, scene, camera, renderer, lite: LITE,
  ground: () => 0,
  shake, dim, flash,
  hitstop: sec => { if (!NOFX2) stopLeft = Math.max(stopLeft, sec); },
  time: () => worldT,
};

function resetActors() {
  for (const a of actors) { a.setPos(a.home.x, a.home.z); a.setHide(0); a.obj.scale.setScalar(1); a.obj.rotation.set(0, 0, 0); a.obj.visible = true; a.hero.model.rotation.x = 0; a.hero.model.position.set(0, 0, 0); a.play("idle", { fade: 0 }); }
  const cast = actors[0]; if (cast) cast.faceTo(0, 0);
  for (const t of actors.slice(1)) t.faceTo(cast.home.x, cast.home.z);
}
function clearFx() { for (const h of active) { try { h.dispose(); } catch (e) { console.error(e); } } active = []; }
function resetScreen() { stopLeft = 0; sh.t = sh.dur = 0; dimS.on = false; flS.dur = 0; for (const W of whites) W.v = 0; }
function play(name: string) {
  const d: Demo | undefined = DEMOS[name]; if (!d || !actors.length) return false;
  clearFx(); resetActors(); resetScreen(); peakFxCalls = peakFxParticles = 0; worldT = 0; playing = name;
  d.setup?.(ctx, actors[0], actors.slice(1));
  active.push(d.run(ctx, actors[0], actors.slice(1)));
  return true;
}

let baseCalls = 0, lastCalls = 0, lastTris = 0, peakFxCalls = 0, peakFxParticles = 0, fxCalls = 0, fxParticles = 0;
function advance(realDt: number) {
  const rdt = realDt * speed;
  let dt = rdt;
  if (stopLeft > 0) { const r = Math.min(stopLeft, rdt); stopLeft -= r; dt = r * 0.06 + (rdt - r); }
  worldT += dt; realT += rdt; sh.t += rdt;
  tickDim(rdt); tickFlash(rdt); tickWhites(dt);
  const cd = camSpec[0];
  for (const a of actors) a.hero.update(dt, cd);
  for (let i = active.length - 1; i >= 0; i--) {
    let alive = false; try { alive = active[i].update(dt); } catch (e) { console.error(e); }
    if (!alive) { try { active[i].dispose(); } catch (e) { console.error(e); } active.splice(i, 1); }
  }
  placeCam();
  renderer.render(scene, camera);
  lastCalls = renderer.info.render.calls; lastTris = renderer.info.render.triangles;
  if (!active.length) baseCalls = lastCalls;
  const ks = kitStats(); fxCalls = ks.draws + (dimMesh.visible ? 1 : 0) + (flashMesh.visible ? 1 : 0) + whites.reduce((n, W) => n + (W.v > 0.01 ? W.meshes.length : 0), 0); fxParticles = ks.particles;      // 特效的绘制次数：特效网格 + 压暗 + 闪光 + 闪白的蒙皮层
  peakFxCalls = Math.max(peakFxCalls, fxCalls); peakFxParticles = Math.max(peakFxParticles, fxParticles);
}

// ---------- 界面 ----------
const hud = document.getElementById("hud")!, info = document.getElementById("info")!;
function button(label: string, fn: () => void) { const b = document.createElement("button"); b.textContent = label; b.onclick = fn; hud.appendChild(b); return b; }
for (const [k, d] of Object.entries(DEMOS)) button(d.label, () => play(k));
const slow = button("慢放 ×0.25", () => { speed = speed === 1 ? 0.25 : 1; slow.classList.toggle("on", speed !== 1); });
for (const c of ["top", "mid", "close", "side"]) button({ top: "游戏镜头", mid: "中镜头", close: "近镜头", side: "侧面" }[c]!, () => setCam(c));
button(P.get("ground") === "foe" ? "换我方草地" : "换对方红土", () => { const q = new URLSearchParams(location.search); q.set("ground", P.get("ground") === "foe" ? "me" : "foe"); location.search = q.toString(); });

let fpsAcc = 0, fpsN = 0, fps = 0, fpsMin = 999;
function stats() { return { calls: lastCalls, triangles: lastTris, baseCalls, fxCalls, peakFxCalls, fxParticles, peakFxParticles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, programs: renderer.info.programs?.length ?? 0, active: active.length, t: +worldT.toFixed(3), playing, fps: +fps.toFixed(1), fpsMin: +fpsMin.toFixed(1), dim: +dimS.v.toFixed(3) }; }

// ---------- 启动 ----------
(async () => {
  for (const s of SPOTS) { try { actors.push(await makeActor(s)); } catch (e) { console.error("模型没载入", s.file, e); } }
  resetActors();
  const t0 = performance.now(); while (groundLoaded < 9 && performance.now() - t0 < 8000) await new Promise(r => setTimeout(r, 50));
  placeCam(); renderer.render(scene, camera); baseCalls = renderer.info.render.calls;
  await prepareKit(ctx, actors);
  (window as any).__lab = {
    ready: true, play,
    stage: (name: string) => { clearFx(); resetActors(); resetScreen(); DEMOS[name]?.setup?.(ctx, actors[0], actors.slice(1)); },
    step: (dt: number) => { advance(dt); return stats(); }, time: () => worldT, stats, setCam,
    reset: () => { clearFx(); resetActors(); resetScreen(); worldT = 0; playing = ""; },
    resetFps: () => { fpsMin = 999; },
    demos: Object.fromEntries(Object.entries(DEMOS).map(([k, d]) => [k, { label: d.label, duration: d.duration }])),
  };
  const auto = P.get("play"); if (auto) play(auto);
  if (CAP) return;
  let last = performance.now(), loopT = 0;
  const loop = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    fpsAcc += dt; fpsN++; if (fpsAcc > 0.5) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; if (realT > 2) fpsMin = Math.min(fpsMin, fps); }
    if (auto && P.get("loop") === "1" && !active.length) { loopT += dt; if (loopT > 0.8) { loopT = 0; play(auto); } }
    advance(dt);
    const s = stats();
    info.textContent = `${fps.toFixed(0)} 帧/秒   绘制 ${s.calls}（特效 ${s.fxCalls}，峰值 ${s.peakFxCalls}）   粒子 ${s.fxParticles}（峰值 ${s.peakFxParticles}）   ${LITE ? "手机档" : "电脑档"}   t=${s.t.toFixed(2)} ${playing}`;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
})();
