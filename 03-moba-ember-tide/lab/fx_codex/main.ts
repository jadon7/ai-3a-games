// 伊缇 · 绯刃 的特效试验页（第二阶段 iti-fx）。场景照游戏搭：画风 B 的光照和调色（直接用游戏的 src/map/toon.ts）、
// 游戏的镜头（透视 34 度，俯视 56 度、27 米；近镜头 12 米）、B 的地面贴图、游戏的英雄着色（src/map/hero/hero.ts 的 loadHero）。
// 特效写在 fx/ 下面，fx/index.ts 导出 DEMOS（每段演示一个函数），这里只负责场景、时间和录像接口。
//
// 网址参数：
//   play=r|passive|marks   载入后自动播这一段（loop=1 每隔几秒重放）
//   cam=top|mid|close|side  镜头：top 游戏镜头（27 米、56 度），mid 中镜头（18 米、52 度，R 用），close 近镜头（12 米、48 度，被动用），side 侧面平视（调试用）
//                           也可以写 cam=距离,俯角,转角,看向x,看向y,看向z
//   ground=me|foe           地面：me 我方草地加石板路，foe 对方红土加石板路
//   q=lite                  手机档（特效模块拿到 ctx.lite = true）
//   speed=0.25              慢放
//   nohud=1                 不显示按钮和左下角的统计
//   cap=1                   录像模式：不自己走时间，由 window.__lab.step(dt) 一帧一帧推（tools/rec.mjs 用）
//
// window.__lab：ready、play(名字)、step(dt)、time()、stats()、reset()、setCam(名字)
import * as THREE from "three";
import { TOON_ON, T } from "../../src/map/toon";
import { loadHero, type Hero } from "../../src/map/hero/hero";
import { glb, LITE } from "../../src/map/quality";
import type { Demo, FxCtx, FxHandle, LabActor } from "./api";
import { prepareGhosts } from "./fx/blade";
import { warmPaint } from "./fx/paint";
import { DEMOS } from "./fx/index";

const P = new URLSearchParams(location.search);
const CAP = P.get("cap") === "1";
const num = (k: string, d: number) => (P.has(k) && Number.isFinite(+P.get(k)!) ? +P.get(k)! : d);
if (P.get("nohud") === "1") document.body.classList.add("nohud");

// ---------- 渲染器、调色（照 src/map/world/main.ts 的 B 设置） ----------
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

// ---------- 光（照游戏：太阳在左后方，天光偏冷青，一盏弱的冷色轮廓光） ----------
const sunDir = new THREE.Vector3(-0.7, 0.72, -0.3).normalize();
const sun = new THREE.DirectionalLight(new THREE.Color(0xffffff).lerp(new THREE.Color(0xffe2b8), T.warm), T.sun);
sun.position.copy(sunDir).multiplyScalar(60); sun.target.position.set(0, 0, 0);
sun.castShadow = true; sun.shadow.mapSize.set(LITE ? 2048 : 4096, LITE ? 2048 : 4096); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; sun.shadow.radius = LITE ? 1.6 : 3.2;
{ const sc = sun.shadow.camera as THREE.OrthographicCamera; sc.left = -26; sc.right = 26; sc.top = 26; sc.bottom = -26; sc.near = 1; sc.far = 160; }
const hemi = new THREE.HemisphereLight(0xa4d8f0, 0x8a9a62, T.hemi);
const rim = new THREE.DirectionalLight(0xe8f0ff, 0.5); rim.position.set(0.45, 0.6, 0.8);
scene.add(sun, sun.target, hemi, rim);

// ---------- 地面：游戏的 B 地面贴图，3×3 块（每块 25 米），特效中心在中间那块的正中 ----------
const GROUND = P.get("ground") === "foe" ? { ci: 5, cj: 2 } : { ci: 2, cj: 5 };
{
  const tl = new THREE.TextureLoader(), geo = new THREE.PlaneGeometry(25, 25).rotateX(-Math.PI / 2);
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
    tl.load(`/assets/map/ground/c_${GROUND.ci + di}_${GROUND.cj + dj}.webp`, t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; mat.map = t; mat.needsUpdate = true; groundLoaded++; });
    const m = new THREE.Mesh(geo, mat); m.position.set(di * 25, 0, dj * 25); m.receiveShadow = true; scene.add(m);
  }
}
let groundLoaded = 0;

