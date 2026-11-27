// 比赛逻辑、镜头、把物理 / 画面 / 特效 / 界面 / 声音串起来
import * as THREE from 'three/webgpu';
import { Car, collideCars } from './physics.js';
import { Driver } from './ai.js';
import { CarView } from './cars.js';
import { HALF_W } from './track.js';
import { CAR_IDS, ATTRACT_RIVALS } from './carlist.js';
import { AutoPilot, driftZones } from './autopilot.js';

const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const wrapPi = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// 对手的发车位（水平、走线偏好）；车型每局从车库里随机挑 5 台不重复的
const SLOTS = [
  { skill: 0.925, bias: 0.3 }, { skill: 0.915, bias: -0.4 }, { skill: 0.905, bias: 0.2 }, { skill: 0.895, bias: -0.3 }, { skill: 0.885, bias: 0.5 },
];
export function pickRivals(playerSpec, n = SLOTS.length) {
  const pool = CAR_IDS.filter(id => id !== playerSpec);
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool.slice(0, n);
}
export const CAM_MODES = ['chase', 'far', 'roof', 'cockpit', 'tv', 'side', 'front', 'heli'];
export const CAM_NAMES = { chase: '追尾视角', far: '远追尾', roof: '车顶视角', cockpit: '驾驶位视角', tv: '场边电视机位', side: '低机位侧跟', front: '前方倒拍', heli: '高空跟拍' };
// 转向灵敏度档位（倍数）：方向打到位的快慢 + 中速时能打多大方向
export const STEER_SENS = [0.8, 1, 1.25, 1.5, 1.75];
// 自动切镜：漂移时优先切这些好看的机位；默认镜头池不含远追尾（和追尾太像）
const DRAMA = ['side', 'tv', 'front', 'chase', 'heli'];
const store = { get(k, d) { try { const v = localStorage.getItem('dusk_' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem('dusk_' + k, JSON.stringify(v)); } catch (e) { } } };

// ---------------- 镜头 ----------------
class CameraRig {
  constructor(camera, T, post) {
    this.camera = camera; this.T = T; this.post = post; this.heading = 0; this.fov = 55; this.distLag = 0; this.shake = 0; this.init = false;
    this.look = new THREE.Vector3(); this.pos = new THREE.Vector3(); this.spot = null; this.t = 0;
    // 场边机位：弯外侧缓冲区里放低机位，直道上放在草带上
    this.spots = [];
    const K = 17;
    for (let k = 0; k < K; k++) {
      const s = (k + 0.5) * T.L / K, i = T.idx(s);
      const gl = T.gravelMask[i] & 1, gr = T.gravelMask[i] & 2;
      let side, d, h;
      if (gl && T.dL[i] > 14) { side = 1; d = T.dL[i] - 2.4; h = 1.5; }
      else if (gr && T.dR[i] > 14) { side = -1; d = T.dR[i] - 2.4; h = 1.5; }
      else { side = k % 2 ? 1 : -1; d = HALF_W + 2.7; h = 1.1 + (k % 3) * 0.5; }
      const p = T.offset(s, side * d);
      this.spots.push({ s, x: p.x, y: p.y, h });
    }
  }
  snap() { this.init = false; this.spot = null; }
  update(dt, car, mode, orbit) {
    const cam = this.camera, T = this.T; this.t += dt;
    const v = car.speed, cy = Math.cos(car.yaw), sy = Math.sin(car.yaw);
    let fov = 55, cinematic = false, focus = 10, range = 30, bokeh = 0, shutter = 1 / 190, blurMax = 0.028;
    if (mode === 'orbit') {
      const a = orbit.angle, r = orbit.radius;
      this.pos.set(car.x + Math.cos(a) * r, orbit.height, -(car.y + Math.sin(a) * r)); this.look.set(car.x, 0.55, -car.y);
      fov = orbit.fov; cinematic = true; focus = Math.hypot(r, orbit.height - 0.55); range = focus * 0.9; bokeh = 5; shutter = 1 / 70; blurMax = 0.05;
      cam.position.copy(this.pos); cam.up.set(0, 1, 0); cam.lookAt(this.look);
    } else if (mode === 'tv') {
      // 选机位：车前方 15–130 m 内最近的那个；车开过去 50 m 后换下一个
      let sp = this.spot;
      const rel = sp ? T.deltaS(sp.s, car.s) : -999;
      if (!sp || rel < -9 || rel > 170) {          // 车一过机位就切到前方下一个，避免从车尾方向穿过烟雾拍
        let best = null, bd = 1e9;
        for (const q of this.spots) { const d = T.deltaS(q.s, car.s); if (d > 30 && d < bd) { bd = d; best = q; } }
        if (!best) for (const q of this.spots) { const d = T.deltaS(q.s, car.s) + (T.deltaS(q.s, car.s) < 30 ? T.L : 0); if (d < bd) { bd = d; best = q; } }
        if (best !== sp) { this.spot = sp = best; this.init = false; }
      }
      this.pos.set(sp.x, sp.h, -sp.y);
      const tx = car.x + (car.vx * cy - car.vy * sy) * 0.03, ty = car.y + (car.vx * sy + car.vy * cy) * 0.03;
      const target = new THREE.Vector3(tx, 0.62, -ty);
      if (!this.init) { this.look.copy(target); this.init = true; } else this.look.lerp(target, 1 - Math.exp(-dt * 26));      // 跟拍要紧，车身才清晰、背景才拉丝
      this.look.y += Math.sin(this.t * 2.3 + 1) * 0.008;
      const dist = this.pos.distanceTo(this.look);
      fov = clamp(2 * Math.atan(5.2 / (dist * cam.aspect)) * 180 / Math.PI, 3.2, 42);
      cinematic = true; focus = dist; range = Math.max(6, dist * 0.55); bokeh = clamp(9 - fov * 0.16, 2.5, 8.5); shutter = 1 / 55; blurMax = 0.06;
      cam.position.copy(this.pos); cam.up.set(0, 1, 0); cam.lookAt(this.look);
      this.fov = fov;
    } else if (mode === 'side' || mode === 'front' || mode === 'heli') {
      // 跟着赛道走的电影机位（位置按赛道坐标算，漂移时车在画面里横过来，机位不跟着甩）
      const s = car.s, dc = car.d;
      let ps, pd, h, look;
      if (mode === 'side') {                  // 低机位侧跟：车旁 6.5 m、离地 0.85 m，像拍摄车并排跟拍；不越过护栏
        const side = this.sideSign || 1, lim = (side > 0 ? T.barrierL(s) : T.barrierR(s)) - 1.0;
        ps = s - 1.2 + v * 0.03; pd = clamp(dc + side * 6.5, -lim, lim); h = 0.85;
        look = new THREE.Vector3(car.x, 0.55, -car.y);
      } else if (mode === 'front') {          // 前方倒拍：车前 9 m 往回拍
        ps = s + 9 + v * 0.1; pd = clamp(dc * 0.6, -HALF_W + 0.8, HALF_W - 0.8); h = 1.05;
        look = new THREE.Vector3(car.x, 0.6, -car.y);
      } else {                                // 高空跟拍：后上方 9 m 高，看车前方
        ps = s - 15 - v * 0.05; pd = dc * 0.5; h = 9;
        const q = T.offset(s + 7, dc * 0.8); look = new THREE.Vector3(q.x, 0.3, -q.y);
      }
      const p = T.offset(ps, pd), target = new THREE.Vector3(p.x, h, -p.y);
      if (!this.init) { this.pos.copy(target); this.look.copy(look); this.init = true; }
      else { this.pos.lerp(target, 1 - Math.exp(-dt * 7)); this.look.lerp(look, 1 - Math.exp(-dt * 18)); }
      const dist = this.pos.distanceTo(this.look);
      if (mode === 'heli') { fov = 50; shutter = 1 / 160; }
      else { fov = clamp(2 * Math.atan((mode === 'side' ? 3.6 : 3.0) / (dist * cam.aspect)) * 180 / Math.PI * 1.45, 18, 60); cinematic = true; focus = dist; range = Math.max(4, dist * 0.6); bokeh = 4; shutter = 1 / 60; blurMax = 0.05; }
      cam.position.copy(this.pos); cam.up.set(0, 1, 0); cam.lookAt(this.look);
      this.shake = Math.max(this.shake * Math.exp(-dt * 7), car.hitT < 0.05 ? Math.min(1, car.hitMag / 9) : 0);
      cam.rotation.x += (Math.random() - 0.5) * this.shake * 0.02;
      this.fov = fov;
    } else if (mode === 'cockpit' && this.view) {
      // 驾驶位：眼睛固定在车身（跟着侧倾俯仰），头稍微转向行进方向——漂移时看得到要去的地方
      const vw = this.view, body = vw.body; vw.root.updateMatrixWorld(true);       // 从车的根节点整条链更新：只更新车身节点会用上一帧的车位置，车速越高镜头落后越多（掉出座位）
      const beta = car.vx > 3 ? Math.atan2(car.vy, car.vx) : 0;
      const look = clamp(beta * 0.55, -0.6, 0.6);
      if (!this.init) { this.headYaw = look; this.init = true; }
      this.headYaw += (look - this.headYaw) * (1 - Math.exp(-dt * 6));
      this.pos.copy(vw.eye).applyMatrix4(body.matrixWorld);
      const dir = new THREE.Vector3(Math.sin(this.headYaw), -0.075, Math.cos(this.headYaw)).transformDirection(body.matrixWorld);
      const up = new THREE.Vector3(0, 1, 0).transformDirection(body.matrixWorld);
      this.look.copy(this.pos).add(dir);
      fov = 66 + Math.min(8, v * 0.1); shutter = 1 / 420; blurMax = 0.012;      // 车内的东西和镜头一起动：快门短一点，免得方向盘、仪表被拖糊
      cam.position.copy(this.pos); cam.up.copy(up); cam.lookAt(this.look);
      this.shake = Math.max(this.shake * Math.exp(-dt * 7), car.hitT < 0.05 ? Math.min(1, car.hitMag / 9) : 0);
      const amp = (v / 70) * (v / 70) * 0.0018 + this.shake * 0.02 + (car.offTrack ? 0.008 * Math.min(1, v / 20) : 0);
      cam.rotation.x += (Math.random() - 0.5) * amp; cam.rotation.z += (Math.random() - 0.5) * amp;
      this.fov = fov;
    } else {
      const beta = car.vx > 3 ? Math.atan2(car.vy, car.vx) : 0;
      if (mode === 'roof') {
        const hd = car.yaw + beta * 0.3;
        if (!this.init) { this.heading = hd; this.init = true; }
        this.heading += wrapPi(hd - this.heading) * (1 - Math.exp(-dt * 14));
        const px = car.x - cy * 0.25, py = car.y - sy * 0.25, hh = (car.spec.height || 1.3) + 0.08;
        this.pos.set(px, hh, -py);
        this.look.set(px + Math.cos(this.heading) * 20, hh - 2.2, -(py + Math.sin(this.heading) * 20));
        fov = 62 + Math.min(14, v * 0.2); shutter = 1 / 150;
        cam.position.copy(this.pos); cam.up.set(Math.sin(car.roll) * -sy * 0.8, 1, Math.sin(car.roll) * -cy * 0.8).normalize(); cam.lookAt(this.look);
      } else {
        const far = mode === 'far';
        const hd = car.yaw + beta * 0.74;                   // 镜头更跟随行进方向，漂移时能看到车身横过来
        if (!this.init) { this.heading = hd; this.init = true; this.distLag = 0; }
        this.heading += wrapPi(hd - this.heading) * (1 - Math.exp(-dt * 6.5));
        this.distLag += (clamp(car.axF * 0.045, -0.35, 0.4) - this.distLag) * (1 - Math.exp(-dt * 3));
        const dist = (far ? 8.6 : 5.5) + v * 0.011 + this.distLag, hgt = far ? 2.5 : 1.42;
        const ch = Math.cos(this.heading), sh = Math.sin(this.heading);
        this.pos.set(car.x - ch * dist, hgt, -(car.y - sh * dist));
        this.look.set(car.x + ch * 2.6, far ? 0.7 : 0.82, -(car.y + sh * 2.6));
        fov = (far ? 46 : 50) + Math.min(17, v * 0.25);
        cam.position.copy(this.pos); cam.up.set(0, 1, 0); cam.lookAt(this.look);
      }
      // 速度感：高速时的细微抖动 + 碰撞震动
      this.shake = Math.max(this.shake * Math.exp(-dt * 7), car.hitT < 0.05 ? Math.min(1, car.hitMag / 9) : 0);
      const amp = (v / 70) * (v / 70) * 0.0035 + this.shake * 0.03 + (car.offTrack ? 0.006 * Math.min(1, v / 20) : 0);
      cam.rotation.x += (Math.random() - 0.5) * amp; cam.rotation.z += (Math.random() - 0.5) * amp; cam.position.y += (Math.random() - 0.5) * amp * 0.6;
      this.fov += (fov - this.fov) * (1 - Math.exp(-dt * 5)); fov = this.fov;
    }
    const near = mode === 'cockpit' ? 0.03 : 0.12;          // 驾驶位离仪表台只有几十厘米
    if (Math.abs(cam.fov - fov) > 0.01 || cam.near !== near) { cam.fov = fov; cam.near = near; cam.updateProjectionMatrix(); }
    const U = this.post.U;
    this.post.setCinematic(cinematic);
    U.focus.value = focus; U.focalLen.value = range; U.bokeh.value = bokeh;
    U.blur.value = clamp(shutter / Math.max(dt, 1 / 240), 0.1, 2.2); U.blurMax.value = blurMax;
  }
}

// ---------------- 比赛 ----------------
export class Game {
  constructor(ctx) {
    Object.assign(this, ctx);       // scene camera T W env post quality carAssets input hud audio fx
    this.entries = []; this.state = 'menu'; this.camMode = 'chase'; this.rig = new CameraRig(this.camera, this.T, this.post);
    this.profile = this.T.speedProfile(0.95, 5.0, 8.5, 68);
    this.laps = 3; this.playerSpec = 'e30'; this.time = 0; this.orbit = { angle: 0.6, radius: 7.5, height: 1.25, fov: 28 };
    this.drift = { active: false, points: 0, total: 0, mult: 1, grace: 0, t: 0, lostT: 9, bankT: 9, banked: 0 };
    this.msg = { text: '', t: 0 };
    this.sensI = clamp(store.get('sens', 2), 0, STEER_SENS.length - 1);
    this.auto = false; this.zones = driftZones(this.T);
    this.director = { on: false, t: 0, dur: 0, wasDrift: false, pool: store.get('pool', ['chase', 'roof', 'cockpit', 'tv', 'side', 'front', 'heli']).filter(m => CAM_MODES.includes(m)) };
    this.setupRace(this.playerSpec, this.laps, true);
  }
  say(text, dur = 2.2) { this.msg.text = text; this.msg.t = dur; }

  setupRace(playerSpec, laps, attract = false, solo = false, rivals = null) {
    for (const e of this.entries) this.scene.remove(e.view.root);
    this.entries = []; this.fx.clear();
    this.playerSpec = playerSpec; this.laps = laps; this.attract = attract; this.solo = solo && !attract;
    rivals = (rivals || this.rivals || ATTRACT_RIVALS).filter(id => id !== playerSpec && this.carAssets[id]).slice(0, SLOTS.length);
    this.rivals = rivals;
    const lineup = this.solo ? [] : rivals.map((spec, i) => ({ spec, hue: 0, ...SLOTS[i] }));
    lineup.push({ spec: playerSpec, hue: 0, skill: 0.92, bias: 0, player: true });
    lineup.forEach((def, n) => {
      const car = new Car(def.spec, { isPlayer: !!def.player, id: n, steerSens: def.player ? STEER_SENS[this.sensI] : 1 });
      const g = this.T.gridSlot(n); car.reset(g.x, g.y, g.h); car.s = g.s; car.d = g.d;
      const view = new CarView(this.carAssets[def.spec], car, { hue: def.hue });
      this.scene.add(view.root); view.update(0.016);
      const driver = new Driver(car, this.T, this.profile, { skill: def.skill, lineBias: def.bias });
      this.entries.push({ car, view, driver, def, player: !!def.player, lap: 0, sector: 2, lapStart: 0, lapTimes: [], best: 0, finished: false, finishTime: 0, progress: g.s - this.T.L, baseSkill: def.skill, pos: n + 1 });
    });
    this.player = this.entries[this.entries.length - 1];
    this.player.pilot = new AutoPilot(this.player.car, this.T, this.profile, { zones: this.zones, onStuck: () => this.resetPlayer() });
    this.time = 0; this.raceTime = 0; this.cd = 0; this.resetCool = 0;
    Object.assign(this.drift, { active: false, points: 0, total: 0, mult: 1, grace: 0, t: 0, lostT: 9, bankT: 9, banked: 0 });
    for (const l of this.W.lights) l.emissiveIntensity = 0;
    this.rig.snap();
    if (attract) { this.state = 'menu'; for (const e of this.entries) e.lap = 1; }
    else { this.state = 'countdown'; this.cd = 0; }
    this.hud.setMode(this.state);
  }

  // 开赛前先把这局要用的车加载好（没加载过的车第一次要等一两秒）
  async startRace() {
    if (this.loadingCars) return;
    this.audio && this.audio.unlock();
    const solo = this.hud.rivals === 0, rivals = solo ? [] : pickRivals(this.playerSpec), need = [this.playerSpec, ...rivals];
    if (!this.carAssets.has(need)) {
      this.loadingCars = true; this.hud.setLoading(true);
      try { await this.carAssets.load(need); } finally { this.loadingCars = false; this.hud.setLoading(false); }
    }
    this.setupRace(this.playerSpec, this.laps, false, solo, solo ? null : rivals); this.camMode = 'chase';
  }
  toMenu() { this.setupRace(this.playerSpec, this.laps, true); }

  resetPlayer() {
    const c = this.player.car, T = this.T, s = c.s, d = clamp(c.d, -3, 3), p = T.offset(s, d);
    c.reset(p.x, p.y, p.h, 0); c.trackI = T.idx(s); c.s = s; c.d = d; this.resetCool = 1.5; this.drift.active = false; this.drift.points = 0; this.rig.snap(); this.say('已复位');
  }

  update(dt) {
    const { input, T, hud } = this;
    this.time += dt; if (this.msg.t > 0) this.msg.t -= dt;
    // ---- 全局按键 ----
    if (this.state === 'menu') {
      if (input.pressed('ArrowLeft', 'KeyA')) hud.pickCar(-1);
      if (input.pressed('ArrowRight', 'KeyD')) hud.pickCar(1);
      if (input.pressed('ArrowUp', 'KeyW')) hud.pickLaps(1);
      if (input.pressed('ArrowDown', 'KeyS')) hud.pickLaps(-1);
      if (input.pressed('KeyO')) hud.toggleRivals();
      if (input.pressed('Enter', 'Space')) { this.playerSpec = hud.car; this.laps = hud.laps; this.startRace(); }
    } else if (this.state === 'pause') {
      if (input.pressed('Escape', 'KeyP', 'Enter')) { this.state = this.prevState; hud.setMode(this.state); }
      if (input.pressed('KeyQ')) this.toMenu();
      input.endFrame(); return this.render(0);
    } else {
      if (input.pressed('Escape', 'KeyP')) { this.prevState = this.state; this.state = 'pause'; hud.setMode('pause'); input.endFrame(); return this.render(0); }
      if (input.pressed('KeyV')) { if (this.camMode === 'cockpit') this.camMode = this._camBack || 'chase'; else { this._camBack = this.camMode; this.camMode = 'cockpit'; } this.rig.snap(); this.say(CAM_NAMES[this.camMode], 1.4); }
      if (input.pressed('KeyC')) { this.camMode = CAM_MODES[(CAM_MODES.indexOf(this.camMode) + 1) % CAM_MODES.length]; this.rig.snap(); this.say(CAM_NAMES[this.camMode], 1.4); }
      if (input.pressed('KeyR') && this.state === 'race' && this.resetCool <= 0) this.resetPlayer();
      if (input.pressed('KeyX')) { this.auto = !this.auto; this.player.pilot.phase = 'cruise'; this.say(this.auto ? '自动驾驶 开（X 关闭）' : '自动驾驶 关', 2); }
      if (input.pressed('KeyN')) { const D = this.director; D.on = !D.on; D.t = 0; D.dur = 0; this.say(D.on ? '自动切镜 开（数字键选镜头会关掉）' : '自动切镜 关', 2); }
      for (let k = 0; k < CAM_MODES.length; k++) if (input.pressed('Digit' + (k + 1), 'Numpad' + (k + 1))) {
        const m = CAM_MODES[k], D = this.director;
        if (input.keys.has('ShiftLeft') || input.keys.has('ShiftRight')) {      // Shift + 数字：把这个镜头加入 / 移出自动切镜的镜头池
          const i = D.pool.indexOf(m); if (i >= 0) { if (D.pool.length > 1) D.pool.splice(i, 1); } else D.pool.push(m);
          store.set('pool', D.pool); this.say(`切镜池：${D.pool.map(x => CAM_MODES.indexOf(x) + 1).sort().join(' ')}（${D.pool.includes(m) ? '加入' : '移出'} ${CAM_NAMES[m]}）`, 2.6);
        } else { D.on = false; this.camMode = m; this.sideFor(); this.rig.snap(); this.say(`${k + 1} · ${CAM_NAMES[m]}`, 1.4); }
      }
      if (this.state === 'finish' && input.pressed('Enter')) this.startRace();
      if (this.state === 'finish' && input.pressed('KeyQ')) this.toMenu();
    }
    if (input.pressed('KeyM') && this.audio) { this.audio.toggleMute(); this.say(this.audio.muted ? '静音' : '声音开', 1.2); }
    if (input.pressed('KeyH')) hud.toggle();
    for (const [code, dir] of [['BracketLeft', -1], ['BracketRight', 1]]) if (input.keys.has(code) && !this['_sk' + code]) {
      this.sensI = clamp(this.sensI + dir, 0, STEER_SENS.length - 1); store.set('sens', this.sensI);
      if (this.player) this.player.car.steerSens = STEER_SENS[this.sensI];
      this.say(`转向灵敏度 ${this.sensI + 1} / ${STEER_SENS.length}（×${STEER_SENS[this.sensI]}）`, 1.8);
    }
    this._skBracketLeft = input.keys.has('BracketLeft'); this._skBracketRight = input.keys.has('BracketRight');
    this.resetCool -= dt;

    // ---- 倒计时 ----
    if (this.state === 'countdown') {
      this.cd += dt;
      const lit = clamp(Math.floor((this.cd - 0.9) / 0.8) + 1, 0, 5);
      this.W.lights.forEach((l, k) => l.emissiveIntensity = k < lit ? 14 : 0);
      if (lit !== this._lit) { this._lit = lit; if (lit > 0 && this.audio) this.audio.beep(520, 0.12); }
      if (this.cd > 0.9 + 0.8 * 5 + 0.5) { this.state = 'race'; this.raceTime = 0; this.W.lights.forEach(l => l.emissiveIntensity = 0); for (const e of this.entries) e.lapStart = 0; hud.setMode('race'); this.audio && this.audio.beep(1040, 0.5); this.say('出发！', 1.2); }
    }
    const racing = this.state === 'race' || this.state === 'finish' || this.state === 'menu';
    if (this.state === 'race' || this.state === 'finish') this.raceTime += dt;

    // ---- 物理 ----
    const pin = input.read();
    const sub = Math.max(1, Math.ceil(dt / (1 / 240))), h = dt / sub, cars = this.entries.map(e => e.car);
    const hold = { steerAngle: 0, throttle: 0, brake: 0, handbrake: true };
    for (let k = 0; k < sub; k++) {
      for (const e of this.entries) {
        let inp;
        if (!racing) inp = hold;
        else if (e.player && !this.attract && this.state === 'race') inp = this.auto ? e.pilot.update(h, cars) : { steer: pin.steer, throttle: pin.throttle, brake: pin.brake, handbrake: pin.handbrake, analog: pin.analog, tc: true, arcade: true };
        else inp = e.driver.update(h, cars);
        e.car.step(h, inp, T);
      }
      collideCars(cars);
    }
    // ---- 圈数 / 名次 ----
    const pl = this.player;
    for (const e of this.entries) {
      const c = e.car, sec = Math.min(2, Math.floor(c.s / (T.L / 3)));
      if (sec === (e.sector + 1) % 3) {
        if (sec === 0) {
          if (e.lap >= 1 && !this.attract) { const lt = this.raceTime - e.lapStart; e.lapTimes.push(lt); if (!e.best || lt < e.best) e.best = lt; if (e.player) this.say(`第 ${e.lap} 圈  ${fmt(lt)}`, 3); }
          e.lapStart = this.raceTime; e.lap++;
          // 自动驾驶时不结束比赛，一直跑下去方便录制
          if (!this.attract && e.lap > this.laps && !e.finished && !(e.player && this.auto)) { e.finished = true; e.finishTime = this.raceTime; if (e.player) this.finish(); }
        }
        e.sector = sec;
      }
      e.progress = (e.lap - 1) * T.L + c.s - (e.lap === 0 ? 0 : 0);
      if (e.lap === 0) e.progress = c.s - T.L;
      else if (e.sector === 2 && c.s < T.L / 3) e.progress += 0;   // 过线瞬间由圈数处理
      // AI 橡皮筋：离玩家太远就稍微放慢 / 加快
      if (!e.player && !this.attract) e.driver.skill = e.baseSkill + clamp((pl.progress - e.progress) / 500, -0.05, 0.045);
    }
    const order = [...this.entries].sort((a, b) => (b.finished ? 1e9 - b.finishTime : b.progress) - (a.finished ? 1e9 - a.finishTime : a.progress));
    order.forEach((e, k) => e.pos = k + 1);

    // ---- 漂移计分 ----
    if (this.state === 'race') this.updateDrift(dt);

    this.render(dt, pin);
    input.endFrame();
  }

  updateDrift(dt) {
    const c = this.player.car, D = this.drift, b = Math.abs(c.beta), v = c.speed;
    D.lostT += dt; D.bankT += dt;
    const sliding = b > 0.21 && v > 11 && !c.offTrack && c.vx > 0;
    if (c.hitT < 0.02 && c.hitMag > 2 || (c.offTrack && D.active)) { if (D.points > 50) { D.lostT = 0; D.lost = D.points; } D.active = false; D.points = 0; D.t = 0; return; }
    if (sliding) { D.active = true; D.grace = 0.9; D.t += dt; D.mult = 1 + Math.min(4, Math.floor(D.t / 2) * 0.5); D.points += v * Math.min(b, 0.9) * 9 * D.mult * dt; }
    else if (D.active) { D.grace -= dt; if (D.grace <= 0) { if (D.points > 30) { D.total += Math.round(D.points); D.banked = Math.round(D.points); D.bankT = 0; } D.active = false; D.points = 0; D.t = 0; } }
  }

  // 自动切镜：每个镜头 4–8 秒；车一甩尾就从"平淡"的机位切到侧跟 / 场边 / 倒拍这类好看的机位
  direct(dt, car) {
    const D = this.director; D.t += dt;
    const startDrift = car.drifting && !D.wasDrift; D.wasDrift = car.drifting;
    const calm = !DRAMA.includes(this.camMode);
    if (D.t > D.dur || (startDrift && calm && D.t > 1.2) || !D.pool.includes(this.camMode)) {
      const drama = D.pool.filter(m => DRAMA.includes(m) && m !== this.camMode);
      let cand = (car.drifting || startDrift) && drama.length ? drama : D.pool.filter(m => m !== this.camMode);
      if (!cand.length) cand = D.pool;
      this.camMode = cand[Math.floor(Math.random() * cand.length)];
      D.t = 0; D.dur = (this.camMode === 'tv' ? 6 : this.camMode === 'cockpit' ? 5.5 : 4) + Math.random() * 3;
      this.sideFor(); this.rig.snap();
    }
    return this.camMode;
  }
  // 侧跟机位放在哪一边：前方有漂移弯就放弯外侧（拍到车侧面横着滑），否则随机
  sideFor() {
    const c = this.player.car; let side = Math.random() < 0.5 ? 1 : -1;
    for (const z of this.zones) { const d = this.T.deltaS(z.s0, c.s); if (d > -z.len && d < 90) { side = -z.dir; break; } }
    this.rig.sideSign = side;
  }

  finish() {
    this.state = 'finish'; this.camMode = 'tv'; this.rig.snap();
    const p = this.player; if (this.drift.points > 30) this.drift.total += Math.round(this.drift.points);
    this.hud.showResults({ pos: p.pos, total: this.entries.length, time: p.finishTime, best: p.best, drift: this.drift.total, laps: p.lapTimes });
    this.hud.setMode('finish');
  }

  render(dt, pin) {
    const pl = this.player, pc = pl.car;
    if (dt > 0) {
      for (const e of this.entries) {
        e.view.update(dt);
        const dx = e.car.x - pc.x, dy = e.car.y - pc.y;
        this.fx.emitFromCar(e.car, dt, dx * dx + dy * dy < 160 * 160);
      }
      // 镜头
      let mode = this.camMode, target = pc;
      if (this.state === 'menu') { mode = 'tv'; target = this.entries[Math.min(this.entries.length - 1, Math.floor(this.time / 14) % 3 + 1)].car; }
      if (this.state === 'countdown') { mode = this.cd < 3.2 ? 'orbit' : this.camMode; this.orbit.angle = pc.yaw + Math.PI * 0.82 - this.cd * 0.42; this.orbit.radius = 7.2 - this.cd * 0.25; if (this.cd >= 3.2 && !this._snapped) { this.rig.snap(); this._snapped = true; } } else this._snapped = false;
      if (this.director.on && (this.state === 'race' || this.state === 'finish')) mode = this.direct(dt, pc);
      this.focus = this.entries.find(e => e.car === target) || pl;       // 镜头跟拍的车：反射探针放在它身上
      this.rig.view = this.focus.view;
      for (const e of this.entries) e.view.setCockpit(mode === 'cockpit' && e === this.focus);
      this.rig.update(dt, target, mode, this.orbit);
      const cp = this.camera.position; for (const e of this.entries) { const dx = e.car.x - cp.x, dz = -e.car.y - cp.z; e.view.setCastShadow(dx * dx + dz * dz < 70 * 70); }    // 远处的车不投影
      this.fx.update(dt, this.camera);
      this.fx.beginLamps(); for (const e of this.entries) { e.view.root.updateMatrixWorld(); e.view.writeLamps(this.fx, cp); } this.fx.endLamps();
    }
    this.W.update(this.camera);
    if (this.trees) this.trees.update(this.camera);
    // 界面
    const D = this.drift;
    this.hud.update({
      state: this.state, speed: pc.speed * 3.6, gear: pc.reverse ? 'R' : pc.gear, rpm: pc.rpm, redline: pc.spec.redline, throttle: pc.throttle, brake: pc.brake,
      lap: clamp(pl.lap, 1, this.laps), laps: this.laps, pos: pl.pos, total: this.entries.length, time: this.raceTime - pl.lapStart, raceTime: this.raceTime, best: pl.best, last: pl.lapTimes[pl.lapTimes.length - 1] || 0,
      drift: D, msg: this.msg.t > 0 ? this.msg.text : '', cd: this.cd, entries: this.entries, player: pl, offTrack: pc.offTrack, cam: this.camMode,
    }, dt);
    if (this.audio && dt > 0) this.audio.update(dt, pc, this.state, this.entries, this.camera);
  }
}

export function fmt(t) { if (!t || t <= 0) return '--:--.---'; const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(3).padStart(6, '0')}`; }
