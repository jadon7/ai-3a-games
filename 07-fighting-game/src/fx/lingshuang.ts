import * as THREE from 'three';
import type { HitDef, MoveDef } from '../combat/types';
import { DT } from '../core/config';
import { rand } from '../core/math';
import type { FighterView } from '../present/fighterView';
import { dust } from './common';
import type { MeshFxHandle } from './core';
import {
  arcFromTo, arcGeo, bladeWorld, C, prewarm, type Cluster, crescentMaterial, frost, type Frost, glint, iceCluster, lanceRing, mistRing, shatter, type Streak, streak,
} from './lingshuang_lib';
import type { FighterFx, FxCtx, HitEvent, ProjectileFx } from './types';

/**
 * 凌霜 · 霜刃 的全套专属特效。
 * 冷、锋利、干净：细而亮的刀光、会碎的冰、贴地蔓延的霜、缓慢下沉的寒雾。
 * 位置一律从骨骼和刀取（替身没有刀时 bladeWorld 用右手接一把虚拟刀），方向跟 facing。
 */

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3();

/** 每一刀的弧光：from → to 是从圆心出发的方向（角色本地：x 朝前、y 朝上、z 朝镜头），能量和形状。 */
interface SwingDef { body?: number; via?: [number, number, number]; from: [number, number, number]; to: [number, number, number]; sweep?: number; n?: [number, number, number]; r: number; w: number; life: number; power: number; measured: boolean; ahead: number; cy: number; cx: number }
const SWING: Record<string, SwingDef> = {
  // 横斩：从右往左，略斜
  light1: { via: [1, 0.1, 0], from: [-0.3, 0.6, 1], to: [0.3, -0.55, -1], sweep: 2.5, r: 1.05, w: 0.22, life: 0.16, power: 1.5, measured: true, ahead: 0.45, cy: 0.72, cx: 0.15 },
  // 回挑：左下到右上
  light2: { via: [1, 0.05, 0], from: [0.35, -1, -0.5], to: [0.45, 1, 0.6], sweep: 2.3, r: 1.05, w: 0.22, life: 0.16, power: 1.5, measured: true, ahead: 0.45, cy: 0.72, cx: 0.15 },
  // 回旋斩：一整圈，平面略向镜头倾斜
  light3: { body: 1.4, from: [-1, 0, 0.2], to: [1, 0, 0], sweep: 5.6, n: [0, 1, 0.5], r: 1.3, w: 0.24, life: 0.24, power: 1.7, measured: false, ahead: 0, cy: 0.66, cx: 0.0 },
  // 力劈：竖直的大月牙，从头顶劈到身前
  heavy: { body: 1.9, via: [1, 0.25, 0], from: [-0.35, 1, 0], to: [0.75, -0.66, 0], sweep: 2.9, r: 1.35, w: 0.34, life: 0.26, power: 1.9, measured: false, ahead: 0, cy: 0.62, cx: 0.25 },
  // 上撩：向上的月牙
  launcher: { body: 1.8, via: [1, 0, 0], from: [0.45, -1, 0], to: [-0.2, 1, 0], sweep: 2.8, r: 1.3, w: 0.32, life: 0.26, power: 1.8, measured: false, ahead: 0, cy: 0.62, cx: 0.3 },
  // 跃斩：向斜下的月牙
  air: { body: 1.6, via: [1, 0.2, 0], from: [-0.2, 1, 0.1], to: [0.6, -0.8, 0], sweep: 2.6, r: 1.15, w: 0.3, life: 0.22, power: 1.7, measured: false, ahead: 0, cy: 0.45, cx: 0.2 },
};

