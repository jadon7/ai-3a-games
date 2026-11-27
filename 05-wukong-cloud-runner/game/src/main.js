// 筋斗云驾驶模拟器 —— 主程序：装配各模块，跑游戏循环。
// 测试/截图用的 URL 参数：?shot=1&t=秒&state=play|title&auto=1&cammode=chase|close|side|hero|flyby|aerial&hud=0&lb=1&q=low|high|ultra
import * as THREE from 'three';
import { createApp } from './app.js';
import { createPost } from './post.js';
import { createInput } from './input.js';
import { createFlight, FLIGHT } from './flight.js';
import { createCameras, CAMERA_MODES } from './cameras.js';
import { createHoops } from './hoops.js';
import { createHUD } from './hud.js';
import { createWindFx } from './windfx.js';
import { PARAMS, SHOT_MODE, CRUISE_Y, CLOUD_TOP_Y, QUALITY_NAME, num } from './common.js';

const clamp = THREE.MathUtils.clamp;
const wrapPi = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const warn = (m) => { (window.__WARN = window.__WARN || []).push(m); console.warn(m); };

async function optional(file, make) {
  const url = new URL('./' + file, import.meta.url).href;
  try {
    if (PARAMS.get('skip') && PARAMS.get('skip').split(',').includes(file.replace('.js', ''))) return null;
    const head = await fetch(url, { method: 'HEAD' });
    if (!head.ok) return null;
    return await make(await import(url));
  } catch (e) { warn(`模块 ${file} 加载失败：${e && e.message}`); return null; }
}

const store = {
  get(k, d) { try { const v = localStorage.getItem('jdy.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('jdy.' + k, JSON.stringify(v)); } catch (e) { /* 忽略 */ } },
};

const app = await createApp();
const hud = createHUD();
const post = createPost(app); app.setPost(post);
post.params.fade = 1;
window.__app = app;

// ---------------- 模块（缺哪个就用占位，方便分头开发）
hud.setLoading('正在铺开天空……');
const sky = await optional('sky.js', (m) => m.createSky(app));
hud.setLoading('正在立起峰林……');
const world = await optional('world.js', (m) => m.createWorld(app, { shadowRange: 70 }));
if (world && world.group && !world.group.parent) app.scene.add(world.group);
hud.setLoading('正在酿云海……');
const atmo = await optional('atmosphere.js', (m) => m.createAtmosphere(app));
if (atmo) app.setAtmosphere(atmo);
hud.setLoading('正在唤醒大圣……');
let character = await optional('character.js', (m) => m.createCharacter(app));
if (character && character.ready) { try { await character.ready; } catch (e) { warn('角色资源加载失败：' + e.message); character = null; } }
if (!character) {   // 占位角色
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.75, 6, 16), new THREE.MeshStandardMaterial({ color: 0x9a5a22, roughness: 0.7 })); body.position.y = 0.75;
  const headM = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 12), new THREE.MeshStandardMaterial({ color: 0xc98a4a, roughness: 0.6 })); headM.position.y = 1.4;
  g.add(body, headM); g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  character = { group: g, update() {}, getHeadPosition(t) { return headM.getWorldPosition(t); } };
}
hud.setLoading('正在招来筋斗云……');
const jdy = await optional('jdy.js', (m) => m.createJDY(app));
if (jdy && jdy.group) app.sceneFx.add(jdy.group);
const audio = await optional('audio.js', (m) => m.createAudio());

// ---------------- 飞行器层级：craft（位置+朝向）→ flipNode（翻筋斗绕身体中心转）→ inner → 角色
const craft = new THREE.Group(); craft.name = 'Craft';
const flipNode = new THREE.Group(); flipNode.position.y = 0.9;
const SINK = num('sink', 0.3);                                   // 角色脚底陷进筋斗云的深度（米）
const inner = new THREE.Group(); inner.position.y = -0.9 - SINK;
craft.add(flipNode); flipNode.add(inner); inner.add(character.group);
app.scene.add(craft);
let placeholderCloud = null;
if (!jdy) {
  placeholderCloud = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }));
  placeholderCloud.scale.set(1.3, 0.35, 1.9); placeholderCloud.position.y = -0.2; inner.add(placeholderCloud);
}

