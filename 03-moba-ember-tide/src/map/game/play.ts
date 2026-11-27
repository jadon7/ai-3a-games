// 玩家的输入（阶段 5 重写）：鼠标和键盘怎么变成英雄的命令。英雄自己怎么动在 actor.ts，这里不管位置和动作。
//
//   第九轮改成 LoL / Dota 的操作：右键点地面走过去、右键点对方的单位普攻，按住右键拖着鼠标一直往鼠标那儿走；按下的那一刻就生效（原来是左键松开才走）。
//   左键只用来确认技能（瞄准时点一下就放）和点界面；按住左键拖动平移镜头。触屏还是点一下走过去（command 走 click 那条路）。
//   Q W E R 放技能，用的是 LoL 的“快捷施法加指示”：按住显示范围和方向，松开就朝鼠标放出去；按 Esc 或者点右键取消。
//   手上的动作还没做完时按的技能、移动、普攻不会被吞掉：actor 那边排队，一能动就执行。
//   走到对方的塔（水晶）附近，地上亮出它的射程圈（LoL 的做法）：圈里就会挨打。
//   直接放的技能（不用瞄的）按下就放。指向技能要鼠标指着一个单位（或者离鼠标很近的那个）。
//   A 打最近的一个；S 停下；空格让镜头回到英雄。

import * as THREE from "three";
import type { Actor } from "./actor";
import type { Fx } from "./fx";
import type { FxLib, Indicator } from "./fxlib";
import type { Ent, Sim } from "./sim";
import type { Nav } from "./nav";
import type { SkillDef, SkillKey } from "./skills";

export interface Play {
  actor: Actor; pos: THREE.Vector3; follow: boolean;
  click: (ray: THREE.Ray) => void; hover: (ray: THREE.Ray) => void; key: (code: string) => boolean; keyUp: (code: string) => void; cancel: () => void;
  /** 鼠标右键按下：瞄准中就取消；否则指着对方单位就打它，指着地面就走过去（按下就生效） */
  command: (ray: THREE.Ray) => void;
  /** 按住右键拖着：每 0.1 秒朝鼠标指着的地面重下一次“走过去”（按下时点的是敌人，鼠标没挪开就接着打它） */
  drag: (ray: THREE.Ray, dt: number) => void;
  /** 鼠标左键按下：瞄准中就放出去，返回 true；没在瞄准返回 false（交给镜头拖动） */
  confirm: (ray: THREE.Ray) => boolean;
  update: (dt: number) => void; state: () => string;
  moveTo: (x: number, z: number) => void;
  aim: (x: number, z: number) => void;                      // 把“鼠标指着的地方”设到这里（演示和测试脚本用）
  attack: (e: Ent | null) => void;
  /** 立刻放一个技能（不经过按住瞄准）。x、z 不给就用鼠标指着的地方；指向技能不给 unit 就找离那儿最近的 */
  cast: (key: SkillKey, x?: number, z?: number, unit?: Ent | null) => boolean;
  aiming: () => SkillKey | null;
  // ---- 触屏（阶段 8，界面在 game/touch.ts）。方向都是地面上的方向（世界坐标的 x、z），界面那边已经按镜头的朝向转好了 ----
  /** 摇杆：推着的时候一直朝这个方向走，(0,0) 是松手（停下） */
  stick: (vx: number, vz: number) => void;
  /** 按下一个技能键。"cast"：不用瞄，已经放了；"aim"：开始瞄准（先自动对准最合适的目标）；"no"：现在放不了 */
  aimBegin: (key: SkillKey) => "cast" | "aim" | "no";
  /** 按着技能键拖动：方向和拖出去的幅度（0 到 1，对应技能的最远距离） */
  aimDrag: (vx: number, vz: number, mag: number) => void;
  /** 松手：fire 为真就放出去，否则取消 */
  aimEnd: (fire: boolean) => boolean;
  /** 攻击键：打最合适的一个（够得着的英雄优先，其次最近的），没有可打的返回 false */
  attackNear: () => boolean;
}

const KEYS: Record<string, SkillKey> = { KeyQ: "Q", KeyW: "W", KeyE: "E", KeyR: "R" };

