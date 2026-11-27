import * as THREE from 'three';
import type { FightEvent } from '../combat/types';
import { DT } from '../core/config';
import { clamp, damp, lerp } from '../core/math';
import type { Game, Presenter } from '../game';
import { blockSpark, dust, groundSlam, hitSpark, PAL, parrySpark, windLines } from '../fx/common';
import { Fx, type Trail } from '../fx/core';
import { genericFx } from '../fx/generic';
import type { AudioLike, FighterFx, FighterFxFactory, FxCtx, ProjectileFx } from '../fx/types';
import type { Shot } from '../render/camera';
import type { FighterView } from './fighterView';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3();

// 角色专属特效文件做好了就自动接进来；没有就用元素基线
const FX_MODULES = import.meta.glob<{ default?: FighterFxFactory; createFx?: FighterFxFactory }>('../fx/{yanjin,lingshuang}.ts');

interface Slot {
  fx: FighterFx;
  rim: THREE.PointLight; fill: THREE.PointLight;
  weaponTrail: Trail | null;
  limbTrails: { limb: 'LH' | 'RH' | 'RF' | 'LF' | 'RE' | 'LE' | 'RK' | 'LK'; trail: Trail; from: 'LE' | 'RE' | 'RK' | 'LK' }[];
  stepT: number;
}

/** 把模拟事件变成画面：特效、灯光、镜头、慢动作。 */
export class FightPresenter implements Presenter {
  readonly fx: Fx;
  private slots: Slot[] = [];
  private projFx = new Map<number, ProjectileFx>();
  private projLoops = new Map<number, { stop?: (fade?: number) => void }>();
  private projEl = new Map<number, string>();
  private dimTarget = 0; private dimCur = 0;
  private ctx!: FxCtx;
  audio: AudioLike = { play() {} };
  private freezeBy = -1;
  private koZoom = 0;

  constructor(private game: Game) {
    this.fx = new Fx(game.gfx);
    const self = this;
    this.ctx = {
      fx: this.fx, gfx: game.gfx, cam: game.cam,
      get audio() { return self.audio; },
      slowmo: (s, h) => game.slowmo(s, h, 0.05),
      dim: (k) => { this.dimTarget = k; },
      get time() { return self.fx.time; },
    };
  }

  async onMatchStart(game: Game) {
    // 观战（两边都是电脑）时镜头的导播感调大一点
    game.cam.drama = game.config && game.config.ctrl[0] === 'cpu' && game.config.ctrl[1] === 'cpu' ? 1.8 : 1;
    this.fx.clear(); this.projFx.clear(); this.dimTarget = 0;
    for (const s of this.slots) { game.gfx.scene.remove(s.rim, s.fill); }
    this.slots = [];
    for (const [i, v] of game.views.entries()) {
      const def = game.loaded[i].def, pal = PAL[def.el];
      const base = genericFx(def.el)(this.ctx);
      const slot: Slot = {
        fx: base,
        // 轮廓光：跟在角色身后偏上，颜色是角色的元素色。让角色从暗背景里“剥”出来
        rim: new THREE.PointLight(pal.light, 16, 5.5, 1.8),
        fill: new THREE.PointLight(0xf0f0ff, 11, 7, 1.6),
        weaponTrail: v.rig.weaponBone ? this.fx.trail(pal.core, pal.mid, 0.2, 2.6) : null,
        limbTrails: [], stepT: 0,
      };
      if (!v.rig.weaponBone) {
        for (const [limb, from] of [['LH', 'LE'], ['RH', 'RE'], ['RF', 'RK'], ['LF', 'LK']] as const)
          slot.limbTrails.push({ limb, from, trail: this.fx.trail(pal.hot, pal.deep, 0.16, 2.0) });
      } else {
        slot.limbTrails.push({ limb: 'RF', from: 'RK', trail: this.fx.trail(pal.hot, pal.mid, 0.14, 1.4) });
      }
      game.gfx.scene.add(slot.rim, slot.fill);
      this.slots.push(slot);
      // 专属特效
      const path = `../fx/${def.id}.ts`;
      if (FX_MODULES[path]) {
        FX_MODULES[path]().then((mod) => {
          const factory = mod.default ?? mod.createFx; if (!factory) return;
          const own = factory(this.ctx);
          slot.fx = new Proxy(own, { get: (t, k) => (t as any)[k] ?? (base as any)[k] }) as FighterFx;
        }).catch((e) => console.warn('专属特效载入失败，用基线', def.id, e));
      }
    }
  }

