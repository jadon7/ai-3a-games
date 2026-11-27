// 塞伦 · 珠铳（射手，沉月会）。设计在 docs/round9/heroes/DESIGN.md 的“塞伦”一节。
//
// 和薇萝分开：薇萝靠技能（穿甲、火油、齐射），塞伦靠普攻——前期射程短、技能伤害少，后期站得远、打得疼。
//   被动 潮涨   射程每级 +0.15（1 级 7.15，满级 9.25；用 api.buff 给 range，升级、复活时刷新）。每第四发普攻是“满潮弹”：直线穿透，路上每个敌人都吃这一发的全额伤害。
//   Q 压满      瞬发。4 秒内攻速 ×1.5，普攻在目标身边 1.8 米溅射 30%。
//   W 珍珠雷    范围，距离 8，最多同时 2 颗。埋一颗存在 40 秒、0.8 秒后生效的雷：敌方英雄或小兵走进 1.2 米就炸，定身 1 秒，80 + 40% 攻击力 + 每级 12（物理）。
//   E 反冲      非指向。朝鼠标方向轰一铳：面前 3.5 米、半张角 30° 的扇形里的敌人被推开 2 米，60 + 50% 攻击力（物理）；自己往反方向滑出 5 米（0.3 秒，不穿墙）。
//   R 沉月弹    6 级。蓄力约 0.9 秒（单膝跪地，不能动），打出一颗大珍珠（速度 55）穿过 24 米、宽 1.6：第一个英雄 300 + 150% 攻击力 + 每级 40（物理），
//               之后每穿过一个英雄少 15%（最低 40%），小兵按一半；打中的英雄被推开 1.5 米、减速 40% 1.5 秒。
//
// 规格没写到、实现时定下来的几处：
//   · 射程上限和塔：塔打英雄算到英雄的边（11.5 + 0.6 = 离塔心 12.1 米），英雄打塔算到塔的边（9.25 + 1.9 = 11.15 米）。满级的塞伦仍然比塔近 0.95 米，
//     站在能打到塔的最远处也在塔的射程里，不会白拆塔（tools/seren_range.mjs 量过）。
//   · 满潮弹：从铳口朝主目标打一条直线，长度取 9 米和“离主目标再往后 2.5 米”里大的那个（满级射程 9.25 时 9 米够不着人）。
//     主目标仍然吃原来那一发追踪弹的伤害（装备、吸血、暴击照常），直线只给路上其他人：每人一发攻击力的物理伤害（按技能伤害算，不触发普攻特效）。直线会被墙挡住。
//   · 压满的溅射按“目标的边往外 1.8 米”算，打塔时也溅（塔下的小兵）；溅射伤害按技能伤害算。
//   · 珍珠雷：踩雷不看视野（草丛里、迷雾里的人走进去照样炸）；炸了以后 2 秒里照出雷周围 2.2 米的敌人（api.reveal，和乌戈加的同名同参数）；野怪不触发、也不受伤。
//     炸开时 1.5 米内的英雄和小兵都吃伤害和定身（比触发的 1.2 米大一点，两个人挨着走只有一个吃到太亏）。第三颗埋下去时最早的那颗沉下去作废。
//   · 反冲：不管鼠标点得多近，都轰满 3.5 米的扇形、滑满 5 米（碰到墙就停）。人一直面朝开铳的方向往后滑（动作里的后跳已经去掉了水平位移，交给这里滑）。
//     触屏点一下：摇杆推着就朝摇杆的方向退（铳朝反方向开，play.ts 的 tapAim "back"）；没推就自动对准身边的敌人开铳、往后退。
//   · 沉月弹：蓄力是施法前摇（时间表里 r 的 pre 写成 0.89，按动作原速播，是“大招前摇 ≤0.4 秒”的例外）。蓄力里被晕、被推会打断，冷却和法力不扣。
//     弹道不会被墙挡（照 LoL 伊泽瑞尔、金克丝的大招）。
//
// 特效的路子：珍珠、贝壳、海水。弹头是有珍珠母虹光的珠子，弹道是白芯淡海色的水线（两边垫一层深海蓝），出膛是白色水汽，命中溅水珠；
// 珊瑚橙只用在“压”上（满潮弹的水线边、压力罐上的刻度、大招打中的那一圈、定身硬壳的边）。不用叠加发光的大团光，最亮的一下是大招出手的白光（0.16 秒）。
// 新零件在 fx_k-seren.ts；水冠、印记、闪光用 fx_fx2a，厚冲击环用 fx_fx2b，立着的冲击用 fx_fx2c。

import * as THREE from "three";
import type { Actor } from "../actor";
import type { Ent } from "../sim";
import type { Api, Cast, HeroKit, ProjVis, SkillDef } from "../skills";
import { SPR, type Emitter, type FxLib, type V3 } from "../fxlib";
import { LITE } from "../../quality";
import { pick } from "../fxb";
import { converge, crown, mark, spear, splash, windup } from "../fx_fx2a";
import { thickRing } from "../fx_fx2b";
import { wall } from "../fx_fx2c";
import { dot, fan, gauge, halo, lane, line, mine, pearl, shell, skid, swirl, trap, warmSeren, type Dot, type Gauge, type Lane, type Pearl, type Swirl } from "../fx_k-seren";

// 换画风 B（b-fx）：淡海色的水线身子、浅青的水冠在亮地面上看不见，近黑的深海蓝垫底成了污渍。B 下海色、潮青饱和一档，垫底是同色系的海蓝（不是黑）；珊瑚、珍珠白不动
const CORAL = 0xf07c5e, FOAM = 0xe8fbf6, NACRE = 0xe8e2d6, TIDE = pick(0x58e6e0, 0x1cbfd8), SEA = pick(0xbfe9e4, 0x3cbcd2), ABYSS = pick(0x0e2a40, 0x0f6496), MIST = 0xf2faf9, MIST2 = 0x9fb9bc, BLUSH = 0xffc9b8;
const isBuilding = (e: Ent) => e.kind === "tower" || e.kind === "core";
const isMinion = (e: Ent) => e.kind === "melee" || e.kind === "ranged";
const v3 = () => new THREE.Vector3();
const SPEED = 40;                        // 普攻弹道的速度（薇萝 34）
const CONE = (30 * Math.PI) / 180;       // 反冲的半张角

