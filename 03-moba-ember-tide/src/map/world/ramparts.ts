// 砌出来的整墙，和高低之间的连接（阶段 2.4）：
//   · 基地高地的挡墙：外面看是三米八的墙（下面两米四挡着高地的土，上面一道女儿墙），里面看只有齐胸高；
//   · 三个口子：八级台阶、两侧阶梯状的护墙、两根八角门墩；
//   · 地图边缘的城墙：隔十来米一根墩柱，拐弯和上高地的地方是大墩；
//   · 出生点的台子：三级弧形台阶；
//   · Boss 石台边上的一圈石头；城墙外面的山石，河道两头的山崖。
// 料石、墩柱、石头的做法和野区的墙是同一套（slice/stone.ts），所以看上去是一家的。
//
// 换画风 B（b-walls）：料石换成圆角的长板（slabs），墩柱我方是圆柱、对方是带铁箍的方墩，山石削得圆润，台阶是几块大石板。
// 位置一点不动：这里的随机数是一整串接着用的（口子 → 台子 → 挡墙 → 城墙 → 山石），山石的位置决定城墙外的树种在哪，
// 所以原来每一层料石用掉多少随机数，现在照样耗掉（burn），形状用 slabs 自己的随机数出。

import * as THREE from "three";
import { mergeGeometries, toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { clamp, fbm, rng } from "../../core/noise";
import { A_CORNER, BASE_R, FOUNTAIN_D, GATES, GATE_HW, GATE_LP, GATE_RUN, LAGOON, LANE_HW, L_BASE, fields, sideLaneW, toLane, toWorld, type Gate } from "../layout";
import { bentBlock, boulderGeometry, curveOf, fin, post, roundBlock, roundCol, slabs, tint, wallMaterials, type Curve, type StoneTextures, type Tuft } from "../slice/stone";
import { DAIS_H, DAIS_R, ISLAND_Y, STEP_D, STEP_H, terrainHeight } from "../terrain";

type P2 = [number, number];
type G = THREE.BufferGeometry;
type Kind = "stone" | "trim" | "rock" | "step";
const KINDS: Kind[] = ["stone", "trim", "rock", "step"];

export class Builder {
  private buckets = new Map<string, { team: number; stone: G[]; trim: G[]; rock: G[]; step: G[] }>();
  lines: { pts: P2[]; w: number; a: number }[] = [];
  circles: { x: number; z: number; r: number; a: number }[] = [];
  foam: { x: number; z: number; r: number }[] = [];
  solids: { x: number; z: number; r: number }[] = [];        // 山石占的地方：种树的时候要避开
  tufts: Tuft[] = [];
  constructor(private cell = 26) {}
  list(team: number, kind: Kind, x: number, z: number): G[] {
    const key = `${team}:${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`;
    if (!this.buckets.has(key)) this.buckets.set(key, { team, stone: [], trim: [], rock: [], step: [] });
    return this.buckets.get(key)![kind];
  }
  build(tex: StoneTextures, name: string): THREE.Group {
    const group = new THREE.Group(); group.name = name;
    for (const bk of this.buckets.values()) {
      const mats = wallMaterials(tex, bk.team);
      for (const kind of KINDS) { if (!bk[kind].length) continue; const m = new THREE.Mesh(mergeGeometries(bk[kind])!, mats[kind]); m.castShadow = true; m.receiveShadow = true; group.add(m); }
    }
    return group;
  }
}

const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1);
interface CourseOpts { lmin: number; lvar: number; k?: number; grad?: number; ch?: number; base?: number; step?: number; seed?: number; topVar?: number;
  /** 画风 B 的块：每块多长、长短差多少、圆角多大、缝多宽、每块明暗差多少（不给就按 lmin 的一倍半到两倍） */
  len?: number; lv?: number; r?: number; K?: number; gap?: number; kv?: number; }
/** 原来那一层料石用了多少随机数，照原样耗一遍（只耗、不出形状）：后面山石的位置接在同一串随机数上 */
function burn(rd: () => number, a: number, b: number, lmin: number, lvar: number) {
  let s = a - rd() * lmin * 0.7;
  while (s < b - 0.01) {
    let en = s + lmin + rd() * lvar; if (b - en < lmin * 0.45) en = b;
    const s0 = Math.max(s, a), s1 = Math.min(en, b);
    if (s1 - s0 > 0.25) { rd(); rd(); rd(); }
    s = en;
  }
}
/** 一层料石：沿着 cv 从 a 铺到 b。随机数照原来的耗（burn），形状是画风 B 的圆角长板 */
function course(out: G[], cv: Curve, rd: () => number, a: number, b: number, y0: number, y1: number, hT: number, o: CourseOpts) {
  burn(rd, a, b, o.lmin, o.lvar);
  slabs(out, cv, a, b, y0, y1, hT, { len: o.len ?? o.lmin * 1.8, lv: o.lv ?? o.lvar * 0.6, r: o.r ?? 0.08, K: o.K, gap: o.gap, base: o.base, step: o.step, k: o.k, kv: o.kv ?? 0.04, grad: o.grad, topVar: o.topVar, seed: o.seed });
}

