import * as THREE from 'three';
import type { Element } from '../combat/types';
import { rand } from '../core/math';
import { dust, groundSlam, PAL, windLines } from './common';
import type { FighterFx, FxCtx, ProjectileFx } from './types';

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

/**
 * 按元素出的一套基线特效：火 / 霜两种配色，结构相同。
 * 角色专属的特效文件（yanjin.ts、lingshuang.ts）在这个基础上重写、加料；专属文件没实现的钩子就落到这里。
 */
export function genericFx(el: Element): (ctx: FxCtx) => FighterFx {
  return () => {
    const pal = PAL[el];
    const fire = el === 'fire';
    let auraT = 0;
    return {
      update(sdt, self, _opp, ctx) {
        // 出技能、大招时手上（刀上）持续冒元素粒子
        const f = self.fighter;
        const m = f.move;
        auraT += sdt;
        if (m && (m.kind === 'special' || m.kind === 'ult') && auraT > 0.03) {
          auraT = 0;
          const hasW = self.rig.weaponWorld(_a, _b);
          const p = hasW ? _c.lerpVectors(_a, _b, Math.random()) : self.rig.limbWorld('RH', _c);
          if (fire) ctx.fx.emit({ kind: 'flame', count: 2, pos: p, spread: 0.06, speed: [0.2, 1.0], life: [0.2, 0.42], size: [0.22, 0.42], grow: 1.5, color: pal.hot, color2: pal.deep, intensity: 2.2, gravity: -2.4, drag: 2 });
          else ctx.fx.emit({ kind: 'mist', count: 1, pos: p, spread: 0.08, speed: [0.1, 0.6], life: [0.3, 0.6], size: [0.3, 0.55], grow: 1.6, color: pal.hot, color2: pal.mid, intensity: 0.7, alpha: 0.5, gravity: 0.6, drag: 2 });
          ctx.fx.emit({ kind: 'dot', count: 1, pos: p, spread: 0.1, speed: [0.3, 1.5], life: [0.3, 0.7], size: [0.015, 0.035], color: pal.core, color2: pal.mid, intensity: 5, gravity: fire ? -1.5 : 1.5, drag: 1.5, turb: 4 });
        }
      },

      onMoveEvent(move, ev, self, _opp, ctx) {
        const f = self.fighter, x = self.pos.x, dir = f.facing;
        if (ev.fx === 'charge') {
          const p = self.rig.weaponWorld(_a, _b) ? _b.clone() : self.rig.limbWorld('RH', _c).clone();
          // 向手上汇聚的粒子
          for (let i = 0; i < 18; i++) {
            const a = Math.random() * 6.283, r = rand(0.7, 1.3);
            ctx.fx.emit({ kind: 'spark', count: 1, pos: [p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, p.z + rand(-0.3, 0.3)], dir: [-Math.cos(a), -Math.sin(a), 0], cone: 0.05, speed: [r * 3.5, r * 4.5], life: [0.2, 0.28], size: [0.025, 0.045], color: pal.core, color2: pal.mid, intensity: 4 });
          }
          ctx.fx.flashLight(p, pal.light, 12, 5, 0.4);
        } else if (ev.fx === 'release') {
          const p: [number, number, number] = [x + dir * 1.0 * f.scale, 1.22 * f.scale, 0.2];
          ctx.fx.emit({ kind: 'glow', count: 1, pos: p, size: [1.3, 1.5], life: [0.12, 0.16], color: pal.core, color2: pal.mid, intensity: 7, grow: 1.5 });
          ctx.fx.airRing(_a.set(p[0], p[1], p[2]), 2.6, pal.core, pal.mid, { life: 0.28, power: 3 });
          ctx.fx.emit({ kind: 'spark', count: 22, pos: p, dir: [dir, 0, 0], cone: 0.9, speed: [4, 13], life: [0.15, 0.4], size: [0.03, 0.06], color: pal.core, color2: pal.mid, intensity: 5, drag: 2.5 });
          ctx.fx.flashLight(p, pal.light, 40, 8, 0.25);
          ctx.cam.addShake(0.25); ctx.gfx.chroma(0.012);
          dust(ctx.fx, x, 1.0, -dir);
        } else if (ev.fx === 'dash') {
          windLines(ctx.fx, x, 1.0 * f.scale, dir, 2.5, pal.hot);
          dust(ctx.fx, x, 1.2, -dir);
          ctx.fx.ghost(self.rig.meshes, pal.mid, 0.4, 1.6);
          for (let i = 1; i <= 3; i++) ctx.fx.after(i * 0.045, () => ctx.fx.ghost(self.rig.meshes, pal.mid, 0.34, 1.3));
        } else if (ev.fx === 'slam') {
          const sx = x + dir * 0.9 * f.scale;
          groundSlam(ctx.fx, sx, 1.4, el);
          ctx.fx.decal(sx, 0, 3.2, 2, pal.hot, pal.core, 5);
          ctx.fx.decal(sx, 0, 3.6, fire ? 0 : 1, pal.hot, pal.core, 7);
          ctx.fx.flashLight([sx, 0.5, 0], pal.light, 50, 9, 0.3);
          ctx.cam.addShake(0.55); ctx.gfx.shockRing(_a.set(sx, 0.3, 0), 0.02, 1.2, 0.4);
        }
      },

      onHit(e, pos, _self, _opp, ctx) {
        if (e.blocked) return;
        if (e.hit.heavy) {
          // 重击多一层：地面的元素痕迹
          if (e.y < 0.5) ctx.fx.decal(e.x, 0, 1.8, fire ? 0 : 1, pal.hot, pal.core, 5);
          ctx.fx.emit({ kind: fire ? 'flame' : 'mist', count: 6, pos, spread: 0.3, speed: [0.5, 2.5], life: [0.3, 0.7], size: [0.5, 0.9], grow: 1.6, color: pal.hot, color2: pal.deep, intensity: fire ? 2.4 : 0.6, alpha: fire ? 1 : 0.5, gravity: fire ? -2 : 0.3, drag: 2 });
        }
      },

      projectile(defId, x, y, dir, _self, ctx): ProjectileFx {
        const ground = defId === 'firepillar' || defId === 'icespikes';
        let t = 0, lastStep = x, px = x;
        if (ground) {
          // 贴地推进：每前进一段就在地上冒一根
          const spawn = (sx: number) => {
            if (fire) {
              ctx.fx.pillar(sx, rand(-0.25, 0.25), 0.42, rand(2.0, 2.7), pal.hot, pal.deep, { life: 0.6, power: 3.2 });
              ctx.fx.emit({ kind: 'flame', count: 8, pos: [sx, 0.4, 0], spread: [0.25, 0.3, 0.25], dir: [0, 1, 0], cone: 0.35, speed: [3, 7], life: [0.3, 0.6], size: [0.5, 0.9], grow: 1.4, color: pal.hot, color2: pal.deep, intensity: 2.6, gravity: -3, drag: 1.5 });
              ctx.fx.emit({ kind: 'dot', count: 14, pos: [sx, 0.3, 0], spread: [0.3, 0.2, 0.3], dir: [0, 1, 0], cone: 0.5, speed: [3, 9], life: [0.5, 1.2], size: [0.02, 0.045], color: pal.hot, color2: pal.deep, intensity: 5, gravity: 2, drag: 1, turb: 6 });
              ctx.fx.decal(sx, 0, 1.6, 0, pal.hot, pal.core, 6);
            } else {
              iceSpike(ctx, sx, rand(-0.2, 0.2), rand(1.5, 2.1), dir);
              ctx.fx.decal(sx, 0, 1.7, 1, pal.hot, pal.core, 7);
            }
            ctx.fx.flashLight([sx, 0.8, 0], pal.light, 28, 6, 0.25);
            ctx.cam.addShake(0.18);
          };
          spawn(x);
          return {
            update(nx) { px = nx; if (Math.abs(nx - lastStep) >= 0.7) { lastStep = nx; spawn(nx); } },
            end() { /* 贴地技自己放完 */ },
          };
        }
        // 飞行道具：一个发光的核 + 拖在后面的元素粒子 + 跟着走的光
        const core = new THREE.Group();
        let arc: THREE.Mesh | null = null;
        if (!fire) {
          // 月牙冰刃
          const h = ctx.fx.slash(_a.set(x, y, 0), 0.95, -1.15, 1.15, pal.core, pal.mid, { width: 0.42, life: 9, power: 3.2, grow: 0 });
          arc = h.mesh as THREE.Mesh; arc.scale.x = dir; (h as any)._keep = h;
          (core as any).h = h;
        }
        const light = ctx.fx.flashLight([x, y, 0], pal.light, 22, 6, 9);
        return {
          update(nx, ny, dt) {
            t += dt; px = nx;
            light.light.position.set(nx, ny, 0.8); light.age = 0; light.peak = 22 + Math.sin(t * 40) * 5;
            if (arc) { arc.position.set(nx, ny, 0); const mat = arc.material as THREE.ShaderMaterial; mat.uniforms.uLife.value = 0.12 + Math.sin(t * 25) * 0.03; }
            if (fire) {
              ctx.fx.emit({ kind: 'glow', count: 1, pos: [nx, ny, 0.1], size: [0.9, 1.05], life: [0.05, 0.07], color: pal.core, color2: pal.hot, intensity: 5 });
              ctx.fx.emit({ kind: 'flame', count: 4, pos: [nx - dir * 0.15, ny, 0], spread: 0.16, dir: [-dir, 0.1, 0], cone: 0.5, speed: [0.5, 3], life: [0.2, 0.45], size: [0.5, 0.85], grow: 1.3, color: pal.hot, color2: pal.deep, intensity: 2.8, gravity: -1.5, drag: 2, spin: 3 });
              ctx.fx.emit({ kind: 'dot', count: 2, pos: [nx, ny, 0], spread: 0.2, dir: [-dir, 0.3, 0], cone: 0.9, speed: [1, 4], life: [0.4, 0.9], size: [0.02, 0.04], color: pal.hot, color2: pal.deep, intensity: 5, gravity: -0.8, drag: 1.5, turb: 5 });
              if (Math.random() < 0.3) ctx.fx.emit({ kind: 'smoke', count: 1, pos: [nx - dir * 0.4, ny + 0.1, 0], spread: 0.1, speed: [0.2, 0.8], life: [0.5, 0.9], size: [0.4, 0.6], grow: 2, color: pal.smoke, alpha: 0.4, gravity: -0.8, drag: 1.5 });
            } else {
              ctx.fx.emit({ kind: 'flake', count: 3, pos: [nx - dir * 0.2, ny, 0], spread: [0.1, 0.7, 0.1], dir: [-dir, 0, 0], cone: 0.6, speed: [0.5, 3], life: [0.3, 0.7], size: [0.03, 0.07], color: pal.core, color2: pal.hot, intensity: 2.6, gravity: 5, drag: 1.5, spin: 9 });
              ctx.fx.emit({ kind: 'mist', count: 1, pos: [nx - dir * 0.3, ny, 0], spread: [0.1, 0.5, 0.1], speed: [0.1, 0.6], life: [0.4, 0.8], size: [0.6, 1.0], grow: 1.6, color: pal.hot, color2: pal.mid, intensity: 0.5, alpha: 0.4, drag: 2 });
              if (Math.random() < 0.5) ctx.fx.decal(nx, 0, 0.9, 1, pal.hot, pal.core, 3.5);
            }
          },
          end(ex, ey, hit) {
            light.life = 0.2; light.age = 0; light.peak = hit ? 60 : 10;
            const h = (core as any).h; if (h) h.dead = true;
            const p: [number, number, number] = [ex, ey, 0.2];
            if (hit) {
              ctx.fx.emit({ kind: 'glow', count: 1, pos: p, size: [2.0, 2.4], life: [0.14, 0.2], color: pal.core, color2: pal.mid, intensity: 7, grow: 1.5 });
              ctx.fx.airRing(_a.set(ex, ey, 0.2), 3.6, pal.core, pal.mid, { life: 0.35, power: 3 });
              if (fire) {
                ctx.fx.emit({ kind: 'flame', count: 26, pos: p, spread: 0.3, speed: [1.5, 6], life: [0.3, 0.75], size: [0.6, 1.3], grow: 1.5, color: pal.hot, color2: pal.deep, intensity: 2.8, gravity: -2.5, drag: 2.4, spin: 2 });
                ctx.fx.emit({ kind: 'smoke', count: 8, pos: p, spread: 0.4, speed: [0.5, 2.5], life: [0.8, 1.6], size: [0.8, 1.3], grow: 2, color: pal.smoke, alpha: 0.5, gravity: -1.2, drag: 1.4 });
                ctx.fx.emit({ kind: 'dot', count: 40, pos: p, spread: 0.2, speed: [2, 10], life: [0.5, 1.4], size: [0.02, 0.05], color: pal.hot, color2: pal.deep, intensity: 5, gravity: 3, drag: 1.2, turb: 5, bounce: 0.3 });
              } else {
                ctx.fx.emit({ kind: 'flake', count: 50, pos: p, spread: 0.2, speed: [2, 11], life: [0.4, 1.1], size: [0.04, 0.12], color: pal.core, color2: pal.hot, intensity: 2.8, gravity: 12, drag: 1.2, spin: 10, bounce: 0.35 });
                ctx.fx.emit({ kind: 'mist', count: 10, pos: p, spread: 0.5, speed: [0.5, 3], life: [0.6, 1.2], size: [1.0, 1.8], grow: 1.7, color: pal.hot, color2: pal.mid, intensity: 0.6, alpha: 0.5, drag: 2.2 });
              }
              ctx.gfx.shockRing(_a.set(ex, ey, 0), 0.022, 1.3, 0.4);
            } else {
              ctx.fx.emit({ kind: fire ? 'flame' : 'mist', count: 6, pos: p, spread: 0.3, speed: [0.3, 1.5], life: [0.3, 0.6], size: [0.5, 0.9], color: pal.hot, color2: pal.deep, intensity: fire ? 2 : 0.5, alpha: fire ? 1 : 0.4, gravity: fire ? -1.5 : 0, drag: 2 });
            }
          },
        };
      },

      onSuperFreeze(self, _opp, ctx) {
        const p = self.chestWorld(_a).clone();
        ctx.fx.emit({ kind: 'glow', count: 1, pos: p, size: [3.5, 4], life: [0.5, 0.6], color: pal.hot, color2: pal.deep, intensity: 2.2, grow: 1.4, alpha: 0.7 });
        ctx.fx.groundRing(self.pos.x, 0, 7, pal.core, pal.mid, { life: 0.8, power: 3, width: 0.05 });
        for (let i = 0; i < 12; i++) ctx.fx.after(i * 0.07, () => {
          const q = self.chestWorld(_b);
          ctx.fx.emit({ kind: fire ? 'flame' : 'mist', count: 6, pos: [q.x, 0.3, 0], spread: [0.5, 0.2, 0.4], dir: [0, 1, 0], cone: 0.3, speed: [2, 6], life: [0.4, 0.8], size: [0.5, 1.0], grow: 1.4, color: pal.hot, color2: pal.deep, intensity: fire ? 2.6 : 0.8, alpha: fire ? 1 : 0.6, gravity: fire ? -4 : -1.5, drag: 1.2 });
          ctx.fx.emit({ kind: 'dot', count: 10, pos: [q.x, 0.2, 0], spread: [0.8, 0.1, 0.5], dir: [0, 1, 0], cone: 0.25, speed: [2, 7], life: [0.5, 1.2], size: [0.02, 0.05], color: pal.core, color2: pal.mid, intensity: 6, gravity: -2, drag: 0.8, turb: 5 });
        });
        ctx.fx.flashLight([p.x, p.y, 0], pal.light, 60, 10, 0.9);
      },

      onCineBeat(_beat, final, _self, opp, ctx) {
        const p = opp.chestWorld(_a).clone();
        if (!final) return;
        // 最后一击：一根冲天的元素柱 + 满屏的碎屑
        const x = p.x;
        ctx.fx.pillar(x, 0, 1.1, 7.5, pal.hot, pal.deep, { life: 1.0, power: 1.9 });
        ctx.fx.pillar(x, 0, 0.5, 9, pal.core, pal.hot, { life: 0.7, power: 2.2 });
        groundSlam(ctx.fx, x, 2.2, el);
        ctx.fx.decal(x, 0, 5.5, 2, pal.hot, pal.core, 8);
        ctx.fx.decal(x, 0, 6.5, fire ? 0 : 1, pal.hot, pal.core, 10);
        ctx.fx.emit({ kind: 'dot', count: 120, pos: [x, 0.5, 0], spread: [0.8, 0.5, 0.6], dir: [0, 1, 0], cone: 0.7, speed: [4, 16], life: [0.8, 2.0], size: [0.025, 0.06], color: pal.core, color2: pal.mid, intensity: 6, gravity: 5, drag: 0.8, turb: 6, bounce: 0.3 });
        ctx.fx.emit({ kind: fire ? 'flame' : 'flake', count: 60, pos: [x, 1, 0], spread: [0.6, 1, 0.5], speed: [2, 9], life: [0.5, 1.2], size: fire ? [0.7, 1.5] : [0.06, 0.16], grow: fire ? 1.5 : 1, color: pal.hot, color2: pal.deep, intensity: fire ? 1.6 : 1.6, gravity: fire ? -3 : 10, drag: 1.5, spin: fire ? 2 : 10 });
        ctx.fx.flashLight([x, 1.5, 0], pal.light, 90, 16, 0.7);
        ctx.gfx.flash(0.5, fire ? 0xffd9a8 : 0xd8f2ff, 10);
        ctx.gfx.shockRing(p, 0.05, 1.5, 0.6, 0.08); ctx.gfx.chroma(0.035); ctx.gfx.radialBlur(0.22, p);
        ctx.cam.shake(1);
      },
    };
  };
}

