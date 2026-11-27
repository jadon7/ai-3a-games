// 入口：加载 → 游戏 / 影片比对（?demo、?shots）/ 自动试玩（?auto、?bot）
import * as THREE from 'three';
import { LENS, QS, MODES, FPS, b2t, GROUND_Z, FLOOR_Z } from './config.js';
import { World, L } from './world.js';
import { Pipeline } from './pipeline.js';
import { Demo } from './demo.js';
import { ViewModel, LAYER } from './viewmodel.js';
import { EnemyAsset } from './enemy.js';
import { FX } from './fx.js';
import { Player } from './player.js';
import { Audio } from './audio.js';
import { Game } from './game.js';
import { Bot } from './bot.js';
import { Nav, LV, regionOf, floorOfZ, FH } from './level.js';

if (QS.seed != null) {        // 可复现的随机数（自动试玩比对用）
  let a = QS.seed >>> 0;
  Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

const $ = (id) => document.getElementById(id);
const stage = $('stage'), canvas = $('gl');
const CAPTURE = !!QS.shots || QS.auto != null || !!QS.views || !!QS.ent || !!QS.rag || !!QS.vmt;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: CAPTURE });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;

const camera = new THREE.PerspectiveCamera(2 * Math.atan(LENS.tanV) * 180 / Math.PI, 16 / 9, 0.02, 400);
camera.layers.enable(LAYER.DYN); camera.layers.enable(LAYER.VM);
const world = new World();
const pipeline = new Pipeline(renderer);
const G = { world, pipeline, camera, renderer, mode: QS.mode, time: 0 };
window.G = G;

// 截图：同步编码成 Blob。canvas.toBlob 靠浏览器的空闲任务完成，屏幕休眠或窗口不出帧时每张要等约 1 秒的超时，逐帧录制会慢几十倍
function grab(type = 'image/png', q = 0.92, cv = canvas) {
  const url = cv.toDataURL(type, q), bin = atob(url.slice(url.indexOf(',') + 1)), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Blob([u8], { type });
}

function layout() {
  // 画面固定 16:9（记录仪视频），窗口其余部分留黑边；输出最多 1920x1080
  const ww = window.innerWidth, wh = window.innerHeight;
  let w = ww, h = Math.round(ww * 9 / 16);
  if (h > wh) { h = wh; w = Math.round(wh * 16 / 9); }
  stage.style.width = w + 'px'; stage.style.height = h + 'px';
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let ow = Math.min(1920, Math.round(w * dpr)), oh = Math.round(ow * 9 / 16);
  if (CAPTURE) { ow = 1920; oh = 1080; }
  renderer.setSize(ow, oh, false);
  pipeline.resize(ow, oh);
  $('osd').style.fontSize = (w * 30 / 1920) + 'px';
  $('hint').style.fontSize = (w * 24 / 1920) + 'px';
}
window.addEventListener('resize', layout);

function setMode(name) {
  G.mode = name; world.setMode(name); pipeline.setMode(MODES[name]);
  if (G.game) G.game.mode = name;
}

// ---------------------------------------------------------------- 屏显
const T0 = 16 * 3600 + 42 * 60 + 7;
let osdLast = '';
function osd(tSec) {
  const s = T0 + Math.floor(tSec), p = (n) => String(n).padStart(2, '0');
  const dot = Math.floor(tSec * 2) % 2 === 0 ? '<span class="dot"></span>' : '';
  const html = `2026-11-24 ${p(Math.floor(s / 3600) % 24)}:${p(Math.floor(s % 3600 / 60))}:${p(s % 60)}\nCAM 02  REC${dot}`;
  if (html !== osdLast) { $('osd').innerHTML = html; osdLast = html; }
}

async function boot() {
  layout();
  await world.load((p, m) => { $('lbar').style.width = (p * 62) + '%'; $('lmsg').textContent = '加载 ' + m; });
  world.initLighting(renderer);
  $('lmsg').textContent = '计算可行走区域'; await new Promise((r) => setTimeout(r, 0));
  const nav = new Nav().build(world); G.nav = nav;
  $('lbar').style.width = '70%'; $('lmsg').textContent = '加载 手臂与枪';
  const vm = await new ViewModel().load(); G.vm = vm; world.scene.add(vm.group); G.vmLayer = LAYER.VM;
  vm.camera = camera; if (QS.demo || QS.shots) vm.ik = false;        // 影片比对：手臂按影片里的整体摆法，不做肩肘反解
  $('lbar').style.width = '80%'; $('lmsg').textContent = '加载 敌人';
  const enemyAsset = await new EnemyAsset().load(); G.enemyAsset = enemyAsset;
  const demo = await new Demo().load(); G.demo = demo; G.L = L; G.applyDemoFrame = (f) => applyDemoFrame(demo, f);
  setMode(G.mode);
  demo.applyCamera(40, camera);
  $('lmsg').textContent = '布置环境光'; await new Promise((r) => setTimeout(r, 0));
  refreshProbes(true);
  // 预热：加载时先造一个敌人放在镜头前渲染一帧（编译着色器、把贴图传给显卡），不然第一个敌人出现的那一刻会卡半秒。
  // 这个敌人留着不销毁（不在场景里），这样后面每个敌人都能直接复用同一套着色器。
  {
    const w = enemyAsset.spawn(), dir = camera.getWorldDirection(new THREE.Vector3());
    w.root.position.copy(camera.position).addScaledVector(dir, 3.5); w.root.position.y -= 1.5;
    w.setEnv(world.probes[0].rt.texture, 1.0); world.scene.add(w.root); w.update(0); w.root.updateMatrixWorld(true);
    for (const g of vm.guns) g.root.visible = true;       // 两把枪也一起预热，不然第一次换枪会卡一下
    world.cullFloors(null);                               // 池核的瓷砖、水面也在这一帧里编译好
    world.update(camera); pipeline.render(world.scene, camera, { noBlur: true, maskLayer: G.vmLayer });
    world.scene.remove(w.root); G.warmEnemy = w; vm._show(0);
  }
  $('lbar').style.width = '100%';
  if (QS.phantom) return runPhantom(nav);
  if (QS.nav) for (const L of [0, 1, 2, 3, 4]) await fetch('/__shot/nav' + L, { method: 'POST', body: grab('image/png', 1, nav.debugCanvas(L)) });
  if (QS.shots) return runShots(demo);
  if (QS.demo) { $('loading').style.display = 'none'; return runDemo(demo); }
  if (QS.views) return runViews();
  if (QS.ent) return runEnt(enemyAsset);
  if (QS.rag) return runRag(enemyAsset);
  return runGame(enemyAsset);
}