/** 墩柱（画风 B）：我方是一根圆柱（铜绿柱础、两节柱身、两道铜箍、出檐的圆帽），对方是方墩（墩脚、大方块身子、两道暗铁箍从顶上箍下来）。
 *  y0 落脚的高度，H 柱身到哪，r 粗细，band 下面那道箍的高度；dir 是方墩朝哪（沿墙的方向），圆柱用不着。顶面高度和原来一样（口子上的旗插在门墩顶上） */
function pier(B: Builder, team: number, x: number, z: number, y0: number, H: number, r: number, band: number, dir: [number, number] = [Math.SQRT1_2, -Math.SQRT1_2]) {
  const st = B.list(team, "stone", x, z), tr = B.list(team, "trim", x, z), top = y0 + H + 0.52;      // 原来的帽顶
  if (team === 0) {
    const C = (list: G[], rr: number, a: number, b: number, rd: number, k: number, grad: number) => list.push(fin(roundCol(rr, a, b, rd).translate(x, y0, z), k, grad));
    C(st, r * 1.24, -0.2, 0.62, 0.1, 0.92, 0.3);
    C(st, r * 1.02, 0.56, band, 0.12, 1.0, 0.08);
    C(tr, r * 1.07, band - 0.02, band + 0.22, 0.05, 1, 0);
    C(st, r * 0.95, band + 0.18, H - 0.06, 0.1, 1.02, 0);
    C(tr, r * 1.0, H - 0.2, H - 0.02, 0.04, 1.05, 0);
    C(st, r * 1.2, H - 0.04, top - y0 - 0.12, 0.12, 1.06, 0);
    C(st, r * 0.86, top - y0 - 0.16, top - y0, 0.08, 1.08, 0);      // 平顶，上面长苔
  } else {
    const [tx, tz] = dir, P = (list: G[], la: number, hw: number, a: number, b: number, rd: number, k: number, grad: number, K = 2, ox = 0) => list.push(fin(post(x + tx * ox, z + tz * ox, tx, tz, la, hw, a, b, rd, y0, K), k, grad));
    P(st, r * 2.45, r * 1.22, -0.2, 0.62, 0.1, 0.88, 0.3);
    P(st, r * 1.9, r * 1.0, 0.56, top - y0 - 0.1, 0.16, 1.0, 0.1, 3);
    P(st, r * 2.1, r * 1.1, top - y0 - 0.16, top - y0, 0.08, 1.06, 0);
    for (const sd of [-1, 1]) P(tr, 0.26, r * 1.04, band, top - y0 - 0.14, 0.05, 1, 0, 1, sd * r * 0.52);
    P(tr, r * 1.96, r * 1.03, band - 0.02, band + 0.2, 0.05, 1, 0, 1);
  }
  for (let k = 0; k < 3; k++) { const t = k * 2.1 + x * 0.7, d = r * 0.4; B.tufts.push({ x: x + Math.cos(t) * d, z: z + Math.sin(t) * d, y: y0 + H + 0.5, h: 0.14 + (k % 2) * 0.1, team, top: true }); }
  B.circles.push({ x, z, r: r * 1.55, a: 0.5 });
}

/** 墙顶有苔的地方冒几丛草；墙脚朝 side 那一侧长一溜矮草 */
function wallTufts(B: Builder, cv: Curve, a: number, b: number, top: number | ((s: number) => number), hw: number, team: number, rd: () => number, seed: number, footSide: number, base?: number) {
  for (let s = a + 0.4; s < b - 0.4; s += 0.22) {
    if (fbm(s * 0.4 + seed, seed * 1.7, 2, 3) < 0.5 || rd() > 0.55) continue;
    const p = cv.at(s), lz = (rd() - 0.5) * hw * 1.5, x = p.x - p.tz * lz, z = p.z + p.tx * lz, g0 = base ?? terrainHeight(p.x, p.z);
    B.tufts.push({ x, z, y: g0 + (typeof top === "number" ? top : top(s)) - 0.02, h: 0.12 + rd() * 0.22, team, top: true });
  }
  if (footSide) for (let s = a + 0.2; s < b; s += 0.28) {
    if (rd() > 0.7) continue;
    const p = cv.at(s), lz = footSide * (hw + 0.28 + rd() * 0.4), x = p.x - p.tz * lz, z = p.z + p.tx * lz;
    B.tufts.push({ x, z, y: terrainHeight(x, z), h: 0.2 + rd() * 0.32, team, top: false });
  }
}

