import * as THREE from 'three';
import { Animator } from '../anim/animator';
import { Rig, type BoneKey, type RigAsset } from '../anim/rig';
import type { Fighter } from '../combat/sim';
import { DEBUG, DT } from '../core/config';
import { clamp, damp, lerp, spring } from '../core/math';
import { RIBBONS, RibbonSet } from '../anim/ribbon';
import { SpringBones } from '../anim/springbones';
import { ChainLimit, LIMITS } from '../anim/limits';

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _p = new THREE.Quaternion(), _pi = new THREE.Quaternion();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const AXIS_Z = new THREE.Vector3(0, 0, 1), AXIS_Y = new THREE.Vector3(0, 1, 0), AXIS_X = new THREE.Vector3(1, 0, 0);

/** 受击时叠在骨骼上的弹簧：后仰（绕侧向轴）、拧转（绕竖直轴）、侧倾（绕前后轴）。 */
class Jolt { bend = 0; bendV = 0; twist = 0; twistV = 0; roll = 0; rollV = 0; }

/**
 * 一个角色的表现：模型、动作播放、程序化的附加动作（受击弹簧、头部跟随、受击闪光）。
 * 模拟（Fighter）只出状态和“播哪段动作的第几秒”，这里负责把它画出来并在两帧之间插值。
 */
export class FighterView {
  readonly rig: Rig;
  readonly animator: Animator;
  private seq = -1;
  private jolts: Record<string, Jolt> = { Spine: new Jolt(), Spine2: new Jolt(), Neck: new Jolt(), Head: new Jolt() };
  private joltW: Record<string, number> = { Spine: 0.5, Spine2: 0.8, Neck: 0.7, Head: 1.0 };
  private lookPitch = 0; private lookW = 0;
  private flash = 0; private flashColor = new THREE.Color(1, 1, 1);
  private baseEmissive = new Map<THREE.MeshStandardMaterial, { c: THREE.Color; i: number }>();
  /** 元素附着：冻结（偏青白）、灼烧（偏橙），0..1 */
  tintK = 0; tintColor = new THREE.Color(0x9fdcff);
  readonly pos = new THREE.Vector3();
  private chains = new Map<THREE.Object3D, THREE.Object3D[]>();
  visible = true;
  /** 世界空间里的附属物（布带），要和 rig.root 一起加进场景 */
  readonly world = new THREE.Group();
  private ribbons: RibbonSet | null = null; private ribbonsReady = false; private rt = 0;
  camera: THREE.Camera | null = null;
  private springs: SpringBones;
  private _h = new THREE.Vector3(); private _c = new THREE.Vector3();
  /** 关节限位（腰、脖子）：在动作和所有程序化叠加之后做，保证头不会折进身体里 */
  readonly limits: ChainLimit[];
  private limitOn = !DEBUG.has('nolimit');
  /**
   * 程序化叠加会改的骨骼，以及它们“只有动作、没叠东西”时的旋转（animQ）和上一帧叠完之后的旋转（outQ）。
   * three.js 的动画混合器在求出来的值和上一帧一样时不会重写骨骼（动作停在某一帧：防御保持、胜利定格、受击顿帧），
   * 这时骨骼上留着的是上一帧叠完的结果；不先还原就再叠一次，头部跟随和受击弹簧会一帧一帧越叠越多，头一路转进身体里。
   */
  private procBones: THREE.Bone[] = []; private animQ: THREE.Quaternion[] = []; private outQ: THREE.Quaternion[] = [];
  private procFix = !DEBUG.has('noprocfix');

  constructor(asset: RigAsset, readonly fighter: Fighter) {
    this.rig = new Rig(asset);
    this.animator = new Animator(this.rig.model, asset.clips);
    this.rig.eachMaterial((m) => { this.baseEmissive.set(m, { c: m.emissive.clone(), i: m.emissiveIntensity }); });
    this.springs = new SpringBones(this.rig);
    this.limits = LIMITS.map((l) => new ChainLimit(this.rig, l)).filter((l) => l.active);
    for (const k of ['Spine', 'Spine1', 'Spine2', 'Neck', 'Head'] as BoneKey[]) {
      const b = this.rig.bones[k]; if (!b) continue;
      this.procBones.push(b); this.animQ.push(b.quaternion.clone()); this.outQ.push(new THREE.Quaternion(NaN, NaN, NaN, NaN));
    }
    const specs = RIBBONS[asset.id];
    if (specs) { this.ribbons = new RibbonSet(this.rig, specs); this.world.add(this.ribbons.group); }
  }

