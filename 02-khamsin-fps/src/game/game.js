// 对局逻辑：消耗战（Attrition）—— 空降舱增援、计分、弹道/手雷、机甲呼叫与登机、过场
import * as THREE from 'three';
import { Pilot } from './player.js';
import { Weapons } from './weapons.js';
import { FX } from './fx.js';
import { Soldier, Drone, KIND_NAME } from './actors.js';
import { Mech } from './mech.js';
import { AIPilot } from './aipilot.js';
import { PilotBrain, VInput } from './brain.js';
import { RiftMode } from './riftmode.js';
import { RiftRunner } from './riftdemo.js';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const rnd = (a, b) => a + Math.random() * (b - a);
const SCORE = { grunt: 1, stalker: 2, drone: 2, sniper: 3, mech: 10, pilot: 3 };
const METER = { grunt: 0.05, stalker: 0.075, drone: 0.055, sniper: 0.09, mech: 0.35, pilot: 0.1 };
export const SCORE_GOAL = 150, MATCH_TIME = 600;   // 双方各多了两三名 AI 铁驭，得分节奏变快，目标分相应上调

export class Game {
  constructor({ engine, world, level, nav, audio, input, hud, spaces = null }) {
    this.engine = engine; this.world = world; this.level = level; this.nav = nav; this.audio = audio; this.input = input; this.hud = hud;
    // 多空间（双界试炼）：spaces[k] = 第 k 界的 { world, nav, group, level, atmos }；phase 是玩家所在的界，ctx 是共用的 world / nav 当前切到的界
    this.spaces = spaces; this.phase = 0; this.ctx = 0; this.targetsP = [[[], []], [[], []]];
    this.time = 0; this.frame = 0; this.state = 'menu'; this.cinematic = true; this.matchT = 0; this.timeScale = 1;
    this.fx = new FX(this); if (!this.engine.post.q.vol) this.fx.addShafts(level.shafts);   // 有真体积光时不再需要假的光柱面片
    this.fx.addSmoke(level.smokes || []);
    this.player = new Pilot(this); this.weapons = new Weapons(this);
    this.actors = []; this.mechs = []; this.projectiles = []; this.grenades = []; this.pods = []; this.timers = [];
    this.targets = this.targetsP[0]; this.score = [0, 0]; this.aiAccuracy = 1; this.sniperWarn = 0;
    this.mechCharge = 0; this.playerMech = null; this.interactPrompt = null; this.hurtFlash = 0; this.fade = 0; this.flash = 0; this.hurtSnd = 0; this.respawnT = 0;
    this.combatPoints = level.combatPoints || [[0, 0], [-25, -30], [25, -30], [49, 0], [-47, 0], [24, 48], [-25, -48], [0, 30], [0, -30], [49, -30], [49, 30], [-47, 30], [-47, -30], [-25, 45], [0, -50], [0, 50], [-10, 10], [10, -10]];
    this.stats = { kills: 0, deaths: 0, mechKills: 0, headshots: 0, streak: 0, bestStreak: 0 };
    this.dir = { pod: [1.5, 3], want: [7, 8], droneCD: 45, sniperCD: 95, mechAt: [150, 330, 510], mechI: 0, lastLead: 0 };
    this.menuT = 0; this.intro = { i: 0, t: 0 };
    // 手雷 / 空降舱模型
    const T = engine.T;
    this.grenadeGeo = new THREE.SphereGeometry(0.07, 10, 8); this.grenadeMat = new THREE.MeshStandardMaterial({ color: 0x20241c, roughness: 0.5, metalness: 0.6 });
    const pg = new THREE.CylinderGeometry(1.0, 1.15, 3.0, 8); pg.translate(0, 1.5, 0);
    this.podGeo = pg; const mk = (c) => new THREE.MeshStandardMaterial({ map: T.armor.map, normalMap: T.armor.normalMap, roughnessMap: T.armor.ormMap, metalnessMap: T.armor.ormMap, roughness: 1, metalness: 1, color: c });
    this.podMat = [mk(0x8a7a52), mk(0x3a2022)]; this.podCap = new THREE.ConeGeometry(1.0, 1.1, 8); this.podCap.translate(0, 3.55, 0);
    this.rift = spaces ? new RiftMode(this) : null;
  }

  // 把共用的 world / nav / 目标列表切到第 k 界。更新某个单位之前调用，它就只看得见自己那一界
  setCtx(k) { if (!this.spaces || k === this.ctx) return; this.ctx = k; const s = this.spaces[k]; this.world.use(s.world); this.nav.use(s.nav); this.targets = this.targetsP[k]; }
  // 动态物体挂在哪个节点下：多空间时是当前上下文那一界的组（只在那一界可见）
  get entRoot() { return this.spaces ? this.spaces[this.ctx].ents : this.engine.scene; }