// 环境探针：加载时（和切换光线时）在各个房间、走廊、院子里各拍几份，运行时按位置挑最近的那份
let vmProbe = null;
const ENEMY_ENV = 0.33;
const outProbe = () => world.probes.find((p) => p.reg === 'out');
function refreshProbes(force) {
  if (force || !world.probes) {
    world.buildProbes(); vmProbe = null;
    if (G.game) for (const f of G.game.foes) f._probe(true);
    if (demoEnemy) demoEnemy.setEnv(outProbe().rt.texture, ENEMY_ENV);
  }
  const x = camera.position.x, y = -camera.position.z, z = G.player ? G.player.z : camera.position.y - 1.65, pr = world.probeAt(x, y, regionOf(x, y, z), vmProbe, z);
  world.cullFloors(z);
  // 小房间里人多半背对着窗（逆光），手臂太黑看不清，稍微提一点；走廊的探针离窗近，压一点
  if (pr && pr !== vmProbe) { vmProbe = pr; G.vm.setEnvMap(pr.rt.texture, pr.vmK ?? { C: 1.7, B: 1.7, corr: 0.6, C2: 1.7, B2: 1.7, corr2: 0.6, stair: 0.8 }[pr.reg] ?? 1.0); if (G.fx) G.fx.setEnvMap(pr.rt.texture); if (G.game) G.game.probeTex = pr.rt.texture; }
}

// ================================================================ 影片比对模式
let demoEnemy = null;
function applyDemoFrame(demo, f) {
  demo.applyCamera(f, camera);
  G.vm.group.matrix.copy(demo.vmMatrix(f)); G.vm.kick = demo.slide(f); G.vm.update(0);
  if (!demoEnemy) { demoEnemy = G.enemyAsset.spawn(); world.scene.add(demoEnemy.root); demoEnemy.setEnv(outProbe().rt.texture, ENEMY_ENV); }
  const m = demo.enemyRoot(f); const sc = new THREE.Vector3();
  m.decompose(demoEnemy.root.position, demoEnemy.root.quaternion, sc);
  demoEnemy.root.position.y = GROUND_Z;                       // 屈膝/贴地的高度已经烘进动画里
  if (f < demo.t.e_fall) demoEnemy.pose('aim_full', (f - 2) / 30); else demoEnemy.pose('fall_r', (f - demo.t.e_fall) / 30);
  demoEnemy.root.updateMatrixWorld(true);
  const hp = demoEnemy.hipsWorld(); L.uBlob.value[0].set(hp.x, GROUND_Z, hp.z, 0.8);
  world.update(camera);
  refreshProbes(false);
  for (const h of (G.demoHooks || [])) h(f);
}

