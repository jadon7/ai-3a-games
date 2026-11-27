// 池核（Poolcore）场景：地下室走廊北墙开一道门进去，一片铺满白瓷砖的泳池空间——门厅的浅水池、拱廊、立着圆柱的深水大池、
// 一条淹了水的长廊、几间小室。没有窗，光从天花板上的采光井和水下的池灯来。
// 全部用代码搭：0.5 米一格的平面图 → 网格；瓷砖是着色器里按米画的；光照在加载时用碰撞网格打射线烘到顶点上（直射 + 三次反弹）；
// 水面是一张平面（镜像相机渲染出的倒影 + 菲涅耳），水下的瓷砖在瓷砖着色器里处理（折射扭动、吸收成青色、焦散）。
import * as THREE from 'three';
import { b2t } from './config.js';

export const POOL = { CS: 0.5, X0: 14.0, Y0: -0.5, NX: 36, NY: 42, Z0: -3.225, WATER: 0.10, SHAFT: 3.55, DOOR: [21.5, 23.0, 2.3] };      // 格子大小、原点、格数；池边地面的高度；水面比池边低多少；采光井顶；门洞 x 范围和高
const TILE = 0.125, WELL_RAD = 11.0, LAMP_RAD = 19.0, ALB = 0.78;

const WAVES_GLSL = /* glsl */`
uniform float uTime; uniform vec4 uRip[8];
// 水面的小波：六个方向、波长各不相同的正弦波。g 是坡度，H 是二阶导（hxx, hzz, hxz），焦散的亮暗就是由它算出来的
void waves(vec2 p, out vec2 g, out vec3 H){
  g = vec2(0.0); H = vec3(0.0);
  p += 0.22 * sin(p.yx * 1.31 + vec2(uTime * 0.23, -uTime * 0.19)) + 0.11 * sin(p.yx * 2.9 + vec2(1.7 - uTime * 0.31, uTime * 0.27));
  #define WV(dx, dz, k, a, w, ph) { vec2 d = vec2(dx, dz); float t_ = dot(d, p) * k + uTime * w + ph; float s_ = sin(t_), c_ = cos(t_); g += d * (a * k * c_); H -= vec3(d.x * d.x, d.y * d.y, d.x * d.y) * (a * k * k * s_); }
  WV(0.978, 0.208, 4.7, 0.0050, 1.7, 0.0)
  WV(0.391, 0.920, 6.3, 0.0040, 2.1, 1.7)
  WV(-0.469, 0.883, 8.9, 0.0029, 2.7, 4.1)
  WV(-0.956, 0.292, 11.3, 0.0022, 3.1, 2.6)
  WV(-0.906, -0.423, 14.1, 0.0017, 3.7, 5.3)
  WV(-0.326, -0.946, 17.9, 0.0013, 4.3, 0.9)
  WV(0.485, -0.875, 22.7, 0.0009, 5.1, 3.3)
  WV(0.946, -0.326, 7.7, 0.0030, 2.4, 2.2)
}
// 人踩水、子弹入水激起的一圈圈涟漪（只算坡度）
vec2 ripG(vec2 p){
  vec2 g = vec2(0.0);
  for (int i = 0; i < 8; i++) {
    vec4 r = uRip[i]; float age = uTime - r.z; if (r.w <= 0.0 || age < 0.0 || age > 4.5) continue;
    vec2 d = p - r.xy; float dist = length(d) + 1e-4, front = age * 0.9;
    float env = r.w * exp(-age * 1.0) * smoothstep(front + 0.12, front - 0.1, dist) * smoothstep(-1.0, 0.0, dist - front) / (1.0 + dist);
    g += d / dist * (env * 0.13 * cos((dist - front) * 26.0));
  }
  return g;
}`;