  /** 受击：给上半身一个冲量。dir 是受力方向（角色本地：正数向前、负数向后），power 0..1。 */
  jolt(power: number, kind: 'high' | 'mid' | 'side' | 'heavy' = 'mid') {
    // 有受击动作在播的时候，弹簧只是加一点“肉感”，幅度收小
    const k = clamp(power, 0, 1.4) * 0.5;
    for (const [name, j] of Object.entries(this.jolts)) {
      const w = this.joltW[name];
      const upper = name === 'Head' || name === 'Neck';
      if (kind === 'mid') { j.bendV += (upper ? 9 : -7) * k * w; }       // 腹部受击：腰向前折、头向后甩
      else if (kind === 'high') { j.bendV += 12 * k * w * (upper ? 1.3 : 0.6); }  // 头部受击：整体后仰
      else if (kind === 'side') { j.twistV += 11 * k * w * (Math.random() < 0.5 ? 1 : -1); j.bendV += 4 * k * w; }
      else { j.bendV += 13 * k * w; j.twistV += 5 * k * w * (Math.random() - 0.5) * 2; }
      j.rollV += (Math.random() - 0.5) * 5 * k * w;
    }
  }

  hitFlash(k: number, color: THREE.ColorRepresentation = 0xffffff) { this.flash = Math.max(this.flash, k); this.flashColor.set(color); }

  /** 骨骼的父节点在“角色本地空间”（face 里面）里的朝向。 */
  private parentQuat(bone: THREE.Object3D, out: THREE.Quaternion) {
    let chain = this.chains.get(bone);
    if (!chain) {
      chain = [];
      let o = bone.parent;
      while (o && o !== this.rig.face) { chain.push(o); o = o.parent; }
      chain.reverse();
      this.chains.set(bone, chain);
    }
    out.identity();
    for (const o of chain) out.multiply(o.quaternion);
    return out;
  }
  /** 在角色本地空间里给骨骼叠一个旋转（x 朝前、y 朝上、z 侧向）。镜像朝向时自动跟着镜像。 */
  private addLocalSpaceRot(key: BoneKey, q: THREE.Quaternion) {
    const b = this.rig.bones[key]; if (!b) return;
    this.parentQuat(b, _p); _pi.copy(_p).invert();
    b.quaternion.premultiply(_pi.multiply(q).multiply(_p));
  }

