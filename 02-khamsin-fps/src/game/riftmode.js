// 双界试炼：现世 / 蜃界两重空间的切换、蜃影透视、机关与闸门、检查点、计时
//   T        相位切换：位置、速度、朝向都保留，只换世界。目的地有实体就切不过去；切到敌人身上 = 相位处决
//   按住 Z   蜃影透视：把另一界与这一界不同的结构描成全息轮廓，另一界的敌人显示成剪影
// 实体各自带 phase，只和同一界的东西发生关系（碰撞、寻路、视线、子弹）。Game.setCtx(k) 负责把共用的 world / nav 切到第 k 界。
import * as THREE from 'three';
import { Soldier } from './actors.js';
import { RIFT_KILL_Y, RIFT_NAME } from '../world/rift.js';
import { RiftHUD, fmtT as fmt } from '../ui/rifthud.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _ray = new THREE.Ray();
const UP = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0);
const PH_COL = [[1.0, 0.7, 0.32], [0.3, 0.95, 1.0]];   // 两界的代表色：现世琥珀、蜃界青
const SHIFT_CD = 0.45, BEST_KEY = 'khamsin.rift.best';
const MEDALS = [[70, '金'], [110, '银'], [1e9, '铜']];   // 脚本按理想路线跑一遍约 45 秒
// 目的地被占时依次尝试的小位移（不超过半米，穿不过墙）
const NUDGE = [[0, 0.3, 0], [0, 0.7, 0], [0.45, 0, 0], [-0.45, 0, 0], [0, 0, 0.45], [0, 0, -0.45], [0.45, 0.35, 0], [-0.45, 0.35, 0], [0, 0.35, 0.45], [0, 0.35, -0.45]];

const HOLO_VERT = /* glsl */`
varying vec3 vW; varying vec3 vN;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`;
const HOLO_FRAG = /* glsl */`
uniform vec3 uCol; uniform float uTime; uniform float uK; uniform vec3 uCam;
varying vec3 vW; varying vec3 vN;
void main() {
  vec3 n = normalize(vN); vec3 V = normalize(uCam - vW);
  float fr = pow(1.0 - abs(dot(n, V)), 2.0);
  // 一米一格的网格线；与面垂直的那个轴不参与，否则整面都会落在线上
  vec3 g = abs(fract(vW - 0.5) - 0.5) / max(fwidth(vW), vec3(1e-4));
  vec3 ln = clamp(1.0 - g, 0.0, 1.0) * (1.0 - step(0.9, abs(n)));
  float line = max(max(ln.x, ln.y), ln.z);
  float d = distance(uCam, vW); float fade = smoothstep(75.0, 18.0, d) * smoothstep(0.3, 1.2, d);
  float scan = 0.5 + 0.5 * sin(vW.y * 7.0 - uTime * 4.5);
  float a = (0.07 + 0.55 * line + 0.4 * fr + 0.07 * scan) * fade * uK;
  gl_FragColor = vec4(uCol * a, 1.0);
}`;

