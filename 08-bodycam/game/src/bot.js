// 自动试玩（开发自检用）：不需要锁定鼠标，脚本自己走位、转视角、举枪、开枪、换弹、扔闪光弹。
// ?tour 时按路线把大厅、走廊、两间小房间都走一遍。
import * as THREE from 'three';
import { b2t, QS } from './config.js';
import { LV } from './level.js';

const wrap = (a) => { while (a > 180) a -= 360; while (a < -180) a += 360; return a; };
const yawOf = (v) => Math.atan2(-v.x, -v.z) * 180 / Math.PI;       // three 方向 -> 玩家 yaw（Blender 绕 Z 的角）
const pitchOf = (v) => Math.asin(Math.max(-1, Math.min(1, v.y))) * 180 / Math.PI;
const HOME = [[23.6, 2.7], [21.6, 1.5], [23.9, 3.9], [20.3, 2.2]];

export class Bot {
  constructor(game) { this.g = game; this.t = 0; this.cool = 0.5; this.seen = 0; this.wp = 0; this.path = null; this.pi = 0; this.repT = 0; this.bangT = 5; this.pause = 1.0; this.log = []; this.jumpT = 3; this.swT = 16; this.burst = 0; this.leanT = 7; this.leanHold = 0; this.leanDir = 1; this.stuckT = 0; this.strafeT = 0; this.strafeDir = 1; }
  update(dt) {
    const g = this.g, p = g.player, nav = g.nav; this.t += dt; this.cool -= dt; this.bangT -= dt; this.jumpT -= dt; this.swT -= dt;
    if (p.dead) { p.keys = {}; p.adsOn = false; return; }
    p.keys = {};
    const pts = g.startAt === 'pool' ? (QS.tour ? LV.tourPool : [[22.25, 1.5, 0], [22.3, 5.3, 0], [19.2, 1.4, 0], [25.6, 5.2, 0]]) : (QS.tour ? LV.tour : HOME);
    // 目标：看得见的敌人里最近的
    let tgt = null, bd = 1e9;
    for (const f of g.foes) { if (!f.alive || !f.exposed) continue; const d = Math.hypot(f.x - p.pos.x, f.y - p.pos.y, f.z - p.z); if (d < bd) { bd = d; tgt = f; } }
    let aim = null, wantYaw = null;
    // 刚打倒一个：像真人一样枪口跟着他倒下去、盯一秒多确认，再接着走
    if (this.last && !this.last.alive) { this.watch = this.last; this.watchT = 1.5; }
    this.last = tgt || null;
    if (this.watchT > 0) this.watchT -= dt;
    if (tgt) {
      this.seen += dt; aim = tgt.e.chestWorld().lerp(tgt.e.hipsWorld(), 0.25);
      if (this.bangT < 0 && g.bangs > 0 && bd > 4 && bd < 11 && g.foes.filter((f) => f.alive).length >= 2) { g.throwBang(); this.bangT = 14; }
    } else if (this.watchT > 0 && this.watch) {
      this.seen = 0; aim = this.watch.e.hipsWorld().clone();
    } else {
      this.seen = 0;
      // 走位：沿路线走；到点停一下
      this.pause -= dt;
      if (this.pause <= 0) {
        const [wx, wy, wl = 2] = pts[this.wp % pts.length];
        this.repT -= dt;
        if (!this.path || this.repT <= 0) { this.path = nav.path({ x: p.pos.x, y: p.pos.y, L: p.layer }, { x: wx, y: wy, L: wl }, true); this.pi = 0; this.repT = 1.0; }
        if (this.path) {
          let [tx, ty, tl] = this.path[Math.min(this.pi, this.path.length - 1)];
          while (Math.hypot(tx - p.pos.x, ty - p.pos.y) < 0.35 && Math.abs(nav.floor(tl, tx, ty) - p.z) < 0.9 && this.pi < this.path.length - 1) { this.pi++; [tx, ty, tl] = this.path[this.pi]; }
          const d = Math.hypot(tx - p.pos.x, ty - p.pos.y);
          if (Math.hypot(wx - p.pos.x, wy - p.pos.y) < 0.45 && Math.abs(nav.floor(wl, wx, wy) - p.z) < 0.5) { this.wp++; this.path = null; this.pause = QS.tour ? 0.5 : 2.5; }      // 半层平台同时属于上下两层，按高度判断到没到
          else { wantYaw = Math.atan2(-(tx - p.pos.x), ty - p.pos.y) * 180 / Math.PI; if (Math.abs(wrap(wantYaw - p.yaw)) < 50) p.keys.KeyW = true; if (QS.tour && d > 2.5 && Math.abs(wrap(wantYaw - p.yaw)) < 15) p.keys.ShiftLeft = true; }
        } else { this.wp++; }
      } else {
        const hid = g.foes.find((f) => f.alive);
        if (hid) aim = b2t(hid.x, hid.y, hid.z + 1.2);
      }
    }
    // 没有目标时隔一阵往一侧探一下身（两边轮着来）
    this.leanT -= dt; this.leanHold -= dt;
    if (this.leanT < 0 && !tgt && !(this.watchT > 0)) { this.leanT = 13; this.leanHold = 0.9; this.leanDir = -this.leanDir; }
    if (this.leanHold > 0 && !tgt) p.keys[this.leanDir > 0 ? 'KeyE' : 'KeyQ'] = true;
    // 顶着柱子、墙角走不动了：往旁边横移半秒绕开（人会这么做，脚本也得会）
    if (p.keys.KeyW && p.speed < 0.25) this.stuckT += dt; else this.stuckT = 0;
    if (this.stuckT > 0.45) { this.stuckT = 0; this.strafeT = 0.55; this.strafeDir = -this.strafeDir; }
    if (this.strafeT > 0) { this.strafeT -= dt; p.keys[this.strafeDir > 0 ? 'KeyD' : 'KeyA'] = true; }
    p.adsOn = !!tgt && bd > 3.5;
    p.crouchOn = !!tgt && p.hp < 55;
    if (QS.tour && this.jumpT < 0 && !tgt && p.keys.KeyW) { p.jumpReq = p.time; this.jumpT = 9; }
    // 视角：有目标时闭环把枪管转到目标上（带上限的角速度，像人甩枪）；没目标时看着前进方向
    const mw = g.vm.worldPoint(g.vm.muzzle), fwd = g.vm.forward();
    let ey = 0, ep = 0;
    if (aim) {
      // 贴身（目标比枪口还近）时按镜头的朝向来瞄，不然"枪口到目标"的方向是反的，会原地打转
      const close = tgt && bd < 1.9, from = close ? g.camera.position : mw, ref = close ? g.camera.getWorldDirection(new THREE.Vector3()) : fwd;
      const want = aim.clone().sub(from).normalize(); ey = wrap(yawOf(want) - yawOf(ref)); ep = pitchOf(want) - pitchOf(ref);
    }
    else if (wantYaw != null) { ey = wrap(wantYaw - p.yaw); ep = -4 - p.pitch; }
    const k = 1 - Math.exp(-dt * 7), maxStep = 260 * dt;
    p.yaw += Math.max(-maxStep, Math.min(maxStep, ey * k)); p.pitch += Math.max(-maxStep, Math.min(maxStep, ep * k));
    p.pitch = Math.max(-70, Math.min(60, p.pitch));
    const err = Math.hypot(ey, ep);
    this.dbg = `tgt=${tgt ? tgt.id : '-'} err=${err.toFixed(1)} seen=${this.seen.toFixed(1)} cool=${this.cool.toFixed(1)} wp=${this.wp % pts.length}${this.path ? ' to=' + this.path[Math.min(this.pi, this.path.length - 1)].map((v) => +v.toFixed(1)).join('/') + ' n=' + this.path.length : ' nopath'}`;
    // 手枪一枪一枪打；步枪打两到四发的短点射
    if (tgt && this.seen > QS.react && err < (bd < 1.9 ? 9 : (g.vm.def.auto ? 2.6 : 1.6)) && this.cool <= 0 && g.ammo > 0 && !g.vm.reloading && !g.vm.switching) {
      g.fire();
      if (g.vm.def.auto) { if (this.burst > 0) { this.burst--; this.cool = 0.09; } else { this.burst = 1 + Math.floor(Math.random() * 3); this.cool = 0.34 + Math.random() * 0.2; } }
      else this.cool = 0.2 + Math.random() * 0.16;
    }
    if (!g.vm.reloading && !g.vm.switching && (g.ammo === 0 || (g.ammo < 0.4 * g.magSize && !tgt && this.cool < -1.2))) g.reload();
    // 没有目标的空当换一把枪（两把都要试到）
    if (this.swT < 0 && !tgt && !g.vm.reloading && !(this.watchT > 0)) { g.switchWeapon(); this.swT = 24; }
  }
}
