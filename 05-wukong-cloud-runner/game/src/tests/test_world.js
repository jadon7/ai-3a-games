// 世界模块测试页：天空 + 峰林。
//   ?cam=x,y,z&look=x,y,z&fov=50       固定机位（three 坐标）
//   ?s=里程[&h=高度][&side=横向偏移][&yaw=度][&pitch=度]   把相机放在走廊上（朝飞行方向，可偏转）
//   ?fly=速度(m/s)                       沿走廊自动飞（配合 ?t= 可截到某一时刻）；非截图模式下 WASD/方向键 + 鼠标拖动自由飞
//   ?noworld ?nosky                      去掉某一部分（测耗时差）
//   ?selftest=1                          跑碰撞 / 走廊自检，结果写进 __STATS.selftest
import * as THREE from 'three';
import { createApp } from '../app.js';
import { createSky } from '../sky.js';
import { createWorld } from '../world.js';
import { PARAMS, SHOT_MODE, CRUISE_Y, num } from '../common.js';

const app = await createApp();
const sky = PARAMS.has('nosky') ? null : await createSky(app);
const world = PARAMS.has('noworld') ? null : await createWorld(app);
window.__WORLD = world; window.__APP = app;

// ---- 仅测试用的占位：云海“地板”和一层淡雾（正式版里云海和雾由大气模块做，world 模块本身不含这些）
import { fullscreenPass } from '../app.js';
import { CLOUD_TOP_Y, SUN_DIR } from '../common.js';
if (!PARAMS.has('nofloor')) {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000), new THREE.MeshStandardMaterial({ color: 0xd8d2c8, roughness: 1.0 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = CLOUD_TOP_Y - 3; floor.receiveShadow = PARAMS.has('floorshadow'); floor.name = 'TEST_CloudFloor';
  app.scene.add(floor);
  app.onUpdate(() => { floor.position.x = app.camera.position.x; floor.position.z = app.camera.position.z; });
}
if (!PARAMS.has('appfog')) {
  const dens = num('fog', 0.00018);
  const pass = fullscreenPass(/* glsl */`
    uniform sampler2D tColor; uniform sampler2D tDepth; uniform mat4 uProjInv, uViewInv; uniform vec3 uCamPos, uSunDir; uniform float uDens; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tColor, vUv); float d = texture2D(tDepth, vUv).x;
      if (d < 1.0) {
        vec4 v = uProjInv * vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0); v /= v.w;
        vec3 wp = (uViewInv * v).xyz; float dist = length(wp - uCamPos); vec3 rd = (wp - uCamPos) / dist;
        float f = 1.0 - exp(-dist * uDens);
        float mu = max(dot(rd, uSunDir), 0.0);
        vec3 fogc = mix(vec3(0.42, 0.47, 0.55), vec3(1.25, 1.02, 0.74), pow(mu, 3.0)) + vec3(1.6, 1.2, 0.75) * pow(mu, 24.0);
        c.rgb = mix(c.rgb, fogc, f);
      }
      gl_FragColor = c;
    }`, { tColor: { value: null }, tDepth: { value: null }, uProjInv: { value: new THREE.Matrix4() }, uViewInv: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() }, uSunDir: { value: SUN_DIR.clone() }, uDens: { value: dens } });
  app.setAtmosphere({ render(renderer, src, camera, out) {
    const u = pass.uniforms; u.tColor.value = src.color; u.tDepth.value = src.depth; u.uProjInv.value.copy(camera.projectionMatrixInverse); u.uViewInv.value.copy(camera.matrixWorld); u.uCamPos.value.copy(camera.position);
    pass.render(renderer, out);
  } });
}
if (world && (SHOT_MODE || PARAMS.has('wait'))) await world.ready;
if (world) app.stats.world = world.stats;
// ?hide=L0,L1,L2,imp,tree,bush,shadow  按批次名隐藏一部分（定位耗时用）；?noshadow 关掉太阳阴影
if (world && PARAMS.has('hide')) {
  const keys = PARAMS.get('hide').split(',');
  const test = (n) => keys.some(k => (k === 'L0' && /_L0n?$/.test(n)) || (k === 'L1' && /_L1$/.test(n) && n.startsWith('rock')) || (k === 'L2' && /_L2$/.test(n)) || (k === 'L3' && /_L3$/.test(n)) || (k === 'imp' && /_imp$/.test(n)) || (k === 'tree' && /^tree\d_L\d$/.test(n)) || (k === 'bush' && n === 'bush') || (k === 'shadow' && /_shadow$/.test(n)));
  const apply = () => world.group.traverse(o => { if (o.isInstancedMesh && test(o.name)) o.visible = false; });
  apply(); world.ready.then(apply);
}
if (PARAMS.has('noshadow')) app.sunLight.castShadow = false;