function runDemo(demo) {
  const t0 = performance.now();
  let last = t0, acc = 0, n = 0;
  function loop(now) {
    const dt = (now - last) / 1000; last = now;
    const t = ((now - t0) / 1000) % (demo.n / FPS);
    const f = QS.frame ?? (1 + t * FPS);
    applyDemoFrame(demo, f);
    pipeline.render(world.scene, camera, { noBlur: QS.frame != null, maskLayer: G.vmLayer });
    osd((f - 1) / FPS);
    if (QS.fps) { acc += dt; n++; if (acc > 0.5) { $('fps').textContent = `${(n / acc).toFixed(0)} fps  ${pipeline.iw}x${pipeline.ih} -> ${pipeline.w}x${pipeline.h}`; acc = 0; n = 0; } }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

// 截图比对：把指定影片帧渲染出来并上传给本地服务器（存到 game/_shots/）
async function runShots(demo) {
  $('loading').style.display = 'none';
  await new Promise((r) => setTimeout(r, 300));
  for (const f of QS.shots) {
    applyDemoFrame(demo, f - 1);
    pipeline.render(world.scene, camera, { converge: true, maskLayer: G.vmLayer });
    applyDemoFrame(demo, f);
    pipeline.render(world.scene, camera, { converge: true, maskLayer: G.vmLayer });
    const blob = grab('image/png');
    await fetch(`/__shot/${QS.tag || 'game'}_${G.mode}_${String(f).padStart(4, '0')}`, { method: 'POST', body: blob });
  }
  await fetch(`/__shot/${QS.tag || 'game'}_${G.mode}_done`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'done ' + QS.shots.join(',') });
  document.title = 'shots done';
}

// 自检：找出"看得见、却能穿过去"的墙面。把场景里所有画出来的墙面三角形（含没有碰撞的垫层）按 5cm 采样，
// 落在玩家可走格子上方、身体高度（脚上 0.3m 到 1.75m）里的就记下来，按相邻格子归成一片一片输出。
async function runPhantom(nav) {
  const { nx, ny, s, Ls } = nav, hits = new Map();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  world.scene.updateMatrixWorld(true);
  world.scene.traverse((o) => {
    if (!o.isMesh || !o.material || !(o.material.uniforms && o.material.uniforms.tAlbedo) || o === world.collider) return;
    const col = world.roomMeshes.includes(o), pn = o.userData.name || (o.parent && o.parent.userData && o.parent.userData.name) || o.name;
    const pos = o.geometry.attributes.position, idx = o.geometry.index, nt = (idx ? idx.count : pos.count) / 3, m = o.matrixWorld;
    for (let t = 0; t < nt; t++) {
      const ia = idx ? idx.getX(t * 3) : t * 3, ib = idx ? idx.getX(t * 3 + 1) : t * 3 + 1, ic = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
      a.fromBufferAttribute(pos, ia).applyMatrix4(m); b.fromBufferAttribute(pos, ib).applyMatrix4(m); c.fromBufferAttribute(pos, ic).applyMatrix4(m);
      e1.subVectors(b, a); e2.subVectors(c, a); n.crossVectors(e1, e2); const len = n.length(); if (len < 1e-10 || Math.abs(n.y) / len > 0.72) continue;
      const mm = Math.max(1, Math.ceil(Math.max(e1.length(), e2.length(), b.distanceTo(c)) / (s * 0.5)));
      for (let u = 0; u <= mm; u++) for (let v = 0; v <= mm - u; v++) {
        const fu = u / mm, fv = v / mm, py = a.y + e1.y * fu + e2.y * fv, i = nav.ix(a.x + e1.x * fu + e2.x * fv), j = nav.iy(-(a.z + e1.z * fu + e2.z * fv)); if (!nav.inb(i, j)) continue;
        const k = j * nx + i;
        for (let L = 0; L < Ls.length; L++) {
          if (!Ls[L].maskP[k]) continue; const dh = py - Ls[L].H[k]; if (dh < 0.3 || dh > 1.75) continue;
          const key = L * nx * ny + k; let h = hits.get(key); if (!h) hits.set(key, h = { L, i, j, n: 0, lo: 9, hi: -9, names: new Set(), col: false, nocol: false });
          h.n++; h.lo = Math.min(h.lo, dh); h.hi = Math.max(h.hi, dh); h.names.add(pn); if (col) h.col = true; else h.nocol = true;
        }
      }
    }
  });
  // 相邻的格子归成一片
  const seen = new Set(), out = [];
  for (const [key, h0] of hits) {
    if (seen.has(key)) continue; const st = [key]; seen.add(key);
    const cl = { L: h0.L, n: 0, cells: 0, x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9, lo: 9, hi: -9, names: new Set(), col: false, nocol: false };
    while (st.length) {
      const kk = st.pop(), h = hits.get(kk); cl.cells++; cl.n += h.n; cl.lo = Math.min(cl.lo, h.lo); cl.hi = Math.max(cl.hi, h.hi); for (const nm of h.names) cl.names.add(nm); cl.col ||= h.col; cl.nocol ||= h.nocol;
      const x = nav.x0 + h.i * s, y = nav.y0 + h.j * s; cl.x0 = Math.min(cl.x0, x); cl.x1 = Math.max(cl.x1, x); cl.y0 = Math.min(cl.y0, y); cl.y1 = Math.max(cl.y1, y);
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) { const k2 = h.L * nx * ny + (h.j + dj) * nx + h.i + di; if (hits.has(k2) && !seen.has(k2)) { seen.add(k2); st.push(k2); } }
    }
    out.push(cl);
  }
  out.sort((p, q) => q.n - p.n);
  const txt = out.map((c) => `L${c.L} x=${c.x0.toFixed(1)}..${c.x1.toFixed(1)} y=${c.y0.toFixed(1)}..${c.y1.toFixed(1)} cells=${c.cells} samples=${c.n} h=${c.lo.toFixed(2)}..${c.hi.toFixed(2)} ${c.nocol ? 'NOCOL' : ''}${c.col ? ' col' : ''} [${[...c.names].slice(0, 6).join(',')}]`).join('\n');
  await fetch('/__shot/phantom', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: `clusters=${out.length}\n${txt}` });
  document.title = 'phantom done';
}

// 调试：按给定机位（x,y,朝向,俯仰;...）截图，检查场景各处的画面
async function runViews() {
  $('loading').style.display = 'none';
  const player = new Player(camera, world, G.vm, G.nav); G.player = player;
  const list = QS.views.split(';').map((v) => v.split(',').map(Number));
  let i = 0;
  for (const [x, y, yaw, pitch, ads, lean, crouch, layer] of list) {
    player.place(x, y, yaw, layer ?? 2); player.pitch = pitch || 0; player.ready = 0; player.locked = true;
    player.adsOn = !!ads; player.keys = { KeyE: lean > 0, KeyQ: lean < 0 }; player.crouchOn = !!crouch;
    for (let k = 0; k < (ads || lean || crouch ? 30 : 3); k++) { player.update(1 / 30, true); G.vm.update(1 / 30); }
    world.update(camera); refreshProbes(false);
    pipeline.render(world.scene, camera, { converge: true, maskLayer: LAYER.VM, noBlur: true });
    pipeline.render(world.scene, camera, { converge: true, maskLayer: LAYER.VM, noBlur: true });
    const blob = grab('image/jpeg', 0.92);
    await fetch(`/__shot/${QS.tag || 'view'}_${G.mode}_${String(i++).padStart(2, '0')}`, { method: 'POST', body: blob });
  }
  await fetch(`/__shot/${QS.tag || 'view'}_${G.mode}_done`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'views ' + list.length });
  document.title = 'views done';
}