// ---------- 镜头（照游戏：位置 = 看向点 + (sin 转角·水平距离, 距离·sin 俯角, cos 转角·水平距离)） ----------
const camera = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, 0.3, 400);
const CAMS: Record<string, [number, number, number, number, number, number]> = {
  top: [27, 56, 0, 0, 0, 0],        // 游戏镜头
  close: [12, 48, 0, 0, 1.0, 0],    // 近镜头（被动：一个目标）
  mid: [18, 52, 0, 0, 0.5, 0],      // 中镜头（R：6 米范围整个框进来）
  side: [16, 12, 0, 0, 1.6, 0],     // 侧面平视（调试用）
};
let camSpec = CAMS.top;
function setCam(c: string) {
  if (CAMS[c]) camSpec = CAMS[c];
  else { const v = c.split(",").map(Number); if (v.length >= 2 && v.every(Number.isFinite)) camSpec = [v[0], v[1], v[2] ?? 0, v[3] ?? 0, v[4] ?? 0, v[5] ?? 0]; }
}
setCam(P.get("cam") ?? "top");
const shakeS = { amp: 0, dur: 0, t: 0 };
function placeCam() {
  const [d, p, y, tx, ty, tz] = camSpec, pr = THREE.MathUtils.degToRad(p), yr = THREE.MathUtils.degToRad(y), h = d * Math.cos(pr);
  camera.position.set(tx + Math.sin(yr) * h, ty + d * Math.sin(pr), tz + Math.cos(yr) * h); camera.lookAt(tx, ty, tz);
  if (shakeS.t < shakeS.dur) { const k = shakeS.amp * (1 - shakeS.t / shakeS.dur); camera.position.add(new THREE.Vector3(Math.sin(shakeS.t * 91.7) * k, Math.sin(shakeS.t * 77.3 + 1.3) * k * 0.6, Math.sin(shakeS.t * 83.1 + 2.1) * k)); }
}
function fit() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener("resize", fit);

// ---------- 人：占位的伊缇（岚的模型）和靶子 ----------
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
async function makeActor(s: Spot): Promise<LabActor> {
  const hero: Hero = await loadHero(glb(s.dir, s.file), s.team, { height: s.height, ...(s.look ?? {}) });
  scene.add(hero.group);
  const self = s.team === 0;
  hero.tag?.(s.isHero ? s.name : "", () => self);
  hero.setLife(s.team === 0 ? 1 : 0.72, s.isHero ? 2400 : 500, s.isHero ? 9 : 0);
  if (!s.isHero) hero.group.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = false; });
  const a: LabActor = {
    name: s.name, hero, obj: hero.group, height: s.height, radius: s.radius, team: s.team, isHero: s.isHero,
    home: { x: s.x, z: s.z, yaw: s.yaw ?? 0 },
    setPos: (x, z) => hero.group.position.set(x, 0, z),
    face: yaw => { hero.group.rotation.y = yaw; },
    faceTo: (x, z) => { const p = hero.group.position; hero.group.rotation.y = Math.atan2(x - p.x, z - p.z); },
    play: (clip, o = {}) => hero.play(clip, o),
    setHide: k => { hero.setHide(k); hero.group.visible = k < 0.999; },
    hit: k => hero.hit?.(k ?? 1),
  };
  return a;
}

// ---------- 时间、特效、顿帧 ----------
let active: FxHandle[] = [], worldT = 0, hitstopLeft = 0, speed = num("speed", 1), playing = "";
const ctx: FxCtx = {
  THREE, scene, camera, renderer, lite: LITE,
  onFxDraw(particles) { fxCalls++; fxParticles += particles; },
  ground: () => 0,
  shake: (amp, dur) => { if (amp >= shakeS.amp * (1 - shakeS.t / Math.max(shakeS.dur, 1e-3))) { shakeS.amp = amp; shakeS.dur = dur; shakeS.t = 0; } },
  hitstop: sec => { hitstopLeft = Math.max(hitstopLeft, sec); },
  time: () => worldT,
};

function resetActors() {
  for (const a of actors) { a.setPos(a.home.x, a.home.z); a.setHide(0); a.obj.scale.setScalar(1); a.obj.visible = true; a.play("idle", { fade: 0 }); }
  const cast = actors[0]; if (cast) cast.faceTo(0, 0);
  for (const t of actors.slice(1)) t.faceTo(cast.home.x, cast.home.z);
}
function clearFx() { for (const h of active) { try { h.dispose(); } catch (e) { console.error(e); } } active = []; }
function play(name: string) {
  const d: Demo | undefined = (DEMOS as Record<string, Demo>)[name]; if (!d || !actors.length) return false;
  clearFx(); resetActors(); peakFxCalls = peakFxParticles = 0; worldT = 0; hitstopLeft = 0; shakeS.t = shakeS.dur = 0; playing = name;
  d.setup?.(ctx, actors[0], actors.slice(1));
  active.push(d.run(ctx, actors[0], actors.slice(1)));
  return true;
}

