// 奥森 · 烛语者（法师，烬誓庭）。
//
// 规格（数值是主线定的第一版，实现时照这个来；觉得哪里不合理，在报告里说，不要自己改数）：
//   普攻     远程，射程 8，一小团烛火，速度 24。
//   Q 烛焰   非指向，距离 11，宽 1.0，冷却 5，法力 55。一团烛火（速度 24）命中第一个敌人后炸开（半径 2.6）：
//            主目标 240 + 75% 法强 + 每级 35 的魔法伤害，周围其他敌人受六成。
//   W 蜡封   范围，施法距离 9，半径 2.8，冷却 12，法力 80。在一处浇下热蜡，0.8 秒后凝固：范围内敌人定身 1.6 秒，
//            受 150 + 50% 法强 + 每级 25 的魔法伤害。蜡在地上留到定身结束。
//   E 熄灯   范围，施法距离 9，半径 3.5，冷却 14，法力 80。吹灭一片 4 秒：里面的敌人被沉默、减速 30%，每 0.5 秒受 20 + 每级 5 的魔法伤害。
//            （沉默现在只对英雄有意义，小兵不会放技能；报告里提一句即可。）
//   R 千烛祷 大招，6 级，范围，施法距离 10，半径 6，冷却 70，法力 120。在范围里每隔 0.25 秒立起一根烛火柱，共 9 根（位置随机，
//            但优先落在有敌人的地方）；每根立起 0.6 秒后爆燃（半径 1.8）：220 + 55% 法强 + 每级 30 的魔法伤害。同一个敌人被多根烧到都算。
//
// 实现时定下来的几件规格里没写的事（都在报告里提了）：
//   · “每级 N”按“等级 × N”算（15 级就是 15N）。
//   · 四个技能都不打建筑（塔和水晶）：烛焰会穿过去，范围技能把它们略过。
//   · 熄灯的伤害一共 8 跳（放下的那一刻算第一跳，之后每 0.5 秒一跳）；沉默和减速是站在里面就一直有，走出去 0.3 秒后消。
//   · 千烛祷的第一根在出手后 0.25 秒立起；落点先轮着给范围里的每个敌人（英雄先），都轮过了再从头轮；范围里没人就随机散开。
//
// 特效的路数：烛火小而准（暖黄的火苗，火心近白），蜡是骨白的普通半透明，烟很少；熄灯是“暗”的，不靠发光。
// 第九轮 fx2b 重做了表现（数值、时间点没动）：烛焰的火团拖一条尾巴，炸开是一团成形的火球被烧穿 + 一圈有厚度的火环；
// 蜡封有往里收的倒计时圈、热蜡边上烧着一圈橙，凝固时冒出一圈蜡刺、被封的人脚下长出一截蜡壳；熄灯有一圈滚出去的烟、范围边上一圈烟墙，
// 里面立着几根掐灭的蜡烛冒细烟；千烛祷的每一根用和烛焰一样的火球。新零件在 ../fx_fx2b.ts。
// 动作时间表在 public/assets/hero/osen.json（资源那边做完才有；没有时控制器用默认的出手时间，不影响先把技能和特效做出来）。

import * as THREE from "three";
import type { Ent } from "../sim";
import type { Api, Cast, HeroKit, ProjVis, SkillDef } from "../skills";
import { SPR, type FxLib, type V3 } from "../fxlib";
import { FX2_LITE, candleGeometry, caseGeometry, fireball, spikeGeometry, thickRing, wall, warm2b, waxMaterial, wisp } from "../fx_fx2b";
import { pick } from "../fxb";

const FLAME = 0xffb347, CORE = 0xfff1c9, WAX = 0xe8dcc0, DARK = pick(0x14100e, 0x3a2246), EMBER = 0xff6a1e;      // 烛火、火心的亮黄、蜡的骨白、熄灯的黑、余烬
// 换画风 B（b-fx）：熄灯原来是一片近黑，亮地面上像地上开了个洞、一块污渍。B 下“暗”是有颜色的暮色：深紫褐（不是黑），烟是紫灰，罩得也薄一点；火、蜡不动
const WAX2 = 0xb9a983, SOOT = pick(0x2a221d, 0x4c3a48), DYING = 0x7a2208;                                        // 同一个色系里更深的几档：蜡的暗部、烟、快灭的火星
const TAU = Math.PI * 2;
const isBuilding = (e: Ent) => e.kind === "tower" || e.kind === "core";
const v3 = () => new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0), TMP = new THREE.Vector3();
const sat = (x: number) => Math.max(0, Math.min(1, x));

// 着色器里用的噪声（和 fxlib 里的是同一套，那边没有导出）
const NOISE = /* glsl */ `
  float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
  float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vn(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }`;

