// Enemy soldiers: Tripo characters with mocap clips, chest-mounted rifle held by 2-bone IK, nav-graph AI.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { LAYER, B, probeSH, nearestProbe, probeEnv } from './world.js';
import { patchDynamic, makeSH } from './materials.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const NAMES = ['Viper_77', 'Kodiak', 'RAVEN.k', 'Ghost_09', 'Wraith', 'Mako_3', 'Saber', 'Nomad_21', 'Fang', 'Rook_88', 'Jackal', 'Onyx_5', 'Talon', 'Havoc', 'Drift_4', 'Brute'];
const UNIT_B = [-12, -3, 6, 15, 24, 33, 42, 51, 62];
const SHUT0 = { 1: [4, 7], '-1': [0, 5] };
const SCALE = 1.8;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
// rifle-local points (Blender rifle space x right, y muzzle, z up; scale baked 0.855) -> three (x, z, -y)
const RP = (x, y, z) => new THREE.Vector3(x, z, -y).multiplyScalar(0.855);
const R_GRIP = RP(0.0, -0.215, -0.07), R_HG = RP(-0.005, 0.145, 0.035), R_MUZ = RP(0, 0.5, 0.123);

// ---------------------------------------------------------------- nav graph
export class Nav {
  constructor(world) {
    this.world = world; this.nodes = []; this.edges = [];
    const add = (x, y, z = 0, tag = '') => { const n = { id: this.nodes.length, p: B(x, y, z), lvl: z > 2 ? 1 : 0, tag, nb: [] }; this.nodes.push(n); return n; };
    for (const x of [-8.8, -6.6, -3.0, 0, 3.0, 6.6, 8.8]) for (let y = -10; y <= 60; y += 4.5) add(x, y, 0);
    for (const s of [1, -1]) for (let k = 0; k < 8; k++) {
      if (SHUT0[s].includes(k)) continue;
      const ym = (UNIT_B[k] + UNIT_B[k + 1]) / 2;
      add(s * 14.0, ym - 2, 0, 'store'); add(s * 14.0, ym + 2, 0, 'store'); add(s * 11.8, ym, 0, 'door');
    }
    for (const x of [-8.6, -6.2, 6.2, 8.6]) for (let y = -10; y <= 60; y += 4.5) add(x, y, 5);
    for (const y of [27.75, 46.4]) for (const x of [-3, 0, 3]) add(x, y, 5, 'bridge');
    const eb = [add(-0.75, 35.0, 0, 'escB'), add(0.75, 35.0, 0, 'escB')];
    const et = [add(-0.75, 45.6, 5, 'escT'), add(0.75, 45.6, 5, 'escT')];
    // validate nodes (not inside geometry)
    const bvh = world.bvh;
    const ray = new THREE.Ray();
    const blocked = (a, b) => {
      for (const h of [0.45, 1.35]) {
        ray.origin.copy(a).y += h; _v.copy(b); _v.y += h; const d = _v.sub(ray.origin); const L = d.length(); ray.direction.copy(d.divideScalar(L));
        const hit = bvh.raycastFirst(ray, THREE.DoubleSide, 0, L);
        if (hit && hit.distance < L - 0.05) return true;
      }
      return false;
    };
    this.nodes = this.nodes.filter((n) => {
      if (n.tag.startsWith('esc')) return true;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2; ray.origin.copy(n.p).y += 0.9; ray.direction.set(Math.cos(a), 0, Math.sin(a));
        const hit = bvh.raycastFirst(ray, THREE.DoubleSide, 0, 0.45);
        if (hit) return false;
      }
      return true;
    });
    this.nodes.forEach((n, i) => { n.id = i; n.nb = []; });
    for (let i = 0; i < this.nodes.length; i++) for (let j = i + 1; j < this.nodes.length; j++) {
      const a = this.nodes[i], b = this.nodes[j];
      if (a.lvl !== b.lvl || a.tag.startsWith('esc') || b.tag.startsWith('esc')) continue;
      const d = Math.hypot(a.p.x - b.p.x, a.p.z - b.p.z);
      if (d > 6.2) continue;
      if (blocked(a.p, b.p)) continue;
      a.nb.push(j); b.nb.push(i);
    }
    // escalators: bottom <-> nearest ground nodes, top <-> nearest upper nodes, bottom <-> top
    const link = (a, b) => { a.nb.push(b.id); b.nb.push(a.id); };
    const ebN = this.nodes.filter((n) => n.tag === 'escB'), etN = this.nodes.filter((n) => n.tag === 'escT');
    for (let k = 0; k < 2; k++) {
      link(ebN[k], etN[k]);
      for (const [e, lvl] of [[ebN[k], 0], [etN[k], 1]]) {
        const near = this.nodes.filter((n) => n.lvl === lvl && !n.tag.startsWith('esc')).sort((p, q) => p.p.distanceTo(e.p) - q.p.distanceTo(e.p)).slice(0, 3);
        for (const n of near) if (!blocked(e.p, n.p) || lvl === 1) link(e, n);
      }
    }
    console.log('nav nodes', this.nodes.length);
  }
  nearest(p, lvl) {
    let best = null, bd = 1e9;
    for (const n of this.nodes) { if (lvl !== undefined && n.lvl !== lvl) continue; const d = n.p.distanceToSquared(p); if (d < bd) { bd = d; best = n; } }
    return best;
  }
  path(a, b) {
    const N = this.nodes, open = [a.id], g = new Map([[a.id, 0]]), f = new Map([[a.id, a.p.distanceTo(b.p)]]), from = new Map();
    const closed = new Set();
    while (open.length) {
      let bi = 0; for (let i = 1; i < open.length; i++) if (f.get(open[i]) < f.get(open[bi])) bi = i;
      const cur = open.splice(bi, 1)[0];
      if (cur === b.id) { const out = [N[cur]]; let c = cur; while (from.has(c)) { c = from.get(c); out.unshift(N[c]); } return out; }
      closed.add(cur);
      for (const nb of N[cur].nb) {
        if (closed.has(nb)) continue;
        const ng = g.get(cur) + N[cur].p.distanceTo(N[nb].p);
        if (!g.has(nb) || ng < g.get(nb)) { from.set(nb, cur); g.set(nb, ng); f.set(nb, ng + N[nb].p.distanceTo(b.p)); if (!open.includes(nb)) open.push(nb); }
      }
    }
    return null;
  }
}

