// R · 绯月千刃（整段）。分镜（世界时间，秒；顿帧另算真实时间）：
//   0.00  按 R：画面暗一档（只留人亮着）；落点 6 米的绯红法阵 0.14 秒从中心胀开，边线一闪；伊缇一缩，地上的光往脚下收、光点往刀上聚
//   0.12  伊缇消失（原地一个白→绯红的残影、一道竖着的闪光）
//   0.14～0.80  六刀：每 0.11 秒一刀。伊缇从上一个落点闪到这个目标身后——一道 7～9 米、两头尖、白芯绯红身子的长刀气“刷”地穿过目标；
//         目标整个闪白、顿帧、星芒炸开、火花顺着刀路溅出去、身上留一道和刀气交叉的刀痕；落点留一个残影。
//         刀气 0.16 秒后收细成一根发光的线留在空中——六刀下来，刀痕在空中交织成一张网
//   0.86  伊缇回到中心现身；定格 0.12 秒（世界停住、画面再暗一档）
//   0.87  十字新月斩炸开：两弯 10 米的新月交叉成 X 同时扫开；中心八芒大星；全屏闪一下、压暗一下子收掉（“一下子爆开”）；镜头大抖；
//         冲击波一路推到 6 米范围边（边线跟着亮一下）；地面从中心裂开，裂缝白热 → 绯红 → 冷成暖褐的疤；八道贴地尖芒；中心一根光柱；
//         网上的每根线和每道刀痕一起引爆（从中心往外依次，差几十毫秒），所有被打中的人一起闪白
//   0.9～2.1  收：新月变细淡掉，余烬往上飘，碎石落地，裂缝冷却，法阵淡出，伊缇落地成交叉双刃的收势
import type { Demo, LabActor } from "../api";
import { chest, kit, sequence, vec } from "./kit";
import { converge, strike } from "./hit";

const CENTER = vec(0, 0, 0), RANGE = 6;
const ORDER = [1, 0, 4, 2, 3, 5];       // targets 里的下标：托尔格 → 摩珂 → 左下小兵 → 右下小兵 → 上面小兵 → 下面小兵（来回穿过中心，刀网交成星形）
const GAP = 0.11, FIRST = 0.14;

