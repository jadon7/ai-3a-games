import * as THREE from 'three';
import type { MoveDef } from '../combat/types';
import type { FighterView } from '../present/fighterView';
import { dust, groundSlam, PAL } from './common';
import type { Fx } from './core';
import type { FighterFx, FxCtx, ProjectileFx } from './types';
import { FireKit, rnd, smoothstep } from './yanjin_lib';

// ─────────────────────────────────────────────────────────────────────────────
// 阎烬 · 余烬之火。写实的火：噪声侵蚀的火舌、黑烟、余烬火星、瞬时点光、地面焦痕。
// 配色：暖白偏黄的芯 → 橙 → 深红 → 黑烟。
// ─────────────────────────────────────────────────────────────────────────────

const P = PAL.fire;
const EMBER = 0xffb050, EMBER2 = 0xff3c08, SOOT = 0x1a120e, SNOW = 0xc9d4e0;
type Light = ReturnType<Fx['flashLight']>;

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

/** 拳面：腕 + 前臂方向往外延一点 */
function fist(self: FighterView, side: 'R' | 'L', out: THREE.Vector3) {
  self.rig.boneWorld(side === 'R' ? 'RightForeArm' : 'LeftForeArm', _d);
  self.rig.boneWorld(side === 'R' ? 'RightHand' : 'LeftHand', out);
  return out.add(_c.subVectors(out, _d).multiplyScalar(0.35));
}
/** 前臂上的随机一点（铁箍的位置：肘到腕之间偏腕） */
function forearm(self: FighterView, side: 'R' | 'L', out: THREE.Vector3) {
  self.rig.boneWorld(side === 'R' ? 'RightForeArm' : 'LeftForeArm', _d);
  self.rig.boneWorld(side === 'R' ? 'RightHand' : 'LeftHand', out);
  return out.lerp(_d, rnd(0.05, 0.6));
}

/** 出这些招时，前臂铁箍“烧起来”的帧区间和哪只手 */
const BURN: Record<string, { f0: number; f1: number; arms: ('R' | 'L')[] }> = {
  light3: { f0: 4, f1: 20, arms: ['R'] },
  heavy: { f0: 5, f1: 28, arms: ['R'] },
  lunge: { f0: 3, f1: 22, arms: ['L', 'R'] },
  launcher: { f0: 2, f1: 22, arms: ['R'] },
  grab: { f0: 18, f1: 62, arms: ['R', 'L'] },
  sp1: { f0: 3, f1: 34, arms: ['R'] },
  sp2: { f0: 3, f1: 34, arms: ['R'] },
  sp3: { f0: 3, f1: 40, arms: ['R'] },
  ult: { f0: 0, f1: 78, arms: ['R', 'L'] },
};