// ---------------------------------------------------------------- 口子：台阶、护墙、门墩
function buildGate(B: Builder, g: Gate, su: number, sv: number, team: number, rd: () => number) {
  const L = (s: number, l: number): P2 => toWorld(su * (g.o[0] + g.t[0] * s + g.n[0] * l), sv * (g.o[1] + g.t[1] * s + g.n[1] * l));
  const [cx, cz] = L(-GATE_RUN / 2, 0), st = B.list(team, "stone", cx, cz), tr = B.list(team, "trim", cx, cz), sp = B.list(team, "step", cx, cz);
  const d0 = L(0, 0), d1 = L(1, 0), dl = Math.hypot(d1[0] - d0[0], d1[1] - d0[1]), gt: [number, number] = [(d1[0] - d0[0]) / dl, (d1[1] - d0[1]) / dl];      // 沿兵线往基地里的方向
  const n0 = L(0, 1), gn: [number, number] = [n0[0] - d0[0], n0[1] - d0[1]];      // 横着的方向（toWorld 是旋转，长度本来就是 1）
  // 八级台阶：每级是三四块大石板（画风 B：块大、缝少、圆角），接缝上下错开
  const NS = 8, RISE = L_BASE / NS, TREAD = GATE_RUN / NS;
  for (let i = 0; i < NS; i++) {
    const s0 = -GATE_RUN + i * TREAD, s1 = s0 + TREAD + (i < NS - 1 ? 0.14 : 0.02), sm = (s0 + s1) / 2, y1 = RISE * (i + 1), cv = curveOf([L(sm, -GATE_HW), L(sm, GATE_HW)]);
    course(sp, cv, rd, 0, cv.L, y1 - 0.5, y1, (s1 - s0) / 2, { lmin: 1.4, lvar: 1.6, ch: 0.04, base: 0, step: 3, seed: i * 7.3 + su * 3 + sv * 5, k: 1.0 + i * 0.008, topVar: 0.012, len: 3.4, lv: 1.2, r: 0.06, gap: 0.035, kv: 0.03, K: 1 });
  }
  for (const sd of [-1, 1]) {
    // 护墙：从门墩一级一级矮下来，每一级顶上压一块出檐的盖石（我方盖石下面一道铜绿的边），最下面收在一个方墩上
    const lc = sd * (GATE_HW + 0.5), sTop = g.sp[sd < 0 ? 0 : 1], sBot = -GATE_RUN - 0.2, cv = curveOf([L(sBot, lc), L(sTop, lc)]), n = 3, seg = (sTop - sBot) / n;
    for (let k = 0; k < n; k++) {
      const a = k * seg, b = a + seg, top = L_BASE * clamp(1 + (sBot + b) / GATE_RUN, 0, 1) + 0.78;
      st.push(fin(roundBlock(cv, a + 0.02, b - 0.02, 0, top - 0.2, 0.5, 0.09, { base: 0, step: 1.2 }), 0.98, k === 0 ? 0.3 : 0.1));
      tr.push(fin(roundBlock(cv, a + 0.02, b - 0.02, top - 0.32, top - 0.17, 0.53, 0.035, { base: 0, step: 1.2, K: 1 }), 1, 0));
      st.push(fin(roundBlock(cv, a - 0.05, b + (k === n - 1 ? 0 : 0.08), top - 0.2, top, 0.61, 0.08, { base: 0, step: 1.2, K: 3 }), 1.06, 0));
      for (let s = a + 0.3; s < b - 0.3; s += 0.3) if (rd() < 0.3) { const p = cv.at(s), lz = (rd() - 0.5) * 0.8; B.tufts.push({ x: p.x - p.tz * lz, z: p.z + p.tx * lz, y: top - 0.02, h: 0.12 + rd() * 0.18, team, top: true }); }
    }
    const [px, pz] = L(sBot - 0.6, lc);
    // 方墩：顶面平的、在 1.44 米（口子的火盆坐在上面，gateprops.ts）。我方圆的，对方方的
    if (team === 0) { const C = (list: G[], r: number, a: number, b: number, rr: number, k: number, grad: number) => list.push(fin(roundCol(r, a, b, rr).translate(px, 0, pz), k, grad)); C(st, 0.64, 0, 1.12, 0.09, 0.98, 0.3); C(tr, 0.68, 0.84, 0.99, 0.03, 1, 0); C(st, 0.8, 1.06, 1.3, 0.1, 1.06, 0); C(st, 0.6, 1.26, 1.44, 0.07, 1.08, 0); }
    else { const P = (list: G[], la: number, hw: number, a: number, b: number, rr: number, k: number, grad: number) => list.push(fin(post(px, pz, gt[0], gt[1], la, hw, a, b, rr, 0), k, grad)); P(st, 1.3, 0.65, 0, 1.12, 0.1, 0.98, 0.3); P(tr, 1.36, 0.68, 0.84, 0.99, 0.03, 1, 0); P(st, 1.56, 0.78, 1.06, 1.3, 0.1, 1.06, 0); P(st, 1.2, 0.6, 1.26, 1.44, 0.07, 1.08, 0); }
    B.circles.push({ x: px, z: pz, r: 1.2, a: 0.45 });
    B.lines.push({ pts: [L(sBot, lc), L(sTop, lc)], w: 1.7, a: 0.45 });
    const [qx, qz] = L(sTop, sd * GATE_LP); pier(B, team, qx, qz, 0, 5.2, 1.24, 2.46, gn);
  }
}