// ---------------------------------------------------------------- 自己补的零件
// fxlib 里的火是一片一片的（粒子图、地火、火柱），没有“一朵火苗”这个形状，烛语者到处要用，在这里补一个：
// 一滴尖朝上的旋转体，火心近白、火身暖黄、轮廓和火尖透成橙色，火尖被往上窜的火舌撕碎。几何体和材质各只有一份，所有烛火共用；大小和抖动靠缩放。
let flameGeo: THREE.BufferGeometry | undefined, flameMat: THREE.ShaderMaterial | undefined;
function flame(fx: FxLib): THREE.Mesh {
  if (!flameGeo) {
    flameGeo = new THREE.LatheGeometry(([[0, 0], [0.1, 0.03], [0.17, 0.1], [0.205, 0.22], [0.2, 0.36], [0.165, 0.54], [0.115, 0.76], [0.07, 0.98], [0.032, 1.2], [0, 1.4]] as const).map(([r, y]) => new THREE.Vector2(r, y)), 16);
    flameMat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,      // 一半叠加一半遮挡：在亮的地面上火色也不会被冲成白的
      uniforms: { uTime: { value: 0 }, uCore: { value: new THREE.Color(CORE) }, uMid: { value: new THREE.Color(FLAME) }, uEdge: { value: new THREE.Color(EMBER) } },
      vertexShader: /* glsl */ `uniform float uTime; varying vec3 vN, vV, vO;
        void main() { vO = position; float h = position.y / 1.4; vec4 w = modelMatrix * vec4(position, 1.0); vec3 p = position;
          p.xz += vec2(sin(uTime * 13.0 + w.x * 3.0 + w.y * 2.5), cos(uTime * 11.0 + w.z * 3.0 + w.y * 2.1)) * 0.07 * h * h;      // 火尖在晃
          vec4 mv = modelViewMatrix * vec4(p, 1.0); vN = normalMatrix * normal; vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `uniform float uTime; uniform vec3 uCore, uMid, uEdge; varying vec3 vN, vV, vO;
        ${NOISE}
        void main() {
          float h = vO.y / 1.4, f = abs(dot(normalize(vN), normalize(vV))), low = 1.0 - smoothstep(0.15, 0.9, h);
          float n = fbm(vec2(vO.x * 9.0 + vO.z * 5.0, h * 3.2 - uTime * 2.6));                                // 往上窜的火舌：越往火尖越碎
          float tongue = mix(1.0, smoothstep(0.36, 0.64, n + (1.0 - h) * 0.3), smoothstep(0.12, 0.8, h));
          vec3 col = mix(uEdge, uMid, smoothstep(0.2, 0.75, f) * (0.55 + 0.45 * low + 0.3 * n)); col = mix(col, uCore, smoothstep(0.84, 0.99, f) * (0.1 + 0.9 * low) * 0.9);
          float a = smoothstep(0.0, 0.75, f) * (0.4 + 0.6 * low) * 0.8 * tongue; if (a < 0.004) discard;
          gl_FragColor = vec4(col * a, a * 0.4);
        #include <colorspace_fragment>
        }` });
  }
  const m = new THREE.Mesh(flameGeo, flameMat); m.renderOrder = 9; m.frustumCulled = false; m.onBeforeRender = () => { flameMat!.uniforms.uTime.value = fx.time(); }; return m;
}
const flicker = (m: THREE.Object3D, s: number, t: number, len = 1) => { const w = 1 + Math.sin(t * 41) * 0.09; m.scale.set(s * w, s * len * (1 + Math.sin(t * 29) * 0.13), s * w); };

/** 一朵窜起来又烧完的烛火：朝 dir（不给就朝上）蹿出去，先长大、再收细，sec 秒里烧完。size 是粗细，len 是相对的长短 */
function lick(c: { api: Api; fx: FxLib }, at: V3, size: number, sec: number, dir?: V3, len = 1) {
  const m = flame(c.fx), ph = Math.random() * 9; m.position.set(at.x, at.y, at.z); if (dir) m.quaternion.setFromUnitVectors(UP, TMP.set(dir.x, dir.y, dir.z).normalize()); c.fx.group.add(m);
  c.api.run(sec, k => { const grow = 1 - (1 - sat(k / 0.28)) ** 2, fade = 1 - sat((k - 0.3) / 0.7) ** 1.8, w = size * grow * (0.15 + 0.85 * fade) * (1 + Math.sin(k * 44 + ph) * 0.09); m.scale.set(w, size * len * (0.3 + 0.7 * grow) * fade, w); }, () => c.fx.group.remove(m));
}

/** 一团飞着的烛火：圆肚朝前、火尖拖在后面，后面带几粒火星 */
function flameShot(fx: FxLib, from: V3, size: number, rate: number, big = false): ProjVis {
  const g = new THREE.Group(), m = flame(fx), q = v3(); let t = Math.random() * 9;
  m.rotation.x = -Math.PI / 2; m.position.z = 0.3; g.add(m); g.scale.setScalar(size); g.position.set(from.x, from.y, from.z); fx.group.add(g);
  const em = fx.emitter({ pos: from, rate, sprite: SPR.ember, add: true, color: [FLAME, EMBER], size: [0.04 + 0.04 * size, 0.06 + 0.07 * size], life: [0.16, 0.3], speed: [0.1, 0.7], drag: 2, gravity: -1.5 });
  // 技能的火团（第九轮 fx2b）：后面拖一条琥珀色的尾巴、火心一团淡淡的光、一缕往上散的烟，飞起来看得出轨迹和分量
  const tr = big ? fx.trail({ color: FLAME, color2: DYING, width: 0.62 * size, life: 0.2, alpha: 0.85 }) : null;
  const glow = big ? fx.emitter({ pos: from, rate: 40, sprite: SPR.soft, add: true, color: [CORE, FLAME], alpha: 0.28, size: [0.7 * size, 0.9 * size], grow: 0.6, life: [0.08, 0.12], speed: 0 }) : null;
  const smoke = big ? fx.emitter({ pos: from, rate: 14, sprite: SPR.smoke, color: [SOOT, DARK], alpha: 0.22, size: [0.3, 0.45], grow: 2.2, life: [0.4, 0.6], speed: [0.1, 0.3], up: 0.9 }) : null;
  return {
    move(x, y, z, dx, dy, dz, dt) { t += dt; g.position.set(x, y, z); g.lookAt(q.set(x + dx, y + dy, z + dz)); flicker(m, 1, t); em.at(x, y, z); tr?.at(x, y, z); glow?.at(x, y, z); smoke?.at(x, y + 0.2, z); },
    done() { fx.group.remove(g); em.stop(); tr?.stop(); glow?.stop(); smoke?.stop(); },
  };
}

/** 出手前手上亮起的一朵烛火：从无到有长出来，出手（c.data.lit）或者被打断（c.data.over）就收掉 */
function kindle(c: Cast, size: number) {
  const { a, api, fx } = c, m = flame(fx), h = v3(); let t = 0, on = true; fx.group.add(m);
  const off = () => { if (on) { on = false; fx.group.remove(m); } };
  api.run(1.5, (_k, dt) => { if (!on) return; if (c.data.lit || c.data.over) return off(); t += dt; a.hand(h); m.position.set(h.x, h.y + 0.05, h.z); flicker(m, size * Math.min(1, 0.15 + t / 0.2), t, 0.65); }, off);
}

// 蜡封用的零件。fxlib 的 wax 贴花形状是随机的一摊（铺不满技能的范围，也分不出“热的”和“凝固了的”），而且贴花排在水面前面画、
// 在浅水里会被水色盖住，所以这里自己画：一摊蜡（按技能的半径铺开，边上一圈鼓起来的唇，热的时候偏黄泛光、凝固后骨白带细裂纹）、
// 凝固后的蜡刺、裹住脚的蜡壳在 ../fx_fx2b.ts（第九轮 fx2b，原来是一股从天上淌下来的蜡柱和半个球）。
const HOTWAX = 0xefdcae;                                                                          // 还没凝固的蜡：骨白里透着烛火的黄
let poolGeo: THREE.BufferGeometry | undefined;
function waxParts() { if (!poolGeo) { poolGeo = new THREE.PlaneGeometry(2.6, 2.6); poolGeo.rotateX(-Math.PI / 2); } }
/** 地上的一摊蜡。grow 铺开的进度、cold 凝固了几成、flash 凝固那一下的泛白、alpha 整体的淡出，都由技能每帧给 */
function waxPool(fx: FxLib, x: number, z: number, R: number) {
  waxParts();
  const u = { uGrow: { value: 0 }, uCold: { value: 0 }, uFlash: { value: 0 }, uAlpha: { value: 1 }, uTime: { value: 0 }, uSeed: { value: Math.random() * 40 }, uHot: { value: new THREE.Color(HOTWAX) }, uWax: { value: new THREE.Color(WAX) }, uShade: { value: new THREE.Color(WAX2) }, uGlow: { value: new THREE.Color(CORE) }, uFl: { value: new THREE.Color(FLAME) } };
  const mat = new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    vertexShader: `varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `uniform float uGrow, uCold, uFlash, uAlpha, uTime, uSeed; uniform vec3 uHot, uWax, uShade, uGlow, uFl; varying vec2 vP;
      ${NOISE}
      void main() {
        float r = length(vP), rim = (0.97 + (fbm(vP * 1.7 + uSeed) - 0.45) * 0.26 + (vn(vP * 5.0 + uSeed) - 0.5) * 0.05) * (0.06 + 0.94 * uGrow), d = rim - r; if (d < 0.0) discard;      // rim：这个方向上蜡铺到多远（边缘是几个圆的垂瓣，平均正好在技能的边上）
        float lip = smoothstep(0.0, 0.045, d), flat_ = smoothstep(0.03, 0.2, d), band = (1.0 - flat_) * lip, lit = dot(vP / max(r, 0.001), vec2(-0.55, -0.83));
        float mot = fbm(vP * 4.5 + uSeed * 2.0 + vec2(0.0, uTime * 0.25 * (1.0 - uCold)));
        vec3 col = mix(uHot * mix(0.9, 1.04, mot), mix(uShade, uWax, 0.3 + 0.6 * mot) * 0.95, uCold);
        col *= mix(0.72, 1.0, lip);                                                                  // 最外沿压暗一点，像是有厚度
        col += band * (0.1 + 0.26 * max(lit, 0.0)) * uGlow - band * 0.16 * max(-lit, 0.0);           // 边上鼓起来的一圈唇：朝光的一侧亮，背光的一侧暗
        col = mix(col, uShade * 0.6, smoothstep(0.022, 0.0, abs(fbm(vP * 3.3 + uSeed * 3.0) - 0.5)) * flat_ * uCold * 0.55);      // 凝固以后的细裂纹
        col += uGlow * smoothstep(0.6, 0.8, fbm(vP * 3.0 - vec2(uTime * 0.5, 0.0) + uSeed)) * (1.0 - uCold) * flat_ * 0.24;       // 热的时候面上有流动的反光
        col = mix(col, uFl, (1.0 - uCold) * (band * 0.6 + (1.0 - lip) * 0.35));                                                  // 还没凝固的蜡边上烧着一圈橙（第九轮 fx2b）：热的和凝固了的一眼分得开
        col += uFlash * 0.35;
        gl_FragColor = vec4(col, smoothstep(0.0, 0.012, d) * mix(0.93, 0.6, flat_) * uAlpha);      // 中间薄一点，隐约透出地面；边上厚
        #include <colorspace_fragment>
      }` });
  const m = new THREE.Mesh(poolGeo, mat); m.position.set(x, fx.ground(x, z) + 0.08, z); m.scale.set(R, 1, R); m.renderOrder = 6; m.frustumCulled = false; fx.group.add(m);
  return { u, kill() { fx.group.remove(m); mat.dispose(); } };
}

