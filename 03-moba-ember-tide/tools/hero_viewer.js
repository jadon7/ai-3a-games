// 动作预览页里的 3D 查看器（阶段 3.2）。由 tools/page_32.py 内联进验收页。
// 画面处理和游戏里一样（见 src/map/hero/hero.ts）：提亮、补光、边缘光、青色纹路自发光、头和手放大。
// 网址参数（截图检查用）：?a=动作名&t=秒&view=close|game|front|side&ui=0
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const Q = new URLSearchParams(location.search);
const CFG = window.HERO_VIEW;                                  // 页面里给的：模型地址、动作清单
const stage = document.getElementById('stage'), canvas = document.getElementById('view'), note = document.getElementById('stage-note');
if (Q.get('ui') === '0') document.documentElement.classList.add('bare');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x14181d); scene.fog = new THREE.Fog(0x14181d, 26, 60);
const sunDir = new THREE.Vector3(-0.7, 0.72, -0.3).normalize();
const sun = new THREE.DirectionalLight(0xfff0d6, 3.0); sun.position.copy(sunDir).multiplyScalar(40); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; sun.shadow.radius = 2.2;
Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 90 }); sun.shadow.camera.updateProjectionMatrix();
const rimL = new THREE.DirectionalLight(0xe8f0ff, 0.5); rimL.position.set(0.45, 0.6, 0.8);
scene.add(sun, sun.target, new THREE.HemisphereLight(0xcfe2ff, 0x7f8a5c, 1.4), rimL);

// 地面：一块石色的圆台，边缘淡出到背景里；脚下一个队伍色的细圈
{
  const cv = document.createElement('canvas'); cv.width = cv.height = 256; const c = cv.getContext('2d');
  const g = c.createRadialGradient(128, 128, 30, 128, 128, 128); g.addColorStop(0, '#fff'); g.addColorStop(0.55, '#fff'); g.addColorStop(1, '#000'); c.fillStyle = g; c.fillRect(0, 0, 256, 256);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(16, 72), new THREE.MeshStandardMaterial({ color: 0x7a7f6c, roughness: 1, alphaMap: new THREE.CanvasTexture(cv), transparent: true }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.82, 0.88, 64), new THREE.MeshBasicMaterial({ color: 0x6dff9a, transparent: true, opacity: 0.8, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.02; scene.add(ring);
  const grid = new THREE.GridHelper(12, 12, 0x000000, 0x000000); grid.material.transparent = true; grid.material.opacity = 0.10; grid.position.y = 0.01; scene.add(grid);      // 一米一格，看脚滑不滑
}

const camera = new THREE.PerspectiveCamera(34, 1, 0.3, 200);
const controls = new OrbitControls(camera, canvas); controls.enableDamping = true; controls.minDistance = 3; controls.maxDistance = 30; controls.maxPolarAngle = Math.PI * 0.49; controls.enablePan = false;
const VIEWS = { close: [9.5, 14, 30, 1.35], game: [20, 56, 0, 0.9], front: [10, 6, 0, 1.3], side: [10, 6, 90, 1.3], back: [10, 14, 180, 1.3], wide: [15, 16, 32, 1.3], wside: [15, 6, 90, 1.3] };      // wide、wside：四足的大个子用，拉远一点      // 距离、俯角、水平角、看向的高度
function setView(name) {
  const [d, p, y, h] = VIEWS[name] ?? VIEWS.close, pr = THREE.MathUtils.degToRad(p), yr = THREE.MathUtils.degToRad(y);
  controls.target.set(0, h, 0); camera.position.set(Math.sin(yr) * Math.cos(pr) * d, h + Math.sin(pr) * d, Math.cos(yr) * Math.cos(pr) * d); controls.update();
  document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === name)));
}
function fit() { const w = stage.clientWidth, h = stage.clientHeight; renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
new ResizeObserver(fit).observe(stage); fit(); setView(Q.get('view') ?? 'close');

function tune(mat, weapon) {
  const L = CFG.look; mat.metalness = L.metal; mat.roughness = 1; mat.envMapIntensity = 0; mat.normalScale.setScalar(L.bump);
  const u = { uRim: { value: new THREE.Color(0.62, 0.9, 1.0).multiplyScalar(L.rim) }, uGlow: { value: 1 }, uLift: { value: L.lift }, uSat: { value: L.sat }, uFill: { value: L.fill } };
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.fragmentShader = ('uniform vec3 uRim; uniform float uGlow, uLift, uSat, uFill;\n' + sh.fragmentShader)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float glow_ = smoothstep(0.10, 0.34, min(diffuseColor.g, diffuseColor.b) - diffuseColor.r * 1.2);
        { vec3 c_ = diffuseColor.rgb; float l_ = dot(c_, vec3(0.3, 0.55, 0.15)); c_ = mix(vec3(l_), c_, uSat); c_ = c_ * uLift + (uLift - 1.0) * 0.06 * (1.0 - l_); diffuseColor.rgb = c_; }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * glow_ * uGlow * 2.2;`)
      .replace('#include <opaque_fragment>', `{ vec3 n_ = normalize(nonPerturbedNormal), v_ = normalize(vViewPosition);
          float fr_ = pow(1.0 - clamp(dot(n_, v_), 0.0, 1.0), 3.0);
          outgoingLight += diffuseColor.rgb * uFill * (0.35 + 0.65 * clamp(dot(n_, normalize(vec3(0.35, 0.55, 0.76))), 0.0, 1.0));
          outgoingLight += uRim * fr_ * (0.25 + 0.75 * clamp(n_.y * 0.7 + 0.45, 0.0, 1.0)) * ${weapon ? '0.7' : '1.0'}; }
        #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'hero' + (weapon ? 'w' : 'b'); mat.needsUpdate = true;
}

async function loadModel(url) {
  const res = await fetch(url); if (!res.ok) throw new Error('模型没取到：' + res.status);
  let buf;
  if (url.endsWith('.txt')) { const bin = atob((await res.text()).trim()); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); buf = a.buffer; }      // Artifact 不能直接放 .glb，模型以 base64 文本发布
  else buf = await res.arrayBuffer();
  return new Promise((ok, bad) => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parse(buf, '', ok, bad));
}