export function createPlay(o: { actor: Actor; sim: Sim; nav: Nav; fx: Fx; fxl: FxLib; height: (x: number, z: number) => number; waterY: number; pick: (ray: THREE.Ray, team?: number, not?: number) => Ent | null }): Play {
  const { actor, sim, fx, nav } = o, me = actor.ent, pos = actor.pos;
  const hoverPt = new THREE.Vector3(pos.x, 0, pos.z + 4), tmp = new THREE.Vector3(); let lastRay: THREE.Ray | null = null, aimKey: SkillKey | null = null;
  let dragT = 0, dragFoe: Ent | null = null, dragAt: [number, number] | null = null, markT = 0;      // 按住右键：离下次重下命令还有几秒、按下时点中的敌人、上次走向的点、离下次画落点标记还有几秒
  const towerRing = o.fxl.indicator("circle", 0xff8a6a); let ringOn = false;
  const ind: { range?: Indicator; line?: Indicator; cone?: Indicator; spot?: Indicator } = {};
  const get = (k: "range" | "line" | "cone" | "spot") => (ind[k] ??= o.fxl.indicator(k === "range" ? "circle" : k === "line" ? "line" : k === "cone" ? "cone" : "spot", k === "range" ? 0x9fdcd6 : 0xdff8f4));
  const hideAll = () => { for (const k of ["range", "line", "cone", "spot"] as const) ind[k]?.show(false); };

  function pickGround(ray: THREE.Ray): THREE.Vector3 | null {
    let prev = 0; const p = tmp;
    for (let s = 2; s < 400; s += 0.75) { p.copy(ray.origin).addScaledVector(ray.direction, s); if (p.y < o.height(p.x, p.z)) { let a = prev, b = s; for (let i = 0; i < 14; i++) { const m = (a + b) / 2; p.copy(ray.origin).addScaledVector(ray.direction, m); if (p.y < o.height(p.x, p.z)) b = m; else a = m; } return p.clone(); } prev = s; }
    return null;
  }
  /** 指向技能的目标：鼠标正指着的；没有就找离鼠标 2.5 米内最近的一个合适的 */
  function unitFor(d: SkillDef): Ent | null {
    const ally = d.target === "ally", any = d.target === "any", fit = (e: Ent) => e.alive && !e.untarget && (e.team === me.team || e.seen) && (any || (ally ? e.team === me.team : e.team !== me.team)) && (ally || any || !(e.kind === "tower" || e.kind === "core") || e.open);
    const hit = lastRay ? (ally ? o.pick(lastRay, me.team) : any ? o.pick(lastRay) : o.pick(lastRay, undefined, me.team)) : null; if (hit && fit(hit)) return hit;
    let best: Ent | null = null, bd = 2.5; for (const e of sim.ents) { if (!fit(e)) continue; const dd = Math.hypot(e.x - hoverPt.x, e.z - hoverPt.z) - e.r; if (dd < bd) { bd = dd; best = e; } }
    if (!best && ally) return me;                             // 给友军放的技能，没指着别人就放给自己
    return best;
  }
  function cast(key: SkillKey, x?: number, z?: number, unit?: Ent | null): boolean {
    const d = actor.skill(key); if (!d) return false; if (x !== undefined && z !== undefined) hoverPt.set(x, 0, z);
    return actor.cast(key, { x: hoverPt.x, z: hoverPt.z }, d.cast === "unit" ? unit ?? unitFor(d) : null);
  }
  function stopAim() { aimKey = null; hideAll(); }
  function showAim() {
    const d = aimKey ? actor.skill(aimKey) : null; hideAll(); if (!d) return;
    const dx = hoverPt.x - pos.x, dz = hoverPt.z - pos.z, l = Math.hypot(dx, dz) || 1, yaw = Math.atan2(dx, dz);
    if (d.range && d.cast !== "dir") { const r = get("range"); r.size(d.range); r.set(pos.x, pos.z); r.show(true); }
    if (d.cast === "dir") { if (d.angle) { const c = get("cone"); c.size(d.range ?? 6, undefined, d.angle); c.set(pos.x, pos.z, yaw); c.show(true); } else { const ln = get("line"); ln.size((d.width ?? 1) / 2 + 0.25, d.range ?? 8); ln.set(pos.x, pos.z, yaw); ln.show(true); } }
    else if (d.cast === "point") { const k = d.range && l > d.range ? d.range / l : 1, s = get("spot"); s.size(d.radius ?? 1.2); s.set(pos.x + dx * k, pos.z + dz * k); s.show(true); }
    else if (d.cast === "unit") { const u = unitFor(d); if (u) { const s = get("spot"); s.size(u.r + 0.7); s.set(u.x, u.z); s.show(true); } }
    else if (d.radius) { const s = get("spot"); s.size(d.radius); s.set(pos.x, pos.z); s.show(true); }
  }

  // ---- 触屏 ----
  let stickX = 0, stickZ = 0, stickOn = false, stickPause = 0;
  const foeOk = (e: Ent, towers: boolean) => e.alive && !e.untarget && e.team !== me.team && e.seen && (towers ? e.open || (e.kind !== "tower" && e.kind !== "core") : e.kind !== "tower" && e.kind !== "core");
  /** 技能自动对准谁：给友军的选血最少的队友（或者自己）；给敌人的，够得着的英雄里最近的，没有英雄再找最近的小兵野怪 */
  function autoTarget(d: SkillDef): Ent | null {
    const reach = (d.range ?? d.radius ?? 6) + 1.5;
    if (d.target === "ally") { let best: Ent = me, br = me.hp / me.max; for (const e of sim.ents) { if (e.kind !== "hero" || e.team !== me.team || !e.alive || e === me || Math.hypot(e.x - pos.x, e.z - pos.z) > reach) continue; const r = e.hp / e.max; if (r < br) { br = r; best = e; } } return best; }
    let hero: Ent | null = null, hd = 1e9, other: Ent | null = null, od = 1e9;
    for (const e of sim.ents) { if (!foeOk(e, false)) continue; const dd = Math.hypot(e.x - pos.x, e.z - pos.z) - e.r; if (dd > reach) continue; if (e.kind === "hero") { if (dd < hd) { hd = dd; hero = e; } } else if (dd < od) { od = dd; other = e; } }
    return hero ?? other;
  }
  function aimAuto(d: SkillDef) {
    lastRay = null;
    if (d.tapAim === "move") { const on = stickOn, l = Math.hypot(stickX, stickZ) || 1, y = actor.yaw(), ux = on ? stickX / l : Math.sin(y), uz = on ? stickZ / l : Math.cos(y), L = d.range ?? 5; hoverPt.set(pos.x + ux * L, 0, pos.z + uz * L); return; }
    if (d.tapAim === "back" && stickOn) { const l = Math.hypot(stickX, stickZ) || 1, L = d.range ?? 5; hoverPt.set(pos.x - stickX / l * L, 0, pos.z - stickZ / l * L); return; }      // 第三批（塞伦 E）：推着摇杆就朝反方向开铳、人往摇杆那边退；没推往下走自动对准
    const u = autoTarget(d);
    if (u && u !== me) hoverPt.set(u.x, 0, u.z);
    else if (u === me) hoverPt.set(pos.x, 0, pos.z);
    else { const y = actor.yaw(), L = Math.min(d.range ?? 6, d.cast === "point" ? 5 : 9); hoverPt.set(pos.x + Math.sin(y) * L, 0, pos.z + Math.cos(y) * L); }
  }

  const play: Play = {
    stick(vx, vz) {
      const on = Math.hypot(vx, vz) > 0.15;
      if (on) { stickX = vx; stickZ = vz; play.follow = true; if (stickPause <= 0 && !sim.over) actor.steer(vx, vz); } else if (stickOn) actor.steer(0, 0);      // 推的那一刻就走（不等下一帧）
      stickOn = on;
    },
    aimBegin(key) {
      const d = actor.skill(key); if (!d || d.cast === "passive" || sim.over || (!actor.canCast(key) && !actor.canQueue(key))) return "no";      // 手上动作没做完也能按：放出去时排队
      play.follow = true;
      if (d.cast === "self" || d.instant) { stopAim(); cast(key); stickPause = d.channel ? Math.min(d.channel, 1.2) : 0; return "cast"; }
      aimKey = key; aimAuto(d); showAim(); return "aim";
    },
    aimDrag(vx, vz, mag) {
      const d = aimKey ? actor.skill(aimKey) : null; if (!d) return; lastRay = null;
      const l = Math.hypot(vx, vz) || 1, ux = vx / l, uz = vz / l, R = d.range ?? 6;
      if (d.cast === "unit") {      // 指向技能：朝拖的方向找一个最顺手的目标，找不到就指着那个方向上的一点
        const ally = d.target === "ally"; let best: Ent | null = null, bs = 0.62;
        for (const e of sim.ents) { if (ally ? !(e.alive && e.team === me.team && e.kind === "hero" && e !== me) : !foeOk(e, false)) continue; const ex = e.x - pos.x, ez = e.z - pos.z, dd = Math.hypot(ex, ez); if (dd > R + 2.5 || dd < 0.01) continue; const off = Math.acos(Math.max(-1, Math.min(1, (ex * ux + ez * uz) / dd))), sc = off + (e.kind === "hero" ? 0 : 0.12); if (sc < bs) { bs = sc; best = e; } }
        if (best) hoverPt.set(best.x, 0, best.z); else hoverPt.set(pos.x + ux * R * Math.max(0.3, mag), 0, pos.z + uz * R * Math.max(0.3, mag));
      } else if (d.cast === "point") hoverPt.set(pos.x + ux * R * mag, 0, pos.z + uz * R * mag);
      else hoverPt.set(pos.x + ux * Math.max(R, 4), 0, pos.z + uz * Math.max(R, 4));
    },
    aimEnd(fire) {
      const k = aimKey; if (!k) return false; const d = actor.skill(k); stopAim(); if (!fire) return false;
      const ok = cast(k); if (ok) stickPause = d?.channel ? Math.min(d.channel, 1.2) : 0;      /* 第九轮：不用再停 0.3 秒——前摇里推摇杆本来就推不动（控制器锁着），一出手就接着走 */; return ok;
    },
    attackNear() {
      if (sim.over || actor.state() === "dead") return false; stopAim(); play.follow = true;
      const reach = (me.h?.stat.range ?? me.range ?? 2) + 4; let hero: Ent | null = null, hd = 1e9, other: Ent | null = null, od = 1e9;
      for (const e of sim.ents) { if (!foeOk(e, true)) continue; const dd = Math.hypot(e.x - pos.x, e.z - pos.z) - e.r; if (dd > 14) continue; if (e.kind === "hero" && dd < reach) { if (dd < hd) { hd = dd; hero = e; } } else if (dd < od) { od = dd; other = e; } }
      const t = hero ?? other; if (!t) return false; actor.attack(t); stickPause = 0.3;      /* 等这一下出手（前摇最长 0.25 秒）再让摇杆接管，推着摇杆点攻击就是走 A */ return true;
    },
    actor, pos, follow: true, state: () => actor.state(), aiming: () => aimKey, cast, cancel: stopAim,
    moveTo: (x, z) => actor.moveTo(x, z), attack: e => actor.attack(e), aim: (x, z) => { hoverPt.set(x, 0, z); },
    hover(ray) { lastRay = ray.clone(); const p = pickGround(ray); if (p) hoverPt.copy(p); },
    command(ray) {
      if (actor.state() === "dead" || sim.over) return; lastRay = ray.clone();
      if (aimKey) { stopAim(); dragT = 1e9; return; }      // 瞄准中按右键：取消，这一下不算移动（LoL 的习惯）
      const d = o.pick(ray, undefined, me.team); dragT = 0.1; dragAt = null;
      if (d) { dragFoe = d; fx.marker(tmp.set(d.x, o.height(d.x, d.z), d.z), true); actor.attack(d); return; }
      dragFoe = null; const p = pickGround(ray); if (!p) return; const [nx, nz] = nav.walkable(p.x, p.z) ? [p.x, p.z] : nav.nearest(p.x, p.z);
      fx.marker(tmp.set(nx, Math.max(o.height(nx, nz), o.waterY), nz), false); markT = 0.35; dragAt = [nx, nz]; actor.moveTo(nx, nz);
    },
    drag(ray, dt) {
      lastRay = ray.clone(); if ((dragT -= dt) > 0 || actor.state() === "dead" || sim.over) return; dragT = 0.1; markT -= 0.1;
      const p = pickGround(ray); if (!p) return;
      if (dragFoe) { if (dragFoe.alive && Math.hypot(p.x - dragFoe.x, p.z - dragFoe.z) < dragFoe.r + 1.2) return; dragFoe = null; }      // 按下时点的是敌人：鼠标还在它身上就接着打
      const [nx, nz] = nav.walkable(p.x, p.z) ? [p.x, p.z] : nav.nearest(p.x, p.z);
      if (dragAt && Math.hypot(nx - dragAt[0], nz - dragAt[1]) < 0.35 && actor.state() === "move") return;      // 鼠标没怎么动、人还在走：不用重新寻路
      dragAt = [nx, nz]; actor.moveTo(nx, nz); if (markT <= 0) { markT = 0.35; fx.marker(tmp.set(nx, Math.max(o.height(nx, nz), o.waterY), nz), false); }
    },
    confirm(ray) {
      if (!aimKey || actor.state() === "dead") return false; lastRay = ray.clone(); const k = aimKey, p = pickGround(ray); if (p) hoverPt.copy(p); stopAim(); cast(k); return true;
    },
    click(ray) {
      if (actor.state() === "dead") return; lastRay = ray.clone();
      if (aimKey) { const k = aimKey; const p = pickGround(ray); if (p) hoverPt.copy(p); stopAim(); cast(k); return; }      // 瞄准时点一下也算确认
      const d = o.pick(ray, undefined, me.team);
      if (d) { fx.marker(tmp.set(d.x, o.height(d.x, d.z), d.z), true); actor.attack(d); return; }
      const p = pickGround(ray); if (!p) return;
      const [nx, nz] = nav.walkable(p.x, p.z) ? [p.x, p.z] : nav.nearest(p.x, p.z);
      fx.marker(tmp.set(nx, Math.max(o.height(nx, nz), o.waterY), nz), false); actor.moveTo(nx, nz);
    },
    key(code) {
      if (code === "Space") { play.follow = true; return true; }
      if (code === "Escape") { if (aimKey) { stopAim(); return true; } return false; }
      if (sim.over) return false;
      const k = KEYS[code];
      if (k) { const d = actor.skill(k); if (!d || d.cast === "passive") return true;
        if (!actor.canCast(k) && !actor.canQueue(k)) { stopAim(); return true; }
        if (d.cast === "self" || d.instant) { stopAim(); cast(k); } else aimKey = k;
        return true; }
      if (code === "KeyA") { stopAim(); actor.attack(sim.pick(pos.x, pos.z, me.team, 14, e => e.seen && !e.untarget && (e.open || e.kind === "melee" || e.kind === "ranged" || e.kind === "hero" || e.kind === "dummy"))); return true; }
      if (code === "KeyS") { stopAim(); actor.stop(); return true; }
      if (code === "KeyB") { stopAim(); actor.recall(); return true; }      // 回城（LoL 的键位）
      return false;
    },
    keyUp(code) { const k = KEYS[code]; if (k && aimKey === k) { stopAim(); cast(k); } },
    update(dt) {
      if (aimKey) { if (!actor.canCast(aimKey) && !actor.canQueue(aimKey)) stopAim(); else showAim(); }
      // 摇杆推着：每帧把方向交给控制器，它直着走、贴墙滑（第九轮：原来是每 0.1 秒朝前面 4 米重新寻一次路，方向一变要等下一次寻路，走起来一卡一卡的）
      if (stickPause > 0) stickPause -= dt;
      else if (stickOn && actor.state() !== "dead" && !sim.over) actor.steer(stickX, stickZ);
      // 对方的塔（水晶）的射程圈：走近了才亮。圈的半径按“塔能打到英雄中心”的距离画（射程 + 英雄半径）
      let tw: Ent | null = null, td = 1e9; if (me.alive && !sim.over) for (const e of sim.ents) { if ((e.kind !== "tower" && e.kind !== "core") || e.team === me.team || !e.alive) continue; const d = Math.hypot(e.x - pos.x, e.z - pos.z) - (e.range + me.r); if (d < 4 && d < td) { td = d; tw = e; } }
      if (tw) { towerRing.size(tw.range + me.r); towerRing.set(tw.x, tw.z); towerRing.color(tw.target === me ? 0xff4a3a : 0xff8a6a); } if (!!tw !== ringOn) { ringOn = !!tw; towerRing.show(ringOn); }
    },
  };
  return play;
}