export class RiftMode {
  constructor(game) {
    const g = this.g = game, S = this.S = game.spaces, eng = game.engine, sc = eng.scene;
    this.hud = new RiftHUD();
    // —— 各界的动态物体组、全息轮廓 ——
    const SKIP = /^w:(terrain|rock|leaf|grass|poster|sign|cloth)/;
    this.holo = [0, 1].map((k) => new THREE.ShaderMaterial({ vertexShader: HOLO_VERT, fragmentShader: HOLO_FRAG, transparent: true, depthWrite: false, depthFunc: THREE.LessDepth, blending: THREE.AdditiveBlending,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 6, fog: false,
      uniforms: { uCol: { value: new THREE.Vector3(PH_COL[k][0], PH_COL[k][1], PH_COL[k][2]) }, uTime: { value: 0 }, uK: { value: 0 }, uCam: { value: new THREE.Vector3() } } }));
    this.ghostMat = [0, 1].map((k) => new THREE.MeshBasicMaterial({ color: new THREE.Color(PH_COL[k][0] * 0.75, PH_COL[k][1] * 0.75, PH_COL[k][2] * 0.75), transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, fog: false }));
    S.forEach((s, k) => {
      s.ents = new THREE.Group(); s.ents.name = 'ents' + k; sc.add(s.ents);
      s.ghost = new THREE.Group(); s.ghost.name = 'ghost' + k; s.ghost.visible = false; sc.add(s.ghost);
      for (const m of s.group.children) { if (SKIP.test(m.name)) continue; const h = new THREE.Mesh(m.geometry, this.holo[k]); h.matrixAutoUpdate = false; h.renderOrder = 6; h.frustumCulled = true; s.ghost.add(h); }
    });
    // —— 机关与闸门 ——
    const L0 = S[0].level, T = eng.T;
    const steel = new THREE.MeshStandardMaterial({ map: T.armor.map, normalMap: T.armor.normalMap, roughnessMap: T.armor.ormMap, metalnessMap: T.armor.ormMap, roughness: 1, metalness: 1, color: 0x8a7860 });
    // 闸门（现世）：一块钢板 + 横筋。碰撞体比墙略厚，打开时沉入地下
    const gb = L0.gate.box; const gw = gb[3] - gb[0], gh = gb[4] - gb[1];
    const gate = this.gate = { y0: gb[1] + gh / 2, x: (gb[0] + gb[3]) / 2, z: (gb[2] + gb[5]) / 2, h: gh, open: 0, on: false, mesh: new THREE.Group(), holo: new THREE.Group(), dyn: S[L0.gate.phase].world.addDyn(gb[0], gb[1], gb[2], gb[3], gb[4], gb[5], 'metal') };
    const slab = new THREE.BoxGeometry(gw, gh, 0.2), rib = new THREE.BoxGeometry(gw, 0.16, 0.3), stud = new THREE.BoxGeometry(0.22, gh, 0.26);
    const part = (geo, x, y) => { const m = new THREE.Mesh(geo, steel); m.position.set(x, y, 0); m.castShadow = true; m.receiveShadow = true; gate.mesh.add(m); const h = new THREE.Mesh(geo, this.holo[L0.gate.phase]); h.position.set(x, y, 0); h.renderOrder = 6; gate.holo.add(h); };
    part(slab, 0, 0); for (const y of [-gh * 0.36, -gh * 0.12, gh * 0.12, gh * 0.36]) part(rib, 0, y); for (const x of [-gw * 0.3, 0, gw * 0.3]) part(stud, x, 0);
    S[L0.gate.phase].group.add(gate.mesh); S[L0.gate.phase].ghost.add(gate.holo);
    // 机关（蜃界）：底座在地图里，拉杆在这里（会动）
    const lv = L0.lever; const lever = this.lever = { ...lv, on: false, t: 0, pivot: new THREE.Group(), holo: new THREE.Group() };
    const armG = new THREE.CylinderGeometry(0.035, 0.045, 0.78, 8); armG.translate(0, 0.39, 0); const knobG = new THREE.SphereGeometry(0.085, 12, 8); knobG.translate(0, 0.8, 0);
    this.knobMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 2.6, 2.9), fog: false });
    lever.pivot.add(new THREE.Mesh(armG, steel)); lever.pivot.add(new THREE.Mesh(knobG, this.knobMat)); lever.pivot.position.set(lv.x, lv.y + 0.55, lv.z - 0.3);
    { const h1 = new THREE.Mesh(armG, this.holo[lv.phase]), h2 = new THREE.Mesh(knobG, this.holo[lv.phase]); h1.renderOrder = h2.renderOrder = 6; lever.holo.add(h1, h2); lever.holo.position.copy(lever.pivot.position); }
    S[lv.phase].group.add(lever.pivot); S[lv.phase].ghost.add(lever.holo);
    // —— 路标光柱：下一个检查点 / 终点（两界都看得见）——
    const bg = new THREE.CylinderGeometry(0.22, 0.22, 26, 10, 1, true); bg.translate(0, 13, 0);
    this.beaconMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.15, 0.5), transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.beacon = new THREE.Mesh(bg, this.beaconMat); this.beacon.renderOrder = 5; this.beacon.visible = false; sc.add(this.beacon);
    this.maps = null;   // 两界各自的小地图底图，由入口填入
    this.best = Number(localStorage.getItem(BEST_KEY)) || 0;
    this.reset();
  }

  // ---------- 状态 ----------
  reset() {
    const g = this.g;
    this.t = 0; this.running = false; this.cd = 0; this.pulse = 0; this.peek = false; this.peekK = 0; this.cp = 0; this.cpPhase = 0; this.blockT = 0; this.hintI = -1; this.done = false;
    this.stats = { shifts: 0, falls: 0, executes: 0 };
    this.lever.on = false; this.lever.t = 0; this.gate.on = false; this.gate.open = 0; this.gate.dyn.on = true;
    this.knobMat.color.setRGB(0.5, 2.6, 2.9);
    g.phase = 0; g.setCtx(0); this.apply(0);
    this.S.forEach((s, k) => { s.ghost.visible = false; s.ents.visible = k === 0; }); this.beacon.visible = false; g.engine.post.fx.uShift.value = 0;
    this.syncProps(); this.hud.reset(this.S[0].level.checkpoints.length, this.best);
  }
  begin() {
    const g = this.g; this.running = true; this.t = 0;
    g.aiAccuracy = 1.5;   // 这里没有友军分担火力，所有守卫都只打玩家：准头放宽一些
    for (let k = 0; k < this.S.length; k++) {
      g.setCtx(k);
      for (const [kind, x, z, r] of this.S[k].level.enemies) { const a = new Soldier(g, kind, 1, x, z); a.home = { x, z, r }; a.slideCD = 1e9; g.actors.push(a); }
    }
    g.setCtx(g.phase);
  }

  // 切到第 k 界的画面：静态场景、大气、室内浮尘、小地图
  apply(k) {
    const g = this.g, eng = g.engine;
    this.S.forEach((s, i) => { s.group.visible = i === k; });
    eng.setAtmos(this.S[k].atmos); eng.post.setDust(this.S[k].level.dustVolumes);
    if (this.maps) g.hud.mapImg = this.maps[k];
    document.body.classList.toggle('phase1', k === 1);
    eng.post.fx.uShiftCol.value.set(PH_COL[k][0], PH_COL[k][1], PH_COL[k][2]);
    this.hud.setPhase(k);
  }

  // ---------- 相位切换 ----------
  // 位置 p（脚底）在当前上下文的世界里站不站得下：不在实体内部，身体三个高度的球都不碰东西
  fits(p, h) {
    const w = this.g.world; const r = 0.3;
    _ray.origin.set(p.x, p.y + 0.9, p.z); _ray.direction.copy(UP);
    const up = w.bvh.raycastFirst(_ray, THREE.DoubleSide, 0, 80); if (up && up.face.normal.y > 0.01) return false;
    for (const y of [r + 0.06, h * 0.5, h - r]) { _a.set(p.x, p.y + y, p.z); if (w.sphereHits(_a, r)) return false; }
    return true;
  }
  tryShift() {
    const g = this.g, p = g.player; if (this.cd > 0 || !p.alive || p.inMech) return false;
    const to = 1 - g.phase; g.setCtx(to);
    let ok = this.fits(p.pos, p.height);
    if (!ok) for (const n of NUDGE) { _b.set(p.pos.x + n[0], p.pos.y + n[1], p.pos.z + n[2]); if (this.fits(_b, p.height)) { p.pos.copy(_b); ok = true; break; } }
    if (!ok) {
      g.setCtx(g.phase); this.cd = 0.25; this.blockT = 1.1; g.audio.play('phase_block', { volume: 0.8 }); this.hud.blocked(); p.shake = Math.min(1, p.shake + 0.15);
      return false;
    }
    g.phase = to; this.apply(to); this.cd = SHIFT_CD; this.pulse = 1; this.stats.shifts++;
    // 动作状态：墙 / 钩点 / 脚下的地面在新世界里不一定还在
    const w = g.world;
    if (p.wr.on) { _a.set(p.pos.x, p.pos.y + 1.0, p.pos.z); _b.copy(p.wr.normal).negate(); if (!w.raycast(_a, _b, p.radius + 0.7)) p.endWallrun(0.25); }
    if (p.grapple.state > 0 && !w.sphereHits(p.grapple.point, 0.35)) { p.grapple.state = 0; g.fx.setRope(false); }
    p.mantle.on = false;
    if (p.onGround) { _a.set(p.pos.x, p.pos.y + 0.25, p.pos.z); if (!w.raycast(_a, DOWN, 0.6)) { p.onGround = false; p.airTime = 0.06; } }
    // 相位处决：切到敌人身上
    for (const a of g.actors) {
      if (!a.alive || a.phase !== to || a.team === 0) continue;
      if (Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z) < 1.0 && Math.abs(a.pos.y - p.pos.y) < 1.7) { a.aimPoint(_a); g.fx.hitFlesh(_a, p.look, a.robot); g.fx.sparks(_a, null, 16, PH_COL[to].map((c) => c * 2), 7); a.takeDamage(9999, p, { melee: true, dir: p.look }); this.stats.executes++; g.hud.announce('相位处决', 'good'); }
    }
    g.audio.play('phase_shift', { volume: 0.9, pitch: to ? 0.92 : 1.08 }); g.flash = Math.max(g.flash, 0.22); p.shake = Math.min(1, p.shake + 0.12);
    return true;
  }

  // ---------- 机关 ----------
  pullLever() {
    const g = this.g, l = this.lever; if (l.on) return; l.on = true; l.t = 0; this.gate.on = true;
    g.audio.play('lever', { volume: 1 }); this.knobMat.color.setRGB(2.9, 1.7, 0.5);
    g.hud.announce('机关已拉下 —— 现世的闸门正在开启', 'good');
  }
  syncProps() {
    const l = this.lever, gt = this.gate;
    const u = Math.min(1, l.t / 0.35); const e = u * u * (3 - 2 * u); const ang = (l.on ? -0.75 + 1.5 * e : -0.75);
    l.pivot.rotation.x = ang; l.holo.rotation.x = ang;
    const o = gt.open * gt.open * (3 - 2 * gt.open); const y = gt.y0 - o * (gt.h - 0.05);   // 闸门沉入地下
    gt.mesh.position.set(gt.x, y, gt.z); gt.holo.position.copy(gt.mesh.position);
  }

  // ---------- 重新部署 ----------
  respawn(fall) {
    const g = this.g, p = g.player; const c = this.S[0].level.checkpoints[this.cp];
    if (g.phase !== this.cpPhase) { g.phase = this.cpPhase; g.setCtx(g.phase); this.apply(g.phase); }
    p.spawn(c); g.fade = 1; this.cd = 0.3; g.fx.setRope(false);
    for (const a of g.actors) if (a.target === p) { a.target = null; a.alert = null; }
    g.hud.announce(fall ? '坠入深沟 —— 回到检查点「' + c.name + '」' : '已在检查点「' + c.name + '」重新部署', 'info');
  }

  // ---------- 每帧（在玩家更新之前） ----------
  update(dt) {
    const g = this.g, p = g.player, inp = g.ctl, L = this.S[0].level;
    if (!this.running || this.done) return;
    this.t += dt; this.cd = Math.max(0, this.cd - dt); this.blockT = Math.max(0, this.blockT - dt);
    if (p.alive) {
      if (inp.hit('KeyT')) this.tryShift();
      const pk = inp.down('KeyZ'); if (pk && !this.peek) g.audio.play('phase_peek', { volume: 0.55 }); this.peek = pk;
      // 坠落
      if (p.pos.y < RIFT_KILL_Y) { this.stats.falls++; this.respawn(true); }
      // 检查点：只往前推进
      for (let i = this.cp + 1; i < L.checkpoints.length; i++) { const c = L.checkpoints[i]; if (Math.hypot(c.x - p.pos.x, c.z - p.pos.z) < 2.6 && Math.abs(c.y - p.pos.y) < 2.2) { this.cp = i; this.cpPhase = g.phase; g.audio.play('checkpoint', { volume: 0.7 }); this.hud.checkpoint(i, c.name); } }
      // 终点
      const f = L.finish; if (Math.hypot(f.x - p.pos.x, f.z - p.pos.z) < f.r && p.pos.y > f.y - 0.8) this.finish();
    } else this.peek = false;
    // 玩家不在这一界了：追着他的敌人丢失目标，去他消失的地方看看
    for (const a of g.actors) if (a.target === p && a.phase !== g.phase) { a.target = null; a.alert = p.pos.clone(); }
    // 机关 / 闸门动画
    const l = this.lever, gt = this.gate; if (l.on) l.t += dt;
    if (gt.on && gt.open < 1) { gt.open = Math.min(1, gt.open + dt / 1.7); if (gt.open > 0.55) gt.dyn.on = false; }
    this.syncProps();
    // 沿途提示
    let hi = -1;
    for (let i = 0; i < L.hints.length; i++) { const h = L.hints[i]; if (p.pos.z > h.z0 && p.pos.z < h.z1 && (h.phase === undefined || h.phase === g.phase) && (h.yMax === undefined || p.pos.y < h.yMax) && !(h.until === 'lever' && l.on)) { hi = i; break; } }
    if (hi !== this.hintI) { this.hintI = hi; this.hud.hint(hi >= 0 ? L.hints[hi].text : ''); }
  }

  // ---------- 每帧（在所有单位更新之后） ----------
  late(dt) {
    const g = this.g, p = g.player, eng = g.engine, fxu = eng.post.fx, S = this.S; const other = 1 - g.phase;
    const peek = this.peek && g.state === 'playing' && p.alive;
    // 机关交互
    const l = this.lever;
    if (this.running && !this.done && p.alive && !l.on && g.phase === l.phase && Math.hypot(l.x - p.pos.x, l.z - p.pos.z) < 2.4 && Math.abs(l.y - p.pos.y) < 1.6) { g.interactPrompt = '按 E 拉下机关'; if (g.ctl.hit('KeyE')) this.pullLever(); }
    // 蜃影透视：另一界的结构轮廓 + 敌人剪影
    this.peekK += ((peek ? 1 : 0) - this.peekK) * Math.min(1, dt * 9);
    const on = this.peekK > 0.02;
    S.forEach((s, k) => { s.ghost.visible = on && k === other; s.ents.visible = k === g.phase || (on && k === other); });
    const hm = this.holo[other].uniforms; hm.uK.value = this.peekK; hm.uTime.value = g.time; hm.uCam.value.copy(eng.camera.position);
    this.ghostMat[other].opacity = 0.6 * this.peekK;
    for (const a of g.actors) {
      const ghost = a.phase !== g.phase; const want = ghost ? this.ghostMat[a.phase] : a.mat;
      if (a.mesh.material !== want) a.mesh.material = want;
      if (ghost) { a.mesh.castShadow = false; if (a.shadowMesh) { a.shadowMesh.visible = false; a.shadowMesh.castShadow = false; } }
    }
    // 切换的冲击波 + 透视时的镜片感
    this.pulse = Math.max(0, this.pulse - dt / 0.5);
    fxu.uShift.value = Math.max(this.pulse, this.peekK * 0.085);
    // 路标
    const L = S[0].level; const nx = this.cp + 1 < L.checkpoints.length ? L.checkpoints[this.cp + 1] : L.finish;
    this.beacon.visible = this.running && !this.done; this.beacon.position.set(nx.x, nx.y - 0.1, nx.z); this.beaconMat.opacity = 0.22 + 0.1 * Math.sin(g.time * 3);
    this.hud.frame(this, dt);
  }

  // ---------- 结算 ----------
  finish() {
    const g = this.g; if (this.done) return; this.done = true; this.peek = false;
    // 示范演示跑出来的时间不记入最佳成绩
    const t = this.t; const demo = !!g.auto; const record = !demo && (!this.best || t < this.best); if (record) { this.best = t; try { localStorage.setItem(BEST_KEY, String(t)); } catch (e) { /* 忽略 */ } }
    this.result = { t, record, demo, medal: MEDALS.find((m) => t <= m[0])[1] };
    g.state = 'ending'; g.timeScale = 0.25; g.audio.music('victory'); g.audio.play('victory_sting'); g.hud.announce('抵达信标 —— 试炼完成', 'good');
    g.after(0.9, () => { g.state = 'ended'; g.timeScale = 1; g.cinematic = true; g.input.unlock(); this.showEnd(); });
  }
  showEnd() {
    const g = this.g, e = g.hud.el, r = this.result, s = this.stats, gs = g.stats;
    e.end.classList.remove('lose'); e.endTitle.textContent = '试 炼 完 成'; e.endSub.textContent = r.demo ? '示范演示 · 不计入成绩' : r.record ? '新的最佳成绩' : '最佳成绩 ' + fmt(this.best);
    e.endScore.innerHTML = `<span class="f">${fmt(r.t)}</span> <small style="font-size:0.45em;letter-spacing:0.2em;opacity:0.8">${r.medal}牌</small>`;
    const items = [[s.shifts, '相位切换'], [s.executes, '相位处决'], [gs.kills, '击杀'], [gs.deaths, '阵亡'], [s.falls, '坠落'], [g.player.stats.walljumps, '蹬墙跳'], [g.player.stats.maxSpeed.toFixed(1), '最高速度 m/s'], [Math.round(g.player.stats.wallrunTime) + 's', '蹬墙时长']];
    e.endStats.innerHTML = items.map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('');
    g.hud.setState('ended');
  }
}

export { RIFT_NAME };
