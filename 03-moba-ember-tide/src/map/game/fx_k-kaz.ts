// 第九轮 k-kaz：卡兹 · 焚爪（烬誓庭打野，四足猞猁）技能特效自己的零件。现在只有卡兹用；rake、claw 是“爪”这一类通用的形状，以后的野兽英雄可以搬去用。
//
// 卡兹的火是锻炉边上的火：熔岩红（#D8432A）为主，亮处是熔铁的橙（#FFB070），暗处是烧黑的铁和炭（#2A2624）。
// 和葛隆、薇萝（fx2c）一样用“预乘透明”：烫的地方接近叠加发光，烧黑的地方真的把地面压暗——深色的测试场地面上，反差靠“暗底 + 亮线”，不靠更亮。
// 火团、黑烟、火墙、弹道光直接用 fx_fx2c 的（火团偏低温的那一段就是卡兹的红），这里只补 fx2c 和 fx2a 都没有的形状：
//
//   rake    地上三道并排的爪痕：先从一头划到另一头（一下子划开），里面一道烧红的熔线，边上一圈焦黑，慢慢凉成黑的，最后一块块蚀掉（扑杀、焚猎落地）
//   claw    目标身上一闪的三道爪痕：正对镜头的一片，画在模型前面（普攻、扑中的那一下）
//   fan     炉吼：贴地的扇形热浪，一道前沿由近到远推开，后面拖两三道细的“声纹”和一片压暗的热区，扫过的地方留几道焦痕；扇形两边一道很淡的边线（范围）
//   brand   易伤的烙印：目标脚下一圈断成三段的暗红细环，慢慢转（炉吼的易伤）
//   ring    贴地的一圈火：墙根烧黑，火苗沿着圈此起彼伏，里面三道往里指的爪刻度；可以从一处点着、绕一圈烧满（焚猎起手的火圈、锁定猎物的火圈）
//   scorch  落地的焦痕：一块边缘不齐的焦黑，几道放射的裂缝里烧红，慢慢凉下去（焚猎落地）
//   sweepArc 平放在半空的一道厚弧，里面三道并排的爪痕，从一头扫到另一头（裂爪的两爪）
//
// 规矩和别的特效零件一样：几何体、材质进池子，用完藏起来下次接着用；动画用 api.run 推（对局时间：暂停、顿帧都跟着停）。
// 贴地的网格每个顶点各自落在地面上（坡上、岸边不会被地形切掉一半），跟着单位走的那几个挪动超过 0.25 米才重新贴一次。

import * as THREE from "three";
import type { Api } from "./skills";
import type { FxLib, V3 } from "./fxlib";
import { pick } from "./fxb";

type U = Record<string, { value: any }>;
// 换画风 B（b-fx）：焦痕、爪痕的底色（CHAR）原来近黑，亮地面上是一块块污渍；B 下是烧过的暖褐，红的那一道不动
export const KZ = { LAVA: 0xd8432a, MOLTEN: 0xffb070, IRON: 0x2a2624, CHAR: pick(0x120a07, 0x4a2a17), ASH: 0x8b8279 };
const NOISE = /* glsl */ `
  float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y); }
  float fbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 3; i++) { s += a * vn(p); p = p * 2.03 + 11.7; a *= 0.5; } return s / 0.875; }`;
/** 预乘透明：rgb 已经乘过不透明度；a 是挡住后面多少。烧红的线 a 很小（接近叠加发光），焦黑 a 大（真的压暗地面） */
const premul = { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor } as const;
const col = (c: number) => new THREE.Color(c);
// 熔铁的颜色：0 是快凉透的暗红，0.5 左右是熔岩红，1 是熔铁的橙（只有芯能到）
const HEAT = /* glsl */ `vec3 heat(float h){ vec3 c = mix(vec3(0.16, 0.025, 0.01), uRed, smoothstep(0.0, 0.45, h)); return mix(c, uHot, smoothstep(0.5, 1.0, h)); }`;