  onMatchEnd() { this.fx.clear(); for (const s of this.slots) { this.game.gfx.scene.remove(s.rim, s.fill); s.fx.reset?.(); } this.slots = []; this.projFx.clear(); }

  // ───────────────────────────── 每帧 ─────────────────────────────
  update(dt: number, sdt: number, game: Game) {
    const m = game.match;
    this.fx.update(sdt);
    (this.audio as any).setTimeScale?.(game.paused ? 1 : game.timeScale);
    this.dimCur = damp(this.dimCur, this.dimTarget, 9, dt);
    game.stage.setDim(this.dimCur);
    game.gfx.look.saturation = lerp(1, 1.12, this.dimCur);
    if (!m) return;
    const alpha = 0;
    for (const [i, v] of game.views.entries()) {
      const s = this.slots[i]; if (!s) continue;
      const f = v.fighter, opp = game.views[1 - i];
      // 轮廓光跟着角色，放在背对对手的那一侧偏后
      v.chestWorld(_a);
      s.rim.position.set(_a.x - f.facing * 1.0, _a.y + 1.25, -1.9);
      s.fill.position.set(_a.x + f.facing * 1.1, _a.y + 1.1, 2.9);   // 镜头一侧偏上的柔光，把脸和胸口托出来
      s.rim.intensity = 16 * (1 + this.dimCur * 2.0); s.fill.intensity = 11 * (1 + this.dimCur * 1.2);

      // 拖尾：出招的命中帧前后才亮
      const mv = f.move;
      let wOn = false; const limbOn = new Set<string>();
      if (mv) for (const h of mv.hits) {
        if (f.mf >= h.f - 7 && f.mf <= h.f + h.a + 5) { if (h.limb === 'W') wOn = true; else if (h.limb) limbOn.add(h.limb); }
      }
      if (game.match!.cine?.att === i) { wOn = true; limbOn.add('LH'); limbOn.add('RH'); }
      if (s.weaponTrail && v.rig.weaponWorld(_b, _c)) s.weaponTrail.update(sdt, this.fx.time, _b, _c, wOn);
      for (const lt of s.limbTrails) {
        const on = limbOn.has(lt.limb) || (lt.limb === 'RH' && limbOn.has('RE')) || (lt.limb === 'LH' && limbOn.has('LE'));
        v.rig.limbWorld(lt.from, _b); v.rig.limbWorld(lt.limb, _c);
        // 尖端往外延一截：拳头、脚尖
        _d.subVectors(_c, _b).multiplyScalar(0.45); _c.add(_d);
        lt.trail.update(sdt, this.fx.time, _b, _c, on && !!mv);
      }
      // 脚步的雪尘
      if (f.state === 'stand' && Math.abs(f.vx) > 0.5) { s.stepT += sdt; if (s.stepT > 0.32) { s.stepT = 0; dust(this.fx, f.x, 0.3, -Math.sign(f.vx)); this.audio.play('step', { volume: 0.35, pan: f.x / 9 }); } }
      s.fx.update?.(sdt, v, opp, this.ctx);
    }
    // 飞行道具的特效跟着模拟里的位置走
    for (const pr of m.projectiles) {
      const h = this.projFx.get(pr.id);
      if (h) h.update(pr.x, pr.def.ground ? 0 : pr.y, sdt);
    }
    void alpha;
    // 终结后的缓慢推近
    game.cam.zoomBias = damp(game.cam.zoomBias, this.koZoom, 2.5, dt);
  }

