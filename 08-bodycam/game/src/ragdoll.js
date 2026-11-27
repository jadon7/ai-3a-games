// 倒地：简化的"布娃娃"。
// 影片里敌人只有一段烘焙好的倒地动作，游戏里每个人都那样倒就很假，而且靠墙、在门口、在楼梯上时身体会穿进建筑。
// 这里把身体简化成 18 个关节点，用位置约束（PBD）来算：骨头长度不变、躯干基本成形、膝盖不能反折，
// 每个点是一个小球，和场景的碰撞网格做碰撞（墙、地面、台阶、门框都算）。算完再把骨骼摆到这些点上。
// 开头一小段时间还会被原来的倒地动作"拉"着走（像人中弹后先踉跄一下），之后完全交给重力，所以每次倒法都不一样。
import * as THREE from 'three';

// 名字, 骨骼名, 碰撞半径(m), 质量
const PD = [
  ['pelvis', /Hips_/, 0.125, 3.0], ['chest', /Spine2_/, 0.145, 3.5], ['neck', /Neck_/, 0.07, 0.8], ['head', /HeadTop_End/, 0.09, 1.2],
  ['lsh', /LeftArm_/, 0.07, 1.0], ['lel', /LeftForeArm_/, 0.055, 0.6], ['lwr', /LeftHand_\d/, 0.05, 0.4],
  ['rsh', /RightArm_/, 0.07, 1.0], ['rel', /RightForeArm_/, 0.055, 0.6], ['rwr', /RightHand_\d/, 0.05, 0.4],
  ['lhip', /LeftUpLeg_/, 0.09, 1.6], ['lkn', /LeftLeg_/, 0.07, 1.0], ['lan', /LeftFoot_/, 0.06, 0.6], ['lto', /LeftToeBase_/, 0.045, 0.3],
  ['rhip', /RightUpLeg_/, 0.09, 1.6], ['rkn', /RightLeg_/, 0.07, 1.0], ['ran', /RightFoot_/, 0.06, 0.6], ['rto', /RightToeBase_/, 0.045, 0.3],
];
const IX = Object.fromEntries(PD.map((d, i) => [d[0], i]));
// 长度不变的约束：[a, b, 刚度]
const EQ = [
  ['pelvis', 'chest', 0.9], ['chest', 'neck', 1], ['neck', 'head', 1], ['pelvis', 'neck', 0.55],
  ['chest', 'lsh', 1], ['chest', 'rsh', 1], ['lsh', 'rsh', 1], ['neck', 'lsh', 1], ['neck', 'rsh', 1],
  ['pelvis', 'lhip', 1], ['pelvis', 'rhip', 1], ['lhip', 'rhip', 1], ['chest', 'lhip', 0.7], ['chest', 'rhip', 0.7],
  ['lsh', 'lhip', 0.5], ['rsh', 'rhip', 0.5], ['lsh', 'rhip', 0.45], ['rsh', 'lhip', 0.45],
  ['lsh', 'lel', 1], ['lel', 'lwr', 1], ['rsh', 'rel', 1], ['rel', 'rwr', 1],
  ['lhip', 'lkn', 1], ['lkn', 'lan', 1], ['lan', 'lto', 1], ['rhip', 'rkn', 1], ['rkn', 'ran', 1], ['ran', 'rto', 1],
];
// 范围约束：[a, b, 最小倍数, 最大倍数]（相对开始时的距离；0 表示不限）。防止胳膊腿折成一团、头埋进胸口、脚掌翻过去。
const RANGE = [
  ['head', 'chest', 0.8, 1.08], ['head', 'lsh', 0.72, 1.25], ['head', 'rsh', 0.72, 1.25],
  ['lto', 'lkn', 0.8, 1.13], ['rto', 'rkn', 0.8, 1.13],
];
// 最小间距（米）：[a, b, 距离]
const APART = [
  ['lkn', 'rkn', 0.15], ['lan', 'ran', 0.12], ['lwr', 'pelvis', 0.16], ['rwr', 'pelvis', 0.16], ['lel', 'chest', 0.17], ['rel', 'chest', 0.17],
  ['lwr', 'head', 0.13], ['rwr', 'head', 0.13], ['lkn', 'chest', 0.3], ['rkn', 'chest', 0.3], ['lan', 'pelvis', 0.22], ['ran', 'pelvis', 0.22], ['lwr', 'chest', 0.16], ['rwr', 'chest', 0.16],
];
// 最大间距（米）：两腿不会劈得太开
const WITHIN = [['lkn', 'rkn', 0.7], ['lan', 'ran', 1.05]];
// 四肢：折到最短时两端的距离不小于"两段总长"的这个比例
const FOLD = [['lsh', 'lel', 'lwr', 0.3], ['rsh', 'rel', 'rwr', 0.3], ['lhip', 'lkn', 'lan', 0.42], ['rhip', 'rkn', 'ran', 0.42]];
// 用"从 a 指向 b"来摆的骨骼：[骨骼名, a, b]（按父子顺序）
const SWING = [
  [/Neck_/, 'neck', 'head'],
  [/LeftShoulder_/, 'chest', 'lsh'], [/LeftArm_/, 'lsh', 'lel'], [/LeftForeArm_/, 'lel', 'lwr'],
  [/RightShoulder_/, 'chest', 'rsh'], [/RightArm_/, 'rsh', 'rel'], [/RightForeArm_/, 'rel', 'rwr'],
  [/LeftUpLeg_/, 'lhip', 'lkn'], [/LeftLeg_/, 'lkn', 'lan'], [/LeftFoot_/, 'lan', 'lto'],
  [/RightUpLeg_/, 'rhip', 'rkn'], [/RightLeg_/, 'rkn', 'ran'], [/RightFoot_/, 'ran', 'rto'],
];

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _n = new THREE.Vector3(), _cp = new THREE.Vector3();
const _x = new THREE.Vector3(), _u = new THREE.Vector3(), _z = new THREE.Vector3(), _m = new THREE.Matrix4();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _sph = new THREE.Sphere();
const rnd = (a, b) => a + Math.random() * (b - a);