// ---------------------------------------------------------------- 贴地的图案
const PATCH_FRAG = /* glsl */ `
  uniform int uKind; uniform float uK, uT, uAlpha, uSeed, uHeat, uFront, uAng, uCurve; uniform vec3 uChar, uRed, uHot; varying vec2 vP;
  ${NOISE}
  ${HEAT}
  void main(){
    vec2 p = vP; float r = length(p), A = 0.0; vec3 E = vec3(0.0);
    if (uKind == 0) {                                          // 爪痕：三道并排（中间最长），从 y=+1 划到 y=-1；uFront 是划到哪了
      float ink = 0.0, hot = 0.0;
      for (int i = 0; i < 3; i++) {
        float fi = float(i) - 1.0, L = 1.0 - abs(fi) * 0.2, y = p.y / L;
        if (abs(y) < 1.0) {
          float sw = (1.0 - y) * 0.5, rv = 1.0 - smoothstep(uFront - 0.12, uFront, sw);
          float xc = fi * 0.34 + uCurve * 0.16 * (y * y - 0.35) + (vn(vec2(y * 2.5 + uSeed + fi * 5.0, fi)) - 0.5) * 0.06;
          float w = 0.15 * pow(1.0 - y * y, 0.5) * (0.8 + 0.4 * vn(vec2(y * 5.0 + fi * 3.0, uSeed)));
          float d = abs(p.x - xc), n = vn(vec2(p.y * 9.0 + fi * 11.0, p.x * 9.0 + uSeed));
          float gouge = 1.0 - smoothstep(w * 0.5, w * 1.05 + 0.02, d + (n - 0.5) * 0.03);
          float halo = 1.0 - smoothstep(w, w * 2.6 + 0.08, d + (n - 0.5) * 0.1);
          float core = (1.0 - smoothstep(0.0, w * 0.42, d)) * (0.55 + 0.45 * n);
          ink = max(ink, max(gouge * 0.9, halo * 0.32) * rv);
          hot = max(hot, core * rv * (1.0 + 1.4 * exp(-max(uFront - sw, 0.0) * 7.0)));      // 刚划开的那一截最烫
        }
      }
      float h = clamp(hot * uHeat, 0.0, 1.3); A = ink; E = heat(min(h, 1.0)) * h * 1.2;
    } else if (uKind == 1) {                                   // 扇形热浪：本地 +z（p.y）是正前方，uAng 半张角，uFront 前沿走到几成
      float th = atan(p.x, p.y), inA = 1.0 - smoothstep(uAng - 0.05, uAng + 0.03, abs(th));
      float n = vn(vec2(th * 10.0 + uSeed, r * 3.0 - uT * 3.0)), rr = r + (n - 0.5) * 0.05, fr = uFront;
      // 第四批 polish-new：原来前沿是一道 0.03 宽的细红线、后面两道更细的声纹、两边两道边线，读成“几根线”。
      // 现在是一整片往外涌的热浪：前沿一道有厚度的红（最前面一根熔铁色的边），身后一大片由浓到淡的暗红热区（越靠前越浓，带一点翻滚的浓淡），声纹只留一道很淡的
      float front = exp(-pow((rr - fr) / 0.075, 2.0)) * step(0.0, 1.02 - rr), lip = exp(-pow((rr - fr + 0.02) / 0.018, 2.0)) * step(0.0, 1.02 - rr);
      float roll = 0.7 + 0.6 * fbm(vec2(th * 5.0 + uSeed, r * 4.0 - uT * 5.0));                                                              // 热浪里翻滚的浓淡
      float body = step(rr, fr) * smoothstep(fr - 0.8, fr, rr) * roll;
      float rip = exp(-pow((rr - (fr - 0.2)) / 0.02, 2.0)) * 0.35 * step(0.25, fr);
      float swept = step(rr, fr) * smoothstep(0.08, 0.3, r);
      float streak = smoothstep(0.6, 0.88, vn(vec2(th * 14.0 + uSeed, r * 1.2))) * swept;                                                     // 热浪扫过的地上几道顺着吹的焦痕
      float edge = (1.0 - smoothstep(0.0, 0.03, abs(abs(th) - uAng) * r)) * smoothstep(0.12, 0.3, r) * (1.0 - smoothstep(0.96, 1.0, r));
      float m = smoothstep(0.04, 0.2, r) * (1.0 - smoothstep(0.97, 1.0, rr));
      A = (body * 0.45 + front * 0.32 + streak * 0.2 + edge * 0.15) * inA * m;
      E = (uRed * (front * 0.95 + rip * 0.3 + body * 0.12) + uHot * lip * 0.85 * uHeat) * inA * m * (0.85 + 0.3 * n) + uRed * edge * 0.18 * uHeat;      // 身子的红收一档：一大片橙红太抢
    } else if (uKind == 2) {                                   // 易伤的烙印：断成三段的细环，慢慢转；uFront 从 0 到 1 是从大往里收的那一下
      float th = atan(p.y, p.x), rq = r * (1.0 + 0.6 * (1.0 - uFront));
      float seg = fract((th + uT * 0.7) / 2.0944);
      float arc = (1.0 - smoothstep(0.015, 0.045, abs(rq - 0.78))) * smoothstep(0.06, 0.12, seg) * (1.0 - smoothstep(0.8, 0.86, seg));
      float tick = (1.0 - smoothstep(0.012, 0.03, abs(seg - 0.93) * 2.0944 * rq)) * smoothstep(0.52, 0.57, rq) * (1.0 - smoothstep(0.72, 0.77, rq));      // 每个缺口里一道往里指的爪刻度
      float fill = (1.0 - smoothstep(0.35, 0.8, rq)) * 0.12, glow = exp(-pow((rq - 0.78) / 0.09, 2.0));
      A = fill + arc * 0.4 + tick * 0.35; E = uRed * (arc * 0.65 + tick * 0.55 + glow * 0.18);
    } else if (uKind == 3) {                                   // 一圈火：墙根烧黑，火苗此起彼伏；三道往里指的爪刻度慢慢转；uFront 是从哪烧到哪（0 到 1 绕一圈）
      float th = atan(p.y, p.x), u = th / 6.2832 + 0.5;
      float rev = 1.0 - smoothstep(uFront - 0.05, uFront, u);
      float fl = fbm(vec2(th * 4.0 + uSeed, uT * 1.6)), fl2 = vn(vec2(th * 22.0 - uSeed, uT * 5.0 + r * 9.0)), dr = r - 0.9;
      float band = 1.0 - smoothstep(0.0, 0.03 + 0.06 * fl * (0.5 + fl2), abs(dr + 0.02 * (fl2 - 0.5)));
      float base = (1.0 - smoothstep(0.06, 0.14, abs(dr))) * 0.55;
      float haze = (1.0 - smoothstep(0.15, 0.85, r)) * 0.035;
      float ang = mod(th - uT * 0.5, 2.0944) - 1.0472, tk = (1.0 - smoothstep(0.012, 0.03, abs(ang) * r)) * smoothstep(0.6, 0.64, r) * (1.0 - smoothstep(0.76, 0.8, r));
      float lead = exp(-pow((u - uFront) / 0.03, 2.0)) * step(uFront, 0.999) * (1.0 - smoothstep(0.0, 0.12, abs(dr)));      // 正在烧过去的那一头最亮
      A = (base + tk * 0.3 + haze * 0.5) * rev; E = (heat(0.3 + 0.55 * fl) * band * (0.65 + 0.7 * fl2) + uRed * tk * 0.6 + uRed * haze * 0.6) * rev * uHeat + uHot * lead * 1.2;
    } else {                                                   // 落地的焦痕：边缘不齐的一块焦黑，几道放射的裂缝里烧红
      float n = fbm(p * 2.2 + uSeed), blot = 1.0 - smoothstep(0.35, 0.9, r + (n - 0.5) * 0.45);
      float th = atan(p.x, p.y), w = fbm(vec2(th * 2.0 + uSeed, r * 3.0));
      float f = fract(th * 1.27 + w * 0.7 + uSeed), dl = min(f, 1.0 - f) * (0.6 + r);      // 离最近一道裂缝多远（一圈八道左右，越往外越细）
      float cr = (1.0 - smoothstep(0.004, 0.026 + 0.02 * (1.0 - r), dl)) * smoothstep(0.1, 0.25, r) * (1.0 - smoothstep(0.6, 1.0, r + (w - 0.5) * 0.3));
      A = blot * 0.62 + cr * 0.3; float h = uHeat * (cr + blot * 0.05 * (1.0 - r)); E = heat(min(1.0, h)) * h;
    }
    if (uKind == 0 || uKind == 4) { float dis = smoothstep(0.55, 1.0, uK); if (dis > 0.0) { float dn = fbm(p * 3.0 + uSeed * 1.7) * 0.8 + vn(p * 13.0 + uSeed) * 0.2, keep = smoothstep(dis * 1.15 - 0.15, dis * 1.15, dn); A *= keep; E *= keep; } }      // 淡出：一块块蚀掉，不是整片变淡
    if (r > 1.0 && uKind != 0) discard;
    A *= uAlpha; E *= uAlpha;
    // 发光的地方也挡住一部分地面（第九轮 k-kaz 第一轮的教训：熔岩红叠加在青绿的地面上会变成发粉的肉色，先压暗地面、红才是红）
    float a = A + clamp(max(E.r, max(E.g, E.b)), 0.0, 1.0) * 0.6; if (a < 0.003) discard;
    gl_FragColor = vec4(uChar * A + E, min(a, 1.0));
    #include <colorspace_fragment>
  }`;