// 出生点：贴着当地云面上方几米（能犁开云海）
const startPos = () => new THREE.Vector3(0, atmo && atmo.cloudHeightAt ? Math.max(atmo.cloudHeightAt(0, 0) + 12, CLOUD_TOP_Y - 20) : CRUISE_Y, 0);
const flight = createFlight({ position: startPos() });
const cameras = createCameras(app, { floor: atmo && atmo.cloudHeightAt ? (x, z) => atmo.cloudHeightAt(x, z) : null });
const input = createInput(app.canvas);
const hoops = createHoops(app, world, { cloudHeightAt: atmo && atmo.cloudHeightAt ? (x, z) => atmo.cloudHeightAt(x, z) : null });
app.sceneFx.add(hoops.group);
hoops.reset(flight.state.position, flight.state.yaw);
const windfx = createWindFx(app);
app.sceneFx.add(windfx.mesh);

// ---------------- 状态
const opt = { invertY: store.get('invertY', false), mouse: store.get('mouse', true), sound: store.get('sound', true), letterbox: store.get('letterbox', false), quality: QUALITY_NAME, blur: store.get('blur', 1) };
if (PARAMS.has('blur')) opt.blur = num('blur', 1);
cameras.setLens(num('lens', store.get('lens', 1)));
input.state.invertY = opt.invertY; input.state.mouseSteer = opt.mouse;
let state = SHOT_MODE ? (PARAMS.get('state') || 'play') : 'title';
let autopilot = PARAMS.has('auto') ? PARAMS.get('auto') !== '0' : SHOT_MODE;
let photo = false, hudOn = true, titleCamT = 0, titleCamI = 0, fadeTarget = 0, flash = 0, audioReady = false, hadLock = false;
const TITLE_CAMS = ['flyby', 'side', 'chase', 'hero', 'aerial', 'close'];
if (PARAMS.get('cammode')) cameras.setMode(PARAMS.get('cammode'));
else if (state === 'title') cameras.setMode('flyby');
hud.setOptions(opt);
hud.setLoading(SHOT_MODE ? '' : '点击"启程"开始');
if (state !== 'title') { hud.showTitle(false); hud.showHUD(PARAMS.get('hud') !== '0'); }

function startAudio() {
  if (!audio || audioReady) return;
  audioReady = true;
  Promise.resolve(audio.init()).then(() => { audio.setMaster && audio.setMaster(opt.sound ? 1 : 0); }).catch((e) => warn('音频初始化失败：' + e.message));
}
function setState(s) {
  state = s;
  hud.showTitle(s === 'title'); hud.showPause(s === 'pause'); hud.showHUD(s === 'play' && hudOn && !photo);
  if (s === 'play') { input.requestLock(); }
  else input.exitLock();
}
function begin() {
  startAudio();
  autopilot = false; cameras.setMode('chase'); cameras.snap();
  flash = 0.35; setState('play'); hud.showHint(12);
}
function restart() {
  flight.reset(startPos(), -Math.PI / 2); hoops.reset(flight.state.position, flight.state.yaw); cameras.snap(); flash = 0.5;
  if (state === 'pause') setState('play');
}

hud.on('start', begin);
hud.on('resume', () => setState('play'));
hud.on('restart', restart);
hud.on('invert', () => { opt.invertY = !opt.invertY; input.state.invertY = opt.invertY; store.set('invertY', opt.invertY); hud.setOptions(opt); });
hud.on('mouse', () => { opt.mouse = !opt.mouse; input.state.mouseSteer = opt.mouse; store.set('mouse', opt.mouse); hud.setOptions(opt); });
hud.on('music', () => { opt.sound = !opt.sound; store.set('sound', opt.sound); if (audio && audio.setMaster) audio.setMaster(opt.sound ? 1 : 0); hud.setOptions(opt); });
hud.on('lb', () => { opt.letterbox = !opt.letterbox; store.set('letterbox', opt.letterbox); hud.setOptions(opt); });
hud.on('blur', () => { opt.blur = (opt.blur + 1) % 3; store.set('blur', opt.blur); hud.setOptions(opt); });
hud.on('quality', () => { const order = ['low', 'high', 'ultra']; const n = order[(order.indexOf(opt.quality) + 1) % 3]; const u = new URL(location.href); u.searchParams.set('q', n); location.href = u.href; });

