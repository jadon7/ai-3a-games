// Q · 三叠斩（三段）。分镜（每段自己的时间，秒）：
//   一、二段（0.24 秒）：
//     0.00  起手：身子一沉，刀上一点光（蓄），脚下的光往里收一下
//     0.05  冲出去：0.14 秒冲 4 米（先快后慢）；身后每 0.03 秒留一个绯红残影；身边五六道细速度线往后刷；身后拉一道长刀气当拖尾
//     0.07  一道横切的新月刀气在身前扫开（一段从右往左、二段从左往右，略带倾斜）
//     路上  打中的人：闪白、顿帧、星芒、火花、刀痕
//   三段（0.62 秒）：
//     0.00  起手：蹲得更低，脚下光往里收，刀上光点
//     0.05  起跳：脚下一圈、残影；0.27 秒腾空 5 米，翻一个前空翻，一弯竖着的新月刀气跟着翻身从背后劈到身前
//     0.32  落地下劈：顿帧 0.07、镜头抖；一道竖直劈下的光；落点大星芒；地上：3 米的范围整片亮一下（边线最亮）、
//           两圈有厚度的冲击波推到 3 米边、一圈带高度的冲击墙、地裂（白热 → 绯红 → 冷成暖褐的疤）；碎石、碎片、火花；
//           3 米内的人一起闪白、星芒、刀痕（3 米外的那个小兵不受伤——范围一眼看得出）
import * as THREE from "three";
import type { Demo } from "../api";
import { chest, kit, sequence, vec, type V3 } from "./kit";
import { converge, strike } from "./hit";

const P0 = vec(-7.6, 0, 1.6), P1 = vec(-3.8, 0, 0.6), P2 = vec(0.1, 0, 1.5), P3 = vec(5.0, 0, 1.0), SLAM_R = 3;
// 靶子摆位（targets 下标 → 位置）：一段砍小兵，二段砍托尔格，三段落点 3 米内摩珂和两个小兵，3 米外放一个小兵对照
const SPOT: Record<number, [number, number]> = { 5: [-5.7, 1.1], 1: [-1.8, 1.05], 0: [6.3, 2.2], 2: [3.6, -0.8], 3: [6.9, -0.6], 4: [2.4, 3.9] };

interface Motion { t0: number; dur: number; from: THREE.Vector3; to: THREE.Vector3; h: number; flip: boolean; lastGhost: number }