// ---------------------------------------------------------------- templates
async function loadTemplate(url) {
  const g = await new Promise((res, rej) => new GLTFLoader().load(url, res, undefined, rej));
  const clips = {};
  let hipsBind = null;
  g.scene.traverse((o) => { if (o.isBone && /Hips$/.test(o.name) && !hipsBind) hipsBind = o.position.clone(); });
  for (const c of g.animations) {
    const loop = ['idle', 'walk', 'run', 'shoot'].includes(c.name);
    for (const tr of c.tracks) {
      if (/Hips\.position$/.test(tr.name)) {
        const v = tr.values; const x0 = v[0], z0 = v[2];
        for (let i = 0; i < v.length; i += 3) {
          if (loop) { v[i] = hipsBind.x; v[i + 2] = hipsBind.z; } else { v[i] -= x0 - hipsBind.x; v[i + 2] -= z0 - hipsBind.z; }
        }
      }
    }
    clips[c.name] = c;
  }
  // facing from shoulders in bind pose
  g.scene.updateMatrixWorld(true);
  const L = g.scene.getObjectByName('mixamorigLeftShoulder').getWorldPosition(new THREE.Vector3());
  const R = g.scene.getObjectByName('mixamorigRightShoulder').getWorldPosition(new THREE.Vector3());
  const fwd = new THREE.Vector3(0, 1, 0).cross(R.sub(L)).normalize();
  return { g, clips, yawOff: -Math.atan2(fwd.x, fwd.z) };
}

