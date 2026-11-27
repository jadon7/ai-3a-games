import * as THREE from 'three';
import { loadWorld, B, LAYER } from './world.js';
import { Pipeline } from './render.js';
import { G } from './materials.js';
import { Player, MAG } from './player.js';
import { Enemies, Nav } from './enemies.js';
import { Effects } from './effects.js';
import { HUD } from './hud.js';
import { SFX } from './sfx.js';

const qs = new URLSearchParams(location.search);
const lbar = document.getElementById('lbar'), lmsg = document.getElementById('lmsg');
const progress = (f, m) => { lbar.style.width = (f * 100).toFixed(0) + '%'; if (m) lmsg.textContent = m + '…'; };
const rnd = (a, b) => a + Math.random() * (b - a);

const canvas = document.getElementById('gl');
const hudCanvas = document.getElementById('hud');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
renderer.toneMapping = THREE.NoToneMapping;
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
window.renderer = renderer;

async function loadLUT() {
  const meta = await fetch('./assets/lut_agx_mhc.json').then((r) => r.json());
  const img = new Image(); img.src = './assets/lut_agx_mhc.png'; await img.decode();
  const N = meta.N; const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, img.width, img.height).data;
  const out = new Uint8Array(N * N * N * 4);
  for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) {
    const si = (g * img.width + r + N * b) * 4, di = ((b * N + g) * N + r) * 4;
    out[di] = px[si]; out[di + 1] = px[si + 1]; out[di + 2] = px[si + 2]; out[di + 3] = 255;
  }
  return { out, N };
}

const PLAYER_SPAWNS = [[-3.6, -0.5, 80], [3.5, -9, 95], [-8.0, 58, -90], [8.0, 58, -90], [0, 52, -90], [-8.8, 20, 0], [8.8, 30, 180]];
const SCORE_LIMIT = 30, MATCH_TIME = 8 * 60;

class Game {
  constructor() {
    this.mode = 'loading'; this.t = 0; this.score = { us: 0, them: 0, limit: SCORE_LIMIT, timeLeft: MATCH_TIME };
    this.killfeed = []; this.hits = []; this.kills = []; this.damage = []; this.streak = 0; this.lastKillT = -9; this.xp = 0.35;
    this.respawnIn = 0; this.spawnTimers = []; this.keys = {}; this.mouse = { l: false, r: false }; this.lookDX = 0; this.lookDY = 0;
  }