input.on('flip', () => { if (state === 'play' && !photo) { if (flight.startFlip()) { /* 事件在循环里处理 */ } } });
input.on('camera', () => { if (state === 'play') { const m = cameras.next(); hud.toast('镜头 · ' + m.name, 1.2); } });
input.on('pause', () => { if (state === 'play') { if (photo) togglePhoto(); else setState('pause'); } else if (state === 'pause') setState('play'); });
input.on('hud', () => { hudOn = !hudOn; hud.showHUD(state === 'play' && hudOn && !photo); });
input.on('mute', () => { opt.sound = !opt.sound; store.set('sound', opt.sound); if (audio && audio.setMaster) audio.setMaster(opt.sound ? 1 : 0); hud.setOptions(opt); hud.toast(opt.sound ? '声音 · 开' : '声音 · 关', 1); });
input.on('reset', () => { if (state === 'play') restart(); });
input.on('auto', () => { if (state === 'play') { autopilot = !autopilot; hud.toast(autopilot ? '自动巡航 · 开' : '自动巡航 · 关', 1.2); } });
input.on('invert', () => { if (state === 'play') { opt.invertY = !opt.invertY; input.state.invertY = opt.invertY; store.set('invertY', opt.invertY); hud.setOptions(opt); hud.toast(opt.invertY ? '升降反向 · 开' : '升降反向 · 关', 1); } });
input.on('letterbox', () => { opt.letterbox = !opt.letterbox; store.set('letterbox', opt.letterbox); hud.setOptions(opt); });
input.on('photo', () => { if (state === 'play') togglePhoto(); });
input.on('fps', () => { showFps = !showFps; if (!showFps) hud.setFps(null); });
input.on('lock', (locked) => { if (locked) hadLock = true; else if (hadLock && state === 'play' && !SHOT_MODE) { setState('pause'); } });
app.canvas.addEventListener('click', () => { if (state === 'play' && !document.pointerLockElement) input.requestLock(); });
const LENS_MIN = 0.32, LENS_MAX = 2.5;
function setLens(m) { const v = cameras.setLens(m); store.set('lens', +v.toFixed(3)); lensBump = true; }
const lensFrac = () => Math.log(cameras.lens / LENS_MIN) / Math.log(LENS_MAX / LENS_MIN);
hud.on('lensFrac', (f) => setLens(LENS_MIN * Math.pow(LENS_MAX / LENS_MIN, f)));
hud.on('lensReset', () => setLens(1));
const lensKeys = new Set();
addEventListener('keyup', (e) => lensKeys.delete(e.code));
addEventListener('blur', () => lensKeys.clear());
addEventListener('wheel', (e) => {
  if (state !== 'play') return;
  if (photo && !e.shiftKey) cameras.orbit.dist = clamp(cameras.orbit.dist * Math.exp(e.deltaY * 0.001), 2.2, 60);
  else setLens(cameras.lens * Math.exp(-e.deltaY * 0.0012));
}, { passive: true });
addEventListener('keydown', (e) => {
  if (state !== 'play') return;
  if (['KeyE', 'KeyQ', 'BracketRight', 'BracketLeft', 'Equal', 'Minus'].includes(e.code)) lensKeys.add(e.code);       // 按住连续调
  else if (e.code === 'Digit0' || e.code === 'Backslash') setLens(1);
});
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play' && !SHOT_MODE) setState('pause'); });

function togglePhoto() {
  photo = !photo; cameras.orbit.on = photo;
  if (photo) { cameras.orbit.yaw = flight.state.yaw + 2.6; cameras.orbit.pitch = 0.12; cameras.orbit.dist = 6.5; hud.toast('拍照模式 · 移动鼠标环绕 · 滚轮远近 · V 退出', 3); }
  hud.showHUD(state === 'play' && hudOn && !photo);
}