  // ---------- 状态 ----------
  startMatch() {
    this.clearMatch();
    this.state = 'intro'; this.cinematic = true; this.intro.i = 0; this.intro.t = 0; this.matchT = 0; this.score = [0, 0];
    this.hud.setState('intro'); this.audio.play('match_start'); this.audio.music('combat'); this.audio.setIntensity(0.2);
  }
  beginPlay() {
    this.state = 'playing'; this.cinematic = false; this.player.spawn(this.level.playerSpawn); this.hud.setState('playing');
    if (this.rift) { this.rift.begin(); this.hud.announce('相位试炼开始 —— 按 T 在现世与蜃界之间切换，抵达天台的信标', 'info'); }
    else if (this.explore) { this._mechReady = true; this.hud.announce('自由探索：没有敌人，机甲随时可以呼叫（V）', 'info'); if (this.level.proto) this.after(4.5, () => this.hud.announce('灰盒地图：颜色代表用途，见左侧图例 · L 显示 / 隐藏标注', 'info')); }
    else {
      this.hud.announce('指挥部：消耗战开始 —— 先取得 ' + SCORE_GOAL + ' 分的一方获胜', 'info');
      this.after(5, () => this.hud.announce('提示：对着墙面起跳即可蹬墙跑，Q 发射钩爪', 'info'));
    }
    this.audio.loop('wind', true, { volume: 0.5 });
  }
  clearMatch() {
    for (const a of this.actors) a.remove(); for (const m of this.mechs) if (!m.removed) m.remove(); for (const p of this.pods) this.engine.scene.remove(p.mesh); for (const g of this.grenades) g.mesh.removeFromParent();
    this.actors = []; this.mechs = []; this.projectiles = []; this.grenades = []; this.pods = []; this.timers = [];
    this.mechCharge = 0; this.playerMech = null; this.stats = { kills: 0, deaths: 0, mechKills: 0, headshots: 0, streak: 0, bestStreak: 0 };
    this.dir = { pod: [1.5, 3], want: [7, 8], droneCD: 45, sniperCD: 95, mechAt: [150, 330, 510], mechI: 0, lastLead: 0 };
    this.player.inMech = false; this.timeScale = 1; this.fx.setRope(false);
    for (const k of ['mech_hum', 'mech_laser', 'slide', 'wallrun', 'grapple_reel', 'speed_wind', 'heartbeat', 'zipline_ride', 'rail_hold']) this.audio.loop(k, false);
    if (this.rift) this.rift.reset();
  }
  endMatch(win) {
    if (this.state !== 'playing') return; this.state = 'ending'; this.timeScale = 0.25; this.result = win;
    this.audio.music(win ? 'victory' : 'defeat'); this.audio.play(win ? 'victory_sting' : 'defeat_sting');
    this.hud.announce(win ? '任务完成 —— 我方获胜' : '任务失败 —— 敌方率先达到目标分', win ? 'good' : 'warn');
    this.after(0.9, () => { this.state = 'ended'; this.timeScale = 1; this.cinematic = true; this.input.unlock(); this.hud.showEnd(win, this); });
  }
  after(t, fn) { this.timers.push({ t, fn }); }

  // ---------- 自动对战：AI 大脑接管玩家本体（第一人称），真实键鼠只留给菜单 / 接管 ----------
  setAuto(on) {
    if (on === !!this.auto) return; const p = this.player, w = this.weapons;
    if (on) { const vin = new VInput(); this.auto = this.rift ? new RiftRunner(this, p, vin) : new PilotBrain(this, p, vin, { player: true, skill: 0.92 }); p.input = vin; w.input = vin; }   // 双界试炼里是按路线跑的示范演示
    else { this.auto = null; p.input = this.input; w.input = this.input; }
  }
  get ctl() { return this.auto ? this.auto.vin : this.input; }   // 当前操纵玩家的输入源

  // ---------- 查询 ----------
  enemiesOf(team) { return this.targets[team]; }
  rebuildTargets() {
    const P = this.targetsP; for (const T of P) { T[0].length = 0; T[1].length = 0; }
    for (const a of this.actors) if (a.alive) P[a.phase || 0][a.team === 0 ? 1 : 0].push(a);
    for (const m of this.mechs) if (m.alive && m.state !== 'drop') P[0][m.team === 0 ? 1 : 0].push(m);   // 机甲只出现在单空间的地图里（它的 phase 字段是步态相位，不是所在的界）
    if (this.player.alive && !this.player.inMech && this.state === 'playing') P[this.phase][1].push(this.player);
  }
  hitscan(o, d, maxDist, shooter) {
    const wh = this.world.raycast(o, d, maxDist); let best = wh ? wh.distance : maxDist, ent = null, head = false;
    const list = this.targets[shooter ? shooter.team : 0];
    for (let i = 0; i < list.length; i++) { const e = list[i]; if (e === shooter) continue; const t = e.hitTest(o, d, best); if (t >= 0 && t < best) { best = t; ent = e; head = !!e._head; } }
    if (!ent && !wh) return null;
    const r = this._hs || (this._hs = { ent: null, head: false, point: new THREE.Vector3(), normal: new THREE.Vector3(), surf: 'stone', dist: 0 });
    r.ent = ent; r.head = head; r.dist = best; r.point.copy(o).addScaledVector(d, best);
    if (!ent) { r.normal.copy(wh.normal); r.surf = wh.surf; }
    return r;
  }
  hitscanAll(o, d, maxDist, shooter) {
    const wh = this.world.raycast(o, d, maxDist); const dw = wh ? wh.distance : maxDist; const hits = [];
    for (const e of this.targets[shooter ? shooter.team : 0]) { const t = e.hitTest(o, d, dw); if (t >= 0) hits.push({ ent: e, head: !!e._head, t, point: new THREE.Vector3().copy(o).addScaledVector(d, t) }); }
    hits.sort((p, q) => p.t - q.t);
    return { hits, end: new THREE.Vector3().copy(o).addScaledVector(d, dw), world: !!wh, normal: wh ? wh.normal.clone() : null, surf: wh ? wh.surf : 'stone' };
  }
  explosionDamage(pos, radius, dmg, source, mechDmg = dmg) {
    const team = source ? source.team : 0; pos = _d.copy(pos); _b.set(pos.x, pos.y + 0.5, pos.z); let any = false, kill = false;
    const list = this.targets[team].slice();
    for (const e of list) {
      if (e === source) continue; e.aimPoint(_a); const d = _a.distanceTo(pos) - (e.kind === 'mech' ? 1.7 : 0); if (d > radius) continue;
      if (e.kind !== 'mech' && this.world.blocked(_b, _a)) continue;
      const k = 1 - Math.max(0, d) / radius; const amount = (e.kind === 'mech' ? mechDmg : dmg) * (0.35 + 0.65 * k);
      const killed = e.takeDamage(amount, source, { dir: _c.subVectors(_a, pos).normalize(), explosion: true }); any = true; kill = kill || killed;
    }
    const p = this.player;
    if ((source === p || (source && source.isPlayerMech)) && any) { this.hud.hitMarker(false, kill); if (this.playerMech && this.playerMech.piloted) this.playerMech.core = Math.min(1, this.playerMech.core + 0.05); }
    if (source === p && p.alive && !p.inMech && this.ctx === this.phase) { p.aimPoint(_a); const d = _a.distanceTo(pos); if (d < radius && !this.world.blocked(_b, _a)) p.takeDamage(dmg * 0.4 * (1 - d / radius), null, {}); }
  }
  shake(pos, amount, radius) { const d = this.engine.camera.position.distanceTo(pos); const k = Math.max(0, 1 - d / radius); if (k > 0) { this.player.shake = Math.min(1, this.player.shake + amount * k); if (amount * k > 0.5) this.flash = Math.max(this.flash, amount * k * 0.25); } }
  noise(pos, radius, source) { for (const a of this.actors) { if (!a.alive || a.team === source.team || a.target || a.static || a.kind === 'drone' || (a.phase || 0) !== this.ctx) continue; if (a.pos.distanceToSquared(pos) < radius * radius && Math.random() < 0.3) a.alert = pos.clone(); } }

