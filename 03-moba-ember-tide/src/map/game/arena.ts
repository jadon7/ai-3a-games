// 测试场（阶段 5，网址加 ?arena=1）：不出兵，英雄面前摆好一组不还手的靶子，用来试技能、看特效、录技能展示。
//
//   · 对面：五个小兵（三近战两远程）、一个站着不动的假人英雄。死了三秒后原地重来；被推开、拉走以后三秒自己回位。
//   · 自己这边：一个半血的假人英雄、两个半血的小兵，用来试治疗和护盾。
//   · 左上角一排调试按钮：换英雄、升级、冷却清零、回满、加钱、靶子重置。
// 测试脚本用 window.__arena 拿这些靶子：foes（对面小兵）、dummy（对面假人）、friend（己方假人）、pals（己方小兵）。

import type { Actor } from "./actor";
import { MOBS, RULES, type Camp, type Ent, type Sim } from "./sim";
import { KITS, ORDER } from "./heroes";

export interface Arena { update: (dt: number) => void; foes: Ent[]; pals: Ent[]; dummy: Ent | null; friend: Ent | null; reset: () => void;
  /** 在靶子旁边放出一窝野怪（或者一只 Boss）来试打；再调一次换一种，mob 给空的就收走。返回那个营地 */
  wild: (mob: string) => Camp | null; }

