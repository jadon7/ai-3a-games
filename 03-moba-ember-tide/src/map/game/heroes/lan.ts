// 岚 · 汐刃（刺客，沉月会）。这份也是其他英雄技能文件的样板：属性、普攻的被动、四个技能，每个技能的特效分出手、过程、命中三层。
//
//   被动 血潮   从背后普攻多打 25%；亲手击杀后钩引立刻转好。
//   Q 钩引      朝一个方向甩出骨钩，钩中第一个敌人就把自己拉到它身后，并接上普攻。钩不到建筑，会被墙挡住。
//   W 潮隐      隐身 4 秒、跑得更快，小兵看不见她；隐身时的第一刀伤害是 2.2 倍，打完现形。
//   R 涨潮      大招（6 级）。接连闪到周围血最少的敌人身后各砍一刀，共 5 刀；砍死一个多砍一刀。期间不会被选中。

import * as THREE from "three";
import type { Ent } from "../sim";
import type { HeroKit, SkillDef } from "../skills";
import { SPR } from "../fxlib";
import { LITE } from "../../quality";
import { blade, converge, crown, mark, spear, splash, streak, warmFx2a, windup } from "../fx_fx2a";
import { pick } from "../fxb";

// 第九轮 fx2a：每个技能重新分镜（见 docs/round9/fx2a/分镜.md）。颜色：青（TEAL）是主色，白沫（FOAM）只给最亮的那一道边，
// 深海蓝（ABYSS）垫在刀光、闪线、水痕底下——测试场和河道的地面也是青绿，光靠叠加的青色在上面没有反差，有了这层深色底才“成形”。
// 换画风 B（b-fx）：地面变亮以后浅青的身子看不见、近黑的深海蓝垫底成了污渍。B 下换一套：主色是饱和的水青，深水是海蓝，
// 垫底（ABYSS）是同色系深一档的海蓝（不是黑），白沫照旧只给最亮的边。英雄自己的颜色（头像、伤害数字用的 kit.color）不动
const TEAL = pick(0x7fe9e4, 0x22c4d4), DEEP = pick(0x2aa7b8, 0x1590c0), FOAM = 0xe6fbf7, ABYSS = pick(0x0b2f45, 0x0f6a9a), PEARL = 0xf4fffd, TIDE_D = pick(0x0a2a3a, 0x1a7fb5);
const isBuilding = (e: Ent) => e.kind === "tower" || e.kind === "core";
const v3 = () => new THREE.Vector3();

const P: SkillDef = { key: "P", name: "血潮", icon: "lan_p", cast: "passive", desc: "从背后普攻，伤害提高 25%。亲手击杀一个敌人后，钩引的冷却立刻转好。" };