// ---------------------------------------------------------------- 基地高地的挡墙
const basePt = (phi: number): P2 => [A_CORNER - BASE_R * Math.cos(phi), BASE_R * Math.sin(phi)];
const dEdgeQ = (a: number, w: number) => { const [x, z] = toWorld(a, w); return fields(x, z).dEdge; };
const EDGE_C = 1.1;                             // 城墙的中线离外沿多远
/** 挡墙在四分之一地图里的两段弧：中路口子到边路口子，边路口子到城墙 */
function baseArcs(): P2[][] {
  const ang = (p: P2) => Math.atan2(p[1], A_CORNER - p[0]);
  const pp = (g: Gate, i: 0 | 1): P2 => { const sd = i ? 1 : -1, s = g.sp[i]; return [g.o[0] + g.t[0] * s + g.n[0] * sd * GATE_LP, g.o[1] + g.t[1] * s + g.n[1] * sd * GATE_LP]; };
  const m = ang(pp(GATES[0], 1)), sa = [ang(pp(GATES[1], 0)), ang(pp(GATES[1], 1))].sort((x, y) => x - y);
  let lo = sa[1], hi = Math.PI / 2;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2, p = basePt(mid); if (dEdgeQ(p[0], p[1]) > EDGE_C) lo = mid; else hi = mid; }
  const arcOf = (p0: number, p1: number) => { const n = Math.max(2, Math.ceil((p1 - p0) / 0.012)); return Array.from({ length: n + 1 }, (_, i) => basePt(p0 + ((p1 - p0) * i) / n)); };
  return [arcOf(m, sa[0]), arcOf(sa[1], lo)];
}
const RAMP = { plinth: 0.55, c1: 1.5, c2: L_BASE + 0.02, band: L_BASE + 0.26, parapet: 3.42, top: 3.78 };
function buildRampart(B: Builder, P: P2[], team: number, rd: () => number, seed: number, t0: number, t1: number) {
  const cv = curveOf(P), a = t0, b = cv.L - t1; if (b - a < 0.8) return;
  const mid = cv.at(cv.L / 2), st = B.list(team, "stone", mid.x, mid.z), o = { base: 0, step: 1.8, seed, K: 1 };      // 弧很缓（半径 44 米），一米八一圈够了；大墙远看，圆角一刀斜面加平滑法线就够圆（面数省一半）
  // 画风 B：墙脚 → 一人多高的大块（原来是两层，这里第二层只耗随机数）→ 齐着广场地面的一道铜绿（暗铁）腰带 → 女儿墙 → 出檐的压顶
  const tr = B.list(team, "trim", mid.x, mid.z);
  course(st, cv, rd, a, b, -0.3, RAMP.plinth, 0.98, { ...o, lmin: 1.9, lvar: 1.0, k: 0.9, grad: 0.4, len: 3.8, r: 0.08 });
  course(st, cv, rd, a, b, RAMP.plinth - 0.04, RAMP.c2 + 0.02, 0.84, { ...o, lmin: 1.7, lvar: 1.2, k: 0.98, grad: 0.08, len: 3.2, lv: 0.9, r: 0.12 });
  burn(rd, a, b, 1.5, 1.2);
  course(tr, cv, rd, a, b, RAMP.c2 - 0.02, RAMP.band, 0.9, { ...o, lmin: 2.2, lvar: 1.0, k: 1.0, len: 5.5, r: 0.045, K: 1, gap: 0.015 });          // 齐着广场地面的一道腰线
  course(st, cv, rd, a, b, RAMP.band - 0.02, RAMP.parapet, 0.7, { ...o, lmin: 1.5, lvar: 1.0, len: 3.0, r: 0.1 });
  course(st, cv, rd, a, b, RAMP.parapet - 0.02, RAMP.top, 0.87, { ...o, lmin: 1.8, lvar: 0.9, k: 1.06, ch: 0.1, topVar: 0.03, len: 2.7, r: 0.1, K: 2 });
  st.push(fin(bentBlock(cv, a, b, 0.02, 3.4, 0.62, 0.01, 0, 0, 0, 0.7), 0.4));
  B.lines.push({ pts: P, w: 3.0, a: 0.5 });
  // 哪一侧是墙外（平地那边）
  const n1 = fields(mid.x - mid.tz * 1.6, mid.z + mid.tx * 1.6).dBase > 0 ? 1 : -1;
  wallTufts(B, cv, a, b, RAMP.top, 0.6, team, rd, seed, n1, 0);
}