function frameQ(o, l, r, up, out) {      // 由"左右两点 + 向上一点"定一个朝向
  _x.subVectors(r, l).normalize(); _u.subVectors(up, o); _u.addScaledVector(_x, -_u.dot(_x)).normalize(); _z.crossVectors(_x, _u);
  return out.setFromRotationMatrix(_m.makeBasis(_x, _u, _z));
}

export class Ragdoll {
  // opts: dir 子弹飞行方向（世界坐标）, part 'head'|'body'|'legs', vel 人原来的速度（世界坐标）, onBody/onGun 身体、枪第一次着地时回调
  constructor(enemy, world, nav, opts = {}) {
    this.e = enemy; this.world = world; this.nav = nav; this.opts = opts; this.t = 0; this.asleep = false; this.noAnim = false; this.still = 0;
    const bones = {}; enemy.model.traverse((o) => { if (o.isBone) bones[o.name] = o; });
    const find = (re) => { const k = Object.keys(bones).find((n) => re.test(n)); return k ? bones[k] : null; };
    this.pb = PD.map((d) => find(d[1]));
    if (this.pb.some((b) => !b)) { this.asleep = true; this.noAnim = false; this.bad = true; return; }
    this.hips = find(/Hips_/); this.spine = find(/Spine_\d/); this.spine1 = find(/Spine1_/); this.spine2 = find(/Spine2_/);
    this.sw = SWING.map(([re, a, b]) => ({ bone: find(re), a: IX[a], b: IX[b], dl: new THREE.Vector3() })).filter((s) => s.bone);
    this.anim = [this.hips, this.spine, this.spine1, this.spine2, ...this.sw.map((s) => s.bone)];      // 会被我们改写的骨骼
    this.animQ = this.anim.map((b) => b.quaternion.clone()); this.animP = this.hips.position.clone();
    const N = PD.length;
    this.p = []; this.v = []; this.o = []; this.tg = []; this.w = []; this.r = []; this.onFloor = new Uint8Array(N);
    enemy.root.updateMatrixWorld(true);
    const sc = enemy.root.scale.x || 1;
    for (let i = 0; i < N; i++) { this.p.push(this.pb[i].getWorldPosition(new THREE.Vector3())); this.o.push(this.p[i].clone()); this.tg.push(this.p[i].clone()); this.v.push(new THREE.Vector3()); this.w.push(1 / PD[i][3]); this.r.push(PD[i][2] * sc); }
    const P = this.p, D = (a, b) => P[IX[a]].distanceTo(P[IX[b]]);
    this.cons = [];       // [i, j, 长度, 刚度, 类型 0 等长 / 1 不小于 / 2 不大于]
    for (const [a, b, k] of EQ) this.cons.push([IX[a], IX[b], D(a, b), k, 0]);
    for (const [a, b, lo, hi] of RANGE) { const d = D(a, b); if (lo) this.cons.push([IX[a], IX[b], d * lo, 1, 1]); if (hi) this.cons.push([IX[a], IX[b], d * hi, 1, 2]); }
    for (const [a, b, d] of APART) this.cons.push([IX[a], IX[b], Math.min(d * sc, D(a, b)), 0.8, 1]);
    for (const [a, b, d] of WITHIN) this.cons.push([IX[a], IX[b], Math.max(d * sc, D(a, b)), 0.8, 2]);
    for (const [a, m, b, k] of FOLD) this.cons.push([IX[a], IX[b], (D(a, m) + D(m, b)) * k, 1, 1]);
    // 骨骼的朝向基准
    this.hipsQ0 = this.hips.getWorldQuaternion(new THREE.Quaternion()); this.spQ0 = [this.spine, this.spine1, this.spine2].map((b) => b.getWorldQuaternion(new THREE.Quaternion()));
    this.pelF0 = frameQ(P[IX.pelvis], P[IX.lhip], P[IX.rhip], P[IX.chest], new THREE.Quaternion()).invert();
    this.cheF0 = frameQ(P[IX.chest], P[IX.lsh], P[IX.rsh], P[IX.neck], new THREE.Quaternion()).invert();
    for (const s of this.sw) { s.bone.getWorldQuaternion(_q1).invert(); s.dl.subVectors(P[s.b], P[s.a]).normalize().applyQuaternion(_q1); }
    // 膝盖只能往后弯：记下"膝盖朝前"的符号
    const fwd = _a.set(0, 0, 1).applyQuaternion(enemy.root.getWorldQuaternion(_q1));
    _b.subVectors(P[IX.rhip], P[IX.lhip]).normalize(); _c.crossVectors(_b, _d.set(0, -1, 0));
    this.kneeSign = _c.dot(fwd) >= 0 ? 1 : -1;
    // 初速度：原来的移动速度 + 中弹的那一下
    const vel = opts.vel || _a.set(0, 0, 0);
    for (const v of this.v) v.copy(vel);
    const dir = opts.dir ? _b.copy(opts.dir).setY(0) : _b.set(0, 0, 0); if (dir.lengthSq() > 1e-6) dir.normalize();
    const J = opts.part === 'head' ? rnd(1.6, 2.6) : rnd(0.9, 1.9);
    const hitI = opts.part === 'head' ? ['head', 'neck'] : (opts.part === 'legs' ? [Math.random() < 0.5 ? 'lkn' : 'rkn', 'pelvis'] : ['chest', Math.random() < 0.5 ? 'lsh' : 'rsh']);
    this.v[IX[hitI[0]]].addScaledVector(dir, J); this.v[IX[hitI[1]]].addScaledVector(dir, J * 0.55);
    // 每个人倒的方式不一样：腰上随机带一点侧向的劲（往哪边歪）、一点转身的劲
    _c.set(-dir.z, 0, dir.x); const side = rnd(-1, 1);
    this.v[IX.pelvis].addScaledVector(_c, side * 0.5); this.v[IX.chest].addScaledVector(_c, side * 0.9);
    const tw = rnd(-0.9, 0.9); this.v[IX.lsh].addScaledVector(dir, tw); this.v[IX.rsh].addScaledVector(dir, -tw);
    // 开头被原动作"拉"着的时间和力度：打头直接瘫；打身体多数会先踉跄一下
    const limp = !!opts.limp || opts.part === 'head' || Math.random() < 0.3;
    this.pullT = limp ? rnd(0.06, 0.16) : rnd(0.28, 0.75); this.pullK = limp ? 0.3 : rnd(0.4, 0.7);
    this.bodyHit = false; this.gunHit = false;
  }