export const r: Demo = {
  label: "R · 绯月千刃", duration: 2.2,
  run(ctx, cast, targets) {
    const K = kit(), lite = ctx.lite;
    const start = cast.obj.position.clone();
    const tFin = FIRST + GAP * ORDER.length + 0.06;          // 回到中心、定格
    const tBoom = tFin + 0.012;                                // 定格（顿帧）以后的那一下
    const web: number[] = [];                                  // 刀网的线（引爆用）
    const hitList: LabActor[] = [];
    let zone: ReturnType<typeof K.decal> | null = null;
    let prev = start.clone(); prev.y = 1.0;
    const ev: [number, () => void][] = [];

    // ---------- 起手 ----------
    ev.push([0, () => {
      ctx.dim(0.62, 0.08, 99, 0);          // 一直压着，到炸开那一下才收（压暗按真实时间走，顿帧会把六刀拉长，不能写死时长）
      zone = K.decal({ tex: "rune", x: CENTER.x, z: CENTER.z, r: RANGE, life: tBoom + 0.75, grow: 0.14, spin: 0.35, zone: true, texScale: 0.93, glow: [1.0, 0.48, 0.48], dark: [0.22, 0.15, 0.15] });
      zone.edge = 1.2;
      K.rings.add({ x: CENTER.x, z: CENTER.z, rMax: RANGE, life: 0.22, kind: 2, alpha: 0.9 });                           // 范围整片亮一下
      K.rings.add({ x: start.x, z: start.z, rMax: 2.6, r0: 0.35, life: 0.13, kind: 1, thick: 0.9, ease: 0 });          // 地上的光往脚下收
      converge(chest(cast, 0.5), 1.6, lite ? 6 : 10, 0.11, 0.1);
      K.stars.add({ pos: chest(cast, 0.55), size: 1.2, life: 0.13, kind: 2 });
      cast.play("attack2", { loop: false, fade: 0.03, speed: 1.8 });
    }]);
    ev.push([0.12, () => {
      K.ghosts.spawn({ life: 0.28, alpha: 0.9, white: 0.9 });
      K.lines.add({ a: vec(start.x, 0.1, start.z), b: vec(start.x, 4.2, start.z), width: 0.7, life: 0.16, reveal: 0.03, collapse: 0.06, thread: 0 });
      K.stars.add({ pos: chest(cast, 0.5), size: 1.8, life: 0.16 });
      K.rings.add({ x: start.x, z: start.z, rMax: 1.6, life: 0.2, thick: 0.5 });
      cast.setHide(1);
      if (zone) zone.edge = 0.3;
    }]);

    // ---------- 六刀 ----------
    ORDER.forEach((ti, i) => {
      const t = targets[ti]; if (!t) return;
      ev.push([FIRST + GAP * i, () => {
        const p = t.obj.position, from = prev.clone();
        const dir = vec(p.x - from.x, 0, p.z - from.z); const dist = dir.length(); dir.normalize();
        const land = vec(p.x + dir.x * (t.radius + 1.3), 0, p.z + dir.z * (t.radius + 1.3));
        const yHit = t.isHero ? 1.25 : 0.85;
        const a = vec(from.x - dir.x * 0.6, 1.0, from.z - dir.z * 0.6), b = vec(land.x + dir.x * 1.8, yHit * 0.8 + 0.2, land.z + dir.z * 1.8);
        // 主刀气：留成刀网（收细到 0.1 米的线），最后一起引爆
        web.push(K.lines.add({ a, b, width: t.isHero ? 1.24 : 1.0, life: tBoom - (FIRST + GAP * i) + 0.6, reveal: 0.045, collapse: 0.03, thread: 0.12 }));      // 返工：最宽处 2 倍；0.03 秒起收、0.15 秒内细成刀痕
        // 旁边一道细的淡色刀气，错开一点（王者的刀气不是一根管子，是一主几副）
        const side = vec(-dir.z, 0, dir.x).multiplyScalar(0.28);
        K.lines.add({ a: a.clone().add(side).addScaledVector(dir, 1.2), b: b.clone().add(side).addScaledVector(dir, -0.6), width: 0.26, life: 0.2, reveal: 0.06, kind: 1, collapse: 0.06, thread: 0 });
        const s = strike(ctx, t, { dir, power: t.isHero ? 1.15 : 0.75, shake: t.isHero ? 0.14 : 0.08, mark: { life: tBoom - (FIRST + GAP * i) + 0.6, thread: 0.09, collapse: 0.12 } });
        web.push(s.mark);
        hitList.push(t);
        // 伊缇闪到目标身后：落点留一个残影（开头偏白），顺着刀路往前飘一点
        cast.setPos(land.x, land.z); cast.face(Math.atan2(dir.x, dir.z));
        cast.play(i % 2 ? "attack1" : "attack2", { loop: false, fade: 0, speed: 2.2 });
        K.ghosts.spawn({ life: 0.24, alpha: 0.85, white: 0.7, drift: vec(dir.x * 3, 0, dir.z * 3) });
        prev = vec(land.x, 1.0, land.z);
        void dist;
      }]);
    });

    // ---------- 回到中心、定格 ----------
    ev.push([tFin, () => {
      const from = prev.clone();
      K.lines.add({ a: from, b: vec(CENTER.x, 1.0, CENTER.z), width: 0.45, life: 0.12, reveal: 0.03, collapse: 0.05, thread: 0 });
      cast.setPos(CENTER.x, CENTER.z); cast.setHide(0); cast.face(0.68);
      cast.play("r_end", { loop: false, fade: 0, speed: 1.1 });
      K.ghosts.spawn({ life: 0.2, alpha: 0.9, white: 1 });
      K.stars.add({ pos: vec(CENTER.x, 1.5, CENTER.z), size: 1.6, life: 0.06, kind: 2 });
      // 定格那一帧：胸前双刃交叉的一道 X 形白光（“十字”先亮一下，下一帧整个炸开）
      for (const s of [-1, 1]) K.lines.add({ a: vec(CENTER.x - 1.1, 1.5 + 0.9 * s, CENTER.z + 0.3), b: vec(CENTER.x + 1.1, 1.5 - 0.9 * s, CENTER.z - 0.3), width: 0.34, life: 0.09, reveal: 0.02, collapse: 0.05, thread: 0 });
      ctx.dim(0.85, 0.04, 99, 0);
      ctx.hitstop(0.12);                                   // 定格 0.12 秒
      if (zone) zone.edge = 0.8;
    }]);

    // ---------- 十字新月斩 ----------
    ev.push([tBoom, () => {
      ctx.flash(0.2, 0.14);
      ctx.dim(0, 0.3, 0, 0);
      ctx.shake(0.62, 0.55);
      const y = 0.9, Rc = 6.4, half = 1.12;              // 两弯：圆弧半径 6.4 米、各张 103 度，弧的中点都压在中心上，交成 X
      for (const [m, flip] of [[Math.PI * 0.25, false], [Math.PI * 0.75, true]] as [number, boolean][]) {
        const nx = Math.cos(m), nz = Math.sin(m);
        // yaw=0 时局部就是世界：圆弧上角度 ang 的点在 圆心 + (cos ang, 0, sin ang)·Rc；圆心放在中心往 -n 退 Rc，弧中点就正好落在中心
        const cx = CENTER.x - nx * Rc, cz = CENTER.z - nz * Rc;
        const mid = Math.atan2(nz, nx);
        K.crescent({ pos: vec(cx, y, cz), yaw: 0, r: Rc, width: 1.25, edgeW: 1.6, a0: flip ? mid + half : mid - half, a1: flip ? mid - half : mid + half, sweep: 0.11, hold: 0.14, linger: 0.36, tail: 1.04, glow: 1.2, sym: true });
      }
      K.stars.add({ pos: vec(CENTER.x, 1.4, CENTER.z), size: 3.4, life: 0.17, kind: 1, rot: 0.2 });
      K.rings.add({ x: CENTER.x, z: CENTER.z, rMax: RANGE, r0: 0.4, life: 0.34, thick: 1.6, ease: 1 });
      K.decal({ tex: "crack", x: CENTER.x, z: CENTER.z, r: RANGE * 1.02, life: 1.5, grow: 0.2, rot: 0.6, glow: [1.8, 0.45, 0.0], dark: [0.5, 0.4, 0.15] });      // 裂缝 0.25 秒以后就褪到一小半：余韵是暗疤，不是一片粉雾
      // 返工：炸开的头 0.2 秒里只留 X 新月、中心星芒、冲击环、地裂（八道贴地尖芒、第二圈环砍掉；火花减少，碎片、余烬、刀网引爆、各目标的星芒往后挪 0.2 秒）
      const c = vec(CENTER.x, 1.0, CENTER.z);
      K.sparks.add({ pos: c, n: 16, speed: [10, 22], life: [0.25, 0.5], size: [0.08, 0.14], up: 0.25, gravity: 0.7, drag: 2.2, stretch: 0.05 });
      for (const t of targets) t.hit(0.6);                // 所有被打中的人一起闪白（人身上的事，不算碎东西）
      if (zone) { zone.edge = 1.4; zone.end(0.36); }       // 地面填色跟着边线闪一下，就收
    }]);
    ev.push([tBoom + 0.06, () => { if (zone) zone.edge = 0.4; }]);
    ev.push([tBoom + 0.2, () => {
      K.sparks.add({ pos: vec(0, 1.0, 0), n: 12, speed: [5, 11], life: [0.4, 0.7], size: [0.22, 0.34], kind: 1, up: 0.5, gravity: 1, drag: 1.6 });
      K.sparks.add({ pos: vec(0, 0.4, 0), n: 18, speed: [1.5, 4], life: [0.9, 1.4], size: [0.1, 0.2], kind: 2, up: 0.9, gravity: -0.12, drag: 1.2, jitter: 0.3 });
      for (const id of web) if (id >= 0) K.lines.ignite(id, K.t + Math.random() * 0.06);      // 刀网、刀痕这时候才碎掉
      if (zone) zone.edge = 1.6;                                                                 // 冲击波推到边：边线亮一下
    }]);
    ev.push([tBoom + 0.3, () => { if (zone) zone.edge = 0.4; }]);
    // 冲击波推过每个人：星芒、火花（往后挪到 0.2 秒以后，按距离排开）
    for (const t of targets) {
      const d = Math.hypot(t.obj.position.x - CENTER.x, t.obj.position.z - CENTER.z);
      ev.push([tBoom + 0.2 + d * 0.015, () => {
        const dir = vec(t.obj.position.x - CENTER.x, 0, t.obj.position.z - CENTER.z);
        strike(ctx, t, { dir, power: t.isHero ? 1.1 : 0.8, stop: t.isHero ? 0.035 : 0, shake: 0, ring: true, star: 0.55, white: 0.6 });
      }]);
    }
    ev.push([tBoom + 0.75, () => cast.play("idle", { fade: 0.2 })]);
    return sequence(ev, 2.2, () => { cast.setHide(0); });
  },
};