// ---------------------------------------------------------------- 地图边缘的城墙
const A_CUT = 10;                               // 河道两头：离河道中线这么近就不砌墙了，换成山崖
/** 城墙的中线，四分之一地图：从基地的角一直到河道那一头 */
export function edgeLine(): P2[] {
  const out: P2[] = [];
  for (let i = 0; i <= 300; i++) {
    const th = ((i / 300) * Math.PI) / 2, c = Math.cos(th), s = Math.sin(th); let lo = 30, hi = 125;
    for (let k = 0; k < 36; k++) { const m = (lo + hi) / 2; if (dEdgeQ(m * c, m * s) > EDGE_C) lo = m; else hi = m; }
    out.push([lo * c, lo * s]);
  }
  return out;
}
const EDGE = { plinth: 0.6, c1: 1.55, c2: 2.45, c3: 3.2, top: 3.6 };
function buildEdge(B: Builder, Pq: P2[], su: number, sv: number, team: number, rd: () => number, seed: number) {
  const P = Pq.filter(p => p[0] >= A_CUT).map(([a, w]) => toWorld(su * a, sv * w) as P2), cv = curveOf(P), L = cv.L, START = 3.0;
  // 特别的位置：上高地的地方（地面在这里差两米四）、墙拐弯最急的地方、河道那一头
  let sBase = -1, sKink = -1, turn = 0;
  for (let s = START; s < L; s += 0.5) { const p = cv.at(s); if (sBase < 0 && fields(p.x, p.z).dBase > 0) sBase = s; }
  for (let s = START + 8; s < L - 8; s += 1) { const p0 = cv.at(s - 2.5), p1 = cv.at(s + 2.5), d = Math.abs(Math.atan2(p0.tx * p1.tz - p0.tz * p1.tx, p0.tx * p1.tx + p0.tz * p1.tz)); if (d > turn) { turn = d; sKink = s; } }
  const special = [sBase, turn > 0.14 ? sKink : -1, L].filter(s => s > 0).sort((x, y) => x - y);
  const piers: { s: number; big: boolean }[] = []; let prev = START;
  for (const sp of special) { const n = Math.max(1, Math.round((sp - prev) / 13)); for (let k = 1; k < n; k++) piers.push({ s: prev + ((sp - prev) * k) / n, big: false }); piers.push({ s: sp, big: sp === sBase }); prev = sp; }
  const bounds = [START, ...piers.map(p => p.s)];
  for (let k = 0; k < bounds.length - 1; k++) {
    const a = bounds[k] + (k ? 0.95 : 0), b = bounds[k + 1] - 0.95; if (b - a < 0.8) continue;
    const mid = cv.at((a + b) / 2), st = B.list(team, "stone", mid.x, mid.z), o = { step: 2.0, seed: seed + k * 11.3, K: 1 };
    // 画风 B：墙脚 → 两层长板（上下错缝）→ 一道铜绿（暗铁）的腰带 → 出檐的压顶。层数和原来一样多（每层的随机数照原样耗），只是第四层换成了腰带
    const tr = B.list(team, "trim", mid.x, mid.z);
    course(st, cv, rd, a, b, -0.3, EDGE.plinth, 1.12, { ...o, lmin: 2.0, lvar: 1.2, k: 0.9, grad: 0.4, len: 4.0, r: 0.08 });
    course(st, cv, rd, a, b, EDGE.plinth - 0.04, 1.92, 0.95, { ...o, lmin: 1.8, lvar: 1.4, k: 0.97, grad: 0.08, len: 3.6, lv: 1.0, r: 0.11 });
    course(st, cv, rd, a, b, 1.9, EDGE.c3 - 0.14, 0.93, { ...o, lmin: 1.6, lvar: 1.4, k: 1.0, len: 3.2, lv: 1.0, r: 0.11 });
    course(tr, cv, rd, a, b, EDGE.c3 - 0.18, EDGE.c3 + 0.02, 0.97, { ...o, lmin: 1.5, lvar: 1.2, k: 1.0, len: 5.5, r: 0.045, K: 1, gap: 0.015 });
    course(st, cv, rd, a, b, EDGE.c3, EDGE.top, 1.1, { ...o, lmin: 1.9, lvar: 1.0, k: 1.06, ch: 0.1, topVar: 0.03, len: 2.8, r: 0.11, K: 2 });
    for (let s = a; s < b; s += 1.8) { const s1 = Math.min(s + 1.8, b); st.push(fin(bentBlock(cv, s, s1, 0.02, EDGE.c3 - 0.35, 0.74, 0.01, 0, 0, undefined, 2), 0.4)); }
    // 朝地图里面的一侧墙脚长草
    const n1 = fields(mid.x - mid.tz * 2, mid.z + mid.tx * 2).dEdge > fields(mid.x, mid.z).dEdge ? 1 : -1;
    wallTufts(B, cv, a, b, EDGE.top, 0.8, team, rd, seed + k, n1);
  }
  for (const pr of piers) {
    const p = cv.at(pr.s);
    if (pr.big) pier(B, team, p.x, p.z, 0, L_BASE + 4.7, 1.75, L_BASE + 0.1, [p.tx, p.tz]);
    else pier(B, team, p.x, p.z, terrainHeight(p.x, p.z), 4.25, 1.3, 2.45, [p.tx, p.tz]);
  }
  B.lines.push({ pts: P, w: 3.4, a: 0.5 });
}