  // ---------- 弹道 ----------
  spawnProjectile(o) { this.projectiles.push({ ...o, pos: o.pos.clone(), vel: o.vel.clone(), t: 0 }); }
  updateProjectiles(dt) {
    const fx = this.fx; const P = this.projectiles; let n = 0;
    for (let i = 0; i < P.length; i++) {
      const p = P[i]; p.t += dt; let dead = false;
      if (p.kind === 'rocket') { const sp = Math.min(95, p.vel.length() + 60 * dt); _a.subVectors(p.homing, p.pos).normalize(); p.vel.normalize().lerp(_a, Math.min(1, dt * 1.6)).normalize().multiplyScalar(sp); }
      const sp = p.vel.length(); const step = sp * dt; _a.copy(p.vel).multiplyScalar(1 / sp);
      const h = this.hitscan(p.pos, _a, step, p);
      if (h) {
        dead = true; const pt = h.point;
        if (p.kind === 'bolt') { if (h.ent) h.ent.takeDamage(p.dmg, p.owner, { point: pt, dir: _a }); fx.sparks(pt, h.ent ? null : h.normal, 5, [2.0, 0.5, 0.2], 4); fx.flashLight(pt, [1, 0.3, 0.1], 12, 0.08, 6); }
        else {
          if (h.ent) h.ent.takeDamage(h.ent.kind === 'mech' ? p.mechDmg : p.dmg * 2, p.owner, { point: pt, dir: _a });
          _b.copy(pt).addScaledVector(_a, -0.25); fx.explosion(_b, p.kind === 'shell' ? 1.0 : 0.8, { normal: h.ent ? undefined : h.normal, scorch: !h.ent });
          this.audio.play('explosion', { x: pt.x, y: pt.y, z: pt.z, volume: 0.75, pitch: 1.15 });
          this.explosionDamage(_b, p.radius, p.dmg, p.owner, p.mechDmg * 0.35);
          if (p.owner === this.player && h.ent) { this.hud.hitMarker(false, h.ent.alive === false); if (p.mech) p.mech.core = Math.min(1, p.mech.core + 0.06); }
        }
      } else {
        p.pos.addScaledVector(p.vel, dt);
        if (p.kind === 'bolt') fx.add.spawn({ x: p.pos.x, y: p.pos.y, z: p.pos.z, vx: 0, vy: 0, vz: 0, life: 0.06, s0: 0.42, s1: 0.2, r: 2.6, g: 0.45, b: 0.15, a: 1, tile: 6 });
        else if (p.kind === 'shell') { fx.add.spawn({ x: p.pos.x, y: p.pos.y, z: p.pos.z, vx: 0, vy: 0, vz: 0, life: 0.05, s0: 0.9, s1: 0.4, r: 2.4, g: 1.5, b: 0.6, a: 1, tile: 6 }); fx.alpha.spawn({ x: p.pos.x, y: p.pos.y, z: p.pos.z, vx: 0, vy: 0.3, vz: 0, life: 0.5, s0: 0.25, s1: 0.8, r: 0.6, g: 0.58, b: 0.55, a: 0.25, tile: 1 }); }
        else { fx.add.spawn({ x: p.pos.x, y: p.pos.y, z: p.pos.z, vx: 0, vy: 0, vz: 0, life: 0.06, s0: 0.8, s1: 0.3, r: 2.6, g: 1.2, b: 0.4, a: 1, tile: 6 }); fx.alpha.spawn({ x: p.pos.x, y: p.pos.y, z: p.pos.z, vx: rnd(-0.3, 0.3), vy: 0.5, vz: rnd(-0.3, 0.3), life: 1.1, s0: 0.3, s1: 1.3, r: 0.7, g: 0.68, b: 0.65, a: 0.4, tile: 1, drag: 1 }); }
        if (p.t > p.life) { dead = true; if (p.kind !== 'bolt') { fx.explosion(p.pos, 0.8, { scorch: false }); this.explosionDamage(p.pos, p.radius, p.dmg, p.owner, p.mechDmg * 0.35); } }
      }
      if (!dead) P[n++] = p;
    }
    P.length = n;
  }
  throwGrenade(pos, vel, owner) {
    const mesh = new THREE.Mesh(this.grenadeGeo, this.grenadeMat); mesh.position.copy(pos); mesh.castShadow = true; this.entRoot.add(mesh);
    this.grenades.push({ pos: pos.clone(), vel: vel.clone(), fuse: 1.9, owner, mesh, bounces: 0, ph: this.ctx });
  }
  updateGrenades(dt) {
    const G = this.grenades; let n = 0;
    for (let i = 0; i < G.length; i++) {
      const g = G[i]; g.fuse -= dt; g.vel.y -= 19 * dt; this.setCtx(g.ph); const here = g.ph === this.phase;   // 另一界的手雷：照常飞、照常炸那一界的人，但这边看不见也听不见
      const sp = g.vel.length(); const step = sp * dt;
      if (sp > 0.01) {
        _a.copy(g.vel).multiplyScalar(1 / sp); const h = this.world.raycast(g.pos, _a, step + 0.09);
        if (h) { g.pos.copy(h.point).addScaledVector(h.normal, 0.09); const vn = g.vel.dot(h.normal); g.vel.addScaledVector(h.normal, -1.45 * vn).multiplyScalar(0.7); if (sp > 2.5 && g.bounces++ < 4 && here) this.audio.play('grenade_bounce', { x: g.pos.x, y: g.pos.y, z: g.pos.z }); }
        else g.pos.addScaledVector(g.vel, dt);
      }
      // 碰到敌方机甲立即引爆
      for (const m of this.mechs) if (m.alive && m.team !== g.owner.team && m.state !== 'drop' && Math.hypot(m.pos.x - g.pos.x, m.pos.z - g.pos.z) < 1.9 && g.pos.y < m.pos.y + 5.5) g.fuse = 0;
      g.mesh.position.copy(g.pos); g.mesh.rotation.x += 9 * dt;
      if (here && Math.random() < 0.3) this.fx.add.spawn({ x: g.pos.x, y: g.pos.y, z: g.pos.z, vx: 0, vy: 0, vz: 0, life: 0.12, s0: 0.14, s1: 0.05, r: 2.5, g: 0.4, b: 0.1, a: 1, tile: 6 });
      if (g.fuse <= 0) {
        g.mesh.removeFromParent(); if (here) { this.fx.explosion(g.pos, 1.15, {}); this.audio.play('explosion', { x: g.pos.x, y: g.pos.y, z: g.pos.z }); this.audio.duck(0.25, 0.5); }
        this.explosionDamage(g.pos, 6.8, 170, g.owner, 520);
      } else G[n++] = g;
    }
    G.length = n; this.setCtx(this.phase);
  }

