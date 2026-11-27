// 演示脚本：假装自己是技能代码（heroes/iti.ts），在时机点上调 ITI_FX、挪伊缇、播动作。特效本身一行都不在这里。
// 第二步：时间点和调用顺序照合进来的技能代码（heroes/iti.ts、docs/hero_iti/kit/README.md 的时间表）：
//   普攻 1 出手 0.15 秒、普攻 2 出手 0.29 秒；Q 一二段前摇 0.165 秒、冲 6 米用 0.2 秒；Q 三段前摇 0.05 秒、腾空 7 米用 0.495 秒、砸地 5 米；
//   W 前摇 0.25 秒、冲 7 米用 0.24 秒、炸开 5 米；E 前摇 0.234 秒，出手当帧闪过去刺中；
//   R 出手 0.05 秒，0.2 秒藏人，八刀从 0.26 秒起每 0.14 秒一刀，1.36 秒在中心现身（rGather），1.7 秒落地十字新月（rFinale）。
// 对局里的真东西在测试场看（map.html?arena=1&h=iti）；这一页留着是为了不开对局就能反复看某一下。
import { ITI_FX } from "../../../src/map/game/fx_iti";
import type { Demo, Lab, LabActor } from "../api";

const FX = ITI_FX;
const ease = (k: number) => 1 - Math.pow(1 - k, 3);
type P2 = { x: number; z: number };
const hide = (L: Lab, list: LabActor[]) => { for (const t of L.targets) if (!list.includes(t)) t.setPos(60, 40); };      // 这一段用不到的靶子挪到看不见的地方
const place = (a: LabActor, x: number, z: number, look?: P2) => { a.setPos(x, z); if (look) a.faceTo(look.x, look.z); };
const dist = (a: P2, b: P2) => Math.hypot(a.x - b.x, a.z - b.z);
/** 叠满引爆：照技能代码的顺序，先告诉特效“变成 3 层”，再引爆 */
const pop = (L: Lab, a: LabActor, dmg = 460) => { FX.mark(L.c, a.ent, 3, 0.2); FX.detonate(L.c, a.ent, dmg); };

/** 冲刺路上会砍到谁、什么时候砍到（按投影位置和先快后慢的曲线算） */
function onPath(L: Lab, from: P2, to: P2, half = 1.4) {
  const len = dist(from, to), dx = (to.x - from.x) / len, dz = (to.z - from.z) / len, out: { a: LabActor; k: number }[] = [];
  for (const t of L.targets) { const rx = t.ent.x - from.x, rz = t.ent.z - from.z, al = rx * dx + rz * dz, off = Math.abs(-rx * dz + rz * dx); if (al < -0.3 || al > len + 0.8 || off > half) continue; out.push({ a: t, k: 1 - Math.cbrt(1 - Math.max(0, Math.min(1, al / len))) }); }
  return out;
}

/** 普攻一下（i 是第几下：0 右手、1 双手），返回打中的时刻 */
function doAttack(L: Lab, t0: number, target: LabActor, i: number, onHit?: () => void) {
  const c = L.c, hit = i % 2 === 0 ? 0.154 : 0.286;
  L.at(t0, () => { L.cast.faceTo(target.ent.x, target.ent.z); L.cast.play(i % 2 === 0 ? "attack1" : "attack2", { loop: false, speed: i % 2 === 0 ? 1.3 : 1.4, fade: 0.04 }); });
  L.at(t0 + hit, () => { FX.attack(c, target.ent, i % 2); onHit?.(); });
  return t0 + hit;
}

