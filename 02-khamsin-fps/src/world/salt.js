// 第六张地图「盐井镇」——三路两点的攻防灰盒（手工逐块摆的，不是程序生成）。
//
// 拆的是经典三路两点攻防图「为什么好玩」的通用原则，平面布局是原创的，不照搬任何一张现成地图：
//   · 三条路各有一种打法：东路「盐田」开阔、远距离对枪，机甲走这里；中路「下街 → 井台 → 长阶 → 门楼」是枢纽；西路「矿道」地下窄巷近战
//   · 中路是枢纽：在井台分出「小道」（一条夹在楼之间的窄阶，直通 A 点侧面）和「澡堂」（穿过室内到 B 点东沿），所以实际是三路半
//   · 每个点位三四个入口，每条路在进点前都有一个咽喉：门楼的半开门和箭孔、盐仓的大门、矿道出口、B 北门的窄梯
//   · 时间差：防守方到 A 约 3 秒、到 B 约 7 秒；进攻方到中路门楼约 10 秒、到两个点 12–15 秒。防守方先到点，进攻方靠选路和换路
//   · 高度差不大但都有用：A 点在 +4 m 的台地上（进攻方得往上打），B 点是 −3.2 m 的下沉院子（防守方居高临下），门楼顶、A 平台、B 西台、风车塔是几个关键高点
//   · 每个角落都有名字（标注牌），说得出位置才配合得起来
// 本作的机动性另外留了路线：台地东面和南面的墙（蓝色）能蹬墙跑上去，屋顶连成一条中路上方的侧翼，风车塔叶片和盐仓屋顶能钩，一条滑索。
import * as THREE from 'three';
import { M4 } from './kit.js';
import { createBlockout, frame, hash } from './blockout.js';

export const SALT_NAME = '盐井镇';
export const SALT_BOUNDS = { x0: -63, x1: 63, z0: -80, z1: 78, cell: 0.5, radius: 0.4, step: 0.5, layers: 10 };

export const COL = {
  ground: [0.78, 0.68, 0.55],     // 地面
  road: [0.66, 0.64, 0.6],        // 街道
  terrace: [0.8, 0.74, 0.62],     // 台地（+4 m）
  floor2: [0.76, 0.76, 0.74],     // 楼板、屋面、平台
  wall: [0.88, 0.87, 0.84],       // 房屋体块
  run: [0.42, 0.64, 0.96],        // 蹬墙跑墙面
  cover: [0.96, 0.8, 0.32],       // 齐腰掩体
  cover2: [0.78, 0.66, 0.52],     // 高掩体：货箱、门板、矿车
  beam: [1.0, 0.48, 0.14],        // 钩爪点
  stair: [0.5, 0.82, 0.5],        // 楼梯、坡道
  low: [0.52, 0.58, 0.66],        // 下沉区：矿道、卤池、澡堂池子
  salt: [0.94, 0.94, 0.91],       // 盐田
  obj: [0.98, 0.84, 0.42],        // 地标：门楼、粮仓、风车塔
  siteA: [1.0, 0.66, 0.38],       // A 点地面
  siteB: [0.98, 0.56, 0.62],      // B 点地面
  spawnF: [0.46, 0.8, 0.9],       // 我方出生区（进攻）
  spawnE: [0.94, 0.48, 0.42],     // 敌方出生区（防守）
  edge: [0.5, 0.48, 0.47],        // 镇子外围
  dark: [0.07, 0.07, 0.08],
};
export const LEGEND = [
  ['siteA', 'A 点（台地 +4 m）'], ['siteB', 'B 点（下沉院 −3.2 m）'], ['road', '街道'], ['ground', '地面'], ['wall', '房屋体块'], ['run', '蹬墙跑墙面'], ['cover', '齐腰掩体'], ['cover2', '高掩体 / 门板'],
  ['beam', '钩爪点'], ['stair', '楼梯 / 坡道'], ['low', '矿道 / 卤池（低层）'], ['salt', '盐田'], ['obj', '地标：门楼、粮仓、风车塔'], ['spawnF', '我方出生区（进攻）'], ['spawnE', '敌方出生区（防守）'],
];

const FLOOR_B = -3.2, TER = 4;   // B 院和矿道的地面、台地高度