  // ---------- 近战 ----------
  meleeTarget(p, range, cone) {
    let best = null, bd = range; p.getEye(_a);
    for (const e of this.targets[0]) { if (e.kind === 'mech' || e.kind === 'drone') continue; e.aimPoint(_b); _c.subVectors(_b, _a); const d = _c.length(); if (d < bd && _c.dot(p.look) / d > cone) { bd = d; best = e; } }
    return best;
  }
  meleeLunge(p) { const t = this.meleeTarget(p, 4.8, 0.82); if (t && p.onGround) { _c.set(t.pos.x - p.pos.x, 0, t.pos.z - p.pos.z).normalize(); p.vel.x = _c.x * 13; p.vel.z = _c.z * 13; } }
  meleeAttack(p, range, dmg) {
    const t = this.meleeTarget(p, range, 0.55);
    if (t) { const killed = t.takeDamage(dmg, p, { dir: p.look, melee: true }); t.aimPoint(_b); this.fx.hitFlesh(_b, p.look, t.robot); this.audio.play('melee_hit'); this.hud.hitMarker(false, killed); p.shake = Math.min(1, p.shake + 0.35); }
    else { p.getEye(_a); const h = this.world.raycast(_a, p.look, 2.0); if (h) { this.fx.impact(h.point, h.normal, h.surf, 1.2, false); p.shake = Math.min(1, p.shake + 0.2); } }
  }

  // ---------- 事件 ----------
  onPlayerHurt(amount, from, info) {
    this.hurtFlash = Math.min(1, this.hurtFlash + amount / 38);
    if (from && from.pos) this.hud.damageFrom(from.pos);
    if (this.time - this.hurtSnd > 0.22) { this.hurtSnd = this.time; this.audio.play('hurt', { volume: Math.min(1, 0.4 + amount / 40) }); }
  }
  onPlayerDeath(from) {
    this.stats.deaths++; this.stats.streak = 0; this.score[1] += SCORE.pilot; this.respawnT = this.rift ? 2.2 : 4.5;
    this.hud.killfeed(from ? from.name : '环境', '你', 1); this.hud.announce(this.rift ? '你已阵亡 —— 即将回到检查点' : '你已阵亡 —— 即将重新部署', 'warn');
  }
  onKill(victim, killer, info) {
    const p = this.player; const byPlayer = killer === p || (killer && killer.isPlayerMech);
    const kteam = killer ? killer.team : 1 - victim.team;
    if (kteam !== victim.team && this.state === 'playing') this.score[kteam] += SCORE[victim.kind] || 1;
    if (victim === this.playerMech) { this.playerMech = null; this.mechCharge = 0; this.hud.announce('你的机甲已被摧毁', 'warn'); }
    if (byPlayer) {
      const s = this.stats; s.kills++; s.streak++; if (s.streak > s.bestStreak) s.bestStreak = s.streak; if (info && info.head) s.headshots++; if (victim.kind === 'mech') s.mechKills++;
      if (!this.playerMech) this.mechCharge = Math.min(1, this.mechCharge + (METER[victim.kind] || 0.04));
      this.hud.popup(KIND_NAME[victim.kind] + (info && info.head ? ' · 爆头' : info && info.melee ? ' · 处决' : info && info.stomp ? ' · 踩踏' : '') + '击杀', SCORE[victim.kind] || 1);
      this.hud.killfeed('你', victim.name, 0);
      if (s.streak === 5) this.hud.announce('五连杀 —— 势不可挡', 'good'); if (s.streak === 10) this.hud.announce('十连杀 —— 沙暴化身', 'good');
      if (victim.kind === 'mech') this.hud.announce('敌方机甲已摧毁！', 'good');
    } else if (killer && (victim.kind !== 'grunt' || this.engine.camera.position.distanceTo(victim.pos) < 70)) this.hud.killfeed(killer.name || '?', victim.name, kteam);
  }