// ---------------- 自动巡航（也用于标题页的演示飞行和自动化测试）
const _to = new THREE.Vector3(), _p = new THREE.Vector3(), _right = new THREE.Vector3();
const auto = { turn: 0, climb: 0, boost: 0, brake: 0 };
let autoFlipT = 9, nearCd = 0, showFps = false, slowT = 0, slowTold = false, lensBump = false, rush = 0;
function autopilotInput(dt) {
  const s = flight.state, tgt = hoops.next;
  if (tgt) { _to.copy(tgt.pos); if (tgt.pos.distanceTo(s.position) < 70) _to.addScaledVector(tgt.normal, 45); }
  else _to.copy(s.position).addScaledVector(s.forward, 200);
  _to.sub(s.position);
  const dist = _to.length();
  const dy = wrapPi(Math.atan2(-_to.x, -_to.z) - s.yaw);
  const dp = Math.atan2(_to.y, Math.hypot(_to.x, _to.z)) - s.pitch * 0.35;
  let turn = clamp(-dy * 2.6, -1, 1), climb = clamp(dp / FLIGHT.maxPitch * 2.2, -1, 1), boost = Math.abs(dy) < 0.22 && dist > 110 ? 1 : 0;
  if (world && world.collide) {
    _right.set(-s.forward.z, 0, s.forward.x).normalize();
    for (const d of [40, 85, 140]) {
      _p.copy(s.position).addScaledVector(s.forward, d); _p.y += 0.9;
      const hit = world.collide(_p, 10);
      if (hit) {
        const lat = hit.normal.dot(_right);
        turn = clamp(turn + (Math.abs(lat) > 0.12 ? Math.sign(lat) : (dy > 0 ? -1 : 1)) * (d < 60 ? 1.6 : 0.9), -1, 1);
        if (hit.normal.y > 0.4) climb = Math.max(climb, 0.8);
        boost = 0; break;
      }
    }
  }
  autoFlipT -= dt;
  if (autoFlipT < 0 && Math.abs(dy) < 0.12 && dist > 150 && state === 'title') { flight.startFlip(); autoFlipT = 16 + Math.random() * 10; }
  // 自动巡航只做短促的加速（每 11 秒冲 3 秒左右），其余时间保持巡航，方便看清人和风景
  const burst = (app.time % 11) > 7.6;
  auto.turn = turn; auto.climb = climb; auto.boost = boost && burst ? 1 : 0; auto.brake = 0;
  return auto;
}

// ---------------- 主循环
const env = { cloudHeight: null };
const charState = { speed: 45, boost: 0, bank: 0, pitch: 0, turn: 0, flip: 0 };
const jdyState = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), velocity: new THREE.Vector3(), forward: new THREE.Vector3(), speed: 45, boost: 0, sink: SINK };
const _head = new THREE.Vector3(), _proj = new THREE.Vector3();
const getHead = (t) => (character.getHeadPosition ? character.getHeadPosition(t) : t.copy(flight.state.position).add(new THREE.Vector3(0, 1.35, 0)));
const BASE_EXPOSURE = num('exp', 1.0);

