// 伊缇的围巾飘带（第三阶段 iti-model）：两条从脖子后面拖出去的绯红长飘带，用代码模拟，不进模型。
// 为什么不进模型：Tripo 会把飘带烤成一块硬布，蒙皮跟着胯和腿走，跑起来飘不起来（模型里只留了脖子上那一圈围脖，建模图里飘带是抠掉的：art/hero_iti/make_ref.py）。
// 做法：
//   · 每条飘带是一串质点（弹簧质点链，Verlet 积分 + 距离约束）。第一个点钉在脖子后面（跟着脖子、胸口两根骨骼走），其余的有惯性、重力、空气阻力，
//     另加一点“风”：顺着身后吹、带一点往上托和左右的抖动——站着不动时飘带也在身后飘（设定图里就是这样），跑起来被空气阻力拉成一条直线。
//   · 不穿地（压在英雄脚下的地面高度以上），不穿身子（胸腔一根胶囊、胯一个球，把点推出去）。
//   · 瞬移（闪现、换位）：根上的点一帧里挪得太远，就把整条重置到新位置附近、速度清零。不然会拉出一条横贯画面的长带。
//   · 画成有宽度的带子，两面都画（各自一套顶点，背面法线朝反方向）。卡通厚涂的两阶：按太阳方向分亮面、暗面，交界很窄（STYLE.md 3.2）。
//     颜色、尾巴的火舌形、赤金细边都画在一张小贴图里（顶点色只管亮暗），尾部火舌靠贴图的透明度剪出来（alphaTest）。
//   · 网格挂在英雄的 group 下面（跟着隐藏、跟着从场景里拿掉），但顶点直接写世界坐标：不自动更新它的世界矩阵，一直是单位矩阵。
// 用法：英雄的 look 里写 scarf（数值是长度倍数，1 是标准长度；kit 的 look 或网址 ?look=scarf:1），hero.ts 的 loadHero 才挂。老英雄没有这个字段，一点不变。

import * as THREE from "three";

const SUN = new THREE.Vector3(-0.7, 0.72, -0.3).normalize();      // 和 world/main.ts 的 sunDir 一样（太阳从这边照过来）
const SUB = 1 / 120;                                               // 固定子步长：帧率高低（手机二十几帧、电脑一百多帧）飘带的样子一样
const N = 14;                                                      // 每条飘带的质点数（渲染时再用 Catmull-Rom 插一倍，弯得圆一点）
const R = 2 * N - 1;

export interface Scarf {
  mesh: THREE.Mesh;
  /** 每帧在骨骼动作更新以后调一次。group 是英雄的 group（它的位置、朝向已经是这一帧的） */
  update: (dt: number) => void;
  /** 立刻把两条飘带摆回身后（换位、复活、第一次出场） */
  reset: () => void;
  setVeil: (k: number) => void;
  setHide: (k: number) => void;
}