let baseCalls = 0, lastCalls = 0, lastTris = 0, peakFxCalls = 0, fxCalls = 0, fxParticles = 0, peakFxParticles = 0;
function advance(realDt: number) {
  let dt = realDt * speed;
  if (hitstopLeft > 0) { const real = Math.min(hitstopLeft, dt); hitstopLeft -= real; dt = real * 0.08 + (dt - real); }
  worldT += dt;
  shakeS.t += realDt;
  const cd = camSpec[0];
  for (const a of actors) a.hero.update(dt, cd);
  for (let i = active.length - 1; i >= 0; i--) {
    let alive = false; try { alive = active[i].update(dt); } catch (e) { console.error(e); }
    if (!alive) { try { active[i].dispose(); } catch (e) { console.error(e); } active.splice(i, 1); }
  }
  placeCam();
  fxCalls = fxParticles = 0;
  renderer.render(scene, camera);
  lastCalls = renderer.info.render.calls; lastTris = renderer.info.render.triangles;
  if (!active.length) baseCalls = lastCalls;
  peakFxCalls = Math.max(peakFxCalls, fxCalls); peakFxParticles = Math.max(peakFxParticles, fxParticles);
}

// ---------- 界面 ----------
const hud = document.getElementById("hud")!, info = document.getElementById("info")!;
function button(label: string, fn: () => void) { const b = document.createElement("button"); b.textContent = label; b.onclick = fn; hud.appendChild(b); return b; }
for (const [k, d] of Object.entries(DEMOS as Record<string, Demo>)) button(d.label, () => { peakFxCalls = 0; play(k); });
const slow = button("慢放 ×0.25", () => { speed = speed === 1 ? 0.25 : 1; slow.classList.toggle("on", speed !== 1); });
for (const c of ["top", "mid", "close", "side"]) button({ top: "游戏镜头", mid: "中镜头", close: "近镜头", side: "侧面" }[c]!, () => setCam(c));
button(P.get("ground") === "foe" ? "换我方草地" : "换对方红土", () => { const q = new URLSearchParams(location.search); q.set("ground", P.get("ground") === "foe" ? "me" : "foe"); location.search = q.toString(); });

let fpsAcc = 0, fpsN = 0, fps = 0;
function stats() { return { calls: lastCalls, triangles: lastTris, baseCalls, fxCalls, peakFxCalls, fxParticles, peakFxParticles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, programs: renderer.info.programs?.length ?? 0, active: active.length, t: +worldT.toFixed(3), playing }; }

// ---------- 启动 ----------
(async () => {
  for (const s of SPOTS) { try { actors.push(await makeActor(s)); } catch (e) { console.error("模型没载入", s.file, e); } }
  resetActors();
  // 等地面贴图（最多 8 秒）
  const t0 = performance.now(); while (groundLoaded < 9 && performance.now() - t0 < 8000) await new Promise(r => setTimeout(r, 50));
  placeCam(); renderer.render(scene, camera); baseCalls = renderer.info.render.calls;
  prepareGhosts(actors[0]); await warmPaint(ctx);
  (window as any).__lab = {
    ready: true, play, stage: (name: string) => { clearFx(); resetActors(); DEMOS[name]?.setup?.(ctx, actors[0], actors.slice(1)); }, step: (dt: number) => { advance(dt); return stats(); }, time: () => worldT, stats, reset: () => { clearFx(); resetActors(); worldT = 0; playing = ""; }, setCam,
    demos: Object.fromEntries(Object.entries(DEMOS as Record<string, Demo>).map(([k, d]) => [k, { label: d.label, duration: d.duration }])),
  };
  const auto = P.get("play"); if (auto) play(auto);
  if (CAP) return;
  let last = performance.now(), loopT = 0;
  const loop = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    fpsAcc += dt; fpsN++; if (fpsAcc > 0.5) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
    if (auto && P.get("loop") === "1" && !active.length) { loopT += dt; if (loopT > 1.2) { loopT = 0; play(auto); } }
    advance(dt);
    const s = stats();
    info.textContent = `${fps.toFixed(0)} 帧/秒   绘制 ${s.calls}（特效 ${s.fxCalls}，峰值 ${s.peakFxCalls}）   三角形 ${s.triangles}   ${LITE ? "手机档" : "电脑档"}   t=${s.t.toFixed(2)} ${playing}`;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
})();