// ---------------------------------------------------------------- 出生点的台子
function buildDais(B: Builder, su: number, team: number, rd: () => number) {
  const [fx, fz] = toWorld(su * (A_CORNER - FOUNTAIN_D), 0), st = B.list(team, "step", fx, fz);
  const ringsDef = [{ r: DAIS_R - 0.27, y1: L_BASE + DAIS_H + 0.03, hT: 0.27 }, { r: DAIS_R + STEP_D * 0.5, y1: L_BASE + DAIS_H - STEP_H, hT: STEP_D / 2 + 0.03 }, { r: DAIS_R + STEP_D * 1.5, y1: L_BASE + DAIS_H - STEP_H * 2, hT: STEP_D / 2 + 0.03 }];
  ringsDef.forEach((rg, ri) => {
    const N = 180, pts = Array.from({ length: N }, (_, i) => { const t = (i / N) * Math.PI * 2; return [fx + Math.cos(t) * rg.r, fz + Math.sin(t) * rg.r] as P2; }), ok = pts.map(([x, z]) => fields(x, z).dEdge > 2.25);
    const start = ok.indexOf(false); if (start < 0) return;
    let run: P2[] = [];
    const flush = () => { if (run.length > 4) { const cv = curveOf(run); course(st, cv, rd, 0, cv.L, rg.y1 - 0.42, rg.y1, rg.hT, { base: 0, lmin: 1.0, lvar: 0.9, ch: 0.035, step: 0.5, seed: ri * 9.1 + su, k: 1.02 - ri * 0.02, len: 2.4, lv: 0.6, r: 0.05, gap: 0.03, kv: 0.02, K: 1 }); } run = []; };
    for (let i = 1; i <= N; i++) { const k = (start + i) % N; if (ok[k]) run.push(pts[k]); else flush(); }
    flush();
  });
}

// ---------------------------------------------------------------- Boss 的石台
function buildIsland(B: Builder, sv: number, rd: () => number) {
  const [ix, iz] = toWorld(0, sv * LAGOON.w), rock = (x: number, z: number, r: number, ry: number, cut: number, seed: number, y: number) => {
    const g = boulderGeometry(seed, r * (1.05 + rd() * 0.3), ry, r * (0.85 + rd() * 0.2), cut > 0.8 ? 0.55 : 0.4);      // 画风 B：圆润的卵石（随机数照原来的用）
    g.applyMatrix4(m4.compose(new THREE.Vector3(x, y, z), q.setFromEuler(e.set(0, rd() * 6.28, 0)), one));
    B.list(0, "rock", x, z).push(g); B.foam.push({ x, z, r: r * 0.9 });      // 河道是中立的，石头不跟阵营走
  };
  // 台子边上一圈压着水的扁石头
  for (let k = 0; k < 15; k++) { const t = (k / 15) * 6.283 + rd() * 0.3, R = LAGOON.island - 0.1 + rd() * 0.6, r = 0.7 + rd() * 0.65; rock(ix + Math.cos(t) * R, iz + Math.sin(t) * R, r, r * 0.62, 0.7, 700 + k * 3 + (sv + 1) * 50, -0.22 + r * 0.16); }
  // 朝地图外面的那一侧立着三块大石头，Boss 背靠着它们
  const dir = Math.atan2(sv, sv);
  [-0.62, 0.0, 0.58].forEach((da, k) => { const t = dir + da + (rd() - 0.5) * 0.15, R = LAGOON.island - 1.3 + (k === 1 ? 0.5 : 0), r = k === 1 ? 2.2 : 1.6 + rd() * 0.3, x = ix + Math.cos(t) * R, z = iz + Math.sin(t) * R; rock(x, z, r, r * 1.3, 0.93, 760 + k * 5 + (sv + 1) * 50, ISLAND_Y + r * 0.34); B.circles.push({ x, z, r: r * 1.2, a: 0.45 }); });
}

