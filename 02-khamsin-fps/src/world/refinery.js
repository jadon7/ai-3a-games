// 第四张地图「沙海炼厂」——灰盒原型（只用几何块，先验证布局和手感，确认后再做成完整地图）。
//
// 布局按 FPS 品类的通用做法来设计，不照搬任何一张现成地图：
//   · 南北镜像对称（我方在南 +z，敌方在北 −z），两队拿到的地形完全一样
//   · 三条路，各有各的交战距离：
//       西路「旱渠」  下沉 3 m 的长渠，远距离对枪，机甲能走；两座桥横跨渠上，桥下是暗处
//       中路「反应塔」 中央广场 + 四层高的反应塔（地面 / 5 m 平台 / 10 m 塔顶），装卸场的集装箱切断长视线
//       东路「厂房」  压缩机房、中央仓库这些室内，近距离；只有步兵能进
//   · 三条路之间有横向通道（暗管、横街、中桥、风道），随时可以换路包抄
//   · 高度分四层：渠底 −3 m / 地面 0 / 屋顶与栈桥 4.5 m / 厂房屋顶 8–9 m、塔顶 10 m
//   · 每条路的中段都有一个双方争夺的高点：渠边哨台、反应塔、仓库夹层
//   · 每个关键区域至少两三个入口；出生区有三个方向的出口，闸楼挡住从中央直看出生点的视线
//   · 给本作的机动性留了专门的路线：长墙（蹬墙跑）、横梁（钩爪）、滑索、可以攀上去的平台和集装箱
// 颜色按功能区分（见 COL），每块都铺 1 m / 4 m 网格（materials.js 的 proto 材质），站在哪里都能数格子估距离。
import * as THREE from 'three';
import { M4 } from './kit.js';

export const REFINERY_NAME = '沙海炼厂';
// 导航：0.5 m 的格子（门 2.4 m 宽、栈桥 3.5 m 宽），四周净距 0.4 m，相邻格高差 ≤ 0.5 m（台阶坡度 ≤ 0.5）
export const REFINERY_BOUNDS = { x0: -63, x1: 63, z0: -79, z1: 79, cell: 0.5, radius: 0.4, step: 0.5, layers: 9 };

// 功能色（sRGB）
export const COL = {
  ground: [0.66, 0.64, 0.6],      // 地面
  floor2: [0.74, 0.74, 0.72],     // 楼板、平台、栈桥、屋面
  wall: [0.88, 0.87, 0.84],       // 普通墙体
  run: [0.42, 0.64, 0.96],        // 设计好的蹬墙跑墙面
  cover: [0.96, 0.8, 0.32],       // 齐腰掩体（≈1.1 m，蹲下能完全躲住）
  cover2: [0.78, 0.66, 0.52],     // 高掩体：集装箱、货箱、机器（能挡住站立的人）
  beam: [1.0, 0.48, 0.14],        // 钩爪横梁、管架
  stair: [0.5, 0.82, 0.5],        // 楼梯、坡道、攀爬块
  trench: [0.52, 0.58, 0.66],     // 旱渠和暗管（低层）
  obj: [0.98, 0.84, 0.42],        // 反应塔（中央高点）
  spawnF: [0.46, 0.8, 0.9],       // 我方出生区地面
  spawnE: [0.94, 0.48, 0.42],     // 敌方出生区地面
  edge: [0.42, 0.42, 0.44],       // 地图边界墙
};
// 图例（菜单和游戏里显示）
export const LEGEND = [
  ['ground', '地面'], ['floor2', '楼板 / 平台 / 屋面'], ['wall', '墙体'], ['run', '蹬墙跑墙面'], ['cover', '齐腰掩体'], ['cover2', '高掩体'],
  ['beam', '钩爪横梁'], ['stair', '楼梯 / 坡道 / 攀爬块'], ['trench', '旱渠 / 暗管（低层）'], ['obj', '反应塔（中央高点）'], ['spawnF', '我方出生区'], ['spawnE', '敌方出生区'],
];