// ---------------------------------------------------------------- 小零件
const B0 = v3();
/** 铳口：长铳最前头的那一点（模型没有武器时退到手前面一点） */
function muzzle(a: Actor, out: THREE.Vector3): THREE.Vector3 { if (!a.hero.blade("R", B0, out)) { a.hand(out); out.x += Math.sin(a.yaw()) * 1.1; out.z += Math.cos(a.yaw()) * 1.1; } return out; }
/** 压力罐：挂在枪管下面、离握把不远（取武器从手到铳口的三成处，往下一点） */
function tank(a: Actor, out: THREE.Vector3): THREE.Vector3 { if (a.hero.blade("R", out, B0)) { out.y -= 0.1; return out; } return a.hand(out); }
/** 一团白色水汽（普通半透明，不发光）：出膛、压力罐喷气、大招尽头散成雾 */
function mist(fx: FxLib, p: V3, o: { n: number; dir?: V3; spread?: number; speed?: [number, number]; size?: [number, number]; life?: [number, number]; alpha?: [number, number]; drag?: number; up?: number; radius?: number; grow?: number }) {
  fx.burst({ pos: p, n: o.n, sprite: SPR.smoke, color: [MIST, MIST2], alpha: o.alpha ?? [0.3, 0.45], size: o.size ?? [0.25, 0.4], grow: o.grow ?? 2.6, life: o.life ?? [0.35, 0.6], speed: o.speed ?? [0.5, 2], dir: o.dir, spread: o.spread ?? 0.6, drag: o.drag ?? 4, up: o.up ?? 0.3, radius: o.radius });
}
/** 溅开的水珠（普通半透明） */
function drops(fx: FxLib, p: V3, o: { n: number; dir?: V3; spread?: number; speed?: [number, number]; size?: [number, number]; life?: [number, number]; up?: number; color?: [number, number]; gravity?: number }) {
  fx.burst({ pos: p, n: o.n, sprite: SPR.drop, color: o.color ?? [FOAM, TIDE], dir: o.dir, spread: o.spread ?? 1.0, speed: o.speed ?? [2, 5], size: o.size ?? [0.07, 0.13], life: o.life ?? [0.25, 0.45], gravity: o.gravity ?? 12, stretch: 1.1, up: o.up });
}
/** 一下很小的白光（四芒星） */
const glint = (fx: FxLib, p: V3, size: number, color = FOAM, life = 0.1) => fx.burst({ pos: p, n: 1, sprite: SPR.glint, add: true, color: [0xffffff, color], size, grow: 1.4, life, speed: 0, alpha: 0.9 });

/** 一发珍珠弹：珍珠、身后一道水线（越飞越长，最长 tail），沿路按距离放点缀（trail）。out：每帧写弹头在哪（命中的特效放那儿）。
 *  halo：弹头外面那团小光有多大（米，0 不要），底下垫一团深海蓝（第四批 polish-new 加的：游戏镜头 27 米远，原来的珠子和细线只剩十几个像素） */
function shotVis(api: Api, fx: FxLib, o: { r: number; width: number; tail: number; color2?: number; core?: number; glow?: number; occ?: number; linger?: number; out?: THREE.Vector3; step?: number; halo?: number; haloColor?: number; trail?: (p: THREE.Vector3, dx: number, dz: number) => void }): ProjVis {
  const pr = pearl(fx, o.r), ln = line(fx, { width: o.width, core: o.core ?? 0.32, color2: o.color2 ?? SEA, deep: ABYSS, taper: 1.0, thin: 0.25, glow: o.glow, occ: o.occ }), pos = v3(), prev = v3(), tl = v3(), d = v3(); let len = 0, acc = 0, first = true, t = 0;
  const hs = o.halo ?? 0, hl: Dot | null = hs ? dot(fx, o.haloColor ?? SEA) : null, hd: Dot | null = hs ? dot(fx, ABYSS, true) : null;
  return {
    move(x, y, z, dx, dy, dz, dt) {
      pos.set(x, y, z); if (first) { first = false; prev.copy(pos); } t += dt;
      const step = pos.distanceTo(prev); d.set(dx, dy, dz); if (d.lengthSq() < 1e-8) d.set(0, 0, 1); d.normalize();
      pr.obj.position.copy(pos); pr.obj.rotation.x += dt * 14; pr.obj.rotation.y += dt * 5;      // 珠子是滚着飞的：虹光在上面流
      if (hl && hd) { const pop = 1 + 0.5 * Math.max(0, 1 - t / 0.06); hd.set(pos, hs * 1.25, 0.42); hl.set(pos, hs * pop, 0.62); }      // 刚出膛的一瞬大一点
      len = Math.min(o.tail, len + step); ln.set(tl.copy(pos).addScaledVector(d, -len), pos); o.out?.copy(pos);
      if (o.trail) { acc += step; const every = o.step ?? 1; while (acc >= every) { acc -= every; o.trail(tl.copy(pos).addScaledVector(d, -acc), d.x, d.z); } }      // 按飞过的距离放：弹道快，按时间放会聚成一团一团
      prev.copy(pos);
    },
    done() {
      pr.free(); hl?.free(); hd?.free(); if (first) { ln.free(); return; }
      const head = pos.clone(), dir = d.clone(), L = len, life = o.linger ?? 0.12, w0 = o.width; api.run(life, k => { ln.alpha(Math.pow(1 - k, 1.5)); ln.width(w0 * (1 - 0.45 * k)); ln.set(tl.copy(head).addScaledVector(dir, -L * (1 - 0.75 * k)), head); }, () => ln.free());      // 水线留一下：尾巴往弹头那头收、越收越细，再淡掉（一道水柱打过去的残影）
    },
  };
}

// ---------------------------------------------------------------- 被动 潮涨 · 满潮弹
const P: SkillDef = { key: "P", name: "潮涨", icon: "seren_p", cast: "passive",
  desc: "射程随等级变远：每级多 0.12 米（1 级 7.12 米，满级 8.8 米）。每第四发普攻是满潮弹：直线穿透，路上每个敌人都受到这一发的全额伤害。" };