app.onUpdate((rdt) => {
  const paused = state === 'pause';
  const ts = paused ? 0 : photo ? 0.04 : 1;
  const dt = rdt * ts;
  const inp = input.update(rdt);
  if (photo) { cameras.orbit.yaw -= input.state.lookX * 0.004; cameras.orbit.pitch = clamp(cameras.orbit.pitch + input.state.lookY * 0.003, -0.6, 1.2); }
  input.state.lookX = input.state.lookY = 0;
  const s = flight.state;
  if (dt > 0) {
    const ctl = (autopilot || state === 'title') ? autopilotInput(dt) : inp;
    env.cloudHeight = atmo && atmo.cloudHeightAt ? atmo.cloudHeightAt(s.position.x, s.position.z) : null;
    flight.update(dt, ctl, world, env);
    for (const ev of s.events) {
      if (ev === 'flip') { flash = Math.max(flash, 0.12); audio && audioReady && audio.play && audio.play('flip'); }
      else if (ev === 'hit') { cameras.kick(1); flash = Math.max(flash, 0.18); audio && audioReady && audio.play && audio.play('hit'); character.play && character.play('hit'); }
      else if (ev === 'boost') { flash = Math.max(flash, 0.10); audio && audioReady && audio.play && audio.play('boost'); }
      else if (ev === 'dive') { audio && audioReady && audio.play && audio.play('cloud_dive', { volume: 0.7 }); }
    }
  }
  // 擦着石峰掠过时的呼啸
  nearCd = Math.max(0, nearCd - rdt);
  if (s.nearMiss > 0.5 && nearCd <= 0 && audio && audioReady && audio.play) { audio.play('whoosh_pass', { volume: 0.5 + 0.5 * s.nearMiss }); nearCd = 0.9; }
  // 飞行器姿态
  craft.position.copy(s.position); craft.quaternion.copy(s.quaternion);
  flipNode.rotation.x = -s.flipAngle;
  flipNode.position.y = 0.9 + 1.25 * Math.sin(Math.min(1, s.flip) * Math.PI);
  craft.updateMatrixWorld(true);
  charState.speed = s.speed; charState.boost = s.boost; charState.bank = -s.bank;       /* 角色模块约定右倾为正，飞行模型左倾为正 */ charState.pitch = s.pitch; charState.turn = s.turn; charState.flip = s.flip;
  if (dt > 0) character.update(dt, charState);
  s.fxGain = (cameras.mode.id === 'hero' || photo) ? 0 : cameras.mode.id === 'side' ? 0.5 : 1;
  if (dt > 0) windfx.update(dt, s);
  // 金环
  if (dt > 0) {
    for (const ev of hoops.update(dt, s.position)) {
      if (ev.type === 'pass') {
        flash = Math.max(flash, 0.06);
        if (state === 'play') hud.toast(ev.combo > 1 ? `连击 ×${ev.combo}` : '穿环', 1.1);
        if (audio && audioReady && audio.play) audio.play(ev.combo > 1 ? `hoop_combo_${Math.min(5, ev.combo - 1)}` : 'hoop');
        if (character.play && s.boost < 0.3) { if (ev.combo >= 5 && ev.combo % 5 === 0) character.play('laugh'); else if (ev.combo >= 2 && ev.combo % 2 === 0) character.play('point'); }
      }
    }
  }
  // 标题页轮换电影机位
  if (state === 'title') { titleCamT += rdt; if (titleCamT > 7.5) { titleCamT = 0; titleCamI = (titleCamI + 1) % TITLE_CAMS.length; cameras.setMode(TITLE_CAMS[titleCamI]); cameras.snap(); } }
  const cam = cameras.update(rdt, s, world, getHead);
  if (atmo && atmo.update && dt > 0) { jdyState.position.copy(s.position); jdyState.velocity.copy(s.velocity); jdyState.forward.copy(s.forward); jdyState.speed = s.speed; atmo.update(dt, jdyState); }
  if (jdy) {
    jdyState.position.copy(s.position); jdyState.quaternion.copy(s.quaternion);
    jdyState.velocity.copy(s.velocity); jdyState.forward.copy(s.forward); jdyState.speed = s.speed; jdyState.boost = s.boost;       // 翻筋斗时不再冒充"加速"（会让云团膨胀出渲染包围盒，被裁成方块）
    jdyState.sink = SINK;
    if (dt > 0) jdy.update(dt, jdyState);
  }
  if (world && world.update) world.update(app.camera.position, dt);
  app.shadowFocus.copy(s.position); app.shadowFocus.y += 0.8;
  app.setShadowRange(clamp(cam.charDist * 2.4 + 5, 9, 70));

  // 后期参数
  const P = post.params;
  P.focus = cam.focus; P.fstop = cam.fstop; P.protect.copy(cam.protect); P.charDist = cam.charDist;
  // "冲刺感"总量 rush（参考赛车游戏）：速度的平方 + 加速状态 + 起步那一脚，上升快、回落慢
  const spN = clamp((s.speed - 40) / 125, 0, 1);
  const rushT = photo ? 0 : clamp(spN * spN * 0.55 + (s.boostHeld ? 0.6 : 0) + s.boostKick * 0.35 + Math.sin(Math.min(1, s.flip) * Math.PI) * 0.5, 0, 1);
  rush += (rushT - rush) * (1 - Math.exp(-(rushT > rush ? 6.5 : 2.6) * rdt));
  const far = cameras.boostCam;                                                     // 镜头甩远后少糊一点，拖尾和云海破浪才看得清
  P.motionBlur = photo ? 0 : [0, 0.36, 0.62][opt.blur] * (0.75 + 0.9 * rush) * (1 - 0.45 * Math.min(1, far));       // 相当于快门从 1/125 放慢到 1/28
  P.mbMax = 0.022 + 0.02 * rush;
  P.radial = (0.010 * spN + 0.042 * rush * (1 - 0.55 * Math.min(1, far)) + 0.05 * s.boostKick) * (opt.blur ? (opt.blur === 2 ? 1.5 : 1) : 0.3);
  P.ca = 0.0007 + 0.0042 * rush + 0.004 * s.boostKick;
  P.lines = (cam.mode.id === 'hero' || cam.mode.id === 'side') ? rush * 0.35 : Math.max(s.boostHeld ? 0.8 : 0, rush * 0.8) * Math.min(1, rush * 1.4);
  P.vignette = 0.30 + 0.30 * rush;
  P.letterbox += (((opt.letterbox || photo || state === 'title' || PARAMS.get('lb') === '1') ? 1 : 0) - P.letterbox) * Math.min(1, rdt * 5);
  flash = Math.max(0, flash - rdt * 1.4); P.flash = flash;
  P.fade += (fadeTarget - P.fade) * Math.min(1, rdt * 1.8); if (SHOT_MODE) P.fade = 0;
  P.exposure = BASE_EXPOSURE;
  P.whiteout = 0;

  // 界面
  let marker = null; const nx = hoops.next;
  if (nx && state === 'play') { _proj.copy(nx.pos).project(app.camera); marker = { x: _proj.x * 0.5 + 0.5, y: _proj.y * 0.5 + 0.5, behind: _proj.z > 1, dist: nx.pos.distanceTo(s.position) }; }
  hud.update(rdt, { speed: s.speed, boost: s.boost, alt: s.position.y - (CLOUD_TOP_Y - 13), hoops: hoops.passed, combo: hoops.combo, li: s.distance / 500, mode: (autopilot ? '自动巡航 · ' : '') + cam.mode.name + ' · 视角 ' + Math.round(cam.hfov || 0) + '°', marker });
  if (lensKeys.size && state === 'play') {
    const dir = (lensKeys.has('KeyE') || lensKeys.has('BracketRight') || lensKeys.has('Equal') ? 1 : 0) - (lensKeys.has('KeyQ') || lensKeys.has('BracketLeft') || lensKeys.has('Minus') ? 1 : 0);
    if (dir) setLens(cameras.lens * Math.exp(dir * 1.4 * rdt));
  }
  hud.setLens(cam.hfov || 60, cam.focalMm || 35, 1 - Math.max(0, Math.min(1, lensFrac())), lensBump); lensBump = false;
  if (audio && audioReady && audio.update) audio.update(rdt, { speed: s.speed, boost: s.boost, nearMiss: s.nearMiss, inCloud: s.inCloud, paused: paused || photo });
  if (showFps) hud.setFps(`${app.stats.fps} 帧/秒 · ${app.stats.ms} 毫秒 · ${(app.stats.tris / 1e6).toFixed(2)}M 三角形 · ${app.stats.w}×${app.stats.h} · ${opt.quality}`);
  // 帧率长期偏低时提示一次可以降画质
  if (state === 'play' && !slowTold && opt.quality !== 'low' && app.stats.fps > 0) {
    slowT = app.stats.fps < 36 ? slowT + rdt : 0;
    if (slowT > 5) { slowTold = true; hud.toast('画面不够流畅？按 Esc 可以把画质调成"流畅"', 5); }
  }
  // 测试用状态
  const st = app.stats; st.pos = [+s.position.x.toFixed(1), +s.position.y.toFixed(1), +s.position.z.toFixed(1)]; st.speed = +s.speed.toFixed(1); st.hoops = hoops.passed; st.state = state; st.cam = cam.mode.id;
  st.modules = { sky: !!sky, world: !!world, atmo: !!atmo, character: !!(character && character.ready), jdy: !!jdy, audio: !!audio }; st.warn = window.__WARN || [];
});

// 给录制/自动化测试用的小接口
window.__game = { character, setCam: (id) => { cameras.setMode(id); cameras.snap(); }, flip: () => flight.startFlip(), setAuto: (v) => { autopilot = v; }, flight, cameras, hoops, post, hud };

await app.start();