const PATCH_VERT = `varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
type Kind = "rake" | "fan" | "brand" | "ring" | "scorch";
const KIND: Record<Kind, number> = { rake: 0, fan: 1, brand: 2, ring: 3, scorch: 4 };
let gridBase: THREE.BufferGeometry | null = null;
interface PatchRec { busy: boolean; m: THREE.Mesh; u: U; geo: THREE.BufferGeometry; }
const patchPool = new WeakMap<THREE.Group, PatchRec[]>();
function getPatch(fx: FxLib): PatchRec {
  let list = patchPool.get(fx.group); if (!list) patchPool.set(fx.group, (list = []));
  let p = list.find(r => !r.busy);
  if (!p) {
    if (!gridBase) { gridBase = new THREE.PlaneGeometry(2, 2, 14, 14); gridBase.rotateX(-Math.PI / 2); }
    const u: U = { uKind: { value: 0 }, uK: { value: 0 }, uT: { value: 0 }, uAlpha: { value: 0 }, uSeed: { value: 0 }, uHeat: { value: 1 }, uFront: { value: 1 }, uAng: { value: 0.6 }, uCurve: { value: 1 },
      uChar: { value: col(KZ.CHAR) }, uRed: { value: col(KZ.LAVA) }, uHot: { value: col(KZ.MOLTEN) } };
    const geo = gridBase.clone(), m = new THREE.Mesh(geo, new THREE.ShaderMaterial({ ...premul, uniforms: u, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, vertexShader: PATCH_VERT, fragmentShader: PATCH_FRAG }));
    m.frustumCulled = false; m.visible = false; fx.group.add(m); p = { busy: false, m, u, geo }; list.push(p);
  }
  p.busy = true; return p;
}
export interface Patch { u: U; set: (x: number, z: number, yaw?: number) => void; size: (r: number, len?: number) => void; kill: (fade?: number) => void; alive: () => boolean; }
/** 铺一块贴地的图案，life 秒以后自己收走。frame 每帧调一次（t 是出来以后过了几秒，k 是 t/life），由它改 uniform 做动画；kill 是提前在 fade 秒里淡掉 */
function patch(api: Api, fx: FxLib, kind: Kind, o: { x: number; z: number; yaw?: number; r: number; len?: number; life: number; lift?: number; order?: number }, frame: (t: number, k: number, u: U) => void): Patch {
  const R = getPatch(fx), u = R.u, m = R.m, P = R.geo.getAttribute("position") as THREE.BufferAttribute, B = gridBase!.getAttribute("position"), lift = o.lift ?? 0.09;
  let r = o.r, len = o.len ?? o.r, lx = NaN, lz = 0, lyaw = 0, lr = 0, ll = 0, done = false, dying = -1, fadeK = 0.3, t = 0;
  const drape = () => { const { x, z } = m.position, yaw = m.rotation.y;
    if (Math.hypot(x - lx, z - lz) < 0.25 && Math.abs(yaw - lyaw) < 0.05 && Math.abs(r - lr) < 0.03 * r && Math.abs(len - ll) < 0.03 * len) return;
    lx = x; lz = z; lyaw = yaw; lr = r; ll = len; const y0 = fx.ground(x, z), cs = Math.cos(yaw), sn = Math.sin(yaw); m.position.y = y0; m.scale.set(r, 1, len);
    for (let i = 0; i < P.count; i++) { const px = B.getX(i) * r, pz = B.getZ(i) * len; P.setY(i, fx.ground(x + px * cs + pz * sn, z - px * sn + pz * cs) + lift - y0); } P.needsUpdate = true; };
  u.uKind.value = KIND[kind]; u.uSeed.value = Math.random() * 40; u.uK.value = 0; u.uT.value = 0; u.uAlpha.value = 0; u.uHeat.value = 1; u.uFront.value = 1;
  m.renderOrder = o.order ?? (kind === "rake" || kind === "scorch" ? 5.6 : 6.2); m.rotation.y = o.yaw ?? 0; m.position.set(o.x, 0, o.z); m.visible = true; drape();
  const finish = () => { if (done) return; done = true; m.visible = false; R.busy = false; };
  frame(0, 0, u);
  api.run(o.life, (k, dt) => { if (done) return; t += dt; u.uK.value = k; u.uT.value = t; frame(t, k, u);
    if (dying >= 0) { const f = 1 - (t - dying) / fadeK; if (f <= 0) return finish(); u.uAlpha.value *= f; } }, finish);
  return { u, alive: () => !done,
    set(x, z, yaw) { if (done) return; m.position.x = x; m.position.z = z; if (yaw !== undefined) m.rotation.y = yaw; drape(); },
    size(nr, nl) { r = nr; len = nl ?? nr; drape(); },
    kill(fade = 0.3) { if (done || dying >= 0) return; dying = t; fadeK = Math.max(0.01, fade); } };
}
const c01 = (v: number) => Math.max(0, Math.min(1, v));

/** 地上三道并排的爪痕。(x,z) 是中心，yaw 是划的方向（从 yaw 的反方向划向 yaw），len 半长、wid 半宽；sweep 秒划完，hot 秒以后在 cool 秒里凉下去，一共 life 秒 */
export function rake(api: Api, fx: FxLib, o: { x: number; z: number; yaw: number; len: number; wid: number; life?: number; sweep?: number; hot?: number; cool?: number; alpha?: number; curve?: number }) {
  const life = o.life ?? 1.6, sweep = o.sweep ?? 0.07, hot = o.hot ?? 0.2, cool = o.cool ?? 0.9, al = o.alpha ?? 1;
  return patch(api, fx, "rake", { x: o.x, z: o.z, yaw: o.yaw + Math.PI, r: o.wid, len: o.len, life }, (t, _k, u) => {      // 本地 y 从 +1 划到 -1，所以转半圈：从 yaw 的反方向划向 yaw
    u.uCurve.value = o.curve ?? 1; u.uFront.value = Math.min(1.15, (t / sweep) * 1.15); u.uHeat.value = t < hot ? 1 : c01(1 - (t - hot) / cool) ** 1.3; u.uAlpha.value = al * Math.min(1, t / 0.03); });
}
/** 炉吼的扇形热浪：grow 秒里前沿推到 r 米，再 fade 秒淡掉 */
export function fan(api: Api, fx: FxLib, o: { x: number; z: number; yaw: number; r: number; ang: number; grow?: number; fade?: number; alpha?: number }) {
  const grow = o.grow ?? 0.32, fade = o.fade ?? 0.45, al = o.alpha ?? 1;
  return patch(api, fx, "fan", { x: o.x, z: o.z, yaw: o.yaw, r: o.r, life: grow + fade, order: 6.2 }, (t, _k, u) => {
    const g = Math.min(1, t / grow), e = 1 - Math.pow(1 - g, 2.2); u.uAng.value = o.ang; u.uFront.value = 0.12 + 0.88 * e; u.uHeat.value = t < grow ? 1 : c01(1 - (t - grow) / fade);
    u.uAlpha.value = al * Math.min(1, t / 0.04) * (t < grow ? 1 : Math.pow(c01(1 - (t - grow) / fade), 1.4)); });
}
/** 易伤的烙印：跟着 e 走，life 秒，最后 0.5 秒淡掉 */
export function brand(api: Api, fx: FxLib, e: { x: number; z: number; alive: boolean }, o: { r: number; life: number; alpha?: number; show?: () => boolean }) {
  const al = o.alpha ?? 0.8; let p: Patch | null = null;      // 先声明：patch 里第一帧就会调 frame，那时 p 还没赋值
  p = patch(api, fx, "brand", { x: e.x, z: e.z, r: o.r, life: o.life, order: 6.1 }, (t, _k, u) => {
    p?.set(e.x, e.z); u.uFront.value = 1 - Math.pow(1 - Math.min(1, t / 0.2), 3); u.uAlpha.value = (o.show && !o.show() ? 0 : al) * Math.min(1, t / 0.08) * c01((o.life - t) / 0.5) * (e.alive ? 1 : 0); });
  return p;
}
/** 一圈火（贴地）：ignite 秒里从一处烧满一圈（0 就是一出来就是满的）；heat 是旺度，alpha 整体透明度。返回的 Patch 可以 set 跟着人走、kill 淡掉 */
export function fireRing(api: Api, fx: FxLib, o: { x: number; z: number; r: number; life: number; ignite?: number; alpha?: () => number; heat?: () => number; yaw?: number }) {
  return patch(api, fx, "ring", { x: o.x, z: o.z, r: o.r, life: o.life, yaw: o.yaw, order: 6.2 }, (t, _k, u) => {
    u.uFront.value = o.ignite ? Math.min(1.06, (t / o.ignite) * 1.06) : 1.06; u.uHeat.value = o.heat ? o.heat() : 1; u.uAlpha.value = (o.alpha ? o.alpha() : 1) * Math.min(1, t / 0.05); });
}
/** 落地的焦痕：sweep 秒里从小铺开，hot 秒以后在 cool 秒里凉下去 */
export function scorch(api: Api, fx: FxLib, o: { x: number; z: number; r: number; life?: number; hot?: number; cool?: number; alpha?: number }) {
  const life = o.life ?? 2.6, hot = o.hot ?? 0.3, cool = o.cool ?? 1.2, al = o.alpha ?? 0.9; let p: Patch | null = null;
  p = patch(api, fx, "scorch", { x: o.x, z: o.z, r: o.r, life, yaw: Math.random() * 6.28 }, (t, _k, u) => {
    const g = 1 - Math.pow(1 - Math.min(1, t / 0.14), 2.5); if (p && g < 1) p.size(o.r * (0.35 + 0.65 * g)); u.uHeat.value = (t < hot ? 1 : c01(1 - (t - hot) / cool)) * (1 + 0.6 * Math.exp(-t / 0.1)); u.uAlpha.value = al * Math.min(1, t / 0.03); });
  return p;
}

// ---------------------------------------------------------------- 目标身上一闪的三道爪痕（正对镜头）
const CLAW_VERT = /* glsl */ `uniform vec3 uC; uniform float uSize, uRot; varying vec2 vUv;
  void main(){ vUv = position.xy * 2.0; vec4 mv = viewMatrix * vec4(uC, 1.0); float c = cos(uRot), s = sin(uRot); vec2 q = vec2(c * position.x - s * position.y, s * position.x + c * position.y);
    mv.xy += q * uSize; gl_Position = projectionMatrix * mv; }`;
const CLAW_FRAG = /* glsl */ `uniform float uFront, uThin, uAlpha, uSeed; uniform vec3 uChar, uRed, uHot; varying vec2 vUv;
  ${NOISE}
  void main(){ vec2 p = vUv; float ink = 0.0, body = 0.0, core = 0.0;
    for (int i = 0; i < 3; i++) {
      float fi = float(i) - 1.0, L = 1.0 - abs(fi) * 0.16, y = p.y / L;
      if (abs(y) < 1.0) {
        float sw = (1.0 - y) * 0.5, rv = 1.0 - smoothstep(uFront - 0.15, uFront, sw);
        float xc = fi * 0.3 + 0.2 * (y * y - 0.3) + (vn(vec2(y * 3.0 + fi * 4.0, uSeed)) - 0.5) * 0.04, w = 0.12 * pow(1.0 - y * y, 0.6) * uThin, d = abs(p.x - xc);
        ink = max(ink, (1.0 - smoothstep(w, w * 2.3 + 0.05, d)) * rv);
        body = max(body, (1.0 - smoothstep(w * 0.55, w, d)) * rv);
        core = max(core, (1.0 - smoothstep(0.0, w * 0.32, d)) * rv * (1.0 + 1.2 * exp(-max(uFront - sw, 0.0) * 6.0)));
      }
    }
    float A = ink * 0.5 * uAlpha; vec3 E = (uRed * body * 0.9 + uHot * core * 1.1 + vec3(1.0, 0.9, 0.75) * core * core * 0.25) * uAlpha;
    float a = A + clamp(body * 0.65, 0.0, 1.0) * uAlpha; if (a < 0.004) discard;      // 红的那一道也挡住后面（不然叠在青绿的地面、灰的身子上发粉）
    gl_FragColor = vec4(uChar * A + E, min(a, 1.0));
    #include <colorspace_fragment>
  }`;
let clawGeo: THREE.PlaneGeometry | null = null;
interface ClawRec { busy: boolean; m: THREE.Mesh; u: U; }
const clawPool = new WeakMap<THREE.Group, ClawRec[]>();
/** 三道爪痕：pos 是中心，size 是半边长（米），rot 是画面里的斜度（弧度，0 是竖着从上往下划）；sweep 秒划开，之后一边变细一边淡掉，一共 life 秒 */
export function claw(api: Api, fx: FxLib, o: { pos: V3; size: number; rot: number; life?: number; sweep?: number; alpha?: number }) {
  let list = clawPool.get(fx.group); if (!list) clawPool.set(fx.group, (list = []));
  let R = list.find(r => !r.busy);
  if (!R) { clawGeo ??= new THREE.PlaneGeometry(1, 1);
    const u: U = { uC: { value: new THREE.Vector3() }, uSize: { value: 1 }, uRot: { value: 0 }, uFront: { value: 0 }, uThin: { value: 1 }, uAlpha: { value: 1 }, uSeed: { value: 0 }, uChar: { value: col(KZ.CHAR) }, uRed: { value: col(KZ.LAVA) }, uHot: { value: col(KZ.MOLTEN) } };
    const m = new THREE.Mesh(clawGeo, new THREE.ShaderMaterial({ ...premul, uniforms: u, transparent: true, depthWrite: false, depthTest: false,      /* 爪痕画在目标前面：划的就是它，不能被它的身子挡掉 */ side: THREE.DoubleSide, vertexShader: CLAW_VERT, fragmentShader: CLAW_FRAG }));
    m.frustumCulled = false; m.renderOrder = 9.2; m.visible = false; fx.group.add(m); R = { busy: false, m, u }; list.push(R); }
  const rec = R; rec.busy = true; const u = rec.u, life = o.life ?? 0.22, sweep = o.sweep ?? 0.05, al = o.alpha ?? 1;
  (u.uC.value as THREE.Vector3).set(o.pos.x, o.pos.y, o.pos.z); u.uSize.value = o.size * 2; u.uRot.value = o.rot; u.uSeed.value = Math.random() * 30; u.uFront.value = 0; u.uThin.value = 1; u.uAlpha.value = al; rec.m.visible = true;
  api.run(life, k => { const t = k * life; if (t < sweep) u.uFront.value = (t / sweep) * 1.15; else { const f = (t - sweep) / Math.max(1e-3, life - sweep); u.uFront.value = 1.15; u.uThin.value = 1 - 0.65 * f; u.uAlpha.value = al * (1 - f * f); } },
    () => { rec.m.visible = false; rec.busy = false; });
}

// ---------------------------------------------------------------- 旋爪的弧光（平放在半空的一道厚弧，里面三道爪痕）
// fx2a 的月牙刀光是叠加发光的，熔岩红叠在青绿的地面上发白发粉；这里用预乘透明：一条压暗的带子，里面三道并排的熔岩红爪痕，外沿一道熔铁的亮边，
// 头上最烫，身后的尾巴越来越暗。带子沿弧线 48 段、横着 2 行（v=0 内沿，1 外沿），形状在顶点着色器里按 uniform 算，几何体全场一份
const ARC_VERT = /* glsl */ `uniform float uArc, uR, uW, uFlip; varying vec2 vUv;
  void main(){ float t = position.x, v = position.y; vUv = vec2(t, v); float th = (t - 0.5) * uArc * (uFlip > 0.5 ? -1.0 : 1.0);
    float w = uW * (0.35 + 0.65 * pow(max(0.0, sin(3.14159 * t)), 0.5)), rr = uR - w * (1.0 - v);      // 两头收窄
    gl_Position = projectionMatrix * modelViewMatrix * vec4(sin(th) * rr, 0.0, cos(th) * rr, 1.0); }`;
const ARC_FRAG = /* glsl */ `uniform float uHead, uAlpha, uTail, uThin, uSeed; uniform vec3 uChar, uRed, uHot; varying vec2 vUv;
  ${NOISE}
  void main(){ float u = vUv.x, v = vUv.y; if (u > uHead) discard;
    float behind = uHead - u, tail = exp(-behind * uTail) * smoothstep(0.0, 0.04, u), hot = exp(-behind * 14.0) * (1.0 - smoothstep(0.98, 1.15, uHead));
    float n = vn(vec2(u * 40.0 + uSeed, v * 3.0)), lines = 0.0;
    float tip = 0.2 + 0.8 * smoothstep(0.0, 0.07, behind);      // 爪尖：三道在扫过去的那一头收成尖的（第一轮是平切的一刀）
    for (int i = 0; i < 3; i++) { float fi = float(i), vc = 0.32 + 0.22 * fi + (vn(vec2(u * 9.0, fi * 7.0 + uSeed)) - 0.5) * 0.06, w = (0.06 + 0.02 * fi) * uThin * tip * (0.55 + 0.45 * exp(-behind * 2.5));
      lines = max(lines, (1.0 - smoothstep(w * 0.35, w, abs(v - vc))) * (0.7 + 0.3 * n) * (fi == 1.0 ? 1.0 : 0.85)); }
    // 第四批 polish-new：原来身子很淡（0.5 的压暗 + 0.08 的红），只读出三道细红线和一道边，几道弧叠起来像几圈细线。
    // 现在是一道实的月牙：从内沿到外沿越来越浓的熔岩红（爪子扫过去的残影），外沿一道熔铁的亮边，三道爪痕是压在上面的更亮的细缝
    float body = smoothstep(0.0, 0.75, v) * (1.0 - smoothstep(0.93, 1.0, v)), edge = 1.0 - smoothstep(0.0, 0.12 * uThin + 0.02, 1.0 - v);
    float A = (body * 0.62 + lines * 0.15) * tail * uAlpha;
    vec3 E = (uRed * (body * (0.32 + 0.4 * hot) + lines * 0.75 + edge * 0.6) + uHot * (lines * hot * 0.8 + edge * (0.3 + 0.7 * hot))) * tail * uAlpha;
    float a = A + clamp(max(E.r, max(E.g, E.b)), 0.0, 1.0) * 0.6; if (a < 0.004) discard;
    gl_FragColor = vec4(uChar * A + E, min(a, 1.0));
    #include <colorspace_fragment>
  }`;
let arcGeo: THREE.BufferGeometry | null = null;
interface ArcRec { busy: boolean; m: THREE.Mesh; u: U; }
const arcPool = new WeakMap<THREE.Group, ArcRec[]>();
/** 一道平放的厚弧：圆心 pos，朝 yaw，外半径 r、带宽 w，张 arc 弧度；sweep 秒里从一头扫到另一头（flip 反着扫），之后变细、淡掉，一共 life 秒 */
export function sweepArc(api: Api, fx: FxLib, o: { pos: V3; yaw: number; r: number; w: number; arc: number; flip?: boolean; sweep?: number; life?: number; alpha?: number }) {
  let list = arcPool.get(fx.group); if (!list) arcPool.set(fx.group, (list = []));
  let R = list.find(x => !x.busy);
  if (!R) { if (!arcGeo) { const S = 48, P: number[] = [], I: number[] = []; for (let i = 0; i <= S; i++) { P.push(i / S, 0, 0, i / S, 1, 0); if (i < S) { const k = i * 2; I.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); } } arcGeo = new THREE.BufferGeometry(); arcGeo.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); arcGeo.setIndex(I); }
    const u: U = { uArc: { value: 4.7 }, uR: { value: 3 }, uW: { value: 0.8 }, uFlip: { value: 0 }, uHead: { value: 0 }, uAlpha: { value: 1 }, uTail: { value: 2.5 }, uThin: { value: 1 }, uSeed: { value: 0 }, uChar: { value: col(KZ.CHAR) }, uRed: { value: col(KZ.LAVA) }, uHot: { value: col(KZ.MOLTEN) } };
    const m = new THREE.Mesh(arcGeo, new THREE.ShaderMaterial({ ...premul, uniforms: u, transparent: true, depthWrite: false, side: THREE.DoubleSide, vertexShader: ARC_VERT, fragmentShader: ARC_FRAG }));
    m.frustumCulled = false; m.renderOrder = 9; m.visible = false; fx.group.add(m); R = { busy: false, m, u }; list.push(R); }
  const rec = R; rec.busy = true; const u = rec.u, life = o.life ?? 0.36, sweep = o.sweep ?? 0.11, al = o.alpha ?? 1;
  u.uArc.value = o.arc; u.uR.value = o.r; u.uW.value = o.w; u.uFlip.value = o.flip ? 1 : 0; u.uHead.value = 0; u.uThin.value = 1; u.uAlpha.value = al; u.uTail.value = 2.2; u.uSeed.value = Math.random() * 30;
  rec.m.position.set(o.pos.x, o.pos.y, o.pos.z); rec.m.rotation.set(0, o.yaw, 0); rec.m.visible = true;
  api.run(life, k => { const t = k * life; if (t < sweep) u.uHead.value = (t / sweep) * 1.0; else { const f = (t - sweep) / Math.max(1e-3, life - sweep); u.uHead.value = 1 + f * 0.4; u.uThin.value = 1 - 0.6 * f; u.uTail.value = 2.2 + 4 * f; u.uAlpha.value = al * (1 - f) * (1 - f * 0.4); } },
    () => { rec.m.visible = false; rec.busy = false; });
}

/** 每种零件先各出一个看不见的（在地下 40 米、完全透明），让着色器趁开局编好。一局只做一次 */
const warmed = new WeakSet<THREE.Group>();
export function warmKaz(api: Api, fx: FxLib, x: number, z: number) {
  if (warmed.has(fx.group)) return; warmed.add(fx.group);
  const p = patch(api, fx, "rake", { x, z, r: 0.01, life: 0.1, lift: -40 }, (_t, _k, u) => { u.uAlpha.value = 0; }); void p;
  claw(api, fx, { pos: { x, y: fx.ground(x, z) - 40, z }, size: 0.01, rot: 0, life: 0.1, alpha: 0 });
  sweepArc(api, fx, { pos: { x, y: fx.ground(x, z) - 40, z }, yaw: 0, r: 0.01, w: 0.005, arc: 1, life: 0.1, alpha: 0 });
}
