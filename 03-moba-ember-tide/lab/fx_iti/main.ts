// 伊缇 · 绯刃 的特效试验页（第四阶段 iti-fx3）。
// 和上一轮（主目录 lab/fx_iti/，Opus 的王者档）不同：这里的特效代码就是游戏里的那一份（src/map/game/fx_iti_core.ts 等），
// 特效库是真的 fxlib（顿帧、镜头抖、点光都是游戏的），屏幕级的演出是真的 fx_iti_screen；主循环照 world/main.ts 的顺序走。
// 人物换成伊缇自己的模型和动作（iti.glb，身高 3.4，带围巾）；近战小兵 1.89 米（游戏里放大 1.3 倍以后的大小）。
//
// 网址参数：
//   play=attack|passive|q|w|e|r|combo   载入后自动播这一段（loop=1 每隔一会儿重放）
//   cam=top|mid|close|side              镜头：top 游戏镜头（27 米、56 度），mid 中镜头（18 米），close 近镜头（12 米）
//                                       也可以写 cam=距离,俯角,转角,看向x,看向y,看向z
//   ground=me|foe                       我方草地 / 对方红土
//   q=lite                              手机档
//   speed=0.25                          慢放
//   nohud=1                             不显示按钮和统计
//   cap=1                               录像模式：时间由 window.__lab.step(dt) 一帧一帧推（tools/rec.mjs 用）
//   noscreen=1                          不挂屏幕级的演出（压暗、打击帧、切入、泛光……），看它们各占多少分量
import * as THREE from "three";
import { TOON_ON, T } from "../../src/map/toon";
import { loadHero } from "../../src/map/hero/hero";
import { glb, LITE } from "../../src/map/quality";
import { createFxLib } from "../../src/map/game/fxlib";
import { createScreenFx } from "../../src/map/game/fx_iti_screen";
import { kitOf, warmIti } from "../../src/map/game/fx_iti_core";
import type { ItiCtx } from "../../src/map/game/fx_iti";
import type { Ent } from "../../src/map/game/sim";
import type { Actor } from "../../src/map/game/actor";
import type { Api } from "../../src/map/game/skills";
import type { Demo, Lab, LabActor } from "./api";
import { DEMOS } from "./fx/demos";

const P = new URLSearchParams(location.search);
const CAP = P.get("cap") === "1";
const num = (k: string, d: number) => (P.has(k) && Number.isFinite(+P.get(k)!) ? +P.get(k)! : d);
if (P.get("nohud") === "1") document.body.classList.add("nohud");

// ---------- 渲染器、调色（照 src/map/world/main.ts 的 B 设置） ----------
const renderer = new THREE.WebGLRenderer({ antialias: !LITE, preserveDrawingBuffer: CAP, powerPreference: "high-performance" });
renderer.setPixelRatio(CAP ? 1 : Math.min(devicePixelRatio, num("dpr", 2)));
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.info.autoReset = false;      // 一帧里要画好几遍（泛光、整屏那一遍），绘制次数自己清零自己数
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
{ const sc = sun.shadow.camera as THREE.OrthographicCamera; sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 1; sc.far = 160; }
const hemi = new THREE.HemisphereLight(0xa4d8f0, 0x8a9a62, T.hemi);
const rim = new THREE.DirectionalLight(0xe8f0ff, 0.5); rim.position.set(0.45, 0.6, 0.8);
scene.add(sun, sun.target, hemi, rim);

// ---------- 地面：游戏里的手绘地面，取 5×3 块（大招范围 11 米加上冲刺要这么宽） ----------
const GROUND = P.get("ground") === "foe" ? { ci: 5, cj: 2 } : { ci: 2, cj: 5 };
let groundLoaded = 0, groundN = 0;
{
  const tl = new THREE.TextureLoader(), geo = new THREE.PlaneGeometry(25, 25).rotateX(-Math.PI / 2);
  for (let dj = -1; dj <= 1; dj++) for (let di = -2; di <= 2; di++) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 }); groundN++;
    tl.load(`/assets/map/ground/c_${Math.max(0, Math.min(7, GROUND.ci + di))}_${GROUND.cj + dj}.webp`, t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; mat.map = t; mat.needsUpdate = true; groundLoaded++; }, undefined, () => { groundLoaded++; });
    const m = new THREE.Mesh(geo, mat); m.position.set(di * 25, 0, dj * 25); m.receiveShadow = true; scene.add(m);
  }
}

// ---------- 特效库和屏幕演出：都是游戏里的那一份 ----------
const fxl = createFxLib({ height: () => 0, waterY: -50 }); scene.add(fxl.group);
const screen = createScreenFx({ renderer, scene, lite: LITE });
if (P.get("noscreen") !== "1") fxl.screen = screen;

