// 被动 · 烬痕引爆。分镜：
//   头顶三格记号（尖菱形，空格是暗绯的描边）：每打中一下亮一格（弹一下、一颗小星芒）；叠满三格的那一下三格一起白热、往下一收钻进胸口
//   引爆（第三下后 0.08 秒，和 Codex 那版同一时刻）：
//     0.00  顿帧 0.07、目标整个闪白；白热闪核（硬边白圆胀开成环）+ 星芒
//     0.02  绯红的花（即梦出的八瓣尖花）从 0.25 倍猛地绽开到 3.4 米，开头整朵过曝成白、0.1 秒露出绯红和品红，转一点；
//           0.2 秒起从中心往外碎掉（花瓣先空心、再从根上断开、尖端最后没）
//     同时  外圈两道地面冲击环、一把金白火花、十片旋转的绯红碎片、几道往上窜的光刺；地上留一朵花形的印（亮绯 → 冷成暗疤）
//     0.6   余烬往上飘，散完
import * as THREE from "three";
import type { Demo, FxCtx, FxHandle, LabActor } from "../api";
import { GLSL_COMMON, chest, kit, sequence, vec } from "./kit";
import { strike } from "./hit";

const markMat = new THREE.ShaderMaterial({
  uniforms: { uF0: { value: 0 }, uF1: { value: 0 }, uF2: { value: 0 }, uP0: { value: 0 }, uP1: { value: 0 }, uP2: { value: 0 }, uFull: { value: 0 }, uA: { value: 1 } },
  transparent: true, depthTest: false, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  vertexShader: `varying vec2 vQ; void main() { vQ = position.xy; vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0); mv.xy += position.xy * vec2(modelMatrix[0][0], modelMatrix[1][1]); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: /* glsl */ `
    ${GLSL_COMMON}
    uniform float uF0, uF1, uF2, uP0, uP1, uP2, uFull, uA; varying vec2 vQ;
    // 一格：上尖长、下尖短的菱形（像一簇火苗的剪影），f 亮了没有，p 刚亮时弹一下（1 → 0）
    vec4 icon(vec2 q, float f, float p) {
      q /= (1.0 + 0.45 * p);
      float d = abs(q.x) / 0.5 + (q.y > 0.0 ? q.y / 1.0 : -q.y / 0.55);
      float inside = 1.0 - smoothstep(0.93, 1.0, d);
      float rim = (1.0 - smoothstep(0.08, 0.16, abs(d - 0.86))) * inside;
      float core = 1.0 - smoothstep(0.0, 0.55, length(q * vec2(1.6, 1.0) - vec2(0.0, -0.08)));
      vec3 c = mix(CRIM, BRIGHT, 0.25 + 0.5 * (1.0 - d));
      vec3 lit = c * inside + HOT * rim * 0.6 + WHITE * core * 0.9;
      vec3 off = DEEP * rim * 0.9 + DEEP * inside * 0.25;
      float aLit = inside, aOff = max(rim * 0.85, inside * 0.3);
      vec3 rgb = mix(off, lit, f); float a = mix(aOff, aLit, f);
      rgb = mix(rgb, WHITE * inside, uFull * 0.85);
      return vec4(rgb, a);
    }
    void main() {
      vec2 q = vQ * vec2(3.0, 1.2);            // 三格横排：每格占 x 方向 2 个单位
      vec4 s = vec4(0.0);
      s += icon((q - vec2(-2.0, 0.0)) * 1.25, uF0, uP0);
      s += icon((q - vec2(0.0, 0.0)) * 1.25, uF1, uP1);
      s += icon((q - vec2(2.0, 0.0)) * 1.25, uF2, uP2);
      gl_FragColor = vec4(s.rgb, min(s.a, 1.0)) * uA;
    }`,
});

class Marks implements FxHandle {
  mesh: THREE.Mesh; mat: THREE.ShaderMaterial; n = 0; pops = [0, 0, 0]; t = 0; full = -1; gone = false;
  constructor(public t0: LabActor) {
    this.mat = markMat.clone();
    const g = new THREE.PlaneGeometry(2, 2); this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 40; kit().group.add(this.mesh);
    this.place(0);
  }
  place(k: number) {      // k: 0 在头顶，1 钻进胸口
    const p = this.t0.obj.position, top = this.t0.height + 1.15,      /* 血条在身高 + 0.62 米，记号要在血条上面，游戏镜头下才不叠 */ c = this.t0.height * 0.5, y = top + (c - top) * k * k;
    this.mesh.position.set(p.x, y, p.z); const s = 1 - 0.85 * k; this.mesh.scale.set(1.5 * s, 0.56 * s, 1);
  }
  set(n: number) { this.n = n; this.pops[n - 1] = 1; if (n >= 3) this.full = this.t; }
  update(dt: number) {
    this.t += dt; const u = this.mat.uniforms;
    for (let i = 0; i < 3; i++) { this.pops[i] = Math.max(0, this.pops[i] - dt / 0.14); (u as any)[`uF${i}`].value = this.n > i ? 1 : 0; (u as any)[`uP${i}`].value = this.pops[i] * this.pops[i]; }
    if (this.full >= 0) { const k = (this.t - this.full); u.uFull.value = Math.min(1, k / 0.03); const ck = THREE.MathUtils.clamp((k - 0.04) / 0.05, 0, 1); this.place(ck); u.uA.value = ck >= 1 ? 0 : 1; }
    return true;
  }
  dispose() { kit().group.remove(this.mesh); this.mesh.geometry.dispose(); this.mat.dispose(); }
}

export const DETONATE_DELAY = 0.08;
export function detonate(ctx: FxCtx, t: LabActor) {
  const K = kit(), c = chest(t, 0.5), p = t.obj.position;
  t.hit(1); ctx.hitstop(0.05); ctx.shake(0.3, 0.28); ctx.flash(0.12, 0.08, 0xffc8dc);
  // 返工：白热那一下换成一颗锐利的星芒一闪（原来闪核白圆 + 花整朵过曝，是 0.1 秒糊的白粉球）；花缩到 65%（被动打得频繁，不能每次把人盖住）
  K.stars.add({ pos: c, size: 2.5, life: 0.13, kind: 0, rot: 0.4 });
  K.stars.add({ pos: c, size: t.height * 0.4, life: 0.07, kind: 4 });      // 只要一小团（大的柔光圆在这里就是那个糊的粉球）
  K.bloom({ pos: c, size: 1.95, life: 0.5, rot: Math.random() * 0.8, delay: 0.035 });
  K.rings.add({ x: p.x, z: p.z, rMax: 2.6, r0: 0.4, life: 0.32, thick: 0.8, delay: 0.02 });
  K.rings.add({ x: p.x, z: p.z, rMax: 3.3, r0: 0.6, life: 0.4, thick: 0.35, delay: 0.07, alpha: 0.7 });
  K.decal({ tex: "bloom", x: p.x, z: p.z, r: 1.8, life: 1.4, grow: 0.12, rot: 0.3, glow: [1.6, 0.7, 0.0], dark: [0.55, 0.45, 0.2] });
  K.sparks.add({ pos: c, n: 22, speed: [7, 14], life: [0.18, 0.42], size: [0.07, 0.13], up: 0.3, gravity: 0.7, drag: 2.6, stretch: 0.05 });
  K.sparks.add({ pos: c, n: 10, speed: [4, 9], life: [0.35, 0.6], size: [0.2, 0.32], kind: 1, up: 0.45, gravity: 1, drag: 1.8 });
  K.sparks.add({ pos: vec(p.x, 0.6, p.z), n: 10, speed: [1, 3], life: [0.6, 1.1], size: [0.1, 0.18], kind: 2, up: 1, gravity: -0.1, drag: 1.3, jitter: 0.15 });
  for (let i = 0; i < 5; i++) { const a = i * 1.257 + 0.3, r = 0.35; K.lines.add({ a: vec(p.x + Math.cos(a) * r, c.y - 0.4, p.z + Math.sin(a) * r), b: vec(p.x + Math.cos(a) * 1.0, c.y + 1.6 + (i % 2) * 0.6, p.z + Math.sin(a) * 1.0), width: 0.2, life: 0.18, reveal: 0.05, collapse: 0.07, thread: 0, delay: 0.04 }); }
}

export const passive: Demo = {
  label: "被动 · 烬痕引爆", duration: 1.9,
  setup(_ctx, cast, targets) {
    targets.slice(1).forEach(t => { t.obj.visible = false; });
    targets[0].setPos(0, 0); cast.setPos(-2.1, 0.35); cast.faceTo(0, 0); targets[0].faceTo(-2.1, 0.35);
  },
  run(ctx, cast, targets) {
    const K = kit(), target = targets[0], marks = new Marks(target); K.live.push(marks);
    const ev: [number, () => void][] = [];
    const dir = vec(target.obj.position.x - cast.obj.position.x, 0, target.obj.position.z - cast.obj.position.z).normalize();
    const yaw = Math.atan2(dir.x, dir.z);
    for (let i = 0; i < 3; i++) {
      const th = 0.205 + i * 0.42;
      ev.push([th - 0.17, () => cast.play(i % 2 ? "attack2" : "attack1", { loop: false, speed: 1.88, fade: 0.025 })]);
      ev.push([th - 0.03, () => { const c = chest(target, 0.5).addScaledVector(dir, -0.9); const sw = i % 2 === 0; K.crescent({ pos: c, yaw, tilt: sw ? 0.35 : -0.35, r: 1.55, width: 0.6, a0: Math.PI / 2 + (sw ? 1.25 : -1.25), a1: Math.PI / 2 + (sw ? -1.25 : 1.25), sweep: 0.06, linger: 0.13 }); }]);
      ev.push([th, () => { strike(ctx, target, { dir, power: 0.8, star: i === 2 ? 0.6 : 1, mark: { life: 0.3, collapse: 0.1, thread: 0 } }); marks.set(i + 1); }]);
    }
    ev.push([0.205 + 0.84 + DETONATE_DELAY, () => detonate(ctx, target)]);
    ev.push([1.55, () => cast.play("idle", { fade: 0.13 })]);
    return sequence(ev, 1.9);
  },
};