  // ---------- 增援导演 ----------
  spawnPod(team) {
    const list = team === 0 ? this.level.friendlyPods : this.level.enemyPods; let best = null, bs = -1e9; const p = this.player;
    for (const c of list) { let s = Math.random() * 30; const dp = Math.hypot(c[0] - p.pos.x, c[1] - p.pos.z); if (team === 1) s += Math.min(dp, 40); else s -= Math.abs(dp - 25) * 0.3; for (const o of this.pods) if (Math.hypot(o.x - c[0], o.z - c[1]) < 6) s -= 100; if (s > bs) { bs = s; best = c; } }
    const q = this.nav.randomNear(best[0], best[1], 4) || { x: best[0], z: best[1] };
    const mesh = new THREE.Group(); const b = new THREE.Mesh(this.podGeo, this.podMat[team]); b.castShadow = true; mesh.add(b); const cap = new THREE.Mesh(this.podCap, this.podMat[team]); cap.castShadow = true; mesh.add(cap);
    const gy = this.nav.height(q.x, q.z); mesh.position.set(q.x, gy + 160, q.z); mesh.rotation.y = Math.random() * 6; this.engine.scene.add(mesh);
    const n = 3 + (Math.random() < 0.5 ? 1 : 0);
    this.pods.push({ team, x: q.x, z: q.z, gy, t: 0, state: 0, mesh, n });
    this.audio.play('pod_incoming', { x: q.x, y: gy + 30, z: q.z, volume: 0.8 });
  }
  spawnPilot(team) {
    const list = team === 0 ? this.level.friendlyPods : this.level.enemyPods; const c = list[(Math.random() * list.length) | 0];
    const q = this.nav.randomNear(c[0], c[1], 5) || { x: c[0], z: c[1] };
    this.actors.push(new AIPilot(this, team, q.x, q.z, { drop: 26 }));
    if (team === 1 && !this.dir.pilotSeen) { this.dir.pilotSeen = true; this.hud.announce('敌方铁驭已投入战场 —— 他们同样会蹬墙、滑铲和钩索', 'warn'); }
  }
  updatePods(dt) {
    const P = this.pods; let k = 0;
    for (let i = 0; i < P.length; i++) {
      const p = P[i]; p.t += dt; let keep = true;
      if (p.state === 0) {
        const u = Math.min(1, p.t / 1.5); p.mesh.position.y = p.gy + (1 - u) * 160;
        for (let j = 0; j < 2; j++) this.fx.add.spawn({ x: p.x + rnd(-0.5, 0.5), y: p.mesh.position.y + 4 + rnd(0, 3), z: p.z + rnd(-0.5, 0.5), vx: 0, vy: 15, vz: 0, life: 0.35, s0: 2.2, s1: 0.4, r: 2.4, g: 1.1, b: 0.4, a: 0.9, tile: 6 });
        if (u >= 1) {
          p.state = 1; p.t = 0; _a.set(p.x, p.gy + 0.1, p.z);
          this.fx.dustPuff(_a, 14, 2.2, this.fx.dustCol, 7); this.fx.ring(_a, [1.2, 0.9, 0.6], 8, 0.5); this.fx.sparks(_a, null, 14, [1.8, 1.1, 0.5], 9); this.fx.decal(this.fx.scorch, _a, new THREE.Vector3(0, 1, 0), 1.6);
          this.audio.play('pod_impact', { x: p.x, y: p.gy, z: p.z }); this.shake(_a, 0.5, 45);
          for (const e of this.targets[p.team].slice()) if (e.kind !== 'mech' && Math.hypot(e.pos.x - p.x, e.pos.z - p.z) < 2.6 && Math.abs(e.pos.y - p.gy) < 3) e.takeDamage(999, null, {});
        }
      } else if (p.state === 1) {
        if (p.t > 0.6) {
          p.state = 2;
          for (let j = 0; j < p.n; j++) { const q = this.nav.randomNear(p.x, p.z, 3.5); if (!q) continue; const kind = p.team === 1 && this.matchT > 70 && Math.random() < 0.28 ? 'stalker' : 'grunt'; this.actors.push(new Soldier(this, kind, p.team, q.x, q.z)); }
        }
      } else { if (p.t > 16) { p.mesh.position.y -= dt * 1.2; if (p.t > 19) { this.engine.scene.remove(p.mesh); keep = false; } } }
      if (keep) P[k++] = p;
    }
    P.length = k;
  }
  director(dt) {
    // 自由探索：不刷敌人、不计分、不会结束；机甲随时可以呼叫
    if (this.explore) { if (!this.playerMech && !this.player.inMech) this.mechCharge = 1; return; }
    const D = this.dir; const cnt = [0, 0], pil = [0, 0]; let drones = 0, snipers = 0, emech = 0;
    for (const a of this.actors) { if (!a.alive) continue; if (a.kind === 'drone') drones++; else if (a.kind === 'sniper') snipers++; else if (a.kind === 'pilot') pil[a.team]++; else cnt[a.team]++; }
    // AI 铁驭：每队维持约 2 名（敌方后期 3 名），阵亡后隔 8–12 秒在本队空降点重新投入
    if (!D.pilotCD) D.pilotCD = [6, 14];
    for (const t of [0, 1]) { D.pilotCD[t] -= dt; const want = t === 1 && (this.matchT > 240 || this.auto) ? 3 : 2; if (pil[t] >= want) D.pilotCD[t] = Math.max(D.pilotCD[t], 8); else if (D.pilotCD[t] <= 0) { this.spawnPilot(t); D.pilotCD[t] = rnd(8, 12); } }
    for (const p of this.pods) if (p.state < 2) cnt[p.team] += p.n;
    for (const m of this.mechs) if (m.alive && m.team === 1) emech++;
    // 自动对战时玩家本体由大脑操控、战绩很高：给敌方多投 3 个步兵、从开局就是 3 名铁驭，比分才不会一边倒
    for (const t of [0, 1]) { D.pod[t] -= dt; if (cnt[t] < D.want[t] + (t === 1 && this.auto ? 3 : 0) && D.pod[t] <= 0) { this.spawnPod(t); D.pod[t] = t === 0 ? rnd(10, 14) : rnd(9, 13); } }
    D.droneCD -= dt; if (this.matchT > 45 && drones < (this.matchT > 240 ? 3 : 2) && D.droneCD <= 0) { const ds = this.level.droneSpawn || { x0: -40, x1: 40, z: -66 }; this.actors.push(new Drone(this, 1, rnd(ds.x0, ds.x1), ds.z)); D.droneCD = 22; }
    D.sniperCD -= dt;
    if (this.matchT > 95 && snipers < (this.matchT > 320 ? 2 : 1) && D.sniperCD <= 0) {
      const nests = this.level.nests.filter((n) => !this.actors.some((a) => a.alive && a.kind === 'sniper' && Math.hypot(a.pos.x - n[0], a.pos.z - n[2]) < 2));
      const n = nests[(Math.random() * nests.length) | 0];
      if (n) { this.actors.push(new Soldier(this, 'sniper', 1, n[0], n[2], { y: n[1], yaw: Math.atan2(n[0], n[2]) })); this.hud.announce('敌方狙击手已就位 —— 留意红色激光', 'warn'); this.audio.play('warning'); }
      D.sniperCD = 50;
    }
    if (D.mechI < D.mechAt.length && this.matchT > D.mechAt[D.mechI] && emech === 0) {
      D.mechI++; let best = null, bs = -1; for (const c of this.level.mechDrops) { if (c[1] > 10) continue; const d = Math.hypot(c[0] - this.player.pos.x, c[1] - this.player.pos.z); if (d > bs && this.nav.walkable(c[0], c[1], true)) { bs = d; best = c; } }
      if (best) { this.mechs.push(new Mech(this, 1, best[0], best[1], { yaw: Math.PI })); this.hud.announce('警告：敌方机甲正在空降！用轨道步枪或手雷对付它', 'warn'); this.audio.play('warning'); }
    }
    // 胜负
    if (this.score[0] >= SCORE_GOAL || this.score[1] >= SCORE_GOAL) this.endMatch(this.score[0] >= SCORE_GOAL);
    else if (this.matchT >= MATCH_TIME) this.endMatch(this.score[0] >= this.score[1]);
  }