  async boot() {
    this.world = await loadWorld(renderer, (f, m) => progress(f * 0.7, m));
    const scene = this.scene = new THREE.Scene();
    scene.add(this.world.root, this.world.sky, this.world.collMesh);
    progress(0.72, '色彩管线');
    const lut = await loadLUT();
    this.pipe = new Pipeline(renderer, this.world);
    this.pipe.setLUT(lut.out, lut.N);
    this.cam = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.03, 600);
    this.cam.layers.enable(0); this.cam.layers.enable(LAYER.FLOOR); this.cam.layers.enable(LAYER.DYN); this.cam.layers.enable(LAYER.FX);
    this.cam.layers.enable(LAYER.VM);
    this.sfx = new SFX();
    progress(0.75, '音效');
    await this.sfx.load('./assets/sfx/').catch((e) => console.warn('sfx', e));
    this.fx = new Effects(scene, this.world);
    this.player = new Player(this.world, this.cam, this.sfx, this.fx);
    this.player.renderer = renderer; this.renderer = renderer;
    progress(0.8, '武器');
    await this.player.load();
    this.fx.setVMScene(this.player.vmScene);
    this.fx.onCasingLand = (p) => this.sfx.casing(p.toArray(), 0);
    progress(0.86, '寻路');
    this.nav = new Nav(this.world);
    progress(0.9, '敌人');
    this.enemiesMgr = new Enemies(this);
    await this.enemiesMgr.load();
    this.hud = new HUD(hudCanvas);
    window.game = this; window.G = G; window.pipe = this.pipe;
    this.bindInput();
    this.resize();
    addEventListener('resize', () => this.resize());
    this.resetMatch();
    this.mode = 'menu';
    // warm up shaders
    renderer.compile(scene, this.cam); renderer.compile(this.player.vmScene, this.cam);
    document.getElementById('loading').style.display = 'none';
    this.last = performance.now();
    if (qs.has('shot')) this.setupShot();
    if (qs.has('bot')) this.setupBot();
    requestAnimationFrame((n) => this.loop(n));
  }

  // automated soak test: auto-aim bot plays for N seconds, then posts a report to the local capture server
  setupBot() {
    const errs = []; addEventListener('error', (e) => errs.push(String(e.message))); addEventListener('unhandledrejection', (e) => errs.push(String(e.reason)));
    this.mode = 'playing'; const T0 = performance.now(), dur = Number(qs.get('bot')) || 30; let frames = 0, deaths = 0, wasAlive = true, minFps = 999, reloads = 0;
    const tick = () => {
      frames++;
      const p = this.player;
      if (wasAlive && !p.alive) deaths++; wasAlive = p.alive;
      if (p.reloading >= 0 && !this._rl) reloads++; this._rl = p.reloading >= 0;
      if (this.mode === 'playing' && p.alive) {
        let best = null, bd = 1e9;
        for (const e of this.enemies) { if (!e.alive || !e._vis) continue; const d = e.pos.distanceTo(p.pos); if (d < bd) { bd = d; best = e; } }
        if (best) { const d = best.chestPos.sub(this.cam.position); p.yaw = Math.atan2(-d.x, -d.z); p.pitch = Math.atan2(d.y, Math.hypot(d.x, d.z)); this.mouse.r = true; this.mouse.l = Math.random() < 0.8; this.keys.KeyW = false; }
        else { this.mouse.l = false; this.mouse.r = false; p.yaw += 0.02; this.keys.KeyW = Math.random() < 0.7; }
        this.keys.KeyR = p.ammo === 0;
      }
      if (this.fps) minFps = Math.min(minFps, this.fps);
      const el = (performance.now() - T0) / 1000;
      if (qs.has('force') && !this._f1 && el > 4) { this._f1 = 1; p.ammo = 0; }
      if (qs.has('force') && !this._f2 && el > 9) { const e = this.enemies.find((x) => x.alive); if (e) { this._f2 = 1; this.playerHit(500, e); } }
      if (el < dur) return;
      this._botTick = null;
      const rep = { errs: errs.slice(0, 10), score: this.score, deaths, reloads, frames, avgFps: frames / ((performance.now() - T0) / 1000), minFps,
        killfeed: this.killfeed.map((k) => k.killer + '>' + k.victim), decals: this.fx.decals.length, mode: this.mode, health: Math.round(this.player.health), ammo: this.player.ammo, reserve: this.player.reserve };
      fetch('http://localhost:8799/', { method: 'POST', body: JSON.stringify({ name: 'bot_report.json', data: 'data:application/json;base64,' + btoa(unescape(encodeURIComponent(JSON.stringify(rep, null, 1)))) }) });
    };
    this._botTick = tick;
  }

  // offline capture mode for documentation: ?shot=name&cam=x,y,yawDeg,pitchDeg[&ads=1][&enemy=x,y,headingDeg][&fire=1]
  setupShot() {
    this.mode = 'playing'; this.spawnTimers = []; this.enemiesMgr.spawnOne = () => null;
    const c = qs.get('cam').split(',').map(Number);
    const p = this.player; p.pos.copy(B(c[0], c[1], 0.0)); p.yaw = (c[2] - 90) * Math.PI / 180; p.pitch = c[3] * Math.PI / 180;
    p.updateCamera(0, 0);
    if (qs.has('enemy')) {
      const ev = qs.get('enemy').split(',').map(Number);
      const e = this.enemies[ev[3] | 0];
      e.spawn({ p: B(ev[0], ev[1], ev[4] || 0), lvl: 0, tag: '', nb: [] }, 'Viper_77');
      e.canSee = () => true; e.heading = ev[2] * Math.PI / 180; e.crouchAim = !!ev[5]; e.reaction = 0;
      const orig = Object.getPrototypeOf(e).update;
      e.update = function (dt, t) { this.state = 'engage'; this.stateT = 0; this.bursts = 0; this.nextShot = 1e9; this.seen = 2; orig.call(this, dt, t); };
    }
    if (qs.has('ads')) this.mouse.r = true;
    if (qs.has('debug')) G.uDebug.value = Number(qs.get('debug'));
    if (qs.has('novm')) this.player.vm.visible = false;
    let n = 0;
    const frames = Number(qs.get('frames') || 90);
    this._shotTick = () => {
      n++;
      p.pitch = c[3] * Math.PI / 180; p.yaw = (c[2] - 90) * Math.PI / 180; p.recP = 0; p.recY = 0;
      if (qs.has('fire') && n === frames - 1) { this.player.cool = 0; this.mouse.l = true; }
      if (n === frames) {
        this.mouse.l = false;
        window._capture = (gl, hud) => {
          const cv = document.createElement('canvas'); cv.width = 1920; cv.height = 1080; const x = cv.getContext('2d');
          x.drawImage(gl, 0, 0, 1920, 1080); x.drawImage(hud, 0, 0, 1920, 1080);
          fetch('http://localhost:8799/', { method: 'POST', body: JSON.stringify({ name: qs.get('shot') + '.jpg', data: cv.toDataURL('image/jpeg', 0.93) }) })
            .then(() => { document.title = 'SHOT_DONE'; });
        };
      }
    };
  }

  resize() {
    this.pipe.resize(innerWidth, innerHeight);
    this.cam.aspect = innerWidth / innerHeight; this.cam.updateProjectionMatrix();
    this.hud.resize(innerWidth, innerHeight, Math.min(devicePixelRatio || 1, 2));
  }

  bindInput() {
    addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    addEventListener('mousedown', (e) => {
      if (this.mode !== 'playing' && this.mode !== 'dead') return;
      if (e.button === 0) this.mouse.l = true; if (e.button === 2) this.mouse.r = true;
    });
    addEventListener('mouseup', (e) => { if (e.button === 0) this.mouse.l = false; if (e.button === 2) this.mouse.r = false; });
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => { if (document.pointerLockElement === canvas) { this.lookDX += e.movementX; this.lookDY += e.movementY; } });
    const click = () => {
      this.sfx.unlock(); this.sfx.startAmbience();
      if (this.mode === 'menu' || this.mode === 'paused') { canvas.requestPointerLock(); this.mode = 'playing'; }
      else if (this.mode === 'victory') { this.resetMatch(); canvas.requestPointerLock(); this.mode = 'playing'; }
      else if (document.pointerLockElement !== canvas) canvas.requestPointerLock();
    };
    hudCanvas.style.pointerEvents = 'none';
    canvas.addEventListener('click', click);
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== canvas && this.mode === 'playing') { this.mode = 'paused'; this.mouse.l = this.mouse.r = false; }
    });
  }

  resetMatch() {
    this.t = 0; this.score.us = 0; this.score.them = 0; this.score.timeLeft = MATCH_TIME;
    this.killfeed.length = 0; this.hits.length = 0; this.kills.length = 0; this.damage.length = 0; this.streak = 0;
    for (const e of this.enemies) { e.alive = false; e.root.visible = false; e.rifle.visible = false; }
    const s = PLAYER_SPAWNS[0];
    this.player.spawn(B(s[0], s[1], 0.05), s[2]);
    this.spawnTimers = [1.5, 3.0, 4.5];
  }

  respawnPlayer() {
    let best = null, bs = -1;
    for (const s of PLAYER_SPAWNS) {
      const p = B(s[0], s[1], 0.05);
      const dmin = Math.min(99, ...this.enemies.filter((e) => e.alive).map((e) => e.pos.distanceTo(p)));
      const sc = dmin + rnd(0, 6);
      if (sc > bs) { bs = sc; best = s; }
    }
    this.player.spawn(B(best[0], best[1], 0.05), best[2]);
    this.mode = 'playing';
  }

  playerHit(dmg, enemy) {
    const p = this.player; if (!p.alive || this.mode !== 'playing') return;
    if (qs.has('god')) dmg = 0;
    p.damage(dmg, this.t);
    this.damage.push({ t: this.t, srcX: enemy.pos.x, srcY: -enemy.pos.z });
    this.sfx.hurt();
    if (!p.alive) {
      this.killfeed.push({ t: this.t, killer: enemy.name, victim: '大师', headshot: false });
      this.score.them++; this.streak = 0;
      this.mode = 'dead'; this.respawnIn = 4.0; this.mouse.l = false; this.mouse.r = false;
      this.sfx.setLowHealth(false);
    }
  }

  resolveShot(s) {
    const fx = this.fx, p = this.player;
    fx.muzzleFlash(s.muzzle, s.dir, 1, true, true);
    fx.casing(s.eject, s.right.clone().multiplyScalar(rnd(1.6, 2.6)).addScaledVector(s.up, rnd(1.0, 1.8)).addScaledVector(s.dir, rnd(-0.4, 0.2)), p.pos.y);
    const ray = new THREE.Ray(s.origin, s.dir);
    const wh = this.world.bvh.raycastFirst(ray, THREE.DoubleSide, 0, 200);
    const wd = wh ? wh.distance : 200;
    const eh = this.enemiesMgr.raycast(ray, wd);
    if (eh) {
      const e = eh.e; const hp = ray.at(eh.t, new THREE.Vector3());
      const dmg = eh.part === 'head' ? 100 : eh.part === 'body' ? 34 : 24;
      const killed = e.hit(dmg, s.dir, hp);
      fx.bloodHit(hp, s.dir);
      this.sfx.fleshHit(hp.toArray());
      this.sfx.hitTick(killed);
      this.hits.push({ t: this.t, kill: killed, headshot: eh.part === 'head' });
      // blood spatter on the surface behind
      const r2 = new THREE.Ray(hp, s.dir); const bh = this.world.bvh.raycastFirst(r2, THREE.DoubleSide, 0, 2.5);
      if (bh && Math.random() < 0.6) fx.addDecal('blood', bh.point, bh.face.normal.clone(), rnd(0.25, 0.5));
      if (killed) {
        this.streak = this.t - this.lastKillT < 4.5 ? this.streak + 1 : 1; this.lastKillT = this.t;
        this.kills.push({ t: this.t, streak: this.streak });
        this.killfeed.push({ t: this.t, killer: '大师', victim: e.name, headshot: eh.part === 'head' });
        this.score.us++; this.xp = (this.xp + 0.09) % 1;
        if (this.streak >= 2) this.sfx.medal();
        this.spawnTimers.push(rnd(2.5, 4.5));
      }
    } else if (wh) {
      fx.impact(wh.point, wh.face.normal.clone(), wh.point.y > 9 ? 'metal' : 'plaster', true);
      if (Math.random() < 0.5) this.sfx.impact(wh.point.toArray());
    }
  }

  input() {
    const k = this.keys, m = this.mouse;
    return {
      fwd: (k.KeyW ? 1 : 0) - (k.KeyS ? 1 : 0), right: (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0),
      sprint: !!(k.ShiftLeft || k.ShiftRight), crouch: !!(k.KeyC || k.ControlLeft), jump: !!k.Space,
      reload: !!k.KeyR, fire: m.l, ads: m.r,
    };
  }

  loop(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    if (this._shotTick) this._shotTick();
    if (this._botTick) this._botTick();
    const playing = this.mode === 'playing' || this.mode === 'dead';
    if (playing) {
      this.t += dt; this.score.timeLeft = Math.max(0, MATCH_TIME - this.t);
      if (this.mode === 'playing') this.player.look(this.lookDX, this.lookDY);
      const inp = this.mode === 'playing' ? this.input() : { fwd: 0, right: 0 };
      const shots = this.player.update(dt, inp, this.t);
      for (const s of shots) this.resolveShot(s);
      this.enemiesMgr.update(dt, this.t);
      // spawning
      for (let i = this.spawnTimers.length - 1; i >= 0; i--) {
        this.spawnTimers[i] -= dt;
        if (this.spawnTimers[i] <= 0) { if (this.enemiesMgr.spawnOne(this.t)) this.spawnTimers.splice(i, 1); else this.spawnTimers[i] = 1; }
      }
      const alive = this.enemies.filter((e) => e.alive).length;
      const want = Math.min(5, 3 + Math.floor(this.score.us / 8));
      if (alive + this.spawnTimers.length < want) this.spawnTimers.push(rnd(1.5, 3.5));
      if (this.mode === 'dead') { this.respawnIn -= dt; if (this.respawnIn <= 0) this.respawnPlayer(); }
      this.sfx.setLowHealth(this.player.alive && this.player.health < 35);
      if (this.score.us >= SCORE_LIMIT || this.score.them >= SCORE_LIMIT || this.score.timeLeft <= 0) {
        this.mode = 'victory'; document.exitPointerLock?.();
      }
    } else {
      this.player.updateCamera(dt, this.t);
    }
    this.lookDX = 0; this.lookDY = 0;
    this.fx.update(dt, this.cam.position);
    // audio listener
    const f = new THREE.Vector3(0, 0, -1).applyQuaternion(this.cam.quaternion), u = new THREE.Vector3(0, 1, 0).applyQuaternion(this.cam.quaternion);
    this.sfx.setListener(this.cam.position.x, this.cam.position.y, this.cam.position.z, f.x, f.y, f.z, u.x, u.y, u.z);
    this.pipe.render(this.scene, this.player.vmScene, this.cam, dt, this.player.pos);
    this.drawHUD(dt);
    if (window._capture) { const cb = window._capture; window._capture = null; cb(canvas, hudCanvas); }
    // trim event lists
    const tt = this.t;
    for (const arr of [this.hits, this.kills, this.damage]) while (arr.length && tt - arr[0].t > 6) arr.shift();
    while (this.killfeed.length > 8) this.killfeed.shift();
    this.fpsAcc = (this.fpsAcc || 0) + dt; this.fpsN = (this.fpsN || 0) + 1;
    if (this.fpsAcc > 0.5) { this.fps = this.fpsN / this.fpsAcc; this.fpsAcc = 0; this.fpsN = 0; }
    requestAnimationFrame((n) => this.loop(n));
  }

  drawHUD() {
    const p = this.player, cam = this.cam;
    const W = innerWidth, H = innerHeight;
    const proj = (v) => { const c = v.clone().project(cam); if (c.z > 1 || c.z < -1) return null; return { x: (c.x * 0.5 + 0.5) * W, y: (-c.y * 0.5 + 0.5) * H }; };
    const enemies = this.enemies.filter((e) => e.root.visible).map((e) => {
      const vis = e.alive && e._visToPlayer;
      return { id: e.id, name: e.name, x: e.pos.x, y: -e.pos.z, z: e.pos.y, alive: e.alive, spotted: e.alive && e.spotted,
        head: vis ? proj(e.headPos.add(new THREE.Vector3(0, 0.12, 0))) : null, chest: vis ? proj(e.chestPos) : null };
    });
    // player -> enemy visibility for name tags (cheap, staggered)
    for (const e of this.enemies) {
      if (!e.alive) { e._visToPlayer = false; continue; }
      if (((this.t * 6 + e.id * 0.37) | 0) !== e._vp) { e._vp = (this.t * 6 + e.id * 0.37) | 0; e._visToPlayer = e._vis; }
    }
    const s = {
      t: this.t, mode: this.mode, respawnIn: Math.max(0, this.respawnIn), fps: qs.has('fps') ? this.fps : undefined,
      player: { x: p.pos.x, y: -p.pos.z, yaw: p.hudYaw, pitch: p.pitch * 57.3, ads: p.ads, health: p.health, ammo: p.ammo, mag: MAG,
        reserve: p.reserve, reloading: p.reloading, name: '大师', level: 55, xp: this.xp, sprint: p.sprint, speed: p.speed, lastShotT: p.lastShotT },
      enemies, score: this.score, killfeed: this.killfeed, hits: this.hits, kills: this.kills, damage: this.damage,
    };
    this.hud.draw(s);
  }
  get enemies() { return this._enemies || []; }
  set enemies(v) { this._enemies = v; }
}

const game = new Game();
game.boot().catch((e) => { console.error(e); lmsg.textContent = '加载失败：' + e.message; });
