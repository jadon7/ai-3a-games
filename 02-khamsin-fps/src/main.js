// KHAMSIN · 热风行动 —— 入口：载入流程、菜单、主循环
import { Engine } from './core/engine.js';
import { Input } from './core/input.js';
import { AudioEngine } from './core/audio.js';
import { idbGet, idbSet } from './core/cache.js';
import { ATMOS } from './gfx/sky.js';
import { loadHDRI } from './gfx/hdri.js';
import { Builder } from './world/builder.js';
import { createKit } from './world/kit.js';
import { buildLevel } from './world/level.js';
import { buildRift, RIFT_BOUNDS, RIFT_ATMOS, RIFT_NAME } from './world/rift.js';
import { buildYard, dressYard, finishYard, YARD_BOUNDS, YARD_NAME } from './world/yard.js';
import { loadKmap } from './world/kmap.js';
import { buildRefinery, finishRefinery, REFINERY_BOUNDS, REFINERY_NAME, COL as PROTO_COL, LEGEND as PROTO_LEGEND } from './world/refinery.js';
import { buildGorge, finishGorge, GORGE_BOUNDS, GORGE_NAME } from './world/gorge.js';
import { buildSalt, finishSalt, SALT_BOUNDS, SALT_NAME } from './world/salt.js';
import { loadLayout, buildLayoutMap, finishLayoutMap, layoutBounds } from './world/layoutmap.js';
import { addLabels, addLegend } from './ui/labels.js';
import { World } from './game/physics.js';
import { Nav } from './game/nav.js';
import { Game } from './game/game.js';
import { loadGunModels } from './game/gunloader.js';
import { loadSoldierModel } from './game/soldierloader.js';
import { HUD } from './ui/hud.js';
import { initView, onViewChange, setTouchMode, VIEW, TOUCH_DEVICE, IS_IOS, STANDALONE } from './core/view.js';
import { TouchControls, touchText } from './ui/touch.js';

const log = (...a) => console.log('[khamsin]', ...a);
window.addEventListener('error', (e) => console.error('[khamsin:error]', e.message, (e.filename || '').split('/').pop(), e.lineno));
window.addEventListener('unhandledrejection', (e) => console.error('[khamsin:reject]', e.reason && e.reason.stack || e.reason));

const Q = new URLSearchParams(location.search);
const RIFT = Q.get('map') === 'rift';   // 双界试炼：两重空间的原创地图
const LAYOUT = Q.get('map') === 'layout';   // 从俯视布局图生成的地图（tools/layout2map.py 转换），&src= 选哪一张
const LAYOUT_SRC = (Q.get('src') || 'codex-2').replace(/[^\w-]/g, '');
const SALT = Q.get('map') === 'salt';     // 盐井镇：三路两点的攻防灰盒（手工摆的）
const GORGE = Q.get('map') === 'gorge';   // 赤岩峡：灰盒原型（地形 + 几何块，验证布局）
const YARD = Q.get('map') === 'yard';   // 风歇驿堡：地形由灰盒导入的第三张地图（消耗战）
const REFI = Q.get('map') === 'refinery';   // 沙海炼厂：灰盒原型（只用几何块，验证布局）
const settings = Object.assign({ quality: TOUCH_DEVICE ? 'low' : 'high', sens: 1, fov: 74, vol: 0.5, autoSprint: true }, JSON.parse(localStorage.getItem('khamsin.settings') || '{}'));
if (Q.get('q')) settings.quality = Q.get('q');
const saveSettings = () => localStorage.setItem('khamsin.settings', JSON.stringify(settings));
const $ = (id) => document.getElementById(id);
initView($('stage'));   // 舞台布局：竖着拿手机时整体转成横屏；HUD / 菜单按屏幕高度缩放
// 安装到主屏幕（PWA）：Chrome / Edge / 安卓会发 beforeinstallprompt，留着等用户点菜单里的按钮；iOS 没有这个事件，按钮点开是操作说明
let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; $('btnInstall').classList.remove('hidden'); });
window.addEventListener('appinstalled', () => { installEvt = null; $('btnInstall').classList.add('hidden'); });
// 离线缓存只在打包后的版本里启用（开发时直接读源码，不能被缓存住）
const SW = typeof __BUILD__ !== 'undefined' && 'serviceWorker' in navigator && !Q.has('nosw');
if (SW) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('[khamsin] 离线缓存未启用：', e && e.message));
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.type === 'offline-ready') { const f = document.querySelector('.foot'); if (f && !f.dataset.off) { f.dataset.off = '1'; f.textContent += ' · 已缓存，可离线运行'; } log('offline ready', e.data.files); } });
}
// 让出一帧给载入界面重绘；标签页在后台（rAF 被浏览器暂停）时用定时器兜底，载入不会卡住
const nextFrame = () => new Promise((r) => { let done = false; const fin = () => { if (!done) { done = true; r(); } }; requestAnimationFrame(() => setTimeout(fin, 0)); setTimeout(fin, 40); });