export default function lingshuangFx(ctx: FxCtx): FighterFx {
  const fx = ctx.fx;
  // ── 刀 ──
  const base = new THREE.Vector3(), tip = new THREE.Vector3(), tipFollow = new THREE.Vector3();
  let realBlade = false;
  const HN = 16;
  const hist = new Float32Array(HN * 4); let hHead = 0, hCount = 0;
  let bladeS: Streak | null = null;
  let heat = 0, heatTarget = 0, heatHold = 0;
  // ── 常驻 ──
  let mistT = 0, glintT = 2;
  // ── 招式追踪 ──
  let curMove: MoveDef | null = null; let lastMf = -1;
  let chargeUntil = -1;
  let lastOpp: FighterView | null = null;
  // 冻结染色
  let tint = 0, tintDecay = 2, tintWas = false;
  // 踏雪
  let dashLine: Streak | null = null; let dashFrost: Frost | null = null; let dashUntil = -1;
  // 大招
  let freezeUntil = -1, freezeT0 = 0;
  const cuts: { s: Streak; offA: THREE.Vector3; offB: THREE.Vector3; born: number }[] = [];
  let encase: Cluster | null = null; const encaseOff = new THREE.Vector3();
  let flare = 0;
  let warmed = false;

  const facing = (self: FighterView) => self.fighter.facing;
  const sc = (self: FighterView) => self.fighter.scale || 1;
  const local = (self: FighterView, v: [number, number, number], out: THREE.Vector3) => out.set(v[0] * facing(self), v[1], v[2]);

  function tintOpp(k: number, decay: number) { tint = Math.max(tint, k); tintDecay = decay; }

  function ensureBlade() {
    if (bladeS && !bladeS.h.dead) return bladeS;
    bladeS = streak(ctx, base, tip, { hold: true, draw: 0.0001, core: 1.0, thin: 0.13, halo: 0.28, width: 0.08, power: 1.0, taper: 0.35 });
    bladeS.h.mesh.visible = false;
    return bladeS;
  }

  /** 第 back 秒之前的刀尖（历史里找最近的一个）。 */
  function tipAgo(back: number, out: THREE.Vector3) {
    const now = fx.time; let best = -1, bestD = 1e9;
    for (let i = 0; i < hCount; i++) {
      const j = ((hHead - 1 - i + HN) % HN) * 4;
      const d = Math.abs(now - hist[j + 3] - back);
      if (d < bestD) { bestD = d; best = j; }
    }
    if (best < 0) return out.copy(tip);
    return out.set(hist[best], hist[best + 1], hist[best + 2]);
  }

  // ───────────────────────────── 挥刀的弧光 ─────────────────────────────
  const lastSwingDir = new THREE.Vector3(1, 0, 0);
  function swingArc(move: MoveDef, self: FighterView) {
    const d = SWING[move.id]; if (!d) return;
    const s = sc(self), f = facing(self);
    self.chestWorld(_c);
    const center = _d.set(self.pos.x + f * d.cx * s, self.pos.y + (d.cy + 0.35) * s * 1.0, 0.1);
    center.y = Math.max(center.y, _c.y - 0.25 * s);
    let done = false;
    if (d.measured && realBlade) {
      // 用刀尖在前几帧和现在的位置定挥动的平面和方向
      self.rig.boneWorld('RightShoulder', _e);
      const prev = tipAgo(0.07, _a).sub(_e), now = _b.copy(tip).sub(_e);
      const ang = prev.angleTo(now);
      if (ang > 0.4 && now.length() > 0.35) {
        const r = Math.max(0.85, now.length() * 1.08) * 1.0;
        const h = arcFromTo(ctx, _e, prev, now, r, { sweep: ang * 1.6, ahead: d.ahead, width: d.w, life: d.life, power: d.power });
        lastSwingDir.crossVectors(new THREE.Vector3().crossVectors(prev, now), now).normalize().negate();
        done = !!h;
      }
    }
    if (!done) {
      const from = local(self, d.from, _a), to = local(self, d.to, _b);
      let n = d.n ? local(self, d.n, new THREE.Vector3()) : undefined;
      if (n && f < 0) n.negate();
      if (!n && d.via) n = new THREE.Vector3().crossVectors(from, local(self, d.via, _e)).normalize();
      arcFromTo(ctx, center, from, to, d.r * s, { sweep: d.sweep, n, width: d.w, life: d.life, power: d.power, body: d.body ?? 1 });
      lastSwingDir.copy(to).normalize();
    }
    // 刃口一点冷光
    if (move.id !== 'light1' && move.id !== 'light2') glint(ctx, tipFollow, 0.5, 0.18, 1.8);
  }

  /** 力劈：刀落地的地方向前窜出一条霜线，沿线冒几根小冰牙。 */
  function heavyFrostLine(self: FighterView) {
    const f = facing(self), s = sc(self);
    const x0 = self.pos.x + f * 0.85 * s;
    const fr = frost(ctx, x0, 0.05, x0 + f * 3.2, 0.1, { width: 0.42, tip: 0.25, spread: 0.32, life: 3.2, hold: 1.6, front: 1.2 });
    void fr;
    fx.groundRing(x0, 0.05, 1.6, C.white, C.cyan, { life: 0.28, power: 0.9, width: 0.05 });
    for (let i = 0; i < 5; i++) {
      const t = (i + 1) / 5;
      fx.after(0.32 * Math.pow(t, 1.4) * 0.9, () => {
        const x = x0 + f * 3.2 * t * 0.95;
        iceCluster(ctx, _a.set(x, 0, rand(-0.1, 0.15)), { count: 3, height: rand(0.22, 0.42) * (1.2 - t * 0.5), radius: 0.15, rise: 0.06, life: 1.4, dir: f, lean: 0.5 });
        fx.emit({ kind: 'flake', count: 5, pos: [x, 0.05, 0.05], spread: [0.15, 0.02, 0.15], dir: [f * 0.3, 1, 0], cone: 0.6, speed: [1.5, 4], life: [0.3, 0.7], size: [0.025, 0.06], color: C.white, color2: C.ice, intensity: 1.8, gravity: 10, drag: 1, spin: 9 });
      });
    }
    fx.emit({ kind: 'smoke', count: 6, pos: [x0, 0.1, 0.05], spread: [0.3, 0.05, 0.2], dir: [f, 0.3, 0], cone: 0.8, speed: [1, 3], life: [0.5, 0.9], size: [0.3, 0.5], grow: 2.4, color: 0xd0dcea, alpha: 0.22, drag: 2.5 });
    fx.flashLight([x0 + f * 0.8, 0.4, 0.2], C.light, 18, 6, 0.3);
  }

  /** 突刺：沿刀的方向一道细长的光枪 + 刀尖上的环。 */
  function lance(self: FighterView) {
    const f = facing(self);
    const dir = _a.subVectors(tip, base).normalize();
    dir.x = dir.x * 0.5 + f * 0.5; dir.y *= 0.4; dir.z *= 0.3; dir.normalize();
    const a = _b.copy(tip).addScaledVector(dir, -0.5);
    const b = _c.copy(tip).addScaledVector(dir, 2.4);
    streak(ctx, a, b, { draw: 0.05, life: 0.26, core: 2.8, thin: 0.12, halo: 0.45, width: 0.2, power: 1.4, taper: 0.5 });
    streak(ctx, a, _d.copy(tip).addScaledVector(dir, 1.5), { draw: 0.04, life: 0.4, core: 0.8, thin: 0.35, halo: 0.6, width: 0.5, power: 0.6, taper: 0.8, colA: C.ice, colB: C.blue });
    lanceRing(ctx, _e.copy(tip).addScaledVector(dir, 0.35), 0.9, 0.24, 2.0);
    fx.after(0.03, () => lanceRing(ctx, _e.copy(tip).addScaledVector(dir, 0.9), 0.65, 0.2, 1.4));
    fx.emit({ kind: 'spark', count: 10, pos: tip, spread: [0.2, 0.08, 0.1], dir: [dir.x, dir.y, 0], cone: 0.08, speed: [8, 15], life: [0.08, 0.18], size: [0.015, 0.03], color: C.white, color2: C.cyan, intensity: 2.5, alpha: 0.8 });
    fx.emit({ kind: 'mist', count: 3, pos: tip, spread: 0.15, dir: [dir.x, 0, 0], cone: 0.4, speed: [1, 3], life: [0.4, 0.8], size: [0.4, 0.7], grow: 1.8, color: C.frost, color2: C.mist, intensity: 0.45, alpha: 0.35, drag: 3, gravity: 0.3 });
    fx.flashLight(tip, C.light, 20, 6, 0.22);
  }

  /** 上撩：一串上升的冰屑。 */
  function rising(self: FighterView) {
    const f = facing(self), s = sc(self);
    const x = self.pos.x + f * 0.7 * s;
    fx.emit({ kind: 'flake', count: 26, pos: [x, 0.3, 0.1], spread: [0.3, 0.3, 0.2], dir: [f * 0.15, 1, 0], cone: 0.25, speed: [3, 8], life: [0.5, 1.1], size: [0.025, 0.07], color: C.white, color2: C.ice, intensity: 2.0, gravity: 4, drag: 1.4, spin: 8 });
    fx.emit({ kind: 'glow', count: 8, pos: [x, 0.6, 0.1], spread: [0.25, 0.5, 0.2], dir: [0, 1, 0], cone: 0.3, speed: [2, 6], life: [0.3, 0.7], size: [0.04, 0.08], color: C.white, color2: C.cyan, intensity: 3, drag: 2 });
    fx.emit({ kind: 'mist', count: 4, pos: [x, 0.4, 0.1], spread: [0.25, 0.3, 0.2], dir: [0, 1, 0], cone: 0.4, speed: [1, 2.5], life: [0.5, 1.0], size: [0.5, 0.8], grow: 1.8, color: C.frost, color2: C.mist, intensity: 0.4, alpha: 0.3, drag: 2.5 });
    dust(fx, x, 0.7);
  }

  // ───────────────────────────── 霜月斩 ─────────────────────────────
  function crescentProj(x: number, y: number, dir: number): ProjectileFx {
    const R = 1.0, theta = 1.08, W = 0.44;
    const geoMain = arcGeo(new THREE.Vector3(), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), R, W, -theta, theta, 56, 0.5);
    const geoHalo = arcGeo(new THREE.Vector3(), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), R * 1.07, W * 1.5, -theta * 1.02, theta * 1.02, 56, 0.5);
    const layers: { m: THREE.Mesh; mat: THREE.ShaderMaterial; back: number }[] = [];
    const group = new THREE.Group();
    const add = (geo: THREE.BufferGeometry, mat: THREE.ShaderMaterial, back: number, ro: number) => { const m = new THREE.Mesh(geo, mat); m.renderOrder = ro; group.add(m); layers.push({ m, mat, back }); };
    add(geoHalo, crescentMaterial(ctx, 0.25, 0.45, 0.8, C.ice, C.blue), 0, 21);
    add(geoMain, crescentMaterial(ctx, 0.3, 0.35, 0.75, C.ice, C.blue), 0.34, 22);
    add(geoMain, crescentMaterial(ctx, 0.15, 0.2, 0.55, C.ice, C.deep), 0.7, 22);
    add(geoMain, crescentMaterial(ctx, 1.0, 2.6, 1.35), 0, 23);
    let px = x, py = y, t = 0, emitAcc = 0, glintAcc = 0, dis = -1, dead = false;
    const place = () => {
      for (const L of layers) {
        L.m.position.set(px - dir * (0.62 + L.back), py, 0.05);
        L.m.scale.set(dir, 1, 1);
        L.m.rotation.x = 0;
      }
    };
    place();
    const h: MeshFxHandle = fx.addMesh(group, 30, (_k, dt) => {
      for (const L of layers) L.mat.uniforms.uTime.value = fx.time;
      // 出手的一瞬间从小到大展开
      const open = Math.min(1, t / 0.07), e = 1 - Math.pow(1 - open, 3);
      group.scale.set(1, 0.35 + 0.65 * e, 1);
      group.position.set(0, py * (1 - group.scale.y), 0);
      if (dis >= 0) {
        dis += dt / 0.32;
        for (const L of layers) L.mat.uniforms.uDis.value = Math.min(1.2, dis * 1.1);
        if (dis >= 1.1) h.dead = true;
      }
    });
    void dead;
    const light = fx.flashLight([x, y, 0.6], C.light, 22, 6.5, 30);
    // 地上的霜痕跟着走
    const trail = frost(ctx, x - dir * 0.3, 0.05, x, 0.05, { width: 0.38, spread: 0.001, life: 4.5, hold: 2.2, front: 0.9, tip: 0.6 });
    // 出手：刀前一圈冷光
    glint(ctx, new THREE.Vector3(x, y, 0.2), 1.6, 0.22, 2.2, false);
    return {
      update(nx, ny, dt) {
        t += dt; px = nx; py = ny; place();
        light.light.position.set(nx - dir * 0.3, ny, 0.9); light.age = 0; light.life = 30; light.peak = 20 + Math.sin(t * 37) * 3;
        trail.target.set(nx - dir * 0.2, 0.05);
        emitAcc += dt; glintAcc += dt;
        while (emitAcc > 1 / 60) {
          emitAcc -= 1 / 60;
          // 冰屑从刃口两侧往后掉
          const a = rand(-theta, theta) * 0.9;
          const ex = nx - dir * 0.62 + dir * Math.cos(a) * R * 0.92, ey = ny + Math.sin(a) * R * 0.92;
          fx.emit({ kind: 'flake', count: 2, pos: [ex, ey, 0.05], spread: [0.05, 0.05, 0.12], dir: [-dir, -0.2, 0], cone: 0.7, speed: [0.6, 2.5], life: [0.35, 0.8], size: [0.02, 0.055], color: C.white, color2: C.ice, intensity: 1.9, gravity: 5, drag: 1.6, spin: 9 });
          if (Math.random() < 0.55) fx.emit({ kind: 'mist', count: 1, pos: [nx - dir * 0.75, ny + rand(-0.5, 0.5), 0], spread: [0.1, 0.15, 0.15], dir: [-dir, -0.3, 0], cone: 0.5, speed: [0.2, 0.9], life: [0.6, 1.1], size: [0.5, 0.9], grow: 1.7, color: C.frost, color2: C.mist, intensity: 0.38, alpha: 0.32, drag: 2, gravity: 0.35 });
          if (Math.random() < 0.3) fx.emit({ kind: 'dot', count: 1, pos: [ex, ey, 0.05], spread: 0.05, dir: [-dir, 0, 0], cone: 0.8, speed: [0.3, 1.2], life: [0.3, 0.7], size: [0.015, 0.03], color: C.white, color2: C.cyan, intensity: 3, drag: 1.5, gravity: 1.2, turb: 3 });
        }
        if (glintAcc > 0.11) { glintAcc = 0; const a = rand(-0.5, 0.5); glint(ctx, new THREE.Vector3(nx - dir * 0.62 + dir * Math.cos(a) * R, ny + Math.sin(a) * R, 0.15), rand(0.35, 0.55), 0.14, 1.6, false); }
      },
      end(ex, ey, hit) {
        light.life = 0.3; light.age = 0; light.peak = hit ? 55 : 12;
        trail.target.set(ex, 0.05);
        dis = 0;
        const p = _a.set(ex, ey, 0.25);
        if (hit) {
          for (const L of layers) L.mat.uniforms.uPower.value *= 1.6;
          dis = 0.25;
          shatter(ctx, p, { count: 46, spread: 0.45, spreadY: 1.5, speed: [2, 8], size: [0.03, 0.09], life: [0.5, 1.1], dir: new THREE.Vector3(dir, 0.25, 0), cone: 1.1, up: 1.5 });
          fx.emit({ kind: 'flake', count: 60, pos: [ex, ey, 0.2], spread: [0.25, 0.7, 0.2], dir: [dir, 0.3, 0], cone: 1.3, speed: [2, 9], life: [0.4, 1.0], size: [0.03, 0.09], color: C.white, color2: C.ice, intensity: 2.2, gravity: 10, drag: 1.3, spin: 10, bounce: 0.3 });
          fx.emit({ kind: 'mist', count: 9, pos: [ex, ey, 0.2], spread: [0.3, 0.6, 0.2], speed: [0.5, 2.5], life: [0.7, 1.3], size: [0.8, 1.3], grow: 1.8, color: C.frost, color2: C.mist, intensity: 0.5, alpha: 0.4, drag: 2.4, gravity: 0.3 });
          glint(ctx, new THREE.Vector3(ex, ey + 0.2, 0.4), 1.4, 0.22, 2.0, false);
          ctx.gfx.shockRing(_b.set(ex, ey, 0), 0.018, 1.3, 0.35);
          tintOpp(0.85, 1.6);
        } else {
          fx.emit({ kind: 'flake', count: 24, pos: [ex - dir * 0.3, ey, 0.1], spread: [0.25, 0.7, 0.15], dir: [dir, 0, 0], cone: 1.2, speed: [0.5, 2.5], life: [0.4, 0.9], size: [0.02, 0.06], color: C.white, color2: C.ice, intensity: 1.8, gravity: 5, drag: 1.5, spin: 8 });
          fx.emit({ kind: 'mist', count: 5, pos: [ex - dir * 0.4, ey, 0.1], spread: [0.2, 0.6, 0.2], speed: [0.2, 1], life: [0.6, 1.1], size: [0.6, 1.0], grow: 1.6, color: C.frost, color2: C.mist, intensity: 0.4, alpha: 0.35, drag: 2, gravity: 0.3 });
        }
      },
    };
  }

  // ───────────────────────────── 冰棘 ─────────────────────────────
  function spikesProj(x: number, dir: number): ProjectileFx {
    let lastX = x, n = 0;
    const startX = x - dir * 0.6;
    const trail = frost(ctx, startX, 0.05, x, 0.05, { width: 0.6, spread: 0.001, life: 5.5, hold: 3, front: 1.2, tip: 0.7 });
    const spike = (sx: number) => {
      const big = n % 2 === 0, k = Math.min(1, n / 6);
      const h = (big ? rand(1.45, 1.8) : rand(0.9, 1.2)) * (0.85 + k * 0.3);
      const z = rand(-0.18, 0.18);
      const cl = iceCluster(ctx, _a.set(sx, 0, z), { count: big ? 6 : 4, height: h, radius: 0.5, rise: 0.08, life: 0.78, dir, lean: 0.45 });
      n++;
      // 破地：冰屑和雪尘
      fx.emit({ kind: 'flake', count: 12, pos: [sx, 0.1, z], spread: [0.3, 0.05, 0.25], dir: [dir * 0.2, 1, 0], cone: 0.7, speed: [2, 6.5], life: [0.35, 0.8], size: [0.03, 0.08], color: C.white, color2: C.ice, intensity: 1.9, gravity: 12, drag: 0.8, spin: 10, bounce: 0.3 });
      fx.emit({ kind: 'smoke', count: 4, pos: [sx, 0.1, z], spread: [0.3, 0.05, 0.2], dir: [0, 1, 0], cone: 1.2, speed: [0.5, 1.8], life: [0.5, 0.9], size: [0.3, 0.55], grow: 2.4, color: 0xd0dcea, alpha: 0.22, drag: 2.4 });
      fx.flashLight([sx, 0.9, 0.5], C.light, 16, 5.5, 0.3);
      ctx.cam.addShake(0.12);
      // 停一下以后碎掉
      fx.after(0.6, () => {
        const ph = _b.set(sx, h * 0.45, z);
        shatter(ctx, ph, { count: big ? 26 : 16, spread: 0.3, spreadY: h * 1.3, speed: [1.2, 5], size: [0.03, 0.09], life: [0.45, 0.95], up: 2.2, gravity: 13 });
        fx.emit({ kind: 'flake', count: 14, pos: [sx, h * 0.5, z], spread: [0.25, h * 0.4, 0.2], speed: [0.8, 3.5], life: [0.4, 0.9], size: [0.02, 0.06], color: C.white, color2: C.ice, intensity: 1.8, gravity: 11, drag: 1, spin: 10, bounce: 0.3 });
        fx.emit({ kind: 'mist', count: 3, pos: [sx, h * 0.35, z], spread: [0.25, h * 0.3, 0.2], speed: [0.2, 0.9], life: [0.8, 1.4], size: [0.7, 1.1], grow: 1.6, color: C.frost, color2: C.mist, intensity: 0.42, alpha: 0.32, drag: 2, gravity: 0.25 });
        frost(ctx, sx, z, sx, z, { width: 0.75, spread: 0.12, life: 4.5, hold: 2.5, front: 0.4 });
      });
      void cl;
    };
    spike(x);
    return {
      update(nx) { trail.target.set(nx, 0.05); if (Math.abs(nx - lastX) >= 0.62) { lastX = nx; spike(nx); } },
      end(ex) { trail.target.set(ex, 0.05); },
    };
  }

  // ───────────────────────────── 大招：斩痕 ─────────────────────────────
  function addCut(opp: FighterView, ang: number, len: number, f: number, strong = false) {
    opp.chestWorld(_c);
    const cx = _c.x + rand(-0.22, 0.22), cy = _c.y + rand(-0.4, 0.15);
    const ux = Math.cos(ang) * f, uy = Math.sin(ang);
    const a = new THREE.Vector3(cx - ux * len / 2, cy - uy * len / 2, 0.35);
    const b = new THREE.Vector3(cx + ux * len / 2, cy + uy * len / 2, 0.35);
    const s = streak(ctx, a, b, { hold: true, draw: 0.05, core: 3.0, thin: 0.08, halo: 0.3, width: 0.15, power: 1.2, taper: 0.55 });
    cuts.push({ s, offA: a.clone().sub(opp.pos), offB: b.clone().sub(opp.pos), born: fx.time });
    // 贯穿瞬间：沿斩痕两头喷一点冰屑
    fx.emit({ kind: 'flake', count: strong ? 22 : 12, pos: [b.x, b.y, 0.3], spread: 0.1, dir: [ux, uy, 0], cone: 0.5, speed: [2, 6], life: [0.3, 0.7], size: [0.02, 0.06], color: C.white, color2: C.ice, intensity: 2, gravity: 8, drag: 1.5, spin: 9 });
    fx.emit({ kind: 'spark', count: 8, pos: [cx, cy, 0.35], spread: 0.05, dir: [ux, uy, 0], cone: 0.15, speed: [6, 12], life: [0.08, 0.16], size: [0.015, 0.03], color: C.white, color2: C.cyan, intensity: 2.5 });
  }

  return {
    update(sdt, self, opp) {
      lastOpp = opp;
      if (!warmed) { warmed = true; prewarm(ctx); }
      const f = self.fighter;
      realBlade = bladeWorld(self, base, tip);
      tipFollow.copy(tip);
      // 历史
      const j = hHead * 4; hist[j] = tip.x; hist[j + 1] = tip.y; hist[j + 2] = tip.z; hist[j + 3] = fx.time; hHead = (hHead + 1) % HN; hCount = Math.min(HN, hCount + 1);

      // 招式里的命中帧：补弧光
      const mv = f.move;
      if (mv !== curMove) { curMove = mv; lastMf = -1; }
      if (mv) {
        for (const h of mv.hits as HitDef[]) {
          if (lastMf < h.f && f.mf >= h.f && f.mf < h.f + 3) {
            if (h.limb === 'W') {
              swingArc(mv, self);
              if (mv.id === 'heavy') fx.after(0.04, () => heavyFrostLine(self));
              if (mv.id === 'lunge') lance(self);
              if (mv.id === 'launcher') rising(self);
            } else if (mv.id === 'sweep') {
              const x = self.pos.x + f.facing * 0.7 * sc(self);
              frost(ctx, self.pos.x, 0.05, x + f.facing * 0.8, 0.1, { width: 0.4, spread: 0.12, life: 2.5, hold: 1.2, front: 0.7, tip: 0.6 });
              fx.emit({ kind: 'flake', count: 14, pos: [x, 0.08, 0.1], spread: [0.4, 0.03, 0.2], dir: [f.facing, 0.6, 0], cone: 0.6, speed: [2, 5], life: [0.3, 0.7], size: [0.025, 0.06], color: C.white, color2: C.ice, intensity: 1.7, gravity: 10, drag: 1, spin: 9 });
              dust(fx, x, 0.9, f.facing);
            }
          }
        }
        lastMf = f.mf;
      }

      // 踏雪的贯穿线跟着人走
      if (dashLine && fx.time < dashUntil) {
        dashLine.b.set(self.pos.x + f.facing * 0.5 * sc(self), dashLine.a.y, dashLine.a.z);
        if (dashFrost) dashFrost.target.set(self.pos.x, 0.05);
      }

      // 刀身的光：蓄力、大招时变亮
      heatHold -= sdt;
      const tgt = heatHold > 0 ? heatTarget : 0;
      heat += (tgt - heat) * (1 - Math.exp(-(tgt > heat ? 14 : 4) * sdt));
      const bs = ensureBlade();
      bs.a.copy(base).lerp(tip, 0.04); bs.b.copy(tip);
      bs.h.mesh.visible = heat > 0.02;
      bs.fadeK = Math.min(1, heat);
      bs.mat.uniforms.uCore.value = 0.8 + heat * 1.1;
      bs.mat.uniforms.uPower.value = 0.7 + heat * 0.5;
      bs.width = 0.07 + heat * 0.025;

      // 蓄力：寒气向刀汇聚、冰屑点点
      if (fx.time < chargeUntil) {
        for (let i = 0; i < 2; i++) {
          const k = Math.random();
          _a.lerpVectors(base, tip, k);
          const th = rand(0, 6.283), ph = rand(0.3, 2.8), r = rand(0.5, 0.9);
          const ox = Math.sin(ph) * Math.cos(th) * r, oy = Math.cos(ph) * r, oz = Math.sin(ph) * Math.sin(th) * r * 0.6;
          const life = rand(0.18, 0.26);
          fx.emit({ kind: 'dot', count: 1, pos: [_a.x + ox, _a.y + oy, _a.z + oz], dir: [-ox, -oy, -oz], cone: 0.05, speed: [r / life * 0.9, r / life], life: [life, life], size: [0.012, 0.026], color: C.white, color2: C.cyan, intensity: 3, drag: 0 });
        }
        // 刀身结霜：贴着刀身闪烁的小冰晶
        _a.lerpVectors(base, tip, rand(0.15, 1));
        fx.emit({ kind: 'flake', count: 1, pos: _a, spread: 0.025, speed: [0, 0.15], life: [0.25, 0.45], size: [0.02, 0.04], color: C.white, color2: C.ice, intensity: 2.6, drag: 3, spin: 6 });
        if (Math.random() < 0.5) {
          _a.lerpVectors(base, tip, Math.random());
          fx.emit({ kind: 'mist', count: 1, pos: [_a.x + rand(-0.5, 0.5), _a.y + rand(-0.3, 0.5), _a.z], dir: [_a.x - (_a.x + 0.001), 0, 0], speed: [0, 0.1], life: [0.25, 0.4], size: [0.5, 0.8], grow: 0.45, color: C.frost, color2: C.ice, intensity: 0.4, alpha: 0.3, drag: 1 });
        }
      }

      // 常驻：刀身往下淌的寒气（很淡），刀尖偶尔一点冷光
      mistT += sdt; glintT -= sdt;
      const busy = !!mv;
      if (mistT > (busy ? 0.05 : 0.11)) {
        mistT = 0;
        _a.lerpVectors(base, tip, rand(0.15, 1));
        fx.emit({ kind: 'mist', count: 1, pos: _a, spread: 0.03, dir: [0, -1, 0], cone: 0.4, speed: [0.05, 0.25], life: [0.9, 1.5], size: [0.12, 0.22], grow: 2.6, color: C.frost, color2: C.mist, intensity: 0.32, alpha: 0.28 + heat * 0.15, gravity: 0.18, drag: 1.2, turb: 0.4 });
        if (Math.random() < 0.25) fx.emit({ kind: 'dot', count: 1, pos: _a, spread: 0.02, dir: [0, -1, 0], cone: 0.6, speed: [0.05, 0.25], life: [0.6, 1.2], size: [0.008, 0.016], color: C.white, color2: C.ice, intensity: 2.2, gravity: 0.4, drag: 1, turb: 0.8 });
      }
      if (glintT <= 0 && (f.state === 'stand' || f.state === 'block')) {
        glintT = rand(2.2, 4.0);
        glint(ctx, tipFollow, rand(0.32, 0.45), 0.32, 1.6);
      }

      // 大招定格：空中缓慢飘落的冰晶
      if (fx.time < freezeUntil) {
        const x = self.pos.x;
        fx.emit({ kind: 'flake', count: 3, pos: [x + rand(-2.6, 2.6), rand(1.2, 3.4), rand(-1.4, 1.8)], speed: [0.05, 0.3], life: [1.8, 3.0], size: [0.018, 0.05], color: C.white, color2: C.ice, intensity: 1.6, gravity: 0.3, drag: 0.8, turb: 1.0, spin: 2.5 });
        if (Math.random() < 0.5) fx.emit({ kind: 'glow', count: 1, pos: [x + rand(-2.2, 2.2), rand(0.6, 2.8), rand(-1, 1.8)], speed: [0.05, 0.2], life: [0.6, 1.4], size: [0.03, 0.07], color: C.white, color2: C.cyan, intensity: 2.6, gravity: 0.2, drag: 1 });
        const ft = fx.time - freezeT0;
        if (ft < 0.9 && Math.random() < 0.7) {
          const a = rand(0, 6.283), r = Math.min(6, ft * 9) * rand(0.7, 1);
          fx.emit({ kind: 'mist', count: 1, pos: [x + Math.cos(a) * r, 0.15, Math.sin(a) * r * 0.5], dir: [Math.cos(a), 0, Math.sin(a) * 0.5], cone: 0.2, speed: [0.5, 1.2], life: [1.0, 1.8], size: [0.8, 1.4], grow: 1.8, color: C.frost, color2: C.mist, intensity: 0.35, alpha: 0.28, drag: 1.5 });
        }
      }

      // 大招斩痕：跟着对手、刚出现时亮、之后保持一道冷光；最后一击时一起亮起
      flare = Math.max(0, flare - sdt * 0.5);
      for (const c of cuts) {
        c.s.a.copy(opp.pos).add(c.offA); c.s.b.copy(opp.pos).add(c.offB);
        const age = fx.time - c.born;
        const fl = 0.85 + 0.15 * Math.sin(fx.time * 23 + c.born * 50);
        c.s.mat.uniforms.uCore.value = (1.05 + 2.2 * Math.exp(-age * 9) + flare * 3.2) * fl;
        c.s.width = 0.15 + flare * 0.1;
      }
      if (encase && !encase.h.dead) encase.group.position.copy(opp.pos).add(encaseOff);

      // 对手的霜色
      if (tint > 0 || tintWas) {
        tint = Math.max(0, tint - tintDecay * sdt);
        opp.tintK = tint; opp.tintColor.set(0xbfe9ff);
        tintWas = tint > 0;
      }
      void realBlade;
    },

    onMoveStart(move) {
      curMove = move; lastMf = -1;
      if (move.kind === 'ult') { heatTarget = 1.2; heatHold = 0.6; }
    },

    onMoveEvent(move, ev, self, opp, c) {
      void opp; void c;
      const f = facing(self), s = sc(self), x = self.pos.x;
      if (ev.fx === 'charge') {
        const rel = (move.events ?? []).find((e) => e.fx === 'release' || e.fx === 'dash' || e.fx === 'slam');
        const dur = rel ? Math.max(0.12, (rel.f - ev.f) * DT) : 0.25;
        chargeUntil = fx.time + dur;
        heatTarget = 1.6; heatHold = dur + 0.08;
        fx.flashLight(_a.lerpVectors(base, tip, 0.6), C.light, 10, 4.5, dur + 0.15);
        // 刀身结霜：沿刀身几颗冰晶星点
        for (let i = 0; i < 4; i++) fx.after(i * dur / 4, () => glint(ctx, _b.lerpVectors(base, tip, 0.25 + i * 0.22).clone(), 0.28, 0.2, 1.4, false));
        fx.after(dur * 0.85, () => glint(ctx, tipFollow, 0.75, 0.24, 2.2));
      } else if (ev.fx === 'release') {
        // 霜月斩出手：刀前一道横扫的大弧
        const cy = Math.max(0.9 * s, self.pos.y + 1.1 * s);
        arcFromTo(ctx, _a.set(x + f * 0.1 * s, cy, 0.1), _b.set(-0.2 * f, 0.15, 1), _c.set(0.6 * f, -0.1, -1), 1.35 * s, { sweep: 2.7, width: 0.22, life: 0.2, power: 1.7 });
        fx.emit({ kind: 'mist', count: 6, pos: [x + f * 0.9 * s, cy, 0.1], spread: [0.3, 0.3, 0.2], dir: [f, 0, 0], cone: 0.6, speed: [1, 3], life: [0.6, 1.1], size: [0.6, 1.0], grow: 1.8, color: C.frost, color2: C.mist, intensity: 0.4, alpha: 0.32, drag: 2.5, gravity: 0.3 });
        fx.flashLight([x + f * 1.0 * s, cy, 0.4], C.light, 34, 7, 0.25);
        ctx.cam.addShake(0.18); ctx.gfx.chroma(0.008);
        dust(fx, x, 0.8, -f);
      } else if (ev.fx === 'dash') {
        // 踏雪：起步处炸开一团雪尘，残影，贯穿的细亮直线
        dust(fx, x, 1.6, -f);
        fx.emit({ kind: 'smoke', count: 8, pos: [x, 0.25, 0.05], spread: [0.25, 0.2, 0.2], dir: [-f, 0.4, 0], cone: 1.0, speed: [1, 3.5], life: [0.6, 1.1], size: [0.4, 0.7], grow: 2.5, color: 0xd6e2ee, alpha: 0.3, drag: 2.6, spin: 0.6 });
        fx.emit({ kind: 'flake', count: 20, pos: [x, 0.15, 0.05], spread: [0.3, 0.1, 0.2], dir: [-f, 0.7, 0], cone: 0.9, speed: [2, 6], life: [0.4, 0.9], size: [0.02, 0.06], color: C.white, color2: C.ice, intensity: 1.8, gravity: 10, drag: 1, spin: 9, bounce: 0.3 });
        fx.groundRing(x, 0.05, 2.0, C.white, C.cyan, { life: 0.3, power: 0.8, width: 0.05 });
        // 残影：只烤一次蒙皮（正式模型 4 万多顶点，烤一次十几毫秒），后面几道复用同一份几何体、放在她冲过的位置上
        const g0 = fx.ghost(self.rig.meshes, C.blue, 0.4, 0.9);
        const x0 = self.pos.x;
        for (let i = 1; i <= 3; i++) fx.after(i * 0.022, () => {
          if (g0.dead || g0.age >= g0.life) return;
          const src = g0.mesh as THREE.Group, mat0 = (src.children[0] as THREE.Mesh).material as THREE.ShaderMaterial;
          const mat = mat0.clone(); mat.uniforms.uColorA.value.set(i === 3 ? C.ice : C.cyan); mat.uniforms.uColorB.value.set(i === 3 ? C.ice : C.cyan); mat.uniforms.uPower.value = 0.8 + i * 0.1;
          const grp = new THREE.Group();
          for (const c of src.children) { const m = new THREE.Mesh((c as THREE.Mesh).geometry, mat); m.renderOrder = 18; grp.add(m); }
          grp.position.x = self.pos.x - x0;
          const h = fx.addMesh(grp, 0.32 - i * 0.03, (k) => { mat.uniforms.uLife.value = k; });
          h.geos.length = 0;   // 几何体归第一道残影管
        });
        const y = Math.max(0.85, 1.0 * s);
        dashLine = streak(ctx, new THREE.Vector3(x - f * 0.3, y, 0.3), new THREE.Vector3(x, y, 0.3), { draw: 0.001, life: 0.55, core: 2.4, thin: 0.08, halo: 0.3, width: 0.16, power: 1.3, taper: 0.3 });
        dashUntil = fx.time + 0.12;
        dashFrost = frost(ctx, x, 0.05, x + f * 0.1, 0.05, { width: 0.22, spread: 0.001, life: 2.6, hold: 1.2, front: 0.6, tip: 0.7 });
        fx.emit({ kind: 'spark', count: 14, pos: [x + f * 1.5, y, 0.25], spread: [1.4, 0.4, 0.2], dir: [-f, 0, 0], cone: 0.04, speed: [10, 18], life: [0.08, 0.18], size: [0.012, 0.025], color: C.white, color2: C.ice, intensity: 2, alpha: 0.8 });
        fx.flashLight([x + f * 1.5, y, 0.6], C.light, 22, 7, 0.25);
      } else if (ev.fx === 'slam') {
        // 冰棘：刀插进地面，霜从刀尖向前蔓延
        const px = Math.abs(tip.y) < 0.6 ? tip.x : x + f * 0.8 * s;
        frost(ctx, px, 0.05, px, 0.05, { width: 1.3, zK: 1.3, spread: 0.18, life: 5.5, hold: 3, front: 1.0 });
        fx.groundRing(px, 0.05, 2.6, C.white, C.cyan, { life: 0.35, power: 1.0, width: 0.05 });
        shatter(ctx, _a.set(px, 0.05, 0.1), { count: 18, spread: 0.2, spreadY: 0.1, speed: [2, 5], size: [0.025, 0.07], life: [0.4, 0.8], dir: new THREE.Vector3(0, 1, 0), cone: 0.8, up: 2 });
        fx.emit({ kind: 'smoke', count: 8, pos: [px, 0.1, 0.05], spread: [0.3, 0.05, 0.2], dir: [0, 1, 0], cone: 1.3, speed: [0.8, 2.5], life: [0.6, 1.0], size: [0.35, 0.6], grow: 2.6, color: 0xd0dcea, alpha: 0.25, drag: 2.4 });
        glint(ctx, _b.set(px, 0.15, 0.3), 1.2, 0.25, 2.2, false);
        fx.flashLight([px, 0.5, 0.5], C.light, 36, 7, 0.3);
        ctx.cam.addShake(0.4); ctx.gfx.shockRing(_c.set(px, 0.2, 0), 0.016, 1.1, 0.35);
      }
    },

    onHit(e: HitEvent, pos, self, opp) {
      const f = facing(self);
      if (e.hit.tag === 'cineFinal') return;
      if (e.proj) { if (!e.blocked) tintOpp(0.5, 1.5); return; }   // 飞行道具的命中画面在道具的 end 里做，这里只给对手染一层霜
      if (e.blocked) {
        // 刀被架住：一点冷白的冰屑
        fx.emit({ kind: 'flake', count: 8, pos: [pos.x, pos.y, 0.3], spread: 0.05, dir: [-f, 0.5, 0.2], cone: 1.0, speed: [1.5, 4], life: [0.25, 0.55], size: [0.02, 0.05], color: C.white, color2: C.ice, intensity: 1.8, gravity: 10, drag: 1.5, spin: 9 });
        glint(ctx, _a.set(pos.x, pos.y, 0.35), 0.6, 0.15, 1.8, false);
        if (e.hit.tag === 'dashcut') {
          // 被防住：延迟的斩痕只出一道，在防御上碎开
          fx.after(0.12, () => { opp.chestWorld(_b); streak(ctx, _c.set(_b.x - 0.5 * f, _b.y + 0.4, 0.4), _d.set(_b.x + 0.5 * f, _b.y - 0.4, 0.4), { draw: 0.04, life: 0.3, core: 2.2, width: 0.16, thin: 0.09 }); });
        }
        return;
      }
      const heavy = !!e.hit.heavy;
      if (e.hit.tag === 'dashcut') {
        // 踏雪：先过去，后斩开。零点一几秒以后对手身上一道一道闪出交叉的斩痕，然后冰屑爆开
        const angs = [0.62, -0.55, 0.05];
        angs.forEach((ang, i) => fx.after(0.13 + i * 0.075, () => {
          opp.chestWorld(_b);
          const cx = _b.x + rand(-0.08, 0.08), cy = _b.y + rand(-0.15, 0.05);
          const ux = Math.cos(ang) * f, uy = Math.sin(ang), L = i === 2 ? 1.5 : 1.25;
          streak(ctx, _c.set(cx - ux * L, cy - uy * L, 0.4), _d.set(cx + ux * L, cy + uy * L, 0.4), { draw: 0.035, life: 0.42, core: 3.0, thin: 0.08, halo: 0.35, width: 0.2, power: 1.4, taper: 0.5 });
          fx.emit({ kind: 'spark', count: 6, pos: [cx, cy, 0.4], dir: [ux, uy, 0], cone: 0.1, speed: [7, 13], life: [0.07, 0.14], size: [0.015, 0.03], color: C.white, color2: C.cyan, intensity: 2.5 });
          fx.flashLight([cx, cy, 0.6], C.light, 14, 5, 0.12);
          opp.hitFlash(0.45, 0xdff4ff);
          ctx.cam.addShake(0.12);
        }));
        fx.after(0.13 + 3 * 0.075 + 0.04, () => {
          opp.chestWorld(_b);
          const p = _c.copy(_b).setZ(0.3);
          shatter(ctx, p, { count: 40, spread: 0.3, spreadY: 1.6, speed: [2, 7], size: [0.03, 0.09], life: [0.5, 1.0], up: 1.5 });
          fx.emit({ kind: 'flake', count: 44, pos: [p.x, p.y, 0.3], spread: [0.2, 0.5, 0.2], speed: [2, 8], life: [0.4, 1.0], size: [0.025, 0.08], color: C.white, color2: C.ice, intensity: 2.2, gravity: 10, drag: 1.3, spin: 10, bounce: 0.3 });
          fx.emit({ kind: 'mist', count: 8, pos: [p.x, p.y, 0.3], spread: [0.3, 0.5, 0.2], speed: [0.5, 2.2], life: [0.7, 1.3], size: [0.8, 1.2], grow: 1.8, color: C.frost, color2: C.mist, intensity: 0.5, alpha: 0.4, drag: 2.4, gravity: 0.3 });
          glint(ctx, new THREE.Vector3(p.x, p.y + 0.15, 0.5), 1.4, 0.22, 2.0, false);
          fx.flashLight([p.x, p.y, 0.7], C.light, 36, 8, 0.3);
          ctx.gfx.shockRing(p, 0.02, 1.3, 0.35); ctx.gfx.chroma(0.014);
          ctx.cam.addShake(0.35); opp.jolt(0.8, 'side');
          tintOpp(0.75, 1.4);
        });
        return;
      }
      const p: [number, number, number] = [pos.x, pos.y, 0.3];
      const d = lastSwingDir;
      if (e.hit.limb === 'W' || e.move === 'grab') {
        const k = heavy ? 1 : 0.55;
        fx.emit({ kind: 'flake', count: Math.round(14 * k + 6), pos: p, spread: 0.06, dir: [d.x * 0.6 + f * 0.6, d.y * 0.6 + 0.25, 0.15], cone: 0.8, speed: [2, 7 * k + 2], life: [0.35, 0.85], size: [0.025, 0.075], color: C.white, color2: C.ice, intensity: 2.0, gravity: 10, drag: 1.4, spin: 9, bounce: 0.3 });
        shatter(ctx, _a.set(pos.x, pos.y, 0.3), { count: heavy ? 18 : 7, spread: 0.12, speed: [2, 6 * k + 2], size: [0.025, 0.07], life: [0.4, 0.8], dir: new THREE.Vector3(f, 0.3, 0.1), cone: 1.0, up: 1 });
        glint(ctx, _b.set(pos.x, pos.y, 0.4), heavy ? 1.1 : 0.7, 0.16, 2.0, false);
        if (heavy) {
          fx.emit({ kind: 'mist', count: 4, pos: p, spread: 0.2, dir: [f, 0.2, 0], cone: 1, speed: [0.5, 2], life: [0.6, 1.1], size: [0.6, 1.0], grow: 1.8, color: C.frost, color2: C.mist, intensity: 0.45, alpha: 0.38, drag: 2.4, gravity: 0.3 });
          tintOpp(0.4, 1.5);
        }
        if (e.move === 'grab' && heavy) {
          // 柄尾一捣：一朵小冰花
          iceCluster(ctx, _c.set(pos.x, pos.y, 0.2), { count: 7, height: 0.55, radius: 0.2, rise: 0.04, life: 0.38, mode: 'burst', dir: f });
          fx.after(0.32, () => shatter(ctx, _d.set(pos.x, pos.y, 0.25), { count: 22, spread: 0.25, speed: [1.5, 5], life: [0.4, 0.8], up: 1.5 }));
        }
      }
    },

    projectile(defId, x, y, dir) {
      if (defId === 'crescent') return crescentProj(x, y, dir);
      if (defId === 'icespikes') return spikesProj(x, dir);
      return null;
    },

    // ───────────────────────────── 大招 ─────────────────────────────
    onSuperFreeze(self) {
      const x = self.pos.x, f = facing(self);
      self.chestWorld(_a);
      freezeT0 = fx.time; freezeUntil = fx.time + 1.0;
      heatTarget = 2.6; heatHold = 1.5;
      // 气温骤降：一圈霜在地上向外蔓延
      frost(ctx, x, 0, x, 0, { width: 6.5, zK: 3.2, spread: 0.85, life: 4.2, hold: 2.4, front: 1.3 });
      fx.groundRing(x, 0, 9, C.white, C.cyan, { life: 0.9, power: 1.3, width: 0.03 });
      // 霜的前沿冒出一圈小冰牙
      for (let i = 0; i < 10; i++) {
        const t = rand(0.15, 0.75);
        fx.after(t, () => {
          const r = 6.5 * (1 - Math.pow(1 - t / 0.85, 2.2)) * rand(0.62, 0.78);
          const a = rand(0, 6.283);
          const px = x + Math.cos(a) * r, pz = THREE.MathUtils.clamp(Math.sin(a) * r * 0.5, -1.5, 1.5);
          iceCluster(ctx, _b.set(px, 0, pz), { count: 3, height: rand(0.18, 0.4), radius: 0.15, rise: 0.08, life: 2.6, lean: 0.6, dir: Math.sign(px - x) });
        });
      }
      // 冷光照亮整个画面
      fx.flashLight([_a.x + f * 0.4, _a.y + 0.4, 0.4], C.light, 70, 12, 1.1);
      fx.after(0.05, () => fx.flashLight([x, 0.3, 1.2], 0xbfe6ff, 30, 10, 1.0));
      // 刀身亮到发白：两指从刀根抹到刀尖，一颗星芒沿刀走过去
      for (let i = 0; i <= 8; i++) fx.after(0.12 + i * 0.06, () => glint(ctx, _c.lerpVectors(base, tip, i / 8).clone(), 0.35 + i * 0.03, 0.16, 1.8, false));
      fx.after(0.68, () => { glint(ctx, tipFollow, 1.6, 0.36, 2.6); fx.flashLight(tip, 0xeaf8ff, 30, 6, 0.4); });
      // 脚下的寒气
      fx.emit({ kind: 'mist', count: 10, pos: [x, 0.15, 0], spread: [0.6, 0.1, 0.4], dir: [0, 0.2, 0], cone: 1.4, speed: [0.5, 2.0], life: [1.2, 2.0], size: [0.8, 1.4], grow: 2, color: C.frost, color2: C.mist, intensity: 0.4, alpha: 0.3, drag: 1.6 });
      ctx.gfx.chroma(0.012);
    },

    onCineStart(self, opp) {
      void self; void opp;
      for (const c of cuts) c.s.h.dead = true; cuts.length = 0;
      heatTarget = 0.55; heatHold = 9;
    },

    onCineBeat(beat, final, self, opp) {
      const f = facing(self), s = sc(self);
      const n = self.fighter.def.cine?.beats.length ?? 6;
      opp.chestWorld(_a);
      const cx = _a.x, cy = _a.y;
      if (!final) {
        // 正式动作是 4 刀 + 回旋斩 + 上撩 + 下劈（7 拍）；替身只有 3 拍，就每拍连出几道，让斩痕照样积到六七道
        const spin = n >= 5 && beat === n - 3, up = beat === n - 2;
        const per = Math.max(1, Math.round(6 / Math.max(1, n - 1)));
        const angs = [-0.75, 0.8, 0.02, -0.2 + Math.PI * 0.5 * 0.9, 0.45, -0.35, 1.1, -1.05];
        if (spin) {
          // 回旋斩：一道大的、稍微倾斜的横月牙
          arcFromTo(ctx, _b.set(self.pos.x + f * 0.35 * s, cy, 0.1), _c.set(-f, 0.1, 0.3), _d.set(f, -0.05, 0), 1.15 * s, { sweep: 5.4, n: _e.set(0, 1, 0.55 * f).multiplyScalar(f), width: 0.16, life: 0.22, power: 1.8 });
          addCut(opp, 0.06, 2.1, f, true);
        } else if (up) {
          // 上撩：向上的大月牙 + 上升的冰屑
          arcFromTo(ctx, _b.set(cx - f * 0.3, cy - 0.2, 0.2), _c.set(f * 0.5, -1, 0), _d.set(-f * 0.2, 1, 0), 1.15 * s, { sweep: 2.8, width: 0.26, life: 0.24, power: 1.9, body: 1.6 });
          addCut(opp, 1.25, 2.0, f, true);
          rising(opp);
        }
        const cutsHere = spin || up ? per - 1 : per;
        for (let i = 0; i < cutsHere; i++) fx.after(i * 0.07, () => {
          const ang = angs[cuts.length % angs.length];
          addCut(opp, ang, rand(1.7, 2.0), f);
          // 跟这一刀方向一致的细弧
          opp.chestWorld(_a);
          const ux = Math.cos(ang) * f, uy = Math.sin(ang);
          arcFromTo(ctx, _b.set(_a.x, _a.y, 0.25), _c.set(-ux, -uy, 0.6), _d.set(ux, uy, -0.2), 0.9, { sweep: 2.2, width: 0.18, life: 0.15, power: 1.5 });
          if (i > 0) { glint(ctx, _b.set(_a.x, _a.y, 0.5), 0.6, 0.12, 1.6, false); opp.hitFlash(0.4, 0xdff4ff); }
        });
        glint(ctx, _b.set(cx, cy, 0.5), 0.8, 0.14, 1.8, false);
        fx.flashLight([cx, cy, 0.8], C.light, 22, 6, 0.18);
        tintOpp(Math.min(0.75, 0.2 + beat * 0.12), 0.08);
        return;
      }
      // ── 最后一击：下劈；所有斩痕同时亮起；冰晶封住对手；停一拍；连同斩痕一起炸碎 ──
      arcFromTo(ctx, _b.set(cx - f * 0.2, cy + 0.2, 0.2), _c.set(-f * 0.3, 1, 0), _d.set(f * 0.7, -0.7, 0), 1.25 * s, { sweep: 2.6, width: 0.28, life: 0.11, power: 2.0, body: 1.8 });
      addCut(opp, -1.35, 2.1, f, true);
      flare = 1.0;
      tint = 1; tintDecay = 0;
      opp.chestWorld(_b);
      encaseOff.copy(_b).sub(opp.pos).add(_c.set(0, -0.2, 0.05));
      encase = iceCluster(ctx, _d.copy(opp.pos).add(encaseOff), { count: 22, height: 1.2, radius: 0.5, rise: 0.02, life: 0.4, mode: 'burst', dir: f, power: 1.1, widthK: 1.3, vspread: 0.55 });
      fx.emit({ kind: 'mist', count: 10, pos: [cx, cy, 0.2], spread: [0.4, 0.6, 0.3], speed: [0.3, 1.2], life: [0.6, 1.2], size: [0.8, 1.3], grow: 1.6, color: C.frost, color2: C.mist, intensity: 0.45, alpha: 0.35, drag: 2 });
      fx.flashLight([cx, cy + 0.3, 1.0], 0xd6f0ff, 45, 9, 0.12);
            for (const c of cuts) glint(ctx, _e.addVectors(c.s.a, c.s.b).multiplyScalar(0.5).clone(), 0.9, 0.12, 2.0, false);
      fx.after(0.075, () => {
        const o = lastOpp ?? opp;
        o.chestWorld(_a); const p = _a.clone().setZ(0.3);
        for (const c of cuts) c.s.h.dead = true; cuts.length = 0;
        if (encase) { encase.h.dead = true; encase = null; }
        flare = 0;
        tint = 1; tintDecay = 0.8;
        shatter(ctx, p, { count: 140, spread: 0.55, spreadY: 1.8, speed: [3, 12], size: [0.04, 0.13], life: [0.7, 1.6], up: 2.5, power: 1.2 });
        fx.emit({ kind: 'flake', count: 120, pos: [p.x, p.y, 0.3], spread: [0.4, 0.8, 0.3], speed: [3, 14], life: [0.6, 1.6], size: [0.03, 0.1], color: C.white, color2: C.ice, intensity: 2.4, gravity: 9, drag: 1.1, spin: 10, bounce: 0.3 });
        fx.emit({ kind: 'spark', count: 40, pos: [p.x, p.y, 0.35], spread: 0.2, speed: [8, 20], life: [0.12, 0.3], size: [0.02, 0.04], color: C.white, color2: C.cyan, intensity: 3, drag: 2 });
        fx.emit({ kind: 'glow', count: 14, pos: [p.x, p.y, 0.3], spread: 0.6, speed: [1, 5], life: [0.5, 1.4], size: [0.04, 0.09], color: C.white, color2: C.cyan, intensity: 3, drag: 1.5, gravity: 0.8, turb: 2 });
        glint(ctx, new THREE.Vector3(p.x, p.y, 0.6), 2.8, 0.18, 2.2, false);
        // 雪雾冲击波
        mistRing(ctx, p.x, 0, 28, 7, [1.0, 1.6], 0.3, 0.35);
        mistRing(ctx, p.x, 0, 14, 4, [1.4, 2.2], 0.22, 1.1);
        fx.groundRing(p.x, 0, 11, C.white, C.cyan, { life: 0.7, power: 2.0, width: 0.05 });
        // 地上留下一大片霜和残冰
        frost(ctx, p.x, 0, p.x, 0, { width: 4.6, zK: 2.4, spread: 0.35, life: 9, hold: 5.5, front: 1.0 });
        for (let i = 0; i < 9; i++) {
          const a = rand(0, 6.283), r = rand(0.5, 2.8);
          iceCluster(ctx, _c.set(p.x + Math.cos(a) * r, 0, THREE.MathUtils.clamp(Math.sin(a) * r * 0.45, -1.2, 1.4)), { count: rand(2, 4) | 0, height: rand(0.2, 0.55), radius: 0.2, rise: 0.05, life: rand(4, 5.5), lean: 0.8, dir: Math.cos(a) > 0 ? 1 : -1 });
        }
        fx.flashLight([p.x, p.y + 0.5, 1.2], 0xe6f6ff, 70, 14, 0.6);
        ctx.gfx.flash(0.32, 0xe4f4ff, 9);
        ctx.gfx.shockRing(p, 0.05, 1.5, 0.6, 0.08); ctx.gfx.chroma(0.035); ctx.gfx.radialBlur(0.2, p);
        ctx.cam.shake(1);
        // 余韵：慢慢飘落的冰晶和下沉的寒雾
        for (let i = 0; i < 10; i++) fx.after(0.05 + i * 0.12, () => {
          fx.emit({ kind: 'flake', count: 8, pos: [p.x + rand(-3, 3), rand(2, 4), rand(-1, 1.5)], speed: [0.05, 0.3], life: [1.6, 2.6], size: [0.02, 0.05], color: C.white, color2: C.ice, intensity: 1.6, gravity: 0.6, drag: 0.8, turb: 1, spin: 3 });
          fx.emit({ kind: 'mist', count: 2, pos: [p.x + rand(-2, 2), rand(0.3, 1.5), rand(-0.5, 1)], speed: [0.05, 0.3], life: [1.4, 2.4], size: [1.0, 1.8], grow: 1.6, color: C.frost, color2: C.mist, intensity: 0.3, alpha: 0.25, drag: 1, gravity: 0.15 });
        });
      });
    },

    onCineEnd() {
      for (const c of cuts) c.s.h.dead = true; cuts.length = 0;
      if (encase) { encase.h.dead = true; encase = null; }
      heatHold = 0; flare = 0;
      if (tintDecay === 0) tintDecay = 0.8;
    },

    reset() {
      for (const c of cuts) c.s.h.dead = true; cuts.length = 0;
      encase = null; flare = 0; tint = 0; tintDecay = 2; heat = 0; heatHold = 0; chargeUntil = -1; freezeUntil = -1;
      dashLine = null; dashFrost = null; curMove = null; lastMf = -1; hCount = 0; warmed = false;
      if (lastOpp) lastOpp.tintK = 0;
      tintWas = false;
    },
  };
}