  // ───────────────────────────── 事件 ─────────────────────────────
  onEvent(e: FightEvent, game: Game) {
    const m = game.match!, fx = this.fx, cam = game.cam, gfx = game.gfx;
    const au = this.audio;
    switch (e.type) {
      case 'hit': {
        const att = game.views[e.att], def = game.views[e.def];
        const el = e.hit.el ?? 'phys';
        const dir = att.fighter.x <= def.fighter.x ? 1 : -1;
        const pos = _a.set(e.x, e.y, 0).clone();
        const heavy = !!e.hit.heavy;
        const power = (heavy ? 1.0 : 0.55) * (e.counter ? 1.25 : 1) * (e.kill ? 1.4 : 1);
        const blade = !!att.rig.weaponBone && e.hit.limb === 'W';
        const pan = clamp(e.x / 9, -1, 1);
        if (e.parry) {
          parrySpark(fx, pos, dir); cam.shake(0.5); gfx.flash(0.35, 0xfff4d8, 9); gfx.chroma(0.02); game.slowmo(0.25, 0.28);
          gfx.shockRing(pos, 0.03, 1.4, 0.4);
          def.hitFlash(0.6, 0xfff2c8);
          au.play('parry', { pan });
        } else if (e.blocked) {
          blockSpark(fx, pos, dir, power, blade || !!def.rig.weaponBone);
          cam.addShake(heavy ? 0.22 : 0.1);
          def.jolt(heavy ? 0.3 : 0.15, 'high');
          au.play(blade || def.rig.weaponBone ? 'block_blade' : 'block', { pan, volume: heavy ? 1 : 0.8 });
        } else {
          hitSpark(fx, pos, dir, power, el);
          def.jolt(heavy ? 1.0 : 0.55, e.hit.react ?? (heavy ? 'heavy' : 'mid'));
          def.hitFlash(heavy ? 0.85 : 0.5, el === 'fire' ? 0xffc890 : el === 'frost' ? 0xcfeeff : 0xffffff);
          cam.addShake(e.hit.shake ?? (heavy ? 0.35 : 0.14)); cam.hitPunch(heavy ? 0.5 : 0.18);
          // 重击把镜头往受击方向甩一下；挑空时镜头压低仰拍
          if (heavy) cam.kick(dir * 0.035, e.hit.knock === 'launch' ? 0.05 : 0);
          if (heavy) { gfx.chroma(0.012 + 0.008 * power); gfx.shockRing(pos, 0.014 * power, 1.3, 0.32); }
          if (e.counter) { gfx.flash(0.18, 0xffffff, 12); }
          if (e.hit.knock === 'launch' || e.hit.knock === 'down') dust(fx, def.fighter.x, 1.2, dir);
          au.play(blade ? 'hit_slash' : heavy ? 'hit_heavy' : 'hit_light', { pan });
          if (el === 'fire' && heavy) au.play('hit_fire', { pan, volume: 0.8 });
          if (el === 'frost' && heavy) au.play('hit_frost', { pan, volume: 0.8 });
          if (e.kill) {
            game.slowmo(0.16, 1.5, 0.07); gfx.flash(0.28, el === 'fire' ? 0xffe2c0 : 0xe2f4ff, 12); gfx.radialBlur(0.2, pos); gfx.chroma(0.04); cam.shake(0.9);
            au.play('ko', { delay: 0.05 });
          }
        }
        this.slots[e.att]?.fx.onHit?.(e, pos, att, def, this.ctx);
        break;
      }
      case 'whiff': {
        const v = game.views[e.who]; au.play(v.rig.weaponBone ? 'whoosh_blade' : e.heavy ? 'whoosh_heavy' : 'whoosh_light', { pan: v.fighter.x / 9, volume: 0.7 });
        break;
      }
      case 'moveStart': {
        const v = game.views[e.who], mv = v.fighter.def.moves[e.move];
        const sl = this.slots[e.who]; if (sl) { sl.weaponTrail?.cut(); for (const lt of sl.limbTrails) lt.trail.cut(); }
        if (mv) this.slots[e.who]?.fx.onMoveStart?.(mv, v, game.views[1 - e.who], this.ctx);
        if (mv && (mv.kind === 'special')) au.play(v.fighter.def.el === 'fire' ? 'fire_charge' : 'frost_charge', { pan: v.fighter.x / 9, volume: 0.8 });
        if (mv && mv.hits.length && mv.kind !== 'ult') au.play(v.rig.weaponBone ? 'whoosh_blade' : mv.hits[0].heavy ? 'whoosh_heavy' : 'whoosh_light', { pan: v.fighter.x / 9, volume: 0.55, delay: Math.max(0, mv.hits[0].f * DT - 0.11) });   // 破风声的最响处在触发后约 0.1 秒，提前放才对得上出手
        break;
      }
      case 'moveEvent': {
        const v = game.views[e.who], mv = v.fighter.def.moves[e.move];
        if (mv && e.ev.fx) this.slots[e.who]?.fx.onMoveEvent?.(mv, e.ev, v, game.views[1 - e.who], this.ctx);
        if (e.ev.fx === 'slam') au.play(v.fighter.def.el === 'fire' ? 'fire_explode' : 'frost_spike', { pan: v.fighter.x / 9 });
        if (e.ev.fx === 'dash') au.play('dash', { pan: v.fighter.x / 9 });
        break;
      }
      case 'projSpawn': {
        const pr = m.projectiles.find((p) => p.id === e.id); if (!pr) break;
        const v = game.views[e.who];
        const h = this.slots[e.who]?.fx.projectile?.(e.def, pr.x, pr.def.ground ? 0 : pr.y, pr.dir, v, this.ctx);
        if (h) this.projFx.set(e.id, h);
        this.projEl.set(e.id, v.fighter.def.el);
        au.play(v.fighter.def.el === 'fire' ? 'fire_blast' : 'frost_wave', { pan: pr.x / 9 });
        if (!pr.def.ground) { const lp = (au as any).loop?.(v.fighter.def.el === 'fire' ? 'fire_fly' : 'frost_fly', { volume: 0.55, pan: pr.x / 9 }); if (lp) this.projLoops.set(e.id, lp); }
        break;
      }
      case 'projEnd': {
        const h = this.projFx.get(e.id); if (h) { h.end(e.x, e.y, e.hit); this.projFx.delete(e.id); }
        const lp = this.projLoops.get(e.id); if (lp) { lp.stop?.(0.08); this.projLoops.delete(e.id); }
        if (e.hit) au.play(this.projEl.get(e.id) === 'frost' ? 'frost_shatter' : 'fire_explode', { pan: e.x / 9, volume: 0.75 });
        this.projEl.delete(e.id);
        break;
      }
      case 'jump': { const f = m.f[e.who]; dust(fx, f.x, 0.7); au.play('jump', { pan: f.x / 9, volume: 0.6 }); break; }
      case 'land': {
        const f = m.f[e.who];
        if (e.hard) { groundSlam(fx, f.x, 0.9); cam.addShake(0.3); game.stage.onImpact?.(f.x, 0.8); au.play('bodyfall', { pan: f.x / 9 }); }
        else { dust(fx, f.x, 0.8); au.play('land', { pan: f.x / 9, volume: 0.6 }); }
        break;
      }
      case 'dash': {
        const f = m.f[e.who];
        windLines(fx, f.x, 1.0 * f.scale, e.dir * f.facing, 1.2); dust(fx, f.x, 0.8, -e.dir * f.facing);
        au.play('dash', { pan: f.x / 9, volume: 0.7 });
        break;
      }
      case 'guardBreak': {
        const v = game.views[e.who]; v.chestWorld(_a);
        fx.airRing(_a, 4, 0xffffff, 0xff5060, { life: 0.4, power: 3 });
        fx.emit({ kind: 'flake', count: 40, pos: _a, spread: 0.3, speed: [3, 10], life: [0.4, 0.9], size: [0.05, 0.13], color: 0xffffff, color2: 0xff8090, intensity: 3, gravity: 10, spin: 10 });
        gfx.flash(0.3, 0xffd0d0, 8); cam.shake(0.6); game.slowmo(0.3, 0.35);
        au.play('guard_break');
        break;
      }
      case 'superFreeze': {
        const v = game.views[e.who], opp = game.views[1 - e.who];
        this.freezeBy = e.who; this.dimTarget = 0.9;
        gfx.flash(0.22, 0xffffff, 12); gfx.chroma(0.03);
        this.slots[e.who]?.fx.onSuperFreeze?.(v, opp, this.ctx);
        // 镜头：硬切到发招者的半身近景，慢慢推近
        const f = v.fighter; v.chestWorld(_a);
        const side = f.facing;
        cam.play([
          { pos: new THREE.Vector3(_a.x + side * 1.7, _a.y + 0.1, 2.6), look: new THREE.Vector3(_a.x - side * 0.1, _a.y + 0.12, 0), fov: 30, dur: 0.95, into: 0.12, push: 0.5, orbit: -side * 0.18 },
        ]);
        au.play('super_freeze');
        (au as any).duck?.(0.8, 1.2);
        fx.after(0.95, () => { if (!game.match?.cine) this.dimTarget = 0.35; });
        fx.after(1.9, () => { if (!game.match?.cine) this.dimTarget = 0; });
        break;
      }
      case 'cineStart': {
        const v = game.views[e.who], opp = game.views[1 - e.who];
        this.dimTarget = 0.75;
        this.slots[e.who]?.fx.onCineStart?.(v, opp, this.ctx);
        cam.play(this.cineShots(v, opp, m.f[e.who].def.cine!.total * DT));
        break;
      }
      case 'cineBeat': {
        const v = game.views[e.who], opp = game.views[1 - e.who];
        const plan = m.f[e.who].def.cine!, b = plan.beats[e.beat];
        const el = v.fighter.def.el;
        const p = b.limb ? v.rig.limbWorld(b.limb, _a).clone() : opp.chestWorld(_a).clone();
        opp.chestWorld(_b); p.lerp(_b, 0.6);
        // 最后一击的主体由角色专属特效来做，通用火花只垫一层小的
        hitSpark(fx, p, v.fighter.facing, e.final ? 0.9 : b.heavy ? 1.0 : 0.75, el);
        opp.jolt(e.final ? 1.3 : 0.9, b.react); opp.hitFlash(0.8, el === 'fire' ? 0xffc890 : 0xcfeeff);
        cam.addShake(e.final ? 1 : 0.3); cam.hitPunch(e.final ? 0.8 : 0.3); gfx.chroma(e.final ? 0.04 : 0.012);
        au.play(v.rig.weaponBone ? 'hit_slash' : 'hit_heavy', { pan: p.x / 9 });
        if (e.final) { game.slowmo(0.14, 0.9, 0.08); au.play(el === 'fire' ? 'super_fire' : 'super_frost'); }
        this.slots[e.who]?.fx.onCineBeat?.(e.beat, e.final, v, opp, this.ctx);
        break;
      }
      case 'cineEnd': { this.dimTarget = 0; this.slots[e.who]?.fx.onCineEnd?.(game.views[e.who], game.views[1 - e.who], this.ctx); break; }
      case 'ko': { this.koZoom = -1.0; break; }
      case 'round': {
        if (e.phase === 'intro') {
          this.koZoom = 0; this.dimTarget = 0; this.fx.clear(); this.projFx.clear();
          for (const s of this.slots) s.fx.reset?.();
          if (e.round === 1) cam.play(this.introShots(game));
        } else if (e.phase === 'win' && e.winner !== undefined && e.winner >= 0) {
          this.koZoom = 0;
          const v = game.views[e.winner]; v.chestWorld(_a); const side = v.fighter.facing;
          cam.play([
            { pos: new THREE.Vector3(_a.x + side * 2.4, _a.y - 0.25, 3.6), look: new THREE.Vector3(_a.x, _a.y + 0.05, 0), fov: 30, dur: 3.6, into: 0.9, push: 0.5, orbit: side * 0.3 },
          ]);
        }
        break;
      }
    }
  }