  // 混合器不会重写"数值没变"的轨道：每帧先把上一帧的动画姿态放回去，混合器更新完再记下来
  restoreAnim() { if (this.bad) return; for (let i = 0; i < this.anim.length; i++) this.anim[i].quaternion.copy(this.animQ[i]); this.hips.position.copy(this.animP); }
  cacheAnim() { if (this.bad) return; for (let i = 0; i < this.anim.length; i++) this.animQ[i].copy(this.anim[i].quaternion); this.animP.copy(this.hips.position); }

  _floor(p) {      // p 脚下最近的那层地面高度（没有就返回 -1e9）
    const nav = this.nav, k = nav._k(p.x, -p.z); if (k < 0) return -1e9; let h = -1e9;
    for (const Ly of nav.Ls) { const v = Ly.H[k]; if (v <= p.y + 0.3 && v > h) h = v; }
    return h;
  }
  _collide(i) {
    const p = this.p[i], o = this.o[i], r = this.r[i];
    // 一步走得太远的先打一条射线，别穿到墙那边去
    _d.subVectors(p, o); const len = _d.length();
    if (len > r * 0.7) { _d.multiplyScalar(1 / len); const h = this.world.raycast(o, _d, len + r * 0.5); if (h && h.distance < len + r * 0.5) p.copy(o).addScaledVector(_d, Math.max(0, h.distance - r * 0.6)); }
    _sph.center.copy(p); _sph.radius = r; let hit = false, ny = -1;
    this.world.collider.geometry.boundsTree.shapecast({
      intersectsBounds: (box) => box.intersectsSphere(_sph),
      intersectsTriangle: (tri) => {
        tri.closestPointToPoint(_sph.center, _cp); const d2 = _cp.distanceToSquared(_sph.center);
        if (d2 < r * r) {
          const d = Math.sqrt(d2); if (d > 1e-5) _n.subVectors(_sph.center, _cp).multiplyScalar(1 / d); else tri.getNormal(_n);
          _sph.center.addScaledVector(_n, r - d); hit = true; if (_n.y > ny) ny = _n.y;
        }
        return false;
      },
    });
    if (hit) p.copy(_sph.center);
    const fh = this._floor(p);      // 地面再兜一层底：扫描的地面是单层面片，万一球心掉到面片下面会被往下推
    if (p.y < fh + r * 0.75) { p.y = fh + r * 0.75; ny = 1; hit = true; }
    this.onFloor[i] = hit && ny > 0.5 ? 1 : 0;
    return hit;
  }