// ---------------------------------------------------------------- enemy
class Enemy {
  constructor(game, tpl, rifleTpl, id) {
    this.game = game; this.id = id; this.tpl = tpl;
    this.root = new THREE.Object3D();
    this.model = SkeletonUtils.clone(tpl.g.scene);
    this.model.scale.setScalar(SCALE); this.model.rotation.y = tpl.yawOff;
    this.root.add(this.model);
    this.sh = makeSH();
    this.model.traverse((o) => {
      o.layers.set(0); o.layers.enable(LAYER.DYN);
      if (o.isMesh) {
        o.frustumCulled = false;
        o.material = o.material.clone(); o.material.envMapIntensity = 1;
        patchDynamic(o.material, { uSH: this.sh }); (this.mats = this.mats || []).push(o.material);
      }
    });
    this.bones = {};
    for (const n of ['Hips', 'Spine2', 'Head', 'Neck', 'RightArm', 'RightForeArm', 'RightHand', 'LeftArm', 'LeftForeArm', 'LeftHand', 'LeftFoot', 'RightFoot'])
      this.bones[n] = this.model.getObjectByName('mixamorig' + n);
    this.rifle = rifleTpl.clone();
    this.rifle.traverse((o) => { o.layers.set(0); o.layers.enable(LAYER.DYN); if (o.isMesh) { o.material = o.material.clone(); patchDynamic(o.material, { uSH: this.sh }); o.frustumCulled = false; (this.mats = this.mats || []).push(o.material); } });
    game.scene.add(this.root); game.scene.add(this.rifle);
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    for (const [k, c] of Object.entries(tpl.clips)) {
      const a = this.mixer.clipAction(c); this.actions[k] = a;
      if (['fall', 'hurt', 'dive', 'turn'].includes(k)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
    }
    this.cur = null;
    this.alive = false; this.root.visible = false; this.rifle.visible = false;
    this.aimDir = new THREE.Vector3(0, 0, -1);
    this.rv = new THREE.Vector3(); this.rq = new THREE.Quaternion(); this.rw = new THREE.Vector3();
  }

  play(name, fade = 0.2, ts = 1) {
    const a = this.actions[name];
    if (this.cur === a) { a.timeScale = ts; return; }
    a.reset(); a.timeScale = ts; a.setEffectiveWeight(1); a.play();
    if (this.cur) this.cur.crossFadeTo(a, fade, false);
    this.cur = a;
  }

  spawn(node, name) {
    this.name = name; this.health = 100; this.alive = true; this.dying = 0; this.deadT = 0;
    this.root.visible = true; this.rifle.visible = true; this.dropped = false;
    this.pos = node.p.clone(); this.node = node; this.path = null; this.state = 'think'; this.stateT = 0;
    this.heading = rnd(0, Math.PI * 2); this.seen = 0; this.burst = 0; this.nextShot = 0; this.bursts = 0; this.spotted = false; this.lastFire = -9;
    this.flinch = 0; this.reaction = rnd(0.55, 0.95); this.crouchAim = Math.random() < 0.35;
    this.play('idle', 0);
    this.root.position.copy(this.pos);
  }

  get headPos() { return this.bones.Head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.1, 0)); }
  get chestPos() { return this.bones.Spine2.getWorldPosition(new THREE.Vector3()); }

  // ray vs simple hitboxes; returns {t, part}
  raycast(ray, maxT) {
    if (!this.alive) return null;
    let best = null;
    const test = (a, b, r, part) => {
      const t = raySegment(ray, a, b, r);
      if (t !== null && t < maxT && (!best || t < best.t)) best = { t, part };
    };
    const head = this.headPos.add(new THREE.Vector3(0, -0.04, 0));
    test(head, head, 0.13, 'head');
    const hips = this.bones.Hips.getWorldPosition(new THREE.Vector3()), chest = this.chestPos.add(new THREE.Vector3(0, 0.1, 0));
    test(hips, chest, 0.21, 'body');
    const fl = this.bones.LeftFoot.getWorldPosition(new THREE.Vector3()), fr = this.bones.RightFoot.getWorldPosition(new THREE.Vector3());
    test(hips, fl, 0.13, 'leg'); test(hips, fr, 0.13, 'leg');
    return best;
  }

  hit(dmg, dir, point) {
    if (!this.alive) return false;
    this.health -= dmg; this.flinch = 0.25; this.seen = Math.max(this.seen, this.reaction);
    if (this.state === 'move' && Math.random() < 0.5) { this.state = 'engage'; this.stateT = 0; }
    if (this.health <= 0) { this.die(dir); return true; }
    return false;
  }

  die(dir) {
    this.alive = false; this.dying = 1; this.deadT = 0;
    this.play('fall', 0.12, 1.15);
    // drop the rifle
    this.dropped = true; this.rv.copy(dir).multiplyScalar(1.2).add(new THREE.Vector3(rnd(-0.5, 0.5), 1.2, rnd(-0.5, 0.5)));
    this.rw.set(rnd(-4, 4), rnd(-4, 4), rnd(-4, 4));
    this.game.sfx?.bodyFall(this.pos.toArray());
  }

  canSee(target) {
    const eye = this.headPos; const d = _v.copy(target).sub(eye); const L = d.length();
    if (L > 34) return false;
    const ray = new THREE.Ray(eye, d.divideScalar(L));
    const hit = this.game.world.bvh.raycastFirst(ray, THREE.DoubleSide, 0, L);
    return !hit || hit.distance > L - 0.3;
  }

  chooseGoal() {
    const g = this.game, nav = g.nav, pp = g.player.pos;
    const cands = [];
    for (const n of nav.nodes) {
      if (n.tag.startsWith('esc')) continue;
      const dp = Math.hypot(n.p.x - pp.x, n.p.z - pp.z);
      if (dp < 7 || dp > 26) continue;
      const dm = n.p.distanceTo(this.pos);
      if (dm > 30) continue;
      if (g.enemies.some((e) => e !== this && e.alive && e.goal === n)) continue;
      cands.push({ n, s: dm * 0.5 + Math.abs(dp - 14) + rnd(0, 8) });
    }
    cands.sort((a, b) => a.s - b.s);
    for (const c of cands.slice(0, 6)) {
      const pth = nav.path(this.node, c.n);
      if (pth) { this.goal = c.n; this.path = pth; this.pi = 1; return true; }
    }
    return false;
  }

  update(dt, t) {
    const g = this.game;
    if (!this.root.visible) return;
    if (!this.alive) {
      this.deadT += dt;
      this.mixer.update(dt);
      if (this.dropped) this.updateDroppedRifle(dt);
      if (this.deadT > 7) { this.root.position.y -= dt * 0.4; if (this.deadT > 9) { this.root.visible = false; this.rifle.visible = false; } }
      return;
    }
    this.stateT += dt; this.flinch = Math.max(0, this.flinch - dt);
    const player = g.player, pEye = player.eyePos();
    const pChest = player.pos.clone().add(new THREE.Vector3(0, player.eye - 0.35, 0));
    // perception
    if (((t * 7 + this.id) | 0) !== this._pc) {
      this._pc = (t * 7 + this.id) | 0;
      this._vis = player.alive && this.canSee(pEye);
    }
    const vis = this._vis;
    this.seen = vis ? this.seen + dt : Math.max(0, this.seen - dt * 0.5);
    this.spotted = vis && this.seen > 0.2 || t - this.lastFire < 1.5;
    const toP = _v2.copy(pChest).sub(this.pos); const distP = Math.hypot(toP.x, toP.z);
    // state machine
    let moving = false;
    if (this.state === 'think') {
      if (this.chooseGoal()) { this.state = 'move'; this.stateT = 0; } else { this.state = 'engage'; this.stateT = 0; }
    }
    if (this.state === 'move') {
      const target = this.path && this.path[this.pi];
      if (!target) { this.state = 'engage'; this.stateT = 0; }
      else {
        const d = _v.copy(target.p).sub(this.pos); const L = Math.hypot(d.x, d.z);
        const spd = 4.3 * (this.flinch > 0 ? 0.4 : 1);
        if (L < 0.25) { this.node = target; this.pi++; }
        else {
          const step = Math.min(L, spd * dt);
          this.pos.x += d.x / L * step; this.pos.z += d.z / L * step;
          const prev = this.path[this.pi - 1] || this.node;
          const tot = Math.hypot(target.p.x - prev.p.x, target.p.z - prev.p.z) || 1;
          const k = 1 - Math.min(1, L / tot);
          this.pos.y = prev.p.y + (target.p.y - prev.p.y) * k;
          this.turnTo(Math.atan2(d.x, d.z), dt, 8);
          moving = true;
        }
        if (vis && this.seen > this.reaction && distP < 24 && this.stateT > 0.8 && Math.random() < dt * 1.5) { this.state = 'engage'; this.stateT = 0; }
      }
    }
    if (this.state === 'engage') {
      this.turnTo(Math.atan2(toP.x, toP.z), dt, 6);
      if (vis && this.seen > this.reaction) {
        if (t > this.nextShot) {
          if (this.burst <= 0) { this.burst = (rnd(3, 7)) | 0; }
          this.fire(t, pChest, distP);
          this.burst--; this.nextShot = t + 0.105;
          if (this.burst <= 0) { this.nextShot = t + rnd(0.45, 1.2); this.bursts++; }
        }
      }
      const lost = !vis && this.stateT > 1.6;
      if (lost || this.bursts > 3 + Math.random() * 2 || this.stateT > 9) { this.bursts = 0; this.state = 'think'; this.stateT = 0; }
    }
    // animation
    if (moving) this.play('run', 0.2, 1.0);
    else this.play(this.crouchAim && this.state === 'engage' ? 'shoot' : 'idle', 0.25, 1);
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.heading;
    this.mixer.update(dt);
    this.root.updateMatrixWorld(true);
    // rifle + IK
    const fwd = new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
    let aim;
    if (this.state === 'engage' && this.seen > 0.1) aim = pChest.clone().sub(this.chestPos).normalize();
    else aim = fwd.clone().multiplyScalar(0.85).add(new THREE.Vector3(0, -0.5, 0)).normalize();
    if (this.flinch > 0) aim.add(new THREE.Vector3(rnd(-0.2, 0.2), 0.25, rnd(-0.2, 0.2))).normalize();
    this.aimDir.lerp(aim, 1 - Math.exp(-10 * dt)).normalize();
    this.holdRifle();
    const lp = this.pos.clone().add(new THREE.Vector3(0, 1.2, 0));
    probeSH(g.world, lp, this.sh.value);
    const pi = nearestProbe(g.world, lp);
    if (pi !== this._probe) { this._probe = pi; const env = probeEnv(g.world, g.renderer, pi); for (const m of this.mats) { if (!m.envMap) m.needsUpdate = true; m.envMap = env; } }
  }

  turnTo(target, dt, rate) {
    let d = target - this.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
    this.heading += d * (1 - Math.exp(-rate * dt));
  }

  holdRifle() {
    const b = this.bones;
    const chest = b.Spine2.getWorldPosition(new THREE.Vector3());
    const up = new THREE.Vector3(0, 1, 0);
    const aim = this.aimDir;
    const right = new THREE.Vector3().crossVectors(aim, up).normalize();
    const rup = new THREE.Vector3().crossVectors(right, aim).normalize();
    const pocket = chest.clone().addScaledVector(right, 0.16).addScaledVector(rup, 0.1).addScaledVector(aim, 0.08);
    // rifle basis: local -Z = muzzle, +Y up, +X right
    const m = new THREE.Matrix4().makeBasis(right, rup, aim.clone().negate());
    this.rifle.quaternion.setFromRotationMatrix(m);
    this.rifle.position.copy(pocket).addScaledVector(aim, 0.36);
    this.rifle.updateMatrixWorld(true);
    const grip = R_GRIP.clone().applyMatrix4(this.rifle.matrixWorld), hg = R_HG.clone().applyMatrix4(this.rifle.matrixWorld);
    const wr = grip.addScaledVector(right, 0.03).addScaledVector(aim, -0.06).addScaledVector(rup, -0.02);
    const wl = hg.addScaledVector(right, -0.035).addScaledVector(rup, -0.07).addScaledVector(aim, -0.02);
    const poleR = chest.clone().addScaledVector(right, 0.45).addScaledVector(up, -0.6).addScaledVector(aim, -0.2);
    const poleL = chest.clone().addScaledVector(right, -0.35).addScaledVector(up, -0.7).addScaledVector(aim, 0.1);
    twoBoneIK(b.RightArm, b.RightForeArm, b.RightHand, wr, poleR);
    twoBoneIK(b.LeftArm, b.LeftForeArm, b.LeftHand, wl, poleL);
    aimBone(b.RightHand, aim.clone().multiplyScalar(0.55).addScaledVector(rup, -0.8).normalize());
    aimBone(b.LeftHand, aim.clone().multiplyScalar(0.8).addScaledVector(right, -0.4).normalize());
  }

  muzzleWorld() { return R_MUZ.clone().applyMatrix4(this.rifle.matrixWorld); }

  fire(t, target, dist) {
    const g = this.game; const mz = this.muzzleWorld();
    this.lastFire = t;
    g.fx.muzzleFlash(mz, this.aimDir, 0.9, g.player.lastShotT < t - 0.1);
    g.sfx?.enemyShot(mz.toArray());
    const p = g.player;
    let acc = THREE.MathUtils.clamp(0.42 - dist * 0.012, 0.08, 0.36);
    if (p.speed > 2) acc *= 0.7; if (p.crouch > 0.5) acc *= 0.8; if (this.seen < 1.5) acc *= 0.45; if (p.ads > 0.5) acc *= 1.1; if (this.flinch > 0) acc *= 0.3;
    if (p.alive && Math.random() < acc) {
      g.playerHit(rnd(11, 17), this);
    } else {
      const miss = target.clone().add(new THREE.Vector3(rnd(-1, 1), rnd(-0.6, 0.9), rnd(-1, 1)).normalize().multiplyScalar(rnd(0.4, 1.4)));
      const d = miss.sub(mz).normalize();
      const ray = new THREE.Ray(mz, d);
      const hit = g.world.bvh.raycastFirst(ray, THREE.DoubleSide, 0, 80);
      if (hit) {
        g.fx.impact(hit.point, hit.face.normal.clone(), 'plaster', true);
        if (Math.random() < 0.4) g.sfx?.impact(hit.point.toArray());
      }
      // near-miss crack when the bullet passes close to the player's head
      const closest = ray.closestPointToPoint(p.eyePos(), new THREE.Vector3());
      if (closest.distanceTo(p.eyePos()) < 2.2) (Math.random() < 0.5 ? g.sfx?.snap(closest.toArray()) : g.sfx?.whizz(closest.toArray()));
      if (Math.random() < 0.4) g.fx.tracer(mz, hit ? hit.point : mz.clone().addScaledVector(d, 60));
    }
  }

  updateDroppedRifle(dt) {
    const r = this.rifle;
    if (this.rv.lengthSq() < 1e-4 && r.position.y <= this.pos.y + 0.03) return;
    this.rv.y -= 9.8 * dt; r.position.addScaledVector(this.rv, dt);
    _q.setFromEuler(new THREE.Euler(this.rw.x * dt, this.rw.y * dt, this.rw.z * dt)); r.quaternion.premultiply(_q);
    if (r.position.y < this.pos.y + 0.03) {
      r.position.y = this.pos.y + 0.03; this.rv.multiplyScalar(0.3); this.rv.y = Math.abs(this.rv.y) * 0.3; this.rw.multiplyScalar(0.3);
      if (this.rv.length() < 0.3) { this.rv.set(0, 0, 0); this.rw.set(0, 0, 0);
        // settle flat on its side
        const f = new THREE.Vector3(0, 0, -1).applyQuaternion(r.quaternion); f.y = 0; f.normalize();
        r.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), f, new THREE.Vector3(0, 1, 0))).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2));
      }
    }
    r.updateMatrixWorld(true);
  }
}