export async function createArena(o: { sim: Sim; player: Actor; spawnHero: (kit: string, team: 0 | 1, x: number, z: number, yaw: number) => Promise<Actor> }): Promise<Arena> {
  const { sim, player } = o, me = player.ent, x0 = me.x, z0 = me.z, yaw = player.yaw(), fx = Math.sin(yaw), fz = Math.cos(yaw), rx = fz, rz = -fx;
  const at = (f: number, r: number): [number, number] => [x0 + fx * f + rx * r, z0 + fz * f + rz * r];
  interface Slot { e: Ent; x: number; z: number; kind: "melee" | "ranged"; team: 0 | 1; away: number; hp: number; }
  const slots: Slot[] = [];
  const minion = (s: Slot) => { const R = s.kind === "melee" ? RULES.melee : RULES.ranged; const e = sim.add(s.kind, s.team, s.x, s.z, { lane: 0, s: 0, max: Math.round(R.hp * 1.4), ad: 0, range: R.range, period: 99, sight: R.sight, r: R.r, state: "idle", think: 1e9, yaw: s.team ? yaw + Math.PI : yaw, seen: true }); e.root = 1e9; e.hp = e.max * s.hp; s.e = e; s.away = 0; return e; };
  for (const [f, r, kind] of [[7, -2.2, "melee"], [7.6, 1.6, "melee"], [9.2, -0.2, "melee"], [10.8, -2.8, "ranged"], [11.2, 2.4, "ranged"]] as const) { const [x, z] = at(f, r); const s: Slot = { e: null as unknown as Ent, x, z, kind, team: 1, away: 0, hp: 1 }; minion(s); slots.push(s); }
  for (const [f, r] of [[0.5, -6.5], [-2.2, -7.2]] as const) { const [x, z] = at(f, r); const s: Slot = { e: null as unknown as Ent, x, z, kind: "melee", team: 0, away: 0, hp: 0.5 }; minion(s); slots.push(s); }
  // 两个假人英雄：用名册里排在玩家后面的两个英雄
  const others = ORDER.filter(id => id !== player.kit.id && KITS[id]), heroSlots: { a: Actor; x: number; z: number; hp: number; dead: number; away: number }[] = [];
  for (const [id, team, f, r, hp] of [[others[0] ?? "lan", 1, 8.5, 5.2, 1], [others[1] ?? others[0] ?? "lan", 0, -1, -4.6, 0.45]] as const) {
    const [x, z] = at(f, r), a = await o.spawnHero(id, team, x, z, team ? yaw + Math.PI : yaw); a.ent.hp = a.ent.max * hp; heroSlots.push({ a, x, z, hp, dead: 0, away: 0 }); }
  // 试打野怪用的营地：顺着兵线往前，过了河的对岸（靶子后面十几米）；Boss 个头大，再远一点。放在两边会落进河里或者草丛里
  let pen: Camp | null = null;
  const wild = (mob: string): Camp | null => {
    if (pen) { for (const m of pen.mobs) if (m.alive) { m.alive = false; m.hp = 0; m.deadAt = sim.time - 99; } pen.up = false; }
    const D = MOBS[mob]; if (!D) return (pen = null); const [x, z] = at(22, 0);      /* 再往前就进对面外塔的射程了 */
    pen = { id: sim.camps.length, x, z, r: 6, fx: -fx, fz: -fz, kind: D.boss ? "boss" : D.heavy ? "buff" : "small", mob, n: mob === "wolf" ? 3 : mob === "mandrill" ? 2 : 1, side: 2, top: false, buff: mob === "toad" ? "blue" : mob === "boar" ? "red" : "", mobs: [], up: false, nextAt: 1e9 };
    sim.camps.push(pen); sim.spawnCamp(pen); return pen; };
  const arena: Arena = {
    wild, foes: [], pals: [], dummy: heroSlots[0].a.ent, friend: heroSlots[1].a.ent,
    reset() { for (const s of slots) { if (s.e.alive) { s.e.x = s.x; s.e.z = s.z; s.e.hp = s.e.max * s.hp; s.e.stun = s.e.slow = s.e.silence = s.e.fly = 0; s.e.shield = 0; } }
      for (const hs of heroSlots) { const e = hs.a.ent; if (e.alive) { hs.a.teleport(hs.x, hs.z); e.hp = e.max * hs.hp; e.stun = e.slow = e.silence = e.root = 0; e.shield = 0; } } },
    update(dt) {
      for (const s of slots) { const e = s.e;
        if (!e.alive) { if (sim.time - e.deadAt > 4) minion(s); continue; }
        if (Math.hypot(e.x - s.x, e.z - s.z) > 0.6 && e.fly <= 0 && e.stun <= 0) { s.away += dt; if (s.away > 3) { e.x = s.x; e.z = s.z; s.away = 0; } } else s.away = 0;
        if (s.team === 0 && e.hp > e.max * 0.98) e.hp = e.max * s.hp; }                      // 己方的靶子被奶满了就掉回半血，可以反复试
      for (const hs of heroSlots) { const e = hs.a.ent;
        if (!e.alive) { e.h!.respawnIn = 1e9; hs.dead += dt; if (hs.dead > 3) { hs.dead = 0; e.alive = true; e.hp = e.max * hs.hp; e.h!.respawnIn = 0; e.h!.mana = e.h!.stat.mana; e.x = hs.x; e.z = hs.z; hs.a.teleport(hs.x, hs.z); } continue; }
        if (Math.hypot(e.x - hs.x, e.z - hs.z) > 0.8 && e.fly <= 0 && e.stun <= 0 && hs.a.state() === "idle") { hs.away += dt; if (hs.away > 3) { hs.a.teleport(hs.x, hs.z); hs.away = 0; } } else hs.away = 0;
        if (e.team === 0 && e.hp > e.max * 0.98) e.hp = e.max * hs.hp; }
      arena.foes = slots.filter(s => s.team === 1).map(s => s.e); arena.pals = slots.filter(s => s.team === 0).map(s => s.e);
    },
  };
  arena.update(0);

  // 调试按钮
  const box = document.createElement("div"); box.style.cssText = "position:fixed;left:12px;top:12px;z-index:6;display:flex;flex-wrap:wrap;gap:6px;max-width:420px;font:600 12.5px/1 'Avenir Next','PingFang SC',system-ui,sans-serif";
  const btn = (label: string, fn: () => void) => { const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.style.cssText = "padding:7px 10px;border:1px solid rgba(216,240,236,.3);background:rgba(10,15,17,.78);color:#e9f3f1;border-radius:5px;cursor:pointer;font:inherit"; b.addEventListener("click", e => { e.stopPropagation(); fn(); b.blur(); }); box.appendChild(b); };
  const sel = document.createElement("select"); sel.style.cssText = "padding:6px 8px;border:1px solid rgba(216,240,236,.3);background:rgba(10,15,17,.78);color:#e9f3f1;border-radius:5px;font:inherit";
  for (const id of ORDER) if (KITS[id]) { const op = document.createElement("option"); op.value = id; op.textContent = `${KITS[id].name} · ${KITS[id].title}`; op.selected = id === player.kit.id; sel.appendChild(op); }
  sel.addEventListener("change", () => { const u = new URL(location.href); u.searchParams.set("h", sel.value); location.href = u.toString(); }); box.appendChild(sel);
  btn("升一级", () => sim.gainXp(me, RULES.level(me.h!.level) - me.h!.xp)); btn("升满", () => { for (let i = 0; i < 15; i++) sim.gainXp(me, 2000); });
  btn("冷却清零", () => { for (const k of ["Q", "W", "E", "R"] as const) player.setCd(k, 0); }); btn("回满", () => { me.hp = me.max; me.h!.mana = me.h!.stat.mana; });
  btn("加 1000 金", () => { me.h!.gold += 1000; }); btn("靶子重置", () => arena.reset());
  { const ws = sel.cloneNode(false) as HTMLSelectElement; ws.title = "在靶子后面（河对岸）放一窝野怪或者一只 Boss 来试打"; for (const [v, t] of [["", "放野怪……"], ...Object.entries(MOBS).map(([k, d]) => [k, d.name + (d.boss ? "（Boss）" : "")])]) { const op = document.createElement("option"); op.value = v; op.textContent = t; ws.appendChild(op); }
    ws.addEventListener("change", () => { wild(ws.value); ws.blur(); }); box.appendChild(ws); }
  document.body.appendChild(box);
  return arena;
}