/** 满潮弹：从铳口朝主目标打一条穿透的直线。主目标的伤害走原来那发追踪弹（看不见），这条线打路上的其他人 */
function tideShot(me: Ent, a: Actor, api: Api, fx: FxLib, from: THREE.Vector3, target: Ent) {
  const l0 = Math.hypot(target.x - me.x, target.z - me.z) || 1, dx = (target.x - me.x) / l0, dz = (target.z - me.z) / l0, len = Math.max(9, l0 + 2.5), dmg = Math.round(api.stat(me).ad), at = v3(), yaw = Math.atan2(dx, dz), sx = from.x, sz = from.z;
  // 出膛：比平时大一团的白汽、一圈珊瑚色的环、一道往前的尖光
  mist(fx, from, { n: 7, dir: { x: dx, y: 0.12, z: dz }, spread: 0.45, speed: [2.5, 6], size: [0.24, 0.4], life: [0.4, 0.65], alpha: [0.32, 0.45], drag: 5 });
  halo(api, fx, from, { x: dx, y: 0, z: dz }, { r0: 0.18, r1: 0.7, life: 0.24, alpha: 0.9, push: 0.6 });
  spear(fx, from, { x: dx, y: 0.03, z: dz }, { size: 0.75, color: CORAL });
  // 地上跟着弹头划出一道水痕
  const wk = mark(api, fx, { kind: "wake", x: sx + dx * len / 2, z: sz + dz * len / 2, r: 0.38, len: len / 2, yaw, life: 1.1, w: 0.5, hot: 0.7, hotLife: 0.25, deep: ABYSS, color2: FOAM, color: 0xfff4ee, alpha: 0.7, fadeOut: 0.6 }); wk.head(-1);
  api.shoot({ me, from: { x: from.x, y: from.y, z: from.z }, dir: { x: dx, z: dz }, speed: SPEED, range: len, radius: 0.55, pierce: true,
    // 过程：大一圈的珍珠，水线粗、边上带一点珊瑚橙，沿路往下掉水珠
    vis: shotVis(api, fx, { r: 0.21, width: 0.78, core: 0.2, glow: 0.8, occ: 0.36, tail: 5.5, color2: CORAL, out: at, step: 0.55, linger: 0.28, trail: (p, x, z) => {
      drops(fx, p, { n: 1, dir: { x: x * 0.3, y: -0.3, z: z * 0.3 }, spread: 0.9, speed: [0.5, 1.5], size: [0.06, 0.1], gravity: 9, life: [0.3, 0.5] });
      wk.head(Math.min(1, -1 + 2 * Math.hypot(p.x - sx, p.z - sz) / len)); } }),
    hit(e) {
      if (isBuilding(e)) return false;
      if (e !== target) api.hit(me, e, dmg, "phys");
      // 穿过的每个人：身上溅一下（水珠顺着弹道带出去），一下白光，脚下一小圈水冠
      const p = { x: e.x, y: at.y, z: e.z }; glint(fx, p, 0.75, CORAL, 0.12);
      drops(fx, p, { n: 9, dir: { x: dx, y: 0.35, z: dz }, spread: 0.55, speed: [3, 7], size: [0.08, 0.15] });
      crown(api, fx, e.x, e.z, { r: e.r * 0.7 + 0.2, r2: e.r + 0.9, h: 1.2, life: 0.38, rise: 0.07, deep: ABYSS, color2: SEA, alpha: 0.75 });
    },
    end(p) {      // 飞完：在尽头散成一团水雾，掉一把水珠
      const q = { x: p.x, y: at.y, z: p.z }; mist(fx, q, { n: 6, radius: 0.35, speed: [0.4, 1.6], size: [0.35, 0.55], grow: 2.8, life: [0.6, 0.9], alpha: [0.28, 0.4], drag: 2.5, up: 0.3 });
      drops(fx, q, { n: 8, spread: 3.1, speed: [1, 3], gravity: 10, life: [0.35, 0.6] });
    } });
  void a;
}

// ---------------------------------------------------------------- Q 压满
const Q: SkillDef = { key: "Q", name: "压满", icon: "seren_q", cast: "self", instant: true, cd: 9, mana: 40,
  desc: "给潮压铳压满：4 秒内攻速提高 50%，普攻对目标身边 1.8 米内的其他敌人造成 30% 的溅射伤害。",
  fire(c) {
    const { me, a, api, fx } = c, p = tank(a, v3()), yw = a.yaw();
    api.buff(me, "seren_q", 4, { asMul: 1.5 });
    // 出手：左手拍罐子，罐口“嗤”地喷出一股白汽（往上、往后）；三圈珊瑚色的小环顺着枪管从罐子推到铳口（“压”进去了）、铳口一下珊瑚色的光；
    // 脚下一圈珊瑚色的环推开、底下湿一片（第四批：原来只有一道细环和一团汽，画面里看不出放了什么）
    mist(fx, p, { n: 12, dir: { x: -Math.sin(yw) * 0.45, y: 1, z: -Math.cos(yw) * 0.45 }, spread: 0.32, speed: [3, 7], size: [0.2, 0.36], grow: 3.4, life: [0.5, 0.85], alpha: [0.38, 0.52], drag: 3.2, up: 0.6 });
    drops(fx, p, { n: 8, dir: { x: 0, y: 1, z: 0 }, spread: 0.6, speed: [1.5, 3.5], size: [0.06, 0.1] });
    glint(fx, p, 0.9, CORAL, 0.16);
    const b0 = v3(), b1 = v3(); if (a.hero.blade("R", b0, b1)) { const bd = v3().subVectors(b1, b0), L = bd.length(), at = v3().copy(b0).addScaledVector(bd, 0.3);      // 一圈珊瑚色的环从罐子顺着枪管推到铳口（只一圈：三圈叠在半空像几个飘着的圈）
      halo(api, fx, at, bd, { r0: 0.12, r1: 0.42, life: 0.2, alpha: 0.9, push: L * 0.7, color: CORAL, color2: BLUSH }); api.after(0.17, () => { if (a.hero.blade("R", b0, b1)) glint(fx, b1, 0.85, CORAL, 0.14); }); }
    mark(api, fx, { kind: "stain", x: a.pos.x, z: a.pos.z, r: 1.6, life: 0.9, deep: ABYSS, color2: SEA, alpha: 0.5, fadeIn: 0.03, fadeOut: 0.6 });
    thickRing({ api, fx }, { x: a.pos.x, z: a.pos.z, r: 1.9, r0: 0.6, width: 0.28, life: 0.38, color: FOAM, color2: CORAL, alpha: 0.85 });
    // 瞬发的技能不播动作（不打断普攻）；站着没事干的时候播一下“拍罐、竖铳”，播完回待机
    if (a.state() === "idle") { a.anim("q", { speed: 1.3, fade: 0.08 }); api.after(1.1, () => { if (a.state() === "idle" && a.hero.current === "q") a.anim("idle", { loop: true, fade: 0.2 }); }); }
  },
};

