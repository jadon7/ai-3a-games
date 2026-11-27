// 赛道定义与几何查询（纯数学，不依赖 three.js，可在 node 里单测）
// 平面坐标：x 向东、y 向北，单位米；航向角逆时针为正。渲染时映射为 three 的 (x, 0, -y)。
// 赛道由直线 S 和圆弧 A 组成（与影片同一套画法），顺时针行驶：右弯角度为负。

export const TRACK_W = 11.0;
export const HALF_W = TRACK_W / 2;
export const SURF = { ASPHALT: 0, KERB: 1, GRASS: 2, GRAVEL: 3 };
const DEG = Math.PI / 180;

// ['S', 长度 | null(由闭合求解)]  ['A', 半径, 角度(度，左正右负), 名称]
export const SEGMENTS = [
  ['S', 215],
  ['A', 48, -95, 'T1 大师弯'],     // 影片里的主弯：R48、95° 右弯
  ['S', 75],
  ['A', 62, 48, 'T2'],
  ['S', 45],
  ['A', 34, -133, 'T3'],
  ['S', null],                      // 背面直道（求解）
  ['A', 85, -62, 'T4 长右'],
  ['S', 40],
  ['A', 30, 104, 'T5', 8],          // 第 5 个值：缓冲区外扩上限（这里紧挨发卡弯出口，收窄）
  ['S', 80],
  ['A', 23, -172, 'T6 发卡'],
  ['S', 95],
  ['A', 55, 40, 'T7'],
  ['S', null],                      // 回主直道前的连接直道（求解）
  ['A', 40, -90, 'T8'],
  ['S', 120],
];

