// First-person player: capsule controller against the mall BVH, mouse look, ADS/recoil/sway, the baked viewmodel.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { LAYER, B, probeSH, nearestProbe, probeEnv } from './world.js';
import { patchDynamic, makeSH, G } from './materials.js';

const D2R = Math.PI / 180;
const rnd = (a, b) => a + Math.random() * (b - a);
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const C_INV = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
const HIP = { loc: new THREE.Vector3(0.105, -0.19, -0.32), rot: new THREE.Vector3(2 * D2R, 5 * D2R, -3.5 * D2R) };
const ADS = { loc: new THREE.Vector3(0.004275, -0.16117, -0.356485 - 0.012), rot: new THREE.Vector3(0, 0, 0) };
const SPRINT = { loc: new THREE.Vector3(0.05, -0.05, 0.03), rot: new THREE.Vector3(-22 * D2R, 38 * D2R, 18 * D2R) };
const P_MUZZLE = new THREE.Vector3(0.0, 0.1052, -0.4275 - 0.06);
const P_EJECT = new THREE.Vector3(0.0513, 0.0855, 0.0171);
export const MAG = 30;
const RPM = 750;

export class Player {
  constructor(world, cam, sfx, fx) {
    this.world = world; this.cam = cam; this.sfx = sfx; this.fx = fx;
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = 0; this.recP = 0; this.recY = 0;
    this.radius = 0.3; this.height = 1.75; this.eye = 1.66; this.crouch = 0;
    this.onGround = false; this.ads = 0; this.sprint = false; this.sprintAmt = 0;
    this.health = 100; this.lastHurt = -99; this.alive = true;
    this.ammo = MAG; this.reserve = 90; this.reloading = -1; this.cool = 0; this.lastShotT = -9;
    this.bobPhase = 0; this.bobAmt = 0; this.kick = 0; this.kickP = 0; this.swayX = 0; this.swayY = 0; this.lens = 18;
    this.shake = 0; this.stepAcc = 0; this.landT = 0;
    this.shotsInBurst = 0;
    this.vmSH = makeSH(); this.vmSunMul = { value: 1 };
    this.vmScene = new THREE.Scene();
    this.vmRoot = new THREE.Object3D(); this.vmRoot.matrixAutoUpdate = false; this.vmScene.add(this.vmRoot);
    this.holder = new THREE.Object3D(); this.vmRoot.add(this.holder);
    this._seg = new THREE.Line3(); this._box = new THREE.Box3(); this._v1 = new THREE.Vector3(); this._v2 = new THREE.Vector3();
  }

  async load() {
    const g = await new Promise((res, rej) => new GLTFLoader().load('./assets/viewmodel.glb', res, undefined, rej));
    const vm = g.scene.getObjectByName('VM');
    this.holder.add(vm);
    vm.position.set(0, 0, 0); vm.quaternion.copy(C_INV); vm.scale.set(1, 1, 1);
    vm.traverse((o) => {
      o.layers.set(LAYER.VM);
      if (!o.isMesh) return;
      o.frustumCulled = false;
      const n = o.material.name || '';
      if (n === 'lens_glass') {
        o.visible = false; // clear glass: the lens faces were cut out of the Tripo rifle, the pane only adds haze
        this.lensGlass = o;
      } else if (n === 'reticle') {
        o.material = new THREE.MeshBasicMaterial({ map: reticleTex(), color: new THREE.Color(9, 0.9, 0.6), transparent: true, depthWrite: false,
          blending: THREE.AdditiveBlending, toneMapped: false });
        o.renderOrder = 6; this.reticle = o;
      } else {
        const m = o.material;
        if (m.metalness > 0.5 && !m.metalnessMap) m.metalness = 0.6;
        patchDynamic(m, { uSH: this.vmSH, uSunMul: this.vmSunMul });
        m.envMapIntensity = 1; this.vmMats = this.vmMats || []; this.vmMats.push(m);
      }
    });
    this.mixer = new THREE.AnimationMixer(vm);
    this.reloadAction = this.mixer.clipAction(g.animations[0]);
    this.reloadAction.setLoop(THREE.LoopOnce, 1); this.reloadAction.clampWhenFinished = true;
    this.reloadAction.play(); this.reloadAction.paused = true; this.reloadAction.time = 0;
    this.mixer.update(0);
    this.vm = vm;
  }