// ---------------------------------------------------------------- 城墙外面的山石
/** 山崖的一块：侧面是一刀刀劈出来的大面，往上略收；顶上削成一个大平面再带一道斜角（长苔的就是这些平顶）。画风 B：面削得浅、棱是圆的，像王者峡谷边上那种圆墩墩的山石 */
function cragGeometry(seed: number, rx: number, ry: number, rz: number): G {
  const g = new THREE.IcosahedronGeometry(1, 5), p = g.getAttribute("position"), rd = rng(seed), v = new THREE.Vector3();
  const planes: { n: THREE.Vector3; d: number }[] = [], nSide = 6 + Math.floor(rd() * 3);
  for (let i = 0; i < nSide; i++) { const t = ((i + rd() * 0.8) / nSide) * 6.283; planes.push({ n: new THREE.Vector3(Math.cos(t), 0.04 + rd() * 0.34, Math.sin(t)).normalize(), d: 0.58 + rd() * 0.24 }); }
  planes.push({ n: new THREE.Vector3(rd() * 0.3 - 0.15, 1, rd() * 0.3 - 0.15).normalize(), d: 0.5 + rd() * 0.22 });
  for (let k = 0; k < 2; k++) { const t = rd() * 6.283; planes.push({ n: new THREE.Vector3(Math.cos(t) * 0.8, 0.62, Math.sin(t) * 0.8).normalize(), d: 0.6 + rd() * 0.2 }); }
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    planes.forEach((pl, i) => { const e = v.dot(pl.n) - pl.d; if (e > 0) v.addScaledVector(pl.n, -e * (i < nSide ? 0.78 : i === nSide ? 0.95 : 0.7)); });      // 画风 B：侧面只削一大半，留一点鼓，面和面之间是圆的过渡；顶面削平
    v.multiplyScalar(1 + (fbm(v.x * 1.3 + seed * 0.17, v.y * 1.6 + v.z * 1.1, 2, seed) - 0.5) * 0.05);
    if (v.y < -0.5) v.y = -0.5;
    // 底下往外撇一点：山是坐在地上的，不是一根插着的柱子
    const flare = 1 + Math.max(0, -v.y) * 0.5;
    p.setXYZ(i, v.x * rx * flare, v.y * ry, v.z * rz * flare);
  }
  const o = toCreasedNormals(g, 0.95); o.deleteAttribute("uv");      // 折角放宽：缓的棱是圆的，只有顶面那一圈是利落的边
  return tint(o, 1, 0.3);
}
function buildCliffs(B: Builder, Pq: P2[], su: number, sv: number, rd: () => number) {
  const P = Pq.map(([a, w]) => toWorld(su * a, sv * w) as P2), cv = curveOf(P);
  const add = (g: G, x: number, z: number, y: number) => { g.applyMatrix4(m4.compose(new THREE.Vector3(x, y, z), q.setFromEuler(e.set(0, rd() * 6.28, 0)), one)); B.list(toLane(x, z)[0] < 0 ? 0 : 1, "rock", x, z).push(g); };
  let n = 0;
  /** 在墙线上 s 处、往墙外 off 米的地方放一块山石，高 H */
  const crag = (s: number, off: number, R: number, H: number, contact: boolean) => {
    const p = cv.at(s), f = fields(p.x, p.z), sign = fields(p.x - p.tz * 2, p.z + p.tx * 2).dEdge < f.dEdge ? 1 : -1, x = p.x - p.tz * sign * off, z = p.z + p.tx * sign * off;
    add(cragGeometry(3000 + n++ * 17 + (su + 1) * 400 + (sv + 1) * 900, R, H, R * (0.8 + rd() * 0.35)), x, z, terrainHeight(x, z) + H * 0.4);
    if (contact) B.circles.push({ x, z, r: R * 0.8, a: 0.5 });
    B.solids.push({ x, z, r: R });
    return [x, z];
  };
  // 河道两头：一排连着的山崖把角堵住（这里不砌墙）。前面一排矮，后面一排高
  let sC = cv.L; while (sC > 0 && fields(cv.at(sC).x, cv.at(sC).z).a < A_CUT + 2.5) sC -= 0.5;
  for (let s = sC; s < cv.L + 1.5; s += 2.7 + rd() * 0.8) {
    const R = 2.5 + rd() * 0.9, [x, z] = crag(s, R * 0.62 - EDGE_C + 0.9 + rd() * 0.9, R, 3.0 + rd() * 2.6, true);
    if (rd() < 0.75) crag(s + (rd() - 0.5) * 2, R * 0.62 - EDGE_C + 4.2 + rd() * 2.2, 3.2 + rd() * 1.3, 6.5 + rd() * 4.0, false);
    if (rd() < 0.6) { const r = 0.55 + rd() * 0.6, t = rd() * 6.28, x2 = x + Math.cos(t) * R * 0.8, z2 = z + Math.sin(t) * R * 0.8; if (fields(x2, z2).dEdge > 2.0) { add(boulderGeometry(4000 + n, r * 1.15, r * 0.8, r), x2, z2, terrainHeight(x2, z2) + r * 0.3); B.circles.push({ x: x2, z: z2, r: r * 1.1, a: 0.45 }); } }
  }
  // 别处：城墙后面隔一段冒出一组山石，高矮错开，露在墙头上面
  let s = 10;
  while (s < sC - 6) {
    const p0 = cv.at(s), f0 = fields(p0.x, p0.z);
    if (f0.dBase < 9) { s += 6; continue; }                                   // 基地背后留给 2.7 的大建筑
    if (fbm(s * 0.05 + su * 3.1 + sv * 7.7, 0.5, 2, 201) < 0.45) { s += 5; continue; }
    const cnt = 2 + Math.floor(rd() * 3);
    // 南墙外（朝着镜头的一边）的山石压矮、不加后排：镜头朝北看，高的东西会挡住下路的画面
    const south = (() => { const sg = fields(p0.x - p0.tz * 2, p0.z + p0.tx * 2).dEdge < f0.dEdge ? 1 : -1; return p0.tx * sg > 0.5; })();
    for (let k = 0; k < cnt && s < sC - 3; k++) {
      const R = 2.4 + rd() * 1.6, H = (4.4 + rd() * 4.6) * (south ? 0.42 : 1);
      crag(s, R * 0.62 - EDGE_C + 2.5 + rd() * 1.6, R, H, false);
      if (!south && rd() < 0.5) crag(s + (rd() - 0.5) * 2, R * 0.62 - EDGE_C + 6 + rd() * 3, 3 + rd() * 1.5, H + 2 + rd() * 4, false);
      s += R * 1.15;
    }
    s += 5 + rd() * 9;
  }
}