// 熄灯用的零件：一团有体积的黑。fxlib 的 dark 贴花只压暗地面，站在里面的人还是亮的，“灯灭了”不成立；
// 这里在地面以上叠四层越往上越小的暗片（一个扁的穹顶），人站进去从脚往上被罩暗。边缘是翻卷的，整团在慢慢流动。一次施放一份材质、一次绘制。
let domeGeo: THREE.BufferGeometry | undefined;
function darkDome(fx: FxLib, x: number, z: number, R: number) {
  if (!domeGeo) { const P: number[] = [], L: number[] = [], I: number[] = [], H = [0.45, 0.95, 1.5, 2.1];
    H.forEach((h, i) => { for (const [px, pz] of [[-1.25, -1.25], [1.25, -1.25], [1.25, 1.25], [-1.25, 1.25]]) { P.push(px, h, pz); L.push(i / (H.length - 1)); } I.push(i * 4, i * 4 + 2, i * 4 + 1, i * 4, i * 4 + 3, i * 4 + 2); });
    domeGeo = new THREE.BufferGeometry(); domeGeo.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); domeGeo.setAttribute("aL", new THREE.Float32BufferAttribute(L, 1)); domeGeo.setIndex(I); }
  const u = { uTime: { value: 0 }, uAlpha: { value: 0 }, uSeed: { value: Math.random() * 40 }, uA: { value: new THREE.Color(DARK) }, uB: { value: new THREE.Color(SOOT) } };
  const mat = new THREE.ShaderMaterial({ uniforms: u, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `attribute float aL; varying vec2 vP; varying float vL; void main(){ vP = position.xz; vL = aL; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `uniform float uTime, uAlpha, uSeed; uniform vec3 uA, uB; varying vec2 vP; varying float vL;
      ${NOISE}
      void main() {
        vec2 p = vP / mix(1.0, 0.62, vL * vL); float r = length(p), th = atan(p.y, p.x);
        float n = fbm(vec2(th * 1.6, r * 2.2 - uTime * 0.45) + uSeed + vL * 7.0), curl = fbm(p * 2.4 + vec2(uTime * 0.22, -uTime * 0.16) + uSeed * 1.7 + vL * 5.0);
        float a = (1.0 - smoothstep(0.86, 1.0, r + (n - 0.5) * 0.3)) * (0.5 + 0.5 * curl) * 0.3 * uAlpha; if (a < 0.004) discard;
        gl_FragColor = vec4(mix(uA, uB, curl * 0.5), a);
        #include <colorspace_fragment>
      }` });
  const m = new THREE.Mesh(domeGeo, mat); m.position.set(x, fx.ground(x, z), z); m.scale.set(R, 1, R); m.renderOrder = 6; m.frustumCulled = false; fx.group.add(m);
  return { u, kill() { fx.group.remove(m); mat.dispose(); } };
}

// ---------------------------------------------------------------- 技能
const Q: SkillDef = { key: "Q", name: "烛焰", icon: "osen_q", cast: "dir", range: 11, width: 1.0, cd: 5, mana: 55,
  desc: "射出一团烛火，命中第一个敌人后炸开：主目标受到 240 + 75% 法强的魔法伤害，周围的敌人受六成。",
  start(c) { kindle(c, 1.0); },                                                                  // 出手前：手上亮起一朵烛火
  end(c) { c.data.over = true; },
  fire(c) {
    const { me, a, api, fx } = c, h = a.hand(v3()), dmg = 240 + 0.75 * c.ap + 25 * c.lv; let got: Ent | null = null; c.data.lit = true;
    // 弹道从身前正中出发（和指示线对得上），高度取手的高度
    const from = { x: a.pos.x + c.dx * 0.7, y: Math.min(a.pos.y + 2.2, Math.max(a.pos.y + 1.1, h.y)), z: a.pos.z + c.dz * 0.7 };
    fx.flash(h, CORE, 0.9, 0.1, false);
    fx.burst({ pos: h, n: 7, sprite: SPR.ember, add: true, color: [CORE, EMBER], dir: { x: c.dx, y: 0.1, z: c.dz }, spread: 0.45, speed: [3, 8], size: [0.05, 0.1], life: [0.14, 0.28], stretch: 1 });
    api.shoot({ me, from, dir: { x: c.dx, z: c.dz }, speed: 24, range: 11 - 0.7, radius: 0.5,
      hit(e) { if (isBuilding(e)) return false; got = e; },
      vis: flameShot(fx, from, 1.45, 46, true),
      end(p) {
        const e = got as Ent | null;
        if (!e) {                                                                                 // 没打到人：飞到头（或者撞了墙）自己灭掉，不炸
          fx.burst({ pos: p, n: 6, sprite: SPR.ember, add: true, color: [FLAME, DYING], speed: [0.5, 2.2], size: [0.05, 0.1], life: [0.25, 0.45], gravity: 3 });
          fx.burst({ pos: p, n: 2, sprite: SPR.smoke, color: [SOOT, DARK], alpha: 0.35, size: [0.3, 0.45], grow: 2.2, life: [0.5, 0.8], speed: 0.2, up: 0.9 }); return;
        }
        const ex = e.x, ez = e.z, at = { x: ex, y: fx.ground(ex, ez) + 1.1, z: ez };
        api.hit(me, e, dmg);
        for (const o of api.enemies(me, ex, ez, 2.6)) { if (o === e || isBuilding(o)) continue; api.hit(me, o, dmg * 0.6);
          const q = api.pos(o, 1.1); fx.flash(q, FLAME, 1.0, 0.1, false); fx.burst({ pos: q, n: 3, sprite: SPR.ember, add: true, color: [CORE, EMBER], speed: [1.5, 4], size: [0.05, 0.1], life: [0.2, 0.35], gravity: 7, stretch: 0.9 }); }
        // 炸开（第九轮 fx2b）：白芯一下 → 一团火球胀开再被烧穿 → 地上一圈有厚度的火环正好走到伤害的边上（2.6 米）
        // 第九轮 polish-old：原来的火球半径 1.2 米、闪光 2.0，截到的那几帧是一整颗发黄的实心球（和葛隆一样的“一团橙光”），里面绽开的烛火被它盖住了。
        // 现在火球缩成一颗小的火心（0.7 米，0.3 秒烧穿），闪光压一档；形状交给“烛火绽开”：中间一朵往上窜，周围几朵长短不一地斜着往外窜，地上一圈火环走到 2.6 米、留一块焦痕
        fx.flash(at, CORE, 1.1, 0.09); fx.impact(at, { color: CORE, color2: FLAME, size: 0.8, sparks: 7 });
        fireball(c, { x: ex, y: at.y - 0.25, z: ez }, 0.7, 0.3);
        thickRing(c, { x: ex, z: ez, r: 2.6, r0: 0.6, width: 0.6, life: 0.36, color: FLAME, color2: EMBER, add: true, alpha: 0.6 });
        fx.decal({ kind: "scorch", x: ex, z: ez, r: 1.8, life: 2.8, color: EMBER, alpha: 0.7, fadeIn: 0.03, fadeOut: 0.6 });
        const base = { x: ex, y: at.y - 0.75, z: ez }, r0 = Math.random() * TAU;                                                         // 烛火绽开：中间一朵朝上，周围六朵斜着往外窜
        lick(c, base, 1.8, 0.46, undefined, 0.9); for (let i = 0; i < 6; i++) { const an = r0 + (i + Math.random() * 0.5) / 6 * TAU; lick(c, base, 1.3 + Math.random() * 0.5, 0.3 + Math.random() * 0.1, { x: Math.cos(an), y: 0.5 + Math.random() * 0.3, z: Math.sin(an) }, 0.42 + Math.random() * 0.12); }      // 周围的几朵斜着往上窜、长短不一（贴地平铺开的话俯视是一颗星星图标）
        fx.burst({ pos: at, n: 16, sprite: SPR.ember, add: true, color: [CORE, EMBER], spread: 1.7, speed: [4, 10], size: [0.06, 0.13], life: [0.3, 0.55], gravity: 14, stretch: 1.1 });
        fx.burst({ pos: at, n: 3, sprite: SPR.smoke, color: [SOOT, DARK], alpha: 0.3, size: [0.7, 1.1], grow: 1.8, life: [0.6, 0.9], speed: 0.4, up: 1.0 });
      } });
  },
};

const W: SkillDef = { key: "W", name: "蜡封", icon: "osen_w", cast: "point", range: 9, radius: 2.8, cd: 12, mana: 80,
  desc: "在一处浇下热蜡，0.8 秒后凝固：范围内的敌人被定身 1.6 秒，并受到 170 + 50% 法强的魔法伤害。",
  start(c) { const { a, api, fx } = c, drip = () => { if (!c.data.over) fx.burst({ pos: a.hand(v3()), n: 4, sprite: SPR.drop, color: [HOTWAX, WAX2], radius: 0.12, size: [0.14, 0.22], life: [0.35, 0.5], speed: [0.2, 0.8], gravity: 10 }); };
    kindle(c, 0.7); drip(); api.after(0.12, drip); },                                             // 出手前：手上一朵小火，烧化的蜡一滴一滴往下掉
  end(c) { c.data.over = true; },
  fire(c) {
    const { me, api, fx } = c, x = c.x, z = c.z, R = 2.8, SET = 0.8, HOLD = 1.6, FADE = 0.9, gy = fx.ground(x, z), dmg = 170 + 0.5 * c.ap + 25 * c.lv, rot = Math.random() * TAU;
    const pool = waxPool(fx, x, z, R), u = pool.u; let t = 0; c.data.lit = true;
    // 预告（0.8 秒）：范围的边线；一圈亮线从边上往里收，收到头就凝固（第九轮 fx2b：敌人看得出还剩多久）；几串热蜡滴从上面掉下来，落地铺开成一摊、冒热气
    fx.decal({ kind: "disc", x, z, r: R, life: SET + 0.05, color: WAX, alpha: 0.6, fadeIn: 0.12, fadeOut: 0.12 });
    const fuse = fx.decal({ kind: "shock", x, z, r: R, life: SET + 0.02, color: FLAME, alpha: 0.7, add: true, fadeIn: 0.12, fadeOut: 0.04, lift: 0.1 });
    const steam = fx.emitter({ pos: { x, y: gy + 0.15, z }, ringR: R * 0.5, rate: 16, sprite: SPR.smoke, color: [0xfff4dc, WAX], alpha: 0.2, size: [0.4, 0.7], grow: 2, life: [0.6, 0.9], speed: [0.05, 0.2], up: 1.2 });
    api.run(SET + HOLD + FADE, (_k, dt) => { t += dt; u.uTime.value = t; fuse.size(R * (1 - 0.9 * sat(t / SET)));
      u.uGrow.value = 1 - (1 - sat((t - 0.15) / (SET - 0.2))) ** 2.2; u.uCold.value = sat((t - SET) / 0.12); u.uFlash.value = t < SET ? 0 : Math.max(0, 1 - (t - SET) / 0.22); u.uAlpha.value = sat((SET + HOLD + FADE - t) / FADE); }, pool.kill);
    const pour = (px: number, pz: number, wait: number, rr: number) => api.after(wait, () => {
      // 第九轮 fx2b：原来是从 5.6 米高处一直连到地上的一根蜡柱，从上往下看像几根插在地上的棍子；改成一串热蜡滴从三米多高掉下来、砸开
      const g0 = fx.ground(px, pz) + 0.05;
      for (let k = 0; k < 5; k++) api.after(k * 0.035, () => fx.burst({ pos: { x: px, y: g0 + 3.2, z: pz }, n: 2, sprite: SPR.drop, radius: rr * 0.8, color: [0xffe4b4, 0xe08a3a], dir: { x: 0, y: -1, z: 0 }, spread: 0.08, speed: [7, 9], gravity: 20, size: [0.2 + rr, 0.3 + rr], life: [0.24, 0.27], stretch: 1.4 }));      // 一串一串地掉，像淌下来的
      api.after(0.25, () => { fx.burst({ pos: { x: px, y: g0 + 0.1, z: pz }, n: Math.round(rr * 50), sprite: SPR.drop, color: [0xffe4b4, WAX2], spread: 1.1, speed: [1.5, 3.8], size: [0.12, 0.2], life: [0.3, 0.5], gravity: 12 });
        fx.burst({ pos: { x: px, y: g0 + 0.15, z: pz }, n: 1, sprite: SPR.ring, add: true, color: [CORE, FLAME], alpha: 0.5, size: 0.4, grow: 4, life: 0.25, speed: 0 }); });
    });
    pour(x, z, 0, 0.2); for (let i = 0; i < 2; i++) { const an = rot + i * 2.4, d = R * (0.4 + Math.random() * 0.12); pour(x + Math.cos(an) * d, z + Math.sin(an) * d, 0.1 + i * 0.1, 0.12); }
    api.after(SET, () => {
      steam.stop();
      // 凝固的一瞬（第九轮 fx2b）：一道亮光从中心扫到边，蜡从黄变成骨白、泛一下白、出细裂纹；地上冒出一圈蜡刺；被封住的人脚下一截蜡壳往上长
      thickRing(c, { x, z, r: R, r0: 0.2, width: 0.9, life: 0.24, color: CORE, color2: FLAME, add: true, alpha: 0.75 });
      fx.burst({ pos: { x, y: gy + 0.3, z }, n: 10, sprite: SPR.shard, ringR: R * 0.9, color: [WAX, WAX2], spread: 1.2, speed: [1, 2.5], up: 2, size: [0.1, 0.18], life: [0.3, 0.5], gravity: 12, spin: 6 });
      for (let i = 0; i < 7; i++) { const an = Math.random() * TAU, d = R * 0.8 * Math.sqrt(Math.random()), px = x + Math.cos(an) * d, pz = z + Math.sin(an) * d; fx.burst({ pos: { x: px, y: fx.ground(px, pz) + 0.2, z: pz }, n: 1, sprite: SPR.glint, add: true, color: [CORE, WAX], size: [0.3, 0.5], grow: 0.3, life: [0.18, 0.32], speed: 0 }); }
      const NS = FX2_LITE ? 6 : 10, spikes: { m: THREE.Mesh; h: number; w: number }[] = [];
      for (let i = 0; i < NS; i++) { const an = rot + (i / NS) * TAU + (Math.random() - 0.5) * 0.5, d = R * (0.5 + 0.38 * Math.random()), px = x + Math.cos(an) * d, pz = z + Math.sin(an) * d, m = new THREE.Mesh(spikeGeometry(), waxMaterial()), h = 0.5 + Math.random() * 0.45, w = 0.5 + Math.random() * 0.3;      // 蜡刺：一圈从地上冒出来，往外斜一点
        m.position.set(px, fx.ground(px, pz) - 0.02, pz); m.rotation.set(Math.sin(an) * 0.32, 0, -Math.cos(an) * 0.32); m.scale.set(w, 0.01, w); m.castShadow = false; fx.group.add(m); spikes.push({ m, h, w }); }
      api.run(HOLD + 0.3, k => { const tt = k * (HOLD + 0.3), up = sat(tt / 0.13), over = up < 1 ? up * (1.25 - 0.25 * up) : 1, down = sat((tt - HOLD) / 0.3); for (const s of spikes) s.m.scale.set(s.w * (1 - 0.4 * down), s.h * over * (1 - down), s.w * (1 - 0.4 * down)); },
        () => { for (const s of spikes) fx.group.remove(s.m); });
      for (const e of api.enemies(me, x, z, R)) { if (isBuilding(e)) continue; api.hit(me, e, dmg); api.root(e, HOLD);
        // 被封住的：脚下一截蜡壳从地上往上长到膝盖以上，定身结束时碎掉
        const m = new THREE.Mesh(caseGeometry(), waxMaterial()), r = e.r * 0.62 + 0.16, H = e.kind === "hero" ? 1.15 : 0.72; m.renderOrder = 7; fx.group.add(m);
        fx.burst({ pos: api.pos(e, 0.2), n: 6, sprite: SPR.drop, color: [WAX, WAX2], spread: 0.9, speed: [1.5, 3], size: [0.1, 0.16], life: [0.3, 0.45], gravity: 11 });
        fx.burst({ pos: api.pos(e, 0.3), n: 4, sprite: SPR.smoke, color: [0xfff4dc, WAX], alpha: 0.25, size: [0.5, 0.8], grow: 1.8, life: [0.5, 0.8], speed: 0.3, up: 1.2 });
        api.run(HOLD, k => { const tt = k * HOLD, g = sat(tt / 0.2), grow = g < 1 ? 1 - (1 - g) ** 3 : 1, brk = sat((tt - HOLD + 0.1) / 0.1); m.visible = e.alive;
            m.position.set(e.x, fx.ground(e.x, e.z) - 0.03, e.z); m.scale.set(r * (1 + 0.12 * brk), H * grow * (1 - 0.6 * brk), r * (1 + 0.12 * brk)); },
          () => { fx.group.remove(m);
            if (e.alive) { fx.burst({ pos: api.pos(e, 0.45), n: 10, sprite: SPR.shard, color: [WAX, WAX2], spread: 1.3, speed: [2, 4.5], up: 1.5, size: [0.14, 0.24], life: [0.4, 0.65], gravity: 12, spin: 7 });
              fx.burst({ pos: api.pos(e, 0.3), n: 3, sprite: SPR.dust, color: [WAX, WAX2], alpha: 0.5, size: [0.5, 0.8], grow: 1.8, life: [0.4, 0.6], speed: [0.5, 1.2], up: 0.5 }); } });
      }
      api.after(HOLD, () => { for (let i = 0; i < 8; i++) { const an = Math.random() * TAU, d = R * 0.8 * Math.sqrt(Math.random()), px = x + Math.cos(an) * d, pz = z + Math.sin(an) * d;      // 定身结束：蜡面碎开，然后慢慢淡掉
        fx.burst({ pos: { x: px, y: fx.ground(px, pz) + 0.12, z: pz }, n: 2, sprite: SPR.shard, color: [WAX, WAX2], spread: 0.8, speed: [1, 2.6], size: [0.1, 0.18], life: [0.35, 0.6], gravity: 11, spin: 6 }); } });
    });
  },
};

const E: SkillDef = { key: "E", name: "熄灯", icon: "osen_e", cast: "point", range: 9, radius: 3.5, cd: 14, mana: 80,
  desc: "吹灭一片区域的光 4 秒：里面的敌人被沉默、减速 30%，并持续受到魔法伤害。",
  start(c) { const h = c.a.hand(v3());                                                            // 出手前：手上的火缩成一点灭掉，冒一缕烟
    c.fx.burst({ pos: h, n: 1, sprite: SPR.glint, add: true, color: [CORE, EMBER], size: 0.5, grow: 0.08, life: 0.22, speed: 0 });
    c.fx.burst({ pos: h, n: 3, sprite: SPR.smoke, color: [SOOT, DARK], alpha: 0.4, size: [0.22, 0.36], grow: 2.3, life: [0.5, 0.8], speed: 0.15, up: 1.1 }); },
  fire(c) {
    const { me, api, fx } = c, x = c.x, z = c.z, R = 3.5, gy = fx.ground(x, z), dmg = 20 + 5 * c.lv, LIFE = 4.6; let acc = 0;
    const spot = (k: number) => { const an = Math.random() * TAU, d = R * k * Math.sqrt(Math.random()), px = x + Math.cos(an) * d, pz = z + Math.sin(an) * d; return { x: px, y: fx.ground(px, pz), z: pz }; };
    // 吹灭的一下：范围里几点光缩成一点灭掉；一圈烟从中心滚到边上（第九轮 fx2b：参照力丸的烟幕，罩下来的那一下要有形状）
    for (let i = 0; i < 6; i++) { const p = spot(0.8); p.y += 0.5; fx.burst({ pos: p, n: 1, sprite: SPR.glint, add: true, color: [CORE, EMBER], size: 0.55, grow: 0.05, life: 0.2, speed: 0 }); }
    for (let i = 0; i < (FX2_LITE ? 8 : 14); i++) { const an = (i / 14) * TAU + Math.random() * 0.3, px = x + Math.cos(an) * R, pz = z + Math.sin(an) * R;      // 边上的光被一口气吸进中间
      fx.burst({ pos: { x: px, y: fx.ground(px, pz) + 0.6, z: pz }, n: 1, sprite: SPR.streak, add: true, color: [CORE, EMBER], alpha: 0.9, dir: { x: -Math.cos(an), y: 0.05, z: -Math.sin(an) }, spread: 0.05, speed: [11, 13], drag: 1.5, size: [0.2, 0.3], life: [0.22, 0.28], stretch: 1.6 }); }
    const NR = FX2_LITE ? 10 : 16;
    for (let i = 0; i < NR; i++) { const an = (i / NR) * TAU + Math.random() * 0.3, d = { x: Math.cos(an), y: 0.05, z: Math.sin(an) };
      fx.burst({ pos: { x: x + d.x * 0.4, y: gy + 0.45, z: z + d.z * 0.4 }, n: 1, sprite: SPR.smoke, color: [SOOT, DARK], alpha: 0.6, dir: d, spread: 0.12, speed: [9, 11], drag: 3.2, size: [0.9, 1.2], grow: 2.1, life: [0.75, 0.95], spin: 0.8 }); }
    thickRing(c, { x, z, r: R, r0: 0.4, width: 1.4, life: 0.45, color: pick(0x6a5c52, 0x7a6276), color2: SOOT, alpha: 0.8 });
    // 持续 4 秒：地上一片黑（dark 贴花），上面罩着一团翻卷的暗；边上一圈翻滚的烟墙和一道快灭的暗红线标出范围
    fx.decal({ kind: "dark", x, z, r: R * 1.15, life: LIFE, color: DARK, color2: SOOT, alpha: pick(0.74, 0.56), fadeIn: 0.05, fadeOut: 0.15 });      /* 原来是 1，里面的人看不清；压到能看清站位 */
    fx.decal({ kind: "disc", x, z, r: R, life: 4.25, color: DYING, alpha: 0.55, fadeIn: 0.04, fadeOut: 0.08, lift: 0.09 });
    const dome = darkDome(fx, x, z, R), edge = wall(c, x, z, "smoke", pick(0x8a7c70, 0x9a8494), pick(0x2e2621, 0x3e2a3c)); let t = 0;
    api.run(LIFE, (_k, dt) => { t += dt; dome.u.uTime.value = t; dome.u.uAlpha.value = sat(t / 0.25) * sat((LIFE - t) / 0.6); edge.set(R * (0.97 + 0.05 * sat((t - 4) / 0.6)), 1.9 + 0.5 * sat((t - 3.9) / 0.7), sat((t - 0.12) / 0.3) * sat((LIFE - t) / 0.6)); }, () => { dome.kill(); edge.kill(); });
    const curl = fx.emitter({ pos: { x, y: gy + 0.35, z }, ringR: R * 0.96, rate: 6, sprite: SPR.smoke, color: [DARK, SOOT], alpha: [0.4, 0.6], size: [1.0, 1.6], grow: 1.5, life: [1.0, 1.6], speed: [0.05, 0.3], up: 0.3, spin: 1 });
    // 里面立着几根刚掐灭的蜡烛：烛芯上一点将灭的红，冒着一缕细细的、弯弯曲曲往上的烟（这个技能的记号）
    const NC = FX2_LITE ? 3 : 5, rot = Math.random() * TAU, HC = 1.25;
    for (let i = 0; i < NC; i++) { const an = rot + (i / NC) * TAU + (Math.random() - 0.5) * 0.6, d = R * (i === 0 ? 0.15 : 0.35 + 0.35 * Math.random()), px = x + Math.cos(an) * d, pz = z + Math.sin(an) * d, g = fx.ground(px, pz), hh = (0.32 + Math.random() * 0.22) * HC, wait = 0.05 + i * 0.06;
      api.after(wait, () => { const m = new THREE.Mesh(candleGeometry(), waxMaterial()); m.position.set(px, g - 0.02, pz); m.scale.set(1.4, 0.01, 1.4); fx.group.add(m); const L = LIFE - wait - 0.2;
        api.run(L, k => { const tt = k * L, up = sat(tt / 0.16), down = sat((tt - L + 0.35) / 0.35); m.scale.set(1.4, hh * (up < 1 ? up * (1.2 - 0.2 * up) : 1) * (1 - down), 1.4); }, () => fx.group.remove(m));
        fx.burst({ pos: { x: px, y: g + hh + 0.05, z: pz }, n: 1, sprite: SPR.ember, add: true, color: [EMBER, DYING], alpha: 0.95, size: 0.22, grow: 0.5, life: L * 0.8, speed: 0 });      // 烛芯上一点将灭的红
        wisp(c, { x: px, y: g + hh + 0.06, z: pz, h: 2.0 + Math.random() * 0.6, life: L, color: 0x9a928a, color2: 0xd6cec4, alpha: 0.9, width: 0.11 }); });
    }
    api.zone({ me, x, z, r: R, dur: 4, tick: 0.5,
      frame(_z, dt) {
        for (const e of api.enemies(me, x, z, R)) { if (isBuilding(e)) continue; api.silence(e, 0.3); api.slow(e, 0.3, 0.3); }      // 站在里面就一直沉默、减速
        acc += dt * 4; while (acc >= 1) { acc -= 1; const p = spot(0.8); p.y += 0.2 + Math.random() * 0.9;      // 将灭的火星：亮一下，飘一小段，暗成暗红灭掉
          fx.burst({ pos: p, n: 1, sprite: SPR.ember, add: true, color: [FLAME, DYING], size: [0.2, 0.3], grow: 0.5, life: [0.8, 1.4], speed: [0.05, 0.2], up: 0.5, drag: 0.8 }); }
      },
      each(e, zn) { if (zn.t > 3.75 || isBuilding(e)) return; api.hit(me, e, dmg);                // 一共 8 跳：0、0.5……3.5 秒
        fx.burst({ pos: api.pos(e, 1.0), n: 2, sprite: SPR.smoke, color: [DARK, SOOT], alpha: 0.4, size: [0.35, 0.5], grow: 1.7, life: [0.4, 0.6], speed: 0.2, up: 0.8 }); },
      end() { curl.stop();      // 散：烟往上散开
        for (let i = 0; i < (FX2_LITE ? 5 : 9); i++) { const p = spot(0.9); fx.burst({ pos: { x: p.x, y: p.y + 0.6, z: p.z }, n: 1, sprite: SPR.smoke, color: [SOOT, DARK], alpha: 0.4, size: [1.0, 1.4], grow: 2, life: [0.7, 1.0], speed: [0.2, 0.5], up: 1.4, spin: 0.6 }); } },
    });
  },
};

const R: SkillDef = { key: "R", name: "千烛祷", icon: "osen_r", cast: "point", range: 10, radius: 6, cd: 70, mana: 120, minLevel: 6,
  desc: "在大范围里接连立起 9 根烛火柱，每根过一会儿爆燃，各造成 195 + 55% 法强的魔法伤害；同一个敌人再被炸到只受四成。",
  start(c) { const p = c.a.pos; kindle(c, 1.0); c.fx.decal({ kind: "rune", x: p.x, z: p.z, r: 1.7, life: 0.8, color: FLAME, alpha: 0.6, add: true, fadeIn: 0.2, fadeOut: 0.5 }); },      // 出手前：手上亮起烛火，脚下一圈小法阵
  end(c) { c.data.over = true; },
  fire(c) {
    const { me, api, fx } = c, x = c.x, z = c.z, R_ = 6, N = 9, GAP = 0.25, FUSE = 0.6, BR = 1.8, dmg = 195 + 0.55 * c.ap + 22 * c.lv, T = GAP * N + FUSE, got = new Map<number, number>(); c.data.lit = true;
    const rot = Math.random() * TAU, used = new Map<number, number>(), spots: [number, number][] = []; let t = 0;
    // 法阵：从中间展开到整个范围，留到最后一根烧完
    const rune = fx.decal({ kind: "rune", x, z, r: R_ * 0.3, life: T + 0.7, color: FLAME, alpha: 0.42, add: true, fadeIn: 0.03, fadeOut: 0.16 });      /* 0.55 → 0.42：整片法阵太亮，压过了每一根的爆燃（第九轮 fx2b） */
    api.run(0.28, k => rune.size(R_ * (0.3 + 0.7 * (1 - (1 - k) ** 3)))); thickRing(c, { x, z, r: R_, r0: 1.5, width: 0.8, life: 0.45, color: FLAME, color2: DYING, add: true, alpha: 0.5 });
    // 法阵边上九朵小烛火：出手时转着圈点亮；每立起一根烛火柱灭掉一朵（还剩几朵就是还有几根）
    const cand = Array.from({ length: N }, (_, i) => { const an = rot + (i / N) * TAU, px = x + Math.cos(an) * R_ * 0.87, pz = z + Math.sin(an) * R_ * 0.87, m = flame(fx); m.position.set(px, fx.ground(px, pz) + 0.1, pz); m.scale.setScalar(0.001); fx.group.add(m); return { m, px, pz, out: -1, ph: Math.random() * 9 }; });
    api.run(T + 0.4, (_k, dt) => { t += dt; cand.forEach((cd, i) => { const s = 0.95 * sat((t - 0.1 - i * 0.025) / 0.15) * (cd.out < 0 ? 1 : sat(1 - (t - cd.out) / 0.14)); cd.m.visible = s > 0.01; flicker(cd.m, s, t + cd.ph); }); }, () => { for (const cd of cand) fx.group.remove(cd.m); });
    const boom = (px: number, pz: number, gy: number, last: boolean) => {
      for (const e of api.enemies(me, px, pz, BR)) { if (isBuilding(e)) continue; const k = got.get(e.id) ?? 0; got.set(e.id, k + 1); api.hit(me, e, k ? dmg * 0.4 : dmg, "magic", true); }      /* 同一个敌人再被炸到只受四成：不然九根都追一个人，一个大招能打掉一整管血 */
      lick(c, { x: px, y: gy + 0.05, z: pz }, 2.7, 0.6, undefined, 1.55); fx.column({ x: px, z: pz, r: 0.34, h: 5.2, life: 0.55, color: FLAME, color2: EMBER, kind: "fire" });      // 火柱：外形是一朵拉得很高的烛火，里面一根细火柱在翻
      fx.flash({ x: px, y: gy + 0.8, z: pz }, CORE, 1.8, 0.1); fx.impact({ x: px, y: gy + 0.9, z: pz }, { color: CORE, color2: FLAME, size: last ? 1.2 : 0.9, sparks: 8 });      // 爆燃（第九轮 fx2b）：和烛焰一样成形的火球、一圈有厚度的火环走到 1.8 米
      fireball(c, { x: px, y: gy + 0.9, z: pz }, last ? 1.6 : 1.2, 0.45); thickRing(c, { x: px, z: pz, r: BR, r0: 0.3, width: 0.55, life: 0.3, color: FLAME, color2: EMBER, add: true, alpha: 0.85 });
      if (last) { const gc = fx.ground(x, z), r0 = Math.random() * TAU; fx.flash({ x, y: gc + 1.5, z }, FLAME, 3.6, 0.2);      // 最后一根（第九轮 fx2b）：原来是一根很粗的光柱，像个玻璃筒；改成法阵一圈烛火一齐窜起来，中间一团大火球
        fireball(c, { x, y: gc + 1.2, z }, 2.0, 0.6); for (let i = 0; i < (FX2_LITE ? 8 : 12); i++) { const an = r0 + (i / 12) * TAU, qx = x + Math.cos(an) * R_ * 0.8, qz = z + Math.sin(an) * R_ * 0.8; lick(c, { x: qx, y: fx.ground(qx, qz) + 0.05, z: qz }, 1.6, 0.55, undefined, 1.4); } }
      fx.decal({ kind: "scorch", x: px, z: pz, r: 1.25, life: 3.4, color: EMBER, alpha: 0.55, fadeIn: 0.02, fadeOut: 0.6 });
      fx.burst({ pos: { x: px, y: gy + 0.4, z: pz }, n: 12, sprite: SPR.ember, add: true, color: [CORE, EMBER], dir: { x: 0, y: 1, z: 0 }, spread: 0.55, speed: [5, 11], size: [0.06, 0.13], life: [0.4, 0.7], gravity: 12, stretch: 1.2 });
      fx.shake(last ? 0.12 : 0.05, last ? 0.3 : 0.14);
      if (last) { thickRing(c, { x, z, r: R_, r0: 1, width: 1.4, life: 0.6, color: FLAME, color2: DYING, add: true, alpha: 0.6 }); fx.burst({ pos: { x, y: fx.ground(x, z) + 0.3, z }, n: 14, sprite: SPR.ember, add: true, ringR: R_ * 0.8, color: [FLAME, DYING], size: [0.07, 0.12], life: [0.7, 1.2], speed: [0.1, 0.4], up: 1.4, drag: 0.6 }); }      // 最后一根：整个法阵再亮一圈，然后淡掉
    };
    const rise = (i: number) => {
      const cd = cand[i]; cd.out = t; fx.burst({ pos: { x: cd.px, y: fx.ground(cd.px, cd.pz) + 0.6, z: cd.pz }, n: 2, sprite: SPR.smoke, color: [SOOT, DARK], alpha: 0.35, size: [0.18, 0.26], grow: 2.4, life: [0.6, 0.9], speed: 0.1, up: 1.2 });
      // 落点：先轮着给范围里的每个敌人（英雄先），都轮过了再从头轮；没人就随机散开，尽量不和前面的叠在一起
      const foes = api.enemies(me, x, z, R_).filter(e => !isBuilding(e)); let px = x, pz = z;
      if (foes.length) { const least = Math.min(...foes.map(e => used.get(e.id) ?? 0)), pool = foes.filter(e => (used.get(e.id) ?? 0) === least), heroes = pool.filter(e => e.kind === "hero"), from = heroes.length ? heroes : pool, e = from[Math.floor(Math.random() * from.length)], an = Math.random() * TAU, d = Math.random() * 0.7;
        used.set(e.id, least + 1); px = e.x + Math.cos(an) * d; pz = e.z + Math.sin(an) * d; const l = Math.hypot(px - x, pz - z); if (l > R_) { px = x + (px - x) * R_ / l; pz = z + (pz - z) * R_ / l; } }
      else { let best = -1; for (let k = 0; k < 8; k++) { const an = Math.random() * TAU, d = (R_ - 1.2) * Math.sqrt(Math.random()), qx = x + Math.cos(an) * d, qz = z + Math.sin(an) * d, near = spots.reduce((m, [sx, sz]) => Math.min(m, Math.hypot(sx - qx, sz - qz)), 99); if (near > best) { best = near; px = qx; pz = qz; } if (near > 2.6) break; } }
      spots.push([px, pz]); const gy = fx.ground(px, pz), m = flame(fx); let ft = Math.random() * 9;
      // 预告（0.6 秒）：地上一个圈标出爆燃的范围，一圈亮线往中间收（收到头就炸）；一根细的蜡烛光柱，底下一朵越烧越大的烛火
      fx.decal({ kind: "disc", x: px, z: pz, r: BR, life: FUSE, color: FLAME, alpha: 0.75, fadeIn: 0.12, fadeOut: 0.1 });
      const fuse = fx.decal({ kind: "shock", x: px, z: pz, r: BR, life: FUSE + 0.02, color: CORE, alpha: 0.55, add: true, fadeIn: 0.1, fadeOut: 0.05, lift: 0.09 });
      fx.column({ x: px, z: pz, r: 0.2, h: 5, life: 0.95, color: CORE, color2: FLAME, kind: "light" });
      m.position.set(px, gy + 0.12, pz); fx.group.add(m);
      api.run(FUSE, (k, dt) => { ft += dt; flicker(m, 0.5 + 0.9 * k, ft); fuse.size(BR * (1 - 0.85 * k)); }, () => { fx.group.remove(m); boom(px, pz, gy, i === N - 1); });
    };
    for (let i = 0; i < N; i++) api.after(GAP * (i + 1), () => rise(i));
  },
};

export const osen: HeroKit = {
  id: "osen", name: "奥森", title: "烛语者", role: "法师", side: 1, color: FLAME, color2: WAX, height: 3.4, look: { ring: 1.5, bar: 0.75, lift: 1.2, sat: 1.5 },      /* 换画风 B（w-quad）：卡通版的白鹿贴图本身就亮，默认提亮 1.4 时白鬃毛和身子的亮部糊成一片白（p90 0.92），中间调比设定图亮一大截、偏冷；提亮压到 1.2、饱和度 1.5，鬃毛的笔触出来、身子回到设定图那种暖灰。2026-11-19 换成了四足的烛角鹿：身高连鹿角一起算 3.4 米；血条抬高，不挡鹿角 */
  base: { hp: 3100, mana: 900, ad: 145, ap: 60, armor: 24, mr: 25, ms: 5.6, as: 0.85, range: 8.5,      /* 阶段 6：血 2800 → 3100、护甲 20 → 24、射程 8 → 8.5、移速 5.5 → 5.6。对上刺客太脆，六局里最多一局死了 9 次 */ cdr: 0, ls: 0, hpRegen: 0.005, manaRegen: 0.016 },
  // 普攻：一小团烛火。出手时手上迸几粒火星，打中时一小朵火苗舔一下、溅几粒火星
  ranged: { speed: 24, shot: c => { c.fx.burst({ pos: c.from, n: 3, sprite: SPR.ember, add: true, color: [CORE, EMBER], size: [0.05, 0.09], life: [0.15, 0.25], speed: [0.5, 1.5], up: 0.8 }); return flameShot(c.fx, c.from, 0.62, 26); } },
  skills: [Q, W, E, R],
  passive(c) { warm2b(c); },                                                                     // 第九轮 fx2b：新零件的着色器先编好
  attack(c) {
    const { api, fx, target: e } = c, at = api.pos(e, e.kind === "tower" ? 3 : e.kind === "core" ? 4 : 1.2);
    fx.flash(at, FLAME, 1.1, 0.1, false); lick(c, { x: at.x, y: at.y - 0.25, z: at.z }, 0.75, 0.24);
    fx.burst({ pos: at, n: 6, sprite: SPR.ember, add: true, color: [CORE, EMBER], speed: [1.5, 4.5], size: [0.07, 0.12], life: [0.22, 0.38], gravity: 7, stretch: 0.9 });
  },
};