export default function createYanjinFx(ctx: FxCtx): FighterFx {
  const fx = ctx.fx;
  const kit = new FireKit(ctx);

  // 每招的状态
  let prevMove: MoveDef | null = null, prevMf = -1;
  let idleT = rnd(0.4, 1.2);
  let burnAcc = 0, handLight: Light | null = null;
  let cine = false;
  let strip: ReturnType<FireKit['strip']> | null = null, stripX0 = 0;
  let helix: ReturnType<FireKit['helix']> | null = null, helixY0 = 0, helixH = 1;
  let lineX = 0, crawlAcc = 0;

  // ───────── 公共小件 ─────────
  const embers = (pos: THREE.Vector3 | [number, number, number], n: number, spread: number, up = 1, k = 1) =>
    fx.emit({ kind: 'dot', count: n, pos, spread, dir: [0, 1, 0], cone: 1.1, speed: [0.6 * k, 3.2 * k * up], life: [0.7, 1.8], size: [0.014, 0.034], color: EMBER, color2: EMBER2, intensity: 4.2, gravity: -1.4 * up, drag: 1.3, turb: 6 });
  const smoke = (pos: THREE.Vector3 | [number, number, number], n: number, size: number, rise = 1, life = 1.4) =>
    fx.emit({ kind: 'smoke', count: n, pos, spread: size * 0.35, dir: [0, 1, 0], cone: 0.8, speed: [0.3 * rise, 1.4 * rise], life: [life * 0.6, life], size: [size * 0.6, size], grow: 2.3, color: SOOT, alpha: 0.62, gravity: -0.7 * rise, drag: 1.4, spin: 0.7 });

  /** 一股顺着方向喷出去的火（锥形火舌 + 火星 + 烟）。 */
  const jet = (pos: THREE.Vector3, dir: THREE.Vector3, s: number, life = 0.34, delay = 0) => {
    const d = dir.clone().normalize();
    kit.sheet({ pos: pos.clone(), axis: d, len: 1.7 * s, width: 0.8 * s, life, power: 2.3, taper: 0.12, turb: 1.0, speed: 2.4, grow: 0.16, soft: 0.06, delay });
    kit.sheet({ pos: pos.clone().addScaledVector(d, 0.1), axis: d.clone().add(_a.set(0, rnd(0.15, 0.4), rnd(-0.3, 0.3))), len: 1.15 * s, width: 0.5 * s, life: life * 0.8, power: 2.2, taper: 0.1, turb: 1.1, speed: 2.8, grow: 0.2, delay: delay + 0.02 });
    kit.sheet({ pos: pos.clone().addScaledVector(d, 0.1), axis: d.clone().add(_a.set(0, -rnd(0.1, 0.35), rnd(-0.3, 0.3))), len: 1.0 * s, width: 0.45 * s, life: life * 0.75, power: 2.1, taper: 0.1, turb: 1.1, speed: 2.8, grow: 0.2, delay: delay + 0.035 });
    // 里面一条短而热的芯
    kit.sheet({ pos: pos.clone(), axis: d, len: 0.85 * s, width: 0.36 * s, life: life * 0.55, power: 2.2, heat: 1.1, taper: 0.2, turb: 0.6, speed: 3, grow: 0.12, delay });
    const dd: [number, number, number] = [d.x, d.y, d.z];
    fx.emit({ kind: 'spark', count: Math.round(18 * s), pos, dir: dd, cone: 0.45, speed: [5 * s, 13 * s], life: [0.18, 0.45], size: [0.025, 0.05], color: P.core, color2: P.mid, intensity: 3.2, gravity: 6, drag: 2.2, bounce: 0.3 });
    fx.emit({ kind: 'dot', count: Math.round(14 * s), pos: pos.clone().addScaledVector(d, 0.6 * s), spread: 0.3 * s, dir: [d.x, d.y + 0.6, d.z], cone: 0.9, speed: [1, 4 * s], life: [0.6, 1.5], size: [0.014, 0.032], color: EMBER, color2: EMBER2, intensity: 4.2, gravity: -1.2, drag: 1.5, turb: 6 });
    fx.after(delay + life * 0.45, () => smoke(pos.clone().addScaledVector(d, 1.1 * s), Math.round(2 + 2 * s), 0.55 * s, 0.8, 1.3));
  };

  /** 爆炸：火球长大冷却成黑烟、放射的火舌、烟蘑菇、四溅落地反弹的火星、焦痕、点光。 */
  const explode = (p: THREE.Vector3, s: number, dirX = 0) => {
    const pos = p.clone(); pos.z = 0.15;
    kit.burst(pos, 0.7 * s, 2.4 * s, 0.75 * Math.sqrt(s), 2.4, dirX * 0.3);
    kit.burst(pos.clone().add(_a.set(rnd(-0.3, 0.3) * s + dirX * 0.3 * s, rnd(0.1, 0.35) * s, 0.05)), 0.5 * s, 1.6 * s, 0.6 * Math.sqrt(s), 2.2, 0, 0.05);
    kit.burst(pos.clone().add(_a.set(rnd(-0.4, 0.4) * s, rnd(-0.2, 0.1) * s, 0.1)), 0.4 * s, 1.3 * s, 0.5 * Math.sqrt(s), 2.2, 0, 0.09);
    const n = 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rnd(-0.3, 0.3);
      const ax = V(Math.cos(a) + dirX * 0.6, Math.sin(a) * 0.9 + 0.25, rnd(-0.4, 0.4));
      kit.sheet({ pos, axis: ax, len: rnd(0.8, 1.5) * s, width: 0.48 * s, life: rnd(0.26, 0.4), power: 2.2, taper: 0.1, turb: 1.2, speed: 2.4, grow: 0.15, delay: rnd(0, 0.04) });
    }
    // 烟蘑菇：柱 + 顶上横着散开的帽
    fx.emit({ kind: 'smoke', count: Math.round(5 * s), pos, spread: 0.3 * s, dir: [0, 1, 0], cone: 0.35, speed: [1.2 * s, 2.8 * s], life: [1.2, 2.0], size: [0.5 * s, 0.8 * s], grow: 2.4, color: SOOT, alpha: 0.6, gravity: -0.4, drag: 1.8, spin: 0.6 });
    fx.after(0.16, () => fx.emit({ kind: 'smoke', count: Math.round(9 * s), pos: [pos.x, pos.y + 0.95 * s, 0], spread: [0.5 * s, 0.2 * s, 0.3], dir: [0, 0.4, 0], cone: 1.4, speed: [0.5, 1.6 * s], life: [1.4, 2.3], size: [0.7 * s, 1.1 * s], grow: 2.2, color: SOOT, alpha: 0.5, gravity: -0.5, drag: 1.4, spin: 0.5 }));
    fx.emit({ kind: 'spark', count: Math.round(30 * s), pos, speed: [4 * s, 11 * s], life: [0.35, 1.0], size: [0.025, 0.05], color: P.core, color2: P.mid, intensity: 3.4, gravity: 10, drag: 1.1, bounce: 0.4 });
    fx.emit({ kind: 'dot', count: Math.round(30 * s), pos, spread: 0.4 * s, speed: [1, 5 * s], life: [0.8, 2.0], size: [0.014, 0.034], color: EMBER, color2: EMBER2, intensity: 4.2, gravity: -1, drag: 1.4, turb: 6 });
    if (p.y < 2.4) fx.decal(p.x, 0, 1.9 * s, 0, P.mid, P.core, 6);
    fx.airRing(pos, 3.2 * s, P.hot, P.deep, { life: 0.3, power: 1.1, width: 0.04 });
    ctx.gfx.shockRing(pos, 0.028 * s, 1.4, 0.42);
    fx.flashLight(pos, P.light, 45 * s, 9, 0.4);
    ctx.cam.addShake(0.25 * s);
  };

  /** 地面火柱：几片火舌叠成一根（有主有次），根部碎石和雪、上面黑烟，灭了以后留几处小火苗。 */
  const pillarAt = (x: number, big: number, dir: number) => {
    const z = rnd(-0.2, 0.2);
    const H = rnd(1.5, 2.8) * big, W = rnd(0.75, 1.15) * Math.sqrt(big);
    const life = rnd(0.55, 0.75);
    const base = V(x, 0, z);
    kit.sheet({ pos: base, axis: V(rnd(-0.08, 0.08) + dir * 0.05, 1, 0), len: H, width: W, life, power: 2.3, taper: 0.14, turb: 1.0, speed: 2.6, grow: 0.12, soft: 0.04 });
    kit.sheet({ pos: base.clone().add(_a.set(rnd(-0.22, 0.22), 0, 0.1)), axis: V(rnd(-0.25, 0.25), 1, 0), len: H * rnd(0.5, 0.75), width: W * 0.65, life: life * 0.85, power: 2.2, taper: 0.1, turb: 1.2, speed: 2.8, grow: 0.15, delay: rnd(0.02, 0.06) });
    kit.sheet({ pos: base.clone().add(_a.set(rnd(-0.25, 0.25), 0, -0.1)), axis: V(rnd(-0.3, 0.3), 1, 0), len: H * rnd(0.35, 0.6), width: W * 0.55, life: life * 0.8, power: 2.2, taper: 0.1, turb: 1.2, speed: 2.8, grow: 0.15, delay: rnd(0.04, 0.09) });
    kit.sheet({ pos: base.clone().add(_a.set(0, 0, 0.05)), axis: V(0, 1, 0), len: H * 0.5, width: W * 0.45, life: life * 0.6, power: 2.0, heat: 1.15, taper: 0.25, turb: 0.8, speed: 3.2, grow: 0.1 });
    kit.burst(V(x, 0.3, z + 0.1), 0.35, 1.0 * big, 0.45, 1.6, 0);
    kit.debris(x, 0, z, 4, 0.8, 0, 0.1, 1.3);
    fx.emit({ kind: 'flake', count: 8, pos: [x, 0.05, z], spread: [0.3, 0.02, 0.3], dir: [0, 1, 0], cone: 0.9, speed: [2, 5], life: [0.4, 0.8], size: [0.02, 0.05], color: 0xeaf4ff, intensity: 1, gravity: 9, spin: 8 });
    fx.emit({ kind: 'smoke', count: 3, pos: [x, 0.1, z], spread: [0.3, 0.05, 0.2], dir: [0, 0.3, 0], cone: 1.4, speed: [0.8, 2.2], life: [0.5, 0.9], size: [0.3, 0.5], grow: 2.4, color: SNOW, alpha: 0.22, drag: 2.5 });
    fx.emit({ kind: 'dot', count: 16, pos: [x, H * 0.4, z], spread: [0.3, H * 0.35, 0.3], dir: [0, 1, 0], cone: 0.5, speed: [2, 6], life: [0.7, 1.6], size: [0.015, 0.035], color: EMBER, color2: EMBER2, intensity: 4.2, gravity: -0.8, drag: 1.2, turb: 7 });
    fx.after(life * 0.5, () => smoke([x, H * 0.85, z], 3, 0.7, 1, 1.6));
    fx.decal(x, z, rnd(1.2, 1.6), 0, P.mid, P.core, 6);
    fx.flashLight([x, 0.9, 0.4], P.light, 26 * big, 6, 0.32);
    // 灭了以后地上留着的小火苗
    fx.after(life * 0.7, () => {
      const m = 1 + (Math.random() < 0.6 ? 1 : 0);
      for (let i = 0; i < m; i++) {
        const fx0 = x + rnd(-0.35, 0.35);
        kit.sheet({ pos: V(fx0, 0, z + rnd(-0.15, 0.25)), axis: V(rnd(-0.1, 0.1), 1, 0), len: rnd(0.3, 0.5), width: rnd(0.32, 0.45), life: rnd(1.1, 1.9), power: 1.9, taper: 0.2, turb: 1.4, speed: 1.8, grow: 0.25, fadeIn: 0.15, erode: 0.8 });
      }
    });
  };

  /** 汇聚到手上的余烬（蓄力） */
  const gather = (self: FighterView, side: 'R' | 'L', waves: number, dur: number, r0 = 0.8, r1 = 1.4) => {
    for (let w = 0; w < waves; w++) fx.after((w / waves) * dur, () => {
      const p = fist(self, side, _a);
      for (let i = 0; i < 7; i++) {
        const a = Math.random() * 6.283, r = rnd(r0, r1), z = rnd(-0.4, 0.4);
        const sx = p.x + Math.cos(a) * r, sy = Math.max(0.1, p.y + Math.sin(a) * r * 0.8), life = rnd(0.2, 0.28);
        const vx = (p.x - sx) / life, vy = (p.y - sy) / life, vz = (p.z - z) / life;
        fx.emit({ kind: i < 3 ? 'spark' : 'dot', count: 1, pos: [sx, sy, z], dir: [vx, vy, vz], cone: 0.02, speed: [Math.hypot(vx, vy, vz) * 0.95, Math.hypot(vx, vy, vz)], life: [life, life], size: i < 3 ? [0.02, 0.035] : [0.018, 0.03], color: EMBER, color2: P.core, intensity: 3.6 });
      }
    });
  };

  const ult = { light: null as Light | null };
  /** 跟着飞行道具走的长寿命灯：回合重置时要关掉 */
  const liveLights = new Set<Light>();

  return {
    // ───────────────────────────── 每帧 ─────────────────────────────
    update(sdt, self, _opp, _ctx) {
      const f = self.fighter, mv = f.move, mf = f.mf, dir = f.facing;
      if (mv !== prevMove || mf < prevMf) { prevMf = -1; prevMove = mv; }
      const crossed = (n: number) => prevMf < n && mf >= n;

      // 常驻：站着时铁箍缝里偶尔飘起一两颗火星
      idleT -= sdt;
      if (idleT <= 0) {
        idleT = rnd(0.25, 0.8);
        const side = Math.random() < 0.5 ? 'R' : 'L';
        const p = forearm(self, side, _a);
        fx.emit({ kind: 'dot', count: Math.random() < 0.35 ? 2 : 1, pos: p, spread: 0.04, dir: [0, 1, 0], cone: 0.7, speed: [0.25, 0.8], life: [1.2, 2.2], size: [0.024, 0.04], color: EMBER, color2: EMBER2, intensity: 5, gravity: -0.45, drag: 0.8, turb: 2.5 });
        // 铁箍缝里一闪的暗红光
        if (Math.random() < 0.3) fx.emit({ kind: 'glow', count: 1, pos: p, size: [0.12, 0.18], life: [0.25, 0.45], color: P.hot, color2: P.deep, intensity: 0.8, alpha: 0.7 });
      }

      // 出重招时铁箍“烧起来”：前臂附着火舌 + 一盏跟着手走的小橙光
      const b = mv ? BURN[mv.id] : undefined;
      const burning = cine || (b && mf >= b.f0 && mf <= b.f1);
      if (burning) {
        const arms = cine ? (['R', 'L'] as const) : b!.arms;
        burnAcc += sdt * 70;
        while (burnAcc >= 1) {
          burnAcc -= 1;
          const side = arms[(Math.random() * arms.length) | 0];
          const p = forearm(self, side, _a);
          fx.emit({ kind: 'flame', count: 1, pos: p, spread: 0.04, dir: [0, 1, 0], cone: 0.5, speed: [0.3, 1.2], life: [0.16, 0.3], size: [0.12, 0.24], grow: 1.5, color: P.hot, color2: P.deep, intensity: 1.9, gravity: -3.2, drag: 2, spin: 2 });
          if (Math.random() < 0.18) fx.emit({ kind: 'dot', count: 1, pos: p, spread: 0.05, dir: [0, 1, 0], cone: 0.9, speed: [0.5, 2], life: [0.5, 1.1], size: [0.012, 0.026], color: EMBER, color2: EMBER2, intensity: 4.2, gravity: -1.4, drag: 1.4, turb: 5 });
        }
        const hp = fist(self, arms[0], _b);
        if (!handLight || handLight.age >= handLight.life) handLight = fx.flashLight(hp, P.light, 7, 3.5, 0.2);
        handLight.light.position.set(hp.x, hp.y, hp.z + 0.4); handLight.age = 0; handLight.life = 0.2; handLight.peak = 6 + Math.random() * 2.5;
      } else { burnAcc = 0; handLight = null; }

      if (mv) {
        const id = mv.id;
        // 隔空崩拳蓄力：拳头越来越亮
        if (id === 'sp1' && mf >= 3 && mf < 18) {
          const k = (mf - 3) / 15, p = fist(self, 'R', _a);
          fx.emit({ kind: 'glow', count: 1, pos: p, size: [0.25 + 0.4 * k, 0.3 + 0.45 * k], life: [0.05, 0.06], color: P.core, color2: P.hot, intensity: 0.5 + 1.1 * k });
          if (handLight) handLight.peak = 8 + 22 * k;
        }
        if (id === 'sp3' && mf >= 4 && mf < 22) {
          const k = (mf - 4) / 18, p = fist(self, 'R', _a);
          fx.emit({ kind: 'glow', count: 1, pos: p, size: [0.25 + 0.3 * k, 0.3 + 0.35 * k], life: [0.05, 0.06], color: P.core, color2: P.hot, intensity: 0.5 + 0.9 * k });
          if (handLight) handLight.peak = 8 + 16 * k;
        }
        // 贴山靠：冲撞路径上的焦痕 + 脚下的火
        if (id === 'lunge') {
          if (crossed(3)) { stripX0 = f.x; lineX = f.x; strip = kit.strip(f.x - dir * 0.2, 0, 0.6, dir, 3.6, 1.4); }
          if (strip && mf <= 18) {
            strip.st.len = Math.abs(f.x - stripX0) + 0.45;
            while (mf <= 16 && Math.abs(f.x - lineX) >= 0.3) {
              lineX += dir * 0.3;
              const big = rnd(0.4, 1.0);
              if (Math.random() < 0.7) kit.sheet({ pos: V(lineX - dir * 0.25 + rnd(-0.08, 0.08), 0, rnd(-0.15, 0.15)), axis: V(-dir * rnd(0.3, 0.7), 1, 0), len: 0.45 * big, width: 0.36 * Math.sqrt(big), life: rnd(0.3, 0.6), power: 1.9, taper: 0.15, turb: 1.2, speed: 2.2, grow: 0.15, soft: 0.05, heat: 0.95 });
              fx.emit({ kind: 'dot', count: 2, pos: [lineX, 0.12, 0], spread: [0.12, 0.08, 0.12], dir: [-dir * 0.4, 1, 0], cone: 0.7, speed: [0.6, 2.2], life: [0.6, 1.3], size: [0.012, 0.028], color: EMBER, color2: EMBER2, intensity: 4.2, gravity: -1, drag: 1.4, turb: 6 });
            }
          }
          if (mf > 18) strip = null;
        }
        // 冲天炮：拳头上升路径上的螺旋火带
        if (id === 'launcher') {
          if (crossed(4)) {
            const p = fist(self, 'R', _a);
            helixY0 = Math.max(0.1, p.y - 0.25); helixH = 2.7 * f.scale;
            helix = kit.helix(p.x + dir * 0.05, 0, helixY0, helixH, 0.45, 2.1, 0.46, 0.8, dir, 2.2);
          }
          if (helix && mf <= 22) {
            const p = fist(self, 'R', _a);
            helix.st.reveal = Math.max(helix.st.reveal, Math.min(1, (p.y - helixY0) / helixH + 0.1));
          }
          if (helix && mf > 12) helix.st.reveal = Math.min(1, helix.st.reveal + sdt * 3);
          if (helix && mf <= 20 && helix.st.reveal < 1 && Math.random() < 0.6) {
            const sv = helix.st.reveal, ang = sv * 2.1 * Math.PI * 2 * dir, r = 0.45 * (1 - 0.35 * sv);
            const hp = _b.set(helix.h.mesh.position.x + Math.cos(ang) * r, helixY0 + sv * helixH, Math.sin(ang) * r);
            kit.sheet({ pos: hp.clone(), axis: V(0, 1, 0), len: rnd(0.35, 0.6), width: rnd(0.3, 0.4), life: rnd(0.22, 0.35), power: 1.9, taper: 0.12, turb: 1.2, speed: 2.6, grow: 0.15 });
            fx.emit({ kind: 'dot', count: 1, pos: hp, spread: 0.05, dir: [0, 1, 0], cone: 0.8, speed: [0.5, 2], life: [0.5, 1.0], size: [0.012, 0.026], color: EMBER, color2: EMBER2, intensity: 4.2, gravity: -1.4, drag: 1.4, turb: 5 });
          }
          if (mf > 30) helix = null;
        }
        // 扫堂腿：贴地一道扇形的火星和雪尘
        if (id === 'sweep' && crossed(9)) {
          const p = self.rig.limbWorld('RF', _a);
          for (let i = 0; i < 7; i++) {
            const t = i / 6, a = (-0.6 + 1.5 * t);
            const px = f.x + dir * Math.cos(a) * 1.05, pz = Math.sin(a) * 0.5;
            fx.emit({ kind: 'spark', count: 3, pos: [px, 0.08, pz], dir: [dir * Math.cos(a + 0.6), 0.25, Math.sin(a + 0.6)], cone: 0.35, speed: [3, 7], life: [0.18, 0.4], size: [0.02, 0.04], color: P.core, color2: P.mid, intensity: 3, gravity: 6, drag: 2.5, bounce: 0.3 });
            if (i % 2 === 0) kit.sheet({ pos: V(px, 0, pz), axis: V(dir * Math.cos(a + 0.9) * 0.9, 0.6, Math.sin(a + 0.9) * 0.6), len: rnd(0.35, 0.6), width: rnd(0.3, 0.42), life: rnd(0.25, 0.4), power: 1.8, taper: 0.12, turb: 1.3, speed: 2.4, grow: 0.15, soft: 0.05, delay: t * 0.06 });
          }
          dust(fx, p.x, 1.1, dir);
          fx.emit({ kind: 'dot', count: 14, pos: [p.x, 0.1, 0], spread: [0.6, 0.05, 0.3], dir: [dir, 1, 0], cone: 0.8, speed: [1, 3.5], life: [0.6, 1.3], size: [0.012, 0.028], color: EMBER, color2: EMBER2, intensity: 4, gravity: -0.8, drag: 1.5, turb: 6 });
        }
        // 飞踢：脚上拖火
        if (id === 'air' && mf >= 5 && mf <= 21) {
          const p = self.rig.limbWorld('RF', _a);
          fx.emit({ kind: 'flame', count: 2, pos: p, spread: 0.07, dir: [-dir, 0.4, 0], cone: 0.5, speed: [0.3, 1.2], life: [0.16, 0.3], size: [0.2, 0.34], grow: 1.5, color: P.hot, color2: P.deep, intensity: 2, gravity: -2.4, drag: 2, spin: 2 });
          if (Math.random() < 0.4) fx.emit({ kind: 'dot', count: 1, pos: p, spread: 0.06, speed: [0.3, 1.5], life: [0.5, 1.0], size: [0.012, 0.026], color: EMBER, color2: EMBER2, intensity: 4, gravity: -1, drag: 1.4, turb: 5 });
        }
        // 燎原冲拳：冲刺全程身后贴地燃烧的火线
        if (id === 'sp2') {
          if (strip && mf <= 22) {
            strip.st.len = Math.abs(f.x - stripX0) + 0.3;
            while (Math.abs(f.x - lineX) >= 0.26) {
              lineX += dir * 0.26;
              const big = Math.random() < 0.35 ? rnd(1.2, 1.6) : rnd(0.45, 1.0);
              kit.sheet({ pos: V(lineX + rnd(-0.08, 0.08), 0, rnd(-0.18, 0.18)), axis: V(-dir * rnd(0.15, 0.5), 1, 0), len: 0.62 * big, width: rnd(0.32, 0.5) * Math.sqrt(big), life: rnd(0.5, 1.1), power: 2.0, taper: 0.14, turb: 1.1, speed: 2.2, grow: 0.12, soft: 0.05, heat: rnd(0.85, 1.05) });
              fx.emit({ kind: 'dot', count: 3, pos: [lineX, 0.15, 0], spread: [0.15, 0.1, 0.15], dir: [-dir * 0.4, 1, 0], cone: 0.7, speed: [0.8, 3], life: [0.6, 1.4], size: [0.012, 0.03], color: EMBER, color2: EMBER2, intensity: 4.2, gravity: -1, drag: 1.4, turb: 6 });
            }
          }
          if (crossed(19)) {
            // 最后的上勾拳：一道向上的火弧
            self.chestWorld(_a);
            kit.arc(V(_a.x + dir * 0.15, _a.y - 0.2, 0.15), 1.15 * f.scale, -1.25, 1.45, dir, 0.45, 2.0, 0.42);
            fx.emit({ kind: 'spark', count: 16, pos: [_a.x + dir * 0.9, _a.y + 0.3, 0.1], dir: [dir * 0.5, 1, 0], cone: 0.5, speed: [4, 10], life: [0.2, 0.45], size: [0.025, 0.045], color: P.core, color2: P.mid, intensity: 3, gravity: 7, drag: 2 });
          }
          if (mf > 24) strip = null;
        }
        // 燎原冲拳的第一下打中：小爆燃
      }
      prevMf = mf;
    },

    onMoveStart(move, self, _opp, _ctx) {
      prevMove = move; prevMf = -1;
      if (move.id !== 'lunge' && move.id !== 'sp2') strip = null;
      if (move.id !== 'launcher') helix = null;
      void self;
    },

    // ───────────────────────────── 事件点 ─────────────────────────────
    onMoveEvent(move, ev, self, _opp, _ctx) {
      const f = self.fighter, x = f.x, dir = f.facing;
      if (ev.fx === 'charge') {
        if (move.id === 'sp1') {
          gather(self, 'R', 8, 0.24);
          // 脚下一圈热浪
          fx.groundRing(x, 0, 2.6, P.hot, P.deep, { life: 0.5, power: 1.1, width: 0.12 });
          ctx.gfx.shockRing(_a.set(x, 0.15, 0), 0.008, 0.9, 0.5, 0.05);
          for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2;
            fx.emit({ kind: 'flame', count: 1, pos: [x + Math.cos(a) * 0.55, 0.05, Math.sin(a) * 0.35], dir: [Math.cos(a) * 0.4, 1, 0], cone: 0.3, speed: [0.4, 1.0], life: [0.25, 0.4], size: [0.18, 0.3], grow: 1.5, color: P.hot, color2: P.deep, intensity: 1.5, gravity: -2.4, drag: 2, spin: 2 });
          }
          fx.emit({ kind: 'dot', count: 14, pos: [x, 0.1, 0], spread: [0.6, 0.05, 0.3], dir: [0, 1, 0], cone: 0.5, speed: [1, 3], life: [0.8, 1.5], size: [0.012, 0.028], color: EMBER, color2: EMBER2, intensity: 4, gravity: -0.6, drag: 1.2, turb: 5 });
        } else {
          gather(self, 'R', 7, 0.28, 0.6, 1.1);
          fx.groundRing(x, 0, 2.0, P.hot, P.deep, { life: 0.45, power: 0.9, width: 0.12 });
        }
      } else if (ev.fx === 'release') {
        const p = fist(self, 'R', _a).clone();
        const front = p.clone(); front.x += dir * 0.3; front.z = 0.15;
        fx.emit({ kind: 'glow', count: 1, pos: front, size: [0.8, 1.0], life: [0.06, 0.08], color: P.core, color2: P.hot, intensity: 1.0, grow: 1.5 });
        fx.airRing(front, 1.6, P.hot, P.deep, { life: 0.22, power: 1.0, width: 0.045 });
        fx.airRing(front.clone().setX(front.x + dir * 0.35), 1.0, P.core, P.hot, { life: 0.16, power: 0.9, width: 0.05 });
        ctx.gfx.shockRing(front, 0.032, 1.5, 0.38, 0.07);
        kit.sheet({ pos: p, axis: V(dir, 0.05, 0), len: 1.2, width: 0.7, life: 0.2, power: 2.4, taper: 0.2, turb: 0.8, speed: 3, grow: 0.1, soft: 0.04 });
        fx.emit({ kind: 'spark', count: 20, pos: front, dir: [dir, 0.05, 0], cone: 0.55, speed: [5, 13], life: [0.15, 0.35], size: [0.025, 0.045], color: P.core, color2: P.mid, intensity: 3.2, drag: 2.5 });
        smoke(p, 3, 0.45, 0.7, 1.1);
        fx.flashLight(front, P.light, 34, 8, 0.25);
        dust(fx, x - dir * 0.2, 1.0, -dir);
        ctx.cam.addShake(0.22); ctx.gfx.chroma(0.01);
      } else if (ev.fx === 'dash') {
        // 燎原冲拳起步
        stripX0 = x; lineX = x;
        strip = kit.strip(x - dir * 0.3, 0, 0.75, dir, 4.2, 2.0);
        dust(fx, x - dir * 0.2, 1.3, -dir);
        fx.emit({ kind: 'flame', count: 6, pos: [x - dir * 0.2, 0.15, 0], spread: [0.25, 0.1, 0.2], dir: [-dir, 0.6, 0], cone: 0.6, speed: [1, 3], life: [0.25, 0.45], size: [0.3, 0.55], grow: 1.6, color: P.hot, color2: P.deep, intensity: 2, gravity: -2, drag: 2.2, spin: 2 });
        fx.flashLight([x, 0.6, 0.4], P.light, 22, 6, 0.3);
        const col = 0xff5a1a;
        fx.ghost(self.rig.meshes, col, 0.36, 1.5);
        for (let i = 1; i <= 3; i++) fx.after(i * 0.06, () => fx.ghost(self.rig.meshes, i === 3 ? 0xb82a08 : col, 0.32, 1.3 - i * 0.15));
      } else if (ev.fx === 'slam') {
        // 震地：拳头砸地
        const fp = fist(self, 'R', _a);
        const sx = fp.y < 0.7 ? fp.x : x + dir * 0.9 * f.scale;
        fx.decal(sx, 0, 2.2, 0, P.mid, P.core, 6.5);
        kit.crack(sx, 0, 3.4, 6, 2.6, 9);
        dust(fx, sx, 1.6); dust(fx, sx + dir * 0.4, 1.0, dir);
        fx.groundRing(sx, 0, 4.2, P.hot, P.deep, { life: 0.42, power: 1.0, width: 0.06 });
        kit.debris(sx, 0, 0.05, 12, 1.1, 0, 0.15, 1.6);
        kit.burst(V(sx, 0.25, 0.1), 0.45, 1.4, 0.5, 1.5);
        for (let i = 0; i < 5; i++) {
          const a = Math.PI * (0.15 + 0.7 * (i / 4));
          kit.sheet({ pos: V(sx, 0, 0.05), axis: V(Math.cos(a), Math.sin(a), rnd(-0.3, 0.3)), len: rnd(0.6, 1.0), width: 0.4, life: rnd(0.25, 0.35), power: 2.2, taper: 0.1, turb: 1.1, speed: 2.6, grow: 0.15 });
        }
        embers([sx, 0.2, 0], 22, 0.4, 1.2, 1.3);
        fx.flashLight([sx, 0.5, 0.5], P.light, 50, 9, 0.35);
        ctx.cam.addShake(0.5); ctx.gfx.shockRing(_b.set(sx, 0.2, 0), 0.025, 1.2, 0.42);
      }
    },

    // ───────────────────────────── 命中 ─────────────────────────────
    onHit(e, pos, self, _opp, _ctx) {
      const dir = self.fighter.facing;
      const id = e.move;
      if (e.proj) return;   // 飞行道具自己的爆炸在 projectile.end 里
      if (e.blocked) {
        // 被挡：火从防御的前臂上向上下两边溅开，不穿过去
        if (e.hit.heavy || id === 'grab') {
          const s = id === 'ult' ? 1.1 : 0.7;
          kit.sheet({ pos: pos.clone(), axis: V(-dir * 0.35, 1, 0.2), len: 0.8 * s, width: 0.42 * s, life: 0.22, power: 2.1, taper: 0.1, turb: 1.1, speed: 2.6, grow: 0.15 });
          kit.sheet({ pos: pos.clone(), axis: V(-dir * 0.45, -0.6, -0.2), len: 0.55 * s, width: 0.36 * s, life: 0.18, power: 2.0, taper: 0.1, turb: 1.1, speed: 2.6, grow: 0.15 });
          fx.emit({ kind: 'dot', count: 10, pos, spread: 0.15, dir: [-dir, 0.8, 0], cone: 1.0, speed: [1, 4], life: [0.5, 1.1], size: [0.012, 0.028], color: EMBER, color2: EMBER2, intensity: 4, gravity: -0.6, drag: 1.5, turb: 5 });
          smoke(pos, 2, 0.4, 0.8, 1.0);
        }
        return;
      }
      const fwd = (yy = 0, zz = 0) => V(dir, yy, zz);
      const behind = (d: number) => pos.clone().add(_a.set(dir * d, 0, 0.05));
      switch (id) {
        case 'light3': jet(behind(0.15), fwd(0.1, rnd(-0.15, 0.15)), 0.9, 0.3); break;
        case 'heavy': jet(behind(0.2), fwd(0.06, rnd(-0.15, 0.15)), 1.25, 0.36); smoke(behind(0.4), 3, 0.6, 0.7, 1.4); break;
        case 'lunge': {
          // 撞上：一圈径向的火焰爆开
          const c = pos.clone(); c.z = 0.1;
          for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2 + rnd(-0.2, 0.2);
            kit.sheet({ pos: c, axis: V(Math.cos(a), Math.sin(a), rnd(-0.3, 0.3)), len: rnd(0.8, 1.3), width: 0.45, life: rnd(0.26, 0.36), power: 2.2, taper: 0.1, turb: 1.1, speed: 2.6, grow: 0.14, delay: rnd(0, 0.03) });
          }
          kit.burst(c, 0.5, 1.6, 0.45, 2.3, dir);
          fx.airRing(c, 2.2, P.hot, P.deep, { life: 0.24, power: 1.0, width: 0.04 });
          fx.emit({ kind: 'spark', count: 26, pos: c, speed: [4, 10], life: [0.2, 0.5], size: [0.025, 0.045], color: P.core, color2: P.mid, intensity: 3.2, gravity: 8, drag: 1.8, bounce: 0.3 });
          embers(c, 18, 0.3);
          fx.flashLight(c, P.light, 36, 8, 0.3);
          break;
        }
        case 'launcher': {
          // 一小股向上的火柱
          const b0 = V(pos.x, Math.max(0, pos.y - 0.5), 0.1);
          kit.sheet({ pos: b0, axis: V(dir * 0.12, 1, 0), len: 2.0, width: 0.8, life: 0.42, power: 2.3, taper: 0.12, turb: 1.0, speed: 2.8, grow: 0.14, soft: 0.05 });
          kit.sheet({ pos: b0, axis: V(dir * 0.05, 1, 0), len: 1.3, width: 0.38, life: 0.3, power: 2.6, heat: 1.4, taper: 0.2, turb: 0.6, speed: 3.2, grow: 0.1 });
          kit.sheet({ pos: b0.clone().add(_a.set(-dir * 0.15, 0.1, 0)), axis: V(-dir * 0.3, 1, 0.2), len: 1.3, width: 0.5, life: 0.34, power: 2.2, taper: 0.1, turb: 1.1, speed: 2.8, grow: 0.15, delay: 0.03 });
          fx.emit({ kind: 'spark', count: 18, pos, dir: [dir * 0.2, 1, 0], cone: 0.4, speed: [5, 12], life: [0.2, 0.5], size: [0.025, 0.045], color: P.core, color2: P.mid, intensity: 3.2, gravity: 8, drag: 2 });
          embers(pos, 20, 0.3, 1.4, 1.3);
          fx.flashLight(pos, P.light, 30, 7, 0.3);
          break;
        }
        case 'air': jet(pos.clone(), fwd(-0.55), 0.7, 0.26); break;
        case 'sweep': break;
        case 'grab': {
          if (e.hit.level === 'throw') break;
          if (!e.hit.heavy) {
            // 每一下短拳一小团爆燃
            const c = pos.clone(); c.z = 0.15;
            fx.emit({ kind: 'glow', count: 1, pos: c, size: [0.6, 0.7], life: [0.06, 0.08], color: P.core, color2: P.hot, intensity: 2.2 });
            kit.burst(c, 0.35, 1.05, 0.38, 2.3, dir);
            kit.sheet({ pos: c, axis: fwd(rnd(-0.2, 0.3)), len: 0.8, width: 0.42, life: 0.22, power: 2.2, taper: 0.12, turb: 1.0, speed: 2.6, grow: 0.15 });
            fx.emit({ kind: 'spark', count: 12, pos: c, dir: [dir, 0.3, 0], cone: 0.8, speed: [3, 8], life: [0.15, 0.35], size: [0.02, 0.04], color: P.core, color2: P.mid, intensity: 3, gravity: 7, drag: 2 });
            embers(c, 8, 0.2);
            fx.flashLight(c, P.light, 18, 5, 0.18);
          } else {
            // 最后一推：像样的爆炸
            explode(pos.clone().add(_a.set(dir * 0.15, 0, 0)), 1.05, dir);
            jet(behind(0.2), fwd(0.1), 1.0, 0.34, 0.02);
          }
          break;
        }
        case 'sp2': {
          if (!e.hit.heavy) {
            const c = pos.clone(); c.z = 0.15;
            kit.burst(c, 0.35, 1.0, 0.35, 2.3, dir);
            embers(c, 8, 0.2);
          } else jet(behind(0.1), fwd(0.85, rnd(-0.15, 0.15)), 1.15, 0.38);
          break;
        }
        case 'sp3': break;  // 震地的火柱自己会打中
        case 'ult': {
          // 冲刺重拳命中 → 进演出
          jet(behind(0.15), fwd(0.05), 1.35, 0.4);
          kit.burst(pos.clone().setZ(0.15), 0.5, 1.6, 0.45, 2.4, dir);
          break;
        }
        default: break;
      }
    },

    // ───────────────────────────── 飞行道具 ─────────────────────────────
    projectile(defId, x, y, dir, self, _ctx): ProjectileFx | null {
      const scale = self.fighter.scale;
      if (defId === 'firepillar') {
        let last = x, i = 0;
        pillarAt(x, 1.0, dir);
        return {
          update(nx, _ny, dt) {
            crawlAcc += dt * 40;
            while (crawlAcc >= 1) {
              crawlAcc -= 1;
              fx.emit({ kind: 'flame', count: 1, pos: [nx - dir * rnd(0, 0.3), 0.06, rnd(-0.15, 0.15)], spread: 0.05, dir: [0, 1, 0], cone: 0.3, speed: [0.3, 1.0], life: [0.2, 0.4], size: [0.16, 0.3], grow: 1.5, color: P.hot, color2: P.deep, intensity: 1.7, gravity: -2.5, drag: 2, spin: 2 });
            }
            if (Math.abs(nx - last) >= 0.72) {
              last = nx; i++;
              pillarAt(nx, 1.0 + 0.35 * Math.min(1, i / 4) + rnd(-0.2, 0.2), dir);
              ctx.cam.addShake(0.12);
            }
          },
          end() { /* 火柱自己烧完 */ },
        };
      }
      if (defId !== 'fireblast') return null;
      // 隔空崩拳的火球：亮核 + 翻卷的外壳 + 拖得很长的火舌、黑烟、火星，照亮地面
      const pos = V(x, y, 0.1);
      const ball = kit.ball(pos, 1.25 * scale, dir * 1.6, 2.3);
      const tails = [
        kit.sheet({ pos, axis: V(-dir, 0.06, 0), len: 2.6, width: 1.0, life: 99, power: 1.8, taper: 0.12, turb: 1.3, speed: 3.2, grow: 0.0005, soft: 0.02, erode: 0.0, fadeIn: 0.0005, root: 0.5, fall: 1.15, cool: 0.95,
          follow: (_k, p, a) => { p.copy(pos).add(_c.set(dir * 0.12, 0, 0)); a.set(-dir, 0.06 + Math.sin(ctx.time * 7) * 0.04, 0); } }),
        kit.sheet({ pos, axis: V(-dir, 0.2, 0), len: 3.4, width: 0.6, life: 99, power: 1.6, taper: 0.1, turb: 1.5, speed: 3.6, grow: 0.0005, soft: 0.02, erode: 0.0, fadeIn: 0.0005, root: 0.45, fall: 1.3, cool: 1.0,
          follow: (_k, p, a) => { p.copy(pos).add(_c.set(dir * 0.1, 0.08, -0.05)); a.set(-dir, 0.16 + Math.sin(ctx.time * 5 + 1) * 0.06, 0); } }),
        kit.sheet({ pos, axis: V(-dir, 0, 0), len: 1.2, width: 0.6, life: 99, power: 1.9, heat: 1.2, taper: 0.25, turb: 0.8, speed: 3.6, grow: 0.0005, soft: 0.02, erode: 0.0, fadeIn: 0.0005, root: 0.6, fall: 0.8, cool: 0.8,
          follow: (_k, p, a) => { p.copy(pos).add(_c.set(dir * 0.1, 0, 0.02)); a.set(-dir, 0, 0); } }),
      ];
      const light = fx.flashLight(pos, P.light, 26, 7, 99);
      liveLights.add(light);
      let acc = 0, t = 0;
      const kill = () => { ball.h.dead = true; for (const h of tails) h.dead = true; light.life = 0.15; light.age = 0; liveLights.delete(light); };
      return {
        update(nx, ny, dt) {
          t += dt;
          pos.set(nx, ny, 0.1);
          ball.mesh.position.copy(pos);
          const s = Math.min(1, t / 0.08);
          ball.mesh.scale.setScalar(1.25 * scale * (0.4 + 0.6 * s));
          light.light.position.set(nx, ny - 0.4, 0.9); light.age = 0; light.life = 99; light.peak = 24 + Math.sin(t * 37) * 4;
          acc += dt * 60;
          while (acc >= 1) {
            acc -= 1;
            fx.emit({ kind: 'dot', count: 1, pos: [nx - dir * 0.2, ny, 0], spread: 0.25, dir: [-dir, 0.4, 0], cone: 0.9, speed: [0.6, 3], life: [0.6, 1.4], size: [0.013, 0.03], color: EMBER, color2: EMBER2, intensity: 4.2, gravity: -0.9, drag: 1.4, turb: 6 });
            if (Math.random() < 0.35) fx.emit({ kind: 'smoke', count: 1, pos: [nx - dir * 1.0, ny + 0.1, -0.05], spread: 0.15, dir: [0, 1, 0], cone: 0.6, speed: [0.2, 0.7], life: [0.8, 1.4], size: [0.45, 0.7], grow: 2.2, color: SOOT, alpha: 0.5, gravity: -0.7, drag: 1.5, spin: 0.6 });
            if (Math.random() < 0.25) fx.emit({ kind: 'spark', count: 1, pos: [nx, ny, 0.1], spread: 0.2, dir: [-dir, 0.2, 0], cone: 0.6, speed: [2, 5], life: [0.15, 0.3], size: [0.02, 0.035], color: P.core, color2: P.mid, intensity: 3, drag: 2 });
          }
        },
        end(ex, ey, hit) {
          kill();
          if (hit) explode(V(ex, ey, 0.1), 1.0, dir);
          else {
            kit.burst(V(ex, ey, 0.1), 0.6, 1.4, 0.5, 2.0, dir);
            smoke([ex, ey, 0], 4, 0.6, 0.8, 1.4);
            embers([ex, ey, 0], 12, 0.3);
          }
        },
      };
    },

    // ───────────────────────────── 大招 ─────────────────────────────
    onSuperFreeze(self, _opp, _ctx) {
      const f = self.fighter, cx = f.x, sc = f.scale;
      // 脚下一圈火环向外推开
      const N = 18;
      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2 + rnd(-0.1, 0.1);
        const ca = Math.cos(a), sa = Math.sin(a);
        kit.sheet({ pos: V(cx, 0, 0), axis: V(0, 1, 0), len: rnd(0.7, 1.1), width: rnd(0.45, 0.6), life: rnd(0.85, 1.05), power: 2.1, taper: 0.14, turb: 1.0, speed: 2.4, grow: 0.15, soft: 0.04, delay: rnd(0, 0.05),
          follow: (k, p, ax) => { const r = 0.35 + 2.8 * (1 - Math.pow(1 - k, 2.2)); p.set(cx + ca * r, 0, sa * r * 0.7); ax.set(ca * 0.35, 1, sa * 0.25); } });
      }
      fx.groundRing(cx, 0, 7, P.hot, P.deep, { life: 0.9, power: 1.1, width: 0.045 });
      fx.decal(cx, 0, 3.2, 0, P.mid, P.core, 7);
      // 周身的火“点着了”：附着在骨骼上的火舌
      // 只挂在手臂、手和胯上（躯干上的火会在特写里挡住脸），火舌往身后斜
      const bones = ['RightForeArm', 'LeftForeArm', 'RightHand', 'LeftHand', 'RightArm', 'LeftArm', 'Hips', 'RightUpLeg', 'LeftUpLeg'] as const;
      for (let w = 0; w < 3; w++) for (const bn of bones) {
        if (w === 2 && Math.random() < 0.5) continue;
        const big = bn === 'Hips' || bn.endsWith('UpLeg') ? 1.15 : bn.endsWith('Hand') ? 0.8 : 1;
        kit.sheet({ pos: V(), axis: V(0, 1, 0), len: rnd(0.5, 0.8) * big * sc, width: rnd(0.28, 0.38) * big * sc, life: rnd(0.5, 0.75), power: 1.9, taper: 0.12, turb: 1.1, speed: 2.6, grow: 0.2, fadeIn: 0.15, delay: w * 0.3 + rnd(0, 0.15),
          follow: (_k, p, ax) => { self.rig.boneWorld(bn, p); p.x -= f.facing * 0.06; p.z -= 0.05; ax.set(-f.facing * 0.3, 1, 0); } });
      }
      // 大量火星向上
      for (let i = 0; i < 12; i++) fx.after(i * 0.08, () => {
        self.chestWorld(_b);
        fx.emit({ kind: 'dot', count: 14, pos: [_b.x, 0.9 * sc, 0], spread: [0.7, 0.9, 0.5], dir: [0, 1, 0], cone: 0.35, speed: [1.5, 5], life: [0.8, 1.8], size: [0.014, 0.034], color: EMBER, color2: EMBER2, intensity: 4.2, gravity: -1.2, drag: 0.9, turb: 6 });
        if (i % 3 === 0) fx.emit({ kind: 'spark', count: 6, pos: [_b.x, 0.2, 0], spread: [0.6, 0.1, 0.4], dir: [0, 1, 0], cone: 0.3, speed: [4, 9], life: [0.25, 0.5], size: [0.02, 0.035], color: P.core, color2: P.mid, intensity: 3, drag: 1.5 });
      });
      self.chestWorld(_a);
      ult.light = fx.flashLight([_a.x + f.facing * 0.4, _a.y, 0.5], P.light, 55, 11, 1.2);
      ctx.gfx.shockRing(_a.set(cx, 0.3, 0), 0.02, 1.0, 0.6, 0.08);
    },

    onCineStart() { cine = true; },
    onCineEnd() { cine = false; },

    onCineBeat(beat, final, self, opp, _ctx) {
      const f = self.fighter, dir = f.facing;
      const plan = f.def.cine;
      const b = plan?.beats[beat];
      const nb = plan?.beats.length ?? 6;
      // 和表现层一样的命中点
      const p = b?.limb ? self.rig.limbWorld(b.limb, V()) : opp.chestWorld(V());
      opp.chestWorld(_b); p.lerp(_b, 0.6); p.z = 0.12;
      if (!final) {
        // 每一拳一团方向各不相同的爆燃，一拳比一拳大
        const k = 0.75 + 0.14 * beat;
        const left = b?.limb === 'LH' || b?.limb === 'LE';
        const ang = (left ? 0.55 : -0.4) + rnd(-0.12, 0.12);
        const d = V(dir * Math.cos(ang), Math.sin(ang), (left ? -1 : 1) * 0.35);
        jet(p.clone().add(_a.set(dir * 0.1, 0, 0)), d, k, 0.32 + 0.02 * beat);
        kit.burst(p, 0.4 * k, 1.3 * k, 0.4, 2.3, dir);
        // 顶肘和回身摆拳带火弧
        if (beat >= nb - 3) {
          opp.chestWorld(_c);
          if (beat === nb - 3) kit.arc(V(self.pos.x + dir * 0.3, _c.y - 0.1, 0.15), 1.05, -0.9, 0.7, dir, 0.36, 2.3, 0.4);
          else kit.arc(V(self.pos.x + dir * 0.1, _c.y + 0.1, 0.15), 1.3, 2.5, 0.05, dir, 0.42, 2.4, 0.42, 0.3);
        }
        return;
      }
      // 最后一击：冲天炮——直冲出画面的巨大火柱
      const x = opp.pos.x;
      // 内层白亮的芯 + 一层翻卷的橙火
      kit.column(x, 0, 0.5, 16, 1.7, 0.35, 0.8, -2.2);
      kit.column(x, 0, 0.16, 16, 1.4, 1.0, 1.2, 3.0);
      // 外层：一圈绕着轴旋转上窜的大火舌
      const NS = 9;
      for (let i = 0; i < NS; i++) {
        const a0 = (i / NS) * Math.PI * 2 + rnd(-0.2, 0.2), r = rnd(0.4, 0.75), sp = rnd(2.2, 3.4), life = rnd(1.1, 1.9);
        kit.sheet({ pos: V(x, 0, 0), axis: V(0, 1, 0), len: rnd(5.5, 9), width: rnd(0.8, 1.15), life, power: 1.2, heat: 0.8, taper: 0.3, turb: 1.3, speed: 2.6, grow: 0.07, soft: 0.03, fall: 0.6, cool: 0.7, delay: rnd(0, 0.05),
          follow: (k, p, ax) => { const a = a0 + k * life * sp; const c = Math.cos(a), sn = Math.sin(a); p.set(x + c * r, 0, sn * r * 0.7); ax.set(-sn * 0.22, 1, c * 0.12); } });
      }
      // 根部张开的一圈矮火
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + rnd(-0.2, 0.2);
        kit.sheet({ pos: V(x + Math.cos(a) * 0.6, 0, Math.sin(a) * 0.45), axis: V(Math.cos(a) * 0.9, 1, Math.sin(a) * 0.5), len: rnd(1.4, 2.2), width: rnd(0.9, 1.2), life: rnd(0.7, 1.0), power: 1.5, taper: 0.15, turb: 1.2, speed: 2.4, grow: 0.1, soft: 0.04 });
      }
      kit.burst(V(x, 0.35, 0.2), 0.5, 1.8, 0.8, 1.0);
      kit.debris(x, 0, 0.1, 22, 1.7, 0, 0.25, 2.0);
      fx.decal(x, 0, 5.5, 0, P.mid, P.core, 10);
      kit.crack(x, 0, 8, 10, 4.0, 13);
      fx.after(0.08, () => { kit.crack(x + rnd(1.6, 2.4), rnd(-0.3, 0.3), 3.2, 9, 3.0, 7); kit.crack(x - rnd(1.6, 2.4), rnd(-0.3, 0.3), 3.2, 9, 3.0, 7); });
      groundSlam(fx, x, 2.2, 'fire');
      fx.groundRing(x, 0, 10, P.core, P.mid, { life: 0.7, power: 2.0, width: 0.04 });
      fx.after(0.12, () => fx.groundRing(x, 0, 7, P.hot, P.deep, { life: 0.9, power: 1.4, width: 0.07 }));
      // 冲天的余烬，然后满屏下落的余烬（两三秒）
      fx.emit({ kind: 'dot', count: 90, pos: [x, 1.5, 0], spread: [0.7, 1.5, 0.6], dir: [0, 1, 0], cone: 0.35, speed: [6, 16], life: [0.8, 1.8], size: [0.016, 0.04], color: EMBER, color2: EMBER2, intensity: 4.4, gravity: 1.5, drag: 0.8, turb: 7 });
      fx.emit({ kind: 'spark', count: 50, pos: [x, 0.5, 0], spread: [0.6, 0.4, 0.4], dir: [0, 1, 0], cone: 0.8, speed: [6, 16], life: [0.4, 1.0], size: [0.03, 0.06], color: P.core, color2: P.mid, intensity: 3.5, gravity: 9, drag: 1, bounce: 0.35 });
      for (let i = 0; i < 16; i++) fx.after(0.25 + i * 0.16, () => {
        fx.emit({ kind: 'dot', count: 20, pos: [x + rnd(-1, 1), 5.5, rnd(-1, 1.5)], spread: [5.5, 1.2, 1.5], dir: [0.15, -1, 0], cone: 0.4, speed: [0.3, 1.0], life: [2.2, 3.2], size: [0.015, 0.04], color: EMBER, color2: EMBER2, intensity: 4.2, gravity: 0.45, drag: 0.6, turb: 3.5 });
      });
      fx.after(0.5, () => fx.emit({ kind: 'smoke', count: 12, pos: [x, 3.5, -0.3], spread: [1.2, 2.5, 0.4], dir: [0, 1, 0], cone: 0.8, speed: [0.3, 1.2], life: [1.8, 2.8], size: [1.2, 2.0], grow: 2, color: SOOT, alpha: 0.5, gravity: -0.4, drag: 1, spin: 0.4 }));
      const c = V(x, 1.6, 0);
      fx.flashLight([x, 1.4, 0.8], P.light, 120, 16, 1.7);
      fx.flashLight([x, 4.5, 0.5], P.hot, 80, 14, 1.4);
      ctx.gfx.flash(0.22, 0xffd9a8, 5);
      ctx.gfx.shockRing(c, 0.06, 1.6, 0.7, 0.09);
      fx.after(0.1, () => ctx.gfx.shockRing(V(x, 0.3, 0), 0.035, 1.1, 0.6, 0.07));
      ctx.gfx.chroma(0.035); ctx.gfx.radialBlur(0.25, c);
      ctx.cam.shake(1);
      void smoothstep;
    },

    reset() {
      prevMove = null; prevMf = -1; strip = null; helix = null; cine = false; handLight = null; burnAcc = 0;
      for (const l of liveLights) { l.life = 0; l.age = 1; l.light.intensity = 0; }
      liveLights.clear();
    },
  };
}