export const q: Demo = {
  label: "Q · 三叠斩", duration: 2.3,
  setup(_ctx, cast, targets) {
    for (const [i, [x, z]] of Object.entries(SPOT)) { const t = targets[+i]; if (t) { t.setPos(x, z); t.faceTo(P1.x, P1.z); } }
    cast.setPos(P0.x, P0.z); cast.faceTo(P1.x, P1.z);
  },
  run(ctx, cast, targets) {
    const K = kit(), lite = ctx.lite, ev: [number, () => void][] = [];
    let mo: Motion | null = null;
    const ease = (k: number) => 1 - Math.pow(1 - k, 3);
    const model = cast.hero.model, PIV = 1.45;
    const setFlip = (th: number) => { model.rotation.x = th; model.position.set(0, PIV - PIV * Math.cos(th), -PIV * Math.sin(th)); };

    function dash(t0: number, from: V3, to: V3, seg: number) {
      const dir = vec(to.x - from.x, 0, to.z - from.z), len = dir.length(); dir.normalize();
      const yaw = Math.atan2(dir.x, dir.z), side = vec(-dir.z, 0, dir.x), DUR = 0.14, W = 0.05;
      ev.push([t0, () => {
        cast.faceTo(to.x, to.z); cast.play(seg === 0 ? "attack1" : "attack2", { loop: false, fade: 0.02, speed: 2.4 });
        K.rings.add({ x: from.x, z: from.z, rMax: 1.7, r0: 0.3, life: 0.06, kind: 1, thick: 0.6, ease: 0 });
        const h = vec(); if (cast.hero.blade("R", vec(), h)) K.stars.add({ pos: h, size: 0.9, life: 0.08, kind: 2 });
      }]);
      ev.push([t0 + W, () => {
        mo = { t0: t0 + W, dur: DUR, from: vec(from.x, 0, from.z), to: vec(to.x, 0, to.z), h: 0, flip: false, lastGhost: -1 };
        K.rings.add({ x: from.x, z: from.z, rMax: 1.5, life: 0.22, thick: 0.45 });
        // 拖尾：身后一道长刀气，头跟着人走（和人用同一条先快后慢的曲线）
        K.lines.add({ a: vec(from.x - dir.x * 0.4, 1.05, from.z - dir.z * 0.4), b: vec(to.x + dir.x * 0.6, 1.05, to.z + dir.z * 0.6), width: 0.8, life: DUR + 0.22, reveal: DUR, collapse: DUR + 0.03, thread: 0 });
        // 速度线
        for (let i = 0; i < (lite ? 3 : 6); i++) {
          const off = (i % 2 ? 1 : -1) * (0.55 + 0.25 * i), y = 0.35 + ((i * 0.37) % 1) * 1.9, L = 2.2 + ((i * 0.61) % 1) * 1.8, at = 0.25 + ((i * 0.43) % 1) * 0.55;
          const c = vec(from.x + dir.x * len * at, y, from.z + dir.z * len * at).addScaledVector(side, off);
          K.lines.add({ a: c.clone().addScaledVector(dir, -L * 0.7), b: c.clone().addScaledVector(dir, L * 0.3), width: 0.13 + 0.05 * (i % 3), life: 0.16, reveal: 0.05, kind: 1, collapse: 0.07, thread: 0, delay: 0.01 * i });
        }
      }]);
      // 横切的新月（返工，照澜二技能那一大弯）：弧长约 4.8 米（半径 2 米、张 137 度）、最宽处 1 米，0.07 秒扫开，整弯停 0.22 秒再收；弧的中点压在冲刺路的中段
      ev.push([t0 + W + 0.03, () => {
        const R = 2.0, back = len * 0.5 - R * 0.8, c = vec(from.x + dir.x * back, 1.15, from.z + dir.z * back), sw = seg === 0;
        K.crescent({ pos: c, yaw, tilt: sw ? 0.2 : -0.2, r: R, width: 1.0, edgeW: 1.3, a0: Math.PI / 2 + (sw ? 1.2 : -1.2), a1: Math.PI / 2 + (sw ? -1.2 : 1.2), sweep: 0.07, hold: 0.22, linger: 0.16, tail: 1.04, sym: true, glow: 1.1 });
      }]);
      // 路上打中的人（按投影位置算到达时间）
      for (const t of targets) {
        if (!t.obj.visible) continue;
        const rel = vec(t.obj.position.x - from.x, 0, t.obj.position.z - from.z), along = rel.dot(dir), off = Math.abs(rel.dot(side));
        if (along < -0.3 || along > len + 0.8 || off > 1.4) continue;
        const e = THREE.MathUtils.clamp(along / len, 0, 1), k = 1 - Math.cbrt(1 - e);
        ev.push([t0 + W + DUR * k, () => strike(ctx, t, { dir, power: t.isHero ? 1.1 : 0.8, mark: { life: 0.42, collapse: 0.12, thread: 0 } })]);
      }
      ev.push([t0 + W + DUR + 0.01, () => { K.rings.add({ x: to.x, z: to.z, rMax: 1.2, life: 0.2, thick: 0.4, alpha: 0.7 }); }]);
    }

    function slam(t0: number, from: V3, to: V3) {
      const dir = vec(to.x - from.x, 0, to.z - from.z); dir.normalize();
      const yaw = Math.atan2(dir.x, dir.z), AIR = 0.27;
      ev.push([t0, () => {
        cast.faceTo(to.x, to.z); cast.play("attack2", { loop: false, fade: 0.02, speed: 1.6 });
        K.rings.add({ x: from.x, z: from.z, rMax: 2.3, r0: 0.3, life: 0.07, kind: 1, thick: 0.8, ease: 0 });
        converge(chest(cast, 0.45), 1.3, lite ? 4 : 7, 0.06, 0.09);
      }]);
      ev.push([t0 + 0.05, () => {
        mo = { t0: t0 + 0.05, dur: AIR, from: vec(from.x, 0, from.z), to: vec(to.x, 0, to.z), h: 2.6, flip: true, lastGhost: -1 };
        K.rings.add({ x: from.x, z: from.z, rMax: 1.9, life: 0.26, thick: 0.6 });
        K.ghosts.spawn({ life: 0.22, alpha: 0.7, white: 0.4 });
        // 竖着的新月：在跳跃这条弧的竖直平面里，从背后翻过头顶劈到身前地上（roll=90° 让圆弧立起来：角度 0 朝上、+90° 朝前）
        const mid = vec((from.x + to.x) / 2, 1.5, (from.z + to.z) / 2);
        K.crescent({ pos: mid, yaw, roll: Math.PI / 2, r: 2.75, width: 1.05, a0: -2.1, a1: 2.75, sweep: AIR, linger: 0.2, tail: 0.7, glow: 1.2 });
      }]);
      ev.push([t0 + 0.05 + AIR, () => {
        mo = null; cast.setPos(to.x, to.z); setFlip(0); cast.play("r_end", { loop: false, fade: 0, speed: 1.4 });
        ctx.hitstop(0.075); ctx.shake(0.42, 0.36);
        const c = vec(to.x, 0, to.z);
        K.lines.add({ a: vec(to.x + dir.x * 0.6, 5.5, to.z + dir.z * 0.6), b: vec(to.x, 0.0, to.z), width: 0.9, life: 0.16, reveal: 0.025, collapse: 0.06, thread: 0 });
        K.stars.add({ pos: vec(to.x, 0.9, to.z), size: 3.6, life: 0.24, kind: 1 });
        K.rings.add({ x: c.x, z: c.z, rMax: SLAM_R, life: 0.34, kind: 2, alpha: 0.85 });                                    // 范围整片亮一下
        K.rings.add({ x: c.x, z: c.z, rMax: SLAM_R, r0: 0.3, life: 0.26, thick: 1.5 });
        K.rings.add({ x: c.x, z: c.z, rMax: SLAM_R + 0.25, r0: 0.3, life: 0.34, thick: 0.5, delay: 0.05, alpha: 0.8 });
        K.wall({ x: c.x, z: c.z, r0: 0.6, r1: SLAM_R, h: 1.5, life: 0.34 });
        K.decal({ tex: "crack", x: c.x, z: c.z, r: SLAM_R * 1.15, life: 1.6, grow: 0.12, rot: yaw, glow: [2.2, 0.6, 0], dark: [0.62, 0.5, 0.25] });
        K.sparks.add({ pos: vec(c.x, 0.4, c.z), n: 30, speed: [7, 16], life: [0.2, 0.45], size: [0.07, 0.13], up: 0.35, gravity: 0.8, drag: 2.4 });
        K.sparks.add({ pos: vec(c.x, 0.3, c.z), n: 8, speed: [3, 7], life: [0.4, 0.55], size: [0.12, 0.22], kind: 3, up: 1.2, gravity: 2.2, drag: 0.8 });
        K.sparks.add({ pos: vec(c.x, 0.6, c.z), n: 8, speed: [4, 9], life: [0.35, 0.6], size: [0.2, 0.32], kind: 1, up: 0.6, gravity: 1, drag: 1.6 });
        K.sparks.add({ pos: vec(c.x, 0.3, c.z), n: 10, speed: [1, 3], life: [0.7, 1.2], size: [0.1, 0.18], kind: 2, up: 0.8, gravity: -0.1, drag: 1.2, jitter: 0.2 });
        for (const t of targets) {
          if (!t.obj.visible) continue;
          const d = Math.hypot(t.obj.position.x - c.x, t.obj.position.z - c.z); if (d > SLAM_R + t.radius * 0.5) continue;
          ev2.push([0.015 + d * 0.02, () => strike(ctx, t, { dir: vec(t.obj.position.x - c.x, 0, t.obj.position.z - c.z), power: t.isHero ? 1.25 : 0.9, stop: 0, shake: 0, mark: { life: 0.45, collapse: 0.14, thread: 0, tilt: 1.2 } })]);
        }
      }]);
    }
    // 落地以后按距离依次命中（相对落地时刻）：放在第二个列表里，落地那一下再排进时间轴
    const ev2: [number, () => void][] = [];

    dash(0.0, P0, P1, 0);
    dash(0.55, P1, P2, 1);
    slam(1.12, P2, P3);
    const tLand = 1.12 + 0.05 + 0.27;
    const seq = sequence(ev, 2.3, () => setFlip(0), (t) => {
      if (ev2.length) { const list = ev2.splice(0); for (const [dt, fn] of list) pending.push([tLand + dt, fn]); }
      for (let i = pending.length - 1; i >= 0; i--) if (pending[i][0] <= t) { const fn = pending[i][1]; pending.splice(i, 1); fn(); }
      if (!mo) return;
      const m = mo as Motion, k = THREE.MathUtils.clamp((t - m.t0) / m.dur, 0, 1), e = m.flip ? k : ease(k);
      const x = m.from.x + (m.to.x - m.from.x) * e, z = m.from.z + (m.to.z - m.from.z) * e, y = m.h * 4 * k * (1 - k);
      cast.setPos(x, z, y);
      if (m.flip) setFlip(Math.PI * 2 * (k * k * (3 - 2 * k)));
      if (t - m.lastGhost > (m.flip ? 0.045 : 0.03) && k < 1) { m.lastGhost = t; K.ghosts.spawn({ life: m.flip ? 0.22 : 0.2, alpha: m.flip ? 0.6 : 0.75, white: 0.15 }); }
    });
    const pending: [number, () => void][] = [];
    return seq;
  },
};
