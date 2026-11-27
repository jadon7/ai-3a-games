// 铁驭大脑：决策层。只读 Pilot 本体、导航网格、碰撞世界与敌人列表，输出全部写进虚拟输入（移动轴、视角增量、按键）。
// 同一个大脑既驱动玩家本体（第一人称自动对战），也驱动 NPC 铁驭。不依赖任何地图坐标：滑铲、蹬墙、二段跳、钩索的时机全靠射线探测。
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _n = new THREE.Vector3(), _t = new THREE.Vector3();
const _eye = new THREE.Vector3(), _p = new THREE.Vector3(), _q = new THREE.Vector3();
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };
const yawOf = (dx, dz) => Math.atan2(-dx, -dz);
const ORDER = ['rifle', 'shotgun', 'rail'];
const GY = [0, -0.22, 0.22, -0.45, 0.45], GP = [0.2, 0.34, 0.5];   // 钩点搜索：相对路线方位的偏航 / 俯仰

// 虚拟输入：与 core/input.js 的 Input 同接口，另带模拟量移动轴 axis（f 前后 / s 左右，相对视角）
export class VInput {
  constructor() { this.keys = new Set(); this.hits = new Set(); this.ups = new Set(); this.dx = 0; this.dy = 0; this.wheel = 0; this.axis = { f: 0, s: 0 }; this.active = true; }
  down(c) { const a = this.axis; if (c === 'KeyW') return a.f > 0.3; if (c === 'KeyS') return a.f < -0.3; if (c === 'KeyD') return a.s > 0.3; if (c === 'KeyA') return a.s < -0.3; return this.keys.has(c); }
  hit(c) { return this.hits.has(c); }
  up(c) { return this.ups.has(c); }
  anyDown(...cs) { for (const c of cs) if (this.down(c)) return true; return false; }
  anyHit(...cs) { for (const c of cs) if (this.hit(c)) return true; return false; }
  set(c, on) { if (on) { if (!this.keys.has(c)) this.hits.add(c); this.keys.add(c); } else if (this.keys.delete(c)) this.ups.add(c); }
  tap(c) { this.hits.add(c); }
  endFrame() { this.hits.clear(); this.ups.clear(); this.dx = 0; this.dy = 0; }
}

export class PilotBrain {
  // opts.player：驱动的是玩家本体（开火 / 换枪 / 手雷走 Weapons 的按键）；opts.skill ∈ (0,1]：反应、跟枪、瞄准误差
  constructor(game, body, vin, opts = {}) {
    this.game = game; this.body = body; this.vin = vin; this.nav = game.nav; this.world = game.world;
    this.isPlayer = !!opts.player; this.skill = opts.skill !== undefined ? opts.skill : 0.8;
    this.mv = new THREE.Vector3(); this.aimPt = new THREE.Vector3(); this.lastSeen = new THREE.Vector3(); this.stuckP = new THREE.Vector3();
    this.out = { fire: false, tgt: null, dist: 0 };                                   // NPC 的开火意图（由 AIPilot 执行）
    this.stat = { stuckMax: 0, stuckEvents: 0, wallPlans: 0, grapPlans: 0, nades: 0, melees: 0 };
    this.ph = Math.random() * 100; this.t = 0; this.dead = false; this.wallPref = Math.random() < 0.5 ? 1 : -1;
    this.reset();
  }

  reset() {
    const b = this.body;
    this.tgt = null; this.tgtVis = false; this.tgtSeenT = -9; this.reactT = 0; this.senseT = 0; this.tdist = 0; this.nearVis = 0;
    this.tempo = 'strike'; this.tempoT = 0; this.strikeT = 0; this.run = 0; this.mechT = 0;
    this.path = null; this.pathI = 0; this.goal = null; this.mode = 'roam'; this.repathT = 0; this.goalT = 0; this.coverT = 0; this.orbitSide = Math.random() < 0.5 ? 1 : -1;
    this.moving = false; this.seg = 0; this.remain = 0; this.clr = 0; this.clrT = 0;
    this.slideHold = 0; this.jumpCD = 0; this.styleDJ = false; this.relT = 0; this.aimHold = 0; this.holdSum = 0;
    this.wall = null; this.wallCD = 0.5; this.wallScanT = 0;
    this.grap = null; this.grapCD = rnd(1.5, 3.5); this.grapScanT = 0;
    this.yv = 0; this.pv = 0; this.wy = 0; this.wp = 0; this.lty = null; this.ltp = 0; this.lookO = null;
    this.stuckT = 0; this.still = 0; this.stuckP.copy(b.pos); this.hist = []; this.detourT = 0; this.idleT = 0; this.bumpSide = 1; this.backT = 0; this.duckT = 0; this.hop = false; this.stuckLv = 0; this.holdLock = 0; this.escT = 0; this.routeY = 0; this.lt = []; this.ltT = 0;
    this.swCD = 0; this.nadeCD = rnd(5, 10); this.nade = null; this.meleeCD = 0; this.mechCD = 2;
    this.vin.keys.clear(); this.vin.axis.f = 0; this.vin.axis.s = 0;
  }

  update(dt) {
    const b = this.body, vin = this.vin; vin.endFrame(); this.t += dt;
    if (!b.alive) { vin.keys.clear(); vin.axis.f = vin.axis.s = 0; this.dead = true; this.out.fire = false; return; }
    if (this.dead) { this.dead = false; this.reset(); }
    vin.set('ShiftLeft', !b.autoSprint);                 // 关掉“自动冲刺”的玩家设置下，冲刺要按住 Shift
    // 自动对战每局只开一次机甲（一段约 35–55 秒的机甲戏），其余时间都是铁驭徒步作战
    if (this.game.matchT < (this._mt || 0)) this.mechRides = 0; this._mt = this.game.matchT;
    if (b.inMech) { this.mechPilot(dt); return; }
    this.mechT = 0;
    this.sense(dt); this.plan(dt); this.locomote(dt); this.combat(dt); this.aim(dt);
  }

  // ---------- 感知：选敌 ----------
  sense(dt) {
    const b = this.body, g = this.game; const tg = this.tgt;
    if (tg && tg.alive === false) { this.tgt = null; this.tgtVis = false; }
    this.senseT -= dt; if (this.senseT > 0) return; this.senseT = 0.1 + Math.random() * 0.06;
    b.getEye(_eye); const list = g.enemiesOf(b.team); let best = null, bs = 1e9, bv = false, bd = 0, near = 0;
    const hot = g.time - b.lastHurtT < 3 ? b.lastDamageFrom : null;
    for (let i = 0; i < list.length; i++) {
      const c = list[i]; if (c.alive === false || c === b) continue;
      c.aimPoint(_p); const d = _p.distanceTo(_eye); if (d > 120) continue;
      let s = d * (c === this.tgt ? 0.6 : 1) * (c === hot ? 0.55 : 1) * (c.kind === 'drone' ? 1.4 : c.kind === 'mech' ? 1.25 : 1);
      if (s >= bs && d > 22) continue;
      const vis = !this.world.blocked(_eye, _p); if (vis && d < 22 && c.kind !== 'drone') near++;
      if (!vis) { if (c !== this.tgt && c !== hot && d > 26) continue; s *= 2.3; }
      if (s >= bs) continue;
      bs = s; best = c; bv = vis; bd = d;
    }
    this.nearVis = near;
    if (best) {
      if (best !== this.tgt) { this.reactT = this.t + (this.tgt && this.t - this.tgtSeenT < 0.6 ? 0.07 : rnd(0.1, 0.2) / this.skill); this.lty = null; }   // 连续交火中换目标反应更快
      this.tgt = best; this.tgtVis = bv; this.tdist = bd; if (bv) { this.tgtSeenT = this.t; best.aimPoint(this.lastSeen); }
    } else if (this.tgt) { this.tgtVis = false; if (this.t - this.tgtSeenT > 3) this.tgt = null; }
  }

