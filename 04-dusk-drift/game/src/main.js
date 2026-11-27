import * as THREE from 'three/webgpu';
import { buildTrack } from './track.js';
import { makeNoise, loadTextures, makeMaterials, WET, SUN, PASS, AMBIENT } from './materials.js';
import { buildWorld } from './world.js';
import { buildDressing } from './dressing.js';
import { setupEnvironment } from './env.js';
import { setupPost } from './post.js';
import { loadCars, setCarEnvNode } from './cars.js';
import { setupProbe } from './probe.js';
import { Effects } from './fx.js';
import { Input } from './input.js';
import { Hud } from './hud.js';
import { Game } from './game.js';
import { ATTRACT_RIVALS } from './carlist.js';

const params = new URLSearchParams(location.search);
export const QUALITY_PRESETS = {
  ultra: { name: 'ultra', pixels: 3.7e6, reflection: 0.5, shadows: 3, shadowRes: 2048, shadowFar: 200, grass: 1, grassDist: 80, traa: true, motionBlur: 12, bloom: true, dof: true, treeMeshDist: 150, ao: 0.5, aoSamples: 14, sharpen: true, fog: 1, probe: 256, probeFaces: 2 },
  high: { name: 'high', pixels: 2.6e6, reflection: 0.5, shadows: 3, shadowRes: 2048, shadowFar: 200, grass: 1, grassDist: 80, traa: true, motionBlur: 12, bloom: true, dof: true, treeMeshDist: 150, ao: 0.5, aoSamples: 10, sharpen: true, fog: 1, probe: 256, probeFaces: 2 },
  medium: { name: 'medium', pixels: 2.1e6, reflection: 0.4, shadows: 2, shadowRes: 2048, shadowFar: 150, grass: 0.6, grassDist: 60, traa: true, motionBlur: 8, bloom: true, dof: true, treeMeshDist: 100, ao: 0.5, aoSamples: 8, sharpen: true, fog: 1, probe: 128, probeFaces: 1 },
  low: { name: 'low', pixels: 1.3e6, reflection: 0.3, shadows: 1, shadowRes: 2048, shadowFar: 110, grass: 0.3, grassDist: 45, traa: false, motionBlur: 0, bloom: true, dof: false, treeMeshDist: 60, ao: 0, aoSamples: 8, sharpen: false, fog: 1, probe: 0, probeFaces: 1 },
};

window.__errors = []; { const oe = console.error; console.error = (...a) => { window.__errors.push(a.map(x => String(x && x.message || x)).join(' ').slice(0, 400)); oe.apply(console, a); }; }
function fatal(e) { const d = document.createElement('pre'); d.style.cssText = 'position:fixed;left:12px;top:12px;right:12px;color:#ff8;background:#000c;padding:12px;font:12px/1.4 monospace;white-space:pre-wrap;z-index:99;pointer-events:auto'; d.textContent = '出错了：\n' + (e && e.stack || e); document.body.appendChild(d); console.error(e); }
window.addEventListener('error', e => fatal(e.error || e.message));
window.addEventListener('unhandledrejection', e => fatal(e.reason));