// 调试：在镜头前放一个敌人，指定下半身/上半身片段，逐帧截图看动作（?ent=下半身,上半身,距离,转身角度）
async function runEnt(asset) {
  $('loading').style.display = 'none';
  const player = new Player(camera, world, G.vm, G.nav); G.player = player;
  const [lo, up, dist, turn] = QS.ent.split(','), D = parseFloat(dist || '3'), yaw = 122;
  player.place(24.72, 3.27, yaw); player.pitch = -6;
  for (let k = 0; k < 3; k++) { player.update(1 / 30, true); G.vm.update(1 / 30); }
  G.vm.group.visible = false;
  const e = asset.spawn(); world.scene.add(e.root);
  const psi = yaw * Math.PI / 180, ex = 24.72 - Math.sin(psi) * D, ey = 3.27 + Math.cos(psi) * D;
  e.root.position.copy(b2t(ex, ey, G.nav.floorSmooth(2, ex, ey)));
  e.root.rotation.y = Math.atan2(24.72 - ex, -(3.27 - ey)) + (parseFloat(turn || '0') * Math.PI / 180);
  const pr = world.probeAt(ex, ey, regionOf(ex, ey), null); e.setEnv(pr.rt.texture, pr.reg === 'out' ? ENEMY_ENV : 1.0);
  e.lo.snap(lo); e.up.snap(up); e.setLower(lo, 0, { restart: true }); e.setUpper(up, 0, { restart: true });
  world.update(camera); refreshProbes(false);
  for (let i = 0; i < 12; i++) {
    for (let k = 0; k < 4; k++) e.update(1 / 30);
    e.root.updateMatrixWorld(true);
    const h = e.hipsWorld(); L.uBlob.value[0].set(h.x, e.root.position.y, h.z, 0.6);
    pipeline.render(world.scene, camera, { converge: i === 0, maskLayer: LAYER.VM, noBlur: true });
    const blob = grab('image/jpeg', 0.92);
    await fetch(`/__shot/${QS.tag || 'ent'}_${lo}_${up}_${String(i).padStart(2, '0')}`, { method: 'POST', body: blob });
  }
  await fetch(`/__shot/${QS.tag || 'ent'}_${lo}_${up}_done`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'ok' });
  document.title = 'ent done';
}

// 调试：倒地检查。?rag=机位x,y,朝向,俯仰,层;敌人x,y,层,转身角,部位,子弹偏角;...  每个敌人站好后中一枪，隔几帧截一张
async function runRag(asset) {
  $('loading').style.display = 'none';
  const player = new Player(camera, world, G.vm, G.nav); G.player = player;
  const specs = QS.rag.split(';').map((v) => v.split(',')), cam = specs.shift().map(Number);
  player.place(cam[0], cam[1], cam[2], cam[4] ?? 2); player.pitch = cam[3] || 0;
  for (let k = 0; k < 3; k++) { player.update(1 / 30, true); G.vm.update(1 / 30); }
  G.vm.group.visible = false; L.uWLOn.value = 0;
  const es = specs.map(([x, y, Ly, turn, part, dyaw]) => {
    x = +x; y = +y; Ly = +(Ly ?? 2);
    const e = asset.spawn(); world.scene.add(e.root);
    const z = G.nav.floorSmooth(Ly, x, y); e.root.position.copy(b2t(x, y, z));
    e.root.rotation.y = Math.atan2(cam[0] - x, -(cam[1] - y)) + (+(turn || 0)) * Math.PI / 180;
    const pr = world.probeAt(x, y, regionOf(x, y, z), null, z); e.setEnv(pr.rt.texture, pr.reg === 'out' ? ENEMY_ENV : 1.0);
    const dir = b2t(x, y, z).sub(b2t(cam[0], cam[1], z)).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), (+(dyaw || 0)) * Math.PI / 180);
    return { e, part: part || 'body', dir };
  });
  world.update(camera); refreshProbes(false);
  let shot = 0; const every = QS.cap >= 2 ? Math.round(QS.cap) : 8;
  for (let i = 0; i < 112; i++) {
    if (i === 8) for (const o of es) {
      o.e.playFull('fall_r', 0.14); const ts = 0.85 + Math.random() * 0.4, t0 = Math.random() * 0.3;
      for (const L_ of [o.e.lo, o.e.up]) { L_.a.fall_r.timeScale = ts; L_.a.fall_r.time = t0; }
      if (!QS.noragdoll) o.e.startRagdoll(world, G.nav, { dir: o.dir, part: o.part });
    }
    for (const o of es) { o.e.update(1 / 30); o.e.root.updateMatrixWorld(true); }
    es.slice(0, 6).forEach((o, k) => { const h = o.e.hipsWorld(); L.uBlob.value[k].set(h.x, h.y - 0.12, h.z, 0.7); });
    if (i % every === every - 1) {
      pipeline.render(world.scene, camera, { converge: shot === 0, maskLayer: LAYER.VM, noBlur: true });
      await fetch(`/__shot/${QS.tag || 'rag'}_${G.mode}_${String(shot++).padStart(2, '0')}`, { method: 'POST', body: grab('image/jpeg', 0.9) });
    }
  }
  await fetch(`/__shot/${QS.tag || 'rag'}_${G.mode}_done`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: es.map((o) => o.e.rag ? `t=${o.e.rag.t.toFixed(2)} asleep=${o.e.rag.asleep} pull=${o.e.rag.pullT.toFixed(2)}` : 'no rag').join('\n') });
  document.title = 'rag done';
}