// ---------------------------------------------------------------- W 珍珠雷
interface MineRec { pop: (boom: boolean) => void; }
/** 定身的人：脚下一块扇贝纹的硬壳，腿上裹一圈珍珠母色的壳（立着），1 秒后裂开碎掉 */
function crust(api: Api, fx: FxLib, e: Ent) {
  const sh = shell(api, fx, e.x, e.z, e.r + 0.75, 0.95, { follow: () => (e.alive ? { x: e.x, z: e.z } : null) });
  crown(api, fx, e.x, e.z, { r: e.r * 0.55 + 0.15, r2: e.r * 0.55 + 0.35, h: 0.75, life: 1.1, rise: 0.07, hold: 0.85, color: 0xffffff, color2: NACRE, deep: 0x6b5a52, alpha: 0.8, flare: 0.1 });
  api.after(0.95, () => { const at = sh.at(), y = fx.ground(at.x, at.z) + 0.25;      // 碎掉：几片珍珠母的碎壳往外蹦
    fx.burst({ pos: { x: at.x, y, z: at.z }, n: 9, sprite: SPR.shard, color: [NACRE, BLUSH], ringR: e.r + 0.3, speed: [1.5, 3.5], up: 2.2, size: [0.1, 0.18], life: [0.35, 0.55], gravity: 14, spin: 10, spread: 1.2 });
    glint(fx, { x: at.x, y: y + 0.3, z: at.z }, 0.5, NACRE, 0.1); });
}
/** 珍珠雷落地：半埋在土里，0.8 秒后生效（一圈很淡的水纹），有敌人走进 1.2 米就炸 */
function plant(c: Cast, x: number, z: number) {
  const { me, a, api, fx } = c, list: MineRec[] = (a.data.mines ??= []);
  while (list.length >= 2) list.shift()!.pop(false);      // 最多同时两颗：最早的那颗作废
  // 落地：贝壳从合着“啪”地张开（0.22 秒），露出里面的珍珠；底下湿一摊深色（亮地面上贝壳有轮廓）
  const m = mine(fx, 0.26), gy = fx.ground(x, z); m.set(x, z, Math.random() * 6.28); m.open(0); api.run(0.22, k => m.open(1 - Math.pow(1 - k, 3)));
  const wet = mark(api, fx, { kind: "stain", x, z, r: 1.0, life: 41, deep: ABYSS, color2: SEA, alpha: 0.6, fadeIn: 0.01, fadeOut: 0.01 });
  drops(fx, { x, y: gy + 0.15, z }, { n: 6, dir: { x: 0, y: 1, z: 0 }, spread: 0.9, speed: [1, 2.5], size: [0.05, 0.1] });
  const ring = trap(api, fx, x, z, 1.2);      // 触发范围：生效时画出来，之后很淡地留着
  let armed = false, done = false, rip = 0, twk = 0.5;
  const rec: MineRec = { pop(boom) {
    if (done) return; done = true; zn.kill(); ring.kill(); const i = list.indexOf(rec); if (i >= 0) list.splice(i, 1); wet.kill(0.3);
    if (!boom) { api.run(0.35, k => { m.sink(k); m.open(1 - k); }, () => m.free()); drops(fx, { x, y: gy + 0.1, z }, { n: 4, dir: { x: 0, y: 1, z: 0 }, spread: 0.5, speed: [0.5, 1.2], size: [0.05, 0.08] }); return; }      // 作废：沉下去，冒两个水泡
    m.free();
    const st = api.stat(me), dmg = 80 + st.ad * 0.4 + (me.h?.level ?? 1) * 12, P0 = { x, y: gy + 0.4, z };
    // 炸开：一下白光，一圈水冠往上翻再往外塌，地上一圈有厚度的水环推出去，珍珠母的碎片和水珠往外蹦，地面湿一片
    fx.flash(P0, FOAM, 1.3, 0.12, false); glint(fx, P0, 1.1, NACRE, 0.14); fx.shake(0.04, 0.1);
    crown(api, fx, x, z, { r: 0.35, r2: 1.9, h: 1.7, life: 0.5, rise: 0.08, deep: ABYSS, color2: SEA, alpha: 0.85, flare: 0.45 });
    thickRing({ api, fx }, { x, z, r: 1.75, r0: 0.3, width: 0.38, life: 0.4, color: FOAM, color2: SEA, alpha: 0.85 });
    splash(fx, x, gy + 0.15, z, 0.4, 14, [2.5, 5], 1.2, [FOAM, TIDE]);
    fx.burst({ pos: P0, n: 8, sprite: SPR.shard, color: [NACRE, BLUSH], speed: [2.5, 5], up: 2.5, size: [0.1, 0.18], life: [0.4, 0.6], gravity: 14, spin: 10, spread: 1.4 });
    mark(api, fx, { kind: "stain", x, z, r: 1.7, life: 1.6, deep: ABYSS, color2: FOAM, alpha: 0.75, fadeOut: 0.6 });
    for (const e of api.sim.enemiesNear(x, z, me.team, 1.5)) { if (!(e.kind === "hero" || isMinion(e)) || e.untarget) continue;
      api.hit(me, e, dmg, "phys"); api.root(e, 1.0); crust(api, fx, e); if (e.kind === "hero") fx.hitstop(0.03); }
    api.run(2, () => api.reveal(me, x, z, 2.2));      // 照出踩雷的人：2 秒里雷周围 2.2 米的敌人对塞伦这一队现形（草丛里的也算，不破隐身；api.reveal 和乌戈的同名同参数）
  } };
  list.push(rec);
  // 不用 zone 的 each：它只找“看得见的”敌人，雷埋在草丛口、迷雾里就踩不响了。这里每帧自己查（api.sim.enemiesNear 不看视野）
  const zn = api.zone({ me, x, z, r: 1.2, dur: 40, tick: 99,
    frame(zz, dt) {
      if (done) return;
      if (!armed && zz.t >= 0.8) { armed = true; fx.decal({ kind: "shock", x, z, r: 1.25, life: 0.6, color: SEA, alpha: 0.45, from: 0.25, fadeIn: 0.05, fadeOut: 0.6 }); glint(fx, { x, y: gy + 0.3, z }, 0.7, NACRE, 0.14); }      // 生效：一圈很淡的水纹、珍珠闪一下
      if (zz.t >= 0.62) { const k = Math.min(1, (zz.t - 0.62) / 0.25); ring.draw(k * 1.02); ring.alpha(zz.t < 1.4 ? 0.9 : 0.9 - 0.55 * Math.min(1, (zz.t - 1.4) / 0.6)); }      // 触发圈：生效前后 0.25 秒画一圈，之后淡到很淡
      if (!armed) return;
      rip -= dt; if (rip <= 0) { rip = 2.6; fx.decal({ kind: "shock", x, z, r: 1.2, life: 1.1, color: SEA, alpha: 0.2, from: 0.35, fadeIn: 0.1, fadeOut: 0.7 }); }      // 之后每隔一会儿一圈很淡的水纹（敌人细看看得见）
      twk -= dt; if (twk <= 0) { twk = 1.3 + Math.random() * 1.2; glint(fx, { x: x + (Math.random() - 0.5) * 0.15, y: gy + 0.12, z: z + (Math.random() - 0.5) * 0.15 }, 0.28, NACRE, 0.18); }      // 珍珠母偶尔闪一下
      if (api.sim.enemiesNear(x, z, me.team, 1.2).some(e => (e.kind === "hero" || isMinion(e)) && !e.untarget)) rec.pop(true);
    },
    end() { rec.pop(false); } });
}

const W: SkillDef = { key: "W", name: "珍珠雷", icon: "seren_w", cast: "point", range: 8, radius: 1.2, cd: 12, mana: 50,
  desc: "朝地上滚出一颗珍珠雷（最多同时 2 颗，存在 40 秒，0.8 秒后生效）。敌方英雄或小兵走进 1.2 米就炸开：定身 1 秒，受到 80 + 40% 攻击力（随等级提高）的物理伤害。",
  start(c) { const { a, fx } = c, p = a.hand(v3(), "Left"); glint(fx, p, 0.4, NACRE, Math.max(0.1, windup(a, "w"))); },      // 起手：左手里一点珍珠的光
  fire(c) {
    const { a, api, fx } = c, [x, z] = api.walkable(c.x, c.z) ? [c.x, c.z] : api.nearest(c.x, c.z), h0 = a.hand(v3(), "Left"), sx = a.pos.x + c.dx * 0.7, sz = a.pos.z + c.dz * 0.7;
    const dist = Math.hypot(x - sx, z - sz), T = Math.max(0.2, Math.min(0.5, dist / 17)), R0 = 0.2, pr = pearl(fx, R0), ax = new THREE.Vector3(c.dz, 0, -c.dx), q = new THREE.Quaternion(), yaw = Math.atan2(x - sx, z - sz);
    // 滚出去：先从手里落到脚前，再贴着地面一路滚过去（越滚越慢），身后湿一道细的水痕
    const wk = dist > 0.8 ? mark(api, fx, { kind: "wake", x: (sx + x) / 2, z: (sz + z) / 2, r: 0.2, len: dist / 2, yaw, life: 1.4, w: 0.45, deep: ABYSS, color2: SEA, alpha: 0.5, fadeOut: 0.6 }) : null; wk?.head(-1);
    const T0 = 0.07; let rolled = 0;
    api.run(T0 + T, (k, dt) => { const t = k * (T0 + T);
      if (t < T0) { const f = t / T0; pr.obj.position.set(h0.x + (sx - h0.x) * f, h0.y + (fx.ground(sx, sz) + R0 - h0.y) * f, h0.z + (sz - h0.z) * f); return; }
      const f = (t - T0) / T, e = 1 - (1 - f) * (1 - f), px = sx + (x - sx) * e, pz = sz + (z - sz) * e, step = Math.max(0, e * dist - rolled); rolled += step;
      pr.obj.position.set(px, fx.ground(px, pz) + R0 * 0.9, pz); pr.obj.quaternion.premultiply(q.setFromAxisAngle(ax, step / R0)); wk?.head(-1 + 2 * e); void dt; },
      () => { pr.free(); plant(c, x, z); });
  },
};

