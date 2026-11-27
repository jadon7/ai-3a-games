import * as THREE from 'three';
import type { Rig } from './rig';

interface Link {
  bone: THREE.Bone;
  len: number;                 // 这一节的长度（骨骼局部单位）
  axis: THREE.Vector3;         // 骨骼局部空间里指向下一节的方向
  tail: THREE.Vector3; prev: THREE.Vector3;   // 这一节末端的世界坐标（当前、上一步）
  rest: THREE.Quaternion;      // 动作给的局部旋转（这些骨骼没有动画轨道，就是静止姿势）
}

const _p = new THREE.Vector3(), _t = new THREE.Vector3(), _d = new THREE.Vector3(), _a = new THREE.Vector3(), _q = new THREE.Quaternion(), _c = new THREE.Vector3();

/**
 * 弹簧骨骼链（马尾、长发、挂饰）：模型里名字以 phys_ 开头的骨骼按链组织，每一节的末端是一个质点，
 * 带惯性和重力，被弹力拉回动作给的姿势；每帧让骨骼指向自己的质点。
 * 位置在世界空间里算（角色移动、转身的惯性自然就有了），转成骨骼旋转时先换到父骨骼的局部空间，
 * 这样角色镜像（朝左）时也是对的。
 */
export class SpringBones {
  private chains: Link[][] = [];
  private inited = false;
  private anchor = new THREE.Vector3();
  /** 弹力（越大越硬）、阻尼、重力。马尾：偏软、重力明显 */
  stiffness = 0.085; drag = 0.2; gravity = 5.5;

  constructor(private rig: Rig) {
    const roots = rig.allBones.filter((b) => /^phys_/i.test(b.name) && !(b.parent && /^phys_/i.test(b.parent.name)));
    for (const root of roots) {
      const chain: Link[] = [];
      let b: THREE.Bone | undefined = root;
      while (b) {
        const child = b.children.find((c) => (c as THREE.Bone).isBone && /^phys_/i.test(c.name)) as THREE.Bone | undefined;
        const prev = chain[chain.length - 1];
        const axis = child ? child.position.clone().normalize() : prev ? prev.axis.clone() : new THREE.Vector3(0, 1, 0);
        const len = child ? child.position.length() : prev ? prev.len : 0.05;
        chain.push({ bone: b, len, axis, tail: new THREE.Vector3(), prev: new THREE.Vector3(), rest: b.quaternion.clone() });
        b = child;
      }
      if (chain.length) this.chains.push(chain);
    }
  }

  get active() { return this.chains.length > 0; }

  private animTail(l: Link, out: THREE.Vector3) {
    // 动作姿势下这一节末端的世界坐标
    out.copy(l.axis).applyQuaternion(l.rest).multiplyScalar(l.len).add(l.bone.position);
    return l.bone.parent!.localToWorld(out);
  }

  reset() {
    for (const chain of this.chains) for (const l of chain) { l.bone.quaternion.copy(l.rest); l.bone.parent!.updateWorldMatrix(false, false); this.animTail(l, l.tail); l.prev.copy(l.tail); }
    if (this.chains[0]) this.anchor.setFromMatrixPosition(this.chains[0][0].bone.parent!.matrixWorld);
    this.inited = true;
  }

  /** 在动作求值、程序化叠加都做完之后调用。head / chest 是不让头发穿进去的两个球心。 */
  update(dt: number, head: THREE.Vector3, chest: THREE.Vector3) {
    if (!this.chains.length) return;
    if (!this.inited) { this.reset(); return; }
    // 瞬移：整条链跟着平移
    _p.setFromMatrixPosition(this.chains[0][0].bone.parent!.matrixWorld);
    if (_p.distanceTo(this.anchor) > 0.9) { _d.subVectors(_p, this.anchor); for (const chain of this.chains) for (const l of chain) { l.tail.add(_d); l.prev.add(_d); } }
    this.anchor.copy(_p);
    const h = this.rig.height, k = Math.min(dt, 1 / 30) * 60;   // 按 60 帧归一
    const rHead = 0.105 * h, rChest = 0.15 * h;
    for (const chain of this.chains) {
      for (const l of chain) {
        const parent = l.bone.parent!;
        parent.updateWorldMatrix(false, false);
        l.bone.quaternion.copy(l.rest);
        // 惯性 + 重力 + 拉回动作姿势
        _t.copy(l.tail);
        _d.subVectors(l.tail, l.prev).multiplyScalar(1 - this.drag * k);
        l.prev.copy(l.tail);
        this.animTail(l, _a);
        _t.add(_d); _t.y -= this.gravity * (dt * dt) * 1.0;
        _t.lerp(_a, Math.min(1, this.stiffness * k));
        // 不穿头、不穿背
        for (let i = 0; i < 2; i++) { const c = i === 0 ? head : chest, r = i === 0 ? rHead : rChest; _c.subVectors(_t, c); const dd = _c.length(); if (dd < r && dd > 1e-5) _t.copy(c).addScaledVector(_c, r / dd); }
        if (_t.y < 0.02) _t.y = 0.02;
        // 长度约束：以骨骼根部为圆心
        _p.copy(l.bone.position); parent.localToWorld(_p);
        const lenW = l.len * h;
        _d.subVectors(_t, _p); const dl = _d.length() || 1e-5; _t.copy(_p).addScaledVector(_d, lenW / dl);
        l.tail.copy(_t);
        // 让骨骼指向质点：换到父骨骼局部空间里算
        _d.copy(_t); parent.worldToLocal(_d); _d.sub(l.bone.position).normalize();
        _a.copy(l.axis).applyQuaternion(l.rest).normalize();
        _q.setFromUnitVectors(_a, _d);
        l.bone.quaternion.copy(_q).multiply(l.rest);
        l.bone.updateMatrix();
        l.bone.matrixWorld.multiplyMatrices(parent.matrixWorld, l.bone.matrix);
      }
    }
  }
}