  // ---------- 机甲 ----------
  tryCallMech() {
    const p = this.player; p.getEye(_a);
    const h = this.world.raycast(_a, p.look, 70); const pt = h ? h.point : _b.copy(_a).addScaledVector(p.fwd, 22);
    const i = this.nav.nearestIn(pt.x, pt.z, this.nav.mech, 10);
    if (i < 0) { this.hud.announce('此处空间不足，无法空降机甲', 'warn'); this.audio.play('dry_fire'); return; }
    const x = this.nav.cx(i), z = this.nav.cz(i);
    const m = new Mech(this, 0, x, z, { player: true, yaw: p.yaw }); this.mechs.push(m); this.playerMech = m; this.mechCharge = 0;
    this.hud.announce('机甲空降中 —— 远离落点！', 'good'); this.audio.play('mech_ready');
  }
  embark(m) {
    const p = this.player; p.inMech = true; m.piloted = true; m.state = 'piloted'; m.vel.set(0, 0, 0); p.grapple.state = 0; p.zip.on = false; p.wr.on = false; this.fx.setRope(false);
    this.fade = 1; this.audio.play('mech_embark'); this.hud.setMode('mech');
    for (const k of ['slide', 'wallrun', 'grapple_reel', 'speed_wind', 'zipline_ride', 'rail_hold']) this.audio.loop(k, false);
  }
  disembark(m) {
    const p = this.player; m.piloted = false; m.state = 'idle'; m.laserT = -1; p.inMech = false;
    p.pos.set(m.pos.x, m.pos.y + 6.3, m.pos.z); p.vel.set(p.fwd.x * 6, 5.5, p.fwd.z * 6); p.onGround = false; p.jumpsLeft = 1; p.pitch = Math.max(-1, Math.min(1, p.pitch));
    this.fade = 0.8; this.audio.play('mech_disembark'); this.audio.loop('mech_hum', false); this.audio.loop('mech_laser', false); this.hud.setMode('pilot');
  }
  ejectFromMech(m) {
    const p = this.player; m.piloted = false; p.inMech = false; p.pos.set(m.pos.x, m.pos.y + 6.5, m.pos.z); p.vel.set(p.fwd.x * 2, 36, p.fwd.z * 2); p.onGround = false; p.jumpsLeft = 1; p.invuln = 2.5; p.hp = Math.max(p.hp, 60);
    m.state = 'idle'; this.audio.play('eject'); this.audio.loop('mech_hum', false); this.audio.loop('mech_laser', false); this.hud.setMode('pilot'); this.hud.announce('弹射！', 'good'); this.flash = 0.5;
    this.after(0.7, () => m.destroy(m.killer));
  }