const cam = app.camera, fwd = new THREE.Vector3(), tmp = new THREE.Vector3();
let s = num('s', NaN), flySpeed = num('fly', 0), yaw = 0, pitch = 0;
function placeOnCorridor() {
  const p = world.corridor.point(s), d = world.corridor.dir(s);
  const n = new THREE.Vector3(-d.z, 0, d.x);
  cam.position.copy(p).addScaledVector(n, num('side', 0)); cam.position.y = num('h', CRUISE_Y);
  const a = THREE.MathUtils.degToRad(num('yaw', 0)), e = THREE.MathUtils.degToRad(num('pitch', 0));
  const dir = d.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), a); dir.y = Math.tan(e); dir.normalize();
  cam.lookAt(tmp.copy(cam.position).add(dir));
}
if (world && !Number.isNaN(s)) placeOnCorridor();
else if (world && flySpeed) { s = 0; placeOnCorridor(); }

// ?near=距离：贴着走廊边最近的一座石峰（离岩面给定距离）沿走廊方向看；?tree=距离：对着这座峰上的一棵松树
if (world && (PARAMS.has('near') || PARAMS.has('tree'))) {
  const s0 = num('s', 420), p = world.corridor.point(s0), d = world.corridor.dir(s0), n = new THREE.Vector3(-d.z, 0, d.x).multiplyScalar(num('sideSign', 1));
  world.update(p, 0);
  const ha = world.raycast(p, n, 500), hb = world.raycast(p, n.clone().negate(), 500);
  const h = ha && hb ? (ha.distance < hb.distance ? ha : hb) : (ha || hb);
  if (h) {
    if (PARAMS.has('tree')) {
      const pil = world.pillarsNear(h.point, 60).sort((a, b) => (Math.hypot(a.x - h.point.x, a.z - h.point.z) - a.rw) - (Math.hypot(b.x - h.point.x, b.z - h.point.z) - b.rw))[0];
      let best = null, bd = 1e9;
      if (pil) {
        world.update(tmp.set(pil.x, CRUISE_Y, pil.z), 0); world.update(tmp, 0);
        for (const t of (pil.treeCache ? pil.treeCache.T : [])) { const dd = Math.abs(t.y - num('ty', 150)); if (dd < bd) { bd = dd; best = t; } }
      }
      app.stats.treeDbg = { pil: !!pil, n: pil && pil.treeCache ? pil.treeCache.T.length : -1, y: best ? best.y : null };
      if (best) {
        const out = new THREE.Vector3(best.x - pil.x, 0, best.z - pil.z).normalize();
        cam.position.set(best.x, best.y + 4.5, best.z).addScaledVector(out, num('tree', 14)).addScaledVector(new THREE.Vector3(-out.z, 0, out.x), 5);
        cam.lookAt(best.x, best.y + 3.5, best.z);
      }
    } else {
      cam.position.copy(h.point).addScaledVector(h.normal.setY(0).normalize(), num('near', 15)); cam.position.y = num('h', CRUISE_Y + 20);
      const a = THREE.MathUtils.degToRad(num('yaw', 0));
      cam.lookAt(tmp.copy(cam.position).add(d.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), a)));
    }
  }
}

