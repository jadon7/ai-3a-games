import * as THREE from 'three';
import type { BoneKey, Rig } from './rig';

const DEG = Math.PI / 180;
const Y = new THREE.Vector3(0, 1, 0);
const _R = new THREE.Quaternion(), _D = new THREE.Quaternion(), _tw = new THREE.Quaternion(), _sw = new THREE.Quaternion();
const _C = new THREE.Quaternion(), _P = new THREE.Quaternion(), _Pi = new THREE.Quaternion(), _k = new THREE.Quaternion(), _o = new THREE.Quaternion();
const _ax = new THREE.Vector3(), ID = new THREE.Quaternion();

export interface LimitSpec {
  /** 以哪根骨骼为基准（它自己不动），限到哪根骨骼为止 */
  base: BoneKey; end: BoneKey;
  /** 相对站姿最多能后仰、前屈、侧倾、左右扭多少度 */
  back: number; fwd: number; side: number; twist: number;
  /** 到上限的几成开始收（之前完全不动动作），默认 0.7 */
  knee?: number;
  /** 超出的部分摊给链上各节的比例（从基准往末端数），默认平均 */
  weights?: number[];
}

/** 超过 knee 之后平滑地压向上限，永远不越过 */
function soft(x: number, lim: number, knee: number) {
  const k = lim * knee; if (x <= k) return x;
  const span = lim - k; return k + span * Math.tanh((x - k) / span);
}

/**
 * 关节限位：一串骨骼（比如 颈 → 头）相对基准骨骼（胸）的总转动，超出人体能做到的范围就压回来。
 * 动作数据（尤其是“把动捕的变化量叠到架势上”得到的受击动作）和程序化叠加（受击弹簧、头部跟随）
 * 各自都不过分，叠在一起却可能把头折进胸口里；这一层放在所有叠加之后，是最后一道保险。
 *
 * 做法：把“末端相对基准、相对站姿的转动”拆成 摆动（前后左右歪）和 扭转（绕身体竖轴）两部分，
 * 分别按上限平滑收紧，再把差出来的修正量按比例摊回链上每一节。没超限时一个数都不改。
 */
export class ChainLimit {
  private chain: THREE.Bone[] = [];
  private R0i = new THREE.Quaternion(); private Qb = new THREE.Quaternion(); private Qbi = new THREE.Quaternion();
  private w: number[] = [];
  private knee: number;
  /** 最近一次量到的偏离（度）：swing 歪了多少、pitch 仰（负）俯（正）、roll 侧倾、twist 扭转；cut 是这次被压掉的角度 */
  readonly last = { swing: 0, pitch: 0, roll: 0, twist: 0, cut: 0 };

  constructor(rig: Rig, readonly spec: LimitSpec) {
    this.knee = spec.knee ?? 0.7;
    const end = rig.bones[spec.end], base = rig.bones[spec.base];
    if (!end || !base) return;
    const chain: THREE.Bone[] = [];
    let o: THREE.Object3D | null = end;
    while (o && o !== base) { chain.unshift(o as THREE.Bone); o = o.parent; }
    if (o !== base) return;
    this.chain = chain;
    const R0 = new THREE.Quaternion();
    for (const b of chain) R0.multiply(rig.rest.get(b) ?? b.quaternion);
    this.R0i.copy(R0).invert();
    // 基准骨骼在站姿下的朝向（模型空间：+Y 向上、+Z 朝前、+X 是角色的左手边），用来把转动换到“身体的上下前后”里说话
    const up: THREE.Object3D[] = [];
    o = base; while (o && o !== rig.orient) { up.unshift(o); o = o.parent; }
    for (const b of up) this.Qb.multiply(rig.rest.get(b as THREE.Bone) ?? b.quaternion);
    this.Qbi.copy(this.Qb).invert();
    const n = chain.length, w = spec.weights && spec.weights.length === n ? spec.weights : chain.map(() => 1 / n);
    const sum = w.reduce((a, b) => a + b, 0) || 1;
    this.w = w.map((x) => x / sum);
  }

  get active() { return this.chain.length > 0; }