  step(dt) {
    if (this.asleep) return;
    const e = this.e, P = this.p, V = this.v, O = this.o, N = P.length; e.root.updateMatrixWorld(true);
    this.t += dt;
    const pull = this.t < this.pullT ? this.pullK * (1 - this.t / this.pullT) : 0;
    if (pull > 0) for (let i = 0; i < N; i++) this.pb[i].getWorldPosition(this.tg[i]); else this.noAnim = true;
    const ns = 2, h = Math.min(dt, 1 / 30) / ns; let vmax = 0;
    for (let s = 0; s < ns; s++) {
      // 被原动作拉着的阶段：上身跟得紧，腿只跟三成（不然动作里抬脚的那几帧会把人整个提离地面）
      for (let i = 0; i < N; i++) { V[i].y -= 9.8 * h; O[i].copy(P[i]); P[i].addScaledVector(V[i], h); if (pull > 0) P[i].lerp(this.tg[i], pull * (i >= IX.lkn && i !== IX.rhip ? 0.3 : 1)); }
      for (let it = 0; it < 6; it++) {
        for (const [i, j, L0, k, ty] of this.cons) {
          _d.subVectors(P[j], P[i]); const len = _d.length(); if (len < 1e-6 || (ty === 1 && len >= L0) || (ty === 2 && len <= L0)) continue;
          const f = (len - L0) / len * k / (this.w[i] + this.w[j]); P[i].addScaledVector(_d, f * this.w[i]); P[j].addScaledVector(_d, -f * this.w[j]);
        }
        // 膝盖不能反折：小腿相对大腿只能往后摆
        _b.subVectors(P[IX.rhip], P[IX.lhip]).normalize();
        for (const [hp, kn, an] of [[IX.lhip, IX.lkn, IX.lan], [IX.rhip, IX.rkn, IX.ran]]) {
          _a.subVectors(P[kn], P[hp]).normalize(); _c.crossVectors(_b, _a).multiplyScalar(this.kneeSign); const l2 = _c.length(); if (l2 < 0.2) continue; _c.multiplyScalar(1 / l2);
          const ov = _d.subVectors(P[an], P[kn]).dot(_c); if (ov > 0.015) { P[an].addScaledVector(_c, -ov * 0.7); P[kn].addScaledVector(_c, ov * 0.3); }
        }
      }
      for (let i = 0; i < N; i++) {
        this._collide(i);
        V[i].subVectors(P[i], O[i]).multiplyScalar(1 / h);
        if (this.onFloor[i]) { V[i].x *= 0.62; V[i].z *= 0.62; if (V[i].y < 0) V[i].y = 0; }      // 着地的点有摩擦
        V[i].multiplyScalar(this.calm ? 0.9 : 0.992); const sp = V[i].length(); if (sp > 9) V[i].multiplyScalar(9 / sp); if (sp > vmax) vmax = sp;
      }
    }
    this.calm = vmax < 0.5 && this.t > this.pullT + 0.4;      // 快躺稳了：多加一点阻尼，别在地上抖
    // 声音：躯干、拿枪的手第一次着地
    if (!this.bodyHit && this.t > 0.2 && (this.onFloor[IX.pelvis] || this.onFloor[IX.chest])) { this.bodyHit = true; if (this.opts.onBody) this.opts.onBody(this.t); }
    if (!this.gunHit && this.t > 0.2 && this.onFloor[IX.rwr]) { this.gunHit = true; if (this.opts.onGun) this.opts.onGun(this.t); }
    this._write();
    // 躺稳了就不再算
    this.still = vmax < 0.12 && this.t > this.pullT + 0.3 ? this.still + dt : 0;
    if (this.still > 0.4 || this.t > 4.5) this.asleep = true;
  }