async function boot() {
  const loading = document.getElementById('loading'), bar = loading.querySelector('i'), note = loading.querySelector('p');
  let done = 0; const total = 21 + 1 + ATTRACT_RIVALS.length + 6; const tickLoad = (label) => { done++; bar.style.width = Math.min(100, done / total * 100) + '%'; if (label) note.textContent = label; };
  if (!navigator.gpu) note.textContent = '当前浏览器不支持 WebGPU，将回退到 WebGL，画面效果会打折扣';

  const quality = { ...QUALITY_PRESETS[params.get('q') || 'high'] };
  for (const [k, v] of params) if (k in quality && k !== 'name') quality[k] = v === 'true' ? true : v === 'false' ? false : +v;
  const canvas = document.getElementById('c');
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  await renderer.init();
  renderer.toneMapping = THREE.NoToneMapping; renderer.toneMappingExposure = +(params.get('exp') || 0.78);
  renderer.shadowMap.enabled = quality.shadows > 0; renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, 1, 0.12, 2400);
  camera.layers.enable(1); camera.layers.enable(3); camera.layers.enable(4);       // 图层：0 通用 / 1 不进倒影（轮胎墙、粒子）/ 2 只投影 / 3 草丛 / 4 树的网格与远景板（仅主画面）/ 5 全部树的公告板（仅倒影与探针）
  const resize = () => {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, Math.sqrt(quality.pixels / (w * h)));
    renderer.setPixelRatio(pr); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  };
  resize(); window.addEventListener('resize', resize);

  const T = buildTrack().buildRacingLine();
  const noise = makeNoise();
  note.textContent = '加载贴图与天空…';
  const [tex, env, carAssets] = await Promise.all([
    loadTextures(['asphalt_track', 'asphalt_02', 'painted_concrete', 'leafy_grass', 'sparse_grass', 'gravel_floor_02', 'concrete_wall_008'], () => tickLoad()),
    setupEnvironment(scene, camera, quality, { sunAz: +(params.get('sun') || -28), sunExtra: params.has('sunx') ? +params.get('sunx') : undefined, envIntensity: params.has('envi') ? +params.get('envi') : undefined }).then(e => { tickLoad('加载车辆…'); return e; }),
    loadCars(['e30', ...ATTRACT_RIVALS], () => tickLoad()),
  ]);
  SUN.dir.value.copy(env.sunDir); PASS.csm = env.csm; AMBIENT.irr = env.ambientIrr;
  const M = makeMaterials(tex, noise, scene, quality); tickLoad('搭建赛道…');
  if (M.reflection) {
    const base = M.reflection.reflector;
    { const vc = base.getVirtualCamera(camera); vc.layers.disable(1); vc.layers.disable(3); vc.layers.disable(4); vc.layers.enable(5); }          // 倒影里不画草丛、粒子、轮胎墙；树用公告板
    {                                                         // 画倒影那一遍：不重画阴影贴图，也不套用主画面的遮蔽贴图
      const orig = base.updateBefore.bind(base), baseCtx = renderer.contextNode;
      base.updateBefore = (f) => {
        if (PASS.pre) return false;                               // 深度预渲染那一遍不更新倒影（返回 false：留给正式那一遍更新）
        const ls = (env.csm && env.csm.lights) || [], cur = renderer.contextNode; for (const l of ls) l.shadow.autoUpdate = false; renderer.contextNode = baseCtx;
        try { return orig(f); } finally { for (const l of ls) l.shadow.autoUpdate = true; renderer.contextNode = cur; }
      };
    }
  }
  const W = buildWorld(T, M, scene, quality); tickLoad();
  if (quality.dressing !== false && quality.dressing !== 0) buildDressing(T, M, scene, W, quality);
  const post = setupPost(renderer, scene, camera, quality); tickLoad();
  const probe = setupProbe(renderer, scene, env, quality); if (probe) setCarEnvNode(probe.envNode);
  const fx = new Effects(scene, noise.tex, env, quality); tickLoad();
  // 车轮处的积水量（0–1）：和路面着色器用同一份噪声
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  T.wetnessXY = (x, y) => sm(WET.pa, WET.pb, noise.puddle(x, -y)) * sm(WET.a, WET.b, noise.wet(x, -y));

  const input = new Input();
  const hud = new Hud(document.getElementById('ui'), T);
  let audio = null;
  try { const mod = await import('./audio.js'); audio = new mod.GameAudio(); } catch (e) { console.warn('audio unavailable', e.message); }
  if (audio && (params.has('test') || params.has('mute'))) audio.muted = true;     // 自动测试时静音（?mute=1 也可以）
  const game = new Game({ scene, camera, T, W, env, post, quality, carAssets, input, hud, audio, fx, renderer, probe });
  if (params.has('auto')) { game.auto = true; game.director.on = true; }      // ?auto=1：开局就是自动驾驶 + 自动切镜（录制用）
  hud.onStart = () => { game.playerSpec = hud.car; game.laps = hud.laps; game.startRace(); };
  try { const mod = await import('./trees.js'); game.trees = await mod.buildTrees(scene, W.treeSpots, quality, env); } catch (e) { console.warn('trees unavailable', e.message); }
  tickLoad('就绪');

  const G = window.G = { THREE, renderer, scene, camera, T, M, W, env, post, probe, quality, game, fx, input, hud, fps: 0, ms: 16, frames: 0 };
  G.view = (s, d, h, ls, ld, lh, fov) => { const p = T.offset(s, d), q = T.offset(ls, ld); camera.position.set(p.x, h, -p.y); camera.lookAt(q.x, lh, -q.y); if (fov) { camera.fov = fov; camera.updateProjectionMatrix(); } };
  let last = performance.now();
  const frame = (dt) => {
    G.frames++;
    if (G.freeCam) { W.update(camera); if (game.trees) game.trees.update(camera); fx.update(dt, camera); }
    else game.update(dt);
    post.pipeline.render();
    if (probe && !G.noProbe) {                                        // 主画面画完再拍探针（下一帧用），每帧更新 quality.probeFaces 个面
      const f = game.focus || game.player, c = f.car;
      probe.update(_pp.set(c.x, 0.95, -c.y), game.entries, quality.probeFaces || 1);
    }
  };
  const _pp = new THREE.Vector3();
  renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000)); last = now;
    G.ms += (dt * 1000 - G.ms) * 0.05; G.fps = 1000 / Math.max(1, G.ms);
    if (!G.paused) frame(dt);
  });
  // 调试：面板不可见时浏览器不触发动画帧，用这两个函数手动推进 / 测速
  const gpuDone = () => renderer.backend.device.queue.onSubmittedWorkDone();
  const manual = (dt) => { const an = renderer._animation; an.info.reset(); an.nodes.nodeFrame.update(); an.info.frame = an.nodes.nodeFrame.frameId; frame(dt); };   // 和渲染器自己的动画循环做同样的帧推进
  G.step = async (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) { manual(dt); if (i % 8 === 7) await gpuDone(); } await gpuDone(); return G.frames; };
  G.bench = async (n = 40) => { await G.step(8); const t0 = performance.now(); for (let i = 0; i < n; i++) { manual(1 / 60); if (i % 4 === 3) await gpuDone(); } await gpuDone(); const ms = (performance.now() - t0) / n; return { ms: +ms.toFixed(2), fps: +(1000 / ms).toFixed(1), calls: renderer.info.render.drawCalls, tris: renderer.info.render.triangles }; };
  // 测试用：自动把车开到 T1 并做一次漂移，停在 stopS 处
  G.driveT1 = async (stopS = 255, entry = 80) => {
    const c = game.player.car, K = input.keys; let hb = 0;
    for (let i = 0; i < 2400; i++) {
      K.clear();
      if (c.s > 1000 || c.s < 150) K.add('KeyW');
      else if (c.s < 208) K.add(c.speed * 3.6 > entry ? 'KeyS' : 'KeyW');
      else { K.add('KeyD'); if (hb < 0.22) { K.add('Space'); hb += 1 / 60; } else K.add('KeyW'); }
      await G.step(1);
      if (c.s >= stopS && c.s < 600) break;
    }
    K.clear(); return { s: +c.s.toFixed(0), d: +c.d.toFixed(1), v: +(c.speed * 3.6).toFixed(0), beta: +(c.beta * 57.3).toFixed(0), smoke: fx.n };
  };
  G.shot = async (name) => { await G.step(1, 0.0001); const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.93)); const res = await fetch('/__shot/' + name + '.jpg', { method: 'PUT', body: blob }); return res.status + ' ' + blob.size; };
  G.keys = (down, up = []) => { for (const c of down) { input.keys.add(c); input.hit.add(c); } for (const c of up) input.keys.delete(c); };

  if (params.has('test')) { document.body.classList.add('notrans'); G.paused = true; }
  await G.step(3);
  if (env.csm && env.csm.lights) for (const l of env.csm.lights) l.shadow.camera.layers.enable(2);     // 第 2 层：只投影不显示的树木公告板
  loading.style.opacity = 0; if (params.has('test')) loading.remove(); else setTimeout(() => loading.remove(), 900);
  console.log('env', JSON.stringify(env.info));
}
boot().catch(fatal);