/** 贴图：u 横过带子（0、1 是两条边），v 顺着带子（0 根、1 尾）。颜色从根的绯红渐变到尾的品红，尾部最后三成剪成三条火舌、描一道赤金细边 */
function scarfTexture(): THREE.CanvasTexture {
  const W = 64, H = 512, cv = document.createElement("canvas"); cv.width = W; cv.height = H; const c = cv.getContext("2d")!;
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#9a2840"); g.addColorStop(0.35, "#ac2a4c"); g.addColorStop(0.62, "#b62a5e"); g.addColorStop(0.85, "#b23384"); g.addColorStop(1, "#a83594");      // 设定图：围脖绯红 151,39,66 → 尾巴品红 190,40,150。比设定图灰一点：模型的围脖在游戏里是 158,68,102（B 的饱和度 0.91），飘带原来 203,28,68，艳得像另一块布
  // 火舌：三条，中间的最长，两边的往外弯；带子在 v=0.7 之前是整宽的
  const F0 = 0.7 * H, path = new Path2D();
  path.moveTo(0, 0); path.lineTo(W, 0); path.lineTo(W, F0);
  path.bezierCurveTo(W, F0 + 40, W * 1.02, H * 0.86, W * 0.96, H * 0.93);      // 右边那条火舌的外沿，尖在 v 0.93
  path.bezierCurveTo(W * 0.86, H * 0.86, W * 0.78, H * 0.83, W * 0.68, H * 0.82);
  path.bezierCurveTo(W * 0.66, H * 0.9, W * 0.6, H * 0.96, W * 0.5, H * 0.995);  // 中间那条，尖在 v ≈ 1
  path.bezierCurveTo(W * 0.42, H * 0.95, W * 0.36, H * 0.88, W * 0.33, H * 0.8);
  path.bezierCurveTo(W * 0.22, H * 0.82, W * 0.12, H * 0.84, W * 0.05, H * 0.9);  // 左边那条，尖在 v 0.9
  path.bezierCurveTo(-W * 0.02, H * 0.84, 0, F0 + 40, 0, F0);
  path.closePath();
  c.save(); c.clip(path);
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  const e = c.createLinearGradient(0, 0, W, 0); e.addColorStop(0, "rgba(40,0,20,0.55)"); e.addColorStop(0.09, "rgba(40,0,20,0)"); e.addColorStop(0.91, "rgba(40,0,20,0)"); e.addColorStop(1, "rgba(40,0,20,0.55)");
  c.fillStyle = e; c.fillRect(0, 0, W, H);      // 两条边压暗一线：卡通描边的意思，俯视里带子的边清楚
  c.restore();
  c.save(); c.beginPath(); c.rect(0, F0 - 6, W, H); c.clip();      // 赤金细边只描在火舌那一段（设定图：火舌尖带赤金边）
  c.strokeStyle = "#e7a159"; c.lineWidth = 3.2; c.stroke(path); c.restore();
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

export function createScarf(group: THREE.Group, bone: (n: string) => THREE.Object3D | undefined, height: number, len = 1): Scarf | null {
  const neck = bone("Neck"), chest = bone("Spine2"), hips = bone("Hips"), armL = bone("LeftArm"), armR = bone("RightArm");
  if (!neck || !chest || !hips || !armL || !armR) return null;
  const H = height;
  const LEN = [0.8 * H * len, 0.68 * H * len];                      // 两条一长一短（设定图里就是一长一短）
  const WID = 0.1 * H;                                               // 根部宽（贴图在尾部剪成火舌）。0.085 在游戏镜头里只剩两条细线
  const OFF = [0.065 * H, -0.065 * H];                               // 两条的根在脖子后面左右分开多少（正是角色的左边）。0.034 时两条叠成一整片，像披风；第四阶段 iti-kit 从 0.05 加到 0.065（朝镜头跑时两条贴在一起像两根竖棍）
  const pos = [new Float32Array(N * 3), new Float32Array(N * 3)], prev = [new Float32Array(N * 3), new Float32Array(N * 3)];
  const v = new THREE.Vector3(), up = new THREE.Vector3(), side = new THREE.Vector3(), fwd = new THREE.Vector3(), back = new THREE.Vector3();
  const pN = new THREE.Vector3(), pC = new THREE.Vector3(), pH = new THREE.Vector3(), pL = new THREE.Vector3(), pR = new THREE.Vector3();
  const anchor = [new THREE.Vector3(), new THREE.Vector3()], lastA = [new THREE.Vector3(), new THREE.Vector3()];
  let time = Math.random() * 10, started = false, acc = 0, spd = 0;

  // ---- 网格：每条飘带 R 个渲染点 × 2 条边 × 2 面
  const VPR = R * 4, geo = new THREE.BufferGeometry();
  const P = new Float32Array(2 * VPR * 3), C = new Float32Array(2 * VPR * 3), U = new Float32Array(2 * VPR * 2), idx: number[] = [];
  for (let s = 0; s < 2; s++) for (let i = 0; i < R; i++) {
    const b = s * VPR + i * 4, vv = i / (R - 1);
    U.set([0, 1 - vv, 1, 1 - vv, 0, 1 - vv, 1, 1 - vv], b * 2);      // 贴图 flipY：画布的第 0 行在 v=1
    if (i < R - 1) { const n = b + 4; idx.push(b, n, b + 1, b + 1, n, n + 1); idx.push(b + 2, b + 3, n + 2, b + 3, n + 3, n + 2); }      // 正面、背面（绕向相反）
  }
  geo.setAttribute("position", new THREE.BufferAttribute(P, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("color", new THREE.BufferAttribute(C, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("uv", new THREE.BufferAttribute(U, 2)); geo.setIndex(idx);
  const mat = new THREE.MeshBasicMaterial({ map: scarfTexture(), vertexColors: true, alphaTest: 0.5, side: THREE.FrontSide });
  mat.name = "scarf";
  const mesh = new THREE.Mesh(geo, mat); mesh.name = "scarf"; mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = false;
  mesh.matrixAutoUpdate = false; mesh.matrixWorldAutoUpdate = false; mesh.matrix.identity(); mesh.matrixWorld.identity();      // 顶点写的就是世界坐标
  group.add(mesh);

  /** 这一帧身体的朝向：上（胸口 → 脖子）、左（右肩 → 左肩）、前；脖子后面两个根的位置 */
  const frame = () => {
    group.updateMatrixWorld(true);
    neck.getWorldPosition(pN); chest.getWorldPosition(pC); hips.getWorldPosition(pH); armL.getWorldPosition(pL); armR.getWorldPosition(pR);
    up.subVectors(pN, pC).normalize(); side.subVectors(pL, pR); side.addScaledVector(up, -side.dot(up)).normalize();
    fwd.crossVectors(side, up).normalize(); back.copy(fwd).negate();
    for (let s = 0; s < 2; s++) anchor[s].copy(pN).addScaledVector(back, 0.05 * H).addScaledVector(up, 0.005 * H).addScaledVector(side, OFF[s]);
  };
  /** 把两条飘带摆成“站着不动时垂在身后”的样子：从根往身后下方斜着垂（和竖直差约 25 度，静止时风和重力平衡出来就是这个角度），碰到地就顺着地面往身后铺。
   *  第一版是斜着往后伸 40 度：网址带 t=（截图时把时间定住，飘带不再模拟）的时候飘带停在这个初始样子，正面看像头上竖着两只红耳朵 */
  const reset = () => {
    frame(); const gy = group.position.y + 0.04;
    for (let s = 0; s < 2; s++) { const seg = LEN[s] / (N - 1);
      tmp.copy(back).multiplyScalar(0.42).addScaledVector(up, -0.9).addScaledVector(side, OFF[s] / H * 0.6).normalize(); v.copy(anchor[s]);
      for (let i = 0; i < N; i++) {
        if (i > 0) { v.addScaledVector(tmp, seg); if (v.y < gy) { v.addScaledVector(tmp, -seg); v.addScaledVector(back, seg); v.y = gy; } }
        v.toArray(pos[s], i * 3); v.toArray(prev[s], i * 3); }
      lastA[s].copy(anchor[s]); }
    started = true;
  };

  // ---- 一个子步：积分、约束、碰撞
  const tmp = new THREE.Vector3(), ax = new THREE.Vector3(), cc = new THREE.Vector3(), dd = new THREE.Vector3();
  const step = (h: number, k: number) => {
    time += h; const gy = group.position.y + 0.04;
    for (let s = 0; s < 2; s++) {
      const p = pos[s], q = prev[s], seg = LEN[s] / (N - 1);
      // 根：从上一帧的位置插值到这一帧（子步之间平滑）
      tmp.lerpVectors(lastA[s], anchor[s], k); tmp.toArray(p, 0); tmp.toArray(q, 0);
      for (let i = 1; i < N; i++) {
        const o = i * 3, x = p[o], y = p[o + 1], z = p[o + 2], f = i / (N - 1);
        const vx = (x - q[o]) / h, vy = (y - q[o + 1]) / h, vz = (z - q[o + 2]) / h;
        // 风（相对身体）：往身后吹、往上托一点，越往尾巴抖得越厉害（左右、上下两个频率）
        const fl = Math.sin(time * 7.3 - i * 0.62 + s * 1.7), fu = Math.cos(time * 5.1 - i * 0.48 + s * 2.3), amp = (0.9 + 2.6 * f) * (1 + 0.16 * Math.min(spd, 10));      // 跑得越快抖得越厉害（不然跑起来是两根僵直的棍）
        const out = (s === 0 ? 1 : -1) * (0.7 + 0.2 * Math.min(spd, 8));      // 第四阶段 iti-kit：0.45 + 0.12·速度 → 0.7 + 0.2·速度，跑起来两条张成一个 V，朝镜头跑也分得开。      // 两条各往自己那边偏一点（设定图里两条尾巴分在身子两侧），跑得越快分得越开：跑起来两条平行的直带子在俯视里像两根棍
        const BK = 0.9, UP = 0.25;                                // 往身后、往上的风。第一版 1.9 / 0.55：站着不动时两条飘带被吹得斜向后上方 45 度，正面看像头上竖着两只红耳朵
        const fv = fu * amp * 0.9;                                 // 上下的抖动（朝镜头跑时飘带在俯视里是竖着的，左右抖看不出来，要靠上下起伏把直棍打成波浪）
        const wx = back.x * BK + up.x * UP + side.x * (fl * amp + out) + up.x * fv, wy = back.y * BK + UP + side.y * (fl * amp + out) + fv, wz = back.z * BK + up.z * UP + side.z * (fl * amp + out) + up.z * fv;
        const kd = 3.8;                                             // 空气阻力：跑起来阻力压过重力，飘带被拉直往身后飘。5.5 时跑起来两条带子和脖子一样高、笔直地平伸，朝镜头跑时在俯视里竖成两根红棍；小一点带子往下垂成一道弧
        ax.set((wx - vx) * kd, -13 + (wy - vy) * kd, (wz - vz) * kd);
        const damp = 0.996;                                         // Verlet：新位置 = 现在 + 速度·步长（略衰减）+ 加速度·步长²
        q[o] = x; q[o + 1] = y; q[o + 2] = z;
        p[o] = x + vx * h * damp + ax.x * h * h; p[o + 1] = y + vy * h * damp + ax.y * h * h; p[o + 2] = z + vz * h * damp + ax.z * h * h;
      }
      // 距离约束（相邻两点）+ 弱的弯曲约束（隔一个点），根不动
      for (let it = 0; it < 4; it++) {
        for (let i = 1; i < N; i++) {
          const a = (i - 1) * 3, b = i * 3, dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], dz = p[b + 2] - p[a + 2], d = Math.hypot(dx, dy, dz) || 1e-6, e = (d - seg) / d;
          if (i === 1) { p[b] -= dx * e; p[b + 1] -= dy * e; p[b + 2] -= dz * e; }
          else { p[a] += dx * e * 0.5; p[a + 1] += dy * e * 0.5; p[a + 2] += dz * e * 0.5; p[b] -= dx * e * 0.5; p[b + 1] -= dy * e * 0.5; p[b + 2] -= dz * e * 0.5; }
        }
        for (let i = 2; i < N; i++) {
          const a = (i - 2) * 3, b = i * 3, dx = p[b] - p[a], dy = p[b + 1] - p[a + 1], dz = p[b + 2] - p[a + 2], d = Math.hypot(dx, dy, dz) || 1e-6;
          if (d >= seg * 1.6) continue; const e = (d - seg * 1.6) / d * 0.25;      // 只在折得太狠（隔一个点的距离小于 1.6 段）时撑开：不让飘带团成一团
          if (i === 2) { p[b] -= dx * e; p[b + 1] -= dy * e; p[b + 2] -= dz * e; }
          else { p[a] += dx * e * 0.5; p[a + 1] += dy * e * 0.5; p[a + 2] += dz * e * 0.5; p[b] -= dx * e * 0.5; p[b + 1] -= dy * e * 0.5; p[b + 2] -= dz * e * 0.5; }
        }
        // 身子：胸腔是脖子到胯的一根胶囊（半径 0.11 个身高），胯再加一个球；点在里面就推到表面
        for (let i = 1; i < N; i++) {
          const o = i * 3; v.set(p[o], p[o + 1], p[o + 2]);
          tmp.subVectors(pN, pH); const L2 = tmp.lengthSq(); let t = L2 > 0 ? cc.subVectors(v, pH).dot(tmp) / L2 : 0; t = Math.max(0, Math.min(1, t));      // 不在循环里 new 向量：每帧几千次，手机上会频繁回收内存
          cc.copy(pH).addScaledVector(tmp, t); dd.subVectors(v, cc); const dl = dd.length(), r = 0.11 * H;
          if (dl < r) { if (dl < 1e-4) dd.copy(back); else dd.divideScalar(dl); v.copy(cc).addScaledVector(dd, r); }
          dd.subVectors(v, pH); const hl = dd.length(), rh = 0.12 * H;
          if (hl < rh) { if (hl < 1e-4) dd.copy(back); else dd.divideScalar(hl); v.copy(pH).addScaledVector(dd, rh); }
          if (v.y < gy) v.y = gy;                                  // 不穿地
          p[o] = v.x; p[o + 1] = v.y; p[o + 2] = v.z;
        }
      }
    }
  };

  // ---- 渲染点：Catmull-Rom 插一倍；带子的宽度方向从根部的“身体左右”顺着链条平移过去（不突然拧）
  const rp = new Float32Array(R * 3), wv = new THREE.Vector3(), tg = new THREE.Vector3(), nm = new THREE.Vector3(), a0 = new THREE.Vector3(), a1 = new THREE.Vector3(), a2 = new THREE.Vector3(), a3 = new THREE.Vector3();
  const cr = (o: THREE.Vector3, p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, t: number): THREE.Vector3 => {
    const t2 = t * t, t3 = t2 * t;
    return o.set(0, 0, 0).addScaledVector(p0, -0.5 * t3 + t2 - 0.5 * t).addScaledVector(p1, 1.5 * t3 - 2.5 * t2 + 1).addScaledVector(p2, -1.5 * t3 + 2 * t2 + 0.5 * t).addScaledVector(p3, 0.5 * t3 - 0.5 * t2);
  };
  const light = (n: THREE.Vector3, out: Float32Array, o: number, f: number) => {
    const l = n.dot(SUN), k = THREE.MathUtils.smoothstep(l, -0.08, 0.14);      // 两阶：亮面 / 暗面，交界窄
    const lift = 1.0 + 0.12 * (1 - f);                                          // 根部略亮（靠近围脖的那段和模型的围脖接得上）
    out[o] = (0.56 + 0.62 * k) * lift; out[o + 1] = (0.5 + 0.58 * k) * lift; out[o + 2] = (0.72 + 0.46 * k) * lift;      // 暗面偏紫一点（卡通的冷暗面），亮面略过 1 把贴图提亮
  };
  const draw = () => {
    for (let s = 0; s < 2; s++) {
      const p = pos[s], get = (i: number, o: THREE.Vector3) => o.fromArray(p, Math.max(0, Math.min(N - 1, i)) * 3);
      for (let i = 0; i < N - 1; i++) { get(i - 1, a0); get(i, a1); get(i + 1, a2); get(i + 2, a3); if (i === 0) a0.copy(a1).multiplyScalar(2).sub(a2);
        cr(wv, a0, a1, a2, a3, 0).toArray(rp, (2 * i) * 3); cr(wv, a0, a1, a2, a3, 0.5).toArray(rp, (2 * i + 1) * 3); }
      get(N - 1, wv).toArray(rp, (R - 1) * 3);
      wv.copy(side);
      for (let i = 0; i < R; i++) {
        const f = i / (R - 1), i0 = Math.max(0, i - 1), i1 = Math.min(R - 1, i + 1);
        tg.set(rp[i1 * 3] - rp[i0 * 3], rp[i1 * 3 + 1] - rp[i0 * 3 + 1], rp[i1 * 3 + 2] - rp[i0 * 3 + 2]).normalize();
        wv.addScaledVector(tg, -wv.dot(tg)); if (wv.lengthSq() < 1e-6) wv.copy(side); wv.normalize();
        nm.crossVectors(tg, wv).normalize();
        const w = WID * (1 - 0.18 * f) * 0.5 * (i === 0 ? 0.7 : 1), cx = rp[i * 3], cy = rp[i * 3 + 1], cz = rp[i * 3 + 2], b = (s * VPR + i * 4) * 3;
        P[b] = cx - wv.x * w; P[b + 1] = cy - wv.y * w; P[b + 2] = cz - wv.z * w; P[b + 3] = cx + wv.x * w; P[b + 4] = cy + wv.y * w; P[b + 5] = cz + wv.z * w;
        P[b + 6] = P[b]; P[b + 7] = P[b + 1]; P[b + 8] = P[b + 2]; P[b + 9] = P[b + 3]; P[b + 10] = P[b + 4]; P[b + 11] = P[b + 5];
        light(nm, C, b, f); C[b + 3] = C[b]; C[b + 4] = C[b + 1]; C[b + 5] = C[b + 2];
        nm.negate(); light(nm, C, b + 6, f); C[b + 9] = C[b + 6]; C[b + 10] = C[b + 7]; C[b + 11] = C[b + 8];
      }
    }
    geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
  };

  return {
    mesh, reset,
    update(dt) {
      if (dt <= 0) { if (!started) { reset(); draw(); } return; }
      for (let s = 0; s < 2; s++) lastA[s].copy(anchor[s]);
      frame();
      if (!started) { reset(); draw(); return; }
      // 瞬移：根一帧里挪了 2.2 米以上、而且快过每秒 45 米（冲刺最快约 25 米/秒），整条重置到新位置
      const jump = Math.max(anchor[0].distanceTo(lastA[0]), anchor[1].distanceTo(lastA[1]));
      spd += (Math.min(jump / dt, 30) - spd) * Math.min(1, dt * 6);      // 脖子的速度（平滑过的），给抖动用
      if (jump > 2.2 && jump / dt > 45) { reset(); draw(); return; }
      acc += Math.min(dt, 0.1); let n = 0; const steps = Math.min(12, Math.floor(acc / SUB));
      while (acc >= SUB && n < 12) { acc -= SUB; n++; step(SUB, n / Math.max(1, steps)); }
      if (n >= 12) acc = 0;
      for (let s = 0; s < 2; s++) lastA[s].copy(anchor[s]);
      draw();
    },
    setVeil(k) { mesh.visible = k < 0.5; },
    setHide(k) { const tr = k > 0.001; if (mat.transparent !== tr) { mat.transparent = tr; mat.needsUpdate = true; } mat.opacity = 1 - 0.45 * k; },
  };
}