  // 把骨骼摆到关节点上
  _write() {
    const P = this.p, wq = new Map();
    const parentQ = (b) => wq.get(b.parent) || b.parent.getWorldQuaternion(new THREE.Quaternion());
    const setW = (b, q) => { const pq = parentQ(b); b.quaternion.copy(_q3.copy(pq).invert().multiply(q)); wq.set(b, q.clone()); };
    // 躯干：髋和胸各按三点定朝向，中间两节脊柱按比例过渡
    const dPel = frameQ(P[IX.pelvis], P[IX.lhip], P[IX.rhip], P[IX.chest], new THREE.Quaternion()).multiply(this.pelF0);
    const dChe = frameQ(P[IX.chest], P[IX.lsh], P[IX.rsh], P[IX.neck], new THREE.Quaternion()).multiply(this.cheF0);
    this.hips.parent.updateWorldMatrix(true, false);
    this.hips.position.copy(this.hips.parent.worldToLocal(_a.copy(P[IX.pelvis])));
    setW(this.hips, _q1.copy(dPel).multiply(this.hipsQ0));
    const sp = [this.spine, this.spine1, this.spine2], tt = [0.34, 0.67, 1];
    for (let i = 0; i < 3; i++) setW(sp[i], _q1.copy(dPel).slerp(dChe, tt[i]).multiply(this.spQ0[i]));
    // 四肢和脖子：保持原来的扭转，只把骨头"摆"到两个关节点的连线上
    for (const s of this.sw) {
      const pred = _q1.copy(parentQ(s.bone)).multiply(s.bone.quaternion);
      _a.copy(s.dl).applyQuaternion(pred); _b.subVectors(P[s.b], P[s.a]); if (_b.lengthSq() < 1e-8) { wq.set(s.bone, pred.clone()); continue; } _b.normalize();
      setW(s.bone, _q2.setFromUnitVectors(_a, _b).multiply(pred));
    }
    this.e.root.updateMatrixWorld(true);
  }
}