// 自由飞行（非截图模式）
const keys = new Set();
if (!SHOT_MODE) {
  addEventListener('keydown', e => keys.add(e.code)); addEventListener('keyup', e => keys.delete(e.code));
  let drag = false;
  app.canvas.addEventListener('pointerdown', () => { drag = true; });
  addEventListener('pointerup', () => { drag = false; });
  addEventListener('pointermove', e => { if (!drag) return; yaw -= e.movementX * 0.003; pitch = Math.max(-1.4, Math.min(1.4, pitch - e.movementY * 0.003)); });
  cam.getWorldDirection(fwd); yaw = Math.atan2(-fwd.z, fwd.x) - Math.PI / 2 + Math.PI / 2; yaw = Math.atan2(-fwd.x, -fwd.z); pitch = Math.asin(fwd.y);
}
const updStat = { n: 0, sum: 0, max: 0 };
const hud = document.getElementById('hud');
let hudT = 0;
app.onUpdate((dt, t) => {
  if (world && flySpeed) { s += flySpeed * dt; placeOnCorridor(); }
  else if (!SHOT_MODE) {
    cam.rotation.set(pitch, yaw, 0, 'YXZ');
    const sp = (keys.has('ShiftLeft') ? 220 : 60) * dt;
    cam.getWorldDirection(fwd); tmp.set(-fwd.z, 0, fwd.x).normalize();
    if (keys.has('KeyW') || keys.has('ArrowUp')) cam.position.addScaledVector(fwd, sp);
    if (keys.has('KeyS') || keys.has('ArrowDown')) cam.position.addScaledVector(fwd, -sp);
    if (keys.has('KeyD') || keys.has('ArrowRight')) cam.position.addScaledVector(tmp, sp);
    if (keys.has('KeyA') || keys.has('ArrowLeft')) cam.position.addScaledVector(tmp, -sp);
    if (keys.has('KeyE')) cam.position.y += sp; if (keys.has('KeyQ')) cam.position.y -= sp;
    if (world) { const c = world.collide(cam.position, 2.0); if (c) cam.position.addScaledVector(c.normal, c.depth); }
  }
  cam.getWorldDirection(fwd);
  app.shadowFocus.copy(cam.position).addScaledVector(fwd, 90);
  if (world) { const tu = performance.now(); world.update(cam.position, dt); const du = performance.now() - tu; updStat.n++; updStat.sum += du; updStat.max = Math.max(updStat.max, du); app.stats.update = { avgMs: +(updStat.sum / updStat.n).toFixed(3), maxMs: +updStat.max.toFixed(2) }; }
  if (!SHOT_MODE && (hudT += dt) > 0.25) {
    hudT = 0;
    const w = world ? world.stats : {};
    hud.textContent = `${app.stats.fps} fps  ${app.stats.ms} ms  tris ${(app.stats.tris / 1e6).toFixed(2)}M  calls ${app.stats.calls}\n` +
      `pillars ${w.pillars} L0 ${w.lod0} L1 ${w.lod1} L2 ${w.lod2} L3 ${w.lod3} shadowProxy ${w.shadowProxies}\ntrees ${w.trees0}/${w.trees1}/${w.impostors} bushes ${w.bushes}\n` +
      `pos ${cam.position.x.toFixed(0)}, ${cam.position.y.toFixed(0)}, ${cam.position.z.toFixed(0)}  near ${world ? world.nearestDistance(cam.position).toFixed(1) : '-'} m`;
  }
});