function solveClosure(segs) {
  // 角度和必须为 -360°；两段未知直道的长度由位置闭合线性求解
  let total = 0;
  for (const s of segs) if (s[0] === 'A') total += s[2];
  if (Math.abs(total + 360) > 1e-6) throw new Error('弯角之和必须为 -360°，当前 ' + total);
  const unk = []; let x = 0, y = 0, h = 0;
  for (const s of segs) {
    if (s[0] === 'S') {
      if (s[1] == null) unk.push([Math.cos(h), Math.sin(h), s]);
      else { x += Math.cos(h) * s[1]; y += Math.sin(h) * s[1]; }
    } else {
      const R = s[1], a = s[2] * DEG, sg = Math.sign(a);
      const cx = x - Math.sin(h) * R * sg, cy = y + Math.cos(h) * R * sg;
      h += a;
      x = cx + Math.sin(h) * R * sg; y = cy - Math.cos(h) * R * sg;
    }
  }
  if (unk.length !== 2) throw new Error('需要恰好两段待求解直道');
  const [a1, b1] = unk[0], [a2, b2] = unk[1];
  const det = a1 * b2 - a2 * b1;
  const l1 = (-x * b2 + a2 * y) / det, l2 = (-a1 * y + b1 * x) / det;
  unk[0][2][1] = l1; unk[1][2][1] = l2;
  return [l1, l2];
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function buildTrack() {
  const segs = SEGMENTS.map(s => s.slice());
  const solved = solveClosure(segs);
  // 解析采样，每米一个点
  const ranges = []; let s0 = 0, x = 0, y = 0, h = 0;
  for (const sg of segs) {
    if (sg[0] === 'S') {
      ranges.push({ type: 'S', s0, s1: s0 + sg[1], x, y, h, len: sg[1] });
      x += Math.cos(h) * sg[1]; y += Math.sin(h) * sg[1]; s0 += sg[1];
    } else {
      const R = sg[1], a = sg[2] * DEG, dir = Math.sign(a), len = Math.abs(a) * R;
      const cx = x - Math.sin(h) * R * dir, cy = y + Math.cos(h) * R * dir;
      ranges.push({ type: 'A', s0, s1: s0 + len, x, y, h, len, R, ang: a, dir, cx, cy, name: sg[3], runoff: sg[4] });
      h += a; x = cx + Math.sin(h) * R * dir; y = cy - Math.cos(h) * R * dir; s0 += len;
    }
  }
  const Lraw = s0;
  const N = Math.round(Lraw), ds = Lraw / N, L = Lraw;
  const px = new Float32Array(N), py = new Float32Array(N), hx = new Float32Array(N), hy = new Float32Array(N), kk = new Float32Array(N);

  function sampleRaw(s) {
    s = ((s % L) + L) % L;
    let r = ranges[ranges.length - 1];
    for (const q of ranges) if (s < q.s1) { r = q; break; }
    const u = s - r.s0;
    if (r.type === 'S') return { x: r.x + Math.cos(r.h) * u, y: r.y + Math.sin(r.h) * u, h: r.h, k: 0 };
    const hh = r.h + r.dir * u / r.R;
    return { x: r.cx + Math.sin(hh) * r.R * r.dir, y: r.cy - Math.cos(hh) * r.R * r.dir, h: hh, k: r.dir / r.R };
  }
  // 把赛道平移到包围盒中心
  let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
  for (let i = 0; i < N; i++) { const p = sampleRaw(i * ds); minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x); miny = Math.min(miny, p.y); maxy = Math.max(maxy, p.y); }
  const ox = (minx + maxx) / 2, oy = (miny + maxy) / 2;
  for (const r of ranges) { r.x -= ox; r.y -= oy; if (r.type === 'A') { r.cx -= ox; r.cy -= oy; } }
  for (let i = 0; i < N; i++) { const p = sampleRaw(i * ds); px[i] = p.x; py[i] = p.y; hx[i] = Math.cos(p.h); hy[i] = Math.sin(p.h); kk[i] = p.k; }

  const T = { L, N, ds, px, py, hx, hy, k: kk, ranges, solved, bounds: { minx: minx - ox, maxx: maxx - ox, miny: miny - oy, maxy: maxy - oy } };
  T.wrapS = s => ((s % L) + L) % L;
  T.idx = s => ((Math.floor(s / ds) % N) + N) % N;
  T.sample = s => sampleRaw(s);
  // 中心线左侧为 d>0。返回世界坐标
  T.offset = (s, d) => { const p = sampleRaw(s); return { x: p.x - Math.sin(p.h) * d, y: p.y + Math.cos(p.h) * d, h: p.h, k: p.k }; };
  T.deltaS = (a, b) => { let d = a - b; if (d > L / 2) d -= L; if (d < -L / 2) d += L; return d; }; // a 相对 b 的带符号里程差

  // ---- 护栏外扩（弯外侧缓冲区）----
  const BASE_L = 9.5, BASE_R = 9.5;
  const dL = new Float32Array(N).fill(BASE_L), dR = new Float32Array(N).fill(BASE_R);   // 都存正数距离
  const gravel = [];   // {side: +1 左 / -1 右, s0, s1}
  for (const r of ranges) {
    if (r.type !== 'A') continue;
    const deg = Math.abs(r.ang) / DEG; if (deg < 35) continue;
    const extra = Math.min(r.runoff ?? 22, 7 + deg * 0.085 + r.R * 0.09);
    const side = -r.dir;                 // 弯外侧
    const a0 = r.s0 - 30, a1 = r.s0 + r.len * 0.45, b0 = r.s1 + 10, b1 = r.s1 + 62;
    const arr = side > 0 ? dL : dR;
    for (let s = a0; s <= b1; s += ds) {
      const w = smooth(a0, a1, s) * (1 - smooth(b0, b1, s));
      const i = T.idx(s); arr[i] = Math.max(arr[i], (side > 0 ? BASE_L : BASE_R) + extra * w);
    }
    gravel.push({ side, s0: a0 + 8, s1: b1 - 8, name: r.name });
  }
  T.dL = dL; T.dR = dR; T.gravel = gravel;
  T.barrierL = s => { const f = T.wrapS(s) / ds, i = Math.floor(f) % N, j = (i + 1) % N, t = f - Math.floor(f); return dL[i] * (1 - t) + dL[j] * t; };
  T.barrierR = s => { const f = T.wrapS(s) / ds, i = Math.floor(f) % N, j = (i + 1) % N, t = f - Math.floor(f); return dR[i] * (1 - t) + dR[j] * t; };

  // ---- 路肩 ----
  const kerbs = [];   // {side, s0, s1, kind:'apex'|'exit'}
  for (const r of ranges) {
    if (r.type !== 'A') continue;
    const deg = Math.abs(r.ang) / DEG; if (deg < 30) continue;
    kerbs.push({ side: r.dir, s0: r.s0 - 6, s1: r.s1 + 6, kind: 'apex' });           // 弯内侧
    kerbs.push({ side: -r.dir, s0: r.s0 - 34, s1: r.s0 + 6, kind: 'exit' });          // 入弯外侧
    kerbs.push({ side: -r.dir, s0: r.s1 - 8, s1: r.s1 + 40, kind: 'exit' });          // 出弯外侧
  }
  T.kerbs = kerbs;
  const KERB_W = 1.15;
  T.KERB_W = KERB_W;
  const kerbMask = new Uint8Array(N);   // bit0 左侧有路肩，bit1 右侧
  for (const kb of kerbs) for (let s = kb.s0; s <= kb.s1; s += ds) kerbMask[T.idx(s)] |= kb.side > 0 ? 1 : 2;
  T.kerbMask = kerbMask;
  const gravelMask = new Uint8Array(N);
  for (const g of gravel) for (let s = g.s0; s <= g.s1; s += ds) gravelMask[T.idx(s)] |= g.side > 0 ? 1 : 2;
  T.gravelMask = gravelMask;
  const GRASS_STRIP = 2.6;   // 沥青/路肩外先有一条草带，再是砾石
  T.GRASS_STRIP = GRASS_STRIP;

  T.surface = (s, d) => {
    const ad = Math.abs(d);
    if (ad <= HALF_W) return SURF.ASPHALT;
    const i = T.idx(s), bit = d > 0 ? 1 : 2;
    if (ad <= HALF_W + KERB_W && (kerbMask[i] & bit)) return SURF.KERB;
    if ((gravelMask[i] & bit) && ad > HALF_W + GRASS_STRIP) return SURF.GRAVEL;
    return SURF.GRASS;
  };

  // ---- 世界坐标 → 赛道坐标 (s, d)；hint 为上次的索引，做局部搜索 ----
  T.toTrack = (x, y, hint = -1, span = 30) => {
    let best = -1, bd = 1e18;
    if (hint < 0) {
      for (let i = 0; i < N; i += 4) { const dx = x - px[i], dy = y - py[i], d2 = dx * dx + dy * dy; if (d2 < bd) { bd = d2; best = i; } }
      hint = best; span = 6; bd = 1e18;
    }
    for (let o = -span; o <= span; o++) {
      const i = ((hint + o) % N + N) % N; const dx = x - px[i], dy = y - py[i], d2 = dx * dx + dy * dy;
      if (d2 < bd) { bd = d2; best = i; }
    }
    const dx = x - px[best], dy = y - py[best];
    const along = dx * hx[best] + dy * hy[best];
    const lat = -dx * hy[best] + dy * hx[best];
    // 曲率修正：把沿切线的偏差换算成里程
    const s = T.wrapS(best * ds + along / Math.max(0.3, 1 - kk[best] * lat));
    return { s, d: lat, i: best };
  };

  // ---- 赛车线（最小曲率松弛）与速度剖面，给 AI 和路面橡胶痕用 ----
  T.buildRacingLine = (margin = 1.5, iters = 500) => {
    const step = 2, M = Math.floor(N / step);
    const off = new Float32Array(M), lim = HALF_W - margin;
    const X = new Float32Array(M), Y = new Float32Array(M);
    const upd = () => { for (let j = 0; j < M; j++) { const i = j * step; X[j] = px[i] - hy[i] * off[j]; Y[j] = py[i] + hx[i] * off[j]; } };
    upd();
    for (let it = 0; it < iters; it++) {
      for (let j = 0; j < M; j++) {
        const a = (j - 1 + M) % M, b = (j + 1) % M, i = j * step;
        const mx = (X[a] + X[b]) / 2, my = (Y[a] + Y[b]) / 2;
        const lat = -(mx - px[i]) * hy[i] + (my - py[i]) * hx[i];
        off[j] = Math.max(-lim, Math.min(lim, off[j] + (lat - off[j]) * 0.5));
        X[j] = px[i] - hy[i] * off[j]; Y[j] = py[i] + hx[i] * off[j];
      }
    }
    // 回写到每米一个点，并平滑
    const lineD = new Float32Array(N);
    for (let i = 0; i < N; i++) { const f = i / step, j = Math.floor(f) % M, j2 = (j + 1) % M, t = f - Math.floor(f); lineD[i] = off[j] * (1 - t) + off[j2] * t; }
    const lx = new Float32Array(N), ly = new Float32Array(N), lk = new Float32Array(N);
    for (let i = 0; i < N; i++) { lx[i] = px[i] - hy[i] * lineD[i]; ly[i] = py[i] + hx[i] * lineD[i]; }
    const W = 5;
    for (let i = 0; i < N; i++) {
      const a = (i - W + N) % N, b = (i + W) % N;
      const ax = lx[i] - lx[a], ay = ly[i] - ly[a], bx = lx[b] - lx[i], by = ly[b] - ly[i];
      const cross = ax * by - ay * bx, la = Math.hypot(ax, ay), lb = Math.hypot(bx, by), lc = Math.hypot(lx[b] - lx[a], ly[b] - ly[a]);
      lk[i] = 2 * cross / Math.max(1e-6, la * lb * lc);
    }
    T.lineD = lineD; T.lineX = lx; T.lineY = ly; T.lineK = lk;
    return T;
  };
  T.speedProfile = (mu = 1.0, aAcc = 5.0, aBrk = 9.0, vmax = 68) => {
    const v = new Float32Array(N), g = 9.81, lk = T.lineK;
    for (let i = 0; i < N; i++) v[i] = Math.min(vmax, Math.sqrt(mu * g / Math.max(1e-4, Math.abs(lk[i]))));
    for (let pass = 0; pass < 2; pass++) {
      for (let n = 2 * N; n >= 0; n--) { const i = n % N, j = (i + 1) % N; v[i] = Math.min(v[i], Math.sqrt(v[j] * v[j] + 2 * aBrk * ds)); }
      for (let n = 0; n < 2 * N; n++) { const i = n % N, j = (i + 1) % N; v[j] = Math.min(v[j], Math.sqrt(v[i] * v[i] + 2 * aAcc * ds)); }
    }
    return v;
  };

  // 发车格：起终点线在 s = 0，格子在线后
  T.gridSlot = n => { const s = L - 9 - n * 8.5, d = (n % 2 === 0 ? 1 : -1) * 2.4; const p = T.offset(s, d); return { x: p.x, y: p.y, h: p.h, s, d }; };
  return T;
}