// ================================================================ 游戏
const KEYS_HTML = `
  <b>W A S D</b><span>移动</span><b>鼠标</b><span>转头（子弹打向枪口指的地方）</span>
  <b>左键</b><span>开枪</span><b>右键</b><span>举枪瞄准（按住）</span>
  <b>Q / E</b><span>向左 / 向右探身</span><b>C</b><span>蹲下 / 站起</span>
  <b>空格</b><span>跳（能踩上矮的杂物）</span><b>Shift</b><span>冲刺（枪会放低）</span>
  <b>1 / 2</b><span>手枪 / 步枪（滚轮或 X 也能切）</span><b>R</b><span>换弹</span>
  <b>G</b><span>扔闪光弹（每段 2 枚）</span><b>左键按住</b><span>步枪连发</span>
  <b>F</b><span>开 / 关枪灯</span><b>L</b><span>白天 / 弱光</span>
  <b>H</b><span>隐藏 / 显示提示</span><b>Esc</b><span>暂停</span>`;

function runGame(enemyAsset) {
  const vm = G.vm;
  const fx = new FX(world); fx.attachPlayerFlash(vm.group, vm.muzzle); if (vmProbe) fx.setEnvMap(vmProbe.rt.texture);
  vm.onSwitch = () => fx.attachPlayerFlash(vm.group, vm.muzzle);        // 换了枪，枪口火光挂到新枪的枪口上
  const player = new Player(camera, world, vm, G.nav);
  const audio = new Audio();
  const game = new Game({ world, camera, vm, fx, audio, asset: enemyAsset, player, nav: G.nav, mode: G.mode });
  game.god = QS.god;
  Object.assign(G, { fx, player, audio, game });
  const bot = (QS.auto != null || QS.bot) ? new Bot(game) : null; G.bot = bot;
  game.reset(); player.update(0, false); vm.update(0); world.update(camera); refreshProbes(false);

  const overlay = $('overlay'), obox = $('obox');
  let state = 'menu', hints = true, muted = !!QS.mute, lockErr = '';
  const modeName = () => (G.mode === 'day' ? '白天' : '弱光'), startName = () => (game.startAt === 'pool' ? '池核' : '小楼');

  function show(kind) {
    state = kind; overlay.style.display = 'flex';
    const s = game.stats, acc = s.shots ? Math.round(100 * s.hits / s.shots) : 0;
    const head = kind === 'menu' ? `<h1>BODY CAM · 清剿</h1><div class="sub">随身记录仪视角。清剿这栋三层的小楼：一楼是大厅、走廊和两间小房间，走廊尽头的楼梯间通二楼和地下室（地下室没有光，只能靠枪灯）。敌人不多，但不会站着挨打：从院子里摸过来，有的在门窗外探身射击，有的冲进屋找你，打几枪就换位置；别的楼层的房间里可能还有人蹲守。地下室走廊里还有一道门，通向一片白瓷砖的泳池空间（池核）；点下面的“开局”可以直接从那里开始。</div>`
      : kind === 'pause' ? `<h1>已暂停</h1><div class="sub">记录仪仍在待机。</div>`
      : `<h1>记录中断</h1><div class="stats">坚持时间   ${Math.floor(s.t / 60)} 分 ${String(Math.floor(s.t % 60)).padStart(2, '0')} 秒\n击倒       ${s.kills}\n打到第     ${game.wave} 段\n开枪 / 命中 ${s.shots} / ${s.hits}（${acc}%）\n中弹       ${s.hurt} 次</div>`;
    const main = kind === 'menu' ? '开始' : kind === 'pause' ? '继续' : '再来一次';
    obox.innerHTML = `${head}${kind !== 'dead' ? `<div class="keys">${KEYS_HTML}</div>` : ''}
      <div class="row"><button class="primary" id="bGo">${main}</button>${kind === 'pause' ? '<button id="bRe">重新开始</button>' : ''}
      <button id="bStart">开局：${startName()}</button><button id="bMode">光线：${modeName()}</button><button id="bMute">声音：${muted ? '关' : '开'}</button>${lockErr ? '<button id="bNoLock">不锁鼠标直接玩</button>' : ''}</div>
      <div class="note">${lockErr.trim() || '点击按钮后鼠标会被锁定在画面里；按 Esc 松开并暂停。没有准星——像真实记录仪一样，看枪口和枪灯光斑指向哪里。'}</div>`;
    $('bGo').onclick = () => { if (kind === 'dead') restart(); go(); };
    if ($('bRe')) $('bRe').onclick = () => { restart(); go(); };
    if ($('bNoLock')) $('bNoLock').onclick = () => { if (kind === 'dead') restart(); audio.init().then(() => audio.setMuted(muted)).catch(() => {}); startPlay(true); };
    $('bMode').onclick = () => { toggleMode(); $('bMode').textContent = `光线：${modeName()}`; };
    $('bStart').onclick = () => { game.startAt = game.startAt === 'pool' ? 'house' : 'pool'; $('bStart').textContent = `开局：${startName()}`; if (kind === 'menu') { restart(); world.update(camera); refreshProbes(false); } };      // 换开局位置：下一局生效（开始界面上立刻换过去）
    $('bMute').onclick = () => { muted = !muted; audio.setMuted(muted); $('bMute').textContent = `声音：${muted ? '关' : '开'}`; };
  }
  function restart() { game.reset(); player.update(0, false); vm.update(0); $('hurt').style.opacity = 0; }
  function go() {
    audio.init().then(() => audio.setMuted(muted)).catch((e) => console.warn('audio', e));
    lockErr = '';
    const pr = canvas.requestPointerLock ? canvas.requestPointerLock() : null;
    if (pr && pr.catch) pr.catch(() => { lockErr = '浏览器没有允许锁定鼠标，请再点一次按钮（刚按过 Esc 需要等一秒）。'; show(state === 'play' ? 'pause' : state); });
  }
  // lockless：浏览器不给锁鼠标时的退路（鼠标移出画面就转不动了，但能玩）
  let lockless = false;
  function startPlay(noLock) { lockless = !!noLock; state = 'play'; player.locked = true; game.running = true; overlay.style.display = 'none'; last = performance.now(); }
  function toggleMode() { setMode(G.mode === 'day' ? 'dusk' : 'day'); refreshProbes(true); }

  document.addEventListener('pointerlockchange', () => {
    const on = document.pointerLockElement === canvas;
    if (on) startPlay(false);
    else if (state === 'play' && !lockless) { player.locked = false; game.running = false; player.keys = {}; show(player.dead ? 'dead' : 'pause'); }
  });
  document.addEventListener('mousedown', (e) => { if (state === 'play' && player.locked && e.button === 0) { game.trigger = true; game.fire(); } });
  document.addEventListener('mouseup', (e) => { if (e.button === 0) game.trigger = false; });
  let wheelT = 0;
  window.addEventListener('wheel', (e) => { if (state === 'play' && player.locked && performance.now() - wheelT > 350 && Math.abs(e.deltaY) > 4) { wheelT = performance.now(); game.switchWeapon(); } }, { passive: true });
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (state === 'play') {
      if (e.code === 'KeyR') game.reload();
      else if (e.code === 'KeyF') game.toggleLight();
      else if (e.code === 'KeyG') game.throwBang();
      else if (e.code === 'Digit1') game.switchWeapon(0);
      else if (e.code === 'Digit2') game.switchWeapon(1);
      else if (e.code === 'KeyX') game.switchWeapon();
      else if (e.code === 'KeyH') hints = !hints;
    }
    if (e.code === 'KeyL' && state !== 'dead') { toggleMode(); if ($('bMode')) $('bMode').textContent = `光线：${modeName()}`; }
    if (e.code === 'KeyM') { muted = !muted; audio.setMuted(muted); }
    if (e.code === 'Escape' && lockless && state === 'play') { player.locked = false; game.running = false; player.keys = {}; show(player.dead ? 'dead' : 'pause'); }
    if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('contextmenu', (e) => e.preventDefault());

  let hintLast = '', floorNow = 1, floorT = -9;
  const FLOOR_NAME = ['地下室', '一楼', '二楼', '池核'];
  function hud() {
    let s = '';
    // 换了楼层提示一下在哪（在楼梯上不算，踏上那一层的地面才算）
    if (regionOf(player.pos.x, player.pos.y, player.z) !== 'stair' || Math.abs(player.z - (FLOOR_Z + (floorOfZ(player.z) - 1) * FH)) < 0.25) {
      const f = regionOf(player.pos.x, player.pos.y, player.z) === 'pool0' ? 3 : floorOfZ(player.z); if (f !== floorNow) { floorNow = f; floorT = game.time; }
    }
    if (hints && state === 'play' && !player.dead) {
      if (vm.switching) s = `${vm.guns[vm.next >= 0 ? vm.next : vm.idx].def.name}`;
      else if (vm.reloading) s = '换弹…';
      else if (game.time - floorT < 2.6 && game.time > 1) s = FLOOR_NAME[floorNow] + (floorNow === 0 && !game.lightOn ? '    这里没有光，按 F 开枪灯' : '');
      else if (game.wave === 1 && game.time < 8 && game.stats.shots === 0) s = '右键 举枪瞄准    Q / E 探身    C 蹲    空格 跳    G 闪光弹    2 换步枪';      // 开局提示一下新操作
      else if (game.time - game.bangShowT < 1.6) s = `闪光弹 ×${game.bangs}`;
      else if (game.ammo === 0) s = `${vm.def.name}   0 / ${game.magSize}   按 R 换弹`;
      else if (game.time - game.ammoShowT < 1.6) s = `${vm.def.name}   ${game.ammo} / ${game.magSize}`;
    }
    if (s !== hintLast) { $('hint').textContent = s; hintLast = s; }
    // 受伤：画面四周压暗，随恢复慢慢退掉
    const hurtK = player.dead ? Math.min(1, 0.75 + player.deadT * 0.1) : Math.pow(Math.max(0, 1 - player.hp / 100), 0.8) * 0.9 + Math.max(0, 0.35 - (player.time - player.lastHurtT)) * 1.2;
    $('hurt').style.opacity = Math.min(1, hurtK).toFixed(3);
  }

  const prevQ = new THREE.Quaternion().copy(camera.quaternion);
  function tick(dt) {
    if (world.pool) world.pool.advance(dt);
    const tk0 = performance.now();
    if (game.running) {
      if (bot) bot.update(dt);
      game.update(dt);
      const ang = 2 * Math.acos(Math.min(1, Math.abs(prevQ.dot(camera.quaternion)))) * 180 / Math.PI / Math.max(dt, 1e-3); prevQ.copy(camera.quaternion);
      audio.update(dt, ang, player.speed, player.stress, !player.dead);
      { const inPool = regionOf(player.pos.x, player.pos.y, player.z) === 'pool0', dy = player.pos.y + 0.4, near = player.z < -2 ? Math.max(0, 1 - Math.hypot(player.pos.x - 22.25, dy) / 7) * 0.5 : 0; const k = inPool ? 1 : near; if (Math.abs(k - (audio.poolK || 0)) > 0.02) audio.setPool(k); }      // 靠近池核的门就隐约听得到水声
      if (player.dead && player.deadT > 2.6 && state === 'play' && !bot) { if (document.pointerLockElement) document.exitPointerLock(); else { player.locked = false; game.running = false; show('dead'); } }
    } else if (state === 'menu') { player.update(dt, false); vm.update(dt); fx.update(dt, camera); }     // 菜单背后镜头保持"活着"
    const tk1 = performance.now();
    world.update(camera); refreshProbes(false);
    const tk2 = performance.now();
    if (game.cutT > 0) { renderer.setRenderTarget(null); renderer.setClearColor(0x000000, 1); renderer.clear(); }
    else {
      const k = Math.max(0.2, dt * 30);        // 影片是 30fps、半帧快门；帧率更高时按时间折算，模糊量和测光速度保持一致
      pipeline.render(world.scene, camera, { maskLayer: LAYER.VM, noBlur: state !== 'play' && state !== 'menu', shutter: Math.min(2, 0.5 / k), aeRate: Math.min(2, k), white: Math.pow(Math.min(1, player.blind / 1.8), 1.3) });
    }
    G.tk = [tk1 - tk0, tk2 - tk1, performance.now() - tk2];        // 这一帧里：逻辑、倒影和探针、主画面各花了多少毫秒（查卡顿用）
    osd(game.time + game.clockJump); hud();
  }
  G.tick = tick;

  // 动态分辨率：看帧间隔。持续掉帧就降一档；连续几秒一帧不掉就试着升一档，升上去掉帧就退回并记住上限。
  // （GPU 计时扩展在这里量到的是含垂直同步等待的时间，不能用来判断余量。）目标是不低于 60fps，高刷屏不强求 120。
  const gl = renderer.getContext();
  const STEPS = [1.0, 1.25, 1.5, 1.75, 2.0]; let step = STEPS.indexOf(pipeline.internalScale), ceil = STEPS.length - 1, dtAvg = 16.7, gpuAvg = 0;
  if (step < 0) step = 2;
  let win = [], cleanT = 0, sinceUp = 1e9;
  function dynRes(dtMs) {
    dtAvg += (dtMs - dtAvg) * 0.05;
    if (QS.scale != null || CAPTURE || state !== 'play' || dtMs > 250) { win = []; cleanT = 0; return; }
    win.push(dtMs); if (win.length > 45) win.shift();
    sinceUp += dtMs;
    if (win.length < 45) return;
    const miss = win.filter((v) => v > 25).length / win.length;       // 超过 25ms 的帧（低于 40fps）
    if (miss > 0.2 && step > 0) {
      if (sinceUp < 4000) ceil = step - 1;                             // 刚升档就掉帧：这台机器上限就是上一档
      pipeline.setInternalScale(STEPS[--step]); win = []; cleanT = 0;
    } else if (miss <= 0.03) {
      cleanT += dtMs;
      if (cleanT > 6000 && step < ceil) { pipeline.setInternalScale(STEPS[++step]); win = []; cleanT = 0; sinceUp = 0; }
    } else cleanT = 0;
  }
  G.dyn = () => ({ step: STEPS[step], gpuAvg, dtAvg });

  $('loading').style.display = 'none';
  const perfLog = [], perfSteps = []; let perfDone = false; const perfT0 = performance.now();
  let last = performance.now(), acc = 0, n = 0;
  if (QS.vmt) return runVmt(game, player, tick);
  if (QS.auto != null) return runAuto(game, player, tick);
  if (bot) { state = 'play'; player.locked = true; game.running = true; } else if (QS.nolock) { lockErr = ' '; show('menu'); } else show('menu');
  function loop(now) {
    const raw = now - last, dt = Math.min(0.05, Math.max(0.001, raw / 1000)); last = now;
    G.tkPrev = G.tk; tick(dt);
    dynRes(raw);
    if (QS.perf && !perfDone) {
      perfLog.push(raw); if (raw > 70 && perfLog.length > 60) perfSteps.push(`LONG ${raw.toFixed(0)}ms@${game.time.toFixed(1)}s tick=${G.tk.map((v) => v.toFixed(0)).join('/')} prev=${(G.tkPrev || []).map((v) => v.toFixed(0)).join('/')} after [${game.log.slice(-2).join(' ; ')}]`);
      if (perfLog.length % 30 === 0) perfSteps.push(`${STEPS[step]}@${dtAvg.toFixed(1)}ms/${game.foes.length}foes`);
      if (now - perfT0 > QS.perf * 1000) {
        perfDone = true; const a = perfLog.slice(60).sort((x, y) => x - y), dbg = gl.getExtension('WEBGL_debug_renderer_info');
        fetch(`/__shot/perf_${QS.tag || 'run'}`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: `frames=${a.length} median=${a[a.length >> 1].toFixed(1)}ms p90=${a[Math.floor(a.length * 0.9)].toFixed(1)}ms p99=${a[Math.floor(a.length * 0.99)].toFixed(1)}ms max=${a[a.length - 1].toFixed(1)}ms\nout=${pipeline.w}x${pipeline.h} internal=${pipeline.iw}x${pipeline.ih} dpr=${devicePixelRatio} win=${innerWidth}x${innerHeight} \ngpu=${dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '?'}\nsteps: ${perfSteps.join(' | ')}\nkills=${game.stats.kills}` }).then(() => { document.title = 'perf done'; });
      }
    }
    if (QS.fps) { acc += dt; n++; if (acc > 0.5) { $('fps').textContent = `${(1000 / dtAvg).toFixed(0)} fps  ${pipeline.iw}x${pipeline.ih} -> ${pipeline.w}x${pipeline.h}`; acc = 0; n = 0; } }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

// 自动试玩：固定 30fps 步长模拟若干秒，按间隔（或逐帧）把画面传给本地服务器
async function runAuto(game, player, tick) {
  player.locked = true; game.running = true;
  const dt = 1 / 30, n = Math.round(QS.auto * 30), every = Math.max(1, Math.round(QS.cap * 30)), tag = `${QS.tag || 'auto'}_${G.mode}`;
  let ci = 0; const log = [];
  let lastK = 0, lastHp = 100;
  for (let i = 0; i < n; i++) {
    tick(dt);
    if (i % 30 === 0) log.push(`t=${game.time.toFixed(1)} pos=${player.pos.x.toFixed(1)},${player.pos.y.toFixed(1)} z=${player.z.toFixed(2)} L${player.layer} ${regionOf(player.pos.x, player.pos.y, player.z)} ammo=${game.ammo}${G.vm.reloading ? 'R' : ''} wall=${player.wallK.toFixed(2)} ${G.bot ? G.bot.dbg : ''} foes=${game.foes.filter((f) => f.alive).map((f) => `${f.id}:${f.mode}${f.mode === 'slot' ? '/' + f.sub : ''}@${f.x.toFixed(1)},${f.y.toFixed(1)},L${f.L}${f.sees ? '*' : ''}`).join(' ')}`);
    if (game.stats.kills !== lastK) { lastK = game.stats.kills; log.push(`t=${game.time.toFixed(2)} kill#${lastK}`); }
    if (player.hp < lastHp - 1) log.push(`t=${game.time.toFixed(2)} hurt hp=${player.hp.toFixed(0)}`); lastHp = player.hp;
    if (QS.rec || i % every === every - 1) {
      const blob = grab(QS.rec ? 'image/jpeg' : 'image/png', 0.93);
      await fetch(`/__shot/${tag}_${String(ci++).padStart(4, '0')}`, { method: 'POST', body: blob });
    } else if (i % 6 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  const s = game.stats;
  await fetch(`/__shot/${tag}_done`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: `frames=${ci} kills=${s.kills} shots=${s.shots} hits=${s.hits} hurt=${s.hurt} wave=${game.wave} hp=${player.hp.toFixed(0)} dead=${player.dead}\n${log.join('\n')}\nshots: ${game.log.join(', ')}` });
  document.title = 'auto done';
}

// 调试：手臂和枪的动作逐帧检查（固定 60fps 步长）。?vmt=枪,x,y,朝向,俯仰,层;动作@秒;...&T=总秒数&cap=每几帧存一张
// 动作：fire 单发、hold / release 按住和松开扳机、reload、ads / unads、sw 换枪、bang、leanL / leanR / unlean、fwd / run / left / right / stop、crouch、jump、light、empty（弹匣只留一发）
async function runVmt(game, player, tick) {
  const parts = QS.vmt.split(';'), head = parts.shift().split(','), evs = parts.filter(Boolean).map((s) => { const [a, t] = s.split('@'); return { a, t: parseFloat(t) }; }).sort((a, b) => a.t - b.t);
  player.locked = true; game.running = true; game.god = true;
  if (head[1]) { player.place(+head[1], +head[2], +head[3], +(head[5] ?? 2)); player.pitch = +(head[4] || 0); }
  if (head[0] === 'rifle') G.vm._show(1);
  const dt = 1 / 60, n = Math.round(QS.T * 60), every = Math.max(1, Math.round(QS.cap)), tag = `${QS.tag || 'vmt'}_${G.mode}`;
  let ci = 0, ei = 0; const keys = {};
  const act = (a) => {
    if (a === 'fire') game.fire(); else if (a === 'hold') { game.trigger = true; game.fire(); } else if (a === 'release') game.trigger = false;
    else if (a === 'reload') game.reload(); else if (a === 'ads') player.adsOn = true; else if (a === 'unads') player.adsOn = false;
    else if (a === 'sw') game.switchWeapon(); else if (a === 'bang') game.throwBang(); else if (a === 'light') game.toggleLight();
    else if (a === 'leanL') { keys.KeyQ = true; keys.KeyE = false; } else if (a === 'leanR') { keys.KeyE = true; keys.KeyQ = false; } else if (a === 'unlean') { keys.KeyQ = keys.KeyE = false; }
    else if (a === 'fwd') keys.KeyW = true; else if (a === 'run') { keys.KeyW = true; keys.ShiftLeft = true; } else if (a === 'left') keys.KeyA = true; else if (a === 'right') keys.KeyD = true;
    else if (a === 'stop') { keys.KeyW = keys.KeyA = keys.KeyD = keys.ShiftLeft = false; }
    else if (a.startsWith('pitch')) player.pitch = parseFloat(a.slice(5)); else if (a.startsWith('yaw')) player.yaw += parseFloat(a.slice(3));
    else if (a === 'crouch') player.crouchOn = !player.crouchOn; else if (a === 'jump') player.jumpReq = player.time; else if (a === 'empty') game.ammo = 1; else if (a === 'calm') keys._calm = true;
  };
  for (let i = 0; i < n; i++) {
    while (ei < evs.length && evs[ei].t <= i * dt + 1e-6) act(evs[ei++].a);
    player.keys = { ...keys }; if (!keys._calm) player.lastShotT = player.time;      // 默认保持警戒姿势（枪不放低）
    tick(dt);
    if (i % every === every - 1) await fetch(`/__shot/${tag}_${String(ci++).padStart(4, '0')}`, { method: 'POST', body: grab('image/jpeg', 0.92) });
    else if (i % 8 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  await fetch(`/__shot/${tag}_done`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: `frames=${ci} ammo=${game.ammo} gun=${G.vm.def.id}\n${game.log.slice(-30).join('\n')}` });
  document.title = 'vmt done';
}

window.addEventListener('error', (e) => { fetch('/__shot/error', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: `${e.message}\n${e.filename}:${e.lineno}\n${e.error && e.error.stack}` }); });
window.addEventListener('unhandledrejection', (e) => { fetch('/__shot/error', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: `rejection: ${e.reason && (e.reason.stack || e.reason)}` }); });
boot().catch((e) => { console.error(e); $('lmsg').textContent = '出错：' + e.message; fetch('/__shot/error', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: String(e.stack || e) }); });