  /** 开场：先给一号位一个低机位的环绕近景，再给二号位，最后拉回对战机位。 */
  private introShots(game: Game): Shot[] {
    const shots: Shot[] = [];
    const total = game.match!.introFrames * DT;
    const each = Math.max(1.2, (total - 0.6) / 2);
    for (const v of game.views) {
      const x = v.fighter.x, side = v.fighter.facing, h = v.fighter.def.height;
      shots.push({ pos: new THREE.Vector3(x + side * 2.6, h * 0.42, 3.3), look: new THREE.Vector3(x + side * 0.15, h * 0.6, 0), fov: 34, dur: each, into: 0, push: 0.7, orbit: -side * 0.35 });
    }
    return shots;
  }

  /** 大招演出的分镜：开头贴近攻击方 → 侧面中景看连打 → 最后一击前低机位仰拍。 */
  private cineShots(att: FighterView, def: FighterView, total: number): Shot[] {
    const ax = att.fighter.x, dx = def.fighter.x, side = att.fighter.facing, mid = (ax + dx) / 2;
    const h = att.fighter.def.height;
    const t1 = total * 0.22, t2 = total * 0.4, t3 = total - t1 - t2;
    return [
      { pos: new THREE.Vector3(ax - side * 1.5, h * 0.8, 2.6), look: new THREE.Vector3(dx, h * 0.62, 0), fov: 36, dur: t1, into: 0.18, push: 0.5, orbit: side * 0.2 },
      { pos: new THREE.Vector3(mid, h * 0.55, 4.6), look: new THREE.Vector3(mid, h * 0.58, 0), fov: 34, dur: t2, into: 0.25, push: 0.7, orbit: -side * 0.22 },
      { pos: new THREE.Vector3(dx + side * 2.6, h * 0.22, 3.4), look: new THREE.Vector3(mid + side * 0.2, h * 0.75, 0), fov: 40, dur: t3, into: 0.3, push: 0.4, orbit: side * 0.25 },
    ];
  }
}