const _ray = new THREE.Ray(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

export class Pool {
  // L：共享的光照 uniform；LIGHT_GLSL：动态光（枪灯、火光、闪光弹）的着色器片段。都从 world.js 传进来
  constructor(L, LIGHT_GLSL) {
    this.L = L; this.LIGHT_GLSL = LIGHT_GLSL;
    this.z0 = POOL.Z0; this.zw = POOL.Z0 - POOL.WATER; this.time = 0; this.ripI = 0;
    this.group = new THREE.Group(); this.group.name = 'pool';
    this.U = {
      uTime: { value: 0 }, uRip: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, -99, 0)) },
      uWaterY: { value: this.zw }, uClipY: { value: -1e4 }, uWellRad: { value: new THREE.Vector3() }, uLampRad: { value: new THREE.Vector3() },
      uWells: { value: [] }, uCeilY: { value: this.z0 + POOL.SHAFT }, uLane: { value: new THREE.Vector4(18.5, 10.5, 28.0, 13.5) }, uDeckY: { value: this.z0 },
    };
    this._layout();
  }

  // ---------------------------------------------------------------- 平面图（0.5 米一格）。f：地面比池边低多少；c：顶高
  _layout() {
    const { CS, X0, Y0, NX, NY } = POOL, cells = this.cells = new Array(NX * NY).fill(null);
    const each = (x0, y0, x1, y1, fn) => { for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) { const cx = X0 + (i + 0.5) * CS, cy = Y0 + (j + 0.5) * CS; if (cx > x0 && cx < x1 && cy > y0 && cy < y1) fn(j * NX + i); } };
    const fill = (x0, y0, x1, y1, f, c) => each(x0, y0, x1, y1, (k) => { cells[k] = { f, c: c ?? (cells[k] ? cells[k].c : 3.0) }; });
    const [dx0, dx1, dh] = POOL.DOOR;
    fill(dx0, -0.5, dx1, 0.5, 0, dh);                                   // 门槛：穿过地下室走廊的北墙
    fill(18.0, 0.5, 27.0, 6.0, 0, 3.0); fill(20.0, 2.0, 25.0, 4.5, -0.40);       // 门厅 + 正对门的浅水池
    for (const x of [18.5, 21.5, 24.5]) fill(x, 6.0, x + 2.0, 6.5, 0, 2.6);      // 三连拱
    fill(16.5, 6.5, 30.0, 15.0, 0, 3.0);                                // 大池厅
    fill(18.5, 8.5, 28.0, 13.5, -0.95);                                 // 深水池
    [-0.19, -0.38, -0.57, -0.76].forEach((f, n) => fill(20.0, 8.5 + n * 0.5, 26.5, 9.0 + n * 0.5, f));      // 南边居中的一段下水台阶（两侧直接是深水：上下岸只能走台阶正面）
    fill(14.5, 1.0, 16.0, 19.5, -0.40, 2.4);                            // 西边那条淹了水的长廊
    fill(16.0, 2.5, 17.5, 4.0, -0.40, 2.4); fill(17.5, 2.5, 18.0, 4.0, -0.19, 2.4);
    fill(16.0, 8.0, 16.5, 9.5, -0.19, 2.4); fill(16.0, 12.0, 16.5, 13.5, -0.19, 2.4);
    fill(16.5, 15.5, 21.5, 20.0, 0, 3.0); fill(17.5, 16.5, 20.5, 19.5, -0.25); fill(18.0, 17.0, 20.0, 19.0, -0.57);      // 西北小室：下沉的方池
    fill(18.5, 15.0, 20.0, 15.5, 0, 2.6); fill(16.0, 17.0, 16.5, 18.5, -0.19, 2.4);
    fill(22.0, 15.5, 27.0, 20.0, -0.40, 3.0); fill(24.0, 15.0, 25.5, 15.5, -0.19, 2.6); fill(21.5, 17.5, 22.0, 19.0, -0.19, 2.4);      // 北边的柱厅（整间浅水）
    fill(27.5, 15.5, 31.5, 20.0, -0.40, 2.4); fill(27.0, 16.5, 27.5, 18.0, -0.40, 2.4);      // 东北角的暗室（没有采光井，只有池灯）
    fill(30.5, 7.0, 31.5, 15.5, 0, 2.4); fill(30.0, 7.5, 30.5, 9.0, 0, 2.4); fill(30.0, 12.5, 30.5, 14.0, 0, 2.4);       // 东边的窄道
    // 采光井 [x0, y0, x1, y1]
    this.wells = [[20.5, 2.5, 22.0, 4.0], [23.0, 2.5, 24.5, 4.0],
      [19.5, 9.5, 21.5, 11.0], [22.5, 9.5, 24.5, 11.0], [25.5, 9.5, 27.5, 11.0], [19.5, 12.0, 21.5, 13.0], [22.5, 12.0, 24.5, 13.0], [25.5, 12.0, 27.5, 13.0],
      [15.0, 5.0, 15.5, 6.0], [15.0, 10.5, 15.5, 11.5], [15.0, 16.0, 15.5, 17.0], [18.5, 17.5, 19.5, 18.5], [23.0, 17.5, 26.0, 18.5]];
    this.wells.forEach((w, wi) => each(w[0], w[1], w[2], w[3], (k) => { if (cells[k]) { cells[k].c = POOL.SHAFT; cells[k].well = wi; } }));
    // 拱：[沿 x 还是沿 y 开口, a0, a1（开口两边）, b0, b1（墙厚方向）, 起拱高, 拱顶高]
    this.arches = [...[18.5, 21.5, 24.5].map((x) => ['x', x, x + 2.0, 6.0, 6.5, 1.55, 2.6]), ['x', 18.5, 20.0, 15.0, 15.5, 1.7, 2.6], ['x', 24.0, 25.5, 15.0, 15.5, 1.7, 2.6],
      ['y', 2.5, 4.0, 17.5, 18.0, 1.6, 2.4], ['y', 8.0, 9.5, 16.0, 16.5, 1.6, 2.4], ['y', 12.0, 13.5, 16.0, 16.5, 1.6, 2.4], ['y', 17.0, 18.5, 16.0, 16.5, 1.6, 2.4], ['y', 17.5, 19.0, 21.5, 22.0, 1.6, 2.4]];
    this.pillars = [[17.5, 7.5], [17.5, 14.0], [29.0, 7.5], [29.0, 14.0], [20.5, 11.5], [23.5, 11.5], [26.5, 11.5], [19.0, 5.0], [26.0, 5.0], [23.5, 16.75], [25.5, 16.75], [23.5, 19.0], [25.5, 19.0]];
    // 水下的池灯 [x, y, 朝向 nx, ny, 在水面下多深]
    this.lamps = [[20.5, 13.5, 0, -1, 0.42], [23.25, 13.5, 0, -1, 0.42], [26.0, 13.5, 0, -1, 0.42], [18.5, 12.0, 1, 0, 0.42], [28.0, 12.0, -1, 0, 0.42],
      [20.0, 3.25, 1, 0, 0.16], [25.0, 3.25, -1, 0, 0.16], [14.5, 3.0, 1, 0, 0.16], [14.5, 8.0, 1, 0, 0.16], [14.5, 13.0, 1, 0, 0.16], [14.5, 18.0, 1, 0, 0.16],
      [22.0, 16.5, 1, 0, 0.16], [27.0, 19.25, -1, 0, 0.16], [31.5, 17.75, -1, 0, 0.16], [29.5, 20.0, 0, -1, 0.16], [18.0, 18.0, 1, 0, 0.28]];
  }
  cell(x, y) { const i = Math.floor((x - POOL.X0) / POOL.CS), j = Math.floor((y - POOL.Y0) / POOL.CS); return i >= 0 && j >= 0 && i < POOL.NX && j < POOL.NY ? this.cells[j * POOL.NX + i] : null; }
  // (x,y) 处、脚在 feetZ 高度时的水深（Blender 坐标）
  depthAt(x, y, feetZ) { const c = this.cell(x, y); if (!c) return 0; return Math.max(0, this.zw - Math.max(feetZ, this.z0 + c.f)); }
  // 射线（three 坐标）在 maxT 之内穿过水面的那一点；没有穿过水面返回 null
  waterHit(o, d, maxT) {
    const yw = this.zw; if (o.y <= yw || d.y >= -1e-4) return null;
    const t = (yw - o.y) / d.y; if (t > maxT) return null;
    const p = _v.copy(o).addScaledVector(d, t), c = this.cell(p.x, -p.z);
    return c && this.z0 + c.f < yw - 0.03 ? p.clone() : null;
  }
  ripple(x, y, amp = 1) { this.U.uRip.value[this.ripI++ % 8].set(x, -y, this.time, amp); }

  // ---------------------------------------------------------------- 网格
  build() {
    const { CS, X0, Y0, NX, NY } = POOL, z0 = this.z0, cells = this.cells;
    const P = [], N = [], UV = [], I = [], map = new Map();
    // 顶点（Blender 坐标 + 法线）；位置和法线都相同的共用一个，烘出来的光照才连得上
    const vert = (x, y, z, nx, ny, nz, u, v) => {
      const key = `${Math.round(x * 500)},${Math.round(y * 500)},${Math.round(z * 500)},${Math.round(nx * 50)},${Math.round(ny * 50)},${Math.round(nz * 50)}`;
      let i = map.get(key); if (i !== undefined) return i;
      i = P.length / 3; map.set(key, i); P.push(x, z, -y); N.push(nx, nz, -ny); UV.push(u, v); return i;
    };
    const quad = (a, b, c, d) => { I.push(a, b, c, a, c, d); };
    const zcuts = (za, zb) => { const out = [za]; for (let z = Math.ceil((za - z0) / CS + 1e-6) * CS + z0; z < zb - 1e-6; z += CS) if (z > za + 1e-6) out.push(z); out.push(zb); return out; };
    // 竖直的墙面：沿一条水平线段 (ax,ay)-(bx,by)，从 za 到 zb，法线 (nx,ny)
    const wall = (ax, ay, bx, by, za, zb, nx, ny) => {
      if (zb - za < 1e-4) return; const zs = zcuts(za, zb), ua = nx !== 0 ? ay : ax, ub = nx !== 0 ? by : bx;
      for (let s = 0; s < zs.length - 1; s++) quad(vert(ax, ay, zs[s], nx, ny, 0, ua, zs[s] - z0), vert(bx, by, zs[s], nx, ny, 0, ub, zs[s] - z0), vert(bx, by, zs[s + 1], nx, ny, 0, ub, zs[s + 1] - z0), vert(ax, ay, zs[s + 1], nx, ny, 0, ua, zs[s + 1] - z0));
    };
    const at = (i, j) => (i >= 0 && j >= 0 && i < NX && j < NY ? cells[j * NX + i] : null);
    const panels = [];       // 采光井顶上的发光板
    for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const c = cells[j * NX + i]; if (!c) continue;
      const x0 = X0 + i * CS, x1 = x0 + CS, y0 = Y0 + j * CS, y1 = y0 + CS, zf = z0 + c.f, zc = z0 + c.c;
      quad(vert(x0, y0, zf, 0, 0, 1, x0, y0), vert(x1, y0, zf, 0, 0, 1, x1, y0), vert(x1, y1, zf, 0, 0, 1, x1, y1), vert(x0, y1, zf, 0, 0, 1, x0, y1));
      if (c.well !== undefined) panels.push([x0, y0, x1, y1]);
      else quad(vert(x0, y0, zc, 0, 0, -1, x0, y0), vert(x1, y0, zc, 0, 0, -1, x1, y0), vert(x1, y1, zc, 0, 0, -1, x1, y1), vert(x0, y1, zc, 0, 0, -1, x0, y1));
      for (const [di, dj, ax, ay, bx, by, nx, ny] of [[1, 0, x1, y0, x1, y1, -1, 0], [-1, 0, x0, y0, x0, y1, 1, 0], [0, 1, x0, y1, x1, y1, 0, -1], [0, -1, x0, y0, x1, y0, 0, 1]]) {
        const n = at(i + di, j + dj);
        if (!n) { if (j + dj < 0) continue; wall(ax, ay, bx, by, zf, zc, nx, ny); continue; }       // 最南一排是门槛，朝走廊那一面敞着
        if (n.f > c.f) wall(ax, ay, bx, by, zf, z0 + n.f, nx, ny);              // 池壁 / 台阶的立面
        if (n.c < c.c) wall(ax, ay, bx, by, z0 + n.c, zc, nx, ny);              // 顶的高差（采光井的井壁、矮廊的门楣）
      }
    }
    // 拱：把方门洞的两个上角填成圆弧
    for (const [ax_, a0, a1, b0, b1, hs, ht] of this.arches) {
      const ca = (a0 + a1) / 2, ra = (a1 - a0) / 2, rz = ht - hs, n = 14, pt = (a, b, z) => (ax_ === 'x' ? [a, b, z] : [b, a, z]);
      for (let k = 0; k < n; k++) {
        const t0 = Math.PI * k / n, t1 = Math.PI * (k + 1) / n, A0 = [ca + ra * Math.cos(t0), z0 + hs + rz * Math.sin(t0)], A1 = [ca + ra * Math.cos(t1), z0 + hs + rz * Math.sin(t1)];
        for (const [b, sgn] of [[b0, -1], [b1, 1]]) {          // 墙的两个面
          const nn = ax_ === 'x' ? [0, sgn] : [sgn, 0], q = (a, z) => { const p = pt(a, b, z); return vert(p[0], p[1], p[2], nn[0], nn[1], 0, a, z - z0); };
          quad(q(A0[0], A0[1]), q(A1[0], A1[1]), q(A1[0], z0 + ht), q(A0[0], z0 + ht));
        }
        const nrm = (t) => { const na = -Math.cos(t) / ra, nz = -Math.sin(t) / rz, l = Math.hypot(na, nz); return [na / l, nz / l]; };       // 拱腹：法线朝门洞里面
        const q2 = (A, t, b, s) => { const p = pt(A[0], b, A[1]), m = nrm(t); return ax_ === 'x' ? vert(p[0], p[1], p[2], m[0], 0, m[1], s, b) : vert(p[0], p[1], p[2], 0, m[0], m[1], s, b); };
        const s0 = ra * t0, s1 = ra * t1;
        quad(q2(A0, t0, b0, s0), q2(A1, t1, b0, s1), q2(A1, t1, b1, s1), q2(A0, t0, b1, s0));
      }
    }
    // 圆柱
    for (const [px, py] of this.pillars) {
      const c = this.cell(px, py); if (!c) continue; const r = 0.27, seg = 14, zs = zcuts(z0 + c.f, z0 + c.c);
      for (let s = 0; s < seg; s++) {
        const a0 = 2 * Math.PI * s / seg, a1 = 2 * Math.PI * (s + 1) / seg;
        for (let k = 0; k < zs.length - 1; k++) {
          const q = (a, z) => vert(px + r * Math.cos(a), py + r * Math.sin(a), z, Math.cos(a), Math.sin(a), 0, r * a, z - z0);
          quad(q(a0, zs[k]), q(a1, zs[k]), q(a1, zs[k + 1]), q(a0, zs[k + 1]));
        }
      }
    }
    // 走廊那一侧的门套（盖住在扫描墙上开洞留下的毛边）
    const [dx0, dx1, dh] = POOL.DOOR;
    const box = (x0, y0, zA, x1, y1, zB) => {
      wall(x0, y0, x1, y0, zA, zB, 0, -1); wall(x0, y1, x1, y1, zA, zB, 0, 1); wall(x0, y0, x0, y1, zA, zB, -1, 0); wall(x1, y0, x1, y1, zA, zB, 1, 0);
      for (const [z, nz] of [[zA, -1], [zB, 1]]) quad(vert(x0, y0, z, 0, 0, nz, x0, y0), vert(x1, y0, z, 0, 0, nz, x1, y0), vert(x1, y1, z, 0, 0, nz, x1, y1), vert(x0, y1, z, 0, 0, nz, x0, y1));
    };
    box(dx0 - 0.125, -0.56, z0, dx0, -0.44, z0 + dh + 0.125); box(dx1, -0.56, z0, dx1 + 0.125, -0.44, z0 + dh + 0.125); box(dx0, -0.56, z0 + dh, dx1, -0.44, z0 + dh + 0.125);

    const geo = this.geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
    geo.setAttribute('aL', new THREE.Float32BufferAttribute(new Float32Array(P.length).fill(0), 3)); geo.setIndex(I);
    this.tileMat = this._tileMaterial();
    const tiles = this.tiles = new THREE.Mesh(geo, this.tileMat); tiles.frustumCulled = false; this.group.add(tiles);
    // 发光板
    const pp = [], pi = [];
    for (const [x0, y0, x1, y1] of panels) { const b = pp.length / 3, z = z0 + POOL.SHAFT; for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) { const v = b2t(x, y, z); pp.push(v.x, v.y, v.z); } pi.push(b, b + 1, b + 2, b, b + 2, b + 3); }
    const pg = this.panelGeo = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.Float32BufferAttribute(pp, 3)); pg.setIndex(pi);
    const glow = (u, k) => new THREE.ShaderMaterial({ uniforms: { uRad: u, uK: { value: k }, uClipY: this.U.uClipY }, side: THREE.DoubleSide,
      vertexShader: `varying float vY; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vY = wp.y; gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: `uniform vec3 uRad; uniform float uK; uniform float uClipY; varying float vY; void main(){ if (vY < uClipY) discard; gl_FragColor = vec4(uRad * uK, 1.0); }` });
    const pm = new THREE.Mesh(pg, glow(this.U.uWellRad, 1)); pm.frustumCulled = false; this.group.add(pm);
    // 池灯：贴在池壁上的小圆片
    const lp = [], li = [];
    this.lampPts = this.lamps.map(([x, y, nx, ny, dep]) => {
      const c = new THREE.Vector3(x + nx * 0.012, y + ny * 0.012, this.zw - dep), r = 0.085, b = lp.length / 3, seg = 12;
      const t = [-ny, nx]; let v = b2t(c.x, c.y, c.z); lp.push(v.x, v.y, v.z);
      for (let s = 0; s < seg; s++) { const a = 2 * Math.PI * s / seg; v = b2t(c.x + t[0] * r * Math.cos(a), c.y + t[1] * r * Math.cos(a), c.z + r * Math.sin(a)); lp.push(v.x, v.y, v.z); li.push(b, b + 1 + s, b + 1 + (s + 1) % seg); }
      return { p: b2t(c.x + nx * 0.03, c.y + ny * 0.03, c.z), n: b2t(nx, ny, 0), area: Math.PI * r * r };
    });
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3)); lg.setIndex(li);
    const lm = new THREE.Mesh(lg, glow(this.U.uLampRad, 0.5)); lm.frustumCulled = false; this.group.add(lm);
    // 水面：一整张平面，比池边低 10 厘米——只有地面更低的地方（各个池子）才露得出来
    const wg = new THREE.BufferGeometry(), wx0 = X0, wx1 = X0 + NX * CS, wy0 = 0.5, wy1 = Y0 + NY * CS, wv = [[wx0, wy0], [wx1, wy0], [wx1, wy1], [wx0, wy1]].flatMap(([x, y]) => { const v = b2t(x, y, this.zw); return [v.x, v.y, v.z]; });
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wv, 3)); wg.setIndex([0, 1, 2, 0, 2, 3]);
    this.waterMat = this._waterMaterial();
    const water = this.water = new THREE.Mesh(wg, this.waterMat); water.frustumCulled = false; water.renderOrder = 2; this.group.add(water);
    // 镜像相机渲染倒影用
    this.rt = new THREE.WebGLRenderTarget(960, 540, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true });
    this.waterMat.uniforms.tRefl.value = this.rt.texture;
    this.mirror = new THREE.PerspectiveCamera(); this.mirror.layers.enable(1);
    // 采光井在天花上的范围（给瓷砖的镜面反射用，three 坐标的 x、z）
    this.U.uWells.value = this.wells.map(([x0, y0, x1, y1]) => new THREE.Vector4(x0, -y1, x1, -y0)); while (this.U.uWells.value.length < 16) this.U.uWells.value.push(new THREE.Vector4(0, 0, -1, -1));
    // 碰撞用：瓷砖网格在前，发光板在后（射线打到发光板要能认出来）
    const col = geo.clone(); for (const k of Object.keys(col.attributes)) if (k !== 'position') col.deleteAttribute(k);
    const col2 = pg.clone();
    // 圆柱是空心的壳：柱芯里塞两片只参与碰撞的小板，寻路时里面就不会被当成一块能站的地面
    const plug = [], plugI = [];
    for (const [px, py] of this.pillars) { const c = this.cell(px, py); if (!c) continue; for (const z of [z0 + c.f + 1.2, z0 + c.c - 0.5]) { const b = plug.length / 3, h = 0.18; for (const [x, y] of [[px - h, py - h], [px + h, py - h], [px + h, py + h], [px - h, py + h]]) { const v = b2t(x, y, z); plug.push(v.x, v.y, v.z); } plugI.push(b, b + 1, b + 2, b, b + 2, b + 3); } }
    const col3 = new THREE.BufferGeometry(); col3.setAttribute('position', new THREE.Float32BufferAttribute(plug, 3)); col3.setIndex(plugI);
    this.nTileTris = I.length / 3;
    return [col.toNonIndexed(), col2.toNonIndexed(), col3.toNonIndexed()];
  }

  // ---------------------------------------------------------------- 烘焙：每个顶点受到的光（采光井 / 池灯各一份），直射打阴影射线，再反弹三次；
  // 第三个数是"从这里能看到多少水面"（水面的反光在墙和顶上晃动，就按它的大小来）。算一次要几秒，结果按平面图的内容存在浏览器里，下次直接用
  bake(colGeo, tri0) {
    const geo = this.geo, pos = geo.attributes.position, nrm = geo.attributes.normal, idx = geo.index, nv = pos.count, nt = this.nTileTris, aL = geo.attributes.aL;
    let hsh = 2166136261; for (const ch of JSON.stringify([POOL, this.cells, this.wells, this.arches, this.pillars, this.lamps, nv, 'v3'])) hsh = Math.imul(hsh ^ ch.charCodeAt(0), 16777619) >>> 0;
    const key = 'poolBake_' + hsh;
    try { const c = localStorage.getItem(key); if (c) { const bin = atob(c), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); const f = new Float32Array(u8.buffer); if (f.length === nv * 3) { aL.array.set(f); aL.needsUpdate = true; return 0; } } } catch (e) { /* 存不了就每次现算 */ }
    const bvh = colGeo.boundsTree, cidx = colGeo.index;
    const E = [new Float32Array(nv), new Float32Array(nv)], WV = new Float32Array(nv);
    const hitTri = (h) => (cidx ? Math.floor(cidx.getX(h.faceIndex * 3) / 3) : h.faceIndex) - tri0;
    let rays = 0;
    const blocked = (o, d, far) => { rays++; _ray.origin.copy(o); _ray.direction.copy(d); return !!bvh.raycastFirst(_ray, THREE.DoubleSide, 0, far); };
    // 采光井：先打四个点，全亮或全黑就用这四个点的结果；只有半遮半露时才加密采样
    const grid = (x0, y0, x1, y1, nx, ny) => { const out = [], dA = (x1 - x0) * (y1 - y0) / (nx * ny); for (let a = 0; a < nx; a++) for (let b = 0; b < ny; b++) out.push({ p: b2t(x0 + (a + 0.5) * (x1 - x0) / nx, y0 + (b + 0.5) * (y1 - y0) / ny, this.z0 + POOL.SHAFT - 0.03), dA }); return out; };
    const wellS = this.wells.map(([x0, y0, x1, y1]) => ({ c: b2t((x0 + x1) / 2, (y0 + y1) / 2, this.z0 + POOL.SHAFT), coarse: grid(x0, y0, x1, y1, 2, 2), fine: grid(x0, y0, x1, y1, Math.max(2, Math.round((x1 - x0) / 0.375)), Math.max(2, Math.round((y1 - y0) / 0.375))) }));
    const o = new THREE.Vector3(), n = new THREE.Vector3(), d = new THREE.Vector3(), t1 = new THREE.Vector3(), t2 = new THREE.Vector3();
    const sample = (set) => { let e = 0, vis = 0, val = 0; for (const s of set) { d.subVectors(s.p, o); const dist = d.length(); d.multiplyScalar(1 / dist); const cp = n.dot(d), cl = d.y; if (cp <= 0.01 || cl <= 0.02) continue; val++; if (!blocked(o, d, dist - 0.04)) { vis++; e += s.dA * cp * cl / (dist * dist); } } return [e, vis, val]; };
    // 余弦加权的半球方向（固定的一组：同一面墙上相邻的顶点看的是同一组方向，结果是平滑的而不是一片噪点）
    const NG = 48, hemi = []; for (let k = 0; k < NG; k++) { const u = (k + 0.5) / NG, r = Math.sqrt(u), th = k * 2.399963; hemi.push([r * Math.cos(th), r * Math.sin(th), Math.sqrt(1 - u)]); }
    const hits = new Int32Array(nv * NG).fill(-1), under = new Uint8Array(nt);
    for (let t = 0; t < nt; t++) under[t] = (pos.getY(idx.getX(t * 3)) + pos.getY(idx.getX(t * 3 + 1)) + pos.getY(idx.getX(t * 3 + 2))) / 3 < this.zw - 0.01 ? 1 : 0;
    for (let i = 0; i < nv; i++) {
      n.fromBufferAttribute(nrm, i); o.fromBufferAttribute(pos, i).addScaledVector(n, 0.02);
      let ew = 0, el = 0;
      for (const w of wellS) {
        if (w.c.distanceToSquared(o) > 17 * 17) continue;
        const [e, vis, val] = sample(w.coarse); if (!val) continue;
        ew += vis === val || vis === 0 ? e : sample(w.fine)[0];
      }
      for (const s of this.lampPts) {
        d.subVectors(s.p, o); const dist = d.length(); if (dist > 9) continue; d.multiplyScalar(1 / dist);
        const cp = n.dot(d), cl = -s.n.dot(d); if (cp <= 0.01 || cl <= 0.02) continue;
        if (!blocked(o, d, dist - 0.04)) el += s.area * cp * cl / Math.max(dist * dist, 0.02) * (o.y > this.zw ? 0.45 : 1);      // 水下的灯照到水面以上的部分要弱不少
      }
      E[0][i] = ew; E[1][i] = el;
      // 半球采样：记下每条射线打到了哪个三角形
      if (Math.abs(n.y) < 0.9) t1.set(0, 1, 0).cross(n).normalize(); else t1.set(1, 0, 0).cross(n).normalize(); t2.crossVectors(n, t1);
      let wv = 0;
      for (let k = 0; k < NG; k++) {
        const h3 = hemi[k]; d.copy(t1).multiplyScalar(h3[0]).addScaledVector(t2, h3[1]).addScaledVector(n, h3[2]);
        rays++; _ray.origin.copy(o); _ray.direction.copy(d); const h = bvh.raycastFirst(_ray, THREE.DoubleSide, 0, 30);
        if (h) { const t = hitTri(h); if (t >= 0 && t < nt) { hits[i * NG + k] = t; if (under[t]) wv++; } }
      }
      WV[i] = o.y > this.zw ? wv / NG : 0;
    }
    // 反弹：打到的三角形把它受到的光漫反射回来
    const out = new Float32Array(nv * 3);
    for (let ch = 0; ch < 2; ch++) {
      let cur = E[ch]; const tot = Float32Array.from(cur);
      for (let b = 0; b < 3; b++) {
        const nxt = new Float32Array(nv);
        for (let i = 0; i < nv; i++) {
          let s = 0;
          for (let k = 0; k < NG; k++) { const t = hits[i * NG + k]; if (t < 0) continue; s += (cur[idx.getX(t * 3)] + cur[idx.getX(t * 3 + 1)] + cur[idx.getX(t * 3 + 2)]) / 3; }
          nxt[i] = ALB * s / NG;
        }
        for (let i = 0; i < nv; i++) tot[i] += nxt[i]; cur = nxt;
      }
      for (let i = 0; i < nv; i++) out[i * 3 + ch] = tot[i];
    }
    for (let i = 0; i < nv; i++) out[i * 3 + 2] = WV[i];
    // 相邻顶点互相平均两遍（阴影边界本来就是软的，抹掉的只是采样留下的斑驳）
    const nb = Array.from({ length: nv }, () => []);
    for (let t = 0; t < idx.count; t += 3) { const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2); nb[a].push(b, c); nb[b].push(a, c); nb[c].push(a, b); }
    for (let pass = 0; pass < 2; pass++) {
      const src = Float32Array.from(out);
      for (let i = 0; i < nv; i++) { const l = nb[i]; if (!l.length) continue; for (let ch = 0; ch < 3; ch++) { let s = 0; for (const j of l) s += src[j * 3 + ch]; out[i * 3 + ch] = 0.5 * src[i * 3 + ch] + 0.5 * s / l.length; } }
    }
    aL.array.set(out); aL.needsUpdate = true;
    try { const u8 = new Uint8Array(out.buffer); let bin = ''; for (let i = 0; i < u8.length; i += 8192) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); localStorage.setItem(key, btoa(bin)); } catch (e) { /* 存不了就算了 */ }
    return rays;
  }

  // ---------------------------------------------------------------- 材质
  _tileMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: { ...this.L, ...this.U }, side: THREE.DoubleSide,
      vertexShader: /* glsl */`
        attribute vec3 aL; varying vec2 vUv; varying vec3 vWP; varying vec3 vN; varying vec3 vVP; varying vec3 vL;
        void main(){ vUv = uv; vL = aL; vec4 wp = modelMatrix * vec4(position, 1.0); vWP = wp.xyz; vN = normalize(mat3(modelMatrix) * normal); vec4 vp = viewMatrix * wp; vVP = vp.xyz; gl_Position = projectionMatrix * vp; }`,
      fragmentShader: /* glsl */`
        uniform float uWaterY; uniform float uClipY; uniform vec3 uWellRad; uniform vec3 uLampRad; uniform vec4 uWells[16]; uniform float uCeilY; uniform vec4 uLane; uniform float uDeckY;
        varying vec2 vUv; varying vec3 vWP; varying vec3 vN; varying vec3 vVP; varying vec3 vL;
        ${this.LIGHT_GLSL}
        ${WAVES_GLSL}
        float hash1(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        // 一排线（宽 w、间隔 1）在 [x-fw/2, x+fw/2] 这一段里占多少：远处的砖缝按面积平均，不闪
        float lineCov(float x, float w, float fw){ float a = x - 0.5 * fw, b = x + 0.5 * fw; return clamp(((floor(b) * w + min(fract(b), w)) - (floor(a) * w + min(fract(a), w))) / fw, 0.0, 1.0); }
        void main(){
          if (vWP.y < uClipY) discard;
          vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
          vec3 V = normalize(vWP - cameraPosition);
          bool wallF = abs(N.y) < 0.5, under = vWP.y < uWaterY - 0.002;
          float depth = max(uWaterY - vWP.y, 0.0);
          vec2 tuv = vUv; float caus = 1.0; vec3 absorb = vec3(1.0); float scat = 0.0;
          vec2 g; vec3 H;
          if (under) {
            // 视线穿过水面的那一点的坡度：水下的砖缝跟着扭
            float tS = (uWaterY - cameraPosition.y) / min(V.y, -1e-3); vec3 S = cameraPosition + V * tS;
            waves(S.xz, g, H); g += ripG(S.xz);
            vec2 off = g * (0.25 + depth * 0.55);
            tuv += wallF ? vec2(off.x + off.y, 0.3 * (off.x - off.y)) : vec2(off.x, -off.y);
            // 焦散：光从上面穿过起伏的水面，汇聚的地方亮、散开的地方暗
            waves(vWP.xz, g, H); float D = depth * 0.85 + 0.12;
            float det = (1.0 + D * H.x) * (1.0 + D * H.y) - D * D * H.z * H.z;
            caus = mix(1.0, clamp(0.82 / max(abs(det), 0.2), 0.3, 3.6), smoothstep(0.0, 0.2, depth) * (wallF ? 0.55 : 1.0));
            float path = depth * (1.0 + 1.0 / max(-V.y, 0.3));
            absorb = exp(-vec3(0.62, 0.085, 0.06) * min(path, 6.0)); scat = 1.0 - exp(-0.22 * min(path, 6.0));
          }
          // 瓷砖
          vec2 q = tuv / ${TILE.toFixed(3)}; vec2 fw = max(fwidth(q), vec2(1e-4)); vec2 id = floor(q);
          float gw = 0.045, grout = 1.0 - (1.0 - lineCov(q.x, gw, fw.x)) * (1.0 - lineCov(q.y, gw, fw.y));
          float farK = smoothstep(0.35, 1.2, max(fw.x, fw.y));
          float rnd = mix(hash1(id), 0.5, farK), rnd2 = mix(hash1(id + 7.3), 0.5, farK);
          vec3 tile = vec3(0.86, 0.87, 0.86) * (0.95 + 0.07 * rnd) + vec3(0.012, 0.0, -0.012) * (rnd2 - 0.5);
          float hgt = vWP.y - uDeckY;
          if (wallF) {
            float band = smoothstep(uWaterY - 0.255, uWaterY - 0.245, vWP.y) * (1.0 - smoothstep(uWaterY + 0.12, uWaterY + 0.13, vWP.y));       // 水线上下那一圈深蓝的砖
            tile = mix(tile, vec3(0.07, 0.25, 0.50) * (0.75 + 0.5 * rnd), band);
            float stripe = smoothstep(1.245, 1.255, hgt) * (1.0 - smoothstep(1.37, 1.38, hgt));       // 齐胸高的一道青绿色腰线
            tile = mix(tile, vec3(0.13, 0.46, 0.50) * (0.8 + 0.4 * rnd2), stripe);
          } else if (N.y > 0.5 && under && vUv.x > uLane.x + 0.5 && vUv.x < uLane.z - 0.5 && vUv.y > uLane.y && vUv.y < uLane.w) {
            float ly = abs(fract((vUv.y - uLane.y) / 1.5 + 0.5) - 0.5) * 1.5;       // 深水区池底的泳道线
            tile = mix(tile, vec3(0.05, 0.16, 0.42), 1.0 - smoothstep(0.115, 0.13, ly));
          }
          vec3 alb = mix(tile, vec3(0.60, 0.61, 0.60), grout);
          // 光：烘焙的采光井 + 池灯，水下乘焦散；水面附近的墙和顶上有一层晃动的反光
          vec3 Es = vL.x * uWellRad + vL.y * uLampRad;
          if (under) Es *= caus;
          else if (vL.z > 0.004) { waves(vWP.xz * 1.15 + vWP.y * 0.7 + 3.7, g, H); Es *= 1.0 + clamp(vL.z * 2.0, 0.0, 0.4) * clamp((H.x + H.y) * 0.4, -0.5, 0.9); }       // 水面的反光在看得到水的墙和顶上晃
          vec3 Ed = dynLight(vWP, N, vVP);
          float ao = blobAO(vWP);
          vec3 col = alb * (Es * mix(1.0, ao, 0.7) + Ed) * 0.31831;
          if (under) col = col * absorb + vec3(0.10, 0.42, 0.44) * scat * (vL.x * uWellRad + vL.y * uLampRad + Ed * 0.3) * 0.31831 * 0.5;
          else {
            // 釉面：反射天花板上的采光井（每块砖朝向略有不同，倒影是一格一格碎开的）
            vec3 Nt = normalize(N + (vec3(rnd, rnd2, hash1(id + 3.1)) - 0.5) * 0.007 * (1.0 - farK));
            vec3 R = reflect(V, Nt); float fres = 0.035 + 0.965 * pow(1.0 - max(dot(-V, Nt), 0.0), 5.0);
            if (R.y > 0.02) {
              float tr = (uCeilY - vWP.y) / R.y; vec2 hp = vWP.xz + R.xz * tr; float m = 0.0, sft = 0.16 + 0.07 * min(tr, 8.0);       // 釉面不是镜子：倒影的边是糊的，越远越糊
              for (int i = 0; i < 16; i++) { vec4 w = uWells[i]; if (w.z < w.x) break; vec2 dd = min(hp - w.xy, w.zw - hp); m = max(m, smoothstep(-sft, sft, min(dd.x, dd.y))); }
              col += uWellRad * m * fres * (1.0 - grout) * 0.4;
            }
            // 枪灯在釉面上的高光
            vec3 Lw = uWLPos - vWP; float d2 = max(dot(Lw, Lw), 1e-3); vec3 l = Lw * inversesqrt(d2); float ca = dot(-l, uWLDir);
            float cone = smoothstep(uWLCos.z, uWLCos.y, ca);
            col += vec3(1.0, 0.97, 0.92) * (uWLE.x + uWLE.y) * uWLOn * cone * pow(max(dot(Nt, normalize(l - V)), 0.0), 180.0) * (1.0 - grout) * 0.6 / (12.566 * d2);
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
  }
  _waterMaterial() {
    return new THREE.ShaderMaterial({
      uniforms: { ...this.L, ...this.U, tRefl: { value: null }, uTexMat: { value: new THREE.Matrix4() } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      vertexShader: `varying vec3 vWP; varying vec3 vVP; void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vWP = wp.xyz; vec4 vp = viewMatrix * wp; vVP = vp.xyz; gl_Position = projectionMatrix * vp; }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tRefl; uniform mat4 uTexMat; uniform vec3 uWellRad; uniform vec3 uLampRad;
        varying vec3 vWP; varying vec3 vVP;
        ${this.LIGHT_GLSL}
        ${WAVES_GLSL}
        void main(){
          vec3 V = normalize(vWP - cameraPosition); float dist = length(vWP - cameraPosition);
          vec2 g; vec3 H; waves(vWP.xz, g, H); g += ripG(vWP.xz);
          vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
          float c = max(dot(-V, N), 0.0), F = 0.02 + 0.98 * pow(1.0 - c, 5.0);
          vec4 rc = uTexMat * vec4(vWP, 1.0);
          vec2 ruv = rc.xy / rc.w + N.xz * (0.34 / (1.0 + dist * 0.3));       // 倒影跟着水面的坡度晃
          vec3 refl = texture2D(tRefl, clamp(ruv, 0.001, 0.999)).rgb;
          // 枪灯打在水面上的亮点
          vec3 Lw = uWLPos - vWP; float d2 = max(dot(Lw, Lw), 1e-3); vec3 l = Lw * inversesqrt(d2); float ca = dot(-l, uWLDir);
          vec3 glint = vec3(1.0, 0.97, 0.92) * (uWLE.x + uWLE.y) * uWLOn * smoothstep(uWLCos.z, uWLCos.y, ca) * pow(max(dot(N, normalize(l - V)), 0.0), 320.0) * 1.5 / (12.566 * d2);
          float veil = 0.05;
          gl_FragColor = vec4(refl * F + glint + vec3(0.10, 0.40, 0.42) * (uWellRad * 0.02 + uLampRad * 0.0015) * veil, F + (1.0 - F) * veil);
        }`,
    });
  }

  setMode(M) {
    this.U.uWellRad.value.set(M.tint[0], M.tint[1], M.tint[2]).multiplyScalar(WELL_RAD * M.K);
    this.U.uLampRad.value.set(0.72, 1.0, 0.93).multiplyScalar(LAMP_RAD);
  }
  advance(dt) { this.time += dt; this.U.uTime.value = this.time; }

  // 每帧：镜头在池核里、而且在水面以上时，用镜像相机把场景渲染一遍当倒影（手臂和枪不进倒影）
  update(renderer, scene, camera) {
    if (!this.group.visible || !renderer) return;
    const cp = camera.position, yw = this.zw;
    if (cp.y <= yw + 0.02 || cp.x < POOL.X0 - 1 || cp.x > POOL.X0 + POOL.NX * POOL.CS + 1 || -cp.z < POOL.Y0 - 4 || -cp.z > POOL.Y0 + POOL.NY * POOL.CS + 1) return;
    const m = this.mirror, rot = new THREE.Matrix4().extractRotation(camera.matrixWorld);
    const look = _v.set(0, 0, -1).applyMatrix4(rot).add(cp); look.y = 2 * yw - look.y;
    m.position.set(cp.x, 2 * yw - cp.y, cp.z); m.up.set(0, 1, 0).applyMatrix4(rot); m.up.y = -m.up.y;
    m.lookAt(look); m.projectionMatrix.copy(camera.projectionMatrix); m.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    m.updateMatrixWorld(true); m.matrixWorldInverse.copy(m.matrixWorld).invert();
    this.waterMat.uniforms.uTexMat.value.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(m.projectionMatrix).multiply(m.matrixWorldInverse);
    // 水面以下的瓷砖不进倒影（着色器里按高度丢掉）。不用渲染器的全局裁剪面：那会让敌人、弹壳这些标准材质各多编译一套着色器，换来换去会卡
    const oldT = renderer.getRenderTarget();
    this.water.visible = false; this.U.uClipY.value = yw - 0.015;
    renderer.setRenderTarget(this.rt); renderer.setClearColor(0x000000, 1); renderer.clear(); renderer.render(scene, m);
    renderer.setRenderTarget(oldT); this.U.uClipY.value = -1e4; this.water.visible = true;
  }
}

// 在一块网格上开一个方洞：跨着洞口边的大三角形先细分，再把落在洞里的小三角形去掉。B = [x0,y0,z0,x1,y1,z1]（three 的世界坐标）
export function punchHole(o, B, lim = 0.06) {
  const src = o.geometry; src.computeBoundingBox();
  const wb = src.boundingBox.clone().applyMatrix4(o.matrixWorld);
  if (wb.max.x < B[0] || wb.min.x > B[3] || wb.max.y < B[1] || wb.min.y > B[4] || wb.max.z < B[2] || wb.min.z > B[5]) return false;
  const g = src.index ? src.toNonIndexed() : src.clone(), names = Object.keys(g.attributes), A = names.map((n) => g.attributes[n]), sz = A.map((a) => a.itemSize), tot = sz.reduce((s, v) => s + v, 0);
  const read = (i) => { const v = new Float32Array(tot); let k = 0; for (let a = 0; a < A.length; a++) for (let c = 0; c < sz[a]; c++) v[k++] = A[a].getComponent(i, c); return v; };
  const pi = names.indexOf('position'), po = sz.slice(0, pi).reduce((s, v) => s + v, 0), m = o.matrixWorld;
  const wp = (v) => _v2.set(v[po], v[po + 1], v[po + 2]).applyMatrix4(m).clone();
  const mid = (a, b) => { const v = new Float32Array(tot); for (let k = 0; k < tot; k++) v[k] = (a[k] + b[k]) / 2; return v; };
  const keep = [], stack = []; let cut = 0;
  for (let t = 0; t < A[pi].count; t += 3) stack.push([read(t), read(t + 1), read(t + 2), 0]);
  while (stack.length) {
    const [a, b, c, dep] = stack.pop(), pa = wp(a), pb = wp(b), pc = wp(c);
    const lo = pa.clone().min(pb).min(pc), hi = pa.clone().max(pb).max(pc);
    if (hi.x < B[0] || lo.x > B[3] || hi.y < B[1] || lo.y > B[4] || hi.z < B[2] || lo.z > B[5]) { keep.push(a, b, c); continue; }
    if (dep < 10 && Math.max(pa.distanceTo(pb), pb.distanceTo(pc), pc.distanceTo(pa)) > lim) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); stack.push([a, ab, ca, dep + 1], [ab, b, bc, dep + 1], [ca, bc, c, dep + 1], [ab, bc, ca, dep + 1]); continue; }
    const cx = (pa.x + pb.x + pc.x) / 3, cy = (pa.y + pb.y + pc.y) / 3, cz = (pa.z + pb.z + pc.z) / 3;
    if (cx > B[0] && cx < B[3] && cy > B[1] && cy < B[4] && cz > B[2] && cz < B[5]) { cut++; continue; }
    keep.push(a, b, c);
  }
  if (!cut) return false;
  const ng = new THREE.BufferGeometry(); let off = 0;
  for (let a = 0; a < A.length; a++) { const arr = new Float32Array(keep.length * sz[a]); for (let i = 0; i < keep.length; i++) for (let c = 0; c < sz[a]; c++) arr[i * sz[a] + c] = keep[i][off + c]; ng.setAttribute(names[a], new THREE.Float32BufferAttribute(arr, sz[a])); off += sz[a]; }
  o.geometry = ng; return true;
}