// ---------------------------------------------------------------- 河道两头：几级石阶从边路走进水里
function buildQuay(B: Builder, sv: number, rd: () => number) {
  for (const su of [-1, 1]) {
    const team = su < 0 ? 0 : 1;
    [0, 1, 2].forEach(row => {
      const pts: P2[] = []; for (let a = 0.05; a <= 6.6; a += 0.4) pts.push(toWorld(su * a, sv * (sideLaneW(a) - LANE_HW + 0.15 - row * 0.56)));
      const cv = curveOf(pts), mid = cv.at(cv.L / 2);
      course(B.list(team, "step", mid.x, mid.z), cv, rd, 0, cv.L - row * 0.5, -0.5 - row * 0.17, 0.0 - row * 0.17, 0.31, { base: 0, lmin: 1.1, lvar: 1.0, ch: 0.04, step: 0.8, seed: row * 4.1 + su + sv * 3, k: 1 - row * 0.03, len: 2.4, lv: 0.7, r: 0.05, K: 1 });
    });
  }
}

/** 全图的整墙、台阶、山石 */
export function createRamparts(tex: StoneTextures, opts: { cornerPier?: [boolean, boolean] } = {}): { group: THREE.Group; contact: { lines: Builder["lines"]; circles: Builder["circles"] }; tufts: Tuft[]; foam: Builder["foam"]; solids: Builder["solids"] } {
  const B = new Builder(), arcs = baseArcs(), edge = edgeLine();
  for (const su of [-1, 1]) {
    const team = su < 0 ? 0 : 1, rd = rng(5100 + team * 77);
    buildGate(B, GATES[0], su, 1, team, rd);
    buildDais(B, su, team, rd);
    // 基地的角上一座大墩：两道城墙在这里相接（出生点背后的大建筑是 2.7 的事，这里先把位置和高度占住）
    // 出生点的建筑放进来以后（2.7），角上这座占位的大墩就不要了
    if (opts.cornerPier?.[team] ?? true) { const [x, z] = toWorld(su * (A_CORNER - EDGE_C * Math.SQRT2), 0); pier(B, team, x, z, terrainHeight(x, z) - 0.3, 6.2, 2.5, 3.0); }
    for (const sv of [-1, 1]) {
      buildGate(B, GATES[1], su, sv, team, rd);
      arcs.forEach((arc, i) => buildRampart(B, arc.map(([a, w]) => toWorld(su * a, sv * w) as P2), team, rd, 40 + i * 13 + (su + 1) * 5 + (sv + 1) * 3, 1.0, i === 0 ? 1.0 : 0.6));
      buildEdge(B, edge, su, sv, team, rd, 300 + (su + 1) * 50 + (sv + 1) * 20);
      buildCliffs(B, edge, su, sv, rd);
    }
  }
  for (const sv of [-1, 1]) { buildIsland(B, sv, rng(6200 + sv)); buildQuay(B, sv, rng(6300 + sv)); }
  return { group: B.build(tex, "ramparts"), contact: { lines: B.lines, circles: B.circles }, tufts: B.tufts, foam: B.foam, solids: B.solids };
}