  // ---------- 每帧 ----------
  update(rawDt) {
    const dt = rawDt * this.timeScale; this.time += dt; this.frame++;
    const eng = this.engine, cam = eng.camera, p = this.player, fxu = eng.post.fx;
    for (let i = this.timers.length - 1; i >= 0; i--) { const t = this.timers[i]; t.t -= dt; if (t.t <= 0) { this.timers.splice(i, 1); t.fn(); } }
    this.setCtx(this.phase); this.rebuildTargets(); this.sniperWarn = 0;
    if (this.state === 'menu' || this.state === 'ended') { this.weapons.root.visible = false; this.updateMenuCam(dt); }
    else if (this.state === 'intro') { this.weapons.root.visible = false; this.updateIntro(dt); }
    else {
      this.matchT += this.state === 'playing' ? dt : 0;
      if (this.auto) this.auto.update(dt);
      if (this.rift && this.state === 'playing') this.rift.update(dt);   // 相位切换在玩家移动之前结算
      p.update(dt);
      for (let i = this.mechs.length - 1; i >= 0; i--) { if (!this.mechs[i].update(dt)) this.mechs.splice(i, 1); }
      cam.updateMatrixWorld(true);
      this.weapons.update(dt);
      const cp = cam.position; let k = 0;
      for (let i = 0; i < this.actors.length; i++) { const a = this.actors[i]; this.setCtx(a.phase || 0); if (a.update(dt, a.pos.distanceTo(cp))) this.actors[k++] = a; else a.remove(); }
      this.actors.length = k; this.setCtx(this.phase);
      this.updateProjectiles(dt); this.updateGrenades(dt); this.updatePods(dt);
      if (this.state === 'playing' && !this.rift) this.director(dt);
      this.playerLogic(dt);
      if (this.rift) this.rift.late(dt);
    }
    this.fx.update(dt);
    // 后处理参数
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.2); this.fade = Math.max(0, this.fade - dt * 2.4); this.flash = Math.max(0, this.flash - dt * 3);
    const playing = this.state === 'playing' || this.state === 'ending';
    const sp = playing ? Math.hypot(p.vel.x, p.vel.y * 0.6, p.vel.z) : 0;
    fxu.uSpeed.value += ((playing && !p.inMech ? Math.max(0, Math.min(1, (sp - 10) / 10)) * 0.9 : (this.playerMech && this.playerMech.dashT > 0 ? 0.8 : 0)) - fxu.uSpeed.value) * Math.min(1, dt * 6);
    fxu.uHurt.value = playing ? this.hurtFlash : 0; fxu.uLowHP.value = playing && !p.inMech ? Math.max(0, 1 - p.hp / 45) : 0; fxu.uFade.value = this.fade; fxu.uFlash.value = this.flash; fxu.uADS.value = playing ? p.adsT * (this.weapons.cur === 'rail' ? 1.6 : 0.5) : 0;
    this.audio.setListener(cam.position.x, cam.position.y, cam.position.z, -Math.sin(p.yaw) * Math.cos(p.pitch), Math.sin(p.pitch), -Math.cos(p.yaw) * Math.cos(p.pitch), 0, 1, 0);
    this.audio.update(rawDt);
    this.hud.frame(this, rawDt);
  }

  playerLogic(dt) {
    const p = this.player, inp = this.input; this.interactPrompt = null;
    if (!p.alive) { this.respawnT -= dt; this.fx.setRope(false); if (this.respawnT <= 0 && this.state === 'playing' && this.rift) { this.rift.respawn(false); return; } if (this.respawnT <= 0 && this.state === 'playing') { let s = this.level.playerSpawn, bd = -1; const RS = this.level.respawns && this.level.respawns.length ? this.level.respawns : null;   // 地图自带重生点（高度取导航网格）；旧城用下面这几个固定点
      for (const c of RS || [[0, 67], [-22, 66], [22, 66], [-40, 60], [48, 68]]) { let nd = 1e9; for (const e of this.targets[0]) nd = Math.min(nd, Math.hypot(e.pos.x - c[0], e.pos.z - c[1])); if (nd > bd) { bd = nd; s = { x: c[0], y: RS ? this.nav.height(c[0], c[1]) + 0.1 : 0.1, z: c[1] }; } } p.spawn({ x: s.x + rnd(-2, 2), y: s.y, z: s.z + rnd(-1, 1), yaw: 0 }); this.fade = 1; this.hud.announce('已重新部署', 'info'); } return; }
    if (this.level.oob) this.checkOOB(dt);
    // 钩索可视化
    const g = p.grapple; if (g.state > 0 && !p.inMech) { this.weapons.grappleOrigin(_a); this.fx.setRope(true, _a, g.hook, g.state, this.time); } else this.fx.setRope(false);
    // 机甲充能 / 呼叫
    const pm = this.playerMech;
    if (this.rift) { /* 试炼里没有机甲 */ }
    else if (!pm) { this.mechCharge = Math.min(1, this.mechCharge + dt / 170); if (this.mechCharge >= 1 && !this._mechReady) { this._mechReady = true; this.hud.announce('机甲已就绪 —— 按 V 呼叫空降', 'good'); this.audio.play('mech_ready'); } if (this.mechCharge < 1) this._mechReady = false; if (this.ctl.hit('KeyV') && this.mechCharge >= 1 && !p.inMech) this.tryCallMech(); }
    else if (!p.inMech && pm.alive && (pm.state === 'idle' || pm.state === 'landing')) {
      const d = Math.hypot(pm.pos.x - p.pos.x, pm.pos.z - p.pos.z);
      if (d < 6.5 && pm.state === 'idle') { this.interactPrompt = '按 E 登机'; if (this.ctl.hit('KeyE')) this.embark(pm); }
    }
    if (!this.interactPrompt && p.zip.near && !p.inMech) this.interactPrompt = '按 E 使用滑索';
    // 音乐强度
    let threat = 0; for (const a of this.targets[0]) { const d = a.pos.distanceTo(p.pos); if (d < 45) threat += a.kind === 'mech' ? 3 : 1; }
    this.audio.setIntensity(Math.min(1, 0.15 + threat * 0.12)); this.audio.loop('heartbeat', p.hp < 35 && !p.inMech, { volume: 0.8 });
    if (p.inMech !== this._inMechMusic) { this._inMechMusic = p.inMech; this.audio.music(p.inMech ? 'mech' : 'combat'); }
  }

  // 离开战区（地图给了 level.oob 才有）：没有隐形墙拦着，翻出边界或掉到地图底下时，倒数几秒后送回最近的重生点，不算阵亡
  checkOOB(dt) {
    const o = this.level.oob, p = this.player; if (!p.alive || p.inMech || this.state !== 'playing') { this.oobT = 0; return; }
    const fell = p.pos.y < o.y0; let out = fell || p.pos.x < o.x0 || p.pos.x > o.x1 || p.pos.z < o.z0 || p.pos.z > o.z1;
    // 不规则边界（多边形）：翻上四周的悬崖、走出多边形就算离开战区
    if (!out && o.test) out = o.test(p.pos.x, p.pos.y, p.pos.z);   // 地图自己的判定（比如站到了墙体顶上）
    if (!out && o.poly) { const P = o.poly, x = p.pos.x, z = p.pos.z; let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, zi] = P[i], [xj, zj] = P[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } out = !c; }
    if (!out) { if (this.oobT > 0) { this.oobT = 0; this.hud.announce('已回到战区', 'info'); } return; }
    const prev = this.oobT || 0; this.oobT = prev + dt; const left = Math.ceil(4 - this.oobT);
    if (fell || this.oobT >= 4) {
      let best = null, bd = 1e9; for (const c of this.level.respawns || []) { const dd = Math.hypot(c[0] - p.pos.x, c[1] - p.pos.z); if (dd < bd) { bd = dd; best = c; } }
      const s = best ? { x: best[0], y: this.nav.height(best[0], best[1]) + 0.1, z: best[1] } : this.level.playerSpawn;
      p.pos.set(s.x, s.y, s.z); p.vel.set(0, 0, 0); p.grapple.state = 0; p.wr.on = false; p.zip.on = false; this.oobT = 0; this.fade = 1; this.hud.announce('已送回战区', 'info');
    } else if (prev === 0 || Math.ceil(4 - prev) !== left) this.hud.announce(`已离开战区 —— ${left} 秒后送回`, 'warn');
  }

  updateMenuCam(dt) {
    this.menuT += dt * 0.045; const cam = this.engine.camera; const a = this.menuT;
    if (this.rift) { cam.position.set(Math.sin(a) * 40, 24 + Math.sin(a * 0.7) * 5, -8 + Math.cos(a) * 74); cam.lookAt(0, 3, -10); }   // 回廊是南北向的长条：椭圆轨道
    else if (this.level.menuCam) { const m = this.level.menuCam; cam.position.set(m.x + Math.sin(a) * m.rx, m.y + Math.sin(a * 0.7) * m.dy, m.z + Math.cos(a) * m.rz); cam.lookAt(m.look[0], m.look[1], m.look[2]); }
    else { cam.position.set(Math.sin(a) * 58 + 4, 15 + Math.sin(a * 0.7) * 5, Math.cos(a) * 62); cam.lookAt(2, 4, -4); }
    if (Math.abs(cam.fov - 58) > 0.01) { cam.fov = 58; cam.updateProjectionMatrix(); }
    this.player.pos.copy(cam.position); this.player.eyePos.copy(cam.position);
  }
  updateIntro(dt) {
    const I = this.intro, F = this.level.flyover, cam = this.engine.camera; I.t += dt;
    const seg = F[I.i]; const u = Math.min(1, I.t / seg.t); const e = u * u * (3 - 2 * u);
    cam.position.set(seg.from[0] + (seg.to[0] - seg.from[0]) * e, seg.from[1] + (seg.to[1] - seg.from[1]) * e, seg.from[2] + (seg.to[2] - seg.from[2]) * e); cam.lookAt(seg.look[0], seg.look[1], seg.look[2]);
    if (Math.abs(cam.fov - 55) > 0.01) { cam.fov = 55; cam.updateProjectionMatrix(); }
    this.player.eyePos.copy(cam.position);
    if (I.t > seg.t - 0.35) this.fade = Math.max(this.fade, 1 - (seg.t - I.t) / 0.35);
    const skip = this.input.anyHit('Space', 'Enter', 'Mouse0');
    if (u >= 1 || skip) { I.i++; I.t = 0; this.fade = 1; if (I.i >= F.length || skip) this.beginPlay(); }
  }
}