export function buildRefinery(B, K) {
  const L = {
    name: REFINERY_NAME, proto: true,
    playerSpawn: { x: 0, y: 0.1, z: 70, yaw: 0 },
    friendlyPods: [], enemyPods: [], mechDrops: [], nests: [], zones: null, combatPoints: [], respawns: [],
    ziplines: [], shafts: [], smokes: [], flyover: [], dustVolumes: [], labels: [],
    oob: { x0: -63, x1: 63, z0: -79, z1: 79, y0: -6 },   // 边界墙外沿：翻过墙才算离开战区（贴着墙站不算）
    droneSpawn: { x0: -30, x1: 30, z: -70 },
  };
  const holes = [];   // 地面开的洞（旱渠、暗管楼梯口）
  const ceilings = [];   // 下面是空的地面（暗管顶）：要画底面，不然从暗管里抬头能看到天

  // ---------- 基本件（s = +1 南半边原样，s = −1 沿 z = 0 镜像到北半边）----------
  const half = (s) => {
    const zr = (z0, z1) => (s > 0 ? [z0, z1] : [-z1, -z0]);
    const box = (kind, x0, y0, z0, x1, y1, z1, o = {}) => { const [a, b] = zr(z0, z1); B.box('proto', x0, y0, a, x1, y1, b, { c: COL[kind], ...o }); };
    const flip = (dir) => (s > 0 ? dir : dir === '+z' ? '-z' : dir === '-z' ? '+z' : dir);
    const stairs = (x, y, z, dir, w, rise, run) => K.stairs(x, y, z * s, flip(dir), w, rise, run, 'proto', { c: COL.stair });
    const ramp = (x, y, z, dir, w, rise, run, kind = 'stair') => K.ramp(x, y, z * s, flip(dir), w, rise, run, 'proto', { c: COL[kind], ts: 4 });
    const tank = (x, z, r, h) => K.cyl('proto', x, 0, z * s, r, h, { c: COL.run, collide: true, mech: true, seg: 28, ts: 4, rays: 20 });
    const hole = (x0, z0, x1, z1) => { const [a, b] = zr(z0, z1); holes.push([x0, a, x1, b]); };
    const ceiling = (x0, z0, x1, z1) => { const [a, b] = zr(z0, z1); ceilings.push([x0, a, x1, b]); };
    const P = (x, y, z) => [x, y, z * s];
    const label = (text, x, y, z, o = {}) => L.labels.push({ text: s > 0 ? text : text.replace('南', '北').replace('我方', '敌方'), x, y, z: z * s, ...o });
    const lamp = (x, y, z, power = 36, radius = 13) => {
      box('wall', x - 0.45, y - 0.08, z - 0.15, x + 0.45, y, z + 0.15, { collide: false, rays: 0, bottom: true });
      B.box('emissive', x - 0.4, y - 0.1, z * s - 0.1, x + 0.4, y - 0.08, z * s + 0.1, { c: [1.5, 1.42, 1.25], collide: false, rays: 0, bottom: true });
      B.light(x, y - 0.4, z * s, [1.0, 0.86, 0.66], power, radius);
    };
    // 沿 x 走向的墙（占 z0..z1 的厚度、x0..x1 的长度、0..h 的高度）；holes = [[中心 x, 宽, 下沿, 上沿], …] 开门窗
    const wallX = (kind, x0, x1, z0, z1, h, hs = [], o = {}) => {
      let at = x0; for (const [c, w, y0, y1] of [...hs].sort((p, q) => p[0] - q[0])) {
        const a = c - w / 2, b = c + w / 2; if (a > at) box(kind, at, 0, z0, a, h, z1, o);
        if (y0 > 0) box(kind, a, 0, z0, b, y0, z1, o); if (y1 < h) box(kind, a, y1, z0, b, h, z1, { ...o, bottom: true }); at = b;
      }
      if (x1 > at) box(kind, at, 0, z0, x1, h, z1, o);
    };
    // 沿 z 走向的墙；holes 的中心是 z（南半边坐标）
    const wallZ = (kind, z0, z1, x0, x1, h, hs = [], o = {}) => {
      let at = z0; for (const [c, w, y0, y1] of [...hs].sort((p, q) => p[0] - q[0])) {
        const a = c - w / 2, b = c + w / 2; if (a > at) box(kind, x0, 0, at, x1, h, a, o);
        if (y0 > 0) box(kind, x0, 0, a, x1, y0, b, o); if (y1 < h) box(kind, x0, y1, a, x1, h, b, { ...o, bottom: true }); at = b;
      }
      if (z1 > at) box(kind, x0, 0, at, x1, h, z1, o);
    };
    // 一栋房子：四面墙（厚 0.4）+ 屋面。N 面是 z0 那侧（靠中线），S 面是 z1 那侧；门窗同上
    const room = (x0, z0, x1, z1, h, d = {}) => {
      const t = 0.4, k = d.kinds || {};
      wallX(k.N || 'wall', x0, x1, z0, z0 + t, h, d.N || []); wallX(k.S || 'wall', x0, x1, z1 - t, z1, h, d.S || []);
      wallZ(k.W || 'wall', z0 + t, z1 - t, x0, x0 + t, h, d.W || []); wallZ(k.E || 'wall', z0 + t, z1 - t, x1 - t, x1, h, d.E || []);
      if (d.roof !== false) box('floor2', x0, h, z0, x1, h + 0.4, z1, { bottom: true });
    };
    const zip = (a, b) => { const A = P(...a), Bp = P(...b); K.cable(A, Bp, 0.5, 0.03); L.ziplines.push({ a: A, b: Bp }); for (const p of [A, Bp]) K.tube('steel', [p[0], p[1] - 2.3, p[2]], [p[0], p[1] + 0.15, p[2]], 0.05); };
    return { s, box, stairs, ramp, tank, hole, ceiling, P, label, lamp, wallX, wallZ, room, zip };
  };

  // ====================== 半边（南半边写一遍，北半边镜像）======================
  for (const s of [1, -1]) {
    const H = half(s); const { box, stairs, ramp, tank, hole, ceiling, label, lamp, wallX, wallZ, room, zip } = H;

    // ---------- 西岸（x −62..−50）：泵房屋顶是俯瞰旱渠的高点 ----------
    room(-60, 26, -52, 34, 4.1, { E: [[30, 2.4, 0, 2.8]], N: [[-56, 2.2, 0, 2.6]] });
    box('cover', -52.4, 4.5, 26, -52, 5.5, 34); box('cover', -60, 4.5, 26, -52.4, 5.5, 26.4); box('cover', -58.6, 4.5, 33.6, -52.4, 5.5, 34);
    stairs(-59.9, 0, 43, '-z', 2.2, 4.5, 9);
    lamp(-56, 4.0, 30, 30, 9);
    // 水塔（地标，钩爪可以挂）
    for (const [x, z] of [[-58, 50], [-54, 50], [-58, 54], [-54, 54]]) box('beam', x - 0.2, 0, z - 0.2, x + 0.2, 8, z + 0.2);
    K.cyl('proto', -56, 8, 52 * s, 2.8, 3.6, { c: COL.wall, collide: true, seg: 24, ts: 4 });
    box('cover', -58.5, 0, 10, -56, 1.1, 11.2); box('cover', -55, 0, 17, -53.8, 1.1, 20); box('cover2', -54, 0, 44.5, -52, 1.6, 46.5);
    box('cover', -50.3, 0, 4.5, -50, 1.0, 19.5); box('cover', -50.3, 0, 28, -50, 1.0, 47);
    label('南泵房（屋顶高点）', -56, 7.2, 30); label('水塔', -56, 13.5, 52);

    // ---------- 西路：旱渠（x −50..−36，渠底 y = −3）----------
    hole(-50, 0, -36, 62);
    box('trench', -50, -3.4, 0, -36, -3, 62, { mech: true });
    box('run', -50.4, -3.4, 0, -50, -0.4, 62);
    for (const [z0, z1] of [[0, 8], [11, 62]]) box('run', -36, -3.4, z0, -35.6, -0.4, z1);   // 东侧渠壁，z 8..11 是暗管口
    ramp(-43, -3, 50, '+z', 14, 3, 12, 'trench');                                                  // 渠尾坡道：机甲也能上下
    // 南涵洞桥：横跨旱渠的步行桥，桥下可以穿过
    box('floor2', -50, -0.5, 20, -36, 0, 24, { mech: true, bottom: true }); box('cover', -50, 0, 20, -36, 1.0, 20.3); box('cover', -50, 0, 23.7, -36, 1.0, 24);
    // 渠底掩体
    box('cover', -47, -3, 9, -44.5, -1.8, 10.5); box('cover', -41, -3, 14, -38.6, -1.8, 15.2); box('cover2', -45.5, -3, 30, -41.5, -0.8, 32.4);
    box('cover', -49.4, -3, 38, -47.4, -1.8, 41); box('cover', -39, -3, 42, -36.6, -1.8, 45); box('cover', -44, -3, 46.5, -42, -1.8, 48);
    // 两侧上下的楼梯
    stairs(-42, -3, 34, '+x', 2.5, 3, 6); stairs(-44, -3, 26, '-x', 2.5, 3, 6);
    // 横跨旱渠的管架（钩爪横梁）
    for (const z of [13, 41]) { box('beam', -51.4, 0, z - 0.3, -50.8, 6, z + 0.3); box('beam', -35.2, 0, z - 0.3, -34.6, 6, z + 0.3); box('beam', -51.4, 6, z - 0.3, -34.6, 6.5, z + 0.3); }
    box('cover', -36, 0, 4.5, -35.7, 1.0, 7.5); box('cover', -36, 0, 12, -35.7, 1.0, 19.5); box('cover', -36, 0, 24.5, -35.7, 1.0, 32.5); box('cover', -36, 0, 35.5, -35.7, 1.0, 48);
    lamp(-43, -0.55, 22, 26, 9);
    label('旱渠', -43, -0.5, 36); label('南涵洞桥', -43, 2.2, 22);

    // ---------- 南暗管：渠底钻到中路西侧（塔下广场边上冒出来）----------
    box('trench', -36, -3.4, 8, -25, -3, 11);
    box('wall', -36, -3.4, 7.6, -19, -0.4, 8); box('wall', -36, -3.4, 11, -19, -0.4, 11.4);
    hole(-25, 8, -19, 11); ceiling(-36, 7.6, -25, 11.4); stairs(-25, -3, 9.5, '+x', 3, 3, 6);
    box('cover', -25, 0, 11, -19, 1.0, 11.3); box('cover', -25, 0, 7.7, -19, 1.0, 8);
    lamp(-31, -0.5, 9.5, 26, 8); lamp(-24, -0.5, 9.5, 20, 6);
    label('南暗管', -22, 2.2, 9.5);

    // ---------- 中路西侧：西仓库（室内近战，屋顶连着闸楼屋顶）----------
    room(-28, 24, -16, 44, 4.1, { W: [[29, 2.4, 0, 2.8], [39, 2.4, 0, 2.8]], E: [[27, 2.4, 0, 2.8], [34, 6, 1.3, 2.4], [41, 2.4, 0, 2.8]], N: [[-22, 2.4, 0, 2.8]], S: [[-20, 2.4, 0, 2.8]] });
    box('cover2', -25, 0, 28, -24.3, 2.4, 36); box('cover2', -20, 0, 32, -19.3, 2.4, 40);
    box('cover', -28, 4.5, 24, -24, 5.4, 24.3); box('cover', -20, 4.5, 24, -16, 5.4, 24.3);
    lamp(-22, 3.95, 30); lamp(-22, 3.95, 39);
    label('西仓库', -22, 6.4, 34);

    // ---------- 中路：装卸场（集装箱切断从中央到出生区的长视线）----------
    box('cover2', -10.6, 0, 23, -8, 2.6, 29); box('cover2', 5, 0, 22, 7.6, 2.6, 28); box('cover2', 7, 0, 40, 9.6, 2.6, 46);
    box('cover2', -4, 0, 34, 2, 2.6, 36.4); box('cover2', -2.5, 2.6, 34, 3.5, 5.2, 36.4);    // 叠起来的集装箱：攀上去是个中等高点
    box('cover', -12.5, 0, 38, -9.5, 1.1, 39); box('cover', 9.5, 0, 31.5, 12.5, 1.1, 32.5); box('cover', -6, 0, 43.5, -2.5, 1.1, 44.5); box('cover', -2, 0, 19.5, 2, 1.1, 20.5);
    box('beam', -14.9, 0, 30.75, -14.4, 6, 31.25); box('beam', 14.4, 0, 30.75, 14.9, 6, 31.25); box('beam', -14.9, 6, 30.75, 14.9, 6.5, 31.25);
    label('南装卸场', 0, 3.6, 39);

    // ---------- 南闸楼：出生区前面的一排厚墙。西门 8 m 宽、不封顶（机甲走这里），东门 4 m 宽（只有步兵）----------
    box('wall', -28, 0, 48, -16, 4.1, 54, { skip: 'U' }); box('wall', -8, 0, 48, 2, 4.1, 54, { skip: 'U' }); box('wall', 6, 0, 48, 16.5, 4.1, 54, { skip: 'U' });
    box('wall', 2, 3.2, 48, 6, 4.1, 54, { bottom: true });
    box('floor2', -28, 4.1, 48, -16, 4.5, 54); box('floor2', -8, 4.1, 48, 16.5, 4.5, 54);
    box('cover', -28, 4.5, 48, -16, 5.6, 48.4); box('cover', -8, 4.5, 48, 16.5, 5.6, 48.4);          // 屋顶北沿的女墙（连续：塔顶的视线越不过去）
    stairs(-24.75, 0, 63, '-z', 2.5, 4.5, 9); stairs(12.25, 0, 63, '-z', 2.5, 4.5, 9);
    lamp(4, 3.15, 51, 22, 7);
    label('南闸楼', -12, 7.5, 51);

    // ---------- 南管廊栈桥：贴着中路东侧、4.5 m 高的长栈桥，从出生区一直通到广场边 ----------
    box('floor2', 16.5, 4.1, 20, 20, 4.5, 54, { bottom: true }); box('floor2', 20, 4.1, 52, 22.5, 4.5, 54, { bottom: true });
    box('wall', 16.5, 0, 50, 20, 4.1, 54);                                                         // 栈桥南端下面封死：栈桥底下不再是一条直通出生区的长视线
    stairs(21.25, 0, 63, '-z', 2.5, 4.5, 9);
    for (const z of [21, 28, 36, 44]) box('beam', 16.6, 0, z, 17, 4.1, z + 0.4);
    for (const [a, b] of [[20, 30], [32, 40], [42, 48]]) box('cover', 16.5, 4.5, a, 16.8, 5.5, b);
    box('cover', 19.7, 4.5, 20, 20, 5.5, 26); box('cover', 19.7, 4.5, 46, 20, 5.5, 52);
    label('南管廊栈桥', 18.3, 7.0, 34);

    // ---------- 南风道：栈桥后面的高墙夹道，两面都是蹬墙跑的长墙 ----------
    wallZ('run', 26, 46, 20, 20.5, 6, [[30, 2, 0, 2.8], [40, 2, 0, 2.8]]);
    box('cover', 25.6, 0, 30, 26.4, 0.8, 37); box('cover', 22.2, 0, 34, 23, 0.8, 44);
    label('南风道', 24.2, 7.2, 36);

    // ---------- 东路：南压缩机房（两层，室内机器做掩体，夹层能看到出生区方向）----------
    room(28, 26, 54, 46, 8, {
      kinds: { W: 'run', E: 'run' },
      W: [[30, 2.4, 0, 2.8], [35, 3, 1.3, 2.5], [40, 2.4, 0, 2.8]], N: [[36, 2.6, 0, 3], [48, 2.6, 0, 3]], S: [[40, 2.6, 0, 3]], E: [[36, 2.4, 0, 2.8]],
    });
    for (const [x0, z0, x1, z1] of [[28, 26, 54, 26.3], [28, 45.7, 54, 46], [28, 26.3, 28.3, 45.7], [53.7, 26.3, 54, 45.7]]) box('cover', x0, 8.4, z0, x1, 9.2, z1);
    box('cover2', 33, 0, 30, 39, 3, 35); box('cover2', 43, 0, 33, 49, 3, 38);
    box('floor2', 28.4, 3.6, 42, 53.6, 4, 45.6, { bottom: true }); box('floor2', 44, 3.6, 39.5, 47, 4, 42, { bottom: true });
    stairs(36, 0, 40.75, '+x', 2.5, 4, 8);
    box('cover', 28.4, 4, 42, 43, 5, 42.3); box('cover', 47, 4, 42, 53.6, 5, 42.3);
    lamp(35, 7.95, 31); lamp(46, 7.95, 31); lamp(35, 7.95, 40); lamp(40, 3.55, 44, 26, 9);
    label('南压缩机房', 41, 10.6, 36);

    // ---------- 南横街：中路通东巷的宽街，机甲能走 ----------
    box('cover2', 34, 0, 17, 41, 2.8, 19.5); box('cover2', 41, 0, 17.2, 43.2, 2.4, 19.3);
    box('cover', 25, 0, 21, 28, 1.1, 22); box('cover', 47, 0, 14, 50, 1.1, 15); box('cover2', 51.5, 0, 21, 53.5, 1.5, 23);
    label('南横街', 46, 3.4, 19);

    // ---------- 东巷：沿边界的窄巷，绕到中央仓库背后 ----------
    box('cover2', 58.5, 0, 28, 61, 1.6, 30.5); box('cover', 55, 0, 38, 56, 1.1, 41); box('cover2', 59, 0, 7, 61.5, 1.5, 9.5);
    label('东巷', 58, 3.4, 33);

    // ---------- 后场：出生区（三个方向的出口）、货场 ----------
    // 出生区前的两道错开的矮墙：挡住从中央、广场穿过两个门洞看进出生区的视线；两道墙之间留 1.2 m 的折线缝，人能穿过去
    box('wall', -7, 0, 57, 9.5, 3.5, 57.6); box('wall', -22, 0, 58.8, -6.5, 4.5, 59.4);
    // 集结棚：出生区后半截的顶棚，塔顶看不到棚下
    box('floor2', -13, 4.4, 68, 13, 4.8, 77, { bottom: true });
    for (const x of [-12.6, -0.2, 12.2]) box('beam', x, 0, 68.2, x + 0.4, 4.4, 68.6);
    lamp(-6, 4.35, 72, 24, 9); lamp(6, 4.35, 72, 24, 9);
    box('cover', -16, 0, 61, -12, 1.1, 62); box('cover', 15, 0, 60, 18.5, 1.1, 61);
    box('cover2', -34, 0, 60, -31, 2.2, 63); box('cover', -46, 0, 66, -42, 1.1, 67);
    box('cover2', 31, 0, 49, 34, 2.4, 52); box('cover', 44, 0, 50, 48, 1.1, 51); box('cover2', 56, 0, 47, 58.5, 1.5, 49.5);
    label('我方集结场（出生区）', 0, 6.4, 72); label('南货场', 44, 3.4, 52);

    // ---------- 塔下广场（这半边的部分）----------
    tank(-13, 12, 3.2, 6.5); tank(13, 12, 3.2, 6.5);                                                // 储罐：圆柱面也能蹬墙跑，罐顶钩爪 / 栈桥跳过去
    box('cover', -21, 0, 14, -17, 1.1, 15); box('cover', -7, 0, 17, -3, 1.1, 18); box('cover', 3, 0, 18.5, 7, 1.1, 19.5);
    box('cover2', -27, 0, 4, -25, 1.6, 7); box('cover2', 19, 0, 3, 21.4, 2.6, 9); box('cover', -12.5, 0, 3, -10.5, 1.4, 5); box('cover', 10.5, 0, 2, 12.5, 1.4, 4);
    box('wall', -32, 0, 14, -28, 3, 18);                                                            // 岗亭：能翻上去
    // 反应塔两侧的楼梯（上 5 m 平台）
    stairs(-6.75, 0, 14.5, '-z', 2.5, 5, 9.5); stairs(6.75, 0, 14.5, '-z', 2.5, 5, 9.5);
    // 渠边哨台（西岸中段）的楼梯
    stairs(-59.9, 0, 11.5, '-z', 2.2, 4.5, 9);
    // 滑索：塔顶 → 压缩机房屋顶
    zip([1.8, 12.4, 1.8], [34, 10.9, 30]);
    label('储罐', -13, 8.2, 12); label('储罐', 13, 8.2, 12);
  }

  // ====================== 中线（只建一次，本身南北对称）======================
  {
    const H = half(1); const { box, lamp, label, room } = H;
    // 中桥：西岸 ↔ 中路，桥下是暗处
    box('floor2', -50, -0.6, -4, -36, 0, 4, { mech: true, bottom: true }); box('cover', -50, 0, -4, -36, 1.0, -3.7); box('cover', -50, 0, 3.7, -36, 1.0, 4);
    lamp(-43, -0.65, 0, 26, 9);
    label('中桥 · 桥下', -43, 2.4, 0);
    // 渠边哨台：西岸中段 4.5 m 高的平台，两队都能从各自那侧的楼梯上来
    for (const [x0, x1] of [[-58.6, -58.2], [-52, -51.6]]) for (const [z0, z1] of [[-2.5, -2.1], [2.1, 2.5]]) box('beam', x0, 0, z0, x1, 4.1, z1);
    box('floor2', -61, 4.1, -2.5, -51.5, 4.5, 2.5, { bottom: true });
    box('cover', -51.9, 4.5, -2.5, -51.5, 5.6, 2.5); box('cover', -58.8, 4.5, -2.5, -51.9, 5.4, -2.2); box('cover', -58.8, 4.5, 2.2, -51.9, 5.4, 2.5);
    label('渠边哨台', -56, 7.6, 0);
    // 反应塔：地面层（柱子 + 中心墩）/ 5 m 平台 / 10 m 塔顶
    for (const [x0, x1] of [[-8, -6.5], [6.5, 8]]) for (const [z0, z1] of [[-5, -3.5], [3.5, 5]]) box('obj', x0, 0, z0, x1, 4.6, z1);
    box('obj', -1.5, 0, -1.5, 1.5, 4.6, 1.5);
    box('obj', -8, 4.6, -5, 8, 5.0, 5, { bottom: true });
    box('cover', -5.5, 5, 4.7, 5.5, 6, 5); box('cover', -5.5, 5, -5, 5.5, 6, -4.7); box('cover', 7.7, 5, -4.7, 8, 6, 4.7); box('cover', -8, 5, -4.7, -7.7, 6, 4.7);
    box('obj', -2.5, 5, -2.5, 2.5, 10, 2.5);
    box('stair', 2.5, 5, -0.9, 4.1, 7.4, 0.9); box('stair', -4.1, 5, -0.9, -2.5, 7.4, 0.9);       // 攀爬块：平台 → 塔顶（跳起来攀上去）
    box('cover', -2.5, 10, -2.5, 2.5, 10.7, -2.2); box('cover', -2.5, 10, 2.2, 2.5, 10.7, 2.5);
    for (const x of [-2.5, 2.2]) { box('cover', x, 10, -2.2, x + 0.3, 10.7, -0.9); box('cover', x, 10, 0.9, x + 0.3, 10.7, 2.2); }
    lamp(0, 4.55, 3.2, 22, 8); lamp(0, 4.55, -3.2, 22, 8);
    label('反应塔 · 塔顶 10 m', 0, 12.8, 0, { big: true }); label('5 m 平台', -6, 6.9, 0);
    // 中央仓库：两层，西墙窗户看广场，东边夹层看东巷
    room(26, -12, 50, 12, 9, {
      kinds: { E: 'run' },
      W: [[-7, 3, 0, 3.5], [0, 6, 1.3, 2.5], [7, 3, 0, 3.5]], E: [[-6, 4, 5.2, 6.4], [0, 3, 0, 3.2], [6, 4, 5.2, 6.4]],
      N: [[30, 3, 0, 3.2], [47, 3, 0, 3.2]], S: [[30, 3, 0, 3.2], [47, 3, 0, 3.2]],
    });
    for (const [x0, z0, x1, z1] of [[26, -12, 50, -11.7], [26, 11.7, 50, 12], [26, -11.7, 26.3, 11.7], [49.7, -11.7, 50, 11.7]]) box('cover', x0, 9.4, z0, x1, 10.2, z1);
    box('cover2', 31, 0, -4, 35, 2.2, 4); box('cover', 38, 0, 5.5, 41, 1.4, 8.5); box('cover', 38, 0, -8.5, 41, 1.4, -5.5);
    box('floor2', 44, 4.1, -11.6, 49.6, 4.5, 11.6, { bottom: true });
    for (const z of [-11.2, -4, 4, 10.8]) box('beam', 44, 0, z, 44.4, 4.1, z + 0.4);
    box('cover', 44, 4.5, -8.8, 44.3, 5.5, 8.8);
    K.stairs(35, 0, 10.25, '+x', 2.5, 4.5, 9, 'proto', { c: COL.stair }); K.stairs(35, 0, -10.25, '+x', 2.5, 4.5, 9, 'proto', { c: COL.stair });
    for (const z of [-6, 6]) { lamp(32, 8.95, z); lamp(40, 8.95, z); lamp(47, 4.05, z, 26, 8); } lamp(47, 4.05, 0, 22, 7);
    label('中央仓库', 38, 11.4, 0); label('仓库夹层', 47, 6.8, 0);
  }

  // ====================== 地面、边界、城外 ======================
  {
    const X0 = -62, X1 = 62, Z0 = -78, Z1 = 78;
    const spawn = [[-24, 62, 24, Z1, 'spawnF'], [-24, Z0, 24, -62, 'spawnE']];
    const xs = new Set([X0, X1]), zs = new Set([Z0, Z1]);
    for (const h of holes) { xs.add(h[0]); xs.add(h[2]); zs.add(h[1]); zs.add(h[3]); }
    for (const p of [...spawn, ...ceilings]) { xs.add(p[0]); xs.add(p[2]); zs.add(p[1]); zs.add(p[3]); }
    const X = [...xs].sort((a, b) => a - b), Z = [...zs].sort((a, b) => a - b);
    const kindAt = (x, z) => { for (const h of holes) if (x > h[0] && x < h[2] && z > h[1] && z < h[3]) return null; for (const c of ceilings) if (x > c[0] && x < c[2] && z > c[1] && z < c[3]) return 'ground|c'; for (const p of spawn) if (x > p[0] && x < p[2] && z > p[1] && z < p[3]) return p[4]; return 'ground'; };
    // 一行一行地把相同种类的格子并成长条
    for (let j = 0; j < Z.length - 1; j++) {
      const z0 = Z[j], z1 = Z[j + 1], zc = (z0 + z1) / 2; let i = 0;
      while (i < X.length - 1) {
        const k = kindAt((X[i] + X[i + 1]) / 2, zc); let e = i + 1;
        while (e < X.length - 1 && kindAt((X[e] + X[e + 1]) / 2, zc) === k) e++;
        if (k) B.box('proto', X[i], -0.4, z0, X[e], 0, z1, { c: COL[k.split('|')[0]], mech: true, bottom: k.endsWith('|c') });
        i = e;
      }
    }
    // 边界墙（12 m，翻过去或者掉下去会被送回战区）
    B.box('proto', X0 - 1, 0, Z0 - 1, X0, 12, Z1 + 1, { c: COL.edge }); B.box('proto', X1, 0, Z0 - 1, X1 + 1, 12, Z1 + 1, { c: COL.edge });
    B.box('proto', X0, 0, Z0 - 1, X1, 12, Z0, { c: COL.edge }); B.box('proto', X0, 0, Z1, X1, 12, Z1 + 1, { c: COL.edge });
    // 城外：一圈沙地和远山（只渲染）。沙地分成边界墙外的四条，不铺进场地里（铺进来会盖住 3 m 深的旱渠）
    const hgt = (x, z) => { const d = Math.max(Math.abs(x) - 64, Math.abs(z) - 80, 0); return -0.3 + Math.min(1, d / 200) * (4 + 10 * Math.abs(Math.sin(x * 0.011) * Math.cos(z * 0.009))); };
    for (const [x0, z0, x1, z1] of [[-600, -600, 600, Z0 - 1], [-600, Z1 + 1, 600, 600], [-600, Z0 - 1, X0 - 1, Z1 + 1], [X1 + 1, Z0 - 1, 600, Z1 + 1]]) {
      const w = x1 - x0, h = z1 - z0, g = new THREE.PlaneGeometry(w, h, Math.max(1, Math.round(w / 40)), Math.max(1, Math.round(h / 40))); g.rotateX(-Math.PI / 2); g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
      const pos = g.attributes.position; for (let i = 0; i < pos.count; i++) pos.setY(i, hgt(pos.getX(i), pos.getZ(i)));
      g.computeVertexNormals(); B.addGeo('terrain', g, new THREE.Matrix4(), { uv: 'world', rays: 0, a: 0.05 });
    }
    const { rr } = K;
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * 6.28 + rr(-0.15, 0.15), dd = rr(420, 600), x = Math.cos(a) * dd, z = Math.sin(a) * dd, r = rr(50, 110), h = rr(60, 120); let y = 2, rad = r;
      for (let k = 0; k < 3; k++) { const hh = h * [0.42, 0.33, 0.25][k]; let gg = new THREE.CylinderGeometry(rad * rr(0.78, 0.9), rad, hh, 11, 2); gg = gg.toNonIndexed(); gg.computeVertexNormals(); B.addGeo('rock', gg, M4(x, y + hh / 2, z, 0, k * 0.7, 0), { uv: 'world', ts: 40, rays: 0, c: [0.92, 0.8, 0.7] }); y += hh; rad *= rr(0.6, 0.78); }
    }
  }

  // ====================== 玩法数据 ======================
  const both = (list) => list.flatMap((p) => [p, [p[0], -p[1], ...p.slice(2)]]);
  L.friendlyPods = [[0, 66], [-14, 70], [14, 70], [-43, 70], [40, 52], [58, 64], [-56, 64], [-30, 58]];
  L.enemyPods = L.friendlyPods.map((p) => [p[0], -p[1]]);
  L.respawns = [[0, 70], [-14, 72], [14, 72], [-43, 72], [44, 60]];
  L.combatPoints = [
    ...both([[-43, 8], [-43, 30], [-43, 46], [-56, 20], [-56, 40]]).map((p) => [...p, 'W']), [-56, 0, 'W'], [-43, 0, 'W'],
    ...both([[0, 14], [0, 30], [-6, 42], [-20, 4], [20, 12]]).map((p) => [...p, 'M']), [0, 0, 'M'],
    ...both([[38, 19], [58, 20], [41, 36], [24, 36], [47, 5]]).map((p) => [...p, 'E']), [38, 0, 'E'], [58, 0, 'E'],
    ...both([[-22, 16], [-22, 34], [18, 30], [-31, 9.5]]).map((p) => [...p, 'C']),
  ];
  L.nests = [[-56, 4.5, -30], [-56, 4.5, 0], [-22, 4.5, -51], [12, 4.5, -51], [41, 8.4, -36], [38, 9.4, -6]];
  L.dustVolumes = [[26.4, 0, -11.6, 49.6, 8.6, 11.6, 5], [28.4, 0, 26.4, 53.6, 7.6, 45.6, 5], [28.4, 0, -45.6, 53.6, 7.6, -26.4, 5], [-27.6, 0, 24.4, -16.4, 3.9, 43.6, 6], [-27.6, 0, -43.6, -16.4, 3.9, -24.4, 6],
    [-36, -3, 8, -25, -0.4, 11, 7], [-36, -3, -11, -25, -0.4, -8, 7], [-50, -3, -4, -36, -0.6, 4, 6]];
  L.menuCam = { x: -4, y: 34, z: 0, rx: 92, rz: 104, dy: 6, look: [-2, 2, 0] };
  L.flyover = [
    { from: [-96, 52, 74], to: [-30, 32, 24], look: [0, 4, 0], t: 4.4 },
    { from: [26, 20, 92], to: [4, 5.6, 79], look: [0, 1.6, 60], t: 3.4 },
  ];
  return L;
}

