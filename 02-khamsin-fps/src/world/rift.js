// 原创地图「双界回廊」：同一条路线的两重空间 —— 现世（ph = 0）与蜃界（ph = 1）。
// 两界的地形和主体建筑一样，差别在“哪里有路”：门、桥、墙、平台各在其中一界存在，玩家随时切换（T）穿行。
//   起点院   现世的大门紧闭、蜃界敞开；门后的甬道在蜃界被塌墙堵死、现世畅通
//   断桥     南半截只在蜃界、北半截只在现世，中间空 3 m：起跳后在空中切换
//   蹬墙回廊 没有地面的深沟，可蹬的墙左（现世）→ 右（蜃界）→ 左（现世）交替出现。两面墙相距 5 m：蹬墙跳的横向速度 6 m/s，飞过去约 0.6 秒、同时前进约 7 m，所以每段墙留了十米以上
//   守卫大厅 现世有步兵把守、出口闸门紧闭；机关在蜃界的回廊上，拉下后现世的闸门升起（因果联动）
//   升井     四层平台现世 / 蜃界交替，跳起后切换接上
//   天台     终点信标，两界各有守卫
// 两界共用的结构先建（随机序列一致，外观才对得上），各界独有的部分最后建。
import * as THREE from 'three';
import { M4, PLASTER, ACCENT, CLOTH } from './kit.js';

export const RIFT_BOUNDS = { x0: -25, x1: 25, z0: -78, z1: 58 };
export const RIFT_NAME = ['现世', '蜃界'];
// 两界的大气：现世沿用实拍天空的白昼；蜃界是同一个太阳方向下的冷色幽暗世界（fogMul 是相对现世雾色的倍率，由入口换算成 fogColor）
export const RIFT_ATMOS = [
  null,
  { sunColor: [0.5, 0.82, 1.0], sunK: 0.2, skyK: [0.16, 0.36, 0.44], fogMul: [0.1, 0.28, 0.34], fogK: 3.4, skyGain: 0.13, tint: [0.84, 1.0, 1.08], bloomK: 1.8, keyK: 0.74 },
];
export const RIFT_KILL_Y = -7;
const PIT = -11;
const TEAL = [0.25, 1.0, 1.15];
export function riftTerrainH(x, z) { return ((z > 14.5 && z < 28.5) || (z > -26.5 && z < 5.5)) ? PIT : 0; }
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function outerH(x, z) {
  const d = Math.max(Math.abs(x) - 30, Math.abs(z + 10) - 75, 0);
  const a = Math.sin(x * 0.019 + Math.sin(z * 0.012) * 2.1) * 0.5 + 0.5, b = Math.sin(z * 0.016 + Math.sin(x * 0.011 + 1.1) * 1.7 + 2.0) * 0.5 + 0.5;
  return sstep(0, 110, d) * (1.5 + 14 * (Math.pow(a, 1.6) * 0.6 + b * b * 0.4));
}