const Q: SkillDef = {
  key: "Q", name: "钩引", icon: "lan_q", cast: "dir", range: 11, width: 0.8, cd: 6, mana: 60,
  desc: "朝一个方向甩出骨钩。钩中第一个敌人后把自己拉到它身后，造成 60% 攻击力加 40 点物理伤害（随等级提高），并接上普攻。钩不到建筑，会被墙挡住。",
  start(c) {                                                  // 起手（前摇多长就多长，原来 0.3 秒）：水往钩刃上收，刃尖上亮一点
    const { a, fx } = c, p = a.hand(v3()), w = windup(a, "q");
    converge(fx, p, 1.3, 12, Math.max(0.1, w * 0.92), [FOAM, TEAL]);
    fx.burst({ pos: p, n: 1, sprite: SPR.glint, add: true, color: TEAL, size: 0.5, grow: 2.4, life: w, speed: 0, alpha: 0.85 });
  },
  fire(c) {
    const { me, a, api, fx } = c, h = v3(), tip = a.hand(v3()), chain = api.fx0.chain(), yaw = Math.atan2(c.dx, c.dz), x0 = me.x, z0 = me.z; let hooked: Ent | null = null;
    // 出手：朝前一道尖的闪光，甩出一串水线
    spear(fx, tip, { x: c.dx, y: 0.04, z: c.dz }, { size: 1.15, color: TEAL });
    fx.burst({ pos: tip, n: 12, sprite: SPR.drop, color: [FOAM, TEAL], dir: { x: c.dx, y: 0.12, z: c.dz }, spread: 0.3, speed: [7, 14], size: [0.09, 0.16], life: [0.18, 0.32], gravity: 7, stretch: 1.4 });
    // 途中：钩头拖一道白芯的尾巴（焦点在钩头）；地上跟着钩头划出一道水痕，钩到哪画到哪
    const wake = mark(api, fx, { kind: "wake", x: x0 + c.dx * 5.6, z: z0 + c.dz * 5.6, r: 0.5, len: 5.6, yaw, life: 1.0, w: 0.55, hot: 1, hotLife: 0.3, deep: ABYSS, color2: FOAM, color: PEARL, fadeOut: 0.6, alpha: 0.9 }); wake.head(-1);
    const tail = fx.trail({ color: FOAM, color2: TEAL, width: 0.46, life: 0.11 });
    api.shoot({ me, from: { x: tip.x, y: tip.y, z: tip.z }, dir: { x: c.dx, z: c.dz }, speed: 85, range: 11, radius: 0.8,
      hit(e) { if (isBuilding(e)) return false; hooked = e; },
      vis: { move(x, y, z) { tip.set(x, y, z); chain.set(a.hand(h), tip); tail.at(x, y, z); wake.head(Math.min(1, -1 + Math.hypot(x - x0, z - z0) / 5.6)); }, done() { tail.stop(); } },
      end() {
        const e = hooked as Ent | null;
        if (!e) { const from = tip.clone(); api.run(0.18, k => { tip.lerpVectors(from, a.hand(h), k); chain.set(a.hand(h), tip); }, () => chain.remove()); return; }      // 没钩到：链子收回来
        // 钩中：白芯一下、一道朝回张开的“咬合”闪光，目标脚下溅起一小圈水冠
        const at = api.pos(e, 1.3);
        fx.impact(at, { color: FOAM, color2: TEAL, size: 1.15, dir: { x: -c.dx, y: 0.3, z: -c.dz } }); spear(fx, at, { x: -c.dx, y: 0.15, z: -c.dz }, { size: 0.9, color: TEAL });
        crown(api, fx, e.x, e.z, { r: e.r * 0.8 + 0.25, r2: e.r + 1.0, h: 1.7, life: 0.42, rise: 0.08, deep: ABYSS, alpha: 0.8 });
        fx.burst({ pos: at, n: 12, sprite: SPR.drop, color: [FOAM, TEAL], speed: [2, 6], size: [0.1, 0.2], life: [0.3, 0.5], gravity: 12, up: 2 });
        // 钩中了：把自己拉到它身后（身后站不了人就落在身前）
        const bx = e.x + c.dx * 1.9, bz = e.z + c.dz * 1.9, [tx, tz] = api.walkable(bx, bz) ? [bx, bz] : [e.x - c.dx * 1.9, e.z - c.dz * 1.9];
        // 拉过去的 0.24 秒：原地一个影子，身后一道闪线从起点一直连到她身上（锤石顺着链子过去的那种）
        fx.ghost(a.hero.model, TEAL, 0.36, 0.42);
        const p0 = a.chest(v3()), line = streak(api, fx, p0, p0, { width: 0.75, hold: 0.24, fade: 0.2, deep: ABYSS, color: PEARL, color2: TEAL }), ch = v3();
        api.run(0.13, () => chain.set(a.hand(h), api.pos(e, 1.3)), () => chain.remove());
        const trail = fx.emitter({ pos: a.pos, rate: 70, sprite: SPR.drop, color: [FOAM, DEEP], size: [0.08, 0.16], life: [0.25, 0.45], speed: [0.5, 2], gravity: 8, up: 1.2 });
        api.run(0.24, () => { trail.at(a.pos.x, a.pos.y + 0.9, a.pos.z); line.set(p0, a.chest(ch)); }, () => trail.stop());
        api.dash(me, tx, tz, 0.24, () => {
          const g = fx.ground(a.pos.x, a.pos.z);
          splash(fx, a.pos.x, g + 0.1, a.pos.z, 0.5, 10, [2.5, 5], 1.0, [FOAM, TEAL]); fx.ring(a.pos.x, a.pos.z, 1.5, TEAL, 0.3);
          if (e.alive) { const was = e.alive, yw = Math.atan2(e.x - a.pos.x, e.z - a.pos.z); api.hit(me, e, c.ad * 0.6 + 40 + c.lv * 18, "phys");
            // 落到身后的那一刀：一道斜劈的大月牙（底下垫深色），地上留一道刀痕
            blade(api, fx, { pos: { x: a.pos.x, y: a.pos.y + 1.3, z: a.pos.z }, yaw: yw, r: Math.hypot(e.x - a.pos.x, e.z - a.pos.z) + 1.0, arc: 2.0, width: 0.46, tilt: 0.45, life: 0.34, sweep: 0.08, deep: ABYSS, color: PEARL, color2: TEAL });
            mark(api, fx, { kind: "slash", x: e.x, z: e.z, r: 1.9, len: 1.5, yaw: yw, life: 1.3, w: 0.2, hot: 1, hotLife: 0.25, deep: ABYSS, color2: FOAM, alpha: 0.85 });
            fx.impact(api.pos(e, 1.2), { color: FOAM, color2: TEAL, size: 1.1, dir: { x: Math.sin(yw), y: 0.3, z: Math.cos(yw) } });
            if (was && !e.alive) lan.onKill?.({ me, a, api, fx, victim: e }); }
          a.face(e.x, e.z, true); a.finish(); if (e.alive) a.attack(e);
        });
      } });
  },
};