  update(alpha: number, dtReal: number, dtScaled: number, opponentHead?: THREE.Vector3) {
    const f = this.fighter, rig = this.rig;
    // 位置：两帧之间插值；受击顿帧时左右抖
    const x = lerp(f.px, f.x, alpha), y = lerp(f.py, f.y, alpha);
    let sx = 0;
    if (f.shakeF > 0 && f.hitstop > 0) sx = Math.sin(performance.now() * 0.09) * 0.022 * Math.min(1, f.shakeF / 6);
    this.pos.set(x, y, 0);
    rig.root.position.set(x + sx, y, 0);
    rig.setFacing(f.facing);
    rig.root.visible = this.visible;

    // 动作
    const a = f.anim;
    if (a.seq !== this.seq) { this.seq = a.seq; if (!this.animator.play(a.name, a.fade, a.t, a.loop)) this.animator.play('idle', a.fade, 0, true); }
    this.animator.setTime(a.t + a.rate * DT * alpha);
    this.animator.update(dtReal);
    // 程序化叠加之前，先让这几根骨骼回到“纯动作”的值：混合器这一帧没重写的（值还等于我们上一帧写的），用存下来的动作值还原
    if (this.procFix) for (let i = 0; i < this.procBones.length; i++) {
      const q = this.procBones[i].quaternion;
      if (q.equals(this.outQ[i])) q.copy(this.animQ[i]); else this.animQ[i].copy(q);
    }

    // 受击弹簧
    for (const [name, j] of Object.entries(this.jolts)) {
      [j.bend, j.bendV] = spring(j.bend, j.bendV, 0, 3.2, 0.42, dtScaled);
      [j.twist, j.twistV] = spring(j.twist, j.twistV, 0, 3.0, 0.45, dtScaled);
      [j.roll, j.rollV] = spring(j.roll, j.rollV, 0, 3.4, 0.5, dtScaled);
      if (Math.abs(j.bend) + Math.abs(j.twist) + Math.abs(j.roll) < 0.002) continue;
      _q.setFromAxisAngle(AXIS_Z, clamp(j.bend, -0.38, 0.38));
      _q.multiply(_q2.setFromAxisAngle(AXIS_Y, clamp(j.twist, -0.6, 0.6)));
      _q.multiply(_q2.setFromAxisAngle(AXIS_X, clamp(j.roll, -0.3, 0.3)));
      this.addLocalSpaceRot(name as BoneKey, _q);
    }

    // 头部跟随：对手跳起来就抬头看，倒地就低头看
    const canLook = f.state === 'stand' || f.state === 'block' || f.state === 'dash' || f.state === 'win';
    this.lookW = damp(this.lookW, canLook && opponentHead ? 1 : 0, 8, dtReal);
    if (opponentHead && this.lookW > 0.01 && rig.bones.Head) {
      rig.root.updateMatrixWorld(true);
      rig.toLocal(rig.boneWorld('Head', _v), _v);
      rig.toLocal(opponentHead, _v2);
      const dx = Math.max(0.5, _v2.x - _v.x), dy = _v2.y - _v.y;
      const target = clamp(Math.atan2(dy, dx), -0.55, 0.6);
      this.lookPitch = damp(this.lookPitch, target, 7, dtReal);
      const ang = this.lookPitch * this.lookW;
      _q.setFromAxisAngle(AXIS_Z, ang * 0.4); this.addLocalSpaceRot('Neck', _q);
      _q.setFromAxisAngle(AXIS_Z, ang * 0.5); this.addLocalSpaceRot('Head', _q);
    }

    // 关节限位：动作 + 弹簧 + 头部跟随叠完之后，把腰和脖子压回人体做得到的范围
    if (this.limitOn) for (const l of this.limits) l.solve(true);
    for (let i = 0; i < this.procBones.length; i++) this.outQ[i].copy(this.procBones[i].quaternion);

    // 受击闪光、元素附着
    this.flash = Math.max(0, this.flash - dtReal * 7);
    if (this.flash > 0.001 || this.tintK > 0.001 || this._hadTint) {
      const fk = this.flash, tk = this.tintK;
      for (const [m, base] of this.baseEmissive) {
        // 受击只是整体亮一下（约两帧），不要把人刷成一个白色剪影
        m.emissive.copy(base.c).multiplyScalar(base.i).lerp(this.flashColor, Math.min(1, fk) * 0.17).lerp(this.tintColor, tk * 0.35);
        m.emissiveIntensity = 1 + tk * 0.4;
        if (fk <= 0.001 && tk <= 0.001) { m.emissive.copy(base.c); m.emissiveIntensity = base.i; }
      }
      this._hadTint = fk > 0.001 || tk > 0.001;
    }
    rig.root.updateMatrixWorld(true);
    if (this.springs.active) { this.springs.update(dtScaled > 0 ? dtScaled : dtReal * 0.25, rig.boneWorld('Head', this._h), rig.boneWorld('Spine2', this._c)); }
    this.world.visible = this.visible;
    if (this.ribbons && this.camera) {
      if (!this.ribbonsReady) { this.ribbons.init(); this.ribbonsReady = true; }
      else { this.rt += dtScaled; this.ribbons.update(dtScaled > 0 ? dtScaled : dtReal * 0.25, this.rt, this.camera); }
    }
  }
  private _hadTint = false;

  headWorld(out: THREE.Vector3) { return this.rig.boneWorld('Head', out); }
  chestWorld(out: THREE.Vector3) { return this.rig.boneWorld('Spine2', out); }
}