  /** 量当前姿势并（apply 为真时）压回范围内。返回这次压掉了多少度。 */
  solve(apply = true): number {
    const ch = this.chain, L = this.last;
    if (!ch.length) return 0;
    _R.identity(); for (const b of ch) _R.multiply(b.quaternion);
    // 末端相对基准、相对站姿转了多少，换到身体的坐标里
    _D.copy(this.Qb).multiply(_R).multiply(this.R0i).multiply(this.Qbi);
    if (_D.w < 0) _D.set(-_D.x, -_D.y, -_D.z, -_D.w);
    // 摆动-扭转分解（扭转轴 = 身体竖轴）
    const tl = Math.hypot(_D.y, _D.w);
    if (tl < 1e-6) _tw.identity(); else _tw.set(0, _D.y / tl, 0, _D.w / tl);
    _sw.copy(_D).multiply(_o.copy(_tw).invert());
    let tAng = 2 * Math.atan2(_tw.y, _tw.w); if (tAng > Math.PI) tAng -= Math.PI * 2; else if (tAng < -Math.PI) tAng += Math.PI * 2;
    const sAng = 2 * Math.acos(Math.min(1, Math.abs(_sw.w))), sgn = _sw.w < 0 ? -1 : 1;
    const sl = Math.hypot(_sw.x, _sw.z);
    const ax = sl > 1e-6 ? (_sw.x / sl) * sgn : 1, az = sl > 1e-6 ? (_sw.z / sl) * sgn : 0;
    L.swing = sAng / DEG; L.pitch = (sAng * ax) / DEG; L.roll = (sAng * az) / DEG; L.twist = tAng / DEG; L.cut = 0;
    // 这个方向上的上限：前屈 / 后仰 / 侧倾 之间按椭圆过渡
    const s = this.spec, limX = (ax >= 0 ? s.fwd : s.back) * DEG, limZ = s.side * DEG;
    const lim = 1 / Math.sqrt((ax / limX) ** 2 + (az / limZ) ** 2);
    const sNew = soft(sAng, lim, this.knee);
    const tNew = Math.sign(tAng) * soft(Math.abs(tAng), s.twist * DEG, this.knee);
    const cut = (sAng - sNew) + Math.abs(tAng - tNew);
    if (cut < 1e-4) return 0;
    L.cut = cut / DEG;
    if (!apply) return L.cut;
    // 收紧后的转动，以及要补上的修正量（换回基准骨骼的局部空间）
    _sw.setFromAxisAngle(_ax.set(ax, 0, az), sNew);
    _tw.setFromAxisAngle(Y, tNew);
    _C.copy(_sw).multiply(_tw).multiply(_o.copy(_D).invert());      // D' · D⁻¹
    _C.copy(_o.copy(this.Qbi).multiply(_C).multiply(this.Qb));      // 基准局部空间里的修正
    if (_C.w < 0) _C.set(-_C.x, -_C.y, -_C.z, -_C.w);
    // 摊到每一节：第 k 节 q' = P⁻¹ · C^w · P · q，P 是它前面各节（修正前）的累积
    _P.identity();
    for (let i = 0; i < ch.length; i++) {
      const b = ch[i];
      _k.copy(ID).slerp(_C, this.w[i]);
      _Pi.copy(_P).invert();
      _o.copy(b.quaternion);
      b.quaternion.copy(_Pi).multiply(_k).multiply(_P).multiply(_o);
      _P.multiply(_o);
    }
    return L.cut;
  }
}

/**
 * 这套骨架（Tripo 自动绑骨、Mixamo 命名）上用的限位。数值是量过两名角色全部动作之后定的（2026-11-25）：
 * 专属动作里腰最多后仰 37、前屈 55、侧倾 55、扭 68；脖子最多后仰 37、前屈 50、侧倾 34、扭 60，都在起收点（上限 × knee）附近或以内，基本不受影响。
 * 出问题的是通用受击动作：重受击、空中受击、倒地不起时脖子后仰 72 到 92 度，再叠上受击弹簧（颈、头各最多 22 度）就折进胸口了。
 */
export const LIMITS: LimitSpec[] = [
  // 腰（胯 → 胸）：动作数据本身没越界，这里只防弹簧叠上去之后折过头
  { base: 'Hips', end: 'Spine2', back: 55, fwd: 95, side: 68, twist: 105, knee: 0.75, weights: [0.3, 0.35, 0.35] },
  // 脖子（胸 → 头）：站架本身头就朝对手拧了三五十度，所以扭转给得宽；后仰收紧
  { base: 'Spine2', end: 'Head', back: 48, fwd: 56, side: 40, twist: 80, knee: 0.74, weights: [0.45, 0.55] },
];