const W: SkillDef = {
  key: "W", name: "潮隐", icon: "lan_w", cast: "self", cd: 10, mana: 50,
  desc: "隐入水汽 4 秒：移速提高 35%，小兵看不见她。隐身时的第一下普攻造成 2.2 倍伤害，打完现形。",
  start(c) {                                                  // 起手（前摇多长就多长，原来 0.6 秒）：脚下的水卷起来、地面一点点湿开，水珠往上走
    const { a, api, fx } = c, x = a.pos.x, z = a.pos.z, w = windup(a, "w");
    fx.decal({ kind: "swirl", x, z, r: 1.7, life: w + 0.15, color: TEAL, color2: DEEP, alpha: 0.7, fadeIn: 0.2, fadeOut: 0.5, spin: 3 });
    const wet = mark(api, fx, { kind: "stain", x, z, r: 2.0, grow: 0.55, life: w + 0.15, deep: ABYSS, color2: TEAL, alpha: 0.7, fadeIn: 0.5, fadeOut: 0.2 }); api.run(w, k => wet.size(0.55 + 0.45 * k));
    fx.burst({ pos: { x, y: a.pos.y + 0.2, z }, n: 16, sprite: SPR.drop, ringR: 1.0, color: [FOAM, TEAL], speed: [0.2, 0.8], up: 3.2, size: [0.09, 0.17], life: [0.4, 0.7], gravity: 3 }); },
  fire(c) {
    const { me, a, api, fx } = c, x = a.pos.x, z = a.pos.z, y = fx.ground(x, z);
    // 隐身的那一下（派克 W、阿卡丽 W 那种“化掉”）：她的身子散成一捧水落下去（原地一个白色的影子很快淡掉），
    // 脚下溅起一圈矮而宽的水冠，一圈水汽贴着地面往外推开（阿卡丽的烟环，这里是水汽，颜色压得很淡），地上留一摊湿印
    fx.ghost(a.hero.model, pick(FOAM, TEAL), 0.5, 0.5);
    fx.burst({ pos: a.chest(v3()), n: 28, sprite: SPR.drop, radius: 0.75, color: [FOAM, TEAL], speed: [0.8, 2.6], up: 2.2, size: [0.1, 0.2], life: [0.45, 0.75], gravity: 10, stretch: 0.8 });
    crown(api, fx, x, z, { r: 0.9, r2: 2.7, h: 2.1, life: 0.65, rise: 0.1, deep: ABYSS, color2: TEAL, alpha: 0.85, flare: 0.6 });
    mark(api, fx, { kind: "stain", x, z, r: 2.4, life: 1.8, deep: ABYSS, color2: FOAM, alpha: 0.85, fadeOut: 0.6 });
    splash(fx, x, y + 0.1, z, 0.8, 14, [2, 4.5], 1.3, [FOAM, TEAL]);
    const nv = LITE ? 7 : 14;
    for (let i = 0; i < nv; i++) { const t = ((i + Math.random() * 0.5) / nv) * 6.2832, cs = Math.cos(t), sn = Math.sin(t);
      fx.burst({ pos: { x: x + cs * 0.9, y: y + 0.45, z: z + sn * 0.9 }, n: 1, sprite: SPR.smoke, color: [0xe8faf6, 0x7fb6bb], alpha: [0.3, 0.4], size: [0.9, 1.2], grow: 2.2, life: [0.9, 1.3], speed: [3.2, 4], dir: { x: cs, y: 0.05, z: sn }, spread: 0.15, drag: 2.4 }); }
    me.invis = true; a.data.bigSwing = true;
    api.buff(me, "veil", 4, { msMul: 1.35 }, () => { me.invis = false; a.data.bigSwing = false; });
  },
};