// ---------- 镜头（照游戏：距离乘屏幕演出的推拉，位置加镜头抖） ----------
const camera = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, 0.3, 400);
const CAMS: Record<string, [number, number, number, number, number, number]> = { top: [27, 56, 0, 0, 0, 0], close: [12, 48, 0, 0, 1.0, 0], mid: [18, 52, 0, 0, 0.5, 0], side: [16, 12, 0, 0, 1.6, 0] };
let camSpec = CAMS.top;
function setCam(c: string) { if (CAMS[c]) camSpec = CAMS[c]; else { const v = c.split(",").map(Number); if (v.length >= 2 && v.every(Number.isFinite)) camSpec = [v[0], v[1], v[2] ?? 0, v[3] ?? 0, v[4] ?? 0, v[5] ?? 0]; } }
setCam(P.get("cam") ?? "top");
const focus = { on: false, x: 0, z: 0, tx: 0, tz: 0 }, shakeOff = new THREE.Vector3();
function placeCam() {
  const [d0, p, y, tx0, ty, tz0] = camSpec, d = d0 * screen.zoomK(), pr = THREE.MathUtils.degToRad(p), yr = THREE.MathUtils.degToRad(y), h = d * Math.cos(pr), tx = tx0 + focus.x, tz = tz0 + focus.z;
  camera.position.set(tx + Math.sin(yr) * h, ty + d * Math.sin(pr), tz + Math.cos(yr) * h); camera.lookAt(tx, ty, tz);
  camera.position.add(fxl.shakeOffset(shakeOff));
}
function fit() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener("resize", fit);

// ---------- 人 ----------
type Spot = { file: string; dir: "hero" | "unit"; name: string; team: 0 | 1; height: number; radius: number; isHero: boolean; x: number; z: number; look?: Record<string, number> };
const MINION = { lift: 1.2, sat: 1.05, fill: 0.36, rim: 0.6 };
const SPOTS: Spot[] = [
  { file: "iti", dir: "hero", name: "伊缇", team: 0, height: 3.4, radius: 0.7, isHero: true, x: -6, z: 2, look: { scarf: 1 } },
  { file: "moko", dir: "hero", name: "摩珂", team: 1, height: 3.3, radius: 0.7, isHero: true, x: 3, z: -1 },
  { file: "torg", dir: "hero", name: "托尔格", team: 1, height: 2.8, radius: 0.8, isHero: true, x: -3, z: 2, look: { ring: 1.7, lift: 1.05, sat: 1.6 } },
  { file: "seren", dir: "hero", name: "塞伦", team: 1, height: 3.3, radius: 0.7, isHero: true, x: 0, z: -4 },
  ...[0, 1, 2, 3, 4].map(i => ({ file: "melee", dir: "unit" as const, name: "近战兵", team: 1 as const, height: 1.89, radius: 0.45, isHero: false, x: 4 + i, z: 4, look: MINION })),      // 小兵身高 1.89：游戏里放大 1.3 倍以后的近战兵
];
const actors: LabActor[] = [], byId = new Map<number, LabActor>();
async function makeActor(s: Spot, id: number): Promise<LabActor> {
  const hero = await loadHero(glb(s.dir, s.file), s.team, { height: s.height, ...(s.look ?? {}) });
  scene.add(hero.group);
  hero.tag?.(s.isHero ? s.name : "", () => s.team === 0);
  hero.setLife(s.team === 0 ? 1 : 0.72, s.isHero ? 2400 : 500, s.isHero ? 9 : 0);
  if (!s.isHero) hero.group.traverse(o => { if ((o as THREE.Mesh).isMesh) o.castShadow = false; });
  const ent = { id, kind: s.isHero ? "hero" : "melee", team: s.team, x: s.x, z: s.z, r: s.radius, hp: 1, max: 1, alive: true, seen: true, big: false, yaw: 0 } as unknown as Ent;
  const a: LabActor = {
    name: s.name, ent, hero, obj: hero.group, height: s.height, radius: s.radius, isHero: s.isHero, home: { x: s.x, z: s.z },
    setPos: (x, z, y = 0) => { hero.group.position.set(x, y, z); ent.x = x; ent.z = z; },
    face: yaw => { hero.group.rotation.y = yaw; },
    faceTo: (x, z) => { const p = hero.group.position; hero.group.rotation.y = Math.atan2(x - p.x, z - p.z); },
    play: (clip, o = {}) => { hero.play(clip, o); if (o.at) { const c = hero.clips.get(clip); if (c) hero.mixer.clipAction(c).time = o.at; } },
    setHide: k => { hero.group.visible = k < 0.999; },
  };
  return a;
}