export function buildSalt(B, K) {
  const O = createBlockout(B, COL);
  const L = {
    name: SALT_NAME, proto: true, colors: COL, legend: LEGEND,
    playerSpawn: { x: 0, y: 0.1, z: 64, yaw: 0 },
    friendlyPods: [], enemyPods: [], mechDrops: [], nests: [], combatPoints: [], respawns: [],
    zones: { A: { x: 10, z: -38, r: 12 }, B: { x: -43, z: -31, r: 10 } },
    ziplines: [], shafts: [], smokes: [], flyover: [], dustVolumes: [], labels: [],
    oob: { x0: -61, x1: 61, z0: -79, z1: 77, y0: -9 },
    droneSpawn: { x0: -20, x1: 30, z: -70 },
  };
  const label = (text, x, y, z, o = {}) => L.labels.push({ text, x, y, z, ...o });
  const box = (k, x0, y0, z0, x1, y1, z1, o = {}) => O.abox(k, x0, y0, z0, x1, y1, z1, { mech: true, ...o });
  const lamp = (x, y, z, power = 28, radius = 10) => { B.box('proto', x - 0.4, y - 0.08, z - 0.14, x + 0.4, y, z + 0.14, { c: COL.wall, collide: false, rays: 0, bottom: true }); B.box('emissive', x - 0.35, y - 0.1, z - 0.1, x + 0.35, y - 0.08, z + 0.1, { c: [1.5, 1.42, 1.25], collide: false, rays: 0, bottom: true }); B.light(x, y - 0.4, z, [1.0, 0.86, 0.66], power, radius); };
  // 轴向的楼梯：dir = 'N'(-z) / 'S'(+z) / 'E'(+x) / 'W'(-x) 是往上走的方向；(x, z) 是最低一级的中点
  const ANG = { S: 0, E: Math.PI / 2, N: Math.PI, W: -Math.PI / 2 };
  const stairs = (x, z, dir, y0, rise, run, w, o = {}) => O.stairs('stair', frame(x, z, ANG[dir]), 0, 0, y0, rise, run, w, o);
  // 沿 x 或 z 的墙，holes = [[中心, 宽, 下沿, 上沿]]（中心是世界坐标，高度相对 y0）
  const wallX = (k, x0, x1, z, y0, y1, t, holes = []) => O.wall(k, frame(0, 0, 0), x0, z, x1, z, y0, y1, t, holes.map(([c, w, a, b]) => [c - x0, w, a, b]));
  const wallZ = (k, z0, z1, x, y0, y1, t, holes = []) => O.wall(k, frame(0, 0, 0), x, z0, x, z1, y0, y1, t, holes.map(([c, w, a, b]) => [c - z0, w, a, b]));
  // 拱门：墙在 [a0, a1] 上，中间 c 处开一个宽 w 的拱（拱脚高 spring），墙高 h，厚 t。alongX：墙沿 x 走（固定 z = fixed）
  const archWall = (k, alongX, fixed, a0, a1, y0, h, t, c, w, spring) => {
    // 拱上那块墙用挤出体：本地 x 沿墙走（沿 z 的墙转 −90°），本地 z 是墙厚
    const F = alongX ? { ...frame(0, 0, 0), z: fixed } : frame(fixed, 0, -Math.PI / 2);
    if (alongX) { box(k, a0, y0, fixed - t / 2, c - w / 2, h, fixed + t / 2); box(k, c + w / 2, y0, fixed - t / 2, a1, h, fixed + t / 2); }
    else { box(k, fixed - t / 2, y0, a0, fixed + t / 2, h, c - w / 2); box(k, fixed - t / 2, y0, c + w / 2, fixed + t / 2, h, a1); }
    O.extrude(k, F, [...O.arc(c, w / 2, spring), [c + w / 2, h], [c - w / 2, h]], t);
  };

  // 房子：先登记，最后统一「拆栋、错高、加门窗阳台雨棚」（见文件末尾的 dress）。o.keep：只许加高不许变矮（挡出生区视线的那几栋）
  const BLD = []; const bld = (x0, z0, x1, z1, h, o = {}) => BLD.push({ x0, z0, x1, z1, h, o });

  // ====================== 地面：0.5 m 的格子上一块块「涂」高度和颜色，再合并成尽量大的方块 ======================
  const CS = 0.5, GX0 = -66, GZ0 = -82, GW = 264, GH = 320; const KINDS = Object.keys(COL);
  const gh = new Float32Array(GW * GH), gk = new Uint8Array(GW * GH).fill(255);
  const paint = (kind, h, x0, z0, x1, z1) => {
    const k = KINDS.indexOf(kind); const i0 = Math.max(0, Math.round((x0 - GX0) / CS)), i1 = Math.min(GW, Math.round((x1 - GX0) / CS)), j0 = Math.max(0, Math.round((z0 - GZ0) / CS)), j1 = Math.min(GH, Math.round((z1 - GZ0) / CS));
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) { gh[j * GW + i] = h; gk[j * GW + i] = k; }
  };
  paint('ground', 0, -66, -82, 66, 80);
  // 街道（颜色）
  paint('road', 0, -6, 12, 6, 56); paint('road', 0, -14, -2, 20, 12);                       // 下街、井台
  paint('road', 0, -42, 34, -30, 62); paint('road', 0, -60, 34, -30, 38); paint('road', 0, -30, 52, -18, 60);   // 西街、西口
  paint('road', 0, -60, -16, -52, 38);                                                       // 上巷
  paint('road', 0, 26, 46, 42, 62); paint('road', 0, 18, 52, 30, 62);                       // 东街、东口
  paint('road', 0, -30, 32, -6, 35); paint('road', 0, 6, 30, 26, 33);                        // 横巷、东巷
  paint('road', 0, -44, -57, -12, -50); paint('road', 0, -32, -50, -24, -8);                 // 后巷、B 东沿
  paint('road', 0, 14, -2, 17, 0);                                                           // 小道入口
  // 出生区
  paint('spawnF', 0, -18, 56, 18, 76);
  // 台地（+4）：A 点、门楼街、小道上段、东坡顶、防守方出生区
  paint('terrace', TER, -12, -80, 28, -25); paint('road', TER, -4, -25, 4, -14); paint('road', TER, 14, -25, 17, -7);
  paint('terrace', TER, 28, -48, 36, -39);
  paint('siteA', TER, -10, -50, 26, -25);
  paint('spawnE', TER, -12, -80, 28, -58);
  // 下沉区
  paint('siteB', FLOOR_B, -53, -44, -32, -18);                                               // B 院
  paint('low', FLOOR_B, -48, -18, -42, 34); paint('low', FLOOR_B, -52, 0, -42, 10);         // 矿道、矿室、矿口坡道
  paint('low', FLOOR_B, -42, -50, -38, -44);                                                 // B 北门的梯井
  paint('floor2', 1.5, -60, -44, -53, -18);                                                  // B 西台
  paint('low', -2.5, 44, -40, 54, -28);                                                      // 卤池
  paint('low', -1.2, 26, 4, 28.5, 46);                                                       // 盐渠
  paint('low', -1.2, -30, -2, -24, 6);                                                       // 澡堂的池子
  for (const [x0, z0, x1, z1] of [[28, 34, 38, 44], [47, 26, 57, 38], [28, 12, 38, 24], [47, 2, 57, 14]]) paint('salt', -0.35, x0, z0, x1, z1);   // 盐田
  // 合并：先横向连成段，再往下长成矩形
  {
    const used = new Uint8Array(GW * GH);
    for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
      const id = j * GW + i; if (used[id] || gk[id] === 255) continue; const k = gk[id], h = gh[id];
      let i1 = i; while (i1 + 1 < GW && !used[j * GW + i1 + 1] && gk[j * GW + i1 + 1] === k && gh[j * GW + i1 + 1] === h) i1++;
      let j1 = j; for (;;) { const jj = j1 + 1; if (jj >= GH) break; let ok = true; for (let q = i; q <= i1; q++) { const c = jj * GW + q; if (used[c] || gk[c] !== k || gh[c] !== h) { ok = false; break; } } if (!ok) break; j1 = jj; }
      for (let jj = j; jj <= j1; jj++) for (let q = i; q <= i1; q++) used[jj * GW + q] = 1;
      B.box('proto', GX0 + i * CS, -4.6, GZ0 + j * CS, GX0 + (i1 + 1) * CS, h, GZ0 + (j1 + 1) * CS, { c: COL[KINDS[k]], mech: true });
    }
  }
  // 台地的南墙、东墙贴一层蓝色（能蹬墙跑上去）
  O.abox('run', 17, 0, -25, 28, TER, -24.94, { collide: false, rays: 20 }); O.abox('run', 28, 0, -39, 28.06, TER, -25, { collide: false }); O.abox('run', 28, 0, -80, 28.06, TER, -48, { collide: false });

  // ====================== 镇子外围（边界）：一圈高矮不一的房子，外面是沙丘 ======================
  box('edge', -66, 0, -82, -60, 11, 80); box('edge', 60, 0, -82, 66, 11, 80); box('edge', -60, 0, -82, 60, 11, -78); box('edge', -60, 0, 76, 60, 11, 80);
  for (const [x0, z0, x1, z1, h] of [[-60, 62, -30, 76, 7], [-60, 50, -42, 62, 6], [-60, 38, -46, 48, 8], [30, 62, 42, 76, 6], [42, 48, 60, 76, 7], [-60, -78, -40, -57, 9], [-40, -78, -12, -57, 8], [28, -78, 37, -60, 7], [37, -78, 60, -60, 9], [-58, -50, -42, -44, 6]]) bld(x0, z0, x1, z1, h);
  bld(-46, 38, -42, 48, 4.5, { min: 4 });   // 西街边的矮屋（凹进去一块，能躲）
  archWall('wall', true, 52, -42, -30, 0, 6.5, 1.0, -36, 5, 2.8); label('西街门', -36, 8.4, 52);   // 西街的拱门

  // ====================== 我方出生区（南，进攻方）：三个出口，北门里有影壁 ======================
  bld(-30, 60, -18, 76, 6, { keep: true }); bld(18, 62, 30, 76, 6, { keep: true });
  wallX('wall', -18, 18, 56, 0, 5.5, 1.0, [[0, 6, 0, 4.2]]);                     // 出生区北墙：中门 6 m
  box('wall', -5, 0, 59, 5, 3.2, 59.8);                                         // 三个门里各一道影壁：挡住从外面看进出生区
  box('wall', -15.5, 0, 57, -14.7, 3.2, 60.5); box('wall', 14.7, 0, 57, 15.5, 3.2, 61.5);
  box('floor2', -10, 4.4, 66, 10, 4.8, 74, { bottom: true }); for (const x of [-9.6, 9.2]) for (const z of [66.2, 73.4]) box('beam', x, 0, z, x + 0.4, 4.4, z + 0.4);
  box('cover', -14, 0, 62, -10, 1.1, 63); box('cover', 11, 0, 61, 15, 1.1, 62);
  label('我方出生区（进攻）', 0, 7, 70, { big: true });

  // ====================== 中路：下街 → 井台 → 长阶 → 门楼 ======================
  bld(-30, 35, -6, 52, 7); bld(-32, 12, -6, 32, 6);     // 西屋（横巷两边）
  bld(6, 33, 26, 52, 6); bld(6, 12, 26, 30, 7);         // 东屋（东巷两边）
  bld(-6, 42, -3, 47, 6.5, { min: 5 }); bld(3, 22, 6, 28, 7, { min: 5 });   // 下街两侧各凸出来一个墙角：街在这里收窄、错开，留出卡位的角落
  // 过街楼：横跨下街的一座廊桥（钩爪 / 二段跳能上去，也是下街的地标）
  box('floor2', -6, 7.0, 35.4, 6, 7.7, 38.2, { bottom: true, mech: false }); box('cover', -6, 7.7, 35.4, 6, 8.6, 35.7, { mech: false }); box('cover', -6, 7.7, 37.9, 6, 8.6, 38.2, { mech: false }); label('过街楼', 0, 10.4, 36.8);
  O.abox('run', -6, 0, 14, -5.94, 6, 31.5, { collide: false }); O.abox('run', 5.94, 0, 33.5, 6, 6, 51.5, { collide: false });   // 下街两侧各一段长墙（蹬墙跑）
  box('cover2', -3, 0, 38, 0, 2.0, 42); box('cover', 1.5, 0, 24, 4.5, 1.1, 25); box('cover', -4.5, 0, 17, -1.5, 1.1, 18);   // 下街上的推车、矮墙
  label('下街', 0, 9, 40); label('横巷', -18, 4.6, 33.5); label('东巷', 16, 4.6, 31.5);
  // 井台：中路的枢纽，三个方向分出去（长阶 → 门楼、小道 → A、澡堂 → B），东面一道拱门通盐田
  K.cyl('proto', -5, 0, 5, 1.4, 1.1, { c: COL.cover, collide: true, seg: 14, ts: 4, rays: 12 });
  box('cover', 4, 0, 6, 9, 0.8, 10); box('cover2', -12, 0, 9, -10, 1.8, 11);
  archWall('wall', false, 20, -2, 12, 0, 6, 1.0, 5.5, 5, 2.6);                   // 拱门（井台 ↔ 盐田）
  label('井台', 0, 4.5, 4); label('拱门', 20, 7.4, 5.5);
  // 长阶两边的楼、长阶、门楼街
  bld(-14, -22, -4, -2, 8, { keep: true }); bld(4, -22, 14, -2, 8, { keep: true });
  stairs(0, -2, 'N', 0, TER, 12, 8);
  label('长阶', 0, 6.5, -8);
  // 门楼：台地南墙上的一道门，一扇门板关着、一扇敞开（能过 2 m 宽），两边各一道箭孔；楼顶（+7.6）是防守方看长阶的高点，A 点那侧有楼梯上去
  wallX('obj', -14, 14, -23.5, 0, 7.6, 3, [[0, 3.6, 4.0, 7.0], [-3, 0.3, 5.0, 6.4], [3, 0.3, 5.0, 6.4]]);
  box('cover2', -1.8, TER, -23.6, -0.2, 7.0, -23.4); box('cover2', 1.6, TER, -26.6, 1.8, 7.0, -25);   // 门板
  for (const [a, b] of [[-14, -9], [-7.5, -4.5], [-2.5, 2.5], [4.5, 7.5], [9, 14]]) box('cover', a, 7.6, -22.4, b, 8.6, -22);
  stairs(-11, -31, 'S', TER, 3.6, 6, 2.2);
  lamp(0, 6.95, -23.5, 18, 6);
  label('门楼', 0, 11, -23.5, { big: true }); label('门楼顶', -9, 9.6, -23.5);
  // 小道：长阶东楼和盐仓之间一条窄阶，从井台直上 A 点东南角
  stairs(15.5, 0, 'N', 0, TER, 7, 3);
  label('小道', 15.5, 8.5, -14);

  // ====================== A 点：台地上的粮仓院 ======================
  // 粮仓：圆筒 + 尖顶（尖顶太陡站不住，不会变成看进防守方出生区的狙位）
  for (const [x, z, r, h] of [[2, -40, 2.6, 5.5], [9.5, -45.5, 2.1, 4.8]]) { K.cyl('proto', x, TER, z, r, h, { c: COL.obj, collide: true, mech: true, seg: 22, ts: 4, rays: 20 }); K.cyl('proto', x, TER + h, z, r + 0.15, r * 1.5, { rt: 0.15, c: COL.obj, collide: true, mech: true, seg: 22, ts: 4, rays: 20 }); }
  box('floor2', 13, TER, -45, 22, TER + 1.4, -35); stairs(10.6, -40, 'E', TER, 1.4, 2.4, 3);   // A 平台（东边留 6 m 让机甲从东坡上来）
  box('cover2', 15, TER + 1.4, -43.5, 17.5, TER + 2.8, -41); box('cover', 18, TER + 1.4, -36, 21.5, TER + 2.4, -35);
  box('cover', -7, TER, -31, -2.5, TER + 1.1, -30); box('cover2', 5, TER, -31, 7.5, TER + 2.2, -28.5); box('cover2', -9, TER, -44, -6.5, TER + 2.2, -41.5); box('cover', 20, TER, -29, 23, TER + 1.1, -28);
  label('A 点 · 粮仓台', 9, TER + 9.5, -38, { big: true }); label('A 平台', 17.5, TER + 4.2, -40); label('粮仓', 2, TER + 10.6, -40);
  // 防守方出生区：台地北头，一道带三个门洞的墙和 A 点隔开
  wallX('wall', -12, 28, -57, TER, TER + 4.5, 1.2, [[-4, 3.6, 0, 3.2], [8, 3.6, 0, 3.2], [20, 3.6, 0, 3.2]]);
  for (const x of [-4, 8, 20]) box('wall', x - 2.6, TER, -60.4, x + 2.6, TER + 3.2, -59.6);   // 门里的影壁
  box('floor2', -8, TER + 4.4, -76, 20, TER + 4.8, -66, { bottom: true }); for (const x of [-7.6, 19.2]) for (const z of [-75.6, -66.4]) box('beam', x, TER, z, x + 0.4, TER + 4.4, z + 0.4);
  label('敌方出生区（防守）', 6, TER + 7, -70, { big: true });
  stairs(-19, -53, 'E', 0, TER, 7, 4);     // CT 西梯：台地 → 后巷
  stairs(35, -52, 'W', 0, TER, 7, 4);      // CT 东梯：台地 → 仓北
  label('西梯', -15, 6.5, -53); label('东梯', 31.5, 6.5, -52);

  // ====================== 东路：东街 → 盐田 → 盐仓大门 → 卤池 → 东坡上 A ======================
  // 盐田：四块下沉 0.35 m 的盐池，池埂是一道道齐腰掩体（中间留缺口）
  for (const [x0, z0, x1, z1] of [[28, 34, 38, 44], [47, 26, 57, 38], [28, 12, 38, 24], [47, 2, 57, 14]]) {
    box('cover', x0, -0.35, z0 - 0.4, (x0 + x1) / 2 - 1, 0.65, z0); box('cover', (x0 + x1) / 2 + 1.5, -0.35, z0 - 0.4, x1, 0.65, z0);
    box('cover', x0 - 0.4, -0.35, z0 + 2, x0, 0.65, z1 - 2);
  }
  for (const [x, z, s, i] of [[33, 29, 1.4, 1], [53, 44, 1.6, 2], [32, 6, 1.3, 3], [57.5, 20, 1.2, 4]]) O.rock(x, s * 0.4, z, s * 1.6, s * 1.1, s * 1.4, i, i * 7, { kind: 'salt' });
  // 风车塔：东路中段的高点（钩叶片或者坐滑索上去）
  box('obj', 48, 0, 18, 52, 8.6, 22); for (const [a, b, c, d] of [[48, 18, 52, 18.3], [48, 21.7, 52, 22], [48, 18.3, 48.3, 21.7], [51.7, 18.3, 52, 21.7]]) box('cover', a, 8.6, b, c, 9.6, d);
  for (const r of [0.785, -0.785]) B.obox('proto', 50, 11.2, 17.5, 0.45, 9, 0.3, [0, 0, r], { c: COL.beam, mech: false });
  label('盐田', 40, 4, 30, { big: true }); label('风车塔', 50, 13.5, 20); label('盐渠', 27.2, 2.2, 24); label('东街', 36, 4, 54);
  // 盐仓：东路尽头的大仓库，中间一条 8 m 宽、7.5 m 高的大门穿过去（机甲也能过），两侧是仓厅，后面绕一条窄巷
  {
    const z0 = -2, z1 = -20, top = 9;
    wallX('wall', 17, 56, z0, 0, top, 0.5, [[41, 8, 0, 7.5], [24, 2.4, 1.2, 2.4], [31, 2.4, 1.2, 2.4], [50, 2.4, 1.2, 2.4]]);
    wallX('wall', 17, 56, z1, 0, top, 0.5, [[41, 8, 0, 7.5], [25.5, 2.2, 0, 2.7], [51, 2.2, 0, 2.7]]);
    wallZ('wall', z1, z0, 17.25, 0, top, 0.5); wallZ('wall', z1, z0, 55.75, 0, top, 0.5, [[-11, 2.2, 0, 2.7]]);
    wallZ('wall', z1, z0, 37, 0, top, 0.5, [[-12, 2, 0, 2.6]]); wallZ('wall', z1, z0, 45, 0, top, 0.5, [[-8, 2, 0, 2.6]]);
    box('floor2', 17, top, z1, 56, top + 0.4, z0, { bottom: true });
    for (const x of [22, 30, 52]) box('beam', x - 0.2, top - 1.2, z1 + 0.3, x + 0.2, top - 0.8, z0 - 0.3, { mech: false });   // 屋架（钩爪）
    box('cover2', 20, 0, -16, 23, 2.4, -12); box('cover2', 31, 0, -8, 34, 1.6, -5); box('cover', 26, 0, -14, 29, 1.1, -13); box('cover2', 48, 0, -15, 51, 2.4, -12); box('cover', 52, 0, -7, 54.5, 1.1, -6);
    for (const [x, z] of [[27, -11], [41, -6], [41, -16], [50, -11]]) lamp(x, top - 0.05, z, 26, 9);
    L.dustVolumes.push([17.5, 0, -19.5, 37, 9, -2.5, 5], [45, 0, -19.5, 55.5, 9, -2.5, 5], [37, 0, -19.5, 45, 7.5, -2.5, 3]);
    label('盐仓', 36, 12, -11, { big: true }); label('仓门', 41, 9, -1); label('仓后巷', 58, 4, -11);
  }
  // 仓北：卤池（下沉 2.5 m，防守方能蹲在里面）、东坡（8 m 宽的坡道上 A 点，机甲能走）
  O.slab('stair', [[28, 0, -25], [36, 0, -25], [36, TER, -39], [28, TER, -39]], 0, { mech: true });   // 坡脚离仓库北墙 5 m：机甲出了大门能转上来
  stairs(51.5, -36, 'N', -2.5, 2.5, 4, 3);
  box('cover', 44, 0, -27.6, 50, 0.9, -27.2); box('cover2', 33, TER, -44.5, 35.5, TER + 1.8, -42);
  K.cyl('proto', 57, 0, -33, 2.2, 3.4, { c: COL.cover2, collide: true, mech: true, seg: 18, ts: 4, rays: 12 }); K.cyl('proto', 56, 0, -48, 2.4, 4.2, { c: COL.cover2, collide: true, mech: true, seg: 18, ts: 4, rays: 12 });
  bld(44, -58, 56, -50, 5);
  label('卤池', 49, 2.5, -34); label('东坡', 32, 6.5, -31); label('仓北', 46, 4, -44);

  // ====================== 西路：西街 → 矿口 → 矿道（地下）/ 上巷（地面）→ B 点 ======================
  // 矿口：小屋里一条坡道下到 −3.2 m 的矿道
  wallX('wall', -50, -40, 34, 0, 5, 0.5, [[-45, 6, 0, 3.6]]); wallZ('wall', 22, 34, -49.75, 0, 5, 0.5); wallZ('wall', 22, 34, -40.25, 0, 5, 0.5); wallX('wall', -50, -40, 22.25, 0, 5, 0.5);
  box('floor2', -50, 5, 22, -40, 5.4, 34, { bottom: true });
  O.slab('stair', [[-48, 0, 34], [-42, 0, 34], [-42, FLOOR_B, 26], [-48, FLOOR_B, 26]], FLOOR_B);
  // 矿道顶（地面层），中段的矿室和竖井：竖井口在上巷边一个小院里，能从上巷跳下去，也能从矿室二段跳 + 攀上来
  const ceil = (x0, z0, x1, z1) => box('ground', x0, -0.5, z0, x1, 0, z1, { bottom: true });
  ceil(-48, -18, -42, 0); ceil(-48, 10, -42, 22); ceil(-52, 0, -42, 4); ceil(-52, 7, -42, 10); ceil(-48, 4, -42, 7);
  // 矿工屋（压在矿道上面）：留出竖井上方的小院
  bld(-47, -2, -32, 22, 6); bld(-52, 8, -47, 22, 6); bld(-52, -2, -47, 1, 5);
  bld(-52, -18, -32, -2, 5, { keep: true });
  // 矿道里的矿车、枕木
  box('cover2', -47.5, FLOOR_B, 14, -45.5, FLOOR_B + 1.4, 17); box('cover2', -44.5, FLOOR_B, -6, -42.5, FLOOR_B + 1.4, -3); box('cover2', -51.5, FLOOR_B, 1, -49, FLOOR_B + 1.2, 3.5);
  for (let z = 20; z > -16; z -= 2.5) O.abox('beam', -46.6, FLOOR_B, z, -43.4, FLOOR_B + 0.08, z + 0.3, { collide: false, rays: 0 });
  for (const z of [16, 5, -8]) lamp(-45, -0.55, z, 22, 8); lamp(-45, 4.95, 28, 18, 7);
  L.dustVolumes.push([-52, FLOOR_B, -18, -42, -0.5, 22, 8], [-49.5, FLOOR_B, 22.5, -40.5, 5, 33.5, 6]);
  label('矿口', -45, 7, 30); label('矿道', -45, 1.2, 12); label('矿室', -48, 1.2, 5); label('竖井', -50, 2.4, 5.5); label('西街', -36, 4, 48); label('上巷', -56, 4, 14);

  // ====================== B 点：下沉的染坊院 ======================
  // B 西台（+1.5）：上巷尽头上去，沿 B 院西边一长条，能俯视院子；北头有梯子下到院里
  stairs(-57, -13, 'N', 0, 1.5, 5, 4);
  for (const [a, b] of [[-42, -36], [-33, -26], [-23, -19]]) box('cover', -53.4, 1.5, a, -53, 2.5, b);
  stairs(-45.5, -42, 'W', FLOOR_B, 1.5 - FLOOR_B, 7.5, 3.2);
  // B 东沿（0 m）：澡堂出来沿 B 院东边的一条走廊，矮墙有缺口，中段有梯子下院
  for (const [a, b] of [[-44, -38], [-34, -27], [-20, -18]]) box('cover', -32.4, 0, a, -32, 1.0, b);
  stairs(-37.5, -24, 'E', FLOOR_B, -FLOOR_B, 5.5, 4);
  // B 北门：后巷往南下一道窄梯进院
  stairs(-40, -44, 'N', FLOOR_B, -FLOOR_B, 6, 4);
  // 院里：染缸（齐腰）、染台、一根石柱
  for (const [x, z] of [[-48.5, -23.5], [-43.5, -26.5], [-37.5, -21.5], [-47, -36.5], [-37, -34.5], [-42, -40.5]]) K.cyl('proto', x, FLOOR_B, z, 1.5, 1.2, { c: COL.cover, collide: true, seg: 16, ts: 4, rays: 12 });
  box('cover2', -41, FLOOR_B, -31, -37, FLOOR_B + 1.0, -29); box('wall', -45, FLOOR_B, -33, -43, FLOOR_B + 4.5, -31);
  for (const [x, z] of [[-46, -30], [-36, -28]]) box('beam', x - 0.1, FLOOR_B, z - 0.1, x + 0.1, 1.8, z + 0.1, { mech: false });
  B.box('proto', -46, 1.7, -30.05, -36, 1.8, -27.95, { c: COL.beam, collide: false });   // 晾布的横杆（钩爪）
  label('B 点 · 染坊院', -43, 6.5, -31, { big: true }); label('B 西台', -56.5, 4.6, -30); label('B 东沿', -28, 3.4, -34); label('B 北门', -40, 2.8, -48); label('下矿口', -45, -0.5, -16.5);

  // ====================== 澡堂：中路井台 ↔ B 东沿的室内连接，两个厅、一个下沉的池子 ======================
  {
    const y1 = 7;
    wallX('wall', -32, -14, -7.75, 0, y1, 0.5, [[-29, 2.6, 0, 2.8]]);                         // 北墙：门 → B 东沿
    wallZ('wall', -7.5, 11.5, -14.25, 0, y1, 0.5, [[3.8, 3.0, 0, 2.8], [9, 2, 1.2, 2.4]]);     // 东墙：门 → 井台
    wallZ('wall', -7.5, 11.5, -22, 0, y1, 0.4, [[-5, 2.2, 0, 2.7], [7.5, 2.2, 0, 2.7]]);       // 隔墙
    box('floor2', -32, y1, -8, -14, y1 + 0.4, 12, { bottom: true });
    for (const [x, z] of [[-30, -5], [-30, 9], [-24, 9]]) box('wall', x - 0.4, 0, z - 0.4, x + 0.4, y1, z + 0.4);
    box('cover', -20, 0, 0, -17, 1.1, 1);
    lamp(-27, y1 - 0.05, 2, 22, 8); lamp(-18, y1 - 0.05, 4, 18, 7);
    L.dustVolumes.push([-31.5, -1.2, -7.5, -14.5, 7, 11.5, 6]);
    label('澡堂', -23, 9.6, 2); label('池厅', -27, 2.8, 2);
  }
  // 后巷：防守方从西梯下来，沿后巷去 B 北门；B 东沿北头也通到这里
  label('后巷', -28, 3.2, -53.5);
  bld(-24, -46, -12, -22, 8); bld(-24, -22, -14, -8, 7);          // 中西楼、阶西后屋
  box('cover2', -36, 0, -55, -33.5, 2.2, -52.5); box('cover', -22, 0, -51, -19.5, 1.1, -50.2);

  // ====================== 屋顶侧翼、滑索 ======================
  // 东屋屋顶 → 风车塔顶的滑索；澡堂屋顶（7）→ 长阶西楼屋顶（8）→ 门楼顶（7.6）是一条从中路上方摸到 A 点的屋顶路线
  { const a = [20, 6 + 2.3, 42], b = [50, 8.6 + 2.3, 20.2]; K.cable(a, b, 0.5, 0.03); L.ziplines.push({ a, b }); for (const p of [a, b]) K.tube('steel', [p[0], p[1] - 2.3, p[2]], [p[0], p[1] + 0.15, p[2]], 0.05); }

  // ====================== 镇外：沙丘和远山（只渲染）======================
  {
    const hgt = (x, z) => { const d = Math.max(Math.abs(x) - 66, Math.abs(z) - 82, 0); return -0.3 + Math.min(1, d / 60) * (6 + 8 * Math.abs(Math.sin(x * 0.021) * Math.cos(z * 0.017))) + d * 0.02; };
    for (const [x0, z0, x1, z1] of [[-700, -700, 700, -82], [-700, 80, 700, 700], [-700, -82, -66, 80], [66, -82, 700, 80]]) O.farTerrain(hgt, x0, z0, x1, z1, 16, () => COL.ground);
    const { rr } = K;
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * 6.28 + rr(-0.15, 0.15), dd = rr(420, 600), x = Math.cos(a) * dd, z = Math.sin(a) * dd, r = rr(50, 110), h = rr(60, 120); let y = 2, rad = r;
      for (let k = 0; k < 3; k++) { const hh = h * [0.42, 0.33, 0.25][k]; let gg = new THREE.CylinderGeometry(rad * rr(0.78, 0.9), rad, hh, 11, 2); gg = gg.toNonIndexed(); gg.computeVertexNormals(); B.addGeo('rock', gg, M4(x, y + hh / 2, z, 0, k * 0.7, 0), { uv: 'world', ts: 40, rays: 0, c: [0.92, 0.8, 0.7] }); y += hh; rad *= rr(0.6, 0.78); }
    }
  }

  // ====================== 房子：拆栋、错高、加门窗 / 阳台 / 雨棚 / 屋顶小屋 ======================
  // 方正没关系，但一整块一个高度、一面墙光秃秃就显得「规矩」。这里把每块按长边拆成几栋，高度各不相同，朝街的墙面开门窗，
  // 有的二楼挑出阳台、门口搭雨棚（都能踩上去），屋顶有女儿墙、楼梯间、水箱——屋顶也就成了铁驭能跑的一层
  {
    const SOLID = [[17, -20, 56, -2], [-32, -8, -14, 12], [-50, 22, -40, 34], [-14, -25, 14, -22]];
    const ghAt = (x, z) => { const i = Math.floor((x - GX0) / CS), j = Math.floor((z - GZ0) / CS); if (i < 0 || j < 0 || i >= GW || j >= GH) return null; const k = j * GW + i; return gk[k] === 255 ? null : gh[k]; };
    const open = (x, z, y0) => { if (Math.abs(x) > 59.5 || z < -77.5 || z > 75.5) return false; for (const b of BLD) if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1) return false; for (const r of SOLID) if (x > r[0] && x < r[2] && z > r[1] && z < r[3]) return false; const g = ghAt(x, z); return g !== null && Math.abs(g - y0) < 0.6; };
    let sd = 1; const rnd = () => hash(sd++ * 1.618 + 0.37);
    const DARK = [0.2, 0.19, 0.18], CLOTH = [[0.78, 0.32, 0.22], [0.26, 0.46, 0.62], [0.82, 0.66, 0.3], [0.36, 0.56, 0.36]];
    const deco = (x0, y0, z0, x1, y1, z1, c, collide = false, rays = 0) => B.box('proto', x0, y0, z0, x1, y1, z1, { c, collide, rays, mech: false, bottom: true });
    for (const b of BLD) {
      const y0 = 0, lx = b.x1 - b.x0, lz = b.z1 - b.z0, alongX = lx >= lz, L0 = alongX ? lx : lz; const n = Math.max(1, Math.round(L0 / 8.5));
      const cuts = [0]; for (let i = 1; i < n; i++) cuts.push(L0 * i / n + (rnd() - 0.5) * 2); cuts.push(L0);
      for (let i = 0; i < n; i++) {
        const [px0, pz0, px1, pz1] = alongX ? [b.x0 + cuts[i], b.z0, b.x0 + cuts[i + 1], b.z1] : [b.x0, b.z0 + cuts[i], b.x1, b.z0 + cuts[i + 1]];
        const dh = b.o.keep ? [0, 0.8, 1.6][Math.floor(rnd() * 3)] : [-1.6, -0.8, 0, 0.8, 1.6, 2.6][Math.floor(rnd() * 6)];
        const h = Math.max(b.o.min || 4, b.h + dh), tone = 0.93 + rnd() * 0.1, wc = COL.wall.map((v) => Math.min(1, v * tone));
        B.box('proto', px0, y0, pz0, px1, h, pz1, { c: wc, mech: true });
        // 四个面：朝街（外面 1 m 是同一高度的空地）才加东西
        const sides = [[px0, pz0, px1, pz0, 0, -1], [px1, pz0, px1, pz1, 1, 0], [px1, pz1, px0, pz1, 0, 1], [px0, pz1, px0, pz0, -1, 0]];
        for (const [ax, az, bx, bz, nx, nz] of sides) {
          const len = Math.hypot(bx - ax, bz - az); if (len < 2.5) continue; const ux = (bx - ax) / len, uz = (bz - az) / len;
          let openN = 0; for (const t of [0.2, 0.5, 0.8]) if (open(ax + ux * len * t + nx * 1.0, az + uz * len * t + nz * 1.0, y0)) openN++; if (openN < 2) continue;
          const face = (u0, u1, y, y1, out, c, collide, rays) => { const x0 = ax + ux * u0, z0 = az + uz * u0, x1 = ax + ux * u1, z1 = az + uz * u1; deco(Math.min(x0, x1, x0 + nx * out), y, Math.min(z0, z1, z0 + nz * out), Math.max(x0, x1, x1 + nx * out), y1, Math.max(z0, z1, z1 + nz * out), c, collide, rays); };
          const slots = []; for (let u = 1.6; u < len - 1.2; u += 3.2) slots.push(u); const door = slots.length && rnd() < 0.7 ? Math.floor(rnd() * slots.length) : -1;
          slots.forEach((u, k) => {
            if (k === door) face(u - 0.65, u + 0.65, y0, y0 + 2.4, 0.04, DARK); else if (rnd() < 0.8) face(u - 0.5, u + 0.5, y0 + 1.6, y0 + 2.7, 0.04, DARK);
            if (h - y0 >= 6.4 && rnd() < 0.75) face(u - 0.5, u + 0.5, y0 + 4.5, y0 + 5.6, 0.04, DARK);
          });
          const far = open(ax + ux * len * 0.5 + nx * 3.2, az + uz * len * 0.5 + nz * 3.2, y0);
          if (far && h - y0 >= 6.4 && len >= 5 && rnd() < 0.35) {          // 二楼阳台（能攀上去）
            const u = len * (0.3 + rnd() * 0.4); face(u - 1.4, u + 1.4, y0 + 3.5, y0 + 3.75, 1.1, COL.floor2, true, 8); face(u - 1.4, u + 1.4, y0 + 3.75, y0 + 4.65, 1.1, COL.cover, true, 6);
            face(u - 1.4, u + 1.4, y0 + 3.75, y0 + 4.65, 0.96, wc, true, 6);
          } else if (far && rnd() < 0.22) {                                   // 门口的雨棚（能踩）
            const u = len * (0.25 + rnd() * 0.5); face(u - 1.5, u + 1.5, y0 + 2.6, y0 + 2.72, 1.4, CLOTH[Math.floor(rnd() * CLOTH.length)], true, 8);
          }
        }
        // 屋顶：女儿墙、楼梯间、水箱
        const pc = wc.map((v) => v * 0.9);
        if (rnd() < 0.5) { deco(px0, h, pz0, px1, h + 0.7, pz0 + 0.3, pc, true, 6); deco(px0, h, pz1 - 0.3, px1, h + 0.7, pz1, pc, true, 6); if (rnd() < 0.5) { deco(px0, h, pz0, px0 + 0.3, h + 0.7, pz1, pc, true, 6); deco(px1 - 0.3, h, pz0, px1, h + 0.7, pz1, pc, true, 6); } }
        if ((px1 - px0) * (pz1 - pz0) > 45 && rnd() < 0.4) { const cx = rnd() < 0.5 ? px0 + 0.6 : px1 - 3.2, cz = rnd() < 0.5 ? pz0 + 0.6 : pz1 - 3.2; B.box('proto', cx, h, cz, cx + 2.6, h + 2.4, cz + 2.6, { c: wc, mech: false, rays: 8 }); }
        else if (rnd() < 0.25) K.cyl('proto', (px0 + px1) / 2 + (rnd() - 0.5) * 2, h, (pz0 + pz1) / 2 + (rnd() - 0.5) * 2, 0.9, 1.6, { c: COL.cover2, collide: true, seg: 12, ts: 4, rays: 8 });
      }
    }
  }

  // ====================== 玩法数据 ======================
  L.friendlyPods = [[-8, 66], [8, 66], [0, 72], [-12, 70], [12, 70], [-24, 57], [24, 57], [-36, 50], [36, 52]];
  L.enemyPods = [[-4, -66], [8, -64], [18, -68], [0, -72], [-28, -53], [44, -46], [10, -52]];
  L.respawns = [[0, 68], [-10, 70], [10, 70], [-24, 57], [24, 57]];
  L.combatPoints = [
    [-36, 46, 'W'], [-38, 30, 'W'], [-45, 12, 'W'], [-56, 12, 'W'], [-56, -8, 'W'], [-44, -30, 'W'], [-39, -23, 'W'], [-47, -38, 'W'], [-56.5, -30, 'W'], [-28, -30, 'W'], [-30, -53, 'W'], [-40, -48, 'W'],
    [0, 46, 'M'], [0, 26, 'M'], [0, 5, 'M'], [-8, 8, 'M'], [0, -9, 'M'], [0, -19, 'M'], [2, -32, 'M'], [10, -38, 'M'], [-4, -46, 'M'], [8, -62, 'M'],
    [36, 54, 'E'], [36, 30, 'E'], [50, 32, 'E'], [36, 8, 'E'], [52, 8, 'E'], [41, -11, 'E'], [41, -24, 'E'], [49, -33, 'E'], [32, -33, 'E'], [18, -40, 'E'], [48, -48, 'E'], [58, -11, 'E'],
    [-18, 33.5, 'C'], [16, 31.5, 'C'], [-24, 2, 'C'], [15.5, -16, 'C'], [24, 5, 'C'],
  ];
  L.nests = [[0, 7.65, -23.5], [17, TER + 1.45, -39], [-56.5, 1.55, -32], [32, TER + 0.05, -42], [8, TER + 0.05, -54]];
  L.menuCam = { x: 0, y: 44, z: 0, rx: 92, rz: 108, dy: 6, look: [0, 2, -4] };
  L.flyover = [
    { from: [70, 60, 96], to: [30, 30, 40], look: [0, 2, -10], t: 4.4 },
    { from: [12, 16, 92], to: [2, 5.5, 80], look: [0, 1.6, 50], t: 3.4 },
  ];
  return L;
}