const R: SkillDef = {
  key: "R", name: "涨潮", icon: "lan_r", cast: "self", cd: 70, mana: 100, minLevel: 6, radius: 8.5,
  desc: "接连闪到 8.5 米内血量比例最低的敌人身后各砍一刀，共 5 刀，每刀 75% 攻击力（随等级提高）；目标血量低于 35% 时这一刀是 1.5 倍。砍死一个多砍一刀（最多 9 刀）。最后跃起劈下，对落点周围造成 40% 攻击力的伤害。期间不会被选中。",
  ready: ({ me, api }) => api.enemies(me, me.x, me.z, 8.5).some(e => !isBuilding(e)),
  start(c) {                                                  // 起手（前摇多长就多长，原来 0.4 秒）：脚下的水往上涌，两把刀的刃尖各亮一点，水珠往刀上收
    const { a, api, fx } = c, x = a.pos.x, z = a.pos.z, bA = v3(), bB = v3(), w = windup(a, "r", true);
    mark(api, fx, { kind: "stain", x, z, r: 2.6, life: w + 0.5, deep: ABYSS, color2: FOAM, alpha: 0.8, fadeIn: 0.3, fadeOut: 0.3 });
    fx.burst({ pos: { x, y: a.pos.y + 0.2, z }, n: 18, sprite: SPR.drop, ringR: 1.4, color: [FOAM, TEAL], speed: [0.3, 1], up: 4.5, size: [0.14, 0.28], life: [0.4, 0.7], gravity: 6 });
    for (const side of ["R", "L"] as const) if (a.hero.blade(side, bA, bB)) { fx.burst({ pos: bB, n: 1, sprite: SPR.glint, add: true, color: TEAL, size: 0.45, grow: 2.2, life: w, speed: 0, alpha: 0.85 }); converge(fx, bB, 1.0, 6, Math.max(0.1, w * 0.8), [FOAM, TEAL]); }
  },
  fire(c) {
    const { me, a, api, fx } = c; let left = 5, total = 0, last: Ent | null = null;
    me.untarget = true; a.lock(8);
    // 大招期间整片地面“涨潮”：一片暗下去的潮水从脚下漫到 8.5 米（边上一道清楚的白沫就是范围），收尾时退掉
    const tide = mark(api, fx, { kind: "tide", x: a.pos.x, z: a.pos.z, r: 8.7, grow: 0.2, life: 12, deep: TIDE_D, color2: FOAM, color: PEARL, alpha: 0.85, fadeIn: 0.003 });
    api.run(0.45, k => tide.size(0.2 + 0.8 * (1 - (1 - k) * (1 - k))));
    const finish = () => {                                                                       // 收尾：跃起，双刀劈下，落地时一圈水冠、一片裂开的地
      a.anim("r_end", { speed: 1.6, fade: 0.05 }); tide.kill(0.7);
      const b0 = v3(), b1 = v3(); api.run(0.5, () => { for (const side of ["R", "L"] as const) if (a.hero.blade(side, b0, b1)) fx.burst({ pos: b1, n: 1, sprite: SPR.drop, color: [FOAM, TEAL], size: [0.1, 0.16], life: 0.25, speed: 0.4, gravity: 3 }); });      // 跃起时刀尖甩下的水
      api.after(0.52, () => {
        me.untarget = false;
        const x = a.pos.x, z = a.pos.z, y = fx.ground(x, z);
        // 落地劈下的那一下（全技能最亮的一下，只有这一下）：白芯、一圈往外塌的水冠、地上裂开、两圈冲击
        fx.flash({ x, y: y + 1, z }, FOAM, 3.4, 0.16); fx.shake(0.16, 0.35);
        crown(api, fx, x, z, { r: 1.1, r2: 3.6, h: 3.6, life: 0.85, rise: 0.12, deep: ABYSS, color2: TEAL, alpha: 0.9, flare: 0.5 });
        mark(api, fx, { kind: "crack", x, z, r: 4.2, life: 1.8, hot: 1, hotLife: 0.4, deep: ABYSS, color: PEARL, color2: TEAL, alpha: 0.9, fadeOut: 0.5 });
        mark(api, fx, { kind: "stain", x, z, r: 3.4, life: 1.4, deep: ABYSS, color2: FOAM, alpha: 0.6, fadeOut: 0.6 });
        fx.ring(x, z, 4.4, TEAL, 0.5); fx.ring(x, z, 2.8, FOAM, 0.32);
        splash(fx, x, y + 0.2, z, 1.2, 22, [4, 9], 0.9, [FOAM, TEAL], [0.14, 0.3]);
        for (const e of api.enemies(me, a.pos.x, a.pos.z, 3.2)) if (!isBuilding(e)) api.hit(me, e, c.ad * 0.4, "phys");      // 落地的那一下也有一点伤害
      });
      api.after(1.0, () => a.lock(0));
    };
    const next = () => {
      if (!me.alive) { me.untarget = false; tide.kill(0.4); return; }
      const cand = api.enemies(me, me.x, me.z, 8.5).filter(e => !isBuilding(e)).sort((p, q) => p.hp / p.max - q.hp / q.max);
      if (!cand.length || left <= 0) return finish();
      const e = cand.length > 1 && cand[0] === last ? cand[1] : cand[0], ang = Math.atan2(e.x - me.x, e.z - me.z) + (Math.random() - 0.5) * 2.2;
      const bx = e.x + Math.sin(ang) * (e.r + 1.2), bz = e.z + Math.cos(ang) * (e.r + 1.2), [tx, tz] = api.walkable(bx, bz) ? [bx, bz] : api.nearest(bx, bz), from = a.chest(v3());
      fx.ghost(a.hero.model, TEAL, 0.38, 0.45);                                                   // 原地留一个影子
      api.blink(me, tx, tz); a.face(e.x, e.z, true); a.anim(total % 2 ? "attack2" : "attack1", { speed: 2.8, fade: 0.02 });
      streak(api, fx, from, a.chest(v3()), { width: 0.8, hold: 0.04, fade: 0.22, deep: ABYSS, color: PEARL, color2: TEAL });      // 闪过去的那一道：又细又亮，头宽尾尖，很快收细
      fx.burst({ pos: from, n: 6, sprite: SPR.drop, color: [FOAM, TEAL], radius: 0.5, speed: [0.5, 2], size: [0.08, 0.16], life: [0.3, 0.5], gravity: 9 });
      left--; total++; last = e;
      api.after(0.09, () => {
        if (!e.alive) return; const at = api.pos(e, 1.2), was = e.alive, yw = Math.atan2(e.x - a.pos.x, e.z - a.pos.z), side = total % 2 ? 1 : -1;
        api.hit(me, e, (c.ad * 0.75 + c.lv * 8) * (e.hp / e.max < 0.35 ? 1.5 : 1), "phys", true);      /* 阶段 6：每刀从 85% 降到 75% 攻击力。有了对面的英雄以后，电脑用的岚六局里三局零阵亡 */
        // 一道月牙刀光（交替斜的方向，像在目标身上划叉；底下垫深色），白芯一闪；地上留一道刀痕，越砍越多；砍到英雄顿一下帧
        blade(api, fx, { pos: { x: a.pos.x, y: at.y, z: a.pos.z }, yaw: yw, r: Math.hypot(e.x - a.pos.x, e.z - a.pos.z) + 0.95, arc: 2.1, width: 0.52, tilt: side * (0.45 + Math.random() * 0.35), flip: total % 2 === 0, life: 0.3, sweep: 0.07, deep: ABYSS, color: PEARL, color2: TEAL });
        mark(api, fx, { kind: "slash", x: e.x, z: e.z, r: 1.9, len: 1.5, yaw: yw + side * 0.5, life: 1.6, w: 0.26, hot: 1, hotLife: 0.25, deep: ABYSS, color2: FOAM, alpha: 0.95 });
        fx.impact(at, { color: FOAM, color2: TEAL, size: 1.1, big: e.kind === "hero" }); if (e.kind === "hero") fx.hitstop(0.045);
        fx.burst({ pos: at, n: 12, sprite: SPR.drop, color: [FOAM, TEAL], dir: { x: e.x - a.pos.x, y: 0.4, z: e.z - a.pos.z }, spread: 0.8, speed: [3, 9], size: [0.15, 0.3], life: [0.25, 0.45], gravity: 12, stretch: 1 });
        fx.shake(0.05, 0.1);
        if (was && !e.alive && total < 9) { left++; lan.onKill?.({ me, a, api, fx, victim: e }); }
      });
      api.after(0.2, next);
    };
    next();
  },
};