// 导航网格建好之后：机甲投放点从机甲能走的露天格子里挑；空降点、交战点挪到最近的可走格
export function finishRefinery(L, nav) {
  const fix = (p, r = 6) => { if (nav.walkable(p[0], p[1])) return p; const i = nav.nearestIn(p[0], p[1], nav.ok, r); return i >= 0 ? [nav.cx(i), nav.cz(i), ...p.slice(2)] : null; };
  L.friendlyPods = L.friendlyPods.map((p) => fix(p)).filter(Boolean); L.enemyPods = L.enemyPods.map((p) => fix(p)).filter(Boolean);
  L.respawns = L.respawns.map((p) => fix(p)).filter(Boolean); L.combatPoints = L.combatPoints.map((p) => fix(p)).filter(Boolean);
  const cand = []; for (let k = 0; k < nav.mechList.length; k += 3) { const i = nav.mechList[k]; if (nav.sky[i] >= 0.9 && nav.cz(i) > 0) cand.push([nav.cx(i), nav.cz(i)]); }
  const out = []; while (out.length < 5 && cand.length) { let best = null, bd = -1; for (const c of cand) { let d = 1e9; for (const o of out) d = Math.min(d, Math.hypot(o[0] - c[0], o[1] - c[1])); if (!out.length) d = c[1]; if (d > bd) { bd = d; best = c; } } if (!best || (out.length && bd < 14)) break; out.push(best); }
  L.mechDrops = out.flatMap((p) => [p, [p[0], -p[1]]]);
  return L;
}