// 导航网格建好之后：空降点、交战点挪到最近的可走格；机甲投放点从机甲能走的露天格子里挑，两边各挑几个
export function finishSalt(L, nav) {
  const fix = (p, r = 6) => { if (nav.walkable(p[0], p[1])) return p; const i = nav.nearestIn(p[0], p[1], nav.ok, r); return i >= 0 ? [nav.cx(i), nav.cz(i), ...p.slice(2)] : null; };
  L.friendlyPods = L.friendlyPods.map((p) => fix(p)).filter(Boolean); L.enemyPods = L.enemyPods.map((p) => fix(p)).filter(Boolean);
  L.respawns = L.respawns.map((p) => fix(p)).filter(Boolean); L.combatPoints = L.combatPoints.map((p) => fix(p)).filter(Boolean);
  const pick = (test, n) => {
    const cand = []; for (let k = 0; k < nav.mechList.length; k += 3) { const i = nav.mechList[k]; if (nav.sky[i] >= 0.9 && test(nav.cz(i))) cand.push([nav.cx(i), nav.cz(i)]); }
    const out = []; while (out.length < n && cand.length) { let best = null, bd = -1; for (const c of cand) { let d = 1e9; for (const o of out) d = Math.min(d, Math.hypot(o[0] - c[0], o[1] - c[1])); if (!out.length) d = Math.abs(c[1]); if (d > bd) { bd = d; best = c; } } if (!best || (out.length && bd < 14)) break; out.push(best); }
    return out;
  };
  L.mechDrops = [...pick((z) => z > 14, 5), ...pick((z) => z < -14, 4)];
  return L;
}