export const lan: HeroKit = {
  id: "lan", name: "岚", title: "汐刃", role: "刺客", side: 0, color: 0x7fe9e4, color2: FOAM, height: 3.3,
  base: { hp: 3500, mana: 600, ad: 168, ap: 0, armor: 30, mr: 25, ms: 6.0, as: 1.3,      /* 阶段 6：攻速 1.5 → 1.3，她一个人推线拆塔比谁都快 */ range: 2.1, cdr: 0, ls: 0, hpRegen: 0.006, manaRegen: 0.012 },
  skills: [P, Q, W, R],
  attack(c) {
    const { me, a, api, fx, target: e } = c; let dmg = c.dmg; const at = api.pos(e, 1.2);
    // 血潮：从背后打（小兵和英雄才分正反面）
    if (!isBuilding(e) && Math.sin(e.yaw) * (e.x - me.x) + Math.cos(e.yaw) * (e.z - me.z) > 0.35 * Math.hypot(e.x - me.x, e.z - me.z)) { dmg *= 1.25; fx.burst({ pos: at, n: 5, sprite: SPR.drop, color: [0xff9a8a, TEAL], speed: [2, 5], size: [0.08, 0.14], life: [0.2, 0.35], gravity: 10 }); }
    // 潮隐里的第一刀
    if (api.hasBuff(me, "veil")) { dmg *= 2.2; api.unbuff(me, "veil");
      // 破隐的那一刀（刺客的爆发点）：两道交叉的月牙刀光（一前一后差 0.05 秒），白芯一下，目标脚下溅起水冠、地上一个叉；她现形时身上闪一下白
      const yw = Math.atan2(e.x - me.x, e.z - me.z), rr = Math.hypot(e.x - me.x, e.z - me.z) + 1.0, P0 = { x: me.x, y: at.y, z: me.z };
      streak(api, fx, { x: me.x - Math.sin(yw) * 1.6, y: at.y, z: me.z - Math.cos(yw) * 1.6 }, at, { width: 0.7, hold: 0.03, fade: 0.18, deep: ABYSS, color: PEARL, color2: TEAL });      // 从水汽里扑出来的那一下
      blade(api, fx, { pos: P0, yaw: yw, r: rr, arc: 2.3, width: 0.55, tilt: -0.6, life: 0.36, sweep: 0.08, deep: ABYSS, color: PEARL, color2: TEAL });
      api.after(0.05, () => blade(api, fx, { pos: P0, yaw: yw, r: rr + 0.15, arc: 2.1, width: 0.5, tilt: 0.65, flip: true, life: 0.34, sweep: 0.08, deep: ABYSS, color: PEARL, color2: TEAL }));
      fx.impact(at, { color: FOAM, color2: TEAL, size: 1.45, big: true, dir: { x: Math.sin(yw), y: 0.35, z: Math.cos(yw) } });
      crown(api, fx, e.x, e.z, { r: e.r * 0.7 + 0.3, r2: e.r + 1.4, h: 2.2, life: 0.5, rise: 0.08, deep: ABYSS, alpha: 0.85 });
      for (const s of [-0.55, 0.55]) mark(api, fx, { kind: "slash", x: e.x, z: e.z, r: 2.0, len: 1.4, yaw: yw + s, life: 1.4, w: 0.2, hot: 1, hotLife: 0.25, deep: ABYSS, color2: FOAM, alpha: 0.85 });
      fx.ghost(a.hero.model, TEAL, 0.25, 0.3);
      fx.burst({ pos: at, n: 16, sprite: SPR.drop, color: [FOAM, TEAL], speed: [3, 8], size: [0.1, 0.2], life: [0.3, 0.5], gravity: 12, up: 1.5 }); fx.shake(0.07, 0.14); a.data.bigSwing = false; }
    return Math.round(dmg);
  },
  onKill(c) { const { a, fx } = c; if (a.cdLeft("Q") > 0) { a.setCd("Q", 0); fx.ring(a.pos.x, a.pos.z, 1.6, TEAL, 0.5); fx.burst({ pos: { x: a.pos.x, y: a.pos.y + 1.6, z: a.pos.z }, n: 6, sprite: SPR.glint, add: true, color: TEAL, size: [0.25, 0.4], life: [0.3, 0.5], speed: [0.2, 0.8], up: 0.8 }); } },
  passive(c, dt) {
    const { me, a, api, fx } = c, on = api.hasBuff(me, "veil"); warmFx2a(api, fx, a.pos.x, a.pos.z); a.data.veilK = (a.data.veilK ?? 0) + ((on ? 1 : 0) - (a.data.veilK ?? 0)) * (1 - Math.exp(-dt * 9)); a.hero.setVeil(a.data.veilK < 0.004 ? 0 : a.data.veilK);
    if (on && a.state() === "move") { a.data.drip = (a.data.drip ?? 0) + dt; if (a.data.drip > 0.1) { a.data.drip = 0; fx.burst({ pos: { x: a.pos.x, y: a.pos.y + 0.8, z: a.pos.z }, n: 1, sprite: SPR.drop, radius: 0.4, color: [FOAM, TEAL], alpha: 0.7, size: [0.07, 0.12], life: [0.3, 0.5], speed: 0.3, gravity: 6 }); } }
  },
};