// ---------- 假的技能上下文：特效只用到这几样 ----------
let worldT = 0;
const tmp = new THREE.Vector3();
const actorOf = (a: LabActor) => ({ ent: a.ent, hero: a.hero, pos: a.hero.group.position, data: {},
  hand: (out: THREE.Vector3, side: "Left" | "Right" = "Right") => { const b = a.hero.bone(side + "Hand"); if (b) b.getWorldPosition(out); else out.copy(a.hero.group.position).setY(a.hero.group.position.y + 1.4); return out; },
  chest: (out: THREE.Vector3) => out.copy(a.hero.group.position).setY(a.hero.group.position.y + a.height * 0.55) }) as unknown as Actor;
const fakeActors = new Map<number, Actor>();
const api = { ground: () => 0, height: () => 0, time: () => worldT, fx: fxl, actor: (e: Ent) => fakeActors.get(e.id) } as unknown as Api;
let ctx: ItiCtx;

// ---------- 演示脚本的时间轴（对局时间：顿帧跟着停） ----------
let events: { t: number; fn: () => void }[] = [], tweens: { t0: number; dur: number; fn: (k: number) => void; done: boolean }[] = [], playing = "", playEnd = 0;
const lab: Lab = {
  get c() { return ctx; }, get cast() { return actors[0]; }, get targets() { return actors.slice(1); }, lite: LITE,
  at(t, fn) { events.push({ t, fn }); events.sort((a, b) => a.t - b.t); },
  tween(t0, dur, fn) { tweens.push({ t0, dur, fn, done: false }); },
  follow(on, x = 0, z = 0) { focus.on = on; if (!on) { focus.tx = x; focus.tz = z; } },
} as Lab;
function resetActors() {
  for (const a of actors) { a.setPos(a.home.x, a.home.z); a.setHide(0); a.obj.rotation.set(0, 0, 0); a.hero.model.rotation.set(0, 0, 0); a.hero.model.position.set(0, 0, 0); a.play("idle", { fade: 0 }); }
  const cast = actors[0]; if (cast) { cast.faceTo(0, 0); for (const t of actors.slice(1)) t.faceTo(cast.home.x, cast.home.z); }
}
function clearAll() { events = []; tweens = []; kitOf(ctx).clear(); screen.reset(); focus.on = false; focus.x = focus.z = focus.tx = focus.tz = 0; }
function stage(name: string) { const d: Demo | undefined = DEMOS[name]; if (!d || !actors.length) return false; clearAll(); resetActors(); d.setup?.(lab); if (focus.on) { focus.x = actors[0].obj.position.x; focus.z = actors[0].obj.position.z; } else { focus.x = focus.tx; focus.z = focus.tz; } return true; }
function play(name: string) {
  const d: Demo | undefined = DEMOS[name]; if (!stage(name)) return false;
  peak = { calls: 0, fx: 0, particles: 0, passes: 0 }; worldT = 0; playing = name; playEnd = d!.duration; d!.run(lab); return true;
}

// ---------- 一帧：顺序照游戏的主循环（world/main.ts） ----------
let speed = num("speed", 1), realT = 0, peak = { calls: 0, fx: 0, particles: 0, passes: 0 }, last = { calls: 0, sceneCalls: 0, tris: 0, fx: 0, particles: 0, passes: 0, on: "" };
function advance(realDt: number) {
  const rdt = realDt * speed; realT += rdt;
  screen.update(rdt);                                    // 屏幕演出按真实时间走
  const sdt = rdt * fxl.timeScale(rdt);                   // 顿帧：对局时间乘 0.06
  const to = worldT + sdt;
  while (events.length && events[0].t <= to) { const e = events.shift()!; try { e.fn(); } catch (err) { console.error(err); } }
  worldT = to;
  for (const tw of tweens) { if (tw.done || worldT < tw.t0) continue; const k = Math.min(1, (worldT - tw.t0) / Math.max(tw.dur, 1e-4)); try { tw.fn(k); } catch (err) { console.error(err); } if (k >= 1) tw.done = true; }
  for (const a of actors) a.hero.update(sdt, camSpec[0]);
  fxl.update(sdt);                                        // 里面会推伊缇的零件库（fx.tick）
  if (focus.on) { const p = actors[0].obj.position, k = 1 - Math.exp(-rdt * 16); focus.x += (p.x - focus.x) * k; focus.z += (p.z - focus.z) * k; }      // 镜头跟人：和游戏一个时间常数
  else { const k = 1 - Math.exp(-rdt * 5); focus.x += (focus.tx - focus.x) * k; focus.z += (focus.tz - focus.z) * k; }
  placeCam();
  renderer.info.reset();
  renderer.setRenderTarget(null); renderer.render(scene, camera);
  const sceneCalls = renderer.info.render.calls;
  screen.post(camera);
  const ks = kitOf(ctx).stats(), ss = screen.stats();
  last = { calls: renderer.info.render.calls, sceneCalls, tris: renderer.info.render.triangles, fx: ks.draws + ss.passes + (/dim/.test(ss.on) ? 1 : 0), particles: ks.particles, passes: ss.passes, on: ss.on };
  peak.calls = Math.max(peak.calls, last.calls); peak.fx = Math.max(peak.fx, last.fx); peak.particles = Math.max(peak.particles, last.particles); peak.passes = Math.max(peak.passes, last.passes);
}