function aimBone(bone, dir) {
  const wq = bone.getWorldQuaternion(_q);
  const cur = new THREE.Vector3(0, 1, 0).applyQuaternion(wq);
  const d = _q2.setFromUnitVectors(cur, dir);
  const nw = d.multiply(wq);
  const pq = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.copy(pq.invert().multiply(nw));
  bone.updateMatrixWorld(true);
}

function rotateTowards(bone, from, to) {
  const q = new THREE.Quaternion().setFromUnitVectors(from.normalize(), to.normalize());
  const wq = bone.getWorldQuaternion(new THREE.Quaternion());
  const pq = bone.parent.getWorldQuaternion(new THREE.Quaternion());
  bone.quaternion.copy(pq.invert().multiply(q.multiply(wq)));
  bone.updateMatrixWorld(true);
}

function twoBoneIK(a, b, c, target, pole) {
  const pa = a.getWorldPosition(new THREE.Vector3()), pb = b.getWorldPosition(new THREE.Vector3()), pc = c.getWorldPosition(new THREE.Vector3());
  const la = pa.distanceTo(pb), lb = pb.distanceTo(pc);
  const td = target.clone().sub(pa); let dist = td.length();
  dist = THREE.MathUtils.clamp(dist, Math.abs(la - lb) + 1e-3, la + lb - 1e-3);
  const dn = td.normalize();
  const cosA = THREE.MathUtils.clamp((la * la + dist * dist - lb * lb) / (2 * la * dist), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
  const pn = pole.clone().sub(pa); pn.addScaledVector(dn, -pn.dot(dn)).normalize();
  const elbow = pa.clone().addScaledVector(dn, la * cosA).addScaledVector(pn, la * sinA);
  rotateTowards(a, pb.clone().sub(pa), elbow.clone().sub(pa));
  const pb2 = b.getWorldPosition(new THREE.Vector3()), pc2 = c.getWorldPosition(new THREE.Vector3());
  rotateTowards(b, pc2.sub(pb2), target.clone().sub(pb2));
}

function raySegment(ray, a, b, r) {
  // distance between ray and segment ab; returns entry t along ray or null
  const ab = _v.copy(b).sub(a), ao = _v2.copy(ray.origin).sub(a), d = ray.direction;
  const abab = ab.dot(ab), abd = ab.dot(d), abao = ab.dot(ao), dao = d.dot(ao);
  let s, t;
  const den = abab - abd * abd;
  if (abab < 1e-8) { s = 0; t = -dao; }
  else { if (den < 1e-8) s = 0; else s = THREE.MathUtils.clamp((abao - abd * dao) / den, 0, 1); t = s * abd - dao; if (t < 0) { t = 0; s = THREE.MathUtils.clamp(abao / abab, 0, 1); } }
  const cpR = _v3.copy(ray.origin).addScaledVector(d, t);
  const cpS = ab.multiplyScalar(s).add(a);
  const dist = cpR.distanceTo(cpS);
  if (dist > r) return null;
  return Math.max(0, t - Math.sqrt(r * r - dist * dist));
}

export class Enemies {
  constructor(game) { this.game = game; this.list = []; this.nameI = 0; }
  async load() {
    const [a, b, rifle] = await Promise.all([loadTemplate('./assets/enemy_a.glb'), loadTemplate('./assets/enemy_b.glb'),
      new Promise((res, rej) => new GLTFLoader().load('./assets/rifle_lod.glb', res, undefined, rej))]);
    const rt = rifle.scene;
    for (let i = 0; i < 6; i++) this.list.push(new Enemy(this.game, i % 2 ? b : a, rt, i));
    this.game.enemies = this.list;
  }
  spawnOne(t) {
    const g = this.game; const e = this.list.find((x) => !x.alive && !x.root.visible);
    if (!e) return null;
    const pp = g.player.pos;
    const cands = g.nav.nodes.filter((n) => (n.tag === 'store' || n.lvl === 1 || Math.abs(n.p.z + 58) < 3 || Math.abs(n.p.z - 10) < 2) && n.p.distanceTo(pp) > 18 && n.p.distanceTo(pp) < 45);
    const pick = cands.filter((n) => !g.enemies.some((o) => o.alive && o.pos.distanceTo(n.p) < 4));
    const n = (pick.length ? pick : cands)[(Math.random() * (pick.length || cands.length)) | 0];
    if (!n) return null;
    e.spawn(n, NAMES[this.nameI++ % NAMES.length]);
    return e;
  }
  raycast(ray, maxT) {
    let best = null;
    for (const e of this.list) { const h = e.raycast(ray, maxT); if (h && (!best || h.t < best.t)) best = { ...h, e }; }
    return best;
  }
  update(dt, t) { for (const e of this.list) e.update(dt, t); }
}