// ---------------------------------------------------------------- E 反冲
const E: SkillDef = { key: "E", name: "反冲", icon: "seren_e", cast: "dir", tapAim: "back", range: 3.5, angle: CONE, cd: 14, mana: 50,
  desc: "朝一个方向轰一铳：面前扇形里的敌人被推开 2 米，受到 60 + 50% 攻击力的物理伤害；自己被反冲着往反方向滑出 5 米。",
  fire(c) {
    const { me, a, api, fx } = c, tip = muzzle(a, v3()), x0 = a.pos.x, z0 = a.pos.z, yaw = Math.atan2(c.dx, c.dz), fwd = { x: c.dx, y: 0.12, z: c.dz }, dmg = 60 + c.ad * 0.5;
    // 出手（0.15 秒最亮）：铳口一大团白汽往前喷、一下白光；面前一道扇形的水浪立起来往外推（立着的冲击），地上留一片扇形的刮痕
    fx.flash(tip, FOAM, 1.4, 0.15, false); glint(fx, tip, 1.2, SEA, 0.15); fx.shake(0.05, 0.12);
    mist(fx, tip, { n: 12, dir: fwd, spread: 0.42, speed: [4, 11], size: [0.35, 0.6], life: [0.45, 0.75], alpha: [0.35, 0.5], drag: 5 });
    drops(fx, tip, { n: 18, dir: fwd, spread: 0.45, speed: [5, 11], size: [0.08, 0.16], life: [0.3, 0.5], gravity: 10 });
    wall(fx, api, { x: x0, z: z0, r: 3.8, h: 1.1, life: 0.26, from: 0.18, color: 0xd6f0ec, alpha: 0.5, arc: CONE + 0.1, yaw });      // 立着的水墙只闪一下（第四批：0.4 秒在尽头停成一道白弧，偏久）
    fan(api, fx, { x: x0, z: z0, yaw, r: 4.0, ang: CONE + 0.08, life: 1.0, push: 0.28, color: 0xffffff, color2: SEA, deep: ABYSS, alpha: 0.95 });      // 俯视看得清的“面”：一道白沫的前沿 0.28 秒推出去、到头很快塌掉，后面湿一片
    mark(api, fx, { kind: "groove", x: x0, z: z0, r: 3.9, yaw, ang: CONE + 0.05, life: 1.4, hot: 0.9, hotLife: 0.22, deep: ABYSS, color2: FOAM, color: 0xffffff, alpha: 0.85, fadeOut: 0.5 });
    for (const e of api.inCone(me, me.x, me.z, c.dx, c.dz, 3.5, CONE)) { if (isBuilding(e)) continue;
      const l = Math.hypot(e.x - me.x, e.z - me.z) || 1, ux = l > 0.3 ? (e.x - me.x) / l : c.dx, uz = l > 0.3 ? (e.z - me.z) / l : c.dz;
      api.hit(me, e, dmg, "phys"); api.push(e, ux, uz, 2, 0.22);
      const p = api.pos(e, 1.1); glint(fx, p, 0.8, SEA, 0.12); drops(fx, p, { n: 8, dir: { x: ux, y: 0.4, z: uz }, spread: 0.6, speed: [3, 7] }); }
    // 反冲：原地留一个淡的影子；人面朝开铳的方向往后滑 5 米，脚下拖出两道贴地的水痕，一路踢起水珠
    const [tx, tz] = api.reach(me.x, me.z, -c.dx, -c.dz, 5), dist = Math.hypot(tx - me.x, tz - me.z), back = Math.atan2(-c.dx, -c.dz), px = -c.dz, pz = c.dx;
    fx.ghost(a.hero.model, FOAM, 0.3, 0.35);
    // 滑痕（第四批：原来两道 0.3 米宽、身子只有三成不透明的细水痕，很淡）：一条贴地的深色湿印、两边断续的白沫，刚划出来的一截中间亮一道，1.6 秒里一块块蚀掉
    const sk = dist > 0.6 ? skid(api, fx, { x0: x0 + c.dx * 0.2, z0: z0 + c.dz * 0.2, x1: tx, z1: tz, w: 0.75, life: 1.6, alpha: 0.95 }) : null;
    let kick = 0;
    api.run(0.3, (k, dt) => { sk?.head(1 - (1 - k) * (1 - k)); kick -= dt;
      if (kick <= 0) { kick = 0.04; const gy = fx.ground(a.pos.x, a.pos.z);
        for (const sd of [-0.36, 0.36]) drops(fx, { x: a.pos.x + px * sd, y: gy + 0.12, z: a.pos.z + pz * sd }, { n: 2, dir: { x: c.dx + px * sd, y: 0.9, z: c.dz + pz * sd }, spread: 0.6, speed: [2, 4], size: [0.07, 0.12] });
        mist(fx, { x: a.pos.x, y: gy + 0.2, z: a.pos.z }, { n: 1, dir: { x: c.dx, y: 0.3, z: c.dz }, speed: [0.5, 1.5], size: [0.35, 0.5], life: [0.35, 0.55], alpha: [0.2, 0.28], drag: 3 }); } });
    api.dash(me, tx, tz, 0.3, () => {      // 落地：一小圈水花
      const gx = a.pos.x, gz = a.pos.z, gy = fx.ground(gx, gz);
      splash(fx, gx, gy + 0.1, gz, 0.45, 10, [1.8, 3.6], 1.0, [FOAM, TIDE]); fx.decal({ kind: "shock", x: gx, z: gz, r: 1.3, life: 0.35, color: SEA, alpha: 0.55, from: 0.3, fadeIn: 0.04, fadeOut: 0.6 });
      mist(fx, { x: gx, y: gy + 0.3, z: gz }, { n: 3, radius: 0.3, speed: [0.3, 1], size: [0.4, 0.6], life: [0.5, 0.8], alpha: [0.2, 0.3], drag: 3, up: 0.2 }); });
    a.face(me.x + c.dx, me.z + c.dz, true);      // 冲刺会把人转向终点（往后）：转回来，面朝开铳的方向往后滑
  },
};