// ---------- 界面 ----------
const hud = document.getElementById("hud")!, info = document.getElementById("info")!;
function button(label: string, fn: () => void) { const b = document.createElement("button"); b.textContent = label; b.onclick = fn; hud.appendChild(b); return b; }
for (const [k, d] of Object.entries(DEMOS)) button(d.label, () => play(k));
const slow = button("慢放 ×0.25", () => { speed = speed === 1 ? 0.25 : 1; slow.classList.toggle("on", speed !== 1); });
for (const c of ["top", "mid", "close", "side"]) button({ top: "游戏镜头", mid: "中镜头", close: "近镜头", side: "侧面" }[c]!, () => setCam(c));
button(P.get("ground") === "foe" ? "换我方草地" : "换对方红土", () => { const q = new URLSearchParams(location.search); q.set("ground", P.get("ground") === "foe" ? "me" : "foe"); location.search = q.toString(); });

let fpsAcc = 0, fpsN = 0, fps = 0, fpsMin = 999;
function stats() { const ks = ctx ? kitOf(ctx).stats() : null; return { ...last, peakCalls: peak.calls, peakFx: peak.fx, peakParticles: peak.particles, peakPasses: peak.passes, kit: ks, t: +worldT.toFixed(3), playing, fps: +fps.toFixed(1), fpsMin: +fpsMin.toFixed(1), zoom: +screen.zoomK().toFixed(3), programs: renderer.info.programs?.length ?? 0 }; }

// ---------- 启动 ----------
(async () => {
  for (let i = 0; i < SPOTS.length; i++) { try { const a = await makeActor(SPOTS[i], i + 1); actors.push(a); byId.set(a.ent.id, a); fakeActors.set(a.ent.id, actorOf(a)); } catch (e) { console.error("模型没载入", SPOTS[i].file, e); } }
  ctx = { me: actors[0].ent, a: fakeActors.get(actors[0].ent.id)!, api, fx: fxl };
  resetActors();
  const t0 = performance.now(); while (groundLoaded < groundN && performance.now() - t0 < 8000) await new Promise(r => setTimeout(r, 50));
  warmIti(ctx); screen.keep(fxl.group);      // 残影池、贴图先备好；游戏里别的特效（fxlib 的不透明小模型）也不跟着压暗
  placeCam(); renderer.render(scene, camera);
  await new Promise(r => setTimeout(r, 300));
  renderer.compile(scene, camera);
  (window as any).__lab = {
    ready: true, play, stage,
    step: (dt: number) => { advance(dt); return stats(); }, time: () => worldT, stats, setCam,
    reset: () => { clearAll(); resetActors(); worldT = 0; playing = ""; },
    resetFps: () => { fpsMin = 999; },
    demos: Object.fromEntries(Object.entries(DEMOS).map(([k, d]) => [k, { label: d.label, duration: d.duration }])),
  };
  (window as any).__fx = fxl; (window as any).__screen = screen; (window as any).__ctx = ctx; void tmp; void byId;
  const auto = P.get("play"); if (auto) play(auto);
  if (CAP) return;
  let lastT = performance.now(), loopT = 0;
  const loop = (now: number) => {
    const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
    fpsAcc += dt; fpsN++; if (fpsAcc > 0.5) { fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; if (realT > 2) fpsMin = Math.min(fpsMin, fps); }
    if (auto && P.get("loop") === "1" && worldT > playEnd) { loopT += dt; if (loopT > 0.8) { loopT = 0; play(auto); } }
    advance(dt);
    info.textContent = `${fps.toFixed(0)} 帧/秒   绘制 ${last.calls}（场景 ${last.sceneCalls}，特效 ${last.fx}，峰值 ${peak.fx}）   粒子 ${last.particles}（峰值 ${peak.particles}）   ${LITE ? "手机档" : "电脑档"}   t=${worldT.toFixed(2)} ${playing}   ${last.on}`;
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
})();