async function boot() {
  const hud = new HUD(); hud.setState('loading');
  const t0 = performance.now(); let tPrev = t0;
  const step = async (p, text) => { const n = performance.now(); log('step', text, '+' + (n - tPrev).toFixed(0) + 'ms'); tPrev = n; hud.progress(p, text); await nextFrame(); };
  await step(0.03, '正在载入实拍天空…');
  try { const info = await loadHDRI('assets/sky.hdr'); log('hdri', JSON.stringify({ elev: info.elevDeg.toFixed(1), ratio: info.ratio.toFixed(2), sunI: ATMOS.sunIntensity.toFixed(2), sunC: ATMOS.sunColor.map((v) => +v.toFixed(2)), skyE: ATMOS.skyE.map((v) => +v.toFixed(2)), fog: ATMOS.fogColor.map((v) => +v.toFixed(2)), boost: info.boost.toFixed(2) })); }
  catch (e) { console.warn('[khamsin] 未找到实拍天空，使用程序化天空', e && e.message); }
  await step(0.07, '正在初始化渲染器…');
  const engine = new Engine($('gl'), settings.quality, { mobile: TOUCH_DEVICE });
  onViewChange(() => engine.resize());
  await step(0.10, '正在载入材质贴图…');
  await engine.initAssets((p) => hud.progress(0.10 + 0.16 * p, '正在载入材质贴图…'));
  log('photo textures', engine.photoCount);
  let B, level, world, nav, spaces = null;
  // 烘焙全局光照（带缓存）。布局、太阳、贴图数量或光照参数变了，缓存自动失效
  const bakeGI = async (Bq, w, key, p0, p1, label, sunE, skyE, extra = '') => {
    const rayScale = TOUCH_DEVICE ? 0.6 : 1;   // 手机上少打一些采样射线：首次进入的烘焙时间约减四成
    const sig = Bq.signature() + ':' + ATMOS.sunDir.toArray().map((v) => v.toFixed(3)).join(',') + ':' + ATMOS.sunIntensity.toFixed(2) + ':' + (engine.photoCount || 0) + extra + (rayScale === 1 ? '' : ':r' + rayScale); const cached = Q.has('nocache') ? null : await idbGet(key);
    if (cached && cached.sig === sig && Bq.importGI(cached.data)) { log('gi cache hit', key); return; }
    if (Q.has('nogi')) return;   // 调试用：跳过烘焙（没有缓存时用统一的环境光），改几何时不用每次等
    await Bq.bake(w.bvh, { sunDir: ATMOS.sunDir, sunE, skyE, strength: 1.35, rayScale, onProgress: (p) => hud.progress(p0 + (p1 - p0) * p, `${label} ${Math.round(p * 100)}%（仅首次进入需要，之后会缓存）`) });
    idbSet(key, { sig, data: Bq.exportGI() });
  };
  if (LAYOUT) {
    await step(0.24, '正在读取布局图…');
    const D = await loadLayout(`assets/maps/layouts/${LAYOUT_SRC}.json`);
    await step(0.26, '正在按布局图搭建地图（灰盒）…');
    B = new Builder(); const K = createKit(B, 13); level = buildLayoutMap(B, K, D, { name: '布局图 · ' + LAYOUT_SRC }); log('layout', LAYOUT_SRC, JSON.stringify(level.stats));
    await step(0.40, '正在构建碰撞体…');
    world = new World(B.collisionGeometry(), B.clipGeometry(), B.mechGeometry());
    await step(0.46, '正在烘焙全局光照…');
    await bakeGI(B, world, 'gi-layout-' + LAYOUT_SRC, 0.46, 0.84, '正在烘焙全局光照…', ATMOS.sunColor.map((c) => c * ATMOS.sunIntensity), ATMOS.skyE);
    await step(0.86, '正在装配场景…');
    engine.scene.add(B.build(engine.M));
    await step(0.9, '正在生成导航网格…');
    const NB = layoutBounds(D); const seeds = []; for (let x = NB.x0 + 4; x < NB.x1; x += 6) for (let z = NB.z0 + 4; z < NB.z1; z += 6) seeds.push([x, z]);
    nav = new Nav(world, NB).build(level.playerSpawn.x, level.playerSpawn.z, seeds);
    finishLayoutMap(level, nav); engine.post.setDust(level.dustVolumes);
  } else if (SALT) {
    await step(0.26, `正在搭建${SALT_NAME}（灰盒）…`);
    B = new Builder(); const K = createKit(B, 9); level = buildSalt(B, K);
    await step(0.40, '正在构建碰撞体…');
    world = new World(B.collisionGeometry(), B.clipGeometry(), B.mechGeometry());
    await step(0.46, '正在烘焙全局光照…');
    await bakeGI(B, world, 'gi-salt', 0.46, 0.84, '正在烘焙全局光照…', ATMOS.sunColor.map((c) => c * ATMOS.sunIntensity), ATMOS.skyE);
    await step(0.86, '正在装配场景…');
    engine.scene.add(B.build(engine.M));
    await step(0.9, '正在生成导航网格…');
    const seeds = []; for (let x = SALT_BOUNDS.x0 + 4; x < SALT_BOUNDS.x1; x += 6) for (let z = SALT_BOUNDS.z0 + 4; z < SALT_BOUNDS.z1; z += 6) seeds.push([x, z]);
    nav = new Nav(world, SALT_BOUNDS).build(level.playerSpawn.x, level.playerSpawn.z, seeds);
    finishSalt(level, nav); engine.post.setDust(level.dustVolumes);
  } else if (GORGE) {
    await step(0.26, `正在搭建${GORGE_NAME}（灰盒）…`);
    B = new Builder(); const K = createKit(B, 5); level = buildGorge(B, K); log('gorge', JSON.stringify(level.stats));
    await step(0.40, '正在构建碰撞体…');
    world = new World(B.collisionGeometry(), B.clipGeometry(), B.mechGeometry());
    await step(0.46, '正在烘焙全局光照…');
    await bakeGI(B, world, 'gi-gorge', 0.46, 0.84, '正在烘焙全局光照…', ATMOS.sunColor.map((c) => c * ATMOS.sunIntensity), ATMOS.skyE);
    await step(0.86, '正在装配场景…');
    engine.scene.add(B.build(engine.M));
    await step(0.9, '正在生成导航网格…');
    const seeds = []; for (let x = GORGE_BOUNDS.x0 + 4; x < GORGE_BOUNDS.x1; x += 6) for (let z = GORGE_BOUNDS.z0 + 4; z < GORGE_BOUNDS.z1; z += 6) seeds.push([x, z]);
    nav = new Nav(world, GORGE_BOUNDS).build(level.playerSpawn.x, level.playerSpawn.z, seeds);
    finishGorge(level, nav); engine.post.setDust(level.dustVolumes);
  } else if (REFI) {
    await step(0.28, `正在搭建${REFINERY_NAME}（灰盒）…`);
    B = new Builder(); const K = createKit(B, 5); level = buildRefinery(B, K);
    await step(0.40, '正在构建碰撞体…');
    world = new World(B.collisionGeometry(), B.clipGeometry(), B.mechGeometry());
    await step(0.46, '正在烘焙全局光照…');
    await bakeGI(B, world, 'gi-refinery', 0.46, 0.84, '正在烘焙全局光照…', ATMOS.sunColor.map((c) => c * ATMOS.sunIntensity), ATMOS.skyE);
    await step(0.86, '正在装配场景…');
    engine.scene.add(B.build(engine.M));
    await step(0.9, '正在生成导航网格…');
    const seeds = []; for (let x = REFINERY_BOUNDS.x0 + 4; x < REFINERY_BOUNDS.x1; x += 6) for (let z = REFINERY_BOUNDS.z0 + 4; z < REFINERY_BOUNDS.z1; z += 6) seeds.push([x, z]);
    nav = new Nav(world, REFINERY_BOUNDS).build(level.playerSpawn.x, level.playerSpawn.z, seeds);
    finishRefinery(level, nav); engine.post.setDust(level.dustVolumes);
  } else if (YARD) {
    await step(0.27, `正在载入${YARD_NAME}的地形…`);
    const km = await loadKmap('assets/maps/yard.kmap');
    await step(0.29, `正在搭建${YARD_NAME}…`);
    B = new Builder(); const K = createKit(B, 11); level = buildYard(B, K, km);
    // 先用不含陈设的碰撞体建导航网格，陈设按可走区域摆放（只占宽敞处的墙根），再建最终的碰撞体
    await step(0.33, '正在生成导航网格…');
    const pre = new World(B.collisionGeometry(), B.clipGeometry(), B.mechGeometry());
    const seeds = []; for (let x = YARD_BOUNDS.x0 + 4; x < YARD_BOUNDS.x1; x += 6) for (let z = YARD_BOUNDS.z0 + 4; z < YARD_BOUNDS.z1; z += 6) seeds.push([x, z]);   // 机甲可走区域的种子：撒满全图，哪片够宽敞就算哪片
    nav = new Nav(pre, { ...YARD_BOUNDS, solid: level.solidAt }).build(level.playerSpawn.x, level.playerSpawn.z, seeds);
    await step(0.40, '正在布置陈设与灯光…');
    dressYard(B, K, level, nav, pre);
    await step(0.43, '正在构建碰撞体…');
    world = new World(B.collisionGeometry(), B.clipGeometry(), B.mechGeometry()); nav.world = world;
    finishYard(level, nav, world); engine.post.setDust(level.dustVolumes);
    log('yard', JSON.stringify(level.stats));
    await step(0.46, '正在烘焙全局光照…');
    await bakeGI(B, world, 'gi-yard', 0.46, 0.88, '正在烘焙全局光照…', ATMOS.sunColor.map((c) => c * ATMOS.sunIntensity), ATMOS.skyE);
    await step(0.9, '正在装配场景…');
    engine.scene.add(B.build(engine.M));
  } else if (!RIFT) {
    await step(0.28, '正在搭建卡姆辛旧城…');
    B = new Builder(); const K = createKit(B, 7); level = buildLevel(B, K);
    engine.post.setDust(level.dustVolumes);
    await step(0.40, '正在构建碰撞体…');
    world = new World(B.collisionGeometry(), B.clipGeometry(), B.mechGeometry());
    await step(0.46, '正在烘焙全局光照…');
    await bakeGI(B, world, 'gi', 0.46, 0.82, '正在烘焙全局光照…', ATMOS.sunColor.map((c) => c * ATMOS.sunIntensity), ATMOS.skyE);
    await step(0.84, '正在装配场景…');
    engine.scene.add(B.build(engine.M));
    await step(0.90, '正在生成导航网格…');
    nav = new Nav(world, { x0: -74, x1: 68, z0: -76, z1: 76 }).build(level.playerSpawn.x, level.playerSpawn.z, level.mechDrops);
  } else {
    // 双界回廊：同一条路线搭两遍（现世 / 蜃界），各有自己的碰撞体、光照烘焙和导航网格
    spaces = [];
    for (const ph of [0, 1]) {
      const nm = RIFT_NAME[ph], p0 = 0.28 + ph * 0.33;
      await step(p0, `正在搭建双界回廊 · ${nm}…`);
      const Bq = new Builder(); const lv = buildRift(Bq, createKit(Bq, 7), ph);
      const w = new World(Bq.collisionGeometry(), Bq.clipGeometry(), Bq.mechGeometry()); w.dyn = [];
      const A = RIFT_ATMOS[ph]; const atmos = A ? { ...A, fogColor: ATMOS.fogColor.map((v, i) => v * A.fogMul[i]) } : null;
      const sunE = (A ? A.sunColor : ATMOS.sunColor).map((c) => c * ATMOS.sunIntensity * (A ? A.sunK : 1)), skyE = ATMOS.skyE.map((v, i) => v * (A ? A.skyK[i] : 1));
      await step(p0 + 0.04, `正在烘焙全局光照 · ${nm}…`);
      await bakeGI(Bq, w, 'gi-rift' + ph, p0 + 0.04, p0 + 0.27, `正在烘焙全局光照 · ${nm}…`, sunE, skyE, ':' + sunE.concat(skyE).map((v) => v.toFixed(2)).join(','));
      const group = Bq.build(engine.M); group.name = 'world' + ph; group.visible = ph === 0; engine.scene.add(group);
      await step(p0 + 0.29, `正在生成导航网格 · ${nm}…`);
      const nv = new Nav(w, RIFT_BOUNDS).build(lv.playerSpawn.x, lv.playerSpawn.z, [], lv.navSeeds);
      spaces.push({ B: Bq, level: lv, world: w, nav: nv, group, atmos });
    }
    // 闸门关着的时候，现世的守卫不能从门洞里穿过去
    { const gb = spaces[0].level.gate.box, nv = spaces[0].nav; for (let x = Math.floor(gb[0]) + 0.5; x < gb[3]; x++) { const i = nv.idx(x, (gb[2] + gb[5]) / 2); if (i >= 0) nv.ok[i] = 0; } }
    B = spaces[0].B; level = spaces[0].level;
    // 共用的上下文对象：游戏里所有代码拿的都是这两个引用，切换空间时只换它们内部的数据
    world = Object.assign(Object.create(World.prototype), spaces[0].world); nav = Object.assign(Object.create(Nav.prototype), spaces[0].nav);
    engine.post.setDust(level.dustVolumes);
  }
  await step(0.95, '正在预热着色器…');
  try { log('gun models', await loadGunModels()); } catch (e) { /* 载入失败则使用程序化枪模 */ }
  try { log('soldier model', Q.has('nosoldier') ? false : await loadSoldierModel()); } catch (e) { /* 载入失败则使用程序化士兵 */ }
  try { log('mech model', Q.has('nomech') ? false : await (await import('./game/mechloader.js')).loadMechModel()); } catch (e) { /* 载入失败则使用程序化机甲 */ }
  const audio = new AudioEngine(); const input = new Input($('gl')); input.touchMode = VIEW.touch;
  const touch = new TouchControls($('stage'), input, { pause: () => { if (demo) toMenu(); else input.pause(); } });   // 触屏按钮层；右上角的键：对局中 = 暂停，自动对战中 = 返回菜单
  const game = new Game({ engine, world, level, nav, audio, input, hud, spaces });
  hud.game = game;
  if (spaces) game.rift.maps = spaces.map((s) => { hud.buildMap(s.nav, level); return hud.mapImg; });   // 两界各一张小地图底图
  hud.buildMap(nav, level);
  // 灰盒地图：区域名字牌 + 颜色图例（L 显示 / 隐藏）
  const labels = level.labels && level.labels.length ? addLabels(engine.scene, level.labels) : null;
  if (level.proto) addLegend(level.legend || PROTO_LEGEND, level.colors || PROTO_COL);
  if (labels || level.proto) window.addEventListener('keydown', (e) => { if (e.code !== 'KeyL' || e.repeat) return; const off = document.body.classList.toggle('nolabels'); if (labels) labels.visible = !off; });
  game.updateMenuCam(0);
  try { engine.renderer.compile(engine.scene, engine.camera); } catch (e) { /* 忽略 */ }
  engine.render(0.016);
  await step(1, '就绪');
  log('boot', (performance.now() - t0).toFixed(0), 'ms', 'tris', B.tris, 'navCells', nav.list.length, 'mechCells', nav.mechList.length);

  // ---------- 设置 ----------
  const applySettings = () => {
    game.player.sens = 0.0021 * settings.sens; game.player.baseFov = settings.fov; game.player.autoSprint = settings.autoSprint || VIEW.touch; audio.setMasterVolume(settings.vol);
    $('optQ').value = settings.quality; $('optSens').value = settings.sens; $('optSensV').textContent = Number(settings.sens).toFixed(2); $('optFov').value = settings.fov; $('optFovV').textContent = settings.fov; $('optVol').value = settings.vol; $('optVolV').textContent = Math.round(settings.vol * 100); $('optSprint').checked = settings.autoSprint;
  };
  applySettings();
  $('optQ').onchange = (e) => { settings.quality = e.target.value; saveSettings(); location.reload(); };
  $('optSens').oninput = (e) => { settings.sens = Number(e.target.value); saveSettings(); applySettings(); };
  $('optFov').oninput = (e) => { settings.fov = Number(e.target.value); saveSettings(); applySettings(); };
  $('optVol').oninput = (e) => { settings.vol = Number(e.target.value); saveSettings(); applySettings(); };
  $('optSprint').onchange = (e) => { settings.autoSprint = e.target.checked; saveSettings(); applySettings(); };

  // ---------- 菜单 ----------
  let paused = false; let audioReady = false;
  const MUTE = Q.has('mute');   // 调试用：完全不初始化音频
  const ensureAudio = () => { if (audioReady || MUTE) return; audioReady = true; audio.init().then(() => { audio.setMasterVolume(settings.vol); audio.setMusicVolume(0.4); audio.loop('wind', true, { volume: 0.4 }); if (game.state === 'menu') audio.music('menu'); }); };
  // 手机浏览器只在 touchend / click 里才允许出声：这几个事件都接上，已经初始化过就顺手把被系统挂起的音频唤醒
  const kickAudio = () => { ensureAudio(); if (audioReady && !document.hidden) audio.resume(); };
  for (const ev of ['pointerdown', 'touchend', 'click']) document.addEventListener(ev, kickAudio, { passive: true });
  // 用手指点了画面：切到触屏操控（带触摸屏的笔记本等没被识别成触屏设备的情况）
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' && !VIEW.touch && !input.locked) { setTouchMode(true); input.touchMode = true; applySettings(); }
    else if (e.pointerType === 'mouse' && VIEW.touch && !TOUCH_DEVICE && !input.touchLock) { setTouchMode(false); input.touchMode = false; applySettings(); }   // 又拿起了鼠标：回到键鼠操控
  }, true);
  // 切到后台：触屏上没有「丢失鼠标锁定」这回事，要自己暂停并停掉声音
  document.addEventListener('visibilitychange', () => { if (!VIEW.touch) return; if (document.hidden) { if (!demo) input.pause(); if (audioReady) audio.suspend(); } else if (audioReady) audio.resume(); });
  // 触屏设备：开局时进全屏并把方向锁成横屏（安卓浏览器支持；iPhone 不支持，由舞台旋转兜底）。已安装成 App 时本来就是全屏，只锁方向
  const goFull = () => {
    if (!VIEW.touch || Q.has('nofs')) return;
    const lockO = () => { try { const o = screen.orientation; if (o && o.lock) o.lock('landscape').catch(() => {}); } catch (e) { /* 不支持就算了 */ } };
    if (STANDALONE || document.fullscreenElement) { lockO(); return; }
    const el = document.documentElement, rq = el.requestFullscreen || el.webkitRequestFullscreen; if (!rq) return;
    try { const p = rq.call(el, { navigationUI: 'hide' }); if (p && p.then) p.then(lockO).catch(() => {}); } catch (e) { /* 忽略 */ }
  };
  for (const b of document.querySelectorAll('button')) { b.addEventListener('mouseenter', () => audio.play('ui_hover', { volume: 0.5 })); b.addEventListener('click', () => audio.play('ui_click', { volume: 0.7 })); }
  const showBox = (id) => { $('mainBtns').classList.toggle('hidden', !!id); for (const k of ['how', 'set', 'install', 'map']) $(k + 'Box').classList.toggle('hidden', id !== k); $('menu').classList.toggle('sub', !!id); };
  $('btnHow').onclick = () => showBox('how'); $('btnSet').onclick = () => showBox('set');
  if (IS_IOS && !STANDALONE) $('btnInstall').classList.remove('hidden');
  if (VIEW.touch) $('btnInstall').textContent = '安装到主屏幕';   // 手机菜单是两列窄按钮，用短的叫法
  $('btnInstall').onclick = () => { if (installEvt) { const ev = installEvt; installEvt = null; ev.prompt(); if (ev.userChoice) ev.userChoice.then((r) => { if (r && r.outcome === 'accepted') $('btnInstall').classList.add('hidden'); else installEvt = ev; }).catch(() => {}); } else showBox('install'); };
  for (const b of document.querySelectorAll('.back')) b.onclick = () => showBox(null);
  // 自动对战（录制用）：AI 接管玩家本体，画面仍是第一人称。不需要锁定鼠标；H 隐藏界面，Enter / 点击画面接管，Esc 回主菜单
  let demo = false, demoEndT = 0; const skipHint = document.querySelector('#letter small'), skipText = skipHint ? skipHint.textContent : '';
  const setDemo = (on) => { demo = on; demoEndT = 0; game.setAuto(on); if (on && input.soft) { input.soft = false; input.keys.clear(); document.body.classList.remove('soft'); }   // 自动对战不用真实鼠标：退出兼容模式
    document.body.classList.toggle('demo', on); if (!on) document.body.classList.remove('nohud'); if (skipHint) skipHint.textContent = on ? touchText('自动对战 · Enter / 点击画面接管 · H 隐藏界面 · Esc 返回') : skipText; };
  const startDemo = () => { ensureAudio(); goFull(); paused = false; showBox(null); game.explore = false; setDemo(true); game.startMatch(); };
  const takeOver = () => { if (!demo) return; setDemo(false); if (game.state === 'playing' || game.state === 'intro') { input.lock(); hud.announce('已接管 —— 现在由你操作', 'info'); } };
  const demoTick = (dt) => { if (demo && game.state === 'ended') { demoEndT += dt; if (demoEndT > 8) startDemo(); } else demoEndT = 0; };   // 一局结束 8 秒后自动再开
  let lastMode = 'match';   // 「再来一局 / 重新开始」沿用上一次的模式
  const start = () => { ensureAudio(); goFull(); setDemo(false); paused = false; showBox(null); game.explore = false; lastMode = 'match'; game.startMatch(); input.lock(); };
  const explore = () => { ensureAudio(); goFull(); setDemo(false); paused = false; showBox(null); game.explore = true; lastMode = 'explore'; game.startMatch(); input.lock(); };
  const again = () => (lastMode === 'explore' ? explore() : start());
  const toMenu = () => { setDemo(false); paused = false; game.clearMatch(); game.state = 'menu'; game.cinematic = true; hud.setState('menu'); audio.music('menu'); input.unlock(); };
  $('btnStart').onclick = start; $('btnAgain').onclick = again; $('btnRestart').onclick = again; $('btnDemo').onclick = startDemo; $('btnExplore').onclick = explore;
  // 地图切换：两张地图的载入内容完全不同，带着参数重新载入页面
  const goMap = (name) => { const u = new URL(location.href); if (name) u.searchParams.set('map', name); else u.searchParams.delete('map'); u.searchParams.delete('demo'); u.searchParams.delete('auto'); location.href = u.toString(); };
  // 地图列表：名字、菜单副标题、开场字幕（中文 / 英文）、一句介绍
  const MAPS = [
    { k: null, name: '卡姆辛旧城', sub: '卡姆辛旧城 · 飞行员与机甲的消耗战', desc: '三路两点的沙漠旧城，消耗战' },
    { k: 'rift', name: '双界试炼', sub: '双界回廊 · 在现世与蜃界之间穿行的相位试炼', desc: '在两重空间之间切换的跑酷试炼（T 切换 / 按住 Z 透视）' },
    { k: 'yard', name: YARD_NAME, sub: `${YARD_NAME} · 多进院落、回廊与塔楼里的消耗战`, en: 'WINDREST CARAVANSERAI · 消耗战', desc: '多进院落、回廊和塔楼，消耗战' },
    { k: 'layout', name: '布局图地图 · 灰盒', sub: 'Codex 生成的俯视布局图自动转成的三路两点灰盒（不规则外轮廓）', en: 'LAYOUT MAP · 灰盒原型', desc: 'Codex 生成的布局图自动转成的地图：走廊和房间连成网，外轮廓不规则' },
    { k: 'salt', name: SALT_NAME + ' · 灰盒', sub: `${SALT_NAME}（灰盒原型）· 三路两点的攻防图：盐田长路、中路门楼、地下矿道`, en: 'SALTWELL · 灰盒原型', desc: '三路两点的攻防灰盒：每个位置手工设计' },
    { k: 'gorge', name: GORGE_NAME + ' · 灰盒', sub: `${GORGE_NAME}（灰盒原型）· S 形干河道、山坡老城和采石场，先用地形和几何块验证布局`, en: 'RED ROCK GORGE · 灰盒原型', desc: '新地图的灰盒原型：起伏地形 + 几何块，先进去逛、试路线' },
    // 上一版灰盒（沙海炼厂）不再放进菜单，网址加 ?map=refinery 还能进，留着做改前改后对比
    ...(REFI ? [{ k: 'refinery', name: REFINERY_NAME + ' · 旧灰盒', sub: `${REFINERY_NAME}（上一版灰盒）`, en: 'SAND SEA REFINERY · 旧灰盒', desc: '上一版灰盒，留作对比' }] : []),
  ];
  const cur = MAPS.find((m) => m.k === (Q.get('map') || null)) || MAPS[0];
  $('btnMaps').textContent = '选择地图 · ' + cur.name.replace(/ · (旧)?灰盒/, '');
  for (const m of MAPS) { const b = document.createElement('button'); b.className = m === cur ? 'cur' : ''; b.innerHTML = `<b>${m.name}</b><span>${m.desc}</span>`; b.onclick = () => { if (m !== cur) goMap(m.k); else showBox(null); }; b.addEventListener('mouseenter', () => audio.play('ui_hover', { volume: 0.5 })); $('mapList').appendChild(b); }
  $('btnMaps').onclick = () => showBox('map');
  { const sub = document.querySelector('#menu .logo p'); if (sub) sub.textContent = cur.sub; }
  if (cur.en) { const h1 = document.querySelector('#letter h1'), lp = document.querySelector('#letter p'); if (h1) h1.textContent = cur.name.replace(/ · (旧)?灰盒/, ''); if (lp) lp.textContent = cur.en; }
  if (RIFT) { $('btnStart').textContent = '开始试炼'; $('btnDemo').textContent = '示范演示（录制）'; $('btnDemo').title = '第一人称自动跑完全程，方便录屏。H 隐藏界面，Enter / 点击画面接管，Esc 返回'; $('btnAgain').textContent = '再试一次'; $('btnExplore').classList.add('hidden'); }
  window.addEventListener('keydown', (e) => {
    if (!demo || e.repeat) return; ensureAudio();
    if (e.code === 'KeyH') document.body.classList.toggle('nohud'); else if (e.code === 'Enter') takeOver(); else if (e.code === 'Escape') toMenu();
  });
  $('btnResume').onclick = () => input.lock();
  $('btnQuit').onclick = toMenu; $('btnMenu').onclick = toMenu;
  $('gl').addEventListener('click', () => { if (demo) { takeOver(); return; } if ((game.state === 'playing' || game.state === 'intro') && !input.engaged) input.lock(); });
  input.onLockChange = (locked) => {
    if (input.forceLocked) return;
    document.body.classList.toggle('soft', input.soft);
    if (locked) { if (paused) { paused = false; hud.setState('playing'); if (game.player.inMech) hud.setMode('mech'); } }
    else if (game.state === 'playing' || game.state === 'ending') { paused = true; hud.setState('paused'); }
  };
  hud.setState('menu');
  // 防止对局中误触 Ctrl+W 等直接关闭页面
  window.addEventListener('beforeunload', (e) => { if (game.state === 'playing' && !input.forceLocked && !demo && !VIEW.touch) { e.preventDefault(); e.returnValue = ''; } });

  // ---------- 主循环 ----------
  let last = performance.now(); let frames = 0, fpsT = 0, fps = 60, slow = 0, fast = 0;
  function frame(now) {
    const raw = (now - last) / 1000; const dt = Math.min(0.05, Math.max(0.0005, raw)); last = now;
    if (raw < 0.25) { frames++; fpsT += raw; } else { frames = 0; fpsT = 0; slow = 0; }   // 被系统节流的帧不计入帧率统计
    if (fpsT >= 0.5) {
      fps = frames / fpsT; frames = 0; fpsT = 0;
      // 动态分辨率：持续掉帧就降低渲染分辨率，恢复后再升回来
      if (!document.hidden && !paused) {
        if (fps < 44) { if (++slow >= 5 && engine.renderScale > engine.minScale) { engine.renderScale = Math.max(engine.minScale, engine.renderScale * 0.87); engine.resize(); slow = 0; log('renderScale ↓', engine.renderScale.toFixed(2)); } fast = 0; }
        else if (fps > 57) { slow = 0; if (++fast >= 8 && engine.renderScale < 1) { engine.renderScale = Math.min(1, engine.renderScale / 0.93); engine.resize(); fast = 0; } }
        else { slow = 0; fast = 0; }
      }
    }
    input.update(dt); touch.frame(game, paused, demo);
    const fv = window.__dbg && window.__dbg.view;
    if (fv) {   // 调试自由相机：冻结游戏，从指定机位观察
      const c = engine.camera; c.position.set(fv.pos[0], fv.pos[1], fv.pos[2]); c.lookAt(fv.look[0], fv.look[1], fv.look[2]); c.fov = fv.fov || 40; c.updateProjectionMatrix(); c.updateMatrixWorld(true);
      game.weapons.root.visible = !!fv.vm; engine.render(0);
    } else {
      if (!paused) game.update(dt);
      demoTick(raw);
      engine.render(paused ? 0 : dt * game.timeScale);
    }
    input.endFrame();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---------- 调试 / 自动化 ----------
  window.__dbg = {
    game, engine, input, hud, nav, world, level, B, spaces, settings, touch, VIEW, get fps() { return fps; }, get paused() { return paused; },
    auto() { input.forceLocked = true; ensureAudio(); game.startMatch(); game.beginPlay(); },
    demo(skipIntro = true) { startDemo(); if (skipIntro) game.beginPlay(); }, get demoOn() { return demo; },
    view: null,
    // 手动推进 n 帧（面板被系统节流到 1fps 时用它做自动化测试），最后渲染一帧
    step(n = 60, dt = 1 / 60, renderEvery = 0) { for (let i = 0; i < n; i++) { input.update(dt); touch.frame(game, paused, demo); game.update(dt); demoTick(dt); if (renderEvery && i % renderEvery === 0) engine.render(dt * game.timeScale); input.endFrame(); } engine.render(dt); return game.time; },
    draw(n = 1) { const fv = this.view; for (let i = 0; i < n; i++) { if (fv) { const c = engine.camera; c.position.set(fv.pos[0], fv.pos[1], fv.pos[2]); c.lookAt(fv.look[0], fv.look[1], fv.look[2]); c.fov = fv.fov || 40; c.updateProjectionMatrix(); c.updateMatrixWorld(true); game.weapons.root.visible = !!fv.vm; } engine.render(fv ? 0 : 1 / 60); } },
    cam(x, y, z, yaw, pitch) { const p = game.player; p.pos.set(x, y, z); p.vel.set(0, 0, 0); p.yaw = yaw; p.pitch = pitch || 0; },
  };
  if (Q.has('auto')) window.__dbg.auto();
  if (Q.has('demo')) startDemo();   // 直接进入自动对战 / 示范演示（带开场镜头）
  if (SW) navigator.serviceWorker.ready.then((reg) => { if (reg.active) reg.active.postMessage({ type: 'precache' }); }).catch(() => {});   // 进了菜单再让后台把素材缓存齐，不和首次载入抢网速
}
boot().catch((e) => { console.error('[khamsin:fatal]', e && e.stack || e); const t = document.getElementById('ltext'); if (t) t.textContent = '载入失败：' + (e && e.message || e); });
