// 命中那一下（三个技能共用）。王者的“打击感”拆开就是同一帧里的这几样：
//   目标整个闪白 → 顿帧（世界停 30～70 毫秒） → 镜头小抖 → 命中处一颗锐利的星芒 → 顺着刀的方向溅出一把火花和两三片绯红碎片
//   → 目标脚下一小圈冲击 → 一道顺着刀路的刀痕贴在身上（短短亮一下，大招里留着等最后一起爆）
// 节奏是“极快地打出去 → 停一下 → 炸开 → 迅速收”：星芒 0.03 秒弹到最大，0.2 秒收没；火花 0.15～0.3 秒。
import type { FxCtx, LabActor } from "../api";
import { chest, kit, vec, type V3 } from "./kit";

export interface StrikeOpts {
  dir: V3;                 // 刀从哪个方向砍过来（水平方向就行）
  power?: number;          // 0.6 小兵 / 1 英雄 / 1.4 重击
  stop?: number;           // 顿帧秒数（不写按 power）
  shake?: number;          // 镜头抖（米）
  mark?: { life: number; thread?: number; collapse?: number; ignite?: number; tilt?: number; len?: number };   // 刀痕
  ring?: boolean;
  star?: number;           // 星芒大小再乘几（大招终结那一下一堆人同时挨打，星芒收小，不抢 X 形新月的戏）
  white?: number;          // 闪白多亮（默认 1）
}
export function strike(ctx: FxCtx, t: LabActor, o: StrikeOpts) {
  const K = kit(), p = o.power ?? 1, hero = t.isHero;
  const c = chest(t, hero ? 0.5 : 0.55), d = vec(o.dir.x, 0, o.dir.z).normalize();
  t.hit(o.white ?? 1);
  ctx.hitstop(o.stop ?? (hero ? 0.05 : 0.03) * Math.min(1.4, p));
  ctx.shake(o.shake ?? 0.1 * p, 0.14 + 0.06 * p);
  K.stars.add({ pos: c, size: (hero ? 2.3 : 1.6) * p * (o.star ?? 1), life: 0.2 + 0.04 * p, rot: Math.atan2(d.z, d.x) + 0.3 });
  K.stars.add({ pos: c, size: t.height * 0.65 * Math.min(1.15, p) * (o.star ?? 1), life: 0.08, kind: 4 });      // 返工：一团柔光，直径约身高的 1.3 倍（1.5 倍在亮地面上像一团粉雾），闪 0.08 秒
  K.sparks.add({ pos: c, n: Math.round(12 * p), dir: vec(d.x, 0.25, d.z), spread: 0.75, speed: [7, 16 * Math.min(1.3, p)], life: [0.12, 0.3], size: [0.06, 0.11], gravity: 0.8, drag: 3, stretch: 0.045 });
  K.sparks.add({ pos: c, n: Math.round(3 * p), dir: vec(d.x, 0.6, d.z), spread: 1.0, speed: [3, 7], life: [0.25, 0.45], size: [0.16, 0.24], kind: 1, gravity: 1.2, drag: 2 });
  if (o.ring !== false) K.rings.add({ x: t.obj.position.x, z: t.obj.position.z, rMax: (hero ? 1.9 : 1.3) * Math.sqrt(p), life: 0.26, thick: 0.55, r0: 0.3 });
  let mark = -1;
  if (o.mark) {      // 刀痕：顺着刀路、斜着划过身子的一道，和穿过去的刀气交成一个锐利的 X
    const side = vec(-d.z, 0, d.x), tilt = o.mark.tilt ?? 0.55, len = (o.mark.len ?? (hero ? 1.05 : 0.7));
    const ax = d.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(side, Math.sin(tilt)).normalize();
    const a = c.clone().addScaledVector(ax, -len).add(vec(0, 0.45 * len, 0)), b = c.clone().addScaledVector(ax, len).add(vec(0, -0.4 * len, 0));
    mark = K.lines.add({ a, b, width: hero ? 0.34 : 0.26, life: o.mark.life, reveal: 0.035, collapse: o.mark.collapse ?? 0.1, thread: o.mark.thread ?? 0.1, ignite: o.mark.ignite });
  }
  return { center: c, mark };
}

/** 往一个点聚的光：一圈小光点从半径 r 飞向中心（蓄力“光往刀上聚”） */
export function converge(center: V3, r: number, n: number, dur: number, size = 0.12) {
  const K = kit();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.4, y = (Math.random() - 0.3) * r * 0.6;
    const p = vec(center.x + Math.cos(a) * r, center.y + y, center.z + Math.sin(a) * r);
    const v = vec(center.x - p.x, center.y - p.y, center.z - p.z).multiplyScalar(1 / dur);
    K.sparks.add({ pos: p, n: 1, dir: v, spread: 0.0, speed: [v.length(), v.length()], life: [dur, dur], size: [size, size * 1.4], gravity: 0, drag: 0.01, stretch: 0.06, delay: Math.random() * dur * 0.3 });
  }
}