/** 一根从地里刺出来的冰刺：几片棱柱叠成一簇，带菲涅尔的冰质感，长出来、停一下、碎掉。 */
export function iceSpike(ctx: FxCtx, x: number, z: number, height: number, dir: number) {
  const pal = PAL.frost;
  const group = new THREE.Group();
  const mat = ctx.fx.material(/* glsl */ `precision highp float; varying vec2 vUv; varying vec3 vWorld; varying vec3 vNormalW; varying vec3 vView;
    uniform sampler2D uNoise; uniform float uTime; uniform float uLife; uniform vec3 uColorA; uniform vec3 uColorB; uniform float uPower; uniform float uSeed;
    void main() {
      vec3 n = (dot(vNormalW, vNormalW) > 1e-12 ? normalize(vNormalW) : vec3(0.0, 1.0, 0.0));
      float f = ((1.0 - abs(dot(n, vView))) * (1.0 - abs(dot(n, vView))));
      float inner = texture2D(uNoise, vWorld.xy * 0.9 + uSeed).b;
      float spec = pow(max(dot(reflect(-vView, n), normalize(vec3(-0.4, 0.8, 0.5))), 0.0), 24.0);
      float tipGlow = smoothstep(0.0, 1.0, vUv.y);
      vec3 col = mix(uColorB * 0.35, uColorA, f) + uColorA * spec * 2.5 + uColorB * (1.0 - inner) * 0.35 + uColorA * tipGlow * 0.4;
      float a = (0.55 + f * 0.45) * (1.0 - smoothstep(0.82, 1.0, uLife));
      gl_FragColor = vec4(col * uPower, a);
    }`, pal.core, pal.mid, 1.5, {}, { blending: THREE.NormalBlending, side: THREE.FrontSide });
  const n = 4;
  for (let i = 0; i < n; i++) {
    const h = height * (i === 0 ? 1 : rand(0.45, 0.8)), r = h * rand(0.09, 0.13);
    const g = new THREE.ConeGeometry(r, h, 5, 1); g.translate(0, h / 2, 0);
    const m = new THREE.Mesh(g, mat);
    m.position.set(i === 0 ? 0 : rand(-0.35, 0.35), 0, i === 0 ? 0 : rand(-0.3, 0.3));
    m.rotation.set(rand(-0.25, 0.25), rand(0, 6.28), (i === 0 ? 0.12 : rand(-0.4, 0.4)) * -dir);
    group.add(m);
  }
  group.position.set(x, 0, z);
  let broke = false;
  ctx.fx.addMesh(group, 0.95, (k) => {
    mat.uniforms.uLife.value = k;
    const grow = Math.min(1, k / 0.12);
    const e = 1 - Math.pow(1 - grow, 3);
    group.scale.set(0.7 + 0.3 * e, e * (1 + 0.12 * Math.sin(Math.min(1, k / 0.2) * Math.PI)), 0.7 + 0.3 * e);
    if (k > 0.8 && !broke) {
      broke = true;
      ctx.fx.emit({ kind: 'flake', count: 26, pos: [x, height * 0.5, z], spread: [0.25, height * 0.45, 0.25], speed: [1, 5], life: [0.4, 0.9], size: [0.05, 0.14], color: pal.core, color2: pal.hot, intensity: 2.4, gravity: 12, drag: 1, spin: 10, bounce: 0.3 });
      ctx.fx.emit({ kind: 'mist', count: 5, pos: [x, height * 0.4, z], spread: [0.3, height * 0.4, 0.3], speed: [0.2, 1.2], life: [0.5, 1.0], size: [0.8, 1.3], grow: 1.6, color: pal.hot, color2: pal.mid, intensity: 0.5, alpha: 0.45, drag: 2 });
    }
  });
  ctx.fx.emit({ kind: 'flake', count: 12, pos: [x, 0.1, z], spread: [0.3, 0.05, 0.3], dir: [0, 1, 0], cone: 0.8, speed: [2, 7], life: [0.3, 0.7], size: [0.04, 0.1], color: pal.core, color2: pal.hot, intensity: 2.4, gravity: 12, spin: 10 });
  ctx.fx.emit({ kind: 'mist', count: 3, pos: [x, 0.2, z], spread: [0.4, 0.1, 0.3], speed: [0.3, 1.5], life: [0.5, 1.0], size: [0.8, 1.2], grow: 1.6, color: pal.hot, color2: pal.mid, intensity: 0.5, alpha: 0.5, drag: 2 });
}