  // ---------- 意图：去哪 ----------
  plan(dt) {
    const b = this.body, tg = this.tgt; this.repathT -= dt; this.goalT -= dt; this.coverT -= dt; this.detourT -= dt;
    if (this.detourT > 0 && this.goal) { if (this.repathT <= 0) this.repath(); return; }   // 脱困绕行中：先把这段路走完
    const hurtAgo = this.game.time - b.lastHurtT;
    let mode = 'roam';
    const far = tg && this.tdist > 42 && tg.kind !== 'sniper' && tg.kind !== 'mech' && tg.kind !== 'drone';   // 远处的步兵：先靠近再打
    const hpK = b.hp / b.maxHp;
    if ((hpK < 0.52 && hurtAgo < 4) || (this.nearVis >= 3 && hpK < 0.78 && hurtAgo < 2) || (this.mode === 'cover' && hpK < 0.82 && this.coverT > 0)) mode = 'cover';
    else if (this.isPlayer && this.game.playerMech && this.game.playerMech.alive && this.game.playerMech.state !== 'piloted' && this.game.playerMech !== this.mechDone) mode = 'mech';   // 机甲已呼叫：过去登机（路上照打）
    else if (tg) mode = this.tgtVis && !far ? 'fight' : 'chase';
    if (mode !== this.mode) { this.mode = mode; this.goalT = 0; this.repathT = 0; if (mode === 'cover') this.coverT = 8; }
    const gd = this.goal ? Math.hypot(this.goal.x - b.pos.x, this.goal.z - b.pos.z) : 1e9; const arrived = gd < 2.2;
    if (arrived && b.onGround && b.pos.y - this.nav.height(b.pos.x, b.pos.z) > 1.6 && mode !== 'fight') {   // 人在屋顶 / 高台上，目的地在正下方：先朝远处走，从边上跳下去
      for (let k = 0; k < 6; k++) { const q = this.nav.randomNear(b.pos.x, b.pos.z, 14); if (q && Math.hypot(q.x - b.pos.x, q.z - b.pos.z) > 7) { this.mode = mode; this.setGoal(q.x, q.z); this.detourT = 2.5; this.goalT = 2.5; return; } }
    }
    if (mode === 'fight') { if (this.goalT <= 0 || arrived) this.pickOrbit(); }
    else if (mode === 'chase') { if (this.goalT <= 0 || arrived) { this.chaseGoal(tg); this.goalT = rnd(0.7, 1.1); } }
    else if (mode === 'cover') { if (this.goalT <= 0 || arrived) this.pickCover(); }
    else if (mode === 'mech') { if (this.goalT <= 0 || arrived) { const m = this.game.playerMech; const q = m.state === 'idle' ? null : this.nav.randomNear(m.pos.x, m.pos.z, 6); this.setGoal(q ? q.x : m.pos.x, q ? q.z : m.pos.z); this.goalT = 1.2; } }   // 机甲还在落：在落点附近走动等它
    else if (!this.goal || arrived || this.goalT <= 0) this.pickRoam();
    if (this.goal && this.repathT <= 0) this.repath();
  }
  setGoal(x, z) { this.goal = { x, z }; return this.repath(); }
  // 追击：目标站在可走的地面上就直奔过去；目标在屋顶 / 墙头 / 箱顶（不在导航网格上）时，
  // 最近的可走格可能在墙的另一侧 —— 改成找一个看得见它的落脚点，免得顶着墙走
  chaseGoal(tg) {
    const nav = this.nav, x = tg.pos.x, z = tg.pos.z;
    if (nav.walkable(x, z) && Math.abs(tg.pos.y - nav.height(x, z)) < 1.6) return this.setGoal(x, z);
    tg.aimPoint(_p); let best = null, bd = 1e9;
    for (let k = 0; k < 8; k++) {
      const q = nav.randomNear(x, z, 10); if (!q) continue;
      _a.set(q.x, nav.height(q.x, q.z) + 1.5, q.z); if (this.world.blocked(_a, _p)) continue;
      const d = Math.hypot(q.x - this.body.pos.x, q.z - this.body.pos.z); if (d < bd) { bd = d; best = q; }
    }
    if (best) return this.setGoal(best.x, best.z);
    const q = nav.randomNear(x, z, 12); if (q) return this.setGoal(q.x, q.z);
    this.pickRoam(); return false;
  }
  repath() {
    const b = this.body, nav = this.nav; let sx = b.pos.x, sz = b.pos.z, pre = null;
    if (!nav.walkable(sx, sz)) {   // 脚下不是可走格（贴着墙、柱子旁…）：从“看得见”的最近可走格出发，免得选到墙另一侧的格子
      let bd = 1e9; _a.set(sx, b.pos.y + 0.9, sz);
      for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
        const x = Math.floor(sx) + dx + 0.5, z = Math.floor(sz) + dz + 0.5; if (!nav.walkable(x, z)) continue; const d = Math.hypot(x - sx, z - sz); if (d >= bd) continue;
        _b.set(x, nav.height(x, z) + 0.9, z); if (Math.abs(_b.y - _a.y) < 1.2 && this.world.blocked(_a, _b)) continue; bd = d; pre = { x, z };
      }
      if (pre) { sx = pre.x; sz = pre.z; }
    }
    const p = nav.findPath(sx, sz, this.goal.x, this.goal.z, false, 0.45); if (p && pre) p.unshift(pre);
    this.path = p; this.pathI = 0; this.repathT = rnd(0.9, 1.5); return !!p;
  }
  prefRange() { const k = this.tgt.kind; return k === 'mech' ? [30, 58] : k === 'sniper' ? [22, 80] : k === 'drone' ? [14, 60] : this.isPlayer ? (this.nearVis <= 1 && this.body.hp > 70 ? [5, 14] : [11, 24]) : [9, 22]; }
  // 交战：绕着目标打（保持武器的合适距离，横向大步移动，才有滑铲 / 蹬墙的空间）
  pickOrbit() {
    const b = this.body, tg = this.tgt; const dx = b.pos.x - tg.pos.x, dz = b.pos.z - tg.pos.z; const d = Math.hypot(dx, dz) || 1; const R = this.prefRange();
    let r = clamp(d, R[0], R[1]); if (Math.random() < 0.3) this.orbitSide = -this.orbitSide;
    for (let k = 0; k < 4; k++) {
      const a = Math.atan2(dz, dx) + this.orbitSide * clamp(rnd(8, 14) / r, 0.2, 1.3); const x = tg.pos.x + Math.cos(a) * r, z = tg.pos.z + Math.sin(a) * r;
      const q = this.nav.randomNear(x, z, 3); if (q && Math.hypot(q.x - b.pos.x, q.z - b.pos.z) > 3 && this.setGoal(q.x, q.z)) { this.goalT = rnd(1.4, 2.6); return; }
      this.orbitSide = -this.orbitSide; r = Math.max(R[0], r * 0.8);
    }
    this.setGoal(tg.pos.x, tg.pos.z); this.goalT = 1.2;
  }
  // 残血：找一个打我的人看不到的落脚点
  pickCover() {
    const b = this.body; const thr = b.lastDamageFrom && b.lastDamageFrom.alive !== false && b.lastDamageFrom.aimPoint ? b.lastDamageFrom : this.tgt; this.goalT = rnd(1.2, 1.8);
    if (!thr) { this.pickRoam(); return; }
    thr.aimPoint(_p); let best = null, bd = 1e9;
    for (let k = 0; k < 12; k++) {
      const q = this.nav.randomNear(b.pos.x, b.pos.z, 15); if (!q) continue; const d0 = Math.hypot(q.x - b.pos.x, q.z - b.pos.z); if (d0 < 3.5) continue;
      _q.set(q.x, this.nav.height(q.x, q.z) + 1.2, q.z); if (!this.world.blocked(_q, _p)) continue;
      const d = d0 + Math.max(0, 14 - _q.distanceTo(_p)) * 2; if (d < bd) { bd = d; best = q; }
    }
    if (best) this.setGoal(best.x, best.z);
    else { const dx = b.pos.x - _p.x, dz = b.pos.z - _p.z, d = Math.hypot(dx, dz) || 1; const q = this.nav.randomNear(b.pos.x + dx / d * 12, b.pos.z + dz / d * 12, 5); if (q) this.setGoal(q.x, q.z); }
  }
  // 没有目标：朝最近的敌人推进；场上没人就去交战点（偏向对方半场）
  pickRoam() {
    const b = this.body, g = this.game; let best = null, bd = 1e9; this.goalT = rnd(3, 5);
    for (const c of g.enemiesOf(b.team)) { if (c.alive === false || c.kind === 'drone' || c.static) continue; const d = Math.hypot(c.pos.x - b.pos.x, c.pos.z - b.pos.z) * (c.kind === 'mech' ? 1.6 : 1); if (d < bd) { bd = d; best = c; } }
    if (best && bd < 120) { const q = this.nav.randomNear(best.pos.x, best.pos.z, 5); if (q && this.setGoal(q.x, q.z)) return; }
    const pts = g.combatPoints || [[0, 0]], bias = b.team === 0 ? -1 : 1; let bp = pts[0], bs = -1e9;
    for (let i = 0; i < 5; i++) { const p = pts[(Math.random() * pts.length) | 0]; const s = p[1] * bias * 0.02 + Math.random() - Math.hypot(p[0] - b.pos.x, p[1] - b.pos.z) * 0.004; if (s > bs) { bs = s; bp = p; } }
    const q = this.nav.randomNear(bp[0], bp[1], 7); if (q) this.setGoal(q.x, q.z);
  }

  // 沿路线前方弧长 L 处的点
  routePoint(L, out) {
    const b = this.body, path = this.path; if (!path) return null; let x = b.pos.x, z = b.pos.z, left = L;
    for (let i = this.pathI; i < path.length; i++) { const dx = path[i].x - x, dz = path[i].z - z; const d = Math.hypot(dx, dz); if (d >= left) return out.set(x + dx / d * left, 0, z + dz / d * left); left -= d; x = path[i].x; z = path[i].z; }
    return out.set(x, 0, z);
  }
  // 找落差：周围 12 个方向里，胸口高度没被墙挡、往外 2~10 m 处地面明显更低且下面是可走地面的方向（优先顺着路线、离得近）
  findDrop(dir) {
    const b = this.body, w = this.world, pos = b.pos, nav = this.nav; let best = null, bs = -1e9;
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * 6.2832, dx = Math.sin(a), dz = Math.cos(a);
      for (const r of [2.2, 3.6, 6, 9.5]) {
        _a.set(pos.x, pos.y + 1.1, pos.z); _b.set(dx, 0, dz); if (w.raycast(_a, _b, r + 0.3)) break;
        _a.set(pos.x + dx * r, pos.y + 1.1, pos.z + dz * r); const h = w.raycast(_a, DOWN, 14); const fy = h ? h.point.y : pos.y - 14;
        if (pos.y - fy < 1.2) continue;
        if (!nav.walkable(pos.x + dx * r, pos.z + dz * r) && !nav.walkable(pos.x + dx * (r + 1.5), pos.z + dz * (r + 1.5))) continue;
        const sc = dx * dir.x + dz * dir.z - r * 0.12; if (sc > bs) { bs = sc; best = [dx, dz, r]; } break;
      }
    }
    return best;
  }
  // 前方净空（膝高 + 胸高两条射线）
  clearAhead(dir, max) {
    const b = this.body, w = this.world; let m = max;
    _a.set(b.pos.x, b.pos.y + 0.45, b.pos.z); let h = w.raycast(_a, dir, max); if (h) m = Math.min(m, h.distance);
    _a.y = b.pos.y + 1.3; h = w.raycast(_a, dir, max); if (h) m = Math.min(m, h.distance);
    return m;
  }
  // 前方障碍：返回 { d 距离, h 顶面相对脚底的高度（探不到顶 / 是高墙 = 99）}，没有则 null
  probe(dir, len) {
    const b = this.body, w = this.world; _a.set(b.pos.x, b.pos.y + 0.22, b.pos.z);   // 贴地一条：长凳、路缘这类矮东西也要探到
    let h = w.raycast(_a, dir, len); let d = h && Math.abs(h.normal.y) < 0.5 ? h.distance : -1;
    if (d < 0) { _a.y = b.pos.y + 1.2; h = w.raycast(_a, dir, len); d = h && Math.abs(h.normal.y) < 0.5 ? h.distance : -1; if (d < 0) return null; }
    _a.set(b.pos.x + dir.x * (d + 0.35), b.pos.y + 4.4, b.pos.z + dir.z * (d + 0.35));
    const t = w.raycast(_a, DOWN, 4.7); let top = t && t.normal.y > 0.6 ? t.point.y - b.pos.y : 99; if (top < 0.12) top = 99;   // 起点落在实心墙体里时会打到地面：按高墙算
    if (top < 0.33) return null;   // 一脚就能迈上去的小台阶不算障碍
    return { d, h: top };
  }
  angErr(P) { const b = this.body; b.getEye(_eye); _c.subVectors(P, _eye).normalize(); return Math.acos(clamp(_c.dot(b.look), -1, 1)); }
  faceMove(dir, t = 0.45) { if (this.tgt && this.tgtVis && this.still < 1) return; this.lookO = { yaw: yawOf(dir.x, dir.z), pitch: 0.05, t, w: 14 }; }

  // ---------- 行进与机动 ----------
  locomote(dt) {
    const b = this.body, vin = this.vin, w = this.world, v = b.vel, pos = b.pos, nav = this.nav, g = b.grapple;
    const sp = Math.hypot(v.x, v.z); const dir = this.mv;
    this.jumpCD -= dt; this.wallCD -= dt; this.grapCD -= dt; this.wallScanT -= dt; this.grapScanT -= dt; this.clrT -= dt; this.aimHold -= dt;
    // —— 路线方向 ——
    let has = false, seg = 0, remain = 0; const path = this.path;
    if (path && path.length) {
      const arrive = 1.3 + sp * 0.07;
      // 路点算“到了”：进入到达半径，且下一个路点从这里直线走得过去（否则在门口提前拐弯会撞墙），或者已经贴到路点上
      while (this.pathI < path.length - 1) {
        const d = Math.hypot(path[this.pathI].x - pos.x, path[this.pathI].z - pos.z); if (d >= arrive) break;
        if (d > 0.6 && !nav.lineClearFat(pos.x, pos.z, path[this.pathI + 1].x, path[this.pathI + 1].z, 0.4)) break;
        this.pathI++;
      }
      if (b.onGround && this.pathI < path.length - 1 && (this.game.frame + (this.ph | 0)) % 10 === 0 && nav.lineClearFat(pos.x, pos.z, path[this.pathI + 1].x, path[this.pathI + 1].z, 0.45)) this.pathI++;   // 抄近：下一个路点直线可达
      const wp = path[this.pathI]; const dx = wp.x - pos.x, dz = wp.z - pos.z; seg = Math.hypot(dx, dz);
      this.routeY = nav.height(wp.x, wp.z);
      if (this.pathI >= path.length - 1 && seg < 0.9) this.path = null;
      else {
        dir.set(dx / seg, 0, dz / seg); has = true; remain = seg; let straight = true;
        for (let i = this.pathI; i < path.length - 1; i++) { const ax = path[i + 1].x - path[i].x, az = path[i + 1].z - path[i].z; const l = Math.hypot(ax, az); remain += l; if (straight && l > 1e-3 && (ax * dir.x + az * dir.z) / l > 0.94) seg += l; else straight = false; }
      }
    } else if (this.goal) {   // 不在导航网格附近（屋顶深处等）：直线朝目标走，自然会跳下去
      const dx = this.goal.x - pos.x, dz = this.goal.z - pos.z; const d = Math.hypot(dx, dz); if (d > 1.5) { dir.set(dx / d, 0, dz / d); has = true; seg = remain = d; }
      // 直线方向被翻不过去的高墙挡住：有落差就从边上跳下去，没有就放弃这个目的地重新规划
      if (has && b.onGround && !(this.escT > 0)) {
        const lim = Math.min(d, 2.5); const c = this.clearAhead(dir, lim);
        if (c < lim - 0.2) { const ob = this.probe(dir, 2.6); if (!ob || ob.h > 3.4) { const e = this.findDrop(dir); if (e) { this.escX = e[0]; this.escZ = e[1]; this.escT = 0.7 + e[2] * 0.14; this.hop = true; } else { has = false; this.goal = null; this.goalT = 0; } } }
      }
    }
    this.seg = seg; this.remain = remain;
    if (this.aimHold > 0 && b.onGround && !b.sliding) has = false;   // 轨道枪蓄力：站定开镜

    // —— 防卡死：每 0.35 秒量一次位移 ——
    this.stuckT += dt;
    if (this.stuckT >= 0.35) {
      const moved = pos.distanceTo(this.stuckP); this.stuckP.copy(pos); this.stuckT = 0;
      const H = this.hist || (this.hist = []); H.push(pos.x, pos.y, pos.z); if (H.length > 15) H.splice(0, 3);
      const net = H.length >= 15 ? Math.hypot(pos.x - H[0], pos.y - H[1], pos.z - H[2]) : 9;   // 1.4 秒前到现在的净位移：来回蹭也算卡住
      // 赶路时 1.4 秒净位移不到 2.2 m 也算卡住（贴墙慢慢蹭的情况）；交战中绕圈走位则放宽
      if (has && (moved < 0.4 || net < (this.mode === 'fight' || this.mode === 'cover' ? 1.0 : 2.2)) && !b.mantle.on) { if (moved >= 0.4 && this.stuckLv < 3) { this.stuckLv = 3; H.length = 0; } this.stuckLv++; this.still = this.stuckLv * 0.35; if (this.still > this.stat.stuckMax) this.stat.stuckMax = +this.still.toFixed(2); if (this.stuckLv === 3) this.stat.stuckEvents++; }
      else { this.still = 0; this.stuckLv = 0; }
      if (!has) H.length = 0;
      // 逐级脱困（每 0.35 秒升一级）：后退 → 起跳攀爬 → 换落脚点并下蹲 → 后退加下蹲 …… 循环
      const lv = this.stuckLv;
      // 多层地图：路线是按地面算的，人却站在它上方的顶棚 / 屋顶 / 盖板上被墙挡住 —— 找最近的落差跳下去
      if (lv >= 2 && lv % 3 === 2 && has && path && b.onGround && pos.y - this.routeY > 1.5) { const e = this.findDrop(dir); if (e) { this.escX = e[0]; this.escZ = e[1]; this.escT = 0.7 + e[2] * 0.14; this.hop = true; this.wall = null; this.stat.drops = (this.stat.drops || 0) + 1; } }
      if (lv >= 2) { this.bumpSide = -this.bumpSide; const k = lv % 4; if (k === 2) this.backT = 0.45; else if (k === 3) this.hop = true; else if (k === 1) { this.backT = 0.3; this.duckT = 0.35; } }
      if (lv >= 4 && lv % 4 === 0) {   // 换个落脚点重新寻路
        this.wall = null; this.grap = null; if (g.state) vin.tap('KeyQ'); this.duckT = 0.4;
        const q = nav.randomNear(pos.x, pos.z, 9); if (q) { this.setGoal(q.x, q.z); this.goalT = 2.2; this.detourT = 2.0; }
        if (lv >= (this.isPlayer ? 24 : 12)) { const i = nav.nearestIn(pos.x, pos.z, nav.ok, 12); if (i >= 0) { pos.set(nav.cx(i), nav.hgt[i] + 0.05, nav.cz(i)); v.set(0, 0, 0); if (this.isPlayer) this.game.fade = 1; this.stat.rescues = (this.stat.rescues || 0) + 1; } this.still = 0; this.stuckLv = 0; }   // 兜底：挪回最近的可走格（NPC 4 秒；自动对战的玩家 8 秒，带一次黑场过渡）
      }
    }
    this.escT -= dt; const esc = this.escT > 0; if (esc) { dir.set(this.escX, 0, this.escZ); has = true; }
    // 长时间兜底：每 2 秒记一次位置，10 秒（交战 / 找掩体时 20 秒）都没离开过 3.5 m 的范围，说明被困住了
    // （小范围来回蹭骗过了上面的短时检测）—— 挪回最近的可走格；玩家本体带一次黑场过渡
    this.ltT = (this.ltT || 0) + dt;
    if (this.ltT >= 2) {
      this.ltT = 0; const L = this.lt || (this.lt = []); L.push(pos.x, pos.y, pos.z, has ? 1 : 0);
      const need = (this.mode === 'fight' || this.mode === 'cover' ? 10 : 5) * 4; if (L.length > 40) L.splice(0, L.length - 40);
      if (L.length >= need) {
        let far = 0, act = 0; for (let i = L.length - need; i < L.length; i += 4) { far = Math.max(far, Math.hypot(pos.x - L[i], pos.y - L[i + 1], pos.z - L[i + 2])); act += L[i + 3]; }
        if (far < 3.5 && act >= need / 4 - 1 && !b.mantle.on && !b.zip.on) {
          const i = nav.nearestIn(pos.x, pos.z, nav.ok, 12);
          if (i >= 0) { pos.set(nav.cx(i), nav.hgt[i] + 0.05, nav.cz(i)); v.set(0, 0, 0); if (this.isPlayer) this.game.fade = 1; this.stat.rescues = (this.stat.rescues || 0) + 1; this.goal = null; this.goalT = 0; this.path = null; }
          L.length = 0;
        }
      }
    }
    // 贴着障碍走不动：顺着障碍面滑过去（路点在墙角后面时常见）
    if (has && !esc && !b.wr.on && !this.wall && g.state !== 2) {
      _a.set(pos.x, pos.y + 0.6, pos.z); const h = w.raycast(_a, dir, 0.95);
      // 翻得过去的障碍（矮墙、女儿墙、箱子、集装箱）不绕：保持正对，交给下面的越障逻辑起跳 / 攀爬。
      // 多层地图上尤其要紧 —— 站在顶棚或屋顶上时路线是按地面算的，贴着女儿墙滑只会一直蹭墙
      const ob = h && Math.abs(h.normal.y) < 0.5 && b.onGround ? this.probe(dir, 1.3) : null;
      if (ob && ob.h <= 3.4) { /* 不改方向 */ }
      else if (h && Math.abs(h.normal.y) < 0.5 && seg > h.distance + 0.4) {
        const nx = h.normal.x, nz = h.normal.z, dn = dir.x * nx + dir.z * nz; let tx = dir.x - nx * dn, tz = dir.z - nz * dn; const tl = Math.hypot(tx, tz);
        if (tl < 0.35) { tx = -nz * this.bumpSide; tz = nx * this.bumpSide; } else { tx /= tl; tz /= tl; }   // 正对着撞上：选一侧绕
        dir.set(tx + nx * 0.15, 0, tz + nz * 0.15).normalize();
      }
    }
    if (!has && !(this.aimHold > 0)) { this.idleT += dt; if (this.idleT > 0.3) { this.goalT = 0; this.goal = null; this.idleT = 0; } } else this.idleT = 0;   // 不站着发呆
    // 触须：身体左右两侧各向前探一条射线，只有一侧被挡（蹭到墙角 / 箱角）就往另一侧让
    if (has && !esc && !b.wr.on && !this.wall && g.state !== 2) {
      const lx = dir.z * 0.34, lz = -dir.x * 0.34; _a.set(pos.x + lx, pos.y + 0.6, pos.z + lz); const L = !!w.raycast(_a, dir, 1.15); _a.set(pos.x - lx, pos.y + 0.6, pos.z - lz); const R = !!w.raycast(_a, dir, 1.15);
      if (L !== R) { const k = L ? -1.9 : 1.9; dir.set(dir.x + lx * k, 0, dir.z + lz * k).normalize(); }
    }
    this.backT -= dt; this.duckT -= dt; if (this.backT > 0 && has) dir.negate();
    let jump = false, crouch = false;
    if (this.hop && has) { this.hop = false; jump = true; this.jumpCD = 0.3; this.faceMove(dir, 0.6); }   // 起跳 / 二段跳 / 攀爬试试

    // —— 钩索：转头对准 → 发射 → 牵引 → 脱钩 ——
    if (this.grap) {
      const G = this.grap; G.t += dt;
      if (G.state === 1) {
        this.lookO = { point: G.point, t: 0.2, w: 13, ff: 1 };
        if (this.angErr(G.point) < 0.05 && g.state === 0 && g.charges >= 1 && !b.mantle.on) { vin.tap('KeyQ'); G.state = 2; G.t = 0; G.d0 = pos.distanceTo(G.point); }
        else if (G.t > 0.9) { this.grap = null; this.grapCD = 1.5; }
      } else if (g.state === 0 && G.t > 0.12) { this.grap = null; this.grapCD = rnd(3, 5.5); this.relT = 0; }
      else if (g.state === 2) {
        const d = pos.distanceTo(g.point), v3 = v.length(); if (!(this.tgt && this.tgtVis) || G.roof) this.lookO = { point: G.point, t: 0.25, w: 8 };   // 牵引中有敌人就照打
        if (d < (G.roof ? 4.6 : Math.max(5.5, G.d0 * 0.42)) || (g.t > 0.4 && v3 > 19 && !G.roof) || g.t > 1.6) {
          this.relT -= dt;
          if (this.relT <= 0) { if (v.y > 6 && !G.roof) vin.tap('KeyQ'); else { vin.tap('Space'); this.jumpCD = 0.25; } this.relT = 0.1; }   // 跳跃脱钩带一个上抛；已经在快速上升就直接松
          if (G.roof) { _a.set(G.point.x - pos.x, 0, G.point.z - pos.z).normalize(); this.lookO = { yaw: yawOf(_a.x, _a.z), pitch: 0.1, t: 0.9, w: 12 }; }   // 面朝屋檐，才能攀上去
        }
      }
    }

    // —— 蹬墙：靠过去 → 起跳 → 贴上 → 尽头蹬出 ——
    if (b.wr.on) {
      const wr = b.wr; if (!this.wall) this.wall = { n: wr.normal.clone(), tan: wr.tangent.clone(), t: 0, on: true, max: rnd(1.4, 2.05) }; const W = this.wall; W.on = true;
      dir.copy(wr.tangent); has = true;
      // 墙到头 / 前方被挡 / 跑够了 / 路线要离开这面墙 → 蹬墙跳
      _a.set(pos.x + wr.tangent.x * 1.7, pos.y + 1.0, pos.z + wr.tangent.z * 1.7); _b.copy(wr.normal).negate(); const ends = !w.raycast(_a, _b, 1.6);
      _a.set(pos.x, pos.y + 0.9, pos.z); const blocked = !!w.raycast(_a, wr.tangent, 2.6);
      let away = false; if (this.path && this.routePoint(7, _q)) { _q.x -= pos.x; _q.z -= pos.z; const l = Math.hypot(_q.x, _q.z) || 1; away = (wr.time > 0.9 && (_q.x * wr.normal.x + _q.z * wr.normal.z) / l > 0.72) || (wr.time > 0.5 && (_q.x * wr.tangent.x + _q.z * wr.tangent.z) / l < -0.4); }
      if ((ends || blocked || away || wr.time > W.max) && wr.time > 0.22) { jump = true; this.styleDJ = Math.random() < 0.55; const S = this.stat; S.wrEnd = S.wrEnd || { ends: 0, blocked: 0, away: 0, max: 0 }; S.wrEnd[ends ? 'ends' : blocked ? 'blocked' : away ? 'away' : 'max']++; }
    } else if (this.wall) {
      const W = this.wall; W.t += dt;
      if (W.on) { this.wall = null; this.wallCD = 0.25; }
      else {
        _a.set(pos.x, pos.y + 1.0, pos.z); _b.copy(W.n).negate(); const h = w.raycast(_a, _b, 9);
        if (!h || h.normal.x * W.n.x + h.normal.z * W.n.z < 0.8 || W.t > 2.6 || g.state === 2) { this.wall = null; this.wallCD = 1.1; }
        else {
          const dW = h.distance; const k = dW > 3.5 ? 1.0 : dW > 1.7 ? 0.75 : 0.5; dir.set(W.tan.x - W.n.x * k, 0, W.tan.z - W.n.z * k).normalize(); has = true;
          if (sp < 2.5 && b.onGround) { W.slow = (W.slow || 0) + dt; if (W.slow > 0.35) { this.wall = null; this.wallCD = 2; } }
          if (b.onGround && dW < 1.5 && sp > 4.2 && this.jumpCD <= 0) { jump = true; this.jumpCD = 0.35; }
        }
      }
    } else if (has && this.wallCD <= 0 && this.wallScanT <= 0 && sp > 5.0 && seg > 5 && !this.grap && g.state === 0 && !b.mantle.on && !b.zip.on) { this.wallScanT = 0.12; this.scanWall(dir); }

    // —— 钩索机会：路还长，前上方有可钩的墙沿 / 屋檐 ——
    if (has && !this.grap && !this.wall && g.state === 0 && g.charges >= 1 && this.grapCD <= 0 && this.grapScanT <= 0 && !b.mantle.on && !b.zip.on && !b.crouching && (remain > 20 || this.still >= 2.4) && !(this.tgt && this.tgtVis && this.tdist < 18)) { this.grapScanT = 0.4; this.scanGrapple(dir); }

    // —— 滑铲 / 滑铲跳 / 越障 / 二段跳 ——
    if (has && this.clrT <= 0) { this.clr = this.clearAhead(dir, 13); this.clrT = 0.08; }
    const run = has ? Math.min(seg, this.clr) : 0; this.run = run; const fight = this.mode === 'fight' || this.mode === 'cover';
    const steady = b.adsT < 0.3;
    if (b.mantle.on || b.zip.on || g.state === 2) { this.slideHold = 0; }
    else if (b.onGround) {
      if (this.slideHold > 0) {
        this.slideHold -= dt; crouch = true;
        if (this.slideHold <= 0 || sp < 5.6 || run < 2.5) { crouch = false; this.slideHold = 0; if (run > 4.5 && this.jumpCD <= 0 && !this.wall) { jump = true; this.jumpCD = 0.3; this.styleDJ = run > 10 && Math.random() < 0.5; } }
      } else if (!this.wall && steady && !b.crouching && run > (fight ? 5.5 : 8.5) && sp > 7.2 && (b.slideBoostCD <= 0 || sp > 9.6 || (fight && this.tempo === 'build' && this.tempoT > 0.5))) { crouch = true; this.slideHold = b.slideBoostCD <= 0 ? rnd(0.42, 0.7) : rnd(0.22, 0.36); }
      else if (has && !jump && this.jumpCD <= 0) {
        const ob = this.probe(dir, clamp(sp * 0.45, 1.4, 4.2));
        if (ob && ((ob.h <= 1.05 && ob.d < 0.8 + sp * 0.2) || (ob.h <= 3.4 && ob.d < 1.5))) { jump = true; this.jumpCD = 0.3; this.climb = ob.h > 1.05; if (this.climb) this.faceMove(dir); }
      }
    } else if (!b.wr.on) {
      if (b.jumpsLeft > 0 && b.airTime > 0.2 && this.jumpCD <= 0 && !jump) {
        const ob = this.probe(dir, clamp(sp * 0.35, 1.3, 3.5));
        if (ob && ob.h > 0.5 && ob.h <= 3.7 && v.y < 2.5) { jump = true; this.jumpCD = 0.3; this.faceMove(dir, 0.6); }
        else if (this.styleDJ && v.y < 0.8 && run > 5) { jump = true; this.jumpCD = 0.3; }
        else if (this.game.time - b.lastHurtT < 0.35 && v.y < 2) { jump = true; this.jumpCD = 0.5; }
        if (jump) this.styleDJ = false;
      } else if (b.jumpsLeft === 0 && b.airTime > 0.25 && has && (this.game.frame & 3) === 0) { const ob = this.probe(dir, 1.4); if (ob && ob.h <= 2.6) this.faceMove(dir, 0.4); }
      // 落地前按住下蹲：落地即滑铲，速度不掉
      if (!this.wall && steady && sp > 8.4 && run > 6 && v.y < -1.5) { _a.set(pos.x, pos.y + 0.3, pos.z); if (w.raycast(_a, DOWN, 1.5)) { crouch = true; this.slideHold = rnd(0.22, 0.36); } }
    }
    if (this.duckT > 0) crouch = true;
    if (jump) vin.tap('Space');
    vin.set('KeyC', crouch);
    // 滑索：顺路就搭
    if (b.zip.near && !b.zip.on && this.goal && remain > 25) {
      const l = b.zip.near; const da = Math.hypot(l.a[0] - this.goal.x, l.a[2] - this.goal.z), db = Math.hypot(l.b[0] - this.goal.x, l.b[2] - this.goal.z), d0 = Math.hypot(pos.x - this.goal.x, pos.z - this.goal.z);
      const e = da < db ? l.a : l.b; if (Math.min(da, db) < d0 - 14) { _p.set(e[0], e[1], e[2]); this.lookO = { point: _p.clone(), t: 0.5, w: 12 }; if (this.angErr(_p) < 0.5) vin.tap('KeyE'); }
    }
    this.moving = has;
  }

  // 侧面有没有可以蹬的墙：与行进方向平行、够高、往前够长、贴墙的跑道没被挡
  scanWall(dir) {
    const b = this.body, w = this.world, pos = b.pos; const S = this.stat.scan || (this.stat.scan = { n: 0, none: 0, skew: 0, low: 0, short: 0, lane: 0 }); S.n++;
    for (let k = 0; k < 2; k++) {
      const side = k === 0 ? this.wallPref : -this.wallPref;
      _b.set(-dir.z * side, 0, dir.x * side); _a.set(pos.x, pos.y + 1.2, pos.z);
      let h = w.raycast(_a, _b, 10.5); if (!h || Math.abs(h.normal.y) > 0.2) { S.none++; continue; }
      const n = _n.copy(h.normal); n.y = 0; n.normalize(); const dW = h.distance;
      const tan = _t.crossVectors(UP, n).normalize(); let al = tan.x * dir.x + tan.z * dir.z; if (al < 0) { tan.negate(); al = -al; } if (al < 0.74) { S.skew++; continue; }
      _a.y = pos.y + 2.7; if (!w.raycast(_a, _b, dW + 0.8)) { S.low++; continue; }
      let ok = true; _c.copy(n).negate();
      for (const a of [3, 6]) { _a.set(pos.x + tan.x * a, pos.y + 1.4, pos.z + tan.z * a); h = w.raycast(_a, _c, dW + 0.9); if (!h || h.normal.x * n.x + h.normal.z * n.z < 0.8) { ok = false; break; } }
      if (!ok) { S.short++; continue; }
      _a.set(pos.x - n.x * (dW - 0.7), pos.y + 1.3, pos.z - n.z * (dW - 0.7)); if (w.raycast(_a, tan, 6.5)) { S.lane++; continue; }
      this.wall = { n: n.clone(), tan: tan.clone(), t: 0, on: false, max: rnd(1.4, 2.05) }; this.wallPref = side; this.stat.wallPlans++; return true;
    }
    return false;
  }

  // 前上方的钩点：朝路线方位扇形打射线，取距离、抬升合适的；上方一格打空 = 屋檐（钩上去翻上房顶）
  scanGrapple(dir) {
    const b = this.body, w = this.world; b.getEye(_eye);
    const P = this.routePoint(24, _q); const by = P && Math.hypot(P.x - b.pos.x, P.z - b.pos.z) > 6 ? yawOf(P.x - b.pos.x, P.z - b.pos.z) : yawOf(dir.x, dir.z);
    let bs = -1e9, found = false, roof = false; const bp = _p;
    for (const dy of GY) for (const pt of GP) {
      const yaw = by + dy, cp = Math.cos(pt); _b.set(-Math.sin(yaw) * cp, Math.sin(pt), -Math.cos(yaw) * cp);
      const h = w.raycast(_eye, _b, 34); if (!h) continue; const d = h.distance; if (d < 13 || d > 33 || h.normal.y > 0.5 || h.normal.y < -0.5) continue;
      const rise = h.point.y - b.pos.y; if (rise < 2.5 || rise > 19) continue;
      const s = -Math.abs(d - 23) * 0.25 - Math.abs(dy) * 8 + Math.min(rise, 9) * 0.4 + Math.random() * 2;
      if (s > bs) { bs = s; bp.copy(h.point); found = true; }
    }
    if (!found) return false;
    // 屋檐判断：钩点上方 1.3 m 再打一条，打空或远得多 → 墙到顶了
    _c.set(bp.x - _eye.x, bp.y + 1.3 - _eye.y, bp.z - _eye.z); const dd = _c.length(); _c.multiplyScalar(1 / dd); const h2 = w.raycast(_eye, _c, dd + 4); roof = !h2 || h2.distance > dd + 2.5;
    this.grap = { state: 1, t: 0, point: bp.clone(), roof, d0: 0 }; this.stat.grapPlans++; return true;
  }

  // ---------- 战斗 ----------
  combat(dt) {
    const b = this.body, vin = this.vin, tg = this.tgt, g = this.game; this.swCD -= dt; this.nadeCD -= dt; this.meleeCD -= dt; this.mechCD -= dt;
    b.getEye(_eye); let dist = 0, err = 9; const vis = !!tg && this.tgtVis;
    if (tg) { tg.aimPoint(this.aimPt); dist = this.aimPt.distanceTo(_eye); if (dist < 22 && tg.kind !== 'mech' && tg.kind !== 'drone') this.aimPt.y += tg.kind === 'pilot' ? 0.4 : 0.3; err = this.angErr(this.aimPt); }   // 近处瞄头
    this.out.tgt = tg; this.out.dist = dist;
    if (!this.isPlayer) { this.out.fire = vis && this.t > this.reactT && err < 0.22; return; }
    const W = g.weapons, cur = W.cur, ammo = W.ammo; const busy = W.switchT >= 0 || W.reloadT >= 0 || W.meleeT >= 0;
    // 机甲：敌方机甲在场（或对局后半段）且已充满就呼叫，落地后靠近登机
    let emech = false; for (const m of g.mechs) if (m.alive && m.team !== b.team) emech = true;
    if (g.mechCharge >= 1 && !g.playerMech && !(this.mechRides >= 1) && this.mechCD <= 0 && b.onGround && (emech || g.matchT > 240) && (!vis || dist > 14)) { this.mechCD = 3; this.lookO = { yaw: b.yaw, pitch: -0.25, t: 0.5, w: 8 }; this.callT = this.t + 0.35; }
    if (this.callT && this.t >= this.callT) { this.callT = 0; if (g.mechCharge >= 1 && !g.playerMech) vin.tap('KeyV'); }
    if (this.isPlayer && g.interactPrompt === '按 E 登机' && g.playerMech !== this.mechDone) vin.tap('KeyE');
    vin.set('KeyE', false);
    // 选枪：机甲 / 远处 / 狙击手 → 轨道枪；贴脸 → 霰弹；其余步枪。没弹时近处换枪比换弹快
    let want = cur;
    if (vis) {
      const big = tg.kind === 'mech', far = tg.kind === 'sniper' || (tg.kind === 'drone' && dist > 34);
      want = big || far ? 'rail' : dist < (cur === 'shotgun' ? 11.5 : 8.5) && tg.kind !== 'drone' ? 'shotgun' : 'rifle';
      if (ammo[want] <= 0) { const alt = want === 'rifle' ? (dist < 13 ? 'shotgun' : 'rail') : 'rifle'; if (ammo[alt] > 0 && (dist < 30 || want !== 'rifle')) want = alt; }
    } else if (this.t - this.tgtSeenT > 2.5 && ammo.rifle > 0) want = 'rifle';
    if (want !== cur && this.swCD <= 0 && W.switchT < 0 && !W.charging) { vin.tap('Digit' + (ORDER.indexOf(want) + 1)); this.swCD = 1.1; }
    if (W.reloadT < 0 && W.switchT < 0 && want === cur && (ammo[cur] <= 0 || (!vis && ammo[cur] < W.def.mag * 0.5 && this.t - this.tgtSeenT > 1))) vin.tap('KeyR');
    // 近战处决
    if (vis && (dist < 4.2 && err < 0.3 || dist < 2.8 && err < 0.9) && this.meleeCD <= 0 && W.meleeCD <= 0 && W.meleeT < 0 && tg.kind !== 'mech' && tg.kind !== 'drone' && !g.interactPrompt && (tg.hp || 0) <= 110 && b.onGround) { vin.tap('KeyF'); this.meleeCD = 1.2; this.stat.melees++; }
    // 手雷：扎堆的敌人或机甲
    let fire = false, ads = false;
    if (this.nade) {
      const N = this.nade; N.t += dt; this.lookO = { yaw: N.yaw, pitch: N.pitch, t: 0.2, w: 14 };
      if ((Math.abs(angDiff(N.yaw, b.yaw)) < 0.05 && Math.abs(N.pitch - b.pitch) < 0.05) || N.t > 0.5) { vin.tap('KeyG'); this.nade = null; this.stat.nades++; }
    } else if (vis && this.nadeCD <= 0 && W.grenades >= 1 && dist > 9 && dist < 30 && !busy && !this.grap) {
      let n = 0; if (tg.kind === 'mech') n = 2; else for (const c of g.enemiesOf(b.team)) if (c.alive !== false && c.kind !== 'drone' && Math.hypot(c.pos.x - tg.pos.x, c.pos.z - tg.pos.z) < 5.5 && Math.abs(c.pos.y - tg.pos.y) < 3) n++;
      if (n >= 2) { const th = this.lobPitch(tg.pos, dist); if (th !== null) { this.nade = { yaw: yawOf(tg.pos.x - b.pos.x, tg.pos.z - b.pos.z), pitch: th, t: 0 }; this.nadeCD = rnd(9, 14); } else this.nadeCD = 2; }
    }
    // 开火
    if (vis && this.t > this.reactT && !busy && !this.nade) {
      const rad = tg.kind === 'mech' ? 1.5 : tg.kind === 'drone' ? 0.42 : 0.28; const tol = Math.max(0.008, Math.atan(rad / Math.max(1, dist)));
      const sp = Math.hypot(b.vel.x, b.vel.z);
      if (cur === 'rail') {
        fire = ammo.rail > 0 && err < tol * (W.charging ? 2.4 : 1.5) + 0.004; ads = dist > 20 && b.onGround && !b.sliding;
        if (ammo.rail > 0 && want === 'rail' && tg.kind !== 'mech' && tg.kind !== 'pilot' && this.mode !== 'cover' && this.t > this.holdLock) { this.aimHold = 0.15; this.holdSum += dt; if (this.holdSum > 1.2) { this.holdLock = this.t + 2.5; this.holdSum = 0; } }   // 站定最多 1.2 秒，之后先挪 2.5 秒位置
      }
      else if (cur === 'shotgun') { if (dist < 13.5 && err < Math.max(0.05, tol * 1.5) && W.cooldown <= 0 && ammo.shotgun > 0) vin.tap('Mouse0'); }
      else { fire = err < tol * 1.5 + 0.006 && !(dist > 30 && W.bloom > 0.013); ads = dist > 36 && b.onGround && !b.sliding && sp < 6.5; }
      if (ammo[cur] <= 0 && cur !== 'shotgun') fire = false;
    }
    if (!(this.aimHold > 0)) this.holdSum = Math.max(0, this.holdSum - dt * 0.8);
    vin.set('Mouse0', fire); vin.set('Mouse2', ads);
  }
  // 手雷抛射角：初速 19 m/s 沿视线 + 3.2 m/s 向上，重力 19
  lobPitch(tp, dist) {
    const b = this.body; const dH = Math.hypot(tp.x - b.pos.x, tp.z - b.pos.z); const y0 = b.pos.y + b.eye, yt = tp.y + 0.3; let best = null, be = 1.2;
    for (let th = -0.3; th <= 0.85; th += 0.04) { const vx = 19 * Math.cos(th); const t = dH / vx; if (t > 1.75) continue; const y = y0 + (19 * Math.sin(th) + 3.2) * t - 9.5 * t * t; const e = Math.abs(y - yt); if (e < be) { be = e; best = th; } }
    return best;
  }

  // 交战节奏：冲刺不能侧着跑 —— 目标在侧面时先朝行进方向蓄速（build），滑铲 / 腾空 / 蹬墙时再转头开火（strike）
  tempoStep(dt) {
    const b = this.body, tg = this.tgt; const sp = Math.hypot(b.vel.x, b.vel.z); this.tempoT += dt;
    if (!(tg && this.tgtVis) || !this.moving) { this.tempo = 'strike'; this.strikeT = 0; return true; }
    const momentum = !b.onGround || b.sliding || b.wr.on || b.grapple.state === 2;
    const P = this.aimPt, rel = Math.abs(angDiff(yawOf(P.x - b.pos.x, P.z - b.pos.z), yawOf(this.mv.x, this.mv.z)));
    if (this.tempo === 'build') { if (momentum || this.tempoT > 1.25 || rel < 0.7 || this.tdist < 8 || this.run < 3) { this.tempo = 'strike'; this.tempoT = 0; this.strikeT = 0; } }
    else {
      if (!momentum && sp < 7) this.strikeT += dt; else this.strikeT = 0;
      if (this.strikeT > 0.45 && rel > 0.85 && this.tdist > 9 && this.run > 6 && !(this.aimHold > 0)) { this.tempo = 'build'; this.tempoT = 0; }
    }
    return this.tempo === 'strike';
  }

  // ---------- 视角：临界阻尼弹簧追目标角，带目标角速度前馈，限角速度 / 角加速度 ----------
  aim(dt) {
    const b = this.body, vin = this.vin, tg = this.tgt; b.getEye(_eye); const strike = this.tempoStep(dt);
    let ty = b.yaw, tp = b.pitch * 0.5, w = 5.5, maxV = 4.2, ff = 0;
    const O = this.lookO;
    if (O && (O.t -= dt) > 0) {
      if (O.point) { const dx = O.point.x - _eye.x, dy = O.point.y - _eye.y, dz = O.point.z - _eye.z; ty = yawOf(dx, dz); tp = Math.atan2(dy, Math.hypot(dx, dz)); } else { ty = O.yaw; tp = O.pitch; }
      w = O.w || 12; maxV = 8; ff = O.ff || 0;
    } else {
      this.lookO = null;
      if (tg && strike && (this.tgtVis || this.t - this.tgtSeenT < 0.7)) {
        const P = this.tgtVis ? this.aimPt : this.lastSeen; const dx = P.x - _eye.x, dy = P.y - _eye.y, dz = P.z - _eye.z; const d = Math.hypot(dx, dz);
        const amp = 0.003 + (1 - this.skill) * 0.022 + Math.min(0.01, 0.06 / Math.max(d, 3)); const t = this.t + this.ph;
        ty = yawOf(dx, dz) + amp * (Math.sin(t * 2.3) + Math.sin(t * 3.7 + 1.3)) * 0.5; tp = Math.atan2(dy, d) + amp * 0.7 * (Math.sin(t * 1.9 + 0.7) + Math.sin(t * 3.1)) * 0.5;
        w = 8 + 5 * this.skill; maxV = 5.5 + 3 * this.skill; ff = 1;
      } else {
        // 行进视线：看路线前方约 9 米；在空中略向下看落点
        const sp = Math.hypot(b.vel.x, b.vel.z); const P = this.moving ? this.routePoint(9, _q) : null; let dx = 0, dz = 0, d = 0, ly = 0;
        if (b.wr.on) { dx = b.wr.tangent.x * 9 + b.wr.normal.x * 1.6; dz = b.wr.tangent.z * 9 + b.wr.normal.z * 1.6; d = 9; ly = b.pos.y + 1.4; }
        else if (P && (d = Math.hypot(dx = P.x - b.pos.x, dz = P.z - b.pos.z)) > 2.5) { ly = this.nav.height(P.x, P.z) + 1.4; }
        else if (this.moving) { dx = this.mv.x * 6; dz = this.mv.z * 6; d = 6; ly = b.pos.y + 1.4; }
        else if (sp > 2) { dx = b.vel.x; dz = b.vel.z; d = sp; ly = b.pos.y + 1.4; }
        if (d > 0.5) { ty = yawOf(dx, dz); tp = clamp(Math.atan2(ly - _eye.y, Math.max(d, 6)), -0.55, 0.3) * 0.8 - (b.onGround ? 0.02 : 0.07); }
        if (Math.abs(angDiff(ty, b.yaw)) > 1.3) w = 7.5;
      }
    }
    // 目标角速度（前馈）：目标角的差分做低通；目标突变的那一帧不计
    if (this.lty !== null) {
      const d1 = angDiff(ty, this.lty), d2 = tp - this.ltp; const k = 1 - Math.exp(-12 * dt);
      if (Math.abs(d1) < 0.18 && Math.abs(d2) < 0.18) { this.wy += (clamp(d1 / dt, -5, 5) - this.wy) * k; this.wp += (clamp(d2 / dt, -4, 4) - this.wp) * k; } else { this.wy *= 0.5; this.wp *= 0.5; }
    }
    this.lty = ty; this.ltp = tp;
    const maxA = 70 + 50 * this.skill, ex = Math.exp(-w * dt), fy = this.wy * ff, fp = this.wp * ff;
    let u = this.yv - fy, x = -angDiff(ty, b.yaw), tmp = (u + w * x) * dt; let vn = (u - w * tmp) * ex + fy;
    vn = clamp(clamp(vn, -maxV, maxV), this.yv - maxA * dt, this.yv + maxA * dt); this.yv = vn;   // 先限速再限加速度：限速值突变（目标消失）时也是平滑减速
    u = this.pv - fp; x = -(clamp(tp, -1.4, 1.4) - b.pitch); tmp = (u + w * x) * dt; let pn = (u - w * tmp) * ex + fp;
    pn = clamp(clamp(pn, -maxV * 0.7, maxV * 0.7), this.pv - maxA * dt, this.pv + maxA * dt); this.pv = pn;
    const dyaw = vn * dt, dpit = pn * dt;
    const zs = 1 / (1 + (b.adsZoom - 1) * b.adsT), k = 1 / (b.sens * zs);
    vin.dx = -dyaw * k; vin.dy = -dpit * k;
    // 移动轴：用转完之后的朝向把世界系方向换成前后 / 左右
    const a = vin.axis;
    if (this.moving) { const yaw = b.yaw + dyaw, sy = Math.sin(yaw), cy = Math.cos(yaw), m = this.mv; a.f = -m.x * sy - m.z * cy; a.s = m.x * cy - m.z * sy; if (b.wr.on && a.f < 0.05) a.f = 0.05; }
    else { a.f = 0; a.s = 0; }
  }

  // ---------- 驾驶机甲（仅玩家自动对战）：朝目标推进、主炮点射、火箭齐射、近身重拳、核心满了放熔毁光束 ----------
  mechPilot(dt) {
    const b = this.body, vin = this.vin, g = this.game, m = g.playerMech; this.moving = false; vin.set('KeyC', false); vin.set('Mouse2', false);
    if (!m) { vin.set('Mouse0', false); return; }
    // 选敌：以机甲驾驶舱为视点
    this.senseT -= dt;
    if (this.senseT <= 0) {
      this.senseT = 0.15; _eye.set(m.pos.x, m.pos.y + 4.6, m.pos.z); let best = null, bs = 1e9, bv = false;
      for (const c of g.enemiesOf(b.team)) { if (c.alive === false) continue; c.aimPoint(_p); const d = _p.distanceTo(_eye); if (d > 110) continue; let s = d * (c === this.tgt ? 0.7 : 1) * (c.kind === 'mech' ? 0.6 : 1); if (s >= bs) continue; const vis = !this.world.blocked(_eye, _p); if (!vis) s *= 2.5; if (s < bs) { bs = s; best = c; bv = vis; } }
      this.tgt = best; this.tgtVis = bv; if (best && bv) this.tgtSeenT = this.t;
    }
    const tg = this.tgt && this.tgt.alive !== false ? this.tgt : null; this.repathT -= dt;
    let ty = b.yaw, tp = 0, fire = false;
    if (tg) {
      tg.aimPoint(this.aimPt); _eye.set(m.pos.x, m.pos.y + 4.6, m.pos.z); const dx = this.aimPt.x - _eye.x, dy = this.aimPt.y - _eye.y, dz = this.aimPt.z - _eye.z, d = Math.hypot(dx, dz);
      ty = yawOf(dx, dz); tp = Math.atan2(dy, d); const e = Math.abs(angDiff(ty, b.yaw)) + Math.abs(tp - b.pitch);
      fire = this.tgtVis && e < 0.12; if (this.tgtVis && e < 0.2 && d > 12 && m.rocketCD <= 0) vin.tap('Mouse2');
      if (this.tgtVis && d < 6.5 && m.punchT < 0) vin.tap('KeyF');
      if (this.tgtVis && m.core >= 1 && d < 60) vin.tap('KeyX');
      if (this.repathT <= 0) { this.repathT = 1; this.path = this.nav.findPath(m.pos.x, m.pos.z, tg.pos.x, tg.pos.z, true); this.pathI = 0; }
      if (this.tgtVis && d < (tg.kind === 'mech' ? 26 : 16)) this.path = null;
    } else if (this.repathT <= 0) { this.repathT = 2.5; const q = this.nav.randomPoint(true); this.path = q ? this.nav.findPath(m.pos.x, m.pos.z, q.x, q.z, true) : null; this.pathI = 0; }
    const path = this.path;
    if (path) {
      while (this.pathI < path.length - 1 && Math.hypot(path[this.pathI].x - m.pos.x, path[this.pathI].z - m.pos.z) < 2.5) this.pathI++;
      const wp = path[this.pathI]; const dx = wp.x - m.pos.x, dz = wp.z - m.pos.z, d = Math.hypot(dx, dz);
      if (d > 1.5) { this.mv.set(dx / d, 0, dz / d); this.moving = true; if (!tg) { ty = yawOf(dx, dz); tp = -0.05; } } else if (this.pathI >= path.length - 1) this.path = null;
    }
    if (m.mag <= 0) { fire = false; if (m.reloadT < 0) vin.tap('KeyR'); }
    vin.set('Mouse0', fire);
    // 开了一阵就离舱继续徒步作战（这台机甲不再登）
    if (this.mechT === 0) this.mechRides = (this.mechRides || 0) + 1;   // 登机就算一次（被打爆弹射出来也不再呼叫第二台）
    this.mechT += dt; let emech = false; for (const o of g.mechs) if (o.alive && o.team !== b.team) emech = true;
    const leave = ((this.mechT > 35 && !emech) || this.mechT > 55) && m.state === 'piloted';   // 有敌方机甲时多打一会儿，但最多 55 秒
    if (leave) this.mechDone = m;
    // 视角
    const w = 6, ex = Math.exp(-w * dt); let u = this.yv, x = -angDiff(ty, b.yaw), tmp = (u + w * x) * dt; this.yv = clamp((u - w * tmp) * ex, -3.2, 3.2);
    u = this.pv; x = -(tp - b.pitch); tmp = (u + w * x) * dt; this.pv = clamp((u - w * tmp) * ex, -2.2, 2.2);
    const dyaw = this.yv * dt; vin.dx = -dyaw / b.sens; vin.dy = -this.pv * dt / b.sens;
    const a = vin.axis; if (this.moving) { const yaw = b.yaw + dyaw, sy = Math.sin(yaw), cy = Math.cos(yaw); a.f = -this.mv.x * sy - this.mv.z * cy; a.s = this.mv.x * cy - this.mv.z * sy; } else { a.f = 0; a.s = 0; }
    vin.set('KeyE', m.state === 'doomed' || leave);   // 濒毁：弹射；该走了：长按离舱
  }
}