  spawn(p, yawDeg) {
    this.pos.copy(p); this.vel.set(0, 0, 0); this.yaw = (yawDeg - 90) * D2R; this.pitch = 0; this.recP = this.recY = 0;
    this.health = 100; this.alive = true; this.ammo = MAG; this.reserve = 90; this.reloading = -1;
    this.reloadAction.paused = true; this.reloadAction.time = 0; this.ads = 0; this.lastHurt = -99;
  }

  // blender-convention yaw (deg, 0=+X 90=+Y) for HUD
  get hudYaw() { const f = this.forward(); return Math.atan2(-f.z, f.x) / D2R; }
  forward() { return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)); }
  eyePos() { return this.pos.clone().add(new THREE.Vector3(0, this.eye, 0)); }

  look(dx, dy) {
    const fovK = this.lens > 0 ? 18 / this.lens : 1;
    const s = 0.0022 * fovK;
    this.yaw -= dx * s; this.pitch = THREE.MathUtils.clamp(this.pitch - dy * s, -1.45, 1.45);
    this.swayX = THREE.MathUtils.clamp(this.swayX + dx * 0.00025, -0.05, 0.05);
    this.swayY = THREE.MathUtils.clamp(this.swayY + dy * 0.00025, -0.05, 0.05);
  }

  collide(dt) {
    const bvh = this.world.bvh, r = this.radius;
    const seg = this._seg;
    seg.start.copy(this.pos).y += r; seg.end.copy(this.pos).y += this.height - r;
    const box = this._box.makeEmpty(); box.expandByPoint(seg.start); box.expandByPoint(seg.end);
    box.min.addScalar(-r); box.max.addScalar(r);
    const tp = this._v1, cp = this._v2;
    bvh.shapecast({
      intersectsBounds: (b) => b.intersectsBox(box),
      intersectsTriangle: (tri) => {
        const d = tri.closestPointToSegment(seg, tp, cp);
        if (d < r) { const dir = cp.sub(tp).normalize(); const depth = r - d; seg.start.addScaledVector(dir, depth); seg.end.addScaledVector(dir, depth); }
      },
    });
    const np = seg.start.clone(); np.y -= r;
    const delta = np.sub(this.pos);
    const wasGround = this.onGround;
    this.onGround = delta.y > Math.abs(dt * this.vel.y * 0.25);
    const off = Math.max(0, delta.length() - 1e-5);
    delta.normalize().multiplyScalar(off);
    this.pos.add(delta);
    if (!this.onGround) { delta.normalize(); this.vel.addScaledVector(delta, -delta.dot(this.vel)); }
    else { if (!wasGround && this.vel.y < -4) this.landT = 0.25; this.vel.y = 0; }
  }

  update(dt, inp, t) {
    // ---------------- movement
    const wantCrouch = inp.crouch;
    this.crouch = damp(this.crouch, wantCrouch ? 1 : 0, 12, dt);
    this.height = 1.75 - 0.55 * this.crouch; this.eye = 1.66 - 0.5 * this.crouch;
    const fwd = this.forward(), right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const wish = new THREE.Vector3().addScaledVector(fwd, inp.fwd).addScaledVector(right, inp.right);
    if (wish.lengthSq() > 1) wish.normalize();
    this.sprint = inp.sprint && inp.fwd > 0.5 && !wantCrouch && this.ads < 0.3 && this.reloading < 0 && !inp.fire;
    const spd = this.sprint ? 6.6 : (wantCrouch ? 2.2 : 4.4) * (1 - 0.4 * this.ads);
    const accel = this.onGround ? 14 : 2.5;
    const targetV = wish.multiplyScalar(spd);
    this.vel.x = damp(this.vel.x, targetV.x, accel, dt); this.vel.z = damp(this.vel.z, targetV.z, accel, dt);
    if (inp.jump && this.onGround && !wantCrouch) { this.vel.y = 4.6; this.onGround = false; }
    this.vel.y -= 16 * dt;
    const steps = 4;
    for (let i = 0; i < steps; i++) { this.pos.addScaledVector(this.vel, dt / steps); this.collide(dt / steps); }
    if (this.pos.y < -3) this.pos.set(-3.6, 0.1, 0.5);
    const hsp = Math.hypot(this.vel.x, this.vel.z);
    this.speed = hsp;
    // ---------------- bob + footsteps
    const moving = this.onGround && hsp > 0.5;
    this.bobAmt = damp(this.bobAmt, moving ? Math.min(1, hsp / 4.4) : 0, 8, dt);
    if (moving) {
      const prev = this.bobPhase;
      this.bobPhase += dt * hsp * (this.sprint ? 1.55 : 1.75);
      if (Math.floor(prev / Math.PI) !== Math.floor(this.bobPhase / Math.PI)) this.sfx?.step(this.sprint);
    }
    this.landT = Math.max(0, this.landT - dt);
    // ---------------- weapon
    this.cool -= dt;
    const wantAds = inp.ads && !this.sprint && this.alive;
    const prevAds = this.ads;
    this.ads = THREE.MathUtils.clamp(this.ads + (wantAds ? dt / 0.2 : -dt / 0.16), 0, 1);
    if (prevAds === 0 && this.ads > 0) this.sfx?.adsIn(); if (prevAds === 1 && this.ads < 1) this.sfx?.adsOut();
    this.sprintAmt = damp(this.sprintAmt, this.sprint ? 1 : 0, 9, dt);
    const shots = [];
    if (this.reloading >= 0) {
      this.reloading += dt / 1.9;
      if (this.reloading >= 1) { const n = Math.min(MAG - this.ammo, this.reserve); this.ammo += n; this.reserve -= n; this.reloading = -1; this.reloadAction.paused = true; this.reloadAction.time = 0; }
    } else if (inp.reload && this.ammo < MAG && this.reserve > 0) this.startReload();
    if (inp.fire && this.reloading < 0 && this.sprintAmt < 0.3 && this.alive) {
      if (this.ammo <= 0) { if (this.cool <= 0) { this.sfx?.emptyClick(); this.cool = 0.3; if (this.reserve > 0) this.startReload(); } }
      else while (this.cool <= 0) {
        this.cool += 60 / RPM; this.ammo--; this.shotsInBurst++; this.lastShotT = t;
        shots.push(this.makeShot());
        this.recP += rnd(0.010, 0.016) * (1 - 0.35 * this.ads) * (1 + Math.min(this.shotsInBurst, 8) * 0.04);
        this.recY += rnd(-0.005, 0.007) * (1 - 0.3 * this.ads);
        this.kick = Math.min(this.kick + 0.022, 0.05); this.kickP = Math.min(this.kickP + 0.05 * (1 - 0.6 * this.ads), 0.12);
        this.sfx?.playerShot();
        if (this.ammo <= 0) break;
      }
    } else { this.shotsInBurst = 0; if (this.cool < 0) this.cool = 0; }
    // recoil recovery: 70% returns, 30% stays as aim drift
    const rec = 1 - Math.exp(-9 * dt);
    this.pitch += this.recP * 0.3 * rec / (1 - Math.exp(-9 * 0.016) + 1e-6) * 0; // (drift handled below)
    const dp = this.recP * rec, dy = this.recY * rec;
    this.recP -= dp; this.recY -= dy;
    this.pitch = THREE.MathUtils.clamp(this.pitch + dp * 0.35, -1.45, 1.45); this.yaw += dy * 0.35;
    this.kick = damp(this.kick, 0, 18, dt); this.kickP = damp(this.kickP, 0, 14, dt);
    this.swayX = damp(this.swayX, 0, 7, dt); this.swayY = damp(this.swayY, 0, 7, dt);
    this.shake = Math.max(0, this.shake - dt * 2.5);
    // regen
    if (this.alive && t - this.lastHurt > 4 && this.health < 100) this.health = Math.min(100, this.health + 32 * dt);
    this.lens = 18 + (34 - 18) * smooth(this.ads);
    this.updateCamera(dt, t);
    return shots;
  }

  startReload() { if (this.reloading >= 0) return; this.reloading = 0; this.reloadAction.reset(); this.reloadAction.paused = false; this.reloadAction.play(); this.sfx?.reloadSequence(); }

  makeShot() {
    const cam = this.cam;
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    const spread = (this.ads > 0.8 ? 0.0015 : 0.012 + Math.min(this.speed, 6) * 0.006 + (this.onGround ? 0 : 0.03)) * (1 + Math.min(this.shotsInBurst, 10) * 0.05);
    const ang = rnd(0, Math.PI * 2), rr = Math.sqrt(Math.random()) * spread;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion), rt = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
    dir.addScaledVector(rt, Math.cos(ang) * rr).addScaledVector(up, Math.sin(ang) * rr).normalize();
    const muzzle = P_MUZZLE.clone().applyMatrix4(this.holder.matrixWorld);
    const eject = P_EJECT.clone().applyMatrix4(this.holder.matrixWorld);
    return { origin: cam.position.clone(), dir, muzzle, eject, right: rt, up };
  }

  damage(amount, t, src) {
    if (!this.alive) return;
    this.health -= amount; this.lastHurt = t; this.shake = Math.min(1, this.shake + 0.35);
    if (this.health <= 0) { this.health = 0; this.alive = false; }
  }

  updateCamera(dt, t) {
    const cam = this.cam;
    const bob = this.bobAmt * (1 - 0.8 * this.ads);
    const ph = this.bobPhase;
    this.deathT = this.alive ? 0 : Math.min(1, (this.deathT || 0) + dt * 1.6);
    const dk = this.deathT * this.deathT * (3 - 2 * this.deathT);
    const eye = this.pos.clone(); eye.y += this.eye * (1 - 0.72 * dk) + Math.sin(ph * 2) * 0.014 * bob - this.landT * 0.12;
    eye.addScaledVector(new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw)), Math.cos(ph) * 0.012 * bob);
    cam.position.copy(eye);
    const sh = this.shake * this.shake;
    const p = this.pitch + this.recP * 0.65 + Math.sin(t * 37) * 0.01 * sh, y = this.yaw + this.recY * 0.65 + Math.sin(t * 29) * 0.01 * sh;
    cam.quaternion.setFromEuler(new THREE.Euler(p + 0.35 * dk, y, Math.sin(ph) * 0.004 * bob + Math.sin(t * 23) * 0.006 * sh + 0.5 * dk, 'YXZ'));
    const hf = 2 * Math.atan(18 / this.lens);
    cam.fov = 2 * Math.atan(Math.tan(hf / 2) / cam.aspect) / D2R;
    cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    // viewmodel transform in camera space
    const a = smooth(this.ads), s = smooth(this.sprintAmt);
    const loc = HIP.loc.clone().lerp(ADS.loc, a).lerp(SPRINT.loc.clone().add(HIP.loc), s);
    const rot = HIP.rot.clone().lerp(ADS.rot, a).lerp(SPRINT.rot.clone().add(HIP.rot), s);
    const vb = bob * (1 - 0.85 * a);
    loc.x += Math.cos(ph) * 0.007 * vb + this.swayX * -0.25 * (1 - 0.8 * a);
    loc.y += -Math.abs(Math.sin(ph)) * 0.009 * vb + this.swayY * 0.18 * (1 - 0.8 * a) - this.landT * 0.08;
    loc.z += this.kick * (1 - 0.4 * a);
    rot.x += this.kickP + this.swayY * 0.6 * (1 - 0.7 * a);
    rot.y += this.swayX * 0.8 * (1 - 0.7 * a);
    rot.z += Math.sin(ph) * 0.02 * vb + this.swayX * 1.2 * (1 - 0.7 * a);
    // idle breathing
    loc.y += Math.sin(t * 1.6) * 0.0015 * (1 - 0.6 * a); rot.x += Math.sin(t * 1.6 + 1) * 0.004 * (1 - 0.6 * a);
    this.holder.position.copy(loc);
    this.holder.quaternion.setFromEuler(new THREE.Euler(rot.x, rot.y, rot.z, 'ZYX'));
    this.vmRoot.matrix.copy(cam.matrixWorld);
    this.vmRoot.updateMatrixWorld(true);
    if (this.reticle) this.reticle.visible = a > 0.75;
    if (this.vm) this.vm.visible = this.alive;
    if (this.mixer) this.mixer.update(this.reloading >= 0 ? dt : 0);
    // lighting for the viewmodel: probe SH at the eye
    probeSH(this.world, cam.position, this.vmSH.value);
    const pi = nearestProbe(this.world, cam.position);
    if (pi !== this._probe && this.vmMats && this.renderer) {
      this._probe = pi; const env = probeEnv(this.world, this.renderer, pi);
      for (const m of this.vmMats) { if (!m.envMap) m.needsUpdate = true; m.envMap = env; }
      if (this.fx?.caseMat) { if (!this.fx.caseMat.envMap) this.fx.caseMat.needsUpdate = true; this.fx.caseMat.envMap = env; }
    }
  }
}

function smooth(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); }

function reticleTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineWidth = 5;
  g.beginPath(); g.arc(64, 64, 50, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.arc(64, 64, 6, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; return t;
}