// ---------------------------------------------------------------- R 沉月弹
const RSPD = 55, RLEN = 24, RW = 0.8;
const R: SkillDef = { key: "R", name: "沉月弹", icon: "seren_r", cast: "dir", range: RLEN, width: RW * 2, cd: 70, mana: 100, minLevel: 6,
  desc: "单膝跪地蓄力约 0.9 秒，打出一颗大珍珠穿过 24 米：第一个英雄受到 300 + 150% 攻击力（随等级提高）的物理伤害，之后每穿过一个英雄少 15%（最低 40%），小兵按一半；打中的英雄被推开 1.5 米、减速 40% 持续 1.5 秒。",
  start(c) {
    // 蓄力（约 0.9 秒）：铳口前一圈立着的水旋（和弹道垂直）越卷越紧、越转越快，中间一颗珍珠从米粒长到拳头大（就是待会儿打出去的那颗），水珠往里收；
    // 脚下沿方向铺开一条 24 米的预警线，一道亮的前沿跟着蓄力推到尽头（敌人也看得见）。
    // 第四批 polish-new：原来是正对镜头的珍珠母月盘，俯视像一个泡泡；现在的水旋俯视是一道竖着的椭圆，看得出“朝前”，珍珠的长大接上出手那颗
    const { a, api, fx } = c, w = windup(a, "r", true), tip = v3(), mp = v3(), dir = new THREE.Vector3(c.dx, 0, c.dz);
    c.data.lane = lane(api, fx, { x: a.pos.x, z: a.pos.z, dx: c.dx, dz: c.dz, len: RLEN, w: RW + 0.15, alpha: 0.85 }) as Lane;
    const sw = swirl(fx, FOAM, SEA, ABYSS) as Swirl, pr = pearl(fx, 0.05) as Pearl, hl = dot(fx, 0xcff6f2), hd = dot(fx, ABYSS, true); let freed = false;
    c.data.charge = { free() { if (freed) return; freed = true; sw.free(); pr.free(); hl.free(); hd.free(); } };
    mark(api, fx, { kind: "stain", x: a.pos.x, z: a.pos.z, r: 1.6, life: w + 0.8, deep: ABYSS, color2: SEA, alpha: 0.6, fadeIn: 0.3, fadeOut: 0.4 });
    let acc = 0;
    api.run(w, (k, dt) => { if (c.data.fired || c.data.over) return; muzzle(a, tip); mp.copy(tip).addScaledVector(dir, 0.35); const e = 1 - (1 - k) * (1 - k);
      pr.obj.position.copy(mp); pr.obj.scale.setScalar(0.06 + 0.32 * e); pr.obj.rotation.y += dt * 5; pr.obj.rotation.x += dt * 3;
      sw.set(mp, dir, 1.25 - 0.4 * e, k, Math.min(1, k * 5) * 0.95); hd.set(mp, 0.8 + 0.7 * e, 0.32 * Math.min(1, k * 4)); hl.set(mp, 0.4 + 1.0 * e * e, 0.2 + 0.45 * k);
      (c.data.lane as Lane).fill(k); acc += dt;
      if (acc > 0.09) { acc = 0; converge(fx, mp, 1.3, LITE ? 2 : 3, 0.2, [FOAM, SEA]); } });
  },
  fire(c) {
    const { me, a, api, fx } = c, tip = muzzle(a, v3()), from = { x: tip.x, y: tip.y, z: tip.z }, x0 = me.x, z0 = me.z, yaw = Math.atan2(c.dx, c.dz), base = 300 + c.ad * 1.5 + c.lv * 40, at = v3(), px = -c.dz, pz = c.dx;
    c.data.fired = true; (c.data.charge as { free: () => void } | undefined)?.free(); const ln0 = c.data.lane as Lane | undefined; ln0?.fill(1); api.after(0.5, () => ln0?.kill(0.35));
    // 出手（整个技能最亮的一下，0.16 秒）：白光、水旋炸成一圈往外的珊瑚色环、铳口一大团白汽往前喷；她脚下往后一圈水环（后坐力）；镜头抖 0.1
    // （第四批：原来出手套两圈环、脚下一圈 2.3 米的厚环，近处打中时和目标身上的水冠、厚环叠成一团；现在出手只一圈环，脚下的环小一号）
    fx.flash(from, FOAM, 2.4, 0.16, true); fx.shake(0.1, 0.22);
    halo(api, fx, from, { x: c.dx, y: 0, z: c.dz }, { r0: 0.35, r1: 1.5, life: 0.3, alpha: 0.95, push: 1.4 });
    spear(fx, from, { x: c.dx, y: 0.02, z: c.dz }, { size: 1.5, color: SEA });
    mist(fx, from, { n: 16, dir: { x: c.dx, y: 0.08, z: c.dz }, spread: 0.38, speed: [5, 13], size: [0.4, 0.7], life: [0.5, 0.85], alpha: [0.35, 0.5], drag: 4.5 });
    mist(fx, { x: x0 - c.dx * 0.6, y: fx.ground(x0, z0) + 0.3, z: z0 - c.dz * 0.6 }, { n: 6, dir: { x: -c.dx, y: 0.3, z: -c.dz }, spread: 0.9, speed: [1.5, 4], size: [0.45, 0.7], life: [0.5, 0.8], alpha: [0.22, 0.32], drag: 3 });
    thickRing({ api, fx }, { x: x0, z: z0, r: 1.7, r0: 0.5, width: 0.32, life: 0.36, color: FOAM, color2: SEA, alpha: 0.6 });
    // 地上：跟着珍珠铺开一道宽的水痕
    const wk = mark(api, fx, { kind: "wake", x: x0 + c.dx * RLEN / 2, z: z0 + c.dz * RLEN / 2, r: 1.0, len: RLEN / 2, yaw, life: 1.9, w: 0.55, hot: 0.8, hotLife: 0.35, deep: ABYSS, color2: FOAM, color: 0xffffff, alpha: 0.8, fadeOut: 0.6 }); wk.head(-1);
    // 过程：拳头大的珍珠，身后一条宽的白色水线（由宽变细，0.6 秒散完），沿途地面两侧掀起一排低矮的水花
    const pr = pearl(fx, 0.4), ln = line(fx, { width: 1.7, core: 0.14, color2: SEA, deep: ABYSS, taper: 0.5, thin: 0.35, glow: 0.55, occ: 0.4, age: 1 / (RSPD * 0.6) }), head = v3(), d0 = new THREE.Vector3(c.dx, 0, c.dz);
    const sheen = fx.emitter({ pos: from, rate: LITE ? 14 : 28, sprite: SPR.glint, add: true, color: [0xffffff, SEA], size: [0.5, 0.75], life: [0.06, 0.1], speed: 0 });
    let acc = 0, gone0 = 0, heroes = 0;
    api.shoot({ me, from, dir: { x: c.dx, z: c.dz }, speed: RSPD, range: RLEN, radius: RW, pierce: true, walls: false,
      vis: {
        move(x, y, z, _dx, _dy, _dz, dt) { head.set(x, y, z); pr.obj.position.copy(head); pr.obj.rotation.x += dt * 9; pr.obj.rotation.z += dt * 4; sheen.at(x, y, z); ln.set(from, head); at.copy(head);
          const gone = Math.hypot(x - from.x, z - from.z); wk.head(Math.min(1, -1 + 2 * gone / RLEN)); acc += gone - gone0; gone0 = gone;
          while (acc >= 1.3) { acc -= 1.3; const bx = x - c.dx * acc, bz = z - c.dz * acc;
            for (const s of [-1, 1]) { const sx = bx + px * s * 1.05, sz = bz + pz * s * 1.05, gy = fx.ground(sx, sz);
              drops(fx, { x: sx, y: gy + 0.1, z: sz }, { n: 3, dir: { x: px * s * 0.6 + c.dx * 0.3, y: 1, z: pz * s * 0.6 + c.dz * 0.3 }, spread: 0.45, speed: [2.2, 4.2], size: [0.08, 0.15], life: [0.35, 0.55], gravity: 13 });
              mist(fx, { x: sx, y: gy + 0.25, z: sz }, { n: 1, speed: [0.2, 0.6], size: [0.35, 0.5], life: [0.4, 0.6], alpha: [0.16, 0.24], up: 0.4, drag: 2 }); } } },
        done() { pr.free(); sheen.stop(); const h = head.clone(); api.run(0.6, k => { ln.age0(k); ln.set(from, h); }, () => ln.free()); },
      },
      hit(e) {
        if (isBuilding(e)) return false;
        const k = Math.max(0.4, 1 - 0.15 * heroes), p = { x: e.x, y: at.y, z: e.z };
        if (e.kind === "hero") {
          heroes++; api.hit(me, e, base * k, "phys", true); api.push(e, c.dx, c.dz, 1.5, 0.2); api.slow(e, 0.4, 1.5);
          // 打中英雄：身上炸开一团水花、一下白光，脚下一圈珊瑚色的厚冲击环、水冠往上翻；顿一下帧
          fx.flash(p, FOAM, 1.6, 0.12, false); glint(fx, p, 1.3, CORAL, 0.14); fx.hitstop(0.06); fx.shake(0.05, 0.12);
          drops(fx, p, { n: 16, dir: { x: c.dx, y: 0.45, z: c.dz }, spread: 0.7, speed: [4, 10], size: [0.1, 0.2], life: [0.3, 0.55] });
          crown(api, fx, e.x, e.z, { r: e.r * 0.8 + 0.2, r2: e.r + 1.25, h: 1.8, life: 0.5, rise: 0.08, deep: ABYSS, color2: SEA, alpha: 0.8, flare: 0.35 });
          api.after(0.05, () => thickRing({ api, fx }, { x: e.x, z: e.z, r: 2.0, r0: 0.6, width: 0.34, life: 0.42, color: CORAL, color2: BLUSH, alpha: 0.85 }));      // 珊瑚色的环晚半拍推出去：和水冠错开，不叠成一团
        } else {
          api.hit(me, e, base * k * 0.5, "phys");
          glint(fx, p, 0.7, SEA, 0.1); drops(fx, p, { n: 7, dir: { x: c.dx, y: 0.4, z: c.dz }, spread: 0.6, speed: [3, 7] });
        }
      },
      end() {      // 飞到尽头：在空中碎成一团水雾，一把水珠落下，一下很小的白光
        const p = { x: at.x, y: at.y, z: at.z }; glint(fx, p, 1.0, SEA, 0.12);
        mist(fx, p, { n: 12, radius: 0.6, speed: [0.5, 2.6], size: [0.5, 0.85], grow: 3, life: [0.8, 1.3], alpha: [0.3, 0.42], drag: 2.4, up: 0.35 });
        drops(fx, p, { n: 14, spread: 3.1, speed: [1.5, 4], size: [0.08, 0.15], gravity: 11, life: [0.4, 0.7] });
      } });
  },
  end(c) { c.data.over = true; if (!c.data.fired) { (c.data.charge as { free: () => void } | undefined)?.free(); (c.data.lane as Lane | undefined)?.kill(0.2); } },      // 蓄力被打断：水旋、珍珠、预警线收掉
};