export function buildRift(B, K, ph) {
  const { rr } = K; const A = ph === 0, Bp = ph === 1;
  const L = {
    phase: ph,
    playerSpawn: { x: 0, y: 0.1, z: 52, yaw: 0 },
    checkpoints: [
      { x: 0, y: 0.1, z: 52, yaw: 0, name: '起点院' }, { x: 0, y: 0.1, z: 30.6, yaw: 0, name: '断桥' }, { x: 0, y: 0.1, z: 11.5, yaw: 0, name: '蹬墙回廊' },
      { x: 0, y: 0.1, z: -28.2, yaw: 0, name: '守卫大厅' }, { x: 0, y: 0.1, z: -51.6, yaw: 0, name: '升井' }, { x: 0, y: 13.1, z: -60.6, yaw: 0, name: '天台' },
    ],
    // 导航网格的种子点：各段互不连通（靠切换才能过去），每段各撒一个
    navSeeds: [[0, 52], [0, 35], [0, 31], [0, 10], [0, -28], [0, -40], [0, -48.5], [0, -54], [0, -66]],
    enemies: A
      ? [['grunt', 4, 8.4, 3], ['grunt', -5, -42, 6], ['grunt', 5, -41, 6], ['grunt', -1, -36, 5], ['grunt', -5, -66, 5], ['grunt', 5, -67, 5]]
      : [['stalker', 0, -40, 7]],   // 玩家是单枪匹马，守卫给得少：现世是步兵，蜃界只有大厅里的一个追猎者；蜃界的天台不设防（会切换的人可以绕开天台的守卫）
    lever: { phase: 1, x: -6.6, y: 3.2, z: -46.9 },
    gate: { phase: 0, box: [-2, 0, -48.06, 2, 4.05, -47.72] },
    finish: { x: 0, y: 13, z: -70, r: 2.4 },
    // 沿途提示：玩家的 z 进入区间时显示一次
    hints: [
      { z0: 44, z1: 56, text: '现世的大门紧闭 —— 按 T 切到蜃界', phase: 0 },
      { z0: 33.8, z1: 38, text: '蜃界的甬道被塌墙堵死 —— 再按 T 切回现世', phase: 1 },
      { z0: 28.6, z1: 33, text: '按住 Z 可以看见另一界的轮廓：桥的另一半在那边。跳起来，在空中切换' },
      { z0: 6, z1: 14, text: '前面没有地面。贴墙起跳蹬墙跑；墙到头时蹬出去、在空中切换，接上对面那一界的墙' },
      { z0: -47.6, z1: -26.6, text: '出口的闸门在现世是关死的。机关在蜃界的回廊上', until: 'lever' },
      { z0: -58, z1: -49.2, yMax: 2, text: '平台一层在现世、一层在蜃界：起跳 → 切换 → 二段跳' },
    ],
    dustVolumes: [[-9.7, 0, -47.7, 9.7, 6.4, -30.3, Bp ? 4 : 7], [-4, 0, -58, 4, 15, -50, 4]],
    zones: null, ziplines: [], shafts: [], smokes: [], friendlyPods: [], enemyPods: [], mechDrops: [], nests: [], combatPoints: [[0, 10], [0, -40], [0, -66]],
    // 开场镜头：越过起点院看向断桥 → 沿蹬墙回廊飞向大厅和升井
    flyover: [{ from: [0, 17, 64], to: [0, 10, 41], look: [0, 1, 20], t: 4 }, { from: [13, 15, 10], to: [9, 11.5, -27], look: [0, 4, -52], t: 4.5 }],
  };
  const wo = { grime: { h: 1.6, m: 0.66 }, top: { h: 0.8, m: 0.86 } };
  const pave = (x0, z0, x1, z1, y = 0.04, mat = 'paving', o = {}) => B.box(mat, x0, y - 0.35, z0, x1, y, z1, { skip: 'D', ...o });
  const glow = (x0, y0, z0, x1, y1, z1, c = TEAL, hdr = 5) => B.box('emissive', x0, y0, z0, x1, y1, z1, { c, hdr, collide: false, rays: 0, bottom: true });

  // ============ 地形 ============
  {
    const g = new THREE.PlaneGeometry(60, 150, 60, 150); g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position; const layer = [], col = [];
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), z = pos.getZ(i) - 10; pos.setZ(i, z); pos.setY(i, riftTerrainH(x, z)); layer.push(0.45); const t = 0.92 + 0.08 * Math.sin(x * 0.31 + z * 0.17) * Math.sin(z * 0.23 - x * 0.11); col.push(t, t, t); }
    g.computeVertexNormals(); g.setAttribute('aLayer', new THREE.Float32BufferAttribute(layer, 1)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    B.addGeo('terrain', g, new THREE.Matrix4(), { uv: 'world', collide: true, mech: true, rays: 14, surf: 'sand' });
    // 外围沙丘（四块低精度地面围住路线）
    for (const [x0, z0, x1, z1] of [[-430, -430, -30, 430], [30, -430, 430, 430], [-30, -430, 30, -85], [-30, 65, 30, 430]]) {
      const nx = Math.max(2, Math.round((x1 - x0) / 28)), nz = Math.max(2, Math.round((z1 - z0) / 28)); const og = new THREE.PlaneGeometry(x1 - x0, z1 - z0, nx, nz); og.rotateX(-Math.PI / 2);
      const p2 = og.attributes.position; for (let i = 0; i < p2.count; i++) { const x = p2.getX(i) + (x0 + x1) / 2, z = p2.getZ(i) + (z0 + z1) / 2; p2.setXYZ(i, x, outerH(x, z) - 0.04, z); }
      og.computeVertexNormals(); B.addGeo('terrain', og, new THREE.Matrix4(), { uv: 'world', rays: 0, a: 0.05 });
    }
    // 远景平顶山
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * 6.28 + rr(-0.2, 0.2), d = rr(300, 420), x = Math.cos(a) * d, z = Math.sin(a) * d - 10, r = rr(45, 90), h = rr(50, 110); let y = outerH(x, z) - 6, rad = r;
      for (let k = 0; k < 3; k++) { const hh = h * [0.42, 0.33, 0.25][k]; let cg = new THREE.CylinderGeometry(rad * rr(0.78, 0.9), rad, hh, 11, 2); const cp = cg.attributes.position;
        for (let j = 0; j < cp.count; j++) { const px = cp.getX(j), pz = cp.getZ(j), an = Math.atan2(pz, px), f = 1 + 0.16 * Math.sin(an * 3 + k * 1.7 + x) + 0.1 * Math.sin(an * 7 + z); cp.setX(j, px * f); cp.setZ(j, pz * f * 0.8); }
        cg = cg.toNonIndexed(); cg.computeVertexNormals(); B.addGeo('rock', cg, M4(x, y + hh / 2, z, 0, k * 0.7, 0), { uv: 'world', ts: 40, rays: 0, c: [0.92, 0.8, 0.7] }); y += hh; rad *= rr(0.6, 0.78); }
    }
  }

  // ============ 两界共用的主体结构 ============
  // 外墙（一直伸到沟底）与两端
  B.box('sandstone', -25.5, PIT - 0.5, -78, -24, 9, 58, wo); B.box('sandstone', 24, PIT - 0.5, -78, 25.5, 9, 58, wo);
  B.box('sandstone', -24, 0, 56.5, 24, 8, 58, wo); B.box('sandstone', -24, 0, -78, 24, 9, -76.5, wo);
  // 两道深沟的崖壁
  for (const z of [28.5, 14.5, 5.5, -26.5]) B.box('sandstone', -24, PIT, z - 0.7, 24, 0.02, z + 0.7, { grime: { h: 3, m: 0.6 } });

  // —— 起点院（z 39..56.5）+ 甬道（z 29.5..38）——
  pave(-9, 39.2, 9, 56.5); pave(-4.5, 29.2, 4.5, 38, 0.035);
  K.building(-24, 44, -9, 56.5, 9.2, { c: PLASTER[1], faces: 'E', nf: 3, style: K.style({ plinth: 'stone', vigas: true }) });
  K.building(-24, 29.5, -9, 44, 7.4, { c: PLASTER[4], faces: 'E', nf: 2, doors: { E: 1 } });
  K.building(9, 46, 24, 56.5, 6.6, { c: PLASTER[7], faces: 'W', nf: 2, shops: 'W' });
  K.building(9, 29.5, 24, 46, 8.4, { c: PLASTER[0], faces: 'W', nf: 3, style: K.style({ plinth: 'paint', accent: ACCENT[0] }) });
  K.building(-9, 29.5, -4.5, 38, 6.4, { c: PLASTER[5], faces: 'ES', nf: 2, roofProps: false }); K.building(4.5, 29.5, 9, 38, 6.4, { c: PLASTER[5], faces: 'WS', nf: 2, roofProps: false });
  // 大门墙：门洞 x -2.2..2.2
  K.facade(-9, 38, 9, 38, 0, { floors: [6.4], c: PLASTER[0], t: 1.2, plain: true, collide: true, style: { plinth: 'stone' }, openings: [[{ kind: 'hole', u0: 6.8, u1: 11.2, v0: 0, v1: 4.3, frame: false }]] });
  B.box('wood', -2.6, 4.1, 37.9, 2.6, 4.55, 39.3, { bottom: true, collide: false, rays: 8, c: [0.62, 0.5, 0.38] });
  for (const z of [38, 38.95]) B.box('plaster', -9, 6.4, z, 9, 7.05, z + 0.25, { c: PLASTER[0], a: 0.12, top: { h: 0.3, m: 0.9 } });
  K.palm(-6.2, 49.5, 9, { lean: 0.9 }); K.palm(6.4, 43, 8.5, { lean: 1.1 }); K.crateStack(6.5, 53.5, 4, 1.4, 0.04); K.sandbags(-5.5, 53.8, 4.2, 0.2, 3, 0.04); K.barrel(7.6, 0.04, 41.4);
  K.bunting([-8.8, 6.2, 47], [8.8, 5.6, 45], 1.1);

  // —— 断桥两岸 ——
  pave(-10, 6.2, 10, 13.8); K.building(-24, 6.2, -10, 13.8, 6.8, { c: PLASTER[2], faces: 'E', nf: 2 }); K.building(10, 6.2, 24, 13.8, 7.6, { c: PLASTER[8], faces: 'W', nf: 2, style: K.style({ vigas: true }) });
  for (const [z0, z1] of [[27.6, 29.4], [13.6, 15.4]]) for (const x of [-1.9, 1.5]) B.box('sandstone', x, 0.02, z0, x + 0.4, 1.3, z1, {});   // 桥头墩

  // —— 守卫大厅（z -48..-30）——
  pave(-10, -30, 10, -26.5);
  K.building(-10, -48, 10, -30, 7.2, {
    c: PLASTER[3], hollow: true, floors: [7.2], nf: 1, noAuto: [0], roofDensity: 0.4, style: K.style({ plinth: 'stone', vigas: true }),
    openings: {
      S: [[{ kind: 'hole', u0: 7, u1: 13, v0: 0, v1: 4.8, arch: true, pointed: true, frame: false }]],
      N: [[{ kind: 'hole', u0: 8, u1: 12, v0: 0, v1: 4.05, frame: false }]],
      W: [[{ kind: 'hole', u0: 2.2, u1: 3.6, v0: 3.6, v1: 5.6, frame: false }, { kind: 'hole', u0: 6.4, u1: 7.8, v0: 3.6, v1: 5.6, frame: false }, { kind: 'hole', u0: 10.6, u1: 12, v0: 3.6, v1: 5.6, frame: false }, { kind: 'hole', u0: 14.6, u1: 16, v0: 3.6, v1: 5.6, frame: false }]],
    },
  });
  pave(-9.75, -47.75, 9.75, -30.25, 0.05, 'concrete');
  for (const [px, pz] of [[-4.5, -36], [4.5, -36], [-4.5, -42], [4.5, -42]]) B.box('sandstone', px - 0.35, 0.05, pz - 0.35, px + 0.35, 6.98, pz + 0.35, { grime: { h: 1.2, m: 0.7 } });
  K.building(-24, -59, -10, -29.3, 9, { c: PLASTER[6], faces: 'EN', nf: 3 }); K.building(10, -59, 24, -29.3, 8.2, { c: PLASTER[9], faces: 'WN', nf: 3 });
  B.box('sandstone', -2.3, 4.05, -48.2, 2.3, 4.5, -47.6, { bottom: true });   // 闸门门楣

  // —— 升井（内部 x -4..4，z -58..-50）——
  K.facade(5, -49, -5, -49, 0, { floors: [17], c: PLASTER[2], t: 1.0, plain: true, collide: true, style: { plinth: 'stone' }, openings: [[{ kind: 'hole', u0: 3, u1: 7, v0: 0, v1: 4.2, arch: true, pointed: true, frame: false }]] });
  K.facade(-5, -59, 5, -59, 0, { floors: [13, 4], c: PLASTER[2], t: 1.0, plain: true, collide: true, style: {}, openings: [null, [{ kind: 'hole', u0: 2.5, u1: 7.5, v0: 0, v1: 3.4, frame: false }]] });
  B.box('plaster', -5, 0, -58, -4, 17, -50, { c: PLASTER[2], a: 0.3, grime: { h: 1.6, m: 0.7 } }); B.box('plaster', 4, 0, -58, 5, 17, -50, { c: PLASTER[2], a: 0.3, grime: { h: 1.6, m: 0.7 } });
  pave(-4, -58, 4, -50, 0.05, 'concrete'); pave(-10, -49, 10, -48, 0.035);
  B.box('sandstone', -4, 12.6, -58, 4, 13, -55, { bottom: true });   // 井口的出口平台（两界都有）

  // —— 天台（y = 13，z -75..-59）——
  B.box('sandstone', -10, 0, -75, 10, 13, -59, { grime: { h: 2, m: 0.66 }, skip: 'U' }); B.box('paving', -10, 12.7, -75, 10, 13, -59, { skip: 'DEWNS', collide: false });
  for (const [x0, z0, x1, z1] of [[-10, -75, 10, -74.6], [-10, -74.6, -9.6, -59], [9.6, -74.6, 10, -59]]) B.box('sandstone', x0, 13, z0, x1, 14.1, z1, { top: { h: 0.4, m: 0.86 } });
  // 终点信标：石座 + 发光柱
  K.cyl('sandstone', 0, 13, -70, 1.5, 0.35, { seg: 10, collide: true }); K.cyl('steel', 0, 13.35, -70, 0.12, 3.2, { collide: true });
  B.addGeo('emissive', new THREE.SphereGeometry(0.34, 14, 10), M4(0, 16.8, -70), { c: A ? [1.0, 0.75, 0.3] : TEAL, hdr: 9, rays: 0 }); B.light(0, 16.6, -70, A ? [1.0, 0.75, 0.3] : TEAL, 26, 12);

  // ============ 各界独有 ============
  if (A) {
    // 起点院大门：两扇门紧闭
    K.doorLeaf(-2.2, 38.6, 0.04, 2.2, 4.06, 0); K.doorLeaf(2.2, 38.6, 0.04, 2.2, 4.06, Math.PI);
    K.crateStack(-3.2, 34.5, 3, 0.8, 0.035); K.bunting([-4.4, 5.4, 35], [4.4, 5.0, 33], 0.8); K.pots(3.6, 31.4, 3, 0.5, 0.035);
    // 断桥：北半截
    B.box('sandstone', -1.6, -0.6, 14.5, 1.6, 0.02, 19.5, { bottom: true }); for (const x of [-1.6, 1.35]) B.box('sandstone', x, 0.02, 15.4, x + 0.25, 0.5, 19.5, {});
    B.box('sandstone', -0.7, PIT, 17.6, 0.7, -0.6, 19, { grime: { h: 3, m: 0.6 } });
    K.sandbags(-4.6, 11.4, 4.2, 0.12, 3, 0.04); K.sandbags(4.6, 11.4, 4.2, -0.12, 3, 0.04); K.crateStack(8, 8, 3, 0.9, 0.04);
    // 蹬墙回廊：左 → （右在蜃界）→ 左
    B.box('sandstone', -3.5, PIT, -8, -2.5, 8, 4.5, wo); B.box('sandstone', -3.5, PIT, -26.5, -2.5, 8, -17, wo);
    for (const [z0, z1] of [[-8, 4.5], [-26.5, -17]]) for (let z = z0 + 0.3; z < z1 - 0.9; z += 1.5) B.box('sandstone', -3.5, 8, z, -2.5, 8.7, z + 0.8, { collide: false, rays: 8 });
    // 守卫大厅：掩体
    K.sandbags(-4.5, -37.5, 4.4, 0.06, 3, 0.05); K.sandbags(4.5, -37.5, 4.4, -0.06, 3, 0.05); K.crateStack(-7.5, -44, 4, 1.2, 0.05); K.crateStack(7.6, -33, 3, 1.0, 0.05); K.barrel(8.4, 0.05, -45.5); K.barrel(7.7, 0.05, -46.1);
    K.lantern(0, 6.6, -39, { drop: 1.2, power: 16, radius: 9 });
    // 升井：第一、三层
    B.box('sandstone', -4, 2.2, -58, -0.5, 2.6, -54.5, { bottom: true }); B.box('sandstone', 0.5, 7.4, -53.5, 4, 7.8, -50, { bottom: true });
    // 天台掩体
    K.crateStack(-6, -62.5, 4, 1.3, 13); K.sandbags(4.5, -63.5, 4, 0.3, 3, 13); K.crate(7.4, 13, -71.5, 1.3, 0.3); K.barrier(-3.5, -66.5, 0.2, 13);
  } else {
    // 起点院大门：两扇门敞开
    K.doorLeaf(-2.2, 38.6, 0.04, 2.2, 4.06, -1.75); K.doorLeaf(2.2, 38.6, 0.04, 2.2, 4.06, Math.PI + 1.45);
    for (const x of [-3.4, 3.4]) K.lantern(x, 4.2, 39.45, { drop: 0, power: 30, radius: 9, color: [0.45, 1.0, 1.1] });
    // 甬道：塌墙
    B.box('plaster', -4.5, 0, 32.6, 4.5, 5.6, 33.5, { c: PLASTER[2], a: 0.5, grime: { h: 1.8, m: 0.6, a: 0.8 } }); B.box('plaster', -4.5, 5.6, 32.7, 1.5, 6.3, 33.4, { c: PLASTER[2], a: 0.6 });
    K.rubble(-2.2, 34.4, 1.8, 14, 0.035); K.rubble(2.4, 34.2, 1.5, 10, 0.035); K.rubble(0.5, 31.8, 1.6, 10, 0.035); K.sandPile(-3.4, 34, 2.0, 0.6, 0.035);
    // 断桥：南半截
    B.box('sandstone', -1.6, -0.6, 22.5, 1.6, 0.02, 28.5, { bottom: true }); for (const x of [-1.6, 1.35]) B.box('sandstone', x, 0.02, 22.5, x + 0.25, 0.5, 27.6, {});
    B.box('sandstone', -0.7, PIT, 23, 0.7, -0.6, 24.4, { grime: { h: 3, m: 0.6 } });
    for (const x of [-1.62, 1.56]) glow(x, -0.08, 22.5, x + 0.06, 0.0, 28.5);
    K.lantern(-1.8, 2.3, 27.9, { drop: 0, power: 24, radius: 8, color: [0.45, 1.0, 1.1] }); K.lantern(1.8, 2.3, 27.9, { drop: 0, power: 24, radius: 8, color: [0.45, 1.0, 1.1] });
    for (const x of [-7, 7]) K.lantern(x, 3.2, 10, { drop: 0, power: 26, radius: 9, color: [0.45, 1.0, 1.1] });
    // 蹬墙回廊：右
    B.box('sandstone', 2.5, PIT, -23, 3.5, 8, -5, wo);
    for (let z = -22.7; z < -5.9; z += 1.5) B.box('sandstone', 2.5, 8, z, 3.5, 8.7, z + 0.8, { collide: false, rays: 8 });
    for (const y of [1.2, 4.2]) glow(2.46, y, -23, 2.5, y + 0.06, -5);
    // 守卫大厅：北门砌死；东侧楼梯上回廊，机关在回廊西头
    B.box('plaster', -2, 0, -48, 2, 4.05, -47.75, { c: PLASTER[3], a: 0.7, grime: { h: 1.6, m: 0.6, a: 0.9 } });
    K.stairs(7.3, 0.05, -36.5, '-z', 2.4, 3.15, 7.0, 'sandstone');
    B.box('sandstone', 6.1, 2.8, -47.75, 8.5, 3.2, -43.5, { bottom: true });                          // 楼梯口平台
    B.box('sandstone', -9.75, 2.8, -47.75, 6.1, 3.2, -45.4, { bottom: true });                         // 回廊
    B.box('wood', -9.75, 3.2, -45.5, 6.0, 4.15, -45.4, { c: [0.6, 0.5, 0.4] });                        // 栏杆
    for (const x of [-9, -4.5, 0, 4.5]) B.box('sandstone', x - 0.2, 0.05, -45.6, x + 0.2, 2.8, -45.2, {});
    glow(-9.75, 2.74, -45.46, 6.1, 2.8, -45.4);
    for (const [lx, lz] of [[-6, -34], [6, -34], [0, -41], [-6.6, -46.6]]) K.lantern(lx, 6.6, lz, { drop: lx === -6.6 ? 2.4 : 1.4, power: 34, radius: 10, color: [0.45, 1.0, 1.1] });
    // 机关底座（拉杆本体由模式逻辑创建，会动）
    B.box('metalRusty', -6.95, 3.2, -47.5, -6.25, 3.75, -46.9, { c: [0.6, 0.55, 0.5] });
    // 升井：第二、四层
    B.box('sandstone', 0.5, 4.8, -58, 4, 5.2, -54.5, { bottom: true }); B.box('sandstone', -4, 10.0, -53.5, -0.5, 10.4, -50, { bottom: true });
    glow(0.5, 4.74, -54.56, 4, 4.8, -54.5); glow(-0.56, 9.94, -53.5, -0.5, 10.0, -50);
    for (const y of [4.4, 9.6, 15]) K.lantern(0, y + 1.2, -54, { drop: 0.2, power: 22, radius: 8, color: [0.45, 1.0, 1.1] });
    // 天台
    K.rubble(-5, -63, 1.8, 12, 13); K.rubble(5.5, -66, 1.5, 10, 13);
    for (const [x, z] of [[-9.2, -60], [9.2, -60], [-9.2, -74], [9.2, -74]]) K.lantern(x, 15.4, z, { drop: 0, power: 28, radius: 10, color: [0.45, 1.0, 1.1] });
  }
  // 现世的天光充足，灯笼只是点缀；蜃界靠灯
  for (const [lx, lz] of [[-8.2, 41], [8.2, 41], [-4, 36.6], [4, 30.6]]) K.lantern(lx, 3.6, lz, { drop: 0, power: Bp ? 26 : 8, radius: Bp ? 9 : 5, color: Bp ? [0.45, 1.0, 1.1] : undefined });

  // ============ 边界（隐形墙） ============
  B.clipBox(RIFT_BOUNDS.x0 - 1, -20, RIFT_BOUNDS.z0 - 1, RIFT_BOUNDS.x0, 90, RIFT_BOUNDS.z1 + 1); B.clipBox(RIFT_BOUNDS.x1, -20, RIFT_BOUNDS.z0 - 1, RIFT_BOUNDS.x1 + 1, 90, RIFT_BOUNDS.z1 + 1);
  B.clipBox(RIFT_BOUNDS.x0, -20, RIFT_BOUNDS.z0 - 1, RIFT_BOUNDS.x1, 90, RIFT_BOUNDS.z0); B.clipBox(RIFT_BOUNDS.x0, -20, RIFT_BOUNDS.z1, RIFT_BOUNDS.x1, 90, RIFT_BOUNDS.z1 + 1);
  return L;
}