/** Q 的一段冲刺斩（stage 1、2），返回冲完的时刻 */
function doQ12(L: Lab, t0: number, stage: 1 | 2, from: P2, to: P2, onHit?: (a: LabActor) => void) {
  const c = L.c, W = 0.165, DUR = 0.2;
  L.at(t0, () => { L.cast.setPos(from.x, from.z); L.cast.faceTo(to.x, to.z); L.cast.play("q", { loop: false, speed: 1.2, fade: 0.03 }); FX.qWindup(c, stage, W); });
  L.at(t0 + W, () => { FX.qDash(c, stage, from, to, DUR); for (const h of onPath(L, from, to)) L.at(t0 + W + DUR * h.k, () => { FX.qHit(c, stage, h.a.ent); onHit?.(h.a); }); });
  L.tween(t0 + W, DUR, k => { const e = ease(k); L.cast.setPos(from.x + (to.x - from.x) * e, from.z + (to.z - from.z) * e); });
  return t0 + W + DUR;
}
/** Q 第三段：腾空翻身下劈，返回落地的时刻 */
function doQ3(L: Lab, t0: number, from: P2, to: P2, r = 5, onHit?: (a: LabActor) => void) {
  const c = L.c, W = 0.05, AIR = 0.495;
  L.at(t0, () => { L.cast.setPos(from.x, from.z); L.cast.faceTo(to.x, to.z); L.cast.play("q3", { loop: false, speed: 4.4, fade: 0.03 }); FX.qWindup(c, 3, W); });      // 动作时间表里 q3 的 speed 是 4.4：0.06 秒起跳、0.495 秒落地
  L.at(t0 + W, () => FX.qDash(c, 3, from, to, AIR));
  L.tween(t0 + W, AIR, k => L.cast.setPos(from.x + (to.x - from.x) * k, from.z + (to.z - from.z) * k));
  L.at(t0 + W + AIR, () => { L.cast.setPos(to.x, to.z); L.cast.hero.setSpeed(2.4); FX.qLand(c, to, r);
    for (const t of L.targets) { const d = dist(t.ent, to); if (d <= r + t.radius * 0.5) { FX.qHit(c, 3, t.ent); onHit?.(t); } } });      // 技能代码是落地那一帧一起结算的
  return t0 + W + AIR;
}

/** E：闪到 target 身后反手刺（出手当帧）。marks 是刺之前目标身上已有几层烬痕（2 层就直接引爆） */
function doE(L: Lab, t0: number, target: LabActor, marks = 0) {
  const c = L.c, W = 0.234;
  L.at(t0, () => { L.cast.faceTo(target.ent.x, target.ent.z); L.cast.play("e", { loop: false, speed: 1.2, fade: 0.03 }); });
  L.at(t0 + W, () => { const p = L.cast.obj.position, from = { x: p.x, z: p.z }, d = dist(from, target.ent), dx = (target.ent.x - from.x) / d, dz = (target.ent.z - from.z) / d;
    const to = { x: target.ent.x + dx * (target.radius + 0.9), z: target.ent.z + dz * (target.radius + 0.9) }, boom = marks >= 2;
    FX.eBlink(c, from, to, target.ent); L.cast.setPos(to.x, to.z); L.cast.faceTo(target.ent.x, target.ent.z);
    FX.eStab(c, target.ent, boom); if (boom) pop(L, target); else FX.mark(c, target.ent, marks + 1, 5); });
  return t0 + W;
}

/** R 整段。order 是 8 刀依次砍谁；返回十字新月的时刻 */
function doR(L: Lab, t0: number, P: P2, order: LabActor[], r = 11) {
  const c = L.c, T = { fire: 0.05, hide: 0.2, cut0: 0.26, gap: 0.14, show: 1.36, land: 1.7 }, tS = t0 + T.fire, tF = tS + T.land;
  let field: { end(): void } | null = null, prev: P2 = { x: L.cast.ent.x, z: L.cast.ent.z };
  L.at(t0, () => { prev = { x: L.cast.ent.x, z: L.cast.ent.z }; L.cast.faceTo(P.x, P.z); L.cast.play("r", { loop: false, speed: 1.6, fade: 0.03 }); });
  L.at(tS, () => { field = FX.rStart(c, P, r, order.length); });
  L.at(tS + T.hide, () => { L.cast.setHide(1); L.cast.setPos(P.x, P.z); });      // 人藏起来以后就在落点中心（镜头停在范围上）；八刀的位置只传给特效
  order.forEach((t, i) => L.at(tS + T.cut0 + T.gap * i, () => {
    const d = dist(prev, t.ent) || 1, dx = (t.ent.x - prev.x) / d, dz = (t.ent.z - prev.z) / d, to = { x: t.ent.x + dx * (t.radius + 1.2), z: t.ent.z + dz * (t.radius + 1.2) };
    FX.rSlash(c, i, prev, to, t.ent); if (t.isHero) FX.mark(c, t.ent, 1, 5);
    prev = to; }));
  L.at(tS + T.show, () => { L.cast.setHide(0); L.cast.face(0.6); L.cast.play("r", { loop: false, speed: 1.6, fade: 0.05, at: 2.45 - (T.land - T.show) * 1.6 }); FX.rGather(c, P, r, T.land - T.show); });      // 动作只用落地那一截：2.45 秒落地，往前倒 0.34 秒
  L.at(tF, () => FX.rFinale(c, P, r, L.targets.filter(t => dist(t.ent, P) <= r).map(t => t.ent)));
  L.at(tF + 0.3, () => field?.end());
  L.at(tF + 1.0, () => L.cast.play("idle", { fade: 0.25 }));
  return tF;
}