// ---------------------------------------------------------------- 名册
export const seren: HeroKit = {
  id: "seren", name: "塞伦", title: "珠铳", role: "射手", side: 0, color: CORAL, color2: FOAM, height: 3.3,
  look: { sat: 1.5 },      /* 换画风 B（w-vs）：场景的天光偏冷，默认饱和度（1.3 × HB 0.7）下珊瑚橙的背带、腰带发粉（游戏里 (237,120,100)，设定图 (209,100,75)），1.5 回到 (235,112,86)；提亮照默认（亮部 p90 已经 0.9，比三种地面都亮）。只对 B 的模型这么调，HB 的默认值不动 */
  base: { hp: 2700, mana: 480, ad: 158, ap: 0, armor: 20, mr: 22, ms: 5.6, as: 1.0, range: 7.0, cdr: 0, ls: 0, hpRegen: 0.005, manaRegen: 0.011 },
  ranged: { speed: SPEED, shot({ me, a, api, fx, from, target }) {
    const n = (a.data.shots = (a.data.shots ?? 0) + 1), q = api.hasBuff(me, "seren_q"), at: THREE.Vector3 = (a.data.hitAt ??= v3());
    const l = Math.hypot(target.x - from.x, target.z - from.z) || 1, dx = (target.x - from.x) / l, dz = (target.z - from.z) / l, tip = new THREE.Vector3(from.x, from.y, from.z);
    // 出膛：铳口一小团白色水汽（不是火光）、一下白光、一圈套在弹道上的小水环（往前推开）；压满的时候汽多、环是珊瑚色的
    mist(fx, tip, { n: q ? 5 : 3, dir: { x: dx, y: 0.15, z: dz }, spread: 0.45, speed: [2, 5], size: [0.2, 0.34], life: [0.3, 0.5], alpha: [0.3, 0.42], drag: 6 });
    glint(fx, tip, q ? 0.8 : 0.65, q ? CORAL : SEA, 0.08);
    if (n % 4 !== 0) halo(api, fx, tip, { x: dx, y: 0, z: dz }, { r0: 0.1, r1: q ? 0.5 : 0.38, life: q ? 0.16 : 0.13, alpha: 0.85, push: 0.2, color: q ? CORAL : SEA, color2: FOAM });
    if (n % 4 === 0) { tideShot(me, a, api, fx, tip, target); return { move(x, y, z) { at.set(x, y, z); }, done() {} }; }      // 第四发：满潮弹（主目标吃这发看不见的追踪弹）
    // 过程：一颗珍珠，外面一团小光（底下垫暗），身后一股白芯的水柱（第四批：珠子半径 0.13 → 0.2、线宽 0.34 → 0.95、尾巴 2.4 → 4.8 米、身子更实，游戏镜头里才读得出“一发水弹”）；
    // 压满的时候弹头更大、水线更粗更长、身子带珊瑚色，沿路掉水珠
    return shotVis(api, fx, { r: q ? 0.24 : 0.2, width: q ? 1.15 : 0.95, tail: q ? 5.5 : 4.8, core: 0.22, occ: 0.6, color2: q ? BLUSH : SEA, halo: q ? 1.6 : 1.35, haloColor: q ? 0xffd2c2 : 0xcff6f2, linger: 0.22, out: at, step: 0.6,
      trail: q ? p => drops(fx, p, { n: 1, spread: 1.2, speed: [0.3, 1], size: [0.06, 0.1], gravity: 8, life: [0.25, 0.4] }) : undefined });
  } },
  skills: [P, Q, W, E, R],
  attack(c) {
    const { me, a, api, fx, target: e } = c, at: V3 = a.data.hitAt ?? api.pos(e, 1.2), l = Math.hypot(e.x - me.x, e.z - me.z) || 1, dx = (e.x - me.x) / l, dz = (e.z - me.z) / l;
    // 普攻命中（三层）：一下白光；一团拍散的白水（普通混合）、一团水雾、一把水珠顺着弹道溅出去、几颗往回溅；脚下一小圈水冠（不用每个目标一样的白圈）
    const q = api.hasBuff(me, "seren_q");
    glint(fx, at, q ? 0.95 : 0.8, q ? CORAL : SEA, 0.09);
    fx.burst({ pos: at, n: 1, sprite: SPR.soft, color: [FOAM, SEA], size: q ? 1.2 : 1.0, grow: 1.7, life: 0.14, speed: 0, alpha: 0.55 });      // 水弹拍在身上“啪”地散开的一团白（普通混合，不发光）
    mist(fx, at, { n: 3, dir: { x: dx, y: 0.3, z: dz }, spread: 0.8, speed: [1, 3], size: [0.32, 0.5], life: [0.3, 0.5], alpha: [0.3, 0.4], drag: 4 });
    drops(fx, at, { n: q ? 12 : 10, dir: { x: dx, y: 0.45, z: dz }, spread: 0.85, speed: [2.5, 6.5], size: [0.11, 0.18] });
    drops(fx, at, { n: 3, dir: { x: -dx, y: 0.7, z: -dz }, spread: 0.8, speed: [1.5, 3] });
    if (!isBuilding(e) && !q) crown(api, fx, e.x, e.z, { r: e.r * 0.5 + 0.2, r2: e.r * 0.5 + 0.75, h: 0.55, life: 0.26, rise: 0.05, deep: ABYSS, color2: SEA, alpha: 0.55, flare: 0.15 });      // 脚下一小圈水冠：水落在地上（压满的时候溅射那圈更大，不叠两圈）
    if (q) {      // 压满：目标身边 1.8 米溅射 30%，脚下一小环水沫推到 1.8 米
      const sp = Math.round(c.dmg * 0.3), R0 = 1.8 + (isBuilding(e) ? e.r : 0);
      for (const o of api.enemies(me, e.x, e.z, R0)) if (o !== e && !isBuilding(o)) { api.hit(me, o, sp, "phys"); drops(fx, api.pos(o, 0.9), { n: 3, dir: { x: o.x - e.x, y: 0.6, z: o.z - e.z }, spread: 0.7, speed: [1.5, 3.5] }); }
      if (!isBuilding(e)) {      // 地上一环水沫推到 1.8 米（溅射的范围一眼看得出：底下先湿一片深色，白沫的环边上带一点珊瑚色），上面一圈矮的水冠
        mark(api, fx, { kind: "stain", x: e.x, z: e.z, r: 1.85, life: 0.7, deep: ABYSS, color2: SEA, alpha: 0.55, fadeIn: 0.02, fadeOut: 0.6 });
        crown(api, fx, e.x, e.z, { r: 0.7, r2: 1.85, h: 0.75, life: 0.34, rise: 0.06, deep: ABYSS, color2: SEA, alpha: 0.65, flare: 0.2 });
        thickRing({ api, fx }, { x: e.x, z: e.z, r: 1.85, r0: 0.5, width: 0.32, life: 0.32, color: FOAM, color2: CORAL, alpha: 0.8 }); }
      else fx.decal({ kind: "shock", x: e.x, z: e.z, r: R0, life: 0.3, color: SEA, alpha: 0.5, from: 0.6, fadeIn: 0.04, fadeOut: 0.6 });
    }
  },
  passive(c, dt) {
    const { me, a, api, fx } = c; warmSeren(api, fx, a.pos.x, a.pos.z);
    // 潮涨：射程随等级（阵亡时身上的增益会清掉，复活后这里马上补回来）
    const lv = me.h?.level ?? 1; if (a.data.rangeLv !== lv || !api.hasBuff(me, "seren_tide")) { a.data.rangeLv = lv; api.buff(me, "seren_tide", 1e9, { range: 0.12 * lv }); }
    const shown = me.alive && (me.team === 0 || me.seen);      // 对面的塞伦不在视野里就不画（不然迷雾里看得见她的罐子在亮）
    // 潮涨的刻度：压力罐上套一圈四格刻度，每打一发亮一格（珊瑚橙），攒满三格时整圈亮起来、轻轻跳——下一发是满潮弹（很小，只在模型上）
    const gg = (a.data.gauge ??= gauge(fx, 0.2 * seren.height / 3.1)) as Gauge, n = (a.data.shots ?? 0) % 4;
    if (shown && a.hero.blade("R", T1, T2)) { T2.sub(T1); T1.addScaledVector(T2, 0.08); gg.set(T1, T2, n, true); } else gg.set(T1, T2, n, false);      // T1：武器三成处（罐子挂在那儿），T2：枪管的方向
    // 压满的 4 秒：铳口一点珊瑚色的小光一跳一跳（压力阀，很小），铳管上一圈淡淡的水汽绕着（身上不发光）
    const qOn = shown && api.hasBuff(me, "seren_q");
    if (qOn && a.hero.blade("R", T3, T4)) { const pd = (a.data.qdot ??= dot(fx, 0xffb49c)) as Dot; pd.set(T4, 0.55 + 0.08 * Math.sin(api.time() * 14), 0.5); }
    else if (a.data.qdot) { (a.data.qdot as Dot).free(); a.data.qdot = null; }
    if (qOn) { a.data.qm = (a.data.qm ?? 0) - dt; if (a.data.qm <= 0) { a.data.qm = 0.06; if (a.hero.blade("R", T1, T2)) { const k = 0.35 + Math.random() * 0.65; T1.lerp(T2, k);
      fx.burst({ pos: T1, n: 1, sprite: SPR.smoke, color: [MIST, MIST2], alpha: [0.14, 0.22], size: [0.18, 0.28], grow: 2.2, life: [0.4, 0.6], speed: [0.1, 0.4], up: 0.5, drag: 2 }); } } }
  },
};
const T1 = v3(), T2 = v3(), T3 = v3(), T4 = v3();