let mixer = null, cur = null, curId = '', paused = false, repeatTimer = 0;
const acts = new Map(), clock = new THREE.Clock();
let fixedT = Q.has('t') ? Number(Q.get('t')) : null;
window.__pose = (id, t, view) => { if (id !== curId) play(id, 0); fixedT = t; if (view) setView(view); };      // 检查用：把某段动作定在第 t 秒
const video = document.getElementById('ref'), vidWrap = document.getElementById('ref-wrap'), info = document.getElementById('act-info');

function play(id, fade = 0.18) {
  const a = acts.get(id); if (!a) return;
  clearTimeout(repeatTimer); const meta = CFG.actions.find(x => x.id === id) ?? { loop: true };
  a.reset(); a.setLoop(meta.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); a.clampWhenFinished = !meta.loop; a.timeScale = Number(document.getElementById('speed')?.value ?? 1);
  if (cur && cur !== a) { if (fade > 0) a.crossFadeFrom(cur, fade, false); else cur.stop(); } a.play(); cur = a; curId = id;
  document.querySelectorAll('[data-act]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.act === id)));
  if (info) info.textContent = meta.note ?? '';
  if (video) { if (meta.video) { vidWrap.hidden = false; if (!video.src.endsWith(meta.video)) video.src = meta.video; video.currentTime = 0; video.play().catch(() => {}); } else vidWrap.hidden = true; }
}

loadModel(Q.get('model') ?? CFG.model).then(gltf => {
  const model = gltf.scene, box = new THREE.Box3().setFromObject(model); model.scale.setScalar(CFG.look.height / (box.max.y - box.min.y));
  model.traverse(o => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; tune(o.material, o.material.name.startsWith('weapon')); }
    if (o.isBone) { if (/Head$/.test(o.name)) o.scale.setScalar(CFG.look.head); if (/(Left|Right)Hand$/.test(o.name)) o.scale.setScalar(CFG.look.hand); }
  });
  scene.add(model); mixer = new THREE.AnimationMixer(model); window.__model = model;
  for (const c of gltf.animations) acts.set(c.name, mixer.clipAction(c));
  mixer.addEventListener('finished', () => {                    // 一次性的动作播完：回到待机，停一下再播一遍
    const back = acts.has('idle') ? 'idle' : 'idle_pose', id = curId; play(back, 0.25);
    if (document.getElementById('repeat')?.checked !== false && fixedT == null) repeatTimer = setTimeout(() => play(id, 0.15), 900);
  });
  const bar = document.getElementById('acts');
  for (const a of CFG.actions) {
    if (!acts.has(a.id)) continue;
    const b = document.createElement('button'); b.type = 'button'; b.dataset.act = a.id; b.textContent = a.label; b.onclick = () => play(a.id); bar?.appendChild(b);
  }
  play(Q.get('a') ?? (acts.has('idle') ? 'idle' : [...acts.keys()][0]), 0);
  if (note) note.hidden = true;
  window.__stats = { clips: gltf.animations.map(c => [c.name, +c.duration.toFixed(2)]) };
  let n = 0;
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    if (fixedT != null) { cur.paused = false; mixer.setTime(0); cur.time = Math.min(fixedT, cur.getClip().duration - 1e-4); mixer.update(0); }
    else if (!paused) mixer.update(dt);
    controls.update(); renderer.render(scene, camera);
    if (++n > 4) window.__ready = true;
  });
}).catch(e => { if (note) note.textContent = '模型没有载入：' + e.message; console.error(e); window.__ready = true; });

document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
document.getElementById('speed')?.addEventListener('change', e => { if (cur) cur.timeScale = Number(e.target.value); if (video) video.playbackRate = Number(e.target.value); });
document.getElementById('pause')?.addEventListener('click', e => { paused = !paused; e.currentTarget.setAttribute('aria-pressed', String(paused)); e.currentTarget.textContent = paused ? '继续' : '暂停'; if (video) paused ? video.pause() : video.play().catch(() => {}); });