if (world && PARAMS.has('selftest')) {
  // 走廊中线上应该一路畅通；从中线向两侧打射线应该在走廊半宽之外才碰到石峰
  const r = { minClear: Infinity, hitsOnCenter: 0, rayMin: Infinity, rayMean: 0, gates: 0, n: 0, ms: 0 };
  const p = new THREE.Vector3(), d = new THREE.Vector3(), nrm = new THREE.Vector3();
  const t0 = performance.now(); let calls = 0;
  for (let ss = 0; ss <= 6000; ss += 12) {
    world.corridor.point(ss, p); world.update(p, 0);
    if (world.collide(p, 2.0)) r.hitsOnCenter++; calls++;
    const nd = world.nearestDistance(p); calls++;
    r.minClear = Math.min(r.minClear, nd);
    if (nd < 46) r.gates++;
    world.corridor.dir(ss, d); nrm.set(-d.z, 0, d.x);
    for (const sg of [1, -1]) {
      const h = world.raycast(p, nrm.clone().multiplyScalar(sg), 600);
      const dist = h ? h.distance : 600; r.rayMin = Math.min(r.rayMin, dist); r.rayMean += dist; r.n++;
    }
  }
  r.ms = +((performance.now() - t0)).toFixed(1); r.rayMean = +(r.rayMean / r.n).toFixed(1); r.minClear = +r.minClear.toFixed(1); r.rayMin = +r.rayMin.toFixed(1);
  // 碰撞表的精度：拿几座石峰的近景网格（真实三角形）做射线求交，和 world.raycast 的结果比
  const acc = { n: 0, meanErr: 0, p95: 0, maxErr: 0, miss: 0 }, errs = [];
  const rc = new THREE.Raycaster(); const o = new THREE.Vector3(), dd = new THREE.Vector3();
  const s1 = 480; world.corridor.point(s1, p); world.update(p, 0);
  const pils = world.pillarsNear(p, 160).slice(0, 4);
  for (const pil of pils) {
    const v = world.variants[pil.v];
    if (!v.geo[0]) continue;
    const mesh = new THREE.Mesh(v.geo[0], new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); mesh.matrixAutoUpdate = false; mesh.matrix.copy(pil.m); mesh.updateMatrixWorld(true);
    for (let i = 0; i < 48; i++) {
      const a = i / 48 * Math.PI * 2, y = 100 + ((i * 37) % 23) / 23 * (pil.top - 130);
      o.set(pil.x + Math.cos(a) * (pil.rw + 60), y, pil.z + Math.sin(a) * (pil.rw + 60));
      dd.set(pil.x - o.x, 0, pil.z - o.z).normalize();
      rc.set(o, dd); rc.far = pil.rw + 60;
      const hit = rc.intersectObject(mesh, false)[0];
      if (!hit) { acc.miss++; continue; }
      // 真实表面上的点：碰撞表给出的距离应该≈0；往外退 5 m 应该≈5
      const e0 = Math.abs(world.distanceTo(pil, hit.point)), e5 = Math.abs(world.distanceTo(pil, tmp.copy(hit.point).addScaledVector(dd, -5)) - 5);
      const e = Math.max(e0, e5); acc.n++; acc.meanErr += e; acc.maxErr = Math.max(acc.maxErr, e); errs.push(e);
    }
  }
  acc.meanErr = +(acc.meanErr / Math.max(acc.n, 1)).toFixed(2); acc.maxErr = +acc.maxErr.toFixed(2);
  errs.sort((x, y) => x - y); acc.p95 = +(errs[Math.floor(errs.length * 0.95)] || 0).toFixed(2);
  r.accuracy = acc;
  // 单次调用耗时
  const tA = performance.now(); let k = 0;
  for (let i = 0; i < 5000; i++) { o.set(p.x + (i % 71) - 35, 112 + (i % 13), p.z + (i % 53) - 26); if (world.collide(o, 2.0)) k++; world.nearestDistance(o); }
  r.usPerCollidePlusNearest = +((performance.now() - tA) / 5000 * 1000).toFixed(1);
  world.update(cam.position, 0);
  app.stats.selftest = r;
}
await app.start();
if (SHOT_MODE && PARAMS.has('bench2')) {
  // 更可靠的耗时：每帧后读回一个像素，强制 GPU 把这一帧做完
  const gl = app.renderer.getContext(), px = new Uint8Array(4), N = num('bench2', 30);
  for (let i = 0; i < 5; i++) { app.step(1 / 60); app.render(1 / 60); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
  const t0 = performance.now();
  for (let i = 0; i < N; i++) { app.step(1 / 60); app.render(1 / 60); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
  app.stats.ms2 = +((performance.now() - t0) / N).toFixed(2);
  let tu = 0; const t1 = performance.now();
  if (world) { for (let i = 0; i < 200; i++) world.update(cam.position, 1 / 60); tu = (performance.now() - t1) / 200; }
  app.stats.updateMs = +tu.toFixed(3);
  window.__READY2 = true;
}