export const DEMOS: Record<string, Demo> = {
  attack: { label: "普攻", duration: 3.0,
    setup(L) { const [moko, torg, seren] = L.targets; hide(L, [seren]); void moko; void torg; place(L.cast, -2.5, 0.4, { x: 0, z: 0 }); place(seren, 0, 0, { x: -2.5, z: 0.4 }); L.follow(false, -0.8, 0); },
    run(L) { const t = L.targets[2]; doAttack(L, 0.15, t, 0); doAttack(L, 0.72, t, 1); doAttack(L, 1.42, t, 0); doAttack(L, 1.98, t, 1); L.at(2.75, () => L.cast.play("idle", { fade: 0.2 })); } },

  passive: { label: "被动 · 烬痕", duration: 2.9,
    setup(L) { const moko = L.targets[0]; hide(L, [moko]); place(L.cast, -2.5, 0.4, { x: 0, z: 0 }); place(moko, 0, 0, { x: -2.5, z: 0.4 }); L.follow(false, -0.6, 0); },
    run(L) { const t = L.targets[0], c = L.c;
      doAttack(L, 0.12, t, 0, () => FX.mark(c, t.ent, 1, 5)); doAttack(L, 0.62, t, 1, () => FX.mark(c, t.ent, 2, 5));
      doAttack(L, 1.22, t, 0, () => pop(L, t, 420));
      L.at(2.3, () => L.cast.play("idle", { fade: 0.2 })); } },

  q: { label: "Q · 三叠斩", duration: 3.5,
    setup(L) { const [moko, torg, seren, m0, m1, m2, m3, m4] = L.targets, P1 = { x: -4, z: 0.4 }, P3 = { x: 9, z: 0.6 };
      place(L.cast, -10, 1, P1); place(m0, -7.2, 0.7, P1); place(torg, -1.2, 1.0, P1); place(moko, 10.8, 2.2, P3); place(seren, 11.6, -1.6, P3); place(m1, 7.4, -2.6, P3); place(m2, 9.4, 4.4, P3); place(m4, 5.6, 3.2, P3); place(m3, 15.3, 1.0, P3);      // m3 在 5 米外：不受伤，范围一眼看得出
      L.follow(true); },
    run(L) { const P0 = { x: -10, z: 1 }, P1 = { x: -4, z: 0.4 }, P2 = { x: 2, z: 1.2 }, P3 = { x: 9, z: 0.6 };
      doQ12(L, 0.15, 1, P0, P1); doQ12(L, 0.72, 2, P1, P2); doQ3(L, 1.3, P2, P3, 5); L.at(3.0, () => L.cast.play("idle", { fade: 0.25 })); } },

  w: { label: "W · 残焰", duration: 3.7,
    setup(L) { const [moko, torg, , m0, m1, m2] = L.targets, E = { x: -7, z: 0.5 }; hide(L, [moko, torg, m0, m1, m2]);
      place(L.cast, E.x, E.z, { x: 0, z: 0.5 }); place(moko, 2.2, 0.3, E); place(torg, 2.6, 3.4, E); place(m0, -0.8, -2.6, E); place(m1, 3.6, -2.4, E); place(m2, -2.6, 2.4, E); L.follow(true); },      // 残影炸在她换位前站的地方：靶子围着冲刺的终点摆
    run(L) { const c = L.c, E = { x: -7, z: 0.5 }, D = { x: 0, z: 0.5 }, moko = L.targets[0]; let echo: { move(x: number, z: number): void; remove(): void } | null = null;
      L.at(0.15, () => { L.cast.faceTo(D.x, D.z); L.cast.play("w", { loop: false, speed: 1.9, fade: 0.03 }); });
      L.at(0.40, () => { echo = FX.wEcho(c, E, Math.PI / 2); FX.wDash(c, E, D, 0.24); });
      L.tween(0.40, 0.24, k => { const e = ease(k); L.cast.setPos(E.x + (D.x - E.x) * e, E.z + (D.z - E.z) * e); });
      doAttack(L, 0.78, moko, 0); doAttack(L, 1.3, moko, 1);
      // 换位照技能代码的顺序：wSwap → 她瞬移回残影那里 → 残影挪到她刚才站的地方 → 在那里炸开 → 收掉
      L.at(2.0, () => { const p = L.cast.obj.position, from = { x: p.x, z: p.z }; FX.wSwap(c, from, E); L.cast.setPos(E.x, E.z); L.cast.faceTo(D.x, D.z); L.cast.play("idle", { fade: 0.05 }); echo?.move(from.x, from.z);
        FX.wBurst(c, from, 5, L.targets.filter(t => dist(t.ent, from) <= 5).map(t => t.ent)); echo?.remove(); });
    } },

  e: { label: "E · 影步 · 穿心", duration: 2.6,
    setup(L) { const [moko, , , m0] = L.targets; hide(L, [moko, m0]); place(L.cast, -5.5, 1.6, { x: 2.5, z: 0 }); place(moko, 2.5, 0, { x: -5.5, z: 1.6 }); place(m0, 5.2, 2.6, { x: 2.5, z: 0 }); L.follow(true); },
    run(L) { const c = L.c, moko = L.targets[0]; L.at(0.02, () => FX.mark(c, moko.ent, 2, 5)); doE(L, 0.2, moko, 2); L.at(1.9, () => L.cast.play("idle", { fade: 0.25 })); } },

  refresh: { label: "击杀刷新", duration: 1.4,
    setup(L) { hide(L, []); place(L.cast, 0, 0, { x: 2, z: 0 }); L.follow(false, 0, 0); },
    run(L) { L.at(0.2, () => FX.refresh(L.c)); } },

  r: { label: "R · 绯月千刃", duration: 4.2,
    setup(L) { const [moko, torg, seren, m0, m1, m2, m3, m4] = L.targets, O = { x: 0, z: 0 };
      place(moko, 4.6, -2.4, O); place(torg, -4.2, 3.4, O); place(seren, 1.4, -6.6, O); place(m0, 7.6, 3.2, O); place(m1, -6.6, -3.6, O); place(m2, -1.6, 6.6, O); place(m3, 6.2, -6.0, O); place(m4, -8.2, 1.0, O);
      place(L.cast, -9.5, 6.5, O); L.follow(false, 0, 0); },
    run(L) { const [moko, torg, seren, m0, m1, m2, m3, m4] = L.targets; doR(L, 0.15, { x: 0, z: 0 }, [torg, moko, m2, seren, m4, m0, m1, m3]); } },

  combo: { label: "连招 E→Q→Q→Q→R", duration: 7.0,
    setup(L) { const [moko, torg, seren, m0, m1, m2, m3, m4] = L.targets, O = { x: 8, z: 0 }, S = { x: -12, z: 1.5 };
      place(L.cast, S.x, S.z, { x: -4, z: 0.5 }); place(seren, -4, 0.5, S); place(m0, 1.6, -1.8, S); place(torg, 4.2, 2.0, S); place(moko, 10.5, -2.0, O); place(m1, 13.0, 3.2, O); place(m2, 7.5, 5.5, O); place(m3, 6.0, -6.0, O); place(m4, 14.5, -3.5, O);
      L.follow(true); },
    run(L) { const c = L.c, [moko, torg, seren, m0, m1, m2, m3, m4] = L.targets;
      // E 贴身（一层）→ Q 一段穿过去（两层）→ Q 二段折回来（三层，引爆）→ Q 三段跳进人堆砸地 → R 收尾
      const tE = doE(L, 0.2, seren, 0), back = { x: seren.ent.x + 1.95, z: seren.ent.z - 0.1 }, far = { x: back.x - 6, z: back.z }, land = { x: back.x + 7, z: 0.6 };
      const hitS = (n: number) => (a: LabActor) => { if (a !== seren) return; if (n >= 3) pop(L, a, 520); else FX.mark(c, a.ent, n, 5); };
      doQ12(L, tE + 0.38, 1, back, far, hitS(2));
      doQ12(L, tE + 0.93, 2, far, back, hitS(3));
      const tL = doQ3(L, tE + 1.5, back, land, 5);
      L.at(tL + 0.75, () => L.follow(false, 8, 0));
      doR(L, tL + 0.85, { x: 8, z: 0 }, [torg, moko, m2, m3, m1, m0, m4, torg]);
    } },
};
